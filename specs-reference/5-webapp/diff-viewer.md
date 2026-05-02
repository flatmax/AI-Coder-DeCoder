# Reference: Diff Viewer

**Supplements:** `specs4/5-webapp/diff-viewer.md`

This is the canonical owner for Monaco configuration detail (worker paths, module entry, MATLAB tokenizer, language map) and virtual-file schemas. Consumers (SVG viewer for mode-toggle dispatch; chat panel for edit-block goto) reference here rather than duplicate.

## Byte-level formats

### Language detection map

Maps file extensions (case-insensitive, lowercase-compared after normalization) to Monaco language IDs. Extensions not in the map fall back to `plaintext`.

| Extension(s) | Language ID |
|---|---|
| `.js`, `.mjs`, `.cjs`, `.jsx` | `javascript` |
| `.ts`, `.tsx` | `typescript` |
| `.py`, `.pyw`, `.pyi` | `python` |
| `.json`, `.jsonc` | `json` |
| `.yaml`, `.yml` | `yaml` |
| `.html`, `.htm` | `html` |
| `.css` | `css` |
| `.scss` | `scss` |
| `.less` | `less` |
| `.md`, `.markdown` | `markdown` |
| `.c`, `.h` | `c` |
| `.cpp`, `.hpp`, `.cc`, `.hh`, `.cxx`, `.hxx` | `cpp` |
| `.sh`, `.bash`, `.zsh` | `shell` |
| `.m` | `matlab` |
| `.java` | `java` |
| `.rs` | `rust` |
| `.go` | `go` |
| `.rb` | `ruby` |
| `.php` | `php` |
| `.sql` | `sql` |
| `.toml` | `toml` |
| `.ini`, `.cfg`, `.conf` | `ini` |
| `.xml`, `.svg` | `xml` |
| `.tex`, `.latex` | `latex` |
| `.dockerfile`, `Dockerfile` (no extension) | `dockerfile` |
| `.makefile`, `Makefile` (no extension) | `makefile` |

Two extensions deliberately split conventions:

- `.h` resolves to `c`, not `cpp` — matches the symbol index's language-for-file rule (see `specs-reference/2-indexing/symbol-index.md` § dependency quirks). Mixed-language repos stay consistent between viewer highlighting and symbol extraction.
- `.svg` resolves to `xml` for the diff viewer's text-mode fallback. When the SVG viewer is active, it's not a diff-viewer concern; see `specs4/5-webapp/svg-viewer.md` for the SVG↔text toggle.

### Monaco package entries

Two import paths matter and must not be confused:

| Path | Purpose | Use when |
|---|---|---|
| `monaco-editor/esm/vs/editor/editor.main.js` | Full editor — programmatic surface + all contribution modules + built-in languages | Always — this is the correct import for the diff viewer |
| `monaco-editor/esm/vs/editor/editor.api.js` | API surface only — no contributions | **Never** — missing find widget, hover, diff decoration renderer, bracket matching, etc. |
| `monaco-editor/esm/vs/editor/editor.worker.js` | Editor web worker entry | Imported from a thin `monaco-worker.js` module, compiled via Vite's `?worker` suffix |

See `specs4/5-webapp/diff-viewer.md` § "Monaco Module Entry" for the full failure-mode diagnosis.

### Worker labels

Monaco's `MonacoEnvironment.getWorker(workerId, label)` factory dispatches on `label`. Observed labels:

| Label | Disposition |
|---|---|
| `editorWorkerService` | Real worker — required for diff computation, find widget, word-based autocomplete |
| `ts`, `typescript` | No-op stub — backend LSP handles TypeScript features |
| `json` | No-op stub — JSON validation unused |
| `css`, `scss`, `less` | No-op stub — stylesheet validation unused |
| `html` | No-op stub — HTML validation unused |
| (any other) | No-op stub (default branch) |

The no-op stub constructs a Blob worker from `'self.onmessage = function() {}'` and returns it. Monaco's language-service dispatches never expect replies from these workers.

### Worker module entry

Vite's `?worker` suffix compiles a thin module as a dedicated Web Worker:

```js
// monaco-worker.js — thin worker entry
import 'monaco-editor/esm/vs/editor/editor.worker.js';

// monaco-setup.js
import EditorWorker from './monaco-worker.js?worker';

self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'editorWorkerService') {
      try { return new EditorWorker(); }
      catch (err) { console.error('[monaco] worker failed', err); }
    }
    const blob = new Blob(
      ['self.onmessage = function() {}'],
      { type: 'application/javascript' }
    );
    return new Worker(URL.createObjectURL(blob));
  },
};
```

