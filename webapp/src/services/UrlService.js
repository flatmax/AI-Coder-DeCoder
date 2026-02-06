/**
 * Service for URL detection, fetching, and state management.
 * Extracted from UrlHandlerMixin for better testability and separation of concerns.
 */
export class UrlService {
  /**
   * @param {Function} rpcCall - Function to make RPC calls: (method, ...args) => Promise
   * @param {Function} onStateChange - Callback when state changes: (state) => void
   */
  constructor(rpcCall, onStateChange) {
    this._rpcCall = rpcCall;
    this._onStateChange = onStateChange;
    
    this._detectedUrls = [];
    this._fetchingUrls = {};  // url -> true while fetching
    this._fetchedUrls = {};   // url -> result after fetch
    this._excludedUrls = new Set();  // URLs excluded from context
    this._urlDetectDebounce = null;
  }

  destroy() {
    if (this._urlDetectDebounce) {
      clearTimeout(this._urlDetectDebounce);
      this._urlDetectDebounce = null;
    }
  }

  // ============ Getters ============

  get detectedUrls() { return this._detectedUrls; }
  get fetchingUrls() { return this._fetchingUrls; }
  get fetchedUrls() { return this._fetchedUrls; }
  get excludedUrls() { return this._excludedUrls; }

  // ============ Detection ============

  /**
   * Detect URLs in the input text with debouncing.
   */
  detectUrlsInInput(text) {
    if (this._urlDetectDebounce) {
      clearTimeout(this._urlDetectDebounce);
    }
    
    this._urlDetectDebounce = setTimeout(async () => {
      await this._performUrlDetection(text);
    }, 300);
  }

  async _performUrlDetection(text) {
    if (!this._rpcCall || !text) {
      this._detectedUrls = [];
      this._notifyStateChange();
      return;
    }

    try {
      const urls = await this._rpcCall('LiteLLM.detect_urls', text);
      
      if (Array.isArray(urls)) {
        // Filter out already fetched URLs
        this._detectedUrls = urls.filter(u => !this._fetchedUrls[u.url]);
      } else {
        this._detectedUrls = [];
      }
    } catch (e) {
      console.error('URL detection failed:', e);
      this._detectedUrls = [];
    }
    this._notifyStateChange();
  }

  // ============ Fetching ============

  /**
   * Fetch a specific URL when user confirms.
   */
  async fetchUrl(urlInfo, context = '') {
    const url = urlInfo.url;
    
    if (this._fetchingUrls[url]) {
      return; // Already fetching
    }

    this._fetchingUrls = { ...this._fetchingUrls, [url]: true };
    this._notifyStateChange();

    try {
      const result = await this._rpcCall(
        'LiteLLM.fetch_url',
        url,
        true,  // use_cache
        true,  // summarize
        null,  // summary_type (auto)
        context
      );
      
      this._fetchedUrls = { ...this._fetchedUrls, [url]: result };
      
      // Remove from detected (it's now fetched)
      this._detectedUrls = this._detectedUrls.filter(u => u.url !== url);
      
      if (result.error) {
        console.warn(`Failed to fetch ${url}:`, result.error);
      }
    } catch (e) {
      console.error('URL fetch failed:', e);
      this._fetchedUrls = { 
        ...this._fetchedUrls, 
        [url]: { url, error: e.message } 
      };
    } finally {
      const { [url]: _, ...rest } = this._fetchingUrls;
      this._fetchingUrls = rest;
      this._notifyStateChange();
    }
  }

  // ============ State Management ============

  /**
   * Toggle whether a URL is included in context.
   * @returns {boolean} The new included state
   */
  toggleUrlIncluded(url) {
    const newExcluded = new Set(this._excludedUrls);
    if (newExcluded.has(url)) {
      newExcluded.delete(url);
    } else {
      newExcluded.add(url);
    }
    this._excludedUrls = newExcluded;
    this._notifyStateChange();
    return !newExcluded.has(url);
  }

  /**
   * Remove a fetched URL from context.
   */
  removeFetchedUrl(url) {
    const { [url]: _, ...rest } = this._fetchedUrls;
    this._fetchedUrls = rest;
    
    // Also remove from excluded set if present
    if (this._excludedUrls.has(url)) {
      const newExcluded = new Set(this._excludedUrls);
      newExcluded.delete(url);
      this._excludedUrls = newExcluded;
    }
    
    this._notifyStateChange();
  }

  /**
   * Dismiss a detected URL (don't fetch it).
   */
  dismissUrl(url) {
    this._detectedUrls = this._detectedUrls.filter(u => u.url !== url);
    this._notifyStateChange();
  }

  /**
   * Clear transient URL state (called on send).
   * Keeps fetchedUrls - they persist as context across messages.
   */
  clearState() {
    this._detectedUrls = [];
    this._fetchingUrls = {};
    this._notifyStateChange();
  }

  /**
   * Clear all URL state including fetched URLs (called on conversation clear).
   */
  clearAllState() {
    this._detectedUrls = [];
    this._fetchingUrls = {};
    this._fetchedUrls = {};
    this._excludedUrls = new Set();
    this._notifyStateChange();
  }

  /**
   * Get fetched URLs for including in message context.
   * Respects excludedUrls.
   */
  getFetchedUrlsForMessage() {
    return Object.values(this._fetchedUrls)
      .filter(r => !r.error && !this._excludedUrls.has(r.url));
  }

  // ============ Display Helpers ============

  /**
   * Get display label for URL type.
   */
  getUrlTypeLabel(type) {
    const labels = {
      'github_repo': '📦 GitHub Repo',
      'github_file': '📄 GitHub File',
      'github_issue': '🐛 Issue',
      'github_pr': '🔀 PR',
      'documentation': '📚 Docs',
      'generic_web': '🌐 Web',
    };
    return labels[type] || '🔗 URL';
  }

  /**
   * Get short display name for a URL.
   */
  getUrlDisplayName(urlInfo) {
    if (urlInfo.github_info) {
      const gi = urlInfo.github_info;
      if (gi.path) {
        return `${gi.owner}/${gi.repo}/${gi.path.split('/').pop()}`;
      }
      return `${gi.owner}/${gi.repo}`;
    }
    
    try {
      const url = new URL(urlInfo.url);
      const path = url.pathname;
      if (path && path !== '/') {
        const parts = path.split('/').filter(Boolean);
        if (parts.length > 2) {
          return `${url.hostname}/.../${parts.slice(-1)[0]}`;
        }
        return `${url.hostname}${path}`;
      }
      return url.hostname;
    } catch {
      return urlInfo.url.substring(0, 40);
    }
  }

  // ============ Internal ============

  _notifyStateChange() {
    if (this._onStateChange) {
      this._onStateChange({
        detectedUrls: this._detectedUrls,
        fetchingUrls: this._fetchingUrls,
        fetchedUrls: this._fetchedUrls,
        excludedUrls: this._excludedUrls,
      });
    }
  }
}
