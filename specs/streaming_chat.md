# Streaming Chat Protocol Spec

The streaming chat protocol covers the full lifecycle of a user message: from UI submission through message assembly, LLM streaming, edit parsing, stability tracking, and post-response compaction. It is the core request/response pipeline of the application.

## Architecture

```
User clicks Send
       │
       ▼
ChatActionsMixin.sendMessage()
       │
       ├─ addMessage('user', text)          ← show in UI immediately
       ├─ _generateRequestId()              ← correlate callbacks
       ├─ _startStreamingWatchdog()         ← 5min safety timeout
       │
       ▼
LiteLLM.chat_streaming (JRPC)              ← returns {status: "started"} immediately
       │
       ├─ store_user_message()              ← persist to history store
       ├─ asyncio.create_task(_stream_chat) ← background task
       │
       ▼
_stream_chat (async)
       │
       ├─ Validate files
       ├─ Load files into FileContext
       ├─ Detect & fetch URLs from prompt
       ├─ _build_streaming_messages()       ← assemble tiered message array
       ├─ _run_streaming_completion()       ← threaded litellm.completion(stream=True)
       │       │
       │       ├─ streamChunk callbacks ──► PromptView.streamChunk (JRPC callback)
       │       └─ return (full_content, was_cancelled)
       │
       ├─ add_exchange to context manager
       ├─ _auto_save_symbol_map()
       ├─ _print_streaming_hud()
       ├─ Parse & apply edits
       ├─ store_assistant_message()
       ├─ _update_cache_stability()
       │
       ▼
_send_stream_complete ──► PromptView.streamComplete (JRPC callback)
       │
       ▼
_run_post_response_compaction (async, non-blocking)
       │
       ├─ compactionEvent('compaction_start')
       ├─ compact_history_if_needed_sync()
       └─ compactionEvent('compaction_complete')
```

## Client-Side Initiation

### `sendMessage()` (`ChatActionsMixin`)

1. **Guard** — Returns if input is empty and no pasted images.
2. **Reset scroll** — Sets `_userHasScrolledUp = false` so auto-scroll works.
3. **Capture state** — Saves `inputValue`, pasted images, and fetched URL content.
4. **Build URL context** — Calls `getFetchedUrlsForMessage()` to get included (non-excluded, non-errored) fetched URLs. Appends them as a `---\n**Referenced URL Content:**` section to the message sent to the LLM, but shows only the original text in the UI.
5. **Show user message** — `addMessage('user', userContent, images)` renders immediately.
6. **Clear input** — Resets `inputValue`, `pastedImages`, URL state (detected only, not fetched).
7. **Generate request ID** — `_generateRequestId()` returns `{timestamp}-{random9}`.
8. **Track request** — `_streamingRequests.set(requestId, {message})`.
9. **Set streaming state** — `isStreaming = true`, starts 5-minute watchdog.
10. **JRPC call** — `call['LiteLLM.chat_streaming'](requestId, message, selectedFiles, images)`.
11. **Handle sync error** — If the JRPC call itself returns `{error}`, updates the last assistant message with the error.

### Request ID

Format: `{Date.now()}-{Math.random().toString(36).substr(2, 9)}`

Used to correlate `streamChunk`, `streamComplete`, and `compactionEvent` callbacks with the originating request. The client ignores callbacks for unknown request IDs.

## Server-Side Entry Point

### `chat_streaming()` (`StreamingMixin`)

Synchronous method called via JRPC. Does three things:

1. **Store user message** — `store_user_message(content, images, files)` persists to `HistoryStore`.
2. **Launch background task** — `asyncio.create_task(_stream_chat(...))`.
3. **Return immediately** — `{"status": "started", "request_id": request_id}`.

Parameters:

| Param | Type | Description |
|-------|------|-------------|
| `request_id` | `str` | Client-generated correlation ID |
| `user_prompt` | `str` | User's message text (may include URL context) |
| `file_paths` | `list[str]?` | Selected files from file picker |
| `images` | `list[dict]?` | Base64-encoded images with `{data, mime_type}` |
| `use_smaller_model` | `bool` | Use `smaller_model` instead of `model` |
| `dry_run` | `bool` | Parse edits but don't write to disk |
| `use_repo_map` | `bool` | Include symbol map in context |

