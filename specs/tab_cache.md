# Cache Tab Spec

The Cache tab (`TABS.CACHE`) visualizes the 4-tier LLM prompt cache system. It shows how content is organized for prefix caching, with stability indicators showing promotion progress. The UI component is `<cache-viewer>` and the backend is `LiteLLM.get_context_breakdown` (same endpoint as the Context tab, different view).

## Lazy Loading

Imported on first visit:
```
await import('./context-viewer/CacheViewer.js')
```
Switching to the tab triggers `_refreshViewer('cache-viewer')`. After each streaming response, `_refreshCacheViewer()` forces a refresh to capture one-shot promotion/demotion data from the backend.

## Component: `<cache-viewer>`

Extends `ViewerDataMixin(RpcMixin(LitElement))`. Shares `ViewerDataMixin` with `ContextViewer` for data fetching, URL modals, and symbol map modals.

### Tiers

The cache system uses four stability tiers plus an active (uncached) tier:

| Tier | Name | Threshold | Cached |
|---|---|---|---|
| L0 | Most Stable | 8+ responses unchanged | Yes (🔒) |
| L1 | Stable | 5+ responses | Yes (🔒) |
| L2 | Warming | 3+ responses | Yes (🔒) |
| L3 | New | 1+ responses | Yes (🔒) |
| active | Current | 0 (just added) | No |

Content is promoted to higher tiers as it remains unchanged across consecutive responses. Modified content is demoted back to active.

### Performance header

Shows cache hit rate as a percentage bar:
```
Cache Performance: 72% hit rate
[████████████████░░░░░] 45.2K cached / 62.8K total — 31% of budget
```

### Tier blocks

Each tier renders as a collapsible block with:

- **Header** — Tier name, description, token count, cached indicator
- **Threshold** — How many responses content must be unchanged to reach this tier
- **Content groups** — Nested collapsible groups by type

Default expansion: L0 and active expanded, others collapsed.

### Content groups within tiers

Each tier can contain these content types:

| Type | Icon | Items show |
|---|---|---|
| `system` | ⚙️ | System prompt (token count only, not expandable) |
| `legend` | 📖 | Symbol map legend (token count only) |
| `symbols` | 📦 | Symbol map files with stability bars |
| `files` | 📄 | Selected files with token counts and stability bars |
| `urls` | 🔗 | URLs with include/exclude checkboxes |
| `history` | 💬 | Chat messages — compact summary in cached tiers, detailed in active |

Groups are individually collapsible via `toggleGroup(tier, type)`.

### Stability bars

Each item in a symbols/files/history group shows a progress bar indicating how close it is to promotion:

- **Fill width** — `progress` (0–1) as percentage, colored by target tier
- **Label** — `stable_count/next_threshold` (e.g., "3/5") or "max" if at highest tier

### History display

- **Cached tiers** — Compact single-line summary: message count, user/assistant split, token total
- **Active tier** — Shows message count with budget warning if over limit

### Fuzzy search

A search box filters items across all tiers using character-by-character fuzzy matching (`fuzzyMatch`). Tiers with no matching items are hidden. The search matches against file paths, URL titles, or history message previews.

### Recent changes

After each response, the backend returns promotion/demotion lists (one-shot — cleared after read). These are displayed as a "Recent Changes" section:

- **📈 Promotions** — Grouped by target tier, showing item count and names
- **📉 Demotions** — Grouped by source tier, items that were modified and fell back to active

`_onBreakdownResult()` captures these from the response and stores them in `recentChanges`.

### File navigation

Clicking a symbol or file item calls `viewFile(path)`, which dispatches a `file-selected` event. The `symbol:` prefix is stripped for symbol entries to extract the file path.

### URL management

Same as Context tab — checkboxes toggle inclusion, View button opens modal, ✕ removes.

### Session totals

Same cumulative statistics as Context tab (tokens in/out, cache reads/writes).

### Footer

Model name, "Symbol Map" button (opens `<symbol-map-modal>`), and manual "↻ Refresh" button.

## Backend

The backend is `LiteLLM.get_context_breakdown` — the same method used by the Context tab. The `blocks` field in the response provides the tier-organized data that `CacheViewer` renders:

```pseudo
blocks: [
  {
    tier: "L0",
    name: "Most Stable",
    tokens: 12500,
    cached: true,
    threshold: 8,
    contents: [
      { type: "system", tokens: 2100 },
      { type: "symbols", items: [...], tokens: 8400, count: 15 },
      { type: "history", items: [...], tokens: 2000, count: 4 }
    ]
  },
  ...
]
```

### Stability tracking

The `StabilityTracker` (`ac/context/stability_tracker.py`) maintains per-item state:

- **n_value** — Number of consecutive responses where the item was present and unchanged
- **stable_count** — Same as n_value (used for display)
- **tier** — Current tier based on n_value vs thresholds
- **hash** — Content hash for change detection

After each streaming response, `_update_cache_stability()` in `StreamingMixin` calls `stability_tracker.update_after_response()` which:

1. Hashes each item's content
2. Compares to previous hash — unchanged items increment n_value, changed items reset to 0
3. Computes new tier from n_value
4. Records promotions/demotions
5. Returns tier assignments for the next request's prompt construction
