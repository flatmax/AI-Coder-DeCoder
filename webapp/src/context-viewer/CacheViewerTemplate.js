import { html } from 'lit';
import { formatTokens } from '../utils/formatters.js';

// ========== Search Box ==========

function renderSearchBox(component) {
  return html`
    <div class="search-box">
      <input
        type="text"
        class="search-input"
        placeholder="Filter items... (fuzzy search)"
        .value=${component.searchQuery}
        @input=${(e) => component.handleSearchInput(e)}
      />
      ${component.searchQuery ? html`
        <button class="search-clear" @click=${() => component.clearSearch()}>✕</button>
      ` : ''}
    </div>
  `;
}

// ========== Helper Functions ==========

function formatPath(path) {
  // Shorten long paths for display
  if (path.length > 40) {
    const parts = path.split('/');
    if (parts.length > 3) {
      return `${parts[0]}/.../${parts.slice(-2).join('/')}`;
    }
  }
  return path;
}

function formatStability(item) {
  if (!item.next_threshold) return '';
  return `${item.stable_count}/${item.next_threshold}`;
}

// ========== Performance Header ==========

function renderPerformanceHeader(component) {
  const cachePercent = component.getCacheHitPercent();
  const totalTokens = component.getTotalTokens();
  const cachedTokens = component.getCachedTokens();
  const usagePercent = component.getUsagePercent();
  
  return html`
    <div class="cache-performance">
      <div class="cache-performance-header">
        <span class="cache-performance-title">Cache Performance</span>
        <span class="cache-performance-value">${cachePercent}% hit rate</span>
      </div>
      <div class="cache-bar">
        <div class="cache-bar-fill" style="width: ${cachePercent}%"></div>
      </div>
      <div class="cache-stats">
        <span>${formatTokens(cachedTokens)} cached / ${formatTokens(totalTokens)} total</span>
        <span>${usagePercent}% of budget</span>
      </div>
    </div>
  `;
}

// ========== Stability Bar ==========

function renderStabilityBar(item, tier) {
  if (!item.next_threshold) {
    // Already at highest tier
    return html`
      <div class="stability-container">
        <div class="stability-bar">
          <div class="stability-bar-fill tier-${tier}" style="width: 100%"></div>
        </div>
        <span class="stability-text">max</span>
      </div>
    `;
  }
  
  const progress = Math.round((item.progress || 0) * 100);
  return html`
    <div class="stability-container">
      <div class="stability-bar">
        <div class="stability-bar-fill tier-${item.next_tier || tier}" style="width: ${progress}%"></div>
      </div>
      <span class="stability-text">${formatStability(item)}</span>
    </div>
  `;
}

// ========== Content Groups ==========

function renderSymbolsGroup(component, tier, content) {
  const expanded = component.isGroupExpanded(tier, 'symbols');
  const filteredItems = component.filterItems(content.items, 'symbols');
  const matchCount = filteredItems?.length || 0;
  
  // Hide group if no matches
  if (component.searchQuery && matchCount === 0) return '';
  
  return html`
    <div class="content-group">
      <div class="content-row" @click=${() => component.toggleGroup(tier, 'symbols')}>
        <span class="content-expand">${expanded ? '▼' : '▶'}</span>
        <span class="content-icon">📦</span>
        <span class="content-label">Symbols (${component.searchQuery ? `${matchCount}/` : ''}${content.count} files)</span>
        <span class="content-tokens">${formatTokens(content.tokens)}</span>
      </div>
      ${expanded ? html`
        <div class="item-list">
          ${(filteredItems || []).map(item => html`
            <div class="item-row clickable" @click=${() => component.viewFile(item.path)}>
              <span class="item-path" title="${item.path}">${formatPath(item.path)}</span>
              ${renderStabilityBar(item, tier)}
            </div>
          `)}
        </div>
      ` : ''}
    </div>
  `;
}

function renderFilesGroup(component, tier, content) {
  const expanded = component.isGroupExpanded(tier, 'files');
  const filteredItems = component.filterItems(content.items, 'files');
  const matchCount = filteredItems?.length || 0;
  
  // Hide group if no matches
  if (component.searchQuery && matchCount === 0) return '';
  
  return html`
    <div class="content-group">
      <div class="content-row" @click=${() => component.toggleGroup(tier, 'files')}>
        <span class="content-expand">${expanded ? '▼' : '▶'}</span>
        <span class="content-icon">📄</span>
        <span class="content-label">Files (${component.searchQuery ? `${matchCount}/` : ''}${content.count})</span>
        <span class="content-tokens">${formatTokens(content.tokens)}</span>
      </div>
      ${expanded ? html`
        <div class="item-list">
          ${(filteredItems || []).map(item => html`
            <div class="item-row clickable" @click=${() => component.viewFile(item.path)}>
              <span class="item-path" title="${item.path}">${formatPath(item.path)}</span>
              <span class="item-tokens">${formatTokens(item.tokens)}</span>
              ${renderStabilityBar(item, tier)}
            </div>
          `)}
        </div>
      ` : ''}
    </div>
  `;
}

