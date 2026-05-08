// Shared test infrastructure for diff-viewer tests.
//
// Monaco is mocked at module load via vi.hoisted +
// vi.mock so importers get the fake editor namespace
// without pulling 2MB of Monaco bundle into jsdom.
//
// Tests import what they need from this module and call
// `beforeEachSetup()` inside their own `beforeEach` to
// reset state. `installCleanup()` runs at module load
// and registers a single shared `afterEach` that tears
// down mounted elements.

import { afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Monaco mock — registered BEFORE importing diff-viewer.js
// ---------------------------------------------------------------------------

// `vi.mock` factories are hoisted by vitest to the top of
// the file before normal top-level `const` declarations
// run. A plain top-level `const monacoState = ...` would
// be in the temporal dead zone when the mock factory
// evaluated. `vi.hoisted` is the escape hatch — it runs
// its callback at the same hoisted stage as mock
// factories, so the returned object is in scope for both
// the factory and the tests below.
//
// Note: vitest forbids `export` on a hoisted destructure,
// so we destructure into module-local bindings and
// re-export `monacoState` via a separate statement
// below. `makeModel`/`makeEditor` stay private — only the
// mock factory uses them.
const { monacoState, makeModel, makeEditor } = vi.hoisted(() => {
  const state = {
    editors: [],
    models: [],
    registeredLanguages: new Set(),
    registeredTokenizers: [],
    lspProviders: {
      hover: [],
      definition: [],
      reference: [],
      completion: [],
    },
    linkProviders: [],
    linkOpeners: [],
  };

  function _makeModel(content, language) {
    const model = {
      _content: content,
      _language: language,
      _disposed: false,
      _changeListeners: [],
      getValue: vi.fn(() => model._content),
      setValue: vi.fn((v) => {
        model._content = v;
        for (const cb of model._changeListeners) cb();
      }),
      findMatches: vi.fn(() => []),
      getLineCount: vi.fn(() => {
        return (model._content || '').split('\n').length;
      }),
      dispose: vi.fn(() => {
        model._disposed = true;
      }),
      onDidChangeContent: vi.fn((cb) => {
        model._changeListeners.push(cb);
        return { dispose: vi.fn() };
      }),
    };
    state.models.push(model);
    return model;
  }

  function _makeEditor(container) {
    let currentModel = null;
    const editor = {
      _container: container,
      _disposed: false,
      _contentListeners: [],
      _updateDiffListeners: [],
      _scrollListeners: [],
      _options: { readOnly: false },
      _scrollTop: 0,
      _scrollLeft: 0,
      _position: { lineNumber: 1, column: 1 },
      setModel: vi.fn((models) => {
        currentModel = models;
      }),
      getModel: vi.fn(() => currentModel),
      getModifiedEditor: vi.fn(() => ({
        onDidChangeModelContent: vi.fn((cb) => {
          editor._contentListeners.push(cb);
          return { dispose: vi.fn() };
        }),
        onDidScrollChange: vi.fn((cb) => {
          editor._scrollListeners.push(cb);
          return { dispose: vi.fn() };
        }),
        getValue: vi.fn(
          () => currentModel?.modified?._content || '',
        ),
        updateOptions: vi.fn((opts) => {
          Object.assign(editor._options, opts);
        }),
        getScrollTop: vi.fn(() => editor._scrollTop),
        getScrollLeft: vi.fn(() => editor._scrollLeft),
        setScrollTop: vi.fn((n) => {
          editor._scrollTop = n;
        }),
        setScrollLeft: vi.fn((n) => {
          editor._scrollLeft = n;
        }),
        getPosition: vi.fn(() => editor._position),
        setPosition: vi.fn((p) => {
          editor._position = p;
        }),
        getModel: vi.fn(() => currentModel?.modified),
        getOption: vi.fn(() => 20), // fixed line height
        revealLineInCenter: vi.fn(),
        revealRangeInCenter: vi.fn(),
        deltaDecorations: vi.fn((_old, _new) => []),
        _codeEditorService: null, // patch target
      })),
      onDidUpdateDiff: vi.fn((cb) => {
        editor._updateDiffListeners.push(cb);
        return { dispose: vi.fn() };
      }),
      layout: vi.fn(),
      dispose: vi.fn(() => {
        editor._disposed = true;
      }),
      // Simulate a content-change event from user input.
      _simulateContentChange(newValue) {
        if (currentModel?.modified) {
          currentModel.modified._content = newValue;
        }
        for (const cb of editor._contentListeners) cb();
      },
      // Simulate the editor scrolling. Tests set
      // _scrollTop then call this to fire the listeners.
      _simulateScroll(scrollTop) {
        editor._scrollTop = scrollTop;
        for (const cb of editor._scrollListeners) cb();
      },
    };
    state.editors.push(editor);
    return editor;
  }

  return {
    monacoState: state,
    makeModel: _makeModel,
    makeEditor: _makeEditor,
  };
});

export { monacoState };

vi.mock('monaco-editor/esm/vs/editor/edcore.main.js', () => {
  const monaco = {
    editor: {
      createDiffEditor: vi.fn((container, options) => {
        const editor = makeEditor(container);
        // Stash the construction options so tests can
        // assert on them without needing access to the
        // mock function's call list (which isn't exported
        // from the hoisted factory).
        editor._constructionOptions = options || {};
        return editor;
      }),
      createModel: vi.fn((content, language) =>
        makeModel(content, language),
      ),
      OverviewRulerLane: { Full: 7 },
      EditorOption: { lineHeight: 66 },
    },
    languages: {
      register: vi.fn((info) => {
        monacoState.registeredLanguages.add(info.id);
      }),
      setMonarchTokensProvider: vi.fn((id, provider) => {
        monacoState.registeredTokenizers.push({ id, provider });
      }),
      getLanguages: vi.fn(() =>
        [...monacoState.registeredLanguages].map((id) => ({ id })),
      ),
      CompletionItemKind: {
        Text: 0,
        Method: 1,
        Function: 2,
      },
      registerHoverProvider: vi.fn((selector, provider) => {
        monacoState.lspProviders.hover.push({ selector, provider });
        return { dispose: vi.fn() };
      }),
      registerDefinitionProvider: vi.fn((selector, provider) => {
        monacoState.lspProviders.definition.push({
          selector,
          provider,
        });
        return { dispose: vi.fn() };
      }),
      registerReferenceProvider: vi.fn((selector, provider) => {
        monacoState.lspProviders.reference.push({
          selector,
          provider,
        });
        return { dispose: vi.fn() };
      }),
      registerCompletionItemProvider: vi.fn(
        (selector, provider) => {
          monacoState.lspProviders.completion.push({
            selector,
            provider,
          });
          return { dispose: vi.fn() };
        },
      ),
      registerLinkProvider: vi.fn((language, provider) => {
        monacoState.linkProviders.push({ language, provider });
        return { dispose: vi.fn() };
      }),
    },
    Uri: {
      file: (path) => ({
        scheme: 'file',
        path: path.startsWith('/') ? path : '/' + path,
        toString() {
          return 'file://' + this.path;
        },
      }),
    },
  };
  // Extend editor namespace with link opener
  // registration. Lives on monaco.editor per Monaco's
  // real API.
  monaco.editor.registerEditorOpener = vi.fn((opener) => {
    monacoState.linkOpeners.push(opener);
    return { dispose: vi.fn() };
  });
  return { default: monaco, ...monaco };
});

// ---------------------------------------------------------------------------
// NOW import diff-viewer — after mocks are registered
// ---------------------------------------------------------------------------

import '../diff-viewer.js';
import { _resetInstallGuard } from '../lsp-providers.js';
import { _resetInstallGuard as _resetLinkGuard } from '../markdown-link-provider.js';
// Grab a reference to the mocked monaco namespace so
// tests can reset the LSP install guard between cases.
import { monaco as _mockedMonaco } from '../monaco-setup.js';

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------

// Reset mock state between tests. Don't clear
// registeredLanguages — matlab is registered at module
// load and stays across tests.
export function resetMonacoState() {
  monacoState.editors = [];
  monacoState.models = [];
  monacoState.lspProviders.hover = [];
  monacoState.lspProviders.definition = [];
  monacoState.lspProviders.reference = [];
  monacoState.lspProviders.completion = [];
  monacoState.linkProviders = [];
  monacoState.linkOpeners = [];
}

// ---------------------------------------------------------------------------
// SharedRpc injection — tests provide a fake proxy
// ---------------------------------------------------------------------------

export function setFakeRpc(handlers) {
  const call = {};
  for (const [method, impl] of Object.entries(handlers)) {
    call[method] = impl;
  }
  globalThis.__sharedRpcOverride = call;
}

export function clearFakeRpc() {
  delete globalThis.__sharedRpcOverride;
}

// ---------------------------------------------------------------------------
// Mounting & settling
// ---------------------------------------------------------------------------

const _mounted = [];

export function mountViewer() {
  const el = document.createElement('ac-diff-viewer');
  document.body.appendChild(el);
  _mounted.push(el);
  return el;
}

export async function settle(el) {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

// ---------------------------------------------------------------------------
// Per-test setup hook (callers invoke inside their own beforeEach)
// ---------------------------------------------------------------------------

export function beforeEachSetup() {
  resetMonacoState();
  clearFakeRpc();
  _resetInstallGuard(_mockedMonaco);
  _resetLinkGuard(_mockedMonaco);
}

// ---------------------------------------------------------------------------
// Cleanup — auto-installed at module load
// ---------------------------------------------------------------------------

export function installCleanup() {
  afterEach(() => {
    while (_mounted.length) {
      const el = _mounted.pop();
      if (el.isConnected) el.remove();
    }
    clearFakeRpc();
  });
}

// ---------------------------------------------------------------------------
// Keyboard helper
// ---------------------------------------------------------------------------

export function fireKey(el, key, opts = {}) {
  const ev = new KeyboardEvent('keydown', {
    key,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  // composedPath needs the element in it; jsdom gives
  // an empty path by default for programmatic events,
  // so we override.
  Object.defineProperty(ev, 'composedPath', {
    value: () => [el, document.body, document],
  });
  el.dispatchEvent(ev);
  return ev;
}

installCleanup();