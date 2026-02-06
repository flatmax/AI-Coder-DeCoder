# Plan: Webapp Code Improvements

## Overview
Address 10 identified code quality, performance, and maintainability issues in the webapp frontend.

## Issues & Fixes

### 1. Remove duplicate `extractResponse` in PromptView
**Files**: `webapp/src/PromptView.js`
**Problem**: `PromptView.extractResponse()` reimplements logic already in `webapp/src/utils/rpc.js`.
**Fix**: Import `extractResponse` from `utils/rpc.js`, remove the inline method. Update all internal callers (`setupDone`, `loadLastSession`, `loadPromptSnippets`, `sendMessage`, etc.) to use the imported version. Keep the method on the class as a thin wrapper if needed by mixins that reference `this.extractResponse`.

### 2. Remove console.log debug spam
**Files**: `webapp/src/PromptView.js`
**Problem**: `loadLastSession()` has 6 `console.log` calls with 📜 prefixes that are debug leftovers.
**Fix**: Delete all `console.log('📜 ...')` lines in `loadLastSession()`. Keep `console.warn` for actual error paths.

### 3. Split PromptViewTemplate.js into focused modules
**Files**: `webapp/src/prompt/PromptViewTemplate.js`
**Problem**: 400-line monolith mixing HUD, URL chips, resize handles, snippets, history bar, and main layout.
**Fix**: Extract into separate template helper files:
- `webapp/src/prompt/HudTemplate.js` — `renderHud()`, `renderCacheTiers()`, `renderPromotions()`
- `webapp/src/prompt/UrlChipsTemplate.js` — `renderUrlChips()`
- `webapp/src/prompt/HistoryBarTemplate.js` — `renderHistoryBar()`
- `webapp/src/prompt/SnippetTemplate.js` — `renderSnippetButtons()`
- Keep `renderResizeHandles()`, `renderPanelResizer()` in `PromptViewTemplate.js` (small, structural)
- `renderPromptView()` stays in `PromptViewTemplate.js` but imports from the new modules.

### 4. Cache `getAddableFiles()` result instead of recomputing per render
**Files**: `webapp/src/prompt/FileHandlerMixin.js`, `webapp/src/prompt/PromptViewTemplate.js`
**Problem**: `getAddableFiles()` walks the entire file tree recursively and is called for every assistant card on every render.
**Fix**:
- Add a cached `_addableFiles` property to `PromptView`.
- Recompute it only when `fileTree` changes (in `willUpdate` or after `loadFileTree()`).
- Template reads `component._addableFiles` instead of calling `component.getAddableFiles()`.

### 5. Memoize `_getSelectedObject()` to avoid unnecessary FilePicker re-renders
**Files**: `webapp/src/PromptView.js`, `webapp/src/prompt/PromptViewTemplate.js`
**Problem**: `_getSelectedObject()` creates a new object reference every render, triggering unnecessary updates in `FilePicker`.
**Fix**:
- Store as `_selectedObject` property.
- Recompute only when `selectedFiles` changes (in `willUpdate`).
- Template reads `component._selectedObject`.

### 6. Add user-facing error feedback for failed RPC operations
**Files**: `webapp/src/prompt/FileHandlerMixin.js`, `webapp/src/PromptView.js`
**Problem**: Several RPC calls silently swallow errors (git operations, history bar refresh, file tree load).
**Fix**:
- `handleGitOperation`: Show a brief error message via `addMessage('assistant', ...)` on failure.
- `_refreshHistoryBar`: Already has `console.warn`, acceptable as-is (non-critical).
- `loadFileTree`: Add user feedback if tree fails to load (e.g., status message).

### 7. Batch UrlService state notifications to reduce render cycles
**Files**: `webapp/src/PromptView.js`, `webapp/src/services/UrlService.js`
**Problem**: Every `_notifyStateChange()` sets 4 Lit properties, triggering up to 4 update cycles.
**Fix**: Use `requestAnimationFrame` or microtask batching in the state change callback:
```js
(state) => {
  // Batch all property changes into a single update cycle
  this.detectedUrls = state.detectedUrls;
  this.fetchingUrls = state.fetchingUrls;
  this.fetchedUrls = state.fetchedUrls;
  this.excludedUrls = state.excludedUrls;
}
```
Lit already batches synchronous property sets into a single update, so the current code is actually fine for Lit's microtask scheduling. However, the real fix is to check for actual changes before assigning:
```js
if (this.detectedUrls !== state.detectedUrls) this.detectedUrls = state.detectedUrls;
// etc.
```
Or switch to a single `_urlState` object property and compare by reference.

