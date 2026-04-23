// Tests for markdown-preview.js — pure rendering core
// for the diff viewer's preview pane.
//
// No DOM, no Monaco — these tests exercise the functions
// in isolation. Scope:
//
//   - `encodeImagePaths` — space encoding in image URLs
//   - `normalizePath` / `resolveRelativePath` — path math
//   - `buildSourceLineMap` — token → line-number mapping
//   - `renderMarkdownWithSourceMap` — full pipeline with
//     data-source-line attribute injection
//
// KaTeX math rendering is covered lightly — we check that
// `$$...$$` and `$...$` produce some output without
// asserting on the specific HTML (which depends on KaTeX
// version).

import { describe, expect, it } from 'vitest';

import {
  buildSourceLineMap,
  encodeImagePaths,
  normalizePath,
  renderMarkdownWithSourceMap,
  resolveRelativePath,
} from './markdown-preview.js';

// -------------------------------------------------------
// encodeImagePaths
// -------------------------------------------------------

describe('encodeImagePaths', () => {
  it('encodes spaces in relative image paths', () => {
    const out = encodeImagePaths('![alt](path with spaces.png)');
    expect(out).toBe('![alt](path%20with%20spaces.png)');
  });

  it('leaves already-encoded URLs alone', () => {
    const out = encodeImagePaths('![a](already%20encoded.png)');
    expect(out).toBe('![a](already%20encoded.png)');
  });

  it('leaves http and https URLs unchanged', () => {
    const http = encodeImagePaths(
      '![a](http://example.com/img with space.png)',
    );
    expect(http).toBe(
      '![a](http://example.com/img with space.png)',
    );
  });

  it('leaves data URIs unchanged', () => {
    const uri = 'data:image/png;base64,iVBORw0KGgo=';
    const out = encodeImagePaths(`![a](${uri})`);
    expect(out).toBe(`![a](${uri})`);
  });

  it('does not touch non-image links', () => {
    const out = encodeImagePaths('[text](path with space.md)');
    expect(out).toBe('[text](path with space.md)');
  });

  it('handles multiple images in one document', () => {
    const src =
      '![a](one two.png) and ![b](three four.jpg)';
    const out = encodeImagePaths(src);
    expect(out).toBe(
      '![a](one%20two.png) and ![b](three%20four.jpg)',
    );
  });

  it('tolerates non-string input', () => {
    expect(encodeImagePaths(null)).toBe(null);
    expect(encodeImagePaths(undefined)).toBe(undefined);
    expect(encodeImagePaths(42)).toBe(42);
  });

  it('returns empty string for empty input', () => {
    expect(encodeImagePaths('')).toBe('');
  });

  it('does not alter alt text (only URL)', () => {
    const out = encodeImagePaths('![alt with spaces](x.png)');
    expect(out).toBe('![alt with spaces](x.png)');
  });
});

// -------------------------------------------------------
// normalizePath
// -------------------------------------------------------

describe('normalizePath', () => {
  it('passes through a simple path', () => {
    expect(normalizePath('a/b/c.md')).toBe('a/b/c.md');
  });

  it('collapses ./ segments', () => {
    expect(normalizePath('./a/./b.md')).toBe('a/b.md');
  });

  it('resolves ../ segments', () => {
    expect(normalizePath('a/b/../c.md')).toBe('a/c.md');
  });

  it('resolves multiple ../ segments', () => {
    expect(normalizePath('a/b/c/../../d.md')).toBe('a/d.md');
  });

  it('preserves leading ../ when going above root', () => {
    expect(normalizePath('../a/b.md')).toBe('../a/b.md');
  });

  it('collapses empty segments from double slashes', () => {
    expect(normalizePath('a//b.md')).toBe('a/b.md');
  });

  it('returns empty for empty input', () => {
    expect(normalizePath('')).toBe('');
  });

  it('tolerates non-string input', () => {
    expect(normalizePath(null)).toBe('');
    expect(normalizePath(undefined)).toBe('');
  });
});

// -------------------------------------------------------
// resolveRelativePath
// -------------------------------------------------------

