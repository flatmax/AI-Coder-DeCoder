// Tests for commit 3 — the view-agents-requested
// handler that loads historical (read-only)
// agent tabs from the archive.
//
// Coverage:
//   - Successful load: RPC fires, tabs created
//     with historical prefix, readOnly flag set,
//     active tab switches to first new tab
//   - Live-agent filtering: agents still in the
//     strip are skipped, only archived ones
//     become historical tabs
//   - Idempotent re-clicks: prior historical
//     tabs cleared before each load
//   - Read-only input gate: send() rejects with
//     toast when active tab is historical
//   - Error surfaces: RPC failure, empty
//     archive, malformed payload all toast
//     instead of leaving the strip in a broken
//     state

import { describe, expect, it, vi } from 'vitest';

import {
  mountPanel,
  publishFakeRpc,
  settle,
} from './test-helpers.js';

function dispatchViewAgents(panel, turn_id, agent_blocks) {
  panel.dispatchEvent(
    new CustomEvent('view-agents-requested', {
      detail: { turn_id, agent_blocks },
      bubbles: true,
      composed: true,
    }),
  );
}

describe('view-agents handler — successful load', () => {
  it('fetches the archive via get_turn_archive', async () => {
    const archive = vi.fn().mockResolvedValue([
      {
        agent_idx: 0,
        messages: [
          { role: 'user', content: 'do the thing' },
          { role: 'assistant', content: 'done' },
        ],
      },
    ]);
    publishFakeRpc({ 'LLMService.get_turn_archive': archive });
    const p = mountPanel();
    await settle(p);
    dispatchViewAgents(p, 'turn_xyz', [
      { id: 'agent-0', agent_idx: 0 },
    ]);
    await settle(p);
    expect(archive).toHaveBeenCalledOnce();
    expect(archive).toHaveBeenCalledWith('turn_xyz');
  });

  it('creates tabs with the historical prefix', async () => {
    publishFakeRpc({
      'LLMService.get_turn_archive': vi.fn().mockResolvedValue([
        {
          agent_idx: 0,
          messages: [{ role: 'user', content: 'q' }],
        },
      ]),
    });
    const p = mountPanel();
    await settle(p);
    dispatchViewAgents(p, 'turn_xyz', [
      { id: 'historical-agent', agent_idx: 0 },
    ]);
    await settle(p);
    const tabIds = Array.from(p._tabs.keys());
    expect(tabIds).toContain('historical:turn_xyz/historical-agent');
  });

  it('marks loaded tabs read-only', async () => {
    publishFakeRpc({
      'LLMService.get_turn_archive': vi.fn().mockResolvedValue([
        {
          agent_idx: 0,
          messages: [{ role: 'user', content: 'q' }],
        },
      ]),
    });
    const p = mountPanel();
    await settle(p);
    dispatchViewAgents(p, 'turn_xyz', [
      { id: 'a0', agent_idx: 0 },
    ]);
    await settle(p);
    const tab = p._tabs.get('historical:turn_xyz/a0');
    expect(tab.readOnly).toBe(true);
  });

  it('populates messages from the archive', async () => {
    publishFakeRpc({
      'LLMService.get_turn_archive': vi.fn().mockResolvedValue([
        {
          agent_idx: 0,
          messages: [
            { role: 'user', content: 'spawned task' },
            { role: 'assistant', content: 'completed' },
          ],
        },
      ]),
    });
    const p = mountPanel();
    await settle(p);
    dispatchViewAgents(p, 'turn_xyz', [
      { id: 'a0', agent_idx: 0 },
    ]);
    await settle(p);
    const tab = p._tabs.get('historical:turn_xyz/a0');
    expect(tab.messages).toHaveLength(2);
    expect(tab.messages[0].content).toBe('spawned task');
    expect(tab.messages[1].content).toBe('completed');
  });

  it('switches active tab to the first new historical tab', async () => {
    publishFakeRpc({
      'LLMService.get_turn_archive': vi.fn().mockResolvedValue([
        {
          agent_idx: 0,
          messages: [{ role: 'user', content: 'q' }],
        },
        {
          agent_idx: 1,
          messages: [{ role: 'user', content: 'q' }],
        },
      ]),
    });
    const p = mountPanel();
    await settle(p);
    expect(p._activeTabId).toBe('main');
    dispatchViewAgents(p, 'turn_xyz', [
      { id: 'first', agent_idx: 0 },
      { id: 'second', agent_idx: 1 },
    ]);
    await settle(p);
    expect(p._activeTabId).toBe('historical:turn_xyz/first');
  });
});

