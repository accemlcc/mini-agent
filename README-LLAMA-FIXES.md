# llama.cpp Multi-Turn KV-Cache Fix for Hybrid/Recurrent/SWA Models

## Problem

llama.cpp's server (`b330-660b1b4`) forces full prompt re-processing on every turn for models
with hybrid/recurrent layers (SSM, Gated DeltaNet) or SWA (Sliding Window Attention):

- Qwen3.5 35B A3B (`qwen35moe`) — Gated DeltaNet, no SWA
- Qwen3 Next 80B A3B (`qwen3next`) — SSM, no SWA
- Gemma 4 26B A4B (`gemma4`) — Gated DeltaNet + iSWA

The message in the log is:
```
forcing full prompt re-processing due to lack of cache data
(likely due to SWA or hybrid/recurrent memory)
```

## Root Cause (3 interacting issues)

1. **`slot_save_and_clear()`** saves idle slots to prompt cache and clears them.
   Recurrent state cannot be properly checkpointed/restored.

2. **`llama_memory_seq_rm()` fails** for hybrid models → triggers
   `prompt_clear(true)` → destroys just-restored checkpoint state.

3. **`get_common_prefix()`** compares slot tokens (which include model-generated output
   token IDs) against newly retokenized request tokens. They diverge after the first turn
   because the actual generated token sequence differs from re-tokenized text.

## Fixes Applied

All patches in `tools/server/server-context.cpp`.

Build: `cmake --build build --target llama-server -j16`

### Fix 1: Skip idle slot save/clear for hybrid/SWA models

Prevents the prompt cache from corrupting slot state between turns.
The slot stays in VRAM, KV cache survives.

```cpp
void slot_save_and_clear(server_slot & slot) {
    if (slot.prompt.n_tokens() == 0) { return; }
    if (llama_model_is_hybrid(model) || llama_model_n_swa(model) > 0) {
        SLT_INF(slot, "%s", "skipping save of idle slot (hybrid/swa model)\n");
        return;
    }
    // original code ...
}
```

### Fix 2: Don't wipe after seq_rm failure on restored checkpoint

When `llama_memory_seq_rm()` fails (expected for hybrid models), and a checkpoint
was just restored, keep the cached tokens instead of destroying everything.

```cpp
if (!llama_memory_seq_rm(llama_get_memory(ctx), slot.id, p0, -1)) {
    if (llama_model_is_hybrid(model) && slot.n_prompt_tokens_cache > 0) {
        SLT_INF(slot, "seq_rm failed (expected for hybrid) - keeping %d cached tokens\n",
                slot.n_prompt_tokens_cache);
    } else {
        // original wipe behavior
    }
}
```

### Fix 3: Keep existing prompt when cache load finds nothing better

When `prompt_load()` returns false, don't clear the slot if it already has
valid tokens from the previous turn.

```cpp
if (!ret->prompt_load(*prompt_cache, task.tokens)) {
    if (llama_model_is_hybrid(model) || llama_model_n_swa(model) > 0) {
        if (ret->prompt.n_tokens() > 0) {
            SLT_INF(*ret, "prompt_load failed, keeping %d existing tokens\n",
                    ret->prompt.n_tokens());
        } else {
            ret->prompt_clear(false);
        }
    } else {
        ret->prompt_clear(false);
    }
}
```

### Fix 4: Track real prompt token count, bypass broken get_common_prefix

The core fix. Instead of relying on `get_common_prefix()` (which compares slot
tokens against re-tokenized request tokens and always fails), we:

a) Save the actual prompt token count after prefill completes (before generation adds tokens).
b) Keep it across turns (don't reset in `reset()`).
c) Use it as `n_past` for the next turn instead of `get_common_prefix()`.
d) Cap it at `task.n_tokens()` to handle smaller prompts (conversation switch).

```cpp
// In reset(): don't clear n_prompt_tokens_cache for hybrid/SWA
void reset() {
    if (!llama_model_is_hybrid(llama_get_model(ctx)) &&
         llama_model_n_swa(llama_get_model(ctx)) == 0) {
        n_prompt_tokens_cache = 0;
    }
}

// After prefill ("prompt processing done"): save prompt token count
if (llama_model_is_hybrid(model) || llama_model_n_swa(model) > 0) {
    slot.n_prompt_tokens_cache = slot.prompt.n_tokens();
}

// When computing n_past: use cached count, cap at task size
if ((llama_model_is_hybrid(model) || llama_model_n_swa(model) > 0) &&
     slot.n_prompt_tokens_cache > 0) {
    n_past = std::min(slot.n_prompt_tokens_cache, slot.task->n_tokens());
} else {
    n_past = slot.prompt.tokens.get_common_prefix(input_tokens);
}
```

## Recommended Server Flags

### Gemma 4 (has SWA)
```bash
./build/bin/llama-server \
  --model ... \
  --host 0.0.0.0 --port 8091 \
  --n-gpu-layers 999 \
  --flash-attn on \
  --parallel 1
```

No `--swa-full` needed — the non-SWA layers (5 of 30) maintain full context.
The SWA layers (25 of 30) have a 1536-cell window; LCP similarity + our fix
keeps the slot alive between turns without needing the full SWA buffer.

Optional: `--cache-type-k q4_0 --cache-type-v q4_0` for KV cache quantization
(reduces non-SWA KV from 5120 MiB to 1440 MiB).

### Qwen3.5 / Qwen3-Next (no SWA)
```bash
./build/bin/llama-server \
  --model ... \
  --host 0.0.0.0 --port 8091 \
  --n-gpu-layers 999 \
  --flash-attn on \
  --parallel 1
```

### Multi-User / Multi-Conversation

With `--parallel 1`, the server handles one conversation at a time.
A second request with a completely different prompt will trigger full reprocessing
(which is correct — different conversation, different context).

## Results

Gemma 4 26B, single-turn continuation:
```
Task 0: 15184 tokens, 28s (cold start)
Task 1: 15184 cached, 360 new tokens, 0.99s
Task 2: 15544 cached, 207 new tokens, instant
```

## Upstream Status

- Issue: https://github.com/ggml-org/llama.cpp/issues/21831 (open, `bug-unconfirmed`)
- Related PR: https://github.com/ggml-org/llama.cpp/pull/22534 (closed — seq_rm fix, "AI-generated")
- Related PR: https://github.com/ggml-org/llama.cpp/pull/13194 (merged — SWA cache infrastructure)

## Restoration After Server Restart

These fixes keep the slot alive in VRAM but do NOT persist across server restarts.
After restart, the first turn of any conversation will be a cold start (full reprocessing).
This is expected — recurrent state cannot be serialized in this build.
