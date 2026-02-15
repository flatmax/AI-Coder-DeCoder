# Cache Tiering System

## Overview

The cache tiering system organizes LLM prompt content into stability-based tiers that align with provider cache breakpoints (e.g., Anthropic's `cache_control: {"type": "ephemeral"}`). Content that remains unchanged across requests promotes to higher tiers; changed content demotes. This reduces re-ingestion costs.

Three categories of content are managed: **files** (full content), **symbol map entries** (compact structure), and **history messages** (conversation pairs).

## Tier Structure

| Tier | Entry N | Promotion N | Description |
|------|---------|-------------|-------------|
| L0 | 12 | — (terminal) | System prompt, legend, core symbols/files |
| L1 | 9 | 12 | Very stable content |
| L2 | 6 | 9 | Stable content |
| L3 | 3 | 6 | Entry tier for graduated content |
| active | 0 | 3 | Recently changed or new. Not cached |

Each tier maps to a single cached message block in the LLM request. L0 always includes the system prompt and symbol map legend as fixed content.

## The N Value

Every tracked item has an **N value** measuring consecutive unchanged appearances.

| Event | N Behavior |
|-------|------------|
| New item | N = 0 |
| Unchanged across a request | N++ (with exceptions — see threshold anchoring) |
| Content changes (hash mismatch) | N = 0, demote to active |
| N ≥ 3 | Eligible for graduation from active to L3 |
| Enter a cached tier | N reset to tier's `entry_n` |

### Content Hashing

SHA256 hash of: file content (for files), compact symbol block (for symbols), or role+content string (for history).

## Graduation: Active → L3

Files/symbols with N ≥ 3 graduate to L3 **regardless of whether they're still in the active items list**. Still-selected files have their content move from the uncached "Working Files" section to the cached L3 block.

### History Graduation

History is immutable, so N ≥ 3 waiting is unnecessary. History graduation is **controlled**:

1. **Piggyback on L3 invalidation** — if L3 is already being rebuilt this cycle (files/symbols graduating, items demoted, stale items removed), all eligible history graduates for free. Zero additional cache cost
2. **Token threshold met** — if eligible history tokens exceed `cache_target_tokens`, the **oldest** messages graduate, keeping the most recent `cache_target_tokens` worth in active (since recent history is most likely to be referenced)
3. **Never** (if `cache_target_tokens = 0`) — history stays active permanently

The `cache_target_tokens` = `cache_min_tokens × buffer_multiplier` (default: 1024 × 1.5 = 1536).

## Ripple Promotion

When a tier's cache block is invalidated, veterans from the tier below may promote upward. This cascades downward through the tier stack.

**Critical rule:** Only promote into broken tiers. If a tier is stable, nothing promotes into it and tiers below remain cached.

### Promotion Thresholds

| Source Tier | Promotion N | Destination |
|-------------|-------------|-------------|
| L3 | 6 | L2 |
| L2 | 9 | L1 |
| L1 | 12 | L0 |

N is reset to the destination tier's `entry_n` on promotion.

## Threshold-Aware Promotion (Per-Tier Algorithm)

The cascade processes tiers bottom-up (L3 → L2 → L1 → L0), repeating until no promotions occur.

**A tier is processed when:** it has incoming items, OR it hasn't been processed yet AND either it or the tier above is broken.

**For each tier:**
1. **Place incoming items** with tier's `entry_n` (N is reset, not preserved)
2. **Process veterans** (at most once per cascade cycle, tracked by a "processed" set): if `cache_target_tokens > 0`, sort by N ascending, accumulate tokens. Items consumed before reaching `cache_target_tokens` are **anchored** (N frozen, cannot promote). Items past the threshold get N++, but N is **capped at the promotion threshold** if the tier above is stable
3. **Check promotion**: if tier above is broken/empty and N exceeds threshold → promote out, mark source tier as broken
4. **Post-cascade consolidation**: any tier below `cache_target_tokens` has its items demoted one tier down (keeping their current N) to avoid wasting a cache breakpoint

## Demotion

Items demote to active (N = 0) when: content hash changes, or file appears in modified-files list.

## Item Removal

- **File unchecked** — `file:{path}` entry removed from its tier (causing a cache miss); the `symbol:{path}` entry **remains in whichever tier it has earned** independently (it was always tracked separately). The symbol block is no longer excluded from the symbol map output since the full file content is no longer in context
- **File deleted** — both file and symbol entries removed entirely
- Either causes a cache miss in the affected tier

**Deselected file cleanup** happens at **two points** to avoid a one-request lag:

1. **At assembly time** (in `_gather_tiered_content`, before the LLM request) — `file:*` entries for files not in the current selected files list are removed immediately
2. **After the response** (in `_update_stability`) — the same check runs again as part of the normal stability update cycle

Both steps mark the affected tier as broken to trigger cascade rebalancing.

## The Active Items List

On each request, the system builds an active items list — the set of items explicitly in active (uncached) context:

1. **Selected file paths** — files the user has checked in the file picker
2. **Symbol entries for selected files** — `symbol:{path}` for each selected file (excluded from symbol map output since full content is present)
3. **Non-graduating history messages** — `history:N` entries not yet graduated

Symbol entries for **unselected** files are never in this list — they live in whichever cached tier they've earned through initialization or promotion.

When a selected file graduates to L3, its full content moves from the "Working Files" (uncached active) prompt section to the L3 cached block. The symbol map exclusion for that file is lifted since it's no longer in the active section.

## Initialization from Reference Graph

On startup, tier assignments are initialized from the cross-file reference graph. **No persistence** — rebuilt fresh each session. Initialized items receive their tier's `entry_n` as their starting N value and a placeholder content hash.

**Threshold anchoring does NOT apply during initialization.** Anchoring only runs during the cascade (Phase 3), which first executes after the first response.

### Clustering Algorithm

1. **Build mutual reference graph** — bidirectional edges only (A refs B AND B refs A)
2. **Find connected components** — naturally produces language separation and subsystem grouping
3. **Distribute across L1, L2, L3** — greedy bin-packing by cluster size, each cluster stays together
4. **Respect minimums** — tiers below `cache_target_tokens` merge into the smallest other tier

**L0 is never assigned by clustering** — content must be earned through promotion. Only symbol entries are initialized (file entries start in active).

**Fallback** (when no reference index is available): sort all files by reference count descending, fill L1 first (to `cache_target_tokens`), then L2, then L3.

## Cache Block Structure

See [Prompt Assembly](prompt_assembly.md) for the complete message ordering. Each non-empty tier uses one cache breakpoint. Providers typically allow 4 breakpoints per request. Blocks under the provider minimum (e.g., 1024 tokens for Anthropic) won't actually be cached.

## N Value Display

Each tracked item's N value and promotion threshold are exposed to the frontend via the context breakdown API. The Cache Viewer tab and Token HUD both display **numeric `N/threshold`** labels alongside proportional stability bars, giving visibility into how close each item is to promotion. Items without an N value (e.g., system prompt, legend) show neither the label nor the bar.

## Cache Hit Reporting

Cache hit statistics are **read directly from the LLM provider's usage response**, not estimated locally. The provider reports cache read tokens and cache write tokens. The application requests usage reporting via `stream_options: {"include_usage": true}`.

## Order of Operations (Per Request)

### Phase 0: Remove Stale Items
Check tracked items against current repo files. Remove items whose files no longer exist.

### Phase 1: Process Active Items
For each item in the active items list:
1. Compute content hash
2. New: register at active, N=0
3. Changed: N=0, demote to active
4. Unchanged: N++

### Phase 2: Determine Items Entering L3
Three sources:
1. Items leaving active context with N ≥ 3
2. Active items with N ≥ 3 (still selected)
3. Controlled history graduation

### Phase 3: Run Cascade
Bottom-up pass: place incoming, process veterans, check promotion. Repeat until stable. Post-cascade: demote underfilled tiers.

### Phase 4: Record Changes
Log promotions/demotions for frontend display. Store current active items for next request.

## Symbol Map Exclusion

When a file is in active context (selected), its symbol map entry is **excluded** from all tiers to avoid redundancy. When a file graduates to a cached tier, the exclusion is lifted.

## History Compaction Interaction

When compaction runs, all `history:*` entries are purged from the tracker. Compacted messages re-enter as new active items with N = 0. This causes a one-time cache miss for tiers that contained history. The cost is temporary — the shorter history re-stabilizes within a few requests.

## Testing Invariants

- N increments only on unchanged content; resets to 0 on hash mismatch or modification
- Graduation requires N ≥ 3 for files/symbols; history graduates via piggyback or token threshold
- Promoted items enter destination tier with that tier's `entry_n`, not preserved N
- Ripple cascade propagates only into broken/empty tiers; stable tiers block promotion
- Anchored items (below `cache_target_tokens`) have frozen N
- N is capped at promotion threshold when tier above is stable
- Underfilled tiers demote one level down
- Stale items (deleted files) are removed; affected tier marked broken
- A file never appears as both symbol block and full content — when full content is in any tier, the symbol block is excluded
- History purge after compaction removes all `history:*` entries from tracker
- Multi-request sequences: new → active → graduate → promote → demote on edit → re-graduate