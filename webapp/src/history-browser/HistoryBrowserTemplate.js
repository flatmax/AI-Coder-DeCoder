import { html } from 'lit';
import '../prompt/CardMarkdown.js';
import { formatTimestamp, truncateContent } from '../utils/formatters.js';

function renderSessionsList(component) {
  if (component.isSearching && component.searchResults.length > 0) {
    return html`
      <div class="search-results-header">
        Search Results (${component.searchResults.length})
      </div>
      ${component.searchResults.map(msg => html`
        <div 
          class="search-result-item"
          @click=${() => component.selectSession(msg.session_id)}
        >
          <div class="search-result-session">
            ${formatTimestamp(msg.timestamp)} · ${msg.role}
          </div>
          <div class="search-result-content">
            ${truncateContent(msg.content, 150)}
          </div>
        </div>
      `)}
    `;
  }

  if (component.sessions.length === 0) {
    return html`
      <div class="empty-state">
        <div class="icon">📭</div>
        <div>No conversation history</div>
      </div>
    `;
  }

  return component.sessions.map(session => html`
    <div 
      class="session-item ${component.selectedSessionId === session.session_id ? 'selected' : ''}"
      @click=${() => component.selectSession(session.session_id)}
    >
      <div class="session-date">${formatTimestamp(session.timestamp)}</div>
      <div class="session-preview">${session.preview}</div>
      <div class="session-count">${session.message_count} messages</div>
    </div>
  `);
}

function renderMessages(component) {
  if (!component.selectedSessionId) {
    return html`
      <div class="empty-state">
        <div class="icon">👈</div>
        <div>Select a session to view messages</div>
      </div>
    `;
  }

  if (component.isLoading) {
    return html`<div class="loading">Loading...</div>`;
  }

  if (component.selectedSession.length === 0) {
    return html`
      <div class="empty-state">
        <div class="icon">📭</div>
        <div>No messages in this session</div>
      </div>
    `;
  }

  return component.selectedSession.map(msg => html`
    <div class="message-card ${msg.role}">
      <div class="message-header">
        <span class="message-role">${msg.role}</span>
        <span class="message-time">${formatTimestamp(msg.timestamp)}</span>
      </div>
      <div class="message-content">
        ${msg.role === 'assistant' 
          ? html`<card-markdown .content=${msg.content} role="assistant"></card-markdown>`
          : msg.content}
      </div>
      ${msg.files && msg.files.length > 0 ? html`
        <div class="files-list">
          <div class="files-label">Files in context:</div>
          ${msg.files.map(f => html`<span class="file-tag">${f}</span>`)}
        </div>
      ` : ''}
      ${msg.files_modified && msg.files_modified.length > 0 ? html`
        <div class="files-list">
          <div class="files-label">Files modified:</div>
          ${msg.files_modified.map(f => html`<span class="file-tag">${f}</span>`)}
        </div>
      ` : ''}
      <div class="message-actions">
        <button class="action-btn" @click=${() => component.copyToClipboard(msg.content)} title="Copy to clipboard">
          📋 Copy
        </button>
        <button class="action-btn" @click=${() => component.copyToPrompt(msg.content)} title="Paste to prompt">
          ↩️ To Prompt
        </button>
      </div>
    </div>
  `);
}

export function renderHistoryBrowser(component) {
  if (!component.visible) {
    return html``;
  }

  return html`
    <div class="overlay" @click=${(e) => { if (e.target.classList.contains('overlay')) component.hide(); }}>
      <div class="modal">
        <div class="header">
          <h2>📜 Conversation History</h2>
          <input
            type="text"
            class="search-input"
            placeholder="Search messages..."
            .value=${component.searchQuery}
            @input=${(e) => component.handleSearchInput(e)}
          >
          ${component.selectedSessionId && component.selectedSession.length > 0 ? html`
            <button 
              class="load-session-btn" 
              @click=${() => component.loadSessionToChat()}
              title="Replace current chat with this session"
            >
              📥 Load Session
            </button>
          ` : ''}
          <button class="close-btn" @click=${() => component.hide()}>×</button>
        </div>
        <div class="content">
          <div class="sessions-panel">
            ${component.isLoading && !component.selectedSessionId ? html`
              <div class="loading">Loading sessions...</div>
            ` : renderSessionsList(component)}
          </div>
          <div class="messages-panel">
            ${renderMessages(component)}
          </div>
        </div>
      </div>
    </div>
  `;
}
