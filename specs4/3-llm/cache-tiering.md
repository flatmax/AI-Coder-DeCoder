# Cache Tiering

**Status:** stub

Stability-based tiering of prompt content to align with provider cache breakpoints. Content that remains unchanged across requests promotes to higher tiers; changed content demotes. Reduces re-ingestion costs for large contexts.

## Content Categories Tracked

- Files — full content
- Symbol map entries — compact code structure per file
- Doc outline entries — compact doc structure per file
- History messages — conversation pairs
- URL content — fetched web pages, GitHub repos, documentation (design target; initial implementation may always include URLs in the uncached section)

## Tracker Instance Scope

A stability tracker instance is owned by its context manager, not shared globally across the session. Each context manager holds exactly one tracker; mode switching swaps between two tracker instances that the user-facing context manager alternates between (code-mode tracker and document-mode tracker), each preserving its own state.

Tracker instances are never singletons. A future parallel-agent mode (see [parallel-agents.md](../7-future/parallel-agents.md)) creates additional context managers for internal agents, each with its own independent tracker. Trackers do not communicate with each other — they scope to their owning context manager.

This spec describes the behavior of a single tracker. Everything below applies independently to each tracker instance.

## Tier Structure

- L0 — most stable — entry N high, terminal (no further promotion)
- L1 — very stable
- L2 — stable
- L3 — entry tier for graduated content
- Active — recently changed or new, not cached

Each tier maps to a single cached message block in the LLM request.

- Each tier has an entry N (the N value assigned on arrival) and a promotion N (the threshold for leaving)
- Active's promotion threshold is low — graduation to L3 is quick

## The N Value

- Every tracked item has an N measuring consecutive unchanged appearances
- New item — N = 0
- Unchanged across a request — N increments (with exceptions for threshold anchoring)
- Content changes (hash mismatch) — N reset to 0, demote to active
- N at or above active's promotion threshold — eligible for graduation
- Entering a cached tier — N reset to that tier's entry N

## Content Hashing

- SHA-256 of: file content, compact symbol/doc block, or role+content string for history
- Symbol blocks use a signature hash derived from raw symbol data, not formatted output — avoids spurious hash mismatches when path aliases or exclusion sets change between requests
- System prompt is hashed from the prompt text alone (not legend) — the legend changes when file selection changes, which would prevent system prompt from stabilizing

## Graduation: Active → L3

- Files and symbols with N at threshold graduate to L3 regardless of whether they are still in the active items list
- Still-selected files have their content move from the uncached working files section to the cached L3 block
- URL content (target design) skips the threshold wait — URLs enter directly at a high tier since content is static once fetched

## History Graduation

- History is immutable, so waiting on N is unnecessary — graduation is controlled
- **Piggyback on L3 invalidation** — if L3 is already being rebuilt, all eligible history graduates for free
- **Token threshold met** — if eligible history tokens exceed cache target, the oldest messages graduate, keeping the most recent window in active
- **Never** — if cache target is zero, history stays active permanently

## Cache Target Tokens

- Computed from model-family minimum × buffer multiplier
- Model-aware — providers specify different minimums per model family
- User-configured minimum can override upward but never below the model's hard floor
- A fallback value (without model reference) is used when the caller has no model context

## Ripple Promotion

- When a tier's cache block is invalidated, veterans from the tier below may promote upward
- Cascades downward through the tier stack
- Only promote into broken tiers — if a tier is stable, nothing promotes into it and tiers below remain cached

## L0 Backfill

- When L0 drops below cache target (items removed, selection change), the provider won't cache it
- Rather than proactively breaking L1, the system piggybacks — if L1 is broken for any reason AND L0 is underfilled, L0 is also marked broken
- Threshold anchoring in L1 ensures L1 retains at least the cache target; L0 backfill never drains L1 below its caching threshold

## Threshold-Aware Cascade Algorithm

- Process tiers bottom-up (L3 → L0), repeating until no promotions occur
- A tier is processed when it has incoming items, OR it has not been processed yet AND either it or the tier above is broken

For each tier:

1. Place incoming items with the tier's entry N
2. Process veterans once per cascade — if cache target is positive AND the tier exceeds cache target, sort by N ascending, accumulate tokens; items consumed before reaching cache target are **anchored** (N frozen, cannot promote); items past the threshold increment N, capped at promotion threshold if the tier above is stable
3. Check promotion — if the tier above is broken/empty and N exceeds threshold, promote out, mark source tier broken
4. **Post-cascade consolidation** — any tier below cache target has its items demoted one level (keeping their current N) to avoid wasting a cache breakpoint

## Anchoring Details

- Anchoring is a per-item transient flag set during each cascade pass
- Re-evaluated from scratch on each cycle — does not persist between requests
- Only applies when the tier exceeds cache target; small tiers anchor nothing

## Demotion

