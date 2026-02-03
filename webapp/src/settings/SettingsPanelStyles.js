import { css } from 'lit';

export const settingsPanelStyles = css`
  :host {
    display: block;
    padding: 12px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    color: #e0e0e0;
    height: 100%;
    overflow-y: auto;
  }

  h2 {
    margin: 0 0 16px 0;
    font-size: 14px;
    font-weight: 600;
    color: #fff;
  }

  .section {
    margin-bottom: 20px;
    padding: 12px;
    background: #2a2a2a;
    border-radius: 6px;
    border: 1px solid #3a3a3a;
  }

  .section-title {
    margin: 0 0 12px 0;
    font-size: 12px;
    font-weight: 600;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .config-value {
    margin-bottom: 8px;
    padding: 6px 8px;
    background: #1e1e1e;
    border-radius: 4px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 11px;
    color: #a5d6ff;
    word-break: break-all;
  }

  .config-label {
    font-size: 11px;
    color: #6b7280;
    margin-bottom: 4px;
  }

  .button-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  button {
    padding: 6px 12px;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  button.primary {
    background: #3b82f6;
    color: white;
  }

  button.primary:hover {
    background: #2563eb;
  }

  button.secondary {
    background: #4b5563;
    color: #e5e7eb;
  }

  button.secondary:hover {
    background: #6b7280;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .note {
    margin-top: 8px;
    padding: 8px;
    background: #1e1e1e;
    border-radius: 4px;
    font-size: 11px;
    color: #9ca3af;
    border-left: 2px solid #6b7280;
  }

  .note.info {
    border-left-color: #3b82f6;
  }

  .file-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .file-button {
    justify-content: flex-start;
    background: #374151;
    color: #d1d5db;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 11px;
  }

  .file-button:hover {
    background: #4b5563;
  }

  /* Toast message */
  .toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    z-index: 1000;
    animation: slideIn 0.2s ease;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .toast.success {
    background: #065f46;
    color: #d1fae5;
  }

  .toast.error {
    background: #991b1b;
    color: #fecaca;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .loading {
    opacity: 0.7;
  }
`;
