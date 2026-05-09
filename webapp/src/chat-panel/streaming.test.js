// Tests for streaming flow: chunks, completion, request-ID
// filtering, agent spawn from completion, retry-prompt
// population, and stream-start error handling.

import { describe, expect, it, vi } from 'vitest';

import { computeLastEditOutcome } from './streaming.js';
import {
  mountPanel,
  publishFakeRpc,
  pushEvent,
  settle,
} from './test-helpers.js';

// ---------------------------------------------------------------------------
// Streaming via server-push events
// ---------------------------------------------------------------------------

describe('ChatPanel streaming events', () => {
  async function sendAndGetRequestId(panel, message = 'hi') {
    // Send and return the ID the chat panel generated.
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    await settle(panel);
    panel._input = message;
    await panel._send();
    return started.mock.calls[0][0];
  }

  it('renders streaming chunks in the assistant slot', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p, 'hi');
    pushEvent('stream-chunk', {
      requestId: reqId,
      content: 'Hello',
    });
    pushEvent('stream-chunk', {
      requestId: reqId,
      content: 'Hello, world',
    });
    await settle(p);
    const streaming = p.shadowRoot.querySelector(
      '.message-card.streaming',
    );
    expect(streaming).toBeTruthy();
    expect(streaming.textContent).toContain('Hello, world');
  });

  it('ignores chunks for other request IDs', async () => {
    // Collaboration — a stream from another user's prompt
    // arrives with a different request ID.
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p, 'hi');
    pushEvent('stream-chunk', {
      requestId: 'other-request-id',
      content: 'should not render',
    });
    await settle(p);
    const streaming = p.shadowRoot.querySelector(
      '.message-card.streaming',
    );
    expect(streaming).toBeTruthy();
    expect(streaming.textContent).not.toContain('should not');
  });

  it('moves streamed content into messages on stream-complete', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p, 'hi');
    pushEvent('stream-chunk', {
      requestId: reqId,
      content: 'partial',
    });
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'final answer' },
    });
    await settle(p);
    expect(p.messages).toHaveLength(2);
    expect(p.messages[1].role).toBe('assistant');
    expect(p.messages[1].content).toBe('final answer');
    expect(p._streaming).toBe(false);
    expect(p._streamingContent).toBe('');
    expect(
      p.shadowRoot.querySelector('.message-card.streaming'),
    ).toBeNull();
  });

  it('uses last streaming content when result lacks response', async () => {
    // Cancelled streams produce a completion without `response`.
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p, 'hi');
    pushEvent('stream-chunk', {
      requestId: reqId,
      content: 'partial content',
    });
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { cancelled: true },
    });
    await settle(p);
    expect(p.messages[1].content).toBe('partial content');
  });

  it('renders an error message when completion carries error', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p, 'hi');
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { error: 'something broke' },
    });
    await settle(p);
    expect(p.messages[1].role).toBe('assistant');
    expect(p.messages[1].content).toContain('something broke');
  });
});

// ---------------------------------------------------------------------------
// Increment D field threading — onStreamComplete
// ---------------------------------------------------------------------------

