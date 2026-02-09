# History and Compaction

## Persistent History

### Storage

Conversation history is persisted per-repository in an append-only JSONL file stored in the `.ac-dc/` directory inside the repo root. This directory is added to `.gitignore` on first creation.

```
{repo_root}/.ac-dc/
    history.jsonl          // Append-only conversation log
```

**Server state** (selected files, current session ID, conversation history, streaming status) is held **in-memory only**. Clients fetch it via `LLM.get_current_state()` on connect. On server restart, active context starts clean — the persistent JSONL history remains available for browsing and loading via the history browser.

### Corruption Recovery

Since the file is append-only, the only corruption case is a partial last line from a crash during write. On load, lines that fail JSON parsing are skipped with a warning. This loses at most one message.

### Message Schema

```pseudo
HistoryMessage:
    id: string               // "{epoch_ms}-{uuid8}"
    session_id: string       // Groups messages into sessions
    timestamp: ISO 8601 UTC
    role: "user" | "assistant"
    content: string
    images: integer?         // Count of attached images (data not stored)
    files: string[]?         // Files in context (user messages)
    files_modified: string[]? // Files changed (assistant messages)
    edit_results: object[]?  // Edit block results
```

### Sessions

A session groups related messages. Identified by `session_id` on each message.

| Operation | Behavior |
|-----------|----------|
| New session | Generated on first message or explicit creation |
| Load session | Sets as current; subsequent messages continue in it |
| Clear | Creates a fresh session ID |

**ID format:** `sess_{epoch_ms}_{uuid6}`

### RPC Methods

| Method | Description |
|--------|-------------|
| `history_search(query, role?, limit?)` | Case-insensitive substring search |
| `history_get_session(session_id)` | All messages from a session |
| `history_list_sessions(limit?)` | Recent sessions, newest first |
| `history_new_session()` | Start new session |
| `load_session_into_context(session_id)` | Load into active context |

### Session Summary

```pseudo
SessionSummary:
    session_id: string
    timestamp: string
    message_count: integer
    preview: string          // First ~100 chars of first message
    first_role: string
```

### Dual History Stores

The system maintains two parallel representations:

| Store | Purpose | Content |
|-------|---------|---------|
| Context Manager history | Token counting, message assembly, compaction | In-memory list |
| Persistent store (JSONL) | Cross-session persistence, browsing, search | Append-only file |

Both are updated on each exchange. The context manager drives what the LLM sees; the persistent store provides browsing and session management.

---

## History Compaction

### Overview

Compaction runs **after** the assistant response has been delivered — it is background housekeeping. The compacted history takes effect on the **next** request.

```
Response delivered → 500ms pause → compaction check
    → if history tokens > trigger:
          detect topic boundary (LLM call)
          apply truncation or summarization
          replace in-memory history
          notify frontend
```

### Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | true | Master switch |
| `compaction_trigger_tokens` | 24000 | Token count that triggers compaction |
| `verbatim_window_tokens` | 4000 | Recent tokens kept unchanged |
| `summary_budget_tokens` | 500 | Max tokens for summary |
| `min_verbatim_exchanges` | 2 | Minimum recent exchanges always kept |

The `detection_model` comes from LLM config (the "smaller model"). Required for compaction to function.

### Two-Threshold Design

```
oldest messages ◄──────────────────────────────► newest

│◄── summarizable zone ──►│◄── verbatim window ──►│
                           ▲ verbatim_start_idx

│◄───────── total history tokens ─────────────────►│
                                  ▲ trigger threshold
```

### Topic Boundary Detection

A smaller/cheaper LLM analyzes the conversation to find where the topic shifted.

**Input:** Messages formatted as indexed blocks:
```
[0] USER: Can you fix the bug in parser...
[1] ASSISTANT: I see the issue, the regex...
[2] USER: Now let's work on the API endpoint...
```

Messages truncated to ~1000 chars. At most 50 most recent messages sent.

**Output:**
```pseudo
TopicBoundary:
    boundary_index: integer?   // First message of NEW topic (null = no boundary)
    boundary_reason: string
    confidence: float          // 0.0–1.0
    summary: string            // Summary of messages before boundary
```

**What counts as a boundary:**
- Explicit task switches ("now let's work on...")
- Shift to different file/component
- Change in work type (debugging → feature development)
- Context resets ("forget that", "let's try something else")

The LLM looks for boundaries in the **middle**, not at the end. If the entire conversation is one topic, `boundary_index` is null.

**Error handling:** On LLM failure or unparseable output, returns safe defaults (null boundary, 0 confidence). JSON parsing is lenient — handles markdown fencing, regex extraction fallback.

### Compaction Cases

#### Case 1: Truncate Only

**When:** Boundary is inside or after verbatim window AND confidence ≥ 0.5

**Action:** Discard everything before the boundary. No summary needed.

```
Before: [old topic] [boundary] [current topic in verbatim window]
After:  [current topic only]
```

#### Case 2: Summarize

**When:** Boundary is before verbatim window, OR low confidence, OR no boundary found

**Action:** Replace messages before verbatim window with a summary message.

```
Before: [old msgs] [gap msgs] [verbatim window]
After:  [summary msg] [verbatim window]
```

Summary message format: `[History Summary - N earlier messages]\n\n<summary text>`

If no summary text available, old messages are simply dropped.

#### Case 3: None

**When:** History tokens below trigger, or messages list empty

**Action:** No changes.

### Minimum Exchange Guarantee

After compaction, if result contains fewer user messages than `min_verbatim_exchanges`, earlier messages are prepended until the minimum is met.

### Integration with Cache Stability

After compaction replaces messages, all `history:*` entries are purged from the stability tracker. New entries register on the next request as fresh active items (N = 0). This causes a one-time cache miss — the reduced message count means faster re-promotion.

### Frontend Notification Flow

| Event | Behavior |
|-------|----------|
| `compaction_start` | Show "Compacting..." message, disable input |
| `compaction_complete` | Rebuild message display from compacted messages, show summary |
| `compaction_error` | Show error, re-enable input |
| `case: "none"` | Remove "Compacting..." message silently |

---

## History Browser (UI)

A modal overlay for browsing past conversations.

### Layout
- **Header**: Title, search input, "Load Session" button, close
- **Left panel**: Session list or search results
- **Right panel**: Messages for selected session

### Behavior

| Action | Result |
|--------|--------|
| Open | Fetch session list (cached ~10s) |
| Click session | Load and display messages |
| Type in search | Debounced (300ms) full-text search |
| Click result | Select session, scroll to matched message |
| Copy button | Copy message to clipboard |
| To Prompt | Paste message content into input |
| Load Session | Replace current chat with selected session |
| Close | Preserve selection state for re-open |

### State Preservation
When closed and reopened: selected session, messages, search query, results, and scroll positions are preserved.
