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
| `binary_files` | list[string] | On validation failure | Rejected binary files |
| `invalid_files` | list[string] | On validation failure | Files not found on disk |

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
| `completion_tokens` | int | Output tokens (all providers report this) |
| `cache_read_tokens` | int | Cached input tokens read (0 if none or unsupported) |
| `cache_write_tokens` | int | Cache write tokens (0 if none or unsupported) |

Field extraction uses a dual-mode getter (attribute + dict key access) with per-provider fallback chains:

| Provider | `cache_read_tokens` source | `cache_write_tokens` source |
|---|---|---|
| Anthropic | `cache_read_input_tokens` | `cache_creation_input_tokens` |
| Bedrock | `prompt_tokens_details.cached_tokens` | `cache_creation_input_tokens` |
| OpenAI | `prompt_tokens_details.cached_tokens` | *(not reported)* |
| litellm unified | `cache_read_tokens` | `cache_creation_tokens` |

Stream-level usage is captured from any chunk that includes it (typically the final chunk). Response-level usage is merged as fallback. If the provider reports no `completion_tokens`, it's estimated from content length at ~4 chars per token.

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