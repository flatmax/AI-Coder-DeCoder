// Tests for webapp/src/chat-panel.js — ChatPanel component.
//
// Strategy:
//   - Stub SharedRpc via the RpcMixin's public API — set a fake
//     call proxy, verify dispatches land correctly.
//   - Simulate server-push events by dispatching the
//     corresponding CustomEvents on `window` directly (the
//     AppShell's job is to translate JRPC calls into these
//     window events; the chat panel doesn't know or care where
//     they come from).
//   - Use double-rAF waits to let the chat panel's scroll
//     machinery and rAF coalescing complete.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { SharedRpc } from './rpc.js';
import './chat-panel.js';
import {
  ChatPanel,
  generateRequestId,
  _DRAWER_STORAGE_KEY,
  _SEARCH_IGNORE_CASE_KEY,
  _SEARCH_REGEX_KEY,
  _SEARCH_WHOLE_WORD_KEY,
  _loadDrawerOpen,
  _loadSearchToggle,
  _saveDrawerOpen,
  _saveSearchToggle,
  buildAmbiguousRetryPrompt,
  buildInContextMismatchRetryPrompt,
  buildNotInContextRetryPrompt,
} from './chat-panel.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _mounted = [];

function mountPanel(props = {}) {
  const p = document.createElement('ac-chat-panel');
  Object.assign(p, props);
  document.body.appendChild(p);
  _mounted.push(p);
  return p;
}

/** Install a fake RPC proxy matching jrpc-oo's multi-remote shape. */
function publishFakeRpc(methods) {
  // The proxy is keyed by "Class.method" and each method
  // returns a single-key envelope, matching jrpc-oo's wire format.
  const proxy = {};
  for (const [name, impl] of Object.entries(methods)) {
    proxy[name] = async (...args) => {
      const value = await impl(...args);
      // Single-key envelope so rpcExtract unwraps cleanly.
      return { fake: value };
    };
  }
  SharedRpc.set(proxy);
  return proxy;
}

/** Await Lit's update + a couple of animation frames. */
async function settle(panel) {
  await panel.updateComplete;
  // Let rAF callbacks fire.
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  await panel.updateComplete;
}

/** Dispatch a server-push event on window. */
function pushEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

afterEach(() => {
  while (_mounted.length) {
    const p = _mounted.pop();
    if (p.isConnected) p.remove();
  }
  SharedRpc.reset();
  try {
    localStorage.removeItem(_DRAWER_STORAGE_KEY);
    localStorage.removeItem(_SEARCH_IGNORE_CASE_KEY);
    localStorage.removeItem(_SEARCH_REGEX_KEY);
    localStorage.removeItem(_SEARCH_WHOLE_WORD_KEY);
  } catch (_) {
    // Ignore — tests that run outside a localStorage-capable
    // environment don't need the cleanup.
  }
});

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
// Initial state
// ---------------------------------------------------------------------------

describe('ChatPanel initial state', () => {
  it('renders the empty state when no messages', async () => {
    const p = mountPanel();
    await settle(p);
    const empty = p.shadowRoot.querySelector('.empty-state');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toMatch(/conversation/i);
  });

  it('disables the input when RPC is not connected', async () => {
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    expect(ta.disabled).toBe(true);
    const note = p.shadowRoot.querySelector('.disconnected-note');
    expect(note).toBeTruthy();
  });

  it('enables the input when RPC is connected', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    expect(ta.disabled).toBe(false);
  });

  it('send button is disabled when input is empty', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.send-button');
    expect(btn.disabled).toBe(true);
  });

  it('send button enables after typing', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'hello';
    ta.dispatchEvent(new Event('input'));
    await p.updateComplete;
    const btn = p.shadowRoot.querySelector('.send-button');
    expect(btn.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------

describe('ChatPanel message rendering', () => {
  it('renders user and assistant messages with labels', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ],
    });
    await settle(p);
    const labels = Array.from(
      p.shadowRoot.querySelectorAll('.role-label'),
    ).map((el) => el.textContent.trim());
    expect(labels).toEqual(['You', 'Assistant']);
  });

  it('renders user content as markdown', async () => {
    // User input goes through the markdown renderer —
    // users type markdown-literate text (that's what the
    // LLM receives), so the chat UI should show it the
    // same way. See chat-panel.js _renderMessage comment.
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'use **bold** here' },
      ],
    });
    await settle(p);
    const html = p.shadowRoot.querySelector(
      '.role-user .md-content',
    ).innerHTML;
    expect(html).toContain('<strong>bold</strong>');
  });

  it('renders assistant content as markdown', async () => {
    const p = mountPanel({
      messages: [
        { role: 'assistant', content: 'use **bold** here' },
      ],
    });
    await settle(p);
    const html = p.shadowRoot.querySelector(
      '.role-assistant .md-content',
    ).innerHTML;
    expect(html).toContain('<strong>bold</strong>');
  });

  it('renders system event messages with distinct styling', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'user',
          content: 'Reset to HEAD',
          system_event: true,
        },
      ],
    });
    await settle(p);
    const card = p.shadowRoot.querySelector('.role-system');
    expect(card).toBeTruthy();
    // System events are markdown-rendered too.
    expect(card.querySelector('.md-content')).toBeTruthy();
  });

  it('renders code fences in assistant messages', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: '```\nsome code\n```',
        },
      ],
    });
    await settle(p);
    const pre = p.shadowRoot.querySelector(
      '.role-assistant pre',
    );
    expect(pre).toBeTruthy();
    expect(pre.textContent).toContain('some code');
  });
});

// ---------------------------------------------------------------------------
// Edit block rendering (integration with edit-blocks.js + edit-block-render.js)
// ---------------------------------------------------------------------------

