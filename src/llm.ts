import { LLM_BASE_URL, LLM_MODEL, LLM_TIMEOUT } from "./config.js";

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
    temperature: 0.7,
    frequency_penalty: 0.3,
    presence_penalty: 0.1,
    // max_tokens bewusst weggelassen → Server-Default greift (oft höher/handelbarer)
    stream,
    stream_options: { include_usage: true },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT);

  const res = await fetch(`${LLM_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

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
    let usage: LLMResponse["usage"] | undefined;

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
          // usage chunk (end of stream, often has empty choices array)
          if (parsed.usage) {
            usage = parsed.usage;
            continue;
          }
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
      usage,
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
