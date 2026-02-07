import { html } from 'lit';
import { formatTokens } from '../utils/formatters.js';

function renderSymbolMapButton(component) {
  return html`
    <button 
      class="symbol-map-btn"
      @click=${() => component.viewSymbolMap()}
      ?disabled=${component.isLoadingSymbolMap}
    >
      ${component.isLoadingSymbolMap ? '⏳' : '🗺️'} View Symbol Map
    </button>
  `;
}

function renderBudgetSection(component) {
  const { breakdown } = component;
  if (!breakdown) return html``;

  const percent = component.getUsagePercent();
  const barClass = percent > 90 ? 'danger' : percent > 75 ? 'warning' : '';

  return html`
    <div class="budget-section">
      <div class="budget-header">
        <span class="budget-title">Token Budget</span>
        <span class="budget-value">
          ${formatTokens(breakdown.used_tokens)} / ${formatTokens(breakdown.max_input_tokens)}
        </span>
      </div>
      <div class="budget-bar">
        <div class="budget-bar-fill ${barClass}" style="width: ${percent}%"></div>
      </div>
      <div class="budget-percent">${percent}% used</div>
    </div>
  `;
}

function renderCategoryRow(component, key, data, expandable = false) {
  const expanded = component.expandedSections[key];
  const barWidth = component.getBarWidth(data.tokens);

  return html`
    <div 
      class="category-row ${expandable ? 'expandable' : ''}"
      @click=${expandable ? () => component.toggleSection(key) : null}
    >
      <span class="category-expand">
        ${expandable ? (expanded ? '▼' : '▶') : ''}
      </span>
      <span class="category-label">${data.label}</span>
      <span class="category-tokens">${formatTokens(data.tokens)}</span>
      <div class="category-bar">
        <div class="category-bar-fill" style="width: ${barWidth}%"></div>
      </div>
    </div>
    ${expandable && expanded ? renderExpandedItems(component, key, data) : ''}
  `;
}

