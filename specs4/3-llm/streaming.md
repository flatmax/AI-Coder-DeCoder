# Streaming Lifecycle

The full lifecycle of a user message: UI submission → file validation → message assembly → LLM streaming → edit parsing → stability tracking → post-response compaction.

## Request Flow

- Browser shows user message immediately
- Browser generates a request ID for callback correlation
- Browser calls streaming RPC; server returns synchronously with started status
- Server launches background streaming task
- Stream chunks and events delivered via server-push callbacks

## Server Guards

- Reject if server is still initializing (deferred init not complete)
- Reject if another **user-initiated** stream is active (single user-initiated stream policy)
- Capture main event loop reference on the RPC entry thread, before launching background task

### Multiple Agent Streams Under a Parent Request

The single-stream guard gates user-initiated requests, not internal streams. A future parallel-agent mode (see [parallel-agents.md](../7-future/parallel-agents.md)) spawns N internal LLM streams under a single user-initiated request. These internal streams share the parent's request ID as a prefix and are distinguished by child IDs (e.g. `{parent-id}-agent-0`). The guard does not block them because they are not user-initiated — they are internal machinery serving one user intent.

Request IDs are the multiplexing primitive. All server-push events carry the exact ID of the stream they belong to. The transport never assumes a singleton stream.

## Background Task Overview

- Remove deselected files from context
- Validate files — reject binary and missing, actively remove deleted files from file context
- Load files into context
- Re-index symbol or doc index (mtime-based; only changed files re-parsed)
- Initialize stability tracker lazily on first request (if eager init failed)
- Detect and fetch URLs from the prompt (up to a per-message limit)
- Persist user message to JSONL and add to in-memory context before streaming begins
- Broadcast user message to all clients
- Build and inject review context when review mode is active
- Append system reminder to user prompt
- Build tiered content from stability tracker
- Recompute symbol map with full tier exclusions (two-pass)
- Assemble tiered message array with cache-control markers
- Run LLM completion in a worker thread, streaming
- Add assistant response to context after stream completes
- Save symbol map to per-repo working directory
- Print terminal HUD
- Parse and apply edit blocks
- Persist assistant message
- Update cache stability
- Send completion event
- Launch deferred doc enrichment (if any)
- Run post-response compaction

## Two-Pass Symbol Map Regeneration

- First pass (before building tiered content) — excludes selected files and user-excluded files
- Second pass (after building tiered content) — adds all paths from cached tiers to the exclusion set
- The second pass enforces the uniqueness invariant: files whose index blocks are already in a cached tier are excluded from the main map

## File Context Sync

- Compare current file context against incoming selected files list
- Remove files present in context but absent from new selection
- Actively remove deleted files (distinct from selection changes)
- Ensures deselected or deleted files don't linger in in-memory context across requests

## Deferred Initialization Guard

- Service supports deferred init mode — skips stability init at construction
- Init-complete flag gates streaming — requests arriving before init completes are rejected with a user-friendly message
- Flag is set after deferred-init completion

## Session Totals Tracking

- Service maintains cumulative token usage across all requests in the current server session
- Input, output, cache-read, cache-write tokens accumulated from each per-request usage dict
- Reported in context breakdown and terminal HUD

## Session Restore Timing

- Last session restored eagerly before the WebSocket server starts accepting connections
- Ensures first browser connect returns previous session messages without waiting for deferred init
- Deferred-init completion handles only symbol index wiring, does not re-run session restore

## Stability Tracker Initialization

- Eager path — initialization during deferred startup phase (index repo, build reference graph, initialize tier assignments, seed L0, print startup HUD)
- Progress reported to the browser via startup-progress events
- Fallback lazy path — on first chat request if eager init failed (e.g., no symbol index or repo)
- Once initialized by either path, the stability-initialized flag prevents re-initialization
- Lazy path also seeds system prompt into L0 after re-indexing so the legend reflects final content