describe('ChatPanel edit block rendering', () => {
  // Shared edit-block fixtures — literal marker bytes per D3.
  const EDIT_MARK = '🟧🟧🟧 EDIT';
  const REPL_MARK = '🟨🟨🟨 REPL';
  const END_MARK = '🟩🟩🟩 END';

  const simpleEditBlock = [
    'src/foo.py',
    EDIT_MARK,
    'old line',
    REPL_MARK,
    'new line',
    END_MARK,
  ].join('\n');

  const proseAndEdit = [
    'Here is the change:',
    '',
    simpleEditBlock,
    '',
    'That should fix it.',
  ].join('\n');

  it('renders prose segments through markdown', async () => {
    // Pin that prose outside the edit block still goes
    // through marked — the segmenter splits content into
    // prose and block parts, and prose must render as
    // markdown (paragraphs, inline code, etc.) not as
    // escaped text.
    const p = mountPanel({
      messages: [
        { role: 'assistant', content: proseAndEdit },
      ],
    });
    await settle(p);
    const card = p.shadowRoot.querySelector(
      '.role-assistant',
    );
    // Prose paragraphs appear as rendered markdown <p> tags.
    expect(card.querySelector('p')).toBeTruthy();
    expect(card.textContent).toContain('Here is the change');
    expect(card.textContent).toContain('That should fix it');
  });

  it('renders edit segment as edit-block-card', async () => {
    const p = mountPanel({
      messages: [
        { role: 'assistant', content: simpleEditBlock },
      ],
    });
    await settle(p);
    const cards = p.shadowRoot.querySelectorAll(
      '.edit-block-card',
    );
    expect(cards.length).toBe(1);
    // File path appears in the header.
    expect(cards[0].querySelector('.edit-file-path').textContent).toBe(
      'src/foo.py',
    );
    // Unified diff body — single `.edit-pane-content`
    // container holds both remove and add lines. No
    // labeled side panes.
    expect(cards[0].querySelector('.edit-pane-content')).toBeTruthy();
    expect(cards[0].querySelector('.edit-pane-old')).toBeNull();
    expect(cards[0].querySelector('.edit-pane-new')).toBeNull();
    // Per-line diff rows for remove and add. Lines carry
    // a non-selectable prefix (`-`/`+`/` `) so copy-paste
    // round-trips as unified-diff-shaped text. The prefix
    // is part of textContent even though the prefix span
    // is marked aria-hidden for screen readers.
    const removeLine = cards[0].querySelector(
      '.diff-line.remove',
    );
    const addLine = cards[0].querySelector('.diff-line.add');
    expect(removeLine).toBeTruthy();
    expect(addLine).toBeTruthy();
    expect(removeLine.textContent).toBe('-old line');
    expect(addLine.textContent).toBe('+new line');
  });

  it('renders message without editResults in pending state', async () => {
    // Settled message without editResults (e.g., an error
    // response or a message from before this feature landed)
    // — edit cards render with the pending status badge.
    const p = mountPanel({
      messages: [
        { role: 'assistant', content: simpleEditBlock },
      ],
    });
    await settle(p);
    const card = p.shadowRoot.querySelector('.edit-block-card');
    expect(card).toBeTruthy();
    expect(card.classList.contains('edit-status-pending')).toBe(true);
  });

  it('applies backend result status to edit card', async () => {
    // The whole point of pairing — an applied edit gets a
    // green badge, a failed one gets a red badge, etc. Pin
    // the two most common outcomes.
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: simpleEditBlock,
          editResults: [
            {
              file: 'src/foo.py',
              status: 'applied',
              message: '',
            },
          ],
        },
      ],
    });
    await settle(p);
    const card = p.shadowRoot.querySelector('.edit-block-card');
    expect(card.classList.contains('edit-status-applied')).toBe(true);
    expect(card.classList.contains('edit-status-pending')).toBe(false);
  });

  it('renders failed edit with error message', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: simpleEditBlock,
          editResults: [
            {
              file: 'src/foo.py',
              status: 'failed',
              message: 'Anchor not unique',
              error_type: 'ambiguous_anchor',
            },
          ],
        },
      ],
    });
    await settle(p);
    const card = p.shadowRoot.querySelector('.edit-block-card');
    expect(card.classList.contains('edit-status-failed')).toBe(true);
    const err = card.querySelector('.edit-error-message');
    expect(err).toBeTruthy();
    expect(err.textContent).toContain('Anchor not unique');
  });

  it('pairs multiple edits to same file in source order', async () => {
    // Two edits to src/foo.py → the Nth block pairs with
    // the Nth result for that file. Pinned explicitly
    // because the per-file-index-counter pattern is load
    // bearing and easy to regress.
    const content = [simpleEditBlock, '', simpleEditBlock].join('\n');
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content,
          editResults: [
            {
              file: 'src/foo.py',
              status: 'applied',
              message: 'first',
            },
            {
              file: 'src/foo.py',
              status: 'failed',
              message: 'second',
            },
          ],
        },
      ],
    });
    await settle(p);
    const cards = p.shadowRoot.querySelectorAll('.edit-block-card');
    expect(cards.length).toBe(2);
    expect(cards[0].classList.contains('edit-status-applied')).toBe(true);
    expect(cards[1].classList.contains('edit-status-failed')).toBe(true);
    // Error message only on the failed one.
    expect(cards[0].querySelector('.edit-error-message')).toBeNull();
    expect(cards[1].querySelector('.edit-error-message')).toBeTruthy();
  });

  it('renders create block with NEW pane only', async () => {
    // A create block has empty old-text. Unified-diff
    // body renders every line as an add — no remove
    // counterpart. Status badge is `new` for cards
    // without a backend result.
    const createBlock = [
      'src/new.py',
      EDIT_MARK,
      REPL_MARK,
      'print("hello")',
      END_MARK,
    ].join('\n');
    const p = mountPanel({
      messages: [
        { role: 'assistant', content: createBlock },
      ],
    });
    await settle(p);
    const card = p.shadowRoot.querySelector('.edit-block-card');
    expect(card.classList.contains('edit-status-new')).toBe(true);
    // Single unified pane — no labeled side panes.
    expect(card.querySelector('.edit-pane-content')).toBeTruthy();
    expect(card.querySelector('.edit-pane-old')).toBeNull();
    expect(card.querySelector('.edit-pane-new')).toBeNull();
    // Only add lines; no remove lines.
    expect(card.querySelector('.diff-line.add')).toBeTruthy();
    expect(card.querySelector('.diff-line.remove')).toBeNull();
    // Add line carries the `+` prefix marker.
    expect(
      card.querySelector('.diff-line.add').textContent,
    ).toBe('+print("hello")');
  });

  it('renders pending block during streaming', async () => {
    // Partial edit block mid-stream renders as a card with
    // the pending badge. The segmenter's edit-pending state
    // flows through to renderEditCard which shows "pending"
    // for segments with no final END marker yet.
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    // Start a stream.
    p._input = 'hi';
    await p._send();
    const reqId = started.mock.calls[0][0];
    // Feed a chunk with a partial edit block.
    const partial = [
      'Here is the change:',
      '',
      'src/foo.py',
      EDIT_MARK,
      'old line one',
      'old line t',
    ].join('\n');
    pushEvent('stream-chunk', {
      requestId: reqId,
      content: partial,
    });
    await settle(p);
    // Streaming card contains the pending edit card.
    const streaming = p.shadowRoot.querySelector(
      '.message-card.streaming',
    );
    expect(streaming).toBeTruthy();
    const card = streaming.querySelector('.edit-block-card');
    expect(card).toBeTruthy();
    expect(card.classList.contains('edit-status-pending')).toBe(true);
    // Unified pane shows the in-progress content. The
    // segmenter is still in `reading-old` — no REPL marker
    // yet — so the buffered lines have no add counterparts
    // and render as remove-only in the unified diff. Each
    // line carries the `-` prefix marker; the line
    // separator is `\n` between diff-line spans.
    expect(
      card.querySelector('.edit-pane-content').textContent,
    ).toBe('-old line one\n-old line t');
    // Two remove lines, no add lines — this is a
    // reading-old pending segment.
    expect(card.querySelectorAll('.diff-line.remove')).toHaveLength(2);
    expect(card.querySelector('.diff-line.add')).toBeNull();
  });

  it('streaming cursor appears after the body', async () => {
    // The cursor marks the streaming card as live. It needs
    // to be after the body so it's visible even when the
    // last segment is an edit card (not prose).
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = 'hi';
    await p._send();
    const reqId = started.mock.calls[0][0];
    pushEvent('stream-chunk', {
      requestId: reqId,
      content: 'Working on it',
    });
    await settle(p);
    const streaming = p.shadowRoot.querySelector(
      '.message-card.streaming',
    );
    expect(streaming).toBeTruthy();
    const cursor = streaming.querySelector('.cursor');
    expect(cursor).toBeTruthy();
  });

  it('finalising a stream with editResults applies statuses', async () => {
    // End-to-end: stream a response containing an edit
    // block, then deliver stream-complete with edit_results.
    // The settled message's card picks up the backend
    // status.
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = 'hi';
    await p._send();
    const reqId = started.mock.calls[0][0];
    pushEvent('stream-chunk', {
      requestId: reqId,
      content: simpleEditBlock,
    });
    pushEvent('stream-complete', {
      requestId: reqId,
      result: {
        response: simpleEditBlock,
        edit_results: [
          {
            file: 'src/foo.py',
            status: 'applied',
            message: '',
          },
        ],
      },
    });
    await settle(p);
    // Streaming card gone; settled card shows applied
    // status.
    expect(
      p.shadowRoot.querySelector('.message-card.streaming'),
    ).toBeNull();
    const card = p.shadowRoot.querySelector('.edit-block-card');
    expect(card).toBeTruthy();
    expect(card.classList.contains('edit-status-applied')).toBe(true);
  });

  it('user message with edit-block-shaped content renders as text', async () => {
    // Users might paste an edit block as a quote or
    // reference. User content must render escaped — never
    // go through the segmenter — so the markers appear as
    // literal text and nothing is mistaken for an edit.
    const p = mountPanel({
      messages: [
        { role: 'user', content: simpleEditBlock },
      ],
    });
    await settle(p);
    const userCard = p.shadowRoot.querySelector('.role-user');
    // No edit cards rendered inside a user message.
    expect(userCard.querySelector('.edit-block-card')).toBeNull();
    // The raw content (including markers) is visible as
    // text.
    expect(userCard.textContent).toContain('EDIT');
    expect(userCard.textContent).toContain('REPL');
    expect(userCard.textContent).toContain('END');
  });

  it('error message does not segment', async () => {
    // Stream-complete with an error produces `**Error:**
    // ...` as content. That shouldn't be run through the
    // segmenter — it's a meta-message, not an LLM response.
    // It just goes through markdown like any other
    // assistant message without edit blocks.
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: '**Error:** something broke',
        },
      ],
    });
    await settle(p);
    const card = p.shadowRoot.querySelector('.role-assistant');
    // Bold markdown rendered.
    expect(card.querySelector('strong')).toBeTruthy();
    // No edit cards (there's no edit block in the content).
    expect(card.querySelector('.edit-block-card')).toBeNull();
  });

  it('empty assistant content renders empty body without crashing', async () => {
    // Defensive — a zero-length content (brief window
    // between stream start and first chunk for settled
    // messages) shouldn't crash the render.
    const p = mountPanel({
      messages: [
        { role: 'assistant', content: '' },
      ],
    });
    await settle(p);
    const card = p.shadowRoot.querySelector('.role-assistant');
    expect(card).toBeTruthy();
    // No edit cards.
    expect(card.querySelector('.edit-block-card')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// File mentions
// ---------------------------------------------------------------------------

describe('ChatPanel file mentions', () => {
  it('does not wrap mentions when repoFiles is empty (default)', async () => {
    // Default state — no files list means no mention
    // detection runs. The LLM's path-shaped text renders
    // as plain prose.
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'see src/foo.py for details',
        },
      ],
    });
    await settle(p);
    const card = p.shadowRoot.querySelector('.role-assistant');
    expect(card.querySelector('.file-mention')).toBeNull();
    // But the text is still there.
    expect(card.textContent).toContain('src/foo.py');
  });

  it('wraps mentions in final assistant messages when repoFiles set', async () => {
    const p = mountPanel({
      repoFiles: ['src/foo.py'],
      messages: [
        {
          role: 'assistant',
          content: 'see src/foo.py for details',
        },
      ],
    });
    await settle(p);
    const span = p.shadowRoot.querySelector('.file-mention');
    expect(span).toBeTruthy();
    expect(span.getAttribute('data-file')).toBe('src/foo.py');
    expect(span.textContent).toBe('src/foo.py');
  });

  it('does NOT wrap mentions in user messages', async () => {
    // User content is rendered escaped, never through the
    // segmenter. Mentions only apply to assistant output.
    const p = mountPanel({
      repoFiles: ['src/foo.py'],
      messages: [
        { role: 'user', content: 'please edit src/foo.py' },
      ],
    });
    await settle(p);
    const userCard = p.shadowRoot.querySelector('.role-user');
    expect(userCard.querySelector('.file-mention')).toBeNull();
    expect(userCard.textContent).toContain('src/foo.py');
  });

  it('does NOT wrap mentions in streaming messages', async () => {
    // Mid-stream content grows chunk by chunk; wrapping
    // would flicker as the LLM extends `src/foo.py` into
    // `src/foo.pyc` or some other substring. Streaming
    // renders skip mention detection per spec.
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel({ repoFiles: ['src/foo.py'] });
    await settle(p);
    p._input = 'hi';
    await p._send();
    const reqId = started.mock.calls[0][0];
    pushEvent('stream-chunk', {
      requestId: reqId,
      content: 'editing src/foo.py now',
    });
    await settle(p);
    const streaming = p.shadowRoot.querySelector(
      '.message-card.streaming',
    );
    expect(streaming).toBeTruthy();
    expect(streaming.querySelector('.file-mention')).toBeNull();
    // Text still visible — we just haven't wrapped it.
    expect(streaming.textContent).toContain('src/foo.py');
  });

  it('wraps mentions after stream completes', async () => {
    // End-to-end: during streaming no wrap, after
    // stream-complete the settled message DOES wrap.
    // Proves the isStreaming flag flips correctly.
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel({ repoFiles: ['src/foo.py'] });
    await settle(p);
    p._input = 'hi';
    await p._send();
    const reqId = started.mock.calls[0][0];
    pushEvent('stream-chunk', {
      requestId: reqId,
      content: 'editing src/foo.py now',
    });
    await settle(p);
    // Mid-stream — no wrap.
    expect(
      p.shadowRoot.querySelector('.file-mention'),
    ).toBeNull();
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'editing src/foo.py now' },
    });
    await settle(p);
    // Settled — wrap appears.
    const span = p.shadowRoot.querySelector('.file-mention');
    expect(span).toBeTruthy();
    expect(span.getAttribute('data-file')).toBe('src/foo.py');
  });

  it('wraps multiple mentions across multiple messages', async () => {
    const p = mountPanel({
      repoFiles: ['a.py', 'b.py'],
      messages: [
        { role: 'assistant', content: 'first edit a.py' },
        { role: 'assistant', content: 'then edit b.py' },
      ],
    });
    await settle(p);
    const spans = p.shadowRoot.querySelectorAll('.file-mention');
    expect(spans.length).toBe(2);
    const paths = Array.from(spans).map((s) =>
      s.getAttribute('data-file'),
    );
    expect(paths).toEqual(['a.py', 'b.py']);
  });

  it('does NOT wrap mentions inside rendered code blocks', async () => {
    // findFileMentions skips <pre> and <code> interiors.
    // Integration check — the chat panel's assistant body
    // renders markdown first (producing <pre><code>…) and
    // passes the result through the wrapper.
    const p = mountPanel({
      repoFiles: ['src/foo.py'],
      messages: [
        {
          role: 'assistant',
          content: '```\nsrc/foo.py is a path\n```',
        },
      ],
    });
    await settle(p);
    const card = p.shadowRoot.querySelector('.role-assistant');
    // Path appears in the rendered <pre> but no wrapping.
    expect(card.textContent).toContain('src/foo.py');
    expect(card.querySelector('.file-mention')).toBeNull();
  });

  it('wraps mentions in prose but not in code within same message', async () => {
    // Mixed content — prose mention wraps, code mention
    // doesn't. Pinned explicitly because the integration
    // between markdown rendering and mention wrapping is
    // the subtle part.
    const p = mountPanel({
      repoFiles: ['src/foo.py'],
      messages: [
        {
          role: 'assistant',
          content:
            'edit src/foo.py\n\n```\ndo not wrap src/foo.py here\n```',
        },
      ],
    });
    await settle(p);
    const spans = p.shadowRoot.querySelectorAll('.file-mention');
    // Exactly one wrap — the prose occurrence. The one
    // inside the code fence stays plain.
    expect(spans.length).toBe(1);
  });
});

