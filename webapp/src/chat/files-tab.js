import { LitElement, html, css, nothing } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';
import './chat-panel.js';
import './chat-input.js';
import './url-chips.js';
import './file-picker.js';
import './history-browser.js';
import './review-selector.js';
import './review-chips.js';

/**
 * Files & Chat tab — left panel (file picker) + right panel (chat).
 * This orchestrates chat state, streaming, URL state, file selection, and message flow.
 */
class FilesTab extends RpcMixin(LitElement) {
  static properties = {
    messages: { type: Array, state: true },
    selectedFiles: { type: Array, state: true },
    streaming: { type: Boolean, state: true },
    snippets: { type: Array, state: true },
    _activeRequestId: { type: String, state: true },
    _detectedUrls: { type: Array, state: true },
    _fetchedUrls: { type: Array, state: true },
    _excludedUrls: { type: Object, state: true },
    _pickerCollapsed: { type: Boolean, state: true },
    _pickerWidth: { type: Number, state: true },
    _dividerDragging: { type: Boolean, state: true },
    _confirmAction: { type: Object, state: true },
    _historyOpen: { type: Boolean, state: true },
    /** Flat list of repo file paths for file mention detection */
    _repoFiles: { type: Array, state: true },
    /** Path of file currently active in the diff viewer */
    _viewerActiveFile: { type: String, state: true },
    /** Chat search query */
    _chatSearch: { type: String, state: true },
    _chatSearchIndex: { type: Number, state: true },
    _chatSearchMatches: { type: Array, state: true },
    /** Review mode state */
    _reviewState: { type: Object, state: true },
    _reviewSelectorOpen: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      height: 100%;
      overflow: hidden;
    }

    .file-picker-panel {
      border-right: 1px solid var(--border-color);
      background: var(--bg-secondary);
      overflow: hidden;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
    }

    .file-picker-panel.collapsed {
      width: 0 !important;
      min-width: 0 !important;
      border-right: none;
    }

    /* ── Panel divider / resize handle ── */
    .panel-divider {
      width: 6px;
      flex-shrink: 0;
      background: var(--bg-secondary);
      border-left: 1px solid var(--border-color);
      cursor: col-resize;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      z-index: 5;
      transition: background var(--transition-fast);
    }
    .panel-divider:hover,
    .panel-divider.dragging {
      background: var(--bg-surface);
    }
    .panel-divider.collapsed {
      cursor: default;
      width: 4px;
    }

    .divider-grip {
      width: 2px;
      height: 24px;
      border-radius: 1px;
      background: var(--border-color);
      pointer-events: none;
    }
    .panel-divider:hover .divider-grip,
    .panel-divider.dragging .divider-grip {
      background: var(--text-muted);
    }

    .collapse-btn {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 16px;
      height: 32px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: 3px;
      color: var(--text-muted);
      font-size: 9px;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 6;
      line-height: 1;
    }
    .panel-divider:hover .collapse-btn,
    .panel-divider.collapsed .collapse-btn {
      display: flex;
    }
    .collapse-btn:hover {
      color: var(--text-primary);
      background: var(--bg-surface);
    }

