// Tests for webapp/src/app-shell.js — connection lifecycle.
//
// Covers the connection state machine and its visible
// effects on the UI:
//
//   - SharedRpc publishing on setupDone (and clearing on
//     remoteDisconnected) so child components can begin /
//     must stop making RPC calls.
//   - Startup overlay state machine: initial connecting
//     state, progress updates driving percent and stage,
//     ready transition fading the overlay out.
//   - Reconnect scheduling with exponential backoff after
//     the first successful connect.
//
// Shared test scaffolding lives in
// `webapp/src/app-shell/test-helpers.js` — the monaco /
// svg-pan-zoom mocks, the `mountShell` factory, and the
// `installAppShellTestSetup` hook that wires up the
// per-test prototype patches and cleanup.

import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  installAppShellTestSetup, mountShell, SharedRpc,
} from './test-helpers.js';

describe('AppShell connection lifecycle', () => {
  installAppShellTestSetup();

  describe('initial state', () => {
    it('starts in connecting state with overlay visible', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      expect(shell.connectionState).toBe('connecting');
      expect(shell.overlayVisible).toBe(true);
      expect(shell.startupPercent).toBe(0);
    });

    it('defaults to files tab', async () => {
      const shell = mountShell();
      await shell.updateComplete;
      expect(shell.activeTab).toBe('files');
    });
  });

  describe('setupDone', () => {
    // TODO(phase-2d): files-tab silencing — delete this
    // beforeEach/afterEach pair when Phase 2d work adds proper
    // RPC mocking for the files-tab inside app-shell tests.
    //
    // Context: mounting the shell renders <ac-files-tab> in the
    // default tab. On setupDone(), the files-tab's onRpcReady
    // fires and calls Repo.get_file_tree on whatever fake proxy
    // these tests installed. That proxy doesn't expose
    // get_file_tree (this describe block tests shell behavior,
    // not files-tab behavior), so the files-tab's RPC call
    // rejects and its error handler logs via console.error.
    //
    // The errors are genuine but out of scope for these tests.
    // A scoped mock silences them without hiding real errors in
    // other describe blocks. When Phase 2d expands these tests
    // to cover files-tab interaction, the fake proxy will grow
    // Repo.get_file_tree and this silence becomes redundant —
    // grep for TODO(phase-2d) to find it.
    let _consoleErrorSpy;
    beforeEach(() => {
      _consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
    });
    afterEach(() => {
      _consoleErrorSpy.mockRestore();
    });

    it('publishes call proxy to SharedRpc on first connect', async () => {
      const shell = mountShell();
      shell.call = { 'Repo.get_file_content': vi.fn() };
      shell.setupDone();
      expect(SharedRpc.isReady).toBe(true);
      expect(SharedRpc.call).toBe(shell.call);
    });

    it('flips connectionState to connected', async () => {
      const shell = mountShell();
      shell.call = {};
      shell.setupDone();
      expect(shell.connectionState).toBe('connected');
    });

    it('keeps overlay visible on first connect (waits for ready)', async () => {
      // First connect: overlay stays up so startup progress can
      // drive it to ready. Reconnects dismiss immediately —
      // pinned by a separate test.
      const shell = mountShell();
      shell.call = {};
      shell.setupDone();
      expect(shell.overlayVisible).toBe(true);
    });

    it('dismisses overlay and shows toast on reconnect', async () => {
      const shell = mountShell();
      shell.call = {};
      // First connect.
      shell.setupDone();
      // Simulate ready so the overlay would dismiss naturally.
      shell.startupProgress('ready', 'Ready', 100);
      // Disconnect.
      shell.remoteDisconnected();
      // Reconnect.
      shell.setupDone();
      expect(shell.overlayVisible).toBe(false);
      expect(shell.toasts.length).toBe(1);
      expect(shell.toasts[0].type).toBe('success');
      expect(shell.toasts[0].message).toBe('Reconnected');
    });
  });

  describe('remoteDisconnected', () => {
    it('clears SharedRpc', () => {
      const shell = mountShell();
      shell.call = {};
      shell.setupDone();
      expect(SharedRpc.isReady).toBe(true);
      shell.remoteDisconnected();
      expect(SharedRpc.isReady).toBe(false);
    });

    it('flips connectionState to disconnected', () => {
      const shell = mountShell();
      shell.call = {};
      shell.setupDone();
      shell.remoteDisconnected();
      expect(shell.connectionState).toBe('disconnected');
    });

    it('schedules reconnect when was previously connected', () => {
      vi.useFakeTimers();
      const shell = mountShell();
      shell.call = {};
      shell.setupDone();
      const spy = vi.spyOn(shell, '_attemptReconnect');
      shell.remoteDisconnected();
      // First-delay bucket is 1000ms.
      vi.advanceTimersByTime(999);
      expect(spy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('does NOT schedule reconnect before first successful connect', () => {
      vi.useFakeTimers();
      const shell = mountShell();
      const spy = vi.spyOn(shell, '_attemptReconnect');
      // Simulate disconnect without prior setupDone — e.g.,
      // the first connection attempt failed mid-handshake.
      shell.remoteDisconnected();
      vi.advanceTimersByTime(20000);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('startupProgress', () => {
    it('updates stage, message, and percent', async () => {
      const shell = mountShell();
      shell.startupProgress('indexing', 'Indexing repository…', 50);
      expect(shell.startupStage).toBe('indexing');
      expect(shell.startupMessage).toBe('Indexing repository…');
      expect(shell.startupPercent).toBe(50);
    });

    it('clamps percent to 0..100', () => {
      const shell = mountShell();
      shell.startupProgress('x', 'x', 150);
      expect(shell.startupPercent).toBe(100);
      shell.startupProgress('x', 'x', -20);
      expect(shell.startupPercent).toBe(0);
    });

    it('dismisses overlay on ready (after fade delay)', async () => {
      vi.useFakeTimers();
      const shell = mountShell();
      shell.startupProgress('ready', 'Ready', 100);
      // Overlay isn't hidden synchronously — there's a
      // post-ready delay for visual polish (user sees 100% for
      // a moment before the fade).
      expect(shell.overlayVisible).toBe(true);
      vi.advanceTimersByTime(500);
      expect(shell.overlayVisible).toBe(false);
    });
  });

  describe('reconnect backoff', () => {
    it('increments attempt counter across multiple failures', () => {
      vi.useFakeTimers();
      const shell = mountShell();
      shell.call = {};
      shell.setupDone();
      shell.remoteDisconnected();
      expect(shell.reconnectAttempt).toBe(1);
      vi.advanceTimersByTime(2000);
      shell.remoteDisconnected();
      expect(shell.reconnectAttempt).toBe(2);
    });

    it('caps delay at 15000ms for high attempt counts', () => {
      vi.useFakeTimers();
      const shell = mountShell();
      shell.call = {};
      shell.setupDone();
      // Reach attempt 10 (well beyond the schedule length).
      shell.reconnectAttempt = 10;
      shell.remoteDisconnected();
      // Should not fire before the capped delay.
      vi.advanceTimersByTime(14999);
      const spy = vi.spyOn(shell, '_attemptReconnect');
      // Already scheduled — advance and confirm it fires on
      // the capped schedule.
      vi.advanceTimersByTime(2);
      expect(spy).toHaveBeenCalled();
    });
  });
});