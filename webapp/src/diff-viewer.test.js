// Tests for diff-viewer.js — Monaco-based side-by-side
// diff editor.
//
// Monaco is mocked at the module level so tests run
// without pulling in 2MB of Monaco bundle or fighting with
// jsdom's incomplete Worker/URL implementations. The mock
// tracks calls so we can assert on the editor-model
// contract (open-file → model-set, switch-file → swap +
// dispose, close-last-file → editor dispose).
//
// monaco-setup.js runs its side effects at module load;
// since we're mocking monaco-editor, those side effects
// call into our mock's register/setMonarchTokensProvider
// methods — harmless no-ops.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// Reset mock state between tests.
function resetMonacoState() {
  monacoState.editors = [];
  monacoState.models = [];
  monacoState.lspProviders.hover = [];
  monacoState.lspProviders.definition = [];
  monacoState.lspProviders.reference = [];
  monacoState.lspProviders.completion = [];
  monacoState.linkProviders = [];
  monacoState.linkOpeners = [];
  // Don't clear registeredLanguages — matlab is registered
  // at module load and stays across tests. But do reset
  // the editors and models.
}

// ---------------------------------------------------------------------------
// SharedRpc injection — tests provide a fake proxy
// ---------------------------------------------------------------------------

function setFakeRpc(handlers) {
  const call = {};
  for (const [method, impl] of Object.entries(handlers)) {
    call[method] = impl;
  }
  globalThis.__sharedRpcOverride = call;
}

function clearFakeRpc() {
  delete globalThis.__sharedRpcOverride;
}

// ---------------------------------------------------------------------------
// NOW import diff-viewer — after mocks are registered
// ---------------------------------------------------------------------------

import './diff-viewer.js';
import { _resetInstallGuard } from './lsp-providers.js';
import { _resetInstallGuard as _resetLinkGuard } from './markdown-link-provider.js';
// Grab a reference to the mocked monaco namespace so
// tests can reset the LSP install guard between cases.
import { monaco as _mockedMonaco } from './monaco-setup.js';

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

const _mounted = [];

function mountViewer() {
  const el = document.createElement('ac-diff-viewer');
  document.body.appendChild(el);
  _mounted.push(el);
  return el;
}

async function settle(el) {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

beforeEach(() => {
  resetMonacoState();
  clearFakeRpc();
  _resetInstallGuard(_mockedMonaco);
  _resetLinkGuard(_mockedMonaco);
});

afterEach(() => {
  while (_mounted.length) {
    const el = _mounted.pop();
    if (el.isConnected) el.remove();
  }
  clearFakeRpc();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('DiffViewer initial state', () => {
  it('renders empty-state watermark when no files open', async () => {
    const el = mountViewer();
    await settle(el);
    const empty = el.shadowRoot.querySelector('.empty-state');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toMatch(/AC.*⚡.*DC/);
  });

  it('has no open files initially', async () => {
    const el = mountViewer();
    await settle(el);
    expect(el.hasOpenFiles).toBe(false);
    expect(el.getDirtyFiles()).toEqual([]);
  });

  it('creates no Monaco editor before any file opens', async () => {
    const el = mountViewer();
    await settle(el);
    expect(monacoState.editors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// openFile — basic lifecycle
// ---------------------------------------------------------------------------

describe('DiffViewer openFile', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (path, ref) => {
        return ref === 'HEAD' ? `HEAD:${path}` : `WORK:${path}`;
      }),
    });
  });

  it('opens a file and fires active-file-changed', async () => {
    const el = mountViewer();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({
      path: 'src/main.py',
    });
    expect(el.hasOpenFiles).toBe(true);
  });

  it('creates a Monaco editor on first open', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(monacoState.editors.length).toBe(1);
  });

  it('fetches both HEAD and working copy', async () => {
    const el = mountViewer();
    await settle(el);
    const rpc = globalThis.__sharedRpcOverride[
      'Repo.get_file_content'
    ];
    await el.openFile({ path: 'src/foo.py' });
    await settle(el);
    // HEAD fetch + working-copy fetch = 2 calls.
    expect(rpc).toHaveBeenCalledWith('src/foo.py', 'HEAD');
    expect(rpc).toHaveBeenCalledWith('src/foo.py');
  });

  it('handles HEAD fetch failure as a new file', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (_path, ref) => {
        if (ref === 'HEAD') throw new Error('not in HEAD');
        return 'working content';
      }),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'new.py' });
    await settle(el);
    const file = el._file;
    expect(file.isNew).toBe(true);
    expect(file.original).toBe('');
    expect(file.modified).toBe('working content');
  });

  it('handles working-copy fetch failure gracefully', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (_path, ref) => {
        if (ref === 'HEAD') return 'head content';
        throw new Error('deleted');
      }),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'deleted.py' });
    await settle(el);
    const file = el._file;
    expect(file.original).toBe('head content');
    expect(file.modified).toBe('');
  });

  it('handles missing RPC (no SharedRpc) gracefully', async () => {
    clearFakeRpc();
    const el = mountViewer();
    await settle(el);
    // No RPC available; opens with empty content.
    await el.openFile({ path: 'a.py' });
    await settle(el);
    expect(el.hasOpenFiles).toBe(true);
    expect(el._file.original).toBe('');
    expect(el._file.modified).toBe('');
  });

  it('same-file open refetches (no-cache model)', async () => {
    // D18 contract: every openFile fetches fresh. Clicking
    // the same file twice hits the RPC twice, and
    // active-file-changed fires on every open — the viewer
    // rebuilt its models so listeners need to know.
    const el = mountViewer();
    await settle(el);
    const rpc = globalThis.__sharedRpcOverride[
      'Repo.get_file_content'
    ];
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const callsAfterFirst = rpc.mock.calls.length;
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    // Second open fetched HEAD + working again.
    expect(rpc.mock.calls.length).toBe(callsAfterFirst + 2);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('opening a second file creates a new model pair', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const modelsBeforeB = monacoState.models.length;
    await el.openFile({ path: 'b.py' });
    await settle(el);
    // +2 new models (original + modified).
    expect(monacoState.models.length).toBe(modelsBeforeB + 2);
  });

  it('re-opening inactive file swaps models', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    await el.openFile({ path: 'b.py' });
    await settle(el);
    const setModelCalls =
      monacoState.editors[0].setModel.mock.calls.length;
    await el.openFile({ path: 'a.py' });
    await settle(el);
    // +1 setModel call when swapping back to a.
    expect(
      monacoState.editors[0].setModel.mock.calls.length,
    ).toBe(setModelCalls + 1);
    // Still only one editor instance.
    expect(monacoState.editors.length).toBe(1);
  });

  it('disposes old models on swap', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const aOriginal = monacoState.models[0];
    const aModified = monacoState.models[1];
    await el.openFile({ path: 'b.py' });
    await settle(el);
    // a's models disposed (swap triggered).
    expect(aOriginal.dispose).toHaveBeenCalled();
    expect(aModified.dispose).toHaveBeenCalled();
  });

  it('ignores malformed openFile calls', async () => {
    const el = mountViewer();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    await el.openFile(null);
    await el.openFile({});
    await el.openFile({ path: '' });
    await el.openFile({ path: 42 });
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
    expect(el.hasOpenFiles).toBe(false);
  });

  it('concurrent openFile for same path supersedes', async () => {
    // No-cache model: both calls fetch, but the
    // generation counter ensures only the last resolving
    // fetch attaches its models. End state has one file
    // in the single-file slot.
    const el = mountViewer();
    await settle(el);
    const p1 = el.openFile({ path: 'a.py' });
    const p2 = el.openFile({ path: 'a.py' });
    await Promise.all([p1, p2]);
    await settle(el);
    expect(el._file?.path).toBe('a.py');
  });

  it('concurrent openFile for different paths supersedes to last', async () => {
    // Single-file slot means only the last call's file
    // survives. The first call's fetch resolves with a
    // superseded generation and skips model-attach.
    const el = mountViewer();
    await settle(el);
    const p1 = el.openFile({ path: 'a.py' });
    const p2 = el.openFile({ path: 'b.py' });
    await Promise.all([p1, p2]);
    await settle(el);
    expect(el._file?.path).toBe('b.py');
  });

  it('generation counter discards a slow fetch that resolves late', async () => {
    // A late-resolving fetch from a superseded openFile
    // call must NOT clobber the active file. The
    // generation counter is the guard: each openFile
    // bumps it and captures its value; when the fetch
    // resolves, the handler checks whether the counter
    // has advanced past the captured value, and if so
    // skips model-attach.
    //
    // This test exposes the race directly — manually
    // holds the first fetch open, lets the second
    // complete, then resolves the first. Without the
    // generation guard, the stale fetch's model-attach
    // would overwrite b.py with a.py's stale content.
    let resolveFirst;
    const firstPromise = new Promise((r) => {
      resolveFirst = r;
    });
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (path) => {
        if (path === 'slow.py') return firstPromise;
        return `content of ${path}`;
      }),
    });
    const el = mountViewer();
    await settle(el);
    // Start the slow fetch — don't await yet.
    const slowFetch = el.openFile({ path: 'slow.py' });
    // Second call for a different path. Its fetch
    // resolves immediately.
    await el.openFile({ path: 'fast.py' });
    await settle(el);
    expect(el._file?.path).toBe('fast.py');
    // Now resolve the slow fetch. It's stale — the
    // generation counter has advanced. The active file
    // must stay as fast.py.
    resolveFirst('stale content');
    await slowFetch;
    await settle(el);
    expect(el._file?.path).toBe('fast.py');
    expect(el._file?.modified).not.toBe('stale content');
  });
});

