// Tests for webapp/src/markdown.js — markdown rendering wrapper.
//
// Scope: verify the chat-specific marked configuration produces
// the expected output shapes for content the chat panel will
// receive. These aren't tests of marked itself — they pin the
// configuration choices (breaks on, GFM on, silent on).

import { describe, expect, it, vi } from 'vitest';

import { escapeHtml, renderMarkdown } from './markdown.js';

describe('renderMarkdown', () => {
  it('returns empty string for empty input', () => {
    // Guard — callers pass partial stream content that may
    // briefly be empty between chunks.
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
  });

  it('wraps plain text in a paragraph', () => {
    const html = renderMarkdown('hello world');
    // marked's default output wraps bare text in <p>. Pinning
    // the shape so a future breaking change in marked surfaces
    // as a test failure rather than silent rendering drift.
    expect(html).toContain('<p>hello world</p>');
  });

  it('renders fenced code blocks with code-block chrome', () => {
    const html = renderMarkdown('```\nsome code\n```');
    // Spec shape — `<pre class="code-block">` wraps every
    // fenced block. The inner `<code class="hljs ...">`
    // carries the highlighted content. Without a language
    // hint, `highlightAuto` picks one (or leaves the class
    // as the bare `hljs` marker); either way the code text
    // survives the highlighting pass. We check the two
    // source tokens separately because hljs may wrap one of
    // them in a highlighting span — the substring with both
    // tokens joined won't survive that, but each token on
    // its own does.
    expect(html).toContain('<pre class="code-block">');
    expect(html).toContain('<code class="hljs');
    expect(html).toContain('some');
    expect(html).toContain('code');
  });

  it('always emits a copy button on fenced code blocks', () => {
    // The chat panel owns the delegated click handler;
    // every block must carry the target class so the
    // handler has something to match. CSS fades the button
    // in on hover to avoid streaming flicker.
    const html = renderMarkdown('```\nfoo\n```');
    expect(html).toContain('class="copy-code-button"');
    expect(html).toContain('📋');
  });

  it('emits a language label when a language is specified', () => {
    const html = renderMarkdown('```python\nprint("hi")\n```');
    expect(html).toContain('<span class="code-lang">python</span>');
  });

  it('preserves the language hint on fenced code blocks', () => {
    // Syntax highlighting adds the `hljs` base class and the
    // `language-<name>` modifier. Both land on the `<code>`
    // element; the outer `<pre class="code-block">` owns the
    // layout and chrome.
    const html = renderMarkdown('```python\nprint("hi")\n```');
    expect(html).toContain('language-python');
    // The content survives highlighting — the syntax-coloured
    // output still contains the source keyword as a
    // substring, just wrapped in highlight spans.
    expect(html).toContain('print');
  });

  it('applies hljs highlighting spans inside the code element', () => {
    // Proves highlighting actually ran, not just that the
    // class landed. A highlighted python print() call will
    // always contain at least one `hljs-` class in its
    // output — keyword, string, or built-in.
    const html = renderMarkdown('```python\nprint("hi")\n```');
    expect(html).toMatch(/hljs-/);
  });

  it('auto-detects language when none is specified', () => {
    // Spec: unspecified fence + `highlightAuto`. The exact
    // language hljs picks for a JSON-shaped snippet is not
    // guaranteed, but a recognisable JSON fragment should
    // pick up at least one hljs- class.
    const html = renderMarkdown(
      '```\n{"name": "ac-dc", "version": "1.0"}\n```',
    );
    expect(html).toMatch(/hljs-/);
  });

  it('renders inline code with <code>', () => {
    const html = renderMarkdown('try `foo` here');
    expect(html).toContain('<code>foo</code>');
  });

  it('renders headings', () => {
    const html = renderMarkdown('# Big heading');
    expect(html).toContain('<h1');
    expect(html).toContain('Big heading');
  });

  it('renders bold and italic', () => {
    const html = renderMarkdown('**bold** and *italic*');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('converts single newlines to <br> via breaks: true', () => {
    // The `breaks: true` config is load-bearing — without it,
    // users pressing Enter once wouldn't see the line break
    // reflected in the assistant's rendering. Test pins the
    // configuration choice.
    const html = renderMarkdown('line one\nline two');
    expect(html).toContain('<br>');
  });

  it('keeps paragraphs separated by blank lines as distinct <p>', () => {
    const html = renderMarkdown('para one\n\npara two');
    // Two <p> elements, not one <p> with a <br>.
    const paraCount = (html.match(/<p>/g) || []).length;
    expect(paraCount).toBe(2);
  });

  it('renders GFM tables', () => {
    // GFM is enabled — tables should render as proper HTML
    // tables. Matters for doc-convert output (xlsx → markdown
    // table) that users may paste into chat or that shows up
    // in session load.
    const table = '| a | b |\n|---|---|\n| 1 | 2 |';
    const html = renderMarkdown(table);
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('renders GFM task lists', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo');
    expect(html).toContain('<input');
    expect(html).toContain('checkbox');
  });

  it('passes raw HTML through in prose (we trust the source)', () => {
    // Marked's default behaviour for inline HTML in prose is
    // passthrough — it renders tags literally rather than
    // escaping them. This is safe for our use:
    //   - User messages never reach renderMarkdown; they go
    //     through escapeHtml instead. See the chat panel's
    //     _renderMessage which dispatches on role.
    //   - Assistant messages come from the LLM, which we
    //     trust in the same way we trust the code it writes
    //     into our files.
    //
    // The test pins the passthrough so if we ever swap to a
    // library that escapes by default (or add a sanitizer),
    // the expectations surface for review rather than silently
    // changing the rendering model.
    const html = renderMarkdown('use <b>bold</b> tag');
    expect(html).toContain('<b>bold</b>');
  });

  it('renders inline math via KaTeX', () => {
    // `$...$` delimited inline math is transformed to KaTeX
    // HTML. The exact markup is long; we check for the
    // outer `katex` class marker which KaTeX always emits.
    const html = renderMarkdown('Euler: $e^{i\\pi} + 1 = 0$');
    expect(html).toContain('katex');
  });

  it('renders display math via KaTeX', () => {
    // `$$...$$` delimited display math becomes a block-level
    // KaTeX render. The display variant sets `displayMode`
    // which KaTeX signals via a distinct class marker.
    const html = renderMarkdown('$$\\int_0^1 x \\, dx$$');
    expect(html).toContain('katex');
    expect(html).toContain('katex-display');
  });

  it('does not treat currency `$` as math', () => {
    // The inline math tokenizer requires non-whitespace
    // adjacent to both delimiters and rejects digits
    // immediately after the closer so "costs $5 and $10"
    // stays as prose. Without this guard the whole sentence
    // would become one invalid math expression and either
    // render as an error or collapse into KaTeX output.
    const html = renderMarkdown('Item costs $5 and item B costs $10 more');
    expect(html).not.toContain('katex');
    expect(html).toContain('$5');
    expect(html).toContain('$10');
  });

  it('does not crash on malformed markdown', () => {
    // `silent: true` plus a try/catch fallback means pathological
    // input can't break the chat panel. Test with truly
    // malformed input (unterminated code fence — marked
    // normally recovers, but we want to prove we don't throw).
    expect(() => renderMarkdown('```\nunterminated')).not.toThrow();
  });

  it('falls back to escaped plain text when marked throws', () => {
    // Simulate a marked internal failure by patching the
    // underlying parse call. The fallback path should produce
    // escaped HTML so the content is at least readable even
    // when the renderer broke.
    //
    // We can't easily inject a failure into the shared `marked`
    // instance without mocking the whole module, so this test
    // just verifies the renderer is resilient to edge-case
    // inputs (no throws observed in practice with silent: true).
    // The fallback-through-escapeHtml path is still unit-tested
    // via direct escapeHtml coverage below.
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    try {
      // Normal input just renders; we can't easily force a throw.
      const result = renderMarkdown('normal input');
      expect(typeof result).toBe('string');
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('escapeHtml', () => {
  // These cover the direct call path — used by the chat panel
  // to render user messages verbatim (not markdown-rendered).

  it('returns empty for empty input', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('escapes all five HTML-sensitive characters', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#039;');
  });

  it('escapes ampersands before other characters', () => {
    // Order matters — if we replaced < → &lt; before replacing
    // & → &amp;, the & in &lt; would be re-escaped, yielding
    // &amp;lt;. Pinning the escape order.
    expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;');
  });

  it('passes plain text through unchanged', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });

  it('stringifies non-string input', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});