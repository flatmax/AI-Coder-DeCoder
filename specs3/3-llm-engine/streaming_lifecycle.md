# Streaming Lifecycle

## Overview

The full lifecycle of a user message: UI submission → file validation → message assembly → LLM streaming → edit parsing → stability tracking → post-response compaction. For message array structure, see [Prompt Assembly](prompt_assembly.md).

## Request Flow

```
User clicks Send
    │
    ├─ Show user message in UI immediately
    ├─ Generate request ID for callback correlation
    ├─ Start watchdog timer (5 min safety timeout)
    │
    ▼
Server: LLMService.chat_streaming(request_id, message, files, images)
    │
    ├─ Guard: reject if another stream is active
    ├─ Persist user message to history store
    ├─ Launch background streaming task
    ├─ Return immediately: {status: "started"}
    │
    ▼
Background task: _stream_chat
    │
    ├─ Remove deselected files from context
    ├─ Validate files (reject binary/missing)
    ├─ Load files into context
    ├─ Detect & fetch URLs from prompt (up to 3 per message)
    │       ├─ Skip already-fetched URLs (check in-memory fetched dict)
    │       ├─ Notify client: compactionEvent with stage "url_fetch"
    │       ├─ Fetch, cache, and summarize each URL
    │       ├─ Notify client: compactionEvent with stage "url_ready"
    │       └─ Update URL context on context manager (joined as single string)
    ├─ Build and inject review context (if review mode active)
    ├─ Assemble message array (non-tiered, no cache_control markers)
    ├─ Run LLM completion (threaded, streaming)
    │       │
    │       ├─ streamChunk callbacks → browser
    │       └─ return (full_content, was_cancelled)
    │
    ├─ Add exchange to context manager
    ├─ Save symbol map to .ac-dc/
    ├─ Print terminal HUD
    ├─ Parse & apply edit blocks (→ edit_protocol.md; skipped in review mode)
    │       ├─ Separate: in-context vs not-in-context files
    │       ├─ Apply in-context edits normally
    │       ├─ Mark not-in-context edits as NOT_IN_CONTEXT
    │       └─ Auto-add not-in-context files to selected files, broadcast
    ├─ Persist assistant message
    ├─ Update cache stability (→ cache_tiering.md)
    │
    ▼
Send streamComplete → browser
    │
    ▼
Post-response compaction (→ context_and_history.md)
```

### Assembly Mode

The current implementation uses **non-tiered assembly** (`assemble_messages`) for all LLM requests. This produces a flat message array without `cache_control` markers. The stability tracker still runs (tracking N-values, graduation, cascade) and its tier data is used for the terminal HUD and frontend context/cache viewers — but the actual LLM request does not use tiered message layout or provider cache breakpoints.

The tiered assembly path (`assemble_tiered_messages`) is implemented in `context.py` but is not called from the streaming handler. Enabling it requires building a `tiered_content` dict from the stability tracker's tier assignments — mapping each tier's items to their symbol blocks, file contents, and history messages — and passing it to `assemble_tiered_messages`. This data flow (tracker → content gathering → tiered assembly) is the missing integration piece.

## File Context Sync

Before loading files, the streaming handler compares the current FileContext against the incoming selected files list. Files present in the context but absent from the new selection are removed. This ensures deselected files don't linger in the in-memory context across requests.

```pseudo
current_context_files = context.file_context.get_files()
for path in current_context_files - selected_files:
    context.file_context.remove_file(path)
```

