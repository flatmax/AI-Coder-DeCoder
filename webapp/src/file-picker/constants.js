// Constants for the FilePicker component.
//
// Action identifiers for the context menu, inline-input mode
// strings, sort-mode identifiers, menu catalogs, storage keys,
// and viewport-clamp tunables. Extracted from file-picker.js
// so the rendering and event-handling modules can share them
// without circular imports.

// Sort mode identifiers. Module-level constants match the
// convention used elsewhere in the webapp — minimal shape,
// tree-shake-friendly.
export const SORT_MODE_NAME = 'name';
export const SORT_MODE_MTIME = 'mtime';
export const SORT_MODE_SIZE = 'size';
export const SORT_MODES = [
  SORT_MODE_NAME,
  SORT_MODE_MTIME,
  SORT_MODE_SIZE,
];

// Context-menu action identifiers. Reuses the action-id
// string on both the menu-item definition and the
// dispatched `context-menu-action` event detail so tests
// can pin the routing without needing to know menu
// position or item labels.
export const CTX_ACTION_STAGE = 'stage';
export const CTX_ACTION_UNSTAGE = 'unstage';
export const CTX_ACTION_DISCARD = 'discard';
export const CTX_ACTION_RENAME = 'rename';
export const CTX_ACTION_DUPLICATE = 'duplicate';
export const CTX_ACTION_LOAD_LEFT = 'load-left';
export const CTX_ACTION_LOAD_RIGHT = 'load-right';
export const CTX_ACTION_EXCLUDE = 'exclude';
export const CTX_ACTION_INCLUDE = 'include';
export const CTX_ACTION_DELETE = 'delete';

// Menu items for file rows. Rendered in declaration
// order; groups separated by null entries which render
// as horizontal rules. The `showWhen` function gates
// conditional items (include vs exclude shown based on
// current state).
export const _CONTEXT_MENU_FILE_ITEMS = [
  { action: CTX_ACTION_STAGE, label: 'Stage', icon: '➕' },
  { action: CTX_ACTION_UNSTAGE, label: 'Unstage', icon: '➖' },
  {
    action: CTX_ACTION_DISCARD,
    label: 'Discard changes…',
    icon: '↻',
  },
  null,
  { action: CTX_ACTION_RENAME, label: 'Rename…', icon: '✎' },
  { action: CTX_ACTION_DUPLICATE, label: 'Duplicate…', icon: '⎘' },
  null,
  {
    action: CTX_ACTION_LOAD_LEFT,
    label: 'Load in left panel',
    icon: '◧',
  },
  {
    action: CTX_ACTION_LOAD_RIGHT,
    label: 'Load in right panel',
    icon: '◨',
  },
  null,
  {
    action: CTX_ACTION_EXCLUDE,
    label: 'Exclude from index',
    icon: '✕',
    showWhen: (ctx) => !ctx.isExcluded,
  },
  {
    action: CTX_ACTION_INCLUDE,
    label: 'Include in index',
    icon: '✓',
    showWhen: (ctx) => ctx.isExcluded,
  },
  null,
  {
    action: CTX_ACTION_DELETE,
    label: 'Delete…',
    icon: '🗑',
    destructive: true,
  },
];

// Directory-row action identifiers. Distinct from the
// file-row action IDs so a stale menu open on one node
// type can't accidentally dispatch to a handler
// expecting the other.
export const CTX_ACTION_STAGE_ALL = 'stage-all';
export const CTX_ACTION_UNSTAGE_ALL = 'unstage-all';
export const CTX_ACTION_RENAME_DIR = 'rename-dir';
export const CTX_ACTION_NEW_FILE = 'new-file';
export const CTX_ACTION_NEW_DIR = 'new-directory';
export const CTX_ACTION_EXCLUDE_ALL = 'exclude-all';
export const CTX_ACTION_INCLUDE_ALL = 'include-all';

// Inline-input mode identifiers.
export const INLINE_MODE_RENAME = 'rename';
export const INLINE_MODE_DUPLICATE = 'duplicate';
export const INLINE_MODE_NEW_FILE = 'new-file';
export const INLINE_MODE_NEW_DIR = 'new-directory';

// Menu items for directory rows. The exclude-all /
// include-all gate via `showWhen` reading the context
// object's `allExcluded` / `someExcluded` flags.
export const _CONTEXT_MENU_DIR_ITEMS = [
  {
    action: CTX_ACTION_STAGE_ALL,
    label: 'Stage all',
    icon: '➕',
  },
  {
    action: CTX_ACTION_UNSTAGE_ALL,
    label: 'Unstage all',
    icon: '➖',
  },
  null,
  {
    action: CTX_ACTION_RENAME_DIR,
    label: 'Rename…',
    icon: '✎',
  },
  null,
  {
    action: CTX_ACTION_NEW_FILE,
    label: 'New file…',
    icon: '📄',
  },
  {
    action: CTX_ACTION_NEW_DIR,
    label: 'New directory…',
    icon: '📁',
  },
  null,
  {
    action: CTX_ACTION_EXCLUDE_ALL,
    label: 'Exclude all from index',
    icon: '✕',
    showWhen: (ctx) => !ctx.allExcluded,
  },
  {
    action: CTX_ACTION_INCLUDE_ALL,
    label: 'Include all in index',
    icon: '✓',
    showWhen: (ctx) => ctx.someExcluded,
  },
];

// Menu items for the root row. Only "create new entry at
// repo root" actions are exposed.
export const _CONTEXT_MENU_ROOT_ITEMS = [
  {
    action: CTX_ACTION_NEW_FILE,
    label: 'New file…',
    icon: '📄',
  },
  {
    action: CTX_ACTION_NEW_DIR,
    label: 'New directory…',
    icon: '📁',
  },
];

// Viewport margin — the menu is kept this many pixels
// from every window edge.
export const _CONTEXT_MENU_VIEWPORT_MARGIN = 8;

// Maximum height for the branch switcher popover.
export const _BRANCH_MENU_MAX_HEIGHT = 320;
export const _BRANCH_MENU_WIDTH = 280;

// localStorage keys for persisting sort preferences.
export const _SORT_MODE_KEY = 'ac-dc-sort-mode';
export const _SORT_ASC_KEY = 'ac-dc-sort-asc';