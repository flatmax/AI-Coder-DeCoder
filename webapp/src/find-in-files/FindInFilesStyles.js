import { css } from 'lit';

export const findInFilesStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    font-size: 13px;
    height: 100%;
  }

  .container {
    background: #1a1a2e;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .search-header {
    padding: 8px 12px;
    background: #0f3460;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .search-input-row {
    display: flex;
    gap: 8px;
  }

  input[type="text"] {
    flex: 1;
    padding: 6px 10px;
    border: none;
    border-radius: 4px;
    background: #16213e;
    color: #eee;
    font-size: 13px;
  }

  input[type="text"]:focus {
    outline: 1px solid #e94560;
  }

  input[type="text"]::placeholder {
    color: #666;
  }

  .search-options {
    display: flex;
    gap: 4px;
  }

  .option-btn {
    padding: 4px 8px;
    border: 1px solid #0f3460;
    border-radius: 4px;
    background: #16213e;
    color: #888;
    cursor: pointer;
    font-size: 11px;
    min-width: 28px;
    text-align: center;
  }

  .option-btn:hover {
    background: #1a3a6e;
    color: #ccc;
  }

  .option-btn.active {
    background: #e94560;
    color: #fff;
    border-color: #e94560;
  }

  .results-summary {
    padding: 6px 12px;
    background: #16213e;
    color: #888;
    font-size: 12px;
    border-bottom: 1px solid #0f3460;
  }

  .results-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    min-height: 0;
  }

  .file-group {
    margin-bottom: 8px;
  }

  .file-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
    color: #7ec699;
    font-weight: 500;
  }

  .file-header:hover {
    background: #0f3460;
  }

  .file-header .icon {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: #666;
    transition: transform 0.15s;
  }

  .file-header .icon.expanded {
    transform: rotate(90deg);
  }

  .file-header .match-count {
    color: #666;
    font-weight: normal;
    font-size: 11px;
    margin-left: auto;
  }

  .match-list {
    margin-left: 20px;
  }

  .match-item {
    display: flex;
    flex-direction: column;
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 12px;
  }

  .match-item:hover,
  .match-item.focused {
    background: #0f3460;
  }

  .match-item.focused {
    outline: 1px solid #e94560;
    outline-offset: -1px;
  }

  .match-row {
    display: flex;
    gap: 8px;
  }

  .line-num {
    color: #666;
    min-width: 36px;
    text-align: right;
    flex-shrink: 0;
  }

  .match-content {
    color: #ccc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .match-content .highlight {
    background: #e9456033;
    color: #e94560;
    border-radius: 2px;
    padding: 0 2px;
  }

  /* Context lines - only shown when item is active */
  .context-lines {
    display: none;
    flex-direction: column;
    margin-top: 2px;
    padding-top: 2px;
    border-top: 1px solid #0f3460;
  }

  .match-item.show-context .context-lines {
    display: flex;
  }

  .context-line {
    display: flex;
    gap: 8px;
    opacity: 0.6;
  }

  .context-line .line-num {
    color: #555;
  }

  .context-line .match-content {
    color: #888;
  }

  .match-line {
    display: flex;
    gap: 8px;
  }

  .match-line .line-num {
    color: #e94560;
  }

  /* Empty states */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
    text-align: center;
    padding: 20px;
    gap: 8px;
  }

  .empty-state .icon {
    font-size: 32px;
    opacity: 0.5;
  }

  .empty-state .hint {
    font-size: 11px;
    color: #555;
  }

  /* Loading state */
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    color: #888;
    gap: 8px;
  }

  .loading .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid #333;
    border-top-color: #e94560;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Error state */
  .error-state {
    padding: 12px;
    color: #e94560;
    background: #3d1a2a;
    border-radius: 4px;
    margin: 8px;
    font-size: 12px;
  }

  .hidden {
    display: none;
  }
`;
