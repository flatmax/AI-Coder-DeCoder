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
        revealLineInCenter: vi.fn(),
        revealRangeInCenter: vi.fn(),
        deltaDecorations: vi.fn((_old, _new) => []),
        _codeEditorService: null, // patch target
      })),
      onDidUpdateDiff: vi.fn((cb) => {
        editor._updateDiffListeners.push(cb);
        return { dispose: vi.fn() };
      }),
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

vi.mock('monaco-editor/esm/vs/editor/editor.api.js', () => {
  const monaco = {
    editor: {
      createDiffEditor: vi.fn((container) => makeEditor(container)),
      createModel: vi.fn((content, language) =>
        makeModel(content, language),
      ),
      OverviewRulerLane: { Full: 7 },
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
    },
  };
  return { default: monaco, ...monaco };
});

// Reset mock state between tests.
function resetMonacoState() {
  monacoState.editors = [];
  monacoState.models = [];
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
    const file = el._files[0];
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
    const file = el._files[0];
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
    expect(el._files[0].original).toBe('');
    expect(el._files[0].modified).toBe('');
  });

  it('same-file open is a no-op', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
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

  it('concurrent openFile for same path drops the duplicate', async () => {
    // Two rapid calls for the same path — only one model
    // pair should be created.
    const el = mountViewer();
    await settle(el);
    const p1 = el.openFile({ path: 'a.py' });
    const p2 = el.openFile({ path: 'a.py' });
    await Promise.all([p1, p2]);
    await settle(el);
    // 1 file entry, 1 pair of models.
    expect(el._files).toHaveLength(1);
    expect(monacoState.models.length).toBe(2);
  });

  it('concurrent openFile for different paths proceeds independently', async () => {
    const el = mountViewer();
    await settle(el);
    const p1 = el.openFile({ path: 'a.py' });
    const p2 = el.openFile({ path: 'b.py' });
    await Promise.all([p1, p2]);
    await settle(el);
    expect(el._files).toHaveLength(2);
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

  it('closing one of multiple files keeps the editor alive', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    await el.openFile({ path: 'b.py' });
    await settle(el);
    const editor = monacoState.editors[0];
    el.closeFile('b.py');
    await settle(el);
    expect(editor.dispose).not.toHaveBeenCalled();
    expect(el.hasOpenFiles).toBe(true);
  });

  it('closing the active file activates the next', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    await el.openFile({ path: 'b.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('b.py');
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBe('a.py');
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
    expect(el._dirtyCount).toBe(0);
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
    expect(el._dirtyCount).toBe(1);
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

  it('saveAll saves every dirty file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    await el.openFile({ path: 'b.py' });
    await settle(el);
    // Dirty b (active).
    monacoState.editors[0]._simulateContentChange('b-edited');
    await settle(el);
    // Swap to a, dirty it.
    await el.openFile({ path: 'a.py' });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('a-edited');
    await settle(el);
    expect(el.getDirtyFiles().sort()).toEqual(['a.py', 'b.py']);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    await el.saveAll();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(el.getDirtyFiles()).toEqual([]);
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
    expect(el._files[0].modified).toBe('hello world');
    expect(el._files[0].isVirtual).toBe(true);
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

  it('closing a virtual file removes it from the content map', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({
      path: 'virtual://thing',
      virtualContent: 'x',
    });
    await settle(el);
    expect(el._virtualContents.has('virtual://thing')).toBe(true);
    el.closeFile('virtual://thing');
    await settle(el);
    expect(el._virtualContents.has('virtual://thing')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadPanel — ad-hoc comparison
// ---------------------------------------------------------------------------

describe('DiffViewer loadPanel', () => {
  it('creates a virtual://compare file when no files are open', async () => {
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('content for left', 'left', 'source A');
    await settle(el);
    expect(el._files[0].path).toBe('virtual://compare');
    expect(el._files[0].original).toBe('content for left');
    expect(el._files[0].modified).toBe('');
  });

  it('accumulates both panels in a virtual://compare', async () => {
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('left content', 'left', 'L');
    await settle(el);
    await el.loadPanel('right content', 'right', 'R');
    await settle(el);
    const file = el._files[0];
    expect(file.path).toBe('virtual://compare');
    expect(file.original).toBe('left content');
    expect(file.modified).toBe('right content');
  });

  it('updates a real file\'s panel when one is active', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'repo content'),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    await el.loadPanel('compare text', 'left', 'reference');
    await settle(el);
    expect(el._files[0].original).toBe('compare text');
    // Non-target panel preserved.
    expect(el._files[0].modified).toBe('repo content');
  });

  it('rejects invalid panel arguments', async () => {
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('x', 'middle', 'label');
    await settle(el);
    expect(el.hasOpenFiles).toBe(false);
  });

  it('stores panel label for later render', async () => {
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('content', 'left', 'history-source');
    await settle(el);
    const labels = el._panelLabels.get('virtual://compare');
    expect(labels.left).toBe('history-source');
  });
});

// ---------------------------------------------------------------------------
// Viewport state
// ---------------------------------------------------------------------------

describe('DiffViewer viewport state', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
    });
  });

  it('captures scroll position when switching away from a file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    // Simulate the user scrolling.
    const editor = monacoState.editors[0];
    editor._scrollTop = 400;
    editor._position = { lineNumber: 20, column: 5 };
    await el.openFile({ path: 'b.py' });
    await settle(el);
    const saved = el._viewportStates.get('a.py');
    expect(saved).toBeDefined();
    expect(saved.scrollTop).toBe(400);
    expect(saved.lineNumber).toBe(20);
    expect(saved.column).toBe(5);
  });

  it('viewport state is session-only (cleared on close)', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const editor = monacoState.editors[0];
    editor._scrollTop = 100;
    await el.openFile({ path: 'b.py' });
    await settle(el);
    expect(el._viewportStates.has('a.py')).toBe(true);
    el.closeFile('a.py');
    await settle(el);
    expect(el._viewportStates.has('a.py')).toBe(false);
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
    expect(el._files[0].original).toContain('v1');
    version = 2;
    await el.refreshOpenFiles();
    await settle(el);
    expect(el._files[0].original).toContain('v2');
    expect(el._files[0].modified).toContain('v2');
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

  it('Ctrl+W closes active file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    fireKey(el, 'w');
    await settle(el);
    expect(el.hasOpenFiles).toBe(false);
  });

  it('Ctrl+PageDown cycles to next file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    await el.openFile({ path: 'b.py' });
    await settle(el);
    // b is active.
    fireKey(el, 'PageDown');
    await settle(el);
    // Cycled back to a (0 → 1 → 0 with wrap).
    expect(el._files[el._activeIndex].path).toBe('a.py');
  });

  it('Ctrl+PageUp cycles to previous file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    await el.openFile({ path: 'b.py' });
    await settle(el);
    // b is active.
    fireKey(el, 'PageUp');
    await settle(el);
    // Cycled to a.
    expect(el._files[el._activeIndex].path).toBe('a.py');
  });

  it('Ctrl+PageDown no-op with single file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    fireKey(el, 'PageDown');
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
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