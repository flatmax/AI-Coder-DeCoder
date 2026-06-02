import { afterEach, describe, expect, it, vi } from 'vitest';
import { SvgEditor } from './index.js';
import {
  firePointer,
  installCleanup,
  makeChild,
  makeSvg,
  runResizeDrag,
  stubPointerCapture,
  track,
} from './test-helpers.js';

installCleanup();

// ---------------------------------------------------------------------------
// Line endpoint resize
// ---------------------------------------------------------------------------

describe('SvgEditor resize drag: line endpoints', () => {
  function getHandles(svg) {
    const group = svg.querySelector('#svg-editor-handles');
    if (!group) return [];
    return Array.from(
      group.querySelectorAll('[data-handle-role]'),
    ).filter(
      (h) => h.getAttribute('data-handle-role') !== 'rotate',
    );
  }

  it('handles positioned at actual endpoint coords', () => {
    // A diagonal line's handles should sit at (x1,y1) and
    // (x2,y2), not at the bounding-box corners. Critical
    // because bbox corners aren't on the line itself and
    // dragging them would require inverse math to map
    // back to endpoint coordinates.
    const line = makeChild('line', { x1: 10, y1: 20, x2: 50, y2: 80 });
    line.getBBox = () => ({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
    const svg = track(makeSvg([line]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(line);
    const handles = getHandles(svg);
    const byRole = {};
    for (const h of handles) {
      byRole[h.getAttribute('data-handle-role')] = {
        cx: parseFloat(h.getAttribute('cx')),
        cy: parseFloat(h.getAttribute('cy')),
      };
    }
    expect(byRole.p1.cx).toBeCloseTo(10);
    expect(byRole.p1.cy).toBeCloseTo(20);
    expect(byRole.p2.cx).toBeCloseTo(50);
    expect(byRole.p2.cy).toBeCloseTo(80);
  });

  it('p1 drag moves x1 and y1 only', () => {
    const line = makeChild('line', { x1: 10, y1: 10, x2: 50, y2: 50 });
    line.getBBox = () => ({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
    const svg = track(makeSvg([line]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, line, 'p1', { x: 10, y: 10 }, { x: 25, y: 30 });
    expect(line.getAttribute('x1')).toBe('25');
    expect(line.getAttribute('y1')).toBe('30');
    // p2 endpoint unchanged.
    expect(line.getAttribute('x2')).toBe('50');
    expect(line.getAttribute('y2')).toBe('50');
  });

  it('p2 drag moves x2 and y2 only', () => {
    const line = makeChild('line', { x1: 10, y1: 10, x2: 50, y2: 50 });
    line.getBBox = () => ({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
    const svg = track(makeSvg([line]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, line, 'p2', { x: 50, y: 50 }, { x: 70, y: 40 });
    expect(line.getAttribute('x2')).toBe('70');
    expect(line.getAttribute('y2')).toBe('40');
    // p1 endpoint unchanged.
    expect(line.getAttribute('x1')).toBe('10');
    expect(line.getAttribute('y1')).toBe('10');
  });

  it('dragging p1 past p2 is allowed (no clamping)', () => {
    // Rect/ellipse clamp at 1 to prevent flipping. Lines
    // don't need clamping: a line whose x1 > x2 renders
    // identically — there's no "visible front face" that
    // would flip. Test proves the drag completes without
    // clamping.
    const line = makeChild('line', { x1: 10, y1: 10, x2: 50, y2: 50 });
    line.getBBox = () => ({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
    const svg = track(makeSvg([line]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(
      svg,
      editor,
      line,
      'p1',
      { x: 10, y: 10 },
      { x: 80, y: 80 },
    );
    // p1 crossed past p2.
    expect(line.getAttribute('x1')).toBe('80');
    expect(line.getAttribute('y1')).toBe('80');
    expect(line.getAttribute('x2')).toBe('50');
    expect(line.getAttribute('y2')).toBe('50');
  });

  it('dragging to same point produces degenerate line', () => {
    // p1 dragged exactly onto p2 — zero-length line. Legal
    // SVG (renders as invisible). Handles still land at
    // identical positions; the user can drag them apart.
    const line = makeChild('line', { x1: 10, y1: 10, x2: 50, y2: 50 });
    line.getBBox = () => ({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
    const svg = track(makeSvg([line]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(
      svg,
      editor,
      line,
      'p1',
      { x: 10, y: 10 },
      { x: 50, y: 50 },
    );
    expect(line.getAttribute('x1')).toBe('50');
    expect(line.getAttribute('y1')).toBe('50');
    expect(line.getAttribute('x2')).toBe('50');
    expect(line.getAttribute('y2')).toBe('50');
  });

  it('negative deltas work on both endpoints', () => {
    const line = makeChild('line', { x1: 50, y1: 50, x2: 80, y2: 80 });
    line.getBBox = () => ({
      x: 50,
      y: 50,
      width: 30,
      height: 30,
    });
    const svg = track(makeSvg([line]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(
      svg,
      editor,
      line,
      'p1',
      { x: 50, y: 50 },
      { x: 30, y: 40 },
    );
    // p1 delta is (-20, -10).
    expect(line.getAttribute('x1')).toBe('30');
    expect(line.getAttribute('y1')).toBe('40');
  });

  it('clicking a p1 handle starts a resize drag', () => {
    const line = makeChild('line', { x1: 10, y1: 10, x2: 50, y2: 50 });
    line.getBBox = () => ({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
    const svg = track(makeSvg([line]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(line);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('p1');
    firePointer(svg, 'pointerdown', 10, 10);
    expect(editor._drag).not.toBe(null);
    expect(editor._drag.mode).toBe('resize');
    expect(editor._drag.role).toBe('p1');
    expect(editor._drag.originAttrs.kind).toBe('line-endpoints');
  });

  it('fires onChange after a committed p2 drag', () => {
    const line = makeChild('line', { x1: 10, y1: 10, x2: 50, y2: 50 });
    line.getBBox = () => ({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
    const svg = track(makeSvg([line]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(line);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('p2');
    firePointer(svg, 'pointerdown', 50, 50);
    firePointer(svg, 'pointermove', 70, 40);
    firePointer(svg, 'pointerup', 70, 40);
    expect(changeListener).toHaveBeenCalledOnce();
  });

  it('tiny p1 move does not commit', () => {
    const line = makeChild('line', { x1: 10, y1: 10, x2: 50, y2: 50 });
    line.getBBox = () => ({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
    const svg = track(makeSvg([line]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(line);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('p1');
    firePointer(svg, 'pointerdown', 10, 10);
    firePointer(svg, 'pointermove', 11, 10);
    firePointer(svg, 'pointerup', 11, 10);
    // Unchanged — below threshold.
    expect(line.getAttribute('x1')).toBe('10');
    expect(line.getAttribute('y1')).toBe('10');
    expect(changeListener).not.toHaveBeenCalled();
  });

  it('detach mid-line-resize restores all four attributes', () => {
    const line = makeChild('line', { x1: 10, y1: 10, x2: 50, y2: 50 });
    line.getBBox = () => ({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
    const svg = track(makeSvg([line]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(line);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('p1');
    firePointer(svg, 'pointerdown', 10, 10);
    firePointer(svg, 'pointermove', 30, 30);
    // Mid-drag mutation visible.
    expect(line.getAttribute('x1')).toBe('30');
    expect(line.getAttribute('y1')).toBe('30');
    editor.detach();
    // All four attributes restored (x2/y2 shouldn't have
    // changed in the first place but the restore path
    // writes them anyway for consistency).
    expect(line.getAttribute('x1')).toBe('10');
    expect(line.getAttribute('y1')).toBe('10');
    expect(line.getAttribute('x2')).toBe('50');
    expect(line.getAttribute('y2')).toBe('50');
  });
});

// ---------------------------------------------------------------------------
// Polyline and polygon vertex resize
// ---------------------------------------------------------------------------

describe('SvgEditor resize drag: polyline vertices', () => {
  function getHandles(svg) {
    const group = svg.querySelector('#svg-editor-handles');
    if (!group) return [];
    return Array.from(
      group.querySelectorAll('[data-handle-role]'),
    ).filter(
      (h) => h.getAttribute('data-handle-role') !== 'rotate',
    );
  }

  it('handles positioned at actual vertex coords', () => {
    // Not at bbox corners — each handle should sit
    // exactly on its vertex.
    const poly = makeChild('polyline', {
      points: '10,20 50,40 90,10',
    });
    poly.getBBox = () => ({
      x: 10,
      y: 10,
      width: 80,
      height: 30,
    });
    const svg = track(makeSvg([poly]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(poly);
    const handles = getHandles(svg);
    const byRole = {};
    for (const h of handles) {
      byRole[h.getAttribute('data-handle-role')] = {
        cx: parseFloat(h.getAttribute('cx')),
        cy: parseFloat(h.getAttribute('cy')),
      };
    }
    expect(byRole.v0).toEqual({ cx: 10, cy: 20 });
    expect(byRole.v1).toEqual({ cx: 50, cy: 40 });
    expect(byRole.v2).toEqual({ cx: 90, cy: 10 });
  });

  it('v0 drag moves only the first vertex', () => {
    const poly = makeChild('polyline', {
      points: '10,10 30,20 50,10',
    });
    poly.getBBox = () => ({
      x: 10,
      y: 10,
      width: 40,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, poly, 'v0', { x: 10, y: 10 }, { x: 20, y: 15 });
    // v0 moved by (10, 5); v1 and v2 unchanged.
    expect(poly.getAttribute('points')).toBe('20,15 30,20 50,10');
  });

  it('v1 drag moves only the middle vertex', () => {
    const poly = makeChild('polyline', {
      points: '10,10 30,20 50,10',
    });
    poly.getBBox = () => ({
      x: 10,
      y: 10,
      width: 40,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, poly, 'v1', { x: 30, y: 20 }, { x: 35, y: 35 });
    expect(poly.getAttribute('points')).toBe('10,10 35,35 50,10');
  });

  it('v2 drag moves only the last vertex', () => {
    const poly = makeChild('polyline', {
      points: '10,10 30,20 50,10',
    });
    poly.getBBox = () => ({
      x: 10,
      y: 10,
      width: 40,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, poly, 'v2', { x: 50, y: 10 }, { x: 60, y: 25 });
    expect(poly.getAttribute('points')).toBe('10,10 30,20 60,25');
  });

  it('handles repeated pointermoves relative to origin', () => {
    // Each pointermove recomputes from the snapshot, not
    // from the previous position — otherwise vertex
    // moves would compound and the user's drag would
    // run away from the pointer.
    const poly = makeChild('polyline', {
      points: '10,10 30,20',
    });
    poly.getBBox = () => ({
      x: 10,
      y: 10,
      width: 20,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(poly);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('v1');
    firePointer(svg, 'pointerdown', 30, 20);
    // Move to (50, 30) — delta (20, 10). v1 at (50, 30).
    firePointer(svg, 'pointermove', 50, 30);
    expect(poly.getAttribute('points')).toBe('10,10 50,30');
    // Move to (60, 40) — delta (30, 20) from origin.
    // v1 should be at (60, 40), NOT (80, 50) which would
    // be the result of compounding.
    firePointer(svg, 'pointermove', 60, 40);
    expect(poly.getAttribute('points')).toBe('10,10 60,40');
    firePointer(svg, 'pointerup', 60, 40);
  });

  it('negative deltas work', () => {
    const poly = makeChild('polyline', {
      points: '50,50 80,80',
    });
    poly.getBBox = () => ({
      x: 50,
      y: 50,
      width: 30,
      height: 30,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, poly, 'v0', { x: 50, y: 50 }, { x: 30, y: 40 });
    expect(poly.getAttribute('points')).toBe('30,40 80,80');
  });

  it('dragging one vertex onto another is allowed', () => {
    // Coincident vertices produce a degenerate edge but
    // the shape is still legal SVG and recoverable.
    const poly = makeChild('polyline', {
      points: '10,10 30,20 50,10',
    });
    poly.getBBox = () => ({
      x: 10,
      y: 10,
      width: 40,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, poly, 'v0', { x: 10, y: 10 }, { x: 30, y: 20 });
    // v0 dragged onto v1.
    expect(poly.getAttribute('points')).toBe('30,20 30,20 50,10');
  });

  it('handles comma-space-mixed input by normalizing on output', () => {
    // Input separator variety shouldn't matter — output
    // uses the canonical comma-between-xy / space-between-
    // pairs form regardless.
    const poly = makeChild('polyline', {
      points: '10, 10 30, 20',
    });
    poly.getBBox = () => ({
      x: 10,
      y: 10,
      width: 20,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, poly, 'v0', { x: 10, y: 10 }, { x: 15, y: 15 });
    expect(poly.getAttribute('points')).toBe('15,15 30,20');
  });

  it('clicking a v0 handle starts a resize drag', () => {
    const poly = makeChild('polyline', {
      points: '10,10 30,20',
    });
    poly.getBBox = () => ({
      x: 10,
      y: 10,
      width: 20,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(poly);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('v0');
    firePointer(svg, 'pointerdown', 10, 10);
    expect(editor._drag).not.toBe(null);
    expect(editor._drag.mode).toBe('resize');
    expect(editor._drag.role).toBe('v0');
    expect(editor._drag.originAttrs.kind).toBe('polyline-vertices');
  });

  it('fires onChange after committed vertex drag', () => {
    const poly = makeChild('polyline', {
      points: '10,10 30,20',
    });
    poly.getBBox = () => ({
      x: 10,
      y: 10,
      width: 20,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(poly);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('v0');
    firePointer(svg, 'pointerdown', 10, 10);
    firePointer(svg, 'pointermove', 30, 30);
    firePointer(svg, 'pointerup', 30, 30);
    expect(changeListener).toHaveBeenCalledOnce();
  });

  it('tiny vertex move does not commit', () => {
    const poly = makeChild('polyline', {
      points: '10,10 30,20',
    });
    poly.getBBox = () => ({
      x: 10,
      y: 10,
      width: 20,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(poly);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('v0');
    firePointer(svg, 'pointerdown', 10, 10);
    firePointer(svg, 'pointermove', 11, 10);
    firePointer(svg, 'pointerup', 11, 10);
    // Below threshold — points unchanged.
    expect(poly.getAttribute('points')).toBe('10,10 30,20');
    expect(changeListener).not.toHaveBeenCalled();
  });

  it('detach mid-vertex-drag restores all points', () => {
    const poly = makeChild('polyline', {
      points: '10,10 30,20 50,10',
    });
    poly.getBBox = () => ({
      x: 10,
      y: 10,
      width: 40,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(poly);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('v1');
    firePointer(svg, 'pointerdown', 30, 20);
    firePointer(svg, 'pointermove', 60, 45);
    // Mid-drag: v1 has moved.
    expect(poly.getAttribute('points')).toBe('10,10 60,45 50,10');
    editor.detach();
    // Restored — all three points back to origin.
    expect(poly.getAttribute('points')).toBe('10,10 30,20 50,10');
  });

  it('ignores malformed role', () => {
    // A snapshot kind of 'polyline-vertices' but a role
    // that isn't `v{N}` should be a no-op rather than
    // crash. Defensive — shouldn't happen in practice
    // because roles come from our own handle rendering.
    const poly = makeChild('polyline', {
      points: '10,10 30,20',
    });
    poly.getBBox = () => ({
      x: 10,
      y: 10,
      width: 20,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(poly);
    // Force a bogus role. _applyVertexResize should bail
    // without mutation.
    editor._drag = {
      mode: 'resize',
      role: 'not-a-vertex',
      pointerId: 1,
      startX: 0,
      startY: 0,
      originAttrs: {
        kind: 'polyline-vertices',
        points: [[10, 10], [30, 20]],
      },
      committed: true,
    };
    editor._applyResizeDelta(5, 5);
    expect(poly.getAttribute('points')).toBe('10,10 30,20');
    editor._drag = null;
  });

  it('ignores out-of-range vertex index', () => {
    const poly = makeChild('polyline', {
      points: '10,10 30,20',
    });
    poly.getBBox = () => ({
      x: 10,
      y: 10,
      width: 20,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(poly);
    editor._drag = {
      mode: 'resize',
      role: 'v99',
      pointerId: 1,
      startX: 0,
      startY: 0,
      originAttrs: {
        kind: 'polyline-vertices',
        points: [[10, 10], [30, 20]],
      },
      committed: true,
    };
    editor._applyResizeDelta(5, 5);
    expect(poly.getAttribute('points')).toBe('10,10 30,20');
    editor._drag = null;
  });
});

describe('SvgEditor resize drag: polygon vertices', () => {
  function getHandles(svg) {
    const group = svg.querySelector('#svg-editor-handles');
    if (!group) return [];
    return Array.from(
      group.querySelectorAll('[data-handle-role]'),
    ).filter(
      (h) => h.getAttribute('data-handle-role') !== 'rotate',
    );
  }

  it('polygon selection produces one handle per vertex', () => {
    const poly = makeChild('polygon', {
      points: '0,0 10,0 10,10 0,10',
    });
    poly.getBBox = () => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(poly);
    const handles = getHandles(svg);
    expect(handles).toHaveLength(4);
    const roles = handles.map((h) =>
      h.getAttribute('data-handle-role'),
    );
    expect(roles).toEqual(['v0', 'v1', 'v2', 'v3']);
  });

  it('v2 drag moves only one vertex of a polygon', () => {
    const poly = makeChild('polygon', {
      points: '0,0 10,0 10,10 0,10',
    });
    poly.getBBox = () => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, poly, 'v2', { x: 10, y: 10 }, { x: 15, y: 20 });
    // v2 at (10, 10) → (15, 20). Others unchanged.
    expect(poly.getAttribute('points')).toBe('0,0 10,0 15,20 0,10');
  });

  it('polygon uses polygon-vertices snapshot kind', () => {
    const poly = makeChild('polygon', {
      points: '0,0 10,0 10,10',
    });
    poly.getBBox = () => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(poly);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('v0');
    firePointer(svg, 'pointerdown', 0, 0);
    expect(editor._drag.originAttrs.kind).toBe('polygon-vertices');
    firePointer(svg, 'pointerup', 0, 0);
  });

  it('detach mid-polygon-drag restores all points', () => {
    const poly = makeChild('polygon', {
      points: '0,0 10,0 10,10 0,10',
    });
    poly.getBBox = () => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(poly);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('v2');
    firePointer(svg, 'pointerdown', 10, 10);
    firePointer(svg, 'pointermove', 40, 40);
    expect(poly.getAttribute('points')).toBe('0,0 10,0 40,40 0,10');
    editor.detach();
    expect(poly.getAttribute('points')).toBe('0,0 10,0 10,10 0,10');
  });
});