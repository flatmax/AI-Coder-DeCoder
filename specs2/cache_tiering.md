# Cache Tiering System

## Overview

The cache tiering system organizes LLM prompt content into stability-based tiers that align with provider cache breakpoints (e.g., Anthropic's `cache_control: {"type": "ephemeral"}`). Content that remains unchanged across requests promotes to higher tiers; changed content demotes. This reduces re-ingestion costs.

Three categories of content are managed:
- **Files** — full file content in working context
- **Symbol map entries** — compact representations of file structure
- **History messages** — conversation history (user/assistant pairs)

## Tier Structure

Five tiers from most stable to least:

| Tier | Entry N | Promotion N | Description |
|------|---------|-------------|-------------|
| L0 | 12 | — (terminal) | System prompt, legend, core symbols/files |
| L1 | 9 | 12 | Very stable content |
| L2 | 6 | 9 | Stable content |
| L3 | 3 | 6 | Entry tier for graduated content |
| active | 0 | 3 | Recently changed or new. Not cached |

Each tier maps to a single cached message block in the LLM request. L0 always includes the system prompt and symbol map legend as **fixed content** placed at initialization.

## The N Value

Every tracked item has an **N value** measuring consecutive unchanged appearances.

### N Progression

1. **New item**: N = 0
2. **Unchanged across a request**: N increments by 1 (with exceptions — see threshold anchoring)
3. **Content changes** (hash mismatch): N resets to 0, item demotes to active
4. **N ≥ 3**: Eligible for graduation from active to L3 (whether still in active list or not)

**Critical:** N increment happens **before** the graduation check each cycle. When an item enters a cached tier, its N is **reset to the tier's `entry_n`**, not preserved from active. Files that are edited demote to active with N = 0 and must accumulate stability again.

### Content Hashing

Each item is hashed (SHA256) to detect changes:
- **Files**: hash of file content
- **Symbol entries**: hash of the compact symbol block
- **History messages**: hash of role + content string

## Graduation: Active → L3

Graduation happens when files/symbols reach N ≥ 3, regardless of whether they are still in the active items list. This ensures frequently-used files benefit from caching rather than being re-ingested every request.

### The Active Items List

On each request, the system builds an active items list — the set of items explicitly in active (uncached) context:

1. **Selected file paths** — files the user has checked in the file picker
2. **Symbol entries for selected files** — `symbol:{path}` for each selected file (excluded from symbol map output since full content is present)
3. **Non-graduating history messages** — `history:N` entries not yet graduated

Symbol entries for **unselected** files are never in this list — they live in whichever cached tier they've earned through initialization or promotion.

When a selected file graduates to L3, its full content moves from the "Working Files" (uncached active) prompt section to the L3 cached block. The symbol map exclusion for that file is lifted since it's no longer in the active section. L3 is rebuilt (cache miss) each time active content changes, but L0–L2 remain stable.

### Files and Symbols

Files and symbols with N ≥ 3 graduate from active to L3 **regardless of whether they are still in the active items list**. This means:

- **Still-selected files** with N ≥ 3 graduate to L3. Their full content moves from the uncached "active files" section to the cached L3 block. L3 is rebuilt (cache miss), but L0–L2 remain cached. This ensures frequently-used files benefit from caching.
- **Unchecked files** that leave the active items list with N ≥ 3 also graduate to L3 (same as before).

In both cases, N is reset to `entry_n` (3) on entry to L3.

If a graduated file is **edited** (content hash changes or it appears in the modified-files list), it demotes back to active with N = 0. On the next request its N begins accumulating again, and after 3+ unchanged appearances it re-graduates to L3.

When a file graduates, its symbol entry also graduates independently (they're tracked separately since a file in active context has full content, while its symbol entry is excluded from the symbol map). Graduated selected files are excluded from the "Working Files" (active) section of the prompt and instead appear in the L3 cached block.

### History Messages

History is **immutable** — once written, it never changes. So N ≥ 3 stability waiting is unnecessary. **All active-tier history is eligible for graduation** regardless of N value.

However, graduating history on every request would break the L3 cache every exchange (new messages are always added). History graduation from active to L3 is **controlled**:

1. **Piggyback on L3 invalidation** — If L3 is already being rebuilt this cycle (files/symbols graduating, items demoted, stale items removed), all eligible history graduates for free. Zero additional cache cost.

2. **Token threshold met** — If eligible history tokens exceed `cache_target_tokens`, the **oldest** messages graduate, keeping the most recent `cache_target_tokens` worth in active (since recent history is most likely to be referenced).

3. **Never** (if `cache_target_tokens = 0`) — History stays active permanently.

The `cache_target_tokens` = `cache_min_tokens × buffer_multiplier` (default: 1024 × 1.5 = 1536).

**Once graduated to L3**, history follows the same veteran rules as files and symbols.

## Ripple Promotion

When a tier's cache block is invalidated, veterans in the tier below may promote upward. This cascading behavior is called **ripple promotion**.

### Algorithm

1. A tier breaks (cache miss) because an item was demoted, removed, or changed
2. The most stable veterans (highest N) from the next lower tier promote **up** into the broken tier
3. This breaks the source tier, allowing veterans from below to promote
4. Cascade propagates **downward through the tier stack**
5. If a tier is **not broken**, the cascade stops — tiers below remain cached

Content flows **upward** (toward L0) while the cascade signal propagates **downward** (toward active).

### Critical Rule: Only Promote Into Broken Tiers

This prevents unnecessary cache invalidation:
- If L1 is stable → nothing promotes into L1, L2 and L3 stay cached
- If L1 breaks → L2 veterans promote into L1 → L2 breaks → L3 veterans promote → etc.

In steady state, all tiers are cached and nothing moves.

### Promotion Thresholds

| Tier | Promotion N | Destination |
|------|-------------|-------------|
| L3 | 6 | L2 |
| L2 | 9 | L1 |
| L1 | 12 | L0 |
| L0 | — | Terminal |

Promoted items enter with the destination tier's `entry_n` and begin accumulating again. **N is reset on tier entry** — the accumulated N from the source tier is not preserved.

## Threshold-Aware Promotion (Per-Tier Algorithm)

The cascade processes tiers bottom-up (L3 → L2 → L1 → L0), repeating until no promotions occur.

**For each tier being processed:**

1. **Place incoming items** into the tier with the tier's `entry_n` (N is reset, not preserved).

2. **Process veterans** (items already in this tier, at most once per cascade cycle):
   - **If threshold mode enabled** (`cache_target_tokens > 0`): Sort all items by N ascending. Walk from lowest N, accumulating tokens. Items consumed before reaching `cache_target_tokens` are **anchored** — N frozen, cannot promote. Items past the threshold get **N++**, but N is **capped at the promotion threshold** if the tier above is stable.
   - **If threshold mode disabled**: All veterans get N++.

3. **Check promotion**: After N++, if the tier above is broken/empty and item's N exceeds the promotion threshold → item **promotes out**, marking the source tier as broken.

4. **Post-cascade consolidation**: After the full cascade, any tier below `cache_target_tokens` has its items demoted one tier down (keeping their current N) to avoid wasting a cache breakpoint.

**A tier is processed when:** it has incoming items, OR it hasn't been processed yet AND either it or the tier above is broken.

**Key properties:**
- The anchoring phase throttles promotion velocity — lowest-N items fill the budget first
- N cap when tier above is stable prevents artificial inflation
- Anchored items retain their N without increment, preserving ordering
- Veterans are processed at most once per cascade cycle (tracked by a "processed" set)

## Demotion

Items demote to active (N = 0) when:
1. **Content changes** — hash mismatch
2. **Explicit modification** — file appears in the modified-files list
3. **Symbol invalidation** — when a file is modified, both file and symbol entries are marked modified

Demotion removes the item from its tier, causing a cache miss (ripple).

## Item Removal

- **File unchecked** — file entry removed from its tier; symbol entry returns to active (N = 0) since it's no longer redundant
- **File deleted** — both file and symbol entries removed entirely
- Either causes a cache miss in the affected tier

## Cache Block Structure

Messages sent to the LLM follow this order:

```
L0 (system role): system prompt + legend + L0 symbols + L0 files     [cached]
L0 history (native user/assistant pairs)                              [cached]
L1: symbols + files as user/assistant pair                            [cached]
L1 history (native pairs)                                             [cached]
L2: symbols + files pair                                              [cached]
L2 history (native pairs)                                             [cached]
L3: symbols + files pair                                              [cached]
L3 history (native pairs)                                             [cached]
File tree as user/assistant pair                                      (uncached)
URL context as user/assistant pair                                    (uncached)
Active files as user/assistant pair                                   (uncached)
Active history (native pairs)                                         (uncached)
Current user prompt                                                   (uncached)
```

**L0 is the system role message**, not a user/assistant pair. It concatenates system prompt, legend, L0 symbols, and L0 files into a single system message. L1/L2/L3 each use a user message (symbols + files) paired with an assistant "Ok." response.

Empty tiers are skipped entirely. Each cached tier has a `cache_control` marker on its last message. History is always sent as **native user/assistant message pairs**, not serialized text.

### Cache Control Placement

- **L0 without history**: cache_control on the system message itself (structured content format)
- **L0 with history**: cache_control on the last L0 history message (system message sent as plain string)
- **L1/L2/L3**: cache_control on the last message in the tier's sequence (the assistant "Ok." or the last history message)

### Cache Breakpoint Budget

Providers typically allow 4 breakpoints per request. Each non-empty tier uses one. A tier with both symbols/files and history places the breakpoint on the last history message (caching the entire prefix).

Blocks under the provider's minimum (e.g., 1024 tokens for Anthropic) won't actually be cached — the breakpoint is silently ignored. This is why the minimum token threshold exists.

### Cache Hit Reporting

Cache hit statistics are **read directly from the LLM provider's usage response**, not estimated locally. When the application places `cache_control: {"type": "ephemeral"}` breakpoints, the provider decides whether to serve those prefix tokens from its server-side cache. The provider then reports:
- **Cache read tokens** — prompt tokens served from cache (cheap/free)
- **Cache write tokens** — prompt tokens written to cache this request (slightly more expensive)

The application requests usage reporting via `stream_options: {"include_usage": true}`, which litellm translates to each provider's native mechanism. Different providers report cache tokens under different field names; the extraction handles all known formats with fallback chains.

## Symbol Map Exclusion

When a file is in active context (selected by the user), its full content is included. Its symbol map entry is **excluded** from all tiers to avoid redundancy. When a file is added to context, its symbol entry disappears from its cached tier, causing a cache miss.

## Initialization from Reference Graph

On startup, tier assignments are initialized from the cross-file reference graph. **No persistence** — stability data is rebuilt fresh each session. Initialized items receive their tier's `entry_n` as their starting N value and a placeholder content hash.

**Threshold anchoring does NOT apply during initialization.** Anchoring only runs during the cascade (Phase 3), which first executes after the first response. So the lifecycle is:

1. First request: initialization places symbol entries in L1/L2/L3 with appropriate N values
2. First response: `update_after_response` runs Phase 1–4; items leaving active enter L3 via cascade; initialized items in L1/L2/L3 participate as veterans
3. Subsequent requests: normal steady-state behavior

### Why No Persistence

Persisting across sessions causes stale state — files accumulate high N values and stay in L0 even when project focus shifts. Fresh initialization from the reference graph is simpler and more predictable.

### Clustering Algorithm

#### Step 1: Build Mutual Reference Graph

Extract **bidirectional edges only** — pairs where A references B AND B references A. One-way references are excluded because transitive closure over all edges creates one giant component (widely-imported utility files connect everything).

Bidirectional edges identify **mutual coupling** — files likely edited together.

#### Step 2: Find Connected Components

Build connected components from the bidirectional edge graph. This naturally produces:
- **Language separation** — JS and Python never have bidirectional references
- **Subsystem separation** — loosely coupled modules form separate clusters
- **Reasonable sizes** — typically 2–6 files per cluster

#### Step 3: Distribute Across L1, L2, L3

Estimate tokens for each cluster. Sort by size descending. Use **greedy bin-packing**: assign each cluster to the tier with fewest tokens. Each cluster stays together so editing one file only invalidates that cluster's tier. If any tier falls below `cache_target_tokens` after packing, merge it into the smallest other tier.

#### Step 4: Respect Minimum Tokens

If total content is insufficient for all three tiers:
- Fill fewer tiers, preferring L1 first
- An empty tier is better than one below the provider minimum

**Fallback** (when no reference index is available): sort all files by reference count descending, fill L1 first (to `cache_target_tokens`), then L2, then L3 absorbs the rest.

**L0 is never assigned by clustering** — content must be earned through promotion. Only symbol entries are initialized (file entries start in active).

## Order of Operations (Per Request)

### Phase 0: Remove Stale Items

Check all tracked items against current repo files. Remove items whose files no longer exist. Mark affected tiers as broken.

### Phase 1: Process Active Items

For each item in the active items list:
1. Compute content hash
2. **New item**: register at `tier=active, N=0`
3. **Content changed** (hash mismatch or in modified-files list): reset N=0, demote to active, mark old tier as broken
4. **Content unchanged**: increment N by 1

N increment happens here, **before** the graduation check.

### Phase 2: Determine Items Entering L3

Three sources:
1. **Items leaving active context** — in active list last request, not in this request. If currently active tier and N ≥ 3, they enter L3
2. **Active items with N ≥ 3** — files and symbols still in the active items list that have accumulated N ≥ 3 graduate to L3. Their content moves from the uncached active section to the cached L3 block. L3 rebuilds (cache miss) but higher tiers stay cached
3. **Controlled history graduation** — piggyback on L3 invalidation (if L3 already broken) or standalone (if eligible history tokens exceed `cache_target_tokens`, oldest messages graduate)

### Phase 3: Run Cascade

Bottom-up pass through L3 → L2 → L1 → L0:
- Place incoming items with tier's `entry_n` (N is reset)
- Process veterans: threshold anchoring, N increment, promotion check
- Repeat until no promotions occur
- Post-cascade: demote items from underfilled tiers

### Phase 4: Record Changes

Log promotions and demotions for frontend HUD display. Store current active items list for comparison on next request.

## Testing Invariants

- N increments only on unchanged content; resets to 0 on hash mismatch or modification
- Graduation requires N ≥ 3 for files/symbols; history graduates via piggyback or token threshold
- Promoted items enter destination tier with that tier's `entry_n`, not preserved N
- Ripple cascade propagates only into broken/empty tiers; stable tiers block promotion
- Anchored items (below `cache_target_tokens`) have frozen N
- N is capped at promotion threshold when tier above is stable
- Underfilled tiers demote one level down
- Stale items (deleted files) are removed; affected tier marked broken
- A file never appears as both symbol block and full content — when full content is in any tier, the symbol block is excluded; when a file is selected (active), its symbol entry is excluded from all tiers
- History purge after compaction removes all `history:*` entries from tracker
- Multi-request sequences: new → active → graduate → promote → demote on edit → re-graduate

## History Compaction Interaction

When compaction runs, all `history:*` entries are purged from the tracker. Compacted messages re-enter as new active items with N = 0. This causes a one-time cache miss for tiers that contained history. The cost is temporary — the shorter history re-stabilizes within a few requests.