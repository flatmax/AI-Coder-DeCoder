/**
 * Mixin for URL detection and fetching in chat input.
 */
export const UrlHandlerMixin = (superClass) => class extends superClass {
  
  // Note: Properties are declared in PromptView.js to avoid Lit mixin property inheritance issues
  // The mixin expects these properties to exist: detectedUrls, fetchingUrls, fetchedUrls

  initUrlHandler() {
    this.detectedUrls = [];
    this.fetchingUrls = {};  // url -> true while fetching
    this.fetchedUrls = {};   // url -> result after fetch
    this._urlDetectDebounce = null;
  }

  /**
   * Detect URLs in the input text.
   * Called on input change with debouncing.
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
    if (!this.call || !text) {
      this.detectedUrls = [];
      return;
    }

    try {
      const response = await this.call['LiteLLM.detect_urls'](text);
      const urls = this.extractResponse(response);
      
      if (Array.isArray(urls)) {
        // Filter out already fetched URLs
        this.detectedUrls = urls.filter(u => !this.fetchedUrls[u.url]);
      } else {
        this.detectedUrls = [];
      }
    } catch (e) {
      console.error('URL detection failed:', e);
      this.detectedUrls = [];
    }
  }

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

  /**
   * Fetch a specific URL when user confirms.
   */
  async fetchUrl(urlInfo) {
    const url = urlInfo.url;
    
    if (this.fetchingUrls[url]) {
      return; // Already fetching
    }

    this.fetchingUrls = { ...this.fetchingUrls, [url]: true };
    this.requestUpdate();

    try {
      const response = await this.call['LiteLLM.fetch_url'](
        url,
        true,  // use_cache
        true,  // summarize
        null,  // summary_type (auto)
        this.inputValue  // context
      );
      const result = this.extractResponse(response);
      
      this.fetchedUrls = { ...this.fetchedUrls, [url]: result };
      
      // Remove from detected (it's now fetched)
      this.detectedUrls = this.detectedUrls.filter(u => u.url !== url);
      
      if (result.error) {
        console.warn(`Failed to fetch ${url}:`, result.error);
      }
    } catch (e) {
      console.error('URL fetch failed:', e);
      this.fetchedUrls = { 
        ...this.fetchedUrls, 
        [url]: { url, error: e.message } 
      };
    } finally {
      const { [url]: _, ...rest } = this.fetchingUrls;
      this.fetchingUrls = rest;
      this.requestUpdate();
    }
  }

  /**
   * Remove a fetched URL from context.
   */
  removeFetchedUrl(url) {
    const { [url]: _, ...rest } = this.fetchedUrls;
    this.fetchedUrls = rest;
    
    // Re-detect in case the URL is still in input
    this.detectUrlsInInput(this.inputValue);
  }

  /**
   * Dismiss a detected URL (don't fetch it).
   */
  dismissUrl(url) {
    this.detectedUrls = this.detectedUrls.filter(u => u.url !== url);
  }

  /**
   * Clear all URL state (called on send or clear).
   */
  clearUrlState() {
    this.detectedUrls = [];
    this.fetchingUrls = {};
    // Keep fetchedUrls until message is sent
  }

  /**
   * Get fetched URLs for including in message context.
   * Called before sending a message.
   */
  getFetchedUrlsForMessage() {
    return Object.values(this.fetchedUrls).filter(r => !r.error);
  }

  /**
   * Clear fetched URLs after message is sent.
   */
  clearFetchedUrls() {
    this.fetchedUrls = {};
  }
};
