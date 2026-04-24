// Tests for svg-editor.js — pointer-based visual editor
// foundation (Phase 3.2c.1).
//
// jsdom limitations acknowledged:
//   - `getCTM`, `createSVGPoint`, `getBBox` exist but return
//     stub values. Coordinate math can be exercised with
//     mocked CTMs but fine-grained numeric assertions
//     aren't possible.
//   - `elementsFromPoint` returns an empty array in jsdom
//     by default. Hit-testing tests mock it.
//   - `PointerEvent` constructor exists but doesn't track
//     pointer state the way a browser does.
//
// The tests focus on:
//   - Public API shape (attach, detach, getSelection,
//     setSelection, deleteSelection)
//   - Event wiring (pointerdown dispatches to hit-test;
//     Escape / Delete act on selection)
//   - Hit-test filtering (handles, non-selectable tags,
//     tspan → text resolution)
//   - Handle group creation and clearing
//   - Resource cleanup in detach()

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  HANDLE_CLASS,
  HANDLE_GROUP_ID,
  HANDLE_SCREEN_RADIUS,
  SvgEditor,
  _NON_SELECTABLE_TAGS,
  _SELECTABLE_TAGS,
  _parseNum,
  _parsePoints,
} from './svg-editor.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Build a minimal SVG DOM tree attached to the document
 * so `getRootNode` etc. work correctly. Returns the root
 * SVG. Caller is responsible for cleanup.
 */