## Message Assembly

### `_build_streaming_messages()`

Assembles the full message array sent to the LLM. Content is organized into 5 stability tiers for prompt caching:

| Tier | Threshold | Cached | Description |
|------|-----------|--------|-------------|
| L0 | 12+ responses | Yes | Most stable — system prompt, legend, oldest symbols/files/history |
| L1 | 9+ responses | Yes | Very stable |
| L2 | 6+ responses | Yes | Stable |
| L3 | 3+ responses | Yes | Moderately stable — default tier for new items |
| active | <3 responses | No | Recently changed — not cached |

Each cache tier boundary is marked with `cache_control: {"type": "ephemeral"}` on the last message in the tier's sequence. This tells providers like Anthropic/Bedrock where to place cache breakpoints.

### Message Array Structure

The assembled message array follows this order:

```
┌─────────────────────────────────────────────────────┐
│ 1. SYSTEM MESSAGE (L0)                              │
│    - System prompt (system.md + system_extra.md)     │
│    - Legend (path aliases for symbol map)            │
│    - L0 symbol map entries                          │
│    - L0 file contents                               │
│    [cache_control on last message in L0 sequence]   │
├─────────────────────────────────────────────────────┤
│ 2. L0 HISTORY (native user/assistant pairs)         │
│    [cache_control on last L0 history message]       │
├─────────────────────────────────────────────────────┤
│ 3. L1 BLOCK (user/assistant pair)                   │
│    - L1 symbol map entries                          │
│    - L1 file contents                               │
│    - L1 history (native pairs)                      │
│    [cache_control on last message in L1 sequence]   │
├─────────────────────────────────────────────────────┤
│ 4. L2 BLOCK (same structure as L1)                  │
│    [cache_control on last message in L2 sequence]   │
├─────────────────────────────────────────────────────┤
│ 5. L3 BLOCK (same structure as L1)                  │
│    [cache_control on last message in L3 sequence]   │
├─────────────────────────────────────────────────────┤
│ 6. FILE TREE (active, not cached)                   │
│    user: "# Repository Files\n..."                  │
│    assistant: "Ok."                                 │
├─────────────────────────────────────────────────────┤
│ 7. URL CONTEXT (active, not cached)                 │
│    user: "# URL Context\n..."                       │
│    assistant: "Ok, I've reviewed the URL content."  │
├─────────────────────────────────────────────────────┤
│ 8. ACTIVE FILES (not cached)                        │
│    user: "# Working Files\nHere are the files:..."  │
│    assistant: "Ok."                                 │
├─────────────────────────────────────────────────────┤
│ 9. ACTIVE HISTORY (native user/assistant pairs)     │
├─────────────────────────────────────────────────────┤
│ 10. USER MESSAGE (current turn)                     │
│    Plain text or multimodal with images             │
└─────────────────────────────────────────────────────┘
```

### System Prompt Construction

The system prompt is built by `build_system_prompt()` (`ac/prompts/loader.py`):

1. Load `config/prompts/system.md` — main prompt with role, symbol map instructions, edit protocol, workflow, and examples.
2. Load `config/prompts/system_extra.md` — optional additions (e.g., "Be lean", "Don't modify files not in context").
3. Concatenate with `\n\n` separator.

The system prompt is always the first content in the L0 tier.

### Symbol Map Organization

Symbol map entries use the `symbol:` prefix in the stability tracker (e.g., `symbol:ac/llm/llm.py`). Files in active context (selected in the file picker) are excluded from the symbol map because their full content replaces the summary.

Symbol map content is formatted by `format_symbol_blocks_by_tier()` which produces a separate formatted string per tier. Each tier's symbol content is preceded by a header:

- L0: `# Repository Structure\n\nBelow is a map...`
- L1–L3: `# Repository Structure (continued)\n\n`

Path aliases (e.g., `@1/=ac/symbol_index/extractors/`) are computed from frequently-referenced paths and included in the legend at the top of the L0 block.

### File Content Formatting

Files are formatted as:

```
# {Header}

These files are included for reference:

{path}
```{content}```

{path2}
```{content2}```
```

Headers vary by tier:

