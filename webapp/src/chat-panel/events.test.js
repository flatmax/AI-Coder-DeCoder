// Tests for window-event handling: session-changed,
// compaction-event, and lifecycle/cleanup. The chat panel
// listens at the window level for events the AppShell
// translates from JRPC notifications.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  mountPanel,
  publishFakeRpc,
  pushEvent,
  settle,
} from './test-helpers.js';

// ---------------------------------------------------------------------------
// Session-changed
// ---------------------------------------------------------------------------

describe('ChatPanel session-changed event', () => {
  it('replaces message list on session change', async () => {
    const p = mountPanel({
      messages: [{ role: 'user', content: 'old' }],
    });
    await settle(p);
    pushEvent('session-changed', {
      session_id: 'sess_new',
      messages: [
        { role: 'user', content: 'new one' },
        { role: 'assistant', content: 'new two' },
      ],
    });
    await settle(p);
    expect(p.messages).toHaveLength(2);
    expect(p.messages[0].content).toBe('new one');
  });

  it('clears message list for empty sessions', async () => {
    const p = mountPanel({
      messages: [{ role: 'user', content: 'old' }],
    });
    await settle(p);
    pushEvent('session-changed', {
      session_id: 'sess_new',
      messages: [],
    });
    await settle(p);
    expect(p.messages).toEqual([]);
  });

  it('resets streaming state on session change', async () => {
    // If a stream is in flight when the user starts a new
    // session, the UI should move on — no leftover streaming
    // card, no leftover request ID.
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = 'hi';
    await p._send();
    await settle(p);
    expect(p._streaming).toBe(true);
    pushEvent('session-changed', {
      session_id: 'sess_new',
      messages: [],
    });
    await settle(p);
    expect(p._streaming).toBe(false);
    expect(p._currentRequestId).toBeNull();
    expect(
      p.shadowRoot.querySelector('.message-card.streaming'),
    ).toBeNull();
  });

  it('preserves system_event flag when loading messages', async () => {
    const p = mountPanel();
    await settle(p);
    pushEvent('session-changed', {
      messages: [
        {
          role: 'user',
          content: 'Committed abc1234',
          system_event: true,
        },
        { role: 'user', content: 'then I typed this' },
      ],
    });
    await settle(p);
    expect(p.messages[0].system_event).toBe(true);
    expect(p.messages[1].system_event).toBeUndefined();
  });

  it('preserves turn_id from persisted records', async () => {
    // Increment A persists turn_id on every
    // record produced by an agentic turn. Session
    // reload must thread it back so the historical
    // "View agents" affordance works after refresh.
    const p = mountPanel();
    await settle(p);
    pushEvent('session-changed', {
      messages: [
        {
          role: 'user',
          content: 'spawn agents',
          turn_id: 'turn_abc',
        },
        {
          role: 'assistant',
          content: 'delegated',
          turn_id: 'turn_abc',
        },
        {
          role: 'user',
          content: 'pre-Increment-A record',
        },
      ],
    });
    await settle(p);
    expect(p.messages[0].turn_id).toBe('turn_abc');
    expect(p.messages[1].turn_id).toBe('turn_abc');
    expect('turn_id' in p.messages[2]).toBe(false);
  });

  it('preserves agent_blocks from persisted assistant records', async () => {
    // Per spec specs4/3-llm/history.md § Cross-Turn
    // Agent Reconstruction — assistant records that
    // spawned agents persist the {id, agent_idx}
    // mapping. Session reload threads it back so
    // historical-turn UI can recover the right
    // archive directories.
    const p = mountPanel();
    await settle(p);
    pushEvent('session-changed', {
      messages: [
        { role: 'user', content: 'go' },
        {
          role: 'assistant',
          content: 'delegated',
          turn_id: 'turn_abc',
          agent_blocks: [
            { id: 'a0', agent_idx: 0 },
            { id: 'a1', agent_idx: 1 },
          ],
        },
      ],
    });
    await settle(p);
    expect(p.messages[1].agent_blocks).toEqual([
      { id: 'a0', agent_idx: 0 },
      { id: 'a1', agent_idx: 1 },
    ]);
  });

  it('omits empty agent_blocks array on reload', async () => {
    // Records that DO have the key but with an
    // empty array (defensive against future
    // backend changes) shouldn't surface a phantom
    // affordance trigger.
    const p = mountPanel();
    await settle(p);
    pushEvent('session-changed', {
      messages: [
        {
          role: 'assistant',
          content: 'no agents',
          turn_id: 'turn_abc',
          agent_blocks: [],
        },
      ],
    });
    await settle(p);
    expect('agent_blocks' in p.messages[0]).toBe(false);
    expect(p.messages[0].turn_id).toBe('turn_abc');
  });

  it('omits non-string turn_id defensively', async () => {
    const p = mountPanel();
    await settle(p);
    pushEvent('session-changed', {
      messages: [
        { role: 'user', content: 'a', turn_id: 42 },
        { role: 'user', content: 'b', turn_id: '' },
        { role: 'user', content: 'c', turn_id: null },
      ],
    });
    await settle(p);
    expect('turn_id' in p.messages[0]).toBe(false);
    expect('turn_id' in p.messages[1]).toBe(false);
    expect('turn_id' in p.messages[2]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multimodal session-changed normalisation
// ---------------------------------------------------------------------------

describe('ChatPanel multimodal session-changed', () => {
  it('extracts images from multimodal content blocks', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    pushEvent('session-changed', {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look at this' },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,FROMSESSION',
              },
            },
          ],
        },
      ],
    });
    await settle(p);
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content).toBe('look at this');
    expect(p.messages[0].images).toEqual([
      'data:image/png;base64,FROMSESSION',
    ]);
  });

  it('preserves pre-existing images field if present', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    // Server may send a flattened shape too — string
    // content plus an images field. Preserve it.
    pushEvent('session-changed', {
      messages: [
        {
          role: 'user',
          content: 'hi',
          images: ['data:image/png;base64,ALREADY'],
        },
      ],
    });
    await settle(p);
    expect(p.messages[0].images).toEqual([
      'data:image/png;base64,ALREADY',
    ]);
  });

  it('messages without images get no images field', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    pushEvent('session-changed', {
      messages: [{ role: 'user', content: 'plain text' }],
    });
    await settle(p);
    expect(p.messages[0].images).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Compaction events — URL fetch stages
// ---------------------------------------------------------------------------

describe('ChatPanel compaction events — URL fetch stages', () => {
  async function sendAndGetId(panel, text = 'hi') {
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    await settle(panel);
    panel._input = text;
    await panel._send();
    await settle(panel);
    return started.mock.calls[0][0];
  }

  it('url_fetch emits info toast with display name', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      pushEvent('compaction-event', {
        requestId: reqId,
        event: {
          stage: 'url_fetch',
          url: 'github.com/owner/repo',
        },
      });
      await settle(p);
      expect(toasts).toHaveBeenCalledOnce();
      const detail = toasts.mock.calls[0][0].detail;
      expect(detail.type).toBe('info');
      expect(detail.message).toContain('github.com/owner/repo');
      expect(detail.message).toMatch(/fetching/i);
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });

  it('url_ready emits success toast', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      pushEvent('compaction-event', {
        requestId: reqId,
        event: {
          stage: 'url_ready',
          url: 'example.com/docs/foo',
        },
      });
      await settle(p);
      const detail = toasts.mock.calls[0][0].detail;
      expect(detail.type).toBe('success');
      expect(detail.message).toContain('example.com/docs/foo');
      expect(detail.message).toMatch(/fetched/i);
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });

  it('url_fetch falls back to generic label when url missing', async () => {
    // Defensive — the backend should always include a
    // display name, but if a future version forgets, we
    // show "URL" rather than "undefined" or crashing.
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      pushEvent('compaction-event', {
        requestId: reqId,
        event: { stage: 'url_fetch' },
      });
      await settle(p);
      const detail = toasts.mock.calls[0][0].detail;
      expect(detail.message).toContain('URL');
      expect(detail.message).not.toContain('undefined');
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });
});