describe('ChatPanel onStreamComplete threads agentic fields', () => {
  async function sendAndGetRequestId(panel, message = 'hi') {
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    await settle(panel);
    panel._input = message;
    await panel._send();
    return started.mock.calls[0][0];
  }

  it('settled assistant carries turn_id when present', async () => {
    // Per spec specs4/5-webapp/agent-browser.md §
    // Historical Turns — the "View agents (N)"
    // affordance below an assistant message reads
    // `msg.turn_id` to look up `get_turn_archive`.
    // Without this thread-through, an agentic turn
    // would render with no affordance even though
    // the backend persisted the field.
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'delegated',
        turn_id: 'turn_abc',
      },
    });
    await settle(p);
    expect(p.messages[1].turn_id).toBe('turn_abc');
  });

  it('settled assistant carries agent_blocks when present', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'spawning',
        turn_id: 'turn_abc',
        agent_blocks: [
          { id: 'frontend', task: 'ui', agent_idx: 0 },
          { id: 'backend', task: 'api', agent_idx: 1 },
        ],
      },
    });
    await settle(p);
    const msg = p.messages[1];
    expect(msg.agent_blocks).toEqual([
      { id: 'frontend', task: 'ui', agent_idx: 0 },
      { id: 'backend', task: 'api', agent_idx: 1 },
    ]);
  });

  it('non-agentic completion has no turn_id or agent_blocks', async () => {
    // Pre-Increment-A turns and any non-agentic
    // turn must produce a clean message shape.
    // Optional-key omission keeps the rendered
    // card unchanged for the common case.
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'plain reply' },
    });
    await settle(p);
    const msg = p.messages[1];
    expect('turn_id' in msg).toBe(false);
    expect('agent_blocks' in msg).toBe(false);
  });

  it('empty agent_blocks array is omitted from the message', async () => {
    // Backend sends [] when no agents spawned —
    // we shouldn't store the empty array because
    // the renderer's affordance-visibility check
    // is `agent_blocks?.length > 0`. Storing []
    // wastes memory and gives renderers two
    // ways to spell "no agents".
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'no agents',
        turn_id: 'turn_abc',
        agent_blocks: [],
      },
    });
    await settle(p);
    expect('agent_blocks' in p.messages[1]).toBe(false);
    expect(p.messages[1].turn_id).toBe('turn_abc');
  });

  it('non-array agent_blocks is rejected defensively', async () => {
    // A malformed payload mustn't crash or
    // produce a phantom field. Drop silently —
    // turn_id still rides through.
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'malformed',
        turn_id: 'turn_abc',
        agent_blocks: 'not-an-array',
      },
    });
    await settle(p);
    expect('agent_blocks' in p.messages[1]).toBe(false);
    expect(p.messages[1].turn_id).toBe('turn_abc');
  });

  it('empty-string turn_id is omitted', async () => {
    // The factories generate non-empty strings,
    // but defensive against a backend bug — empty
    // string shouldn't produce a `turn_id` field
    // that callers then fail to look up.
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'ok', turn_id: '' },
    });
    await settle(p);
    expect('turn_id' in p.messages[1]).toBe(false);
  });

  it('error-path completion still threads turn_id', async () => {
    // Errored turns can still have spawned
    // agents up to the failure point. The error
    // message replaces the assistant content but
    // turn_id should ride through so the
    // archive affordance still works for
    // partial turns.
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        error: 'rate limit hit',
        turn_id: 'turn_abc',
      },
    });
    await settle(p);
    expect(p.messages[1].turn_id).toBe('turn_abc');
    // Error path doesn't carry agent_blocks (the
    // backend skips spawn-block dispatch on
    // error per `_streaming.py`), so omit
    // defensively.
    expect('agent_blocks' in p.messages[1]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Chunk coalescing via rAF
// ---------------------------------------------------------------------------

describe('ChatPanel chunk coalescing', () => {
  it('applies the latest content on each animation frame', async () => {
    const p = mountPanel();
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    await settle(p);
    p._input = 'hi';
    await p._send();
    const reqId = started.mock.calls[0][0];

    pushEvent('stream-chunk', { requestId: reqId, content: 'a' });
    pushEvent('stream-chunk', { requestId: reqId, content: 'ab' });
    pushEvent('stream-chunk', {
      requestId: reqId,
      content: 'abc',
    });
    await settle(p);
    expect(p._streamingContent).toBe('abc');
  });

  it('uses full content, not delta accumulation', async () => {
    // Dropped chunks are harmless because each carries the
    // full accumulated content.
    const p = mountPanel();
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    await settle(p);
    p._input = 'hi';
    await p._send();
    const reqId = started.mock.calls[0][0];
    pushEvent('stream-chunk', {
      requestId: reqId,
      content: 'first',
    });
    pushEvent('stream-chunk', {
      requestId: reqId,
      content: 'third chunk content',
    });
    await settle(p);
    expect(p._streamingContent).toBe('third chunk content');
  });
});

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

describe('ChatPanel cancel', () => {
  it('calls cancel_streaming with the active request ID', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    const cancel = vi.fn().mockResolvedValue({ status: 'ok' });
    publishFakeRpc({
      'LLMService.chat_streaming': started,
      'LLMService.cancel_streaming': cancel,
    });
    const p = mountPanel();
    await settle(p);
    p._input = 'hi';
    await p._send();
    await settle(p);
    p.shadowRoot.querySelector('.send-button.stop').click();
    await settle(p);
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel.mock.calls[0][0]).toBe(started.mock.calls[0][0]);
  });

  it('recovers locally when cancel fails', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    const cancel = vi
      .fn()
      .mockRejectedValue(new Error('already done'));
    publishFakeRpc({
      'LLMService.chat_streaming': started,
      'LLMService.cancel_streaming': cancel,
    });
    const p = mountPanel();
    await settle(p);
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    try {
      p._input = 'hi';
      await p._send();
      await p._cancel();
      await settle(p);
      expect(p._streaming).toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Retry prompt population (stream-complete)
// ---------------------------------------------------------------------------

describe('ChatPanel retry prompt population', () => {
  async function sendAndGetId(panel, text = 'hi') {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    await settle(panel);
    panel._input = text;
    await panel._send();
    await settle(panel);
    return started.mock.calls[0][0];
  }

  it('populates textarea with ambiguous retry prompt', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p, 'please edit');
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'editing now',
        edit_results: [
          {
            file: 'a.py',
            status: 'failed',
            error_type: 'ambiguous_anchor',
            message: 'Ambiguous match (2 locations)',
          },
        ],
      },
    });
    await settle(p);
    expect(p._input).toContain('a.py');
    expect(p._input).toContain('retry with more surrounding');
  });

  it('populates textarea with not-in-context retry prompt', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'done',
        edit_results: [],
        files_auto_added: ['src/new.py'],
      },
    });
    await settle(p);
    expect(p._input).toContain('The file src/new.py');
    expect(p._input).toContain('has been added');
  });

  it('not-in-context wins over ambiguous when both present', async () => {
    // Last-wins ordering in _maybePopulateRetryPrompt.
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'tried',
        edit_results: [
          {
            file: 'a.py',
            error_type: 'ambiguous_anchor',
            message: 'two matches',
          },
        ],
        files_auto_added: ['b.py'],
      },
    });
    await settle(p);
    expect(p._input).toContain('The file b.py');
    expect(p._input).toContain('has been added');
    expect(p._input).not.toContain('surrounding context');
  });

  it('in-context mismatch prompt fires for selected file anchor_not_found', async () => {
    const p = mountPanel({
      selectedFiles: ['src/selected.py'],
    });
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'attempted',
        edit_results: [
          {
            file: 'src/selected.py',
            error_type: 'anchor_not_found',
            message: 'Old text not found',
          },
        ],
      },
    });
    await settle(p);
    expect(p._input).toContain('already in');
    expect(p._input).toContain('src/selected.py');
    expect(p._input).toContain('re-read');
  });

  it('ambiguous prompt wins over in-context mismatch', async () => {
    const p = mountPanel({ selectedFiles: ['a.py'] });
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'attempted',
        edit_results: [
          {
            file: 'a.py',
            error_type: 'anchor_not_found',
            message: 'not found',
          },
          {
            file: 'b.py',
            error_type: 'ambiguous_anchor',
            message: 'two matches',
          },
        ],
      },
    });
    await settle(p);
    expect(p._input).toContain('b.py');
    expect(p._input).toContain('retry with more surrounding');
    expect(p._input).not.toContain('already in');
  });

  it('does not populate when all edits succeeded', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'all good',
        edit_results: [
          { file: 'a.py', status: 'applied' },
          { file: 'b.py', status: 'applied' },
        ],
      },
    });
    await settle(p);
    expect(p._input).toBe('');
  });

  it('does not populate when result has no edit_results', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'plain response' },
    });
    await settle(p);
    expect(p._input).toBe('');
  });

  it('does not populate when stream completes with an error', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        error: 'server broke',
        edit_results: [
          {
            file: 'a.py',
            error_type: 'ambiguous_anchor',
            message: 'two matches',
          },
        ],
      },
    });
    await settle(p);
    expect(p._input).toBe('');
  });

  it('does not clobber user-typed text', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    p._input = 'I was typing this';
    await settle(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'done',
        files_auto_added: ['auto.py'],
      },
    });
    await settle(p);
    expect(p._input).toBe('I was typing this');
  });

  it('does not populate for passive streams (other request IDs)', async () => {
    const p = mountPanel();
    await settle(p);
    pushEvent('stream-complete', {
      requestId: 'other-client-id',
      result: {
        response: 'their response',
        files_auto_added: ['their-file.py'],
      },
    });
    await settle(p);
    expect(p._input).toBe('');
  });

  it('focuses the textarea after populating', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'done',
        files_auto_added: ['new.py'],
      },
    });
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    expect(p.shadowRoot.activeElement).toBe(ta);
  });

  it('positions cursor at end of populated text', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'done',
        files_auto_added: ['new.py'],
      },
    });
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    expect(ta.selectionStart).toBe(p._input.length);
    expect(ta.selectionEnd).toBe(p._input.length);
  });
});

