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
import { extractResponse as _extractResponse } from './utils/rpc.js';
import { TABS } from './utils/constants.js';
import './file-picker/FilePicker.js';

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
    this.activeLeftTab = TABS.FILES;
    this.promptSnippets = [];
    this.snippetDrawerOpen = false;
    this.filePickerExpanded = {};
    this._visitedTabs = new Set([TABS.FILES]);
    this._selectedObject = {};
    this._addableFiles = [];
    this.leftPanelWidth = parseInt(localStorage.getItem('promptview-left-panel-width')) || 280;
    this.leftPanelCollapsed = localStorage.getItem('promptview-left-panel-collapsed') === 'true';
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

  willUpdate(changedProperties) {
    if (changedProperties.has('selectedFiles')) {
      const selected = {};
      for (const path of this.selectedFiles || []) {
        selected[path] = true;
      }
      this._selectedObject = selected;

      // Stabilize array reference — only replace if contents actually changed
      const prev = this._stableSelectedFiles;
      const curr = this.selectedFiles || [];
      if (!prev || prev.length !== curr.length || curr.some((f, i) => f !== prev[i])) {
        this._stableSelectedFiles = curr;
      } else {
        this.selectedFiles = prev;
      }
    }
    if (changedProperties.has('fileTree')) {
      // Memoize: only rebuild if tree actually changed
      const newFiles = this.getAddableFiles();
      const prev = this._addableFiles;
      if (!prev || prev.length !== newFiles.length || newFiles.some((f, i) => f !== prev[i])) {
        this._addableFiles = newFiles;
      }
    }
  }

  // ============ History Browser ============

  async toggleHistoryBrowser() {
    if (!this.showHistoryBrowser) {
      await import('./history-browser/HistoryBrowser.js');
    }
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
    
    // Scroll to bottom after loading session (double rAF for content-visibility)
    await this.updateComplete;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.scrollToBottomNow());
    });
    
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
    this.setupScrollObserver();
    
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
  async switchTab(tab) {
    // Lazy-load tab components on first visit
    if (!this._visitedTabs.has(tab)) {
      switch (tab) {
        case TABS.SEARCH:
          await import('./find-in-files/FindInFiles.js');
          break;
        case TABS.CONTEXT:
          await import('./context-viewer/ContextViewer.js');
          break;
        case TABS.CACHE:
          await import('./context-viewer/CacheViewer.js');
          break;
        case TABS.SETTINGS:
          await import('./settings/SettingsPanel.js');
          break;
      }
    }

    this._visitedTabs.add(tab);
    this.activeLeftTab = tab;

    if (tab === TABS.SEARCH) {
      this.updateComplete.then(() => {
        const findInFiles = this.shadowRoot?.querySelector('find-in-files');
        if (findInFiles) {
          findInFiles.focusInput();
        }
      });
    } else if (tab === TABS.CONTEXT) {
      this.updateComplete.then(() => {
        this._refreshViewer('context-viewer');
      });
    } else if (tab === TABS.CACHE) {
      this.updateComplete.then(() => {
        this._refreshViewer('cache-viewer');
      });
    } else if (tab === TABS.SETTINGS) {
      this.updateComplete.then(() => {
        this._refreshSettingsPanel();
      });
    }
  }

  /**
   * Refresh a viewer component (context-viewer or cache-viewer) with current state.
   * Properties flow via template bindings; we just trigger the refresh and sync history bar.
   */
  async _refreshViewer(selector) {
    const viewer = this.shadowRoot?.querySelector(selector);
    if (viewer && this.call) {
      await viewer.refreshBreakdown();
      
      // Sync history bar with viewer's breakdown data
      if (viewer.breakdown) {
        this._syncHistoryBarFromBreakdown(viewer.breakdown);
      }
    }
  }

  /**
   * Refresh the settings panel
   */
  async _refreshSettingsPanel() {
    const settingsPanel = this.shadowRoot?.querySelector('settings-panel');
    if (settingsPanel) {
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
    if (this._refreshHistoryBarPromise) return this._refreshHistoryBarPromise;
    
    this._refreshHistoryBarPromise = (async () => {
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
    })();
    
    try { await this._refreshHistoryBarPromise; }
    finally { this._refreshHistoryBarPromise = null; }
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
    this.disconnectScrollObserver();
    this.removeEventListener('edit-block-click', this._handleEditBlockClick);
    this._urlService?.destroy();
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
      const sessions = this.extractResponse(sessionsResponse);
      
      if (sessions && sessions.length > 0) {
        const lastSessionId = sessions[0].session_id;
        
        // Load the session messages AND populate context manager for token counting
        const messagesResponse = await this.call['LiteLLM.load_session_into_context'](lastSessionId);
        const messages = this.extractResponse(messagesResponse);
        
        if (messages && messages.length > 0) {
          // Load messages into chat history
          for (const msg of messages) {
            this.addMessage(msg.role, msg.content, msg.images || null, msg.edit_results || null);
          }
          
          // Scroll to bottom after loading session (double rAF for content-visibility)
          await this.updateComplete;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => this.scrollToBottomNow());
          });
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
    return _extractResponse(response);
  }

  /**
   * Called by server when a chunk of the response is available.
   * Explicitly defined here so JRPC-OO can find it.
   * Delegates to mixin implementation.
   * IMPORTANT: Must return a value for JRPC response to be sent.
   */
  streamChunk(requestId, content) {
    try {
      super.streamChunk(requestId, content);
      return true;  // Acknowledge receipt
    } catch (e) {
      console.error('streamChunk error:', e);
      return false;
    }
  }

  /**
   * Called by server when streaming is complete.
   * Explicitly defined here so JRPC-OO can find it.
   * Delegates to mixin implementation.
   * IMPORTANT: Must return a value for JRPC response to be sent.
   * Note: Don't await - fire-and-forget to prevent blocking the JRPC response.
   */
  streamComplete(requestId, result) {
    // Fire-and-forget: run async work in background, return immediately
    // This ensures JRPC response is sent promptly
    Promise.resolve().then(async () => {
      try {
        await super.streamComplete(requestId, result);
      } catch (e) {
        console.error('streamComplete async error:', e);
      }
    });
    return true;  // Acknowledge receipt immediately
  }

  /**
   * Called by server when a compaction event occurs.
   * Explicitly defined here so JRPC-OO can find it.
   * Delegates to mixin implementation.
   * IMPORTANT: Must return a value for JRPC response to be sent.
   */
  compactionEvent(requestId, event) {
    try {
      super.compactionEvent(requestId, event);
      return true;  // Acknowledge receipt
    } catch (e) {
      console.error('compactionEvent error:', e);
      return false;
    }
  }

  render() {
    return renderPromptView(this);
  }
}

customElements.define('prompt-view', PromptView);
