import { LitElement, html } from 'lit';
import { cacheViewerStyles } from './CacheViewerStyles.js';
import { renderCacheViewer } from './CacheViewerTemplate.js';
import { RpcMixin } from '../utils/rpc.js';
import { getTierColor } from '../utils/tierConfig.js';
import { ViewerDataMixin } from './ViewerDataMixin.js';
import './UrlContentModal.js';
import './SymbolMapModal.js';

/**
 * CacheViewer - Visualizes the 4-tier cache system (L0-L3 + active)
 * 
 * Shows how content is organized for LLM prompt caching, with stability
 * indicators showing progress toward promotion to higher cache tiers.
 */
export class CacheViewer extends ViewerDataMixin(RpcMixin(LitElement)) {
  static properties = {
    visible: { type: Boolean },
    
    // Tier expansion state
    expandedTiers: { type: Object },      // { L0: true, L1: false, ... }
    expandedGroups: { type: Object },     // { 'L0-symbols': true, ... }
    
    // Recent changes for notifications
    recentChanges: { type: Array },
    
    // Search/filter
    searchQuery: { type: String },
    
    ...ViewerDataMixin.mixinProperties,
  };

  static styles = cacheViewerStyles;

  constructor() {
    super();
    this.visible = true;
    
    // Default: L0 expanded, others collapsed
    this.expandedTiers = { L0: true, L1: false, L2: false, L3: false, active: true };
    this.expandedGroups = {};
    
    this.recentChanges = [];
    
    this.searchQuery = '';
    
    this.initViewerData();
  }

  onRpcReady() {
    this.refreshBreakdown();
  }

  // ========== Promotion/Demotion Tracking ==========

  _onBreakdownResult(result) {
    if (result.promotions?.length || result.demotions?.length) {
      this._addRecentChanges(result.promotions, result.demotions);
    }
  }

  _addRecentChanges(promotions = [], demotions = []) {
    const now = Date.now();
    const newChanges = [
      ...promotions.map(item => ({ item, type: 'promotion', time: now })),
      ...demotions.map(item => ({ item, type: 'demotion', time: now })),
    ];
    
    // Keep last 10 changes, remove ones older than 30 seconds
    const cutoff = now - 30000;
    this.recentChanges = [
      ...newChanges,
      ...this.recentChanges.filter(c => c.time > cutoff)
    ].slice(0, 10);
  }

  willUpdate(changedProperties) {
    this._viewerDataWillUpdate(changedProperties);
  }

  // ========== Tier/Group Expansion ==========

  toggleTier(tier) {
    this.expandedTiers = {
      ...this.expandedTiers,
      [tier]: !this.expandedTiers[tier]
    };
  }

  toggleGroup(tier, group) {
    const key = `${tier}-${group}`;
    this.expandedGroups = {
      ...this.expandedGroups,
      [key]: !this.expandedGroups[key]
    };
  }

  isGroupExpanded(tier, group) {
    return this.expandedGroups[`${tier}-${group}`] || false;
  }

  // ========== File Navigation ==========

  viewFile(path) {
    // Strip "symbol:" prefix if present (from symbol entries)
    const filePath = path.startsWith('symbol:') ? path.slice(7) : path;
    this.dispatchEvent(new CustomEvent('file-selected', {
      detail: { path: filePath },
      bubbles: true,
      composed: true
    }));
  }

  // ========== Computed Values ==========

  getCacheHitPercent() {
    if (!this.breakdown) return 0;
    const rate = this.breakdown.cache_hit_rate || 0;
    return Math.round(rate * 100);
  }

  getTotalTokens() {
    if (!this.breakdown) return 0;
    return this.breakdown.total_tokens || 0;
  }

  getCachedTokens() {
    if (!this.breakdown) return 0;
    return this.breakdown.cached_tokens || 0;
  }

  getUsagePercent() {
    if (!this.breakdown) return 0;
    const { total_tokens, max_input_tokens } = this.breakdown;
    if (!max_input_tokens) return 0;
    return Math.min(100, Math.round((total_tokens / max_input_tokens) * 100));
  }

  getTierColor(tier) {
    return getTierColor(tier);
  }

  // ========== Search/Filter ==========

  handleSearchInput(e) {
    this.searchQuery = e.target.value;
  }

  clearSearch() {
    this.searchQuery = '';
  }

  /**
   * Fuzzy match a query against a string.
   * Returns true if all characters in query appear in order in str.
   */
  fuzzyMatch(query, str) {
    if (!query) return true;
    query = query.toLowerCase();
    str = str.toLowerCase();
    
    let qi = 0;
    for (let si = 0; si < str.length && qi < query.length; si++) {
      if (str[si] === query[qi]) {
        qi++;
      }
    }
    return qi === query.length;
  }

  /**
   * Filter items in a content group based on search query.
   */
  filterItems(items, type) {
    if (!this.searchQuery || !items) return items;
    
    return items.filter(item => {
      const searchStr = type === 'urls' 
        ? (item.title || item.url || '')
        : (item.path || '');
      return this.fuzzyMatch(this.searchQuery, searchStr);
    });
  }

  /**
   * Check if a tier has any matching items after filtering.
   */
  tierHasMatches(block) {
    if (!this.searchQuery) return true;
    if (!block.contents) return false;
    
    return block.contents.some(content => {
      if (!content.items) return false;
      const filtered = this.filterItems(content.items, content.type);
      return filtered && filtered.length > 0;
    });
  }

  render() {
    return renderCacheViewer(this);
  }
}

customElements.define('cache-viewer', CacheViewer);