describe('resolveRelativePath', () => {
  it('resolves against the base file directory', () => {
    expect(
      resolveRelativePath('docs/spec.md', 'image.png'),
    ).toBe('docs/image.png');
  });

  it('handles parent-directory references', () => {
    expect(
      resolveRelativePath('docs/spec.md', '../root.md'),
    ).toBe('root.md');
  });

  it('handles nested parent references', () => {
    expect(
      resolveRelativePath(
        'a/b/c/spec.md',
        '../../d.md',
      ),
    ).toBe('a/d.md');
  });

  it('leaves absolute URLs unchanged', () => {
    expect(
      resolveRelativePath('docs/spec.md', 'https://x/y.png'),
    ).toBe('https://x/y.png');
    expect(
      resolveRelativePath('docs/spec.md', 'http://x.png'),
    ).toBe('http://x.png');
  });

  it('leaves fragment-only refs unchanged', () => {
    expect(
      resolveRelativePath('docs/spec.md', '#section'),
    ).toBe('#section');
  });

  it('leaves data URIs unchanged', () => {
    expect(
      resolveRelativePath('a.md', 'data:image/png;base64,x'),
    ).toBe('data:image/png;base64,x');
  });

  it('handles base file in repo root', () => {
    expect(
      resolveRelativePath('README.md', 'docs/foo.md'),
    ).toBe('docs/foo.md');
  });

  it('tolerates non-string rel', () => {
    expect(resolveRelativePath('a.md', null)).toBe(null);
    expect(resolveRelativePath('a.md', '')).toBe('');
  });
});

// -------------------------------------------------------
// buildSourceLineMap
// -------------------------------------------------------

describe('buildSourceLineMap', () => {
  it('returns empty map for empty input', () => {
    expect(buildSourceLineMap('').size).toBe(0);
    expect(buildSourceLineMap(null).size).toBe(0);
  });

  it('maps heading to its source line', () => {
    const src = '\n# Title\n\ntext';
    const map = buildSourceLineMap(src);
    // Heading on line 2.
    const entries = [...map.entries()];
    const heading = entries.find(([k]) =>
      k.startsWith('heading:'),
    );
    expect(heading).toBeDefined();
    expect(heading[1]).toBe(2);
  });

  it('maps multiple headings in document order', () => {
    const src = '# One\n\n## Two\n\n### Three\n';
    const map = buildSourceLineMap(src);
    expect(map.get('heading:# One')).toBe(1);
    expect(map.get('heading:## Two')).toBe(3);
    expect(map.get('heading:### Three')).toBe(5);
  });

  it('maps paragraphs to their source lines', () => {
    const src = '# Title\n\nFirst paragraph.\n\nSecond one.';
    const map = buildSourceLineMap(src);
    const paragraphs = [...map.entries()].filter(([k]) =>
      k.startsWith('paragraph:'),
    );
    expect(paragraphs).toHaveLength(2);
    // First paragraph on line 3, second on line 5.
    const lines = paragraphs.map(([, v]) => v).sort();
    expect(lines).toEqual([3, 5]);
  });

  it('maps code blocks', () => {
    const src = '```js\nconst x = 1;\n```';
    const map = buildSourceLineMap(src);
    const code = [...map.keys()].find((k) =>
      k.startsWith('code:'),
    );
    expect(code).toBeDefined();
    expect(map.get(code)).toBe(1);
  });

  it('maps horizontal rules', () => {
    const src = 'above\n\n---\n\nbelow';
    const map = buildSourceLineMap(src);
    const hr = [...map.keys()].find((k) =>
      k.startsWith('hr:'),
    );
    expect(hr).toBeDefined();
    expect(map.get(hr)).toBe(3);
  });
});

// -------------------------------------------------------
// renderMarkdownWithSourceMap
// -------------------------------------------------------

