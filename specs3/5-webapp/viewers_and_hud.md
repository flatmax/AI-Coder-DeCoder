# Viewers and Token HUD

## Overview

Three components that consume the same backend data (`LLM.get_context_breakdown`) to show different perspectives on token usage and cache state.

## Shared Backend

`LLM.get_context_breakdown(selected_files, included_urls)` returns:

```pseudo
{
    blocks: [{tier, name, tokens, cached, threshold, contents}],
    breakdown: {system, symbol_map, files, urls, history},
    total_tokens, cached_tokens, cache_hit_rate,
    max_input_tokens, model,
    promotions, demotions,
    session_totals: {prompt, completion, total, cache_hit, cache_write}
}
```

Cache hit rate uses **real provider-reported usage data**, not estimates from tier placement.

---

## Context Viewer Tab

### Layout

```
Symbol Map button
Token Budget: 45.2K / 200.0K  [█████░░░░░░] 23% used
  System Prompt          1.6K  ██
  Symbol Map (N files)  34.4K  ████████████
  Files (N)             15.6K  ██████
  URLs                     0
  History                4.1K  ██
Model: name | Session Totals: In/Out/Total/Cache
```

### Budget Bar Colors

≤ 75% Green, 75–90% Yellow, > 90% Red.

### Expandable Categories

| Category | Shows |
|----------|-------|
| Symbol Map | Cache chunks with file lists |
| Files | Per-file token counts |
| URLs | Include/exclude toggles, view/remove |
| History | Tier distribution |

---

## Cache Viewer Tab

### Layout

```
Cache Performance: N% hit rate
[████████░░░] cached / total

Filter items... (fuzzy)

RECENT CHANGES
📈 L3 → L2: file_a
📉 L2 → active: file_b

▼ L0 · Most Stable     1.6K  🔒
    ⚙️ System Prompt    1.4K
► L1 · Very Stable    11.1K  🔒
▼ active              19.7K
    📄 Files (4)       15.6K
    💬 History (14)     4.1K

Model / Symbol Map / Refresh | Session Totals
```

### Content Groups

| Type | Icon | Detail |
|------|------|--------|
| system | ⚙️ | Token count |
| legend | 📖 | Token count |
| symbols | 📦 | File path + stability bar |
| files | 📄 | File path + tokens + stability bar |
| urls | 🔗 | Checkbox + title + tokens |
| history | 💬 | Message count + tokens |

### Stability Bars

Per-item: `N/threshold` fill with tier color.

### Fuzzy Search

Character-by-character matching. Hides non-matching items and empty tiers.

---

## Token HUD (Floating Overlay)

Floating overlay on the diff viewer background, appearing after each LLM response.

### Placement

- Top-level sibling in app-shell shadow DOM
- `position: fixed; top: 16px; right: 16px; z-index: 10000`
- Uses `RpcMixin` to fetch breakdown independently
- Triggered by `app-shell._onStreamCompleteForDiff`

### Sections (all collapsible)

| Section | Content |
|---------|---------|
| Header | Model name, cache hit % badge, dismiss |
| Cache Tiers | Per-tier bar chart with content details |
| This Request | Prompt, completion, cache read/write |
| History Budget | Usage bar with compact warning |
| Tier Changes | 📈 promotions, 📉 demotions |
| Session Totals | Cumulative tokens and cache saved |

### Behavior

- Auto-hide: 8 seconds → 800ms fade
- Hover pauses auto-hide
- Click ✕ to dismiss
- Shows basic data immediately from streamComplete; fetches full breakdown async

---

## Terminal HUD

Printed after each response (not a UI component):

### Cache Blocks
```
╭─ Cache Blocks ────────────────────╮
│ L0 (12+)    1,622 tokens [cached] │
│ active     19,643 tokens          │
├───────────────────────────────────┤
│ Total: 55,448 | Cache hit: 23%   │
╰───────────────────────────────────╯
```

### Tier Changes
```
📈 L3 → L2: 1 item — 📦 some/file
📉 L2 → active: 1 item — 📦 other/file
```