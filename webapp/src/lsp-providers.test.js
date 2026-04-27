// Tests for lsp-providers.js — pure transformation
// logic for the four Monaco language-service providers.
//
// No Monaco mount, no editor — exercises the providers
// in isolation with fake monaco + fake RPC proxy. The
// integration test for end-to-end wiring lives in
// diff-viewer.test.js (Phase 3.1d integration pass).

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  _resetInstallGuard,
  buildCompletionProvider,
  buildDefinitionProvider,
  buildHoverProvider,
  buildReferenceProvider,
  installLspProviders,
  pathFromModel,
  unwrapEnvelope,
} from './lsp-providers.js';

// -------------------------------------------------------
// Fake Monaco — just enough surface for the providers
// -------------------------------------------------------

function makeFakeMonaco() {
  const registry = {
    hover: [],
    definition: [],
    reference: [],
    completion: [],
  };
  const monaco = {
    Uri: {
      file(path) {
        return {
          scheme: 'file',
          path: path.startsWith('/') ? path : '/' + path,
          toString() {
            return 'file://' + this.path;
          },
        };
      },
    },
    languages: {
      CompletionItemKind: {
        Text: 0,
        Method: 1,
        Function: 2,
        Class: 5,
        Variable: 4,
        Module: 8,
      },
      registerHoverProvider(selector, provider) {
        registry.hover.push({ selector, provider });
        return { dispose: () => {} };
      },
      registerDefinitionProvider(selector, provider) {
        registry.definition.push({ selector, provider });
        return { dispose: () => {} };
      },
      registerReferenceProvider(selector, provider) {
        registry.reference.push({ selector, provider });
        return { dispose: () => {} };
      },
      registerCompletionItemProvider(selector, provider) {
        registry.completion.push({ selector, provider });
        return { dispose: () => {} };
      },
    },
    __registry: registry,
  };
  return monaco;
}

function makeFakeModel({ wordRange } = {}) {
  return {
    uri: {
      scheme: 'inmemory',
      path: '/model/1',
    },
    getWordUntilPosition: wordRange
      ? () => wordRange
      : () => null,
  };
}

function makeFakeRpc(handlers) {
  // handlers: {'LLMService.lsp_get_hover': async fn, ...}
  return handlers;
}

// -------------------------------------------------------
// unwrapEnvelope
// -------------------------------------------------------

describe('unwrapEnvelope', () => {
  it('passes through null and undefined', () => {
    expect(unwrapEnvelope(null)).toBe(null);
    expect(unwrapEnvelope(undefined)).toBe(undefined);
  });

  it('passes through primitives', () => {
    expect(unwrapEnvelope('hello')).toBe('hello');
    expect(unwrapEnvelope(42)).toBe(42);
    expect(unwrapEnvelope(true)).toBe(true);
  });

  it('passes through arrays unchanged', () => {
    const arr = [1, 2, 3];
    expect(unwrapEnvelope(arr)).toBe(arr);
  });

  it('unwraps single-key envelopes whose inner is an object', () => {
    const payload = { contents: 'hover text' };
    const envelope = { 'uuid-abc-123': payload };
    expect(unwrapEnvelope(envelope)).toBe(payload);
  });

  it('does NOT unwrap single-key objects whose inner is a primitive', () => {
    // The heuristic: only unwrap if the inner value is
    // a non-array object. Otherwise we'd corrupt
    // legitimate payloads like {file: "path/to.py"}.
    const result = { file: 'path.py' };
    expect(unwrapEnvelope(result)).toBe(result);
  });

  it('does NOT unwrap single-key objects whose inner is an array', () => {
    const result = { items: [1, 2, 3] };
    expect(unwrapEnvelope(result)).toBe(result);
  });

  it('does NOT unwrap multi-key objects', () => {
    const result = { file: 'a.py', line: 5 };
    expect(unwrapEnvelope(result)).toBe(result);
  });

  it('does NOT unwrap empty objects', () => {
    const empty = {};
    expect(unwrapEnvelope(empty)).toBe(empty);
  });
});

// -------------------------------------------------------
// pathFromModel
// -------------------------------------------------------

