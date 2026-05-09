// Tests for input handling, send flow, message rendering,
// edit-block rendering, file mentions, image paste/render,
// message action buttons, snippet drawer, history browser,
// new-session, lightbox, and input history.

import { describe, expect, it, vi } from 'vitest';

import {
  _DRAWER_STORAGE_KEY,
  _loadDrawerOpen,
  _saveDrawerOpen,
} from '../chat-panel/index.js';
import {
  mountPanel,
  publishFakeRpc,
  pushEvent,
  settle,
} from './test-helpers.js';

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
    // User input goes through the markdown renderer.
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
// Edit block rendering
// ---------------------------------------------------------------------------

describe('ChatPanel edit block rendering', () => {
  // Edit-block fixtures — literal marker bytes per D3.
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
    const p = mountPanel({
      messages: [
        { role: 'assistant', content: proseAndEdit },
      ],
    });
    await settle(p);
    const card = p.shadowRoot.querySelector(
      '.role-assistant',
    );
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
    expect(cards[0].querySelector('.edit-file-path').textContent).toBe(
      'src/foo.py',
    );
    expect(cards[0].querySelector('.edit-pane-content')).toBeTruthy();
    expect(cards[0].querySelector('.edit-pane-old')).toBeNull();
    expect(cards[0].querySelector('.edit-pane-new')).toBeNull();
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
    expect(cards[0].querySelector('.edit-error-message')).toBeNull();
    expect(cards[1].querySelector('.edit-error-message')).toBeTruthy();
  });

  it('renders create block with NEW pane only', async () => {
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
    expect(card.querySelector('.edit-pane-content')).toBeTruthy();
    expect(card.querySelector('.edit-pane-old')).toBeNull();
    expect(card.querySelector('.edit-pane-new')).toBeNull();
    expect(card.querySelector('.diff-line.add')).toBeTruthy();
    expect(card.querySelector('.diff-line.remove')).toBeNull();
    expect(
      card.querySelector('.diff-line.add').textContent,
    ).toBe('+print("hello")');
  });

  it('renders pending block during streaming', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    p._input = 'hi';
    await p._send();
    const reqId = started.mock.calls[0][0];
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
    const streaming = p.shadowRoot.querySelector(
      '.message-card.streaming',
    );
    expect(streaming).toBeTruthy();
    const card = streaming.querySelector('.edit-block-card');
    expect(card).toBeTruthy();
    expect(card.classList.contains('edit-status-pending')).toBe(true);
    expect(
      card.querySelector('.edit-pane-content').textContent,
    ).toBe('-old line one\n-old line t');
    expect(card.querySelectorAll('.diff-line.remove')).toHaveLength(2);
    expect(card.querySelector('.diff-line.add')).toBeNull();
  });

  it('streaming cursor appears after the body', async () => {
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
    expect(
      p.shadowRoot.querySelector('.message-card.streaming'),
    ).toBeNull();
    const card = p.shadowRoot.querySelector('.edit-block-card');
    expect(card).toBeTruthy();
    expect(card.classList.contains('edit-status-applied')).toBe(true);
  });

  it('user message with edit-block-shaped content renders as text', async () => {
    const p = mountPanel({
      messages: [
        { role: 'user', content: simpleEditBlock },
      ],
    });
    await settle(p);
    const userCard = p.shadowRoot.querySelector('.role-user');
    expect(userCard.querySelector('.edit-block-card')).toBeNull();
    expect(userCard.textContent).toContain('EDIT');
    expect(userCard.textContent).toContain('REPL');
    expect(userCard.textContent).toContain('END');
  });

  it('error message does not segment', async () => {
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
    expect(card.querySelector('strong')).toBeTruthy();
    expect(card.querySelector('.edit-block-card')).toBeNull();
  });

  it('empty assistant content renders empty body without crashing', async () => {
    const p = mountPanel({
      messages: [
        { role: 'assistant', content: '' },
      ],
    });
    await settle(p);
    const card = p.shadowRoot.querySelector('.role-assistant');
    expect(card).toBeTruthy();
    expect(card.querySelector('.edit-block-card')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// File mentions
// ---------------------------------------------------------------------------

describe('ChatPanel file mentions', () => {
  it('does not wrap mentions when repoFiles is empty (default)', async () => {
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
    expect(streaming.textContent).toContain('src/foo.py');
  });

  it('wraps mentions after stream completes', async () => {
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
    expect(
      p.shadowRoot.querySelector('.file-mention'),
    ).toBeNull();
    pushEvent('stream-complete', {
      requestId: reqId,
      result: { response: 'editing src/foo.py now' },
    });
    await settle(p);
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
    expect(card.textContent).toContain('src/foo.py');
    expect(card.querySelector('.file-mention')).toBeNull();
  });

  it('wraps mentions in prose but not in code within same message', async () => {
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
    p.shadowRoot
      .querySelector('.role-label')
      .click();
    expect(listener).not.toHaveBeenCalled();
    p.shadowRoot
      .querySelector('.message-card')
      .click();
    expect(listener).not.toHaveBeenCalled();
  });

  it('mention without data-file attribute does not dispatch', async () => {
    const p = mountPanel();
    await settle(p);
    const container = p.shadowRoot.querySelector('.messages');
    const fake = document.createElement('span');
    fake.className = 'file-mention';
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
    const btn = p.shadowRoot.querySelector('.send-button');
    expect(btn.classList.contains('stop')).toBe(true);
    expect(btn.textContent).toContain('Stop');
  });

  it('does nothing when input is empty', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
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
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'first';
    ta.dispatchEvent(new Event('input'));
    await p.updateComplete;
    p.shadowRoot.querySelector('.send-button').click();
    await settle(p);
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
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      p._input = 'hello';
      await p._send();
      await settle(p);
      expect(p.messages).toHaveLength(2);
      expect(p.messages[1].content).toContain('network down');
      expect(p._streaming).toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
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
    ta.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
      }),
    );
    await p.updateComplete;
    expect(started).not.toHaveBeenCalled();
    ta.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter' }),
    );
    await settle(p);
    expect(started).toHaveBeenCalledOnce();
  });

  it('Enter during IME composition does not send', async () => {
    // IME users press Enter to commit a composition.
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
    const history = p.shadowRoot.querySelector('ac-input-history');
    history.addEntry('existing entry');
    pushEvent('session-changed', {
      session_id: 'sess_new',
      messages: [],
    });
    await settle(p);
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
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({ 'LLMService.chat_streaming': started });
    const p = mountPanel();
    await settle(p);
    const history = p.shadowRoot.querySelector('ac-input-history');
    history.addEntry('prior');
    history.show('');
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(started).not.toHaveBeenCalled();
    expect(history.isOpen).toBe(false);
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
    const snippetsLabel =
      `${btn.getAttribute('title') || ''} `
      + `${btn.getAttribute('aria-label') || ''}`;
    expect(snippetsLabel).toContain('snippet');
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
    const p = mountPanel();
    await settle(p);
    p.shadowRoot.querySelector('.snippet-drawer-button').click();
    await settle(p);
    expect(p._snippetDrawerOpen).toBe(true);
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
      window.dispatchEvent(new CustomEvent('mode-changed'));
      await settle(p);
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
    ta.value = 'hello world';
    ta.dispatchEvent(new Event('input'));
    await settle(p);
    ta.setSelectionRange(6, 6);
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
    ta.setSelectionRange(8, 10);
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
    ta.setSelectionRange(1, 1);
    const btn = p.shadowRoot.querySelectorAll('.snippet-button')[0];
    btn.click();
    await settle(p);
    expect(ta.selectionStart).toBe(13);
    expect(ta.selectionEnd).toBe(13);
  });

  it('focuses the textarea after insertion', async () => {
    const p = await setupWithSnippets();
    const ta = p.shadowRoot.querySelector('.input-textarea');
    const btn = p.shadowRoot.querySelectorAll('.snippet-button')[0];
    btn.focus();
    btn.click();
    await settle(p);
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
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({
      'LLMService.get_snippets': vi.fn().mockResolvedValue([]),
      'LLMService.chat_streaming': started,
    });
    const p = mountPanel();
    await settle(p);
    localStorage.removeItem(_DRAWER_STORAGE_KEY);
    p._input = 'hello';
    await p._send();
    await settle(p);
    expect(localStorage.getItem(_DRAWER_STORAGE_KEY)).toBeNull();
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
    const newSessionLabel =
      `${btn.getAttribute('title') || ''} `
      + `${btn.getAttribute('aria-label') || ''}`;
    expect(newSessionLabel).toContain('New session');
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
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].content).toBe('existing');
  });

  it('session-changed broadcast after click clears messages', async () => {
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
      expect(p.messages).toHaveLength(1);
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('clicking while streaming is guarded at the method level', async () => {
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
    const historyLabel =
      `${btn.getAttribute('title') || ''} `
      + `${btn.getAttribute('aria-label') || ''}`;
    expect(historyLabel).toContain('history');
  });

  it('History button is disabled when RPC is disconnected', async () => {
    const p = mountPanel();
    await settle(p);
    const btn = p.shadowRoot.querySelector('.history-button');
    expect(btn.disabled).toBe(true);
  });

  it('History button stays enabled during streaming', async () => {
    // Opening the browser is read-only.
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
    expect(p._historyOpen).toBe(false);
    expect(p.messages).toHaveLength(1);
  });

  it('can open modal while streaming', async () => {
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
// Image paste
// ---------------------------------------------------------------------------

describe('ChatPanel image paste', () => {
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
    let btn = p.shadowRoot.querySelector('.send-button');
    expect(btn.disabled).toBe(true);
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
    p._pendingImages = ['data:image/png;base64,SAME'];
    await settle(p);
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      p.shadowRoot
        .querySelector('.message-image-reattach')
        .click();
      await settle(p);
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
// Message action buttons
// ---------------------------------------------------------------------------

describe('ChatPanel message action buttons', () => {
  it('renders two toolbars (top and bottom) on each message', async () => {
    // Both ends — long messages may have either end in
    // view, so toolbars at both saves scrolling.
    const p = mountPanel({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    });
    await settle(p);
    const toolbars = p.shadowRoot.querySelectorAll(
      '.message-toolbar',
    );
    expect(toolbars.length).toBe(4);
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
    const labels = Array.from(buttons).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels[0]).toMatch(/copy/i);
    expect(labels[1]).toMatch(/insert/i);
  });

  it('toolbar is NOT rendered on streaming message', async () => {
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
    expect(
      streamingCard.querySelector('.message-toolbar'),
    ).toBeNull();
    const userCard = p.shadowRoot.querySelector(
      '.message-card.role-user',
    );
    expect(
      userCard.querySelector('.message-toolbar'),
    ).toBeTruthy();
  });

  it('system event messages get toolbars too', async () => {
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
        expect(toastListener).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('ac-toast', toastListener);
      }
    } finally {
      restore();
    }
  });

  it('emits warning toast when clipboard API is unavailable', async () => {
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
    ta.setSelectionRange(7, 7);
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
    ta.setSelectionRange(5, 8);
    p.shadowRoot
      .querySelector('.message-toolbar.top')
      .querySelectorAll('.message-action-button')[1]
      .click();
    await settle(p);
    expect(p._input).toBe('keep NEW keep');
  });

  it('focuses textarea after paste', async () => {
    publishFakeRpc({});
    const p = mountPanel({
      messages: [{ role: 'assistant', content: 'hi' }],
    });
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
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
    ta.setSelectionRange(1, 1);
    p.shadowRoot
      .querySelector('.message-toolbar.top')
      .querySelectorAll('.message-action-button')[1]
      .click();
    await settle(p);
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
    expect(p._input).toBe('');
  });

  it('top and bottom paste buttons both work', async () => {
    const p = mountPanel({
      messages: [{ role: 'assistant', content: 'A' }],
    });
    await settle(p);
    p.shadowRoot
      .querySelector('.message-toolbar.top')
      .querySelectorAll('.message-action-button')[1]
      .click();
    await settle(p);
    expect(p._input).toBe('A');
    p.shadowRoot
      .querySelector('.message-toolbar.bottom')
      .querySelectorAll('.message-action-button')[1]
      .click();
    await settle(p);
    expect(p._input).toBe('AA');
  });
});