// ---------------------------------------------------------------------------
// Agent tab spawning (D21 Phase C2a)
// ---------------------------------------------------------------------------

describe('ChatPanel agent tab spawning — gating', () => {
  async function startMainStream(panel, message = 'hi') {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    await settle(panel);
    panel._input = message;
    await panel._send();
    await settle(panel);
    return started.mock.calls[0][0];
  }

  it('no spawn when agent_blocks is missing', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'plain response',
        turn_id: 'turn_abc',
      },
    });
    await settle(p);
    expect(p._tabs.size).toBe(1);
    expect(p._tabs.has('main')).toBe(true);
  });

  it('no spawn when agent_blocks is empty array', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'no agents',
        turn_id: 'turn_abc',
        agent_blocks: [],
      },
    });
    await settle(p);
    expect(p._tabs.size).toBe(1);
  });

  it('no spawn when turn_id is missing', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'missing turn_id',
        agent_blocks: [
          { id: 'agent-0', task: 'do it', agent_idx: 0 },
        ],
      },
    });
    await settle(p);
    expect(p._tabs.size).toBe(1);
  });

  it('no spawn on error completion', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        error: 'something broke',
        turn_id: 'turn_abc',
        agent_blocks: [
          { id: 'agent-0', task: 'do it', agent_idx: 0 },
        ],
      },
    });
    await settle(p);
    expect(p._tabs.size).toBe(1);
  });

  it('no spawn on cancelled completion', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        cancelled: true,
        turn_id: 'turn_abc',
        agent_blocks: [
          { id: 'agent-0', task: 'do it', agent_idx: 0 },
        ],
      },
    });
    await settle(p);
    expect(p._tabs.size).toBe(1);
  });

  it('no spawn for agent-tab completions (tree depth 1)', async () => {
    // Agents can't spawn sub-agents — tree depth is 1.
    const p = mountPanel();
    await settle(p);
    const agentTabId = 'turn_xyz/agent-00';
    p._tabs.set(agentTabId, p._makeTabState());
    p._tabLabels.set(agentTabId, 'Agent 00');
    p._activeTabId = agentTabId;
    await settle(p);
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    await settle(p);
    p._input = 'continue';
    await p._send();
    await settle(p);
    const reqId = started.mock.calls[0][0];
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'nested agents',
        turn_id: 'turn_nested',
        agent_blocks: [
          { id: 'agent-0', task: 'nested', agent_idx: 0 },
        ],
      },
    });
    await settle(p);
    expect(p._tabs.size).toBe(2);
    expect(p._tabs.has('turn_nested/agent-00')).toBe(false);
  });
});

