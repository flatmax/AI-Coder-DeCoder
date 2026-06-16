// Markdown + TeX preview pane.
//
// Toggle handler swaps the layout (causing Lit to
// re-render the template — full-width diff vs split
// editor+preview) and rebuilds the Monaco editor since
// `renderSideBySide` is a construction-time option.
//
// Markdown renders synchronously on every keystroke
// (via the editor's content-change listener). TeX
// renders only on preview entry and on save — the
// make4ht compile is too expensive for keystroke
// frequency.

import {
  renderMarkdownWithSourceMap,
  resolveRelativePath,
} from '../markdown-preview.js';
import {
  extractTexAnchors,
  injectSourceLines,
  renderTexMath,
} from '../tex-preview.js';

import { _escapeHtml, isAbsoluteUrl } from './constants.js';
import {
  extractBase64Uri,
  extractRpcContent,
  getRpcCall,
  unwrapRpc,
} from './fetch.js';
import {
  disposeEditor,
  isHtmlFile,
  isMarkdownFile,
  isPreviewableFile,
  isTexFile,
  refreshEditorScrollListener,
} from './editor.js';

/**
 * Toggle preview mode. Re-renders the template (which
 * adds or removes the preview pane div), then rebuilds
 * the Monaco editor because `renderSideBySide` is a
 * construction-time option.
 */
export function togglePreview(host) {
  if (host._file === null) return;
  const file = host._file;
  if (!isPreviewableFile(file)) return;
  // Detach the OLD pane's scroll listener before Lit
  // discards the DOM. The listener would leak otherwise.
  detachPreviewScrollListener(host);
  host._previewMode = !host._previewMode;
  host._previewPane = null;
  // Disposing forces a fresh createDiffEditor call with
  // the new renderSideBySide option. The Lit render
  // committing `_previewMode` also moves the editor
  // container div to its new location in the split
  // layout.
  disposeEditor(host);
  host._editorContainer = null;
  host.updateComplete.then(() => {
    host._showEditor();
    if (host._previewMode) {
      updatePreview(host, file.modified);
      attachPreviewScrollListener(host);
      if (isTexFile(file)) {
        compileTex(host, file);
      }
    }
    // Notify the shell so it can persist the preview
    // toggle state immediately. Per the save-triggers
    // table, toggling preview is itself a save event.
    host.dispatchEvent(
      new CustomEvent('preview-mode-changed', {
        detail: {
          path: host._file?.path || null,
          open: host._previewMode,
        },
        bubbles: true,
        composed: true,
      }),
    );
  });
}

/**
 * Render content into the preview pane. Dispatches by
 * file type — markdown renders live from the current
 * editor content; TeX renders from the cached compile
 * state which is updated by `compileTex` on preview
 * entry and on save.
 */
export function updatePreview(host, content) {
  if (!host._previewPane) {
    host._previewPane =
      host.shadowRoot?.querySelector('.preview-pane') || null;
  }
  if (!host._previewPane) return;
  if (host._file === null) return;
  if (isTexFile(host._file)) {
    renderTexPreviewFromState(host);
    return;
  }
  if (isHtmlFile(host._file)) {
    renderHtmlPreview(host, content || '');
    return;
  }
  try {
    const html = renderMarkdownWithSourceMap(content || '');
    host._previewPane.innerHTML = html;
  } catch (err) {
    console.error('[diff-viewer] preview render failed', err);
  }
  host._imageResolveGeneration += 1;
  resolvePreviewImages(host, host._imageResolveGeneration);
}

/**
 * Render an HTML file into a sandboxed iframe inside the
 * preview pane. Repo HTML is rendered live but isolated:
 * the `sandbox` attribute (no `allow-scripts`) disables
 * scripts and keeps the document's own styles from
 * leaking into the app. Relative resource refs inside the
 * HTML won't resolve (no base URL on disk), which is an
 * accepted limitation — the preview is for structure and
 * inline content, not a full-fidelity browser.
 */
export function renderHtmlPreview(host, content) {
  if (!host._previewPane) {
    host._previewPane =
      host.shadowRoot?.querySelector('.preview-pane') || null;
  }
  if (!host._previewPane) return;
  if (host._file === null) return;
  try {
    const iframe = document.createElement('iframe');
    iframe.className = 'html-preview-frame';
    iframe.setAttribute('sandbox', '');
    iframe.setAttribute('srcdoc', content || '');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    host._previewPane.innerHTML = '';
    host._previewPane.appendChild(iframe);
  } catch (err) {
    console.error('[diff-viewer] html preview render failed', err);
  }
}

/**
 * Write the TeX preview pane's content from the active
 * file's compile state. State lives on the file object
 * itself (`_file.texCompile`) — no separate map.
 */
