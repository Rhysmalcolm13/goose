use crate::errors::AgentError;
use crate::message::{Message, MessageContent};
use crate::providers::base::{Provider, ProviderUsageCollector, Usage};
use crate::providers::configs::GoogleProviderConfig;
use crate::providers::utils::is_valid_function_name;
use anyhow::anyhow;
use async_trait::async_trait;
use mcp_core::{Content, Role, Tool, ToolCall};
use reqwest::{Client, StatusCode};
use serde_json::{json, Map, Value};
use std::time::Duration;

pub struct GoogleProvider {
    client: Client,
    config: GoogleProviderConfig,
    usage_collector: ProviderUsageCollector,
}

impl GoogleProvider {
    pub fn new(config: GoogleProviderConfig) -> anyhow::Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(600)) // 10 minutes timeout
            .build()?;

        Ok(Self {
            client,
            config,
            usage_collector: ProviderUsageCollector::new(),
        })
    }

    fn get_usage(data: &Value) -> anyhow::Result<Usage> {
        let usage = data
            .get("usage")
            .ok_or_else(|| anyhow!("No usage data in response"))?;

        let input_tokens = usage
            .get("prompt_tokens")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32);

        let output_tokens = usage
            .get("completion_tokens")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32);

        let total_tokens = usage
            .get("total_tokens")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32)
            .or_else(|| match (input_tokens, output_tokens) {
                (Some(input), Some(output)) => Some(input + output),
                _ => None,
            });

        Ok(Usage::new(input_tokens, output_tokens, total_tokens))
    }

    async fn post(&self, payload: Value) -> anyhow::Result<Value> {
        let url = format!(
            "{}/v1beta/models/{}:generateContent?key={}",
            self.config.host.trim_end_matches('/'),
            self.config.model,
            self.config.api_key
        );

        let response = self
            .client
            .post(&url)
            .header("CONTENT_TYPE", "application/json")
            .json(&payload)
            .send()
            .await?;

        match response.status() {
            StatusCode::OK => Ok(response.json().await?),
            status if status == StatusCode::TOO_MANY_REQUESTS || status.as_u16() >= 500 => {
                // Implement retry logic here if needed
                Err(anyhow!("Server error: {}", status))
            }
            _ => Err(anyhow!(
                "Request failed: {}\nPayload: {}",
                response.status(),
                payload
            )),
        }
    }
}

#[async_trait]
impl Provider for GoogleProvider {
    async fn complete(
        &self,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
    ) -> anyhow::Result<(Message, Usage)> {
        // Lifei: TODO: temperature parameters, tools may be empty, images
        let mut payload = Map::new();
        payload.insert(
            "system_instruction".to_string(),
            json!({"parts": [{"text": system}]}),
        );
        payload.insert(
            "contents".to_string(),
            json!(messages_to_google_spec(&messages)),
        );
        if !tools.is_empty() {
            payload.insert(
                "tools".to_string(),
                json!({"functionDeclarations": tools_to_google_spec(&tools)}),
            );
        }

        // Make request
        let response = self.post(Value::Object(payload)).await?;

        // Parse response
        let message = google_response_to_message(unescape_json_values(&response))?;
        // Lifei: TODO Usage
        let usage = Usage::new(Some(100), Some(100), Some(100));
        // let usage = Self::get_usage(&response)?;
        // self.usage_collector.add_usage(usage.clone());

        Ok((message, usage))
    }

    fn total_usage(&self) -> Usage {
        self.usage_collector.get_usage()
    }
}

