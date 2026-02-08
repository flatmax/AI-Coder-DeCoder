import{i as m,b as i,c as l,g as w,R as k,a as C}from"./index-KEWF5CLT.js";import{V as T,a as _}from"./SymbolMapModal-BOFsRDcT.js";const S=m`
  :host {
    display: block;
    height: 100%;
    width: 100%;
    min-height: 400px;
    min-width: 300px;
    overflow-y: auto;
    background: #1a1a2e;
    color: #eee;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
  }

  .cache-container {
    padding: 16px;
  }

  .loading, .error {
    padding: 20px;
    text-align: center;
  }

  .error {
    color: #e94560;
  }

  /* ========== Search Box ========== */
  .search-box {
    position: relative;
    margin-bottom: 12px;
  }

  .search-input {
    width: 100%;
    padding: 10px 36px 10px 12px;
    background: #16213e;
    border: 1px solid #0f3460;
    border-radius: 6px;
    color: #eee;
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
  }

  .search-input:focus {
    border-color: #4ade80;
    box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.2);
  }

  .search-input::placeholder {
    color: #666;
  }

  .search-clear {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 4px 8px;
    font-size: 12px;
  }

  .search-clear:hover {
    color: #fff;
  }

  .no-results {
    text-align: center;
    color: #888;
    padding: 20px;
    font-style: italic;
  }

  /* ========== Cache Performance Header ========== */
  .cache-performance {
    background: #16213e;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .cache-performance-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .cache-performance-title {
    font-weight: 600;
    color: #fff;
  }

  .cache-performance-value {
    font-family: monospace;
    color: #4ade80;
  }

  .cache-bar {
    height: 8px;
    background: #0f3460;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .cache-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #4ade80, #22c55e);
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .cache-stats {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: #888;
  }

  /* ========== Tier Blocks ========== */
  .tier-block {
    background: #16213e;
    border-radius: 8px;
    margin-bottom: 12px;
    overflow: hidden;
    border-left: 3px solid var(--tier-color, #888);
  }

  .tier-block.empty {
    opacity: 0.6;
  }

  .tier-header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    cursor: pointer;
    user-select: none;
  }

  .tier-header:hover {
    background: #1a2744;
  }

  .tier-expand {
    width: 20px;
    color: #888;
    font-size: 10px;
  }

  .tier-name {
    flex: 1;
    font-weight: 600;
    color: #fff;
  }

  .tier-name .tier-label {
    color: var(--tier-color, #888);
  }

  .tier-name .tier-desc {
    color: #888;
    font-weight: 400;
    margin-left: 8px;
  }

  .tier-tokens {
    font-family: monospace;
    color: #4ade80;
    margin-right: 8px;
  }

  .tier-cached {
    font-size: 14px;
  }

  .tier-threshold {
    font-size: 11px;
    color: #666;
    padding: 4px 12px 4px 36px;
    border-top: 1px solid #0f3460;
  }

  /* ========== Tier Contents ========== */
  .tier-contents {
    border-top: 1px solid #0f3460;
  }

  .content-group {
    border-bottom: 1px solid #0f3460;
  }

  .content-group:last-child {
    border-bottom: none;
  }

  .content-row {
    display: flex;
    align-items: center;
    padding: 8px 16px 8px 36px;
    cursor: pointer;
  }

  .content-row:hover {
    background: #0f3460;
  }

  .content-expand {
    width: 16px;
    color: #888;
    font-size: 10px;
  }

  .content-icon {
    width: 20px;
    margin-right: 8px;
  }

  .content-label {
    flex: 1;
    color: #ccc;
  }

  .content-tokens {
    font-family: monospace;
    color: #888;
    font-size: 12px;
  }

  /* ========== Item List ========== */
  .item-list {
    padding: 4px 0;
    background: #0f3460;
  }

  .item-row {
    display: flex;
    align-items: center;
    padding: 6px 16px 6px 56px;
    font-size: 12px;
  }

  .item-row:hover {
    background: #1a4a7a;
  }

  .item-row.clickable {
    cursor: pointer;
  }

  .item-path {
    flex: 1;
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-tokens {
    font-family: monospace;
    color: #666;
    margin: 0 12px;
    min-width: 60px;
    text-align: right;
  }

  /* ========== Stability Progress ========== */
  .stability-container {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 100px;
  }

  .stability-bar {
    width: 50px;
    height: 4px;
    background: #1a1a2e;
    border-radius: 2px;
    overflow: hidden;
  }

  .stability-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .stability-bar-fill.tier-L0 { background: #4ade80; }
  .stability-bar-fill.tier-L1 { background: #2dd4bf; }
  .stability-bar-fill.tier-L2 { background: #60a5fa; }
  .stability-bar-fill.tier-L3 { background: #fbbf24; }
  .stability-bar-fill.tier-active { background: #fb923c; }

  .stability-text {
    font-size: 10px;
    color: #666;
    min-width: 45px;
  }

  /* ========== URL Items ========== */
  .url-row {
    display: flex;
    align-items: center;
    padding: 6px 16px 6px 56px;
    font-size: 12px;
  }

  .url-checkbox {
    margin-right: 8px;
    cursor: pointer;
    accent-color: #4ade80;
  }

  .url-title {
    flex: 1;
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .url-title.excluded {
    text-decoration: line-through;
    color: #666;
  }

  .url-actions {
    display: flex;
    gap: 4px;
    margin-left: 8px;
  }

  .url-btn {
    background: #1a1a2e;
    border: none;
    border-radius: 4px;
    color: #888;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .url-btn:hover {
    background: #2a2a4e;
    color: #fff;
  }

  .url-btn.danger:hover {
    background: #7f1d1d;
    color: #fca5a5;
  }

  /* ========== History Warning ========== */
  .history-warning {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #fbbf24;
    font-size: 11px;
    padding: 4px 16px 8px 56px;
  }

  /* ========== Recent Changes ========== */
  .recent-changes {
    background: #16213e;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 12px;
  }

  .recent-changes-title {
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .change-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 12px;
  }

  .change-icon {
    font-size: 14px;
  }

  .change-item {
    flex: 1;
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .change-tier {
    color: #666;
  }

  /* ========== Footer / Actions ========== */
  .cache-footer {
    background: #16213e;
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .model-info {
    font-size: 11px;
    color: #666;
  }

  .footer-actions {
    display: flex;
    gap: 8px;
  }

  .action-btn {
    background: #0f3460;
    border: none;
    border-radius: 4px;
    color: #888;
    padding: 6px 12px;
    font-size: 11px;
    cursor: pointer;
  }

  .action-btn:hover {
    background: #1a4a7a;
    color: #fff;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ========== Session Totals ========== */
  .session-totals {
    background: #16213e;
    border-radius: 8px;
    padding: 12px 16px;
    margin-top: 12px;
  }

  .session-title {
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .session-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    font-size: 12px;
  }

  .session-label {
    color: #888;
  }

  .session-value {
    font-family: monospace;
    color: #4ade80;
  }

  .session-row.total {
    border-top: 1px solid #0f3460;
    margin-top: 4px;
    padding-top: 6px;
  }

  .session-row.total .session-value {
    color: #fff;
  }

  .session-row.cache .session-value {
    color: #fbbf24;
  }
`;function p(s){if(s.length>40){const e=s.split("/");if(e.length>3)return`${e[0]}/.../${e.slice(-2).join("/")}`}return s}function z(s){return s.next_threshold?`${s.stable_count}/${s.next_threshold}`:""}function b(s){return i`
    <div class="search-box">
      <input
        type="text"
        class="search-input"
        placeholder="Filter items... (fuzzy search)"
        .value=${s.searchQuery}
        @input=${e=>s.handleSearchInput(e)}
      />
      ${s.searchQuery?i`
        <button class="search-clear" @click=${()=>s.clearSearch()}>✕</button>
      `:""}
    </div>
  `}function x(s){const e=s.getCacheHitPercent(),t=s.getTotalTokens(),a=s.getCachedTokens(),n=s.getUsagePercent();return i`
    <div class="cache-performance">
      <div class="cache-performance-header">
        <span class="cache-performance-title">Cache Performance</span>
        <span class="cache-performance-value">${e}% hit rate</span>
      </div>
      <div class="cache-bar">
        <div class="cache-bar-fill" style="width: ${e}%"></div>
      </div>
      <div class="cache-stats">
        <span>${l(a)} cached / ${l(t)} total</span>
        <span>${n}% of budget</span>
      </div>
    </div>
  `}function h(s,e){if(!s.next_threshold)return i`
      <div class="stability-container">
        <div class="stability-bar">
          <div class="stability-bar-fill tier-${e}" style="width: 100%"></div>
        </div>
        <span class="stability-text">max</span>
      </div>
    `;const t=Math.round((s.progress||0)*100);return i`
    <div class="stability-container">
      <div class="stability-bar">
        <div class="stability-bar-fill tier-${s.next_tier||e}" style="width: ${t}%"></div>
      </div>
      <span class="stability-text">${z(s)}</span>
    </div>
  `}function M(s,e,t,a){const{type:n,icon:r,label:o}=a,c=s.isGroupExpanded(e,n),d=s.filterItems(t.items,n),u=d?.length||0,f=t.items?.length||t.count||0;if(s.searchQuery&&u===0)return"";const $=s.searchQuery?`${u}/${f}`:f;return i`
    <div class="content-group">
      <div class="content-row" @click=${()=>s.toggleGroup(e,n)}>
        <span class="content-expand">${c?"▼":"▶"}</span>
        <span class="content-icon">${r}</span>
        <span class="content-label">${o} (${$}${n==="symbols"?" files":""})</span>
        <span class="content-tokens">${l(t.tokens)}</span>
      </div>
      ${c?i`
        <div class="item-list">
          ${(d||[]).map(g=>a.renderItem?a.renderItem(s,g,e):I(s,g,e))}
        </div>
      `:""}
    </div>
  `}function I(s,e,t){return i`
    <div class="item-row clickable" @click=${()=>s.viewFile(e.path)}>
      <span class="item-path" title="${e.path}">${p(e.path)}</span>
      ${h(e,t)}
    </div>
  `}function L(s,e,t){return i`
    <div class="item-row clickable" @click=${()=>s.viewFile(e.path)}>
      <span class="item-path" title="${e.path}">${p(e.path)}</span>
      <span class="item-tokens">${l(e.tokens)}</span>
      ${h(e,t)}
    </div>
  `}function P(s,e,t){const a=s.isUrlIncluded(e.url);return i`
    <div class="url-row">
      <input 
        type="checkbox" 
        class="url-checkbox"
        .checked=${a}
        @click=${n=>n.stopPropagation()}
        @change=${n=>{n.stopPropagation(),s.toggleUrlIncluded(e.url)}}
      />
      <span class="url-title ${a?"":"excluded"}" title="${e.url}">
        ${e.title||e.url}
      </span>
      <span class="item-tokens">${a?l(e.tokens):"—"}</span>
      <div class="url-actions">
        <button class="url-btn" @click=${n=>{n.stopPropagation(),s.viewUrl(e.url)}}>
          View
        </button>
        <button class="url-btn danger" @click=${n=>{n.stopPropagation(),s.removeUrl(e.url)}}>
          ✕
        </button>
      </div>
    </div>
  `}function U(s,e,t){const a=e.role==="user"?"U":"A",n=e.role==="user"?"role-user":"role-assistant",r=e.preview?e.preview.length>60?e.preview.substring(0,60)+"…":e.preview:"(empty)";return i`
    <div class="item-row history-item">
      <span class="history-role ${n}">${a}</span>
      <span class="item-path" title="${e.preview||""}">${r}</span>
      <span class="item-tokens">${l(e.tokens)}</span>
      ${h(e,t)}
    </div>
  `}const R={symbols:{type:"symbols",icon:"📦",label:"Symbols",renderItem:null},files:{type:"files",icon:"📄",label:"Files",renderItem:L},urls:{type:"urls",icon:"🔗",label:"URLs",renderItem:P},history:{type:"history",icon:"💬",label:"History",renderItem:U}};function G(s,e,t){const a=t.items||[],n=a.length||t.count||0,r=a.filter(d=>d.role==="user").length,o=a.filter(d=>d.role==="assistant").length,c=r&&o?`${r}U + ${o}A`:r?`${r} user`:`${o} assistant`;return i`
    <div class="content-group">
      <div class="content-row">
        <span class="content-expand"></span>
        <span class="content-icon">💬</span>
        <span class="content-label">History (${n} msgs: ${c})</span>
        <span class="content-tokens">${l(t.tokens)}</span>
      </div>
    </div>
  `}function H(s,e,t){return i`
    <div class="content-group">
      <div class="content-row">
        <span class="content-expand"></span>
        <span class="content-icon">💬</span>
        <span class="content-label">History (${t.count||t.items?.length||0} messages)</span>
        <span class="content-tokens">${l(t.tokens)}</span>
      </div>
      ${t.needs_summary?i`
        <div class="history-warning">
          ⚠️ Exceeds budget (${l(t.tokens)} / ${l(t.max_tokens)})
        </div>
      `:""}
    </div>
  `}function Q(s,e){return i`
    <div class="content-group">
      <div class="content-row">
        <span class="content-expand"></span>
        <span class="content-icon">⚙️</span>
        <span class="content-label">System Prompt</span>
        <span class="content-tokens">${l(e.tokens)}</span>
      </div>
    </div>
  `}function j(s,e){return i`
    <div class="content-group">
      <div class="content-row">
        <span class="content-expand"></span>
        <span class="content-icon">📖</span>
        <span class="content-label">Legend</span>
        <span class="content-tokens">${l(e.tokens)}</span>
      </div>
    </div>
  `}function B(s,e){const t=s.expandedTiers[e.tier],a=e.tokens===0,n=s.getTierColor(e.tier);return s.searchQuery&&!s.tierHasMatches(e)?"":i`
    <div class="tier-block ${a?"empty":""}" style="--tier-color: ${n}">
      <div class="tier-header" @click=${()=>s.toggleTier(e.tier)}>
        <span class="tier-expand">${t?"▼":"▶"}</span>
        <span class="tier-name">
          <span class="tier-label">${e.tier}</span>
          <span class="tier-desc">· ${e.name}${a?" (empty)":""}</span>
        </span>
        <span class="tier-tokens">${l(e.tokens)}</span>
        <span class="tier-cached">${e.cached?"🔒":""}</span>
      </div>
      
      ${t&&e.threshold?i`
        <div class="tier-threshold">
          Threshold: ${e.threshold}+ responses unchanged
        </div>
      `:""}
      
      ${t&&e.contents?.length?i`
        <div class="tier-contents">
          ${e.contents.map(r=>{switch(r.type){case"system":return Q(s,r);case"legend":return j(s,r);case"symbols":case"files":case"urls":return M(s,e.tier,r,R[r.type]);case"history":return e.tier==="active"?H(s,e.tier,r):G(s,e.tier,r);default:return""}})}
        </div>
      `:""}
    </div>
  `}function v(s){if(!s)return"?";if(s.startsWith("history:")){const e=s.slice(8);return e.length>30?"💬 "+e.substring(0,30)+"…":"💬 "+e}return s.startsWith("symbol:")?"📦 "+p(s.slice(7)):"📄 "+p(s)}function F(s){if(!s.recentChanges?.length)return"";const e=s.recentChanges.filter(r=>r.type==="promotion"),t=s.recentChanges.filter(r=>r.type==="demotion"),a={};for(const r of e){const o=r.toTier;a[o]||(a[o]=[]),a[o].push(r)}const n={};for(const r of t){const o=r.fromTier;n[o]||(n[o]=[]),n[o].push(r)}return i`
    <div class="recent-changes">
      <div class="recent-changes-title">Recent Changes</div>
      ${Object.entries(a).map(([r,o])=>i`
        <div class="change-row">
          <span class="change-icon">📈</span>
          <span class="change-summary" style="color: ${s.getTierColor(r)}">
            → ${r}: ${o.length} item${o.length>1?"s":""}
          </span>
          <span class="change-items" title="${o.map(c=>c.item).join(", ")}">
            ${o.map(c=>v(c.item)).join(", ")}
          </span>
        </div>
      `)}
      ${Object.entries(n).map(([r,o])=>i`
        <div class="change-row">
          <span class="change-icon">📉</span>
          <span class="change-summary" style="color: ${s.getTierColor(r)}">
            ${r} → active: ${o.length} item${o.length>1?"s":""}
          </span>
          <span class="change-items" title="${o.map(c=>c.item).join(", ")}">
            ${o.map(c=>v(c.item)).join(", ")}
          </span>
        </div>
      `)}
    </div>
  `}function E(s){const e=s.breakdown?.session_totals;return e?i`
    <div class="session-totals">
      <div class="session-title">Session Totals</div>
      <div class="session-row">
        <span class="session-label">Tokens In:</span>
        <span class="session-value">${l(e.prompt_tokens)}</span>
      </div>
      <div class="session-row">
        <span class="session-label">Tokens Out:</span>
        <span class="session-value">${l(e.completion_tokens)}</span>
      </div>
      <div class="session-row total">
        <span class="session-label">Total:</span>
        <span class="session-value">${l(e.total_tokens)}</span>
      </div>
      ${e.cache_hit_tokens?i`
        <div class="session-row cache">
          <span class="session-label">Cache Reads:</span>
          <span class="session-value">${l(e.cache_hit_tokens)}</span>
        </div>
      `:""}
      ${e.cache_write_tokens?i`
        <div class="session-row cache">
          <span class="session-label">Cache Writes:</span>
          <span class="session-value">${l(e.cache_write_tokens)}</span>
        </div>
      `:""}
    </div>
  `:""}function y(s){return i`
    <div class="cache-footer">
      <span class="model-info">Model: ${s.breakdown?.model||"unknown"}</span>
      <div class="footer-actions">
        <button 
          class="action-btn"
          @click=${()=>s.viewSymbolMap()}
          ?disabled=${s.isLoadingSymbolMap}
        >
          ${s.isLoadingSymbolMap?"⏳":"🗺️"} Symbol Map
        </button>
        <button 
          class="action-btn"
          @click=${()=>s.refreshBreakdown()}
          ?disabled=${s.isLoading}
        >
          ${s.isLoading?"...":"↻"} Refresh
        </button>
      </div>
    </div>
  `}function V(s){if(s.isLoading&&!s.breakdown)return i`<div class="loading">Loading cache breakdown...</div>`;if(s.error)return i`<div class="error">Error: ${s.error}</div>`;if(!s.breakdown)return i`<div class="loading">No breakdown data available</div>`;const e=s.breakdown.blocks||[];if(e.length===0)return i`
      <div class="cache-container">
        ${x(s)}
        ${b(s)}
        <div class="loading">No cache blocks available. Send a message to populate cache tiers.</div>
        ${y(s)}
      </div>
    `;const t=!s.searchQuery||e.some(a=>s.tierHasMatches(a));return i`
    <div class="cache-container">
      ${x(s)}
      ${b(s)}
      ${F(s)}
      
      ${t?e.map(a=>B(s,a)):i`<div class="no-results">No items match "${s.searchQuery}"</div>`}
      
      ${y(s)}
      ${E(s)}
    </div>
    
    <url-content-modal
      ?open=${s.showUrlModal}
      .url=${s.selectedUrl}
      .content=${s.urlContent}
      @close=${()=>s.closeUrlModal()}
    ></url-content-modal>
    
    <symbol-map-modal
      ?open=${s.showSymbolMapModal}
      .content=${s.symbolMapContent}
      .isLoading=${s.isLoadingSymbolMap}
      @close=${()=>s.closeSymbolMapModal()}
    ></symbol-map-modal>
  `}class D extends T(k(C)){static properties={visible:{type:Boolean},expandedTiers:{type:Object},expandedGroups:{type:Object},recentChanges:{type:Array},searchQuery:{type:String},..._};static styles=S;constructor(){super(),this.visible=!0,this.expandedTiers={L0:!0,L1:!1,L2:!1,L3:!1,active:!0},this.expandedGroups={},this.recentChanges=[],this.searchQuery="",this.initViewerData()}onRpcReady(){this.refreshBreakdown()}_onBreakdownResult(e){(e.promotions?.length||e.demotions?.length)&&this._addRecentChanges(e.promotions,e.demotions)}_addRecentChanges(e=[],t=[]){const a=Date.now(),n=[...e.map(r=>({item:r[0],toTier:r[1],type:"promotion",time:a})),...t.map(r=>({item:r[0],fromTier:r[1],type:"demotion",time:a}))];this.recentChanges=n}willUpdate(e){this._viewerDataWillUpdate(e)}toggleTier(e){this.expandedTiers={...this.expandedTiers,[e]:!this.expandedTiers[e]}}toggleGroup(e,t){const a=`${e}-${t}`;this.expandedGroups={...this.expandedGroups,[a]:!this.expandedGroups[a]}}isGroupExpanded(e,t){return this.expandedGroups[`${e}-${t}`]||!1}viewFile(e){const t=e.startsWith("symbol:")?e.slice(7):e;this.dispatchEvent(new CustomEvent("file-selected",{detail:{path:t},bubbles:!0,composed:!0}))}getCacheHitPercent(){if(!this.breakdown)return 0;const e=this.breakdown.cache_hit_rate||0;return Math.round(e*100)}getTotalTokens(){return this.breakdown&&this.breakdown.total_tokens||0}getCachedTokens(){return this.breakdown&&this.breakdown.cached_tokens||0}getUsagePercent(){if(!this.breakdown)return 0;const{total_tokens:e,max_input_tokens:t}=this.breakdown;return t?Math.min(100,Math.round(e/t*100)):0}getTierColor(e){return w(e)}handleSearchInput(e){this.searchQuery=e.target.value}clearSearch(){this.searchQuery=""}fuzzyMatch(e,t){if(!e)return!0;e=e.toLowerCase(),t=t.toLowerCase();let a=0;for(let n=0;n<t.length&&a<e.length;n++)t[n]===e[a]&&a++;return a===e.length}filterItems(e,t){return!this.searchQuery||!e?e:e.filter(a=>{let n;return t==="urls"?n=a.title||a.url||"":t==="history"?n=`${a.role||""} ${a.preview||""}`:n=a.path||"",this.fuzzyMatch(this.searchQuery,n)})}tierHasMatches(e){return this.searchQuery?e.contents?e.contents.some(t=>{if(!t.items)return!1;const a=this.filterItems(t.items,t.type);return a&&a.length>0}):!1:!0}render(){return V(this)}}customElements.define("cache-viewer",D);export{D as CacheViewer};
