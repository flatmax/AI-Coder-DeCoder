// Markdown rendering for chat messages.
//
// Thin wrapper around the `marked` library with chat-specific
// configuration. Lives in its own module so:
//
//   1. The chat panel doesn't need to know about marked's API
//      directly.
//   2. Syntax highlighting, math rendering, and code-block
//      chrome (copy button, language label) live here once,
//      not scattered through every call site.
//   3. Tests can exercise the renderer in isolation.
//
// Scope:
//   - Fenced code blocks with syntax highlighting via
//     highlight.js (js/ts/python/json/bash/css/html/yaml/c/cpp/
//     diff/md), plus highlightAuto for unspecified language
//   - Code blocks render as `<pre class="code-block">` with a
//     language label and a copy button (the chat panel owns
//     the delegated click handler)
//   - Inline code (`x`)
//   - Paragraphs, headings, bold, italic, GFM tables/task lists
//   - Line breaks within paragraphs (breaks: true)
//   - KaTeX math — `$$...$$` display, `$...$` inline
//
// Not here:
//   - Source-line attributes for preview scroll sync (lives in
//     markdown-preview.js — only used by the diff viewer's
//     Markdown preview pane, needs a different Marked instance)
//   - Custom renderer for edit blocks (the chat panel runs the
//     segmenter before marked sees the content)

import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import katex from 'katex';
import { Marked } from 'marked';

// Register the language set specs call out. hljs.registerLanguage
// overwrites on repeat calls so hot-module reload during
// development is safe. Aliases (sh/shell, js, ts, py, md, yml,
// html) share an implementation with their canonical name.
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);

/**
 * Render a single `$...$` or `$$...$$` math expression to
 * HTML via KaTeX. Parse failures fall back to escaped plain
 * text so a bad formula doesn't crash the whole message —
 * the user sees the raw source with a visual cue that
 * rendering failed.
 */
function _renderMath(src, display) {
  try {
    return katex.renderToString(src, {
      displayMode: display,
      throwOnError: false,
      output: 'htmlAndMathml',
    });
  } catch (err) {
    console.warn('[markdown] katex render failed', err);
    const tag = display ? 'div' : 'code';
    return (
      `<${tag} class="math-error">` +
      escapeHtml(display ? `$$${src}$$` : `$${src}$`) +
      `</${tag}>`
    );
  }
}

// Marked extension implementing `$$...$$` (display) and
// `$...$` (inline). Block-level display math renders at
// paragraph granularity rather than getting wrapped in a <p>.
// Inline math stays on one line with non-whitespace neighbors
// (the usual "dollar as delimiter, not dollar as currency"
// rule).
const _mathExtension = {
  extensions: [
    {
      name: 'displayMath',
      level: 'block',
      start(src) {
        const idx = src.indexOf('$$');
        return idx < 0 ? undefined : idx;
      },
      tokenizer(src) {
        const match = /^\$\$([\s\S]+?)\$\$/.exec(src);
        if (!match) return undefined;
        return {
          type: 'displayMath',
          raw: match[0],
          text: match[1].trim(),
        };
      },
      renderer(token) {
        return _renderMath(token.text, true);
      },
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start(src) {
        const idx = src.indexOf('$');
        return idx < 0 ? undefined : idx;
      },
      tokenizer(src) {
        // Inline math: single-line, no whitespace right
        // after opening `$` or right before closing `$`.
        // Prevents "costs $5 and $10 more" from turning
        // into a math span.
        const match = /^\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$(?!\d)/.exec(src);
        if (!match) return undefined;
        return {
          type: 'inlineMath',
          raw: match[0],
          text: match[1],
        };
      },
      renderer(token) {
        return _renderMath(token.text, false);
      },
    },
  ],
};

/**
 * Build the chat Marked instance with highlighting, math,
 * and the code-block renderer override wired in. Called
 * once at module load; the result is reused for every
 * `renderMarkdown()` call.
 *
 * The `code()` override emits the spec-documented
 * `<pre class="code-block">` shape with a language label
 * and a copy button. The chat panel owns the delegated
 * click handler, so no per-element listeners attach here.
 */
