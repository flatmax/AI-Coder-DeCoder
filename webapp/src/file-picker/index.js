// FilePicker — tree view of repository files.
//
// This module hosts the LitElement class. Pure helpers, constants,
// and styles live in sibling modules:
//
//   - ./helpers.js   — fuzzyMatch, filterTree, sortChildren,
//                      sortChildrenWithMode, computeFilterExpansions
//   - ./constants.js — action IDs, mode strings, menu catalogs,
//                      storage keys, viewport-clamp tunables
//   - ./styles.js    — the static CSS template literal
//
// Governing spec: specs4/5-webapp/file-picker.md

import { LitElement, html } from 'lit';

import {
  CTX_ACTION_DELETE,
  CTX_ACTION_DISCARD,
  CTX_ACTION_DUPLICATE,
  CTX_ACTION_EXCLUDE,
  CTX_ACTION_EXCLUDE_ALL,
  CTX_ACTION_INCLUDE,
  CTX_ACTION_INCLUDE_ALL,
  CTX_ACTION_LOAD_LEFT,
  CTX_ACTION_LOAD_RIGHT,
  CTX_ACTION_NEW_DIR,
  CTX_ACTION_NEW_FILE,
  CTX_ACTION_RENAME,
  CTX_ACTION_RENAME_DIR,
  CTX_ACTION_STAGE,
  CTX_ACTION_STAGE_ALL,
  CTX_ACTION_UNSTAGE,
  CTX_ACTION_UNSTAGE_ALL,
  INLINE_MODE_DUPLICATE,
  INLINE_MODE_NEW_DIR,
  INLINE_MODE_NEW_FILE,
  INLINE_MODE_RENAME,
  SORT_MODES,
  SORT_MODE_MTIME,
  SORT_MODE_NAME,
  SORT_MODE_SIZE,
  _BRANCH_MENU_MAX_HEIGHT,
  _BRANCH_MENU_WIDTH,
  _CONTEXT_MENU_DIR_ITEMS,
  _CONTEXT_MENU_FILE_ITEMS,
  _CONTEXT_MENU_ROOT_ITEMS,
  _CONTEXT_MENU_VIEWPORT_MARGIN,
  _SORT_ASC_KEY,
  _SORT_MODE_KEY,
} from './constants.js';
import {
  computeFilterExpansions,
  filterTree,
  sortChildrenWithMode,
} from './helpers.js';
import { FILE_PICKER_STYLES } from './styles.js';

export class FilePicker extends LitElement {
  static properties = {
    tree: { type: Object },
    statusData: { type: Object },
    branchInfo: { type: Object },
    selectedFiles: { type: Object },
    excludedFiles: { type: Object },
    pinnedFiles: { type: Object },
    binaryFiles: { type: Object },
    activePath: { type: String },
    reviewState: { type: Object },
    filterQuery: { type: String, state: true },
    _expanded: { type: Object, state: true },
    _focusedPath: { type: String, state: true },
    _sortMode: { type: String, state: true },
    _sortAsc: { type: Boolean, state: true },
    _contextMenu: { type: Object, state: true },
    _renaming: { type: String, state: true },
    _duplicating: { type: String, state: true },
    _creating: { type: Object, state: true },
    _branchMenu: { type: Object, state: true },
    _gitMenuOpen: { type: Boolean, state: true },
    _committing: { type: Boolean, state: true },
    _reviewActive: { type: Boolean, state: true },
    _streaming: { type: Boolean, state: true },
  };

  static styles = FILE_PICKER_STYLES;

  constructor() {
    super();
    this.tree = {
      name: '',
      path: '',
      type: 'dir',
      lines: 0,
      children: [],
    };
    this.statusData = {
      modified: new Set(),
      staged: new Set(),
      untracked: new Set(),
      deleted: new Set(),
      diffStats: new Map(),
    };
    this.branchInfo = {
      branch: null,
      detached: false,
      sha: null,
      repoName: '',
    };
    this.selectedFiles = new Set();
    this.statusData = {
      modified: new Set(),
      staged: new Set(),
      untracked: new Set(),
      deleted: new Set(),
      diffStats: {},
    };
    this.excludedFiles = new Set();
    this.pinnedFiles = new Set();
    this.binaryFiles = new Set();
    this.activePath = null;
    this.reviewState = null;
    this.filterQuery = '';
    this._expanded = new Set();
    this._focusedPath = null;
    this._renaming = null;
    this._duplicating = null;
    this._creating = null;
    this._expandedSnapshot = null;
    this._contextMenu = null;
    this._branchMenu = null;
    this._gitMenuOpen = false;
    this._onDocumentClickForMenu = this._onDocumentClickForMenu.bind(this);
    this._onDocumentKeyDownForMenu =
      this._onDocumentKeyDownForMenu.bind(this);
    this._onDocumentClickForBranchMenu =
      this._onDocumentClickForBranchMenu.bind(this);
    this._onDocumentKeyDownForBranchMenu =
      this._onDocumentKeyDownForBranchMenu.bind(this);
    this._onDocumentClickForGitMenu =
      this._onDocumentClickForGitMenu.bind(this);
    this._onDocumentKeyDownForGitMenu =
      this._onDocumentKeyDownForGitMenu.bind(this);
    this._committing = false;
    this._reviewActive = false;
    this._streaming = false;
    this._onStreamChunkGit = () => {
      if (!this._streaming) this._streaming = true;
    };
    this._onStreamCompleteGit = () => {
      this._streaming = false;
    };
    this._onCommitResultGit = () => {
      this._committing = false;
    };
    this._onReviewStartedGit = () => {
      this._reviewActive = true;
    };
    this._onReviewEndedGit = () => {
      this._reviewActive = false;
    };
    const [loadedMode, loadedAsc] = this._loadSortPrefs();
    this._sortMode = loadedMode;
    this._sortAsc = loadedAsc;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('stream-chunk', this._onStreamChunkGit);
    window.addEventListener(
      'stream-complete', this._onStreamCompleteGit,
    );
    window.addEventListener(
      'commit-result', this._onCommitResultGit,
    );
    window.addEventListener(
      'review-started', this._onReviewStartedGit,
    );
    window.addEventListener(
      'review-ended', this._onReviewEndedGit,
    );
  }

  disconnectedCallback() {
    this._closeContextMenu();
    this._closeBranchMenu();
    this._closeGitMenu();
    window.removeEventListener(
      'stream-chunk', this._onStreamChunkGit,
    );
    window.removeEventListener(
      'stream-complete', this._onStreamCompleteGit,
    );
    window.removeEventListener(
      'commit-result', this._onCommitResultGit,
    );
    window.removeEventListener(
      'review-started', this._onReviewStartedGit,
    );
    window.removeEventListener(
      'review-ended', this._onReviewEndedGit,
    );
    super.disconnectedCallback();
  }

  _loadSortPrefs() {
    let mode = SORT_MODE_NAME;
    let asc = true;
    try {
      const savedMode = localStorage.getItem(_SORT_MODE_KEY);
      if (SORT_MODES.includes(savedMode)) mode = savedMode;
      const savedAsc = localStorage.getItem(_SORT_ASC_KEY);
      if (savedAsc === '0') asc = false;
      else if (savedAsc === '1') asc = true;
    } catch (_err) {
      // Ignore — defaults stay in place.
    }
    return [mode, asc];
  }

