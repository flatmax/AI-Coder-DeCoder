/**
 * Markdown rendering for chat messages.
 *
 * Uses a dedicated Marked instance (markedChat) with highlight.js
 * for syntax highlighting. Separate from the diff viewer's preview renderer.
 */

import { Marked } from 'marked';
import hljs from 'highlight.js/lib/core';

// For diff viewer preview — source-line aware rendering (lazily initialized)
let markedSourceMap = null;

// Register languages for syntax highlighting
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
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
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);

/**
 * Chat markdown renderer — only overrides code() for syntax highlighting.
 * All other block elements use marked's built-in defaults.
 */
const markedChat = new Marked({
  gfm: true,
  breaks: true,
});

markedChat.use({
  renderer: {
    code({ text, lang }) {
      let highlighted;
      const langLabel = lang || '';

      if (lang && hljs.getLanguage(lang)) {
        try {
          highlighted = hljs.highlight(text, { language: lang }).value;
        } catch (_) {
          highlighted = _escapeHtml(text);
        }
      } else if (!lang) {
        try {
          highlighted = hljs.highlightAuto(text).value;
        } catch (_) {
          highlighted = _escapeHtml(text);
        }
      } else {
        highlighted = _escapeHtml(text);
      }

      return `<pre class="code-block"><span class="code-lang">${_escapeHtml(langLabel)}</span><button class="copy-btn" title="Copy">📋</button><code class="hljs">${highlighted}</code></pre>`;
    },
  },
});

function _escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Encode spaces in image paths so marked can parse them.
 * Applied before passing text to either marked instance.
 */
function _encodeImagePaths(text) {
  return text.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, url) => {
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
        return match;
      }
      if (!url.includes(' ')) return match;
      const encoded = url.replace(/ /g, '%20');
      return `![${alt}](${encoded})`;
    }
  );
}

/**
 * Render markdown text to HTML for chat messages.
 */
export function renderMarkdown(text) {
  if (!text) return '';
  return markedChat.parse(_encodeImagePaths(text));
}

/**
 * Build a line map from raw markdown source for scroll sync.
 */
function _buildLineMap(source) {
  const lineMap = new Map();
  const lines = source.split('\n');
  let inCodeBlock = false;
  let codeIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      if (inCodeBlock) {
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        lineMap.set(`code:${codeIdx}`, i);
        codeIdx++;
      }
      continue;
    }
    if (inCodeBlock) continue;

    if (/^#{1,6}\s+/.test(trimmed)) {
      const text = trimmed.replace(/^#{1,6}\s+/, '').trim();
      const key = `heading:${text.substring(0, 40)}`;
      if (!lineMap.has(key)) lineMap.set(key, i);
    } else if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      lineMap.set(`hr:${i}`, i);
    } else if (trimmed && !/^[|>\-*+]/.test(trimmed) && !/^\d+\./.test(trimmed)) {
      const key = `paragraph:${trimmed.substring(0, 40)}`;
      if (!lineMap.has(key)) lineMap.set(key, i);
    }
  }
  return lineMap;
}

/**
 * Render markdown with data-source-line attributes for scroll sync.
 * Used by the diff viewer's markdown preview panel.
 */
export function renderMarkdownWithSourceMap(source) {
  if (!source) return '';

  if (!markedSourceMap) {
    markedSourceMap = new Marked({ gfm: true, breaks: true });

    let _sourceLineQueue = [];
    let _codeBlockIndex = -1;

    markedSourceMap.use({
      renderer: {
        code({ text, lang }) {
          let highlighted;
          const langLabel = lang || '';
          if (lang && hljs.getLanguage(lang)) {
            try { highlighted = hljs.highlight(text, { language: lang }).value; }
            catch (_) { highlighted = _escapeHtml(text); }
          } else if (!lang) {
            try { highlighted = hljs.highlightAuto(text).value; }
            catch (_) { highlighted = _escapeHtml(text); }
          } else {
            highlighted = _escapeHtml(text);
          }
          const lineAttr = _codeBlockIndex >= 0 ? ` data-source-line="${_codeBlockIndex}"` : '';
          _codeBlockIndex = -1;
          return `<pre class="code-block"${lineAttr}><span class="code-lang">${_escapeHtml(langLabel)}</span><code class="hljs">${highlighted}</code></pre>`;
        },
        hr() {
          const line = _sourceLineQueue.shift();
          const attr = line != null ? ` data-source-line="${line}"` : '';
          return `<hr${attr}>`;
        },
      },
      hooks: {
        preprocess(src) {
          _sourceLineQueue = [];
          _codeBlockIndex = -1;
          return src;
        },
        postprocess(htmlOut) {
          let queueIdx = 0;
          return htmlOut.replace(
            /(<(?:h[1-6]|p|blockquote|table|ul|ol)(?:\s[^>]*)?)>/g,
            (match, tag) => {
              if (match.includes('data-source-line')) return match;
              if (queueIdx < _sourceLineQueue.length) {
                const line = _sourceLineQueue[queueIdx++];
                if (line != null) return `${tag} data-source-line="${line}">`;
              }
              return match;
            }
          );
        },
      },
      walkTokens(token) {
        if (token.type === 'heading' || token.type === 'paragraph' ||
            token.type === 'blockquote' || token.type === 'table' ||
            token.type === 'list') {
          let foundLine = null;
          if (token.type === 'heading') {
            const text = (token.text || '').substring(0, 40);
            foundLine = markedSourceMap._lineMap?.get(`heading:${text}`);
          } else if (token.type === 'paragraph') {
            const prefix = (token.raw || '').trim().substring(0, 40);
            foundLine = markedSourceMap._lineMap?.get(`paragraph:${prefix}`);
          }
          _sourceLineQueue.push(foundLine ?? null);
        } else if (token.type === 'code') {
          const idx = markedSourceMap._nextCodeIdx ?? 0;
          _codeBlockIndex = markedSourceMap._lineMap?.get(`code:${idx}`) ?? -1;
          markedSourceMap._nextCodeIdx = idx + 1;
        } else if (token.type === 'hr') {
          for (const [k, v] of (markedSourceMap._lineMap || new Map())) {
            if (k.startsWith('hr:')) {
              _sourceLineQueue.push(v);
              markedSourceMap._lineMap.delete(k);
              return;
            }
          }
          _sourceLineQueue.push(null);
        }
      },
    });
  }

  markedSourceMap._lineMap = _buildLineMap(source);
  markedSourceMap._nextCodeIdx = 0;

  return markedSourceMap.parse(_encodeImagePaths(source));
}