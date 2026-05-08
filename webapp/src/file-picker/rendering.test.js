// Tests for webapp/src/file-picker.js — rendering, expand/collapse,
// setTree, expand-state snapshot/restore, _focusedPath highlight,
// root row, branch pill, and tooltips.
//
// Extracted from the original file-picker.test.js. The other
// concerns (selection, exclusion, filter, sort, status, diff
// stats, keyboard, middle-click, context menu, review banner)
// live in sibling test files.
//
// The component module is loaded via test-helpers.js, which
// imports '../file-picker.js' for side effects.

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  dir,
  file,
  installCleanup,
  mountPicker,
  rootOf,
} from './test-helpers.js';

installCleanup();

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
});