# Find in Files Feature Plan

## Overview

Implement a "Find in Files" (grep-like) functionality that allows users to search for text patterns across the repository, with results displayed in a dedicated UI panel.

## Current State Analysis

### Backend (Already Exists)
- `ac/repo/search_operations.py` already has `SearchOperationsMixin.search_files(query, word, regex, ignore_case)`
- This is mixed into `Repo` class in `ac/repo/repo.py`
- Uses `git grep` under the hood (based on the `git` import)

### Frontend Patterns to Follow
- `HistoryBrowser` - good template for a searchable results panel
- `FilePicker` - tree/list rendering patterns
- `DiffViewer` - file content display with Monaco editor

## Implementation Plan

### Phase 1: Backend Verification & Enhancement

**File: `ac/repo/search_operations.py`**

1. Verify the existing `search_files` method returns structured data:
   ```python
   {
     "success": True,
     "results": [
       {
         "file": "path/to/file.py",
         "line": 42,
         "column": 10,  # if available
         "content": "the matching line content",
         "match": "the matched text"
       }
     ],
     "query": "original query",
     "total_matches": 150
   }
   ```

2. Add pagination support if not present (large repos can have thousands of matches)

3. Add context lines option (show N lines before/after match)

**Estimated effort**: Review existing code, potentially minor enhancements

### Phase 2: Frontend Component Structure

Create new component: `webapp/src/find-in-files/`

```
webapp/src/find-in-files/
├── FindInFiles.js          # Main component (extends JRPCClient)
├── FindInFilesStyles.js    # CSS styles
├── FindInFilesTemplate.js  # Lit template
├── SearchInputMixin.js     # Search input handling, debounce
└── ResultsRendererMixin.js # Results list rendering
```

**Entry point**: `webapp/find-in-files.js`

### Phase 3: Component Implementation

#### 3.1 FindInFiles.js - Main Component

```javascript
// Properties
- query: String (search text)
- results: Array (search results)
- isSearching: Boolean (loading state)
- selectedResult: Object (currently selected match)
- options: Object { word: false, regex: false, ignoreCase: true }
- visible: Boolean

// Methods
- performSearch() - calls backend search_files
- selectResult(result) - emits event to navigate to file/line
- toggleOption(option) - toggle search options
```

#### 3.2 Integration with AppShell

- Add keyboard shortcut: `Ctrl+Shift+F` to open/focus find panel
- Add UI button/icon in toolbar
- Wire up `file-selected` event to DiffViewer with line navigation

#### 3.3 Results Display

Each result shows:
- File path (clickable → opens in DiffViewer)
- Line number
- Matched line with query highlighted
- Context lines (collapsible)

### Phase 4: DiffViewer Enhancement

**File: `webapp/src/diff-viewer/DiffViewer.js`**

Add method to navigate to specific line:
- `_revealPosition(line, column)` - **already exists!** (line 162)
- Ensure it's callable from external events

### Phase 5: Wire Everything Together

#### 5.1 AppShell Integration

**File: `webapp/src/app-shell/AppShell.js`**

1. Import and register `<find-in-files>` component
2. Add state: `showFindInFiles`, `findQuery`
3. Add keyboard listener for `Ctrl+Shift+F`
4. Handle `result-selected` event → open file in DiffViewer at line

#### 5.2 Event Flow

```
User types query
    ↓
FindInFiles.performSearch()
    ↓
RPC call: repo.search_files(query, options)
    ↓
Backend returns results
    ↓
User clicks result
    ↓
FindInFiles emits 'result-selected' event
    ↓
AppShell catches event
    ↓
AppShell sets viewingFile + calls DiffViewer._revealPosition()
```

## File Changes Summary

### New Files
1. `webapp/find-in-files.js` - entry point
2. `webapp/src/find-in-files/FindInFiles.js` - main component
3. `webapp/src/find-in-files/FindInFilesStyles.js` - styles
4. `webapp/src/find-in-files/FindInFilesTemplate.js` - template
5. `webapp/src/find-in-files/SearchInputMixin.js` - input handling
6. `webapp/src/find-in-files/ResultsRendererMixin.js` - results rendering

### Modified Files
1. `ac/repo/search_operations.py` - enhance response format (if needed)
2. `webapp/src/app-shell/AppShell.js` - integrate FindInFiles component
3. `webapp/index.html` - add script import (if not auto-discovered)

