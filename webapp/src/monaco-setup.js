// Monaco editor setup — worker configuration, language
// registration, extension-to-language mapping.
//
// This module MUST be imported before any editor instance
// is created. Worker config is set on a global property
// (`self.MonacoEnvironment.getWorker`) and MATLAB's Monarch
// tokenizer is registered via side-effect at module load.
// Both must complete before Monaco internally looks up
// either mechanism; doing this lazily inside the diff
// viewer's lifecycle would miss the window.
//
// The diff viewer imports this module as a side effect (not
// for its named exports specifically), so the import order
// in diff-viewer.js is load-bearing — monaco-setup before
// any other monaco-editor imports.
//
// specs4/5-webapp/diff-viewer.md#monaco-worker-configuration
// specs4/5-webapp/diff-viewer.md#matlab-syntax-highlighting

// Use the explicit ESM entry path. Bare 'monaco-editor'
// fails Vite's dep resolver because Monaco's package.json
// doesn't declare a clean main/module/exports entry for
// programmatic consumers — the conventional import path
// is the editor.api module.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

/**
 * Configure Monaco's worker loader.
 *
 * Monaco's diff computation runs in a dedicated editor
 * worker. Language services (JS/TS/JSON/CSS/HTML typings,
 * validation) normally run in additional workers. We use a
 * hybrid:
 *
 *   - The editor worker (label 'editorWorkerService') is a
 *     real Worker loaded from monaco-editor's ESM build.
 *     Required for diff computation — without it the diff
 *     editor renders but shows no line-level indicators.
 *   - All other worker requests get a no-op Blob worker.
 *     Backend LSP covers the language-service features
 *     these workers would have provided.
 *
 * The no-op worker must reply to any incoming message;
 * Monaco hangs waiting for responses to language-service
 * pings if the worker never dispatches.
 *
 * Guard: installing the config twice is harmless but
 * pointless. The flag lets tests or callers that import
 * this module multiple times skip re-installation.
 */
let _workerEnvInstalled = false;

export function installMonacoWorkerEnvironment() {
  if (_workerEnvInstalled) return;
  _workerEnvInstalled = true;
  // In a non-browser test env (jsdom), `self` isn't always
  // globalThis. Set on globalThis for safety; Monaco
  // reads `self.MonacoEnvironment` at editor-construction
  // time, and jsdom aliases `self = globalThis` in the
  // browser-like module scope, so this works in both.
  const target = typeof self !== 'undefined' ? self : globalThis;
  target.MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === 'editorWorkerService') {
        // Dynamic import path — Vite recognises the
        // `new URL(..., import.meta.url)` pattern at
        // build time and emits the worker bundle as a
        // separate asset. In tests this path is never
        // hit (the mocked monaco doesn't request a real
        // worker) so the URL construction is harmless.
        return new Worker(
          new URL(
            'monaco-editor/esm/vs/editor/editor.worker.js',
            import.meta.url,
          ),
          { type: 'module' },
        );
      }
      // No-op worker for everything else. `URL.createObjectURL`
      // of a Blob is a data-URL-like worker source that runs
      // our tiny stub script. The stub swallows messages; Monaco
      // doesn't need a reply for language-service calls, it just
      // needs the worker to exist so dispatches don't queue.
      try {
        const blob = new Blob(
          ['self.onmessage = function() {}'],
          { type: 'application/javascript' },
        );
        return new Worker(URL.createObjectURL(blob));
      } catch (_) {
        // jsdom's Blob/Worker are incomplete; tests mock
        // Monaco entirely so this path isn't hit. Defensive
        // fallback prevents an unhandled rejection if a
        // future test inadvertently constructs an editor.
        return { postMessage() {}, terminate() {} };
      }
    },
  };
}

/**
 * Extension → Monaco language id map.
 *
 * Monaco's built-in languages include most of what we need;
 * `matlab` is registered below by this module. Unknown
 * extensions fall back to 'plaintext'.
 */
const _EXTENSION_MAP = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.pyi': 'python',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.m': 'matlab',
  '.java': 'java',
  '.rs': 'rust',
  '.go': 'go',
  '.rb': 'ruby',
  '.php': 'php',
  '.sql': 'sql',
  '.toml': 'ini',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.xml': 'xml',
  '.tex': 'latex',
  '.latex': 'latex',
};

/**
 * Resolve a file path to a Monaco language id. Falls back
 * to 'plaintext' for unknown extensions.
 *
 * @param {string} path — file path (case-insensitive ext)
 * @returns {string}
 */
export function languageForPath(path) {
  if (typeof path !== 'string' || !path) return 'plaintext';
  const lower = path.toLowerCase();
  // Find the last dot; the extension includes the dot.
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx < 0 || dotIdx === lower.length - 1) {
    return 'plaintext';
  }
  const ext = lower.slice(dotIdx);
  return _EXTENSION_MAP[ext] || 'plaintext';
}

