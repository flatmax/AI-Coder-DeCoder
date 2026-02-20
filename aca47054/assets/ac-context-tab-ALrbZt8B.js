var v=Object.defineProperty;var _=(c,e,t)=>e in c?v(c,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):c[e]=t;var h=(c,e,t)=>_(c,typeof e!="symbol"?e+"":e,t);import{R as k,i as $,t as w,s as S,a as C,A as l,b as o}from"./index-D67p489G.js";import"./monaco-Bfa5fHnC.js";import"./marked-IDzlF_wn.js";import"./hljs-gJDTAEaL.js";function d(c){return c==null?"—":c>=1e3?(c/1e3).toFixed(1)+"K":String(c)}const m={system:{bar:"#50c878",text:"#50c878",label:"System"},symbol_map:{bar:"#60a5fa",text:"#60a5fa",label:"Symbols"},files:{bar:"#f59e0b",text:"#f59e0b",label:"Files"},urls:{bar:"#a78bfa",text:"#a78bfa",label:"URLs"},history:{bar:"#f97316",text:"#f97316",label:"History"}};class b extends k($){constructor(){super(),this._data=null,this._loading=!1,this._expandedSections=this._loadExpandedSections(),this._stale=!1,this._onStreamComplete=this._onStreamComplete.bind(this),this._onFilesChanged=this._onFilesChanged.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("stream-complete",this._onStreamComplete),window.addEventListener("files-changed",this._onFilesChanged)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("stream-complete",this._onStreamComplete),window.removeEventListener("files-changed",this._onFilesChanged)}onRpcReady(){this._refresh()}_onStreamComplete(){this._isTabActive()?this._refresh():this._stale=!0}_onFilesChanged(){this._isTabActive()?this._refresh():this._stale=!0}_isTabActive(){const e=this.parentElement;return e&&e.classList.contains("tab-panel")?e.classList.contains("active"):this.offsetParent!==null}onTabVisible(){this._stale&&(this._stale=!1,this._refresh())}async _refresh(){if(!(!this.rpcConnected||this._loading)){this._loading=!0,this._stale=!1;try{const e=await this.rpcExtract("LLMService.get_context_breakdown");e&&(this._data=e)}catch(e){console.warn("Failed to load context breakdown:",e)}finally{this._loading=!1}}}_toggleSection(e){const t=new Set(this._expandedSections);t.has(e)?t.delete(e):t.add(e),this._expandedSections=t,this._saveExpandedSections(t)}async _onUrlItemClick(e){var t;if(!(!e||!this.rpcConnected))try{const r=await this.rpcExtract("LLMService.get_url_content",e);if(!r)return;const a=(t=this.shadowRoot)==null?void 0:t.querySelector("ac-url-content-dialog");a&&a.show(r)}catch(r){console.warn("Failed to load URL content:",r)}}_saveExpandedSections(e){try{localStorage.setItem("ac-dc-context-expanded",JSON.stringify([...e]))}catch{}}_loadExpandedSections(){try{const e=localStorage.getItem("ac-dc-context-expanded");if(e)return new Set(JSON.parse(e))}catch{}return new Set}_getCategories(){var t,r,a,s;const e=(t=this._data)==null?void 0:t.breakdown;return e?[{key:"system",icon:"⚙️",name:"System Prompt",tokens:(e.system||0)+(e.legend||0),details:null},{key:"symbol_map",icon:((r=this._data)==null?void 0:r.mode)==="doc"?"📝":"📦",name:((a=this._data)==null?void 0:a.mode)==="doc"?`Doc Map${e.symbol_map_files?` (${e.symbol_map_files} files)`:""}`:`Symbol Map${e.symbol_map_files?` (${e.symbol_map_files} files)`:""}`,tokens:e.symbol_map||0,details:e.symbol_map_chunks||null},{key:"files",icon:"📄",name:`Files${e.file_count?` (${e.file_count})`:""}`,tokens:e.files||0,details:e.file_details||null},{key:"urls",icon:"🔗",name:`URLs${(s=e.url_details)!=null&&s.length?` (${e.url_details.length})`:""}`,tokens:e.urls||0,details:e.url_details||null},{key:"history",icon:"💬",name:`History${e.history_messages?` (${e.history_messages} msgs)`:""}`,tokens:e.history||0,details:null}]:[]}_getBudgetColor(e){return e>90?"red":e>75?"yellow":"green"}_renderBudget(){const e=this._data;if(!e)return l;const t=e.total_tokens||0,r=e.max_input_tokens||1,a=Math.min(100,t/r*100),s=this._getBudgetColor(a);return o`
      <div class="budget-section">
        <div class="budget-header">
          <span class="budget-label">Token Budget</span>
          <span class="budget-values">${d(t)} / ${d(r)}</span>
        </div>
        <div class="budget-bar">
          <div class="budget-bar-fill ${s}" style="width: ${a}%"></div>
        </div>
        <div class="budget-percent">${a.toFixed(1)}% used</div>
      </div>
    `}_renderStackedBar(){var a;const e=this._getCategories(),t=((a=this._data)==null?void 0:a.total_tokens)||1;if(!e.length||t<=0)return l;const r=e.filter(s=>s.tokens>0).map(s=>{var p,n,g;return{key:s.key,pct:s.tokens/t*100,color:((p=m[s.key])==null?void 0:p.bar)||"#666",label:s.key==="symbol_map"?((n=this._data)==null?void 0:n.mode)==="doc"?"Doc Map":"Symbols":((g=m[s.key])==null?void 0:g.label)||s.key,tokens:s.tokens}});return o`
      <div class="stacked-section">
        <div class="stacked-bar">
          ${r.map(s=>o`
            <div class="stacked-segment"
              style="width: ${s.pct}%; background: ${s.color}"
              title="${s.label}: ${d(s.tokens)}">
            </div>
          `)}
        </div>
        <div class="stacked-legend">
          ${r.map(s=>o`
            <span class="legend-item">
              <span class="legend-dot" style="background: ${s.color}"></span>
              <span class="legend-label">${s.label}: ${d(s.tokens)}</span>
            </span>
          `)}
        </div>
      </div>
    `}_renderCategories(){var r;const e=this._getCategories(),t=((r=this._data)==null?void 0:r.total_tokens)||1;return e.length?o`
      <div class="categories">
        ${e.map(a=>{var u;const s=t>0?a.tokens/t*100:0,p=this._expandedSections.has(a.key),n=a.details&&a.details.length>0,g=((u=m[a.key])==null?void 0:u.bar)||"var(--accent-primary)",f=n?Math.max(1,...a.details.map(i=>i.tokens||0)):1;return o`
            <div class="category">
              <div class="category-header ${n?"":"no-expand"}"
                role="${n?"button":l}"
                tabindex="${n?"0":l}"
                aria-expanded="${n?String(p):l}"
                aria-label="${a.name}, ${d(a.tokens)} tokens"
                @click=${()=>n&&this._toggleSection(a.key)}
                @keydown=${i=>{n&&(i.key==="Enter"||i.key===" ")&&(i.preventDefault(),this._toggleSection(a.key))}}>
                <span class="category-toggle" aria-hidden="true">${n?p?"▼":"▶":" "}</span>
                <span class="category-icon">${a.icon}</span>
                <span class="category-name">${a.name}</span>
                <div class="category-bar">
                  <div class="category-bar-fill" style="width: ${s}%; background: ${g}"></div>
                </div>
                <span class="category-tokens">${d(a.tokens)}</span>
              </div>
              ${n?o`
                <div class="category-detail ${p?"expanded":""}">
                  ${a.details.map(i=>{const y=f>0?(i.tokens||0)/f*100:0,x=a.key==="urls"&&i.url;return o`
                      <div class="detail-item ${x?"clickable":""}"
                        @click=${x?()=>this._onUrlItemClick(i.url):l}>
                        <span class="detail-name"
                          title="${i.name||i.path||i.url||"—"}"
                        >${i.name||i.path||i.url||"—"}</span>
                        <div class="detail-bar">
                          <div class="detail-bar-fill" style="width: ${y}%; background: ${g}"></div>
                        </div>
                        <span class="detail-tokens">${d(i.tokens)}</span>
                      </div>
                    `})}
                </div>
              `:l}
            </div>
          `})}
      </div>
    `:l}_renderSessionTotals(){var t;const e=(t=this._data)==null?void 0:t.session_totals;return e?o`
      <div class="session-section">
        <div class="label">Session Totals</div>
        <div class="session-grid">
          <div class="session-item">
            <span>Total</span>
            <span class="session-value">${d(e.total)}</span>
          </div>
          <div class="session-item">
            <span>Prompt In</span>
            <span class="session-value">${d(e.prompt)}</span>
          </div>
          <div class="session-item">
            <span>Cache Read</span>
            <span class="session-value" style="color: ${e.cache_hit>0?"var(--accent-green)":"inherit"}">${d(e.cache_hit)}</span>
          </div>
          <div class="session-item">
            <span>Completion Out</span>
            <span class="session-value">${d(e.completion)}</span>
          </div>
          <div class="session-item">
            <span>Cache Write</span>
            <span class="session-value" style="color: ${e.cache_write>0?"var(--accent-yellow)":"inherit"}">${d(e.cache_write)}</span>
          </div>
        </div>
      </div>
    `:l}render(){return o`
      <div class="toolbar">
        <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 600;">
          Context Budget
          ${this._stale?o`<span class="stale-badge">● stale</span>`:l}
        </span>
        <button class="refresh-btn" @click=${()=>this._refresh()}
          ?disabled=${this._loading}
          aria-label="Refresh context breakdown">↻ Refresh</button>
      </div>

      ${this._renderSessionTotals()}

      ${this._loading&&!this._data?o`
        <div class="loading-indicator">Loading context breakdown...</div>
      `:o`
        ${this._renderBudget()}
        ${this._data?o`
          <div class="model-info">
            <span>Model: ${this._data.model||"—"}${this._data.mode==="doc"?" · 📝 Doc Mode":""}</span>
            ${(()=>{const e=this._data.provider_cache_rate??this._data.cache_hit_rate;return e!=null?o`
                <span>Cache: ${Math.min(100,Math.max(0,e*100)).toFixed(0)}% hit</span>
              `:l})()}
          </div>
        `:l}
        ${this._renderStackedBar()}
        ${this._renderCategories()}
      `}

      <ac-url-content-dialog></ac-url-content-dialog>
    `}}h(b,"properties",{_data:{type:Object,state:!0},_loading:{type:Boolean,state:!0},_expandedSections:{type:Object,state:!0},_stale:{type:Boolean,state:!0}}),h(b,"styles",[w,S,C`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
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
      flex-shrink: 0;
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
  `]);customElements.define("ac-context-tab",b);export{b as AcContextTab,d as formatTokens};
