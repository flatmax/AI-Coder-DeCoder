import { css } from 'lit';

export const cacheViewerStyles = css`
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

  .cache-container {
    padding: 16px;
  }

  .loading, .error {
    padding: 20px;
    text-align: center;
  }

  .error {
    color: #e94560;
  }

  /* ========== Search Box ========== */
  .search-box {
    position: relative;
    margin-bottom: 12px;
  }

  .search-input {
    width: 100%;
    padding: 10px 36px 10px 12px;
    background: #16213e;
    border: 1px solid #0f3460;
    border-radius: 6px;
    color: #eee;
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
  }

  .search-input:focus {
    border-color: #4ade80;
    box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.2);
  }

  .search-input::placeholder {
    color: #666;
  }

  .search-clear {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 4px 8px;
    font-size: 12px;
  }

  .search-clear:hover {
    color: #fff;
  }

  .no-results {
    text-align: center;
    color: #888;
    padding: 20px;
    font-style: italic;
  }

  /* ========== Cache Performance Header ========== */
  .cache-performance {
    background: #16213e;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .cache-performance-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .cache-performance-title {
    font-weight: 600;
    color: #fff;
  }

  .cache-performance-value {
    font-family: monospace;
    color: #4ade80;
  }

  .cache-bar {
    height: 8px;
    background: #0f3460;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .cache-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #4ade80, #22c55e);
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .cache-stats {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: #888;
  }

  /* ========== Tier Blocks ========== */
  .tier-block {
    background: #16213e;
    border-radius: 8px;
    margin-bottom: 12px;
    overflow: hidden;
    border-left: 3px solid var(--tier-color, #888);
  }

  .tier-block.empty {
    opacity: 0.6;
  }

  .tier-header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    cursor: pointer;
    user-select: none;
  }

  .tier-header:hover {
    background: #1a2744;
  }

  .tier-expand {
    width: 20px;
    color: #888;
    font-size: 10px;
  }

  .tier-name {
    flex: 1;
    font-weight: 600;
    color: #fff;
  }

  .tier-name .tier-label {
    color: var(--tier-color, #888);
  }

  .tier-name .tier-desc {
    color: #888;
    font-weight: 400;
    margin-left: 8px;
  }

  .tier-tokens {
    font-family: monospace;
    color: #4ade80;
    margin-right: 8px;
  }

  .tier-cached {
    font-size: 14px;
  }

  .tier-threshold {
    font-size: 11px;
    color: #666;
    padding: 4px 12px 4px 36px;
    border-top: 1px solid #0f3460;
  }

  /* ========== Tier Contents ========== */
  .tier-contents {
    border-top: 1px solid #0f3460;
  }

  .content-group {
    border-bottom: 1px solid #0f3460;
  }

  .content-group:last-child {
    border-bottom: none;
  }

  .content-row {
    display: flex;
    align-items: center;
    padding: 8px 16px 8px 36px;
    cursor: pointer;
  }

  .content-row:hover {
    background: #0f3460;
  }

  .content-expand {
    width: 16px;
    color: #888;
    font-size: 10px;
  }

  .content-icon {
    width: 20px;
    margin-right: 8px;
  }

  .content-label {
    flex: 1;
    color: #ccc;
  }

  .content-tokens {
    font-family: monospace;
    color: #888;
    font-size: 12px;
  }

  /* ========== Item List ========== */
  .item-list {
    padding: 4px 0;
    background: #0f3460;
  }

  .item-row {
    display: flex;
    align-items: center;
    padding: 6px 16px 6px 56px;
    font-size: 12px;
  }

  .item-row:hover {
    background: #1a4a7a;
  }

  .item-row.clickable {
    cursor: pointer;
  }

  .item-path {
    flex: 1;
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-tokens {
    font-family: monospace;
    color: #666;
    margin: 0 12px;
    min-width: 60px;
    text-align: right;
  }

  /* ========== Stability Progress ========== */
  .stability-container {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 100px;
  }

  .stability-bar {
    width: 50px;
    height: 4px;
    background: #1a1a2e;
    border-radius: 2px;
    overflow: hidden;
  }

  .stability-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .stability-bar-fill.tier-L0 { background: #4ade80; }
  .stability-bar-fill.tier-L1 { background: #2dd4bf; }
  .stability-bar-fill.tier-L2 { background: #60a5fa; }
  .stability-bar-fill.tier-L3 { background: #fbbf24; }
  .stability-bar-fill.tier-active { background: #fb923c; }

  .stability-text {
    font-size: 10px;
    color: #666;
    min-width: 45px;
  }

  /* ========== URL Items ========== */
  .url-row {
    display: flex;
    align-items: center;
    padding: 6px 16px 6px 56px;
    font-size: 12px;
  }

  .url-checkbox {
    margin-right: 8px;
    cursor: pointer;
    accent-color: #4ade80;
  }

  .url-title {
    flex: 1;
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .url-title.excluded {
    text-decoration: line-through;
    color: #666;
  }

  .url-actions {
    display: flex;
    gap: 4px;
    margin-left: 8px;
  }

  .url-btn {
    background: #1a1a2e;
    border: none;
    border-radius: 4px;
    color: #888;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .url-btn:hover {
    background: #2a2a4e;
    color: #fff;
  }

  .url-btn.danger:hover {
    background: #7f1d1d;
    color: #fca5a5;
  }

  /* ========== History Warning ========== */
  .history-warning {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #fbbf24;
    font-size: 11px;
    padding: 4px 16px 8px 56px;
  }

  /* ========== Recent Changes ========== */
  .recent-changes {
    background: #16213e;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 12px;
  }

  .recent-changes-title {
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .change-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 12px;
  }

  .change-icon {
    font-size: 14px;
  }

  .change-item {
    flex: 1;
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .change-tier {
    color: #666;
  }

  /* ========== Footer / Actions ========== */
  .cache-footer {
    background: #16213e;
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .model-info {
    font-size: 11px;
    color: #666;
  }

  .footer-actions {
    display: flex;
    gap: 8px;
  }

  .action-btn {
    background: #0f3460;
    border: none;
    border-radius: 4px;
    color: #888;
    padding: 6px 12px;
    font-size: 11px;
    cursor: pointer;
  }

  .action-btn:hover {
    background: #1a4a7a;
    color: #fff;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ========== Session Totals ========== */
  .session-totals {
    background: #16213e;
    border-radius: 8px;
    padding: 12px 16px;
    margin-top: 12px;
  }

  .session-title {
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .session-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    font-size: 12px;
  }

  .session-label {
    color: #888;
  }

  .session-value {
    font-family: monospace;
    color: #4ade80;
  }

  .session-row.total {
    border-top: 1px solid #0f3460;
    margin-top: 4px;
    padding-top: 6px;
  }

  .session-row.total .session-value {
    color: #fff;
  }

  .session-row.cache .session-value {
    color: #fbbf24;
  }
`;