function _makeChatMarked() {
  const instance = new Marked({
    breaks: true,
    gfm: true,
    // Silently degrade on malformed input rather than
    // throwing. A streaming response mid-construction can
    // easily be invalid markdown; render what we can and
    // move on.
    silent: true,
  });
  instance.use(_mathExtension);
  instance.use({
    renderer: {
      code(code, infostring) {
        // Marked 14+ can pass either a token object
        // (`{text, lang}`) or positional args depending on
        // how the renderer is invoked. Normalize.
        let text;
        let lang;
        if (code && typeof code === 'object' && 'text' in code) {
          text = code.text;
          lang = code.lang;
        } else {
          text = code;
          lang = infostring;
        }
        const langName =
          typeof lang === 'string' ? lang.trim().split(/\s+/)[0] : '';
        // Highlighting strategy:
        //   1. Named language registered with hljs →
        //      highlight directly, preserving the requested
        //      class name.
        //   2. Anything else (including empty) →
        //      highlightAuto. The auto-detect uses the
        //      detected language (if any) as the display
        //      label so users see what hljs picked.
        let highlighted;
        let displayLang = langName;
        try {
          if (langName && hljs.getLanguage(langName)) {
            highlighted = hljs.highlight(text, {
              language: langName,
              ignoreIllegals: true,
            }).value;
          } else {
            const auto = hljs.highlightAuto(text);
            highlighted = auto.value;
            if (!displayLang) displayLang = auto.language || '';
          }
        } catch (err) {
          // Pathological input can trip hljs in rare cases.
          // Fall back to escaped plain text so the user still
          // sees their code, just without coloring.
          console.warn('[markdown] hljs failed', err);
          highlighted = escapeHtml(text);
        }
        const label = displayLang
          ? `<span class="code-lang">${escapeHtml(displayLang)}</span>`
          : '';
        // Copy button is always present so the delegated
        // click handler has a consistent target. CSS fades
        // it in on hover to avoid streaming flicker.
        const copyBtn =
          '<button type="button" class="copy-code-button" ' +
          'aria-label="Copy code" title="Copy">📋</button>';
        const codeClass = displayLang
          ? `hljs language-${escapeHtml(displayLang)}`
          : 'hljs';
        return (
          '<pre class="code-block">' +
          label +
          copyBtn +
          `<code class="${codeClass}">${highlighted}</code>` +
          '</pre>'
        );
      },
    },
  });
  return instance;
}

const marked = _makeChatMarked();

/**
 * Render a markdown string to an HTML string.
 *
 * Returns an HTML string, not a DOM node. Callers that need to
 * insert it into a Lit template should use `unsafeHTML` from
 * `lit/directives/unsafe-html.js` — we trust the content
 * because it comes from the LLM, not from user-crafted input
 * that could inject scripts. (The LLM can in principle output
 * HTML tags, but `marked` escapes them by default unless they
 * appear inside a code fence, and the code-fence case renders
 * as literal text via <code>.)
 *
 * Empty or null input returns the empty string — callers don't
 * need to guard against these cases.
 */
export function renderMarkdown(text) {
  if (!text) return '';
  try {
    return marked.parse(text);
  } catch (err) {
    // `marked` with `silent: true` shouldn't throw, but if it
    // does (malformed input, internal bug) we fall back to an
    // escaped plain-text rendering rather than showing a raw
    // Error object or crashing the chat.
    console.warn('[markdown] parse failed, falling back to plain', err);
    return escapeHtml(text);
  }
}

/**
 * Escape HTML special characters in a string.
 *
 * Used for the fallback path when markdown rendering fails, and
 * exported so the chat panel can render raw user input safely
 * (user messages are shown verbatim, not markdown-rendered, per
 * specs4 — users typed what they typed, we shouldn't
 * reinterpret it).
 */
export function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}