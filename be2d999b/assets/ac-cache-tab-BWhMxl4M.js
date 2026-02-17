var k=Object.defineProperty;var w=(i,e,t)=>e in i?k(i,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):i[e]=t;var x=(i,e,t)=>w(i,typeof e!="symbol"?e+"":e,t);import{R as L,i as T,t as C,s as S,a as z,A as o,b as r}from"./index-DvwSbsql.js";import"./monaco-DWgZwlcv.js";import"./marked-IDzlF_wn.js";import"./hljs-gJDTAEaL.js";function g(i){return i==null?"—":i>=1e3?(i/1e3).toFixed(1)+"K":String(i)}const E={L0:"#50c878",L1:"#2dd4bf",L2:"#60a5fa",L3:"#f59e0b",active:"#f97316"},F={L0:"L0 · Most Stable",L1:"L1 · Very Stable",L2:"L2 · Stable",L3:"L3 · Entry",active:"Active"},M={system:"⚙️",legend:"📖",symbols:"🗺️",files:"📄",urls:"🔗",history:"💬"};class b extends L(T){constructor(){super(),this._data=null,this._loading=!1,this._expandedTiers=this._loadExpandedTiers(),this._filter="",this._stale=!1,this._onStreamComplete=this._onStreamComplete.bind(this),this._onFilesChanged=this._onFilesChanged.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("stream-complete",this._onStreamComplete),window.addEventListener("files-changed",this._onFilesChanged)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("stream-complete",this._onStreamComplete),window.removeEventListener("files-changed",this._onFilesChanged)}onRpcReady(){this._refresh()}_onStreamComplete(){this._isTabActive()?this._refresh():this._stale=!0}_onFilesChanged(){this._isTabActive()?this._refresh():this._stale=!0}_isTabActive(){const e=this.parentElement;return e&&e.classList.contains("tab-panel")?e.classList.contains("active"):this.offsetParent!==null}onTabVisible(){this._stale&&(this._stale=!1,this._refresh())}async _refresh(){if(!(!this.rpcConnected||this._loading)){this._loading=!0,this._stale=!1;try{const e=await this.rpcExtract("LLMService.get_context_breakdown");e&&(this._data=e)}catch(e){console.warn("Failed to load cache data:",e)}finally{this._loading=!1}}}_toggleTier(e){const t=new Set(this._expandedTiers);t.has(e)?t.delete(e):t.add(e),this._expandedTiers=t,this._saveExpandedTiers(t)}_saveExpandedTiers(e){try{localStorage.setItem("ac-dc-cache-expanded",JSON.stringify([...e]))}catch{}}_loadExpandedTiers(){try{const e=localStorage.getItem("ac-dc-cache-expanded");if(e)return new Set(JSON.parse(e))}catch{}return new Set(["L0","L1","L2","L3","active"])}_onFilterInput(e){this._filter=e.target.value}_fuzzyMatch(e,t){if(!t)return!0;const n=e.toLowerCase(),d=t.toLowerCase();let a=0;for(let p=0;p<n.length&&a<d.length;p++)n[p]===d[a]&&a++;return a===d.length}_renderPerformance(){const e=this._data;if(!e)return o;const t=e.provider_cache_rate??e.cache_hit_rate??0,n=Math.min(100,Math.max(0,t*100)).toFixed(0);return r`
      <div class="perf-section">
        <div class="perf-header">
          <span class="perf-label">Cache Performance</span>
          <span class="perf-value">${n}% hit rate</span>
        </div>
        <div class="perf-bar">
          <div class="perf-bar-fill" style="width: ${Math.min(100,Math.max(0,t*100))}%"></div>
        </div>
      </div>
    `}_renderChanges(){const e=this._data,t=(e==null?void 0:e.promotions)||[],n=(e==null?void 0:e.demotions)||[];if(t.length===0&&n.length===0)return o;const d=[...t.map(a=>({icon:"📈",text:a})),...n.map(a=>({icon:"📉",text:a}))];return r`
      <div class="changes-section">
        <div class="changes-label">Recent Changes</div>
        ${d.slice(0,10).map(a=>r`
          <div class="change-item">
            <span class="change-icon">${a.icon}</span>
            ${a.text}
          </div>
        `)}
      </div>
    `}_renderTierBlock(e){const t=e.tier||e.name||"unknown",n=F[t]||t,d=E[t]||"#888",a=this._expandedTiers.has(t),p=e.cached,v=e.tokens||0,h=(e.contents||[]).filter(l=>{const m=l.name||l.path||l.type||"";return this._fuzzyMatch(m,this._filter)});return this._filter&&h.length===0?o:r`
      <div class="tier-block">
        <div class="tier-header" role="button" tabindex="0"
             aria-expanded="${a}" aria-label="${n}, ${g(v)} tokens"
             @click=${()=>this._toggleTier(t)}
             @keydown=${l=>{(l.key==="Enter"||l.key===" ")&&(l.preventDefault(),this._toggleTier(t))}}>
          <span class="tier-toggle" aria-hidden="true">${a?"▼":"▶"}</span>
          <span class="tier-dot" style="background: ${d}" aria-hidden="true"></span>
          <span class="tier-name">${n} (${h.length})</span>
          <span class="tier-tokens">${g(v)}</span>
          ${p?r`<span class="tier-cached-badge" aria-label="Cached">🔒</span>`:o}
        </div>
        <div class="tier-contents ${a?"expanded":""}">
          ${(()=>{const l=h.filter(s=>s.tokens>0),m=h.filter(s=>!s.tokens);return r`
              ${l.map(s=>{const y=M[s.type]||"📄",u=s.name||s.path||"—",_=s.tokens||0,c=s.n!=null?s.n:null,f=s.threshold||e.threshold,$=c!=null&&f?Math.min(100,c/f*100):0;return r`
                  <div class="tier-item">
                    <span class="item-icon">${y}</span>
                    <span class="item-name" title="${u}">${u}</span>
                    <span class="item-tokens">${g(_)}</span>
                    ${c!=null?r`
                      <div class="stability-bar" title="N=${c}/${f||"?"}">
                        <div class="stability-bar-fill" style="width: ${$}%; background: ${d}"></div>
                      </div>
                      <span class="item-n" title="N=${c}/${f||"?"}">${c}/${f||"?"}</span>
                    `:o}
                  </div>
                `})}
              ${m.length>0?r`
                <div class="tier-item">
                  <span class="item-icon">📦</span>
                  <span class="item-name" style="color: var(--text-muted); font-style: italic;"
                    >${m.length} pre-indexed symbols (awaiting measurement)</span>
                </div>
              `:o}
              ${h.length===0?r`
                <div class="tier-item">
                  <span class="item-name" style="color: var(--text-muted); font-style: italic;">Empty</span>
                </div>
              `:o}
            `})()}
        </div>
      </div>
    `}_renderTiers(){var t;const e=(t=this._data)==null?void 0:t.blocks;return!e||e.length===0?o:r`
      <div class="tiers">
        ${e.map(n=>this._renderTierBlock(n))}
      </div>
    `}_renderFooter(){const e=this._data;return e?r`
      <div class="footer">
        <span>Model: ${e.model||"—"}</span>
        <span>Total: ${g(e.total_tokens)}</span>
      </div>
    `:o}render(){return r`
      ${this._renderPerformance()}

      <div class="toolbar">
        <input
          class="filter-input"
          type="text"
          placeholder="Filter items..."
          aria-label="Filter cache items"
          .value=${this._filter}
          @input=${this._onFilterInput}
        >
        ${this._stale?r`<span class="stale-badge" aria-label="Data is stale">● stale</span>`:o}
        <button class="refresh-btn" @click=${()=>this._refresh()}
          ?disabled=${this._loading}
          aria-label="Refresh cache data">↻</button>
      </div>

      ${this._loading&&!this._data?r`
        <div class="loading-indicator">Loading cache data...</div>
      `:r`
        ${this._renderTiers()}
        ${this._renderChanges()}
        ${this._renderFooter()}
      `}
    `}}x(b,"properties",{_data:{type:Object,state:!0},_loading:{type:Boolean,state:!0},_expandedTiers:{type:Object,state:!0},_filter:{type:String,state:!0},_stale:{type:Boolean,state:!0}}),x(b,"styles",[C,S,z`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow-y: auto;
    }

    /* Performance header */
    .perf-section {
      padding: 12px 16px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
    }

    .perf-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }

    .perf-label {
      font-size: 0.85rem;
      color: var(--text-secondary);
      font-weight: 600;
    }

    .perf-value {
      font-family: var(--font-mono);
      font-size: 0.9rem;
      color: var(--accent-green);
    }

    .perf-bar {
      height: 8px;
      background: var(--bg-primary);
      border-radius: 4px;
      overflow: hidden;
    }

    .perf-bar-fill {
      height: 100%;
      background: var(--accent-green);
      border-radius: 3px;
      transition: width 0.3s;
    }

    /* Toolbar */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--border-primary);
      background: var(--bg-secondary);
    }

    .filter-input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 0.85rem;
      padding: 5px 10px;
      outline: none;
    }
    .filter-input:focus {
      border-color: var(--accent-primary);
    }
    .filter-input::placeholder {
      color: var(--text-muted);
    }

    .refresh-btn {
      background: none;
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.75rem;
      padding: 3px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .refresh-btn:hover {
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }

    .stale-badge {
      font-size: 0.75rem;
      color: var(--accent-orange);
    }

    /* Recent changes */
    .changes-section {
      padding: 10px 16px;
      border-bottom: 1px solid var(--border-primary);
      font-size: 0.82rem;
    }

    .changes-label {
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.72rem;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }

    .change-item {
      padding: 3px 0;
      color: var(--text-secondary);
    }

    .change-icon { margin-right: 4px; }

    /* Tier blocks */
    .tiers {
      flex: 1;
      overflow-y: auto;
    }

    .tier-block {
      border-bottom: 1px solid var(--border-primary);
    }

    .tier-header {
      display: flex;
      align-items: center;
      padding: 8px 16px;
      cursor: pointer;
      user-select: none;
      gap: 8px;
      transition: background 0.15s;
    }
    .tier-header:hover {
      background: var(--bg-tertiary);
    }

    .tier-toggle {
      font-size: 0.6rem;
      color: var(--text-muted);
      width: 12px;
      flex-shrink: 0;
    }

    .tier-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .tier-name {
      font-size: 0.85rem;
      color: var(--text-secondary);
      flex: 1;
    }

    .tier-tokens {
      font-family: var(--font-mono);
      font-size: 0.82rem;
      color: var(--accent-green);
      flex-shrink: 0;
    }

    .tier-cached-badge {
      font-size: 0.7rem;
      padding: 2px 8px;
      border-radius: 8px;
      background: rgba(80, 200, 120, 0.15);
      color: var(--accent-green);
      flex-shrink: 0;
    }

    /* Tier contents */
    .tier-contents {
      display: none;
      padding: 4px 16px 10px 36px;
    }
    .tier-contents.expanded {
      display: block;
    }

    .tier-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 0;
      font-size: 0.82rem;
    }

    .item-icon {
      flex-shrink: 0;
      width: 18px;
      text-align: center;
    }

    .item-name {
      flex: 1;
      font-family: var(--font-mono);
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-tokens {
      font-family: var(--font-mono);
      color: var(--accent-green);
      font-size: 0.8rem;
      flex-shrink: 0;
      min-width: 5ch;
      text-align: right;
    }

    /* Stability bar */
    .stability-bar {
      width: 48px;
      height: 6px;
      background: var(--bg-primary);
      border-radius: 3px;
      overflow: hidden;
      flex-shrink: 0;
    }

    .stability-bar-fill {
      height: 100%;
      border-radius: 3px;
    }

    .item-n {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--text-secondary);
      flex-shrink: 0;
      min-width: 5ch;
      text-align: right;
    }

    /* Footer */
    .footer {
      padding: 10px 16px;
      border-top: 1px solid var(--border-primary);
      background: var(--bg-tertiary);
      font-size: 0.8rem;
      color: var(--text-secondary);
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 4px;
    }

    .footer span {
      font-family: var(--font-mono);
    }

    /* Loading */
    .loading-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: var(--text-muted);
      font-size: 0.85rem;
    }
  `]);customElements.define("ac-cache-tab",b);export{b as AcCacheTab};