// ---------------------------------------------------------------------------
// closeFile
// ---------------------------------------------------------------------------

describe('DiffViewer closeFile', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => ''),
    });
  });

  it('closes the active file and disposes the editor', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'only.py' });
    await settle(el);
    const editor = monacoState.editors[0];
    el.closeFile('only.py');
    await settle(el);
    expect(el.hasOpenFiles).toBe(false);
    expect(editor.dispose).toHaveBeenCalled();
  });

  it('closing the active file returns to empty state', async () => {
    // Single-file model: closing replaces the active
    // file with nothing. There's no "next file" to
    // activate — specs4 dropped that concept.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('a.py');
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBe(null);
    expect(el.hasOpenFiles).toBe(false);
  });

  it('closing an unknown file is a no-op', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('does-not-exist.py');
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Dirty tracking & saving
// ---------------------------------------------------------------------------

describe('DiffViewer dirty tracking', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (_path, ref) =>
        ref === 'HEAD' ? 'original' : 'original',
      ),
    });
  });

  it('file is not dirty immediately after open', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    expect(el.getDirtyFiles()).toEqual([]);
    expect(el._dirty).toBe(false);
  });

  it('editing the content marks the file dirty', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    // Simulate user typing via the mock editor.
    monacoState.editors[0]._simulateContentChange('edited');
    await settle(el);
    expect(el.getDirtyFiles()).toEqual(['a.py']);
    expect(el._dirty).toBe(true);
  });

  it('saving clears the dirty flag and fires file-saved', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('edited');
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    await el._saveFile('a.py');
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBe('a.py');
    expect(listener.mock.calls[0][0].detail.content).toBe('edited');
    expect(el.getDirtyFiles()).toEqual([]);
  });

  it('saveAll saves the active file when dirty', async () => {
    // Single-file model: saveAll is a one-file operation.
    // Edits to a prior file were discarded on switch per
    // the no-cache contract, so there's nothing to save
    // across multiple files.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('a-edited');
    await settle(el);
    expect(el.getDirtyFiles()).toEqual(['a.py']);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    await el.saveAll();
    expect(listener).toHaveBeenCalledOnce();
    expect(el.getDirtyFiles()).toEqual([]);
  });

  it('saveAll no-op when active file is clean', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    await el.saveAll();
    expect(listener).not.toHaveBeenCalled();
  });

  it('switching away discards unsaved edits', async () => {
    // The defining assertion of the no-cache contract.
    // Edits to `a.py` are gone after opening `b.py` — no
    // multi-file dirty set, no preserved buffer.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('a-edited');
    await settle(el);
    expect(el.getDirtyFiles()).toEqual(['a.py']);
    await el.openFile({ path: 'b.py' });
    await settle(el);
    // Fresh fetch of b.py from the mock returns its HEAD
    // content; the in-flight edit to a.py is discarded.
    expect(el.getDirtyFiles()).toEqual([]);
    expect(el._file.path).toBe('b.py');
  });
});

// ---------------------------------------------------------------------------
// Virtual files
// ---------------------------------------------------------------------------

