import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountViewer, settle, setFakeRpc, clearFakeRpc, monacoState, beforeEachSetup } from './test-helpers.js';

beforeEach(beforeEachSetup);

// ---------------------------------------------------------------------------
// LSP integration (Phase 3.1d)
// ---------------------------------------------------------------------------

describe('DiffViewer LSP integration', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => ''),
    });
  });

  it('installs all four LSP providers on first editor build', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(monacoState.lspProviders.hover).toHaveLength(1);
    expect(monacoState.lspProviders.definition).toHaveLength(1);
    expect(monacoState.lspProviders.reference).toHaveLength(1);
    expect(monacoState.lspProviders.completion).toHaveLength(1);
  });

  it('uses wildcard selector for all providers', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(monacoState.lspProviders.hover[0].selector).toBe('*');
    expect(monacoState.lspProviders.definition[0].selector).toBe(
      '*',
    );
    expect(monacoState.lspProviders.reference[0].selector).toBe('*');
    expect(monacoState.lspProviders.completion[0].selector).toBe(
      '*',
    );
  });

  it('does not re-register providers on file switch', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    await el.openFile({ path: 'src/other.py' });
    await settle(el);
    // Idempotent — still only one registration per type.
    expect(monacoState.lspProviders.hover).toHaveLength(1);
    expect(monacoState.lspProviders.definition).toHaveLength(1);
    expect(monacoState.lspProviders.reference).toHaveLength(1);
    expect(monacoState.lspProviders.completion).toHaveLength(1);
  });

  it('hover provider dispatches to active file path', async () => {
    const hoverFn = vi.fn().mockResolvedValue({
      contents: 'def main() -> None',
    });
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => ''),
      'LLMService.lsp_get_hover': hoverFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    const provider = monacoState.lspProviders.hover[0].provider;
    const result = await provider.provideHover(
      { uri: { path: '/inmemory/model' } },
      { lineNumber: 10, column: 5 },
    );
    expect(hoverFn).toHaveBeenCalledWith('src/main.py', 10, 5);
    expect(result).toEqual({
      contents: [{ value: 'def main() -> None' }],
    });
  });

  it('hover provider reflects file switches', async () => {
    const hoverFn = vi.fn().mockResolvedValue({
      contents: 'x',
    });
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => ''),
      'LLMService.lsp_get_hover': hoverFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/first.py' });
    await settle(el);
    await el.openFile({ path: 'src/second.py' });
    await settle(el);
    // Same provider instance (registered once), but the
    // callbacks read current state at invocation time.
    const provider = monacoState.lspProviders.hover[0].provider;
    await provider.provideHover(
      { uri: { path: '/inmemory/model' } },
      { lineNumber: 1, column: 1 },
    );
    // Should have used the new active file's path.
    expect(hoverFn).toHaveBeenCalledWith('src/second.py', 1, 1);
  });

  it('hover provider returns null when no RPC available', async () => {
    // No get_file_content or lsp_get_hover in the fake
    // RPC — simulates the hover method simply being
    // absent on the proxy.
    clearFakeRpc();
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    const provider = monacoState.lspProviders.hover[0].provider;
    const result = await provider.provideHover(
      { uri: { path: '/inmemory/model' } },
      { lineNumber: 1, column: 1 },
    );
    // No RPC proxy at all — provider returns null cleanly.
    expect(result).toBe(null);
  });

  it('definition provider builds cross-file location', async () => {
    const defFn = vi.fn().mockResolvedValue({
      file: 'src/other.py',
      range: {
        startLineNumber: 10,
        startColumn: 1,
        endLineNumber: 10,
        endColumn: 8,
      },
    });
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => ''),
      'LLMService.lsp_get_definition': defFn,
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    const provider =
      monacoState.lspProviders.definition[0].provider;
    const result = await provider.provideDefinition(
      { uri: { path: '/inmemory/model' } },
      { lineNumber: 5, column: 12 },
    );
    expect(defFn).toHaveBeenCalledWith('src/main.py', 5, 12);
    expect(result.uri.path).toBe('/src/other.py');
    expect(result.range.startLineNumber).toBe(10);
  });

  it('references provider returns empty for null result', async () => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => ''),
      'LLMService.lsp_get_references': vi.fn(async () => null),
    });
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    const provider =
      monacoState.lspProviders.reference[0].provider;
    const result = await provider.provideReferences(
      { uri: { path: '/inmemory/model' } },
      { lineNumber: 1, column: 1 },
    );
    expect(result).toEqual([]);
  });

  it('completion provider returns empty suggestions when no path', async () => {
    const el = mountViewer();
    await settle(el);
    // No file opened — active path is empty.
    // But the provider is registered on first editor
    // build, and editor only builds on openFile. So
    // install providers manually by opening and then
    // closing a file.
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    el.closeFile('src/main.py');
    await settle(el);
    // Now providers exist but active path is empty.
    const provider =
      monacoState.lspProviders.completion[0].provider;
    const result = await provider.provideCompletionItems(
      { uri: { path: '/inmemory/model' }, getWordUntilPosition: () => null },
      { lineNumber: 1, column: 1 },
    );
    expect(result).toEqual({ suggestions: [] });
  });

  it('providers survive viewer disposal and reuse', async () => {
    // Install guard prevents re-registration. After
    // opening then closing files repeatedly, the
    // provider count stays at 1 each.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'a.py' });
    await settle(el);
    el.closeFile('a.py');
    await settle(el);
    await el.openFile({ path: 'b.py' });
    await settle(el);
    el.closeFile('b.py');
    await settle(el);
    await el.openFile({ path: 'c.py' });
    await settle(el);
    expect(monacoState.lspProviders.hover).toHaveLength(1);
    expect(monacoState.lspProviders.definition).toHaveLength(1);
    expect(monacoState.lspProviders.reference).toHaveLength(1);
    expect(monacoState.lspProviders.completion).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Markdown link provider (Phase 3.1e)
// ---------------------------------------------------------------------------

describe('DiffViewer markdown link provider', () => {
  beforeEach(() => {
    setFakeRpc({
      'Repo.get_file_content': vi.fn(async () => ''),
    });
  });

  it('registers markdown link provider on first editor build', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(monacoState.linkProviders).toHaveLength(1);
    expect(monacoState.linkProviders[0].language).toBe('markdown');
  });

  it('registers link opener on first editor build', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    expect(monacoState.linkOpeners).toHaveLength(1);
  });

  it('does not re-register on file switch', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'src/main.py' });
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    expect(monacoState.linkProviders).toHaveLength(1);
    expect(monacoState.linkOpeners).toHaveLength(1);
  });

  it('link opener resolves relative path and dispatches navigate-file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'docs/spec.md' });
    await settle(el);
    // D18: dispatch on window, not the element.
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const opener = monacoState.linkOpeners[0];
      const result = opener.open('ac-navigate:///other.md');
      expect(result).toBe(true);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail.path).toBe('docs/other.md');
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('link opener handles parent-directory references', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'docs/nested/page.md' });
    await settle(el);
    const listener = vi.fn();
    window.addEventListener('navigate-file', listener);
    try {
      const opener = monacoState.linkOpeners[0];
      opener.open('ac-navigate:///../top.md');
      expect(listener.mock.calls[0][0].detail.path).toBe('docs/top.md');
    } finally {
      window.removeEventListener('navigate-file', listener);
    }
  });

  it('link opener ignores non-ac-navigate URIs', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'docs/spec.md' });
    await settle(el);
    const listener = vi.fn();
    el.addEventListener('navigate-file', listener);
    const opener = monacoState.linkOpeners[0];
    const result = opener.open('https://example.com');
    expect(result).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('link opener is a no-op when no active file', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'docs/spec.md' });
    await settle(el);
    el.closeFile('docs/spec.md');
    await settle(el);
    // No active file now — opener call shouldn't throw.
    const listener = vi.fn();
    el.addEventListener('navigate-file', listener);
    const opener = monacoState.linkOpeners[0];
    // Returns true (claims the URI) but dispatches
    // nothing because there's no active file to
    // resolve against.
    opener.open('ac-navigate:///other.md');
    expect(listener).not.toHaveBeenCalled();
  });

  it('link provider finds links in markdown content', async () => {
    // Call the provider directly with a fake model.
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    const provider = monacoState.linkProviders[0].provider;
    const model = {
      getValue: () => 'See [the spec](spec.md) for details.',
    };
    const result = provider.provideLinks(model);
    expect(result.links).toHaveLength(1);
    expect(result.links[0].url).toBe('ac-navigate:///spec.md');
  });

  it('link provider skips absolute URLs', async () => {
    const el = mountViewer();
    await settle(el);
    await el.openFile({ path: 'README.md' });
    await settle(el);
    const provider = monacoState.linkProviders[0].provider;
    const model = {
      getValue: () =>
        '[external](https://x.com) and [local](local.md)',
    };
    const result = provider.provideLinks(model);
    expect(result.links).toHaveLength(1);
    expect(result.links[0].url).toBe('ac-navigate:///local.md');
  });
});