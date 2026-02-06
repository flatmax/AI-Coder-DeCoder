import { LitElement, html } from 'lit';
import { contextViewerStyles } from './ContextViewerStyles.js';
import { renderContextViewer } from './ContextViewerTemplate.js';
import { RpcMixin } from '../utils/rpc.js';
import { ViewerDataMixin, ViewerDataProperties } from './ViewerDataMixin.js';
import './UrlContentModal.js';
import './SymbolMapModal.js';

/**
 * ContextViewer - Shows token budget breakdown and usage
 * 
 * Displays how tokens are allocated across system prompt, symbol map,
 * files, URLs, and history. Allows viewing/managing URLs in context.
 */
export class ContextViewer extends ViewerDataMixin(RpcMixin(LitElement)) {
  static properties = {
    visible: { type: Boolean },
    expandedSections: { type: Object },
    ...ViewerDataProperties,
  };

  static styles = contextViewerStyles;

  constructor() {
    super();
    this.visible = true;
    this.expandedSections = { files: false, urls: false, history: false, symbol_map: false };
    this.initViewerData();
  }

  onRpcReady() {
    this.refreshBreakdown();
  }

  willUpdate(changedProperties) {
    this._viewerDataWillUpdate(changedProperties);
  }

  toggleSection(section) {
    this.expandedSections = {
      ...this.expandedSections,
      [section]: !this.expandedSections[section]
    };
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
