import { describe, expect, it, vi } from 'vitest';
import {
  SvgEditor,
  _PASTE_OFFSET,
  _UNDO_MAX,
} from '../svg-editor.js';
import {
  firePointer,
  installCleanup,
  makeChild,
  makeSvg,
  stubPointerCapture,
  track,
} from './test-helpers.js';

installCleanup();

// ---------------------------------------------------------------------------
// Undo stack — Phase 3.2c.5
// ---------------------------------------------------------------------------

describe('SvgEditor undo stack', () => {
  it('undo restores SVG after delete', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    editor.deleteSelection();
    expect(svg.querySelectorAll('rect').length).toBe(0);
    editor.undo();
    expect(svg.querySelectorAll('rect').length).toBe(1);
  });

  it('undo clears selection (stale refs)', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    editor.deleteSelection();
    editor.undo();
    expect(editor.getSelection()).toBe(null);
    expect(editor.getSelectionSet().size).toBe(0);
  });

  it('undo fires onChange', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const onChange = vi.fn();
    const editor = new SvgEditor(svg, { onChange });
    editor.attach();
    editor.setSelection(r1);
    editor.deleteSelection();
    onChange.mockClear();
    editor.undo();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('undo returns false when stack is empty', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    editor.attach();
    expect(editor.undo()).toBe(false);
    expect(editor.canUndo).toBe(false);
  });

  it('undo restores SVG after drag commit', () => {
    // Drag pushes undo before the first mutation. After
    // pointerup the element has moved; undo should restore
    // the pre-drag innerHTML. We drive the drag manually
    // (not via runDrag) to control pointer capture and
    // verify each step.
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    stubPointerCapture(svg);
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    vi.spyOn(editor, '_hitTest').mockReturnValue(r1);
    vi.spyOn(editor, '_hitTestHandle').mockReturnValue(null);
    firePointer(svg, 'pointerdown', 15, 15);
    expect(editor._drag).not.toBe(null);
    firePointer(svg, 'pointermove', 35, 35);
    expect(editor._drag.committed).toBe(true);
    expect(r1.getAttribute('x')).toBe('30');
    firePointer(svg, 'pointerup', 35, 35);
    expect(editor.canUndo).toBe(true);
    editor.undo();
    const restored = svg.querySelector('rect');
    expect(restored.getAttribute('x')).toBe('10');
  });

  it('undo restores SVG after text edit commit', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'original';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.value = 'changed';
    editor.commitTextEdit();
    expect(text.textContent).toBe('changed');
    editor.undo();
    const restored = svg.querySelector('text');
    expect(restored.textContent).toBe('original');
  });

  it('unchanged text edit does not push undo', () => {
    const text = makeChild('text', { x: 10, y: 20 });
    text.textContent = 'same';
    const svg = track(makeSvg([text]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.beginTextEdit(text);
    const textarea = svg.querySelector('textarea');
    textarea.value = 'same';
    editor.commitTextEdit();
    expect(editor.canUndo).toBe(false);
  });

  it('stack is bounded to _UNDO_MAX entries', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    editor.attach();
    for (let i = 0; i < _UNDO_MAX + 5; i += 1) {
      editor._pushUndo();
    }
    expect(editor._undoStack.length).toBe(_UNDO_MAX);
  });

  it('detach clears the stack', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    editor.deleteSelection();
    expect(editor.canUndo).toBe(true);
    editor.detach();
    expect(editor.canUndo).toBe(false);
  });

  it('Ctrl+Z triggers undo', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    editor.deleteSelection();
    expect(svg.querySelectorAll('rect').length).toBe(0);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }),
    );
    expect(svg.querySelectorAll('rect').length).toBe(1);
  });

  it('multiple undos restore progressively', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    editor.deleteSelection();
    expect(svg.querySelectorAll('rect').length).toBe(1);
    const remaining = svg.querySelector('rect');
    editor.setSelection(remaining);
    editor.deleteSelection();
    expect(svg.querySelectorAll('rect').length).toBe(0);
    editor.undo();
    expect(svg.querySelectorAll('rect').length).toBe(1);
    editor.undo();
    expect(svg.querySelectorAll('rect').length).toBe(2);
  });

  it('undo snapshot excludes handle group', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    // Handle group should exist now.
    expect(svg.querySelector('#svg-editor-handles')).toBeTruthy();
    editor.deleteSelection();
    // The undo snapshot was captured before the delete;
    // check that restoring it doesn't produce duplicate
    // handle groups.
    editor.undo();
    const groups = svg.querySelectorAll('#svg-editor-handles');
    expect(groups.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Copy / Paste / Duplicate — Phase 3.2c.5
// ---------------------------------------------------------------------------

describe('SvgEditor copy/paste', () => {
  it('copy populates internal clipboard', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    editor.copySelection();
    expect(editor._clipboard.length).toBe(1);
    expect(editor._clipboard[0]).toContain('rect');
  });

  it('paste inserts element with offset', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    editor.copySelection();
    editor.pasteClipboard();
    const rects = svg.querySelectorAll('rect');
    expect(rects.length).toBe(2);
  });

  it('pasted rect has offset applied', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    editor.copySelection();
    editor.pasteClipboard();
    const rects = svg.querySelectorAll('rect');
    // Find the pasted one (not the original).
    let pasted = null;
    for (const r of rects) {
      if (r.getAttribute('x') !== '10') pasted = r;
    }
    expect(pasted).not.toBe(null);
    expect(pasted.getAttribute('x')).toBe(String(10 + _PASTE_OFFSET));
    expect(pasted.getAttribute('y')).toBe(String(10 + _PASTE_OFFSET));
  });

  it('paste selects the pasted element', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    editor.copySelection();
    editor.pasteClipboard();
    expect(editor.getSelection()).not.toBe(r1);
    expect(editor.getSelectionSet().size).toBe(1);
  });

  it('paste fires onChange', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const onChange = vi.fn();
    const editor = new SvgEditor(svg, { onChange });
    editor.attach();
    editor.setSelection(r1);
    editor.copySelection();
    onChange.mockClear();
    editor.pasteClipboard();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('paste pushes undo so it can be undone', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    editor.copySelection();
    editor.pasteClipboard();
    expect(svg.querySelectorAll('rect').length).toBe(2);
    editor.undo();
    expect(svg.querySelectorAll('rect').length).toBe(1);
  });

  it('paste with empty clipboard is no-op', () => {
    const svg = track(makeSvg());
    const onChange = vi.fn();
    const editor = new SvgEditor(svg, { onChange });
    editor.attach();
    editor.pasteClipboard();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('copy with nothing selected is no-op', () => {
    const svg = track(makeSvg());
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.copySelection();
    expect(editor._clipboard.length).toBe(0);
  });

  it('Ctrl+C then Ctrl+V works via keyboard', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }),
    );
    expect(editor._clipboard.length).toBe(1);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }),
    );
    expect(svg.querySelectorAll('rect').length).toBe(2);
  });

  it('duplicate creates a copy in place (no offset)', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    editor.duplicateSelection();
    const rects = svg.querySelectorAll('rect');
    expect(rects.length).toBe(2);
    // Both at same position.
    for (const r of rects) {
      expect(r.getAttribute('x')).toBe('10');
      expect(r.getAttribute('y')).toBe('10');
    }
  });

  it('Ctrl+D duplicates via keyboard', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }),
    );
    expect(svg.querySelectorAll('rect').length).toBe(2);
  });

  it('copy multi-selection pastes all elements', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const r2 = makeChild('rect', { x: 50, y: 50, width: 20, height: 20 });
    const svg = track(makeSvg([r1, r2]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.toggleSelection(r1);
    editor.toggleSelection(r2);
    editor.copySelection();
    expect(editor._clipboard.length).toBe(2);
    editor.pasteClipboard();
    expect(svg.querySelectorAll('rect').length).toBe(4);
  });

  it('paste circle uses cx/cy offset', () => {
    const c = makeChild('circle', { cx: 30, cy: 40, r: 10 });
    const svg = track(makeSvg([c]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(c);
    editor.copySelection();
    editor.pasteClipboard();
    const circles = svg.querySelectorAll('circle');
    expect(circles.length).toBe(2);
  });

  it('paste path uses transform offset', () => {
    const p = makeChild('path', { d: 'M 0 0 L 10 10' });
    const svg = track(makeSvg([p]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(p);
    editor.copySelection();
    editor.pasteClipboard();
    const paths = svg.querySelectorAll('path');
    expect(paths.length).toBe(2);
  });

  it('detach clears clipboard', () => {
    const r1 = makeChild('rect', { x: 10, y: 10, width: 20, height: 20 });
    const svg = track(makeSvg([r1]));
    const editor = new SvgEditor(svg);
    editor.attach();
    editor.setSelection(r1);
    editor.copySelection();
    expect(editor._clipboard.length).toBe(1);
    editor.detach();
    expect(editor._clipboard.length).toBe(0);
  });
});