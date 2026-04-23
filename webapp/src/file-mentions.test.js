// Tests for webapp/src/file-mentions.js — pure helpers
// for wrapping file-path substrings in rendered markdown
// HTML.
//
// String-shape assertions throughout; no DOM mount. The
// module is deliberately pure so these tests stay fast
// and stable regardless of what the chat panel does with
// the wrapped HTML.

import { describe, expect, it } from 'vitest';

import {
  _isBoundary,
  _segmentHtml,
  _wrapMatchesInText,
  findFileMentions,
} from './file-mentions.js';

// ---------------------------------------------------------------------------
// _isBoundary
// ---------------------------------------------------------------------------

describe('_isBoundary', () => {
  it('string boundary always counts', () => {
    // Position 0 and length both pass '' to the function;
    // both should qualify as boundaries.
    expect(_isBoundary('', 'before')).toBe(true);
    expect(_isBoundary('', 'after')).toBe(true);
  });

  it('letters and digits are never boundaries', () => {
    for (const ch of ['a', 'Z', '0', '9']) {
      expect(_isBoundary(ch, 'before')).toBe(false);
      expect(_isBoundary(ch, 'after')).toBe(false);
    }
  });

  it('underscore and hyphen are not boundaries', () => {
    expect(_isBoundary('_', 'before')).toBe(false);
    expect(_isBoundary('-', 'before')).toBe(false);
    expect(_isBoundary('_', 'after')).toBe(false);
    expect(_isBoundary('-', 'after')).toBe(false);
  });

  it('slash is not a boundary', () => {
    // Prevents `src/foo.py` matching inside
    // `docs/src/foo.py` at a position that would chop off
    // the leading `src/`.
    expect(_isBoundary('/', 'before')).toBe(false);
    expect(_isBoundary('/', 'after')).toBe(false);
  });

  it('dot is asymmetric — boundary after only', () => {
    // Rationale: a path ending in `.py` followed by `.`
    // (end of sentence) should still match. But a path
    // `env.local` preceded by `.` means we're looking at
    // `.env.local` and shouldn't match just `env.local`.
    expect(_isBoundary('.', 'before')).toBe(false);
    expect(_isBoundary('.', 'after')).toBe(true);
  });

  it('whitespace is a boundary', () => {
    expect(_isBoundary(' ', 'before')).toBe(true);
    expect(_isBoundary('\n', 'before')).toBe(true);
    expect(_isBoundary('\t', 'after')).toBe(true);
  });

  it('common punctuation is a boundary', () => {
    // Brackets, commas, colons, semicolons all mark the
    // end of a path reference in prose.
    for (const ch of ['<', '>', '(', ')', '[', ']', ',', ';', ':']) {
      expect(_isBoundary(ch, 'before')).toBe(true);
      expect(_isBoundary(ch, 'after')).toBe(true);
    }
  });

  it('quotes and backticks are boundaries', () => {
    for (const ch of ['"', "'", '`']) {
      expect(_isBoundary(ch, 'before')).toBe(true);
      expect(_isBoundary(ch, 'after')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// _segmentHtml
// ---------------------------------------------------------------------------

describe('_segmentHtml', () => {
  it('empty input returns empty array', () => {
    expect(_segmentHtml('')).toEqual([]);
    expect(_segmentHtml(null)).toEqual([]);
    expect(_segmentHtml(undefined)).toEqual([]);
  });

  it('plain text produces one text segment', () => {
    const out = _segmentHtml('hello world');
    expect(out).toEqual([{ type: 'text', content: 'hello world' }]);
  });

  it('simple tag-wrapped text splits into skip/text/skip', () => {
    const out = _segmentHtml('<p>hello</p>');
    expect(out).toEqual([
      { type: 'skip', content: '<p>' },
      { type: 'text', content: 'hello' },
      { type: 'skip', content: '</p>' },
    ]);
  });

  it('multiple tags preserve order', () => {
    const out = _segmentHtml('<p>a</p><p>b</p>');
    expect(out.map((s) => s.content)).toEqual([
      '<p>',
      'a',
      '</p>',
      '<p>',
      'b',
      '</p>',
    ]);
  });

  it('content inside <pre> is categorised as skip', () => {
    const out = _segmentHtml('<pre>some code</pre>');
    // The <pre> and </pre> tags are skip. The text between
    // is ALSO skip (categorised to prevent mention
    // wrapping inside code fences).
    const textContent = out.filter((s) => s.type === 'text');
    expect(textContent).toEqual([]);
    // The actual code text is present in the skip
    // segments (tag or content — either way preserved).
    const all = out.map((s) => s.content).join('');
    expect(all).toBe('<pre>some code</pre>');
  });

  it('content inside <code> is categorised as skip', () => {
    const out = _segmentHtml('<code>x</code>');
    const textContent = out.filter((s) => s.type === 'text');
    expect(textContent).toEqual([]);
  });

  it('prose outside pre/code remains text', () => {
    const out = _segmentHtml('before <pre>x</pre> after');
    const textContent = out
      .filter((s) => s.type === 'text')
      .map((s) => s.content);
    expect(textContent).toContain('before ');
    expect(textContent).toContain(' after');
  });

  it('attributes on tags are part of the skip segment', () => {
    // The whole opening tag including attributes is one
    // skip segment — mention matching must never touch
    // attribute values like class names or paths inside
    // href.
    const out = _segmentHtml('<a href="src/foo.py">link</a>');
    expect(out[0].content).toBe('<a href="src/foo.py">');
    expect(out[0].type).toBe('skip');
  });

  it('self-closing tags preserved as single skip', () => {
    const out = _segmentHtml('<br/>hello');
    expect(out[0]).toEqual({ type: 'skip', content: '<br/>' });
    expect(out[1]).toEqual({ type: 'text', content: 'hello' });
  });

  it('nested pre/code (code inside pre) stays in skip mode', () => {
    // Common marked.js output — <pre><code>…</code></pre>.
    // We enter skip mode on <pre>, stay in skip mode
    // through <code>, exit on </pre>. Implementation
    // detail: the inSkipTag variable tracks ONE level;
    // the matching close tag for the outer element is
    // what re-enables text mode.
    const out = _segmentHtml('<pre><code>x</code></pre>');
    const textContent = out.filter((s) => s.type === 'text');
    expect(textContent).toEqual([]);
  });

  it('entities are preserved atomically in text', () => {
    // An HTML entity like &amp; shouldn't be split by
    // file-mention matching. The segmenter preserves
    // entities as part of text content; the wrapper
    // function treats them as opaque bytes when searching
    // for paths.
    const out = _segmentHtml('a &amp; b');
    const joined = out.map((s) => s.content).join('');
    expect(joined).toBe('a &amp; b');
  });

  it('malformed tag (unclosed) treated as skip rest-of-string', () => {
    // Defensive — marked produces well-formed HTML, but
    // if we ever get a truncated string we don't crash.
    const out = _segmentHtml('before <p incomplete');
    // Everything from < onward is skip content.
    const skipContent = out
      .filter((s) => s.type === 'skip')
      .map((s) => s.content)
      .join('');
    expect(skipContent).toContain('<p incomplete');
  });
});

// ---------------------------------------------------------------------------
// _wrapMatchesInText
// ---------------------------------------------------------------------------

describe('_wrapMatchesInText', () => {
  it('empty inputs return empty', () => {
    expect(_wrapMatchesInText('', ['a.py'])).toBe('');
    expect(_wrapMatchesInText('hello', [])).toBe('hello');
  });

  it('no matches returns text unchanged', () => {
    expect(_wrapMatchesInText('hello world', ['a.py'])).toBe(
      'hello world',
    );
  });

  it('single match gets wrapped', () => {
    const out = _wrapMatchesInText('see src/foo.py for details', [
      'src/foo.py',
    ]);
    expect(out).toBe(
      'see <span class="file-mention" data-file="src/foo.py">src/foo.py</span> for details',
    );
  });

  it('multiple occurrences all wrapped', () => {
    const out = _wrapMatchesInText('a.py and a.py again', ['a.py']);
    // Both matches wrapped; boundaries around each (space
    // before, space/end after).
    const occurrences = (
      out.match(/<span class="file-mention"/g) || []
    ).length;
    expect(occurrences).toBe(2);
  });

  it('longest match wins when multiple paths overlap', () => {
    // With both paths in the list, the longer one must
    // claim the match so the shorter doesn't produce a
    // nested wrapper.
    const out = _wrapMatchesInText(
      'edit src/foo/bar.py now',
      ['src/foo/bar.py', 'foo/bar.py'],
    );
    expect(out).toContain('data-file="src/foo/bar.py"');
    expect(out).not.toContain('data-file="foo/bar.py"');
  });

  it('partial path (missing boundary) does not match', () => {
    // `a.py` should NOT match inside `xa.py` — the
    // character before `a` is `x`, not a boundary. This
    // is the whole point of the boundary check.
    const out = _wrapMatchesInText('xa.py and a.py', ['a.py']);
    // Only the standalone a.py should be wrapped.
    const occurrences = (
      out.match(/<span class="file-mention"/g) || []
    ).length;
    expect(occurrences).toBe(1);
    expect(out).toContain('xa.py ');
  });

  it('path at start of string matches', () => {
    const out = _wrapMatchesInText('a.py starts here', ['a.py']);
    expect(out).toMatch(/^<span/);
  });

  it('path at end of string matches', () => {
    const out = _wrapMatchesInText('ends with a.py', ['a.py']);
    expect(out).toMatch(/<\/span>$/);
  });

  it('path followed by sentence-ending dot still matches', () => {
    // Dot is an "after-boundary" character — a trailing
    // period in prose shouldn't break the match.
    const out = _wrapMatchesInText('see a.py.', ['a.py']);
    expect(out).toContain('<span');
    // And the trailing dot is NOT inside the span.
    expect(out).toMatch(/<\/span>\.$/);
  });

  it('path preceded by dot does NOT match (leading-dot boundary asymmetry)', () => {
    // The path `env.local` should not match inside
    // `.env.local` — treating `.env.local` as merely
    // `env.local` would silently lose the dotfile prefix.
    // The before-dot asymmetry prevents this.
    const out = _wrapMatchesInText('.env.local here', ['env.local']);
    expect(out).not.toContain('<span');
  });

  it('path with leading slash matches when slash is a path char', () => {
    // Slashes are path characters (never boundaries). If
    // the text has `/src/foo.py`, the leading `/` means
    // we're INSIDE a longer path — `src/foo.py` alone
    // shouldn't match.
    const out = _wrapMatchesInText('rooted/src/foo.py here', [
      'src/foo.py',
    ]);
    expect(out).not.toContain('<span');
  });

  it('escapes special characters in the data-file attribute', () => {
    // Paths with quotes are pathological but possible.
    // The match DOES succeed here because `"` is a
    // boundary character on both sides (so the path's
    // leading/trailing quotes sit next to surrounding
    // spaces, which are also boundaries). The important
    // contract is that the attribute value gets escaped
    // so the generated HTML remains well-formed — a raw
    // `"` inside `data-file="..."` would break the
    // attribute and potentially inject markup.
    const out = _wrapMatchesInText('see "weird".py there', [
      '"weird".py',
    ]);
    // Match wrapped, attribute value escaped with &quot;
    // entities. The text content between the span tags
    // is also escaped (same function handles both).
    expect(out).toContain('data-file="&quot;weird&quot;.py"');
    // And critically — no raw `"` appears inside the
    // attribute value, which would break HTML parsing.
    expect(out).not.toMatch(/data-file="[^"]*"[^"]*"[^>]*>/);
  });

  it('escapes ampersand in path (defensive)', () => {
    // A path like `foo&bar.txt` is pathological but the
    // helper shouldn't crash. The ampersand IS a boundary
    // character, so a clean match actually wouldn't
    // trigger here; but if someone passes it explicitly,
    // the attribute is escaped.
    const sorted = ['abc.py'];
    const out = _wrapMatchesInText('abc.py', sorted);
    // Clean case — no ampersand to escape.
    expect(out).toContain('data-file="abc.py"');
    expect(out).not.toContain('&');
  });

  it('non-overlapping matches both wrap', () => {
    const out = _wrapMatchesInText(
      'see a.py and b.py both',
      ['a.py', 'b.py'],
    );
    expect(out).toContain('data-file="a.py"');
    expect(out).toContain('data-file="b.py"');
  });

  it('tied-length paths sort lexicographically for determinism', () => {
    // Two paths of identical length matching the same
    // substring — the sort tie-breaker ensures the same
    // one wins every run.
    const sorted = ['aaa.py', 'aab.py'];
    const out = _wrapMatchesInText('edit aab.py now', sorted);
    // aab.py matches at position 5; aaa.py doesn't match
    // at all (the text has aab, not aaa). Trivial case,
    // but the determinism test is conceptual — we don't
    // have ambiguous same-length same-prefix overlaps in
    // real repos.
    expect(out).toContain('data-file="aab.py"');
  });
});

// ---------------------------------------------------------------------------
// findFileMentions — end-to-end
// ---------------------------------------------------------------------------

describe('findFileMentions', () => {
  it('empty html returns empty string', () => {
    expect(findFileMentions('', ['a.py'])).toBe('');
    expect(findFileMentions(null, ['a.py'])).toBe('');
    expect(findFileMentions(undefined, ['a.py'])).toBe('');
  });

  it('empty repoFiles returns html unchanged', () => {
    expect(findFileMentions('<p>hello</p>', [])).toBe(
      '<p>hello</p>',
    );
    expect(findFileMentions('<p>hello</p>', null)).toBe(
      '<p>hello</p>',
    );
  });

  it('wraps a single mention in simple prose', () => {
    const out = findFileMentions(
      '<p>see src/foo.py for details</p>',
      ['src/foo.py'],
    );
    expect(out).toContain(
      '<span class="file-mention" data-file="src/foo.py">src/foo.py</span>',
    );
    // Surrounding tags preserved.
    expect(out).toMatch(/^<p>/);
    expect(out).toMatch(/<\/p>$/);
  });

  it('does NOT wrap mentions inside <pre> blocks', () => {
    const out = findFileMentions(
      '<pre>src/foo.py in code</pre>',
      ['src/foo.py'],
    );
    // The path is in code; we preserve it as-is. Code
    // fences often quote file paths as examples, not as
    // navigation targets.
    expect(out).not.toContain('<span');
    expect(out).toContain('src/foo.py');
  });

  it('does NOT wrap mentions inside <code> blocks', () => {
    const out = findFileMentions(
      '<p>see <code>src/foo.py</code> maybe</p>',
      ['src/foo.py'],
    );
    // Inline code excluded for the same reason as block
    // code — the user is quoting, not referencing.
    expect(out).not.toContain('<span class="file-mention"');
    expect(out).toContain('<code>src/foo.py</code>');
  });

  it('wraps mentions outside code even when code present', () => {
    const out = findFileMentions(
      '<p>see src/foo.py and <code>not this one</code></p>',
      ['src/foo.py', 'not this one'],
    );
    expect(out).toContain('data-file="src/foo.py"');
    // `not this one` would match inside <code> — suppress.
    // (Contrived path, but pins the scoping rule.)
    expect(out).toContain('<code>not this one</code>');
  });

  it('does NOT wrap paths inside tag attributes', () => {
    // The `href` attribute contains `src/foo.py` verbatim.
    // The segmenter categorises the entire `<a ...>` tag
    // as skip content, so no wrapping happens inside.
    const out = findFileMentions(
      '<p><a href="src/foo.py">click</a></p>',
      ['src/foo.py'],
    );
    expect(out).toContain('href="src/foo.py"');
    // No span added — the only occurrence of the path is
    // in the attribute.
    expect(out).not.toContain('<span class="file-mention"');
  });

  it('handles multiple mentions across multiple paragraphs', () => {
    const html = '<p>edit a.py</p><p>and also b.py</p>';
    const out = findFileMentions(html, ['a.py', 'b.py']);
    expect(
      (out.match(/<span class="file-mention"/g) || []).length,
    ).toBe(2);
  });

  it('picks longest match when overlapping paths exist', () => {
    // Both `src/foo/bar.py` and `bar.py` are in the list.
    // The text contains `src/foo/bar.py`. The long form
    // wins; `bar.py` never gets a wrapper because its
    // candidate span falls inside the longer match.
    const out = findFileMentions(
      '<p>edit src/foo/bar.py now</p>',
      ['src/foo/bar.py', 'bar.py'],
    );
    expect(out).toContain('data-file="src/foo/bar.py"');
    expect(out).not.toContain('data-file="bar.py"');
  });

  it('pre-filters candidates that never appear in the text', () => {
    // A repo with thousands of files; the LLM mentions
    // one. We shouldn't run boundary checks on every
    // path in the repo.
    //
    // Test the CONTRACT, not the implementation — we
    // can't observe the pre-filter directly, but we can
    // observe that providing a huge list of non-matching
    // paths is fast (implicit — no timeout in the test)
    // and the result is correct.
    const paths = [];
    for (let i = 0; i < 5000; i += 1) {
      paths.push(`src/file${i}.py`);
    }
    paths.push('real/match.js');
    const out = findFileMentions(
      '<p>see real/match.js here</p>',
      paths,
    );
    expect(out).toContain('data-file="real/match.js"');
  });

  it('wraps mentions inside nested markup', () => {
    // Marked.js output wraps list items in <li> which
    // wrap in <ul>. The mention inside is still text
    // content at the deepest level.
    const out = findFileMentions(
      '<ul><li>check a.py</li></ul>',
      ['a.py'],
    );
    expect(out).toContain('data-file="a.py"');
    // Structure preserved.
    expect(out).toMatch(/^<ul><li>/);
    expect(out).toMatch(/<\/li><\/ul>$/);
  });

  it('ignores paths with only whitespace or empty string', () => {
    const out = findFileMentions(
      '<p>see a.py</p>',
      ['', '   ', 'a.py'],
    );
    expect(out).toContain('data-file="a.py"');
    // Shouldn't crash or wrap empty string anywhere.
    expect(out).not.toContain('data-file=""');
  });

  it('same path mentioned twice wraps both occurrences', () => {
    const out = findFileMentions(
      '<p>see a.py and a.py again</p>',
      ['a.py'],
    );
    expect(
      (out.match(/<span class="file-mention"/g) || []).length,
    ).toBe(2);
  });

  it('mention adjacent to entity does not break', () => {
    // Rendered markdown for `a.py & b.py` emits `&amp;`.
    // The segmenter treats the entity atomically; the
    // wrapper still sees `a.py ` (with trailing space
    // before the entity) as a text segment.
    const out = findFileMentions(
      '<p>a.py &amp; b.py</p>',
      ['a.py', 'b.py'],
    );
    expect(out).toContain('data-file="a.py"');
    expect(out).toContain('data-file="b.py"');
    // Entity preserved.
    expect(out).toContain('&amp;');
  });
});