describe('DiffViewer virtual files', () => {
  it('opens a virtual file with explicit content', async () => {
    // Virtual files need no RPC.
    const el = mountViewer();
    await settle(el);
    await el.openFile({
      path: 'virtual://example',
      virtualContent: 'hello world',
    });
    await settle(el);
    expect(el._file.modified).toBe('hello world');
    expect(el._file.isVirtual).toBe(true);
  });

  it('virtual files are never dirty even after edit', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({
      path: 'virtual://example',
      virtualContent: 'x',
    });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('y');
    await settle(el);
    // Dirty check treats virtual as read-only.
    expect(el.getDirtyFiles()).toEqual([]);
  });

  it('virtual files never trigger RPC fetches', async () => {
    const rpc = vi.fn();
    setFakeRpc({ 'Repo.get_file_content': rpc });
    const el = mountViewer();
    await settle(el);
    await el.openFile({
      path: 'virtual://thing',
      virtualContent: 'content',
    });
    await settle(el);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('closing a virtual file clears the slot', async () => {
    // No persistent content map in the single-file
    // model — virtual content lives on _file.modified
    // while the file is open and is discarded on close.
    const el = mountViewer();
    await settle(el);
    await el.openFile({
      path: 'virtual://thing',
      virtualContent: 'x',
    });
    await settle(el);
    expect(el._file?.modified).toBe('x');
    el.closeFile('virtual://thing');
    await settle(el);
    expect(el._file).toBe(null);
    expect(el.hasOpenFiles).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadPanel — ad-hoc comparison
// ---------------------------------------------------------------------------

describe('DiffViewer loadPanel', () => {
  it('activates the virtual-comparison slot when no file is open', async () => {
    // Single-file model: loadPanel populates the
    // dedicated _virtualComparison slot, not a file
    // entry in a list. The two slots are mutually
    // exclusive.
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('content for left', 'left', 'source A');
    await settle(el);
    expect(el._file).toBe(null);
    expect(el._virtualComparison.leftContent).toBe('content for left');
    expect(el._virtualComparison.rightContent).toBe('');
    expect(el._virtualComparison.leftLabel).toBe('source A');
  });

  it('accumulates both panels in the virtual-comparison slot', async () => {
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('left content', 'left', 'L');
    await settle(el);
    await el.loadPanel('right content', 'right', 'R');
    await settle(el);
    const slot = el._virtualComparison;
    expect(slot.leftContent).toBe('left content');
    expect(slot.rightContent).toBe('right content');
    expect(slot.leftLabel).toBe('L');
    expect(slot.rightLabel).toBe('R');
  });

  it('opening a real file clears the virtual slot', async () => {
    // D18 contract: _file and _virtualComparison are
    // mutually exclusive. Opening a real file must
    // clobber any ad-hoc comparison.
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'repo content'),
    });
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('compare text', 'left', 'reference');
    await settle(el);
    expect(el._virtualComparison).not.toBe(null);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(el._virtualComparison).toBe(null);
    expect(el._file?.path).toBe('src/main.py');
  });

  it('rejects invalid panel arguments', async () => {
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('x', 'middle', 'label');
    await settle(el);
    expect(el.hasOpenFiles).toBe(false);
  });

  it('stores panel label on the virtual slot', async () => {
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('content', 'left', 'history-source');
    await settle(el);
    expect(el._virtualComparison.leftLabel).toBe('history-source');
  });
});

// ---------------------------------------------------------------------------
// Viewport state
// ---------------------------------------------------------------------------

describe('DiffViewer viewport state (no-cache contract)', () => {
  // D18: per-file viewport state is NOT preserved in
  // the single-file model. Every openFile starts at
  // the top; users who accept no-cache accept losing
  // scroll position on switch.
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
    });
  });

  it('no viewport state field exists', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    expect(el._viewportStates).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// refreshOpenFiles
// ---------------------------------------------------------------------------

describe('DiffViewer refreshOpenFiles', () => {
  it('re-fetches all non-virtual open files', async () => {
    let version = 1;
    const rpc = vi.fn(async (path, ref) => {
      return ref === 'HEAD'
        ? `HEAD:${path}:v${version}`
        : `WORK:${path}:v${version}`;
    });
    setFakeRpc({ 'Repo.get_file_content': rpc });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    expect(el._file.original).toContain('v1');
    version = 2;
    await el.refreshOpenFiles();
    await settle(el);
    expect(el._file.original).toContain('v2');
    expect(el._file.modified).toContain('v2');
  });

  it('does not re-fetch virtual files', async () => {
    const rpc = vi.fn(async () => 'x');
    setFakeRpc({ 'Repo.get_file_content': rpc });
    const el = mountViewer();
    await settle(el);
    await el.openFile({
      path: 'virtual://thing',
      virtualContent: 'content',
    });
    await settle(el);
    rpc.mockClear();
    await el.refreshOpenFiles();
    await settle(el);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refreshActiveFile is a no-op when virtual comparison is active', async () => {
    // loadPanel populates _virtualComparison, not _file.
    // refreshActiveFile must recognise this and skip —
    // there's no backing disk state to refetch, and
    // re-entering the fetch path would either fail or
    // clobber the ad-hoc comparison content.
    const rpc = vi.fn(async () => 'should not be called');
    setFakeRpc({ 'Repo.get_file_content': rpc });
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('left side', 'left', 'A');
    await el.loadPanel('right side', 'right', 'B');
    await settle(el);
    expect(el._virtualComparison).not.toBe(null);
    expect(el._file).toBe(null);
    // refreshActiveFile with only a virtual comparison
    // should not hit the RPC and should leave both sides
    // intact.
    await el.refreshActiveFile();
    await settle(el);
    expect(rpc).not.toHaveBeenCalled();
    expect(el._virtualComparison.leftContent).toBe('left side');
    expect(el._virtualComparison.rightContent).toBe('right side');
  });
});

// ---------------------------------------------------------------------------
// relayout — called by app shell on dialog / window resize
// ---------------------------------------------------------------------------

describe('DiffViewer relayout', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
    });
  });

  it('calls editor.layout() when an editor is active', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const editor = monacoState.editors[0];
    editor.layout.mockClear();
    el.relayout();
    expect(editor.layout).toHaveBeenCalledOnce();
  });

  it('is a no-op when no file is open', async () => {
    const el = mountViewer();
    await settle(el);
    // No editor constructed yet — relayout must not
    // throw.
    expect(() => el.relayout()).not.toThrow();
    expect(monacoState.editors.length).toBe(0);
  });

  it('survives Monaco layout throwing', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const editor = monacoState.editors[0];
    editor.layout.mockImplementation(() => {
      throw new Error('detached');
    });
    // Swallowed — a transient layout failure during
    // rapid unmount / remount must not propagate into
    // the RAF loop.
    expect(() => el.relayout()).not.toThrow();
  });

  it('calls layout on the current editor after a file switch', async () => {
    // _swapModel reuses the editor instance. Verify
    // relayout hits the same editor the viewer is
    // currently displaying — no stale references.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    await el.openFile({ path: 'b.py' });
    await settle(el);
    // Single-editor reuse means only one instance
    // exists.
    expect(monacoState.editors.length).toBe(1);
    const editor = monacoState.editors[0];
    editor.layout.mockClear();
    el.relayout();
    expect(editor.layout).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Status LED
// ---------------------------------------------------------------------------

describe('DiffViewer status LED', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'original'),
    });
  });

  it('shows clean when active file has no changes', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const led = el.shadowRoot.querySelector('.status-led');
    expect(led.classList.contains('clean')).toBe(true);
  });

  it('shows dirty after a content change', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('edited');
    await settle(el);
    const led = el.shadowRoot.querySelector('.status-led');
    expect(led.classList.contains('dirty')).toBe(true);
  });

  it('shows new-file for files missing at HEAD', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (_p, ref) => {
        if (ref === 'HEAD') throw new Error('not in HEAD');
        return 'working';
      }),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'new.py' });
    await settle(el);
    const led = el.shadowRoot.querySelector('.status-led');
    expect(led.classList.contains('new-file')).toBe(true);
  });

  it('clicking dirty LED saves the file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('edited');
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    el.shadowRoot.querySelector('.status-led').click();
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('clicking clean LED is a no-op', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    el.shadowRoot.querySelector('.status-led').click();
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

describe('DiffViewer keyboard shortcuts', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
    });
  });

  function fireKey(el, key, opts = {}) {
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

  it('Ctrl+S saves active file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('edited');
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    fireKey(el, 's');
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('Ctrl+W does nothing (shortcut removed in single-file model)', async () => {
    // D18 removed Ctrl+W / Ctrl+PageUp / Ctrl+PageDown
    // because the single-file model has no tab concept.
    // Pin the removal with a regression test so a
    // future refactor can't reintroduce tab cycling by
    // accident.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    fireKey(el, 'w');
    await settle(el);
    expect(el.hasOpenFiles).toBe(true);
    expect(el._file.path).toBe('a.py');
  });

  it('Ctrl+PageDown / Ctrl+PageUp do nothing', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    fireKey(el, 'PageDown');
    fireKey(el, 'PageUp');
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
    expect(el._file.path).toBe('a.py');
  });

  it('keyboard shortcuts without Ctrl do not fire', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    // Plain S — not a save.
    const ev = new KeyboardEvent('keydown', {
      key: 's',
      bubbles: true,
    });
    Object.defineProperty(ev, 'composedPath', {
      value: () => [el],
    });
    el.dispatchEvent(ev);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keyboard shortcuts when focus is outside do not fire', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    // Fire on document body, not through the viewer's
    // composed path.
    const ev = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
    });
    Object.defineProperty(ev, 'composedPath', {
      value: () => [document.body, document],
    });
    document.dispatchEvent(ev);
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Events bubble across shadow DOM
// ---------------------------------------------------------------------------

