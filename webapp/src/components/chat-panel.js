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
import './ac-history-browser.js';

// Simple markdown → HTML (basic: headers, code blocks, bold, italic, links)
// Edit block markers (from edit_parser.py)
const EDIT_START = '««« EDIT';
const EDIT_SEP = '═══════ REPL';
const EDIT_END = '»»» EDIT END';

/**
 * Detect repo file paths in rendered HTML and wrap them with clickable spans.
 * Skips matches inside <pre>, <code>, or HTML tags.
 * Also collects edit block file paths.
 * Returns { html, referencedFiles: string[] }
 */
function applyFileMentions(html, repoFiles, selectedFiles, editFilePaths = []) {
  if (!repoFiles || repoFiles.length === 0) return { html, referencedFiles: [] };

  const selectedSet = new Set(selectedFiles || []);
  const referencedSet = new Set(editFilePaths);

  // Pre-filter: only files whose path appears as substring in the html
  const candidates = repoFiles.filter(f => html.includes(f));
  if (candidates.length === 0) return { html, referencedFiles: [...referencedSet] };

  // Sort by path length descending so longer paths match first
  candidates.sort((a, b) => b.length - a.length);

  // Build combined regex — escape special chars, word boundary before filename
  const escaped = candidates.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const combined = new RegExp('(' + escaped.join('|') + ')', 'g');

  // Split HTML into segments: inside tags/pre/code vs plain text
  // We'll walk through and only replace in "safe" text segments
  const result = [];
  let lastIndex = 0;
  let inPre = false;
  let inCode = false;

  // Regex to find HTML tags
  const tagRe = /<\/?[a-zA-Z][^>]*>/g;
  let tagMatch;
  const tags = [];
  while ((tagMatch = tagRe.exec(html)) !== null) {
    tags.push({ index: tagMatch.index, end: tagMatch.index + tagMatch[0].length, tag: tagMatch[0] });
  }

  // Process text between tags
  let tagIdx = 0;
  let pos = 0;

  while (pos < html.length) {
    // Find next tag
    while (tagIdx < tags.length && tags[tagIdx].end <= pos) tagIdx++;
    const nextTag = tagIdx < tags.length ? tags[tagIdx] : null;
    const textEnd = nextTag ? nextTag.index : html.length;

    if (pos < textEnd && !inPre && !inCode) {
      // Process this text segment for file mentions
      const textSegment = html.slice(pos, textEnd);
      const replaced = textSegment.replace(combined, (match) => {
        referencedSet.add(match);
        const cls = selectedSet.has(match) ? 'file-mention in-context' : 'file-mention';
        return `<span class="${cls}" data-file="${escapeHtml(match)}">${escapeHtml(match)}</span>`;
      });
      result.push(replaced);
    } else if (pos < textEnd) {
      // Inside pre/code — don't replace
      result.push(html.slice(pos, textEnd));
    }

    if (nextTag) {
      result.push(nextTag.tag);
      const lower = nextTag.tag.toLowerCase();
      if (lower.startsWith('<pre')) inPre = true;
      else if (lower.startsWith('</pre')) inPre = false;
      else if (lower.startsWith('<code')) inCode = true;
      else if (lower.startsWith('</code')) inCode = false;
      pos = nextTag.end;
    } else {
      pos = textEnd;
    }
  }

  return { html: result.join(''), referencedFiles: [...referencedSet] };
}

/**
 * Render the file summary section below an assistant message.
 * Returns HTML string with file chips.
 */
