import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HANDLE_CLASS,
  HANDLE_GROUP_ID,
  SvgEditor,
} from '../svg-editor.js';
import {
  firePointer,
  installCleanup,
  makeChild,
  makeSvg,
  runDrag,
  stubPointerCapture,
  track,
} from './test-helpers.js';

installCleanup();

// ---------------------------------------------------------------------------
// Drag — pointerdown dispatch
// ---------------------------------------------------------------------------

describe('SvgEditor drag: pointerdown routing', () => {
  it('click on unselected element selects it (no drag)', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    firePointer(svg, 'pointerdown', 15, 15);
    expect(editor.getSelection()).toBe(rect);
    // No drag started — _drag should be null.
    expect(editor._drag).toBe(null);
  });

  it('click on already-selected element starts drag', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    firePointer(svg, 'pointerdown', 15, 15);
    expect(editor._drag).not.toBe(null);
    expect(editor._drag.committed).toBe(false);
  });

  it('pointerdown on empty space does not start a drag', () => {
    // Empty-space pointerdown begins a marquee, not a
    // drag. Without a drag-threshold pointermove and a
    // pointerup, the marquee never renders and has no
    // effect on the selection — preserving it
    // deliberately (see the _onPointerDown comment).
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    firePointer(svg, 'pointerdown', 90, 90);
    firePointer(svg, 'pointerup', 90, 90);
    expect(editor._drag).toBe(null);
    expect(editor.getSelection()).toBe(rect);
  });

  it('captures pointer on drag start', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const capture = stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    firePointer(svg, 'pointerdown', 15, 15, { pointerId: 42 });
    expect(capture.captured).toBe(42);
  });

  it('survives setPointerCapture throwing', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    svg.setPointerCapture = () => {
      throw new Error('unsupported');
    };
    svg.releasePointerCapture = () => {};
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    // Should still start the drag despite capture failing.
    expect(() => firePointer(svg, 'pointerdown', 15, 15)).not.toThrow();
    expect(editor._drag).not.toBe(null);
  });

  it('drag start on unsupported element is a no-op', () => {
    // <foreignObject> isn't in our dispatch table; we
    // treat it as selectable but not draggable. (3.2c.1
    // already treats it as selectable via fallthrough to
    // the outer walker; here we prove the drag doesn't
    // start.) Use a custom-tag element to force the
    // default branch in _captureDragAttributes.
    const svg = track(makeSvg());
    // Create an element whose tag isn't in the dispatch.
    const custom = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'foreignObject',
    );
    custom.getCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    custom.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
    svg.appendChild(custom);
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // Force selection directly — tspan-style resolution
    // would reject non-selectable tags, but foreignObject
    // isn't in either set so setSelection accepts it via
    // fall-through.
    editor._selected = custom;
    vi.spyOn(editor, '_hitTest').mockReturnValue(custom);
    firePointer(svg, 'pointerdown', 5, 5);
    // Drag didn't start because no dispatch matched.
    expect(editor._drag).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Drag — click-without-drag threshold
// ---------------------------------------------------------------------------

describe('SvgEditor drag: click-without-drag threshold', () => {
  it('tiny pointermove does not commit drag', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    firePointer(svg, 'pointerdown', 15, 15);
    // Move by 1 pixel — under the 3px threshold.
    firePointer(svg, 'pointermove', 16, 15);
    expect(editor._drag.committed).toBe(false);
    // Element hasn't moved.
    expect(rect.getAttribute('x')).toBe('10');
    firePointer(svg, 'pointerup', 16, 15);
    // No onChange — this was a click, not a drag.
    expect(changeListener).not.toHaveBeenCalled();
  });

  it('drag beyond threshold commits and fires onChange', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    firePointer(svg, 'pointerdown', 15, 15);
    // Move by 10 pixels — well beyond the 3px threshold.
    firePointer(svg, 'pointermove', 25, 20);
    expect(editor._drag.committed).toBe(true);
    // Element moved by delta (10, 5).
    expect(rect.getAttribute('x')).toBe('20');
    expect(rect.getAttribute('y')).toBe('15');
    firePointer(svg, 'pointerup', 25, 20);
    // onChange fires once on pointerup.
    expect(changeListener).toHaveBeenCalledOnce();
  });

  it('onChange fires only once per drag', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    firePointer(svg, 'pointerdown', 15, 15);
    // Several pointermoves — drag continues through them.
    firePointer(svg, 'pointermove', 20, 15);
    firePointer(svg, 'pointermove', 30, 20);
    firePointer(svg, 'pointermove', 40, 25);
    // Still not fired during move.
    expect(changeListener).not.toHaveBeenCalled();
    firePointer(svg, 'pointerup', 40, 25);
    expect(changeListener).toHaveBeenCalledOnce();
  });

  it('pointermove without active drag is ignored', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    // No pointerdown — just a move.
    firePointer(svg, 'pointermove', 50, 50);
    expect(rect.getAttribute('x')).toBe('10');
  });

  it('pointermove with wrong pointer id is ignored', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    firePointer(svg, 'pointerdown', 15, 15, { pointerId: 1 });
    // Move with a different pointer id (e.g., second
    // finger on a multi-touch device).
    firePointer(svg, 'pointermove', 40, 40, { pointerId: 2 });
    expect(rect.getAttribute('x')).toBe('10');
  });
});

