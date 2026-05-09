import express, { Request, Response, NextFunction } from "express";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { runAgent } from "./agent.js";
import { getSystemPrompt } from "./config.js";
import type { ContentPart, ChatMessage } from "./llm.js";
import { extractPdfText } from "./pdf-parser.js";
import {
  listSessions,
  loadSession,
  saveSession,
  deleteSession,
  getSessionMessages,
  generateSessionId,
} from "./session-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Multer für Datei-Uploads (im Memory, nicht auf Disk)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Statische Web-Dateien
app.use(express.static(join(__dirname, "..", "web")));

// --- Global Error Handler ---
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return;
  res.status(500).json({ error: err.message || "Interner Serverfehler" });
});

// --- Session API ---

app.get("/api/sessions", (_req, res) => {
  try {
    const sessions = listSessions();
    res.json({ sessions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sessions/new", (_req, res) => {
  const newId = generateSessionId();
  const now = new Date().toISOString();
  saveSession({ id: newId, createdAt: now, updatedAt: now, messages: [] });
  res.json({ id: newId, message: "Neue Session gestartet." });
});

app.post("/api/sessions/:id/validate", (req, res) => {
  const { id } = req.params;
  const session = loadSession(id);
  if (!session) {
    res.status(404).json({ error: "Session nicht gefunden." });
    return;
  }
  res.json({ id, message: "Session gültig.", messages: session.messages.length });
});

app.get("/api/sessions/:id/messages", (req, res) => {
  const { id } = req.params;
  const session = loadSession(id);
  if (!session) {
    res.status(404).json({ error: "Session nicht gefunden." });
    return;
  }
  res.json({ id, messages: session.messages });
});

app.delete("/api/sessions/:id", (req, res) => {
  const { id } = req.params;
  const ok = deleteSession(id);
  if (ok) {
    res.json({ message: "Session gelöscht." });
  } else {
    res.status(404).json({ error: "Session nicht gefunden." });
  }
});

app.get("/api/sessions/current", (req, res) => {
  const sessionId = req.headers["x-session-id"] as string;
  const session = sessionId ? loadSession(sessionId) : null;
  res.json({
    id: sessionId || null,
    exists: !!session,
    messageCount: session?.messages.length || 0,
  });
});

// --- Chat API ---

app.post("/api/chat", upload.array("files", 5), async (req, res) => {
  const sessionId = req.headers["x-session-id"] as string;
  if (!sessionId) {
    res.status(400).json({ error: "Keine Session-ID im Header gefunden (x-session-id)." });
    return;
  }

  const body = req.body || {};
  const message = body.message || "";
  const files = req.files as Express.Multer.File[] | undefined;

  // Ab hier: SSE-Mode
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (event: object) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  try {
    const existingMessages = getSessionMessages(sessionId);
    const messages: ChatMessage[] = [{ role: "system" as const, content: getSystemPrompt() }];
    if (existingMessages.length > 0) {
      messages.push(...existingMessages);
    }

    // User-Nachricht bauen (text + optional Bilder)
    const contentParts: ContentPart[] = [];
    if (message) {
      contentParts.push({ type: "text", text: message });
    }

    if (files && files.length > 0) {
      for (const file of files) {
        const mimeType = file.mimetype;
        if (mimeType.startsWith("image/")) {
          const base64 = file.buffer.toString("base64");
          contentParts.push({
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
              detail: "auto",
            },
          });
        } else if (file.mimetype === "application/pdf" || file.originalname?.toLowerCase().endsWith(".pdf")) {
          try {
            const text = await extractPdfText(file.buffer);
            contentParts.push({
              type: "text",
              text: `[PDF: ${file.originalname}]\n${text}`,
            });
          } catch (err: any) {
            contentParts.push({
              type: "text",
              text: `[PDF: ${file.originalname}]\n❌ Fehler beim Lesen des PDFs: ${err.message}`,
            });
          }
        } else {
          // Text-Dateien: Inhalt als Text einfügen
          const text = file.buffer.toString("utf-8");
          contentParts.push({
            type: "text",
            text: `[Datei: ${file.originalname}]\n${text}`,
          });
        }
      }
    }

    if (contentParts.length === 0) {
      sendEvent({ type: "error", error: "Keine Nachricht oder Datei angegeben." });
      res.end();
      return;
    }

    messages.push({ role: "user", content: contentParts });

    for await (const event of runAgent(message, sessionId, messages)) {
      sendEvent(event);
      if (event.type === "done" || event.type === "error") {
        break;
      }
    }
  } catch (err: any) {
    console.error("Error in chat stream:", err);
    sendEvent({ type: "error", error: err.message || "Interner Serverfehler" });
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mini-Agent läuft auf http://localhost:${PORT}`);
  console.log(`Session-API verfügbar unter http://localhost:${PORT}/api/sessions`);
});
