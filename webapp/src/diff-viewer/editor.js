// Monaco editor lifecycle: create, swap, dispose,
// content-change wiring, code-editor-service patching.
// Also dirty tracking + save pipeline + file-type
// predicates that depend on the active file's path.

import { languageForPath, monaco } from '../monaco-setup.js';
import { resolveRelativePath } from '../markdown-preview.js';
import { installLspProviders } from '../lsp-providers.js';
import { installMarkdownLinkProvider } from '../markdown-link-provider.js';

import { getRpcCall } from './fetch.js';
import {
  ensureStyleObserver,
  syncAllStyles,
} from './shadow-styles.js';

/**
 * Build (or rebuild) the Monaco editor against the
 * current container and active content. Idempotent —
 * if an editor already exists, the model is swapped in
 * place rather than the editor recreated.
 */
export function showEditor(host) {
  if (host._file === null && host._virtualComparison === null) {
    return;
  }
  const build = () => {
    if (!host.isConnected) return;
    const container =
      host.shadowRoot?.querySelector('.editor-container');
    if (!container) {
      requestAnimationFrame(build);
      return;
    }
    host._editorContainer = container;
    syncAllStyles(host);
    ensureStyleObserver(host);
    if (!host._editor) {
      createEditor(host);
    } else {
      swapModel(host);
    }
    setReadOnlyForCurrent(host);
  };
  host.updateComplete.then(build);
}

export function createEditor(host) {
  if (!host._editorContainer) return;
  const content = currentContent(host);
  if (!content) return;
  // Install LSP providers on first editor construction.
  // Idempotent across re-creations and across viewer
  // remounts (guard lives on the monaco namespace).
  installLspProviders(
    monaco,
    () => host._file?.path || '',
    () => getRpcCall(),
  );
  // Markdown link provider — Ctrl+click on relative
  // links dispatches navigate-file on the window.
  installMarkdownLinkProvider(
    monaco,
    () => host._file?.path || '',
    (relPath) => {
      if (host._file === null) return;
      const resolved = resolveRelativePath(host._file.path, relPath);
      if (!resolved) return;
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: { path: resolved },
          bubbles: false,
        }),
      );
    },
  );
  try {
    host._editor = monaco.editor.createDiffEditor(
      host._editorContainer,
      {
        theme: 'vs-dark',
        minimap: { enabled: false },
        automaticLayout: true,
        renderSideBySide: !host._previewMode,
        originalEditable: false,
        readOnly: false,
        scrollBeyondLastLine: false,
      },
    );
    const lang = content.language;
    const original = monaco.editor.createModel(
      content.original || '',
      lang,
    );
    const modified = monaco.editor.createModel(
      content.modified || '',
      lang,
    );
    host._editor.setModel({ original, modified });
    setReadOnlyForCurrent(host);
    attachContentChangeListener(host);
    patchCodeEditorService(host);
  } catch (err) {
    console.error('[diff-viewer] editor creation failed', err);
  }
}

export function swapModel(host) {
  if (!host._editor) return;
  const content = currentContent(host);
  if (!content) return;
  try {
    const oldModels = host._editor.getModel();
    const newOriginal = monaco.editor.createModel(
      content.original || '',
      content.language,
    );
    const newModified = monaco.editor.createModel(
      content.modified || '',
      content.language,
    );
    // Disposal order: setModel detaches old, then
    // dispose old. Disposing before setModel throws.
    host._editor.setModel({
      original: newOriginal,
      modified: newModified,
    });
    if (oldModels) {
      try { oldModels.original?.dispose(); } catch (_) {}
      try { oldModels.modified?.dispose(); } catch (_) {}
    }
    setReadOnlyForCurrent(host);
    attachContentChangeListener(host);
  } catch (err) {
    console.error('[diff-viewer] model swap failed', err);
  }
}

/**
 * Return the current content pair + language for
 * Monaco model construction. Dispatches by which slot
 * is active.
 */
