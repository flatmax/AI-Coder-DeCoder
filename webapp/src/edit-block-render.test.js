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
    expect(html).toContain('old content');
    expect(html).toContain('new content');
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
    const seg = {
      type: 'edit',
      filePath: 'a.ts',
      oldText: '<Foo bar="1">',
      newText: '<Foo bar="2">',
      isCreate: false,
    };
    const html = renderEditBody(seg);
    expect(html).toContain('&lt;Foo bar=&quot;1&quot;&gt;');
    expect(html).toContain('&lt;Foo bar=&quot;2&quot;&gt;');
    // And no raw markup sneaks through.
    expect(html).not.toContain('<Foo');
  });

  it('preserves newlines in content', () => {
    // The <pre> element preserves whitespace. Multi-line
    // edits are common; the renderer must not collapse them.
    const seg = {
      type: 'edit',
      filePath: 'a.py',
      oldText: 'line one\nline two',
      newText: 'line one\nline three',
      isCreate: false,
    };
    const html = renderEditBody(seg);
    expect(html).toContain('line one\nline two');
    expect(html).toContain('line one\nline three');
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