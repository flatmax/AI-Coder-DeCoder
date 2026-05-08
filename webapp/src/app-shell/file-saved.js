// File-save handlers extracted from app-shell.js. Routes editor
// saves to the right backend RPC (config files vs normal files)
// and refreshes open viewers after working-tree reverts.

/**
 * Route a `file-saved` event from the diff viewer to
 * the right backend RPC. Normal files go to
 * `Repo.write_file`; files flagged as config route to
 * `Settings.save_config_content` instead (the settings
 * tab uses the diff viewer for config editing).
 *
 * On failure, surfaces a toast. On success, no toast —
 * the viewer's LED flips from dirty to clean, which is
 * feedback enough for a routine save.
 */
export async function onFileSaved(host, event) {
  const detail = event.detail || {};
  const { path, content, isConfig, configType } = detail;
  if (typeof path !== 'string' || !path) return;
  if (typeof content !== 'string') return;
  if (!host.call) {
    host._showToast('Save failed: not connected', 'error');
    return;
  }
  try {
    if (isConfig && configType) {
      const fn = host.call['Settings.save_config_content'];
      if (typeof fn !== 'function') {
        host._showToast('Save failed: settings RPC unavailable', 'error');
        return;
      }
      const raw = await fn(configType, content);
      // Unwrap single-key envelope.
      let result = raw;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const keys = Object.keys(raw);
        if (keys.length === 1) {
          const inner = raw[keys[0]];
          if (inner && typeof inner === 'object') result = inner;
        }
      }
      if (result && result.error) {
        const reason = result.reason || result.error;
        host._showToast(`Save failed: ${reason}`, 'error');
      }
    } else {
      const fn = host.call['Repo.write_file'];
      if (typeof fn !== 'function') {
        host._showToast('Save failed: write RPC unavailable', 'error');
        return;
      }
      const raw = await fn(path, content);
      let result = raw;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const keys = Object.keys(raw);
        if (keys.length === 1) {
          const inner = raw[keys[0]];
          if (inner && typeof inner === 'object') result = inner;
        }
      }
      if (result && result.error) {
        const reason = result.reason || result.error;
        host._showToast(`Save failed: ${reason}`, 'error');
      }
    }
  } catch (err) {
    host._showToast(
      `Save failed: ${err?.message || 'RPC error'}`,
      'error',
    );
  }
}

/**
 * Refresh open viewers after a working-tree revert.
 * Dispatched by files-tab on Discard Changes (and
 * future stage-rollback / reset paths). Mirrors the
 * refresh logic in streamComplete and commitResult —
 * refreshOpenFiles on the diff and SVG viewers
 * re-fetches content for each open file, swapping
 * stale modified buffers for the new on-disk state.
 *
 * The event detail.paths is informational today
 * (logs / future filtering); refreshOpenFiles
 * re-fetches ALL open files rather than just the
 * listed ones, which is simpler and cheap (each
 * viewer iterates only its own open set).
 */
export function onFilesReverted(host, _event) {
  const diffViewer =
    host.shadowRoot?.querySelector('ac-diff-viewer');
  const svgViewer =
    host.shadowRoot?.querySelector('ac-svg-viewer');
  if (diffViewer && typeof diffViewer.refreshOpenFiles === 'function') {
    diffViewer.refreshOpenFiles().catch((err) => {
      console.warn(
        '[app-shell] diff viewer refresh after revert failed', err,
      );
    });
  }
  if (svgViewer && typeof svgViewer.refreshOpenFiles === 'function') {
    svgViewer.refreshOpenFiles().catch((err) => {
      console.warn(
        '[app-shell] svg viewer refresh after revert failed', err,
      );
    });
  }
}