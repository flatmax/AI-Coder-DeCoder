/**
 * AcChatPanel — chat message display, streaming, input, and edit blocks.
 *
 * Renders conversation messages, handles streaming display with
 * chunk coalescing, manages auto-scrolling, and provides the input area.
 */

import { LitElement, html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { RpcMixin } from '../utils/rpc-mixin.js';
import { renderMarkdown } from '../utils/markdown.js';
import { segmentResponse, computeDiff } from '../utils/edit-blocks.js';
import { generateRequestId, formatTokens } from '../utils/helpers.js';

export class AcChatPanel extends RpcMixin(LitElement) {
  static properties = {
    messages: { type: Array },
    selectedFiles: { type: Array },
    streamingActive: { type: Boolean },
    reviewState: { type: Object },
    _streamingContent: { type: String, state: true },
    _currentRequestId: { type: String, state: true },
    _inputValue: { type: String, state: true },
    _images: { type: Array, state: true },
    _snippetDrawerOpen: { type: Boolean, state: true },
    _snippets: { type: Array, state: true },
    _autoScroll: { type: Boolean, state: true },
    _toast: { type: Object, state: true },
    _committing: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      min-width: 0;
    }

    /* Action bar */
    .action-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-bottom: 1px solid var(--border-primary);
      flex-shrink: 0;
      min-height: 32px;
    }
    .action-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-secondary);
      font-size: 0.85rem;
      padding: 3px 6px;
      border-radius: 4px;
    }
    .action-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }
    .action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .action-spacer { flex: 1; }

    /* Message container */
    .messages {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 8px;
      scroll-behavior: auto;
    }

    /* Message cards */
    .message-card {
      margin-bottom: 8px;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid transparent;
      transition: border-color 0.3s, box-shadow 0.3s;
      position: relative;
    }
    .message-card.user {
      background: var(--bg-tertiary);
      border-color: var(--border-secondary);
    }
    .message-card.assistant {
      background: var(--bg-secondary);
    }
    .message-card.search-highlight {
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 1px var(--accent-primary), 0 0 12px rgba(79, 195, 247, 0.15);
    }

    .message-role {
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 4px;
      text-transform: uppercase;
    }
    .message-role.user { color: var(--accent-primary); }
    .message-role.assistant { color: var(--accent-green); }

    /* Markdown content */
    .md-content {
      font-size: 0.85rem;
      line-height: 1.5;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .md-content p { margin: 0.4em 0; }
    .md-content h1, .md-content h2, .md-content h3,
    .md-content h4, .md-content h5, .md-content h6 {
      margin: 0.6em 0 0.3em;
      color: var(--accent-primary);
    }
    .md-content h1 { font-size: 1.1rem; }
    .md-content h2 { font-size: 1rem; }
    .md-content h3 { font-size: 0.95rem; }
    .md-content ul, .md-content ol { padding-left: 1.5em; margin: 0.3em 0; }
    .md-content blockquote {
      border-left: 3px solid var(--border-primary);
      padding-left: 8px;
      color: var(--text-secondary);
      margin: 0.3em 0;
    }
    .md-content table {
      border-collapse: collapse;
      margin: 0.4em 0;
      font-size: 0.8rem;
    }
    .md-content th, .md-content td {
      border: 1px solid var(--border-primary);
      padding: 4px 8px;
    }
    .md-content th { background: var(--bg-tertiary); }
    .md-content a { color: var(--accent-primary); text-decoration: none; }
    .md-content a:hover { text-decoration: underline; }
    .md-content code {
      background: var(--bg-input);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 0.82rem;
    }

    /* highlight.js dark theme (minimal) */
    .md-content .hljs { color: var(--text-primary); }
    .md-content .hljs-keyword,
    .md-content .hljs-selector-tag,
    .md-content .hljs-built_in { color: #c678dd; }
    .md-content .hljs-string,
    .md-content .hljs-attr { color: #98c379; }
    .md-content .hljs-number,
    .md-content .hljs-literal { color: #d19a66; }
    .md-content .hljs-comment,
    .md-content .hljs-doctag { color: #5c6370; font-style: italic; }
    .md-content .hljs-title,
    .md-content .hljs-function { color: #61afef; }
    .md-content .hljs-type,
    .md-content .hljs-class { color: #e5c07b; }
    .md-content .hljs-variable { color: #e06c75; }
    .md-content .hljs-params { color: var(--text-primary); }
    .md-content .hljs-meta { color: #56b6c2; }
    .md-content .hljs-regexp { color: #56b6c2; }
    .md-content .hljs-addition { color: var(--accent-green); }
    .md-content .hljs-deletion { color: var(--accent-red); }

    /* Code blocks */
    .md-content pre.code-block {
      background: var(--bg-input);
      border: 1px solid var(--border-secondary);
      border-radius: 6px;
      padding: 8px 12px;
      margin: 0.5em 0;
      overflow-x: auto;
      position: relative;
      font-size: 0.8rem;
      line-height: 1.4;
    }
    .md-content pre.code-block code {
      background: none;
      padding: 0;
      font-size: inherit;
    }
    .md-content .code-lang {
      position: absolute;
      top: 4px;
      right: 36px;
      font-size: 0.65rem;
      color: var(--text-muted);
    }
    .md-content .copy-btn {
      position: absolute;
      top: 4px;
      right: 8px;
      background: none;
      border: none;
      cursor: pointer;
      font-size: 0.75rem;
      opacity: 0;
      transition: opacity 0.15s;
      color: var(--text-secondary);
    }
    .md-content pre.code-block:hover .copy-btn { opacity: 1; }

    /* Edit blocks */
    .edit-block {
      border: 1px solid var(--border-primary);
      border-radius: 6px;
      margin: 0.5em 0;
      overflow: hidden;
      background: var(--bg-input);
    }
    .edit-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-secondary);
      font-size: 0.8rem;
    }
    .edit-file-path {
      color: var(--accent-primary);
      cursor: pointer;
      font-weight: 500;
    }
    .edit-file-path:hover { text-decoration: underline; }
    .edit-goto {
      cursor: pointer;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .edit-goto:hover { color: var(--text-primary); }
    .edit-status {
      font-size: 0.7rem;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 600;
    }
    .edit-status.applied { color: var(--accent-green); }
    .edit-status.failed { color: var(--accent-red); }
    .edit-status.skipped { color: var(--accent-orange); }
    .edit-status.pending { color: var(--text-muted); }
    .edit-status.not-in-context { color: var(--accent-amber); }
    .edit-status.create { color: var(--accent-green); }

    .edit-error {
      padding: 4px 10px;
      font-size: 0.75rem;
      color: var(--accent-red);
      background: rgba(249, 117, 131, 0.08);
    }

    .edit-diff {
      font-family: monospace;
      font-size: 0.78rem;
      line-height: 1.4;
      overflow-x: auto;
    }
    .diff-line {
      display: block;
      padding: 0 8px;
      white-space: pre;
    }
    .diff-line.remove { background: #2d1215; color: var(--accent-red); }
    .diff-line.add { background: #122117; color: var(--accent-green); }
    .diff-line.context { background: var(--bg-primary); color: var(--text-primary); }
    .diff-line .diff-prefix {
      user-select: none;
      opacity: 0.5;
      display: inline-block;
      width: 1.2em;
    }
    .diff-line.remove .diff-change { background: #6d3038; }
    .diff-line.add .diff-change { background: #2b6331; }

    /* Edit summary */
    .edit-summary {
      padding: 6px 10px;
      margin-top: 6px;
      border-radius: 6px;
      background: var(--bg-tertiary);
      font-size: 0.78rem;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .edit-summary .stat {
      padding: 1px 6px;
      border-radius: 3px;
      font-weight: 600;
      font-size: 0.72rem;
    }
    .stat.green { color: var(--accent-green); }
    .stat.red { color: var(--accent-red); }
    .stat.orange { color: var(--accent-orange); }
    .stat.amber { color: var(--accent-amber); }

    /* Streaming indicator */
    .streaming-indicator {
      display: inline-block;
      width: 6px;
      height: 14px;
      background: var(--accent-primary);
      animation: blink 0.8s infinite;
      vertical-align: text-bottom;
      margin-left: 2px;
    }
    @keyframes blink { 50% { opacity: 0; } }

    /* Input area */
    .input-area {
      border-top: 1px solid var(--border-primary);
      padding: 8px;
      flex-shrink: 0;
    }
    .input-row {
      display: flex;
      gap: 6px;
      align-items: flex-end;
    }
    .input-textarea {
      flex: 1;
      background: var(--bg-input);
      border: 1px solid var(--border-secondary);
      border-radius: 6px;
      color: var(--text-primary);
      padding: 8px 10px;
      font-size: 0.85rem;
      font-family: inherit;
      resize: none;
      min-height: 36px;
      max-height: 200px;
      outline: none;
      line-height: 1.4;
    }
    .input-textarea:focus { border-color: var(--accent-primary); }
    .send-btn {
      background: var(--accent-primary);
      color: #000;
      border: none;
      border-radius: 6px;
      padding: 8px 14px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.85rem;
      white-space: nowrap;
    }
    .send-btn:hover { opacity: 0.9; }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .send-btn.stop {
      background: var(--accent-red);
      color: #fff;
    }

    /* Image thumbnails */
    .image-previews {
      display: flex;
      gap: 6px;
      padding: 4px 0;
      flex-wrap: wrap;
    }
    .img-thumb {
      position: relative;
      width: 48px;
      height: 48px;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid var(--border-secondary);
    }
    .img-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .img-thumb .remove-img {
      position: absolute;
      top: -2px;
      right: -2px;
      background: var(--accent-red);
      color: #fff;
      border: none;
      border-radius: 50%;
      width: 16px;
      height: 16px;
      font-size: 0.6rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Snippet drawer */
    .snippet-drawer {
      display: flex;
      gap: 4px;
      padding: 4px 0;
      flex-wrap: wrap;
    }
    .snippet-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-secondary);
      border-radius: 4px;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 3px 8px;
      font-size: 0.78rem;
      white-space: nowrap;
    }
    .snippet-btn:hover { background: var(--bg-primary); color: var(--text-primary); }

    /* Scroll-to-bottom button */
    .scroll-btn {
      position: absolute;
      bottom: 80px;
      right: 20px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: 50%;
      width: 32px;
      height: 32px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-secondary);
      font-size: 0.9rem;
      z-index: 10;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .scroll-btn:hover { color: var(--text-primary); background: var(--bg-secondary); }

    /* Toast */
    .chat-toast {
      position: fixed;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 0.8rem;
      color: var(--text-primary);
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }

    /* Message action buttons */
    .msg-actions {
      position: absolute;
      top: 4px;
      right: 4px;
      display: none;
      gap: 2px;
    }
    .message-card:hover .msg-actions { display: flex; }
    .msg-action-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-secondary);
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.7rem;
      padding: 2px 4px;
      color: var(--text-secondary);
    }
    .msg-action-btn:hover { color: var(--text-primary); }

    /* Empty state */
    .empty-state {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      font-size: 0.9rem;
      padding: 40px;
      text-align: center;
      line-height: 1.6;
    }

    /* Review status bar */
    .review-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      font-size: 0.78rem;
      color: var(--text-secondary);
      flex-shrink: 0;
    }
    .review-bar .branch { color: var(--accent-primary); font-weight: 600; }
    .review-exit-btn {
      margin-left: auto;
      background: none;
      border: 1px solid var(--border-primary);
      border-radius: 4px;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 2px 8px;
      font-size: 0.75rem;
    }
    .review-exit-btn:hover { color: var(--accent-red); border-color: var(--accent-red); }
  `;

  constructor() {
    super();
    this.messages = [];
    this.selectedFiles = [];
    this.streamingActive = false;
    this.reviewState = null;
    this._streamingContent = '';
    this._currentRequestId = null;
    this._inputValue = '';
    this._images = [];
    this._snippetDrawerOpen = localStorage.getItem('ac-dc-snippet-drawer') === 'true';
    this._snippets = [];
    this._autoScroll = true;
    this._toast = null;
    this._committing = false;
    this._pendingChunk = null;
    this._chunkRAF = null;
    this._lastScrollTop = 0;
    this._suppressNextPaste = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._chunkHandler = this._onStreamChunk.bind(this);
    window.addEventListener('stream-chunk', this._chunkHandler);
    this._completeHandler = this._onStreamComplete.bind(this);
    window.addEventListener('stream-complete', this._completeHandler);
    this._compactionHandler = this._onCompactionEvent.bind(this);
    window.addEventListener('compaction-event', this._compactionHandler);
    this._commitHandler = this._onCommitResult.bind(this);
    window.addEventListener('commit-result', this._commitHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('stream-chunk', this._chunkHandler);
    window.removeEventListener('stream-complete', this._completeHandler);
    window.removeEventListener('compaction-event', this._compactionHandler);
    window.removeEventListener('commit-result', this._commitHandler);
    if (this._chunkRAF) cancelAnimationFrame(this._chunkRAF);
  }

  onRpcReady() {
    this._loadSnippets();
  }

  async _loadSnippets() {
    try {
      this._snippets = await this.rpcExtract('LLMService.get_snippets') || [];
    } catch (_) {
      this._snippets = [];
    }
  }

  // ── Streaming ──────────────────────────────────────────────────

  _onStreamChunk(e) {
    const { requestId, content } = e.detail || {};
    if (requestId !== this._currentRequestId) return;

    this._pendingChunk = content;
    if (!this._chunkRAF) {
      this._chunkRAF = requestAnimationFrame(() => {
        this._chunkRAF = null;
        if (this._pendingChunk !== null) {
          this._streamingContent = this._pendingChunk;
          this._pendingChunk = null;
          if (this._autoScroll) {
            this.updateComplete.then(() => {
              requestAnimationFrame(() => this._scrollToBottom());
            });
          }
        }
      });
    }
  }

  _onStreamComplete(e) {
    const { requestId, result } = e.detail || {};
    if (requestId !== this._currentRequestId) return;

    // Apply any pending chunk
    if (this._pendingChunk !== null) {
      this._streamingContent = this._pendingChunk;
      this._pendingChunk = null;
    }

    this.streamingActive = false;
    this._currentRequestId = null;

    if (result?.error) {
      // Show error as assistant message
      this.messages = [...this.messages, {
        role: 'assistant',
        content: `**Error:** ${result.error}`,
      }];
    } else if (result?.response) {
      const msg = {
        role: 'assistant',
        content: result.response,
      };
      // Attach edit results
      if (result.edit_results) {
        msg.editResults = {};
        for (const r of result.edit_results) {
          msg.editResults[r.file] = r;
        }
        msg.passed = result.passed || 0;
        msg.failed = result.failed || 0;
        msg.skipped = result.skipped || 0;
        msg.not_in_context = result.not_in_context || 0;
        msg.files_auto_added = result.files_auto_added || [];
      }
      if (result.shell_commands?.length) {
        msg.shellCommands = result.shell_commands;
      }
      if (result.cancelled) {
        msg.cancelled = true;
      }
      this.messages = [...this.messages, msg];

      // Report binary/invalid files
      if (result.binary_files?.length || result.invalid_files?.length) {
        const parts = [];
        if (result.binary_files?.length) parts.push(`Binary files skipped: ${result.binary_files.join(', ')}`);
        if (result.invalid_files?.length) parts.push(`Invalid files: ${result.invalid_files.join(', ')}`);
        this._showToast(parts.join('. '), 'error');
      }

      // Dispatch files-modified if applicable
      if (result.files_modified?.length) {
        window.dispatchEvent(new CustomEvent('files-modified', {
          detail: { files: result.files_modified },
        }));
      }

      // Auto-populate retry prompt for ambiguous anchors or old-text mismatches
      this._checkRetryPrompts(result);
    }

    this._streamingContent = '';

    // Scroll to bottom
    this.updateComplete.then(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => this._scrollToBottom()));
    });
  }

  _checkRetryPrompts(result) {
    if (!result.edit_results?.length) return;

    const prompts = [];

    // Ambiguous anchor failures
    const ambiguous = result.edit_results.filter(
      r => r.status === 'failed' && r.message?.includes('Ambiguous anchor')
    );
    if (ambiguous.length) {
      prompts.push(
        'Some edits failed due to ambiguous anchors. Please retry with more unique anchor context:\n' +
        ambiguous.map(r => `- ${r.file}: ${r.message}`).join('\n')
      );
    }

    // Old-text mismatch failures on in-context files
    const mismatches = result.edit_results.filter(
      r => r.status === 'failed' &&
           r.message?.includes('Old text mismatch') &&
           this.selectedFiles?.includes(r.file)
    );
    if (mismatches.length) {
      prompts.push(
        'The following edit(s) failed because the old text didn\'t match. Please re-read the file content and retry:\n' +
        mismatches.map(r => `- ${r.file}: ${r.message}`).join('\n')
      );
    }

    // Not-in-context files auto-added
    if (result.files_auto_added?.length) {
      const names = result.files_auto_added.join(', ');
      prompts.push(`The file(s) ${names} have been added to context. Please retry the edits.`);
    }

    if (prompts.length) {
      this._inputValue = prompts.join('\n\n');
      this.updateComplete.then(() => this._autoResizeInput());
    }
  }

  _onCompactionEvent(e) {
    const { event } = e.detail || {};
    if (!event) return;
    const { stage, message } = event;

    if (stage === 'url_fetch' || stage === 'url_ready') {
      this._showToast(message);
    } else if (stage === 'compaction_start') {
      this._showToast('Compacting history...');
    } else if (stage === 'compaction_complete') {
      this._showToast('History compacted', 'success');
    } else if (stage === 'compaction_error') {
      this._showToast(`Compaction failed: ${message || 'Unknown error'}`, 'error');
    }
  }

  _onCommitResult(e) {
    const result = e.detail;
    this._committing = false;
    if (result?.error) {
      this._showToast(`Commit failed: ${result.error}`, 'error');
    } else if (result?.sha) {
      this._showToast(`Committed: ${result.sha.substring(0, 7)}`, 'success');
      this.messages = [...this.messages, {
        role: 'assistant',
        content: `Committed: ${result.sha.substring(0, 7)} ${result.message || ''}`,
      }];
      window.dispatchEvent(new CustomEvent('files-modified', { detail: {} }));
    }
  }

  // ── Sending ────────────────────────────────────────────────────

  _send() {
    const text = this._inputValue.trim();
    if (!text && !this._images.length) return;
    if (this.streamingActive) return;

    // Show user message immediately
    const userMsg = { role: 'user', content: text };
    if (this._images.length) {
      userMsg.images = [...this._images];
    }
    this.messages = [...this.messages, userMsg];

    // Generate request ID
    const requestId = generateRequestId();
    this._currentRequestId = requestId;
    this.streamingActive = true;
    this._streamingContent = '';
    this._autoScroll = true;

    // Clear input
    this._inputValue = '';
    this._images = [];

    // Clear @-filter
    window.dispatchEvent(new CustomEvent('filter-from-chat', {
      detail: { query: '' },
    }));

    // Send RPC
    this.rpcCall('LLMService.chat_streaming', requestId, text,
      this.selectedFiles?.length ? this.selectedFiles : null,
      userMsg.images || null,
    ).catch(err => {
      console.error('chat_streaming error:', err);
      this.streamingActive = false;
      this._currentRequestId = null;
    });

    this.updateComplete.then(() => {
      this._autoResizeInput();
      requestAnimationFrame(() => requestAnimationFrame(() => this._scrollToBottom()));
    });
  }

  _stop() {
    if (!this._currentRequestId) return;
    this.rpcCall('LLMService.cancel_streaming', this._currentRequestId).catch(() => {});
  }

  // ── Actions ────────────────────────────────────────────────────

  _newSession() {
    this.rpcCall('LLMService.new_session').then(() => {
      this.messages = [];
      this._streamingContent = '';
      this._showToast('New session started', 'success');
      window.dispatchEvent(new CustomEvent('session-loaded', {
        detail: { messages: [] },
      }));
    }).catch(err => {
      this._showToast('Failed to create session', 'error');
    });
  }

  _commitAll() {
    if (this._committing) return;
    this._committing = true;
    this._showToast('Staging changes and generating commit message...');
    this.rpcCall('LLMService.commit_all').catch(err => {
      this._committing = false;
      this._showToast(`Commit failed: ${err.message}`, 'error');
    });
  }

  _resetHard() {
    if (!confirm('Reset all changes to HEAD? This cannot be undone.')) return;
    this.rpcCall('Repo.reset_hard').then(() => {
      this._showToast('Reset to HEAD', 'success');
      window.dispatchEvent(new CustomEvent('files-modified', { detail: {} }));
    }).catch(err => {
      this._showToast(`Reset failed: ${err.message}`, 'error');
    });
  }

  async _copyDiff() {
    try {
      const diff = await this.rpcExtract('Repo.get_staged_diff');
      if (diff) {
        await navigator.clipboard.writeText(diff);
        this._showToast('Diff copied');
      } else {
        this._showToast('No staged changes');
      }
    } catch (_) {
      this._showToast('Failed to copy diff', 'error');
    }
  }

  // ── Input handling ─────────────────────────────────────────────

  _onInputKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._send();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // Priority chain: @-filter → snippet drawer → clear textarea
      const text = this._inputValue;
      const atMatch = text.match(/@\S*$/);
      if (atMatch) {
        // Remove @query from textarea and clear filter
        this._inputValue = text.substring(0, text.length - atMatch[0].length);
        window.dispatchEvent(new CustomEvent('filter-from-chat', {
          detail: { query: '' },
        }));
      } else if (this._snippetDrawerOpen) {
        this._snippetDrawerOpen = false;
        localStorage.setItem('ac-dc-snippet-drawer', 'false');
      } else {
        this._inputValue = '';
      }
      this._autoResizeInput();
    }
  }

  _onInputChange(e) {
    this._inputValue = e.target.value;
    this._autoResizeInput();

    // @-filter detection
    const text = this._inputValue;
    const atMatch = text.match(/@(\S*)$/);
    if (atMatch) {
      window.dispatchEvent(new CustomEvent('filter-from-chat', {
        detail: { query: atMatch[1] },
      }));
    } else {
      window.dispatchEvent(new CustomEvent('filter-from-chat', {
        detail: { query: '' },
      }));
    }
  }

  _autoResizeInput() {
    const ta = this.shadowRoot?.querySelector('.input-textarea');
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }

  // ── Image paste ────────────────────────────────────────────────

  _onPaste(e) {
    // Suppress selection-buffer paste after middle-click path insertion
    if (this._suppressNextPaste) {
      this._suppressNextPaste = false;
      e.preventDefault();
      return;
    }

    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        if (file.size > 5 * 1024 * 1024) {
          this._showToast('Image too large (max 5MB)', 'error');
          continue;
        }
        if (this._images.length >= 5) {
          this._showToast('Max 5 images per message', 'error');
          continue;
        }
        const reader = new FileReader();
        reader.onload = () => {
          this._images = [...this._images, reader.result];
        };
        reader.readAsDataURL(file);
      }
    }
  }

  _removeImage(index) {
    this._images = this._images.filter((_, i) => i !== index);
  }

  // ── Snippets ───────────────────────────────────────────────────

  _toggleSnippets() {
    this._snippetDrawerOpen = !this._snippetDrawerOpen;
    localStorage.setItem('ac-dc-snippet-drawer', String(this._snippetDrawerOpen));
  }

  _insertSnippet(message) {
    this._inputValue = message;
    this.updateComplete.then(() => {
      this._autoResizeInput();
      this.shadowRoot?.querySelector('.input-textarea')?.focus();
    });
  }

  // ── Scrolling ──────────────────────────────────────────────────

  _onScroll(e) {
    const container = e.target;
    const scrollTop = container.scrollTop;

    // Disengage auto-scroll on manual scroll up during streaming
    if (this.streamingActive && scrollTop < this._lastScrollTop - 30) {
      this._autoScroll = false;
    }
    this._lastScrollTop = scrollTop;
  }

  _scrollToBottom() {
    const container = this.shadowRoot?.querySelector('.messages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  _onScrollBtnClick() {
    this._autoScroll = true;
    requestAnimationFrame(() => requestAnimationFrame(() => this._scrollToBottom()));
  }

  // ── File mention accumulation ──────────────────────────────────

  /**
   * Insert a file path at the cursor position in the textarea.
   * Called by the files tab on middle-click from the picker.
   */
  insertPathAtCursor(path) {
    const ta = this.shadowRoot?.querySelector('.input-textarea');
    if (!ta) return;
    const start = ta.selectionStart || 0;
    const end = ta.selectionEnd || 0;
    const before = this._inputValue.substring(0, start);
    const after = this._inputValue.substring(end);
    const padBefore = before && !before.endsWith(' ') ? ' ' : '';
    const padAfter = after && !after.startsWith(' ') ? ' ' : '';
    this._inputValue = before + padBefore + path + padAfter + after;
    this._suppressNextPaste = true;
    this.updateComplete.then(() => {
      this._autoResizeInput();
      const newPos = start + padBefore.length + path.length + padAfter.length;
      ta.setSelectionRange(newPos, newPos);
      ta.focus();
    });
  }

  /**
   * Accumulate a filename into the input when a file is added via mention click.
   * Called by the files tab orchestrator.
   */
  accumulateFileInInput(filename) {
    const current = this._inputValue.trim();
    const name = filename.includes('/') ? filename.split('/').pop() : filename;

    if (!current) {
      this._inputValue = `The file ${name} added. Do you want to see more files before you continue?`;
    } else if (current.includes('added') && current.includes('file')) {
      // Existing pattern — append to list
      this._inputValue = current.replace(/\.$/, '') + `, ${name}.`;
    } else {
      this._inputValue = current + ` (added ${name})`;
    }
    this.updateComplete.then(() => this._autoResizeInput());
  }

  // ── Clipboard ──────────────────────────────────────────────────

  _copyMessage(content) {
    navigator.clipboard.writeText(content).then(() => {
      this._showToast('Copied');
    }).catch(() => {});
  }

  _insertToInput(content) {
    this._inputValue = content;
    this.updateComplete.then(() => {
      this._autoResizeInput();
      this.shadowRoot?.querySelector('.input-textarea')?.focus();
    });
  }

  // ── Toast ──────────────────────────────────────────────────────

  _showToast(message, type = 'info') {
    this._toast = { message, type };
    setTimeout(() => { this._toast = null; }, 3000);
  }

  // ── Content click handling (code block copy, file mentions) ────

  _onContentClick(e) {
    // Copy button in code blocks
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn) {
      const pre = copyBtn.closest('pre');
      const code = pre?.querySelector('code');
      if (code) {
        navigator.clipboard.writeText(code.textContent).then(() => {
          copyBtn.textContent = '✓';
          setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
        });
      }
      return;
    }

    // File mention clicks
    const mention = e.target.closest('.file-mention');
    if (mention) {
      const path = mention.dataset.file;
      if (path) {
        this.dispatchEvent(new CustomEvent('file-mention-click', {
          detail: { path, navigate: true },
          bubbles: true, composed: true,
        }));
      }
      return;
    }

    // Edit block file path clicks
    const editPath = e.target.closest('.edit-file-path');
    if (editPath) {
      const path = editPath.dataset.file;
      if (path) {
        this.dispatchEvent(new CustomEvent('file-mention-click', {
          detail: { path, navigate: false },
          bubbles: true, composed: true,
        }));
      }
      return;
    }

    // Edit goto icon
    const goto = e.target.closest('.edit-goto');
    if (goto) {
      const path = goto.dataset.file;
      if (path) {
        window.dispatchEvent(new CustomEvent('navigate-file', {
          detail: { path },
        }));
      }
    }
  }

  // ── Render ─────────────────────────────────────────────────────

  render() {
    const isReview = this.reviewState?.active;

    return html`
      <!-- Action bar -->
      <div class="action-bar">
        <button class="action-btn" title="New Session" @click=${this._newSession}>✨</button>
        <button class="action-btn" title="Browse History">📜</button>
        <div class="action-spacer"></div>
        <button class="action-btn" title="Copy Staged Diff" @click=${this._copyDiff}>📋</button>
        <button class="action-btn" title="Commit All"
                ?disabled=${this._committing || isReview}
                @click=${this._commitAll}>💾</button>
        <button class="action-btn" title="Reset to HEAD" @click=${this._resetHard}>⚠️</button>
      </div>

      ${isReview ? this._renderReviewBar() : ''}

      <!-- Messages -->
      <div class="messages" @scroll=${this._onScroll}>
        ${this.messages.length === 0 && !this._streamingContent ? html`
          <div class="empty-state">
            AC⚡DC<br>
            Select files and start chatting
          </div>
        ` : ''}

        ${this.messages.map((msg, i) => this._renderMessage(msg, i, true))}

        ${this._streamingContent ? html`
          <div class="message-card assistant force-visible">
            <div class="message-role assistant">Assistant</div>
            <div class="md-content" @click=${this._onContentClick}>
              ${unsafeHTML(renderMarkdown(this._streamingContent))}
              <span class="streaming-indicator"></span>
            </div>
          </div>
        ` : ''}
      </div>

      ${!this._autoScroll && (this.messages.length > 3 || this._streamingContent) ? html`
        <button class="scroll-btn" @click=${this._onScrollBtnClick}>↓</button>
      ` : ''}

      <!-- Input area -->
      <div class="input-area">
        ${this._images.length ? html`
          <div class="image-previews">
            ${this._images.map((img, i) => html`
              <div class="img-thumb">
                <img src=${img} alt="Pasted image">
                <button class="remove-img" @click=${() => this._removeImage(i)}>✕</button>
              </div>
            `)}
          </div>
        ` : ''}

        ${this._snippetDrawerOpen && this._snippets.length ? html`
          <div class="snippet-drawer">
            ${this._snippets.map(s => html`
              <button class="snippet-btn" title=${s.tooltip || ''}
                      @click=${() => this._insertSnippet(s.message)}>
                ${s.icon} ${s.tooltip || ''}
              </button>
            `)}
          </div>
        ` : ''}

        <div class="input-row">
          <textarea class="input-textarea"
                    placeholder="Send a message... (Enter to send, Shift+Enter for newline)"
                    .value=${this._inputValue}
                    @input=${this._onInputChange}
                    @keydown=${this._onInputKeyDown}
                    @paste=${this._onPaste}
                    rows="1"></textarea>
          ${this.streamingActive ? html`
            <button class="send-btn stop" @click=${this._stop}>⏹ Stop</button>
          ` : html`
            <button class="send-btn"
                    ?disabled=${!this._inputValue.trim() && !this._images.length}
                    @click=${this._send}>Send</button>
          `}
        </div>

        <div style="display:flex;gap:4px;margin-top:4px">
          <button class="action-btn" title="Toggle snippets"
                  style="font-size:0.75rem"
                  @click=${this._toggleSnippets}>
            ${this._snippetDrawerOpen ? '▼' : '▶'} Snippets
          </button>
        </div>
      </div>

      ${this._toast ? html`
        <div class="chat-toast">${this._toast.message}</div>
      ` : ''}
    `;
  }

  _renderMessage(msg, index, isFinal) {
    const isUser = msg.role === 'user';

    return html`
      <div class="message-card ${msg.role}" data-msg-index=${index}>
        <div class="message-role ${msg.role}">${isUser ? 'You' : 'Assistant'}</div>
        <div class="md-content" @click=${this._onContentClick}>
          ${isUser
            ? html`${unsafeHTML(renderMarkdown(msg.content))}`
            : html`${unsafeHTML(this._renderAssistantContent(msg.content, msg.editResults, isFinal))}`
          }
        </div>

        ${msg.images?.length ? html`
          <div class="image-previews">
            ${msg.images.map(img => html`
              <div class="img-thumb"><img src=${img} alt="Image"></div>
            `)}
          </div>
        ` : ''}

        ${isFinal && msg.editResults ? this._renderEditSummary(msg) : ''}

        <div class="msg-actions">
          <button class="msg-action-btn" title="Copy"
                  @click=${() => this._copyMessage(msg.content)}>📋</button>
          <button class="msg-action-btn" title="Insert to input"
                  @click=${() => this._insertToInput(msg.content)}>↩</button>
        </div>
      </div>
    `;
  }

  _renderAssistantContent(content, editResults, isFinal) {
    const segments = segmentResponse(content);
    let html = '';

    for (const seg of segments) {
      if (seg.type === 'text') {
        html += renderMarkdown(seg.content);
      } else if (seg.type === 'edit' || seg.type === 'edit-pending') {
        const result = editResults?.[seg.filePath];
        html += this._renderEditBlockHtml(seg, result);
      }
    }

    return html;
  }

  _renderEditBlockHtml(seg, result) {
    const isPending = seg.type === 'edit-pending';
    const status = result?.status || (isPending ? 'pending' : '');
    const statusLabel = this._statusLabel(status, seg.isCreate);
    const statusClass = this._statusClass(status);
    const errorMsg = result?.message || '';

    // Compute diff
    const diffLines = computeDiff(seg.oldLines || [], seg.newLines || []);

    let diffHtml = '';
    for (const line of diffLines) {
      diffHtml += this._renderDiffLineHtml(line);
    }

    return `
      <div class="edit-block">
        <div class="edit-header">
          <span class="edit-file-path" data-file="${this._escAttr(seg.filePath)}">${this._escHtml(seg.filePath)}</span>
          <span class="edit-goto" data-file="${this._escAttr(seg.filePath)}" title="Open in viewer">↗</span>
          ${statusLabel ? `<span class="edit-status ${statusClass}">${statusLabel}</span>` : ''}
        </div>
        ${errorMsg ? `<div class="edit-error">${this._escHtml(errorMsg)}</div>` : ''}
        <div class="edit-diff">${diffHtml}</div>
      </div>
    `;
  }

  _renderDiffLineHtml(line) {
    const prefixMap = { remove: '-', add: '+', context: ' ' };
    const prefix = prefixMap[line.type] || ' ';
    const cls = line.type;

    if (line.charDiff) {
      let inner = '';
      for (const seg of line.charDiff) {
        if (seg.type === 'equal') {
          inner += this._escHtml(seg.text);
        } else {
          inner += `<span class="diff-change">${this._escHtml(seg.text)}</span>`;
        }
      }
      return `<span class="diff-line ${cls}"><span class="diff-prefix">${prefix}</span>${inner}</span>\n`;
    }

    return `<span class="diff-line ${cls}"><span class="diff-prefix">${prefix}</span>${this._escHtml(line.text)}</span>\n`;
  }

  _statusLabel(status, isCreate) {
    if (isCreate && status === 'applied') return '🆕 Created';
    switch (status) {
      case 'applied': return '✅ Applied';
      case 'already_applied': return '✅ Already applied';
      case 'failed': return '❌ Failed';
      case 'skipped': return '⚠️ Skipped';
      case 'not_in_context': return '⚠️ Not in context';
      case 'validated': return '☑ Validated';
      case 'pending': return '⏳ Pending';
      default: return '';
    }
  }

  _statusClass(status) {
    switch (status) {
      case 'applied': case 'already_applied': return 'applied';
      case 'failed': return 'failed';
      case 'skipped': return 'skipped';
      case 'not_in_context': return 'not-in-context';
      case 'pending': return 'pending';
      default: return '';
    }
  }

  _renderEditSummary(msg) {
    const { passed = 0, failed = 0, skipped = 0, not_in_context = 0, files_auto_added = [] } = msg;
    if (!passed && !failed && !skipped && !not_in_context) return '';

    return html`
      <div class="edit-summary">
        ${passed ? html`<span class="stat green">✅ ${passed} applied</span>` : ''}
        ${failed ? html`<span class="stat red">❌ ${failed} failed</span>` : ''}
        ${skipped ? html`<span class="stat orange">⚠️ ${skipped} skipped</span>` : ''}
        ${not_in_context ? html`<span class="stat amber">⚠️ ${not_in_context} not in context</span>` : ''}
        ${files_auto_added?.length ? html`
          <span style="font-size:0.72rem;color:var(--text-muted)">
            — Files added to context. A retry prompt has been prepared below.
          </span>
        ` : ''}
      </div>
    `;
  }

  _renderReviewBar() {
    const r = this.reviewState;
    if (!r?.active) return '';
    return html`
      <div class="review-bar">
        📋 <span class="branch">${r.branch}</span>
        ${r.stats ? html`
          <span>${r.stats.commit_count} commits · ${r.stats.files_changed} files · +${r.stats.additions} −${r.stats.deletions}</span>
        ` : ''}
        <button class="review-exit-btn" @click=${this._exitReview}>Exit Review</button>
      </div>
    `;
  }

  _exitReview() {
    this.rpcCall('LLMService.end_review').then(() => {
      window.dispatchEvent(new CustomEvent('review-ended'));
      window.dispatchEvent(new CustomEvent('files-modified', { detail: {} }));
    }).catch(err => {
      this._showToast(`Exit review failed: ${err.message}`, 'error');
    });
  }

  // ── HTML helpers ───────────────────────────────────────────────

  _escHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  _escAttr(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}

customElements.define('ac-chat-panel', AcChatPanel);