import { html } from 'lit';

function renderToast(component) {
  if (!component.message) return '';
  
  return html`
    <div 
      class="toast ${component.message.type}"
      @click=${() => component.dismissMessage()}
    >
      ${component.message.type === 'success' ? '✓' : '✗'}
      ${component.message.text}
    </div>
  `;
}

function renderLlmSection(component) {
  const model = component.configInfo?.model || 'Loading...';
  const smallerModel = component.configInfo?.smaller_model || 'Loading...';
  
  return html`
    <div class="section">
      <h3 class="section-title">LLM Configuration</h3>
      
      <div class="config-label">Model</div>
      <div class="config-value">${model}</div>
      
      <div class="config-label">Smaller Model</div>
      <div class="config-value">${smallerModel}</div>
      
      <div class="button-row">
        <button 
          class="secondary"
          @click=${() => component.editConfig('llm')}
          ?disabled=${component.isLoading}
        >
          📝 Edit llm.json
        </button>
        <button 
          class="primary"
          @click=${() => component.reloadLlmConfig()}
          ?disabled=${component.isLoading}
        >
          🔄 Reload
        </button>
      </div>
    </div>
  `;
}

function renderAppSection(component) {
  return html`
    <div class="section">
      <h3 class="section-title">App Configuration</h3>
      
      <div class="button-row">
        <button 
          class="secondary"
          @click=${() => component.editConfig('app')}
          ?disabled=${component.isLoading}
        >
          📝 Edit app.json
        </button>
        <button 
          class="primary"
          @click=${() => component.reloadAppConfig()}
          ?disabled=${component.isLoading}
        >
          🔄 Reload
        </button>
      </div>
      
      <div class="note info">
        ℹ️ Some settings (e.g., cache tier thresholds) may require restart to take effect.
      </div>
    </div>
  `;
}

function renderPromptsSection(component) {
  return html`
    <div class="section">
      <h3 class="section-title">Prompts (live-reloaded)</h3>
      
      <div class="file-list">
        <button 
          class="file-button"
          @click=${() => component.editConfig('system')}
          ?disabled=${component.isLoading}
        >
          📄 system.md
        </button>
        <button 
          class="file-button"
          @click=${() => component.editConfig('system_extra')}
          ?disabled=${component.isLoading}
        >
          📄 system_extra.md
        </button>
        <button 
          class="file-button"
          @click=${() => component.editConfig('snippets')}
          ?disabled=${component.isLoading}
        >
          📄 prompt-snippets.json
        </button>
      </div>
      
      <div class="note">
        These files are read fresh on each use. No reload needed.
      </div>
    </div>
  `;
}

function renderSkillsSection(component) {
  return html`
    <div class="section">
      <h3 class="section-title">Skills (live-reloaded)</h3>
      
      <div class="file-list">
        <button 
          class="file-button"
          @click=${() => component.editConfig('compaction')}
          ?disabled=${component.isLoading}
        >
          📄 compaction.md
        </button>
      </div>
      
      <div class="note">
        Skill prompts are read fresh when invoked.
      </div>
    </div>
  `;
}

export function renderSettingsPanel(component) {
  return html`
    <h2>⚙️ Settings</h2>
    
    <div class="${component.isLoading ? 'loading' : ''}">
      ${renderLlmSection(component)}
      ${renderAppSection(component)}
      ${renderPromptsSection(component)}
      ${renderSkillsSection(component)}
    </div>
    
    ${renderToast(component)}
  `;
}