describe('ChatPanel file mention clicks', () => {
  it('dispatches file-mention-click on click', async () => {
    const p = mountPanel({
      repoFiles: ['src/foo.py'],
      messages: [
        {
          role: 'assistant',
          content: 'see src/foo.py here',
        },
      ],
    });
    await settle(p);
    const listener = vi.fn();
    p.addEventListener('file-mention-click', listener);
    const span = p.shadowRoot.querySelector('.file-mention');
    span.click();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toEqual({
      path: 'src/foo.py',
    });
  });

  it('event bubbles out of the shadow DOM (composed)', async () => {
    // The files-tab orchestrator listens at its own
    // level; the event must cross the shadow boundary.
    const p = mountPanel({
      repoFiles: ['src/foo.py'],
      messages: [
        {
          role: 'assistant',
          content: 'see src/foo.py here',
        },
      ],
    });
    await settle(p);
    const outerListener = vi.fn();
    document.body.addEventListener(
      'file-mention-click',
      outerListener,
    );
    try {
      p.shadowRoot
        .querySelector('.file-mention')
        .click();
      expect(outerListener).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener(
        'file-mention-click',
        outerListener,
      );
    }
  });

  it('clicks on non-mention elements do not dispatch', async () => {
    // The delegated click handler filters by class. A
    // click anywhere else in the messages container (text,
    // role labels, code blocks) shouldn't fire the event.
    const p = mountPanel({
      repoFiles: ['src/foo.py'],
      messages: [
        {
          role: 'assistant',
          content: 'prose before src/foo.py and after',
        },
      ],
    });
    await settle(p);
    const listener = vi.fn();
    p.addEventListener('file-mention-click', listener);
    // Click on the role label — not a mention.
    p.shadowRoot
      .querySelector('.role-label')
      .click();
    expect(listener).not.toHaveBeenCalled();
    // And on the outer card.
    p.shadowRoot
      .querySelector('.message-card')
      .click();
    expect(listener).not.toHaveBeenCalled();
  });

  it('mention without data-file attribute does not dispatch', async () => {
    // Defensive — a malformed span (e.g., from a future
    // refactor that accidentally drops the attribute)
    // shouldn't fire with an undefined path.
    const p = mountPanel();
    await settle(p);
    // Inject a malformed mention into the DOM directly
    // via a fake message. Since wrapping always sets
    // data-file, we simulate the malformed case by setting
    // a mention manually.
    const container = p.shadowRoot.querySelector('.messages');
    const fake = document.createElement('span');
    fake.className = 'file-mention';
    // No data-file attribute.
    fake.textContent = 'broken';
    container.appendChild(fake);
    const listener = vi.fn();
    p.addEventListener('file-mention-click', listener);
    fake.click();
    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Send + streaming
// ---------------------------------------------------------------------------

describe('ChatPanel send flow', () => {
  it('adds the user message optimistically on send', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'hello world';
    ta.dispatchEvent(new Event('input'));
    await p.updateComplete;
    p.shadowRoot.querySelector('.send-button').click();
    await settle(p);
    // User message shown before the stream completes.
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].role).toBe('user');
    expect(p.messages[0].content).toBe('hello world');
  });

  it('calls LLMService.chat_streaming with a request ID', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'hi';
    ta.dispatchEvent(new Event('input'));
    await p.updateComplete;
    p.shadowRoot.querySelector('.send-button').click();
    await settle(p);
    expect(started).toHaveBeenCalledOnce();
    // First arg is a request ID string, second is the message.
    const [reqId, msg] = started.mock.calls[0];
    expect(typeof reqId).toBe('string');
    expect(reqId).toMatch(/^\d+-/);
    expect(msg).toBe('hi');
  });

  it('clears the input after send', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'bye';
    ta.dispatchEvent(new Event('input'));
    await p.updateComplete;
    p.shadowRoot.querySelector('.send-button').click();
    await settle(p);
    expect(p._input).toBe('');
  });

  it('flips to streaming state after send', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'x';
    ta.dispatchEvent(new Event('input'));
    await p.updateComplete;
    p.shadowRoot.querySelector('.send-button').click();
    await settle(p);
    expect(p._streaming).toBe(true);
    // Send button became Stop.
    const btn = p.shadowRoot.querySelector('.send-button');
    expect(btn.classList.contains('stop')).toBe(true);
    expect(btn.textContent).toContain('Stop');
  });

  it('does nothing when input is empty', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    // Click Send with empty input — button is disabled but
    // call _send directly to prove the guard works.
    await p._send();
    expect(started).not.toHaveBeenCalled();
    expect(p.messages).toHaveLength(0);
  });

  it('does nothing while already streaming', async () => {
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    // First send.
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'first';
    ta.dispatchEvent(new Event('input'));
    await p.updateComplete;
    p.shadowRoot.querySelector('.send-button').click();
    await settle(p);
    // Try to send again — should be gated by _streaming.
    p._input = 'second';
    await p._send();
    expect(started).toHaveBeenCalledOnce();
  });

  it('shows an error message when chat_streaming rejects', async () => {
    const started = vi
      .fn()
      .mockRejectedValue(new Error('network down'));
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    // Silence the error log the chat panel emits — we know
    // the rejection is expected and we're asserting on its
    // visible effect (the error message card), not the log.
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      // Send.
      p._input = 'hello';
      await p._send();
      await settle(p);
      // User message still there, plus an error assistant
      // message; streaming flag cleared.
      expect(p.messages).toHaveLength(2);
      expect(p.messages[1].content).toContain('network down');
      expect(p._streaming).toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Streaming via server-push events
// ---------------------------------------------------------------------------

describe('ChatPanel streaming events', () => {
  async function sendAndGetRequestId(panel, message = 'hi') {
    // Send and return the ID the chat panel generated. Needed
    // because the ID is internal; we read it after the send
    // registers it.
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    // Re-mount-friendly: replace existing proxy.
    await settle(panel);
    panel._input = message;
    await panel._send();
    return started.mock.calls[0][0];
  }

  it('renders streaming chunks in the assistant slot', async () => {
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p, 'hi');
    // Two chunks arrive — full-content shape, second is a
    // superset of the first.
    pushEvent('stream-chunk', {
      requestId: reqId,
      content: 'Hello',
    });
    pushEvent('stream-chunk', {
      requestId: reqId,
      content: 'Hello, world',
    });
    // Let rAF and Lit settle.
    await settle(p);
    const streaming = p.shadowRoot.querySelector(
      '.message-card.streaming',
    );
    expect(streaming).toBeTruthy();
    expect(streaming.textContent).toContain('Hello, world');
  });

  it('ignores chunks for other request IDs', async () => {
    // Collaboration — a stream from another user's prompt
    // arrives with a different request ID. Phase 2b ignores
    // these; Phase 2d will adopt them as passive streams.
    const p = mountPanel();
    const reqId = await sendAndGetRequestId(p, 'hi');
    pushEvent('stream-chunk', {
      requestId: 'other-request-id',
      content: 'should not render',
    });
    await settle(p);
    // Streaming slot shows empty content, not the other
    // request's chunk.
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
    // Messages — user then assistant with final content.
    expect(p.messages).toHaveLength(2);
    expect(p.messages[1].role).toBe('assistant');
    expect(p.messages[1].content).toBe('final answer');
    // Streaming cleared.
    expect(p._streaming).toBe(false);
    expect(p._streamingContent).toBe('');
    // Streaming card gone.
    expect(
      p.shadowRoot.querySelector('.message-card.streaming'),
    ).toBeNull();
  });

  it('uses last streaming content when result lacks response', async () => {
    // Cancelled streams produce a completion without `response`;
    // we fall back to the last streamed content so partial
    // work isn't lost.
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
// Chunk coalescing via rAF
// ---------------------------------------------------------------------------

describe('ChatPanel chunk coalescing', () => {
  it('applies the latest content on each animation frame', async () => {
    // The rAF callback drains pending content — rapid chunks
    // arriving between frames coalesce into one Lit update.
    const p = mountPanel();
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    await settle(p);
    p._input = 'hi';
    await p._send();
    const reqId = started.mock.calls[0][0];

    // Fire three chunks back-to-back — only the last should
    // be reflected after the single rAF callback fires.
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
    // full accumulated content. If we were appending deltas,
    // this test would show 'first' + 'chunk-3' concatenated.
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
    // Simulate dropped middle chunk — no "firstmiddle".
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
    // Matches the active request ID.
    expect(cancel.mock.calls[0][0]).toBe(started.mock.calls[0][0]);
  });

  it('recovers locally when cancel fails', async () => {
    // Best-effort cancellation — if the server already
    // finished, the cancel RPC may error. The chat panel
    // cleans up locally so the UI doesn't stay stuck in
    // streaming state.
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
    // Silence the expected warn log — we're asserting on
    // the local-cleanup behaviour, not the log output.
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
    // The server would broadcast userMessage; simulate it.
    pushEvent('user-message', { content: 'hello' });
    await settle(p);
    // Only the optimistically-added one is present.
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
// New session button
// ---------------------------------------------------------------------------

describe('ChatPanel new-session button', () => {
  it('renders the button', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.new-session-button');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('New session');
  });

  it('is disabled when RPC is not connected', async () => {
    const p = mountPanel();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.new-session-button');
    expect(btn.disabled).toBe(true);
  });

  it('is enabled when RPC is connected and not streaming', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.new-session-button');
    expect(btn.disabled).toBe(false);
  });

  it('is disabled during streaming', async () => {
    // Specs4 says starting a new session cancels in-flight
    // streams, but we gate at the UI level — the user
    // cancels explicitly first. Matches the pattern where
    // destructive operations need a clean state.
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = 'hi';
    await p._send();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.new-session-button');
    expect(btn.disabled).toBe(true);
  });

  it('calls LLMService.new_session on click', async () => {
    const newSession = vi
      .fn()
      .mockResolvedValue({ session_id: 'sess_new' });
    publishFakeRpc({ 'LLMService.new_session': newSession });
    const p = mountPanel();
    await settle(p);
    p.shadowRoot.querySelector('.new-session-button').click();
    await settle(p);
    expect(newSession).toHaveBeenCalledOnce();
  });

  it('does not modify local message list directly on click', async () => {
    // The server's `sessionChanged` broadcast is what
    // clears the message list. The click alone must
    // NOT mutate messages — otherwise a failed RPC
    // would leave the UI in a spuriously-cleared state.
    const newSession = vi
      .fn()
      .mockResolvedValue({ session_id: 'sess_new' });
    publishFakeRpc({ 'LLMService.new_session': newSession });
    const p = mountPanel({
      messages: [{ role: 'user', content: 'existing' }],
    });
    await settle(p);
    p.shadowRoot.querySelector('.new-session-button').click();
    await settle(p);
    // Messages still there — broadcast hasn't arrived.
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content).toBe('existing');
  });

  it('session-changed broadcast after click clears messages', async () => {
    // End-to-end: click the button, simulate the server
    // broadcast, messages clear. Proves the button + the
    // existing `session-changed` handler compose correctly.
    const newSession = vi
      .fn()
      .mockResolvedValue({ session_id: 'sess_new' });
    publishFakeRpc({ 'LLMService.new_session': newSession });
    const p = mountPanel({
      messages: [{ role: 'user', content: 'before' }],
    });
    await settle(p);
    p.shadowRoot.querySelector('.new-session-button').click();
    await settle(p);
    // Server responds — the AppShell would normally
    // translate `sessionChanged` RPC into this window
    // event. Simulate it directly.
    pushEvent('session-changed', {
      session_id: 'sess_new',
      messages: [],
    });
    await settle(p);
    expect(p.messages).toEqual([]);
  });

  it('RPC failure is logged but does not crash', async () => {
    const newSession = vi
      .fn()
      .mockRejectedValue(new Error('server down'));
    publishFakeRpc({ 'LLMService.new_session': newSession });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      const p = mountPanel({
        messages: [{ role: 'user', content: 'existing' }],
      });
      await settle(p);
      p.shadowRoot.querySelector('.new-session-button').click();
      await settle(p);
      // Messages intact — the failure didn't trigger
      // any local mutation.
      expect(p.messages).toHaveLength(1);
      // Error logged.
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('clicking while streaming is guarded at the method level', async () => {
    // Double-check the method guard, not just the
    // disabled attribute. Someone could call _onNewSession
    // programmatically (or a future test could mock a
    // different trigger) — the method must refuse to
    // proceed regardless.
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    const newSession = vi
      .fn()
      .mockResolvedValue({ session_id: 'sess_new' });
    publishFakeRpc({
      'LLMService.chat_streaming': started,
      'LLMService.new_session': newSession,
    });
    const p = mountPanel();
    await settle(p);
    p._input = 'hi';
    await p._send();
    await settle(p);
    // Now try to start a new session — should be a no-op.
    await p._onNewSession();
    expect(newSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// History browser integration
// ---------------------------------------------------------------------------

describe('ChatPanel history browser', () => {
  it('renders the History button', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.history-button');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('History');
  });

  it('History button is disabled when RPC is disconnected', async () => {
    const p = mountPanel();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.history-button');
    expect(btn.disabled).toBe(true);
  });

  it('History button stays enabled during streaming', async () => {
    // Opening the browser is read-only; browsing past
    // sessions while waiting for a stream is allowed.
    // See chat-panel.js _onOpenHistory comment.
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = 'hi';
    await p._send();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.history-button');
    expect(btn.disabled).toBe(false);
  });

  it('opens the modal on History button click', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
    });
    const p = mountPanel();
    await settle(p);
    // Modal starts closed — ac-history-browser has no
    // .backdrop rendered.
    const browser = p.shadowRoot.querySelector(
      'ac-history-browser',
    );
    expect(browser).toBeTruthy();
    expect(browser.open).toBe(false);
    p.shadowRoot.querySelector('.history-button').click();
    await settle(p);
    expect(browser.open).toBe(true);
  });

  it('closes the modal on close event from browser', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
    });
    const p = mountPanel();
    await settle(p);
    p._historyOpen = true;
    await settle(p);
    const browser = p.shadowRoot.querySelector(
      'ac-history-browser',
    );
    browser.dispatchEvent(
      new CustomEvent('close', {
        bubbles: true,
        composed: true,
      }),
    );
    await settle(p);
    expect(p._historyOpen).toBe(false);
  });

  it('closes the modal on session-loaded event', async () => {
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
    });
    const p = mountPanel();
    await settle(p);
    p._historyOpen = true;
    await settle(p);
    const browser = p.shadowRoot.querySelector(
      'ac-history-browser',
    );
    browser.dispatchEvent(
      new CustomEvent('session-loaded', {
        detail: { session_id: 's1' },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(p);
    expect(p._historyOpen).toBe(false);
  });

  it('session-loaded event does not crash without session-changed follow-up', async () => {
    // In normal operation, session-loaded is followed by
    // the server's sessionChanged broadcast which replaces
    // the message list. If the broadcast doesn't arrive
    // (test scenario, or mocked backend), the chat panel
    // shouldn't crash — it just stays with the old
    // messages until the next update.
    publishFakeRpc({
      'LLMService.history_list_sessions': vi
        .fn()
        .mockResolvedValue([]),
    });
    const p = mountPanel({
      messages: [{ role: 'user', content: 'old message' }],
    });
    await settle(p);
    p._historyOpen = true;
    await settle(p);
    const browser = p.shadowRoot.querySelector(
      'ac-history-browser',
    );
    browser.dispatchEvent(
      new CustomEvent('session-loaded', {
        detail: { session_id: 's1' },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(p);
    // Modal closed; messages unchanged (until broadcast
    // arrives).
    expect(p._historyOpen).toBe(false);
    expect(p.messages).toHaveLength(1);
  });

  it('can open modal while streaming', async () => {
    // _onOpenHistory has no streaming gate — opening the
    // browser is read-only and allowed mid-stream.
    const started = vi
      .fn()
      .mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = 'hi';
    await p._send();
    await settle(p);
    p._onOpenHistory();
    await settle(p);
    expect(p._historyOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Session changes
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
});

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

describe('ChatPanel input handling', () => {
  it('Enter sends, Shift+Enter does not', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'hi';
    ta.dispatchEvent(new Event('input'));
    await p.updateComplete;
    // Shift+Enter — does not send.
    ta.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
      }),
    );
    await p.updateComplete;
    expect(started).not.toHaveBeenCalled();
    // Plain Enter — sends.
    ta.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter' }),
    );
    await settle(p);
    expect(started).toHaveBeenCalledOnce();
  });

  it('Enter during IME composition does not send', async () => {
    // IME users (Japanese, Chinese, etc.) press Enter to
    // commit a composition. The isComposing flag on
    // KeyboardEvent distinguishes this from a send-Enter.
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'hi';
    ta.dispatchEvent(new Event('input'));
    await p.updateComplete;
    ta.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
      }),
    );
    await p.updateComplete;
    expect(started).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Input history
// ---------------------------------------------------------------------------

describe('ChatPanel input history — recording', () => {
  it('records message on send', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = 'my first prompt';
    await p._send();
    await settle(p);
    const history = p.shadowRoot.querySelector('ac-input-history');
    expect(history._entries).toEqual(['my first prompt']);
  });

  it('accumulates multiple sends', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = 'first';
    await p._send();
    await settle(p);
    // Reset streaming state so the next send proceeds.
    // _send gates on _streaming; in a real flow the
    // stream-complete event clears it.
    p._streaming = false;
    p._currentRequestId = null;
    p._input = 'second';
    await p._send();
    await settle(p);
    const history = p.shadowRoot.querySelector('ac-input-history');
    expect(history._entries).toEqual(['first', 'second']);
  });

  it('does not record when send is rejected (empty input)', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._input = '';
    await p._send();
    await settle(p);
    const history = p.shadowRoot.querySelector('ac-input-history');
    expect(history._entries).toEqual([]);
  });

  it('records even when the RPC call rejects', async () => {
    // Record-before-RPC is deliberate — a user whose
    // network ate their prompt still wants up-arrow
    // recall to bring it back. The failure toast /
    // error message in the assistant slot communicates
    // the failure; history recall is about recovering
    // text, not tracking delivery.
    const started = vi
      .fn()
      .mockRejectedValue(new Error('network boom'));
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      const p = mountPanel();
      await settle(p);
      p._input = 'will fail';
      await p._send();
      await settle(p);
      const history = p.shadowRoot.querySelector(
        'ac-input-history',
      );
      expect(history._entries).toEqual(['will fail']);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('ChatPanel input history — session seeding', () => {
  it('seeds history from user messages in session-changed event', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    pushEvent('session-changed', {
      messages: [
        { role: 'user', content: 'first user msg' },
        { role: 'assistant', content: 'assistant reply' },
        { role: 'user', content: 'second user msg' },
      ],
    });
    await settle(p);
    const history = p.shadowRoot.querySelector('ac-input-history');
    expect(history._entries).toEqual([
      'first user msg',
      'second user msg',
    ]);
  });

  it('skips system-event messages when seeding', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    pushEvent('session-changed', {
      messages: [
        {
          role: 'user',
          content: 'Committed abc1234',
          system_event: true,
        },
        { role: 'user', content: 'real prompt' },
      ],
    });
    await settle(p);
    const history = p.shadowRoot.querySelector('ac-input-history');
    expect(history._entries).toEqual(['real prompt']);
  });

  it('handles multimodal user messages (extracts text blocks)', async () => {
    // Session store reconstructs images as multimodal
    // content arrays. Our seeding path should extract the
    // text and drop the image blocks.
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    pushEvent('session-changed', {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'please look at this' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,...' },
            },
          ],
        },
      ],
    });
    await settle(p);
    const history = p.shadowRoot.querySelector('ac-input-history');
    expect(history._entries).toEqual(['please look at this']);
  });

  it('empty session (new session) produces no seed entries', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    // Seed some entries, then start a fresh session.
    const history = p.shadowRoot.querySelector('ac-input-history');
    history.addEntry('existing entry');
    pushEvent('session-changed', {
      session_id: 'sess_new',
      messages: [],
    });
    await settle(p);
    // Existing entries are preserved — only new seed
    // entries would be added. Empty session adds none.
    expect(history._entries).toEqual(['existing entry']);
  });
});

describe('ChatPanel input history — open/close interactions', () => {
  it('up-arrow at cursor 0 opens the overlay', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const history = p.shadowRoot.querySelector('ac-input-history');
    history.addEntry('prior message');
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = '';
    ta.setSelectionRange(0, 0);
    ta.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(history.isOpen).toBe(true);
  });

  it('up-arrow elsewhere in textarea does not open', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const history = p.shadowRoot.querySelector('ac-input-history');
    history.addEntry('prior');
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'some typed text';
    ta.setSelectionRange(5, 5);
    ta.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(history.isOpen).toBe(false);
  });

  it('up-arrow with empty history does not open', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const history = p.shadowRoot.querySelector('ac-input-history');
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.setSelectionRange(0, 0);
    ta.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(history.isOpen).toBe(false);
  });

  it('saves current input when opening', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const history = p.shadowRoot.querySelector('ac-input-history');
    history.addEntry('prior');
    p._input = 'draft message';
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'draft message';
    ta.setSelectionRange(0, 0);
    ta.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(history._savedInput).toBe('draft message');
  });
});