// ---------------------------------------------------------------------------
// Compaction events — compaction stages
// ---------------------------------------------------------------------------

describe('ChatPanel compaction events — compaction stages', () => {
  async function sendAndGetId(panel, text = 'hi') {
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    await settle(panel);
    panel._input = text;
    await panel._send();
    await settle(panel);
    return started.mock.calls[0][0];
  }

  it('compacting emits info toast', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'ok' },
    });
    await settle(p);
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      pushEvent('compaction-event', {
        requestId: reqId,
        event: { stage: 'compacting' },
      });
      await settle(p);
      const detail = toasts.mock.calls[0][0].detail;
      expect(detail.type).toBe('info');
      expect(detail.message).toMatch(/compacting/i);
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });

  it('compacted replaces messages with compacted list', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p, 'original question');
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'original answer' },
    });
    await settle(p);
    expect(p.messages).toHaveLength(2);
    pushEvent('compaction-event', {
      requestId: reqId,
      event: {
        stage: 'compacted',
        case: 'summarize',
        messages: [
          {
            role: 'user',
            content: '[History Summary]\nbrief recap',
          },
          {
            role: 'assistant',
            content: 'Ok, I understand.',
          },
        ],
      },
    });
    await settle(p);
    expect(p.messages).toHaveLength(2);
    expect(p.messages[0].content).toContain('History Summary');
    expect(p.messages[1].content).toContain('understand');
  });

  it('compacted emits success toast with case-specific wording', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'ok' },
    });
    await settle(p);
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      pushEvent('compaction-event', {
        requestId: reqId,
        event: {
          stage: 'compacted',
          case: 'truncate',
          messages: [],
        },
      });
      await settle(p);
      const detail = toasts.mock.calls[0][0].detail;
      expect(detail.type).toBe('success');
      expect(detail.message).toMatch(/truncat/i);
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });

  it('compacted with summarize case has distinct wording', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'ok' },
    });
    await settle(p);
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      pushEvent('compaction-event', {
        requestId: reqId,
        event: {
          stage: 'compacted',
          case: 'summarize',
          messages: [],
        },
      });
      await settle(p);
      const detail = toasts.mock.calls[0][0].detail;
      expect(detail.message).toMatch(/summar/i);
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });

  it('compacted without messages field does not crash', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'kept message' },
    });
    await settle(p);
    const preMessages = p.messages.length;
    pushEvent('compaction-event', {
      requestId: reqId,
      event: { stage: 'compacted', case: 'none' },
    });
    await settle(p);
    expect(p.messages).toHaveLength(preMessages);
  });

  it('compacted normalises multimodal content in replacement', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'ok' },
    });
    await settle(p);
    pushEvent('compaction-event', {
      requestId: reqId,
      event: {
        stage: 'compacted',
        case: 'summarize',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'look' },
              {
                type: 'image_url',
                image_url: {
                  url: 'data:image/png;base64,PRESERVED',
                },
              },
            ],
          },
        ],
      },
    });
    await settle(p);
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content).toBe('look');
    expect(p.messages[0].images).toEqual([
      'data:image/png;base64,PRESERVED',
    ]);
  });

  it('compacted preserves system_event flag', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'ok' },
    });
    await settle(p);
    pushEvent('compaction-event', {
      requestId: reqId,
      event: {
        stage: 'compacted',
        case: 'truncate',
        messages: [
          {
            role: 'user',
            content: 'Committed abc',
            system_event: true,
          },
          { role: 'user', content: 'regular' },
        ],
      },
    });
    await settle(p);
    expect(p.messages[0].system_event).toBe(true);
    expect(p.messages[1].system_event).toBeUndefined();
  });

  it('compacted preserves turn_id and agent_blocks', async () => {
    // Compaction's truncate case keeps the
    // verbatim window unchanged — including any
    // agentic-turn metadata. The summarize case
    // synthesises new summary messages without
    // turn_id (correct — they didn't come from a
    // turn). Both shapes round-trip cleanly here.
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'ok' },
    });
    await settle(p);
    pushEvent('compaction-event', {
      requestId: reqId,
      event: {
        stage: 'compacted',
        case: 'truncate',
        messages: [
          { role: 'user', content: 'pre-A record' },
          {
            role: 'user',
            content: 'spawn',
            turn_id: 'turn_late',
          },
          {
            role: 'assistant',
            content: 'delegated',
            turn_id: 'turn_late',
            agent_blocks: [
              { id: 'a0', agent_idx: 0 },
            ],
          },
        ],
      },
    });
    await settle(p);
    expect('turn_id' in p.messages[0]).toBe(false);
    expect(p.messages[1].turn_id).toBe('turn_late');
    expect(p.messages[2].turn_id).toBe('turn_late');
    expect(p.messages[2].agent_blocks).toEqual([
      { id: 'a0', agent_idx: 0 },
    ]);
  });

  it('compaction_error emits error toast with backend detail', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'ok' },
    });
    await settle(p);
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      pushEvent('compaction-event', {
        requestId: reqId,
        event: {
          stage: 'compaction_error',
          error: 'detector LLM returned malformed JSON',
        },
      });
      await settle(p);
      const detail = toasts.mock.calls[0][0].detail;
      expect(detail.type).toBe('error');
      expect(detail.message).toContain('detector LLM');
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });

  it('compaction_error does not modify messages', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetId(p, 'keep me');
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'and me' },
    });
    await settle(p);
    const before = p.messages.map((m) => m.content);
    pushEvent('compaction-event', {
      requestId: reqId,
      event: {
        stage: 'compaction_error',
        error: 'boom',
      },
    });
    await settle(p);
    expect(p.messages.map((m) => m.content)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Compaction events — request ID filtering
// ---------------------------------------------------------------------------

describe('ChatPanel compaction events — request ID filtering', () => {
  async function sendAndCompleteStream(panel, text = 'hi') {
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    await settle(panel);
    panel._input = text;
    await panel._send();
    await settle(panel);
    const reqId = started.mock.calls[0][0];
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'done' },
    });
    await settle(panel);
    return reqId;
  }

  it('accepts events for the most recently completed request', async () => {
    // Common case — stream completes, compaction event
    // arrives after. `_currentRequestId` is null by then,
    // but `_lastRequestId` matches.
    const p = mountPanel();
    const reqId = await sendAndCompleteStream(p);
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      pushEvent('compaction-event', {
        requestId: reqId,
        event: { stage: 'compacting' },
      });
      await settle(p);
      expect(toasts).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });

  it('accepts events for the current streaming request', async () => {
    // Rare but possible — a compaction event arrives
    // mid-stream. `_currentRequestId` matches.
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = 'hi';
    await p._send();
    await settle(p);
    const reqId = started.mock.calls[0][0];
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      pushEvent('compaction-event', {
        requestId: reqId,
        event: {
          stage: 'url_fetch',
          url: 'github.com/x/y',
        },
      });
      await settle(p);
      expect(toasts).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });

  it('drops events for unknown request IDs', async () => {
    const p = mountPanel();
    await sendAndCompleteStream(p);
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      pushEvent('compaction-event', {
        requestId: 'random-unknown-id',
        event: { stage: 'compacting' },
      });
      await settle(p);
      expect(toasts).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });

  it('accepts events without a requestId (progress broadcasts)', async () => {
    const p = mountPanel();
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      pushEvent('compaction-event', {
        event: {
          stage: 'url_fetch',
          url: 'server-initiated',
        },
      });
      await settle(p);
      expect(toasts).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });
});

