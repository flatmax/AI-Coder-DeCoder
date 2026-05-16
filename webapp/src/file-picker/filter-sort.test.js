// Tests for webapp/src/file-picker.js — filter and sort-buttons groups.
//
// Extracted from file-picker.test.js to keep the original file
// manageable. Preserves the outer 'FilePicker component' wrapper
// so describe paths remain stable.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  dir,
  file,
  installCleanup,
  mountPicker,
  rootOf,
} from './test-helpers.js';

installCleanup();

describe('FilePicker component', () => {
  describe('filter', () => {
    it('filters the tree as the user types', async () => {
      const tree = rootOf([
        dir('src', [
          file('src/main.py'),
          file('src/utils.py'),
        ]),
        file('README.md'),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const input = p.shadowRoot.querySelector('.filter-input');
      input.value = 'main';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      const names = Array.from(
        p.shadowRoot.querySelectorAll('.name'),
      ).map((el) => el.textContent);
      // src dir shown (contains matching file), main.py shown,
      // utils.py hidden, README.md hidden.
      expect(names).toContain('src');
      expect(names).toContain('main.py');
      expect(names).not.toContain('utils.py');
      expect(names).not.toContain('README.md');
    });

    it('auto-expands ancestor directories of matching files', async () => {
      const tree = rootOf([
        dir('a', [dir('a/b', [file('a/b/deep.md')])]),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // Initially fully collapsed — one tree row visible
      // (the top-level `a` dir). Scope to non-root rows;
      // the root header is not counted.
      const treeRowSelector =
        '.row.is-dir:not(.is-root) .name, .row.is-file .name';
      expect(
        p.shadowRoot.querySelectorAll(treeRowSelector).length,
      ).toBe(1);
      // Type a filter — the matching file should be reachable
      // without the user manually expanding.
      const input = p.shadowRoot.querySelector('.filter-input');
      input.value = 'deep';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      const names = Array.from(
        p.shadowRoot.querySelectorAll(treeRowSelector),
      ).map((el) => el.textContent);
      // All three levels now visible.
      expect(names).toEqual(['a', 'b', 'deep.md']);
    });

    it('no matches shows the "no matching" placeholder', async () => {
      const tree = rootOf([file('a.md'), file('b.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const input = p.shadowRoot.querySelector('.filter-input');
      input.value = 'xyzzy';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      const empty = p.shadowRoot.querySelector('.empty-state');
      expect(empty.textContent).toContain('No matching');
    });

    it('setFilter() programmatic call works too', async () => {
      // Needed for the @-filter bridge from the chat input.
      const tree = rootOf([
        file('match.md'),
        file('other.md'),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      p.setFilter('match');
      await p.updateComplete;
      const names = Array.from(
        p.shadowRoot.querySelectorAll('.name'),
      ).map((el) => el.textContent);
      expect(names).toContain('match.md');
      expect(names).not.toContain('other.md');
    });

    it('clearing the filter restores the full tree', async () => {
      const tree = rootOf([file('a.md'), file('b.md')]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      const input = p.shadowRoot.querySelector('.filter-input');
      input.value = 'a';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      // Only a.md visible.
      expect(
        p.shadowRoot.querySelectorAll('.row.is-file').length,
      ).toBe(1);
      // Clear.
      input.value = '';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      expect(
        p.shadowRoot.querySelectorAll('.row.is-file').length,
      ).toBe(2);
    });

    it('does not collapse directories the user had opened', async () => {
      // User-opened state must survive filter typing/clearing.
      const tree = rootOf([
        dir('src', [file('src/a.md'), file('src/b.md')]),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // User expands src.
      p.shadowRoot.querySelector('.row.is-dir').click();
      await p.updateComplete;
      // Type filter then clear.
      const input = p.shadowRoot.querySelector('.filter-input');
      input.value = 'xyz';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      input.value = '';
      input.dispatchEvent(new Event('input'));
      await p.updateComplete;
      // src is still expanded (both files visible).
      const names = Array.from(
        p.shadowRoot.querySelectorAll('.name'),
      ).map((el) => el.textContent);
      expect(names).toContain('a.md');
      expect(names).toContain('b.md');
    });
  });

  // ---------------------------------------------------------------
  // Sort buttons (Increment 3) — split-button-with-pulldown
  // ---------------------------------------------------------------
  //
  // Spec: specs4/5-webapp/file-picker.md (Sorting section).
  // The toolbar exposes one primary button for the active sort
  // mode (with its direction glyph) plus a chevron that opens
  // a popup menu listing all three modes. Clicking the primary
  // button toggles direction; choosing a different mode from the
  // menu switches mode and resets to ascending.

  const openSortMenu = async (p) => {
    const chevron = p.shadowRoot.querySelector(
      '.sort-btn.chevron',
    );
    chevron.click();
    await p.updateComplete;
  };

  const clickMenuItem = async (p, mode) => {
    await openSortMenu(p);
    const items = Array.from(
      p.shadowRoot.querySelectorAll('.sort-menu-item'),
    );
    const item = items.find((el) =>
      (el.textContent || '').toLowerCase().includes(mode),
    );
    item.click();
    await p.updateComplete;
  };

  describe('sort buttons', () => {
    it('renders a primary sort button plus a chevron', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      const btns = p.shadowRoot.querySelectorAll('.sort-btn');
      expect(btns).toHaveLength(2);
      const primary = p.shadowRoot.querySelector(
        '.sort-btn.primary',
      );
      const chevron = p.shadowRoot.querySelector(
        '.sort-btn.chevron',
      );
      expect(primary).toBeTruthy();
      expect(chevron).toBeTruthy();
    });

    it('defaults to name mode ascending on first mount', async () => {
      // Fresh localStorage → name mode, ascending. The primary
      // button reflects the active mode with .active and
      // aria-pressed=true, and shows the ↑ direction glyph.
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      const primary = p.shadowRoot.querySelector(
        '.sort-btn.primary',
      );
      expect(primary.getAttribute('data-sort-mode')).toBe('name');
      expect(primary.classList.contains('active')).toBe(true);
      expect(primary.getAttribute('aria-pressed')).toBe('true');
      expect(primary.textContent).toContain('↑');
    });

    it('chevron opens a menu listing all three modes', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      // Menu absent until chevron is clicked.
      expect(
        p.shadowRoot.querySelector('.sort-menu'),
      ).toBeNull();
      await openSortMenu(p);
      const items = p.shadowRoot.querySelectorAll(
        '.sort-menu-item',
      );
      expect(items).toHaveLength(3);
      const labels = Array.from(items).map((el) =>
        (el.textContent || '').trim().toLowerCase(),
      );
      expect(labels.some((l) => l.includes('name'))).toBe(true);
      expect(labels.some((l) => l.includes('modified'))).toBe(true);
      expect(labels.some((l) => l.includes('size'))).toBe(true);
    });

    it('selecting a different mode from the menu switches and resets to ascending', async () => {
      // Name → mtime: mtime becomes active, asc=true (fresh
      // sort starts at the familiar anchor — oldest-first
      // for mtime).
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      await clickMenuItem(p, 'modified');
      expect(p._sortMode).toBe('mtime');
      expect(p._sortAsc).toBe(true);
      const primary = p.shadowRoot.querySelector(
        '.sort-btn.primary',
      );
      expect(primary.getAttribute('data-sort-mode')).toBe('mtime');
    });

    it('clicking the primary button toggles direction', async () => {
      // Click primary twice (starting as name+asc): first click
      // toggles to descending.
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      const primary = () =>
        p.shadowRoot.querySelector('.sort-btn.primary');
      primary().click();
      await p.updateComplete;
      expect(p._sortMode).toBe('name');
      expect(p._sortAsc).toBe(false);
      expect(primary().textContent).toContain('↓');
      // Click again — back to ascending.
      primary().click();
      await p.updateComplete;
      expect(p._sortAsc).toBe(true);
      expect(primary().textContent).toContain('↑');
    });

    it('files render in the selected sort order', async () => {
      const tree = rootOf([
        file('c.md', 10, 1000),
        file('a.md', 500, 3000),
        file('b.md', 100, 2000),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // Default: name ascending.
      const namesFor = () =>
        Array.from(
          p.shadowRoot.querySelectorAll('.row.is-file .name'),
        ).map((el) => el.textContent);
      expect(namesFor()).toEqual(['a.md', 'b.md', 'c.md']);
      // Switch to size ascending: smallest first.
      await clickMenuItem(p, 'size');
      expect(namesFor()).toEqual(['c.md', 'b.md', 'a.md']);
      // Click primary — descending (largest first).
      p.shadowRoot.querySelector('.sort-btn.primary').click();
      await p.updateComplete;
      expect(namesFor()).toEqual(['a.md', 'b.md', 'c.md']);
      // Switch to mtime ascending: oldest first.
      await clickMenuItem(p, 'modified');
      expect(namesFor()).toEqual(['c.md', 'b.md', 'a.md']);
    });

    it('directories stay alphabetical regardless of mode', async () => {
      // The sort mode and direction only apply to files.
      // Dirs always sort A-Z ascending.
      const tree = rootOf([
        dir('z_dir', []),
        dir('a_dir', []),
        dir('m_dir', []),
        file('a.md', 100),
      ]);
      const p = mountPicker({ tree });
      await p.updateComplete;
      // Check every mode and both directions.
      const modeLabels = [
        ['name', 'name'],
        ['mtime', 'modified'],
        ['size', 'size'],
      ];
      for (const [mode, label] of modeLabels) {
        // Activate the mode via the menu. Selecting the
        // already-active mode toggles direction, so only
        // dispatch when actually switching modes — and if
        // the prior iteration left us on desc, click the
        // primary button to flip back to asc.
        if (p._sortMode !== mode) {
          await clickMenuItem(p, label);
        }
        if (!p._sortAsc) {
          p.shadowRoot.querySelector('.sort-btn.primary').click();
          await p.updateComplete;
        }
        expect(p._sortMode).toBe(mode);
        expect(p._sortAsc).toBe(true);
        // Ascending — dirs must be alphabetical.
        const dirNames = Array.from(
          p.shadowRoot.querySelectorAll(
            '.row.is-dir:not(.is-root) .name',
          ),
        ).map((el) => el.textContent);
        expect(dirNames).toEqual(['a_dir', 'm_dir', 'z_dir']);
        // Toggle to descending via the primary button —
        // still alphabetical.
        p.shadowRoot.querySelector('.sort-btn.primary').click();
        await p.updateComplete;
        const dirNamesDesc = Array.from(
          p.shadowRoot.querySelectorAll(
            '.row.is-dir:not(.is-root) .name',
          ),
        ).map((el) => el.textContent);
        expect(dirNamesDesc).toEqual(['a_dir', 'm_dir', 'z_dir']);
      }
    });

    it('persists mode to localStorage on change', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      await clickMenuItem(p, 'modified');
      expect(localStorage.getItem('ac-dc-sort-mode')).toBe('mtime');
      expect(localStorage.getItem('ac-dc-sort-asc')).toBe('1');
    });

    it('persists direction to localStorage on toggle', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      const primary = () =>
        p.shadowRoot.querySelector('.sort-btn.primary');
      // Toggle name to descending.
      primary().click();
      await p.updateComplete;
      expect(localStorage.getItem('ac-dc-sort-asc')).toBe('0');
      // Back to ascending.
      primary().click();
      await p.updateComplete;
      expect(localStorage.getItem('ac-dc-sort-asc')).toBe('1');
    });

    it('restores mode and direction from localStorage on mount', async () => {
      // Seed storage before mounting — the constructor
      // reads these and applies them immediately.
      localStorage.setItem('ac-dc-sort-mode', 'size');
      localStorage.setItem('ac-dc-sort-asc', '0');
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      expect(p._sortMode).toBe('size');
      expect(p._sortAsc).toBe(false);
      const primary = p.shadowRoot.querySelector(
        '.sort-btn.primary',
      );
      expect(primary.getAttribute('data-sort-mode')).toBe('size');
      expect(primary.classList.contains('active')).toBe(true);
      expect(primary.textContent).toContain('↓');
    });

    it('ignores unknown mode in localStorage', async () => {
      localStorage.setItem('ac-dc-sort-mode', 'bogus');
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      // Falls back to name.
      expect(p._sortMode).toBe('name');
    });

    it('ignores malformed direction in localStorage', async () => {
      localStorage.setItem('ac-dc-sort-mode', 'name');
      localStorage.setItem('ac-dc-sort-asc', 'maybe');
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      // Falls back to ascending.
      expect(p._sortAsc).toBe(true);
    });

    it('primary button always shows the direction glyph', async () => {
      // Spec: the primary button renders the active mode's
      // glyph plus the direction arrow. The chevron does not
      // carry a direction glyph.
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      const primary = () =>
        p.shadowRoot.querySelector('.sort-btn.primary');
      const chevron = () =>
        p.shadowRoot.querySelector('.sort-btn.chevron');
      expect(primary().querySelector('.dir')).toBeTruthy();
      expect(chevron().querySelector('.dir')).toBeNull();
      // Switch to mtime — primary still shows the glyph,
      // now reflecting the new mode.
      await clickMenuItem(p, 'modified');
      expect(primary().getAttribute('data-sort-mode')).toBe('mtime');
      expect(primary().querySelector('.dir')).toBeTruthy();
    });
  });
});