describe('ChatPanel input history — event handling', () => {
  it('selecting an entry replaces textarea content', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const history = p.shadowRoot.querySelector('ac-input-history');
    history.addEntry('recalled prompt');
    history.show('');
    await settle(p);
    // Simulate Enter to select the newest entry.
    history.handleKey(
      new KeyboardEvent('keydown', { key: 'Enter' }),
    );
    await settle(p);
    expect(p._input).toBe('recalled prompt');
  });

  it('cancelling restores the saved input', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const history = p.shadowRoot.querySelector('ac-input-history');
    history.addEntry('prior');
    history.show('my draft');
    await settle(p);
    history.handleKey(
      new KeyboardEvent('keydown', { key: 'Escape' }),
    );
    await settle(p);
    expect(p._input).toBe('my draft');
  });

  it('Enter in overlay does not send message', async () => {
    // While the overlay is open, Enter selects (not sends).
    // Prevents accidentally sending what the user was just
    // recalling.
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    const history = p.shadowRoot.querySelector('ac-input-history');
    history.addEntry('prior');
    history.show('');
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    // Dispatch Enter on the textarea (simulating focus
    // still being there). The chat panel's key handler
    // must delegate to the overlay.
    ta.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      }),
    );
    await settle(p);
    // Overlay closed via select, but no send fired.
    expect(started).not.toHaveBeenCalled();
    expect(history.isOpen).toBe(false);
    // Selected text is now in the input.
    expect(p._input).toBe('prior');
  });
});

// ---------------------------------------------------------------------------
// Snippet drawer
// ---------------------------------------------------------------------------

describe('ChatPanel snippet drawer', () => {
  it('renders the Snippets toggle button', async () => {
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([]),
    });
    const p = mountPanel();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.snippet-drawer-button');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Snippets');
  });

  it('drawer is closed by default', async () => {
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([]),
    });
    const p = mountPanel();
    await settle(p);
    expect(p._snippetDrawerOpen).toBe(false);
    const drawer = p.shadowRoot.querySelector('.snippet-drawer');
    expect(drawer).toBeNull();
  });

  it('clicking the toggle opens the drawer', async () => {
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([
        { icon: '🔍', tooltip: 'Search', message: 'find this' },
      ]),
    });
    const p = mountPanel();
    await settle(p);
    p.shadowRoot.querySelector('.snippet-drawer-button').click();
    await settle(p);
    expect(p._snippetDrawerOpen).toBe(true);
    const drawer = p.shadowRoot.querySelector('.snippet-drawer');
    expect(drawer).toBeTruthy();
  });

  it('clicking again closes the drawer', async () => {
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([]),
    });
    const p = mountPanel();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.snippet-drawer-button');
    btn.click();
    await settle(p);
    btn.click();
    await settle(p);
    expect(p._snippetDrawerOpen).toBe(false);
    expect(
      p.shadowRoot.querySelector('.snippet-drawer'),
    ).toBeNull();
  });

  it('toggle does not require RPC to be connected', async () => {
    // The drawer can be opened even before snippets load —
    // it just shows an empty-state placeholder. This lets
    // the user pre-open on page load while the WebSocket
    // is still handshaking.
    const p = mountPanel();
    await settle(p);
    p.shadowRoot.querySelector('.snippet-drawer-button').click();
    await settle(p);
    expect(p._snippetDrawerOpen).toBe(true);
    // Empty-state placeholder appears.
    const empty = p.shadowRoot.querySelector('.snippet-empty');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No snippets');
  });

  it('active class reflects open state', async () => {
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([]),
    });
    const p = mountPanel();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.snippet-drawer-button');
    expect(btn.classList.contains('active')).toBe(false);
    btn.click();
    await settle(p);
    expect(btn.classList.contains('active')).toBe(true);
  });

  it('loads snippets on RPC ready', async () => {
    const getSnippets = vi.fn().mockResolvedValue([
      { icon: '📝', tooltip: 'Note', message: 'take a note' },
    ]);
    publishFakeRpc({ 'LLMService.get_snippets': getSnippets });
    const p = mountPanel();
    await settle(p);
    expect(getSnippets).toHaveBeenCalledOnce();
    expect(p._snippets).toHaveLength(1);
    expect(p._snippets[0].message).toBe('take a note');
  });

  it('renders one button per snippet', async () => {
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([
        { icon: '🔍', tooltip: 'one', message: 'a' },
        { icon: '📝', tooltip: 'two', message: 'b' },
        { icon: '🏁', tooltip: 'three', message: 'c' },
      ]),
    });
    const p = mountPanel();
    await settle(p);
    p._snippetDrawerOpen = true;
    await settle(p);
    const buttons = p.shadowRoot.querySelectorAll('.snippet-button');
    expect(buttons).toHaveLength(3);
  });

  it('empty snippet list shows placeholder when drawer opens', async () => {
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([]),
    });
    const p = mountPanel();
    await settle(p);
    p._snippetDrawerOpen = true;
    await settle(p);
    const empty = p.shadowRoot.querySelector('.snippet-empty');
    expect(empty).toBeTruthy();
  });

  it('RPC error preserves existing snippets', async () => {
    // First load succeeds. Second load (via mode-changed)
    // fails. The old snippets stay — an in-flight
    // refresh failing shouldn't wipe a good list.
    const getSnippets = vi
      .fn()
      .mockResolvedValueOnce([
        { icon: '✅', tooltip: 'ok', message: 'x' },
      ])
      .mockRejectedValueOnce(new Error('boom'));
    publishFakeRpc({ 'LLMService.get_snippets': getSnippets });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      const p = mountPanel();
      await settle(p);
      expect(p._snippets).toHaveLength(1);
      // Trigger a reload via mode-changed.
      window.dispatchEvent(new CustomEvent('mode-changed'));
      await settle(p);
      // Snippets preserved.
      expect(p._snippets).toHaveLength(1);
      expect(p._snippets[0].message).toBe('x');
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('reloads snippets on mode-changed event', async () => {
    const getSnippets = vi.fn().mockResolvedValue([]);
    publishFakeRpc({ 'LLMService.get_snippets': getSnippets });
    const p = mountPanel();
    await settle(p);
    expect(getSnippets).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new CustomEvent('mode-changed'));
    await settle(p);
    expect(getSnippets).toHaveBeenCalledTimes(2);
  });

  it('reloads snippets on review-started event', async () => {
    const getSnippets = vi.fn().mockResolvedValue([]);
    publishFakeRpc({ 'LLMService.get_snippets': getSnippets });
    const p = mountPanel();
    await settle(p);
    window.dispatchEvent(new CustomEvent('review-started'));
    await settle(p);
    expect(getSnippets).toHaveBeenCalledTimes(2);
  });

  it('reloads snippets on review-ended event', async () => {
    const getSnippets = vi.fn().mockResolvedValue([]);
    publishFakeRpc({ 'LLMService.get_snippets': getSnippets });
    const p = mountPanel();
    await settle(p);
    window.dispatchEvent(new CustomEvent('review-ended'));
    await settle(p);
    expect(getSnippets).toHaveBeenCalledTimes(2);
  });

  it('does not reload on session-changed event', async () => {
    // Snippets are repo-global, not session-scoped. Session
    // changes shouldn't trigger a refetch.
    const getSnippets = vi.fn().mockResolvedValue([]);
    publishFakeRpc({ 'LLMService.get_snippets': getSnippets });
    const p = mountPanel();
    await settle(p);
    expect(getSnippets).toHaveBeenCalledTimes(1);
    window.dispatchEvent(
      new CustomEvent('session-changed', {
        detail: { session_id: 's1', messages: [] },
      }),
    );
    await settle(p);
    expect(getSnippets).toHaveBeenCalledTimes(1);
  });
});