// ---------------------------------------------------------------------------
// Compaction events — defensive
// ---------------------------------------------------------------------------

describe('ChatPanel compaction events — defensive', () => {
  it('unknown stage is silently ignored', async () => {
    const p = mountPanel();
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      pushEvent('compaction-event', {
        event: { stage: 'future_stage_we_dont_know_about' },
      });
      await settle(p);
      expect(toasts).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });

  it('doc_enrichment_* stages are ignored (handled elsewhere)', async () => {
    // Per spec: doc enrichment drives a header progress
    // bar, not a chat toast. Chat panel must not render
    // these even though they come through the same
    // channel.
    const p = mountPanel();
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      for (const stage of [
        'doc_enrichment_queued',
        'doc_enrichment_file_done',
        'doc_enrichment_complete',
        'doc_enrichment_failed',
      ]) {
        pushEvent('compaction-event', {
          event: { stage, file: 'docs/readme.md' },
        });
        await settle(p);
      }
      expect(toasts).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });

  it('malformed events (no event payload) do not crash', async () => {
    const p = mountPanel();
    await settle(p);
    for (const detail of [{}, { requestId: 'x' }, { event: null }]) {
      pushEvent('compaction-event', detail);
      await settle(p);
    }
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      pushEvent('compaction-event', {
        event: { stage: 'url_fetch', url: 'test' },
      });
      await settle(p);
      expect(toasts).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });

  it('event with missing stage field is ignored', async () => {
    const p = mountPanel();
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      pushEvent('compaction-event', {
        event: { url: 'no stage here' },
      });
      await settle(p);
      expect(toasts).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });
});

