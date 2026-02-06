# Plan: RPC Architecture Improvements

## Problem

The current RPC interaction between the Python backend and webapp has several
architectural issues that cause fragility, boilerplate, and unnecessary network calls.

### Issue 1: AppShell reaches into PromptView internals for RPC

AppShell has no RPC connection of its own. It does things like:

```js
const promptView = this.shadowRoot.querySelector('prompt-view');
await promptView.call['Repo.get_file_content'](file);
```

This creates hidden coupling - AppShell can't make RPC calls until PromptView
is connected and ready. It leads to defensive checks scattered everywhere and
race conditions during startup (see the `_updateTitle` method with its retry
logic and event listeners).

### Issue 2: Manual rpcCall prop-drilling

Every component that needs RPC gets it via manual property assignment:

```js
// In PromptViewTemplate.js
<cache-viewer .rpcCall=${component.call} ...>
<context-viewer .rpcCall=${component.call} ...>
<history-browser .rpcCall=${component.call} ...>
<find-in-files .rpcCall=${component.call} ...>
<settings-panel .rpcCall=${component.call} ...>
```

If a new component needs RPC, you must thread `rpcCall` through every
intermediate template. The `RpcMixin` then wraps this with `onRpcReady()`
hooks, but the timing is fragile - it fires when the property is first set,
which may not align with when the component actually needs it.

### Issue 3: Redundant context viewer fetching

After every streaming response, the backend sends `token_usage` data in the
`streamComplete` result. The viewers (`CacheViewer`, `ContextViewer`) also
auto-refresh via `_viewerDataWillUpdate` when `selectedFiles` or `fetchedUrls`
change - which can coincide with streaming completing, causing redundant
fetches.

The `token_usage` HUD data and `get_context_breakdown` data have **different
shapes** - HUD data has flat fields (`system_tokens`, `tier_info`), while the
breakdown has nested item-level detail (`breakdown.files`, per-file tokens,
stability info). So viewers genuinely need their own fetch for full data.
However, they shouldn't auto-fetch when the user isn't looking at them.

### Issue 4: No shared error handling patterns

Each component handles RPC errors differently:
- ChatActionsMixin: try/catch with `addMessage('assistant', error)`
- ViewerDataMixin: `_rpcWithState` sets loading/error properties
- HistoryBrowser: `_rpcWithState` for some calls, manual for others
- AppShell: bare try/catch with console.error

---

## Proposed Changes

### Phase 1: Shared RPC Connection via Singleton (High Impact, Moderate Effort)

**Goal**: Eliminate prop-drilling and AppShell's dependency on PromptView for RPC.

Create a lightweight singleton that any component in the tree can access:

**New file**: `webapp/src/utils/RpcContext.js`

```js
// Singleton shared RPC state
let _sharedCall = null;
let _waiters = [];

export function setSharedRpcCall(call) {
  _sharedCall = call;
  for (const resolve of _waiters) resolve(call);
  _waiters = [];
}

export function getSharedRpcCall() {
  return _sharedCall;
}

export function waitForRpc() {
  if (_sharedCall) return Promise.resolve(_sharedCall);
  return new Promise(resolve => _waiters.push(resolve));
}
```

Then `PromptView.setupDone()` calls `setSharedRpcCall(this.call)`.

`RpcMixin` changes to auto-acquire from singleton (non-blocking - no async
`connectedCallback`):

```js
export const RpcMixin = (superClass) => class extends superClass {
  connectedCallback() {
    super.connectedCallback();
    if (!this.__rpcCall) {
      const call = getSharedRpcCall();
      if (call) {
        this.rpcCall = call;
      } else {
        waitForRpc().then(c => { this.rpcCall = c; });
      }
    }
  }
  // ... rest unchanged (set rpcCall still triggers onRpcReady)
};
```

**Benefits**:
- AppShell can use RpcMixin directly instead of querySelector hacks
- No more prop-drilling `.rpcCall=${component.call}` in templates
- Components auto-connect when RPC is ready - no timing issues
- `onRpcReady()` still fires, but reliably
- `connectedCallback` stays synchronous (uses `.then()`, not `await`)

**Files changed**:
- New: `webapp/src/utils/RpcContext.js`
- `webapp/src/utils/rpc.js` - RpcMixin uses singleton as fallback
- `webapp/src/PromptView.js` - call `setSharedRpcCall` in `setupDone`
- `webapp/src/prompt/PromptViewTemplate.js` - remove `.rpcCall=` bindings
- Various viewer/settings templates that receive rpcCall

### Phase 2: Lazy Viewer Fetching (Medium Impact, Low Effort)

**Goal**: Viewers only fetch when actually visible, not on every property change.

Currently `_viewerDataWillUpdate` in `ViewerDataMixin` triggers a debounced
`refreshBreakdown()` whenever `selectedFiles`, `fetchedUrls`, or `excludedUrls`
change, even if the viewer tab isn't active. These property changes commonly
happen during/after streaming, causing unnecessary fetches.

