import { css } from 'lit';

export const historyBrowserStyles = css`
  :host {
    display: block;
  }

  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal {
    background: #1a1a2e;
    border-radius: 12px;
    width: 90vw;
    max-width: 1000px;
    height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    border: 1px solid #0f3460;
  }

  .header {
    display: flex;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid #0f3460;
    gap: 12px;
  }

  .header h2 {
    margin: 0;
    color: #e94560;
    font-size: 18px;
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid #0f3460;
    border-radius: 6px;
    background: #16213e;
    color: #eee;
    font-size: 14px;
  }

  .search-input:focus {
    outline: none;
    border-color: #e94560;
  }

  .close-btn {
    background: none;
    border: none;
    color: #888;
    font-size: 24px;
    cursor: pointer;
    padding: 4px 8px;
  }

  .close-btn:hover {
    color: #e94560;
  }

  .content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .sessions-panel {
    width: 300px;
    border-right: 1px solid #0f3460;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .messages-panel {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .session-item {
    padding: 12px 16px;
    border-bottom: 1px solid #0f3460;
    cursor: pointer;
    transition: background 0.2s;
  }

  .session-item:hover {
    background: #0f3460;
  }

  .session-item.selected {
    background: #0f3460;
    border-left: 3px solid #e94560;
  }

  .session-date {
    font-size: 11px;
    color: #888;
    margin-bottom: 4px;
  }

  .session-preview {
    font-size: 13px;
    color: #ccc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .session-count {
    font-size: 11px;
    color: #666;
    margin-top: 4px;
  }

  .message-card {
    background: #16213e;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
    border: 1px solid #0f3460;
  }

  .message-card.user {
    margin-left: 40px;
    background: #0f3460;
  }

  .message-card.assistant {
    margin-right: 40px;
  }

  .message-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .message-role {
    font-size: 11px;
    color: #e94560;
    font-weight: 600;
    text-transform: uppercase;
  }

  .message-time {
    font-size: 11px;
    color: #666;
  }

  .message-content {
    color: #eee;
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .message-actions {
    display: flex;
    gap: 4px;
    margin-top: 8px;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .message-card:hover .message-actions {
    opacity: 1;
  }

  .action-btn {
    background: #1a1a2e;
    border: 1px solid #0f3460;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 11px;
    color: #888;
  }

  .action-btn:hover {
    background: #0f3460;
    color: #e94560;
  }

  .files-list {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #0f3460;
  }

  .files-label {
    font-size: 11px;
    color: #888;
    margin-bottom: 4px;
  }

  .file-tag {
    display: inline-block;
    background: #0f3460;
    color: #7ec699;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 11px;
    margin-right: 4px;
    margin-bottom: 4px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
  }

  .empty-state .icon {
    font-size: 48px;
    margin-bottom: 12px;
    opacity: 0.5;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    color: #888;
  }

  .search-results-header {
    padding: 12px 16px;
    background: #0f3460;
    color: #e94560;
    font-size: 13px;
    font-weight: 600;
  }

  .search-result-item {
    padding: 12px 16px;
    border-bottom: 1px solid #0f3460;
    cursor: pointer;
  }

  .search-result-item:hover {
    background: #0f3460;
  }

  .search-result-session {
    font-size: 11px;
    color: #888;
    margin-bottom: 4px;
  }

  .search-result-content {
    font-size: 13px;
    color: #ccc;
  }

  .search-highlight {
    background: #e94560;
    color: white;
    padding: 0 2px;
    border-radius: 2px;
  }
`;
