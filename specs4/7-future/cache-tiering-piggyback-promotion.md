# Cache-Tiering Piggyback Magnitude Promotion

**Status:** Design discussion captured. Not yet implemented. Future work.

**Background:** see `specs4/3-llm/cache-tiering.md` § Ripple Promotion and `specs4/impl-history/decisions.md` D27 (L0 content-typed) for the current cascade contract.

## Problem

The current cascade promotes content from a lower tier to an upper tier only when the upper tier is **broken** or **empty** at cascade entry. This gating is correct for preventing one external invalidation from chain-draining the whole stack — the "destination of an external invalidation is never itself a source of structural invalidation" rule.

It also creates a buildup pathology that the current design does not resolve.

### The buildup pathology

1. Session starts. L1, L2, L3 empty.
2. First batch of files: graduates to L3, bubbles up through L2 (empty-gate fires), bubbles up through L1 (empty-gate fires). Stable content lands at L1 with N=9.
3. Second batch of files: graduates to L3, climbs to L2 (L2 empty → empty-gate fires). Reaches L2's promote_n=9. Tries L2 → L1: **L1 is not empty, not broken → blocked**. Sits at L2.
4. Third batch of files: graduates to L3. Tries L3 → L2: **L2 is not empty, not broken → blocked**. Sits at L3.
5. Subsequent batches pile up at L3 indefinitely. Cache breakpoints at L1 and L2 hold the first-cohort content; L3 grows without bound; new content never benefits from caching above L3.

The pathology is not a bug in the original design — the original design optimized for "one external invalidation should not chain-drain the whole stack". It is a missing case: there is no mechanism to relocate stable content upward when the upper tier has not been externally invalidated.

### Why pressure-as-trigger doesn't work

A naive fix is "if source has more tokens than cache_target, promote excess into destination regardless of destination's state". This forces cache rewrites on quiet turns to fix purely cosmetic imbalance, manufacturing churn that nothing else triggered. Cooldown counters can dampen the churn but add complexity and don't address the root question of when invalidation is genuinely warranted.

Per-turn pressure evaluation also has tunability problems: an extreme imbalance on a small repo (5 files vs 1 file) is cheap to fix, while a marginal imbalance on a large repo (50 files vs 48 files) is expensive to "fix" and worth nothing. A single threshold cannot distinguish these.

## Design — piggyback magnitude propagation

The fix is to evaluate magnitude-of-change ONLY when an existing invalidation is already firing this turn. Concretely:

> When a tier is being invalidated (broken externally or by graduation/structural drain), evaluate whether promoting its eligible candidates would meaningfully change the upper tier. If yes, mark the upper tier broken too. The cascade's existing promotion path then fires, propagating the invalidation upward.

This mirrors the existing **history piggyback on L3 invalidation** rule (`cache-tiering.md` § History Graduation): we already pay the cost of one invalidation, so taking the opportunity to propagate is a free ride.

### Magnitude check

For each `(lower, upper)` pair in `[(L3, L2), (L2, L1)]`:

```
if lower not in cascade_broken:
    skip  # no piggyback opportunity this iteration

if upper in cascade_broken or upper in cascade_empty:
    skip  # existing broken-gate or empty-gate will fire normally

candidates = unanchored items in lower past promote_n
if not candidates:
    skip  # nothing to promote

# Magnitude: how much would upper change if we promoted candidates?
relative_count = len(candidates) / max(len(upper_items), 1)
relative_tokens = candidate_tokens / max(upper_tokens, floor)
magnitude = max(relative_count, relative_tokens)

if magnitude >= MAGNITUDE_THRESHOLD:
    cascade_broken.add(upper)  # piggyback the invalidation
    # existing _try_promote_from will fire upper as broken-gate
```

The two-axis magnitude (file count OR token total, whichever is larger) handles both file-count-imbalance and token-imbalance cases. The `max(dest_count, 1)` and `max(dest_tokens, floor)` denominators handle the empty-destination case naturally — relative-change is "infinite-ish" when destination is empty, fires hard, content arrives.

### Self-limiting behaviour

After the promotion fires:

- Source's candidate pool drops (items moved upward).
- Destination's count and tokens grew.
- Next turn's relative-change for the same pair is much smaller.
- No further fire unless the source acquires new candidates that meaningfully exceed the now-larger destination.

No cooldown machinery needed. The magnitude test is its own cooldown.

### Invalidation does not cascade unbidden

Critical invariant: the magnitude check **only** runs for pairs where the lower tier is already invalidated this turn. On a quiet turn with no external invalidations and no graduations, no magnitude evaluation runs anywhere. Cache stays stable.

