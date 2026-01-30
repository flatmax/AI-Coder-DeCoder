import { css } from 'lit';

export const filePickerStyles = css`
  :host { display: flex; flex-direction: column; font-size: 13px; flex: 1; min-height: 0; overflow: hidden; }
  .container { background: #1a1a2e; flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .header { padding: 8px 12px; background: #0f3460; display: flex; gap: 8px; flex-shrink: 0; }
  input[type="text"] { flex: 1; padding: 6px 10px; border: none; border-radius: 4px; background: #16213e; color: #eee; }
  input[type="text"]:focus { outline: 1px solid #e94560; }
  .tree { flex: 1; overflow-y: auto; padding: 8px; min-height: 0; }
  .node { padding: 1px 0; }
  .row { 
    display: flex; 
    align-items: center; 
    gap: 6px; 
    padding: 3px 6px; 
    border-radius: 4px; 
    cursor: pointer; 
    line-height: 1;
  }
  .row:hover { background: #0f3460; }
  .row.viewing { 
    background: #1a3a6e; 
    border-left: 2px solid #e94560;
    padding-left: 4px;
  }
  .row.viewing:hover { background: #1f4080; }
  .children { margin-left: 18px; }
  .icon { 
    width: 14px; 
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: #666; 
    flex-shrink: 0;
  }
  .name { color: #888; flex: 1; }
  .name:hover { text-decoration: underline; }
  .name.clean { color: #888; }
  .name.modified { color: #e2c08d; }
  .name.staged { color: #73c991; }
  .name.untracked { color: #73c991; }
  .name.staged-modified { color: #73c991; }
  .status-indicator {
    font-size: 10px;
    font-weight: bold;
    width: 14px;
    text-align: center;
    flex-shrink: 0;
  }
  .status-indicator.modified { color: #e2c08d; }
  .status-indicator.staged { color: #73c991; }
  .status-indicator.untracked { color: #73c991; }
  .status-indicator.staged-modified { color: #73c991; }
  input[type="checkbox"] { 
    margin: 0; 
    width: 14px; 
    height: 14px;
    flex-shrink: 0;
    cursor: pointer;
  }
  .line-count {
    width: 32px;
    text-align: right;
    color: #555;
    font-size: 11px;
    margin-left: -40px;
    flex-shrink: 0;
  }
  .line-count.warning {
    color: #f0a500;
  }
  .line-count.danger {
    color: #e94560;
  }
  .diff-stats {
    display: flex;
    gap: 4px;
    margin-left: auto;
    font-size: 11px;
    font-family: monospace;
  }
  .diff-stats .additions {
    color: #7ec699;
  }
  .diff-stats .deletions {
    color: #e94560;
  }
  .hidden { display: none; }
  .actions { padding: 8px 12px; border-top: 1px solid #0f3460; display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
  button { padding: 4px 10px; border: none; border-radius: 4px; background: #0f3460; color: #eee; cursor: pointer; }
  button:hover { background: #1a3a6e; }
  .count { margin-left: auto; color: #7ec699; font-size: 12px; }
  
  /* Context Menu */
  .context-menu {
    position: fixed;
    background: #1e1e2e;
    border: 1px solid #0f3460;
    border-radius: 6px;
    padding: 4px 0;
    min-width: 160px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 1000;
  }
  .context-menu-item {
    padding: 8px 12px;
    cursor: pointer;
    color: #ccc;
  }
  .context-menu-item:hover {
    background: #0f3460;
    color: #fff;
  }
  .context-menu-item.danger {
    color: #e94560;
  }
  .context-menu-item.danger:hover {
    background: #3d1a2a;
    color: #ff6b8a;
  }
`;
