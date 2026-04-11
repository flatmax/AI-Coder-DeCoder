# Cache Tiering System
 
## Overview

The cache tiering system organizes LLM prompt content into stability-based tiers that align with provider cache breakpoints (e.g., Anthropic's `cache_control: {"type": "ephemeral"}`). Content that remains unchanged across requests promotes to higher tiers; changed content demotes. This reduces re-ingestion costs.

Four categories of content are managed: **files** (full content), **symbol map entries** (compact structure), **history messages** (conversation pairs), and **URL content** (fetched web pages, GitHub repos, documentation).

The `StabilityTracker` is constructed with `cache_target_tokens` (default: 1536, but always overridden by `LLMService` with the model-aware computed value from `ConfigManager.cache_target_tokens_for_model()`).

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

**Symbol blocks** use a signature hash derived from the raw symbol data (names, types, parameters) rather than the formatted compact output. This avoids spurious hash mismatches when path aliases or exclusion sets change between requests.

**System prompt** is hashed from the prompt text alone, excluding the symbol legend. The legend includes path aliases that change when file selections change; including it would cause the system prompt to appear "changed" on every selection update, preventing it from stabilizing in L0.

## Graduation: Active → L3

Files/symbols with N ≥ 3 graduate to L3 **regardless of whether they're still in the active items list**. Still-selected files have their content move from the uncached "Working Files" section to the cached L3 block.

### URL Content — Direct Tier Entry (Not Yet Implemented)

> **Implementation status:** The URL tier entry mechanism described below is **specified but not yet implemented** in the current codebase. URL content currently flows through the uncached URL context section on every request (as a `user/assistant` pair between the file tree and review context). The stability tracker does not track `url:` items. This section describes the target design for a future implementation.

URL content is static once fetched (web pages, GitHub repos, documentation). Unlike files which may be edited, fetched URL content never changes. URLs therefore skip the active → L3 graduation path entirely and enter directly at **L1** with `entry_n = 9`. This ensures they are cached from their first appearance, avoiding unnecessary re-ingestion costs.

Tracked as `url:{url_hash}` items where `url_hash` is a short hash of the URL string. When a URL is removed from context (via the URL chips UI), its tracker entry is removed and the affected tier is marked as broken. When a URL is re-fetched (cache invalidation), its content hash changes, causing a normal demotion to active — but since the content is again static, it re-stabilizes quickly.

### History Graduation

History is immutable, so N ≥ 3 waiting is unnecessary. History graduation is **controlled**:

1. **Piggyback on L3 invalidation** — if L3 is already being rebuilt this cycle (files/symbols graduating, items demoted, stale items removed), all eligible history graduates for free. Zero additional cache cost
2. **Token threshold met** — if eligible history tokens exceed `cache_target_tokens`, the **oldest** messages graduate, keeping the most recent `cache_target_tokens` worth in active (since recent history is most likely to be referenced)
3. **Never** (if `cache_target_tokens = 0`) — history stays active permanently

The `cache_target_tokens` = `max(cache_min_tokens, min_cacheable_tokens) × buffer_multiplier`.

The `min_cacheable_tokens` is model-aware — per Anthropic's prompt caching docs:
- **4096 tokens** for Claude Opus 4.6, Opus 4.5, Haiku 4.5
- **1024 tokens** for Claude Sonnet 4.6, Sonnet 4.5, Opus 4.1, Opus 4, Sonnet 4

The `cache_min_tokens` config value (default: 1024) can override upward but never below the model's hard minimum. The `buffer_multiplier` defaults to 1.1. Example: Opus 4.6 → `max(1024, 4096) × 1.1 = 4505`. Sonnet → `max(1024, 1024) × 1.1 = 1126`.

## Ripple Promotion

When a tier's cache block is invalidated, veterans from the tier below may promote upward. This cascades downward through the tier stack.

**Critical rule:** Only promote into broken tiers. If a tier is stable, nothing promotes into it and tiers below remain cached.

### L0 Backfill

When L0 drops below `cache_target_tokens` (e.g., items removed due to file selection or deletion), the provider won't cache it — wasting the breakpoint. Rather than proactively breaking L1 to fill L0 (which would invalidate L1's cache), the system **piggybacks on L1 already being broken**: if L1 is in `_broken_tiers` for any reason during this cycle AND L0 is underfilled, L0 is also marked broken. This lets eligible L1 veterans (N ≥ 12) promote into L0 through the normal cascade. The threshold anchoring mechanism in L1 processing ensures L1 retains at least `cache_target_tokens` worth of items — anchored items have frozen N and cannot promote. This means L0 backfill never drains L1 below its caching threshold.

