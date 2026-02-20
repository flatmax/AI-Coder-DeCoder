var l=Object.defineProperty;var d=(a,t,e)=>t in a?l(a,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):a[t]=e;var n=(a,t,e)=>d(a,typeof t!="symbol"?t+"":t,e);import{R as c,i as p,t as f,s as v,a as b,b as o,A as r}from"./index-D67p489G.js";import"./monaco-Bfa5fHnC.js";import"./marked-IDzlF_wn.js";import"./hljs-gJDTAEaL.js";const i=[{type:"litellm",icon:"🤖",label:"LLM Config",format:"json",reloadable:!0},{type:"app",icon:"⚙️",label:"App Config",format:"json",reloadable:!0},{type:"system",icon:"📝",label:"System Prompt",format:"markdown",reloadable:!1},{type:"system_extra",icon:"📎",label:"System Extra",format:"markdown",reloadable:!1},{type:"compaction",icon:"🗜️",label:"Compaction Skill",format:"markdown",reloadable:!1},{type:"snippets",icon:"✂️",label:"Snippets",format:"json",reloadable:!1}];class s extends c(p){constructor(){super(),this._configInfo=null,this._activeCard=null,this._editorContent="",this._loading=!1,this._saving=!1,this._toast=null,this._toastTimer=null,this._onKeyDown=this._onKeyDown.bind(this)}connectedCallback(){super.connectedCallback(),window.addEventListener("keydown",this._onKeyDown)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("keydown",this._onKeyDown)}onRpcReady(){this._loadConfigInfo()}async _loadConfigInfo(){try{const t=await this.rpcExtract("Settings.get_config_info");t&&(this._configInfo=t)}catch(t){console.warn("Failed to load config info:",t)}}_onKeyDown(t){t.ctrlKey&&(t.key==="s"||t.key==="S")&&this._activeCard&&(t.preventDefault(),this._save())}async _openCard(t){if(this._activeCard!==t){this._activeCard=t,this._loading=!0,this._editorContent="";try{const e=await this.rpcExtract("Settings.get_config_content",t);typeof e=="string"?this._editorContent=e:e!=null&&e.content?this._editorContent=e.content:this._editorContent=JSON.stringify(e,null,2)}catch(e){console.warn("Failed to load config:",e),this._editorContent="",this._showToast(`Failed to load: ${e.message||"Unknown error"}`,"error")}finally{this._loading=!1}}}_closeEditor(){this._activeCard=null,this._editorContent=""}_onEditorInput(t){this._editorContent=t.target.value}async _save(){if(!this._activeCard||this._saving||!this.rpcConnected)return;const t=i.find(e=>e.type===this._activeCard);this._saving=!0;try{await this.rpcExtract("Settings.save_config_content",this._activeCard,this._editorContent),this._showToast(`${(t==null?void 0:t.label)||"Config"} saved`,"success"),t!=null&&t.reloadable&&await this._reload()}catch(e){console.warn("Failed to save config:",e),this._showToast(`Save failed: ${e.message||"Unknown error"}`,"error")}finally{this._saving=!1}}async _reload(){if(!this._activeCard||!this.rpcConnected)return;const t=i.find(e=>e.type===this._activeCard);if(t!=null&&t.reloadable)try{this._activeCard==="litellm"?await this.rpcExtract("Settings.reload_llm_config"):this._activeCard==="app"&&await this.rpcExtract("Settings.reload_app_config"),this._showToast(`${t.label} reloaded`,"success"),this._loadConfigInfo()}catch(e){console.warn("Failed to reload config:",e),this._showToast(`Reload failed: ${e.message||"Unknown error"}`,"error")}}_showToast(t,e=""){this._toast={message:t,type:e},clearTimeout(this._toastTimer),this._toastTimer=setTimeout(()=>{this._toast=null},3e3),window.dispatchEvent(new CustomEvent("ac-toast",{detail:{message:t,type:e}}))}_renderInfoBanner(){return this._configInfo?o`
      <div class="info-banner">
        ${this._configInfo.model?o`
          <div class="info-row">
            <span class="info-label">Model</span>
            <span class="info-value">${this._configInfo.model}</span>
          </div>
        `:r}
        ${this._configInfo.smaller_model?o`
          <div class="info-row">
            <span class="info-label">Small Model</span>
            <span class="info-value">${this._configInfo.smaller_model}</span>
          </div>
        `:r}
        ${this._configInfo.config_dir?o`
          <div class="info-row">
            <span class="info-label">Config Dir</span>
            <span class="info-value" title="${this._configInfo.config_dir}">${this._configInfo.config_dir}</span>
          </div>
        `:r}
      </div>
    `:o`
        <div class="info-banner">
          <div class="info-row">
            <span class="info-label">Status</span>
            <span class="info-value">Loading...</span>
          </div>
        </div>
      `}_renderEditor(){if(!this._activeCard)return o`<div class="empty-editor">Select a config to edit</div>`;const t=i.find(e=>e.type===this._activeCard);return o`
      <div class="editor-area">
        <div class="editor-toolbar">
          <div class="editor-title">
            <span class="icon">${(t==null?void 0:t.icon)||"📄"}</span>
            <span class="label">${(t==null?void 0:t.label)||this._activeCard}</span>
          </div>
          ${t!=null&&t.reloadable?o`
            <button class="toolbar-btn" @click=${this._reload}
              ?disabled=${!this.rpcConnected}
              title="Reload config"
              aria-label="Reload ${(t==null?void 0:t.label)||"config"}">↻ Reload</button>
          `:r}
          <button class="toolbar-btn primary" @click=${this._save}
            ?disabled=${this._saving||!this.rpcConnected}
            title="Save (Ctrl+S)"
            aria-label="Save ${(t==null?void 0:t.label)||"config"}">💾 Save</button>
          <button class="toolbar-btn" @click=${this._closeEditor}
            title="Close editor"
            aria-label="Close editor">✕</button>
        </div>
        ${this._loading?o`
          <div class="editor-loading">Loading...</div>
        `:o`
          <textarea
            class="editor-textarea"
            .value=${this._editorContent}
            @input=${this._onEditorInput}
            placeholder="Config content..."
            spellcheck="false"
            aria-label="Configuration editor"
          ></textarea>
        `}
      </div>
    `}render(){return o`
      ${this._renderInfoBanner()}

      <div class="card-grid">
        ${i.map(t=>o`
          <div
            class="config-card ${this._activeCard===t.type?"active":""}"
            role="button"
            tabindex="0"
            aria-pressed="${this._activeCard===t.type}"
            aria-label="${t.label} — ${t.format}"
            @click=${()=>this._openCard(t.type)}
            @keydown=${e=>{(e.key==="Enter"||e.key===" ")&&(e.preventDefault(),this._openCard(t.type))}}
          >
            <div class="card-icon">${t.icon}</div>
            <div class="card-label">${t.label}</div>
            <div class="card-format">${t.format}</div>
          </div>
        `)}
      </div>

      ${this._renderEditor()}

      ${this._toast?o`
        <div class="toast ${this._toast.type}" role="alert">${this._toast.message}</div>
      `:r}
    `}}n(s,"properties",{_configInfo:{type:Object,state:!0},_activeCard:{type:String,state:!0},_editorContent:{type:String,state:!0},_loading:{type:Boolean,state:!0},_saving:{type:Boolean,state:!0},_toast:{type:Object,state:!0}}),n(s,"styles",[f,v,b`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow-y: auto;
    }

    /* Info banner */
    .info-banner {
      padding: 12px 16px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      font-size: 0.8rem;
      color: var(--text-secondary);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .info-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .info-label {
      color: var(--text-muted);
      min-width: 80px;
      flex-shrink: 0;
    }

    .info-value {
      font-family: var(--font-mono);
      color: var(--text-primary);
      font-size: 0.78rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Card grid */
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
      padding: 12px 16px;
    }

    .config-card {
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      padding: 12px;
      cursor: pointer;
      text-align: center;
      transition: border-color 0.15s, background 0.15s;
      user-select: none;
    }
    .config-card:hover {
      border-color: var(--accent-primary);
      background: var(--bg-tertiary);
    }
    .config-card.active {
      border-color: var(--accent-primary);
      background: var(--bg-tertiary);
      box-shadow: 0 0 0 1px var(--accent-primary);
    }

    .card-icon {
      font-size: 1.5rem;
      margin-bottom: 4px;
    }

    .card-label {
      font-size: 0.75rem;
      color: var(--text-secondary);
    }

    .card-format {
      font-size: 0.65rem;
      color: var(--text-muted);
      text-transform: uppercase;
      margin-top: 2px;
    }

    /* Editor area */
    .editor-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      border-top: 1px solid var(--border-primary);
    }

    .editor-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      min-height: 36px;
    }

    .editor-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8rem;
      color: var(--text-secondary);
      flex: 1;
      overflow: hidden;
    }

    .editor-title .icon {
      font-size: 1rem;
      flex-shrink: 0;
    }

    .editor-title .label {
      font-weight: 600;
      white-space: nowrap;
    }

    .editor-title .path {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .toolbar-btn {
      background: none;
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      font-size: 0.75rem;
      padding: 3px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .toolbar-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }
    .toolbar-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .toolbar-btn:disabled:hover {
      background: none;
      color: var(--text-secondary);
      border-color: var(--border-primary);
    }
    .toolbar-btn.primary {
      border-color: var(--accent-primary);
      color: var(--accent-primary);
    }
    .toolbar-btn.primary:hover {
      background: rgba(79, 195, 247, 0.1);
    }

    .editor-textarea {
      flex: 1;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 0.82rem;
      line-height: 1.5;
      padding: 12px 16px;
      border: none;
      outline: none;
      resize: none;
      tab-size: 2;
      min-height: 200px;
    }
    .editor-textarea::placeholder {
      color: var(--text-muted);
    }

    /* Loading */
    .editor-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      padding: 8px 16px;
      font-size: 0.85rem;
      color: var(--text-secondary);
      z-index: 10001;
      box-shadow: var(--shadow-md);
      transition: opacity 0.3s;
    }
    .toast.success { border-color: var(--accent-green); color: var(--accent-green); }
    .toast.error { border-color: var(--accent-red); color: var(--accent-red); }

    /* Empty state */
    .empty-editor {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: var(--text-muted);
      font-size: 0.85rem;
      padding: 24px;
    }
  `]);customElements.define("ac-settings-tab",s);export{s as AcSettingsTab};