fn messages_to_google_spec(messages: &[Message]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            let role = if message.role == Role::User {
                "user"
            } else {
                "model"
            };
            let mut parts = Vec::new();
            for message_content in message.content.iter() {
                match message_content {
                    MessageContent::Text(text) => {
                        if !text.text.is_empty() {
                            parts.push(json!({"text": text.text}));
                        }
                    }
                    MessageContent::ToolRequest(request) => match &request.tool_call {
                        Ok(tool_call) => {
                            let mut function_call_part = Map::new();
                            function_call_part.insert("name".to_string(), json!(tool_call.name));
                            if tool_call.arguments.is_object()
                                && !tool_call.arguments.as_object().unwrap().is_empty()
                            {
                                function_call_part
                                    .insert("args".to_string(), tool_call.arguments.clone());
                            }
                            parts.push(json!({
                                "functionCall": function_call_part
                            }));
                        }
                        Err(e) => {
                            parts.push(json!({"text":format!("Error: {}", e)}));
                        }
                    },
                    MessageContent::ToolResponse(response) => {
                        match &response.tool_result {
                            Ok(contents) => {
                                // Send only contents with no audience or with Assistant in the audience
                                let abridged: Vec<_> = contents
                                    .iter()
                                    .filter(|content| {
                                        content.audience().is_none_or(|audience| {
                                            audience.contains(&Role::Assistant)
                                        })
                                    })
                                    .map(|content| content.unannotated())
                                    .collect();

                                for content in abridged {
                                    match content {
                                        Content::Image(image) => {}
                                        _ => {
                                            parts.push(json!({
                                                "functionResponse": {
                                                    "name": response.id,
                                                    "response": {"content": content},
                                                }}
                                            ));
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                parts.push(json!({"text":format!("Error: {}", e)}));
                            }
                        }
                    }

                    _ => {}
                }
            }
            json!({"role": role, "parts": parts})
        })
        .collect()
}

fn tools_to_google_spec(tools: &[Tool]) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            let mut parameters = Map::new();
            parameters.insert("name".to_string(), json!(tool.name));
            parameters.insert("description".to_string(), json!(tool.description));
            let tool_input_schema = tool.input_schema.as_object().unwrap();
            let tool_input_schema_properties = tool_input_schema
                .get("properties")
                .unwrap_or(&json!({}))
                .as_object()
                .unwrap()
                .clone();
            if !tool_input_schema_properties.is_empty() {
                let accepted_tool_schema_attributes = vec![
                    "type".to_string(),
                    "format".to_string(),
                    "description".to_string(),
                    "nullable".to_string(),
                    "enum".to_string(),
                    "maxItems".to_string(),
                    "minItems".to_string(),
                    "properties".to_string(),
                    "required".to_string(),
                    "items".to_string(),
                ];
                parameters.insert(
                    "parameters".to_string(),
                    json!(process_map(
                        tool_input_schema,
                        &accepted_tool_schema_attributes,
                        None
                    )),
                );
            }
            json!(parameters)
        })
        .collect()
}

fn process_map(
    map: &Map<String, Value>,
    accepted_keys: &[String],
    parent_key: Option<&str>, // Track the parent key
) -> Value {
    let mut filtered_map: Map<String, serde_json::Value> = map
        .iter()
        .filter_map(|(key, value)| {
            let should_remove = !accepted_keys.contains(key) && parent_key != Some("properties");
            if should_remove {
                return None;
            }
            // Process nested maps recursively
            let filtered_value = match value {
                Value::Object(nested_map) => process_map(
                    &nested_map
                        .iter()
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect(),
                    accepted_keys,
                    Some(key),
                ),
                _ => value.clone(),
            };

            Some((key.clone(), filtered_value))
        })
        .collect();
    if parent_key != Some("properties") && !filtered_map.contains_key("type") {
        filtered_map.insert("type".to_string(), Value::String("string".to_string()));
    }

    Value::Object(filtered_map)
}

fn google_response_to_message(response: Value) -> anyhow::Result<Message> {
    let mut content = Vec::new();
    let binding = vec![];
    let candidates: &Vec<Value> = response
        .get("candidates")
        .and_then(|v| v.as_array())
        .unwrap_or(&binding);
    let candidate = candidates.get(0);
    let role = Role::Assistant;
    let created = chrono::Utc::now().timestamp();
    if candidate.is_none() {
        return Ok(Message {
            role,
            created,
            content,
        });
    }
    let candidate = candidate.unwrap();
    let parts = candidate
        .get("content")
        .and_then(|content| content.get("parts"))
        .and_then(|parts| parts.as_array())
        .unwrap_or(&binding);
    for part in parts {
        if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
            content.push(MessageContent::text(text.to_string()));
        } else if let Some(function_call) = part.get("functionCall") {
            let id = function_call["name"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            let name = function_call["name"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            if !is_valid_function_name(&name) {
                let error = AgentError::ToolNotFound(format!(
                    "The provided function name '{}' had invalid characters, it must match this regex [a-zA-Z0-9_-]+",
                    name
                ));
                content.push(MessageContent::tool_request(id, Err(error)));
            } else {
                let parameters = function_call.get("args");
                if parameters.is_some() {
                    content.push(MessageContent::tool_request(
                        id,
                        Ok(ToolCall::new(&name, parameters.unwrap().clone())),
                    ));
                }
            }
        }
    }
    Ok(Message {
        role,
        created,
        content,
    })
}

fn unescape_json_values(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let new_map: Map<String, Value> = map
                .iter()
                .map(|(k, v)| (k.clone(), unescape_json_values(v))) // Process each value
                .collect();
            Value::Object(new_map)
        }
        Value::Array(arr) => {
            let new_array: Vec<Value> = arr.iter().map(|v| unescape_json_values(v)).collect();
            Value::Array(new_array)
        }
        Value::String(s) => {
            let unescaped = s
                .replace("\\\\n", "\n")
                .replace("\\\\t", "\t")
                .replace("\\\\r", "\r")
                .replace("\\\\\"", "\"")
                .replace("\\n", "\n")
                .replace("\\t", "\t")
                .replace("\\r", "\r")
                .replace("\\\"", "\"");
            Value::String(unescaped)
        }
        _ => value.clone(),
    }
}
