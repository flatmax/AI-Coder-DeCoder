// Vitest setup — runs before every test file.
//
// Mocks @flatmax/jrpc-oo so unit tests don't evaluate its
// UMD bundle. The bundle assumes a browser-ish global
// environment where `Window` is the constructor and
// assigns `Window.JRPC = JRPC`. In jsdom under vitest,
// `Window` isn't globally resolvable the way the bundle
// expects, and evaluation throws `ReferenceError: JRPC is
// not defined` before any test code runs.
//
// The mock gives us a minimal JRPCClient base that
// satisfies the AppShell contract: extends LitElement so
// reactive-property / render / updateComplete still work,
// declares the lifecycle hooks AppShell overrides
// (setupDone, setupSkip, remoteDisconnected, remoteIsUp),
// and exposes `addClass` and `call` as no-ops.
//
// Mock registered via `vi.mock` in this setup file; vitest
// hoists it globally across all test files.

import { vi } from 'vitest';
import { LitElement } from 'lit';

// Monaco's clipboard contribution (loaded transitively via
// monaco-editor/esm/vs/editor/edcore.main.js → editor.all.js)
// calls `document.queryCommandSupported(...)` at module
// init. jsdom doesn't implement that legacy DOM API, so
// module init throws `queryCommandSupported is not a
// function` and any test file that imports Monaco — or a
// component that imports Monaco (diff-viewer, app-shell) —
// fails at collection time before any test body runs.
//
// We stub it as a constant `false` so Monaco takes the
// "not supported, use keybinding fallback" branch. Only
// installed if missing so real browsers in any future
// test runner aren't overridden.
if (
  typeof document !== 'undefined' &&
  typeof document.queryCommandSupported !== 'function'
) {
  document.queryCommandSupported = () => false;
}

/**
 * Minimal JRPCClient stub. Extends LitElement so consumer
 * code still gets Lit's reactive machinery. Lifecycle hooks
 * are no-ops — tests that exercise them override via direct
 * method calls on the AppShell instance, not by driving a
 * real WebSocket.
 */
class JRPCClient extends LitElement {
  constructor() {
    super();
    this.remoteTimeout = 60;
    this.call = {};
  }
  addClass(_instance, _name) {
    // Real library registers RPC methods. Tests that need
    // to observe registrations spy on this method.
  }
  setupDone() {}
  setupSkip() {}
  remoteDisconnected() {}
  remoteIsUp() {}
}

vi.mock('@flatmax/jrpc-oo/dist/bundle.js', () => ({
  JRPCClient,
  default: { JRPCClient },
}));