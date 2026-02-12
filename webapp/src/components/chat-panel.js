/**
 * Chat panel — message display, streaming, input area.
 */

import { LitElement, html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';

// Import child components
import './input-history.js';
import './url-chips.js';

// Simple markdown → HTML (basic: headers, code blocks, bold, italic, links)
function renderMarkdown(text) {
  if (!text) return '';
  let result = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks (``` ... ```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="code-block"><code>${code}</code></pre>`;
    })
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Headers
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    // Line breaks (but not inside pre blocks)
    .replace(/\n/g, '<br>');

  return result;
}

export class AcChatPanel extends RpcMixin(LitElement) {
  static properties = {
    messages: { type: Array },
    selectedFiles: { type: Array },
    streamingActive: { type: Boolean },
    _streamingContent: { type: String, state: true },
    _inputValue: { type: String, state: true },
    _images: { type: Array, state: true },
    _autoScroll: { type: Boolean, state: true },
    _snippetDrawerOpen: { type: Boolean, state: true },
    _historyOpen: { type: Boolean, state: true },
    _currentRequestId: { type: String, state: true },
    _confirmAction: { type: Object, state: true },
    _toast: { type: Object, state: true },
    _committing: { type: Boolean, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    /* Action bar */
    .action-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      min-height: 36px;
    }

    .action-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.9rem;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .action-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }
    .action-btn.danger:hover {
      color: var(--accent-red);
    }
    .action-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .action-btn:disabled:hover {
      background: none;
      color: var(--text-muted);
    }

    .action-spacer { flex: 1; }

    /* Confirm dialog overlay */
    .confirm-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .confirm-dialog {
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      padding: 24px;
      max-width: 400px;
      box-shadow: var(--shadow-lg);
    }

    .confirm-dialog h3 {
      margin: 0 0 12px;
      color: var(--text-primary);
      font-size: 1rem;
    }

    .confirm-dialog p {
      margin: 0 0 20px;
      color: var(--text-secondary);
      font-size: 0.9rem;
      line-height: 1.5;
    }

    .confirm-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .confirm-actions button {
      padding: 6px 16px;
      border-radius: var(--radius-sm);
      font-size: 0.85rem;
      cursor: pointer;
      border: 1px solid var(--border-primary);
    }

    .confirm-cancel {
      background: var(--bg-tertiary);
      color: var(--text-secondary);
    }
    .confirm-cancel:hover {
      background: var(--bg-primary);
      color: var(--text-primary);
    }

    .confirm-danger {
      background: var(--accent-red);
      color: white;
      border-color: var(--accent-red);
    }
    .confirm-danger:hover {
      opacity: 0.9;
    }

    /* Toast notification */
    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      padding: 8px 16px;
      font-size: 0.85rem;
      color: var(--text-secondary);
      z-index: 10001;
      box-shadow: var(--shadow-md);
      transition: opacity 0.3s;
    }
    .toast.success { border-color: var(--accent-green); color: var(--accent-green); }
    .toast.error { border-color: var(--accent-red); color: var(--accent-red); }

    /* Messages area */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      scroll-behavior: smooth;
    }

    .message-card {
      margin-bottom: 12px;
      padding: 12px 16px;
      border-radius: var(--radius-md);
      border: 1px solid transparent;
      line-height: 1.6;
      font-size: 0.9rem;
      position: relative;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .message-card.user {
      background: var(--bg-tertiary);
      border-color: var(--border-primary);
    }

    .message-card.assistant {
      background: var(--bg-secondary);
    }

    .message-card .role-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 6px;
      letter-spacing: 0.05em;
    }

    .message-card.user .role-label { color: var(--accent-primary); }
    .message-card.assistant .role-label { color: var(--accent-green); }

    .md-content h2, .md-content h3, .md-content h4 {
      margin-top: 0.8em;
      margin-bottom: 0.4em;
      color: var(--text-primary);
    }
    .md-content h2 { font-size: 1.1rem; }
    .md-content h3 { font-size: 1rem; }
    .md-content h4 { font-size: 0.95rem; }

    .md-content pre.code-block {
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      padding: 12px;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      margin: 8px 0;
      position: relative;
    }

    .md-content code {
      font-family: var(--font-mono);
      font-size: 0.85em;
      background: var(--bg-primary);
      padding: 0.15em 0.4em;
      border-radius: 3px;
    }

    .md-content pre.code-block code {
      background: none;
      padding: 0;
    }

    /* Copy button on code blocks */
    .md-content pre.code-block .copy-btn {
      position: absolute;
      top: 6px;
      right: 6px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.75rem;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .md-content pre.code-block:hover .copy-btn {
      opacity: 1;
    }
    .md-content pre.code-block .copy-btn:hover {
      color: var(--text-primary);
    }

    /* Streaming indicator */
    .streaming-indicator {
      display: inline-block;
      width: 8px;
      height: 8px;
      background: var(--accent-primary);
      border-radius: 50%;
      animation: pulse 1s ease-in-out infinite;
      margin-left: 4px;
      vertical-align: middle;
    }

    @keyframes pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    /* Scroll sentinel */
    .scroll-sentinel {
      height: 1px;
    }

    /* Scroll to bottom button */
    .scroll-bottom-btn {
      position: absolute;
      bottom: 80px;
      right: 24px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      font-size: 1rem;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 5;
      box-shadow: var(--shadow-md);
    }
    .scroll-bottom-btn.visible {
      display: flex;
    }
    .scroll-bottom-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }

    /* Empty state */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      text-align: center;
      gap: 8px;
    }
    .empty-state .brand {
      font-size: 2rem;
      opacity: 0.3;
    }
    .empty-state .hint {
      font-size: 0.85rem;
    }

    /* Input area */
    .input-area {
      position: relative;
      border-top: 1px solid var(--border-primary);
      padding: 8px 12px;
      background: var(--bg-secondary);
    }

    .input-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    .input-textarea {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 0.9rem;
      padding: 10px 12px;
      resize: none;
      min-height: 42px;
      max-height: 200px;
      line-height: 1.4;
      outline: none;
    }
    .input-textarea:focus {
      border-color: var(--accent-primary);
    }
    .input-textarea::placeholder {
      color: var(--text-muted);
    }

    .send-btn {
      background: var(--accent-primary);
      border: none;
      color: var(--bg-primary);
      font-size: 1rem;
      width: 42px;
      height: 42px;
      border-radius: var(--radius-md);
      cursor: pointer;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .send-btn:hover { opacity: 0.9; }
    .send-btn.stop {
      background: var(--accent-red);
    }
    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Image previews */
    .image-previews {
      display: flex;
      gap: 8px;
      padding: 8px 0 4px;
      flex-wrap: wrap;
    }

    .image-preview {
      position: relative;
      width: 64px;
      height: 64px;
      border-radius: var(--radius-sm);
      overflow: hidden;
      border: 1px solid var(--border-primary);
    }

    .image-preview img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .image-preview .remove-btn {
      position: absolute;
      top: 2px;
      right: 2px;
      background: rgba(0, 0, 0, 0.6);
      color: white;
      border: none;
      font-size: 0.65rem;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Snippet drawer */
    .snippet-drawer {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 6px 0;
    }

    .snippet-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      font-size: 0.75rem;
      padding: 3px 8px;
      border-radius: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .snippet-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }

    .snippet-toggle {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.85rem;
      padding: 4px;
      cursor: pointer;
      flex-shrink: 0;
    }
    .snippet-toggle:hover {
      color: var(--text-primary);
    }
    .snippet-toggle.active {
      color: var(--accent-primary);
    }

  `];

  constructor() {
    super();
    this.messages = [];
    this.selectedFiles = [];
    this.streamingActive = false;
    this._streamingContent = '';
    this._inputValue = '';
    this._images = [];
    this._autoScroll = true;
    this._snippetDrawerOpen = false;
    this._historyOpen = false;
    this._snippets = [];
    this._observer = null;
    this._pendingChunk = null;
    this._rafId = null;
    this._currentRequestId = null;
    this._confirmAction = null;
    this._toast = null;
    this._committing = false;

    // Bind event handlers
    this._onStreamChunk = this._onStreamChunk.bind(this);
    this._onStreamComplete = this._onStreamComplete.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('stream-chunk', this._onStreamChunk);
    window.addEventListener('stream-complete', this._onStreamComplete);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('stream-chunk', this._onStreamChunk);
    window.removeEventListener('stream-complete', this._onStreamComplete);
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._observer) this._observer.disconnect();
  }

  firstUpdated() {
    // Set up IntersectionObserver for auto-scroll
    const sentinel = this.shadowRoot.querySelector('.scroll-sentinel');
    const container = this.shadowRoot.querySelector('.messages');
    if (sentinel && container) {
      this._observer = new IntersectionObserver(
        ([entry]) => {
          this._autoScroll = entry.isIntersecting;
        },
        { root: container, threshold: 0.1 }
      );
      this._observer.observe(sentinel);
    }
  }

  onRpcReady() {
    this._loadSnippets();
  }

  async _loadSnippets() {
    try {
      const snippets = await this.rpcExtract('Settings.get_snippets');
      if (Array.isArray(snippets)) {
        this._snippets = snippets;
      }
    } catch (e) {
      console.warn('Failed to load snippets:', e);
    }
  }

  // === Streaming ===

  _onStreamChunk(e) {
    const { requestId, content } = e.detail;
    if (requestId !== this._currentRequestId) return;

    this.streamingActive = true;
    // Coalesce per animation frame
    this._pendingChunk = content;
    if (!this._rafId) {
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        if (this._pendingChunk !== null) {
          this._streamingContent = this._pendingChunk;
          this._pendingChunk = null;
          if (this._autoScroll) {
            this._scrollToBottom();
          }
        }
      });
    }
  }

  _onStreamComplete(e) {
    const { requestId, result } = e.detail;
    if (requestId !== this._currentRequestId) return;

    // Flush any pending chunk
    if (this._pendingChunk !== null) {
      this._streamingContent = this._pendingChunk;
      this._pendingChunk = null;
    }

    this.streamingActive = false;
    this._currentRequestId = null;

    if (result?.error) {
      // Show error as assistant message
      this.messages = [...this.messages, { role: 'assistant', content: `**Error:** ${result.error}` }];
    } else if (result?.response) {
      // Add the assistant response to messages
      this.messages = [...this.messages, { role: 'assistant', content: result.response }];
    }

    this._streamingContent = '';
    this._pendingChunk = null;

    if (this._autoScroll) {
      requestAnimationFrame(() => this._scrollToBottom());
    }

    // Refresh file tree if edits were applied
    if (result?.files_modified?.length > 0) {
      this.dispatchEvent(new CustomEvent('files-modified', {
        detail: { files: result.files_modified },
        bubbles: true, composed: true,
      }));
    }
  }

  // === Scrolling ===

  _scrollToBottom() {
    const container = this.shadowRoot?.querySelector('.messages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  _onScrollBtnClick() {
    this._autoScroll = true;
    this._scrollToBottom();
  }

  // === Input ===

  _onInput(e) {
    this._inputValue = e.target.value;
    this._autoResize(e.target);
    this._onInputForUrlDetection();
  }

  _autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }

  _onKeyDown(e) {
    // If history overlay is open, delegate to it
    const historyEl = this.shadowRoot?.querySelector('ac-input-history');
    if (historyEl?.open) {
      if (historyEl.handleKey(e)) return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._send();
      return;
    }

    // Up arrow at position 0 → open input history
    if (e.key === 'ArrowUp') {
      const textarea = e.target;
      if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        e.preventDefault();
        if (historyEl) {
          historyEl.show(this._inputValue);
          this._historyOpen = true;
        }
        return;
      }
    }

    // Escape priority chain
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this._snippetDrawerOpen) {
        this._snippetDrawerOpen = false;
      } else if (this._inputValue) {
        this._inputValue = '';
        const textarea = this.shadowRoot?.querySelector('.input-textarea');
        if (textarea) {
          textarea.value = '';
          textarea.style.height = 'auto';
        }
      }
    }
  }

  _onPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        // Check size (5MB)
        if (file.size > 5 * 1024 * 1024) {
          // TODO: show error toast
          console.warn('Image too large (max 5MB)');
          continue;
        }

        // Check count
        if (this._images.length >= 5) {
          console.warn('Max 5 images per message');
          continue;
        }

        const reader = new FileReader();
        reader.onload = () => {
          this._images = [...this._images, reader.result];
        };
        reader.readAsDataURL(file);
        break; // One image per paste event
      }
    }
  }

  _removeImage(index) {
    this._images = this._images.filter((_, i) => i !== index);
  }

  async _send() {
    const message = this._inputValue.trim();
    if (!message && this._images.length === 0) return;
    if (!this.rpcConnected) return;

    // Record in input history
    const historyEl = this.shadowRoot?.querySelector('ac-input-history');
    if (historyEl && message) {
      historyEl.addEntry(message);
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this._currentRequestId = requestId;
    const images = this._images.length > 0 ? [...this._images] : null;
    const files = this.selectedFiles?.length > 0 ? [...this.selectedFiles] : null;

    // Get URL context before clearing
    const urlChips = this.shadowRoot?.querySelector('ac-url-chips');
    urlChips?.onSend();

    // Add user message to display immediately
    this.messages = [...this.messages, { role: 'user', content: message }];

    // Clear input
    this._inputValue = '';
    this._images = [];
    this._snippetDrawerOpen = false;
    const textarea = this.shadowRoot?.querySelector('.input-textarea');
    if (textarea) {
      textarea.value = '';
      textarea.style.height = 'auto';
    }

    // Auto-scroll on send
    this._autoScroll = true;
    this.streamingActive = true;
    requestAnimationFrame(() => this._scrollToBottom());

    try {
      await this.rpcExtract('LLMService.chat_streaming', requestId, message, files, images);
    } catch (e) {
      console.error('Failed to start stream:', e);
      this.streamingActive = false;
      this._currentRequestId = null;
      this.messages = [...this.messages, { role: 'assistant', content: `**Error:** ${e.message || 'Failed to connect'}` }];
    }
  }

  async _stop() {
    if (!this._currentRequestId || !this.rpcConnected) return;
    try {
      await this.rpcExtract('LLMService.cancel_streaming', this._currentRequestId);
    } catch (e) {
      console.error('Failed to cancel:', e);
    }
  }

  // === Snippets ===

  _toggleSnippets() {
    this._snippetDrawerOpen = !this._snippetDrawerOpen;
  }

  _insertSnippet(snippet) {
    const textarea = this.shadowRoot?.querySelector('.input-textarea');
    if (!textarea) return;

    const msg = snippet.message || '';
    const start = textarea.selectionStart;
    const before = this._inputValue.slice(0, start);
    const after = this._inputValue.slice(textarea.selectionEnd);
    this._inputValue = before + msg + after;
    textarea.value = this._inputValue;
    this._autoResize(textarea);

    // Place cursor after inserted text
    const newPos = start + msg.length;
    textarea.setSelectionRange(newPos, newPos);
    textarea.focus();
  }

  // === Input History ===

  _onHistorySelect(e) {
    const text = e.detail?.text ?? '';
    this._inputValue = text;
    this._historyOpen = false;
    const textarea = this.shadowRoot?.querySelector('.input-textarea');
    if (textarea) {
      textarea.value = text;
      this._autoResize(textarea);
      textarea.focus();
    }
  }

  _onHistoryCancel(e) {
    const text = e.detail?.text ?? '';
    this._inputValue = text;
    this._historyOpen = false;
    const textarea = this.shadowRoot?.querySelector('.input-textarea');
    if (textarea) {
      textarea.value = text;
      textarea.focus();
    }
  }

  // === URL Detection ===

  _onInputForUrlDetection() {
    const urlChips = this.shadowRoot?.querySelector('ac-url-chips');
    if (urlChips) {
      urlChips.detectUrls(this._inputValue);
    }
  }

  // === Actions ===

  _newSession() {
    this.dispatchEvent(new CustomEvent('new-session', { bubbles: true, composed: true }));
  }

  // === Git Actions ===

  async _copyDiff() {
    if (!this.rpcConnected) return;
    try {
      const staged = await this.rpcExtract('Repo.get_staged_diff');
      const unstaged = await this.rpcExtract('Repo.get_unstaged_diff');
      const stagedDiff = staged?.diff || '';
      const unstagedDiff = unstaged?.diff || '';

      const combined = [stagedDiff, unstagedDiff].filter(Boolean).join('\n');
      if (!combined.trim()) {
        this._showToast('No changes to copy', 'error');
        return;
      }

      await navigator.clipboard.writeText(combined);
      this._showToast('Diff copied to clipboard', 'success');
    } catch (e) {
      console.error('Failed to copy diff:', e);
      this._showToast('Failed to copy diff', 'error');
    }
  }

  async _commitWithMessage() {
    if (!this.rpcConnected || this._committing) return;
    this._committing = true;

    try {
      // Stage all changes
      const stageResult = await this.rpcExtract('Repo.stage_all');
      if (stageResult?.error) {
        this._showToast(`Stage failed: ${stageResult.error}`, 'error');
        return;
      }

      // Get staged diff for commit message generation
      const diffResult = await this.rpcExtract('Repo.get_staged_diff');
      const diff = diffResult?.diff || '';
      if (!diff.trim()) {
        this._showToast('Nothing to commit', 'error');
        return;
      }

      // Generate commit message via LLM
      const msgResult = await this.rpcExtract('LLMService.generate_commit_message', diff);
      if (msgResult?.error) {
        this._showToast(`Message generation failed: ${msgResult.error}`, 'error');
        return;
      }

      const commitMessage = msgResult?.message;
      if (!commitMessage) {
        this._showToast('Failed to generate commit message', 'error');
        return;
      }

      // Commit
      const commitResult = await this.rpcExtract('Repo.commit', commitMessage);
      if (commitResult?.error) {
        this._showToast(`Commit failed: ${commitResult.error}`, 'error');
        return;
      }

      const sha = commitResult?.sha?.slice(0, 7) || '';
      this._showToast(`Committed ${sha}: ${commitMessage.split('\n')[0]}`, 'success');

      // Add commit info as a system-like message in chat
      this.messages = [...this.messages, {
        role: 'assistant',
        content: `**Committed** \`${sha}\`\n\n\`\`\`\n${commitMessage}\n\`\`\``,
      }];

      if (this._autoScroll) {
        requestAnimationFrame(() => this._scrollToBottom());
      }

      // Refresh file tree
      this.dispatchEvent(new CustomEvent('files-modified', {
        detail: { files: [] },
        bubbles: true, composed: true,
      }));
    } catch (e) {
      console.error('Commit failed:', e);
      this._showToast(`Commit failed: ${e.message || 'Unknown error'}`, 'error');
    } finally {
      this._committing = false;
    }
  }

  _confirmReset() {
    this._confirmAction = {
      title: 'Reset to HEAD',
      message: 'This will discard ALL uncommitted changes (staged and unstaged). This cannot be undone.',
      action: () => this._resetHard(),
    };
  }

  async _resetHard() {
    this._confirmAction = null;
    if (!this.rpcConnected) return;

    try {
      const result = await this.rpcExtract('Repo.reset_hard');
      if (result?.error) {
        this._showToast(`Reset failed: ${result.error}`, 'error');
        return;
      }

      this._showToast('Reset to HEAD — all changes discarded', 'success');

      // Refresh file tree
      this.dispatchEvent(new CustomEvent('files-modified', {
        detail: { files: [] },
        bubbles: true, composed: true,
      }));
    } catch (e) {
      console.error('Reset failed:', e);
      this._showToast(`Reset failed: ${e.message || 'Unknown error'}`, 'error');
    }
  }

  _dismissConfirm() {
    this._confirmAction = null;
  }

  _showToast(message, type = '') {
    this._toast = { message, type };
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this._toast = null;
    }, 3000);
  }

  // === Rendering ===

  _renderMessage(msg, index) {
    const isUser = msg.role === 'user';
    const content = msg.content || '';

    return html`
      <div class="message-card ${msg.role}" data-msg-index="${index}">
        <div class="role-label">${isUser ? 'You' : 'Assistant'}</div>
        <div class="md-content" @click=${this._onContentClick}>
          ${unsafeHTML(renderMarkdown(content))}
        </div>
      </div>
    `;
  }

  _onContentClick(e) {
    // Handle copy button clicks on code blocks
    const btn = e.target.closest('.copy-btn');
    if (btn) {
      const pre = btn.closest('pre');
      if (pre) {
        const code = pre.querySelector('code');
        if (code) {
          navigator.clipboard.writeText(code.textContent).then(() => {
            btn.textContent = '✓ Copied';
            setTimeout(() => { btn.textContent = '📋'; }, 1500);
          });
        }
      }
    }
  }

  render() {
    const hasMessages = this.messages.length > 0 || this._streamingContent;

    return html`
      <!-- Action Bar -->
      <div class="action-bar">
        <button class="action-btn" title="New session" @click=${this._newSession}>✨</button>
        <button class="action-btn" title="Browse history">📜</button>
        <div class="action-spacer"></div>
        <button class="action-btn" title="Copy diff" @click=${this._copyDiff}
          ?disabled=${!this.rpcConnected}>📋</button>
        <button class="action-btn" title="Stage all & commit" @click=${this._commitWithMessage}
          ?disabled=${!this.rpcConnected || this._committing || this.streamingActive}>💾</button>
        <button class="action-btn danger" title="Reset to HEAD" @click=${this._confirmReset}
          ?disabled=${!this.rpcConnected || this.streamingActive}>⚠️</button>
      </div>

      <!-- Messages -->
      <div class="messages">
        ${!hasMessages ? html`
          <div class="empty-state">
            <div class="brand">AC⚡DC</div>
            <div class="hint">Select files and start chatting</div>
          </div>
        ` : html`
          ${this.messages.map((msg, i) => this._renderMessage(msg, i))}

          ${this._streamingContent ? html`
            <div class="message-card assistant">
              <div class="role-label">
                Assistant <span class="streaming-indicator"></span>
              </div>
              <div class="md-content">
                ${unsafeHTML(renderMarkdown(this._streamingContent))}
              </div>
            </div>
          ` : nothing}
        `}

        <div class="scroll-sentinel"></div>
      </div>

      <!-- Scroll to bottom -->
      <button
        class="scroll-bottom-btn ${!this._autoScroll && hasMessages ? 'visible' : ''}"
        @click=${this._onScrollBtnClick}
      >↓</button>

      <!-- Input Area -->
      <div class="input-area">
        <ac-input-history
          @history-select=${this._onHistorySelect}
          @history-cancel=${this._onHistoryCancel}
        ></ac-input-history>

        <ac-url-chips></ac-url-chips>

        ${this._images.length > 0 ? html`
          <div class="image-previews">
            ${this._images.map((img, i) => html`
              <div class="image-preview">
                <img src="${img}" alt="Pasted image">
                <button class="remove-btn" @click=${() => this._removeImage(i)}>✕</button>
              </div>
            `)}
          </div>
        ` : nothing}

        ${this._snippetDrawerOpen && this._snippets.length > 0 ? html`
          <div class="snippet-drawer">
            ${this._snippets.map(s => html`
              <button class="snippet-btn" @click=${() => this._insertSnippet(s)} title="${s.tooltip || ''}">
                ${s.icon || '📌'} ${s.tooltip || s.message?.slice(0, 30) || 'Snippet'}
              </button>
            `)}
          </div>
        ` : nothing}

        <div class="input-row">
          <button
            class="snippet-toggle ${this._snippetDrawerOpen ? 'active' : ''}"
            @click=${this._toggleSnippets}
            title="Quick snippets"
          >📌</button>

          <textarea
            class="input-textarea"
            placeholder="Message AC⚡DC..."
            rows="1"
            .value=${this._inputValue}
            @input=${this._onInput}
            @keydown=${this._onKeyDown}
            @paste=${this._onPaste}
          ></textarea>

          ${this.streamingActive ? html`
            <button class="send-btn stop" @click=${this._stop} title="Stop">⏹</button>
          ` : html`
            <button
              class="send-btn"
              @click=${this._send}
              ?disabled=${!this.rpcConnected}
              title="Send (Enter)"
            >↑</button>
          `}
        </div>
      </div>

      <!-- Confirm Dialog -->
      ${this._confirmAction ? html`
        <div class="confirm-overlay" @click=${this._dismissConfirm}>
          <div class="confirm-dialog" @click=${(e) => e.stopPropagation()}>
            <h3>${this._confirmAction.title}</h3>
            <p>${this._confirmAction.message}</p>
            <div class="confirm-actions">
              <button class="confirm-cancel" @click=${this._dismissConfirm}>Cancel</button>
              <button class="confirm-danger" @click=${this._confirmAction.action}>
                ${this._confirmAction.title}
              </button>
            </div>
          </div>
        </div>
      ` : nothing}

      <!-- Toast -->
      ${this._toast ? html`
        <div class="toast ${this._toast.type}">${this._toast.message}</div>
      ` : nothing}
    `;
  }
}

customElements.define('ac-chat-panel', AcChatPanel);