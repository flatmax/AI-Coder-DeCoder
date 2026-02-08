# Cache UI Specification

## Overview

The cache UI visualizes a 4-tier content caching system (L0–L3 + active) used
to optimize LLM prompt prefix caching. It has three presentation surfaces:

1. **Cache Viewer** — full panel showing tier blocks, stability progress, and search
2. **Context Viewer** — budget-oriented view showing token allocation by category
3. **HUD overlay** — compact post-response popup with tier summaries and token usage

All three consume the same backend data from `LiteLLM.get_context_breakdown`.

---

## Tier Model

### Tiers (most stable → least stable)

| Tier   | Display Name       | Entry N | Promotion Threshold | Color     |
|--------|--------------------|---------|---------------------|-----------|
| L0     | Most Stable        | 12      | None (terminal)     | `#4ade80` |
| L1     | Very Stable        | 9       | 12 (→ L0)          | `#2dd4bf` |
| L2     | Stable             | 6       | 9 (→ L1)           | `#60a5fa` |
| L3     | Moderately Stable  | 3       | 6 (→ L2)           | `#fbbf24` |
| active | Active             | 0       | 3 (→ L3)           | `#fb923c` |

Tier colors are defined in `webapp/src/utils/tierConfig.js` and mirrored in
`ac/context/stability_tracker.py` for the terminal HUD.

### Tier Ordering in UI

Blocks are displayed **L0 → L1 → L2 → L3 → active** (most stable first).
Cached tiers (L0–L3) show a 🔒 lock icon. Active tier is uncached.

### Promotion Rules (Ripple Promotion)

- Items in **active** context start at N=0
- Each assistant response, veteran active items get N++
- Items leave active when removed from context → enter L3 at N=3
- Modified/edited items reset to N=0 and return to active (demotion)
- When items enter a tier, veterans in that tier get N++ (once per cascade)
- Veterans reaching the promotion threshold promote to the next tier
- Promotions cascade bottom-up (L3 → L2 → L1 → L0)
- If no promotions occur in a tier, higher tiers remain unchanged

### Threshold-Aware Promotion

When `cache_target_tokens > 0`:
- Tiers must accumulate enough tokens before veterans can promote
- Low-N veterans "anchor" tiers by filling the cache token threshold
- Only veterans past the threshold get N++ and can potentially promote
- A veteran won't promote if it would drain the tier below the token minimum
- After each cascade, tiers that fell below `cache_target_tokens` have their
  items demoted one tier down to avoid wasting a cache breakpoint

### Content Types Per Tier

Each tier can contain:
- **Symbols** — symbol map entries (prefixed `symbol:` in stability tracker)
- **Files** — file content blocks
- **History** — conversation messages (prefixed `history:` in stability tracker)
- **URLs** — fetched URL content (active tier only)
- **System prompt** — L0 only
- **Legend** — symbol map legend (L0 only)

---

## Data Flow

### Backend (`get_context_breakdown`)

Returns a JSON structure with:

```json
{
  "blocks": [
    {
      "tier": "L0",
      "name": "Most Stable",
      "tokens": 1622,
      "cached": true,
      "threshold": 12,
      "contents": [
        { "type": "system", "tokens": 1400 },
        { "type": "legend", "tokens": 139 },
        { "type": "symbols", "items": [...], "tokens": 0, "count": 0 },
        { "type": "files", "items": [...], "tokens": 0 },
        { "type": "history", "items": [...], "tokens": 0, "count": 0 }
      ]
    },
    {
      "tier": "L1",
      "name": "Very Stable",
      "tokens": 11137,
      "cached": true,
      "threshold": 9,
      "contents": [
        { "type": "symbols", "items": [...], "tokens": 11137, "count": 44 }
      ]
    },
    ...
  ],
  "total_tokens": 55448,
  "cached_tokens": 35805,
  "cache_hit_rate": 0.0,
  "max_input_tokens": 1000000,
  "model": "claude-opus-4",
  "promotions": [["symbol:foo.py", "L2"]],
  "demotions": [["tests/test_extractors.py", "active"]],
  "session_totals": {
    "prompt_tokens": 182651,
    "completion_tokens": 105,
    "total_tokens": 182756,
    "cache_hit_tokens": 0,
    "cache_write_tokens": 48070
  }
}
```