describe('ChatPanel snippet insertion', () => {
  async function setupWithSnippets() {
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([
        { icon: '🔍', tooltip: 'Check', message: 'please check' },
        { icon: '📝', tooltip: 'Note', message: 'note that' },
      ]),
    });
    const p = mountPanel();
    await settle(p);
    p._snippetDrawerOpen = true;
    await settle(p);
    return p;
  }

  it('clicking a snippet inserts its message into empty input', async () => {
    const p = await setupWithSnippets();
    const btn = p.shadowRoot.querySelectorAll('.snippet-button')[0];
    btn.click();
    await settle(p);
    expect(p._input).toBe('please check');
  });

  it('inserts at cursor position when textarea has focus', async () => {
    const p = await setupWithSnippets();
    const ta = p.shadowRoot.querySelector('.input-textarea');
    // Type "hello world", place cursor between words.
    ta.value = 'hello world';
    ta.dispatchEvent(new Event('input'));
    await settle(p);
    ta.setSelectionRange(6, 6); // between "hello " and "world"
    const btn = p.shadowRoot.querySelectorAll('.snippet-button')[0];
    btn.click();
    await settle(p);
    expect(p._input).toBe('hello please checkworld');
  });

  it('replaces selection when one exists', async () => {
    const p = await setupWithSnippets();
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'replace me please';
    ta.dispatchEvent(new Event('input'));
    await settle(p);
    ta.setSelectionRange(8, 10); // select "me"
    const btn = p.shadowRoot.querySelectorAll('.snippet-button')[0];
    btn.click();
    await settle(p);
    expect(p._input).toBe('replace please check please');
  });

  it('positions cursor after the inserted text', async () => {
    const p = await setupWithSnippets();
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'ab';
    ta.dispatchEvent(new Event('input'));
    await settle(p);
    ta.setSelectionRange(1, 1); // between 'a' and 'b'
    const btn = p.shadowRoot.querySelectorAll('.snippet-button')[0];
    btn.click();
    await settle(p);
    // Inserted "please check" — cursor should be at
    // position 1 ("a") + 12 (insert length) = 13.
    expect(ta.selectionStart).toBe(13);
    expect(ta.selectionEnd).toBe(13);
  });

  it('focuses the textarea after insertion', async () => {
    const p = await setupWithSnippets();
    const ta = p.shadowRoot.querySelector('.input-textarea');
    // Give focus to the snippet button so textarea isn't focused.
    const btn = p.shadowRoot.querySelectorAll('.snippet-button')[0];
    btn.focus();
    btn.click();
    await settle(p);
    // After insertion, focus should be on the textarea.
    expect(p.shadowRoot.activeElement).toBe(ta);
  });

  it('multiple clicks accumulate', async () => {
    const p = await setupWithSnippets();
    const buttons = p.shadowRoot.querySelectorAll('.snippet-button');
    buttons[0].click();
    await settle(p);
    buttons[1].click();
    await settle(p);
    expect(p._input).toBe('please checknote that');
  });

  it('ignores snippets with empty message', async () => {
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([
        { icon: '🔍', tooltip: 'Empty', message: '' },
      ]),
    });
    const p = mountPanel();
    await settle(p);
    p._snippetDrawerOpen = true;
    await settle(p);
    const btn = p.shadowRoot.querySelector('.snippet-button');
    btn.click();
    await settle(p);
    expect(p._input).toBe('');
  });
});

describe('ChatPanel snippet drawer persistence', () => {
  it('loads drawer state from localStorage', async () => {
    // Seed localStorage before mounting — simulates reload.
    _saveDrawerOpen(true);
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([]),
    });
    const p = mountPanel();
    await settle(p);
    expect(p._snippetDrawerOpen).toBe(true);
  });

  it('persists state when toggling open', async () => {
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([]),
    });
    const p = mountPanel();
    await settle(p);
    p.shadowRoot.querySelector('.snippet-drawer-button').click();
    await settle(p);
    expect(_loadDrawerOpen()).toBe(true);
  });

  it('persists state when toggling closed', async () => {
    _saveDrawerOpen(true);
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([]),
    });
    const p = mountPanel();
    await settle(p);
    p.shadowRoot.querySelector('.snippet-drawer-button').click();
    await settle(p);
    expect(_loadDrawerOpen()).toBe(false);
  });

  it('defaults to closed when localStorage has no value', () => {
    // Pre-check the loader returns false when nothing is
    // stored (afterEach clears the key before each test).
    expect(_loadDrawerOpen()).toBe(false);
  });

  it('defaults to closed for unrecognised localStorage value', () => {
    // Defensive — a value that isn't 'true' should parse as
    // false rather than anything weird.
    localStorage.setItem(_DRAWER_STORAGE_KEY, 'maybe');
    expect(_loadDrawerOpen()).toBe(false);
  });
});

describe('ChatPanel snippet drawer close-on-send', () => {
  it('auto-closes drawer when a message is sent', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([]),
      'LLMService.chat_streaming': started,
    });
    const p = mountPanel();
    await settle(p);
    // Open drawer, type a message, send.
    p._snippetDrawerOpen = true;
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'hello';
    ta.dispatchEvent(new Event('input'));
    await settle(p);
    p.shadowRoot.querySelector('.send-button').click();
    await settle(p);
    expect(p._snippetDrawerOpen).toBe(false);
  });

  it('persists closed state after auto-close', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([]),
      'LLMService.chat_streaming': started,
    });
    _saveDrawerOpen(true);
    const p = mountPanel();
    await settle(p);
    p._input = 'hello';
    await p._send();
    await settle(p);
    expect(_loadDrawerOpen()).toBe(false);
  });

  it('does not touch drawer state if it was already closed', async () => {
    // Defensive — a send when the drawer is closed shouldn't
    // rewrite localStorage unnecessarily.
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([]),
      'LLMService.chat_streaming': started,
    });
    const p = mountPanel();
    await settle(p);
    // Remove the storage key — pre-load-open is unset, and
    // we want to verify no write happens on send.
    localStorage.removeItem(_DRAWER_STORAGE_KEY);
    p._input = 'hello';
    await p._send();
    await settle(p);
    // Still no entry in localStorage — the send path
    // only writes when it actually toggled the state.
    expect(localStorage.getItem(_DRAWER_STORAGE_KEY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Event listener cleanup
// ---------------------------------------------------------------------------

describe('ChatPanel cleanup', () => {
  it('removes event listeners on disconnect', async () => {
    const p = mountPanel();
    await settle(p);
    p.remove();
    // After disconnect, stream-chunk events must not alter
    // state. _streamingContent should remain empty.
    pushEvent('stream-chunk', {
      requestId: 'any',
      content: 'should be ignored',
    });
    // No rAF will fire on a disconnected component either,
    // but we check the state field directly.
    expect(p._streamingContent).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Image paste
// ---------------------------------------------------------------------------

describe('ChatPanel image paste', () => {
  /**
   * Build a fake ClipboardEvent with one or more image
   * file items. The real ClipboardEvent constructor
   * doesn't accept a clipboardData override, so we
   * dispatch a CustomEvent and rely on the handler
   * reading `event.clipboardData`. Lit's @paste binding
   * attaches the handler to the element's addEventListener
   * so a plain `new Event('paste')` with a custom
   * property works fine.
   */
  function pasteEvent(items) {
    const ev = new Event('paste', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(ev, 'clipboardData', {
      value: { items },
      writable: false,
    });
    return ev;
  }

  function fakeImageItem(mime, content = 'image-bytes') {
    return {
      kind: 'file',
      type: mime,
      getAsFile() {
        return new Blob([content], { type: mime });
      },
    };
  }

  it('paste of an image adds it to pending images', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.dispatchEvent(
      pasteEvent([fakeImageItem('image/png')]),
    );
    // Wait for the async FileReader + state update.
    await settle(p);
    expect(p._pendingImages).toHaveLength(1);
    expect(p._pendingImages[0]).toMatch(/^data:image\/png;/);
  });

  it('paste of multiple images adds all of them', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.dispatchEvent(
      pasteEvent([
        fakeImageItem('image/png', 'first'),
        fakeImageItem('image/jpeg', 'second'),
      ]),
    );
    await settle(p);
    expect(p._pendingImages).toHaveLength(2);
  });

  it('text paste falls through (does not call preventDefault)', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    const ev = pasteEvent([
      { kind: 'string', type: 'text/plain' },
    ]);
    const preventSpy = vi.spyOn(ev, 'preventDefault');
    ta.dispatchEvent(ev);
    await settle(p);
    expect(preventSpy).not.toHaveBeenCalled();
    expect(p._pendingImages).toEqual([]);
  });

  it('image paste calls preventDefault', async () => {
    // Consuming the paste prevents the browser from
    // additionally inserting `[object Object]` into the
    // textarea.
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    const ev = pasteEvent([fakeImageItem('image/png')]);
    const preventSpy = vi.spyOn(ev, 'preventDefault');
    ta.dispatchEvent(ev);
    await settle(p);
    expect(preventSpy).toHaveBeenCalled();
  });

  it('dedup: same image pasted twice only appears once', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.dispatchEvent(
      pasteEvent([fakeImageItem('image/png', 'SAME')]),
    );
    await settle(p);
    ta.dispatchEvent(
      pasteEvent([fakeImageItem('image/png', 'SAME')]),
    );
    await settle(p);
    expect(p._pendingImages).toHaveLength(1);
  });

  it('emits a warning toast when over the count limit', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      // Paste 6 distinct images — limit is 5.
      for (let i = 0; i < 6; i += 1) {
        ta.dispatchEvent(
          pasteEvent([
            fakeImageItem('image/png', `img-${i}`),
          ]),
        );
        await settle(p);
      }
      expect(p._pendingImages).toHaveLength(5);
      const warnings = toastListener.mock.calls
        .map((c) => c[0].detail)
        .filter((d) => d.type === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toMatch(/Maximum.*5/);
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });
});

// ---------------------------------------------------------------------------
// Pending images rendering
// ---------------------------------------------------------------------------

describe('ChatPanel pending images', () => {
  it('renders thumbnail strip when non-empty', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._pendingImages = [
      'data:image/png;base64,AAA',
      'data:image/jpeg;base64,BBB',
    ];
    await settle(p);
    const thumbs = p.shadowRoot.querySelectorAll('.pending-image');
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0].src).toContain('data:image/png');
    expect(thumbs[1].src).toContain('data:image/jpeg');
  });

  it('does not render strip when empty', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.pending-images'),
    ).toBeNull();
  });

  it('remove button removes the image', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._pendingImages = [
      'data:image/png;base64,A',
      'data:image/png;base64,B',
      'data:image/png;base64,C',
    ];
    await settle(p);
    const removeButtons = p.shadowRoot.querySelectorAll(
      '.pending-image-remove',
    );
    removeButtons[1].click();
    await settle(p);
    expect(p._pendingImages).toEqual([
      'data:image/png;base64,A',
      'data:image/png;base64,C',
    ]);
  });

  it('clicking thumbnail opens lightbox', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._pendingImages = ['data:image/png;base64,XYZ'];
    await settle(p);
    p.shadowRoot.querySelector('.pending-image').click();
    await settle(p);
    expect(p._lightboxImage).toBe('data:image/png;base64,XYZ');
  });
});

// ---------------------------------------------------------------------------
// Send with images
// ---------------------------------------------------------------------------