If L1 is stable (not broken), no backfill occurs — L0 stays underfilled until L1 is naturally invalidated by some other event (content change, item removal, etc.).

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

### Anchoring Implementation Detail

Anchoring state is tracked per-item during each cascade pass via a dynamically-set `_anchored` attribute on `TrackedItem` objects (not a declared dataclass field). The attribute is set to `True` or `False` during veteran processing and read via `getattr(item, '_anchored', False)` during promotion checks. The cascade re-evaluates anchoring from scratch on each cycle — previous anchoring state does not carry over between requests.

**Anchoring activation condition:** Anchoring only applies when the tier's total token count exceeds `cache_target_tokens` (`do_anchoring = total_tier_tokens > cache_target_tokens`). If a tier has fewer tokens than the cache target, no items are anchored and all veterans are eligible for promotion. This prevents small tiers from anchoring their only items and blocking promotion indefinitely.

## Demotion

Items demote to active (N = 0) when: content hash changes, or file appears in modified-files list.

## Item Removal

- **File unchecked** — `file:{path}` entry removed from its tier (causing a cache miss); the `sym:{path}` (or `doc:{path}`) entry **remains in whichever tier it has earned** independently (it was always tracked separately). The index block is no longer excluded from the symbol map / doc index output since the full file content is no longer in context
- **File deleted** — both file and symbol entries removed entirely
- **URL removed** — `url:{hash}` entry removed from its tier (causing a cache miss). Removed via URL chips UI (exclude or delete)
- Any of the above causes a cache miss in the affected tier

**Deselected file cleanup:** When a file is deselected, its `file:*` entry is removed from its tier during the stability update phase (`_update_stability`). The affected tier is marked as broken, triggering cascade rebalancing. Stale entries for files deleted from disk are separately cleaned up by `remove_stale()` in Phase 0.

## Cross-Reference Mode

A UI toggle lets the user add the *other* mode's index alongside the primary one:

| Primary Mode | Toggle Label | Effect |
|---|---|---|
| Code | **+doc index** | Doc-index file blocks (`doc:` keys) are added to the stability tracker |
| Document | **+code symbols** | Symbol-map file blocks (`sym:` keys) are added to the stability tracker |

#### Activation

A separate initialization pass runs for the cross-reference items, appending them to existing tier assignments without disturbing the primary index's items. The same reference-graph initialization algorithm is used (§ Initialization from Reference Graph) with the cross-reference index's reference graph. Cross-ref items receive the standard `entry_n` for their assigned tier.

#### Legends

