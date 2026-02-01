import { html } from 'lit';
import { MessageHandler } from './MessageHandler.js';
import { promptViewStyles } from './prompt/PromptViewStyles.js';
import { renderPromptView } from './prompt/PromptViewTemplate.js';
import { FileHandlerMixin } from './prompt/FileHandlerMixin.js';
import { ChatActionsMixin } from './prompt/ChatActionsMixin.js';
import { InputHandlerMixin } from './prompt/InputHandlerMixin.js';
import { WindowControlsMixin } from './prompt/WindowControlsMixin.js';
import { StreamingMixin } from './prompt/StreamingMixin.js';
import { UrlService } from './services/UrlService.js';
import './file-picker/FilePicker.js';
import './history-browser/HistoryBrowser.js';
import './find-in-files/FindInFiles.js';
import './context-viewer/ContextViewer.js';

const MixedBase = StreamingMixin(
  WindowControlsMixin(
    InputHandlerMixin(
      ChatActionsMixin(
        FileHandlerMixin(MessageHandler)
      )
    )
  )
);

export class PromptView extends MixedBase {
  static properties = {
    inputValue: { type: String },
    minimized: { type: Boolean },
    isConnected: { type: Boolean },
    fileTree: { type: Object },
    modifiedFiles: { type: Array },
    stagedFiles: { type: Array },
    untrackedFiles: { type: Array },
    diffStats: { type: Object },
    selectedFiles: { type: Array },
    showFilePicker: { type: Boolean },
    pastedImages: { type: Array },
    dialogX: { type: Number },
    dialogY: { type: Number },
    showHistoryBrowser: { type: Boolean },
    viewingFile: { type: String },
    detectedUrls: { type: Array },
    fetchingUrls: { type: Object },
    fetchedUrls: { type: Object },
    excludedUrls: { type: Object },  // Set of URLs excluded from context
    activeLeftTab: { type: String }  // 'files' | 'search' | 'context' | 'cache'
  };

  static styles = promptViewStyles;

  constructor() {
    super();
    this.inputValue = '';
    this.minimized = false;
    this.isConnected = false;
    this.fileTree = null;
    this.modifiedFiles = [];
    this.stagedFiles = [];
    this.untrackedFiles = [];
    this.diffStats = {};
    this.selectedFiles = [];
    this.showFilePicker = true;
    this.pastedImages = [];
    this.dialogX = null;
    this.dialogY = null;
    this.showHistoryBrowser = false;
    this.viewingFile = null;
    this.detectedUrls = [];
    this.fetchingUrls = {};
    this.fetchedUrls = {};
    this.excludedUrls = new Set();
    this.activeLeftTab = 'files';
    this._filePickerScrollTop = 0;
    this._messagesScrollTop = 0;
    this._wasScrolledUp = false;
    
    const urlParams = new URLSearchParams(window.location.search);
    this.port = urlParams.get('port');
    
    this._urlService = null;
  }

  // ============ URL Service Integration ============

  _initUrlService() {
    this._urlService = new UrlService(
      // RPC call wrapper
      async (method, ...args) => {
        const response = await this.call[method](...args);
        return this.extractResponse(response);
      },
      // State change callback
      (state) => {
        this.detectedUrls = state.detectedUrls;
        this.fetchingUrls = state.fetchingUrls;
        this.fetchedUrls = state.fetchedUrls;
        this.excludedUrls = state.excludedUrls;
      }
    );
  }

  detectUrlsInInput(text) {
    this._urlService?.detectUrlsInInput(text);
  }

  async fetchUrl(urlInfo) {
    await this._urlService?.fetchUrl(urlInfo, this.inputValue);
  }

  toggleUrlIncluded(url) {
    const included = this._urlService?.toggleUrlIncluded(url);
    this.dispatchEvent(new CustomEvent('url-inclusion-changed', {
      detail: { url, included },
      bubbles: true,
      composed: true
    }));
  }

  removeFetchedUrl(url) {
    this._urlService?.removeFetchedUrl(url);
    this.dispatchEvent(new CustomEvent('url-removed', {
      detail: { url },
      bubbles: true,
      composed: true
    }));
    this._urlService?.detectUrlsInInput(this.inputValue);
  }

  dismissUrl(url) {
    this._urlService?.dismissUrl(url);
  }

  viewUrlContent(urlResult) {
    this.dispatchEvent(new CustomEvent('view-url-content', {
      detail: { url: urlResult.url, content: urlResult },
      bubbles: true,
      composed: true
    }));
  }

  clearUrlState() {
    this._urlService?.clearState();
  }

  clearAllUrlState() {
    this._urlService?.clearAllState();
  }