## Client-Side Initiation

- Guard — skip if empty input
- Exit file search mode if active (restore full tree, clear query)
- Reset scroll — re-enable auto-scroll
- Build URL context — get included fetched URLs, append to LLM message (not shown in UI)
- Show user message immediately
- Clear input, images, detected URLs, close snippet drawer
- Generate request ID — timestamp + random suffix
- Track request — store current request ID
- Set streaming state (disable input)
- Call streaming RPC

## LLM Streaming (Worker Thread)

- Runs in a thread pool to avoid blocking the async event loop
- Call provider with streaming, usage reporting, and an explicit `max_tokens` ceiling
- For each chunk — accumulate text, fire chunk callback
- Check cancellation flag each iteration
- Track token usage from the final chunk
- Capture `finish_reason` from whichever chunk first reports a non-null value (typically the final chunk)
- Return accumulated content, cancelled flag, and finish reason

### Max-Tokens Resolution

Every `litellm.completion()` call — streaming chat, commit message generation, topic detection — passes an explicit `max_tokens` argument. Resolution is a two-level fallback chain:

1. `config.max_output_tokens` — user override in `llm.json` (optional)
2. `counter.max_output_tokens` — per-model ceiling from `TokenCounter`

The user override is clamped against the counter ceiling — a config value larger than the provider supports is capped rather than passed through (which would produce a 400). Without the explicit argument, providers apply their own default (commonly 4096), silently truncating long responses — edit-heavy assistant turns routinely exceed 4096 tokens and would be cut mid-edit-block.

### Finish Reason

The provider reports `finish_reason` on the final chunk (earlier chunks report None). Normalized values via litellm:

- `stop`, `end_turn` — natural end of generation
- `length` — hit `max_tokens`; response truncated
- `content_filter` — safety filter triggered
- `tool_calls`, `function_call` — model requesting a tool

The worker captures whichever chunk first reports a non-null value and propagates it through the stream-complete result. Natural stops log at INFO; non-natural stops log at WARNING so operators can diagnose truncation without trawling debug logs.

## Chunk Delivery Semantics

- Each chunk carries full accumulated content, not deltas
- Dropped or reordered chunks are harmless — the latest chunk contains a superset of prior content
- Reconnection is simple — no delta replay protocol needed
- O(n²) bandwidth for the stream is acceptable since chunks arrive faster than the LLM generates
- Each chunk carries the exact request ID of its stream; browser routing uses the ID to demultiplex when multiple streams are active concurrently (e.g. parallel agents)

## Worker Thread → Event Loop Bridge

- Main event loop reference captured at the RPC entry point, on the event loop thread, before launching the background task
- Worker thread uses run-coroutine-threadsafe with the captured loop to schedule callbacks
- Never acquire a new event loop inside the worker thread

## Chunk Coalescing (Frontend)

- Chunks coalesced per animation frame
- A pending-chunk variable stores the latest content; frame callback reads and clears it before updating streaming content
- Avoids re-rendering faster than 60 Hz even when chunks arrive every few milliseconds

## Passive Stream Adoption (Collaborator)

