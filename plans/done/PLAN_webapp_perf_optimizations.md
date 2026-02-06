# Plan: Webapp Performance Optimizations
 
## Goal
Reduce unnecessary re-renders, RPC calls, and allocations in the webapp — particularly during streaming and for large conversations.

## Changes grouped by phase

### Phase 1 — Low-effort, high-confidence fixes

These are safe, isolated changes with clear wins and no behavioral risk.

#### 1a. Stabilize empty-array allocations in PromptViewTemplate
**Files:** `webapp/src/prompt/PromptViewTemplate.js`

**Problem:** In the `repeat()` loop, `message.editResults || []` and `message.images || []` create a **new empty array on every render** for messages without those properties. This defeats reference equality in `shouldUpdate` — every assistant-card sees a "changed" `editResults` prop on every render cycle.

**Fix:** Define a module-level `const EMPTY_ARRAY = [];` and use it as the fallback:
```js
const EMPTY_ARRAY = [];
// ...
.editResults=${message.editResults || EMPTY_ARRAY}
.images=${message.images || EMPTY_ARRAY}
```

**Impact:** High — prerequisite for `shouldUpdate` optimizations to work. Without this, reference equality checks always fail for messages without edit results/images.

#### 1b. Skip ViewerDataMixin timer when refresh in-flight
**Files:** `webapp/src/context-viewer/ViewerDataMixin.js`

**Problem:** `_viewerDataWillUpdate` sets a new 100ms timer even while `_refreshPromise` is still pending, causing back-to-back RPC calls.

**Fix:** Check `this._refreshPromise` before setting the timer:
```js
if (this.rpcCall && this.visible && !this._refreshPromise) {
```

**Impact:** Low-Medium — saves redundant RPC round-trips when multiple properties change.

#### 1c. Deduplicate PromptView._refreshHistoryBar
**Files:** `webapp/src/PromptView.js`

**Problem:** Called from `setupDone`, `loadLastSession`, `handleLoadSession`, and tab switches. Multiple calls can overlap with no dedup.

**Fix:** Use a pending-promise pattern (same as `ViewerDataMixin.refreshBreakdown`):
```js
async _refreshHistoryBar() {
  if (this._refreshHistoryBarPromise) return this._refreshHistoryBarPromise;
  this._refreshHistoryBarPromise = this._doRefreshHistoryBar();
  try { await this._refreshHistoryBarPromise; }
  finally { this._refreshHistoryBarPromise = null; }
}
```

**Impact:** Low — prevents redundant RPC calls on startup.

### Phase 2 — Medium-effort improvements

#### 2a. Expand AssistantCard.shouldUpdate
**Files:** `webapp/src/prompt/AssistantCard.js`

**Problem:** `shouldUpdate` only short-circuits when `content` is the sole changed property with the same value. During streaming, `selectedFiles` or `mentionedFiles` array reference changes cause all cards to re-render even though the values are identical.

**Fix:**
```js
shouldUpdate(changedProperties) {
  for (const [key, oldVal] of changedProperties) {
    if (this[key] !== oldVal) return true;
  }
  return false;
}
```
This uses reference equality for all properties. Combined with Phase 1a (stable empty-array references), arrays that haven't actually changed keep the same reference and are correctly skipped.

**Impact:** High — largest single perf win for conversations with 10+ messages. Prevents re-rendering all assistant cards when file selection changes or during streaming.

**Note:** `PromptView.willUpdate` already stabilizes `_addableFiles` and `_stableSelectedFiles` with proper length+element comparison, so those references only change when contents actually differ. Phase 1a ensures `editResults` and `images` fallbacks are also stable.

#### 2b. Stabilize fileTree reference in loadFileTree
**Files:** `webapp/src/prompt/FileHandlerMixin.js`

**Problem:** `loadFileTree` always assigns `this.fileTree = data.tree`, creating a new object reference even when the tree content is unchanged. This triggers:
- `PromptView.willUpdate` to re-run `getAddableFiles()` (O(n) tree walk)
- `FileSelectionMixin`'s `collectFilesInDir` cache to be blown (keyed on tree reference)

**Fix:** Compare `JSON.stringify(data.tree)` against a cached string and reuse the old object when unchanged:
```js
const treeJson = JSON.stringify(data.tree);
if (treeJson !== this._lastTreeJson) {
  this._lastTreeJson = treeJson;
  this.fileTree = data.tree;
}
```

