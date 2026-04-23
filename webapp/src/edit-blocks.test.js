// Tests for webapp/src/edit-blocks.js — edit block parser.
//
// Strategy — pure-function testing, no DOM. The parser is a
// state machine; the tests exercise each state transition and
// every branch of the path-detection heuristic. Mid-stream
// truncation cases are exercised extensively since that's where
// the streaming renderer depends on correct behavior.

import { describe, expect, it } from 'vitest';

import {
  EDIT_MARK,
  END_MARK,
  REPL_MARK,
  isFilePath,
  matchSegmentsToResults,
  segmentResponse,
} from './edit-blocks.js';

// ---------------------------------------------------------------------------
// Marker constants
// ---------------------------------------------------------------------------

describe('marker constants', () => {
  it('EDIT_MARK is three orange squares + EDIT', () => {
    // D3 in IMPLEMENTATION_NOTES.md — literal bytes matter.
    // Any ASCII substitution would break parser interop with
    // the backend.
    expect(EDIT_MARK).toBe('🟧🟧🟧 EDIT');
  });

  it('REPL_MARK is three yellow squares + REPL', () => {
    expect(REPL_MARK).toBe('🟨🟨🟨 REPL');
  });

  it('END_MARK is three green squares + END', () => {
    expect(END_MARK).toBe('🟩🟩🟩 END');
  });
});

// ---------------------------------------------------------------------------
// isFilePath heuristic
// ---------------------------------------------------------------------------

