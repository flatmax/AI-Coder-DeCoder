import { html } from 'lit';

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
          ${component.formatTokens(breakdown.used_tokens)} / ${component.formatTokens(breakdown.max_input_tokens)}
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
      <span class="category-tokens">${component.formatTokens(data.tokens)}</span>
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
            <span class="item-tokens">${component.formatTokens(item.tokens)}</span>
          </div>
        `)}
      </div>
    `;
  }

  if (key === 'urls' && data.items?.length) {
    return html`
      <div class="expanded-items">
        ${data.items.map(item => html`
          <div class="item-row">
            <span class="item-path" title="${item.url}">${item.title || item.url}</span>
            <span class="item-tokens">${component.formatTokens(item.tokens)}</span>
            <div class="item-actions">
              <button class="item-btn" @click=${(e) => { e.stopPropagation(); component.viewUrl(item.url); }}>
                View
              </button>
              <button class="item-btn danger" @click=${(e) => { e.stopPropagation(); component.removeUrl(item.url); }}>
                ✕
              </button>
            </div>
          </div>
        `)}
      </div>
    `;
  }

  if (key === 'history' && data.needs_summary) {
    return html`
      <div class="history-warning">
        ⚠️ History exceeds budget (${component.formatTokens(data.tokens)} / ${component.formatTokens(data.max_tokens)}) - consider summarizing
      </div>
    `;
  }

  return '';
}

function renderBreakdownSection(component) {
  const { breakdown } = component;
  if (!breakdown?.breakdown) return html``;

  const bd = breakdown.breakdown;

  return html`
    <div class="breakdown-section">
      <div class="breakdown-title">Category Breakdown</div>
      ${renderCategoryRow(component, 'system', bd.system)}
      ${renderCategoryRow(component, 'symbol_map', bd.symbol_map)}
      ${renderCategoryRow(component, 'files', bd.files, true)}
      ${renderCategoryRow(component, 'urls', bd.urls, bd.urls?.items?.length > 0)}
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
  `;
}
