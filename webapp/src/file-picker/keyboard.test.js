// Tests for webapp/src/file-picker.js — keyboard navigation
// and middle-click path insertion.
//
// Extracted from file-picker.test.js to keep test files focused.
// Both groups operate on the FilePicker shadow DOM and dispatch
// synthetic keyboard / mouse events. The local helpers (keyDown,
// middleClick) are preserved verbatim inside their respective
// describes.

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
});