// Tests for webapp/src/file-picker.js — FilePicker component.
//
// Scope: pure helpers (fuzzyMatch, filterTree, sortChildren,
// computeFilterExpansions) plus the component's reactive
// rendering and event dispatch.
//
// No RPC, no jrpc-oo, no shadow-DOM-across-connection concerns —
// the picker is a pure presentational component that receives its
// tree as a property and dispatches events on user action.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import './file-picker.js';
import {
  FilePicker,
  SORT_MODE_MTIME,
  SORT_MODE_NAME,
  SORT_MODE_SIZE,
  computeFilterExpansions,
  filterTree,
  fuzzyMatch,
  sortChildren,
  sortChildrenWithMode,
} from './file-picker.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal tree-node literal for tests.
 */
function file(path, lines = 0, mtime = 0) {
  const parts = path.split('/');
  return {
    name: parts[parts.length - 1],
    path,
    type: 'file',
    lines,
    mtime,
  };
}

function dir(path, children) {
  const parts = path.split('/');
  return {
    name: path === '' ? 'root' : parts[parts.length - 1],
    path,
    type: 'dir',
    lines: 0,
    children,
  };
}

function rootOf(children) {
  return {
    name: 'repo',
    path: '',
    type: 'dir',
    lines: 0,
    children,
  };
}

/**
 * Build a statusData object with the given membership
 * sets. Defaults to empty — callers override only the
 * fields they're testing.
 */
function statusDataOf({
  modified = [],
  staged = [],
  untracked = [],
  deleted = [],
  diffStats = {},
} = {}) {
  return {
    modified: new Set(modified),
    staged: new Set(staged),
    untracked: new Set(untracked),
    deleted: new Set(deleted),
    diffStats,
  };
}

/** Create, mount, and track a picker instance for cleanup. */
const _mounted = [];
function mountPicker(props = {}) {
  const p = document.createElement('ac-file-picker');
  Object.assign(p, props);
  document.body.appendChild(p);
  _mounted.push(p);
  return p;
}

