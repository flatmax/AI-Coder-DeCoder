import { LitElement, css } from 'lit';

/**
 * Shared styles for modal components
 */
export const modalBaseStyles = css`
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
    display: flex;
    flex-direction: column;
    border: 1px solid #0f3460;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid #0f3460;
  }

  .modal-title {
    font-weight: 600;
    color: #fff;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .close-btn {
    background: none;
    border: none;
    color: #888;
    font-size: 20px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .close-btn:hover {
    color: #fff;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
  }

  .modal-footer {
    padding: 12px 20px;
    border-top: 1px solid #0f3460;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .footer-btn {
    background: #0f3460;
    border: none;
    border-radius: 6px;
    color: #ccc;
    padding: 8px 16px;
    font-size: 12px;
    cursor: pointer;
  }

  .footer-btn:hover {
    background: #1a4a7a;
    color: #fff;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    color: #888;
    gap: 8px;
  }

  .spinner {
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

  .error {
    color: #e94560;
    padding: 20px;
  }
`;

/**
 * Base class for modal components with shared functionality
 */
export class ModalBase extends LitElement {
  static properties = {
    open: { type: Boolean },
  };

  constructor() {
    super();
    this.open = false;
  }

  _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  _handleOverlayClick(e) {
    if (e.target === e.currentTarget) {
      this._close();
    }
  }

  _copyToClipboard(text) {
    if (text) {
      navigator.clipboard.writeText(text);
    }
  }
}
