// Tests for webapp/src/file-picker.js — file selection, directory
// checkbox, three-state exclusion, and event bubbling.
//
// Extracted from file-picker.test.js to keep the suite focused.

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