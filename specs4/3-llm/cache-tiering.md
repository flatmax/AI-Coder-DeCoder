# Cache Tiering

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

## Per-Tracker Initialization

Each tracker instance is initialized independently against the index that feeds it — the code-mode tracker initializes from the symbol index's reference graph; the document-mode tracker initializes from the doc index's reference graph. Initialization state is per-tracker, not per-session.

First-time switching INTO a mode runs the initialization pass for that mode's tracker. Without this, a fresh tracker stays empty until the user clicks Rebuild — the cache viewer would show nothing after a mode switch, matching no visible content in the prompt either.

Switching BACK to a previously-initialized mode is a no-op for initialization — the preserved tracker's tier state is correct. Init is idempotent per tracker; re-running after state preservation would be wasteful but not incorrect.

When the target mode's index isn't ready (doc index still building on first switch to doc mode), initialization skips cleanly. The next request's lazy-init retry catches it once readiness flips. Users who hit this race see an empty doc tracker briefly before the next chat populates it.

## Tier Structure

- L0 — content-typed, never invalidated — system prompt + aggregate symbol map + aggregate doc map
- L1 — most stable promoted concrete content
- L2 — stable promoted concrete content
- L3 — entry tier for graduated promoted content
- Active — recently changed or new, not cached

Each tier maps to a single cached message block in the LLM request.

L0 is content-typed: it always contains the system prompt and the aggregate structural maps over every indexed file. The cascade does not place items into L0; the cascade does not rewrite L0. L0's byte sequence is a function of the index state captured at session start (or after explicit `rebuild_cache`), and is otherwise fixed for the session.

L1, L2, L3 hold *promoted concrete content* — full file text, fetched URL content, and graduated history. Symbol blocks and doc blocks never appear in L1–L3; they live only in L0's aggregate maps.

- Each tier (L1, L2, L3) has an entry N (the N value assigned on arrival) and a promotion N (the threshold for leaving)
- Active's promotion threshold is low — graduation to L3 is quick
- Promotion from L3 → L2 → L1 follows the existing N-counter cascade
- Nothing promotes into L0; the cascade respects the policy "files, URLs, and history are ineligible for L0"

## L0 Stability Contract

L0 is invalidated only by:

- Application restart
- Explicit cache rebuild (`rebuild_cache` RPC; ideally extended to fire automatically post-commit)

Nothing else touches L0. Specifically, L0 is *not* invalidated by:

- File edits, creations, or deletions
- Selection toggles (selecting or deselecting a file)
- URL fetches
- History compaction
- Session loads
- Mode switches
- Any item entering or leaving L1, L2, L3, or Active

The aggregate symbol/doc maps in L0 may therefore drift during a session — a file edited mid-session is reflected accurately in the lower tiers (where its full text lives) but its symbol-block summary in L0 may be stale until the next rebuild. This is acceptable because:

1. The full edited text is always present in Active or a lower cached tier (see the edit invariant below) — the truthful current state is in the prompt.
2. The system prompt's "How Files Appear in This Prompt" clause instructs the LLM to treat full-text in Working Files as authoritative when it disagrees with the structural map.
3. Modern instruction-tuned models follow recency bias plus the explicit authority rule reliably.

The cost is a small risk that the LLM produces a comment or question based on a stale symbol-map signature. The benefit is that L0 — the largest single cached block in the prompt — survives every routine event in a session.

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

- Files with N at threshold graduate to L3 regardless of whether they are still in the active items list
- Still-selected files have their content move from the uncached working files section to the cached L3 block
- URL content (target design) skips the threshold wait — URLs enter directly at a high tier since content is static once fetched
- Symbol blocks and doc blocks do not graduate — they are always present in L0's aggregate maps from session start; they have no Active → L3 path

## Edit Invariant

When a file's content hash changes (LLM edit applied, or future user-side edit detected):

- `file:<path>` is demoted to Active with fresh content (existing hash-change behaviour)
- The entry is **pinned** — stale cleanup and automatic eviction skip it
- It rides the cascade upward normally (Active → L3 → L2 → L1 over stable turns)
- Only application restart or explicit cache rebuild can clear pinned files

