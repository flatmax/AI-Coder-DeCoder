// Tests for webapp/src/message-search.js — pure search helpers.
//
// The chat panel wraps these with UI state and keyboard
// handling. Testing the pure logic separately lets us pin the
// match semantics (case sensitivity, regex, whole-word, empty
// query, malformed input) without mounting a Lit component.

import { describe, expect, it } from 'vitest';

import {
  _buildPattern,
  _escapeRegex,
  _extractSearchText,
  findMessageMatches,
} from './message-search.js';

// ---------------------------------------------------------------------------
// _escapeRegex
// ---------------------------------------------------------------------------

describe('_escapeRegex', () => {
  it('escapes regex metacharacters', () => {
    // Each char needs to round-trip as a literal match when
    // passed to a RegExp constructor. Covers the set used
    // in specs for literal substring search.
    for (const ch of ['.', '*', '+', '?', '^', '$', '(', ')', '|', '[', ']', '{', '}', '\\']) {
      const escaped = _escapeRegex(ch);
      expect(escaped.startsWith('\\')).toBe(true);
      // The escaped form, used in a regex, matches the
      // original literal character.
      expect(new RegExp(escaped).test(ch)).toBe(true);
    }
  });

  it('leaves non-meta characters unchanged', () => {
    expect(_escapeRegex('hello world')).toBe('hello world');
    expect(_escapeRegex('abc123')).toBe('abc123');
  });

  it('handles empty string', () => {
    expect(_escapeRegex('')).toBe('');
  });

  it('stringifies non-string input defensively', () => {
    expect(_escapeRegex(42)).toBe('42');
  });
});

// ---------------------------------------------------------------------------
// _extractSearchText
// ---------------------------------------------------------------------------

