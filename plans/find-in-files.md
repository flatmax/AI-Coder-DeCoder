# Find in Files Feature Plan

## Overview

Implement a "Find in Files" (grep-like) functionality that allows users to search for text patterns across the repository, with results displayed in a dedicated UI panel.

## Current State Analysis

### Backend (Implemented)
- `ac/repo/search_operations.py` has `SearchOperationsMixin.search_files(query, word, regex, ignore_case, context_lines)`
- Mixed into `Repo` class in `ac/repo/repo.py`
- Uses `git grep` under the hood
- Returns structured data with context lines support

### Frontend (Implemented)
- `webapp/src/find-in-files/FindInFiles.js` - Main component with search functionality
- `webapp/src/find-in-files/FindInFilesStyles.js` - CSS styles
- `webapp/src/find-in-files/FindInFilesTemplate.js` - Lit template with results rendering
- Integrated into AppShell with tab switching

## Implementation Status

### ✅ Completed Features

#### Backend
- [x] `search_files` method with options (word, regex, ignore_case, context_lines)
- [x] Context lines support (before/after match)
- [x] Structured response format with file grouping

#### Frontend Component
- [x] Search input with 300ms debounce
- [x] Toggle buttons for options (case sensitivity, regex, whole word)
- [x] Results grouped by file with match counts
- [x] Collapsible file sections
- [x] Line numbers and content display
- [x] Query highlighting in results
- [x] Context lines (shown on hover/focus)
- [x] Keyboard navigation (↑↓ arrows, Enter to select)
- [x] Empty/loading/error states
- [x] Results summary count

#### AppShell Integration
- [x] Tab system (Files | Search)
- [x] `Ctrl+Shift+F` keyboard shortcut to switch to search tab
- [x] `result-selected` event handling
- [x] Navigation to file and line in DiffViewer

### ✅ Completed Features (Recently Added)

#### File Header Click Navigation
- [x] Clicking file name in search results opens file in DiffViewer
- [x] File opens at beginning (line 1) rather than a specific match
- [x] Clicking specific match opens file AND jumps to that line

#### Result Selection Behavior
- [x] Clicking a match line switches to Files tab
- [x] Editor receives focus after navigation
- [x] Line is revealed and cursor positioned correctly

#### State Persistence
- [x] Search tab retains state when switching away
- [x] Query, results, scroll position preserved
- [x] User can `Ctrl+Shift+F` back to see previous search results
- [x] Expanded/collapsed file states preserved

#### Polish Items
- [x] Persist search options in localStorage
- [ ] Brief highlight animation on navigated line in DiffViewer (optional)

## Detailed Implementation Plan for Pending Features

### Feature 1: File Header Click Navigation

**Goal**: When user clicks on a file name (not a specific match), open that file in DiffViewer and switch focus to it.

**Files to modify**:
- `webapp/src/find-in-files/FindInFilesTemplate.js`
- `webapp/src/find-in-files/FindInFiles.js`
- `webapp/src/app-shell/AppShell.js`

**Implementation**:

1. **FindInFilesTemplate.js** - Separate click zones in file header:
   - Arrow icon: toggle expand/collapse
   - File name: open file in DiffViewer

2. **FindInFiles.js** - Add `openFile(filePath)` method that emits `file-selected` event

