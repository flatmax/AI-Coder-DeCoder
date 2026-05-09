// Shared test helpers and mocks for app-shell.test.js splits.
//
// All AppShell test files import mounting + cleanup helpers
// from here. The top-level vi.mock calls in this file run
// once per test file that imports it (vi.mock is hoisted per
// importing module), giving each test file a fresh stub for
// monaco-editor and svg-pan-zoom without duplicating the
// boilerplate.
//
// Why this file and not vitest.setup.js: the JRPCClient stub
// lives in vitest.setup.js because it must apply globally
// before any imports resolve. The monaco/svg-pan-zoom mocks
// here are AppShell-specific — other test files (e.g.,
// diff-viewer's own tests) install their own monaco mocks
// with different shapes. Keeping these scoped to AppShell
// tests prevents cross-file mock leakage.

import { afterEach, beforeEach, vi } from 'vitest';
import { SharedRpc } from '../rpc.js';

vi.mock('monaco-editor/esm/vs/editor/edcore.main.js', () => {
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

import { AppShell } from './index.js';

/**
 * Create and attach an AppShell instance to the document.
 * Returns the element so tests can exercise methods and
 * inspect reactive state.
 *
 * Tracked in `_mountedShells` so the shared afterEach hook
 * can remove them — leaked elements accumulate toast
 * timers and SharedRpc subscriptions across tests.
 */
const _mountedShells = [];
export function mountShell() {
  const shell = document.createElement('ac-app-shell');
  document.body.appendChild(shell);
  _mountedShells.push(shell);
  return shell;
}

export function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Install the prototype-level patches and lifecycle hooks
 * that every AppShell test suite shares. Call once at the
 * top of each test file's outer describe.
 *
 * Why prototype-patching: setupDone, streamComplete, and
 * the three child-tab onRpcReady hooks all call RPC
 * methods on whatever fake proxy the test installed. Most
 * tests don't care about those calls (they're testing
 * shell-level behaviour), so a unified silence at the
 * prototype level keeps the output clean without forcing
 * every test to install matching stubs.
 */
export function installAppShellTestSetup() {
  let _origFetchHistoryStatus;
  let _origFilesTabLoadTree;
  let _origSettingsLoadInfo;
  let _origContextRefresh;

  beforeEach(async () => {
    SharedRpc.reset();
    vi.useRealTimers();
    localStorage.clear();
    _origFetchHistoryStatus = AppShell.prototype._fetchHistoryStatus;
    AppShell.prototype._fetchHistoryStatus = function () {};
    // Child tabs all live in separate modules. Import
    // them lazily so the test file doesn't need an
    // explicit import — they're already loaded
    // transitively via app-shell.js.
    const { FilesTab } =
      await import('../files-tab/index.js');
    const { SettingsTab } =
      await import('../settings-tab.js');
    const { ContextTab } =
      await import('../context-tab.js');
    _origFilesTabLoadTree = FilesTab.prototype._loadFileTree;
    _origSettingsLoadInfo = SettingsTab.prototype._loadInfo;
    _origContextRefresh = ContextTab.prototype._refresh;
    FilesTab.prototype._loadFileTree = async function () {};
    SettingsTab.prototype._loadInfo = async function () {};
    ContextTab.prototype._refresh = async function () {};
  });

  afterEach(async () => {
    while (_mountedShells.length) {
      const shell = _mountedShells.pop();
      if (shell.isConnected) {
        shell.remove();
      }
    }
    SharedRpc.reset();
    AppShell.prototype._fetchHistoryStatus = _origFetchHistoryStatus;
    const { FilesTab } =
      await import('../files-tab/index.js');
    const { SettingsTab } =
      await import('../settings-tab.js');
    const { ContextTab } =
      await import('../context-tab.js');
    FilesTab.prototype._loadFileTree = _origFilesTabLoadTree;
    SettingsTab.prototype._loadInfo = _origSettingsLoadInfo;
    ContextTab.prototype._refresh = _origContextRefresh;
  });
}

export { SharedRpc } from '../rpc.js';