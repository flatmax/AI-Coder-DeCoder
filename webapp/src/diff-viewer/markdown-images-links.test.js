import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountViewer, settle, setFakeRpc, monacoState, beforeEachSetup } from './test-helpers.js';

beforeEach(beforeEachSetup);

describe('DiffViewer markdown preview — image resolution', () => {
  /**
   * Enter preview mode on a markdown file with a known
   * body. The body param becomes both HEAD and working
   * copy so the diff is clean and the preview pane shows
   * the modified side's content.
   */
  async function enterPreviewWith(el, body, path = 'docs/README.md') {
    // Configure RPC to return the body for the markdown
    // file and image bytes for any relative image path.
    await el.openFile({ path });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
  }

  it('leaves absolute URLs untouched', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => {
        return '![alt](https://example.com/x.png)';
      }),
      'Repo.get_file_base64': vi.fn(),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '');
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    const img = pane.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://example.com/x.png');
    // Never called for absolute URLs.
    expect(
      globalThis.__sharedRpcOverride['Repo.get_file_base64'],
    ).not.toHaveBeenCalled();
  });

  it('leaves data URIs untouched', async () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => `![x](${dataUri})`),
      'Repo.get_file_base64': vi.fn(),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '');
    await settle(el);
    const img = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('img');
    expect(img.getAttribute('src')).toBe(dataUri);
    expect(
      globalThis.__sharedRpcOverride['Repo.get_file_base64'],
    ).not.toHaveBeenCalled();
  });

  it('resolves relative raster images via get_file_base64', async () => {
    const base64Fn = vi.fn(async (path) => ({
      data_uri: `data:image/png;base64,FAKE_${path}`,
    }));
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '![logo](logo.png)'),
      'Repo.get_file_base64': base64Fn,
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'docs/README.md');
    // Give the async resolve a chance to complete.
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // Path resolves against docs/README.md's directory →
    // docs/logo.png.
    expect(base64Fn).toHaveBeenCalledWith('docs/logo.png');
    const img = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('img');
    expect(img.getAttribute('src')).toBe(
      'data:image/png;base64,FAKE_docs/logo.png',
    );
  });

  it('resolves relative SVG images via get_file_content with inline encoding', async () => {
    const svgBody = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (path) => {
        if (path.endsWith('.svg')) return svgBody;
        return '![diagram](diagram.svg)';
      }),
      'Repo.get_file_base64': vi.fn(),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'docs/spec.md');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const img = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('img');
    const src = img.getAttribute('src');
    expect(src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(src.split(',')[1])).toBe(svgBody);
    // get_file_base64 never called for SVGs.
    expect(
      globalThis.__sharedRpcOverride['Repo.get_file_base64'],
    ).not.toHaveBeenCalled();
  });

  it('handles parent-directory references', async () => {
    const base64Fn = vi.fn(async () => 'data:image/png;base64,X');
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '![up](../shared/banner.png)',
      ),
      'Repo.get_file_base64': base64Fn,
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'docs/nested/page.md');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // ../shared/banner.png relative to docs/nested/page.md
    // resolves to docs/shared/banner.png.
    expect(base64Fn).toHaveBeenCalledWith('docs/shared/banner.png');
  });

  it('decodes percent-encoded characters before resolving', async () => {
    // _encodeImagePaths turns spaces into %20 before
    // marked parses. The image resolver must undo that
    // for the real filesystem path.
    const base64Fn = vi.fn(async () => 'data:image/png;base64,X');
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '![space](my file.png)',
      ),
      'Repo.get_file_base64': base64Fn,
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'docs/spec.md');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // Must be called with the space, not %20.
    expect(base64Fn).toHaveBeenCalledWith('docs/my file.png');
  });

  it('marks missing images with alt text and dims them', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (path) => {
        if (path.endsWith('.md')) return '![x](missing.png)';
        throw new Error('not found');
      }),
      'Repo.get_file_base64': vi.fn(async () => {
        throw new Error('file not found');
      }),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'docs/spec.md');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const img = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('img');
    // Failed fetch → alt text indicates the problem.
    expect(img.getAttribute('alt')).toMatch(
      /\[Failed to load: docs\/missing\.png/,
    );
    expect(img.style.opacity).toBe('0.4');
  });

  it('marks empty RPC results as missing', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '![x](empty.png)'),
      'Repo.get_file_base64': vi.fn(async () => ''),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'docs/spec.md');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const img = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('img');
    expect(img.getAttribute('alt')).toMatch(
      /\[Image not found: docs\/empty\.png\]/,
    );
  });

  it('resolves multiple images in parallel', async () => {
    let callCount = 0;
    const base64Fn = vi.fn(async (path) => {
      callCount += 1;
      return `data:image/png;base64,FAKE_${path}`;
    });
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '![a](a.png) ![b](b.png) ![c](c.png)',
      ),
      'Repo.get_file_base64': base64Fn,
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'spec.md');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    expect(callCount).toBe(3);
    const imgs = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelectorAll('img');
    expect(imgs[0].getAttribute('src')).toMatch(/a\.png/);
    expect(imgs[1].getAttribute('src')).toMatch(/b\.png/);
    expect(imgs[2].getAttribute('src')).toMatch(/c\.png/);
  });

  it('discards stale fetches when preview updates mid-flight', async () => {
    // Keystroke 1 kicks off a slow fetch; keystroke 2
    // arrives before it resolves and re-renders. The
    // stale fetch's DOM write should be dropped via the
    // generation counter.
    let resolveFirst;
    const base64Fn = vi.fn((path) => {
      if (path.endsWith('slow.png')) {
        return new Promise((r) => {
          resolveFirst = r;
        });
      }
      return Promise.resolve('data:image/png;base64,FAST');
    });
    // Content-content RPC returns the first body; the
    // editor's modified content will drive the second
    // render via _simulateContentChange.
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '![x](slow.png)'),
      'Repo.get_file_base64': base64Fn,
    });
    const el = mountViewer();
    await settle(el);
    await enterPreviewWith(el, '', 'spec.md');
    // Simulate second keystroke — different image now.
    const activeEditor =
      monacoState.editors[monacoState.editors.length - 1];
    activeEditor._simulateContentChange('![y](fast.png)');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // Now resolve the first, slow fetch.
    resolveFirst('data:image/png;base64,SLOW');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // The preview's current img is the fast one and its
    // src should be the fast data URI, not overwritten
    // by the stale slow fetch.
    const img = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('img');
    expect(img.getAttribute('src')).toBe(
      'data:image/png;base64,FAST',
    );
  });
});

