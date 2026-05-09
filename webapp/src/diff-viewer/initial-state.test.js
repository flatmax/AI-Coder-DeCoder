import { beforeEach, describe, expect, it } from 'vitest';
import { mountViewer, settle, monacoState, beforeEachSetup } from './test-helpers.js';

beforeEach(beforeEachSetup);

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('DiffViewer initial state', () => {
  it('renders empty-state watermark when no files open', async () => {
    const el = mountViewer();
    await settle(el);
    const empty = el.shadowRoot.querySelector('.empty-state');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toMatch(/AC.*⚡.*DC/);
  });

  it('has no open files initially', async () => {
    const el = mountViewer();
    await settle(el);
    expect(el.hasOpenFiles).toBe(false);
    expect(el.getDirtyFiles()).toEqual([]);
  });

  it('creates no Monaco editor before any file opens', async () => {
    const el = mountViewer();
    await settle(el);
    expect(monacoState.editors.length).toBe(0);
  });
});