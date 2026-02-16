# Viewers and Token HUD

## Overview

Three components that consume the same backend data (`LLM.get_context_breakdown`) to show different perspectives on token usage and cache state.

## Shared Backend

Both viewer tabs and the HUD call the same endpoint, with shared capabilities:
- URL content modal (view fetched URL content) — each tab renders its own `<ac-url-content-dialog>` instance; see [Chat Interface — URL Content Dialog](chat_interface.md#url-content-dialog) for the dialog spec
- Symbol map modal (view full symbol map)
- URL inclusion toggling and removal
- Loading guard prevents concurrent requests (additional triggers while a fetch is in-flight are dropped)
- Auto-refresh on `stream-complete` and `files-changed` events while visible; mark stale when hidden

### FileContext Sync Before Breakdown

Before computing the breakdown, `get_context_breakdown()` synchronizes the in-memory `FileContext` with the current `_selected_files` list — removing files that are no longer selected and loading files that are newly selected. This ensures the breakdown reflects what the *next* LLM request would look like, not a stale snapshot from the last request. Without this sync, the context viewer would show outdated data when the user changes file selection between requests.

**Limitation:** The sync silently skips binary files and files that don't exist (checking `is_binary_file` and `file_exists` before loading). Unlike `_stream_chat`, which reports `binary_files` and `invalid_files` in the stream result, the breakdown sync does not surface these problems. The context viewer may therefore show a clean token budget while the next actual request would produce binary/missing file warnings and exclude those files. The discrepancy is minor (binary/missing files would contribute zero tokens either way) but could be confusing if the user expects the viewer to flag invalid selections.

`LLMService.get_context_breakdown()` returns:

```pseudo
{
    model: string,
    total_tokens: integer,
    max_input_tokens: integer,
    cache_hit_rate: float,           // cached_tokens / total_tokens
    blocks: [{
        name: string,                // "L0", "L1", "L2", "L3", "active"
        tier: string,
        tokens: integer,
        count: integer,              // number of items in tier
        cached: boolean,
        contents: [{                 // optional, per-item details
            type: string,            // "system"|"legend"|"symbols"|"files"|"urls"|"history"
            name: string,
            path: string?,
            tokens: integer,
            n: integer?,             // stability N value
            threshold: integer?,
        }]
    }],
    breakdown: {
        system: integer,
        symbol_map: integer,
        files: integer,
        history: integer,
    },
    promotions: [string],            // "L3 → L2: symbol:path/to/file"
    demotions: [string],             // "L2 → active: symbol:path/to/file"
    session_totals: {
        prompt: integer,
        completion: integer,
        total: integer,
        cache_hit: integer,
        cache_write: integer,
    },
}
```

Cache hit rate is computed locally as `cached_tokens / total_tokens` from tier data. **Real provider-reported usage** (cache read/write tokens) is available in the per-request `token_usage` object delivered via `streamComplete`, and in `session_totals`.

---

## Context Viewer Tab

### Layout

```
Context Budget                              [↻ Refresh]
──────────────────────────────────────────────────────
Token Budget          45.2K / 200.0K
[████████░░░░░░░░░░░░░░░░░░░░░░░░] 22.6% used

Model: provider/model-name    Cache: 23% hit
──────────────────────────────────────────────────────
  ▶ System Prompt        1.6K  ██
  ▶ Symbol Map (42)     34.4K  ████████████████████
  ▶ Files (3)           15.6K  ██████████
    URLs                   0
    History              4.1K  ███
──────────────────────────────────────────────────────
Session Totals
  Prompt In      182.8K    Completion Out    12.4K
  Total          195.2K    Cache Hit         48.1K
```

### Budget Bar Colors

≤ 75% Green, 75–90% Yellow, > 90% Red.

### Model Info

Below the budget bar: model name and cache hit rate percentage. Displayed as a compact info row.

### Categories

Each category shows a name, proportional bar, and token count. Expandable categories (with ▶/▼ toggle) show per-item details when clicked:

| Category | Expandable | Detail Items |
|----------|------------|-------------|
| System Prompt | No | — |
| Symbol Map | Yes | Per-chunk name and tokens |
| Files | Yes | Per-file path and tokens |
| URLs | Yes | Per-URL with tokens |
| History | No | — |

Categories with zero tokens or no detail items show no toggle.

### Session Totals

Fixed footer below categories: 2×2 grid showing cumulative session totals (prompt in, completion out, total, cache hit).

---

## Cache Viewer Tab

### Layout

```
Cache Performance                     23% hit rate
[████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
──────────────────────────────────────────────
Filter items...                    ● stale  [↻]
──────────────────────────────────────────────
RECENT CHANGES
📈 L3 → L2: symbol:src/ac_dc/context.py
📉 L2 → active: symbol:src/ac_dc/repo.py
──────────────────────────────────────────────
▼ L0 · Most Stable     1.6K  🔒
    ⚙️ System Prompt            1.4K
    📖 Legend                      0.2K
► L1 · Very Stable    11.1K  🔒
► L2 · Stable          5.9K  🔒
► L3 · Entry           0.4K  🔒
▼ active              19.7K
    📄 src/context.py   ▓▓░░  9.3K
    📄 src/repo.py      ▓░░░  6.2K
    💬 History (8)             4.1K
──────────────────────────────────────────────
Model: provider/model    Total: 38.7K
```

### Content Groups

| Type | Icon | Detail |
|------|------|--------|
| system | ⚙️ | Token count |
| legend | 📖 | Token count |
| symbols | 📦 | File path + stability bar (N/threshold) + tokens |
| files | 📄 | File path + stability bar (N/threshold) + tokens |
| urls | 🔗 | Title + tokens |
| history | 💬 | Message count + tokens |

### Stability Bars

Per-item: numeric `N/threshold` label displayed inline, plus a proportional fill bar with tier color. Tooltip shows `N={n}/{threshold}`. Only shown for items that have an N value (symbols, files). The numeric value gives precise progress toward promotion; the bar gives a visual summary.

### Fuzzy Search

Character-by-character matching against item names. Hides non-matching items and tiers with no matching items.

### Defaults

L0 and active tiers expanded by default; L1/L2/L3 collapsed.

### Stale Indicator

When the tab is hidden during a stream-complete or files-changed event, a `● stale` badge appears. Auto-refreshes when the tab becomes visible.

### Color Palette

Tiers use a warm-to-cool spectrum:
- L0: Green `#50c878` (most stable)
- L1: Teal `#2dd4bf`
- L2: Blue `#60a5fa`
- L3: Amber `#f59e0b`
- Active: Orange `#f97316`

Token values in monospace green. Cache writes in yellow. Errors in red.

### Footer

Compact footer showing model name and total token count.

### Relationship to Tabs

| Component | Location | Trigger | Persistence |
|-----------|----------|---------|-------------|
| Token HUD | Diff viewer background | Each `streamComplete` | Transient (~8s) |
| Context Viewer | Dialog tab | Tab switch / file change | Persistent while visible |
| Cache Viewer | Dialog tab | Tab switch / file change | Persistent while visible |

---

## Token HUD (Floating Overlay)

Floating overlay on the diff viewer background, appearing after each LLM response.

### Placement

- Top-level `<ac-token-hud>` element in app-shell shadow DOM (sibling of dialog/diff containers)
- `position: fixed; top: 16px; right: 16px; z-index: 10000`
- Uses `RpcMixin` to fetch breakdown independently
- Triggered by `stream-complete` window event (filters out error responses)

### Data Flow

1. `streamComplete` fires → HUD extracts `token_usage` from result for immediate display
2. HUD makes async `LLMService.get_context_breakdown()` call for full data
3. Once full data arrives, all sections render with complete information

### Sections (all collapsible via ▼/▶ toggle)

| Section | Content |
|---------|---------|
| **Header** | Model name, cache hit % badge (color-coded: ≥50% green, ≥20% amber, <20% red), ✕ dismiss button |
| **Cache Tiers** | Per-tier horizontal bar chart. Each tier shows: name, proportional bar (colored by tier), token count, 🔒 if cached. Bar width relative to largest tier. Sub-items show icon, name, numeric `N/threshold` label, small stability bar (colored by tier), and token count. N value and bar only shown for items that have an N value |
| **This Request** | Prompt tokens, completion tokens. Cache read (green, shown if >0) and cache write (yellow, shown if >0) |
| **History Budget** | Total tokens vs max input tokens with usage bar. Bar colored green/yellow/red by percentage. History token count shown separately |
| **Tier Changes** | 📈 promotions and 📉 demotions as individual items with description text (e.g., "L3 → L2: symbol:src/file.py") |
| **Session Totals** | Prompt in, completion out, total. Cache saved (green, if >0) and cache written (yellow, if >0) |

### Behavior

- **Auto-hide**: 8 seconds → 800ms CSS opacity fade → hidden
- **Hover pauses**: mouse enter cancels timers and removes fade; mouse leave restarts auto-hide
- **Dismiss**: click ✕ to immediately hide
- **Width**: 320px fixed, max-height 80vh with overflow scroll
- **Error filtering**: HUD does not appear for error responses or empty results

---

## Terminal HUD

Printed to the terminal after each LLM response (not a UI component). Three sections:

### Cache Blocks (Boxed)

```
╭─ Cache Blocks ────────────────────────────╮
│ L0         (12+)    1,622 tokens [cached] │
│ L1          (9+)   11,137 tokens [cached] │
│ L2          (6+)    8,462 tokens [cached] │
│ L3          (3+)      388 tokens [cached] │
│ active             19,643 tokens          │
├───────────────────────────────────────────┤
│ Total: 41,252 | Cache hit: 52%           │
╰───────────────────────────────────────────╯
```

Each cached tier shows `{name} ({entry_n}+)` — the entry N threshold — followed by the token count and `[cached]`. Active tier shows token count only. Only non-empty tiers are listed. The box width auto-sizes to the widest line. Cache hit percentage is computed as `cached_tokens / total_tokens`.

**L0 special-casing:** The terminal HUD always adds system prompt + legend tokens to L0's display, since these are fixed overhead not tracked by the stability tracker. System + legend tokens appear as a synthetic sub-item. Both the terminal HUD and frontend viewers should include this overhead in L0's total for consistency.

### Token Usage

```
Model: bedrock/anthropic.claude-sonnet-4-20250514
System:         1,622
Symbol Map:    34,355
Files:              0
History:       21,532
Total:         57,509 / 1,000,000
Last request:  74,708 in, 34 out
Cache:         read: 21,640, write: 48,070
Session total: 182,756
```

Category breakdown (System, Symbol Map, Files, History) counted independently from tier data. `Last request` shows provider-reported input/output tokens. `Cache` line shows read and/or write counts (omitted if both zero). `Session total` is the cumulative sum of all token usage fields (input + output + cache read + cache write).

### Tier Changes

```
📈 L3 → L2: symbol:src/ac_dc/context.py
📈 L3 → L2: history:0
📉 L2 → active: symbol:src/ac_dc/repo.py
```

One line per change from the stability tracker's change log. Promotions (📈) listed first, then demotions (📉). Each line shows `{from} → {to}: {item_key}`. Item keys use the tracker's key format: `symbol:{path}`, `file:{path}`, or `history:{index}`.