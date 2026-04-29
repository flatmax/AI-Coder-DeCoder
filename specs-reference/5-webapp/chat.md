# Reference: Chat Panel

**Supplements:** `specs4/5-webapp/chat.md`

## Byte-level formats

### Request ID format

Generated browser-side for every user-initiated streaming request:

```
{epoch_ms}-{6-char-alnum}
```

Example: `1736956800000-a1b2c3`

- `epoch_ms` — `Date.now()` at request origination, base-10 integer
- `6-char-alnum` — random lowercase letters + digits

Request IDs are the multiplexing primitive for streaming state. See `specs-reference/3-llm/streaming.md` § Request ID format for the canonical definition.

### Finish-reason badge labels

Provider's `finish_reason` normalizes to one of these values via litellm. Each maps to a badge rendered on the assistant message card:

| `finish_reason` | Badge label | CSS class |
|---|---|---|
| `stop` | `✓ stopped` | `.finish-reason.natural` (muted, opacity 0.6) |
| `end_turn` | `✓ end of turn` | `.finish-reason.natural` |
| `length` | `✂️ truncated (max_tokens)` | `.finish-reason.warn` (red border, tinted bg) |
| `content_filter` | `🚫 content filter` | `.finish-reason.warn` |
| `tool_calls` | `🔧 tool call requested` | `.finish-reason.warn` |
| `function_call` | `🔧 function call requested` | `.finish-reason.warn` |
| `null` / missing | (no badge rendered) | — |

Non-natural, non-cancelled stops additionally fire an error toast via the `ac-toast` window event:

| Finish reason | Toast message |
|---|---|
| `length` | `Response truncated — hit max_tokens` |
| `content_filter` | `Response blocked by content filter` |
| Any other non-natural | `Stopped: {reason}` |

Cancelled streams (via the Stop button) suppress both the toast AND the badge — the `[stopped]` marker appended to the response body is the sole signal.

### Compaction event stage routing

The `compactionEvent` channel carries both compaction and URL/doc progress events. The chat panel dispatches on `event.stage`:

| Stage | Feedback type | Action |
|---|---|---|
| `url_fetch` | Transient local toast | Show "Fetching {display_name}..." during streaming |
| `url_ready` | Transient local toast | Show "Fetched {display_name}" success toast |
| `compacting` | Transient local toast | Show "Compacting history..." |
| `compacted` | Message list replacement | Replace `_messages` with `event.messages`; success toast |
| `compaction_error` | Error toast | Show error message; re-enable input |
| `doc_index` | Not handled by chat panel | Intercepted by app shell → doc-index progress overlay |
| `doc_enrichment_queued` | Not handled by chat panel | Routed to header progress bar |
| `doc_enrichment_file_done` | Not handled by chat panel | Updates header progress bar |
| `doc_enrichment_complete` | Not handled by chat panel | Dismisses header progress bar |
| `doc_enrichment_failed` | Debug log | Logged for diagnostic; no user-visible notification |

The handler accepts events for both the current streaming request ID AND the most recently completed request ID, since compaction runs asynchronously ~500ms after `streamComplete`.

### Retry prompt templates

When `streamComplete` arrives with specific failure patterns, the chat panel auto-populates the textarea with a retry prompt. Prompts are NOT auto-sent — the user reviews, edits, and sends when ready.

**Ambiguous anchor retry** — triggered when one or more edit results have `status === "failed"` and `message` contains `"Ambiguous"`:

```
Some edits failed because the old text matched multiple locations in the file. Please retry with more surrounding context lines to make the match unique:

- {file_path}: {error_message}
- {file_path}: {error_message}
```

One bullet per ambiguous failure, in the order they appeared in the original response.

**Not-in-context retry** — triggered when one or more edit results have `status === "not_in_context"`:

Single file:
```
The file {basename} has been added to context. Please retry the edit for: {path}
```

Multiple files:
```
The files {basename1}, {basename2}, {basename3} have been added to context. Please retry the edits for:

- {path1}
- {path2}
- {path3}
```

**Old-text-mismatch retry** — triggered when edit results have `status === "failed"`, `error_type === "anchor_not_found"`, AND the target file is already in the active selection (not in `not_in_context`):

```
The old text you specified does not exist in the file. The file is already in context — please re-read it before retrying:

- {file_path}
```

**Priority when multiple retry conditions fire in the same response:** ambiguous-anchor takes priority, then not-in-context, then old-text-mismatch. Only one prompt auto-populates; the rest are visible in the edit summary banner.

### File mention input accumulation

When a file is added via mention click, the chat input text is accumulated using these templates:

| Current input state | Result after adding file X (basename) |
|---|---|
| Empty | `The file {X} added. Do you want to see more files before you continue?` |
| Matches `The file {Y} added. Do you want to see more files...` | Replaced with `The files {Y}, {X} added. Do you want to see more files before you continue?` |
| Matches `The files {Y1}, {Y2} added. Do you want to see more files...` | Updated to `The files {Y1}, {Y2}, {X} added. Do you want to see more files before you continue?` |
| Ends with `(added {Y})` | Appends ` (added {X})` |
| Any other text | Appends ` (added {X})` |

Only the basename (filename without directory path) is used in the accumulated text.

### System event message content templates

Operational events rendered as `role: "user"` + `system_event: true` messages:

**Commit:**
```
**Committed** `{sha}`

```
{commit_message}
```
```

