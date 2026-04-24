// Tests for markdown-link-provider.js — pattern
// matching, URI construction, provider contracts.
//
// No Monaco mount. Exercises the pure helpers plus
// the provider/opener builders with a fake monaco
// namespace for install-function tests.

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
  buildMarkdownLinkOpener,
  buildMarkdownLinkProvider,
  buildNavigateUri,
  findLinks,
  findLinksInLine,
  installMarkdownLinkProvider,
  parseNavigateUri,
  shouldSkip,
} from './markdown-link-provider.js';

// -------------------------------------------------------
// Fake Monaco — minimal surface for the installer
// -------------------------------------------------------

function makeFakeMonaco() {
  const registry = {
    linkProviders: [],
    openers: [],
  };
  const monaco = {
    languages: {
      registerLinkProvider(language, provider) {
        registry.linkProviders.push({ language, provider });
        return { dispose: () => {} };
      },
    },
    editor: {
      registerEditorOpener(opener) {
        registry.openers.push(opener);
        return { dispose: () => {} };
      },
    },
    __registry: registry,
  };
  return monaco;
}

// -------------------------------------------------------
// shouldSkip
// -------------------------------------------------------

describe('shouldSkip', () => {
  it('skips http URLs', () => {
    expect(shouldSkip('http://example.com')).toBe(true);
    expect(shouldSkip('https://example.com/x')).toBe(true);
  });

  it('skips data and blob URLs', () => {
    expect(shouldSkip('data:image/png;base64,x')).toBe(true);
    expect(shouldSkip('blob:http://host/abc')).toBe(true);
  });

  it('skips mailto, tel, and other scheme URLs', () => {
    expect(shouldSkip('mailto:test@example.com')).toBe(true);
    expect(shouldSkip('tel:+1234')).toBe(true);
    expect(shouldSkip('ftp://x.y/file')).toBe(true);
  });

  it('skips protocol-relative URLs', () => {
    expect(shouldSkip('//cdn.example.com/foo.js')).toBe(true);
  });

  it('skips fragment-only refs', () => {
    expect(shouldSkip('#section-1')).toBe(true);
    expect(shouldSkip('#')).toBe(true);
  });

  it('skips root-anchored paths', () => {
    expect(shouldSkip('/foo/bar.md')).toBe(true);
    expect(shouldSkip('/')).toBe(true);
  });

  it('accepts relative paths', () => {
    expect(shouldSkip('other.md')).toBe(false);
    expect(shouldSkip('./other.md')).toBe(false);
    expect(shouldSkip('../parent.md')).toBe(false);
    expect(shouldSkip('subdir/file.md')).toBe(false);
  });

  it('skips empty string', () => {
    expect(shouldSkip('')).toBe(true);
  });

  it('skips non-string input', () => {
    expect(shouldSkip(null)).toBe(true);
    expect(shouldSkip(undefined)).toBe(true);
    expect(shouldSkip(42)).toBe(true);
  });

  it('accepts relative path with fragment', () => {
    // Fragment after a relative path is still a
    // navigable link; the opener strips the fragment
    // before dispatching.
    expect(shouldSkip('other.md#section')).toBe(false);
  });
});

// -------------------------------------------------------
// findLinksInLine
// -------------------------------------------------------

describe('findLinksInLine', () => {
  it('returns empty for empty string', () => {
    expect(findLinksInLine('')).toEqual([]);
  });

  it('returns empty for non-string', () => {
    expect(findLinksInLine(null)).toEqual([]);
    expect(findLinksInLine(undefined)).toEqual([]);
  });

  it('finds a simple link', () => {
    const result = findLinksInLine('See [the spec](spec.md).');
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('spec.md');
  });

  it('reports 1-indexed columns', () => {
    // Line: "x [a](b.md)"
    //       0123456789
    // Link starts at index 2 → column 3.
    const result = findLinksInLine('x [a](b.md)');
    expect(result[0].startColumn).toBe(3);
    expect(result[0].endColumn).toBe(12);
  });

  it('finds multiple links on one line', () => {
    const result = findLinksInLine('[a](x.md) and [b](y.md)');
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe('x.md');
    expect(result[1].url).toBe('y.md');
  });

  it('skips absolute-URL links', () => {
    const result = findLinksInLine(
      '[rel](rel.md) and [abs](https://x.com)',
    );
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('rel.md');
  });

  it('skips fragment-only links', () => {
    const result = findLinksInLine(
      '[rel](rel.md) [frag](#section)',
    );
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('rel.md');
  });

  it('accepts links with fragments on relative paths', () => {
    const result = findLinksInLine('[x](other.md#sec)');
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('other.md#sec');
  });

  it('accepts parent-directory paths', () => {
    const result = findLinksInLine('[up](../top.md)');
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('../top.md');
  });

  it('handles empty link text', () => {
    const result = findLinksInLine('[](empty.md)');
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('empty.md');
  });

  it('does not match reference-style links', () => {
    // `[text][ref]` is reference-style; we only match
    // inline `[text](url)`.
    const result = findLinksInLine('[x][ref] and [y](z.md)');
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('z.md');
  });
});

