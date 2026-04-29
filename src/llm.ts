import { LLM_BASE_URL, LLM_MODEL } from "./config.js";

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image_url";
  image_url: {
    url: string; // data:image/...;base64,... or http(s)://...
    detail?: "low" | "high" | "auto";
  };
}

export type ContentPart = TextContentPart | ImageContentPart;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | ContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  reasoning_content?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface LLMResponse {
  message: ChatMessage;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export async function chatCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  stream = false,
  onStream?: (chunk: { content?: string; reasoning?: string }) => void
): Promise<LLMResponse> {
  const body: Record<string, unknown> = {
    model: LLM_MODEL,
    messages,
    tools,
    temperature: 0.2,
    max_tokens: 2048,
    stream,
  };

  const res = await fetch(`${LLM_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM HTTP ${res.status}: ${text}`);
  }

  if (stream && onStream) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let reasoningContent = "";
    let toolCalls: ToolCall[] | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            onStream({ content: delta.content });
          }
          if (delta?.reasoning_content) {
            reasoningContent += delta.reasoning_content;
            onStream({ reasoning: delta.reasoning_content });
          }
          if (delta?.tool_calls) {
            if (!toolCalls) toolCalls = [];
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              // Array vergrößern falls nötig
              while (toolCalls.length <= idx) {
                toolCalls.push({
                  id: `call_${Math.random().toString(36).slice(2)}`,
                  type: "function",
                  function: { name: "", arguments: "" },
                });
              }
              const existing = toolCalls[idx];
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.function.name = tc.function.name;
              if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
            }
          }
        } catch {
          // ignore malformed lines
        }
      }
    }

    return {
      message: {
        role: "assistant",
        content: fullContent,
        reasoning_content: reasoningContent,
        tool_calls: toolCalls,
      },
    };
  }

  const json = await res.json();
  const choice = json.choices[0];
  return {
    message: {
      role: "assistant",
      content: choice.message.content || "",
      reasoning_content: choice.message.reasoning_content || "",
      tool_calls: choice.message.tool_calls,
    },
    usage: json.usage,
  };
}
