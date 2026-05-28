// Resize tests for path commands extracted from
// webapp/src/svg-editor.test.js. Covers endpoint and
// control-point handle rendering and drag for M/L/H/V/
// C/S/Q/T/A commands.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HANDLE_CLASS,
  SvgEditor,
  _parsePathData,
} from './index.js';
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
// Path endpoint handle rendering
// ---------------------------------------------------------------------------

describe('SvgEditor path handle rendering', () => {
  function getHandles(svg) {
    const group = svg.querySelector('#svg-editor-handles');
    if (!group) return [];
    return Array.from(
      group.querySelectorAll('[data-handle-role]'),
    ).filter(
      (h) => h.getAttribute('data-handle-role') !== 'rotate',
    );
  }

  it('emits one handle per non-Z command', () => {
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10 L 20 20',
    });
    path.getBBox = () => ({
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const handles = getHandles(svg);
    expect(handles).toHaveLength(3);
    const roles = handles.map((h) =>
      h.getAttribute('data-handle-role'),
    );
    expect(roles).toEqual(['p0', 'p1', 'p2']);
  });

  it('skips Z commands when rendering handles', () => {
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10 Z',
    });
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
    // Two commands have endpoints (M, L); Z has none.
    expect(handles).toHaveLength(2);
    const roles = handles.map((h) =>
      h.getAttribute('data-handle-role'),
    );
    expect(roles).toEqual(['p0', 'p1']);
  });

  it('handles positioned at absolute coords', () => {
    const path = makeChild('path', {
      d: 'M 10 20 L 50 80',
    });
    path.getBBox = () => ({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const handles = getHandles(svg);
    const byRole = {};
    for (const h of handles) {
      byRole[h.getAttribute('data-handle-role')] = {
        cx: parseFloat(h.getAttribute('cx')),
        cy: parseFloat(h.getAttribute('cy')),
      };
    }
    expect(byRole.p0).toEqual({ cx: 10, cy: 20 });
    expect(byRole.p1).toEqual({ cx: 50, cy: 80 });
  });

  it('handles positioned at computed coords for relative commands', () => {
    const path = makeChild('path', {
      d: 'M 10 20 l 15 10',
    });
    path.getBBox = () => ({
      x: 10,
      y: 20,
      width: 15,
      height: 10,
    });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const handles = getHandles(svg);
    const byRole = {};
    for (const h of handles) {
      byRole[h.getAttribute('data-handle-role')] = {
        cx: parseFloat(h.getAttribute('cx')),
        cy: parseFloat(h.getAttribute('cy')),
      };
    }
    expect(byRole.p0).toEqual({ cx: 10, cy: 20 });
    // Relative l 15 10 from (10, 20) → (25, 30).
    expect(byRole.p1).toEqual({ cx: 25, cy: 30 });
  });

  it('H handle positioned on same y as pen', () => {
    const path = makeChild('path', {
      d: 'M 10 20 H 50',
    });
    path.getBBox = () => ({
      x: 10,
      y: 20,
      width: 40,
      height: 0,
    });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const handles = getHandles(svg);
    const byRole = {};
    for (const h of handles) {
      byRole[h.getAttribute('data-handle-role')] = {
        cx: parseFloat(h.getAttribute('cx')),
        cy: parseFloat(h.getAttribute('cy')),
      };
    }
    // H endpoint at (50, 20) — y inherited from pen.
    expect(byRole.p1).toEqual({ cx: 50, cy: 20 });
  });
});

// ---------------------------------------------------------------------------
// Path endpoint drag
// ---------------------------------------------------------------------------

