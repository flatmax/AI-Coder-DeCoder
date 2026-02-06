# Plan: Webapp Optimization Refactors

## Status: IN PROGRESS

## Goal
Reduce complexity and improve maintainability across the webapp codebase through a set of independent, incremental refactors.

## Changes

### 1. CardMarkdown Click Delegation → Extract Handler

**Problem:** `handleClick` in CardMarkdown.js is an 80-line cascade of `.closest()` checks handling 6+ different clickable element types (file mentions, edit block files, edit tags, file chips, select-all buttons, edit block backgrounds). This makes the component hard to follow.

**Solution:** Extract a `CardClickHandler` utility that maps CSS selectors to handler functions, reducing `handleClick` to a simple dispatch table.

**Files:**
- Create `webapp/src/prompt/CardClickHandler.js` — selector→handler map and dispatch logic
- Modify `webapp/src/prompt/CardMarkdown.js` — replace `handleClick` cascade with delegated dispatch

**Approach:**
```js
// CardClickHandler.js
const CLICK_HANDLERS = [
  { selector: '.file-mention', handler: handleFileMentionClick },
  { selector: '.edit-block-file', handler: handleEditBlockFileClick },
  { selector: '.edit-tag', handler: handleEditTagClick },
  { selector: '.file-chip', handler: handleFileChipClick },
  { selector: '.select-all-btn', handler: handleSelectAllClick },
  { selector: '.edit-block', handler: handleEditBlockClick },
];

export function dispatchClick(e, component) {
  for (const { selector, handler } of CLICK_HANDLERS) {
    const target = e.target.closest(selector);
    if (target) {
      handler(target, component);
      return;
    }
  }
}
```

---

### 2. RPC Pattern Consistency

**Problem:** Two RPC calling patterns coexist:
- PromptView (extends JRPCClient): `this.call['Method.name']()` + `this.extractResponse(response)`
- Child components (use RpcMixin): `this._rpc('Method.name')` / `this._rpcExtract('Method.name')`

This means developers have to remember which pattern to use depending on the component.

**Solution:** Standardize child components on RpcMixin (already mostly done). For PromptView, which must extend JRPCClient, add a thin `_rpcExtract` helper method that wraps `this.call[method]()` + `extractResponse()`, matching the RpcMixin API. This doesn't change PromptView's base class but gives it the same convenience methods.

**Files:**
- Modify `webapp/src/PromptView.js` — add `_rpcExtract` convenience method
- Optionally migrate call sites in ChatActionsMixin, FileHandlerMixin, StreamingMixin to use the new helper where it simplifies code (not required — can be done incrementally)

---

## Dropped Items

### ~~Tab Content Lazy Loading~~ — Already implemented
The template in `PromptViewTemplate.js` already conditionally renders only the active tab's component using `activeLeftTab === TABS.X ? html\`...\` : ...` chains. Nothing to do.

### ~~ScrollPreservationMixin~~ — Over-abstraction
Scroll save/restore is implemented in PromptView, FilePicker, and HistoryBrowser with slightly different logic in each (PromptView has `_wasScrolledUp` for scroll-to-bottom behavior, FilePicker uses `disconnectedCallback`, HistoryBrowser uses `show()`/`hide()`). A mixin would add indirection for minimal dedup since each case has its own nuances.

---

## Execution Order

1. **CardMarkdown Click Handler** — ✅ DONE
2. **RPC Consistency** — lowest priority, additive only

Each change is independent and can be shipped separately.

## Testing

- Manual: verify all click targets in assistant messages still work (edit blocks, file mentions, chips, select-all)
- Manual: verify no regressions in streaming, edit application, URL fetching