    .chat-panel-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
      position: relative;
    }

    /* ── Git action bar ── */
    .git-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-elevated);
      flex-shrink: 0;
    }

    .git-btn {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 3px 8px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 4px;
      transition: background var(--transition-fast), color var(--transition-fast);
      white-space: nowrap;
    }
    .git-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }
    .git-btn.danger:hover {
      background: rgba(239,83,80,0.15);
      color: var(--accent-error);
    }
    .git-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .git-spacer { flex: 1; }

    .chat-search-group {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 2px;
      min-width: 60px;
    }

    .chat-search {
      flex: 1;
      min-width: 0;
      padding: 3px 8px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 11px;
      font-family: var(--font-mono);
      outline: none;
      box-sizing: border-box;
    }
    .chat-search:focus { border-color: var(--accent-primary); }
    .chat-search::placeholder { color: var(--text-muted); }

    .chat-search-nav {
      background: none;
      border: none;
      padding: 2px 4px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-muted);
      border-radius: var(--radius-sm);
      line-height: 1;
    }
    .chat-search-nav:hover { color: var(--text-primary); }
    .chat-search-nav:disabled { opacity: 0.3; cursor: default; }

    .chat-search-count {
      font-size: 10px;
      color: var(--text-muted);
      white-space: nowrap;
      min-width: 28px;
      text-align: center;
    }

    .session-btn {
      background: none;
      border: none;
      padding: 3px 6px;
      cursor: pointer;
      font-size: 13px;
      color: var(--text-muted);
      border-radius: var(--radius-sm);
      transition: color var(--transition-fast);
    }
    .session-btn:hover { color: var(--text-primary); }

    /* ── Confirm dialog ── */
    .confirm-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 300;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .confirm-dialog {
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 16px 20px;
      box-shadow: var(--shadow-lg);
      max-width: 360px;
    }
    .confirm-dialog p {
      color: var(--text-primary);
      font-size: 13px;
      margin: 0 0 12px 0;
    }
    .confirm-btns {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .confirm-btns button {
      padding: 5px 14px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      cursor: pointer;
      font-size: 12px;
    }
    .confirm-btns button.danger {
      background: var(--accent-error);
      color: white;
      border-color: var(--accent-error);
    }
  `;

  constructor() {
    super();
    this.messages = [];
    this.selectedFiles = [];
    this.streaming = false;
    this.snippets = [];
    this._activeRequestId = null;
    this._watchdogTimer = null;
    this._detectedUrls = [];
    this._fetchedUrls = [];
    this._excludedUrls = new Set();
    this._dividerDragging = false;
    this._confirmAction = null;
    this._historyOpen = false;
    this._repoFiles = [];
    this._viewerActiveFile = '';
    this._chatSearch = '';
    this._chatSearchIndex = -1;
    this._chatSearchMatches = [];
    this._reviewState = null;
    this._reviewSelectorOpen = false;

    // Picker panel state — restore from localStorage
    this._pickerCollapsed = localStorage.getItem('ac-dc-picker-collapsed') === 'true';
    this._pickerWidth = parseInt(localStorage.getItem('ac-dc-picker-width')) || 280;

    // Bind divider drag handlers
    this._onDividerMove = this._onDividerMove.bind(this);
    this._onDividerUp = this._onDividerUp.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    this._boundOnStateLoaded = this._onStateLoaded.bind(this);
    this._boundOnStreamComplete = this._onStreamComplete.bind(this);
    this._boundOnCompactionEvent = this._onCompactionEvent.bind(this);
    this._boundOnFilesChanged = this._onFilesChanged.bind(this);
    this._boundOnViewerActiveFile = this._onViewerActiveFile.bind(this);
    this._boundOnFileFilter = this._onFileFilter.bind(this);
    window.addEventListener('state-loaded', this._boundOnStateLoaded);
    window.addEventListener('stream-complete', this._boundOnStreamComplete);
    window.addEventListener('compaction-event', this._boundOnCompactionEvent);
    window.addEventListener('files-changed', this._boundOnFilesChanged);
    window.addEventListener('viewer-active-file', this._boundOnViewerActiveFile);
    this.shadowRoot.addEventListener('file-filter', this._boundOnFileFilter);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('state-loaded', this._boundOnStateLoaded);
    window.removeEventListener('stream-complete', this._boundOnStreamComplete);
    window.removeEventListener('compaction-event', this._boundOnCompactionEvent);
    window.removeEventListener('files-changed', this._boundOnFilesChanged);
    window.removeEventListener('viewer-active-file', this._boundOnViewerActiveFile);
    this.shadowRoot.removeEventListener('file-filter', this._boundOnFileFilter);
    document.removeEventListener('mousemove', this._onDividerMove);
    document.removeEventListener('mouseup', this._onDividerUp);
    this._clearWatchdog();
  }

  onRpcReady() {
    this._loadSnippets();
    this._loadFileTree();
    this._loadReviewState();
  }

  async _loadSnippets() {
    try {
      const result = await this.rpcExtract('Settings.get_snippets');
      const base = result?.snippets || [];
      const review = result?.review_snippets || [];
      // Store both; we'll merge based on review state
      this._baseSnippets = base;
      this._reviewSnippets = review;
      this._updateSnippets();
    } catch (e) {
      console.warn('Failed to load snippets:', e);
      this._baseSnippets = [];
      this._reviewSnippets = [];
    }
  }

  _updateSnippets() {
    if (this._reviewState?.active && this._reviewSnippets?.length) {
      this.snippets = [...(this._baseSnippets || []), ...(this._reviewSnippets || [])];
    } else {
      this.snippets = [...(this._baseSnippets || [])];
    }
  }

  async _loadReviewState() {
    try {
      const state = await this.rpcExtract('LLM.get_review_state');
      this._reviewState = state || { active: false };
      this._updateSnippets();

      // Detect stale review state from a previous session/crash
      if (!state?.active && state?.stale_review) {
        const stale = state.stale_review;
        this._toast(
          `Detected stale review state: branch '${stale.branch}' was being reviewed. ` +
          `Use the review selector to recover or click the notification to restore.`,
          'warning',
        );
        // Auto-recover: attempt to restore the branch
        try {
          const result = await this.rpcExtract('LLM.recover_from_stale_review');
          if (result?.error) {
            this._toast('Review recovery failed: ' + result.error, 'error');
          } else {
            this._toast(`Branch '${stale.branch}' restored from stale review state`, 'success');
            await this._loadFileTree();
          }
        } catch (e) {
          this._toast('Review recovery failed: ' + e, 'error');
        }
      }
    } catch (e) {
      this._reviewState = { active: false };
    }
  }

  async _loadFileTree() {
    try {
      const result = await this.rpcExtract('Repo.get_file_tree');
      if (result && !result.error) {
        const picker = this.shadowRoot.querySelector('file-picker');
        if (picker) picker.setTree(result);
        // Extract flat file list for file mention detection
        this._repoFiles = this._collectAllFiles(result.tree);
      }
    } catch (e) {
      console.warn('Failed to load file tree:', e);
    }
  }

  /** Recursively collect all file paths from tree structure */
  _collectAllFiles(node) {
    if (!node) return [];
    const files = [];
    const walk = (n) => {
      if (n.type === 'file') files.push(n.path);
      if (n.children) n.children.forEach(walk);
    };
    walk(node);
    return files;
  }

  _onStateLoaded(e) {
    const state = e.detail;
    if (state) {
      this.messages = state.messages || [];
      this.selectedFiles = state.selected_files || [];
      this.streaming = state.streaming_active || false;
      // Sync selection to picker and scroll chat to bottom
      // Double updateComplete: first waits for files-tab to pass messages down,
      // second waits for chat-panel to render them, so scroll target exists.
      this.updateComplete.then(() => {
        const picker = this.shadowRoot.querySelector('file-picker');
        if (picker && this.selectedFiles.length) picker.setSelectedFiles(this.selectedFiles);
        if (this.messages.length > 0) {
          const panel = this.shadowRoot.querySelector('chat-panel');
          if (panel) {
            panel.updateComplete.then(() => {
              panel.scrollToBottom();
            });
          }
        }
      });
    }
  }

  // ── File picker events ──

  _onSelectionChanged(e) {
    const { selectedFiles } = e.detail;
    this.selectedFiles = selectedFiles;
    // Notify server
    if (this.rpcConnected) {
      this.rpcCall('LLM.set_selected_files', selectedFiles).catch(() => {});
    }
  }

  _onFileClicked(e) {
    // Bubble up as navigate-file — app-shell routes to diff viewer
    this.dispatchEvent(new CustomEvent('navigate-file', {
      detail: { path: e.detail.path },
      bubbles: true, composed: true,
    }));
  }

  _onPathToInput(e) {
    const { path } = e.detail;
    if (!path) return;
    const input = this.shadowRoot.querySelector('chat-input');
    if (!input) return;
    const textarea = input.shadowRoot?.querySelector('textarea');
    if (!textarea) return;

    // Insert path at cursor position with a space before and after
    const start = textarea.selectionStart;
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(textarea.selectionEnd);
    const insert = ' ' + path + ' ';
    textarea.value = before + insert + after;
    const newPos = start + insert.length;
    textarea.selectionStart = textarea.selectionEnd = newPos;
    textarea.dispatchEvent(new Event('input'));
    input._autoResize(textarea);
    textarea.focus();
  }

  async _onGitOperation() {
    // Refresh tree after any git operation
    await this._loadFileTree();
  }

  _onFilesChanged(e) {
    const { selectedFiles } = e.detail;
    if (selectedFiles) {
      this.selectedFiles = selectedFiles;
      this.updateComplete.then(() => {
        const picker = this.shadowRoot.querySelector('file-picker');
        if (picker) picker.setSelectedFiles(selectedFiles);
      });
    }
  }

  _onViewerActiveFile(e) {
    this._viewerActiveFile = e.detail?.path || '';
  }

  _onFileFilter(e) {
    const picker = this.shadowRoot.querySelector('file-picker');
    if (picker) {
      picker.setFilter(e.detail?.query || '');
    }
  }

  // ── Review mode ──

  _openReviewSelector() {
    this._reviewSelectorOpen = true;
  }

  async _onReviewStarted(e) {
    this._reviewSelectorOpen = false;
    const { result } = e.detail;
    this._reviewState = {
      active: true,
      branch: result.branch,
      base_commit: result.base_commit,
      commits: result.commits,
      changed_files: result.changed_files,
      symbol_diff: result.symbol_diff,
      stats: result.stats,
    };
    this._updateSnippets();

    // Refresh file tree (now shows staged review files)
    await this._loadFileTree();

    this._toast(`Review mode active: ${result.branch}`, 'success');
  }

  _onReviewSelectorClosed() {
    this._reviewSelectorOpen = false;
  }

  async _onEndReview() {
    try {
      this._toast('Exiting review mode...', 'info');
      const result = await this.rpcExtract('LLM.end_review');
      if (result?.error) {
        this._toast('Failed to exit review: ' + result.error, 'error');
        return;
      }
      this._reviewState = { active: false };
      this._updateSnippets();
      await this._loadFileTree();
      this._toast('Review mode ended', 'success');
    } catch (e) {
      this._toast('Failed to exit review: ' + e, 'error');
    }
  }

  // ── File mention handling ──

  _onFileMentionClick(e) {
    const { path } = e.detail;
    if (!path) return;

    const next = new Set(this.selectedFiles);
    const wasSelected = next.has(path);

    if (wasSelected) {
      // Remove from selection
      next.delete(path);
      this._removeFileFromInput(path);
    } else {
      // Add to selection
      next.add(path);
      this._addFileToInput(path);
    }

    this.selectedFiles = [...next];

    // Sync to picker (also auto-expands parent dirs)
    const picker = this.shadowRoot.querySelector('file-picker');
    if (picker) {
      picker.setSelectedFiles(this.selectedFiles);
      if (!wasSelected) picker._expandParents(path);
    }

    // Notify server
    if (this.rpcConnected) {
      this.rpcCall('LLM.set_selected_files', this.selectedFiles).catch(() => {});
    }
  }

  /** Accumulate a file addition into the chat input textarea */
  _addFileToInput(filePath) {
    const input = this.shadowRoot.querySelector('chat-input');
    if (!input) return;
    const textarea = input.shadowRoot?.querySelector('textarea');
    if (!textarea) return;

    const fileName = filePath.split('/').pop();
    const currentText = textarea.value;
    const suffix = ' added. Do you want to see more files before you continue?';

    // Pattern: "The file(s) X, Y, Z added. Do you want to see more files..."
    const pattern = /^The files? (.+) added\. Do you want to see more files before you continue\?$/;
    const match = currentText.match(pattern);

    if (match) {
      // Append to existing file list
      const existingFiles = match[1];
      textarea.value = `The files ${existingFiles}, ${fileName}${suffix}`;
    } else if (currentText.trim() === '') {
      // Empty input — start fresh
      textarea.value = `The file ${fileName}${suffix}`;
    } else {
      // Has unrelated text — append parenthetical
      textarea.value = `${currentText} (added ${fileName})`;
    }

    textarea.dispatchEvent(new Event('input'));
    input._autoResize(textarea);
  }

  /** Remove a file from the accumulated input text */
  _removeFileFromInput(filePath) {
    const input = this.shadowRoot.querySelector('chat-input');
    if (!input) return;
    const textarea = input.shadowRoot?.querySelector('textarea');
    if (!textarea) return;

    const fileName = filePath.split('/').pop();
    const currentText = textarea.value;
    const suffix = ' added. Do you want to see more files before you continue?';

    // Pattern: "The file(s) X, Y, Z added. Do you want to see more files..."
    const pattern = /^The files? (.+) added\. Do you want to see more files before you continue\?$/;
    const match = currentText.match(pattern);

    if (match) {
      const files = match[1].split(', ').filter(f => f !== fileName);
      if (files.length === 0) {
        textarea.value = '';
      } else if (files.length === 1) {
        textarea.value = `The file ${files[0]}${suffix}`;
      } else {
        textarea.value = `The files ${files.join(', ')}${suffix}`;
      }
    } else {
      // Try removing parenthetical: " (added filename)"
      const parenthetical = ` (added ${fileName})`;
      if (currentText.includes(parenthetical)) {
        textarea.value = currentText.replace(parenthetical, '');
      }
    }

    textarea.dispatchEvent(new Event('input'));
    input._autoResize(textarea);
  }

  /** Extract deduplicated user messages from conversation history, most recent first */
  _getUserMessageHistory() {
    if (!this.messages || this.messages.length === 0) return [];
    const seen = new Set();
    const result = [];
    // Walk from newest to oldest
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.role === 'user' && msg.content) {
        const text = typeof msg.content === 'string' ? msg.content : '';
        if (text && !seen.has(text)) {
          seen.add(text);
          result.push(text);
        }
      }
    }
    return result;
  }

  // ── Chat search ──

  _onChatSearchInput(e) {
    this._chatSearch = e.target.value;
    this._updateChatSearchMatches();
    if (this._chatSearchMatches.length > 0) {
      this._chatSearchIndex = 0;
      this._scrollToChatMatch();
    } else {
      this._chatSearchIndex = -1;
    }
  }

  _onChatSearchKeydown(e) {
    if (e.key === 'Escape') {
      this._chatSearch = '';
      this._chatSearchMatches = [];
      this._chatSearchIndex = -1;
      this._clearChatSearchHighlights();
      e.target.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        this._chatSearchPrev();
      } else {
        this._chatSearchNext();
      }
    }
  }

  _updateChatSearchMatches() {
    const query = this._chatSearch.trim().toLowerCase();
    if (!query) {
      this._chatSearchMatches = [];
      this._clearChatSearchHighlights();
      return;
    }
    const matches = [];
    for (let i = 0; i < this.messages.length; i++) {
      const text = typeof this.messages[i].content === 'string' ? this.messages[i].content : '';
      if (text.toLowerCase().includes(query)) {
        matches.push(i);
      }
    }
    this._chatSearchMatches = matches;
  }

  _chatSearchNext() {
    if (this._chatSearchMatches.length === 0) return;
    this._chatSearchIndex = (this._chatSearchIndex + 1) % this._chatSearchMatches.length;
    this._scrollToChatMatch();
  }

  _chatSearchPrev() {
    if (this._chatSearchMatches.length === 0) return;
    this._chatSearchIndex = (this._chatSearchIndex - 1 + this._chatSearchMatches.length) % this._chatSearchMatches.length;
    this._scrollToChatMatch();
  }

  _scrollToChatMatch() {
    const panel = this.shadowRoot.querySelector('chat-panel');
    if (!panel) return;
    const msgIdx = this._chatSearchMatches[this._chatSearchIndex];
    if (msgIdx == null) return;

    this.updateComplete.then(() => {
      const root = panel.shadowRoot;
      if (!root) return;
      // Clear previous highlights
      root.querySelectorAll('.message-card.search-highlight').forEach(el => {
        el.classList.remove('search-highlight');
      });
      // Find and highlight the target card by data attribute
      const card = root.querySelector(`.message-card[data-msg-index="${msgIdx}"]`);
      if (card) {
        card.classList.add('search-highlight');
        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  }

  _clearChatSearchHighlights() {
    const panel = this.shadowRoot.querySelector('chat-panel');
    if (!panel) return;
    const root = panel.shadowRoot;
    if (!root) return;
    root.querySelectorAll('.message-card.search-highlight').forEach(el => {
      el.classList.remove('search-highlight');
    });
  }

  // ── URL events ──

  _onUrlsDetected(e) {
    const { urls } = e.detail;
    // Filter out URLs that are already fetched
    const fetchedSet = new Set(this._fetchedUrls.map(f => f.url));
    this._detectedUrls = urls.filter(u => !fetchedSet.has(u.url));
  }

  _onUrlFetched(e) {
    const { url, result } = e.detail;
    // Remove from detected
    this._detectedUrls = this._detectedUrls.filter(d => d.url !== url);
    // Add to / update fetched
    const existing = this._fetchedUrls.findIndex(f => f.url === url);
    const entry = {
      url,
      url_type: result.url_type || 'generic',
      title: result.title || '',
      display_name: result.display_name || url,
      error: result.error || '',
    };
    if (existing >= 0) {
      this._fetchedUrls = [
        ...this._fetchedUrls.slice(0, existing),
        entry,
        ...this._fetchedUrls.slice(existing + 1),
      ];
    } else {
      this._fetchedUrls = [...this._fetchedUrls, entry];
    }
  }

  _onUrlDismissed(e) {
    this._detectedUrls = this._detectedUrls.filter(d => d.url !== e.detail.url);
  }

  _onUrlRemoved(e) {
    const { url } = e.detail;
    this._fetchedUrls = this._fetchedUrls.filter(f => f.url !== url);
    const next = new Set(this._excludedUrls);
    next.delete(url);
    this._excludedUrls = next;
  }

  _onUrlToggleExclude(e) {
    const { url } = e.detail;
    const next = new Set(this._excludedUrls);
    if (next.has(url)) {
      next.delete(url);
    } else {
      next.add(url);
    }
    this._excludedUrls = next;
  }

  _onUrlViewContent(e) {
    // Future: open a modal to view fetched content
    // For now, log to console
    console.log('[url-chips] View content for:', e.detail.url);
  }

  _getIncludedUrls() {
    return this._fetchedUrls
      .filter(f => !f.error && !this._excludedUrls.has(f.url))
      .map(f => f.url);
  }

  // ── Sending ──

  async _onSendMessage(e) {
    const { message, images } = e.detail;
    if (this.streaming) return;

    // Show user message immediately (include images for display)
    const userMsg = { role: 'user', content: message };
    if (images && images.length > 0) {
      userMsg.images = [...images];
    }
    this.messages = [...this.messages, userMsg];

    // Clear detected URLs on send (fetched persist across messages)
    this._detectedUrls = [];

    // Generate request ID
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this._activeRequestId = requestId;
    this.streaming = true;

    // Start watchdog (5 minute timeout)
    this._startWatchdog();

    // Scroll chat to bottom
    this.shadowRoot.querySelector('chat-panel')?.scrollToBottom();

    try {
      await this.rpcCall(
        'LLM.chat_streaming',
        requestId,
        message,
        this.selectedFiles,
        images.length > 0 ? images : [],
      );
    } catch (e) {
      console.error('chat_streaming failed:', e);
      this.streaming = false;
      this._clearWatchdog();
      this._toast('Failed to send message: ' + (e.message || e), 'error');
    }
  }

  _onStreamComplete(e) {
    const { result } = e.detail;
    this._clearWatchdog();
    this.streaming = false;
    this._activeRequestId = null;

    // Show error toast if present
    if (result.error) {
      this._toast(result.error, 'error');
    }

    // Add assistant message to our list
    if (result.response) {
      this.messages = [...this.messages, {
        role: 'assistant',
        content: result.response,
        editResults: result.edit_results || [],
      }];
    }

    // Refresh file tree if edits were applied
    if (result.files_modified?.length > 0) {
      this._loadFileTree();
    }

    // Focus input
    this.shadowRoot.querySelector('chat-input')?.focus();
  }

  _onCompactionEvent(e) {
    const event = e.detail?.event;
    if (!event) return;

    if (event.type === 'compaction_complete' && event.case !== 'none') {
      // Rebuild messages from compacted history
      if (event.messages) {
        this.messages = [...event.messages];
        // Auto-scroll only if user is already at bottom
        this.updateComplete.then(() => {
          this.shadowRoot.querySelector('chat-panel')?.scrollToBottomIfAtBottom();
        });
      }
      // Show summary as system-like message
      const info = event.case === 'truncate'
        ? `History truncated: ${event.messages_before} → ${event.messages_after} messages`
        : `History compacted: ${event.messages_before} → ${event.messages_after} messages`;
      console.log(`[ac-dc] ${info}`);
    }
  }

  // ── Watchdog ──

  _startWatchdog() {
    this._clearWatchdog();
    this._watchdogTimer = setTimeout(() => {
      console.warn('[ac-dc] Watchdog timeout — forcing stream recovery');
      this.streaming = false;
      this._activeRequestId = null;
    }, 5 * 60 * 1000); // 5 minutes
  }

  _clearWatchdog() {
    if (this._watchdogTimer) {
      clearTimeout(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }

  // ── Stop streaming ──

  async _onStopStreaming() {
    if (!this._activeRequestId) return;
    try {
      await this.rpcCall('LLM.cancel_streaming', this._activeRequestId);
    } catch (e) {
      console.warn('Failed to cancel streaming:', e);
    }
  }

  // ── Copy to prompt ──

  _onCopyToPrompt(e) {
    const { text } = e.detail;
    if (!text) return;
    const input = this.shadowRoot.querySelector('chat-input');
    if (input) {
      const textarea = input.shadowRoot?.querySelector('textarea');
      if (textarea) {
        textarea.value = text;
        textarea.dispatchEvent(new Event('input'));
        input._autoResize(textarea);
        input.focus();
      }
    }
  }

  // ── Panel divider drag ──

  _onDividerDown(e) {
    if (this._pickerCollapsed) return;
    e.preventDefault();
    this._dividerDragging = true;
    this._dividerStartX = e.clientX;
    this._dividerStartWidth = this._pickerWidth;
    document.addEventListener('mousemove', this._onDividerMove);
    document.addEventListener('mouseup', this._onDividerUp);
  }

  _onDividerMove(e) {
    if (!this._dividerDragging) return;
    const dx = e.clientX - this._dividerStartX;
    const newWidth = Math.max(150, Math.min(500, this._dividerStartWidth + dx));
    this._pickerWidth = newWidth;
  }

  _onDividerUp() {
    if (!this._dividerDragging) return;
    this._dividerDragging = false;
    document.removeEventListener('mousemove', this._onDividerMove);
    document.removeEventListener('mouseup', this._onDividerUp);
    localStorage.setItem('ac-dc-picker-width', String(this._pickerWidth));
  }

  _togglePickerCollapsed() {
    this._pickerCollapsed = !this._pickerCollapsed;
    localStorage.setItem('ac-dc-picker-collapsed', String(this._pickerCollapsed));
  }

  // ── Git actions ──

  /** Dispatch a toast notification. */
  _toast(message, type = 'info') {
    window.dispatchEvent(new CustomEvent('ac-toast', {
      detail: { message, type },
      bubbles: true,
    }));
  }

  async _copyDiff() {
    try {
      const staged = await this.rpcExtract('Repo.get_staged_diff');
      const unstaged = await this.rpcExtract('Repo.get_unstaged_diff');
      const parts = [];
      if (staged?.diff) parts.push('=== Staged ===\n' + staged.diff);
      if (unstaged?.diff) parts.push('=== Unstaged ===\n' + unstaged.diff);
      const text = parts.join('\n\n') || '(no changes)';
      await navigator.clipboard.writeText(text);
      this._toast('Diff copied to clipboard', 'success');
    } catch (e) {
      console.error('Copy diff failed:', e);
      this._toast('Failed to copy diff: ' + (e.message || e), 'error');
    }
  }

  async _commitWithMessage() {
    if (this.streaming) return;
    try {
      this._toast('Staging all changes...', 'info');
      // Stage all
      await this.rpcExtract('Repo.stage_all');
      // Get staged diff
      const diffResult = await this.rpcExtract('Repo.get_staged_diff');
      if (!diffResult?.diff?.trim()) {
        this._toast('Nothing to commit — working tree clean', 'info');
        return;
      }
      this._toast('Generating commit message...', 'info');
      // Generate commit message
      const msgResult = await this.rpcExtract('LLM.generate_commit_message', diffResult.diff);
      if (msgResult?.error) {
        this._toast(`Commit message generation failed: ${msgResult.error}`, 'error');
        return;
      }
      // Commit
      const commitMsg = msgResult.message || msgResult;
      this._toast('Committing...', 'info');
      const commitResult = await this.rpcExtract('Repo.commit', commitMsg);
      if (commitResult?.error) {
        this._toast(`Commit failed: ${commitResult.error}`, 'error');
      } else {
        this._toast('Committed successfully', 'success');
        this.messages = [...this.messages, {
          role: 'assistant',
          content: `**Committed:**\n\n${commitMsg}`,
        }];
        // Auto-scroll only if user is already at bottom
        this.updateComplete.then(() => {
          this.shadowRoot.querySelector('chat-panel')?.scrollToBottomIfAtBottom();
        });
      }
      // Refresh tree
      await this._loadFileTree();
    } catch (e) {
      console.error('Commit failed:', e);
      this._toast('Commit failed: ' + (e.message || e), 'error');
    }
  }

  _requestReset() {
    this._confirmAction = {
      message: 'Reset all changes? This will discard all uncommitted modifications (git reset --hard HEAD).',
      action: () => this._doReset(),
    };
  }

  async _doReset() {
    this._confirmAction = null;
    try {
      const result = await this.rpcExtract('Repo.reset_hard');
      if (result?.error) {
        this._toast(`Reset failed: ${result.error}`, 'error');
      } else {
        this._toast('Repository reset to HEAD', 'success');
      }
      await this._loadFileTree();
      // Scroll chat to bottom so user sees latest context
      this.shadowRoot.querySelector('chat-panel')?.scrollToBottom();
    } catch (e) {
      console.error('Reset failed:', e);
      this._toast('Reset failed: ' + (e.message || e), 'error');
    }
  }

  _cancelConfirm() {
    this._confirmAction = null;
  }

  async _newSession() {
    try {
      await this.rpcExtract('LLM.history_new_session');
      this.messages = [];
      this._detectedUrls = [];
      this._fetchedUrls = [];
      this._excludedUrls = new Set();
      this._toast('New session started', 'info');
      window.dispatchEvent(new CustomEvent('session-reset'));
    } catch (e) {
      console.error('New session failed:', e);
      this._toast('Failed to start new session: ' + (e.message || e), 'error');
    }
  }

  // ── History browser ──

  _openHistory() {
    this._historyOpen = true;
  }

  _onHistoryClosed() {
    this._historyOpen = false;
  }

  _onSessionLoaded(e) {
    const { messages } = e.detail;
    if (Array.isArray(messages)) {
      this.messages = [...messages];
    }
    this._historyOpen = false;
    // Scroll chat to bottom
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector('chat-panel')?.scrollToBottom();
    });
  }

  _onInsertToPrompt(e) {
    const { text } = e.detail;
    if (text) {
      const input = this.shadowRoot.querySelector('chat-input');
      if (input) {
        const textarea = input.shadowRoot?.querySelector('textarea');
        if (textarea) {
          textarea.value = text;
          textarea.dispatchEvent(new Event('input'));
          input.focus();
        }
      }
    }
  }

  // ── Render ──

  render() {
    const pickerStyle = this._pickerCollapsed
      ? ''
      : `width:${this._pickerWidth}px; min-width:150px; max-width:500px;`;

    return html`
      <div class="file-picker-panel ${this._pickerCollapsed ? 'collapsed' : ''}"
        style=${pickerStyle}>
        <file-picker
          .viewerActiveFile=${this._viewerActiveFile}
          .reviewState=${this._reviewState}
          @selection-changed=${this._onSelectionChanged}
          @file-clicked=${this._onFileClicked}
          @git-operation=${this._onGitOperation}
          @path-to-input=${this._onPathToInput}
          @review-end-requested=${this._onEndReview}
        ></file-picker>
      </div>

      <div class="panel-divider ${this._pickerCollapsed ? 'collapsed' : ''} ${this._dividerDragging ? 'dragging' : ''}"
        @mousedown=${(e) => this._onDividerDown(e)}>
        <span class="divider-grip"></span>
        <button class="collapse-btn"
          @mousedown=${(e) => e.stopPropagation()}
          @click=${this._togglePickerCollapsed}
          title=${this._pickerCollapsed ? 'Show file picker' : 'Hide file picker'}
          aria-label=${this._pickerCollapsed ? 'Show file picker' : 'Hide file picker'}
          aria-expanded=${!this._pickerCollapsed}>
          ${this._pickerCollapsed ? '▶' : '◀'}
        </button>
      </div>

      <div class="chat-panel-container">
        <div class="git-actions" role="toolbar" aria-label="Session and git actions">
          <button class="session-btn" @click=${this._newSession}
            title="New session" aria-label="Start new session">✨</button>
          <button class="session-btn" @click=${this._openHistory}
            title="Browse history" aria-label="Browse conversation history">📜</button>
          <div class="chat-search-group">
            <input type="text" class="chat-search"
              placeholder="Search chat…"
              aria-label="Search chat messages"
              .value=${this._chatSearch}
              @input=${this._onChatSearchInput}
              @keydown=${this._onChatSearchKeydown}>
            ${this._chatSearchMatches.length > 0 ? html`
              <span class="chat-search-count">${this._chatSearchIndex + 1}/${this._chatSearchMatches.length}</span>
              <button class="chat-search-nav" @click=${this._chatSearchPrev} title="Previous (Shift+Enter)" aria-label="Previous match">▲</button>
              <button class="chat-search-nav" @click=${this._chatSearchNext} title="Next (Enter)" aria-label="Next match">▼</button>
            ` : this._chatSearch.trim() ? html`
              <span class="chat-search-count">0</span>
            ` : nothing}
          </div>
          <button class="git-btn" @click=${this._openReviewSelector}
            ?disabled=${this.streaming || this._reviewState?.active}
            title="Start code review"
            aria-label="Start code review">📋</button>
          <button class="git-btn" @click=${this._copyDiff} title="Copy diff to clipboard"
            aria-label="Copy diff to clipboard">📄</button>
          <button class="git-btn" @click=${this._commitWithMessage}
            ?disabled=${this.streaming || this._reviewState?.active}
            title="Stage all, generate message, commit"
            aria-label="Auto-commit with generated message">💾</button>
          <button class="git-btn danger" @click=${this._requestReset}
            ?disabled=${this.streaming || this._reviewState?.active}
            title="Reset to HEAD"
            aria-label="Reset repository to HEAD">⚠️</button>
        </div>

        <chat-panel
          .messages=${this.messages}
          .streaming=${this.streaming}
          .repoFiles=${this._repoFiles}
          .selectedFiles=${new Set(this.selectedFiles)}
          @file-mention-click=${this._onFileMentionClick}
          @copy-to-prompt=${this._onCopyToPrompt}
        ></chat-panel>

        ${this._reviewState?.active ? html`
          <review-chips
            .reviewState=${this._reviewState}
            .selectedFiles=${this.selectedFiles}
            @review-end-requested=${this._onEndReview}
          ></review-chips>
        ` : nothing}

        <url-chips
          .detected=${this._detectedUrls}
          .fetched=${this._fetchedUrls}
          .excluded=${this._excludedUrls}
          @urls-detected=${this._onUrlsDetected}
          @url-fetched=${this._onUrlFetched}
          @url-dismissed=${this._onUrlDismissed}
          @url-removed=${this._onUrlRemoved}
          @url-toggle-exclude=${this._onUrlToggleExclude}
          @url-view-content=${this._onUrlViewContent}
        ></url-chips>

        <chat-input
          .disabled=${this.streaming}
          .snippets=${this.snippets}
          .userMessageHistory=${this._getUserMessageHistory()}
          @send-message=${this._onSendMessage}
          @stop-streaming=${this._onStopStreaming}
          @urls-detected=${this._onUrlsDetected}
        ></chat-input>
      </div>

      <history-browser
        .open=${this._historyOpen}
        @history-closed=${this._onHistoryClosed}
        @session-loaded=${this._onSessionLoaded}
        @insert-to-prompt=${this._onInsertToPrompt}
      ></history-browser>

      <review-selector
        .open=${this._reviewSelectorOpen}
        @review-started=${this._onReviewStarted}
        @review-closed=${this._onReviewSelectorClosed}
      ></review-selector>

      ${this._confirmAction ? html`
        <div class="confirm-backdrop" @click=${this._cancelConfirm} role="presentation">
          <div class="confirm-dialog" role="alertdialog" aria-label="Confirm action"
            @click=${(e) => e.stopPropagation()}>
            <p>${this._confirmAction.message}</p>
            <div class="confirm-btns">
              <button @click=${this._cancelConfirm}>Cancel</button>
              <button class="danger" @click=${() => this._confirmAction.action()}>Reset</button>
            </div>
          </div>
        </div>
      ` : nothing}
    `;
  }
}

customElements.define('files-tab', FilesTab);