import { LitElement, html, css } from 'lit';
import '../diff-viewer/DiffViewer.js';
import '../PromptView.js';
import '../find-in-files/FindInFiles.js';
import '../context-viewer/ContextViewer.js';
import '../context-viewer/UrlContentModal.js';

export class AppShell extends LitElement {
  static properties = {
    diffFiles: { type: Array },
    showDiff: { type: Boolean },
    serverURI: { type: String },
    viewingFile: { type: String },
    activeLeftTab: { type: String },
    excludedUrls: { type: Object }, // Set of URLs excluded from context
    showUrlModal: { type: Boolean },
    urlModalContent: { type: Object },
  };

  static styles = css`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }

    .app-container {
      width: 100%;
      height: 100%;
      position: relative;
      background: #1a1a2e;
    }

    .diff-area {
      width: 100%;
      height: 100%;
    }

    .prompt-overlay {
      position: fixed;
      top: 60px;
      bottom: 20px;
      left: 20px;
      z-index: 1000;
      display: flex;
      flex-direction: column;
    }

    .header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 40px;
      background: #16213e;
      display: flex;
      align-items: center;
      padding: 0 16px;
      z-index: 100;
      border-bottom: 1px solid #0f3460;
      gap: 16px;
    }

    .header h1 {
      font-size: 14px;
      color: #e94560;
      margin: 0;
      font-weight: 600;
    }

    .header .subtitle {
      color: #666;
      font-size: 12px;
    }

    .header-tabs {
      display: flex;
      gap: 4px;
      margin-left: 16px;
    }

    .header-tab {
      padding: 6px 12px;
      background: transparent;
      border: none;
      border-radius: 4px;
      color: #888;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }

    .header-tab:hover {
      color: #ccc;
      background: #0f3460;
    }

    .header-tab.active {
      color: #e94560;
      background: #0f3460;
    }

    .header-tab .icon {
      font-size: 12px;
    }

    .main-content {
      position: absolute;
      top: 40px;
      left: 0;
      right: 0;
      bottom: 0;
    }

    .clear-btn {
      margin-left: auto;
      background: #0f3460;
      color: #eee;
      border: none;
      border-radius: 4px;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 12px;
    }

    .clear-btn:hover {
      background: #1a3a6e;
    }

    .clear-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

  `;

