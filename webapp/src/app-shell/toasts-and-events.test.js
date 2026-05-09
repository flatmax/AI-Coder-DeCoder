// Tests for webapp/src/app-shell/index.js — toast layer,
// server-push callbacks, tab switching, and the one-shot
// enrichment-unavailable warning toast.
//
// Covers:
//   - Toast layer (event subscription, auto-dismiss, defaults,
//     unsubscribe on disconnect)
//   - Server-push callbacks (streamChunk, streamComplete,
//     navigateFile, filesChanged) dispatching window events
//   - Tab switching via _switchTab
//   - Enrichment-unavailable one-shot warning toast, including
//     localStorage suppression across reloads and tolerance for
//     storage errors
//
// Test infrastructure (monaco/svg-pan-zoom mocks, JRPCClient
// stub, prototype patches for child-tab RPCs) lives in
// ./test-helpers.js. installAppShellTestSetup() registers the
// beforeEach/afterEach pair that every AppShell test file needs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppShellTestSetup, mountShell } from './test-helpers.js';

describe('AppShell events and toasts', () => {
  installAppShellTestSetup();

  describe('toast system', () => {
    it('dispatches window event → shows toast', async () => {
      const shell = mountShell();
      window.dispatchEvent(new CustomEvent('ac-toast', {
        detail: { message: 'File saved', type: 'success' },
      }));
      await shell.updateComplete;
      expect(shell.toasts.length).toBe(1);
      expect(shell.toasts[0].message).toBe('File saved');
      expect(shell.toasts[0].type).toBe('success');
    });

    it('auto-dismisses after 3 seconds', () => {
      vi.useFakeTimers();
      const shell = mountShell();
      shell._showToast('Hi', 'info');
      expect(shell.toasts.length).toBe(1);
      vi.advanceTimersByTime(2999);
      expect(shell.toasts.length).toBe(1);
      vi.advanceTimersByTime(2);
      expect(shell.toasts.length).toBe(0);
    });

    it('ignores events with no message', async () => {
      const shell = mountShell();
      window.dispatchEvent(new CustomEvent('ac-toast', { detail: {} }));
      await shell.updateComplete;
      expect(shell.toasts.length).toBe(0);
    });

    it('defaults type to info when not specified', () => {
      const shell = mountShell();
      window.dispatchEvent(new CustomEvent('ac-toast', {
        detail: { message: 'No type here' },
      }));
      expect(shell.toasts[0].type).toBe('info');
    });

    it('unsubscribes from toast events on disconnect', () => {
      const shell = mountShell();
      shell.remove();
      window.dispatchEvent(new CustomEvent('ac-toast', {
        detail: { message: 'Should not appear' },
      }));
      // Element was removed, so its internal state is gone.
      // This test just confirms the removal doesn't error.
      expect(shell.toasts.length).toBe(0);
    });
  });

  describe('server-push callbacks', () => {
    it('streamChunk dispatches window event', () => {
      const shell = mountShell();
      const listener = vi.fn();
      window.addEventListener('stream-chunk', listener);
      shell.streamChunk('req-1', 'hello');
      expect(listener).toHaveBeenCalledOnce();
      const event = listener.mock.calls[0][0];
      expect(event.detail).toEqual({
        requestId: 'req-1',
        content: 'hello',
      });
      window.removeEventListener('stream-chunk', listener);
    });

    it('streamComplete dispatches window event', () => {
      const shell = mountShell();
      const listener = vi.fn();
      window.addEventListener('stream-complete', listener);
      shell.streamComplete('req-1', { response: 'ok' });
      expect(listener).toHaveBeenCalledOnce();
      window.removeEventListener('stream-complete', listener);
    });

    it('navigateFile flags remote origin', () => {
      // Collaboration echo-prevention — remote-originated
      // navigation must be distinguishable from local.
      const shell = mountShell();
      const listener = vi.fn();
      window.addEventListener('navigate-file', listener);
      shell.navigateFile({ path: 'src/foo.py' });
      const event = listener.mock.calls[0][0];
      expect(event.detail._remote).toBe(true);
      expect(event.detail.path).toBe('src/foo.py');
      window.removeEventListener('navigate-file', listener);
    });

    it('filesChanged dispatches window event with selected files', () => {
      const shell = mountShell();
      const listener = vi.fn();
      window.addEventListener('files-changed', listener);
      shell.filesChanged(['a.md', 'b.md']);
      const event = listener.mock.calls[0][0];
      expect(event.detail.selectedFiles).toEqual(['a.md', 'b.md']);
      window.removeEventListener('files-changed', listener);
    });

    it('callbacks return true for jrpc-oo ack', () => {
      const shell = mountShell();
      expect(shell.streamChunk('r', 'c')).toBe(true);
      expect(shell.streamComplete('r', {})).toBe(true);
      expect(shell.filesChanged([])).toBe(true);
    });
  });

  describe('tab switching', () => {
    it('changes activeTab via _switchTab', () => {
      const shell = mountShell();
      shell._switchTab('context');
      expect(shell.activeTab).toBe('context');
      shell._switchTab('settings');
      expect(shell.activeTab).toBe('settings');
    });
  });

  // ---------------------------------------------------------------
  // Enrichment unavailable — one-shot toast
  // ---------------------------------------------------------------
  //
  // When the backend reports
  // `enrichment_status === "unavailable"` (KeyBERT probe failed
  // or model load failed), the shell shows a one-shot warning
  // toast pointing users at `pip install 'ac-dc[docs]'`. The
  // toast fires from two places:
  //
  //   - `_fetchCurrentState` — initial state snapshot on
  //     connect / reconnect.
  //   - `_onModeChanged` — mid-session modeChanged broadcast
  //     when the backend transitions to unavailable after
  //     startup.
  //
  // Suppressed after first display via a localStorage flag,
  // which persists across reloads. The condition is effectively
  // permanent for the session — repeated toasts would be noise.

  describe('enrichment unavailable toast', () => {
    const STORAGE_KEY = 'ac-dc-enrichment-unavailable-shown';

    beforeEach(() => {
      localStorage.clear();
    });
    afterEach(() => {
      localStorage.clear();
    });

    it('fires on modeChanged with unavailable status', () => {
      const shell = mountShell();
      shell._onModeChanged({
        detail: {
          mode: 'code',
          cross_ref_enabled: false,
          enrichment_status: 'unavailable',
        },
      });
      expect(shell.toasts.length).toBe(1);
      expect(shell.toasts[0].type).toBe('warning');
      expect(shell.toasts[0].message)
        .toContain('ac-dc[docs]');
    });

    it('does not fire for other enrichment_status values', () => {
      const shell = mountShell();
      for (const status of ['pending', 'building', 'ready']) {
        shell._onModeChanged({
          detail: {
            mode: 'code',
            cross_ref_enabled: false,
            enrichment_status: status,
          },
        });
      }
      expect(shell.toasts.length).toBe(0);
    });

    it('does not fire when enrichment_status field is absent', () => {
      // Older backends omit the field entirely. The handler
      // must silently pass — no toast, no exception.
      const shell = mountShell();
      shell._onModeChanged({
        detail: { mode: 'code', cross_ref_enabled: false },
      });
      expect(shell.toasts.length).toBe(0);
    });

    it('sets localStorage suppression flag after first fire', () => {
      const shell = mountShell();
      shell._onModeChanged({
        detail: { enrichment_status: 'unavailable' },
      });
      expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    });

    it('suppresses repeats within a session', () => {
      const shell = mountShell();
      // First broadcast — toast appears.
      shell._onModeChanged({
        detail: { enrichment_status: 'unavailable' },
      });
      expect(shell.toasts.length).toBe(1);
      // Second broadcast — no new toast.
      shell._onModeChanged({
        detail: { enrichment_status: 'unavailable' },
      });
      expect(shell.toasts.length).toBe(1);
    });

    it('suppresses repeats across reloads via localStorage', () => {
      // Simulate a prior session that already showed the toast.
      localStorage.setItem(STORAGE_KEY, 'true');
      const shell = mountShell();
      shell._onModeChanged({
        detail: { enrichment_status: 'unavailable' },
      });
      expect(shell.toasts.length).toBe(0);
    });

    it('direct helper call matches the event-driven path', () => {
      const shell = mountShell();
      shell._maybeShowEnrichmentUnavailableToast('unavailable');
      expect(shell.toasts.length).toBe(1);
      expect(shell.toasts[0].type).toBe('warning');
    });

    it('direct helper no-ops for non-unavailable values', () => {
      const shell = mountShell();
      shell._maybeShowEnrichmentUnavailableToast('pending');
      shell._maybeShowEnrichmentUnavailableToast('building');
      shell._maybeShowEnrichmentUnavailableToast('ready');
      shell._maybeShowEnrichmentUnavailableToast(undefined);
      shell._maybeShowEnrichmentUnavailableToast(null);
      expect(shell.toasts.length).toBe(0);
    });

    it('preserves other modeChanged side effects', () => {
      // The enrichment-status check must not interfere with
      // mode and cross-ref handling. A single event carrying
      // all three fields should update mode state AND fire
      // the toast.
      const shell = mountShell();
      shell._mode = 'code';
      shell._crossRefEnabled = false;
      shell._onModeChanged({
        detail: {
          mode: 'doc',
          cross_ref_enabled: true,
          enrichment_status: 'unavailable',
        },
      });
      expect(shell._mode).toBe('doc');
      // cross_ref_enabled resets to false on mode change,
      // then gets set from the payload's value.
      expect(shell._crossRefEnabled).toBe(true);
      expect(shell.toasts.length).toBe(1);
    });

    it('survives localStorage errors on read', () => {
      // Private-browsing modes can throw on getItem. The
      // helper must swallow and proceed — one duplicate
      // toast across reloads is better than failing silently.
      const shell = mountShell();
      const origGet = Storage.prototype.getItem;
      Storage.prototype.getItem = () => {
        throw new Error('quota');
      };
      try {
        shell._maybeShowEnrichmentUnavailableToast('unavailable');
        expect(shell.toasts.length).toBe(1);
      } finally {
        Storage.prototype.getItem = origGet;
      }
    });

    it('survives localStorage errors on write', () => {
      const shell = mountShell();
      const origSet = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new Error('quota');
      };
      try {
        shell._maybeShowEnrichmentUnavailableToast('unavailable');
        // Toast still displayed even though persistence failed.
        expect(shell.toasts.length).toBe(1);
      } finally {
        Storage.prototype.setItem = origSet;
      }
    });
  });
});