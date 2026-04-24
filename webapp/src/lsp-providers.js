// LSP providers — wire Monaco's language-service
// extension points to backend RPCs.
//
// Four providers, registered once at install time
// against the '*' wildcard selector so they apply to
// every language. Backend dispatches by file extension
// via the symbol-index reference graph.
//
//   - HoverProvider       → Repo.lsp_get_hover
//   - DefinitionProvider  → Repo.lsp_get_definition
//   - ReferenceProvider   → Repo.lsp_get_references
//   - CompletionProvider  → Repo.lsp_get_completions
//
// Separated from diff-viewer.js so the transformation
// logic (Monaco ↔ RPC coordinate / path / shape
// conversions) is unit-testable without mounting an
// editor. Mirrors markdown-preview.js and tex-preview.js
// layering.
//
// Design decisions pinned by tests below:
//
//   - **Coordinate system.** Monaco's Position is
//     1-indexed on both line and column. Backend symbol
//     index stores the same. No conversion at the RPC
//     boundary — pass through verbatim.
//
//   - **Path conversion.** Monaco model URIs include a
//     leading slash (the URI format wraps file paths
//     that way). Backend expects repo-relative paths
//     with no leading slash. Strip exactly one leading
//     slash when constructing the RPC arg.
//
//   - **Errors swallow.** Any RPC failure logs at debug
//     level and returns null / empty. Monaco accepts
//     null from every provider as "nothing to show";
//     the editor continues functioning. Propagating
//     errors would blow up the hover popup / completion
//     list on transient RPC issues.
//
//   - **Response validation.** Backend may return null
//     when there's nothing at the given position. The
//     provider must distinguish null ("no result") from
//     malformed response (log + treat as null). Both
//     look the same to Monaco; logging helps diagnose
//     RPC contract mismatches.
//
//   - **Wildcard registration.** A single wildcard
//     registration handles every language. Monaco's
//     documented selector list doesn't include `'*'`
//     explicitly but the implementation treats it as
//     "all languages" — see the editor.api.d.ts for
//     `LanguageSelector`. An array of specific language
//     ids would also work but requires maintaining the
//     list in sync with `monaco-setup.js`.
//
//   - **Install once.** The `installed` flag prevents
//     double-registration across editor recreations or
//     viewer remounts. Monaco's provider list doesn't
//     deduplicate — registering twice would fire two
//     hover requests per hover event.

/**
 * Extract a response payload from a jrpc-oo envelope.
 * Backend returns `{uuid: payload}` wrappers for
 * single-remote operation. Tests that inject direct-
 * call fake proxies return the payload unwrapped. This
 * helper handles both shapes.
 *
 * Null / undefined / primitive input passes through.
 * Arrays pass through (they're already payloads).
 *
 * The heuristic: if the object has exactly one key AND
 * the inner value is a non-array object, unwrap. This
 * matches the envelope shape (uuid string → payload
 * object) without clobbering legitimate single-key
 * payloads like `{file: "..."}` where the value is a
 * string.
 *
 * Exported for tests and for diff-viewer.js which uses
 * a private copy — keeping them in sync is a
 * documentation concern, not a code-reuse one; the diff
 * viewer's copy is method-scoped and tuned for its
 * specific callers.
 *
 * @param {*} result
 * @returns {*}
 */
export function unwrapEnvelope(result) {
  if (!result || typeof result !== 'object') return result;
  if (Array.isArray(result)) return result;
  const keys = Object.keys(result);
  if (keys.length !== 1) return result;
  const inner = result[keys[0]];
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner;
  }
  return result;
}

/**
 * Convert a Monaco model URI to a repo-relative path.
 * Model URIs have shape `inmemory://model/N` or
 * `file:///path/to/file` depending on how they were
 * created. The viewer creates models without explicit
 * URIs, so Monaco assigns `inmemory://model/N` by
 * default — not useful as a file path.
 *
 * The diff viewer tracks the actual path separately in
 * its file list, so the provider reaches the path via
 * the `getActivePath` callback rather than deriving it
 * from the model. Exported for test visibility but
 * typically unused in production.
 *
 * @param {object} model — Monaco text model
 * @returns {string} — best-effort path
 */
