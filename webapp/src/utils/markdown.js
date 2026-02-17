/**
 * Markdown rendering with syntax highlighting.
 * Wraps 'marked' with highlight.js for code blocks.
 */
import { Marked } from 'marked';
import hljs from 'highlight.js/lib/core';

// Register commonly needed languages
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import cssLang from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import diff from 'highlight.js/lib/languages/diff';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('css', cssLang);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code(token) {
      // marked v12: token may be a string or an object with {text, lang}
      let text, lang;
      if (typeof token === 'string') {
        text = token;
        lang = '';
      } else {
        text = token.text || '';
        lang = (token.lang || '').trim();
      }
      const language = lang && hljs.getLanguage(lang) ? lang : null;
      let highlighted;
      if (language) {
        try {
          highlighted = hljs.highlight(text, { language }).value;
        } catch (_) {
          highlighted = escapeHtml(text);
        }
      } else {
        // No language specified — try auto-detection
        try {
          const autoResult = hljs.highlightAuto(text);
          highlighted = autoResult.value;
        } catch (_) {
          highlighted = escapeHtml(text);
        }
      }
      const langLabel = language ? `<span class="code-lang">${language}</span>` : '';
      const copyBtn = `<button class="code-copy-btn" title="Copy code">📋</button>`;
      return `<pre class="code-block">${langLabel}${copyBtn}<code class="hljs${language ? ` language-${language}` : ''}">${highlighted}</code></pre>`;
    },
  },
});

/**
 * Render markdown to HTML string.
 * Safe for LLM output — uses highlight.js for code blocks.
 */
export function renderMarkdown(text) {
  if (!text) return '';
  try {
    return marked.parse(text);
  } catch (e) {
    console.warn('Markdown parse error:', e);
    return `<pre>${escapeHtml(text)}</pre>`;
  }
}

// ---------------------------------------------------------------------------
// Source-map-aware rendering for synchronized scroll in preview mode.
//
// Problem 1 fix: marked v12 doesn't preserve custom properties on tokens
// passed to renderer callbacks. Instead we use a side-channel Map keyed by
// a prefix + token text, populated during the lexer phase, and looked up
// inside the renderer.
// ---------------------------------------------------------------------------

function _buildLineMap(src) {
  const lineMap = new Map();
  const lines = src.split('\n');
  let lineNum = 0;

  // Walk the raw source and record the first occurrence of each token-text
  // at its starting line.  We use type prefixes to disambiguate headings
  // from paragraphs that happen to share content.
  const tokens = markedSourceMap.lexer(src);
  for (const tok of tokens) {
    // tokens carry a `raw` property whose leading newlines tell us the
    // approximate source line.
    if (tok.raw) {
      // Count newlines preceding this token in the source
      const idx = src.indexOf(tok.raw, 0);
      if (idx !== -1) {
        lineNum = src.slice(0, idx).split('\n').length;
      }
    }
    const key = _tokenKey(tok);
    if (key && !lineMap.has(key)) {
      lineMap.set(key, lineNum);
    }
  }
  return lineMap;
}

function _tokenKey(tok) {
  if (!tok || !tok.text) return null;
  const prefix = tok.type || 'p';
  return prefix + ':' + tok.text.slice(0, 120);
}

