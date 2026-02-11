# Streaming Chat

## Overview

The full lifecycle of a user message: UI submission → message assembly → LLM streaming → edit parsing → stability tracking → post-response compaction.

## Request Flow

```
User clicks Send
    │
    ├─ Show user message in UI immediately
    ├─ Generate request ID for callback correlation
    ├─ Start watchdog timer (5 min safety timeout)
    │
    ▼
Server: chat_streaming (via RPC)
    │
    ├─ Guard: reject if another stream is active
    ├─ Persist user message to history store
    ├─ Launch background streaming task
    ├─ Return immediately: {status: "started"}
    │
    ▼
Background task: _stream_chat
    │
    ├─ Validate files (reject binary/missing)
    ├─ Load files into context
    ├─ Detect & fetch URLs from prompt
    ├─ Assemble tiered message array
    ├─ Run LLM completion (threaded, streaming)
    │       │
    │       ├─ streamChunk callbacks → browser
    │       └─ return (full_content, was_cancelled)
    │
    ├─ Add exchange to context manager
    ├─ Save symbol map to .ac-dc/
    ├─ Print terminal HUD
    ├─ Parse & apply edit blocks
    ├─ Persist assistant message
    ├─ Update cache stability
    │
    ▼
Send streamComplete → browser
    │
    ▼
Post-response compaction (async, non-blocking)
```

## Client-Side Initiation

### Send Message Flow

1. **Guard** — skip if input is empty
2. **Reset scroll** — re-enable auto-scroll
3. **Build URL context** — get included fetched URLs, append to LLM message (not shown in UI)
4. **Show user message** — render immediately
5. **Clear input** — reset textarea, images, detected URLs
6. **Generate request ID** — `{timestamp}-{random_string}`
7. **Track request** — store in pending requests map
8. **Set streaming state** — disable input, start watchdog
9. **RPC call** — `LLM.chat_streaming(request_id, message, files, images)`

### Request ID

Format: `{epoch_ms}-{random_alphanumeric}`. Used to correlate `streamChunk`, `streamComplete`, and `compactionEvent` callbacks. The client ignores callbacks for unknown IDs.

## Message Assembly

### Tier Organization

Content is organized into 5 stability tiers for prompt caching:

| Tier | Cached | Content |
|------|--------|---------|
| L0 | Yes | System prompt, legend, core symbols/files/history |
| L1 | Yes | Stable symbols/files/history |
| L2 | Yes | Moderately stable content |
| L3 | Yes | Recently graduated content |
| active | No | Current files, recent history, URLs |

See [Cache Tiering](cache_tiering.md) for the stability algorithm.

