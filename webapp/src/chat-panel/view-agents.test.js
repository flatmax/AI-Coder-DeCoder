// Tests for the "View agents (N)" affordance on
// assistant messages from historical agentic
// turns. Visibility is gated on:
//
//   - Message has agent_blocks (non-empty array)
//   - Message has turn_id
//   - At least one agent in agent_blocks is no
//     longer live in the tab strip (i.e., this
//     is a previous turn, not the active one)
//
// Click dispatches view-agents-requested for
// commit 3 to handle.

import { describe, expect, it, vi } from 'vitest';

import {
  mountPanel,
  settle,
} from './test-helpers.js';

describe('View-agents affordance — visibility gates', () => {
  it('does not render on user messages', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'user',
          content: 'go',
          turn_id: 'turn_abc',
          agent_blocks: [{ id: 'a0', agent_idx: 0 }],
        },
      ],
    });
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.view-agents-affordance'),
    ).toBeNull();
  });

  it('does not render on system event messages', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'user',
          content: 'Committed abc1234',
          system_event: true,
          turn_id: 'turn_abc',
          agent_blocks: [{ id: 'a0', agent_idx: 0 }],
        },
      ],
    });
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.view-agents-affordance'),
    ).toBeNull();
  });

  it('does not render when turn_id missing', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'reply',
          agent_blocks: [{ id: 'a0', agent_idx: 0 }],
        },
      ],
    });
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.view-agents-affordance'),
    ).toBeNull();
  });

  it('does not render when agent_blocks missing', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'reply',
          turn_id: 'turn_abc',
        },
      ],
    });
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.view-agents-affordance'),
    ).toBeNull();
  });

  it('does not render when agent_blocks is empty', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'reply',
          turn_id: 'turn_abc',
          agent_blocks: [],
        },
      ],
    });
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.view-agents-affordance'),
    ).toBeNull();
  });

  it('does not render when agent_blocks is non-array', async () => {
    // Defensive — a malformed in-memory record
    // shouldn't crash render. Backend filtering
    // prevents this on disk per spec, but a
    // future code path that bypasses backend
    // validation shouldn't break the renderer.
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'reply',
          turn_id: 'turn_abc',
          agent_blocks: 'not an array',
        },
      ],
    });
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.view-agents-affordance'),
    ).toBeNull();
  });

  it('renders when all agents are no longer live', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'delegated',
          turn_id: 'turn_old',
          agent_blocks: [
            { id: 'historical-agent', agent_idx: 0 },
          ],
        },
      ],
    });
    await settle(p);
    const affordance = p.shadowRoot.querySelector(
      '.view-agents-affordance',
    );
    expect(affordance).not.toBeNull();
    const button = affordance.querySelector(
      '.view-agents-button',
    );
    expect(button).not.toBeNull();
    expect(button.textContent).toContain('View agent');
  });

  it('does not render when all agents are live in strip', async () => {
    // Active-turn case — main panel still has
    // the agent tabs from this turn. Affordance
    // would duplicate the strip's own
    // affordances.
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'delegated',
          turn_id: 'turn_active',
          agent_blocks: [
            { id: 'live-agent', agent_idx: 0 },
          ],
        },
      ],
    });
    p._tabs.set('live-agent', p._makeTabState());
    p._tabLabels.set('live-agent', 'Agent 00');
    p.requestUpdate();
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.view-agents-affordance'),
    ).toBeNull();
  });

  it('renders when some but not all agents are live', async () => {
    // Re-iteration mid-turn — the orchestrator
    // spawned 3 agents, then in iteration 2
    // closed one and added a new one. The
    // historical message still references all 3
    // ids; the active-turn check should treat
    // "any agent missing from the strip" as
    // "previous turn" so the user can recover
    // the closed agent's archive.
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'delegated',
          turn_id: 'turn_mixed',
          agent_blocks: [
            { id: 'still-live', agent_idx: 0 },
            { id: 'was-closed', agent_idx: 1 },
          ],
        },
      ],
    });
    p._tabs.set('still-live', p._makeTabState());
    p._tabLabels.set('still-live', 'Still Live');
    p.requestUpdate();
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.view-agents-affordance'),
    ).not.toBeNull();
  });

  it('handles malformed agent_blocks entries defensively', async () => {
    // Block with non-string id — the all-live
    // check trips on it (treats as not live)
    // and we render the affordance. Better than
    // hiding it because the user might still
    // want to recover whatever's salvageable.
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'mixed',
          turn_id: 'turn_x',
          agent_blocks: [
            { id: 'good-agent', agent_idx: 0 },
            { agent_idx: 1 }, // missing id
            null,
          ],
        },
      ],
    });
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.view-agents-affordance'),
    ).not.toBeNull();
  });
});