describe('pathFromModel', () => {
  it('strips leading slash', () => {
    const model = { uri: { path: '/src/main.py' } };
    expect(pathFromModel(model)).toBe('src/main.py');
  });

  it('handles path without leading slash', () => {
    const model = { uri: { path: 'src/main.py' } };
    expect(pathFromModel(model)).toBe('src/main.py');
  });

  it('returns empty for missing model', () => {
    expect(pathFromModel(null)).toBe('');
    expect(pathFromModel(undefined)).toBe('');
  });

  it('returns empty for missing uri', () => {
    expect(pathFromModel({})).toBe('');
  });

  it('returns empty for empty path', () => {
    expect(pathFromModel({ uri: { path: '' } })).toBe('');
  });

  it('tolerates property access errors', () => {
    const model = {
      get uri() {
        throw new Error('boom');
      },
    };
    expect(pathFromModel(model)).toBe('');
  });
});

// -------------------------------------------------------
// HoverProvider
// -------------------------------------------------------

describe('buildHoverProvider', () => {
  it('returns null when no active path', async () => {
    const provider = buildHoverProvider(
      () => '',
      () => ({ 'LLMService.lsp_get_hover': vi.fn() }),
    );
    const result = await provider.provideHover(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toBe(null);
  });

  it('returns null when no RPC proxy', async () => {
    const provider = buildHoverProvider(
      () => 'src/foo.py',
      () => null,
    );
    const result = await provider.provideHover(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toBe(null);
  });

  it('calls RPC with active path and 1-indexed position', async () => {
    const rpcFn = vi
      .fn()
      .mockResolvedValue({ contents: 'info' });
    const provider = buildHoverProvider(
      () => 'src/foo.py',
      () => ({ 'LLMService.lsp_get_hover': rpcFn }),
    );
    await provider.provideHover(makeFakeModel(), {
      lineNumber: 42,
      column: 5,
    });
    expect(rpcFn).toHaveBeenCalledWith('src/foo.py', 42, 5);
  });

  it('wraps string contents as [{value}]', async () => {
    const provider = buildHoverProvider(
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_hover': async () => ({
          contents: 'def foo(x: int) -> str',
        }),
      }),
    );
    const result = await provider.provideHover(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toEqual({
      contents: [{ value: 'def foo(x: int) -> str' }],
    });
  });

  it('wraps string array contents as [{value}, {value}]', async () => {
    const provider = buildHoverProvider(
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_hover': async () => ({
          contents: ['signature', 'docstring'],
        }),
      }),
    );
    const result = await provider.provideHover(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toEqual({
      contents: [{ value: 'signature' }, { value: 'docstring' }],
    });
  });

  it('filters out empty strings', async () => {
    const provider = buildHoverProvider(
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_hover': async () => ({
          contents: ['text', '', 'more'],
        }),
      }),
    );
    const result = await provider.provideHover(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toEqual({
      contents: [{ value: 'text' }, { value: 'more' }],
    });
  });

  it('returns null when all contents filter to empty', async () => {
    const provider = buildHoverProvider(
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_hover': async () => ({
          contents: ['', null, 42],
        }),
      }),
    );
    const result = await provider.provideHover(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toBe(null);
  });

  it('returns null when payload is null', async () => {
    const provider = buildHoverProvider(
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_hover': async () => null,
      }),
    );
    const result = await provider.provideHover(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toBe(null);
  });

  it('returns null when payload has no contents field', async () => {
    const provider = buildHoverProvider(
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_hover': async () => ({ other: 'field' }),
      }),
    );
    const result = await provider.provideHover(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toBe(null);
  });

  it('unwraps jrpc-oo envelope', async () => {
    const provider = buildHoverProvider(
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_hover': async () => ({
          'uuid-remote-1': { contents: 'hover' },
        }),
      }),
    );
    const result = await provider.provideHover(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toEqual({
      contents: [{ value: 'hover' }],
    });
  });

  it('swallows RPC errors', async () => {
    const debugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => {});
    try {
      const provider = buildHoverProvider(
        () => 'src/foo.py',
        () => ({
          'LLMService.lsp_get_hover': async () => {
            throw new Error('network down');
          },
        }),
      );
      const result = await provider.provideHover(
        makeFakeModel(),
        { lineNumber: 1, column: 1 },
      );
      expect(result).toBe(null);
      expect(debugSpy).toHaveBeenCalled();
    } finally {
      debugSpy.mockRestore();
    }
  });
});