describe('DiffViewer events cross shadow DOM', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
    });
  });

  it('active-file-changed is composed', async () => {
    const el = mountViewer();
    await settle(el);
    const outerListener = vi.fn();
    document.body.addEventListener(
      'active-file-changed',
      outerListener,
    );
    try {
      await el.openFile({ path: 'a.py' });
      await settle(el);
      expect(outerListener).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener(
        'active-file-changed',
        outerListener,
      );
    }
  });

  it('file-saved is composed', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('edited');
    await settle(el);
    const outerListener = vi.fn();
    document.body.addEventListener('file-saved', outerListener);
    try {
      await el._saveFile('a.py');
      expect(outerListener).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener(
        'file-saved',
        outerListener,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Markdown preview (Phase 3.1b Step 2a)
// ---------------------------------------------------------------------------
//
// These tests cover the preview TOGGLE and live update
// behavior. Step 2b will add scroll sync and KaTeX CSS
// injection; Step 2c will add image resolution and link
// navigation. Each of those gets its own describe block
// when landed.

describe('DiffViewer markdown preview — toggle', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (path, ref) => {
        if (ref === 'HEAD') return '# Original';
        return '# Original';
      }),
    });
  });

  it('shows Preview button for markdown files', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    const btn = el.shadowRoot.querySelector('.preview-button');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Preview');
  });

  it('shows Preview button for .markdown files too', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'docs/spec.markdown' });
    await settle(el);
    const btn = el.shadowRoot.querySelector('.preview-button');
    expect(btn).toBeTruthy();
  });

  it('does not show Preview button for non-markdown files', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    const btn = el.shadowRoot.querySelector('.preview-button');
    expect(btn).toBeNull();
  });

  it('does not show Preview button when no file is open', async () => {
    const el = mountViewer();
    await settle(el);
    const btn = el.shadowRoot.querySelector('.preview-button');
    expect(btn).toBeNull();
  });

  it('clicking Preview enters split layout', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    expect(el.shadowRoot.querySelector('.split-root')).toBeNull();
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    expect(el._previewMode).toBe(true);
    expect(
      el.shadowRoot.querySelector('.split-root'),
    ).toBeTruthy();
    expect(
      el.shadowRoot.querySelector('.editor-pane'),
    ).toBeTruthy();
    expect(
      el.shadowRoot.querySelector('.preview-pane'),
    ).toBeTruthy();
  });

  it('clicking Preview again exits split layout', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    // In preview — button is in split area.
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    expect(el._previewMode).toBe(false);
    expect(el.shadowRoot.querySelector('.split-root')).toBeNull();
    expect(
      el.shadowRoot.querySelector('.preview-pane'),
    ).toBeNull();
  });

  it('entering preview rebuilds the editor with inline diff', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    const editorsBeforeToggle = monacoState.editors.length;
    const firstEditor = monacoState.editors[0];
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    // A new editor was created with renderSideBySide: false.
    expect(monacoState.editors.length).toBe(editorsBeforeToggle + 1);
    expect(firstEditor.dispose).toHaveBeenCalled();
    const latestEditor =
      monacoState.editors[monacoState.editors.length - 1];
    expect(latestEditor._constructionOptions.renderSideBySide).toBe(
      false,
    );
  });

  it('exiting preview rebuilds the editor with side-by-side diff', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    // Exit.
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    const latestEditor =
      monacoState.editors[monacoState.editors.length - 1];
    expect(latestEditor._constructionOptions.renderSideBySide).toBe(
      true,
    );
  });
});

describe('DiffViewer markdown preview — rendering', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (path, ref) => {
        if (ref === 'HEAD') return '# Hello\n\nBody text';
        return '# Hello\n\nBody text';
      }),
    });
  });

  it('populates preview pane on entry', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('<h1');
    expect(pane.innerHTML).toContain('Hello');
    expect(pane.innerHTML).toContain('Body text');
  });

  it('updates preview on content change', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    // Simulate user typing — content changes to a new
    // markdown body.
    const activeEditor =
      monacoState.editors[monacoState.editors.length - 1];
    activeEditor._simulateContentChange(
      '## New heading\n\nnew body',
    );
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('<h2');
    expect(pane.innerHTML).toContain('New heading');
    expect(pane.innerHTML).toContain('new body');
    // Old content is gone.
    expect(pane.innerHTML).not.toContain('Body text');
  });

  it('does not render preview when preview mode is off', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    // Without toggling preview mode.
    const activeEditor = monacoState.editors[0];
    activeEditor._simulateContentChange('# changed');
    await settle(el);
    // No preview pane exists.
    expect(
      el.shadowRoot.querySelector('.preview-pane'),
    ).toBeNull();
  });

  it('preview renders source-line attributes', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toMatch(/data-source-line="\d+"/);
  });
});

describe('DiffViewer markdown preview — mode handoff', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
    });
  });

  it('switching to a non-markdown file exits preview', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    expect(el._previewMode).toBe(true);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(el._previewMode).toBe(false);
    expect(el.shadowRoot.querySelector('.split-root')).toBeNull();
  });

  it('closing a markdown file with preview resets state', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    expect(el._previewMode).toBe(true);
    el.closeFile('README.md');
    await settle(el);
    expect(el._previewMode).toBe(false);
    expect(el.hasOpenFiles).toBe(false);
  });

  it('re-entering preview on a re-opened markdown file works', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    el.closeFile('README.md');
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    // Not in preview yet — state was reset on close.
    expect(el._previewMode).toBe(false);
    // But the Preview button still shows.
    expect(
      el.shadowRoot.querySelector('.preview-button'),
    ).toBeTruthy();
  });

  it('switching from non-markdown to markdown file does not auto-enter preview', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    expect(el._previewMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Markdown preview (Phase 3.1b Step 2b) — scroll sync + KaTeX CSS
// ---------------------------------------------------------------------------

describe('DiffViewer markdown preview — KaTeX CSS injection', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '# Hello'),
    });
  });

  it('injects KaTeX stylesheet into shadow root on preview entry', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    // Not yet — CSS is injected as part of style sync,
    // which happens whenever editor is built or rebuilt.
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    const katexStyle = el.shadowRoot.querySelector(
      '[data-ac-dc-katex-css]',
    );
    expect(katexStyle).toBeTruthy();
    expect(katexStyle.tagName).toBe('STYLE');
  });

  it('does not duplicate the KaTeX stylesheet across toggles', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    const all = el.shadowRoot.querySelectorAll(
      '[data-ac-dc-katex-css]',
    );
    expect(all.length).toBe(1);
  });

  it('KaTeX stylesheet survives style re-sync on file switch', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    // Switch away to non-markdown (exits preview), back
    // to markdown, re-enter preview — stylesheet still
    // present.
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    const katexStyle = el.shadowRoot.querySelector(
      '[data-ac-dc-katex-css]',
    );
    expect(katexStyle).toBeTruthy();
  });
});

