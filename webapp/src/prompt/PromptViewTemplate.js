import { html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import './UserCard.js';
import './AssistantCard.js';

export function renderPromptView(component) {
  const isDragged = component.dialogX !== null && component.dialogY !== null;
  const dialogStyle = isDragged 
    ? `left: ${component.dialogX}px; top: ${component.dialogY}px;` 
    : '';
  
  return html`
    <div class="dialog ${component.minimized ? 'minimized' : ''} ${component.showFilePicker ? 'with-picker' : ''} ${isDragged ? 'dragged' : ''}"
         style=${dialogStyle}>
      <div class="header" @mousedown=${(e) => component._handleDragStart(e)}>
        <div class="header-left" @click=${component.toggleMinimize}>
          <span>💬 Chat</span>
        </div>
        <div class="header-right">
          ${!component.minimized ? html`
            <button class="clear-btn" @click=${component.showTokenReport} title="Show token usage">
              📊 Tokens
            </button>
            <button class="clear-btn commit-btn" @click=${component.handleCommit} title="Generate commit message and commit">
              💾 Commit
            </button>
            <button class="clear-btn" @click=${component.clearContext} title="Clear conversation context">
              🗑️ Clear
            </button>
          ` : ''}
          <button @click=${component.toggleMinimize}>${component.minimized ? '▲' : '▼'}</button>
        </div>
      </div>
      ${component.minimized ? '' : html`
        <div class="main-content">
          ${component.showFilePicker ? html`
            <div class="picker-panel">
              <file-picker
                .tree=${component.fileTree}
                .modified=${component.modifiedFiles}
                .staged=${component.stagedFiles}
                .untracked=${component.untrackedFiles}
                @selection-change=${component.handleSelectionChange}
                @file-view=${component.handleFileView}
              ></file-picker>
            </div>
          ` : ''}
          <div class="chat-panel">
            <div class="messages" id="messages-container">
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
            ${component.pastedImages.length > 0 ? html`
              <div class="image-preview-area">
                ${component.pastedImages.map((img, index) => html`
                  <div class="image-preview">
                    <img src=${img.preview} alt=${img.name}>
                    <button class="remove-image" @click=${() => component.removeImage(index)}>×</button>
                  </div>
                `)}
                <button class="clear-images" @click=${() => component.clearImages()}>Clear all</button>
              </div>
            ` : ''}
            <div class="input-area">
              <button class="file-btn ${component.showFilePicker ? 'active' : ''}" @click=${component.toggleFilePicker} title="Select files">
                📁 ${component.selectedFiles.length || ''}
              </button>
              <textarea
                rows="2"
                placeholder="Type a message... (paste images with Ctrl+V)"
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