describe('view-agents handler — live-agent filtering', () => {
  it('skips agents that are still live', async () => {
    const archive = vi.fn().mockResolvedValue([
      {
        agent_idx: 0,
        messages: [{ role: 'user', content: 'live one' }],
      },
      {
        agent_idx: 1,
        messages: [{ role: 'user', content: 'historical one' }],
      },
    ]);
    publishFakeRpc({ 'LLMService.get_turn_archive': archive });
    const p = mountPanel();
    await settle(p);
    p._tabs.set('still-live', p._makeTabState());
    p._tabLabels.set('still-live', 'Live agent');
    p.requestUpdate();
    await settle(p);

    dispatchViewAgents(p, 'turn_xyz', [
      { id: 'still-live', agent_idx: 0 },
      { id: 'archived', agent_idx: 1 },
    ]);
    await settle(p);
    // Live tab unchanged.
    expect(p._tabs.has('still-live')).toBe(true);
    expect(p._tabs.get('still-live').readOnly).toBe(false);
    // Only archived tab loaded.
    expect(p._tabs.has('historical:turn_xyz/archived')).toBe(true);
    expect(p._tabs.has('historical:turn_xyz/still-live')).toBe(false);
  });

  it('toasts and no-ops when every agent is still live', async () => {
    const archive = vi.fn();
    publishFakeRpc({ 'LLMService.get_turn_archive': archive });
    const p = mountPanel();
    await settle(p);
    p._tabs.set('agent-a', p._makeTabState());
    p._tabs.set('agent-b', p._makeTabState());
    p._tabLabels.set('agent-a', 'A');
    p._tabLabels.set('agent-b', 'B');
    p.requestUpdate();
    await settle(p);

    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      dispatchViewAgents(p, 'turn_xyz', [
        { id: 'agent-a', agent_idx: 0 },
        { id: 'agent-b', agent_idx: 1 },
      ]);
      await settle(p);
      expect(archive).not.toHaveBeenCalled();
      const detail = toastListener.mock.calls.at(-1)[0].detail;
      expect(detail.message).toMatch(/still active/i);
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });
});

describe('view-agents handler — idempotency', () => {
  it('clears prior historical tabs before loading new ones', async () => {
    publishFakeRpc({
      'LLMService.get_turn_archive': vi.fn()
        .mockResolvedValueOnce([
          {
            agent_idx: 0,
            messages: [{ role: 'user', content: 'first turn' }],
          },
        ])
        .mockResolvedValueOnce([
          {
            agent_idx: 0,
            messages: [{ role: 'user', content: 'second turn' }],
          },
        ]),
    });
    const p = mountPanel();
    await settle(p);
    dispatchViewAgents(p, 'turn_one', [
      { id: 'a', agent_idx: 0 },
    ]);
    await settle(p);
    expect(p._tabs.has('historical:turn_one/a')).toBe(true);

    dispatchViewAgents(p, 'turn_two', [
      { id: 'b', agent_idx: 0 },
    ]);
    await settle(p);
    expect(p._tabs.has('historical:turn_one/a')).toBe(false);
    expect(p._tabs.has('historical:turn_two/b')).toBe(true);
  });

  it('preserves live agent tabs across historical reloads', async () => {
    publishFakeRpc({
      'LLMService.get_turn_archive': vi.fn().mockResolvedValue([
        {
          agent_idx: 0,
          messages: [{ role: 'user', content: 'q' }],
        },
      ]),
    });
    const p = mountPanel();
    await settle(p);
    p._tabs.set('live', p._makeTabState());
    p._tabLabels.set('live', 'Live');
    p.requestUpdate();
    await settle(p);

    dispatchViewAgents(p, 'turn_xyz', [
      { id: 'historical', agent_idx: 0 },
    ]);
    await settle(p);
    dispatchViewAgents(p, 'turn_other', [
      { id: 'historical2', agent_idx: 0 },
    ]);
    await settle(p);
    expect(p._tabs.has('live')).toBe(true);
    expect(p._tabs.has('historical:turn_xyz/historical')).toBe(false);
    expect(p._tabs.has('historical:turn_other/historical2')).toBe(true);
  });
});