describe('ChatPanel send with images', () => {
  it('passes pending images to chat_streaming RPC', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = 'look at this';
    p._pendingImages = ['data:image/png;base64,PIC'];
    await p._send();
    await settle(p);
    // Positional args: requestId, message, files, images.
    const [, message, files, images] = started.mock.calls[0];
    expect(message).toBe('look at this');
    expect(files).toEqual([]);
    expect(images).toEqual(['data:image/png;base64,PIC']);
  });

  it('clears pending images after send', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = 'hi';
    p._pendingImages = ['data:image/png;base64,A'];
    await p._send();
    await settle(p);
    expect(p._pendingImages).toEqual([]);
  });

  it('optimistic user message carries images', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = 'see';
    p._pendingImages = ['data:image/png;base64,A'];
    await p._send();
    await settle(p);
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].role).toBe('user');
    expect(p.messages[0].images).toEqual([
      'data:image/png;base64,A',
    ]);
  });

  it('image-only send is allowed (empty text + image)', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = '';
    p._pendingImages = ['data:image/png;base64,A'];
    await p._send();
    await settle(p);
    expect(started).toHaveBeenCalledOnce();
    const [, message, , images] = started.mock.calls[0];
    expect(message).toBe('');
    expect(images).toEqual(['data:image/png;base64,A']);
  });

  it('send button enabled with images even when text is empty', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    // No text, no images — button disabled.
    let btn = p.shadowRoot.querySelector('.send-button');
    expect(btn.disabled).toBe(true);
    // Add an image — button enables.
    p._pendingImages = ['data:image/png;base64,A'];
    await settle(p);
    btn = p.shadowRoot.querySelector('.send-button');
    expect(btn.disabled).toBe(false);
  });

  it('image is not added to input history (only text)', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    // Image-only send — text is empty.
    p._input = '';
    p._pendingImages = ['data:image/png;base64,A'];
    await p._send();
    await settle(p);
    const history = p.shadowRoot.querySelector('ac-input-history');
    expect(history._entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Message image rendering
// ---------------------------------------------------------------------------

describe('ChatPanel message images', () => {
  it('renders thumbnails in user messages with images', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'user',
          content: 'see this',
          images: [
            'data:image/png;base64,A',
            'data:image/png;base64,B',
          ],
        },
      ],
    });
    await settle(p);
    const thumbs = p.shadowRoot.querySelectorAll('.message-image');
    expect(thumbs).toHaveLength(2);
  });

  it('does not render image section when images is empty', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'plain text message' },
      ],
    });
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.message-images'),
    ).toBeNull();
  });

  it('clicking a message thumbnail opens the lightbox', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'user',
          content: '',
          images: ['data:image/png;base64,XYZ'],
        },
      ],
    });
    await settle(p);
    p.shadowRoot.querySelector('.message-image').click();
    await settle(p);
    expect(p._lightboxImage).toBe('data:image/png;base64,XYZ');
  });

  it('re-attach button adds image to pending and emits toast', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'user',
          content: 'earlier',
          images: ['data:image/png;base64,REATTACH'],
        },
      ],
    });
    await settle(p);
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      p.shadowRoot
        .querySelector('.message-image-reattach')
        .click();
      await settle(p);
      expect(p._pendingImages).toEqual([
        'data:image/png;base64,REATTACH',
      ]);
      const successes = toastListener.mock.calls
        .map((c) => c[0].detail)
        .filter((d) => d.type === 'success');
      expect(successes.length).toBe(1);
      expect(successes[0].message).toContain('attached');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });

  it('re-attach of already-attached image emits neutral toast', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'user',
          content: '',
          images: ['data:image/png;base64,SAME'],
        },
      ],
    });
    await settle(p);
    // Pre-attach to pending.
    p._pendingImages = ['data:image/png;base64,SAME'];
    await settle(p);
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      p.shadowRoot
        .querySelector('.message-image-reattach')
        .click();
      await settle(p);
      // No duplicate — still one image.
      expect(p._pendingImages).toHaveLength(1);
      const infos = toastListener.mock.calls
        .map((c) => c[0].detail)
        .filter((d) => d.type === 'info');
      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('already attached');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });

  it('re-attach click does not open the lightbox', async () => {
    // The image's own click handler opens the lightbox;
    // the button stopPropagation prevents that. Pinned
    // because without stopPropagation, users would see
    // the lightbox flash open every time they clicked
    // re-attach.
    const p = mountPanel({
      messages: [
        {
          role: 'user',
          content: '',
          images: ['data:image/png;base64,X'],
        },
      ],
    });
    await settle(p);
    p.shadowRoot
      .querySelector('.message-image-reattach')
      .click();
    await settle(p);
    expect(p._lightboxImage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lightbox
// ---------------------------------------------------------------------------

describe('ChatPanel lightbox', () => {
  it('renders when _lightboxImage is set', async () => {
    const p = mountPanel();
    await settle(p);
    p._lightboxImage = 'data:image/png;base64,X';
    await settle(p);
    expect(
      p.shadowRoot.querySelector('.lightbox-backdrop'),
    ).toBeTruthy();
    expect(
      p.shadowRoot.querySelector('.lightbox-image').src,
    ).toContain('base64,X');
  });

  it('backdrop click closes the lightbox', async () => {
    const p = mountPanel();
    await settle(p);
    p._lightboxImage = 'data:image/png;base64,X';
    await settle(p);
    const backdrop = p.shadowRoot.querySelector(
      '.lightbox-backdrop',
    );
    backdrop.click();
    await settle(p);
    expect(p._lightboxImage).toBeNull();
  });

  it('click on content does not close lightbox', async () => {
    const p = mountPanel();
    await settle(p);
    p._lightboxImage = 'data:image/png;base64,X';
    await settle(p);
    p.shadowRoot.querySelector('.lightbox-content').click();
    await settle(p);
    expect(p._lightboxImage).toBe('data:image/png;base64,X');
  });

  it('Escape closes the lightbox', async () => {
    const p = mountPanel();
    await settle(p);
    p._lightboxImage = 'data:image/png;base64,X';
    await settle(p);
    const backdrop = p.shadowRoot.querySelector(
      '.lightbox-backdrop',
    );
    backdrop.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(p._lightboxImage).toBeNull();
  });

  it('Re-attach button attaches and closes', async () => {
    const p = mountPanel();
    await settle(p);
    p._lightboxImage = 'data:image/png;base64,X';
    await settle(p);
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      // Find the re-attach button by its text/title.
      const buttons = p.shadowRoot.querySelectorAll(
        '.lightbox-button',
      );
      const reattach = Array.from(buttons).find((b) =>
        b.textContent.includes('Re-attach'),
      );
      reattach.click();
      await settle(p);
      expect(p._pendingImages).toEqual([
        'data:image/png;base64,X',
      ]);
      // Lightbox closed after re-attach.
      expect(p._lightboxImage).toBeNull();
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });

  it('Close button closes', async () => {
    const p = mountPanel();
    await settle(p);
    p._lightboxImage = 'data:image/png;base64,X';
    await settle(p);
    const buttons = p.shadowRoot.querySelectorAll(
      '.lightbox-button',
    );
    const close = Array.from(buttons).find((b) =>
      b.textContent.includes('Close'),
    );
    close.click();
    await settle(p);
    expect(p._lightboxImage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multimodal message normalisation on session-changed
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
// Message action buttons
// ---------------------------------------------------------------------------

describe('ChatPanel message action buttons', () => {
  it('renders two toolbars (top and bottom) on each message', async () => {
    // Both ends because long messages mean the user might
    // have scrolled either end into view without the
    // other. Duplicating toolbars saves them from
    // scrolling to reach the action.
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    });
    await settle(p);
    // Two cards × two toolbars = four toolbar elements.
    const toolbars = p.shadowRoot.querySelectorAll(
      '.message-toolbar',
    );
    expect(toolbars.length).toBe(4);
    // Top and bottom classes applied correctly.
    const tops = p.shadowRoot.querySelectorAll(
      '.message-toolbar.top',
    );
    const bottoms = p.shadowRoot.querySelectorAll(
      '.message-toolbar.bottom',
    );
    expect(tops.length).toBe(2);
    expect(bottoms.length).toBe(2);
  });

  it('each toolbar has copy and paste buttons', async () => {
    const p = mountPanel({
      messages: [{ role: 'user', content: 'hi' }],
    });
    await settle(p);
    const toolbar = p.shadowRoot.querySelector(
      '.message-toolbar.top',
    );
    const buttons = toolbar.querySelectorAll(
      '.message-action-button',
    );
    expect(buttons.length).toBe(2);
    // Distinguished by aria-label so screen readers
    // can identify them.
    const labels = Array.from(buttons).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels[0]).toMatch(/copy/i);
    expect(labels[1]).toMatch(/insert/i);
  });

  it('toolbar is NOT rendered on streaming message', async () => {
    // The streaming card is live; copy/paste on partial
    // content is meaningless. The render path for the
    // streaming card bypasses _renderMessage, so the
    // toolbar naturally doesn't appear there.
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = 'hi';
    await p._send();
    const reqId = started.mock.calls[0][0];
    pushEvent('stream-chunk', {
      requestId: reqId,
      content: 'partial response',
    });
    await settle(p);
    const streamingCard = p.shadowRoot.querySelector(
      '.message-card.streaming',
    );
    expect(streamingCard).toBeTruthy();
    // No toolbar on the streaming card.
    expect(
      streamingCard.querySelector('.message-toolbar'),
    ).toBeNull();
    // But the settled user message card does have one.
    const userCard = p.shadowRoot.querySelector(
      '.message-card.role-user',
    );
    expect(
      userCard.querySelector('.message-toolbar'),
    ).toBeTruthy();
  });

  it('system event messages get toolbars too', async () => {
    // A user might want to copy a commit SHA or error
    // message from a system event — no reason to exclude
    // them.
    const p = mountPanel({
      messages: [
        {
          role: 'user',
          content: '**Committed** abc1234',
          system_event: true,
        },
      ],
    });
    await settle(p);
    const card = p.shadowRoot.querySelector(
      '.message-card.role-system',
    );
    expect(card.querySelector('.message-toolbar')).toBeTruthy();
  });
});

describe('ChatPanel copy action', () => {
  /** Share helper installation with the suite above. */
  function installFakeClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    return {
      writeText,
      restore() {
        if (originalClipboard === undefined) {
          delete navigator.clipboard;
        } else {
          Object.defineProperty(navigator, 'clipboard', {
            value: originalClipboard,
            configurable: true,
          });
        }
      },
    };
  }

  it('copies raw string content, not rendered HTML', async () => {
    // Assistant markdown should be copied as markdown
    // source, not as rendered HTML. A user pasting into
    // another editor wants the `**bold**`, not a fully
    // formatted `<strong>` run.
    const { writeText, restore } = installFakeClipboard();
    try {
      const p = mountPanel({
        messages: [
          { role: 'assistant', content: 'use **bold** here' },
        ],
      });
      await settle(p);
      const copyBtn = p.shadowRoot
        .querySelector('.message-toolbar.top')
        .querySelectorAll('.message-action-button')[0];
      copyBtn.click();
      await settle(p);
      expect(writeText).toHaveBeenCalledOnce();
      expect(writeText).toHaveBeenCalledWith('use **bold** here');
    } finally {
      restore();
    }
  });

  it('emits success toast after copy', async () => {
    const { restore } = installFakeClipboard();
    try {
      const p = mountPanel({
        messages: [{ role: 'user', content: 'hi' }],
      });
      await settle(p);
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        p.shadowRoot
          .querySelector('.message-toolbar.top')
          .querySelectorAll('.message-action-button')[0]
          .click();
        await settle(p);
        const detail = toastListener.mock.calls.at(-1)[0].detail;
        expect(detail.type).toBe('success');
        expect(detail.message).toMatch(/copied/i);
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    } finally {
      restore();
    }
  });

  it('copies extracted text from multimodal content', async () => {
    // Session-reloaded messages with images come in
    // multimodal array form. Copy should extract the
    // text blocks and skip images.
    const { writeText, restore } = installFakeClipboard();
    try {
      const p = mountPanel({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'look at this' },
              {
                type: 'image_url',
                image_url: {
                  url: 'data:image/png;base64,XXX',
                },
              },
              { type: 'text', text: 'and this' },
            ],
          },
        ],
      });
      await settle(p);
      p.shadowRoot
        .querySelector('.message-toolbar.top')
        .querySelectorAll('.message-action-button')[0]
        .click();
      await settle(p);
      expect(writeText).toHaveBeenCalledWith('look at this\nand this');
    } finally {
      restore();
    }
  });

  it('does nothing for image-only messages', async () => {
    // Multimodal content with only image blocks and no
    // text extracts to an empty string. Silent no-op
    // rather than copying an empty clipboard (which
    // would be a confusing "success" toast).
    const { writeText, restore } = installFakeClipboard();
    try {
      const p = mountPanel({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: 'data:image/png;base64,XXX',
                },
              },
            ],
          },
        ],
      });
      await settle(p);
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        p.shadowRoot
          .querySelector('.message-toolbar.top')
          .querySelectorAll('.message-action-button')[0]
          .click();
        await settle(p);
        expect(writeText).not.toHaveBeenCalled();
        // No toast either — silent.
        expect(toastListener).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    } finally {
      restore();
    }
  });

  it('emits warning toast when clipboard API is unavailable', async () => {
    // Some older browsers / insecure contexts don't
    // expose navigator.clipboard. Surface the limitation
    // rather than silently failing.
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    try {
      const p = mountPanel({
        messages: [{ role: 'user', content: 'hi' }],
      });
      await settle(p);
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        p.shadowRoot
          .querySelector('.message-toolbar.top')
          .querySelectorAll('.message-action-button')[0]
          .click();
        await settle(p);
        const detail = toastListener.mock.calls.at(-1)[0].detail;
        expect(detail.type).toBe('warning');
        expect(detail.message).toMatch(/not available/i);
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    } finally {
      if (originalClipboard === undefined) {
        delete navigator.clipboard;
      } else {
        Object.defineProperty(navigator, 'clipboard', {
          value: originalClipboard,
          configurable: true,
        });
      }
    }
  });

  it('emits warning toast on clipboard rejection', async () => {
    const writeText = vi
      .fn()
      .mockRejectedValue(new Error('permission denied'));
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    try {
      const p = mountPanel({
        messages: [{ role: 'user', content: 'hi' }],
      });
      await settle(p);
      const toastListener = vi.fn();
      window.addEventListener('ac-toast', toastListener);
      try {
        p.shadowRoot
          .querySelector('.message-toolbar.top')
          .querySelectorAll('.message-action-button')[0]
          .click();
        await settle(p);
        const detail = toastListener.mock.calls.at(-1)[0].detail;
        expect(detail.type).toBe('warning');
        expect(detail.message).toMatch(/copy failed/i);
        expect(detail.message).toContain('permission denied');
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    } finally {
      if (originalClipboard === undefined) {
        delete navigator.clipboard;
      } else {
        Object.defineProperty(navigator, 'clipboard', {
          value: originalClipboard,
          configurable: true,
        });
      }
    }
  });

  it('top and bottom toolbars both work', async () => {
    // Pin that both toolbars trigger the same action —
    // one isn't a decoy. Two separate DOM buttons, one
    // copy each.
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    try {
      const p = mountPanel({
        messages: [{ role: 'user', content: 'echo' }],
      });
      await settle(p);
      p.shadowRoot
        .querySelector('.message-toolbar.top')
        .querySelectorAll('.message-action-button')[0]
        .click();
      await settle(p);
      p.shadowRoot
        .querySelector('.message-toolbar.bottom')
        .querySelectorAll('.message-action-button')[0]
        .click();
      await settle(p);
      expect(writeText).toHaveBeenCalledTimes(2);
      expect(writeText.mock.calls[0][0]).toBe('echo');
      expect(writeText.mock.calls[1][0]).toBe('echo');
    } finally {
      if (originalClipboard === undefined) {
        delete navigator.clipboard;
      } else {
        Object.defineProperty(navigator, 'clipboard', {
          value: originalClipboard,
          configurable: true,
        });
      }
    }
  });
});

