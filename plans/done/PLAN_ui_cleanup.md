# UI Code Cleanup Plan

## Goals
- Fix bugs (duplicate methods)
- Deduplicate shared logic between similar components
- Break down oversized components into focused modules
- No feature changes — pure refactoring

## Priority Order
Fix bugs first, then highest-impact dedup, then structural splits.

---

### Phase 1: Quick Bug Fix (5 min) ✅
- [x] **DiffEditorMixin.js** — Removed duplicate `getOpenFilePaths()` method (was defined twice). Kept the first at line 155, deleted the second at line 173.

**Verify**: `npx vite build` succeeds. Open a file in diff viewer.

---

### Phase 2: CacheViewer / ContextViewer Deduplication (30 min) ✅
Both components share identical URL management, symbol map modal, and RPC refresh logic.
Both also had a bug: `viewUrl()` and `viewSymbolMap()` called bare `extractResponse()` which was not imported — fixed by using `this._rpcExtract()` from RpcMixin in `ViewerDataMixin`.

- [x] Create `webapp/src/context-viewer/ViewerDataMixin.js` extracting shared methods:
  - `getIncludedUrls()`
  - `refreshBreakdown()` (parameterized — both call same RPC)
  - `viewUrl()`, `closeUrlModal()`
  - `toggleUrlIncluded()`, `isUrlIncluded()`, `removeUrl()`
  - `viewSymbolMap()`, `closeSymbolMapModal()`
  - Shared properties: `breakdown`, `isLoading`, `error`, `selectedFiles`, `fetchedUrls`, `excludedUrls`, `selectedUrl`, `showUrlModal`, `urlContent`, `showSymbolMapModal`, `symbolMapContent`, `isLoadingSymbolMap`
  - `willUpdate` auto-refresh on `selectedFiles`/`fetchedUrls`/`excludedUrls` changes
- [x] Refactor `CacheViewer.js` to use `ViewerDataMixin` — keep only cache-specific logic (tier expansion, search/filter, recent changes)
- [x] Refactor `ContextViewer.js` to use `ViewerDataMixin` — keep only context-specific logic (section expansion, bar widths, usage percent)

**Verify**: Cache tab and Context tab both load, URL modals work, symbol map modal works, refresh works, URL include/exclude toggle works.

---

### Phase 3: PromptView Refresh Deduplication (15 min) ✅
`_refreshContextViewer()` and `_refreshCacheViewer()` were nearly identical.

- [x] Replaced both with a single `_refreshViewer(selector)` method that:
  - Queries `this.shadowRoot.querySelector(selector)`
  - Sets `.rpcCall`, `.selectedFiles`, `.fetchedUrls`, `.excludedUrls`
  - Calls `.refreshBreakdown()`
  - Syncs history bar from breakdown
- [x] Updated `switchTab()` to call `_refreshViewer('context-viewer')` or `_refreshViewer('cache-viewer')`

**Verify**: Switch between Context and Cache tabs, both refresh correctly.

---

### Phase 4: CardMarkdown Split (45 min) ✅
`CardMarkdown.js` is ~550 lines mixing parsing, rendering, diffing, and event handling.

- [x] Create `webapp/src/prompt/EditBlockParser.js`:
  - `parseEditBlocks(content)` — returns structured block data
  - `getEditResultForFile(editResults, filePath)` — looks up result by path
- [x] Create `webapp/src/prompt/EditBlockRenderer.js`:
  - `renderEditBlock(block, editResults)` — returns HTML string for one edit block
  - `renderEditsSummary(editResults)` — returns HTML string for edits summary
  - `formatUnifiedDiff(editContent, replContent)` — uses `diff.js` utilities
  - `renderInlineHighlight(segments, lineType)` — inline char diff rendering
- [x] Create `webapp/src/prompt/FileMentionHelper.js`:
  - `highlightFileMentions(html, mentionedFiles, selectedFiles)` — returns modified HTML
  - `renderFilesSummary(foundFiles, selectedFiles)` — returns HTML string
- [x] Add `escapeHtml(text)` to `webapp/src/utils/formatters.js` — shared by all above modules instead of passing as parameter
- [x] Slim `CardMarkdown.js` to ~150 lines: imports above modules, handles `processContent()`, click routing, and Lit render

**Verify**: Assistant messages render correctly — code blocks, edit blocks with diffs, file mentions, edit summaries, copy buttons all work.

---

### Phase 5: AppShell Event Forwarding (20 min) — Future / Skip
Many `handle*` methods in AppShell just forward events between child components. Low impact since it's just plumbing. Revisit if AppShell grows further.

---

## Files Changed per Phase
| Phase | New Files | Modified Files |
|-------|-----------|----------------|
| 1 | — | `DiffEditorMixin.js` |
| 2 | `ViewerDataMixin.js` | `CacheViewer.js`, `ContextViewer.js` |
| 3 | — | `PromptView.js` |
| 4 | `EditBlockParser.js`, `EditBlockRenderer.js`, `FileMentionHelper.js` | `CardMarkdown.js` |
| 5 | — | Deferred |
