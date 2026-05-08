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
  // Sort buttons (Increment 3)
  // ---------------------------------------------------------------

  describe('sort buttons', () => {
    it('renders three sort-mode buttons in the filter bar', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      const btns = p.shadowRoot.querySelectorAll('.sort-btn');
      expect(btns).toHaveLength(3);
      const modes = Array.from(btns).map((b) =>
        b.getAttribute('data-sort-mode'),
      );
      expect(modes).toEqual(['name', 'mtime', 'size']);
    });

    it('defaults to name mode ascending on first mount', async () => {
      // Fresh localStorage → name mode, ascending. The active
      // button has .active and aria-pressed=true, and shows
      // the ↑ direction glyph.
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      const nameBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="name"]',
      );
      expect(nameBtn.classList.contains('active')).toBe(true);
      expect(nameBtn.getAttribute('aria-pressed')).toBe('true');
      expect(nameBtn.textContent).toContain('↑');
    });

    it('only one button is active at a time', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      const actives = p.shadowRoot.querySelectorAll(
        '.sort-btn.active',
      );
      expect(actives).toHaveLength(1);
    });

    it('clicking a different mode switches and resets to ascending', async () => {
      // Name → mtime: mtime becomes active, asc=true (fresh
      // sort starts at the familiar anchor — oldest-first
      // for mtime).
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      const mtimeBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="mtime"]',
      );
      mtimeBtn.click();
      await p.updateComplete;
      expect(p._sortMode).toBe('mtime');
      expect(p._sortAsc).toBe(true);
      // Name button no longer active.
      const nameBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="name"]',
      );
      expect(nameBtn.classList.contains('active')).toBe(false);
      expect(mtimeBtn.classList.contains('active')).toBe(true);
    });

    it('clicking the active mode toggles direction', async () => {
      // Click name twice (starting as default active+asc):
      // first click toggles to descending.
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      const nameBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="name"]',
      );
      nameBtn.click();
      await p.updateComplete;
      expect(p._sortMode).toBe('name');
      expect(p._sortAsc).toBe(false);
      expect(nameBtn.textContent).toContain('↓');
      // Click again — back to ascending.
      nameBtn.click();
      await p.updateComplete;
      expect(p._sortAsc).toBe(true);
      expect(nameBtn.textContent).toContain('↑');
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
      p.shadowRoot
        .querySelector('.sort-btn[data-sort-mode="size"]')
        .click();
      await p.updateComplete;
      expect(namesFor()).toEqual(['c.md', 'b.md', 'a.md']);
      // Click size again — descending (largest first).
      p.shadowRoot
        .querySelector('.sort-btn[data-sort-mode="size"]')
        .click();
      await p.updateComplete;
      expect(namesFor()).toEqual(['a.md', 'b.md', 'c.md']);
      // Switch to mtime ascending: oldest first.
      p.shadowRoot
        .querySelector('.sort-btn[data-sort-mode="mtime"]')
        .click();
      await p.updateComplete;
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
      const modes = ['name', 'mtime', 'size'];
      for (const mode of modes) {
        // Activate the mode. If already active, this toggles
        // direction; click it twice to get a known state.
        const btn = p.shadowRoot.querySelector(
          `.sort-btn[data-sort-mode="${mode}"]`,
        );
        btn.click();
        await p.updateComplete;
        if (!p._sortAsc) {
          btn.click();
          await p.updateComplete;
        }
        // Ascending — dirs must be alphabetical.
        const dirNames = Array.from(
          p.shadowRoot.querySelectorAll('.row.is-dir:not(.is-root) .name'),
        ).map((el) => el.textContent);
        expect(dirNames).toEqual(['a_dir', 'm_dir', 'z_dir']);
        // Toggle to descending — still alphabetical.
        btn.click();
        await p.updateComplete;
        const dirNamesDesc = Array.from(
          p.shadowRoot.querySelectorAll('.row.is-dir:not(.is-root) .name'),
        ).map((el) => el.textContent);
        expect(dirNamesDesc).toEqual(['a_dir', 'm_dir', 'z_dir']);
      }
    });

    it('persists mode to localStorage on change', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      p.shadowRoot
        .querySelector('.sort-btn[data-sort-mode="mtime"]')
        .click();
      await p.updateComplete;
      expect(localStorage.getItem('ac-dc-sort-mode')).toBe('mtime');
      expect(localStorage.getItem('ac-dc-sort-asc')).toBe('1');
    });

    it('persists direction to localStorage on toggle', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      // Toggle name to descending.
      p.shadowRoot
        .querySelector('.sort-btn[data-sort-mode="name"]')
        .click();
      await p.updateComplete;
      expect(localStorage.getItem('ac-dc-sort-asc')).toBe('0');
      // Back to ascending.
      p.shadowRoot
        .querySelector('.sort-btn[data-sort-mode="name"]')
        .click();
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
      const sizeBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="size"]',
      );
      expect(sizeBtn.classList.contains('active')).toBe(true);
      expect(sizeBtn.textContent).toContain('↓');
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

    it('active button shows direction glyph; inactive buttons do not', async () => {
      const p = mountPicker({ tree: rootOf([]) });
      await p.updateComplete;
      // Default: name is active, shows ↑; mtime and size have
      // no direction glyph.
      const nameBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="name"]',
      );
      const mtimeBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="mtime"]',
      );
      const sizeBtn = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="size"]',
      );
      expect(nameBtn.querySelector('.dir')).toBeTruthy();
      expect(mtimeBtn.querySelector('.dir')).toBeNull();
      expect(sizeBtn.querySelector('.dir')).toBeNull();
      // Switch to mtime — only mtime shows the glyph now.
      mtimeBtn.click();
      await p.updateComplete;
      const nameBtnAfter = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="name"]',
      );
      const mtimeBtnAfter = p.shadowRoot.querySelector(
        '.sort-btn[data-sort-mode="mtime"]',
      );
      expect(nameBtnAfter.querySelector('.dir')).toBeNull();
      expect(mtimeBtnAfter.querySelector('.dir')).toBeTruthy();
    });
  });
});