**Impact:** Medium — avoids O(n) tree walk and cache invalidation on every tree refresh. The `JSON.stringify` cost is far cheaper than the downstream walks it prevents.

#### 2c. Cancel stale search requests
**Files:** `webapp/src/history-browser/HistoryBrowser.js`, `webapp/src/find-in-files/FindInFiles.js`

**Problem:** Rapid typing can result in multiple concurrent RPC search calls. Earlier results may arrive after later ones, showing stale results. The `debounce` limits frequency but doesn't prevent overlapping in-flight requests.

**Fix:** Use a generation counter. Increment on each search call, ignore results from older generations:
```js
this._searchGen = (this._searchGen || 0) + 1;
const gen = this._searchGen;
const result = await this._rpc(...);
if (gen !== this._searchGen) return; // stale
this.results = result || [];
```

**Impact:** Low — correctness fix for a rare edge case more than a perf issue.

### Phase 3 — Higher-effort, optional

#### 3a. CardMarkdown: guard willUpdate code-scroll save
**Files:** `webapp/src/prompt/CardMarkdown.js`

**Problem:** `willUpdate` iterates all `<pre>` elements on every update to save scroll positions, even when no code blocks exist in the message.

**Fix:** Check `this.content?.includes('```')` directly in `willUpdate` before doing the `querySelectorAll` loop. This is a cheap string search that avoids DOM traversal for messages without code blocks. (Note: cannot use a flag set in `processContent` because `willUpdate` runs before `render`.)

**Impact:** Low — micro-optimization, only matters for very long conversations.

#### 3b. Reduce diff.js LRU cache size
**Files:** `webapp/src/utils/diff.js`

**Problem:** 32-entry cache is larger than needed. In practice, only the most recent message's edit blocks are re-rendered. Old entries waste memory.

**Fix:** Reduce `_DIFF_CACHE_MAX` from 32 to 12.

**Impact:** Low — minor memory savings.

#### 3c. Lazy-load Prism grammars
**Files:** `webapp/src/prompt/PrismSetup.js`, `webapp/src/prompt/CardMarkdown.js`

**Problem:** 7 Prism language grammars are imported unconditionally at startup (~15KB gzipped).

**Fix:** Dynamic `import()` on first code block render, with a sync fallback (unhighlighted) until loaded.

**Impact:** Low — faster initial page load, but Prism is small and typically needed quickly.

## Implementation order

All phases implemented:

- [x] **Phase 1a** — Stable `EMPTY_ARRAY` fallbacks in `PromptViewTemplate.js`
- [x] **Phase 1b** — Guard `_viewerDataWillUpdate` timer in `ViewerDataMixin.js`
- [x] **Phase 1c** — Deduplicate `_refreshHistoryBar` in `PromptView.js`
- [x] **Phase 2a** — Generic reference-equality `shouldUpdate` in `AssistantCard.js`
- [x] **Phase 2b** — Stabilize `fileTree` reference in `FileHandlerMixin.js`
- [x] **Phase 2c** — Generation counters in `FindInFiles.js` and `HistoryBrowser.js`
- [x] **Phase 3a** — Guard `willUpdate` DOM traversal in `CardMarkdown.js`
- [x] **Phase 3b** — Reduce diff LRU cache to 12 entries in `diff.js`
- [ ] **Phase 3c** — Lazy-load Prism grammars (deferred — low impact, Prism is small)

## Testing

- Manual: open a conversation with 20+ messages, toggle file selection, verify no visible lag
- Manual: stream a long response, verify smooth scrolling and no redundant flicker
- Manual: switch between Files/Search/Context/Cache tabs rapidly, verify no duplicate RPC calls in network inspector
- Manual: open history browser, type rapidly in search, verify results are consistent (not stale)

## Risk assessment

All Phase 1 changes are constant replacements or guard clauses — they reduce work without changing behavior. Phase 2a relies on Phase 1a providing stable array references; if a reference unexpectedly changes, the card would still re-render (safe fallback — `shouldUpdate` returns true). Phase 2b's `JSON.stringify` comparison adds a small cost on each tree refresh, but this is far cheaper than the downstream tree walks and cache invalidations it prevents. Phase 3 items are optional polish.