describe('ChatPanel paste-to-prompt action', () => {
  it('inserts raw text into empty textarea', async () => {
    const p = mountPanel({
      messages: [
        { role: 'assistant', content: 'help me edit' },
      ],
    });
    await settle(p);
    const pasteBtn = p.shadowRoot
      .querySelector('.message-toolbar.top')
      .querySelectorAll('.message-action-button')[1];
    pasteBtn.click();
    await settle(p);
    expect(p._input).toBe('help me edit');
  });

  it('inserts raw markdown source, not rendered HTML', async () => {
    // Parallel to the copy test — `**bold**` source is
    // what the user wants to continue with, not a
    // rendered <strong> representation that wouldn't
    // round-trip through a textarea anyway.
    const p = mountPanel({
      messages: [
        {
          role: 'assistant',
          content: 'say **bold** and `code`',
        },
      ],
    });
    await settle(p);
    p.shadowRoot
      .querySelector('.message-toolbar.top')
      .querySelectorAll('.message-action-button')[1]
      .click();
    await settle(p);
    expect(p._input).toBe('say **bold** and `code`');
  });

  it('inserts at cursor position in non-empty textarea', async () => {
    const p = mountPanel({
      messages: [{ role: 'assistant', content: 'INSERTED' }],
    });
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'before  after';
    ta.dispatchEvent(new Event('input'));
    await settle(p);
    ta.setSelectionRange(7, 7); // between "before " and " after"
    p.shadowRoot
      .querySelector('.message-toolbar.top')
      .querySelectorAll('.message-action-button')[1]
      .click();
    await settle(p);
    expect(p._input).toBe('before INSERTED after');
  });

  it('replaces selection when one exists', async () => {
    const p = mountPanel({
      messages: [{ role: 'assistant', content: 'NEW' }],
    });
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'keep OLD keep';
    ta.dispatchEvent(new Event('input'));
    await settle(p);
    ta.setSelectionRange(5, 8); // "OLD"
    p.shadowRoot
      .querySelector('.message-toolbar.top')
      .querySelectorAll('.message-action-button')[1]
      .click();
    await settle(p);
    expect(p._input).toBe('keep NEW keep');
  });

  it('focuses textarea after paste', async () => {
    // Publish a fake RPC so the textarea isn't disabled —
    // `focus()` on a disabled element is a no-op in
    // browsers, and the assertion would fail despite the
    // code doing the right thing. The paste-to-prompt
    // action is meant to be used during normal (connected)
    // operation; disabled-textarea is already covered
    // implicitly by the initial-state tests.
    publishFakeRpc({});
    const p = mountPanel({
      messages: [{ role: 'assistant', content: 'hi' }],
    });
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    // Focus something else so we can observe the shift.
    const btn = p.shadowRoot
      .querySelector('.message-toolbar.top')
      .querySelectorAll('.message-action-button')[1];
    btn.focus();
    btn.click();
    await settle(p);
    expect(p.shadowRoot.activeElement).toBe(ta);
  });

  it('positions cursor at end of inserted text', async () => {
    const p = mountPanel({
      messages: [{ role: 'assistant', content: 'XYZ' }],
    });
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'ab';
    ta.dispatchEvent(new Event('input'));
    await settle(p);
    ta.setSelectionRange(1, 1); // between a and b
    p.shadowRoot
      .querySelector('.message-toolbar.top')
      .querySelectorAll('.message-action-button')[1]
      .click();
    await settle(p);
    // Inserted "XYZ" at pos 1 → cursor at 1 + 3 = 4.
    expect(ta.selectionStart).toBe(4);
    expect(ta.selectionEnd).toBe(4);
  });

  it('extracts text from multimodal content', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'part 1' },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,Z',
              },
            },
            { type: 'text', text: 'part 2' },
          ],
        },
      ],
    });
    await settle(p);
    p.shadowRoot
      .querySelector('.message-toolbar.top')
      .querySelectorAll('.message-action-button')[1]
      .click();
    await settle(p);
    expect(p._input).toBe('part 1\npart 2');
  });

  it('does nothing for image-only messages', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,Z',
              },
            },
          ],
        },
      ],
    });
    await settle(p);
    p.shadowRoot
      .querySelector('.message-toolbar.top')
      .querySelectorAll('.message-action-button')[1]
      .click();
    await settle(p);
    // Input unchanged — no text to insert.
    expect(p._input).toBe('');
  });

  it('top and bottom paste buttons both work', async () => {
    const p = mountPanel({
      messages: [{ role: 'assistant', content: 'A' }],
    });
    await settle(p);
    // Click top paste.
    p.shadowRoot
      .querySelector('.message-toolbar.top')
      .querySelectorAll('.message-action-button')[1]
      .click();
    await settle(p);
    expect(p._input).toBe('A');
    // Click bottom paste — accumulates.
    p.shadowRoot
      .querySelector('.message-toolbar.bottom')
      .querySelectorAll('.message-action-button')[1]
      .click();
    await settle(p);
    expect(p._input).toBe('AA');
  });
});

// ---------------------------------------------------------------------------
// Retry prompt integration (populate-on-stream-complete)
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
    // Specs3: "Note: may overwrite an earlier
    // ambiguous-anchor prompt if both are present in the
    // same response — acceptable." The last-wins ordering
    // in _maybePopulateRetryPrompt enforces this.
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
    // The not-in-context prompt text is present…
    expect(p._input).toContain('The file b.py');
    expect(p._input).toContain('has been added');
    // …and the ambiguous prompt text is not.
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
    // Both apply — the priority ordering means ambiguous
    // wins over in-context mismatch (but not over
    // not-in-context). Pinning the order so a future
    // refactor doesn't accidentally reshuffle.
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
    // Ambiguous prompt shows — mentions b.py.
    expect(p._input).toContain('b.py');
    // Use a substring that doesn't straddle a newline.
    // The prompt wraps "surrounding" at end of one line
    // and "context" starts the next — `'retry with more
    // surrounding'` sits entirely on one line.
    expect(p._input).toContain('retry with more surrounding');
    // In-context mismatch prompt does NOT show —
    // "already in" is unique to that prompt.
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
    // Error responses short-circuit before the retry
    // logic — we don't want to suggest retries when the
    // whole request failed.
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
    // User typed something in the textarea between stream
    // end and retry-prompt logic — we leave it alone.
    // Tests this by pre-populating _input before the
    // stream-complete event fires.
    const p = mountPanel();
    const reqId = await sendAndGetId(p);
    // Simulate the user typing after send cleared input.
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
    // Retry prompts are our feedback for our own actions.
    // A collaborator's stream shouldn't leave a prompt
    // in our textarea.
    const p = mountPanel();
    await settle(p);
    // No send — we're a passive observer.
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
// Compaction event routing
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
    // Complete the stream so _lastRequestId is set.
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
    // Set up a conversation, complete the stream, then
    // compaction replaces the message list. The new list
    // is authoritative — older messages are gone.
    const p = mountPanel();
    const reqId = await sendAndGetId(p, 'original question');
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'original answer' },
    });
    await settle(p);
    // Pre-check: two messages (user + assistant).
    expect(p.messages).toHaveLength(2);
    // Compaction delivers a shorter list (e.g., just the
    // summary pair).
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
    // Defensive — if the backend ever sends a malformed
    // compacted event without the messages list, we
    // shouldn't throw or clear the existing messages.
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
    // Messages unchanged — malformed event is a no-op
    // at the data layer (toast still fires).
    expect(p.messages).toHaveLength(preMessages);
  });

  it('compacted normalises multimodal content in replacement', async () => {
    // The compacted message list may contain multimodal
    // user messages (images preserved across compaction).
    // Normalise to the same shape as session-changed.
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
    // but `_lastRequestId` matches. Without the
    // fallback, compaction would be silently dropped.
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
    // mid-stream (e.g., the backend triggered compaction
    // from a previous request and it's still in flight).
    // `_currentRequestId` matches.
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
    // Some backend progress events may not carry a
    // request ID (e.g., global housekeeping). Those
    // shouldn't be filtered out.
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
    // Various malformed shapes. Each should be a no-op.
    for (const detail of [{}, { requestId: 'x' }, { event: null }]) {
      pushEvent('compaction-event', detail);
      await settle(p);
    }
    // Panel still works — a subsequent valid event
    // produces a toast.
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

describe('ChatPanel compaction events — cleanup', () => {
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

// ---------------------------------------------------------------------------
// Message search
// ---------------------------------------------------------------------------

describe('ChatPanel message search — rendering', () => {
  it('renders search input in the action bar', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    expect(input).toBeTruthy();
    expect(input.placeholder).toMatch(/search/i);
  });

  it('renders three toggle buttons (Aa, .*, ab)', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const toggles = p.shadowRoot.querySelectorAll(
      '.search-toggle',
    );
    expect(toggles).toHaveLength(3);
    const labels = Array.from(toggles).map((t) =>
      t.textContent.trim(),
    );
    expect(labels).toEqual(['Aa', '.*', 'ab']);
  });

  it('renders nav buttons (prev / next)', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const navs = p.shadowRoot.querySelectorAll(
      '.search-nav-button',
    );
    expect(navs).toHaveLength(2);
  });

  it('nav buttons disabled when no query', async () => {
    publishFakeRpc({});
    const p = mountPanel({
      messages: [{ role: 'user', content: 'hi' }],
    });
    await settle(p);
    const navs = p.shadowRoot.querySelectorAll(
      '.search-nav-button',
    );
    expect(navs[0].disabled).toBe(true);
    expect(navs[1].disabled).toBe(true);
  });

  it('counter is hidden when no query', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const counter = p.shadowRoot.querySelector('.search-counter');
    // Counter element exists but is empty.
    expect(counter.textContent.trim()).toBe('');
  });

  it('renders data-msg-index on each message card', async () => {
    // Load-bearing for highlight targeting — the scroll
    // logic queries by attribute.
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'two' },
        { role: 'user', content: 'three' },
      ],
    });
    await settle(p);
    const cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards).toHaveLength(3);
    expect(cards[0].getAttribute('data-msg-index')).toBe('0');
    expect(cards[1].getAttribute('data-msg-index')).toBe('1');
    expect(cards[2].getAttribute('data-msg-index')).toBe('2');
  });
});

describe('ChatPanel message search — query and counter', () => {
  it('typing updates the counter', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'find this text' },
        { role: 'assistant', content: 'not a match' },
        { role: 'user', content: 'find that too' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'find';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    const counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('1/2');
  });

  it('counter shows 0/0 when no matches', async () => {
    const p = mountPanel({
      messages: [{ role: 'user', content: 'hello' }],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'nope';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    const counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('0/0');
    expect(counter.classList.contains('no-match')).toBe(true);
  });

  it('empty query returns nav buttons to disabled', async () => {
    const p = mountPanel({
      messages: [{ role: 'user', content: 'hello' }],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    // Query has matches — nav enabled.
    let navs = p.shadowRoot.querySelectorAll('.search-nav-button');
    expect(navs[0].disabled).toBe(false);
    // Clear query — disabled again.
    input.value = '';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    navs = p.shadowRoot.querySelectorAll('.search-nav-button');
    expect(navs[0].disabled).toBe(true);
  });
});

describe('ChatPanel message search — highlight', () => {
  it('highlights the first match when query is entered', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'apple' },
        { role: 'assistant', content: 'banana' },
        { role: 'user', content: 'apple again' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'apple';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    const cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[0].classList.contains('search-highlight')).toBe(true);
    expect(cards[1].classList.contains('search-highlight')).toBe(false);
    expect(cards[2].classList.contains('search-highlight')).toBe(false);
  });

  it('no highlight when query has no matches', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'nope';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    const highlights = p.shadowRoot.querySelectorAll(
      '.message-card.search-highlight',
    );
    expect(highlights).toHaveLength(0);
  });

  it('no highlight on empty query', async () => {
    const p = mountPanel({
      messages: [{ role: 'user', content: 'hello' }],
    });
    await settle(p);
    const highlights = p.shadowRoot.querySelectorAll(
      '.message-card.search-highlight',
    );
    expect(highlights).toHaveLength(0);
  });
});