function renderUrlsGroup(component, tier, content) {
  const expanded = component.isGroupExpanded(tier, 'urls');
  const filteredItems = component.filterItems(content.items, 'urls');
  const matchCount = filteredItems?.length || 0;
  const urlCount = content.items?.length || 0;
  
  // Hide group if no matches
  if (component.searchQuery && matchCount === 0) return '';
  
  return html`
    <div class="content-group">
      <div class="content-row" @click=${() => component.toggleGroup(tier, 'urls')}>
        <span class="content-expand">${expanded ? '▼' : '▶'}</span>
        <span class="content-icon">🔗</span>
        <span class="content-label">URLs (${component.searchQuery ? `${matchCount}/` : ''}${urlCount})</span>
        <span class="content-tokens">${formatTokens(content.tokens)}</span>
      </div>
      ${expanded ? html`
        <div class="item-list">
          ${(filteredItems || []).map(item => {
            const included = component.isUrlIncluded(item.url);
            return html`
              <div class="url-row">
                <input 
                  type="checkbox" 
                  class="url-checkbox"
                  .checked=${included}
                  @click=${(e) => e.stopPropagation()}
                  @change=${(e) => { e.stopPropagation(); component.toggleUrlIncluded(item.url); }}
                />
                <span class="url-title ${included ? '' : 'excluded'}" title="${item.url}">
                  ${item.title || item.url}
                </span>
                <span class="item-tokens">${included ? formatTokens(item.tokens) : '—'}</span>
                <div class="url-actions">
                  <button class="url-btn" @click=${(e) => { e.stopPropagation(); component.viewUrl(item.url); }}>
                    View
                  </button>
                  <button class="url-btn danger" @click=${(e) => { e.stopPropagation(); component.removeUrl(item.url); }}>
                    ✕
                  </button>
                </div>
              </div>
            `;
          })}
        </div>
      ` : ''}
    </div>
  `;
}

function renderHistoryGroup(component, tier, content) {
  return html`
    <div class="content-group">
      <div class="content-row">
        <span class="content-expand"></span>
        <span class="content-icon">💬</span>
        <span class="content-label">History (${content.count} messages)</span>
        <span class="content-tokens">${formatTokens(content.tokens)}</span>
      </div>
      ${content.needs_summary ? html`
        <div class="history-warning">
          ⚠️ Exceeds budget (${formatTokens(content.tokens)} / ${formatTokens(content.max_tokens)})
        </div>
      ` : ''}
    </div>
  `;
}

function renderSystemContent(component, content) {
  return html`
    <div class="content-group">
      <div class="content-row">
        <span class="content-expand"></span>
        <span class="content-icon">⚙️</span>
        <span class="content-label">System Prompt</span>
        <span class="content-tokens">${formatTokens(content.tokens)}</span>
      </div>
    </div>
  `;
}

function renderLegendContent(component, content) {
  return html`
    <div class="content-group">
      <div class="content-row">
        <span class="content-expand"></span>
        <span class="content-icon">📖</span>
        <span class="content-label">Legend</span>
        <span class="content-tokens">${formatTokens(content.tokens)}</span>
      </div>
    </div>
  `;
}

// ========== Tier Block ==========

function renderTierBlock(component, block) {
  const expanded = component.expandedTiers[block.tier];
  const isEmpty = block.tokens === 0;
  const tierColor = component.getTierColor(block.tier);
  
  // Hide tier if searching and no matches
  if (component.searchQuery && !component.tierHasMatches(block)) {
    return '';
  }
  
  return html`
    <div class="tier-block ${isEmpty ? 'empty' : ''}" style="--tier-color: ${tierColor}">
      <div class="tier-header" @click=${() => component.toggleTier(block.tier)}>
        <span class="tier-expand">${expanded ? '▼' : '▶'}</span>
        <span class="tier-name">
          <span class="tier-label">${block.tier}</span>
          <span class="tier-desc">· ${block.name}${isEmpty ? ' (empty)' : ''}</span>
        </span>
        <span class="tier-tokens">${formatTokens(block.tokens)}</span>
        <span class="tier-cached">${block.cached ? '🔒' : ''}</span>
      </div>
      
      ${expanded && block.threshold ? html`
        <div class="tier-threshold">
          Threshold: ${block.threshold}+ responses unchanged
        </div>
      ` : ''}
      
      ${expanded && block.contents?.length ? html`
        <div class="tier-contents">
          ${block.contents.map(content => {
            switch (content.type) {
              case 'system':
                return renderSystemContent(component, content);
              case 'legend':
                return renderLegendContent(component, content);
              case 'symbols':
                return renderSymbolsGroup(component, block.tier, content);
              case 'files':
                return renderFilesGroup(component, block.tier, content);
              case 'urls':
                return renderUrlsGroup(component, block.tier, content);
              case 'history':
                return renderHistoryGroup(component, block.tier, content);
              default:
                return '';
            }
          })}
        </div>
      ` : ''}
    </div>
  `;
}

