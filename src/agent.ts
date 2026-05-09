import { getSystemPrompt } from "./config.js";
import { chatCompletion, type ChatMessage } from "./llm.js";
import { TOOLS, executeTool } from "./tools.js";
import { saveSession, loadSession, type Session } from "./session-store.js";

export interface AgentEvent {
  type: "thought" | "tool_call" | "tool_result" | "content" | "usage" | "done" | "error";
  data?: string;
  toolName?: string;
  result?: unknown;
  error?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

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

export async function* runAgent(userMessage: string, sessionId: string, existingMessages?: ChatMessage[]): AsyncGenerator<AgentEvent> {
  const session: Session = loadSession(sessionId) || {
    id: sessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };

  if (!session.systemPrompt) {
    session.systemPrompt = getSystemPrompt();
    saveSession(session);
  }

  const messages: ChatMessage[] = existingMessages || [
    { role: "system", content: session.systemPrompt },
  ];

  if (!existingMessages && session.messages.length > 0) {
    messages.length = 0;
    messages.push({ role: "system", content: session.systemPrompt });
    messages.push(...session.messages);
  }

  if (!existingMessages) {
    messages.push({ role: "user", content: userMessage });
  }

  const MAX_STEPS = 20;

  for (let step = 0; step < MAX_STEPS; step++) {
    try {
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

      const response = await completionPromise;

      if (response.usage) {
        yield { type: "usage", usage: response.usage };
      }

      if (!response || !response.message) {
        yield { type: "error", error: "Ungültige Antwort vom LLM (keine Nachricht)." };
        return;
      }

      const msg = response.message;
      const reasoning = (msg as any).reasoning_content || "";

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push({
          role: "assistant",
          content: msg.content || undefined,
          tool_calls: msg.tool_calls,
          reasoning_content: reasoning || undefined,
        });

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
        continue;
      }

      let finalContent: string = typeof msg.content === "string" ? msg.content : "";
      if (!finalContent && reasoning) {
        finalContent = reasoning;
      }

      if (!finalContent) {
        yield { type: "error", error: "Leere Antwort vom LLM erhalten." };
        return;
      }

      messages.push({
        role: "assistant",
        content: finalContent,
        reasoning_content: reasoning || undefined,
      });

      session.messages = messages
        .filter((_, idx) => idx !== 0 || messages[0]?.role !== "system")
        .map((msg) => replaceImagesWithPlaceholder(msg));
      saveSession(session);

      yield { type: "done" };
      return;
    } catch (err: any) {
      let errorMsg = err.message || "Unbekannter Fehler";
      if (err.cause) errorMsg += ` (Ursache: ${err.cause})`;
      
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