- Items demote to active (N = 0) when content hash changes or file appears in modified-files list

## Item Removal

- File unchecked — file entry removed from its tier (cache miss); symbol/doc entry remains in whichever tier it has earned independently
- File deleted — both file and symbol/doc entries removed entirely
- URL removed — URL entry removed from its tier (cache miss)
- Deselected file cleanup runs during stability update; affected tier marked broken
- Stale entries for deleted files cleaned up in a dedicated phase

## Manual Cache Rebuild

A user-initiated disruptive operation that wipes all tier assignments (except history) and redistributes using the reference-graph clustering algorithm. Exposed via the cache viewer's Rebuild button. Localhost-only — rebuild affects shared session state, remote collaborators cannot trigger it.

### Motivation

Normal operation grows the active tier with file entries as users select files, and those entries only graduate to L3 via the standard N-value progression across multiple request cycles. When many files are selected at once (e.g., loading a large working set at session start), the active tier can be dominated by full-content entries that take many requests to graduate. Rebuild immediately redistributes into L0–L3 using the same clustering algorithm as startup initialization, giving users control over cache layout without waiting for natural graduation.

### Sequence

Atomic from the RPC caller's perspective:

- Preserve history entries in the current tracker (history graduation is controlled separately below)
- Wipe everything else — system, symbol, doc, file, URL entries
- Mark all tiers broken so any follow-up cascade can freely rebalance
- Load content for selected files into file context so real hashes and token counts can be computed
- Re-initialize from the reference graph — every indexed file is placed as a symbol or doc entry across L0–L3 via clustering, using the mode-appropriate key prefix
- Measure tokens — replace placeholder counts from init with real counts derived from formatted blocks
- **Swap selected files from index entries to full-content file entries at the same tier** — enforces the "never appears twice" invariant; selected files become full-content file entries in cached tiers rather than landing in active
- **Distribute orphan selected files** — selected files not present in the primary index (non-source files like markdown, JSON, config, images) are bin-packed across L1/L2/L3 by current tier token count. Without this step, orphans would default to active and defeat the purpose of rebuild. L0 is excluded as a distribution target — L0 must be earned via promotion or explicit seeding
- Re-seed the system prompt into L0
- Re-seed cross-reference items if cross-reference mode is active
- **Graduate history via piggyback** — rebuild is treated as a disruptive event equivalent to L3 already being rebuilt this cycle, which unlocks the piggyback path. Walks newest → oldest, keeping the most recent messages totalling up to the cache target in active as the verbatim window; everything older graduates to L3 with L3's entry N
- Mark the tracker as initialized so subsequent chat requests skip the lazy-init path

### What Rebuild Does Not Do

- **Does not run the stability update cascade.** The deterministic placement computed during rebuild is the final state. Running the cascade would demote underfilled tiers and undo the careful placement. The next real chat request runs the cascade normally and rebuilt tiers behave identically to any other tier state.
- **Does not change file selection.** The user's selected-files list is untouched; only how those selections are tracked in tiers changes.
- **Does not change session state.** History content, session ID, and review state are preserved.
- **Does not persist.** Like startup initialization, the rebuilt state lives only in memory and is recomputed on the next server start.

### Orphan File Handling

The primary index in code mode contains only files the language parsers recognize. Selected markdown, JSON, config, and other non-source files are not in this index. Without special handling they bypass tier placement entirely and land in active. Rebuild's orphan distribution pass places them in L1/L2/L3 via the same bin-packing used for clustered initialization, tracked by current tier token count so the distribution stays balanced.

The symmetric situation applies in document mode — source files selected alongside documents become orphans in the doc index and receive the same treatment.

### History Graduation Detail