// ========== Recent Changes ==========

function renderRecentChanges(component) {
  if (!component.recentChanges?.length) return '';
  
  return html`
    <div class="recent-changes">
      <div class="recent-changes-title">Recent Changes</div>
      ${component.recentChanges.map(change => html`
        <div class="change-row">
          <span class="change-icon">${change.type === 'promotion' ? '📈' : '📉'}</span>
          <span class="change-item">${formatPath(change.item)}</span>
        </div>
      `)}
    </div>
  `;
}

// ========== Session Totals ==========

function renderSessionTotals(component) {
  const totals = component.breakdown?.session_totals;
  if (!totals) return '';
  
  return html`
    <div class="session-totals">
      <div class="session-title">Session Totals</div>
      <div class="session-row">
        <span class="session-label">Tokens In:</span>
        <span class="session-value">${formatTokens(totals.prompt_tokens)}</span>
      </div>
      <div class="session-row">
        <span class="session-label">Tokens Out:</span>
        <span class="session-value">${formatTokens(totals.completion_tokens)}</span>
      </div>
      <div class="session-row total">
        <span class="session-label">Total:</span>
        <span class="session-value">${formatTokens(totals.total_tokens)}</span>
      </div>
      ${totals.cache_hit_tokens ? html`
        <div class="session-row cache">
          <span class="session-label">Cache Reads:</span>
          <span class="session-value">${formatTokens(totals.cache_hit_tokens)}</span>
        </div>
      ` : ''}
      ${totals.cache_write_tokens ? html`
        <div class="session-row cache">
          <span class="session-label">Cache Writes:</span>
          <span class="session-value">${formatTokens(totals.cache_write_tokens)}</span>
        </div>
      ` : ''}
    </div>
  `;
}

// ========== Footer ==========

function renderFooter(component) {
  return html`
    <div class="cache-footer">
      <span class="model-info">Model: ${component.breakdown?.model || 'unknown'}</span>
      <div class="footer-actions">
        <button 
          class="action-btn"
          @click=${() => component.viewSymbolMap()}
          ?disabled=${component.isLoadingSymbolMap}
        >
          ${component.isLoadingSymbolMap ? '⏳' : '🗺️'} Symbol Map
        </button>
        <button 
          class="action-btn"
          @click=${() => component.refreshBreakdown()}
          ?disabled=${component.isLoading}
        >
          ${component.isLoading ? '...' : '↻'} Refresh
        </button>
      </div>
    </div>
  `;
}

// ========== Main Render ==========

export function renderCacheViewer(component) {
  if (component.isLoading && !component.breakdown) {
    return html`<div class="loading">Loading cache breakdown...</div>`;
  }

  if (component.error) {
    return html`<div class="error">Error: ${component.error}</div>`;
  }

  if (!component.breakdown) {
    return html`<div class="loading">No breakdown data available</div>`;
  }

  const blocks = component.breakdown.blocks || [];
  
  // If no blocks, show a message
  if (blocks.length === 0) {
    return html`
      <div class="cache-container">
        ${renderPerformanceHeader(component)}
        ${renderSearchBox(component)}
        <div class="loading">No cache blocks available. Send a message to populate cache tiers.</div>
        ${renderFooter(component)}
      </div>
    `;
  }

  // Check if search has no results
  const hasSearchResults = !component.searchQuery || 
    blocks.some(block => component.tierHasMatches(block));

  return html`
    <div class="cache-container">
      ${renderPerformanceHeader(component)}
      ${renderSearchBox(component)}
      ${renderRecentChanges(component)}
      
      ${hasSearchResults 
        ? blocks.map(block => renderTierBlock(component, block))
        : html`<div class="no-results">No items match "${component.searchQuery}"</div>`
      }
      
      ${renderFooter(component)}
      ${renderSessionTotals(component)}
    </div>
    
    <url-content-modal
      ?open=${component.showUrlModal}
      .url=${component.selectedUrl}
      .content=${component.urlContent}
      @close=${() => component.closeUrlModal()}
    ></url-content-modal>
    
    <symbol-map-modal
      ?open=${component.showSymbolMapModal}
      .content=${component.symbolMapContent}
      .isLoading=${component.isLoadingSymbolMap}
      @close=${() => component.closeSymbolMapModal()}
    ></symbol-map-modal>
  `;
}
