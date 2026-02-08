import{i as u,b as r,R as p,d as f,e as x,a as g}from"./index-KEWF5CLT.js";const m=u`
  :host {
    display: flex;
    flex-direction: column;
    font-size: 13px;
    height: 100%;
  }

  .container {
    background: #1a1a2e;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .search-header {
    padding: 8px 12px;
    background: #0f3460;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .search-input-row {
    display: flex;
    gap: 8px;
  }

  input[type="text"] {
    flex: 1;
    padding: 6px 10px;
    border: none;
    border-radius: 4px;
    background: #16213e;
    color: #eee;
    font-size: 13px;
  }

  input[type="text"]:focus {
    outline: 1px solid #e94560;
  }

  input[type="text"]::placeholder {
    color: #666;
  }

  .search-options {
    display: flex;
    gap: 4px;
  }

  .option-btn {
    padding: 4px 8px;
    border: 1px solid #0f3460;
    border-radius: 4px;
    background: #16213e;
    color: #888;
    cursor: pointer;
    font-size: 11px;
    min-width: 28px;
    text-align: center;
  }

  .option-btn:hover {
    background: #1a3a6e;
    color: #ccc;
  }

  .option-btn.active {
    background: #e94560;
    color: #fff;
    border-color: #e94560;
  }

  .results-summary {
    padding: 6px 12px;
    background: #16213e;
    color: #888;
    font-size: 12px;
    border-bottom: 1px solid #0f3460;
  }

  .results-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    min-height: 0;
  }

  .file-group {
    margin-bottom: 8px;
  }

  .file-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
    color: #7ec699;
    font-weight: 500;
  }

  .file-header:hover {
    background: #0f3460;
  }

  .file-header .icon {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: #666;
    transition: transform 0.15s;
  }

  .file-header .icon.expanded {
    transform: rotate(90deg);
  }

  .file-header .match-count {
    color: #666;
    font-weight: normal;
    font-size: 11px;
    margin-left: auto;
  }

  .match-list {
    margin-left: 20px;
  }

  .match-item {
    display: flex;
    flex-direction: column;
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 12px;
  }

  .match-item:hover,
  .match-item.focused {
    background: #0f3460;
  }

  .match-item.focused {
    outline: 1px solid #e94560;
    outline-offset: -1px;
  }

  .match-row {
    display: flex;
    gap: 8px;
  }

  .line-num {
    color: #666;
    min-width: 36px;
    text-align: right;
    flex-shrink: 0;
  }

  .match-content {
    color: #ccc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .match-content .highlight {
    background: #e9456033;
    color: #e94560;
    border-radius: 2px;
    padding: 0 2px;
  }

  /* Context lines - only shown when item is active */
  .context-lines {
    display: none;
    flex-direction: column;
    margin-top: 2px;
    padding-top: 2px;
    border-top: 1px solid #0f3460;
  }

  .match-item.show-context .context-lines {
    display: flex;
  }

  .context-line {
    display: flex;
    gap: 8px;
    opacity: 0.6;
  }

  .context-line .line-num {
    color: #555;
  }

  .context-line .match-content {
    color: #888;
  }

  .match-line {
    display: flex;
    gap: 8px;
  }

  .match-line .line-num {
    color: #e94560;
  }

  /* Empty states */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
    text-align: center;
    padding: 20px;
    gap: 8px;
  }

  .empty-state .icon {
    font-size: 32px;
    opacity: 0.5;
  }

  .empty-state .hint {
    font-size: 11px;
    color: #555;
  }

  /* Loading state */
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    color: #888;
    gap: 8px;
  }

  .loading .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid #333;
    border-top-color: #e94560;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Error state */
  .error-state {
    padding: 12px;
    color: #e94560;
    background: #3d1a2a;
    border-radius: 4px;
    margin: 8px;
    font-size: 12px;
  }

  .hidden {
    display: none;
  }
`;function v(t){return r`
    <div class="search-options">
      <button 
        class="option-btn ${t.ignoreCase?"":"active"}"
        @click=${()=>t.toggleOption("ignoreCase")}
        title="Match Case"
      >Aa</button>
      <button 
        class="option-btn ${t.useRegex?"active":""}"
        @click=${()=>t.toggleOption("useRegex")}
        title="Use Regular Expression"
      >.*</button>
      <button 
        class="option-btn ${t.wholeWord?"active":""}"
        @click=${()=>t.toggleOption("wholeWord")}
        title="Match Whole Word"
      >W</button>
    </div>
  `}function y(t){return t.isSearching?r`
      <div class="loading">
        <div class="spinner"></div>
        <span>Searching...</span>
      </div>
    `:t.error?r`
      <div class="error-state">
        ⚠ ${t.error}
      </div>
    `:t.query&&t.results.length===0&&t.searchPerformed?r`
      <div class="empty-state">
        <div class="icon">🔍</div>
        <div>No results found</div>
        <div class="hint">for "${t.query}"</div>
      </div>
    `:r`
    <div class="empty-state">
      <div class="icon">🔍</div>
      <div>Type to search across all files</div>
      <div class="hint">Ctrl+Shift+F to focus • ↑↓ to navigate</div>
    </div>
  `}function b(t,e,s,i){if(!e)return t;try{const n=i?"gi":"g",o=s?e:e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),l=new RegExp(`(${o})`,n);return t.split(l).map((d,h)=>h%2===1?r`<span class="highlight">${d}</span>`:d)}catch{return t}}function c(t,e){return!t||t.length===0?"":r`
    ${t.map(s=>r`
      <div class="context-line">
        <span class="line-num">${s.line_num}</span>
        <span class="match-content">${s.line}</span>
      </div>
    `)}
  `}function w(t,e,s,i){const n=t.focusedIndex===i,o=t.hoveredIndex===i,l=n||o,a=s.context_before?.length>0||s.context_after?.length>0;return r`
    <div 
      class="match-item ${n?"focused":""} ${l&&a?"show-context":""}"
      @click=${()=>t.selectResult(e.file,s.line_num)}
      @mouseenter=${()=>t.setHoveredIndex(i)}
      @mouseleave=${()=>t.clearHoveredIndex()}
    >
      ${a?r`
        <div class="context-lines">
          ${c(s.context_before)}
        </div>
      `:""}
      <div class="match-line">
        <span class="line-num">${s.line_num}</span>
        <span class="match-content">
          ${b(s.line,t.query,t.useRegex,t.ignoreCase)}
        </span>
      </div>
      ${a?r`
        <div class="context-lines">
          ${c(s.context_after)}
        </div>
      `:""}
    </div>
  `}function $(t){if(t.results.length===0)return y(t);let e=0;return r`
    ${t.results.map(s=>{const i=s.matches.map(n=>{const o=w(t,s,n,e);return e++,o});return r`
        <div class="file-group">
          <div class="file-header">
            <span 
              class="icon ${t.expandedFiles[s.file]!==!1?"expanded":""}"
              @click=${n=>{n.stopPropagation(),t.toggleFileExpanded(s.file)}}
            >▶</span>
            <span 
              class="file-name"
              @click=${()=>t.openFile(s.file)}
            >${s.file}</span>
            <span class="match-count">(${s.matches.length})</span>
          </div>
          ${t.expandedFiles[s.file]!==!1?r`
            <div class="match-list">
              ${i}
            </div>
          `:""}
        </div>
      `})}
  `}function I(t){return t.reduce((e,s)=>e+s.matches.length,0)}function S(t){const e=I(t.results),s=t.results.length;return r`
    <div class="container">
      <div class="search-header">
        <div class="search-input-row">
          <input
            type="text"
            placeholder="Search in files..."
            .value=${t.query}
            @input=${i=>t.handleSearchInput(i)}
            @keydown=${i=>t.handleKeydown(i)}
          >
        </div>
        ${v(t)}
      </div>
      ${e>0?r`
        <div class="results-summary">
          ${e} result${e!==1?"s":""} in ${s} file${s!==1?"s":""}
        </div>
      `:""}
      <div class="results-list">
        ${$(t)}
      </div>
    </div>
  `}class C extends p(g){static properties={query:{type:String},results:{type:Array},isSearching:{type:Boolean},searchPerformed:{type:Boolean},error:{type:String},ignoreCase:{type:Boolean},useRegex:{type:Boolean},wholeWord:{type:Boolean},expandedFiles:{type:Object},focusedIndex:{type:Number},hoveredIndex:{type:Number}};static styles=m;constructor(){super(),this.query="",this.results=[],this.isSearching=!1,this.searchPerformed=!1,this.error=null,this.expandedFiles={},this._debouncedSearch=f(()=>this.performSearch(),300),this.focusedIndex=-1,this.hoveredIndex=-1;const e=localStorage.getItem("findInFiles.options");if(e)try{const s=JSON.parse(e);this.ignoreCase=s.ignoreCase??!0,this.useRegex=s.useRegex??!1,this.wholeWord=s.wholeWord??!1}catch{this.ignoreCase=!0,this.useRegex=!1,this.wholeWord=!1}else this.ignoreCase=!0,this.useRegex=!1,this.wholeWord=!1}_getFlatMatches(){const e=[];for(const s of this.results)for(const i of s.matches)e.push({file:s.file,match:i});return e}handleSearchInput(e){this.query=e.target.value,this.error=null,this.focusedIndex=-1,this.query.trim()?this._debouncedSearch():(this._debouncedSearch.cancel(),this.results=[],this.searchPerformed=!1,this.isSearching=!1)}handleKeydown(e){const s=this._getFlatMatches();if(e.key==="Escape")this.query?(this.query="",this.results=[],this.searchPerformed=!1,this.focusedIndex=-1):this.dispatchEvent(new CustomEvent("close-search",{bubbles:!0,composed:!0}));else if(e.key==="ArrowDown")e.preventDefault(),s.length>0&&(this.focusedIndex=Math.min(this.focusedIndex+1,s.length-1),this._scrollToFocused());else if(e.key==="ArrowUp")e.preventDefault(),s.length>0&&(this.focusedIndex=Math.max(this.focusedIndex-1,0),this._scrollToFocused());else if(e.key==="Enter"){if(e.preventDefault(),this.focusedIndex>=0&&this.focusedIndex<s.length){const{file:i,match:n}=s[this.focusedIndex];this.selectResult(i,n.line_num)}else if(s.length>0){const{file:i,match:n}=s[0];this.selectResult(i,n.line_num)}}}_scrollToFocused(){this.updateComplete.then(()=>{const e=this.shadowRoot?.querySelector(".match-item.focused");e&&e.scrollIntoView({block:"nearest",behavior:"smooth"})})}setHoveredIndex(e){this.hoveredIndex=e}clearHoveredIndex(){this.hoveredIndex=-1}async performSearch(){if(!this.query.trim()){this.results=[],this.searchPerformed=!1;return}this.isSearching=!0,this.error=null,this.focusedIndex=-1,this._searchGen=(this._searchGen||0)+1;const e=this._searchGen;try{const s=await this._rpc("Repo.search_files",this.query,this.wholeWord,this.useRegex,this.ignoreCase,4);if(e!==this._searchGen)return;const i=x(s);Array.isArray(i)?this.results=i:i?.error?(this.error=i.error,this.results=[]):this.results=[]}catch(s){if(e!==this._searchGen)return;this.error=s.message||"Search failed",this.results=[]}this.isSearching=!1,this.searchPerformed=!0}toggleOption(e){e==="ignoreCase"?this.ignoreCase=!this.ignoreCase:e==="useRegex"?this.useRegex=!this.useRegex:e==="wholeWord"&&(this.wholeWord=!this.wholeWord),localStorage.setItem("findInFiles.options",JSON.stringify({ignoreCase:this.ignoreCase,useRegex:this.useRegex,wholeWord:this.wholeWord})),this.query.trim()&&this.performSearch()}toggleFileExpanded(e){this.expandedFiles={...this.expandedFiles,[e]:this.expandedFiles[e]===!1}}selectResult(e,s){this.dispatchEvent(new CustomEvent("result-selected",{detail:{file:e,line:s},bubbles:!0,composed:!0}))}openFile(e){this.dispatchEvent(new CustomEvent("file-selected",{detail:{file:e},bubbles:!0,composed:!0}))}focusInput(){const e=this.shadowRoot?.querySelector('input[type="text"]');e&&(e.focus(),e.select())}render(){return S(this)}}customElements.define("find-in-files",C);export{C as FindInFiles};
