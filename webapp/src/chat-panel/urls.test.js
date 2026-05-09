// Tests for URL chip detection, fetch, remove, view dialog,
// and lifecycle integration with session-changed and send.

import { describe, expect, it, vi } from 'vitest';

import {
  mountPanel,
  publishFakeRpc,
  pushEvent,
  settle,
} from './test-helpers.js';

// ---------------------------------------------------------------------------
// URL chip detection
// ---------------------------------------------------------------------------

describe('ChatPanel URL chip detection', () => {
  it('schedules detection on input change', async () => {
    const detect = vi
      .fn()
      .mockResolvedValue([
        { url: 'https://a.com', type: 'generic', display_name: 'a' },
      ]);
    publishFakeRpc({ 'LLMService.detect_urls': detect });
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'check https://a.com';
    ta.dispatchEvent(new Event('input'));
    await p.updateComplete;
    // Debounce is 300ms; detection shouldn't have fired yet.
    expect(detect).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 350));
    expect(detect).toHaveBeenCalledOnce();
    expect(detect).toHaveBeenCalledWith('check https://a.com');
  });

  it('debounces rapid input — only one RPC call per pause', async () => {
    const detect = vi.fn().mockResolvedValue([]);
    publishFakeRpc({ 'LLMService.detect_urls': detect });
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    for (const text of ['a', 'ab', 'abc']) {
      ta.value = text;
      ta.dispatchEvent(new Event('input'));
      await p.updateComplete;
    }
    await new Promise((r) => setTimeout(r, 350));
    expect(detect).toHaveBeenCalledTimes(1);
    expect(detect).toHaveBeenCalledWith('abc');
  });

  it('empty input cancels pending detection', async () => {
    const detect = vi.fn().mockResolvedValue([]);
    publishFakeRpc({ 'LLMService.detect_urls': detect });
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'some text';
    ta.dispatchEvent(new Event('input'));
    ta.value = '';
    ta.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 350));
    expect(detect).not.toHaveBeenCalled();
  });

  it('empty input clears detected chips', async () => {
    const detect = vi
      .fn()
      .mockResolvedValue([
        { url: 'https://a.com', type: 'generic', display_name: 'a' },
      ]);
    publishFakeRpc({ 'LLMService.detect_urls': detect });
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'check https://a.com';
    ta.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 350));
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    expect(chipsEl._chips.size).toBe(1);
    ta.value = '';
    ta.dispatchEvent(new Event('input'));
    await settle(p);
    expect(chipsEl._chips.size).toBe(0);
  });

  it('stale detection responses are discarded', async () => {
    let resolveFirst;
    let resolveSecond;
    const detect = vi.fn()
      .mockImplementationOnce(
        () => new Promise((r) => { resolveFirst = r; }),
      )
      .mockImplementationOnce(
        () => new Promise((r) => { resolveSecond = r; }),
      );
    publishFakeRpc({ 'LLMService.detect_urls': detect });
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'check https://stale.com';
    ta.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 350));
    ta.value = 'check https://fresh.com';
    ta.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 350));
    resolveSecond([
      { url: 'https://fresh.com', type: 'generic', display_name: 'fresh' },
    ]);
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    expect(chipsEl._chips.has('https://fresh.com')).toBe(true);
    resolveFirst([
      { url: 'https://stale.com', type: 'generic', display_name: 'stale' },
    ]);
    await settle(p);
    expect(chipsEl._chips.has('https://stale.com')).toBe(false);
    expect(chipsEl._chips.has('https://fresh.com')).toBe(true);
  });

  it('detection failure is silent (no toast)', async () => {
    const detect = vi
      .fn()
      .mockRejectedValue(new Error('network down'));
    publishFakeRpc({ 'LLMService.detect_urls': detect });
    const debugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => {});
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      const p = mountPanel();
      await settle(p);
      const ta = p.shadowRoot.querySelector('.input-textarea');
      ta.value = 'https://a.com';
      ta.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 350));
      await settle(p);
      expect(toastListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('ac-toast', toastListener);
      debugSpy.mockRestore();
    }
  });

  it('does not run when RPC is disconnected', async () => {
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'https://a.com';
    ta.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 350));
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    expect(chipsEl._chips.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// URL chip fetch
// ---------------------------------------------------------------------------

describe('ChatPanel URL chip fetch', () => {
  async function setupWithDetected(url = 'https://a.com') {
    const detect = vi
      .fn()
      .mockResolvedValue([
        { url, type: 'generic', display_name: 'a' },
      ]);
    const fetchUrl = vi.fn();
    publishFakeRpc({
      'LLMService.detect_urls': detect,
      'LLMService.fetch_url': fetchUrl,
      'LLMService.remove_fetched_url': vi.fn().mockResolvedValue({
        removed: true,
      }),
    });
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = `check ${url}`;
    ta.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 350));
    await settle(p);
    return { panel: p, fetchUrl };
  }

  it('successful fetch transitions chip to fetched', async () => {
    const { panel, fetchUrl } = await setupWithDetected();
    fetchUrl.mockResolvedValue({
      url: 'https://a.com',
      url_type: 'generic',
      title: 'A',
      content: 'body text',
      fetched_at: '2025-01-01T00:00:00Z',
    });
    const chipsEl = panel.shadowRoot.querySelector('ac-url-chips');
    const fetchBtn = chipsEl.shadowRoot.querySelector(
      '.chip-button.primary',
    );
    fetchBtn.click();
    await settle(panel);
    expect(fetchUrl).toHaveBeenCalledWith(
      'https://a.com',
      true,
      true,
    );
    const chip = chipsEl._chips.get('https://a.com');
    expect(chip.status).toBe('fetched');
    expect(chip.content.title).toBe('A');
  });

  it('RPC rejection produces errored chip and error toast', async () => {
    const { panel, fetchUrl } = await setupWithDetected();
    fetchUrl.mockRejectedValue(new Error('network unreachable'));
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      const chipsEl = panel.shadowRoot.querySelector('ac-url-chips');
      const fetchBtn = chipsEl.shadowRoot.querySelector(
        '.chip-button.primary',
      );
      fetchBtn.click();
      await settle(panel);
      expect(chipsEl._chips.get('https://a.com').status).toBe('errored');
      const errorToasts = toastListener.mock.calls
        .map((c) => c[0].detail)
        .filter((d) => d.type === 'error');
      expect(errorToasts.length).toBeGreaterThan(0);
      expect(errorToasts[0].message).toContain('network unreachable');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
      consoleSpy.mockRestore();
    }
  });

  it('restricted-caller response produces errored chip and warning toast', async () => {
    const { panel, fetchUrl } = await setupWithDetected();
    fetchUrl.mockResolvedValue({
      error: 'restricted',
      reason: 'Participants cannot fetch URLs',
    });
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      const chipsEl = panel.shadowRoot.querySelector('ac-url-chips');
      const fetchBtn = chipsEl.shadowRoot.querySelector(
        '.chip-button.primary',
      );
      fetchBtn.click();
      await settle(panel);
      const chip = chipsEl._chips.get('https://a.com');
      expect(chip.status).toBe('errored');
      expect(chip.error).toBe('Not allowed');
      const warnings = toastListener.mock.calls
        .map((c) => c[0].detail)
        .filter((d) => d.type === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toContain('Participants');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });

  it('URLContent with error field produces errored chip (no toast)', async () => {
    const { panel, fetchUrl } = await setupWithDetected();
    fetchUrl.mockResolvedValue({
      url: 'https://a.com',
      url_type: 'generic',
      error: 'HTTP 404 Not Found',
    });
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      const chipsEl = panel.shadowRoot.querySelector('ac-url-chips');
      const fetchBtn = chipsEl.shadowRoot.querySelector(
        '.chip-button.primary',
      );
      fetchBtn.click();
      await settle(panel);
      const chip = chipsEl._chips.get('https://a.com');
      expect(chip.status).toBe('errored');
      expect(chip.error).toBe('HTTP 404 Not Found');
      expect(toastListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });

  it('chip transitions through fetching state before fetched', async () => {
    let resolveFetch;
    const detect = vi
      .fn()
      .mockResolvedValue([
        { url: 'https://a.com', type: 'generic', display_name: 'a' },
      ]);
    const fetchUrl = vi.fn(
      () => new Promise((r) => { resolveFetch = r; }),
    );
    publishFakeRpc({
      'LLMService.detect_urls': detect,
      'LLMService.fetch_url': fetchUrl,
    });
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'https://a.com';
    ta.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 350));
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    const fetchBtn = chipsEl.shadowRoot.querySelector(
      '.chip-button.primary',
    );
    fetchBtn.click();
    await settle(p);
    expect(chipsEl._chips.get('https://a.com').status).toBe('fetching');
    resolveFetch({
      url: 'https://a.com',
      url_type: 'generic',
      content: 'body',
    });
    await settle(p);
    expect(chipsEl._chips.get('https://a.com').status).toBe('fetched');
  });
});