// -------------------------------------------------------
// findLinks — multi-line
// -------------------------------------------------------

describe('findLinks', () => {
  it('returns empty for empty input', () => {
    expect(findLinks('')).toEqual([]);
    expect(findLinks(null)).toEqual([]);
  });

  it('finds links across multiple lines', () => {
    const text = 'First [a](a.md) line.\nSecond [b](b.md) line.';
    const result = findLinks(text);
    expect(result).toHaveLength(2);
    expect(result[0].range.startLineNumber).toBe(1);
    expect(result[1].range.startLineNumber).toBe(2);
  });

  it('reports 1-indexed line numbers', () => {
    const text = '\n\n[x](y.md)';
    const result = findLinks(text);
    expect(result[0].range.startLineNumber).toBe(3);
  });

  it('emits ac-navigate URIs', () => {
    const result = findLinks('[x](other.md)');
    expect(result[0].url).toBe('ac-navigate:///other.md');
  });

  it('emits tooltip with original path', () => {
    const result = findLinks('[x](other.md)');
    expect(result[0].tooltip).toContain('other.md');
  });

  it('skips all non-relative URLs', () => {
    const text = [
      '[http](https://x.com)',
      '[data](data:image/png;base64,x)',
      '[frag](#section)',
      '[rel](actually-rel.md)',
    ].join('\n');
    const result = findLinks(text);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('ac-navigate:///actually-rel.md');
  });

  it('handles empty lines correctly', () => {
    const text = '\n\n\n[x](y.md)\n\n';
    const result = findLinks(text);
    expect(result).toHaveLength(1);
    expect(result[0].range.startLineNumber).toBe(4);
  });
});

// -------------------------------------------------------
// buildNavigateUri / parseNavigateUri
// -------------------------------------------------------

describe('buildNavigateUri', () => {
  it('constructs a URI from a path', () => {
    expect(buildNavigateUri('other.md')).toBe(
      'ac-navigate:///other.md',
    );
  });

  it('preserves path separators', () => {
    expect(buildNavigateUri('a/b/c.md')).toBe(
      'ac-navigate:///a/b/c.md',
    );
  });

  it('preserves fragments', () => {
    expect(buildNavigateUri('x.md#sec')).toBe(
      'ac-navigate:///x.md#sec',
    );
  });
});

describe('parseNavigateUri', () => {
  it('parses our scheme from a string URI', () => {
    expect(parseNavigateUri('ac-navigate:///x.md')).toBe('x.md');
  });

  it('parses deep paths', () => {
    expect(parseNavigateUri('ac-navigate:///a/b/c.md')).toBe(
      'a/b/c.md',
    );
  });

  it('parses from a Monaco Uri object', () => {
    const uri = {
      scheme: 'ac-navigate',
      path: '/x.md',
    };
    expect(parseNavigateUri(uri)).toBe('x.md');
  });

  it('strips leading slash from Monaco Uri path', () => {
    const uri = {
      scheme: 'ac-navigate',
      path: '/a/b.md',
    };
    expect(parseNavigateUri(uri)).toBe('a/b.md');
  });

  it('returns null for wrong scheme', () => {
    expect(parseNavigateUri('https://x.com')).toBe(null);
    expect(parseNavigateUri('file:///x.md')).toBe(null);
  });

  it('returns null for wrong-scheme Uri object', () => {
    const uri = { scheme: 'file', path: '/x.md' };
    expect(parseNavigateUri(uri)).toBe(null);
  });

  it('returns null for null / undefined / empty', () => {
    expect(parseNavigateUri(null)).toBe(null);
    expect(parseNavigateUri(undefined)).toBe(null);
    expect(parseNavigateUri('')).toBe(null);
  });

  it('returns null for unexpected types', () => {
    expect(parseNavigateUri(42)).toBe(null);
  });

  it('round-trips via build/parse', () => {
    const paths = [
      'other.md',
      'a/b/c.md',
      '../parent.md',
      './here.md',
      'spec.md#section',
    ];
    for (const p of paths) {
      expect(parseNavigateUri(buildNavigateUri(p))).toBe(p);
    }
  });
});

