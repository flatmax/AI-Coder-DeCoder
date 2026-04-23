// Tests for file-search orchestration in files-tab.
//
// Covers:
//   - file-search-changed event builds pruned tree and
//     calls picker.setTree + expandAll
//   - Exit restores full tree and expand state
//   - file-search-scroll updates picker._focusedPath and
//     expands ancestor directories
//   - file-clicked during file search routes to chat panel
//     instead of navigate-file dispatch
//   - buildPrunedTree pure function

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { SharedRpc } from './rpc.js';
import { buildPrunedTree } from './files-tab.js';
import './files-tab.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _mounted = [];

function mountTab(props = {}) {
  const t = document.createElement('ac-files-tab');
  Object.assign(t, props);
  document.body.appendChild(t);
  _mounted.push(t);
  return t;
}

function publishFakeRpc(methods) {
  const proxy = {};
  for (const [name, impl] of Object.entries(methods)) {
    proxy[name] = async (...args) => {
      const value = await impl(...args);
      return { fake: value };
    };
  }
  SharedRpc.set(proxy);
  return proxy;
}

async function settle(tab) {
  await tab.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await tab.updateComplete;
  const picker = tab.shadowRoot?.querySelector('ac-file-picker');
  if (picker) await picker.updateComplete;
  const chat = tab.shadowRoot?.querySelector('ac-chat-panel');
  if (chat) await chat.updateComplete;
}

function fakeTree(children = []) {
  return {
    tree: {
      name: 'repo',
      path: '',
      type: 'dir',
      lines: 0,
      children,
    },
    modified: [],
    staged: [],
    untracked: [],
    deleted: [],
    diff_stats: {},
  };
}

afterEach(() => {
  while (_mounted.length) {
    const t = _mounted.pop();
    if (t.isConnected) t.remove();
  }
  SharedRpc.reset();
});

// ---------------------------------------------------------------------------
// buildPrunedTree
// ---------------------------------------------------------------------------

describe('buildPrunedTree', () => {
  it('empty results produces empty root', () => {
    const tree = buildPrunedTree([]);
    expect(tree.type).toBe('dir');
    expect(tree.path).toBe('');
    expect(tree.children).toEqual([]);
  });

  it('null / non-array input produces empty root', () => {
    expect(buildPrunedTree(null).children).toEqual([]);
    expect(buildPrunedTree(undefined).children).toEqual([]);
    expect(buildPrunedTree('not array').children).toEqual([]);
  });

  it('single flat file produces a file leaf at root', () => {
    const tree = buildPrunedTree([
      { file: 'readme.md', matches: [{ line_num: 1, line: 'x' }] },
    ]);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]).toMatchObject({
      name: 'readme.md',
      path: 'readme.md',
      type: 'file',
      lines: 1, // match count
    });
  });

  it('nested path builds directory structure', () => {
    const tree = buildPrunedTree([
      {
        file: 'src/utils/helpers.py',
        matches: [{ line_num: 5, line: 'x' }],
      },
    ]);
    expect(tree.children).toHaveLength(1);
    const src = tree.children[0];
    expect(src).toMatchObject({
      name: 'src',
      path: 'src',
      type: 'dir',
    });
    expect(src.children).toHaveLength(1);
    const utils = src.children[0];
    expect(utils).toMatchObject({
      name: 'utils',
      path: 'src/utils',
      type: 'dir',
    });
    expect(utils.children).toHaveLength(1);
    expect(utils.children[0]).toMatchObject({
      name: 'helpers.py',
      path: 'src/utils/helpers.py',
      type: 'file',
      lines: 1,
    });
  });

  it('shared directories are deduplicated', () => {
    const tree = buildPrunedTree([
      {
        file: 'src/a.py',
        matches: [{ line_num: 1, line: 'x' }],
      },
      {
        file: 'src/b.py',
        matches: [{ line_num: 2, line: 'y' }],
      },
    ]);
    // Only one 'src' dir.
    expect(tree.children).toHaveLength(1);
    const src = tree.children[0];
    expect(src.name).toBe('src');
    // Both files under it.
    expect(src.children).toHaveLength(2);
  });

  it('lines field is the match count', () => {
    const tree = buildPrunedTree([
      {
        file: 'a.py',
        matches: [
          { line_num: 1, line: 'x' },
          { line_num: 2, line: 'x' },
          { line_num: 3, line: 'x' },
        ],
      },
    ]);
    expect(tree.children[0].lines).toBe(3);
  });

  it('sorts directories before files within each directory', () => {
    const tree = buildPrunedTree([
      {
        file: 'z.md',
        matches: [{ line_num: 1, line: 'x' }],
      },
      {
        file: 'a/deep.py',
        matches: [{ line_num: 1, line: 'x' }],
      },
    ]);
    // Root children: 'a' (dir) then 'z.md' (file).
    expect(tree.children[0].name).toBe('a');
    expect(tree.children[1].name).toBe('z.md');
  });

  it('skips malformed entries', () => {
    const tree = buildPrunedTree([
      null,
      { /* no file field */ matches: [] },
      { file: '', matches: [] },
      { file: 'real.py', matches: [{ line_num: 1, line: 'x' }] },
    ]);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].name).toBe('real.py');
  });
});

