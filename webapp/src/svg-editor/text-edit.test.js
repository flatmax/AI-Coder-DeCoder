import { afterEach, describe, expect, it, vi } from 'vitest';

import { SvgEditor } from '../svg-editor.js';
import {
  firePointer,
  installCleanup,
  makeChild,
  makeSvg,
  stubPointerCapture,
  track,
} from './test-helpers.js';

installCleanup();

describe('SvgEditor beginTextEdit', () => {
  it('no-op when argument is null', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(null);
    expect(editor._textEdit).toBe(null);
  });

  it('no-op when argument is non-text element', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(rect);
    expect(editor._textEdit).toBe(null);
  });

  it('opens a foreignObject overlay for a text element', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    expect(editor._textEdit).not.toBe(null);
    expect(editor._textEdit.element).toBe(text);
    // foreignObject appended to the SVG.
    const fo = svg.querySelector('foreignObject');
    expect(fo).toBeTruthy();
  });

  it('overlay contains a textarea with the element text', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello world';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe('hello world');
  });

  it('overlay positioned from element bounding box', () => {
    // The overlay measures the element's painted bbox
    // via getBoundingClientRect (screen pixels), maps
    // it through the inverse root CTM to SVG-root
    // coords, and applies a small screen-pixel padding
    // (padScreenX=2, padScreenY=1) on each side. At
    // identity CTM the padding is 2 SVG units
    // horizontally and 1 unit vertically, so the fo's
    // origin is (bbox.x - 2, bbox.y - 1).
    //
    // makeChild stubs getBoundingClientRect to read
    // the element's x/y/width/height attributes, so we
    // pin the bbox via those attrs rather than via a
    // custom getBBox stub.
    const text = makeChild('text', {
      x: 30,
      y: 40,
      width: 20,
      height: 10,
    });
    text.textContent = 'hi';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const fo = svg.querySelector('foreignObject');
    expect(parseFloat(fo.getAttribute('x'))).toBeCloseTo(28);
    expect(parseFloat(fo.getAttribute('y'))).toBeCloseTo(39);
  });

  it('textarea font-size derived from painted bbox height', () => {
    // The implementation deliberately derives the
    // textarea's font-size from the element's painted
    // height (via getBoundingClientRect) divided by the
    // current zoom, with a small 0.85 ratio and a chrome
    // allowance. It does NOT read the font-size attribute
    // directly — the painted height is the authoritative
    // source because font-size alone doesn't account for
    // browser-applied leading, descent, and line-box
    // metrics. See the _renderTextEditOverlay comment.
    //
    // With makeChild's stubbed bbox at identity CTM:
    //   painted height = attr height (10) → inner = 6
    //   font-size = (6 * 0.85) / 1 = 5.1
    // We assert the shape of the emitted style (positive
    // numeric px value) rather than an exact number so
    // future tweaks to the chrome / ratio constants
    // don't cascade into every font test.
    const text = makeChild('text', {
      x: 10,
      y: 20,
      width: 30,
      height: 24,
      'font-size': '24',
    });
    text.textContent = 'big';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    const style = textarea.getAttribute('style');
    const match = /font-size:\s*([\d.]+)px/.exec(style);
    expect(match).not.toBe(null);
    expect(parseFloat(match[1])).toBeGreaterThan(0);
  });

  it('textarea inherits fill color', () => {
    const text = makeChild('text', {
      x: 10,
      y: 20,
      fill: '#ff0000',
    });
    text.textContent = 'red';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    expect(textarea.getAttribute('style')).toContain('color: #ff0000');
  });

  it('textarea has a valid font-size even without font-size attribute', () => {
    // Companion to the "derived from painted bbox"
    // test above — proves the derivation path produces
    // a positive px value regardless of whether the
    // source element carries a font-size attribute.
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'plain';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    const style = textarea.getAttribute('style');
    const match = /font-size:\s*([\d.]+)px/.exec(style);
    expect(match).not.toBe(null);
    expect(parseFloat(match[1])).toBeGreaterThan(0);
  });

  it('foreignObject has handle class (excluded from hit-test)', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const fo = svg.querySelector('foreignObject');
    expect(fo.classList.contains('svg-editor-handle')).toBe(true);
  });

  it('commits prior edit when starting a new one', () => {
    const text1 = makeChild('text', { x: 10, y: 20 });
    text1.textContent = 'first';
    const text2 = makeChild('text', { x: 50, y: 60 });
    text2.textContent = 'second';
    const svg = track(makeSvg([text1, text2]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text1);
    // User types into the first textarea.
    const textarea1 = svg.querySelector('textarea');
    textarea1.value = 'first-edited';
    // Starting edit on text2 should commit text1 first.
    editor.beginTextEdit(text2);
    expect(text1.textContent).toBe('first-edited');
    // Only one foreignObject alive (the new one).
    const fos = svg.querySelectorAll('foreignObject');
    expect(fos).toHaveLength(1);
    expect(editor._textEdit.element).toBe(text2);
  });

  it('captures original content for rollback', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'original';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    expect(editor._textEdit.originalContent).toBe('original');
  });
});

