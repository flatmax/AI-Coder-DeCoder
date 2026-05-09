import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountViewer, settle, setFakeRpc, clearFakeRpc, monacoState, beforeEachSetup } from './test-helpers.js';

beforeEach(beforeEachSetup);

// ---------------------------------------------------------------------------
// openFile — basic lifecycle
// ---------------------------------------------------------------------------

describe('DiffViewer openFile', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (path, ref) => {
        return ref === 'HEAD' ? `HEAD:${path}` : `WORK:${path}`;
      }),
    });
  });

  it('opens a file and fires active-file-changed', async () => {
    const el = mountViewer();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({
      path: 'src/main.py',
    });
    expect(el.hasOpenFiles).toBe(true);
  });

  it('creates a Monaco editor on first open', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(monacoState.editors.length).toBe(1);
  });

  it('fetches both HEAD and working copy', async () => {
    const el = mountViewer();
    await settle(el);
    const rpc = globalThis.__sharedRpcOverride[
      'Repo.get_file_content'
    ];
    await el.openFile({ path: 'src/foo.py' });
    await settle(el);
    // HEAD fetch + working-copy fetch = 2 calls.
    expect(rpc).toHaveBeenCalledWith('src/foo.py', 'HEAD');
    expect(rpc).toHaveBeenCalledWith('src/foo.py');
  });

  it('handles HEAD fetch failure as a new file', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (_path, ref) => {
        if (ref === 'HEAD') throw new Error('not in HEAD');
        return 'working content';
      }),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'new.py' });
    await settle(el);
    const file = el._file;
    expect(file.isNew).toBe(true);
    expect(file.original).toBe('');
    expect(file.modified).toBe('working content');
  });

  it('handles working-copy fetch failure gracefully', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (_path, ref) => {
        if (ref === 'HEAD') return 'head content';
        throw new Error('deleted');
      }),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'deleted.py' });
    await settle(el);
    const file = el._file;
    expect(file.original).toBe('head content');
    expect(file.modified).toBe('');
  });

  it('handles missing RPC (no SharedRpc) gracefully', async () => {
    clearFakeRpc();
    const el = mountViewer();
    await settle(el);
    // No RPC available; opens with empty content.
    await el.openFile({ path: 'a.py' });
    await settle(el);
    expect(el.hasOpenFiles).toBe(true);
    expect(el._file.original).toBe('');
    expect(el._file.modified).toBe('');
  });

  it('same-file open refetches (no-cache model)', async () => {
    // D18 contract: every openFile fetches fresh. Clicking
    // the same file twice hits the RPC twice, and
    // active-file-changed fires on every open — the viewer
    // rebuilt its models so listeners need to know.
    const el = mountViewer();
    await settle(el);
    const rpc = globalThis.__sharedRpcOverride[
      'Repo.get_file_content'
    ];
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const callsAfterFirst = rpc.mock.calls.length;
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    // Second open fetched HEAD + working again.
    expect(rpc.mock.calls.length).toBe(callsAfterFirst + 2);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('opening a second file creates a new model pair', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const modelsBeforeB = monacoState.models.length;
    await el.openFile({ path: 'b.py' });
    await settle(el);
    // +2 new models (original + modified).
    expect(monacoState.models.length).toBe(modelsBeforeB + 2);
  });

  it('re-opening inactive file swaps models', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    await el.openFile({ path: 'b.py' });
    await settle(el);
    const setModelCalls =
      monacoState.editors[0].setModel.mock.calls.length;
    await el.openFile({ path: 'a.py' });
    await settle(el);
    // +1 setModel call when swapping back to a.
    expect(
      monacoState.editors[0].setModel.mock.calls.length,
    ).toBe(setModelCalls + 1);
    // Still only one editor instance.
    expect(monacoState.editors.length).toBe(1);
  });

  it('disposes old models on swap', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const aOriginal = monacoState.models[0];
    const aModified = monacoState.models[1];
    await el.openFile({ path: 'b.py' });
    await settle(el);
    // a's models disposed (swap triggered).
    expect(aOriginal.dispose).toHaveBeenCalled();
    expect(aModified.dispose).toHaveBeenCalled();
  });

  it('ignores malformed openFile calls', async () => {
    const el = mountViewer();
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    await el.openFile(null);
    await el.openFile({});
    await el.openFile({ path: '' });
    await el.openFile({ path: 42 });
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
    expect(el.hasOpenFiles).toBe(false);
  });

  it('concurrent openFile for same path supersedes', async () => {
    // No-cache model: both calls fetch, but the
    // generation counter ensures only the last resolving
    // fetch attaches its models. End state has one file
    // in the single-file slot.
    const el = mountViewer();
    await settle(el);
    const p1 = el.openFile({ path: 'a.py' });
    const p2 = el.openFile({ path: 'a.py' });
    await Promise.all([p1, p2]);
    await settle(el);
    expect(el._file?.path).toBe('a.py');
  });

  it('concurrent openFile for different paths supersedes to last', async () => {
    // Single-file slot means only the last call's file
    // survives. The first call's fetch resolves with a
    // superseded generation and skips model-attach.
    const el = mountViewer();
    await settle(el);
    const p1 = el.openFile({ path: 'a.py' });
    const p2 = el.openFile({ path: 'b.py' });
    await Promise.all([p1, p2]);
    await settle(el);
    expect(el._file?.path).toBe('b.py');
  });

  it('generation counter discards a slow fetch that resolves late', async () => {
    // A late-resolving fetch from a superseded openFile
    // call must NOT clobber the active file. The
    // generation counter is the guard: each openFile
    // bumps it and captures its value; when the fetch
    // resolves, the handler checks whether the counter
    // has advanced past the captured value, and if so
    // skips model-attach.
    //
    // This test exposes the race directly — manually
    // holds the first fetch open, lets the second
    // complete, then resolves the first. Without the
    // generation guard, the stale fetch's model-attach
    // would overwrite b.py with a.py's stale content.
    let resolveFirst;
    const firstPromise = new Promise((r) => {
      resolveFirst = r;
    });
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (path) => {
        if (path === 'slow.py') return firstPromise;
        return `content of ${path}`;
      }),
    });
    const el = mountViewer();
    await settle(el);
    // Start the slow fetch — don't await yet.
    const slowFetch = el.openFile({ path: 'slow.py' });
    // Second call for a different path. Its fetch
    // resolves immediately.
    await el.openFile({ path: 'fast.py' });
    await settle(el);
    expect(el._file?.path).toBe('fast.py');
    // Now resolve the slow fetch. It's stale — the
    // generation counter has advanced. The active file
    // must stay as fast.py.
    resolveFirst('stale content');
    await slowFetch;
    await settle(el);
    expect(el._file?.path).toBe('fast.py');
    expect(el._file?.modified).not.toBe('stale content');
  });
});

// ---------------------------------------------------------------------------
// closeFile
// ---------------------------------------------------------------------------

describe('DiffViewer closeFile', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => ''),
    });
  });

  it('closes the active file and disposes the editor', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'only.py' });
    await settle(el);
    const editor = monacoState.editors[0];
    el.closeFile('only.py');
    await settle(el);
    expect(el.hasOpenFiles).toBe(false);
    expect(editor.dispose).toHaveBeenCalled();
  });

  it('closing the active file returns to empty state', async () => {
    // Single-file model: closing replaces the active
    // file with nothing. There's no "next file" to
    // activate — specs4 dropped that concept.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('a.py');
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBe(null);
    expect(el.hasOpenFiles).toBe(false);
  });

  it('closing an unknown file is a no-op', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('active-file-changed', listener);
    el.closeFile('does-not-exist.py');
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
  });
});