// ---------------------------------------------------------------------------
// URL chip remove
// ---------------------------------------------------------------------------

describe('ChatPanel URL chip remove', () => {
  it('calls remove_fetched_url and removes chip optimistically', async () => {
    const remove = vi.fn().mockResolvedValue({ removed: true });
    publishFakeRpc({
      'LLMService.detect_urls': vi.fn().mockResolvedValue([]),
      'LLMService.remove_fetched_url': remove,
    });
    const p = mountPanel();
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://a.com', type: 'generic', display_name: 'a' },
    ]);
    chipsEl.markFetched('https://a.com', { content: 'body' });
    await settle(p);
    const removeBtn = chipsEl.shadowRoot.querySelector(
      '.chip.fetched .chip-button',
    );
    removeBtn.click();
    await settle(p);
    expect(chipsEl._chips.size).toBe(0);
    expect(remove).toHaveBeenCalledWith('https://a.com');
  });

  it('RPC failure does not restore the chip', async () => {
    // Optimistic remove stays — user clicked, they want
    // it gone.
    const remove = vi
      .fn()
      .mockRejectedValue(new Error('server down'));
    publishFakeRpc({
      'LLMService.detect_urls': vi.fn().mockResolvedValue([]),
      'LLMService.remove_fetched_url': remove,
    });
    const debugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => {});
    try {
      const p = mountPanel();
      await settle(p);
      const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
      chipsEl.updateDetected([
        { url: 'https://a.com', type: 'generic', display_name: 'a' },
      ]);
      chipsEl.markFetched('https://a.com', { content: 'body' });
      await settle(p);
      chipsEl.shadowRoot
        .querySelector('.chip.fetched .chip-button')
        .click();
      await settle(p);
      expect(chipsEl._chips.size).toBe(0);
    } finally {
      debugSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// URL chip view dialog
// ---------------------------------------------------------------------------

describe('ChatPanel URL chip view dialog', () => {
  it('opens dialog with cached content on view event', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://a.com', type: 'generic', display_name: 'a' },
    ]);
    const content = {
      url: 'https://a.com',
      title: 'Example Title',
      content: 'body text here',
    };
    chipsEl.markFetched('https://a.com', content);
    await settle(p);
    const label = chipsEl.shadowRoot.querySelector(
      '.chip.fetched .chip-label',
    );
    label.click();
    await settle(p);
    expect(p._urlViewDialog).toEqual({
      url: 'https://a.com',
      content,
    });
    const dialog = p.shadowRoot.querySelector('.url-view-dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Example Title');
    expect(dialog.textContent).toContain('body text here');
  });

  it('falls back to get_url_content when chip content missing', async () => {
    const getContent = vi.fn().mockResolvedValue({
      url: 'https://a.com',
      title: 'Fetched Title',
      content: 'fetched body',
    });
    publishFakeRpc({
      'LLMService.get_url_content': getContent,
    });
    const p = mountPanel();
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://a.com', type: 'generic', display_name: 'a' },
    ]);
    chipsEl._chips.set('https://a.com', {
      url: 'https://a.com',
      type: 'generic',
      displayName: 'a',
      status: 'fetched',
      content: null,
      excluded: false,
    });
    await settle(p);
    const label = chipsEl.shadowRoot.querySelector(
      '.chip.fetched .chip-label',
    );
    label.click();
    await settle(p);
    expect(getContent).toHaveBeenCalledWith('https://a.com');
    expect(p._urlViewDialog.content.title).toBe('Fetched Title');
  });

  it('body priority: summary > readme > content', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://a.com', type: 'generic', display_name: 'a' },
    ]);
    chipsEl.markFetched('https://a.com', {
      url: 'https://a.com',
      summary: 'summary text',
      readme: 'readme text',
      content: 'content text',
    });
    await settle(p);
    chipsEl.shadowRoot
      .querySelector('.chip.fetched .chip-label')
      .click();
    await settle(p);
    const body = p.shadowRoot.querySelector('.url-view-dialog pre');
    expect(body.textContent).toContain('summary text');
    expect(body.textContent).not.toContain('readme text');
  });

  it('renders symbol map when present', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      {
        url: 'https://github.com/a/b',
        type: 'github_repo',
        display_name: 'a/b',
      },
    ]);
    chipsEl.markFetched('https://github.com/a/b', {
      url: 'https://github.com/a/b',
      content: 'readme body',
      symbol_map: '# Symbol map content\nclass Foo',
    });
    await settle(p);
    chipsEl.shadowRoot
      .querySelector('.chip.fetched .chip-label')
      .click();
    await settle(p);
    const dialog = p.shadowRoot.querySelector('.url-view-dialog');
    expect(dialog.textContent).toContain('Symbol Map');
    const tabs = dialog.querySelectorAll('[role="tab"]');
    const symbolsTab = Array.from(tabs).find(
      (t) => t.textContent.trim() === 'Symbol Map',
    );
    expect(symbolsTab).toBeTruthy();
    symbolsTab.click();
    await settle(p);
    expect(dialog.textContent).toContain('class Foo');
  });

  it('Escape closes the dialog', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://a.com', type: 'generic', display_name: 'a' },
    ]);
    chipsEl.markFetched('https://a.com', { content: 'body' });
    await settle(p);
    chipsEl.shadowRoot
      .querySelector('.chip.fetched .chip-label')
      .click();
    await settle(p);
    expect(p._urlViewDialog).not.toBeNull();
    const backdrop = p.shadowRoot.querySelector(
      '.lightbox-backdrop[aria-label="URL content viewer"]',
    );
    backdrop.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }),
    );
    await settle(p);
    expect(p._urlViewDialog).toBeNull();
  });

  it('backdrop click closes the dialog', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://a.com', type: 'generic', display_name: 'a' },
    ]);
    chipsEl.markFetched('https://a.com', { content: 'body' });
    await settle(p);
    chipsEl.shadowRoot
      .querySelector('.chip.fetched .chip-label')
      .click();
    await settle(p);
    const backdrop = p.shadowRoot.querySelector(
      '.lightbox-backdrop[aria-label="URL content viewer"]',
    );
    backdrop.click();
    await settle(p);
    expect(p._urlViewDialog).toBeNull();
  });

  it('close button closes the dialog', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://a.com', type: 'generic', display_name: 'a' },
    ]);
    chipsEl.markFetched('https://a.com', { content: 'body' });
    await settle(p);
    chipsEl.shadowRoot
      .querySelector('.chip.fetched .chip-label')
      .click();
    await settle(p);
    const buttons = p.shadowRoot.querySelectorAll(
      '.url-view-dialog .lightbox-button',
    );
    const close = Array.from(buttons).find((b) =>
      b.textContent.includes('Close'),
    );
    expect(close).toBeTruthy();
    close.click();
    await settle(p);
    expect(p._urlViewDialog).toBeNull();
  });

  it('click inside dialog content does not close', async () => {
    publishFakeRpc({});
    const p = mountPanel();
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://a.com', type: 'generic', display_name: 'a' },
    ]);
    chipsEl.markFetched('https://a.com', { content: 'body' });
    await settle(p);
    chipsEl.shadowRoot
      .querySelector('.chip.fetched .chip-label')
      .click();
    await settle(p);
    p.shadowRoot.querySelector('.url-view-dialog pre').click();
    await settle(p);
    expect(p._urlViewDialog).not.toBeNull();
  });

  it('fallback RPC failure emits error toast', async () => {
    const getContent = vi
      .fn()
      .mockRejectedValue(new Error('server error'));
    publishFakeRpc({
      'LLMService.get_url_content': getContent,
    });
    const p = mountPanel();
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://a.com', type: 'generic', display_name: 'a' },
    ]);
    chipsEl._chips.set('https://a.com', {
      url: 'https://a.com',
      type: 'generic',
      displayName: 'a',
      status: 'fetched',
      content: null,
      excluded: false,
    });
    await settle(p);
    const toastListener = vi.fn();
    window.addEventListener('ac-toast', toastListener);
    try {
      chipsEl.shadowRoot
        .querySelector('.chip.fetched .chip-label')
        .click();
      await settle(p);
      expect(p._urlViewDialog).toBeNull();
      const errorToasts = toastListener.mock.calls
        .map((c) => c[0].detail)
        .filter((d) => d.type === 'error');
      expect(errorToasts.length).toBeGreaterThan(0);
      expect(errorToasts[0].message).toContain('server error');
    } finally {
      window.removeEventListener('ac-toast', toastListener);
    }
  });
});

