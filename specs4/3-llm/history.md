# History

Two coupled stores for conversation history: an in-memory working copy used for prompt assembly, and an append-only JSONL file for persistence across sessions. Compaction keeps both within a token budget by summarizing old messages via LLM.

## Storage

- Persistent store — append-only JSONL file in the per-repo working directory
- Lines that fail JSON parse on load are skipped with a warning (handles mid-write crashes)
- In-memory store — the context manager's conversation history (see context-model)

### Scope: User-Facing History in the Main Store

The primary JSONL store (`history.jsonl` in the per-repo working directory) holds only user-facing conversation — exchanges between the user and the primary LLM. Agent-mode internal conversations (planner, per-agent turns, assessor reasoning) are persisted separately to a sibling archive rather than appended to the main store.

### Turns

Every user request is grouped into a **turn** — the unit of work from user message through the final assistant response. A turn ID is generated at the top of the streaming pipeline, stored on the user message record, and propagated to every downstream record produced by that request.

Turns exist in both single-agent and agent modes:

- **Non-agent mode** — one turn = one user message + one assistant response from a single LLM call. No planner, agents, or assessor; no turn archive directory is created.
- **Agent mode** — one turn = one user message + one assistant response, where the main LLM decomposed the work, spawned N agents to execute sub-tasks in parallel, observed their results, possibly iterated (more agents with different scope), and produced the final synthesis. All of the main LLM's reasoning — decomposition, review of agent output, iteration decisions, synthesis — lands in the assistant message's `content` field as it normally would; the main LLM has no separate conversation store. Only the agents get their own ContextManagers and their own archive files.

The main LLM's access to agent-spawning is a capability, not a mode the user toggles. A turn that did not need agents produces a normal assistant message via a single LLM call; a turn that did need agents produces an assistant message whose content may be longer and more structured, but shares the same schema. Whether a turn spawned agents is answered by checking whether `.ac-dc4/agents/{turn_id}/` exists.

Agent ContextManagers inherit the turn ID from the user message that triggered them. Per-agent conversations are archived to `.ac-dc4/agents/{turn_id}/agent-NN.jsonl`. The main LLM's conversation is NOT archived separately — it's already in the main `history.jsonl` as the user message and the assistant response.

Turn ID format — `turn_` prefix + epoch milliseconds + short random suffix, matching the session ID convention. Globally unique across sessions.

### Main Store Records — Turn ID Field

Every record in `history.jsonl` carries an optional `turn_id` field. User messages always carry it (generated at the top of the streaming pipeline). Assistant messages, system events, and compaction events inherit the turn ID from the user message that triggered them. Records predating this change lack the field — the loader tolerates its absence; the UI simply does not offer a "show agents" affordance for those records.

### Agent Turn Archive

When a turn spawns agents, each agent's conversation is persisted to a sibling archive under the per-repo working directory:

```
.ac-dc4/
  history.jsonl                     — main conversation (unchanged schema except +turn_id)
  agents/
    {turn_id}/
      agent-00.jsonl                — first agent's conversation
      agent-01.jsonl                — second agent's conversation
      ...
```

One directory per turn that spawned agents. One JSONL file per agent. The main store never merges with the archive; the archive is discovered only via turn ID lookup.

Files in the archive use the same message schema as the main store (role, content, timestamp, optional metadata) plus a `turn_id` field matching the directory name. This lets the loader reuse the parsing path.

The archive is created lazily — only when a turn actually spawns agents. Turns that did not spawn agents never touch the `agents/` directory. Re-iteration within a turn (main LLM spawns agents, reviews, spawns different agents with new scope) appends to the existing per-agent files rather than creating new directories — an agent-NN.jsonl file contains all iterations of agent NN within that turn, with iteration boundaries implicit in the conversation flow.

### User-Visible Agent Browsing

Agent archives are surfaced through an extension of the chat panel itself (see [agent-browser.md](../5-webapp/agent-browser.md) for the UI spec). The chat panel remains the vertical spine of the session — the user message / assistant response pairs the user already knows. When the active turn spawned agents, an agent region fans out alongside the chat with one column per agent.

The backend exposes three RPCs to support this:

