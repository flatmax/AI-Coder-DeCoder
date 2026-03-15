/**
 * Tests for file picker pure utility functions.
 */

import { describe, it, expect } from 'vitest';
import { fuzzyMatch, nodeMatchesFilter, relPath, lineColor, sortChildren } from '../file-picker-utils.js';

// ── fuzzyMatch ───────────────────────────────────────────────────

describe('fuzzyMatch', () => {
  it('empty query matches anything', () => {
    expect(fuzzyMatch('', 'src/main.py')).toBe(true);
  });

  it('exact match', () => {
    expect(fuzzyMatch('main.py', 'main.py')).toBe(true);
  });

  it('substring match', () => {
    expect(fuzzyMatch('main', 'src/main.py')).toBe(true);
  });

  it('fuzzy non-consecutive match', () => {
    expect(fuzzyMatch('edt', 'edit_parser.py')).toBe(true);
  });

  it('fuzzy across path separators', () => {
    expect(fuzzyMatch('sii', 'symbol_index/index.py')).toBe(true);
  });

  it('case insensitive', () => {
    expect(fuzzyMatch('README', 'readme.md')).toBe(true);
    expect(fuzzyMatch('readme', 'README.md')).toBe(true);
  });

  it('no match when chars missing', () => {
    expect(fuzzyMatch('xyz', 'main.py')).toBe(false);
  });

  it('no match when order wrong', () => {
    expect(fuzzyMatch('yx', 'xy')).toBe(false);
  });

  it('single char match', () => {
    expect(fuzzyMatch('m', 'main.py')).toBe(true);
  });

  it('single char no match', () => {
    expect(fuzzyMatch('z', 'main.py')).toBe(false);
  });
});

// ── nodeMatchesFilter ────────────────────────────────────────────

describe('nodeMatchesFilter', () => {
  it('empty query matches all nodes', () => {
    const node = { path: 'src/main.py', type: 'file' };
    expect(nodeMatchesFilter(node, '')).toBe(true);
  });

  it('file node matches directly', () => {
    const node = { path: 'src/main.py', type: 'file' };
    expect(nodeMatchesFilter(node, 'main')).toBe(true);
  });

  it('file node does not match', () => {
    const node = { path: 'src/main.py', type: 'file' };
    expect(nodeMatchesFilter(node, 'zzz')).toBe(false);
  });

  it('dir matches via descendant', () => {
    const node = {
      path: 'src', type: 'dir',
      children: [
        { path: 'src/main.py', type: 'file' },
        { path: 'src/utils.py', type: 'file' },
      ],
    };
    expect(nodeMatchesFilter(node, 'utils')).toBe(true);
  });

  it('dir does not match when no descendant matches', () => {
    const node = {
      path: 'src', type: 'dir',
      children: [
        { path: 'src/main.py', type: 'file' },
      ],
    };
    expect(nodeMatchesFilter(node, 'zzz')).toBe(false);
  });

  it('nested dir matches via deep descendant', () => {
    const node = {
      path: 'src', type: 'dir',
      children: [{
        path: 'src/deep', type: 'dir',
        children: [
          { path: 'src/deep/target.py', type: 'file' },
        ],
      }],
    };
    expect(nodeMatchesFilter(node, 'target')).toBe(true);
  });
});

// ── relPath ──────────────────────────────────────────────────────

describe('relPath', () => {
  it('strips repo name prefix', () => {
    expect(relPath('my-repo/src/main.py', 'my-repo')).toBe('src/main.py');
  });

  it('returns as-is when no prefix match', () => {
    expect(relPath('other/src/main.py', 'my-repo')).toBe('other/src/main.py');
  });

  it('handles root-level files', () => {
    expect(relPath('my-repo/README.md', 'my-repo')).toBe('README.md');
  });

  it('does not strip partial matches', () => {
    expect(relPath('my-repo-extra/file.py', 'my-repo')).toBe('my-repo-extra/file.py');
  });

  it('handles repo name same as path', () => {
    expect(relPath('my-repo', 'my-repo')).toBe('my-repo');
  });
});

// ── lineColor ────────────────────────────────────────────────────

describe('lineColor', () => {
  it('green for small files', () => {
    expect(lineColor(50)).toBe('var(--accent-green)');
    expect(lineColor(130)).toBe('var(--accent-green)');
  });

  it('orange for medium files', () => {
    expect(lineColor(131)).toBe('var(--accent-orange)');
    expect(lineColor(170)).toBe('var(--accent-orange)');
  });

  it('red for large files', () => {
    expect(lineColor(171)).toBe('var(--accent-red)');
    expect(lineColor(500)).toBe('var(--accent-red)');
  });
});

// ── sortChildren ─────────────────────────────────────────────────

describe('sortChildren', () => {
  it('directories before files', () => {
    const children = [
      { name: 'file.py', type: 'file' },
      { name: 'src', type: 'dir' },
    ];
    const sorted = sortChildren(children);
    expect(sorted[0].name).toBe('src');
    expect(sorted[1].name).toBe('file.py');
  });

  it('alphabetical within same type', () => {
    const children = [
      { name: 'zebra.py', type: 'file' },
      { name: 'alpha.py', type: 'file' },
      { name: 'middle.py', type: 'file' },
    ];
    const sorted = sortChildren(children);
    expect(sorted.map(c => c.name)).toEqual(['alpha.py', 'middle.py', 'zebra.py']);
  });

  it('dirs sorted alphabetically then files sorted alphabetically', () => {
    const children = [
      { name: 'b.py', type: 'file' },
      { name: 'z_dir', type: 'dir' },
      { name: 'a.py', type: 'file' },
      { name: 'a_dir', type: 'dir' },
    ];
    const sorted = sortChildren(children);
    expect(sorted.map(c => c.name)).toEqual(['a_dir', 'z_dir', 'a.py', 'b.py']);
  });

  it('does not mutate original array', () => {
    const children = [
      { name: 'b.py', type: 'file' },
      { name: 'a.py', type: 'file' },
    ];
    sortChildren(children);
    expect(children[0].name).toBe('b.py');
  });

  it('handles empty array', () => {
    expect(sortChildren([])).toEqual([]);
  });
});