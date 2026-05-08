import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountViewer, settle, setFakeRpc, monacoState, beforeEachSetup } from './test-helpers.js';

beforeEach(beforeEachSetup);

// ---------------------------------------------------------------------------
// Markdown preview (Phase 3.1b Step 2a)
// ---------------------------------------------------------------------------
//
// These tests cover the preview TOGGLE and live update
// behavior. Step 2b will add scroll sync and KaTeX CSS
// injection; Step 2c will add image resolution and link
// navigation. Each of those gets its own describe block
// when landed.

describe('DiffViewer markdown preview — toggle', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (path, ref) => {
        if (ref === 'HEAD') return '# Original';
        return '# Original';
      }),
    });
  });

  it('shows Preview button for markdown files', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    const btn = el.shadowRoot.querySelector('.preview-button');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Preview');
  });

  it('shows Preview button for .markdown files too', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'docs/spec.markdown' });
    await settle(el);
    const btn = el.shadowRoot.querySelector('.preview-button');
    expect(btn).toBeTruthy();
  });

  it('does not show Preview button for non-markdown files', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    const btn = el.shadowRoot.querySelector('.preview-button');
    expect(btn).toBeNull();
  });

  it('does not show Preview button when no file is open', async () => {
    const el = mountViewer();
    await settle(el);
    const btn = el.shadowRoot.querySelector('.preview-button');
    expect(btn).toBeNull();
  });

  it('clicking Preview enters split layout', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    expect(el.shadowRoot.querySelector('.split-root')).toBeNull();
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    expect(el._previewMode).toBe(true);
    expect(
      el.shadowRoot.querySelector('.split-root'),
    ).toBeTruthy();
    expect(
      el.shadowRoot.querySelector('.editor-pane'),
    ).toBeTruthy();
    expect(
      el.shadowRoot.querySelector('.preview-pane'),
    ).toBeTruthy();
  });

  it('clicking Preview again exits split layout', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    // In preview — button is in split area.
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    expect(el._previewMode).toBe(false);
    expect(el.shadowRoot.querySelector('.split-root')).toBeNull();
    expect(
      el.shadowRoot.querySelector('.preview-pane'),
    ).toBeNull();
  });

  it('entering preview rebuilds the editor with inline diff', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    const editorsBeforeToggle = monacoState.editors.length;
    const firstEditor = monacoState.editors[0];
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    // A new editor was created with renderSideBySide: false.
    expect(monacoState.editors.length).toBe(editorsBeforeToggle + 1);
    expect(firstEditor.dispose).toHaveBeenCalled();
    const latestEditor =
      monacoState.editors[monacoState.editors.length - 1];
    expect(latestEditor._constructionOptions.renderSideBySide).toBe(
      false,
    );
  });

  it('exiting preview rebuilds the editor with side-by-side diff', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    // Exit.
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    const latestEditor =
      monacoState.editors[monacoState.editors.length - 1];
    expect(latestEditor._constructionOptions.renderSideBySide).toBe(
      true,
    );
  });
});

describe('DiffViewer markdown preview — rendering', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async (path, ref) => {
        if (ref === 'HEAD') return '# Hello\n\nBody text';
        return '# Hello\n\nBody text';
      }),
    });
  });

  it('populates preview pane on entry', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('<h1');
    expect(pane.innerHTML).toContain('Hello');
    expect(pane.innerHTML).toContain('Body text');
  });

  it('updates preview on content change', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    // Simulate user typing — content changes to a new
    // markdown body.
    const activeEditor =
      monacoState.editors[monacoState.editors.length - 1];
    activeEditor._simulateContentChange(
      '## New heading\n\nnew body',
    );
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toContain('<h2');
    expect(pane.innerHTML).toContain('New heading');
    expect(pane.innerHTML).toContain('new body');
    // Old content is gone.
    expect(pane.innerHTML).not.toContain('Body text');
  });

  it('does not render preview when preview mode is off', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    // Without toggling preview mode.
    const activeEditor = monacoState.editors[0];
    activeEditor._simulateContentChange('# changed');
    await settle(el);
    // No preview pane exists.
    expect(
      el.shadowRoot.querySelector('.preview-pane'),
    ).toBeNull();
  });

  it('preview renders source-line attributes', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    expect(pane.innerHTML).toMatch(/data-source-line="\d+"/);
  });
});

describe('DiffViewer markdown preview — mode handoff', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => 'x'),
    });
  });

  it('switching to a non-markdown file exits preview', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    expect(el._previewMode).toBe(true);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(el._previewMode).toBe(false);
    expect(el.shadowRoot.querySelector('.split-root')).toBeNull();
  });

  it('closing a markdown file with preview resets state', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    expect(el._previewMode).toBe(true);
    el.closeFile('README.md');
    await settle(el);
    expect(el._previewMode).toBe(false);
    expect(el.hasOpenFiles).toBe(false);
  });

  it('re-entering preview on a re-opened markdown file works', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    el.closeFile('README.md');
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    // Not in preview yet — state was reset on close.
    expect(el._previewMode).toBe(false);
    // But the Preview button still shows.
    expect(
      el.shadowRoot.querySelector('.preview-button'),
    ).toBeTruthy();
  });

  it('switching from non-markdown to markdown file does not auto-enter preview', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    expect(el._previewMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Markdown preview (Phase 3.1b Step 2b) — scroll sync + KaTeX CSS
// ---------------------------------------------------------------------------

describe('DiffViewer markdown preview — KaTeX CSS injection', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => '# Hello'),
    });
  });

  it('injects KaTeX stylesheet into shadow root on preview entry', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    // Not yet — CSS is injected as part of style sync,
    // which happens whenever editor is built or rebuilt.
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    const katexStyle = el.shadowRoot.querySelector(
      '[data-ac-dc-katex-css]',
    );
    expect(katexStyle).toBeTruthy();
    expect(katexStyle.tagName).toBe('STYLE');
  });

  it('does not duplicate the KaTeX stylesheet across toggles', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    const all = el.shadowRoot.querySelectorAll(
      '[data-ac-dc-katex-css]',
    );
    expect(all.length).toBe(1);
  });

  it('KaTeX stylesheet survives style re-sync on file switch', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    // Switch away to non-markdown (exits preview), back
    // to markdown, re-enter preview — stylesheet still
    // present.
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    const katexStyle = el.shadowRoot.querySelector(
      '[data-ac-dc-katex-css]',
    );
    expect(katexStyle).toBeTruthy();
  });
});