- `get_turn_archive(turn_id)` — returns the per-agent conversations for a single turn. Reads from `.ac-dc4/agents/{turn_id}/`. Returns an empty result when the directory does not exist (turn did not spawn agents, or archive was deleted).
- `close_agent_context(turn_id, agent_idx)` — frees the agent's ContextManager, stability tracker, and file_context when the user closes an agent tab. The per-turn archive file on disk is preserved. Idempotent — closing a non-existent or already-closed agent returns a no-op status rather than raising. Localhost-only.
- `set_agent_selected_files(turn_id, agent_idx, files)` — per-agent analogue of the main-tab file selection RPC. The frontend routes picker checkbox toggles here when an agent tab is active; the main-tab path is unchanged. Filters non-existent paths against the repo. Localhost-only.

No separate `list_turns` RPC is required. Turn metadata is already part of the main history store (every record carries `turn_id`), and the chat panel's existing history-load path returns the records in order. `get_turn_archive` is called lazily as the user scrolls the chat and different turns become active.

The archive view is read-only — users cannot edit archived records. Archived conversations are NOT used during session restore. Session restore reads only `history.jsonl` and produces the same in-memory context as before — the user continues where they left off, seeing only their own conversation, with agent archives fetched on demand when they scroll.

### Disk Usage Monitoring

The agent archive grows with every agent-mode turn. Per-turn size is variable (small decomposition tasks produce a few hundred KB; large refactors with 8 agents and long contexts can reach tens of MB).

The system does not delete archived turns automatically. When the cumulative size of `.ac-dc4/agents/` crosses 1 GB, a one-time warning is surfaced to the user via the dialog header banner and a dismissible toast, with guidance on how to clear old archives (Settings → cleanup affordance, or direct removal of per-turn directories). The warning fires once per server lifetime; the user dismisses it and continues working. The check runs during startup and after each agent-mode turn completes, so heavy usage surfaces the warning promptly.

Per-turn archive deletion is safe — no record in `history.jsonl` depends on the archive for correctness. Deleting `.ac-dc4/agents/{turn_id}/` simply removes the "show agents" affordance from any assistant message carrying that turn ID.

### Backwards Compatibility

- Records without `turn_id` load correctly; the UI does not offer the agent-archive affordance for them.
- Archives for turns whose main-store record has been deleted (manual cleanup, file corruption) are orphaned — safe to keep, safe to remove. The UI ignores archives with no corresponding main-store record.
- Upgrading from a version without turn IDs is a no-op — new turns get IDs, old turns stay ID-less.
- Historical records that carry an `assessor_reasoning` field (from an earlier draft of this spec that treated the assessor as a distinct role) are loaded as plain assistant messages; the extra field is ignored. No migration is required.
- Records without `agent_blocks` (predating cross-turn agent reconstruction) load correctly; the per-turn agent affordance still works via `get_turn_archive(turn_id)`, but cross-turn views ("show me everything agent-X did") will skip those turns rather than guess at the id↔idx mapping.

### Cross-Turn Agent Reconstruction