function renderFileSummary(referencedFiles, selectedFiles) {
  if (!referencedFiles || referencedFiles.length === 0) return '';

  const selectedSet = new Set(selectedFiles || []);
  const inContext = referencedFiles.filter(f => selectedSet.has(f));
  const notInContext = referencedFiles.filter(f => !selectedSet.has(f));

  const chips = [];
  for (const f of inContext) {
    const name = f.split('/').pop();
    chips.push(`<span class="file-chip in-context" data-file="${escapeHtml(f)}" title="${escapeHtml(f)}">✓ ${escapeHtml(name)}</span>`);
  }
  for (const f of notInContext) {
    const name = f.split('/').pop();
    chips.push(`<span class="file-chip addable" data-file="${escapeHtml(f)}" title="${escapeHtml(f)}">+ ${escapeHtml(name)}</span>`);
  }

  const addAllBtn = notInContext.length >= 2
    ? `<button class="add-all-btn" data-files="${escapeHtml(JSON.stringify(notInContext))}">+ Add All (${notInContext.length})</button>`
    : '';

  return `<div class="file-summary"><span class="file-summary-label">📁 Files Referenced</span>${addAllBtn}<div class="file-chips">${chips.join('')}</div></div>`;
}

/**
 * Parse edit blocks out of raw LLM text, returning an array of
 * { type: 'text'|'edit', content, filePath, oldLines, newLines }
 */