export function renderTexPreviewFromState(host) {
  if (!host._previewPane) {
    host._previewPane =
      host.shadowRoot?.querySelector('.preview-pane') || null;
  }
  if (!host._previewPane) return;
  if (host._file === null) return;
  const state = host._file.texCompile;
  if (!state) {
    host._previewPane.innerHTML =
      '<div class="tex-preview-placeholder">' +
      'Save the file to compile and preview.</div>';
    return;
  }
  if (state.loading) {
    host._previewPane.innerHTML =
      '<div class="tex-preview-loading">Compiling…</div>';
    return;
  }
  if (state.error) {
    host._previewPane.innerHTML = renderTexError(state);
    return;
  }
  if (state.html) {
    host._previewPane.innerHTML = state.html;
    return;
  }
  host._previewPane.innerHTML =
    '<div class="tex-preview-placeholder">' +
    'No preview available.</div>';
}

/**
 * Build the error HTML for a failed TeX compilation.
 * Install-hint case gets a distinct style since it's
 * the "you need to install something" path rather than
 * a code-level compile error.
 */
export function renderTexError(state) {
  const parts = [];
  if (state.installHint) {
    parts.push(
      '<div class="tex-preview-install-hint">',
      '<strong>TeX preview requires make4ht.</strong>',
      '<p>' + _escapeHtml(state.installHint) + '</p>',
      '</div>',
    );
  } else {
    parts.push(
      '<div class="tex-preview-error">',
      '<strong>Compilation failed.</strong>',
      '<p>' + _escapeHtml(state.error || 'Unknown error') + '</p>',
      '</div>',
    );
  }
  if (state.log) {
    parts.push(
      '<details class="tex-preview-log">',
      '<summary>Compilation log</summary>',
      '<pre>' + _escapeHtml(state.log) + '</pre>',
      '</details>',
    );
  }
  return parts.join('');
}

/**
 * Compile the active TeX file via Repo.compile_tex_preview
 * and update the preview pane. Runs the availability
 * probe on first call if not cached.
 *
 * Generation counter discards stale results: rapid saves
 * race, only the latest compile's output lands in the
 * pane.
 */
export async function compileTex(host, file) {
  if (!isTexFile(file)) return;
  const path = file.path;
  const gen = ++host._texCompileGeneration;
  const setState = (state) => {
    if (host._file === null || host._file.path !== path) return;
    host._file = { ...host._file, texCompile: state };
    renderTexPreviewIfActive(host, path);
  };
  setState({ loading: true });
  const call = getRpcCall();
  if (!call) {
    if (gen !== host._texCompileGeneration) return;
    setState({ error: 'RPC unavailable' });
    return;
  }
  if (host._texPreviewAvailable === null) {
    try {
      const result = await call['Repo.is_tex_preview_available']();
      const unwrapped = unwrapRpc(result);
      if (unwrapped &&
          typeof unwrapped === 'object' &&
          unwrapped.available === false) {
        host._texPreviewAvailable = false;
        if (gen !== host._texCompileGeneration) return;
        setState({
          error: 'make4ht not installed',
          installHint:
            unwrapped.install_hint ||
            'Install TeX Live or MiKTeX to enable TeX preview.',
        });
        return;
      }
      host._texPreviewAvailable = true;
    } catch (_) {
      host._texPreviewAvailable = false;
      if (gen !== host._texCompileGeneration) return;
      setState({
        error: 'Availability check failed',
        installHint:
          'Ensure make4ht is installed and on PATH.',
      });
      return;
    }
  }
  if (host._texPreviewAvailable === false) {
    if (gen !== host._texCompileGeneration) return;
    setState({
      error: 'make4ht not installed',
      installHint:
        'Install TeX Live or MiKTeX to enable TeX preview.',
    });
    return;
  }
  let result;
  try {
    result = await call['Repo.compile_tex_preview'](
      file.modified || '',
      path,
    );
  } catch (err) {
    if (gen !== host._texCompileGeneration) return;
    setState({ error: err?.message || 'Compilation RPC failed' });
    return;
  }
  if (gen !== host._texCompileGeneration) return;
  const unwrapped = unwrapRpc(result);
  if (unwrapped && unwrapped.error) {
    setState({
      error: unwrapped.error,
      log: unwrapped.log,
      installHint: unwrapped.install_hint,
    });
  } else if (unwrapped && typeof unwrapped.html === 'string') {
    const mathed = renderTexMath(unwrapped.html);
    const anchors = extractTexAnchors(file.modified || '');
    const totalLines = (file.modified || '').split('\n').length;
    const annotated = injectSourceLines(
      mathed,
      anchors,
      totalLines,
    );
    setState({ html: annotated });
  } else {
    setState({ error: 'Malformed compile response' });
  }
}

/**
 * Refresh the preview pane if the given path is the
 * currently-active file AND preview mode is on.
 */
