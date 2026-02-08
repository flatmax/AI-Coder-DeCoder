import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { marked } from 'marked';
import './PrismSetup.js';
import { escapeHtml } from '../utils/formatters.js';
import { parseEditBlocks } from './EditBlockParser.js';
import { renderEditBlock, renderEditsSummary, renderInProgressEditBlock } from './EditBlockRenderer.js';
import { highlightFileMentions, renderFilesSummary } from './FileMentionHelper.js';
import { dispatchClick } from './CardClickHandler.js';

export class CardMarkdown extends LitElement {
  static properties = {
    content: { type: String },
    role: { type: String },
    mentionedFiles: { type: Array },
    selectedFiles: { type: Array },  // Files currently in context
    editResults: { type: Array },  // Array of {file_path, status, reason, estimated_line}
    final: { type: Boolean },  // Whether the message is complete (not still streaming)
    streaming: { type: Boolean, reflect: true }
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

    /* Streaming cursor */
    :host([streaming]) .content::after {
      content: '▌';
      display: inline;
      animation: blink 0.8s step-end infinite;
      color: #e94560;
      font-weight: bold;
    }

    @keyframes blink {
      50% { opacity: 0; }
    }

    /* In-progress edit block pulse */
    .streaming-edit-pulse {
      height: 24px;
      background: linear-gradient(90deg, transparent, rgba(233,69,96,0.1), transparent);
      background-size: 200% 100%;
      animation: pulse-sweep 1.5s ease-in-out infinite;
    }

    @keyframes pulse-sweep {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
  `;

  constructor() {
    super();
    this.content = '';
    this.role = 'assistant';
    this.mentionedFiles = [];
    this.selectedFiles = [];
    this.editResults = [];
    this.final = true;
    this.streaming = false;
    this._foundFiles = [];  // Files actually found in content
    this._codeScrollPositions = new Map();
    this._cachedContent = null;
    this._cachedResult = null;
    this._cachedFinal = null;
    this._incrementalHtml = '';
    this._incrementalParsedTo = 0;
    this._incrementalFenceOpen = false;
    
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
    // Also check that final status hasn't changed (streaming → complete needs re-processing)
    if (this._cachedContent === this.content && this._cachedResult && this._cachedFinal === this.final) {
      return this._cachedResult;
    }
    
    const isStreaming = !this.final;
    
    // During streaming: skip expensive post-processing (file mentions,
    // copy buttons) which are only useful once complete.
    // Edit blocks ARE rendered progressively for visual continuity.
    if (isStreaming) {
      const hasEditMarker = this.content.includes('««« EDIT');
      if (hasEditMarker) {
        const result = this._processStreamingWithEditBlocks(this.content);
        this._streamCacheSource = this.content;
        this._streamCache = result;
        this._cachedContent = null;
        this._cachedResult = null;
        return result;
      }

      // Incremental markdown parsing: only parse new complete segments
      const result = this._incrementalParse(this.content);
      this._streamCacheSource = this.content;
      this._streamCache = result;
      this._cachedContent = null;
      this._cachedResult = null;
      return result;
    }
    
    // Final render — reuse streaming parse if content unchanged
    this._cachedContent = this.content;
    
    const hasEditBlocks = this.content.includes('««« EDIT');
    let processed;
    
    if (hasEditBlocks) {
      // Edit blocks need structural extraction; must reparse
      processed = this.processContentWithEditBlocks(this.content);
    } else if (this._streamCache && this._streamCacheSource === this.content) {
      // Content unchanged since last streaming chunk — reuse parsed HTML
      processed = this._streamCache;
    } else {
      processed = marked.parse(this.content);
    }
    
    this._streamCache = null;
    this._streamCacheSource = null;
    this._incrementalHtml = '';
    this._incrementalParsedTo = 0;
    this._incrementalFenceOpen = false;
    
    processed = this.wrapCodeBlocksWithCopyButton(processed);
    processed = this.highlightFileMentions(processed);
    this._cachedResult = processed;
    this._cachedFinal = this.final;
    
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



  /**
   * Incremental markdown parsing for streaming.
   * Only parses new complete segments (at safe paragraph/block boundaries)
   * and appends to cached HTML. Trailing incomplete content is rendered
   * as escaped text. The final render always does a full re-parse.
   */
  _incrementalParse(content) {
    // If content was replaced (not appended), reset
    if (this._incrementalParsedTo > 0 && !content.startsWith(content.slice(0, this._incrementalParsedTo))) {
      this._incrementalHtml = '';
      this._incrementalParsedTo = 0;
      this._incrementalFenceOpen = false;
    }

    const unparsed = content.slice(this._incrementalParsedTo);
    const safeSplit = this._findSafeSplit(unparsed);

    if (safeSplit > 0) {
      const segment = unparsed.slice(0, safeSplit);
      this._incrementalHtml += marked.parse(segment);
      this._incrementalParsedTo += safeSplit;
    }

    // Render: cached HTML + raw-escaped tail for unparsed remainder
    const tail = content.slice(this._incrementalParsedTo);
    if (!tail) return this._incrementalHtml;

    const tailHtml = escapeHtml(tail).replace(/\n/g, '<br>');
    return this._incrementalHtml + tailHtml;
  }

  /**
   * Find the last safe split point in text for incremental parsing.
   * A split is safe at a blank-line boundary (paragraph break) where
   * no code fence is open. Returns the index to split at, or 0 if
   * no safe split exists.
   */
  _findSafeSplit(text) {
    let lastSafe = 0;
    let fenceOpen = this._incrementalFenceOpen;
    const lines = text.split('\n');
    let pos = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();

      // Track code fence state
      if (trimmed.startsWith('```')) {
        fenceOpen = !fenceOpen;
      }

      pos += line.length + 1; // +1 for \n

      // A blank line outside a code fence is a safe paragraph boundary
      if (!fenceOpen && trimmed === '' && i > 0) {
        lastSafe = pos;
      }
    }

