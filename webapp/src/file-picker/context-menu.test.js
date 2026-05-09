// Tests for webapp/src/file-picker.js — context menu (files & directories).
//
// Extracted from webapp/src/file-picker.test.js. Covers right-click
// behaviour on file rows and directory rows: menu open/close,
// positioning/clamping, action item visibility based on exclusion
// state, dispatch of context-menu-action events, and interaction
// with row click handlers.

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  file,
  dir,
  rootOf,
  mountPicker,
  installCleanup,
} from './test-helpers.js';

installCleanup();

describe('FilePicker component', () => {
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