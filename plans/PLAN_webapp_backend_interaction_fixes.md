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

## Fixes (in implementation order)

---

### Fix 1: Separate `isCompacting` flag

**Severity:** 🔴 High — **Effort:** 🟢 Low — **Risk:** 🟢 Low

**Problem:** `compactionEvent` reuses `isStreaming` to disable input during compaction. But `streamComplete` runs as fire-and-forget in the frontend, so it can set `isStreaming = false` *after* compaction sets it `true`, causing the compaction spinner to vanish prematurely.

**Changes:**

- **`webapp/src/prompt/StreamingMixin.js`**:
  - Add `isCompacting: { type: Boolean }` to properties
  - `initStreaming()`: set `this.isCompacting = false`
  - `compactionEvent(compaction_start)`: set `this.isCompacting = true` instead of `this.isStreaming = true`
  - `compactionEvent(compaction_complete)`: set `this.isCompacting = false` instead of `this.isStreaming = false`
  - `compactionEvent(compaction_error)`: set `this.isCompacting = false` instead of `this.isStreaming = false`

- **`webapp/src/prompt/PromptViewTemplate.js`**:
  - Update textarea `?disabled` to: `?disabled=${component.isStreaming || component.isCompacting}`
  - Update send/stop button to also check `isCompacting`

---

### Fix 2: Await `streamComplete` instead of fire-and-forget sleep

**Severity:** 🔴 High — **Effort:** 🟢 Low — **Risk:** 🟢 Low

**Problem:** `_send_stream_complete` uses `asyncio.create_task()` + `asyncio.sleep(0.1)` hoping the message sends in time. If the event loop is loaded, the parent coroutine can exit before the task completes. `streamComplete` is the most critical callback — losing it means the UI hangs forever.

**Changes:**

- **`ac/llm/streaming.py`** — `_send_stream_complete`:
  - Replace `asyncio.create_task(...)` + `asyncio.sleep(0.1)` with direct `await` wrapped in timeout:
    ```python
    try:
        await asyncio.wait_for(
            call['PromptView.streamComplete'](request_id, result),
            timeout=5.0
        )
    except (asyncio.TimeoutError, Exception) as e:
        print(f"⚠️ streamComplete failed for {request_id}: {e}")
    ```

- **`ac/llm/streaming.py`** — `_send_compaction_event`:
  - Same pattern: await with timeout instead of create_task + sleep
  - Catch broad `Exception` since JRPC transport errors may not be `TimeoutError`

---

### Fix 3: Add streaming timeout watchdog

**Severity:** 🟡 Medium — **Effort:** 🟢 Low — **Risk:** 🟢 Low

**Problem:** If `streamComplete` is never received (backend crash, network issue, exception after chunks started), the frontend stays in `isStreaming = true` forever. User must reload the page.

**Changes:**

- **`webapp/src/prompt/StreamingMixin.js`**:
  - `initStreaming()`: add `this._streamingTimeout = null`
  - New method `_startStreamingWatchdog()`: sets a 5-minute timeout that forces recovery
    ```javascript
    _startStreamingWatchdog() {
      this._clearStreamingWatchdog();
      this._streamingTimeout = setTimeout(() => {
        if (this.isStreaming) {
          console.warn('Streaming timeout - forcing recovery');
          this.isStreaming = false;
          this._streamingRequests.clear();
          this.addMessage('assistant', '⚠️ Response timed out. Please try again.');
        }
      }, 5 * 60 * 1000);
    }
    ```
  - New method `_clearStreamingWatchdog()`: clears the timeout
  - `streamComplete()`: call `this._clearStreamingWatchdog()`
  - `stopStreaming()`: call `this._clearStreamingWatchdog()`

- **`webapp/src/prompt/ChatActionsMixin.js`** — `sendMessage`:
  - After `this.isStreaming = true`, call `this._startStreamingWatchdog()`

---

### Fix 4: Flush pending chunks before sending complete

**Severity:** 🟡 Medium — **Effort:** 🟢 Low — **Risk:** 🟢 Low

**Problem:** Chunks use `asyncio.run_coroutine_threadsafe()` from a thread, but `streamComplete` uses `asyncio.create_task()` from async context. A late chunk scheduled via `run_coroutine_threadsafe` can arrive on the frontend *after* `streamComplete`, causing the final message to be missing its last content.

**Changes:**

- **`ac/llm/streaming.py`** — `_stream_chat`:
  - After `await loop.run_in_executor(...)` returns, yield to the event loop to flush pending chunk coroutines.
  - `await asyncio.sleep(0)` yields one event loop iteration, which should process any already-queued `run_coroutine_threadsafe` callbacks. If testing shows this is insufficient (callbacks queued but not yet dispatched), use `await asyncio.sleep(0.01)` to yield a full tick. Use the smallest value that reliably flushes.
    ```python
    full_content, was_cancelled = await loop.run_in_executor(...)
    # Flush any pending chunk coroutines scheduled from the thread
    await asyncio.sleep(0)
    ```

---

### Fix 5: Fix compaction event ordering

**Severity:** 🟡 Medium — **Effort:** 🟢 Low — **Risk:** 🟢 Low

**Problem:** Backend sends `streamComplete` then immediately starts compaction and sends `compactionEvent`. Frontend's `streamComplete` handler is fire-and-forget (`Promise.resolve().then(async () => ...)`), so it may not have finished processing when `compactionEvent(compaction_start)` arrives, causing compaction messages to appear before the assistant's response is fully rendered.

Largely mitigated by Fix 1 (separate `isCompacting` flag), but the visual ordering still matters.

**Changes:**

- **`ac/llm/streaming.py`** — `_run_post_response_compaction`:
  - Add a delay before starting compaction to give the frontend time to process `streamComplete`:
    ```python
    await asyncio.sleep(0.5)  # Let frontend process streamComplete
    ```
  - This is pragmatic. A proper ack-based solution would be higher complexity for marginal benefit.

---

## Implementation Order

1. **Fix 1** — Separate `isCompacting` flag (frontend-only, immediate UX fix)
2. **Fix 2** — Await `streamComplete` properly (backend-only, prevents UI hangs)
3. **Fix 3** — Streaming timeout watchdog (frontend-only, additive safety net)
4. **Fix 4** — Flush pending chunks before complete (backend-only, one-line change)
5. **Fix 5** — Compaction ordering delay (backend-only, one-line change)

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