    // Update fence tracking state only for the portion we'll actually parse
    if (lastSafe > 0) {
      // Recount fences up to lastSafe to get accurate state
      let fenceState = this._incrementalFenceOpen;
      const safePortion = text.slice(0, lastSafe);
      const safeLines = safePortion.split('\n');
      for (const l of safeLines) {
        if (l.trimStart().startsWith('```')) {
          fenceState = !fenceState;
        }
      }
      this._incrementalFenceOpen = fenceState;
    }

    return lastSafe;
  }

  /**
   * Process content during streaming when edit block markers are present.
   * Renders completed edit blocks as diffs (pending status) and shows
   * an in-progress placeholder for any unclosed edit block.
   */
  _processStreamingWithEditBlocks(content) {
    const blocks = parseEditBlocks(content);
    const lines = content.split('\n');

    // Detect if there's an unclosed edit block at the end
    let unclosedFilePath = null;
    const lastEditStart = content.lastIndexOf('««« EDIT');
    const lastEditEnd = content.lastIndexOf('»»» EDIT END');
    if (lastEditStart > lastEditEnd) {
      // There's an unclosed edit block — find the file path
      // (it's on the line before ««« EDIT)
      const beforeMarker = content.slice(0, lastEditStart);
      const beforeLines = beforeMarker.trimEnd().split('\n');
      const pathLine = beforeLines[beforeLines.length - 1]?.trim();
      if (pathLine && !pathLine.startsWith('```') && !pathLine.startsWith('#')) {
        unclosedFilePath = pathLine;
      }
    }

    // Build segments: text, completed edit blocks, and trailing unclosed block
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

    // Handle remaining content after last completed block
    if (lastEnd < lines.length) {
      if (unclosedFilePath !== null) {
        // Find where the unclosed block's file path line starts
        const unclosedStartLine = lines.indexOf(unclosedFilePath, lastEnd);
        if (unclosedStartLine > lastEnd) {
          const textLines = lines.slice(lastEnd, unclosedStartLine);
          segments.push({ type: 'text', content: textLines.join('\n') });
        } else if (unclosedStartLine === -1 && lastEnd < lines.length) {
          // File path wasn't found by simple indexOf — text before unclosed marker
          const markerLine = lines.findIndex((l, i) => i >= lastEnd && l.trim() === '««« EDIT');
          if (markerLine > lastEnd + 1) {
            const textLines = lines.slice(lastEnd, markerLine - 1);
            segments.push({ type: 'text', content: textLines.join('\n') });
          }
        }
        // Extract partial lines inside the unclosed edit block
        const editMarkerLineIdx = lines.findIndex((l, i) => i >= lastEnd && l.trim() === '««« EDIT');
        const partialLines = editMarkerLineIdx !== -1
          ? lines.slice(editMarkerLineIdx + 1)
          : [];
        segments.push({ type: 'in-progress', filePath: unclosedFilePath, partialLines });
      } else {
        const textLines = lines.slice(lastEnd);
        segments.push({ type: 'text', content: textLines.join('\n') });
      }
    }

    // Render segments
    let result = '';
    for (const segment of segments) {
      if (segment.type === 'text') {
        if (segment.content.trim()) {
          result += marked.parse(segment.content);
        }
      } else if (segment.type === 'edit') {
        result += renderEditBlock(segment.block, []);
      } else if (segment.type === 'in-progress') {
        result += renderInProgressEditBlock(segment.filePath, segment.partialLines);
      }
    }

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
    // Save horizontal scroll positions of all code blocks before re-render.
    // Skip during streaming — no user interaction with code blocks yet.
    this._codeScrollPositions.clear();
    if (this.final && this.content?.includes('```')) {
      const codeBlocks = this.shadowRoot?.querySelectorAll('pre');
      if (codeBlocks) {
        codeBlocks.forEach((pre, index) => {
          if (pre.scrollLeft > 0) {
            this._codeScrollPositions.set(index, pre.scrollLeft);
          }
        });
      }
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
    const isFinal = this.final;
    return html`
      <div class="content" @click=${this.handleClick}>
        ${unsafeHTML(processedContent)}
        ${isFinal && this.role === 'assistant' ? unsafeHTML(this.renderEditsSummary()) : ''}
        ${isFinal && this.role === 'assistant' ? unsafeHTML(this.renderFilesSummary()) : ''}
      </div>
    `;
  }
}

customElements.define('card-markdown', CardMarkdown);
