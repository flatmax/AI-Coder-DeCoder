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
  computeFilterExpansions,
  filterTree,
  fuzzyMatch,
  sortChildren,
} from './file-picker.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal tree-node literal for tests.
 */
function file(path, lines = 0) {
  const parts = path.split('/');
  return {
    name: parts[parts.length - 1],
    path,
    type: 'file',
    lines,
    mtime: 0,
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
      // Two top-level rows rendered.
      const names = Array.from(
        p.shadowRoot.querySelectorAll('.name'),
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
      const names = Array.from(
        p.shadowRoot.querySelectorAll('.name'),
      ).map((el) => el.textContent);
      expect(names).toEqual(['src']);
    });

    it('toggles expansion on directory row click', async () => {
      const tree = rootOf([dir('src', [file('src/main.py')])]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const dirRow = p.shadowRoot.querySelector('.row.is-dir');
      dirRow.click();
      await p.updateComplete;
      // Now main.py is visible.
      const names = Array.from(
        p.shadowRoot.querySelectorAll('.name'),
      ).map((el) => el.textContent);
      expect(names).toEqual(['src', 'main.py']);
      // Click again — collapses.
      dirRow.click();
      await p.updateComplete;
      const namesAfter = Array.from(
        p.shadowRoot.querySelectorAll('.name'),
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
      // Initially fully collapsed.
      expect(
        p.shadowRoot.querySelectorAll('.name').length,
      ).toBe(1);
      // Type a filter — the matching file should be reachable
      // without the user manually expanding.
      const input = p.shadowRoot.querySelector('.filter-input');
      input.value = 'deep';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      const names = Array.from(
        p.shadowRoot.querySelectorAll('.name'),
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

  describe('setTree()', () => {
    it('replaces the current tree and re-renders', async () => {
      const p = mountPicker({ tree: rootOf([file('old.md')]) });
      await p.updateComplete;
      expect(
        p.shadowRoot.querySelector('.name').textContent,
      ).toBe('old.md');
      p.setTree(rootOf([file('new.md')]));
      await p.updateComplete;
      expect(
        p.shadowRoot.querySelector('.name').textContent,
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
});