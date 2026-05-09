// CSS styles for the files-tab orchestrator.
//
// Extracted from files-tab.js into its own module so
// the main class file stays focused on logic. Lit's
// `css` tagged template returns a CSSResult that's
// directly usable as a `static styles` value.

import { css } from 'lit';

export const FILES_TAB_STYLES = css`
    :host {
      display: flex;
      flex-direction: row;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }

    .picker-pane {
      flex-shrink: 0;
      /* min-width and max-width are enforced in the
       * splitter drag handler against the host's live
       * dimensions; the CSS floor + ceiling here are
       * belt-and-braces for non-drag paths (window
       * resize pushing the pane out of bounds). The
       * JS clamp is authoritative because it knows
       * the 50%-of-host rule at pointermove time. */
      min-width: 180px;
      max-width: 50%;
      border-right: 1px solid rgba(240, 246, 252, 0.1);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: width 120ms ease;
    }
    /* When a drag is in progress, suppress the transition
     * so width tracking stays 1:1 with the pointer. Lit
     * reactive state flips this class. */
    .picker-pane.dragging {
      transition: none;
    }
    .picker-pane.collapsed {
      min-width: 0;
    }

    .chat-pane {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Splitter — 4px vertical strip between picker and
     * chat panes. The visual divider is the .picker-pane
     * border-right; this strip is purely the hit zone.
     * Hover highlights a subtle accent so users can
     * discover the drag affordance. */
    .splitter {
      flex: 0 0 4px;
      cursor: col-resize;
      background: transparent;
      position: relative;
      transition: background 120ms ease;
    }
    .splitter:hover {
      background: rgba(88, 166, 255, 0.35);
    }
    .splitter.collapsed {
      /* In collapsed mode the splitter grows into an
       * affordance strip with a glyph hint at its
       * centre, making the "click to restore" target
       * bigger than a 4px line. */
      flex: 0 0 20px;
      cursor: pointer;
      background: rgba(240, 246, 252, 0.04);
    }
    .splitter.collapsed:hover {
      background: rgba(88, 166, 255, 0.15);
    }
    .splitter-affordance {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: rgba(240, 246, 252, 0.5);
      font-size: 0.75rem;
      user-select: none;
      pointer-events: none;
    }

    ac-file-picker {
      flex: 1;
      min-height: 0;
    }

    ac-chat-panel {
      flex: 1;
      min-height: 0;
    }

    /* Review selector modal — floating dialog anchored
     * inside the files-tab's own shadow. Positioned
     * fixed so it escapes any ancestor transform
     * contexts and renders cleanly above the rest of
     * the app. Backdrop dims the background to signal
     * modal focus without fully hiding the underlying
     * UI (the user may want to glance at the picker
     * while deciding which branch to review).
     *
     * This is the minimal first-increment UI — a flat
     * branch list. The full git-graph selector (SVG
     * lanes, disambiguation popover) will replace the
     * list body later without changing the modal
     * container or the start_review dispatch path. */
    .review-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 2500;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .review-modal {
      background: rgba(22, 27, 34, 0.98);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 8px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
      width: 80vw;
      max-width: 1100px;
      min-width: 520px;
      height: 80vh;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      color: var(--text-primary, #c9d1d9);
      font-size: 0.875rem;
      backdrop-filter: blur(8px);
    }
    /* Commit-graph wrapper fills the modal body. */
    ac-commit-graph {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .review-action-bar {
      flex-shrink: 0;
      padding: 0.6rem 1rem;
      border-top: 1px solid rgba(240, 246, 252, 0.1);
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .review-action-summary {
      flex: 1;
      font-size: 0.8125rem;
      color: var(--text-secondary, #8b949e);
    }
    .review-action-summary strong {
      color: var(--text-primary, #c9d1d9);
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .review-action-bar .review-start-btn {
      flex-shrink: 0;
    }
    .review-modal-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.1);
    }
    .review-modal-title {
      flex: 1;
      font-weight: 600;
    }
    .review-modal-close {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-primary, #c9d1d9);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      cursor: pointer;
      opacity: 0.7;
      font-size: 1rem;
      line-height: 1;
    }
    .review-modal-close:hover {
      opacity: 1;
      background: rgba(240, 246, 252, 0.08);
    }
    .review-modal-hint {
      padding: 0.5rem 1rem;
      font-size: 0.8125rem;
      color: var(--text-secondary, #8b949e);
      border-bottom: 1px solid rgba(240, 246, 252, 0.06);
    }
    .review-modal-body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0.35rem 0;
    }
    .review-modal-empty {
      padding: 1.5rem;
      text-align: center;
      font-style: italic;
      opacity: 0.6;
    }
    .review-branch-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.04);
    }
    .review-branch-row:hover {
      background: rgba(240, 246, 252, 0.04);
    }
    .review-branch-row:last-child {
      border-bottom: none;
    }
    .review-branch-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .review-branch-name {
      font-weight: 500;
      word-break: break-all;
    }
    .review-branch-name.current {
      color: var(--accent-primary, #58a6ff);
    }
    .review-branch-sha {
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .review-branch-badges {
      display: flex;
      gap: 0.25rem;
      flex-wrap: wrap;
    }
    .review-branch-badge {
      display: inline-block;
      font-size: 0.6875rem;
      padding: 0.05rem 0.35rem;
      border-radius: 3px;
      background: rgba(110, 118, 129, 0.2);
      color: var(--text-secondary, #8b949e);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .review-branch-badge.current {
      background: rgba(88, 166, 255, 0.2);
      color: var(--accent-primary, #58a6ff);
    }
    .review-branch-badge.remote {
      background: rgba(210, 153, 34, 0.15);
      color: #d29922;
    }
    .review-start-btn {
      background: rgba(88, 166, 255, 0.15);
      border: 1px solid rgba(88, 166, 255, 0.4);
      color: var(--accent-primary, #58a6ff);
      padding: 0.35rem 0.7rem;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.8125rem;
      font-weight: 500;
      flex-shrink: 0;
    }
    .review-start-btn:hover:not([disabled]) {
      background: rgba(88, 166, 255, 0.25);
      border-color: var(--accent-primary, #58a6ff);
    }
    .review-start-btn[disabled] {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .review-modal-loading {
      padding: 1.5rem;
      text-align: center;
      opacity: 0.7;
    }

    /* L0-exclude confirmation dialog. Smaller than the
     * review modal — prompt + two buttons + remember
     * checkbox. Same backdrop colour scheme so the
     * floating-modal language is consistent across the
     * app. Width is fixed (not viewport-relative)
     * because the body text is short and a wide dialog
     * for one paragraph reads as poorly designed. */
    .l0-dialog-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 2600;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .l0-dialog {
      background: rgba(22, 27, 34, 0.98);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 8px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
      width: 480px;
      max-width: 90vw;
      padding: 1.25rem;
      color: var(--text-primary, #c9d1d9);
      font-size: 0.875rem;
      backdrop-filter: blur(8px);
    }
    .l0-dialog-title {
      font-size: 1rem;
      font-weight: 600;
      margin: 0 0 0.75rem;
    }
    .l0-dialog-body {
      margin: 0 0 1rem;
      line-height: 1.5;
      color: var(--text-secondary, #8b949e);
    }
    .l0-dialog-body strong {
      color: var(--text-primary, #c9d1d9);
    }
    .l0-dialog-remember {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8125rem;
      color: var(--text-secondary, #8b949e);
      margin-bottom: 1rem;
      cursor: pointer;
      user-select: none;
    }
    .l0-dialog-remember input {
      margin: 0;
    }
    .l0-dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
    }
    .l0-dialog-btn {
      padding: 0.4rem 0.85rem;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.8125rem;
      font-weight: 500;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .l0-dialog-btn.primary {
      background: rgba(88, 166, 255, 0.15);
      border: 1px solid rgba(88, 166, 255, 0.4);
      color: var(--accent-primary, #58a6ff);
    }
    .l0-dialog-btn.primary:hover {
      background: rgba(88, 166, 255, 0.25);
      border-color: var(--accent-primary, #58a6ff);
    }
    .l0-dialog-btn.secondary {
      background: transparent;
      border: 1px solid rgba(240, 246, 252, 0.2);
      color: var(--text-primary, #c9d1d9);
    }
    .l0-dialog-btn.secondary:hover {
      background: rgba(240, 246, 252, 0.06);
      border-color: rgba(240, 246, 252, 0.35);
    }
    .l0-dialog-btn.cancel {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-secondary, #8b949e);
    }
    .l0-dialog-btn.cancel:hover {
      color: var(--text-primary, #c9d1d9);
    }
  `;