// -------------------------------------------------------
// buildMarkdownLinkProvider
// -------------------------------------------------------

describe('buildMarkdownLinkProvider', () => {
  it('calls getText callback for the document content', () => {
    const getText = vi.fn(() => '[a](b.md)');
    const provider = buildMarkdownLinkProvider(getText);
    const result = provider.provideLinks({});
    expect(getText).toHaveBeenCalled();
    expect(result.links).toHaveLength(1);
  });

  it('passes the model to the getText callback', () => {
    const getText = vi.fn(() => '');
    const provider = buildMarkdownLinkProvider(getText);
    const fakeModel = { id: 'test' };
    provider.provideLinks(fakeModel);
    expect(getText).toHaveBeenCalledWith(fakeModel);
  });

  it('falls back to model.getValue() when no callback', () => {
    const provider = buildMarkdownLinkProvider();
    const model = {
      getValue: vi.fn(() => '[a](b.md)'),
    };
    const result = provider.provideLinks(model);
    expect(model.getValue).toHaveBeenCalled();
    expect(result.links).toHaveLength(1);
  });

  it('returns empty links for empty content', () => {
    const provider = buildMarkdownLinkProvider(() => '');
    const result = provider.provideLinks({});
    expect(result).toEqual({ links: [] });
  });

  it('returns empty links when model has no getValue', () => {
    const provider = buildMarkdownLinkProvider();
    const result = provider.provideLinks({});
    expect(result).toEqual({ links: [] });
  });
});

// -------------------------------------------------------
// buildMarkdownLinkOpener
// -------------------------------------------------------

