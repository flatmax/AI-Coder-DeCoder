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