Both the symbol-map legend and the doc-index legend are placed in L0 (they are small, stable, and don't change). The system prompt does not change — the user is still coding (code mode) or documenting (doc mode).

#### Tiered Assembly

`_build_tiered_content` dispatches on key prefix (`sym:` vs `doc:`) to determine which index provides the content block, regardless of the current mode. This means the same tier can contain a mix of `sym:` and `doc:` items.

#### Deactivation

When the toggle is turned OFF:

1. All cross-reference items are removed from the stability tracker (items whose prefix doesn't match the primary mode's prefix)
2. Affected tiers are marked as broken
3. No rebalancing cascade is run — keep it simple
4. A toast notifies the user

#### Readiness

The toggle is always available once the initial startup completes:

- In code mode: the doc index's structural extraction finishes within ~250ms of the "ready" signal, before any user interaction is possible. Keyword enrichment may still be in progress, but unenriched outlines are sufficient for cross-reference tier assembly.
- In document mode: the symbol index is always available (initialized at startup).

No `cross_ref_ready` gating is needed — the toggle appears unconditionally after startup.

#### Key Prefix Convention

| Prefix | Index | Provider |
|---|---|---|
| `symbol:` | Symbol index | `symbol_index.get_file_symbol_block()` |
| `doc:` | Doc index | `doc_index.get_file_doc_block()` |
| `url:` | URL service | `url_service.get_url_content(url).format_for_prompt()` |
| `file:` | File content | `file_context.get_content(path)` |
| `history:` | History | `context.get_history()[N]` |
| `system:` | System prompt | System prompt + legend text |

Content dispatch is prefix-based, not mode-based. This allows both indexes and URL content to coexist in the tracker without collisions. The `url:` prefix uses a 16-char SHA256 hash of the URL string as the key suffix (same hash function as `url_cache.url_hash()`).

**Note:** The code uses the full word `symbol:` (not the abbreviated `sym:` used elsewhere in this spec for brevity). When reading code or logs, tracker keys appear as `symbol:src/main.py`, not `sym:src/main.py`. This spec uses `sym:` as shorthand in prose but the actual key prefix is `symbol:`.

## The Active Items List

On each request, the system builds an active items list — the set of items explicitly in active (uncached) context:

1. **Selected file paths** — files the user has checked in the file picker
2. **Index entries for selected files** — `sym:{path}` (code mode) or `doc:{path}` (document mode) for each selected file (excluded from symbol map / doc index output since full content is present)
3. **Non-graduating history messages** — `history:N` entries not yet graduated
4. **Fetched URL content** — `url:{hash}` entries for all non-excluded URLs in the URL service

Index entries for **unselected** files are never in this list — they live in whichever cached tier they've earned through initialization or promotion.

URL items enter directly at L1 on first appearance (see § URL Content — Direct Tier Entry) since their content is static. They appear in the active items list for hash-tracking purposes but skip the normal N ≥ 3 graduation requirement.

When a selected file graduates to L3, its full content moves from the "Working Files" (uncached active) prompt section to the L3 cached block. The symbol map exclusion for that file is lifted since it's no longer in the active section.

## Initialization from Reference Graph

On startup, tier assignments are initialized from the cross-file reference graph. **No persistence** — rebuilt fresh each session. Initialized items receive their tier's `entry_n` as their starting N value and a placeholder content hash.

### L0 Seeding

L0 is seeded at initialization with the system prompt, index legend (symbol-map legend in code mode, doc-index legend in document mode, or both when cross-reference mode is active), and enough high-connectivity index entries to meet `cache_target_tokens`. Entries are selected by reference count descending (most-referenced first) from the reference index. A conservative per-entry token estimate (400 tokens) is used during seeding since real token counts aren't available until the first update — this prevents over-seeding L0 when placeholder tokens are too small. This ensures L0 is a functional cache block from the first request rather than requiring multiple promotion cycles.

### Post-Initialization Token Measurement

After `initialize_from_reference_graph` completes, `_measure_tracker_tokens()` iterates all `sym:` and `doc:` items and replaces their placeholder `tokens=0` with real token counts from the formatted symbol/doc blocks. This ensures the cache viewer tab can display per-item token counts and per-tier totals immediately — without waiting for the first chat request to trigger `_update_stability()`. Content hashes are also updated from signature hashes during measurement for accurate stability tracking.

**Prefix-based dispatch:** `_measure_tracker_tokens` only measures items whose key prefix matches the passed index — `doc:` items are measured via `get_file_doc_block()` and `symbol:` items via `get_file_symbol_block()`. Items with a mismatched prefix (e.g., `doc:` items in the code tracker when cross-reference mode adds them later) are skipped with a `continue` — they are measured separately by `_measure_cross_ref_tokens()` when cross-reference mode is enabled.

This measurement runs in both the code path (`_try_initialize_stability` and `complete_deferred_init`) and the document path (`_finalize_doc_mode_switch`).

### Clustering Algorithm

1. **Build mutual reference graph** — bidirectional edges only (A refs B AND B refs A)
2. **Find connected components** — naturally produces language separation and subsystem grouping
3. **Distribute across L1, L2, L3** — greedy bin-packing by cluster size, each cluster stays together
4. **Distribute orphan files** — files not in any connected component (no mutual references) are distributed into the smallest tier via the same greedy bin-packing. This is critical because `connected_components()` only returns files with bidirectional references — files with only one-way references or no references at all would otherwise be untracked at initialization, causing them to register as new active items on every request and never stabilize.

**L0 is never assigned by clustering** — content must be earned through promotion, with one exception: during initialization, the system prompt and index legend are seeded into L0, along with enough high-connectivity index entries (by `file_ref_count` descending) to meet `cache_target_tokens` (model-aware: 4505 for Opus 4.6, 1126 for Sonnet). This ensures L0 is immediately cacheable from the first request. Only index entries are initialized (file entries start in active). **L0-seeded entries are excluded from the subsequent L1/L2/L3 clustering distribution** to avoid double-placement.

After distribution, tiers below `cache_target_tokens` are merged into the smallest other tier to avoid wasting cache breakpoints on underfilled tiers.

**Fallback** (when no reference index or no connected components): sort all files by reference count descending (via `file_ref_count`), distribute roughly evenly across L1, L2, L3. If no reference index is available, all files are treated as having zero references and distributed by count alone.

## Cache Block Structure

See [Prompt Assembly](prompt_assembly.md) for the complete message ordering. Each non-empty tier uses one cache breakpoint. Providers typically allow 4 breakpoints per request. Blocks under the provider minimum won't actually be cached — the minimum is model-dependent (4096 tokens for Opus 4.5/4.6 and Haiku 4.5; 1024 tokens for Sonnet and other Claude models). The `cache_target_tokens` value accounts for this via `max(cache_min_tokens, min_cacheable_tokens) × buffer_multiplier`.

## N Value Display

Each tracked item's N value and promotion threshold are exposed to the frontend via the context breakdown API. The Cache Viewer tab and Token HUD both display **numeric `N/threshold`** labels alongside proportional stability bars, giving visibility into how close each item is to promotion. Items without an N value (e.g., system prompt, legend) show neither the label nor the bar.

## Cache Hit Reporting

Cache hit statistics are **read directly from the LLM provider's usage response**, not estimated locally. The provider reports cache read tokens and cache write tokens. The application requests usage reporting via `stream_options: {"include_usage": true}`.

## Order of Operations (Per Request)

At the start of each update cycle, `_broken_tiers` and `_changes` are cleared — each cycle starts with a fresh view of what changed.

### Phase 0: Remove Stale Items
Check tracked items against current repo files. Remove `file:`, `symbol:`, and `doc:` items whose underlying file path no longer exists in the repo.

### Phase 1: Process Active Items
For each item in the active items list:
1. Compute content hash
2. New: register at active, N=0
3. Changed: N=0, demote to active
4. Unchanged: N++

**Integrated cleanup:** Phase 1 also removes `file:*` and `history:*` items that are no longer in the active items list (deselected files, compacted history). `symbol:*` and `doc:*` items are exempt — they persist in their earned tiers since they represent repo structure, not user-selected content. This cleanup is integrated into the same pass rather than being a separate phase.

**First-measurement acceptance:** Items initialized with a placeholder content hash (empty string `""`) from `initialize_from_reference_graph()` accept their first real hash without triggering demotion. This prevents every initialized item from demoting on the first request after startup. Subsequent hash changes (non-empty → different non-empty) trigger normal demotion to active with N=0.

### Phase 2: Determine Items Entering L3
Three sources:
1. Items leaving active context with N ≥ 3
2. Active items with N ≥ 3 (still selected)
3. Controlled history graduation

### Phase 3: Run Cascade
Bottom-up pass: place incoming, process veterans, check promotion. Repeat until stable. Post-cascade: demote underfilled tiers.

### Phase 4: Record Changes
Log promotions/demotions for frontend display. Store current active items for next request.

### Post-Cascade Consolidation Detail

The `_demote_underfilled` step iterates tiers in reverse cascade order and skips three categories:

1. **L0** — terminal tier, never demoted
2. **L3** — items would demote to active, which is handled by a different mechanism (hash mismatch demotion)
3. **Tiers in the `_broken_tiers` set** — tiers that received promotions or experienced changes during this cycle. This prevents immediately undoing promotions that just occurred — if items were promoted into L2 this cycle, L2 won't be evaluated for underfill demotion in the same cycle

Only stable, untouched tiers (L1 and L2 in practice) that happen to be below `cache_target_tokens` are candidates for demotion. Each item demotes at most one level per call to avoid cascading double-demotions within a single pass.

## Index Exclusion

When a file is in active context (selected), its index entry (`sym:` or `doc:`) is **excluded** from all tiers to avoid redundancy. When a file graduates to a cached tier, the exclusion is lifted. This applies independently to both primary and cross-reference index entries.

### Active File Entry Removal

During `_update_stability`, when a file is in the selected files set, **both** `symbol:{path}` and `doc:{path}` entries are removed from the tracker (not just the current mode's prefix). This handles cross-reference mode correctly — if a file is selected in code mode with cross-ref enabled, both its `symbol:` entry (primary) and `doc:` entry (cross-ref) are removed and their affected tiers marked as broken. The removal is logged in the changes list with `reason: "file selected — full content replaces {prefix} entry"`.

### User-Excluded Files

Users can explicitly exclude files from the index via the file picker's three-state checkbox (see [File Picker — Index Exclusion](../5-webapp/file_picker.md#index-exclusion-three-state-checkbox)). Excluded files are:

1. **Removed from the stability tracker** — all `symbol:` and `doc:` entries for the path are deleted, affected tiers marked as broken
2. **Excluded from map generation** — merged into the `exclude_files` set passed to `get_symbol_map()` / `get_doc_map()`
3. **Skipped in active items** — `_update_stability()` does not create active items for excluded paths
4. **Excluded from tier recomputation** — the tier exclusion set includes user-excluded files alongside selected files

This is distinct from file deselection (which only removes `file:*` entries and leaves `sym:`/`doc:` entries in their earned tier). Exclusion removes the file from context entirely — no full content, no index block, no tracker item.

**Defensive double-removal:** Excluded files are removed from the tracker at two points: (1) immediately when `set_excluded_index_files()` is called (via `_remove_excluded_from_tracker()`), and (2) defensively at the start of every `_update_stability()` cycle. The second removal is necessary because excluded files still exist on disk, so the stale-item removal pass (`remove_stale`) won't catch them — without the defensive removal, they could re-appear in the tracker if another code path re-created their entries.

**Use case:** Repositories with extensive documentation (e.g., GB of converted docs) where the doc map alone exceeds the context budget. Users exclude directories of less-relevant docs to free token budget.

## History Compaction Interaction

When compaction runs, all `history:*` entries are purged from the tracker. Compacted messages re-enter as new active items with N = 0. This causes a one-time cache miss for tiers that contained history. The cost is temporary — the shorter history re-stabilizes within a few requests.

## Testing Invariants

- N increments only on unchanged content; resets to 0 on hash mismatch or modification
- First-measurement hash (empty → non-empty) accepted without demotion; tier and N preserved
- Graduation requires N ≥ 3 for files/symbols; history graduates via piggyback or token threshold; URLs enter L1 directly
- Promoted items enter destination tier with that tier's `entry_n`, not preserved N
- Ripple cascade propagates only into broken/empty tiers; stable tiers block promotion
- Anchored items (below `cache_target_tokens`) have frozen N
- N is capped at promotion threshold when tier above is stable
- Underfilled tiers demote one level down
- Stale items (deleted files) are removed; affected tier marked broken
- A file never appears as both index block and full content — when full content is in any tier, the index block (`sym:` or `doc:`) is excluded
- A URL never appears in both a cached tier and the uncached URL context section — when `url:{hash}` is in any tier, that URL is excluded from the uncached URL context pair
- History purge after compaction removes all `history:*` entries from tracker
- Deselected `file:*` items removed during Phase 1 processing (not a separate phase); `symbol:*`/`doc:*` items persist
- Multi-request sequences: new → active → graduate → promote → demote on edit → re-graduate