// -------------------------------------------------------
// DefinitionProvider
// -------------------------------------------------------

describe('buildDefinitionProvider', () => {
  let monaco;
  beforeEach(() => {
    monaco = makeFakeMonaco();
  });

  it('returns null when no active path', async () => {
    const provider = buildDefinitionProvider(
      monaco,
      () => '',
      () => ({ 'LLMService.lsp_get_definition': vi.fn() }),
    );
    const result = await provider.provideDefinition(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toBe(null);
  });

  it('returns null when no RPC', async () => {
    const provider = buildDefinitionProvider(
      monaco,
      () => 'src/foo.py',
      () => null,
    );
    const result = await provider.provideDefinition(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toBe(null);
  });

  it('builds Location with uri and range', async () => {
    const provider = buildDefinitionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_definition': async () => ({
          file: 'src/bar.py',
          range: {
            startLineNumber: 10,
            startColumn: 5,
            endLineNumber: 10,
            endColumn: 15,
          },
        }),
      }),
    );
    const result = await provider.provideDefinition(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result.uri.path).toBe('/src/bar.py');
    expect(result.range).toEqual({
      startLineNumber: 10,
      startColumn: 5,
      endLineNumber: 10,
      endColumn: 15,
    });
  });

  it('normalizes snake_case range fields from backend', async () => {
    const provider = buildDefinitionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_definition': async () => ({
          file: 'src/bar.py',
          range: {
            start_line: 10,
            start_column: 5,
            end_line: 10,
            end_column: 15,
          },
        }),
      }),
    );
    const result = await provider.provideDefinition(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result.range).toEqual({
      startLineNumber: 10,
      startColumn: 5,
      endLineNumber: 10,
      endColumn: 15,
    });
  });

  it('clamps range values to minimum 1', async () => {
    const provider = buildDefinitionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_definition': async () => ({
          file: 'src/bar.py',
          range: {
            startLineNumber: 0,
            startColumn: 0,
            endLineNumber: -5,
            endColumn: -1,
          },
        }),
      }),
    );
    const result = await provider.provideDefinition(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result.range).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    });
  });

  it('returns null when payload lacks file field', async () => {
    const provider = buildDefinitionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_definition': async () => ({
          range: { startLineNumber: 1 },
        }),
      }),
    );
    const result = await provider.provideDefinition(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toBe(null);
  });

  it('returns null when payload lacks range field', async () => {
    const provider = buildDefinitionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_definition': async () => ({
          file: 'src/bar.py',
        }),
      }),
    );
    const result = await provider.provideDefinition(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toBe(null);
  });

  it('unwraps jrpc-oo envelope', async () => {
    const provider = buildDefinitionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_definition': async () => ({
          'uuid-1': {
            file: 'src/bar.py',
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 1,
              endColumn: 5,
            },
          },
        }),
      }),
    );
    const result = await provider.provideDefinition(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result.uri.path).toBe('/src/bar.py');
  });

  it('swallows RPC errors', async () => {
    const debugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => {});
    try {
      const provider = buildDefinitionProvider(
        monaco,
        () => 'src/foo.py',
        () => ({
          'LLMService.lsp_get_definition': async () => {
            throw new Error('fail');
          },
        }),
      );
      const result = await provider.provideDefinition(
        makeFakeModel(),
        { lineNumber: 1, column: 1 },
      );
      expect(result).toBe(null);
    } finally {
      debugSpy.mockRestore();
    }
  });
});

// -------------------------------------------------------
// ReferenceProvider
// -------------------------------------------------------

