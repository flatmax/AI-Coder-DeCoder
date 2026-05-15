# Reference: Streaming

**Supplements:** `specs4/3-llm/streaming.md`

## Byte-level formats

### Request ID format

Generated browser-side at the start of every user-initiated request. Server-side only inspects it as an opaque string for correlation.

```
{epoch_ms}-{6-char-alphanumeric}
```

Example: `1736956800000-a1b2c3`

- `epoch_ms` — `Date.now()` at request origination, base-10 integer
- `6-char-alphanumeric` — random lowercase letters + digits; collision risk over session lifetime is negligible

For future parallel-agent mode, agent-internal streams use request IDs prefixed by the parent's ID with a child suffix: `{parent-id}-agent-{N}`. The single-stream guard treats `parent-id` as distinct from `parent-id-agent-0`, so internal streams coexist under one user-initiated request.

## Schemas

### `streamChunk(request_id, content)` — server → browser

Fire-and-forget notification of accumulated stream content. Called once per chunk received from the LLM provider.

| Field | Type | Notes |
|---|---|---|
| `request_id` | string | Matches the ID returned by `chat_streaming` |
| `content` | string | **Full accumulated content**, not a delta. Dropped or out-of-order chunks are harmless — the latest chunk always supersedes earlier ones |

### `streamComplete(request_id, result)` — server → browser

Fire-and-forget notification of stream end. Fires exactly once per user-initiated request, including cancelled or errored streams.

`result` dict shape:

| Field | Type | Present when | Notes |
|---|---|---|---|
| `response` | string | Always | Full assistant text (may be partial if `cancelled=true`) |
| `token_usage` | object | Always | See "Token usage shape" below |
| `finish_reason` | string \| null | Always | See "Finish reason values" below |
| `edit_blocks` | list[object] | Edits parsed from response | Each entry: `{file: str, is_create: bool}` |
| `shell_commands` | list[string] | Assistant suggested commands | Detected shell command strings |
| `passed` | int | Always | Count of successfully applied edits |
| `already_applied` | int | Always | Count of edits already present in file |
| `failed` | int | Always | Count of failed edits |
| `skipped` | int | Always | Count of skipped edits (binary, path traversal) |
| `not_in_context` | int | Always | Count of edits deferred because file not in selection |
| `files_modified` | list[string] | Edits succeeded | Paths of changed files |
| `edit_results` | list[object] | Edits attempted | Per-edit detail records; see `specs-reference/3-llm/edit-protocol.md` § Per-block result |
| `files_auto_added` | list[string] | Not-in-context edits present | Files added to selection for next turn |
| `user_message` | string | Always on passive streams | Original user text; used by collaborator clients that didn't see `userMessage` broadcast |
| `cancelled` | bool | If stream was cancelled | Absent otherwise |
| `error` | string | On fatal error | Error message; other fields may be partially populated |
| `error_info` | object | On classified LLM error | Structured error classification; see "Error classification" below. Absent when `error` is set but the failure occurred before the LiteLLM call (pre-completion exceptions in `_sync_file_context`, `_build_tiered_content`, etc.) |
| `binary_files` | list[string] | On validation failure | Rejected binary files |
| `invalid_files` | list[string] | On validation failure | Files not found on disk |

### `agentsSpawned(data)` — server → browser (broadcast)

Fires immediately after the main LLM's response is parsed and BEFORE child agent streams begin. Lets the frontend create agent tabs with pre-populated child request IDs so subsequent chunks route to the correct tab. See `specs4/7-future/parallel-agents.md` § Execution Model for the ordering contract.

`data` dict shape:

| Field | Type | Notes |
|---|---|---|
| `turn_id` | string | The turn's ID, generated at the top of the streaming pipeline; shared across the main LLM's own records and every spawned agent's archive |
| `parent_request_id` | string | The main user-initiated request ID. Child request IDs are derived as `{parent_request_id}-agent-{NN:02d}` — NN zero-padded to two digits matches the backend's archive directory layout |
| `agent_blocks` | list[object] | One entry per valid agent block. Each entry: `{id: str, task: str, agent_idx: int}`. `agent_idx` is zero-based; `id` and `task` come from the agent-spawn block body |

