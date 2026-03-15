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
    ├─ Guard: reject if server still initializing (deferred init not complete)
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
    ├─ Initialize stability tracker from reference graph (if not already done at startup)
    ├─ Re-extract doc file structures if doc mode (mtime-based, instant; changed files queued for background enrichment)
    ├─ Detect & fetch URLs from prompt (up to 3 per message)
    │       ├─ Skip already-fetched URLs (check in-memory fetched dict)
    │       ├─ Notify client: compactionEvent with stage "url_fetch"
    │       ├─ Fetch, cache, and summarize each URL
    │       ├─ Notify client: compactionEvent with stage "url_ready"
    │       └─ Update URL context on context manager (joined as single string)
    ├─ Build and inject review context (if review mode active)
    ├─ Append system reminder to user prompt (from config `system_reminder.md`)
    ├─ Build tiered_content from stability tracker (→ prompt_assembly.md#tiered-assembly-data-flow)
    ├─ Assemble tiered message array with cache_control markers
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
    │       ├─ Auto-add not-in-context files to selected files, broadcast
    │       └─ Stash modified doc files for deferred enrichment (doc mode only)
    ├─ Persist assistant message
    ├─ Update cache stability (→ cache_tiering.md)
    │
    ▼
Send streamComplete → browser
    │
    ├─ await sleep(0) — flush WebSocket frame before GIL-heavy work
    ├─ Launch deferred doc enrichment (KeyBERT, background, non-blocking)
    │
    ▼
Post-response compaction (→ context_and_history.md)
```

### Assembly Mode

The streaming handler uses **tiered assembly** (`assemble_tiered_messages`) for LLM requests. This produces a message array with `cache_control` markers at tier boundaries, enabling provider-level prompt caching. The stability tracker's tier assignments drive content placement — see [Prompt Assembly — Tiered Assembly Data Flow](prompt_assembly.md#tiered-assembly-data-flow) for the complete data flow.

### Deferred Initialization Guard

The LLM service supports a **deferred initialization** mode (`deferred_init=True`) used by the startup sequence. When deferred, the service skips stability initialization at construction time. The `_init_complete` flag starts as `False` and gates `chat_streaming` — requests arriving before initialization completes are rejected with `"Server is still initializing — please wait a moment"`. The flag is set to `True` after `complete_deferred_init()` finishes.

**Session restore timing:** The last session is restored **eagerly** via `_restore_last_session()` — called in `main.py` *before* the WebSocket server starts accepting connections (`server.start()`). This ensures `get_current_state()` returns previous session messages as soon as the first browser connects, without waiting for the deferred initialization phase. `complete_deferred_init()` handles only symbol index wiring and does not re-run session restoration.

### Stability Tracker Initialization

The stability tracker is initialized **eagerly during the deferred startup phase** (`_try_initialize_stability` called from `main.py` after `complete_deferred_init`). This runs `index_repo()`, builds the reference graph, initializes tier assignments, seeds L0, and prints a startup HUD — with progress reported to the browser via `startupProgress`.

If eager initialization fails (e.g., no symbol index or repo), a **fallback lazy initialization** occurs on the first chat request inside `_stream_chat`. Once initialized (by either path), the `_stability_initialized` flag prevents re-initialization. The lazy path also seeds `system:prompt` into L0 after `index_repo()` to ensure the legend reflects final content.

## File Context Sync

Before loading files, the streaming handler compares the current FileContext against the incoming selected files list. Files present in the context but absent from the new selection are removed. This ensures deselected files don't linger in the in-memory context across requests.

```pseudo
current_context_files = context.file_context.get_files()
for path in current_context_files - selected_files:
    context.file_context.remove_file(path)
```

This is distinct from the cache tiering deselection cleanup (see [Cache Tiering — Item Removal](cache_tiering.md#item-removal)), which handles `file:*` entries in the stability tracker. Both operate on the same user action (unchecking a file) but manage different state stores.

User-excluded index files (see [Cache Tiering — User-Excluded Files](cache_tiering.md#user-excluded-files)) are merged into the `exclude_files` set for all map generation calls (`get_symbol_map`, `get_doc_map`) and for `_update_stability` active items computation. Excluded files have no presence in context — no full content, no index block, no tracker item.

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

```pseudo
StreamCompleteResult:
    response: string                    # Full assistant response text
    token_usage: TokenUsage             # Token counts for HUD display
    edit_blocks: [{file, preview}]?     # Parsed blocks (preview text)
    shell_commands: [string]?           # Detected shell suggestions
    passed: integer                     # Count of applied edits
    failed: integer                     # Count of failed edits
    skipped: integer                    # Count of skipped edits
    not_in_context: integer             # Count of not-in-context edits
    files_modified: [string]?           # Paths of changed files
    edit_results: [EditResult]?         # Detailed per-edit results
    files_auto_added: [string]?         # Files added to context for not-in-context edits
    cancelled: boolean?                 # Present if cancelled
    error: string?                      # Present if fatal error
    binary_files: [string]?             # Rejected binary files
    invalid_files: [string]?            # Not-found files

TokenUsage:
    prompt_tokens: integer
    completion_tokens: integer
    cache_read_tokens: integer?         # Provider-reported cached input
    cache_write_tokens: integer?        # Provider-reported cache write

EditResult:
    file: string                        # File path
    status: "applied" | "failed" | "skipped" | "validated" | "not_in_context"
    message: string?                    # Error/status message
    old_preview: string?                # Preview of old content
    new_preview: string?                # Preview of new content
```

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
10. Check for old-text-mismatch failures on in-context files — auto-populate retry prompt asking the LLM to re-read the file content and retry

## URL Fetch Notifications During Streaming

When URLs are detected and fetched during `_stream_chat`, progress is communicated to the browser via `compactionEvent` callbacks reusing the general-purpose progress channel:

| Stage | Message |
|-------|---------|
| `url_fetch` | `"Fetching {display_name}..."` — shown as a transient toast |
| `url_ready` | `"Fetched {display_name}"` — shown as a success toast |

Already-fetched URLs (present in the in-memory fetched dict) are skipped without notification. The URL context is then set on the context manager as a pre-joined string — the `\n---\n` joining happens in `format_url_context()` before being passed to `set_url_context()`.

## Post-Response Processing

### Stability Update

Build the active items list and run the tracker update:

```pseudo
active_items = {}

# 1. Selected files: full content hash
for path in selected_files:
    content = file_context.get_content(path)
    if content:
        active_items["file:" + path] = {
            "hash": sha256(content),
            "tokens": counter.count(content)
        }

# 2. Index entries for selected files (sym: in code mode, doc: in document mode)
#    In doc mode, get_file_block returns the current cached outline — enriched if
#    available, unenriched (structure-only) if enrichment is still pending.
for path in selected_files:
    prefix = "sym:" if mode == "code" else "doc:"
    block = index.get_file_block(path)  # symbol_index or doc_index per mode
    if block:
        active_items[prefix + path] = {
            "hash": sha256(block),
            "tokens": counter.count(block)
        }

# 3. Non-graduated history messages
for i, msg in enumerate(history):
    key = "history:" + str(i)
    if key not in any cached tier:
        content = msg["role"] + ":" + msg["content"]
        active_items[key] = {
            "hash": sha256(content),
            "tokens": counter.count_message(msg)
        }

# 4. Deselected file cleanup: remove file:* entries not in selected_files
for key in tracker.items:
    if key starts with "file:" and key.removeprefix("file:") not in selected_files:
        remove from tier, mark tier as broken

# 5. Run tracker update
stability_tracker.update(active_items, existing_files=repo.get_flat_file_list())
```

The tracker then:
1. Removes tracked items whose files no longer exist (Phase 0)
2. Processes active items — hash comparison, N increment/reset (Phase 1)
3. Determines graduates for L3 entry (Phase 2)
4. Runs cascade — promotion, anchoring, demotion (Phase 3)
5. Logs tier changes (📈 promotions, 📉 demotions) (Phase 4)

### Post-Response Compaction

Runs asynchronously after `streamComplete` with a 500ms delay:
1. Send `compaction_start` notification via `compactionEvent` callback
2. Check if history exceeds trigger
3. Run compaction if needed
4. Re-register history items in stability tracker
5. Send `compaction_complete` (or `compaction_error` on failure) notification

See [Context and History](context_and_history.md) for the compaction algorithm and frontend notification protocol.

### Deferred Doc Enrichment

When edit blocks modify document files in doc mode, their structures are re-extracted immediately (instant unenriched outlines) but keyword enrichment is **deferred** until after `streamComplete` is transmitted. This prevents KeyBERT — which is CPU-bound and holds the GIL for seconds per file — from blocking the WebSocket write that transitions the UI from stop to send mode.

#### Eager Model Pre-Initialization

The KeyBERT sentence-transformer model (~80–420 MB) is loaded lazily on first use. Loading holds the GIL for ~10 seconds (PyTorch weight materialization). To prevent this from blocking the mode-switch RPC response, the model is **eagerly pre-initialized** at the end of `_build_doc_index_background_silent` Phase 1, **before** the `doc_index_ready` event is sent to the frontend. This runs unconditionally (not gated on `needs_enrichment`) because even when all files are cached from disk, a future mode switch may discover mtime-changed files and queue them for enrichment. By the time `doc_index_ready` is sent and the user can click the doc mode button, the model is already loaded.

The enrichment queue is stashed in the result dict under `_deferred_enrichment`. This key is stripped via `result.pop` **before** `streamComplete` is sent — the queue contains `DocOutline` objects that aren't JSON-serializable and would silently kill the WebSocket write. After `streamComplete` and an `await asyncio.sleep(0)` to flush the WebSocket frame, the enrichment is launched via `asyncio.ensure_future`. Each file is enriched in the thread pool executor, with per-file progress events sent to the browser. The reference index is rebuilt after all files complete.

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
- get_current_state returns messages, selected_files, streaming_active, session_id, repo_name, cross_ref_enabled
- set_selected_files updates and returns copy; get_selected_files returns independent copy
- set_excluded_index_files stores exclusion set, removes tracker items, broadcasts filesChanged
- get_current_state includes excluded_index_files field

### Streaming Guards
- Concurrent stream rejected with error
- cancel_streaming succeeds for matching request_id; wrong id returns error

### History
- New session changes session_id and clears history

### Context Breakdown
- Returns breakdown with system/symbol_map/files/history categories
- Returns total_tokens, max_input_tokens, model, session_totals
- Session totals initially zero

### Mode Switch Effects
- Mode switch clears selected files and broadcasts filesChanged to frontend
- Cache tab and context tab listen for mode-changed and files-changed events, triggering refresh
- Stability tracker switches to mode-specific instance; _update_stability runs immediately
- Context breakdown reflects new mode's index (symbol map or doc map) after switch
- Cross-reference toggle resets to OFF on mode switch (cross-ref items from previous mode are removed)
- Mode switch is instant — structural re-extraction produces unenriched outlines immediately; changed files queued for background enrichment with non-blocking header progress bar
- Unenriched outlines are cached immediately so the doc map and cross-reference work without waiting for enrichment; enriched outlines replace cache entries as each file completes (no toast — progress shown in header bar only)
- Mode switch RPC is guarded by `_modeSwitchInFlight` flag — `_refreshMode` skips both backend polling and saved-preference auto-switching while a switch is in flight, preventing a race where `doc_index_ready` triggers `_refreshMode` before the switch RPC returns and the preference is saved

### Shell Command Detection
- Extracts from ```bash blocks, $ prefix, > prefix
- Comments skipped, non-command text returns empty

### Commit Message
- Uses the smaller model (`smaller_model` config, falling back to primary model)
- Commit prompt loaded from `commit.md` config file (not hardcoded)
- Empty/whitespace diff rejected
- Mocked LLM returns generated message
- Commit message generation uses `run_in_executor` to run the synchronous `litellm.completion` call on a thread pool, avoiding blocking the async event loop

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

### Cross-Reference Toggle
- `set_cross_reference(true)` runs initialization pass for the other index's items
- `set_cross_reference(false)` removes cross-ref items from tracker, marks affected tiers as broken
- `get_current_state` includes `cross_ref_enabled` field
- Cross-ref items use `sym:` or `doc:` prefix matching the cross-referenced index
- Both legends appear in L0 when cross-ref is enabled
- Mode switch resets cross-ref to disabled
- Token usage toast shown on activation indicating additional token cost

### Ambiguous Anchor Retry
- Failed edits with "Ambiguous anchor" in message trigger auto-populated retry prompt in chat input
- Prompt lists each ambiguous failure with file path and error detail
- Prompt is not auto-sent — user reviews and sends manually
- Edit summary banner notes that a retry prompt has been prepared
- Non-ambiguous failures (anchor not found, old text mismatch) do not trigger the retry prompt