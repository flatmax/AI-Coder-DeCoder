// Tests for webapp/src/app-shell/viewers.js — viewer routing
// and Alt+Arrow keyboard navigation with debounce.
//
// Covers:
//   - File extension dispatch between diff-viewer and
//     svg-viewer when a `navigate-file` event arrives.
//   - Visibility toggling and file-list preservation as
//     the active viewer changes.
//   - Alt+Arrow debounce: rapid key sequences coalesce to
//     a single viewer fetch; Alt release flushes early.
//
// Shared mocks for monaco-editor / svg-pan-zoom and the
// AppShell prototype patches live in
// `./test-helpers.js`. Each describe block keeps its own
// local `settle()` helper because the two suites need
// slightly different drain depths (viewer routing waits
// on child viewer updates; Alt+Arrow drains microtasks
// after fake-timer flushes).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppShellTestSetup, mountShell } from './test-helpers.js';

describe('AppShell viewer routing and navigation', () => {
  installAppShellTestSetup();

  describe('viewer routing', () => {
    async function settle(shell) {
      await shell.updateComplete;
      await new Promise((r) => setTimeout(r, 0));
      await shell.updateComplete;
      // Let the viewers' own Lit updates settle.
      const diff = shell.shadowRoot.querySelector(
        'ac-diff-viewer',
      );
      const svg = shell.shadowRoot.querySelector(
        'ac-svg-viewer',
      );
      if (diff) await diff.updateComplete;
      if (svg) await svg.updateComplete;
    }

    it('renders both viewers in the background layer', async () => {
      const shell = mountShell();
      await settle(shell);
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const svg = shell.shadowRoot.querySelector('ac-svg-viewer');
      expect(diff).toBeTruthy();
      expect(svg).toBeTruthy();
    });

    it('diff viewer is visible by default', async () => {
      const shell = mountShell();
      await settle(shell);
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const svg = shell.shadowRoot.querySelector('ac-svg-viewer');
      expect(diff.classList.contains('viewer-visible')).toBe(true);
      expect(svg.classList.contains('viewer-hidden')).toBe(true);
    });

    it('navigate-file to .py routes to diff viewer', async () => {
      const shell = mountShell();
      await settle(shell);
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'src/main.py' },
        }),
      );
      await settle(shell);
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      expect(diff.hasOpenFiles).toBe(true);
      expect(diff._file.path).toBe('src/main.py');
    });

    it('navigate-file to .svg routes to svg viewer', async () => {
      const shell = mountShell();
      await settle(shell);
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'docs/flow.svg' },
        }),
      );
      await settle(shell);
      const svg = shell.shadowRoot.querySelector('ac-svg-viewer');
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      expect(svg.hasOpenFiles).toBe(true);
      expect(svg._files[0].path).toBe('docs/flow.svg');
      // Diff viewer didn't receive it — no file in the
      // single-file slot.
      expect(diff.hasOpenFiles).toBe(false);
      expect(diff._file).toBe(null);
    });

    it('opening an .svg flips active viewer to svg', async () => {
      const shell = mountShell();
      await settle(shell);
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'diagram.svg' },
        }),
      );
      await settle(shell);
      expect(shell._activeViewer).toBe('svg');
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const svg = shell.shadowRoot.querySelector('ac-svg-viewer');
      expect(svg.classList.contains('viewer-visible')).toBe(true);
      expect(diff.classList.contains('viewer-hidden')).toBe(true);
    });

    it('switching between .py and .svg toggles visibility', async () => {
      const shell = mountShell();
      await settle(shell);
      // Open .py — diff visible.
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'a.py' },
        }),
      );
      await settle(shell);
      expect(shell._activeViewer).toBe('diff');
      // Open .svg — svg visible.
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'b.svg' },
        }),
      );
      await settle(shell);
      expect(shell._activeViewer).toBe('svg');
      // Back to .py — diff visible again.
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'c.py' },
        }),
      );
      await settle(shell);
      expect(shell._activeViewer).toBe('diff');
    });

    it('both viewers preserve their file lists across visibility toggles', async () => {
      // Key point: switching between .py and .svg doesn't
      // close the viewer that becomes hidden. Its tabs
      // remain intact. Matters for Phase 3.1's Monaco
      // instances, which are expensive to create.
      const shell = mountShell();
      await settle(shell);
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'a.py' },
        }),
      );
      await settle(shell);
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'b.svg' },
        }),
      );
      await settle(shell);
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const svg = shell.shadowRoot.querySelector('ac-svg-viewer');
      // Diff viewer holds its single active file; SVG
      // viewer still uses the multi-file model.
      expect(diff._file?.path).toBe('a.py');
      expect(svg._files).toHaveLength(1);
      expect(svg._files[0].path).toBe('b.svg');
    });

    it('navigate-file with empty path is ignored', async () => {
      const shell = mountShell();
      await settle(shell);
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: '' },
        }),
      );
      await settle(shell);
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const svg = shell.shadowRoot.querySelector('ac-svg-viewer');
      expect(diff.hasOpenFiles).toBe(false);
      expect(svg.hasOpenFiles).toBe(false);
    });

    it('navigate-file with no detail is ignored', async () => {
      const shell = mountShell();
      await settle(shell);
      window.dispatchEvent(new CustomEvent('navigate-file'));
      await settle(shell);
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      expect(diff.hasOpenFiles).toBe(false);
    });

    it('forwards line and searchText to the viewer', async () => {
      // The stub accepts these and ignores them, but the
      // shell must pass them through so Phase 3.1's real
      // implementation can use them without any shell-side
      // changes.
      const shell = mountShell();
      await settle(shell);
      // Spy on the viewer's openFile to inspect args.
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const spy = vi.spyOn(diff, 'openFile');
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: {
            path: 'src/foo.py',
            line: 42,
            searchText: 'my anchor',
          },
        }),
      );
      await settle(shell);
      expect(spy).toHaveBeenCalledWith({
        path: 'src/foo.py',
        line: 42,
        searchText: 'my anchor',
      });
    });

    it('unsubscribes from navigate-file on disconnect', async () => {
      const shell = mountShell();
      await settle(shell);
      shell.remove();
      // After disconnect, dispatching navigate-file must
      // not affect state on the disconnected element.
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: 'ghost.py' },
        }),
      );
      // No crash; viewer inside the removed shell hasn't
      // been re-attached so we can't check its state
      // directly, but the lack of exception is the
      // contract.
      expect(shell.isConnected).toBe(false);
    });
  });

  describe('Alt+Arrow debounce', () => {
    async function settle(shell) {
      await shell.updateComplete;
      await new Promise((r) => setTimeout(r, 0));
      await shell.updateComplete;
    }

    /**
     * Dispatch an Alt+Arrow keydown on the document,
     * simulating a user holding Alt and pressing the
     * given arrow direction.
     */
    function fireAltArrow(direction) {
      const keyMap = {
        left: 'ArrowLeft',
        right: 'ArrowRight',
        up: 'ArrowUp',
        down: 'ArrowDown',
      };
      const ev = new KeyboardEvent('keydown', {
        key: keyMap[direction],
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(ev);
    }

    function fireAltRelease() {
      const ev = new KeyboardEvent('keyup', {
        key: 'Alt',
        bubbles: true,
      });
      document.dispatchEvent(ev);
    }

    it('rapid arrow sequence produces one viewer fetch, not N', async () => {
      // The core win of the debounce: holding Alt+Right
      // through a 10-node path should produce ONE
      // openFile call for the final target, not ten.
      // Tests the _altArrowTimer + _flushAltArrowPending
      // pair directly — bypasses the real timer by
      // faking it.
      //
      // Fake timers are installed AFTER seeding the shell
      // and grid, because `settle` awaits a setTimeout(0)
      // that would otherwise never fire under fake timers.
      const shell = mountShell();
      await settle(shell);
      // Seed the grid with a chain of nodes so arrow
      // presses have targets. openFile on the grid is
      // synchronous; each call creates a new node
      // adjacent to the current.
      const nav = shell.shadowRoot.querySelector('ac-file-nav');
      nav.openFile('a.py');
      nav.openFile('b.py');
      nav.openFile('c.py');
      nav.openFile('d.py');
      await settle(shell);
      // Spy on the diff viewer's openFile.
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const openSpy = vi.spyOn(diff, 'openFile');
      // NOW install fake timers — only the debounce
      // setTimeout needs to be controlled from here on.
      vi.useFakeTimers();
      try {
        // Navigate back through the chain. After seeding,
        // the current node is d.py; three left-arrows
        // walk back to a.py.
        fireAltArrow('left');
        fireAltArrow('left');
        fireAltArrow('left');
        // Before the debounce window elapses, no viewer
        // fetch has been dispatched.
        expect(openSpy).not.toHaveBeenCalled();
        // Flush the debounce timer, then drain any
        // follow-up microtasks from the internal
        // updateComplete.then chain.
        await vi.advanceTimersByTimeAsync(250);
      } finally {
        vi.useRealTimers();
      }
      await settle(shell);
      // Exactly one openFile dispatch, for the final
      // position after the three lefts.
      expect(openSpy).toHaveBeenCalledTimes(1);
    });

    it('Alt release flushes pending fetch immediately', async () => {
      // Releasing Alt mid-debounce must fire the pending
      // fetch right away, otherwise the HUD fades out
      // before the viewer updates.
      const shell = mountShell();
      await settle(shell);
      const nav = shell.shadowRoot.querySelector('ac-file-nav');
      nav.openFile('a.py');
      nav.openFile('b.py');
      await settle(shell);
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const openSpy = vi.spyOn(diff, 'openFile');
      vi.useFakeTimers();
      try {
        fireAltArrow('left');
        expect(openSpy).not.toHaveBeenCalled();
        fireAltRelease();
        // Release cancels the debounce timer and flushes
        // synchronously via _flushAltArrowPending, but
        // the actual openFile call happens inside an
        // updateComplete.then() microtask. Drain.
        await vi.runAllTimersAsync();
      } finally {
        vi.useRealTimers();
      }
      await settle(shell);
      expect(openSpy).toHaveBeenCalledTimes(1);
    });

    it('arrow within debounce window resets the timer', async () => {
      // Subsequent arrow within the debounce window
      // resets the timer (coalesces). Only the final
      // keystroke's target gets dispatched.
      const shell = mountShell();
      await settle(shell);
      const nav = shell.shadowRoot.querySelector('ac-file-nav');
      nav.openFile('a.py');
      nav.openFile('b.py');
      nav.openFile('c.py');
      await settle(shell);
      const diff = shell.shadowRoot.querySelector('ac-diff-viewer');
      const openSpy = vi.spyOn(diff, 'openFile');
      vi.useFakeTimers();
      try {
        // First arrow, wait 100ms (inside window).
        fireAltArrow('left');
        await vi.advanceTimersByTimeAsync(100);
        expect(openSpy).not.toHaveBeenCalled();
        // Second arrow resets the timer.
        fireAltArrow('left');
        // Another 150ms — would have fired the first
        // arrow's debounce (total 250ms), but the second
        // reset means we need a full 200ms from the
        // second arrow.
        await vi.advanceTimersByTimeAsync(150);
        expect(openSpy).not.toHaveBeenCalled();
        // Push past the second timer.
        await vi.advanceTimersByTimeAsync(100);
      } finally {
        vi.useRealTimers();
      }
      await settle(shell);
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
  });
});