Idempotent with `streamComplete`'s `agent_blocks` field — the frontend's tab-creation path short-circuits when a tab for `{turn_id, agent_idx}` already exists. An older backend that only surfaces `agent_blocks` via `streamComplete` continues to work (tabs appear after all agents finish; child chunks in the interim are dropped, but final transcripts remain accessible via the archive).

Fires only when `agents.enabled` is true in config AND the main LLM emitted at least one valid agent-spawn block.

### `compactionEvent(request_id, event)` — server → browser

General-purpose progress channel. Despite the name, it carries history compaction, URL fetch, and doc enrichment progress. Stage name discriminates.

`event` dict shape varies by stage. Common field:

| Field | Type | Notes |
|---|---|---|
| `stage` | string | One of the stage names below |

Per-stage extra fields:

**`compacting`**
No extra fields. Show "Compacting history…" toast on frontend.

**`compacted`**
| Field | Type | Notes |
|---|---|---|
| `case` | string | `"truncate"` / `"summarize"` / `"none"` |
| `messages` | list[object] | Compacted message list ready to replace chat state |
| `summary` | string | Present for summarize case; the generated summary text |

**`compaction_error`**
| Field | Type | Notes |
|---|---|---|
| `error` | string | Error message for display |

**`url_fetch`**
| Field | Type | Notes |
|---|---|---|
| `url` | string | URL being fetched |
| `display_name` | string | User-facing label for toast |

**`url_ready`**
| Field | Type | Notes |
|---|---|---|
| `url` | string | URL just completed |
| `display_name` | string | User-facing label for success toast |

**`doc_enrichment_queued`**
| Field | Type | Notes |
|---|---|---|
| `files` | list[string] | Paths pending enrichment |
| `total` | int | Queue size for progress bar |

**`doc_enrichment_file_done`**
| Field | Type | Notes |
|---|---|---|
| `file` | string | Path just completed |
| `remaining` | int | Files still pending |

**`doc_enrichment_complete`**
No extra fields. Dismisses persistent toast.

**`doc_enrichment_failed`**
| Field | Type | Notes |
|---|---|---|
| `file` | string | File that failed |
| `error` | string | Failure reason |

### `userMessage(data)` — server → browser (broadcast)

Broadcast to all connected clients before the stream starts, so collaborators see the user's message even though they didn't initiate it.

| Field | Type | Notes |
|---|---|---|
| `content` | string | User's message text |

The sending client ignores this broadcast (it already added the message optimistically).

### Cache warmer events — server → browser (broadcast)

Four server-push callbacks driven by the cache warmer (see `specs4/3-llm/cache-tiering.md` § Cache Warmer for lifecycle). All four take a single `payload` dict argument; the frontend re-dispatches each as a window CustomEvent with `detail = payload`.

#### `cacheWarmupCountdown(payload)`

Fired once per second during the visible 30-second countdown phase before a warm-up call. The frontend renders a progress bar matching the retry-banner UX.

| Field | Type | Notes |
|---|---|---|
| `seconds_remaining` | int | Counts down from `total` to 1 (1 is the last tick before firing) |
| `total` | int | Initial countdown length in seconds. Drives the progress-bar denominator |

#### `cacheWarmupFiring(payload)`

Fired the moment the warm-up call goes out, after the countdown completes. Frontend flips the progress bar from countdown to spinner state. Empty payload `{}`.

#### `cacheWarmupComplete(payload)`

Fired after the warm-up call resolves. Frontend shows a brief flash and then fades out. On success, additional fields carry the warm-up's token counts so the Token HUD can render a per-warmup view; the same counts have already been accumulated into `_session_totals` server-side via `_accumulate_usage`.

