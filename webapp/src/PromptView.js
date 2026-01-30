import { html } from 'lit';
import { MessageHandler } from './MessageHandler.js';
import { promptViewStyles } from './prompt/PromptViewStyles.js';
import { renderPromptView } from './prompt/PromptViewTemplate.js';
import { FileHandlerMixin } from './prompt/FileHandlerMixin.js';
import { ChatActionsMixin } from './prompt/ChatActionsMixin.js';
import { InputHandlerMixin } from './prompt/InputHandlerMixin.js';
import { WindowControlsMixin } from './prompt/WindowControlsMixin.js';
import { StreamingMixin } from './prompt/StreamingMixin.js';
import { UrlHandlerMixin } from './prompt/UrlHandlerMixin.js';
import './file-picker/FilePicker.js';
import './history-browser/HistoryBrowser.js';
import './find-in-files/FindInFiles.js';
import './context-viewer/ContextViewer.js';

const MixedBase = StreamingMixin(
  UrlHandlerMixin(
    WindowControlsMixin(
      InputHandlerMixin(
        ChatActionsMixin(
          FileHandlerMixin(MessageHandler)
        )
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
    activeLeftTab: { type: String }  // 'files' | 'search' | 'context'
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
    
    const urlParams = new URLSearchParams(window.location.search);
    this.port = urlParams.get('port');
  }

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
    this.initUrlHandler();
    
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
    this.activeLeftTab = tab;
    
    if (tab === 'search') {
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
   * Handle search result selection - bubble up to AppShell
   */
  handleSearchResultSelected(e) {
    this.dispatchEvent(new CustomEvent('search-result-selected', {
      detail: e.detail,
      bubbles: true,
      composed: true
    }));
    // Switch back to files tab to see the result
    this.switchTab('files');
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
            this.addMessage(msg.role, msg.content, msg.images || null);
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
