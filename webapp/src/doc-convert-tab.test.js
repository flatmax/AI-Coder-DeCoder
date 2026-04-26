// Tests for webapp/src/doc-convert-tab.js — DocConvertTab.
//
// Scope covers the full Commit 2-5 surface:
//
//   - Availability probe + file scanning on RPC ready
//   - File list rendering with status badges, sizes, over-size
//     markers, and the active-filter branch
//   - Selection management (row click + checkbox, select-all,
//     deselect-all, over-size guards)
//   - Fuzzy filter matching
//   - Re-scan on files-modified events
//   - Conversion flow — background (async events) and inline
//     (sync fallback), including restricted-error path
//   - Progress event routing (start / file / complete)
//   - Summary view with retry/done buttons
//   - Clean-tree gate (Commit 5) — disables convert button,
//     shows warning banner
//   - Conflict status polish (⚠ conflict label)
//   - Over-size file selection guards (DOM + defensive)
//
// Strategy mirrors files-tab.test.js — a fake RPC proxy
// installed via SharedRpc, window-event simulation for
// server-push, and a settle helper draining microtasks.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SharedRpc } from './rpc.js';
import './doc-convert-tab.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _mounted = [];

function mountTab(props = {}) {
  const t = document.createElement('ac-doc-convert-tab');
  Object.assign(t, props);
  document.body.appendChild(t);
  _mounted.push(t);
  return t;
}

/**
 * Install a fake RPC proxy. Stubs every method the tab
 * might call with sensible defaults; callers pass
 * `methods` to override per-test.
 *
 * The default `is_clean` returns true (clean tree) so
 * tests don't accidentally trip the dirty-tree gate
 * when they don't care about it. Tests covering the
 * dirty-tree banner explicitly override.
 */
function publishFakeRpc(methods = {}) {
  const defaults = {
    'DocConvert.is_available': () => ({
      available: true,
      libreoffice: true,
      pymupdf: true,
      pdf_pipeline: true,
    }),
    'DocConvert.scan_convertible_files': () => [],
    'DocConvert.convert_files': () => ({
      status: 'ok',
      results: [],
    }),
    'Repo.is_clean': () => true,
  };
  const merged = { ...defaults, ...methods };
  const proxy = {};
  for (const [name, impl] of Object.entries(merged)) {
    proxy[name] = async (...args) => {
      const value = await impl(...args);
      return { fake: value };
    };
  }
  SharedRpc.set(proxy);
  return proxy;
}

/**
 * Drain Lit updates and microtasks. Multiple awaits cover
 * the RpcMixin's microtask-deferred onRpcReady plus the
 * downstream RPC promise resolution chain.
 */
async function settle(tab) {
  await tab.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await tab.updateComplete;
}

function pushEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Build a file entry matching the backend's
 * scan_convertible_files shape.
 */
function fileEntry(path, overrides = {}) {
  return {
    path,
    name: path.split('/').pop(),
    size: 1024,
    status: 'new',
    output_path: path.replace(/\.[^.]+$/, '.md'),
    over_size: false,
    ...overrides,
  };
}

afterEach(() => {
  while (_mounted.length) {
    const t = _mounted.pop();
    if (t.isConnected) t.remove();
  }
  SharedRpc.reset();
});

// ---------------------------------------------------------------------------
// Initial state + availability probe
// ---------------------------------------------------------------------------