  _saveSortPrefs() {
    try {
      localStorage.setItem(_SORT_MODE_KEY, this._sortMode);
      localStorage.setItem(_SORT_ASC_KEY, this._sortAsc ? '1' : '0');
    } catch (_err) {
      // Ignore.
    }
  }

  // ---------------------------------------------------------------
  // Public API (called by the files-tab orchestrator)
  // ---------------------------------------------------------------

  setTree(tree) {
    if (this._expandedSnapshot === null) {
      this._expandedSnapshot = new Set(this._expanded);
    }
    this.tree = tree;
    this._focusedPath = null;
    this.requestUpdate();
  }

  restoreExpandedState() {
    if (this._expandedSnapshot === null) return;
    this._expanded = this._expandedSnapshot;
    this._expandedSnapshot = null;
    this._focusedPath = null;
  }

  setFilter(query) {
    this.filterQuery = query || '';
  }

  expandAll() {
    const all = new Set();
    function walk(node) {
      if (node.type === 'dir' && node.path) {
        all.add(node.path);
      }
      for (const child of node.children || []) {
        walk(child);
      }
    }
    walk(this.tree);
    this._expanded = all;
  }

  revealFile(path) {
    if (typeof path !== 'string' || !path) return;
    if (this.filterQuery) {
      this.filterQuery = '';
    }
    const parts = path.split('/');
    if (parts.length > 1) {
      const next = new Set(this._expanded);
      let acc = '';
      for (let i = 0; i < parts.length - 1; i += 1) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        next.add(acc);
      }
      this._expanded = next;
    }
    this._focusedPath = path;
    this.updateComplete.then(() => {
      const row = this._findRowElementForPath(path);
      if (!row) return;
      if (typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      row.classList.remove('reveal-flash');
      void row.offsetWidth;
      row.classList.add('reveal-flash');
      setTimeout(() => {
        row.classList.remove('reveal-flash');
      }, 1300);
    });
  }

  beginRename(path) {
    if (typeof path !== 'string' || !path) return;
    this._duplicating = null;
    this._creating = null;
    this._renaming = path;
  }

  beginDuplicate(path) {
    if (typeof path !== 'string' || !path) return;
    this._renaming = null;
    this._creating = null;
    this._duplicating = path;
  }

  beginCreateFile(parentPath) {
    if (typeof parentPath !== 'string') return;
    this._renaming = null;
    this._duplicating = null;
    this._creating = { mode: INLINE_MODE_NEW_FILE, parentPath };
    if (parentPath && !this._expanded.has(parentPath)) {
      const next = new Set(this._expanded);
      next.add(parentPath);
      this._expanded = next;
    }
  }

  beginCreateDirectory(parentPath) {
    if (typeof parentPath !== 'string') return;
    this._renaming = null;
    this._duplicating = null;
    this._creating = { mode: INLINE_MODE_NEW_DIR, parentPath };
    if (parentPath && !this._expanded.has(parentPath)) {
      const next = new Set(this._expanded);
      next.add(parentPath);
      this._expanded = next;
    }
  }