describe('buildMarkdownLinkOpener', () => {
  it('dispatches relative paths via onNavigate', () => {
    const onNavigate = vi.fn();
    const opener = buildMarkdownLinkOpener(onNavigate);
    const result = opener.open('ac-navigate:///x.md');
    expect(onNavigate).toHaveBeenCalledWith('x.md');
    expect(result).toBe(true);
  });

  it('claims the event (returns true) for ac-navigate URIs', () => {
    const opener = buildMarkdownLinkOpener(() => {});
    expect(opener.open('ac-navigate:///x.md')).toBe(true);
  });

  it('passes on (returns false) for other schemes', () => {
    const onNavigate = vi.fn();
    const opener = buildMarkdownLinkOpener(onNavigate);
    expect(opener.open('https://example.com')).toBe(false);
    expect(opener.open('file:///x.md')).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('handles Monaco Uri objects', () => {
    const onNavigate = vi.fn();
    const opener = buildMarkdownLinkOpener(onNavigate);
    const uri = {
      scheme: 'ac-navigate',
      path: '/docs/spec.md',
    };
    expect(opener.open(uri)).toBe(true);
    expect(onNavigate).toHaveBeenCalledWith('docs/spec.md');
  });

  it('strips fragment before dispatching', () => {
    const onNavigate = vi.fn();
    const opener = buildMarkdownLinkOpener(onNavigate);
    opener.open('ac-navigate:///spec.md#intro');
    expect(onNavigate).toHaveBeenCalledWith('spec.md');
  });

  it('returns false for empty path after fragment strip', () => {
    const onNavigate = vi.fn();
    const opener = buildMarkdownLinkOpener(onNavigate);
    // URI with only a fragment part — path becomes
    // empty after stripping the fragment.
    const uri = { scheme: 'ac-navigate', path: '/#x' };
    expect(opener.open(uri)).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('swallows errors from onNavigate', () => {
    const debugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => {});
    try {
      const onNavigate = vi.fn(() => {
        throw new Error('boom');
      });
      const opener = buildMarkdownLinkOpener(onNavigate);
      // Doesn't throw, still claims the event.
      expect(opener.open('ac-navigate:///x.md')).toBe(true);
      expect(debugSpy).toHaveBeenCalled();
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('returns false for null / undefined input', () => {
    const opener = buildMarkdownLinkOpener(() => {});
    expect(opener.open(null)).toBe(false);
    expect(opener.open(undefined)).toBe(false);
  });
});

// -------------------------------------------------------
// installMarkdownLinkProvider
// -------------------------------------------------------

describe('installMarkdownLinkProvider', () => {
  let monaco;

  beforeEach(() => {
    monaco = makeFakeMonaco();
  });

  afterEach(() => {
    _resetInstallGuard(monaco);
  });

  it('registers a link provider for markdown', () => {
    installMarkdownLinkProvider(
      monaco,
      () => '',
      () => {},
    );
    expect(monaco.__registry.linkProviders).toHaveLength(1);
    expect(monaco.__registry.linkProviders[0].language).toBe(
      'markdown',
    );
  });

  it('registers a link opener', () => {
    installMarkdownLinkProvider(
      monaco,
      () => '',
      () => {},
    );
    expect(monaco.__registry.openers).toHaveLength(1);
  });

  it('opener dispatches via onNavigate callback', () => {
    const onNavigate = vi.fn();
    installMarkdownLinkProvider(monaco, () => '', onNavigate);
    const opener = monaco.__registry.openers[0];
    opener.open('ac-navigate:///test.md');
    expect(onNavigate).toHaveBeenCalledWith('test.md');
  });

  it('is idempotent across calls', () => {
    installMarkdownLinkProvider(
      monaco,
      () => '',
      () => {},
    );
    installMarkdownLinkProvider(
      monaco,
      () => '',
      () => {},
    );
    installMarkdownLinkProvider(
      monaco,
      () => '',
      () => {},
    );
    expect(monaco.__registry.linkProviders).toHaveLength(1);
    expect(monaco.__registry.openers).toHaveLength(1);
  });

  it('returns empty array on second install', () => {
    installMarkdownLinkProvider(
      monaco,
      () => '',
      () => {},
    );
    const result = installMarkdownLinkProvider(
      monaco,
      () => '',
      () => {},
    );
    expect(result).toEqual([]);
  });

  it('re-installs after guard reset', () => {
    installMarkdownLinkProvider(
      monaco,
      () => '',
      () => {},
    );
    _resetInstallGuard(monaco);
    installMarkdownLinkProvider(
      monaco,
      () => '',
      () => {},
    );
    expect(monaco.__registry.linkProviders).toHaveLength(2);
  });

  it('returns empty when monaco is null', () => {
    expect(
      installMarkdownLinkProvider(null, () => '', () => {}),
    ).toEqual([]);
  });

  it('returns empty when monaco.languages is missing', () => {
    const broken = { editor: monaco.editor };
    expect(
      installMarkdownLinkProvider(broken, () => '', () => {}),
    ).toEqual([]);
  });

  it('tolerates missing registerEditorOpener', () => {
    // Some Monaco versions don't expose registerEditor-
    // Opener. Provider registration still succeeds; the
    // opener is silently skipped (which means default
    // Monaco behavior handles the clicks — not ideal,
    // but not catastrophic).
    const partial = {
      languages: monaco.languages,
      editor: {},
    };
    const result = installMarkdownLinkProvider(
      partial,
      () => '',
      () => {},
    );
    // Provider got registered, opener didn't.
    expect(result).toHaveLength(1);
  });

  it('falls back to registerOpener when registerEditorOpener is missing', () => {
    const calls = [];
    const fallback = {
      languages: monaco.languages,
      editor: {
        registerOpener(opener) {
          calls.push(opener);
          return { dispose: () => {} };
        },
      },
    };
    installMarkdownLinkProvider(
      fallback,
      () => '',
      () => {},
    );
    expect(calls).toHaveLength(1);
  });

  it('catches registerLinkProvider failures', () => {
    const broken = {
      languages: {
        registerLinkProvider() {
          throw new Error('provider broken');
        },
      },
      editor: monaco.editor,
    };
    const debugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => {});
    try {
      // Opener still registers; link provider fails
      // silently.
      const result = installMarkdownLinkProvider(
        broken,
        () => '',
        () => {},
      );
      expect(result).toHaveLength(1);
      expect(debugSpy).toHaveBeenCalled();
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('catches registerEditorOpener failures', () => {
    const broken = {
      languages: monaco.languages,
      editor: {
        registerEditorOpener() {
          throw new Error('opener broken');
        },
      },
    };
    const debugSpy = vi
      .spyOn(console, 'debug')
      .mockImplementation(() => {});
    try {
      const result = installMarkdownLinkProvider(
        broken,
        () => '',
        () => {},
      );
      expect(result).toHaveLength(1); // provider registered
      expect(debugSpy).toHaveBeenCalled();
    } finally {
      debugSpy.mockRestore();
    }
  });
});