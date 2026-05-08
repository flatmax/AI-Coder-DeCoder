// Tests for tab strip rendering, click, overflow menu, close
// button, close→RPC wiring, agent_tag routing, streaming
// indicator (D1), Alt+` cycling (D2), and per-tab URL chip
// snapshots.

import { describe, expect, it, vi } from 'vitest';

import {
  mountPanel,
  publishFakeRpc,
  pushEvent,
  seedLabeledTab,
  seedLabeledTabWithMode,
  seedTab,
  settle,
} from './test-helpers.js';

// ---------------------------------------------------------------------------
// Tab strip rendering (D21 Phase B1)
// ---------------------------------------------------------------------------

describe('ChatPanel tab strip rendering', () => {
  it('is hidden when only the main tab exists', async () => {
    const p = mountPanel();
    await settle(p);
    const strip = p.shadowRoot.querySelector('.tab-strip');
    expect(strip).toBeNull();
  });

  it('appears when a second tab is added', async () => {
    const p = mountPanel();
    await settle(p);
    expect(p.shadowRoot.querySelector('.tab-strip')).toBeNull();
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const strip = p.shadowRoot.querySelector('.tab-strip');
    expect(strip).toBeTruthy();
  });

  it('renders one button per tab in insertion order', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    seedLabeledTab(p, 'agent-1', 'Agent 1');
    seedLabeledTab(p, 'agent-2', 'Agent 2');
    p.requestUpdate();
    await settle(p);
    const buttons = p.shadowRoot.querySelectorAll(
      '.tab-strip-tab',
    );
    expect(buttons.length).toBe(4);
    expect(buttons[0].getAttribute('data-tab-id')).toBe('main');
    expect(buttons[1].getAttribute('data-tab-id')).toBe('agent-0');
    expect(buttons[2].getAttribute('data-tab-id')).toBe('agent-1');
    expect(buttons[3].getAttribute('data-tab-id')).toBe('agent-2');
  });

  it('renders the main tab label as "Main"', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const mainBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="main"]',
    );
    expect(mainBtn.textContent.trim()).toBe('Main');
  });

  it('renders custom labels for agent tabs', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0: refactor auth');
    p.requestUpdate();
    await settle(p);
    const agentBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"]',
    );
    const labelText = agentBtn.textContent
      .replace(/✕\s*$/, '')
      .trim();
    expect(labelText).toBe('Agent 0: refactor auth');
  });

  it('falls back to tab ID when label is missing', async () => {
    const p = mountPanel();
    await settle(p);
    p._tabs.set('orphan-tab', p._makeTabState());
    p.requestUpdate();
    await settle(p);
    const orphanBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="orphan-tab"]',
    );
    const labelText = orphanBtn.textContent
      .replace(/✕\s*$/, '')
      .trim();
    expect(labelText).toBe('orphan-tab');
  });

  it('active tab gets the .active class', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const mainBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="main"]',
    );
    const agentBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"]',
    );
    expect(mainBtn.classList.contains('active')).toBe(true);
    expect(agentBtn.classList.contains('active')).toBe(false);
  });

  it('active class follows _activeTabId changes', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    p._activeTabId = 'agent-0';
    await settle(p);
    const mainBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="main"]',
    );
    const agentBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"]',
    );
    expect(mainBtn.classList.contains('active')).toBe(false);
    expect(agentBtn.classList.contains('active')).toBe(true);
  });

  it('active button carries aria-selected="true"', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const mainBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="main"]',
    );
    const agentBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"]',
    );
    expect(mainBtn.getAttribute('aria-selected')).toBe('true');
    expect(agentBtn.getAttribute('aria-selected')).toBe('false');
  });

  it('button title attribute mirrors the label', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0: refactor auth module');
    p.requestUpdate();
    await settle(p);
    const agentBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"]',
    );
    expect(agentBtn.getAttribute('title')).toBe(
      'Agent 0: refactor auth module',
    );
  });

  it('tablist role on the inner scroll container', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const scroll = p.shadowRoot.querySelector('.tab-strip-scroll');
    expect(scroll.getAttribute('role')).toBe('tablist');
  });

  it('buttons carry role="tab"', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const buttons = p.shadowRoot.querySelectorAll(
      '.tab-strip-tab',
    );
    for (const btn of buttons) {
      expect(btn.getAttribute('role')).toBe('tab');
    }
  });
});

describe('ChatPanel tab strip interaction', () => {
  it('clicking a tab flips _activeTabId', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    expect(p._activeTabId).toBe('main');
    const agentBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"]',
    );
    agentBtn.click();
    await settle(p);
    expect(p._activeTabId).toBe('agent-0');
  });

  it('click dispatches active-tab-changed event', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const listener = vi.fn();
    p.addEventListener('active-tab-changed', listener);
    try {
      const agentBtn = p.shadowRoot.querySelector(
        '.tab-strip-tab[data-tab-id="agent-0"]',
      );
      agentBtn.click();
      await settle(p);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        tabId: 'agent-0',
        previousTabId: 'main',
      });
    } finally {
      p.removeEventListener('active-tab-changed', listener);
    }
  });

  it('clicking the already-active tab is a no-op', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const listener = vi.fn();
    p.addEventListener('active-tab-changed', listener);
    try {
      const mainBtn = p.shadowRoot.querySelector(
        '.tab-strip-tab[data-tab-id="main"]',
      );
      mainBtn.click();
      mainBtn.click();
      await settle(p);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      p.removeEventListener('active-tab-changed', listener);
    }
  });

  it('clicking updates the active class on the strip', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const agentBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"]',
    );
    agentBtn.click();
    await settle(p);
    const mainBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="main"]',
    );
    const agentBtn2 = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"]',
    );
    expect(mainBtn.classList.contains('active')).toBe(false);
    expect(agentBtn2.classList.contains('active')).toBe(true);
  });

  it('switching tabs swaps the visible message list', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p._tabs.get('main').messages = [
      { role: 'user', content: 'main tab message' },
    ];
    p._tabs.get('agent-0').messages = [
      { role: 'user', content: 'agent tab message' },
    ];
    p.requestUpdate();
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.messages').textContent,
    ).toContain('main tab message');
    expect(
      p.shadowRoot.querySelector('.messages').textContent,
    ).not.toContain('agent tab message');
    const agentBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"]',
    );
    agentBtn.click();
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.messages').textContent,
    ).toContain('agent tab message');
    expect(
      p.shadowRoot.querySelector('.messages').textContent,
    ).not.toContain('main tab message');
  });
});

// ---------------------------------------------------------------------------
// Tab strip overflow (D21 Phase B2)
// ---------------------------------------------------------------------------

