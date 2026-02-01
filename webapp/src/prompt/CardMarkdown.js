import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { marked } from 'marked';
import './PrismSetup.js';
import { computeLineDiff, computeCharDiff } from '../utils/diff.js';

export class CardMarkdown extends LitElement {
  static properties = {
    content: { type: String },
    role: { type: String },
    mentionedFiles: { type: Array },
    selectedFiles: { type: Array },  // Files currently in context
    editResults: { type: Array }  // Array of {file_path, status, reason, estimated_line}
  };

  static styles = css`
    :host {
      display: block;
    }

    .content {
      line-height: 1.5;
      word-break: break-word;
    }

    pre {
      background: #0d0d0d;
      border-radius: 6px;
      padding: 12px;
      overflow-x: auto;
      position: relative;
    }

    code {
      font-family: 'Fira Code', monospace;
      font-size: 13px;
    }

    p code {
      background: #0f3460;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .file-mention {
      color: #7ec699;
      cursor: pointer;
      text-decoration: underline;
      text-decoration-style: dotted;
      text-underline-offset: 2px;
    }

    .file-mention:hover {
      color: #a3e4b8;
      text-decoration-style: solid;
    }

    .file-mention.in-context {
      color: #6e7681;
      text-decoration: none;
      cursor: default;
    }

    .file-mention.in-context::before {
      content: '✓ ';
      font-size: 10px;
    }

    /* Files summary section */
    .files-summary {
      margin-top: 12px;
      padding: 10px 12px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      font-size: 13px;
    }

    .files-summary-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #8b949e;
      font-size: 11px;
      text-transform: uppercase;
      margin-bottom: 8px;
      font-weight: 600;
    }

    .select-all-btn {
      background: #238636;
      color: #fff;
      border: none;
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      text-transform: none;
    }

    .select-all-btn:hover {
      background: #2ea043;
    }

    .files-summary-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .file-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: 'Fira Code', monospace;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .file-chip.not-in-context {
      background: #1f3d1f;
      color: #7ee787;
      border: 1px solid #238636;
    }

    .file-chip.not-in-context:hover {
      background: #238636;
    }

    .file-chip.in-context {
      background: #21262d;
      color: #8b949e;
      border: 1px solid #30363d;
      cursor: pointer;
    }

    .file-chip.in-context:hover {
      background: #30363d;
    }

    .file-chip .chip-icon {
      font-size: 10px;
    }

    /* Edits summary section */
    .edits-summary {
      margin-top: 12px;
      padding: 10px 12px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      font-size: 13px;
    }

    .edits-summary-header {
      color: #8b949e;
      font-size: 11px;
      text-transform: uppercase;
      margin-bottom: 8px;
      font-weight: 600;
    }

    .edits-summary-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .edit-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: 'Fira Code', monospace;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .edit-tag.applied {
      background: #1f3d1f;
      color: #7ee787;
      border: 1px solid #238636;
    }

    .edit-tag.applied:hover {
      background: #238636;
    }

    .edit-tag.failed {
      background: #3d1f1f;
      color: #ffa198;
      border: 1px solid #da3633;
    }

    .edit-tag.failed:hover {
      background: #da3633;
    }

    .edit-tag-icon {
      font-size: 10px;
    }

    /* Edit block styles */
    .edit-block {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      margin: 12px 0;
      overflow: hidden;
      font-family: 'Fira Code', monospace;
      font-size: 13px;
    }

    .edit-block-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: #161b22;
      border-bottom: 1px solid #30363d;
    }

    .edit-block-file {
      color: #58a6ff;
      font-weight: 600;
      cursor: pointer;
    }

    .edit-block-file:hover {
      text-decoration: underline;
    }

    .edit-block-status {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
    }

    .edit-block-status.applied {
      background: #238636;
      color: #fff;
    }

    .edit-block-status.failed {
      background: #da3633;
      color: #fff;
    }

    .edit-block-status.pending {
      background: #6e7681;
      color: #fff;
    }

    .edit-block-content {
      padding: 0;
    }

    .diff-line {
      display: block;
      padding: 0 12px;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: 'Fira Code', monospace;
      font-size: 13px;
      line-height: 1.4;
    }

    .diff-line.context {
      background: #0d1117;
      color: #8b949e;
    }

    .diff-line.remove {
      background: #3d1f1f;
      color: #ffa198;
    }

    .diff-line.add {
      background: #1f3d1f;
      color: #7ee787;
    }

    .diff-line-prefix {
      user-select: none;
      display: inline-block;
      width: 1.5ch;
      color: inherit;
      opacity: 0.6;
    }

    /* Inline word-level highlighting */
    .diff-line.remove .diff-change {
      background: #8b3d3d;
      border-radius: 2px;
      padding: 0 2px;
    }

    .diff-line.add .diff-change {
      background: #2d6b2d;
      border-radius: 2px;
      padding: 0 2px;
    }

    .edit-block-error {
      padding: 8px 12px;
      background: #3d1f1f;
      color: #ffa198;
      font-size: 12px;
      border-top: 1px solid #da3633;
    }

    .edit-block-line-info {
      font-size: 11px;
      color: #6e7681;
      margin-left: 8px;
    }

    .code-wrapper {
      position: relative;
    }

    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: #e94560;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 11px;
    }

    .copy-btn:hover {
      background: #ff6b6b;
    }

    /* Prism Tomorrow Night theme */
    .token.comment,
    .token.prolog,
    .token.doctype,
    .token.cdata { color: #999; }
    .token.punctuation { color: #ccc; }
    .token.property,
    .token.tag,
    .token.boolean,
    .token.number,
    .token.constant,
    .token.symbol { color: #f08d49; }
    .token.selector,
    .token.attr-name,
    .token.string,
    .token.char,
    .token.builtin { color: #7ec699; }
    .token.operator,
    .token.entity,
    .token.url,
    .token.variable { color: #67cdcc; }
    .token.atrule,
    .token.attr-value,
    .token.keyword { color: #cc99cd; }
    .token.function { color: #f08d49; }
    .token.regex,
    .token.important { color: #e90; }
  `;

