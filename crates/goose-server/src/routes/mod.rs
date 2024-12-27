// Export route modules
pub mod agent;
pub mod reply;

use axum::Router;

// Function to configure all routes
pub fn configure(state: crate::state::AppState) -> Router {
    Router::new()
        .merge(reply::routes(state.clone()))
        .merge(agent::routes(state))
}