## UI Design: Integrated Tab (Option C)

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
│ search_ops.py      │                                                 │
│   7: def search_   │                                                 │
│   15: git.grep     │                                                 │
│ chat.py            │                                                 │
│   42: # search     │                                                 │
│   156: embed(query)│                                                 │
│                    │                                                 │
└────────────────────┴─────────────────────────────────────────────────┘
```

### Tab Behavior

- **Files tab**: Shows existing FilePicker (file tree, modified files, etc.)
- **Search tab**: Shows FindInFiles component (search input + results)
- Tabs sit at top of left panel, toggle between views
- Active tab highlighted

### Search Results Detail

```
┌────────────────────┐
│ [Files] [🔍Search] │  ← tab bar
├────────────────────┤
│ 🔍 [query here___] │  ← auto-focus on tab switch
│ [Aa] [.*] [W]      │  ← toggle buttons (case, regex, word)
├────────────────────┤
│ 47 results         │  ← summary
├────────────────────┤
│ ▾ search_ops.py (3)│  ← file header (collapsible)
│   7  │def search_fi│  ← line num │ content (truncated)
│   15 │git.grep(quer│     highlighted match
│   28 │return {"quer│
│ ▸ chat.py (2)      │  ← collapsed by default if many files
│ ▸ test_search.py(5)│
└────────────────────┘
```

### Interaction Flow

1. `Ctrl+Shift+F` → switches to Search tab, focuses input
2. User types → debounced search (300ms delay)
3. Results stream in, grouped by file
4. Click file header → expand/collapse matches
5. Click match → DiffViewer opens file, scrolls to line, highlights
6. `Escape` → clears search (or closes if empty)
7. `Ctrl+B` or click Files tab → back to file tree

### Visual States

**Empty state (no query):**
```
┌────────────────────┐
│ 🔍 [____________ ] │
│ [Aa] [.*] [W]      │
│                    │
│   Type to search   │
│   across all files │
│                    │
│   Ctrl+Shift+F     │
└────────────────────┘
```

**Loading state:**
```
┌────────────────────┐
│ 🔍 [query here___] │
│ [Aa] [.*] [W]      │
│                    │
│   ◌ Searching...   │
│                    │
└────────────────────┘
```

**No results:**
```
┌────────────────────┐
│ 🔍 [asdfghjkl___] │
│ [Aa] [.*] [W]      │
│                    │
│   No results found │
│   for "asdfghjkl"  │
│                    │
└────────────────────┘
```

**Error state:**
```
┌────────────────────┐
│ 🔍 [(?broken___] │
│ [Aa] [✓.*] [W]     │
│                    │
│   ⚠ Invalid regex  │
│                    │
└────────────────────┘
```

## Testing Plan

1. **Backend tests**: Verify search_files returns expected format
2. **Frontend unit**: Test SearchInputMixin debouncing
3. **Integration**: Test full flow from search → click → navigate

## Future Enhancements (Out of Scope)

- Replace in files (search & replace across repo)
- Search in specific directories/file patterns
- Search history / saved searches
- Live results as you type (streaming)
- Symbol search (classes, functions) vs text search

## Implementation Order

### Step 1: Backend Review
- [ ] Review `ac/repo/search_operations.py` - understand current output format
- [ ] Verify response structure matches our needs
- [ ] Add enhancements if needed (pagination, context lines)

### Step 2: Component Scaffolding
- [ ] Create `webapp/find-in-files.js` entry point
- [ ] Create `webapp/src/find-in-files/FindInFiles.js` - basic component shell
- [ ] Create `webapp/src/find-in-files/FindInFilesStyles.js` - initial styles
- [ ] Create `webapp/src/find-in-files/FindInFilesTemplate.js` - basic template

### Step 3: Tab System
- [ ] Modify `webapp/src/app-shell/AppShell.js` to add tab bar
- [ ] Add state for active tab (`files` | `search`)
- [ ] Conditionally render FilePicker or FindInFiles based on tab
- [ ] Style tab bar to match existing UI

### Step 4: Search Input
- [ ] Add search input with debounce (300ms)
- [ ] Add toggle buttons for options (case, regex, word)
- [ ] Wire up RPC call to `repo.search_files()`
- [ ] Handle loading state

### Step 5: Results Rendering
- [ ] Display results grouped by file
- [ ] Show line numbers and content
- [ ] Highlight matched text in results
- [ ] Add collapsible file sections

### Step 6: Navigation Integration
- [ ] Handle click on result → emit event
- [ ] AppShell catches event → opens file in DiffViewer
- [ ] DiffViewer scrolls to line using `_revealPosition()`
- [ ] Highlight the matched line briefly

### Step 7: Keyboard Shortcuts
- [ ] `Ctrl+Shift+F` → switch to Search tab, focus input
- [ ] `Escape` → clear search or switch back to Files
- [ ] `Enter` on result → navigate to that match
- [ ] Arrow keys → navigate through results

### Step 8: Polish
- [ ] Empty state UI
- [ ] No results state UI
- [ ] Error state UI (invalid regex, etc.)
- [ ] Loading spinner
- [ ] Result count summary
- [ ] Persist search options in localStorage