  getFetchedUrlsForMessage() {
    return this._urlService?.getFetchedUrlsForMessage() || [];
  }

  getUrlTypeLabel(type) {
    return this._urlService?.getUrlTypeLabel(type) || '🔗 URL';
  }

  getUrlDisplayName(urlInfo) {
    return this._urlService?.getUrlDisplayName(urlInfo) || urlInfo.url;
  }

  /**
   * Convert selectedFiles array to selection object for FilePicker.
   * @returns {Object} Selection object with file paths as keys and true as values
   */
  _getSelectedObject() {
    const selected = {};
    for (const path of this.selectedFiles || []) {
      selected[path] = true;
    }
    return selected;
  }

  // ============ History Browser ============

  toggleHistoryBrowser() {
    this.showHistoryBrowser = !this.showHistoryBrowser;
    if (this.showHistoryBrowser) {
      this.updateComplete.then(() => {
        const historyBrowser = this.shadowRoot?.querySelector('history-browser');
        if (historyBrowser) {
          historyBrowser.rpcCall = this.call;
          historyBrowser.show();
        }
      });
    }
  }

  handleHistoryCopyToPrompt(e) {
    const { content } = e.detail;
    this.inputValue = content;
    this.showHistoryBrowser = false;
    
    this.updateComplete.then(() => {
      const textarea = this.shadowRoot?.querySelector('textarea');
      if (textarea) {
        textarea.focus();
      }
    });
  }

  handleLoadSession(e) {
    const { messages } = e.detail;
    
    // Clear current history
    this.clearHistory();
    
    // Load all messages from the session
    for (const msg of messages) {
      this.addMessage(msg.role, msg.content, msg.images || null);
    }
    
    this.showHistoryBrowser = false;
    console.log(`📜 Loaded ${messages.length} messages from session`);
  }

  connectedCallback() {
    super.connectedCallback();
    this.addClass(this, 'PromptView');
    this.initInputHandler();
    this.initWindowControls();
    this.initStreaming();
    this._initUrlService();
    
    // Listen for edit block clicks
    this.addEventListener('edit-block-click', this._handleEditBlockClick.bind(this));
  }

  /**
   * Handle click on an edit block file path - navigate to diff viewer.
   */
  _handleEditBlockClick(e) {
    const { path, line, status, searchContext } = e.detail;
    
    // Dispatch event to navigate to diff viewer with file and line
    this.dispatchEvent(new CustomEvent('navigate-to-edit', {
      detail: { path, line, status, searchContext },
      bubbles: true,
      composed: true
    }));
  }

  /**
   * Switch between tabs (files/search/context)
   */
  switchTab(tab) {
    // Save scroll positions before switching away from files tab
    if (this.activeLeftTab === 'files') {
      const filePicker = this.shadowRoot?.querySelector('file-picker');
      if (filePicker) {
        this._filePickerScrollTop = filePicker.getScrollTop();
      }
      const messagesContainer = this.shadowRoot?.querySelector('#messages-container');
      if (messagesContainer) {
        this._messagesScrollTop = messagesContainer.scrollTop;
        // Save whether user had scrolled up
        this._wasScrolledUp = this._userHasScrolledUp;
      }
    }

    this.activeLeftTab = tab;

    // Restore scroll positions when switching back to files tab
    if (tab === 'files') {
      this.updateComplete.then(async () => {
        const filePicker = this.shadowRoot?.querySelector('file-picker');
        if (filePicker && this._filePickerScrollTop > 0) {
          await filePicker.updateComplete;
          filePicker.setScrollTop(this._filePickerScrollTop);
        }
        const messagesContainer = this.shadowRoot?.querySelector('#messages-container');
        if (messagesContainer) {
          if (this._wasScrolledUp) {
            // User was scrolled up - restore their position
            messagesContainer.scrollTop = this._messagesScrollTop;
            this._userHasScrolledUp = true;
            this._showScrollButton = true;
          } else {
            // User was at bottom - scroll to bottom
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            this._userHasScrolledUp = false;
            this._showScrollButton = false;
          }
        }
      });
    } else if (tab === 'search') {
      this.updateComplete.then(() => {
        const findInFiles = this.shadowRoot?.querySelector('find-in-files');
        if (findInFiles) {
          findInFiles.focusInput();
        }
      });
    } else if (tab === 'context') {
      this.updateComplete.then(() => {
        this._refreshContextViewer();
      });
    } else if (tab === 'cache') {
      this.updateComplete.then(() => {
        this._refreshCacheViewer();
      });
    }
  }