describe('ChatPanel agent tab spawning — tab creation', () => {
  async function startMainStream(panel, message = 'hi') {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    await settle(panel);
    panel._input = message;
    await panel._send();
    await settle(panel);
    return started.mock.calls[0][0];
  }

  it('creates one tab per valid block, keyed by agent id', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'delegated',
        turn_id: 'turn_abc',
        agent_blocks: [
          { id: 'frontend-trivial', task: 'first', agent_idx: 0 },
          { id: 'backend-auth', task: 'second', agent_idx: 1 },
          { id: 'docs-update', task: 'third', agent_idx: 2 },
        ],
      },
    });
    await settle(p);
    expect(p._tabs.size).toBe(4); // main + 3 agents
    expect(p._tabs.has('frontend-trivial')).toBe(true);
    expect(p._tabs.has('backend-auth')).toBe(true);
    expect(p._tabs.has('docs-update')).toBe(true);
  });

  it('tab id matches the spawn block id verbatim', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'ok',
        turn_id: 'turn_abc',
        agent_blocks: [
          { id: 'a', task: 't', agent_idx: 0 },
          { id: 'streaming-pipeline', task: 't', agent_idx: 7 },
          { id: 'with-suffix-42', task: 't', agent_idx: 42 },
        ],
      },
    });
    await settle(p);
    expect(p._tabs.has('a')).toBe(true);
    expect(p._tabs.has('streaming-pipeline')).toBe(true);
    expect(p._tabs.has('with-suffix-42')).toBe(true);
  });

  it('seeds each tab with task as initial user message', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'ok',
        turn_id: 'turn_abc',
        agent_blocks: [
          {
            id: 'auth-refactor',
            task: 'refactor the auth module',
            agent_idx: 0,
          },
        ],
      },
    });
    await settle(p);
    const tab = p._tabs.get('auth-refactor');
    expect(tab).toBeTruthy();
    expect(tab.messages).toHaveLength(1);
    expect(tab.messages[0]).toEqual({
      role: 'user',
      content: 'refactor the auth module',
    });
  });

  it('copies main tab selected files into each agent tab', async () => {
    const p = mountPanel();
    p._tabs.get('main').selectedFiles = ['src/auth.py', 'src/db.py'];
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'ok',
        turn_id: 'turn_abc',
        agent_blocks: [
          { id: 'a0', task: 't', agent_idx: 0 },
          { id: 'a1', task: 't', agent_idx: 1 },
        ],
      },
    });
    await settle(p);
    const tab0 = p._tabs.get('a0');
    const tab1 = p._tabs.get('a1');
    expect(tab0.selectedFiles).toEqual(['src/auth.py', 'src/db.py']);
    expect(tab1.selectedFiles).toEqual(['src/auth.py', 'src/db.py']);
    expect(tab0.selectedFiles).not.toBe(tab1.selectedFiles);
    expect(tab0.selectedFiles).not.toBe(p._tabs.get('main').selectedFiles);
  });

  it('labels use deriveAgentTabLabel', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'ok',
        turn_id: 'turn_abc',
        agent_blocks: [
          { id: 'a0', task: 'refactor auth', agent_idx: 0 },
          { id: 'a1', task: '', agent_idx: 1 },
        ],
      },
    });
    await settle(p);
    expect(p._tabLabels.get('a0')).toBe(
      'Agent 00: refactor auth',
    );
    expect(p._tabLabels.get('a1')).toBe('Agent 01');
  });

  it('does not switch to a newly spawned tab', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    expect(p._activeTabId).toBe('main');
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'ok',
        turn_id: 'turn_abc',
        agent_blocks: [
          { id: 'a0', task: 't', agent_idx: 0 },
        ],
      },
    });
    await settle(p);
    expect(p._activeTabId).toBe('main');
  });

  it('tab strip grows after first spawn', async () => {
    // Strip is always present (per spec, the per-tab
    // 📊 Context icon is the only path to the Context
    // overlay). Spawning the first agent grows it from
    // 1 button (Main) to 2 (Main + agent-0).
    const p = mountPanel();
    await settle(p);
    expect(
      p.shadowRoot.querySelectorAll('.tab-strip-tab').length,
    ).toBe(1);
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'ok',
        turn_id: 'turn_abc',
        agent_blocks: [
          { id: 'a0', task: 't', agent_idx: 0 },
        ],
      },
    });
    await settle(p);
    const strip = p.shadowRoot.querySelector('.tab-strip');
    expect(strip).toBeTruthy();
    const buttons = strip.querySelectorAll('.tab-strip-tab');
    expect(buttons.length).toBe(2);
  });
});

