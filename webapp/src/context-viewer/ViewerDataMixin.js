/**
 * Mixin providing shared data-fetching and modal logic for CacheViewer and ContextViewer.
 *
 * Extracts identical URL management, symbol map modal, and RPC refresh logic
 * that was duplicated across both viewer components.
 *
 * @mixin
 * @requires RpcMixin (provides _rpc, _rpcExtract, _rpcWithState)
 * @provides getIncludedUrls, refreshBreakdown, viewUrl, closeUrlModal,
 *   toggleUrlIncluded, isUrlIncluded, removeUrl, viewSymbolMap, closeSymbolMapModal
 */
export const ViewerDataProperties = {
  breakdown: { type: Object },
  isLoading: { type: Boolean },
  error: { type: String },

  // URL modal
  selectedUrl: { type: String },
  showUrlModal: { type: Boolean },
  urlContent: { type: Object },

  // Symbol map modal
  showSymbolMapModal: { type: Boolean },
  symbolMapContent: { type: String },
  isLoadingSymbolMap: { type: Boolean },

  // From parent
  selectedFiles: { type: Array },
  fetchedUrls: { type: Array },
  excludedUrls: { type: Object },
};

export const ViewerDataMixin = (superClass) => class extends superClass {

  initViewerData() {
    this.breakdown = null;
    this.isLoading = false;
    this.error = null;

    this.selectedUrl = null;
    this.showUrlModal = false;
    this.urlContent = null;

    this.showSymbolMapModal = false;
    this.symbolMapContent = null;
    this.isLoadingSymbolMap = false;

    this.selectedFiles = [];
    this.fetchedUrls = [];
    this.excludedUrls = new Set();
  }

  // ========== Data Fetching ==========

  getIncludedUrls() {
    if (!this.fetchedUrls) return [];
    return this.fetchedUrls.filter(url => !this.excludedUrls.has(url));
  }

  async refreshBreakdown() {
    if (!this.rpcCall) return;

    // Deduplicate: if a refresh is already in flight, return that promise
    if (this._refreshPromise) return this._refreshPromise;

    this._refreshPromise = (async () => {
      try {
        const result = await this._rpcWithState(
          'LiteLLM.get_context_breakdown',
          {},
          this.selectedFiles || [],
          this.getIncludedUrls()
        );

        if (result) {
          this._onBreakdownResult(result);
          this.breakdown = result;
        }
      } finally {
        this._refreshPromise = null;
      }
    })();

    return this._refreshPromise;
  }

  /**
   * Hook for subclasses to process breakdown results before assignment.
   * Override to add component-specific handling (e.g. tracking promotions).
   */
  _onBreakdownResult(result) {
    // Default: no-op. Override in subclass.
  }

  /**
   * Auto-refresh when relevant properties change.
   * Debounced to coalesce rapid property changes (e.g. selectedFiles +
   * fetchedUrls changing in the same microtask).
   */
  _viewerDataWillUpdate(changedProperties) {
    if (changedProperties.has('selectedFiles') ||
        changedProperties.has('fetchedUrls') ||
        changedProperties.has('excludedUrls')) {
      if (this.rpcCall && this.visible) {
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => this.refreshBreakdown(), 100);
      }
    }
  }

  /**
   * Clean up pending timers when disconnected from the DOM.
   */
  disconnectedCallback() {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    if (this._refreshPromise) {
      this._refreshPromise = null;
    }
    super.disconnectedCallback();
  }

  // ========== URL Modal ==========

  async viewUrl(url) {
    if (!this.rpcCall) return;

    this.selectedUrl = url;
    this.showUrlModal = true;
    this.urlContent = null;

    try {
      this.urlContent = await this._rpcExtract('LiteLLM.get_url_content', url);
    } catch (e) {
      this.urlContent = { error: e.message };
    }
  }

  closeUrlModal() {
    this.showUrlModal = false;
    this.selectedUrl = null;
    this.urlContent = null;
  }

  // ========== URL Inclusion ==========

  toggleUrlIncluded(url) {
    const newExcluded = new Set(this.excludedUrls);
    if (newExcluded.has(url)) {
      newExcluded.delete(url);
    } else {
      newExcluded.add(url);
    }
    this.excludedUrls = newExcluded;

    this.dispatchEvent(new CustomEvent('url-inclusion-changed', {
      detail: { url, included: !newExcluded.has(url), includedUrls: this.getIncludedUrls() },
      bubbles: true,
      composed: true
    }));

    this.refreshBreakdown();
  }

  isUrlIncluded(url) {
    return !this.excludedUrls.has(url);
  }

  removeUrl(url) {
    if (this.excludedUrls.has(url)) {
      const newExcluded = new Set(this.excludedUrls);
      newExcluded.delete(url);
      this.excludedUrls = newExcluded;
    }
    this.dispatchEvent(new CustomEvent('remove-url', {
      detail: { url },
      bubbles: true,
      composed: true
    }));
  }

  // ========== Symbol Map Modal ==========

  async viewSymbolMap() {
    if (!this.rpcCall) return;

    this.isLoadingSymbolMap = true;
    this.showSymbolMapModal = true;
    this.symbolMapContent = null;

    try {
      this.symbolMapContent = await this._rpcExtract('LiteLLM.get_context_map', null, true);
    } catch (e) {
      this.symbolMapContent = `Error loading symbol map: ${e.message}`;
    } finally {
      this.isLoadingSymbolMap = false;
    }
  }

  closeSymbolMapModal() {
    this.showSymbolMapModal = false;
    this.symbolMapContent = null;
  }
};