// ---------------------------------------------------------------------------
// Drag — per-element dispatch
// ---------------------------------------------------------------------------

describe('SvgEditor drag: rect', () => {
  it('moves x and y attributes', () => {
    const rect = makeChild('rect', {
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, rect, { x: 15, y: 25 }, { x: 45, y: 55 });
    expect(rect.getAttribute('x')).toBe('40');
    expect(rect.getAttribute('y')).toBe('50');
    // Width and height are unchanged — this is a move.
    expect(rect.getAttribute('width')).toBe('30');
    expect(rect.getAttribute('height')).toBe('40');
  });

  it('handles negative deltas', () => {
    const rect = makeChild('rect', { x: 50, y: 50, width: 10, height: 10 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, rect, { x: 55, y: 55 }, { x: 45, y: 40 });
    expect(rect.getAttribute('x')).toBe('40');
    expect(rect.getAttribute('y')).toBe('35');
  });
});

describe('SvgEditor drag: circle and ellipse', () => {
  it('circle moves cx and cy', () => {
    const circle = makeChild('circle', { cx: 50, cy: 50, r: 10 });
    const svg = track(makeSvg([circle]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, circle, { x: 50, y: 50 }, { x: 60, y: 70 });
    expect(circle.getAttribute('cx')).toBe('60');
    expect(circle.getAttribute('cy')).toBe('70');
    // Radius unchanged.
    expect(circle.getAttribute('r')).toBe('10');
  });

  it('ellipse moves cx and cy', () => {
    const ell = makeChild('ellipse', { cx: 30, cy: 40, rx: 20, ry: 10 });
    const svg = track(makeSvg([ell]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, ell, { x: 30, y: 40 }, { x: 50, y: 55 });
    expect(ell.getAttribute('cx')).toBe('50');
    expect(ell.getAttribute('cy')).toBe('55');
    // Radii unchanged.
    expect(ell.getAttribute('rx')).toBe('20');
    expect(ell.getAttribute('ry')).toBe('10');
  });
});

describe('SvgEditor drag: line', () => {
  it('moves both endpoints by the same delta', () => {
    const line = makeChild('line', { x1: 10, y1: 10, x2: 50, y2: 50 });
    const svg = track(makeSvg([line]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, line, { x: 30, y: 30 }, { x: 40, y: 45 });
    // Delta is (10, 15) — applied to both endpoints.
    expect(line.getAttribute('x1')).toBe('20');
    expect(line.getAttribute('y1')).toBe('25');
    expect(line.getAttribute('x2')).toBe('60');
    expect(line.getAttribute('y2')).toBe('65');
  });
});

describe('SvgEditor drag: polyline and polygon', () => {
  it('polyline shifts every point', () => {
    const poly = makeChild('polyline', {
      points: '10,10 20,20 30,10',
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, poly, { x: 20, y: 15 }, { x: 25, y: 25 });
    // Delta is (5, 10).
    expect(poly.getAttribute('points')).toBe('15,20 25,30 35,20');
  });

  it('polygon shifts every point', () => {
    const poly = makeChild('polygon', {
      points: '0,0 10,0 10,10 0,10',
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, poly, { x: 5, y: 5 }, { x: 15, y: 25 });
    // Delta is (10, 20).
    expect(poly.getAttribute('points')).toBe('10,20 20,20 20,30 10,30');
  });

  it('handles comma-then-space separator verbatim', () => {
    // Input uses "10, 20 30, 40" — round-trip normalizes
    // to "x,y x,y" on output. That's fine; the
    // rendered geometry is identical.
    const poly = makeChild('polyline', {
      points: '10, 20 30, 40',
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, poly, { x: 20, y: 30 }, { x: 25, y: 40 });
    expect(poly.getAttribute('points')).toBe('15,30 35,50');
  });
});

describe('SvgEditor drag: path and g use transform', () => {
  it('path without existing transform gets translate()', () => {
    const path = makeChild('path', { d: 'M 0 0 L 10 10' });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, path, { x: 5, y: 5 }, { x: 15, y: 25 });
    expect(path.getAttribute('transform')).toBe('translate(10 20)');
  });

  it('path with existing transform preserves it', () => {
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10',
      transform: 'rotate(45 5 5)',
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, path, { x: 5, y: 5 }, { x: 15, y: 25 });
    // The existing transform is preserved; our translate
    // is appended.
    const t = path.getAttribute('transform');
    expect(t).toContain('rotate(45 5 5)');
    expect(t).toContain('translate(10 20)');
  });

  it('g element uses transform dispatch', () => {
    const g = makeChild('g');
    const svg = track(makeSvg([g]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, g, { x: 0, y: 0 }, { x: 10, y: 20 });
    expect(g.getAttribute('transform')).toBe('translate(10 20)');
  });

  it('d attribute is not modified', () => {
    const path = makeChild('path', { d: 'M 0 0 L 10 10' });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, path, { x: 5, y: 5 }, { x: 15, y: 25 });
    // d is untouched — all position changes go through
    // transform.
    expect(path.getAttribute('d')).toBe('M 0 0 L 10 10');
  });
});

describe('SvgEditor drag: text', () => {
  it('text without transform uses x/y dispatch', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, text, { x: 15, y: 25 }, { x: 25, y: 40 });
    expect(text.getAttribute('x')).toBe('20');
    expect(text.getAttribute('y')).toBe('35');
  });

  it('text with existing transform uses transform dispatch', () => {
    const text = makeChild('text', {
      x: 10,
      y: 20,
      transform: 'rotate(90)',
    });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, text, { x: 15, y: 25 }, { x: 25, y: 40 });
    // x/y unchanged — existing transform + our translate
    // do the move.
    expect(text.getAttribute('x')).toBe('10');
    expect(text.getAttribute('y')).toBe('20');
    const t = text.getAttribute('transform');
    expect(t).toContain('rotate(90)');
    expect(t).toContain('translate(10 15)');
  });
});

describe('SvgEditor drag: image and use', () => {
  it('image uses x/y dispatch', () => {
    const img = makeChild('image', { x: 5, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([img]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, img, { x: 10, y: 15 }, { x: 20, y: 30 });
    expect(img.getAttribute('x')).toBe('15');
    expect(img.getAttribute('y')).toBe('25');
  });

  it('use element uses x/y dispatch', () => {
    const useEl = makeChild('use', { x: 0, y: 0 });
    const svg = track(makeSvg([useEl]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runDrag(svg, editor, useEl, { x: 5, y: 5 }, { x: 25, y: 35 });
    expect(useEl.getAttribute('x')).toBe('20');
    expect(useEl.getAttribute('y')).toBe('30');
  });
});

describe('SvgEditor drag: incremental application', () => {
  it('repeated pointermoves compute relative to drag origin', () => {
    // Each pointermove should compute the element's new
    // position from the ORIGIN snapshot, not from the
    // previous position. Otherwise moves would compound.
    const rect = makeChild('rect', {
      x: 10,
      y: 10,
      width: 20,
      height: 20,
    });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    firePointer(svg, 'pointerdown', 20, 20);
    // Move to (50, 50) — delta (30, 30). Element at (40, 40).
    firePointer(svg, 'pointermove', 50, 50);
    expect(rect.getAttribute('x')).toBe('40');
    // Move to (60, 80) — delta (40, 60) from origin.
    // Element at (50, 70). NOT (80, 100) which would be
    // the result of compounding from previous position.
    firePointer(svg, 'pointermove', 60, 80);
    expect(rect.getAttribute('x')).toBe('50');
    expect(rect.getAttribute('y')).toBe('70');
    firePointer(svg, 'pointerup', 60, 80);
  });
});

// ---------------------------------------------------------------------------
// Drag — handle tracking
// ---------------------------------------------------------------------------

describe('SvgEditor drag: handle overlay tracking', () => {
  it('handle group repositions during drag', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    // Check handle bounding rect starts around (10, 10).
    const handleRect1 = svg
      .querySelector(`#${HANDLE_GROUP_ID}`)
      .querySelector(`.${HANDLE_CLASS}`);
    const x1 = parseFloat(handleRect1.getAttribute('x'));
    expect(x1).toBeCloseTo(10);
    // Start drag.
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    firePointer(svg, 'pointerdown', 15, 15);
    firePointer(svg, 'pointermove', 35, 15);
    // After moving by 20 in x, handle should be at ~30.
    const handleRect2 = svg
      .querySelector(`#${HANDLE_GROUP_ID}`)
      .querySelector(`.${HANDLE_CLASS}`);
    const x2 = parseFloat(handleRect2.getAttribute('x'));
    expect(x2).toBeCloseTo(30);
    firePointer(svg, 'pointerup', 35, 15);
  });
});

// ---------------------------------------------------------------------------
// Drag — lifecycle edge cases
// ---------------------------------------------------------------------------

describe('SvgEditor drag: lifecycle', () => {
  it('pointercancel treats as pointerup (no commit if not moved)', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    firePointer(svg, 'pointerdown', 15, 15);
    // Cancel without moving.
    firePointer(svg, 'pointercancel', 15, 15);
    expect(editor._drag).toBe(null);
    expect(changeListener).not.toHaveBeenCalled();
  });

  it('pointercancel after commit still fires onChange', () => {
    // pointercancel is routed to the same handler as
    // pointerup. If a drag was already committed, the
    // mutation is already on the element, so we fire
    // onChange rather than rolling back.
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    firePointer(svg, 'pointerdown', 15, 15);
    firePointer(svg, 'pointermove', 40, 40);
    firePointer(svg, 'pointercancel', 40, 40);
    // Element moved; onChange fires.
    expect(rect.getAttribute('x')).toBe('35');
    expect(changeListener).toHaveBeenCalledOnce();
  });

  it('detach during drag rolls back and cancels', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    firePointer(svg, 'pointerdown', 15, 15);
    firePointer(svg, 'pointermove', 40, 40);
    // Element has moved.
    expect(rect.getAttribute('x')).toBe('35');
    editor.detach();
    // Rollback — element back at origin.
    expect(rect.getAttribute('x')).toBe('10');
    expect(rect.getAttribute('y')).toBe('10');
    // onChange never fired (no commit).
    expect(changeListener).not.toHaveBeenCalled();
  });

  it('detach rolls back transform restore for path', () => {
    const path = makeChild('path', { d: 'M 0 0 L 10 10' });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTest').mockReturnValue(path);
    firePointer(svg, 'pointerdown', 5, 5);
    firePointer(svg, 'pointermove', 20, 20);
    // Transform added during drag.
    expect(path.getAttribute('transform')).toBeTruthy();
    editor.detach();
    // Transform removed on rollback since it wasn't there
    // originally.
    expect(path.hasAttribute('transform')).toBe(false);
  });

  it('detach restores original transform when it existed', () => {
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10',
      transform: 'rotate(45)',
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTest').mockReturnValue(path);
    firePointer(svg, 'pointerdown', 5, 5);
    firePointer(svg, 'pointermove', 20, 20);
    editor.detach();
    // Original transform restored.
    expect(path.getAttribute('transform')).toBe('rotate(45)');
  });

  it('releases pointer capture on pointerup', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const capture = stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    firePointer(svg, 'pointerdown', 15, 15, { pointerId: 7 });
    expect(capture.captured).toBe(7);
    firePointer(svg, 'pointerup', 15, 15, { pointerId: 7 });
    expect(capture.releaseCalls).toContain(7);
    expect(capture.captured).toBe(null);
  });
});