// ---------------------------------------------------------------------------
// URL chip lifecycle integration
// ---------------------------------------------------------------------------

describe('ChatPanel URL chip lifecycle', () => {
  it('session-changed clears all chips', async () => {
    publishFakeRpc({
      'LLMService.detect_urls': vi.fn().mockResolvedValue([]),
    });
    const p = mountPanel();
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://a.com', type: 'generic', display_name: 'a' },
      { url: 'https://b.com', type: 'generic', display_name: 'b' },
    ]);
    chipsEl.markFetched('https://a.com', { content: 'body' });
    await settle(p);
    expect(chipsEl._chips.size).toBe(2);
    pushEvent('session-changed', {
      session_id: 'sess_new',
      messages: [],
    });
    await settle(p);
    expect(chipsEl._chips.size).toBe(0);
  });

  it('send clears detected/fetching but preserves fetched', async () => {
    const started = vi.fn().mockResolvedValue({ status: 'started' });
    publishFakeRpc({
      'LLMService.detect_urls': vi.fn().mockResolvedValue([]),
      'LLMService.chat_streaming': started,
    });
    const p = mountPanel();
    await settle(p);
    const chipsEl = p.shadowRoot.querySelector('ac-url-chips');
    chipsEl.updateDetected([
      { url: 'https://detected.com', type: 'generic', display_name: 'd' },
      { url: 'https://fetched.com', type: 'generic', display_name: 'f' },
      { url: 'https://errored.com', type: 'generic', display_name: 'e' },
    ]);
    chipsEl.markFetched('https://fetched.com', { content: 'body' });
    chipsEl.markErrored('https://errored.com', 'failed');
    await settle(p);
    expect(chipsEl._chips.size).toBe(3);
    p._input = 'hello';
    await p._send();
    await settle(p);
    expect(chipsEl._chips.has('https://detected.com')).toBe(false);
    expect(chipsEl._chips.has('https://fetched.com')).toBe(true);
    expect(chipsEl._chips.has('https://errored.com')).toBe(true);
  });

  it('debounce timer cleared on disconnect', async () => {
    const detect = vi.fn().mockResolvedValue([]);
    publishFakeRpc({ 'LLMService.detect_urls': detect });
    const p = mountPanel();
    await settle(p);
    const ta = p.shadowRoot.querySelector('.input-textarea');
    ta.value = 'https://a.com';
    ta.dispatchEvent(new Event('input'));
    expect(p._urlDetectDebounceTimer).not.toBeNull();
    p.remove();
    await new Promise((r) => setTimeout(r, 350));
    expect(detect).not.toHaveBeenCalled();
  });
});