describe('SvgEditor commitTextEdit', () => {
  it('no-op when no edit is active', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    editor.attach();
    expect(() => editor.commitTextEdit()).not.toThrow();
  });

  it('replaces element text with textarea value', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'old';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.value = 'new';
    editor.commitTextEdit();
    expect(text.textContent).toBe('new');
  });

  it('removes foreignObject overlay on commit', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    editor.commitTextEdit();
    expect(svg.querySelector('foreignObject')).toBe(null);
  });

  it('clears _textEdit state', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    editor.commitTextEdit();
    expect(editor._textEdit).toBe(null);
  });

  it('fires onChange when content changed', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'old';
    const svg = track(makeSvg([text]));
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.value = 'new';
    editor.commitTextEdit();
    expect(changeListener).toHaveBeenCalledOnce();
  });

  it('does NOT fire onChange when content unchanged', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.beginTextEdit(text);
    // No modification.
    editor.commitTextEdit();
    expect(changeListener).not.toHaveBeenCalled();
  });

  it('flattens tspan children on commit', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    const tspan1 = makeChild('tspan');
    tspan1.textContent = 'part1 ';
    const tspan2 = makeChild('tspan');
    tspan2.textContent = 'part2';
    text.appendChild(tspan1);
    text.appendChild(tspan2);
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.value = 'flattened';
    editor.commitTextEdit();
    // No more tspan children — just a text node.
    expect(text.querySelector('tspan')).toBe(null);
    expect(text.textContent).toBe('flattened');
  });

  it('allows empty content on commit', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'something';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.value = '';
    editor.commitTextEdit();
    expect(text.textContent).toBe('');
  });
});

describe('SvgEditor cancelTextEdit', () => {
  it('no-op when no edit is active', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    editor.attach();
    expect(() => editor.cancelTextEdit()).not.toThrow();
  });

  it('restores original content on cancel', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'original';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.value = 'modified';
    editor.cancelTextEdit();
    expect(text.textContent).toBe('original');
  });

  it('removes foreignObject overlay on cancel', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    editor.cancelTextEdit();
    expect(svg.querySelector('foreignObject')).toBe(null);
  });

  it('does NOT fire onChange on cancel', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'original';
    const svg = track(makeSvg([text]));
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.value = 'modified but will cancel';
    editor.cancelTextEdit();
    expect(changeListener).not.toHaveBeenCalled();
  });

  it('clears _textEdit state', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    editor.cancelTextEdit();
    expect(editor._textEdit).toBe(null);
  });
});

describe('SvgEditor text edit keyboard', () => {
  it('Enter commits the edit', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'old';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.value = 'new';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(text.textContent).toBe('new');
    expect(editor._textEdit).toBe(null);
  });

  it('Shift+Enter does not commit (multi-line)', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Still editing.
    expect(editor._textEdit).not.toBe(null);
  });

  it('Escape cancels the edit', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'original';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.value = 'abandoned';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(text.textContent).toBe('original');
    expect(editor._textEdit).toBe(null);
  });

  it('other keys do not commit or cancel', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', bubbles: true }),
    );
    expect(editor._textEdit).not.toBe(null);
  });

  it('textarea Delete key does not delete the element', () => {
    // The document-level keydown handler would normally
    // delete the selected element on Delete. During a
    // text edit, the textarea's keydown handler stops
    // propagation so Delete falls through as normal
    // textarea behavior.
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(text);
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
    );
    // Text element still in the DOM.
    expect(text.parentNode).toBe(svg);
  });
});

