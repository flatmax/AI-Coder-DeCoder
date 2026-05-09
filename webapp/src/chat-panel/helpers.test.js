// Pure-function tests for chat-panel helpers.
//
// `generateRequestId`, `parseAgentTabId`, the retry-prompt
// builders, and the localStorage load/save helpers are all
// exported from `chat-panel/index.js`. They have no DOM
// dependencies, so most tests here exercise them directly
// without mounting a panel.

import { describe, expect, it } from 'vitest';

import {
  generateRequestId,
  parseAgentTabId,
  _DRAWER_STORAGE_KEY,
  _SEARCH_IGNORE_CASE_KEY,
  _SEARCH_REGEX_KEY,
  _loadDrawerOpen,
  _loadSearchToggle,
  _saveDrawerOpen,
  _saveSearchToggle,
  buildAmbiguousRetryPrompt,
  buildInContextMismatchRetryPrompt,
  buildNotInContextRetryPrompt,
} from '../chat-panel/index.js';
import './test-helpers.js';

// ---------------------------------------------------------------------------
// generateRequestId
// ---------------------------------------------------------------------------

describe('generateRequestId', () => {
  it('has the epoch-ms-plus-suffix shape', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^\d+-[a-z0-9]{1,6}$/);
  });

  it('produces distinct IDs across calls', () => {
    // Even same-millisecond calls must differ — the random
    // suffix breaks ties.
    const ids = new Set();
    for (let i = 0; i < 100; i += 1) ids.add(generateRequestId());
    expect(ids.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// parseAgentTabId (C2b)
// ---------------------------------------------------------------------------

describe('parseAgentTabId', () => {
  // Per specs4/5-webapp/agent-browser.md and
  // specs4/7-future/parallel-agents.md § "Agent Reuse by
  // ID", agent identity is flat — the agent's LLM-chosen
  // id from its `🟧🟧🟧 AGENT` block IS the tab id IS the
  // backend registry key. parseAgentTabId returns the id
  // directly with no parsing. The literal "main" is
  // reserved for the main conversation; everything else
  // is treated as an agent id.

  it('returns null for the main tab', () => {
    // Untagged path — the caller drops the agent_tag
    // argument so the backend uses the main conversation.
    expect(parseAgentTabId('main')).toBeNull();
  });

  it('returns the id verbatim for descriptive agent ids', () => {
    // Real LLM-chosen ids look like "frontend-trivial",
    // "backend-auth-refactor", etc. The parser is the
    // identity function for any non-"main" string.
    expect(parseAgentTabId('frontend-trivial')).toBe(
      'frontend-trivial',
    );
    expect(parseAgentTabId('backend-auth-refactor')).toBe(
      'backend-auth-refactor',
    );
  });

  it('returns the id verbatim for short ids', () => {
    // The parser does not impose a minimum length or
    // require any specific shape — any non-empty non-
    // "main" string is a valid agent id.
    expect(parseAgentTabId('a')).toBe('a');
    expect(parseAgentTabId('agent-0')).toBe('agent-0');
  });

  it('preserves arbitrary characters in the id', () => {
    // The backend does not validate id shape beyond
    // non-emptiness, so the frontend parser shouldn't
    // either. Slashes, spaces, punctuation — all pass
    // through unchanged.
    expect(parseAgentTabId('a/b/c')).toBe('a/b/c');
    expect(parseAgentTabId('with spaces')).toBe('with spaces');
    expect(parseAgentTabId('punct!@#')).toBe('punct!@#');
  });

  it('returns null for empty string', () => {
    expect(parseAgentTabId('')).toBeNull();
  });

  it('returns null for non-string input', () => {
    // Defensive — tab IDs come from Map keys so should
    // always be strings, but malformed data shouldn't
    // crash the send path.
    expect(parseAgentTabId(null)).toBeNull();
    expect(parseAgentTabId(undefined)).toBeNull();
    expect(parseAgentTabId(42)).toBeNull();
    expect(parseAgentTabId({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Retry prompt builders (pure functions)
// ---------------------------------------------------------------------------

describe('buildAmbiguousRetryPrompt', () => {
  it('returns null for empty results', () => {
    expect(buildAmbiguousRetryPrompt([])).toBeNull();
  });

  it('returns null when no ambiguous failures present', () => {
    const results = [
      { file: 'a.py', status: 'applied' },
      { file: 'b.py', status: 'failed', error_type: 'anchor_not_found' },
    ];
    expect(buildAmbiguousRetryPrompt(results)).toBeNull();
  });

  it('builds prompt for a single ambiguous failure', () => {
    const results = [
      {
        file: 'src/foo.py',
        status: 'failed',
        error_type: 'ambiguous_anchor',
        message: 'Ambiguous match (3 locations)',
      },
    ];
    const prompt = buildAmbiguousRetryPrompt(results);
    expect(prompt).toContain('retry with more surrounding');
    expect(prompt).toContain('src/foo.py');
    expect(prompt).toContain('Ambiguous match (3 locations)');
  });

  it('builds prompt with multiple failures', () => {
    const results = [
      {
        file: 'a.py',
        error_type: 'ambiguous_anchor',
        message: 'match A',
      },
      {
        file: 'b.py',
        error_type: 'ambiguous_anchor',
        message: 'match B',
      },
    ];
    const prompt = buildAmbiguousRetryPrompt(results);
    // Both files named.
    expect(prompt).toContain('a.py');
    expect(prompt).toContain('b.py');
    // Both messages included.
    expect(prompt).toContain('match A');
    expect(prompt).toContain('match B');
  });

  it('ignores non-ambiguous entries mixed in', () => {
    const results = [
      { file: 'good.py', status: 'applied' },
      {
        file: 'bad.py',
        error_type: 'ambiguous_anchor',
        message: 'two matches',
      },
      {
        file: 'other.py',
        error_type: 'anchor_not_found',
      },
    ];
    const prompt = buildAmbiguousRetryPrompt(results);
    // Only bad.py appears.
    expect(prompt).toContain('bad.py');
    expect(prompt).not.toContain('good.py');
    expect(prompt).not.toContain('other.py');
  });

  it('handles missing file and message fields defensively', () => {
    const results = [
      { error_type: 'ambiguous_anchor' },
    ];
    const prompt = buildAmbiguousRetryPrompt(results);
    // Placeholder text for missing fields rather than
    // undefined appearing in the prompt.
    expect(prompt).toContain('(unknown file)');
    expect(prompt).toContain('Ambiguous match');
  });

  it('skips null entries in the results array', () => {
    // Defensive — malformed arrays from test fixtures
    // shouldn't crash.
    const results = [
      null,
      { error_type: 'ambiguous_anchor', file: 'a.py' },
    ];
    const prompt = buildAmbiguousRetryPrompt(results);
    expect(prompt).toContain('a.py');
  });
});

describe('buildInContextMismatchRetryPrompt', () => {
  it('returns null when no anchor_not_found failures', () => {
    const results = [
      { file: 'a.py', status: 'applied' },
      { file: 'b.py', error_type: 'ambiguous_anchor' },
    ];
    expect(
      buildInContextMismatchRetryPrompt(results, ['a.py', 'b.py']),
    ).toBeNull();
  });

  it('returns null when failures are on files NOT in context', () => {
    // anchor_not_found on a file that isn't selected —
    // the not-in-context path handles this, not us.
    const results = [
      {
        file: 'not-selected.py',
        error_type: 'anchor_not_found',
      },
    ];
    expect(
      buildInContextMismatchRetryPrompt(results, ['other.py']),
    ).toBeNull();
  });

  it('builds prompt when in-context file has anchor_not_found', () => {
    const results = [
      {
        file: 'selected.py',
        error_type: 'anchor_not_found',
        message: 'Old text not found',
      },
    ];
    const prompt = buildInContextMismatchRetryPrompt(
      results,
      ['selected.py'],
    );
    expect(prompt).toContain('already in');
    expect(prompt).toContain('selected.py');
    expect(prompt).toContain('re-read');
  });

  it('distinguishes in-context from not-in-context in same result', () => {
    // Two failures — one on a selected file, one not.
    // Only the selected one appears in the prompt.
    const results = [
      {
        file: 'selected.py',
        error_type: 'anchor_not_found',
        message: 'text missing',
      },
      {
        file: 'other.py',
        error_type: 'anchor_not_found',
        message: 'text missing',
      },
    ];
    const prompt = buildInContextMismatchRetryPrompt(
      results,
      ['selected.py'],
    );
    expect(prompt).toContain('selected.py');
    expect(prompt).not.toContain('other.py');
  });

  it('empty selectedFiles means empty in-context set', () => {
    const results = [
      { file: 'a.py', error_type: 'anchor_not_found' },
    ];
    expect(
      buildInContextMismatchRetryPrompt(results, []),
    ).toBeNull();
  });

  it('ignores ambiguous-anchor failures', () => {
    // anchor_not_found is the trigger; ambiguous is
    // handled elsewhere.
    const results = [
      {
        file: 'selected.py',
        error_type: 'ambiguous_anchor',
        message: 'two matches',
      },
    ];
    expect(
      buildInContextMismatchRetryPrompt(
        results,
        ['selected.py'],
      ),
    ).toBeNull();
  });

  it('handles missing message field defensively', () => {
    const results = [
      {
        file: 'selected.py',
        error_type: 'anchor_not_found',
      },
    ];
    const prompt = buildInContextMismatchRetryPrompt(
      results,
      ['selected.py'],
    );
    // Placeholder rather than "undefined" in the text.
    expect(prompt).toContain('Old text not found');
  });
});

describe('buildNotInContextRetryPrompt', () => {
  it('returns null when files_auto_added is empty', () => {
    expect(buildNotInContextRetryPrompt([])).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(buildNotInContextRetryPrompt(null)).toBeNull();
    expect(buildNotInContextRetryPrompt(undefined)).toBeNull();
  });

  it('builds singular prompt for a single file', () => {
    const prompt = buildNotInContextRetryPrompt(['src/foo.py']);
    expect(prompt).toContain('The file src/foo.py');
    expect(prompt).toContain('has been added');
    expect(prompt).toContain('src/foo.py');
  });

  it('builds plural prompt for multiple files', () => {
    const prompt = buildNotInContextRetryPrompt([
      'a.py',
      'b.py',
      'c.py',
    ]);
    expect(prompt).toContain('The files a.py, b.py, c.py');
    expect(prompt).toContain('have been added');
  });

  it('filters non-string and empty entries', () => {
    const prompt = buildNotInContextRetryPrompt([
      'real.py',
      '',
      null,
      undefined,
    ]);
    expect(prompt).toContain('The file real.py');
    // Returns singular form — only one real file.
    expect(prompt).toContain('has been added');
  });

  it('returns null when filtered list ends up empty', () => {
    expect(
      buildNotInContextRetryPrompt(['', null, undefined]),
    ).toBeNull();
  });

  it('uses correct verb form for single vs multiple', () => {
    const single = buildNotInContextRetryPrompt(['a.py']);
    expect(single).toContain(' has ');
    expect(single).not.toContain(' have ');
    const multi = buildNotInContextRetryPrompt(['a.py', 'b.py']);
    expect(multi).toContain(' have ');
    expect(multi).not.toContain(' has ');
  });
});

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

describe('drawer / search-toggle persistence', () => {
  it('drawer defaults to closed when localStorage has no value', () => {
    expect(_loadDrawerOpen()).toBe(false);
  });

  it('drawer defaults to closed for unrecognised localStorage value', () => {
    // Defensive — a value that isn't 'true' should parse as
    // false rather than anything weird.
    localStorage.setItem(_DRAWER_STORAGE_KEY, 'maybe');
    expect(_loadDrawerOpen()).toBe(false);
  });

  it('drawer round-trips via save/load', () => {
    _saveDrawerOpen(true);
    expect(_loadDrawerOpen()).toBe(true);
    _saveDrawerOpen(false);
    expect(_loadDrawerOpen()).toBe(false);
  });

  it('search ignore-case defaults to true when no stored value', () => {
    expect(
      _loadSearchToggle(_SEARCH_IGNORE_CASE_KEY, true),
    ).toBe(true);
  });

  it('search regex defaults to false when no stored value', () => {
    expect(_loadSearchToggle(_SEARCH_REGEX_KEY, false)).toBe(false);
  });

  it('search toggle round-trips via save/load', () => {
    _saveSearchToggle(_SEARCH_REGEX_KEY, true);
    expect(_loadSearchToggle(_SEARCH_REGEX_KEY, false)).toBe(true);
  });

  it('search toggle malformed localStorage value falls back to default', () => {
    localStorage.setItem(_SEARCH_REGEX_KEY, 'maybe');
    expect(_loadSearchToggle(_SEARCH_REGEX_KEY, false)).toBe(false);
  });
});