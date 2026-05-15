// Static CSS styles for the FilePicker component.
//
// Extracted from file-picker.js so the class definition module
// stays focused on behaviour rather than presentation. The export
// is a Lit `css` template literal usable directly in `static
// styles = ...`.

import { css } from 'lit';

export const FILE_PICKER_STYLES = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: rgba(13, 17, 23, 0.5);
      color: var(--text-primary, #c9d1d9);
      font-size: 0.875rem;
    }

    .filter-bar {
      flex-shrink: 0;
      padding: 0.5rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.1);
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .filter-input {
      width: 100%;
      box-sizing: border-box;
      padding: 0.35rem 0.5rem;
      background: rgba(13, 17, 23, 0.8);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 4px;
      color: var(--text-primary, #c9d1d9);
      font-size: 0.8125rem;
    }
    .filter-input:focus {
      outline: none;
      border-color: var(--accent-primary, #58a6ff);
    }

    .sort-buttons {
      display: flex;
      gap: 0.25rem;
      align-items: center;
    }
    .sort-buttons .label {
      font-size: 0.6875rem;
      opacity: 0.55;
      margin-right: 0.15rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .sort-btn {
      flex: 0 0 auto;
      padding: 0.2rem 0.45rem;
      background: rgba(13, 17, 23, 0.6);
      border: 1px solid rgba(240, 246, 252, 0.12);
      border-radius: 3px;
      color: var(--text-secondary, #8b949e);
      font-size: 0.75rem;
      font-family: inherit;
      cursor: pointer;
      user-select: none;
      line-height: 1;
    }
    .sort-btn:hover {
      background: rgba(240, 246, 252, 0.05);
      color: var(--text-primary, #c9d1d9);
    }
    .sort-btn.active {
      background: rgba(88, 166, 255, 0.12);
      border-color: var(--accent-primary, #58a6ff);
      color: var(--accent-primary, #58a6ff);
      font-weight: 600;
      box-shadow:
        0 0 0 1px rgba(88, 166, 255, 0.55),
        0 0 8px rgba(88, 166, 255, 0.45);
    }
    .sort-btn .dir {
      margin-left: 0.15rem;
      opacity: 0.8;
    }

    .sort-split {
      position: relative;
      display: inline-flex;
      align-items: stretch;
      gap: 0;
      border: 1px solid rgba(240, 246, 252, 0.12);
      border-radius: 3px;
      overflow: visible;
    }
    .sort-split .sort-btn {
      border-radius: 0;
      border: none;
    }
    .sort-split .sort-btn.primary {
      background: rgba(88, 166, 255, 0.12);
      color: var(--accent-primary, #58a6ff);
      font-weight: 600;
      padding: 0.2rem 0.5rem;
      box-shadow:
        0 0 0 1px rgba(88, 166, 255, 0.55),
        0 0 8px rgba(88, 166, 255, 0.45);
    }
    .sort-split .sort-btn.primary:hover {
      background: rgba(88, 166, 255, 0.2);
    }
    .sort-split .sort-btn.chevron {
      padding: 0.2rem 0.3rem;
      font-size: 0.7rem;
      color: var(--text-secondary, #8b949e);
      border-left: 1px solid rgba(240, 246, 252, 0.12);
      box-shadow: none;
    }
    .sort-split .sort-btn.chevron:hover {
      color: var(--text-primary, #c9d1d9);
      background: rgba(240, 246, 252, 0.05);
    }
    .sort-split .sort-btn.chevron[aria-expanded="true"] {
      color: var(--accent-primary, #58a6ff);
      background: rgba(88, 166, 255, 0.12);
    }

    .sort-menu {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      z-index: 1000;
      min-width: 160px;
      padding: 0.25rem 0;
      background: rgba(22, 27, 34, 0.96);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      font-size: 0.8125rem;
      user-select: none;
      display: flex;
      flex-direction: column;
    }
    .sort-menu-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.75rem;
      cursor: pointer;
      color: var(--text-primary, #c9d1d9);
      background: transparent;
      border: none;
      width: 100%;
      font-family: inherit;
      font-size: inherit;
      text-align: left;
    }
    .sort-menu-item:hover {
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent-primary, #58a6ff);
    }
    .sort-menu-item.active {
      color: var(--accent-primary, #58a6ff);
      font-weight: 600;
    }
    .sort-menu-item .icon {
      display: inline-flex;
      width: 1rem;
      justify-content: center;
      opacity: 0.85;
    }
    .sort-menu-item .label {
      flex: 1;
    }
    .sort-menu-item .dir {
      opacity: 0.8;
    }

    .picker-settings-btn {
      flex-shrink: 0;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-primary, #c9d1d9);
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.9rem;
      line-height: 1;
      opacity: 0.7;
      margin-left: 0.4rem;
      transition: opacity 120ms ease, background 120ms ease;
    }
    .picker-settings-btn:hover {
      opacity: 1;
      background: rgba(240, 246, 252, 0.08);
    }

    .picker-git-actions {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      margin-left: 0.25rem;
    }
    .picker-git-actions.split {
      position: relative;
      gap: 0;
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 3px;
      overflow: visible;
    }
    .picker-git-actions.split .picker-git-btn {
      border-radius: 0;
      border: none;
      opacity: 1;
    }
    .picker-git-actions.split .picker-git-btn.primary {
      padding: 0.2rem 0.5rem;
    }
    .picker-git-actions.split .picker-git-btn.chevron {
      padding: 0.2rem 0.3rem;
      font-size: 0.7rem;
      opacity: 0.7;
      border-left: 1px solid rgba(240, 246, 252, 0.12);
    }
    .picker-git-actions.split .picker-git-btn.chevron:hover:not([disabled]) {
      opacity: 1;
    }
    .picker-git-actions.split .picker-git-btn.chevron[aria-expanded="true"] {
      opacity: 1;
      background: rgba(88, 166, 255, 0.12);
      color: var(--accent-primary, #58a6ff);
    }
    .picker-git-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-primary, #c9d1d9);
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.9rem;
      line-height: 1;
      opacity: 0.7;
      transition: opacity 120ms ease, background 120ms ease;
    }
    .picker-git-btn:hover:not([disabled]) {
      opacity: 1;
      background: rgba(240, 246, 252, 0.08);
    }
    .picker-git-btn.danger:hover:not([disabled]) {
      background: rgba(248, 81, 73, 0.15);
      border-color: rgba(248, 81, 73, 0.3);
    }
    .picker-git-btn.in-flight {
      opacity: 1;
      background: rgba(88, 166, 255, 0.12);
      border-color: rgba(88, 166, 255, 0.3);
    }
    .picker-git-btn[disabled] {
      opacity: 0.3;
      cursor: not-allowed;
    }

    .git-menu {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      z-index: 1000;
      min-width: 200px;
      padding: 0.25rem 0;
      background: rgba(22, 27, 34, 0.96);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      font-size: 0.8125rem;
      user-select: none;
      display: flex;
      flex-direction: column;
    }
    .git-menu-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.75rem;
      cursor: pointer;
      color: var(--text-primary, #c9d1d9);
      background: transparent;
      border: none;
      width: 100%;
      font-family: inherit;
      font-size: inherit;
      text-align: left;
    }
    .git-menu-item:hover:not([disabled]) {
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent-primary, #58a6ff);
    }
    .git-menu-item[disabled] {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .git-menu-item.destructive {
      color: #f85149;
    }
    .git-menu-item.destructive:hover:not([disabled]) {
      background: rgba(248, 81, 73, 0.15);
      color: #ff6b6b;
    }
    .git-menu-item .icon {
      display: inline-flex;
      width: 1rem;
      justify-content: center;
      opacity: 0.85;
      font-size: 0.85rem;
    }
    .git-menu-item .label {
      flex: 1;
    }
    .git-menu-separator {
      height: 1px;
      margin: 0.25rem 0.4rem;
      background: rgba(240, 246, 252, 0.1);
    }

    .tree-scroll {
      flex: 1;
      overflow-y: auto;
      overflow-x: auto;
      padding: 0.25rem 0;
      outline: none;
    }
    .tree-scroll:focus-visible {
      box-shadow: inset 0 0 0 2px var(--accent-primary, #58a6ff);
    }

    .review-banner {
      flex-shrink: 0;
      padding: 0.5rem 0.6rem;
      background: rgba(210, 153, 34, 0.12);
      border-bottom: 1px solid rgba(210, 153, 34, 0.3);
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      font-size: 0.8125rem;
    }
    .review-banner-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .review-banner-icon {
      font-size: 1rem;
    }
    .review-banner-title {
      font-weight: 600;
      color: #d29922;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .review-banner-exit {
      background: rgba(210, 153, 34, 0.2);
      border: 1px solid rgba(210, 153, 34, 0.4);
      color: #d29922;
      padding: 0.2rem 0.5rem;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.75rem;
      font-family: inherit;
      font-weight: 500;
      flex-shrink: 0;
    }
    .review-banner-exit:hover {
      background: rgba(210, 153, 34, 0.3);
      border-color: rgba(210, 153, 34, 0.6);
    }
    .review-banner-view-graph {
      background: transparent;
      border: 1px solid rgba(210, 153, 34, 0.3);
      color: #d29922;
      padding: 0.2rem 0.5rem;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.75rem;
      font-family: inherit;
      font-weight: 500;
      flex-shrink: 0;
    }
    .review-banner-view-graph:hover {
      background: rgba(210, 153, 34, 0.15);
      border-color: rgba(210, 153, 34, 0.5);
    }
    .review-banner-stats {
      display: flex;
      gap: 0.75rem;
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
      font-variant-numeric: tabular-nums;
    }
    .review-banner-stats .stat-added {
      color: #3fb950;
    }
    .review-banner-stats .stat-removed {
      color: #f85149;
    }

    .empty-state {
      padding: 1rem;
      opacity: 0.5;
      font-style: italic;
      text-align: center;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.15rem 0.5rem 0.15rem calc(var(--row-indent, 0px) + 0.9rem);
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
      position: relative;
    }
    .row:hover {
      background: rgba(240, 246, 252, 0.05);
    }
    .row.focused {
      background: rgba(88, 166, 255, 0.12);
    }

    .indent {
      display: inline-block;
      flex-shrink: 0;
    }

    .twisty {
      display: inline-flex;
      width: 0.9rem;
      justify-content: center;
      flex-shrink: 0;
      opacity: 0.7;
      font-size: 0.75rem;
    }
    .twisty.empty {
      visibility: hidden;
    }

    .checkbox {
      flex-shrink: 0;
      margin: 0;
    }

    .name {
      flex: 1;
      min-width: 0;
      text-overflow: ellipsis;
      overflow: hidden;
    }
    .row.is-dir .name {
      color: var(--text-primary, #c9d1d9);
      font-weight: 500;
    }
    .row.is-file .name {
      color: var(--text-secondary, #8b949e);
    }

    .lines-badge {
      flex-shrink: 0;
      font-size: 0.75rem;
      opacity: 0.6;
      margin-left: 0.5rem;
      font-variant-numeric: tabular-nums;
    }

    .status-badge {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1rem;
      height: 1rem;
      font-size: 0.7rem;
      font-weight: 600;
      border-radius: 2px;
      margin-left: 0.25rem;
      font-variant-numeric: tabular-nums;
      user-select: none;
    }
    .status-badge.status-modified {
      color: #d29922;
      background: rgba(210, 153, 34, 0.15);
    }
    .status-badge.status-staged {
      color: #3fb950;
      background: rgba(63, 185, 80, 0.15);
    }
    .status-badge.status-untracked {
      color: #58a6ff;
      background: rgba(88, 166, 255, 0.15);
    }
    .status-badge.status-deleted {
      color: #f85149;
      background: rgba(248, 81, 73, 0.15);
      text-decoration: line-through;
    }

    .diff-stats {
      flex-shrink: 0;
      font-size: 0.7rem;
      font-variant-numeric: tabular-nums;
      margin-left: 0.35rem;
      display: inline-flex;
      gap: 0.25rem;
    }
    .diff-stats.diff-stats-pre {
      position: absolute;
      right: auto;
      left: calc(var(--row-indent, 0px) + 0.1rem);
      width: 1.8rem;
      justify-content: flex-end;
      margin: 0;
      pointer-events: none;
      font-size: 0.65rem;
    }
    .diff-stats .added {
      color: #3fb950;
    }
    .diff-stats .removed {
      color: #f85149;
    }

    .row.is-file.is-excluded .name {
      text-decoration: line-through;
      opacity: 0.45;
    }
    .row.is-file.is-excluded .checkbox {
      opacity: 0.5;
    }
    .row.is-file.is-binary .name {
      opacity: 0.4;
      font-style: italic;
    }
    .row.is-file.is-binary .checkbox {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .row.is-dir.all-excluded .name,
    .row.is-root.all-excluded .name {
      text-decoration: line-through;
      opacity: 0.45;
    }
    .row.is-dir.all-excluded .checkbox,
    .row.is-root.all-excluded .checkbox {
      opacity: 0.5;
    }
    .row.is-dir.some-excluded .excluded-badge,
    .row.is-root.some-excluded .excluded-badge {
      opacity: 0.5;
    }
    .excluded-badge {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1rem;
      height: 1rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: #f85149;
      opacity: 0.8;
      margin-left: 0.25rem;
      user-select: none;
    }

    .row.is-file.active-in-viewer {
      background: rgba(88, 166, 255, 0.08);
      box-shadow: inset 3px 0 0 var(--accent-primary, #58a6ff);
    }
    .row.is-file.active-in-viewer .name {
      color: var(--accent-primary, #58a6ff);
    }

    @keyframes picker-reveal-flash {
      0% {
        background: rgba(88, 166, 255, 0.45);
        box-shadow: inset 0 0 0 2px var(--accent-primary, #58a6ff);
      }
      100% {
        background: transparent;
        box-shadow: inset 0 0 0 2px transparent;
      }
    }
    .row.reveal-flash {
      animation: picker-reveal-flash 1.2s ease-out;
    }

    .row.is-inline {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.1rem 0.5rem 0.1rem var(--row-indent, 0px);
      background: rgba(88, 166, 255, 0.06);
    }
    .row.is-inline .inline-input {
      flex: 1;
      min-width: 0;
      padding: 0.2rem 0.35rem;
      background: rgba(13, 17, 23, 0.9);
      border: 1px solid var(--accent-primary, #58a6ff);
      border-radius: 3px;
      color: var(--text-primary, #c9d1d9);
      font-family: inherit;
      font-size: 0.8125rem;
    }
    .row.is-inline .inline-input:focus {
      outline: none;
      border-color: var(--accent-primary, #58a6ff);
      box-shadow: 0 0 0 1px var(--accent-primary, #58a6ff);
    }

    .row.is-root {
      cursor: default;
      font-weight: 600;
      padding: 0.25rem 0.5rem 0.25rem 0.25rem;
    }
    .row.is-root:hover {
      background: transparent;
    }
    .row.is-root .name {
      font-weight: 600;
      color: var(--text-primary, #c9d1d9);
    }

    .branch-pill {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      font-size: 0.75rem;
      font-weight: 500;
      padding: 0.05rem 0.4rem;
      border-radius: 3px;
      margin-left: 0.5rem;
      background: rgba(110, 118, 129, 0.2);
      color: var(--text-secondary, #8b949e);
      font-variant-numeric: tabular-nums;
    }
    .branch-pill.detached {
      background: rgba(210, 153, 34, 0.2);
      color: #d29922;
    }
    .branch-pill.clickable {
      border: 1px solid rgba(110, 118, 129, 0.35);
      cursor: pointer;
      font-family: inherit;
      font-size: 0.75rem;
      font-weight: 500;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .branch-pill.clickable:hover:not([disabled]) {
      background: rgba(88, 166, 255, 0.18);
      border-color: rgba(88, 166, 255, 0.5);
      color: var(--accent-primary, #58a6ff);
    }
    .branch-pill.clickable[disabled] {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .branch-pill .glyph {
      opacity: 0.7;
    }

    .branch-menu {
      position: fixed;
      z-index: 1000;
      width: 280px;
      max-height: 320px;
      display: flex;
      flex-direction: column;
      background: rgba(22, 27, 34, 0.96);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      font-size: 0.8125rem;
      user-select: none;
      overflow: hidden;
    }
    .branch-menu-header {
      flex-shrink: 0;
      padding: 0.4rem 0.75rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.1);
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-secondary, #8b949e);
    }
    .branch-menu-body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }
    .branch-menu-loading {
      padding: 1rem;
      text-align: center;
      opacity: 0.6;
      font-style: italic;
    }
    .branch-menu-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.75rem;
      cursor: pointer;
      color: var(--text-primary, #c9d1d9);
      border: none;
      background: transparent;
      width: 100%;
      font-family: inherit;
      font-size: inherit;
      text-align: left;
    }
    .branch-menu-item:hover:not([disabled]) {
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent-primary, #58a6ff);
    }
    .branch-menu-item[disabled] {
      opacity: 0.5;
      cursor: default;
    }
    .branch-menu-item .branch-glyph {
      flex-shrink: 0;
      width: 1rem;
      text-align: center;
      opacity: 0.7;
    }
    .branch-menu-item .branch-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .branch-menu-item .branch-flag {
      flex-shrink: 0;
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 0.05rem 0.3rem;
      border-radius: 2px;
      background: rgba(110, 118, 129, 0.2);
      color: var(--text-secondary, #8b949e);
    }
    .branch-menu-item .branch-flag.current {
      background: rgba(88, 166, 255, 0.2);
      color: var(--accent-primary, #58a6ff);
    }
    .branch-menu-item .branch-flag.remote {
      background: rgba(210, 153, 34, 0.15);
      color: #d29922;
    }

    .context-menu {
      position: fixed;
      z-index: 1000;
      min-width: 200px;
      padding: 0.25rem 0;
      background: rgba(22, 27, 34, 0.96);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      font-size: 0.8125rem;
      user-select: none;
    }
    .context-menu .menu-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.75rem;
      cursor: pointer;
      color: var(--text-primary, #c9d1d9);
    }
    .context-menu .menu-item:hover {
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent-primary, #58a6ff);
    }
    .context-menu .menu-item.destructive {
      color: #f85149;
    }
    .context-menu .menu-item.destructive:hover {
      background: rgba(248, 81, 73, 0.15);
      color: #ff6b6b;
    }
    .context-menu .menu-item .icon {
      display: inline-flex;
      width: 1rem;
      justify-content: center;
      opacity: 0.85;
      font-size: 0.85rem;
    }
    .context-menu .menu-item .label {
      flex: 1;
    }
    .context-menu .menu-separator {
      height: 1px;
      margin: 0.25rem 0.4rem;
      background: rgba(240, 246, 252, 0.1);
    }
  `;