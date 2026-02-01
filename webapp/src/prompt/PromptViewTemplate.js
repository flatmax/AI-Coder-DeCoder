import { html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import './UserCard.js';
import './AssistantCard.js';
import './SpeechToText.js';
import '../find-in-files/FindInFiles.js';
import '../context-viewer/ContextViewer.js';
import '../context-viewer/CacheViewer.js';
import { formatTokens } from '../utils/formatters.js';
import { TIER_THRESHOLDS, getTierColor } from '../utils/tierConfig.js';

function renderCacheTiers(data) {
  const tierInfo = data.tier_info;
  if (!tierInfo) return '';
  
  const tiers = ['L0', 'L1', 'L2', 'L3', 'active'];
  
  // Calculate cache hit percentage
  const totalTokens = data.prompt_tokens || 0;
  const cacheHit = data.cache_hit_tokens || 0;
  const cachePercent = totalTokens > 0 ? Math.round((cacheHit / totalTokens) * 100) : 0;
  
  // Build tier rows - only show non-empty tiers (except L0 which always shows)
  const tierRows = tiers.map(tier => {
    const info = tierInfo[tier];
    if (!info || (info.tokens === 0 && tier !== 'L0')) return null;
    
    const tokens = info.tokens || 0;
    const symbols = info.symbols || 0;
    const files = info.files || 0;
    const isCached = tier !== 'active';
    
    // Build contents description
    const contents = [];
    if (tier === 'L0') {
      if (info.has_system) contents.push('sys');
      if (info.has_legend) contents.push('legend');
    }
    if (symbols > 0) contents.push(`${symbols}sym`);
    if (files > 0) contents.push(`${files}f`);
    if (info.has_urls) contents.push('urls');
    if (info.has_history) contents.push('hist');
    
    const contentsStr = contents.length > 0 ? contents.join('+') : '—';
    const tierLabel = tier === 'active' ? 'active' : `${tier}`;
    
    return html`
      <div class="hud-tier-row" style="--tier-color: ${getTierColor(tier)}">
        <span class="hud-tier-label">${tierLabel}</span>
        <span class="hud-tier-contents">${contentsStr}</span>
        <span class="hud-tier-tokens">${formatTokens(tokens)}</span>
        ${isCached ? html`<span class="hud-tier-cached">●</span>` : html`<span class="hud-tier-uncached">○</span>`}
      </div>
    `;
  }).filter(row => row !== null);
  
  return html`
    <div class="hud-divider"></div>
    <div class="hud-section-title">Cache Tiers</div>
    <div class="hud-cache-header">
      <span class="hud-cache-percent" style="--cache-percent-color: ${cachePercent > 50 ? '#7ec699' : cachePercent > 20 ? '#f0a500' : '#e94560'}">
        ${cachePercent}% cache hit
      </span>
    </div>
    <div class="hud-tier-list">
      ${tierRows}
    </div>
  `;
}

function renderPromotions(data) {
  const tierInfo = data.tier_info;
  if (!tierInfo) return '';
  
  const promotions = data.promotions || [];
  const demotions = data.demotions || [];
  
  if (promotions.length === 0 && demotions.length === 0) return '';
  
  const formatItem = (item) => {
    const clean = item.replace('symbol:', '📦 ');
    const parts = clean.split('/');
    return parts.length > 2 ? '...' + parts.slice(-2).join('/') : clean;
  };
  
  return html`
    <div class="hud-divider"></div>
    <div class="hud-section-title">Tier Changes</div>
    ${promotions.length > 0 ? html`
      <div class="hud-row promotion">
        <span class="hud-label">📈</span>
        <span class="hud-value hud-changes">${promotions.slice(0, 3).map(p => formatItem(p[0])).join(', ')}${promotions.length > 3 ? ` +${promotions.length - 3}` : ''}</span>
      </div>
    ` : ''}
    ${demotions.length > 0 ? html`
      <div class="hud-row demotion">
        <span class="hud-label">📉</span>
        <span class="hud-value hud-changes">${demotions.slice(0, 3).map(d => formatItem(d[0])).join(', ')}${demotions.length > 3 ? ` +${demotions.length - 3}` : ''}</span>
      </div>
    ` : ''}
  `;
}

function renderHud(component) {
  if (!component._hudVisible || !component._hudData) {
    return '';
  }
  
  const data = component._hudData;
  
  // Calculate cache hit percentage for prominent display
  const totalTokens = data.prompt_tokens || 0;
  const cacheHit = data.cache_hit_tokens || 0;
  const cachePercent = totalTokens > 0 ? Math.round((cacheHit / totalTokens) * 100) : 0;
  
  return html`
    <div class="token-hud ${component._hudVisible ? 'visible' : ''}"
         @mouseenter=${() => component._onHudMouseEnter()}
         @mouseleave=${() => component._onHudMouseLeave()}>
      <div class="hud-header">
        <div class="hud-title">📊 Tokens</div>
        ${cacheHit > 0 ? html`
          <div class="hud-cache-badge" style="--cache-color: ${cachePercent > 50 ? '#7ec699' : cachePercent > 20 ? '#f0a500' : '#e94560'}">
            ${cachePercent}% cached
          </div>
        ` : ''}
      </div>
      ${data.system_tokens !== undefined ? html`
        <div class="hud-section-title">Context Breakdown</div>
        <div class="hud-row">
          <span class="hud-label">System:</span>
          <span class="hud-value">${formatTokens(data.system_tokens)}</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">Symbol Map:</span>
          <span class="hud-value">${formatTokens(data.symbol_map_tokens)}</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">Files:</span>
          <span class="hud-value">${formatTokens(data.file_tokens)}</span>
        </div>
        <div class="hud-row">
          <span class="hud-label">History:</span>
          <span class="hud-value">${formatTokens(data.history_tokens)}</span>
        </div>
        <div class="hud-row total">
          <span class="hud-label">Context:</span>
          <span class="hud-value">${formatTokens(data.context_total_tokens)} / ${formatTokens(data.max_input_tokens)}</span>
        </div>
      ` : ''}
      ${renderCacheTiers(data)}
      <div class="hud-divider"></div>
      <div class="hud-section-title">This Request</div>
      <div class="hud-row">
        <span class="hud-label">Prompt:</span>
        <span class="hud-value">${formatTokens(data.prompt_tokens)}</span>
      </div>
      <div class="hud-row">
        <span class="hud-label">Response:</span>
        <span class="hud-value">${formatTokens(data.completion_tokens)}</span>
      </div>
      <div class="hud-row total">
        <span class="hud-label">Total:</span>
        <span class="hud-value">${formatTokens(data.total_tokens)}</span>
      </div>
      ${data.cache_hit_tokens ? html`
        <div class="hud-row cache">
          <span class="hud-label">Cache hit:</span>
          <span class="hud-value">${formatTokens(data.cache_hit_tokens)} (${cachePercent}%)</span>
        </div>
      ` : ''}
      ${data.cache_write_tokens ? html`
        <div class="hud-row cache-write">
          <span class="hud-label">Cache write:</span>
          <span class="hud-value">${formatTokens(data.cache_write_tokens)}</span>
        </div>
      ` : ''}
      ${data.history_tokens !== undefined ? html`
        <div class="hud-divider"></div>
        <div class="hud-row history ${data.history_tokens > data.history_threshold * 0.95 ? 'critical' : data.history_tokens > data.history_threshold * 0.8 ? 'warning' : ''}">
          <span class="hud-label">History:</span>
          <span class="hud-value">${formatTokens(data.history_tokens)} / ${formatTokens(data.history_threshold)}</span>
        </div>
      ` : ''}
      ${renderPromotions(data)}
      ${data.session_total_tokens ? html`
        <div class="hud-divider"></div>
        <div class="hud-section-title">Session Total</div>
        <div class="hud-row cumulative">
          <span class="hud-label">In:</span>
          <span class="hud-value">${formatTokens(data.session_prompt_tokens)}</span>
        </div>
        <div class="hud-row cumulative">
          <span class="hud-label">Out:</span>
          <span class="hud-value">${formatTokens(data.session_completion_tokens)}</span>
        </div>
        <div class="hud-row cumulative total">
          <span class="hud-label">Total:</span>
          <span class="hud-value">${formatTokens(data.session_total_tokens)}</span>
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
          <span>${component.activeLeftTab === 'files' ? '💬 Chat' : 
                  component.activeLeftTab === 'search' ? '🔍 Search' : 
                  component.activeLeftTab === 'context' ? '📊 Context' :
                  '🗄️ Cache'}</span>
        </div>
        <div class="header-section header-tabs">
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
            title="Context Budget"
          >📊</button>
          <button 
            class="header-tab ${component.activeLeftTab === 'cache' ? 'active' : ''}"
            @click=${(e) => { e.stopPropagation(); component.switchTab('cache'); }}
            title="Cache Tiers"
          >🗄️</button>
        </div>
        <div class="header-section header-git">
          ${!component.minimized && component.activeLeftTab === 'files' ? html`
            <button class="header-btn commit-btn" @click=${component.handleCommit} title="Generate commit message and commit">
              💾
            </button>
            <button class="header-btn reset-btn" @click=${component.handleResetHard} title="Reset to HEAD (discard all changes)">
              ⚠️
            </button>
          ` : ''}
        </div>
        <div class="header-section header-right">
          ${!component.minimized && component.activeLeftTab === 'files' ? html`
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
                  .selected=${component._getSelectedObject()}
                  @selection-change=${component.handleSelectionChange}
                  @file-view=${component.handleFileView}
                  @copy-path-to-prompt=${component.handleCopyPathToPrompt}
                ></file-picker>
              </div>
            ` : ''}
            <div class="chat-panel">
              <div class="messages-wrapper">
                <div class="messages" id="messages-container" @copy-to-prompt=${(e) => component.handleCopyToPrompt(e)} @file-mention-click=${(e) => component.handleFileMentionClick(e)} @wheel=${(e) => component.handleWheel(e)}>
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
                <div class="input-buttons-stack">
                  <speech-to-text @transcript=${(e) => component.handleSpeechTranscript(e)}></speech-to-text>
                  <button class="file-btn ${component.showFilePicker ? 'active' : ''}" @click=${component.toggleFilePicker} title="Select files">
                    📁 ${component.selectedFiles.length || ''}
                  </button>
                </div>
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
          ` : component.activeLeftTab === 'context' ? html`
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
          ` : html`
            <div class="embedded-panel">
              <cache-viewer
                .rpcCall=${component.call}
                .selectedFiles=${component.selectedFiles || []}
                .fetchedUrls=${Object.keys(component.fetchedUrls || {})}
                .excludedUrls=${component.excludedUrls}
                @remove-url=${(e) => component.handleContextRemoveUrl(e)}
                @url-inclusion-changed=${(e) => component.handleContextUrlInclusionChanged(e)}
                @file-selected=${(e) => component.handleFileMentionClick(e)}
              ></cache-viewer>
            </div>
          `}
        </div>
      `}
    </div>
  `;
}