Also returns a flat `breakdown` dict for the Context Viewer:

```json
{
  "breakdown": {
    "system": { "label": "System Prompt", "tokens": 1622 },
    "symbol_map": { "label": "Symbol Map", "tokens": 34355, "files": [...], "chunks": [...] },
    "files": { "label": "Files", "tokens": 0, "items": [...] },
    "urls": { "label": "URLs", "tokens": 0, "items": [...] },
    "history": { "label": "History", "tokens": 21532, "needs_summary": false, "max_tokens": ... }
  },
  "used_tokens": 57347,
  "max_input_tokens": 1000000
}
```

### Frontend Data Mixin (`ViewerDataMixin`)

Shared by both CacheViewer and ContextViewer:

- **`refreshBreakdown()`** — calls `LiteLLM.get_context_breakdown` via RPC
- **Deduplication** — concurrent refresh calls return the same promise
- **Auto-refresh** — triggers when `selectedFiles`, `fetchedUrls`, or `excludedUrls` change
- **Visibility gating** — marks data stale when hidden; fetches on becoming visible
- **Cleanup** — clears timers/promises on `disconnectedCallback`

### Shared Capabilities

Both viewers inherit from ViewerDataMixin:
- URL modal (view fetched URL content)
- Symbol map modal (view full symbol map)
- URL inclusion toggling (include/exclude URLs from context)
- URL removal (dispatch event to parent)

---

## Cache Viewer (`<cache-viewer>`)

### Layout

```
┌─────────────────────────────────────────────┐
│ Cache Performance            0% hit rate    │
│ ████████████████████████████████████████████ │
│ 35.8K cached / 55.5K total      6% of budget│
├─────────────────────────────────────────────┤
│ Filter items... (fuzzy search)              │
├─────────────────────────────────────────────┤
│ RECENT CHANGES                              │
│ 📉 L1 → active: 1 item  📦 file_a.py      │
│ 📉 L3 → active: 1 item  📦 file_b.py      │
│ 📉 L2 → active: 1 item  📦 file_c.py      │
├─────────────────────────────────────────────┤
│ ▼ L0 · Most Stable             1.6K  🔒    │
│   Threshold: 12+ responses unchanged        │
│     ⚙️  System Prompt             1.4K      │
│     📖  Legend                      139      │
├─────────────────────────────────────────────┤
│ ► L1 · Very Stable            11.1K  🔒    │
├─────────────────────────────────────────────┤
│ ► L2 · Stable                 11.6K  🔒    │
├─────────────────────────────────────────────┤
│ ► L3 · Moderately Stable      11.4K  🔒    │
├─────────────────────────────────────────────┤
│ ▼ active · Active              19.7K       │
│   ▼ 📄 Files (4)               15.6K       │
│     tests/test_extractors.py    2.6K ██ 1/3 │
│     specs/cache_ui.md           3.1K ── 0/3 │
│     tests/test_history_co...    3.7K ── 0/3 │
│     tests/test_history_gr...    6.2K ── 0/3 │
│   💬 History (14 messages)       4.1K       │
├─────────────────────────────────────────────┤
│ Model: claude-opus    🗺️ Symbol Map  ↻     │
├─────────────────────────────────────────────┤
│ Session Totals                              │
│ In: 182.7K  Out: 105  Total: 182.8K        │
│ Cache Reads: 0  Writes: 48.1K              │
└─────────────────────────────────────────────┘
```

### Visual Details

- **Tier blocks** have a colored left border matching the tier color
- **Tier headers** show: `▼/► TIER · Display Name  TOKEN_COUNT  🔒`
- **Threshold line** shown below expanded tier header: "Threshold: N+ responses unchanged"
- **Token counts** displayed in monospace green (`#4ade80`)
- **Lock icon** 🔒 on cached tiers (L0–L3); absent on active tier

