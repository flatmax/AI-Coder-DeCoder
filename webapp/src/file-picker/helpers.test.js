// Tests for the pure helpers exported from
// webapp/src/file-picker.js — fuzzyMatch, sortChildren,
// sortChildrenWithMode, filterTree, computeFilterExpansions.
//
// These describe blocks were extracted verbatim from the
// original file-picker.test.js so the helper contracts stay
// pinned independently of the component's rendering tests.

import { afterEach, describe, expect, it } from 'vitest';

import {
  SORT_MODE_MTIME,
  SORT_MODE_NAME,
  SORT_MODE_SIZE,
  computeFilterExpansions,
  filterTree,
  fuzzyMatch,
  sortChildren,
  sortChildrenWithMode,
} from '../file-picker.js';
import { dir, file, installCleanup, rootOf } from './test-helpers.js';

installCleanup();

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