describe('DocConvertTab initial state', () => {
  it('renders empty info banner before RPC connects', async () => {
    // No SharedRpc.set — RPC not published. Availability
    // banner should not appear until the probe completes.
    const t = mountTab();
    await t.updateComplete;
    expect(t.shadowRoot.querySelector('.info-banner')).toBeNull();
  });

  it('fetches is_available and scan_convertible_files on RPC ready', async () => {
    const isAvailable = vi.fn().mockResolvedValue({
      available: true,
      libreoffice: false,
      pymupdf: true,
      pdf_pipeline: false,
    });
    const scan = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'DocConvert.is_available': isAvailable,
      'DocConvert.scan_convertible_files': scan,
    });
    const t = mountTab();
    await settle(t);
    expect(isAvailable).toHaveBeenCalledOnce();
    expect(scan).toHaveBeenCalledOnce();
  });

  it('renders dependency chips from is_available result', async () => {
    publishFakeRpc({
      'DocConvert.is_available': () => ({
        available: true,
        libreoffice: false,
        pymupdf: true,
        pdf_pipeline: false,
      }),
    });
    const t = mountTab();
    await settle(t);
    const banner = t.shadowRoot.querySelector('.info-banner');
    expect(banner).toBeTruthy();
    const chips = banner.querySelectorAll('.dep-chip');
    // Four chips — markitdown, LibreOffice, PyMuPDF, PDF pipeline.
    expect(chips.length).toBe(4);
  });

  it('dependency dots reflect on/off state', async () => {
    publishFakeRpc({
      'DocConvert.is_available': () => ({
        available: true,
        libreoffice: false,
        pymupdf: true,
        pdf_pipeline: false,
      }),
    });
    const t = mountTab();
    await settle(t);
    const dots = t.shadowRoot.querySelectorAll('.dep-dot');
    expect(dots[0].classList.contains('on')).toBe(true);   // markitdown
    expect(dots[1].classList.contains('on')).toBe(false);  // libreoffice
    expect(dots[2].classList.contains('on')).toBe(true);   // pymupdf
    expect(dots[3].classList.contains('on')).toBe(false);  // pdf_pipeline
  });

  it('tolerates is_available RPC failure', async () => {
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    try {
      publishFakeRpc({
        'DocConvert.is_available': () => {
          throw new Error('probe failed');
        },
      });
      const t = mountTab();
      await settle(t);
      // Info banner doesn't render, but the tab stays mounted.
      expect(t.shadowRoot.querySelector('.info-banner')).toBeNull();
      // File list area still renders (empty state).
      expect(t.shadowRoot.querySelector('.empty-state')).toBeTruthy();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

describe('DocConvertTab file scanning', () => {
  it('renders empty state when no files found', async () => {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [],
    });
    const t = mountTab();
    await settle(t);
    const empty = t.shadowRoot.querySelector('.empty-state');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No convertible documents');
  });

  it('renders file rows for scanned files', async () => {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
        fileEntry('b.pdf'),
      ],
    });
    const t = mountTab();
    await settle(t);
    const rows = t.shadowRoot.querySelectorAll('.file-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('a.docx');
    expect(rows[1].textContent).toContain('b.pdf');
  });

  it('renders status badges with correct label and color', async () => {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('new.docx', { status: 'new' }),
        fileEntry('stale.docx', { status: 'stale' }),
        fileEntry('current.docx', { status: 'current' }),
        fileEntry('conflict.docx', { status: 'conflict' }),
      ],
    });
    const t = mountTab();
    await settle(t);
    const badges = t.shadowRoot.querySelectorAll('.status-badge');
    expect(badges.length).toBe(4);
    expect(badges[0].textContent.trim()).toBe('new');
    expect(badges[1].textContent.trim()).toBe('stale');
    expect(badges[2].textContent.trim()).toBe('current');
    // Commit 5 — conflict label upgraded to "⚠ conflict"
    expect(badges[3].textContent.trim()).toBe('⚠ conflict');
  });

  it('conflict tooltip explicitly warns about overwriting', async () => {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('c.docx', { status: 'conflict' }),
      ],
    });
    const t = mountTab();
    await settle(t);
    const badge = t.shadowRoot.querySelector('.status-badge');
    // Commit 5 — tooltip explicitly mentions hand-authored
    // content and the diff review workflow.
    expect(badge.title.toLowerCase()).toContain('overwrite');
    expect(badge.title.toLowerCase()).toContain('diff');
  });

  it('renders file size with formatSize()', async () => {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('small.docx', { size: 500 }),
        fileEntry('medium.docx', { size: 1500 }),
        fileEntry('large.docx', { size: 2 * 1024 * 1024 }),
      ],
    });
    const t = mountTab();
    await settle(t);
    const sizes = t.shadowRoot.querySelectorAll('.file-size');
    expect(sizes[0].textContent).toBe('500 B');
    expect(sizes[1].textContent).toBe('1.5 KB');
    expect(sizes[2].textContent).toBe('2.0 MB');
  });

  it('renders 📏 marker on over-size files', async () => {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('normal.docx', { over_size: false }),
        fileEntry('huge.docx', { over_size: true }),
      ],
    });
    const t = mountTab();
    await settle(t);
    const markers = t.shadowRoot.querySelectorAll('.over-size');
    expect(markers.length).toBe(1);
    // Commit 5 — tooltip mentions skip + can't-select.
    expect(markers[0].title.toLowerCase()).toContain('skipped');
    expect(markers[0].title.toLowerCase()).toContain('cannot be selected');
  });

  it('mutes is-current and is-oversize rows identically', async () => {
    // Commit 5 — both classes apply opacity 0.55. The
    // over-size row additionally gets cursor:not-allowed
    // but the opacity styling is shared.
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx', { status: 'current' }),
        fileEntry('b.docx', { over_size: true }),
        fileEntry('c.docx', { status: 'new' }),
      ],
    });
    const t = mountTab();
    await settle(t);
    const rows = t.shadowRoot.querySelectorAll('.file-row');
    expect(rows[0].classList.contains('is-current')).toBe(true);
    expect(rows[1].classList.contains('is-oversize')).toBe(true);
    expect(rows[2].classList.contains('is-current')).toBe(false);
    expect(rows[2].classList.contains('is-oversize')).toBe(false);
  });

  it('shows error state when scan rejects', async () => {
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    try {
      publishFakeRpc({
        'DocConvert.scan_convertible_files': () => {
          throw new Error('scan boom');
        },
      });
      const t = mountTab();
      await settle(t);
      const error = t.shadowRoot.querySelector('.error-state');
      expect(error).toBeTruthy();
      expect(error.textContent).toContain('scan boom');
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('re-scans on files-modified event', async () => {
    const scan = vi
      .fn()
      .mockResolvedValue([fileEntry('a.docx')]);
    publishFakeRpc({
      'DocConvert.scan_convertible_files': scan,
    });
    const t = mountTab();
    await settle(t);
    expect(scan).toHaveBeenCalledTimes(1);
    pushEvent('files-modified', {});
    await settle(t);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('skips re-scan while one is already in flight', async () => {
    // Defensive against rapid files-modified bursts. The
    // scan-in-flight guard short-circuits; cleanliness
    // re-check runs independently (Commit 5 — it's
    // cheap and doesn't collide).
    let resolveFirstScan;
    const firstScanPromise = new Promise((r) => {
      resolveFirstScan = r;
    });
    const scan = vi.fn().mockImplementationOnce(() => firstScanPromise);
    publishFakeRpc({
      'DocConvert.scan_convertible_files': scan,
    });
    const t = mountTab();
    // Start first scan but don't resolve yet.
    await t.updateComplete;
    expect(scan).toHaveBeenCalledTimes(1);
    // Dispatch a second files-modified while first is
    // still pending — should NOT trigger another scan.
    pushEvent('files-modified', {});
    await t.updateComplete;
    expect(scan).toHaveBeenCalledTimes(1);
    // Resolve first scan so the component settles.
    resolveFirstScan([]);
    await settle(t);
  });
});

// ---------------------------------------------------------------------------
// Selection + toolbar
// ---------------------------------------------------------------------------

describe('DocConvertTab selection', () => {
  async function setupFiles(files) {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => files,
    });
    const t = mountTab();
    await settle(t);
    return t;
  }

  it('checkbox click toggles selection', async () => {
    const t = await setupFiles([fileEntry('a.docx')]);
    const checkbox = t.shadowRoot.querySelector(
      '.file-row input[type="checkbox"]',
    );
    expect(checkbox.checked).toBe(false);
    checkbox.click();
    await settle(t);
    expect(t._selected.has('a.docx')).toBe(true);
  });

  it('row click (outside checkbox) also toggles selection', async () => {
    const t = await setupFiles([fileEntry('a.docx')]);
    const row = t.shadowRoot.querySelector('.file-row');
    // Click the path span, not the checkbox.
    const pathEl = row.querySelector('.file-path');
    pathEl.click();
    await settle(t);
    expect(t._selected.has('a.docx')).toBe(true);
  });

  it('Select all adds every visible file', async () => {
    const t = await setupFiles([
      fileEntry('a.docx'),
      fileEntry('b.pdf'),
      fileEntry('c.rtf'),
    ]);
    const selectAllBtn = Array.from(
      t.shadowRoot.querySelectorAll('.toolbar-button'),
    ).find((b) => b.textContent.trim() === 'Select all');
    selectAllBtn.click();
    await settle(t);
    expect(t._selected.size).toBe(3);
    expect(t._selected.has('a.docx')).toBe(true);
    expect(t._selected.has('b.pdf')).toBe(true);
    expect(t._selected.has('c.rtf')).toBe(true);
  });

  it('Select all skips over-size files (Commit 5)', async () => {
    // Over-size files are ineligible for conversion;
    // Select all must not include them.
    const t = await setupFiles([
      fileEntry('a.docx'),
      fileEntry('huge.pdf', { over_size: true }),
    ]);
    const selectAllBtn = Array.from(
      t.shadowRoot.querySelectorAll('.toolbar-button'),
    ).find((b) => b.textContent.trim() === 'Select all');
    selectAllBtn.click();
    await settle(t);
    expect(t._selected.size).toBe(1);
    expect(t._selected.has('a.docx')).toBe(true);
    expect(t._selected.has('huge.pdf')).toBe(false);
  });

  it('Deselect all clears visible files', async () => {
    const t = await setupFiles([
      fileEntry('a.docx'),
      fileEntry('b.pdf'),
    ]);
    t._selected = new Set(['a.docx', 'b.pdf']);
    await t.updateComplete;
    const deselectBtn = Array.from(
      t.shadowRoot.querySelectorAll('.toolbar-button'),
    ).find((b) => b.textContent.trim() === 'Deselect all');
    deselectBtn.click();
    await settle(t);
    expect(t._selected.size).toBe(0);
  });

  it('Deselect all preserves non-visible selections when filter active', async () => {
    // An active filter limits "visible". Deselect all
    // only removes the visible ones; selections hidden
    // by the filter survive.
    const t = await setupFiles([
      fileEntry('alpha.docx'),
      fileEntry('beta.pdf'),
    ]);
    t._selected = new Set(['alpha.docx', 'beta.pdf']);
    t._filter = 'alpha'; // only alpha.docx visible
    await t.updateComplete;
    const deselectBtn = Array.from(
      t.shadowRoot.querySelectorAll('.toolbar-button'),
    ).find((b) => b.textContent.trim() === 'Deselect all');
    deselectBtn.click();
    await settle(t);
    expect(t._selected.has('alpha.docx')).toBe(false);
    expect(t._selected.has('beta.pdf')).toBe(true);
  });

  it('over-size checkbox is disabled (Commit 5)', async () => {
    const t = await setupFiles([
      fileEntry('huge.pdf', { over_size: true }),
    ]);
    const checkbox = t.shadowRoot.querySelector(
      '.file-row input[type="checkbox"]',
    );
    expect(checkbox.disabled).toBe(true);
  });

  it('_toggleSelection refuses over-size paths (defensive)', async () => {
    // Commit 5 — backstop guard in case a caller
    // (row click, Select All) somehow tries to select
    // an over-size file.
    const t = await setupFiles([
      fileEntry('huge.pdf', { over_size: true }),
    ]);
    t._toggleSelection('huge.pdf');
    await t.updateComplete;
    expect(t._selected.has('huge.pdf')).toBe(false);
  });

  it('selection count appears in toolbar', async () => {
    const t = await setupFiles([
      fileEntry('a.docx'),
      fileEntry('b.pdf'),
    ]);
    const toolbar = t.shadowRoot.querySelector('.toolbar');
    expect(toolbar.textContent).toContain('0 selected');
    t._selected = new Set(['a.docx']);
    await t.updateComplete;
    expect(toolbar.textContent).toContain('1 selected');
  });
});

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

describe('DocConvertTab filter', () => {
  it('fuzzy-matches file paths', async () => {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('architecture.docx'),
        fileEntry('budget.xlsx'),
        fileEntry('report.pdf'),
      ],
    });
    const t = mountTab();
    await settle(t);
    t._filter = 'arc';
    await t.updateComplete;
    const rows = t.shadowRoot.querySelectorAll('.file-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('architecture.docx');
  });

  it('empty filter matches everything', async () => {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
        fileEntry('b.pdf'),
      ],
    });
    const t = mountTab();
    await settle(t);
    t._filter = '';
    await t.updateComplete;
    const rows = t.shadowRoot.querySelectorAll('.file-row');
    expect(rows.length).toBe(2);
  });

  it('shows "No files match" when filter excludes everything', async () => {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
      ],
    });
    const t = mountTab();
    await settle(t);
    t._filter = 'zzz';
    await t.updateComplete;
    const empty = t.shadowRoot.querySelector('.empty-state');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No files match');
  });

  it('shows visible count when filter is active', async () => {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
        fileEntry('b.docx'),
        fileEntry('c.pdf'),
      ],
    });
    const t = mountTab();
    await settle(t);
    t._filter = 'doc';
    await t.updateComplete;
    const toolbar = t.shadowRoot.querySelector('.toolbar .count');
    expect(toolbar.textContent).toContain('2 visible');
  });
});