describe('DiffViewer markdown preview — scroll sync', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '# A\n\nPara1\n\n# B\n\nPara2\n',
      ),
    });
  });

  async function enterPreview(el) {
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
  }

  /**
   * Stub offsetTop/scrollHeight/clientHeight on
   * preview-pane elements so the anchor collection logic
   * produces stable values. jsdom returns 0 for all
   * layout properties.
   */
  function stubPreviewLayout(el, anchorPositions) {
    const pane = el.shadowRoot.querySelector('.preview-pane');
    // Fake scroll container dimensions.
    Object.defineProperty(pane, 'scrollHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(pane, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    // Replace the pane's innerHTML with anchor divs at
    // known source-line positions, each with a stubbed
    // offsetTop.
    pane.innerHTML = anchorPositions
      .map(
        ({ line }) =>
          `<div data-source-line="${line}">line ${line}</div>`,
      )
      .join('');
    const divs = pane.querySelectorAll('[data-source-line]');
    divs.forEach((div, i) => {
      Object.defineProperty(div, 'offsetTop', {
        configurable: true,
        value: anchorPositions[i].offsetTop,
      });
    });
    return pane;
  }

  it('editor scroll triggers preview scroll', async () => {
    const el = mountViewer();
    await settle(el);
    await enterPreview(el);
    stubPreviewLayout(el, [
      { line: 1, offsetTop: 0 },
      { line: 3, offsetTop: 100 },
      { line: 5, offsetTop: 200 },
    ]);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    // Find the editor that's currently in preview mode
    // (last one created).
    const editor =
      monacoState.editors[monacoState.editors.length - 1];
    // Scroll editor to line 3 (scrollTop = (3-1) * 20 = 40).
    editor._simulateScroll(40);
    await settle(el);
    // Preview should scroll to anchor at line 3.
    expect(pane.scrollTop).toBeGreaterThanOrEqual(90);
    expect(pane.scrollTop).toBeLessThanOrEqual(110);
  });

  it('preview scroll triggers editor scroll', async () => {
    const el = mountViewer();
    await settle(el);
    await enterPreview(el);
    stubPreviewLayout(el, [
      { line: 1, offsetTop: 0 },
      { line: 3, offsetTop: 100 },
      { line: 5, offsetTop: 200 },
    ]);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    const editor =
      monacoState.editors[monacoState.editors.length - 1];
    // Scroll preview to offsetTop 100 (line 3).
    pane.scrollTop = 100;
    pane.dispatchEvent(new Event('scroll'));
    await settle(el);
    // Editor should scroll toward line 3: (3-1) * 20 = 40.
    expect(editor._scrollTop).toBeGreaterThanOrEqual(30);
    expect(editor._scrollTop).toBeLessThanOrEqual(50);
  });

  it('scroll sync mutex prevents feedback loops', async () => {
    // After editor-initiated preview scroll, a follow-up
    // scroll event on the preview pane should NOT cause
    // the editor to scroll again. Without the lock the
    // two sides would ping-pong indefinitely.
    const el = mountViewer();
    await settle(el);
    await enterPreview(el);
    stubPreviewLayout(el, [
      { line: 1, offsetTop: 0 },
      { line: 5, offsetTop: 200 },
    ]);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    const editor =
      monacoState.editors[monacoState.editors.length - 1];
    // Editor initiates scroll.
    editor._simulateScroll(80);
    await settle(el);
    const editorScrollAfterFirst = editor._scrollTop;
    // Preview's scroll handler fires — but the lock
    // prevents it from pushing scroll back.
    pane.dispatchEvent(new Event('scroll'));
    await settle(el);
    // Editor's scroll position is unchanged (lock held).
    expect(editor._scrollTop).toBe(editorScrollAfterFirst);
  });

  it('scroll sync does nothing when preview mode is off', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    // Preview NOT entered.
    const editor = monacoState.editors[0];
    // Scroll listener should not have been attached;
    // simulate scroll is a no-op for sync.
    editor._simulateScroll(100);
    await settle(el);
    // No preview pane to check, so the test verifies
    // that no error is thrown and the editor keeps its
    // scroll value.
    expect(editor._scrollTop).toBe(100);
  });

  it('exiting preview detaches scroll listeners', async () => {
    const el = mountViewer();
    await settle(el);
    await enterPreview(el);
    const editorBeforeExit =
      monacoState.editors[monacoState.editors.length - 1];
    expect(editorBeforeExit._scrollListeners.length).toBe(1);
    // Exit preview.
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    // A new editor was built on toggle — the old one's
    // listener is disposed when we dispose that editor.
    // Check that the new editor has no scroll listener
    // (preview is off).
    const editorAfterExit =
      monacoState.editors[monacoState.editors.length - 1];
    expect(editorAfterExit._scrollListeners.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TeX preview (Phase 3.1c)
// ---------------------------------------------------------------------------

describe('DiffViewer TeX preview — preview button', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '\\section{x}'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': vi.fn(async () => ({
        html: '<h1>X</h1>',
      })),
    });
  });

  it('shows Preview button for .tex files', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    const btn = el.shadowRoot.querySelector('.preview-button');
    expect(btn).toBeTruthy();
  });

  it('shows Preview button for .latex files too', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.latex' });
    await settle(el);
    expect(
      el.shadowRoot.querySelector('.preview-button'),
    ).toBeTruthy();
  });

  it('does not show Preview button for non-previewable files', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(
      el.shadowRoot.querySelector('.preview-button'),
    ).toBeNull();
  });
});

describe('DiffViewer TeX preview — compilation flow', () => {
  it('probes availability on preview entry', async () => {
    const probeFn = vi.fn(async () => ({ available: true }));
    const compileFn = vi.fn(async () => ({ html: '<h1>X</h1>' }));
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '\\section{x}'),
      'Repo.is_tex_preview_available': probeFn,
      'Repo.compile_tex_preview': compileFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    // Wait for probe + compile.
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    expect(probeFn).toHaveBeenCalledOnce();
    expect(compileFn).toHaveBeenCalledOnce();
  });

  it('caches availability across multiple files', async () => {
    const probeFn = vi.fn(async () => ({ available: true }));
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '\\section{x}'),
      'Repo.is_tex_preview_available': probeFn,
      'Repo.compile_tex_preview': vi.fn(async () => ({
        html: '<h1>X</h1>',
      })),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // Switch to another .tex file. Should reuse cached
    // availability result — no new probe call.
    await el.openFile({ path: 'b.tex' });
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    expect(probeFn).toHaveBeenCalledTimes(1);
  });

  it('renders install hint when make4ht is unavailable', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '\\section{x}'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: false,
        install_hint:
          'Install TeX Live from https://www.tug.org/texlive/',
      })),
      'Repo.compile_tex_preview': vi.fn(),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('tex-preview-install-hint');
    expect(pane.innerHTML).toContain('TeX Live');
    // Compile RPC should not have been called.
    expect(
      globalThis.__sharedRpcOverride['Repo.compile_tex_preview'],
    ).not.toHaveBeenCalled();
  });

  it('renders compiled HTML on successful compile', async () => {
    const html = '<h2 class="sectionHead">Intro</h2><p>Body.</p>';
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '\\section{Intro}\n\nBody.'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': vi.fn(async () => ({ html })),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('Intro');
    expect(pane.innerHTML).toContain('Body.');
  });

  it('applies data-source-line attributes from anchors', async () => {
    const html = '<h2 class="sectionHead">Heading</h2><p>Text.</p>';
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '\\section{Heading}\n\nText.',
      ),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': vi.fn(async () => ({ html })),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toMatch(/data-source-line="\d+"/);
  });

  it('renders error block on compile failure', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '\\section{x}'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': vi.fn(async () => ({
        error: 'LaTeX Error: Missing } at line 5',
        log: 'Some log output',
      })),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('tex-preview-error');
    expect(pane.innerHTML).toContain('Missing');
    // Log details rendered.
    expect(pane.innerHTML).toContain('tex-preview-log');
    expect(pane.innerHTML).toContain('Some log output');
  });

  it('escapes HTML in error messages', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': vi.fn(async () => ({
        error: 'Unclosed <tag> in source',
      })),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('Unclosed &lt;tag&gt;');
    expect(pane.innerHTML).not.toContain('Unclosed <tag>');
  });
});