### Features

- **Search/filter** — fuzzy search across all item paths/titles/previews
  - Hides non-matching items and empty tiers
  - Clear button (✕) when query is non-empty
- **Tier expansion** — click tier header to expand/collapse
  - Default open: L0 and active
  - Default collapsed: L1, L2, L3
- **Content groups** — within a tier, expand symbol/file/URL/history groups
- **Stability bars** — per-item progress bar showing N/threshold toward next tier
- **File navigation** — clicking a file/symbol item dispatches `file-selected` event
- **URL management** — checkbox to include/exclude, View button, remove button
- **History display**:
  - Cached tiers: compact summary (message count + role breakdown)
  - Active tier: message count + total tokens
- **Recent changes** — individual items listed with tier transition and file name
  - Promotions shown with 📈, demotions with 📉
  - Shows changes from the most recent response only (matches terminal behavior)
  - Auto-expire after 30 seconds
  - Deduplicates via fingerprint to avoid re-adding on same refresh

### Content Group Config

| Content Type | Icon | Expandable | Item Detail |
|-------------|------|------------|-------------|
| system      | ⚙️   | No         | "System Prompt" + tokens |
| legend      | 📖   | No         | "Legend" + tokens |
| symbols     | 📦   | Yes        | File path + stability bar |
| files       | 📄   | Yes        | File path + tokens + stability bar |
| urls        | 🔗   | Yes        | Checkbox + URL title + tokens + View/Remove |
| history     | 💬   | No         | Message count + tokens |

### Stability Bar

Per-item progress indicator showing promotion progress:

```
tests/test_extractors.py    2.6K  ████████░░  1/3
specs/cache_ui.md           3.1K  ░░░░░░░░░░  0/3
```

- **Fill percentage**: `N / threshold × 100%`
- **Fill color**: current tier color (e.g., orange for active items approaching L3)
- **Empty color**: dark background (`#333`)
- **Text**: `N/threshold` (e.g., `1/3`, `6/9`)
- **Terminal tier (L0)**: shows `max` with 100% fill in green

---

## Context Viewer (`<context-viewer>`)

### Layout

```
┌─────────────────────────────────────────────┐
│ 🗺️ View Symbol Map                          │
├─────────────────────────────────────────────┤
│ Token Budget                                │
│ 57.3K / 1.0M                               │
│ █░░░░░░░░░░░░░░░░░░░ 6% used               │
├─────────────────────────────────────────────┤
│ Category Breakdown        ↻ Refresh         │
│   System Prompt          1.6K  ██           │
│ ▶ Symbol Map (149 files) 34.4K ████████████ │
│ ▶ Files (4)              15.6K ██████       │
│   URLs                      0               │
│   History                 4.1K ██           │
├─────────────────────────────────────────────┤
│ Model: claude-opus-4                        │
│ Session Totals                              │
│ In: 182.7K  Out: 105  Total: 182.8K        │
└─────────────────────────────────────────────┘
```

### Features

- **Symbol Map button** — at top; opens modal with full symbol map content
- **Budget bar** — overall token usage as percentage of `max_input_tokens`
- **Category rows** — proportional bar + token count for each category
- **Expandable categories**:
  - **Symbol Map** — chunk list (index, tokens, file count, cached status) or file list
  - **Files** — per-file token count; URLs included/excluded per-file
  - **URLs** — include/exclude checkboxes, View/Remove buttons
  - **History** — tier distribution when cache tiers are active
- **Refresh** — manual refresh button in breakdown header

### Budget Bar States

| Usage   | Color    | CSS Class |
|---------|----------|-----------|
| ≤ 75%   | `#4ade80` (green) | (none) |
| 75–90%  | `#fbbf24` (yellow) | `warning` |
| > 90%   | `#e94560` (red) | `danger` |

---

## HUD Overlay

