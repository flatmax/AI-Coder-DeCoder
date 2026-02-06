import { html } from 'lit';

export function renderSnippetButtons(component) {
  if (!component.promptSnippets || component.promptSnippets.length === 0) {
    return '';
  }
  
  return html`
    <div class="snippet-drawer ${component.snippetDrawerOpen ? 'open' : ''}">
      <button 
        class="snippet-drawer-toggle ${component.snippetDrawerOpen ? 'open' : ''}" 
        @click=${() => component.toggleSnippetDrawer()}
        title="${component.snippetDrawerOpen ? 'Close snippets' : 'Open snippets'}"
      >📋</button>
      <div class="snippet-drawer-content">
        ${component.promptSnippets.map(snippet => html`
          <button 
            class="snippet-btn" 
            @click=${() => component.appendSnippet(snippet.message)}
            title="${snippet.tooltip}"
          >${snippet.icon}</button>
        `)}
      </div>
    </div>
  `;
}