### Message Array Structure

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
[M+4] user     Active files ("Working Files")
[M+5] assistant "Ok."
[M+] Active history (native pairs)
[last] user    Current prompt (with optional images)
```

Empty tiers are skipped. Cache control markers go on the last message in each tier's sequence.

### Image Handling

If images are provided, the user message uses multimodal format with `{type: "text"}` and `{type: "image_url"}` content blocks.

## Streaming Execution

### LLM Call (Worker Thread)

Runs in a thread pool to avoid blocking the async event loop:

1. Call LLM provider with `stream=True`
2. For each chunk with content: accumulate full text, fire chunk callback
3. Check cancellation flag each iteration
4. Final chunk carries complete content
5. Track token usage from final chunk
6. Return `(full_content, was_cancelled)`

### Stream Options

All providers receive `stream_options: {"include_usage": true}` to request token usage in the final streaming chunk. litellm translates this to each provider's native mechanism (e.g., Bedrock's streaming usage events). This ensures cache hit/write token counts are available for every provider.

### Chunk Delivery

Each chunk carries the **full accumulated content** (not just the delta). This means:
- Dropped chunks are harmless — next chunk supersedes
- Reordered chunks are harmless — latest content wins
- Only `streamComplete` needs reliable delivery

Chunks are fire-and-forget RPC calls from server to client.

### Client Chunk Processing

Chunks are coalesced per animation frame to prevent render thrashing:
1. Store pending chunk data
2. On next animation frame: create assistant message (first chunk) or update it
3. Trigger scroll-to-bottom (respecting user scroll override)

## Cancellation

### Stop Button

During streaming, the **Send button transforms into a Stop button** (⏹ Stop). Clicking it calls `LLM.cancel_streaming(request_id)` via RPC. The button reverts to Send once `streamComplete` is received.

### Server Behavior

**Server:** adds request ID to a thread-safe cancelled set. The streaming thread checks this each iteration and breaks out.

After cancellation: partial content is stored with a `[stopped]` marker, `streamComplete` sent with `cancelled: true`, no edits parsed.

## Stream Completion

### Server Result Object

| Field | Description |
|-------|-------------|
| `response` | Full assistant response text |
| `token_usage` | Token counts for HUD display |
| `edit_blocks` | Parsed blocks (preview text) |
| `shell_commands` | Detected shell suggestions |
| `passed/failed/skipped` | Edit application results |
| `files_modified` | Paths of changed files |
| `edit_results` | Detailed per-edit results |
| `cancelled` | Present if request was cancelled |
| `error` | Present if fatal error occurred |
| `binary_files` | Rejected binary files |
| `invalid_files` | Not-found files |

### Client Processing

1. Flush pending chunks
2. Clear streaming state, watchdog
3. Handle errors — auto-deselect binary/invalid files
4. Finalize message — mark as final, attach edit results
5. Refresh file tree if edits were applied
6. Run file mention detection on the finalized assistant message (see [Chat Interface](chat_interface.md#file-mentions))
7. Show token usage HUD
7. Refresh cache/context viewers
8. Focus input for next message

## Edit Application

After streaming (if not cancelled):

1. **Parse** — state machine extracts edit blocks from response
2. **Detect shell** — regex finds shell command suggestions
3. **Apply** — if blocks found, apply edits to disk and stage files
4. **Invalidate** — modified files have symbol cache invalidated

## Post-Response Processing

### Stability Update

Updates the cache tier tracker with current request's items:

1. **Stale detection** — tracked items whose files no longer exist are removed
2. **File/symbol churn** — identify active context items
3. **Controlled history graduation** — piggyback on L3 invalidation or meet token threshold
4. **Update tracker** — call stability update with active items and content hashes
5. **Log changes** — print promotions (📈) and demotions (📉)

### Post-Response Compaction

Runs asynchronously after `streamComplete`:

1. Check if history exceeds compaction trigger
2. Wait 500ms for frontend to process completion
3. Notify start → run compaction → notify complete
4. Re-register history items in stability tracker

See [History and Compaction](history_and_compaction.md).

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Invalid/binary files | streamComplete with error, client auto-deselects |
| Concurrent stream request | Rejected immediately with error response |
| Exception in streaming | Caught, traceback printed, streamComplete with error |
| Chunk send failure | Logged but not fatal |
| streamComplete timeout | 5-second timeout, logged as warning |
| Client watchdog | 5-minute timeout forces recovery |
| History token emergency | Oldest messages truncated if > 2× compaction trigger |
| Pre-request budget exceeded | Largest files shed with warning |

## Prompt Assembly Format

### Complete Message Array

The message array is built in this exact order:

#### 1. L0 Block (System Message)

L0 is the **system role message**, not a user/assistant pair. It concatenates:

1. **System prompt** — from `system.md` + optional `system_extra.md` (joined with `\n\n`)
2. **Symbol map legend** — preceded by `REPO_MAP_HEADER`:
   ```
   # Repository Structure

   Below is a map of the repository showing classes, functions, and their relationships.
   Use this to understand the codebase structure and find relevant code.

   ```
   Then the legend text (abbreviation key + path aliases)
3. **L0 symbol entries** — symbol blocks for files at L0 stability
4. **L0 file contents** — full file content at L0 stability, preceded by:
   ```
   # Reference Files (Stable)

   These files are included for reference:

   ```

**Cache control placement:**
- **No L0 history:** System message wrapped in structured content format with `cache_control: {type: "ephemeral"}` on the text block
- **Has L0 history:** System message as plain string (no cache_control). L0 history follows as native user/assistant pairs. Cache control on the **last** L0 history message

#### 2. L1, L2, L3 Blocks

Each non-empty tier produces a **user/assistant pair** (if it has symbols or files):
- User message: symbol entries + file contents concatenated
- Assistant message: `"Ok."`

Symbol entries use: `# Repository Structure (continued)\n\n`

File content headers are tier-specific:
- L1: `# Reference Files\n\nThese files are included for reference:\n\n`
- L2: `# Reference Files (L2)\n\nThese files are included for reference:\n\n`
- L3: `# Reference Files (L3)\n\nThese files are included for reference:\n\n`

**Followed by native history messages** for that tier (real user/assistant dicts, not serialized text).

**Cache control** on the **last message** in the tier's combined sequence (the assistant "Ok." or the last history message). Empty tiers are skipped entirely.

