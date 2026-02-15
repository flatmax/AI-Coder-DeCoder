var v=Object.defineProperty;var _=(d,e,t)=>e in d?v(d,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):d[e]=t;var g=(d,e,t)=>_(d,typeof e!="symbol"?e+"":e,t);import{R as k,i as $,t as w,s as S,a as C,A as l,b as n}from"./index-BrIXR86B.js";import"./monaco-CUKGTIw_.js";import"./marked-IDzlF_wn.js";import"./hljs-TiioHWPY.js";function c(d){return d==null?"—":d>=1e3?(d/1e3).toFixed(1)+"K":String(d)}const h={system:{bar:"#50c878",text:"#50c878",label:"System"},symbol_map:{bar:"#60a5fa",text:"#60a5fa",label:"Symbols"},files:{bar:"#f59e0b",text:"#f59e0b",label:"Files"},urls:{bar:"#a78bfa",text:"#a78bfa",label:"URLs"},history:{bar:"#f97316",text:"#f97316",label:"History"}};class b extends k($){constructor(){super(),this._data=null,this._loading=!1,this._expandedSections=this._loadExpandedSections(),this._stale=!1,this._onStreamComplete=this._onStreamComplete.bind(this),this._onFilesChanged=this._onFilesChanged.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("stream-complete",this._onStreamComplete),window.addEventListener("files-changed",this._onFilesChanged)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("stream-complete",this._onStreamComplete),window.removeEventListener("files-changed",this._onFilesChanged)}onRpcReady(){this._refresh()}_onStreamComplete(){this._isTabActive()?this._refresh():this._stale=!0}_onFilesChanged(){this._isTabActive()?this._refresh():this._stale=!0}_isTabActive(){const e=this.parentElement;return e&&e.classList.contains("tab-panel")?e.classList.contains("active"):this.offsetParent!==null}onTabVisible(){this._stale&&(this._stale=!1,this._refresh())}async _refresh(){if(!(!this.rpcConnected||this._loading)){this._loading=!0,this._stale=!1;try{const e=await this.rpcExtract("LLMService.get_context_breakdown");e&&(this._data=e)}catch(e){console.warn("Failed to load context breakdown:",e)}finally{this._loading=!1}}}_toggleSection(e){const t=new Set(this._expandedSections);t.has(e)?t.delete(e):t.add(e),this._expandedSections=t,this._saveExpandedSections(t)}async _onUrlItemClick(e){var t;if(!(!e||!this.rpcConnected))try{const r=await this.rpcExtract("LLMService.get_url_content",e);if(!r)return;const a=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-url-content-dialog");a&&a.show(r)}catch(r){console.warn("Failed to load URL content:",r)}}_saveExpandedSections(e){try{localStorage.setItem("ac-dc-context-expanded",JSON.stringify([...e]))}catch{}}_loadExpandedSections(){try{const e=localStorage.getItem("ac-dc-context-expanded");if(e)return new Set(JSON.parse(e))}catch{}return new Set}_getCategories(){var t,r;const e=(t=this._data)==null?void 0:t.breakdown;return e?[{key:"system",icon:"⚙️",name:"System Prompt",tokens:(e.system||0)+(e.legend||0),details:null},{key:"symbol_map",icon:"📦",name:`Symbol Map${e.symbol_map_files?` (${e.symbol_map_files} files)`:""}`,tokens:e.symbol_map||0,details:e.symbol_map_chunks||null},{key:"files",icon:"📄",name:`Files${e.file_count?` (${e.file_count})`:""}`,tokens:e.files||0,details:e.file_details||null},{key:"urls",icon:"🔗",name:`URLs${(r=e.url_details)!=null&&r.length?` (${e.url_details.length})`:""}`,tokens:e.urls||0,details:e.url_details||null},{key:"history",icon:"💬",name:`History${e.history_messages?` (${e.history_messages} msgs)`:""}`,tokens:e.history||0,details:null}]:[]}_getBudgetColor(e){return e>90?"red":e>75?"yellow":"green"}_renderBudget(){const e=this._data;if(!e)return l;const t=e.total_tokens||0,r=e.max_input_tokens||1,a=Math.min(100,t/r*100),s=this._getBudgetColor(a);return n`
      <div class="budget-section">
        <div class="budget-header">
          <span class="budget-label">Token Budget</span>
          <span class="budget-values">${c(t)} / ${c(r)}</span>
        </div>
        <div class="budget-bar">
          <div class="budget-bar-fill ${s}" style="width: ${a}%"></div>
        </div>
        <div class="budget-percent">${a.toFixed(1)}% used</div>
      </div>
    `}_renderStackedBar(){var a;const e=this._getCategories(),t=((a=this._data)==null?void 0:a.total_tokens)||1;if(!e.length||t<=0)return l;const r=e.filter(s=>s.tokens>0).map(s=>{var p,o;return{key:s.key,pct:s.tokens/t*100,color:((p=h[s.key])==null?void 0:p.bar)||"#666",label:((o=h[s.key])==null?void 0:o.label)||s.key,tokens:s.tokens}});return n`
      <div class="stacked-section">
        <div class="stacked-bar">
          ${r.map(s=>n`
            <div class="stacked-segment"
              style="width: ${s.pct}%; background: ${s.color}"
              title="${s.label}: ${c(s.tokens)}">
            </div>
          `)}
        </div>
        <div class="stacked-legend">
          ${r.map(s=>n`
            <span class="legend-item">
              <span class="legend-dot" style="background: ${s.color}"></span>
              <span class="legend-label">${s.label}: ${c(s.tokens)}</span>
            </span>
          `)}
        </div>
      </div>
    `}_renderCategories(){var r;const e=this._getCategories(),t=((r=this._data)==null?void 0:r.total_tokens)||1;return e.length?n`
      <div class="categories">
        ${e.map(a=>{var u;const s=t>0?a.tokens/t*100:0,p=this._expandedSections.has(a.key),o=a.details&&a.details.length>0,m=((u=h[a.key])==null?void 0:u.bar)||"var(--accent-primary)",f=o?Math.max(1,...a.details.map(i=>i.tokens||0)):1;return n`
            <div class="category">
              <div class="category-header ${o?"":"no-expand"}"
                role="${o?"button":l}"
                tabindex="${o?"0":l}"
                aria-expanded="${o?String(p):l}"
                aria-label="${a.name}, ${c(a.tokens)} tokens"
                @click=${()=>o&&this._toggleSection(a.key)}
                @keydown=${i=>{o&&(i.key==="Enter"||i.key===" ")&&(i.preventDefault(),this._toggleSection(a.key))}}>
                <span class="category-toggle" aria-hidden="true">${o?p?"▼":"▶":" "}</span>
                <span class="category-icon">${a.icon}</span>
                <span class="category-name">${a.name}</span>
                <div class="category-bar">
                  <div class="category-bar-fill" style="width: ${s}%; background: ${m}"></div>
                </div>
                <span class="category-tokens">${c(a.tokens)}</span>
              </div>
              ${o?n`
                <div class="category-detail ${p?"expanded":""}">
                  ${a.details.map(i=>{const y=f>0?(i.tokens||0)/f*100:0,x=a.key==="urls"&&i.url;return n`
                      <div class="detail-item ${x?"clickable":""}"
                        @click=${x?()=>this._onUrlItemClick(i.url):l}>
                        <span class="detail-name"
                          title="${i.name||i.path||i.url||"—"}"
                        >${i.name||i.path||i.url||"—"}</span>
                        <div class="detail-bar">
                          <div class="detail-bar-fill" style="width: ${y}%; background: ${m}"></div>
                        </div>
                        <span class="detail-tokens">${c(i.tokens)}</span>
                      </div>
                    `})}
                </div>
              `:l}
            </div>
          `})}
      </div>
    `:l}_renderSessionTotals(){var t;const e=(t=this._data)==null?void 0:t.session_totals;return e?n`
      <div class="session-section">
        <div class="label">Session Totals</div>
        <div class="session-grid">
          <div class="session-item">
            <span>Prompt In</span>
            <span class="session-value">${c(e.prompt)}</span>
          </div>
          <div class="session-item">
            <span>Completion Out</span>
            <span class="session-value">${c(e.completion)}</span>
          </div>
          <div class="session-item">
            <span>Total</span>
            <span class="session-value">${c(e.total)}</span>
          </div>
          <div class="session-item">
            <span>Cache Hit</span>
            <span class="session-value">${c(e.cache_hit)}</span>
          </div>
        </div>
      </div>
    `:l}render(){return n`
      <div class="toolbar">
        <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 600;">
          Context Budget
          ${this._stale?n`<span class="stale-badge">● stale</span>`:l}
        </span>
        <button class="refresh-btn" @click=${()=>this._refresh()}
          ?disabled=${this._loading}
          aria-label="Refresh context breakdown">↻ Refresh</button>
      </div>

      ${this._loading&&!this._data?n`
        <div class="loading-indicator">Loading context breakdown...</div>
      `:n`
        ${this._renderBudget()}
        ${this._data?n`
          <div class="model-info">
            <span>Model: ${this._data.model||"—"}</span>
            ${this._data.cache_hit_rate!=null?n`
              <span>Cache: ${(this._data.cache_hit_rate*100).toFixed(0)}% hit</span>
            `:l}
          </div>
        `:l}
        ${this._renderStackedBar()}
        ${this._renderCategories()}
        ${this._renderSessionTotals()}
      `}

      <ac-url-content-dialog></ac-url-content-dialog>
    `}}g(b,"properties",{_data:{type:Object,state:!0},_loading:{type:Boolean,state:!0},_expandedSections:{type:Object,state:!0},_stale:{type:Boolean,state:!0}}),g(b,"styles",[w,S,C`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow-y: auto;
    }

    /* Budget section */
    .budget-section {
      padding: 12px 16px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
    }

    .budget-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }

    .budget-label {
      font-size: 0.85rem;
      color: var(--text-secondary);
      font-weight: 600;
    }

    .budget-values {
      font-family: var(--font-mono);
      font-size: 0.85rem;
      color: var(--text-primary);
    }

    .budget-bar {
      height: 8px;
      background: var(--bg-primary);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 4px;
    }

    .budget-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s;
    }
    .budget-bar-fill.green { background: var(--accent-green); }
    .budget-bar-fill.yellow { background: #e5c07b; }
    .budget-bar-fill.red { background: var(--accent-red); }

    .budget-percent {
      font-size: 0.78rem;
      color: var(--text-muted);
      text-align: right;
    }

    /* Stacked category bar */
    .stacked-section {
      padding: 8px 16px 4px;
      border-bottom: 1px solid var(--border-primary);
    }

    .stacked-bar {
      display: flex;
      height: 14px;
      border-radius: 7px;
      overflow: hidden;
      background: var(--bg-primary);
      margin-bottom: 8px;
    }

    .stacked-segment {
      height: 100%;
      transition: width 0.3s;
      min-width: 0;
    }

    .stacked-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 14px;
      font-size: 0.78rem;
      color: var(--text-secondary);
      padding-bottom: 4px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .legend-label {
      font-family: var(--font-mono);
      font-size: 0.78rem;
    }

    /* Model info */
    .model-info {
      padding: 8px 16px;
      font-size: 0.82rem;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border-primary);
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }

    .model-info span {
      font-family: var(--font-mono);
    }

    /* Categories */
    .categories {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    .category {
      border-bottom: 1px solid var(--border-primary);
    }

    .category-header {
      display: flex;
      align-items: center;
      padding: 9px 16px;
      cursor: pointer;
      user-select: none;
      gap: 8px;
      font-size: 0.85rem;
      transition: background 0.15s;
    }
    .category-header:hover {
      background: var(--bg-tertiary);
    }
    .category-header.no-expand {
      cursor: default;
    }
    .category-header.no-expand:hover {
      background: transparent;
    }

    .category-toggle {
      font-size: 0.65rem;
      color: var(--text-muted);
      width: 12px;
      flex-shrink: 0;
    }

    .category-icon {
      flex-shrink: 0;
      width: 18px;
      text-align: center;
      font-size: 0.82rem;
    }

    .category-name {
      color: var(--text-secondary);
      flex: 1;
    }

    .category-bar {
      width: 80px;
      height: 4px;
      background: var(--bg-primary);
      border-radius: 2px;
      overflow: hidden;
      flex-shrink: 0;
    }

    .category-bar-fill {
      height: 100%;
      border-radius: 2px;
    }

    .category-tokens {
      font-family: var(--font-mono);
      font-size: 0.82rem;
      color: var(--accent-green);
      min-width: 5ch;
      text-align: right;
      flex-shrink: 0;
    }

    /* Category detail items */
    .category-detail {
      display: none;
      padding: 4px 16px 10px 52px;
    }
    .category-detail.expanded {
      display: block;
    }

    .detail-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 0.8rem;
      color: var(--text-secondary);
    }

    .detail-name {
      flex: 1;
      font-family: var(--font-mono);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .detail-bar {
      width: 56px;
      height: 5px;
      background: var(--bg-primary);
      border-radius: 3px;
      overflow: hidden;
      flex-shrink: 0;
    }

    .detail-bar-fill {
      height: 100%;
      border-radius: 3px;
      background: var(--text-muted);
      opacity: 0.5;
    }

    .detail-tokens {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: var(--accent-green);
      min-width: 5ch;
      text-align: right;
      flex-shrink: 0;
    }

    .detail-item.clickable {
      cursor: pointer;
      border-radius: var(--radius-sm);
      padding-left: 4px;
      padding-right: 4px;
      margin: 0 -4px;
    }
    .detail-item.clickable:hover {
      background: rgba(79, 195, 247, 0.1);
    }
    .detail-item.clickable .detail-name {
      color: var(--accent-primary);
    }

    /* Session totals */
    .session-section {
      padding: 10px 16px;
      border-top: 1px solid var(--border-primary);
      background: var(--bg-tertiary);
      font-size: 0.82rem;
      color: var(--text-secondary);
    }

    .session-section .label {
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 4px;
    }

    .session-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px 12px;
    }

    .session-item {
      display: flex;
      justify-content: space-between;
    }

    .session-value {
      font-family: var(--font-mono);
      color: var(--text-primary);
    }

    /* Loading / Refresh */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      border-bottom: 1px solid var(--border-primary);
      background: var(--bg-secondary);
    }

    .refresh-btn {
      background: none;
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.75rem;
      padding: 2px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      margin-left: auto;
    }
    .refresh-btn:hover {
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }

    .loading-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    .stale-badge {
      font-size: 0.75rem;
      color: var(--accent-orange);
      margin-left: 4px;
    }
  `]);customElements.define("ac-context-tab",b);export{b as AcContextTab,c as formatTokens};
