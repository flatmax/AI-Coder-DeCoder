# Cache History UI Plan

## Status: TODO

## Origin

Extracted from the UI design notes in `plans/done/PLAN_cache_optimization.md`
(the cache history backend implementation plan). The backend work is complete;
this plan covers the remaining frontend visualization.

## Problem

The backend fully supports history messages in cache tiers (via ripple
promotion), and `get_context_breakdown` returns per-tier history items with
stability info. However, the frontend UI doesn't fully render this data:

1. **CacheViewer**: History in cached tiers shows only aggregate stats
   (count + tokens), not per-item detail with stability progress bars.
2. **ContextViewer**: History category doesn't show tier distribution.
3. **HUD**: History in tier content descriptions shows boolean presence
   (`hist`) instead of counts like symbols and files do (`3sym`, `2f`).

These are small, self-contained UI improvements that make the caching
behavior visible and understandable to users.

## Current State

### Backend (complete, no changes needed)

- `get_context_breakdown()` returns tier blocks with `"type": "history"`
  content entries containing:
  ```json
  {
    "type": "history",
    "count": 3,
    "tokens": 450,
    "items": [
      {
        "index": 0,
        "role": "user",
        "preview": "How do I implement...",
        "tokens": 150,
        "stable_count": 9,
        "next_tier": "L1",
        "next_threshold": 12,
        "progress": 0.75
      }
    ]
  }
  ```

- `tier_info` in streaming HUD data includes `history` count per tier
  (integer, not just boolean).

- `_build_history_items()` in `context_builder.py` builds the items list
  with full stability info (N value, next tier, threshold, progress).

### Frontend (needs changes)

**CacheViewerTemplate.js**:
- `renderHistoryGroup()` renders aggregate-only (count + tokens + warning).
- The `GROUP_CONFIG` registry has `symbols`, `files`, `urls` but no `history`.
- The `renderTierBlock` switch handles `'history'` via `renderHistoryGroup`.

**ContextViewerTemplate.js**:
- History expanded section only shows compaction warning, no tier breakdown.
- The category row shows total history tokens but no tier distribution.

**HudTemplate.js**:
- `renderCacheTiers()` builds content descriptions per tier.
- Uses `if (info.has_history) contents.push('hist')` — boolean only.
- Symbols use `${symbols}sym`, files use `${files}f`, but history lacks count.

## Changes

### 1. CacheViewer: Per-item history rendering (SMALL)

**File**: `webapp/src/context-viewer/CacheViewerTemplate.js`

Add a `renderHistoryItem` function that renders each history message with:
- Chat bubble icon (💬) with role indicator (user/assistant)
- Truncated message preview
- Token count
- Stability progress bar (reuse `renderStabilityBar`)

Register history in `GROUP_CONFIG` so cached-tier history uses the expandable
per-item group renderer (same as symbols/files), while active-tier history
keeps the current aggregate `renderHistoryGroup`.

**Detailed changes**:

a. Add `renderHistoryItem(component, item, tier)` function:
   - Shows `💬` icon + role badge (U/A)
   - Truncated preview (first 60 chars of message)
   - Token count
   - Stability progress bar via `renderStabilityBar`

b. Add `'history'` to `GROUP_CONFIG` with `renderItem: renderHistoryItem`.

c. In `renderTierBlock`'s switch, change the `'history'` case:
   - For cached tiers (L0-L3): use `renderContentGroup` via `GROUP_CONFIG`
     (same as symbols/files/urls — expandable with per-item detail)
   - For active tier: keep `renderHistoryGroup` (aggregate + compaction warning)

d. Add history to `filterItems` and `tierHasMatches` in `CacheViewer.js`
   so search works for history items.

### 2. ContextViewer: History tier distribution (SMALL)

**File**: `webapp/src/context-viewer/ContextViewerTemplate.js`

When the history category is expanded, show tier distribution alongside the
compaction warning.

**Detailed changes**:

a. In `renderExpandedItems` for `key === 'history'`:
   - Show tier distribution from `data.tier_counts` (e.g., "2 L1, 3 L2, 1 active")
   - Keep existing compaction warning
   - Add per-tier breakdown rows showing count and tokens

b. The `get_context_breakdown` response already includes per-tier history
   in the `blocks` array. Extract tier counts from blocks to build the
   distribution display. Add a `tier_counts` field to the legacy
   `breakdown.history` object for easier access.

### 3. HUD: History count in tier descriptions (TRIVIAL)

**File**: `webapp/src/prompt/HudTemplate.js`

**Detailed changes**:

In `renderCacheTiers`, change:
```javascript
if (info.has_history) contents.push('hist');
```
to:
```javascript
const histCount = info.history || 0;
if (histCount > 0) contents.push(`${histCount}hist`);
else if (info.has_history) contents.push('hist');
```

This shows `3hist` instead of just `hist` when the count is available,
matching the pattern used by symbols (`12sym`) and files (`2f`).

### 4. Backend: Add tier_counts to legacy breakdown (TRIVIAL)

**File**: `ac/llm/llm.py`

In `get_context_breakdown`, add `tier_counts` to `legacy_breakdown.history`:
```python
"tier_counts": {
    tier: len(history_tiers.get(tier, []))
    for tier in ['L0', 'L1', 'L2', 'L3', 'active']
    if history_tiers.get(tier)
}
```

This gives the ContextViewer easy access to per-tier history counts without
having to parse the blocks array.

### 5. CacheViewer: Search support for history (SMALL)

**File**: `webapp/src/context-viewer/CacheViewer.js`

In `filterItems(items, type)`, add handling for `type === 'history'`:
- Match against `item.preview` and `item.role`

In `tierHasMatches(block)`, ensure history content is checked when searching.

## Implementation Order

1. **#3** — HUD history count (trivial, one-line change)
2. **#4** — Backend tier_counts (trivial, 4 lines)
3. **#1** — CacheViewer per-item history (small, ~40 lines)
4. **#5** — CacheViewer search support (small, ~10 lines)
5. **#2** — ContextViewer tier distribution (small, ~25 lines)

## Testing

- Manual: Open CacheViewer after a few exchanges, verify history items
  appear in tier blocks with progress bars after graduation occurs.
- Manual: Check HUD shows `3hist` instead of `hist` in tier descriptions.
- Manual: Expand history in ContextViewer, verify tier distribution shows.
- Manual: Search in CacheViewer matches history message previews.
- No new automated tests needed — these are pure UI rendering changes
  consuming data the backend already produces and tests verify.

## Files Modified

- `webapp/src/prompt/HudTemplate.js` (1 line)
- `ac/llm/llm.py` (4 lines in `get_context_breakdown`)
- `webapp/src/context-viewer/CacheViewerTemplate.js` (~40 lines)
- `webapp/src/context-viewer/CacheViewer.js` (~10 lines)
- `webapp/src/context-viewer/ContextViewerTemplate.js` (~25 lines)