Unmodified files can still be deselected by the user as today; deselection of an unmodified file removes its `file:<path>` entry from tracking. The pin only protects files that have been edited during the current session.

The edit invariant guarantees that the truthful, current text of every edited file is always present somewhere in the prompt — either in Active (just edited) or in a graduated lower tier. The LLM never has to reason about a file whose only representation is a stale L0 symbol-block.

## History Graduation

- History is immutable, so waiting on N is unnecessary — graduation is controlled
- **Piggyback on L3 invalidation** — if L3 is already being rebuilt, all eligible history graduates for free; walks newest → oldest, keeping a verbatim window sized at `cache_target_tokens` in active and graduating everything older to L3
- **Never** — if cache target is zero, or if L3 is not already being rebuilt this cycle, history stays active

Active history is not forced to graduate on its own. A long conversation that never happens to coincide with an L3 invalidation stays in the uncached active section until compaction deals with it. This is deliberate. `cache_target_tokens` is a per-tier caching floor (typically a few thousand tokens), not a conversation-length cap — comparing total active history against it would force graduation on almost every turn of any real conversation, tearing down the L3 cache block on every request. Compaction, which has its own much larger `trigger_tokens` budget and purges tracker history when it runs, is the correct owner of "active history is too big".

## Cache Target Tokens

- Computed from model-family minimum × buffer multiplier
- Model-aware — providers specify different minimums per model family
- User-configured minimum can override upward but never below the model's hard floor
- A fallback value (without model reference) is used when the caller has no model context

## Ripple Promotion

- When a tier's cache block is invalidated, veterans from the tier below may promote upward
- Two kinds of invalidation behave differently in the cascade:
  - **External** invalidation — user deselects a file, a hash changes, a tier is marked broken by the orchestrator before the cascade runs. Opens exactly one upward path. The tier itself becomes a promotion target for the tier below, but the chain does not propagate past it uninvited — e.g. an L1 deselect must not drain L0
  - **Structural** invalidation — a tier loses residents because they promoted upward, so its cache block genuinely needs rebuilding. Propagates: the now-drained tier becomes a legitimate promotion target for the tier below it. This is how ripple promotion chains upward through multiple levels (external L1 break → L2→L1, L2 now structurally broken → L3→L2, L3 now structurally broken → active→L3 graduates)
- Only promote into broken tiers — if a tier is stable at cascade entry AND no upstream structural invalidation has reached it, nothing promotes into it and tiers below remain cached
- The destination of an external invalidation is never itself a source of structural invalidation — receiving content is the purpose of the invalidation, not a sign that further drain is needed. This is what keeps external L1 invalidation from draining L0

## L0 Backfill (legacy mechanism, narrow scope)

Under the L0-content-typed model, L0 holds the system prompt + aggregate maps and is not subject to size-based backfill. The aggregate maps include every indexed file by construction; there is no notion of "L0 underfilled".

The `backfill_l0_after_measurement` mechanism remains in the codebase for one specific path: cross-reference activation. When the user enables cross-reference mode, the opposite-mode index's most-connected items are promoted into L0 alongside the primary aggregate map. The backfill ranks candidates by reference count and stops at a configurable token overshoot. This is a structural-content operation (cross-reference items are symbol/doc blocks, which legitimately belong in L0), not a file-content operation.

The cascade does not run L0 backfill per turn. L0 is only modified by:

- Application restart
- Explicit `rebuild_cache`
- Cross-reference activation/deactivation (touches L0's secondary content)

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

- **Unmodified file unchecked** — file entry removed from its tier (cache miss); the file's symbol/doc representation is unaffected (it lives in L0's aggregate map, not as a separate tracker entry)
- **Edited file unchecked** — file entry is *not* removed (pinned by the edit invariant); the user has deselected it, but the truthful text remains cached until application restart or explicit rebuild
- **File deleted** — file entry replaced by a deletion-marker entry (see below) regardless of pin status. The marker rides the cascade like a normal `file:` entry but its content is a fixed "this file has been deleted in this session" notice rather than the file's last-known text. This bridges the gap until the next `rebuild_cache` removes the file from L0's aggregate map.
- **URL removed** — URL entry removed from its tier (cache miss)
- **Deselected unmodified-file cleanup** runs during stability update; affected tier marked broken
- **Stale entries for deleted files** are not silently dropped — they convert to deletion markers (see below). Phase 0 of the cascade does not evict deleted files; it transitions them.