describe('ChatPanel tab strip overflow — structure', () => {
  it('has a scroll container inside the strip', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const scroll = p.shadowRoot.querySelector('.tab-strip-scroll');
    expect(scroll).toBeTruthy();
    const tabsInScroll = scroll.querySelectorAll(
      '.tab-strip-tab',
    );
    expect(tabsInScroll.length).toBeGreaterThan(0);
  });

  it('overflow button is visible when strip is visible', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.tab-strip-overflow');
    expect(btn).toBeTruthy();
  });

  it('overflow button is absent in single-tab mode', async () => {
    const p = mountPanel();
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.tab-strip-overflow'),
    ).toBeNull();
  });

  it('overflow button carries aria attributes', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.tab-strip-overflow');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('ChatPanel tab strip overflow — open/close', () => {
  it('menu is closed by default', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    expect(p._tabStripOverflowOpen).toBe(false);
    expect(
      p.shadowRoot.querySelector('.tab-strip-overflow-menu'),
    ).toBeNull();
  });

  it('clicking the overflow button opens the menu', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.tab-strip-overflow');
    btn.click();
    await settle(p);
    expect(p._tabStripOverflowOpen).toBe(true);
    expect(
      p.shadowRoot.querySelector('.tab-strip-overflow-menu'),
    ).toBeTruthy();
  });

  it('aria-expanded reflects open state', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.tab-strip-overflow');
    btn.click();
    await settle(p);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('clicking the button again closes the menu', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.tab-strip-overflow');
    btn.click();
    await settle(p);
    btn.click();
    await settle(p);
    expect(p._tabStripOverflowOpen).toBe(false);
    expect(
      p.shadowRoot.querySelector('.tab-strip-overflow-menu'),
    ).toBeNull();
  });

  it('outside click dismisses the menu', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector('.tab-strip-overflow')
      .click();
    await settle(p);
    expect(p._tabStripOverflowOpen).toBe(true);
    document.body.click();
    await settle(p);
    expect(p._tabStripOverflowOpen).toBe(false);
  });

  it('click inside the menu does not dismiss', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector('.tab-strip-overflow')
      .click();
    await settle(p);
    const menu = p.shadowRoot.querySelector(
      '.tab-strip-overflow-menu',
    );
    menu.click();
    await settle(p);
    expect(p._tabStripOverflowOpen).toBe(true);
  });

  it('Escape dismisses the menu', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector('.tab-strip-overflow')
      .click();
    await settle(p);
    expect(p._tabStripOverflowOpen).toBe(true);
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(p._tabStripOverflowOpen).toBe(false);
  });
});

describe('ChatPanel tab strip overflow — menu items', () => {
  it('renders one item per tab in insertion order', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    seedLabeledTab(p, 'agent-1', 'Agent 1');
    seedLabeledTab(p, 'agent-2', 'Agent 2');
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector('.tab-strip-overflow')
      .click();
    await settle(p);
    const items = p.shadowRoot.querySelectorAll(
      '.tab-strip-overflow-item',
    );
    expect(items.length).toBe(4);
    expect(items[0].getAttribute('data-tab-id')).toBe('main');
    expect(items[1].getAttribute('data-tab-id')).toBe('agent-0');
    expect(items[2].getAttribute('data-tab-id')).toBe('agent-1');
    expect(items[3].getAttribute('data-tab-id')).toBe('agent-2');
  });

  it('item labels match the strip button labels', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0: refactor auth');
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector('.tab-strip-overflow')
      .click();
    await settle(p);
    const item = p.shadowRoot.querySelector(
      '.tab-strip-overflow-item[data-tab-id="agent-0"]',
    );
    expect(item.textContent.trim()).toBe(
      'Agent 0: refactor auth',
    );
  });

  it('main item renders as "Main"', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector('.tab-strip-overflow')
      .click();
    await settle(p);
    const mainItem = p.shadowRoot.querySelector(
      '.tab-strip-overflow-item[data-tab-id="main"]',
    );
    expect(mainItem.textContent.trim()).toBe('Main');
  });

  it('active item gets the .active class', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    p._activeTabId = 'agent-0';
    await settle(p);
    p.shadowRoot
      .querySelector('.tab-strip-overflow')
      .click();
    await settle(p);
    const mainItem = p.shadowRoot.querySelector(
      '.tab-strip-overflow-item[data-tab-id="main"]',
    );
    const agentItem = p.shadowRoot.querySelector(
      '.tab-strip-overflow-item[data-tab-id="agent-0"]',
    );
    expect(mainItem.classList.contains('active')).toBe(false);
    expect(agentItem.classList.contains('active')).toBe(true);
  });

  it('items carry role="menuitem"', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector('.tab-strip-overflow')
      .click();
    await settle(p);
    const items = p.shadowRoot.querySelectorAll(
      '.tab-strip-overflow-item',
    );
    for (const item of items) {
      expect(item.getAttribute('role')).toBe('menuitem');
    }
  });
});

describe('ChatPanel tab strip overflow — jump', () => {
  it('clicking an item flips _activeTabId', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    seedLabeledTab(p, 'agent-1', 'Agent 1');
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector('.tab-strip-overflow')
      .click();
    await settle(p);
    const item = p.shadowRoot.querySelector(
      '.tab-strip-overflow-item[data-tab-id="agent-1"]',
    );
    item.click();
    await settle(p);
    expect(p._activeTabId).toBe('agent-1');
  });

  it('clicking an item closes the menu', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector('.tab-strip-overflow')
      .click();
    await settle(p);
    const item = p.shadowRoot.querySelector(
      '.tab-strip-overflow-item[data-tab-id="agent-0"]',
    );
    item.click();
    await settle(p);
    expect(p._tabStripOverflowOpen).toBe(false);
  });

  it('clicking dispatches active-tab-changed', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector('.tab-strip-overflow')
      .click();
    await settle(p);
    const listener = vi.fn();
    p.addEventListener('active-tab-changed', listener);
    try {
      p.shadowRoot
        .querySelector(
          '.tab-strip-overflow-item[data-tab-id="agent-0"]',
        )
        .click();
      await settle(p);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        tabId: 'agent-0',
        previousTabId: 'main',
      });
    } finally {
      p.removeEventListener('active-tab-changed', listener);
    }
  });

  it('clicking the already-active item is a no-op', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector('.tab-strip-overflow')
      .click();
    await settle(p);
    const listener = vi.fn();
    p.addEventListener('active-tab-changed', listener);
    try {
      p.shadowRoot
        .querySelector(
          '.tab-strip-overflow-item[data-tab-id="main"]',
        )
        .click();
      await settle(p);
      expect(listener).not.toHaveBeenCalled();
      expect(p._tabStripOverflowOpen).toBe(false);
    } finally {
      p.removeEventListener('active-tab-changed', listener);
    }
  });
});