describe('SvgEditor resize drag: path endpoints', () => {
  it('dragging p1 on M+L updates L endpoint only', () => {
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10',
    });
    path.getBBox = () => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(
      svg,
      editor,
      path,
      'p1',
      { x: 10, y: 10 },
      { x: 25, y: 30 },
    );
    // L endpoint moved; M unchanged.
    expect(path.getAttribute('d')).toBe('M 0 0 L 25 30');
  });

  it('dragging p0 on M+L updates M only', () => {
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10',
    });
    path.getBBox = () => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(
      svg,
      editor,
      path,
      'p0',
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    );
    // M moved; L's args unchanged (though its effective
    // endpoint shifts because it's relative to pen — but
    // L is absolute, so its endpoint at (10, 10) stays).
    expect(path.getAttribute('d')).toBe('M 5 5 L 10 10');
  });

  it('dragging H handle adjusts x only (y delta ignored)', () => {
    const path = makeChild('path', {
      d: 'M 10 20 H 50',
    });
    path.getBBox = () => ({
      x: 10,
      y: 20,
      width: 40,
      height: 0,
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(
      svg,
      editor,
      path,
      'p1',
      { x: 50, y: 20 },
      { x: 70, y: 35 },
    );
    // H's single arg updated by dx=20; dy ignored.
    expect(path.getAttribute('d')).toBe('M 10 20 H 70');
  });

  it('dragging V handle adjusts y only (x delta ignored)', () => {
    const path = makeChild('path', {
      d: 'M 10 20 V 100',
    });
    path.getBBox = () => ({
      x: 10,
      y: 20,
      width: 0,
      height: 80,
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(
      svg,
      editor,
      path,
      'p1',
      { x: 10, y: 100 },
      { x: 30, y: 150 },
    );
    // V's single arg updated by dy=50; dx ignored.
    expect(path.getAttribute('d')).toBe('M 10 20 V 150');
  });

  it('relative command endpoint drag applies delta to args', () => {
    const path = makeChild('path', {
      d: 'M 10 20 l 15 10',
    });
    path.getBBox = () => ({
      x: 10,
      y: 20,
      width: 15,
      height: 10,
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // l handle is at absolute (25, 30). Drag to (40, 50)
    // — delta (+15, +20). l's args become (30, 30).
    runResizeDrag(
      svg,
      editor,
      path,
      'p1',
      { x: 25, y: 30 },
      { x: 40, y: 50 },
    );
    expect(path.getAttribute('d')).toBe('M 10 20 l 30 30');
  });

  it('dragging p2 on 3-command path leaves others unchanged', () => {
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10 L 20 20',
    });
    path.getBBox = () => ({
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(
      svg,
      editor,
      path,
      'p2',
      { x: 20, y: 20 },
      { x: 30, y: 40 },
    );
    expect(path.getAttribute('d')).toBe(
      'M 0 0 L 10 10 L 30 40',
    );
  });

  it('negative deltas work', () => {
    const path = makeChild('path', {
      d: 'M 50 50 L 100 100',
    });
    path.getBBox = () => ({
      x: 50,
      y: 50,
      width: 50,
      height: 50,
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(
      svg,
      editor,
      path,
      'p1',
      { x: 100, y: 100 },
      { x: 80, y: 70 },
    );
    expect(path.getAttribute('d')).toBe('M 50 50 L 80 70');
  });

  it('repeated pointermoves recompute from origin', () => {
    // Each pointermove must recompute from the snapshot,
    // not from the previous move's result — otherwise
    // compounding would run the handle away from the pointer.
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10',
    });
    path.getBBox = () => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('p1');
    firePointer(svg, 'pointerdown', 10, 10);
    firePointer(svg, 'pointermove', 20, 20);
    expect(path.getAttribute('d')).toBe('M 0 0 L 20 20');
    firePointer(svg, 'pointermove', 30, 40);
    // NOT 50, 60 which would be compounding from previous.
    expect(path.getAttribute('d')).toBe('M 0 0 L 30 40');
    firePointer(svg, 'pointerup', 30, 40);
  });

  it('clicking a p0 handle starts a resize drag', () => {
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10',
    });
    path.getBBox = () => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('p0');
    firePointer(svg, 'pointerdown', 0, 0);
    expect(editor._drag).not.toBe(null);
    expect(editor._drag.mode).toBe('resize');
    expect(editor._drag.role).toBe('p0');
    expect(editor._drag.originAttrs.kind).toBe('path-commands');
  });

  it('fires onChange after committed path endpoint drag', () => {
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10',
    });
    path.getBBox = () => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('p1');
    firePointer(svg, 'pointerdown', 10, 10);
    firePointer(svg, 'pointermove', 25, 30);
    firePointer(svg, 'pointerup', 25, 30);
    expect(changeListener).toHaveBeenCalledOnce();
  });

  it('tiny path endpoint move does not commit', () => {
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10',
    });
    path.getBBox = () => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('p1');
    firePointer(svg, 'pointerdown', 10, 10);
    firePointer(svg, 'pointermove', 11, 10);
    firePointer(svg, 'pointerup', 11, 10);
    expect(path.getAttribute('d')).toBe('M 0 0 L 10 10');
    expect(changeListener).not.toHaveBeenCalled();
  });

  it('detach mid-path-drag restores d attribute', () => {
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10 L 20 20',
    });
    path.getBBox = () => ({
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('p2');
    firePointer(svg, 'pointerdown', 20, 20);
    firePointer(svg, 'pointermove', 50, 50);
    expect(path.getAttribute('d')).toBe('M 0 0 L 10 10 L 50 50');
    editor.detach();
    expect(path.getAttribute('d')).toBe('M 0 0 L 10 10 L 20 20');
  });

  it('ignores malformed role (not p{N})', () => {
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10',
    });
    path.getBBox = () => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    editor._drag = {
      mode: 'resize',
      role: 'invalid',
      pointerId: 1,
      startX: 0,
      startY: 0,
      originAttrs: {
        kind: 'path-commands',
        commands: [
          { cmd: 'M', args: [0, 0] },
          { cmd: 'L', args: [10, 10] },
        ],
      },
      committed: true,
    };
    editor._applyResizeDelta(5, 5);
    expect(path.getAttribute('d')).toBe('M 0 0 L 10 10');
    editor._drag = null;
  });

  it('ignores out-of-range command index', () => {
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10',
    });
    path.getBBox = () => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    editor._drag = {
      mode: 'resize',
      role: 'p99',
      pointerId: 1,
      startX: 0,
      startY: 0,
      originAttrs: {
        kind: 'path-commands',
        commands: [
          { cmd: 'M', args: [0, 0] },
          { cmd: 'L', args: [10, 10] },
        ],
      },
      committed: true,
    };
    editor._applyResizeDelta(5, 5);
    expect(path.getAttribute('d')).toBe('M 0 0 L 10 10');
    editor._drag = null;
  });
});

