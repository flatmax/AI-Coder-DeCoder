# Plan: Cache Tier Visualization UI

## Overview

Create a new UI component to visualize the 4-tier cache system (L0-L3 + active), replacing the current chunk-based display in ContextViewer with a tier-based hierarchy that shows exactly how content is organized for LLM prompt caching.

## Current State

The existing `ContextViewer` component shows:
- Token budget bar
- Category breakdown (system, symbol_map, files, urls, history)
- Symbol map chunks (old 3-chunk system)
- Session totals

**Problems:**
1. Chunk display doesn't reflect actual cache tiers (L0-L3)
2. No visibility into item stability (how close to promotion/demotion)
3. No promotion/demotion notifications
4. Symbol map and files shown separately, but they share the same tier system

## Goals

1. **Tier-centric visualization** - Show L0, L1, L2, L3, active as primary organization
2. **Unified content** - Symbol entries and files together within each tier
3. **Stability indicators** - Show how stable each item is (progress toward next tier)
4. **Live feedback** - Promotion/demotion notifications
5. **Cache efficiency** - Clear cache hit rate and savings visualization

## Design

### Visual Layout

```
╭─ Cache Performance ─────────────────────────────────╮
│ ████████████████████████░░░░░░░  78% cache hit      │
│ 23,090 cached / 26,217 total tokens                 │
╰─────────────────────────────────────────────────────╯

╭─ L0 · Most Stable ──────────────── 8,421 tk 🔒 ────╮
│ Threshold: 12+ responses unchanged                  │
├─────────────────────────────────────────────────────┤
│ ▸ System Prompt                         1,800 tk    │
│ ▸ Legend                                  300 tk    │
│ ▾ Symbols (12 files)                    4,200 tk    │
│   ├─ ac/context/token_counter.py    180 tk ████ 14 │
│   ├─ ac/repo/repo.py                220 tk ████ 12 │
│   └─ ...                                            │
│ ▸ Files (2)                             2,121 tk    │
╰─────────────────────────────────────────────────────╯

╭─ L1 · Very Stable ──────────────── 6,321 tk 🔒 ────╮
│ Threshold: 9+ responses unchanged                   │
├─────────────────────────────────────────────────────┤
│ ▸ Symbols (8 files)                     4,200 tk    │
│ ▸ Files (2)                             2,121 tk    │
╰─────────────────────────────────────────────────────╯

╭─ L2 · Stable ───────────────────── 4,892 tk 🔒 ────╮
│ Threshold: 6+ responses unchanged                   │
├─────────────────────────────────────────────────────┤
│ ▸ Symbols (12 files)                    3,500 tk    │
│ ▸ Files (3)                             1,392 tk    │
╰─────────────────────────────────────────────────────╯

╭─ L3 · Warming ──────────────────── 3,456 tk 🔒 ────╮
│ Threshold: 3+ responses unchanged                   │
├─────────────────────────────────────────────────────┤
│ ▸ Symbols (6 files)                     2,000 tk    │
│ ▸ Files (1)                             1,456 tk    │
╰─────────────────────────────────────────────────────╯

╭─ Active · Uncached ─────────────── 3,127 tk ───────╮
│ Recently changed, not cached                        │
├─────────────────────────────────────────────────────┤
│ ▾ Files (1)                             2,100 tk    │
│   └─ ac/edit_parser.py              2,100 tk 📝    │
│ ▸ URLs (2)                                800 tk    │
│ ▸ History (5 messages)                    227 tk    │
╰─────────────────────────────────────────────────────╯

╭─ Recent Changes ────────────────────────────────────╮
│ 📈 ac/llm/streaming.py → L1                         │
│ 📉 ac/edit_parser.py → active (modified)            │
╰─────────────────────────────────────────────────────╯
```

### Component Structure

```
CacheViewer (new component)
├── CachePerformanceBar      - Overall cache hit visualization
├── CacheTierBlock (×5)      - One per tier (L0, L1, L2, L3, active)
│   ├── TierHeader           - Name, tokens, threshold, lock icon
│   ├── TierContentGroup     - Collapsible content sections
│   │   ├── ContentRow       - System, Legend, Symbols, Files, URLs, History
│   │   └── ItemList         - Expanded list of individual items
│   └── StabilityBar         - Per-item progress toward next tier
└── ChangeNotifications      - Recent promotions/demotions
```

### Data Flow

```
get_context_breakdown() API
         │
         ▼
┌─────────────────────────────────────────────────────┐
│ {                                                   │
│   blocks: [                                         │
│     { tier: "L0", tokens: 8421, cached: true,       │
│       contents: [                                   │
│         { type: "system", tokens: 1800 },           │
│         { type: "symbols", count: 12, files: [...] }│
│       ]                                             │
│     },                                              │
│     ...                                             │
│   ],                                                │
│   promotions: ["ac/llm/streaming.py"],              │
│   demotions: ["ac/edit_parser.py"],                 │
│   cache_hit_rate: 0.78                              │
│ }                                                   │
└─────────────────────────────────────────────────────┘
         │
         ▼
    CacheViewer component renders tier blocks
```

### Stability Progress Indicator

