// Tests for review-mode banner and active-file highlight in
// webapp/src/file-picker.js, extracted from file-picker.test.js.
//
// Scope: the review-banner display logic (renders only when
// reviewState.active is true, surfaces branch / commit / file
// stats, dispatches exit-review) and the active-file highlight
// (single row gets the active-in-viewer class, coexists with
// selection and exclusion styling).

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  dir,
  file,
  installCleanup,
  mountPicker,
  rootOf,
} from './test-helpers.js';

installCleanup();

describe('FilePicker component', () => {
  describe('review mode banner', () => {
    /**
     * Build a valid reviewState shape matching what the
     * backend's `get_review_state()` returns. Tests override
     * individual fields; defaults cover the common case of
     * "3 commits, 5 files, +120 -40" stats.
     */
    function reviewStateFixture(overrides = {}) {
      return {
        active: true,
        branch: 'feature-auth',
        base_commit: 'abc1234',
        branch_tip: 'def5678',
        original_branch: 'main',
        commits: [
          {
            sha: 'def5678',
            short_sha: 'def5678',
            message: 'third',
            author: 'matt',
            date: '2024-01-03',
          },
          {
            sha: 'bcd2345',
            short_sha: 'bcd2345',
            message: 'second',
            author: 'matt',
            date: '2024-01-02',
          },
          {
            sha: 'abc1234',
            short_sha: 'abc1234',
            message: 'first',
            author: 'matt',
            date: '2024-01-01',
          },
        ],
        changed_files: [
          { path: 'a.md', additions: 50, deletions: 10, status: 'M' },
          { path: 'b.md', additions: 30, deletions: 20, status: 'M' },
        ],
        stats: {
          commit_count: 3,
          files_changed: 5,
          additions: 120,
          deletions: 40,
        },
        ...overrides,
      };
    }

    it('does not render banner when reviewState is null', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      // Default — no review state set.
      expect(p.shadowRoot.querySelector('.review-banner')).toBeNull();
    });

    it('does not render banner when active is false', async () => {
      // A stale state object from before review exit
      // might linger; active=false means "not currently
      // in review" and the banner should stay hidden.
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture({ active: false }),
      });
      await p.updateComplete;
      expect(p.shadowRoot.querySelector('.review-banner')).toBeNull();
    });

    it('renders banner when reviewState.active is true', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture(),
      });
      await p.updateComplete;
      const banner = p.shadowRoot.querySelector('.review-banner');
      expect(banner).toBeTruthy();
    });

    it('shows branch name in the banner title', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture({ branch: 'my-feature' }),
      });
      await p.updateComplete;
      const title = p.shadowRoot.querySelector(
        '.review-banner-title',
      );
      expect(title.textContent).toContain('my-feature');
    });

    it('shows commit count (plural)', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture(),
      });
      await p.updateComplete;
      const stats = p.shadowRoot.querySelector(
        '.review-banner-stats',
      );
      expect(stats.textContent).toContain('3 commits');
    });

    it('shows commit count (singular) for one commit', async () => {
      // Plural/singular is a small UX touch but worth
      // pinning — a grammar glitch in the banner would
      // be surprising mid-review.
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture({
          commits: [
            {
              sha: 'abc1234',
              short_sha: 'abc1234',
              message: 'only',
              author: 'matt',
              date: '2024-01-01',
            },
          ],
        }),
      });
      await p.updateComplete;
      const stats = p.shadowRoot.querySelector(
        '.review-banner-stats',
      );
      expect(stats.textContent).toContain('1 commit');
      // No "commits" (plural).
      expect(stats.textContent).not.toContain('1 commits');
    });

    it('shows files changed count', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture(),
      });
      await p.updateComplete;
      const stats = p.shadowRoot.querySelector(
        '.review-banner-stats',
      );
      expect(stats.textContent).toContain('5 files');
    });

    it('files label is singular for one file', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture({
          stats: {
            commit_count: 1,
            files_changed: 1,
            additions: 10,
            deletions: 5,
          },
        }),
      });
      await p.updateComplete;
      const stats = p.shadowRoot.querySelector(
        '.review-banner-stats',
      );
      expect(stats.textContent).toContain('1 file');
      expect(stats.textContent).not.toContain('1 files');
    });

    it('shows additions and deletions when non-zero', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture(),
      });
      await p.updateComplete;
      const added = p.shadowRoot.querySelector('.stat-added');
      const removed = p.shadowRoot.querySelector('.stat-removed');
      expect(added).toBeTruthy();
      expect(added.textContent).toContain('+120');
      expect(removed).toBeTruthy();
      expect(removed.textContent).toContain('-40');
    });

    it('omits additions when zero', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture({
          stats: {
            commit_count: 1,
            files_changed: 1,
            additions: 0,
            deletions: 5,
          },
        }),
      });
      await p.updateComplete;
      expect(p.shadowRoot.querySelector('.stat-added')).toBeNull();
      expect(p.shadowRoot.querySelector('.stat-removed')).toBeTruthy();
    });

    it('omits deletions when zero', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture({
          stats: {
            commit_count: 1,
            files_changed: 1,
            additions: 5,
            deletions: 0,
          },
        }),
      });
      await p.updateComplete;
      expect(p.shadowRoot.querySelector('.stat-added')).toBeTruthy();
      expect(p.shadowRoot.querySelector('.stat-removed')).toBeNull();
    });

    it('renders exit button', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture(),
      });
      await p.updateComplete;
      const exitBtn = p.shadowRoot.querySelector(
        '.review-banner-exit',
      );
      expect(exitBtn).toBeTruthy();
      expect(exitBtn.textContent.trim()).toBe('Exit');
    });

    it('clicking exit button dispatches exit-review event', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture(),
      });
      await p.updateComplete;
      const listener = vi.fn();
      p.addEventListener('exit-review', listener);
      p.shadowRoot.querySelector('.review-banner-exit').click();
      expect(listener).toHaveBeenCalledOnce();
    });

    it('exit-review event bubbles across the shadow boundary', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture(),
      });
      await p.updateComplete;
      const parentListener = vi.fn();
      document.body.addEventListener(
        'exit-review',
        parentListener,
      );
      try {
        p.shadowRoot.querySelector('.review-banner-exit').click();
        expect(parentListener).toHaveBeenCalledOnce();
      } finally {
        document.body.removeEventListener(
          'exit-review',
          parentListener,
        );
      }
    });

    it('banner sits above the filter bar', async () => {
      // Visual order matters — the banner should be the
      // first thing the user sees. Querying in DOM order
      // via children[0] pins this.
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture(),
      });
      await p.updateComplete;
      const children = Array.from(p.shadowRoot.children);
      // First non-comment, non-whitespace element is the banner.
      const firstEl = children.find(
        (el) => el.nodeType === Node.ELEMENT_NODE,
      );
      expect(firstEl.classList.contains('review-banner')).toBe(true);
    });

    it('tolerates missing commits array (defensive)', async () => {
      // A partial response shape from an older backend
      // or a future refactor shouldn't crash.
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture({ commits: undefined }),
      });
      await p.updateComplete;
      const stats = p.shadowRoot.querySelector(
        '.review-banner-stats',
      );
      // Commits treated as 0 (plural).
      expect(stats.textContent).toContain('0 commits');
    });

    it('tolerates missing stats object', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture({ stats: undefined }),
      });
      await p.updateComplete;
      const stats = p.shadowRoot.querySelector(
        '.review-banner-stats',
      );
      // Files, additions, deletions all treated as 0;
      // additions/deletions omitted at zero.
      expect(stats.textContent).toContain('0 files');
      expect(p.shadowRoot.querySelector('.stat-added')).toBeNull();
      expect(p.shadowRoot.querySelector('.stat-removed')).toBeNull();
    });

    it('tolerates missing branch name', async () => {
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture({ branch: undefined }),
      });
      await p.updateComplete;
      const title = p.shadowRoot.querySelector(
        '.review-banner-title',
      );
      // Fallback title when branch is missing.
      expect(title.textContent.trim()).toBe('Reviewing branch');
    });

    it('banner hides when reviewState is unset', async () => {
      // Lifecycle — enter review (banner shows), exit
      // (banner hides).
      const p = mountPicker({
        tree: rootOf([]),
        reviewState: reviewStateFixture(),
      });
      await p.updateComplete;
      expect(p.shadowRoot.querySelector('.review-banner')).toBeTruthy();
      p.reviewState = null;
      await p.updateComplete;
      expect(p.shadowRoot.querySelector('.review-banner')).toBeNull();
    });

    it('reviewState default is null', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      expect(p.reviewState).toBeNull();
    });
  });

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
});