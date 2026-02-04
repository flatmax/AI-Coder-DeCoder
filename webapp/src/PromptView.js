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
import './settings/SettingsPanel.js';

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
    promptSnippets: { type: Array },
    snippetDrawerOpen: { type: Boolean },
    leftPanelWidth: { type: Number },
    leftPanelCollapsed: { type: Boolean },
    detectedUrls: { type: Array },
    fetchingUrls: { type: Object },
    fetchedUrls: { type: Object },
    excludedUrls: { type: Object },  // Set of URLs excluded from context
    activeLeftTab: { type: String },  // 'files' | 'search' | 'context' | 'cache'
    filePickerExpanded: { type: Object }
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
    this.promptSnippets = [];
    this.snippetDrawerOpen = false;
    this.filePickerExpanded = {};
    this.leftPanelWidth = parseInt(localStorage.getItem('promptview-left-panel-width')) || 280;
    this.leftPanelCollapsed = localStorage.getItem('promptview-left-panel-collapsed') === 'true';
    this._filePickerScrollTop = 0;
    this._messagesScrollTop = 0;
    this._wasScrolledUp = false;
    this._isPanelResizing = false;
    
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

  async handleLoadSession(e) {
    const { messages, sessionId } = e.detail;
    
    // Clear current history
    this.clearHistory();
    
    // If we have a sessionId, use load_session_into_context to populate context manager
    if (sessionId) {
      try {
        await this.call['LiteLLM.load_session_into_context'](sessionId);
      } catch (err) {
        console.warn('Could not load session into context:', err);
      }
    }
    
    // Load all messages from the session into UI
    for (const msg of messages) {
      this.addMessage(msg.role, msg.content, msg.images || null);
    }
    
    this.showHistoryBrowser = false;
    console.log(`📜 Loaded ${messages.length} messages from session`);
    
    // Refresh history bar to reflect loaded session
    await this._refreshHistoryBar();
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
    
    // Bind panel resize handlers
    this._boundPanelResizeMove = this._handlePanelResizeMove.bind(this);
    this._boundPanelResizeEnd = this._handlePanelResizeEnd.bind(this);
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
    } else if (tab === 'settings') {
      this.updateComplete.then(() => {
        this._refreshSettingsPanel();
      });
    }
  }

  /**
   * Refresh the context viewer with current state
   */
  async _refreshContextViewer() {
    const contextViewer = this.shadowRoot?.querySelector('context-viewer');
    if (contextViewer && this.call) {
      contextViewer.rpcCall = this.call;
      contextViewer.selectedFiles = this.selectedFiles || [];
      contextViewer.fetchedUrls = Object.keys(this.fetchedUrls || {});
      contextViewer.excludedUrls = this.excludedUrls;
      await contextViewer.refreshBreakdown();
      
      // Sync history bar with context viewer's breakdown data
      if (contextViewer.breakdown) {
        this._syncHistoryBarFromBreakdown(contextViewer.breakdown);
      }
    }
  }

  /**
   * Refresh the cache viewer with current state
   */
  async _refreshCacheViewer() {
    const cacheViewer = this.shadowRoot?.querySelector('cache-viewer');
    if (cacheViewer && this.call) {
      cacheViewer.rpcCall = this.call;
      cacheViewer.selectedFiles = this.selectedFiles || [];
      cacheViewer.fetchedUrls = Object.keys(this.fetchedUrls || {});
      cacheViewer.excludedUrls = this.excludedUrls;
      await cacheViewer.refreshBreakdown();
      
      // Sync history bar with cache viewer's breakdown data
      if (cacheViewer.breakdown) {
        this._syncHistoryBarFromBreakdown(cacheViewer.breakdown);
      }
    }
  }

  /**
   * Refresh the settings panel
   */
  async _refreshSettingsPanel() {
    const settingsPanel = this.shadowRoot?.querySelector('settings-panel');
    if (settingsPanel && this.call) {
      settingsPanel.rpcCall = this.call;
      await settingsPanel.loadConfigInfo();
    }
  }

  /**
   * Sync history bar data from context breakdown
   */
  _syncHistoryBarFromBreakdown(breakdown) {
    if (!breakdown) return;
    
    // Initialize _hudData if needed
    if (!this._hudData) {
      this._hudData = {};
    }
    
    // Extract history data from the legacy breakdown structure
    const historyData = breakdown.breakdown?.history;
    if (historyData) {
      this._hudData.history_tokens = historyData.tokens || 0;
      // Use compaction_threshold (from config) if available, else fall back to max_tokens
      this._hudData.history_threshold = historyData.compaction_threshold || historyData.max_tokens || 50000;
    }
    
    // Trigger re-render for history bar
    this.requestUpdate();
  }

  /**
   * Refresh history bar by fetching current context breakdown
   */
  async _refreshHistoryBar() {
    if (!this.call) return;
    
    try {
      const response = await this.call['LiteLLM.get_context_breakdown'](
        this.selectedFiles || [],
        Object.keys(this.fetchedUrls || {})
      );
      const breakdown = this.extractResponse(response);
      this._syncHistoryBarFromBreakdown(breakdown);
    } catch (e) {
      console.warn('Could not refresh history bar:', e);
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

  /**
   * Handle file picker expanded state change
   */
  handleExpandedChange(e) {
    this.filePickerExpanded = e.detail;
  }

  handleConfigEditRequest(e) {
    // Forward to AppShell to load config into diff viewer
    this.dispatchEvent(new CustomEvent('config-edit-request', {
      bubbles: true,
      composed: true,
      detail: e.detail
    }));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.destroyInputHandler();
    this.destroyWindowControls();
    this.removeEventListener('edit-block-click', this._handleEditBlockClick);
    // Clean up any panel resize listeners
    window.removeEventListener('mousemove', this._boundPanelResizeMove);
    window.removeEventListener('mouseup', this._boundPanelResizeEnd);
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
    await this.loadPromptSnippets();
    
    // Sync history bar with current context state
    await this._refreshHistoryBar();
  }

  async loadPromptSnippets() {
    try {
      const response = await this.call['LiteLLM.get_prompt_snippets']();
      const snippets = this.extractResponse(response);
      if (Array.isArray(snippets)) {
        this.promptSnippets = snippets;
      }
    } catch (e) {
      console.warn('Could not load prompt snippets:', e);
    }
  }

  toggleSnippetDrawer() {
    this.snippetDrawerOpen = !this.snippetDrawerOpen;
  }

  appendSnippet(message) {
    // Close the drawer after selecting
    this.snippetDrawerOpen = false;
    
    // Append message to textarea, adding newline if there's existing content
    if (this.inputValue && !this.inputValue.endsWith('\n')) {
      this.inputValue += '\n' + message;
    } else {
      this.inputValue += message;
    }
    
    // Focus textarea after appending
    this.updateComplete.then(() => {
      const textarea = this.shadowRoot?.querySelector('textarea');
      if (textarea) {
        textarea.focus();
        // Move cursor to end
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
        // Trigger resize
        this._autoResizeTextarea(textarea);
      }
    });
  }

  // Panel resize handlers
  toggleLeftPanel() {
    this.leftPanelCollapsed = !this.leftPanelCollapsed;
    localStorage.setItem('promptview-left-panel-collapsed', this.leftPanelCollapsed);
  }

  _handlePanelResizeStart(e) {
    e.preventDefault();
    this._isPanelResizing = true;
    this._panelResizeStartX = e.clientX;
    this._panelResizeStartWidth = this.leftPanelWidth;
    window.addEventListener('mousemove', this._boundPanelResizeMove);
    window.addEventListener('mouseup', this._boundPanelResizeEnd);
  }

  _handlePanelResizeMove(e) {
    if (!this._isPanelResizing) return;
    const delta = e.clientX - this._panelResizeStartX;
    const newWidth = Math.max(150, Math.min(500, this._panelResizeStartWidth + delta));
    this.leftPanelWidth = newWidth;
  }

  _handlePanelResizeEnd() {
    if (!this._isPanelResizing) return;
    this._isPanelResizing = false;
    localStorage.setItem('promptview-left-panel-width', this.leftPanelWidth);
    window.removeEventListener('mousemove', this._boundPanelResizeMove);
    window.removeEventListener('mouseup', this._boundPanelResizeEnd);
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
        
        // Load the session messages AND populate context manager for token counting
        const messagesResponse = await this.call['LiteLLM.load_session_into_context'](lastSessionId);
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
      
      // Refresh history bar to reflect loaded session
      await this._refreshHistoryBar();
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

  /**
   * Called by server when a compaction event occurs.
   * Explicitly defined here so JRPC-OO can find it.
   * Delegates to mixin implementation.
   */
  compactionEvent(requestId, event) {
    super.compactionEvent(requestId, event);
  }

  render() {
    return renderPromptView(this);
  }
}

customElements.define('prompt-view', PromptView);
