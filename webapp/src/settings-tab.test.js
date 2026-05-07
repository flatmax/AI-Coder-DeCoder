import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import './settings-tab.js';
import { SharedRpc } from './rpc.js';

// -----------------------------------------------------------
// Test harness
// -----------------------------------------------------------
//
// Follows the pattern from chat-panel.test.js: install a
// flat object as the SharedRpc proxy, keyed by
// "Service.method" names. Each handler returns a
// single-key envelope `{ fake: value }` matching
// jrpc-oo's multi-remote shape — rpcExtract unwraps
// the single key automatically.

const _mounted = [];

function mountTab() {
  const el = document.createElement('ac-settings-tab');
  document.body.appendChild(el);
  _mounted.push(el);
  return el;
}

function publishFakeRpc(methods) {
  const proxy = {};
  for (const [name, impl] of Object.entries(methods)) {
    proxy[name] = async (...args) => {
      const value = await impl(...args);
      return { fake: value };
    };
  }
  SharedRpc.set(proxy);
}

async function settle(el) {
  // Three round-trips to let async RPC handlers complete.
  // _loadToggles does: await rpcExtract → update _toggles
  //   → Lit re-render. Each await yields to the
  //   microtask queue once; we need at least two passes
  //   to let the chain settle, plus a final updateComplete.
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

afterEach(() => {
  while (_mounted.length) {
    const el = _mounted.pop();
    el.remove();
  }
  SharedRpc.reset();
});

// -----------------------------------------------------------
// Helpers to reach into the shadow tree
// -----------------------------------------------------------

function getToggleCard(el) {
  return el.shadowRoot.querySelector('.card.toggle-card');
}

function getToggleSwitch(el) {
  return el.shadowRoot.querySelector('.toggle-switch');
}

function getToggleDescription(el) {
  return el.shadowRoot.querySelector('.card-description');
}

// -----------------------------------------------------------
// Tests
// -----------------------------------------------------------

describe('ac-settings-tab agentic toggle', () => {
  describe('rendering', () => {
    beforeEach(() => {
      publishFakeRpc({
        'Settings.get_config_info': () => ({
          model: 'anthropic/sonnet',
          config_dir: '/tmp/config',
        }),
        'Settings.get_config_content': (key) => {
          if (key === 'app') {
            return {
              type: 'app',
              content: JSON.stringify({ agents: { enabled: false } }),
            };
          }
          return { type: key, content: '' };
        },
      });
    });

    it('renders a toggle card for the agents field', async () => {
      const el = mountTab();
      await settle(el);
      const card = getToggleCard(el);
      expect(card).toBeTruthy();
      expect(card.textContent).toContain('Agentic coding');
    });

    it('renders the description text', async () => {
      const el = mountTab();
      await settle(el);
      const desc = getToggleDescription(el);
      expect(desc).toBeTruthy();
      expect(desc.textContent.toLowerCase()).toContain(
        'decompose',
      );
    });

    it('reflects the backend state as OFF initially', async () => {
      const el = mountTab();
      await settle(el);
      const sw = getToggleSwitch(el);
      expect(sw.getAttribute('aria-checked')).toBe('false');
      expect(sw.classList.contains('on')).toBe(false);
    });

    it('reflects the backend state as ON when enabled', async () => {
      publishFakeRpc({
        'Settings.get_config_info': () => ({}),
        'Settings.get_config_content': (key) => {
          if (key === 'app') {
            return {
              type: 'app',
              content: JSON.stringify({ agents: { enabled: true } }),
            };
          }
          return { type: key, content: '' };
        },
      });
      const el = mountTab();
      await settle(el);
      const sw = getToggleSwitch(el);
      expect(sw.getAttribute('aria-checked')).toBe('true');
      expect(sw.classList.contains('on')).toBe(true);
    });

    it('defaults to OFF when the agents section is missing', async () => {
      publishFakeRpc({
        'Settings.get_config_info': () => ({}),
        'Settings.get_config_content': (key) => {
          if (key === 'app') {
            return { type: 'app', content: JSON.stringify({}) };
          }
          return { type: key, content: '' };
        },
      });
      const el = mountTab();
      await settle(el);
      const sw = getToggleSwitch(el);
      expect(sw.getAttribute('aria-checked')).toBe('false');
    });

    it('defaults to OFF when app.json has malformed JSON', async () => {
      publishFakeRpc({
        'Settings.get_config_info': () => ({}),
        'Settings.get_config_content': (key) => {
          if (key === 'app') {
            return { type: 'app', content: '{not valid json' };
          }
          return { type: key, content: '' };
        },
      });
      const el = mountTab();
      await settle(el);
      const sw = getToggleSwitch(el);
      expect(sw.getAttribute('aria-checked')).toBe('false');
    });

    it('defaults to OFF when app.json is empty', async () => {
      publishFakeRpc({
        'Settings.get_config_info': () => ({}),
        'Settings.get_config_content': (key) => {
          if (key === 'app') {
            return { type: 'app', content: '' };
          }
          return { type: key, content: '' };
        },
      });
      const el = mountTab();
      await settle(el);
      const sw = getToggleSwitch(el);
      expect(sw.getAttribute('aria-checked')).toBe('false');
    });
  });

  describe('toggle interaction', () => {
    let saves;
    let state;

    beforeEach(() => {
      saves = [];
      state = { agents: { enabled: false } };
      publishFakeRpc({
        'Settings.get_config_info': () => ({}),
        'Settings.get_config_content': (key) => {
          if (key === 'app') {
            return {
              type: 'app',
              content: JSON.stringify(state),
            };
          }
          return { type: key, content: '' };
        },
        'Settings.save_config_content': (key, content) => {
          saves.push({ key, content });
          // Update "disk" state so next read sees the write.
          if (key === 'app') {
            try {
              state = JSON.parse(content);
            } catch (err) {
              // Preserve state; test only asserts on saves.
            }
          }
          return { status: 'ok' };
        },
      });
    });

    it('flips the switch on click (off → on)', async () => {
      const el = mountTab();
      await settle(el);
      const sw = getToggleSwitch(el);
      expect(sw.getAttribute('aria-checked')).toBe('false');

      sw.click();
      await settle(el);

      expect(sw.getAttribute('aria-checked')).toBe('true');
      expect(sw.classList.contains('on')).toBe(true);
    });

    it('writes the new value to app.json', async () => {
      const el = mountTab();
      await settle(el);
      const sw = getToggleSwitch(el);
      sw.click();
      await settle(el);

      expect(saves.length).toBe(1);
      expect(saves[0].key).toBe('app');
      const parsed = JSON.parse(saves[0].content);
      expect(parsed.agents.enabled).toBe(true);
    });

    it('flips back on second click (on → off)', async () => {
      state = { agents: { enabled: true } };
      const el = mountTab();
      await settle(el);
      const sw = getToggleSwitch(el);
      expect(sw.getAttribute('aria-checked')).toBe('true');

      sw.click();
      await settle(el);

      expect(sw.getAttribute('aria-checked')).toBe('false');
      const parsed = JSON.parse(saves[0].content);
      expect(parsed.agents.enabled).toBe(false);
    });

    it('preserves other fields in app.json', async () => {
      state = {
        agents: { enabled: false },
        compaction: { trigger_tokens: 20000 },
        doc_index: { keyword_model: 'some-model' },
      };
      const el = mountTab();
      await settle(el);
      const sw = getToggleSwitch(el);
      sw.click();
      await settle(el);

      const parsed = JSON.parse(saves[0].content);
      expect(parsed.agents.enabled).toBe(true);
      expect(parsed.compaction.trigger_tokens).toBe(20000);
      expect(parsed.doc_index.keyword_model).toBe('some-model');
    });

    it('creates the agents section if missing', async () => {
      state = { compaction: { trigger_tokens: 20000 } };
      const el = mountTab();
      await settle(el);
      const sw = getToggleSwitch(el);
      sw.click();
      await settle(el);

      const parsed = JSON.parse(saves[0].content);
      expect(parsed.agents).toEqual({ enabled: true });
      expect(parsed.compaction.trigger_tokens).toBe(20000);
    });

    it('does not re-save while a toggle is in flight', async () => {
      const el = mountTab();
      await settle(el);
      const sw = getToggleSwitch(el);
      // Two rapid clicks — the second should be dropped
      // because _togglingKey is set between them.
      sw.click();
      sw.click();
      await settle(el);
      expect(saves.length).toBe(1);
    });

    it('shows an error toast on malformed JSON during save', async () => {
      // Fresh RPC that returns malformed JSON on read —
      // the toggle-click path can't parse, so it bails
      // before calling save.
      SharedRpc.reset();
      const localSaves = [];
      publishFakeRpc({
        'Settings.get_config_info': () => ({}),
        'Settings.get_config_content': (key) => {
          if (key === 'app') {
            return { type: 'app', content: '{broken' };
          }
          return { type: key, content: '' };
        },
        'Settings.save_config_content': (key, content) => {
          localSaves.push({ key, content });
          return { status: 'ok' };
        },
      });
      const el = mountTab();
      const toastEvents = [];
      window.addEventListener('ac-toast', (e) => {
        toastEvents.push(e.detail);
      });
      await settle(el);
      const sw = getToggleSwitch(el);
      sw.click();
      await settle(el);
      expect(localSaves.length).toBe(0); // no save attempted
      const errorToasts = toastEvents.filter(
        (t) => t.type === 'error',
      );
      expect(errorToasts.length).toBeGreaterThan(0);
      expect(errorToasts[0].message.toLowerCase()).toContain(
        'not valid json',
      );
    });
  });
});