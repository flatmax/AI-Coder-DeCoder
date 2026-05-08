// Tests for status badges (M/S/U/D) and diff stats (+N -N)
// rendered by the FilePicker component.

import { afterEach, describe, expect, it } from 'vitest';

import {
  dir,
  file,
  installCleanup,
  mountPicker,
  rootOf,
} from './test-helpers.js';

installCleanup();

describe('FilePicker component', () => {
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
});