export function renderTexPreviewIfActive(host, path) {
  if (!host._previewMode) return;
  if (host._file === null) return;
  if (host._file.path !== path) return;
  renderTexPreviewFromState(host);
}

/**
 * Wire up bidirectional scroll sync. The preview pane
 * emits scroll events; the editor side is wired in
 * refreshEditorScrollListener.
 */
export function attachPreviewScrollListener(host) {
  if (!host._previewPane) {
    host._previewPane =
      host.shadowRoot?.querySelector('.preview-pane') || null;
  }
  if (!host._previewPane) return;
  host._previewPane.addEventListener(
    'scroll',
    host._onPreviewScroll,
    { passive: true },
  );
  host._previewPane.addEventListener(
    'click',
    host._onPreviewClick,
  );
  refreshEditorScrollListener(host);
}

export function detachPreviewScrollListener(host) {
  if (host._previewPane) {
    try {
      host._previewPane.removeEventListener(
        'scroll',
        host._onPreviewScroll,
      );
    } catch (_) {}
    try {
      host._previewPane.removeEventListener(
        'click',
        host._onPreviewClick,
      );
    } catch (_) {}
  }
}

// ---------------------------------------------------------------
// Image + link resolution
// ---------------------------------------------------------------

/**
 * Resolve relative image refs in the rendered preview.
 * Runs as a post-processing step after updatePreview;
 * the `generation` argument lets us discard stale
 * fetches when a newer render has already landed.
 */
export async function resolvePreviewImages(host, generation) {
  if (host._file === null) return;
  if (!host._previewPane) return;
  const file = host._file;
  const imgs = host._previewPane.querySelectorAll('img');
  if (imgs.length === 0) return;
  const call = getRpcCall();
  if (!call) return;
  const tasks = [];
  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    if (!src) continue;
    if (isAbsoluteUrl(src)) continue;
    tasks.push(resolveOneImage(host, img, src, file, call, generation));
  }
  Promise.all(tasks).catch(() => {
    // Individual failures already handled inside
    // resolveOneImage; this catch is purely defensive.
  });
}

export async function resolveOneImage(
  host, img, src, file, call, generation,
) {
  let relPath;
  try {
    relPath = decodeURIComponent(src);
  } catch (_) {
    relPath = src;
  }
  const resolved = resolveRelativePath(file.path, relPath);
  if (!resolved || isAbsoluteUrl(resolved)) return;
  const isSvg = resolved.toLowerCase().endsWith('.svg');
  try {
    let dataUri;
    if (isSvg) {
      const result = await call['Repo.get_file_content'](resolved);
      const text = extractRpcContent(result);
      if (!text) {
        markImageMissing(host, img, resolved, generation);
        return;
      }
      dataUri =
        'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(text);
    } else {
      const result = await call['Repo.get_file_base64'](resolved);
      dataUri = extractBase64Uri(result);
      if (!dataUri) {
        markImageMissing(host, img, resolved, generation);
        return;
      }
    }
    if (generation !== host._imageResolveGeneration) return;
    img.setAttribute('src', dataUri);
  } catch (err) {
    markImageFailed(host, img, resolved, err, generation);
  }
}

export function markImageMissing(host, img, path, generation) {
  if (generation !== host._imageResolveGeneration) return;
  img.setAttribute('alt', `[Image not found: ${path}]`);
  img.style.opacity = '0.4';
}

export function markImageFailed(host, img, path, err, generation) {
  if (generation !== host._imageResolveGeneration) return;
  const message = err?.message || 'unknown error';
  img.setAttribute(
    'alt',
    `[Failed to load: ${path} — ${message}]`,
  );
  img.style.opacity = '0.4';
}

/**
 * Intercept clicks on relative <a href> elements in
 * the preview pane. Absolute URLs and fragment-only
 * refs pass through to the browser's default behavior.
 * Relative paths resolve against the current file's
 * directory and dispatch navigate-file events.
 */
export function onPreviewClick(host, event) {
  const anchor = event.target?.closest?.('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href) return;
  if (isAbsoluteUrl(href)) return;
  if (href.startsWith('#')) return;
  if (href.startsWith('/')) return;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;
  if (host._file === null) return;
  let relPath;
  try {
    relPath = decodeURIComponent(href);
  } catch (_) {
    relPath = href;
  }
  const hashIdx = relPath.indexOf('#');
  const pathPart =
    hashIdx >= 0 ? relPath.slice(0, hashIdx) : relPath;
  const resolved = resolveRelativePath(host._file.path, pathPart);
  if (!resolved || isAbsoluteUrl(resolved)) return;
  event.preventDefault();
  window.dispatchEvent(
    new CustomEvent('navigate-file', {
      detail: { path: resolved },
      bubbles: false,
    }),
  );
}

// Re-export so the host class can wire its bound
// handlers through the same module.
export { isHtmlFile, isMarkdownFile, isPreviewableFile, isTexFile };