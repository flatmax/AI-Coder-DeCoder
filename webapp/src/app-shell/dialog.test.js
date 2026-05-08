// Tests for the AppShell dialog UI: state restoration from
// localStorage, minimize toggle, header-drag undocking, and
// edge/corner resize handles.
//
// jsdom doesn't simulate real pointer drag, but the handler
// logic is plain math against event coordinates and the
// dialog's bounding rect. Tests exercise the handlers
// directly with synthetic events and verify the committed
// state after pointerup.
//
// getBoundingClientRect returns zeros in jsdom since no
// layout happens. We stub it per-test to return the rect
// we want the handler to see.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppShellTestSetup, mountShell } from './test-helpers.js';

describe('AppShell dialog UI', () => {
  installAppShellTestSetup();

  describe('dialog persistence', () => {
    beforeEach(() => {
      localStorage.clear();
    });
    afterEach(() => {
      localStorage.clear();
    });

    it('starts with default state when localStorage is empty', () => {
      const shell = mountShell();
      expect(shell.activeTab).toBe('files');
      expect(shell._minimized).toBe(false);
      expect(shell._dockedWidth).toBe(null);
      expect(shell._undockedPos).toBe(null);
    });

    it('restores active tab from localStorage', () => {
      localStorage.setItem('ac-dc-active-tab', 'settings');
      const shell = mountShell();
      expect(shell.activeTab).toBe('settings');
    });

    it('migrates stale "search" tab preference to "files"', () => {
      // The 'search' tab was removed when file search was
      // integrated into the Files tab. Stored preferences
      // from older builds must not leave the user on an
      // empty tab.
      localStorage.setItem('ac-dc-active-tab', 'search');
      const shell = mountShell();
      expect(shell.activeTab).toBe('files');
    });

    it('ignores unknown tab values', () => {
      localStorage.setItem('ac-dc-active-tab', 'bogus');
      const shell = mountShell();
      expect(shell.activeTab).toBe('files');
    });

    it('restores minimized state', () => {
      localStorage.setItem('ac-dc-minimized', 'true');
      const shell = mountShell();
      expect(shell._minimized).toBe(true);
    });

    it('restores docked width when valid', () => {
      localStorage.setItem('ac-dc-dialog-width', '600');
      const shell = mountShell();
      expect(shell._dockedWidth).toBe(600);
    });

    it('rejects docked width below the minimum', () => {
      localStorage.setItem('ac-dc-dialog-width', '50');
      const shell = mountShell();
      expect(shell._dockedWidth).toBe(null);
    });

    it('rejects non-numeric docked width', () => {
      localStorage.setItem('ac-dc-dialog-width', 'wide');
      const shell = mountShell();
      expect(shell._dockedWidth).toBe(null);
    });

    it('restores undocked rect when within viewport', () => {
      const rect = { left: 100, top: 50, width: 600, height: 400 };
      localStorage.setItem('ac-dc-dialog-pos', JSON.stringify(rect));
      const shell = mountShell();
      expect(shell._undockedPos).toEqual(rect);
    });

    it('rejects undocked rect when stranded off-screen', () => {
      // left is 10000 — well beyond any viewport in jsdom.
      // Bounds check should reject and fall back to docked.
      const rect = { left: 10000, top: 0, width: 600, height: 400 };
      localStorage.setItem('ac-dc-dialog-pos', JSON.stringify(rect));
      const shell = mountShell();
      expect(shell._undockedPos).toBe(null);
    });

    it('rejects undocked rect with sub-minimum size', () => {
      const rect = { left: 0, top: 0, width: 100, height: 400 };
      localStorage.setItem('ac-dc-dialog-pos', JSON.stringify(rect));
      const shell = mountShell();
      expect(shell._undockedPos).toBe(null);
    });

    it('rejects undocked rect with malformed JSON', () => {
      localStorage.setItem('ac-dc-dialog-pos', '{not json');
      const shell = mountShell();
      expect(shell._undockedPos).toBe(null);
    });

    it('_switchTab persists the new active tab', () => {
      const shell = mountShell();
      shell._switchTab('context');
      expect(localStorage.getItem('ac-dc-active-tab'))
        .toBe('context');
    });
  });

  describe('dialog minimize', () => {
    beforeEach(() => { localStorage.clear(); });
    afterEach(() => { localStorage.clear(); });

    it('_toggleMinimize flips state and persists', () => {
      const shell = mountShell();
      expect(shell._minimized).toBe(false);
      shell._toggleMinimize();
      expect(shell._minimized).toBe(true);
      expect(localStorage.getItem('ac-dc-minimized')).toBe('true');
      shell._toggleMinimize();
      expect(shell._minimized).toBe(false);
      expect(localStorage.getItem('ac-dc-minimized')).toBe('false');
    });

    it('renders minimized class when state is minimized', async () => {
      const shell = mountShell();
      shell._minimized = true;
      await shell.updateComplete;
      const dialog = shell.shadowRoot.querySelector('.dialog');
      expect(dialog.classList.contains('minimized')).toBe(true);
    });
  });

  describe('dialog drag', () => {
    beforeEach(() => { localStorage.clear(); });
    afterEach(() => { localStorage.clear(); });

    /**
     * Stub getBoundingClientRect on the dialog element so
     * handlers see the rect we want. jsdom returns all
     * zeros otherwise since no layout runs.
     */
    function stubRect(shell, rect) {
      const dialog = shell.shadowRoot.querySelector('.dialog');
      dialog.getBoundingClientRect = () => ({
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left, y: rect.top,
        toJSON() {},
      });
      return dialog;
    }

    it('ignores clicks on buttons inside the header', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      stubRect(shell, { left: 0, top: 0, width: 500, height: 800 });
      const button = shell.shadowRoot.querySelector('.tab-button');
      // Synthesize a pointerdown whose target is the button.
      shell._onHeaderPointerDown({
        button: 0,
        target: button,
        clientX: 10,
        clientY: 10,
      });
      expect(shell._drag).toBe(null);
    });

    it('ignores non-primary button', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      stubRect(shell, { left: 0, top: 0, width: 500, height: 800 });
      const header = shell.shadowRoot.querySelector('.dialog-header');
      shell._onHeaderPointerDown({
        button: 2,  // right-click
        target: header,
        clientX: 10, clientY: 10,
      });
      expect(shell._drag).toBe(null);
    });

    it('starts drag on header pointerdown (not on button)', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      stubRect(shell, { left: 0, top: 0, width: 500, height: 800 });
      const header = shell.shadowRoot.querySelector('.dialog-header');
      shell._onHeaderPointerDown({
        button: 0,
        target: header,
        clientX: 100,
        clientY: 20,
      });
      expect(shell._drag).toBeTruthy();
      expect(shell._drag.mode).toBe('drag');
      expect(shell._drag.startX).toBe(100);
      expect(shell._drag.originWidth).toBe(500);
    });

    it('below-threshold drag does not commit undock', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      stubRect(shell, { left: 0, top: 0, width: 500, height: 800 });
      const header = shell.shadowRoot.querySelector('.dialog-header');
      shell._onHeaderPointerDown({
        button: 0, target: header,
        clientX: 100, clientY: 20,
      });
      // Move 2px — under the 5px threshold.
      shell._onPointerMove({ clientX: 102, clientY: 21 });
      shell._onPointerUp();
      expect(shell._undockedPos).toBe(null);
    });

    it('above-threshold drag commits undocked position', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      const dialog = stubRect(
        shell, { left: 0, top: 0, width: 500, height: 800 },
      );
      const header = shell.shadowRoot.querySelector('.dialog-header');
      shell._onHeaderPointerDown({
        button: 0, target: header,
        clientX: 100, clientY: 20,
      });
      // Move well past threshold.
      shell._onPointerMove({ clientX: 150, clientY: 70 });
      // Stub the post-move rect to reflect the inline-style
      // changes that _onPointerMove applied. In the real
      // browser the rect recomputes on reflow; in jsdom we
      // fake it.
      dialog.getBoundingClientRect = () => ({
        left: 50, top: 50, width: 500, height: 800,
        right: 550, bottom: 850, x: 50, y: 50,
        toJSON() {},
      });
      shell._onPointerUp();
      expect(shell._undockedPos).toEqual({
        left: 50, top: 50, width: 500, height: 800,
      });
      expect(localStorage.getItem('ac-dc-dialog-pos')).toBeTruthy();
    });

    it('cleans up document listeners after pointerup', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      stubRect(shell, { left: 0, top: 0, width: 500, height: 800 });
      const header = shell.shadowRoot.querySelector('.dialog-header');
      const removeSpy = vi.spyOn(document, 'removeEventListener');
      shell._onHeaderPointerDown({
        button: 0, target: header,
        clientX: 100, clientY: 20,
      });
      shell._onPointerUp();
      // Both pointermove and pointerup listeners removed.
      const calls = removeSpy.mock.calls.map((c) => c[0]);
      expect(calls).toContain('pointermove');
      expect(calls).toContain('pointerup');
      removeSpy.mockRestore();
    });
  });

  describe('dialog resize', () => {
    beforeEach(() => { localStorage.clear(); });
    afterEach(() => { localStorage.clear(); });

    function stubRect(shell, rect) {
      const dialog = shell.shadowRoot.querySelector('.dialog');
      dialog.getBoundingClientRect = () => ({
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left, y: rect.top,
        toJSON() {},
      });
      return dialog;
    }

    it('right-handle resize from docked saves docked width', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      const dialog = stubRect(
        shell, { left: 0, top: 0, width: 500, height: 800 },
      );
      shell._onHandlePointerDown(
        { button: 0, clientX: 500, clientY: 400,
          stopPropagation() {} },
        'right',
      );
      shell._onPointerMove({ clientX: 650, clientY: 400 });
      dialog.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 650, height: 800,
        right: 650, bottom: 800, x: 0, y: 0, toJSON() {},
      });
      shell._onPointerUp();
      expect(shell._dockedWidth).toBe(650);
      expect(shell._undockedPos).toBe(null);
      expect(localStorage.getItem('ac-dc-dialog-width')).toBe('650');
    });

    it('bottom-handle resize auto-undocks', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      const dialog = stubRect(
        shell, { left: 0, top: 0, width: 500, height: 800 },
      );
      shell._onHandlePointerDown(
        { button: 0, clientX: 250, clientY: 800,
          stopPropagation() {} },
        'bottom',
      );
      shell._onPointerMove({ clientX: 250, clientY: 600 });
      dialog.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 500, height: 600,
        right: 500, bottom: 600, x: 0, y: 0, toJSON() {},
      });
      shell._onPointerUp();
      expect(shell._undockedPos).toEqual({
        left: 0, top: 0, width: 500, height: 600,
      });
    });

    it('corner-handle resize changes width and height', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      const dialog = stubRect(
        shell, { left: 0, top: 0, width: 500, height: 800 },
      );
      shell._onHandlePointerDown(
        { button: 0, clientX: 500, clientY: 800,
          stopPropagation() {} },
        'corner',
      );
      shell._onPointerMove({ clientX: 600, clientY: 700 });
      dialog.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 600, height: 700,
        right: 600, bottom: 700, x: 0, y: 0, toJSON() {},
      });
      shell._onPointerUp();
      expect(shell._undockedPos.width).toBe(600);
      expect(shell._undockedPos.height).toBe(700);
    });

    it('right-handle resize respects minimum width', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      const dialog = stubRect(
        shell, { left: 0, top: 0, width: 500, height: 800 },
      );
      shell._onHandlePointerDown(
        { button: 0, clientX: 500, clientY: 400,
          stopPropagation() {} },
        'right',
      );
      // Drag far left — would make the dialog 0-width or
      // negative. Handler must clamp at _DIALOG_MIN_WIDTH.
      shell._onPointerMove({ clientX: 100, clientY: 400 });
      const styleWidth = parseFloat(dialog.style.width);
      expect(styleWidth).toBeGreaterThanOrEqual(300);
    });

    it('bottom-handle respects minimum height', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      const dialog = stubRect(
        shell, { left: 0, top: 0, width: 500, height: 800 },
      );
      shell._onHandlePointerDown(
        { button: 0, clientX: 250, clientY: 800,
          stopPropagation() {} },
        'bottom',
      );
      shell._onPointerMove({ clientX: 250, clientY: 0 });
      const styleHeight = parseFloat(dialog.style.height);
      expect(styleHeight).toBeGreaterThanOrEqual(200);
    });

    it('schedules viewer relayout on every resize pointermove frame', async () => {
      // Resizing the dialog changes the visible area of
      // the viewer behind it. Monaco caches layout;
      // the SVG viewer's editors don't auto-refit. Each
      // resize pointermove must schedule a viewer
      // relayout, RAF-throttled so rapid events coalesce.
      vi.useFakeTimers({
        toFake: [
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'requestAnimationFrame',
          'cancelAnimationFrame',
        ],
      });
      const shell = mountShell();
      await shell.updateComplete;
      stubRect(shell, { left: 0, top: 0, width: 500, height: 800 });
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const svg = shell.shadowRoot.querySelector('ac-svg-viewer');
      const diffRelayout = vi.spyOn(diff, 'relayout');
      const svgRelayout = vi.spyOn(svg, 'relayout');
      shell._onHandlePointerDown(
        { button: 0, clientX: 500, clientY: 400,
          stopPropagation() {} },
        'right',
      );
      // Simulate 5 rapid pointermoves within one frame.
      for (let i = 0; i < 5; i += 1) {
        shell._onPointerMove({
          clientX: 500 + (i * 10), clientY: 400,
        });
      }
      // No relayout yet — RAF hasn't fired.
      expect(diffRelayout).not.toHaveBeenCalled();
      expect(svgRelayout).not.toHaveBeenCalled();
      // Flush one frame — the 5 moves coalesce to a
      // single relayout on each viewer.
      vi.runAllTimers();
      expect(diffRelayout).toHaveBeenCalledTimes(1);
      expect(svgRelayout).toHaveBeenCalledTimes(1);
      diffRelayout.mockRestore();
      svgRelayout.mockRestore();
    });
  });
});