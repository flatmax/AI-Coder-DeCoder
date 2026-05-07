// Tests for webapp/src/files-tab.js — left-panel resizer
// slice (drag-to-resize splitter, double-click collapse,
// localStorage persistence). Extracted from
// files-tab.test.js.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../files-tab.js';
import {
  mountTab,
  publishFakeRpc,
  settle,
  fakeTreeResponse,
  installCleanup,
} from './test-helpers.js';

installCleanup();

// ---------------------------------------------------------------------------
// Left-panel resizer (Commit C)
// ---------------------------------------------------------------------------
//
// specs4/5-webapp/file-picker.md § Left Panel Resizer pins the
// draggable handle, the min/max constraints, and the
// double-click-to-collapse interaction. Width and collapsed
// state persist to localStorage.

describe('FilesTab left-panel resizer', () => {
  /**
   * Fire a pointer event on the splitter with the given
   * clientX. The handler reads event.clientX and
   * event.button directly; jsdom doesn't need a real
   * pointer capture target.
   */
  function firePointerDown(tab, clientX) {
    const splitter = tab.shadowRoot.querySelector('.splitter');
    const ev = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
    });
    splitter.dispatchEvent(ev);
    return ev;
  }

  function fireDocPointerMove(clientX) {
    const ev = new MouseEvent('pointermove', {
      bubbles: true,
      clientX,
    });
    document.dispatchEvent(ev);
    return ev;
  }

  function fireDocPointerUp() {
    const ev = new MouseEvent('pointerup', { bubbles: true });
    document.dispatchEvent(ev);
    return ev;
  }

  /**
   * Stub the tab's host getBoundingClientRect so the
   * 50%-of-host clamp has a predictable ceiling in
   * jsdom (which otherwise returns zeros).
   */
  function stubHostWidth(tab, width) {
    tab.getBoundingClientRect = () => ({
      width,
      height: 600,
      top: 0,
      left: 0,
      right: width,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON() {},
    });
  }

  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('renders splitter between picker and chat panes', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    const splitter = t.shadowRoot.querySelector('.splitter');
    expect(splitter).toBeTruthy();
    // Splitter is a sibling of .picker-pane and
    // .chat-pane, sitting between them in the flex
    // layout.
    const children = Array.from(t.shadowRoot.children).filter(
      (el) =>
        el.classList.contains('picker-pane') ||
        el.classList.contains('splitter') ||
        el.classList.contains('chat-pane'),
    );
    expect(children[0].classList.contains('picker-pane')).toBe(true);
    expect(children[1].classList.contains('splitter')).toBe(true);
    expect(children[2].classList.contains('chat-pane')).toBe(true);
  });

  it('picker-pane has default width on first mount', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    const pane = t.shadowRoot.querySelector('.picker-pane');
    expect(pane.style.width).toBe('280px');
  });

  it('drag updates picker width live and commits on pointerup', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    stubHostWidth(t, 1000);
    firePointerDown(t, 300);
    // Drag to x=400 → width 280 + 100 = 380.
    fireDocPointerMove(400);
    const pane = t.shadowRoot.querySelector('.picker-pane');
    // Mid-drag the inline style mutates directly.
    expect(pane.style.width).toBe('380px');
    fireDocPointerUp();
    // After commit, reactive property reflects the new
    // width.
    expect(t._pickerWidthPx).toBe(380);
  });

  it('drag persists width to localStorage', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    stubHostWidth(t, 1000);
    firePointerDown(t, 300);
    fireDocPointerMove(400);
    fireDocPointerUp();
    expect(localStorage.getItem('ac-dc-picker-width')).toBe('380');
  });

  it('drag below minimum clamps to 180px', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    stubHostWidth(t, 1000);
    firePointerDown(t, 300);
    // Drag way left — would produce a negative width.
    fireDocPointerMove(0);
    fireDocPointerUp();
    expect(t._pickerWidthPx).toBe(180);
  });

  it('drag above 50% of host clamps to half', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    stubHostWidth(t, 1000);
    firePointerDown(t, 300);
    // Drag far right — would push past half the host.
    fireDocPointerMove(2000);
    fireDocPointerUp();
    // Half of 1000 = 500.
    expect(t._pickerWidthPx).toBe(500);
  });

  it('non-primary button pointerdown does not start drag', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    stubHostWidth(t, 1000);
    const splitter = t.shadowRoot.querySelector('.splitter');
    splitter.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 2, // right-click
        clientX: 300,
      }),
    );
    // No drag state captured.
    expect(t._splitterDrag).toBeNull();
    // Pointermove should be a no-op because the handler
    // bails on null drag state.
    fireDocPointerMove(500);
    const pane = t.shadowRoot.querySelector('.picker-pane');
    // Width unchanged (inline style empty, default width
    // applied via initial render).
    expect(pane.style.width).toBe('280px');
  });

  it('double-click toggles collapsed state', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._pickerCollapsed).toBe(false);
    const splitter = t.shadowRoot.querySelector('.splitter');
    splitter.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    );
    await t.updateComplete;
    expect(t._pickerCollapsed).toBe(true);
    // Second double-click expands again.
    const splitter2 = t.shadowRoot.querySelector('.splitter');
    splitter2.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    );
    await t.updateComplete;
    expect(t._pickerCollapsed).toBe(false);
  });

  it('collapsed state persists to localStorage', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    const splitter = t.shadowRoot.querySelector('.splitter');
    splitter.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    );
    await t.updateComplete;
    expect(localStorage.getItem('ac-dc-picker-collapsed')).toBe('true');
  });

  it('collapsed render uses affordance width, not stored width', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    // Set an explicit stored width so we can tell the
    // collapsed render isn't using it.
    t._pickerWidthPx = 450;
    await t.updateComplete;
    const splitter = t.shadowRoot.querySelector('.splitter');
    splitter.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    );
    await t.updateComplete;
    const pane = t.shadowRoot.querySelector('.picker-pane');
    // Collapsed width is the 24px affordance, not the
    // stored 450.
    expect(pane.style.width).toBe('24px');
    // But the stored width survives.
    expect(t._pickerWidthPx).toBe(450);
  });

  it('expand restores previously-stored width', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    t._pickerWidthPx = 360;
    await t.updateComplete;
    const splitter = t.shadowRoot.querySelector('.splitter');
    // Collapse.
    splitter.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    );
    await t.updateComplete;
    // Re-query the splitter after collapse — the template
    // may have swapped nodes.
    const splitter2 = t.shadowRoot.querySelector('.splitter');
    // Expand.
    splitter2.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    );
    await t.updateComplete;
    const pane = t.shadowRoot.querySelector('.picker-pane');
    expect(pane.style.width).toBe('360px');
  });

  it('pointerdown in collapsed mode does not start drag', async () => {
    // In collapsed mode the splitter is a click target
    // for expand (via dblclick), not a drag handle.
    // Single-clicks with a pointerdown must not attempt
    // a drag — the originWidth would be meaningless.
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    t._pickerCollapsed = true;
    await t.updateComplete;
    firePointerDown(t, 100);
    expect(t._splitterDrag).toBeNull();
  });

  it('loads width from localStorage on mount', async () => {
    localStorage.setItem('ac-dc-picker-width', '420');
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._pickerWidthPx).toBe(420);
    const pane = t.shadowRoot.querySelector('.picker-pane');
    expect(pane.style.width).toBe('420px');
  });

  it('loads collapsed state from localStorage on mount', async () => {
    localStorage.setItem('ac-dc-picker-collapsed', 'true');
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._pickerCollapsed).toBe(true);
    const pane = t.shadowRoot.querySelector('.picker-pane');
    expect(pane.style.width).toBe('24px');
  });

  it('malformed stored width falls back to default', async () => {
    localStorage.setItem('ac-dc-picker-width', 'garbage');
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._pickerWidthPx).toBe(280);
  });

  it('below-minimum stored width falls back to default', async () => {
    // A stored value below the current minimum (which
    // could happen if we raise the minimum in a future
    // commit) should fall through to the default rather
    // than render at a sub-readable size.
    localStorage.setItem('ac-dc-picker-width', '50');
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._pickerWidthPx).toBe(280);
  });

  it('malformed collapsed value defaults to false', async () => {
    localStorage.setItem('ac-dc-picker-collapsed', 'maybe');
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    expect(t._pickerCollapsed).toBe(false);
  });

  it('disconnect during drag releases document listeners', async () => {
    publishFakeRpc({
      'Repo.get_file_tree': vi
        .fn()
        .mockResolvedValue(fakeTreeResponse([])),
    });
    const t = mountTab();
    await settle(t);
    stubHostWidth(t, 1000);
    firePointerDown(t, 300);
    expect(t._splitterDrag).not.toBeNull();
    t.remove();
    // After disconnect, pointermove on document must
    // not throw (stale handler trying to mutate a
    // detached shadow root).
    expect(() => fireDocPointerMove(500)).not.toThrow();
  });
});