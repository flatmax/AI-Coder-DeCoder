import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { marked } from 'marked';
import './PrismSetup.js';

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
      color: #8b949e;
      font-size: 11px;
      text-transform: uppercase;
      margin-bottom: 8px;
      font-weight: 600;
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

    .edit-section {
      padding: 8px 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .edit-section-header {
      font-size: 10px;
      text-transform: uppercase;
      color: #6e7681;
      padding: 4px 12px;
      background: #0d1117;
      border-top: 1px solid #30363d;
    }

    .edit-section-header:first-child {
      border-top: none;
    }

    .edit-section.context {
      background: #0d1117;
      color: #8b949e;
    }

    .edit-section.old-lines {
      background: #3d1f1f;
      color: #ffa198;
    }

    .edit-section.new-lines {
      background: #1f3d1f;
      color: #7ee787;
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
    return this.editResults.find(r => r.file_path === filePath);
  }

  /**
   * Render an edit block as HTML.
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
    
    // Parse edit and repl sections to identify context vs changes
    const { contextHtml, oldHtml, newHtml, contextLines } = this.formatEditSections(block.editLines, block.replLines);
    
    // Use first non-empty context line, or first non-empty old line as search context
    const allLines = [...contextLines, ...(block.editLines ? block.editLines.split('\n') : [])];
    const searchContext = allLines.find(line => line.trim().length > 0) || '';
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
          ${contextHtml ? `<div class="edit-section-header">Context</div><div class="edit-section context">${contextHtml}</div>` : ''}
          ${oldHtml ? `<div class="edit-section-header">Remove</div><div class="edit-section old-lines">${oldHtml}</div>` : ''}
          ${newHtml ? `<div class="edit-section-header">Add</div><div class="edit-section new-lines">${newHtml}</div>` : ''}
        </div>
        ${errorHtml}
      </div>
    `;
  }

  /**
   * Format edit sections by computing the common prefix (context).
   */
  formatEditSections(editContent, replContent) {
    const editLines = editContent ? editContent.split('\n') : [];
    const replLines = replContent ? replContent.split('\n') : [];
    
    // Find common prefix (context lines)
    let commonPrefixLength = 0;
    const minLength = Math.min(editLines.length, replLines.length);
    
    for (let i = 0; i < minLength; i++) {
      if (editLines[i] === replLines[i]) {
        commonPrefixLength++;
      } else {
        break;
      }
    }
    
    const contextLines = editLines.slice(0, commonPrefixLength);
    const oldLines = editLines.slice(commonPrefixLength);
    const newLines = replLines.slice(commonPrefixLength);
    
    return {
      contextHtml: contextLines.length > 0 ? this.escapeHtml(contextLines.join('\n')) : '',
      oldHtml: oldLines.length > 0 ? this.escapeHtml(oldLines.join('\n')) : '',
      newHtml: newLines.length > 0 ? this.escapeHtml(newLines.join('\n')) : '',
      contextLines: contextLines
    };
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

  renderFilesSummary() {
    if (this._foundFiles.length === 0) {
      return '';
    }

    const filesHtml = this._foundFiles.map(filePath => {
      const isInContext = this.selectedFiles && this.selectedFiles.includes(filePath);
      const chipClass = isInContext ? 'in-context' : 'not-in-context';
      const icon = isInContext ? '✓' : '+';
      return `<span class="file-chip ${chipClass}" data-file="${this.escapeHtml(filePath)}"><span class="chip-icon">${icon}</span>${this.escapeHtml(filePath)}</span>`;
    }).join('');

    return `
      <div class="files-summary">
        <div class="files-summary-header">📁 Files Referenced</div>
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
        ${this.role === 'assistant' ? unsafeHTML(this.renderFilesSummary()) : ''}
      </div>
    `;
  }
}

customElements.define('card-markdown', CardMarkdown);
