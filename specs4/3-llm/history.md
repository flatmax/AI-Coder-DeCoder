# History

**Status:** stub

Two coupled stores for conversation history: an in-memory working copy used for prompt assembly, and an append-only JSONL file for persistence across sessions. Compaction keeps both within a token budget by summarizing old messages via LLM.

## Storage

- Persistent store — append-only JSONL file in the per-repo working directory
- Lines that fail JSON parse on load are skipped with a warning (handles mid-write crashes)
- In-memory store — the context manager's conversation history (see context-model)

### Scope: User-Facing History Only

The persistent store holds only user-facing conversation — exchanges between the user and the primary LLM. A future parallel-agent mode (see [parallel-agents.md](../7-future/parallel-agents.md)) generates additional internal conversations between the planner, agents, and assessor. These internal exchanges are **transient** — never persisted to JSONL, never included in the user-facing history, never counted toward compaction thresholds.

What does get persisted from agent mode:

- The original user request (as a user message)
- The final assessor synthesis and/or applied edits (as a system event message or assistant message)

What does not get persisted:

- Planner decomposition output
- Per-agent conversation turns
- Assessor intermediate reasoning

Rationale — agent conversations are internal machinery serving one user intent. Persisting them would pollute the user's session history with scaffolding that is meaningless out of context and would inflate token counts on session reload. The user cares about what was accomplished, not how the agents coordinated.

## Message Schema

- Unique message ID — timestamp + short random suffix
- Session ID — groups related messages
- Timestamp — ISO 8601 UTC
- Role — user or assistant
- Content — full text
- Optional: system event flag, image references (filenames in working-directory images folder), legacy image count (deprecated), files in context (user messages), files modified (assistant messages), edit results array

## Sessions

- A session groups related messages by ID
- Format: `sess_` prefix + timestamp + short random suffix
- New session generated on first message or via explicit RPC
- Loading a session sets it as current; subsequent messages continue in it
- Clearing creates a fresh session ID

## Session Summary

- Session ID, timestamp, message count, preview (first ~100 chars of first message), first role
- Returned by the list-sessions RPC for the history browser

## Dual Stores

- Context manager history — token counting, message assembly, compaction (in-memory)
- Persistent store (JSONL) — cross-session persistence, browsing, search (append-only)
- Both updated on each exchange

## Retrieval Path Asymmetry

- Context-loading retrieval returns only role/content (plus reconstructed images)
- Browser display retrieval returns full message dicts with all metadata
- Metadata (files, edit results, image refs) exists only in JSONL after a session reload

## Message Persistence Ordering

- User message persisted to both stores before the LLM call starts
- Assistant message added to both stores after the full response completes
- Mid-stream crashes leave orphaned user messages in JSONL — intentional, preserves user intent

## Search Fallback

- Persistent store searched first
- If empty or unavailable, fall back to case-insensitive substring match on in-memory history

## Compaction

- Runs after the assistant response is delivered — background housekeeping
- Compacted history takes effect on the next request

### Configuration

- Enabled flag
- Trigger tokens threshold
- Verbatim window tokens (recent content kept unchanged)
- Summary budget tokens
- Minimum verbatim exchanges always preserved

### Live Config Reloading

- Compactor reads config values through accessor methods rather than a snapshot dict
- Hot-reloaded config values take effect on the next compaction check without restart

### Two-Threshold Design

- Verbatim window — count backward from end of message list accumulating tokens until the verbatim threshold is reached
- Minimum verbatim exchanges — count backward N user messages
- The earlier (more inclusive) of the two indices becomes the verbatim start

### Topic Boundary Detection

- A smaller/cheaper LLM analyzes the conversation to find where the topic shifted
- Input: messages formatted as indexed blocks, truncated per message, capped at a maximum count
- Signals — explicit task switches, shift to different file/component, change in work type, context resets
- Output — boundary index (or null), reason text, confidence (0–1), summary text
- On failure or unparseable output — safe defaults (null boundary, zero confidence)

### Compaction Cases

- **Truncate** — boundary is in or after the verbatim window and confidence is high enough; discard everything before the boundary
- **Summarize** — boundary is before the verbatim window, or low confidence, or no boundary; replace pre-verbatim messages with a summary pair
- **None** — below trigger or empty history

### Compaction Result

- Case name
- Compacted message list
- Detected boundary (for truncate / summarize)
- Summary text (for summarize)

### Summary Message Format

- A user/assistant pair synthesizing the summary
- User content marked as history summary
- Assistant content acknowledging understanding
- Followed by the verbatim window messages

### Minimum Verbatim Safeguard

- If compacted result has fewer user messages than the minimum, earlier messages are prepended
- For summarize, prepended after the summary pair to maintain summary → earlier context → verbatim ordering

### Integration with Cache Stability

- After compaction, all history entries are purged from the stability tracker
- New entries register on the next request as fresh active items
- Causes a one-time cache miss; shorter history re-stabilizes within a few requests

### Frontend Notification

- Progress communicated via the same event channel used for URL fetches during streaming
- Stages — compacting (show toast), compacted (rebuild message display), error (show error)
- Completion event delivery uses a retry loop since the WebSocket may be momentarily busy from the preceding completion write

## Auto-Restore on Startup

- On LLM service initialization, the most recent session is loaded from the persistent store into the context manager
- Query list-sessions for the newest session, load messages via the context-retrieval path, add each to context
- Reuse the restored session's ID as the current session ID — subsequent messages persist to the same session
- Runs synchronously before the WebSocket server starts accepting connections, so the first browser connect returns previous messages immediately
- File selection is not restored on server restart — only conversation messages

## Loading a Previous Session

- Clear current history
- Read messages from persistent store (reconstruct images from refs)
- Add each to context manager
- Set persistent store's session ID to continue in loaded session
- Return value includes session metadata plus a messages array with reconstructed image data URIs

## Invariants

- Every persisted message has a unique ID
- Session IDs are unique
- Mid-stream crashes never corrupt JSONL structure — partial lines are skipped on load
- Compaction purge of stability tracker is complete — no stale history entries remain
- After auto-restore, the first get-current-state call returns messages from the previous session