/**
 * Register MATLAB language with Monaco.
 *
 * Monaco has no built-in MATLAB. Registration must run at
 * module load time — before any editor is constructed.
 * Editor instances capture language providers at
 * construction; a MATLAB file opened in an editor built
 * before registration would show plain text regardless of
 * the language id.
 *
 * The Monarch tokenizer below covers keywords, common
 * builtins (~80 entries, not exhaustive — unknown names
 * render as identifiers, which is fine), line + block
 * comments, single and double-quoted strings, numbers
 * (integer, float, scientific, complex i/j suffix),
 * arithmetic + element-wise + comparison + logical
 * operators, and the transpose operator `'` after
 * identifiers/brackets (distinguished from string delimiter
 * by context).
 */
let _matlabRegistered = false;

export function registerMatlabLanguage() {
  if (_matlabRegistered) return;
  _matlabRegistered = true;
  monaco.languages.register({ id: 'matlab' });
  monaco.languages.setMonarchTokensProvider('matlab', {
    defaultToken: '',
    tokenPostfix: '.m',

    keywords: [
      'break', 'case', 'catch', 'classdef', 'continue',
      'else', 'elseif', 'end', 'enumeration', 'events',
      'for', 'function', 'global', 'if', 'methods',
      'otherwise', 'parfor', 'persistent', 'properties',
      'return', 'spmd', 'switch', 'try', 'while',
    ],

    builtins: [
      'abs', 'all', 'any', 'ceil', 'cell', 'char', 'class',
      'clear', 'close', 'deal', 'diag', 'disp', 'double',
      'eig', 'eps', 'error', 'eval', 'exist', 'eye',
      'false', 'fclose', 'feval', 'fft', 'figure', 'find',
      'floor', 'fopen', 'fprintf', 'getfield', 'hold',
      'ifft', 'imag', 'inf', 'int32', 'inv', 'ischar',
      'isempty', 'isequal', 'isfield', 'isnan', 'isnumeric',
      'length', 'linspace', 'logical', 'max', 'mean', 'min',
      'mod', 'nan', 'nargin', 'nargout', 'norm', 'numel',
      'ones', 'pi', 'plot', 'rand', 'randn', 'real',
      'regexp', 'repmat', 'reshape', 'round', 'set',
      'setfield', 'single', 'size', 'sort', 'sparse',
      'sprintf', 'sqrt', 'squeeze', 'strcmp', 'struct',
      'subplot', 'sum', 'title', 'true', 'uint8', 'uint32',
      'varargin', 'varargout', 'warning', 'xlabel',
      'ylabel', 'zeros',
    ],

    operators: [
      '=', '==', '~=', '>', '<', '>=', '<=', '+', '-',
      '*', '/', '\\', '^', '.^', '.*', './', '.\\',
      '&', '|', '&&', '||', '~', ':',
    ],

    symbols: /[=><!~?:&|+\-*/^%]+/,
    escapes: /\\(?:[abfnrtv\\"'?]|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4})/,

    tokenizer: {
      root: [
        // Block comments: %{ ... %}
        [/%\{/, 'comment', '@blockComment'],
        // Line comments: % to end of line
        [/%.*$/, 'comment'],

        // Identifiers (+ keyword / builtin classification)
        [
          /[a-zA-Z_][\w]*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@builtins': 'type.identifier',
              '@default': 'identifier',
            },
          },
        ],

        // Numbers — complex suffix first, then scientific,
        // then float, then integer.
        [/\d+\.\d+([eE][-+]?\d+)?[ij]?/, 'number.float'],
        [/\d+[eE][-+]?\d+[ij]?/, 'number.float'],
        [/\d+[ij]?/, 'number'],

        // Strings: double-quoted (newer MATLAB, supports escapes)
        [/"/, 'string', '@dstring'],

        // Transpose vs string: `'` directly after an
        // identifier, `]`, `)`, or `.` is the transpose
        // operator; otherwise it opens a string. Monaco's
        // Monarch state machine doesn't have lookbehind, so
        // we handle this at the token level — after a
        // non-whitespace non-operator char the lexer is in
        // a state where `'` is transpose; we approximate
        // via brackets and an explicit "after identifier"
        // rule.
        [/([a-zA-Z_][\w]*|\]|\))'/, [
          { token: '@rematch', next: '@popall' },
        ]],
        [/'/, 'string', '@sstring'],

        // Operators
        [
          /@symbols/,
          {
            cases: {
              '@operators': 'operator',
              '@default': '',
            },
          },
        ],

        // Brackets and delimiters
        [/[()\[\]{}]/, '@brackets'],
        [/[,;]/, 'delimiter'],

        // Whitespace
        [/\s+/, 'white'],
      ],

      blockComment: [
        [/[^%]+/, 'comment'],
        [/%\}/, 'comment', '@pop'],
        [/./, 'comment'],
      ],

      sstring: [
        [/[^']+/, 'string'],
        [/''/, 'string'], // escaped single quote
        [/'/, 'string', '@pop'],
      ],

      dstring: [
        [/[^\\"]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/"/, 'string', '@pop'],
      ],
    },
  });
}

// Install worker env and register MATLAB as side effects
// at module load. Callers importing this module get both
// automatically; tests that need to opt out should mock
// the module rather than importing it.
installMonacoWorkerEnvironment();
registerMatlabLanguage();

// Re-export monaco so callers can import everything through
// this module. Keeps import ordering correct — importing
// monaco directly in the viewer would run monaco's module
// init before our setup.
export { monaco };