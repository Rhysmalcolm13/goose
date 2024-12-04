import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const SESSIONS_PATH = path.join(app.getPath('userData'), 'sessions');
if (!fs.existsSync(SESSIONS_PATH)) {
    fs.mkdirSync(SESSIONS_PATH);
}

interface Session {
    name: string; // Derived from a synopsis of the conversation
    messages: Array<{
        id: number;
        role: 'function' | 'system' | 'user' | 'assistant' | 'data' | 'tool';
        content: string;
    }>;
    directory: string;
}

function generateSessionName(messages: {id: number, role: string, content: string}[]): string {
    // Create a session name based on the first message or a combination of initial messages
    if (messages === undefined || messages.length === 0) return 'empty_session';
    return messages[0].content.split(' ').slice(0, 5).join(' ');
}

export function saveSession(session: Session): string {
    try {
        const sessionData = {
            ...session,
            name: generateSessionName(session.messages)
        };
        const filePath = path.join(SESSIONS_PATH, `${sessionData.name}.json`);
        fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2));
        console.log('Session saved:', sessionData);
        return sessionData.name;
    } catch (error) {
        console.error('Error saving session:', error);
    }
}

export function loadSession(sessionId: string): Session | undefined {
    try {
        const filePath = path.join(SESSIONS_PATH, `${sessionId}.json`);
        if (!fs.existsSync(filePath)) {
            console.warn('Session file not found:', sessionId);
            return undefined;
        }
        const data = fs.readFileSync(filePath, 'utf8');
        const session = JSON.parse(data) as Session;
        console.log('Session loaded:', session);
        return session;
    } catch (error) {
        console.error('Error loading session:', error);
    }
}

// load sessions that are relevant to the directory supplied (not where they are stored, but where user is operating)
export function loadSessions(dir?: string): Session[] {
    try {
        console.log('Attempting to load sessions from:', SESSIONS_PATH);
        const MAX_AGE_DAYS = 10;
        // Get the current date
        const now = Date.now();
        const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

        // Get all files in the directory
        const files = fs.readdirSync(SESSIONS_PATH);

        if (files.length === 0) {
            console.warn('No session files found in directory');
            return [];
        }

        // Filter files based on their age and limit to max 100 files
        const filteredFiles = files
            .map(file => {
                const filePath = path.join(SESSIONS_PATH, file);
                const stats = fs.statSync(filePath);
                const age = now - stats.mtimeMs;
                return { file, age };
            })
            .filter(({ age }) => age <= maxAgeMs);            

        if (filteredFiles.length === 0) {
            console.warn('No session files meet the age criteria');
            return [];
        }

        // Load the filtered files and parse them into sessions
        const sessions = filteredFiles.map(({ file }) => {
            const data = fs.readFileSync(path.join(SESSIONS_PATH, file), 'utf8');
            return JSON.parse(data) as Session;
        });
        if (dir) {
            // Filter sessions based on the directory
            return sessions.filter(session => session.directory === dir).splice(0, 4);
        } else {
            // just recent sessions
            return sessions.splice(0, 20);
        }
    } catch (error) {
        console.error('Error loading sessions:', error);
        return [];
    }
}

export function clearAllSessions(): void {
    try {
        const files = fs.readdirSync(SESSIONS_PATH);
        files.forEach(file => fs.unlinkSync(path.join(SESSIONS_PATH, file)));
        console.log('All sessions cleared');
    } catch (error) {
        console.error('Error clearing sessions:', error);
    }
}