  constructor() {
    super();
    this.content = '';
    this.role = 'assistant';
    this.mentionedFiles = [];
    this.selectedFiles = [];
    this.editResults = [];
    this._foundFiles = [];  // Files actually found in content
    this._codeScrollPositions = new Map();
    
    marked.setOptions({
      highlight: (code, lang) => {
        if (lang && Prism.languages[lang]) {
          return Prism.highlight(code, Prism.languages[lang], lang);
        }
        return code;
      },
      breaks: true,
      gfm: true
    });
  }

  processContent() {
    if (!this.content) return '';
    
    if (this.role === 'user') {
      return this.escapeHtml(this.content).replace(/\n/g, '<br>');
    }
    
    // Check if content contains edit blocks
    const hasEditBlocks = this.content.includes('««« EDIT');
    
    if (hasEditBlocks) {
      // Parse edit blocks and process markdown separately
      let processed = this.processContentWithEditBlocks(this.content);
      processed = this.wrapCodeBlocksWithCopyButton(processed);
      processed = this.highlightFileMentions(processed);
      return processed;
    }
    
    // Pre-process to protect search/replace markers from markdown parsing
    let content = this.protectSearchReplaceBlocks(this.content);
    
    let processed = marked.parse(content);
    processed = this.wrapCodeBlocksWithCopyButton(processed);
    processed = this.highlightFileMentions(processed);
    return processed;
  }

  protectSearchReplaceBlocks(content) {
    // Pass through content unchanged - let markdown handle it naturally
    return content;
  }

  /**
   * Parse edit blocks from content and return structured data.
   * Format: file.py\n««« EDIT\n...\n═══════ REPL\n...\n»»» EDIT END
   */
  parseEditBlocks(content) {
    const blocks = [];
    const lines = content.split('\n');
    
    let state = 'IDLE';
    let currentBlock = null;
    let potentialPath = null;
    let editLines = [];
    let replLines = [];
    let blockStartIndex = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      if (state === 'IDLE') {
        if (trimmed && !trimmed.startsWith('```') && !trimmed.startsWith('#')) {
          potentialPath = trimmed;
          state = 'EXPECT_START';
        }
      } else if (state === 'EXPECT_START') {
        if (trimmed === '««« EDIT') {
          blockStartIndex = i - 1; // Include the file path line
          currentBlock = { filePath: potentialPath, startIndex: blockStartIndex };
          editLines = [];
          state = 'EDIT_SECTION';
        } else if (trimmed) {
          potentialPath = trimmed;
        } else {
          state = 'IDLE';
          potentialPath = null;
        }
      } else if (state === 'EDIT_SECTION') {
        if (trimmed === '═══════ REPL') {
          currentBlock.editLines = editLines.join('\n');
          replLines = [];
          state = 'REPL_SECTION';
        } else {
          editLines.push(line);
        }
      } else if (state === 'REPL_SECTION') {
        if (trimmed === '»»» EDIT END') {
          currentBlock.replLines = replLines.join('\n');
          currentBlock.endIndex = i;
          blocks.push(currentBlock);
          state = 'IDLE';
          currentBlock = null;
          potentialPath = null;
        } else {
          replLines.push(line);
        }
      }
    }
    
