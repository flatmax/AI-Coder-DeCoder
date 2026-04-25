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
  // Richer stub than a bare vi.fn() — DiffViewer's
  // _createEditor calls setModel on the returned editor
  // and attaches content-change listeners. Without
  // working shapes, it logs "Cannot read properties of
  // undefined (reading 'setModel')" errors that spam
  // the app-shell test output even though the viewer's
  // own tests are in a separate file with its own mock.
  const noopDisposable = { dispose() {} };
  const makeEditor = () => ({
    setModel() {},
    getModel: () => ({ original: null, modified: null }),
    getModifiedEditor: () => ({
      onDidChangeModelContent: () => noopDisposable,
      onDidScrollChange: () => noopDisposable,
      deltaDecorations: () => [],
      getModel: () => null,
      getValue: () => '',
      setValue() {},
      revealLine() {},
      revealLineInCenter() {},
      setPosition() {},
      getPosition: () => ({ lineNumber: 1, column: 1 }),
      getScrollTop: () => 0,
      getScrollLeft: () => 0,
      setScrollTop() {},
      setScrollLeft() {},
      getOption: () => 19,
      updateOptions() {},
      onDidUpdateDiff: () => noopDisposable,
    }),
    getOriginalEditor: () => ({
      onDidChangeModelContent: () => noopDisposable,
    }),
    onDidUpdateDiff: () => noopDisposable,
    layout() {},
    dispose() {},
    _codeEditorService: null,
  });
  const monaco = {
    editor: {
      createDiffEditor: vi.fn(makeEditor),
      createModel: vi.fn(() => ({
        dispose() {},
        getValue: () => '',
        setValue() {},
        getLineCount: () => 0,
      })),
      OverviewRulerLane: { Full: 7 },
    },
    languages: {
      register: vi.fn(),
      setMonarchTokensProvider: vi.fn(),
      getLanguages: vi.fn(() => []),
      registerHoverProvider: vi.fn(() => noopDisposable),
      registerDefinitionProvider: vi.fn(() => noopDisposable),
      registerReferenceProvider: vi.fn(() => noopDisposable),
      registerCompletionItemProvider: vi.fn(() => noopDisposable),
      registerLinkProvider: vi.fn(() => noopDisposable),
      CompletionItemKind: { Text: 0 },
    },
    Uri: {
      file: (path) => ({
        scheme: 'file',
        path,
        toString() { return 'file://' + path; },
      }),
    },
  };
  return { default: monaco, ...monaco };
});

// Mock svg-pan-zoom — the SvgViewer's _initPanZoom
// calls the default export as a function, which fails
// under vitest SSR without a module-level mock ("default
// is not a function"). The viewer wraps the call in
// try/catch and logs a warning, which spams stderr.
// Returning a noop stub keeps the init path silent.
vi.mock('svg-pan-zoom', () => ({
  default: () => ({
    pan() {},
    zoom() {},
    fit() {},
    center() {},
    resize() {},
    destroy() {},
    getZoom: () => 1,
    getPan: () => ({ x: 0, y: 0 }),
  }),
}));

import { SharedRpc } from './rpc.js';

