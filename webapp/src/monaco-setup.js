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
 * Worker environment installation has moved to
 * `./monaco-env.js`, which is imported at the top of
 * this file. The env module runs before Monaco itself
 * so `self.MonacoEnvironment` is set by the time Monaco
 * captures it.
 *
 * Kept as a no-op function for any external caller that
 * may still import it. Returns immediately; the real
 * work happened at module-init time in monaco-env.js.
 */
export function installMonacoWorkerEnvironment() {
  // no-op — see ./monaco-env.js
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

/**
 * Register LaTeX language with Monaco.
 *
 * Monaco has no built-in LaTeX. Like MATLAB, registration
 * must run at module load time — an editor constructed
 * with language 'latex' before registration renders as
 * plain text.
 *
 * The tokenizer covers:
 *   - Line comments (`% ...`) — `%` is TeX's comment char
 *   - Backslash commands (`\section`, `\begin`, etc.)
 *   - Math delimiters ($...$, $$...$$, \(...\), \[...\])
 *   - Braces and brackets as delimiters
 *   - Environment begin/end as keywords
 *
 * Not a full TeX parser — just enough for the diff editor
 * to show commands, comments, and math in distinct
 * colours.
 */
let _latexRegistered = false;

export function registerLatexLanguage() {
  if (_latexRegistered) return;
  _latexRegistered = true;
  monaco.languages.register({ id: 'latex' });
  monaco.languages.setMonarchTokensProvider('latex', {
    defaultToken: '',
    tokenPostfix: '.tex',

    tokenizer: {
      root: [
        // Comments — % to end of line, unless escaped
        // as \%. Escape handling is approximate; real
        // TeX tracks catcodes.
        [/%.*$/, 'comment'],

        // Environment begin/end. `\begin{name}` and
        // `\end{name}` get a keyword highlight.
        [/\\(begin|end)\s*\{/, {
          token: 'keyword',
          next: '@envName',
        }],

        // Generic commands — backslash followed by
        // letters. Optional star for unnumbered variants
        // (\section*, \chapter*, etc.).
        [/\\[a-zA-Z]+\*?/, 'type.identifier'],

        // Single-char escapes — \%, \&, \$, \#, \_, \{,
        // \}, \\. Render as plain string so they don't
        // trip the punctuation rules.
        [/\\[%&$#_{}\\]/, 'string.escape'],

        // Display math: $$ ... $$ on one line.
        [/\$\$/, { token: 'string.math', next: '@displayMath' }],

        // Inline math: $ ... $ (single dollar).
        [/\$/, { token: 'string.math', next: '@inlineMath' }],

        // Display math: \[ ... \]
        [/\\\[/, { token: 'string.math', next: '@bracketMath' }],

        // Inline math: \( ... \)
        [/\\\(/, { token: 'string.math', next: '@parenMath' }],

        // Braces + brackets — delimiters.
        [/[{}]/, '@brackets'],
        [/[\[\]]/, '@brackets'],

        // Numbers.
        [/\d+(\.\d+)?/, 'number'],

        // Whitespace.
        [/\s+/, 'white'],
      ],

      envName: [
        [/[a-zA-Z*]+/, 'type'],
        [/\}/, { token: 'keyword', next: '@pop' }],
      ],

      displayMath: [
        [/\$\$/, { token: 'string.math', next: '@pop' }],
        [/\\[a-zA-Z]+\*?/, 'type.identifier'],
        [/[^$\\]+/, 'string.math'],
        [/[\\$]/, 'string.math'],
      ],

      inlineMath: [
        [/\$/, { token: 'string.math', next: '@pop' }],
        [/\\[a-zA-Z]+\*?/, 'type.identifier'],
        [/[^$\\]+/, 'string.math'],
        [/[\\]/, 'string.math'],
      ],

      bracketMath: [
        [/\\\]/, { token: 'string.math', next: '@pop' }],
        [/\\[a-zA-Z]+\*?/, 'type.identifier'],
        [/[^\\]+/, 'string.math'],
        [/[\\]/, 'string.math'],
      ],

      parenMath: [
        [/\\\)/, { token: 'string.math', next: '@pop' }],
        [/\\[a-zA-Z]+\*?/, 'type.identifier'],
        [/[^\\]+/, 'string.math'],
        [/[\\]/, 'string.math'],
      ],
    },
  });
}

// Register MATLAB + LaTeX at module load as side effects.
// Worker env was installed earlier by ./monaco-env.js
// which is imported before monaco-editor itself.
// `installMonacoWorkerEnvironment()` is called for
// backward compatibility but is now a no-op.
installMonacoWorkerEnvironment();
registerMatlabLanguage();
registerLatexLanguage();

// Re-export monaco so callers can import everything through
// this module. Keeps import ordering correct — importing
// monaco directly in the viewer would run monaco's module
// init before our setup.
export { monaco };