describe('_extractSearchText', () => {
  it('returns empty string for falsy input', () => {
    expect(_extractSearchText(null)).toBe('');
    expect(_extractSearchText(undefined)).toBe('');
  });

  it('returns string content unchanged', () => {
    expect(
      _extractSearchText({ role: 'user', content: 'hello' }),
    ).toBe('hello');
  });

  it('extracts text from multimodal content blocks', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'text', text: 'first' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,X' },
        },
        { type: 'text', text: 'second' },
      ],
    };
    // Text blocks joined by newline, image block skipped.
    expect(_extractSearchText(msg)).toBe('first\nsecond');
  });

  it('returns empty for image-only multimodal content', () => {
    const msg = {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,X' },
        },
      ],
    };
    expect(_extractSearchText(msg)).toBe('');
  });

  it('skips malformed blocks in multimodal content', () => {
    const msg = {
      content: [
        null,
        { type: 'text' }, // missing text field
        { type: 'text', text: 'valid' },
        { type: 'unknown', text: 'x' },
      ],
    };
    expect(_extractSearchText(msg)).toBe('valid');
  });

  it('returns empty string for non-string non-array content', () => {
    expect(_extractSearchText({ content: 42 })).toBe('');
    expect(_extractSearchText({ content: {} })).toBe('');
    expect(_extractSearchText({ content: null })).toBe('');
  });

  it('handles missing content field', () => {
    expect(_extractSearchText({ role: 'user' })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// _buildPattern
// ---------------------------------------------------------------------------

describe('_buildPattern', () => {
  it('builds a case-insensitive pattern by default', () => {
    const p = _buildPattern('hello', {});
    expect(p).toBeInstanceOf(RegExp);
    expect(p.flags).toContain('i');
    expect(p.flags).toContain('g');
    expect(p.test('HELLO WORLD')).toBe(true);
  });

  it('builds a case-sensitive pattern when ignoreCase is false', () => {
    const p = _buildPattern('hello', { ignoreCase: false });
    expect(p.flags).not.toContain('i');
    expect(p.test('HELLO')).toBe(false);
    expect(p.test('hello')).toBe(true);
  });

  it('escapes meta-chars when regex toggle is off', () => {
    // `.*` in the query should match literally, not as
    // wildcards. Proves the literal substring contract.
    const p = _buildPattern('.*', { regex: false });
    expect(p.test('literal.*match')).toBe(true);
    expect(p.test('no wildcards here')).toBe(false);
  });

  it('uses query as pattern when regex toggle is on', () => {
    const p = _buildPattern('.*', { regex: true });
    // `.*` matches any string, so any non-empty test
    // returns true. Reset lastIndex between calls since
    // the pattern uses the `g` flag and `.test()` is
    // stateful on g-flagged regexes.
    expect(p.test('anything goes')).toBe(true);
    p.lastIndex = 0;
    expect(p.test('also this')).toBe(true);
  });

  it('wraps with word boundaries when wholeWord is on', () => {
    const p = _buildPattern('cat', { wholeWord: true });
    expect(p.test('the cat sat')).toBe(true);
    // "cat" inside "catalog" doesn't match as whole word.
    expect(p.test('catalog')).toBe(false);
    expect(p.test('scatter')).toBe(false);
  });

  it('whole-word combines with regex toggle correctly', () => {
    // User types `ca.` as a regex with whole-word. Should
    // match "cat" standalone but not "cat" inside a word.
    // Reset lastIndex between calls — the pattern uses the
    // `g` flag, so `.test()` maintains state across calls
    // on the same instance (same issue as the other
    // multi-test case above).
    const p = _buildPattern('ca.', {
      regex: true,
      wholeWord: true,
    });
    expect(p.test('the cat sat')).toBe(true);
    p.lastIndex = 0;
    expect(p.test('the cab ran')).toBe(true);
    p.lastIndex = 0;
    expect(p.test('catalog')).toBe(false);
    p.lastIndex = 0;
    expect(p.test('vacation')).toBe(false);
  });

  it('returns null for invalid regex', () => {
    // Unclosed bracket — common while user is typing.
    expect(_buildPattern('[a', { regex: true })).toBeNull();
    // Invalid escape.
    expect(_buildPattern('\\', { regex: true })).toBeNull();
  });

  it('literal mode tolerates otherwise-invalid patterns', () => {
    // `[a` is invalid as a regex, but with regex toggle
    // OFF we escape first, so it matches the literal
    // string `[a` and never errors.
    const p = _buildPattern('[a', { regex: false });
    expect(p).not.toBeNull();
    expect(p.test('foo [a bar')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findMessageMatches — main entry
// ---------------------------------------------------------------------------

describe('findMessageMatches', () => {
  const conversation = [
    { role: 'user', content: 'Hello world' },
    { role: 'assistant', content: 'Hi there, how can I help?' },
    { role: 'user', content: 'tell me about CATS' },
    { role: 'assistant', content: 'Cats are lovely animals.' },
    { role: 'user', content: 'What about catalogs?' },
  ];

  it('returns empty array for empty query', () => {
    expect(findMessageMatches(conversation, '')).toEqual([]);
  });

  it('returns empty array for whitespace-only query', () => {
    expect(findMessageMatches(conversation, '   ')).toEqual([]);
    expect(findMessageMatches(conversation, '\t\n')).toEqual([]);
  });

  it('returns empty array for non-array messages', () => {
    expect(findMessageMatches(null, 'x')).toEqual([]);
    expect(findMessageMatches(undefined, 'x')).toEqual([]);
    expect(findMessageMatches('not array', 'x')).toEqual([]);
  });

  it('returns empty array for non-string query', () => {
    expect(findMessageMatches(conversation, null)).toEqual([]);
    expect(findMessageMatches(conversation, 42)).toEqual([]);
    expect(findMessageMatches(conversation, {})).toEqual([]);
  });

  it('finds case-insensitive matches by default', () => {
    // "cats" matches "CATS" (index 2) and "Cats" (index 3).
    const matches = findMessageMatches(conversation, 'cats');
    expect(matches).toEqual([2, 3]);
  });

  it('respects ignoreCase=false for case-sensitive search', () => {
    const matches = findMessageMatches(conversation, 'Cats', {
      ignoreCase: false,
    });
    // Only the one that starts with capital C.
    expect(matches).toEqual([3]);
  });

  it('returns matches in display order', () => {
    // "hi" matches indices 1 and 4 ("Hello" has "hi"? no —
    // "Hello" has no "hi" substring. Let me use a better
    // case.) Actually "Hello" contains "hi" as
    // characters 2-3? "ello" — no, H-e-l-l-o, no "hi"
    // substring. Use a different query.
    const matches = findMessageMatches(conversation, 'about');
    // "about CATS" at index 2, "about catalogs" at index 4.
    expect(matches).toEqual([2, 4]);
  });

  it('literal substring finds meta-chars as literal', () => {
    const msgs = [
      { role: 'user', content: 'is 2+2=4 true' },
      { role: 'user', content: 'just plain text' },
    ];
    expect(findMessageMatches(msgs, '2+2')).toEqual([0]);
  });

  it('regex toggle enables pattern matching', () => {
    const msgs = [
      { role: 'user', content: 'order 123' },
      { role: 'user', content: 'order 456' },
      { role: 'user', content: 'no number' },
    ];
    const matches = findMessageMatches(msgs, '\\d+', {
      regex: true,
    });
    expect(matches).toEqual([0, 1]);
  });

  it('invalid regex returns empty array (silent degradation)', () => {
    // Common scenario: user is mid-typing a bracketed
    // character class. We don't want to throw — we want
    // to show 0/0 until they close the bracket.
    const matches = findMessageMatches(conversation, '[a', {
      regex: true,
    });
    expect(matches).toEqual([]);
  });

  it('whole-word excludes substring matches', () => {
    // "cat" should match index 3 ("Cats") — wait, "Cats"
    // has "cat" as a prefix. Whole-word at "Cats" — `\b`
    // before C is word boundary (start of token), `\b`
    // after t — next char is 's', which is a word char,
    // so no boundary. So "Cats" does NOT match whole-word
    // "cat". Let me verify with a clearer test case.
    const msgs = [
      { role: 'user', content: 'the cat sat' },
      { role: 'user', content: 'catalog of items' },
      { role: 'user', content: 'scatterbrained' },
      { role: 'user', content: 'a cat.' },
    ];
    const matches = findMessageMatches(msgs, 'cat', {
      wholeWord: true,
    });
    // "the cat sat" — yes (whitespace boundaries).
    // "catalog" — no (c-a-t followed by 'a', no boundary).
    // "scatterbrained" — no.
    // "a cat." — yes (period is non-word, boundary exists).
    expect(matches).toEqual([0, 3]);
  });

  it('regex + wholeWord combines correctly', () => {
    const msgs = [
      { role: 'user', content: 'foo bar baz' },
      { role: 'user', content: 'foobar' },
    ];
    // User types "fo.", regex on, whole-word on. Should
    // match "foo" as a token but not inside "foobar".
    const matches = findMessageMatches(msgs, 'fo.', {
      regex: true,
      wholeWord: true,
    });
    expect(matches).toEqual([0]);
  });

  it('works on multimodal content by extracting text', () => {
    const msgs = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look at this screenshot' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,X' },
          },
        ],
      },
      { role: 'assistant', content: 'I see.' },
    ];
    expect(findMessageMatches(msgs, 'screenshot')).toEqual([0]);
  });

  it('skips messages with no searchable text', () => {
    const msgs = [
      { role: 'user', content: 'first' },
      // Image-only message — no text to search.
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,X' },
          },
        ],
      },
      { role: 'user', content: 'first' },
    ];
    const matches = findMessageMatches(msgs, 'first');
    expect(matches).toEqual([0, 2]);
  });

  it('does not match against rendered markdown', () => {
    // Content containing `**bold**` should match on
    // literal asterisks, not on the word "bold" alone
    // after stripping markdown — we search raw content.
    const msgs = [
      { role: 'assistant', content: 'use **bold** here' },
    ];
    // Asterisks are literal in the source.
    expect(
      findMessageMatches(msgs, '**bold**'),
    ).toEqual([0]);
    // The word "bold" also matches (substring of the raw
    // content — the asterisks are just characters).
    expect(findMessageMatches(msgs, 'bold')).toEqual([0]);
  });

  it('empty messages array returns empty', () => {
    expect(findMessageMatches([], 'anything')).toEqual([]);
  });

  it('handles messages with extra metadata fields', () => {
    // Chat panel adds editResults, system_event, images
    // etc. to messages. findMessageMatches should ignore
    // them all and search only content.
    const msgs = [
      {
        role: 'assistant',
        content: 'some text',
        editResults: [{ file: 'a.py', status: 'applied' }],
        images: ['data:image/png;base64,X'],
      },
    ];
    expect(findMessageMatches(msgs, 'some text')).toEqual([0]);
  });
});