- When a chunk arrives with a request ID the client did not initiate, the client adopts the stream as passive
- Sets current request ID to the incoming ID
- Sets passive-stream flag to distinguish from self-initiated streams
- Processes subsequent chunks normally
- On completion of a passive stream, the user message from the result is prepended before the assistant response (since the passive client didn't add it optimistically)

## Cancellation

- During streaming, Send button transforms into Stop
- Clicking calls cancel-streaming RPC
- Server adds request ID to cancelled set; streaming thread checks each iteration and breaks out
- Partial content stored with marker; completion event sent with cancelled flag

## Stream Completion Result

- Full assistant response text
- Token usage (prompt, completion, cache read, cache write)
- Finish reason from the provider's final chunk (may be None if the stream raised or no chunk reported one)
- Parsed edit blocks with create flags
- Detected shell command suggestions
- Aggregate edit status counts (passed, already-applied, failed, skipped, not-in-context)
- Modified file paths
- Per-edit detailed results
- Files auto-added for not-in-context edits
- Original user message text (for collaborator sync)
- Cancelled flag (if cancelled)
- Error field (if fatal error)
- Binary/invalid files rejected

## Client Processing of Completion

- Flush pending chunks
- Clear streaming state
- Handle errors — show error as assistant message with error prefix
- Finalize message — build edit results map keyed by file path, attach aggregate counts
- Clear streaming content buffer
- Scroll to bottom if auto-scroll engaged (double animation-frame wait for layout)
- Refresh file tree if modified files present
- Refresh repo file list for file mention detection of newly created files
- Check for ambiguous anchor failures — auto-populate retry prompt
- Check for old-text-mismatch failures on in-context files — auto-populate retry prompt

## URL Fetch Notifications During Streaming

- Already-fetched URLs skipped without notification
- Fetch-start — transient toast showing URL display name
- Fetch-ready — success toast
- URL context set on context manager as a pre-joined string

## Post-Response Processing — Stability Update

- Build active items list from selected files, index entries for all indexed non-selected files, cross-reference items (when enabled), history messages
- Remove user-excluded items from tracker before update cycle
- Run tracker update phases
- Log tier changes (promotions and demotions)

## Post-Response Processing — Compaction

- Runs asynchronously after completion event, with a short delay
- Send compaction-start notification via event callback
- Check if history exceeds trigger
- Run compaction if needed
- Re-register history items in stability tracker
- Send compaction-complete (or error) notification

## Deferred Doc Enrichment

- When edit blocks modify document files, structures are re-extracted immediately but keyword enrichment is deferred
- Prevents CPU-bound enrichment from blocking the WebSocket write that transitions the UI from stop to send mode
- Enrichment queue stashed in completion result under a private key, stripped before the event is sent (outline objects aren't JSON-serializable)
- After completion event and an event-loop yield to flush the WebSocket frame, enrichment launched in the background

## Commit Background Task Guard

- Commit-all uses a boolean guard to prevent concurrent commits
- Guard set true before launching background task, cleared in a finally block
- Session ID captured synchronously before launching the background task — prevents a race where a concurrent server restart replaces the session ID, causing the commit event to persist to the wrong session
- Session-scoped mutable state must be captured as local variables at task-launch time, passed as parameters, never read from instance attrs inside the task

## Token Usage Extraction

- Extracted from the provider's response
- Different providers report cache tokens under different field names — extraction uses a dual-mode getter with fallback chains
- Stream-level usage captured from any chunk with it (typically the final chunk)
- Response-level usage merged as fallback
- Completion tokens estimated from content length only if the provider reported no completion count

## Terminal HUD

Three reports printed after each response:

- Cache blocks (boxed) — per-tier token counts and cache-hit percentage, with sub-item summaries
- Token usage — model, per-category breakdown, total, last-request in/out, cache read/write, session total
- Tier changes — promotions and demotions logged by the stability tracker

## Error Handling

- Invalid/binary files — completion event with error, client auto-deselects
- Concurrent stream — rejected immediately
- Streaming exception — caught, traceback printed, completion event with error
- History token emergency — oldest messages truncated if history exceeds 2× compaction trigger
- Budget exceeded — largest files shed with warning

## Invariants

- Only one user-initiated stream at a time; internal agent streams may coexist under a parent request ID
- All server-push events carry the exact request ID of the stream they belong to — the transport never assumes a singleton stream
- User message is persisted before LLM call begins — mid-stream crashes preserve user intent
- Assistant message is persisted after LLM call completes — no partial assistant messages in history
- The captured event loop reference is always usable from the worker thread
- The two-pass symbol map regeneration ensures no file appears in both the main map and a cached tier