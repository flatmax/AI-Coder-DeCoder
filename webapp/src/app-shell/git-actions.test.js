// Tests for git-action helpers — specifically the
// commit-result handler, which is the ONLY place the
// server-driven commit pipeline's errors reach the user.
//
// `LLMService.commit_all` returns `{status: "started"}`
// synchronously and the real outcome arrives later as a
// broadcast `commit-result` event. The chat panel's handler
// deliberately stays silent on errors and relies on the
// shell's handler (this one) to toast — so a regression here
// makes commit failures (most commonly the smaller model's
// context window exceeded by an oversized diff) invisible.

import { describe, expect, it, vi } from 'vitest';

import { onCommitResultHeader } from './git-actions.js';

function makeHost() {
  return {
    _committing: true,
    _lastCommitErrorInfo: undefined,
    _showToast: vi.fn(),
  };
}

function commitEvent(detail) {
  return { detail };
}

describe('onCommitResultHeader', () => {
  it('clears the committing flag on success', () => {
    const host = makeHost();
    onCommitResultHeader(host, commitEvent({
      sha: 'abc123', short_sha: 'abc123',
      system_event_message: 'Committed',
    }));
    expect(host._committing).toBe(false);
    expect(host._showToast).not.toHaveBeenCalled();
  });

  it('toasts and clears the flag on a broadcast error', () => {
    const host = makeHost();
    onCommitResultHeader(host, commitEvent({
      error: 'The staged diff is too large for the '
        + "commit-message model's context window.",
      error_info: {
        error_type: 'context_window_exceeded',
        provider: 'bedrock',
      },
    }));
    expect(host._committing).toBe(false);
    expect(host._showToast).toHaveBeenCalledTimes(1);
    const [msg, level] = host._showToast.mock.calls[0];
    expect(msg).toContain('Commit failed');
    expect(msg).toContain('too large');
    expect(level).toBe('warning');
  });

  it('stashes the structured error_info for the shell', () => {
    const host = makeHost();
    onCommitResultHeader(host, commitEvent({
      error: 'boom',
      error_info: { error_type: 'authentication' },
    }));
    expect(host._lastCommitErrorInfo).toEqual({
      error_type: 'authentication',
    });
  });

  it('tolerates an error with no error_info', () => {
    const host = makeHost();
    onCommitResultHeader(host, commitEvent({ error: 'boom' }));
    expect(host._lastCommitErrorInfo).toBeNull();
    expect(host._showToast).toHaveBeenCalledTimes(1);
  });

  it('does not throw on a missing or malformed detail', () => {
    const host = makeHost();
    expect(() => onCommitResultHeader(host, {})).not.toThrow();
    expect(() => onCommitResultHeader(host, undefined)).not.toThrow();
    expect(host._committing).toBe(false);
    expect(host._showToast).not.toHaveBeenCalled();
  });
});