The `?worker` suffix is Vite-specific. Non-Vite bundlers (webpack, esbuild, Rollup) use different conventions — see the bundler's documented Web Worker pattern. The older pattern `new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' })` is unreliable under Vite's dep optimizer and silently produces non-working diff editors (see `specs4/5-webapp/diff-viewer.md` § "Vite + `new URL` pitfall").

### MATLAB Monarch tokenizer vocabulary

Registered once at module load via `monaco.languages.setMonarchTokensProvider('matlab', {...})`. Language ID is `matlab`.

**Keywords** (24 entries, tokenized as `keyword`):

```
break, case, catch, classdef, continue, else, elseif, end,
enumeration, events, for, function, global, if, methods, otherwise,
parfor, persistent, properties, return, spmd, switch, try, while
```

**Builtins** (~80 entries, tokenized as `predefined`):

```
abs, all, any, ceil, cell, char, class, clear, close, deal, diag,
disp, double, eig, eps, error, eval, exist, eye, false, fclose,
feval, fft, figure, find, floor, fopen, fprintf, getfield, hold,
ifft, imag, inf, int32, inv, ischar, isempty, isequal, isfield,
isnan, isnumeric, length, linspace, logical, max, mean, min, mod,
nan, nargin, nargout, norm, numel, ones, pi, plot, rand, randn,
real, regexp, repmat, reshape, round, set, setfield, single, size,
sort, sparse, sprintf, sqrt, squeeze, strcmp, struct, subplot, sum,
title, true, uint8, uint32, varargin, varargout, warning, xlabel,
ylabel, zeros
```

The lists are representative of common MATLAB/Octave code, not exhaustive. Identifiers not in either list tokenize as `identifier`.

### MATLAB Monarch tokenizer rules

Pattern categories (regex source — use Monarch rule syntax per Monaco docs):

| Category | Pattern shape | Token |
|---|---|---|
| Line comment | `%` followed by anything to end-of-line | `comment` |
| Block comment | `%{` ... `%}` (multiline) | `comment` |
| Single-quoted string | `'...'` with escape handling for doubled quotes | `string` |
| Double-quoted string | `"..."` | `string` |
| Integer | Digit sequence | `number` |
| Float | Digit sequence with `.` and/or exponent | `number.float` |
| Complex | Number literal followed by `i` or `j` | `number.complex` |
| Arithmetic operators | `+`, `-`, `*`, `/`, `^` | `operator` |
| Element-wise operators | `.^`, `.*`, `./`, `.\` | `operator` |
| Comparison operators | `==`, `~=`, `<=`, `>=`, `<`, `>` | `operator` |
| Logical operators | `&`, `\|`, `&&`, `\|\|`, `~` | `operator` |
| Transpose | `'` after identifier or closing bracket (context-sensitive dispatch) | `operator` |
| Identifier | `[a-zA-Z_][a-zA-Z0-9_]*` | `identifier` / `keyword` / `predefined` (after lookup) |

The transpose operator must dispatch based on preceding token — `'` after `a` or `)` is transpose; `'` after whitespace or operator is a string open. Standard Monarch `@rematch` / state-machine approach.

### Virtual file path prefixes

Files with these path prefixes are virtual — not fetched from the repository and not subject to repo path validation:

| Prefix | Purpose |
|---|---|
| `virtual://` | Generic virtual file (URL content viewing, ad-hoc content) |
| `virtual://compare` | Dedicated path for `loadPanel` accumulation — two successive loadPanel calls on different sides accumulate here |

### Style injection dataset markers

DOM nodes cloned into the diff viewer's shadow root carry dataset attributes for deduplication:

