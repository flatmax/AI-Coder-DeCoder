// Shared helpers for the files-tab test suite split.
//
// `webapp/src/files-tab.test.js` is being split into focused
// per-feature modules under `webapp/src/files-tab/`. Each
// split file imports the same mount/settle/RPC plumbing from
// here so the original conventions (jrpc-oo envelope shape,
// RpcMixin microtask timing, automatic cleanup) stay
// consistent across the suite.
//
// No `.test.js` suffix — vitest must not pick this up as a
// test file.

import { afterEach } from 'vitest';

import { SharedRpc } from '../rpc.js';
import './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _mounted = [];

export function mountTab(props = {}) {
  const t = document.createElement('ac-files-tab');
  Object.assign(t, props);
  document.body.appendChild(t);
  _mounted.push(t);
  return t;
}

/**
 * Install a fake RPC proxy matching jrpc-oo's single-key
 * envelope. Stubs `Repo.get_current_branch` by default so
 * every mount doesn't emit a "method not found" warning;
 * callers can override by passing an explicit entry in
 * `methods`. Branch-specific tests override; everyone
 * else gets a valid default ('main', not detached).
 */
export function publishFakeRpc(methods) {
  const merged = {
    'Repo.get_current_branch': () => ({
      branch: 'main',
      detached: false,
      sha: null,
    }),
    ...methods,
  };
  const proxy = {};
  for (const [name, impl] of Object.entries(merged)) {
    proxy[name] = async (...args) => {
      const value = await impl(...args);
      return { fake: value };
    };
  }
  SharedRpc.set(proxy);
  return proxy;
}

/**
 * Full settle — Lit update + microtasks + a couple of animation
 * frames. Needed because the files tab defers its onRpcReady call
 * through a microtask (RpcMixin contract), and the downstream RPC
 * response awaits resolve on the next microtask cycle.
 */
export async function settle(tab) {
  await tab.updateComplete;
  // Drain queued microtasks — RpcMixin's onRpcReady fires
  // on the next microtask; the RPC promise resolves on
  // the one after that.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await tab.updateComplete;
  // Children (picker, chat) may have independent
  // updateComplete cycles — let them settle too.
  const picker = tab.shadowRoot?.querySelector('ac-file-picker');
  if (picker) await picker.updateComplete;
  const chat = tab.shadowRoot?.querySelector('ac-chat-panel');
  if (chat) await chat.updateComplete;
}

export function pushEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** A minimal tree payload matching what Repo.get_file_tree returns. */
export function fakeTreeResponse(children = []) {
  return {
    tree: {
      name: 'repo',
      path: '',
      type: 'dir',
      lines: 0,
      children,
    },
    modified: [],
    staged: [],
    untracked: [],
    deleted: [],
    diff_stats: {},
  };
}

/**
 * Register an `afterEach` hook that unmounts every tab
 * created via `mountTab` during the test and resets the
 * shared RPC proxy. Each split test module calls this once
 * at top level so the cleanup is automatic.
 */
export function installCleanup() {
  afterEach(() => {
    while (_mounted.length) {
      const t = _mounted.pop();
      if (t.isConnected) t.remove();
    }
    SharedRpc.reset();
  });
}