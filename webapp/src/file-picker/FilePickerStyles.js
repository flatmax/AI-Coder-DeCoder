import { css } from 'lit';

export const filePickerStyles = css`
  :host { display: flex; flex-direction: column; font-size: 13px; height: 100%; }
  .container { background: #1a1a2e; height: 100%; display: flex; flex-direction: column; }
  .header { padding: 8px 12px; background: #0f3460; display: flex; gap: 8px; }
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
  .hidden { display: none; }
  .actions { padding: 8px 12px; border-top: 1px solid #0f3460; display: flex; gap: 8px; align-items: center; }
  button { padding: 4px 10px; border: none; border-radius: 4px; background: #0f3460; color: #eee; cursor: pointer; }
  button:hover { background: #1a3a6e; }
  .count { margin-left: auto; color: #7ec699; font-size: 12px; }
`;
