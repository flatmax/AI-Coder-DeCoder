import { css } from 'lit';

export const promptViewStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .dialog {
    position: relative;
    width: 400px;
    height: 100%;
    background: #16213e;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .dialog.dragged {
    position: fixed;
    height: calc(100vh - 80px);
    max-height: calc(100vh - 80px);
  }

  .dialog.minimized {
    width: 200px;
    max-height: 48px;
  }

  .dialog.with-picker {
    width: 700px;
  }

  .header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    background: #0f3460;
    color: #e94560;
    font-weight: 600;
    cursor: grab;
    user-select: none;
  }

  .header:active {
    cursor: grabbing;
  }

  .header-section {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .header-left {
    flex: 1;
    justify-content: flex-start;
    cursor: pointer;
  }

  .header-tabs {
    flex: 1;
    justify-content: center;
  }

  .header-git {
    flex: 1;
    justify-content: center;
  }

  .header-right {
    flex: 1;
    justify-content: flex-end;
  }

  .header-tab {
    width: 32px;
    height: 32px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    color: #888;
    transition: all 0.15s;
  }

  .header-tab:hover {
    background: rgba(233, 69, 96, 0.1);
    color: #ccc;
  }

  .header-tab.active {
    background: rgba(233, 69, 96, 0.2);
    border-color: #e94560;
    color: #e94560;
  }



  .header-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: #888;
    cursor: pointer;
    font-size: 14px;
    padding: 4px 6px;
    transition: all 0.15s;
  }

  .header-btn:hover {
    background: rgba(233, 69, 96, 0.1);
    color: #ccc;
  }

  .header-btn.commit-btn {
    color: #7ec699;
  }

  .header-btn.commit-btn:hover {
    background: rgba(126, 198, 153, 0.2);
    color: #7ec699;
  }

  .header-btn.reset-btn {
    color: #f0a500;
  }

  .header-btn.reset-btn:hover {
    background: rgba(240, 165, 0, 0.2);
    color: #f0a500;
  }

  .main-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .picker-panel {
    min-width: 150px;
    max-width: 500px;
    border-right: 1px solid #0f3460;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
  }

  file-picker {
    flex: 1;
    min-height: 0;
  }

  .embedded-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .embedded-panel find-in-files,
  .embedded-panel context-viewer {
    flex: 1;
    min-height: 0;
  }

  .chat-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .messages-wrapper {
    flex: 1;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .scroll-to-bottom-btn {
    position: absolute;
    bottom: 12px;
    right: 20px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #e94560;
    color: white;
    border: none;
    cursor: pointer;
    font-size: 18px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s, transform 0.2s;
  }

  .scroll-to-bottom-btn:hover {
    background: #ff6b6b;
    transform: scale(1.1);
  }

  .image-preview-area {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid #0f3460;
    background: #1a1a2e;
    align-items: center;
  }

  .image-preview {
    position: relative;
    width: 60px;
    height: 60px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #0f3460;
  }

  .image-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .image-preview .remove-image {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #e94560;
    color: white;
    border: none;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .image-preview .remove-image:hover {
    background: #ff6b6b;
  }

  .clear-images {
    background: #0f3460;
    color: #eee;
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 11px;
  }

  .clear-images:hover {
    background: #1a3a6e;
  }

  .input-area {
    display: flex;
    padding: 12px;
    gap: 8px;
    border-top: 1px solid #0f3460;
  }

  textarea {
    flex: 1;
    resize: none;
    border: none;
    border-radius: 8px;
    padding: 10px;
    background: #1a1a2e;
    color: #eee;
    font-family: inherit;
    font-size: 14px;
    min-height: 40px;
    max-height: var(--textarea-max-height, 200px);
    overflow-y: auto;
  }

  textarea:focus {
    outline: 2px solid #e94560;
  }

  .send-btn {
    background: #e94560;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 10px 16px;
    cursor: pointer;
    font-weight: 600;
  }

  .send-btn:hover {
    background: #ff6b6b;
  }

  .send-btn.stop-btn {
    background: #f0a500;
  }

  .send-btn.stop-btn:hover {
    background: #ffb732;
  }

  textarea:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .file-btn {
    background: #1a1a2e;
    color: #eee;
    border: 1px solid #0f3460;
    border-radius: 8px;
    padding: 10px 12px;
    cursor: pointer;
    font-size: 14px;
  }

  .file-btn:hover {
    background: #0f3460;
  }

  .file-btn.active {
    background: #0f3460;
    border-color: #e94560;
  }

  .input-buttons-stack {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .input-buttons-stack .file-btn {
    padding: 6px 10px;
    font-size: 12px;
  }

  /* Snippet drawer - collapsible horizontal expand */
  .snippet-drawer {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .snippet-drawer-toggle {
    background: #1a1a2e;
    border: 1px solid #0f3460;
    border-radius: 6px;
    padding: 6px 8px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    transition: all 0.15s;
    z-index: 1;
  }

  .snippet-drawer-toggle:hover {
    background: #0f3460;
    border-color: #e94560;
  }

  .snippet-drawer-toggle.open {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right: none;
  }

  .snippet-drawer-content {
    display: flex;
    align-items: center;
    gap: 2px;
    max-width: 0;
    overflow: hidden;
    transition: max-width 0.2s ease-out, padding 0.2s ease-out;
    background: #1a1a2e;
    border: 1px solid #0f3460;
    border-left: none;
    border-radius: 0 6px 6px 0;
    padding: 0;
  }

  .snippet-drawer.open .snippet-drawer-content {
    max-width: 300px;
    padding: 4px 6px;
  }

  .snippet-btn {
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 4px 6px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .snippet-btn:hover {
    background: rgba(233, 69, 96, 0.2);
    transform: scale(1.1);
  }

  /* Panel resizer */
  .panel-resizer {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 12px;
    background: #0f3460;
    position: relative;
    flex-shrink: 0;
  }

  .panel-resizer-handle {
    flex: 1;
    width: 100%;
    cursor: col-resize;
    transition: background 0.15s;
  }

  .panel-resizer-handle:hover {
    background: rgba(233, 69, 96, 0.3);
  }

  .panel-collapse-btn {
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 8px 2px;
    font-size: 10px;
    transition: color 0.15s;
  }

  .panel-collapse-btn:hover {
    color: #e94560;
  }

  /* URL chips */
  .url-chips-area {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px;
    border-top: 1px solid #0f3460;
    background: #1a1a2e;
  }

  .url-chips-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .url-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 16px;
    font-size: 12px;
    max-width: 100%;
  }

  .url-chip.detected {
    background: #0f3460;
    border: 1px solid #4a9eff;
    color: #4a9eff;
  }

  .url-chip.fetching {
    background: #0f3460;
    border: 1px solid #f0a500;
    color: #f0a500;
  }

  .url-chip.fetched.success {
    background: #1a3d2e;
    border: 1px solid #7ec699;
    color: #7ec699;
  }

  .url-chip.fetched.excluded {
    background: #2a2a3e;
    border: 1px solid #666;
    color: #888;
  }

  .url-chip.fetched.error {
    background: #3d1a1a;
    border: 1px solid #e94560;
    color: #e94560;
  }

  .url-chip-checkbox {
    margin: 0;
    cursor: pointer;
    accent-color: #7ec699;
  }

  .url-chip-type {
    font-size: 11px;
    opacity: 0.9;
  }

  .url-chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }

  .url-chip-icon {
    font-size: 14px;
  }

  .url-chip-loading {
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .url-chip-fetch,
  .url-chip-dismiss,
  .url-chip-remove {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 2px;
    font-size: 14px;
    line-height: 1;
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .url-chip-fetch:hover,
  .url-chip-dismiss:hover,
  .url-chip-remove:hover {
    opacity: 1;
  }

  .url-chip-fetch {
    color: #4a9eff;
  }

  .url-chip-dismiss,
  .url-chip-remove {
    color: inherit;
  }

  /* Resize handles */
  .resize-handle {
    position: absolute;
    background: transparent;
    z-index: 100;
  }

  .resize-handle-n {
    top: 0;
    left: 10px;
    right: 10px;
    height: 6px;
    cursor: n-resize;
  }

  .resize-handle-s {
    bottom: 0;
    left: 10px;
    right: 10px;
    height: 6px;
    cursor: s-resize;
  }

  .resize-handle-e {
    right: 0;
    top: 10px;
    bottom: 10px;
    width: 6px;
    cursor: e-resize;
  }

  .resize-handle-w {
    left: 0;
    top: 10px;
    bottom: 10px;
    width: 6px;
    cursor: w-resize;
  }

  .resize-handle-ne {
    top: 0;
    right: 0;
    width: 12px;
    height: 12px;
    cursor: ne-resize;
  }

  .resize-handle-nw {
    top: 0;
    left: 0;
    width: 12px;
    height: 12px;
    cursor: nw-resize;
  }

  .resize-handle-se {
    bottom: 0;
    right: 0;
    width: 12px;
    height: 12px;
    cursor: se-resize;
  }

  .resize-handle-sw {
    bottom: 0;
    left: 0;
    width: 12px;
    height: 12px;
    cursor: sw-resize;
  }

  .resize-handle:hover {
    background: rgba(233, 69, 96, 0.3);
  }

  /* History token bar */
  .history-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: rgba(15, 52, 96, 0.5);
    border-radius: 0 0 12px 12px;
    overflow: hidden;
  }

  .history-bar-fill {
    height: 100%;
    background: #7ec699;
    transition: width 0.3s ease, background 0.3s ease;
  }

  .history-bar.warning .history-bar-fill {
    background: #f0a500;
  }

  .history-bar.critical .history-bar-fill {
    background: #e94560;
  }

  /* Token HUD overlay */
  .token-hud {
    position: fixed;
    top: 16px;
    right: 16px;
    background: rgba(22, 33, 62, 0.85);
    border: 1px solid rgba(233, 69, 96, 0.4);
    border-radius: 8px;
    padding: 12px 16px;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 12px;
    color: #aaa;
    pointer-events: none;
    z-index: 10000;
    backdrop-filter: blur(4px);
    opacity: 0;
    transform: translateY(-10px);
    transition: opacity 0.3s ease, transform 0.3s ease;
  }

  .token-hud.visible {
    opacity: 1;
    transform: translateY(0);
    animation: hud-fade-out 8s ease-in-out forwards;
    pointer-events: auto;
  }

  .token-hud.visible:hover {
    animation-play-state: paused;
  }

  @keyframes hud-fade-out {
    0% { opacity: 1; transform: translateY(0); }
    50% { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(-5px); }
  }

  .hud-title {
    color: #e94560;
    font-weight: 600;
    margin-bottom: 8px;
    font-size: 13px;
  }

  .hud-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 2px 0;
  }

  .hud-label {
    color: #888;
  }

  .hud-value {
    color: #ddd;
    font-weight: 500;
  }

  .hud-row.total {
    border-top: 1px solid rgba(233, 69, 96, 0.3);
    margin-top: 4px;
    padding-top: 6px;
  }

  .hud-row.total .hud-value {
    color: #e94560;
  }

  .hud-row.cache .hud-value {
    color: #7ec699;
  }

  .hud-divider {
    border-top: 1px solid rgba(233, 69, 96, 0.3);
    margin: 6px 0;
  }

  .hud-section-title {
    color: #888;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  .hud-row.cumulative .hud-value {
    color: #4a9eff;
  }

  /* HUD header with cache badge */
  .hud-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .hud-header .hud-title {
    margin-bottom: 0;
  }

  .hud-cache-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 8px;
    background: rgba(126, 198, 153, 0.2);
    color: var(--cache-color, #7ec699);
    border: 1px solid var(--cache-color, #7ec699);
  }

  /* Cache tiers section */
  .hud-cache-header {
    display: flex;
    justify-content: center;
    margin-bottom: 6px;
  }

  .hud-cache-percent {
    font-size: 11px;
    font-weight: 600;
    color: var(--cache-percent-color, #7ec699);
  }

  .hud-tier-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hud-tier-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.03);
  }

  .hud-tier-label {
    font-weight: 600;
    color: var(--tier-color, #888);
    min-width: 36px;
  }

  .hud-tier-contents {
    flex: 1;
    color: #888;
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hud-tier-tokens {
    color: #ddd;
    min-width: 50px;
    text-align: right;
  }

  .hud-tier-cached {
    color: #7ec699;
    font-size: 8px;
  }

  .hud-tier-uncached {
    color: #666;
    font-size: 8px;
  }

  /* Promotion/demotion rows */
  .hud-row.promotion .hud-value {
    color: #7ec699;
  }

  .hud-row.demotion .hud-value {
    color: #f0a500;
  }

  .hud-row.cache-write .hud-value {
    color: #4a9eff;
  }

  .hud-row.history .hud-value {
    color: #7ec699;
  }

  .hud-row.history.warning .hud-value {
    color: #f0a500;
  }

  .hud-row.history.critical .hud-value {
    color: #e94560;
  }

  .hud-changes {
    font-size: 10px;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

`;