**Reset to HEAD:**
```
**Reset to HEAD** — all uncommitted changes have been discarded.
```

**Mode switch:**
```
Switched to {mode} mode.
```

(Where `{mode}` is `code` or `document`.)

See `specs-reference/3-llm/history.md` for the full template set including compaction events.

## Numeric constants

### Scroll behavior

| Constant | Value | Purpose |
|---|---|---|
| Scroll-up disengage threshold | 30px | Minimum upward scroll distance during active streaming to disengage auto-scroll |
| IntersectionObserver re-engage margin | 0px (at-bottom) | Observer fires when sentinel becomes fully visible; re-engages auto-scroll |
| Double-rAF scroll settle | 2 animation frames | After DOM updates, wait two frames before setting scrollTop so layout has committed |
| Streaming chunk coalescing | 1 animation frame | rAF callback drains latest chunk; rapid chunks collapse to one re-render |
| Code block scroll preservation | Pre-update snapshot + post-update restore | `scrollLeft` of every `<pre>` captured by index before content replace, restored after |

### Content-visibility thresholds

| Constant | Value |
|---|---|
| Forced-render window | Last 15 messages |
| Intrinsic size hint (user card) | 80px |
| Intrinsic size hint (assistant card) | 200px |
| CSS property (off-screen) | `content-visibility: auto` with `contain: layout style paint` |
| CSS property (force-visible) | `content-visibility: visible` with `contain: none` |

Last 15 messages force full render to keep scroll heights accurate near the bottom where the user is most likely scrolling.

### Input history

| Constant | Value |
|---|---|
| Maximum entries | 100 |
| Duplicate handling | Move to end of list rather than create a second entry |

### Image limits

See `specs4/4-features/images.md`. Pinned here because they affect chat panel paste handling:

| Constant | Value |
|---|---|
| Max size per image | 5 MB |
| Max images per message | 5 |
| Accepted MIME types | `image/png`, `image/jpeg`, `image/gif`, `image/webp` |
| Encoding | base64 data URI |

### Edit block diff highlighting

| Constant | Value |
|---|---|
| Diff algorithm | Myers line diff (via `diff` npm package, `diffLines`) |
| Character diff algorithm | Word-level diff (`diffWords`) |
| Pairing rule | Adjacent `remove` runs followed by `add` runs of the same length are paired 1:1 for character-level diff |

### Compaction post-response timing

| Constant | Value |
|---|---|
| Delay after streamComplete before compaction check | 500ms |
| compactionEvent delivery retry (max attempts) | 3 |
| compactionEvent delivery retry delay | 1 second |

See `specs-reference/3-llm/history.md` and `specs-reference/3-llm/streaming.md` for the full compaction protocol.

## Schemas

### localStorage keys

| Key | Type | Purpose |
|---|---|---|
| `ac-dc-snippet-drawer` | `"true"` / `"false"` | Snippet drawer open/closed state |
| `ac-dc-search-ignore-case` | `"true"` / `"false"` | Search toggle: ignore case (default `"true"`) |
| `ac-dc-search-regex` | `"true"` / `"false"` | Search toggle: regex mode (default `"false"`) |
| `ac-dc-search-whole-word` | `"true"` / `"false"` | Search toggle: whole word (default `"false"`) |

Input history is NOT persisted — session-scoped only.

### Cross-component flag

| Flag | Owner | Purpose |
|---|---|---|
| `_suppressNextPaste` | Chat panel instance | Set to `true` by the files-tab's middle-click path insertion BEFORE calling `chatPanel.focus()`. Consumed (cleared + `preventDefault()` called) on the very next `paste` event. Ensures the browser's selection-buffer paste from middle-click doesn't duplicate the inserted path |

## Dependency quirks

### `marked` library — two separate instances

The chat panel uses a dedicated `Marked` instance (`markedChat`) with custom renderers. A completely independent instance (`markedSourceMap`) is used by the diff viewer's markdown preview for source-line tracking. They share KaTeX math rendering via a shared extension but do NOT share renderer overrides.

### Scroll listener attachment for streaming

The IntersectionObserver alone is insufficient for scroll-up detection during active streaming — content reflows can briefly push the sentinel out of view, which would falsely disengage auto-scroll. A separate passive scroll listener tracks `_lastScrollTop` and only disengages when the user scrolls UPWARD by more than 30px. The observer only re-engages; it never disengages during active streaming.

### Shadow-DOM textarea undo

Native `document.execCommand('undo')` is broken inside shadow-DOM textareas when the component programmatically sets `value`. The chat panel's keydown handler intercepts Ctrl+Z and Ctrl+Shift+Z / Ctrl+Y and explicitly calls `execCommand('undo')` / `execCommand('redo')` to work around this.

## Cross-references

- Behavioral specification (message display, streaming, input area, search integration): `specs4/5-webapp/chat.md`
- Request ID format and stream multiplexing: `specs-reference/3-llm/streaming.md`
- Edit block marker bytes (edit-block rendering): `specs-reference/3-llm/edit-protocol.md`
- Compaction event payload shapes: `specs-reference/3-llm/streaming.md` § compactionEvent
- System event message templates: `specs-reference/3-llm/history.md`
- Image persistence (paste format, storage): `specs-reference/4-features/doc-convert.md` — wait, that's the wrong reference. See `specs4/4-features/images.md`