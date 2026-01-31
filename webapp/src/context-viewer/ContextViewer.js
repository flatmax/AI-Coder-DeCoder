import { LitElement, html } from 'lit';
import { contextViewerStyles } from './ContextViewerStyles.js';
import { renderContextViewer } from './ContextViewerTemplate.js';
import { RpcMixin } from '../utils/rpc.js';
import './UrlContentModal.js';
import './SymbolMapModal.js';

/**
 * ContextViewer - Shows token budget breakdown and usage
 * 
 * Displays how tokens are allocated across system prompt, symbol map,
 * files, URLs, and history. Allows viewing/managing URLs in context.
 */
export class ContextViewer extends RpcMixin(LitElement) {
  static properties = {
    visible: { type: Boolean },
    breakdown: { type: Object },
    isLoading: { type: Boolean },
    error: { type: String },
    expandedSections: { type: Object },
    selectedUrl: { type: String },
    showUrlModal: { type: Boolean },
    urlContent: { type: Object },
    // Symbol map modal
    showSymbolMapModal: { type: Boolean },
    symbolMapContent: { type: String },
    isLoadingSymbolMap: { type: Boolean },
    // These come from parent
    selectedFiles: { type: Array },
    fetchedUrls: { type: Array },
    excludedUrls: { type: Object }, // Set of URLs to exclude from context
  };

  static styles = contextViewerStyles;

  constructor() {
    super();
    this.visible = true;
    this.breakdown = null;
    this.isLoading = false;
    this.error = null;
    this.expandedSections = { files: false, urls: false, history: false, symbol_map: false };
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

  onRpcReady() {
    this.refreshBreakdown();
  }

  getIncludedUrls() {
    if (!this.fetchedUrls) return [];
    return this.fetchedUrls.filter(url => !this.excludedUrls.has(url));
  }

  async refreshBreakdown() {
    if (!this.rpcCall) {
      return;
    }
    
    const result = await this._rpcWithState(
      'LiteLLM.get_context_breakdown',
      {},
      this.selectedFiles || [],
      this.getIncludedUrls()
    );
    
    if (result) {
      this.breakdown = result;
    }
  }

  willUpdate(changedProperties) {
    // Refresh when files or URLs change
    if (changedProperties.has('selectedFiles') || changedProperties.has('fetchedUrls')) {
      if (this.rpcCall) {
        this.refreshBreakdown();
      }
    }
  }

  toggleSection(section) {
    this.expandedSections = {
      ...this.expandedSections,
      [section]: !this.expandedSections[section]
    };
  }

  async viewUrl(url) {
    if (!this.rpcCall) return;
    
    this.selectedUrl = url;
    this.showUrlModal = true;
    this.urlContent = null;
    
    try {
      const response = await this._rpc('LiteLLM.get_url_content', url);
      this.urlContent = extractResponse(response);
    } catch (e) {
      this.urlContent = { error: e.message };
    }
  }

  closeUrlModal() {
    this.showUrlModal = false;
    this.selectedUrl = null;
    this.urlContent = null;
  }

  toggleUrlIncluded(url) {
    const newExcluded = new Set(this.excludedUrls);
    if (newExcluded.has(url)) {
      newExcluded.delete(url);
    } else {
      newExcluded.add(url);
    }
    this.excludedUrls = newExcluded;
    
    // Notify parent of the change
    this.dispatchEvent(new CustomEvent('url-inclusion-changed', {
      detail: { url, included: !newExcluded.has(url), includedUrls: this.getIncludedUrls() },
      bubbles: true,
      composed: true
    }));
    
    // Refresh breakdown with updated included URLs
    this.refreshBreakdown();
  }

  isUrlIncluded(url) {
    return !this.excludedUrls.has(url);
  }

  removeUrl(url) {
    // Also remove from excluded set if present
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

  async viewSymbolMap() {
    if (!this.rpcCall) return;
    
    this.isLoadingSymbolMap = true;
    this.showSymbolMapModal = true;
    this.symbolMapContent = null;
    
    try {
      // Use get_context_map which fetches all trackable files and includes references
      // Pass null for chat_files to include ALL files in the map
      const response = await this._rpc('LiteLLM.get_context_map',
        null,  // Don't exclude any files
        true   // include_references
      );
      this.symbolMapContent = extractResponse(response);
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

  getUsagePercent() {
    if (!this.breakdown) return 0;
    const { used_tokens, max_input_tokens } = this.breakdown;
    if (!max_input_tokens) return 0;
    return Math.min(100, Math.round((used_tokens / max_input_tokens) * 100));
  }

  getBarWidth(tokens) {
    if (!this.breakdown || !this.breakdown.used_tokens) return 0;
    return Math.round((tokens / this.breakdown.used_tokens) * 100);
  }

  render() {
    return renderContextViewer(this);
  }
}

customElements.define('context-viewer', ContextViewer);