describe('DiffViewer markdown preview — scroll sync', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(
        async () => '# A\n\nPara1\n\n# B\n\nPara2\n',
      ),
    });
  });

  async function enterPreview(el) {
    await el.openFile({ path: 'README.md' });
    await settle(el);
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
  }

  /**
   * Stub offsetTop/scrollHeight/clientHeight on
   * preview-pane elements so the anchor collection logic
   * produces stable values. jsdom returns 0 for all
   * layout properties.
   */
  function stubPreviewLayout(el, anchorPositions) {
    const pane = el.shadowRoot.querySelector('.preview-pane');
    // Fake scroll container dimensions.
    Object.defineProperty(pane, 'scrollHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(pane, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    // Replace the pane's innerHTML with anchor divs at
    // known source-line positions, each with a stubbed
    // offsetTop.
    pane.innerHTML = anchorPositions
      .map(
        ({ line }) =>
          `<div data-source-line="${line}">line ${line}</div>`,
      )
      .join('');
    const divs = pane.querySelectorAll('[data-source-line]');
    divs.forEach((div, i) => {
      Object.defineProperty(div, 'offsetTop', {
        configurable: true,
        value: anchorPositions[i].offsetTop,
      });
    });
    return pane;
  }

  it('editor scroll triggers preview scroll', async () => {
    const el = mountViewer();
    await settle(el);
    await enterPreview(el);
    stubPreviewLayout(el, [
      { line: 1, offsetTop: 0 },
      { line: 3, offsetTop: 100 },
      { line: 5, offsetTop: 200 },
    ]);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    // Find the editor that's currently in preview mode
    // (last one created).
    const editor =
      monacoState.editors[monacoState.editors.length - 1];
    // Scroll editor to line 3 (scrollTop = (3-1) * 20 = 40).
    editor._simulateScroll(40);
    await settle(el);
    // Preview should scroll to anchor at line 3.
    expect(pane.scrollTop).toBeGreaterThanOrEqual(90);
    expect(pane.scrollTop).toBeLessThanOrEqual(110);
  });

  it('preview scroll triggers editor scroll', async () => {
    const el = mountViewer();
    await settle(el);
    await enterPreview(el);
    stubPreviewLayout(el, [
      { line: 1, offsetTop: 0 },
      { line: 3, offsetTop: 100 },
      { line: 5, offsetTop: 200 },
    ]);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    const editor =
      monacoState.editors[monacoState.editors.length - 1];
    // Scroll preview to offsetTop 100 (line 3).
    pane.scrollTop = 100;
    pane.dispatchEvent(new Event('scroll'));
    await settle(el);
    // Editor should scroll toward line 3: (3-1) * 20 = 40.
    expect(editor._scrollTop).toBeGreaterThanOrEqual(30);
    expect(editor._scrollTop).toBeLessThanOrEqual(50);
  });

  it('scroll sync mutex prevents feedback loops', async () => {
    // After editor-initiated preview scroll, a follow-up
    // scroll event on the preview pane should NOT cause
    // the editor to scroll again. Without the lock the
    // two sides would ping-pong indefinitely.
    const el = mountViewer();
    await settle(el);
    await enterPreview(el);
    stubPreviewLayout(el, [
      { line: 1, offsetTop: 0 },
      { line: 5, offsetTop: 200 },
    ]);
    const pane = el.shadowRoot.querySelector('.preview-pane');
    const editor =
      monacoState.editors[monacoState.editors.length - 1];
    // Editor initiates scroll.
    editor._simulateScroll(80);
    await settle(el);
    const editorScrollAfterFirst = editor._scrollTop;
    // Preview's scroll handler fires — but the lock
    // prevents it from pushing scroll back.
    pane.dispatchEvent(new Event('scroll'));
    await settle(el);
    // Editor's scroll position is unchanged (lock held).
    expect(editor._scrollTop).toBe(editorScrollAfterFirst);
  });

  it('scroll sync does nothing when preview mode is off', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    // Preview NOT entered.
    const editor = monacoState.editors[0];
    // Scroll listener should not have been attached;
    // simulate scroll is a no-op for sync.
    editor._simulateScroll(100);
    await settle(el);
    // No preview pane to check, so the test verifies
    // that no error is thrown and the editor keeps its
    // scroll value.
    expect(editor._scrollTop).toBe(100);
  });

  it('exiting preview detaches scroll listeners', async () => {
    const el = mountViewer();
    await settle(el);
    await enterPreview(el);
    const editorBeforeExit =
      monacoState.editors[monacoState.editors.length - 1];
    expect(editorBeforeExit._scrollListeners.length).toBe(1);
    // Exit preview.
    el.shadowRoot.querySelector('.preview-button').click();
    await settle(el);
    // A new editor was built on toggle — the old one's
    // listener is disposed when we dispose that editor.
    // Check that the new editor has no scroll listener
    // (preview is off).
    const editorAfterExit =
      monacoState.editors[monacoState.editors.length - 1];
    expect(editorAfterExit._scrollListeners.length).toBe(0);
  });
});