The disk layout is keyed by a turn-local numeric `agent_idx` (`agent-00.jsonl`, `agent-01.jsonl`, …) — see [Agent Turn Archive](#agent-turn-archive). The orchestrator addresses agents by an LLM-chosen string `id` that is stable across turns (per [parallel-agents.md § Agent Reuse by ID](../7-future/parallel-agents.md#agent-reuse-by-id)). These two namespaces are intentionally separate:

- `id` is identity — chosen by the orchestrator, used as the registry key in `_agent_contexts`, used as the tab id in the chat panel, and used to address agents in subsequent `🟧🟧🟧 AGENT` blocks.
- `agent_idx` is per-turn storage routing — the integer position of the agent in that turn's spawn list, used to name the archive file and to derive child request IDs.

`agent_idx` is **not stable across turns**. A reuse of `agent-backend` in turn 1 (where it was the first block, idx 0 → `agent-00.jsonl`) and again in turn 3 (where the orchestrator spawned `agent-frontend` first, making `agent-backend` idx 1 → `agent-01.jsonl`) writes to two different filenames. The mapping is turn-local.

To make the across-turns view reconstructable without guessing, every assistant record that spawned agents persists an `agent_blocks` field — an ordered list of `{id, agent_idx}` entries, one per spawn block emitted in that turn. The order matches the spawn order (so `agent_blocks[N].agent_idx == N` in current implementations), but the field is stored verbatim rather than derived, so future schemes that decouple emission order from storage index remain compatible.

Reconstruction algorithm for "show me everything agent-X did across the session":

1. Scan the main store for assistant records carrying both `turn_id` and a non-empty `agent_blocks`.
2. For each such record, look for an entry where `id == "agent-X"`. If found, note `(turn_id, agent_idx)`.
3. Read each `(turn_id, agent_idx)` pair via `get_turn_archive(turn_id)` filtered to that index.
4. Concatenate in turn order (chronological by user-message timestamp).

The reconstruction is read-only; archives are not rewritten when the orchestrator retasks an agent under a new `agent_idx`. Turns without `agent_blocks` (legacy records, or turns that did not spawn agents) are skipped. Turns whose archive directory has been deleted (per [Disk Usage Monitoring](#disk-usage-monitoring)) are skipped without error.

Filename safety is incidental: because `agent_idx` is numeric, arbitrary characters in `id` (hyphens, dots, mixed case) never reach the filesystem. A future implementation MUST NOT shortcut by using `id` as a filename — case-sensitivity differences across platforms and unrestricted character set would silently corrupt the archive.

## Message Schema

- Unique message ID — timestamp + short random suffix
- Session ID — groups related messages
- Timestamp — ISO 8601 UTC
- Role — user or assistant
- Content — full text — for agent-mode assistant messages, this contains the main LLM's full output across all its internal calls within the turn (decomposition, review, iteration decisions, synthesis)
- Optional: system event flag, image references (filenames in working-directory images folder), legacy image count (deprecated), files in context (user messages), files modified (assistant messages), edit results array, turn ID (every record in a session produced after turn IDs were introduced)
- Optional on assistant records that spawned agents: `agent_blocks` — an ordered list of `{id, agent_idx}` entries, one per spawn block emitted in the turn. See [Cross-Turn Agent Reconstruction](#cross-turn-agent-reconstruction) below for why this is required

Agent-mode and non-agent-mode assistant messages share the same schema. The only runtime signal distinguishing them is the presence of `.ac-dc4/agents/{turn_id}/` on disk.

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
- Browser display retrieval returns full message dicts with all metadata, including the on-disk `image_refs` filenames AND a reconstructed `images` array of base64 data URIs alongside them — so the history browser can render thumbnails without a second RPC
- Image reconstruction is best-effort: missing files on disk are silently skipped rather than failing the call, and legacy records carrying a non-list `images` field (old integer-count shape) yield no reconstructed array
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
- Turn IDs are unique within a session and globally across sessions
- Mid-stream crashes never corrupt JSONL structure — partial lines are skipped on load
- Compaction purge of stability tracker is complete — no stale history entries remain
- After auto-restore, the first get-current-state call returns messages from the previous session
- The main `history.jsonl` never contains per-agent conversation records; those live only in the per-turn archive. The main LLM's own reasoning (decomposition, review, synthesis for agent-mode turns) is captured naturally in the assistant message's `content` field — there is no separate conversation store for the main LLM
- Agent-mode and non-agent-mode assistant messages share the same schema; whether a turn spawned agents is answered by checking for `.ac-dc4/agents/{turn_id}/` on disk
- Session restore reads only the main store; agent archives are load-on-demand for UI browsing
- Archive directories are safe to delete at any time; removal of an archive never breaks main-store playback
- The 1 GB disk-usage warning fires at most once per server lifetime; the user is never blocked from working, only informed
- Agent identity (`id`, an arbitrary non-empty string) and per-turn archive routing (`agent_idx`, a non-negative integer assigned by spawn order within a turn) are separate namespaces. `agent_idx` is stable only within a turn; `id` is stable across the session. Cross-turn reconstruction relies on the `agent_blocks: [{id, agent_idx}, ...]` field persisted on each agent-spawning assistant record — never on filename heuristics or scanning archive contents