export function currentContent(host) {
  if (host._file !== null) {
    return {
      original: host._file.original || '',
      modified: host._file.modified || '',
      language: languageForPath(host._file.path),
      readOnly: !!(host._file.isVirtual || host._file.isReadOnly),
    };
  }
  if (host._virtualComparison !== null) {
    return {
      original: host._virtualComparison.leftContent || '',
      modified: host._virtualComparison.rightContent || '',
      language: 'plaintext',
      readOnly: true,
    };
  }
  return null;
}

export function setReadOnlyForCurrent(host) {
  if (!host._editor) return;
  const modifiedEditor = getModifiedEditor(host);
  if (!modifiedEditor) return;
  const content = currentContent(host);
  const readOnly = !!content?.readOnly;
  try {
    modifiedEditor.updateOptions({ readOnly });
  } catch (_) {
    // Older Monaco versions — harmless.
  }
}

export function getModifiedEditor(host) {
  if (!host._editor) return null;
  try {
    return host._editor.getModifiedEditor?.() || null;
  } catch (_) {
    return null;
  }
}

export function attachContentChangeListener(host) {
  if (host._contentChangeDisposable) {
    try {
      host._contentChangeDisposable.dispose();
    } catch (_) {}
    host._contentChangeDisposable = null;
  }
  const modifiedEditor = getModifiedEditor(host);
  if (!modifiedEditor) return;
  try {
    host._contentChangeDisposable =
      modifiedEditor.onDidChangeModelContent(
        host._onContentChange,
      );
  } catch (_) {
    // Monaco mock without onDidChangeModelContent —
    // harmless in tests.
  }
  refreshEditorScrollListener(host);
}

/**
 * Attach the editor-scroll listener when preview is on;
 * detach when off. Called from attachContentChangeListener
 * (new editor / model swap) and from togglePreview
 * (entering / leaving preview without a swap).
 */
export function refreshEditorScrollListener(host) {
  if (host._editorScrollDisposable) {
    try {
      host._editorScrollDisposable.dispose();
    } catch (_) {}
    host._editorScrollDisposable = null;
  }
  if (!host._previewMode) return;
  const modifiedEditor = getModifiedEditor(host);
  if (!modifiedEditor) return;
  try {
    host._editorScrollDisposable =
      modifiedEditor.onDidScrollChange?.(
        host._onEditorScroll,
      ) || null;
  } catch (_) {
    // Mock without onDidScrollChange.
  }
}

export function onContentChange(host) {
  if (host._file === null) return;
  if (host._file.isVirtual || host._file.isReadOnly) return;
  const modifiedEditor = getModifiedEditor(host);
  if (!modifiedEditor) return;
  try {
    const value = modifiedEditor.getValue();
    host._file = { ...host._file, modified: value };
  } catch (_) {
    return;
  }
  recomputeDirty(host);
  // Live preview — markdown re-renders on every keystroke;
  // TeX deliberately does NOT live-update because the
  // make4ht compile is too expensive for keystroke
  // frequency.
  if (host._previewMode && isMarkdownFile(host._file)) {
    host._updatePreview(host._file.modified);
  }
}

export function patchCodeEditorService(host) {
  if (host._editorServicePatched) return;
  const modifiedEditor = getModifiedEditor(host);
  if (!modifiedEditor) return;
  const svc = modifiedEditor._codeEditorService;
  if (!svc || typeof svc.openCodeEditor !== 'function') return;
  host._editorServicePatched = true;
  svc.openCodeEditor = async (input, source, _sideBySide) => {
    try {
      const uri = input?.resource;
      if (uri) {
        let path = uri.path || '';
        if (path.startsWith('/')) path = path.slice(1);
        const line =
          input.options?.selection?.startLineNumber;
        if (path) {
          window.dispatchEvent(
            new CustomEvent('navigate-file', {
              detail: { path, line },
              bubbles: false,
            }),
          );
        }
      }
    } catch (err) {
      console.warn('[diff-viewer] cross-file nav failed', err);
    }
    return source || null;
  };
}