function renderExpandedItems(component, key, data) {
  if (key === 'files' && data.items?.length) {
    return html`
      <div class="expanded-items">
        ${data.items.map(item => html`
          <div class="item-row">
            <span class="item-path" title="${item.path}">${item.path}</span>
            <span class="item-tokens">${formatTokens(item.tokens)}</span>
          </div>
        `)}
      </div>
    `;
  }

  if (key === 'symbol_map' && data.files?.length) {
    // Check if chunks have file info
    const chunksWithFiles = data.chunks?.some(c => c.files?.length > 0);
    
    return html`
      <div class="expanded-items symbol-map-files">
        ${data.chunks?.length ? html`
          <div class="symbol-map-chunks">
            <div class="chunks-header">Cache Chunks (Bedrock limit: 4 blocks, 1 used by system prompt)</div>
            ${data.chunks.map(chunk => html`
              <div class="chunk-container">
                <div class="chunk-row ${chunk.cached ? 'cached' : 'uncached'}">
                  <span class="chunk-icon">${chunk.cached ? '🔒' : '📝'}</span>
                  <span class="chunk-label">Chunk ${chunk.index}</span>
                  <span class="chunk-tokens">~${formatTokens(chunk.tokens)}</span>
                  <span class="chunk-file-count">${chunk.files?.length || 0} files</span>
                  <span class="chunk-status">${chunk.cached ? 'cached' : 'volatile'}</span>
                </div>
                ${chunk.files?.length ? html`
                  <div class="chunk-files">
                    ${chunk.files.map(file => html`
                      <div class="chunk-file" title="${file}">${file}</div>
                    `)}
                  </div>
                ` : ''}
              </div>
            `)}
          </div>
        ` : ''}
        ${!chunksWithFiles ? html`
          <div class="symbol-map-info">
            Files are ordered for LLM prefix cache optimization.
            New files appear at the bottom to preserve cached context.
          </div>
          ${data.files.map((file, index) => html`
            <div class="item-row symbol-map-file">
              <span class="file-order">${index + 1}.</span>
              <span class="item-path" title="${file}">${file}</span>
            </div>
          `)}
        ` : ''}
      </div>
    `;
  }

  if (key === 'urls') {
    // Show ALL fetched URLs from the component, not just ones in breakdown
    const allUrls = component.fetchedUrls || [];
    if (allUrls.length === 0) return '';
    
    // Build a map of URL -> token count from breakdown data
    const tokenMap = {};
    if (data.items) {
      for (const item of data.items) {
        tokenMap[item.url] = { tokens: item.tokens, title: item.title };
      }
    }
    
    return html`
      <div class="expanded-items">
        ${allUrls.map(url => {
          const included = component.isUrlIncluded(url);
          const urlData = tokenMap[url] || {};
          return html`
            <div class="item-row ${included ? '' : 'excluded'}">
              <input 
                type="checkbox" 
                class="url-checkbox"
                .checked=${included}
                @click=${(e) => e.stopPropagation()}
                @change=${(e) => { e.stopPropagation(); component.toggleUrlIncluded(url); }}
                title="${included ? 'Click to exclude from context' : 'Click to include in context'}"
              />
              <span class="item-path ${included ? '' : 'excluded'}" title="${url}">${urlData.title || url}</span>
              <span class="item-tokens">${included ? formatTokens(urlData.tokens || 0) : '—'}</span>
              <div class="item-actions">
                <button class="item-btn" @click=${(e) => { e.stopPropagation(); component.viewUrl(url); }}>
                  View
                </button>
                <button class="item-btn danger" @click=${(e) => { e.stopPropagation(); component.removeUrl(url); }}>
                  ✕
                </button>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  if (key === 'history') {
    const tierCounts = data.tier_counts || {};
    const hasTierData = Object.keys(tierCounts).length > 0;
    
    return html`
      ${data.needs_summary ? html`
        <div class="history-warning">
          ⚠️ History exceeds budget (${formatTokens(data.tokens)} / ${formatTokens(data.max_tokens)}) - consider summarizing
        </div>
      ` : ''}
      ${hasTierData ? html`
        <div class="expanded-items">
          <div class="history-tier-distribution">
            ${Object.entries(tierCounts).map(([tier, count]) => html`
              <div class="item-row">
                <span class="item-path">${tier}</span>
                <span class="item-tokens">${count} message${count !== 1 ? 's' : ''}</span>
                <span class="tier-badge ${tier === 'active' ? 'uncached' : 'cached'}">
                  ${tier === 'active' ? '○' : '🔒'}
                </span>
              </div>
            `)}
          </div>
        </div>
      ` : ''}
    `;
  }

  return '';
}

function renderBreakdownSection(component) {
  const { breakdown } = component;
  if (!breakdown?.breakdown) return html``;

  const bd = breakdown.breakdown;
  const hasSymbolMapFiles = bd.symbol_map?.files?.length > 0;

  return html`
    <div class="breakdown-section">
      <div class="breakdown-title">Category Breakdown</div>
      ${renderCategoryRow(component, 'system', bd.system)}
      <div class="category-row-with-action">
        ${renderCategoryRow(component, 'symbol_map', {
          ...bd.symbol_map,
          label: hasSymbolMapFiles 
            ? `Symbol Map (${bd.symbol_map.file_count} files)` 
            : bd.symbol_map.label
        }, hasSymbolMapFiles)}
        ${renderSymbolMapButton(component)}
      </div>
      ${renderCategoryRow(component, 'files', bd.files, true)}
      ${renderCategoryRow(component, 'urls', bd.urls, (component.fetchedUrls?.length > 0))}
      ${renderCategoryRow(component, 'history', bd.history, bd.history?.needs_summary)}
      
      <div class="model-info">
        <span>Model: ${breakdown.model}</span>
        <button 
          class="refresh-btn" 
          @click=${() => component.refreshBreakdown()}
          ?disabled=${component.isLoading}
        >
          ${component.isLoading ? '...' : '↻ Refresh'}
        </button>
      </div>
      
      ${breakdown.session_totals ? html`
        <div class="session-totals">
          <div class="breakdown-title">Session Totals</div>
          <div class="session-row">
            <span class="session-label">Tokens In:</span>
            <span class="session-value">${formatTokens(breakdown.session_totals.prompt_tokens)}</span>
          </div>
          <div class="session-row">
            <span class="session-label">Tokens Out:</span>
            <span class="session-value">${formatTokens(breakdown.session_totals.completion_tokens)}</span>
          </div>
          <div class="session-row total">
            <span class="session-label">Total:</span>
            <span class="session-value">${formatTokens(breakdown.session_totals.total_tokens)}</span>
          </div>
          ${breakdown.session_totals.cache_hit_tokens ? html`
            <div class="session-row cache">
              <span class="session-label">Cache Reads:</span>
              <span class="session-value">${formatTokens(breakdown.session_totals.cache_hit_tokens)}</span>
            </div>
          ` : ''}
          ${breakdown.session_totals.cache_write_tokens ? html`
            <div class="session-row cache">
              <span class="session-label">Cache Writes:</span>
              <span class="session-value">${formatTokens(breakdown.session_totals.cache_write_tokens)}</span>
            </div>
          ` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

export function renderContextViewer(component) {
  if (component.isLoading && !component.breakdown) {
    return html`<div class="loading">Loading context breakdown...</div>`;
  }

  if (component.error) {
    return html`<div class="error">Error: ${component.error}</div>`;
  }

  if (!component.breakdown) {
    return html`<div class="loading">No breakdown data available</div>`;
  }

  return html`
    <div class="context-container">
      ${renderBudgetSection(component)}
      ${renderBreakdownSection(component)}
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