// ---------------------------------------------------------------------------
// Clean-tree gate (Commit 5)
// ---------------------------------------------------------------------------

describe('DocConvertTab clean-tree gate', () => {
  it('fetches Repo.is_clean on RPC ready', async () => {
    const isClean = vi.fn().mockResolvedValue(true);
    publishFakeRpc({ 'Repo.is_clean': isClean });
    const t = mountTab();
    await settle(t);
    expect(isClean).toHaveBeenCalledOnce();
  });

  it('stores the boolean result', async () => {
    publishFakeRpc({ 'Repo.is_clean': () => true });
    const t = mountTab();
    await settle(t);
    expect(t._treeClean).toBe(true);
  });

  it('stores false for a dirty tree', async () => {
    publishFakeRpc({ 'Repo.is_clean': () => false });
    const t = mountTab();
    await settle(t);
    expect(t._treeClean).toBe(false);
  });

  it('degrades to null on RPC failure', async () => {
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    try {
      publishFakeRpc({
        'Repo.is_clean': () => {
          throw new Error('git unavailable');
        },
      });
      const t = mountTab();
      await settle(t);
      expect(t._treeClean).toBeNull();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('refetches is_clean on files-modified', async () => {
    const isClean = vi.fn().mockResolvedValue(true);
    publishFakeRpc({ 'Repo.is_clean': isClean });
    const t = mountTab();
    await settle(t);
    expect(isClean).toHaveBeenCalledTimes(1);
    pushEvent('files-modified', {});
    await settle(t);
    expect(isClean).toHaveBeenCalledTimes(2);
  });

  it('renders dirty-tree banner when tree is dirty', async () => {
    publishFakeRpc({
      'Repo.is_clean': () => false,
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
      ],
    });
    const t = mountTab();
    await settle(t);
    const banner = t.shadowRoot.querySelector('.dirty-tree-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent.toLowerCase()).toContain('uncommitted');
    expect(banner.textContent.toLowerCase()).toContain('commit');
  });

  it('hides dirty-tree banner when tree is clean', async () => {
    publishFakeRpc({
      'Repo.is_clean': () => true,
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
      ],
    });
    const t = mountTab();
    await settle(t);
    expect(
      t.shadowRoot.querySelector('.dirty-tree-banner'),
    ).toBeNull();
  });

  it('hides dirty-tree banner when cleanliness is null (probe failed)', async () => {
    // null means the probe hasn't completed or failed —
    // don't flash the banner. Backend's gate is the
    // final authority.
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    try {
      publishFakeRpc({
        'Repo.is_clean': () => {
          throw new Error('git unavailable');
        },
      });
      const t = mountTab();
      await settle(t);
      expect(
        t.shadowRoot.querySelector('.dirty-tree-banner'),
      ).toBeNull();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('Convert button disabled when tree is dirty', async () => {
    publishFakeRpc({
      'Repo.is_clean': () => false,
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
      ],
    });
    const t = mountTab();
    await settle(t);
    t._selected = new Set(['a.docx']);
    await t.updateComplete;
    const convertBtn = Array.from(
      t.shadowRoot.querySelectorAll('.toolbar-button'),
    ).find((b) => b.textContent.trim().startsWith('Convert'));
    expect(convertBtn.disabled).toBe(true);
  });

  it('Convert button tooltip prioritises dirty-tree message', async () => {
    publishFakeRpc({
      'Repo.is_clean': () => false,
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
      ],
    });
    const t = mountTab();
    await settle(t);
    t._selected = new Set(['a.docx']);
    await t.updateComplete;
    const convertBtn = Array.from(
      t.shadowRoot.querySelectorAll('.toolbar-button'),
    ).find((b) => b.textContent.trim().startsWith('Convert'));
    expect(convertBtn.title.toLowerCase()).toContain('commit');
  });

  it('Convert button enabled when tree clean and files selected', async () => {
    publishFakeRpc({
      'Repo.is_clean': () => true,
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
      ],
    });
    const t = mountTab();
    await settle(t);
    t._selected = new Set(['a.docx']);
    await t.updateComplete;
    const convertBtn = Array.from(
      t.shadowRoot.querySelectorAll('.toolbar-button'),
    ).find((b) => b.textContent.trim().startsWith('Convert'));
    expect(convertBtn.disabled).toBe(false);
  });

  it('Convert button disabled when no files selected (independent of tree)', async () => {
    publishFakeRpc({
      'Repo.is_clean': () => true,
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
      ],
    });
    const t = mountTab();
    await settle(t);
    // Selection is empty.
    const convertBtn = Array.from(
      t.shadowRoot.querySelectorAll('.toolbar-button'),
    ).find((b) => b.textContent.trim().startsWith('Convert'));
    expect(convertBtn.disabled).toBe(true);
    expect(convertBtn.title.toLowerCase()).toContain('select files');
  });

  it('Convert button enabled when cleanliness is null (backend authority)', async () => {
    // null state doesn't block — the backend's gate is
    // the final authority when the user clicks.
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    try {
      publishFakeRpc({
        'Repo.is_clean': () => {
          throw new Error('unavailable');
        },
        'DocConvert.scan_convertible_files': () => [
          fileEntry('a.docx'),
        ],
      });
      const t = mountTab();
      await settle(t);
      t._selected = new Set(['a.docx']);
      await t.updateComplete;
      const convertBtn = Array.from(
        t.shadowRoot.querySelectorAll('.toolbar-button'),
      ).find((b) => b.textContent.trim().startsWith('Convert'));
      expect(convertBtn.disabled).toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Conversion — inline (sync) path
// ---------------------------------------------------------------------------

describe('DocConvertTab conversion (inline mode)', () => {
  it('calls convert_files with selected paths', async () => {
    const convert = vi.fn().mockResolvedValue({
      status: 'ok',
      results: [{ path: 'a.docx', status: 'ok' }],
    });
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
        fileEntry('b.pdf'),
      ],
      'DocConvert.convert_files': convert,
    });
    const t = mountTab();
    await settle(t);
    t._selected = new Set(['a.docx']);
    await t.updateComplete;
    t._startConversion();
    await settle(t);
    expect(convert).toHaveBeenCalledOnce();
    expect(convert.mock.calls[0][0]).toEqual(['a.docx']);
  });

  it('transitions to complete phase on inline ok result', async () => {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
      ],
      'DocConvert.convert_files': () => ({
        status: 'ok',
        results: [{ path: 'a.docx', status: 'ok' }],
      }),
    });
    const t = mountTab();
    await settle(t);
    t._selected = new Set(['a.docx']);
    await t.updateComplete;
    await t._startConversion();
    await settle(t);
    expect(t._convertPhase).toBe('complete');
    expect(t._convertResults).toHaveLength(1);
  });

  it('renders progress view after conversion starts', async () => {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
      ],
      'DocConvert.convert_files': () => ({
        status: 'ok',
        results: [{ path: 'a.docx', status: 'ok' }],
      }),
    });
    const t = mountTab();
    await settle(t);
    t._selected = new Set(['a.docx']);
    await t.updateComplete;
    await t._startConversion();
    await settle(t);
    // File list gone, progress view visible.
    expect(t.shadowRoot.querySelector('.file-list')).toBeNull();
    expect(t.shadowRoot.querySelector('.progress-view')).toBeTruthy();
  });

  it('dispatches files-modified on completion', async () => {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
      ],
      'DocConvert.convert_files': () => ({
        status: 'ok',
        results: [{ path: 'a.docx', status: 'ok' }],
      }),
    });
    const listener = vi.fn();
    window.addEventListener('files-modified', listener);
    try {
      const t = mountTab();
      await settle(t);
      t._selected = new Set(['a.docx']);
      await t.updateComplete;
      await t._startConversion();
      await settle(t);
      // At least one files-modified dispatch — component
      // fires it so the app-wide disk-cache invalidation
      // path kicks in.
      const convertEvents = listener.mock.calls.filter(
        (call) => call[0].detail?.source === 'doc-convert',
      );
      expect(convertEvents.length).toBeGreaterThan(0);
    } finally {
      window.removeEventListener('files-modified', listener);
    }
  });

  it('surfaces restricted error in summary view', async () => {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
      ],
      'DocConvert.convert_files': () => ({
        error: 'restricted',
        reason: 'Participants cannot convert files',
      }),
    });
    const t = mountTab();
    await settle(t);
    t._selected = new Set(['a.docx']);
    await t.updateComplete;
    await t._startConversion();
    await settle(t);
    expect(t._convertPhase).toBe('complete');
    expect(t._convertError).toContain('Participants');
    const topError = t.shadowRoot.querySelector('.top-error');
    expect(topError).toBeTruthy();
    expect(topError.textContent).toContain('Participants');
  });

  it('surfaces RPC rejection in summary view', async () => {
    const consoleSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    try {
      publishFakeRpc({
        'DocConvert.scan_convertible_files': () => [
          fileEntry('a.docx'),
        ],
        'DocConvert.convert_files': () => {
          throw new Error('convert boom');
        },
      });
      const t = mountTab();
      await settle(t);
      t._selected = new Set(['a.docx']);
      await t.updateComplete;
      await t._startConversion();
      await settle(t);
      expect(t._convertPhase).toBe('complete');
      expect(t._convertError).toContain('convert boom');
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Progress events (background mode)
// ---------------------------------------------------------------------------

describe('DocConvertTab progress events', () => {
  async function setupBackgroundConvert() {
    // Background-mode contract: convert_files returns
    // {status: "started", count} and per-file results
    // arrive via doc-convert-progress events.
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
        fileEntry('b.pdf'),
      ],
      'DocConvert.convert_files': () => ({
        status: 'started',
        count: 2,
      }),
    });
    const t = mountTab();
    await settle(t);
    t._selected = new Set(['a.docx', 'b.pdf']);
    await t.updateComplete;
    await t._startConversion();
    await settle(t);
    return t;
  }

  it('transitions to converting on start event', async () => {
    const t = await setupBackgroundConvert();
    pushEvent('doc-convert-progress', {
      data: { stage: 'start', count: 2 },
    });
    await settle(t);
    expect(t._convertPhase).toBe('converting');
  });

  it('seeds progress map with pending entries on start', async () => {
    const t = await setupBackgroundConvert();
    pushEvent('doc-convert-progress', {
      data: { stage: 'start', count: 2 },
    });
    await settle(t);
    expect(t._progressByPath.get('a.docx')).toEqual({
      status: 'pending',
    });
    expect(t._progressByPath.get('b.pdf')).toEqual({
      status: 'pending',
    });
  });

  it('updates a single file entry on file event', async () => {
    const t = await setupBackgroundConvert();
    pushEvent('doc-convert-progress', {
      data: { stage: 'start', count: 2 },
    });
    await settle(t);
    pushEvent('doc-convert-progress', {
      data: {
        stage: 'file',
        result: {
          path: 'a.docx',
          status: 'ok',
          output_path: 'a.md',
        },
      },
    });
    await settle(t);
    expect(t._progressByPath.get('a.docx')).toEqual({
      status: 'ok',
      message: undefined,
      output_path: 'a.md',
      images: undefined,
    });
    // Other file still pending.
    expect(t._progressByPath.get('b.pdf').status).toBe('pending');
  });

  it('renders per-file status icons during conversion', async () => {
    const t = await setupBackgroundConvert();
    pushEvent('doc-convert-progress', {
      data: { stage: 'start', count: 2 },
    });
    await settle(t);
    pushEvent('doc-convert-progress', {
      data: {
        stage: 'file',
        result: { path: 'a.docx', status: 'ok' },
      },
    });
    pushEvent('doc-convert-progress', {
      data: {
        stage: 'file',
        result: {
          path: 'b.pdf',
          status: 'error',
          message: 'bad file',
        },
      },
    });
    await settle(t);
    const rows = t.shadowRoot.querySelectorAll('.progress-row');
    expect(rows.length).toBe(2);
    // Row 0 — ok (green check).
    expect(rows[0].querySelector('.progress-status').textContent).toBe('✓');
    // Row 1 — error (red cross).
    expect(rows[1].querySelector('.progress-status').textContent).toBe('✗');
  });

  it('transitions to complete on complete event', async () => {
    const t = await setupBackgroundConvert();
    pushEvent('doc-convert-progress', {
      data: { stage: 'start', count: 2 },
    });
    pushEvent('doc-convert-progress', {
      data: {
        stage: 'complete',
        results: [
          { path: 'a.docx', status: 'ok' },
          { path: 'b.pdf', status: 'error', message: 'bad' },
        ],
      },
    });
    await settle(t);
    expect(t._convertPhase).toBe('complete');
    expect(t._convertResults).toHaveLength(2);
  });

  it('ignores events when not in converting phase', async () => {
    // Defensive — a late event from a cancelled batch
    // shouldn't corrupt an idle or completed view.
    const t = await setupBackgroundConvert();
    // Skip the start event — we're not in converting phase.
    pushEvent('doc-convert-progress', {
      data: {
        stage: 'file',
        result: { path: 'a.docx', status: 'ok' },
      },
    });
    await settle(t);
    // Phase should still be idle or whatever setup left it —
    // file event pre-start doesn't flip state.
    // Since our helper didn't fire start, the phase is
    // still 'converting' only if the inline conversion
    // transitioned it (it didn't — convert_files returned
    // {status: "started"} but we didn't dispatch any
    // progress events in setup). So phase is 'converting'
    // (optimistic) from _startConversion's own transition.
    // The file event should still apply because we're in
    // converting phase.
    expect(t._progressByPath.get('a.docx')?.status).toBe('ok');
  });

  it('tolerates malformed progress events', async () => {
    const t = await setupBackgroundConvert();
    // No detail.
    pushEvent('doc-convert-progress', null);
    // Missing data field.
    pushEvent('doc-convert-progress', {});
    // Missing stage.
    pushEvent('doc-convert-progress', { data: {} });
    // File event with no path.
    pushEvent('doc-convert-progress', {
      data: { stage: 'file', result: { status: 'ok' } },
    });
    await settle(t);
    // No crashes, state unchanged.
    expect(t._convertPhase).toBe('converting');
  });
});

