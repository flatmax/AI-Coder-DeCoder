import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountViewer, settle, setFakeRpc, monacoState, beforeEachSetup } from './test-helpers.js';

beforeEach(beforeEachSetup);

describe('DiffViewer TeX preview — preview button', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '\\section{x}'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': vi.fn(async () => ({
        html: '<h1>X</h1>',
      })),
    });
  });

  it('shows Preview button for .tex files', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    const btn = el.shadowRoot.querySelector('.preview-button');
    expect(btn).toBeTruthy();
  });

  it('shows Preview button for .latex files too', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.latex' });
    await settle(el);
    expect(
      el.shadowRoot.querySelector('.preview-button'),
    ).toBeTruthy();
  });

  it('does not show Preview button for non-previewable files', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(
      el.shadowRoot.querySelector('.preview-button'),
    ).toBeNull();
  });
});

describe('DiffViewer TeX preview — compilation flow', () => {
  it('probes availability on preview entry', async () => {
    const probeFn = vi.fn(async () => ({ available: true }));
    const compileFn = vi.fn(async () => ({ html: '<h1>X</h1>' }));
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '\\section{x}'),
      'Repo.is_tex_preview_available': probeFn,
      'Repo.compile_tex_preview': compileFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    // Wait for probe + compile.
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    expect(probeFn).toHaveBeenCalledOnce();
    expect(compileFn).toHaveBeenCalledOnce();
  });

  it('caches availability across multiple files', async () => {
    const probeFn = vi.fn(async () => ({ available: true }));
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '\\section{x}'),
      'Repo.is_tex_preview_available': probeFn,
      'Repo.compile_tex_preview': vi.fn(async () => ({
        html: '<h1>X</h1>',
      })),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // Switch to another .tex file. Should reuse cached
    // availability result — no new probe call.
    await el.openFile({ path: 'b.tex' });
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    expect(probeFn).toHaveBeenCalledTimes(1);
  });

  it('renders install hint when make4ht is unavailable', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '\\section{x}'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: false,
        install_hint:
          'Install TeX Live from https://www.tug.org/texlive/',
      })),
      'Repo.compile_tex_preview': vi.fn(),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('tex-preview-install-hint');
    expect(pane.innerHTML).toContain('TeX Live');
    // Compile RPC should not have been called.
    expect(
      globalThis.__sharedRpcOverride['Repo.compile_tex_preview'],
    ).not.toHaveBeenCalled();
  });

  it('renders compiled HTML on successful compile', async () => {
    const html = '<h2 class="sectionHead">Intro</h2><p>Body.</p>';
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '\\section{Intro}\n\nBody.'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': vi.fn(async () => ({ html })),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('Intro');
    expect(pane.innerHTML).toContain('Body.');
  });

  it('applies data-source-line attributes from anchors', async () => {
    const html = '<h2 class="sectionHead">Heading</h2><p>Text.</p>';
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '\\section{Heading}\n\nText.',
      ),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': vi.fn(async () => ({ html })),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toMatch(/data-source-line="\d+"/);
  });

  it('renders error block on compile failure', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '\\section{x}'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': vi.fn(async () => ({
        error: 'LaTeX Error: Missing } at line 5',
        log: 'Some log output',
      })),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('tex-preview-error');
    expect(pane.innerHTML).toContain('Missing');
    // Log details rendered.
    expect(pane.innerHTML).toContain('tex-preview-log');
    expect(pane.innerHTML).toContain('Some log output');
  });

  it('escapes HTML in error messages', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': vi.fn(async () => ({
        error: 'Unclosed <tag> in source',
      })),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('Unclosed &lt;tag&gt;');
    expect(pane.innerHTML).not.toContain('Unclosed <tag>');
  });
});

describe('DiffViewer TeX preview — save-triggered compilation', () => {
  it('does not recompile on keystroke (live-update gate)', async () => {
    const compileFn = vi.fn(async () => ({ html: '<h1>X</h1>' }));
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'original'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': compileFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // One compile on preview entry.
    expect(compileFn).toHaveBeenCalledTimes(1);
    // Simulate keystrokes — many content changes.
    const editor =
      monacoState.editors[monacoState.editors.length - 1];
    editor._simulateContentChange('edited 1');
    await settle(el);
    editor._simulateContentChange('edited 2');
    await settle(el);
    editor._simulateContentChange('edited 3');
    await settle(el);
    // Still only the initial compile.
    expect(compileFn).toHaveBeenCalledTimes(1);
  });

  it('recompiles on save', async () => {
    const compileFn = vi.fn(async () => ({ html: '<h1>X</h1>' }));
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'original'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': compileFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // Edit + save.
    const editor =
      monacoState.editors[monacoState.editors.length - 1];
    editor._simulateContentChange('edited');
    await settle(el);
    await el._saveFile('paper.tex');
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // Second compile fired.
    expect(compileFn).toHaveBeenCalledTimes(2);
    // Second call has the edited content.
    expect(compileFn.mock.calls[1][0]).toBe('edited');
  });

  it('save on non-TeX file in preview does not call compile', async () => {
    const compileFn = vi.fn(async () => ({ html: '<h1>X</h1>' }));
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'markdown'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': compileFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    await el._saveFile('README.md');
    await new Promise((r) => setTimeout(r, 10));
    expect(compileFn).not.toHaveBeenCalled();
  });
});

describe('DiffViewer TeX preview — file switching', () => {
  it('recompiles on switch-back (no-cache contract)', async () => {
    // D18: no per-file cache means switching back to a
    // previously-open .tex file triggers a fresh
    // compile. Users accepting no-cache accept this
    // tradeoff for .tex too.
    const htmlA = '<h1>File A content</h1>';
    const htmlB = '<h1>File B content</h1>';
    const compileFn = vi.fn(async (content, path) => ({
      html: path === 'a.tex' ? htmlA : htmlB,
    }));
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': compileFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // Switch to b.tex — triggers compile for b.
    await el.openFile({ path: 'b.tex' });
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    let pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('File B content');
    // Switch back to a.tex — the openFile's fresh fetch
    // plus preview mode carrying over triggers a new
    // compile.
    const callsBeforeSwitchBack = compileFn.mock.calls.length;
    await el.openFile({ path: 'a.tex' });
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('File A content');
    // At least one more compile fired for a.tex on
    // switch-back. Not two strict equals because the
    // availability probe is cached so we don't double-
    // count it.
    expect(compileFn.mock.calls.length).toBeGreaterThan(
      callsBeforeSwitchBack,
    );
  });

  it('closing a file clears tex compile state', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
      'Repo.is_tex_preview_available': vi.fn(async () => ({
        available: true,
      })),
      'Repo.compile_tex_preview': vi.fn(async () => ({
        html: '<h1>X</h1>',
      })),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'paper.tex' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await new Promise((r) => setTimeout(r, 10));
    await settle(el);
    // State lives on _file.texCompile in the single-
    // file model.
    expect(el._file?.texCompile).toBeTruthy();
    el.closeFile('paper.tex');
    await settle(el);
    expect(el._file).toBe(null);
  });
});