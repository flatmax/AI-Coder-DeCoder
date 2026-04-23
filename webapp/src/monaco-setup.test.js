// Tests for monaco-setup.js — language detection,
// worker/tokenizer registration idempotence.
//
// The module's side effects (worker env install, MATLAB
// registration) run at import time. We can't really
// observe the worker env from jsdom, but we can verify
// languageForPath's behaviour and the registration
// idempotence contract via the exported functions.
//
// monaco-editor is mocked because loading the real module
// into jsdom crashes — Monaco's theme service calls
// `window.matchMedia` at construction time and jsdom
// doesn't implement it. The mock is a thin stand-in that
// lets monaco-setup.js's side-effect calls (register,
// setMonarchTokensProvider) succeed and lets the tests
// observe registrations via the same monaco namespace.

import { describe, expect, it, vi } from 'vitest';

// `vi.hoisted` declares state in the same hoisted phase as
// `vi.mock` factories so the factory can reference it
// without tripping on the temporal dead zone. The state
// (a Set of registered language ids) lets the "matlab
// registered" assertion observe the side effect of
// monaco-setup.js's module-load registration call.
const { mockMonaco } = vi.hoisted(() => {
  const registered = new Set();
  const monaco = {
    editor: {
      createDiffEditor: () => ({}),
      createModel: () => ({}),
      OverviewRulerLane: { Full: 7 },
    },
    languages: {
      register: (info) => {
        if (info && info.id) registered.add(info.id);
      },
      setMonarchTokensProvider: () => {},
      getLanguages: () =>
        [...registered].map((id) => ({ id })),
    },
  };
  return { mockMonaco: monaco };
});

vi.mock('monaco-editor/esm/vs/editor/editor.api.js', () => ({
  default: mockMonaco,
  ...mockMonaco,
}));

import {
  installMonacoWorkerEnvironment,
  languageForPath,
  monaco,
  registerMatlabLanguage,
} from './monaco-setup.js';

