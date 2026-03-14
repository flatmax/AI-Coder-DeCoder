# Context and History

## Overview

The context engine manages conversation history, token budgets, file context, and coordinates prompt assembly. It is the central state holder for an LLM session. This spec also covers persistent history storage and the compaction system that keeps history within token budgets.

## Architecture

```
┌──────────────────────────────────────────────┐
│              Context Manager                  │
│                                               │
│  ┌──────────┐ ┌────────────┐ ┌─────────────┐ │
│  │ History   │ │ Token      │ │ File        │ │
│  │ (list)    │ │ Counter    │ │ Context     │ │
│  └──────────┘ └────────────┘ └─────────────┘ │
│  ┌──────────────────┐ ┌──────────────────────┐│
│  │Stability Tracker  │ │ History Compactor    ││
│  │(→ cache_tiering)  │ │ (optional)           ││
│  └──────────────────┘ └──────────────────────┘│
└──────────────────────────────────────────────┘
```

## Initialization

```pseudo
ContextManager(
    model_name,
    repo_root?,
    cache_target_tokens,
    compaction_config?
)
```

Creates:
1. **Token Counter** — model-aware token counting
2. **File Context** — tracks files included in conversation
3. **Stability Tracker** — cache tier assignments (if repo_root provided; see [Cache and Assembly](cache_and_assembly.md))
4. **History Compactor** — optional, requires compaction config with detection model

---

## Conversation History (In-Memory)

An in-memory list of `{role, content}` dicts. This is the **working copy** for assembling LLM requests — separate from persistent storage.

| Operation | Description |
|-----------|-------------|
| `add_message(role, content)` | Append single message |
| `add_exchange(user, assistant)` | Append pair atomically |
| `get_history()` | Return a copy |
| `set_history(messages)` | Replace entirely (after compaction or session load) |
| `clear_history()` | Empty list + purge history from stability tracker |
| `reregister_history_items()` | Purge stability entries without clearing history |
| `history_token_count()` | Token count of current history |

---

## File Context

Tracks files included in the conversation with their contents.

| Method | Description |
|--------|-------------|
| `add_file(path, content?)` | Add file; reads from disk if content not provided |
| `remove_file(path)` | Remove from context |
| `get_files()` | List paths in context |
| `get_content(path)` | Get specific file content |
| `has_file(path)` | Check membership |
| `clear()` | Remove all |
| `format_for_prompt()` | Format all as fenced code blocks |
| `count_tokens(counter)` | Total tokens across all files |
| `get_tokens_by_file(counter)` | Per-file token counts |

Paths are normalized relative to repo root. Binary files are rejected. Path traversal (`../`) is blocked.

### Path Normalization

`FileContext` normalizes paths by:
1. Replacing backslashes with forward slashes
2. Stripping leading/trailing slashes
3. Rejecting paths containing `..` (simple substring check)

For full path canonicalization and repo-root validation, the `Repo` layer uses `Path.resolve()`. The `FileContext` normalization is sufficient for its purpose (consistent key lookup) since all paths entering `FileContext` have already been validated by the `Repo` layer.

---

## Token Counting

Wraps the LLM provider's tokenizer:
- **Model-aware counting** — selects correct tokenizer for the configured model
- **Fallback** — estimates ~4 characters per token on any error
- **Multiple input types** — strings, message dicts, or lists
- **Model info** — `max_input_tokens`, `max_output_tokens`, `max_history_tokens` (= max_input / 16)

### Token Budget Reporting

```pseudo
get_token_budget() -> {
    history_tokens,
    max_history_tokens,
    max_input_tokens,
    remaining,
    needs_summary        // delegates to should_compact()
}
```

---

## Token Budget Enforcement

Three layers of defense:

### Layer 1: Compaction (Normal)
History compaction triggers when tokens exceed `compaction_trigger_tokens`. See Compaction section below.

### Layer 2: Emergency Truncation
If compaction fails AND history exceeds `2 × compaction_trigger_tokens`, oldest messages are dropped without summarization. Called before message assembly in the streaming handler as a safety net.

### Layer 3: Pre-Request Shedding
Before assembling the prompt, if total estimated tokens exceed 90% of `max_input_tokens`, files are dropped from context (largest first) with a warning in chat.

---

## Persistent History Store

### Storage

Conversation history is persisted per-repository in an append-only JSONL file: `{repo_root}/.ac-dc/history.jsonl`.