function makeSvg(children = []) {
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
function makeChild(tag, attrs = {}) {
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
  return el;
}

const _mounted = [];

function track(svg) {
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
function firePointer(el, type, clientX, clientY, extra = {}) {
  const ev = new MouseEvent(type, {
    clientX,
    clientY,
    button: extra.button ?? 0,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(ev, 'pointerId', {
    value: extra.pointerId ?? 1,
  });
  Object.defineProperty(ev, 'pointerType', {
    value: extra.pointerType ?? 'mouse',
  });
  el.dispatchEvent(ev);
  return ev;
}

/**
 * Install stubs for setPointerCapture / releasePointerCapture
 * on an SVG so the editor's drag path doesn't throw in jsdom.
 * Returns an object tracking calls so tests can assert on
 * capture behavior.
 */
function stubPointerCapture(svg) {
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

afterEach(() => {
  while (_mounted.length) {
    const svg = _mounted.pop();
    if (svg.parentNode) svg.parentNode.removeChild(svg);
  }
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('SvgEditor construction', () => {
  it('requires an SVG element', () => {
    expect(() => new SvgEditor(null)).toThrow(/svg/i);
    expect(() => new SvgEditor(document.createElement('div'))).toThrow(
      /svg/i,
    );
  });

  it('accepts an SVG element', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    expect(editor).toBeTruthy();
    expect(editor.getSelection()).toBe(null);
  });

  it('exports handle constants', () => {
    expect(HANDLE_CLASS).toBe('svg-editor-handle');
    expect(HANDLE_GROUP_ID).toBe('svg-editor-handles');
    expect(typeof HANDLE_SCREEN_RADIUS).toBe('number');
  });

  it('exports tag classification sets', () => {
    expect(_NON_SELECTABLE_TAGS.has('defs')).toBe(true);
    expect(_NON_SELECTABLE_TAGS.has('style')).toBe(true);
    expect(_SELECTABLE_TAGS.has('rect')).toBe(true);
    expect(_SELECTABLE_TAGS.has('text')).toBe(true);
    expect(_SELECTABLE_TAGS.has('tspan')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// attach / detach
// ---------------------------------------------------------------------------

describe('SvgEditor attach / detach', () => {
  it('attach wires up pointerdown listener', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    editor.attach();
    // Fire pointerdown and verify the editor reacted.
    // Clear-selection on empty-space click is observable
    // even without a hit test returning anything.
    const listener = vi.fn();
    editor._onSelectionChange = listener;
    // Simulate a click on empty space — hit test will
    // return null since there are no children.
    svg.dispatchEvent(
      new MouseEvent('pointerdown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
      }),
    );
    // Empty-space click on nothing selected is a no-op.
    expect(listener).not.toHaveBeenCalled();
    editor.detach();
  });

  it('detach removes pointerdown listener', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    editor.attach();
    // Track hit-test calls as a proxy for listener firing.
    const hitSpy = vi.spyOn(editor, '_hitTest');
    editor.detach();
    svg.dispatchEvent(
      new MouseEvent('pointerdown', {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
      }),
    );
    expect(hitSpy).not.toHaveBeenCalled();
  });

  it('attach is idempotent', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    const addSpy = vi.spyOn(svg, 'addEventListener');
    editor.attach();
    editor.attach();
    // Only one pointerdown listener added.
    const pointerCalls = addSpy.mock.calls.filter(
      ([name]) => name === 'pointerdown',
    );
    expect(pointerCalls).toHaveLength(1);
  });

  it('detach without attach is safe', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    expect(() => editor.detach()).not.toThrow();
  });

  it('detach clears selection', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    expect(editor.getSelection()).toBe(rect);
    editor.detach();
    expect(editor.getSelection()).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Programmatic selection
// ---------------------------------------------------------------------------

describe('SvgEditor setSelection', () => {
  it('selects an element', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    expect(editor.getSelection()).toBe(rect);
  });

  it('fires onSelectionChange on selection', () => {
    const rect = makeChild('rect');
    const svg = track(makeSvg([rect]));
    const listener = vi.fn();
    const editor = new SvgEditor(svg, { onSelectionChange: listener });
    editor.attach();
    editor.setSelection(rect);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('setSelection(null) clears selection', () => {
    const rect = makeChild('rect');
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    editor.setSelection(null);
    expect(editor.getSelection()).toBe(null);
  });

  it('same-element setSelection is a no-op', () => {
    const rect = makeChild('rect');
    const svg = track(makeSvg([rect]));
    const listener = vi.fn();
    const editor = new SvgEditor(svg, { onSelectionChange: listener });
    editor.attach();
    editor.setSelection(rect);
    listener.mockClear();
    editor.setSelection(rect);
    expect(listener).not.toHaveBeenCalled();
  });

  it('tspan selection resolves to parent text', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    const tspan = makeChild('tspan');
    tspan.textContent = 'hello';
    text.appendChild(tspan);
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(tspan);
    expect(editor.getSelection()).toBe(text);
  });

  it('non-selectable element selection returns null', () => {
    const defs = makeChild('defs');
    const svg = track(makeSvg([defs]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(defs);
    expect(editor.getSelection()).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Handle group rendering
// ---------------------------------------------------------------------------

describe('SvgEditor handle rendering', () => {
  it('creates the handle group on first selection', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    const group = svg.querySelector(`#${HANDLE_GROUP_ID}`);
    expect(group).toBeTruthy();
    expect(group.tagName.toLowerCase()).toBe('g');
  });

  it('handle group is the last child of the SVG', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const other = makeChild('circle', { cx: 50, cy: 50, r: 10 });
    const svg = track(makeSvg([rect, other]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    const lastChild = svg.lastElementChild;
    expect(lastChild.id).toBe(HANDLE_GROUP_ID);
  });

  it('handles carry the handle class', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    const group = svg.querySelector(`#${HANDLE_GROUP_ID}`);
    const handles = group.querySelectorAll(`.${HANDLE_CLASS}`);
    expect(handles.length).toBeGreaterThan(0);
  });

  it('handle group is cleared on deselection', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    editor.setSelection(null);
    const group = svg.querySelector(`#${HANDLE_GROUP_ID}`);
    expect(group).toBeTruthy();
    // Group remains but is empty.
    expect(group.children.length).toBe(0);
  });

  it('handle group persists across selection changes', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const circle = makeChild('circle', { cx: 50, cy: 50, r: 10 });
    const svg = track(makeSvg([rect, circle]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    const group1 = svg.querySelector(`#${HANDLE_GROUP_ID}`);
    editor.setSelection(circle);
    const group2 = svg.querySelector(`#${HANDLE_GROUP_ID}`);
    expect(group1).toBe(group2);
  });

  it('re-attaching reuses an existing handle group', () => {
    // Pre-existing group in the SVG (e.g., from a prior
    // editor instance on the same SVG).
    const existingGroup = document.createElementNS(SVG_NS, 'g');
    existingGroup.setAttribute('id', HANDLE_GROUP_ID);
    const svg = track(makeSvg([existingGroup]));
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    svg.appendChild(rect);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    const groups = svg.querySelectorAll(`#${HANDLE_GROUP_ID}`);
    expect(groups).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Pointer event dispatch
// ---------------------------------------------------------------------------

describe('SvgEditor pointerdown dispatch', () => {
  it('calls hit-test on pointerdown', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    editor.attach();
    const spy = vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    svg.dispatchEvent(
      new MouseEvent('pointerdown', {
        clientX: 25,
        clientY: 35,
        button: 0,
        bubbles: true,
      }),
    );
    expect(spy).toHaveBeenCalledWith(25, 35);
  });

  it('selects hit element on pointerdown', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    svg.dispatchEvent(
      new MouseEvent('pointerdown', {
        clientX: 15,
        clientY: 15,
        button: 0,
        bubbles: true,
      }),
    );
    expect(editor.getSelection()).toBe(rect);
  });

  it('clicking empty space deselects', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    svg.dispatchEvent(
      new MouseEvent('pointerdown', {
        clientX: 90,
        clientY: 90,
        button: 0,
        bubbles: true,
      }),
    );
    expect(editor.getSelection()).toBe(null);
  });

  it('ignores non-primary mouse buttons', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    editor.attach();
    const spy = vi.spyOn(editor, '_hitTest');
    const ev = new MouseEvent('pointerdown', {
      clientX: 25,
      clientY: 35,
      button: 2, // right-click
      bubbles: true,
    });
    // Simulate mouse pointer type via defineProperty since
    // MouseEvent constructor doesn't support it directly.
    Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
    svg.dispatchEvent(ev);
    expect(spy).not.toHaveBeenCalled();
  });

  it('stops propagation on element hit', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    const outerListener = vi.fn();
    document.body.addEventListener('pointerdown', outerListener);
    try {
      svg.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: 15,
          clientY: 15,
          button: 0,
          bubbles: true,
        }),
      );
      expect(outerListener).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener('pointerdown', outerListener);
    }
  });

  it('does not stop propagation on empty-space click', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    editor.attach();
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    const outerListener = vi.fn();
    document.body.addEventListener('pointerdown', outerListener);
    try {
      svg.dispatchEvent(
        new MouseEvent('pointerdown', {
          clientX: 90,
          clientY: 90,
          button: 0,
          bubbles: true,
        }),
      );
      expect(outerListener).toHaveBeenCalled();
    } finally {
      document.body.removeEventListener('pointerdown', outerListener);
    }
  });
});

// ---------------------------------------------------------------------------
// Hit-test filtering
// ---------------------------------------------------------------------------

describe('SvgEditor hit-test filtering', () => {
  it('skips handles by class', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const handleRect = makeChild('rect');
    handleRect.setAttribute('class', HANDLE_CLASS);
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    // Mock elementsFromPoint to return handle first, then
    // the real rect.
    const root = svg.getRootNode();
    root.elementsFromPoint = () => [handleRect, rect];
    expect(editor._hitTest(50, 50)).toBe(rect);
  });

  it('skips handle group by id', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('id', HANDLE_GROUP_ID);
    const svg = track(makeSvg([rect, group]));
    const editor = new SvgEditor(svg);
    const root = svg.getRootNode();
    root.elementsFromPoint = () => [group, rect];
    expect(editor._hitTest(50, 50)).toBe(rect);
  });

  it('skips the root SVG itself', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    const root = svg.getRootNode();
    root.elementsFromPoint = () => [svg];
    expect(editor._hitTest(50, 50)).toBe(null);
  });

  it('skips non-selectable tags', () => {
    const defs = makeChild('defs');
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([defs, rect]));
    const editor = new SvgEditor(svg);
    const root = svg.getRootNode();
    root.elementsFromPoint = () => [defs, rect];
    expect(editor._hitTest(50, 50)).toBe(rect);
  });

  it('resolves tspan to parent text', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    const tspan = makeChild('tspan');
    text.appendChild(tspan);
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    const root = svg.getRootNode();
    root.elementsFromPoint = () => [tspan];
    expect(editor._hitTest(50, 50)).toBe(text);
  });

  it('skips elements outside the SVG subtree', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    const outsideDiv = document.createElement('div');
    document.body.appendChild(outsideDiv);
    try {
      const root = svg.getRootNode();
      root.elementsFromPoint = () => [outsideDiv];
      expect(editor._hitTest(50, 50)).toBe(null);
    } finally {
      document.body.removeChild(outsideDiv);
    }
  });

  it('returns null when elementsFromPoint is unavailable', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    const root = svg.getRootNode();
    // Override to an empty-returning version
    root.elementsFromPoint = () => [];
    expect(editor._hitTest(50, 50)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Keyboard handling
// ---------------------------------------------------------------------------

describe('SvgEditor keyboard handling', () => {
  it('Escape clears selection', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape' }),
    );
    expect(editor.getSelection()).toBe(null);
  });

  it('Escape without selection is a no-op', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    editor.attach();
    const listener = vi.fn();
    editor._onSelectionChange = listener;
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape' }),
    );
    expect(listener).not.toHaveBeenCalled();
  });

  it('Delete removes selected element', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete' }),
    );
    expect(editor.getSelection()).toBe(null);
    expect(rect.parentNode).toBe(null);
  });

  it('Backspace also removes selected element', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace' }),
    );
    expect(rect.parentNode).toBe(null);
  });

  it('Delete without selection does not consume the event', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    editor.attach();
    const ev = new KeyboardEvent('keydown', {
      key: 'Delete',
      cancelable: true,
    });
    document.dispatchEvent(ev);
    // When nothing is selected we don't preventDefault,
    // letting the event flow to textareas / inputs.
    expect(ev.defaultPrevented).toBe(false);
  });

  it('delete fires onChange', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.setSelection(rect);
    editor.deleteSelection();
    expect(changeListener).toHaveBeenCalledOnce();
  });

  it('detached editor does not respond to keydown', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    editor.detach();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete' }),
    );
    // Element still in the DOM.
    expect(rect.parentNode).toBe(svg);
  });
});

