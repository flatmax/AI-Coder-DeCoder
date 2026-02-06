# UI Code Cleanup Plan

## Goals
- Fix bugs (duplicate methods)
- Deduplicate shared logic between similar components
- Break down oversized components into focused modules
- No feature changes — pure refactoring

## Priority Order
Fix bugs first, then highest-impact dedup, then structural splits.

---

### Phase 1: Quick Bug Fix (5 min)
- [ ] **DiffEditorMixin.js** — Remove duplicate `getOpenFilePaths()` method (defined twice at ~line 157 and ~175). Keep the first, delete the second.

**Verify**: `npx vite build` succeeds. Open a file in diff viewer.

---

### Phase 2: CacheViewer / ContextViewer Deduplication (30 min)
Both components share identical URL management, symbol map modal, and RPC refresh logic.
Both also have a bug: `viewUrl()` and `viewSymbolMap()` call bare `extractResponse()` which is not imported — should use `this._rpcExtract()` from RpcMixin instead.

- [ ] Create `webapp/src/context-viewer/ViewerDataMixin.js` extracting shared methods:
  - `getIncludedUrls()`
  - `refreshBreakdown()` (parameterized — both call same RPC)
  - `viewUrl()`, `closeUrlModal()`
  - `toggleUrlIncluded()`, `isUrlIncluded()`, `removeUrl()`
  - `viewSymbolMap()`, `closeSymbolMapModal()`
  - Shared properties: `breakdown`, `isLoading`, `error`, `selectedFiles`, `fetchedUrls`, `excludedUrls`, `selectedUrl`, `showUrlModal`, `urlContent`, `showSymbolMapModal`, `symbolMapContent`, `isLoadingSymbolMap`
  - `willUpdate` auto-refresh on `selectedFiles`/`fetchedUrls`/`excludedUrls` changes
- [ ] Refactor `CacheViewer.js` to use `ViewerDataMixin` — keep only cache-specific logic (tier expansion, search/filter, recent changes)
- [ ] Refactor `ContextViewer.js` to use `ViewerDataMixin` — keep only context-specific logic (section expansion, bar widths, usage percent)

**Verify**: Cache tab and Context tab both load, URL modals work, symbol map modal works, refresh works, URL include/exclude toggle works.

---

### Phase 3: PromptView Refresh Deduplication (15 min)
`_refreshContextViewer()` and `_refreshCacheViewer()` are nearly identical.

- [ ] Replace both with a single `_refreshViewer(selector)` method that:
  - Queries `this.shadowRoot.querySelector(selector)`
  - Sets `.rpcCall`, `.selectedFiles`, `.fetchedUrls`, `.excludedUrls`
  - Calls `.refreshBreakdown()`
  - Syncs history bar from breakdown
- [ ] Update `switchTab()` to call `_refreshViewer('context-viewer')` or `_refreshViewer('cache-viewer')`

**Verify**: Switch between Context and Cache tabs, both refresh correctly.

---

### Phase 4: CardMarkdown Split (45 min)
`CardMarkdown.js` is ~550 lines mixing parsing, rendering, diffing, and event handling.

- [ ] Create `webapp/src/prompt/EditBlockParser.js`:
  - `parseEditBlocks(content)` — returns structured block data
  - `getEditResultForFile(editResults, filePath)` — looks up result by path
- [ ] Create `webapp/src/prompt/EditBlockRenderer.js`:
  - `renderEditBlock(block, editResults)` — returns HTML string for one edit block
  - `renderEditsSummary(editResults)` — returns HTML string for edits summary
  - `formatUnifiedDiff(editContent, replContent)` — uses `diff.js` utilities
  - `renderInlineHighlight(segments, lineType)` — inline char diff rendering
- [ ] Create `webapp/src/prompt/FileMentionHelper.js`:
  - `highlightFileMentions(html, mentionedFiles, selectedFiles)` — returns modified HTML
  - `renderFilesSummary(foundFiles, selectedFiles)` — returns HTML string
- [ ] Add `escapeHtml(text)` to `webapp/src/utils/formatters.js` — shared by all above modules instead of passing as parameter
- [ ] Slim `CardMarkdown.js` to ~150 lines: imports above modules, handles `processContent()`, click routing, and Lit render

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
