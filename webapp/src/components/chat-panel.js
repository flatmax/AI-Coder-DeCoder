/**
 * Chat panel — message display, streaming, input area.
 */

import { LitElement, html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { Marked } from 'marked';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';

// Import child components
import './input-history.js';
import './url-chips.js';
import './ac-history-browser.js';
import './speech-to-text.js';

// Edit block segmentation and diffing
import { segmentResponse, computeDiff } from '../utils/edit-blocks.js';

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
  let inPre = false;

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

    if (pos < textEnd && !inPre) {
      // Process this text segment for file mentions (allowed inside inline <code>)
      const textSegment = html.slice(pos, textEnd);
      const replaced = textSegment.replace(combined, (match) => {
        referencedSet.add(match);
        const cls = selectedSet.has(match) ? 'file-mention in-context' : 'file-mention';
        return `<span class="${cls}" data-file="${escapeHtml(match)}">${escapeHtml(match)}</span>`;
      });
      result.push(replaced);
    } else if (pos < textEnd) {
      // Inside pre block — don't replace
      result.push(html.slice(pos, textEnd));
    }

    if (nextTag) {
      result.push(nextTag.tag);
      const lower = nextTag.tag.toLowerCase();
      if (lower.startsWith('<pre')) inPre = true;
      else if (lower.startsWith('</pre')) inPre = false;
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
    ? `<button class="add-all-btn" data-files='${JSON.stringify(notInContext).replace(/'/g, '&#39;')}'>+ Add All (${notInContext.length})</button>`
    : '';

  return `<div class="file-summary"><span class="file-summary-label">📁 Files Referenced</span>${addAllBtn}<div class="file-chips">${chips.join('')}</div></div>`;
}


function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Configured Marked instance with custom code block renderer.
 * Injects copy button into <pre> blocks and applies our CSS classes.
 */
const _marked = new Marked({
  renderer: {
    code({ text, lang }) {
      const escaped = escapeHtml(text);
      return `<pre class="code-block"><button class="copy-btn">📋</button><code>${escaped}</code></pre>`;
    },
  },
  breaks: true,   // Convert single \n to <br> (GFM-style)
  gfm: true,      // Enable GitHub Flavored Markdown (tables, strikethrough, etc.)
});

function renderMarkdown(text) {
  if (!text) return '';
  try {
    return _marked.parse(text);
  } catch (e) {
    console.warn('Markdown parse error, falling back to escaped text:', e);
    return `<p>${escapeHtml(text)}</p>`;
  }
}


export class AcChatPanel extends RpcMixin(LitElement) {
  static properties = {
    messages: { type: Array },
    selectedFiles: { type: Array },
    streamingActive: { type: Boolean },
    reviewState: { type: Object },
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
    _chatSearchQuery: { type: String, state: true },
    _chatSearchMatches: { type: Array, state: true },
    _chatSearchCurrent: { type: Number, state: true },
    _lightboxSrc: { type: String, state: true },
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
    .action-btn.committing {
      color: var(--accent-primary);
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
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

    /* Tables (from marked GFM) */
    .md-content table {
      border-collapse: collapse;
      width: 100%;
      margin: 8px 0;
      font-size: 0.85rem;
    }
    .md-content th,
    .md-content td {
      border: 1px solid var(--border-primary);
      padding: 6px 10px;
      text-align: left;
    }
    .md-content th {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      font-weight: 600;
    }
    .md-content tr:nth-child(even) {
      background: rgba(255, 255, 255, 0.02);
    }

    /* Lists */
    .md-content ul,
    .md-content ol {
      margin: 6px 0;
      padding-left: 24px;
    }
    .md-content li {
      margin: 3px 0;
    }

    /* Paragraphs — tighten spacing for chat */
    .md-content p {
      margin: 4px 0;
    }

    /* Horizontal rules */
    .md-content hr {
      border: none;
      border-top: 1px solid var(--border-primary);
      margin: 12px 0;
    }

    /* Links */
    .md-content a {
      color: var(--accent-primary);
      text-decoration: none;
    }
    .md-content a:hover {
      text-decoration: underline;
    }

    /* Blockquotes */
    .md-content blockquote {
      border-left: 3px solid var(--border-primary);
      margin: 8px 0;
      padding: 4px 12px;
      color: var(--text-secondary);
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

    /* User image thumbnails in messages */
    .user-images {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .user-image-thumb {
      width: 120px;
      height: 120px;
      object-fit: cover;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-primary);
      cursor: pointer;
      transition: border-color 0.15s, transform 0.15s;
    }
    .user-image-thumb:hover {
      border-color: var(--accent-primary);
      transform: scale(1.03);
    }

    /* Image lightbox */
    .image-lightbox {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      z-index: 10002;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .image-lightbox img {
      max-width: 90vw;
      max-height: 90vh;
      object-fit: contain;
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
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

    /* Stacked left buttons (mic + snippets) */
    .input-left-buttons {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0;
      flex-shrink: 0;
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
      display: block;
    }
    .diff-line.remove {
      background: #2d1215;
      color: var(--accent-red);
    }
    .diff-line.add {
      background: #122117;
      color: var(--accent-green);
    }
    .diff-line.context {
      background: var(--bg-primary);
      color: var(--text-primary);
    }
    .diff-line.remove .diff-change {
      background: #6d3038;
      border-radius: 2px;
    }
    .diff-line.add .diff-change {
      background: #2b6331;
      border-radius: 2px;
    }
    .diff-line-prefix {
      display: inline-block;
      width: 1.2em;
      user-select: none;
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

    /* Message action buttons (top-right and bottom-right) */
    .msg-actions {
      position: absolute;
      right: 8px;
      display: flex;
      gap: 2px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .msg-actions.top { top: 8px; }
    .msg-actions.bottom { bottom: 8px; }
    .message-card:hover .msg-actions { opacity: 1; }

    .msg-action-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .msg-action-btn:hover {
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }

    /* Chat search */
    .chat-search {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 1;
      min-width: 0;
    }
    .chat-search-input {
      flex: 1;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 0.8rem;
      padding: 4px 8px;
      outline: none;
      min-width: 60px;
    }
    .chat-search-input:focus {
      border-color: var(--accent-primary);
    }
    .chat-search-input::placeholder {
      color: var(--text-muted);
    }
    .chat-search-counter {
      font-size: 0.7rem;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .chat-search-nav {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.75rem;
      padding: 2px 4px;
      cursor: pointer;
      border-radius: var(--radius-sm);
    }
    .chat-search-nav:hover {
      color: var(--text-primary);
      background: var(--bg-secondary);
    }

    /* Review status bar */
    .review-status-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: rgba(79, 195, 247, 0.06);
      border-top: 1px solid var(--accent-primary);
      font-size: 0.75rem;
      color: var(--text-secondary);
    }
    .review-status-bar strong {
      color: var(--accent-primary);
    }
    .review-status-bar .review-diff-count {
      margin-left: auto;
      color: var(--text-muted);
    }
    .review-status-bar .review-exit-link {
      color: var(--accent-red);
      cursor: pointer;
      font-size: 0.7rem;
      border: none;
      background: none;
      padding: 0;
    }
    .review-status-bar .review-exit-link:hover {
      text-decoration: underline;
    }

    /* Search highlight on message cards */
    .message-card.search-highlight {
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 1px var(--accent-primary), 0 0 12px rgba(79, 195, 247, 0.15);
    }

  `];

  constructor() {
    super();
    this.messages = [];
    this.selectedFiles = [];
    this.streamingActive = false;
    this.reviewState = { active: false };
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
    this._chatSearchQuery = '';
    this._chatSearchMatches = [];
    this._chatSearchCurrent = -1;
    this._atFilterActive = false;

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
          // Don't disable auto-scroll during active streaming — content reflows
          // can briefly push the sentinel out of view
          if (entry.isIntersecting) {
            this._autoScroll = true;
          } else if (!this.streamingActive) {
            this._autoScroll = false;
          }
        },
        { root: container, threshold: 0.01 }
      );
      this._observer.observe(sentinel);

      // Track manual scroll-up during streaming to let the user break out
      this._lastScrollTop = 0;
      container.addEventListener('scroll', () => {
        if (this.streamingActive) {
          // If user scrolled UP, they want to disengage
          if (container.scrollTop < this._lastScrollTop - 30) {
            this._autoScroll = false;
          }
        }
        this._lastScrollTop = container.scrollTop;
      }, { passive: true });
    }

    // Scroll to bottom on initial load (browser refresh with restored messages)
    if (this.messages.length > 0) {
      requestAnimationFrame(() => requestAnimationFrame(() => this._scrollToBottom()));
    }
  }

  onRpcReady() {
    this._loadSnippets();
    this._loadRepoFiles();
  }

  updated(changedProps) {
    super.updated(changedProps);
    // When messages are bulk-loaded (e.g. state restore, session load), scroll to bottom
    if (changedProps.has('messages') && !this.streamingActive) {
      const oldMessages = changedProps.get('messages');
      // Detect bulk load: went from empty/undefined to having messages
      if ((!oldMessages || oldMessages.length === 0) && this.messages.length > 0) {
        this._autoScroll = true;
        requestAnimationFrame(() => requestAnimationFrame(() => this._scrollToBottom()));
      }
    }
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
    try {
      const reviewSnippets = await this.rpcExtract('Settings.get_review_snippets');
      if (Array.isArray(reviewSnippets)) {
        this._reviewSnippets = reviewSnippets;
      }
    } catch (e) {
      // Review snippets optional
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
            // Use updateComplete then double-rAF to ensure DOM has reflowed
            this.updateComplete.then(() => {
              requestAnimationFrame(() => this._scrollToBottom());
            });
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
      this.updateComplete.then(() => {
        requestAnimationFrame(() => requestAnimationFrame(() => this._scrollToBottom()));
      });
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
      // Force layout before setting scrollTop to avoid stale scrollHeight
      container.scrollTop = container.scrollHeight + 1000;
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
    this._checkAtFilter(this._inputValue);
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
      if (this._atFilterActive) {
        this._clearAtFilter();
      } else if (this._snippetDrawerOpen) {
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
    // Suppress paste triggered by middle-click selection buffer
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
    const userMsg = { role: 'user', content: message };
    if (images && images.length > 0) {
      userMsg.images = [...images];  // data URIs for display
    }
    this.messages = [...this.messages, userMsg];

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

  // === Speech to Text ===

  _onTranscript(e) {
    const text = e.detail?.text;
    if (!text) return;

    const textarea = this.shadowRoot?.querySelector('.input-textarea');
    // Append space-separated
    if (this._inputValue && !this._inputValue.endsWith(' ')) {
      this._inputValue += ' ';
    }
    this._inputValue += text;

    if (textarea) {
      textarea.value = this._inputValue;
      this._autoResize(textarea);
    }

    // Run URL detection on new text
    this._onInputForUrlDetection();
  }

  // === Actions ===

  async _newSession() {
    if (!this.rpcConnected) return;
    try {
      await this.rpcExtract('LLMService.new_session');
      // Clear local state
      this.messages = [];
      this._streamingContent = '';
      this._currentRequestId = null;
      this.streamingActive = false;
      this._chatSearchQuery = '';
      this._chatSearchMatches = [];
      this._chatSearchCurrent = -1;
      this._clearSearchHighlights();
      // Clear URL chips
      const urlChips = this.shadowRoot?.querySelector('ac-url-chips');
      if (urlChips) urlChips.clear();
      this._showToast('New session started', 'success');
    } catch (e) {
      console.error('Failed to start new session:', e);
      this._showToast('Failed to start new session', 'error');
    }
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

    // Show progress message in chat
    const progressMsg = { role: 'assistant', content: '⏳ **Staging changes and generating commit message...**' };
    this.messages = [...this.messages, progressMsg];
    if (this._autoScroll) {
      requestAnimationFrame(() => this._scrollToBottom());
    }

    try {
      // Stage all changes
      const stageResult = await this.rpcExtract('Repo.stage_all');
      if (stageResult?.error) {
        this._removeProgressMsg(progressMsg);
        this._showToast(`Stage failed: ${stageResult.error}`, 'error');
        return;
      }

      // Get staged diff for commit message generation
      const diffResult = await this.rpcExtract('Repo.get_staged_diff');
      const diff = diffResult?.diff || '';
      if (!diff.trim()) {
        this._removeProgressMsg(progressMsg);
        this._showToast('Nothing to commit', 'error');
        return;
      }

      // Generate commit message via LLM
      const msgResult = await this.rpcExtract('LLMService.generate_commit_message', diff);
      if (msgResult?.error) {
        this._removeProgressMsg(progressMsg);
        this._showToast(`Message generation failed: ${msgResult.error}`, 'error');
        return;
      }

      const commitMessage = msgResult?.message;
      if (!commitMessage) {
        this._removeProgressMsg(progressMsg);
        this._showToast('Failed to generate commit message', 'error');
        return;
      }

      // Commit
      const commitResult = await this.rpcExtract('Repo.commit', commitMessage);
      if (commitResult?.error) {
        this._removeProgressMsg(progressMsg);
        this._showToast(`Commit failed: ${commitResult.error}`, 'error');
        return;
      }

      const sha = commitResult?.sha?.slice(0, 7) || '';
      this._showToast(`Committed ${sha}: ${commitMessage.split('\n')[0]}`, 'success');

      // Replace progress message with commit info
      const msgs = this.messages.filter(m => m !== progressMsg);
      this.messages = [...msgs, {
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
      this._removeProgressMsg(progressMsg);
      this._showToast(`Commit failed: ${e.message || 'Unknown error'}`, 'error');
    } finally {
      this._committing = false;
    }
  }

  _removeProgressMsg(progressMsg) {
    this.messages = this.messages.filter(m => m !== progressMsg);
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

  // === Chat Search ===

  _onChatSearchInput(e) {
    this._chatSearchQuery = e.target.value;
    this._updateChatSearchMatches();
  }

  _onChatSearchKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        this._chatSearchPrev();
      } else {
        this._chatSearchNext();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this._clearChatSearch();
      e.target.blur();
    }
  }

  _updateChatSearchMatches() {
    const query = this._chatSearchQuery.trim().toLowerCase();
    if (!query) {
      this._chatSearchMatches = [];
      this._chatSearchCurrent = -1;
      this._clearSearchHighlights();
      return;
    }
    const matches = [];
    for (let i = 0; i < this.messages.length; i++) {
      const content = (this.messages[i].content || '').toLowerCase();
      if (content.includes(query)) {
        matches.push(i);
      }
    }
    this._chatSearchMatches = matches;
    if (matches.length > 0) {
      this._chatSearchCurrent = 0;
      this._scrollToSearchMatch(matches[0]);
    } else {
      this._chatSearchCurrent = -1;
      this._clearSearchHighlights();
    }
  }

  _chatSearchNext() {
    if (this._chatSearchMatches.length === 0) return;
    this._chatSearchCurrent = (this._chatSearchCurrent + 1) % this._chatSearchMatches.length;
    this._scrollToSearchMatch(this._chatSearchMatches[this._chatSearchCurrent]);
  }

  _chatSearchPrev() {
    if (this._chatSearchMatches.length === 0) return;
    this._chatSearchCurrent = (this._chatSearchCurrent - 1 + this._chatSearchMatches.length) % this._chatSearchMatches.length;
    this._scrollToSearchMatch(this._chatSearchMatches[this._chatSearchCurrent]);
  }

  _scrollToSearchMatch(msgIndex) {
    this._clearSearchHighlights();
    this.updateComplete.then(() => {
      const card = this.shadowRoot?.querySelector(`.message-card[data-msg-index="${msgIndex}"]`);
      if (card) {
        card.classList.add('search-highlight');
        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  }

  _clearSearchHighlights() {
    const cards = this.shadowRoot?.querySelectorAll('.message-card.search-highlight');
    if (cards) {
      for (const c of cards) c.classList.remove('search-highlight');
    }
  }

  _clearChatSearch() {
    this._chatSearchQuery = '';
    this._chatSearchMatches = [];
    this._chatSearchCurrent = -1;
    this._clearSearchHighlights();
  }

  // === Review Helpers ===

  _getReviewDiffCount() {
    if (!this.reviewState?.active || !this.reviewState.changed_files) return 0;
    const changedPaths = new Set(this.reviewState.changed_files.map(f => f.path));
    return (this.selectedFiles || []).filter(f => changedPaths.has(f)).length;
  }

  // === @-Filter ===

  _checkAtFilter(value) {
    // Detect @text pattern at end of input
    const match = value.match(/@(\S*)$/);
    if (match) {
      this._atFilterActive = true;
      this.dispatchEvent(new CustomEvent('filter-from-chat', {
        detail: { filter: match[1] },
        bubbles: true, composed: true,
      }));
    } else if (this._atFilterActive) {
      this._atFilterActive = false;
      this.dispatchEvent(new CustomEvent('filter-from-chat', {
        detail: { filter: '' },
        bubbles: true, composed: true,
      }));
    }
  }

  _clearAtFilter() {
    if (!this._atFilterActive) return false;
    // Remove @query from input
    const match = this._inputValue.match(/@\S*$/);
    if (match) {
      this._inputValue = this._inputValue.slice(0, match.index).trimEnd();
      const textarea = this.shadowRoot?.querySelector('.input-textarea');
      if (textarea) {
        textarea.value = this._inputValue;
        this._autoResize(textarea);
      }
    }
    this._atFilterActive = false;
    this.dispatchEvent(new CustomEvent('filter-from-chat', {
      detail: { filter: '' },
      bubbles: true, composed: true,
    }));
    return true;
  }

  // === File Mention Input Accumulation ===

  /**
   * Add text to the input when a file mention is clicked.
   * Accumulates filenames if the pattern matches.
   */
  accumulateFileInInput(filename) {
    const basename = filename.split('/').pop();
    const textarea = this.shadowRoot?.querySelector('.input-textarea');
    const current = this._inputValue.trim();

    if (!current) {
      // Empty input
      this._inputValue = `The file ${basename} added. Do you want to see more files before you continue?`;
    } else if (/^The file .+ added\./.test(current) || /\(added .+\)$/.test(current)) {
      // Existing accumulation pattern — append filename
      if (current.includes('Do you want to see more files')) {
        // Replace the single file mention with a list
        const existingMatch = current.match(/^The file (.+?) added\./);
        if (existingMatch) {
          this._inputValue = `The files ${existingMatch[1]}, ${basename} added. Do you want to see more files before you continue?`;
        } else {
          const filesMatch = current.match(/^The files (.+?) added\./);
          if (filesMatch) {
            this._inputValue = `The files ${filesMatch[1]}, ${basename} added. Do you want to see more files before you continue?`;
          }
        }
      } else {
        this._inputValue = current + ` (added ${basename})`;
      }
    } else {
      // Unrelated text — append
      this._inputValue = current + ` (added ${basename})`;
    }

    if (textarea) {
      textarea.value = this._inputValue;
      this._autoResize(textarea);
    }
  }

  // === Copy / Insert Message Actions ===

  _getMessageText(msg) {
    const content = msg.content;
    if (Array.isArray(content)) {
      // Multimodal array — extract text blocks
      return content
        .filter(b => b.type === 'text' && b.text)
        .map(b => b.text)
        .join('\n');
    }
    return content || '';
  }

  _copyMessageText(msg) {
    navigator.clipboard.writeText(this._getMessageText(msg)).then(() => {
      this._showToast('Copied to clipboard', 'success');
    });
  }

  _insertMessageText(msg) {
    const text = this._getMessageText(msg);
    const textarea = this.shadowRoot?.querySelector('.input-textarea');
    if (textarea) {
      this._inputValue = text;
      textarea.value = text;
      this._autoResize(textarea);
      textarea.focus();
    }
  }

  // === Rendering ===

  /**
   * Render assistant content with edit blocks rendered inline.
   * @param {string} content - Raw assistant text
   * @param {boolean} showEditResults - Whether to show edit result badges
   * @param {boolean} isFinal - Whether this is the final (non-streaming) render
   * @returns Lit template
   */
  _renderAssistantContent(content, showEditResults, isFinal) {
    const editResultsMap = showEditResults || {};
    const segments = segmentResponse(content);
    const parts = [];

    for (const seg of segments) {
      if (seg.type === 'text') {
        let rendered = renderMarkdown(seg.content);
        if (isFinal && this._repoFiles.length > 0) {
          const { html: mentionHtml } = applyFileMentions(
            rendered, this._repoFiles, this.selectedFiles, []
          );
          rendered = mentionHtml;
        }
        parts.push(rendered);
      } else if (seg.type === 'edit' || seg.type === 'edit-pending') {
        const result = editResultsMap[seg.filePath] || {};
        parts.push(this._renderEditBlockHtml(seg, result));
      }
    }

    return parts.join('');
  }

  /**
   * Render a single edit block card as HTML string.
   */
  _renderEditBlockHtml(seg, result) {
    const status = result.status || (seg.type === 'edit-pending' ? 'pending' : 'unknown');
    const statusMsg = result.message || '';

    // Status badge
    let badge = '';
    if (status === 'applied') badge = '<span class="edit-badge applied">✅ applied</span>';
    else if (status === 'failed') badge = '<span class="edit-badge failed">❌ failed</span>';
    else if (status === 'skipped') badge = '<span class="edit-badge skipped">⚠️ skipped</span>';
    else if (status === 'validated') badge = '<span class="edit-badge validated">☑ validated</span>';
    else if (seg.isCreate) badge = '<span class="edit-badge applied">🆕 new</span>';
    else badge = '<span class="edit-badge pending">⏳ pending</span>';

    // Compute diff with character-level highlighting
    const diff = computeDiff(seg.oldLines || [], seg.newLines || []);
    const diffHtml = diff.map(line => this._renderDiffLineHtml(line)).join('');

    const failMsg = (status === 'failed' && statusMsg)
      ? `<div class="edit-error">${escapeHtml(statusMsg)}</div>`
      : '';

    return `
      <div class="edit-block-card">
        <div class="edit-block-header">
          <span class="edit-file-path" data-path="${escapeHtml(seg.filePath)}">${escapeHtml(seg.filePath)}</span>
          ${badge}
        </div>
        ${failMsg}
        <pre class="edit-diff">${diffHtml}</pre>
      </div>
    `;
  }

  /**
   * Render a single diff line with optional character-level highlighting.
   */
  _renderDiffLineHtml(line) {
    const prefix = line.type === 'remove' ? '-' : line.type === 'add' ? '+' : ' ';

    if (line.charDiff && line.charDiff.length > 0) {
      const inner = line.charDiff.map(seg =>
        seg.type === 'equal'
          ? escapeHtml(seg.text)
          : `<span class="diff-change">${escapeHtml(seg.text)}</span>`
      ).join('');
      return `<span class="diff-line ${line.type}"><span class="diff-line-prefix">${prefix}</span>${inner}</span>`;
    }

    return `<span class="diff-line ${line.type}"><span class="diff-line-prefix">${prefix}</span>${escapeHtml(line.text)}</span>`;
  }

  _renderEditSummary(msg) {
    if (!msg.passed && !msg.failed && !msg.skipped) return nothing;
    const parts = [];
    if (msg.passed) parts.push(html`<span class="stat pass">✅ ${msg.passed} applied</span>`);
    if (msg.failed) parts.push(html`<span class="stat fail">❌ ${msg.failed} failed</span>`);
    if (msg.skipped) parts.push(html`<span class="stat skip">⚠️ ${msg.skipped} skipped</span>`);
    return html`<div class="edit-summary">${parts}</div>`;
  }

  _renderMsgActions(msg) {
    if (this.streamingActive) return nothing;
    return html`
      <div class="msg-actions top">
        <button class="msg-action-btn" title="Copy" @click=${() => this._copyMessageText(msg)}>📋</button>
        <button class="msg-action-btn" title="Insert into input" @click=${() => this._insertMessageText(msg)}>↩</button>
      </div>
    `;
  }

  _renderMsgActionsBottom(msg) {
    if (this.streamingActive) return nothing;
    const content = msg.content || '';
    // Only show bottom actions on long messages (rough heuristic: > 600 chars)
    if (content.length < 600) return nothing;
    return html`
      <div class="msg-actions bottom">
        <button class="msg-action-btn" title="Copy" @click=${() => this._copyMessageText(msg)}>📋</button>
        <button class="msg-action-btn" title="Insert into input" @click=${() => this._insertMessageText(msg)}>↩</button>
      </div>
    `;
  }

  /**
   * Render user message content, handling both plain text and multimodal
   * content arrays (from loaded history sessions with images).
   */
  _renderUserContent(msg) {
    const content = msg.content;

    // Case 1: Multimodal array content (loaded from history)
    // [{type: "text", text: "..."}, {type: "image_url", image_url: {url: "data:..."}}]
    if (Array.isArray(content)) {
      const parts = [];
      const imageSrcs = [];
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          parts.push(html`<div class="md-content" @click=${this._onContentClick}>
            ${unsafeHTML(renderMarkdown(block.text))}
          </div>`);
        } else if (block.type === 'image_url' && block.image_url?.url) {
          imageSrcs.push(block.image_url.url);
        }
      }
      if (imageSrcs.length > 0) {
        parts.push(html`
          <div class="user-images">
            ${imageSrcs.map(src => html`
              <img class="user-image-thumb" src="${src}" alt="User image"
                   @click=${() => this._openLightbox(src)}>
            `)}
          </div>
        `);
      }
      return parts;
    }

    // Case 2: Plain text content (current session)
    const textContent = content || '';
    const textPart = html`<div class="md-content" @click=${this._onContentClick}>
      ${unsafeHTML(renderMarkdown(textContent))}
    </div>`;

    // Check for attached images (data URIs from current session)
    if (msg.images && msg.images.length > 0) {
      return html`
        ${textPart}
        <div class="user-images">
          ${msg.images.map(src => html`
            <img class="user-image-thumb" src="${src}" alt="User image"
                 @click=${() => this._openLightbox(src)}>
          `)}
        </div>
      `;
    }

    return textPart;
  }

  _openLightbox(src) {
    this._lightboxSrc = src;
  }

  _closeLightbox(e) {
    // Close on click anywhere or Escape
    this._lightboxSrc = null;
  }

  _onLightboxKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this._lightboxSrc = null;
    }
  }

  _renderMessage(msg, index) {
    const isUser = msg.role === 'user';
    const content = msg.content || '';

    if (isUser) {
      return html`
        <div class="message-card user" data-msg-index="${index}">
          ${this._renderMsgActions(msg)}
          <div class="role-label">You</div>
          ${this._renderUserContent(msg)}
          ${this._renderMsgActionsBottom(msg)}
        </div>
      `;
    }

    // Assistant message — render with edit blocks and file mentions
    const editFilePaths = msg.editResults ? Object.keys(msg.editResults) : [];
    const renderedHtml = this._renderAssistantContent(content, msg.editResults, true);

    // Apply file mentions on the full rendered output
    const { html: mentionHtml, referencedFiles } = applyFileMentions(
      renderedHtml, this._repoFiles, this.selectedFiles, editFilePaths
    );

    const fileSummaryHtml = renderFileSummary(referencedFiles, this.selectedFiles);

    return html`
      <div class="message-card assistant" data-msg-index="${index}">
        ${this._renderMsgActions(msg)}
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
        ${this._renderMsgActionsBottom(msg)}
      </div>
    `;
  }

  _onContentClick(e) {
    // Handle file mention clicks (inline text mentions — navigate to file)
    const mention = e.target.closest('.file-mention');
    if (mention) {
      const filePath = mention.dataset.file;
      if (filePath) {
        this._dispatchFileMentionClick(filePath, true);
      }
      return;
    }

    // Handle file path clicks in edit blocks
    const pathEl = e.target.closest('.edit-file-path');
    if (pathEl) {
      const filePath = pathEl.dataset.path;
      if (filePath) {
        // Dispatch on window for app shell to route to diff viewer
        window.dispatchEvent(new CustomEvent('navigate-file', {
          detail: { path: filePath },
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
    // Handle individual file chip clicks (toggle only — no navigation)
    const chip = e.target.closest('.file-chip');
    if (chip) {
      const filePath = chip.dataset.file;
      if (filePath) {
        this._dispatchFileMentionClick(filePath, false);
      }
      return;
    }

    // Handle "Add All" button (toggle only — no navigation)
    const addAllBtn = e.target.closest('.add-all-btn');
    if (addAllBtn) {
      try {
        const files = JSON.parse(addAllBtn.dataset.files);
        if (Array.isArray(files)) {
          for (const f of files) {
            this._dispatchFileMentionClick(f, false);
          }
        }
      } catch (err) {
        console.warn('Failed to parse add-all files:', err);
      }
    }
  }

  _dispatchFileMentionClick(filePath, navigate = true) {
    this.dispatchEvent(new CustomEvent('file-mention-click', {
      detail: { path: filePath, navigate },
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

        <div class="chat-search">
          <input
            class="chat-search-input"
            type="text"
            placeholder="Search messages..."
            .value=${this._chatSearchQuery}
            @input=${this._onChatSearchInput}
            @keydown=${this._onChatSearchKeyDown}
          >
          ${this._chatSearchMatches.length > 0 ? html`
            <span class="chat-search-counter">${this._chatSearchCurrent + 1}/${this._chatSearchMatches.length}</span>
            <button class="chat-search-nav" title="Previous (Shift+Enter)" @click=${this._chatSearchPrev}>▲</button>
            <button class="chat-search-nav" title="Next (Enter)" @click=${this._chatSearchNext}>▼</button>
          ` : nothing}
        </div>

        <button class="action-btn" title="Copy diff" @click=${this._copyDiff}
          ?disabled=${!this.rpcConnected}>📋</button>
        <button class="action-btn ${this._committing ? 'committing' : ''}"
          title="${this.reviewState?.active ? 'Commit disabled during review' : 'Stage all & commit'}"
          @click=${this._commitWithMessage}
          ?disabled=${!this.rpcConnected || this._committing || this.streamingActive || this.reviewState?.active}>
          ${this._committing ? '⏳' : '💾'}
        </button>
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
              <div class="md-content" @click=${this._onContentClick}>
                ${unsafeHTML(this._renderAssistantContent(this._streamingContent, {}, false))}
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

      <!-- Review Status Bar -->
      ${this.reviewState?.active ? html`
        <div class="review-status-bar">
          📋 <strong>${this.reviewState.branch}</strong>
          ${this.reviewState.stats?.commit_count || 0} commits ·
          ${this.reviewState.stats?.files_changed || 0} files ·
          +${this.reviewState.stats?.additions || 0} −${this.reviewState.stats?.deletions || 0}
          <span class="review-diff-count">
            ${this._getReviewDiffCount()}/${this.reviewState.stats?.files_changed || 0} diffs in context
          </span>
          <button class="review-exit-link" @click=${() => this.dispatchEvent(new CustomEvent('exit-review', { bubbles: true, composed: true }))}>
            Exit Review
          </button>
        </div>
      ` : nothing}

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

        ${this._snippetDrawerOpen && (this._snippets.length > 0 || (this.reviewState?.active && this._reviewSnippets.length > 0)) ? html`
          <div class="snippet-drawer">
            ${this._snippets.map(s => html`
              <button class="snippet-btn" @click=${() => this._insertSnippet(s)} title="${s.tooltip || ''}">
                ${s.icon || '📌'} ${s.tooltip || s.message?.slice(0, 30) || 'Snippet'}
              </button>
            `)}
            ${this.reviewState?.active ? this._reviewSnippets.map(s => html`
              <button class="snippet-btn" @click=${() => this._insertSnippet(s)} title="${s.tooltip || ''}">
                ${s.icon || '📌'} ${s.tooltip || s.message?.slice(0, 30) || 'Snippet'}
              </button>
            `) : nothing}
          </div>
        ` : nothing}

        <div class="input-row">
          <div class="input-left-buttons">
            <ac-speech-to-text
              @transcript=${this._onTranscript}
            ></ac-speech-to-text>
            <button
              class="snippet-toggle ${this._snippetDrawerOpen ? 'active' : ''}"
              @click=${this._toggleSnippets}
              title="Quick snippets"
            >📌</button>
          </div>

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

      <!-- Image Lightbox -->
      ${this._lightboxSrc ? html`
        <div class="image-lightbox"
             @click=${this._closeLightbox}
             @keydown=${this._onLightboxKeyDown}
             tabindex="0">
          <img src="${this._lightboxSrc}" alt="Full size image"
               @click=${(e) => e.stopPropagation()}>
        </div>
      ` : nothing}
    `;
  }
}

customElements.define('ac-chat-panel', AcChatPanel);