| Field | Type | Notes |
|---|---|---|
| `success` | bool | `true` for a successful provider response. `false` for any exception (including retry-budget exhaustion) |
| `reason` | string | Present when `success: false`. Human-readable failure description suitable for display |
| `prompt_tokens` | int | Present when `success: true`. Total prompt tokens (cached + uncached) the provider charged for this warm-up |
| `cache_read_tokens` | int | Present when `success: true`. Tokens read from the provider's prompt cache. High value indicates the warmer is working as intended |
| `cache_write_tokens` | int | Present when `success: true`. Tokens written to the provider's prompt cache. Non-zero on the priming warm-up; ideally zero on subsequent warm-ups within the cache TTL |
| `elapsed_seconds` | float | Present when `success: true`. Wall-clock duration of the call |

A `success: false` event is followed by an automatic warmer disable — no further `cacheWarmup*` events fire until application restart or explicit re-enable.

Backwards-compatible extension: clients that ignore the new token fields continue to work. The Token HUD's warm-up listener uses these fields to populate a `🌡️ Cache warmup`-headered HUD identical in shape to the per-turn HUD.

#### `cacheWarmupCancelled(payload)`

Fired when the visible countdown is aborted. Frontend dismisses the progress bar without a flash.

| Field | Type | Notes |
|---|---|---|
| `reason` | string | `"user-activity"` (a user-initiated stream cancelled the timer) or `"stream-active"` (a stream was already in flight when the visible phase began) |

### Stream resumption snapshot

The `get_current_state` RPC response carries an `active_streams` field — one entry per in-flight stream — so a refreshed browser can re-attach to its own stream rather than receive the opaque single-stream-guard rejection. Schema for the RPC envelope itself lives in `specs-reference/1-foundation/rpc-inventory.md` § Service: LLMService; this section pins the per-entry field shape.

Per-entry shape:

