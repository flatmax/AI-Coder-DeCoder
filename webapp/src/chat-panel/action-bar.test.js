// Action-bar tab-scoped visibility tests.
//
// The chat panel's action bar carries several controls,
// some of which only make sense on the main tab:
//
//   - mode toggle (code/doc) — operates on main's
//     ContextManager
//   - cross-reference toggle — same
//   - new-session button — resets main's session id
//   - history button — browses main's session list
//
// Per the "Agents as first-class persistent entities" plan
// (see IMPLEMENTATION_NOTES.md § Increment 1), these
// controls are hidden on agent tabs to eliminate the
// "clicked new session on an agent and nothing happened"
// confusion. The mode toggle and cross-ref toggle were
// already gated; this test file pins the new-session +
// history gate that Increment 1 introduced.
//
// Reasoning toggle (🧠), snippet drawer button (✂️),
// search bar, send button, and stop button are
// deliberately NOT gated — they're useful or correctly
// per-tab on every tab type.

import { describe, expect, it } from 'vitest';

import {
  mountPanel,
  seedLabeledTab,
  settle,
  _mounted,
} from './test-helpers.js';

describe('ChatPanel action bar — tab-scoped visibility', () => {
  describe('on main tab', () => {
    it('renders new-session button', async () => {
      const panel = mountPanel();
      await settle(panel);
      const btn = panel.shadowRoot.querySelector(
        '.new-session-button',
      );
      expect(btn).toBeTruthy();
    });

    it('renders history button', async () => {
      const panel = mountPanel();
      await settle(panel);
      const btn = panel.shadowRoot.querySelector(
        '.history-button',
      );
      expect(btn).toBeTruthy();
    });

    it('renders mode toggle (segmented code/doc)', async () => {
      const panel = mountPanel();
      await settle(panel);
      const toggle = panel.shadowRoot.querySelector(
        '.mode-toggle',
      );
      expect(toggle).toBeTruthy();
    });

    it('renders cross-reference toggle', async () => {
      const panel = mountPanel();
      await settle(panel);
      const btn = panel.shadowRoot.querySelector(
        '.crossref-btn',
      );
      expect(btn).toBeTruthy();
    });
  });

  describe('on agent tab', () => {
    it('hides new-session button', async () => {
      const panel = mountPanel();
      seedLabeledTab(panel, 'agent-0', 'Agent 0');
      panel._activeTabId = 'agent-0';
      await settle(panel);
      const btn = panel.shadowRoot.querySelector(
        '.new-session-button',
      );
      expect(btn).toBeFalsy();
    });

    it('hides history button', async () => {
      const panel = mountPanel();
      seedLabeledTab(panel, 'agent-0', 'Agent 0');
      panel._activeTabId = 'agent-0';
      await settle(panel);
      const btn = panel.shadowRoot.querySelector(
        '.history-button',
      );
      expect(btn).toBeFalsy();
    });

    // Per Increment 4b: mode toggle is now shown on
    // agent tabs and routes to per-agent RPCs. The
    // toggle is the user-facing affordance for the
    // per-agent mode switch capability.
    it('shows mode toggle (segmented code/doc)', async () => {
      const panel = mountPanel();
      seedLabeledTab(panel, 'agent-0', 'Agent 0');
      panel._activeTabId = 'agent-0';
      await settle(panel);
      const toggle = panel.shadowRoot.querySelector(
        '.mode-toggle',
      );
      expect(toggle).toBeTruthy();
    });

    it('shows cross-reference toggle', async () => {
      const panel = mountPanel();
      seedLabeledTab(panel, 'agent-0', 'Agent 0');
      panel._activeTabId = 'agent-0';
      await settle(panel);
      const btn = panel.shadowRoot.querySelector(
        '.crossref-btn',
      );
      expect(btn).toBeTruthy();
    });

    it('still renders search bar', async () => {
      const panel = mountPanel();
      seedLabeledTab(panel, 'agent-0', 'Agent 0');
      panel._activeTabId = 'agent-0';
      await settle(panel);
      const bar = panel.shadowRoot.querySelector(
        '.search-bar',
      );
      expect(bar).toBeTruthy();
    });

    it('still renders snippet drawer button', async () => {
      const panel = mountPanel();
      seedLabeledTab(panel, 'agent-0', 'Agent 0');
      panel._activeTabId = 'agent-0';
      await settle(panel);
      const btn = panel.shadowRoot.querySelector(
        '.snippet-drawer-button',
      );
      expect(btn).toBeTruthy();
    });
  });

  describe('on historical (read-only) agent tab', () => {
    // Read-only tabs (per Increment D — historical-turn
    // affordance) carry the same agent-id-shaped tab id
    // and are also non-main, so they inherit the same
    // hide rules for new-session and history.
    it('hides new-session button', async () => {
      const panel = mountPanel();
      seedLabeledTab(panel, 'historical:t_123/agent-0', 'Agent 0');
      panel._tabs.get('historical:t_123/agent-0').readOnly = true;
      panel._activeTabId = 'historical:t_123/agent-0';
      await settle(panel);
      const btn = panel.shadowRoot.querySelector(
        '.new-session-button',
      );
      expect(btn).toBeFalsy();
    });

    it('hides history button', async () => {
      const panel = mountPanel();
      seedLabeledTab(panel, 'historical:t_123/agent-0', 'Agent 0');
      panel._tabs.get('historical:t_123/agent-0').readOnly = true;
      panel._activeTabId = 'historical:t_123/agent-0';
      await settle(panel);
      const btn = panel.shadowRoot.querySelector(
        '.history-button',
      );
      expect(btn).toBeFalsy();
    });

    // Mode toggle renders but every button is
    // disabled. The user can see what mode the agent
    // ran in without having a path to mutate state
    // that no longer exists. Per Increment 4b
    // rendering rule.
    it('shows mode toggle but disables all buttons', async () => {
      const panel = mountPanel();
      seedLabeledTab(
        panel, 'historical:t_123/agent-0', 'Agent 0',
      );
      panel._tabs.get(
        'historical:t_123/agent-0',
      ).readOnly = true;
      panel._activeTabId = 'historical:t_123/agent-0';
      await settle(panel);
      const toggle = panel.shadowRoot.querySelector(
        '.mode-toggle',
      );
      expect(toggle).toBeTruthy();
      const buttons = toggle.querySelectorAll('button');
      for (const btn of buttons) {
        expect(btn.disabled).toBe(true);
      }
    });
  });

  describe('in file-search mode', () => {
    // File-search mode hides new-session + history
    // regardless of tab — pre-existing behaviour. This
    // test pins the precondition so a future refactor
    // can't accidentally remove the original gate while
    // adding the new one.
    it('hides new-session button on main tab', async () => {
      const panel = mountPanel();
      panel._searchMode = 'file';
      await settle(panel);
      const btn = panel.shadowRoot.querySelector(
        '.new-session-button',
      );
      expect(btn).toBeFalsy();
    });

    it('hides history button on main tab', async () => {
      const panel = mountPanel();
      panel._searchMode = 'file';
      await settle(panel);
      const btn = panel.shadowRoot.querySelector(
        '.history-button',
      );
      expect(btn).toBeFalsy();
    });

    it('hides new-session on agent tab too (compound gate)', async () => {
      const panel = mountPanel();
      seedLabeledTab(panel, 'agent-0', 'Agent 0');
      panel._activeTabId = 'agent-0';
      panel._searchMode = 'file';
      await settle(panel);
      const btn = panel.shadowRoot.querySelector(
        '.new-session-button',
      );
      expect(btn).toBeFalsy();
    });
  });

  describe('tab switching', () => {
    it('shows buttons after switching from agent back to main', async () => {
      const panel = mountPanel();
      seedLabeledTab(panel, 'agent-0', 'Agent 0');
      panel._activeTabId = 'agent-0';
      await settle(panel);
      expect(
        panel.shadowRoot.querySelector('.new-session-button'),
      ).toBeFalsy();

      panel._activeTabId = 'main';
      await settle(panel);
      expect(
        panel.shadowRoot.querySelector('.new-session-button'),
      ).toBeTruthy();
      expect(
        panel.shadowRoot.querySelector('.history-button'),
      ).toBeTruthy();
    });

    it('hides buttons after switching from main to agent', async () => {
      const panel = mountPanel();
      seedLabeledTab(panel, 'agent-0', 'Agent 0');
      await settle(panel);
      expect(
        panel.shadowRoot.querySelector('.new-session-button'),
      ).toBeTruthy();

      panel._activeTabId = 'agent-0';
      await settle(panel);
      expect(
        panel.shadowRoot.querySelector('.new-session-button'),
      ).toBeFalsy();
      expect(
        panel.shadowRoot.querySelector('.history-button'),
      ).toBeFalsy();
    });
  });

  describe('reasoning toggle visibility (deliberately ungated)', () => {
    // The reasoning toggle (🧠) is rendered on every
    // tab when the experimental flag is on, gated only
    // by _EXPERIMENTAL_ENABLED. Increment 1 deliberately
    // leaves it alone — agents can benefit from
    // reasoning the same way main does. Pinning here so
    // a future "consistent gating" refactor doesn't
    // accidentally hide it on agents.
    it('renders on main tab if experimental enabled', async () => {
      const panel = mountPanel();
      await settle(panel);
      // Reasoning toggle may or may not exist depending
      // on the build's _EXPERIMENTAL_ENABLED flag. The
      // contract is "if it renders on main, it also
      // renders on agents" — assert symmetric behaviour.
      const onMain = panel.shadowRoot.querySelector(
        '.reasoning-toggle',
      );

      seedLabeledTab(panel, 'agent-0', 'Agent 0');
      panel._activeTabId = 'agent-0';
      await settle(panel);
      const onAgent = panel.shadowRoot.querySelector(
        '.reasoning-toggle',
      );

      // Either both render or neither does.
      expect(!!onMain).toBe(!!onAgent);
    });
  });
});