describe('ChatPanel message search — navigation', () => {
  async function setup() {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'target' },
        { role: 'assistant', content: 'not me' },
        { role: 'user', content: 'target two' },
        { role: 'assistant', content: 'filler' },
        { role: 'user', content: 'target three' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'target';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    return p;
  }

  it('next button advances current match', async () => {
    const p = await setup();
    // Starts at first match.
    let cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[0].classList.contains('search-highlight')).toBe(true);
    // Click next.
    const navs = p.shadowRoot.querySelectorAll(
      '.search-nav-button',
    );
    navs[1].click(); // next
    await settle(p);
    cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[0].classList.contains('search-highlight')).toBe(false);
    expect(cards[2].classList.contains('search-highlight')).toBe(true);
  });

  it('prev button goes backward', async () => {
    const p = await setup();
    // Advance to index 2 first.
    const navs = p.shadowRoot.querySelectorAll(
      '.search-nav-button',
    );
    navs[1].click(); // next → match 2 (index 2)
    navs[1].click(); // next → match 3 (index 4)
    await settle(p);
    let cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[4].classList.contains('search-highlight')).toBe(true);
    // Prev.
    navs[0].click();
    await settle(p);
    cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[4].classList.contains('search-highlight')).toBe(false);
    expect(cards[2].classList.contains('search-highlight')).toBe(true);
  });

  it('next wraps at the end', async () => {
    const p = await setup();
    const navs = p.shadowRoot.querySelectorAll(
      '.search-nav-button',
    );
    // 3 matches; click next 3 times to wrap back to index 0.
    navs[1].click();
    navs[1].click();
    navs[1].click();
    await settle(p);
    const cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[0].classList.contains('search-highlight')).toBe(true);
  });

  it('prev wraps at the start', async () => {
    const p = await setup();
    const navs = p.shadowRoot.querySelectorAll(
      '.search-nav-button',
    );
    // At index 0 initially; prev wraps to last match (index 4).
    navs[0].click();
    await settle(p);
    const cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[4].classList.contains('search-highlight')).toBe(true);
  });

  it('counter tracks navigation position', async () => {
    const p = await setup();
    const counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('1/3');
    const navs = p.shadowRoot.querySelectorAll(
      '.search-nav-button',
    );
    navs[1].click();
    await settle(p);
    expect(counter.textContent.trim()).toBe('2/3');
    navs[1].click();
    await settle(p);
    expect(counter.textContent.trim()).toBe('3/3');
  });
});

describe('ChatPanel message search — keyboard', () => {
  it('Enter in search input advances to next match', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'target' },
        { role: 'user', content: 'target' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'target';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      }),
    );
    await settle(p);
    const cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[1].classList.contains('search-highlight')).toBe(true);
  });

  it('Shift+Enter goes to previous match', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'target' },
        { role: 'user', content: 'target' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'target';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
      }),
    );
    await settle(p);
    // From index 0, Shift+Enter wraps to last match (index 1).
    const cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[1].classList.contains('search-highlight')).toBe(true);
  });

  it('Enter does not send a chat message', async () => {
    // The search input's Enter handler must consume the
    // event. Otherwise the textarea's Enter handler might
    // also fire (if focus propagated), sending a message.
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel({
      messages: [{ role: 'user', content: 'target' }],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'target';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(started).not.toHaveBeenCalled();
  });

  it('Escape clears the query', async () => {
    const p = mountPanel({
      messages: [{ role: 'user', content: 'x' }],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'x';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    expect(p._searchQuery).toBe('x');
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(p._searchQuery).toBe('');
  });

  it('Escape blurs the input', async () => {
    const p = mountPanel({
      messages: [{ role: 'user', content: 'x' }],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.focus();
    expect(p.shadowRoot.activeElement).toBe(input);
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(p.shadowRoot.activeElement).not.toBe(input);
  });
});

describe('ChatPanel message search — toggles', () => {
  it('ignore-case toggle flips search sensitivity', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'Apple' },
        { role: 'user', content: 'apple' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'apple';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    // Default ignore-case ON — both match.
    let counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('1/2');
    // Toggle off.
    const toggles = p.shadowRoot.querySelectorAll(
      '.search-toggle',
    );
    toggles[0].click(); // Aa
    await settle(p);
    // Case-sensitive — only lowercase "apple" matches.
    counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('1/1');
  });

  it('regex toggle enables pattern matching', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'order 123' },
        { role: 'user', content: 'order 456' },
        { role: 'user', content: 'plain text' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = '\\d+';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    // Regex off — literal `\d+` matches nothing.
    let counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('0/0');
    // Toggle regex on.
    const toggles = p.shadowRoot.querySelectorAll(
      '.search-toggle',
    );
    toggles[1].click(); // .*
    await settle(p);
    counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('1/2');
  });

  it('whole-word toggle excludes substring matches', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'the cat sat' },
        { role: 'user', content: 'catalog here' },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'cat';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    let counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('1/2');
    // Toggle whole-word on.
    const toggles = p.shadowRoot.querySelectorAll(
      '.search-toggle',
    );
    toggles[2].click(); // ab
    await settle(p);
    counter = p.shadowRoot.querySelector('.search-counter');
    expect(counter.textContent.trim()).toBe('1/1');
  });

  it('toggle state shown as active class when on', async () => {
    const p = mountPanel();
    await settle(p);
    const toggles = p.shadowRoot.querySelectorAll(
      '.search-toggle',
    );
    // Default: Aa on, .* off, ab off.
    expect(toggles[0].classList.contains('active')).toBe(true);
    expect(toggles[1].classList.contains('active')).toBe(false);
    expect(toggles[2].classList.contains('active')).toBe(false);
    // Click .* — becomes active.
    toggles[1].click();
    await settle(p);
    expect(toggles[1].classList.contains('active')).toBe(true);
  });
});

describe('ChatPanel message search — persistence', () => {
  it('loads toggle state from localStorage', async () => {
    _saveSearchToggle(_SEARCH_IGNORE_CASE_KEY, false);
    _saveSearchToggle(_SEARCH_REGEX_KEY, true);
    _saveSearchToggle(_SEARCH_WHOLE_WORD_KEY, true);
    const p = mountPanel();
    await settle(p);
    expect(p._searchIgnoreCase).toBe(false);
    expect(p._searchRegex).toBe(true);
    expect(p._searchWholeWord).toBe(true);
  });

  it('saves toggle state on change', async () => {
    const p = mountPanel();
    await settle(p);
    const toggles = p.shadowRoot.querySelectorAll(
      '.search-toggle',
    );
    toggles[1].click(); // enable regex
    await settle(p);
    expect(_loadSearchToggle(_SEARCH_REGEX_KEY, false)).toBe(true);
  });

  it('ignore-case defaults to true when no stored value', () => {
    expect(
      _loadSearchToggle(_SEARCH_IGNORE_CASE_KEY, true),
    ).toBe(true);
  });

  it('regex defaults to false when no stored value', () => {
    expect(_loadSearchToggle(_SEARCH_REGEX_KEY, false)).toBe(false);
  });

  it('malformed localStorage value falls back to default', () => {
    localStorage.setItem(_SEARCH_REGEX_KEY, 'maybe');
    expect(_loadSearchToggle(_SEARCH_REGEX_KEY, false)).toBe(false);
  });
});

describe('ChatPanel message search — multimodal content', () => {
  it('searches text blocks of multimodal messages', async () => {
    const p = mountPanel({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'see this screenshot' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,X' },
            },
          ],
        },
      ],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'screenshot';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    const cards = p.shadowRoot.querySelectorAll('.message-card');
    expect(cards[0].classList.contains('search-highlight')).toBe(true);
  });
});

describe('ChatPanel paste suppression', () => {
  // Helper — build a fake paste event matching the
  // image-paste test pattern but simpler since we're
  // just asserting preventDefault behaviour.
  function pasteEvent(items = []) {
    const ev = new Event('paste', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(ev, 'clipboardData', {
      value: { items },
      writable: false,
    });
    return ev;
  }

  it('_suppressNextPaste defaults to false', async () => {
    const p = mountPanel();
    await settle(p);
    expect(p._suppressNextPaste).toBe(false);
  });

  it('swallows the next paste when flag is set', async () => {
    // Load-bearing — this is the whole point of the
    // flag. The files-tab's middle-click handler sets
    // the flag immediately before focus() on the
    // textarea; on Linux that focus triggers the
    // selection-buffer auto-paste, which we need to
    // preventDefault.
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._suppressNextPaste = true;
    const ta = p.shadowRoot.querySelector('.input-textarea');
    const ev = pasteEvent([
      { kind: 'string', type: 'text/plain' },
    ]);
    const preventSpy = vi.spyOn(ev, 'preventDefault');
    ta.dispatchEvent(ev);
    await settle(p);
    expect(preventSpy).toHaveBeenCalled();
  });

  it('clears the flag after one paste', async () => {
    // One-shot — a subsequent paste must work normally.
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._suppressNextPaste = true;
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.dispatchEvent(pasteEvent());
    await settle(p);
    expect(p._suppressNextPaste).toBe(false);
  });

  it('subsequent paste is not suppressed', async () => {
    // End-to-end: first paste swallowed, second paste
    // falls through to normal handling. Proves the
    // flag clears rather than staying stuck on.
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    p._suppressNextPaste = true;
    const ta = p.shadowRoot.querySelector('.input-textarea');
    // First paste — swallowed.
    const ev1 = pasteEvent([
      { kind: 'string', type: 'text/plain' },
    ]);
    const prevent1 = vi.spyOn(ev1, 'preventDefault');
    ta.dispatchEvent(ev1);
    await settle(p);
    expect(prevent1).toHaveBeenCalled();
    // Second paste — text paste falls through, no
    // preventDefault.
    const ev2 = pasteEvent([
      { kind: 'string', type: 'text/plain' },
    ]);
    const prevent2 = vi.spyOn(ev2, 'preventDefault');
    ta.dispatchEvent(ev2);
    await settle(p);
    expect(prevent2).not.toHaveBeenCalled();
  });

  it('flag does not prevent image paste when not set', async () => {
    // Sanity check — flag off means normal paste
    // behaviour works unchanged.
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    expect(p._suppressNextPaste).toBe(false);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    // A text paste with flag off — no preventDefault.
    const ev = pasteEvent([
      { kind: 'string', type: 'text/plain' },
    ]);
    const preventSpy = vi.spyOn(ev, 'preventDefault');
    ta.dispatchEvent(ev);
    await settle(p);
    expect(preventSpy).not.toHaveBeenCalled();
  });

  it('flag is not a reactive property (no re-render on flip)', async () => {
    // Pinned because reactive state would cause a Lit
    // re-render on every flag flip — wasteful for a
    // field that exists purely for paste-handler scope
    // and changes multiple times per middle-click flow.
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const updateSpy = vi.spyOn(p, 'requestUpdate');
    p._suppressNextPaste = true;
    p._suppressNextPaste = false;
    p._suppressNextPaste = true;
    // No re-render triggered by the flag changes.
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('ChatPanel message search — scroll behaviour', () => {
  it('calls scrollIntoView when current match changes', async () => {
    // Element.scrollIntoView is a no-op in jsdom, so spy
    // on the prototype to verify the call.
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      const p = mountPanel({
        messages: [
          { role: 'user', content: 'target' },
          { role: 'assistant', content: 'x' },
          { role: 'user', content: 'target' },
        ],
      });
      await settle(p);
      const input = p.shadowRoot.querySelector('.search-input');
      input.value = 'target';
      input.dispatchEvent(new Event('input'));
      // Give the updateComplete.then scroll enough time.
      await settle(p);
      await new Promise((r) => setTimeout(r, 20));
      expect(spy).toHaveBeenCalled();
      // Called with center-block option.
      const args = spy.mock.calls[0][0];
      expect(args.block).toBe('center');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('does not crash when match index is out of range', async () => {
    // Defensive — if messages change between match
    // computation and scroll, the target card might be
    // gone. Silent noop.
    const p = mountPanel({
      messages: [{ role: 'user', content: 'target' }],
    });
    await settle(p);
    const input = p.shadowRoot.querySelector('.search-input');
    input.value = 'target';
    input.dispatchEvent(new Event('input'));
    await settle(p);
    // Force an out-of-range index.
    p._searchCurrentIndex = 999;
    // Manually call scroll — no throw.
    expect(() => p._scrollToCurrentMatch()).not.toThrow();
  });
});