  updated(changedProps) {
    super.updated?.(changedProps);
    if (
      !changedProps.has('_renaming')
      && !changedProps.has('_duplicating')
      && !changedProps.has('_creating')
    ) {
      return;
    }
    const input = this.shadowRoot?.querySelector('.inline-input');
    if (!input) return;
    if (this.shadowRoot.activeElement === input) return;
    input.focus();
    const value = input.value || '';
    const lastSlash = value.lastIndexOf('/');
    const finalSeg = lastSlash >= 0 ? value.slice(lastSlash + 1) : value;
    const lastDot = finalSeg.lastIndexOf('.');
    if (lastDot > 0) {
      const selStart = lastSlash + 1;
      const selEnd = selStart + lastDot;
      input.setSelectionRange(selStart, selEnd);
    } else {
      input.select();
    }
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------

  _effectiveExpanded() {
    if (!this.filterQuery) return this._expanded;
    const filterExpansions = computeFilterExpansions(
      this.tree,
      this.filterQuery,
    );
    return new Set([...this._expanded, ...filterExpansions]);
  }

  render() {
    const filtered = filterTree(this.tree, this.filterQuery);
    const effectiveExpanded = this._effectiveExpanded();

    return html`
      ${this._renderReviewBanner()}
      <div class="filter-bar">
        <input
          type="text"
          class="filter-input"
          placeholder="Filter files (fuzzy match)…"
          .value=${this.filterQuery}
          @input=${this._onFilterInput}
          aria-label="Filter files"
        />
        ${this._renderSortButtons()}
      </div>
      <div
        class="tree-scroll"
        role="tree"
        tabindex="0"
        @keydown=${this._onTreeKeyDown}
      >
        ${this._renderRoot()}
        ${this._creating && this._creating.parentPath === ''
          ? this._renderInlineInput({
              mode: this._creating.mode,
              sourcePath: '',
              sourceName: '',
              depth: 0,
            })
          : ''}
        ${this._renderChildren(filtered, 0, effectiveExpanded)}
      </div>
      ${this._renderContextMenu()}
      ${this._renderBranchMenu()}
    `;
  }

  _renderRoot() {
    const repoName =
      (this.tree && this.tree.name) ||
      (this.branchInfo && this.branchInfo.repoName) ||
      '';
    const pill = this._renderBranchPill();
    if (!repoName && !pill) return '';
    const allExcluded = this._allDescendantsExcluded(this.tree);
    const someExcluded =
      !allExcluded && this._someDescendantsExcluded(this.tree);
    const allSelected = this._allDescendantsSelected(this.tree);
    const someSelected =
      !allSelected && this._someDescendantsSelected(this.tree);
    const rowClasses = [
      'row',
      'is-root',
      allExcluded ? 'all-excluded' : '',
      someExcluded ? 'some-excluded' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const badgeTitle = 'Some files excluded from index';
    const checkboxTitle =
      'Click to select all files, shift+click to exclude all from index.';
    return html`
      <div
        class=${rowClasses}
        role="treeitem"
        title=${repoName || 'repository'}
        @contextmenu=${this._onRootContextMenu}
      >
        <input
          type="checkbox"
          class="checkbox"
          .checked=${allSelected}
          .indeterminate=${someSelected}
          @click=${this._onRootCheckbox}
          aria-label="Select all files in repository"
          title=${checkboxTitle}
        />
        <span class="name">${repoName || 'repository'}</span>
        ${someExcluded
          ? html`<span
              class="excluded-badge"
              title=${badgeTitle}
              aria-label=${badgeTitle}
              >✕</span
            >`
          : ''}
        ${pill}
      </div>
    `;
  }

  _onRootCheckbox(event) {
    event.stopPropagation();
    const descendants = this._collectDescendantFiles(this.tree);
    if (descendants.length === 0) return;
    if (event.shiftKey) {
      event.preventDefault();
      const allExcluded = descendants.every((p) =>
        this.excludedFiles.has(p),
      );
      const nextExcluded = new Set(this.excludedFiles);
      if (allExcluded) {
        for (const p of descendants) nextExcluded.delete(p);
      } else {
        for (const p of descendants) nextExcluded.add(p);
      }
      this._emitExclusionChanged(nextExcluded);
      if (!allExcluded) {
        const nextSelected = new Set(this.selectedFiles);
        let selectionChanged = false;
        for (const p of descendants) {
          if (nextSelected.has(p)) {
            nextSelected.delete(p);
            selectionChanged = true;
          }
        }
        if (selectionChanged) this._emitSelectionChanged(nextSelected);
      }
      return;
    }
    const anyExcluded = descendants.some((p) =>
      this.excludedFiles.has(p),
    );
    if (anyExcluded) {
      const nextExcluded = new Set(this.excludedFiles);
      for (const p of descendants) nextExcluded.delete(p);
      this._emitExclusionChanged(nextExcluded);
    }
    const allSelected = descendants.every((p) =>
      this.selectedFiles.has(p),
    );
    const next = new Set(this.selectedFiles);
    if (allSelected) {
      for (const p of descendants) next.delete(p);
    } else {
      for (const p of descendants) next.add(p);
    }
    this._emitSelectionChanged(next);
  }

  _onRootContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    if (this._contextMenu !== null) {
      this._closeContextMenu();
    }
    this._contextMenu = {
      type: 'root',
      path: '',
      name: (this.tree && this.tree.name) || '',
      x: event.clientX,
      y: event.clientY,
    };
    document.addEventListener(
      'click',
      this._onDocumentClickForMenu,
      true,
    );
    document.addEventListener(
      'keydown',
      this._onDocumentKeyDownForMenu,
      true,
    );
  }

  _renderBranchPill() {
    const info = this.branchInfo;
    if (!info) return '';
    if (info.detached) {
      const short =
        typeof info.sha === 'string' && info.sha
          ? info.sha.slice(0, 7)
          : '';
      if (!short) return '';
      return html`
        <span
          class="branch-pill detached"
          title="Detached HEAD at ${info.sha}"
          aria-label="Detached HEAD at ${info.sha}"
        >
          <span class="glyph">⎇</span>
          <span class="ref">${short}</span>
        </span>
      `;
    }
    if (typeof info.branch === 'string' && info.branch) {
      const disabled =
        this._reviewActive || this._streaming || this._committing;
      const title = this._reviewActive
        ? 'Branch switching disabled during review'
        : this._streaming
          ? 'Branch switching disabled while AI is responding'
          : this._committing
            ? 'Branch switching disabled during commit'
            : `On branch ${info.branch} — click to switch`;
      return html`
        <button
          type="button"
          class="branch-pill clickable"
          ?disabled=${disabled}
          title=${title}
          aria-label=${`Switch branch, currently on ${info.branch}`}
          @click=${this._onBranchPillClick}
        >
          <span class="glyph">⎇</span>
          <span class="ref">${info.branch}</span>
        </button>
      `;
    }
    return '';
  }

  _renderSortButtons() {
    const dir = this._sortAsc ? '↑' : '↓';
    const button = (mode, glyph, tooltip) => {
      const isActive = this._sortMode === mode;
      return html`
        <button
          type="button"
          class="sort-btn ${isActive ? 'active' : ''}"
          data-sort-mode=${mode}
          title=${tooltip}
          aria-pressed=${isActive}
          @click=${() => this._onSortButtonClick(mode)}
        >
          ${glyph}${isActive
            ? html`<span class="dir">${dir}</span>`
            : ''}
        </button>
      `;
    };
    return html`
      <div class="sort-buttons">
        ${button(
          SORT_MODE_NAME,
          'A',
          'Sort by name (click again to reverse)',
        )}
        ${button(
          SORT_MODE_MTIME,
          '🕐',
          'Sort by modification time (click again to reverse)',
        )}
        ${button(
          SORT_MODE_SIZE,
          '#',
          'Sort by size (click again to reverse)',
        )}
        ${this._renderSettingsButton()}
        ${this._renderGitActions()}
      </div>
    `;
  }

  _renderSettingsButton() {
    return html`
      <button
        type="button"
        class="picker-settings-btn"
        title="Settings"
        aria-label="Open settings"
        @click=${this._onSettingsButtonClick}
      >⚙️</button>
    `;
  }

  _onSettingsButtonClick() {
    this.dispatchEvent(
      new CustomEvent('request-dialog-tab', {
        detail: { tab: 'settings' },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _renderGitActions() {
    const commitDisabled =
      this._committing || this._reviewActive || this._streaming;
    const resetDisabled = this._committing || this._streaming;
    const commitTitle = this._reviewActive
      ? 'Commit disabled during review'
      : this._streaming
        ? 'Commit disabled while AI is responding'
        : this._committing
          ? 'Committing…'
          : 'Stage all changes and commit with an auto-generated message';
    const resetTitle = this._streaming
      ? 'Reset disabled while AI is responding'
      : 'Reset to HEAD (discard all uncommitted changes)';
    const reviewActive = !!(
      this.reviewState && this.reviewState.active
    );
    const reviewDisabled =
      this._committing || this._streaming || reviewActive;
    const reviewTitle = reviewActive
      ? 'Already in review mode'
      : this._streaming
        ? 'Review disabled while AI is responding'
        : this._committing
          ? 'Review disabled during commit'
          : 'Start a code review of a branch';
    // Chevron is enabled even when the primary action is
    // disabled — Copy diff is always safe, and the user
    // may want to inspect the menu while a commit is in
    // flight. Items inside the menu carry their own
    // disabled state.
    const menuOpen = this._gitMenuOpen;
    return html`
      <div
        class="picker-git-actions split"
        role="group"
        aria-label="Git actions"
      >
        <button
          class="picker-git-btn primary ${this._committing ? 'in-flight' : ''}"
          ?disabled=${commitDisabled}
          title=${commitTitle}
          aria-label="Commit all changes"
          @click=${() => this._dispatchGitAction('commit')}
        >${this._committing ? '⏳' : '💾'}</button>
        <button
          class="picker-git-btn chevron"
          aria-label="More git actions"
          aria-haspopup="menu"
          aria-expanded=${menuOpen ? 'true' : 'false'}
          title="More git actions"
          @click=${this._onGitMenuToggle}
        >▾</button>
        ${menuOpen
          ? this._renderGitMenu({
              resetDisabled,
              resetTitle,
              reviewActive,
              reviewDisabled,
              reviewTitle,
            })
          : ''}
      </div>
    `;
  }

  _renderGitMenu({
    resetDisabled,
    resetTitle,
    reviewActive,
    reviewDisabled,
    reviewTitle,
  }) {
    return html`
      <div
        class="git-menu"
        role="menu"
        aria-label="Git actions"
      >
        <button
          type="button"
          class="git-menu-item"
          role="menuitem"
          title="Copy working-tree diff to clipboard"
          @click=${() => this._onGitMenuItemClick('copy-diff')}
        >
          <span class="icon">📋</span>
          <span class="label">Copy diff</span>
        </button>
        ${reviewActive
          ? ''
          : html`
              <button
                type="button"
                class="git-menu-item"
                role="menuitem"
                ?disabled=${reviewDisabled}
                title=${reviewTitle}
                @click=${this._onGitMenuReviewClick}
              >
                <span class="icon">🔍</span>
                <span class="label">Start code review…</span>
              </button>
            `}
        <div class="git-menu-separator"></div>
        <button
          type="button"
          class="git-menu-item destructive"
          role="menuitem"
          ?disabled=${resetDisabled}
          title=${resetTitle}
          @click=${() => this._onGitMenuItemClick('reset')}
        >
          <span class="icon">⚠️</span>
          <span class="label">Reset to HEAD…</span>
        </button>
      </div>
    `;
  }

  _onGitMenuToggle(event) {
    event.preventDefault();
    event.stopPropagation();
    if (this._gitMenuOpen) {
      this._closeGitMenu();
    } else {
      this._openGitMenu();
    }
  }

  _openGitMenu() {
    if (this._gitMenuOpen) return;
    this._gitMenuOpen = true;
    document.addEventListener(
      'click',
      this._onDocumentClickForGitMenu,
      true,
    );
    document.addEventListener(
      'keydown',
      this._onDocumentKeyDownForGitMenu,
      true,
    );
  }

  _closeGitMenu() {
    if (!this._gitMenuOpen) return;
    this._gitMenuOpen = false;
    document.removeEventListener(
      'click',
      this._onDocumentClickForGitMenu,
      true,
    );
    document.removeEventListener(
      'keydown',
      this._onDocumentKeyDownForGitMenu,
      true,
    );
  }

  _onGitMenuItemClick(action) {
    this._closeGitMenu();
    this._dispatchGitAction(action);
  }

  _onGitMenuReviewClick() {
    this._closeGitMenu();
    this._onReviewButtonClick();
  }

  _onDocumentClickForGitMenu(event) {
    if (!this._gitMenuOpen) return;
    const path = event.composedPath
      ? event.composedPath()
      : [event.target];
    const inside = path.some(
      (el) =>
        el &&
        el.classList &&
        (el.classList.contains('git-menu') ||
          el.classList.contains('picker-git-actions')),
    );
    if (!inside) {
      this._closeGitMenu();
    }
  }

  _onDocumentKeyDownForGitMenu(event) {
    if (!this._gitMenuOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this._closeGitMenu();
    }
  }

  _onReviewButtonClick() {
    this.dispatchEvent(
      new CustomEvent('open-review-selector', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  _dispatchGitAction(action) {
    this.dispatchEvent(new CustomEvent('git-action', {
      detail: { action },
      bubbles: true,
      composed: true,
    }));
  }

  _renderReviewBanner() {
    const state = this.reviewState;
    if (!state || typeof state !== 'object') return '';
    if (!state.active) return '';
    const branch = typeof state.branch === 'string' ? state.branch : '';
    const commits = Array.isArray(state.commits) ? state.commits : [];
    const commitCount = commits.length;
    const stats =
      state.stats && typeof state.stats === 'object'
        ? state.stats
        : {};
    const filesChanged = Number(stats.files_changed) || 0;
    const added = Number(stats.additions) || 0;
    const removed = Number(stats.deletions) || 0;
    const title = branch
      ? `Reviewing ${branch}`
      : 'Reviewing branch';
    const commitLabel =
      commitCount === 1 ? '1 commit' : `${commitCount} commits`;
    return html`
      <div class="review-banner" role="status"
        aria-label="Review mode active">
        <div class="review-banner-header">
          <span class="review-banner-icon" aria-hidden="true">🔍</span>
          <span class="review-banner-title" title=${title}>
            ${title}
          </span>
          <button
            class="review-banner-view-graph"
            @click=${this._onViewGraphClick}
            title="View the full commit graph with the review base and branch tip highlighted"
            aria-label="View review history graph"
          >
            View graph
          </button>
          <button
            class="review-banner-exit"
            @click=${this._onExitReviewClick}
            title="Exit review mode and return to the working branch"
            aria-label="Exit review mode"
          >
            Exit
          </button>
        </div>
        <div class="review-banner-stats">
          <span>${commitLabel}</span>
          <span>${filesChanged} file${filesChanged === 1 ? '' : 's'}</span>
          ${added > 0
            ? html`<span class="stat-added">+${added}</span>`
            : ''}
          ${removed > 0
            ? html`<span class="stat-removed">-${removed}</span>`
            : ''}
        </div>
      </div>
    `;
  }

  _onExitReviewClick() {
    this.dispatchEvent(
      new CustomEvent('exit-review', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  _onViewGraphClick() {
    this.dispatchEvent(
      new CustomEvent('open-review-graph', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  _renderChildren(node, depth, expanded) {
    const children = sortChildrenWithMode(
      node.children,
      this._sortMode,
      this._sortAsc,
    );
    if (children.length === 0 && depth === 0) {
      const placeholder = this.filterQuery
        ? 'No matching files'
        : 'No files to show';
      return html`<div class="empty-state">${placeholder}</div>`;
    }
    return children.map((child) => this._renderNode(child, depth, expanded));
  }

  _renderNode(node, depth, expanded) {
    if (node.type === 'dir') {
      return this._renderDir(node, depth, expanded);
    }
    return this._renderFile(node, depth);
  }

  _renderDir(node, depth, expanded) {
    const isOpen = expanded.has(node.path);
    const hasChildren = (node.children || []).length > 0;
    const indentPx = depth * 16;
    const allExcluded = this._allDescendantsExcluded(node);
    const someExcluded =
      !allExcluded && this._someDescendantsExcluded(node);
    const tooltip = this._tooltipForDir(node, {
      allExcluded,
      someExcluded,
    });
    const rowClasses = [
      'row',
      'is-dir',
      allExcluded ? 'all-excluded' : '',
      someExcluded ? 'some-excluded' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const badgeTitle = 'Some files excluded from index';
    return html`
      <div
        class=${rowClasses}
        style="--row-indent: ${indentPx}px"
        data-row-path=${node.path}
        @click=${(e) => this._onDirClick(e, node)}
        @auxclick=${(e) => this._onDirAuxClick(e, node)}
        @contextmenu=${(e) => this._onDirContextMenu(e, node)}
        role="treeitem"
        aria-expanded=${isOpen}
        title=${tooltip}
      >
        <span class="indent"></span>
        <span class="twisty ${hasChildren ? '' : 'empty'}">
          ${isOpen ? '▼' : '▶'}
        </span>
        <input
          type="checkbox"
          class="checkbox"
          .checked=${this._allDescendantsSelected(node)}
          .indeterminate=${this._someDescendantsSelected(node)}
          @click=${(e) => this._onDirCheckbox(e, node)}
          aria-label="Select all files in ${node.name}"
        />
        <span class="name">${node.name || '(root)'}</span>
        ${someExcluded
          ? html`<span
              class="excluded-badge"
              title=${badgeTitle}
              aria-label=${badgeTitle}
              >✕</span
            >`
          : ''}
      </div>
      ${isOpen
        ? html`
            ${this._creating &&
            this._creating.parentPath === node.path
              ? this._renderInlineInput({
                  mode: this._creating.mode,
                  sourcePath: node.path,
                  sourceName: '',
                  depth: depth + 1,
                })
              : ''}
            ${this._renderChildren(node, depth + 1, expanded)}
          `
        : ''}
    `;
  }

  _renderFile(node, depth) {
    if (this._renaming === node.path) {
      return this._renderInlineInput({
        mode: 'rename',
        sourcePath: node.path,
        sourceName: node.name,
        depth,
      });
    }
    const isSelected = this.selectedFiles.has(node.path);
    const isExcluded = this.excludedFiles.has(node.path);
    const isBinary =
      this.binaryFiles && this.binaryFiles.has(node.path);
    const indentPx = depth * 16;
    const isFocused = node.path === this._focusedPath;
    const isActive = node.path === this.activePath;
    const status = this._statusFor(node.path);
    const diff = this._diffStatsFor(node.path);
    const tooltip = this._tooltipFor(node, isExcluded, diff, isBinary);
    const checkboxTitle = isBinary
      ? 'Binary file — cannot be sent to the LLM.'
      : isExcluded
        ? 'Excluded from index. Click to include and select, or shift+click to return to index-only.'
        : 'Click to select, shift+click to exclude from index.';
    return html`
      <div
        class="row is-file ${isFocused ? 'focused' : ''} ${isExcluded ? 'is-excluded' : ''} ${isBinary ? 'is-binary' : ''} ${isActive ? 'active-in-viewer' : ''}"
        style="--row-indent: ${indentPx}px"
        data-row-path=${node.path}
        @click=${(e) => this._onFileClick(e, node)}
        @auxclick=${(e) => this._onFileAuxClick(e, node)}
        @contextmenu=${(e) => this._onFileContextMenu(e, node)}
        role="treeitem"
        aria-current=${isFocused ? 'true' : 'false'}
        title=${tooltip}
      >
        <span class="indent"></span>
        <span class="twisty empty"></span>
        ${diff
          ? html`<span class="diff-stats diff-stats-pre" title="Lines changed">
              ${diff.added > 0
                ? html`<span class="added">+${diff.added}</span>`
                : ''}
              ${diff.removed > 0
                ? html`<span class="removed">-${diff.removed}</span>`
                : ''}
            </span>`
          : ''}
        <input
          type="checkbox"
          class="checkbox"
          .checked=${isSelected}
          ?disabled=${isBinary}
          @click=${(e) => this._onFileCheckbox(e, node)}
          aria-label="Select ${node.name}"
          title=${checkboxTitle}
        />
        <span class="name">${node.name}</span>
        ${status
          ? html`<span
              class="status-badge status-${status.kind}"
              title=${status.tooltip}
              aria-label=${status.tooltip}
              >${status.letter}</span
            >`
          : ''}
        ${isExcluded
          ? html`<span
              class="excluded-badge"
              title="Excluded from index"
              aria-label="Excluded from index"
              >✕</span
            >`
          : ''}
        ${typeof node.lines === 'number' && node.lines > 0
          ? html`<span class="lines-badge">${node.lines}</span>`
          : ''}
      </div>
      ${this._duplicating === node.path
        ? this._renderInlineInput({
            mode: 'duplicate',
            sourcePath: node.path,
            sourceName: node.name,
            depth,
          })
        : ''}
    `;
  }

  _renderInlineInput({ mode, sourcePath, sourceName, depth }) {
    const indentPx = depth * 16;
    let initial = '';
    if (mode === INLINE_MODE_RENAME) initial = sourceName;
    else if (mode === INLINE_MODE_DUPLICATE) initial = sourcePath;
    let ariaLabel;
    if (mode === INLINE_MODE_RENAME) {
      ariaLabel = `Rename ${sourceName}`;
    } else if (mode === INLINE_MODE_DUPLICATE) {
      ariaLabel = `Duplicate ${sourceName} — enter new path`;
    } else if (mode === INLINE_MODE_NEW_FILE) {
      ariaLabel = sourcePath
        ? `New file in ${sourcePath}`
        : 'New file at repository root';
    } else if (mode === INLINE_MODE_NEW_DIR) {
      ariaLabel = sourcePath
        ? `New directory in ${sourcePath}`
        : 'New directory at repository root';
    } else {
      ariaLabel = 'Inline input';
    }
    let placeholder = '';
    if (mode === INLINE_MODE_NEW_FILE) placeholder = 'filename.md';
    else if (mode === INLINE_MODE_NEW_DIR) placeholder = 'dirname';
    return html`
      <div
        class="row is-inline"
        style="--row-indent: ${indentPx}px"
        role="treeitem"
      >
        <span class="indent"></span>
        <span class="twisty empty"></span>
        <input
          type="text"
          class="inline-input"
          data-inline-mode=${mode}
          data-source-path=${sourcePath}
          placeholder=${placeholder}
          .value=${initial}
          @keydown=${(e) => this._onInlineKeyDown(e, mode, sourcePath)}
          @blur=${(e) => this._onInlineBlur(e, mode, sourcePath)}
          aria-label=${ariaLabel}
        />
      </div>
    `;
  }

  _statusFor(path) {
    const sd = this.statusData;
    if (!sd || !path) return null;
    if (sd.deleted?.has?.(path)) {
      return { letter: 'D', kind: 'deleted', tooltip: 'Deleted' };
    }
    if (sd.staged?.has?.(path)) {
      return { letter: 'S', kind: 'staged', tooltip: 'Staged' };
    }
    if (sd.modified?.has?.(path)) {
      return {
        letter: 'M',
        kind: 'modified',
        tooltip: 'Modified',
      };
    }
    if (sd.untracked?.has?.(path)) {
      return {
        letter: 'U',
        kind: 'untracked',
        tooltip: 'Untracked',
      };
    }
    return null;
  }

  _diffStatsFor(path) {
    const map = this.statusData?.diffStats;
    if (!map || typeof map.get !== 'function' || !path) return null;
    const entry = map.get(path);
    if (!entry || typeof entry !== 'object') return null;
    const addedRaw =
      typeof entry.additions === 'number'
        ? entry.additions
        : typeof entry.added === 'number'
          ? entry.added
          : 0;
    const removedRaw =
      typeof entry.deletions === 'number'
        ? entry.deletions
        : typeof entry.removed === 'number'
          ? entry.removed
          : 0;
    if (addedRaw === 0 && removedRaw === 0) return null;
    return { added: addedRaw, removed: removedRaw };
  }

  _tooltipFor(node, isExcluded = false, diff = null, isBinary = false) {
    if (!node || typeof node !== 'object') return '';
    const name = typeof node.name === 'string' ? node.name : '';
    const path = typeof node.path === 'string' ? node.path : '';
    if (!name && !path) return '';
    let base = !path || path === name ? name : `${path} — ${name}`;
    if (diff && (diff.added > 0 || diff.removed > 0)) {
      const parts = [];
      if (diff.added > 0) parts.push(`+${diff.added}`);
      if (diff.removed > 0) parts.push(`-${diff.removed}`);
      base = `${base} (${parts.join(' ')})`;
    }
    if (isBinary) return `${base} (binary — cannot be sent to LLM)`;
    return isExcluded ? `${base} (excluded)` : base;
  }

  _tooltipForDir(node, { allExcluded = false, someExcluded = false } = {}) {
    const base = this._tooltipFor(node);
    if (!base) return '';
    if (allExcluded) {
      return `${base} — all files excluded from index, Shift+click to re-include all`;
    }
    if (someExcluded) {
      return `${base} — some files excluded from index`;
    }
    return base;
  }

  // ---------------------------------------------------------------
  // Selection helpers
  // ---------------------------------------------------------------

  _collectDescendantFiles(node) {
    const paths = [];
    const binary = this.binaryFiles || new Set();
    function walk(n) {
      if (n.type === 'file') {
        // Binary files are excluded from select-all
        // descendant math: they can't usefully be sent
        // to the LLM (the backend trims them at sync
        // time), so toggling them on bulk select would
        // never let the root or directory checkbox
        // reach the "fully selected" state. Render-side
        // they still appear in the tree with disabled
        // checkboxes — see `_renderFile`.
        if (binary.has(n.path)) return;
        paths.push(n.path);
        return;
      }
      for (const child of n.children || []) walk(child);
    }
    walk(node);
    return paths;
  }

  _allDescendantsSelected(node) {
    const descendants = this._collectDescendantFiles(node);
    if (descendants.length === 0) return false;
    return descendants.every((p) => this.selectedFiles.has(p));
  }

  _someDescendantsSelected(node) {
    const descendants = this._collectDescendantFiles(node);
    if (descendants.length === 0) return false;
    const selected = descendants.filter(
      (p) => this.selectedFiles.has(p),
    );
    return selected.length > 0 && selected.length < descendants.length;
  }

  _allDescendantsExcluded(node) {
    const descendants = this._collectDescendantFiles(node);
    if (descendants.length === 0) return false;
    return descendants.every((p) => this.excludedFiles.has(p));
  }

  _someDescendantsExcluded(node) {
    const descendants = this._collectDescendantFiles(node);
    if (descendants.length === 0) return false;
    const excluded = descendants.filter((p) =>
      this.excludedFiles.has(p),
    );
    return excluded.length > 0 && excluded.length < descendants.length;
  }

  // ---------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------

  _onFilterInput(e) {
    this.filterQuery = e.target.value;
  }

  _onSortButtonClick(mode) {
    if (!SORT_MODES.includes(mode)) return;
    if (this._sortMode === mode) {
      this._sortAsc = !this._sortAsc;
    } else {
      this._sortMode = mode;
      this._sortAsc = true;
    }
    this._saveSortPrefs();
  }

  _onDirClick(event, node) {
    if (event.target.classList.contains('checkbox')) return;
    this._focusedPath = node.path;
    this._toggleExpanded(node.path);
  }

  _toggleExpanded(path) {
    const next = new Set(this._expanded);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    this._expanded = next;
  }

  _onDirCheckbox(event, node) {
    event.stopPropagation();
    const descendants = this._collectDescendantFiles(node);
    if (descendants.length === 0) return;
    if (event.shiftKey) {
      event.preventDefault();
      const allExcluded = descendants.every((p) =>
        this.excludedFiles.has(p),
      );
      const nextExcluded = new Set(this.excludedFiles);
      if (allExcluded) {
        for (const p of descendants) nextExcluded.delete(p);
      } else {
        for (const p of descendants) nextExcluded.add(p);
      }
      this._emitExclusionChanged(nextExcluded);
      if (!allExcluded) {
        const nextSelected = new Set(this.selectedFiles);
        let selectionChanged = false;
        for (const p of descendants) {
          if (nextSelected.has(p)) {
            nextSelected.delete(p);
            selectionChanged = true;
          }
        }
        if (selectionChanged) this._emitSelectionChanged(nextSelected);
      }
      return;
    }
    const anyExcluded = descendants.some((p) =>
      this.excludedFiles.has(p),
    );
    if (anyExcluded) {
      const nextExcluded = new Set(this.excludedFiles);
      for (const p of descendants) nextExcluded.delete(p);
      this._emitExclusionChanged(nextExcluded);
    }
    const allSelected = descendants.every((p) =>
      this.selectedFiles.has(p),
    );
    const next = new Set(this.selectedFiles);
    if (allSelected) {
      for (const p of descendants) next.delete(p);
    } else {
      for (const p of descendants) next.add(p);
    }
    this._emitSelectionChanged(next);
  }

  _onFileClick(event, node) {
    if (event.target.classList.contains('checkbox')) return;
    this._focusedPath = node.path;
    this.dispatchEvent(
      new CustomEvent('file-clicked', {
        detail: { path: node.path },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _onFileCheckbox(event, node) {
    event.stopPropagation();
    // Defensive: binary files render with disabled
    // checkboxes, but any programmatic dispatch would
    // bypass that. Skip silently — the backend would
    // trim them anyway, but a no-op here keeps the
    // root checkbox's all/none accounting honest.
    if (this.binaryFiles && this.binaryFiles.has(node.path)) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      this._toggleExclusion(node.path);
      return;
    }
    const isCurrentlySelected = this.selectedFiles.has(node.path);
    const isPinned =
      this.pinnedFiles && this.pinnedFiles.has(node.path);
    if (isCurrentlySelected && isPinned) {
      event.preventDefault();
      const next = new Set(this.selectedFiles);
      next.delete(node.path);
      this._emitSelectionChanged(next);
      return;
    }
    if (this.excludedFiles.has(node.path)) {
      const nextExcluded = new Set(this.excludedFiles);
      nextExcluded.delete(node.path);
      const nextSelected = new Set(this.selectedFiles);
      nextSelected.add(node.path);
      this._emitExclusionChanged(nextExcluded);
      this._emitSelectionChanged(nextSelected);
      return;
    }
    const next = new Set(this.selectedFiles);
    if (next.has(node.path)) {
      next.delete(node.path);
    } else {
      next.add(node.path);
    }
    this._emitSelectionChanged(next);
  }

  _onInlineKeyDown(event, mode, sourcePath) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this._commitInlineInput(event.target, mode, sourcePath);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this._cancelInlineInput(mode);
    }
  }

  _onInlineBlur(event, mode, sourcePath) {
    this._cancelInlineInput(mode, sourcePath);
  }

  _commitInlineInput(inputEl, mode, sourcePath) {
    const raw = inputEl?.value || '';
    const target = raw.trim();
    if (mode === INLINE_MODE_RENAME) {
      this._renaming = null;
    } else if (mode === INLINE_MODE_DUPLICATE) {
      this._duplicating = null;
    } else if (
      mode === INLINE_MODE_NEW_FILE ||
      mode === INLINE_MODE_NEW_DIR
    ) {
      this._creating = null;
    }
    if (!target) return;
    if (mode === INLINE_MODE_RENAME) {
      const currentName = sourcePath.includes('/')
        ? sourcePath.slice(sourcePath.lastIndexOf('/') + 1)
        : sourcePath;
      if (target === currentName) return;
    }
    if (mode === INLINE_MODE_DUPLICATE && target === sourcePath) {
      return;
    }
    if (
      mode === INLINE_MODE_NEW_FILE ||
      mode === INLINE_MODE_NEW_DIR
    ) {
      const eventName =
        mode === INLINE_MODE_NEW_FILE
          ? 'new-file-committed'
          : 'new-directory-committed';
      this.dispatchEvent(
        new CustomEvent(eventName, {
          detail: { parentPath: sourcePath, name: target },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    const eventName =
      mode === INLINE_MODE_RENAME
        ? 'rename-committed'
        : 'duplicate-committed';
    this.dispatchEvent(
      new CustomEvent(eventName, {
        detail: { sourcePath, targetName: target },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _cancelInlineInput(mode, sourcePath) {
    if (mode === INLINE_MODE_RENAME) {
      if (sourcePath && this._renaming !== sourcePath) return;
      this._renaming = null;
    } else if (mode === INLINE_MODE_DUPLICATE) {
      if (sourcePath && this._duplicating !== sourcePath) return;
      this._duplicating = null;
    } else if (
      mode === INLINE_MODE_NEW_FILE ||
      mode === INLINE_MODE_NEW_DIR
    ) {
      if (
        sourcePath !== undefined &&
        (!this._creating || this._creating.parentPath !== sourcePath)
      ) {
        return;
      }
      this._creating = null;
    }
  }

  _toggleExclusion(path) {
    const nextExcluded = new Set(this.excludedFiles);
    if (nextExcluded.has(path)) {
      nextExcluded.delete(path);
      this._emitExclusionChanged(nextExcluded);
      return;
    }
    nextExcluded.add(path);
    this._emitExclusionChanged(nextExcluded);
    if (this.selectedFiles.has(path)) {
      const nextSelected = new Set(this.selectedFiles);
      nextSelected.delete(path);
      this._emitSelectionChanged(nextSelected);
    }
  }

  _emitSelectionChanged(newSet) {
    this.dispatchEvent(
      new CustomEvent('selection-changed', {
        detail: { selectedFiles: Array.from(newSet) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _emitExclusionChanged(newSet) {
    this.dispatchEvent(
      new CustomEvent('exclusion-changed', {
        detail: { excludedFiles: Array.from(newSet) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------------------------------------------------------------
  // Context menu
  // ---------------------------------------------------------------

  _onFileContextMenu(event, node) {
    event.preventDefault();
    event.stopPropagation();
    if (this._contextMenu !== null) {
      this._closeContextMenu();
    }
    this._contextMenu = {
      type: 'file',
      path: node.path,
      name: node.name,
      isExcluded: this.excludedFiles.has(node.path),
      x: event.clientX,
      y: event.clientY,
    };
    document.addEventListener('click', this._onDocumentClickForMenu, true);
    document.addEventListener(
      'keydown',
      this._onDocumentKeyDownForMenu,
      true,
    );
  }

  _onFileAuxClick(event, node) {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('insert-path', {
        detail: { path: node.path },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _onDirAuxClick(event, node) {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('insert-path', {
        detail: { path: node.path },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _onDirContextMenu(event, node) {
    event.preventDefault();
    event.stopPropagation();
    if (this._contextMenu !== null) {
      this._closeContextMenu();
    }
    const descendants = this._collectDescendantFiles(node);
    const excludedCount = descendants.filter((p) =>
      this.excludedFiles.has(p),
    ).length;
    this._contextMenu = {
      type: 'dir',
      path: node.path,
      name: node.name,
      allExcluded:
        descendants.length > 0 && excludedCount === descendants.length,
      someExcluded: excludedCount > 0,
      x: event.clientX,
      y: event.clientY,
    };
    document.addEventListener(
      'click',
      this._onDocumentClickForMenu,
      true,
    );
    document.addEventListener(
      'keydown',
      this._onDocumentKeyDownForMenu,
      true,
    );
  }

  _closeContextMenu() {
    if (this._contextMenu === null) return;
    this._contextMenu = null;
    document.removeEventListener(
      'click',
      this._onDocumentClickForMenu,
      true,
    );
    document.removeEventListener(
      'keydown',
      this._onDocumentKeyDownForMenu,
      true,
    );
  }

  _onDocumentClickForMenu(event) {
    if (this._contextMenu === null) return;
    const path = event.composedPath
      ? event.composedPath()
      : [event.target];
    const insideMenu = path.some(
      (el) =>
        el &&
        el.classList &&
        el.classList.contains('context-menu'),
    );
    if (!insideMenu) {
      this._closeContextMenu();
    }
  }

  _onDocumentKeyDownForMenu(event) {
    if (this._contextMenu === null) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this._closeContextMenu();
    }
  }

  _renderContextMenu() {
    if (this._contextMenu === null) return '';
    const ctx = this._contextMenu;
    const { x, y } = this._clampMenuPosition(ctx);
    return html`
      <div
        class="context-menu"
        style="left: ${x}px; top: ${y}px"
        role="menu"
        aria-label="File actions"
      >
        ${this._renderMenuItems(ctx)}
      </div>
    `;
  }

  _renderMenuItems(ctx) {
    const catalog =
      ctx.type === 'root'
        ? _CONTEXT_MENU_ROOT_ITEMS
        : ctx.type === 'dir'
          ? _CONTEXT_MENU_DIR_ITEMS
          : _CONTEXT_MENU_FILE_ITEMS;
    const items = [];
    for (const entry of catalog) {
      if (entry === null) {
        items.push(html`<div class="menu-separator"></div>`);
        continue;
      }
      if (typeof entry.showWhen === 'function' && !entry.showWhen(ctx)) {
        continue;
      }
      const classes = ['menu-item'];
      if (entry.destructive) classes.push('destructive');
      items.push(html`
        <div
          class=${classes.join(' ')}
          role="menuitem"
          data-action=${entry.action}
          @click=${(e) => this._onContextMenuAction(e, entry.action)}
        >
          <span class="icon">${entry.icon}</span>
          <span class="label">${entry.label}</span>
        </div>
      `);
    }
    return items;
  }

  _clampMenuPosition({ x, y }) {
    const margin = _CONTEXT_MENU_VIEWPORT_MARGIN;
    const estimatedWidth = 240;
    const estimatedHeight = 320;
    const maxX = window.innerWidth - estimatedWidth - margin;
    const maxY = window.innerHeight - estimatedHeight - margin;
    return {
      x: Math.max(margin, Math.min(x, maxX)),
      y: Math.max(margin, Math.min(y, maxY)),
    };
  }

  _onContextMenuAction(event, action) {
    event.preventDefault();
    event.stopPropagation();
    const ctx = this._contextMenu;
    if (ctx === null) return;
    this.dispatchEvent(
      new CustomEvent('context-menu-action', {
        detail: {
          action,
          type: ctx.type,
          path: ctx.path,
          name: ctx.name,
          isExcluded: ctx.isExcluded,
        },
        bubbles: true,
        composed: true,
      }),
    );
    this._closeContextMenu();
  }

  // ---------------------------------------------------------------
  // Branch menu
  // ---------------------------------------------------------------

  _onBranchPillClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (this._contextMenu !== null) {
      this._closeContextMenu();
    }
    const rect = event.currentTarget.getBoundingClientRect();
    this._branchMenu = {
      x: rect.left,
      y: rect.bottom + 4,
      branches: [],
      current: this.branchInfo?.branch || null,
      loading: true,
    };
    document.addEventListener(
      'click',
      this._onDocumentClickForBranchMenu,
      true,
    );
    document.addEventListener(
      'keydown',
      this._onDocumentKeyDownForBranchMenu,
      true,
    );
    this.dispatchEvent(
      new CustomEvent('branch-menu-requested', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  populateBranchMenu(branches) {
    if (this._branchMenu === null) return;
    this._branchMenu = {
      ...this._branchMenu,
      branches: Array.isArray(branches) ? branches : [],
      loading: false,
    };
  }

  _closeBranchMenu() {
    if (this._branchMenu === null) return;
    this._branchMenu = null;
    document.removeEventListener(
      'click',
      this._onDocumentClickForBranchMenu,
      true,
    );
    document.removeEventListener(
      'keydown',
      this._onDocumentKeyDownForBranchMenu,
      true,
    );
  }

  _onDocumentClickForBranchMenu(event) {
    if (this._branchMenu === null) return;
    const path = event.composedPath
      ? event.composedPath()
      : [event.target];
    const insideMenu = path.some(
      (el) =>
        el &&
        el.classList &&
        el.classList.contains('branch-menu'),
    );
    if (!insideMenu) {
      this._closeBranchMenu();
    }
  }

  _onDocumentKeyDownForBranchMenu(event) {
    if (this._branchMenu === null) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this._closeBranchMenu();
    }
  }

  _onBranchMenuItemClick(event, branch) {
    event.preventDefault();
    event.stopPropagation();
    if (branch.is_current) {
      this._closeBranchMenu();
      return;
    }
    this.dispatchEvent(
      new CustomEvent('branch-switch-requested', {
        detail: { name: branch.name, is_remote: branch.is_remote },
        bubbles: true,
        composed: true,
      }),
    );
    this._closeBranchMenu();
  }

  _renderBranchMenu() {
    if (this._branchMenu === null) return '';
    const { x, y, branches, loading } = this._branchMenu;
    const margin = _CONTEXT_MENU_VIEWPORT_MARGIN;
    const maxX = window.innerWidth - _BRANCH_MENU_WIDTH - margin;
    const maxY = window.innerHeight - _BRANCH_MENU_MAX_HEIGHT - margin;
    const clampedX = Math.max(margin, Math.min(x, maxX));
    const clampedY = Math.max(margin, Math.min(y, maxY));
    return html`
      <div
        class="branch-menu"
        style="left: ${clampedX}px; top: ${clampedY}px"
        role="menu"
        aria-label="Switch branch"
      >
        <div class="branch-menu-header">Switch branch</div>
        <div class="branch-menu-body">
          ${loading
            ? html`<div class="branch-menu-loading">Loading…</div>`
            : this._renderBranchMenuItems(branches)}
        </div>
      </div>
    `;
  }

  _renderBranchMenuItems(branches) {
    if (!Array.isArray(branches) || branches.length === 0) {
      return html`<div class="branch-menu-loading">No branches</div>`;
    }
    return branches.map((b) => {
      const glyph = b.is_remote ? '☁' : '⎇';
      return html`
        <button
          type="button"
          class="branch-menu-item"
          ?disabled=${b.is_current}
          role="menuitem"
          title=${b.is_remote
            ? `${b.name} — remote branch (switching will create a local tracking branch)`
            : b.is_current
              ? `${b.name} — current branch`
              : `Switch to ${b.name}`}
          @click=${(e) => this._onBranchMenuItemClick(e, b)}
        >
          <span class="branch-glyph">${glyph}</span>
          <span class="branch-name">${b.name}</span>
          ${b.is_current
            ? html`<span class="branch-flag current">current</span>`
            : b.is_remote
              ? html`<span class="branch-flag remote">remote</span>`
              : ''}
        </button>
      `;
    });
  }

  // ---------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------

  _onTreeKeyDown(event) {
    const target = event.target;
    if (
      target &&
      target.classList &&
      target.classList.contains('inline-input')
    ) {
      return;
    }
    const rows = this._collectVisibleRows();
    if (rows.length === 0) return;
    let currentIdx = rows.findIndex(
      (n) => n.path === this._focusedPath,
    );
    if (currentIdx < 0) currentIdx = -1;
    const current = currentIdx >= 0 ? rows[currentIdx] : null;
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const nextIdx =
          currentIdx < 0
            ? 0
            : Math.min(currentIdx + 1, rows.length - 1);
        this._setFocusedAndScroll(rows[nextIdx].path);
        return;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const prevIdx =
          currentIdx < 0
            ? 0
            : Math.max(currentIdx - 1, 0);
        this._setFocusedAndScroll(rows[prevIdx].path);
        return;
      }
      case 'ArrowRight': {
        if (!current) return;
        event.preventDefault();
        if (current.type === 'dir') {
          const expanded = this._effectiveExpanded();
          if (!expanded.has(current.path)) {
            this._toggleExpanded(current.path);
          } else {
            const nextIdx = currentIdx + 1;
            if (nextIdx < rows.length) {
              this._setFocusedAndScroll(rows[nextIdx].path);
            }
          }
        }
        return;
      }
      case 'ArrowLeft': {
        if (!current) return;
        event.preventDefault();
        const expanded = this._effectiveExpanded();
        if (current.type === 'dir' && expanded.has(current.path)) {
          this._toggleExpanded(current.path);
          return;
        }
        const parentPath = this._parentPathOf(current.path);
        if (parentPath === null) return;
        const parentRow = rows.find((n) => n.path === parentPath);
        if (parentRow) {
          this._setFocusedAndScroll(parentPath);
        }
        return;
      }
      case 'Enter':
      case ' ': {
        if (!current) return;
        event.preventDefault();
        if (current.type === 'dir') {
          this._toggleExpanded(current.path);
        } else {
          const next = new Set(this.selectedFiles);
          if (next.has(current.path)) {
            next.delete(current.path);
          } else {
            next.add(current.path);
          }
          this._emitSelectionChanged(next);
        }
        return;
      }
      case 'Home': {
        event.preventDefault();
        this._setFocusedAndScroll(rows[0].path);
        return;
      }
      case 'End': {
        event.preventDefault();
        this._setFocusedAndScroll(rows[rows.length - 1].path);
        return;
      }
      case 'F2': {
        if (!current) return;
        event.preventDefault();
        if (current.type === 'file') {
          this.beginRename(current.path);
        }
        return;
      }
      default:
        return;
    }
  }

  _collectVisibleRows() {
    const tree = filterTree(this.tree, this.filterQuery);
    const expanded = this._effectiveExpanded();
    const out = [];
    const walk = (node) => {
      const children = sortChildrenWithMode(
        node.children,
        this._sortMode,
        this._sortAsc,
      );
      for (const child of children) {
        out.push(child);
        if (child.type === 'dir' && expanded.has(child.path)) {
          walk(child);
        }
      }
    };
    if (tree) walk(tree);
    return out;
  }

  _parentPathOf(path) {
    if (typeof path !== 'string' || !path) return null;
    const idx = path.lastIndexOf('/');
    if (idx < 0) return null;
    return path.slice(0, idx);
  }

  _setFocusedAndScroll(path) {
    this._focusedPath = path;
    this.updateComplete.then(() => {
      const row = this._findRowElementForPath(path);
      if (row && typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  _findRowElementForPath(path) {
    if (!this.shadowRoot) return null;
    return this.shadowRoot.querySelector(
      `[data-row-path="${this._cssEscape(path)}"]`,
    );
  }

  _cssEscape(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return String(value).replace(
      /[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g,
      '\\$&',
    );
  }
}

customElements.define('ac-file-picker', FilePicker);

// Re-export pure helpers and constants for tests and downstream
// importers that pulled them from the old file-picker.js entry
// point.
export {
  computeFilterExpansions,
  filterTree,
  fuzzyMatch,
  sortChildren,
  sortChildrenWithMode,
} from './helpers.js';
export {
  CTX_ACTION_DELETE,
  CTX_ACTION_DISCARD,
  CTX_ACTION_DUPLICATE,
  CTX_ACTION_EXCLUDE,
  CTX_ACTION_EXCLUDE_ALL,
  CTX_ACTION_INCLUDE,
  CTX_ACTION_INCLUDE_ALL,
  CTX_ACTION_LOAD_LEFT,
  CTX_ACTION_LOAD_RIGHT,
  CTX_ACTION_NEW_DIR,
  CTX_ACTION_NEW_FILE,
  CTX_ACTION_RENAME,
  CTX_ACTION_RENAME_DIR,
  CTX_ACTION_STAGE,
  CTX_ACTION_STAGE_ALL,
  CTX_ACTION_UNSTAGE,
  CTX_ACTION_UNSTAGE_ALL,
  SORT_MODE_MTIME,
  SORT_MODE_NAME,
  SORT_MODE_SIZE,
} from './constants.js';