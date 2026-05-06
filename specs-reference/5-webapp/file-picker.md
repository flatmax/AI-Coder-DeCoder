# Reference: File Picker

**Supplements:** `specs4/5-webapp/file-picker.md`

## Schemas

### localStorage keys

| Key | Type | Default | Purpose |
|---|---|---|---|
| `ac-dc-sort-mode` | `"name"` / `"mtime"` / `"size"` | `"name"` | Sort mode for file tree |
| `ac-dc-sort-asc` | `"1"` / `"0"` | `"1"` | Sort direction: 1 = ascending, 0 = descending |
| `ac-dc-picker-width` | integer px (string) | `280` | Picker pane width within the Files tab |
| `ac-dc-picker-collapsed` | `"true"` / `"false"` | `"false"` | Picker collapsed state |

Malformed values fall back to defaults. Storage errors (private-browsing quirks, quota) are swallowed silently.

### Panel width constraints

| Constant | Value |
|---|---|
| Default width | 280 px |
| Minimum width | 180 px (enforced by drag clamp) |
| Maximum width | 50% of host element width (enforced by drag clamp) |
| Collapsed width | ~24 px (affordance strip, widens from splitter hover) |
| Splitter width (normal) | 4 px |
| Splitter width (collapsed mode) | ~20 px (shows `▸` glyph) |

### Context menu action IDs

Dispatched via `context-menu-action` events with `detail: { action, type, path, ... }`:

**File row actions** (`type: "file"`):

| Action ID | Label | Trigger |
|---|---|---|
| `stage` | Stage | Runs `Repo.stage_files([path])` |
| `unstage` | Unstage | Runs `Repo.unstage_files([path])` |
| `discard` | Discard Changes… | Confirm → `Repo.discard_changes([path])` |
| `rename` | Rename… | Opens inline input pre-filled with current name |
| `duplicate` | Duplicate… | Opens inline input pre-filled with full path |
| `load-left` | Load in Left Panel | Fetches content and dispatches `load-diff-panel` event |
| `load-right` | Load in Right Panel | Fetches content and dispatches `load-diff-panel` event |
| `exclude` | Exclude from Index | Shown only if file is NOT excluded |
| `include` | Include in Index | Shown only if file IS excluded |
| `delete` | Delete… | Confirm → `Repo.delete_file(path)` (destructive class) |

**Directory row actions** (`type: "dir"`):

| Action ID | Label | Trigger |
|---|---|---|
| `stage-all` | Stage All | Collects descendant files, runs `Repo.stage_files(paths)` |
| `unstage-all` | Unstage All | Collects descendants, runs `Repo.unstage_files(paths)` |
| `rename-dir` | Rename… | Opens inline input pre-filled with current name |
| `new-file` | New File… | Opens inline input as child |
| `new-directory` | New Directory… | Opens inline input; creates directory + `.gitkeep` |
| `exclude-all` | Exclude from Index | Shown only if some descendants NOT excluded |
| `include-all` | Include in Index | Shown only if some descendants ARE excluded |

**Root row actions** (`type: "root"`):

| Action ID | Label | Trigger |
|---|---|---|
| `new-file` | New File… | Inline input creates file at repo root |
| `new-directory` | New Directory… | Inline input creates directory at repo root |

### Inline input modes

When the user triggers rename / duplicate / new-file / new-directory, the picker renders an inline text input at the appropriate tree position:

| Mode | Rendering position | Pre-fill |
|---|---|---|
| `rename` | Replaces the target row | Current name |
| `duplicate` | Below the target row | Full current path |
| `new-file` | At the top of the target directory's children | Empty |
| `new-directory` | At the top of the target directory's children | Empty |

Key handling: Enter commits, Escape cancels, blur cancels. After commit, the input dispatches `rename-committed` / `duplicate-committed` / `new-file-committed` / `new-directory-committed` events with payload shape documented in `specs4/5-webapp/file-picker.md`.

## Dependency quirks

### Shift+click vs regular click — `preventDefault()` asymmetry

Regular click on a checkbox: do NOT call `event.preventDefault()`. The browser's native checkbox toggle runs, updating the visual state. Our reactive `.checked` binding re-renders with the authoritative state on the next frame. Result: user sees the expected toggle with no visual glitch.

Shift+click on a checkbox: DO call `event.preventDefault()` immediately. Without this, the browser's native toggle fires first, producing a one-frame visual flip, then our state change applies and the checkbox flips back. The glitch is ~16ms but visually obvious.

### Regular click on excluded file

One gesture performs two state changes atomically:
1. Remove from excluded set
2. Add to selected set

Dispatches both `exclusion-changed` and `selection-changed` events in sequence. The orchestrator fires both RPCs (restricted guard per call; either may fail independently).

### Directory click with excluded descendants

Regular click on a directory row whose descendants include excluded files:
1. First un-excludes ALL descendants (clears them from the excluded set)
2. Then applies the normal select-all-descendants logic

Prevents the confusing state where ticking a parent selects most descendants but silently leaves some excluded. Pinned by `regular click on dir with excluded children un-excludes them`.

### Three-state checkbox cycle

Shift+click cycles through states based on current state:

| Current | Shift+click result |
|---|---|
| Default (index-only) | Excluded |
| Selected | Excluded (also removes from selection) |
| Excluded | Default (back to index-only, NOT selected) |

The "excluded → default" direction deliberately does NOT jump to selected. Returning to "selected" on the back-swing would be surprising — the user's shift+click gesture meant "change index inclusion", not "select." The regular-click-on-excluded path covers the "I want this selected AND re-included" case with a single gesture.

### Deleted file exclusion cleanup

When a file is deleted via the context menu:
1. If the path was in the excluded set, remove it
2. If the path was in the selected set, the server's `filesChanged` broadcast clears it

Step 1 is local because the server does not broadcast excluded-set changes (only selection). Without this, re-creating a file at the same path would find it mysteriously pre-excluded.

### Modified file pin — `preventDefault` on the click, not on the value

When the user clicks the checkbox of a modified (pinned) file to deselect it, the picker calls `event.preventDefault()` on the native click. The deselection event still bubbles to files-tab, which reverts the change and emits a toast. The reverted selection set equals the pre-click set, so files-tab's reassignment of `picker.selectedFiles = new Set(currentSet)` produces a `.checked` binding value identical to the pre-click value (`true → true`).

Lit's property-binding diff sees no change and skips the DOM write. Without `preventDefault`, the browser's native flip (which ran before the handler) leaves the checkbox visually unchecked, contradicting the underlying state.

The fix lives in the picker's click handler rather than in files-tab because:
- Files-tab doesn't have synchronous access to the input element to write `.checked` directly
- Forcing `.checked` after the fact would fight Lit's reactive binding model
- Adding `live()` directives just for this one binding would be a heavy-handed import for a localized problem

Pinned status is computed by files-tab (`modified ∪ staged`) and pushed to the picker as `pinnedFiles`. Untracked and deleted files are deliberately excluded from the pinned set — see specs4 § Modified File Pinning for rationale.

## Cross-references

- Behavioral specification: `specs4/5-webapp/file-picker.md`
- Files tab orchestration and direct-update pattern: `specs4/5-webapp/file-picker.md` § Files Tab Orchestration
- Middle-click path insertion + chat panel flag: `specs-reference/5-webapp/chat.md` § Cross-component flag