describe('ChatPanel agent tab spawning — defensive', () => {
  async function startMainStream(panel, message = 'hi') {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    await settle(panel);
    panel._input = message;
    await panel._send();
    await settle(panel);
    return started.mock.calls[0][0];
  }

  it('idempotent on duplicate stream-complete', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    const result = {
      response: 'ok',
      turn_id: 'turn_abc',
      agent_blocks: [
        { id: 'agent-0', task: 'initial', agent_idx: 0 },
      ],
    };
    pushEvent('stream-complete', { requestId: reqId, result });
    await settle(p);
    const tab = p._tabs.get('agent-0');
    tab.messages.push({ role: 'assistant', content: 'agent reply' });
    pushEvent('stream-complete', { requestId: reqId, result });
    await settle(p);
    const same = p._tabs.get('agent-0');
    expect(same).toBe(tab);
    expect(same.messages).toHaveLength(2);
    expect(same.messages[1].content).toBe('agent reply');
  });

  it('skips entries with non-numeric agent_idx', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'ok',
        turn_id: 'turn_abc',
        agent_blocks: [
          { id: 'agent-0', task: 'good', agent_idx: 0 },
          { id: 'agent-bad', task: 'bad', agent_idx: 'zero' },
          { id: 'agent-1', task: 'also good', agent_idx: 1 },
        ],
      },
    });
    await settle(p);
    expect(p._tabs.size).toBe(3); // main + 2
    expect(p._tabs.has('agent-0')).toBe(true);
    expect(p._tabs.has('agent-1')).toBe(true);
  });

  it('skips entries with negative agent_idx', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'ok',
        turn_id: 'turn_abc',
        agent_blocks: [
          { id: 'agent-neg', task: 't', agent_idx: -1 },
        ],
      },
    });
    await settle(p);
    expect(p._tabs.size).toBe(1);
  });

  it('non-array agent_blocks silently drops', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'ok',
        turn_id: 'turn_abc',
        agent_blocks: 'not an array',
      },
    });
    await settle(p);
    expect(p._tabs.size).toBe(1);
  });

  it('null blocks within array are skipped', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'ok',
        turn_id: 'turn_abc',
        agent_blocks: [
          null,
          { id: 'agent-0', task: 't', agent_idx: 0 },
          undefined,
        ],
      },
    });
    await settle(p);
    expect(p._tabs.size).toBe(2);
    expect(p._tabs.has('agent-0')).toBe(true);
  });

  it('non-string task falls back to empty string', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'ok',
        turn_id: 'turn_abc',
        agent_blocks: [
          { id: 'agent-0', task: null, agent_idx: 0 },
        ],
      },
    });
    await settle(p);
    const tab = p._tabs.get('agent-0');
    expect(tab).toBeTruthy();
    expect(p._tabLabels.get('agent-0')).toBe('Agent 00');
    expect(tab.messages[0].content).toBe('');
  });

  it('empty turn_id is rejected', async () => {
    const p = mountPanel();
    const reqId = await startMainStream(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'ok',
        turn_id: '',
        agent_blocks: [
          { id: 'agent-0', task: 't', agent_idx: 0 },
        ],
      },
    });
    await settle(p);
    expect(p._tabs.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// C2d — stale-tag error handling on chat_streaming resolution
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Last-completion outcome (LED row state, Scope B commit 3)
// ---------------------------------------------------------------------------

describe('computeLastEditOutcome — pure helper', () => {
  it('clean run with no edits → clean / 0', () => {
    const outcome = computeLastEditOutcome(null, null, undefined);
    expect(outcome).toEqual({
      status: 'clean',
      appliedCount: 0,
      failureReason: null,
    });
  });

  it('all-applied edits → clean / count', () => {
    const outcome = computeLastEditOutcome(null, null, [
      { file: 'a.py', status: 'applied' },
      { file: 'b.py', status: 'applied' },
      { file: 'c.py', status: 'applied' },
    ]);
    expect(outcome.status).toBe('clean');
    expect(outcome.appliedCount).toBe(3);
    expect(outcome.failureReason).toBeNull();
  });

  it('mix of applied + already_applied + skipped → clean', () => {
    // None of these statuses count as failures. The
    // agent's edit pipeline ran and produced no error;
    // already-applied / skipped / not-in-context are
    // all benign.
    const outcome = computeLastEditOutcome(null, null, [
      { file: 'a.py', status: 'applied' },
      { file: 'b.py', status: 'already_applied' },
      { file: 'c.py', status: 'skipped' },
      { file: 'd.py', status: 'not_in_context' },
    ]);
    expect(outcome.status).toBe('clean');
    expect(outcome.appliedCount).toBe(1);
  });

  it('one failed edit → error / message', () => {
    const outcome = computeLastEditOutcome(null, null, [
      { file: 'a.py', status: 'applied' },
      {
        file: 'b.py',
        status: 'failed',
        error_type: 'anchor_not_found',
        message: 'Old text not found',
      },
    ]);
    expect(outcome.status).toBe('error');
    expect(outcome.appliedCount).toBe(1);
    expect(outcome.failureReason).toBe(
      'b.py: Old text not found',
    );
  });

  it('failure without message falls back to error_type', () => {
    const outcome = computeLastEditOutcome(null, null, [
      {
        file: 'b.py',
        status: 'failed',
        error_type: 'ambiguous_anchor',
        message: '',
      },
    ]);
    expect(outcome.failureReason).toBe(
      'ambiguous_anchor in b.py',
    );
  });

  it('failure without file or error_type → generic', () => {
    const outcome = computeLastEditOutcome(null, null, [
      { status: 'failed' },
    ]);
    expect(outcome.failureReason).toBe('edit failed');
  });

  it('multiple failures → first one wins for tooltip', () => {
    const outcome = computeLastEditOutcome(null, null, [
      {
        file: 'a.py',
        status: 'failed',
        message: 'first failure',
      },
      {
        file: 'b.py',
        status: 'failed',
        message: 'second failure',
      },
    ]);
    expect(outcome.failureReason).toContain('first failure');
    expect(outcome.failureReason).not.toContain(
      'second failure',
    );
  });

  it('stream error wins over edit failures', () => {
    // Stream-level error means the response is partial;
    // any edit results are unreliable. Tooltip should
    // reflect the stream error, not the (incidental)
    // edit failure.
    const outcome = computeLastEditOutcome(
      'something broke',
      { message: 'rate limit exceeded' },
      [
        {
          file: 'a.py',
          status: 'failed',
          message: 'anchor missing',
        },
      ],
    );
    expect(outcome.status).toBe('error');
    expect(outcome.failureReason).toBe('rate limit exceeded');
    // appliedCount still tracked — caller may want to
    // show partial credit even on stream error.
    expect(outcome.appliedCount).toBe(0);
  });

  it('stream error without errorInfo uses raw error', () => {
    const outcome = computeLastEditOutcome(
      'network died',
      null,
      undefined,
    );
    expect(outcome.failureReason).toBe('network died');
  });

  it('stream error with empty errorInfo.message falls back', () => {
    // Defensive — classifier may produce an
    // errorInfo dict with an empty message.
    const outcome = computeLastEditOutcome(
      'fallback string',
      { message: '', error_type: 'unknown' },
      undefined,
    );
    expect(outcome.failureReason).toBe('fallback string');
  });

  it('non-array editResults treated as empty', () => {
    expect(
      computeLastEditOutcome(null, null, null).appliedCount,
    ).toBe(0);
    expect(
      computeLastEditOutcome(null, null, 'oops').appliedCount,
    ).toBe(0);
    expect(
      computeLastEditOutcome(null, null, undefined)
        .appliedCount,
    ).toBe(0);
  });

  it('non-object entries skipped', () => {
    const outcome = computeLastEditOutcome(null, null, [
      null,
      undefined,
      'string',
      42,
      { file: 'a.py', status: 'applied' },
    ]);
    expect(outcome.appliedCount).toBe(1);
    expect(outcome.status).toBe('clean');
  });
});

describe('ChatPanel onStreamComplete writes lastEditOutcome', () => {
  async function sendAndGetRequestId(panel, message = 'hi') {
    const { vi } = await import('vitest');
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    await settle(panel);
    panel._input = message;
    await panel._send();
    return started.mock.calls[0][0];
  }

  it('clean completion → clean outcome on active tab', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'all done',
        edit_results: [
          { file: 'a.py', status: 'applied' },
          { file: 'b.py', status: 'applied' },
        ],
      },
    });
    await settle(p);
    const outcome = p._tabs.get('main').lastEditOutcome;
    expect(outcome).not.toBeNull();
    expect(outcome.status).toBe('clean');
    expect(outcome.appliedCount).toBe(2);
  });

  it('failure → error outcome with diagnostic', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'tried',
        edit_results: [
          {
            file: 'a.py',
            status: 'failed',
            error_type: 'anchor_not_found',
            message: 'Old text not found',
          },
        ],
      },
    });
    await settle(p);
    const outcome = p._tabs.get('main').lastEditOutcome;
    expect(outcome.status).toBe('error');
    expect(outcome.failureReason).toContain('a.py');
  });

  it('stream error → error outcome', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        error: 'something broke',
        error_info: { message: 'rate limit exceeded' },
      },
    });
    await settle(p);
    const outcome = p._tabs.get('main').lastEditOutcome;
    expect(outcome.status).toBe('error');
    expect(outcome.failureReason).toBe('rate limit exceeded');
  });

  it('inactive-tab completion writes to that tab', async () => {
    const p = mountPanel();
    await settle(p);
    // Set up agent tab with its own in-flight request.
    p._tabs.set('agent-0', p._makeTabState());
    p._tabLabels.set('agent-0', 'Agent 0');
    const agentTab = p._tabs.get('agent-0');
    agentTab.streaming = true;
    agentTab.currentRequestId = 'r-agent-1';
    p.requestUpdate();
    await settle(p);
    // Active tab is still main.
    expect(p._activeTabId).toBe('main');
    pushEvent('stream-complete', {
      requestId: 'r-agent-1',
      result: {
        response: 'agent done',
        edit_results: [
          { file: 'x.py', status: 'applied' },
        ],
      },
    });
    await settle(p);
    expect(agentTab.lastEditOutcome).not.toBeNull();
    expect(agentTab.lastEditOutcome.status).toBe('clean');
    expect(agentTab.lastEditOutcome.appliedCount).toBe(1);
    // Main tab's outcome is unaffected.
    expect(p._tabs.get('main').lastEditOutcome).toBeNull();
  });

  it('initial state is null', async () => {
    const p = mountPanel();
    await settle(p);
    expect(p._tabs.get('main').lastEditOutcome).toBeNull();
  });

  it('outcome overwrites on subsequent completions', async () => {
    const p = mountPanel();
    let reqId = await sendAndGetRequestId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'first',
        edit_results: [
          {
            file: 'a.py',
            status: 'failed',
            message: 'first failure',
          },
        ],
      },
    });
    await settle(p);
    expect(
      p._tabs.get('main').lastEditOutcome.status,
    ).toBe('error');
    // Second turn — clean.
    reqId = await sendAndGetRequestId(p, 'second');
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: 'second',
        edit_results: [
          { file: 'b.py', status: 'applied' },
        ],
      },
    });
    await settle(p);
    expect(
      p._tabs.get('main').lastEditOutcome.status,
    ).toBe('clean');
    expect(
      p._tabs.get('main').lastEditOutcome.appliedCount,
    ).toBe(1);
  });
});

