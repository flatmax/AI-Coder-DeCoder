# History Compaction

Conversation history grows with each exchange. Left unchecked it exceeds the
model's context window and degrades cache efficiency. History compaction
reclaims tokens by detecting topic boundaries, summarizing or truncating
completed topics, and preserving recent context verbatim.

## Overview

Compaction runs **after** the assistant response has been delivered to the
user — it is a background housekeeping step, not a blocking operation.
The compacted history takes effect on the **next** request.

```
User sends message
  → LLM streams response → streamComplete sent to frontend
  → idle pause (500ms)
  → compaction check
      → if history tokens > trigger threshold:
            detect topic boundary (LLM call)
            apply truncation or summarization
            replace in-memory history
            notify frontend via compactionEvent
```

## Configuration

Settings live in `config/app.json` under `history_compaction`:

```json
{
  "history_compaction": {
    "enabled": true,
    "compaction_trigger_tokens": 24000,
    "verbatim_window_tokens": 4000,
    "summary_budget_tokens": 500,
    "min_verbatim_exchanges": 2
  }
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | bool | `true` | Master switch for compaction |
| `compaction_trigger_tokens` | int | 6000 | Token count that triggers compaction |
| `verbatim_window_tokens` | int | 3000 | Recent history preserved unchanged |
| `summary_budget_tokens` | int | 500 | Max tokens for the summary of old messages |
| `min_verbatim_exchanges` | int | 2 | Minimum user/assistant pairs always kept |

The `detection_model` used for topic boundary detection comes from the LLM
config (`config/litellm.json`), not from `app.json`. It is passed through
`ContextManager` → `HistoryCompactor` → `TopicDetector` at initialization.

If `detection_model` is not set, compaction is disabled regardless of the
`enabled` flag — `ContextManager` requires it to instantiate the compactor.

## Two-Threshold Design

Compaction uses two token thresholds that define different regions of the
history:

```
oldest messages ◄──────────────────────────────► newest messages

│◄─── summarizable zone ───►│◄── verbatim window ──►│
                             ▲
                     verbatim_start_idx

│◄──────── total history tokens ────────────────────►│
                                    ▲
                        compaction_trigger_tokens
