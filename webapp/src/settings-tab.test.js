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

  // The agentic-coding card is locked off during early
  // development — `card.locked = true` in CONFIG_CARDS
  // and `_EXPERIMENTAL_ENABLED` is false unless the
  // launcher passed `--experimental` (which sets the
  // `?experimental=1` URL param read at module load).
  // In the test environment the param is absent, so the
  // lock is active and clicks no-op at the handler level.
  // These tests verify the lock is enforced; when the
  // feature unlocks, this suite gets inverted to test
  // the unlocked toggle mechanism.
  describe('lock enforcement (locked=true, experimental off)', () => {
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

    it('switch is rendered disabled', async () => {
      const el = mountTab();
      await settle(el);
      const sw = getToggleSwitch(el);
      expect(sw.disabled).toBe(true);
    });

    it('click does not flip the switch', async () => {
      const el = mountTab();
      await settle(el);
      const sw = getToggleSwitch(el);
      expect(sw.getAttribute('aria-checked')).toBe('false');
      sw.click();
      await settle(el);
      // Still off — the lock guard returned early.
      expect(sw.getAttribute('aria-checked')).toBe('false');
      expect(sw.classList.contains('on')).toBe(false);
    });

    it('click does not write to app.json', async () => {
      const el = mountTab();
      await settle(el);
      const sw = getToggleSwitch(el);
      sw.click();
      await settle(el);
      expect(saves.length).toBe(0);
    });

    it('renders a locked-state note', async () => {
      const el = mountTab();
      await settle(el);
      const note = el.shadowRoot.querySelector(
        '.toggle-readonly-note',
      );
      expect(note).toBeTruthy();
      // The CONFIG_CARDS entry sets `lockedNote: 'Locked
      // — feature in early development'`. The exact
      // wording is the source of truth; the test just
      // confirms a note renders rather than pinning the
      // string verbatim (so a copy-edit of the lockedNote
      // doesn't break this test).
      expect(note.textContent.trim().length).toBeGreaterThan(0);
    });

    it('repeated clicks remain inert', async () => {
      const el = mountTab();
      await settle(el);
      const sw = getToggleSwitch(el);
      sw.click();
      sw.click();
      sw.click();
      await settle(el);
      expect(saves.length).toBe(0);
      expect(sw.getAttribute('aria-checked')).toBe('false');
    });
  });
});