import { LitElement, html, css } from 'lit';
import '../diff-viewer/DiffViewer.js';
import '../PromptView.js';

export class AppShell extends LitElement {
  static properties = {
    diffFiles: { type: Array },
    showDiff: { type: Boolean },
    serverURI: { type: String },
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
      margin-left: 12px;
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
    // Get server port from URL params or default
    const urlParams = new URLSearchParams(window.location.search);
    const port = urlParams.get('port') || '8765';
    this.serverURI = `ws://localhost:${port}`;
  }

  handleEditsApplied(e) {
    const { files } = e.detail;
    if (files && files.length > 0) {
      this.diffFiles = files;
      this.showDiff = true;
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

  render() {
    return html`
      <div class="app-container">
        <div class="header">
          <h1>AI Coder / DeCoder</h1>
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
              @file-save=${this.handleFileSave}
              @files-save=${this.handleFilesSave}
            ></diff-viewer>
          </div>
        </div>
        <div class="prompt-overlay">
          <prompt-view @edits-applied=${this.handleEditsApplied}></prompt-view>
        </div>
      </div>
    `;
  }
}

customElements.define('app-shell', AppShell);
