// @vitest-environment jsdom
//
// Agent tab label derivation — boundary and regression
// tests for `deriveAgentTabLabel`. The helper is pure
// (no DOM, no RPC), so these tests run under jsdom only
// because the parent module pulls in Lit on import.

import { describe, expect, it } from 'vitest';

import {
  _AGENT_LABEL_MAX_LENGTH,
  deriveAgentTabLabel,
} from './chat-panel.js';

describe('deriveAgentTabLabel — bare prefix cases', () => {
  it('returns "Agent 00" for index 0 with no task', () => {
    expect(deriveAgentTabLabel(0, '')).toBe('Agent 00');
  });

  it('zero-pads single-digit indexes to two digits', () => {
    expect(deriveAgentTabLabel(3, '')).toBe('Agent 03');
  });

  it('does not zero-pad two-digit indexes', () => {
    expect(deriveAgentTabLabel(12, '')).toBe('Agent 12');
  });

  it('allows three-digit indexes through unchanged', () => {
    expect(deriveAgentTabLabel(123, '')).toBe('Agent 123');
  });

  it('returns bare prefix when task is undefined', () => {
    expect(deriveAgentTabLabel(1, undefined)).toBe('Agent 01');
  });

  it('returns bare prefix when task is null', () => {
    expect(deriveAgentTabLabel(1, null)).toBe('Agent 01');
  });

  it('returns bare prefix for whitespace-only task', () => {
    expect(deriveAgentTabLabel(1, '   \t\n  ')).toBe(
      'Agent 01',
    );
  });

  it('returns bare prefix for non-string task (number)', () => {
    // Defensive — shouldn't happen via the spawn parser
    // (task is always a string there) but a malformed
    // event detail shouldn't produce `Agent 01: 42`.
    expect(deriveAgentTabLabel(1, 42)).toBe('Agent 01');
  });

  it('returns bare prefix for non-string task (object)', () => {
    expect(deriveAgentTabLabel(1, { task: 'refactor' })).toBe(
      'Agent 01',
    );
  });
});

describe('deriveAgentTabLabel — task text inclusion', () => {
  it('appends task after a colon-space separator', () => {
    expect(deriveAgentTabLabel(0, 'refactor auth')).toBe(
      'Agent 00: refactor auth',
    );
  });

  it('trims the task before appending', () => {
    expect(deriveAgentTabLabel(0, '  refactor auth  ')).toBe(
      'Agent 00: refactor auth',
    );
  });

  it('uses only the first line of a multi-line task', () => {
    const task = 'refactor auth\nSecond line of context\nThird';
    expect(deriveAgentTabLabel(0, task)).toBe(
      'Agent 00: refactor auth',
    );
  });

  it('handles CRLF line endings', () => {
    const task = 'refactor auth\r\nnext line';
    expect(deriveAgentTabLabel(0, task)).toBe(
      'Agent 00: refactor auth',
    );
  });

  it('skips leading blank lines to find the first content line', () => {
    const task = '\n\n   \nactually start here\nand more';
    expect(deriveAgentTabLabel(0, task)).toBe(
      'Agent 00: actually start here',
    );
  });

  it('falls back to bare prefix when every line is blank', () => {
    const task = '\n   \n\t\n';
    expect(deriveAgentTabLabel(5, task)).toBe('Agent 05');
  });
});

describe('deriveAgentTabLabel — truncation', () => {
  it('does not truncate a label exactly at the length cap', () => {
    // Build a task that produces a full label exactly at
    // the cap. `Agent 00: ` is 10 chars; fill the rest.
    const room = _AGENT_LABEL_MAX_LENGTH - 'Agent 00: '.length;
    const task = 'x'.repeat(room);
    const label = deriveAgentTabLabel(0, task);
    expect(label.length).toBe(_AGENT_LABEL_MAX_LENGTH);
    expect(label.endsWith('…')).toBe(false);
  });

  it('truncates with an ellipsis when the label exceeds the cap', () => {
    const task = 'a'.repeat(100);
    const label = deriveAgentTabLabel(0, task);
    expect(label.length).toBe(_AGENT_LABEL_MAX_LENGTH);
    expect(label.endsWith('…')).toBe(true);
    expect(label.startsWith('Agent 00: ')).toBe(true);
  });

  it('ellipsis counts toward the total length', () => {
    const task = 'a'.repeat(200);
    const label = deriveAgentTabLabel(0, task);
    // The final char is the ellipsis, and the overall
    // length must not exceed the cap.
    expect(label).toHaveLength(_AGENT_LABEL_MAX_LENGTH);
    expect(label[label.length - 1]).toBe('…');
  });

  it('truncation preserves the full prefix', () => {
    const task = 'a'.repeat(200);
    const label = deriveAgentTabLabel(12, task);
    expect(label.startsWith('Agent 12: ')).toBe(true);
  });

  it('truncates after extracting the first line', () => {
    const longFirstLine = 'first line ' + 'x'.repeat(100);
    const task = `${longFirstLine}\nsecond line ignored`;
    const label = deriveAgentTabLabel(0, task);
    expect(label.length).toBe(_AGENT_LABEL_MAX_LENGTH);
    expect(label.endsWith('…')).toBe(true);
    expect(label).not.toContain('second line');
  });
});

describe('deriveAgentTabLabel — index coercion', () => {
  it('coerces negative index to 0', () => {
    expect(deriveAgentTabLabel(-3, '')).toBe('Agent 00');
  });

  it('floors non-integer index', () => {
    expect(deriveAgentTabLabel(2.7, '')).toBe('Agent 02');
  });

  it('coerces NaN to 0', () => {
    expect(deriveAgentTabLabel(NaN, '')).toBe('Agent 00');
  });

  it('coerces +Infinity to 0', () => {
    // `!Number.isFinite(Infinity)` is true, so we fall
    // through to the default (0). Any finite cap would be
    // arbitrary; 0 is a safe sentinel that makes the
    // misuse visually obvious.
    expect(deriveAgentTabLabel(Infinity, '')).toBe('Agent 00');
  });

  it('coerces -Infinity to 0', () => {
    expect(deriveAgentTabLabel(-Infinity, '')).toBe('Agent 00');
  });

  it('coerces string index via Number', () => {
    // Not a documented contract — the backend sends an
    // integer — but defensive. A string "5" produces the
    // same label as the number 5.
    expect(deriveAgentTabLabel('5', '')).toBe('Agent 05');
  });

  it('coerces non-numeric string to 0', () => {
    expect(deriveAgentTabLabel('agent', '')).toBe('Agent 00');
  });
});

describe('deriveAgentTabLabel — regression scenarios', () => {
  it('handles a typical LLM-authored task', () => {
    const task =
      'Refactor the authentication module to extract the ' +
      'session-token logic into a separate file';
    const label = deriveAgentTabLabel(0, task);
    expect(label.startsWith('Agent 00: Refactor')).toBe(true);
    expect(label.length).toBeLessThanOrEqual(
      _AGENT_LABEL_MAX_LENGTH,
    );
  });

  it('produces stable output on repeat calls', () => {
    const a = deriveAgentTabLabel(3, 'do the thing');
    const b = deriveAgentTabLabel(3, 'do the thing');
    expect(a).toBe(b);
  });

  it('different indexes produce different labels for same task', () => {
    const a = deriveAgentTabLabel(0, 'task');
    const b = deriveAgentTabLabel(1, 'task');
    expect(a).not.toBe(b);
  });
});