## Deletion Markers

When a file is deleted (LLM edit, user-side `git rm`, terminal removal, agent edit), its `file:<path>` entry transitions into a deletion-marker entry rather than being removed from the tracker:

- **Content** — a fixed string indicating the file has been deleted this session, e.g. `[deleted in this session — see L0 symbol/doc map for last-known structure]`
- **Hash** — a deterministic hash of the marker content (so deletion-markers are stable across requests and don't churn the cascade)
- **Tier** — lands in Active first, rides the cascade upward as it stabilises
- **Lifetime** — survives until the next application restart or explicit `rebuild_cache`. Rebuild re-extracts L0's aggregate maps from the now-current index (which excludes deleted files), so the marker is no longer needed and is cleared along with all other L1/L2/L3/Active assignments.

The marker exists because L0 may still reference the file in its aggregate symbol/doc map (L0 is captured at session start or last rebuild and is not invalidated by routine deletions). Without the marker, the LLM would see a structural reference to a file in L0 but no full-text representation anywhere — a phantom that invites questions about a file that no longer exists. The marker resolves the apparent contradiction: the symbol map shows the file existed, the marker confirms it's gone, the system prompt's authority rule keeps the LLM correctly grounded ("trust the full text" — and here the full text says "deleted").

Re-creating a file at the same path during the same session demotes the marker back to a normal `file:<path>` entry with the new content's hash. The marker had no protective semantics — a fresh file at the same path simply replaces it.

## Manual Cache Rebuild

A user-initiated disruptive operation that rebuilds L0 from the current index state, wipes the L1/L2/L3/Active assignments (except history), redistributes promoted content using the reference-graph clustering algorithm, and clears all edit-invariant pin flags. Exposed via the cache viewer's Rebuild button. Localhost-only — rebuild affects shared session state, remote collaborators cannot trigger it.

Rebuild is the only mechanism (besides application restart) that causes L0 to be invalidated. Post-commit triggers for automatic rebuild are a planned extension (a clean working tree after commit is the natural moment to refresh the structural baseline).

### Motivation

Two problems motivate rebuild:

1. **L1/L2/L3 churn.** Normal operation grows the active tier with file entries as users select files, and those entries only graduate to L3 via the standard N-value progression across multiple request cycles. When many files are selected at once (e.g., loading a large working set at session start), the active tier can be dominated by full-content entries that take many requests to graduate. Rebuild immediately redistributes into L1/L2/L3 using the same clustering algorithm as startup initialization, giving users control over cache layout without waiting for natural graduation.
2. **L0 staleness.** During a long session with edits, the aggregate symbol/doc map in L0 reflects the structure at session start, not at the present moment. While the system prompt's authority rule keeps the LLM correctly grounded on full-text Working Files, navigation queries against the symbol map can return stale signatures. Rebuild re-extracts the aggregate maps from the now-current index, giving the LLM a fresh navigation baseline.

### Sequence

Atomic from the RPC caller's perspective:

- Preserve history entries in the current tracker (history graduation is controlled separately below)
- Wipe everything else — file, URL, deletion-marker, and any residual entries (deletion markers no longer needed because L0 will be re-extracted from the now-current index, which already excludes deleted files)
- Clear all edit-invariant pin flags — rebuild is the explicit "fresh start" that supersedes pinning
- Re-extract aggregate symbol map and aggregate doc map from the current index state — these populate L0 alongside the system prompt
- Mark L1/L2/L3/Active broken so any follow-up cascade can freely rebalance
- Load content for selected files into file context so real hashes and token counts can be computed
- Distribute selected files across L1/L2/L3 — bin-pack by current tier token count. Files cannot land in L0 (content-typed for structural maps only) and don't land in Active (rebuild's purpose is to skip the graduation wait)
- Re-seed cross-reference items into L0 if cross-reference mode is active (cross-reference items are structural — they belong in L0 alongside the primary aggregate map)
- **Graduate history via piggyback** — rebuild is treated as a disruptive event equivalent to L3 already being rebuilt this cycle, which unlocks the piggyback path. Walks newest → oldest, keeping the most recent messages totalling up to the cache target in active as the verbatim window; everything older graduates to L3 with L3's entry N
- Mark the tracker as initialized so subsequent chat requests skip the lazy-init path

