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
    console.log('🔗 UrlHandlerMixin initialized');
  }

  /**
   * Detect URLs in the input text.
   * Called on input change with debouncing.
   */
  detectUrlsInInput(text) {
    console.log('🔗 detectUrlsInInput called with:', text?.substring(0, 100));
    
    if (this._urlDetectDebounce) {
      clearTimeout(this._urlDetectDebounce);
    }
    
    this._urlDetectDebounce = setTimeout(async () => {
      await this._performUrlDetection(text);
    }, 300);
  }

  async _performUrlDetection(text) {
    console.log('🔗 _performUrlDetection called, this.call exists:', !!this.call);
    
    if (!this.call || !text) {
      console.log('🔗 Skipping detection - no call or text');
      this.detectedUrls = [];
      return;
    }

    try {
      console.log('🔗 Calling LiteLLM.detect_urls...');
      const response = await this.call['LiteLLM.detect_urls'](text);
      console.log('🔗 detect_urls response:', response);
      const urls = this.extractResponse(response);
      console.log('🔗 Extracted URLs:', urls);
      
      if (Array.isArray(urls)) {
        // Filter out already fetched URLs
        this.detectedUrls = urls.filter(u => !this.fetchedUrls[u.url]);
        console.log('🔗 Detected URLs (filtered):', this.detectedUrls);
      } else {
        console.log('🔗 No URLs array returned');
        this.detectedUrls = [];
      }
    } catch (e) {
      console.error('🔗 URL detection failed:', e);
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
    console.log('🔗 fetchUrl called for:', url);
    
    if (this.fetchingUrls[url]) {
      console.log('🔗 Already fetching, skipping');
      return; // Already fetching
    }

    this.fetchingUrls = { ...this.fetchingUrls, [url]: true };
    this.requestUpdate();

    try {
      console.log('🔗 Calling LiteLLM.fetch_url...');
      const response = await this.call['LiteLLM.fetch_url'](
        url,
        true,  // use_cache
        true,  // summarize
        null,  // summary_type (auto)
        this.inputValue  // context
      );
      console.log('🔗 fetch_url response:', response);
      const result = this.extractResponse(response);
      console.log('🔗 Extracted result:', result);
      
      this.fetchedUrls = { ...this.fetchedUrls, [url]: result };
      
      // Remove from detected (it's now fetched)
      this.detectedUrls = this.detectedUrls.filter(u => u.url !== url);
      
      // Show success feedback
      if (result.error) {
        console.warn(`🔗 Failed to fetch ${url}:`, result.error);
      } else {
        console.log(`🔗 ✅ Fetched: ${result.title || url}`);
      }
    } catch (e) {
      console.error('🔗 URL fetch failed:', e);
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
