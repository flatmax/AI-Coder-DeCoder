/**
 * Mixin for file selection operations.
 */
export const FileSelectionMixin = (superClass) => class extends superClass {

  get selectedFiles() {
    return Object.keys(this.selected).filter(k => this.selected[k]);
  }

  toggleSelect(path, e) {
    e.stopPropagation();
    this.selected = { ...this.selected, [path]: !this.selected[path] };
    this.dispatchEvent(new CustomEvent('selection-change', { detail: this.selectedFiles }));
  }

  collectFilesInDir(node, currentPath = '') {
    const files = [];
    if (node.path) {
      files.push(node.path);
    }
    if (node.children) {
      for (const child of node.children) {
        const childPath = currentPath ? `${currentPath}/${child.name}` : child.name;
        files.push(...this.collectFilesInDir(child, childPath));
      }
    }
    return files;
  }

  toggleSelectDir(node, currentPath, e) {
    e.stopPropagation();
    const filesInDir = this.collectFilesInDir(node, currentPath);
    const allSelected = filesInDir.every(f => this.selected[f]);
    
    const newSelected = { ...this.selected };
    for (const file of filesInDir) {
      newSelected[file] = !allSelected;
    }
    this.selected = newSelected;
    this.dispatchEvent(new CustomEvent('selection-change', { detail: this.selectedFiles }));
  }

  isDirFullySelected(node, currentPath) {
    const filesInDir = this.collectFilesInDir(node, currentPath);
    if (filesInDir.length === 0) return false;
    return filesInDir.every(f => this.selected[f]);
  }

  isDirPartiallySelected(node, currentPath) {
    const filesInDir = this.collectFilesInDir(node, currentPath);
    if (filesInDir.length === 0) return false;
    const selectedCount = filesInDir.filter(f => this.selected[f]).length;
    return selectedCount > 0 && selectedCount < filesInDir.length;
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
};
