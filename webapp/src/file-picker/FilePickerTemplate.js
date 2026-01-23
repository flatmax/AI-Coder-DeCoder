import { html } from 'lit';

export function renderFilePicker(component) {
  return html`
    <div class="container">
      <div class="header">
        <input 
          type="text" 
          placeholder="Filter files..." 
          .value=${component.filter} 
          @input=${e => component.filter = e.target.value}
        >
      </div>
      <div class="tree">
        ${component.tree 
          ? component.renderNode(component.tree) 
          : html`<div style="color:#666;padding:20px;text-align:center;">Loading...</div>`
        }
      </div>
      <div class="actions">
        <button @click=${() => component.selectAll()}>Select All</button>
        <button @click=${() => component.clearAll()}>Clear</button>
        <span class="count">${component.selectedFiles.length} selected</span>
      </div>
    </div>
  `;
}