export function pathFromModel(model) {
  if (!model) return '';
  try {
    const uri = model.uri;
    if (!uri) return '';
    const path = uri.path || '';
    return path.startsWith('/') ? path.slice(1) : path;
  } catch (_) {
    return '';
  }
}

/**
 * Build the HoverProvider object. `getActivePath`
 * returns the currently-active file's repo-relative
 * path; `getCall` returns the RPC proxy (or null).
 *
 * Both are callbacks (not values) because the viewer's
 * state changes across file switches and reconnects,
 * and the provider is registered once — it needs to
 * read current state per-invocation rather than closing
 * over stale references.
 *
 * @param {() => string} getActivePath
 * @param {() => object | null} getCall
 * @returns {{provideHover: Function}}
 */
export function buildHoverProvider(getActivePath, getCall) {
  return {
    async provideHover(model, position) {
      const path = getActivePath();
      if (!path) return null;
      const call = getCall();
      if (!call) return null;
      let result;
      try {
        result = await call['Repo.lsp_get_hover'](
          path,
          position.lineNumber,
          position.column,
        );
      } catch (err) {
        console.debug('[lsp] hover RPC failed', err);
        return null;
      }
      const payload = unwrapEnvelope(result);
      if (!payload || typeof payload !== 'object') return null;
      // Backend contract: `{contents: string | string[]}`.
      // Monaco wants `{contents: [{value: string}]}`.
      const raw = payload.contents;
      if (!raw) return null;
      const list = Array.isArray(raw) ? raw : [raw];
      const contents = list
        .filter((s) => typeof s === 'string' && s.length > 0)
        .map((value) => ({ value }));
      if (contents.length === 0) return null;
      return { contents };
    },
  };
}

/**
 * Build the DefinitionProvider. Backend returns
 * `{file, range}` or null. Monaco wants a Location or
 * Location[] — the `{uri, range}` form.
 *
 * The `monaco` argument is the editor namespace so the
 * provider can call `monaco.Uri.file` to build the target
 * URI. Injecting rather than importing lets tests pass a
 * mock without ESM mock machinery.
 *
 * Cross-file navigation goes through Monaco's code editor
 * service (which the diff viewer patches). Returning a
 * Location with a different URI is what triggers that
 * path.
 *
 * @param {object} monaco — Monaco namespace
 * @param {() => string} getActivePath
 * @param {() => object | null} getCall
 * @returns {{provideDefinition: Function}}
 */
export function buildDefinitionProvider(monaco, getActivePath, getCall) {
  return {
    async provideDefinition(model, position) {
      const path = getActivePath();
      if (!path) return null;
      const call = getCall();
      if (!call) return null;
      let result;
      try {
        result = await call['Repo.lsp_get_definition'](
          path,
          position.lineNumber,
          position.column,
        );
      } catch (err) {
        console.debug('[lsp] definition RPC failed', err);
        return null;
      }
      const payload = unwrapEnvelope(result);
      if (!payload || typeof payload !== 'object') return null;
      if (
        typeof payload.file !== 'string' ||
        !payload.range ||
        typeof payload.range !== 'object'
      ) {
        return null;
      }
      const uri = _fileToUri(monaco, payload.file);
      if (!uri) return null;
      return {
        uri,
        range: _normalizeRange(payload.range),
      };
    },
  };
}

/**
 * Build the ReferenceProvider. Backend returns an array
 * of `{file, range}` objects. Monaco wants Location[].
 *
 * Empty array is valid — Monaco shows "no references" in
 * that case. Null is also valid and behaves identically.
 * We return [] for empty and null for malformed so the
 * "no references" vs "RPC broken" distinction is
 * preserved in the console log.
 *
 * @param {object} monaco
 * @param {() => string} getActivePath
 * @param {() => object | null} getCall
 * @returns {{provideReferences: Function}}
 */