// ---------------------------------------------------------------------------
// User message broadcast echo handling
// ---------------------------------------------------------------------------

describe('ChatPanel user-message event', () => {
  it('ignores echo when we are the sender', async () => {
    const p = mountPanel();
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    await settle(p);
    p._input = 'hello';
    await p._send();
    await settle(p);
    pushEvent('user-message', { content: 'hello' });
    await settle(p);
    const userMessages = p.messages.filter(
      (m) => m.role === 'user' && !m.system_event,
    );
    expect(userMessages).toHaveLength(1);
  });

  it('adds the message when we are a passive observer', async () => {
    // No user-initiated request in flight — we're a
    // collaborator seeing another user's prompt.
    const p = mountPanel();
    await settle(p);
    pushEvent('user-message', {
      content: 'message from another client',
    });
    await settle(p);
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content).toBe(
      'message from another client',
    );
  });
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

describe('ChatPanel cleanup', () => {
  it('removes event listeners on disconnect', async () => {
    const p = mountPanel();
    await settle(p);
    p.remove();
    pushEvent('stream-chunk', {
      requestId: 'any',
      content: 'should be ignored',
    });
    expect(p._streamingContent).toBe('');
  });

  it('removes compaction-event listener on disconnect', async () => {
    const p = mountPanel();
    await settle(p);
    p.remove();
    const toasts = vi.fn();
    window.addEventListener('ac-toast', toasts);
    try {
      pushEvent('compaction-event', {
        event: { stage: 'url_fetch', url: 'test' },
      });
      await new Promise((r) => setTimeout(r, 10));
      expect(toasts).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('ac-toast', toasts);
    }
  });
});