**Fix**: Only auto-refresh when the viewer is actually visible. Mark data as
stale when properties change while hidden, and fetch on next show:

```js
_viewerDataWillUpdate(changedProperties) {
  const dataChanged = changedProperties.has('selectedFiles') ||
      changedProperties.has('fetchedUrls') ||
      changedProperties.has('excludedUrls');

  if (dataChanged) {
    this._breakdownStale = true;
  }

  // Only fetch if visible and data changed (or became visible while stale)
  if (this.visible && this._breakdownStale && this.rpcCall) {
    this._breakdownStale = false;
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this.refreshBreakdown(), 100);
  }
}
```

Also handle becoming visible:

```js
updated(changedProperties) {
  if (changedProperties.has('visible') && this.visible && this._breakdownStale) {
    this._breakdownStale = false;
    this.refreshBreakdown();
  }
}
```

**Files changed**:
- `webapp/src/context-viewer/ViewerDataMixin.js` - stale-tracking, visible-gating

### Phase 3: AppShell RPC Independence (High Impact, Low Effort)

**Goal**: AppShell makes its own RPC calls without querySelector.

Depends on Phase 1. AppShell extends RpcMixin:

```js
export class AppShell extends RpcMixin(LitElement) { ... }
```

Then replace all `promptView.call[...]` patterns with `this._rpc(...)`:

```js
// Before (~15 instances):
const promptView = this.shadowRoot.querySelector('prompt-view');
if (!promptView?.call) return null;
const response = await promptView.call['Repo.get_file_content'](file);

// After:
const content = await this._rpcExtract('Repo.get_file_content', file);
```

The `_updateTitle` method collapses from ~30 lines of retry/polling logic to:

```js
async _updateTitle() {
  const repoName = await this._rpcExtract('Repo.get_repo_name');
  if (repoName) document.title = repoName;
}
```

**Files changed**:
- `webapp/src/app-shell/AppShell.js` - extend RpcMixin, replace all querySelector
  RPC patterns, simplify `_updateTitle`, `_fetchFileContent`, config handlers

### Phase 4: Consolidate extractResponse in Leaf Components (Low Impact, Low Effort)

**Goal**: Leaf components (viewers, settings, history browser) use `_rpcExtract`
consistently instead of manual `extractResponse()` calls.

**Scope**: Only leaf components that use `RpcMixin`. PromptView's own mixins
(`ChatActionsMixin`, `FileHandlerMixin`, `StreamingMixin`) keep using
`this.call[...]` directly because they inherit from `JRPCClient` and need the
raw call object for bidirectional methods (server-initiated callbacks like
`streamChunk`, `compactionEvent`). Trying to migrate these to `_rpc()` would
add indirection with no benefit.

This is a cleanup pass, not a separate phase - do it opportunistically as
files are touched in Phases 1-3.

---

## What NOT to Change

- **PromptView still owns the JRPCClient WebSocket connection**. It's the only
  component that needs bidirectional communication (server calls *into* it for
  streaming). Other components only make outbound calls.

- **PromptView's mixins keep using `this.call` directly**. They extend
  `JRPCClient` via `MessageHandler` and need the raw call object for
  server-to-client callbacks. Don't try to route these through `_rpc()`.

- **Don't add a service worker or message bus**. The shared singleton is simpler
  and sufficient for a single-page app with one WebSocket.

- **Don't make other components extend JRPCClient**. Only one WebSocket
  connection is needed. The shared singleton gives other components access
  to `call` without duplicating the connection.

- **Don't try to substitute HUD data for full breakdown data**. The
  `token_usage` from streaming has flat summary fields. The viewer breakdown
  has nested item-level detail (per-file tokens, stability info, tier items).
  Different shapes, different purposes.

---

## Implementation Order

1. **Phase 1 + 3 together** (shared singleton + AppShell cleanup) - These are
   tightly coupled: the singleton enables AppShell cleanup. Do them as one unit.
2. **Phase 2** (lazy viewer fetching) - Independent, can be done before or after.
3. **Phase 4** (extractResponse) - Opportunistic, do alongside other changes.

## Status: COMPLETE

All phases implemented:
- Phase 1: `RpcContext.js` singleton, `RpcMixin` auto-acquires via non-blocking `.then()`
- Phase 2: `ViewerDataMixin` stale-tracking, visible-gating, timer cleanup
- Phase 3: `AppShell` extends `RpcMixin`, uses `_rpcExtract`/`_rpc` throughout
- Phase 4: Leaf components already use `_rpcExtract`/`_rpcWithState`
- Template cleanup: No `.rpcCall=` prop-drilling in `PromptViewTemplate.js`

## Estimated Impact

- **Network calls saved**: 1-2 unnecessary `get_context_breakdown` calls when
  viewer tabs aren't active
- **Code removed**: ~50 lines of querySelector hacks in AppShell, ~10 rpcCall
  template bindings, ~30 lines of `_updateTitle` retry logic
- **Race conditions fixed**: AppShell startup timing, viewer refresh while hidden
- **DX improvement**: New components get RPC access by adding RpcMixin, nothing else