describe('ChatPanel tab strip overflow — cleanup', () => {
  it('disconnect releases document listeners', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector('.tab-strip-overflow')
      .click();
    await settle(p);
    expect(p._tabStripOverflowOpen).toBe(true);
    p.remove();
    expect(() => document.body.click()).not.toThrow();
    expect(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }),
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tab close button (D21 Phase B3)
// ---------------------------------------------------------------------------

describe('ChatPanel tab close — rendering', () => {
  it('main tab does not render a close button', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const mainBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="main"]',
    );
    expect(mainBtn.querySelector('.tab-close')).toBeNull();
  });

  it('agent tabs render a close button', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const agentBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"]',
    );
    const close = agentBtn.querySelector('.tab-close');
    expect(close).toBeTruthy();
    expect(close.textContent.trim()).toBe('✕');
  });

  it('close button carries accessible label', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0: refactor');
    p.requestUpdate();
    await settle(p);
    const close = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"] .tab-close',
    );
    expect(close.getAttribute('aria-label')).toBe(
      'Close Agent 0: refactor',
    );
  });

  it('close button has role=button and keyboard affordance', async () => {
    // Span (not nested button) — same screen-reader
    // semantics, no parser interference.
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const close = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"] .tab-close',
    );
    expect(close.tagName).toBe('SPAN');
    expect(close.getAttribute('role')).toBe('button');
    expect(close.getAttribute('tabindex')).toBe('0');
  });

  it('overflow menu items have no close affordance', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector('.tab-strip-overflow')
      .click();
    await settle(p);
    const item = p.shadowRoot.querySelector(
      '.tab-strip-overflow-item[data-tab-id="agent-0"]',
    );
    expect(item.querySelector('.tab-close')).toBeNull();
  });
});

describe('ChatPanel tab close — behavior', () => {
  it('clicking close removes the tab from _tabs', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    seedLabeledTab(p, 'agent-1', 'Agent 1');
    p.requestUpdate();
    await settle(p);
    expect(p._tabs.has('agent-0')).toBe(true);
    const close = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"] .tab-close',
    );
    close.click();
    await settle(p);
    expect(p._tabs.has('agent-0')).toBe(false);
    expect(p._tabs.has('agent-1')).toBe(true);
    expect(p._tabs.has('main')).toBe(true);
  });

  it('removes from _tabLabels too', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const close = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"] .tab-close',
    );
    close.click();
    await settle(p);
    expect(p._tabLabels.has('agent-0')).toBe(false);
  });

  it('closing the active tab switches to main', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    p._activeTabId = 'agent-0';
    await settle(p);
    const close = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"] .tab-close',
    );
    close.click();
    await settle(p);
    expect(p._activeTabId).toBe('main');
    expect(p._tabs.has('agent-0')).toBe(false);
  });

  it('closing an inactive tab preserves the active one', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    seedLabeledTab(p, 'agent-1', 'Agent 1');
    p.requestUpdate();
    await settle(p);
    p._activeTabId = 'agent-1';
    await settle(p);
    const close = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"] .tab-close',
    );
    close.click();
    await settle(p);
    expect(p._activeTabId).toBe('agent-1');
  });

  it('close click does not flip activeTabId to the closing tab', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    seedLabeledTab(p, 'agent-1', 'Agent 1');
    p.requestUpdate();
    await settle(p);
    p._activeTabId = 'agent-1';
    await settle(p);
    const listener = vi.fn();
    p.addEventListener('active-tab-changed', listener);
    try {
      const close = p.shadowRoot.querySelector(
        '.tab-strip-tab[data-tab-id="agent-0"] .tab-close',
      );
      close.click();
      await settle(p);
      expect(listener).not.toHaveBeenCalled();
      expect(p._activeTabId).toBe('agent-1');
    } finally {
      p.removeEventListener('active-tab-changed', listener);
    }
  });

  it('dispatches close-tab event with tabId', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const listener = vi.fn();
    p.addEventListener('close-tab', listener);
    try {
      const close = p.shadowRoot.querySelector(
        '.tab-strip-tab[data-tab-id="agent-0"] .tab-close',
      );
      close.click();
      await settle(p);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        tabId: 'agent-0',
      });
    } finally {
      p.removeEventListener('close-tab', listener);
    }
  });

  it('event bubbles and composes across shadow DOM', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const outerListener = vi.fn();
    document.body.addEventListener(
      'close-tab',
      outerListener,
    );
    try {
      p.shadowRoot
        .querySelector(
          '.tab-strip-tab[data-tab-id="agent-0"] .tab-close',
        )
        .click();
      await settle(p);
      expect(outerListener).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener(
        'close-tab',
        outerListener,
      );
    }
  });

  it('Enter key on the close button fires close', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const close = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"] .tab-close',
    );
    close.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(p._tabs.has('agent-0')).toBe(false);
  });

  it('Space key on the close button fires close', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const close = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"] .tab-close',
    );
    close.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: ' ',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(p._tabs.has('agent-0')).toBe(false);
  });

  it('strip disappears when last agent tab closes', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    expect(p.shadowRoot.querySelector('.tab-strip')).toBeTruthy();
    p.shadowRoot
      .querySelector(
        '.tab-strip-tab[data-tab-id="agent-0"] .tab-close',
      )
      .click();
    await settle(p);
    expect(p.shadowRoot.querySelector('.tab-strip')).toBeNull();
  });
});

