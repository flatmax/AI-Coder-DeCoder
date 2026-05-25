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

// jsdom does not implement URL.createObjectURL /
// revokeObjectURL. Tests that exercise Blob-to-anchor
// download flows (the markdown preview's "Export as
// HTML" path is the current consumer) need both, and
// they need to be spy-able via vi.spyOn — which means
// they must be defined as configurable properties on
// the URL constructor before the test installs its spy.
// jsdom leaves them undefined, so a vi.spyOn call
// throws "Cannot spy on a primitive value; undefined
// given" before the test body runs.
//
// Stub both as no-op-returning configurable properties
// so spying works. Real browsers ignore this — the
// guards check for missing-ness only.
if (typeof URL !== 'undefined') {
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: () => 'blob:mock',
    });
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: () => {},
    });
  }
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