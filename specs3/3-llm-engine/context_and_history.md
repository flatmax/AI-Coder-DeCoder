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
3. **Stability Tracker** — cache tier assignments (if repo_root provided; see [Cache Tiering](cache_tiering.md))
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
2. Stability tracker starts empty — tiers rebuild from reference graph on first request
3. **Auto-restore last session** — on LLM service initialization, the most recent session is loaded from the persistent history store into the context manager. This means `get_current_state()` returns messages from the previous session immediately, allowing the browser to resume where the user left off after a server restart. If no sessions exist or loading fails, history starts empty.

### During Conversation
1. Streaming handler calls `add_message()` for each exchange
2. Stability tracker updated with current items after each response
3. Post-response compaction runs if threshold exceeded

### Session Reset
Clear history, purge stability tracker history entries, start new persistent session

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