describe('ChatPanel tab close — guards', () => {
  it('_onTabClose ignores main', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    p._onTabClose('main');
    await settle(p);
    expect(p._tabs.has('main')).toBe(true);
  });

  it('_onTabClose ignores unknown tab IDs', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    expect(() => p._onTabClose('nonexistent')).not.toThrow();
    expect(p._tabs.size).toBe(2);
  });

  it('_onTabClose ignores malformed input', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    expect(() => p._onTabClose(null)).not.toThrow();
    expect(() => p._onTabClose(undefined)).not.toThrow();
    expect(() => p._onTabClose('')).not.toThrow();
    expect(() => p._onTabClose(42)).not.toThrow();
    expect(p._tabs.has('agent-0')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mode storage and tooltip enrichment (Scope B commit 2)
// ---------------------------------------------------------------------------

describe('ChatPanel tab mode storage', () => {
  it('_tabModes initialized as an empty Map', async () => {
    const p = mountPanel();
    await settle(p);
    expect(p._tabModes).toBeInstanceOf(Map);
    expect(p._tabModes.size).toBe(0);
  });

  it('agentsSpawned populates _tabModes from payload', async () => {
    const p = mountPanel();
    await settle(p);
    pushEvent('agents-spawned', {
      turn_id: 'turn_001',
      parent_request_id: 'r-main',
      agent_blocks: [
        {
          id: 'frontend',
          task: 'refactor auth',
          agent_idx: 0,
          mode: 'code',
        },
        {
          id: 'docs',
          task: 'update specs',
          agent_idx: 1,
          mode: 'doc+xref',
        },
      ],
    });
    await settle(p);
    expect(p._tabModes.get('frontend')).toBe('code');
    expect(p._tabModes.get('docs')).toBe('doc+xref');
  });

  it('payload without mode field leaves entry absent', async () => {
    // Older backends that don't ship the mode field in
    // the broadcast payload — the tab still spawns, just
    // without a tooltip suffix.
    const p = mountPanel();
    await settle(p);
    pushEvent('agents-spawned', {
      turn_id: 'turn_001',
      parent_request_id: 'r-main',
      agent_blocks: [
        { id: 'old-agent', task: 't', agent_idx: 0 },
      ],
    });
    await settle(p);
    expect(p._tabs.has('old-agent')).toBe(true);
    expect(p._tabModes.has('old-agent')).toBe(false);
  });

  it('non-string mode value silently dropped', async () => {
    // Defensive — a malformed payload mustn't crash the
    // spawn handler.
    const p = mountPanel();
    await settle(p);
    pushEvent('agents-spawned', {
      turn_id: 'turn_001',
      parent_request_id: 'r-main',
      agent_blocks: [
        { id: 'a', task: 't', agent_idx: 0, mode: 42 },
        { id: 'b', task: 't', agent_idx: 1, mode: null },
      ],
    });
    await settle(p);
    expect(p._tabs.has('a')).toBe(true);
    expect(p._tabs.has('b')).toBe(true);
    expect(p._tabModes.has('a')).toBe(false);
    expect(p._tabModes.has('b')).toBe(false);
  });

  it('closing a tab clears its mode entry', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTabWithMode(p, 'agent-0', 'Agent 00: t', 'code');
    p.requestUpdate();
    await settle(p);
    expect(p._tabModes.has('agent-0')).toBe(true);
    p._onTabClose('agent-0');
    await settle(p);
    expect(p._tabModes.has('agent-0')).toBe(false);
  });

  it('all four valid mode strings round-trip', async () => {
    const p = mountPanel();
    await settle(p);
    pushEvent('agents-spawned', {
      turn_id: 'turn_001',
      parent_request_id: 'r-main',
      agent_blocks: [
        { id: 'c', task: 't', agent_idx: 0, mode: 'code' },
        { id: 'd', task: 't', agent_idx: 1, mode: 'doc' },
        {
          id: 'cx', task: 't', agent_idx: 2, mode: 'code+xref',
        },
        {
          id: 'dx', task: 't', agent_idx: 3, mode: 'doc+xref',
        },
      ],
    });
    await settle(p);
    expect(p._tabModes.get('c')).toBe('code');
    expect(p._tabModes.get('d')).toBe('doc');
    expect(p._tabModes.get('cx')).toBe('code+xref');
    expect(p._tabModes.get('dx')).toBe('doc+xref');
  });
});

describe('ChatPanel tab tooltip enrichment', () => {
  it('main tab tooltip is just the label', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 0');
    p.requestUpdate();
    await settle(p);
    const mainBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="main"]',
    );
    expect(mainBtn.getAttribute('title')).toBe('Main');
  });

  it('agent tab without mode shows bare label', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTab(p, 'agent-0', 'Agent 00: refactor');
    p.requestUpdate();
    await settle(p);
    const btn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"]',
    );
    expect(btn.getAttribute('title')).toBe(
      'Agent 00: refactor',
    );
  });

  it('agent tab with mode includes mode in tooltip', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTabWithMode(
      p, 'agent-0', 'Agent 00: refactor', 'code',
    );
    p.requestUpdate();
    await settle(p);
    const btn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"]',
    );
    expect(btn.getAttribute('title')).toBe(
      'Agent 00: refactor (code)',
    );
  });

  it('cross-ref mode strings render verbatim in tooltip', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTabWithMode(
      p, 'agent-0', 'Agent 00: span', 'doc+xref',
    );
    p.requestUpdate();
    await settle(p);
    const btn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="agent-0"]',
    );
    expect(btn.getAttribute('title')).toBe(
      'Agent 00: span (doc+xref)',
    );
  });

  it('overflow menu items include mode in tooltip', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTabWithMode(
      p, 'agent-0', 'Agent 00: refactor', 'code+xref',
    );
    p.requestUpdate();
    await settle(p);
    p.shadowRoot.querySelector('.tab-strip-overflow').click();
    await settle(p);
    const item = p.shadowRoot.querySelector(
      '.tab-strip-overflow-item[data-tab-id="agent-0"]',
    );
    expect(item.getAttribute('title')).toBe(
      'Agent 00: refactor (code+xref)',
    );
  });

  it('mixed-mode tabs each show their own mode', async () => {
    const p = mountPanel();
    await settle(p);
    seedLabeledTabWithMode(
      p, 'a', 'Agent 00: a', 'code',
    );
    seedLabeledTabWithMode(
      p, 'b', 'Agent 01: b', 'doc',
    );
    seedLabeledTabWithMode(
      p, 'c', 'Agent 02: c', 'code+xref',
    );
    p.requestUpdate();
    await settle(p);
    const a = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="a"]',
    );
    const b = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="b"]',
    );
    const c = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="c"]',
    );
    expect(a.getAttribute('title')).toBe('Agent 00: a (code)');
    expect(b.getAttribute('title')).toBe('Agent 01: b (doc)');
    expect(c.getAttribute('title')).toBe(
      'Agent 02: c (code+xref)',
    );
  });
});

// ---------------------------------------------------------------------------
// C2c — close button → close_agent_context RPC
// ---------------------------------------------------------------------------

