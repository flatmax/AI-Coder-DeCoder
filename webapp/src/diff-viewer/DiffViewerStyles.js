import { css } from 'lit';

export const diffViewerStyles = css`
  :host {
    display: block;
    width: 100%;
    height: 100%;
  }

  .container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #1e1e1e;
  }

  .file-tabs {
    display: flex;
    background: #252526;
    border-bottom: 1px solid #3c3c3c;
    overflow-x: auto;
    min-height: 35px;
  }

  .tabs-left {
    display: flex;
    flex: 1;
    overflow-x: auto;
  }

  .tabs-right {
    display: flex;
    align-items: center;
    padding-right: 8px;
  }

  .save-btn {
    background: #0f3460;
    color: #eee;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 12px;
  }

  .save-btn:hover:not(:disabled) {
    background: #1a3a6e;
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .save-btn.dirty {
    background: #e94560;
    color: #fff;
  }

  .save-btn.dirty:hover {
    background: #ff5a7a;
  }

  .file-tab {
    padding: 8px 16px;
    background: transparent;
    border: none;
    color: #969696;
    cursor: pointer;
    font-size: 13px;
    white-space: nowrap;
    border-right: 1px solid #3c3c3c;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .file-tab:hover {
    background: #2a2d2e;
  }

  .file-tab.active {
    background: #1e1e1e;
    color: #fff;
    border-bottom: 2px solid #e94560;
  }

  .file-tab .status {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
  }

  .file-tab .status.modified {
    background: #f0a500;
    color: #000;
  }

  .file-tab .status.new {
    background: #7ec699;
    color: #000;
  }

  #editor-container {
    flex: 1;
    overflow: hidden;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
    font-size: 16px;
    gap: 12px;
  }

  .empty-state .icon {
    font-size: 48px;
    opacity: 0.5;
  }

  .hidden {
    display: none;
  }
`;