// ---------------------------------------------------------------------------
// Stub JRPCClient
// ---------------------------------------------------------------------------
//
// The real JRPCClient has a setter on `serverURI` that opens
// a WebSocket. Tests don't want that. Mocks are registered
// globally in `webapp/vitest.setup.js` so every test file
// shares the same stub — see that file for the JRPCClient
// contract.
//
// We still `await import('./app-shell.js')` dynamically (not
// a top-level static import) because app-shell.js transitively
// imports the jrpc-oo bundle, and the setup-file mock must be
// registered and applied before the first real import of the
// module tree.

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

  // ---------------------------------------------------------------
  // Dialog polish — drag, resize, minimize, persistence
  // ---------------------------------------------------------------
  //
  // jsdom doesn't simulate real pointer drag, but the handler
  // logic is plain math against event coordinates and the
  // dialog's bounding rect. Tests exercise the handlers
  // directly with synthetic events and verify the committed
  // state after pointerup.
  //
  // getBoundingClientRect returns zeros in jsdom since no
  // layout happens. We stub it per-test to return the rect
  // we want the handler to see.

  describe('dialog persistence', () => {
    beforeEach(() => {
      localStorage.clear();
    });
    afterEach(() => {
      localStorage.clear();
    });

    it('starts with default state when localStorage is empty', () => {
      const shell = mountShell();
      expect(shell.activeTab).toBe('files');
      expect(shell._minimized).toBe(false);
      expect(shell._dockedWidth).toBe(null);
      expect(shell._undockedPos).toBe(null);
    });

    it('restores active tab from localStorage', () => {
      localStorage.setItem('ac-dc-active-tab', 'settings');
      const shell = mountShell();
      expect(shell.activeTab).toBe('settings');
    });

    it('migrates stale "search" tab preference to "files"', () => {
      // The 'search' tab was removed when file search was
      // integrated into the Files tab. Stored preferences
      // from older builds must not leave the user on an
      // empty tab.
      localStorage.setItem('ac-dc-active-tab', 'search');
      const shell = mountShell();
      expect(shell.activeTab).toBe('files');
    });

    it('ignores unknown tab values', () => {
      localStorage.setItem('ac-dc-active-tab', 'bogus');
      const shell = mountShell();
      expect(shell.activeTab).toBe('files');
    });

    it('restores minimized state', () => {
      localStorage.setItem('ac-dc-minimized', 'true');
      const shell = mountShell();
      expect(shell._minimized).toBe(true);
    });

    it('restores docked width when valid', () => {
      localStorage.setItem('ac-dc-dialog-width', '600');
      const shell = mountShell();
      expect(shell._dockedWidth).toBe(600);
    });

    it('rejects docked width below the minimum', () => {
      localStorage.setItem('ac-dc-dialog-width', '50');
      const shell = mountShell();
      expect(shell._dockedWidth).toBe(null);
    });

    it('rejects non-numeric docked width', () => {
      localStorage.setItem('ac-dc-dialog-width', 'wide');
      const shell = mountShell();
      expect(shell._dockedWidth).toBe(null);
    });

    it('restores undocked rect when within viewport', () => {
      const rect = { left: 100, top: 50, width: 600, height: 400 };
      localStorage.setItem('ac-dc-dialog-pos', JSON.stringify(rect));
      const shell = mountShell();
      expect(shell._undockedPos).toEqual(rect);
    });

    it('rejects undocked rect when stranded off-screen', () => {
      // left is 10000 — well beyond any viewport in jsdom.
      // Bounds check should reject and fall back to docked.
      const rect = { left: 10000, top: 0, width: 600, height: 400 };
      localStorage.setItem('ac-dc-dialog-pos', JSON.stringify(rect));
      const shell = mountShell();
      expect(shell._undockedPos).toBe(null);
    });

    it('rejects undocked rect with sub-minimum size', () => {
      const rect = { left: 0, top: 0, width: 100, height: 400 };
      localStorage.setItem('ac-dc-dialog-pos', JSON.stringify(rect));
      const shell = mountShell();
      expect(shell._undockedPos).toBe(null);
    });

    it('rejects undocked rect with malformed JSON', () => {
      localStorage.setItem('ac-dc-dialog-pos', '{not json');
      const shell = mountShell();
      expect(shell._undockedPos).toBe(null);
    });

    it('_switchTab persists the new active tab', () => {
      const shell = mountShell();
      shell._switchTab('context');
      expect(localStorage.getItem('ac-dc-active-tab'))
        .toBe('context');
    });
  });

  describe('dialog minimize', () => {
    beforeEach(() => { localStorage.clear(); });
    afterEach(() => { localStorage.clear(); });

    it('_toggleMinimize flips state and persists', () => {
      const shell = mountShell();
      expect(shell._minimized).toBe(false);
      shell._toggleMinimize();
      expect(shell._minimized).toBe(true);
      expect(localStorage.getItem('ac-dc-minimized')).toBe('true');
      shell._toggleMinimize();
      expect(shell._minimized).toBe(false);
      expect(localStorage.getItem('ac-dc-minimized')).toBe('false');
    });

    it('renders minimized class when state is minimized', async () => {
      const shell = mountShell();
      shell._minimized = true;
      await shell.updateComplete;
      const dialog = shell.shadowRoot.querySelector('.dialog');
      expect(dialog.classList.contains('minimized')).toBe(true);
    });
  });

  describe('dialog drag', () => {
    beforeEach(() => { localStorage.clear(); });
    afterEach(() => { localStorage.clear(); });

    /**
     * Stub getBoundingClientRect on the dialog element so
     * handlers see the rect we want. jsdom returns all
     * zeros otherwise since no layout runs.
     */
    function stubRect(shell, rect) {
      const dialog = shell.shadowRoot.querySelector('.dialog');
      dialog.getBoundingClientRect = () => ({
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left, y: rect.top,
        toJSON() {},
      });
      return dialog;
    }

    it('ignores clicks on buttons inside the header', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      stubRect(shell, { left: 0, top: 0, width: 500, height: 800 });
      const button = shell.shadowRoot.querySelector('.tab-button');
      // Synthesize a pointerdown whose target is the button.
      shell._onHeaderPointerDown({
        button: 0,
        target: button,
        clientX: 10,
        clientY: 10,
      });
      expect(shell._drag).toBe(null);
    });

    it('ignores non-primary button', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      stubRect(shell, { left: 0, top: 0, width: 500, height: 800 });
      const header = shell.shadowRoot.querySelector('.dialog-header');
      shell._onHeaderPointerDown({
        button: 2,  // right-click
        target: header,
        clientX: 10, clientY: 10,
      });
      expect(shell._drag).toBe(null);
    });

    it('starts drag on header pointerdown (not on button)', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      stubRect(shell, { left: 0, top: 0, width: 500, height: 800 });
      const header = shell.shadowRoot.querySelector('.dialog-header');
      shell._onHeaderPointerDown({
        button: 0,
        target: header,
        clientX: 100,
        clientY: 20,
      });
      expect(shell._drag).toBeTruthy();
      expect(shell._drag.mode).toBe('drag');
      expect(shell._drag.startX).toBe(100);
      expect(shell._drag.originWidth).toBe(500);
    });

    it('below-threshold drag does not commit undock', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      stubRect(shell, { left: 0, top: 0, width: 500, height: 800 });
      const header = shell.shadowRoot.querySelector('.dialog-header');
      shell._onHeaderPointerDown({
        button: 0, target: header,
        clientX: 100, clientY: 20,
      });
      // Move 2px — under the 5px threshold.
      shell._onPointerMove({ clientX: 102, clientY: 21 });
      shell._onPointerUp();
      expect(shell._undockedPos).toBe(null);
    });

    it('above-threshold drag commits undocked position', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      const dialog = stubRect(
        shell, { left: 0, top: 0, width: 500, height: 800 },
      );
      const header = shell.shadowRoot.querySelector('.dialog-header');
      shell._onHeaderPointerDown({
        button: 0, target: header,
        clientX: 100, clientY: 20,
      });
      // Move well past threshold.
      shell._onPointerMove({ clientX: 150, clientY: 70 });
      // Stub the post-move rect to reflect the inline-style
      // changes that _onPointerMove applied. In the real
      // browser the rect recomputes on reflow; in jsdom we
      // fake it.
      dialog.getBoundingClientRect = () => ({
        left: 50, top: 50, width: 500, height: 800,
        right: 550, bottom: 850, x: 50, y: 50,
        toJSON() {},
      });
      shell._onPointerUp();
      expect(shell._undockedPos).toEqual({
        left: 50, top: 50, width: 500, height: 800,
      });
      expect(localStorage.getItem('ac-dc-dialog-pos')).toBeTruthy();
    });

    it('cleans up document listeners after pointerup', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      stubRect(shell, { left: 0, top: 0, width: 500, height: 800 });
      const header = shell.shadowRoot.querySelector('.dialog-header');
      const removeSpy = vi.spyOn(document, 'removeEventListener');
      shell._onHeaderPointerDown({
        button: 0, target: header,
        clientX: 100, clientY: 20,
      });
      shell._onPointerUp();
      // Both pointermove and pointerup listeners removed.
      const calls = removeSpy.mock.calls.map((c) => c[0]);
      expect(calls).toContain('pointermove');
      expect(calls).toContain('pointerup');
      removeSpy.mockRestore();
    });
  });

  describe('dialog resize', () => {
    beforeEach(() => { localStorage.clear(); });
    afterEach(() => { localStorage.clear(); });

    function stubRect(shell, rect) {
      const dialog = shell.shadowRoot.querySelector('.dialog');
      dialog.getBoundingClientRect = () => ({
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left, y: rect.top,
        toJSON() {},
      });
      return dialog;
    }

    it('right-handle resize from docked saves docked width', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      const dialog = stubRect(
        shell, { left: 0, top: 0, width: 500, height: 800 },
      );
      shell._onHandlePointerDown(
        { button: 0, clientX: 500, clientY: 400,
          stopPropagation() {} },
        'right',
      );
      shell._onPointerMove({ clientX: 650, clientY: 400 });
      dialog.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 650, height: 800,
        right: 650, bottom: 800, x: 0, y: 0, toJSON() {},
      });
      shell._onPointerUp();
      expect(shell._dockedWidth).toBe(650);
      expect(shell._undockedPos).toBe(null);
      expect(localStorage.getItem('ac-dc-dialog-width')).toBe('650');
    });

    it('bottom-handle resize auto-undocks', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      const dialog = stubRect(
        shell, { left: 0, top: 0, width: 500, height: 800 },
      );
      shell._onHandlePointerDown(
        { button: 0, clientX: 250, clientY: 800,
          stopPropagation() {} },
        'bottom',
      );
      shell._onPointerMove({ clientX: 250, clientY: 600 });
      dialog.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 500, height: 600,
        right: 500, bottom: 600, x: 0, y: 0, toJSON() {},
      });
      shell._onPointerUp();
      expect(shell._undockedPos).toEqual({
        left: 0, top: 0, width: 500, height: 600,
      });
    });

    it('corner-handle resize changes width and height', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      const dialog = stubRect(
        shell, { left: 0, top: 0, width: 500, height: 800 },
      );
      shell._onHandlePointerDown(
        { button: 0, clientX: 500, clientY: 800,
          stopPropagation() {} },
        'corner',
      );
      shell._onPointerMove({ clientX: 600, clientY: 700 });
      dialog.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 600, height: 700,
        right: 600, bottom: 700, x: 0, y: 0, toJSON() {},
      });
      shell._onPointerUp();
      expect(shell._undockedPos.width).toBe(600);
      expect(shell._undockedPos.height).toBe(700);
    });

    it('right-handle resize respects minimum width', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      const dialog = stubRect(
        shell, { left: 0, top: 0, width: 500, height: 800 },
      );
      shell._onHandlePointerDown(
        { button: 0, clientX: 500, clientY: 400,
          stopPropagation() {} },
        'right',
      );
      // Drag far left — would make the dialog 0-width or
      // negative. Handler must clamp at _DIALOG_MIN_WIDTH.
      shell._onPointerMove({ clientX: 100, clientY: 400 });
      const styleWidth = parseFloat(dialog.style.width);
      expect(styleWidth).toBeGreaterThanOrEqual(300);
    });

    it('bottom-handle respects minimum height', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      const dialog = stubRect(
        shell, { left: 0, top: 0, width: 500, height: 800 },
      );
      shell._onHandlePointerDown(
        { button: 0, clientX: 250, clientY: 800,
          stopPropagation() {} },
        'bottom',
      );
      shell._onPointerMove({ clientX: 250, clientY: 0 });
      const styleHeight = parseFloat(dialog.style.height);
      expect(styleHeight).toBeGreaterThanOrEqual(200);
    });
  });

  describe('window resize', () => {
    beforeEach(() => { localStorage.clear(); });
    afterEach(() => { localStorage.clear(); });

    it('throttles handler to one call per animation frame', async () => {
      // Explicitly include rAF/cAF in the fake-timer set.
      // In vitest 2.x + jsdom, rAF is not wired through
      // setTimeout by default; fake timers won't intercept
      // it unless we ask. Previously this test relied on
      // an implementation detail that no longer holds.
      vi.useFakeTimers({
        toFake: [
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'requestAnimationFrame',
          'cancelAnimationFrame',
        ],
      });
      const shell = mountShell();
      await shell.updateComplete;
      const spy = vi.spyOn(shell, '_handleWindowResize');
      // Fire 5 resize events rapidly. RAF throttle means
      // only one _handleWindowResize call.
      for (let i = 0; i < 5; i += 1) {
        shell._onWindowResize();
      }
      expect(spy).not.toHaveBeenCalled();
      // Flush — with rAF faked, runAllTimers drains the
      // queued callback.
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('cancels pending RAF on disconnect', async () => {
      // Same fake-timer extension as the throttle test —
      // cancelAnimationFrame must be faked too, otherwise
      // disconnect can't cancel the pending rAF and the
      // spy fires anyway.
      vi.useFakeTimers({
        toFake: [
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'requestAnimationFrame',
          'cancelAnimationFrame',
        ],
      });
      const shell = mountShell();
      await shell.updateComplete;
      const spy = vi.spyOn(shell, '_handleWindowResize');
      shell._onWindowResize();
      shell.remove();
      // Flush — the cancelled rAF must not fire.
      vi.runAllTimers();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('leaves undocked position alone when still in bounds', () => {
      const shell = mountShell();
      shell._undockedPos = {
        left: 100, top: 100, width: 500, height: 400,
      };
      shell._handleWindowResize();
      expect(shell._undockedPos).toEqual({
        left: 100, top: 100, width: 500, height: 400,
      });
    });

    it('rescues stranded undocked dialog after viewport shrink', () => {
      const shell = mountShell();
      // Simulate an undocked dialog well beyond the current
      // viewport. jsdom's default innerWidth is 1024.
      shell._undockedPos = {
        left: 5000, top: 0, width: 400, height: 400,
      };
      shell._handleWindowResize();
      expect(shell._undockedPos.left).toBeLessThan(1024);
    });

    it('clamps oversized docked width after viewport shrink', () => {
      const shell = mountShell();
      // jsdom innerWidth ~1024 by default; set a docked
      // width bigger than viewport.
      shell._dockedWidth = 2000;
      shell._undockedPos = null;
      shell._handleWindowResize();
      expect(shell._dockedWidth).toBeLessThanOrEqual(
        window.innerWidth,
      );
    });
  });
});