```

- **Trigger threshold** (`compaction_trigger_tokens`): When total history
  tokens exceed this value, compaction runs.
- **Verbatim window** (`verbatim_window_tokens`): The most recent N tokens
  of history are always preserved unchanged. The verbatim boundary is found
  by scanning backward from the last message until the token budget is
  exhausted.

## Topic Boundary Detection

### How It Works

`TopicDetector` sends the conversation history to an LLM with a specialized
skill prompt (`config/prompts/skills/compaction.md`). The LLM identifies
the most recent point where the conversation shifted topics and returns a
structured JSON response.

### Input

Messages are formatted as indexed text blocks:

```
[0] USER: Can you fix the bug in parser.py...
[1] ASSISTANT: I see the issue, the regex...
[2] USER: Now let's work on the API endpoint...
[3] ASSISTANT: Sure, looking at routes.py...
```

Messages longer than 1000 characters are truncated. At most 50 messages are
sent (the most recent 50 if history is longer). Structured content (images)
is flattened to text.

### Output

The LLM returns a JSON object:

```json
{
  "boundary_index": 2,
  "boundary_reason": "User shifted from parser bug fix to API endpoint work",
  "confidence": 0.85,
  "summary": "Fixed a regex bug in parser.py that was causing..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `boundary_index` | int \| null | Index of the first message in the NEW topic. Messages 0 through boundary_index-1 are the old topic. `null` if no boundary found. |
| `boundary_reason` | string | Explanation of why this is a topic boundary |
| `confidence` | float | 0.0–1.0 confidence score |
| `summary` | string | Summary of messages before the boundary |

### What Counts as a Topic Boundary

The skill prompt instructs the LLM to look for:

- Explicit task switches ("now let's work on...", "moving on to...")
- Shift to a different file or component
- Change in work type (debugging → feature development)
- Context resets ("forget that", "actually", "let's try something else")

The LLM is instructed to look for boundaries in the **middle** of the
conversation, not at the very end. If the entire conversation is one
continuous topic, `boundary_index` is `null`.

### Error Handling

If the LLM call fails or returns unparseable output, `TopicDetector` returns
a safe default: `boundary_index=null`, `confidence=0.0`, empty summary. This
causes compaction to fall through to the summarize case using the verbatim
window boundary, or to skip compaction entirely if no summary is available.

JSON parsing is lenient — it handles markdown code fencing around the JSON
and falls back to regex extraction of `{...}` objects from the response.

## Compaction Cases

After detecting the topic boundary, the compactor applies one of two
strategies depending on where the boundary falls relative to the verbatim
window:

### Case 1: Truncate Only

**When:** Boundary is inside or after the verbatim window
(`boundary_index >= verbatim_start_idx`) AND confidence ≥ `min_confidence`
(default 0.5).

**Action:** Discard everything before the boundary. The current topic started
recently enough that the verbatim window already covers it.

```
Before:  [old topic msgs...] [boundary] [current topic msgs...]
                                         ▲ boundary inside verbatim window
After:   [current topic msgs...]
```

No summary message is generated. This is the cheapest compaction — it simply
drops completed conversation.

### Case 2: Summarize

**When:** Boundary is before the verbatim window
(`boundary_index < verbatim_start_idx`), OR confidence is low, OR no
boundary was found.

**Action:** Replace messages before the verbatim window with a summary
message, then keep the verbatim window intact.

```
Before:  [old msgs...] [gap msgs...] [verbatim window msgs...]
After:   [summary msg] [verbatim window msgs...]
```

The summary message is a system-role message:

```
[History Summary - 12 earlier messages]

<summary text from topic detector>
```

If no summary text is available (empty from topic detector), the old messages
are simply dropped and no summary message is prepended.

### Case 3: None

**When:** History tokens are below the trigger threshold, or messages list is
empty.

**Action:** No changes. The original messages are returned unchanged.

## Minimum Exchange Guarantee

After compaction, the result is checked against `min_verbatim_exchanges`. If
the compacted messages contain fewer user messages than this minimum, earlier
messages from the original history are prepended until the minimum is met.
This prevents aggressive compaction from leaving too little context.

## Integration Points

### ContextManager

`ContextManager` owns the compactor lifecycle:

- **Initialization**: Creates `HistoryCompactor` with config from `app.json`
  and the detection model. If `detection_model` is missing or compaction is
  disabled, `_compactor` is `None`.
- **`should_compact()`**: Delegates to `HistoryCompactor.should_compact()`.
  Checks token count against trigger threshold.
- **`compact_history_if_needed()`** (async) / **`compact_history_if_needed_sync()`**:
  Runs compaction and replaces `_history` with compacted messages.
- **`reregister_history_items()`**: After compaction, purges all `history:*`
  entries from the `StabilityTracker` so the new (shorter) history can
  re-register cleanly on the next request.
- **`get_compaction_status()`**: Returns current token count, trigger
  threshold, and percent used — consumed by the UI.

### StreamingMixin (Backend)

`_run_post_response_compaction()` in `ac/llm/streaming.py`:

1. Waits 500ms after `streamComplete` to let the frontend process results.
2. Sends `compaction_start` event to frontend.
3. Runs `compact_history_if_needed_sync()` in a thread executor.
4. If compaction occurred:
   - Calls `reregister_history_items()` to reset stability tracking.
   - Sends `compaction_complete` event with case, token counts, and the
     compacted messages for the frontend to rebuild its display.
5. On error, sends `compaction_error` event.

### StreamingMixin (Frontend)

`compactionEvent()` in `webapp/src/prompt/StreamingMixin.js`:

- **`compaction_start`**: Adds a "Compacting history..." assistant message.
  Sets `isCompacting = true` to disable input during compaction.
- **`compaction_complete`**: Rebuilds `messageHistory` from the compacted
  messages received from the backend. Prepends a notification message
  showing what happened (tokens saved, case type, topic info). Triggers
  cache viewer refresh. Sets `isCompacting = false`.
- **`compaction_error`**: Updates the compacting message with the error.
  Sets `isCompacting = false`.
- **`case: "none"`**: Removes the "Compacting..." message silently.

The frontend also updates `_hudData.history_tokens` on compaction so the
history bar reflects the new token count without waiting for the next
request.

### Cache Stability Tracker

After compaction replaces history messages, `reregister_history_items()`
removes all `history:*` entries from the stability tracker. On the next
request, `_update_cache_stability()` re-registers the new (shorter) history
messages as fresh `active` items with `N=0`. They then promote normally
through the tier system based on stability.

This means compaction causes a one-time cache invalidation of all history
tiers, but the reduced message count means faster re-promotion.

## Sync/Async Execution

Both `TopicDetector` and `HistoryCompactor` provide sync wrappers
(`find_topic_boundary_sync`, `compact_sync`) for use from synchronous code.
These detect whether an event loop is already running:

- **No running loop**: Uses `asyncio.run()` directly.
- **Running loop** (e.g., called from within an async context): Submits
  `asyncio.run()` to a `ThreadPoolExecutor` to avoid "event loop already
  running" errors.

In practice, the streaming path calls `compact_history_if_needed_sync()`
from a thread executor via `loop.run_in_executor()`, which is the
synchronous-in-thread case.

## Token Counting

All token counting uses the `TokenCounter` instance from `ContextManager`,
which uses `litellm.token_counter()` for the configured model. This ensures
consistent counting between compaction decisions and the rest of the context
assembly pipeline.

Individual message token counting handles structured content (image blocks,
cache control wrappers) by extracting text parts and joining them.
