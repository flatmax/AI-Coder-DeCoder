# Cache and Context Viewers

## Overview

Two viewer tabs that consume the same backend data to show different perspectives:
- **Context Viewer** — token budget breakdown by category
- **Cache Viewer** — cache tier visualization with stability indicators

Both use a shared data-fetching mixin and call the same RPC endpoint.

## Shared Data Layer

### Data Fetching

- Calls `LLM.get_context_breakdown(selected_files, included_urls)`
- Deduplicates concurrent requests (one in-flight at a time)
- Auto-refreshes when selected files or URLs change while visible
- Marks data stale when hidden; fetches on becoming visible

### Shared Capabilities

Both viewers support:
- URL content modal (view fetched URL content)
- Symbol map modal (view full symbol map)
- URL inclusion toggling
- URL removal

---

## Context Viewer

### Layout

```
Symbol Map button
Token Budget: 45.2K / 200.0K  [█████░░░░░░] 23% used
Category Breakdown:
    System Prompt          1.6K  ██
    Symbol Map (N files)  34.4K  ████████████
    Files (N)             15.6K  ██████
    URLs                     0
    History                4.1K  ██
Model: model-name
Session Totals: In / Out / Total / Cache Reads / Writes
```

### Budget Bar States

| Usage | Color |
|-------|-------|
| ≤ 75% | Green |
| 75–90% | Yellow |
| > 90% | Red |

### Expandable Categories

| Category | Expandable | Shows |
|----------|-----------|-------|
| System Prompt | No | Token count only |
| Symbol Map | Yes | Cache chunks with file lists |
| Files | Yes | Per-file token counts |
| URLs | Yes | Include/exclude checkboxes, view/remove buttons |
| History | Yes | Tier distribution when cache is active |

---

## Cache Viewer

### Layout

```
Cache Performance: N% hit rate
[████████████░░░░░░░] cached / total — % of budget

Filter items... (fuzzy search)

RECENT CHANGES
📈 L3 → L2: N items — 📦 file_a
📉 L2 → active: N items — 📦 file_b

▼ L0 · Most Stable     1.6K  🔒
    ⚙️ System Prompt    1.4K
    📖 Legend             139
► L1 · Very Stable    11.1K  🔒
► L2 · Stable         11.6K  🔒
► L3 · Moderately     11.4K  🔒
▼ active · Active     19.7K
    📄 Files (4)       15.6K
    💬 History (14)     4.1K

Model / Symbol Map button / Refresh
Session Totals
```

### Tier Blocks

Each tier is collapsible with:
- Header: tier name, token count, lock icon if cached
- Threshold description
- Content groups by type

Default: L0 and active expanded; others collapsed.

### Content Groups

| Type | Icon | Expandable | Item Detail |
|------|------|-----------|-------------|
| system | ⚙️ | No | Token count |
| legend | 📖 | No | Token count |
| symbols | 📦 | Yes | File path + stability bar |
| files | 📄 | Yes | File path + tokens + stability bar |
| urls | 🔗 | Yes | Checkbox + title + tokens + view/remove |
| history | 💬 | No | Message count + tokens |

### Stability Bars

Per-item progress indicator:
```
some/file     2.6K  ████████░░  1/3
other/file    3.1K  ░░░░░░░░░░  0/3
```

- Fill: `N / threshold × 100%`
- Color: current tier color
- Text: `N/threshold` or `max` for L0

### Recent Changes

After each response, shows promotions (📈) and demotions (📉) with item names. One-shot: consumed from backend after read.

### Fuzzy Search

Character-by-character fuzzy matching across all items. Hides non-matching items and empty tiers.

### File Navigation

Clicking a symbol or file item dispatches a file-selected event.

---

## Backend

`LLM.get_context_breakdown` returns:

```pseudo
{
    blocks: [                    // Per-tier data for Cache Viewer
        {
            tier, name, tokens, cached, threshold,
            contents: [{type, items?, tokens, count?}]
        }
    ],
    breakdown: {                 // Per-category data for Context Viewer
        system: {tokens},
        symbol_map: {tokens, files, chunks},
        files: {tokens, items},
        urls: {tokens, items},
        history: {tokens, needs_summary, max_tokens}
    },
    total_tokens, cached_tokens, cache_hit_rate,
    max_input_tokens, model,
    promotions, demotions,
    session_totals: {prompt, completion, total, cache_hit, cache_write}
}
```

**Cache hit rate and cached_tokens are derived from real provider-reported usage data** (`session_totals.cache_hit` / `session_totals.prompt`), not estimated from tier placement. This ensures the UI reflects actual cache behavior as reported by the LLM provider. Before any requests have been made, the rate is 0%.

---

## Terminal HUD

Two reports printed after each response:

### Cache Blocks Report

```
╭─ Cache Blocks ─────────────────────────╮
│ L0 (12+)     1,622 tokens [cached]     │
│   └─ system + legend                   │
│ L1 (9+)     11,137 tokens [cached]     │
│   └─ 44 symbols                        │
│ active      19,643 tokens              │
│   └─ 4 files + 12 history msgs        │
├────────────────────────────────────────┤
│ Total: 55,448 | Cache hit: 0%         │
╰────────────────────────────────────────╯
```

The **Cache hit** percentage uses real provider-reported `cache_read_tokens / prompt_tokens` from the most recent request, not an estimate based on tier placement.

### Token Usage Report

```
Model: model-name
System:         1,622
Symbol Map:    34,355
Files:              0
History:       21,532
Total:         57,347 / 1,000,000
Last request:  74,708 in, 34 out
Cache:         write: 48,070
Session total: 182,756
```

### Tier Change Notifications

```
📈 L3 → L2: 1 item — 📦 some/file
📉 L2 → active: 1 item — 📦 other/file
```

---

## Token HUD (Diff Viewer Overlay)

A floating `<token-hud>` overlay positioned in the top-right of the diff viewer background. Separate from the Cache and Context viewer tabs — this is a transient post-response summary that auto-dismisses.

### Data Flow

1. `streamComplete` fires with `token_usage` in result
2. `app-shell._onStreamCompleteForDiff` calls `hud.show(result)` on the `<token-hud>` element
3. HUD displays immediate token data and asynchronously fetches `LLM.get_context_breakdown` via RPC
4. Full breakdown populates cache tiers, history budget, tier changes, and session totals

### Relationship to Tabs

| Component | Location | Trigger | Persistence |
|-----------|----------|---------|-------------|
| Token HUD | Diff viewer background (top-right) | Each `streamComplete` | Transient (~8s auto-hide) |
| Context Viewer tab | Dialog tab panel | Tab switch / file change | Persistent while visible |
| Cache Viewer tab | Dialog tab panel | Tab switch / file change | Persistent while visible |

All three consume `LLM.get_context_breakdown` but serve different purposes: the HUD is a quick glance after each response; the tabs provide detailed inspection.

---

## Color Palette (Reference)

Tiers use a warm-to-cool spectrum:
- L0: Green (most stable)
- L1: Teal
- L2: Blue
- L3: Amber
- Active: Orange

Token values displayed in monospace green. Cache writes in yellow. Errors in red.