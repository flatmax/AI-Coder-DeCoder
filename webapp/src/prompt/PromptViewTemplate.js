import { html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import './UserCard.js';
import './AssistantCard.js';
import '../find-in-files/FindInFiles.js';
import '../context-viewer/ContextViewer.js';

function renderHud(component) {
  if (!component._hudVisible || !component._hudData) {
    return '';
  }
  
  const data = component._hudData;
  const formatNum = (n) => n?.toLocaleString() ?? '0';
  
  return html`
    <div class="token-hud ${component._hudVisible ? 'visible' : ''}">
      <div class="hud-title">📊 Tokens</div>
      ${data.system_tokens !== undefined ? html`
        <div class="hud-section-title">Context Breakdown</div>
        <div class="hud-row">
          <span class="hud-label">System:</span>
          <span class="hud-value">${formatNum(data.system_tokens)}</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">Symbol Map:</span>
          <span class="hud-value">${formatNum(data.symbol_map_tokens)}</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">Files:</span>
          <span class="hud-value">${formatNum(data.file_tokens)}</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">History:</span>
          <span class="hud-value">${formatNum(data.history_tokens)}</span>
        </div>
        <div class="hud-row total">
          <span class="hud-label">Context:</span>
          <span class="hud-value">${formatNum(data.context_total_tokens)} / ${formatNum(data.max_input_tokens)}</span>
        </div>
        <div class="hud-divider"></div>
        <div class="hud-section-title">This Request</div>
      ` : ''}
      <div class="hud-row">
        <span class="hud-label">Prompt:</span>
        <span class="hud-value">${formatNum(data.prompt_tokens)}</span>
      </div>
      <div class="hud-row">
        <span class="hud-label">Response:</span>
        <span class="hud-value">${formatNum(data.completion_tokens)}</span>
      </div>
      <div class="hud-row total">
        <span class="hud-label">Total:</span>
        <span class="hud-value">${formatNum(data.total_tokens)}</span>
      </div>
      ${data.cache_hit_tokens ? html`
        <div class="hud-row cache">
          <span class="hud-label">Cache hit:</span>
          <span class="hud-value">${formatNum(data.cache_hit_tokens)}</span>
        </div>
      ` : ''}
      ${data.session_total_tokens ? html`
        <div class="hud-divider"></div>
        <div class="hud-section-title">Session Total</div>
        <div class="hud-row cumulative">
          <span class="hud-label">In:</span>
          <span class="hud-value">${formatNum(data.session_prompt_tokens)}</span>
        </div>
        <div class="hud-row cumulative">
          <span class="hud-label">Out:</span>
          <span class="hud-value">${formatNum(data.session_completion_tokens)}</span>
        </div>
        <div class="hud-row cumulative total">
          <span class="hud-label">Total:</span>
          <span class="hud-value">${formatNum(data.session_total_tokens)}</span>
        </div>
      ` : ''}
    </div>
  `;
}

function renderUrlChips(component) {
  const hasDetected = component.detectedUrls?.length > 0;
  const hasFetched = Object.keys(component.fetchedUrls || {}).length > 0;
  const hasFetching = Object.keys(component.fetchingUrls || {}).length > 0;
  
  if (!hasDetected && !hasFetched && !hasFetching) {
    return '';
  }

  return html`
    <div class="url-chips-area">
      ${hasFetched ? html`
        <div class="url-chips-row fetched">
          ${Object.values(component.fetchedUrls).map(result => {
            const isIncluded = !component.excludedUrls?.has(result.url);
            const statusClass = result.error ? 'error' : (isIncluded ? 'success' : 'excluded');
            return html`
              <div class="url-chip fetched ${statusClass}" 
                   title=${result.error ? result.error : (result.summary || result.readme || 'No summary available')}>
                ${!result.error ? html`
                  <input 
                    type="checkbox" 
                    class="url-chip-checkbox"
                    .checked=${isIncluded}
                    @change=${() => component.toggleUrlIncluded(result.url)}
                    title="${isIncluded ? 'Click to exclude from context' : 'Click to include in context'}"
                  />
                ` : html`
                  <span class="url-chip-icon">❌</span>
                `}
                <span class="url-chip-label" 
                      @click=${() => component.viewUrlContent(result)}
                      style="cursor: pointer;">
                  ${result.title || component.getUrlDisplayName({ url: result.url })}
                </span>
                <button class="url-chip-remove" @click=${() => component.removeFetchedUrl(result.url)} title="Remove">×</button>
              </div>
            `;
          })}
        </div>
      ` : ''}
      ${hasDetected || hasFetching ? html`
        <div class="url-chips-row detected">
          ${(component.detectedUrls || []).map(urlInfo => html`
            <div class="url-chip detected">
              <span class="url-chip-type">${component.getUrlTypeLabel(urlInfo.type)}</span>
              <span class="url-chip-label" title=${urlInfo.url}>
                ${component.getUrlDisplayName(urlInfo)}
              </span>
              ${component.fetchingUrls?.[urlInfo.url] 
                ? html`<span class="url-chip-loading">⏳</span>`
                : html`
                    <button class="url-chip-fetch" @click=${() => component.fetchUrl(urlInfo)} title="Fetch content">
                      📥
                    </button>
                    <button class="url-chip-dismiss" @click=${() => component.dismissUrl(urlInfo.url)} title="Dismiss">×</button>
                  `
              }
            </div>
          `)}
          ${Object.entries(component.fetchingUrls || {}).filter(([url]) => 
            !(component.detectedUrls || []).some(u => u.url === url)
          ).map(([url]) => html`
            <div class="url-chip fetching">
              <span class="url-chip-loading">⏳</span>
              <span class="url-chip-label">Fetching...</span>
            </div>
          `)}
        </div>
      ` : ''}
    </div>
  `;
}

function renderResizeHandles(component) {
  if (component.minimized) return '';
  
  return html`
    <div class="resize-handle resize-handle-n" @mousedown=${(e) => component._handleResizeStart(e, 'n')}></div>
    <div class="resize-handle resize-handle-s" @mousedown=${(e) => component._handleResizeStart(e, 's')}></div>
    <div class="resize-handle resize-handle-e" @mousedown=${(e) => component._handleResizeStart(e, 'e')}></div>
    <div class="resize-handle resize-handle-w" @mousedown=${(e) => component._handleResizeStart(e, 'w')}></div>
    <div class="resize-handle resize-handle-ne" @mousedown=${(e) => component._handleResizeStart(e, 'ne')}></div>
    <div class="resize-handle resize-handle-nw" @mousedown=${(e) => component._handleResizeStart(e, 'nw')}></div>
    <div class="resize-handle resize-handle-se" @mousedown=${(e) => component._handleResizeStart(e, 'se')}></div>
    <div class="resize-handle resize-handle-sw" @mousedown=${(e) => component._handleResizeStart(e, 'sw')}></div>
  `;
}

export function renderPromptView(component) {
  const isDragged = component.dialogX !== null && component.dialogY !== null;
  const positionStyle = isDragged 
    ? `left: ${component.dialogX}px; top: ${component.dialogY}px;` 
    : '';
  const resizeStyle = component.getResizeStyle ? component.getResizeStyle() : '';
  const dialogStyle = [positionStyle, resizeStyle].filter(Boolean).join('; ');
  
  return html`
    ${renderHud(component)}
    ${component.showHistoryBrowser ? html`
      <history-browser
        @copy-to-prompt=${(e) => component.handleHistoryCopyToPrompt(e)}
        @load-session=${(e) => component.handleLoadSession(e)}
      ></history-browser>
    ` : ''}
    <div class="dialog ${component.minimized ? 'minimized' : ''} ${component.showFilePicker ? 'with-picker' : ''} ${isDragged ? 'dragged' : ''}"
         style=${dialogStyle}>
      ${renderResizeHandles(component)}
      <div class="header" @mousedown=${(e) => component._handleDragStart(e)}>
        <div class="header-left" @click=${component.toggleMinimize}>
          <span>${component.activeLeftTab === 'files' ? '💬 Chat' : 
                  component.activeLeftTab === 'search' ? '🔍 Search' : 
                  '📊 Context'}</span>
        </div>
        <div class="header-tabs">
          <button 
            class="header-tab ${component.activeLeftTab === 'files' ? 'active' : ''}"
            @click=${(e) => { e.stopPropagation(); component.switchTab('files'); }}
            title="Files & Chat"
          >📁</button>
          <button 
            class="header-tab ${component.activeLeftTab === 'search' ? 'active' : ''}"
            @click=${(e) => { e.stopPropagation(); component.switchTab('search'); }}
            title="Search"
          >🔍</button>
          <button 
            class="header-tab ${component.activeLeftTab === 'context' ? 'active' : ''}"
            @click=${(e) => { e.stopPropagation(); component.switchTab('context'); }}
            title="Context"
          >📊</button>
        </div>
        <div class="header-right">
          ${!component.minimized && component.activeLeftTab === 'files' ? html`
            <button class="header-btn commit-btn" @click=${component.handleCommit} title="Generate commit message and commit">
              💾
            </button>
            <button class="header-btn reset-btn" @click=${component.handleResetHard} title="Reset to HEAD (discard all changes)">
              ⚠️
            </button>
            <button class="header-btn" @click=${component.toggleHistoryBrowser} title="View conversation history">
              📜
            </button>
            <button class="header-btn" @click=${component.showTokenReport} title="Show token usage">
              📊
            </button>
            <button class="header-btn" @click=${component.clearContext} title="Clear conversation context">
              🗑️
            </button>
          ` : ''}
          <button class="header-btn" @click=${component.toggleMinimize}>${component.minimized ? '▲' : '▼'}</button>
        </div>
      </div>
      ${component.minimized ? '' : html`
        <div class="main-content">
          ${component.activeLeftTab === 'files' ? html`
            ${component.showFilePicker ? html`
              <div class="picker-panel">
                <file-picker
                  .tree=${component.fileTree}
                  .modified=${component.modifiedFiles}
                  .staged=${component.stagedFiles}
                  .untracked=${component.untrackedFiles}
                  .diffStats=${component.diffStats}
                  .viewingFile=${component.viewingFile}
                  @selection-change=${component.handleSelectionChange}
                  @file-view=${component.handleFileView}
                  @copy-path-to-prompt=${component.handleCopyPathToPrompt}
                ></file-picker>
              </div>
            ` : ''}
            <div class="chat-panel">
              <div class="messages-wrapper">
                <div class="messages" id="messages-container" @copy-to-prompt=${(e) => component.handleCopyToPrompt(e)} @file-mention-click=${(e) => component.handleFileMentionClick(e)}>
                  ${repeat(
                    component.messageHistory,
                    (message) => message.id,
                    message => {
                      if (message.role === 'user') {
                        return html`<user-card .content=${message.content} .images=${message.images || []}></user-card>`;
                      } else if (message.role === 'assistant') {
                        return html`<assistant-card .content=${message.content} .mentionedFiles=${component.getAddableFiles()} .selectedFiles=${component.selectedFiles} .editResults=${message.editResults || []}></assistant-card>`;
                      }
                    }
                  )}
                </div>
                ${component._showScrollButton ? html`
                  <button class="scroll-to-bottom-btn" @click=${() => component.scrollToBottomNow()} title="Scroll to bottom">
                    ↓
                  </button>
                ` : ''}
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
              ${renderUrlChips(component)}
              <div class="input-area">
                <button class="file-btn ${component.showFilePicker ? 'active' : ''}" @click=${component.toggleFilePicker} title="Select files">
                  📁 ${component.selectedFiles.length || ''}
                </button>
                <textarea
                  placeholder="Type a message... (paste images with Ctrl+V)"
                  .value=${component.inputValue}
                  @input=${component.handleInput}
                  @keydown=${component.handleKeyDown}
                  ?disabled=${component.isStreaming}
                ></textarea>
                ${component.isStreaming 
                  ? html`<button class="send-btn stop-btn" @click=${() => component.stopStreaming()}>Stop</button>`
                  : html`<button class="send-btn" @click=${component.sendMessage}>Send</button>`
                }
              </div>
            </div>
          ` : component.activeLeftTab === 'search' ? html`
            <div class="embedded-panel">
              <find-in-files
                .rpcCall=${component.call}
                @result-selected=${(e) => component.handleSearchResultSelected(e)}
                @file-selected=${(e) => component.handleSearchFileSelected(e)}
              ></find-in-files>
            </div>
          ` : html`
            <div class="embedded-panel">
              <context-viewer
                .rpcCall=${component.call}
                .selectedFiles=${component.selectedFiles || []}
                .fetchedUrls=${Object.keys(component.fetchedUrls || {})}
                .excludedUrls=${component.excludedUrls}
                @remove-url=${(e) => component.handleContextRemoveUrl(e)}
                @url-inclusion-changed=${(e) => component.handleContextUrlInclusionChanged(e)}
              ></context-viewer>
            </div>
          `}
        </div>
      `}
    </div>
  `;
}
