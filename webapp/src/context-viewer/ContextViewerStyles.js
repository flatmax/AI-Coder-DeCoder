import { css } from 'lit';

export const contextViewerStyles = css`
  :host {
    display: block;
    height: 100%;
    width: 100%;
    min-height: 400px;
    min-width: 300px;
    overflow-y: auto;
    background: #1a1a2e;
    color: #eee;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
  }

  .context-container {
    padding: 16px;
  }

  .loading, .error {
    padding: 20px;
    text-align: center;
  }

  .error {
    color: #e94560;
  }

  /* Token Budget Section */
  .budget-section {
    background: #16213e;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .budget-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .budget-title {
    font-weight: 600;
    color: #fff;
  }

  .budget-value {
    font-family: monospace;
    color: #4ade80;
  }

  .budget-bar {
    height: 8px;
    background: #0f3460;
    border-radius: 4px;
    overflow: hidden;
  }

  .budget-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #4ade80, #22c55e);
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .budget-bar-fill.warning {
    background: linear-gradient(90deg, #fbbf24, #f59e0b);
  }

  .budget-bar-fill.danger {
    background: linear-gradient(90deg, #ef4444, #dc2626);
  }

  .budget-percent {
    text-align: right;
    font-size: 12px;
    color: #888;
    margin-top: 4px;
  }

  /* Category Breakdown */
  .breakdown-section {
    background: #16213e;
    border-radius: 8px;
    padding: 16px;
  }

  .breakdown-title {
    font-weight: 600;
    color: #fff;
    margin-bottom: 16px;
  }

  .category-row {
    display: flex;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #0f3460;
  }

  .category-row:last-child {
    border-bottom: none;
  }

  .category-row.expandable {
    cursor: pointer;
  }

  .category-row.expandable:hover {
    background: #0f3460;
    margin: 0 -8px;
    padding: 8px;
    border-radius: 4px;
  }

  .category-expand {
    width: 20px;
    color: #888;
    font-size: 10px;
  }

  .category-label {
    flex: 1;
    color: #ccc;
  }

  .category-tokens {
    font-family: monospace;
    color: #4ade80;
    margin-right: 12px;
    min-width: 60px;
    text-align: right;
  }

  .category-bar {
    width: 100px;
    height: 6px;
    background: #0f3460;
    border-radius: 3px;
    overflow: hidden;
  }

  .category-bar-fill {
    height: 100%;
    background: #4ade80;
    border-radius: 3px;
  }

  /* Expanded Items */
  .expanded-items {
    padding-left: 28px;
    margin-top: 8px;
  }

  .item-row {
    display: flex;
    align-items: center;
    padding: 6px 0;
    font-size: 12px;
  }

  .item-row.excluded {
    opacity: 0.6;
  }

  .url-checkbox {
    margin-right: 8px;
    cursor: pointer;
    accent-color: #4ade80;
  }

  .item-path {
    flex: 1;
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-path.excluded {
    text-decoration: line-through;
    color: #666;
  }

  .item-tokens {
    font-family: monospace;
    color: #888;
    margin-left: 8px;
  }

  .item-actions {
    display: flex;
    gap: 4px;
    margin-left: 8px;
  }

  .item-btn {
    background: #0f3460;
    border: none;
    border-radius: 4px;
    color: #888;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .item-btn:hover {
    background: #1a4a7a;
    color: #fff;
  }

  .item-btn.danger:hover {
    background: #7f1d1d;
    color: #fca5a5;
  }

  /* History Warning */
  .history-warning {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #fbbf24;
    font-size: 12px;
    margin-top: 4px;
    padding-left: 28px;
  }

  /* Refresh Button */
  .refresh-btn {
    background: #0f3460;
    border: none;
    border-radius: 4px;
    color: #888;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .refresh-btn:hover {
    background: #1a4a7a;
    color: #fff;
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Model Info */
  .model-info {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #666;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #0f3460;
  }
`;