Active turns piggyback aggressively; quiet turns stay quiet.

## Sequencing within a cascade iteration

The cascade's existing iteration-until-stable loop (capped at 8 iterations) handles chain depth. The piggyback evaluator slots in at the **start of each iteration**, before veteran processing and promotion:

```
For each iteration up to cap:
    1. Run piggyback evaluation for all (lower, upper) pairs.
       This may augment cascade_broken.
    2. For each tier in cascade order:
       a. Veteran processing (anchoring/cap math).
       b. _try_promote_from — broken-gate, empty-gate fire here.
    3. If no progress made, break.
```

A deep chain like L3 → L2 → L1 unwinds in three iterations:

- **Iteration 1.** L3 broken (graduation). Piggyback `(L3, L2)`: magnitude high → mark L2 broken. `_try_promote_from(L3)` fires (L2 is broken). L3 candidates land in L2 at entry_n=6. `_try_promote_from(L2)` does not fire because L1 is not yet broken.
- **Iteration 2.** Piggyback `(L2, L1)`: L2 in cascade_broken (structural drain from iteration 1's promotion), pre-existing aged L2 items past promote_n exist, magnitude vs L1 high → mark L1 broken. `_try_promote_from(L2)` fires (L1 is broken). Aged L2 items land in L1 at entry_n=9. The newly-arrived L3 items in L2 are at entry_n=6, NOT past promote_n, so they do not chain further.
- **Iteration 3.** No progress. Break.

The cascade completes in one update() call. Same turn. No "two-turn delay".

## Edge cases worked through

### Marginal change does not propagate

L1 has 50 files (well-anchored). L2 has 30 files. L3 has 8 files, one of which just graduated. Promotion candidates from L3 → L2: 1 file.

`relative_count = 1 / 30 = 0.033`. Below threshold. **Magnitude check votes no.** L3 cache rewrites for the graduation; L2 and L1 stay cached.

This is the right call: invalidating L2 to add a single file would cost more than the benefit of having that file at L2.

### Large imbalance propagates fully

L1 empty. L2 has 2 files. L3 just received a graduation cohort of 12 candidates.

- Iteration 1: `(L3, L2)` magnitude = 12/2 = 6.0. Fires. L2 marked broken. L3 → L2 promotion runs.
- Iteration 2: `(L2, L1)` magnitude check. L2 has aged content past promote_n? If yes, evaluate. L1 empty → empty-gate fires regardless. Promotion runs.

Whole chain unwinds in two iterations.

### Small repo on small turns

L1 has 3 files (8K tokens). L2 has 2 files (5K tokens). L3 has 1 candidate (2K tokens).

`relative_count = 1/2 = 0.5`. At threshold. Fires.
`relative_tokens = 2K / 5K = 0.4`. Below threshold. Doesn't fire on token axis.

Either signal alone can fire it (we use `max`), so this case fires on count. Promotes.

This is the right call too: a small repo's "5 files" is the entire tier, and adding 1 file is a meaningful structural change. Token cost is cheap because the tier is small.

### File count vs token count divergence

L2 has 1 huge file (40K tokens). L3 has 8 small candidates (5K tokens total).

`relative_count = 8/1 = 8.0`. Fires.
`relative_tokens = 5K / 40K = 0.125`. Doesn't fire.

Magnitude takes max → fires. The 8 small files climb. Token total of L2 grows modestly; file count grows substantially.

Whether this is the right call depends on perspective. A reimplementer should probably tune which axis dominates based on observation. A reasonable refinement is to weight the two axes (e.g., 0.7 × token-axis + 0.3 × count-axis) rather than `max` — this would suppress the count-only fire when token impact is minimal.

### Empty destination still uses the existing gate

When the upper tier is empty at cascade entry (no items at all), the existing empty-gate fires unconditionally. Magnitude check is skipped (the early-return `if upper in cascade_empty: skip`). This preserves session-startup behaviour where the first cohorts climb freely through empty tiers without magnitude gating.

### Pressure-driven L1 invalidation is impossible

The cascade processes `(L3, L2)` and `(L2, L1)` only. There is no `(L1, L0)` pair — `_TIER_ABOVE[L1] = None` under the L0-content-typed model (D27). Magnitude propagation cannot reach L0. L0 remains invalidated only by the enumerated events in `cache-tiering.md` § L0 Stability Contract.

## Open questions for further discussion

The following items came up during design and are deferred to a future implementation pass.

### Threshold value

`MAGNITUDE_THRESHOLD = 0.5` is a starting point. Empirical tuning may want different values for `(L3, L2)` vs `(L2, L1)` — L2 → L1 should arguably be stricter because L1 is the "hottest" cached tier. A reimplementer should observe real cascade behaviour with two or three threshold values before committing.

### Single-axis vs weighted-blend magnitude

The `max(count_ratio, token_ratio)` formulation lets either signal fire alone. A weighted blend (e.g., `0.7 × token_ratio + 0.3 × count_ratio`) would require both signals to align before firing. Worth testing both during implementation.

### Floor for token ratio

`floor` in the token-ratio denominator is needed to handle "destination has 1 token" weirdness. The `max(dest_count, 1)` denominator on the count side already handles empty-destination cases without a floor. Suggest `floor = cache_target_tokens / 16` or `floor = 256` — small enough that it doesn't dampen real signals, large enough to prevent degenerate ratios.

### Deletion-marker entries as candidates

A deletion-marker `file:` entry is a tracker entry whose content is the constant deletion-marker text. Its hash is stable (constant marker hash), so it accumulates N normally. Should magnitude-driven promotion treat these as candidates?

Initial answer: yes, treat them like any other `file:` entry. The marker text is genuinely cached content that benefits from upper-tier placement. Reconsidering only if observed behaviour suggests otherwise.

### Interaction with edit-pinned files

Pinned files (`_pinned = True`) are protected from stale removal and underfill demotion. The current cascade does NOT exempt them from promotion — a pinned file at promote_n promotes upward normally. Magnitude propagation does not change this: pinned files contribute to candidate count and tokens like any other entry.

### Twin evaluation (rejected)

An alternative discussed during design: when piggyback evaluator decides to invalidate a tier, run a synthetic "what would the next cascade iteration look like" evaluation and propagate further if warranted. This would compress iterations.

Rejected because the cascade's existing iteration-until-stable loop already handles chain depth. The cap is 8 iterations; chains converge in 2-3. Adding twin evaluation duplicates the loop's job at higher complexity. The decision can be revisited if profiling shows iteration count is a real cost.

### Pressure-driven evaluation on quiet turns (rejected)

Discussed and rejected: per-turn pressure evaluation on quiet turns. Forces cache rewrites that nothing else triggered, manufacturing churn for cosmetic balance. Cooldown counters can dampen but don't fix the root issue of unjustified rewrites.

The piggyback design avoids this entirely: quiet turns stay quiet.

## Implementation outline (when this lands)

1. **Spec change** to `specs4/3-llm/cache-tiering.md` § Ripple Promotion — add the piggyback magnitude bullet alongside existing external/structural invalidation cases.
2. **Reference numbers** in `specs-reference/3-llm/cache-tiering.md` — `MAGNITUDE_THRESHOLD`, token-ratio floor.
3. **Decision entry** in `specs4/impl-history/decisions.md` (D34 or whatever's next) capturing the buildup pathology, alternatives considered (turn-by-turn pressure, cooldowns, twin evaluation), and rationale for piggyback.
4. **Code change** to `src/ac_dc/stability_tracker.py`:
   - New private method `_propagate_invalidation_by_magnitude(cascade_broken, cascade_empty)` running at start of each `_run_cascade` iteration.
   - Constants block near `_TIER_CONFIG` for threshold and floor values.
   - Hook into iteration loop in `_run_cascade` BEFORE the existing per-tier processing.
5. **Tests** in `tests/test_stability_tracker/`:
   - `test_buildup_unwinds_on_graduation` — multi-cohort buildup, then graduation, expect L3 → L2 → L1 chain to fire.
   - `test_marginal_change_does_not_propagate` — small candidate vs large stable destination, expect no propagation.
   - `test_empty_destination_still_uses_empty_gate` — empty L2 with magnitude evaluator running, expect existing path fires.
   - `test_quiet_turn_no_evaluation` — no external invalidation, no graduation, expect no cascade activity at all (regression guard).
   - `test_chain_completes_in_one_update_call` — deep chain L3 → L2 → L1, expect single update() resolves all promotions.
   - `test_pressure_does_not_reach_l0` — magnitude evaluator should not consider `(L1, L0)` pair, expect L0 untouched.

## Cross-references

- Current cascade behavior: `specs4/3-llm/cache-tiering.md` § Threshold-Aware Cascade Algorithm and § Ripple Promotion
- L0 content-typed contract: `specs4/3-llm/cache-tiering.md` § L0 Stability Contract, decision D27
- Code: `src/ac_dc/stability_tracker.py` `_run_cascade` and `_try_promote_from`
- Tests covering current cascade: `tests/test_stability_tracker/test_graduation_and_cascade.py`