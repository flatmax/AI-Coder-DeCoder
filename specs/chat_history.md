# Chat History

## Overview

Persistent conversation history stored per-repository. Every user and assistant message is appended to a JSONL file, organized by sessions. A browser UI allows searching, reviewing, and reloading past sessions.

## Storage

- **Location**: `.aicoder/history.jsonl` in the repository root
- **Format**: One JSON object per line (JSONL), append-only
- **Encoding**: UTF-8

### Message Schema

```json
{
  "id": "1719500000000-a1b2c3d4",
  "session_id": "sess_1719500000000_f0e1d2",
  "timestamp": "2024-06-27T15:00:00.000000+00:00",
  "role": "user | assistant",
  "content": "message text",
  "images": 2,
  "files": ["src/app.py", "src/utils.py"],
  "files_modified": ["src/app.py"],
  "edit_results": [...]
}
```

| Field | Type | Presence | Description |
|-------|------|----------|-------------|
| `id` | string | always | Unique ID: `{epoch_ms}-{uuid8}` |
| `session_id` | string | always | Groups messages into sessions |
| `timestamp` | string | always | ISO 8601 UTC |
| `role` | string | always | `"user"` or `"assistant"` |
| `content` | string | always | Message text |
| `images` | number | optional | Count of attached images (data not stored) |
| `files` | string[] | optional | Files in context (user messages) |
| `files_modified` | string[] | optional | Files changed (assistant messages) |
| `edit_results` | object[] | optional | Edit block application results |

## Sessions

A session groups related messages in a single conversation. Sessions are identified by `session_id` fields on each message.

- **Auto-created**: A new session ID is generated on first message if none exists
- **New session**: `clear_history` creates a fresh session ID
- **Load session**: Loading a past session sets its ID as current, so subsequent messages continue in that session
- **ID format**: `sess_{epoch_ms}_{uuid6}`

## Server API (RPC)

All methods are on `LiteLLM` via `HistoryMixin`:

| Method | Args | Returns | Description |
|--------|------|---------|-------------|
| `history_search` | `query, role?, limit?` | `message[]` | Case-insensitive substring search |
| `history_get_session` | `session_id` | `message[]` | All messages from a session |
| `history_list_sessions` | `limit?` | `session_summary[]` | Recent sessions, newest first |
| `history_new_session` | — | `string` | Start a new session, returns ID |
| `load_session_into_context` | `session_id` | `message[]` | Load session into active context manager and set as current session |

### Session Summary Schema

```json
{
  "session_id": "sess_...",
  "timestamp": "...",
  "message_count": 12,
  "preview": "first 100 chars of first message...",
  "first_role": "user"
}
```

### Internal Methods (not exposed via RPC)

| Method | Description |
|--------|-------------|
| `store_user_message(content, images?, files?)` | Append user message to history |
| `store_assistant_message(content, files_modified?, edit_results?)` | Append assistant message to history |

## History Browser (UI)

A modal dialog (`<history-browser>`) for browsing past conversations.

### Layout

- **Header**: Title, search input, "Load Session" button, close button
- **Left panel**: Session list or search results
- **Right panel**: Messages for selected session

### Behaviour

| Action | Result |
|--------|--------|
| Open browser | Fetches session list (cached 10s TTL) |
| Click session | Loads and displays all messages |
| Type in search | Debounced (300ms) full-text search across all messages |
| Click search result | Selects the session and scrolls to the matched message |
| Copy button | Copies message content to clipboard |
| To Prompt button | Dispatches `copy-to-prompt` event to paste into input |
| Load Session | Dispatches `load-session` event; replaces current chat with the selected session's messages and sets it as the active session |
| Close / overlay click | Hides modal, preserves selection state for re-open |

### State Preservation

When closed and reopened:
- Selected session, messages, search query, and search results are preserved
- Scroll positions for both panels are saved and restored
- Session list uses a 10-second TTL cache to avoid redundant fetches

### Search

- Case-insensitive substring match on message content
- Optional role filter (not exposed in UI currently)
- Default limit: 100 results
- Stale results are discarded if a newer search completes first (generation counter)

## Integration with Context Manager

When a session is loaded via `load_session_into_context`:

1. Context manager history is cleared
2. Each message from the session is added to the context manager
3. Token counting reflects the loaded history
4. The history store's current session ID is set to the loaded session
5. New messages are appended to the same session
