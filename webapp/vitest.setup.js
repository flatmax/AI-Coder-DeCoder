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
// Two mock paths registered because different test files
// may import through different entry points:
//   - `@flatmax/jrpc-oo/dist/bundle.js` — what app-shell.js
//     actually imports (the UMD bundle)
//   - `@flatmax/jrpc-oo/jrpc-client.js` — legacy path still
//     used by some stray imports; kept as a belt-and-braces
//     alias
//
// Registered via `vi.mock` in setup files; vitest hoists
// these globally across all test files.

import { vi } from 'vitest';
import { LitElement } from 'lit';

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

vi.mock('@flatmax/jrpc-oo/jrpc-client.js', () => ({
  JRPCClient,
}));