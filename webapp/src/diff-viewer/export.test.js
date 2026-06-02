import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beforeEachSetup,
  mountViewer,
  setFakeRpc,
  settle,
} from './test-helpers.js';
import {
  buildExportHtml,
  copyPreviewAsHtml,
  exportPreviewAsHtml,
} from './export.js';

beforeEach(beforeEachSetup);

async function openMarkdownInPreview(el, path = 'README.md', body = '# Hello\n\nBody') {
  setFakeRpc({
    'Repo.get_file_content': vi.fn(async () => body),
  });
  await el.openFile({ path });
  await settle(el);
  el.shadowRoot.querySelector('.preview-button').click();
  await settle(el);
}

describe('buildExportHtml', () => {
  it('rejects when no markdown file is open', async () => {
    const el = mountViewer();
    await settle(el);
    await expect(buildExportHtml(el)).rejects.toThrow();
  });

  it('rejects when active file is not markdown', async () => {
    const el = mountViewer();
    await settle(el);
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x = 1'),
    });
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    await expect(buildExportHtml(el)).rejects.toThrow();
  });

  it('returns a self-contained HTML document', async () => {
    const el = mountViewer();
    await settle(el);
    await openMarkdownInPreview(el);
    const { html } = await buildExportHtml(el);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html');
    expect(html).toContain('<head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</html>');
  });

  it('includes the rendered markdown body', async () => {
    const el = mountViewer();
    await settle(el);
    await openMarkdownInPreview(
      el,
      'doc.md',
      '# Hello\n\nBody text\n',
    );
    const { html } = await buildExportHtml(el);
    expect(html).toContain('<h1');
    expect(html).toContain('Hello');
    expect(html).toContain('Body text');
  });

  it('inlines KaTeX CSS into a single style tag', async () => {
    const el = mountViewer();
    await settle(el);
    await openMarkdownInPreview(el);
    const { html } = await buildExportHtml(el);
    // Single <style> block in <head>; both KaTeX text
    // (or sentinel under vitest) and minimal CSS in it.
    const styleMatches = html.match(/<style>/g) || [];
    expect(styleMatches.length).toBe(1);
    expect(html).toContain('font-family');
  });

  it('escapes the title from the file path', async () => {
    const el = mountViewer();
    await settle(el);
    await openMarkdownInPreview(
      el,
      'docs/<weird>.md',
      '# Hi',
    );
    const { html } = await buildExportHtml(el);
    expect(html).toContain('<title>docs/&lt;weird&gt;.md</title>');
  });

  it('reports unresolved relative image references', async () => {
    const el = mountViewer();
    await settle(el);
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '# H'),
    });
    await el.openFile({ path: 'doc.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    // Inject an unresolved <img> directly into the
    // preview pane to simulate a relative ref the
    // resolver couldn't fetch.
    const pane = el.shadowRoot.querySelector('.preview-pane');
    pane.innerHTML += '<img src="missing/pic.png" alt="x">';
    const { unresolvedImages } = await buildExportHtml(el);
    expect(unresolvedImages).toContain('missing/pic.png');
  });

  it('does not flag absolute or data-URI images', async () => {
    const el = mountViewer();
    await settle(el);
    await openMarkdownInPreview(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    pane.innerHTML +=
      '<img src="https://example.com/x.png">' +
      '<img src="data:image/png;base64,AAAA">';
    const { unresolvedImages } = await buildExportHtml(el);
    expect(unresolvedImages).toEqual([]);
  });
});

