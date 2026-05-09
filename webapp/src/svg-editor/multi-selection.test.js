import { afterEach, describe, expect, it, vi } from 'vitest';

import { SvgEditor } from './index.js';
import {
  firePointer,
  installCleanup,
  makeChild,
  makeSvg,
  stubPointerCapture,
  track,
} from './test-helpers.js';

installCleanup();

describe('SvgEditor multi-selection: shift+click', () => {
  it('shift+click on unselected element adds to selection', () => {
    // Shift+pointerdown begins a pending marquee with
    // the element under the pointer recorded as
    // clickFallbackTarget. Toggle-selection fires when
    // pointerup releases without ever crossing the
    // marquee render threshold — i.e., a real
    // shift+click (no drag).
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    expect(editor.getSelectionSet().size).toBe(1);
    vi.spyOn(editor, '_hitTest').mockReturnValue(r2);
    firePointer(svg, 'pointerdown', 55, 55, { shiftKey: true });
    firePointer(svg, 'pointerup', 55, 55, { shiftKey: true });
    expect(editor.getSelectionSet().size).toBe(2);
    expect(editor.getSelectionSet().has(r1)).toBe(true);
    expect(editor.getSelectionSet().has(r2)).toBe(true);
    // New primary is the just-clicked element.
    expect(editor.getSelection()).toBe(r2);
  });

  it('shift+click on selected element removes from selection', () => {
    // Click-without-drag path: pointerdown opens the
    // marquee, pointerup without a threshold-crossing
    // move resolves to toggle-element on the recorded
    // clickFallbackTarget.
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(r2);
    expect(editor.getSelectionSet().size).toBe(2);
    vi.spyOn(editor, '_hitTest').mockReturnValue(r1);
    firePointer(svg, 'pointerdown', 15, 15, { shiftKey: true });
    firePointer(svg, 'pointerup', 15, 15, { shiftKey: true });
    expect(editor.getSelectionSet().size).toBe(1);
    expect(editor.getSelectionSet().has(r2)).toBe(true);
    expect(editor.getSelectionSet().has(r1)).toBe(false);
  });

  it('shift+click removing primary picks a new primary from remaining', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(r2);
    // r2 is primary (last added).
    expect(editor.getSelection()).toBe(r2);
    vi.spyOn(editor, '_hitTest').mockReturnValue(r2);
    firePointer(svg, 'pointerdown', 55, 55, { shiftKey: true });
    firePointer(svg, 'pointerup', 55, 55, { shiftKey: true });
    // r1 becomes primary.
    expect(editor.getSelection()).toBe(r1);
  });

  it('shift+click removing last element clears primary', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r1);
    vi.spyOn(editor, '_hitTest').mockReturnValue(r1);
    firePointer(svg, 'pointerdown', 15, 15, { shiftKey: true });
    firePointer(svg, 'pointerup', 15, 15, { shiftKey: true });
    expect(editor.getSelection()).toBe(null);
    expect(editor.getSelectionSet().size).toBe(0);
  });

  it('plain click replaces multi-selection with just the clicked element', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const r3 = makeChild('rect', { x: 80, y: 80, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2, r3]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(r2);
    expect(editor.getSelectionSet().size).toBe(2);
    vi.spyOn(editor, '_hitTest').mockReturnValue(r3);
    firePointer(svg, 'pointerdown', 85, 85);
    expect(editor.getSelectionSet().size).toBe(1);
    expect(editor.getSelection()).toBe(r3);
  });

  it('shift+click on non-selectable element is a no-op', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const defs = makeChild('defs');
    const svg = track(makeSvg([r1, defs]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    // Selected r1; shift+click on defs shouldn't add it.
    vi.spyOn(editor, '_hitTest').mockReturnValue(null); // filter rejects defs
    firePointer(svg, 'pointerdown', 0, 0, { shiftKey: true });
    expect(editor.getSelectionSet().size).toBe(1);
    expect(editor.getSelectionSet().has(r1)).toBe(true);
  });
});