| Tier | Header |
|------|--------|
| L0 | `# Reference Files (Stable)` |
| L1 | `# Reference Files` |
| L2 | `# Reference Files (L2)` |
| L3 | `# Reference Files (L3)` |
| active | `# Working Files` |

### History Distribution

Conversation history messages are tracked as `history:{index}` in the stability tracker. Each message is sent as a native role/content pair (not wrapped in a formatted block), preserving the LLM's understanding of conversation turns.

History messages are distributed across tiers based on their stability. The `_get_history_tiers()` method:

1. Queries the stability tracker for all `history:{i}` items.
2. Groups them by tier, maintaining index order within each tier.
3. Any untracked messages go to `active`.

### Cache Control Placement

`_apply_cache_control(message)` modifies a message dict in-place:

- If content is already a list (structured), adds `cache_control` to the last `text` block.
- If content is a plain string, wraps it in `[{"type": "text", "text": content, "cache_control": {"type": "ephemeral"}}]`.

The placement strategy:

- **L0 without history** — `cache_control` on the system message itself.
- **L0 with history** — System message has no `cache_control`; it goes on the last L0 history message.
- **L1–L3** — `cache_control` on the last message in the combined sequence (symbols/files pair + history pairs).
- **Active** — No `cache_control` (uncached by design).

### Image Handling

If images are provided, the user message uses multimodal format:

```json
{
  "role": "user",
  "content": [
    {"type": "text", "text": "user prompt"},
    {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
  ]
}
```

## Streaming Execution

### `_run_streaming_completion()`

Runs synchronously in a thread pool executor (via `loop.run_in_executor`). This avoids blocking the asyncio event loop.

1. Calls `litellm.completion(model, messages, stream=True, stream_options={"include_usage": True})`.
2. Iterates over chunks.
3. For each chunk with content:
   - Appends to `full_content` (accumulating).
   - Calls `_fire_stream_chunk(request_id, full_content, loop)` — fire-and-forget.
4. Checks `_is_cancelled(request_id)` each iteration for cancellation.
5. After iteration, sends one final chunk with the complete content.
6. Tracks token usage from the final chunk's `usage` field.
7. Returns `(full_content, was_cancelled)`.

### Chunk Delivery

`_fire_stream_chunk()` schedules a coroutine on the main event loop from the worker thread via `asyncio.run_coroutine_threadsafe()`. Each chunk carries the **full accumulated content**, so:

- Dropped chunks are harmless (next chunk supersedes).
- Reordered chunks are harmless (latest content wins).
- Only `streamComplete` needs reliable delivery.

### Client Chunk Processing (`streamChunk`)

`StreamingMixin.streamChunk(requestId, content)`:

1. Ignores if `requestId` not in `_streamingRequests`.
2. Calls `streamWrite(content, false, 'assistant')` — delegates to `MessageHandler`.

`MessageHandler.streamWrite()` coalesces rapid chunks via `requestAnimationFrame`:

1. Stores pending chunk data.
2. On next animation frame, calls `_processStreamChunk()`.
3. Creates an assistant message on first chunk (if none exists).
4. Updates the last assistant message's content.
5. Triggers scroll-to-bottom.

## Cancellation

### Client

`stopStreaming()` calls `LiteLLM.cancel_streaming(requestId)` via JRPC.

### Server

`cancel_streaming(request_id)` adds the ID to a thread-safe `_cancelled_requests` set. The streaming thread checks `_is_cancelled()` on each chunk iteration and breaks out of the loop.

After cancellation:

- Partial content is stored with `*[stopped]*` appended.
- `streamComplete` is sent with `cancelled: true`.
- No edit parsing or application occurs.

## Stream Completion

### Server (`_send_stream_complete`)

Sends the final result via `PromptView.streamComplete(request_id, result)` JRPC callback with a 5-second timeout.

### Result Object