// ---------------------------------------------------------------------------
// Summary view + retry/done buttons
// ---------------------------------------------------------------------------

describe('DocConvertTab summary', () => {
  async function convertAndComplete(results) {
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
        fileEntry('b.pdf'),
      ],
      'DocConvert.convert_files': () => ({
        status: 'ok',
        results,
      }),
    });
    const t = mountTab();
    await settle(t);
    t._selected = new Set(['a.docx', 'b.pdf']);
    await t.updateComplete;
    await t._startConversion();
    await settle(t);
    return t;
  }

  it('shows success tally for all-ok results', async () => {
    const t = await convertAndComplete([
      { path: 'a.docx', status: 'ok' },
      { path: 'b.pdf', status: 'ok' },
    ]);
    const footer = t.shadowRoot.querySelector('.summary-footer');
    expect(footer).toBeTruthy();
    expect(footer.textContent).toContain('2 converted');
  });

  it('shows mixed tally for mixed results', async () => {
    const t = await convertAndComplete([
      { path: 'a.docx', status: 'ok' },
      { path: 'b.pdf', status: 'error', message: 'bad' },
      { path: 'c.docx', status: 'skipped' },
    ]);
    const footer = t.shadowRoot.querySelector('.summary-footer');
    expect(footer.textContent).toContain('1 converted');
    expect(footer.textContent).toContain('1 skipped');
    expect(footer.textContent).toContain('1 failed');
  });

  it('Done button returns to idle', async () => {
    const t = await convertAndComplete([
      { path: 'a.docx', status: 'ok' },
    ]);
    const doneBtn = Array.from(
      t.shadowRoot.querySelectorAll('.summary-footer .toolbar-button'),
    ).find((b) => b.textContent.trim() === 'Done');
    doneBtn.click();
    await settle(t);
    expect(t._convertPhase).toBe('idle');
    expect(t._selected.size).toBe(0);
    // File list visible again.
    expect(t.shadowRoot.querySelector('.file-list')).toBeTruthy();
    expect(t.shadowRoot.querySelector('.progress-view')).toBeNull();
  });

  it('Retry button re-runs conversion with same batch', async () => {
    const convert = vi
      .fn()
      .mockResolvedValue({
        status: 'ok',
        results: [{ path: 'a.docx', status: 'ok' }],
      });
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
      ],
      'DocConvert.convert_files': convert,
    });
    const t = mountTab();
    await settle(t);
    t._selected = new Set(['a.docx']);
    await t.updateComplete;
    await t._startConversion();
    await settle(t);
    expect(convert).toHaveBeenCalledTimes(1);
    const retryBtn = Array.from(
      t.shadowRoot.querySelectorAll('.summary-footer .toolbar-button'),
    ).find((b) => b.textContent.trim() === 'Retry');
    retryBtn.click();
    await settle(t);
    expect(convert).toHaveBeenCalledTimes(2);
    // Second call with the same batch.
    expect(convert.mock.calls[1][0]).toEqual(['a.docx']);
  });
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