function parseEditSegments(text) {
  const lines = text.split('\n');
  const segments = [];
  let textBuf = [];
  let state = 'text'; // text | expect_edit | old | new
  let filePath = '';
  let oldLines = [];
  let newLines = [];

  function flushText() {
    if (textBuf.length > 0) {
      segments.push({ type: 'text', content: textBuf.join('\n') });
      textBuf = [];
    }
  }

  function isFilePath(line) {
    const s = line.trim();
    if (!s || s.length > 200) return false;
    if (/^[#\/*\->]|^```/.test(s)) return false;
    if (s.includes('/') || s.includes('\\')) return true;
    if (/^[\w\-.]+\.\w+$/.test(s)) return true;
    return false;
  }

  for (const line of lines) {
    const stripped = line.trim();

    if (state === 'text') {
      if (isFilePath(stripped) && stripped !== EDIT_START) {
        filePath = stripped;
        state = 'expect_edit';
      } else {
        textBuf.push(line);
      }
    } else if (state === 'expect_edit') {
      if (stripped === EDIT_START) {
        flushText();
        oldLines = [];
        newLines = [];
        state = 'old';
      } else if (isFilePath(stripped) && stripped !== EDIT_START) {
        textBuf.push(filePath); // previous path was just text
        filePath = stripped;
      } else {
        textBuf.push(filePath);
        textBuf.push(line);
        filePath = '';
        state = 'text';
      }
    } else if (state === 'old') {
      if (stripped === EDIT_SEP || stripped.startsWith('═══════')) {
        state = 'new';
      } else {
        oldLines.push(line);
      }
    } else if (state === 'new') {
      if (stripped === EDIT_END) {
        segments.push({
          type: 'edit',
          filePath,
          oldLines: [...oldLines],
          newLines: [...newLines],
        });
        filePath = '';
        oldLines = [];
        newLines = [];
        state = 'text';
      } else {
        newLines.push(line);
      }
    }
  }

  // Flush remaining text (including any incomplete edit block)
  if (state === 'expect_edit') {
    textBuf.push(filePath);
  } else if (state === 'old' || state === 'new') {
    textBuf.push(filePath);
    textBuf.push(EDIT_START);
    textBuf.push(...oldLines);
    if (state === 'new') {
      textBuf.push(EDIT_SEP);
      textBuf.push(...newLines);
    }
  }
  flushText();

  return segments;
}

/**
 * Compute a simple line diff between old and new, returning
 * arrays of {text, type} where type is 'context'|'remove'|'add'.
 */
function computeLineDiff(oldLines, newLines) {
  // Find common prefix (anchor lines)
  let prefixLen = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  for (let i = 0; i < minLen; i++) {
    if (oldLines[i] === newLines[i]) prefixLen++;
    else break;
  }

  const result = [];
  // Context (anchor) lines
  for (let i = 0; i < prefixLen; i++) {
    result.push({ text: oldLines[i], type: 'context' });
  }
  // Removed lines
  for (let i = prefixLen; i < oldLines.length; i++) {
    result.push({ text: oldLines[i], type: 'remove' });
  }
  // Added lines
  for (let i = prefixLen; i < newLines.length; i++) {
    result.push({ text: newLines[i], type: 'add' });
  }
  return result;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

/**
 * Render a full assistant message with edit blocks rendered inline.
 * editResultsMap: { filePath -> { status, message } }
 */
function renderAssistantContent(text, editResultsMap = {}) {
  const segments = parseEditSegments(text);
  const parts = [];

  for (const seg of segments) {
    if (seg.type === 'text') {
      parts.push(renderMarkdown(seg.content));
    } else {
      const info = editResultsMap[seg.filePath] || {};
      const status = info.status || 'unknown';
      const statusMsg = info.message || '';

      // Status badge
      let badge = '';
      if (status === 'applied') badge = '<span class="edit-badge applied">✅ applied</span>';
      else if (status === 'failed') badge = `<span class="edit-badge failed">❌ failed</span>`;
      else if (status === 'skipped') badge = '<span class="edit-badge skipped">⚠️ skipped</span>';
      else if (status === 'validated') badge = '<span class="edit-badge validated">☑ validated</span>';
      else badge = '<span class="edit-badge pending">⏳ pending</span>';

      // Diff lines
      const diffLines = computeLineDiff(seg.oldLines, seg.newLines);
      const diffHtml = diffLines.map(d => {
        const prefix = d.type === 'remove' ? '-' : d.type === 'add' ? '+' : ' ';
        return `<div class="diff-line ${d.type}"><span class="diff-prefix">${prefix}</span>${escapeHtml(d.text)}</div>`;
      }).join('');

      const failMsg = (status === 'failed' && statusMsg)
        ? `<div class="edit-error">${escapeHtml(statusMsg)}</div>`
        : '';

      parts.push(`
        <div class="edit-block-card">
          <div class="edit-block-header">
            <span class="edit-file-path" data-path="${escapeHtml(seg.filePath)}">${escapeHtml(seg.filePath)}</span>
            ${badge}
          </div>
          ${failMsg}
          <pre class="edit-diff">${diffHtml}</pre>
        </div>
      `);
    }
  }

  return parts.join('');
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
    _repoFiles: { type: Array, state: true },
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

    /* Edit block cards */
    .edit-block-card {
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      margin: 10px 0;
      overflow: hidden;
      background: var(--bg-primary);
    }

    .edit-block-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      font-size: 0.8rem;
      gap: 8px;
    }

    .edit-file-path {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      color: var(--accent-primary);
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .edit-file-path:hover {
      text-decoration: underline;
    }

    .edit-badge {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .edit-badge.applied {
      background: rgba(80, 200, 120, 0.15);
      color: var(--accent-green);
    }
    .edit-badge.failed {
      background: rgba(255, 80, 80, 0.15);
      color: var(--accent-red);
    }
    .edit-badge.skipped {
      background: rgba(255, 180, 50, 0.15);
      color: #f0a030;
    }
    .edit-badge.validated {
      background: rgba(80, 160, 255, 0.15);
      color: var(--accent-primary);
    }
    .edit-badge.pending {
      background: rgba(160, 160, 160, 0.15);
      color: var(--text-muted);
    }

    .edit-error {
      padding: 4px 12px;
      font-size: 0.75rem;
      color: var(--accent-red);
      background: rgba(255, 80, 80, 0.08);
      border-bottom: 1px solid var(--border-primary);
    }

    .edit-diff {
      margin: 0;
      padding: 8px 0;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      line-height: 1.5;
      overflow-x: auto;
    }

    .diff-line {
      padding: 0 12px;
      white-space: pre;
    }
    .diff-line.remove {
      background: rgba(255, 80, 80, 0.12);
      color: var(--accent-red);
    }
    .diff-line.add {
      background: rgba(80, 200, 120, 0.12);
      color: var(--accent-green);
    }
    .diff-line.context {
      color: var(--text-muted);
    }
    .diff-prefix {
      display: inline-block;
      width: 1.5ch;
      user-select: none;
      color: inherit;
      opacity: 0.6;
    }

    /* Edit summary banner */
    .edit-summary {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 6px 12px;
      margin: 8px 0 4px;
      border-radius: var(--radius-sm);
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      font-size: 0.8rem;
      color: var(--text-secondary);
    }
    .edit-summary .stat { font-weight: 600; }
    .edit-summary .stat.pass { color: var(--accent-green); }
    .edit-summary .stat.fail { color: var(--accent-red); }
    .edit-summary .stat.skip { color: #f0a030; }

    /* File mentions */
    .file-mention {
      color: var(--accent-primary);
      cursor: pointer;
      border-radius: 3px;
      padding: 0 2px;
      margin: 0 1px;
      transition: background 0.15s;
    }
    .file-mention:hover {
      background: rgba(79, 195, 247, 0.15);
      text-decoration: underline;
    }
    .file-mention.in-context {
      color: var(--text-muted);
    }

    /* File summary section */
    .file-summary {
      margin-top: 10px;
      padding: 8px 12px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      font-size: 0.8rem;
    }
    .file-summary-label {
      color: var(--text-secondary);
      margin-right: 8px;
      font-weight: 600;
    }
    .add-all-btn {
      background: none;
      border: 1px solid var(--accent-primary);
      color: var(--accent-primary);
      font-size: 0.7rem;
      padding: 1px 8px;
      border-radius: 10px;
      cursor: pointer;
      margin-left: 4px;
      vertical-align: middle;
    }
    .add-all-btn:hover {
      background: rgba(79, 195, 247, 0.15);
    }
    .file-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 6px;
    }
    .file-chip {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 10px;
      cursor: pointer;
      white-space: nowrap;
    }
    .file-chip.in-context {
      background: var(--bg-secondary);
      color: var(--text-muted);
      border: 1px solid var(--border-primary);
    }
    .file-chip.addable {
      background: rgba(79, 195, 247, 0.1);
      color: var(--accent-primary);
      border: 1px solid var(--accent-primary);
    }
    .file-chip.addable:hover {
      background: rgba(79, 195, 247, 0.2);
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
    this._repoFiles = [];

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
    this._loadRepoFiles();
  }

  async _loadRepoFiles() {
    try {
      const result = await this.rpcExtract('Repo.get_flat_file_list');
      if (Array.isArray(result)) {
        this._repoFiles = result;
      } else if (result?.files && Array.isArray(result.files)) {
        this._repoFiles = result.files;
      }
    } catch (e) {
      console.warn('Failed to load repo files:', e);
    }
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
      // Build edit results map from backend data
      const editMeta = {};
      if (result.edit_results) {
        editMeta.editResults = {};
        for (const er of result.edit_results) {
          editMeta.editResults[er.file] = { status: er.status, message: er.message };
        }
      }
      if (result.passed || result.failed || result.skipped) {
        editMeta.passed = result.passed || 0;
        editMeta.failed = result.failed || 0;
        editMeta.skipped = result.skipped || 0;
      }
      // Add the assistant response with edit metadata
      this.messages = [...this.messages, {
        role: 'assistant',
        content: result.response,
        ...(Object.keys(editMeta).length > 0 ? editMeta : {}),
      }];
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
      // Refresh repo file list (new files may have been created)
      this._loadRepoFiles();
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

  _openHistoryBrowser() {
    const browser = this.shadowRoot?.querySelector('ac-history-browser');
    if (browser) browser.show();
  }

  _onSessionLoaded(e) {
    const { messages, sessionId } = e.detail;
    if (Array.isArray(messages)) {
      this.messages = [...messages];
      this._autoScroll = true;
      requestAnimationFrame(() => requestAnimationFrame(() => this._scrollToBottom()));
    }
    // Notify parent about the session change
    this.dispatchEvent(new CustomEvent('session-loaded', {
      detail: { sessionId, messages },
      bubbles: true, composed: true,
    }));
  }

  _onPasteToPrompt(e) {
    const text = e.detail?.text || '';
    if (!text) return;
    const textarea = this.shadowRoot?.querySelector('.input-textarea');
    if (textarea) {
      this._inputValue = text;
      textarea.value = text;
      this._autoResize(textarea);
      textarea.focus();
    }
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

  _renderEditSummary(msg) {
    if (!msg.passed && !msg.failed && !msg.skipped) return nothing;
    const parts = [];
    if (msg.passed) parts.push(html`<span class="stat pass">✅ ${msg.passed} applied</span>`);
    if (msg.failed) parts.push(html`<span class="stat fail">❌ ${msg.failed} failed</span>`);
    if (msg.skipped) parts.push(html`<span class="stat skip">⚠️ ${msg.skipped} skipped</span>`);
    return html`<div class="edit-summary">${parts}</div>`;
  }

  _renderMessage(msg, index) {
    const isUser = msg.role === 'user';
    const content = msg.content || '';

    if (isUser) {
      return html`
        <div class="message-card user" data-msg-index="${index}">
          <div class="role-label">You</div>
          <div class="md-content" @click=${this._onContentClick}>
            ${unsafeHTML(renderMarkdown(content))}
          </div>
        </div>
      `;
    }

    // Assistant message — apply edit block rendering if applicable
    let renderedHtml;
    const editFilePaths = msg.editResults ? Object.keys(msg.editResults) : [];

    if (msg.editResults) {
      renderedHtml = renderAssistantContent(content, msg.editResults);
    } else {
      renderedHtml = renderMarkdown(content);
    }

    // Apply file mentions (on final render, not streaming)
    const { html: mentionHtml, referencedFiles } = applyFileMentions(
      renderedHtml, this._repoFiles, this.selectedFiles, editFilePaths
    );

    const fileSummaryHtml = renderFileSummary(referencedFiles, this.selectedFiles);

    return html`
      <div class="message-card assistant" data-msg-index="${index}">
        <div class="role-label">Assistant</div>
        ${this._renderEditSummary(msg)}
        <div class="md-content" @click=${this._onContentClick}>
          ${unsafeHTML(mentionHtml)}
        </div>
        ${fileSummaryHtml ? html`
          <div class="file-summary-container" @click=${this._onFileSummaryClick}>
            ${unsafeHTML(fileSummaryHtml)}
          </div>
        ` : nothing}
      </div>
    `;
  }

  _onContentClick(e) {
    // Handle file mention clicks
    const mention = e.target.closest('.file-mention');
    if (mention) {
      const filePath = mention.dataset.file;
      if (filePath) {
        this._dispatchFileMentionClick(filePath);
      }
      return;
    }

    // Handle file path clicks in edit blocks
    const pathEl = e.target.closest('.edit-file-path');
    if (pathEl) {
      const filePath = pathEl.dataset.path;
      if (filePath) {
        this.dispatchEvent(new CustomEvent('navigate-file', {
          detail: { path: filePath },
          bubbles: true, composed: true,
        }));
      }
      return;
    }

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

  _onFileSummaryClick(e) {
    // Handle individual file chip clicks
    const chip = e.target.closest('.file-chip');
    if (chip) {
      const filePath = chip.dataset.file;
      if (filePath) {
        this._dispatchFileMentionClick(filePath);
      }
      return;
    }

    // Handle "Add All" button
    const addAllBtn = e.target.closest('.add-all-btn');
    if (addAllBtn) {
      try {
        const files = JSON.parse(addAllBtn.dataset.files);
        if (Array.isArray(files)) {
          for (const f of files) {
            this._dispatchFileMentionClick(f);
          }
        }
      } catch (err) {
        console.warn('Failed to parse add-all files:', err);
      }
    }
  }

  _dispatchFileMentionClick(filePath) {
    this.dispatchEvent(new CustomEvent('file-mention-click', {
      detail: { path: filePath },
      bubbles: true, composed: true,
    }));
  }

  render() {
    const hasMessages = this.messages.length > 0 || this._streamingContent;

    return html`
      <!-- Action Bar -->
      <div class="action-bar">
        <button class="action-btn" title="New session" @click=${this._newSession}>✨</button>
        <button class="action-btn" title="Browse history" @click=${this._openHistoryBrowser}>📜</button>
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

      <!-- History Browser -->
      <ac-history-browser
        @session-loaded=${this._onSessionLoaded}
        @paste-to-prompt=${this._onPasteToPrompt}
      ></ac-history-browser>

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