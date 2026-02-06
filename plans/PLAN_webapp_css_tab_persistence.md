# Webapp CSS Tab Persistence

## Goal
Replace destroy/recreate tab switching with CSS visibility hiding. This eliminates DOM teardown costs, removes scroll position save/restore hacks, and preserves component state (search results, expanded nodes, scroll positions) across tab switches.

## Current Behavior
`PromptViewTemplate.js` uses ternary chains to conditionally render tab content:
```js
component.activeLeftTab === TABS.FILES ? html`...file picker + chat...`
: component.activeLeftTab === TABS.SEARCH ? html`...find-in-files...`
: component.activeLeftTab === TABS.CONTEXT ? html`...context-viewer...`
: ...
```
Inactive tabs are destroyed. `PromptView.switchTab()` has ~40 lines of scroll save/restore logic.

## Design

### Render all tabs, hide inactive with CSS
Change from conditional rendering to always-rendered with a `.tab-hidden` class:
```css
.tab-hidden {
  display: none;
}
```

Each tab panel gets the class when not active. Components stay mounted, preserving all state.

### Lazy first-render
To avoid mounting all tabs on initial load, use a `_visitedTabs` set. A tab's content is only rendered after it's been visited once. After that it stays in DOM and is CSS-hidden.

### RPC gating
Components that auto-fire RPCs on mount need gating:
- **SettingsPanel**: Guard `onRpcReady()` with `if (!this.visible) return;` and add a `visible` check to `loadConfigInfo()`
- **ContextViewer/CacheViewer**: Already gate on `this.visible` ✅
- **FindInFiles**: Only fires on user input ✅
- **FilePicker**: No RPC calls ✅

### Scroll management cleanup
Remove from `PromptView`:
- `_filePickerScrollTop`, `_messagesScrollTop`, `_wasScrolledUp` properties
- Scroll save/restore logic in `switchTab()`
- `disconnectScrollObserver()`/`setupScrollObserver()` calls in tab switch

Remove from `FilePicker`:
- `_savedScrollTop` property
- Scroll save in `disconnectedCallback`
- Scroll restore in `updated`

## Execution Order
1. Add `.tab-hidden` CSS and `_visitedTabs` tracking to PromptView
2. Restructure PromptViewTemplate to always-render visited tabs
3. Gate SettingsPanel RPC on visibility
4. Remove scroll save/restore from PromptView.switchTab()
5. Remove scroll save/restore from FilePicker

## Files Changed
- `webapp/src/prompt/PromptViewTemplate.js` — restructure tab rendering
- `webapp/src/prompt/PromptViewStyles.js` — add `.tab-hidden` class
- `webapp/src/PromptView.js` — add `_visitedTabs`, simplify `switchTab()`
- `webapp/src/settings/SettingsPanel.js` — gate RPC on visible
- `webapp/src/file-picker/FilePicker.js` — remove scroll save/restore

## Risk
- **Medium**: Template restructuring is a significant change. All tabs mount their DOM on first visit and stay mounted — slightly more memory usage.
- **Mitigation**: Lazy first-render via `_visitedTabs` means only visited tabs consume DOM. Most users only use 1-2 tabs per session.
- **Testing**: Switch between all tabs rapidly, verify no stale data, verify scroll positions preserved, verify RPC calls only fire for visible tabs.

## Not in Scope
- HistoryBrowser (separate overlay, not part of tab system)
- Message container scroll observer (still needed for auto-scroll behavior within chat)