describe('renderMarkdownWithSourceMap', () => {
  it('returns empty string for empty input', () => {
    expect(renderMarkdownWithSourceMap('')).toBe('');
    expect(renderMarkdownWithSourceMap(null)).toBe('');
  });

  it('renders simple paragraphs', () => {
    const html = renderMarkdownWithSourceMap('Hello world.');
    expect(html).toContain('<p');
    expect(html).toContain('Hello world.');
    expect(html).toContain('</p>');
  });

  it('injects data-source-line on headings', () => {
    const html = renderMarkdownWithSourceMap('# Title');
    expect(html).toContain('data-source-line="1"');
    expect(html).toContain('<h1');
    expect(html).toContain('Title');
  });

  it('injects distinct source lines on multiple headings', () => {
    const html = renderMarkdownWithSourceMap(
      '# One\n\n# Two\n',
    );
    // Both headings should have data-source-line, with
    // different values.
    expect(html).toContain('data-source-line="1"');
    expect(html).toContain('data-source-line="3"');
  });

  it('injects source line on paragraphs', () => {
    const html = renderMarkdownWithSourceMap(
      '# Heading\n\nParagraph content.',
    );
    // Both the h1 and the p should have source-line.
    const matches = html.match(/data-source-line="\d+"/g);
    expect(matches).toBeTruthy();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('injects source line on code blocks', () => {
    const html = renderMarkdownWithSourceMap(
      '```js\nconst x = 1;\n```',
    );
    expect(html).toContain('<pre');
    expect(html).toMatch(/<pre[^>]*data-source-line=/);
  });

  it('renders code block content escaped', () => {
    const html = renderMarkdownWithSourceMap(
      '```\n<script>alert(1)</script>\n```',
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('pre-processes image paths with spaces', () => {
    const html = renderMarkdownWithSourceMap(
      '![alt](foo bar.png)',
    );
    expect(html).toContain('foo%20bar.png');
  });

  it('renders display math via KaTeX', () => {
    const html = renderMarkdownWithSourceMap('$$x^2$$');
    // Not asserting on specific KaTeX HTML, just that
    // something was rendered beyond raw source.
    expect(html).not.toContain('$$x^2$$');
    expect(html.length).toBeGreaterThan(10);
  });

  it('renders inline math via KaTeX', () => {
    const html = renderMarkdownWithSourceMap(
      'inline $a + b$ here',
    );
    expect(html).not.toContain('$a + b$');
    expect(html).toContain('inline');
    expect(html).toContain('here');
  });

  it('leaves dollar signs in prose alone', () => {
    const html = renderMarkdownWithSourceMap(
      'costs $5 total',
    );
    // The $5 should not trigger math rendering because
    // the extension requires non-whitespace at both ends
    // AND a matching closing $ — lone `$5` has no match.
    expect(html).toContain('$5');
  });

  it('renders GFM tables', () => {
    const src = '| a | b |\n|---|---|\n| 1 | 2 |';
    const html = renderMarkdownWithSourceMap(src);
    expect(html).toContain('<table');
    expect(html).toContain('<td');
  });

  it('renders nested lists correctly', () => {
    const src = '- item 1\n  - nested\n- item 2';
    const html = renderMarkdownWithSourceMap(src);
    expect(html).toContain('<ul');
    expect(html).toContain('item 1');
    expect(html).toContain('nested');
  });

  it('renders task lists (GFM)', () => {
    const src = '- [x] done\n- [ ] todo';
    const html = renderMarkdownWithSourceMap(src);
    expect(html).toContain('type="checkbox"');
  });

  it('degrades to escaped source on parse failure', () => {
    // This shouldn't actually fail — marked has silent:
    // true. But if something throws, we fall back to
    // escaping. Can't easily trigger the path; verify
    // the defensive branch exists by checking that weird
    // input doesn't throw.
    expect(() =>
      renderMarkdownWithSourceMap('# ' + 'x'.repeat(10000)),
    ).not.toThrow();
  });

  it('handles multiple different block types in one doc', () => {
    const src =
      '# Heading\n\n' +
      'A paragraph.\n\n' +
      '```\ncode\n```\n\n' +
      '---\n\n' +
      '> quote\n\n' +
      '- list item';
    const html = renderMarkdownWithSourceMap(src);
    expect(html).toContain('<h1');
    expect(html).toContain('<p');
    expect(html).toContain('<pre');
    expect(html).toContain('<hr');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<ul');
  });
});

// -------------------------------------------------------
// Idempotence & determinism
// -------------------------------------------------------

describe('renderMarkdownWithSourceMap determinism', () => {
  it('produces identical output for identical input', () => {
    const src = '# Title\n\nContent.\n\n- a\n- b';
    const a = renderMarkdownWithSourceMap(src);
    const b = renderMarkdownWithSourceMap(src);
    expect(a).toBe(b);
  });

  it('source-line injection is order-independent', () => {
    // Swap heading order — line numbers should follow.
    const src1 = '# A\n\n# B\n';
    const src2 = '# B\n\n# A\n';
    const html1 = renderMarkdownWithSourceMap(src1);
    const html2 = renderMarkdownWithSourceMap(src2);
    // Both should have line 1 and line 3 annotations.
    expect(html1).toContain('data-source-line="1"');
    expect(html1).toContain('data-source-line="3"');
    expect(html2).toContain('data-source-line="1"');
    expect(html2).toContain('data-source-line="3"');
  });
});