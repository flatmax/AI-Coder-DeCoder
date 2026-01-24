import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { marked } from 'marked';
import './PrismSetup.js';

export class CardMarkdown extends LitElement {
  static properties = {
    content: { type: String },
    role: { type: String },
    mentionedFiles: { type: Array }
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
    
    // Pre-process to protect search/replace markers from markdown parsing
    let content = this.protectSearchReplaceBlocks(this.content);
    
    let processed = marked.parse(content);
    processed = this.wrapCodeBlocksWithCopyButton(processed);
    processed = this.highlightFileMentions(processed);
    return processed;
  }

  protectSearchReplaceBlocks(content) {
    // Find code blocks and ensure search/replace markers inside them are preserved
    // The issue is that >>>>>>> can be interpreted as nested blockquotes
    // We need to ensure code fences are properly closed before markers appear outside
    
    // Also protect standalone markers that might appear during streaming
    // before the full code block is received
    const lines = content.split('\n');
    const result = [];
    let inCodeBlock = false;
    let codeBlockLang = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Check for code fence start/end
      if (trimmed.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockLang = trimmed.slice(3);
        } else {
          inCodeBlock = false;
          codeBlockLang = '';
        }
        result.push(line);
        continue;
      }
      
      // If we're outside a code block and see SEARCH/REPLACE markers,
      // they're likely part of an incomplete streaming response
      // Wrap them to prevent markdown interpretation
      if (!inCodeBlock) {
        if (trimmed === '<<<<<<< SEARCH' || 
            trimmed === '=======' || 
            trimmed === '>>>>>>> REPLACE') {
          result.push('`' + line + '`');
          continue;
        }
        // Also catch lines starting with >>>>>>> which markdown treats as blockquotes
        if (trimmed.startsWith('>>>>>>>')) {
          result.push('`' + line + '`');
          continue;
        }
      }
      
      result.push(line);
    }
    
    return result.join('\n');
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
    
    // Sort by length descending to match longer paths first
    const sortedFiles = [...this.mentionedFiles].sort((a, b) => b.length - a.length);
    
    for (const filePath of sortedFiles) {
      // Escape special regex characters in the file path
      const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Match the file path but not if it's already inside an HTML tag or anchor
      // Also avoid matching inside code blocks (already processed)
      const regex = new RegExp(`(?<!<[^>]*)(?<!class=")\\b(${escaped})\\b(?![^<]*>)`, 'g');
      
      result = result.replace(regex, `<span class="file-mention" data-file="${filePath}">$1</span>`);
    }
    
    return result;
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
  }

  render() {
    return html`
      <div class="content" @click=${this.handleClick}>
        ${unsafeHTML(this.processContent())}
      </div>
    `;
  }
}

customElements.define('card-markdown', CardMarkdown);
