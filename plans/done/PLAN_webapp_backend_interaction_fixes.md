# Plan: Webapp ↔ Backend Interaction Fixes

## Problem

Several issues identified in the RPC interaction between the webapp frontend and Python backend, including race conditions, missing error recovery, and fire-and-forget messaging that can lose critical events.

## Investigated and confirmed non-issues

### `fetchedUrls` Object vs Array type mismatch — NOT A BUG

Investigated the full data flow and confirmed it works correctly at runtime:

1. `PromptView.fetchedUrls` = Object `{ url: result }` (used internally)
2. Templates pass `Object.keys(component.fetchedUrls || {})` to viewers → Array of URL strings
3. `ViewerDataMixin.fetchedUrls` declared as `{ type: Array }` — receives array of strings ✓
4. `getIncludedUrls()` calls `.filter()` on array of strings by `excludedUrls` Set → works ✓
5. `refreshBreakdown()` passes string array to `get_context_breakdown` → works ✓
6. Viewer templates get structured item data from backend breakdown, not from `fetchedUrls` directly ✓

No code change needed. The Object→Array conversion happens at the template boundary.

### Duplicate URL fetching — DEFERRED

Frontend fetches URLs via `UrlService`, pastes summaries as text into user message. Backend independently detects and re-fetches the same URLs. This is wasteful but not broken — the backend fetch is actually a safety net for URLs that appear without frontend pre-fetching. Fixing requires an API signature change to `chat_streaming` which is a cross-stack contract change. Deferred to a separate plan.

---

## Fixes — All Implemented ✅

---

### Fix 1: Separate `isCompacting` flag ✅

**Severity:** 🔴 High — **Effort:** 🟢 Low — **Risk:** 🟢 Low

**Problem:** `compactionEvent` reused `isStreaming` to disable input during compaction. But `streamComplete` could set `isStreaming = false` *after* compaction sets it `true`, causing the compaction spinner to vanish prematurely.

**Changes applied:**

- **`webapp/src/prompt/StreamingMixin.js`**:
  - Added `isCompacting: { type: Boolean }` to properties
  - `initStreaming()`: initializes `this.isCompacting = false`
  - `compactionEvent(compaction_start)`: sets `this.isCompacting = true`
  - `compactionEvent(compaction_complete)`: sets `this.isCompacting = false`
  - `compactionEvent(compaction_error)`: sets `this.isCompacting = false`

- **`webapp/src/prompt/PromptViewTemplate.js`**:
  - Textarea `?disabled` checks `component.isStreaming || component.isCompacting`
  - Send/stop button checks both flags

---

### Fix 2: Await `streamComplete` instead of fire-and-forget sleep ✅

**Severity:** 🔴 High — **Effort:** 🟢 Low — **Risk:** 🟢 Low

**Problem:** `_send_stream_complete` used `asyncio.create_task()` + `asyncio.sleep(0.1)` hoping the message sends in time. If the event loop was loaded, the parent coroutine could exit before the task completes.

**Changes applied:**

- **`ac/llm/streaming.py`** — `_send_stream_complete`:
  - Replaced fire-and-forget with `await asyncio.wait_for(..., timeout=5.0)`
  - Catches `asyncio.TimeoutError` and `Exception` separately

- **`ac/llm/streaming.py`** — `_send_compaction_event`:
  - Same pattern: `await asyncio.wait_for(..., timeout=5.0)`

---

### Fix 3: Streaming timeout watchdog ✅

**Severity:** 🟡 Medium — **Effort:** 🟢 Low — **Risk:** 🟢 Low

**Problem:** If `streamComplete` was never received, the frontend stayed in `isStreaming = true` forever.

**Changes applied:**

- **`webapp/src/prompt/StreamingMixin.js`**:
  - `initStreaming()`: initializes `this._streamingTimeout = null`
  - Added `_startStreamingWatchdog()`: 5-minute timeout that forces recovery
  - Added `_clearStreamingWatchdog()`: clears the timeout
  - `streamComplete()`: calls `_clearStreamingWatchdog()`
  - `stopStreaming()`: calls `_clearStreamingWatchdog()`

- **`webapp/src/prompt/ChatActionsMixin.js`** — `sendMessage`:
  - Calls `this._startStreamingWatchdog()` after setting `isStreaming = true`

---

### Fix 4: Flush pending chunks before sending complete ✅

**Severity:** 🟡 Medium — **Effort:** 🟢 Low — **Risk:** 🟢 Low

**Problem:** Late chunks scheduled via `run_coroutine_threadsafe` could arrive after `streamComplete`.

**Changes applied:**

- **`ac/llm/streaming.py`** — `_stream_chat`:
  - Added `await asyncio.sleep(0)` after `run_in_executor` returns to flush pending coroutines

---

### Fix 5: Fix compaction event ordering ✅

**Severity:** 🟡 Medium — **Effort:** 🟢 Low — **Risk:** 🟢 Low

**Problem:** Backend could send `compactionEvent` before frontend finished processing `streamComplete`.

**Changes applied:**

- **`ac/llm/streaming.py`** — `_run_post_response_compaction`:
  - Added `await asyncio.sleep(0.5)` before sending `compaction_start` event

---

## Testing

- **Fix 1**: Send many messages to trigger compaction. Verify compaction notice appears with input disabled, independently from streaming state.
- **Fix 2**: Monitor backend logs during normal streaming. Verify no timeout warnings. Test with slow responses.
- **Fix 3**: Kill the backend process mid-stream. Verify frontend recovers after 5 minutes with error message instead of hanging forever.
- **Fix 4**: Send a message and verify the completed message contains all streamed content (no truncation of final chunk).
- **Fix 5**: Trigger compaction. Verify compaction notice appears *after* the assistant's response is fully rendered.

## Files Modified

| Fix | Files |
|-----|-------|
| 1 | `webapp/src/prompt/StreamingMixin.js`, `webapp/src/prompt/PromptViewTemplate.js` |
| 2 | `ac/llm/streaming.py` |
| 3 | `webapp/src/prompt/StreamingMixin.js`, `webapp/src/prompt/ChatActionsMixin.js` |
| 4 | `ac/llm/streaming.py` |
| 5 | `ac/llm/streaming.py` |
