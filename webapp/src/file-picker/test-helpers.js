// Shared fixtures for the file-picker test suite.
//
// This module is consumed by the webapp/src/file-picker/*.test.js
// files split out from the original webapp/src/file-picker.test.js.
// Keeping the helpers here ensures every split shard builds the
// same node literals, status-data shapes, and mount/cleanup
// machinery — drift between shards would silently weaken the
// suite.

import { afterEach } from 'vitest';

// Importing the component module registers the <ac-file-picker>
// custom element as a side effect. Every test file pulls in this
// helpers module, so the registration happens exactly once per
// shard regardless of which tests load first.
import '../file-picker.js';

/**
 * Build a minimal tree-node literal for a file.
 */
export function file(path, lines = 0, mtime = 0) {
  const parts = path.split('/');
  return {
    name: parts[parts.length - 1],
    path,
    type: 'file',
    lines,
    mtime,
  };
}

/**
 * Build a minimal tree-node literal for a directory.
 */
export function dir(path, children) {
  const parts = path.split('/');
  return {
    name: path === '' ? 'root' : parts[parts.length - 1],
    path,
    type: 'dir',
    lines: 0,
    children,
  };
}

/**
 * Build a root-level tree wrapping the given children.
 */
export function rootOf(children) {
  return {
    name: 'repo',
    path: '',
    type: 'dir',
    lines: 0,
    children,
  };
}

/**
 * Build a statusData object with the given membership sets.
 * Defaults are empty — callers override only the fields they're
 * testing.
 *
 * The top-level membership fields (modified/staged/untracked/
 * deleted) are wrapped in Sets here. `diffStats` is passed
 * through as the caller supplied it: some consumers hand in a
 * plain object, others a Map. Matching the original behaviour
 * from file-picker.test.js means we must not coerce.
 */
export function statusDataOf({
  modified = [],
  staged = [],
  untracked = [],
  deleted = [],
  diffStats = {},
} = {}) {
  return {
    modified: new Set(modified),
    staged: new Set(staged),
    untracked: new Set(untracked),
    deleted: new Set(deleted),
    diffStats,
  };
}

// Module-scoped tracking array so installCleanup() can drain
// every picker mounted during a test, regardless of which test
// file did the mounting.
const _mounted = [];

/** Create, mount, and track a picker instance for cleanup. */
export function mountPicker(props = {}) {
  const p = document.createElement('ac-file-picker');
  Object.assign(p, props);
  document.body.appendChild(p);
  _mounted.push(p);
  return p;
}

/**
 * Register an afterEach hook that removes mounted pickers and
 * clears the persisted sort preferences. Each test file calls
 * this once at module scope to opt into the shared cleanup.
 */
export function installCleanup() {
  afterEach(() => {
    while (_mounted.length) {
      const p = _mounted.pop();
      if (p.isConnected) p.remove();
    }
    // Clear sort preferences so each test starts from defaults.
    // Tests that need to exercise the persistence path set the
    // keys explicitly before mounting.
    try {
      localStorage.removeItem('ac-dc-sort-mode');
      localStorage.removeItem('ac-dc-sort-asc');
    } catch (_err) {
      // ignore
    }
  });
}