#### 3. File Tree (Uncached)

```pseudo
{"role": "user", "content": FILE_TREE_HEADER + file_tree}
{"role": "assistant", "content": "Ok."}
```

`FILE_TREE_HEADER`:
```
# Repository Files

Complete list of files in the repository:

```

The file tree is a **flat sorted list** — one file per line, no indentation, no tree structure:
```
# File Tree (236 files)

.gitignore
README.md
src/main.py
src/utils.py
```

#### 4. URL Context (Uncached)

```pseudo
{"role": "user", "content": URL_CONTEXT_HEADER + "\n---\n".join(url_parts)}
{"role": "assistant", "content": "Ok, I've reviewed the URL content."}
```

`URL_CONTEXT_HEADER`:
```
# URL Context

The following content was fetched from URLs mentioned in the conversation:

```

Each URL part formatted as:
```
## https://example.com/page
**Page Title**

<summary or readme or content, truncated at 4000 chars>

### Symbol Map
```
<symbol map if available>
```
```

Multiple URLs joined with `\n---\n`.

#### 5. Active Files (Uncached)

```pseudo
{"role": "user", "content": FILES_ACTIVE_HEADER + formatted_files}
{"role": "assistant", "content": "Ok."}
```

`FILES_ACTIVE_HEADER`:
```
# Working Files

Here are the files:

```

#### 6. Active History (Uncached)

Native message dicts inserted directly — no wrapping, no headers:
```pseudo
{"role": "user", "content": "please fix the bug"}
{"role": "assistant", "content": "I see the issue..."}
```

#### 7. Current User Message

Plain string or multimodal (if images):
```pseudo
// With images:
{"role": "user", "content": [
    {"type": "text", "text": user_prompt},
    {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
]}

// Without images:
{"role": "user", "content": user_prompt}
```

### File Content Formatting

Files are formatted as fenced code blocks with **no language tags**:

```
<header>

path/to/file.py
```
<full file content>
```

path/to/other.py
```
<full file content>
```
```

Files joined with `\n\n`. If no files have loadable content, the section is omitted.

### History Placement

- **Cached tier history**: Native `{role, content}` message dicts placed after the tier's user/assistant pair but before the cache_control boundary
- **Active history**: Raw message dicts from conversation history, filtered to active-tier indices only
- History graduation to L3 is controlled — only on L3 invalidation piggyback or when eligible tokens exceed cache target (not automatic at N ≥ 3)

### Cache Control Application

The `cache_control` marker wraps content as:
```pseudo
[{type: "text", text: <content>, cache_control: {type: "ephemeral"}}]
```

Applied to the last message in each tier's sequence. Providers typically allow 4 breakpoints per request — each non-empty tier uses one.

### System Reminder

A compact edit format reference exists as a code constant but is **not currently injected** into the streaming message assembly. Available as infrastructure for potential mid-conversation reinforcement.

## Token Usage Extraction

Token usage (including cache statistics) is extracted from the LLM provider's response, not computed locally. The extraction handles multiple provider formats since different providers report cache tokens under different field names:

| Provider | Cache Read Field | Cache Write Field | Source |
|----------|-----------------|-------------------|--------|
| Anthropic direct | `cache_read_input_tokens` | `cache_creation_input_tokens` | `usage` object |
| Bedrock Anthropic | `prompt_tokens_details.cached_tokens` | `cache_creation_input_tokens` | `usage` object or dict |
| OpenAI | `prompt_tokens_details.cached_tokens` | — | `usage` object |
| litellm unified | `cache_read_tokens` | `cache_creation_tokens` | varies |

The extraction function uses a dual-mode getter that handles both attribute access (objects) and key access (dicts), since the `usage` payload format varies by provider and litellm version. Fields are checked in priority order with fallback chains.

**Stream-level usage** is captured from any chunk that includes it (typically the final chunk). **Response-level usage** is merged as a fallback, filling in any fields the stream didn't provide. Completion tokens are estimated from content length (~4 chars/token) only if the provider reported no completion count.

## Token Usage HUD

### Terminal Output
- Per-tier cache block visualization
- Token breakdown: system, symbol map, files, history
- Last request: prompt in, completion out, cache hit/write
- Session cumulative totals

### Browser Overlay
- Context breakdown with tier details
- Cache hit percentage (color-coded)
- This-request stats
- History budget warning
- Tier change notifications
- Auto-hides after ~8 seconds, pauses on hover