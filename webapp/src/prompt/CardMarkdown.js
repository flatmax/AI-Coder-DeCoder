import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { marked } from 'marked';
import './PrismSetup.js';
import { escapeHtml } from '../utils/formatters.js';
import { parseEditBlocks } from './EditBlockParser.js';
import { renderEditBlock, renderEditsSummary } from './EditBlockRenderer.js';
import { highlightFileMentions, renderFilesSummary } from './FileMentionHelper.js';
import { dispatchClick } from './CardClickHandler.js';

export class CardMarkdown extends LitElement {
  static properties = {
    content: { type: String },
    role: { type: String },
    mentionedFiles: { type: Array },
    selectedFiles: { type: Array },  // Files currently in context
    editResults: { type: Array },  // Array of {file_path, status, reason, estimated_line}
    final: { type: Boolean }  // Whether the message is complete (not still streaming)
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
    this.final = true;
    this._foundFiles = [];  // Files actually found in content
    this._codeScrollPositions = new Map();
    this._cachedContent = null;
    this._cachedResult = null;
    
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
      return escapeHtml(this.content).replace(/\n/g, '<br>');
    }
    
    // Fast cache hit — content hasn't changed at all
    if (this._cachedContent === this.content && this._cachedResult) {
      return this._cachedResult;
    }
    
    const isStreaming = !this.final;
    
    // During streaming: just run marked.parse() — skip expensive
    // post-processing (edit blocks, file mentions, copy buttons)
    // which are only useful once the message is complete.
    if (isStreaming) {
      this._cachedContent = this.content;
      this._cachedResult = null;  // Invalidate final cache
      return marked.parse(this.content);
    }
    
    // Final render: full processing pipeline
    this._cachedContent = this.content;
    
    const hasEditBlocks = this.content.includes('««« EDIT');
    let processed;
    
    if (hasEditBlocks) {
      processed = this.processContentWithEditBlocks(this.content);
    } else {
      processed = marked.parse(this.content);
    }
    
    processed = this.wrapCodeBlocksWithCopyButton(processed);
    processed = this.highlightFileMentions(processed);
    this._cachedResult = processed;
    
    return processed;
  }



  /**
   * Process content with edit blocks by extracting them, processing markdown
   * on the remaining text, then reinserting rendered edit blocks.
   * Uses a single marked.parse() call for all text segments to avoid
   * per-segment parsing overhead.
   */
  processContentWithEditBlocks(content) {
    const blocks = parseEditBlocks(content);
    
    if (blocks.length === 0) {
      return marked.parse(content);
    }
    
    // Split content into segments: text and edit blocks
    const lines = content.split('\n');
    const segments = [];
    let lastEnd = 0;
    
    for (const block of blocks) {
      if (block.startIndex > lastEnd) {
        const textLines = lines.slice(lastEnd, block.startIndex);
        segments.push({ type: 'text', content: textLines.join('\n') });
      }
      segments.push({ type: 'edit', block });
      lastEnd = block.endIndex + 1;
    }
    
    if (lastEnd < lines.length) {
      const textLines = lines.slice(lastEnd);
      segments.push({ type: 'text', content: textLines.join('\n') });
    }
    
    // Batch all text segments into a single marked.parse() call
    // using unique placeholders, then split and interleave
    const PLACEHOLDER_PREFIX = '\n\n<!--EDIT_BLOCK_';
    const PLACEHOLDER_SUFFIX = '-->\n\n';
    let combinedText = '';
    let editBlockIndex = 0;
    
    for (const segment of segments) {
      if (segment.type === 'text') {
        combinedText += segment.content;
      } else {
        combinedText += `${PLACEHOLDER_PREFIX}${editBlockIndex}${PLACEHOLDER_SUFFIX}`;
        editBlockIndex++;
      }
    }
    
    // Single parse call for all markdown
    const parsedHtml = marked.parse(combinedText);
    
    // Split on placeholders and interleave edit blocks
    const editBlocks = segments.filter(s => s.type === 'edit');
    const placeholderRegex = /<!--EDIT_BLOCK_(\d+)-->/g;
    let result = '';
    let lastIndex = 0;
    let match;
    
    while ((match = placeholderRegex.exec(parsedHtml)) !== null) {
      result += parsedHtml.slice(lastIndex, match.index);
      const blockIdx = parseInt(match[1], 10);
      if (blockIdx < editBlocks.length) {
        result += renderEditBlock(editBlocks[blockIdx].block, this.editResults);
      }
      lastIndex = match.index + match[0].length;
    }
    result += parsedHtml.slice(lastIndex);
    
    return result;
  }



  wrapCodeBlocksWithCopyButton(htmlContent) {
    const preCodeRegex = /(<pre[^>]*>)(\s*<code[^>]*>)([\s\S]*?)(<\/code>\s*<\/pre>)/gi;
    return htmlContent.replace(preCodeRegex, (match, pre, code, content, closing) => {
      return `<div class="code-wrapper">${pre}${code}${content}${closing}<button class="copy-btn" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent)">Copy</button></div>`;
    });
  }

  highlightFileMentions(htmlContent) {
    const { html: result, foundFiles } = highlightFileMentions(htmlContent, this.mentionedFiles, this.selectedFiles);
    this._foundFiles = foundFiles;
    return result;
  }

  renderEditsSummary() {
    return renderEditsSummary(this.editResults);
  }

  renderFilesSummary() {
    return renderFilesSummary(this._foundFiles, this.selectedFiles);
  }

  handleClick(e) {
    dispatchClick(e, this);
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