describe('buildReferenceProvider', () => {
  let monaco;
  beforeEach(() => {
    monaco = makeFakeMonaco();
  });

  it('returns null when no active path', async () => {
    const provider = buildReferenceProvider(
      monaco,
      () => '',
      () => ({ 'LLMService.lsp_get_references': vi.fn() }),
    );
    const result = await provider.provideReferences(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toBe(null);
  });

  it('returns empty array when payload is null', async () => {
    const provider = buildReferenceProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_references': async () => null,
      }),
    );
    const result = await provider.provideReferences(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toEqual([]);
  });

  it('returns null for non-array payload (shape violation)', async () => {
    const debugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => {});
    try {
      const provider = buildReferenceProvider(
        monaco,
        () => 'src/foo.py',
        () => ({
          'LLMService.lsp_get_references': async () => ({ not: 'array' }),
        }),
      );
      const result = await provider.provideReferences(
        makeFakeModel(),
        { lineNumber: 1, column: 1 },
      );
      expect(result).toBe(null);
      expect(debugSpy).toHaveBeenCalled();
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('builds Location[] from array response', async () => {
    const provider = buildReferenceProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_references': async () => [
          {
            file: 'src/a.py',
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 1,
              endColumn: 5,
            },
          },
          {
            file: 'src/b.py',
            range: {
              startLineNumber: 10,
              startColumn: 3,
              endLineNumber: 10,
              endColumn: 8,
            },
          },
        ],
      }),
    );
    const result = await provider.provideReferences(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toHaveLength(2);
    expect(result[0].uri.path).toBe('/src/a.py');
    expect(result[1].uri.path).toBe('/src/b.py');
  });

  it('skips entries missing file or range', async () => {
    const provider = buildReferenceProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_references': async () => [
          { file: 'a.py', range: { startLineNumber: 1 } },
          { file: 'b.py' }, // missing range
          { range: { startLineNumber: 1 } }, // missing file
          null, // malformed
          {
            file: 'c.py',
            range: { startLineNumber: 2, startColumn: 1 },
          },
        ],
      }),
    );
    const result = await provider.provideReferences(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toHaveLength(2);
    expect(result[0].uri.path).toBe('/a.py');
    expect(result[1].uri.path).toBe('/c.py');
  });

  it('returns empty array for empty array payload', async () => {
    const provider = buildReferenceProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_references': async () => [],
      }),
    );
    const result = await provider.provideReferences(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toEqual([]);
  });

  it('swallows RPC errors', async () => {
    const debugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => {});
    try {
      const provider = buildReferenceProvider(
        monaco,
        () => 'src/foo.py',
        () => ({
          'LLMService.lsp_get_references': async () => {
            throw new Error('fail');
          },
        }),
      );
      const result = await provider.provideReferences(
        makeFakeModel(),
        { lineNumber: 1, column: 1 },
      );
      expect(result).toBe(null);
    } finally {
      debugSpy.mockRestore();
    }
  });
});

// -------------------------------------------------------
// CompletionProvider
// -------------------------------------------------------