describe('DiffViewer TeX preview — save-triggered compilation', () => {
  it('does not recompile on keystroke (live-update gate)', async () => {
    const compileFn = vi.fn(async () => ({ html: '<h1>X</h1>' }));
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'original'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': compileFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // One compile on preview entry.
    expect(compileFn).toHaveBeenCalledTimes(1);
    // Simulate keystrokes — many content changes.
    const editor =
      monacoState.editors[monacoState.editors.length - 1];
    editor._simulateContentChange('edited 1');
    await settle(el);
    editor._simulateContentChange('edited 2');
    await settle(el);
    editor._simulateContentChange('edited 3');
    await settle(el);
    // Still only the initial compile.
    expect(compileFn).toHaveBeenCalledTimes(1);
  });

  it('recompiles on save', async () => {
    const compileFn = vi.fn(async () => ({ html: '<h1>X</h1>' }));
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'original'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': compileFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // Edit + save.
    const editor =
      monacoState.editors[monacoState.editors.length - 1];
    editor._simulateContentChange('edited');
    await settle(el);
    await el._saveFile('paper.tex');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // Second compile fired.
    expect(compileFn).toHaveBeenCalledTimes(2);
    // Second call has the edited content.
    expect(compileFn.mock.calls[1][0]).toBe('edited');
  });

  it('save on non-TeX file in preview does not call compile', async () => {
    const compileFn = vi.fn(async () => ({ html: '<h1>X</h1>' }));
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'markdown'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': compileFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    await el._saveFile('README.md');
    await new Promise((r) => setTimeout(r, 10));
    expect(compileFn).not.toHaveBeenCalled();
  });
});

describe('DiffViewer TeX preview — file switching', () => {
  it('recompiles on switch-back (no-cache contract)', async () => {
    // D18: no per-file cache means switching back to a
    // previously-open .tex file triggers a fresh
    // compile. Users accepting no-cache accept this
    // tradeoff for .tex too.
    const htmlA = '<h1>File A content</h1>';
    const htmlB = '<h1>File B content</h1>';
    const compileFn = vi.fn(async (content, path) => ({
      html: path === 'a.tex' ? htmlA : htmlB,
    }));
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': compileFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // Switch to b.tex — triggers compile for b.
    await el.openFile({ path: 'b.tex' });
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    let pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('File B content');
    // Switch back to a.tex — the openFile's fresh fetch
    // plus preview mode carrying over triggers a new
    // compile.
    const callsBeforeSwitchBack = compileFn.mock.calls.length;
    await el.openFile({ path: 'a.tex' });
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('File A content');
    // At least one more compile fired for a.tex on
    // switch-back. Not two strict equals because the
    // availability probe is cached so we don't double-
    // count it.
    expect(compileFn.mock.calls.length).toBeGreaterThan(
      callsBeforeSwitchBack,
    );
  });

  it('closing a file clears tex compile state', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': vi.fn(async () => ({
        html: '<h1>X</h1>',
      })),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // State lives on _file.texCompile in the single-
    // file model.
    expect(el._file?.texCompile).toBeTruthy();
    el.closeFile('paper.tex');
    await settle(el);
    expect(el._file).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Markdown preview (Phase 3.1b Step 2c) — image resolution + link nav
// ---------------------------------------------------------------------------

describe('DiffViewer markdown preview — image resolution', () => {
  /**
   * Enter preview mode on a markdown file with a known
   * body. The body param becomes both HEAD and working
   * copy so the diff is clean and the preview pane shows
   * the modified side's content.
   */
  async function enterPreviewWith(el, body, path = 'docs/README.md') {
    // Configure RPC to return the body for the markdown
    // file and image bytes for any relative image path.
    await el.openFile({ path });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
  }

  it('leaves absolute URLs untouched', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => {
        return '![alt](https://example.com/x.png)';
      }),
      'Repo.get_file_base64': vi.fn(),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '');
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    const img = pane.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://example.com/x.png');
    // Never called for absolute URLs.
    expect(
      globalThis.__sharedRpcOverride['Repo.get_file_base64'],
    ).not.toHaveBeenCalled();
  });

  it('leaves data URIs untouched', async () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => `![x](${dataUri})`),
      'Repo.get_file_base64': vi.fn(),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '');
    await settle(el);
    const img = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('img');
    expect(img.getAttribute('src')).toBe(dataUri);
    expect(
      globalThis.__sharedRpcOverride['Repo.get_file_base64'],
    ).not.toHaveBeenCalled();
  });

  it('resolves relative raster images via get_file_base64', async () => {
    const base64Fn = vi.fn(async (path) => ({
      data_uri: `data:image/png;base64,FAKE_${path}`,
    }));
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '![logo](logo.png)'),
      'Repo.get_file_base64': base64Fn,
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'docs/README.md');
    // Give the async resolve a chance to complete.
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // Path resolves against docs/README.md's directory →
    // docs/logo.png.
    expect(base64Fn).toHaveBeenCalledWith('docs/logo.png');
    const img = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('img');
    expect(img.getAttribute('src')).toBe(
      'data:image/png;base64,FAKE_docs/logo.png',
    );
  });

  it('resolves relative SVG images via get_file_content with inline encoding', async () => {
    const svgBody = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (path) => {
        if (path.endsWith('.svg')) return svgBody;
        return '![diagram](diagram.svg)';
      }),
      'Repo.get_file_base64': vi.fn(),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'docs/spec.md');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const img = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('img');
    const src = img.getAttribute('src');
    expect(src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(src.split(',')[1])).toBe(svgBody);
    // get_file_base64 never called for SVGs.
    expect(
      globalThis.__sharedRpcOverride['Repo.get_file_base64'],
    ).not.toHaveBeenCalled();
  });

  it('handles parent-directory references', async () => {
    const base64Fn = vi.fn(async () => 'data:image/png;base64,X');
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '![up](../shared/banner.png)',
      ),
      'Repo.get_file_base64': base64Fn,
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'docs/nested/page.md');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // ../shared/banner.png relative to docs/nested/page.md
    // resolves to docs/shared/banner.png.
    expect(base64Fn).toHaveBeenCalledWith('docs/shared/banner.png');
  });

  it('decodes percent-encoded characters before resolving', async () => {
    // _encodeImagePaths turns spaces into %20 before
    // marked parses. The image resolver must undo that
    // for the real filesystem path.
    const base64Fn = vi.fn(async () => 'data:image/png;base64,X');
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '![space](my file.png)',
      ),
      'Repo.get_file_base64': base64Fn,
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'docs/spec.md');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // Must be called with the space, not %20.
    expect(base64Fn).toHaveBeenCalledWith('docs/my file.png');
  });

  it('marks missing images with alt text and dims them', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (path) => {
        if (path.endsWith('.md')) return '![x](missing.png)';
        throw new Error('not found');
      }),
      'Repo.get_file_base64': vi.fn(async () => {
        throw new Error('file not found');
      }),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'docs/spec.md');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const img = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('img');
    // Failed fetch → alt text indicates the problem.
    expect(img.getAttribute('alt')).toMatch(
      /\[Failed to load: docs\/missing\.png/,
    );
    expect(img.style.opacity).toBe('0.4');
  });

  it('marks empty RPC results as missing', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '![x](empty.png)'),
      'Repo.get_file_base64': vi.fn(async () => ''),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'docs/spec.md');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const img = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('img');
    expect(img.getAttribute('alt')).toMatch(
      /\[Image not found: docs\/empty\.png\]/,
    );
  });

  it('resolves multiple images in parallel', async () => {
    let callCount = 0;
    const base64Fn = vi.fn(async (path) => {
      callCount += 1;
      return `data:image/png;base64,FAKE_${path}`;
    });
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '![a](a.png) ![b](b.png) ![c](c.png)',
      ),
      'Repo.get_file_base64': base64Fn,
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'spec.md');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    expect(callCount).toBe(3);
    const imgs = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelectorAll('img');
    expect(imgs[0].getAttribute('src')).toMatch(/a\.png/);
    expect(imgs[1].getAttribute('src')).toMatch(/b\.png/);
    expect(imgs[2].getAttribute('src')).toMatch(/c\.png/);
  });

  it('discards stale fetches when preview updates mid-flight', async () => {
    // Keystroke 1 kicks off a slow fetch; keystroke 2
    // arrives before it resolves and re-renders. The
    // stale fetch's DOM write should be dropped via the
    // generation counter.
    let resolveFirst;
    const base64Fn = vi.fn((path) => {
      if (path.endsWith('slow.png')) {
        return new Promise((r) => {
          resolveFirst = r;
        });
      }
      return Promise.resolve('data:image/png;base64,FAST');
    });
    // Content-content RPC returns the first body; the
    // editor's modified content will drive the second
    // render via _simulateContentChange.
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '![x](slow.png)'),
      'Repo.get_file_base64': base64Fn,
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'spec.md');
    // Simulate second keystroke — different image now.
    const activeEditor =
      monacoState.editors[monacoState.editors.length - 1];
    activeEditor._simulateContentChange('![y](fast.png)');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // Now resolve the first, slow fetch.
    resolveFirst('data:image/png;base64,SLOW');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // The preview's current img is the fast one and its
    // src should be the fast data URI, not overwritten
    // by the stale slow fetch.
    const img = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('img');
    expect(img.getAttribute('src')).toBe(
      'data:image/png;base64,FAST',
    );
  });
});

