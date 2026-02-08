import{i as b,b as o,c as r,R as g,a as u}from"./index-KEWF5CLT.js";import{V as h,a as f}from"./SymbolMapModal-BOFsRDcT.js";const x=b`
  .symbol-map-files {
    max-height: 300px;
    overflow-y: auto;
  }
  
  .symbol-map-chunks {
    background: #0f3460;
    border-radius: 6px;
    padding: 10px;
    margin-bottom: 10px;
  }
  
  .chunks-header {
    font-size: 11px;
    color: #888;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid #1a4a7a;
  }
  
  .chunk-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 4px;
    margin-bottom: 4px;
  }
  
  .chunk-row:last-child {
    margin-bottom: 0;
  }
  
  .chunk-row.cached {
    background: rgba(74, 222, 128, 0.1);
  }
  
  .chunk-row.uncached {
    background: rgba(251, 191, 36, 0.1);
  }
  
  .chunk-icon {
    font-size: 12px;
  }
  
  .chunk-label {
    color: #ccc;
    min-width: 60px;
  }
  
  .chunk-tokens {
    font-family: monospace;
    color: #888;
    font-size: 11px;
    min-width: 70px;
  }
  
  .chunk-status {
    font-size: 10px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .chunk-row.cached .chunk-status {
    color: #4ade80;
  }
  
  .chunk-row.uncached .chunk-status {
    color: #fbbf24;
  }
  
  .chunk-container {
    margin-bottom: 8px;
  }
  
  .chunk-container:last-child {
    margin-bottom: 0;
  }
  
  .chunk-file-count {
    font-size: 11px;
    color: #888;
    min-width: 50px;
  }
  
  .chunk-files {
    margin-left: 28px;
    margin-top: 4px;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 4px;
    max-height: 120px;
    overflow-y: auto;
  }
  
  .chunk-file {
    font-size: 11px;
    color: #888;
    padding: 2px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .chunk-row.cached + .chunk-files .chunk-file {
    color: #6ee7b7;
  }

  .symbol-map-info {
    font-size: 11px;
    color: #888;
    padding: 6px 8px;
    background: #1a1a2e;
    border-radius: 4px;
    margin-bottom: 6px;
    line-height: 1.4;
  }
  
  .symbol-map-file {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .file-order {
    color: #666;
    font-size: 11px;
    min-width: 24px;
    text-align: right;
  }

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

  .context-container {
    padding: 16px;
  }

  .loading, .error {
    padding: 20px;
    text-align: center;
  }

  .error {
    color: #e94560;
  }

  /* Token Budget Section */
  .budget-section {
    background: #16213e;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .budget-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .budget-title {
    font-weight: 600;
    color: #fff;
  }

  .budget-value {
    font-family: monospace;
    color: #4ade80;
  }

  .budget-bar {
    height: 8px;
    background: #0f3460;
    border-radius: 4px;
    overflow: hidden;
  }

  .budget-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #4ade80, #22c55e);
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .budget-bar-fill.warning {
    background: linear-gradient(90deg, #fbbf24, #f59e0b);
  }

  .budget-bar-fill.danger {
    background: linear-gradient(90deg, #ef4444, #dc2626);
  }

  .budget-percent {
    text-align: right;
    font-size: 12px;
    color: #888;
    margin-top: 4px;
  }

  /* Category Breakdown */
  .breakdown-section {
    background: #16213e;
    border-radius: 8px;
    padding: 16px;
  }

  .breakdown-title {
    font-weight: 600;
    color: #fff;
    margin-bottom: 16px;
  }

  .category-row {
    display: flex;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #0f3460;
  }

  .category-row:last-child {
    border-bottom: none;
  }

  .category-row.expandable {
    cursor: pointer;
  }

  .category-row.expandable:hover {
    background: #0f3460;
    margin: 0 -8px;
    padding: 8px;
    border-radius: 4px;
  }

  .category-expand {
    width: 20px;
    color: #888;
    font-size: 10px;
  }

  .category-label {
    flex: 1;
    color: #ccc;
  }

  .category-tokens {
    font-family: monospace;
    color: #4ade80;
    margin-right: 12px;
    min-width: 60px;
    text-align: right;
  }

  .category-bar {
    width: 100px;
    height: 6px;
    background: #0f3460;
    border-radius: 3px;
    overflow: hidden;
  }

  .category-bar-fill {
    height: 100%;
    background: #4ade80;
    border-radius: 3px;
  }

  /* Expanded Items */
  .expanded-items {
    padding-left: 28px;
    margin-top: 8px;
  }

  .item-row {
    display: flex;
    align-items: center;
    padding: 6px 0;
    font-size: 12px;
  }

  .item-row.excluded {
    opacity: 0.6;
  }

  .url-checkbox {
    margin-right: 8px;
    cursor: pointer;
    accent-color: #4ade80;
  }

  .item-path {
    flex: 1;
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-path.excluded {
    text-decoration: line-through;
    color: #666;
  }

  .item-tokens {
    font-family: monospace;
    color: #888;
    margin-left: 8px;
  }

  .item-actions {
    display: flex;
    gap: 4px;
    margin-left: 8px;
  }

  .item-btn {
    background: #0f3460;
    border: none;
    border-radius: 4px;
    color: #888;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .item-btn:hover {
    background: #1a4a7a;
    color: #fff;
  }

  .item-btn.danger:hover {
    background: #7f1d1d;
    color: #fca5a5;
  }

  /* History Warning */
  .history-warning {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #fbbf24;
    font-size: 12px;
    margin-top: 4px;
    padding-left: 28px;
  }

  /* Refresh Button */
  .refresh-btn {
    background: #0f3460;
    border: none;
    border-radius: 4px;
    color: #888;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .refresh-btn:hover {
    background: #1a4a7a;
    color: #fff;
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Category row with action button */
  .category-row-with-action {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .category-row-with-action .category-row {
    flex: 1;
  }

  .symbol-map-btn {
    background: #0f3460;
    border: none;
    border-radius: 4px;
    color: #888;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
  }

  .symbol-map-btn:hover {
    background: #1a4a7a;
    color: #fff;
  }

  .symbol-map-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Model Info */
  .model-info {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #666;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #0f3460;
  }

  /* Session Totals */
  .session-totals {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid #0f3460;
  }

  .session-totals .breakdown-title {
    margin-bottom: 12px;
  }

  .session-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
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
    padding-top: 8px;
    font-weight: 600;
  }

  .session-row.total .session-value {
    color: #fff;
  }

  .session-row.cache .session-value {
    color: #fbbf24;
  }
`;function m(e){return o`
    <button 
      class="symbol-map-btn"
      @click=${()=>e.viewSymbolMap()}
      ?disabled=${e.isLoadingSymbolMap}
    >
      ${e.isLoadingSymbolMap?"⏳":"🗺️"} View Symbol Map
    </button>
  `}function k(e){const{breakdown:a}=e;if(!a)return o``;const s=e.getUsagePercent(),i=s>90?"danger":s>75?"warning":"";return o`
    <div class="budget-section">
      <div class="budget-header">
        <span class="budget-title">Token Budget</span>
        <span class="budget-value">
          ${r(a.used_tokens)} / ${r(a.max_input_tokens)}
        </span>
      </div>
      <div class="budget-bar">
        <div class="budget-bar-fill ${i}" style="width: ${s}%"></div>
      </div>
      <div class="budget-percent">${s}% used</div>
    </div>
  `}function c(e,a,s,i=!1){const n=e.expandedSections[a],t=e.getBarWidth(s.tokens);return o`
    <div 
      class="category-row ${i?"expandable":""}"
      @click=${i?()=>e.toggleSection(a):null}
    >
      <span class="category-expand">
        ${i?n?"▼":"▶":""}
      </span>
      <span class="category-label">${s.label}</span>
      <span class="category-tokens">${r(s.tokens)}</span>
      <div class="category-bar">
        <div class="category-bar-fill" style="width: ${t}%"></div>
      </div>
    </div>
    ${i&&n?w(e,a,s):""}
  `}function w(e,a,s){if(a==="files"&&s.items?.length)return o`
      <div class="expanded-items">
        ${s.items.map(i=>o`
          <div class="item-row">
            <span class="item-path" title="${i.path}">${i.path}</span>
            <span class="item-tokens">${r(i.tokens)}</span>
          </div>
        `)}
      </div>
    `;if(a==="symbol_map"&&s.files?.length){const i=s.chunks?.some(n=>n.files?.length>0);return o`
      <div class="expanded-items symbol-map-files">
        ${s.chunks?.length?o`
          <div class="symbol-map-chunks">
            <div class="chunks-header">Cache Chunks (Bedrock limit: 4 blocks, 1 used by system prompt)</div>
            ${s.chunks.map(n=>o`
              <div class="chunk-container">
                <div class="chunk-row ${n.cached?"cached":"uncached"}">
                  <span class="chunk-icon">${n.cached?"🔒":"📝"}</span>
                  <span class="chunk-label">Chunk ${n.index}</span>
                  <span class="chunk-tokens">~${r(n.tokens)}</span>
                  <span class="chunk-file-count">${n.files?.length||0} files</span>
                  <span class="chunk-status">${n.cached?"cached":"volatile"}</span>
                </div>
                ${n.files?.length?o`
                  <div class="chunk-files">
                    ${n.files.map(t=>o`
                      <div class="chunk-file" title="${t}">${t}</div>
                    `)}
                  </div>
                `:""}
              </div>
            `)}
          </div>
        `:""}
        ${i?"":o`
          <div class="symbol-map-info">
            Files are ordered for LLM prefix cache optimization.
            New files appear at the bottom to preserve cached context.
          </div>
          ${s.files.map((n,t)=>o`
            <div class="item-row symbol-map-file">
              <span class="file-order">${t+1}.</span>
              <span class="item-path" title="${n}">${n}</span>
            </div>
          `)}
        `}
      </div>
    `}if(a==="urls"){const i=e.fetchedUrls||[];if(i.length===0)return"";const n={};if(s.items)for(const t of s.items)n[t.url]={tokens:t.tokens,title:t.title};return o`
      <div class="expanded-items">
        ${i.map(t=>{const l=e.isUrlIncluded(t),p=n[t]||{};return o`
            <div class="item-row ${l?"":"excluded"}">
              <input 
                type="checkbox" 
                class="url-checkbox"
                .checked=${l}
                @click=${d=>d.stopPropagation()}
                @change=${d=>{d.stopPropagation(),e.toggleUrlIncluded(t)}}
                title="${l?"Click to exclude from context":"Click to include in context"}"
              />
              <span class="item-path ${l?"":"excluded"}" title="${t}">${p.title||t}</span>
              <span class="item-tokens">${l?r(p.tokens||0):"—"}</span>
              <div class="item-actions">
                <button class="item-btn" @click=${d=>{d.stopPropagation(),e.viewUrl(t)}}>
                  View
                </button>
                <button class="item-btn danger" @click=${d=>{d.stopPropagation(),e.removeUrl(t)}}>
                  ✕
                </button>
              </div>
            </div>
          `})}
      </div>
    `}if(a==="history"){const i=s.tier_counts||{},n=Object.keys(i).length>0;return o`
      ${s.needs_summary?o`
        <div class="history-warning">
          ⚠️ History exceeds budget (${r(s.tokens)} / ${r(s.max_tokens)}) - consider summarizing
        </div>
      `:""}
      ${n?o`
        <div class="expanded-items">
          <div class="history-tier-distribution">
            ${Object.entries(i).map(([t,l])=>o`
              <div class="item-row">
                <span class="item-path">${t}</span>
                <span class="item-tokens">${l} message${l!==1?"s":""}</span>
                <span class="tier-badge ${t==="active"?"uncached":"cached"}">
                  ${t==="active"?"○":"🔒"}
                </span>
              </div>
            `)}
          </div>
        </div>
      `:""}
    `}return""}function v(e){const{breakdown:a}=e;if(!a?.breakdown)return o``;const s=a.breakdown,i=s.symbol_map?.files?.length>0;return o`
    <div class="breakdown-section">
      <div class="breakdown-title">Category Breakdown</div>
      ${c(e,"system",s.system)}
      <div class="category-row-with-action">
        ${c(e,"symbol_map",{...s.symbol_map,label:i?`Symbol Map (${s.symbol_map.file_count} files)`:s.symbol_map.label},i)}
        ${m(e)}
      </div>
      ${c(e,"files",s.files,!0)}
      ${c(e,"urls",s.urls,e.fetchedUrls?.length>0)}
      ${c(e,"history",s.history,s.history?.needs_summary)}
      
      <div class="model-info">
        <span>Model: ${a.model}</span>
        <button 
          class="refresh-btn" 
          @click=${()=>e.refreshBreakdown()}
          ?disabled=${e.isLoading}
        >
          ${e.isLoading?"...":"↻ Refresh"}
        </button>
      </div>
      
      ${a.session_totals?o`
        <div class="session-totals">
          <div class="breakdown-title">Session Totals</div>
          <div class="session-row">
            <span class="session-label">Tokens In:</span>
            <span class="session-value">${r(a.session_totals.prompt_tokens)}</span>
          </div>
          <div class="session-row">
            <span class="session-label">Tokens Out:</span>
            <span class="session-value">${r(a.session_totals.completion_tokens)}</span>
          </div>
          <div class="session-row total">
            <span class="session-label">Total:</span>
            <span class="session-value">${r(a.session_totals.total_tokens)}</span>
          </div>
          ${a.session_totals.cache_hit_tokens?o`
            <div class="session-row cache">
              <span class="session-label">Cache Reads:</span>
              <span class="session-value">${r(a.session_totals.cache_hit_tokens)}</span>
            </div>
          `:""}
          ${a.session_totals.cache_write_tokens?o`
            <div class="session-row cache">
              <span class="session-label">Cache Writes:</span>
              <span class="session-value">${r(a.session_totals.cache_write_tokens)}</span>
            </div>
          `:""}
        </div>
      `:""}
    </div>
  `}function y(e){return e.isLoading&&!e.breakdown?o`<div class="loading">Loading context breakdown...</div>`:e.error?o`<div class="error">Error: ${e.error}</div>`:e.breakdown?o`
    <div class="context-container">
      ${k(e)}
      ${v(e)}
    </div>
    
    <url-content-modal
      ?open=${e.showUrlModal}
      .url=${e.selectedUrl}
      .content=${e.urlContent}
      @close=${()=>e.closeUrlModal()}
    ></url-content-modal>
    
    <symbol-map-modal
      ?open=${e.showSymbolMapModal}
      .content=${e.symbolMapContent}
      .isLoading=${e.isLoadingSymbolMap}
      @close=${()=>e.closeSymbolMapModal()}
    ></symbol-map-modal>
  `:o`<div class="loading">No breakdown data available</div>`}class $ extends h(g(u)){static properties={visible:{type:Boolean},expandedSections:{type:Object},...f};static styles=x;constructor(){super(),this.visible=!0,this.expandedSections={files:!1,urls:!1,history:!1,symbol_map:!1},this.initViewerData()}onRpcReady(){this.refreshBreakdown()}willUpdate(a){this._viewerDataWillUpdate(a)}toggleSection(a){this.expandedSections={...this.expandedSections,[a]:!this.expandedSections[a]}}getUsagePercent(){if(!this.breakdown)return 0;const{used_tokens:a,max_input_tokens:s}=this.breakdown;return s?Math.min(100,Math.round(a/s*100)):0}getBarWidth(a){return!this.breakdown||!this.breakdown.used_tokens?0:Math.round(a/this.breakdown.used_tokens*100)}render(){return y(this)}}customElements.define("context-viewer",$);export{$ as ContextViewer};