For each item, show progress toward next tier:

```
ac/context/manager.py    220 tk  ████████░░ 8/9 → L1
```

- Bar fills based on `stable_count / next_threshold`
- Shows current count and target
- Arrow indicates next tier on promotion

### Interactions

| Action | Result |
|--------|--------|
| Click tier header | Collapse/expand tier |
| Click content group | Collapse/expand items |
| Click file name | Open in diff viewer |
| Click symbol file | Open in diff viewer |
| Hover item | Show stability details tooltip |
| Click URL | View URL content modal |
| Click "View Symbol Map" | Open full symbol map modal |

### Color Scheme

| Tier | Color | Meaning |
|------|-------|---------|
| L0 | Green (#4ade80) | Most stable, best cache hit |
| L1 | Teal (#2dd4bf) | Very stable |
| L2 | Blue (#60a5fa) | Stable |
| L3 | Yellow (#fbbf24) | Warming up |
| Active | Orange (#fb923c) | Not cached |

### Empty Tier Handling

- Empty tiers are collapsed by default with "(empty)" indicator
- Track session total of empty tier occurrences
- Show: "L2 · Stable (empty) ─── 0 tk"

## Implementation

### Phase 1: Backend API Enhancement

**File: `ac/llm/llm.py`**

The `get_context_breakdown()` method already returns most of what we need. Enhancements:

1. Add `stability_info` per item (stable_count, threshold for next tier)
2. Add `empty_tiers_this_request` count
3. Ensure `promotions` and `demotions` are populated

```python
# In blocks[].contents[].items or files list:
{
    "path": "ac/context/manager.py",
    "tokens": 220,
    "stable_count": 8,
    "current_tier": "L2",
    "next_tier": "L1",
    "next_threshold": 9,
}
```

### Phase 2: New CacheViewer Component

**New files:**
- `webapp/src/context-viewer/CacheViewer.js` - Main component
- `webapp/src/context-viewer/CacheViewerStyles.js` - Styles
- `webapp/src/context-viewer/CacheViewerTemplate.js` - Template

**Structure:**

```javascript
// CacheViewer.js
class CacheViewer extends LitElement {
  static properties = {
    breakdown: { type: Object },
    isLoading: { type: Boolean },
    expandedTiers: { type: Object },    // { L0: true, L1: false, ... }
    expandedGroups: { type: Object },   // { 'L0-symbols': true, ... }
    recentChanges: { type: Array },     // Last N promotions/demotions
  };
  
  // Methods
  toggleTier(tier) { }
  toggleGroup(tier, group) { }
  viewFile(path) { }
  viewUrl(url) { }
  getStabilityPercent(item) { }
}
```

### Phase 3: Integration

**File: `webapp/src/context-viewer/ContextViewer.js`**

Option A: Replace ContextViewer internals with CacheViewer
Option B: Add CacheViewer as a new view mode toggle

**Recommended: Option A** - The new tier-based view is strictly better.

Keep existing features:
- Token budget bar (enhanced with cache hit rate)
- URL management (include/exclude checkboxes)
- Symbol map modal button
- Session totals

### Phase 4: Change Notifications

Add toast-style notifications for tier changes:

```javascript
// In CacheViewer or parent component
_showChangeNotifications(promotions, demotions) {
  // Show transient notifications
  // Auto-dismiss after 5 seconds
  // Stack in bottom-right of panel
}
```

## File Changes Summary

| File | Changes |
|------|---------|
| `ac/llm/llm.py` | Enhance `get_context_breakdown()` with stability info |
| `ac/context/stability_tracker.py` | Add `get_item_info(item)` method |
| `webapp/src/context-viewer/CacheViewer.js` | New component |
| `webapp/src/context-viewer/CacheViewerStyles.js` | New styles |
| `webapp/src/context-viewer/CacheViewerTemplate.js` | New template |
| `webapp/src/context-viewer/ContextViewer.js` | Import and use CacheViewer |
| `webapp/src/context-viewer/ContextViewerTemplate.js` | Update to use new structure |
| `webapp/src/context-viewer/ContextViewerStyles.js` | Add tier-specific styles |

## Testing Strategy

### Manual Testing

1. **Tier accuracy** - Verify items appear in correct tiers
2. **Token counts** - Cross-reference with terminal HUD
3. **Promotion/demotion** - Make changes, verify notifications
4. **Expand/collapse** - All interactions work
5. **File navigation** - Clicking files opens diff viewer
6. **Cache hit rate** - Verify percentage matches API response

### Edge Cases

1. Empty tiers display correctly
2. Very long file paths truncate with tooltip
3. Large numbers of items scroll within tier
4. Rapid updates don't cause flicker
5. No data state shows appropriate message

## Future Enhancements

1. **Manual pinning** - Right-click to force item to L0
2. **Tier history** - Graph showing cache efficiency over time
3. **Cost estimation** - Show $ saved from cache hits
4. **Export** - Download cache state for debugging

## Open Questions

1. Should we show stability progress for ALL items or just those close to promotion?
2. How many recent changes to show in notifications panel?
3. Should empty tiers be hidden entirely or shown collapsed?