| Field | Type | Description |
|-------|------|-------------|
| `response` | `str` | Full assistant response text |
| `summarized` | `bool` | Always `false` (compaction is post-response) |
| `token_usage` | `dict` | Token counts (see HUD section) |
| `edit_format` | `str` | Always `"edit_v3"` |
| `edit_blocks` | `list[dict]` | Parsed blocks (preview, max 100/200 chars) |
| `shell_commands` | `list[str]` | Detected shell command suggestions |
| `passed` | `list[tuple]` | Successfully applied edits `(path, old_preview, new_preview)` |
| `failed` | `list[tuple]` | Failed edits `(path, reason, "")` |
| `skipped` | `list[tuple]` | Skipped edits `(path, reason, "")` |
| `files_modified` | `list[str]` | Paths of modified files |
| `edit_results` | `list[dict]` | Detailed results with `{file_path, status, reason, estimated_line, anchor_preview, old_preview, new_preview}` |
| `content` | `dict` | Empty (new parser writes directly to disk) |
| `cancelled` | `bool?` | Present and true if request was cancelled |
| `error` | `str?` | Present if a fatal error occurred |
| `binary_files` | `list?` | Files rejected as binary |
| `invalid_files` | `list?` | Files not found |

### Client (`streamComplete`)

`StreamingMixin.streamComplete(requestId, result)`:

1. **Flush pending chunks** — Processes any coalesced chunk that hasn't rendered yet.
2. **Clear state** — Removes request from `_streamingRequests`, sets `isStreaming = false`, clears watchdog.
3. **Handle errors** — Auto-deselects binary/invalid files from the file picker, shows error message.
4. **Finalize message** — Marks last assistant message as `final: true`, attaches `editResults`.
5. **Build edit results** — Prefers `edit_results` format; falls back to `passed`/`failed` tuples.
6. **Refresh file tree** — If edits were applied, calls `loadFileTree()` and dispatches `files-edited` event.
7. **Show HUD** — If `token_usage` present, calls `_showHud(tokenUsage)`.
8. **Refresh viewers** — Triggers cache viewer and context viewer refresh.
9. **Focus textarea** — After 100ms delay, focuses the input for next message.

## Edit Parsing & Application

After streaming completes (and if not cancelled):

1. **Parse** — `EditParser.parse_response(full_content)` extracts v3 edit blocks.
2. **Detect shell** — `EditParser.detect_shell_suggestions(full_content)` finds shell command suggestions.
3. **Apply** — If blocks found and not `dry_run`, `EditParser.apply_edits(blocks, repo)` writes changes to disk and stages files.
4. **Invalidate cache** — Modified files have their symbol index cache invalidated so references rebuild on next request.

## Post-Response Processing

### Context Manager Update

After streaming and edit application:

1. `_context_manager.add_exchange(user_text, full_content)` — Adds the exchange to conversation history.
2. `_auto_save_symbol_map()` — Re-indexes modified files.

### Cache Stability Update (`_update_cache_stability`)

Updates the stability tracker to determine tier assignments for the next request:

1. **Phase 0: Stale detection** — Finds tracked items whose files no longer exist. Removes them and marks their tiers as broken.
2. **Phase 1: File/symbol churn** — Identifies which file and symbol items are in active context.
3. **Phase 2: Controlled history graduation** — Determines which history messages should graduate from active to L3:
   - **Piggyback** — If L3 is already being invalidated (by file/symbol changes), history graduates for free.
   - **Threshold** — If eligible history tokens exceed `cache_target_tokens`, oldest messages graduate.
   - **Otherwise** — History stays active to avoid unnecessary cache churn.
4. **Phase 3: Update tracker** — Calls `stability.update_after_response()` with active items list, content hash callback, and modified items.
5. **Phase 4: Log** — Prints promotions (📈) and demotions (📉) to the console.

### History Storage

Both messages are persisted to `HistoryStore`:

- **User message** — Stored at the start of `chat_streaming()` (before the background task).
- **Assistant message** — Stored after edit application with `files_modified` and `edit_results` metadata.

## Post-Response Compaction

After `streamComplete` is sent, `_run_post_response_compaction()` runs asynchronously:

1. **Check** — `_context_manager.should_compact()` tests if history exceeds `compaction_trigger_tokens`.
2. **Delay** — 500ms sleep to let the frontend process `streamComplete`.
3. **Notify start** — `compactionEvent('compaction_start')` shows a "🗜️ Compacting history..." message.
4. **Compact** — Runs `compact_history_if_needed_sync()` in an executor thread.
5. **Re-register** — Removes old `history:*` entries from stability tracker. New entries register on next request.
6. **Notify complete** — `compactionEvent('compaction_complete')` with case, token counts, and compacted messages.