describe('view-agents handler — read-only input gate', () => {
  it('send() rejects with toast on read-only tab', async () => {
    publishFakeRpc({
      'LLMService.get_turn_archive': vi.fn().mockResolvedValue([
        {
          agent_idx: 0,
          messages: [{ role: 'user', content: 'q' }],
        },
      ]),
    });
    const p = mountPanel();
    await settle(p);
    dispatchViewAgents(p, 'turn_xyz', [
      { id: 'a', agent_idx: 0 },
    ]);
    await settle(p);

    p._input = 'try to reply';
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      await p._send();
      const warnings = toastListener.mock.calls
        .map((c) => c[0].detail)
        .filter((d) => d.type === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toMatch(/historical/i);
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });

  it('send() works again after switching back to a live tab', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({
      'LLMService.get_turn_archive': vi.fn().mockResolvedValue([
        {
          agent_idx: 0,
          messages: [{ role: 'user', content: 'q' }],
        },
      ]),
      'LLMService.chat_streaming': started,
    });
    const p = mountPanel();
    await settle(p);
    dispatchViewAgents(p, 'turn_xyz', [
      { id: 'a', agent_idx: 0 },
    ]);
    await settle(p);
    // Switch back to main.
    p._activeTabId = 'main';
    await settle(p);

    p._input = 'live message';
    await p._send();
    await settle(p);
    expect(started).toHaveBeenCalledOnce();
  });

  it('renders read-only tabs with the read-only class', async () => {
    publishFakeRpc({
      'LLMService.get_turn_archive': vi.fn().mockResolvedValue([
        {
          agent_idx: 0,
          messages: [{ role: 'user', content: 'q' }],
        },
      ]),
    });
    const p = mountPanel();
    await settle(p);
    dispatchViewAgents(p, 'turn_xyz', [
      { id: 'a', agent_idx: 0 },
    ]);
    await settle(p);
    const btn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="historical:turn_xyz/a"]',
    );
    expect(btn).not.toBeNull();
    expect(btn.classList.contains('read-only')).toBe(true);
  });

  it('disables textarea on read-only tab', async () => {
    publishFakeRpc({
      'LLMService.get_turn_archive': vi.fn().mockResolvedValue([
        {
          agent_idx: 0,
          messages: [{ role: 'user', content: 'q' }],
        },
      ]),
    });
    const p = mountPanel();
    await settle(p);
    dispatchViewAgents(p, 'turn_xyz', [
      { id: 'a', agent_idx: 0 },
    ]);
    await settle(p);
    const textarea = p.shadowRoot.querySelector('.input-textarea');
    expect(textarea.disabled).toBe(true);
  });
});

describe('view-agents handler — error paths', () => {
  it('surfaces RPC failure as error toast', async () => {
    publishFakeRpc({
      'LLMService.get_turn_archive': vi.fn().mockRejectedValue(
        new Error('disk failure'),
      ),
    });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      const p = mountPanel();
      await settle(p);
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        dispatchViewAgents(p, 'turn_xyz', [
          { id: 'a', agent_idx: 0 },
        ]);
        await settle(p);
        const errors = toastListener.mock.calls
          .map((c) => c[0].detail)
          .filter((d) => d.type === 'error');
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].message).toMatch(/disk failure/);
        // Strip unchanged.
        expect(p._tabs.size).toBe(1);
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('surfaces empty archive as warning toast', async () => {
    publishFakeRpc({
      'LLMService.get_turn_archive': vi.fn().mockResolvedValue([]),
    });
    const p = mountPanel();
    await settle(p);
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      dispatchViewAgents(p, 'turn_xyz', [
        { id: 'a', agent_idx: 0 },
      ]);
      await settle(p);
      const warnings = toastListener.mock.calls
        .map((c) => c[0].detail)
        .filter((d) => d.type === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toMatch(/no archive/i);
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });

  it('handles malformed event detail defensively', async () => {
    const archive = vi.fn();
    publishFakeRpc({ 'LLMService.get_turn_archive': archive });
    const p = mountPanel();
    await settle(p);
    // No detail.
    p.dispatchEvent(new CustomEvent('view-agents-requested'));
    await settle(p);
    expect(archive).not.toHaveBeenCalled();
    // Missing turn_id.
    p.dispatchEvent(new CustomEvent('view-agents-requested', {
      detail: { agent_blocks: [{ id: 'a', agent_idx: 0 }] },
    }));
    await settle(p);
    expect(archive).not.toHaveBeenCalled();
    // Missing agent_blocks.
    p.dispatchEvent(new CustomEvent('view-agents-requested', {
      detail: { turn_id: 'turn_xyz' },
    }));
    await settle(p);
    expect(archive).not.toHaveBeenCalled();
    // Empty agent_blocks.
    p.dispatchEvent(new CustomEvent('view-agents-requested', {
      detail: { turn_id: 'turn_xyz', agent_blocks: [] },
    }));
    await settle(p);
    expect(archive).not.toHaveBeenCalled();
  });
});