describe('buildCompletionProvider', () => {
  let monaco;
  beforeEach(() => {
    monaco = makeFakeMonaco();
  });

  it('declares . as trigger character', () => {
    const provider = buildCompletionProvider(
      monaco,
      () => 'x.py',
      () => ({}),
    );
    expect(provider.triggerCharacters).toEqual(['.']);
  });

  it('returns empty suggestions when no active path', async () => {
    const provider = buildCompletionProvider(
      monaco,
      () => '',
      () => ({ 'LLMService.lsp_get_completions': vi.fn() }),
    );
    const result = await provider.provideCompletionItems(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toEqual({ suggestions: [] });
  });

  it('returns empty suggestions when RPC returns null', async () => {
    const provider = buildCompletionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_completions': async () => null,
      }),
    );
    const result = await provider.provideCompletionItems(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result).toEqual({ suggestions: [] });
  });

  it('builds suggestions from array response', async () => {
    const provider = buildCompletionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_completions': async () => [
          { label: 'print', kind: 2 },
          { label: 'parse', kind: 2, detail: 'def parse()' },
        ],
      }),
    );
    const model = makeFakeModel({
      wordRange: { startColumn: 1, endColumn: 3 },
    });
    const result = await provider.provideCompletionItems(
      model,
      { lineNumber: 5, column: 3 },
    );
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0].label).toBe('print');
    expect(result.suggestions[0].kind).toBe(2);
    expect(result.suggestions[1].detail).toBe('def parse()');
  });

  it('uses word-at-position range for replacement', async () => {
    const provider = buildCompletionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_completions': async () => [
          { label: 'foo', kind: 2 },
        ],
      }),
    );
    const model = makeFakeModel({
      wordRange: { startColumn: 5, endColumn: 8 },
    });
    const result = await provider.provideCompletionItems(
      model,
      { lineNumber: 10, column: 7 },
    );
    expect(result.suggestions[0].range).toEqual({
      startLineNumber: 10,
      endLineNumber: 10,
      startColumn: 5,
      endColumn: 8,
    });
  });

  it('falls back to empty range when no word at position', async () => {
    const provider = buildCompletionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_completions': async () => [
          { label: 'foo', kind: 2 },
        ],
      }),
    );
    const model = makeFakeModel(); // no word
    const result = await provider.provideCompletionItems(
      model,
      { lineNumber: 10, column: 7 },
    );
    expect(result.suggestions[0].range).toEqual({
      startLineNumber: 10,
      endLineNumber: 10,
      startColumn: 7,
      endColumn: 7,
    });
  });

  it('defaults insertText to label when missing', async () => {
    const provider = buildCompletionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_completions': async () => [
          { label: 'MyClass', kind: 5 },
        ],
      }),
    );
    const result = await provider.provideCompletionItems(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result.suggestions[0].insertText).toBe('MyClass');
  });

  it('uses explicit insertText when provided', async () => {
    const provider = buildCompletionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_completions': async () => [
          {
            label: 'print()',
            kind: 2,
            insertText: 'print(${1:value})',
          },
        ],
      }),
    );
    const result = await provider.provideCompletionItems(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result.suggestions[0].insertText).toBe(
      'print(${1:value})',
    );
  });

  it('clamps invalid kind to Text (0)', async () => {
    const provider = buildCompletionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_completions': async () => [
          { label: 'x', kind: 999 },
          { label: 'y', kind: 'not-a-number' },
          { label: 'z', kind: -5 },
        ],
      }),
    );
    const result = await provider.provideCompletionItems(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result.suggestions[0].kind).toBe(0);
    expect(result.suggestions[1].kind).toBe(0);
    expect(result.suggestions[2].kind).toBe(0);
  });

  it('preserves documentation when string', async () => {
    const provider = buildCompletionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_completions': async () => [
          {
            label: 'foo',
            kind: 2,
            documentation: 'Does the thing.',
          },
        ],
      }),
    );
    const result = await provider.provideCompletionItems(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result.suggestions[0].documentation).toBe(
      'Does the thing.',
    );
  });

  it('skips malformed entries', async () => {
    const provider = buildCompletionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_completions': async () => [
          { label: 'good', kind: 2 },
          null,
          { kind: 2 }, // missing label
          { label: '', kind: 2 }, // empty label
          'not an object',
          { label: 'also-good', kind: 2 },
        ],
      }),
    );
    const result = await provider.provideCompletionItems(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0].label).toBe('good');
    expect(result.suggestions[1].label).toBe('also-good');
  });

  it('unwraps jrpc-oo envelope', async () => {
    // NOTE: unwrapEnvelope only unwraps if the inner is
    // a non-array object. Arrays pass through. So an
    // envelope {uuid: [...items]} is NOT unwrapped —
    // the provider gets the envelope, sees it isn't an
    // array, and returns empty suggestions.
    //
    // This matches how jrpc-oo actually works for
    // list-return RPCs: the envelope uses `values()` on
    // the JS side to extract the inner array. But for
    // defensive testing, verify that a direct-array
    // payload (common in tests) works correctly.
    const provider = buildCompletionProvider(
      monaco,
      () => 'src/foo.py',
      () => ({
        'LLMService.lsp_get_completions': async () => [
          { label: 'direct', kind: 2 },
        ],
      }),
    );
    const result = await provider.provideCompletionItems(
      makeFakeModel(),
      { lineNumber: 1, column: 1 },
    );
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].label).toBe('direct');
  });

  it('swallows RPC errors', async () => {
    const debugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => {});
    try {
      const provider = buildCompletionProvider(
        monaco,
        () => 'src/foo.py',
        () => ({
          'LLMService.lsp_get_completions': async () => {
            throw new Error('fail');
          },
        }),
      );
      const result = await provider.provideCompletionItems(
        makeFakeModel(),
        { lineNumber: 1, column: 1 },
      );
      expect(result).toEqual({ suggestions: [] });
    } finally {
      debugSpy.mockRestore();
    }
  });
});

// -------------------------------------------------------
// installLspProviders
// -------------------------------------------------------

