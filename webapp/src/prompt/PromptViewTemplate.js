import { html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import './UserCard.js';
import './AssistantCard.js';
import './SpeechToText.js';
import { TABS } from '../utils/constants.js';
import { renderHud } from './HudTemplate.js';
import { renderUrlChips } from './UrlChipsTemplate.js';
import { renderHistoryBar } from './HistoryBarTemplate.js';
import { renderSnippetButtons } from './SnippetTemplate.js';

const EMPTY_ARRAY = [];

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

function renderPanelResizer(component) {
  if (component.minimized) return '';
  
  return html`
    <div class="panel-resizer">
      <div class="panel-resizer-handle" @mousedown=${(e) => component._handlePanelResizeStart(e)}></div>
      <button class="panel-collapse-btn" @click=${() => component.toggleLeftPanel()} title="${component.leftPanelCollapsed ? 'Expand panel' : 'Collapse panel'}">
        ${component.leftPanelCollapsed ? '▶' : '◀'}
      </button>
    </div>
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
    <history-browser
      .visible=${component.showHistoryBrowser}
      @copy-to-prompt=${(e) => component.handleHistoryCopyToPrompt(e)}
      @load-session=${(e) => component.handleLoadSession(e)}
    ></history-browser>
    <div class="dialog ${component.minimized ? 'minimized' : ''} ${component.showFilePicker ? 'with-picker' : ''} ${isDragged ? 'dragged' : ''}"
         style=${dialogStyle}>
      ${renderResizeHandles(component)}
      <div class="header" @mousedown=${(e) => component._handleDragStart(e)}>
        <div class="header-section header-left" @click=${component.toggleMinimize}>
          <span>${component.activeLeftTab === TABS.FILES ? '💬 Chat' : 
                  component.activeLeftTab === TABS.SEARCH ? '🔍 Search' : 
                  component.activeLeftTab === TABS.CONTEXT ? '📊 Context' :
                  component.activeLeftTab === TABS.CACHE ? '🗄️ Cache' :
                  '⚙️ Settings'}</span>
        </div>
        <div class="header-section header-tabs">
          <button 
            class="header-tab ${component.activeLeftTab === TABS.FILES ? 'active' : ''}"
            @click=${(e) => { e.stopPropagation(); component.switchTab(TABS.FILES); }}
            title="Files & Chat"
          >📁</button>
          <button 
            class="header-tab ${component.activeLeftTab === TABS.SEARCH ? 'active' : ''}"
            @click=${(e) => { e.stopPropagation(); component.switchTab(TABS.SEARCH); }}
            title="Search"
          >🔍</button>
          <button 
            class="header-tab ${component.activeLeftTab === TABS.CONTEXT ? 'active' : ''}"
            @click=${(e) => { e.stopPropagation(); component.switchTab(TABS.CONTEXT); }}
            title="Context Budget"
          >📊</button>
          <button 
            class="header-tab ${component.activeLeftTab === TABS.CACHE ? 'active' : ''}"
            @click=${(e) => { e.stopPropagation(); component.switchTab(TABS.CACHE); }}
            title="Cache Tiers"
          >🗄️</button>
          <button 
            class="header-tab ${component.activeLeftTab === TABS.SETTINGS ? 'active' : ''}"
            @click=${(e) => { e.stopPropagation(); component.switchTab(TABS.SETTINGS); }}
            title="Settings"
          >⚙️</button>
        </div>
        <div class="header-section header-git">
          ${!component.minimized && component.activeLeftTab === TABS.FILES ? html`
            <button class="header-btn" @click=${component.copyGitDiff} title="Copy git diff HEAD to clipboard">
              📋
            </button>
            <button class="header-btn commit-btn" @click=${component.handleCommit} title="Generate commit message and commit">
              💾
            </button>
            <button class="header-btn reset-btn" @click=${component.handleResetHard} title="Reset to HEAD (discard all changes)">
              ⚠️
            </button>
          ` : ''}
        </div>
        <div class="header-section header-right">
          ${!component.minimized && component.activeLeftTab === TABS.FILES ? html`
            <button class="header-btn" @click=${component.toggleHistoryBrowser} title="View conversation history">
              📜
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
          <div class="${component.activeLeftTab !== TABS.FILES ? 'tab-hidden' : ''}" style="display: ${component.activeLeftTab === TABS.FILES ? 'contents' : 'none'}">
            ${component.showFilePicker && !component.leftPanelCollapsed ? html`
              <div class="picker-panel" style="width: ${component.leftPanelWidth}px">
                <file-picker
                  .tree=${component.fileTree}
                  .modified=${component.modifiedFiles}
                  .staged=${component.stagedFiles}
                  .untracked=${component.untrackedFiles}
                  .diffStats=${component.diffStats}
                  .viewingFile=${component.viewingFile}
                  .selected=${component._selectedObject}
                  .expanded=${component.filePickerExpanded}
                  @selection-change=${component.handleSelectionChange}
                  @expanded-change=${component.handleExpandedChange}
                  @file-view=${component.handleFileView}
                  @copy-path-to-prompt=${component.handleCopyPathToPrompt}
                ></file-picker>
              </div>
              ${renderPanelResizer(component)}
            ` : component.showFilePicker && component.leftPanelCollapsed ? html`
              ${renderPanelResizer(component)}
            ` : ''}
            <div class="chat-panel">
              <div class="messages-wrapper">
                <div class="messages" id="messages-container" @copy-to-prompt=${(e) => component.handleCopyToPrompt(e)} @file-mention-click=${(e) => component.handleFileMentionClick(e)} @wheel=${(e) => component.handleWheel(e)}>
                  ${repeat(
                    component.messageHistory,
                    (message) => message.id,
                    (message) => {
                      if (message.role === 'user') {
                        return html`<user-card .content=${message.content} .images=${message.images || EMPTY_ARRAY}></user-card>`;
                      } else if (message.role === 'assistant') {
                        return html`<assistant-card .content=${message.content} .final=${message.final !== false} .mentionedFiles=${component._addableFiles} .selectedFiles=${component.selectedFiles} .editResults=${message.editResults || EMPTY_ARRAY}></assistant-card>`;
                      }
                    }
                  )}
                  <div id="scroll-sentinel"></div>
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
                <div class="input-buttons-stack">
                  <speech-to-text @transcript=${(e) => component.handleSpeechTranscript(e)}></speech-to-text>
                  ${renderSnippetButtons(component)}
                </div>
                <textarea
                  placeholder="Type a message... (paste images with Ctrl+V)"
                  .value=${component.inputValue}
                  @input=${component.handleInput}
                  @keydown=${component.handleKeyDown}
                  ?disabled=${component.isStreaming || component.isCompacting}
                ></textarea>
                ${component.isStreaming || component.isCompacting
                  ? html`<button class="send-btn stop-btn" @click=${() => component.stopStreaming()}>Stop</button>`
                  : html`<button class="send-btn" @click=${component.sendMessage}>Send</button>`
                }
              </div>
            </div>
          </div>
          ${component._visitedTabs.has(TABS.SEARCH) ? html`
            <div class="embedded-panel ${component.activeLeftTab !== TABS.SEARCH ? 'tab-hidden' : ''}">
              <find-in-files
                @result-selected=${(e) => component.handleSearchResultSelected(e)}
                @file-selected=${(e) => component.handleSearchFileSelected(e)}
              ></find-in-files>
            </div>
          ` : ''}
          ${component._visitedTabs.has(TABS.CONTEXT) ? html`
            <div class="embedded-panel ${component.activeLeftTab !== TABS.CONTEXT ? 'tab-hidden' : ''}">
              <context-viewer
                .selectedFiles=${component.selectedFiles || []}
                .fetchedUrls=${Object.keys(component.fetchedUrls || {})}
                .excludedUrls=${component.excludedUrls}
                @remove-url=${(e) => component.handleContextRemoveUrl(e)}
                @url-inclusion-changed=${(e) => component.handleContextUrlInclusionChanged(e)}
              ></context-viewer>
            </div>
          ` : ''}
          ${component._visitedTabs.has(TABS.CACHE) ? html`
            <div class="embedded-panel ${component.activeLeftTab !== TABS.CACHE ? 'tab-hidden' : ''}">
              <cache-viewer
                .selectedFiles=${component.selectedFiles || []}
                .fetchedUrls=${Object.keys(component.fetchedUrls || {})}
                .excludedUrls=${component.excludedUrls}
                @remove-url=${(e) => component.handleContextRemoveUrl(e)}
                @url-inclusion-changed=${(e) => component.handleContextUrlInclusionChanged(e)}
                @file-selected=${(e) => component.handleFileMentionClick(e)}
              ></cache-viewer>
            </div>
          ` : ''}
          ${component._visitedTabs.has(TABS.SETTINGS) ? html`
            <div class="embedded-panel ${component.activeLeftTab !== TABS.SETTINGS ? 'tab-hidden' : ''}">
              <settings-panel
                @config-edit-request=${(e) => component.handleConfigEditRequest(e)}
              ></settings-panel>
            </div>
          ` : ''}
        </div>
      `}
      ${renderHistoryBar(component)}
    </div>
  `;
}