This is distinct from the cache tiering deselection cleanup (see [Cache Tiering — Item Removal](cache_tiering.md#item-removal)), which handles `file:*` entries in the stability tracker. Both operate on the same user action (unchecking a file) but manage different state stores.

## Client-Side Initiation

1. Guard — skip if empty input
2. Reset scroll — re-enable auto-scroll
3. Build URL context — get included fetched URLs, append to LLM message (not shown in UI)
4. Show user message immediately
5. Clear input, images, detected URLs
6. Generate request ID: `{epoch_ms}-{random_alphanumeric}`
7. Track request — store in pending requests map
8. Set streaming state (disable input, start watchdog)
9. RPC call: `LLMService.chat_streaming(request_id, message, files, images)`

## LLM Streaming (Worker Thread)

Runs in a thread pool to avoid blocking the async event loop:

1. Call LLM provider with `stream=True` and `stream_options: {"include_usage": true}`
2. For each chunk: accumulate text, fire chunk callback (`AcApp.streamChunk`)
3. Check cancellation flag each iteration
4. Track token usage from final chunk
5. Return `(full_content, was_cancelled)`

### Chunk Delivery

Each chunk carries the **full accumulated content** (not deltas). Dropped or reordered chunks are harmless — latest content wins. Chunks are fire-and-forget RPC calls. Server→browser calls use `ClassName.method` format (e.g., `AcApp.streamChunk`), matching the class name registered via `addClass` on the browser side.

### Client Chunk Processing

Coalesced per animation frame:
1. Store pending chunk
2. On next frame: create assistant card (first chunk) or update content
3. Trigger scroll-to-bottom (respecting user scroll override)

## Cancellation

During streaming, the Send button transforms into a **Stop button** (⏹). Clicking calls `LLMService.cancel_streaming(request_id)`. The server adds the request ID to a cancelled set; the streaming thread checks each iteration and breaks out. Partial content stored with `[stopped]` marker, `streamComplete` sent with `cancelled: true`.

## Stream Completion

### Result Object

| Field | Description |
|-------|-------------|
| `response` | Full assistant response text |
| `token_usage` | Token counts for HUD display |
| `edit_blocks` | Parsed blocks (preview text) |
| `shell_commands` | Detected shell suggestions |
| `passed/failed/skipped` | Edit application results |
| `files_modified` | Paths of changed files |
| `edit_results` | Detailed per-edit results |
| `files_auto_added` | Files added to context for not-in-context edits |
| `cancelled` | Present if cancelled |
| `error` | Present if fatal error |
| `binary_files` | Rejected binary files |
| `invalid_files` | Not-found files |

### Client Processing

1. Flush pending chunks (apply any buffered `_pendingChunk`)
2. Clear streaming state (`streamingActive = false`, `_currentRequestId = null`)
3. Handle errors — show error as assistant message with `**Error:**` prefix
4. Finalize message — build `editResults` map from `edit_results` array (keyed by file path, with status and message), attach aggregate counts (`passed`, `failed`, `skipped`, `not_in_context`, `files_auto_added`) to the message object
5. Clear `_streamingContent` and `_pendingChunk`
6. Scroll to bottom if auto-scroll engaged (double-rAF via `updateComplete`)
7. Refresh file tree if `files_modified` is non-empty — dispatch `files-modified` event and reload repo file list
8. Refresh repo file list (`get_flat_file_list`) for file mention detection of newly created files
9. Check for ambiguous anchor failures — auto-populate retry prompt in chat input (see [Edit Protocol — Ambiguous Anchor Retry Prompt](edit_protocol.md#ambiguous-anchor-retry-prompt))

## URL Fetch Notifications During Streaming

When URLs are detected and fetched during `_stream_chat`, progress is communicated to the browser via `compactionEvent` callbacks reusing the general-purpose progress channel:

| Stage | Message |
|-------|---------|
| `url_fetch` | `"Fetching {display_name}..."` — shown as a transient toast |
| `url_ready` | `"Fetched {display_name}"` — shown as a success toast |

Already-fetched URLs (present in the in-memory fetched dict) are skipped without notification. The URL context is then set on the context manager as a pre-joined string — the `\n---\n` joining happens in `format_url_context()` before being passed to `set_url_context()`.

## Post-Response Processing

### Stability Update

1. Remove tracked items whose files no longer exist
2. Process active context items (hash, N increment)
3. Controlled history graduation
4. Run cascade (→ [Cache Tiering](cache_tiering.md))
5. Log tier changes (📈 promotions, 📉 demotions)

### Post-Response Compaction

Runs asynchronously after `streamComplete`:
1. Check if history exceeds trigger
2. Run compaction if needed
3. Re-register history items in stability tracker (done inside `compact_history_if_needed`)

**Note:** The current implementation does **not** include the 500ms delay or frontend notifications (`compaction_start`, `compaction_complete`, `compaction_error`). The compaction runs silently — `compact_history_if_needed()` is called directly after `streamComplete` without notifying the browser. The `compactionEvent` callback infrastructure exists (used for URL fetch notifications during streaming) and could be reused, but this wiring is not yet implemented.

See [Context and History](context_and_history.md) for the compaction algorithm.

## Token Usage Extraction

Token usage is extracted from the LLM provider's response. Different providers report cache tokens under different field names:

| Provider | Cache Read Field | Cache Write Field |
|----------|-----------------|-------------------|
| Anthropic | `cache_read_input_tokens` | `cache_creation_input_tokens` |
| Bedrock | `prompt_tokens_details.cached_tokens` | `cache_creation_input_tokens` |
| OpenAI | `prompt_tokens_details.cached_tokens` | — |
| litellm unified | `cache_read_tokens` | `cache_creation_tokens` |

The extraction uses a dual-mode getter (attribute + key access) with fallback chains. Stream-level usage is captured from any chunk with it (typically the final chunk). Response-level usage merged as fallback. Completion tokens are estimated from content length (~4 chars/token) only if the provider reported no completion count.

## Terminal HUD

Three reports printed after each response. See [Viewers and HUD](../5-webapp/viewers_and_hud.md#terminal-hud) for full format details.

### Cache Blocks (Boxed)
```
╭─ Cache Blocks ────────────────────────────╮
│ L0         (12+)    1,622 tokens [cached] │
│ L1          (9+)   11,137 tokens [cached] │
│ active             19,643 tokens          │
├───────────────────────────────────────────┤
│ Total: 32,402 | Cache hit: 39%           │
╰───────────────────────────────────────────╯
```

### Token Usage
```
Model: bedrock/anthropic.claude-sonnet-4-20250514
System:         1,622
Symbol Map:    34,355
Files:              0
History:       21,532
Total:         57,509 / 1,000,000
Last request:  74,708 in, 34 out
Cache:         read: 21,640, write: 48,070
Session total: 182,756
```

### Tier Changes
```
📈 L3 → L2: symbol:src/ac_dc/context.py
📉 L2 → active: symbol:src/ac_dc/repo.py
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Invalid/binary files | streamComplete with error, client auto-deselects |
| Concurrent stream | Rejected immediately |
| Streaming exception | Caught, traceback printed, streamComplete with error |
| Client watchdog | 5-minute timeout forces recovery |
| History token emergency | Oldest messages truncated if > 2× compaction trigger |
| Budget exceeded | Largest files shed with warning |

## Testing

### State Management
- get_current_state returns messages, selected_files, streaming_active, session_id, repo_name
- set_selected_files updates and returns copy; get_selected_files returns independent copy

### Streaming Guards
- Concurrent stream rejected with error
- cancel_streaming succeeds for matching request_id; wrong id returns error

### History
- New session changes session_id and clears history

### Context Breakdown
- Returns breakdown with system/symbol_map/files/history categories
- Returns total_tokens, max_input_tokens, model, session_totals
- Session totals initially zero

### Shell Command Detection
- Extracts from ```bash blocks, $ prefix, > prefix
- Comments skipped, non-command text returns empty

### Commit Message
- Uses the smaller model (`smaller_model` config, falling back to primary model)
- Empty/whitespace diff rejected
- Mocked LLM returns generated message
- **Note:** Commit message generation is a synchronous (non-streaming) `litellm.completion` call. Unlike `chat_streaming` which uses `run_in_executor` to avoid blocking the event loop, `generate_commit_message` runs synchronously on the calling coroutine. This may briefly block the server during generation. A future improvement could move this to a thread executor.

### Tiered Content Deduplication
- File in cached tier excludes its symbol block
- Selected non-graduated file excluded from symbol blocks
- Graduated selected file gets file content, not symbol block
- Unselected file without cached content gets symbol block only

### Not-In-Context Edit Handling
- Edit blocks for unselected files get NOT_IN_CONTEXT status without application attempt
- In-context edits in the same response are applied normally
- Create blocks bypass the context check (always attempted)
- Auto-added files broadcast via filesChanged callback
- files_auto_added in streamComplete lists paths that were auto-added
- Review mode skips all edit application (existing behavior unchanged)

### Ambiguous Anchor Retry
- Failed edits with "Ambiguous anchor" in message trigger auto-populated retry prompt in chat input
- Prompt lists each ambiguous failure with file path and error detail
- Prompt is not auto-sent — user reviews and sends manually
- Edit summary banner notes that a retry prompt has been prepared
- Non-ambiguous failures (anchor not found, old text mismatch) do not trigger the retry prompt