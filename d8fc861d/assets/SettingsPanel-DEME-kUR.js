import{i as o,b as i,R as a,a as n}from"./index-KEWF5CLT.js";const l=o`
  :host {
    display: block;
    padding: 12px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    color: #e0e0e0;
    height: 100%;
    overflow-y: auto;
  }

  h2 {
    margin: 0 0 16px 0;
    font-size: 14px;
    font-weight: 600;
    color: #fff;
  }

  .section {
    margin-bottom: 20px;
    padding: 12px;
    background: #2a2a2a;
    border-radius: 6px;
    border: 1px solid #3a3a3a;
  }

  .section-title {
    margin: 0 0 12px 0;
    font-size: 12px;
    font-weight: 600;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .config-value {
    margin-bottom: 8px;
    padding: 6px 8px;
    background: #1e1e1e;
    border-radius: 4px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 11px;
    color: #a5d6ff;
    word-break: break-all;
  }

  .config-label {
    font-size: 11px;
    color: #6b7280;
    margin-bottom: 4px;
  }

  .button-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  button {
    padding: 6px 12px;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  button.primary {
    background: #3b82f6;
    color: white;
  }

  button.primary:hover {
    background: #2563eb;
  }

  button.secondary {
    background: #4b5563;
    color: #e5e7eb;
  }

  button.secondary:hover {
    background: #6b7280;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .note {
    margin-top: 8px;
    padding: 8px;
    background: #1e1e1e;
    border-radius: 4px;
    font-size: 11px;
    color: #9ca3af;
    border-left: 2px solid #6b7280;
  }

  .note.info {
    border-left-color: #3b82f6;
  }

  .file-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .file-button {
    justify-content: flex-start;
    background: #374151;
    color: #d1d5db;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 11px;
  }

  .file-button:hover {
    background: #4b5563;
  }

  /* Toast message */
  .toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    z-index: 1000;
    animation: slideIn 0.2s ease;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .toast.success {
    background: #065f46;
    color: #d1fae5;
  }

  .toast.error {
    background: #991b1b;
    color: #fecaca;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .loading {
    opacity: 0.7;
  }
`;function r(e){return e.message?i`
    <div 
      class="toast ${e.message.type}"
      @click=${()=>e.dismissMessage()}
    >
      ${e.message.type==="success"?"✓":"✗"}
      ${e.message.text}
    </div>
  `:""}function d(e){const s=e.configInfo?.model||"Loading...",t=e.configInfo?.smaller_model||"Loading...";return i`
    <div class="section">
      <h3 class="section-title">LLM Configuration</h3>
      
      <div class="config-label">Model</div>
      <div class="config-value">${s}</div>
      
      <div class="config-label">Smaller Model</div>
      <div class="config-value">${t}</div>
      
      <div class="button-row">
        <button 
          class="secondary"
          @click=${()=>e.editConfig("litellm")}
          ?disabled=${e.isLoading}
        >
          📝 Edit litellm.json
        </button>
        <button 
          class="primary"
          @click=${()=>e.reloadLlmConfig()}
          ?disabled=${e.isLoading}
        >
          🔄 Reload
        </button>
      </div>
    </div>
  `}function c(e){return i`
    <div class="section">
      <h3 class="section-title">App Configuration</h3>
      
      <div class="button-row">
        <button 
          class="secondary"
          @click=${()=>e.editConfig("app")}
          ?disabled=${e.isLoading}
        >
          📝 Edit app.json
        </button>
        <button 
          class="primary"
          @click=${()=>e.reloadAppConfig()}
          ?disabled=${e.isLoading}
        >
          🔄 Reload
        </button>
      </div>
      
      <div class="note info">
        ℹ️ Some settings (e.g., cache tier thresholds) may require restart to take effect.
      </div>
    </div>
  `}function f(e){return i`
    <div class="section">
      <h3 class="section-title">Prompts (live-reloaded)</h3>
      
      <div class="file-list">
        <button 
          class="file-button"
          @click=${()=>e.editConfig("system")}
          ?disabled=${e.isLoading}
        >
          📄 system.md
        </button>
        <button 
          class="file-button"
          @click=${()=>e.editConfig("system_extra")}
          ?disabled=${e.isLoading}
        >
          📄 system_extra.md
        </button>
        <button 
          class="file-button"
          @click=${()=>e.editConfig("snippets")}
          ?disabled=${e.isLoading}
        >
          📄 prompt-snippets.json
        </button>
      </div>
      
      <div class="note">
        These files are read fresh on each use. No reload needed.
      </div>
    </div>
  `}function g(e){return i`
    <div class="section">
      <h3 class="section-title">Skills (live-reloaded)</h3>
      
      <div class="file-list">
        <button 
          class="file-button"
          @click=${()=>e.editConfig("compaction")}
          ?disabled=${e.isLoading}
        >
          📄 compaction.md
        </button>
      </div>
      
      <div class="note">
        Skill prompts are read fresh when invoked.
      </div>
    </div>
  `}function u(e){return i`
    <h2>⚙️ Settings</h2>
    
    <div class="${e.isLoading?"loading":""}">
      ${d(e)}
      ${c(e)}
      ${f(e)}
      ${g(e)}
    </div>
    
    ${r(e)}
  `}class p extends a(n){static properties={visible:{type:Boolean},configInfo:{type:Object},isLoading:{type:Boolean},message:{type:Object}};static styles=l;constructor(){super(),this.visible=!1,this.configInfo=null,this.isLoading=!1,this.message=null,this._messageTimeout=null}onRpcReady(){this.visible&&this.loadConfigInfo()}async loadConfigInfo(){if(!(!this.rpcCall||!this.visible))try{this.isLoading=!0;const s=await this._rpcExtract("Settings.get_config_info");s?.success?this.configInfo=s:console.error("Failed to load config info:",s)}catch(s){console.error("Failed to load config info:",s)}finally{this.isLoading=!1}}editConfig(s){this.dispatchEvent(new CustomEvent("config-edit-request",{bubbles:!0,composed:!0,detail:{configType:s}}))}async reloadLlmConfig(){try{this.isLoading=!0;const s=await this._rpcExtract("Settings.reload_llm_config");s?.success?(this._showMessage("success",s.message||"LLM config reloaded"),this.configInfo={...this.configInfo,model:s.model,smaller_model:s.smaller_model}):this._showMessage("error",s?.error||"Failed to reload config")}catch(s){this._showMessage("error",s.message||"Failed to reload config")}finally{this.isLoading=!1}}async reloadAppConfig(){try{this.isLoading=!0;const s=await this._rpcExtract("Settings.reload_app_config");s?.success?this._showMessage("success",s.message||"App config reloaded"):this._showMessage("error",s?.error||"Failed to reload config")}catch(s){this._showMessage("error",s.message||"Failed to reload config")}finally{this.isLoading=!1}}_showMessage(s,t){this.message={type:s,text:t},this._messageTimeout&&clearTimeout(this._messageTimeout),this._messageTimeout=setTimeout(()=>{this.message=null},3e3)}dismissMessage(){this.message=null,this._messageTimeout&&(clearTimeout(this._messageTimeout),this._messageTimeout=null)}render(){return u(this)}}customElements.define("settings-panel",p);export{p as SettingsPanel};