Rebuild is treated as equivalent to "L3 is already being rebuilt this cycle", matching the piggyback condition in [history graduation](#history-graduation). This lets rebuild preempt the normal cache-target-threshold wait and graduate history immediately. The verbatim window walks newest → oldest, accumulating tokens until the next message would exceed the cache target. Everything newer stays in active; everything older graduates to L3.

When the cache target is zero (history stays in active permanently), no history graduates regardless of rebuild.

### Response Shape

Rebuild returns a status dict with per-tier counts, a file-specific tier count (how many file entries landed in each tier), item counts before and after, and a human-readable summary string suitable for a toast. On failure returns an error dict — rebuild is all-or-nothing from the caller's perspective, though the next chat request's stability update repairs any partial state the failure might have left.

### When to Use Rebuild

- After selecting a large working set at the start of a session, to avoid many graduation cycles
- After a mode switch that populated the tracker from an empty state
- When the cache viewer shows most content in active and the user wants to force redistribution
- For debugging tier placement — rebuild reproduces a fresh initialization state

Rebuild is not needed during normal use. Tiers evolve correctly through the standard stability cycle. It is a user-facing convenience, not a required maintenance step.

## Cross-Reference Mode

- User toggle — primary mode keeps its index; the *other* index's file blocks are added alongside
- Separate initialization pass appends cross-reference items without disturbing primary index items
- Both legends included in L0 with appropriate headers
- Tier content dispatch is prefix-based (symbol vs doc), not mode-based — the same tier can contain a mix of items from both indexes
- Deactivation — cross-reference items removed, affected tiers marked broken, no full rebalancing cascade
- Toggle is always available once startup completes

## Active Items List

Built on each request — the set of items explicitly in active (uncached) context:

- Selected file paths (full content)
- Index entries (symbol or doc, depending on mode) for selected files — excluded from the compact map output since full content is present
- Non-graduating history messages
- Fetched URL content (target design)

Index entries for *unselected* files are never in this list — they live in whichever cached tier they have earned through initialization or promotion.

## Initialization from Reference Graph

- On startup, tier assignments are initialized from the cross-file reference graph
- No persistence — rebuilt fresh each session
- Initialized items receive their tier's entry N and a placeholder content hash

### L0 Seeding

- System prompt and legend seeded into L0 at init
- Enough high-connectivity index entries added to meet cache target
- Entries selected by reference count descending
- Conservative per-entry token estimate used before real counts are available — prevents over-seeding

### Post-Init Token Measurement

- After init, a measurement pass replaces placeholder tokens with real counts from formatted blocks
- Content hashes updated from signature hashes for accurate stability tracking
- Ensures the cache viewer displays per-item token counts immediately

### Clustering Algorithm

- Mutual reference graph — bidirectional edges only
- Connected components produce natural language separation and subsystem grouping
- Greedy bin-packing distributes clusters across L1, L2, L3
- Orphan files (no mutual references) distributed into the smallest tier
- L0 is never assigned by clustering — content must be earned through promotion (L0-seeded items are excluded from L1/L2/L3 distribution)

### Fallback

- Without a reference index or connected components: sort all files by reference count, distribute evenly across L1, L2, L3

## First-Measurement Acceptance

- Items initialized with a placeholder (empty-string) hash accept their first real hash without triggering demotion
- Subsequent hash changes trigger normal demotion
- Without this, every initialized item would demote on the first request after startup

## Order of Operations (Per Request)

Broken tiers set and change log cleared at start of each update cycle.

- **Phase 0: Remove stale items** — check tracked items against current repo files; remove entries for paths no longer present. Prerequisite — upstream indexes must be pruned of deleted files *before* the active items list is built
- **Phase 1: Process active items** — hash comparison, N increment or reset, integrated cleanup of deselected files and compacted history. Symbol and doc entries persist in their earned tiers
- **Phase 2: Determine L3 entrants** — items leaving active with N at threshold, active items with N at threshold, controlled history graduation
- **Phase 3: Run cascade** — bottom-up pass, place incoming, process veterans, check promotion, repeat until stable, post-cascade underfill demotion
- **Phase 4: Record changes** — log promotions and demotions, store current active items for next request

## Index Exclusion

When a file is in active context, its index entry is excluded from all tiers to avoid redundancy. When a file graduates to a cached tier, the exclusion is lifted. This applies independently to primary and cross-reference index entries.

### Active File Entry Removal

- Both symbol and doc entries for a selected file are removed from the tracker (not just the current mode's prefix)
- Handles cross-reference mode correctly
- Affected tiers marked broken; removal logged

### User-Excluded Files

- Users can explicitly exclude files from the index via the file picker's three-state checkbox
- Excluded files — removed from tracker, excluded from map generation, skipped in active items, excluded from tier recomputation
- Distinct from deselection: exclusion removes the file from context entirely
- Defensive double-removal — excluded files removed when the exclusion set changes and again at the start of every update cycle

## History Compaction Interaction

- Compaction purges all history entries from the tracker
- Compacted messages re-enter as new active items with N = 0
- One-time cache miss; shorter history re-stabilizes within a few requests

## Invariants

- A file never appears twice — when full content is in any tier, the index block is excluded from all maps
- A URL never appears in both a cached tier and the uncached URL section (design target)
- N increments only on unchanged content; resets to 0 on hash mismatch or modification
- Promoted items enter destination tier with that tier's entry N, not their preserved N
- Ripple cascade propagates only into broken tiers
- Anchored items have frozen N
- Post-init measurement replaces placeholder tokens with real counts before any tier display
- Manual rebuild preserves history entries and wipes everything else before re-initializing; deterministic placement is the final state, no follow-up cascade runs
- Manual rebuild swaps selected files from index entries to file entries at the same tier; selected files never land in active after rebuild
- Manual rebuild distributes orphan selected files (non-indexed) across L1/L2/L3, never into active or L0
- Manual rebuild is localhost-only; remote collaborators receive the restricted-error shape