export function buildReferenceProvider(monaco, getActivePath, getCall) {
  return {
    async provideReferences(model, position) {
      const path = getActivePath();
      if (!path) return null;
      const call = getCall();
      if (!call) return null;
      let result;
      try {
        result = await call['Repo.lsp_get_references'](
          path,
          position.lineNumber,
          position.column,
        );
      } catch (err) {
        console.debug('[lsp] references RPC failed', err);
        return null;
      }
      const payload = unwrapEnvelope(result);
      if (payload == null) return [];
      if (!Array.isArray(payload)) {
        console.debug('[lsp] references: non-array payload', payload);
        return null;
      }
      const locations = [];
      for (const entry of payload) {
        if (!entry || typeof entry !== 'object') continue;
        if (
          typeof entry.file !== 'string' ||
          !entry.range ||
          typeof entry.range !== 'object'
        ) {
          continue;
        }
        const uri = _fileToUri(monaco, entry.file);
        if (!uri) continue;
        locations.push({
          uri,
          range: _normalizeRange(entry.range),
        });
      }
      return locations;
    },
  };
}

/**
 * Build the CompletionItemProvider. Backend returns an
 * array of `{label, kind, detail, insertText?,
 * documentation?}`. Monaco wants `{suggestions: [...]}`
 * with each item carrying a range. We fill in a range
 * from the word-at-position so completions replace the
 * in-progress identifier.
 *
 * `kind` — backend returns an integer from Monaco's
 * `CompletionItemKind` enum. Validate it's in-range
 * (0-25) and clamp to `Text` (0) on mismatch. Matches
 * specs4's "clamp to valid values" guidance.
 *
 * `triggerCharacters` — `.` covers dotted access in most
 * languages. Ctrl+Space always opens completions
 * regardless of trigger chars.
 *
 * @param {object} monaco
 * @param {() => string} getActivePath
 * @param {() => object | null} getCall
 * @returns {{triggerCharacters: string[], provideCompletionItems: Function}}
 */
export function buildCompletionProvider(monaco, getActivePath, getCall) {
  return {
    triggerCharacters: ['.'],
    async provideCompletionItems(model, position) {
      const path = getActivePath();
      if (!path) return { suggestions: [] };
      const call = getCall();
      if (!call) return { suggestions: [] };
      let result;
      try {
        result = await call['Repo.lsp_get_completions'](
          path,
          position.lineNumber,
          position.column,
        );
      } catch (err) {
        console.debug('[lsp] completions RPC failed', err);
        return { suggestions: [] };
      }
      const payload = unwrapEnvelope(result);
      if (payload == null) return { suggestions: [] };
      if (!Array.isArray(payload)) {
        console.debug('[lsp] completions: non-array payload', payload);
        return { suggestions: [] };
      }
      // Word-at-position gives Monaco the range to
      // replace when the user accepts a suggestion. If
      // the cursor isn't on a word, fall back to an
      // empty range at the current position.
      let range;
      try {
        const word = model.getWordUntilPosition?.(position);
        if (word) {
          range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
        }
      } catch (_) {}
      if (!range) {
        range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column,
          endColumn: position.column,
        };
      }
      const suggestions = [];
      for (const entry of payload) {
        if (!entry || typeof entry !== 'object') continue;
        if (typeof entry.label !== 'string' || !entry.label) continue;
        const kind = _normalizeKind(monaco, entry.kind);
        const insertText =
          typeof entry.insertText === 'string'
            ? entry.insertText
            : entry.label;
        const item = {
          label: entry.label,
          kind,
          insertText,
          range,
        };
        if (typeof entry.detail === 'string') {
          item.detail = entry.detail;
        }
        if (typeof entry.documentation === 'string') {
          item.documentation = entry.documentation;
        }
        suggestions.push(item);
      }
      return { suggestions };
    },
  };
}

/**
 * Module-scoped set of monaco namespaces we've already
 * installed providers on. Using a WeakSet rather than a
 * property on the monaco object itself — Vitest's mocked
 * modules trap any undeclared property read with a
 * "No export is defined" error, so `monaco.__acDcLspInstalled`
 * throws before we can even check it. The WeakSet
 * sidesteps the trap entirely; we check membership with
 * a normal method call that doesn't touch monaco's
 * property accessors.
 *
 * In production monaco is a real ES module (not a
 * vitest mock) and the WeakSet works identically.
 */
const _installedMonacos = new WeakSet();

/**
 * Install all four providers with a wildcard selector.
 * Idempotent — a second call does nothing. Returns the
 * list of disposables from the registration calls so
 * tests can inspect or clean up.
 *
 * @param {object} monaco
 * @param {() => string} getActivePath
 * @param {() => object | null} getCall
 * @returns {Array<{dispose: Function}>}
 */