Lines that fail JSON parsing on load are skipped with a warning (handles crash during write).

### Message Schema

```pseudo
HistoryMessage:
    id: string               // "{epoch_ms}-{uuid8}"
    session_id: string
    timestamp: ISO 8601 UTC
    role: "user" | "assistant"
    content: string
    image_refs: string[]?    // Filenames in .ac-dc/images/
    images: integer?         // DEPRECATED — legacy count field
    files: string[]?         // Files in context (user messages)
    files_modified: string[]? // Files changed (assistant messages)
    edit_results: object[]?
```

### Sessions

A session groups related messages by `session_id` (format: `sess_{epoch_ms}_{uuid6}`).

### Session Summary

```pseudo
SessionSummary:
    session_id: string
    timestamp: string
    message_count: integer
    preview: string          // First ~100 chars of first message
    first_role: string
```

This is the schema returned by `list_sessions()` for each session.

| Operation | Behavior |
|-----------|----------|
| New session | Generated on first message or explicit creation |
| Load session | Sets as current; subsequent messages continue in it |
| Clear | Creates a fresh session ID |

### RPC Methods

| Method | Description |
|--------|-------------|
| `LLMService.history_search(query, role?, limit?)` | Case-insensitive substring search |
| `LLMService.history_get_session(session_id)` | All messages from a session |
| `LLMService.history_list_sessions(limit?)` | Recent sessions, newest first |
| `LLMService.history_new_session()` | Start new session |
| `LLMService.load_session_into_context(session_id)` | Load into active context |
| `LLMService.get_history_status()` | Token counts, compaction status, session info for history bar |

### Dual Stores

| Store | Purpose |
|-------|---------|
| Context Manager history | Token counting, message assembly, compaction (in-memory) |
| Persistent store (JSONL) | Cross-session persistence, browsing, search (append-only file) |

Both are updated on each exchange.

### Retrieval Path Asymmetry

The two retrieval methods return different data shapes:

| Method | Returns | Used For |
|--------|---------|----------|
| `get_session_messages_for_context` | `[{role, content}]` only | Loading into context manager |
| `get_session_messages` / `history_get_session` | Full message dicts with all metadata | History browser display |

The context retrieval path strips all metadata (`files`, `files_modified`, `edit_results`, `image_refs`) and returns only `{role, content}` plus a reconstructed `_images` field. This means metadata like which files were in context or which edits were applied is not available after a session reload — it exists only in the persistent JSONL records.

### Message Persistence Ordering