describe('ChatPanel close-tab backend wiring', () => {
  it('fires close_agent_context with the agent id', async () => {
    const close = vi
      .fn()
      .mockResolvedValue({ status: 'ok', closed: true });
    publishFakeRpc({
      'LLMService.close_agent_context': close,
    });
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'frontend-trivial';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'frontend-trivial');
    p.requestUpdate();
    await settle(p);
    const closeBtn = p.shadowRoot.querySelector(
      `.tab-strip-tab[data-tab-id="${agentTabId}"] .tab-close`,
    );
    closeBtn.click();
    await settle(p);
    expect(close).toHaveBeenCalledOnce();
    expect(close.mock.calls[0]).toEqual(['frontend-trivial']);
  });

  it('preserves arbitrary characters in the agent id', async () => {
    const close = vi
      .fn()
      .mockResolvedValue({ status: 'ok', closed: true });
    publishFakeRpc({
      'LLMService.close_agent_context': close,
    });
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'auth_v2-refactor';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'auth_v2-refactor');
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector(
        `.tab-strip-tab[data-tab-id="${agentTabId}"] .tab-close`,
      )
      .click();
    await settle(p);
    expect(close.mock.calls[0]).toEqual(['auth_v2-refactor']);
  });

  it('tab is removed locally regardless of RPC outcome', async () => {
    const close = vi
      .fn()
      .mockResolvedValue({ status: 'ok', closed: true });
    publishFakeRpc({
      'LLMService.close_agent_context': close,
    });
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'turn_abc/agent-00';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'Agent 00');
    p.requestUpdate();
    await settle(p);
    expect(p._tabs.has(agentTabId)).toBe(true);
    p.shadowRoot
      .querySelector(
        `.tab-strip-tab[data-tab-id="${agentTabId}"] .tab-close`,
      )
      .click();
    await settle(p);
    expect(p._tabs.has(agentTabId)).toBe(false);
    expect(p._tabLabels.has(agentTabId)).toBe(false);
  });

  it('RPC failure does not restore the tab', async () => {
    const close = vi
      .fn()
      .mockRejectedValue(new Error('network down'));
    publishFakeRpc({
      'LLMService.close_agent_context': close,
    });
    const debugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => {});
    try {
      const p = mountPanel();
      await settle(p);
      const agentTabId = 'turn_abc/agent-00';
      p._tabs.set(agentTabId, p._makeTabState());
      p._tabLabels.set(agentTabId, 'Agent 00');
      p.requestUpdate();
      await settle(p);
      p.shadowRoot
        .querySelector(
          `.tab-strip-tab[data-tab-id="${agentTabId}"] .tab-close`,
        )
        .click();
      await settle(p);
      expect(p._tabs.has(agentTabId)).toBe(false);
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('restricted-caller response emits warning toast', async () => {
    const close = vi.fn().mockResolvedValue({
      error: 'restricted',
      reason: 'Participants cannot close agent tabs',
    });
    publishFakeRpc({
      'LLMService.close_agent_context': close,
    });
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'turn_abc/agent-00';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'Agent 00');
    p.requestUpdate();
    await settle(p);
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      p.shadowRoot
        .querySelector(
          `.tab-strip-tab[data-tab-id="${agentTabId}"] .tab-close`,
        )
        .click();
      await settle(p);
      const warnings = toastListener.mock.calls
        .map((c) => c[0].detail)
        .filter((d) => d.type === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toContain('Participants');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });

  it('generic RPC failure does not emit toast', async () => {
    const close = vi
      .fn()
      .mockRejectedValue(new Error('server exploded'));
    publishFakeRpc({
      'LLMService.close_agent_context': close,
    });
    const debugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => {});
    try {
      const p = mountPanel();
      await settle(p);
      const agentTabId = 'turn_abc/agent-00';
      p._tabs.set(agentTabId, p._makeTabState());
      p._tabLabels.set(agentTabId, 'Agent 00');
      p.requestUpdate();
      await settle(p);
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        p.shadowRoot
          .querySelector(
            `.tab-strip-tab[data-tab-id="${agentTabId}"] .tab-close`,
          )
          .click();
        await settle(p);
        expect(toastListener).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('does not fire RPC when RPC is disconnected', async () => {
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'turn_abc/agent-00';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'Agent 00');
    p.requestUpdate();
    await settle(p);
    expect(() => {
      p.shadowRoot
        .querySelector(
          `.tab-strip-tab[data-tab-id="${agentTabId}"] .tab-close`,
        )
        .click();
    }).not.toThrow();
    await settle(p);
    expect(p._tabs.has(agentTabId)).toBe(false);
  });

  it('still dispatches close-tab event alongside RPC', async () => {
    const close = vi
      .fn()
      .mockResolvedValue({ status: 'ok', closed: true });
    publishFakeRpc({
      'LLMService.close_agent_context': close,
    });
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'turn_abc/agent-00';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'Agent 00');
    p.requestUpdate();
    await settle(p);
    const closeTabListener = vi.fn();
    p.addEventListener('close-tab', closeTabListener);
    try {
      p.shadowRoot
        .querySelector(
          `.tab-strip-tab[data-tab-id="${agentTabId}"] .tab-close`,
        )
        .click();
      await settle(p);
      expect(closeTabListener).toHaveBeenCalledOnce();
      expect(closeTabListener.mock.calls[0][0].detail).toEqual({
        tabId: agentTabId,
      });
      expect(close).toHaveBeenCalledOnce();
    } finally {
      p.removeEventListener('close-tab', closeTabListener);
    }
  });

  it('active tab close fires RPC and switches to main', async () => {
    const close = vi
      .fn()
      .mockResolvedValue({ status: 'ok', closed: true });
    publishFakeRpc({
      'LLMService.close_agent_context': close,
    });
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'turn_abc/agent-00';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'Agent 00');
    p._activeTabId = agentTabId;
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector(
        `.tab-strip-tab[data-tab-id="${agentTabId}"] .tab-close`,
      )
      .click();
    await settle(p);
    expect(close).toHaveBeenCalledOnce();
    expect(p._activeTabId).toBe('main');
  });

  it('close from overflow menu item does NOT fire RPC', async () => {
    const close = vi
      .fn()
      .mockResolvedValue({ status: 'ok', closed: true });
    publishFakeRpc({
      'LLMService.close_agent_context': close,
    });
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'turn_abc/agent-00';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'Agent 00');
    p.requestUpdate();
    await settle(p);
    p.shadowRoot
      .querySelector('.tab-strip-overflow')
      .click();
    await settle(p);
    const menuItem = p.shadowRoot.querySelector(
      `.tab-strip-overflow-item[data-tab-id="${agentTabId}"]`,
    );
    expect(menuItem.querySelector('.tab-close')).toBeNull();
    menuItem.click();
    await settle(p);
    expect(close).not.toHaveBeenCalled();
    expect(p._tabs.has(agentTabId)).toBe(true);
  });

  it('programmatic _onTabClose also fires RPC', async () => {
    const close = vi
      .fn()
      .mockResolvedValue({ status: 'ok', closed: true });
    publishFakeRpc({
      'LLMService.close_agent_context': close,
    });
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'turn_abc/agent-00';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'Agent 00');
    p.requestUpdate();
    await settle(p);
    p._onTabClose(agentTabId);
    await settle(p);
    expect(close).toHaveBeenCalledOnce();
  });

  it('calling _onTabClose on main does not fire RPC', async () => {
    const close = vi
      .fn()
      .mockResolvedValue({ status: 'ok', closed: true });
    publishFakeRpc({
      'LLMService.close_agent_context': close,
    });
    const p = mountPanel();
    await settle(p);
    p._onTabClose('main');
    await settle(p);
    expect(close).not.toHaveBeenCalled();
  });

  it('non-existent tab ID does not fire RPC', async () => {
    const close = vi
      .fn()
      .mockResolvedValue({ status: 'ok', closed: true });
    publishFakeRpc({
      'LLMService.close_agent_context': close,
    });
    const p = mountPanel();
    await settle(p);
    p._onTabClose('turn_nonexistent/agent-00');
    await settle(p);
    expect(close).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C2b — per-tab text routing via agent_tag
// ---------------------------------------------------------------------------

describe('ChatPanel agent_tag routing', () => {
  async function setupWithAgentTab() {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'frontend-trivial';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'frontend-trivial');
    return { panel: p, started, agentTabId };
  }

  it('main tab sends agent_tag=null', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = 'hello from main';
    await p._send();
    await settle(p);
    expect(started).toHaveBeenCalledOnce();
    const args = started.mock.calls[0];
    expect(args).toHaveLength(7);
    expect(args[5]).toBeNull();
    expect(args[6]).toBe(false);
  });

  it('agent tab sends its id as agent_tag', async () => {
    const { panel, started, agentTabId } =
      await setupWithAgentTab();
    panel._activeTabId = agentTabId;
    await settle(panel);
    panel._input = 'hello from agent';
    await panel._send();
    await settle(panel);
    expect(started).toHaveBeenCalledOnce();
    const args = started.mock.calls[0];
    expect(args[5]).toBe('frontend-trivial');
  });

  it('different agent tabs route to their own ids', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._tabs.set('frontend-trivial', p._makeTabState());
    p._tabs.set('backend-auth', p._makeTabState());
    p._tabLabels.set('frontend-trivial', 'frontend-trivial');
    p._tabLabels.set('backend-auth', 'backend-auth');
    p._activeTabId = 'frontend-trivial';
    await settle(p);
    p._input = 'from frontend';
    await p._send();
    await settle(p);
    p._tabs.get('frontend-trivial').streaming = false;
    p._tabs.get('frontend-trivial').currentRequestId = null;
    p._activeTabId = 'backend-auth';
    await settle(p);
    p._input = 'from backend';
    await p._send();
    await settle(p);
    expect(started).toHaveBeenCalledTimes(2);
    expect(started.mock.calls[0][5]).toBe('frontend-trivial');
    expect(started.mock.calls[1][5]).toBe('backend-auth');
  });

  it('agent ids survive across turns (id-based reuse)', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._tabs.set('persistent-agent', p._makeTabState());
    p._tabLabels.set('persistent-agent', 'persistent-agent');
    p._activeTabId = 'persistent-agent';
    await settle(p);
    p._input = 'hello';
    await p._send();
    await settle(p);
    expect(started.mock.calls[0][5]).toBe('persistent-agent');
  });

  it('agent tab selection list comes from active tab', async () => {
    const { panel, started, agentTabId } =
      await setupWithAgentTab();
    panel._tabs.get('main').selectedFiles = ['main.py'];
    panel._tabs.get(agentTabId).selectedFiles = ['agent.py'];
    panel._activeTabId = agentTabId;
    await settle(panel);
    panel._input = 'hi';
    await panel._send();
    await settle(panel);
    const args = started.mock.calls[0];
    expect(args[2]).toEqual(['agent.py']);
  });

  it('switching back to main after agent send routes correctly', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._tabs.set('frontend-trivial', p._makeTabState());
    p._tabLabels.set('frontend-trivial', 'frontend-trivial');
    p._activeTabId = 'frontend-trivial';
    await settle(p);
    p._input = 'from agent';
    await p._send();
    await settle(p);
    expect(started.mock.calls[0][5]).toBe('frontend-trivial');
    p._tabs.get('frontend-trivial').streaming = false;
    p._tabs.get('frontend-trivial').currentRequestId = null;
    p._activeTabId = 'main';
    await settle(p);
    p._input = 'from main';
    await p._send();
    await settle(p);
    expect(started.mock.calls[1][5]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D1 — Streaming indicator on tab labels
// ---------------------------------------------------------------------------

describe('ChatPanel D1 streaming indicator', () => {
  it('does not render indicator on idle tabs', async () => {
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabs.set('turn_abc/agent-01', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p._tabLabels.set('turn_abc/agent-01', 'Agent 01');
    p.requestUpdate();
    await settle(p);
    const indicators = p.shadowRoot.querySelectorAll(
      '.tab-streaming-indicator',
    );
    expect(indicators).toHaveLength(0);
  });

  it('renders indicator on streaming tab', async () => {
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'turn_abc/agent-00';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'Agent 00');
    p._tabs.get(agentTabId).streaming = true;
    p.requestUpdate();
    await settle(p);
    const tabBtn = p.shadowRoot.querySelector(
      `.tab-strip-tab[data-tab-id="${agentTabId}"]`,
    );
    expect(
      tabBtn.querySelector('.tab-streaming-indicator'),
    ).toBeTruthy();
    const mainBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="main"]',
    );
    expect(
      mainBtn.querySelector('.tab-streaming-indicator'),
    ).toBeNull();
  });

  it('renders indicator on active tab too', async () => {
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'turn_abc/agent-00';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'Agent 00');
    p._tabs.get(agentTabId).streaming = true;
    p._activeTabId = agentTabId;
    p.requestUpdate();
    await settle(p);
    const tabBtn = p.shadowRoot.querySelector(
      `.tab-strip-tab[data-tab-id="${agentTabId}"]`,
    );
    expect(tabBtn.classList.contains('active')).toBe(true);
    expect(
      tabBtn.querySelector('.tab-streaming-indicator'),
    ).toBeTruthy();
  });

  it('indicator on main tab when main is streaming', async () => {
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p._tabs.get('main').streaming = true;
    p.requestUpdate();
    await settle(p);
    const mainBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="main"]',
    );
    expect(
      mainBtn.querySelector('.tab-streaming-indicator'),
    ).toBeTruthy();
  });

  it('multiple tabs can show indicators simultaneously', async () => {
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabs.set('turn_abc/agent-01', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p._tabLabels.set('turn_abc/agent-01', 'Agent 01');
    p._tabs.get('turn_abc/agent-00').streaming = true;
    p._tabs.get('turn_abc/agent-01').streaming = true;
    p.requestUpdate();
    await settle(p);
    const indicators = p.shadowRoot.querySelectorAll(
      '.tab-streaming-indicator',
    );
    expect(indicators).toHaveLength(2);
  });

  it('aria-busy reflects streaming state', async () => {
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'turn_abc/agent-00';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'Agent 00');
    p._tabs.get(agentTabId).streaming = true;
    p.requestUpdate();
    await settle(p);
    const tabBtn = p.shadowRoot.querySelector(
      `.tab-strip-tab[data-tab-id="${agentTabId}"]`,
    );
    expect(tabBtn.getAttribute('aria-busy')).toBe('true');
    const mainBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="main"]',
    );
    expect(mainBtn.getAttribute('aria-busy')).toBe('false');
  });

  it('indicator appears when send starts on active tab', async () => {
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p.requestUpdate();
    await settle(p);
    expect(
      p.shadowRoot.querySelectorAll('.tab-streaming-indicator'),
    ).toHaveLength(0);
    p._input = 'hi';
    await p._send();
    await settle(p);
    const mainBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="main"]',
    );
    expect(
      mainBtn.querySelector('.tab-streaming-indicator'),
    ).toBeTruthy();
  });

  it('indicator disappears when stream completes on active tab', async () => {
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p.requestUpdate();
    await settle(p);
    p._input = 'hi';
    await p._send();
    await settle(p);
    const reqId = started.mock.calls[0][0];
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'done' },
    });
    await settle(p);
    const mainBtn = p.shadowRoot.querySelector(
      '.tab-strip-tab[data-tab-id="main"]',
    );
    expect(
      mainBtn.querySelector('.tab-streaming-indicator'),
    ).toBeNull();
  });

  it('indicator persists after switching away from streaming tab', async () => {
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'turn_abc/agent-00';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'Agent 00');
    p._activeTabId = agentTabId;
    await settle(p);
    p._input = 'work';
    await p._send();
    await settle(p);
    p._activeTabId = 'main';
    await settle(p);
    const agentBtn = p.shadowRoot.querySelector(
      `.tab-strip-tab[data-tab-id="${agentTabId}"]`,
    );
    expect(
      agentBtn.querySelector('.tab-streaming-indicator'),
    ).toBeTruthy();
  });

  it('indicator disappears when stream completes on inactive tab', async () => {
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'turn_abc/agent-00';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'Agent 00');
    p._activeTabId = agentTabId;
    await settle(p);
    p._input = 'hi';
    await p._send();
    await settle(p);
    const reqId = started.mock.calls[0][0];
    p._activeTabId = 'main';
    await settle(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'done' },
    });
    await settle(p);
    const agentBtn = p.shadowRoot.querySelector(
      `.tab-strip-tab[data-tab-id="${agentTabId}"]`,
    );
    expect(
      agentBtn.querySelector('.tab-streaming-indicator'),
    ).toBeNull();
  });

  it('indicator renders in overflow menu too', async () => {
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'turn_abc/agent-00';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'Agent 00');
    p._tabs.get(agentTabId).streaming = true;
    p.requestUpdate();
    await settle(p);
    p.shadowRoot.querySelector('.tab-strip-overflow').click();
    await settle(p);
    const menuItem = p.shadowRoot.querySelector(
      `.tab-strip-overflow-item[data-tab-id="${agentTabId}"]`,
    );
    expect(
      menuItem.querySelector('.tab-streaming-indicator'),
    ).toBeTruthy();
    expect(menuItem.getAttribute('aria-busy')).toBe('true');
  });

  it('indicator is marked aria-hidden', async () => {
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'turn_abc/agent-00';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'Agent 00');
    p._tabs.get(agentTabId).streaming = true;
    p.requestUpdate();
    await settle(p);
    const indicator = p.shadowRoot.querySelector(
      '.tab-streaming-indicator',
    );
    expect(indicator.getAttribute('aria-hidden')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// D2 — chat-tab keyboard cycling (Alt+` / Alt+Shift+`)
// ---------------------------------------------------------------------------

describe('ChatPanel D2 tab cycling shortcuts', () => {
  function pressAltBacktick(shift = false) {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '`',
        altKey: true,
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  it('single-tab mode does not intercept the key', async () => {
    const p = mountPanel();
    await settle(p);
    expect(p._activeTabId).toBe('main');
    pressAltBacktick();
    await settle(p);
    expect(p._activeTabId).toBe('main');
  });

  it('single-tab mode does not preventDefault', async () => {
    const p = mountPanel();
    await settle(p);
    const ev = new KeyboardEvent('keydown', {
      key: '`',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    const spy = vi.spyOn(ev, 'preventDefault');
    document.dispatchEvent(ev);
    await settle(p);
    expect(spy).not.toHaveBeenCalled();
  });

  it('Alt+` cycles to the next tab', async () => {
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabs.set('turn_abc/agent-01', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p._tabLabels.set('turn_abc/agent-01', 'Agent 01');
    p.requestUpdate();
    await settle(p);
    expect(p._activeTabId).toBe('main');
    pressAltBacktick();
    await settle(p);
    expect(p._activeTabId).toBe('turn_abc/agent-00');
    pressAltBacktick();
    await settle(p);
    expect(p._activeTabId).toBe('turn_abc/agent-01');
  });

  it('Alt+Shift+` cycles to the previous tab', async () => {
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabs.set('turn_abc/agent-01', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p._tabLabels.set('turn_abc/agent-01', 'Agent 01');
    p._activeTabId = 'turn_abc/agent-01';
    await settle(p);
    pressAltBacktick(true);
    await settle(p);
    expect(p._activeTabId).toBe('turn_abc/agent-00');
    pressAltBacktick(true);
    await settle(p);
    expect(p._activeTabId).toBe('main');
  });

  it('Alt+` wraps from last to first', async () => {
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p._activeTabId = 'turn_abc/agent-00';
    await settle(p);
    pressAltBacktick();
    await settle(p);
    expect(p._activeTabId).toBe('main');
  });

  it('Alt+Shift+` wraps from first to last', async () => {
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabs.set('turn_abc/agent-01', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p._tabLabels.set('turn_abc/agent-01', 'Agent 01');
    p.requestUpdate();
    await settle(p);
    pressAltBacktick(true);
    await settle(p);
    expect(p._activeTabId).toBe('turn_abc/agent-01');
  });

  it('preventDefault fires on handled keys', async () => {
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p.requestUpdate();
    await settle(p);
    const ev = new KeyboardEvent('keydown', {
      key: '`',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    const spy = vi.spyOn(ev, 'preventDefault');
    document.dispatchEvent(ev);
    await settle(p);
    expect(spy).toHaveBeenCalled();
  });

  it('Ctrl+Alt+` is ignored (WM conflict)', async () => {
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p.requestUpdate();
    await settle(p);
    const ev = new KeyboardEvent('keydown', {
      key: '`',
      altKey: true,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(ev);
    await settle(p);
    expect(p._activeTabId).toBe('main');
  });

  it('Meta+Alt+` is ignored (macOS conflict)', async () => {
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p.requestUpdate();
    await settle(p);
    const ev = new KeyboardEvent('keydown', {
      key: '`',
      altKey: true,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(ev);
    await settle(p);
    expect(p._activeTabId).toBe('main');
  });

  it('plain backtick (no Alt) does not cycle', async () => {
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p.requestUpdate();
    await settle(p);
    const ev = new KeyboardEvent('keydown', {
      key: '`',
      altKey: false,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(ev);
    await settle(p);
    expect(p._activeTabId).toBe('main');
  });

  it('Alt+1 does not trigger the shortcut', async () => {
    // Alt+1..4 belong to app-shell's dialog-tab
    // shortcuts. Pinned to prevent accidental conflicts.
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p.requestUpdate();
    await settle(p);
    const ev = new KeyboardEvent('keydown', {
      key: '1',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    const spy = vi.spyOn(ev, 'preventDefault');
    document.dispatchEvent(ev);
    await settle(p);
    expect(p._activeTabId).toBe('main');
    expect(spy).not.toHaveBeenCalled();
  });

  it('dispatches active-tab-changed on cycle', async () => {
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p.requestUpdate();
    await settle(p);
    const listener = vi.fn();
    p.addEventListener('active-tab-changed', listener);
    try {
      pressAltBacktick();
      await settle(p);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        tabId: 'turn_abc/agent-00',
        previousTabId: 'main',
      });
    } finally {
      p.removeEventListener('active-tab-changed', listener);
    }
  });

  it('disconnect removes the document listener', async () => {
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p.requestUpdate();
    await settle(p);
    const activeTabIdBefore = p._activeTabId;
    p.remove();
    pressAltBacktick();
    expect(p._activeTabId).toBe(activeTabIdBefore);
  });

  it('three-tab cycle: main → agent-00 → agent-01 → main', async () => {
    const p = mountPanel();
    await settle(p);
    p._tabs.set('turn_abc/agent-00', p._makeTabState());
    p._tabs.set('turn_abc/agent-01', p._makeTabState());
    p._tabLabels.set('turn_abc/agent-00', 'Agent 00');
    p._tabLabels.set('turn_abc/agent-01', 'Agent 01');
    p.requestUpdate();
    await settle(p);
    const sequence = [
      'turn_abc/agent-00',
      'turn_abc/agent-01',
      'main',
      'turn_abc/agent-00',
    ];
    for (const expected of sequence) {
      pressAltBacktick();
      await settle(p);
      expect(p._activeTabId).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// URL chip per-tab snapshot / restore (D21 per-tab state)
// ---------------------------------------------------------------------------
//
// Per specs4/5-webapp/agent-browser.md § Per-Tab State.

describe('ChatPanel URL chip per-tab state', () => {
  it('snapshots chips to leaving tab on switch', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    seedTab(p, 'agent-0');
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://main.com', type: 'generic', display_name: 'main' },
    ]);
    await settle(p);
    expect(chipsEl._chips.size).toBe(1);
    p._activeTabId = 'agent-0';
    await settle(p);
    const mainTab = p._tabs.get('main');
    expect(mainTab.urlChips).toBeInstanceOf(Map);
    expect(mainTab.urlChips.has('https://main.com')).toBe(true);
  });

  it('restores chips from entering tab snapshot', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    seedTab(p, 'agent-0');
    const agentChips = new Map();
    agentChips.set('https://agent.com', {
      url: 'https://agent.com',
      type: 'generic',
      displayName: 'agent',
      status: 'fetched',
      content: { content: 'body' },
      excluded: false,
    });
    p._tabs.get('agent-0').urlChips = agentChips;
    p._activeTabId = 'agent-0';
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    expect(chipsEl._chips.size).toBe(1);
    expect(chipsEl._chips.has('https://agent.com')).toBe(true);
  });

  it('fresh tab with no snapshot gets empty Map', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    seedTab(p, 'agent-0');
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://main.com', type: 'generic', display_name: 'main' },
    ]);
    await settle(p);
    p._activeTabId = 'agent-0';
    await settle(p);
    expect(chipsEl._chips.size).toBe(0);
  });

  it('round-trip switch preserves per-tab state', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    seedTab(p, 'agent-0');
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://main.com', type: 'generic', display_name: 'main' },
    ]);
    await settle(p);
    p._activeTabId = 'agent-0';
    await settle(p);
    chipsEl.updateDetected([
      { url: 'https://agent.com', type: 'generic', display_name: 'agent' },
    ]);
    await settle(p);
    p._activeTabId = 'main';
    await settle(p);
    expect(chipsEl._chips.has('https://main.com')).toBe(true);
    expect(chipsEl._chips.has('https://agent.com')).toBe(false);
    p._activeTabId = 'agent-0';
    await settle(p);
    expect(chipsEl._chips.has('https://agent.com')).toBe(true);
    expect(chipsEl._chips.has('https://main.com')).toBe(false);
  });

  it('snapshot is a copy, not a reference', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    seedTab(p, 'agent-0');
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://a.com', type: 'generic', display_name: 'a' },
    ]);
    await settle(p);
    p._activeTabId = 'agent-0';
    await settle(p);
    const snapshot = p._tabs.get('main').urlChips;
    const snapshotSize = snapshot.size;
    chipsEl._chips = new Map();
    chipsEl._chips.set('https://new.com', {
      url: 'https://new.com',
      type: 'generic',
      displayName: 'new',
      status: 'detected',
      excluded: false,
    });
    expect(snapshot.size).toBe(snapshotSize);
    expect(snapshot.has('https://new.com')).toBe(false);
  });

  it('session-changed clears all per-tab snapshots', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    seedTab(p, 'agent-0');
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://main.com', type: 'generic', display_name: 'main' },
    ]);
    await settle(p);
    p._activeTabId = 'agent-0';
    await settle(p);
    expect(p._tabs.get('main').urlChips).not.toBeNull();
    pushEvent('session-changed', {
      session_id: 'sess_new',
      messages: [],
    });
    await settle(p);
    for (const tab of p._tabs.values()) {
      expect(tab.urlChips).toBeNull();
    }
  });

  it('no-op when switching to same tab', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://a.com', type: 'generic', display_name: 'a' },
    ]);
    await settle(p);
    expect(p._tabs.get('main').urlChips).toBeNull();
    p._activeTabId = 'main';
    await settle(p);
    expect(p._tabs.get('main').urlChips).toBeNull();
  });

  it('snapshot survives when element not yet rendered', async () => {
    // Defensive — pre-first-render switches must
    // tolerate a missing element.
    publishFakeRpc({});
    const p = mountPanel();
    p._tabs.set('agent-0', p._makeTabState());
    expect(() => {
      p._activeTabId = 'agent-0';
    }).not.toThrow();
  });
});