/**
 * Markdown rendering for chat messages.
 *
 * Uses a dedicated Marked instance (markedChat) with highlight.js
 * for syntax highlighting. Separate from the diff viewer's preview renderer.
 */

import { Marked } from 'marked';
import hljs from 'highlight.js/lib/core';

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
 * Render markdown text to HTML for chat messages.
 */
export function renderMarkdown(text) {
  if (!text) return '';
  return markedChat.parse(text);
}