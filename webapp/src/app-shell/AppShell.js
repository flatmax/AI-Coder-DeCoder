import { LitElement, html, css } from 'lit';
import '../diff-viewer/DiffViewer.js';
import '../PromptView.js';
import '../context-viewer/UrlContentModal.js';

export class AppShell extends LitElement {
  static properties = {
    diffFiles: { type: Array },
    showDiff: { type: Boolean },
    serverURI: { type: String },
    viewingFile: { type: String },
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
      top: 20px;
      bottom: 20px;
      left: 20px;
      z-index: 1000;
      display: flex;
      flex-direction: column;
    }

  `;

  constructor() {
    super();
    this.diffFiles = [];
    this.showDiff = false;
    this.viewingFile = null;
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
    this._updateTitle();
  }

  async _updateTitle() {
    // Wait for prompt-view to be ready and connected
    await this.updateComplete;
    const promptView = this.shadowRoot?.querySelector('prompt-view');
    if (promptView) {
      // Wait for RPC to be ready
      const checkRpc = setInterval(async () => {
        if (promptView.call) {
          clearInterval(checkRpc);
          try {
            const response = await promptView.call['Repo.get_repo_name']();
            const repoName = response ? Object.values(response)[0] : null;
            if (repoName) {
              document.title = repoName;
            }
          } catch (err) {
            console.error('Failed to get repo name:', err);
          }
        }
      }, 100);
      // Stop checking after 10 seconds
      setTimeout(() => clearInterval(checkRpc), 10000);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._handleKeydown);
  }

  _handleKeydown(e) {
    // Ctrl+Shift+F to open search
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      const promptView = this.shadowRoot?.querySelector('prompt-view');
      if (promptView) {
        promptView.switchTab('search');
      }
    }
    // Ctrl+B to toggle back to files
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      const promptView = this.shadowRoot?.querySelector('prompt-view');
      if (promptView) {
        promptView.switchTab('files');
      }
    }
  }

  async _loadFileIntoDiff(file, replace = true) {
    // Normalize undefined to true (default behavior)
    const shouldReplace = replace !== false;
    
    const existing = this.diffFiles.find(f => f.path === file);
    if (existing && !shouldReplace) {
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
        const newFile = {
          path: file,
          original: content,
          modified: content,
          isNew: false,
          isReadOnly: true
        };
        
        if (shouldReplace) {
          // Replace all files with just this one (LSP navigation mode)
          this.diffFiles = [newFile];
        } else {
          // Add to existing files
          this.diffFiles = [...this.diffFiles, newFile];
        }
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
    const { path, line, searchContext, status } = e.detail;
    this.viewingFile = path;
    
    // Check if the file is already in diff viewer with a real diff
    const alreadyLoaded = this.diffFiles.find(f => f.path === path);
    const hasDiff = alreadyLoaded && alreadyLoaded.original !== alreadyLoaded.modified;
    
    if (hasDiff) {
      // Already have a good diff, just navigate to it
    } else if (status === 'applied') {
      // For applied edits, reconstruct diff from HEAD vs working copy
      const loaded = await this._loadDiffFromHead(path);
      if (!loaded) {
        // Fallback to read-only view
        await this._loadFileIntoDiff(path);
      }
    } else if (!alreadyLoaded) {
      // For failed/pending edits or unknown, load read-only
      await this._loadFileIntoDiff(path);
    }
    
    await this.updateComplete;
    
    // Navigate to the line in the diff viewer
    const diffViewer = this.shadowRoot.querySelector('diff-viewer');
    if (diffViewer) {
      setTimeout(() => {
        diffViewer.selectFile(path);
        setTimeout(() => {
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

  /**
   * Load a file diff by comparing HEAD (committed) vs working copy.
   * Used for viewing applied edits from history.
   */
  async _loadDiffFromHead(file) {
    const promptView = this.shadowRoot.querySelector('prompt-view');
    if (!promptView?.call) {
      return false;
    }
    
    try {
      // Get committed version from HEAD
      const headResponse = await promptView.call['Repo.get_file_content'](file, 'HEAD');
      const headResult = headResponse ? Object.values(headResponse)[0] : null;
      const original = typeof headResult === 'string' ? headResult : (headResult?.content ?? null);
      
      // Get current working copy
      const workingResponse = await promptView.call['Repo.get_file_content'](file);
      const workingResult = workingResponse ? Object.values(workingResponse)[0] : null;
      const modified = typeof workingResult === 'string' ? workingResult : (workingResult?.content ?? null);
      
      if (original === null || modified === null) {
        return false;
      }
      
      // Only show diff if there are actual changes
      if (original === modified) {
        // No uncommitted changes - file may have been committed already
        // Fall back to read-only view
        return false;
      }
      
      this.diffFiles = [{
        path: file,
        original: original,
        modified: modified,
        isNew: false,
        isReadOnly: false
      }];
      
      return true;
    } catch (err) {
      console.error('Failed to load diff from HEAD:', err);
      return false;
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

  async handleRequestFileLoad(e) {
    const { file, line, column, replace } = e.detail;
    const loaded = await this._loadFileIntoDiff(file, replace);
    if (loaded && (line || column)) {
      await this.updateComplete;
      const diffViewer = this.shadowRoot.querySelector('diff-viewer');
      if (diffViewer) {
        setTimeout(() => {
          diffViewer.selectFile(file);
          if (line) {
            setTimeout(() => {
              diffViewer._revealPosition(line, column || 1);
            }, 150);
          }
        }, 100);
      }
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
        <div class="diff-area">
          <diff-viewer
            .files=${this.diffFiles}
            .visible=${true}
            .serverURI=${this.serverURI}
            .viewingFile=${this.viewingFile}
            @file-save=${this.handleFileSave}
            @files-save=${this.handleFilesSave}
            @file-selected=${this.handleFileSelected}
            @request-file-load=${this.handleRequestFileLoad}
          ></diff-viewer>
        </div>
        <div class="prompt-overlay">
          <prompt-view 
            .viewingFile=${this.viewingFile}
            @edits-applied=${this.handleEditsApplied}
            @navigate-to-edit=${this.handleNavigateToEdit}
            @url-removed=${this.handleUrlRemoved}
            @view-url-content=${this.handleViewUrlContent}
            @search-result-selected=${this.handleSearchResultSelected}
            @search-file-selected=${this.handleSearchFileSelected}
            @context-remove-url=${this.handleRemoveUrl}
          ></prompt-view>
        </div>
      </div>
    `;
  }
}

customElements.define('app-shell', AppShell);
