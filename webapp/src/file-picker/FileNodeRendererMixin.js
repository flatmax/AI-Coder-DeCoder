import { html } from 'lit';

/**
 * Mixin for rendering file tree nodes.
 */
export const FileNodeRendererMixin = (superClass) => class extends superClass {

  matchesFilter(node, filter) {
    if (!filter) return true;
    const f = filter.toLowerCase();
    if (node.path) return node.path.toLowerCase().includes(f);
    if (node.children) return node.children.some(c => this.matchesFilter(c, f));
    return false;
  }

  toggleExpand(path) {
    this.expanded = { ...this.expanded, [path]: !this.expanded[path] };
  }

  viewFile(filePath, e) {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('file-view', { 
      detail: { path: filePath },
      bubbles: true,
      composed: true
    }));
  }

  getFileStatus(filePath) {
    const isModified = this.modified.includes(filePath);
    const isStaged = this.staged.includes(filePath);
    const isUntracked = this.untracked.includes(filePath);
    
    let statusClass = 'clean';
    let statusIndicator = '';
    
    if (isStaged && isModified) {
      statusClass = 'staged-modified';
      statusIndicator = 'M';
    } else if (isStaged) {
      statusClass = 'staged';
      statusIndicator = 'A';
    } else if (isModified) {
      statusClass = 'modified';
      statusIndicator = 'M';
    } else if (isUntracked) {
      statusClass = 'untracked';
      statusIndicator = 'U';
    }

    return { statusClass, statusIndicator };
  }

  renderNode(node, path = '') {
    const currentPath = path ? `${path}/${node.name}` : node.name;
    const isDir = !!node.children;
    const visible = this.matchesFilter(node, this.filter);
    
    if (!visible) return '';

    if (isDir) {
      return this.renderDirNode(node, currentPath);
    }
    return this.renderFileNode(node);
  }

  renderDirNode(node, currentPath) {
    const isExpanded = this.expanded[currentPath] ?? (this.filter ? true : false);
    const isFullySelected = this.isDirFullySelected(node, currentPath);
    const isPartiallySelected = this.isDirPartiallySelected(node, currentPath);
    
    return html`
      <div class="node">
        <div class="row">
          <input 
            type="checkbox" 
            .checked=${isFullySelected}
            .indeterminate=${isPartiallySelected}
            @click=${(e) => this.toggleSelectDir(node, currentPath, e)}
          >
          <span class="icon" @click=${() => this.toggleExpand(currentPath)}>${isExpanded ? '▾' : '▸'}</span>
          <span class="name" @click=${() => this.toggleExpand(currentPath)}>${node.name}</span>
        </div>
        <div class="children ${isExpanded ? '' : 'hidden'}">
          ${node.children.map(c => this.renderNode(c, currentPath))}
        </div>
      </div>
    `;
  }

  renderFileNode(node) {
    const filePath = node.path;
    const { statusClass, statusIndicator } = this.getFileStatus(filePath);
    const lineCount = node.lines || 0;
    const stats = this.diffStats?.[filePath];

    return html`
      <div class="node">
        <div class="row">
          <span class="line-count">${lineCount}</span>
          <input 
            type="checkbox" 
            .checked=${!!this.selected[filePath]} 
            @click=${(e) => this.toggleSelect(filePath, e)}
          >
          ${statusIndicator 
            ? html`<span class="status-indicator ${statusClass}">${statusIndicator}</span>` 
            : html`<span class="status-indicator"></span>`
          }
          <span class="name ${statusClass}" @click=${(e) => this.viewFile(filePath, e)}>${node.name}</span>
          ${stats ? html`
            <span class="diff-stats">
              ${stats.additions > 0 ? html`<span class="additions">+${stats.additions}</span>` : ''}
              ${stats.deletions > 0 ? html`<span class="deletions">-${stats.deletions}</span>` : ''}
            </span>
          ` : ''}
        </div>
      </div>
    `;
  }
};
