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
import { ChatPanel, generateRequestId } from './chat-panel.js';

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

  it('renders user content as escaped plain text, not markdown', async () => {
    // Users typed what they typed; we don't reinterpret their
    // asterisks as bold or their backticks as code.
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'use **bold** here' },
      ],
    });
    await settle(p);
    const html = p.shadowRoot.querySelector(
      '.role-user .md-content',
    ).innerHTML;
    // Asterisks appear as literal characters, no <strong> tag.
    expect(html).toContain('**bold**');
    expect(html).not.toContain('<strong>');
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
    // Old and new panes both present for a modify block.
    expect(cards[0].querySelector('.edit-pane-old')).toBeTruthy();
    expect(cards[0].querySelector('.edit-pane-new')).toBeTruthy();
    // Content of each pane preserved.
    const oldPane = cards[0].querySelector(
      '.edit-pane-old .edit-pane-content',
    );
    const newPane = cards[0].querySelector(
      '.edit-pane-new .edit-pane-content',
    );
    expect(oldPane.textContent).toBe('old line');
    expect(newPane.textContent).toBe('new line');
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
    // A create block has empty old-text. The renderer shows
    // only the NEW pane and uses the `new` status for cards
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
    expect(card.querySelector('.edit-pane-old')).toBeNull();
    expect(card.querySelector('.edit-pane-new')).toBeTruthy();
    expect(
      card.querySelector('.edit-pane-new .edit-pane-content')
        .textContent,
    ).toBe('print("hello")');
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
    // Old pane shows the in-progress content.
    expect(
      card.querySelector('.edit-pane-old .edit-pane-content')
        .textContent,
    ).toBe('old line one\nold line t');
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