// ---------------------------------------------------------------------------
// File-search-changed event handling
// ---------------------------------------------------------------------------

describe('FilesTab file-search-changed handling', () => {
  async function setupTabWithTree() {
    const getTree = vi.fn().mockResolvedValue(
      fakeTree([
        {
          name: 'src',
          path: 'src',
          type: 'dir',
          lines: 0,
          children: [
            {
              name: 'main.py',
              path: 'src/main.py',
              type: 'file',
              lines: 100,
            },
            {
              name: 'utils.py',
              path: 'src/utils.py',
              type: 'file',
              lines: 50,
            },
          ],
        },
        {
          name: 'README.md',
          path: 'README.md',
          type: 'file',
          lines: 25,
        },
      ]),
    );
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    return t;
  }

  it('entering file search swaps to pruned tree', async () => {
    const t = await setupTabWithTree();
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    // Before: full tree — 2 top-level nodes.
    expect(picker.tree.children).toHaveLength(2);
    // Dispatch the event as the chat panel would.
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    chat.dispatchEvent(
      new CustomEvent('file-search-changed', {
        detail: {
          active: true,
          results: [
            {
              file: 'src/main.py',
              matches: [{ line_num: 1, line: 'x' }],
            },
          ],
        },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    // Picker now has the pruned tree — only src/main.py.
    expect(picker.tree.children).toHaveLength(1);
    const src = picker.tree.children[0];
    expect(src.name).toBe('src');
    expect(src.children).toHaveLength(1);
    expect(src.children[0].name).toBe('main.py');
  });

  it('expands all directories on entry', async () => {
    const t = await setupTabWithTree();
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    chat.dispatchEvent(
      new CustomEvent('file-search-changed', {
        detail: {
          active: true,
          results: [
            {
              file: 'src/main.py',
              matches: [{ line_num: 1, line: 'x' }],
            },
          ],
        },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    // `src` is expanded so main.py is reachable without
    // user clicking through.
    expect(picker._expanded.has('src')).toBe(true);
  });

  it('sets _fileSearchActive flag on entry', async () => {
    const t = await setupTabWithTree();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    expect(t._fileSearchActive).toBe(false);
    chat.dispatchEvent(
      new CustomEvent('file-search-changed', {
        detail: { active: true, results: [] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(t._fileSearchActive).toBe(true);
  });

  it('exiting restores full tree', async () => {
    const t = await setupTabWithTree();
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    // Enter, then exit.
    chat.dispatchEvent(
      new CustomEvent('file-search-changed', {
        detail: {
          active: true,
          results: [
            {
              file: 'src/main.py',
              matches: [{ line_num: 1, line: 'x' }],
            },
          ],
        },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    // Now pruned.
    expect(picker.tree.children).toHaveLength(1);
    // Exit.
    chat.dispatchEvent(
      new CustomEvent('file-search-changed', {
        detail: { active: false, results: [] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    // Full tree back — 2 top-level nodes.
    expect(picker.tree.children).toHaveLength(2);
  });

  it('exit restores expanded state', async () => {
    const t = await setupTabWithTree();
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    // User expands src before entering search.
    picker._expanded = new Set(['src']);
    await settle(t);
    // Enter search — snapshots the expanded set.
    chat.dispatchEvent(
      new CustomEvent('file-search-changed', {
        detail: {
          active: true,
          results: [
            {
              file: 'src/main.py',
              matches: [{ line_num: 1, line: 'x' }],
            },
          ],
        },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    // Exit.
    chat.dispatchEvent(
      new CustomEvent('file-search-changed', {
        detail: { active: false, results: [] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    // Expanded state back to user's pre-search state.
    expect(picker._expanded.has('src')).toBe(true);
  });

  it('clears _fileSearchActive flag on exit', async () => {
    const t = await setupTabWithTree();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    chat.dispatchEvent(
      new CustomEvent('file-search-changed', {
        detail: { active: true, results: [] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    chat.dispatchEvent(
      new CustomEvent('file-search-changed', {
        detail: { active: false, results: [] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(t._fileSearchActive).toBe(false);
  });

  it('restores selection state on exit', async () => {
    const t = await setupTabWithTree();
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    // Pre-select a file.
    t._selectedFiles = new Set(['README.md']);
    picker.selectedFiles = new Set(['README.md']);
    await settle(t);
    // Enter and exit search.
    chat.dispatchEvent(
      new CustomEvent('file-search-changed', {
        detail: { active: true, results: [] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    chat.dispatchEvent(
      new CustomEvent('file-search-changed', {
        detail: { active: false, results: [] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    // Selection preserved.
    expect(picker.selectedFiles.has('README.md')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// file-search-scroll handling
// ---------------------------------------------------------------------------

describe('FilesTab file-search-scroll handling', () => {
  it('updates picker._focusedPath', async () => {
    const getTree = vi.fn().mockResolvedValue(fakeTree([]));
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    // Simulate file-search active state.
    t._fileSearchActive = true;
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    chat.dispatchEvent(
      new CustomEvent('file-search-scroll', {
        detail: { filePath: 'src/foo.py' },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(picker._focusedPath).toBe('src/foo.py');
  });

  it('expands ancestor directories of focused file', async () => {
    const getTree = vi.fn().mockResolvedValue(fakeTree([]));
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    t._fileSearchActive = true;
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    picker._expanded = new Set();
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    chat.dispatchEvent(
      new CustomEvent('file-search-scroll', {
        detail: { filePath: 'src/utils/helpers.py' },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    // Both ancestor directories expanded.
    expect(picker._expanded.has('src')).toBe(true);
    expect(picker._expanded.has('src/utils')).toBe(true);
  });

  it('is a no-op when not in file search mode', async () => {
    const getTree = vi.fn().mockResolvedValue(fakeTree([]));
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    // NOT active.
    expect(t._fileSearchActive).toBe(false);
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    chat.dispatchEvent(
      new CustomEvent('file-search-scroll', {
        detail: { filePath: 'src/foo.py' },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    // Unchanged.
    expect(picker._focusedPath).toBeNull();
  });

  it('ignores malformed events', async () => {
    const getTree = vi.fn().mockResolvedValue(fakeTree([]));
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    t._fileSearchActive = true;
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    // Empty string, null, missing — all silently dropped.
    chat.dispatchEvent(
      new CustomEvent('file-search-scroll', {
        detail: { filePath: '' },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(picker._focusedPath).toBeNull();
    chat.dispatchEvent(
      new CustomEvent('file-search-scroll', {
        detail: {},
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(picker._focusedPath).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// File-clicked intercept during file search
// ---------------------------------------------------------------------------

describe('FilesTab file-clicked intercept', () => {
  it('during file search, picker click routes to chat panel', async () => {
    const getTree = vi.fn().mockResolvedValue(
      fakeTree([
        {
          name: 'a.md',
          path: 'a.md',
          type: 'file',
          lines: 1,
        },
      ]),
    );
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    // Simulate file search active.
    t._fileSearchActive = true;
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    // Spy on the chat panel's public method.
    const spy = vi.spyOn(chat, 'scrollFileSearchToFile');
    // Dispatch file-clicked as the picker would.
    const picker = t.shadowRoot.querySelector('ac-file-picker');
    picker.dispatchEvent(
      new CustomEvent('file-clicked', {
        detail: { path: 'a.md' },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(t);
    expect(spy).toHaveBeenCalledWith('a.md');
  });

  it('during file search, no navigate-file event dispatched', async () => {
    const getTree = vi.fn().mockResolvedValue(fakeTree([]));
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    t._fileSearchActive = true;
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('file-clicked', {
          detail: { path: 'a.md' },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('outside file search, picker click DOES dispatch navigate-file', async () => {
    const getTree = vi.fn().mockResolvedValue(fakeTree([]));
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    // NOT active.
    expect(t._fileSearchActive).toBe(false);
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const picker = t.shadowRoot.querySelector('ac-file-picker');
      picker.dispatchEvent(
        new CustomEvent('file-clicked', {
          detail: { path: 'a.md' },
          bubbles: true,
          composed: true,
        }),
      );
      await settle(t);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        path: 'a.md',
      });
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });
});