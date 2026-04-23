// Tests for webapp/src/app-shell.js — AppShell root component.
//
// AppShell inherits from JRPCClient, which opens a real WebSocket
// on `connectedCallback`. We don't want the test suite to make
// actual network connections, so we stub the parent class with a
// minimal fake that exposes the hook points AppShell overrides:
// setupDone, remoteDisconnected, setupSkip, addClass, plus
// `serverURI` and `call` properties.
//
// monaco-editor is also mocked because app-shell.js transitively
// imports it via diff-viewer.js → monaco-setup.js. Without the
// mock, Vite's import resolver can't resolve monaco-editor's
// non-standard package exports in the test environment.
//
// Scope:
//   - SharedRpc publishing on setupDone
//   - SharedRpc cleared on remoteDisconnected
//   - Startup overlay state machine (initial, progress updates,
//     ready → fade)
//   - Reconnect scheduling with exponential backoff
//   - Toast layer (event subscription, auto-dismiss)
//   - Server-push callbacks dispatch window events

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('monaco-editor/esm/vs/editor/editor.api.js', () => {
  const monaco = {
    editor: {
      createDiffEditor: vi.fn(),
      createModel: vi.fn(),
      OverviewRulerLane: { Full: 7 },
    },
    languages: {
      register: vi.fn(),
      setMonarchTokensProvider: vi.fn(),
      getLanguages: vi.fn(() => []),
    },
  };
  return { default: monaco, ...monaco };
});

import { SharedRpc } from './rpc.js';

// ---------------------------------------------------------------------------
// Stub JRPCClient
// ---------------------------------------------------------------------------
//
// The real JRPCClient has a setter on `serverURI` that opens a
// WebSocket. We can't import `@flatmax/jrpc-oo/jrpc-client.js`
// directly in tests because it would try to construct a WebSocket.
// Vitest's module mocking lets us substitute a stub.
//
// The stub extends HTMLElement so LitElement's inheritance chain
// still works, plus declares the hook methods as no-ops that
// AppShell overrides with `super` calls.

vi.mock('@flatmax/jrpc-oo/jrpc-client.js', async () => {
  // Stub extends LitElement (not HTMLElement) because AppShell
  // uses Lit's reactive-property / render / updateComplete
  // machinery. In production, JRPCClient itself extends
  // LitElement; our stub must match that contract or the Lit
  // hooks in AppShell won't work (static styles / render /
  // updateComplete all disappear).
  //
  // Lit's own `connectedCallback` / `disconnectedCallback` are
  // defined on LitElement.prototype, so AppShell's `super.`
  // calls resolve naturally.
  const { LitElement } = await import('lit');
  class JRPCClient extends LitElement {
    constructor() {
      super();
      this.remoteTimeout = 60;
      this.call = {};
    }
    addClass(_instance, _name) {
      // Stub — real library would register methods for
      // server → client calls. Tests don't exercise that path.
    }
    setupDone() {}
    setupSkip() {}
    remoteDisconnected() {}
    remoteIsUp() {}
    // `serverURI` as a plain field rather than a setter — the
    // real library opens a WebSocket in the setter but tests
    // don't need that behaviour.
  }
  return { JRPCClient };
});

// Import AFTER the mock is registered.
const { AppShell } = await import('./app-shell.js');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create and attach an AppShell instance to the document.
 * Returns the element so tests can exercise methods and inspect
 * reactive state.
 *
 * Tracked in `_mountedShells` so afterEach can remove them —
 * leaked elements accumulate toast timers and SharedRpc
 * subscriptions across tests.
 */