The user message is persisted to the JSONL store **before** the LLM call starts, while the assistant message is persisted **after** the full response completes. If the LLM call fails, is cancelled, or the server crashes mid-stream, the JSONL contains an orphaned user message with no corresponding assistant response. This is by design (the user's intent is worth preserving) but means session message counts may be odd and the last message in a crashed session may be a user message with no reply.

### Search Fallback

`history_search` tries the persistent store first. If the persistent store returns no results (or is unavailable), the search falls back to case-insensitive substring matching against the in-memory context history. This ensures search works even if the JSONL file is inaccessible.

---

## History Compaction

### Overview

Compaction runs **after** the assistant response has been delivered — it is background housekeeping. The compacted history takes effect on the **next** request.

```
Response delivered → compaction check
    → if history tokens > trigger:
          detect topic boundary (LLM call)
          apply truncation or summarization
          replace in-memory history
          re-register history items in stability tracker
```

Compaction runs after a 500ms pause following `streamComplete`. Frontend notifications are sent via the `compactionEvent` callback (see [Frontend Notification](#frontend-notification) below).

### Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | true | Master switch |
| `compaction_trigger_tokens` | 24000 | Triggers compaction |
| `verbatim_window_tokens` | 4000 | Recent tokens kept unchanged |
| `summary_budget_tokens` | 500 | Max tokens for summary |
| `min_verbatim_exchanges` | 2 | Minimum recent exchanges always kept |

### Two-Threshold Design

```
oldest messages ◄──────────────────────────────► newest

│◄── summarizable zone ──►│◄── verbatim window ──►│
                           ▲ verbatim_start_idx
```

### Topic Boundary Detection

A smaller/cheaper LLM analyzes the conversation to find where the topic shifted.

**Input:** Messages formatted as indexed blocks (truncated to ~1000 chars, at most 50 messages).

**What counts as a boundary:**
- Explicit task switches ("now let's work on...")
- Shift to different file/component
- Change in work type (debugging → feature development)
- Context resets ("forget that", "let's try something else")

**Output:**
```pseudo
TopicBoundary:
    boundary_index: integer?   // First message of NEW topic (null = no boundary)
    boundary_reason: string
    confidence: float          // 0.0–1.0
    summary: string
```

On failure or unparseable output: safe defaults (null boundary, 0 confidence).

### Compaction Cases

| Case | When | Action |
|------|------|--------|
| Truncate | Boundary in/after verbatim window, confidence ≥ 0.5 | Discard everything before boundary |
| Summarize | Boundary before verbatim window, or low confidence, or no boundary | Replace pre-verbatim messages with summary |
| None | Below trigger or empty | No changes |

After compaction, if result contains fewer user messages than `min_verbatim_exchanges`, earlier messages are prepended.

### Integration with Cache Stability

After compaction, all `history:*` entries are purged from the stability tracker. New entries register on the next request as fresh active items (N = 0). This causes a one-time cache miss — the reduced message count means faster re-promotion.

### Frontend Notification

Compaction progress is communicated via the `compactionEvent` callback (the same channel used for URL fetch notifications during streaming):

| Event | Behavior |
|-------|----------|
| `compaction_start` | Show "Compacting..." message, disable input |
| `compaction_complete` | Rebuild message display from compacted messages |
| `compaction_error` | Show error, re-enable input |
| `case: "none"` | Remove "Compacting..." silently |

The backend wraps `compact_history_if_needed()` with these notifications, sent via `_event_callback("compactionEvent", request_id, event_dict)`. A 500ms delay before `compaction_start` prevents flicker for fast compactions.

---

## Testing

### FileContext
- Add with explicit content, add from disk, missing file returns false
- Binary file rejected, path traversal blocked
- Remove, get_files sorted, clear
- format_for_prompt includes path and fenced content

### ContextManager
- add_message, add_exchange, get_history returns copy (mutation-safe)
- set_history replaces, clear_history empties
- history_token_count > 0 for non-empty history
- Token budget has required keys, remaining > 0
- should_compact false when disabled or below trigger
- Compaction status returns enabled/trigger/percent

### Prompt Assembly (non-tiered)
- System message first with system prompt content
- Symbol map appended to system message under Repository Structure header
- File tree as user/assistant pair with Repository Files header
- URL context as user/assistant pair with acknowledgement
- Active files as user/assistant pair with Working Files header
- History messages appear before current user prompt
- Images produce multimodal content blocks; no images produces string
- estimate_prompt_tokens > 0

### Prompt Assembly (tiered)
- Graduated files excluded from active files section
- All files graduated → no Working Files section
- L0 system message has cache_control when no L0 history
- L0 with history: cache_control on last history message, not system
- L1 block produces user/assistant pair containing symbol content
- Empty tiers produce no messages
- File tree, URL context, active files included at correct positions
- Active history appears after active files, before user prompt
- Multi-tier message order: L0 < L1 < L3 < tree < active < prompt
- Each non-empty cached tier has a cache_control breakpoint

### Budget Enforcement
- shed_files_if_needed removes largest files when budget exceeded; no-op when under budget
- emergency_truncate reduces message count, preserves user/assistant pairs

### History Store
- Append and retrieve messages by session
- Session grouping isolates messages
- list_sessions returns all sessions with preview and message_count; respects limit
- Search: case-insensitive substring, role filter, empty query returns empty
- Persistence: new HistoryStore instance reads previously written messages
- Corrupt JSONL line skipped (partial write recovery)
- Message has required fields (id, timestamp, session_id, files, images)
- get_session_messages_for_context returns only role/content (no metadata)
- Empty/nonexistent session returns empty list

### Message ID Generation
- Format: `{epoch_ms}-{uuid8}`; session format: `sess_{epoch_ms}_{uuid6}`
- 100 generated IDs are unique

### Topic Detector
- Empty messages and no-model return SAFE_BOUNDARY
- Successful LLM detection returns boundary_index and confidence
- LLM failure returns SAFE_BOUNDARY
- Format: messages formatted as `[N] ROLE: content`, truncated at max_chars
- Parse: clean JSON, null boundary, markdown-fenced JSON, partial regex fallback, completely invalid returns null/0.0

### History Compactor
- Below trigger: should_compact false
- Above trigger: should_compact true, compact returns truncate or summarize
- Empty messages: case = none
- apply_compaction reduces message count
- apply_compaction with case=none returns messages unchanged
- min_verbatim_exchanges preserved after compaction
- Disabled compactor never triggers
- Truncate and summarize apply correctly; summary text produces History Summary message
- High-confidence boundary near verbatim window → truncate
- Low-confidence boundary → summarize

### Context Manager Integration
- init_compactor creates compactor
- compact_history_if_needed returns None below trigger
- Compaction purges stability history items
- should_compact works with and without compactor instance

---

## Lifecycle

### Session Start
1. Create Context Manager with model, repo root, config
2. **Eager stability initialization** — if the symbol index and repo are available at construction time, the stability tracker runs `index_repo()`, builds the reference graph, initializes tier assignments (including L0 seeding), measures real token counts for all tier items, and prints a startup HUD showing per-tier item counts. This means cache tiers are primed before the first client connects or the first chat request. When using deferred initialization (`deferred_init=True`), `complete_deferred_init()` calls `_try_initialize_stability()` once the symbol index is available — ensuring the cache tab shows populated tiers from the first page load, not only after the first chat message. If initialization fails, it falls back to lazy initialization on the first request.
3. **Auto-restore last session** — on LLM service initialization, the most recent session is loaded from the persistent history store into the context manager. This means `get_current_state()` returns messages from the previous session immediately, allowing the browser to resume where the user left off after a server restart. If no sessions exist or loading fails, history starts empty.

### During Conversation
1. Streaming handler calls `add_message()` for each exchange
2. Stability tracker updated with current items after each response
3. Post-response compaction runs if threshold exceeded

### Session Reset
Clear history, purge stability tracker history entries, start new persistent session. The frontend dispatches a `session-loaded` event (with empty messages) so the dialog refreshes its history bar to reflect the cleared token count.

### Loading a Previous Session
1. Clear current history
2. Read messages from persistent store (reconstruct images from `image_refs`)
3. Add each to context manager
4. Set persistent store's session ID to continue in loaded session

The return value includes both the session metadata and a `messages` array with reconstructed `images` fields (data URIs rebuilt from `image_refs`). This allows the frontend to display image thumbnails in loaded sessions without a separate fetch.

The history store reconstructs images into an `images` key on message dicts. Both `load_session_into_context` and `history_get_session` return messages with the `images` key containing reconstructed data URI arrays.

### Auto-Restore on Startup

On LLM service initialization (before any client connects), the server automatically loads the most recent session from the persistent store into the context manager:

1. Query `list_sessions(limit=1)` for the newest session
2. Load its messages via `get_session_messages_for_context`
3. Add each message to the context manager
4. Set the current session ID to the loaded session's ID

This means the first `get_current_state()` call from a connecting browser returns the previous session's messages, providing seamless resumption after server restart. If no sessions exist or loading fails, the server starts with an empty history.

**File selection not restored:** Auto-restore recovers conversation messages but does not restore file selection. The browser receives an empty `selected_files` list from `get_current_state()`. Users must re-select files after a server restart.

---

## Prompt Assembly

### Overview

This section is the **single source of truth** for how LLM messages are assembled. All prompt content — system prompts, symbol map, files, history, URLs — is organized into a structured message array with stability-based cache tier placement.

The assembly system supports two modes:
- **Tiered assembly** (`assemble_tiered_messages`) — organizes content into L0–L3 cached blocks with `cache_control` markers. This is the primary mode.
- **Flat assembly** (`assemble_messages`) — produces a flat message array without cache breakpoints. Used as a fallback or during development.

The streaming handler uses tiered assembly, passing a `tiered_content` dict built from the stability tracker's tier assignments (see [Cache and Assembly — Tiered Assembly Data Flow](cache_and_assembly.md#tiered-assembly-data-flow)).

### System Prompt

Two files concatenated with `\n\n`:
1. **Main prompt** (`system.md`) — LLM role, symbol map navigation, edit protocol, workflow
2. **Extra prompt** (`system_extra.md`, optional) — project-specific instructions

System prompt assembly concatenates `system.md` + `system_extra.md` at assembly time (each request). This means edits to either file take effect on the next LLM request without restart. The `system_extra.md` file is optional — if missing, only `system.md` is used.

### Content Structure

The main prompt covers:
1. **Role** — Expert coding agent with symbol map navigation
2. **Symbol Map** — How to read compact notation
3. **Edit Protocol** — EDIT/REPLACE block format with rules
4. **Workflow** — Query → Search Map → Trace deps → Request files → Read → Edit
5. **Failure Recovery** — Steps for retrying failed edits
6. **Context Trust** — Only trust file content shown in context

### Other Prompts

| Prompt | Used For |
|--------|----------|
| **Commit message prompt** (`commit.md`) | Loaded from config for generating git commit messages. Role: expert software engineer. Rules: conventional commit style with type prefix, imperative mood, 50-char subject line limit, 72-char body wrap, no commentary — output the commit message only |
| **Compaction skill prompt** | Loaded by topic detector for history compaction LLM calls |
| **System reminder** (`system_reminder.md`) | Loaded from config and appended to each user prompt. Edit-format reinforcement rules (close blocks properly, copy text exactly, use unique anchors, keep blocks small, no placeholders). Sits at the end of context, closest to where the model generates |

### Message Array Structure

Content is organized into 5 stability tiers (see [Cache and Assembly](cache_and_assembly.md)):

```
[0]  system    L0: system prompt + legend + L0 symbols + L0 files
[1+] L0 history (native user/assistant pairs)
     ── cache breakpoint ──
[N]  user      L1: symbols + files
[N+1] assistant "Ok."
[N+] L1 history pairs
     ── cache breakpoint ──
     L2 block (same structure)
     ── cache breakpoint ──
     L3 block (same structure)
     ── cache breakpoint ──
[M]  user      File tree
[M+1] assistant "Ok."
[M+2] user     URL context
[M+3] assistant "Ok, I've reviewed the URL content."
[M+4] user     Review context (if review mode active)
[M+5] assistant "Ok, I've reviewed the code changes."
[M+6] user     Active files ("Working Files")
[M+7] assistant "Ok."
[M+] Active history (native pairs)
[last] user    Current prompt (with optional images)
```

Empty tiers are skipped entirely.

### Header Constants

| Constant | Value |
|----------|-------|
| `REPO_MAP_HEADER` | `# Repository Structure\n\n...` |
| `FILE_TREE_HEADER` | `# Repository Files\n\n...` |
| `URL_CONTEXT_HEADER` | `# URL Context\n\n...` |
| `FILES_ACTIVE_HEADER` | `# Working Files\n\n...` |
| `FILES_L0_HEADER` | `# Reference Files (Stable)\n\n...` |
| `FILES_L1_HEADER` | `# Reference Files\n\n...` |
| `FILES_L2_HEADER` | `# Reference Files (L2)\n\n...` |
| `FILES_L3_HEADER` | `# Reference Files (L3)\n\n...` |
| `TIER_SYMBOLS_HEADER` | `# Repository Structure (continued)\n\n` |
| `REVIEW_CONTEXT_HEADER` | `# Code Review Context\n\n` |
| `DOC_MAP_HEADER` | `# Document Structure\n\nBelow is an outline map of documentation files...\n\n` |

### Cache Control Placement

| Scenario | Placement |
|----------|-----------|
| L0 without history | `cache_control` on system message (structured content format) |
| L0 with history | `cache_control` on last L0 history message |
| L1/L2/L3 | `cache_control` on last message in tier's sequence |

The `cache_control` marker wraps content as:
```pseudo
[{type: "text", text: <content>, cache_control: {type: "ephemeral"}}]
```

### File Content Formatting

Files formatted as fenced code blocks with **no language tags**:

```
path/to/file.py
```​
<full file content>
```​

path/to/other.py
```​
<full file content>
```​
```

Files joined with `\n\n`. Sections with no loadable content are omitted.

### System Reminder

The system reminder (`system_reminder.md`) is appended to the user's message text before assembly, so it appears at the very end of context — closest to where the model generates its response. This is an edit-format reinforcement that reminds the LLM of critical edit block rules on every request. Loaded via `config.get_system_reminder()` which prepends `\n\n` to the file content.

### Current User Message

```pseudo
// Without images:
{"role": "user", "content": user_prompt + system_reminder}

// With images:
{"role": "user", "content": [
    {"type": "text", "text": user_prompt},
    {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
]}
```

---

## Streaming Lifecycle

### Overview

The full lifecycle of a user message: UI submission → file validation → message assembly → LLM streaming → edit parsing → stability tracking → post-response compaction.

### Request Flow

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
    ├─ Build tiered_content from stability tracker (→ cache_and_assembly.md#tiered-assembly-data-flow)
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
    ├─ Update cache stability (→ cache_and_assembly.md)
    │
    ▼
Send streamComplete → browser
    │
    ├─ await sleep(0) — flush WebSocket frame before GIL-heavy work
    ├─ Launch deferred doc enrichment (KeyBERT, background, non-blocking)
    │
    ▼
Post-response compaction (→ History Compaction section above)
```

### Assembly Mode

The streaming handler uses **tiered assembly** (`assemble_tiered_messages`) for LLM requests. This produces a message array with `cache_control` markers at tier boundaries, enabling provider-level prompt caching. The stability tracker's tier assignments drive content placement — see [Cache and Assembly — Tiered Assembly Data Flow](cache_and_assembly.md#tiered-assembly-data-flow) for the complete data flow.

### Deferred Initialization Guard

The LLM service supports a **deferred initialization** mode (`deferred_init=True`) used by the startup sequence. When deferred, the service skips stability initialization at construction time. The `_init_complete` flag starts as `False` and gates `chat_streaming` — requests arriving before initialization completes are rejected with `"Server is still initializing — please wait a moment"`. The flag is set to `True` after `complete_deferred_init()` finishes.

**Session restore timing:** The last session is restored **eagerly** via `_restore_last_session()` — called in `main.py` *before* the WebSocket server starts accepting connections (`server.start()`). This ensures `get_current_state()` returns previous session messages as soon as the first browser connects, without waiting for the deferred initialization phase. `complete_deferred_init()` handles only symbol index wiring and does not re-run session restoration.

### Stability Tracker Initialization

The stability tracker is initialized **eagerly during the deferred startup phase** (`_try_initialize_stability` called from `main.py` after `complete_deferred_init`). This runs `index_repo()`, builds the reference graph, initializes tier assignments, seeds L0, and prints a startup HUD — with progress reported to the browser via `startupProgress`.

If eager initialization fails (e.g., no symbol index or repo), a **fallback lazy initialization** occurs on the first chat request inside `_stream_chat`. Once initialized (by either path), the `_stability_initialized` flag prevents re-initialization. The lazy path also seeds `system:prompt` into L0 after `index_repo()` to ensure the legend reflects final content.

### File Context Sync

Before loading files, the streaming handler compares the current FileContext against the incoming selected files list. Files present in the context but absent from the new selection are removed. This ensures deselected files don't linger in the in-memory context across requests.

```pseudo
current_context_files = context.file_context.get_files()
for path in current_context_files - selected_files:
    context.file_context.remove_file(path)
```

This is distinct from the cache tiering deselection cleanup (see [Cache and Assembly — Item Removal](cache_and_assembly.md#item-removal)), which handles `file:*` entries in the stability tracker. Both operate on the same user action (unchecking a file) but manage different state stores.

User-excluded index files (see [Cache and Assembly — User-Excluded Files](cache_and_assembly.md#user-excluded-files)) are merged into the `exclude_files` set for all map generation calls (`get_symbol_map`, `get_doc_map`) and for `_update_stability` active items computation. Excluded files have no presence in context — no full content, no index block, no tracker item.

### Client-Side Initiation

1. Guard — skip if empty input
2. Reset scroll — re-enable auto-scroll
3. Build URL context — get included fetched URLs, append to LLM message (not shown in UI)
4. Show user message immediately
5. Clear input, images, detected URLs
6. Generate request ID: `{epoch_ms}-{random_alphanumeric}`
7. Track request — store in pending requests map
8. Set streaming state (disable input, start watchdog)
9. RPC call: `LLMService.chat_streaming(request_id, message, files, images)`

### Stream Completion Result

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
    binary_files: [string]?            # Rejected binary files
    invalid_files: [string]?           # Not-found files

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

### LLM Streaming (Worker Thread)

Runs in a thread pool to avoid blocking the async event loop:

1. Call LLM provider with `stream=True` and `stream_options: {"include_usage": true}`
2. For each chunk: accumulate text, fire chunk callback
3. Check cancellation flag each iteration
4. Track token usage from final chunk
5. Return `(full_content, was_cancelled)`

Each chunk carries the **full accumulated content** (not deltas). Dropped or reordered chunks are harmless — latest content wins. Chunks are fire-and-forget RPC calls. Server→browser calls use `ClassName.method` format (e.g., `AcApp.streamChunk`), matching the class name registered via `addClass` on the browser side.

### Client Chunk Processing

Coalesced per animation frame:
1. Store pending chunk
2. On next frame: create assistant card (first chunk) or update content
3. Trigger scroll-to-bottom (respecting user scroll override)

### Cancellation

During streaming, the Send button transforms into a **Stop button** (⏹). Clicking calls `LLMService.cancel_streaming(request_id)`. The server adds the request ID to a cancelled set; the streaming thread checks each iteration and breaks out. Partial content stored with `[stopped]` marker, `streamComplete` sent with `cancelled: true`.

### Post-Response Stability Update

Build the active items list and run the tracker update:

```pseudo
active_items = {}

# 1. Selected files: full content hash
for path in selected_files:
    content = file_context.get_content(path)
    if content:
        active_items["file:" + path] = {hash, tokens}

# 2. Index entries for selected files
for path in selected_files:
    prefix = "sym:" if mode == "code" else "doc:"
    block = index.get_file_block(path)
    if block:
        active_items[prefix + path] = {hash, tokens}

# 3. Non-graduated history messages
for i, msg in enumerate(history):
    key = "history:" + str(i)
    if key not in any cached tier:
        active_items[key] = {hash, tokens}

# 4. Deselected file cleanup
# 5. Run tracker update
stability_tracker.update(active_items, existing_files=repo.get_flat_file_list())
```

### Post-Response Compaction

Runs asynchronously after `streamComplete` with a 500ms delay:
1. Send `compaction_start` notification via `compactionEvent` callback
2. Check if history exceeds trigger
3. Run compaction if needed
4. Re-register history items in stability tracker
5. Send `compaction_complete` (or `compaction_error` on failure) notification

See the History Compaction section above for the compaction algorithm and frontend notification protocol.

### Deferred Doc Enrichment

When edit blocks modify document files in doc mode, their structures are re-extracted immediately (instant unenriched outlines) but keyword enrichment is **deferred** until after `streamComplete` is transmitted. This prevents KeyBERT — which is CPU-bound and holds the GIL for seconds per file — from blocking the WebSocket write that transitions the UI from stop to send mode.

#### Eager Model Pre-Initialization

The KeyBERT sentence-transformer model (~80–420 MB) is loaded lazily on first use. Loading holds the GIL for ~10 seconds (PyTorch weight materialization). To prevent this from blocking the mode-switch RPC response, the model is **eagerly pre-initialized** at the end of `_build_doc_index_background_silent` Phase 1, **before** the `doc_index_ready` event is sent to the frontend. This runs unconditionally (not gated on `needs_enrichment`) because even when all files are cached from disk, a future mode switch may discover mtime-changed files and queue them for enrichment. By the time `doc_index_ready` is sent and the user can click the doc mode button, the model is already loaded.

The enrichment queue is stashed in the result dict under `_deferred_enrichment`. This key is stripped via `result.pop` **before** `streamComplete` is sent — the queue contains `DocOutline` objects that aren't JSON-serializable and would silently kill the WebSocket write. After `streamComplete` and an `await asyncio.sleep(0)` to flush the WebSocket frame, the enrichment is launched via `asyncio.ensure_future`. Each file is enriched in the thread pool executor, with per-file progress events sent to the browser. The reference index is rebuilt after all files complete.

### URL Fetch Notifications During Streaming

When URLs are detected and fetched during `_stream_chat`, progress is communicated to the browser via `compactionEvent` callbacks reusing the general-purpose progress channel:

| Stage | Message |
|-------|---------|
| `url_fetch` | `"Fetching {display_name}..."` — shown as a transient toast |
| `url_ready` | `"Fetched {display_name}"` — shown as a success toast |

Already-fetched URLs (present in the in-memory fetched dict) are skipped without notification. The URL context is then set on the context manager as a pre-joined string — the `\n---\n` joining happens in `format_url_context()` before being passed to `set_url_context()`.

### Token Usage Extraction

Different providers report cache tokens under different field names:

| Provider | Cache Read Field | Cache Write Field |
|----------|-----------------|-------------------|
| Anthropic | `cache_read_input_tokens` | `cache_creation_input_tokens` |
| Bedrock | `prompt_tokens_details.cached_tokens` | `cache_creation_input_tokens` |
| OpenAI | `prompt_tokens_details.cached_tokens` | — |
| litellm unified | `cache_read_tokens` | `cache_creation_tokens` |

The extraction uses a dual-mode getter (attribute + key access) with fallback chains. Stream-level usage is captured from any chunk with it (typically the final chunk). Response-level usage merged as fallback. Completion tokens are estimated from content length (~4 chars/token) only if the provider reported no completion count.

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Invalid/binary files | streamComplete with error, client auto-deselects |
| Concurrent stream | Rejected immediately |
| Streaming exception | Caught, traceback printed, streamComplete with error |
| Client watchdog | 5-minute timeout forces recovery |
| History token emergency | Oldest messages truncated if > 2× compaction trigger |
| Budget exceeded | Largest files shed with warning |

### Testing (Streaming)

- get_current_state returns messages, selected_files, streaming_active, session_id, repo_name, cross_ref_enabled
- set_selected_files updates and returns copy; get_selected_files returns independent copy
- set_excluded_index_files stores exclusion set, removes tracker items, broadcasts filesChanged
- get_current_state includes excluded_index_files field
- Concurrent stream rejected with error
- cancel_streaming succeeds for matching request_id; wrong id returns error
- New session changes session_id and clears history
- Context breakdown returns breakdown with system/symbol_map/files/history categories
- Context breakdown returns total_tokens, max_input_tokens, model, session_totals
- Session totals initially zero
- Mode switch clears selected files and broadcasts filesChanged to frontend
- Cache tab and context tab listen for mode-changed and files-changed events, triggering refresh
- Stability tracker switches to mode-specific instance; _update_stability runs immediately
- Context breakdown reflects new mode's index (symbol map or doc map) after switch
- Cross-reference toggle resets to OFF on mode switch (cross-ref items from previous mode are removed)
- Mode switch is instant — structural re-extraction produces unenriched outlines immediately; changed files queued for background enrichment with non-blocking header progress bar
- Unenriched outlines are cached immediately so the doc map and cross-reference work without waiting for enrichment; enriched outlines replace cache entries as each file completes (no toast — progress shown in header bar only)
- Mode switch RPC is guarded by `_modeSwitchInFlight` flag — `_refreshMode` skips both backend polling and saved-preference auto-switching while a switch is in flight, preventing a race where `doc_index_ready` triggers `_refreshMode` before the switch RPC returns and the preference is saved
- Shell command detection extracts from ```bash blocks, $ prefix, > prefix
- Comments skipped, non-command text returns empty
- Commit message uses the smaller model (`smaller_model` config, falling back to primary model)
- Commit prompt loaded from `commit.md` config file (not hardcoded)
- Empty/whitespace diff rejected
- Mocked LLM returns generated message
- Commit message generation uses `run_in_executor` to run the synchronous `litellm.completion` call on a thread pool, avoiding blocking the async event loop
- Tiered content deduplication: file in cached tier excludes its symbol block
- Selected non-graduated file excluded from symbol blocks
- Graduated selected file gets file content, not symbol block
- Unselected file without cached content gets symbol block only
- Not-in-context edit handling: unselected files get NOT_IN_CONTEXT status without application attempt
- In-context edits in the same response are applied normally
- Create blocks bypass the context check (always attempted)
- Auto-added files broadcast via filesChanged callback
- files_auto_added in streamComplete lists paths that were auto-added
- Review mode skips all edit application (existing behavior unchanged)
- Cross-reference toggle: `set_cross_reference(true)` runs initialization pass for the other index's items
- Cross-reference toggle: `set_cross_reference(false)` removes cross-ref items from tracker, marks affected tiers as broken
- `get_current_state` includes `cross_ref_enabled` field
- Cross-ref items use `sym:` or `doc:` prefix matching the cross-referenced index
- Both legends appear in L0 when cross-ref is enabled
- Mode switch resets cross-ref to disabled
- Token usage toast shown on activation indicating additional token cost
- Ambiguous anchor retry: failed edits with "Ambiguous anchor" in message trigger auto-populated retry prompt in chat input
- Ambiguous anchor retry: prompt lists each ambiguous failure with file path and error detail
- Ambiguous anchor retry: prompt is not auto-sent — user reviews and sends manually
- Ambiguous anchor retry: edit summary banner notes that a retry prompt has been prepared
- Ambiguous anchor retry: non-ambiguous failures (anchor not found, old text mismatch) do not trigger the retry prompt