  constructor() {
    super();
    this.diffFiles = [];
    this.showDiff = false;
    this.viewingFile = null;
    this.activeLeftTab = 'files';
    this.excludedUrls = new Set();
    this.showUrlModal = false;
    this.urlModalContent = null;
    // Get server port from URL params or default
    const urlParams = new URLSearchParams(window.location.search);
    const port = urlParams.get('port') || '8765';
    this.serverURI = `ws://localhost:${port}`;
    
    // Bind keyboard handler
    this._handleKeydown = this._handleKeydown.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._handleKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._handleKeydown);
  }

  _handleKeydown(e) {
    // Ctrl+Shift+F to open search
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      this.activeLeftTab = 'search';
      this.updateComplete.then(() => {
        const findInFiles = this.shadowRoot.querySelector('find-in-files');
        if (findInFiles) {
          findInFiles.focusInput();
        }
      });
    }
    // Ctrl+B to toggle back to files
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      this.activeLeftTab = 'files';
    }
  }

  switchTab(tab) {
    this.activeLeftTab = tab;
    if (tab === 'search') {
      this.updateComplete.then(() => {
        const findInFiles = this.shadowRoot.querySelector('find-in-files');
        if (findInFiles) {
          findInFiles.focusInput();
        }
      });
    } else if (tab === 'context') {
      // Use updateComplete to ensure DOM is ready
      this.updateComplete.then(() => {
        this._refreshContextViewer();
      });
    }
  }

  async _loadFileIntoDiff(file) {
    if (this.diffFiles.find(f => f.path === file)) {
      return true; // Already loaded
    }
    
    const promptView = this.shadowRoot.querySelector('prompt-view');
    if (!promptView?.call) {
      return false;
    }
    
    try {
      const response = await promptView.call['Repo.get_file_content'](file);
      const result = response ? Object.values(response)[0] : null;
      const content = typeof result === 'string' ? result : (result?.content ?? null);
      
      if (content !== null) {
        this.diffFiles = [...this.diffFiles, {
          path: file,
          original: content,
          modified: content,
          isNew: false,
          isReadOnly: true
        }];
        return true;
      }
    } catch (err) {
      console.error('Failed to load file:', err);
    }
    return false;
  }

  async handleSearchResultSelected(e) {
    const { file, line } = e.detail;
    this.viewingFile = file;
    this.activeLeftTab = 'files';
    
    await this._loadFileIntoDiff(file);
    await this.updateComplete;
    
    const diffViewer = this.shadowRoot.querySelector('diff-viewer');
    if (diffViewer) {
      setTimeout(() => {
        diffViewer.selectFile(file);
        setTimeout(() => {
          diffViewer._revealPosition(line, 1);
        }, 150);
      }, 100);
    }
  }

  async handleSearchFileSelected(e) {
    const { file } = e.detail;
    this.viewingFile = file;
    await this._loadFileIntoDiff(file);
  }

  handleCloseSearch() {
    this.activeLeftTab = 'files';
  }

  handleFileSelected(e) {
    this.viewingFile = e.detail.path;
  }

  handleEditsApplied(e) {
    const { files } = e.detail;
    if (files && files.length > 0) {
      this.diffFiles = files;
      this.showDiff = true;
    }
  }

  async handleNavigateToEdit(e) {
    const { path, line, searchContext } = e.detail;
    this.viewingFile = path;
    
    // Load the file if not already in diff viewer
    const alreadyLoaded = this.diffFiles.find(f => f.path === path);
    if (!alreadyLoaded) {
      const loaded = await this._loadFileIntoDiff(path);
      if (!loaded) {
        return;
      }
    }
    
    await this.updateComplete;
    
    // Navigate to the line in the diff viewer
    const diffViewer = this.shadowRoot.querySelector('diff-viewer');
    if (diffViewer) {
      setTimeout(() => {
        diffViewer.selectFile(path);
        setTimeout(() => {
          // Try to find line by searching for context, fall back to line number
          const targetLine = searchContext 
            ? diffViewer._findLineByContent(searchContext) || line
            : line;
          if (targetLine) {
            diffViewer._revealPosition(targetLine, 1);
          }
        }, 150);
      }, 100);
    }
  }

  clearDiff() {
    this.diffFiles = [];
    this.showDiff = false;
    const diffViewer = this.shadowRoot.querySelector('diff-viewer');
    if (diffViewer) {
      diffViewer.clearFiles();
    }
  }

  async handleFileSave(e) {
    const { path, content } = e.detail;
    const promptView = this.shadowRoot.querySelector('prompt-view');
    if (promptView && promptView.call) {
      try {
        await promptView.call['Repo.write_file'](path, content);
      } catch (err) {
        console.error('Failed to save file:', err);
      }
    }
  }

  async handleFilesSave(e) {
    const { files } = e.detail;
    const promptView = this.shadowRoot.querySelector('prompt-view');
    if (promptView && promptView.call) {
      for (const file of files) {
        try {
          await promptView.call['Repo.write_file'](file.path, file.content);
        } catch (err) {
          console.error('Failed to save file:', file.path, err);
        }
      }
    }
  }

  _getPromptViewRpcCall() {
    const promptView = this.shadowRoot?.querySelector('prompt-view');
    return promptView?.call || null;
  }

  _getSelectedFiles() {
    const promptView = this.shadowRoot?.querySelector('prompt-view');
    return promptView?.selectedFiles || [];
  }

  _getFetchedUrls() {
    const promptView = this.shadowRoot?.querySelector('prompt-view');
    const urlsObj = promptView?.fetchedUrls || {};
    return Object.keys(urlsObj);
  }

  _getIncludedUrls() {
    const allUrls = this._getFetchedUrls();
    return allUrls.filter(url => !this.excludedUrls.has(url));
  }

  handleUrlInclusionChanged(e) {
    const { url, included } = e.detail;
    const newExcluded = new Set(this.excludedUrls);
    if (included) {
      newExcluded.delete(url);
    } else {
      newExcluded.add(url);
    }
    this.excludedUrls = newExcluded;
    
    // Sync to PromptView
    const promptView = this.shadowRoot?.querySelector('prompt-view');
    if (promptView) {
      promptView.excludedUrls = newExcluded;
    }
    
    // Sync to ContextViewer
    const contextViewer = this.shadowRoot?.querySelector('context-viewer');
    if (contextViewer) {
      contextViewer.excludedUrls = newExcluded;
      contextViewer.refreshBreakdown();
    }
  }

  async _refreshContextViewer() {
    await this.updateComplete;
    const contextViewer = this.shadowRoot?.querySelector('context-viewer');
    const promptView = this.shadowRoot?.querySelector('prompt-view');
    
    if (contextViewer && promptView?.call) {
      contextViewer.rpcCall = promptView.call;
      contextViewer.selectedFiles = promptView.selectedFiles || [];
      // fetchedUrls is an object with URL keys, convert to array
      const urlsObj = promptView.fetchedUrls || {};
      contextViewer.fetchedUrls = Object.keys(urlsObj);
      // Force refresh after setting properties
      contextViewer.refreshBreakdown();
    }
  }

  handleRemoveUrl(e) {
    const { url } = e.detail;
    const promptView = this.shadowRoot?.querySelector('prompt-view');
    if (promptView && promptView.fetchedUrls) {
      // fetchedUrls is an object with URL keys, not an array
      const { [url]: removed, ...remaining } = promptView.fetchedUrls;
      promptView.fetchedUrls = remaining;
      // Refresh the context viewer with updated data
      this._refreshContextViewer();
    }
  }

  handleUrlRemoved(e) {
    // URL was removed from PromptView, refresh the Context Viewer
    this._refreshContextViewer();
  }

  handleViewUrlContent(e) {
    const { content } = e.detail;
    this.urlModalContent = content;
    this.showUrlModal = true;
  }

  closeUrlModal() {
    this.showUrlModal = false;
    this.urlModalContent = null;
  }

  render() {
    return html`
      <url-content-modal
        .open=${this.showUrlModal}
        .url=${this.urlModalContent?.url || ''}
        .content=${this.urlModalContent}
        @close=${this.closeUrlModal}
      ></url-content-modal>
      <div class="app-container">
        <div class="header">
          <h1>AI Coder / DeCoder</h1>
          <div class="header-tabs">
            <button 
              class="header-tab ${this.activeLeftTab === 'files' ? 'active' : ''}"
              @click=${() => this.switchTab('files')}
            >
              <span class="icon">📁</span> Files
            </button>
            <button 
              class="header-tab ${this.activeLeftTab === 'search' ? 'active' : ''}"
              @click=${() => this.switchTab('search')}
            >
              <span class="icon">🔍</span> Search
            </button>
            <button 
              class="header-tab ${this.activeLeftTab === 'context' ? 'active' : ''}"
              @click=${() => this.switchTab('context')}
            >
              <span class="icon">📊</span> Context
            </button>
          </div>
          <span class="subtitle">Code changes will appear here</span>
          <button 
            class="clear-btn" 
            @click=${this.clearDiff}
            ?disabled=${this.diffFiles.length === 0}
          >
            Clear Diff
          </button>
        </div>
        <div class="main-content">
          <div class="diff-area">
            <diff-viewer
              .files=${this.diffFiles}
              .visible=${true}
              .serverURI=${this.serverURI}
              .viewingFile=${this.viewingFile}
              @file-save=${this.handleFileSave}
              @files-save=${this.handleFilesSave}
              @file-selected=${this.handleFileSelected}
            ></diff-viewer>
          </div>
        </div>
        <div class="prompt-overlay">
          <prompt-view 
            .viewingFile=${this.viewingFile}
            @edits-applied=${this.handleEditsApplied}
            @navigate-to-edit=${this.handleNavigateToEdit}
            @url-removed=${this.handleUrlRemoved}
            @url-inclusion-changed=${this.handleUrlInclusionChanged}
            @view-url-content=${this.handleViewUrlContent}
            style="${this.activeLeftTab === 'files' ? '' : 'display: none;'}"
          ></prompt-view>
          <find-in-files
            .rpcCall=${this._getPromptViewRpcCall()}
            @result-selected=${this.handleSearchResultSelected}
            @file-selected=${this.handleSearchFileSelected}
            @close-search=${this.handleCloseSearch}
            style="${this.activeLeftTab === 'search' ? '' : 'display: none;'}"
          ></find-in-files>
          <context-viewer
            .rpcCall=${this._getPromptViewRpcCall()}
            .selectedFiles=${this._getSelectedFiles()}
            .fetchedUrls=${this._getFetchedUrls()}
            .excludedUrls=${this.excludedUrls}
            @remove-url=${this.handleRemoveUrl}
            @url-inclusion-changed=${this.handleUrlInclusionChanged}
            style="${this.activeLeftTab === 'context' ? '' : 'display: none;'}"
          ></context-viewer>
        </div>
      </div>
    `;
  }
}

customElements.define('app-shell', AppShell);
