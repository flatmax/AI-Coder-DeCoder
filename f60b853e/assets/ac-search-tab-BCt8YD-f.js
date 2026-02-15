var x=Object.defineProperty;var m=(a,e,t)=>e in a?x(a,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):a[e]=t;var l=(a,e,t)=>m(a,typeof e!="symbol"?e+"":e,t);import{R as v,i as y,t as b,s as w,a as $,A as u,b as i,o as M}from"./index-BRtyxolr.js";import"./monaco-Cct0x5e0.js";import"./marked-IDzlF_wn.js";import"./hljs-TiioHWPY.js";const p="ac-dc-search-ignore-case",g="ac-dc-search-regex",_="ac-dc-search-whole-word";function n(a){return a.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}class c extends v(y){constructor(){super(),this._query="",this._ignoreCase=this._loadBool(p,!0),this._useRegex=this._loadBool(g,!1),this._wholeWord=this._loadBool(_,!1),this._results=[],this._loading=!1,this._expandedFiles=new Set,this._focusedIndex=-1,this._flatMatches=[],this._debounceTimer=null,this._generation=0}_loadBool(e,t){try{const s=localStorage.getItem(e);return s===null?t:s==="true"}catch{return t}}_saveBool(e,t){try{localStorage.setItem(e,String(t))}catch{}}focus(){requestAnimationFrame(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".search-input");e&&(e.focus(),e.select())})}prefill(e){e&&typeof e=="string"&&(this._query=e,this._runSearch(),this.focus())}_onInput(e){this._query=e.target.value,this._debounceSearch()}_debounceSearch(){clearTimeout(this._debounceTimer),this._debounceTimer=setTimeout(()=>this._runSearch(),300)}async _runSearch(){const e=this._query.trim();if(!e){this._results=[],this._flatMatches=[],this._focusedIndex=-1;return}if(!this.rpcConnected)return;this._loading=!0;const t=++this._generation;try{const s=await this.rpcExtract("Repo.search_files",e,this._wholeWord,this._useRegex,this._ignoreCase,1);if(t!==this._generation)return;Array.isArray(s)?this._results=s:s!=null&&s.results&&Array.isArray(s.results)?this._results=s.results:this._results=[],this._expandedFiles=new Set(this._results.map(r=>r.file)),this._buildFlatMatches(),this._focusedIndex=-1}catch(s){if(t!==this._generation)return;console.warn("Search failed:",s),this._results=[],this._flatMatches=[]}finally{t===this._generation&&(this._loading=!1)}}_buildFlatMatches(){const e=[];for(const t of this._results)if(this._expandedFiles.has(t.file))for(const s of t.matches||[])e.push({file:t.file,match:s});this._flatMatches=e}_toggleIgnoreCase(){this._ignoreCase=!this._ignoreCase,this._saveBool(p,this._ignoreCase),this._runSearch()}_toggleRegex(){this._useRegex=!this._useRegex,this._saveBool(g,this._useRegex),this._runSearch()}_toggleWholeWord(){this._wholeWord=!this._wholeWord,this._saveBool(_,this._wholeWord),this._runSearch()}_toggleFile(e){const t=new Set(this._expandedFiles);t.has(e)?t.delete(e):t.add(e),this._expandedFiles=t,this._buildFlatMatches()}_onKeyDown(e){var t;if(e.key==="ArrowDown")e.preventDefault(),this._flatMatches.length>0&&(this._focusedIndex=Math.min(this._focusedIndex+1,this._flatMatches.length-1),this._scrollToFocused());else if(e.key==="ArrowUp")e.preventDefault(),this._flatMatches.length>0&&(this._focusedIndex=Math.max(this._focusedIndex-1,0),this._scrollToFocused());else if(e.key==="Enter")e.preventDefault(),this._focusedIndex>=0&&this._focusedIndex<this._flatMatches.length?this._navigateToMatch(this._flatMatches[this._focusedIndex]):this._flatMatches.length>0&&(this._focusedIndex=0,this._navigateToMatch(this._flatMatches[0]));else if(e.key==="Escape"&&this._query){this._query="",this._results=[],this._flatMatches=[],this._focusedIndex=-1;const s=(t=this.shadowRoot)==null?void 0:t.querySelector(".search-input");s&&(s.value="")}}_scrollToFocused(){requestAnimationFrame(()=>{var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelector(".match-row.focused");e&&e.scrollIntoView({block:"nearest"})})}_navigateToMatch(e){e&&this.dispatchEvent(new CustomEvent("search-navigate",{detail:{path:e.file,line:e.match.line_num},bubbles:!0,composed:!0}))}_onMatchClick(e,t){const s=this._flatMatches.findIndex(r=>r.file===e&&r.match.line_num===t.line_num);s>=0&&(this._focusedIndex=s),this._navigateToMatch({file:e,match:t})}_onFileHeaderClick(e){this._toggleFile(e)}_highlightMatch(e,t){if(!t)return n(e);try{let s;if(this._useRegex)s=t;else{const o=t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");s=this._wholeWord?`\\b${o}\\b`:o}const r=this._ignoreCase?"gi":"g",h=new RegExp(`(${s})`,r);return e.split(h).map((o,f)=>f%2===1?`<span class="match-highlight">${n(o)}</span>`:n(o)).join("")}catch{return n(e)}}_totalMatches(){let e=0;for(const t of this._results)e+=(t.matches||[]).length;return e}_renderContextLines(e){return!e||e.length===0?u:e.map(t=>i`
      <div class="context-row">
        <span class="context-line-num">${t.line_num}</span>
        <span class="context-text">${t.line}</span>
      </div>
    `)}_renderFileGroup(e){const t=this._expandedFiles.has(e.file),s=(e.matches||[]).length;return i`
      <div class="file-group">
        <div class="file-header" @click=${()=>this._onFileHeaderClick(e.file)}>
          <span class="file-toggle">${t?"▼":"▶"}</span>
          <span class="file-path">${e.file}</span>
          <span class="match-count">${s}</span>
        </div>
        <div class="match-list ${t?"expanded":""}">
          ${(e.matches||[]).map(r=>{const d=this._flatMatches.findIndex(o=>o.file===e.file&&o.match.line_num===r.line_num)===this._focusedIndex;return i`
              ${this._renderContextLines(r.context_before)}
              <div
                class="match-row ${d?"focused":""}"
                @click=${()=>this._onMatchClick(e.file,r)}
              >
                <span class="match-line-num">${r.line_num}</span>
                <span class="match-text">${M(this._highlightMatch(r.line,this._query.trim()))}</span>
              </div>
              ${this._renderContextLines(r.context_after)}
            `})}
        </div>
      </div>
    `}render(){const e=this._totalMatches(),t=this._results.length;return i`
      <div class="search-header">
        <div class="search-input-row">
          <input
            class="search-input"
            type="text"
            placeholder="Search files..."
            aria-label="Search repository files"
            .value=${this._query}
            @input=${this._onInput}
            @keydown=${this._onKeyDown}
          >
          ${e>0?i`
            <span class="result-count" aria-live="polite">${e} in ${t} files</span>
          `:u}
        </div>
        <div class="search-toggles">
          <button
            class="toggle-btn ${this._ignoreCase?"active":""}"
            @click=${this._toggleIgnoreCase}
            title="Ignore case"
            aria-label="Toggle ignore case"
            aria-pressed="${this._ignoreCase}"
          >Aa</button>
          <button
            class="toggle-btn ${this._useRegex?"active":""}"
            @click=${this._toggleRegex}
            title="Use regex"
            aria-label="Toggle regex search"
            aria-pressed="${this._useRegex}"
          >.*</button>
          <button
            class="toggle-btn ${this._wholeWord?"active":""}"
            @click=${this._toggleWholeWord}
            title="Whole word"
            aria-label="Toggle whole word match"
            aria-pressed="${this._wholeWord}"
          >ab</button>
        </div>
      </div>

      <div class="results" role="region" aria-label="Search results" @keydown=${this._onKeyDown} tabindex="-1">
        ${this._loading?i`
          <div class="loading">Searching...</div>
        `:this._results.length===0?i`
          ${this._query.trim()?i`
            <div class="no-results">No results found</div>
          `:i`
            <div class="no-results">Type to search across files</div>
          `}
        `:i`
          ${this._results.map(s=>this._renderFileGroup(s))}
        `}
      </div>
    `}}l(c,"properties",{_query:{type:String,state:!0},_ignoreCase:{type:Boolean,state:!0},_useRegex:{type:Boolean,state:!0},_wholeWord:{type:Boolean,state:!0},_results:{type:Array,state:!0},_loading:{type:Boolean,state:!0},_expandedFiles:{type:Object,state:!0},_focusedIndex:{type:Number,state:!0},_flatMatches:{type:Array,state:!0}}),l(c,"styles",[b,w,$`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    /* Search header */
    .search-header {
      padding: 8px 12px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-primary);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .search-input-row {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .search-input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 0.85rem;
      padding: 6px 10px;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--accent-primary);
    }
    .search-input:focus {
      border-color: var(--accent-primary);
    }
    .search-input::placeholder {
      color: var(--text-muted);
    }

    .search-toggles {
      display: flex;
      gap: 4px;
    }

    .toggle-btn {
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.7rem;
      font-family: var(--font-mono);
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      user-select: none;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .toggle-btn:hover {
      color: var(--text-secondary);
    }
    .toggle-btn.active {
      background: var(--accent-primary);
      border-color: var(--accent-primary);
      color: var(--bg-primary);
    }

    .result-count {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-left: auto;
      white-space: nowrap;
    }

    /* Results */
    .results {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    .no-results {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    /* File group */
    .file-group {
      border-bottom: 1px solid var(--border-primary);
    }

    .file-header {
      display: flex;
      align-items: center;
      padding: 6px 12px;
      cursor: pointer;
      user-select: none;
      gap: 6px;
      background: var(--bg-tertiary);
      font-size: 0.8rem;
    }
    .file-header:hover {
      background: var(--bg-secondary);
    }

    .file-toggle {
      font-size: 0.6rem;
      color: var(--text-muted);
      width: 12px;
      flex-shrink: 0;
    }

    .file-path {
      font-family: var(--font-mono);
      color: var(--accent-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .match-count {
      font-size: 0.7rem;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    /* Match rows */
    .match-list {
      display: none;
    }
    .match-list.expanded {
      display: block;
    }

    .match-row {
      display: flex;
      padding: 3px 12px 3px 30px;
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: 0.78rem;
      line-height: 1.6;
      gap: 8px;
      border-left: 2px solid transparent;
    }
    .match-row:hover {
      background: var(--bg-tertiary);
    }
    .match-row.focused {
      background: var(--bg-tertiary);
      border-left-color: var(--accent-primary);
    }

    .match-line-num {
      color: var(--text-muted);
      min-width: 4ch;
      text-align: right;
      flex-shrink: 0;
      user-select: none;
    }

    .match-text {
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .match-highlight {
      background: rgba(255, 200, 50, 0.25);
      color: var(--text-primary);
      border-radius: 2px;
      padding: 0 1px;
    }

    /* Context lines */
    .context-row {
      display: flex;
      padding: 1px 12px 1px 30px;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      gap: 8px;
      opacity: 0.5;
    }
    .context-line-num {
      color: var(--text-muted);
      min-width: 4ch;
      text-align: right;
      flex-shrink: 0;
    }
    .context-text {
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Loading */
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: var(--text-muted);
      font-size: 0.85rem;
    }
  `]);customElements.define("ac-search-tab",c);export{c as AcSearchTab};
