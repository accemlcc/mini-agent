import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { ChatMessage } from "./llm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SESSIONS_DIR = join(ROOT, "sessions");

// Stelle sicher, dass das sessions-Verzeichnis existiert
if (!existsSync(SESSIONS_DIR)) {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  systemPrompt?: string; // Einmalig bei Session-Erstellung generiert
}

function getSessionPath(sessionId: string): string {
  return join(SESSIONS_DIR, `${sessionId}.json`);
}

export function generateSessionId(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const random = Math.random().toString(36).slice(2, 6);
  return `${dateStr}_${random}`;
}

export function saveSession(session: Session): void {
  const path = getSessionPath(session.id);
  session.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(session, null, 2), "utf-8");
}

export function loadSession(sessionId: string): Session | null {
  const path = getSessionPath(sessionId);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function listSessions(): { id: string; createdAt: string; updatedAt: string; messageCount: number }[] {
  try {
    const files = readdirSync(SESSIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".json"))
      .map((d) => d.name);
    
    const sessions = files
      .map((name) => {
        try {
          const raw = readFileSync(join(SESSIONS_DIR, name), "utf-8");
          const session = JSON.parse(raw) as Session;
          return {
            id: session.id,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            messageCount: session.messages.length,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as { id: string; createdAt: string; updatedAt: string; messageCount: number }[];
    
    // Sortieren: neueste zuerst
    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sessions;
  } catch {
    return [];
  }
}

export function deleteSession(sessionId: string): boolean {
  const path = getSessionPath(sessionId);
  if (existsSync(path)) {
    unlinkSync(path);
    return true;
  }
  return false;
}

/**
 * Hilfsfunktion zum Laden der Nachrichten für eine spezifische Session-ID.
 * Wird nun direkt vom Server mit der ID aus dem Header aufgerufen.
 */
export function getSessionMessages(sessionId: string) {
  const session = loadSession(sessionId);
  return session ? session.messages : [];
}