describe('DiffViewer markdown preview — link navigation', () => {
  // jsdom logs a "Not implemented: navigation" error on
  // every `.click()` of an anchor with an absolute href.
  // Two tests below deliberately click external links to
  // verify we DON'T preventDefault — the logs are noise.
  // Silence console.error for this block; the test
  // assertions still use defaultPrevented checks so real
  // failures surface as test failures, not log output.
  let _consoleErrorSpy;
  beforeEach(() => {
    _consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
  });
  afterEach(() => {
    _consoleErrorSpy.mockRestore();
  });

  async function enterPreview(el, path = 'docs/README.md') {
    await el.openFile({ path });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
  }

  it('intercepts relative-link clicks and dispatches navigate-file', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '[target](other.md)',
      ),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreview(el, 'docs/README.md');
    // D18: dispatch target is window so the app shell's
    // full navigation pipeline runs (grid registration,
    // collab broadcast, etc). Listening on the element
    // misses the event.
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const anchor = el.shadowRoot
        .querySelector('.preview-pane')
        .querySelector('a');
      expect(anchor).toBeTruthy();
      anchor.click();
      await settle(el);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({
        path: 'docs/other.md',
      });
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('resolves parent-directory links correctly', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '[up](../top.md)',
      ),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreview(el, 'docs/nested/page.md');
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const anchor = el.shadowRoot
        .querySelector('.preview-pane')
        .querySelector('a');
      anchor.click();
      await settle(el);
      expect(listener.mock.calls[0][0].detail.path).toBe(
        'docs/top.md',
      );
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('strips fragment from link before dispatching', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '[sec](other.md#section-2)',
      ),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreview(el, 'docs/README.md');
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      el.shadowRoot
        .querySelector('.preview-pane')
        .querySelector('a')
        .click();
      await settle(el);
      expect(listener.mock.calls[0][0].detail.path).toBe(
        'docs/other.md',
      );
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('ignores absolute http URLs', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '[go](https://example.com/page)',
      ),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreview(el, 'docs/README.md');
    const listener = vi.fn();
    el.addEventListener('navigate-file', listener);
    const anchor = el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('a');
    // Simulate a click — we don't want the default action
    // in the test (no actual navigation), but the handler
    // should not have preventDefault called on it by our
    // code. Verify navigate-file is not dispatched.
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });
    anchor.dispatchEvent(ev);
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
    // preventDefault should not have been called by us.
    expect(ev.defaultPrevented).toBe(false);
  });

  it('ignores fragment-only links', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '[top](#heading)',
      ),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreview(el, 'docs/README.md');
    const listener = vi.fn();
    el.addEventListener('navigate-file', listener);
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });
    el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('a')
      .dispatchEvent(ev);
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('ignores mailto and other scheme URLs', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '[email](mailto:test@example.com)',
      ),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreview(el, 'docs/README.md');
    const listener = vi.fn();
    el.addEventListener('navigate-file', listener);
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });
    el.shadowRoot
      .querySelector('.preview-pane')
      .querySelector('a')
      .dispatchEvent(ev);
    await settle(el);
    expect(listener).not.toHaveBeenCalled();
  });

  it('link listener detaches on preview exit', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '[x](other.md)',
      ),
    });
    const el = mountViewer();
    await settle(el);
    await enterPreview(el, 'docs/README.md');
    // Exit preview.
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    // Re-enter preview on a different file — the old
    // pane's listener should have been detached, not
    // carried over.
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const anchor = el.shadowRoot
        .querySelector('.preview-pane')
        .querySelector('a');
      anchor.click();
      await settle(el);
      // Still fires — the new pane has a new listener.
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });
});