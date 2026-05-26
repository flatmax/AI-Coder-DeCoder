// Text-edit mixin — inline foreignObject-hosted textarea
// for editing <text> element content.
//
// Methods use `this` to access editor state. Bodies copied
// verbatim from svg-editor.js. References to the handle
// class constant use the imported name.

import { HANDLE_CLASS } from './constants.js';

export default {
  /**
   * Begin an inline text edit on a `<text>` element.
   * Opens a foreignObject-hosted textarea positioned at
   * the element's bounding box. No-op for non-text
   * elements or when the argument is null.
   *
   * If another edit is already in flight, that edit is
   * committed first. Prevents orphaned foreignObjects
   * when the user double-clicks one text then another
   * without pressing Enter in between.
   */
  beginTextEdit(element) {
    if (!element || !element.tagName) return;
    if (element.tagName.toLowerCase() !== 'text') return;
    // Commit any prior edit so we never have two
    // foreignObjects alive at once.
    if (this._textEdit) {
      this.commitTextEdit();
    }
    const originalContent = element.textContent || '';
    const overlay = this._renderTextEditOverlay(element, originalContent);
    if (!overlay) return;
    this._textEdit = {
      element,
      originalContent,
      foreignObject: overlay.foreignObject,
      textarea: overlay.textarea,
    };
    // Focus + select all so the user can immediately
    // start typing to replace, or arrow-key to edit.
    try {
      overlay.textarea.focus();
      overlay.textarea.select?.();
    } catch (_) {
      // jsdom / headless environments may not support
      // focus correctly; the edit is still functional
      // via programmatic API.
    }
  },

  /**
   * Commit the active text edit. Replaces the element's
   * children with a single text node containing the
   * textarea's value. Any pre-existing `<tspan>` children
   * are flattened. Fires `onChange` if the content
   * actually changed. No-op when no edit is active.
   */
  commitTextEdit() {
    if (!this._textEdit) return;
    const edit = this._textEdit;
    const newContent = edit.textarea.value;
    // Push undo before mutating — only if content actually
    // changed (no-change commits shouldn't pollute the stack).
    if (newContent !== edit.originalContent) {
      this._pushUndo();
    }
    this._teardownTextEditOverlay(edit);
    this._textEdit = null;
    // Replace all children with a single text node.
    // Wholesale replacement flattens any <tspan>
    // structure. Documented trade-off — most SVG text
    // elements don't use tspan, and the ones that do
    // either get their structure preserved via the
    // source (user edits the file directly) or lose it
    // here. Users with tspan-heavy text should edit
    // the source.
    //
    // Position-preservation: if the visible text
    // position was driven by attributes on a child
    // <tspan> rather than the parent <text>, naive
    // flattening drops the text to the parent's
    // default (often 0,0). Before removing children,
    // copy any positioning attributes from the first
    // <tspan> onto the parent <text> when the parent
    // doesn't already have them set. Same for fill,
    // which is sometimes only declared on the tspan.
    const firstTspan = edit.element.querySelector?.('tspan');
    if (firstTspan) {
      const inherit = ['x', 'y', 'dx', 'dy', 'text-anchor', 'fill'];
      for (const attr of inherit) {
        if (
          !edit.element.hasAttribute(attr) &&
          firstTspan.hasAttribute(attr)
        ) {
          edit.element.setAttribute(
            attr,
            firstTspan.getAttribute(attr),
          );
        }
      }
    }
    while (edit.element.firstChild) {
      edit.element.removeChild(edit.element.firstChild);
    }
    // Per-glyph positioning fix: SVG <text> supports
    // list-valued x/y/dx/dy attributes that position
    // each glyph individually (common output from
    // PDF-derived SVGs, where the converter pre-computes
    // kerning). When the user edits the content, the
    // glyph count changes and the original list no
    // longer aligns — leftover positions either run out
    // (extra glyphs collapse together) or get reused
    // against the wrong glyphs (visible kerning chaos).
    //
    // Collapse any whitespace-separated list-valued
    // positioning attribute on the parent down to its
    // first value, so subsequent glyphs flow with the
    // font's natural metrics from the original starting
    // point. Only collapse when the list length doesn't
    // match the new content length — exact matches
    // (rare in practice) preserve the explicit kerning.
    const positioningAttrs = ['x', 'y', 'dx', 'dy'];
    for (const attr of positioningAttrs) {
      const value = edit.element.getAttribute(attr);
      if (!value) continue;
      const parts = value.trim().split(/\s+/);
      if (parts.length > 1 && parts.length !== newContent.length) {
        edit.element.setAttribute(attr, parts[0]);
      }
    }
    if (newContent) {
      edit.element.appendChild(
        document.createTextNode(newContent),
      );
    }
    // Fire onChange only when content actually changed.
    // Clicking into a text element, not typing, then
    // pressing Enter shouldn't mark the file dirty.
    if (newContent !== edit.originalContent) {
      this._onChange();
    }
    // Re-render handles in case the element's bounding
    // box changed as a result of the content change.
    this._renderHandles();
  },

  /**
   * Cancel the active text edit. Restores the element's
   * original content and removes the foreignObject
   * overlay. No onChange fired — cancel is a rollback.
   * No-op when no edit is active.
   */
  cancelTextEdit() {
    if (!this._textEdit) return;
    const edit = this._textEdit;
    this._teardownTextEditOverlay(edit);
    this._textEdit = null;
    // Restore original content. If the edit didn't
    // mutate the element's children (the user only
    // typed in the textarea), this is a no-op. If an
    // external caller modified the element mid-edit
    // (unlikely but defensive), this restores what we
    // snapshotted at edit start.
    //
    // Same position-preservation as commit: if the
    // original structure used a positioned <tspan>,
    // copy its attributes onto the parent before we
    // flatten, so the restored flat text renders at
    // the same place.
    const firstTspanCancel = edit.element.querySelector?.('tspan');
    if (firstTspanCancel) {
      const inherit = ['x', 'y', 'dx', 'dy', 'text-anchor', 'fill'];
      for (const attr of inherit) {
        if (
          !edit.element.hasAttribute(attr) &&
          firstTspanCancel.hasAttribute(attr)
        ) {
          edit.element.setAttribute(
            attr,
            firstTspanCancel.getAttribute(attr),
          );
        }
      }
    }
    while (edit.element.firstChild) {
      edit.element.removeChild(edit.element.firstChild);
    }
    if (edit.originalContent) {
      edit.element.appendChild(
        document.createTextNode(edit.originalContent),
      );
    }
    this._renderHandles();
  },

  /**
   * Build the foreignObject + textarea overlay for a
   * text edit. Positioned at the element's bounding box
   * with a small padding so typing doesn't overflow
   * immediately. Font size and color inherited from
   * the text element. Returns the foreignObject and
   * textarea refs, or null when bbox computation fails.
   */
  _renderTextEditOverlay(element, content) {
    // Compute the bbox in SVG-root coords. Use the
    // element's `getBoundingClientRect()` (the actual
    // painted extent in screen pixels) rather than
    // `getBBox()` (the geometric/glyph bbox in local
    // coords).
    //
    // Why the difference matters: for `<text>` elements,
    // `getBBox()` can return a width that's smaller than
    // the painted text — it measures glyph bounds using
    // font metrics that don't always match what the
    // browser actually renders (especially with bold
    // variants, font loading races, or fallback fonts).
    // `getBoundingClientRect()` reflects the painted
    // pixels: whatever the user sees is what we span.
    //
    // Convert the four screen corners through the root
    // SVG's inverse CTM to get SVG-root coords, then
    // build an axis-aligned bbox. Same pattern as
    // `_elementBBoxInSvgRoot` but sourced from the
    // paint rect rather than the geometric bbox.
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return null;
    }
    const tl = this._screenToSvg(rect.left, rect.top);
    const tr = this._screenToSvg(rect.right, rect.top);
    const bl = this._screenToSvg(rect.left, rect.bottom);
    const br = this._screenToSvg(rect.right, rect.bottom);
    const xs = [tl.x, tr.x, bl.x, br.x];
    const ys = [tl.y, tr.y, bl.y, br.y];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const bbox = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
    // Positioning padding. Small amount so the glyphs
    // don't butt up against the textarea border, but
    // not so much that the overlay dwarfs the text it's
    // editing. Expressed in screen pixels and converted
    // to SVG-root units so the visual padding stays
    // consistent across zoom levels.
    //
    // No minimum width/height clamp: earlier revisions
    // enforced a screen-pixel minimum to guarantee a
    // usable textarea for tiny selections, but that
    // makes the overlay dramatically larger than a
    // typical body-text selection (see specs4 SVG
    // viewer "topic boundary detect" scenario). The
    // textarea is usable at any size — the user can
    // always zoom in before editing if the text is
    // genuinely too small.
    const padScreenX = 2;
    const padScreenY = 1;
    const padX = this._screenDistToSvgDist(padScreenX);
    const padY = this._screenDistToSvgDist(padScreenY);
    const width = bbox.width + padX * 2;
    const height = bbox.height + padY * 2;
    const ns = 'http://www.w3.org/2000/svg';
    const xhtmlNs = 'http://www.w3.org/1999/xhtml';
    const fo = document.createElementNS(ns, 'foreignObject');
    fo.setAttribute('x', String(bbox.x - padX));
    fo.setAttribute('y', String(bbox.y - padY));
    fo.setAttribute('width', String(width));
    fo.setAttribute('height', String(height));
    // Mark the foreignObject so `_hitTest` doesn't
    // re-select the text element if the user clicks
    // inside the textarea.
    fo.setAttribute('class', HANDLE_CLASS);
    // Font size: compute a value that, when rendered
    // through the foreignObject's transform chain,
    // produces glyphs matching the underlying text's
    // painted height.
    //
    // The pan-zoom transform scales both the SVG text
    // AND the foreignObject's CSS coordinate space by
    // the same factor. So if the SVG text has effective
    // font-size S (in user units) and the zoom scale is
    // Z, its painted height is S×Z screen pixels.
    // Setting the textarea's `font-size: S_css px`
    // inside the foreignObject paints at S_css × Z
    // screen pixels — same formula. So font-size in
    // user units = painted height / zoom.
    //
    // We have the painted height directly from
    // `rect.height` (screen pixels from
    // getBoundingClientRect). Divide by zoom to get the
    // user-unit font-size. Subtract a small CSS chrome
    // allowance (padding + border) so glyphs don't clip
    // against the textarea's border.
    const ctm = this._svg.getScreenCTM?.();
    const zoomScale = ctm && ctm.a ? Math.abs(ctm.a) : 1;
    // Chrome in screen pixels: 1px padding top + 1px
    // padding bottom + 1px border top + 1px border
    // bottom = 4 screen pixels total. Subtract from
    // painted height before converting to user units.
    //
    // Additional fudge factor: getBoundingClientRect on
    // SVG text returns a box that includes leading above
    // the cap-height and descent below the baseline.
    // HTML textareas render glyphs using a CSS line-box
    // that measures from ascent to descent — a different
    // metric. When we size the textarea's font to match
    // the SVG text's painted height, the textarea's
    // actual glyphs end up visibly taller (because the
    // SVG's "painted height" included leading, but the
    // textarea treats our font-size as pure ascent+descent
    // and then adds its own chrome).
    //
    // 0.85 is an empirical ratio that lands the textarea
    // glyphs at visually the same height as the SVG text
    // glyphs across common fonts. Fine-tunes the match
    // better than any combination of line-height and
    // padding tweaks alone.
    const chromeScreen = 4;
    const innerScreenHeight = Math.max(
      rect.height - chromeScreen,
      1,
    );
    const fontSize = String((innerScreenHeight * 0.85) / zoomScale);
    const fill = element.getAttribute('fill') || '#000';
    // Inherit font-family and font-weight from the SVG
    // text so glyph metrics match. Without this, the
    // textarea falls back to the host document's default
    // (often a serif / system font different from the
    // SVG's declared font-family), producing glyphs at
    // the same height but different width and weight.
    // Try attributes first (SVG 1.1), then computed style
    // (handles CSS-styled SVG text from stylesheets).
    let fontFamily = element.getAttribute('font-family');
    let fontWeight = element.getAttribute('font-weight');
    try {
      const computed = window.getComputedStyle?.(element);
      if (!fontFamily && computed?.fontFamily) {
        fontFamily = computed.fontFamily;
      }
      if (!fontWeight && computed?.fontWeight) {
        fontWeight = computed.fontWeight;
      }
    } catch (_) {}
    const textarea = document.createElementNS(xhtmlNs, 'textarea');
    textarea.value = content;
    // Inline styles — fills the foreignObject, inherits
    // font from the text element, accent border so the
    // active edit is visually distinct from other
    // handles.
    // Border width also scaled to screen pixels so the
    // accent outline stays visually consistent. The CSS
    // `px` unit inside foreignObject equals 1 SVG-root
    // unit, so we pass SVG-unit values with a "px"
    // suffix.
    //
    // `line-height: 1` is deliberate: SVG text renders
    // with line-height equal to font-size (no extra
    // leading), but HTML textareas default to ~1.2. If
    // we leave the default, the textarea's glyphs render
    // SMALLER than the underlying SVG text because the
    // textarea packs a 1.2× line-box into the same
    // height as the SVG text's 1.0× glyph extent. Setting
    // line-height to 1 makes them match.
    const borderWidth = this._screenDistToSvgDist(1);
    const borderRadius = this._screenDistToSvgDist(2);
    const styleParts = [
      'width: 100%',
      'height: 100%',
      'box-sizing: border-box',
      'margin: 0',
      `padding: ${padY}px ${padX}px`,
      `font-size: ${fontSize}px`,
      `color: ${fill}`,
      'background: rgba(255, 255, 255, 0.95)',
      `border: ${borderWidth}px solid #4fc3f7`,
      `border-radius: ${borderRadius}px`,
      'outline: none',
      'resize: none',
      'line-height: 1',
      'overflow: hidden',
    ];
    if (fontFamily) {
      styleParts.push(`font-family: ${fontFamily}`);
    } else {
      styleParts.push('font-family: inherit');
    }
    if (fontWeight) {
      styleParts.push(`font-weight: ${fontWeight}`);
    }
    textarea.setAttribute('style', styleParts.join('; '));
    textarea.addEventListener('keydown', this._onTextEditKeyDown);
    textarea.addEventListener('blur', this._onTextEditBlur);
    fo.appendChild(textarea);
    this._svg.appendChild(fo);
    return { foreignObject: fo, textarea };
  },

  /**
   * Remove the foreignObject overlay and detach its
   * event listeners. Called by both commit and cancel
   * paths.
   */
  _teardownTextEditOverlay(edit) {
    try {
      edit.textarea.removeEventListener(
        'keydown',
        this._onTextEditKeyDown,
      );
      edit.textarea.removeEventListener(
        'blur',
        this._onTextEditBlur,
      );
    } catch (_) {
      // Listeners may have been auto-removed if the
      // foreignObject was detached externally.
    }
    if (
      edit.foreignObject &&
      edit.foreignObject.parentNode
    ) {
      edit.foreignObject.parentNode.removeChild(
        edit.foreignObject,
      );
    }
  },

  /**
   * Keyboard handler for the textarea. Enter commits
   * (unless Shift is held for multi-line), Escape
   * cancels. Other keys flow through to default
   * textarea behavior.
   */
  _onTextEditKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.commitTextEdit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelTextEdit();
      return;
    }
    // Stop propagation for other keys too so the
    // editor's document-level keydown doesn't hijack
    // Delete/Backspace while typing.
    event.stopPropagation();
  },

  /**
   * Blur handler — user clicked outside the textarea.
   * Commits rather than cancels; accidental click-aways
   * shouldn't discard user work.
   */
  _onTextEditBlur() {
    // Defer so a programmatic focus change doesn't fire
    // blur before the focus lands elsewhere. Without the
    // timeout, Enter → focus-change → blur → double-commit
    // could race.
    if (!this._textEdit) return;
    this.commitTextEdit();
  },

  /**
   * Double-click dispatch. Opens an inline text edit
   * when the target is a `<text>` element (or a `<tspan>`
   * that resolves to its parent text). Other elements
   * ignore the gesture.
   *
   * When the target is part of a multi-selection, the
   * set collapses to just the target before the edit
   * opens. Rationale: double-click is a "focus this
   * specific element" gesture; silently leaving other
   * elements selected in the background would confuse
   * the follow-up "what does Delete do now?" question.
   */
  _onDoubleClick(event) {
    const target = this._hitTest(event.clientX, event.clientY);
    if (!target) return;
    if (target.tagName?.toLowerCase() !== 'text') return;
    event.stopPropagation();
    event.preventDefault();
    if (this._selectedSet.size > 1) {
      // Collapse to just this element.
      this.setSelection(target);
    }
    this.beginTextEdit(target);
  },
};