const markedSourceMap = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code(token) {
      // Re-use the same highlighting logic as the main renderer
      let text, lang;
      if (typeof token === 'string') {
        text = token;
        lang = '';
      } else {
        text = token.text || '';
        lang = (token.lang || '').trim();
      }
      const language = lang && hljs.getLanguage(lang) ? lang : null;
      let highlighted;
      if (language) {
        try {
          highlighted = hljs.highlight(text, { language }).value;
        } catch (_) {
          highlighted = escapeHtml(text);
        }
      } else {
        try {
          highlighted = hljs.highlightAuto(text).value;
        } catch (_) {
          highlighted = escapeHtml(text);
        }
      }
      // Look up source line from the side-channel map
      const key = 'code:' + text.slice(0, 120);
      const line = _currentLineMap?.get(key) ?? '';
      const attr = line !== '' ? ` data-source-line="${line}"` : '';
      return `<pre class="code-block"${attr}><code class="hljs${language ? ` language-${language}` : ''}">${highlighted}</code></pre>`;
    },
    heading(token) {
      const text = typeof token === 'string' ? token : (token.text || '');
      const depth = (typeof token === 'object' ? token.depth : 2) || 2;
      const key = 'heading:' + text.slice(0, 120);
      const line = _currentLineMap?.get(key) ?? '';
      const attr = line !== '' ? ` data-source-line="${line}"` : '';
      // Render inline content — marked provides `tokens` for inline parsing
      let inner;
      if (typeof token === 'object' && token.tokens) {
        inner = markedSourceMap.parser.parseInline(token.tokens);
      } else {
        inner = text;
      }
      return `<h${depth}${attr}>${inner}</h${depth}>\n`;
    },
    paragraph(token) {
      const text = typeof token === 'string' ? token : (token.text || '');
      const key = 'paragraph:' + text.slice(0, 120);
      const line = _currentLineMap?.get(key) ?? '';
      const attr = line !== '' ? ` data-source-line="${line}"` : '';
      let inner;
      if (typeof token === 'object' && token.tokens) {
        inner = markedSourceMap.parser.parseInline(token.tokens);
      } else {
        inner = text;
      }
      return `<p${attr}>${inner}</p>\n`;
    },
    list(token) {
      const items = typeof token === 'object' ? token.items : [];
      const ordered = typeof token === 'object' ? token.ordered : false;
      const tag = ordered ? 'ol' : 'ul';
      const body = items.map(item => {
        const itemText = typeof item === 'string' ? item : (item.text || '');
        const key = 'list_item:' + itemText.slice(0, 120);
        const line = _currentLineMap?.get(key) ?? '';
        const attr = line !== '' ? ` data-source-line="${line}"` : '';
        let inner;
        if (typeof item === 'object' && item.tokens) {
          inner = markedSourceMap.parser.parseInline(item.tokens);
        } else {
          inner = itemText;
        }
        return `<li${attr}>${inner}</li>\n`;
      }).join('');
      return `<${tag}>${body}</${tag}>\n`;
    },
    blockquote(token) {
      const text = typeof token === 'string' ? token : (token.text || '');
      const key = 'blockquote:' + text.slice(0, 120);
      const line = _currentLineMap?.get(key) ?? '';
      const attr = line !== '' ? ` data-source-line="${line}"` : '';
      let inner;
      if (typeof token === 'object' && token.tokens) {
        inner = markedSourceMap.parser.parse(token.tokens);
      } else {
        inner = `<p>${text}</p>`;
      }
      return `<blockquote${attr}>${inner}</blockquote>\n`;
    },
    hr() {
      return `<hr data-source-line="">\n`;
    },
    table(token) {
      const text = typeof token === 'string' ? token : (token.text || '');
      const key = 'table:' + (text || '').slice(0, 120);
      const line = _currentLineMap?.get(key) ?? '';
      const attr = line !== '' ? ` data-source-line="${line}"` : '';
      // Fall back to default rendering for the body
      if (typeof token === 'object' && token.header && token.rows) {
        const headerCells = token.header.map((cell, i) => {
          const align = token.align?.[i] ? ` align="${token.align[i]}"` : '';
          const cellInner = cell.tokens ? markedSourceMap.parser.parseInline(cell.tokens) : (cell.text || '');
          return `<th${align}>${cellInner}</th>`;
        }).join('');
        const bodyRows = token.rows.map(row =>
          '<tr>' + row.map((cell, i) => {
            const align = token.align?.[i] ? ` align="${token.align[i]}"` : '';
            const cellInner = cell.tokens ? markedSourceMap.parser.parseInline(cell.tokens) : (cell.text || '');
            return `<td${align}>${cellInner}</td>`;
          }).join('') + '</tr>'
        ).join('\n');
        return `<table${attr}><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>\n`;
      }
      return `<table${attr}>${text}</table>\n`;
    },
  },
});

// Module-level variable set during renderMarkdownWithSourceMap calls
let _currentLineMap = null;

/**
 * Render markdown to HTML with data-source-line attributes on block elements.
 * Used by the diff-viewer preview mode for synchronized scrolling.
 *
 * @param {string} text - Markdown source
 * @returns {string} HTML with data-source-line attributes
 */
export function renderMarkdownWithSourceMap(text) {
  if (!text) return '';
  try {
    _currentLineMap = _buildLineMap(text);
    const html = markedSourceMap.parse(text);
    _currentLineMap = null;
    return html;
  } catch (e) {
    _currentLineMap = null;
    console.warn('Markdown source-map parse error:', e);
    return `<pre>${escapeHtml(text)}</pre>`;
  }
}