  /**
   * Refresh the context viewer with current state
   */
  _refreshContextViewer() {
    const contextViewer = this.shadowRoot?.querySelector('context-viewer');
    if (contextViewer && this.call) {
      contextViewer.rpcCall = this.call;
      contextViewer.selectedFiles = this.selectedFiles || [];
      contextViewer.fetchedUrls = Object.keys(this.fetchedUrls || {});
      contextViewer.excludedUrls = this.excludedUrls;
      contextViewer.refreshBreakdown();
    }
  }

  /**
   * Refresh the cache viewer with current state
   */
  _refreshCacheViewer() {
    const cacheViewer = this.shadowRoot?.querySelector('cache-viewer');
    if (cacheViewer && this.call) {
      cacheViewer.rpcCall = this.call;
      cacheViewer.selectedFiles = this.selectedFiles || [];
      cacheViewer.fetchedUrls = Object.keys(this.fetchedUrls || {});
      cacheViewer.excludedUrls = this.excludedUrls;
      cacheViewer.refreshBreakdown();
    }
  }

  /**
   * Handle search result selection - bubble up to AppShell
   */
  handleSearchResultSelected(e) {
    this.dispatchEvent(new CustomEvent('search-result-selected', {
      detail: e.detail,
      bubbles: true,
      composed: true
    }));
  }

  /**
   * Handle search file selection
   */
  handleSearchFileSelected(e) {
    this.dispatchEvent(new CustomEvent('search-file-selected', {
      detail: e.detail,
      bubbles: true,
      composed: true
    }));
  }

  /**
   * Handle URL removal from context viewer
   */
  handleContextRemoveUrl(e) {
    const { url } = e.detail;
    if (this.fetchedUrls && this.fetchedUrls[url]) {
      const { [url]: removed, ...remaining } = this.fetchedUrls;
      this.fetchedUrls = remaining;
    }
    this.dispatchEvent(new CustomEvent('context-remove-url', {
      detail: e.detail,
      bubbles: true,
      composed: true
    }));
  }

  /**
   * Handle URL inclusion toggle from context viewer
   */
  handleContextUrlInclusionChanged(e) {
    const { url, included } = e.detail;
    const newExcluded = new Set(this.excludedUrls);
    if (included) {
      newExcluded.delete(url);
    } else {
      newExcluded.add(url);
    }
    this.excludedUrls = newExcluded;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.destroyInputHandler();
    this.destroyWindowControls();
    this.removeEventListener('edit-block-click', this._handleEditBlockClick);
  }

  remoteIsUp() {}

  async setupDone() {
    this.isConnected = true;
    
    // Ensure call object is available (may have slight delay from JRPC)
    if (!this.call) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (!this.call) {
      console.warn('setupDone called but this.call is not available yet');
      return;
    }
    
    await this.loadFileTree();
    await this.loadLastSession();
  }

  async loadLastSession() {
    try {
      // Get list of sessions (most recent first)
      const sessionsResponse = await this.call['LiteLLM.history_list_sessions'](1);
      console.log('📜 Sessions response:', sessionsResponse);
      const sessions = this.extractResponse(sessionsResponse);
      console.log('📜 Extracted sessions:', sessions);
      
      if (sessions && sessions.length > 0) {
        const lastSessionId = sessions[0].session_id;
        console.log('📜 Loading session:', lastSessionId);
        
        // Load the session messages
        const messagesResponse = await this.call['LiteLLM.history_get_session'](lastSessionId);
        console.log('📜 Messages response:', messagesResponse);
        const messages = this.extractResponse(messagesResponse);
        console.log('📜 Extracted messages:', messages);
        
        if (messages && messages.length > 0) {
          // Load messages into chat history
          for (const msg of messages) {
            this.addMessage(msg.role, msg.content, msg.images || null, msg.edit_results || null);
          }
          console.log(`📜 Loaded ${messages.length} messages from last session`);
        }
      }
    } catch (e) {
      console.warn('Could not load last session:', e);
      console.error(e);
    }
  }

  remoteDisconnected(uuid) {
    this.isConnected = false;
  }

  extractResponse(response) {
    if (response && typeof response === 'object') {
      const keys = Object.keys(response);
      if (keys.length > 0) {
        return response[keys[0]];
      }
    }
    return response;
  }

  /**
   * Called by server when a chunk of the response is available.
   * Explicitly defined here so JRPC-OO can find it.
   * Delegates to mixin implementation.
   */
  streamChunk(requestId, content) {
    super.streamChunk(requestId, content);
  }

  /**
   * Called by server when streaming is complete.
   * Explicitly defined here so JRPC-OO can find it.
   * Delegates to mixin implementation.
   */
  async streamComplete(requestId, result) {
    await super.streamComplete(requestId, result);
  }

  render() {
    return renderPromptView(this);
  }
}

customElements.define('prompt-view', PromptView);
