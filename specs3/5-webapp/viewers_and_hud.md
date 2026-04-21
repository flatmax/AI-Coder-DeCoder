# Viewers and Token HUD

## Overview

Two components that consume the same backend data (`LLM.get_context_breakdown`) to show different perspectives on token usage and cache state: the **Context tab** (with Budget and Cache sub-views) and the **Token HUD** (floating overlay).

## Shared Backend

Both viewer tabs and the HUD call the same endpoint, with shared capabilities:

### FileContext Sync Before Breakdown

Before computing the breakdown, `get_context_breakdown()` synchronizes the in-memory `FileContext` with the current `_selected_files` list — removing files that are no longer selected and loading files that are newly selected. This ensures the breakdown reflects what the *next* LLM request would look like, not a stale snapshot from the last request. Without this sync, the context viewer would show outdated data when the user changes file selection between requests.

**Limitation:** The sync silently skips binary files and files that don't exist (checking `is_binary_file` and `file_exists` before loading). Unlike `_stream_chat`, which reports `binary_files` and `invalid_files` in the stream result, the breakdown sync does not surface these problems. The context viewer may therefore show a clean token budget while the next actual request would produce binary/missing file warnings and exclude those files. The discrepancy is minor (binary/missing files would contribute zero tokens either way) but could be confusing if the user expects the viewer to flag invalid selections.
- URL content modal (view fetched URL content) — each tab renders its own `<ac-url-content-dialog>` instance; see [Chat Interface — URL Content Dialog](chat_interface.md#url-content-dialog) for the dialog spec
- Map block modal (view full symbol/doc map block for any item) — the cache tab reuses `<ac-url-content-dialog>` for this purpose, passing the map block content as the `content` field and the item path as the title. The dialog's generic layout (title, scrollable body) works for both URL content and map blocks
- URL inclusion toggling and removal
- Loading guard prevents concurrent requests (additional triggers while a fetch is in-flight are dropped)
- Auto-refresh on `stream-complete` and `files-changed` events while visible; mark stale when hidden

### Tier Content Breakdown (Shared)

A static helper `_tier_content_breakdown(tier_items)` converts raw tracker items into structured detail dicts for both the frontend context breakdown and the terminal HUD. For each item, it classifies the type from the key prefix (`system:` → system, `file:` → files, `symbol:` → symbols, `doc:` → doc_symbols, `history:` → history), extracts the display name and path, and looks up the promotion threshold from the tier config. History items extract a numeric sort index from the key for correct ordering. The result is sorted by: system first, then symbols/doc_symbols, files, history (numerically by index), other.

### Mode-Aware Breakdown Computation

`get_context_breakdown()` dispatches to the appropriate index and system prompt based on the current mode (`Mode.CODE` or `Mode.DOC`):

| Field | Code Mode | Document Mode |
|-------|-----------|---------------|
| `system` tokens | `get_system_prompt()` | `get_doc_system_prompt()` |
| `legend` tokens | `SymbolIndex.get_legend()` | `DocIndex.get_legend()` |
| `symbol_map` tokens | `SymbolIndex.get_symbol_map()` | `DocIndex.get_doc_map()` |
| `symbol_map_files` | `len(_all_symbols)` | `len(_all_outlines)` |

When cross-reference mode is active, `legend` tokens include both legends, and `symbol_map` tokens include both the primary index map and the cross-referenced index map. The `symbol_map_files` count sums both indexes.

This ensures the context breakdown and terminal HUD report accurate token counts for the active mode rather than always using the code index.

`LLMService.get_context_breakdown()` returns:

```pseudo
{
    model: string,
    mode: string,                    // "code" or "doc" — current operating mode
    cross_ref_enabled: boolean,      // true if cross-reference mode is active (cross-ref toggle always available after startup)
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
        legend: integer,
        symbol_map: integer,
        symbol_map_files: integer,   // number of indexed files in current mode's index
        files: integer,
        file_count: integer,
        file_details: [{name, path, tokens}],
        urls: integer,
        url_details: [{name, url, tokens}],
        history: integer,
        history_messages: integer,
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

Cache hit rate is computed locally as `cached_tokens / total_tokens` from tier data. Additionally, a **`provider_cache_rate`** field is computed from cumulative session data (`cache_read_tokens / input_tokens`) when available — this is more accurate than the tier-based estimate since it reflects actual LLM provider behavior across the full session. The HUD and context tab prefer `provider_cache_rate` when non-null, falling back to the local `cache_hit_rate`.

---

## Context Tab

The Context tab contains two sub-views selectable via a **Budget / Cache** pill toggle in the toolbar. The active sub-view is persisted to localStorage (`ac-dc-context-subview`). Both sub-views share the same stale-detection and refresh-on-visible behavior. The Budget sub-view shows a refresh button in the toolbar; the Cache sub-view delegates its own toolbar (with filter input, sort toggle, stale badge, and refresh button) to the embedded `<ac-cache-tab>` component.

Both sub-views listen for `stream-complete`, `files-changed`, and `mode-changed` window events. When visible, they refresh immediately; when hidden, they set a stale flag and refresh on next `onTabVisible()` call.

### Budget Sub-View

#### Layout

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

#### Budget Bar Colors

≤ 75% Green, 75–90% Yellow, > 90% Red.

#### Stacked Category Bar

Below the budget bar, a proportional **stacked horizontal bar** visualizes the relative size of each category. Each segment is colored by category:

| Category | Color |
|----------|-------|
| System | Green `#50c878` |
| Symbol Map | Blue `#60a5fa` |
| Files | Amber `#f59e0b` |
| URLs | Purple `#a78bfa` |
| History | Orange `#f97316` |

Below the bar, a **legend row** shows colored dots with labels and token counts (e.g., `● System: 1.6K`). Only categories with non-zero tokens appear. In document mode, the symbol map label adapts: "Doc Map" (default), "Sym+Docs" or "Docs+Sym" (with cross-reference enabled).

#### Model Info

Below the budget bar: model name, cache hit rate percentage, and mode indicator. In document mode, ` · 📝 Doc Mode` is appended to the model name. Displayed as a compact info row.

#### Categories

Each category shows a name, proportional bar, and token count. Expandable categories (with ▶/▼ toggle) show per-item details when clicked:

| Category | Expandable | Detail Items |
|----------|------------|-------------|
| System Prompt | No | — |
| Symbol Map | Yes | Per-chunk name and tokens |
| Files | Yes | Per-file path and tokens |
| URLs | Yes | Per-URL with tokens |
| History | No | — |

Categories with zero tokens or no detail items show no toggle.

#### Session Totals

Fixed footer below categories: grid showing cumulative session totals (total, prompt in, completion out, cache read, cache write). Cache read highlighted green when non-zero; cache write highlighted yellow when non-zero.

---

### Cache Sub-View

Rendered by an embedded `<ac-cache-tab>` component inside the Context tab. When the user switches to the Cache sub-view, the context tab forwards `onTabVisible()` to the embedded cache tab to trigger a data refresh. The cache tab walks up through shadow DOM boundaries to find its parent `tab-panel` for active-state detection.

#### Cache Performance Header

A performance summary section at the top of the cache sub-view shows the cache hit rate as a percentage label and a proportional bar. Prefers `provider_cache_rate` when available, falling back to the local `cache_hit_rate`.

#### Layout

```
Cache Performance                     23% hit rate
[████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
──────────────────────────────────────────────
Filter items...              [⬇ Size] ● stale  [↻]
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

#### Content Groups

| Type | Icon | Detail |
|------|------|--------|
| system | ⚙️ | Token count |
| legend | 📖 | Token count |
| symbols | 📦 | File path + stability bar (N/threshold) + tokens |
| doc_symbols | 📝 | File path + stability bar (N/threshold) + tokens (used for `doc:` items in cross-ref mode or doc mode) |
| files | 📄 | File path + stability bar (N/threshold) + tokens |
| urls | 🔗 | Title + tokens |
| history | 💬 | Message count + tokens |

#### Measured vs Unmeasured Items

Within each tier, items are split into two groups for display:

- **Measured items** (`tokens > 0`) — rendered individually with icon, name, token count, stability bar, and N/threshold label. Names are clickable to view the full map block.
- **Unmeasured items** (`tokens === 0`) — collapsed into a single summary line: `📦 N pre-indexed {symbols|documents} (awaiting measurement)`. The label adapts based on whether the items include `doc_symbols` type entries. These are items that were initialized by the stability tracker from the reference graph but haven't had their token counts measured yet (measurement happens on the first `_update_stability` cycle after a chat request).

**Mode-aware labels:** When `mode === "doc"`, the cache viewer shows "pre-indexed documents" instead of "pre-indexed symbols" for unmeasured tier items, and uses the 📝 icon for symbol-type entries. The context viewer shows "Doc Map" instead of "Symbol Map" for the symbol_map category, and the stacked bar legend label adapts similarly. When cross-reference mode is active, both `sym:` and `doc:` items appear in the cache viewer — `sym:` items use the 📦 icon and `doc:` items use the 📝 icon, regardless of the current mode.

#### Stability Bars

Per-item: numeric `N/threshold` label displayed inline, plus a proportional fill bar with tier color. Tooltip shows `N={n}/{threshold}`. Only shown for items that have an N value (symbols, files). The numeric value gives precise progress toward promotion; the bar gives a visual summary.

#### Item Click → View Map Block

Clicking an item name opens a modal showing the full index block for that file. The backend (`get_file_map_block`) dispatches based on a priority chain:

1. **Special keys** — `system:prompt` returns the system prompt + legend for the current mode
2. **Current mode's index** — in doc mode, tries `doc_index.get_file_doc_block(path)` first; in code mode, tries `symbol_index.get_file_symbol_block(path)` first
3. **Cross-mode fallback** — if the primary index has no data for the path, the other index is tried. This handles cross-reference mode where `doc:` items appear in the code tracker (and vice versa) and need to be viewable from either mode
4. **Error** — if neither index has data, returns an error

The response includes the `mode` field (`"code"` or `"doc"`) indicating which index provided the content, so the frontend can apply appropriate formatting.

#### Fuzzy Search

Character-by-character matching against item names. Hides non-matching items and tiers with no matching items.

#### Sort Toggle

A **Size / Name** sort toggle button in the toolbar switches between sorting tier contents by token count descending (default) or alphabetically by name. The active sort mode is persisted to localStorage (`ac-dc-cache-sort`). Clicking the button cycles between modes. The button label shows the current sort mode with a down-arrow indicator (`⬇ Size` or `⬇ Name`).

#### Rebuild Button

A **🔄 Rebuild** button in the toolbar triggers a full cache tier redistribution via `LLMService.rebuild_cache()`. See [Cache Tiering — Manual Cache Rebuild](../3-llm-engine/cache_tiering.md#manual-cache-rebuild) for the full backend behavior.

**Visual states:**

| State | Label | Disabled |
|-------|-------|----------|
| Idle | `🔄 Rebuild` | No |
| In-flight | `⏳ Rebuilding…` | Yes (also disabled while refresh loading) |
| Cross-disabled | `🔄 Rebuild` | Yes (while any other load is in progress) |

The button exposes a `title` tooltip: *"Rebuild cache — redistribute all symbols/docs into tiers L0-L3. Selected files stay in active context."* This short description sells the outcome without requiring the user to know the tier mechanics.

**Interaction flow:**

1. User clicks **Rebuild** — the button transitions to `⏳ Rebuilding…` and disables
2. Frontend calls `LLMService.rebuild_cache` via RPC
3. Backend performs the rebuild sequence atomically (a few hundred milliseconds for typical repos)
4. On success, the backend returns `{status: "rebuilt", message: str, tier_counts: {...}, file_tier_counts: {...}}`
5. Frontend dispatches a `show-toast` event with the message (success toast)
6. Frontend calls `_refresh()` to reload the cache breakdown — the UI repopulates showing the new tier distribution
7. On error, the backend returns `{error: str}` and the frontend dispatches an error toast; `_refresh()` still runs to show the current (possibly partial) state

**Concurrency guard:** A `_rebuilding` state flag on the component prevents multiple concurrent rebuild requests. The button is also disabled while `_loading` is true (to prevent collision with an in-flight refresh).

**Restricted visibility:** The button is visible to all clients but the RPC is localhost-only. Remote participants clicking it receive a `{error: "restricted"}` response which surfaces as an error toast. Future work may hide the button for non-localhost participants (the client has access to `collabRole` via `SharedRpc`).

**Not tied to auto-refresh triggers:** Rebuild does not fire automatically on `stream-complete`, `files-changed`, or `mode-changed` events — it is purely user-initiated. The auto-refresh logic still runs normally and will reflect the rebuilt state whenever it next triggers.

#### Defaults

L0 and active tiers expanded by default; L1/L2/L3 collapsed.

#### Stale Indicator

When the tab is hidden during a stream-complete or files-changed event, a `● stale` badge appears. Auto-refreshes when the tab becomes visible.

#### Color Palette

Tiers use a warm-to-cool spectrum:
- L0: Green `#50c878` (most stable)
- L1: Teal `#2dd4bf`
- L2: Blue `#60a5fa`
- L3: Amber `#f59e0b`
- Active: Orange `#f97316`

Token values in monospace green. Cache writes in yellow. Errors in red.

#### Footer

Compact footer showing model name and total token count.

### Relationship to Token HUD

| Component | Location | Trigger | Persistence |
|-----------|----------|---------|-------------|
| Token HUD | Diff viewer background | Each `streamComplete` | Transient (~8s) |
| Context tab (Budget) | Dialog Context tab | Tab switch / file change | Persistent while visible |
| Context tab (Cache) | Dialog Context tab | Tab switch / file change | Persistent while visible |

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
- **Width**: 340px fixed, max-height 80vh with overflow scroll
- **Error filtering**: HUD does not appear for error responses or empty results
- **Section collapse persistence**: Each section's expanded/collapsed state is persisted to localStorage (`ac-dc-hud-collapsed`). Sections are collapsible via ▼/▶ toggle with keyboard support (Enter/Space). The toggle state is stored as a JSON-serialized Set of collapsed section names

---

## Terminal HUD

Printed to the terminal after each LLM response (not a UI component). Additionally, a one-time startup HUD is printed when the stability tracker initializes.

### Startup Init HUD

Printed once during server startup after stability tracker initialization completes (either eagerly at construction or lazily on the first request):

```
╭─ Initial Tier Distribution ─╮
│ L0       12 items            │
│ L1       18 items            │
│ L2       17 items            │
│ L3       17 items            │
├─────────────────────────────┤
│ Total: 64 items              │
╰─────────────────────────────╯
```

Shows per-tier item counts for all non-empty tiers (L0, L1, L2, L3, active). Box auto-sizes. Provides immediate visibility into how the reference graph was distributed.

### Post-Response HUD

Three sections printed after each LLM response:

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

Each tier line is followed by indented **sub-item summaries** grouped by type:

```
│ L0         1,622 tokens [cached]
│   └─ system + legend (1,622 tok)
│ L1        11,137 tokens [cached]
│   └─ 18 symbols (11,137 tok)
│ active    19,643 tokens
│   └─ 3 files (15,502 tok)
│   └─ 8 history msgs (4,141 tok)
```

Sub-items are aggregated by type (`system`, `symbols`, `files`, `history`, or the raw type name) with count and total tokens per group. This uses the same `_tier_content_breakdown()` method shared with the frontend viewers.

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

Category breakdown counted independently from tier data. In document mode, "Symbol Map" is labelled "Doc Map" and the system prompt tokens reflect the document system prompt. When cross-reference mode is active, an additional line shows the cross-referenced index's token count (e.g., `Doc Index: 8,234` in code mode, or `Symbol Map: 12,456` in document mode). `Last request` shows provider-reported input/output tokens. `Cache` line shows read and/or write counts (omitted if both zero). `Session total` is the cumulative sum of all token usage fields (input + output + cache read + cache write).

### Tier Changes

```
📈 L3 → L2: symbol:src/ac_dc/context.py
📈 L3 → L2: history:0
📉 L2 → active: symbol:src/ac_dc/repo.py
```

One line per change from the stability tracker's change log. Promotions (📈) listed first, then demotions (📉). Each line shows `{from} → {to}: {item_key}`. Item keys use the tracker's key format: `symbol:{path}`, `file:{path}`, or `history:{index}`.