describe('languageForPath', () => {
  it('returns plaintext for empty or non-string input', () => {
    expect(languageForPath('')).toBe('plaintext');
    expect(languageForPath(null)).toBe('plaintext');
    expect(languageForPath(undefined)).toBe('plaintext');
    expect(languageForPath(42)).toBe('plaintext');
  });

  it('returns plaintext for extensionless paths', () => {
    expect(languageForPath('Makefile')).toBe('plaintext');
    expect(languageForPath('README')).toBe('plaintext');
    expect(languageForPath('LICENSE')).toBe('plaintext');
  });

  it('returns plaintext for unknown extensions', () => {
    expect(languageForPath('foo.xyz')).toBe('plaintext');
    expect(languageForPath('a/b/c.unknown')).toBe('plaintext');
  });

  it('handles trailing dots', () => {
    // Path ends in a dot with no extension after — treat
    // as extensionless.
    expect(languageForPath('foo.')).toBe('plaintext');
  });

  it('detects JavaScript variants', () => {
    expect(languageForPath('app.js')).toBe('javascript');
    expect(languageForPath('lib.mjs')).toBe('javascript');
    expect(languageForPath('server.cjs')).toBe('javascript');
    expect(languageForPath('component.jsx')).toBe('javascript');
  });

  it('detects TypeScript variants', () => {
    expect(languageForPath('app.ts')).toBe('typescript');
    expect(languageForPath('component.tsx')).toBe('typescript');
  });

  it('detects Python', () => {
    expect(languageForPath('script.py')).toBe('python');
    expect(languageForPath('stub.pyi')).toBe('python');
  });

  it('detects JSON and YAML', () => {
    expect(languageForPath('config.json')).toBe('json');
    expect(languageForPath('workflow.yaml')).toBe('yaml');
    expect(languageForPath('workflow.yml')).toBe('yaml');
  });

  it('detects web stack', () => {
    expect(languageForPath('page.html')).toBe('html');
    expect(languageForPath('page.htm')).toBe('html');
    expect(languageForPath('style.css')).toBe('css');
    expect(languageForPath('style.scss')).toBe('scss');
  });

  it('detects markdown', () => {
    expect(languageForPath('README.md')).toBe('markdown');
    expect(languageForPath('notes.markdown')).toBe('markdown');
  });

  it('detects C and C++', () => {
    expect(languageForPath('main.c')).toBe('c');
    expect(languageForPath('header.h')).toBe('c');
    expect(languageForPath('main.cpp')).toBe('cpp');
    expect(languageForPath('main.cc')).toBe('cpp');
    expect(languageForPath('main.cxx')).toBe('cpp');
    expect(languageForPath('header.hpp')).toBe('cpp');
    expect(languageForPath('header.hh')).toBe('cpp');
    expect(languageForPath('header.hxx')).toBe('cpp');
  });

  it('claims .h for C, not C++', () => {
    // Mixed repos use the C parser for both; the symbol
    // index made the same choice. Pinning the diff
    // viewer's language detection to match avoids
    // cross-viewer inconsistency.
    expect(languageForPath('ambiguous.h')).toBe('c');
  });

  it('detects shell', () => {
    expect(languageForPath('install.sh')).toBe('shell');
    expect(languageForPath('run.bash')).toBe('shell');
    expect(languageForPath('config.zsh')).toBe('shell');
  });

  it('detects MATLAB', () => {
    expect(languageForPath('analysis.m')).toBe('matlab');
  });

  it('detects other language families', () => {
    expect(languageForPath('App.java')).toBe('java');
    expect(languageForPath('lib.rs')).toBe('rust');
    expect(languageForPath('main.go')).toBe('go');
    expect(languageForPath('script.rb')).toBe('ruby');
    expect(languageForPath('page.php')).toBe('php');
    expect(languageForPath('query.sql')).toBe('sql');
  });

  it('detects ini-family config formats', () => {
    expect(languageForPath('pyproject.toml')).toBe('ini');
    expect(languageForPath('config.ini')).toBe('ini');
    expect(languageForPath('app.cfg')).toBe('ini');
  });

  it('detects XML and TeX', () => {
    expect(languageForPath('data.xml')).toBe('xml');
    expect(languageForPath('paper.tex')).toBe('latex');
    expect(languageForPath('paper.latex')).toBe('latex');
  });

  it('is case-insensitive', () => {
    expect(languageForPath('App.JS')).toBe('javascript');
    expect(languageForPath('MAIN.PY')).toBe('python');
    expect(languageForPath('README.MD')).toBe('markdown');
  });

  it('handles directory paths correctly', () => {
    // Extension is at the end of the whole path.
    expect(languageForPath('src/utils/helpers.py')).toBe('python');
    expect(languageForPath('a/b/c.ts')).toBe('typescript');
  });

  it('handles paths with dots in directories', () => {
    // `..` in directory names shouldn't confuse the
    // last-dot scan.
    expect(languageForPath('a.b/c.js')).toBe('javascript');
  });
});

describe('installMonacoWorkerEnvironment', () => {
  it('is idempotent — repeated calls do not throw', () => {
    // Module-load already called it; calling again should
    // be harmless.
    expect(() => installMonacoWorkerEnvironment()).not.toThrow();
    expect(() => installMonacoWorkerEnvironment()).not.toThrow();
  });

  it('installs MonacoEnvironment.getWorker', () => {
    const target =
      typeof self !== 'undefined' ? self : globalThis;
    expect(target.MonacoEnvironment).toBeDefined();
    expect(typeof target.MonacoEnvironment.getWorker).toBe(
      'function',
    );
  });
});

describe('registerMatlabLanguage', () => {
  it('is idempotent — repeated calls do not throw', () => {
    expect(() => registerMatlabLanguage()).not.toThrow();
    expect(() => registerMatlabLanguage()).not.toThrow();
  });

  it('registers matlab language with Monaco', () => {
    const languages = monaco.languages.getLanguages();
    const matlab = languages.find((l) => l.id === 'matlab');
    expect(matlab).toBeDefined();
    expect(matlab.id).toBe('matlab');
  });
});