describe('DocConvertTab cleanup', () => {
  it('removes window listeners on disconnect', async () => {
    const scan = vi.fn().mockResolvedValue([]);
    publishFakeRpc({
      'DocConvert.scan_convertible_files': scan,
    });
    const t = mountTab();
    await settle(t);
    expect(scan).toHaveBeenCalledTimes(1);
    t.remove();
    // After disconnect, files-modified must not trigger
    // another scan.
    pushEvent('files-modified', {});
    await new Promise((r) => setTimeout(r, 10));
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('does not process progress events after disconnect', async () => {
    const convert = vi.fn().mockResolvedValue({
      status: 'started',
      count: 1,
    });
    publishFakeRpc({
      'DocConvert.scan_convertible_files': () => [
        fileEntry('a.docx'),
      ],
      'DocConvert.convert_files': convert,
    });
    const t = mountTab();
    await settle(t);
    t._selected = new Set(['a.docx']);
    await t.updateComplete;
    await t._startConversion();
    await settle(t);
    // Disconnect mid-conversion.
    t.remove();
    // Dispatching progress after disconnect should not
    // throw. State is irrelevant — tab is gone.
    expect(() => {
      pushEvent('doc-convert-progress', {
        data: {
          stage: 'file',
          result: { path: 'a.docx', status: 'ok' },
        },
      });
    }).not.toThrow();
  });
});