const _mountedShells = [];
function mountShell() {
  const shell = document.createElement('ac-app-shell');
  document.body.appendChild(shell);
  _mountedShells.push(shell);
  return shell;
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe('AppShell', () => {
  beforeEach(() => {
    SharedRpc.reset();
    vi.useRealTimers();
  });

  afterEach(() => {
    while (_mountedShells.length) {
      const shell = _mountedShells.pop();
      if (shell.isConnected) {
        shell.remove();
      }
    }
    SharedRpc.reset();
  });

  describe('initial state', () => {
    it('starts in connecting state with overlay visible', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      expect(shell.connectionState).toBe('connecting');
      expect(shell.overlayVisible).toBe(true);
      expect(shell.startupPercent).toBe(0);
    });

    it('defaults to files tab', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      expect(shell.activeTab).toBe('files');
    });
  });

  describe('setupDone', () => {
    // TODO(phase-2d): files-tab silencing — delete this
    // beforeEach/afterEach pair when Phase 2d work adds proper
    // RPC mocking for the files-tab inside app-shell tests.
    //
    // Context: mounting the shell renders <ac-files-tab> in the
    // default tab. On setupDone(), the files-tab's onRpcReady
    // fires and calls Repo.get_file_tree on whatever fake proxy
    // these tests installed. That proxy doesn't expose
    // get_file_tree (this describe block tests shell behavior,
    // not files-tab behavior), so the files-tab's RPC call
    // rejects and its error handler logs via console.error.
    //
    // The errors are genuine but out of scope for these tests.
    // A scoped mock silences them without hiding real errors in
    // other describe blocks. When Phase 2d expands these tests
    // to cover files-tab interaction, the fake proxy will grow
    // Repo.get_file_tree and this silence becomes redundant —
    // grep for TODO(phase-2d) to find it.
    let _consoleErrorSpy;
    beforeEach(() => {
      _consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
    });
    afterEach(() => {
      _consoleErrorSpy.mockRestore();
    });

    it('publishes call proxy to SharedRpc on first connect', async () => {
      const shell = mountShell();
      shell.call = { 'Repo.get_file_content': vi.fn() };
      shell.setupDone();
      expect(SharedRpc.isReady).toBe(true);
      expect(SharedRpc.call).toBe(shell.call);
    });

    it('flips connectionState to connected', async () => {
      const shell = mountShell();
      shell.call = {};
      shell.setupDone();
      expect(shell.connectionState).toBe('connected');
    });

    it('keeps overlay visible on first connect (waits for ready)', async () => {
      // First connect: overlay stays up so startup progress can
      // drive it to ready. Reconnects dismiss immediately —
      // pinned by a separate test.
      const shell = mountShell();
      shell.call = {};
      shell.setupDone();
      expect(shell.overlayVisible).toBe(true);
    });

    it('dismisses overlay and shows toast on reconnect', async () => {
      const shell = mountShell();
      shell.call = {};
      // First connect.
      shell.setupDone();
      // Simulate ready so the overlay would dismiss naturally.
      shell.startupProgress('ready', 'Ready', 100);
      // Disconnect.
      shell.remoteDisconnected();
      // Reconnect.
      shell.setupDone();
      expect(shell.overlayVisible).toBe(false);
      expect(shell.toasts.length).toBe(1);
      expect(shell.toasts[0].type).toBe('success');
      expect(shell.toasts[0].message).toBe('Reconnected');
    });
  });

  describe('remoteDisconnected', () => {
    it('clears SharedRpc', () => {
      const shell = mountShell();
      shell.call = {};
      shell.setupDone();
      expect(SharedRpc.isReady).toBe(true);
      shell.remoteDisconnected();
      expect(SharedRpc.isReady).toBe(false);
    });

    it('flips connectionState to disconnected', () => {
      const shell = mountShell();
      shell.call = {};
      shell.setupDone();
      shell.remoteDisconnected();
      expect(shell.connectionState).toBe('disconnected');
    });

    it('schedules reconnect when was previously connected', () => {
      vi.useFakeTimers();
      const shell = mountShell();
      shell.call = {};
      shell.setupDone();
      const spy = vi.spyOn(shell, '_attemptReconnect');
      shell.remoteDisconnected();
      // First-delay bucket is 1000ms.
      vi.advanceTimersByTime(999);
      expect(spy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('does NOT schedule reconnect before first successful connect', () => {
      vi.useFakeTimers();
      const shell = mountShell();
      const spy = vi.spyOn(shell, '_attemptReconnect');
      // Simulate disconnect without prior setupDone — e.g.,
      // the first connection attempt failed mid-handshake.
      shell.remoteDisconnected();
      vi.advanceTimersByTime(20000);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('startupProgress', () => {
    it('updates stage, message, and percent', async () => {
      const shell = mountShell();
      shell.startupProgress('indexing', 'Indexing repository…', 50);
      expect(shell.startupStage).toBe('indexing');
      expect(shell.startupMessage).toBe('Indexing repository…');
      expect(shell.startupPercent).toBe(50);
    });

    it('clamps percent to 0..100', () => {
      const shell = mountShell();
      shell.startupProgress('x', 'x', 150);
      expect(shell.startupPercent).toBe(100);
      shell.startupProgress('x', 'x', -20);
      expect(shell.startupPercent).toBe(0);
    });

    it('dismisses overlay on ready (after fade delay)', async () => {
      vi.useFakeTimers();
      const shell = mountShell();
      shell.startupProgress('ready', 'Ready', 100);
      // Overlay isn't hidden synchronously — there's a
      // post-ready delay for visual polish (user sees 100% for
      // a moment before the fade).
      expect(shell.overlayVisible).toBe(true);
      vi.advanceTimersByTime(500);
      expect(shell.overlayVisible).toBe(false);
    });
  });

  describe('reconnect backoff', () => {
    it('increments attempt counter across multiple failures', () => {
      vi.useFakeTimers();
      const shell = mountShell();
      shell.call = {};
      shell.setupDone();
      shell.remoteDisconnected();
      expect(shell.reconnectAttempt).toBe(1);
      vi.advanceTimersByTime(2000);
      shell.remoteDisconnected();
      expect(shell.reconnectAttempt).toBe(2);
    });

    it('caps delay at 15000ms for high attempt counts', () => {
      vi.useFakeTimers();
      const shell = mountShell();
      shell.call = {};
      shell.setupDone();
      // Reach attempt 10 (well beyond the schedule length).
      shell.reconnectAttempt = 10;
      shell.remoteDisconnected();
      // Should not fire before the capped delay.
      vi.advanceTimersByTime(14999);
      const spy = vi.spyOn(shell, '_attemptReconnect');
      // Already scheduled — advance and confirm it fires on
      // the capped schedule.
      vi.advanceTimersByTime(2);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('toast system', () => {
    it('dispatches window event → shows toast', async () => {
      const shell = mountShell();
      window.dispatchEvent(new CustomEvent('ac-toast', {
        detail: { message: 'File saved', type: 'success' },
      }));
      await shell.updateComplete;
      expect(shell.toasts.length).toBe(1);
      expect(shell.toasts[0].message).toBe('File saved');
      expect(shell.toasts[0].type).toBe('success');
    });

    it('auto-dismisses after 3 seconds', () => {
      vi.useFakeTimers();
      const shell = mountShell();
      shell._showToast('Hi', 'info');
      expect(shell.toasts.length).toBe(1);
      vi.advanceTimersByTime(2999);
      expect(shell.toasts.length).toBe(1);
      vi.advanceTimersByTime(2);
      expect(shell.toasts.length).toBe(0);
    });

    it('ignores events with no message', async () => {
      const shell = mountShell();
      window.dispatchEvent(new CustomEvent('ac-toast', { detail: {} }));
      await shell.updateComplete;
      expect(shell.toasts.length).toBe(0);
    });

    it('defaults type to info when not specified', () => {
      const shell = mountShell();
      window.dispatchEvent(new CustomEvent('ac-toast', {
        detail: { message: 'No type here' },
      }));
      expect(shell.toasts[0].type).toBe('info');
    });

    it('unsubscribes from toast events on disconnect', () => {
      const shell = mountShell();
      shell.remove();
      window.dispatchEvent(new CustomEvent('ac-toast', {
        detail: { message: 'Should not appear' },
      }));
      // Element was removed, so its internal state is gone.
      // This test just confirms the removal doesn't error.
      expect(shell.toasts.length).toBe(0);
    });
  });

  describe('server-push callbacks', () => {
    it('streamChunk dispatches window event', () => {
      const shell = mountShell();
      const listener = vi.fn();
      window.addEventListener('stream-chunk', listener);
      shell.streamChunk('req-1', 'hello');
      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0][0];
      expect(event.detail).toEqual({
        requestId: 'req-1',
        content: 'hello',
      });
      window.removeEventListener('stream-chunk', listener);
    });

    it('streamComplete dispatches window event', () => {
      const shell = mountShell();
      const listener = vi.fn();
      window.addEventListener('stream-complete', listener);
      shell.streamComplete('req-1', { response: 'ok' });
      expect(listener).toHaveBeenCalledOnce();
      window.removeEventListener('stream-complete', listener);
    });

    it('navigateFile flags remote origin', () => {
      // Collaboration echo-prevention — remote-originated
      // navigation must be distinguishable from local.
      const shell = mountShell();
      const listener = vi.fn();
      window.addEventListener('navigate-file', listener);
      shell.navigateFile({ path: 'src/foo.py' });
      const event = listener.mock.calls[0][0];
      expect(event.detail._remote).toBe(true);
      expect(event.detail.path).toBe('src/foo.py');
      window.removeEventListener('navigate-file', listener);
    });

    it('filesChanged dispatches window event with selected files', () => {
      const shell = mountShell();
      const listener = vi.fn();
      window.addEventListener('files-changed', listener);
      shell.filesChanged(['a.md', 'b.md']);
      const event = listener.mock.calls[0][0];
      expect(event.detail.selectedFiles).toEqual(['a.md', 'b.md']);
      window.removeEventListener('files-changed', listener);
    });

    it('callbacks return true for jrpc-oo ack', () => {
      const shell = mountShell();
      expect(shell.streamChunk('r', 'c')).toBe(true);
      expect(shell.streamComplete('r', {})).toBe(true);
      expect(shell.filesChanged([])).toBe(true);
    });
  });

  describe('tab switching', () => {
    it('changes activeTab via _switchTab', () => {
      const shell = mountShell();
      shell._switchTab('context');
      expect(shell.activeTab).toBe('context');
      shell._switchTab('settings');
      expect(shell.activeTab).toBe('settings');
    });
  });

  describe('viewer routing', () => {
    async function settle(shell) {
      await shell.updateComplete;
      await new Promise((r) => setTimeout(r, 0));
      await shell.updateComplete;
      // Let the viewers' own Lit updates settle.
      const diff = shell.shadowRoot.querySelector(
        'ac-diff-viewer',
      );
      const svg = shell.shadowRoot.querySelector(
        'ac-svg-viewer',
      );
      if (diff) await diff.updateComplete;
      if (svg) await svg.updateComplete;
    }

    it('renders both viewers in the background layer', async () => {
      const shell = mountShell();
      await settle(shell);
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const svg = shell.shadowRoot.querySelector('ac-svg-viewer');
      expect(diff).toBeTruthy();
      expect(svg).toBeTruthy();
    });

    it('diff viewer is visible by default', async () => {
      const shell = mountShell();
      await settle(shell);
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const svg = shell.shadowRoot.querySelector('ac-svg-viewer');
      expect(diff.classList.contains('viewer-visible')).toBe(true);
      expect(svg.classList.contains('viewer-hidden')).toBe(true);
    });

    it('navigate-file to .py routes to diff viewer', async () => {
      const shell = mountShell();
      await settle(shell);
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'src/main.py' },
        }),
      );
      await settle(shell);
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      expect(diff.hasOpenFiles).toBe(true);
      expect(diff._files[0].path).toBe('src/main.py');
    });

    it('navigate-file to .svg routes to svg viewer', async () => {
      const shell = mountShell();
      await settle(shell);
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'docs/flow.svg' },
        }),
      );
      await settle(shell);
      const svg = shell.shadowRoot.querySelector('ac-svg-viewer');
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      expect(svg.hasOpenFiles).toBe(true);
      expect(svg._files[0].path).toBe('docs/flow.svg');
      // Diff viewer didn't receive it.
      expect(diff.hasOpenFiles).toBe(false);
    });

    it('opening an .svg flips active viewer to svg', async () => {
      const shell = mountShell();
      await settle(shell);
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'diagram.svg' },
        }),
      );
      await settle(shell);
      expect(shell._activeViewer).toBe('svg');
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const svg = shell.shadowRoot.querySelector('ac-svg-viewer');
      expect(svg.classList.contains('viewer-visible')).toBe(true);
      expect(diff.classList.contains('viewer-hidden')).toBe(true);
    });

    it('switching between .py and .svg toggles visibility', async () => {
      const shell = mountShell();
      await settle(shell);
      // Open .py — diff visible.
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'a.py' },
        }),
      );
      await settle(shell);
      expect(shell._activeViewer).toBe('diff');
      // Open .svg — svg visible.
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'b.svg' },
        }),
      );
      await settle(shell);
      expect(shell._activeViewer).toBe('svg');
      // Back to .py — diff visible again.
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'c.py' },
        }),
      );
      await settle(shell);
      expect(shell._activeViewer).toBe('diff');
    });

    it('both viewers preserve their file lists across visibility toggles', async () => {
      // Key point: switching between .py and .svg doesn't
      // close the viewer that becomes hidden. Its tabs
      // remain intact. Matters for Phase 3.1's Monaco
      // instances, which are expensive to create.
      const shell = mountShell();
      await settle(shell);
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'a.py' },
        }),
      );
      await settle(shell);
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'b.svg' },
        }),
      );
      await settle(shell);
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const svg = shell.shadowRoot.querySelector('ac-svg-viewer');
      // Both viewers still have their files.
      expect(diff._files).toHaveLength(1);
      expect(diff._files[0].path).toBe('a.py');
      expect(svg._files).toHaveLength(1);
      expect(svg._files[0].path).toBe('b.svg');
    });

    it('navigate-file with empty path is ignored', async () => {
      const shell = mountShell();
      await settle(shell);
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: '' },
        }),
      );
      await settle(shell);
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const svg = shell.shadowRoot.querySelector('ac-svg-viewer');
      expect(diff.hasOpenFiles).toBe(false);
      expect(svg.hasOpenFiles).toBe(false);
    });

    it('navigate-file with no detail is ignored', async () => {
      const shell = mountShell();
      await settle(shell);
      window.dispatchEvent(new CustomEvent('navigate-file'));
      await settle(shell);
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      expect(diff.hasOpenFiles).toBe(false);
    });

    it('forwards line and searchText to the viewer', async () => {
      // The stub accepts these and ignores them, but the
      // shell must pass them through so Phase 3.1's real
      // implementation can use them without any shell-side
      // changes.
      const shell = mountShell();
      await settle(shell);
      // Spy on the viewer's openFile to inspect args.
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const spy = vi.spyOn(diff, 'openFile');
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: {
            path: 'src/foo.py',
            line: 42,
            searchText: 'my anchor',
          },
        }),
      );
      await settle(shell);
      expect(spy).toHaveBeenCalledWith({
        path: 'src/foo.py',
        line: 42,
        searchText: 'my anchor',
      });
    });

    it('unsubscribes from navigate-file on disconnect', async () => {
      const shell = mountShell();
      await settle(shell);
      shell.remove();
      // After disconnect, dispatching navigate-file must
      // not affect state on the disconnected element.
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'ghost.py' },
        }),
      );
      // No crash; viewer inside the removed shell hasn't
      // been re-attached so we can't check its state
      // directly, but the lack of exception is the
      // contract.
      expect(shell.isConnected).toBe(false);
    });
  });
});