import { getSystemPrompt } from "./config.js";
import { chatCompletion, type ChatMessage } from "./llm.js";
import { TOOLS, executeTool } from "./tools.js";
import { saveSession, loadSession, getCurrentSessionId, type Session } from "./session-store.js";

export interface AgentEvent {
  type: "thought" | "tool_call" | "tool_result" | "content" | "usage" | "done" | "error";
  data?: string;
  toolName?: string;
  result?: unknown;
  error?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * Ersetzt Base64-Bilder in Nachrichten durch Text-Platzhalter.
 * Nachdem ein Bild einmal vom Vision Encoder verarbeitet wurde,
 * bleibt es im KV-Cache des Modells. Wir müssen es nicht erneut senden.
 */
function replaceImagesWithPlaceholder(msg: ChatMessage): ChatMessage {
  if (!msg.content || typeof msg.content === "string") {
    return msg;
  }

  const newContent = msg.content.map((part) => {
    if (part.type === "image_url") {
      return {
        type: "text" as const,
        text: "[Bild zuvor geteilt]",
      };
    }
    return part;
  });

  return { ...msg, content: newContent };
}

export async function* runAgent(userMessage: string, existingMessages?: ChatMessage[]): AsyncGenerator<AgentEvent> {
  const sessionId = getCurrentSessionId();
  const session: Session = loadSession(sessionId) || {
    id: sessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };

  const messages: ChatMessage[] = existingMessages || [
    { role: "system", content: getSystemPrompt() },
  ];

  // Wenn existingMessages nicht übergeben wurden, prüfe ob die Session System-Prompt hat
  if (!existingMessages && session.messages.length > 0) {
    // Vorherige Session-Nachrichten laden, aber System-Prompt sicherstellen
    const hasSystem = session.messages.some((m) => m.role === "system");
    if (hasSystem) {
      messages.length = 0;
      messages.push(...session.messages);
    } else {
      messages.push(...session.messages);
    }
  }

  // Nutzernachricht anhängen (nur wenn der Caller sie nicht schon hinzugefügt hat)
  if (!existingMessages) {
    messages.push({ role: "user", content: userMessage });
  }

  const MAX_STEPS = 5;

  for (let step = 0; step < MAX_STEPS; step++) {
    try {
      // --- Streaming-Setup ---
      const chunks: Array<{ content?: string; reasoning?: string }> = [];
      let notifyChunk: (() => void) | null = null;
      let streamFinished = false;
      let streamError: Error | null = null;
      let streamResponse: any = null;

      const completionPromise = chatCompletion(
        messages,
        TOOLS,
        true,
        (chunk) => {
          chunks.push(chunk);
          if (notifyChunk) {
            notifyChunk();
            notifyChunk = null;
          }
        }
      );

      completionPromise
        .then((resp) => {
          streamResponse = resp;
          streamFinished = true;
          if (notifyChunk) {
            notifyChunk();
            notifyChunk = null;
          }
        })
        .catch((err) => {
          streamError = err;
          streamFinished = true;
          if (notifyChunk) {
            notifyChunk();
            notifyChunk = null;
          }
        });

      // Chunks in Echtzeit yielden
      while (!streamFinished || chunks.length > 0) {
        if (chunks.length === 0) {
          await new Promise<void>((resolve) => {
            notifyChunk = resolve;
          });
          if (streamError) throw streamError;
        }
        while (chunks.length > 0) {
          const chunk = chunks.shift()!;
          if (chunk.reasoning) {
            yield { type: "thought", data: chunk.reasoning };
          }
          if (chunk.content) {
            yield { type: "content", data: chunk.content };
          }
        }
      }

      // Stream ist fertig, Response analysieren
      const response = await completionPromise;

      // Token-Verbrauch ausgeben (falls vom Backend geliefert)
      if (response.usage) {
        yield { type: "usage", usage: response.usage };
      }

      // Prüfe auf HTTP-Fehler oder ungültige Antwort
      if (!response || !response.message) {
        yield { type: "error", error: "Ungültige Antwort vom LLM (keine Nachricht)." };
        return;
      }

      const msg = response.message;
      const reasoning = (msg as any).reasoning_content || "";

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // ALLE Tool-Calls als EINE assistant-Message pushen
        messages.push({
          role: "assistant",
          content: msg.content || undefined,
          tool_calls: msg.tool_calls,
          reasoning_content: reasoning || undefined,
        });

        // Tool-Calls ausführen
        for (const tc of msg.tool_calls) {
          yield {
            type: "tool_call",
            toolName: tc.function.name,
            data: tc.function.arguments,
          };

          const toolResult = await executeTool(tc.function.name, tc.function.arguments);

          yield {
            type: "tool_result",
            toolName: tc.function.name,
            result: toolResult.result,
            error: toolResult.error,
          };

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.function.name,
            content: JSON.stringify(toolResult.error ? { error: toolResult.error } : toolResult.result),
          });
        }
        // Loop wiederholen, damit das LLM auf die Tool-Ergebnisse reagieren kann
        continue;
      }

      // Gemma4 manchmal: reasoning vorhanden, content leer, finish_reason=stop
      // In dem Fall den reasoning-Text als Antwort verwenden
      let finalContent: string = typeof msg.content === "string" ? msg.content : "";
      if (!finalContent && reasoning) {
        finalContent = reasoning;
      }

      if (!finalContent) {
        yield { type: "error", error: "Leere Antwort vom LLM erhalten." };
        return;
      }

      // Finale Antwort speichern (inkl. reasoning_content für korrekten Cache/Context)
      messages.push({
        role: "assistant",
        content: finalContent,
        reasoning_content: reasoning || undefined,
      });

      // Session speichern (alles außer dem System-Prompt am Anfang)
      // WICHTIG: Base64-Bilder durch Platzhalter ersetzen, um wiederholte
      // Bildverarbeitung bei jedem Turn zu vermeiden
      session.messages = messages
        .filter((_, idx) => idx !== 0 || messages[0]?.role !== "system")
        .map((msg) => replaceImagesWithPlaceholder(msg));
      saveSession(session);

      yield { type: "done" };
      return;
    } catch (err: any) {
      // Detaillierte Fehlermeldung
      let errorMsg = err.message || "Unbekannter Fehler";
      if (err.cause) errorMsg += ` (Ursache: ${err.cause})`;
      
      // Auch bei Fehlern: bisherige Konversation speichern
      session.messages = messages
        .filter((_, idx) => idx !== 0 || messages[0]?.role !== "system")
        .map((msg) => replaceImagesWithPlaceholder(msg));
      if (session.messages.length > 0) {
        saveSession(session);
      }
      
      yield { type: "error", error: errorMsg };
      return;
    }
  }

  yield { type: "error", error: "Maximale Schrittanzahl erreicht." };
}

export function getCurrentSessionMessages(): ChatMessage[] {
  const sessionId = getCurrentSessionId();
  const session = loadSession(sessionId);
  if (!session) return [];
  // Mit System-Prompt prefixen
  return [{ role: "system", content: getSystemPrompt() }, ...session.messages];
}
