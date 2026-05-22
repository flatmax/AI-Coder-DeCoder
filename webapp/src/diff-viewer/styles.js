// Component styles for DiffViewer. Lifted verbatim from
// the original diff-viewer.js so the visual contract is
// preserved byte-for-byte.

import { css } from 'lit';

export const DIFF_VIEWER_STYLES = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--bg-primary, #0d1117);
      position: relative;
    }

    .empty-state {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
    }
    .watermark {
      font-size: 8rem;
      opacity: 0.18;
      letter-spacing: -0.05em;
    }
    .watermark .bolt {
      color: var(--accent-primary, #58a6ff);
    }

    .editor-container {
      flex: 1;
      min-height: 0;
      width: 100%;
      position: relative;
    }

    /* Status LED — floating overlay in the top-right
     * corner. Click to save when dirty. */
    .status-led {
      position: absolute;
      top: 12px;
      right: 16px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      cursor: pointer;
      z-index: 10;
      transition: transform 120ms ease, box-shadow 120ms ease;
    }
    .status-led:hover {
      transform: scale(1.4);
    }
    .status-led.clean {
      background: #7ee787;
      box-shadow: 0 0 6px rgba(126, 231, 135, 0.6);
      cursor: default;
    }
    .status-led.new-file {
      background: var(--accent-primary, #58a6ff);
      box-shadow: 0 0 6px rgba(88, 166, 255, 0.6);
      cursor: default;
    }
    .status-led.dirty {
      background: #d29922;
      box-shadow: 0 0 8px rgba(210, 153, 34, 0.7);
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.55; }
    }

    /* Floating panel labels for loadPanel comparisons. */
    .panel-label {
      position: absolute;
      top: 12px;
      padding: 0.2rem 0.55rem;
      font-size: 0.75rem;
      font-family: 'SFMono-Regular', Consolas, monospace;
      background: rgba(22, 27, 34, 0.78);
      color: var(--text-secondary, #8b949e);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 3px;
      backdrop-filter: blur(4px);
      z-index: 5;
      pointer-events: none;
      transition: opacity 120ms ease;
    }
    .panel-label.left {
      right: calc(50% + 8px);
    }
    .panel-label.right {
      right: 120px;
    }

    /* Preview button — floats near the status LED in
     * normal mode, moves to the preview pane's top-right
     * in split mode so the user can exit preview from
     * the panel they're reading. */
    .preview-button {
      position: absolute;
      top: 8px;
      right: 46px;
      z-index: 10;
      padding: 0.25rem 0.6rem;
      font-size: 0.75rem;
      font-family: inherit;
      background: rgba(22, 27, 34, 0.88);
      color: var(--text-primary, #c9d1d9);
      border: 1px solid rgba(240, 246, 252, 0.2);
      border-radius: 4px;
      cursor: pointer;
      backdrop-filter: blur(4px);
    }
    .preview-button:hover {
      background: rgba(240, 246, 252, 0.12);
      border-color: rgba(240, 246, 252, 0.35);
    }
    .preview-button-split {
      right: 46px;
    }

    /* Split-button group: [✕ Preview][▾] fused into one
     * pill. Outer corners round; the chevron sits flush
     * against the main label with a divider line. */
    .preview-button-group {
      position: absolute;
      top: 8px;
      right: 46px;
      z-index: 10;
      display: inline-flex;
      align-items: stretch;
    }
    .preview-button-group-split {
      right: 46px;
    }
    .preview-button-group .preview-button {
      position: static;
      top: auto;
      right: auto;
    }
    .preview-button-group .preview-button-main {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
      border-right: 0;
    }
    .preview-button-group .preview-button-chevron {
      width: 24px;
      padding: 0.25rem 0;
      text-align: center;
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      border-left: 1px solid rgba(240, 246, 252, 0.2);
      font-size: 0.7rem;
    }

    /* Dropdown panel. Anchored under the trigger group.
     * Right-aligned with the group's right edge so the
     * chevron sits visually atop the menu's corner. */
    .export-menu {
      position: absolute;
      top: 38px;
      right: 46px;
      z-index: 12;
      min-width: 160px;
      background: rgba(22, 27, 34, 0.96);
      border: 1px solid rgba(240, 246, 252, 0.2);
      border-radius: 4px;
      backdrop-filter: blur(4px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
      padding: 0.25rem 0;
    }
    .export-menu-split {
      right: 46px;
    }
    .export-menu-item {
      background: transparent;
      border: 0;
      color: var(--text-primary, #c9d1d9);
      font: inherit;
      font-size: 0.8125rem;
      text-align: left;
      padding: 0.4rem 0.85rem;
      cursor: pointer;
      white-space: nowrap;
    }
    .export-menu-item:hover,
    .export-menu-item:focus {
      background: rgba(240, 246, 252, 0.12);
      outline: none;
    }

    /* Split layout for preview mode. Editor on the left,
     * preview on the right, equal width. */
    .split-root {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: row;
      width: 100%;
      position: relative;
    }
    .editor-pane {
      flex: 1 1 50%;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      border-right: 1px solid rgba(240, 246, 252, 0.1);
    }
    .editor-pane .editor-container {
      flex: 1;
      min-height: 0;
    }
    .preview-pane {
      flex: 1 1 50%;
      min-width: 0;
      min-height: 0;
      overflow-y: auto;
      padding: 1rem 1.5rem;
      color: var(--text-primary, #c9d1d9);
      font-size: 0.9375rem;
      line-height: 1.55;
    }
    .preview-pane h1,
    .preview-pane h2,
    .preview-pane h3,
    .preview-pane h4,
    .preview-pane h5,
    .preview-pane h6 {
      margin-top: 1.5rem;
      margin-bottom: 0.5rem;
      font-weight: 600;
    }
    .preview-pane p {
      margin: 0.75rem 0;
    }
    .preview-pane code {
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.875em;
      background: rgba(13, 17, 23, 0.6);
      border-radius: 3px;
      padding: 0.1rem 0.35rem;
    }
    .preview-pane pre {
      background: rgba(13, 17, 23, 0.9);
      border: 1px solid rgba(240, 246, 252, 0.1);
      border-radius: 6px;
      padding: 0.75rem;
      overflow-x: auto;
      margin: 0.75rem 0;
    }
    .preview-pane pre code {
      background: transparent;
      padding: 0;
    }
    .preview-pane blockquote {
      border-left: 3px solid rgba(240, 246, 252, 0.2);
      padding-left: 0.75rem;
      margin: 0.75rem 0;
      color: var(--text-secondary, #8b949e);
    }
    .preview-pane table {
      border-collapse: collapse;
      margin: 0.75rem 0;
    }
    .preview-pane th,
    .preview-pane td {
      border: 1px solid rgba(240, 246, 252, 0.15);
      padding: 0.35rem 0.6rem;
    }

    /* TeX preview states — placeholder, loading, error,
     * install-hint. The actual compiled output
     * (make4ht-generated HTML with section headings,
     * paragraphs, etc.) flows through the same
     * .preview-pane rules as markdown. */
    .preview-pane .tex-preview-placeholder,
    .preview-pane .tex-preview-loading {
      padding: 2rem;
      text-align: center;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
    }
    .preview-pane .tex-preview-loading {
      opacity: 0.7;
    }
    .preview-pane .tex-preview-error {
      padding: 1rem;
      background: rgba(248, 81, 73, 0.1);
      border: 1px solid rgba(248, 81, 73, 0.3);
      border-radius: 6px;
      color: #f85149;
      margin: 1rem 0;
    }
    .preview-pane .tex-preview-error strong {
      display: block;
      margin-bottom: 0.5rem;
    }
    .preview-pane .tex-preview-install-hint {
      padding: 1rem;
      background: rgba(88, 166, 255, 0.08);
      border: 1px solid rgba(88, 166, 255, 0.25);
      border-radius: 6px;
      margin: 1rem 0;
    }
    .preview-pane .tex-preview-install-hint strong {
      display: block;
      margin-bottom: 0.5rem;
      color: var(--accent-primary, #58a6ff);
    }
    .preview-pane .tex-preview-log {
      margin: 0.75rem 0;
      padding: 0.5rem 0.75rem;
      background: rgba(13, 17, 23, 0.6);
      border: 1px solid rgba(240, 246, 252, 0.1);
      border-radius: 4px;
      font-size: 0.8125rem;
    }
    .preview-pane .tex-preview-log summary {
      cursor: pointer;
      color: var(--text-secondary, #8b949e);
    }
    .preview-pane .tex-preview-log pre {
      margin: 0.5rem 0 0 0;
      font-size: 0.8125rem;
      max-height: 200px;
    }
    /* make4ht class-name hooks — section heading sizes
     * roughly match the markdown h1/h2/h3 treatment. */
    .preview-pane .sectionHead {
      font-size: 1.5rem;
      font-weight: 600;
      margin: 1.5rem 0 0.5rem;
    }
    .preview-pane .subsectionHead {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 1.25rem 0 0.5rem;
    }
    .preview-pane .subsubsectionHead {
      font-size: 1.125rem;
      font-weight: 600;
      margin: 1rem 0 0.4rem;
    }
    /* make4ht font-size classes — rough approximations
     * to Computer Modern variants. make4ht emits these
     * class names directly; mapping them here keeps the
     * rendered output visually coherent. */
    .preview-pane .cmr-17 { font-size: 1.5rem; }
    .preview-pane .cmr-12 { font-size: 1.125rem; }
    .preview-pane .cmbx-12,
    .preview-pane .cmbx-10 { font-weight: 600; }
    .preview-pane .cmti-10,
    .preview-pane .cmti-12 { font-style: italic; }
    .preview-pane .cmtt-10,
    .preview-pane .cmtt-12 {
      font-family: 'SFMono-Regular', Consolas, monospace;
    }

    /* Highlight decoration for scroll-to-edit anchor
     * matches. Applied via Monaco's deltaDecorations API
     * — the class here just defines the visual. */
    :host ::ng-deep .highlight-decoration,
    :host .highlight-decoration {
      background: rgba(79, 195, 247, 0.18);
      border-left: 2px solid var(--accent-primary, #58a6ff);
    }
  `;