describe('isFilePath', () => {
  describe('rejects', () => {
    it('empty and whitespace', () => {
      expect(isFilePath('')).toBe(false);
      expect(isFilePath('   ')).toBe(false);
      expect(isFilePath('\t')).toBe(false);
    });

    it('non-string', () => {
      expect(isFilePath(null)).toBe(false);
      expect(isFilePath(undefined)).toBe(false);
      expect(isFilePath(42)).toBe(false);
    });

    it('excessively long line', () => {
      // Backend uses 200 chars as the cutoff — paths beyond
      // that are almost certainly prose or base64 blobs, not
      // filesystem paths.
      const long = 'a/'.repeat(110); // 220 chars
      expect(isFilePath(long)).toBe(false);
    });

    it('comment prefixes', () => {
      expect(isFilePath('# src/foo.py')).toBe(false);
      expect(isFilePath('// src/foo.py')).toBe(false);
      expect(isFilePath('* src/foo.py')).toBe(false);
      expect(isFilePath('- src/foo.py')).toBe(false);
      expect(isFilePath('> src/foo.py')).toBe(false);
      expect(isFilePath('```python')).toBe(false);
    });

    it('plain prose without separators or extension', () => {
      expect(isFilePath('hello')).toBe(false);
      expect(isFilePath('this is a sentence')).toBe(false);
    });

    it('extensionless filename not on whitelist', () => {
      // Rakefile is in the backend whitelist but intentionally
      // not in the frontend's — the asymmetry is documented as
      // D3/specs3 behavior.
      expect(isFilePath('Rakefile')).toBe(false);
      expect(isFilePath('Gemfile')).toBe(false);
    });
  });

  describe('accepts', () => {
    it('path with forward slash', () => {
      expect(isFilePath('src/foo.py')).toBe(true);
      expect(isFilePath('a/b/c/d.ts')).toBe(true);
    });

    it('path with backslash', () => {
      // Windows-style paths. Tree-sitter and the backend
      // normalize these to forward slashes at the Repo
      // boundary, but the frontend parser sees the raw
      // output.
      expect(isFilePath('src\\foo.py')).toBe(true);
    });

    it('simple filename with extension', () => {
      expect(isFilePath('foo.js')).toBe(true);
      expect(isFilePath('README.md')).toBe(true);
      expect(isFilePath('package.json')).toBe(true);
    });

    it('dotfile with extension', () => {
      expect(isFilePath('.env.local')).toBe(true);
      expect(isFilePath('.gitlab-ci.yml')).toBe(true);
    });

    it('dotfile without extension', () => {
      expect(isFilePath('.gitignore')).toBe(true);
      expect(isFilePath('.dockerignore')).toBe(true);
    });

    it('extensionless whitelist', () => {
      expect(isFilePath('Makefile')).toBe(true);
      expect(isFilePath('Dockerfile')).toBe(true);
    });

    it('surrounding whitespace is tolerated', () => {
      expect(isFilePath('  src/foo.py  ')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// segmentResponse — pure prose
// ---------------------------------------------------------------------------

describe('segmentResponse - prose only', () => {
  it('empty string returns empty array', () => {
    expect(segmentResponse('')).toEqual([]);
  });

  it('non-string returns empty array', () => {
    expect(segmentResponse(null)).toEqual([]);
    expect(segmentResponse(undefined)).toEqual([]);
    expect(segmentResponse(42)).toEqual([]);
  });

  it('single prose line', () => {
    const out = segmentResponse('hello world');
    expect(out).toEqual([{ type: 'text', content: 'hello world' }]);
  });

  it('multi-line prose preserves newlines', () => {
    const input = 'line one\nline two\nline three';
    const out = segmentResponse(input);
    expect(out).toEqual([{ type: 'text', content: input }]);
  });

  it('prose with markdown untouched', () => {
    // Parser is dumb about markdown — the renderer handles it.
    // But isolated filename-like lines (README.md, package.json)
    // trip the path detector and get pulled out as a separate
    // segment. Use a line that isn't path-shaped.
    const input = '# Heading\n\nSome **bold** text and `inline code`.';
    const out = segmentResponse(input);
    expect(out).toEqual([{ type: 'text', content: input }]);
  });

  it('path-like line that is not followed by EDIT marker stays as prose', () => {
    // A filename mentioned in passing shouldn't be swallowed
    // as a block path. The `expect-edit` fallthrough pushes it
    // back to the text buffer.
    const input = 'Look at src/foo.py for details.\nMore text here.';
    const out = segmentResponse(input);
    // The second line ("More text here.") doesn't match
    // isFilePath, so the path candidate gets pushed back and
    // normal scanning resumes.
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('text');
    expect(out[0].content).toContain('src/foo.py');
    expect(out[0].content).toContain('More text here.');
  });
});

// ---------------------------------------------------------------------------
// segmentResponse — complete blocks
// ---------------------------------------------------------------------------

describe('segmentResponse - complete blocks', () => {
  it('minimal complete block', () => {
    const input = [
      'src/foo.py',
      EDIT_MARK,
      'old line',
      REPL_MARK,
      'new line',
      END_MARK,
    ].join('\n');
    const out = segmentResponse(input);
    expect(out).toEqual([
      {
        type: 'edit',
        filePath: 'src/foo.py',
        oldText: 'old line',
        newText: 'new line',
        isCreate: false,
      },
    ]);
  });

  it('block with prose before and after', () => {
    const input = [
      'Here is the change:',
      '',
      'src/foo.py',
      EDIT_MARK,
      'old',
      REPL_MARK,
      'new',
      END_MARK,
      '',
      'That should fix it.',
    ].join('\n');
    const out = segmentResponse(input);
    expect(out.length).toBe(3);
    expect(out[0]).toEqual({
      type: 'text',
      content: 'Here is the change:\n',
    });
    expect(out[1].type).toBe('edit');
    expect(out[1].filePath).toBe('src/foo.py');
    expect(out[2]).toEqual({
      type: 'text',
      content: '\nThat should fix it.',
    });
  });

  it('multi-line old and new text', () => {
    const oldText = 'def foo():\n    return 1';
    const newText = 'def foo():\n    return 2\n    # changed';
    const input = [
      'src/a.py',
      EDIT_MARK,
      oldText,
      REPL_MARK,
      newText,
      END_MARK,
    ].join('\n');
    const out = segmentResponse(input);
    expect(out).toHaveLength(1);
    expect(out[0].oldText).toBe(oldText);
    expect(out[0].newText).toBe(newText);
  });

  it('create block — empty old text', () => {
    // Matches the edit protocol: empty old section + non-empty
    // new section = file creation. The segmenter just sets
    // the flag; interpretation is the renderer's job.
    const input = [
      'src/new_file.py',
      EDIT_MARK,
      REPL_MARK,
      'print("hello")',
      END_MARK,
    ].join('\n');
    const out = segmentResponse(input);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('edit');
    expect(out[0].oldText).toBe('');
    expect(out[0].isCreate).toBe(true);
  });

  it('create block — whitespace-only old text still counts as create', () => {
    const input = [
      'src/new.py',
      EDIT_MARK,
      '   ',
      REPL_MARK,
      'content',
      END_MARK,
    ].join('\n');
    const out = segmentResponse(input);
    expect(out[0].isCreate).toBe(true);
  });

  it('non-create block with non-empty old text', () => {
    const input = [
      'foo.py',
      EDIT_MARK,
      'something',
      REPL_MARK,
      'something else',
      END_MARK,
    ].join('\n');
    const out = segmentResponse(input);
    expect(out[0].isCreate).toBe(false);
  });

  it('multiple blocks in sequence', () => {
    const input = [
      'a.py',
      EDIT_MARK,
      'old a',
      REPL_MARK,
      'new a',
      END_MARK,
      'b.py',
      EDIT_MARK,
      'old b',
      REPL_MARK,
      'new b',
      END_MARK,
    ].join('\n');
    const out = segmentResponse(input);
    // Two edit segments; there may be empty text segments
    // between them depending on exact newline handling, but
    // the parser filters those out.
    const edits = out.filter((s) => s.type === 'edit');
    expect(edits).toHaveLength(2);
    expect(edits[0].filePath).toBe('a.py');
    expect(edits[1].filePath).toBe('b.py');
  });

  it('blank line between path and EDIT marker is tolerated', () => {
    const input = [
      'src/foo.py',
      '',
      EDIT_MARK,
      'old',
      REPL_MARK,
      'new',
      END_MARK,
    ].join('\n');
    const out = segmentResponse(input);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('edit');
  });
});

// ---------------------------------------------------------------------------
// segmentResponse — code fence stripping
// ---------------------------------------------------------------------------

describe('segmentResponse - code fence wrapping', () => {
  it('opening fence before path is stripped from text', () => {
    // LLM sometimes wraps edit blocks in ```edit or plain ```.
    // The opening fence that immediately precedes the path
    // should be consumed — not rendered as a code block.
    const input = [
      'Here we go:',
      '```',
      'src/foo.py',
      EDIT_MARK,
      'old',
      REPL_MARK,
      'new',
      END_MARK,
    ].join('\n');
    const out = segmentResponse(input);
    // The ``` line should be stripped from the text segment.
    const texts = out.filter((s) => s.type === 'text');
    for (const t of texts) {
      expect(t.content).not.toMatch(/^```$/m);
    }
    const edits = out.filter((s) => s.type === 'edit');
    expect(edits).toHaveLength(1);
  });

  it('closing fence after END is stripped', () => {
    const input = [
      'src/foo.py',
      EDIT_MARK,
      'old',
      REPL_MARK,
      'new',
      END_MARK,
      '```',
      'Done.',
    ].join('\n');
    const out = segmentResponse(input);
    const texts = out.filter((s) => s.type === 'text');
    // "Done." appears but "```" does not.
    const joined = texts.map((t) => t.content).join('\n');
    expect(joined).toContain('Done.');
    expect(joined).not.toMatch(/^```$/m);
  });

  it('fences not adjacent to edit blocks pass through', () => {
    const input = [
      'Here is some code:',
      '```python',
      'def foo():',
      '    pass',
      '```',
      'That was code.',
    ].join('\n');
    const out = segmentResponse(input);
    // No edit blocks means no fence stripping. All the fence
    // content comes through as one text segment.
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('```python');
    expect(out[0].content).toContain('```');
  });

  it('opening fence with language tag stripped when adjacent to block', () => {
    // ```edit is a common LLM variant for "this is an edit
    // block". The startsWith('```') check covers both ``` and
    // ```edit, ```python, etc.
    const input = [
      '```edit',
      'src/foo.py',
      EDIT_MARK,
      'old',
      REPL_MARK,
      'new',
      END_MARK,
    ].join('\n');
    const out = segmentResponse(input);
    // No leading text segment since the only text before the
    // block was the fence.
    const edits = out.filter((s) => s.type === 'edit');
    expect(edits).toHaveLength(1);
    const texts = out.filter((s) => s.type === 'text');
    for (const t of texts) {
      expect(t.content).not.toMatch(/```/);
    }
  });
});

// ---------------------------------------------------------------------------
// segmentResponse — truncation / pending blocks
// ---------------------------------------------------------------------------

describe('segmentResponse - mid-stream truncation', () => {
  it('truncation after path (expect-edit)', () => {
    // User-visible behavior: the candidate path is pushed
    // back as text so the reader sees what the LLM typed.
    const input = 'Preamble.\nsrc/foo.py';
    const out = segmentResponse(input);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('text');
    expect(out[0].content).toContain('src/foo.py');
  });

  it('truncation inside old text (reading-old)', () => {
    const input = [
      'src/foo.py',
      EDIT_MARK,
      'old line one',
      'old line two',
    ].join('\n');
    const out = segmentResponse(input);
    const pending = out.find((s) => s.type === 'edit-pending');
    expect(pending).toBeDefined();
    expect(pending.filePath).toBe('src/foo.py');
    expect(pending.phase).toBe('reading-old');
    expect(pending.oldText).toBe('old line one\nold line two');
    expect(pending.newText).toBe('');
  });

  it('truncation inside new text (reading-new)', () => {
    const input = [
      'src/foo.py',
      EDIT_MARK,
      'old',
      REPL_MARK,
      'new line one',
      'new line t',
    ].join('\n');
    const out = segmentResponse(input);
    const pending = out.find((s) => s.type === 'edit-pending');
    expect(pending).toBeDefined();
    expect(pending.phase).toBe('reading-new');
    expect(pending.oldText).toBe('old');
    expect(pending.newText).toBe('new line one\nnew line t');
  });

  it('truncation at EDIT marker with no content (reading-old, empty)', () => {
    const input = ['src/foo.py', EDIT_MARK].join('\n');
    const out = segmentResponse(input);
    const pending = out.find((s) => s.type === 'edit-pending');
    expect(pending).toBeDefined();
    expect(pending.phase).toBe('reading-old');
    expect(pending.oldText).toBe('');
  });

  it('truncation at REPL marker with empty new (reading-new, empty)', () => {
    const input = [
      'src/foo.py',
      EDIT_MARK,
      'old content',
      REPL_MARK,
    ].join('\n');
    const out = segmentResponse(input);
    const pending = out.find((s) => s.type === 'edit-pending');
    expect(pending.phase).toBe('reading-new');
    expect(pending.newText).toBe('');
  });

  it('prose before pending block is flushed as text', () => {
    const input = [
      'Here is what I propose:',
      '',
      'src/foo.py',
      EDIT_MARK,
      'partial old',
    ].join('\n');
    const out = segmentResponse(input);
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe('text');
    expect(out[0].content).toContain('Here is what I propose:');
    expect(out[1].type).toBe('edit-pending');
  });

  it('completed block followed by pending block', () => {
    const input = [
      'a.py',
      EDIT_MARK,
      'old a',
      REPL_MARK,
      'new a',
      END_MARK,
      'b.py',
      EDIT_MARK,
      'old b partial',
    ].join('\n');
    const out = segmentResponse(input);
    expect(out.filter((s) => s.type === 'edit')).toHaveLength(1);
    const pending = out.find((s) => s.type === 'edit-pending');
    expect(pending).toBeDefined();
    expect(pending.filePath).toBe('b.py');
  });
});

// ---------------------------------------------------------------------------
// segmentResponse — path ambiguity in expect-edit
// ---------------------------------------------------------------------------

describe('segmentResponse - expect-edit state edge cases', () => {
  it('path followed by another path — first becomes text, second holds', () => {
    // The "I'll edit foo.py\nbar.py\nEDIT" shape. The first
    // path is ambiguous — we can't know it wasn't the real
    // one until we see the next line. When the next line
    // looks like another path, the first is demoted to text.
    const input = [
      'src/foo.py',
      'src/bar.py',
      EDIT_MARK,
      'old',
      REPL_MARK,
      'new',
      END_MARK,
    ].join('\n');
    const out = segmentResponse(input);
    const edits = out.filter((s) => s.type === 'edit');
    expect(edits).toHaveLength(1);
    expect(edits[0].filePath).toBe('src/bar.py');
    const texts = out.filter((s) => s.type === 'text');
    const joined = texts.map((t) => t.content).join('\n');
    expect(joined).toContain('src/foo.py');
    expect(joined).not.toContain('src/bar.py'); // consumed as path
  });

  it('path followed by non-path prose — path becomes text, scanning resumes', () => {
    const input = [
      'src/foo.py',
      'Actually, never mind.',
      'Here is some text.',
    ].join('\n');
    const out = segmentResponse(input);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('text');
    expect(out[0].content).toContain('src/foo.py');
    expect(out[0].content).toContain('Actually, never mind.');
  });

  it('path, blank lines, then EDIT marker', () => {
    const input = [
      'src/foo.py',
      '',
      '',
      EDIT_MARK,
      'old',
      REPL_MARK,
      'new',
      END_MARK,
    ].join('\n');
    const out = segmentResponse(input);
    const edits = out.filter((s) => s.type === 'edit');
    expect(edits).toHaveLength(1);
    expect(edits[0].filePath).toBe('src/foo.py');
  });
});

// ---------------------------------------------------------------------------
// matchSegmentsToResults
// ---------------------------------------------------------------------------

describe('matchSegmentsToResults', () => {
  it('empty inputs', () => {
    expect(matchSegmentsToResults([], [])).toEqual([]);
    expect(matchSegmentsToResults(null, [])).toEqual([]);
  });

  it('no edit results returns all nulls', () => {
    const segments = [
      { type: 'text', content: 'hi' },
      {
        type: 'edit',
        filePath: 'a.py',
        oldText: 'x',
        newText: 'y',
        isCreate: false,
      },
    ];
    expect(matchSegmentsToResults(segments, [])).toEqual([null, null]);
  });

  it('matches single edit to single result', () => {
    const segments = [
      {
        type: 'edit',
        filePath: 'a.py',
        oldText: 'x',
        newText: 'y',
        isCreate: false,
      },
    ];
    const results = [{ file: 'a.py', status: 'applied' }];
    const out = matchSegmentsToResults(segments, results);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ file: 'a.py', status: 'applied' });
  });

  it('text segments get null', () => {
    const segments = [
      { type: 'text', content: 'hi' },
      {
        type: 'edit',
        filePath: 'a.py',
        oldText: 'x',
        newText: 'y',
        isCreate: false,
      },
      { type: 'text', content: 'bye' },
    ];
    const results = [{ file: 'a.py', status: 'applied' }];
    const out = matchSegmentsToResults(segments, results);
    expect(out[0]).toBeNull();
    expect(out[1]).not.toBeNull();
    expect(out[2]).toBeNull();
  });

  it('edit-pending segments get null', () => {
    const segments = [
      {
        type: 'edit-pending',
        filePath: 'a.py',
        phase: 'reading-new',
        oldText: 'x',
        newText: 'partial',
      },
    ];
    const results = [{ file: 'a.py', status: 'applied' }];
    expect(matchSegmentsToResults(segments, results)).toEqual([null]);
  });

  it('multiple edits same file match in order', () => {
    // The load-bearing contract — specs3's per-file index
    // counter. Two edits to a.py map to the first two
    // results for a.py, in the order they appear in segments.
    const segments = [
      {
        type: 'edit',
        filePath: 'a.py',
        oldText: '1',
        newText: '2',
        isCreate: false,
      },
      {
        type: 'edit',
        filePath: 'a.py',
        oldText: '3',
        newText: '4',
        isCreate: false,
      },
    ];
    const results = [
      { file: 'a.py', status: 'applied', message: 'first' },
      { file: 'a.py', status: 'failed', message: 'second' },
    ];
    const out = matchSegmentsToResults(segments, results);
    expect(out[0].message).toBe('first');
    expect(out[1].message).toBe('second');
  });

  it('multiple edits across files match independently', () => {
    const segments = [
      {
        type: 'edit',
        filePath: 'a.py',
        oldText: '',
        newText: '',
        isCreate: false,
      },
      {
        type: 'edit',
        filePath: 'b.py',
        oldText: '',
        newText: '',
        isCreate: false,
      },
      {
        type: 'edit',
        filePath: 'a.py',
        oldText: '',
        newText: '',
        isCreate: false,
      },
    ];
    const results = [
      { file: 'a.py', status: 'applied', message: 'a1' },
      { file: 'b.py', status: 'applied', message: 'b1' },
      { file: 'a.py', status: 'failed', message: 'a2' },
    ];
    const out = matchSegmentsToResults(segments, results);
    expect(out[0].message).toBe('a1');
    expect(out[1].message).toBe('b1');
    expect(out[2].message).toBe('a2');
  });

  it('edit without matching result gets null', () => {
    const segments = [
      {
        type: 'edit',
        filePath: 'a.py',
        oldText: '',
        newText: '',
        isCreate: false,
      },
    ];
    const results = [{ file: 'b.py', status: 'applied' }];
    const out = matchSegmentsToResults(segments, results);
    expect(out[0]).toBeNull();
  });

  it('more segments than results for a file — extras get null', () => {
    const segments = [
      {
        type: 'edit',
        filePath: 'a.py',
        oldText: '',
        newText: '',
        isCreate: false,
      },
      {
        type: 'edit',
        filePath: 'a.py',
        oldText: '',
        newText: '',
        isCreate: false,
      },
    ];
    const results = [{ file: 'a.py', status: 'applied' }];
    const out = matchSegmentsToResults(segments, results);
    expect(out[0]).not.toBeNull();
    expect(out[1]).toBeNull();
  });

  it('malformed result entries skipped', () => {
    // Defensive — if the backend ever emits a result without
    // a file field (shouldn't happen, but belt and braces),
    // skip it rather than crashing.
    const segments = [
      {
        type: 'edit',
        filePath: 'a.py',
        oldText: '',
        newText: '',
        isCreate: false,
      },
    ];
    const results = [
      { status: 'applied' }, // no file
      null, // entirely bogus
      { file: 'a.py', status: 'applied', message: 'good' },
    ];
    const out = matchSegmentsToResults(segments, results);
    expect(out[0].message).toBe('good');
  });
});