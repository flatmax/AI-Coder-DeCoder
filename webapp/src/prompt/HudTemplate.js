import { html } from 'lit';
import { formatTokens } from '../utils/formatters.js';
import { getTierColor } from '../utils/tierConfig.js';

export function renderCacheTiers(data) {
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

export function renderPromotions(data) {
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

export function renderHud(component) {
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
