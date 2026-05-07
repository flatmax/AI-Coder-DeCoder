// Tests for webapp/src/files-tab.js — exported helpers
// and repoFiles push to the chat panel. Covers
// flattenTreePaths edge cases plus the direct-assignment
// path that keeps chat-panel internal state intact across
// tree reloads.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  mountTab,
  publishFakeRpc,
  settle,
  fakeTreeResponse,
  pushEvent,
  installCleanup,
} from './test-helpers.js';
import { flattenTreePaths } from '../files-tab.js';

installCleanup();

// ---------------------------------------------------------------------------
// flattenTreePaths helper
// ---------------------------------------------------------------------------

describe('flattenTreePaths', () => {
  it('empty / null / undefined input returns empty array', () => {
    expect(flattenTreePaths(null)).toEqual([]);
    expect(flattenTreePaths(undefined)).toEqual([]);
    expect(flattenTreePaths({})).toEqual([]);
  });

  it('single file node produces single-element array', () => {
    const tree = {
      name: 'a.md',
      path: 'a.md',
      type: 'file',
      lines: 5,
    };
    expect(flattenTreePaths(tree)).toEqual(['a.md']);
  });

  it('empty root dir produces empty array', () => {
    const tree = {
      name: 'repo',
      path: '',
      type: 'dir',
      children: [],
    };
    expect(flattenTreePaths(tree)).toEqual([]);
  });

  it('flattens nested directories', () => {
    const tree = {
      name: 'repo',
      path: '',
      type: 'dir',
      children: [
        {
          name: 'src',
          path: 'src',
          type: 'dir',
          children: [
            {
              name: 'main.py',
              path: 'src/main.py',
              type: 'file',
              lines: 10,
            },
            {
              name: 'utils',
              path: 'src/utils',
              type: 'dir',
              children: [
                {
                  name: 'helpers.py',
                  path: 'src/utils/helpers.py',
                  type: 'file',
                  lines: 20,
                },
              ],
            },
          ],
        },
        {
          name: 'README.md',
          path: 'README.md',
          type: 'file',
          lines: 30,
        },
      ],
    };
    const result = flattenTreePaths(tree);
    expect(result).toEqual([
      'src/main.py',
      'src/utils/helpers.py',
      'README.md',
    ]);
  });

  it('skips nodes without a path', () => {
    // Defensive — a malformed tree with a file-type node
    // missing its path shouldn't produce an undefined
    // entry in the output.
    const tree = {
      type: 'dir',
      children: [
        { type: 'file', path: 'good.py' },
        { type: 'file' }, // no path
        { type: 'file', path: '' }, // empty path
      ],
    };
    expect(flattenTreePaths(tree)).toEqual(['good.py']);
  });

  it('skips nodes without a type', () => {
    const tree = {
      type: 'dir',
      children: [
        { path: 'good.py', type: 'file' },
        { path: 'no-type.py' }, // no type
      ],
    };
    expect(flattenTreePaths(tree)).toEqual(['good.py']);
  });

  it('tolerates non-array children', () => {
    const tree = {
      type: 'dir',
      children: 'not an array',
    };
    expect(flattenTreePaths(tree)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// repoFiles push to chat panel
// ---------------------------------------------------------------------------

describe('FilesTab repoFiles push', () => {
  it('pushes flat file list to chat panel on tree load', async () => {
    const getTree = vi.fn().mockResolvedValue(
      fakeTreeResponse([
        { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
        {
          name: 'src',
          path: 'src',
          type: 'dir',
          children: [
            {
              name: 'main.py',
              path: 'src/main.py',
              type: 'file',
              lines: 5,
            },
          ],
        },
      ]),
    );
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    // Flat list reached the chat panel via direct
    // assignment (not via Lit template propagation, which
    // would reset the chat panel's internal state).
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    expect(chat.repoFiles).toEqual(['a.md', 'src/main.py']);
  });

  it('empty tree produces empty repoFiles', async () => {
    const getTree = vi
      .fn()
      .mockResolvedValue(fakeTreeResponse([]));
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    expect(chat.repoFiles).toEqual([]);
  });

  it('updates repoFiles on tree reload', async () => {
    // After a commit, `files-modified` triggers reload.
    // The new file list should replace the old one.
    let callCount = 0;
    const getTree = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(
          fakeTreeResponse([
            { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          ]),
        );
      }
      return Promise.resolve(
        fakeTreeResponse([
          { name: 'a.md', path: 'a.md', type: 'file', lines: 1 },
          { name: 'b.md', path: 'b.md', type: 'file', lines: 2 },
        ]),
      );
    });
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    const chat = t.shadowRoot.querySelector('ac-chat-panel');
    expect(chat.repoFiles).toEqual(['a.md']);
    pushEvent('files-modified', {});
    await settle(t);
    expect(chat.repoFiles).toEqual(['a.md', 'b.md']);
  });
});