// AppShell — extracted CSS styles.
//
// Imported by webapp/src/app-shell.js as `static styles =
// APP_SHELL_STYLES`. Lives in its own module so the shell
// class file stays focused on logic.

import { css } from 'lit';

export const APP_SHELL_STYLES = css`
    :host {
      display: block;
      position: fixed;
      inset: 0;
      overflow: hidden;
      background: var(--bg-primary, #0d1117);
      color: var(--text-primary, #c9d1d9);
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    }

    /* Viewer background -- the diff viewer and SVG viewer
     * are absolutely-positioned siblings filling the
     * background layer. Only one is visible at a time
     * (class viewer-visible vs viewer-hidden). Opacity +
     * pointer-events transition gives a smooth cross-fade
     * without rebuilding the inactive viewer's DOM --
     * matters for the diff viewer's Monaco instances,
     * which are expensive to construct.
     *
     * Explicit z-index on the background keeps it below
     * the dialog. Without this, the viewers' internal
     * position:fixed (Monaco editor) can escape and
     * cover the dialog entirely — their position:fixed
     * anchors to the nearest ancestor with a transform
     * or will-change, or the viewport otherwise. */
    .viewer-background {
      position: absolute;
      inset: 0;
      overflow: hidden;
      z-index: 0;
    }
    ac-diff-viewer,
    ac-svg-viewer {
      position: absolute;
      inset: 0;
      transition: opacity 150ms ease;
    }
    .viewer-visible {
      opacity: 1;
      pointer-events: auto;
      z-index: 1;
    }
    .viewer-hidden {
      opacity: 0;
      pointer-events: none;
      z-index: 0;
    }

    /* Dialog — foreground panel. Explicit z-index keeps
     * it above the viewer background regardless of what
     * internal positioning the viewer components use.
     *
     * Two layout modes:
     *   Docked (default)   — top/left/bottom anchored to
     *                        viewport edges, width as a %
     *                        (overridable via inline style
     *                        for docked-width persistence).
     *   Undocked (.floating) — all four edges set by inline
     *                        style from _undockedPos; the
     *                        CSS "bottom: 0" is disabled by
     *                        "bottom: auto".
     *
     * Minimized collapses to the header only. We force a
     * fixed height rather than relying on content-hugging
     * because the body has "flex: 1" and would otherwise
     * pull the dialog to full height even with no children. */
    .dialog {
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      width: 50%;
      min-width: 400px;
      background: rgba(22, 27, 34, 0.95);
      border-right: 1px solid rgba(240, 246, 252, 0.1);
      display: flex;
      flex-direction: column;
      backdrop-filter: blur(8px);
      z-index: 10;
    }
    .dialog.floating {
      /* Undocked: disable the docked bottom anchor so the
       * inline height style takes effect. Shadow gives
       * visual separation from the viewer background. */
      bottom: auto;
      min-width: unset;
      border-right: 1px solid rgba(240, 246, 252, 0.1);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    }
    .dialog.minimized {
      height: auto !important;
      bottom: auto;
    }
    .dialog.minimized .dialog-body,
    .dialog.minimized .reconnect-banner,
    .dialog.minimized .compaction-bar,
    .dialog.minimized .convert-fab {
      display: none;
    }
    /* Convert FAB — floating button at bottom-left
     * of the dialog. Replaces the dialog-header
     * Convert icon. Hidden when the backend reports
     * markitdown unavailable (the parent template
     * gates rendering). */
    .convert-fab {
      position: absolute;
      bottom: 0.35rem;
      left: 0.5rem;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: rgba(22, 27, 34, 0.95);
      border: 1px solid rgba(240, 246, 252, 0.2);
      color: var(--text-primary, #c9d1d9);
      cursor: pointer;
      font-size: 0.8rem;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 12;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      transition: background 120ms ease,
        border-color 120ms ease,
        transform 120ms ease;
    }
    .convert-fab:hover {
      background: rgba(88, 166, 255, 0.15);
      border-color: var(--accent-primary, #58a6ff);
      transform: scale(1.05);
    }
    /* Expand FAB — only rendered when the dialog
     * is minimized. Lives at the top-right of the
     * collapsed dialog as the sole way to expand
     * again. When the dialog is expanded, the
     * minimize button in the tab strip takes over
     * — this FAB stays out of the way so it never
     * overlaps tab content like the Context tab's
     * refresh button. */
    .expand-fab {
      position: absolute;
      top: 0.4rem;
      right: 0.4rem;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(22, 27, 34, 0.95);
      border: 1px solid rgba(240, 246, 252, 0.2);
      color: var(--text-primary, #c9d1d9);
      cursor: pointer;
      font-size: 0.85rem;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 12;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      opacity: 0.85;
      transition: opacity 120ms ease, background 120ms ease;
    }
    .expand-fab:hover {
      opacity: 1;
      background: rgba(88, 166, 255, 0.15);
      border-color: var(--accent-primary, #58a6ff);
    }
    .dialog.dragging,
    .dialog.resizing {
      /* Disable text selection and remove the transition
       * during a drag so the pointer tracks 1:1. */
      user-select: none;
      transition: none;
    }


    /* Resize handles — invisible hit zones at the edges.
     * Right and bottom handles take a single axis; the
     * corner handle takes both. Hover shows a subtle
     * accent line so the handle is discoverable without
     * being distracting. */
    .resize-handle {
      position: absolute;
      z-index: 11;
      background: transparent;
      transition: background 120ms ease;
    }
    .resize-handle.right {
      top: 0;
      bottom: 0;
      right: -4px;
      width: 8px;
      cursor: ew-resize;
    }
    .resize-handle.bottom {
      left: 0;
      right: 0;
      bottom: -4px;
      height: 8px;
      cursor: ns-resize;
    }
    .resize-handle.corner {
      right: -4px;
      bottom: -4px;
      width: 14px;
      height: 14px;
      cursor: nwse-resize;
      z-index: 12;
    }
    .resize-handle:hover {
      background: rgba(88, 166, 255, 0.25);
    }
    .dialog.minimized .resize-handle.bottom,
    .dialog.minimized .resize-handle.corner {
      display: none;
    }
    .tab-button {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-primary, #c9d1d9);
      padding: 0.4rem 0.8rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.875rem;
    }
    .tab-button:hover {
      background: rgba(240, 246, 252, 0.05);
    }
    .tab-button.active {
      background: rgba(88, 166, 255, 0.12);
      border-color: rgba(88, 166, 255, 0.3);
      color: var(--accent-primary, #58a6ff);
    }
    .dialog-body {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .dialog-body > ac-files-tab {
      flex: 1;
      min-height: 0;
    }

    /* Compaction-capacity bar — a thin strip at the bottom
     * of the dialog showing the ratio of current history
     * tokens to the compaction trigger threshold. Colour
     * mirrors the budget-bar convention used by the Context
     * tab and Token HUD: green below 75%, amber 75-90%, red
     * above 90%.
     *
     * Positioned inside .dialog as the last child before the
     * resize handles. The bottom resize-handle sits at
     * bottom: -4px with height: 8px, so its 8px hit zone
     * overlays the bar's upper half without preventing pointer
     * events on the bar itself (which takes no pointer
     * events — it's informational only).
     *
     * Inner .compaction-bar-fill drives the width. Transition
     * makes the shrink on a successful compaction visible —
     * going from 100% to 5% is the moment this bar earns its
     * screen space. Without the transition the change would
     * be a jarring jump.
     *
     * Hidden in minimized state via the .minimized rule below
     * so a collapsed dialog doesn't dedicate height to it.
     */
    .compaction-bar {
      flex-shrink: 0;
      position: relative;
      height: 4px;
      background: rgba(240, 246, 252, 0.06);
      border-top: 1px solid rgba(240, 246, 252, 0.05);
      pointer-events: none;
      overflow: hidden;
    }
    .compaction-bar-fill {
      height: 100%;
      transition: width 300ms ease, background 300ms ease;
    }
    /* Tab panels — all mounted into the DOM, but only the
     * active one is visible. Matches specs3
     * app_shell_and_dialog.md "Lazy Loading and DOM
     * Preservation": "tab panels remain in DOM (hidden
     * via CSS, not destroyed). Switching tabs toggles
     * the .active class."
     *
     * Using display: none on inactive panels (rather than
     * visibility: hidden) takes them out of the flex
     * layout entirely so the active panel can claim the
     * full dialog body height via flex: 1. The inactive
     * panel's internal state — including the chat
     * panel's textarea value, scroll position, and
     * streaming state — is preserved because Lit never
     * unmounts the element. */
    .tab-panel {
      flex: 1;
      min-height: 0;
      display: none;
      flex-direction: column;
    }
    .tab-panel.active {
      display: flex;
    }
    .tab-placeholder {
      opacity: 0.5;
      font-style: italic;
      padding: 2rem;
      text-align: center;
    }

    /* Startup overlay. */
    .startup-overlay {
      position: absolute;
      inset: 0;
      background: var(--bg-primary, #0d1117);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      transition: opacity 400ms ease-out;
    }
    .startup-overlay.fading {
      opacity: 0;
      pointer-events: none;
    }
    .startup-brand {
      font-size: 5rem;
      margin-bottom: 2rem;
      letter-spacing: -0.05em;
    }
    .startup-brand .bolt {
      color: var(--accent-primary, #58a6ff);
    }
    .startup-message {
      font-size: 1rem;
      margin-bottom: 1rem;
      opacity: 0.75;
    }
    .startup-progress {
      width: 300px;
      height: 4px;
      background: rgba(240, 246, 252, 0.1);
      border-radius: 2px;
      overflow: hidden;
    }
    .startup-progress-bar {
      height: 100%;
      background: var(--accent-primary, #58a6ff);
      transition: width 300ms ease;
    }

    /* Reconnect banner — sits below dialog header when
     * connection is lost. */
    .reconnect-banner {
      background: rgba(248, 81, 73, 0.15);
      color: #f85149;
      padding: 0.5rem 1rem;
      font-size: 0.85rem;
      text-align: center;
      border-bottom: 1px solid rgba(248, 81, 73, 0.3);
    }

    /* Toast layer. */
    .toast-layer {
      position: fixed;
      bottom: 1rem;
      left: 1rem;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .toast {
      background: rgba(22, 27, 34, 0.95);
      border: 1px solid rgba(240, 246, 252, 0.2);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      font-size: 0.875rem;
      min-width: 200px;
      max-width: 400px;
      backdrop-filter: blur(8px);
      animation: toast-in 200ms ease-out;
    }
    .toast.info { border-left: 3px solid var(--accent-primary, #58a6ff); }
    .toast.success { border-left: 3px solid #7ee787; }
    .toast.error { border-left: 3px solid #f85149; }
    .toast.warning { border-left: 3px solid #d29922; }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-20px); }
      to { opacity: 1; transform: translateX(0); }
    }
  `;