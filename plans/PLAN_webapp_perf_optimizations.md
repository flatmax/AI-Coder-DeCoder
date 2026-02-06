# Plan: Webapp Performance Optimizations

## Goal
Reduce unnecessary re-renders, RPC calls, and allocations in the webapp — particularly during streaming and for large conversations.

## Changes grouped by phase

### Phase 1 — Low-effort, high-confidence fixes

These are safe, isolated changes with clear wins and no behavioral risk.

#### 1a. Stabilize array props passed to assistant-card
**Files:** `webapp/src/PromptView.js`, `webapp/src/prompt/PromptViewTemplate.js`

**Problem:** `PromptViewTemplate` passes `component._addableFiles` and `component.selectedFiles` to every `<assistant-card>`. When either array reference changes (e.g. checkbox toggle), Lit re-renders *all* assistant cards even though their content hasn't changed.

**Fix:**
- In `PromptView.willUpdate`, the `_stableSelectedFiles` logic already exists but `_addableFiles` is only reference-compared against itself. Ensure both arrays are frozen references that only change when contents actually differ.
- In `AssistantCard`, expand `shouldUpdate` to also short-circuit when `editResults`, `mentionedFiles`, and `selectedFiles` are reference-equal to previous values.

**Impact:** High — largest single perf win for conversations with 10+ messages.

#### 1b. Guard getAddableFiles tree walk
**Files:** `webapp/src/PromptView.js`

**Problem:** `willUpdate` calls `getAddableFiles()` which walks the entire file tree on every `fileTree` property change. Since `loadFileTree` always creates a new object, this runs on every tree refresh even when the tree structure is unchanged.

**Fix:** Compare `fileTree` reference before calling `getAddableFiles()`. The existing code already does a length+element comparison on the result — just need to skip the walk entirely when the tree ref hasn't changed.

**Impact:** Medium — avoids O(n) tree walk on every file tree refresh.

#### 1c. Skip ViewerDataMixin timer when refresh in-flight
**Files:** `webapp/src/context-viewer/ViewerDataMixin.js`

**Problem:** `_viewerDataWillUpdate` sets a new 100ms timer even while `_refreshPromise` is still pending, causing back-to-back RPC calls.

**Fix:** Check `this._refreshPromise` before setting the timer:
```js
if (this.rpcCall && this.visible && !this._refreshPromise) {
```

**Impact:** Low-Medium — saves redundant RPC round-trips when multiple properties change.

#### 1d. Deduplicate PromptView._refreshHistoryBar
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

**Problem:** `shouldUpdate` only short-circuits when `content` is the sole changed property with the same value. During streaming, `selectedFiles` or `mentionedFiles` array reference changes cause all cards to re-render.

**Fix:**
```js
shouldUpdate(changedProperties) {
  for (const [key, oldVal] of changedProperties) {
    if (this[key] !== oldVal) return true;
  }
  return false;
}
```
This uses reference equality for all properties — arrays that haven't changed keep the same reference (guaranteed by Phase 1a).

**Impact:** Medium — reduces child re-renders during streaming and file selection changes.

#### 2b. Improve collectFilesInDir cache invalidation
**Files:** `webapp/src/file-picker/FileSelectionMixin.js`

**Problem:** The memoization cache is keyed by `currentPath` but invalidated whenever the `tree` *reference* changes. Since `loadFileTree` always returns a new object, the cache is blown on every refresh even when tree content is unchanged.

**Fix:** Instead of comparing tree reference, compare a lightweight signature (e.g. count of children at root, or a hash of file paths). Alternatively, have `loadFileTree` in `FileHandlerMixin` preserve the old tree reference when content is structurally equal.

Preferred approach — in `FileHandlerMixin.loadFileTree`, compare `JSON.stringify(data.tree)` against cached string and reuse the old object:
```js
const treeJson = JSON.stringify(data.tree);
if (treeJson !== this._lastTreeJson) {
  this._lastTreeJson = treeJson;
  this.fileTree = data.tree;
}
```

**Impact:** Medium — avoids re-walking tree for directory selection state.

#### 2c. Cancel stale search requests
**Files:** `webapp/src/history-browser/HistoryBrowser.js`, `webapp/src/find-in-files/FindInFiles.js`

**Problem:** Rapid typing can result in multiple concurrent RPC search calls. Earlier results may arrive after later ones, showing stale results.

**Fix:** Use a generation counter. Increment on each search call, ignore results from older generations:
```js
this._searchGen = (this._searchGen || 0) + 1;
const gen = this._searchGen;
const result = await this._rpcWithState(...);
if (gen !== this._searchGen) return; // stale
this.results = result || [];
```

**Impact:** Low — prevents rare stale-result display.

### Phase 3 — Higher-effort, optional

#### 3a. CardMarkdown: guard willUpdate code-scroll save
**Files:** `webapp/src/prompt/CardMarkdown.js`

**Problem:** `willUpdate` iterates all `<pre>` elements on every update to save scroll positions, even when no code blocks exist in the message.

**Fix:** Set a `_hasCodeBlocks` flag in `processContent` when code fences are detected, skip the `querySelectorAll` loop when false.

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

1. Phase 1a + 1b + 1c + 1d (batch — all low-risk, independent)
2. Phase 2a (depends on 1a for stable references)
3. Phase 2b (independent)
4. Phase 2c (independent)
5. Phase 3 items (optional, as time permits)

## Testing

- Manual: open a conversation with 20+ messages, toggle file selection, verify no visible lag
- Manual: stream a long response, verify smooth scrolling and no redundant flicker
- Manual: switch between Files/Search/Context/Cache tabs rapidly, verify no duplicate RPC calls in network inspector
- Manual: open history browser, type rapidly in search, verify results are consistent (not stale)

## Risk assessment

All Phase 1 changes are reference-equality checks or guard clauses — they reduce work without changing behavior. Phase 2a relies on Phase 1a providing stable references; if a reference unexpectedly changes, the card would still re-render (safe fallback). Phase 2b's tree comparison adds a `JSON.stringify` cost on each refresh, but this is far cheaper than the downstream tree walks it prevents. Phase 3 items are optional polish.