describe('DiffViewer markdown preview — link navigation', () => {
  // jsdom logs a "Not implemented: navigation" error on
  // every `.click()` of an anchor with an absolute href.
  // Two tests below deliberately click external links to
  // verify we DON'T preventDefault — the logs are noise.
  // Silence console.error for this block; the test
  // assertions still use defaultPrevented checks so real
  // failures surface as test failures, not log output.
  let _consoleErrorSpy;
  beforeEach(() => {
    _consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
  });
  afterEach(() => {
    _consoleErrorSpy.mockRestore();
  });

  async function enterPreview(el, path = 'docs/README.md') {
    await el.openFile({ path });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
  }

  it('intercepts relative-link clicks and dispatches navigate-file', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '[target](other.md)',
      ),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreview(el, 'docs/README.md');
    // D18: dispatch target is window so the app shell's
    // full navigation pipeline runs (grid registration,
    // collab broadcast, etc). Listening on the element
    // misses the event.
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const anchor = el.shadowRoot
        .querySelector('.preview-pane')
        .querySelector('a');
      expect(anchor).toBeTruthy();
      anchor.click();
      await settle(el);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        path: 'docs/other.md',
      });
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('resolves parent-directory links correctly', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '[up](../top.md)',
      ),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreview(el, 'docs/nested/page.md');
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const anchor = el.shadowRoot
        .querySelector('.preview-pane')
        .querySelector('a');
      anchor.click();
      await settle(el);
      expect(listener.mock.calls[0][0].detail.path).toBe(
        'docs/top.md',
      );
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('strips fragment from link before dispatching', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '[sec](other.md#section-2)',
      ),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreview(el, 'docs/README.md');
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      el.shadowRoot
        .querySelector('.preview-pane')
        .querySelector('a')
        .click();
      await settle(el);
      expect(listener.mock.calls[0][0].detail.path).toBe(
        'docs/other.md',
      );
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('ignores absolute http URLs', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '[go](https://example.com/page)',
      ),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreview(el, 'docs/README.md');
    const listener = vi.fn();
    el.addEventListener('navigate-file', listener);
    const anchor = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('a');
    // Simulate a click — we don't want the default action
    // in the test (no actual navigation), but the handler
    // should not have preventDefault called on it by our
    // code. Verify navigate-file is not dispatched.
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });
    anchor.dispatchEvent(ev);
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
    // preventDefault should not have been called by us.
    expect(ev.defaultPrevented).toBe(false);
  });

  it('ignores fragment-only links', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '[top](#heading)',
      ),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreview(el, 'docs/README.md');
    const listener = vi.fn();
    el.addEventListener('navigate-file', listener);
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });
    el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('a')
      .dispatchEvent(ev);
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('ignores mailto and other scheme URLs', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '[email](mailto:test@example.com)',
      ),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreview(el, 'docs/README.md');
    const listener = vi.fn();
    el.addEventListener('navigate-file', listener);
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });
    el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('a')
      .dispatchEvent(ev);
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
  });

  it('link listener detaches on preview exit', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '[x](other.md)',
      ),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreview(el, 'docs/README.md');
    // Exit preview.
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    // Re-enter preview on a different file — the old
    // pane's listener should have been detached, not
    // carried over.
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const anchor = el.shadowRoot
        .querySelector('.preview-pane')
        .querySelector('a');
      anchor.click();
      await settle(el);
      // Still fires — the new pane has a new listener.
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });
});

// ---------------------------------------------------------------------------
// LSP integration (Phase 3.1d)
// ---------------------------------------------------------------------------

