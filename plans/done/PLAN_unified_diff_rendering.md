# Plan: Unified Diff Rendering for Edit Blocks

## Objective

Replace the current three-section edit block rendering (Context / Remove / Add) with a unified diff view that interleaves changes line-by-line, similar to GitHub's diff display. Include word-level highlighting within changed lines.

## Current State

- `CardMarkdown.js` parses edit blocks and renders them via `renderEditBlock()` and `formatEditSections()`
- Current output shows three separate blocks: context lines, then all removed lines, then all added lines
- This makes it hard to see exactly what changed where

## Implementation Status

- [x] Phase 1: Line-level unified diff (COMPLETE)
- [x] Phase 2: Word-level inline highlighting (COMPLETE)

## Phase 1: Line-Level Unified Diff (COMPLETE)

### 1. LCS Diff Utility

Created `webapp/src/utils/diff.js` with:

```javascript
export function computeLineDiff(oldLines, newLines) { ... }
```

**Algorithm:**
1. Build DP table for LCS: O(n×m) time/space
2. Backtrack to identify which lines are common (context), removed, or added
3. Return array of diff entries in display order

### 2. CardMarkdown Updates

- Replaced `formatEditSections()` with `formatUnifiedDiff()`
- Updated `renderEditBlock()` to render unified diff output
- Added CSS styles for `.diff-line`, `.diff-line.context`, `.diff-line.remove`, `.diff-line.add`

## Phase 2: Word-Level Inline Highlighting

### Objective

When a line is modified (not purely added/removed), highlight the specific words or characters that changed within the line, similar to GitHub's inline diff highlighting.

### Approach

#### 1. Extend diff.js with character-level diff

Add new function to `webapp/src/utils/diff.js`:

```javascript
/**
 * Compute character-level diff between two strings.
 * Returns array of segments with type and text.
 * @param {string} oldStr - Original string
 * @param {string} newStr - New string
 * @returns {Array<{type: 'same'|'add'|'remove', text: string}>}
 */
export function computeCharDiff(oldStr, newStr) { ... }
```

#### 2. Pair adjacent remove/add lines

In `formatUnifiedDiff()`, detect when a remove line is immediately followed by an add line (indicating a modification rather than pure delete+insert). Group these into pairs for inline highlighting.

#### 3. Render with inline highlights

For paired lines, run character-level diff and wrap changed segments:

```html
<span class="diff-line remove">
  <span class="diff-line-prefix">-</span>
  import <span class="diff-change">json</span>
</span>
<span class="diff-line add">
  <span class="diff-line-prefix">+</span>
  import <span class="diff-change">json_modified</span>
</span>
```

#### 4. Add CSS for inline highlights

```css
.diff-line.remove .diff-change {
  background: #6e2d2d;
  border-radius: 2px;
}

.diff-line.add .diff-change {
  background: #2d5a2d;
  border-radius: 2px;
}
```

### Edge Cases

- Multiple changes on one line: show multiple highlighted segments
- Entire line changed: don't highlight (falls back to line-level coloring)
- Whitespace-only changes: still highlight
- Very long lines: ensure horizontal scroll still works

### File Changes

| File | Change |
|------|--------|
| `webapp/src/utils/diff.js` | Add `computeCharDiff()` function |
| `webapp/src/prompt/CardMarkdown.js` | Update `formatUnifiedDiff()` to use inline highlighting |

## Testing Strategy

1. Manual testing with various edit block types:
   - Simple single-line changes
   - Multi-line additions
   - Multi-line deletions
   - Mixed changes (some lines modified, some unchanged)
   - Pure insertions (empty old section)
   - Pure deletions (empty new section)
   - Word changes within lines (Phase 2)
   - Multiple word changes on same line (Phase 2)

2. Verify edge cases:
   - Empty edit/repl sections
   - Whitespace-only changes
   - Very long lines (horizontal scrolling)

## Future Enhancements (Out of Scope)

- Collapsible long unchanged sections
- Line numbers in diff view
- Move detection (detecting when blocks move rather than delete+add)
- Patience diff algorithm for better handling of repeated lines

## Effort Estimate

### Phase 1 (COMPLETE)
- LCS utility: ~30 minutes
- CardMarkdown updates: ~30 minutes
- Styling refinements: ~15 minutes
- Testing: ~15 minutes
- **Total: ~1.5 hours**

### Phase 2 (COMPLETE)
- Character-level diff function: ~30 minutes
- Line pairing logic: ~20 minutes
- Inline highlight rendering: ~30 minutes
- Styling: ~15 minutes
- Testing: ~20 minutes
- **Total: ~2 hours**