    return blocks;
  }

  /**
   * Get edit result for a specific file path.
   */
  getEditResultForFile(filePath) {
    if (!this.editResults || this.editResults.length === 0) return null;
    // Normalize paths for comparison (handle ./ prefix, backslashes, etc.)
    const normalize = (p) => p?.replace(/^\.\//, '').replace(/\\/g, '/').trim();
    const normalizedSearch = normalize(filePath);
    return this.editResults.find(r => normalize(r.file_path) === normalizedSearch);
  }

  /**
   * Render an edit block as HTML with unified diff view.
   */
  renderEditBlock(block) {
    const result = this.getEditResultForFile(block.filePath);
    const status = result ? result.status : 'pending';
    const statusLabel = status === 'applied' ? '✓ Applied' : 
                        status === 'failed' ? '✗ Failed' : 
                        '○ Pending';
    
    let errorHtml = '';
    if (result && result.status === 'failed' && result.reason) {
      const lineInfo = result.estimated_line ? ` (near line ${result.estimated_line})` : '';
      errorHtml = `<div class="edit-block-error">Error: ${this.escapeHtml(result.reason)}${lineInfo}</div>`;
    }
    
    const lineInfo = result && result.estimated_line 
      ? `<span class="edit-block-line-info">line ${result.estimated_line}</span>` 
      : '';
    
    // Compute unified diff
    const diffHtml = this.formatUnifiedDiff(block.editLines, block.replLines);
    
    // Get search context from first non-empty line
    const editLines = block.editLines ? block.editLines.split('\n') : [];
    const searchContext = editLines.find(line => line.trim().length > 0) || '';
    const encodedContext = this.escapeHtml(searchContext).replace(/"/g, '&quot;');
    
    return `
      <div class="edit-block">
        <div class="edit-block-header">
          <span class="edit-block-file" data-file="${this.escapeHtml(block.filePath)}" data-context="${encodedContext}">${this.escapeHtml(block.filePath)}</span>
          <div>
            ${lineInfo}
            <span class="edit-block-status ${status}">${statusLabel}</span>
          </div>
        </div>
        <div class="edit-block-content">
          ${diffHtml}
        </div>
        ${errorHtml}
      </div>
    `;
  }

  /**
   * Format edit/repl content as unified diff HTML using LCS algorithm.
   * Includes word-level inline highlighting for modified lines.
   */
  formatUnifiedDiff(editContent, replContent) {
    const oldLines = editContent ? editContent.split('\n') : [];
    const newLines = replContent ? replContent.split('\n') : [];
    
    // Handle empty cases
    if (oldLines.length === 0 && newLines.length === 0) {
      return '';
    }
    
    const diff = computeLineDiff(oldLines, newLines);
    
    const lines = diff.map(entry => {
      const prefix = entry.type === 'add' ? '+' : entry.type === 'remove' ? '-' : ' ';
      
      // Check if this line has inline highlighting info
      if (entry.pair?.charDiff) {
        const highlightedContent = this.renderInlineHighlight(entry.pair.charDiff, entry.type);
        return `<span class="diff-line ${entry.type}"><span class="diff-line-prefix">${prefix}</span>${highlightedContent}</span>`;
      }
      
      const escapedLine = this.escapeHtml(entry.line);
      return `<span class="diff-line ${entry.type}"><span class="diff-line-prefix">${prefix}</span>${escapedLine}</span>`;
    });
    
    return lines.join('\n');
  }

  /**
   * Render line content with inline character-level highlighting.
   * @param {Array<{type: 'same'|'add'|'remove', text: string}>} segments
   * @param {string} lineType - 'add' or 'remove'
   */
  renderInlineHighlight(segments, lineType) {
    return segments.map(segment => {
      const escapedText = this.escapeHtml(segment.text);
      
      // For 'same' segments, just return the text
      if (segment.type === 'same') {
        return escapedText;
      }
      
      // For changed segments, wrap in highlight span
      // On remove lines, highlight 'remove' segments
      // On add lines, highlight 'add' segments
      if ((lineType === 'remove' && segment.type === 'remove') ||
          (lineType === 'add' && segment.type === 'add')) {
        return `<span class="diff-change">${escapedText}</span>`;
      }
      
      return escapedText;
    }).join('');
  }

  /**
   * Process content with edit blocks by extracting them, processing markdown
   * on the remaining text, then reinserting rendered edit blocks.
   */
  processContentWithEditBlocks(content) {
    const blocks = this.parseEditBlocks(content);
    
    if (blocks.length === 0) {
      return marked.parse(content);
    }
    
    // Split content into segments: text and edit blocks
    const lines = content.split('\n');
    const segments = [];
    let lastEnd = 0;
    
    for (const block of blocks) {
      // Text before this edit block
      if (block.startIndex > lastEnd) {
        const textLines = lines.slice(lastEnd, block.startIndex);
        segments.push({ type: 'text', content: textLines.join('\n') });
      }
      // The edit block itself
      segments.push({ type: 'edit', block });
      lastEnd = block.endIndex + 1;
    }
    
    // Text after the last edit block
    if (lastEnd < lines.length) {
      const textLines = lines.slice(lastEnd);
      segments.push({ type: 'text', content: textLines.join('\n') });
    }
    
    // Process each segment appropriately
    let result = '';
    for (const segment of segments) {
      if (segment.type === 'text') {
        result += marked.parse(segment.content);
      } else {
        result += this.renderEditBlock(segment.block);
      }
    }
    
    return result;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  wrapCodeBlocksWithCopyButton(htmlContent) {
    const preCodeRegex = /(<pre[^>]*>)(\s*<code[^>]*>)([\s\S]*?)(<\/code>\s*<\/pre>)/gi;
    return htmlContent.replace(preCodeRegex, (match, pre, code, content, closing) => {
      return `<div class="code-wrapper">${pre}${code}${content}${closing}<button class="copy-btn" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent)">Copy</button></div>`;
    });
  }

  highlightFileMentions(htmlContent) {
    if (!this.mentionedFiles || this.mentionedFiles.length === 0) {
      return htmlContent;
    }
    
    let result = htmlContent;
    this._foundFiles = [];  // Reset found files
    
    // Sort by length descending to match longer paths first
    const sortedFiles = [...this.mentionedFiles].sort((a, b) => b.length - a.length);
    
    for (const filePath of sortedFiles) {
      // Escape special regex characters in the file path
      const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Match the file path but not if it's already inside an HTML tag or anchor
      // Also avoid matching inside code blocks (already processed)
      const regex = new RegExp(`(?<!<[^>]*)(?<!class=")\\b(${escaped})\\b(?![^<]*>)`, 'g');
      
      if (regex.test(htmlContent)) {
        this._foundFiles.push(filePath);
        const isInContext = this.selectedFiles && this.selectedFiles.includes(filePath);
        const contextClass = isInContext ? ' in-context' : '';
        // Reset regex lastIndex after test()
        regex.lastIndex = 0;
        result = result.replace(regex, `<span class="file-mention${contextClass}" data-file="${filePath}">$1</span>`);
      }
    }
    
    return result;
  }

  renderEditsSummary() {
    if (!this.editResults || this.editResults.length === 0) {
      return '';
    }

    const tagsHtml = this.editResults.map(result => {
      const isApplied = result.status === 'applied';
      const statusClass = isApplied ? 'applied' : 'failed';
      const icon = isApplied ? '✓' : '✗';
      const tooltip = isApplied ? 'Applied successfully' : `Failed: ${result.reason || 'Unknown error'}`;
      return `<span class="edit-tag ${statusClass}" title="${this.escapeHtml(tooltip)}" data-file="${this.escapeHtml(result.file_path)}"><span class="edit-tag-icon">${icon}</span>${this.escapeHtml(result.file_path)}</span>`;
    }).join('');

    const appliedCount = this.editResults.filter(r => r.status === 'applied').length;
    const failedCount = this.editResults.length - appliedCount;
    
    let summaryText = '';
    if (appliedCount > 0 && failedCount > 0) {
      summaryText = `${appliedCount} applied, ${failedCount} failed`;
    } else if (appliedCount > 0) {
      summaryText = `${appliedCount} edit${appliedCount > 1 ? 's' : ''} applied`;
    } else {
      summaryText = `${failedCount} edit${failedCount > 1 ? 's' : ''} failed`;
    }

    return `
      <div class="edits-summary">
        <div class="edits-summary-header">✏️ Edits: ${summaryText}</div>
        <div class="edits-summary-list">${tagsHtml}</div>
      </div>
    `;
  }

  renderFilesSummary() {
    if (this._foundFiles.length === 0) {
      return '';
    }

    const notInContextFiles = this._foundFiles.filter(f => !this.selectedFiles || !this.selectedFiles.includes(f));
    const hasFilesToAdd = notInContextFiles.length > 1;

    const filesHtml = this._foundFiles.map(filePath => {
      const isInContext = this.selectedFiles && this.selectedFiles.includes(filePath);
      const chipClass = isInContext ? 'in-context' : 'not-in-context';
      const icon = isInContext ? '✓' : '+';
      return `<span class="file-chip ${chipClass}" data-file="${this.escapeHtml(filePath)}"><span class="chip-icon">${icon}</span>${this.escapeHtml(filePath)}</span>`;
    }).join('');

    const selectAllBtn = hasFilesToAdd 
      ? `<button class="select-all-btn" data-files='${JSON.stringify(notInContextFiles)}'>+ Add All (${notInContextFiles.length})</button>`
      : '';

    return `
      <div class="files-summary">
        <div class="files-summary-header">📁 Files Referenced ${selectAllBtn}</div>
        <div class="files-summary-list">${filesHtml}</div>
      </div>
    `;
  }

  handleClick(e) {
    const fileMention = e.target.closest('.file-mention');
    if (fileMention) {
      const filePath = fileMention.dataset.file;
      if (filePath) {
        this.dispatchEvent(new CustomEvent('file-mention-click', {
          detail: { path: filePath },
          bubbles: true,
          composed: true
        }));
      }
    }
    
    // Handle file chip clicks in summary (allow both in-context and not-in-context)
    const fileChip = e.target.closest('.file-chip');
    if (fileChip) {
      const filePath = fileChip.dataset.file;
      if (filePath) {
        this.dispatchEvent(new CustomEvent('file-mention-click', {
          detail: { path: filePath },
          bubbles: true,
          composed: true
        }));
      }
    }

    // Handle edit block file path clicks
    const editBlockFile = e.target.closest('.edit-block-file');
    if (editBlockFile) {
      const filePath = editBlockFile.dataset.file;
      const searchContext = editBlockFile.dataset.context;
      if (filePath) {
        const result = this.getEditResultForFile(filePath);
        this.dispatchEvent(new CustomEvent('edit-block-click', {
          detail: { 
            path: filePath,
            line: result?.estimated_line || 1,
            status: result?.status || 'pending',
            searchContext: searchContext || null
          },
          bubbles: true,
          composed: true
        }));
      }
    }

    // Handle edit tag clicks
    const editTag = e.target.closest('.edit-tag');
    if (editTag) {
      const filePath = editTag.dataset.file;
      if (filePath) {
        const result = this.getEditResultForFile(filePath);
        this.dispatchEvent(new CustomEvent('edit-block-click', {
          detail: { 
            path: filePath,
            line: result?.estimated_line || 1,
            status: result?.status || 'pending',
            searchContext: null
          },
          bubbles: true,
          composed: true
        }));
      }
    }

    // Handle select all button click
    const selectAllBtn = e.target.closest('.select-all-btn');
    if (selectAllBtn) {
      try {
        const files = JSON.parse(selectAllBtn.dataset.files || '[]');
        // Dispatch file-mention-click for each file (same as clicking individual chips)
        for (const filePath of files) {
          this.dispatchEvent(new CustomEvent('file-mention-click', {
            detail: { path: filePath },
            bubbles: true,
            composed: true
          }));
        }
      } catch (e) {
        console.error('Failed to parse files:', e);
      }
    }
  }

  willUpdate() {
    // Save horizontal scroll positions of all code blocks before re-render
    this._codeScrollPositions.clear();
    const codeBlocks = this.shadowRoot?.querySelectorAll('pre');
    if (codeBlocks) {
      codeBlocks.forEach((pre, index) => {
        if (pre.scrollLeft > 0) {
          this._codeScrollPositions.set(index, pre.scrollLeft);
        }
      });
    }
  }

  updated() {
    // Restore horizontal scroll positions after re-render
    if (this._codeScrollPositions.size > 0) {
      const codeBlocks = this.shadowRoot?.querySelectorAll('pre');
      if (codeBlocks) {
        this._codeScrollPositions.forEach((scrollLeft, index) => {
          if (codeBlocks[index]) {
            codeBlocks[index].scrollLeft = scrollLeft;
          }
        });
      }
    }
  }

  render() {
    const processedContent = this.processContent();
    return html`
      <div class="content" @click=${this.handleClick}>
        ${unsafeHTML(processedContent)}
        ${this.role === 'assistant' ? unsafeHTML(this.renderEditsSummary()) : ''}
        ${this.role === 'assistant' ? unsafeHTML(this.renderFilesSummary()) : ''}
      </div>
    `;
  }
}

customElements.define('card-markdown', CardMarkdown);