// ---------------------------------------------------------------------------
// Path control-point handle rendering
// ---------------------------------------------------------------------------

describe('SvgEditor path control-point handle rendering', () => {
  function getHandles(svg) {
    const group = svg.querySelector('#svg-editor-handles');
    if (!group) return [];
    return Array.from(
      group.querySelectorAll('[data-handle-role]'),
    ).filter(
      (h) => h.getAttribute('data-handle-role') !== 'rotate',
    );
  }

  function getTangentLines(svg) {
    const group = svg.querySelector('#svg-editor-handles');
    if (!group) return [];
    // Filter out the rotate-handle's connector line —
    // it's a generic <line> with no distinguishing
    // attribute, identified here by matching its (x2,
    // y2) endpoint to the rotate handle's (cx, cy).
    const rotateDot = group.querySelector(
      '[data-handle-role="rotate"]',
    );
    const rotateX = rotateDot
      ? parseFloat(rotateDot.getAttribute('cx'))
      : null;
    const rotateY = rotateDot
      ? parseFloat(rotateDot.getAttribute('cy'))
      : null;
    return Array.from(group.querySelectorAll('line')).filter(
      (l) => {
        if (rotateDot === null) return true;
        const x2 = parseFloat(l.getAttribute('x2'));
        const y2 = parseFloat(l.getAttribute('y2'));
        return !(
          Math.abs(x2 - rotateX) < 0.001 &&
          Math.abs(y2 - rotateY) < 0.001
        );
      },
    );
  }

  it('C command produces 3 handles (endpoint + 2 CPs)', () => {
    const path = makeChild('path', {
      d: 'M 0 0 C 5 10 15 10 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 10 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const handles = getHandles(svg);
    // M → p0. C → c1-1, c1-2, p1. Total 4.
    expect(handles).toHaveLength(4);
    const roles = handles.map((h) =>
      h.getAttribute('data-handle-role'),
    );
    expect(new Set(roles)).toEqual(
      new Set(['p0', 'c1-1', 'c1-2', 'p1']),
    );
  });

  it('C handle positions match control-point coords', () => {
    const path = makeChild('path', {
      d: 'M 0 0 C 5 10 15 10 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 10 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const byRole = {};
    for (const h of getHandles(svg)) {
      byRole[h.getAttribute('data-handle-role')] = {
        cx: parseFloat(h.getAttribute('cx')),
        cy: parseFloat(h.getAttribute('cy')),
      };
    }
    expect(byRole['c1-1']).toEqual({ cx: 5, cy: 10 });
    expect(byRole['c1-2']).toEqual({ cx: 15, cy: 10 });
    expect(byRole.p1).toEqual({ cx: 20, cy: 0 });
  });

  it('S command produces 2 handles (endpoint + 1 CP)', () => {
    const path = makeChild('path', {
      d: 'M 0 0 C 5 10 15 10 20 0 S 35 10 40 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 40, height: 10 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const handles = getHandles(svg);
    // M → p0. C → c1-1, c1-2, p1. S → c2-1, p2. Total 6.
    expect(handles).toHaveLength(6);
    const roles = handles.map((h) =>
      h.getAttribute('data-handle-role'),
    );
    expect(roles).toContain('c2-1');
    // S never produces c2-2 — only one draggable CP.
    expect(roles).not.toContain('c2-2');
  });

  it('Q command produces 2 handles (endpoint + 1 CP)', () => {
    const path = makeChild('path', {
      d: 'M 0 0 Q 10 20 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const handles = getHandles(svg);
    // M → p0. Q → c1-1, p1.
    expect(handles).toHaveLength(3);
    const byRole = {};
    for (const h of handles) {
      byRole[h.getAttribute('data-handle-role')] = {
        cx: parseFloat(h.getAttribute('cx')),
        cy: parseFloat(h.getAttribute('cy')),
      };
    }
    expect(byRole['c1-1']).toEqual({ cx: 10, cy: 20 });
    expect(byRole.p1).toEqual({ cx: 20, cy: 0 });
  });

  it('T command produces no control-point handle', () => {
    const path = makeChild('path', {
      d: 'M 0 0 Q 10 20 20 0 T 40 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 40, height: 20 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const roles = getHandles(svg).map((h) =>
      h.getAttribute('data-handle-role'),
    );
    // Q at index 1 has c1-1. T at index 2 has only p2.
    expect(roles).toContain('c1-1');
    expect(roles).not.toContain('c2-1');
    expect(roles).toContain('p2');
  });

  it('relative C control-point handles at computed coords', () => {
    const path = makeChild('path', {
      d: 'm 10 20 c 5 10 15 10 20 0',
    });
    path.getBBox = () => ({ x: 10, y: 20, width: 20, height: 10 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const byRole = {};
    for (const h of getHandles(svg)) {
      byRole[h.getAttribute('data-handle-role')] = {
        cx: parseFloat(h.getAttribute('cx')),
        cy: parseFloat(h.getAttribute('cy')),
      };
    }
    // Pen at (10, 20). Relative c 5 10 → (15, 30);
    // 15 10 → (25, 30); 20 0 → (30, 20).
    expect(byRole['c1-1']).toEqual({ cx: 15, cy: 30 });
    expect(byRole['c1-2']).toEqual({ cx: 25, cy: 30 });
    expect(byRole.p1).toEqual({ cx: 30, cy: 20 });
  });

  it('tangent lines rendered from control points to endpoint', () => {
    const path = makeChild('path', {
      d: 'M 0 0 C 5 10 15 10 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 10 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const lines = getTangentLines(svg);
    // C gets two tangent lines (one per control point).
    expect(lines).toHaveLength(2);
  });

  it('tangent lines positioned from CP to endpoint', () => {
    const path = makeChild('path', {
      d: 'M 0 0 C 5 10 15 10 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 10 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const lines = getTangentLines(svg);
    // Each line's (x2, y2) should match the endpoint
    // (20, 0); (x1, y1) should be the control point.
    const linePositions = lines.map((l) => ({
      x1: parseFloat(l.getAttribute('x1')),
      y1: parseFloat(l.getAttribute('y1')),
      x2: parseFloat(l.getAttribute('x2')),
      y2: parseFloat(l.getAttribute('y2')),
    }));
    const cpPositions = new Set(
      linePositions.map((l) => `${l.x1},${l.y1}`),
    );
    expect(cpPositions).toEqual(new Set(['5,10', '15,10']));
    for (const l of linePositions) {
      expect(l.x2).toBe(20);
      expect(l.y2).toBe(0);
    }
  });

  it('tangent lines carry handle class (excluded from hit-test)', () => {
    const path = makeChild('path', {
      d: 'M 0 0 Q 10 20 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const lines = getTangentLines(svg);
    for (const l of lines) {
      expect(l.classList.contains(HANDLE_CLASS)).toBe(true);
      expect(l.getAttribute('pointer-events')).toBe('none');
    }
  });

  it('Q produces one tangent line', () => {
    const path = makeChild('path', {
      d: 'M 0 0 Q 10 20 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const lines = getTangentLines(svg);
    expect(lines).toHaveLength(1);
  });

  it('non-curve commands produce no tangent lines', () => {
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    expect(getTangentLines(svg)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Path control-point drag
// ---------------------------------------------------------------------------

describe('SvgEditor resize drag: path control points', () => {
  it('dragging c1-1 on C moves first control point only', () => {
    const path = makeChild('path', {
      d: 'M 0 0 C 5 10 15 10 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 10 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, path, 'c1-1', { x: 5, y: 10 }, { x: 8, y: 15 });
    // c1-1 moved by (+3, +5) → args[0..1] becomes (8, 15).
    // args[2..3] and [4..5] unchanged.
    expect(path.getAttribute('d')).toBe('M 0 0 C 8 15 15 10 20 0');
  });

  it('dragging c1-2 on C moves second control point only', () => {
    const path = makeChild('path', {
      d: 'M 0 0 C 5 10 15 10 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 10 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, path, 'c1-2', { x: 15, y: 10 }, { x: 18, y: 5 });
    expect(path.getAttribute('d')).toBe('M 0 0 C 5 10 18 5 20 0');
  });

  it('dragging endpoint leaves control points untouched', () => {
    const path = makeChild('path', {
      d: 'M 0 0 C 5 10 15 10 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 10 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, path, 'p1', { x: 20, y: 0 }, { x: 25, y: 5 });
    // Only args[4..5] change.
    expect(path.getAttribute('d')).toBe('M 0 0 C 5 10 15 10 25 5');
  });

  it('dragging c1-1 on Q moves the single control point', () => {
    const path = makeChild('path', {
      d: 'M 0 0 Q 10 20 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, path, 'c1-1', { x: 10, y: 20 }, { x: 15, y: 30 });
    expect(path.getAttribute('d')).toBe('M 0 0 Q 15 30 20 0');
  });

  it('dragging c2-1 on S moves the single draggable CP', () => {
    const path = makeChild('path', {
      d: 'M 0 0 C 5 10 15 10 20 0 S 35 10 40 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 40, height: 10 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, path, 'c2-1', { x: 35, y: 10 }, { x: 40, y: 15 });
    expect(path.getAttribute('d')).toBe(
      'M 0 0 C 5 10 15 10 20 0 S 40 15 40 0',
    );
  });

  it('relative C control-point drag applies delta to args', () => {
    const path = makeChild('path', {
      d: 'm 10 20 c 5 10 15 10 20 0',
    });
    path.getBBox = () => ({ x: 10, y: 20, width: 20, height: 10 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // c1-1 absolute at (15, 30). Drag to (25, 40) → delta
    // (+10, +10). Relative args become (15, 20).
    runResizeDrag(svg, editor, path, 'c1-1', { x: 15, y: 30 }, { x: 25, y: 40 });
    expect(path.getAttribute('d')).toBe('m 10 20 c 15 20 15 10 20 0');
  });

  it('relative Q control-point drag applies delta to args', () => {
    const path = makeChild('path', {
      d: 'm 0 0 q 10 20 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, path, 'c1-1', { x: 10, y: 20 }, { x: 15, y: 25 });
    expect(path.getAttribute('d')).toBe('m 0 0 q 15 25 20 0');
  });

  it('repeated pointermoves recompute from origin', () => {
    const path = makeChild('path', {
      d: 'M 0 0 Q 10 20 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('c1-1');
    firePointer(svg, 'pointerdown', 10, 20);
    firePointer(svg, 'pointermove', 20, 30);
    expect(path.getAttribute('d')).toBe('M 0 0 Q 20 30 20 0');
    firePointer(svg, 'pointermove', 30, 40);
    // NOT 40, 50 which would be compounding.
    expect(path.getAttribute('d')).toBe('M 0 0 Q 30 40 20 0');
    firePointer(svg, 'pointerup', 30, 40);
  });

  it('fires onChange after committed CP drag', () => {
    const path = makeChild('path', {
      d: 'M 0 0 Q 10 20 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('c1-1');
    firePointer(svg, 'pointerdown', 10, 20);
    firePointer(svg, 'pointermove', 20, 30);
    firePointer(svg, 'pointerup', 20, 30);
    expect(changeListener).toHaveBeenCalledOnce();
  });

  it('tiny CP move does not commit', () => {
    const path = makeChild('path', {
      d: 'M 0 0 Q 10 20 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('c1-1');
    firePointer(svg, 'pointerdown', 10, 20);
    firePointer(svg, 'pointermove', 11, 20);
    firePointer(svg, 'pointerup', 11, 20);
    expect(path.getAttribute('d')).toBe('M 0 0 Q 10 20 20 0');
    expect(changeListener).not.toHaveBeenCalled();
  });

  it('detach mid-CP-drag restores d attribute', () => {
    const path = makeChild('path', {
      d: 'M 0 0 C 5 10 15 10 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 10 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('c1-1');
    firePointer(svg, 'pointerdown', 5, 10);
    firePointer(svg, 'pointermove', 25, 40);
    expect(path.getAttribute('d')).toBe('M 0 0 C 25 40 15 10 20 0');
    editor.detach();
    expect(path.getAttribute('d')).toBe('M 0 0 C 5 10 15 10 20 0');
  });

  it('ignores malformed control-point role', () => {
    const path = makeChild('path', {
      d: 'M 0 0 C 5 10 15 10 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 10 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    editor._drag = {
      mode: 'resize',
      role: 'c1',
      pointerId: 1,
      startX: 0,
      startY: 0,
      originAttrs: {
        kind: 'path-commands',
        commands: [
          { cmd: 'M', args: [0, 0] },
          { cmd: 'C', args: [5, 10, 15, 10, 20, 0] },
        ],
      },
      committed: true,
    };
    editor._applyResizeDelta(5, 5);
    expect(path.getAttribute('d')).toBe('M 0 0 C 5 10 15 10 20 0');
    editor._drag = null;
  });

  it('ignores out-of-range CP index', () => {
    // K=3 doesn't match any command's control points.
    const path = makeChild('path', {
      d: 'M 0 0 C 5 10 15 10 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 10 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    editor._drag = {
      mode: 'resize',
      role: 'c1-3',
      pointerId: 1,
      startX: 0,
      startY: 0,
      originAttrs: {
        kind: 'path-commands',
        commands: [
          { cmd: 'M', args: [0, 0] },
          { cmd: 'C', args: [5, 10, 15, 10, 20, 0] },
        ],
      },
      committed: true,
    };
    editor._applyResizeDelta(5, 5);
    expect(path.getAttribute('d')).toBe('M 0 0 C 5 10 15 10 20 0');
    editor._drag = null;
  });

  it('ignores K=2 on Q (Q has only one CP)', () => {
    const path = makeChild('path', {
      d: 'M 0 0 Q 10 20 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    editor._drag = {
      mode: 'resize',
      role: 'c1-2',
      pointerId: 1,
      startX: 0,
      startY: 0,
      originAttrs: {
        kind: 'path-commands',
        commands: [
          { cmd: 'M', args: [0, 0] },
          { cmd: 'Q', args: [10, 20, 20, 0] },
        ],
      },
      committed: true,
    };
    editor._applyResizeDelta(5, 5);
    expect(path.getAttribute('d')).toBe('M 0 0 Q 10 20 20 0');
    editor._drag = null;
  });

  it('ignores control-point role on non-curve command', () => {
    // User shouldn't be able to construct this — handle
    // rendering never emits c-roles for M/L/H/V/T/A/Z —
    // but defensive against future refactors.
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    editor._drag = {
      mode: 'resize',
      role: 'c1-1',
      pointerId: 1,
      startX: 0,
      startY: 0,
      originAttrs: {
        kind: 'path-commands',
        commands: [
          { cmd: 'M', args: [0, 0] },
          { cmd: 'L', args: [10, 10] },
        ],
      },
      committed: true,
    };
    editor._applyResizeDelta(5, 5);
    expect(path.getAttribute('d')).toBe('M 0 0 L 10 10');
    editor._drag = null;
  });

  it('clicking a c1-1 handle starts a resize drag', () => {
    const path = makeChild('path', {
      d: 'M 0 0 C 5 10 15 10 20 0',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 10 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('c1-1');
    firePointer(svg, 'pointerdown', 5, 10);
    expect(editor._drag).not.toBe(null);
    expect(editor._drag.mode).toBe('resize');
    expect(editor._drag.role).toBe('c1-1');
    expect(editor._drag.originAttrs.kind).toBe('path-commands');
  });
});

// ---------------------------------------------------------------------------
// Path A (arc) endpoint handles — Phase 3.2c.3b-iii
// ---------------------------------------------------------------------------

describe('SvgEditor path arc endpoint rendering', () => {
  function getHandles(svg) {
    const group = svg.querySelector('#svg-editor-handles');
    if (!group) return [];
    return Array.from(
      group.querySelectorAll('[data-handle-role]'),
    ).filter(
      (h) => h.getAttribute('data-handle-role') !== 'rotate',
    );
  }

  function getTangentLines(svg) {
    const group = svg.querySelector('#svg-editor-handles');
    if (!group) return [];
    // Filter out the rotate-handle's connector line —
    // it's a generic <line> with no distinguishing
    // attribute, identified here by matching its (x2,
    // y2) endpoint to the rotate handle's (cx, cy).
    const rotateDot = group.querySelector(
      '[data-handle-role="rotate"]',
    );
    const rotateX = rotateDot
      ? parseFloat(rotateDot.getAttribute('cx'))
      : null;
    const rotateY = rotateDot
      ? parseFloat(rotateDot.getAttribute('cy'))
      : null;
    return Array.from(group.querySelectorAll('line')).filter(
      (l) => {
        if (rotateDot === null) return true;
        const x2 = parseFloat(l.getAttribute('x2'));
        const y2 = parseFloat(l.getAttribute('y2'));
        return !(
          Math.abs(x2 - rotateX) < 0.001 &&
          Math.abs(y2 - rotateY) < 0.001
        );
      },
    );
  }

  it('A command produces exactly one handle (endpoint only)', () => {
    const path = makeChild('path', {
      d: 'M 0 0 A 5 5 0 0 1 20 20',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const handles = getHandles(svg);
    // M → p0. A → p1. No control-point handles for arc
    // shape parameters.
    expect(handles).toHaveLength(2);
    const roles = handles.map((h) =>
      h.getAttribute('data-handle-role'),
    );
    expect(new Set(roles)).toEqual(new Set(['p0', 'p1']));
  });

  it('A handle positioned at arc endpoint', () => {
    const path = makeChild('path', {
      d: 'M 0 0 A 5 5 0 0 1 30 40',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 30, height: 40 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const byRole = {};
    for (const h of getHandles(svg)) {
      byRole[h.getAttribute('data-handle-role')] = {
        cx: parseFloat(h.getAttribute('cx')),
        cy: parseFloat(h.getAttribute('cy')),
      };
    }
    expect(byRole.p1).toEqual({ cx: 30, cy: 40 });
  });

  it('relative arc handle positioned at computed endpoint', () => {
    // m 10 20 a 5 5 0 0 1 15 10 — pen at (10, 20),
    // endpoint at (25, 30).
    const path = makeChild('path', {
      d: 'm 10 20 a 5 5 0 0 1 15 10',
    });
    path.getBBox = () => ({ x: 10, y: 20, width: 15, height: 10 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const byRole = {};
    for (const h of getHandles(svg)) {
      byRole[h.getAttribute('data-handle-role')] = {
        cx: parseFloat(h.getAttribute('cx')),
        cy: parseFloat(h.getAttribute('cy')),
      };
    }
    expect(byRole.p1).toEqual({ cx: 25, cy: 30 });
  });

  it('A command produces no tangent lines', () => {
    // Arc has no control points, so no tangent lines.
    const path = makeChild('path', {
      d: 'M 0 0 A 5 5 0 0 1 20 20',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    expect(getTangentLines(svg)).toHaveLength(0);
  });

  it('multi-arc path renders one handle per arc endpoint', () => {
    // Three arcs in sequence → three endpoint handles
    // plus the initial M endpoint. No control-point
    // handles anywhere.
    const path = makeChild('path', {
      d: 'M 0 0 A 5 5 0 0 1 20 20 A 5 5 0 0 0 40 20 A 5 5 0 0 1 60 40',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 60, height: 40 });
    const svg = track(makeSvg([path]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    const handles = getHandles(svg);
    expect(handles).toHaveLength(4);
    const roles = handles.map((h) =>
      h.getAttribute('data-handle-role'),
    );
    expect(roles).toEqual(['p0', 'p1', 'p2', 'p3']);
  });
});

describe('SvgEditor resize drag: path arc endpoints', () => {
  it('dragging arc endpoint moves only args[5..6]', () => {
    const path = makeChild('path', {
      d: 'M 0 0 A 5 5 0 0 1 20 20',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, path, 'p1', { x: 20, y: 20 }, { x: 35, y: 30 });
    // Shape parameters (rx=5, ry=5, rotation=0, large-arc=0,
    // sweep=1) unchanged. Endpoint moved by (+15, +10)
    // → (35, 30).
    expect(path.getAttribute('d')).toBe('M 0 0 A 5 5 0 0 1 35 30');
  });

  it('arc shape parameters preserved during drag', () => {
    // Non-trivial shape params to prove they survive.
    const path = makeChild('path', {
      d: 'M 0 0 A 15 25 45 1 0 50 100',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 50, height: 100 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, path, 'p1', { x: 50, y: 100 }, { x: 30, y: 80 });
    // rx=15, ry=25, rotation=45, large-arc=1, sweep=0
    // all preserved. Endpoint moved by (-20, -20) →
    // (30, 80).
    expect(path.getAttribute('d')).toBe('M 0 0 A 15 25 45 1 0 30 80');
  });

  it('relative arc endpoint drag applies delta to args', () => {
    // Same as other relative-command endpoints: pen
    // position at arc's start is unchanged, so adding
    // the drag delta to the relative args shifts the
    // absolute endpoint by exactly that delta.
    const path = makeChild('path', {
      d: 'm 10 10 a 5 5 0 0 1 20 30',
    });
    path.getBBox = () => ({ x: 10, y: 10, width: 20, height: 30 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // Absolute endpoint at (30, 40). Drag to (40, 50)
    // → delta (+10, +10). Relative args become (30, 40).
    runResizeDrag(svg, editor, path, 'p1', { x: 30, y: 40 }, { x: 40, y: 50 });
    expect(path.getAttribute('d')).toBe('m 10 10 a 5 5 0 0 1 30 40');
  });

  it('flags stay as integers across round-trip', () => {
    // large-arc-flag and sweep-flag are 0 or 1. The
    // serializer's String() conversion must preserve
    // them as "0" or "1" (not "0.0" etc). A drag
    // mutates only the endpoint — the flag args at
    // positions 3 and 4 must remain untouched and
    // stringify cleanly.
    const path = makeChild('path', {
      d: 'M 0 0 A 10 10 0 1 1 20 20',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, path, 'p1', { x: 20, y: 20 }, { x: 40, y: 35 });
    // large-arc=1, sweep=1 preserved verbatim.
    expect(path.getAttribute('d')).toBe('M 0 0 A 10 10 0 1 1 40 35');
  });

  it('arc drag in multi-command path leaves other commands alone', () => {
    const path = makeChild('path', {
      d: 'M 0 0 L 10 10 A 5 5 0 0 1 30 30 L 40 40',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 40, height: 40 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    // Arc is at index 2 → role p2.
    runResizeDrag(svg, editor, path, 'p2', { x: 30, y: 30 }, { x: 50, y: 45 });
    expect(path.getAttribute('d')).toBe(
      'M 0 0 L 10 10 A 5 5 0 0 1 50 45 L 40 40',
    );
  });

  it('negative deltas work on arc endpoint', () => {
    const path = makeChild('path', {
      d: 'M 50 50 A 10 10 0 0 1 80 80',
    });
    path.getBBox = () => ({ x: 50, y: 50, width: 30, height: 30 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, path, 'p1', { x: 80, y: 80 }, { x: 60, y: 65 });
    expect(path.getAttribute('d')).toBe('M 50 50 A 10 10 0 0 1 60 65');
  });

  it('repeated pointermoves on arc endpoint recompute from origin', () => {
    const path = makeChild('path', {
      d: 'M 0 0 A 5 5 0 0 1 20 20',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('p1');
    firePointer(svg, 'pointerdown', 20, 20);
    firePointer(svg, 'pointermove', 35, 30);
    expect(path.getAttribute('d')).toBe('M 0 0 A 5 5 0 0 1 35 30');
    // Second move recomputes from origin (20, 20), not
    // from current position (35, 30).
    firePointer(svg, 'pointermove', 50, 45);
    expect(path.getAttribute('d')).toBe('M 0 0 A 5 5 0 0 1 50 45');
    firePointer(svg, 'pointerup', 50, 45);
  });

  it('fires onChange after committed arc endpoint drag', () => {
    const path = makeChild('path', {
      d: 'M 0 0 A 5 5 0 0 1 20 20',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('p1');
    firePointer(svg, 'pointerdown', 20, 20);
    firePointer(svg, 'pointermove', 35, 30);
    firePointer(svg, 'pointerup', 35, 30);
    expect(changeListener).toHaveBeenCalledOnce();
  });

  it('tiny arc endpoint move does not commit', () => {
    const path = makeChild('path', {
      d: 'M 0 0 A 5 5 0 0 1 20 20',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('p1');
    firePointer(svg, 'pointerdown', 20, 20);
    firePointer(svg, 'pointermove', 21, 20);
    firePointer(svg, 'pointerup', 21, 20);
    expect(path.getAttribute('d')).toBe('M 0 0 A 5 5 0 0 1 20 20');
    expect(changeListener).not.toHaveBeenCalled();
  });

  it('detach mid-arc-drag restores d attribute', () => {
    const path = makeChild('path', {
      d: 'M 0 0 A 5 5 0 0 1 20 20',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('p1');
    firePointer(svg, 'pointerdown', 20, 20);
    firePointer(svg, 'pointermove', 50, 50);
    expect(path.getAttribute('d')).toBe('M 0 0 A 5 5 0 0 1 50 50');
    editor.detach();
    expect(path.getAttribute('d')).toBe('M 0 0 A 5 5 0 0 1 20 20');
  });

  it('clicking arc endpoint handle starts resize drag', () => {
    const path = makeChild('path', {
      d: 'M 0 0 A 5 5 0 0 1 20 20',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(path);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue('p1');
    firePointer(svg, 'pointerdown', 20, 20);
    expect(editor._drag).not.toBe(null);
    expect(editor._drag.mode).toBe('resize');
    expect(editor._drag.role).toBe('p1');
    expect(editor._drag.originAttrs.kind).toBe('path-commands');
  });

  it('arc endpoint drag preserves the parser round-trip', () => {
    // Parse-serialize round trip is lossless — a dragged
    // arc should re-parse to the same command structure
    // as the original minus the endpoint coords.
    const path = makeChild('path', {
      d: 'M 0 0 A 10 20 30 1 0 40 50',
    });
    path.getBBox = () => ({ x: 0, y: 0, width: 40, height: 50 });
    const svg = track(makeSvg([path]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    runResizeDrag(svg, editor, path, 'p1', { x: 40, y: 50 }, { x: 55, y: 70 });
    // Re-parse the mutated d and verify command structure.
    const reparsed = _parsePathData(path.getAttribute('d'));
    expect(reparsed).toHaveLength(2);
    expect(reparsed[0]).toEqual({ cmd: 'M', args: [0, 0] });
    expect(reparsed[1]).toEqual({
      cmd: 'A',
      args: [10, 20, 30, 1, 0, 55, 70],
    });
  });
});