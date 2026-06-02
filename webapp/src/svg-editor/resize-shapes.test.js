// Resize handle rendering and drag tests for shapes
// (rect, circle, ellipse). Extracted verbatim from
// svg-editor.test.js.

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
// Resize handle rendering
// ---------------------------------------------------------------------------

describe('SvgEditor resize handle rendering', () => {
  /**
   * Extract resize handle dots from the selected element's
   * handle overlay. Excludes the rotate handle, which has
   * role "rotate" — these tests pin the resize-handle
   * count specifically.
   */
  function getHandles(svg) {
    const group = svg.querySelector(`#svg-editor-handles`);
    if (!group) return [];
    return Array.from(
      group.querySelectorAll('[data-handle-role]'),
    ).filter(
      (h) => h.getAttribute('data-handle-role') !== 'rotate',
    );
  }

  it('rect selection produces eight handles', () => {
    const rect = makeChild('rect', { x: 10, y: 20, width: 40, height: 30 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    const handles = getHandles(svg);
    expect(handles).toHaveLength(8);
  });

  it('rect handles cover all eight compass directions', () => {
    const rect = makeChild('rect', { x: 10, y: 20, width: 40, height: 30 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    const roles = getHandles(svg).map((h) =>
      h.getAttribute('data-handle-role'),
    );
    expect(new Set(roles)).toEqual(
      new Set(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']),
    );
  });

  it('rect handle positions match the bounding box', () => {
    const rect = makeChild('rect', { x: 10, y: 20, width: 40, height: 30 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    const byRole = {};
    for (const h of getHandles(svg)) {
      byRole[h.getAttribute('data-handle-role')] = {
        cx: parseFloat(h.getAttribute('cx')),
        cy: parseFloat(h.getAttribute('cy')),
      };
    }
    // NW is at top-left corner.
    expect(byRole.nw.cx).toBeCloseTo(10);
    expect(byRole.nw.cy).toBeCloseTo(20);
    // SE is at bottom-right corner.
    expect(byRole.se.cx).toBeCloseTo(50);
    expect(byRole.se.cy).toBeCloseTo(50);
    // N is at top midpoint.
    expect(byRole.n.cx).toBeCloseTo(30);
    expect(byRole.n.cy).toBeCloseTo(20);
    // E is at right midpoint.
    expect(byRole.e.cx).toBeCloseTo(50);
    expect(byRole.e.cy).toBeCloseTo(35);
  });

  it('circle selection produces four handles', () => {
    const circle = makeChild('circle', { cx: 50, cy: 50, r: 20 });
    // Give the circle a bbox so the handle-position math
    // works. jsdom's default getBBox returns width/height
    // from the x/y/width/height attrs, so override per-
    // element to return the circle's actual bbox.
    circle.getBBox = () => ({
      x: 30,
      y: 30,
      width: 40,
      height: 40,
    });
    const svg = track(makeSvg([circle]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(circle);
    const handles = getHandles(svg);
    expect(handles).toHaveLength(4);
  });

  it('circle handles cover n/e/s/w', () => {
    const circle = makeChild('circle', { cx: 50, cy: 50, r: 20 });
    circle.getBBox = () => ({
      x: 30,
      y: 30,
      width: 40,
      height: 40,
    });
    const svg = track(makeSvg([circle]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(circle);
    const roles = getHandles(svg).map((h) =>
      h.getAttribute('data-handle-role'),
    );
    expect(new Set(roles)).toEqual(new Set(['n', 'e', 's', 'w']));
  });

  it('ellipse selection produces four handles', () => {
    const ell = makeChild('ellipse', { cx: 40, cy: 30, rx: 20, ry: 10 });
    ell.getBBox = () => ({
      x: 20,
      y: 20,
      width: 40,
      height: 20,
    });
    const svg = track(makeSvg([ell]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(ell);
    const handles = getHandles(svg);
    expect(handles).toHaveLength(4);
  });

  it('line selection produces two endpoint handles', () => {
    const line = makeChild('line', { x1: 10, y1: 10, x2: 50, y2: 50 });
    line.getBBox = () => ({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
    const svg = track(makeSvg([line]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(line);
    const handles = getHandles(svg);
    // Two handles: one at each endpoint.
    expect(handles).toHaveLength(2);
    const roles = handles.map((h) =>
      h.getAttribute('data-handle-role'),
    );
    expect(new Set(roles)).toEqual(new Set(['p1', 'p2']));
  });

  it('polyline selection produces one handle per vertex', () => {
    const poly = makeChild('polyline', { points: '10,10 30,20 50,10' });
    poly.getBBox = () => ({
      x: 10,
      y: 10,
      width: 40,
      height: 10,
    });
    const svg = track(makeSvg([poly]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(poly);
    const handles = getHandles(svg);
    expect(handles).toHaveLength(3);
    const roles = handles.map((h) =>
      h.getAttribute('data-handle-role'),
    );
    expect(roles).toEqual(['v0', 'v1', 'v2']);
  });

  it('path selection produces handles for each command endpoint', () => {
    // M + L = two commands, two endpoint handles.
    const path = makeChild('path', { d: 'M 0 0 L 10 10' });
    path.getBBox = () => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const handles = getHandles(svg);
    expect(handles).toHaveLength(2);
    const roles = handles.map((h) =>
      h.getAttribute('data-handle-role'),
    );
    expect(roles).toEqual(['p0', 'p1']);
  });

  it('handles opt into pointer events', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    const handles = getHandles(svg);
    for (const h of handles) {
      expect(h.getAttribute('pointer-events')).toBe('auto');
    }
  });

  it('handles carry the shared handle class', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    const handles = getHandles(svg);
    for (const h of handles) {
      expect(h.classList.contains('svg-editor-handle')).toBe(true);
    }
  });

  it('handles are replaced on reselection', () => {
    const rect1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const rect2 = makeChild('rect', { x: 50, y: 50, width: 30, height: 30 });
    const svg = track(makeSvg([rect1, rect2]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect1);
    const firstPositions = getHandles(svg).map((h) =>
      h.getAttribute('cx'),
    );
    editor.setSelection(rect2);
    const secondPositions = getHandles(svg).map((h) =>
      h.getAttribute('cx'),
    );
    expect(secondPositions).not.toEqual(firstPositions);
    // Both rects each have 8 handles, so the count is
    // unchanged.
    expect(getHandles(svg)).toHaveLength(8);
  });

  it('clearing selection removes handles', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    expect(getHandles(svg)).toHaveLength(8);
    editor.setSelection(null);
    expect(getHandles(svg)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Resize drag — pointerdown routing via handle hit-test
// ---------------------------------------------------------------------------

describe('SvgEditor resize drag: handle hit-test', () => {
  it('clicking a handle starts a resize drag', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    // Force the handle hit-test to return a specific role.
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('se');
    firePointer(svg, 'pointerdown', 30, 30);
    expect(editor._drag).not.toBe(null);
    expect(editor._drag.mode).toBe('resize');
    expect(editor._drag.role).toBe('se');
  });

  it('handle click does not initiate move drag', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('nw');
    // _hitTest would normally return the rect; we spy on
    // it to ensure it's never called when the handle
    // hit-test succeeds.
    const hitTestSpy = vi.spyOn(editor, '_hitTest');
    firePointer(svg, 'pointerdown', 10, 10);
    expect(hitTestSpy).not.toHaveBeenCalled();
    expect(editor._drag.mode).toBe('resize');
  });

  it('handle hit-test only runs when something is selected', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    const handleSpy = vi.spyOn(editor, '_hitTestHandle');
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    firePointer(svg, 'pointerdown', 50, 50);
    expect(handleSpy).not.toHaveBeenCalled();
  });

  it('_hitTestHandle returns null when no handle under pointer', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    const root = svg.getRootNode();
    // Elements under pointer: just the rect, not a handle.
    root.elementsFromPoint = () => [rect];
    expect(editor._hitTestHandle(50, 50)).toBe(null);
  });

  it('_hitTestHandle returns role when handle under pointer', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    // Find a real handle in the overlay.
    const group = svg.querySelector('#svg-editor-handles');
    const handle = group.querySelector('[data-handle-role="se"]');
    expect(handle).toBeTruthy();
    const root = svg.getRootNode();
    root.elementsFromPoint = () => [handle];
    expect(editor._hitTestHandle(50, 50)).toBe('se');
  });

  it('stops propagation on handle hit', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('se');
    const outerListener = vi.fn();
    document.body.addEventListener('pointerdown', outerListener);
    try {
      firePointer(svg, 'pointerdown', 30, 30);
      expect(outerListener).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener(
        'pointerdown',
        outerListener,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Resize drag — rect per-handle math
// ---------------------------------------------------------------------------

describe('SvgEditor resize drag: rect corners', () => {
  it('se corner grows width and height by delta', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // SE corner is at (30, 30). Drag to (50, 45) → delta (+20, +15).
    runResizeDrag(svg, editor, rect, 'se', { x: 30, y: 30 }, { x: 50, y: 45 });
    expect(rect.getAttribute('x')).toBe('10');
    expect(rect.getAttribute('y')).toBe('10');
    expect(rect.getAttribute('width')).toBe('40');
    expect(rect.getAttribute('height')).toBe('35');
  });

  it('nw corner moves x/y and shrinks width/height', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // NW corner is at (10, 10). Drag to (15, 12) → delta (+5, +2).
    runResizeDrag(svg, editor, rect, 'nw', { x: 10, y: 10 }, { x: 15, y: 12 });
    expect(rect.getAttribute('x')).toBe('15');
    expect(rect.getAttribute('y')).toBe('12');
    expect(rect.getAttribute('width')).toBe('15');
    expect(rect.getAttribute('height')).toBe('18');
  });

  it('ne corner moves y and grows width / shrinks height', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // NE corner is at (30, 10). Drag to (40, 15) → delta (+10, +5).
    runResizeDrag(svg, editor, rect, 'ne', { x: 30, y: 10 }, { x: 40, y: 15 });
    expect(rect.getAttribute('x')).toBe('10');
    expect(rect.getAttribute('y')).toBe('15');
    expect(rect.getAttribute('width')).toBe('30');
    expect(rect.getAttribute('height')).toBe('15');
  });

  it('sw corner moves x and shrinks width / grows height', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // SW corner is at (10, 30). Drag to (15, 35) → delta (+5, +5).
    runResizeDrag(svg, editor, rect, 'sw', { x: 10, y: 30 }, { x: 15, y: 35 });
    expect(rect.getAttribute('x')).toBe('15');
    expect(rect.getAttribute('y')).toBe('10');
    expect(rect.getAttribute('width')).toBe('15');
    expect(rect.getAttribute('height')).toBe('25');
  });
});

describe('SvgEditor resize drag: rect edges', () => {
  it('n edge moves y and shrinks height', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, rect, 'n', { x: 20, y: 10 }, { x: 20, y: 15 });
    expect(rect.getAttribute('x')).toBe('10');
    expect(rect.getAttribute('y')).toBe('15');
    expect(rect.getAttribute('width')).toBe('20');
    expect(rect.getAttribute('height')).toBe('15');
  });

  it('e edge grows width only', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, rect, 'e', { x: 30, y: 20 }, { x: 45, y: 20 });
    expect(rect.getAttribute('x')).toBe('10');
    expect(rect.getAttribute('y')).toBe('10');
    expect(rect.getAttribute('width')).toBe('35');
    expect(rect.getAttribute('height')).toBe('20');
  });

  it('s edge grows height only', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, rect, 's', { x: 20, y: 30 }, { x: 20, y: 50 });
    expect(rect.getAttribute('width')).toBe('20');
    expect(rect.getAttribute('height')).toBe('40');
    expect(rect.getAttribute('x')).toBe('10');
    expect(rect.getAttribute('y')).toBe('10');
  });

  it('w edge moves x and shrinks width', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, rect, 'w', { x: 10, y: 20 }, { x: 17, y: 20 });
    expect(rect.getAttribute('x')).toBe('17');
    expect(rect.getAttribute('y')).toBe('10');
    expect(rect.getAttribute('width')).toBe('13');
    expect(rect.getAttribute('height')).toBe('20');
  });
});

describe('SvgEditor resize drag: rect clamping', () => {
  it('drag past opposite edge clamps width to minimum', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // E edge at x=30. Drag way past the left edge.
    runResizeDrag(svg, editor, rect, 'e', { x: 30, y: 20 }, { x: -50, y: 20 });
    // Width clamped to 1 (minimum).
    expect(parseFloat(rect.getAttribute('width'))).toBe(1);
    // Position unchanged — e edge doesn't move x.
    expect(rect.getAttribute('x')).toBe('10');
  });

  it('drag past opposite edge with position-moving handle pins x', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // W edge at x=10. Drag way past the right edge (x=30).
    runResizeDrag(svg, editor, rect, 'w', { x: 10, y: 20 }, { x: 100, y: 20 });
    // Width clamped to 1. x pinned so right edge
    // (originally at 30) stays put: x = 30 - 1 = 29.
    expect(parseFloat(rect.getAttribute('width'))).toBe(1);
    expect(parseFloat(rect.getAttribute('x'))).toBe(29);
  });

  it('drag past opposite edge clamps height to minimum', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, rect, 'n', { x: 20, y: 10 }, { x: 20, y: 50 });
    expect(parseFloat(rect.getAttribute('height'))).toBe(1);
    // N edge moves y; pin so s edge (originally at 30) stays put.
    expect(parseFloat(rect.getAttribute('y'))).toBe(29);
  });
});

describe('SvgEditor resize drag: circle', () => {
  it('dragging a handle outward grows the radius', () => {
    const circle = makeChild('circle', { cx: 50, cy: 50, r: 10 });
    circle.getBBox = () => ({
      x: 40,
      y: 40,
      width: 20,
      height: 20,
    });
    const svg = track(makeSvg([circle]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // E handle at (60, 50). Drag to (70, 50) → new
    // distance from center (50,50) is 20.
    runResizeDrag(svg, editor, circle, 'e', { x: 60, y: 50 }, { x: 70, y: 50 });
    expect(parseFloat(circle.getAttribute('r'))).toBeCloseTo(20);
    // Center unchanged.
    expect(circle.getAttribute('cx')).toBe('50');
    expect(circle.getAttribute('cy')).toBe('50');
  });

  it('dragging inward shrinks the radius', () => {
    const circle = makeChild('circle', { cx: 50, cy: 50, r: 20 });
    circle.getBBox = () => ({
      x: 30,
      y: 30,
      width: 40,
      height: 40,
    });
    const svg = track(makeSvg([circle]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, circle, 'e', { x: 70, y: 50 }, { x: 55, y: 50 });
    expect(parseFloat(circle.getAttribute('r'))).toBeCloseTo(5);
  });

  it('drag through center clamps to minimum radius', () => {
    const circle = makeChild('circle', { cx: 50, cy: 50, r: 20 });
    circle.getBBox = () => ({
      x: 30,
      y: 30,
      width: 40,
      height: 40,
    });
    const svg = track(makeSvg([circle]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // Drag from handle through center to far side — should
    // still produce a positive radius (distance is abs).
    runResizeDrag(svg, editor, circle, 'e', { x: 70, y: 50 }, { x: 50, y: 50 });
    expect(parseFloat(circle.getAttribute('r'))).toBeGreaterThanOrEqual(1);
  });

  it('any cardinal handle adjusts the single radius', () => {
    // Circles are symmetric; n / e / s / w handles should
    // all behave identically. Using `n` here differs from
    // previous `e` tests.
    const circle = makeChild('circle', { cx: 50, cy: 50, r: 10 });
    circle.getBBox = () => ({
      x: 40,
      y: 40,
      width: 20,
      height: 20,
    });
    const svg = track(makeSvg([circle]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // N handle at (50, 40). Drag to (50, 20) → new
    // distance from center (50, 50) is 30.
    runResizeDrag(svg, editor, circle, 'n', { x: 50, y: 40 }, { x: 50, y: 20 });
    expect(parseFloat(circle.getAttribute('r'))).toBeCloseTo(30);
  });
});

describe('SvgEditor resize drag: ellipse', () => {
  it('e handle adjusts rx only', () => {
    const ell = makeChild('ellipse', { cx: 50, cy: 50, rx: 20, ry: 10 });
    ell.getBBox = () => ({
      x: 30,
      y: 40,
      width: 40,
      height: 20,
    });
    const svg = track(makeSvg([ell]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // E handle at (70, 50). Drag to (85, 50) → new
    // horizontal distance is 35.
    runResizeDrag(svg, editor, ell, 'e', { x: 70, y: 50 }, { x: 85, y: 50 });
    expect(parseFloat(ell.getAttribute('rx'))).toBeCloseTo(35);
    expect(ell.getAttribute('ry')).toBe('10');
  });

  it('w handle also adjusts rx', () => {
    // w handle goes to the other side of center, but we
    // measure abs(px - cx), so it's rx again.
    const ell = makeChild('ellipse', { cx: 50, cy: 50, rx: 20, ry: 10 });
    ell.getBBox = () => ({
      x: 30,
      y: 40,
      width: 40,
      height: 20,
    });
    const svg = track(makeSvg([ell]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, ell, 'w', { x: 30, y: 50 }, { x: 15, y: 50 });
    expect(parseFloat(ell.getAttribute('rx'))).toBeCloseTo(35);
    expect(ell.getAttribute('ry')).toBe('10');
  });

  it('n handle adjusts ry only', () => {
    const ell = makeChild('ellipse', { cx: 50, cy: 50, rx: 20, ry: 10 });
    ell.getBBox = () => ({
      x: 30,
      y: 40,
      width: 40,
      height: 20,
    });
    const svg = track(makeSvg([ell]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // N handle at (50, 40). Drag to (50, 30) → new
    // vertical distance is 20.
    runResizeDrag(svg, editor, ell, 'n', { x: 50, y: 40 }, { x: 50, y: 30 });
    expect(parseFloat(ell.getAttribute('ry'))).toBeCloseTo(20);
    expect(ell.getAttribute('rx')).toBe('20');
  });

  it('rx and ry clamp to minimum', () => {
    const ell = makeChild('ellipse', { cx: 50, cy: 50, rx: 20, ry: 10 });
    ell.getBBox = () => ({
      x: 30,
      y: 40,
      width: 40,
      height: 20,
    });
    const svg = track(makeSvg([ell]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // Drag e handle exactly to center — rx would be 0,
    // should clamp to 1.
    runResizeDrag(svg, editor, ell, 'e', { x: 70, y: 50 }, { x: 50, y: 50 });
    expect(parseFloat(ell.getAttribute('rx'))).toBe(1);
  });

  it('center unchanged during resize', () => {
    const ell = makeChild('ellipse', { cx: 50, cy: 50, rx: 20, ry: 10 });
    ell.getBBox = () => ({
      x: 30,
      y: 40,
      width: 40,
      height: 20,
    });
    const svg = track(makeSvg([ell]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, ell, 'e', { x: 70, y: 50 }, { x: 100, y: 80 });
    expect(ell.getAttribute('cx')).toBe('50');
    expect(ell.getAttribute('cy')).toBe('50');
  });
});

// ---------------------------------------------------------------------------
// Resize drag — lifecycle
// ---------------------------------------------------------------------------

describe('SvgEditor resize drag: lifecycle', () => {
  it('fires onChange after committed resize', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('se');
    firePointer(svg, 'pointerdown', 30, 30);
    firePointer(svg, 'pointermove', 50, 50);
    firePointer(svg, 'pointerup', 50, 50);
    expect(changeListener).toHaveBeenCalledOnce();
  });

  it('tiny resize pointermove does not commit', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('se');
    firePointer(svg, 'pointerdown', 30, 30);
    firePointer(svg, 'pointermove', 31, 30);
    firePointer(svg, 'pointerup', 31, 30);
    // Width unchanged.
    expect(rect.getAttribute('width')).toBe('20');
    expect(changeListener).not.toHaveBeenCalled();
  });

  it('detach mid-resize rolls back', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('se');
    firePointer(svg, 'pointerdown', 30, 30);
    firePointer(svg, 'pointermove', 60, 60);
    // Rect has been enlarged.
    expect(rect.getAttribute('width')).toBe('50');
    editor.detach();
    // Restored.
    expect(rect.getAttribute('width')).toBe('20');
    expect(rect.getAttribute('height')).toBe('20');
    expect(rect.getAttribute('x')).toBe('10');
    expect(rect.getAttribute('y')).toBe('10');
  });

  it('detach mid-circle-resize restores r', () => {
    const circle = makeChild('circle', { cx: 50, cy: 50, r: 10 });
    circle.getBBox = () => ({
      x: 40,
      y: 40,
      width: 20,
      height: 20,
    });
    const svg = track(makeSvg([circle]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(circle);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('e');
    firePointer(svg, 'pointerdown', 60, 50);
    firePointer(svg, 'pointermove', 80, 50);
    expect(parseFloat(circle.getAttribute('r'))).toBeCloseTo(30);
    editor.detach();
    expect(parseFloat(circle.getAttribute('r'))).toBe(10);
  });

  it('detach mid-ellipse-resize restores rx and ry', () => {
    const ell = makeChild('ellipse', { cx: 50, cy: 50, rx: 20, ry: 10 });
    ell.getBBox = () => ({
      x: 30,
      y: 40,
      width: 40,
      height: 20,
    });
    const svg = track(makeSvg([ell]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(ell);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('e');
    firePointer(svg, 'pointerdown', 70, 50);
    firePointer(svg, 'pointermove', 90, 50);
    editor.detach();
    expect(ell.getAttribute('rx')).toBe('20');
    expect(ell.getAttribute('ry')).toBe('10');
  });
});