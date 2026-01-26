import { LitElement, html } from 'lit';
import { findInFilesStyles } from './FindInFilesStyles.js';
import { renderFindInFiles } from './FindInFilesTemplate.js';

export class FindInFiles extends LitElement {
  static properties = {
    query: { type: String },
    results: { type: Array },
    isSearching: { type: Boolean },
    searchPerformed: { type: Boolean },
    error: { type: String },
    ignoreCase: { type: Boolean },
    useRegex: { type: Boolean },
    wholeWord: { type: Boolean },
    expandedFiles: { type: Object },
    rpcCall: { type: Object },
    focusedIndex: { type: Number },
    hoveredIndex: { type: Number }
  };

  static styles = findInFilesStyles;

  constructor() {
    super();
    this.query = '';
    this.results = [];
    this.isSearching = false;
    this.searchPerformed = false;
    this.error = null;
    this.ignoreCase = true;
    this.useRegex = false;
    this.wholeWord = false;
    this.expandedFiles = {};
    this._searchDebounceTimer = null;
    this.focusedIndex = -1;
    this.hoveredIndex = -1;
  }

  // Build flat list of all matches for keyboard navigation
  _getFlatMatches() {
    const flat = [];
    for (const fileResult of this.results) {
      for (const match of fileResult.matches) {
        flat.push({ file: fileResult.file, match });
      }
    }
    return flat;
  }

  handleSearchInput(e) {
    this.query = e.target.value;
    this.error = null;
    this.focusedIndex = -1;
    
    if (this._searchDebounceTimer) {
      clearTimeout(this._searchDebounceTimer);
    }
    
    if (this.query.trim()) {
      this._searchDebounceTimer = setTimeout(() => this.performSearch(), 300);
    } else {
      this.results = [];
      this.searchPerformed = false;
      this.isSearching = false;
    }
  }

  handleKeydown(e) {
    const flatMatches = this._getFlatMatches();
    
    if (e.key === 'Escape') {
      if (this.query) {
        this.query = '';
        this.results = [];
        this.searchPerformed = false;
        this.focusedIndex = -1;
      } else {
        this.dispatchEvent(new CustomEvent('close-search', {
          bubbles: true,
          composed: true
        }));
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatMatches.length > 0) {
        this.focusedIndex = Math.min(this.focusedIndex + 1, flatMatches.length - 1);
        this._scrollToFocused();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatMatches.length > 0) {
        this.focusedIndex = Math.max(this.focusedIndex - 1, 0);
        this._scrollToFocused();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.focusedIndex >= 0 && this.focusedIndex < flatMatches.length) {
        const { file, match } = flatMatches[this.focusedIndex];
        this.selectResult(file, match.line_num);
      } else if (flatMatches.length > 0) {
        // If nothing focused, select first result
        const { file, match } = flatMatches[0];
        this.selectResult(file, match.line_num);
      }
    }
  }

  _scrollToFocused() {
    this.updateComplete.then(() => {
      const focused = this.shadowRoot?.querySelector('.match-item.focused');
      if (focused) {
        focused.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  setHoveredIndex(index) {
    this.hoveredIndex = index;
  }

  clearHoveredIndex() {
    this.hoveredIndex = -1;
  }

  async performSearch() {
    if (!this.query.trim()) {
      this.results = [];
      this.searchPerformed = false;
      return;
    }

    this.isSearching = true;
    this.error = null;
    this.focusedIndex = -1;

    try {
      const response = await this._call(
        'Repo.search_files',
        this.query,
        this.wholeWord,
        this.useRegex,
        this.ignoreCase,
        4  // context_lines
      );
      
      const results = this._extractResponse(response);
      
      if (Array.isArray(results)) {
        this.results = results;
      } else if (results?.error) {
        this.error = results.error;
        this.results = [];
      } else {
        this.results = [];
      }
    } catch (e) {
      this.error = e.message || 'Search failed';
      this.results = [];
    }

    this.isSearching = false;
    this.searchPerformed = true;
  }

  toggleOption(option) {
    if (option === 'ignoreCase') {
      this.ignoreCase = !this.ignoreCase;
    } else if (option === 'useRegex') {
      this.useRegex = !this.useRegex;
    } else if (option === 'wholeWord') {
      this.wholeWord = !this.wholeWord;
    }
    
    // Re-search with new options
    if (this.query.trim()) {
      this.performSearch();
    }
  }

  toggleFileExpanded(filePath) {
    this.expandedFiles = {
      ...this.expandedFiles,
      [filePath]: this.expandedFiles[filePath] === false ? true : false
    };
  }

  selectResult(filePath, lineNum) {
    this.dispatchEvent(new CustomEvent('result-selected', {
      detail: { file: filePath, line: lineNum },
      bubbles: true,
      composed: true
    }));
  }

  focusInput() {
    const input = this.shadowRoot?.querySelector('input[type="text"]');
    if (input) {
      input.focus();
      input.select();
    }
  }

  _call(method, ...args) {
    if (this.rpcCall?.[method]) {
      return this.rpcCall[method](...args);
    }
    return Promise.reject(new Error('RPC not available'));
  }

  _extractResponse(response) {
    if (response && typeof response === 'object') {
      const keys = Object.keys(response);
      if (keys.length > 0) {
        return response[keys[0]];
      }
    }
    return response;
  }

  render() {
    return renderFindInFiles(this);
  }
}

customElements.define('find-in-files', FindInFiles);