export function disposeEditor(host) {
  if (host._contentChangeDisposable) {
    try {
      host._contentChangeDisposable.dispose();
    } catch (_) {}
    host._contentChangeDisposable = null;
  }
  if (host._editorScrollDisposable) {
    try {
      host._editorScrollDisposable.dispose();
    } catch (_) {}
    host._editorScrollDisposable = null;
  }
  host._detachPreviewScrollListener();
  if (host._scrollLockTimer) {
    clearTimeout(host._scrollLockTimer);
    host._scrollLockTimer = null;
  }
  host._scrollLock = null;
  if (host._editor) {
    const models = host._editor.getModel?.();
    try {
      host._editor.dispose();
    } catch (_) {}
    host._editor = null;
    if (models) {
      try { models.original?.dispose(); } catch (_) {}
      try { models.modified?.dispose(); } catch (_) {}
    }
  }
  host._editorServicePatched = false;
}

// ---------------------------------------------------------------
// Dirty tracking + save + file-type predicates
// ---------------------------------------------------------------

export function isDirty(file) {
  if (!file) return false;
  if (file.isVirtual || file.isReadOnly) return false;
  return file.modified !== file.savedContent;
}

export function isMarkdownFile(file) {
  if (!file || typeof file.path !== 'string') return false;
  const lower = file.path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

export function isTexFile(file) {
  if (!file || typeof file.path !== 'string') return false;
  const lower = file.path.toLowerCase();
  return lower.endsWith('.tex') || lower.endsWith('.latex');
}

export function isPreviewableFile(file) {
  return isMarkdownFile(file) || isTexFile(file);
}

export function isSvgFile(file) {
  if (!file || typeof file.path !== 'string') return false;
  return file.path.toLowerCase().endsWith('.svg');
}

export function recomputeDirty(host) {
  host._dirty = host._file !== null && isDirty(host._file);
}

/**
 * Save the active file. The path argument exists for
 * signature compatibility with callers that still pass
 * it (status-LED click, Ctrl+S); it's validated against
 * the active file and ignored if it doesn't match.
 *
 * TeX preview recompiles on save (markdown already
 * updates per keystroke).
 */
export async function saveFile(host, path) {
  if (host._file === null) return;
  if (path && host._file.path !== path) return;
  if (host._file.isVirtual || host._file.isReadOnly) return;
  let content = host._file.modified;
  const modifiedEditor = getModifiedEditor(host);
  try {
    content = modifiedEditor?.getValue?.() ?? host._file.modified;
  } catch (_) {}
  host._file = {
    ...host._file,
    modified: content,
    savedContent: content,
  };
  recomputeDirty(host);
  host.dispatchEvent(
    new CustomEvent('file-saved', {
      detail: {
        path: host._file.path,
        content,
        isConfig: !!host._file.isConfig,
        configType: host._file.configType,
      },
      bubbles: true,
      composed: true,
    }),
  );
  if (host._previewMode && isTexFile(host._file)) {
    host._compileTex(host._file);
  }
}

/**
 * Switch from the text diff editor to the visual SVG
 * viewer. Dispatched on the host so the app shell's
 * viewer-router swaps elements.
 */
export function switchToVisualSvg(host) {
  if (host._file === null) return;
  const file = host._file;
  const modifiedEditor = getModifiedEditor(host);
  let content = file.modified;
  try {
    content = modifiedEditor?.getValue?.() ?? file.modified;
  } catch (_) {}
  host.dispatchEvent(
    new CustomEvent('toggle-svg-mode', {
      detail: {
        path: file.path,
        target: 'visual',
        modified: content,
        savedContent: file.savedContent,
      },
      bubbles: true,
      composed: true,
    }),
  );
}