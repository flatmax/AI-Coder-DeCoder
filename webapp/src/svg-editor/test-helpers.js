// Shared test scaffolding for svg-editor tests.
//
// Extracted verbatim from the legacy webapp/src/svg-editor.test.js
// so the per-area test files (drag, resize, marquee, undo, etc.) can
// share the same SVG/DOM stubs and pointer-event helpers
// without duplication.
//
// Pattern follows webapp/src/files-tab/test-helpers.js: each
// consuming test module calls `installCleanup()` at module
// scope to register the per-test cleanup hook.

import { afterEach, vi } from 'vitest';

export const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Build a minimal SVG DOM tree attached to the document
 * so `getRootNode` etc. work correctly. Returns the root
 * SVG. Caller is responsible for cleanup.
 */
export function makeSvg(children = []) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', '100');
  svg.setAttribute('height', '100');
  // Stub getCTM / createSVGPoint so _screenToSvg doesn't
  // crash in jsdom. Identity transform.
  svg.getCTM = () => ({
    a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
    inverse() {
      return this;
    },
    multiply(other) {
      return other;
    },
  });
  svg.getScreenCTM = () => svg.getCTM();
  svg.createSVGPoint = () => {
    const pt = {
      x: 0,
      y: 0,
      matrixTransform(m) {
        return {
          x: m.a * pt.x + m.c * pt.y + m.e,
          y: m.b * pt.x + m.d * pt.y + m.f,
        };
      },
    };
    return pt;
  };
  for (const child of children) {
    svg.appendChild(child);
  }
  document.body.appendChild(svg);
  return svg;
}

/**
 * Create an SVG child element of the given tag. Attaches
 * a stub `getCTM` and `getBBox` so editor operations don't
 * throw.
 */
export function makeChild(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  // Stub the geometry methods jsdom doesn't implement.
  el.getCTM = () => ({
    a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
  });
  el.getBBox = () => {
    const x = parseFloat(el.getAttribute('x') || '0');
    const y = parseFloat(el.getAttribute('y') || '0');
    const w = parseFloat(el.getAttribute('width') || '10');
    const h = parseFloat(el.getAttribute('height') || '10');
    return { x, y, width: w, height: h };
  };
  // jsdom returns all-zero DOMRects for un-laid-out SVG
  // elements. Text-edit overlay rendering in svg-editor
  // bails out when the measured paint rect is zero, which
  // strands every inline-text-edit test. Synthesize a
  // plausible paint rect from the element's attributes
  // — matches the identity-CTM model the other stubs
  // already commit to.
  el.getBoundingClientRect = () => {
    const x = parseFloat(el.getAttribute('x') || '0');
    const y = parseFloat(el.getAttribute('y') || '0');
    const w = parseFloat(el.getAttribute('width') || '10');
    const h = parseFloat(el.getAttribute('height') || '10');
    return {
      x,
      y,
      left: x,
      top: y,
      right: x + w,
      bottom: y + h,
      width: w,
      height: h,
    };
  };
  return el;
}

const _mounted = [];

export function track(svg) {
  _mounted.push(svg);
  return svg;
}

/**
 * Fire a pointer event with the given type and coordinates.
 * Uses MouseEvent under the hood since jsdom's PointerEvent
 * constructor is unreliable. Pointer-specific fields are
 * defined via Object.defineProperty for visibility in the
 * handler.
 *
 * Default button=0 (primary) and pointerId=1 match a typical
 * mouse-drag sequence.
 */
export function firePointer(el, type, clientX, clientY, extra = {}) {
  const ev = new MouseEvent(type, {
    clientX,
    clientY,
    button: extra.button ?? 0,
    shiftKey: !!extra.shiftKey,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(ev, 'pointerId', {
    value: extra.pointerId ?? 1,
  });
  Object.defineProperty(ev, 'pointerType', {
    value: extra.pointerType ?? 'mouse',
  });
  // Reinforce shiftKey — some jsdom versions ignore the
  // MouseEventInit shiftKey field on dispatched events.
  if (extra.shiftKey && !ev.shiftKey) {
    Object.defineProperty(ev, 'shiftKey', { value: true });
  }
  el.dispatchEvent(ev);
  return ev;
}

/**
 * Install stubs for setPointerCapture / releasePointerCapture
 * on an SVG so the editor's drag path doesn't throw in jsdom.
 * Returns an object tracking calls so tests can assert on
 * capture behavior.
 */
export function stubPointerCapture(svg) {
  const tracker = {
    captured: null,
    releaseCalls: [],
  };
  svg.setPointerCapture = (id) => {
    tracker.captured = id;
  };
  svg.releasePointerCapture = (id) => {
    tracker.releaseCalls.push(id);
    if (tracker.captured === id) tracker.captured = null;
  };
  return tracker;
}

/**
 * Helper to run a full move-drag sequence and leave the
 * element in its committed final state.
 */
export function runDrag(svg, editor, element, from, to) {
  vi.spyOn(editor, '_hitTest').mockReturnValue(element);
  editor.setSelection(element);
  firePointer(svg, 'pointerdown', from.x, from.y);
  firePointer(svg, 'pointermove', to.x, to.y);
  firePointer(svg, 'pointerup', to.x, to.y);
}

/**
 * Run a resize drag by forcing a specific handle role and
 * firing a pointer sequence. Leaves the element in its
 * committed state.
 */
export function runResizeDrag(svg, editor, element, role, from, to) {
  vi.spyOn(editor, '_hitTestHandle').mockReturnValue(role);
  editor.setSelection(element);
  firePointer(svg, 'pointerdown', from.x, from.y);
  firePointer(svg, 'pointermove', to.x, to.y);
  firePointer(svg, 'pointerup', to.x, to.y);
}

/**
 * Register the per-test SVG cleanup hook. Call once at
 * module scope from each test file that uses these helpers.
 */
export function installCleanup() {
  afterEach(() => {
    while (_mounted.length) {
      const svg = _mounted.pop();
      if (svg.parentNode) svg.parentNode.removeChild(svg);
    }
  });
}