Shown briefly after each streaming response completes. Rendered by
`renderHud()` in `HudTemplate.js`.

### Sections

1. **Header** — "📊 Tokens" + cache hit percentage badge (colored green/yellow/red)
2. **Cache Tiers** — per-tier row: label, content summary, tokens, cached indicator
3. **This Request** — prompt tokens, response tokens, total, cache hit/write
4. **History** — message count / token budget with warning/critical coloring
5. **Tier Changes** — promotions (📈) and demotions (📉), max 3 each shown
6. **Session Total** — cumulative in/out/total

### Cache Tier Row Format

```
L0  sys+legend          1.6K  🟢
L1  44sym              11.1K  🟢
L2  49sym              11.6K  🟢
L3  56sym              11.4K  🟢
active  4f+12hist      19.7K  ⚪
```

- 🟢 = cached tier, ⚪ = uncached (active)
- Content abbreviations: `sys`, `legend`, `Nsym`, `Nf`, `urls`, `Nhist`
- Tier label colored with tier color

### Interaction

- Mouse enter pauses auto-dismiss timer (default ~8 seconds)
- Mouse leave resumes timer
- Non-interactive (display only, no clickable elements)

---

## Terminal HUD

Two reports are printed to the terminal after each response:

### Cache Blocks Report

```
╭─ Cache Blocks ──────────────────────────────────────╮
│ L0 (12+)      1,622 tokens [cached]  │
│   └─ system + legend                                │
│ L1 (9+)      11,137 tokens [cached]  │
│   └─ 44 symbols                                     │
│ L2 (6+)      11,599 tokens [cached]  │
│   └─ 49 symbols                                     │
│ L3 (3+)      11,447 tokens [cached]  │
│   └─ 56 symbols                                     │
│ active       19,643 tokens           │
│   └─ 4 files + 12 history msgs + history            │
├─────────────────────────────────────────────────────┤
│ Total: 55,448 tokens | Cache hit: 0%                │
╰─────────────────────────────────────────────────────╯
```

### Token Usage Report

```
──────────────────────────────────────────────────
📊 model-name
──────────────────────────────────────────────────
  System:          1,622
  Symbol Map:      34,355
  Files:           0
  History:         21,532
──────────────────────────────────────────────────
  Total:           57,347 / 1,000,000
  Last request:    74,708 in, 34 out
  Cache:           write: 48,070
──────────────────────────────────────────────────
  Session in:      182,651
  Session out:     105
  Session total:   182,756
──────────────────────────────────────────────────
```

### Tier Change Notifications

Printed between reports when items change tiers:

```
📈 L3 → L2: 1 item — 📦 ac/symbol_index/cache.py
📉 L2 → active: 1 item — 📦 tests/test_extractors.py
```

---

## Shared UI Conventions

### Color Palette

| Element              | Color     |
|---------------------|-----------|
| Background          | `#1a1a2e` |
| Card background     | `#16213e` |
| Border/separator    | `#0f3460` |
| Primary text        | `#eee`    |
| Secondary text      | `#888`    |
| Muted text          | `#666`    |
| Token values        | `#4ade80` (green mono) |
| Cache write tokens  | `#fbbf24` (yellow) |
| Error               | `#e94560` |
| Hover background    | `#1a4a7a` |

### Typography

- Base: `system-ui, -apple-system, sans-serif` at 13px
- Token values: `monospace`
- Section titles: 11px uppercase with letter-spacing

### Token Formatting

Via `formatTokens()` in `webapp/src/utils/formatters.js`:
- `< 1000`: raw number (e.g., `139`)
- `≥ 1000`: divided by 1000 with one decimal + "K" (e.g., `1.6K`, `35.8K`)

### Modals

Both viewers use shared modal components:
- **`<url-content-modal>`** — displays fetched URL content with metadata
- **`<symbol-map-modal>`** — displays full symbol map text with loading state

Both extend `ModalBase` which provides overlay click-to-close and copy-to-clipboard.
