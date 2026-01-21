import { css } from 'lit';

export const promptViewStyles = css`
  :host {
    display: block;
  }

  .dialog {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 400px;
    max-height: 600px;
    background: #16213e;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .dialog.minimized {
    width: 200px;
    max-height: 48px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: #0f3460;
    color: #e94560;
    font-weight: 600;
    cursor: pointer;
  }

  .header button {
    background: none;
    border: none;
    color: #e94560;
    cursor: pointer;
    font-size: 18px;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
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
`;