describe('installLspProviders', () => {
  let monaco;

  beforeEach(() => {
    monaco = makeFakeMonaco();
  });

  afterEach(() => {
    _resetInstallGuard(monaco);
  });

  it('registers all four providers', () => {
    installLspProviders(
      monaco,
      () => 'src/foo.py',
      () => ({}),
    );
    expect(monaco.__registry.hover).toHaveLength(1);
    expect(monaco.__registry.definition).toHaveLength(1);
    expect(monaco.__registry.reference).toHaveLength(1);
    expect(monaco.__registry.completion).toHaveLength(1);
  });

  it('uses wildcard selector', () => {
    installLspProviders(
      monaco,
      () => 'src/foo.py',
      () => ({}),
    );
    expect(monaco.__registry.hover[0].selector).toBe('*');
    expect(monaco.__registry.definition[0].selector).toBe('*');
    expect(monaco.__registry.reference[0].selector).toBe('*');
    expect(monaco.__registry.completion[0].selector).toBe('*');
  });

  it('returns four disposables', () => {
    const result = installLspProviders(
      monaco,
      () => 'src/foo.py',
      () => ({}),
    );
    expect(result).toHaveLength(4);
    expect(typeof result[0].dispose).toBe('function');
  });

  it('is idempotent across calls', () => {
    installLspProviders(
      monaco,
      () => 'src/foo.py',
      () => ({}),
    );
    installLspProviders(
      monaco,
      () => 'src/foo.py',
      () => ({}),
    );
    installLspProviders(
      monaco,
      () => 'src/foo.py',
      () => ({}),
    );
    // Still only one registration per provider type.
    expect(monaco.__registry.hover).toHaveLength(1);
    expect(monaco.__registry.definition).toHaveLength(1);
    expect(monaco.__registry.reference).toHaveLength(1);
    expect(monaco.__registry.completion).toHaveLength(1);
  });

  it('returns empty array on second install', () => {
    installLspProviders(
      monaco,
      () => 'src/foo.py',
      () => ({}),
    );
    const result = installLspProviders(
      monaco,
      () => 'src/foo.py',
      () => ({}),
    );
    expect(result).toEqual([]);
  });

  it('reinstalls after guard reset', () => {
    installLspProviders(
      monaco,
      () => 'src/foo.py',
      () => ({}),
    );
    _resetInstallGuard(monaco);
    installLspProviders(
      monaco,
      () => 'src/foo.py',
      () => ({}),
    );
    expect(monaco.__registry.hover).toHaveLength(2);
  });

  it('returns empty array when monaco is null', () => {
    expect(installLspProviders(null, () => '', () => null)).toEqual(
      [],
    );
  });

  it('returns empty array when monaco.languages is missing', () => {
    const broken = { Uri: monaco.Uri };
    expect(
      installLspProviders(broken, () => '', () => null),
    ).toEqual([]);
  });

  it('passes callbacks through to providers', async () => {
    const getPath = vi.fn(() => 'src/test.py');
    const rpcFn = vi.fn().mockResolvedValue({ contents: 'x' });
    const getCall = vi.fn(() => ({
      'LLMService.lsp_get_hover': rpcFn,
    }));
    installLspProviders(monaco, getPath, getCall);
    // Exercise the hover provider to verify the
    // callbacks were wired up correctly.
    const provider = monaco.__registry.hover[0].provider;
    await provider.provideHover(makeFakeModel(), {
      lineNumber: 1,
      column: 1,
    });
    expect(getPath).toHaveBeenCalled();
    expect(getCall).toHaveBeenCalled();
    expect(rpcFn).toHaveBeenCalledWith('src/test.py', 1, 1);
  });

  it('catches individual registration failures independently', () => {
    const broken = {
      ...monaco,
      languages: {
        ...monaco.languages,
        registerHoverProvider() {
          throw new Error('hover broken');
        },
      },
    };
    const debugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => {});
    try {
      const result = installLspProviders(
        broken,
        () => 'src/foo.py',
        () => ({}),
      );
      // Other three registered; hover failed silently.
      expect(result).toHaveLength(3);
      expect(debugSpy).toHaveBeenCalled();
    } finally {
      debugSpy.mockRestore();
    }
  });
});