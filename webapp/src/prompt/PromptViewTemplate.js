import { html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import './UserCard.js';
import './AssistantCard.js';

export function renderPromptView(component) {
  return html`
    <div class="dialog ${component.minimized ? 'minimized' : ''} ${component.showFilePicker ? 'with-picker' : ''}">
      <div class="header" @click=${component.toggleMinimize}>
        <span>AI Coder</span>
        <button>${component.minimized ? '▲' : '▼'}</button>
      </div>
      ${component.minimized ? '' : html`
        <div class="main-content">
          ${component.showFilePicker ? html`
            <div class="picker-panel">
              <file-picker
                .tree=${component.fileTree}
                .modified=${component.modifiedFiles}
                .staged=${component.stagedFiles}
                @selection-change=${component.handleSelectionChange}
              ></file-picker>
            </div>
          ` : ''}
          <div class="chat-panel">
            <div class="messages">
              ${repeat(
                component.messageHistory,
                (message) => message.id,
                message => {
                  if (message.role === 'user') {
                    return html`<user-card .content=${message.content}></user-card>`;
                  } else if (message.role === 'assistant') {
                    return html`<assistant-card .content=${message.content}></assistant-card>`;
                  }
                }
              )}
            </div>
            <div class="input-area">
              <button class="file-btn ${component.showFilePicker ? 'active' : ''}" @click=${component.toggleFilePicker} title="Select files">
                📁 ${component.selectedFiles.length || ''}
              </button>
              <textarea
                rows="2"
                placeholder="Type a message..."
                .value=${component.inputValue}
                @input=${component.handleInput}
                @keydown=${component.handleKeyDown}
              ></textarea>
              <button class="send-btn" @click=${component.sendMessage}>Send</button>
            </div>
          </div>
        </div>
      `}
    </div>
  `;
}
