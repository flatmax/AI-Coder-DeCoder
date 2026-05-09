import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountViewer, settle, setFakeRpc, clearFakeRpc, monacoState, beforeEachSetup } from './test-helpers.js';

beforeEach(beforeEachSetup);

describe('DiffViewer dirty tracking', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (_path, ref) =>
        ref === 'HEAD' ? 'original' : 'original',
      ),
    });
  });

  it('file is not dirty immediately after open', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    expect(el.getDirtyFiles()).toEqual([]);
    expect(el._dirty).toBe(false);
  });

  it('editing the content marks the file dirty', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    // Simulate user typing via the mock editor.
    monacoState.editors[0]._simulateContentChange('edited');
    await settle(el);
    expect(el.getDirtyFiles()).toEqual(['a.py']);
    expect(el._dirty).toBe(true);
  });

  it('saving clears the dirty flag and fires file-saved', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('edited');
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    await el._saveFile('a.py');
    await settle(el);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail.path).toBe('a.py');
    expect(listener.mock.calls[0][0].detail.content).toBe('edited');
    expect(el.getDirtyFiles()).toEqual([]);
  });

  it('saveAll saves the active file when dirty', async () => {
    // Single-file model: saveAll is a one-file operation.
    // Edits to a prior file were discarded on switch per
    // the no-cache contract, so there's nothing to save
    // across multiple files.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('a-edited');
    await settle(el);
    expect(el.getDirtyFiles()).toEqual(['a.py']);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    await el.saveAll();
    expect(listener).toHaveBeenCalledOnce();
    expect(el.getDirtyFiles()).toEqual([]);
  });

  it('saveAll no-op when active file is clean', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('file-saved', listener);
    await el.saveAll();
    expect(listener).not.toHaveBeenCalled();
  });

  it('switching away discards unsaved edits', async () => {
    // The defining assertion of the no-cache contract.
    // Edits to `a.py` are gone after opening `b.py` — no
    // multi-file dirty set, no preserved buffer.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('a-edited');
    await settle(el);
    expect(el.getDirtyFiles()).toEqual(['a.py']);
    await el.openFile({ path: 'b.py' });
    await settle(el);
    // Fresh fetch of b.py from the mock returns its HEAD
    // content; the in-flight edit to a.py is discarded.
    expect(el.getDirtyFiles()).toEqual([]);
    expect(el._file.path).toBe('b.py');
  });
});

// ---------------------------------------------------------------------------
// Virtual files
// ---------------------------------------------------------------------------

