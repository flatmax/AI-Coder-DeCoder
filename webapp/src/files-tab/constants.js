// Constants for the files-tab orchestrator.
//
// Extracted from the monolithic files-tab.js so the
// individual modules (helpers, styles, the main class)
// can import what they need without dragging in the
// whole class file.

// ---------------------------------------------------------------
// Left-panel resizer constants
// ---------------------------------------------------------------
//
// Spec'd in specs4/5-webapp/file-picker.md § Left Panel Resizer.
// Minimum width prevents the picker from collapsing below the
// point where tree rows become unreadable (file names truncate
// hard, context-menu buttons start overlapping). Maximum is
// expressed as 50% of the host width so the chat pane always
// retains half the dialog. Collapsed state shrinks the picker
// to a thin affordance strip — the stored _pickerWidthPx
// survives so double-click-to-expand restores the user's prior
// width rather than snapping to a default.

export const _PICKER_WIDTH_KEY = 'ac-dc-picker-width';
export const _PICKER_COLLAPSED_KEY = 'ac-dc-picker-collapsed';
export const _PICKER_MIN_WIDTH = 180;
export const _PICKER_COLLAPSED_WIDTH = 24;
export const _PICKER_DEFAULT_WIDTH = 280;

// localStorage keys for the L0-invalidation-on-exclude
// preference. The dialog stores either "always" (don't
// ask, always invalidate) or "never" (don't ask, always
// defer). When neither is set, the dialog appears.
// Symmetric with the existing per-feature preferences
// stored elsewhere; can be reset via the Settings tab.
//
// Design note — three states (ask / always / never) is
// the right shape. A single boolean would force the
// user into one of the two pre-set choices; keeping
// "ask" as the absence of a stored value lets the
// dialog be the discoverable default and lets users
// who want a permanent answer opt in to one.
export const _L0_EXCLUDE_PREF_KEY = 'ac-dc-l0-exclude-pref';
export const _L0_EXCLUDE_PREF_ASK = 'ask';
export const _L0_EXCLUDE_PREF_ALWAYS = 'always';
export const _L0_EXCLUDE_PREF_NEVER = 'never';

/**
 * Default tree stub used before the first RPC load. Lets the
 * picker render empty rather than showing a spinner while the
 * tree is en route — the picker's empty-state placeholder
 * handles the "no files yet" case gracefully.
 */
export const EMPTY_TREE = {
  name: '',
  path: '',
  type: 'dir',
  lines: 0,
  children: [],
};