| Attribute | Purpose |
|---|---|
| `data-monaco-injected="true"` | Applied to every `<style>` and `<link rel="stylesheet">` cloned from `document.head` into the shadow root. The full-resync path finds these by attribute to remove prior clones before re-cloning. |
| `data-katex-css="true"` | Applied to the single KaTeX stylesheet node. KaTeX CSS is imported as a raw string (via Vite's `?raw` suffix) and injected manually rather than via the document-head sync path. Dedup check uses `shadowRoot.querySelector('[data-katex-css]')`. |

## Numeric constants

### Diff-ready timeout

```
2 seconds
```

Applied to `_waitForDiffReady()` — after setting models on the diff editor, wait up to 2 seconds for Monaco's `onDidUpdateDiff` event before proceeding with scroll or decoration operations. Identical-content files never fire the event; the timeout ensures callers don't hang forever.

### Scroll-to-edit highlight duration

```
3 seconds
```

When the chat panel's edit-block goto icon dispatches `navigate-file` with `searchText`, the diff viewer scrolls to the match and applies a `deltaDecorations` highlight. The decoration is cleared via `deltaDecorations(prevIds, [])` after 3 seconds. A second goto during the highlight clears the pending timer and applies a new one.

### Markdown preview scroll-lock release

```
120ms
```

Bidirectional scroll sync (editor ↔ preview) uses a mutex (`_scrollLock` set to `'editor'` or `'preview'`). The handler that initiated the scroll holds the lock while computing the partner's scroll target. Lock auto-releases after 120ms via `setTimeout` — covers Monaco's smooth-scroll duration without suppressing genuine user scrolling on the other side.

### Search-text anchor-matching prefixes

Scroll-to-text (from edit-block goto) tries progressively shorter prefixes of the search text when the full string doesn't match:

| Attempt | Prefix |
|---|---|
| 1 | Full search text verbatim |
| 2 | First two lines (join with `\n`) |
| 3 | First line only |

If none match, no scroll or highlight happens silently. Tolerates whitespace drift between the edit-block old-text anchor and the on-disk content.

### KaTeX CSS sentinel fallback

The KaTeX stylesheet is imported via `katex/dist/katex.min.css?raw` — Vite's raw-string loader returns CSS text. In test environments (vitest's default resolver) the `?raw` suffix isn't understood and the import returns `undefined`. A one-line CSS sentinel is injected in that case so the dedup-by-attribute code path is still exercised:

```
/* katex-css-sentinel */
```

Production sees real KaTeX; tests see the sentinel.

## Schemas

### Active file slot

The diff viewer holds at most one real-file slot. Shape:

```pseudo
FileSlot:
    path: string                  // Repo-relative path, or virtual:// prefixed
    original: string              // HEAD content (empty string for new files)
    modified: string              // Working copy content (empty string for deleted files)
    saved_content: string         // Last-saved content; used for dirty-flag computation
    is_new: bool                  // True when HEAD fetch returned empty (file doesn't exist in HEAD)
    is_read_only: bool?           // True for virtual files
    is_config: bool?              // True when opened as Settings-tab config editor
    config_type: string?          // Settings config type key when is_config is true
    real_path: string?            // Distinguishes virtual:// paths from actual repo paths
```

### Virtual comparison slot

Separate from the active file slot — mutually exclusive. Shape:

```pseudo
VirtualComparison:
    left_content: string
    left_label: string
    right_content: string
    right_label: string
```

Populated by successive `loadPanel(content, panel, label)` calls. Opening any real file clears this slot; the slot is not persisted.

### openFile options

```pseudo
OpenFileOptions:
    path: string                    // Required
    original: string?               // Pre-fetched HEAD content; when absent, fetched via Repo.get_file_content(path, "HEAD")
    modified: string?               // Pre-fetched working content; when absent, fetched via Repo.get_file_content(path)
    line: int?                      // Scroll target after file loads (1-indexed)
    search_text: string?            // Scroll target by substring search; tried after line (or standalone)
    is_new: bool?                   // Force new-file classification (HEAD fetch skipped)
    virtual_content: string?        // For virtual:// paths — content for the modified side (original is empty)
    is_config: bool?                // Opens in config-editor mode
    config_type: string?            // Paired with is_config
    real_path: string?              // Virtual-to-real-path mapping when is_config is used for a file that exists on disk
```

### RPC response normalization

`Repo.get_file_content(path, version?)` may return:

- A plain string — the content
- An object `{content: string}` — same content, wrapped

The diff viewer's fetch helper normalizes both shapes to a plain string via `result?.content ?? result ?? ''`. The same pattern applies to any other RPC that returns text payloads.

## Dependency quirks

### `monaco-editor` npm package

Peer dependency: `monaco-editor ^0.52`. Older versions (0.45 and below) have contribution module changes that break the full-entry import path. Newer minor versions (0.52.x, 0.53.x expected) work identically for the diff viewer's use.