describe('ChatPanel stream-start error handling', () => {
  async function setupAgentTab(panel, tabId = 'frontend-trivial') {
    panel._tabs.set(tabId, panel._makeTabState());
    panel._tabLabels.set(tabId, tabId);
    panel._activeTabId = tabId;
    await settle(panel);
    return tabId;
  }

  it('stale agent_tag closes tab, switches to main, toasts', async () => {
    const chatStreaming = vi
      .fn()
      .mockResolvedValue({ error: 'agent not found' });
    const closeAgent = vi
      .fn()
      .mockResolvedValue({ status: 'ok', closed: false });
    publishFakeRpc({
      'LLMService.chat_streaming': chatStreaming,
      'LLMService.close_agent_context': closeAgent,
    });
    const p = mountPanel();
    await settle(p);
    const tabId = await setupAgentTab(p);
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      p._input = 'hello stale';
      await p._send();
      await settle(p);
      expect(p._tabs.has(tabId)).toBe(false);
      expect(p._activeTabId).toBe('main');
      const warnings = toastListener.mock.calls
        .map((c) => c[0].detail)
        .filter((d) => d.type === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toMatch(/Agent tab closed/);
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });

  it('stale agent_tag removes optimistic user message', async () => {
    const chatStreaming = vi
      .fn()
      .mockResolvedValue({ error: 'agent not found' });
    publishFakeRpc({
      'LLMService.chat_streaming': chatStreaming,
      'LLMService.close_agent_context': vi
        .fn()
        .mockResolvedValue({ status: 'ok', closed: false }),
    });
    const p = mountPanel();
    await settle(p);
    await setupAgentTab(p);
    p._input = 'stale message';
    await p._send();
    await settle(p);
    const mainTab = p._tabs.get('main');
    expect(mainTab.messages).toEqual([]);
  });

  it('generic error appends assistant error message in current tab', async () => {
    const chatStreaming = vi.fn().mockResolvedValue({
      error: 'Another stream is active (request xyz)',
    });
    publishFakeRpc({
      'LLMService.chat_streaming': chatStreaming,
    });
    const p = mountPanel();
    await settle(p);
    p._input = 'hello';
    await p._send();
    await settle(p);
    expect(p.messages).toHaveLength(2);
    expect(p.messages[0].role).toBe('user');
    expect(p.messages[0].content).toBe('hello');
    expect(p.messages[1].role).toBe('assistant');
    expect(p.messages[1].content).toContain('Another stream');
  });

  it('generic error clears streaming state', async () => {
    const chatStreaming = vi.fn().mockResolvedValue({
      error: 'Malformed agent_tag',
    });
    publishFakeRpc({
      'LLMService.chat_streaming': chatStreaming,
    });
    const p = mountPanel();
    await settle(p);
    p._input = 'hi';
    await p._send();
    await settle(p);
    expect(p._streaming).toBe(false);
    expect(p._streamingContent).toBe('');
    expect(p._currentRequestId).toBeNull();
  });

  it('generic error on agent tab keeps the tab open', async () => {
    const chatStreaming = vi.fn().mockResolvedValue({
      error: 'Another stream is active',
    });
    publishFakeRpc({
      'LLMService.chat_streaming': chatStreaming,
    });
    const p = mountPanel();
    await settle(p);
    const tabId = await setupAgentTab(p);
    p._input = 'hi';
    await p._send();
    await settle(p);
    expect(p._tabs.has(tabId)).toBe(true);
    expect(p._activeTabId).toBe(tabId);
    const tab = p._tabs.get(tabId);
    expect(tab.messages).toHaveLength(2);
    expect(tab.messages[1].content).toContain('Another stream');
  });

  it('"agent not found" on main tab does NOT close anything', async () => {
    const chatStreaming = vi
      .fn()
      .mockResolvedValue({ error: 'agent not found' });
    publishFakeRpc({
      'LLMService.chat_streaming': chatStreaming,
    });
    const p = mountPanel();
    await settle(p);
    p._input = 'hi';
    await p._send();
    await settle(p);
    expect(p._tabs.has('main')).toBe(true);
    expect(p._activeTabId).toBe('main');
    expect(p.messages[1].content).toContain('agent not found');
  });

  it('RPC rejection still goes through the catch block', async () => {
    const chatStreaming = vi
      .fn()
      .mockRejectedValue(new Error('network died'));
    publishFakeRpc({
      'LLMService.chat_streaming': chatStreaming,
    });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      const p = mountPanel();
      await settle(p);
      p._input = 'hi';
      await p._send();
      await settle(p);
      expect(p.messages[1].content).toContain('network died');
      expect(p._streaming).toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('stale tag clears request tracking', async () => {
    const chatStreaming = vi
      .fn()
      .mockResolvedValue({ error: 'agent not found' });
    publishFakeRpc({
      'LLMService.chat_streaming': chatStreaming,
      'LLMService.close_agent_context': vi
        .fn()
        .mockResolvedValue({ status: 'ok', closed: false }),
    });
    const p = mountPanel();
    await settle(p);
    await setupAgentTab(p);
    p._input = 'hi';
    await p._send();
    await settle(p);
    expect(p._streaming).toBe(false);
    expect(p._currentRequestId).toBeNull();
  });

  it('stale tag still fires close_agent_context via _onTabClose', async () => {
    const chatStreaming = vi
      .fn()
      .mockResolvedValue({ error: 'agent not found' });
    const closeAgent = vi
      .fn()
      .mockResolvedValue({ status: 'ok', closed: false });
    publishFakeRpc({
      'LLMService.chat_streaming': chatStreaming,
      'LLMService.close_agent_context': closeAgent,
    });
    const p = mountPanel();
    await settle(p);
    const tabId = await setupAgentTab(p);
    p._input = 'hi';
    await p._send();
    await settle(p);
    expect(closeAgent).toHaveBeenCalledOnce();
    expect(closeAgent.mock.calls[0]).toEqual([tabId]);
  });
});