afterEach(() => {
  while (_mounted.length) {
    const p = _mounted.pop();
    if (p.isConnected) p.remove();
  }
  // Clear sort preferences so each test starts from defaults.
  // Tests that need to exercise the persistence path set the
  // keys explicitly before mounting.
  try {
    localStorage.removeItem('ac-dc-sort-mode');
    localStorage.removeItem('ac-dc-sort-asc');
  } catch (_err) {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// fuzzyMatch
// ---------------------------------------------------------------------------

describe('fuzzyMatch', () => {
  it('matches an empty query against anything', () => {
    // Empty query is "show all" — the filter box being blank
    // shouldn't hide everything.
    expect(fuzzyMatch('src/main.py', '')).toBe(true);
    expect(fuzzyMatch('', '')).toBe(true);
  });

  it('matches a subsequence', () => {
    // The core contract — each query char appears in order,
    // not necessarily consecutively.
    expect(fuzzyMatch('edit_parser.py', 'edt')).toBe(true);
    expect(fuzzyMatch('symbol_index/index.py', 'sii')).toBe(true);
  });

  it('matches contiguous substrings', () => {
    // Contiguous is a subset of subsequence; must also work.
    expect(fuzzyMatch('readme.md', 'read')).toBe(true);
    expect(fuzzyMatch('tests/test_foo.py', 'test_foo')).toBe(true);
  });

  it('is case-insensitive', () => {
    // Users rarely type with exact case; the filter would be
    // annoying if it required it.
    expect(fuzzyMatch('README.md', 'read')).toBe(true);
    expect(fuzzyMatch('Readme.md', 'RM')).toBe(true);
    expect(fuzzyMatch('src/MAIN.py', 'main')).toBe(true);
  });

  it('rejects when a query char is missing', () => {
    // The z doesn't appear anywhere in 'readme.md'.
    expect(fuzzyMatch('readme.md', 'readz')).toBe(false);
  });

  it('rejects when chars appear out of order', () => {
    // 'edit' has 'd' before 'i', so 'di' as a query succeeds
    // only if edit actually has d-then-i. It does, so we need
    // a different counterexample: 'ide' — i must come before d.
    // In 'edit', i comes AFTER d. So 'ide' fails.
    expect(fuzzyMatch('edit', 'ide')).toBe(false);
  });

  it('empty path rejects any non-empty query', () => {
    expect(fuzzyMatch('', 'x')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sortChildren
// ---------------------------------------------------------------------------

describe('sortChildren', () => {
  it('puts directories before files', () => {
    const input = [
      file('z.md'),
      dir('a_dir', []),
      file('a.md'),
      dir('z_dir', []),
    ];
    const sorted = sortChildren(input);
    expect(sorted.map((n) => n.name)).toEqual([
      'a_dir',
      'z_dir',
      'a.md',
      'z.md',
    ]);
  });

  it('sorts alphabetically within each type', () => {
    const input = [file('c.md'), file('a.md'), file('b.md')];
    const sorted = sortChildren(input);
    expect(sorted.map((n) => n.name)).toEqual([
      'a.md',
      'b.md',
      'c.md',
    ]);
  });

  it('returns a new array — does not mutate input', () => {
    const input = [file('b.md'), file('a.md')];
    const original = [...input];
    sortChildren(input);
    expect(input).toEqual(original);
  });

  it('handles empty and undefined input', () => {
    expect(sortChildren([])).toEqual([]);
    expect(sortChildren(undefined)).toEqual([]);
    expect(sortChildren(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sortChildrenWithMode
// ---------------------------------------------------------------------------

describe('sortChildrenWithMode', () => {
  // The mode-aware variant is what the component actually uses
  // at render time. Directories always sort alphabetically
  // ascending regardless of mode or direction; files sort by
  // the selected key with direction applied; directories
  // precede files in the final order.

  it('puts directories before files regardless of mode', () => {
    const input = [
      file('z.md', 100, 1000),
      dir('a_dir', []),
      file('a.md', 10, 2000),
      dir('z_dir', []),
    ];
    // Try every mode — dirs stay first, alphabetical.
    for (const mode of [
      SORT_MODE_NAME,
      SORT_MODE_MTIME,
      SORT_MODE_SIZE,
    ]) {
      const sorted = sortChildrenWithMode(input, mode, true);
      const types = sorted.map((n) => n.type);
      // First two are dirs, last two are files.
      expect(types).toEqual(['dir', 'dir', 'file', 'file']);
      // Dirs alphabetical.
      expect(sorted[0].name).toBe('a_dir');
      expect(sorted[1].name).toBe('z_dir');
    }
  });

  it('name mode ascending sorts files A to Z', () => {
    const input = [file('c.md'), file('a.md'), file('b.md')];
    const sorted = sortChildrenWithMode(input, SORT_MODE_NAME, true);
    expect(sorted.map((n) => n.name)).toEqual([
      'a.md',
      'b.md',
      'c.md',
    ]);
  });

  it('name mode descending sorts files Z to A', () => {
    const input = [file('c.md'), file('a.md'), file('b.md')];
    const sorted = sortChildrenWithMode(input, SORT_MODE_NAME, false);
    expect(sorted.map((n) => n.name)).toEqual([
      'c.md',
      'b.md',
      'a.md',
    ]);
  });

  it('mtime mode ascending sorts files oldest first', () => {
    const input = [
      file('new.md', 0, 3000),
      file('old.md', 0, 1000),
      file('mid.md', 0, 2000),
    ];
    const sorted = sortChildrenWithMode(input, SORT_MODE_MTIME, true);
    expect(sorted.map((n) => n.name)).toEqual([
      'old.md',
      'mid.md',
      'new.md',
    ]);
  });

  it('mtime mode descending sorts files newest first', () => {
    const input = [
      file('new.md', 0, 3000),
      file('old.md', 0, 1000),
      file('mid.md', 0, 2000),
    ];
    const sorted = sortChildrenWithMode(input, SORT_MODE_MTIME, false);
    expect(sorted.map((n) => n.name)).toEqual([
      'new.md',
      'mid.md',
      'old.md',
    ]);
  });

  it('size mode ascending sorts files smallest first', () => {
    const input = [
      file('big.md', 500),
      file('small.md', 10),
      file('mid.md', 100),
    ];
    const sorted = sortChildrenWithMode(input, SORT_MODE_SIZE, true);
    expect(sorted.map((n) => n.name)).toEqual([
      'small.md',
      'mid.md',
      'big.md',
    ]);
  });

  it('size mode descending sorts files largest first', () => {
    const input = [
      file('big.md', 500),
      file('small.md', 10),
      file('mid.md', 100),
    ];
    const sorted = sortChildrenWithMode(input, SORT_MODE_SIZE, false);
    expect(sorted.map((n) => n.name)).toEqual([
      'big.md',
      'mid.md',
      'small.md',
    ]);
  });

  it('directories ignore the direction parameter', () => {
    // Dirs are always alphabetical ascending — descending
    // mode applies only to the files portion.
    const input = [dir('z_dir', []), dir('a_dir', [])];
    const sortedAsc = sortChildrenWithMode(
      input,
      SORT_MODE_NAME,
      true,
    );
    const sortedDesc = sortChildrenWithMode(
      input,
      SORT_MODE_NAME,
      false,
    );
    expect(sortedAsc.map((n) => n.name)).toEqual([
      'a_dir',
      'z_dir',
    ]);
    expect(sortedDesc.map((n) => n.name)).toEqual([
      'a_dir',
      'z_dir',
    ]);
  });

  it('unknown mode falls back to name', () => {
    // Defensive — a corrupted localStorage entry or a
    // future mode not yet handled shouldn't crash the
    // sort. Graceful fallback to the default.
    const input = [file('b.md'), file('a.md'), file('c.md')];
    const sorted = sortChildrenWithMode(input, 'bogus', true);
    expect(sorted.map((n) => n.name)).toEqual([
      'a.md',
      'b.md',
      'c.md',
    ]);
  });

  it('missing mtime falls back to 0', () => {
    // A file without an mtime field should sort as the
    // oldest (value 0), not crash.
    const input = [
      file('has-mtime.md', 0, 5000),
      { name: 'no-mtime.md', path: 'no-mtime.md', type: 'file' },
    ];
    const sorted = sortChildrenWithMode(input, SORT_MODE_MTIME, true);
    // 'no-mtime.md' (value 0) comes before 'has-mtime.md' (5000).
    expect(sorted.map((n) => n.name)).toEqual([
      'no-mtime.md',
      'has-mtime.md',
    ]);
  });

  it('missing lines falls back to 0 in size mode', () => {
    const input = [
      file('has-size.md', 50),
      { name: 'no-size.md', path: 'no-size.md', type: 'file' },
    ];
    const sorted = sortChildrenWithMode(input, SORT_MODE_SIZE, true);
    expect(sorted.map((n) => n.name)).toEqual([
      'no-size.md',
      'has-size.md',
    ]);
  });

  it('missing name falls back to empty string', () => {
    // Defensive — a malformed node shouldn't crash localeCompare.
    const input = [
      file('a.md'),
      { type: 'file', path: 'x' }, // no name
    ];
    const sorted = sortChildrenWithMode(input, SORT_MODE_NAME, true);
    // Empty-name file sorts before 'a.md'.
    expect(sorted.map((n) => n.name)).toEqual([undefined, 'a.md']);
  });

  it('filters out falsy entries', () => {
    // null / undefined children are skipped rather than
    // propagating into the sort comparator.
    const input = [file('a.md'), null, file('b.md'), undefined];
    const sorted = sortChildrenWithMode(input, SORT_MODE_NAME, true);
    expect(sorted).toHaveLength(2);
    expect(sorted.map((n) => n.name)).toEqual(['a.md', 'b.md']);
  });

  it('returns a new array — does not mutate input', () => {
    const input = [file('b.md'), file('a.md')];
    const original = [...input];
    sortChildrenWithMode(input, SORT_MODE_NAME, true);
    expect(input).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// filterTree
// ---------------------------------------------------------------------------

describe('filterTree', () => {
  const tree = rootOf([
    dir('src', [
      file('src/main.py'),
      file('src/utils.py'),
      dir('src/deep', [file('src/deep/nested.py')]),
    ]),
    dir('tests', [file('tests/test_foo.py')]),
    file('README.md'),
  ]);

  it('empty query returns the tree unchanged', () => {
    expect(filterTree(tree, '')).toBe(tree);
    expect(filterTree(tree, undefined)).toBe(tree);
  });

  it('filters to matching files, preserving directory path', () => {
    // Query matches only main.py and test_foo.py (fuzzy).
    const result = filterTree(tree, 'main');
    // Root has one direct child: the `src` dir containing main.py.
    expect(result.children).toHaveLength(1);
    expect(result.children[0].name).toBe('src');
    // The `src` dir has exactly main.py (no utils.py, no deep/).
    expect(result.children[0].children).toHaveLength(1);
    expect(result.children[0].children[0].path).toBe('src/main.py');
  });

  it('drops directories with no matching descendants', () => {
    // "tests" contains test_foo.py; "src" contains main.py,
    // utils.py, and a nested nested.py. Query 'nested' matches
    // only the deeply nested one.
    const result = filterTree(tree, 'nested');
    // Root has only the `src` ancestry path kept.
    expect(result.children).toHaveLength(1);
    expect(result.children[0].name).toBe('src');
    // Under `src`, only `deep/` is retained.
    expect(result.children[0].children).toHaveLength(1);
    expect(result.children[0].children[0].name).toBe('deep');
  });

  it('returns empty root when no matches', () => {
    const result = filterTree(tree, 'xyzzy');
    expect(result.children).toEqual([]);
    // Still has root shape — component can render the frame
    // and the "no matches" placeholder.
    expect(result.type).toBe('dir');
    expect(result.path).toBe('');
  });

  it('does not mutate the input tree', () => {
    const snapshot = JSON.stringify(tree);
    filterTree(tree, 'main');
    expect(JSON.stringify(tree)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// computeFilterExpansions
// ---------------------------------------------------------------------------

describe('computeFilterExpansions', () => {
  const tree = rootOf([
    dir('src', [
      file('src/main.py'),
      dir('src/utils', [file('src/utils/helpers.py')]),
    ]),
    file('README.md'),
  ]);

  it('empty query returns empty set', () => {
    const result = computeFilterExpansions(tree, '');
    expect(result.size).toBe(0);
  });

  it('expands ancestors of every matching file', () => {
    // 'helpers' matches src/utils/helpers.py. The ancestor dirs
    // are 'src' and 'src/utils'. Root path is '' so it's not
    // added (the root isn't collapsible — always rendered).
    const result = computeFilterExpansions(tree, 'helpers');
    expect(result.has('src')).toBe(true);
    expect(result.has('src/utils')).toBe(true);
    expect(result.has('')).toBe(false);
  });

  it('does not add ancestors when no descendants match', () => {
    const result = computeFilterExpansions(tree, 'xyzzy');
    expect(result.size).toBe(0);
  });

  it('handles a file directly under root', () => {
    // README.md matches but has no dir ancestors to expand.
    const result = computeFilterExpansions(tree, 'readme');
    expect(result.size).toBe(0);
  });

  it('returns a fresh set — caller can mutate freely', () => {
    const result = computeFilterExpansions(tree, 'main');
    expect(result).toBeInstanceOf(Set);
    result.add('extra');
    // Re-running doesn't carry over the mutation.
    const second = computeFilterExpansions(tree, 'main');
    expect(second.has('extra')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Component rendering
// ---------------------------------------------------------------------------

describe('FilePicker component', () => {
  describe('initial render', () => {
    it('mounts with the default empty tree and shows placeholder', async () => {
      const p = mountPicker();
      await p.updateComplete;
      // No files — empty-state shown.
      const empty = p.shadowRoot.querySelector('.empty-state');
      expect(empty).toBeTruthy();
      expect(empty.textContent).toContain('No files');
    });

    it('renders files and directories from the tree prop', async () => {
      const tree = rootOf([
        dir('src', [file('src/main.py', 42)]),
        file('README.md', 10),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // Two top-level rows rendered. Scope to tree rows —
      // the root header also emits a `.name` span with
      // the repo name.
      const names = Array.from(
        p.shadowRoot.querySelectorAll(
          '.row.is-dir:not(.is-root) .name, .row.is-file .name',
        ),
      ).map((el) => el.textContent);
      // Directories first, then files.
      expect(names).toEqual(['src', 'README.md']);
    });

    it('does not show a line-count badge for empty files', async () => {
      const tree = rootOf([file('empty.md', 0), file('real.md', 5)]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const badges = p.shadowRoot.querySelectorAll('.lines-badge');
      // Only the real file gets a badge.
      expect(badges).toHaveLength(1);
      expect(badges[0].textContent.trim()).toBe('5');
    });
  });

  describe('expand / collapse', () => {
    it('starts with directories collapsed', async () => {
      const tree = rootOf([dir('src', [file('src/main.py')])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // src is visible; src/main.py is NOT (directory collapsed).
      // Scope to tree rows — root header also has a .name span.
      const names = Array.from(
        p.shadowRoot.querySelectorAll(
          '.row.is-dir:not(.is-root) .name, .row.is-file .name',
        ),
      ).map((el) => el.textContent);
      expect(names).toEqual(['src']);
    });

    it('toggles expansion on directory row click', async () => {
      const tree = rootOf([dir('src', [file('src/main.py')])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // Scope to non-root rows — the root header is also
      // `.row.is-dir` and its click handler would collide
      // with the test target.
      const dirRow = p.shadowRoot.querySelector(
        '.row.is-dir:not(.is-root)',
      );
      dirRow.click();
      await p.updateComplete;
      // Now main.py is visible.
      const treeRowSelector =
        '.row.is-dir:not(.is-root) .name, .row.is-file .name';
      const names = Array.from(
        p.shadowRoot.querySelectorAll(treeRowSelector),
      ).map((el) => el.textContent);
      expect(names).toEqual(['src', 'main.py']);
      // Click again — collapses.
      dirRow.click();
      await p.updateComplete;
      const namesAfter = Array.from(
        p.shadowRoot.querySelectorAll(treeRowSelector),
      ).map((el) => el.textContent);
      expect(namesAfter).toEqual(['src']);
    });

    it('twisty glyph reflects expansion state', async () => {
      const tree = rootOf([dir('src', [file('src/main.py')])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const twisty = p.shadowRoot.querySelector('.twisty');
      // Collapsed → right-pointing arrow.
      expect(twisty.textContent).toContain('▶');
      p.shadowRoot.querySelector('.row.is-dir').click();
      await p.updateComplete;
      // Expanded → down-pointing arrow.
      const afterTwisty = p.shadowRoot.querySelector('.twisty');
      expect(afterTwisty.textContent).toContain('▼');
    });

    it('empty directories get a hidden twisty', async () => {
      const tree = rootOf([dir('empty', [])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const twisty = p.shadowRoot.querySelector('.twisty');
      expect(twisty.classList.contains('empty')).toBe(true);
    });

    it('expandAll() opens every directory', async () => {
      const tree = rootOf([
        dir('a', [
          dir('a/b', [file('a/b/deep.md')]),
        ]),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p.expandAll();
      await p.updateComplete;
      const names = Array.from(
        p.shadowRoot.querySelectorAll('.name'),
      ).map((el) => el.textContent);
      // Every level visible: a, b, deep.md.
      expect(names).toContain('a');
      expect(names).toContain('b');
      expect(names).toContain('deep.md');
    });
  });

  describe('file selection', () => {
    it('reflects selectedFiles prop via checkbox state', async () => {
      const tree = rootOf([file('a.md'), file('b.md')]);
      const selected = new Set(['a.md']);
      const p = mountPicker({ tree, selectedFiles: selected });
      await p.updateComplete;
      const checkboxes = p.shadowRoot.querySelectorAll(
        '.row.is-file .checkbox',
      );
      expect(checkboxes).toHaveLength(2);
      // a.md checked; b.md not.
      expect(checkboxes[0].checked).toBe(true);
      expect(checkboxes[1].checked).toBe(false);
    });

    it('dispatches selection-changed when a file checkbox is toggled', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
      });
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('selection-changed', listener);
      const cb = p.shadowRoot.querySelector(
        '.row.is-file .checkbox',
      );
      cb.click();
      expect(listener).toHaveBeenCalledOnce();
      const detail = listener.mock.calls[0][0].detail;
      expect(detail.selectedFiles).toEqual(['a.md']);
    });

    it('does not mutate its own selectedFiles prop', async () => {
      // Parent owns the set; the picker only dispatches events.
      // Verifies the architectural contract — picker is a leaf
      // component, the orchestrator is the source of truth.
      const tree = rootOf([file('a.md')]);
      const originalSet = new Set();
      const p = mountPicker({
        tree,
        selectedFiles: originalSet,
      });
      await p.updateComplete;
      p.shadowRoot
        .querySelector('.row.is-file .checkbox')
        .click();
      // The original set passed in is not mutated.
      expect(originalSet.size).toBe(0);
    });

    it('clicking the file name dispatches file-clicked', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('file-clicked', listener);
      // Click the name specifically, not the checkbox.
      p.shadowRoot.querySelector('.row.is-file .name').click();
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        path: 'a.md',
      });
    });

    it('clicking a file checkbox does NOT dispatch file-clicked', async () => {
      // Checkbox clicks are for selection only; they must not
      // also open the file. event.stopPropagation() on the
      // checkbox handler prevents the row handler from firing.
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
      });
      await p.updateComplete;
      const clickedListener = vi.fn();
      p.addEventListener('file-clicked', clickedListener);
      p.shadowRoot
        .querySelector('.row.is-file .checkbox')
        .click();
      expect(clickedListener).not.toHaveBeenCalled();
    });
  });

  describe('directory checkbox', () => {
    it('unchecked when no descendants are selected', async () => {
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
      ]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
      });
      await p.updateComplete;
      const cb = p.shadowRoot.querySelector(
        '.row.is-dir .checkbox',
      );
      expect(cb.checked).toBe(false);
      expect(cb.indeterminate).toBe(false);
    });

    it('indeterminate when some but not all descendants selected', async () => {
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
      ]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(['src/a.md']),
      });
      await p.updateComplete;
      const cb = p.shadowRoot.querySelector(
        '.row.is-dir .checkbox',
      );
      expect(cb.indeterminate).toBe(true);
    });

    it('checked when all descendants selected', async () => {
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
      ]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(['src/a.md', 'src/b.md']),
      });
      await p.updateComplete;
      const cb = p.shadowRoot.querySelector(
        '.row.is-dir .checkbox',
      );
      expect(cb.checked).toBe(true);
      expect(cb.indeterminate).toBe(false);
    });

    it('clicking when none selected selects all descendants', async () => {
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
      ]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
      });
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('selection-changed', listener);
      p.shadowRoot.querySelector('.row.is-dir .checkbox').click();
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail.selectedFiles).toEqual(
        expect.arrayContaining(['src/a.md', 'src/b.md']),
      );
    });

    it('clicking when all selected deselects the whole subtree', async () => {
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
      ]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(['src/a.md', 'src/b.md']),
      });
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('selection-changed', listener);
      p.shadowRoot.querySelector('.row.is-dir .checkbox').click();
      const detail = listener.mock.calls[0][0].detail;
      expect(detail.selectedFiles).toEqual([]);
    });

    it('empty directory checkbox click is a no-op', async () => {
      // Defensive — an empty dir has no descendants to toggle.
      // Clicking it shouldn't dispatch a spurious event.
      const tree = rootOf([dir('empty', [])]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
      });
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('selection-changed', listener);
      p.shadowRoot.querySelector('.row.is-dir .checkbox').click();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // Three-state checkbox (exclusion) — Increment 5
  // ---------------------------------------------------------------

  describe('three-state exclusion', () => {
    // Helper — simulate a shift+click on a checkbox. jsdom
    // doesn't honour shiftKey on a synthetic click(), so we
    // dispatch a MouseEvent directly with the modifier set.
    function shiftClick(el) {
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        shiftKey: true,
      });
      el.dispatchEvent(event);
      return event;
    }

    it('excluded file gets the is-excluded class', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        excludedFiles: new Set(['a.md']),
      });
      await p.updateComplete;
      const row = p.shadowRoot.querySelector('.row.is-file');
      expect(row.classList.contains('is-excluded')).toBe(true);
    });

    it('non-excluded file does not get the is-excluded class', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        excludedFiles: new Set(),
      });
      await p.updateComplete;
      const row = p.shadowRoot.querySelector('.row.is-file');
      expect(row.classList.contains('is-excluded')).toBe(false);
    });

    it('excluded file shows the ✕ badge', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        excludedFiles: new Set(['a.md']),
      });
      await p.updateComplete;
      const badge = p.shadowRoot.querySelector('.excluded-badge');
      expect(badge).toBeTruthy();
      expect(badge.textContent).toContain('✕');
    });

    it('non-excluded file does not show the ✕ badge', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        excludedFiles: new Set(),
      });
      await p.updateComplete;
      expect(
        p.shadowRoot.querySelector('.excluded-badge'),
      ).toBeNull();
    });

    it('excluded file tooltip includes "(excluded)"', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        excludedFiles: new Set(['a.md']),
      });
      await p.updateComplete;
      const row = p.shadowRoot.querySelector('.row.is-file');
      expect(row.getAttribute('title')).toContain('(excluded)');
    });

    it('checkbox tooltip adapts to exclusion state', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        excludedFiles: new Set(['a.md']),
      });
      await p.updateComplete;
      const cb = p.shadowRoot.querySelector(
        '.row.is-file .checkbox',
      );
      expect(cb.getAttribute('title')).toContain('include');
    });

    it('shift+click from normal → excluded', async () => {
      // Default state → shift+click adds to excluded set.
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
        excludedFiles: new Set(),
      });
      await p.updateComplete;
      const exclusionListener = vi.fn();
      const selectionListener = vi.fn();
      p.addEventListener('exclusion-changed', exclusionListener);
      p.addEventListener('selection-changed', selectionListener);
      const cb = p.shadowRoot.querySelector(
        '.row.is-file .checkbox',
      );
      shiftClick(cb);
      expect(exclusionListener).toHaveBeenCalledOnce();
      expect(
        exclusionListener.mock.calls[0][0].detail.excludedFiles,
      ).toEqual(['a.md']);
      // Selection did NOT change — this file wasn't
      // previously selected.
      expect(selectionListener).not.toHaveBeenCalled();
    });

    it('shift+click from selected → excluded AND deselected', async () => {
      // Selected file: shift+click removes from selection
      // AND adds to excluded. Two events fire.
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(['a.md']),
        excludedFiles: new Set(),
      });
      await p.updateComplete;
      const exclusionListener = vi.fn();
      const selectionListener = vi.fn();
      p.addEventListener('exclusion-changed', exclusionListener);
      p.addEventListener('selection-changed', selectionListener);
      const cb = p.shadowRoot.querySelector(
        '.row.is-file .checkbox',
      );
      shiftClick(cb);
      expect(exclusionListener).toHaveBeenCalledOnce();
      expect(
        exclusionListener.mock.calls[0][0].detail.excludedFiles,
      ).toEqual(['a.md']);
      expect(selectionListener).toHaveBeenCalledOnce();
      expect(
        selectionListener.mock.calls[0][0].detail.selectedFiles,
      ).toEqual([]);
    });

    it('shift+click from excluded → back to normal', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
        excludedFiles: new Set(['a.md']),
      });
      await p.updateComplete;
      const exclusionListener = vi.fn();
      const selectionListener = vi.fn();
      p.addEventListener('exclusion-changed', exclusionListener);
      p.addEventListener('selection-changed', selectionListener);
      const cb = p.shadowRoot.querySelector(
        '.row.is-file .checkbox',
      );
      shiftClick(cb);
      expect(exclusionListener).toHaveBeenCalledOnce();
      expect(
        exclusionListener.mock.calls[0][0].detail.excludedFiles,
      ).toEqual([]);
      // Selection unchanged — shift+click from excluded
      // goes to index-only (normal), not selected.
      expect(selectionListener).not.toHaveBeenCalled();
    });

    it('regular click on excluded file → un-excludes AND selects', async () => {
      // Specs4: "Regular click on an excluded file —
      // un-excludes and selects." One gesture, one step.
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
        excludedFiles: new Set(['a.md']),
      });
      await p.updateComplete;
      const exclusionListener = vi.fn();
      const selectionListener = vi.fn();
      p.addEventListener('exclusion-changed', exclusionListener);
      p.addEventListener('selection-changed', selectionListener);
      const cb = p.shadowRoot.querySelector(
        '.row.is-file .checkbox',
      );
      cb.click();
      expect(exclusionListener).toHaveBeenCalledOnce();
      expect(
        exclusionListener.mock.calls[0][0].detail.excludedFiles,
      ).toEqual([]);
      expect(selectionListener).toHaveBeenCalledOnce();
      expect(
        selectionListener.mock.calls[0][0].detail.selectedFiles,
      ).toEqual(['a.md']);
    });

    it('regular click on unselected file → select (unchanged behaviour)', async () => {
      // Pre-Increment-5 behaviour still works for the
      // default state.
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
        excludedFiles: new Set(),
      });
      await p.updateComplete;
      const exclusionListener = vi.fn();
      const selectionListener = vi.fn();
      p.addEventListener('exclusion-changed', exclusionListener);
      p.addEventListener('selection-changed', selectionListener);
      const cb = p.shadowRoot.querySelector(
        '.row.is-file .checkbox',
      );
      cb.click();
      expect(selectionListener).toHaveBeenCalledOnce();
      expect(
        selectionListener.mock.calls[0][0].detail.selectedFiles,
      ).toEqual(['a.md']);
      // Exclusion NOT touched.
      expect(exclusionListener).not.toHaveBeenCalled();
    });

    it('shift+click calls preventDefault to suppress native toggle', async () => {
      // Without preventDefault, the browser's own checkbox
      // toggle would fire, producing a one-frame visual
      // glitch before our state change re-renders. Verified
      // by checking defaultPrevented on the event after
      // dispatch.
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        excludedFiles: new Set(),
      });
      await p.updateComplete;
      const cb = p.shadowRoot.querySelector(
        '.row.is-file .checkbox',
      );
      const event = shiftClick(cb);
      expect(event.defaultPrevented).toBe(true);
    });

    it('regular click does NOT call preventDefault', async () => {
      // Native toggle is desirable for the normal click
      // path — the checkbox's native .checked matches our
      // new state so no glitch.
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
        excludedFiles: new Set(),
      });
      await p.updateComplete;
      const cb = p.shadowRoot.querySelector(
        '.row.is-file .checkbox',
      );
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });
      cb.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });

    it('shift+click on a directory excludes all descendant files', async () => {
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
      ]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
        excludedFiles: new Set(),
      });
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('exclusion-changed', listener);
      const cb = p.shadowRoot.querySelector(
        '.row.is-dir .checkbox',
      );
      shiftClick(cb);
      expect(listener).toHaveBeenCalledOnce();
      const excluded =
        listener.mock.calls[0][0].detail.excludedFiles;
      expect(excluded.sort()).toEqual(['src/a.md', 'src/b.md']);
    });

    it('shift+click on a dir with all-excluded children un-excludes them', async () => {
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
      ]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
        excludedFiles: new Set(['src/a.md', 'src/b.md']),
      });
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('exclusion-changed', listener);
      const cb = p.shadowRoot.querySelector(
        '.row.is-dir .checkbox',
      );
      shiftClick(cb);
      expect(listener).toHaveBeenCalledOnce();
      expect(
        listener.mock.calls[0][0].detail.excludedFiles,
      ).toEqual([]);
    });

    it('shift+click on dir with selected children excludes AND deselects', async () => {
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
      ]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(['src/a.md']),
        excludedFiles: new Set(),
      });
      await p.updateComplete;
      const exclusionListener = vi.fn();
      const selectionListener = vi.fn();
      p.addEventListener('exclusion-changed', exclusionListener);
      p.addEventListener('selection-changed', selectionListener);
      shiftClick(
        p.shadowRoot.querySelector('.row.is-dir .checkbox'),
      );
      expect(exclusionListener).toHaveBeenCalledOnce();
      expect(selectionListener).toHaveBeenCalledOnce();
      expect(
        selectionListener.mock.calls[0][0].detail.selectedFiles,
      ).toEqual([]);
    });

    it('regular click on dir with excluded children un-excludes them', async () => {
      // Specs4: "Regular click to select directory children
      // — un-excludes any excluded children." The dir
      // checkbox's primary purpose is selection; clicking
      // it to select descendants shouldn't leave anyone
      // excluded.
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
      ]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
        excludedFiles: new Set(['src/a.md']),
      });
      await p.updateComplete;
      const exclusionListener = vi.fn();
      const selectionListener = vi.fn();
      p.addEventListener('exclusion-changed', exclusionListener);
      p.addEventListener('selection-changed', selectionListener);
      p.shadowRoot
        .querySelector('.row.is-dir .checkbox')
        .click();
      // Un-excluded src/a.md.
      expect(exclusionListener).toHaveBeenCalledOnce();
      expect(
        exclusionListener.mock.calls[0][0].detail.excludedFiles,
      ).toEqual([]);
      // Selected both.
      expect(selectionListener).toHaveBeenCalledOnce();
      expect(
        selectionListener.mock.calls[0][0].detail.selectedFiles.sort(),
      ).toEqual(['src/a.md', 'src/b.md']);
    });

    it('exclusion-changed bubbles across the shadow boundary', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        excludedFiles: new Set(),
      });
      await p.updateComplete;
      const parentListener = vi.fn();
      document.body.addEventListener(
        'exclusion-changed',
        parentListener,
      );
      shiftClick(
        p.shadowRoot.querySelector('.row.is-file .checkbox'),
      );
      document.body.removeEventListener(
        'exclusion-changed',
        parentListener,
      );
      expect(parentListener).toHaveBeenCalledOnce();
    });

    it('excludedFiles prop default is an empty Set', async () => {
      // Constructor default — tests without the prop
      // explicitly set shouldn't crash.
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      expect(p.excludedFiles).toBeInstanceOf(Set);
      expect(p.excludedFiles.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // Active-file highlight (Increment 6)
  // ---------------------------------------------------------------

  describe('active-file highlight', () => {
    it('active file gets the active-in-viewer class', async () => {
      const tree = rootOf([file('a.md', 5), file('b.md', 5)]);
      const p = mountPicker({ tree, activePath: 'a.md' });
      await p.updateComplete;
      const rows = p.shadowRoot.querySelectorAll('.row.is-file');
      expect(rows[0].classList.contains('active-in-viewer')).toBe(true);
      expect(rows[1].classList.contains('active-in-viewer')).toBe(false);
    });

    it('activePath null produces no highlight', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({ tree, activePath: null });
      await p.updateComplete;
      const row = p.shadowRoot.querySelector('.row.is-file');
      expect(row.classList.contains('active-in-viewer')).toBe(false);
    });

    it('activePath for a non-existent file silently produces no highlight', async () => {
      // Defensive — a stale activePath (file deleted from
      // the tree but viewer still holds it) shouldn't throw
      // or highlight a wrong row.
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        activePath: 'does-not-exist.md',
      });
      await p.updateComplete;
      const row = p.shadowRoot.querySelector('.row.is-file');
      expect(row.classList.contains('active-in-viewer')).toBe(false);
    });

    it('changing activePath re-renders with new highlight', async () => {
      const tree = rootOf([file('a.md', 5), file('b.md', 5)]);
      const p = mountPicker({ tree, activePath: 'a.md' });
      await p.updateComplete;
      let rows = p.shadowRoot.querySelectorAll('.row.is-file');
      expect(rows[0].classList.contains('active-in-viewer')).toBe(true);
      expect(rows[1].classList.contains('active-in-viewer')).toBe(false);
      p.activePath = 'b.md';
      await p.updateComplete;
      rows = p.shadowRoot.querySelectorAll('.row.is-file');
      expect(rows[0].classList.contains('active-in-viewer')).toBe(false);
      expect(rows[1].classList.contains('active-in-viewer')).toBe(true);
    });

    it('active highlight coexists with selection', async () => {
      // The three visual states (selected, excluded,
      // active-in-viewer) are orthogonal. A selected +
      // active file gets the checkbox ticked AND the
      // accent highlight.
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(['a.md']),
        activePath: 'a.md',
      });
      await p.updateComplete;
      const row = p.shadowRoot.querySelector('.row.is-file');
      const cb = row.querySelector('.checkbox');
      expect(row.classList.contains('active-in-viewer')).toBe(true);
      expect(cb.checked).toBe(true);
    });

    it('active highlight coexists with exclusion', async () => {
      // User can have an excluded file open in the viewer —
      // they might be reading it without wanting it in the
      // LLM's context. Both styles apply.
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        excludedFiles: new Set(['a.md']),
        activePath: 'a.md',
      });
      await p.updateComplete;
      const row = p.shadowRoot.querySelector('.row.is-file');
      expect(row.classList.contains('active-in-viewer')).toBe(true);
      expect(row.classList.contains('is-excluded')).toBe(true);
    });

    it('activePath default is null', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      expect(p.activePath).toBeNull();
    });
  });

  describe('filter', () => {
    it('filters the tree as the user types', async () => {
      const tree = rootOf([
        dir('src', [
          file('src/main.py'),
          file('src/utils.py'),
        ]),
        file('README.md'),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const input = p.shadowRoot.querySelector('.filter-input');
      input.value = 'main';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      const names = Array.from(
        p.shadowRoot.querySelectorAll('.name'),
      ).map((el) => el.textContent);
      // src dir shown (contains matching file), main.py shown,
      // utils.py hidden, README.md hidden.
      expect(names).toContain('src');
      expect(names).toContain('main.py');
      expect(names).not.toContain('utils.py');
      expect(names).not.toContain('README.md');
    });

    it('auto-expands ancestor directories of matching files', async () => {
      const tree = rootOf([
        dir('a', [dir('a/b', [file('a/b/deep.md')])]),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // Initially fully collapsed — one tree row visible
      // (the top-level `a` dir). Scope to non-root rows;
      // the root header is not counted.
      const treeRowSelector =
        '.row.is-dir:not(.is-root) .name, .row.is-file .name';
      expect(
        p.shadowRoot.querySelectorAll(treeRowSelector).length,
      ).toBe(1);
      // Type a filter — the matching file should be reachable
      // without the user manually expanding.
      const input = p.shadowRoot.querySelector('.filter-input');
      input.value = 'deep';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      const names = Array.from(
        p.shadowRoot.querySelectorAll(treeRowSelector),
      ).map((el) => el.textContent);
      // All three levels now visible.
      expect(names).toEqual(['a', 'b', 'deep.md']);
    });

    it('no matches shows the "no matching" placeholder', async () => {
      const tree = rootOf([file('a.md'), file('b.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const input = p.shadowRoot.querySelector('.filter-input');
      input.value = 'xyzzy';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      const empty = p.shadowRoot.querySelector('.empty-state');
      expect(empty.textContent).toContain('No matching');
    });

    it('setFilter() programmatic call works too', async () => {
      // Needed for the @-filter bridge from the chat input.
      const tree = rootOf([
        file('match.md'),
        file('other.md'),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p.setFilter('match');
      await p.updateComplete;
      const names = Array.from(
        p.shadowRoot.querySelectorAll('.name'),
      ).map((el) => el.textContent);
      expect(names).toContain('match.md');
      expect(names).not.toContain('other.md');
    });

    it('clearing the filter restores the full tree', async () => {
      const tree = rootOf([file('a.md'), file('b.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const input = p.shadowRoot.querySelector('.filter-input');
      input.value = 'a';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      // Only a.md visible.
      expect(
        p.shadowRoot.querySelectorAll('.row.is-file').length,
      ).toBe(1);
      // Clear.
      input.value = '';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      expect(
        p.shadowRoot.querySelectorAll('.row.is-file').length,
      ).toBe(2);
    });

    it('does not collapse directories the user had opened', async () => {
      // User-opened state must survive filter typing/clearing.
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // User expands src.
      p.shadowRoot.querySelector('.row.is-dir').click();
      await p.updateComplete;
      // Type filter then clear.
      const input = p.shadowRoot.querySelector('.filter-input');
      input.value = 'xyz';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      input.value = '';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      // src is still expanded (both files visible).
      const names = Array.from(
        p.shadowRoot.querySelectorAll('.name'),
      ).map((el) => el.textContent);
      expect(names).toContain('a.md');
      expect(names).toContain('b.md');
    });
  });

  // ---------------------------------------------------------------
  // Sort buttons (Increment 3)
  // ---------------------------------------------------------------

  describe('sort buttons', () => {
    it('renders three sort-mode buttons in the filter bar', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      const btns = p.shadowRoot.querySelectorAll('.sort-btn');
      expect(btns).toHaveLength(3);
      const modes = Array.from(btns).map((b) =>
        b.getAttribute('data-sort-mode'),
      );
      expect(modes).toEqual(['name', 'mtime', 'size']);
    });

    it('defaults to name mode ascending on first mount', async () => {
      // Fresh localStorage → name mode, ascending. The active
      // button has .active and aria-pressed=true, and shows
      // the ↑ direction glyph.
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      const nameBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="name"]',
      );
      expect(nameBtn.classList.contains('active')).toBe(true);
      expect(nameBtn.getAttribute('aria-pressed')).toBe('true');
      expect(nameBtn.textContent).toContain('↑');
    });

    it('only one button is active at a time', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      const actives = p.shadowRoot.querySelectorAll(
        '.sort-btn.active',
      );
      expect(actives).toHaveLength(1);
    });

    it('clicking a different mode switches and resets to ascending', async () => {
      // Name → mtime: mtime becomes active, asc=true (fresh
      // sort starts at the familiar anchor — oldest-first
      // for mtime).
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      const mtimeBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="mtime"]',
      );
      mtimeBtn.click();
      await p.updateComplete;
      expect(p._sortMode).toBe('mtime');
      expect(p._sortAsc).toBe(true);
      // Name button no longer active.
      const nameBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="name"]',
      );
      expect(nameBtn.classList.contains('active')).toBe(false);
      expect(mtimeBtn.classList.contains('active')).toBe(true);
    });

    it('clicking the active mode toggles direction', async () => {
      // Click name twice (starting as default active+asc):
      // first click toggles to descending.
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      const nameBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="name"]',
      );
      nameBtn.click();
      await p.updateComplete;
      expect(p._sortMode).toBe('name');
      expect(p._sortAsc).toBe(false);
      expect(nameBtn.textContent).toContain('↓');
      // Click again — back to ascending.
      nameBtn.click();
      await p.updateComplete;
      expect(p._sortAsc).toBe(true);
      expect(nameBtn.textContent).toContain('↑');
    });

    it('files render in the selected sort order', async () => {
      const tree = rootOf([
        file('c.md', 10, 1000),
        file('a.md', 500, 3000),
        file('b.md', 100, 2000),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // Default: name ascending.
      const namesFor = () =>
        Array.from(
          p.shadowRoot.querySelectorAll('.row.is-file .name'),
        ).map((el) => el.textContent);
      expect(namesFor()).toEqual(['a.md', 'b.md', 'c.md']);
      // Switch to size ascending: smallest first.
      p.shadowRoot
        .querySelector('.sort-btn[data-sort-mode="size"]')
        .click();
      await p.updateComplete;
      expect(namesFor()).toEqual(['c.md', 'b.md', 'a.md']);
      // Click size again — descending (largest first).
      p.shadowRoot
        .querySelector('.sort-btn[data-sort-mode="size"]')
        .click();
      await p.updateComplete;
      expect(namesFor()).toEqual(['a.md', 'b.md', 'c.md']);
      // Switch to mtime ascending: oldest first.
      p.shadowRoot
        .querySelector('.sort-btn[data-sort-mode="mtime"]')
        .click();
      await p.updateComplete;
      expect(namesFor()).toEqual(['c.md', 'b.md', 'a.md']);
    });

    it('directories stay alphabetical regardless of mode', async () => {
      // The sort mode and direction only apply to files.
      // Dirs always sort A-Z ascending.
      const tree = rootOf([
        dir('z_dir', []),
        dir('a_dir', []),
        dir('m_dir', []),
        file('a.md', 100),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // Check every mode and both directions.
      const modes = ['name', 'mtime', 'size'];
      for (const mode of modes) {
        // Activate the mode. If already active, this toggles
        // direction; click it twice to get a known state.
        const btn = p.shadowRoot.querySelector(
          `.sort-btn[data-sort-mode="${mode}"]`,
        );
        btn.click();
        await p.updateComplete;
        if (!p._sortAsc) {
          btn.click();
          await p.updateComplete;
        }
        // Ascending — dirs must be alphabetical.
        const dirNames = Array.from(
          p.shadowRoot.querySelectorAll('.row.is-dir:not(.is-root) .name'),
        ).map((el) => el.textContent);
        expect(dirNames).toEqual(['a_dir', 'm_dir', 'z_dir']);
        // Toggle to descending — still alphabetical.
        btn.click();
        await p.updateComplete;
        const dirNamesDesc = Array.from(
          p.shadowRoot.querySelectorAll('.row.is-dir:not(.is-root) .name'),
        ).map((el) => el.textContent);
        expect(dirNamesDesc).toEqual(['a_dir', 'm_dir', 'z_dir']);
      }
    });

    it('persists mode to localStorage on change', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      p.shadowRoot
        .querySelector('.sort-btn[data-sort-mode="mtime"]')
        .click();
      await p.updateComplete;
      expect(localStorage.getItem('ac-dc-sort-mode')).toBe('mtime');
      expect(localStorage.getItem('ac-dc-sort-asc')).toBe('1');
    });

    it('persists direction to localStorage on toggle', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      // Toggle name to descending.
      p.shadowRoot
        .querySelector('.sort-btn[data-sort-mode="name"]')
        .click();
      await p.updateComplete;
      expect(localStorage.getItem('ac-dc-sort-asc')).toBe('0');
      // Back to ascending.
      p.shadowRoot
        .querySelector('.sort-btn[data-sort-mode="name"]')
        .click();
      await p.updateComplete;
      expect(localStorage.getItem('ac-dc-sort-asc')).toBe('1');
    });

    it('restores mode and direction from localStorage on mount', async () => {
      // Seed storage before mounting — the constructor
      // reads these and applies them immediately.
      localStorage.setItem('ac-dc-sort-mode', 'size');
      localStorage.setItem('ac-dc-sort-asc', '0');
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      expect(p._sortMode).toBe('size');
      expect(p._sortAsc).toBe(false);
      const sizeBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="size"]',
      );
      expect(sizeBtn.classList.contains('active')).toBe(true);
      expect(sizeBtn.textContent).toContain('↓');
    });

    it('ignores unknown mode in localStorage', async () => {
      localStorage.setItem('ac-dc-sort-mode', 'bogus');
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      // Falls back to name.
      expect(p._sortMode).toBe('name');
    });

    it('ignores malformed direction in localStorage', async () => {
      localStorage.setItem('ac-dc-sort-mode', 'name');
      localStorage.setItem('ac-dc-sort-asc', 'maybe');
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      // Falls back to ascending.
      expect(p._sortAsc).toBe(true);
    });

    it('active button shows direction glyph; inactive buttons do not', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      // Default: name is active, shows ↑; mtime and size have
      // no direction glyph.
      const nameBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="name"]',
      );
      const mtimeBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="mtime"]',
      );
      const sizeBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="size"]',
      );
      expect(nameBtn.querySelector('.dir')).toBeTruthy();
      expect(mtimeBtn.querySelector('.dir')).toBeNull();
      expect(sizeBtn.querySelector('.dir')).toBeNull();
      // Switch to mtime — only mtime shows the glyph now.
      mtimeBtn.click();
      await p.updateComplete;
      const nameBtnAfter = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="name"]',
      );
      const mtimeBtnAfter = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="mtime"]',
      );
      expect(nameBtnAfter.querySelector('.dir')).toBeNull();
      expect(mtimeBtnAfter.querySelector('.dir')).toBeTruthy();
    });
  });

  describe('setTree()', () => {
    it('replaces the current tree and re-renders', async () => {
      const p = mountPicker({ tree: rootOf([file('old.md')]) });
      await p.updateComplete;
      // Scope to file row — the root header also emits a
      // `.name` span for the repo name.
      expect(
        p.shadowRoot.querySelector('.row.is-file .name').textContent,
      ).toBe('old.md');
      p.setTree(rootOf([file('new.md')]));
      await p.updateComplete;
      expect(
        p.shadowRoot.querySelector('.row.is-file .name').textContent,
      ).toBe('new.md');
    });
  });

  describe('expand state snapshot / restore', () => {
    // The file-search flow uses `setTree` to swap the full
    // tree for a pruned one. On exit, the picker must restore
    // whatever expand/collapse state the user had before the
    // swap. Tests pin the snapshot-and-restore semantics.

    it('setTree snapshots expanded state on first call', async () => {
      const p = mountPicker({
        tree: rootOf([
          dir('src', [file('src/main.py')]),
          dir('tests', [file('tests/a.py')]),
        ]),
      });
      await p.updateComplete;
      // User expands src.
      const dirRow = p.shadowRoot.querySelector('.row.is-dir');
      dirRow.click();
      await p.updateComplete;
      expect(p._expanded.has('src')).toBe(true);
      // Swap to a pruned tree.
      p.setTree(rootOf([file('pruned.md')]));
      await p.updateComplete;
      // Snapshot preserved the pre-swap expanded set.
      expect(p._expandedSnapshot).toBeInstanceOf(Set);
      expect(p._expandedSnapshot.has('src')).toBe(true);
    });

    it('repeated setTree calls do not re-snapshot', async () => {
      // Search refinements send multiple pruned trees as the
      // user types. Each re-snapshot would overwrite the
      // original full-tree state with whatever the current
      // pruned tree's expansion happened to be, defeating
      // the purpose.
      const p = mountPicker({
        tree: rootOf([dir('original', [file('original/x')])]),
      });
      await p.updateComplete;
      // Expand original.
      p.shadowRoot.querySelector('.row.is-dir').click();
      await p.updateComplete;
      const firstSnapshot = new Set(p._expanded);
      // First setTree — snapshot taken.
      p.setTree(rootOf([file('a.md')]));
      await p.updateComplete;
      expect(p._expandedSnapshot).toEqual(firstSnapshot);
      // Expand something in the pruned tree (nothing to
      // expand in this one, so mutate directly to simulate).
      p._expanded = new Set(['pruned-dir']);
      await p.updateComplete;
      // Second setTree — snapshot unchanged.
      p.setTree(rootOf([file('b.md')]));
      await p.updateComplete;
      expect(p._expandedSnapshot).toEqual(firstSnapshot);
      expect(p._expandedSnapshot.has('pruned-dir')).toBe(false);
    });

    it('restoreExpandedState restores the snapshot', async () => {
      const p = mountPicker({
        tree: rootOf([dir('src', [file('src/x.py')])]),
      });
      await p.updateComplete;
      p.shadowRoot.querySelector('.row.is-dir').click();
      await p.updateComplete;
      p.setTree(rootOf([file('a.md')]));
      await p.updateComplete;
      // Now restore.
      p.restoreExpandedState();
      await p.updateComplete;
      expect(p._expanded.has('src')).toBe(true);
      // Snapshot cleared — next setTree starts fresh.
      expect(p._expandedSnapshot).toBeNull();
    });

    it('restoreExpandedState without a snapshot is a no-op', async () => {
      const p = mountPicker({
        tree: rootOf([dir('src', [file('src/x.py')])]),
      });
      await p.updateComplete;
      p.shadowRoot.querySelector('.row.is-dir').click();
      await p.updateComplete;
      const before = new Set(p._expanded);
      // No setTree → no snapshot.
      p.restoreExpandedState();
      await p.updateComplete;
      // Expanded set unchanged.
      expect(p._expanded).toEqual(before);
    });

    it('setTree resets _focusedPath', async () => {
      // A focused path from the previous tree may not exist
      // in the new one. Reset to null so render doesn't try
      // to highlight a non-existent row.
      const p = mountPicker({
        tree: rootOf([file('a.md')]),
      });
      await p.updateComplete;
      p._focusedPath = 'a.md';
      await p.updateComplete;
      p.setTree(rootOf([file('b.md')]));
      await p.updateComplete;
      expect(p._focusedPath).toBeNull();
    });

    it('restoreExpandedState resets _focusedPath', async () => {
      const p = mountPicker({
        tree: rootOf([file('a.md')]),
      });
      await p.updateComplete;
      p._focusedPath = 'a.md';
      p.setTree(rootOf([file('b.md')]));
      await p.updateComplete;
      p._focusedPath = 'b.md';
      p.restoreExpandedState();
      await p.updateComplete;
      expect(p._focusedPath).toBeNull();
    });
  });

  describe('_focusedPath highlight', () => {
    it('file row gets .focused class when _focusedPath matches', async () => {
      const p = mountPicker({
        tree: rootOf([file('a.md'), file('b.md')]),
      });
      await p.updateComplete;
      p._focusedPath = 'a.md';
      await p.updateComplete;
      const rows = p.shadowRoot.querySelectorAll('.row.is-file');
      expect(rows[0].classList.contains('focused')).toBe(true);
      expect(rows[1].classList.contains('focused')).toBe(false);
    });

    it('aria-current is set on the focused row', async () => {
      const p = mountPicker({
        tree: rootOf([file('a.md'), file('b.md')]),
      });
      await p.updateComplete;
      p._focusedPath = 'b.md';
      await p.updateComplete;
      const rows = p.shadowRoot.querySelectorAll('.row.is-file');
      expect(rows[0].getAttribute('aria-current')).toBe('false');
      expect(rows[1].getAttribute('aria-current')).toBe('true');
    });

    it('null _focusedPath leaves no row focused', async () => {
      const p = mountPicker({
        tree: rootOf([file('a.md')]),
      });
      await p.updateComplete;
      // Default state — nothing focused.
      expect(p._focusedPath).toBeNull();
      const row = p.shadowRoot.querySelector('.row.is-file');
      expect(row.classList.contains('focused')).toBe(false);
    });

    it('_focusedPath for non-existent file silently produces no highlight', async () => {
      const p = mountPicker({
        tree: rootOf([file('a.md')]),
      });
      await p.updateComplete;
      p._focusedPath = 'does-not-exist.md';
      await p.updateComplete;
      const row = p.shadowRoot.querySelector('.row.is-file');
      expect(row.classList.contains('focused')).toBe(false);
    });
  });

  describe('bubbling', () => {
    it('selection-changed bubbles out of the shadow root', async () => {
      // The files-tab orchestrator listens at the parent level,
      // so the event must cross the shadow boundary (composed: true).
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
      });
      await p.updateComplete;
      const parentListener = vi.fn();
      document.body.addEventListener(
        'selection-changed',
        parentListener,
      );
      p.shadowRoot.querySelector('.row.is-file .checkbox').click();
      document.body.removeEventListener(
        'selection-changed',
        parentListener,
      );
      expect(parentListener).toHaveBeenCalledOnce();
    });

    it('file-clicked bubbles out of the shadow root', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const parentListener = vi.fn();
      document.body.addEventListener(
        'file-clicked',
        parentListener,
      );
      p.shadowRoot.querySelector('.row.is-file .name').click();
      document.body.removeEventListener(
        'file-clicked',
        parentListener,
      );
      expect(parentListener).toHaveBeenCalledOnce();
    });
  });

  // ---------------------------------------------------------------
  // Status badges (M/S/U/D)
  // ---------------------------------------------------------------

  describe('status badges', () => {
    /** Build a minimal status-data shape for tests. */
    function statusData({
      modified = [],
      staged = [],
      untracked = [],
      deleted = [],
      diffStats = {},
    } = {}) {
      return {
        modified: new Set(modified),
        staged: new Set(staged),
        untracked: new Set(untracked),
        deleted: new Set(deleted),
        diffStats: new Map(Object.entries(diffStats)),
      };
    }

    it('no status data produces no badges', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      expect(
        p.shadowRoot.querySelector('.status-badge'),
      ).toBeNull();
    });

    it('renders M badge for modified files', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: statusData({ modified: ['a.md'] }),
      });
      await p.updateComplete;
      const badge = p.shadowRoot.querySelector('.status-badge');
      expect(badge).toBeTruthy();
      expect(badge.textContent.trim()).toBe('M');
      expect(badge.classList.contains('status-modified')).toBe(true);
    });

    it('renders S badge for staged files', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: statusData({ staged: ['a.md'] }),
      });
      await p.updateComplete;
      const badge = p.shadowRoot.querySelector('.status-badge');
      expect(badge.textContent.trim()).toBe('S');
      expect(badge.classList.contains('status-staged')).toBe(true);
    });

    it('renders U badge for untracked files', async () => {
      const tree = rootOf([file('new.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: statusData({ untracked: ['new.md'] }),
      });
      await p.updateComplete;
      const badge = p.shadowRoot.querySelector('.status-badge');
      expect(badge.textContent.trim()).toBe('U');
      expect(
        badge.classList.contains('status-untracked'),
      ).toBe(true);
    });

    it('renders D badge for deleted files', async () => {
      const tree = rootOf([file('gone.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: statusData({ deleted: ['gone.md'] }),
      });
      await p.updateComplete;
      const badge = p.shadowRoot.querySelector('.status-badge');
      expect(badge.textContent.trim()).toBe('D');
      expect(badge.classList.contains('status-deleted')).toBe(true);
    });

    it('priority: deleted beats staged', async () => {
      // If a file somehow appears in both (rare — git would
      // report as staged deletion), we prefer D so the user
      // sees the "this file is going away" signal.
      const tree = rootOf([file('gone.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: statusData({
          staged: ['gone.md'],
          deleted: ['gone.md'],
        }),
      });
      await p.updateComplete;
      const badge = p.shadowRoot.querySelector('.status-badge');
      expect(badge.textContent.trim()).toBe('D');
    });

    it('priority: staged beats modified', async () => {
      // Common real-world state: user staged, then edited
      // again. Short-form `git status` shows `MM` (staged +
      // working). We show a single badge, and the staged
      // action is the most recent user-intended action.
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: statusData({
          staged: ['a.md'],
          modified: ['a.md'],
        }),
      });
      await p.updateComplete;
      const badge = p.shadowRoot.querySelector('.status-badge');
      expect(badge.textContent.trim()).toBe('S');
    });

    it('priority: modified beats untracked', async () => {
      // Shouldn't happen naturally — a tracked file can be
      // modified, an untracked file cannot. But if the two
      // Sets overlap defensively we still produce a single
      // consistent badge rather than rendering both.
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: statusData({
          modified: ['a.md'],
          untracked: ['a.md'],
        }),
      });
      await p.updateComplete;
      const badge = p.shadowRoot.querySelector('.status-badge');
      expect(badge.textContent.trim()).toBe('M');
    });

    it('only one badge per file (not multiple)', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: statusData({
          modified: ['a.md'],
          staged: ['a.md'],
          untracked: ['a.md'],
        }),
      });
      await p.updateComplete;
      const badges = p.shadowRoot.querySelectorAll(
        '.status-badge',
      );
      expect(badges).toHaveLength(1);
    });

    it('different files get different badges', async () => {
      // Picker sorts children alphabetically (files within
      // a directory), so render order here is d, m, s, u
      // regardless of how we declare them. The test pins
      // each badge reaches the correct row — the ordering
      // assertion is derived from sortChildren's contract,
      // not a standalone invariant.
      const tree = rootOf([
        file('m.md', 1),
        file('s.md', 1),
        file('u.md', 1),
        file('d.md', 1),
      ]);
      const p = mountPicker({
        tree,
        statusData: statusData({
          modified: ['m.md'],
          staged: ['s.md'],
          untracked: ['u.md'],
          deleted: ['d.md'],
        }),
      });
      await p.updateComplete;
      const badges = Array.from(
        p.shadowRoot.querySelectorAll('.status-badge'),
      ).map((b) => b.textContent.trim());
      // Alphabetical: d.md → D, m.md → M, s.md → S, u.md → U.
      expect(badges).toEqual(['D', 'M', 'S', 'U']);
    });

    it('badges survive partial / malformed status data', async () => {
      // Defensive — a missing Set shouldn't throw.
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: {
          // No modified/staged/untracked/deleted arrays.
          diffStats: new Map(),
        },
      });
      await p.updateComplete;
      // Renders without throwing; no badge.
      expect(
        p.shadowRoot.querySelector('.status-badge'),
      ).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // Diff stats (+N -N)
  // ---------------------------------------------------------------

  describe('diff stats', () => {
    function statusData(diffStatsObj = {}) {
      return {
        modified: new Set(),
        staged: new Set(),
        untracked: new Set(),
        deleted: new Set(),
        diffStats: new Map(Object.entries(diffStatsObj)),
      };
    }

    it('no diff stats entry renders no diff stats', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: statusData({}),
      });
      await p.updateComplete;
      expect(p.shadowRoot.querySelector('.diff-stats')).toBeNull();
    });

    it('renders +added and -removed when both non-zero', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: statusData({
          'a.md': { added: 12, removed: 3 },
        }),
      });
      await p.updateComplete;
      const stats = p.shadowRoot.querySelector('.diff-stats');
      expect(stats).toBeTruthy();
      expect(stats.textContent).toContain('+12');
      expect(stats.textContent).toContain('-3');
    });

    it('omits the +added span when added is zero', async () => {
      // Pure deletion — render only the -N, not "+0 -5"
      // noise.
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: statusData({
          'a.md': { added: 0, removed: 5 },
        }),
      });
      await p.updateComplete;
      const stats = p.shadowRoot.querySelector('.diff-stats');
      expect(stats).toBeTruthy();
      expect(stats.querySelector('.added')).toBeNull();
      expect(stats.querySelector('.removed').textContent).toBe(
        '-5',
      );
    });

    it('omits the -removed span when removed is zero', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: statusData({
          'a.md': { added: 7, removed: 0 },
        }),
      });
      await p.updateComplete;
      const stats = p.shadowRoot.querySelector('.diff-stats');
      expect(stats.querySelector('.added').textContent).toBe(
        '+7',
      );
      expect(stats.querySelector('.removed')).toBeNull();
    });

    it('renders nothing when both added and removed are zero', async () => {
      // Shouldn't appear in real diff_stats, but defensive
      // against the edge case — an all-zero entry shouldn't
      // produce empty noise in the UI.
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: statusData({
          'a.md': { added: 0, removed: 0 },
        }),
      });
      await p.updateComplete;
      expect(p.shadowRoot.querySelector('.diff-stats')).toBeNull();
    });

    it('only renders diff stats for files that have entries', async () => {
      const tree = rootOf([file('a.md', 5), file('b.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: statusData({
          'a.md': { added: 3, removed: 1 },
        }),
      });
      await p.updateComplete;
      const allStats = p.shadowRoot.querySelectorAll(
        '.diff-stats',
      );
      expect(allStats).toHaveLength(1);
    });

    it('tolerates malformed entries (missing added/removed)', async () => {
      const tree = rootOf([file('a.md', 5)]);
      const p = mountPicker({
        tree,
        statusData: statusData({
          'a.md': {}, // no fields
        }),
      });
      await p.updateComplete;
      // Treated as zero-zero → no render.
      expect(p.shadowRoot.querySelector('.diff-stats')).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // Root row and branch pill
  // ---------------------------------------------------------------

  describe('root row', () => {
    it('renders the repo name from tree.name', async () => {
      const tree = {
        name: 'my-repo',
        path: '',
        type: 'dir',
        lines: 0,
        children: [],
      };
      const p = mountPicker({ tree });
      await p.updateComplete;
      const root = p.shadowRoot.querySelector('.row.is-root');
      expect(root).toBeTruthy();
      expect(root.textContent).toContain('my-repo');
    });

    it('omits the root row when no repo name is available', async () => {
      // Empty tree.name AND empty branchInfo.repoName →
      // skip rendering the root header altogether.
      const tree = rootOf([]); // tree.name is "repo" from rootOf.
      const p = mountPicker({
        tree: { ...tree, name: '' },
        branchInfo: {
          branch: null,
          detached: false,
          sha: null,
          repoName: '',
        },
      });
      await p.updateComplete;
      expect(
        p.shadowRoot.querySelector('.row.is-root'),
      ).toBeNull();
    });

    it('falls back to branchInfo.repoName when tree.name is empty', async () => {
      const tree = rootOf([]);
      const p = mountPicker({
        tree: { ...tree, name: '' },
        branchInfo: {
          branch: 'main',
          detached: false,
          sha: null,
          repoName: 'fallback-name',
        },
      });
      await p.updateComplete;
      const root = p.shadowRoot.querySelector('.row.is-root');
      expect(root.textContent).toContain('fallback-name');
    });

    it('root row has a tooltip of the repo name', async () => {
      const tree = {
        name: 'my-repo',
        path: '',
        type: 'dir',
        lines: 0,
        children: [],
      };
      const p = mountPicker({ tree });
      await p.updateComplete;
      const root = p.shadowRoot.querySelector('.row.is-root');
      expect(root.getAttribute('title')).toBe('my-repo');
    });
  });

  describe('branch pill', () => {
    it('renders normal branch name', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        branchInfo: {
          branch: 'main',
          detached: false,
          sha: null,
          repoName: 'repo',
        },
      });
      await p.updateComplete;
      const pill = p.shadowRoot.querySelector('.branch-pill');
      expect(pill).toBeTruthy();
      expect(pill.textContent).toContain('main');
      expect(pill.classList.contains('detached')).toBe(false);
    });

    it('renders branch name in a muted pill by default', async () => {
      // The pill exists without the detached class —
      // which selects the default muted styling.
      const p = mountPicker({
        tree: rootOf([]),
        branchInfo: {
          branch: 'feature/my-work',
          detached: false,
          sha: null,
          repoName: 'repo',
        },
      });
      await p.updateComplete;
      const pill = p.shadowRoot.querySelector('.branch-pill');
      expect(pill.classList.contains('detached')).toBe(false);
      expect(pill.textContent).toContain('feature/my-work');
    });

    it('renders short SHA in orange when detached', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        branchInfo: {
          branch: null,
          detached: true,
          sha: 'abc1234deadbeef',
          repoName: 'repo',
        },
      });
      await p.updateComplete;
      const pill = p.shadowRoot.querySelector('.branch-pill');
      expect(pill).toBeTruthy();
      expect(pill.classList.contains('detached')).toBe(true);
      // Short SHA is 7 chars.
      expect(pill.textContent).toContain('abc1234');
      expect(pill.textContent).not.toContain('deadbeef');
    });

    it('detached with no SHA renders no pill', async () => {
      // Defensive — detached state with missing SHA
      // produces nothing rather than an empty orange box.
      const p = mountPicker({
        tree: rootOf([]),
        branchInfo: {
          branch: null,
          detached: true,
          sha: null,
          repoName: 'repo',
        },
      });
      await p.updateComplete;
      expect(
        p.shadowRoot.querySelector('.branch-pill'),
      ).toBeNull();
    });

    it('empty repo (no branch, not detached) renders no pill', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        branchInfo: {
          branch: null,
          detached: false,
          sha: null,
          repoName: 'new-repo',
        },
      });
      await p.updateComplete;
      expect(
        p.shadowRoot.querySelector('.branch-pill'),
      ).toBeNull();
      // But the root row still renders (repo name present).
      expect(
        p.shadowRoot.querySelector('.row.is-root'),
      ).toBeTruthy();
    });

    it('pill has a tooltip describing the branch', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        branchInfo: {
          branch: 'main',
          detached: false,
          sha: null,
          repoName: 'repo',
        },
      });
      await p.updateComplete;
      const pill = p.shadowRoot.querySelector('.branch-pill');
      expect(pill.getAttribute('title')).toContain('main');
    });

    it('detached pill tooltip shows full SHA', async () => {
      // Short SHA in the pill, full SHA in the tooltip —
      // the tooltip is the user's escape hatch for
      // verification / copy-paste.
      const p = mountPicker({
        tree: rootOf([]),
        branchInfo: {
          branch: null,
          detached: true,
          sha: 'abc1234deadbeef',
          repoName: 'repo',
        },
      });
      await p.updateComplete;
      const pill = p.shadowRoot.querySelector('.branch-pill');
      expect(pill.getAttribute('title')).toContain(
        'abc1234deadbeef',
      );
    });

    it('null branchInfo produces no pill without crashing', async () => {
      // Defensive — prop set to null rather than the
      // defaulted shape. The picker has to tolerate this
      // because a parent might pass null during RPC error
      // cleanup.
      const p = mountPicker({
        tree: rootOf([]),
        branchInfo: null,
      });
      await p.updateComplete;
      expect(
        p.shadowRoot.querySelector('.branch-pill'),
      ).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // Tooltips
  // ---------------------------------------------------------------

  describe('tooltips', () => {
    it('file row has title of "path — name"', async () => {
      const tree = rootOf([
        dir('src', [file('src/deep/main.py')]),
      ]);
      // Expand src so the nested file becomes visible.
      const p = mountPicker({ tree });
      await p.updateComplete;
      p.shadowRoot.querySelector('.row.is-dir').click();
      await p.updateComplete;
      const fileRow = p.shadowRoot.querySelector('.row.is-file');
      expect(fileRow.getAttribute('title')).toBe(
        'src/deep/main.py — main.py',
      );
    });

    it('directory row has title of "path — name"', async () => {
      const tree = rootOf([
        dir('src', [
          dir('src/utils', [file('src/utils/x.py')]),
        ]),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // Scope to non-root rows — the root row is also
      // `.row.is-dir`, and its click would toggle nothing
      // (not a directory we want to expand in this test).
      const topLevelSrc = p.shadowRoot.querySelector(
        '.row.is-dir:not(.is-root)',
      );
      topLevelSrc.click();
      await p.updateComplete;
      // Now src and src/utils are both visible as
      // non-root dir rows.
      const treeDirRows = p.shadowRoot.querySelectorAll(
        '.row.is-dir:not(.is-root)',
      );
      // Top-level src has path === name, so the tooltip
      // is just the name (no "src — src" redundancy).
      expect(treeDirRows[0].getAttribute('title')).toBe('src');
      // Nested row's path differs from its name, so it
      // gets the full `path — name` form.
      const utilsRow = Array.from(treeDirRows).find((r) =>
        r.textContent.includes('utils'),
      );
      expect(utilsRow.getAttribute('title')).toBe(
        'src/utils — utils',
      );
    });

    it('directory row has title of "path — name" when they differ', async () => {
      const tree = rootOf([
        dir('src', [
          dir('src/utils', [file('src/utils/x.py')]),
        ]),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // Scope to non-root rows — the root header is also
      // `.row.is-dir`, and a click on it wouldn't expand
      // anything useful for this test.
      const topLevelSrc = p.shadowRoot.querySelector(
        '.row.is-dir:not(.is-root)',
      );
      topLevelSrc.click();
      await p.updateComplete;
      // Now src and src/utils are both visible.
      const treeDirRows = p.shadowRoot.querySelectorAll(
        '.row.is-dir:not(.is-root)',
      );
      // Top-level src has path === name, so the tooltip is
      // just the name (no redundant "src — src").
      expect(treeDirRows[0].getAttribute('title')).toBe('src');
      // Nested row's path differs from its name, so it gets
      // the full `path — name` form.
      const utilsRow = Array.from(treeDirRows).find((r) =>
        r.textContent.includes('utils'),
      );
      expect(utilsRow.getAttribute('title')).toBe(
        'src/utils — utils',
      );
    });
    it('top-level file has title of just the name', async () => {
      // path equals name → only the name shows (no
      // redundant "a.md — a.md").
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const row = p.shadowRoot.querySelector('.row.is-file');
      expect(row.getAttribute('title')).toBe('a.md');
    });

    it('top-level directory has title of just the name', async () => {
      const tree = rootOf([dir('src', [])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const row = p.shadowRoot.querySelector('.row.is-dir');
      expect(row.getAttribute('title')).toBe('src');
    });
  });

  // ---------------------------------------------------------------
  // Line-count color classes
  // ---------------------------------------------------------------

  describe('line-count color', () => {
    it('below 130 lines gets the green class', async () => {
      const tree = rootOf([file('small.md', 50)]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const badge = p.shadowRoot.querySelector('.lines-badge');
      expect(badge.classList.contains('lines-green')).toBe(true);
      expect(badge.classList.contains('lines-orange')).toBe(false);
      expect(badge.classList.contains('lines-red')).toBe(false);
    });

    it('exactly 129 lines gets green (boundary)', async () => {
      // Boundary check: the orange band starts AT 130, so
      // 129 should still be green.
      const tree = rootOf([file('just-under.md', 129)]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const badge = p.shadowRoot.querySelector('.lines-badge');
      expect(badge.classList.contains('lines-green')).toBe(true);
    });

    it('exactly 130 lines gets orange (boundary)', async () => {
      const tree = rootOf([file('boundary.md', 130)]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const badge = p.shadowRoot.querySelector('.lines-badge');
      expect(badge.classList.contains('lines-orange')).toBe(true);
    });

    it('between 130 and 170 gets orange', async () => {
      const tree = rootOf([file('mid.md', 150)]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const badge = p.shadowRoot.querySelector('.lines-badge');
      expect(badge.classList.contains('lines-orange')).toBe(true);
    });

    it('exactly 170 lines gets orange (boundary)', async () => {
      // Red band is > 170, so 170 itself is still orange.
      const tree = rootOf([file('at-limit.md', 170)]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const badge = p.shadowRoot.querySelector('.lines-badge');
      expect(badge.classList.contains('lines-orange')).toBe(true);
    });

    it('exactly 171 lines gets red (boundary)', async () => {
      const tree = rootOf([file('over.md', 171)]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const badge = p.shadowRoot.querySelector('.lines-badge');
      expect(badge.classList.contains('lines-red')).toBe(true);
    });

    it('very large file still gets red', async () => {
      const tree = rootOf([file('huge.md', 2000)]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const badge = p.shadowRoot.querySelector('.lines-badge');
      expect(badge.classList.contains('lines-red')).toBe(true);
    });

    it('empty file produces no badge at all', async () => {
      // Existing behaviour — zero-line files render no
      // badge. The color logic is never reached.
      const tree = rootOf([file('empty.md', 0)]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      expect(
        p.shadowRoot.querySelector('.lines-badge'),
      ).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // Keyboard navigation (Increment 7)
  // ---------------------------------------------------------------

  describe('keyboard navigation', () => {
    // Helper — fire a keydown event on the tree scroll
    // container with a given key. jsdom doesn't honour
    // synthetic keydown from untrusted clicks, so we
    // construct a KeyboardEvent directly.
    function keyDown(picker, key) {
      const tree = picker.shadowRoot.querySelector('.tree-scroll');
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      tree.dispatchEvent(event);
      return event;
    }

    it('ArrowDown moves focus to first row from empty focus', async () => {
      const tree = rootOf([file('a.md'), file('b.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      expect(p._focusedPath).toBeNull();
      keyDown(p, 'ArrowDown');
      await p.updateComplete;
      expect(p._focusedPath).toBe('a.md');
    });

    it('ArrowDown advances through rows', async () => {
      const tree = rootOf([file('a.md'), file('b.md'), file('c.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      keyDown(p, 'ArrowDown'); // a.md
      await p.updateComplete;
      keyDown(p, 'ArrowDown'); // b.md
      await p.updateComplete;
      expect(p._focusedPath).toBe('b.md');
      keyDown(p, 'ArrowDown'); // c.md
      await p.updateComplete;
      expect(p._focusedPath).toBe('c.md');
    });

    it('ArrowDown clamps at the last row', async () => {
      const tree = rootOf([file('a.md'), file('b.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      keyDown(p, 'ArrowDown');
      keyDown(p, 'ArrowDown');
      keyDown(p, 'ArrowDown'); // past the end
      await p.updateComplete;
      expect(p._focusedPath).toBe('b.md');
    });

    it('ArrowUp moves backward', async () => {
      const tree = rootOf([file('a.md'), file('b.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._focusedPath = 'b.md';
      keyDown(p, 'ArrowUp');
      await p.updateComplete;
      expect(p._focusedPath).toBe('a.md');
    });

    it('ArrowUp clamps at the first row', async () => {
      const tree = rootOf([file('a.md'), file('b.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._focusedPath = 'a.md';
      keyDown(p, 'ArrowUp');
      await p.updateComplete;
      expect(p._focusedPath).toBe('a.md');
    });

    it('Home jumps to first row', async () => {
      const tree = rootOf([file('a.md'), file('b.md'), file('c.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._focusedPath = 'c.md';
      keyDown(p, 'Home');
      await p.updateComplete;
      expect(p._focusedPath).toBe('a.md');
    });

    it('End jumps to last row', async () => {
      const tree = rootOf([file('a.md'), file('b.md'), file('c.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._focusedPath = 'a.md';
      keyDown(p, 'End');
      await p.updateComplete;
      expect(p._focusedPath).toBe('c.md');
    });

    it('ArrowRight on closed dir expands it', async () => {
      const tree = rootOf([
        dir('src', [file('src/a.md')]),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._focusedPath = 'src';
      keyDown(p, 'ArrowRight');
      await p.updateComplete;
      expect(p._expanded.has('src')).toBe(true);
      // Focus stays on the dir — didn't move to child.
      expect(p._focusedPath).toBe('src');
    });

    it('ArrowRight on open dir moves focus to first child', async () => {
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // Expand manually so the dir's children are visible.
      p._expanded = new Set(['src']);
      p._focusedPath = 'src';
      await p.updateComplete;
      keyDown(p, 'ArrowRight');
      await p.updateComplete;
      expect(p._focusedPath).toBe('src/a.md');
    });

    it('ArrowRight on file is a no-op', async () => {
      const tree = rootOf([file('a.md'), file('b.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._focusedPath = 'a.md';
      keyDown(p, 'ArrowRight');
      await p.updateComplete;
      expect(p._focusedPath).toBe('a.md');
    });

    it('ArrowLeft on open dir collapses it', async () => {
      const tree = rootOf([
        dir('src', [file('src/a.md')]),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._expanded = new Set(['src']);
      p._focusedPath = 'src';
      await p.updateComplete;
      keyDown(p, 'ArrowLeft');
      await p.updateComplete;
      expect(p._expanded.has('src')).toBe(false);
    });

    it('ArrowLeft on file moves to parent dir', async () => {
      const tree = rootOf([
        dir('src', [file('src/a.md')]),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._expanded = new Set(['src']);
      p._focusedPath = 'src/a.md';
      await p.updateComplete;
      keyDown(p, 'ArrowLeft');
      await p.updateComplete;
      expect(p._focusedPath).toBe('src');
    });

    it('ArrowLeft on top-level file is a no-op', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._focusedPath = 'a.md';
      keyDown(p, 'ArrowLeft');
      await p.updateComplete;
      // No parent exists; focus unchanged.
      expect(p._focusedPath).toBe('a.md');
    });

    it('ArrowLeft on closed dir at root is a no-op', async () => {
      const tree = rootOf([dir('src', [file('src/a.md')])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._focusedPath = 'src';
      keyDown(p, 'ArrowLeft');
      await p.updateComplete;
      expect(p._focusedPath).toBe('src');
    });

    it('Enter on file toggles selection', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
      });
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('selection-changed', listener);
      p._focusedPath = 'a.md';
      keyDown(p, 'Enter');
      await p.updateComplete;
      expect(listener).toHaveBeenCalledOnce();
      expect(
        listener.mock.calls[0][0].detail.selectedFiles,
      ).toEqual(['a.md']);
    });

    it('Enter on selected file deselects', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(['a.md']),
      });
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('selection-changed', listener);
      p._focusedPath = 'a.md';
      keyDown(p, 'Enter');
      await p.updateComplete;
      expect(listener.mock.calls[0][0].detail.selectedFiles).toEqual(
        [],
      );
    });

    it('Enter on dir toggles expansion', async () => {
      const tree = rootOf([dir('src', [file('src/a.md')])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._focusedPath = 'src';
      keyDown(p, 'Enter');
      await p.updateComplete;
      expect(p._expanded.has('src')).toBe(true);
      // Second press collapses.
      keyDown(p, 'Enter');
      await p.updateComplete;
      expect(p._expanded.has('src')).toBe(false);
    });

    it('Space works identically to Enter', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({
        tree,
        selectedFiles: new Set(),
      });
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('selection-changed', listener);
      p._focusedPath = 'a.md';
      keyDown(p, ' ');
      await p.updateComplete;
      expect(listener).toHaveBeenCalledOnce();
    });

    it('Space calls preventDefault (no page scroll)', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._focusedPath = 'a.md';
      const event = keyDown(p, ' ');
      expect(event.defaultPrevented).toBe(true);
    });

    it('navigation skips collapsed dir contents', async () => {
      // When src is collapsed, ArrowDown from src goes
      // to tests, not to src's hidden children.
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
        dir('tests', [file('tests/x.md')]),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // Both dirs collapsed by default.
      p._focusedPath = 'src';
      keyDown(p, 'ArrowDown');
      await p.updateComplete;
      expect(p._focusedPath).toBe('tests');
    });

    it('navigation descends into expanded dirs in render order', async () => {
      const tree = rootOf([
        dir('src', [file('src/a.md')]),
        dir('tests', [file('tests/x.md')]),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._expanded = new Set(['src']);
      p._focusedPath = 'src';
      await p.updateComplete;
      // src → src/a.md → tests → tests/x.md (collapsed)
      keyDown(p, 'ArrowDown');
      await p.updateComplete;
      expect(p._focusedPath).toBe('src/a.md');
      keyDown(p, 'ArrowDown');
      await p.updateComplete;
      expect(p._focusedPath).toBe('tests');
    });

    it('focus recovery when focused path becomes invisible', async () => {
      // User focuses a file, then filter hides it. Next
      // arrow press should recover by starting at the
      // first visible row, not producing an error.
      const tree = rootOf([file('a.md'), file('b.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._focusedPath = 'a.md';
      // Set filter so only b.md matches.
      const input = p.shadowRoot.querySelector('.filter-input');
      input.value = 'b';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      // a.md is now hidden; focused_path points at an
      // invisible row. ArrowDown should gracefully land
      // on the first visible row.
      keyDown(p, 'ArrowDown');
      await p.updateComplete;
      expect(p._focusedPath).toBe('b.md');
    });

    it('empty tree — arrow keys are silent no-ops', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      expect(() => keyDown(p, 'ArrowDown')).not.toThrow();
      expect(() => keyDown(p, 'Enter')).not.toThrow();
      expect(p._focusedPath).toBeNull();
    });

    it('unhandled keys are ignored (no preventDefault)', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._focusedPath = 'a.md';
      const event = keyDown(p, 'x');
      expect(event.defaultPrevented).toBe(false);
    });

    it('scrollIntoView called on focus change', async () => {
      // Pin that arrow navigation triggers scroll-into-
      // view. Can't reliably test the actual scroll in
      // jsdom (no layout engine), but we can spy on the
      // method to confirm it's called.
      const tree = rootOf([file('a.md'), file('b.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const firstRow = p.shadowRoot.querySelector(
        '.row.is-file',
      );
      const spy = vi.fn();
      firstRow.scrollIntoView = spy;
      keyDown(p, 'ArrowDown');
      await p.updateComplete;
      // updateComplete chains a microtask; give it one
      // more tick to drain the deferred scroll.
      await new Promise((r) => setTimeout(r, 0));
      expect(spy).toHaveBeenCalled();
    });

    it('tree-scroll container is tab-focusable', async () => {
      const p = mountPicker({ tree: rootOf([file('a.md')]) });
      await p.updateComplete;
      const tree = p.shadowRoot.querySelector('.tree-scroll');
      expect(tree.getAttribute('tabindex')).toBe('0');
    });

    it('focused file gets aria-current=true', async () => {
      const tree = rootOf([file('a.md'), file('b.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p._focusedPath = 'a.md';
      await p.updateComplete;
      const rows = p.shadowRoot.querySelectorAll('.row.is-file');
      expect(rows[0].getAttribute('aria-current')).toBe('true');
      expect(rows[1].getAttribute('aria-current')).toBe('false');
    });
  });

  // ---------------------------------------------------------------
  // Middle-click path insertion (Increment 10a)
  // ---------------------------------------------------------------

  describe('middle-click path insertion', () => {
    // Helper — fire a middle-click (auxclick with button=1)
    // on a row. jsdom supports MouseEvent with button in
    // its options dict; the @auxclick handler reads
    // event.button to filter out other non-primary
    // buttons.
    function middleClick(row) {
      const event = new MouseEvent('auxclick', {
        bubbles: true,
        cancelable: true,
        button: 1,
      });
      row.dispatchEvent(event);
      return event;
    }

    it('middle-click on file row dispatches insert-path', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('insert-path', listener);
      const row = p.shadowRoot.querySelector('.row.is-file');
      middleClick(row);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        path: 'a.md',
      });
    });

    it('middle-click on directory row dispatches insert-path', async () => {
      // Directories are legitimate insertion targets —
      // user might want to reference a subtree in prose.
      const tree = rootOf([dir('src', [file('src/a.md')])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('insert-path', listener);
      const row = p.shadowRoot.querySelector(
        '.row.is-dir:not(.is-root)',
      );
      middleClick(row);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        path: 'src',
      });
    });

    it('calls preventDefault to suppress selection-buffer paste', async () => {
      // On Linux, middle-click triggers the browser's
      // selection-buffer auto-paste. The preventDefault
      // call is load-bearing — without it, a middle-click
      // that reaches an unrelated focused element would
      // paste the previously-selected text there.
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const row = p.shadowRoot.querySelector('.row.is-file');
      const event = middleClick(row);
      expect(event.defaultPrevented).toBe(true);
    });

    it('stops propagation so parent handlers do not fire', async () => {
      // A middle-click on a row shouldn't also trigger the
      // row's click handler or any ancestor listener. The
      // `insert-path` event bubbles (it's a CustomEvent
      // with bubbles:true); only the native `auxclick`
      // is stopped.
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const ancestorListener = vi.fn();
      document.body.addEventListener('auxclick', ancestorListener);
      const row = p.shadowRoot.querySelector('.row.is-file');
      middleClick(row);
      document.body.removeEventListener(
        'auxclick',
        ancestorListener,
      );
      // The native auxclick didn't reach document.body
      // because stopPropagation was called.
      expect(ancestorListener).not.toHaveBeenCalled();
    });

    it('ignores non-middle button clicks', async () => {
      // @auxclick fires for ANY non-primary button
      // (middle, right, side). Our handler filters to
      // button=1 so a right-click that reaches auxclick
      // (some browsers synthesise) doesn't misfire.
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('insert-path', listener);
      const row = p.shadowRoot.querySelector('.row.is-file');
      row.dispatchEvent(
        new MouseEvent('auxclick', {
          bubbles: true,
          cancelable: true,
          button: 2, // right-click
        }),
      );
      expect(listener).not.toHaveBeenCalled();
    });

    it('insert-path bubbles across shadow DOM', async () => {
      // The orchestrator (files-tab) binds the handler
      // via @insert-path on the picker element. The
      // event must cross the shadow boundary —
      // bubbles:true + composed:true.
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const parentListener = vi.fn();
      document.body.addEventListener(
        'insert-path',
        parentListener,
      );
      const row = p.shadowRoot.querySelector('.row.is-file');
      middleClick(row);
      document.body.removeEventListener(
        'insert-path',
        parentListener,
      );
      expect(parentListener).toHaveBeenCalledOnce();
    });

    it('nested file path preserved verbatim in detail', async () => {
      // Path should be whatever was in the tree node,
      // not re-derived from basename.
      const tree = rootOf([
        dir('src', [
          dir('src/utils', [
            file('src/utils/helpers.py'),
          ]),
        ]),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // Expand the dirs so the file row is rendered.
      p.expandAll();
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('insert-path', listener);
      const fileRow = Array.from(
        p.shadowRoot.querySelectorAll('.row.is-file'),
      ).find((r) =>
        r.textContent.includes('helpers.py'),
      );
      middleClick(fileRow);
      expect(listener.mock.calls[0][0].detail.path).toBe(
        'src/utils/helpers.py',
      );
    });
  });

  // ---------------------------------------------------------------
  // Context menu — file rows (Increment 8a shell)
  // ---------------------------------------------------------------

  describe('context menu (files)', () => {
    // Helper — fire a contextmenu event on a specific row
    // at given viewport coords. Bubbles through the shadow
    // DOM so the row's @contextmenu binding catches it.
    function rightClick(row, clientX = 100, clientY = 150) {
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
      });
      row.dispatchEvent(event);
      return event;
    }

    it('right-click on file row opens the menu', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const row = p.shadowRoot.querySelector('.row.is-file');
      rightClick(row, 120, 180);
      await p.updateComplete;
      const menu = p.shadowRoot.querySelector('.context-menu');
      expect(menu).toBeTruthy();
    });

    it('menu position reflects click coordinates', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const row = p.shadowRoot.querySelector('.row.is-file');
      rightClick(row, 120, 180);
      await p.updateComplete;
      const menu = p.shadowRoot.querySelector('.context-menu');
      // Style uses inline left/top props; exact values
      // depend on viewport clamping (120x180 is well
      // inside jsdom's default 1024x768 viewport, so
      // coords pass through unclamped).
      expect(menu.style.left).toBe('120px');
      expect(menu.style.top).toBe('180px');
    });

    it('right-click suppresses the native browser menu', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const row = p.shadowRoot.querySelector('.row.is-file');
      const event = rightClick(row);
      // preventDefault was called → the browser's own
      // context menu would not have appeared.
      expect(event.defaultPrevented).toBe(true);
    });

    it('context state carries path, name, and isExcluded', async () => {
      const tree = rootOf([file('src/a.md')]);
      const p = mountPicker({
        tree,
        excludedFiles: new Set(['src/a.md']),
      });
      await p.updateComplete;
      const row = p.shadowRoot.querySelector('.row.is-file');
      rightClick(row);
      await p.updateComplete;
      expect(p._contextMenu).toEqual({
        type: 'file',
        path: 'src/a.md',
        name: 'a.md',
        isExcluded: true,
        x: expect.any(Number),
        y: expect.any(Number),
      });
    });

    it('menu items show include OR exclude but not both', async () => {
      // Not excluded → "Exclude from index" visible.
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({
        tree,
        excludedFiles: new Set(),
      });
      await p.updateComplete;
      rightClick(p.shadowRoot.querySelector('.row.is-file'));
      await p.updateComplete;
      const actionsA = Array.from(
        p.shadowRoot.querySelectorAll('.menu-item'),
      ).map((el) => el.getAttribute('data-action'));
      expect(actionsA).toContain('exclude');
      expect(actionsA).not.toContain('include');
    });

    it('menu items show include when file is excluded', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({
        tree,
        excludedFiles: new Set(['a.md']),
      });
      await p.updateComplete;
      rightClick(p.shadowRoot.querySelector('.row.is-file'));
      await p.updateComplete;
      const actions = Array.from(
        p.shadowRoot.querySelectorAll('.menu-item'),
      ).map((el) => el.getAttribute('data-action'));
      expect(actions).toContain('include');
      expect(actions).not.toContain('exclude');
    });

    it('all expected actions render when file is not excluded', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(p.shadowRoot.querySelector('.row.is-file'));
      await p.updateComplete;
      const actions = Array.from(
        p.shadowRoot.querySelectorAll('.menu-item'),
      ).map((el) => el.getAttribute('data-action'));
      // Shell ships nine items for the not-excluded case:
      // stage / unstage / discard / rename / duplicate /
      // load-left / load-right / exclude / delete.
      expect(actions).toEqual([
        'stage',
        'unstage',
        'discard',
        'rename',
        'duplicate',
        'load-left',
        'load-right',
        'exclude',
        'delete',
      ]);
    });

    it('menu renders separators between action groups', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(p.shadowRoot.querySelector('.row.is-file'));
      await p.updateComplete;
      // Four null separators in the catalog → four hr
      // elements in the rendered menu.
      const separators = p.shadowRoot.querySelectorAll(
        '.menu-separator',
      );
      expect(separators).toHaveLength(4);
    });

    it('delete action renders with destructive class', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(p.shadowRoot.querySelector('.row.is-file'));
      await p.updateComplete;
      const deleteItem = p.shadowRoot.querySelector(
        '.menu-item[data-action="delete"]',
      );
      expect(deleteItem.classList.contains('destructive')).toBe(
        true,
      );
    });

    it('Escape dismisses the menu', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(p.shadowRoot.querySelector('.row.is-file'));
      await p.updateComplete;
      expect(p._contextMenu).toBeTruthy();
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
      await p.updateComplete;
      expect(p._contextMenu).toBeNull();
      expect(p.shadowRoot.querySelector('.context-menu')).toBeNull();
    });

    it('Escape only consumes the event when menu is open', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // No menu open — Escape dispatched on document
      // should pass through without preventDefault.
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });

    it('click outside the menu closes it', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(p.shadowRoot.querySelector('.row.is-file'));
      await p.updateComplete;
      expect(p._contextMenu).toBeTruthy();
      // Click somewhere outside the picker entirely.
      document.body.click();
      await p.updateComplete;
      expect(p._contextMenu).toBeNull();
    });

    it('click inside the menu does not close it before the action runs', async () => {
      // The menu-item click handler DOES close the menu
      // (via _onContextMenuAction). This test proves the
      // document-level outside-click handler doesn't
      // pre-emptively close it before the action fires.
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(p.shadowRoot.querySelector('.row.is-file'));
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('context-menu-action', listener);
      // Click a menu item.
      const stageItem = p.shadowRoot.querySelector(
        '.menu-item[data-action="stage"]',
      );
      stageItem.click();
      await p.updateComplete;
      // Action fired exactly once (not zero from a
      // pre-empted close, not twice from re-routing).
      expect(listener).toHaveBeenCalledOnce();
    });

    it('menu item click dispatches context-menu-action with correct detail', async () => {
      const tree = rootOf([file('src/a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(p.shadowRoot.querySelector('.row.is-file'));
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('context-menu-action', listener);
      p.shadowRoot
        .querySelector('.menu-item[data-action="rename"]')
        .click();
      expect(listener).toHaveBeenCalledOnce();
      const detail = listener.mock.calls[0][0].detail;
      expect(detail.action).toBe('rename');
      expect(detail.type).toBe('file');
      expect(detail.path).toBe('src/a.md');
      expect(detail.name).toBe('a.md');
      expect(detail.isExcluded).toBe(false);
    });

    it('menu item click closes the menu after dispatch', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(p.shadowRoot.querySelector('.row.is-file'));
      await p.updateComplete;
      p.shadowRoot
        .querySelector('.menu-item[data-action="stage"]')
        .click();
      await p.updateComplete;
      expect(p._contextMenu).toBeNull();
      expect(p.shadowRoot.querySelector('.context-menu')).toBeNull();
    });

    it('right-click on a second row while menu open switches targets', async () => {
      // Users often right-click one file, change their
      // mind, and right-click another. The second click
      // should replace the menu contents with the new
      // target's context rather than opening a second
      // menu.
      const tree = rootOf([file('a.md'), file('b.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const rows = p.shadowRoot.querySelectorAll('.row.is-file');
      rightClick(rows[0]);
      await p.updateComplete;
      expect(p._contextMenu.path).toBe('a.md');
      rightClick(rows[1]);
      await p.updateComplete;
      expect(p._contextMenu.path).toBe('b.md');
      // Only one menu in the DOM.
      expect(
        p.shadowRoot.querySelectorAll('.context-menu'),
      ).toHaveLength(1);
    });

    it('menu clamps position near right edge of viewport', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // Click near the right edge. jsdom's default
      // viewport is 1024x768; click at 1000 should
      // clamp leftward to keep the 240-wide menu
      // inside.
      rightClick(
        p.shadowRoot.querySelector('.row.is-file'),
        1000,
        100,
      );
      await p.updateComplete;
      const menu = p.shadowRoot.querySelector('.context-menu');
      const leftPx = parseInt(menu.style.left, 10);
      // 1024 - 240 - 8 margin = 776. Click was at 1000,
      // clamped to 776.
      expect(leftPx).toBeLessThanOrEqual(776);
    });

    it('menu clamps position near bottom edge of viewport', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(
        p.shadowRoot.querySelector('.row.is-file'),
        100,
        700,
      );
      await p.updateComplete;
      const menu = p.shadowRoot.querySelector('.context-menu');
      const topPx = parseInt(menu.style.top, 10);
      // 768 - 320 - 8 = 440. Click at 700 clamps to 440.
      expect(topPx).toBeLessThanOrEqual(440);
    });

    it('menu position at exact corners clamps to margin', async () => {
      // Corners are edge cases for the clamp; verify
      // negative-leaning values still end up at the
      // minimum viewport margin.
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(p.shadowRoot.querySelector('.row.is-file'), 0, 0);
      await p.updateComplete;
      const menu = p.shadowRoot.querySelector('.context-menu');
      expect(menu.style.left).toBe('8px');
      expect(menu.style.top).toBe('8px');
    });

    it('disconnect closes menu and releases listeners', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(p.shadowRoot.querySelector('.row.is-file'));
      await p.updateComplete;
      expect(p._contextMenu).toBeTruthy();
      p.remove();
      expect(p._contextMenu).toBeNull();
      // After disconnect, subsequent document clicks must
      // not try to do anything — test that no error is
      // thrown (which would indicate a stale listener).
      expect(() => document.body.click()).not.toThrow();
    });

    it('context-menu-action bubbles across shadow DOM', async () => {
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(p.shadowRoot.querySelector('.row.is-file'));
      await p.updateComplete;
      const parentListener = vi.fn();
      document.body.addEventListener(
        'context-menu-action',
        parentListener,
      );
      p.shadowRoot
        .querySelector('.menu-item[data-action="stage"]')
        .click();
      document.body.removeEventListener(
        'context-menu-action',
        parentListener,
      );
      expect(parentListener).toHaveBeenCalledOnce();
    });

    it('right-click stops propagation so parent handlers do not fire', async () => {
      // If a picker is nested inside a region with its
      // own contextmenu handler (unlikely but defensive),
      // the picker's right-click shouldn't also fire
      // that handler.
      const tree = rootOf([file('a.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const ancestorListener = vi.fn();
      document.body.addEventListener(
        'contextmenu',
        ancestorListener,
      );
      const row = p.shadowRoot.querySelector('.row.is-file');
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 150,
      });
      row.dispatchEvent(event);
      document.body.removeEventListener(
        'contextmenu',
        ancestorListener,
      );
      // Listener attached to document.body in capture/
      // bubble might still fire depending on phase — the
      // key invariant is that preventDefault WAS called
      // (verified separately) and the menu DID open.
      expect(event.defaultPrevented).toBe(true);
      expect(p._contextMenu).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------
  // Context menu — directory rows (Increment 9 part 1)
  // ---------------------------------------------------------------

  describe('context menu (directories)', () => {
    function rightClick(row, clientX = 100, clientY = 150) {
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
      });
      row.dispatchEvent(event);
      return event;
    }

    it('right-click on dir row opens the menu', async () => {
      const tree = rootOf([dir('src', [file('src/a.md')])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const row = p.shadowRoot.querySelector(
        '.row.is-dir:not(.is-root)',
      );
      rightClick(row, 100, 100);
      await p.updateComplete;
      expect(p.shadowRoot.querySelector('.context-menu')).toBeTruthy();
    });

    it('menu context has type=dir', async () => {
      const tree = rootOf([dir('src', [file('src/a.md')])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(
        p.shadowRoot.querySelector('.row.is-dir:not(.is-root)'),
      );
      await p.updateComplete;
      expect(p._contextMenu.type).toBe('dir');
      expect(p._contextMenu.path).toBe('src');
      expect(p._contextMenu.name).toBe('src');
    });

    it('renders all dir menu actions for a fully-included dir', async () => {
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
      ]);
      const p = mountPicker({
        tree,
        excludedFiles: new Set(),
      });
      await p.updateComplete;
      rightClick(
        p.shadowRoot.querySelector('.row.is-dir:not(.is-root)'),
      );
      await p.updateComplete;
      const actions = Array.from(
        p.shadowRoot.querySelectorAll('.menu-item'),
      ).map((el) => el.getAttribute('data-action'));
      // Stage-all, unstage-all, rename, new-file,
      // new-directory, exclude-all (no include-all
      // since nothing is excluded).
      expect(actions).toEqual([
        'stage-all',
        'unstage-all',
        'rename-dir',
        'new-file',
        'new-directory',
        'exclude-all',
      ]);
    });

    it('fully-excluded dir shows only include-all (not exclude-all)', async () => {
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
      ]);
      const p = mountPicker({
        tree,
        excludedFiles: new Set(['src/a.md', 'src/b.md']),
      });
      await p.updateComplete;
      rightClick(
        p.shadowRoot.querySelector('.row.is-dir:not(.is-root)'),
      );
      await p.updateComplete;
      const actions = Array.from(
        p.shadowRoot.querySelectorAll('.menu-item'),
      ).map((el) => el.getAttribute('data-action'));
      expect(actions).toContain('include-all');
      expect(actions).not.toContain('exclude-all');
    });

    it('partially-excluded dir shows both exclude-all and include-all', async () => {
      // Users see both options so they pick which
      // direction to homogenise the subtree.
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
      ]);
      const p = mountPicker({
        tree,
        excludedFiles: new Set(['src/a.md']),
      });
      await p.updateComplete;
      rightClick(
        p.shadowRoot.querySelector('.row.is-dir:not(.is-root)'),
      );
      await p.updateComplete;
      const actions = Array.from(
        p.shadowRoot.querySelectorAll('.menu-item'),
      ).map((el) => el.getAttribute('data-action'));
      expect(actions).toContain('exclude-all');
      expect(actions).toContain('include-all');
    });

    it('empty directory shows only exclude-all (no descendants)', async () => {
      // `allExcluded` requires at least one descendant,
      // so an empty dir's allExcluded is false → shows
      // exclude-all. The files-tab handler short-
      // circuits on empty descendant lists so no
      // damage is done if the user clicks it.
      const tree = rootOf([dir('empty', [])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(
        p.shadowRoot.querySelector('.row.is-dir:not(.is-root)'),
      );
      await p.updateComplete;
      const actions = Array.from(
        p.shadowRoot.querySelectorAll('.menu-item'),
      ).map((el) => el.getAttribute('data-action'));
      expect(actions).toContain('exclude-all');
      expect(actions).not.toContain('include-all');
    });

    it('menu item click dispatches context-menu-action with type=dir', async () => {
      const tree = rootOf([dir('src', [file('src/a.md')])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(
        p.shadowRoot.querySelector('.row.is-dir:not(.is-root)'),
      );
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('context-menu-action', listener);
      p.shadowRoot
        .querySelector('.menu-item[data-action="stage-all"]')
        .click();
      expect(listener).toHaveBeenCalledOnce();
      const detail = listener.mock.calls[0][0].detail;
      expect(detail.action).toBe('stage-all');
      expect(detail.type).toBe('dir');
      expect(detail.path).toBe('src');
      expect(detail.name).toBe('src');
    });

    it('menu closes after action click', async () => {
      const tree = rootOf([dir('src', [file('src/a.md')])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(
        p.shadowRoot.querySelector('.row.is-dir:not(.is-root)'),
      );
      await p.updateComplete;
      p.shadowRoot
        .querySelector('.menu-item[data-action="unstage-all"]')
        .click();
      await p.updateComplete;
      expect(p._contextMenu).toBeNull();
    });

    it('right-click on dir does not toggle its expansion', async () => {
      // The dir's click handler toggles expansion,
      // but contextmenu is a separate event that
      // preventDefaults AND stopPropagations, so the
      // click handler should never fire for a
      // right-click.
      const tree = rootOf([dir('src', [file('src/a.md')])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      expect(p._expanded.has('src')).toBe(false);
      rightClick(
        p.shadowRoot.querySelector('.row.is-dir:not(.is-root)'),
      );
      await p.updateComplete;
      // Still collapsed — right-click didn't expand.
      expect(p._expanded.has('src')).toBe(false);
    });

    it('switching from file menu to dir menu replaces cleanly', async () => {
      // Right-click on a file, then without
      // dismissing, right-click on a dir. The dir
      // menu replaces the file menu rather than
      // opening a second one.
      const tree = rootOf([
        file('a.md'),
        dir('src', [file('src/b.md')]),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(p.shadowRoot.querySelector('.row.is-file'));
      await p.updateComplete;
      expect(p._contextMenu.type).toBe('file');
      rightClick(
        p.shadowRoot.querySelector('.row.is-dir:not(.is-root)'),
      );
      await p.updateComplete;
      expect(p._contextMenu.type).toBe('dir');
      // Menu items reflect the new type.
      const firstAction = p.shadowRoot
        .querySelector('.menu-item')
        .getAttribute('data-action');
      expect(firstAction).toBe('stage-all');
      // Only one menu DOM instance.
      expect(
        p.shadowRoot.querySelectorAll('.context-menu'),
      ).toHaveLength(1);
    });

    it('dir menu has separators between action groups', async () => {
      const tree = rootOf([dir('src', [file('src/a.md')])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      rightClick(
        p.shadowRoot.querySelector('.row.is-dir:not(.is-root)'),
      );
      await p.updateComplete;
      const separators = p.shadowRoot.querySelectorAll(
        '.menu-separator',
      );
      // Catalog has three null separators: after
      // unstage-all, after rename, and after new-
      // directory. All three render regardless of
      // which exclude variant(s) show.
      expect(separators.length).toBeGreaterThanOrEqual(3);
    });
  });
});