### Client Compaction Handling (`compactionEvent`)

| Event Type | Behavior |
|------------|----------|
| `compaction_start` | Shows "Compacting..." message, sets `isCompacting = true` (disables input) |
| `compaction_complete` | Rebuilds `messageHistory` from compacted messages, shows summary notification, refreshes cache viewer |
| `compaction_error` | Updates the "Compacting..." message with error, re-enables input |

If `case === 'none'`, the "Compacting..." message is silently removed.

## Token Usage HUD

### Server-Side (`_print_streaming_hud`)

Prints a detailed terminal HUD after each response:

- Per-tier cache block visualization with content descriptions.
- Token breakdown: system, symbol map, files, history.
- Last request: prompt in, completion out, cache hit/write.
- Session totals.

Returns a breakdown dict attached to the `streamComplete` result.

### Client-Side (`_showHud` / `HudTemplate`)

Renders a floating overlay in the bottom-right of the prompt view:

- **Context Breakdown** — System, symbol map, files, history tokens with totals.
- **Cache Tiers** — Per-tier rows with contents (sys, legend, symbols, files, history) and token counts. Color-coded dots: ● cached, ○ uncached.
- **Cache hit percentage** — Prominent badge, color-coded (green >50%, amber >20%, red otherwise).
- **This Request** — Prompt and completion tokens with cache hit/write details.
- **History status** — Token count vs threshold with warning coloring at 80%/95%.
- **Tier Changes** — Promotions (📈) and demotions (📉) with item names.
- **Session Total** — Cumulative in/out/total.

Auto-hides after 8 seconds. Stays visible while mouse hovers (2-second timeout after mouse leaves).

## Error Handling

### File Validation

Before building messages, all file paths are validated:

- **Not found** — Collected into `invalid_files`.
- **Binary** — Collected into `binary_files`.
- If any problematic files, `streamComplete` is sent with an error. The client auto-deselects these files from the picker.

### Streaming Errors

- **Exception in `_stream_chat`** — Caught, traceback printed, `streamComplete` sent with `error` field.
- **Chunk send failure** — Logged but not fatal (chunks are fire-and-forget).
- **`streamComplete` timeout** — 5-second `asyncio.wait_for` timeout, logged as warning.

### Client Watchdog

A 5-minute timeout (`_startStreamingWatchdog`) forces recovery if `streamComplete` is never received:

- Sets `isStreaming = false`.
- Clears `_streamingRequests`.
- Shows a timeout error message.

## Conversation History Management

### Context Manager

`ContextManager` (`ac/context/manager.py`) is the single source of truth for conversation history:

- **`add_exchange(user, assistant)`** — Appends both messages to `_history`.
- **`get_history()`** — Returns a copy of the history list.
- **`clear_history()`** — Empties history and purges `history:*` entries from stability tracker.
- **`history_token_count()`** — Counts tokens in current history.
- **`max_history_tokens`** — Budget set to `max_input_tokens // 16`.

### History Store

`HistoryStore` (`ac/history/history_store.py`) provides persistent session-based storage:

- Messages written to `{repo}/.aicoder/history.jsonl`.
- Session IDs group related messages.
- Supports search, session listing, and session loading.

The `HistoryMixin` on `LiteLLM` provides convenience methods (`store_user_message`, `store_assistant_message`, `load_session_into_context`).

### Session Loading

`load_session_into_context(session_id)`:

1. Retrieves messages from `HistoryStore`.
2. Clears `ContextManager` history.
3. Populates `ContextManager` with loaded messages.
4. Sets `HistoryStore._current_session_id` so new messages continue in the loaded session.

On the client side, `handleLoadSession` clears `messageHistory`, adds each loaded message, scrolls to bottom, and refreshes the cache viewer.

## Dual History Stores

The system maintains two parallel history representations:

| Store | Purpose | Mutated By |
|-------|---------|------------|
| `ContextManager._history` | Token counting, message assembly, compaction | `add_exchange`, `set_history`, `clear_history` |
| `HistoryStore` (JSONL) | Persistence, session browsing, search | `store_user_message`, `store_assistant_message` |

Both are updated on each exchange. The `ContextManager` history drives what the LLM sees; the `HistoryStore` provides cross-session persistence and browsing.
