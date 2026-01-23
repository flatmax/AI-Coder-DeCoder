import { css } from 'lit';

export const promptViewStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .dialog {
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
    justify-content: space-between;
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

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header button {
    background: none;
    border: none;
    color: #e94560;
    cursor: pointer;
    font-size: 18px;
    padding: 0;
  }

  .clear-btn {
    background: #1a1a2e !important;
    border: 1px solid #e94560 !important;
    border-radius: 4px !important;
    padding: 4px 8px !important;
    font-size: 11px !important;
    color: #e94560 !important;
  }

  .clear-btn:hover {
    background: #e94560 !important;
    color: white !important;
  }

  .clear-btn.commit-btn {
    border-color: #7ec699 !important;
    color: #7ec699 !important;
  }

  .clear-btn.commit-btn:hover {
    background: #7ec699 !important;
    color: #1a1a2e !important;
  }

  .main-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .picker-panel {
    width: 280px;
    border-right: 1px solid #0f3460;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  file-picker {
    flex: 1;
    min-height: 0;
  }

  .chat-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
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

`;