describe('DiffViewer LSP integration', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => ''),
    });
  });

  it('installs all four LSP providers on first editor build', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(monacoState.lspProviders.hover).toHaveLength(1);
    expect(monacoState.lspProviders.definition).toHaveLength(1);
    expect(monacoState.lspProviders.reference).toHaveLength(1);
    expect(monacoState.lspProviders.completion).toHaveLength(1);
  });

  it('uses wildcard selector for all providers', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(monacoState.lspProviders.hover[0].selector).toBe('*');
    expect(monacoState.lspProviders.definition[0].selector).toBe(
      '*',
    );
    expect(monacoState.lspProviders.reference[0].selector).toBe('*');
    expect(monacoState.lspProviders.completion[0].selector).toBe(
      '*',
    );
  });

  it('does not re-register providers on file switch', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    await el.openFile({ path: 'src/other.py' });
    await settle(el);
    // Idempotent — still only one registration per type.
    expect(monacoState.lspProviders.hover).toHaveLength(1);
    expect(monacoState.lspProviders.definition).toHaveLength(1);
    expect(monacoState.lspProviders.reference).toHaveLength(1);
    expect(monacoState.lspProviders.completion).toHaveLength(1);
  });

  it('hover provider dispatches to active file path', async () => {
    const hoverFn = vi.fn().mockResolvedValue({
      contents: 'def main() -> None',
    });
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => ''),
      'LLMService.lsp_get_hover': hoverFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    const provider = monacoState.lspProviders.hover[0].provider;
    const result = await provider.provideHover(
      { uri: { path: '/inmemory/model' } },
      { lineNumber: 10, column: 5 },
    );
    expect(hoverFn).toHaveBeenCalledWith('src/main.py', 10, 5);
    expect(result).toEqual({
      contents: [{ value: 'def main() -> None' }],
    });
  });

  it('hover provider reflects file switches', async () => {
    const hoverFn = vi.fn().mockResolvedValue({
      contents: 'x',
    });
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => ''),
      'LLMService.lsp_get_hover': hoverFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/first.py' });
    await settle(el);
    await el.openFile({ path: 'src/second.py' });
    await settle(el);
    // Same provider instance (registered once), but the
    // callbacks read current state at invocation time.
    const provider = monacoState.lspProviders.hover[0].provider;
    await provider.provideHover(
      { uri: { path: '/inmemory/model' } },
      { lineNumber: 1, column: 1 },
    );
    // Should have used the new active file's path.
    expect(hoverFn).toHaveBeenCalledWith('src/second.py', 1, 1);
  });

  it('hover provider returns null when no RPC available', async () => {
    // No get_file_content or lsp_get_hover in the fake
    // RPC — simulates the hover method simply being
    // absent on the proxy.
    clearFakeRpc();
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    const provider = monacoState.lspProviders.hover[0].provider;
    const result = await provider.provideHover(
      { uri: { path: '/inmemory/model' } },
      { lineNumber: 1, column: 1 },
    );
    // No RPC proxy at all — provider returns null cleanly.
    expect(result).toBe(null);
  });

  it('definition provider builds cross-file location', async () => {
    const defFn = vi.fn().mockResolvedValue({
      file: 'src/other.py',
      range: {
        startLineNumber: 10,
        startColumn: 1,
        endLineNumber: 10,
        endColumn: 8,
      },
    });
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => ''),
      'LLMService.lsp_get_definition': defFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    const provider =
      monacoState.lspProviders.definition[0].provider;
    const result = await provider.provideDefinition(
      { uri: { path: '/inmemory/model' } },
      { lineNumber: 5, column: 12 },
    );
    expect(defFn).toHaveBeenCalledWith('src/main.py', 5, 12);
    expect(result.uri.path).toBe('/src/other.py');
    expect(result.range.startLineNumber).toBe(10);
  });

  it('references provider returns empty for null result', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => ''),
      'LLMService.lsp_get_references': vi.fn(async () => null),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    const provider =
      monacoState.lspProviders.reference[0].provider;
    const result = await provider.provideReferences(
      { uri: { path: '/inmemory/model' } },
      { lineNumber: 1, column: 1 },
    );
    expect(result).toEqual([]);
  });

  it('completion provider returns empty suggestions when no path', async () => {
    const el = mountViewer();
    await settle(el);
    // No file opened — active path is empty.
    // But the provider is registered on first editor
    // build, and editor only builds on openFile. So
    // install providers manually by opening and then
    // closing a file.
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    el.closeFile('src/main.py');
    await settle(el);
    // Now providers exist but active path is empty.
    const provider =
      monacoState.lspProviders.completion[0].provider;
    const result = await provider.provideCompletionItems(
      { uri: { path: '/inmemory/model' }, getWordUntilPosition: () => null },
      { lineNumber: 1, column: 1 },
    );
    expect(result).toEqual({ suggestions: [] });
  });

  it('providers survive viewer disposal and reuse', async () => {
    // Install guard prevents re-registration. After
    // opening then closing files repeatedly, the
    // provider count stays at 1 each.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    el.closeFile('a.py');
    await settle(el);
    await el.openFile({ path: 'b.py' });
    await settle(el);
    el.closeFile('b.py');
    await settle(el);
    await el.openFile({ path: 'c.py' });
    await settle(el);
    expect(monacoState.lspProviders.hover).toHaveLength(1);
    expect(monacoState.lspProviders.definition).toHaveLength(1);
    expect(monacoState.lspProviders.reference).toHaveLength(1);
    expect(monacoState.lspProviders.completion).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Markdown link provider (Phase 3.1e)
// ---------------------------------------------------------------------------

describe('DiffViewer markdown link provider', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => ''),
    });
  });

  it('registers markdown link provider on first editor build', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(monacoState.linkProviders).toHaveLength(1);
    expect(monacoState.linkProviders[0].language).toBe('markdown');
  });

  it('registers link opener on first editor build', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(monacoState.linkOpeners).toHaveLength(1);
  });

  it('does not re-register on file switch', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    expect(monacoState.linkProviders).toHaveLength(1);
    expect(monacoState.linkOpeners).toHaveLength(1);
  });

  it('link opener resolves relative path and dispatches navigate-file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'docs/spec.md' });
    await settle(el);
    // D18: dispatch on window, not the element.
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const opener = monacoState.linkOpeners[0];
      const result = opener.open('ac-navigate:///other.md');
      expect(result).toBe(true);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail.path).toBe('docs/other.md');
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('link opener handles parent-directory references', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'docs/nested/page.md' });
    await settle(el);
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const opener = monacoState.linkOpeners[0];
      opener.open('ac-navigate:///../top.md');
      expect(listener.mock.calls[0][0].detail.path).toBe('docs/top.md');
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('link opener ignores non-ac-navigate URIs', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'docs/spec.md' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('navigate-file', listener);
    const opener = monacoState.linkOpeners[0];
    const result = opener.open('https://example.com');
    expect(result).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('link opener is a no-op when no active file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'docs/spec.md' });
    await settle(el);
    el.closeFile('docs/spec.md');
    await settle(el);
    // No active file now — opener call shouldn't throw.
    const listener = vi.fn();
    el.addEventListener('navigate-file', listener);
    const opener = monacoState.linkOpeners[0];
    // Returns true (claims the URI) but dispatches
    // nothing because there's no active file to
    // resolve against.
    opener.open('ac-navigate:///other.md');
    expect(listener).not.toHaveBeenCalled();
  });

  it('link provider finds links in markdown content', async () => {
    // Call the provider directly with a fake model.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    const provider = monacoState.linkProviders[0].provider;
    const model = {
      getValue: () => 'See [the spec](spec.md) for details.',
    };
    const result = provider.provideLinks(model);
    expect(result.links).toHaveLength(1);
    expect(result.links[0].url).toBe('ac-navigate:///spec.md');
  });

  it('link provider skips absolute URLs', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    const provider = monacoState.linkProviders[0].provider;
    const model = {
      getValue: () =>
        '[external](https://x.com) and [local](local.md)',
    };
    const result = provider.provideLinks(model);
    expect(result.links).toHaveLength(1);
    expect(result.links[0].url).toBe('ac-navigate:///local.md');
  });
});