### What Rebuild Does Not Do

- **Does not run the stability update cascade.** The deterministic placement computed during rebuild is the final state. Running the cascade would demote underfilled tiers and undo the careful placement. The next real chat request runs the cascade normally and rebuilt tiers behave identically to any other tier state.
- **Does not change file selection.** The user's selected-files list is untouched; only how those selections are tracked in tiers changes.
- **Does not change session state.** History content, session ID, and review state are preserved.
- **Does not preserve pins.** Files that were pinned by the edit invariant lose pin status — rebuild is the explicit reset point for pin lifecycle.
- **Does not persist.** Like startup initialization, the rebuilt state lives only in memory and is recomputed on the next server start.

### Orphan File Handling

Selected files that aren't recognised by the primary index (non-source files in code mode, or source files in doc mode) bypass tier placement and would otherwise land in active. Rebuild's distribution pass places them in L1/L2/L3 via bin-packing tracked by current tier token count, the same algorithm that handles indexed files. L0 is never a target — L0 is structural maps only, and orphan files have no structural representation to contribute there.

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

## Initialization

- On startup, L0 is populated with the system prompt + aggregate symbol map + aggregate doc map. The aggregate maps are formed by concatenating every indexed file's symbol/doc block in deterministic order.
- L1/L2/L3 start empty. Files enter Active when selected and graduate upward through the cascade as they stay stable. There is no startup distribution of files into cached tiers — rebuild is the explicit mechanism for that.
- No persistence — rebuilt fresh each session.

### Why no startup file distribution

Earlier designs distributed every indexed file across L0/L1/L2/L3 at startup using reference-graph clustering, with placeholder token counts and a post-init measurement pass. That design optimised for "every cached tier is full from turn one", but interacted badly with the routine churn of selection toggles and edits — every selection change would shift bytes in cached tiers and trigger demotion cascades.

Under the L0-content-typed model, the optimisation is no longer needed:

