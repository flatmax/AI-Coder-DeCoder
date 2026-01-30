# Plan: Unified Diff Rendering for Edit Blocks

## Objective

Replace the current three-section edit block rendering (Context / Remove / Add) with a unified diff view that interleaves changes line-by-line, similar to GitHub's diff display.

## Current State

- `CardMarkdown.js` parses edit blocks and renders them via `renderEditBlock()` and `formatEditSections()`
- Current output shows three separate blocks: context lines, then all removed lines, then all added lines
- This makes it hard to see exactly what changed where

## Proposed Approach

### 1. Create LCS Diff Utility

Create a new utility module `webapp/src/utils/diff.js` with:

```javascript
/**
 * Compute unified diff between two arrays of lines using LCS algorithm.
 * @param {string[]} oldLines - Original lines
 * @param {string[]} newLines - New lines  
 * @returns {Array<{type: 'context'|'add'|'remove', line: string}>}
 */
export function computeLineDiff(oldLines, newLines) { ... }
```

**Algorithm:**
1. Build DP table for LCS: O(n×m) time/space
2. Backtrack to identify which lines are common (context), removed, or added
3. Return array of diff entries in display order

**Implementation notes:**
- Pure function, no side effects
- ~40-50 lines of code
- No external dependencies

### 2. Update CardMarkdown Rendering

Modify `CardMarkdown.js`:

1. **Replace `formatEditSections()`** with a new method that uses the LCS diff utility
2. **Update `renderEditBlock()`** to render unified diff output:
   - Context lines: neutral background, no prefix (or space prefix)
   - Removed lines: red background, `-` prefix
   - Added lines: green background, `+` prefix

### 3. Update Styles

Add/modify CSS in `CardMarkdown.js`:

```css
.diff-line { ... }
.diff-line.context { background: #0d1117; color: #8b949e; }
.diff-line.remove { background: #3d1f1f; color: #ffa198; }
.diff-line.add { background: #1f3d1f; color: #7ee787; }
.diff-line-prefix { 
  user-select: none; 
  width: 1ch; 
  display: inline-block;
  color: inherit;
  opacity: 0.6;
}
```

## File Changes

| File | Change |
|------|--------|
| `webapp/src/utils/diff.js` | **NEW** - LCS diff utility |
| `webapp/src/prompt/CardMarkdown.js` | Update rendering to use unified diff |

## Testing Strategy

1. Manual testing with various edit block types:
   - Simple single-line changes
   - Multi-line additions
   - Multi-line deletions
   - Mixed changes (some lines modified, some unchanged)
   - Pure insertions (empty old section)
   - Pure deletions (empty new section)

2. Verify edge cases:
   - Empty edit/repl sections
   - Whitespace-only changes
   - Very long lines (horizontal scrolling)

## Future Enhancements (Out of Scope)

- Word-level inline diff highlighting within changed lines
- Collapsible long unchanged sections
- Line numbers in diff view

## Effort Estimate

- LCS utility: ~30 minutes
- CardMarkdown updates: ~30 minutes
- Styling refinements: ~15 minutes
- Testing: ~15 minutes

**Total: ~1.5 hours**
