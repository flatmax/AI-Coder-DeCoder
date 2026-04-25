// Tests for webapp/src/edit-block-render.js — pure renderers.
//
// Strategy: string-shape assertions. Every function returns
// plain HTML strings, so we check for substring presence,
// attribute correctness, and escaping behaviour without
// parsing the HTML. Where DOM semantics matter (e.g. "the
// error message appears AFTER the body"), we check substring
// ordering via indexOf comparison.
//
// No DOM mount, no Lit. The renderer is deliberately pure so
// this test file stays fast and stable regardless of whether
// the chat panel's integration tests break.

import { describe, expect, it } from 'vitest';

import {
  STATUS_META,
  renderEditBody,
  renderEditCard,
  renderErrorMessage,
  renderFilePath,
  renderStatusBadge,
  resolveDisplayStatus,
} from './edit-block-render.js';

// ---------------------------------------------------------------------------
// STATUS_META
// ---------------------------------------------------------------------------

describe('STATUS_META', () => {
  // Every status documented in specs4/3-llm/edit-protocol.md's
  // "Per-Block Results" table must be in the map, plus the
  // two frontend-only synthetic statuses.
  const REQUIRED_KEYS = [
    'applied',
    'already_applied',
    'validated',
    'failed',
    'skipped',
    'not_in_context',
    // Frontend synthetic:
    'pending',
    'new',
  ];

  it.each(REQUIRED_KEYS)('has an entry for %s', (key) => {
    expect(STATUS_META).toHaveProperty(key);
    const meta = STATUS_META[key];
    expect(typeof meta.icon).toBe('string');
    expect(typeof meta.label).toBe('string');
    expect(typeof meta.cssClass).toBe('string');
    // CSS class convention: always edit-status-{key-or-variant}
    // so a stylesheet can hook by class selector. Don't pin the
    // exact class string because some keys share a class
    // (applied + already_applied → edit-status-applied).
    expect(meta.cssClass).toMatch(/^edit-status-/);
  });

  it('does NOT have entries for undocumented statuses', () => {
    // Guard against a future refactor that adds a key without
    // updating specs3/specs4 or the README. Catches typo
    // variants too (`not-in-context` vs `not_in_context`).
    const extra = Object.keys(STATUS_META).filter(
      (k) => !REQUIRED_KEYS.includes(k),
    );
    expect(extra).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveDisplayStatus
// ---------------------------------------------------------------------------

describe('resolveDisplayStatus', () => {
  const EDIT_SEG = {
    type: 'edit',
    filePath: 'a.py',
    oldText: 'x',
    newText: 'y',
    isCreate: false,
  };
  const CREATE_SEG = {
    type: 'edit',
    filePath: 'a.py',
    oldText: '',
    newText: 'y',
    isCreate: true,
  };
  const PENDING_SEG = {
    type: 'edit-pending',
    filePath: 'a.py',
    phase: 'reading-new',
    oldText: 'x',
    newText: 'part',
  };

  it('pending segment always resolves to pending, even with a result', () => {
    // Defensive — a pending segment shouldn't have a result
    // (the backend hasn't seen it yet), but if one somehow
    // leaks through, the pending shape still wins. The stream
    // is still in flight from the user's perspective.
    const r = { status: 'applied' };
    expect(resolveDisplayStatus(PENDING_SEG, r)).toBe('pending');
    expect(resolveDisplayStatus(PENDING_SEG, null)).toBe('pending');
  });

  it('backend result status wins for modify segments', () => {
    expect(
      resolveDisplayStatus(EDIT_SEG, { status: 'applied' }),
    ).toBe('applied');
    expect(
      resolveDisplayStatus(EDIT_SEG, { status: 'failed' }),
    ).toBe('failed');
    expect(
      resolveDisplayStatus(EDIT_SEG, { status: 'not_in_context' }),
    ).toBe('not_in_context');
  });

  it('backend result status wins for create segments', () => {
    // A create segment with a backend result uses the result's
    // status, not the synthetic "new". This matters because a
    // create block can fail (target already exists with
    // different content, permission denied) and the user should
    // see the failure, not "new".
    expect(
      resolveDisplayStatus(CREATE_SEG, { status: 'applied' }),
    ).toBe('applied');
    expect(
      resolveDisplayStatus(CREATE_SEG, { status: 'failed' }),
    ).toBe('failed');
  });

  it('create segment with no result → new', () => {
    expect(resolveDisplayStatus(CREATE_SEG, null)).toBe('new');
  });

  it('modify segment with no result → pending', () => {
    // Either the stream is still in flight, or the backend
    // didn't emit a result for this specific block. Either
    // way, "not yet settled" is what the user needs to see.
    expect(resolveDisplayStatus(EDIT_SEG, null)).toBe('pending');
  });

  it('unknown backend status passes through', () => {
    // renderStatusBadge is responsible for the unknown-status
    // fallback rendering; resolve just propagates. Ensures a
    // future backend status like "conflict" surfaces with its
    // real name rather than getting silently mapped.
    expect(
      resolveDisplayStatus(EDIT_SEG, { status: 'conflict' }),
    ).toBe('conflict');
  });

  it('result without a status string is ignored', () => {
    // Defensive — a malformed result (status field missing or
    // non-string) shouldn't crash. Falls through to the
    // segment-based resolution.
    expect(resolveDisplayStatus(EDIT_SEG, {})).toBe('pending');
    expect(resolveDisplayStatus(EDIT_SEG, { status: 42 })).toBe(
      'pending',
    );
    expect(resolveDisplayStatus(CREATE_SEG, {})).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// renderStatusBadge
// ---------------------------------------------------------------------------

describe('renderStatusBadge', () => {
  it('renders a span with icon and label for known status', () => {
    const html = renderStatusBadge('applied');
    expect(html).toContain('edit-status-badge');
    expect(html).toContain('edit-status-applied');
    expect(html).toContain(STATUS_META.applied.icon);
    expect(html).toContain('Applied');
  });

  it('includes both icon and label sub-spans', () => {
    const html = renderStatusBadge('failed');
    expect(html).toContain('edit-status-icon');
    expect(html).toContain('edit-status-label');
  });

  it('uses fallback rendering for unknown status', () => {
    // The generic clipboard emoji signals "unexpected status"
    // without crashing. The raw status string appears as the
    // label so the user sees what came through.
    const html = renderStatusBadge('mystery_status');
    expect(html).toContain('📋');
    expect(html).toContain('mystery_status');
    expect(html).toContain('edit-status-unknown');
  });

  it('escapes HTML in the label for unknown status', () => {
    // Unknown statuses could theoretically include
    // inject-shaped content if a misbehaving backend got
    // creative. The label goes through escapeHtml so the
    // rendered span never introduces markup.
    const html = renderStatusBadge('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in the label for known status too', () => {
    // Defensive — even known statuses go through escaping.
    // The label strings in STATUS_META are static and safe,
    // but a future edit that adds an unsafe character
    // shouldn't silently inject.
    // Check that the Applied label passes through cleanly
    // (no accidental double-escaping of the safe characters).
    const html = renderStatusBadge('applied');
    expect(html).toContain('Applied');
    // No entities introduced for the plain alpha label.
    expect(html).not.toContain('&amp;');
  });
});

// ---------------------------------------------------------------------------
// renderFilePath
// ---------------------------------------------------------------------------

describe('renderFilePath', () => {
  it('wraps the path in a span with the expected class', () => {
    const html = renderFilePath('src/foo.py');
    expect(html).toContain('edit-file-path');
    expect(html).toContain('src/foo.py');
  });

  it('escapes HTML-sensitive characters in the path', () => {
    // LLM can produce any string on the path line that
    // matches the parser's isFilePath heuristic. Pathological
    // paths with angle brackets would inject if not escaped.
    const html = renderFilePath('<script>.py');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('handles empty string', () => {
    const html = renderFilePath('');
    expect(html).toContain('edit-file-path');
  });

  it('coerces non-string input to empty', () => {
    // Defensive — a malformed segment with a null filePath
    // shouldn't crash the renderer.
    const html = renderFilePath(null);
    expect(html).toContain('edit-file-path');
    // The span is empty but well-formed.
    expect(html).toMatch(/<span[^>]*>\s*<\/span>/);
  });

  it('preserves forward slashes unescaped', () => {
    // Forward slashes aren't HTML-sensitive; escaping them
    // would be overzealous and harder to read in source view.
    const html = renderFilePath('a/b/c.py');
    expect(html).toContain('a/b/c.py');
  });

  it('escapes ampersands and quotes', () => {
    const html = renderFilePath(`foo & "bar".py`);
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
    // The original unescaped substrings must not appear —
    // entity encoding is all-or-nothing. If either slips
    // through, the rendered card would break layout
    // (raw `"` inside an HTML attribute) or render wrong
    // (raw `&` in text is rendered as-is by browsers but
    // flags a validator and breaks round-trip).
    expect(html).not.toContain(' & ');
    expect(html).not.toContain('"bar"');
  });
});

// ---------------------------------------------------------------------------
// renderEditBody
// ---------------------------------------------------------------------------

describe('renderEditBody', () => {
  it('renders both OLD and NEW panes when both have content', () => {
    const seg = {
      type: 'edit',
      filePath: 'a.py',
      oldText: 'old content',
      newText: 'new content',
      isCreate: false,
    };
    const html = renderEditBody(seg);
    expect(html).toContain('edit-pane-old');
    expect(html).toContain('edit-pane-new');
    // Content lives inside diff-line spans now. The two
    // input lines differ by one word, which the word-level
    // diff wraps in a `<span class="diff-change">`. The
    // full `old content` substring no longer exists as a
    // contiguous run — `old` and `content` get split
    // across the change span and the equal-tail.
    //
    // Checking each token individually proves they both
    // surfaced without pinning the exact highlighting shape.
    expect(html).toContain('old');
    expect(html).toContain('new');
    expect(html).toContain('content');
    // Both panes have structural markers.
    expect(html).toContain('diff-line');
    expect(html).toContain('diff-change');
  });

  it('suppresses OLD pane when oldText is empty', () => {
    // Create blocks and pending-in-reading-old segments with
    // empty buffers both skip this pane.
    const seg = {
      type: 'edit',
      filePath: 'a.py',
      oldText: '',
      newText: 'new content',
      isCreate: true,
    };
    const html = renderEditBody(seg);
    expect(html).not.toContain('edit-pane-old');
    expect(html).toContain('edit-pane-new');
    expect(html).toContain('new content');
  });

  it('always renders NEW pane, even when empty', () => {
    // Predictable layout: during a fresh pending segment in
    // the reading-old phase with no content yet, the NEW pane
    // is still there as a placeholder. Gives the streaming
    // cursor somewhere to live visually.
    const seg = {
      type: 'edit-pending',
      filePath: 'a.py',
      phase: 'reading-old',
      oldText: '',
      newText: '',
    };
    const html = renderEditBody(seg);
    expect(html).toContain('edit-pane-new');
    expect(html).not.toContain('edit-pane-old');
  });

  it('labels each pane with OLD / NEW', () => {
    const seg = {
      type: 'edit',
      filePath: 'a.py',
      oldText: 'o',
      newText: 'n',
      isCreate: false,
    };
    const html = renderEditBody(seg);
    expect(html).toContain('>OLD<');
    expect(html).toContain('>NEW<');
  });

  it('escapes HTML in OLD and NEW content', () => {
    // LLM output could contain angle brackets (legitimately,
    // in TypeScript generics or JSX). Must be escaped so the
    // card's visual representation matches the source.
    //
    // The word-level differ splits these lines at the
    // `1`/`2` digit (the only changed token), so the full
    // `<Foo bar="1">` escaped string exists with a
    // `<span class="diff-change">` break around the digit.
    // We pin the escaped delimiter pieces individually
    // instead — proves nothing leaked as raw markup.
    const seg = {
      type: 'edit',
      filePath: 'a.ts',
      oldText: '<Foo bar="1">',
      newText: '<Foo bar="2">',
      isCreate: false,
    };
    const html = renderEditBody(seg);
    // Escaped delimiters present on both sides.
    expect(html).toContain('&lt;Foo bar=&quot;');
    expect(html).toContain('&quot;&gt;');
    // Both digits present (each wrapped in its own diff-
    // change span on its respective side).
    expect(html).toContain('1');
    expect(html).toContain('2');
    // No raw markup sneaks through.
    expect(html).not.toContain('<Foo');
    expect(html).not.toContain('bar="1"');
    expect(html).not.toContain('bar="2"');
  });

  it('preserves every input line as a distinct diff-line', () => {
    // Two-line input produces two sibling `<span class=
    // "diff-line ...">` elements per pane. Line content
    // appears inside `<span class="diff-text">` children —
    // newlines between spans are structural, not textual.
    const seg = {
      type: 'edit',
      filePath: 'a.py',
      oldText: 'line one\nline two',
      newText: 'line one\nline three',
      isCreate: false,
    };
    const html = renderEditBody(seg);
    // The shared `line one` survives as a single unbroken
    // substring (no change to highlight).
    expect(html).toContain('line one');
    // The changed lines have their differing word wrapped
    // in a `diff-change` span, so `line two` and `line
    // three` won't appear as contiguous substrings. The
    // unchanged prefix `line ` survives on each side, and
    // the changed tokens each appear once.
    expect(html).toContain('line ');
    expect(html).toContain('two');
    expect(html).toContain('three');
    // Exactly one diff-line per input line per pane.
    // OLD pane: 1 context + 1 remove. NEW pane: 1 context
    // + 1 add. Four diff-line elements total.
    const diffLineMatches = html.match(/class="diff-line/g) || [];
    expect(diffLineMatches).toHaveLength(4);
    // The divergent lines each get their own row with the
    // expected class.
    expect(html).toContain('diff-line remove');
    expect(html).toContain('diff-line add');
    // Context appears in both panes — at least two
    // instances.
    const contextMatches = html.match(/diff-line context/g) || [];
    expect(contextMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('handles non-string oldText and newText defensively', () => {
    // A malformed segment shouldn't crash the renderer.
    const seg = {
      type: 'edit',
      filePath: 'a.py',
      oldText: null,
      newText: undefined,
      isCreate: false,
    };
    const html = renderEditBody(seg);
    // Both coerced to empty. No OLD pane (empty), NEW pane
    // renders empty.
    expect(html).not.toContain('edit-pane-old');
    expect(html).toContain('edit-pane-new');
  });

  it('wraps panes in edit-body container', () => {
    const seg = {
      type: 'edit',
      filePath: 'a.py',
      oldText: 'o',
      newText: 'n',
      isCreate: false,
    };
    const html = renderEditBody(seg);
    expect(html).toMatch(/<div class="edit-body">/);
  });
});

// ---------------------------------------------------------------------------
// renderErrorMessage
// ---------------------------------------------------------------------------

describe('renderErrorMessage', () => {
  it('renders message for failed status', () => {
    const html = renderErrorMessage({
      status: 'failed',
      message: 'Anchor not found',
    });
    expect(html).toContain('edit-error-message');
    expect(html).toContain('Anchor not found');
  });

  it('renders message for skipped status', () => {
    const html = renderErrorMessage({
      status: 'skipped',
      message: 'Binary file',
    });
    expect(html).toContain('Binary file');
  });

  it('renders message for not_in_context status', () => {
    const html = renderErrorMessage({
      status: 'not_in_context',
      message: 'File was auto-added',
    });
    expect(html).toContain('File was auto-added');
  });

  it('suppresses for applied status (even with a message)', () => {
    // Success paths sometimes carry diagnostic messages
    // (normalisation notes, etc.) that would be noise in the
    // happy-path card.
    expect(
      renderErrorMessage({ status: 'applied', message: 'Note: x' }),
    ).toBe('');
    expect(
      renderErrorMessage({
        status: 'already_applied',
        message: 'Note',
      }),
    ).toBe('');
  });

  it('suppresses for validated status', () => {
    expect(
      renderErrorMessage({ status: 'validated', message: 'm' }),
    ).toBe('');
  });

  it('suppresses for failure status with empty message', () => {
    // A failed edit with no message is a programming error
    // upstream, but we don't want an empty error box — just
    // the status badge is informative enough.
    expect(
      renderErrorMessage({ status: 'failed', message: '' }),
    ).toBe('');
    expect(
      renderErrorMessage({ status: 'skipped', message: null }),
    ).toBe('');
  });

  it('suppresses for null result', () => {
    expect(renderErrorMessage(null)).toBe('');
    expect(renderErrorMessage(undefined)).toBe('');
  });

  it('escapes HTML in the message', () => {
    const html = renderErrorMessage({
      status: 'failed',
      message: 'Error: <script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('handles result without a status field', () => {
    // Defensive — malformed shape shouldn't crash.
    expect(renderErrorMessage({ message: 'orphan' })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// renderEditCard
// ---------------------------------------------------------------------------

describe('renderEditCard', () => {
  const EDIT_SEG = {
    type: 'edit',
    filePath: 'src/foo.py',
    oldText: 'old',
    newText: 'new',
    isCreate: false,
  };

  it('returns a single edit-block-card div', () => {
    const html = renderEditCard(EDIT_SEG, null);
    expect(html).toMatch(/^<div class="edit-block-card/);
    expect(html.trim()).toMatch(/<\/div>$/);
  });

  it('applies status CSS class to the root div', () => {
    // Allows a single-selector rule to theme the whole card
    // based on outcome without the renderer knowing colours.
    const applied = renderEditCard(EDIT_SEG, { status: 'applied' });
    expect(applied).toContain('edit-status-applied');
    const failed = renderEditCard(EDIT_SEG, { status: 'failed' });
    expect(failed).toContain('edit-status-failed');
  });

  it('includes header with file path and badge', () => {
    const html = renderEditCard(EDIT_SEG, null);
    expect(html).toContain('edit-card-header');
    expect(html).toContain('edit-file-path');
    expect(html).toContain('edit-status-badge');
    expect(html).toContain('src/foo.py');
  });

  it('includes body with OLD and NEW panes', () => {
    const html = renderEditCard(EDIT_SEG, null);
    expect(html).toContain('edit-body');
    expect(html).toContain('edit-pane-old');
    expect(html).toContain('edit-pane-new');
  });

  it('includes error message for failed edits', () => {
    const html = renderEditCard(EDIT_SEG, {
      status: 'failed',
      message: 'Anchor not unique',
    });
    expect(html).toContain('edit-error-message');
    expect(html).toContain('Anchor not unique');
  });

  it('omits error message for successful edits', () => {
    const html = renderEditCard(EDIT_SEG, { status: 'applied' });
    expect(html).not.toContain('edit-error-message');
  });

  it('renders create block with NEW pane only', () => {
    const createSeg = {
      type: 'edit',
      filePath: 'src/new.py',
      oldText: '',
      newText: 'print("hi")',
      isCreate: true,
    };
    const html = renderEditCard(createSeg, null);
    expect(html).toContain('edit-status-new');
    expect(html).not.toContain('edit-pane-old');
    expect(html).toContain('edit-pane-new');
  });

  it('renders pending segment with pending status', () => {
    const pendingSeg = {
      type: 'edit-pending',
      filePath: 'src/foo.py',
      phase: 'reading-new',
      oldText: 'o',
      newText: 'partial',
    };
    const html = renderEditCard(pendingSeg, null);
    expect(html).toContain('edit-status-pending');
  });

  it('handles segment with missing filePath defensively', () => {
    // A malformed segment (shouldn't happen from the parser
    // but defensive anyway) renders with a placeholder path
    // rather than crashing.
    const seg = {
      type: 'edit',
      oldText: 'o',
      newText: 'n',
      isCreate: false,
    };
    const html = renderEditCard(seg, null);
    expect(html).toContain('unknown path');
  });

  it('header appears before body, body before error', () => {
    // Pin the structural order. A CSS-based approach could
    // reorder via flex-direction, but the DOM should match
    // the reading order so screen readers and source-view
    // inspection show the natural flow.
    const html = renderEditCard(EDIT_SEG, {
      status: 'failed',
      message: 'boom',
    });
    const headerIdx = html.indexOf('edit-card-header');
    const bodyIdx = html.indexOf('edit-body');
    const errorIdx = html.indexOf('edit-error-message');
    expect(headerIdx).toBeGreaterThan(-1);
    expect(bodyIdx).toBeGreaterThan(headerIdx);
    expect(errorIdx).toBeGreaterThan(bodyIdx);
  });

  it('unknown backend status renders without crashing', () => {
    // Future-proofing — a new EditStatus variant that the
    // frontend hasn't learned about yet should render with
    // the fallback icon and the raw status name.
    const html = renderEditCard(EDIT_SEG, {
      status: 'conflict',
      message: 'merge needed',
    });
    expect(html).toContain('📋');
    expect(html).toContain('conflict');
    // Error message still renders — 'conflict' isn't in the
    // suppress-list, but it's also not in the failure list.
    // Defensive choice: unknown status doesn't show error
    // message (matches the success-side suppression).
    expect(html).not.toContain('edit-error-message');
  });
});

// ---------------------------------------------------------------------------
// Two-level diff internals — pinned against the edit body
// renderer so regressions in the pairing / line-splitting
// logic surface immediately rather than as visual diff noise.
// ---------------------------------------------------------------------------

// Re-import the internals. They're exported with a leading
// underscore to flag "not public API" while still allowing
// focused unit tests.
import {
  _computeDiff,
  _computeCharDiff,
  _pairDiffLines,
} from './edit-block-render.js';

describe('_computeDiff', () => {
  it('returns empty array for two empty buffers', () => {
    // Empty-empty is the "pending segment with no content
    // yet" case; renderEditBody uses this to skip both
    // panes in the NEW-only pending path.
    expect(_computeDiff('', '')).toEqual([]);
  });

  it('classifies unchanged lines as context', () => {
    const out = _computeDiff('a\nb', 'a\nb');
    expect(out.every((l) => l.type === 'context')).toBe(true);
    expect(out.map((l) => l.text)).toEqual(['a', 'b']);
  });

  it('classifies added-only content as add', () => {
    // Empty → non-empty produces all-add lines. Create
    // blocks land on this path.
    const out = _computeDiff('', 'a\nb');
    expect(out.every((l) => l.type === 'add')).toBe(true);
    expect(out.map((l) => l.text)).toEqual(['a', 'b']);
  });

  it('classifies removed-only content as remove', () => {
    const out = _computeDiff('a\nb', '');
    expect(out.every((l) => l.type === 'remove')).toBe(true);
    expect(out.map((l) => l.text)).toEqual(['a', 'b']);
  });

  it('interleaves context, remove, and add', () => {
    // Classic patch shape — unchanged header, changed
    // middle, unchanged footer. Ordering must preserve
    // source position so rendered panes show lines in
    // the expected places.
    const out = _computeDiff(
      'header\nold middle\nfooter',
      'header\nnew middle\nfooter',
    );
    const types = out.map((l) => l.type);
    const texts = out.map((l) => l.text);
    expect(types).toContain('context');
    expect(types).toContain('remove');
    expect(types).toContain('add');
    expect(texts).toContain('header');
    expect(texts).toContain('old middle');
    expect(texts).toContain('new middle');
    expect(texts).toContain('footer');
  });

  it('strips the trailing empty-line marker from each run', () => {
    // `diffLines` reports each run as a single string
    // ending with `\n`; splitting on `\n` yields a trailing
    // empty element that isn't a real line. The helper
    // drops it so `out.length` matches the user's line
    // count.
    const out = _computeDiff('a\nb\n', 'a\nb\n');
    expect(out).toHaveLength(2);
    expect(out.every((l) => l.text !== '')).toBe(true);
  });

  it('handles non-string inputs defensively', () => {
    // A malformed segment shouldn't crash the pipeline.
    expect(_computeDiff(null, undefined)).toEqual([]);
    expect(_computeDiff(null, 'a')).toEqual([
      { type: 'add', text: 'a' },
    ]);
  });
});

describe('_computeCharDiff', () => {
  it('marks identical strings as all equal on both sides', () => {
    const out = _computeCharDiff('foo bar', 'foo bar');
    expect(out.old).toEqual([{ type: 'equal', text: 'foo bar' }]);
    expect(out.new).toEqual([{ type: 'equal', text: 'foo bar' }]);
  });

  it('splits a single-word change into equal+delete / equal+insert', () => {
    const out = _computeCharDiff('foo bar baz', 'foo qux baz');
    // Old side: 'foo ', delete 'bar', ' baz' (the equals
    // may be merged into leading/trailing context).
    expect(out.old.some((s) => s.type === 'delete' && /bar/.test(s.text))).toBe(
      true,
    );
    expect(
      out.new.some((s) => s.type === 'insert' && /qux/.test(s.text)),
    ).toBe(true);
    // Bookends are equal.
    expect(out.old.some((s) => s.type === 'equal' && /foo/.test(s.text))).toBe(
      true,
    );
    expect(out.new.some((s) => s.type === 'equal' && /baz/.test(s.text))).toBe(
      true,
    );
  });

  it('merges adjacent same-type segments', () => {
    // diffWords can output multiple consecutive equal
    // runs (space-separated tokens as separate segments).
    // _mergeAdjacent collapses them so no two adjacent
    // segments share a type.
    const out = _computeCharDiff('the quick brown fox', 'the quick brown fox');
    for (let i = 1; i < out.old.length; i += 1) {
      expect(out.old[i].type).not.toBe(out.old[i - 1].type);
    }
    for (let i = 1; i < out.new.length; i += 1) {
      expect(out.new[i].type).not.toBe(out.new[i - 1].type);
    }
  });

  it('handles empty inputs', () => {
    // Two empty strings — `diffWords('', '')` emits a
    // single equal segment with empty text, so both sides
    // carry one harmless equal segment. Rendering treats
    // empty `equal` text as the no-op it is.
    const both = _computeCharDiff('', '');
    expect(both.old.every((s) => s.type === 'equal')).toBe(true);
    expect(both.new.every((s) => s.type === 'equal')).toBe(true);
    expect(both.old.map((s) => s.text).join('')).toBe('');
    expect(both.new.map((s) => s.text).join('')).toBe('');
    // Empty → non-empty: all new content is insert.
    const addOnly = _computeCharDiff('', 'hello');
    expect(addOnly.new.some((s) => s.type === 'insert')).toBe(true);
    expect(addOnly.new.map((s) => s.text).join('')).toBe('hello');
    // Old side has no delete segments because there was
    // nothing to delete.
    expect(addOnly.old.every((s) => s.type !== 'delete')).toBe(true);
  });

  it('handles non-string inputs defensively', () => {
    // Null/undefined coerced to empty strings. Same
    // output shape as the two-empty case — one harmless
    // equal segment per side, empty text. The important
    // property is "doesn't throw".
    const out = _computeCharDiff(null, undefined);
    expect(out.old.every((s) => s.type === 'equal')).toBe(true);
    expect(out.new.every((s) => s.type === 'equal')).toBe(true);
    expect(out.old.map((s) => s.text).join('')).toBe('');
    expect(out.new.map((s) => s.text).join('')).toBe('');
  });
});

describe('_pairDiffLines', () => {
  // Pairing turns "N removes followed by N adds" into
  // charDiff-annotated line pairs. Asymmetric runs or
  // runs not adjacent to each other leave lines unpaired.

  const line = (type, text) => ({ type, text });

  it('leaves context-only input untouched', () => {
    const input = [line('context', 'a'), line('context', 'b')];
    const out = _pairDiffLines(input);
    expect(out).toEqual(input);
    expect(out[0].charDiff).toBeUndefined();
  });

  it('pairs matched remove+add runs 1:1 in order', () => {
    const input = [
      line('remove', 'foo'),
      line('remove', 'bar'),
      line('add', 'foo!'),
      line('add', 'bar?'),
    ];
    const out = _pairDiffLines(input);
    // Both remove lines pair with the corresponding add
    // lines.
    expect(out[0].charDiff).toBeDefined();
    expect(out[1].charDiff).toBeDefined();
    expect(out[2].charDiff).toBeDefined();
    expect(out[3].charDiff).toBeDefined();
    // The pairing is 1:1 in order — the first remove pairs
    // with the first add, second with second.
    expect(out[0].charDiff).toBe(out[2].charDiff);
    expect(out[1].charDiff).toBe(out[3].charDiff);
  });

  it('leaves excess removes unpaired when removes > adds', () => {
    const input = [
      line('remove', 'x'),
      line('remove', 'y'),
      line('remove', 'z'),
      line('add', 'X'),
    ];
    const out = _pairDiffLines(input);
    // First remove pairs with the sole add.
    expect(out[0].charDiff).toBeDefined();
    // Second and third removes have no partner.
    expect(out[1].charDiff).toBeUndefined();
    expect(out[2].charDiff).toBeUndefined();
    // Add is paired.
    expect(out[3].charDiff).toBeDefined();
  });

  it('leaves excess adds unpaired when adds > removes', () => {
    const input = [
      line('remove', 'x'),
      line('add', 'X'),
      line('add', 'Y'),
      line('add', 'Z'),
    ];
    const out = _pairDiffLines(input);
    expect(out[0].charDiff).toBeDefined();
    expect(out[1].charDiff).toBeDefined();
    expect(out[2].charDiff).toBeUndefined();
    expect(out[3].charDiff).toBeUndefined();
  });

  it('does not pair across a context line', () => {
    // A context line breaks the adjacency rule. The remove
    // and add must be adjacent for pairing to fire.
    const input = [
      line('remove', 'x'),
      line('context', 'middle'),
      line('add', 'X'),
    ];
    const out = _pairDiffLines(input);
    expect(out[0].charDiff).toBeUndefined();
    expect(out[2].charDiff).toBeUndefined();
  });

  it('does not pair add-before-remove', () => {
    // The pairing rule is "N removes THEN N adds". An add
    // preceding a remove is a different change shape.
    const input = [line('add', 'X'), line('remove', 'x')];
    const out = _pairDiffLines(input);
    expect(out[0].charDiff).toBeUndefined();
    expect(out[1].charDiff).toBeUndefined();
  });

  it('handles multiple pair groups in one diff', () => {
    // Two independent pair groups separated by context.
    const input = [
      line('remove', 'a'),
      line('add', 'A'),
      line('context', 'same'),
      line('remove', 'b'),
      line('add', 'B'),
    ];
    const out = _pairDiffLines(input);
    expect(out[0].charDiff).toBeDefined();
    expect(out[1].charDiff).toBeDefined();
    expect(out[3].charDiff).toBeDefined();
    expect(out[4].charDiff).toBeDefined();
    // The two groups use different charDiff objects.
    expect(out[0].charDiff).not.toBe(out[3].charDiff);
  });

  it('returns a fresh array (does not mutate input)', () => {
    const input = [line('remove', 'x'), line('add', 'X')];
    const snapshot = JSON.parse(JSON.stringify(input));
    _pairDiffLines(input);
    expect(input).toEqual(snapshot);
  });
});