// ---------------------------------------------------------------------------
// deleteSelection
// ---------------------------------------------------------------------------

describe('SvgEditor deleteSelection', () => {
  it('removes the selected element', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.setSelection(rect);
    editor.deleteSelection();
    expect(rect.parentNode).toBe(null);
  });

  it('clears selection after delete', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.setSelection(rect);
    editor.deleteSelection();
    expect(editor.getSelection()).toBe(null);
  });

  it('no-op without selection', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    const listener = vi.fn();
    editor._onChange = listener;
    editor.deleteSelection();
    expect(listener).not.toHaveBeenCalled();
  });

  it('fires onSelectionChange after delete', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const listener = vi.fn();
    const editor = new SvgEditor(svg, { onSelectionChange: listener });
    editor.setSelection(rect);
    listener.mockClear();
    editor.deleteSelection();
    expect(listener).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Coordinate math
// ---------------------------------------------------------------------------

describe('SvgEditor coordinate helpers', () => {
  it('_screenToSvg with identity CTM returns input', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    const p = editor._screenToSvg(50, 50);
    expect(p.x).toBe(50);
    expect(p.y).toBe(50);
  });

  it('_screenDistToSvgDist returns positive distance', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    const d = editor._screenDistToSvgDist(HANDLE_SCREEN_RADIUS);
    expect(d).toBe(HANDLE_SCREEN_RADIUS);
  });

  it('_getHandleRadius returns a positive value', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    const r = editor._getHandleRadius();
    expect(r).toBeGreaterThan(0);
    expect(Number.isFinite(r)).toBe(true);
  });

  it('_localToSvgRoot with identity CTMs returns input', () => {
    const rect = makeChild('rect');
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    const p = editor._localToSvgRoot(rect, 10, 20);
    expect(p.x).toBe(10);
    expect(p.y).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

describe('_parseNum', () => {
  it('parses numeric string', () => {
    expect(_parseNum('42')).toBe(42);
    expect(_parseNum('-10.5')).toBe(-10.5);
    expect(_parseNum('0')).toBe(0);
  });

  it('returns 0 for null / missing', () => {
    expect(_parseNum(null)).toBe(0);
    expect(_parseNum(undefined)).toBe(0);
    expect(_parseNum('')).toBe(0);
  });

  it('returns 0 for non-numeric input', () => {
    expect(_parseNum('not a number')).toBe(0);
    expect(_parseNum('NaN')).toBe(0);
  });

  it('handles scientific notation', () => {
    expect(_parseNum('1e2')).toBe(100);
  });
});

describe('_parsePoints', () => {
  it('parses whitespace-separated points', () => {
    expect(_parsePoints('10 20 30 40')).toEqual([[10, 20], [30, 40]]);
  });

  it('parses comma-separated points', () => {
    expect(_parsePoints('10,20 30,40')).toEqual([[10, 20], [30, 40]]);
  });

  it('parses mixed separators', () => {
    expect(_parsePoints('10,20,30,40')).toEqual([[10, 20], [30, 40]]);
    expect(_parsePoints('10 20, 30 40')).toEqual([[10, 20], [30, 40]]);
  });

  it('returns empty array for empty or null', () => {
    expect(_parsePoints('')).toEqual([]);
    expect(_parsePoints(null)).toEqual([]);
    expect(_parsePoints(undefined)).toEqual([]);
  });

  it('returns empty array for odd number of tokens', () => {
    expect(_parsePoints('10 20 30')).toEqual([]);
  });

  it('returns empty array for non-numeric input', () => {
    expect(_parsePoints('a b c d')).toEqual([]);
  });
});

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

  it('pointerdown on empty space cancels no existing drag', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(rect);
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    firePointer(svg, 'pointerdown', 90, 90);
    expect(editor._drag).toBe(null);
    expect(editor.getSelection()).toBe(null);
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

/**
 * Helper to run a full drag sequence and return the
 * final attribute state of the element.
 */
function runDrag(svg, editor, element, from, to) {
  vi.spyOn(editor, '_hitTest').mockReturnValue(element);
  editor.setSelection(element);
  firePointer(svg, 'pointerdown', from.x, from.y);
  firePointer(svg, 'pointermove', to.x, to.y);
  firePointer(svg, 'pointerup', to.x, to.y);
}

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

// ---------------------------------------------------------------------------
// Resize handle rendering
// ---------------------------------------------------------------------------

describe('SvgEditor resize handle rendering', () => {
  /**
   * Extract handle dots (children of the handle group
   * with a role attribute) from the selected element's
   * handle overlay.
   */
  function getHandles(svg) {
    const group = svg.querySelector(`#svg-editor-handles`);
    if (!group) return [];
    return Array.from(
      group.querySelectorAll('[data-handle-role]'),
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

  it('path selection produces no resize handles', () => {
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
    expect(getHandles(svg)).toHaveLength(0);
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

/**
 * Run a resize drag by forcing a specific handle role and
 * firing a pointer sequence. Returns the final attribute
 * state.
 */
function runResizeDrag(svg, editor, element, role, from, to) {
  vi.spyOn(editor, '_hitTestHandle').mockReturnValue(role);
  editor.setSelection(element);
  firePointer(svg, 'pointerdown', from.x, from.y);
  firePointer(svg, 'pointermove', to.x, to.y);
  firePointer(svg, 'pointerup', to.x, to.y);
}

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

// ---------------------------------------------------------------------------
// Line endpoint resize
// ---------------------------------------------------------------------------

describe('SvgEditor resize drag: line endpoints', () => {
  function getHandles(svg) {
    const group = svg.querySelector('#svg-editor-handles');
    if (!group) return [];
    return Array.from(
      group.querySelectorAll('[data-handle-role]'),
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