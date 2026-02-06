import { LitElement, html, css } from 'lit';
import { extractResponse } from '../utils/rpc.js';
import { TABS } from '../utils/constants.js';
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
    if (!promptView) {
      console.warn('_updateTitle: prompt-view not found');
      return;
    }
    
    // Wait for RPC to be ready — listen for the setupDone signal
    // instead of polling with setInterval
    const tryFetchTitle = async () => {
      if (!promptView.call || typeof promptView.call['Repo.get_repo_name'] !== 'function') {
        return false;
      }
      try {
        const response = await promptView.call['Repo.get_repo_name']();
        const repoName = extractResponse(response);
        if (repoName) {
          document.title = repoName;
          return true;
        }
      } catch (err) {
        console.error('Failed to get repo name:', err);
      }
      return false;
    };
    
    // Try immediately in case RPC is already ready
    if (await tryFetchTitle()) return;
    
    // Otherwise wait for the prompt-view to signal it's connected
    const handler = async () => {
      promptView.removeEventListener('rpc-ready', handler);
      // Small delay to ensure call methods are registered
      await new Promise(r => setTimeout(r, 50));
      await tryFetchTitle();
    };
    promptView.addEventListener('rpc-ready', handler);
    
    // Safety timeout — fall back to single retry after 5s
    setTimeout(async () => {
      promptView.removeEventListener('rpc-ready', handler);
      await tryFetchTitle();
    }, 5000);
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
        promptView.switchTab(TABS.SEARCH);
      }
    }
    // Ctrl+B to toggle back to files
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      const promptView = this.shadowRoot?.querySelector('prompt-view');
      if (promptView) {
        promptView.switchTab(TABS.FILES);
      }
    }
  }

  /**
   * Fetch file content via RPC, returning the string or null on failure.
   */
  async _fetchFileContent(file, version = undefined) {
    const promptView = this.shadowRoot.querySelector('prompt-view');
    if (!promptView?.call) return null;
    
    try {
      const args = version ? [file, version] : [file];
      const response = await promptView.call['Repo.get_file_content'](...args);
      const result = extractResponse(response);
      if (typeof result === 'string') return result;
      return result?.content ?? null;
    } catch (err) {
      console.error('Failed to fetch file content:', file, err);
      return null;
    }
  }

  async _loadFileIntoDiff(file, replace = true) {
    // Normalize undefined to true (default behavior)
    const shouldReplace = replace !== false;
    
    const existing = this.diffFiles.find(f => f.path === file);
    if (existing && !shouldReplace) {
      return true; // Already loaded
    }
    
    const content = await this._fetchFileContent(file);
      
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

  async handleFilesEdited(e) {
    const { paths } = e.detail;
    if (!paths || paths.length === 0) return;

    const diffViewer = this.shadowRoot.querySelector('diff-viewer');
    if (!diffViewer) return;

    const openPaths = diffViewer.getOpenFilePaths();
    if (openPaths.length === 0) return;

    // Only refresh files that are both open and edited
    const editedSet = new Set(paths);
    const pathsToRefresh = openPaths.filter(p => editedSet.has(p));
    if (pathsToRefresh.length === 0) return;

    const promptView = this.shadowRoot.querySelector('prompt-view');
    if (!promptView?.call) return;

    await Promise.all(pathsToRefresh.map(async (filePath) => {
      const [original, modified] = await Promise.all([
        this._fetchFileContent(filePath, 'HEAD').then(r => r ?? ''),
        this._fetchFileContent(filePath).then(r => r ?? '')
      ]);
      diffViewer.refreshFileContent(filePath, original, modified);
    }));
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
    const original = await this._fetchFileContent(file, 'HEAD');
    const modified = await this._fetchFileContent(file);
      
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
  }

  clearDiff() {
    this.diffFiles = [];
    this.showDiff = false;
    const diffViewer = this.shadowRoot.querySelector('diff-viewer');
    if (diffViewer) {
      diffViewer.clearFiles();
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

  async handleConfigEditRequest(e) {
    const { configType } = e.detail;
    const promptView = this.shadowRoot.querySelector('prompt-view');
    if (!promptView?.call) {
      console.error('RPC not available for config edit');
      return;
    }

    try {
      // Fetch config content via Settings RPC
      const response = await promptView.call['Settings.get_config_content'](configType);
      const result = extractResponse(response);
      
      if (!result?.success) {
        console.error('Failed to load config:', result?.error);
        return;
      }

      // Load into diff viewer with config file path as identifier
      // Use a special prefix to identify config files
      const configPath = `[config]/${configType}`;
      this.diffFiles = [{
        path: configPath,
        original: result.content,
        modified: result.content,
        isNew: false,
        isReadOnly: false,
        isConfig: true,
        configType: configType,
        realPath: result.path
      }];
      this.viewingFile = configPath;
    } catch (err) {
      console.error('Failed to load config for editing:', err);
    }
  }

  async handleFileSave(e) {
    const { path, content, isConfig, configType } = e.detail;
    const promptView = this.shadowRoot.querySelector('prompt-view');
    if (!promptView?.call) {
      console.error('RPC not available for file save');
      return;
    }

    try {
      if (isConfig && configType) {
        // Save config file via Settings RPC
        const response = await promptView.call['Settings.save_config_content'](configType, content);
        const result = extractResponse(response);
        if (!result?.success) {
          console.error('Failed to save config:', result?.error);
        }
      } else {
        // Save repo file via Repo RPC
        await promptView.call['Repo.write_file'](path, content);
      }
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }

  async handleFilesSave(e) {
    const { files } = e.detail;
    const promptView = this.shadowRoot.querySelector('prompt-view');
    if (!promptView?.call) {
      console.error('RPC not available for file save');
      return;
    }

    for (const file of files) {
      try {
        if (file.isConfig && file.configType) {
          // Save config file via Settings RPC
          const response = await promptView.call['Settings.save_config_content'](file.configType, file.content);
          const result = extractResponse(response);
          if (!result?.success) {
            console.error('Failed to save config:', result?.error);
          }
        } else {
          // Save repo file via Repo RPC
          await promptView.call['Repo.write_file'](file.path, file.content);
        }
      } catch (err) {
        console.error('Failed to save file:', file.path, err);
      }
    }
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
            @files-edited=${this.handleFilesEdited}
            @url-removed=${this.handleUrlRemoved}
            @view-url-content=${this.handleViewUrlContent}
            @search-result-selected=${this.handleSearchResultSelected}
            @search-file-selected=${this.handleSearchFileSelected}
            @context-remove-url=${this.handleRemoveUrl}
            @config-edit-request=${this.handleConfigEditRequest}
          ></prompt-view>
        </div>
      </div>
    `;
  }
}

customElements.define('app-shell', AppShell);