### 8. Document mixin contracts (low effort, high value)
**Files**: Each mixin file
**Problem**: 5 mixins deep, all with implicit property/method contracts. Methods reach into `this.call`, `this.selectedFiles`, etc. without any documented interface.
**Fix**: Add JSDoc `@requires` or `@expects` comments at the top of each mixin documenting:
- Which properties it reads from `this`
- Which methods it expects to exist
- Which properties/methods it provides

Not a refactor — just documentation. Consider consolidating `InputHandlerMixin` + `ChatActionsMixin` in a future pass.

### 9. Define tab name constants
**Files**: New `webapp/src/utils/constants.js`, then update `PromptView.js`, `PromptViewTemplate.js`, `AppShell.js`
**Problem**: Tab names `'files'`, `'search'`, `'context'`, `'cache'`, `'settings'` are magic strings.
**Fix**: Create constants:
```js
export const TABS = {
  FILES: 'files',
  SEARCH: 'search',
  CONTEXT: 'context',
  CACHE: 'cache',
  SETTINGS: 'settings',
};
```
Replace magic strings with constant references.

### 10. Consider a scroll state controller (future)
**Files**: `webapp/src/MessageHandler.js`, `webapp/src/PromptView.js`
**Problem**: Scroll state (`_userHasScrolledUp`, `_showScrollButton`, `_savedWasAtBottom`, `_savedScrollRatio`, `ResizeObserver`) is spread across `MessageHandler` and `PromptView` with complex interactions.
**Fix**: Low priority. Document current scroll state flow as a first step. A dedicated `ScrollController` (Lit reactive controller) could own all scroll state in a future refactor.

## Phased Implementation

### Phase 1: Quick Cleanup (5 min, zero risk) ✅
Low-effort fixes that can't break anything.

- [x] **#2** — Remove console.log debug spam (was already clean)

### Phase 2: Render Performance (15 min) ✅
Eliminate unnecessary work on every render cycle.

- [x] **#5** — Memoize `_getSelectedObject` (was already implemented)
- [x] **#4** — Cache `getAddableFiles` (was already implemented)

### Phase 3: Code Hygiene (30 min) ✅
Improve maintainability without changing behavior.

- [x] **#1** — Deduplicate `extractResponse` — Confirmed NOT a JRPC callback. PromptView.extractResponse now delegates to shared `_extractResponse` from `utils/rpc.js`. Kept as thin wrapper since mixins call `this.extractResponse()`.
- [x] **#9** — Define tab name constants in `webapp/src/utils/constants.js`. Replaced all magic strings in `PromptView.js`, `PromptViewTemplate.js`, and `AppShell.js`.
- [x] **#8** — Document mixin contracts with JSDoc `@requires`/`@provides` on all 5 mixins.

### Phase 4: User Experience (15 min) ✅
Surface errors that are currently swallowed.

- [x] **#6** — Add error feedback for `handleGitOperation` and `loadFileTree` failures via `addMessage()`.

### Phase 5: Template Refactor (30 min) ✅
Biggest structural change — do last when everything else is stable.

- [x] **#3** — Split PromptViewTemplate.js into focused modules. Extracted `HudTemplate.js`, `UrlChipsTemplate.js`, `HistoryBarTemplate.js`, `SnippetTemplate.js`. `renderResizeHandles()` and `renderPanelResizer()` remain in `PromptViewTemplate.js`. Main `renderPromptView()` imports from all sub-modules.

**Verify**: Full manual pass — HUD, URL chips, snippets, history bar, resize handles, all tabs, streaming. Verify no dead imports remain (grep for old import paths).

### Phase 6: Future / Skip
Not scheduled — needs design work or profiling first.

- [ ] **#10** — Scroll state controller
- [ ] **#7** — Batch URL state notifications — Lit already batches synchronous property sets into a single microtask update, so setting 4 properties in a callback triggers one render, not four. Skip unless profiling shows an actual problem.

## Testing
- Manual: verify all tabs work, file picker updates, URL detection, streaming, HUD display, history browser, scroll behavior
- No automated frontend tests exist; changes should be incremental and manually verified after each phase checkpoint
