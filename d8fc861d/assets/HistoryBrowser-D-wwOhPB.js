import{i as r,b as t,f as a,t as n,R as l,d,a as c}from"./index-KEWF5CLT.js";const h=r`
  :host {
    display: block;
  }

  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal {
    background: #1a1a2e;
    border-radius: 12px;
    width: 90vw;
    max-width: 1000px;
    height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    border: 1px solid #0f3460;
  }

  .header {
    display: flex;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid #0f3460;
    gap: 12px;
  }

  .header h2 {
    margin: 0;
    color: #e94560;
    font-size: 18px;
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid #0f3460;
    border-radius: 6px;
    background: #16213e;
    color: #eee;
    font-size: 14px;
  }

  .search-input:focus {
    outline: none;
    border-color: #e94560;
  }

  .load-session-btn {
    background: #e94560;
    border: none;
    border-radius: 6px;
    color: white;
    padding: 8px 16px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: background 0.2s;
  }

  .load-session-btn:hover {
    background: #d63850;
  }

  .close-btn {
    background: none;
    border: none;
    color: #888;
    font-size: 24px;
    cursor: pointer;
    padding: 4px 8px;
  }

  .close-btn:hover {
    color: #e94560;
  }

  .content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .sessions-panel {
    width: 300px;
    border-right: 1px solid #0f3460;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .messages-panel {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .session-item {
    padding: 12px 16px;
    border-bottom: 1px solid #0f3460;
    cursor: pointer;
    transition: background 0.2s;
  }

  .session-item:hover {
    background: #0f3460;
  }

  .session-item.selected {
    background: #0f3460;
    border-left: 3px solid #e94560;
  }

  .session-date {
    font-size: 11px;
    color: #888;
    margin-bottom: 4px;
  }

  .session-preview {
    font-size: 13px;
    color: #ccc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .session-count {
    font-size: 11px;
    color: #666;
    margin-top: 4px;
  }

  .message-card {
    background: #16213e;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
    border: 1px solid #0f3460;
  }

  .message-card.user {
    margin-left: 40px;
    background: #0f3460;
  }

  .message-card.assistant {
    margin-right: 40px;
  }

  .message-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .message-role {
    font-size: 11px;
    color: #e94560;
    font-weight: 600;
    text-transform: uppercase;
  }

  .message-time {
    font-size: 11px;
    color: #666;
  }

  .message-content {
    color: #eee;
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .message-actions {
    display: flex;
    gap: 4px;
    margin-top: 8px;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .message-card:hover .message-actions {
    opacity: 1;
  }

  .action-btn {
    background: #1a1a2e;
    border: 1px solid #0f3460;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 11px;
    color: #888;
  }

  .action-btn:hover {
    background: #0f3460;
    color: #e94560;
  }

  .files-list {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #0f3460;
  }

  .files-label {
    font-size: 11px;
    color: #888;
    margin-bottom: 4px;
  }

  .file-tag {
    display: inline-block;
    background: #0f3460;
    color: #7ec699;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 11px;
    margin-right: 4px;
    margin-bottom: 4px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
  }

  .empty-state .icon {
    font-size: 48px;
    margin-bottom: 12px;
    opacity: 0.5;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    color: #888;
  }

  .search-results-header {
    padding: 12px 16px;
    background: #0f3460;
    color: #e94560;
    font-size: 13px;
    font-weight: 600;
  }

  .search-result-item {
    padding: 12px 16px;
    border-bottom: 1px solid #0f3460;
    cursor: pointer;
  }

  .search-result-item:hover {
    background: #0f3460;
  }

  .search-result-session {
    font-size: 11px;
    color: #888;
    margin-bottom: 4px;
  }

  .search-result-content {
    font-size: 13px;
    color: #ccc;
  }

  .search-highlight {
    background: #e94560;
    color: white;
    padding: 0 2px;
    border-radius: 2px;
  }

  .message-card.highlight {
    animation: highlight-pulse 2s ease-out;
  }

  @keyframes highlight-pulse {
    0% {
      box-shadow: 0 0 0 3px #e94560;
      background: #2a1a3e;
    }
    100% {
      box-shadow: 0 0 0 0 transparent;
      background: #16213e;
    }
  }
`;function p(e){return e.isSearching&&e.searchResults.length>0?t`
      <div class="search-results-header">
        Search Results (${e.searchResults.length})
      </div>
      ${e.searchResults.map(s=>t`
        <div 
          class="search-result-item"
          @click=${()=>e.selectSession(s.session_id,s.id)}
        >
          <div class="search-result-session">
            ${a(s.timestamp)} · ${s.role}
          </div>
          <div class="search-result-content">
            ${n(s.content,150)}
          </div>
        </div>
      `)}
    `:e.sessions.length===0?t`
      <div class="empty-state">
        <div class="icon">📭</div>
        <div>No conversation history</div>
      </div>
    `:e.sessions.map(s=>t`
    <div 
      class="session-item ${e.selectedSessionId===s.session_id?"selected":""}"
      @click=${()=>e.selectSession(s.session_id)}
    >
      <div class="session-date">${a(s.timestamp)}</div>
      <div class="session-preview">${s.preview}</div>
      <div class="session-count">${s.message_count} messages</div>
    </div>
  `)}function u(e){return e.selectedSessionId?e.isLoading?t`<div class="loading">Loading...</div>`:e.selectedSession.length===0?t`
      <div class="empty-state">
        <div class="icon">📭</div>
        <div>No messages in this session</div>
      </div>
    `:e.selectedSession.map(s=>t`
    <div class="message-card ${s.role}" data-message-id="${s.id}">
      <div class="message-header">
        <span class="message-role">${s.role}</span>
        <span class="message-time">${a(s.timestamp)}</span>
      </div>
      <div class="message-content">
        ${s.role==="assistant"?t`<card-markdown .content=${s.content} role="assistant"></card-markdown>`:s.content}
      </div>
      ${s.files&&s.files.length>0?t`
        <div class="files-list">
          <div class="files-label">Files in context:</div>
          ${s.files.map(i=>t`<span class="file-tag">${i}</span>`)}
        </div>
      `:""}
      ${s.files_modified&&s.files_modified.length>0?t`
        <div class="files-list">
          <div class="files-label">Files modified:</div>
          ${s.files_modified.map(i=>t`<span class="file-tag">${i}</span>`)}
        </div>
      `:""}
      <div class="message-actions">
        <button class="action-btn" @click=${()=>e.copyToClipboard(s.content)} title="Copy to clipboard">
          📋 Copy
        </button>
        <button class="action-btn" @click=${()=>e.copyToPrompt(s.content)} title="Paste to prompt">
          ↩️ To Prompt
        </button>
      </div>
    </div>
  `):t`
      <div class="empty-state">
        <div class="icon">👈</div>
        <div>Select a session to view messages</div>
      </div>
    `}function g(e){return e.visible?t`
    <div class="overlay" @click=${s=>{s.target.classList.contains("overlay")&&e.hide()}}>
      <div class="modal">
        <div class="header">
          <h2>📜 Conversation History</h2>
          <input
            type="text"
            class="search-input"
            placeholder="Search messages..."
            .value=${e.searchQuery}
            @input=${s=>e.handleSearchInput(s)}
          >
          ${e.selectedSessionId&&e.selectedSession.length>0?t`
            <button 
              class="load-session-btn" 
              @click=${()=>e.loadSessionToChat()}
              title="Replace current chat with this session"
            >
              📥 Load Session
            </button>
          `:""}
          <button class="close-btn" @click=${()=>e.hide()}>×</button>
        </div>
        <div class="content">
          <div class="sessions-panel">
            ${e.isLoading&&!e.selectedSessionId?t`
              <div class="loading">Loading sessions...</div>
            `:p(e)}
          </div>
          <div class="messages-panel">
            ${u(e)}
          </div>
        </div>
      </div>
    </div>
  `:t``}class f extends l(c){static properties={visible:{type:Boolean},sessions:{type:Array},selectedSessionId:{type:String},selectedSession:{type:Array},searchQuery:{type:String},searchResults:{type:Array},isSearching:{type:Boolean},isLoading:{type:Boolean}};static styles=h;constructor(){super(),this.visible=!1,this.sessions=[],this.selectedSessionId=null,this.selectedSession=[],this.searchQuery="",this.searchResults=[],this.isSearching=!1,this.isLoading=!1,this._debouncedSearch=d(()=>this.performSearch(),300),this._messagesScrollTop=0,this._sessionsScrollTop=0,this._sessionsLoadedAt=0,this._sessionsCacheTTL=1e4}onRpcReady(){this.visible&&this.loadSessions()}async show(){this.visible=!0,this.loadSessions(),this.updateComplete.then(()=>{const s=this.shadowRoot?.querySelector(".messages-panel"),i=this.shadowRoot?.querySelector(".sessions-panel");s&&(s.scrollTop=this._messagesScrollTop),i&&(i.scrollTop=this._sessionsScrollTop)})}hide(){const s=this.shadowRoot?.querySelector(".messages-panel"),i=this.shadowRoot?.querySelector(".sessions-panel");s&&(this._messagesScrollTop=s.scrollTop),i&&(this._sessionsScrollTop=i.scrollTop),this.visible=!1}async loadSessions(s=!1){const i=Date.now();if(!s&&this.sessions.length>0&&i-this._sessionsLoadedAt<this._sessionsCacheTTL)return;const o=await this._rpcWithState("LiteLLM.history_list_sessions",{},50);this.sessions=o||[],this._sessionsLoadedAt=Date.now()}async selectSession(s,i=null){if(this.selectedSessionId!==s){this.selectedSessionId=s;const o=await this._rpcWithState("LiteLLM.history_get_session",{},s);this.selectedSession=o||[]}i&&this._scrollToMessage(i)}_scrollToMessage(s){this.updateComplete.then(()=>{const i=this.shadowRoot?.querySelector(`[data-message-id="${s}"]`);i&&(i.scrollIntoView({behavior:"smooth",block:"center"}),i.classList.add("highlight"),setTimeout(()=>i.classList.remove("highlight"),2e3))})}handleSearchInput(s){this.searchQuery=s.target.value,this.searchQuery.trim()?this._debouncedSearch():(this._debouncedSearch.cancel(),this.searchResults=[],this.isSearching=!1)}async performSearch(){if(!this.searchQuery.trim()){this.searchResults=[],this.isSearching=!1;return}this.isSearching=!0,this._searchGen=(this._searchGen||0)+1;const s=this._searchGen,i=await this._rpcWithState("LiteLLM.history_search",{},this.searchQuery,null,100);s===this._searchGen&&(this.searchResults=i||[])}copyToClipboard(s){navigator.clipboard.writeText(s)}copyToPrompt(s){this.dispatchEvent(new CustomEvent("copy-to-prompt",{detail:{content:s},bubbles:!0,composed:!0}))}loadSessionToChat(){!this.selectedSession||this.selectedSession.length===0||(this._sessionsLoadedAt=0,this.dispatchEvent(new CustomEvent("load-session",{detail:{messages:this.selectedSession,sessionId:this.selectedSessionId},bubbles:!0,composed:!0})),this.hide())}render(){return g(this)}}customElements.define("history-browser",f);export{f as HistoryBrowser};
