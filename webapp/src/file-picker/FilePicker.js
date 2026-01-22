import { LitElement, html, css } from 'lit';

export class FilePicker extends LitElement {
  static properties = {
    tree: { type: Object },
    modified: { type: Array },
    staged: { type: Array },
    selected: { type: Object },
    expanded: { type: Object },
    filter: { type: String }
  };

  static styles = css`
    :host { display: block; font-size: 13px; }
    .container { background: #1a1a2e; }
    .header { padding: 8px 12px; background: #0f3460; display: flex; gap: 8px; }
    input[type="text"] { flex: 1; padding: 6px 10px; border: none; border-radius: 4px; background: #16213e; color: #eee; }
    input[type="text"]:focus { outline: 1px solid #e94560; }
    .tree { max-height: 400px; overflow-y: auto; padding: 8px; }
    .node { padding: 1px 0; }
    .row { 
      display: flex; 
      align-items: center; 
      gap: 6px; 
      padding: 3px 6px; 
      border-radius: 4px; 
      cursor: pointer; 
      line-height: 1;
    }
    .row:hover { background: #0f3460; }
    .children { margin-left: 18px; }
    .icon { 
      width: 14px; 
      height: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      color: #666; 
      flex-shrink: 0;
    }
    .name { color: #eee; flex: 1; }
    .name.modified { color: #f0a500; }
    .name.staged { color: #7ec699; }
    input[type="checkbox"] { 
      margin: 0; 
      width: 14px; 
      height: 14px;
      flex-shrink: 0;
      cursor: pointer;
    }
    .hidden { display: none; }
    .actions { padding: 8px 12px; border-top: 1px solid #0f3460; display: flex; gap: 8px; align-items: center; }
    button { padding: 4px 10px; border: none; border-radius: 4px; background: #0f3460; color: #eee; cursor: pointer; }
    button:hover { background: #1a3a6e; }
    .count { margin-left: auto; color: #7ec699; font-size: 12px; }
  `;

  constructor() {
    super();
    this.tree = null;
    this.modified = [];
    this.staged = [];
    this.selected = {};
    this.expanded = {};
    this.filter = '';
  }

  get selectedFiles() {
    return Object.keys(this.selected).filter(k => this.selected[k]);
  }

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

  toggleSelect(path, e) {
    e.stopPropagation();
    this.selected = { ...this.selected, [path]: !this.selected[path] };
    this.dispatchEvent(new CustomEvent('selection-change', { detail: this.selectedFiles }));
  }

  selectAll() {
    const all = {};
    const collect = (node) => {
      if (node.path) all[node.path] = true;
      node.children?.forEach(collect);
    };
    if (this.tree) collect(this.tree);
    this.selected = all;
    this.dispatchEvent(new CustomEvent('selection-change', { detail: this.selectedFiles }));
  }

  clearAll() {
    this.selected = {};
    this.dispatchEvent(new CustomEvent('selection-change', { detail: this.selectedFiles }));
  }

  renderNode(node, path = '') {
    const currentPath = path ? `${path}/${node.name}` : node.name;
    const isDir = !!node.children;
    const visible = this.matchesFilter(node, this.filter);
    
    if (!visible) return '';

    if (isDir) {
      const isExpanded = this.expanded[currentPath] ?? (this.filter ? true : false);
      return html`
        <div class="node">
          <div class="row" @click=${() => this.toggleExpand(currentPath)}>
            <span class="icon">${isExpanded ? '▾' : '▸'}</span>
            <span class="name">${node.name}</span>
          </div>
          <div class="children ${isExpanded ? '' : 'hidden'}">
            ${node.children.map(c => this.renderNode(c, currentPath))}
          </div>
        </div>
      `;
    }

    const filePath = node.path;
    const isModified = this.modified.includes(filePath);
    const isStaged = this.staged.includes(filePath);
    const statusClass = isStaged ? 'staged' : isModified ? 'modified' : '';

    return html`
      <div class="node">
        <div class="row" @click=${(e) => this.toggleSelect(filePath, e)}>
          <input type="checkbox" .checked=${!!this.selected[filePath]} @click=${(e) => this.toggleSelect(filePath, e)}>
          <span class="name ${statusClass}">${node.name}</span>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="container">
        <div class="header">
          <input type="text" placeholder="Filter files..." .value=${this.filter} @input=${e => this.filter = e.target.value}>
        </div>
        <div class="tree">
          ${this.tree ? this.renderNode(this.tree) : html`<div style="color:#666;padding:20px;text-align:center;">Loading...</div>`}
        </div>
        <div class="actions">
          <button @click=${this.selectAll}>Select All</button>
          <button @click=${this.clearAll}>Clear</button>
          <span class="count">${this.selectedFiles.length} selected</span>
        </div>
      </div>
    `;
  }
}

customElements.define('file-picker', FilePicker);