describe('DiffViewer virtual files', () => {
  it('opens a virtual file with explicit content', async () => {
    // Virtual files need no RPC.
    const el = mountViewer();
    await settle(el);
    await el.openFile({
      path: 'virtual://example',
      virtualContent: 'hello world',
    });
    await settle(el);
    expect(el._file.modified).toBe('hello world');
    expect(el._file.isVirtual).toBe(true);
  });

  it('virtual files are never dirty even after edit', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({
      path: 'virtual://example',
      virtualContent: 'x',
    });
    await settle(el);
    monacoState.editors[0]._simulateContentChange('y');
    await settle(el);
    // Dirty check treats virtual as read-only.
    expect(el.getDirtyFiles()).toEqual([]);
  });

  it('virtual files never trigger RPC fetches', async () => {
    const rpc = vi.fn();
    setFakeRpc({ 'Repo.get_file_content': rpc });
    const el = mountViewer();
    await settle(el);
    await el.openFile({
      path: 'virtual://thing',
      virtualContent: 'content',
    });
    await settle(el);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('closing a virtual file clears the slot', async () => {
    // No persistent content map in the single-file
    // model — virtual content lives on _file.modified
    // while the file is open and is discarded on close.
    const el = mountViewer();
    await settle(el);
    await el.openFile({
      path: 'virtual://thing',
      virtualContent: 'x',
    });
    await settle(el);
    expect(el._file?.modified).toBe('x');
    el.closeFile('virtual://thing');
    await settle(el);
    expect(el._file).toBe(null);
    expect(el.hasOpenFiles).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadPanel — ad-hoc comparison
// ---------------------------------------------------------------------------

describe('DiffViewer loadPanel', () => {
  it('activates the virtual-comparison slot when no file is open', async () => {
    // Single-file model: loadPanel populates the
    // dedicated _virtualComparison slot, not a file
    // entry in a list. The two slots are mutually
    // exclusive.
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('content for left', 'left', 'source A');
    await settle(el);
    expect(el._file).toBe(null);
    expect(el._virtualComparison.leftContent).toBe('content for left');
    expect(el._virtualComparison.rightContent).toBe('');
    expect(el._virtualComparison.leftLabel).toBe('source A');
  });

  it('accumulates both panels in the virtual-comparison slot', async () => {
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('left content', 'left', 'L');
    await settle(el);
    await el.loadPanel('right content', 'right', 'R');
    await settle(el);
    const slot = el._virtualComparison;
    expect(slot.leftContent).toBe('left content');
    expect(slot.rightContent).toBe('right content');
    expect(slot.leftLabel).toBe('L');
    expect(slot.rightLabel).toBe('R');
  });

  it('opening a real file clears the virtual slot', async () => {
    // D18 contract: _file and _virtualComparison are
    // mutually exclusive. Opening a real file must
    // clobber any ad-hoc comparison.
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'repo content'),
    });
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('compare text', 'left', 'reference');
    await settle(el);
    expect(el._virtualComparison).not.toBe(null);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(el._virtualComparison).toBe(null);
    expect(el._file?.path).toBe('src/main.py');
  });

  it('rejects invalid panel arguments', async () => {
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('x', 'middle', 'label');
    await settle(el);
    expect(el.hasOpenFiles).toBe(false);
  });

  it('stores panel label on the virtual slot', async () => {
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('content', 'left', 'history-source');
    await settle(el);
    expect(el._virtualComparison.leftLabel).toBe('history-source');
  });
});

// ---------------------------------------------------------------------------
// Viewport state
// ---------------------------------------------------------------------------

describe('DiffViewer viewport state (no-cache contract)', () => {
  // D18: per-file viewport state is NOT preserved in
  // the single-file model. Every openFile starts at
  // the top; users who accept no-cache accept losing
  // scroll position on switch.
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
    });
  });

  it('no viewport state field exists', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    expect(el._viewportStates).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// refreshOpenFiles
// ---------------------------------------------------------------------------

describe('DiffViewer refreshOpenFiles', () => {
  it('re-fetches all non-virtual open files', async () => {
    let version = 1;
    const rpc = vi.fn(async (path, ref) => {
      return ref === 'HEAD'
        ? `HEAD:${path}:v${version}`
        : `WORK:${path}:v${version}`;
    });
    setFakeRpc({ 'Repo.get_file_content': rpc });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    expect(el._file.original).toContain('v1');
    version = 2;
    await el.refreshOpenFiles();
    await settle(el);
    expect(el._file.original).toContain('v2');
    expect(el._file.modified).toContain('v2');
  });

  it('does not re-fetch virtual files', async () => {
    const rpc = vi.fn(async () => 'x');
    setFakeRpc({ 'Repo.get_file_content': rpc });
    const el = mountViewer();
    await settle(el);
    await el.openFile({
      path: 'virtual://thing',
      virtualContent: 'content',
    });
    await settle(el);
    rpc.mockClear();
    await el.refreshOpenFiles();
    await settle(el);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refreshActiveFile is a no-op when virtual comparison is active', async () => {
    // loadPanel populates _virtualComparison, not _file.
    // refreshActiveFile must recognise this and skip —
    // there's no backing disk state to refetch, and
    // re-entering the fetch path would either fail or
    // clobber the ad-hoc comparison content.
    const rpc = vi.fn(async () => 'should not be called');
    setFakeRpc({ 'Repo.get_file_content': rpc });
    const el = mountViewer();
    await settle(el);
    await el.loadPanel('left side', 'left', 'A');
    await el.loadPanel('right side', 'right', 'B');
    await settle(el);
    expect(el._virtualComparison).not.toBe(null);
    expect(el._file).toBe(null);
    // refreshActiveFile with only a virtual comparison
    // should not hit the RPC and should leave both sides
    // intact.
    await el.refreshActiveFile();
    await settle(el);
    expect(rpc).not.toHaveBeenCalled();
    expect(el._virtualComparison.leftContent).toBe('left side');
    expect(el._virtualComparison.rightContent).toBe('right side');
  });
});

// ---------------------------------------------------------------------------
// relayout — called by app shell on dialog / window resize
// ---------------------------------------------------------------------------

describe('DiffViewer relayout', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
    });
  });

  it('calls editor.layout() when an editor is active', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const editor = monacoState.editors[0];
    editor.layout.mockClear();
    el.relayout();
    expect(editor.layout).toHaveBeenCalledOnce();
  });

  it('is a no-op when no file is open', async () => {
    const el = mountViewer();
    await settle(el);
    // No editor constructed yet — relayout must not
    // throw.
    expect(() => el.relayout()).not.toThrow();
    expect(monacoState.editors.length).toBe(0);
  });

  it('survives Monaco layout throwing', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    const editor = monacoState.editors[0];
    editor.layout.mockImplementation(() => {
      throw new Error('detached');
    });
    // Swallowed — a transient layout failure during
    // rapid unmount / remount must not propagate into
    // the RAF loop.
    expect(() => el.relayout()).not.toThrow();
  });

  it('calls layout on the current editor after a file switch', async () => {
    // _swapModel reuses the editor instance. Verify
    // relayout hits the same editor the viewer is
    // currently displaying — no stale references.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    await el.openFile({ path: 'b.py' });
    await settle(el);
    // Single-editor reuse means only one instance
    // exists.
    expect(monacoState.editors.length).toBe(1);
    const editor = monacoState.editors[0];
    editor.layout.mockClear();
    el.relayout();
    expect(editor.layout).toHaveBeenCalledOnce();
  });
});