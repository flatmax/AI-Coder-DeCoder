import{M as l,m as r,i as o,b as s}from"./index-KEWF5CLT.js";const d={breakdown:{type:Object},isLoading:{type:Boolean},error:{type:String},selectedUrl:{type:String},showUrlModal:{type:Boolean},urlContent:{type:Object},showSymbolMapModal:{type:Boolean},symbolMapContent:{type:String},isLoadingSymbolMap:{type:Boolean},selectedFiles:{type:Array},fetchedUrls:{type:Array},excludedUrls:{type:Object}},h=i=>class extends i{initViewerData(){this.breakdown=null,this.isLoading=!1,this.error=null,this._breakdownStale=!0,this.selectedUrl=null,this.showUrlModal=!1,this.urlContent=null,this.showSymbolMapModal=!1,this.symbolMapContent=null,this.isLoadingSymbolMap=!1,this.selectedFiles=[],this.fetchedUrls=[],this.excludedUrls=new Set}getIncludedUrls(){return this.fetchedUrls?this.fetchedUrls.filter(e=>!this.excludedUrls.has(e)):[]}async refreshBreakdown(){if(this.rpcCall)return this._refreshPromise?this._refreshPromise:(this._refreshPromise=(async()=>{try{const e=await this._rpcWithState("LiteLLM.get_context_breakdown",{},this.selectedFiles||[],this.getIncludedUrls());e&&(this._onBreakdownResult(e),this.breakdown=e)}finally{this._refreshPromise=null}})(),this._refreshPromise)}_onBreakdownResult(e){}_viewerDataWillUpdate(e){const t=e.has("selectedFiles")||e.has("fetchedUrls")||e.has("excludedUrls");if(t&&(this._breakdownStale=!0),e.has("visible")&&this.visible&&this._breakdownStale){this._breakdownStale=!1,this._refreshTimer&&clearTimeout(this._refreshTimer),this._refreshTimer=setTimeout(()=>this.refreshBreakdown(),100);return}t&&this.visible&&this.rpcCall&&!this._refreshPromise&&(this._breakdownStale=!1,this._refreshTimer&&clearTimeout(this._refreshTimer),this._refreshTimer=setTimeout(()=>this.refreshBreakdown(),100))}disconnectedCallback(){this._refreshTimer&&(clearTimeout(this._refreshTimer),this._refreshTimer=null),this._refreshPromise&&(this._refreshPromise=null),super.disconnectedCallback()}async viewUrl(e){if(this.rpcCall){this.selectedUrl=e,this.showUrlModal=!0,this.urlContent=null;try{this.urlContent=await this._rpcExtract("LiteLLM.get_url_content",e)}catch(t){this.urlContent={error:t.message}}}}closeUrlModal(){this.showUrlModal=!1,this.selectedUrl=null,this.urlContent=null}toggleUrlIncluded(e){const t=new Set(this.excludedUrls);t.has(e)?t.delete(e):t.add(e),this.excludedUrls=t,this.dispatchEvent(new CustomEvent("url-inclusion-changed",{detail:{url:e,included:!t.has(e),includedUrls:this.getIncludedUrls()},bubbles:!0,composed:!0})),this.refreshBreakdown()}isUrlIncluded(e){return!this.excludedUrls.has(e)}removeUrl(e){if(this.excludedUrls.has(e)){const t=new Set(this.excludedUrls);t.delete(e),this.excludedUrls=t}this.dispatchEvent(new CustomEvent("remove-url",{detail:{url:e},bubbles:!0,composed:!0}))}async viewSymbolMap(){if(this.rpcCall){this.isLoadingSymbolMap=!0,this.showSymbolMapModal=!0,this.symbolMapContent=null;try{this.symbolMapContent=await this._rpcExtract("LiteLLM.get_context_map",null,!0)}catch(e){this.symbolMapContent=`Error loading symbol map: ${e.message}`}finally{this.isLoadingSymbolMap=!1}}}closeSymbolMapModal(){this.showSymbolMapModal=!1,this.symbolMapContent=null}};class a extends l{static properties={...l.properties,content:{type:String},isLoading:{type:Boolean}};static styles=[r,o`
      .modal {
        width: 90%;
        max-width: 900px;
        max-height: 85vh;
      }

      .modal-body {
        padding: 0;
      }

      .content-box {
        background: #0d0d0d;
        padding: 16px;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Fira Code', monospace;
        font-size: 12px;
        line-height: 1.5;
        color: #ccc;
        white-space: pre;
        overflow-x: auto;
        min-height: 200px;
      }

      .footer-info {
        font-size: 11px;
        color: #666;
      }
    `];constructor(){super(),this.content=null,this.isLoading=!1}_getLineCount(){return this.content?this.content.split(`
`).length:0}render(){return this.open?s`
      <div class="overlay" @click=${this._handleOverlayClick}>
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">
              <span>🗺️</span>
              <span>Symbol Map</span>
            </span>
            <button class="close-btn" @click=${this._close}>✕</button>
          </div>
          
          <div class="modal-body">
            ${this.isLoading?s`
              <div class="loading">
                <div class="spinner"></div>
                <span>Loading symbol map...</span>
              </div>
            `:s`
              <div class="content-box">${this.content||"No content available"}</div>
            `}
          </div>
          
          <div class="modal-footer">
            <span class="footer-info">
              ${this.content?`${this._getLineCount()} lines`:""}
            </span>
            <button class="copy-btn" @click=${this._copyToClipboard} ?disabled=${!this.content}>
              📋 Copy to Clipboard
            </button>
          </div>
        </div>
      </div>
    `:s``}}customElements.define("symbol-map-modal",a);export{h as V,d as a};