describe('SvgEditor multi-selection: rendering', () => {
  function getBBoxRects(svg) {
    const group = svg.querySelector('#svg-editor-handles');
    if (!group) return [];
    return Array.from(group.querySelectorAll('rect')).filter(
      (r) => !r.hasAttribute('data-handle-role'),
    );
  }

  function getHandles(svg) {
    const group = svg.querySelector('#svg-editor-handles');
    if (!group) return [];
    return Array.from(
      group.querySelectorAll('[data-handle-role]'),
    );
  }

  it('single selection renders bbox + resize handles', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    expect(getBBoxRects(svg)).toHaveLength(1);
    expect(getHandles(svg)).toHaveLength(8); // rect: 8 handles
  });

  it('multi-selection renders one bbox per element, no handles', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(r2);
    expect(getBBoxRects(svg)).toHaveLength(2);
    expect(getHandles(svg)).toHaveLength(0);
  });

  it('three-element selection renders three bboxes', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const r3 = makeChild('rect', { x: 80, y: 80, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2, r3]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(r2);
    editor.toggleSelection(r3);
    expect(getBBoxRects(svg)).toHaveLength(3);
  });

  it('clearing selection removes all bboxes', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(r2);
    editor.setSelection(null);
    expect(getBBoxRects(svg)).toHaveLength(0);
  });
});

describe('SvgEditor multi-selection: group drag', () => {
  it('clicking a selected element in multi-selection starts a group drag', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(r2);
    vi.spyOn(editor, '_hitTest').mockReturnValue(r1);
    firePointer(svg, 'pointerdown', 15, 15);
    expect(editor._drag).not.toBe(null);
    expect(editor._drag.entries).toHaveLength(2);
    // Selection stays as-is; drag doesn't collapse it.
    expect(editor.getSelectionSet().size).toBe(2);
  });

  it('group drag moves every element by the same delta', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(r2);
    vi.spyOn(editor, '_hitTest').mockReturnValue(r1);
    firePointer(svg, 'pointerdown', 15, 15);
    firePointer(svg, 'pointermove', 35, 30);
    firePointer(svg, 'pointerup', 35, 30);
    // Both elements translated by (20, 15).
    expect(r1.getAttribute('x')).toBe('30');
    expect(r1.getAttribute('y')).toBe('25');
    expect(r2.getAttribute('x')).toBe('70');
    expect(r2.getAttribute('y')).toBe('65');
  });

  it('group drag fires onChange once', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(r2);
    vi.spyOn(editor, '_hitTest').mockReturnValue(r1);
    firePointer(svg, 'pointerdown', 15, 15);
    firePointer(svg, 'pointermove', 35, 30);
    firePointer(svg, 'pointerup', 35, 30);
    expect(changeListener).toHaveBeenCalledOnce();
  });

  it('group drag with mixed element types', () => {
    const r = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const c = makeChild('circle', { cx: 60, cy: 60, r: 10 });
    const svg = track(makeSvg([r, c]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r);
    editor.toggleSelection(c);
    vi.spyOn(editor, '_hitTest').mockReturnValue(r);
    firePointer(svg, 'pointerdown', 15, 15);
    firePointer(svg, 'pointermove', 25, 25);
    firePointer(svg, 'pointerup', 25, 25);
    // Rect moved via x/y.
    expect(r.getAttribute('x')).toBe('20');
    expect(r.getAttribute('y')).toBe('20');
    // Circle moved via cx/cy.
    expect(c.getAttribute('cx')).toBe('70');
    expect(c.getAttribute('cy')).toBe('70');
  });

  it('detach mid-group-drag rolls back every element', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(r2);
    vi.spyOn(editor, '_hitTest').mockReturnValue(r1);
    firePointer(svg, 'pointerdown', 15, 15);
    firePointer(svg, 'pointermove', 35, 30);
    // Both moved.
    expect(r1.getAttribute('x')).toBe('30');
    expect(r2.getAttribute('x')).toBe('70');
    editor.detach();
    // Both restored.
    expect(r1.getAttribute('x')).toBe('10');
    expect(r1.getAttribute('y')).toBe('10');
    expect(r2.getAttribute('x')).toBe('50');
    expect(r2.getAttribute('y')).toBe('50');
  });

  it('click on unselected element during multi-selection collapses to single', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const r3 = makeChild('rect', { x: 80, y: 80, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2, r3]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(r2);
    vi.spyOn(editor, '_hitTest').mockReturnValue(r3);
    firePointer(svg, 'pointerdown', 85, 85);
    expect(editor.getSelectionSet().size).toBe(1);
    expect(editor.getSelection()).toBe(r3);
    // No drag started — it's a selection click.
    expect(editor._drag).toBe(null);
  });
});