describe('exportPreviewAsHtml', () => {
  let createObjectURL;
  let revokeObjectURL;
  let anchorClicks;

  beforeEach(() => {
    createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock');
    revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});
    anchorClicks = [];
    // Stub anchor.click() globally — jsdom's default
    // implementation is a no-op, but we want to assert
    // it was invoked with the right href/download.
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(
      (tag) => {
        const el = realCreate(tag);
        if (tag === 'a') {
          el.click = vi.fn(() => {
            anchorClicks.push({
              href: el.href,
              download: el.download,
            });
          });
        }
        return el;
      },
    );
  });

  it('returns ok with default filename for .md', async () => {
    const el = mountViewer();
    await settle(el);
    await openMarkdownInPreview(el, 'README.md');
    const result = await exportPreviewAsHtml(el);
    expect(result.ok).toBe(true);
    expect(result.filename).toBe('README.html');
    expect(anchorClicks).toHaveLength(1);
    expect(anchorClicks[0].download).toBe('README.html');
    expect(createObjectURL).toHaveBeenCalled();
  });

  it('substitutes .markdown extension', async () => {
    const el = mountViewer();
    await settle(el);
    await openMarkdownInPreview(el, 'docs/spec.markdown');
    const result = await exportPreviewAsHtml(el);
    expect(result.filename).toBe('spec.html');
  });

  it('falls back when no file is open', async () => {
    const el = mountViewer();
    await settle(el);
    const result = await exportPreviewAsHtml(el);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/markdown/i);
  });
});

describe('copyPreviewAsHtml', () => {
  it('writes rich clipboard when API available', async () => {
    const el = mountViewer();
    await settle(el);
    await openMarkdownInPreview(el);
    const writes = [];
    globalThis.ClipboardItem = function (data) {
      this.data = data;
    };
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: vi.fn(async (items) => {
          writes.push(items);
        }),
      },
    });
    try {
      const result = await copyPreviewAsHtml(el);
      expect(result.ok).toBe(true);
      expect(result.mode).toBe('rich');
      expect(writes).toHaveLength(1);
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
      delete globalThis.ClipboardItem;
    }
  });

  it('falls back to writeText when ClipboardItem missing', async () => {
    const el = mountViewer();
    await settle(el);
    await openMarkdownInPreview(el);
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    delete globalThis.ClipboardItem;
    try {
      const result = await copyPreviewAsHtml(el);
      expect(result.ok).toBe(true);
      expect(result.mode).toBe('plain');
      expect(writeText).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    }
  });
});

describe('export menu UI', () => {
  it('appears only in preview mode', async () => {
    const el = mountViewer();
    await settle(el);
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '# H'),
    });
    await el.openFile({ path: 'README.md' });
    await settle(el);
    expect(
      el.shadowRoot.querySelector('.preview-button-chevron'),
    ).toBeNull();
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    expect(
      el.shadowRoot.querySelector('.preview-button-chevron'),
    ).toBeTruthy();
  });

  it('toggles dropdown on chevron click', async () => {
    const el = mountViewer();
    await settle(el);
    await openMarkdownInPreview(el);
    expect(
      el.shadowRoot.querySelector('.export-menu'),
    ).toBeNull();
    el.shadowRoot
      .querySelector('.preview-button-chevron')
      .click();
    await settle(el);
    expect(
      el.shadowRoot.querySelector('.export-menu'),
    ).toBeTruthy();
    el.shadowRoot
      .querySelector('.preview-button-chevron')
      .click();
    await settle(el);
    expect(
      el.shadowRoot.querySelector('.export-menu'),
    ).toBeNull();
  });

  it('main button still toggles preview off', async () => {
    const el = mountViewer();
    await settle(el);
    await openMarkdownInPreview(el);
    // Sanity: in split mode, .preview-button-main is the
    // exit-preview button. Click it.
    el.shadowRoot
      .querySelector('.preview-button-main')
      .click();
    await settle(el);
    expect(el._previewMode).toBe(false);
    expect(el.shadowRoot.querySelector('.split-root')).toBeNull();
  });

  it('renders both menu items', async () => {
    const el = mountViewer();
    await settle(el);
    await openMarkdownInPreview(el);
    el.shadowRoot
      .querySelector('.preview-button-chevron')
      .click();
    await settle(el);
    const items = el.shadowRoot.querySelectorAll(
      '.export-menu-item',
    );
    expect(items.length).toBe(2);
    expect(items[0].textContent).toMatch(/Export as HTML/);
    expect(items[1].textContent).toMatch(/Copy as HTML/);
  });

  it('does not appear for non-markdown files', async () => {
    const el = mountViewer();
    await settle(el);
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x = 1'),
    });
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    // No preview button at all for .py.
    expect(
      el.shadowRoot.querySelector('.preview-button-chevron'),
    ).toBeNull();
  });
});