The package name is `monaco-editor`, not `@monaco-editor/...` (those are framework wrappers like react-monaco-editor; the diff viewer uses the raw `monaco-editor` package directly).

### Vite peer dependencies

The worker-loading pattern and KaTeX raw-import pattern both depend on Vite's build-time features:

- `?worker` suffix — Vite's worker compilation pipeline
- `?raw` suffix — Vite's raw-string loader

When migrating to a different bundler (webpack, esbuild, Rollup directly), both suffix conventions change. The Vite-specific import paths live in the setup module (`monaco-setup.js`) and the KaTeX CSS importer; a bundler change requires updating those two locations only.

### Shadow DOM and code-editor-service patch

Monaco's `_codeEditorService.openCodeEditor` is the cross-file Go-to-Definition entry point. The diff viewer patches it once per component lifetime to intercept cross-file navigation and route through the tab system instead of spawning a standalone editor. The patch flag must be an instance-level field (`this._editorServicePatched`), not a service-level or editor-level flag — repeated editor recreations within one component should not re-wrap the already-patched method. A service-level or editor-level flag chains override closures and eventually exhausts the call stack on heavy file switching.

### `katex` npm package

Direct dependency of the diff viewer's TeX preview and markdown preview math extension. Version pinning should match the chat panel's KaTeX usage since both render math expressions and mismatched versions produce subtle rendering differences.

Import path for raw CSS (Vite): `katex/dist/katex.min.css?raw`. The package's CSS file lives at `dist/katex.min.css` relative to the package root; the `?raw` suffix is Vite's loader directive.

### TEXINPUTS trailing separator

The `TEXINPUTS` environment variable set by the TeX preview compile path **must end with an OS path separator** (`:` on Unix, `;` on Windows). Without the trailing separator, an explicit `TEXINPUTS` value replaces the TeX engine's default search paths entirely rather than being prepended to them. System packages installed in the standard TeX trees — most notably `tex4ht.sty` itself — become unresolvable mid-compile, producing a `File `tex4ht.sty' not found` error even when `kpsewhich tex4ht.sty` from a shell resolves it correctly.

The separator rule is a property of every TeX engine (pdfTeX, XeTeX, LuaTeX, htlatex), not something AC-DC chose. It's documented in kpathsea's search-path rules but easy to miss when implementing the compile wrapper. Reimplementers should handle three cases: no existing `TEXINPUTS` → `"${scratch}:"`; existing `TEXINPUTS` → `"${scratch}:${existing}:"`; Windows → same with `;`.

### TeX4HT package detection via `kpsewhich`

`make4ht` is only the driver — it needs the `tex4ht.sty` file from the `tex4ht` TeX package to actually transform documents. `which make4ht` returning a path is necessary but not sufficient for the preview to work.

Probe the package with `kpsewhich tex4ht.sty` — exit code 0 AND non-empty stdout means the file is resolvable. Exit non-zero or empty stdout means the package is missing. On Debian/Ubuntu the package ships in `texlive-plain-generic`; `texlive-full` is the belt-and-braces alternative.

`kpsewhich` ships with every TeX Live distribution, so `shutil.which("kpsewhich") is None` is a reliable "no TeX install at all" signal and should be treated as "package missing" (probe returns False). Subprocess failures (timeout, OSError) should also fail closed as "missing" — the install hint the frontend shows is the actionable path regardless of the specific failure.

Cache the probe result class-side — TeX package installation is out-of-band of the application, so one subprocess per Python process suffices.

## Cross-references

- Behavioral contracts — layout, modes, single-file no-cache model, LSP integration, markdown/TeX preview, concurrent-openFile generation counter, save pipeline, file navigation grid, invariants: `specs4/5-webapp/diff-viewer.md`
- SVG ↔ text mode toggle handler (app shell dispatches `toggle-svg-mode`): `specs4/5-webapp/svg-viewer.md`
- Edit block goto and search-text dispatch: `specs-reference/3-llm/edit-protocol.md` (for marker bytes) + `specs4/5-webapp/chat.md` (for the goto icon's navigate-file dispatch)
- Repository base64 fetch (for preview image resolution): `specs-reference/1-foundation/rpc-inventory.md` § `Repo.get_file_base64`
- Monaco worker configuration guidance with diagnostic probe: `specs4/5-webapp/diff-viewer.md` § "Monaco Worker Configuration"