describe('View-agents affordance — label', () => {
  it('shows singular for one agent', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'delegated',
          turn_id: 'turn_x',
          agent_blocks: [
            { id: 'historical', agent_idx: 0 },
          ],
        },
      ],
    });
    await settle(p);
    const button = p.shadowRoot.querySelector(
      '.view-agents-button',
    );
    expect(button.textContent).toContain('View agent (1)');
  });

  it('shows plural with count for multiple agents', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'delegated',
          turn_id: 'turn_x',
          agent_blocks: [
            { id: 'a0-historical', agent_idx: 0 },
            { id: 'a1-historical', agent_idx: 1 },
            { id: 'a2-historical', agent_idx: 2 },
          ],
        },
      ],
    });
    await settle(p);
    const button = p.shadowRoot.querySelector(
      '.view-agents-button',
    );
    expect(button.textContent).toContain('View agents (3)');
  });

  it('count reflects all blocks, not just historical ones', async () => {
    // Even if one agent is still live, the count
    // shown matches the original spawn —
    // clicking the affordance loads all of them.
    // Live agents in the result get filtered at
    // load time (commit 3) since their
    // ContextManager exists and they're already
    // shown in the strip.
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'mixed',
          turn_id: 'turn_x',
          agent_blocks: [
            { id: 'still-here', agent_idx: 0 },
            { id: 'was-closed', agent_idx: 1 },
          ],
        },
      ],
    });
    p._tabs.set('still-here', p._makeTabState());
    p._tabLabels.set('still-here', 'Still');
    p.requestUpdate();
    await settle(p);
    const button = p.shadowRoot.querySelector(
      '.view-agents-button',
    );
    expect(button.textContent).toContain('View agents (2)');
  });
});

describe('View-agents affordance — click dispatch', () => {
  it('clicking dispatches view-agents-requested', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'delegated',
          turn_id: 'turn_xyz',
          agent_blocks: [
            { id: 'a0', agent_idx: 0 },
            { id: 'a1', agent_idx: 1 },
          ],
        },
      ],
    });
    await settle(p);
    const listener = vi.fn();
    p.addEventListener('view-agents-requested', listener);
    try {
      p.shadowRoot
        .querySelector('.view-agents-button')
        .click();
      expect(listener).toHaveBeenCalledOnce();
      const detail = listener.mock.calls[0][0].detail;
      expect(detail.turn_id).toBe('turn_xyz');
      expect(detail.agent_blocks).toEqual([
        { id: 'a0', agent_idx: 0 },
        { id: 'a1', agent_idx: 1 },
      ]);
    } finally {
      p.removeEventListener(
        'view-agents-requested', listener,
      );
    }
  });

  it('event bubbles + composes across shadow DOM', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'delegated',
          turn_id: 'turn_xyz',
          agent_blocks: [{ id: 'a0', agent_idx: 0 }],
        },
      ],
    });
    await settle(p);
    const outer = vi.fn();
    document.body.addEventListener(
      'view-agents-requested', outer,
    );
    try {
      p.shadowRoot
        .querySelector('.view-agents-button')
        .click();
      expect(outer).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener(
        'view-agents-requested', outer,
      );
    }
  });

  it('click does not also trigger card-level handlers', async () => {
    // Click is stopPropagation'd to prevent
    // bubble-up from triggering the messages-
    // container click delegate (which handles
    // file mentions, code copy, etc.). The
    // composed event still escapes the shadow
    // boundary because dispatch happens on the
    // panel element itself, not via bubbling
    // from the button.
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'delegated',
          turn_id: 'turn_x',
          agent_blocks: [{ id: 'a0', agent_idx: 0 }],
        },
      ],
    });
    await settle(p);
    const messagesEl = p.shadowRoot.querySelector('.messages');
    const cardListener = vi.fn();
    messagesEl.addEventListener('click', cardListener);
    try {
      p.shadowRoot
        .querySelector('.view-agents-button')
        .click();
      expect(cardListener).not.toHaveBeenCalled();
    } finally {
      messagesEl.removeEventListener('click', cardListener);
    }
  });
});

describe('View-agents affordance — placement', () => {
  it('renders inside the assistant card', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'delegated',
          turn_id: 'turn_x',
          agent_blocks: [{ id: 'a0', agent_idx: 0 }],
        },
      ],
    });
    await settle(p);
    const card = p.shadowRoot.querySelector(
      '.role-assistant',
    );
    expect(
      card.querySelector('.view-agents-affordance'),
    ).not.toBeNull();
  });

  it('survives session reload through full message shape', async () => {
    // Integration check — the panel constructor
    // accepts persisted records, threading
    // turn_id and agent_blocks through, and the
    // affordance picks them up on render.
    const p = mountPanel();
    await settle(p);
    p.messages = [
      {
        role: 'assistant',
        content: 'reloaded',
        turn_id: 'turn_reload',
        agent_blocks: [
          { id: 'old-agent', agent_idx: 0 },
        ],
      },
    ];
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.view-agents-affordance'),
    ).not.toBeNull();
  });
});