- L0 is full from turn one regardless (it's the aggregate maps).
- L1/L2/L3 fill organically as the user selects files and the cascade graduates them.
- The user can trigger immediate redistribution via the rebuild button if they prefer warm caches over the natural graduation path.

This trades a small amount of "cache warmth on turn one" for substantially more cache stability across every subsequent turn.

## First-Measurement Acceptance

- Items initialized with a placeholder (empty-string) hash accept their first real hash without triggering demotion
- Subsequent hash changes trigger normal demotion
- Without this, every initialized item would demote on the first request after startup

## Order of Operations (Per Request)

Broken tiers set and change log cleared at start of each update cycle.

- **Phase 0: Detect deletions and remove genuine stale items** — check tracked items against current repo files. Two paths:
  - **File no longer on disk** — `file:<path>` entries (pinned or not) transition to deletion-marker entries. The entry stays in the tracker, but its content and hash are replaced by the marker representation. The entry is treated as fresh-content for cascade purposes (lands in Active or stays in its current tier marked broken, depending on where it was when deleted).
  - **Other genuinely stale entries** (orphaned `url:`, malformed `history:` indices, etc.) — removed normally.

  Prerequisite: upstream indexes must be pruned of deleted files *before* the active items list is built (so the deletion is observable here). Pinned `file:` entries are NEVER silently dropped — they either persist (file still exists) or transition to a marker (file deleted).
- **Phase 1: Process active items** — hash comparison, N increment or reset, integrated cleanup of deselected unmodified files and compacted history. Pinned files are not removed by deselection. L0's aggregate maps are not touched here — they live in L0 by content-type policy and are not tracked as cascade-mobile items.
- **Phase 2: Determine L3 entrants** — files (including pinned) and URLs leaving active with N at threshold, active items with N at threshold, controlled history graduation
- **Phase 3: Run cascade** — bottom-up pass over L1/L2/L3 only (L0 is content-typed and excluded from cascade dynamics); place incoming, process veterans, check promotion, repeat until stable, post-cascade underfill demotion
- **Phase 4: Record changes** — log promotions and demotions, store current active items for next request

## Index Inclusion

Under the L0-content-typed model, **every indexed file's symbol or doc block is always present in L0's aggregate map**, regardless of whether the file is selected, edited, or in any cached tier. There is no per-file index exclusion.

A file that is also in Active or a graduated tier (full text present in L1/L2/L3) appears in both representations: structural summary in L0, full text in the lower tier. This is the deliberate design — the LLM uses the L0 map for navigation and the lower-tier full text for truth. The system prompt's authority rule resolves any apparent conflict between the two.

The wide-exclude logic that previously coordinated the three call sites (`_assemble_tiered`, `_get_meta_block`, `get_context_breakdown`) is removed: there is no exclusion to coordinate.

### User-Excluded Files

Users can still explicitly exclude files from indexing via the file picker's three-state checkbox. Excluded files are removed from the index entirely, so they do not appear in L0's aggregate map and cannot be tracked or rendered anywhere. This is distinct from deselection (which only removes a file's full text from cached tiers — the symbol/doc block remains in L0's aggregate map).

## History Compaction Interaction

- Compaction purges all history entries from the tracker
- Compacted messages re-enter as new active items with N = 0
- One-time cache miss; shorter history re-stabilizes within a few requests

## Invariants

- **L0 is content-typed and never invalidated by routine events.** L0 holds the system prompt plus the aggregate symbol map plus the aggregate doc map. Selection toggles, edits, URL fetches, history compaction, session loads, and mode switches do not touch L0. Only application restart or explicit `rebuild_cache` invalidates L0.
- **L1, L2, L3 hold promoted concrete content only** — full file text, fetched URL content, graduated history. Symbol blocks and doc blocks never appear in L1–L3; the aggregate maps in L0 are their permanent home.
- **Files, URLs, and history are ineligible for L0.** The cascade respects this — nothing promotes into L0 from below.
- **Edited files are pinned.** A file whose content hash changed during the session cannot be removed by stale cleanup or automatic eviction. Only application restart or explicit cache rebuild clears pin flags.
- **Unmodified files can be deselected normally** — the pin only protects edited files.
- **Deleted files leave a marker, not silence.** When a file is deleted during a session, its `file:<path>` entry transitions into a deletion-marker entry that rides the cascade and survives until the next `rebuild_cache`. The marker prevents the LLM from seeing a phantom file (referenced in L0's aggregate map but with no full-text representation anywhere). Markers are cleared by application restart or explicit cache rebuild, both of which also refresh L0.
- **A URL never appears in both a cached tier and the uncached URL section** (design target).
- N increments only on unchanged content; resets to 0 on hash mismatch or modification.
- Promoted items enter destination tier with that tier's entry N, not their preserved N.
- Ripple cascade propagates only into broken tiers.
- Anchored items have frozen N.
- Post-init measurement replaces placeholder tokens with real counts before any tier display.
- Manual rebuild re-extracts aggregate maps for L0, preserves history entries, wipes L1/L2/L3/Active, clears pin flags, and re-distributes selected files across L1/L2/L3 deterministically. The cascade is not run post-rebuild.
- Manual rebuild is localhost-only; remote collaborators receive the restricted-error shape.
- History graduates to L3 only on piggyback (L3 already broken this cycle). Token-threshold-driven history graduation is not used — `cache_target_tokens` is a caching floor, not a conversation-length cap, and using it as a graduation trigger would destabilise L3 on almost every request. Active-history size is compaction's concern, not tiering's.