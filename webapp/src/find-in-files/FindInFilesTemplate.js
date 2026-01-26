import { html } from 'lit';

function renderSearchOptions(component) {
  return html`
    <div class="search-options">
      <button 
        class="option-btn ${component.ignoreCase ? '' : 'active'}"
        @click=${() => component.toggleOption('ignoreCase')}
        title="Match Case"
      >Aa</button>
      <button 
        class="option-btn ${component.useRegex ? 'active' : ''}"
        @click=${() => component.toggleOption('useRegex')}
        title="Use Regular Expression"
      >.*</button>
      <button 
        class="option-btn ${component.wholeWord ? 'active' : ''}"
        @click=${() => component.toggleOption('wholeWord')}
        title="Match Whole Word"
      >W</button>
    </div>
  `;
}

function renderEmptyState(component) {
  if (component.isSearching) {
    return html`
      <div class="loading">
        <div class="spinner"></div>
        <span>Searching...</span>
      </div>
    `;
  }

  if (component.error) {
    return html`
      <div class="error-state">
        ⚠ ${component.error}
      </div>
    `;
  }

  if (component.query && component.results.length === 0 && component.searchPerformed) {
    return html`
      <div class="empty-state">
        <div class="icon">🔍</div>
        <div>No results found</div>
        <div class="hint">for "${component.query}"</div>
      </div>
    `;
  }

  return html`
    <div class="empty-state">
      <div class="icon">🔍</div>
      <div>Type to search across all files</div>
      <div class="hint">Ctrl+Shift+F to focus • ↑↓ to navigate</div>
    </div>
  `;
}

function renderMatchContent(content, query, useRegex, ignoreCase) {
  if (!query) return content;
  
  try {
    const flags = ignoreCase ? 'gi' : 'g';
    const pattern = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${pattern})`, flags);
    const parts = content.split(regex);
    
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        return html`<span class="highlight">${part}</span>`;
      }
      return part;
    });
  } catch (e) {
    return content;
  }
}

function renderContextLines(lines, label) {
  if (!lines || lines.length === 0) return '';
  
  return html`
    ${lines.map(ctx => html`
      <div class="context-line">
        <span class="line-num">${ctx.line_num}</span>
        <span class="match-content">${ctx.line}</span>
      </div>
    `)}
  `;
}

function renderMatchItem(component, fileResult, match, flatIndex) {
  const isFocused = component.focusedIndex === flatIndex;
  const isHovered = component.hoveredIndex === flatIndex;
  const showContext = isFocused || isHovered;
  const hasContext = (match.context_before?.length > 0) || (match.context_after?.length > 0);
  
  return html`
    <div 
      class="match-item ${isFocused ? 'focused' : ''} ${showContext && hasContext ? 'show-context' : ''}"
      @click=${() => component.selectResult(fileResult.file, match.line_num)}
      @mouseenter=${() => component.setHoveredIndex(flatIndex)}
      @mouseleave=${() => component.clearHoveredIndex()}
    >
      ${hasContext ? html`
        <div class="context-lines">
          ${renderContextLines(match.context_before)}
        </div>
      ` : ''}
      <div class="match-line">
        <span class="line-num">${match.line_num}</span>
        <span class="match-content">
          ${renderMatchContent(match.line, component.query, component.useRegex, component.ignoreCase)}
        </span>
      </div>
      ${hasContext ? html`
        <div class="context-lines">
          ${renderContextLines(match.context_after)}
        </div>
      ` : ''}
    </div>
  `;
}

function renderResults(component) {
  if (component.results.length === 0) {
    return renderEmptyState(component);
  }

  let flatIndex = 0;
  
  return html`
    ${component.results.map(fileResult => {
      const fileMatches = fileResult.matches.map(match => {
        const item = renderMatchItem(component, fileResult, match, flatIndex);
        flatIndex++;
        return item;
      });
      
      return html`
        <div class="file-group">
          <div 
            class="file-header"
            @click=${() => component.toggleFileExpanded(fileResult.file)}
          >
            <span class="icon ${component.expandedFiles[fileResult.file] !== false ? 'expanded' : ''}">▶</span>
            <span class="file-name">${fileResult.file}</span>
            <span class="match-count">(${fileResult.matches.length})</span>
          </div>
          ${component.expandedFiles[fileResult.file] !== false ? html`
            <div class="match-list">
              ${fileMatches}
            </div>
          ` : ''}
        </div>
      `;
    })}
  `;
}

function getTotalMatches(results) {
  return results.reduce((sum, file) => sum + file.matches.length, 0);
}

export function renderFindInFiles(component) {
  const totalMatches = getTotalMatches(component.results);
  const fileCount = component.results.length;

  return html`
    <div class="container">
      <div class="search-header">
        <div class="search-input-row">
          <input
            type="text"
            placeholder="Search in files..."
            .value=${component.query}
            @input=${(e) => component.handleSearchInput(e)}
            @keydown=${(e) => component.handleKeydown(e)}
          >
        </div>
        ${renderSearchOptions(component)}
      </div>
      ${totalMatches > 0 ? html`
        <div class="results-summary">
          ${totalMatches} result${totalMatches !== 1 ? 's' : ''} in ${fileCount} file${fileCount !== 1 ? 's' : ''}
        </div>
      ` : ''}
      <div class="results-list">
        ${renderResults(component)}
      </div>
    </div>
  `;
}
