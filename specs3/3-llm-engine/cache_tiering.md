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

1. **Piggyback on L3 invalidation** — if L3 is already being rebuilt, all eligible history graduates for free
2. **Token threshold met** — if eligible history tokens exceed `cache_target_tokens`, oldest messages graduate
3. **Never** (if `cache_target_tokens = 0`)

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

**For each tier:**
1. **Place incoming items** with tier's `entry_n`
2. **Process veterans** (if `cache_target_tokens > 0`): sort by N ascending, accumulate tokens. Items below `cache_target_tokens` are **anchored** (N frozen). Items past threshold get N++ (capped at promotion threshold if tier above is stable)
3. **Check promotion**: if tier above is broken and N exceeds threshold → promote out
4. **Post-cascade**: demote items from underfilled tiers

## Demotion

Items demote to active (N = 0) when: content hash changes, or file appears in modified-files list.

## Item Removal

- **File unchecked** — file entry removed; symbol entry returns to active (N = 0)
- **File deleted** — both entries removed entirely

## Initialization from Reference Graph

On startup, tier assignments are initialized from the cross-file reference graph. **No persistence** — rebuilt fresh each session.

### Clustering Algorithm

1. **Build mutual reference graph** — bidirectional edges only (A refs B AND B refs A)
2. **Find connected components** — naturally produces language separation and subsystem grouping
3. **Distribute across L1, L2, L3** — greedy bin-packing by cluster size, each cluster stays together
4. **Respect minimums** — tiers below `cache_target_tokens` merge into the smallest other tier

**L0 is never assigned by clustering** — content must be earned through promotion. Only symbol entries are initialized (file entries start in active).

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