describe('SvgEditor text edit blur', () => {
  it('blur commits the edit', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'old';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.value = 'new';
    textarea.dispatchEvent(new FocusEvent('blur'));
    expect(text.textContent).toBe('new');
    expect(editor._textEdit).toBe(null);
  });

  it('blur does not double-commit when edit already committed', () => {
    // Commit via Enter, then blur — blur should no-op.
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'old';
    const svg = track(makeSvg([text]));
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.value = 'new';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
    // Simulated blur after commit — should no-op.
    textarea.dispatchEvent(new FocusEvent('blur'));
    expect(changeListener).toHaveBeenCalledOnce();
  });
});

describe('SvgEditor double-click dispatch', () => {
  it('double-click on text element opens edit', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    vi.spyOn(editor, '_hitTest').mockReturnValue(text);
    const ev = new MouseEvent('dblclick', {
      clientX: 15,
      clientY: 20,
      bubbles: true,
      cancelable: true,
    });
    svg.dispatchEvent(ev);
    expect(editor._textEdit).not.toBe(null);
    expect(editor._textEdit.element).toBe(text);
  });

  it('double-click on non-text does not open edit', () => {
    const rect = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([rect]));
    const editor = new SvgEditor(svg);
    editor.attach();
    vi.spyOn(editor, '_hitTest').mockReturnValue(rect);
    svg.dispatchEvent(
      new MouseEvent('dblclick', {
        clientX: 15,
        clientY: 15,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(editor._textEdit).toBe(null);
  });

  it('double-click on empty space does not open edit', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    editor.attach();
    vi.spyOn(editor, '_hitTest').mockReturnValue(null);
    svg.dispatchEvent(
      new MouseEvent('dblclick', {
        clientX: 50,
        clientY: 50,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(editor._textEdit).toBe(null);
  });

  it('double-click routes via tspan → parent text', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    const tspan = makeChild('tspan');
    tspan.textContent = 'part';
    text.appendChild(tspan);
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    // _hitTest resolves tspan → text naturally.
    vi.spyOn(editor, '_hitTest').mockReturnValue(text);
    svg.dispatchEvent(
      new MouseEvent('dblclick', {
        clientX: 15,
        clientY: 20,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(editor._textEdit?.element).toBe(text);
  });

  it('stops propagation on text dblclick', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    vi.spyOn(editor, '_hitTest').mockReturnValue(text);
    const outerListener = vi.fn();
    document.body.addEventListener('dblclick', outerListener);
    try {
      svg.dispatchEvent(
        new MouseEvent('dblclick', {
          clientX: 15,
          clientY: 20,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(outerListener).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener('dblclick', outerListener);
    }
  });
});

describe('SvgEditor text edit lifecycle', () => {
  it('detach cancels active text edit', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'original';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.value = 'modified';
    editor.detach();
    // Overlay removed.
    expect(svg.querySelector('foreignObject')).toBe(null);
    // Original content restored.
    expect(text.textContent).toBe('original');
    expect(editor._textEdit).toBe(null);
  });

  it('detach does not fire onChange for rollback', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'original';
    const svg = track(makeSvg([text]));
    const changeListener = vi.fn();
    const editor = new SvgEditor(svg, { onChange: changeListener });
    editor.attach();
    editor.beginTextEdit(text);
    editor.detach();
    expect(changeListener).not.toHaveBeenCalled();
  });

  it('re-renders handles after commit', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(text);
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.value = 'hi';
    editor.commitTextEdit();
    // Handle group should still exist with handles.
    const group = svg.querySelector('#svg-editor-handles');
    expect(group).toBeTruthy();
  });

  it('starting edit while drag is in flight does not break', () => {
    // Defensive — shouldn't happen in practice, but
    // beginTextEdit called while _drag is set shouldn't
    // crash.
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'hello';
    const svg = track(makeSvg([text]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(text);
    // Force a drag state.
    editor._drag = {
      mode: 'move',
      pointerId: 1,
      startX: 0,
      startY: 0,
      originAttrs: { kind: 'xy', x: 10, y: 20 },
      committed: false,
    };
    expect(() => editor.beginTextEdit(text)).not.toThrow();
    expect(editor._textEdit).not.toBe(null);
    // Clean up.
    editor._drag = null;
  });
});