describe('SvgEditor multi-selection: delete', () => {
  it('delete removes every selected element', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(r2);
    editor.deleteSelection();
    expect(r1.parentNode).toBe(null);
    expect(r2.parentNode).toBe(null);
    expect(editor.getSelectionSet().size).toBe(0);
  });

  it('delete via keyboard removes every selected element', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(r2);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete' }),
    );
    expect(r1.parentNode).toBe(null);
    expect(r2.parentNode).toBe(null);
  });

  it('delete fires onChange exactly once for multi-element delete', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const r3 = makeChild('rect', { x: 80, y: 80, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2, r3]));
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(r2);
    editor.toggleSelection(r3);
    editor.deleteSelection();
    expect(changeListener).toHaveBeenCalledOnce();
  });
});

describe('SvgEditor multi-selection: double-click on text', () => {
  it('double-click on text in multi-selection collapses + edits', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const text = makeChild('text', { x: 50, y: 50 });
    text.textContent = 'hello';
    const svg = track(makeSvg([r1, text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(text);
    expect(editor.getSelectionSet().size).toBe(2);
    vi.spyOn(editor, '_hitTest').mockReturnValue(text);
    svg.dispatchEvent(
      new MouseEvent('dblclick', {
        clientX: 55,
        clientY: 55,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Collapsed to just the text.
    expect(editor.getSelectionSet().size).toBe(1);
    expect(editor.getSelection()).toBe(text);
    // Edit opened.
    expect(editor._textEdit).not.toBe(null);
  });
});

describe('SvgEditor marquee', () => {
  /**
   * Stub getBBox on every child so marquee hit-test has
   * stable bounds. Tests explicitly pass element
   * bboxes; makeChild's default is read from x/y/
   * width/height attributes which is fine for rects.
   */
  it('shift+drag on empty space starts a marquee', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    firePointer(svg, 'pointerdown', 200, 200, { shiftKey: true });
    expect(editor._marquee).not.toBe(null);
  });

  it('shift+click empty space without drag clears to no-op', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    firePointer(svg, 'pointerdown', 200, 200, { shiftKey: true });
    firePointer(svg, 'pointerup', 200, 200, { shiftKey: true });
    // Selection unchanged — shift+click (no drag) on
    // empty space is a no-op.
    expect(editor.getSelectionSet().size).toBe(1);
    expect(editor._marquee).toBe(null);
  });

  it('forward drag selects contained elements (containment mode)', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const r3 = makeChild('rect', { x: 200, y: 200, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2, r3]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    // Forward drag from (5, 5) to (100, 100) — contains
    // r1 (10,10,30,30) and r2 (50,50,70,70) but not r3.
    firePointer(svg, 'pointerdown', 5, 5, { shiftKey: true });
    firePointer(svg, 'pointermove', 100, 100);
    firePointer(svg, 'pointerup', 100, 100);
    const set = editor.getSelectionSet();
    expect(set.size).toBe(2);
    expect(set.has(r1)).toBe(true);
    expect(set.has(r2)).toBe(true);
    expect(set.has(r3)).toBe(false);
  });

  it('reverse drag selects overlapping elements (crossing mode)', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    // Reverse drag (bottom-right to top-left) from
    // (25, 25) to (5, 5) — crosses r1's corner.
    firePointer(svg, 'pointerdown', 25, 25, { shiftKey: true });
    firePointer(svg, 'pointermove', 5, 5);
    firePointer(svg, 'pointerup', 5, 5);
    const set = editor.getSelectionSet();
    expect(set.has(r1)).toBe(true);
    expect(set.has(r2)).toBe(false);
  });

  it('marquee adds to baseline selection rather than replacing', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const r3 = makeChild('rect', { x: 80, y: 80, width: 10, height: 10 });
    const svg = track(makeSvg([r1, r2, r3]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // Baseline: r1 selected.
    editor.toggleSelection(r1);
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    // Forward drag that contains r2 and r3 (not r1).
    firePointer(svg, 'pointerdown', 40, 40, { shiftKey: true });
    firePointer(svg, 'pointermove', 100, 100);
    firePointer(svg, 'pointerup', 100, 100);
    const set = editor.getSelectionSet();
    // r1 (baseline) + r2 + r3 (marquee hits).
    expect(set.size).toBe(3);
    expect(set.has(r1)).toBe(true);
    expect(set.has(r2)).toBe(true);
    expect(set.has(r3)).toBe(true);
  });

  it('marquee with no hits leaves baseline unchanged', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    // Drag in an area with nothing.
    firePointer(svg, 'pointerdown', 200, 200, { shiftKey: true });
    firePointer(svg, 'pointermove', 250, 250);
    firePointer(svg, 'pointerup', 250, 250);
    const set = editor.getSelectionSet();
    expect(set.size).toBe(1);
    expect(set.has(r1)).toBe(true);
  });

  it('marquee renders a rect during drag, removes on release', () => {
    const svg = track(makeSvg());
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    firePointer(svg, 'pointerdown', 10, 10, { shiftKey: true });
    firePointer(svg, 'pointermove', 100, 100);
    // Marquee rect present mid-drag.
    expect(svg.querySelector('#svg-editor-marquee')).toBeTruthy();
    firePointer(svg, 'pointerup', 100, 100);
    // Removed after release.
    expect(svg.querySelector('#svg-editor-marquee')).toBe(null);
  });

  it('marquee below threshold does not render a rect', () => {
    const svg = track(makeSvg());
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    firePointer(svg, 'pointerdown', 10, 10, { shiftKey: true });
    // Tiny move — 1px below 3px threshold.
    firePointer(svg, 'pointermove', 11, 10);
    expect(svg.querySelector('#svg-editor-marquee')).toBe(null);
    firePointer(svg, 'pointerup', 11, 10);
    // Still no rect after release (never crossed threshold).
  });

  it('detach mid-marquee removes rect and nulls state', () => {
    const svg = track(makeSvg());
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    firePointer(svg, 'pointerdown', 10, 10, { shiftKey: true });
    firePointer(svg, 'pointermove', 100, 100);
    expect(svg.querySelector('#svg-editor-marquee')).toBeTruthy();
    editor.detach();
    expect(svg.querySelector('#svg-editor-marquee')).toBe(null);
    expect(editor._marquee).toBe(null);
  });

  it('marquee scans direct children of <g> groups', () => {
    // Candidates include BOTH the group and its direct
    // children — scanning stops one level inside <g>.
    // When the marquee contains both, the ancestor-
    // dedupe step (see
    // _removeDescendantsOfSelectedAncestors) drops the
    // inner rect because its ancestor group is also
    // selected. Moving the group moves the rect via the
    // transform chain, so keeping both would produce a
    // double-move on group drag. Assertion: the group
    // survives dedupe; the inner rect does not.
    const group = makeChild('g');
    const inner = makeChild('rect', {
      x: 20,
      y: 20,
      width: 10,
      height: 10,
    });
    group.appendChild(inner);
    // stub getBBox since jsdom's default reads from the
    // element's attributes; inner is inside a <g> but
    // attributes-based bbox is still fine at identity
    // CTM.
    group.getBBox = () => ({ x: 20, y: 20, width: 10, height: 10 });
    const svg = track(makeSvg([group]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    // Forward drag containing the inner rect.
    firePointer(svg, 'pointerdown', 10, 10, { shiftKey: true });
    firePointer(svg, 'pointermove', 40, 40);
    firePointer(svg, 'pointerup', 40, 40);
    const set = editor.getSelectionSet();
    expect(set.has(group)).toBe(true);
    expect(set.has(inner)).toBe(false);
  });
});