3. **AppShell.js** - Handle `file-selected` event:
   - Set `viewingFile` to the selected file path
   - Keep Search tab active (don't switch to Files)
   - DiffViewer receives focus

**User flow**:
1. User searches for "TODO"
2. Results show: `src/app.js (5)`, `src/utils.js (2)`
3. User clicks "src/app.js" file name
4. DiffViewer opens `src/app.js` at line 1
5. Left panel still shows Search tab with results
6. User can click another file or a specific match

### Feature 2: State Persistence Across Tab Switches

**Goal**: Search state (query, results, options, scroll position) persists when switching between Files and Search tabs.

**Files to modify**:
- `webapp/src/app-shell/AppShell.js`
- `webapp/src/find-in-files/FindInFiles.js`

**Implementation**:

1. **AppShell.js** - Keep FindInFiles mounted but hidden:
   - Render both FilePicker and FindInFiles
   - Use CSS `.hidden` class to hide inactive component
   - Component state preserved because it's not unmounted

2. **FindInFiles.js** - Focus input when becoming visible:
   - Check visibility in `updated()` lifecycle
   - Call `focusInput()` when component becomes visible

**User flow**:
1. User switches to Search tab, searches for "config"
2. Results show 15 matches across 4 files
3. User clicks a match, DiffViewer opens file
4. User clicks Files tab to check something
5. User presses `Ctrl+Shift+F`
6. Search tab shows same results, same query, same scroll position

### Feature 3: Search Options Persistence

**Goal**: Remember user's preferred search options across sessions.

**Files to modify**:
- `webapp/src/find-in-files/FindInFiles.js`

**Implementation**:
- Load options from localStorage in constructor
- Save options to localStorage in `toggleOption()`

## UI Design

### Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│                           APP SHELL                                   │
├────────────────────┬─────────────────────────────────────────────────┤
│ [Files] [🔍Search] │                                                 │
│ ──────────────────│                                                 │
│ 🔍 [____________ ] │                                                 │
│ [Aa] [.*] [W]      │              DIFF VIEWER                        │
│                    │                                                 │
│ 47 results in 12   │         (file content here)                     │
│ files              │                                                 │
│ ──────────────────│                                                 │
│ search_ops.py ←────┼── Click file name = open file                   │
│   7: def search_ ←─┼── Click match = open file at line              │
│   15: git.grep     │                                                 │
│ chat.py            │                                                 │
│   42: # search     │                                                 │
│   156: embed(query)│                                                 │
│                    │                                                 │
└────────────────────┴─────────────────────────────────────────────────┘
```

### Click Zones

```
┌────────────────────────────────────┐
│ ▶ search_ops.py           (3)     │
│ ↑   ↑                      ↑      │
│ │   │                      │      │
│ │   └─ Click: open file    │      │
│ │      in DiffViewer       │      │
│ │                          │      │
│ └─ Click: expand/collapse  └─ (info only, no action)
│    matches list
├────────────────────────────────────┤
│   7  │def search_files(self, ...  │
│   ↑     ↑                         │
│   │     └─ Click: open file at    │
│   │        line 7 in DiffViewer   │
│   └─ (line number, part of click zone)
└────────────────────────────────────┘
```

### Interaction Summary

| Action | Result |
|--------|--------|
| `Ctrl+Shift+F` | Switch to Search tab, focus input |
| Type in search box | Debounced search (300ms) |
| Click ▶ arrow | Expand/collapse file's matches |
| Click file name | Open file in DiffViewer (line 1) |
| Click match line | Open file in DiffViewer at that line |
| `↑` / `↓` keys | Navigate through matches |
| `Enter` | Open focused match in DiffViewer |
| `Escape` (with query) | Clear search |
| `Escape` (empty) | Close search / switch to Files |
| Switch to Files tab | Search state preserved |
| `Ctrl+Shift+F` again | Return to preserved search state |

## Testing Plan

1. **Backend tests**: Verify search_files returns expected format
2. **Frontend unit**: Test debouncing behavior
3. **Integration**: Test full flow from search → click → navigate
4. **State persistence**: Verify search state survives tab switches
5. **File navigation**: Test file header click vs match click behavior

## Future Enhancements (Out of Scope)

- Replace in files (search & replace across repo)
- Search in specific directories/file patterns
- Search history / saved searches
- Live results as you type (streaming)
- Symbol search (classes, functions) vs text search
- Multi-select matches for batch operations

## Implementation Order for Remaining Work

### Step 1: File Header Click Navigation ✅
- [x] Separate click zones in FindInFilesTemplate.js (arrow vs file name)
- [x] Add `openFile(filePath)` method to FindInFiles.js
- [x] Emit `file-selected` event (without line number)
- [x] Handle event in AppShell.js to open file
- [x] File loading managed by AppShell._loadFileIntoDiff()

### Step 2: State Persistence ✅
- [x] Modify AppShell to render both FilePicker and FindInFiles
- [x] Use CSS display:none for inactive component (preserves state)
- [x] FindInFiles focuses input when becoming visible
- [x] Round-trip works: search → view file → return to search

### Step 3: localStorage Persistence ✅
- [x] Save search options to localStorage on change
- [x] Load search options from localStorage on init

### Step 4: Polish ✅
- [x] Clicking search result switches to Files tab and focuses editor
- [x] Line navigation works (jumps to correct line in file)
- [x] Scroll position in results list is preserved across tab switches

### Remaining Polish (Optional)
- [ ] Add brief highlight animation on navigated line in DiffViewer
- [ ] Keyboard navigation after tab switch (needs testing)