export function installLspProviders(monaco, getActivePath, getCall) {
  if (!monaco || !monaco.languages) return [];
  if (_installedMonacos.has(monaco)) return [];
  _installedMonacos.add(monaco);
  const disposables = [];
  const selector = '*';
  try {
    disposables.push(
      monaco.languages.registerHoverProvider(
        selector,
        buildHoverProvider(getActivePath, getCall),
      ),
    );
  } catch (err) {
    console.debug('[lsp] hover provider registration failed', err);
  }
  try {
    disposables.push(
      monaco.languages.registerDefinitionProvider(
        selector,
        buildDefinitionProvider(monaco, getActivePath, getCall),
      ),
    );
  } catch (err) {
    console.debug('[lsp] definition provider registration failed', err);
  }
  try {
    disposables.push(
      monaco.languages.registerReferenceProvider(
        selector,
        buildReferenceProvider(monaco, getActivePath, getCall),
      ),
    );
  } catch (err) {
    console.debug('[lsp] reference provider registration failed', err);
  }
  try {
    disposables.push(
      monaco.languages.registerCompletionItemProvider(
        selector,
        buildCompletionProvider(monaco, getActivePath, getCall),
      ),
    );
  } catch (err) {
    console.debug('[lsp] completion provider registration failed', err);
  }
  return disposables;
}

/**
 * Test-only hook to reset the install guard so the
 * install function can be exercised fresh per test.
 * Production code never calls this.
 */
export function _resetInstallGuard(monaco) {
  if (monaco) _installedMonacos.delete(monaco);
}

// -------------------------------------------------------
// Internal helpers
// -------------------------------------------------------

/**
 * Build a Monaco Uri from a repo-relative file path.
 * Uses `monaco.Uri.file` which prefixes with `file://`
 * and handles platform-specific path separators.
 *
 * Returns null when the input is empty or monaco.Uri is
 * unavailable (test fixtures that mock monaco partially).
 */
function _fileToUri(monaco, path) {
  if (typeof path !== 'string' || !path) return null;
  try {
    if (monaco?.Uri?.file) {
      return monaco.Uri.file(path);
    }
    // Defensive fallback — synthesize a plausible Uri
    // shape so tests that mock monaco without Uri.file
    // still receive something structured. Production
    // Monaco always has Uri.file.
    return {
      scheme: 'file',
      path: path.startsWith('/') ? path : '/' + path,
      toString() {
        return 'file://' + this.path;
      },
    };
  } catch (_) {
    return null;
  }
}

/**
 * Normalize a backend range object to Monaco's IRange
 * shape. Backend returns snake_case keys in some
 * contexts (`start_line_number`) and camelCase in
 * others; accept both.
 *
 * Defaults cover malformed ranges — (1,1) through (1,1)
 * is a valid zero-width range at the start of file.
 */
function _normalizeRange(range) {
  const startLine =
    range.startLineNumber ?? range.start_line ?? 1;
  const startCol =
    range.startColumn ?? range.start_column ?? 1;
  const endLine =
    range.endLineNumber ?? range.end_line ?? startLine;
  const endCol =
    range.endColumn ?? range.end_column ?? startCol;
  return {
    startLineNumber: Math.max(1, startLine),
    startColumn: Math.max(1, startCol),
    endLineNumber: Math.max(1, endLine),
    endColumn: Math.max(1, endCol),
  };
}

/**
 * Clamp a completion-item kind to a valid value from
 * `monaco.languages.CompletionItemKind`. Backend should
 * send integers matching the enum; invalid values
 * degrade to `Text` (the "I don't know what this is"
 * kind).
 */
function _normalizeKind(monaco, kind) {
  const fallback = monaco?.languages?.CompletionItemKind?.Text ?? 0;
  if (typeof kind !== 'number' || !Number.isFinite(kind)) {
    return fallback;
  }
  // Monaco's enum has 0..25 at the time of this writing.
  // Clamping to [0, 30] leaves headroom for future
  // additions without needing to update here.
  if (kind < 0 || kind > 30) return fallback;
  return kind;
}