| Field | Type | Notes |
|---|---|---|
| `request_id` | string | The stream's request ID. Frontend stamps this onto the resumed tab so subsequent `streamChunk` and `streamComplete` events route correctly via the existing request-ID lookup |
| `agent_id` | string \| null | The owning agent's LLM-chosen id when the stream runs under an agent scope; `null` for the main user-facing scope. Frontend uses this to pick the target tab — `null` → main tab, otherwise the agent tab keyed by id |
| `accumulated_content` | string | The chunks received so far, joined into one accumulated string (matches `streamChunk`'s "full content per chunk" semantics). Frontend installs this as the resumed tab's `streamingContent` so the partial response is visible immediately rather than waiting for the next chunk to arrive |

Empty list when no stream is in flight. Child agent request IDs (the `{parent-id}-agent-NN` format) are emitted as their own entries with `agent_id` set to the agent's id; the frontend resolves them to the agent tab without reconstructing the parent relationship.

Backed by two backend fields:

- `_active_request_to_agent: dict[str, str | None]` — reverse map populated alongside the single-stream guard in `chat_streaming`, cleared in the streaming pipeline's `finally` block. Authoritative source of "is this request id currently in flight, and who owns it".
- `_request_accumulators: dict[str, str]` — per-request accumulated content, populated by the worker thread on every chunk. Already used internally for terminal HUD output and post-response work; surfaced here so the resume snapshot can include partial response bytes.

### `commitResult(result)` — server → browser (broadcast)

Broadcast to all clients when a commit completes.

| Field | Type | Notes |
|---|---|---|
| `sha` | string | Full commit SHA |
| `short_sha` | string | 7-char prefix |
| `message` | string | Full commit message |
| `status` | string | `"ok"` on success; `"error"` on failure with the error field populated |
| `error` | string | Present on failure only |

### `filesChanged(selected_files)` — server → browser (broadcast)

Broadcast when the selection changes server-side (from `set_selected_files` or post-edit auto-add).

| Field | Type | Notes |
|---|---|---|
| `selected_files` | list[string] | Full selection set; replaces whatever the client has |

### Token usage shape

The `token_usage` field inside `streamComplete.result` normalizes provider-specific field names into a single shape:

| Field | Type | Notes |
|---|---|---|
| `prompt_tokens` | int | Input tokens (all providers report this) |
| `completion_tokens` | int | Output tokens (all providers report this). **Includes `reasoning_tokens`** — providers bill visible output and hidden reasoning under one field |
| `reasoning_tokens` | int | Subset of `completion_tokens` spent on hidden reasoning (Claude extended thinking, o1/o3). 0 when the model doesn't reason or when the provider didn't report the breakdown |
| `cache_read_tokens` | int | Cached input tokens read (0 if none or unsupported). Unified across Anthropic, Bedrock, and OpenAI shapes — see provider fallback table below |
| `cache_write_tokens` | int | Cache write tokens (0 if none or unsupported) |
| `prompt_cached_tokens` | int | OpenAI-shaped prompt cache read count. Exposed separately for diagnostics; also folded into `cache_read_tokens` |
| `cost_usd` | float \| null | LiteLLM's computed USD cost for this request. `null` when the model isn't in LiteLLM's pricing table (self-hosted models, brand-new releases before `model_prices_and_context_window.json` catches up). The frontend renders `null` as `—` rather than `$0.00` to distinguish "unknown" from "free" |

Field extraction uses a dual-mode getter (attribute + dict key access) with per-provider fallback chains:

| Provider | `cache_read_tokens` source | `cache_write_tokens` source | `reasoning_tokens` source |
|---|---|---|---|
| Anthropic | `cache_read_input_tokens` | `cache_creation_input_tokens` | `completion_tokens_details.reasoning_tokens` |
| Bedrock | `prompt_tokens_details.cached_tokens` | `cache_creation_input_tokens` | `completion_tokens_details.reasoning_tokens` |
| OpenAI | `prompt_tokens_details.cached_tokens` | *(not reported)* | `completion_tokens_details.reasoning_tokens` |
| litellm unified | `cache_read_tokens` | `cache_creation_tokens` | `completion_tokens_details.reasoning_tokens` |

`cache_read_tokens` is computed as the max of all three provider shapes so one number reflects "cached input" regardless of provider. `prompt_cached_tokens` stays as a separate field for operators debugging cache hit rates across providers.

Stream-level usage is captured from any chunk that includes it (typically the final chunk). Response-level usage is merged as fallback. If the provider reports no `completion_tokens`, it's estimated from content length at ~4 chars per token.

### Cost extraction

LiteLLM exposes per-request USD cost through three locations, tried in order:

1. `cost_source._hidden_params["response_cost"]` — primary. LiteLLM populates this on the response object (non-streaming) and on the stream wrapper (streaming) as chunks arrive.
2. `cost_source.response_cost` — some provider integrations expose it as a direct attribute.
3. `litellm.completion_cost(completion_response=cost_source)` — computes from the usage dict using LiteLLM's pricing table. Final fallback when hidden-params didn't populate.

Returns `None` when none of the paths produce a numeric cost. All three paths are guarded — unknown models raise `NotFoundError` from the pricing lookup, which we log at debug and fall through without aborting the stream.

Cost accumulates into `session_totals["cost_usd"]` (float) alongside `priced_request_count` and `unpriced_request_count` counters. The unpriced counter lets the UI show "(partial)" when some requests couldn't be priced — an accumulated `$0.12` with 5 unpriced requests means "at least $0.12; true total is higher".

## Numeric constants

### Per-message URL fetch cap

```
3 URLs per message
```

URLs detected in the user prompt beyond this limit are not auto-fetched during streaming. The URL chip UI can still fetch them manually via button press.

### Max-tokens resolution

The `litellm.completion(..., max_tokens=N)` argument resolves through a two-level fallback:

1. `config.max_output_tokens` — user override from `llm.json` if present
2. `counter.max_output_tokens` — per-model ceiling from `TokenCounter`

The config override is clamped against the counter ceiling — values larger than the provider supports are capped, not passed through (passing through would produce a 400 from the provider).

Without the explicit argument, providers apply their own defaults (commonly 4096) which silently truncate long responses. Edit-heavy assistant turns routinely exceed 4096 tokens, so the argument is always set.

### Streaming timeouts (three layers)

The streaming pipeline guards against hung LLM calls with three independent timeouts. Configured in `llm.json`; all four keys have sensible defaults and never need to be set unless the user has unusually long workloads.

| Layer | Default | `llm.json` key | Catches |
|---|---|---|---|
| Overall request timeout | 300s | `request_timeout_seconds` | Stream never started — DNS/TLS hang, slow start before first byte. Passed to `litellm.completion` as `timeout=` |
| First-chunk watchdog | 60s | `first_chunk_timeout_seconds` | Provider accepted request but never began streaming. Enforced by `threading.Timer` armed before iteration |
| Inter-chunk watchdog | 120s | `chunk_timeout_seconds` | Stream stalled mid-response. Timer reset on every chunk; tolerant of legitimate reasoning pauses |
| Aux call timeout | 60s | `aux_request_timeout_seconds` | Hung commit-message / topic-detector / URL-summarizer calls. Single `timeout=` per non-streaming call |

**Watchdog mechanism.** A `threading.Timer` runs on a separate thread. On expiry, the callback walks the stream object looking for a `close()` method (tries `stream.close`, then `stream.response.close` — provider wrappers vary). Calling close on the underlying HTTP stream causes the worker thread's blocked `next()` to raise. The streaming loop's `except` clause distinguishes a watchdog-fired abort (`watchdog_fired[0]` is set) from a provider-side mid-stream error and surfaces a typed timeout error rather than a generic exception.

**Partial content preservation.** When a watchdog fires, whatever content accumulated before the stall is preserved — the function returns `(full_content, False, None, empty_usage, error_string)`. The frontend renders the partial response with a red LED + timeout error toast. This is more useful than discarding everything because reasoning models often produce minutes of valid output before stalling on the final chunks.

**`error_info` shape on watchdog fire:**

```python
{
    "error_type": "timeout",
    "message": "no chunk for 120s mid-stream",   # or first-chunk variant
    "retry_after": None,
    "status_code": None,
    "provider": None,
    "model": "<configured model>",
    "original_type": "WatchdogTimeout",
}
```

**Cancellation responsiveness.** The watchdog's `stream.close()` mechanism doubles as a faster cancellation path. The `_cancelled_requests` check inside the loop only fires between chunks, so a hung read would otherwise ignore a user's Stop click until the next chunk arrived — by which point the watchdog itself has fired anyway. Users see their terminal back within `chunk_timeout_seconds` worst-case regardless of whether they clicked Stop.

### Retry schedule for `litellm.completion`

Every `litellm.completion(...)` call is wrapped in an explicit retry loop with exponential backoff — LiteLLM's built-in `num_retries=` kwarg is NOT passed (stacking both layers would multiply waits and mask provider retry hints).

| Parameter | Value | Notes |
|---|---|---|
| Max attempts | `config.num_retries + 1` | From `llm.json`; default `10 + 1 = 11` attempts total |
| Base wait | 2.0s | First retry waits `2s + jitter` |
| Growth | Exponential, base 2 | Attempt N waits `min(max, base × 2^N)` |
| Max wait per attempt | 60s | Ceiling so total budget stays bounded |
| Jitter | uniform(0, 1.5s) | Added to each computed wait |
| `Retry-After` floor | Header value when present | Computed wait is used only when it exceeds the header value |

Retryable error types (from `_classify_litellm_error`):

- `rate_limit`
- `api_connection`
- `service_unavailable`
- `timeout`

Non-retryable types fail fast on the first attempt:

- `authentication`
- `bad_request`
- `context_window_exceeded`
- `not_found`
- `llm_error` (unrecognized exceptions)

**Streaming caveat.** For streaming calls, the retry applies only to stream establishment — the `litellm.completion(..., stream=True)` call itself, before any chunk is yielded. Once chunks start flowing, a mid-stream failure can't be replayed because the partial response has already been delivered to the UI through `streamChunk` events. The 429 pattern this wrapper protects against raises before any chunk arrives, so the retry still catches it cleanly.

**Exhaustion behavior.** After `max_attempts` failures, the final exception is re-raised unchanged. The caller's existing error-classification path (`run_completion_sync` for streaming; the per-site try/except for commit + detector) handles the post-retry exception as it would have handled the original.

**Log output.** Each retry emits a WARNING:

```
{context} attempt N/M failed (type=rate_limit); sleeping X.Ys before retry
```

Where `{context}` is the call-site label (`streaming completion`, `commit message`, `topic detector`). Final exhaustion emits:

```
{context} retries exhausted after M attempts: type=rate_limit provider=bedrock msg=...
```

### Post-response compaction delay

Compaction runs after `streamComplete` with a brief delay:

```
500ms
```

The delay lets the browser process the `streamComplete` event and update UI before compaction work begins.

### `compactionEvent` retry

The `compaction_complete` event delivery uses a retry loop because the WebSocket may be momentarily busy from the preceding `streamComplete` write:

| Parameter | Value |
|---|---|
| Max attempts | 3 |
| Delay between attempts | 1 second |

## `finish_reason` values

LiteLLM normalizes provider stop reasons to these strings:

| Value | Meaning | Frontend treatment |
|---|---|---|
| `stop` | Natural end | Muted "✓ stopped" badge |
| `end_turn` | Anthropic passthrough (natural stop) | Muted "✓ end of turn" badge |
| `length` | Hit `max_tokens` — response truncated | Red "✂️ truncated (max_tokens)" badge + error toast |
| `content_filter` | Blocked by provider safety filter | Red "🚫 content filter" badge + error toast |
| `tool_calls` | Model wants to call a tool | Red "🔧 tool call requested" badge + error toast |
| `function_call` | Legacy function-call variant | Red "🔧 function call requested" badge + error toast |
| `null` / missing | Provider did not report | No badge |

Cancelled streams suppress the toast even for non-natural stops — the `[stopped]` marker appended to the response body is sufficient signal.

Extraction uses the same dual-mode getter pattern as token usage: `chunk.choices[0].finish_reason` via attribute + key access, with `None` as default. Only the final chunk of a stream typically reports a non-null value.

## Error classification

LiteLLM raises a catalog of typed exception classes that normalize provider errors into actionable categories. The backend classifier (`LLMService._classify_litellm_error`) maps each to a structured `error_info` dict attached to `streamComplete.result` when the failure occurred inside the LiteLLM call.

### `error_info` dict shape

| Field | Type | Notes |
|---|---|---|
| `error_type` | string | One of the nine classified types below. Defaults to `"llm_error"` for unrecognized exceptions |
| `message` | string | Provider's error message. Defaults to `str(exc)` |
| `retry_after` | float \| null | Seconds to wait before retry. Populated from the `Retry-After` HTTP header when present on `RateLimitError`; null otherwise |
| `status_code` | int \| null | HTTP status code when the provider reported one |
| `provider` | string \| null | LiteLLM's `llm_provider` attribute — `"anthropic"`, `"bedrock"`, `"openai"`, etc. |
| `model` | string \| null | Model identifier from the exception's `model` attribute |
| `original_type` | string | Python class name of the caught exception (for debugging unrecognized types) |

### `error_type` values

Classification tries types in specificity order. `ContextWindowExceededError` is a subclass of `BadRequestError` in LiteLLM's hierarchy, so the window error is checked BEFORE the generic bad-request — otherwise every context overflow would mis-tag as `bad_request`.

| `error_type` | LiteLLM class | HTTP | Actionable hint |
|---|---|---|---|
| `context_window_exceeded` | `ContextWindowExceededError` | 400 | Prompt (including history) exceeds the model's input window. Trigger compaction or drop files |
| `rate_limit` | `RateLimitError` | 429 | Provider throttled. Wait `retry_after` seconds and retry |
| `authentication` | `AuthenticationError` | 401 | API key invalid or missing. Edit LLM config |
| `not_found` | `NotFoundError` | 404 | Model identifier doesn't exist for the configured provider. Verify model name in LLM config |
| `bad_request` | `BadRequestError` | 400 | Malformed request (usually a schema mismatch). File a bug with the raw provider message |
| `api_connection` | `APIConnectionError` | — | Network/transport failure before the request reached the provider. Check internet / corporate proxy |
| `service_unavailable` | `ServiceUnavailableError` | 503 | Provider outage. Wait and retry |
| `timeout` | `Timeout` | — | Request took longer than LiteLLM's configured timeout |
| `llm_error` | *(catch-all)* | — | Unrecognized exception. Raw message surfaces to the user for diagnosis |

Class lookup is tolerant of LiteLLM version drift — each class is resolved via `getattr(litellm, name) or getattr(litellm.exceptions, name)`. A missing class (LiteLLM dropped or renamed it) causes that branch to skip rather than the classifier to crash.

### Retry-After extraction

`RateLimitError` may carry the original `httpx` response object as `.response`. When present, the classifier reads `response.headers["retry-after"]` (case-insensitive) and parses as float seconds. Shape mismatches (missing header, non-numeric value, absent response object) produce `retry_after: null`.

### Frontend rendering

The chat panel's `_emitTypedErrorToast` dispatches on `error_type` to produce per-type toasts with distinct icons and severity. See `specs-reference/5-webapp/chat.md` § Typed error toast catalog for the full icon/label/severity table.

The assistant message card additionally renders the error via `_formatErrorBody` which prefixes the error with a human-readable label (e.g., "Rate limit exceeded"), appends the provider's raw message on a second line, and shows provider/model metadata in a third line when known. Unclassified errors (`error_info` absent) fall through to the legacy `**Error:** {message}` format.

### Aux LLM call classification

The same classifier runs for aux calls (`_generate_commit_message`, topic detector). Those paths don't surface `error_info` to the browser — they degrade to safe defaults (empty commit message falls back to `"chore: update files"`; topic detection falls back to summarize case). Classification runs only to enrich the log line so operators can distinguish rate-limit failures from auth failures from context overflows across all LiteLLM call sites.

Aux calls do not interact with the cache warmer. The warmer's `cancel`/`reset` hooks are wired only to the streaming lifecycle (top and bottom of `stream_chat`); commit-message generation and topic-boundary detection use a different model with an independent provider cache, so touching the main-model warmer's timer on an aux call would shift the next firing later for no caching benefit. See `specs4/3-llm/cache-tiering.md` § Cache Warmer / Scope.

## Dependency quirks

### `stream_options={"include_usage": true}` requires explicit passing

LiteLLM's `completion(stream=True)` call does not include usage by default — the provider reports it only if the stream options object explicitly requests it:

```python
litellm.completion(
    ...,
    stream=True,
    stream_options={"include_usage": True},
)
```

Omitting this means every `streamComplete.result.token_usage` field comes back as zero. No error, no warning — silent data loss.

### Worker-thread event loop capture

The streaming worker thread cannot call `asyncio.get_event_loop()` — inside a thread pool worker this either fails or returns an unusable new loop. The main event loop reference must be captured on the event loop thread BEFORE the worker starts:

```python
# At RPC entry point (event loop thread):
self._main_loop = asyncio.get_event_loop()

# Inside worker thread:
asyncio.run_coroutine_threadsafe(
    self._chunk_callback(request_id, content),
    self._main_loop,  # captured reference
)
```

Common failure mode: capturing inside `run_in_executor`'s target function. That function runs on the worker thread, so `get_event_loop()` there fails. Capture must happen at the async RPC entry point before the executor launch.

## Cross-references

- Request flow, cancellation, post-response processing, invariants: `specs4/3-llm/streaming.md`
- Edit block parsing and result shapes: `specs-reference/3-llm/edit-protocol.md`
- Cache tiering constants referenced in post-response stability update: `specs-reference/3-llm/cache-tiering.md`
- History compaction thresholds: `specs-reference/3-llm/history.md` (when written)