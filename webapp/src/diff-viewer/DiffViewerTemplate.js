import { html } from 'lit';

export function renderDiffViewer(component) {
  const hasFiles = component.files.length > 0;

  return html`
    <div class="container ${!component.visible ? 'hidden' : ''}">
      ${hasFiles ? html`
        <div class="file-tabs">
          <div class="tabs-left">
            ${component.files.map(file => html`
              <button 
                class="file-tab ${component.selectedFile === file.path ? 'active' : ''}"
                @click=${() => component.selectFile(file.path)}
              >
                ${file.path}
                <span class="status ${file.isNew ? 'new' : 'modified'}">
                  ${file.isNew ? 'NEW' : 'MOD'}
                </span>
              </button>
            `)}
          </div>
          <div class="tabs-right">
            <button 
              class="save-btn ${component.isDirty ? 'dirty' : ''}"
              @click=${() => component.saveAllFiles()}
              ?disabled=${!component.isDirty}
              title="Save all changes (Ctrl+S)"
            >
              💾
            </button>
          </div>
        </div>
      ` : html`
        <div class="empty-state">
          <div class="icon">📝</div>
          <div>No changes to display</div>
          <div style="font-size: 13px; color: #555;">
            Send a message to make code changes
          </div>
        </div>
      `}
      <div id="editor-container"></div>
    </div>
  `;
}
