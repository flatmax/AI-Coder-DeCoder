# Cache Tiering

Stability-based tiering of prompt content to align with provider cache breakpoints. Content that remains unchanged across requests promotes to higher tiers; changed content demotes. Reduces re-ingestion costs for large contexts.

The cascade dynamics are governed by an **electrodiffusion-flux model**: tier boundaries are treated as semi-permeable membranes, and per-membrane promotion is driven by the token-mass imbalance between the lower and upper tier. The model is the cache-tiering specialisation of the multi-membrane controller derived in Flax (2026), *A Biophysically-Inspired Feedback Controller for Multi-Class Cache Fairness*. The original derivation lives in [`cache-tiering-electrodiffusion.md`](../../docs/cache-tiering-electrodiffusion.md) (linked here for the full discussion); §4 below distils what the implementation needs.

Per **D36**, the cache items below the system prompt are **per-directory dir-blocks** rather than monolithic aggregate maps. The system prompt is the only non-flux head anchor; every other block — including the symbol/doc/plain-file listings that D27 had pinned to L0 — rides the membrane.

## Content Categories Tracked

The cache holds three classes of content. Every indexed file is represented in the prompt at every turn, in exactly one of these forms.

**Dir-blocks** — the bulk of the cache. One block per `(directory, content_type)` where `content_type ∈ {symbols, docs, plain_files}`:

- `symbols:<dir>` — concatenated symbol-table entries for source files in `<dir>` that aren't currently full-text in Active.
- `docs:<dir>` — concatenated doc-outline entries for documents in `<dir>` that aren't currently full-text in Active.
- `plain_files:<dir>` — list of filenames in `<dir>` for files that have neither a symbol table nor a doc index (configs, data, assets, fixtures). The union of `plain_files` blocks across the repo replaces the synthetic `meta:file_tree` entry from earlier revisions.

A file in Active as full text is **removed** from its dir-block — the block shrinks and is teleported (see Edit Invariant). When all files in a directory are pulled into Active full-text, that dir-block has zero entries and is removed entirely from the cache, not retained as an empty block.

**Active full-file content** — `file:<path>` entries in Active when the user has selected a file for editing. Carry the full text. Pinned against silent eviction during edits.

**History messages** — conversation pairs. Graduate to L3 only via piggyback on Active→L3 flux (see History Graduation).

URL content is a design target (currently in Active only).

**What is no longer tracked.** D27's two aggregate maps (`aggregate symbol map`, `aggregate doc map`) and the synthetic `meta:file_tree` entry are replaced by the dir-block set. D27's deletion-marker entries are removed — file deletion shrinks the dir-block directly, no marker needed.

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

- L0 — uppermost cached tier; the controller drives the hottest dir-blocks here
- L1 — second-tier cached content
- L2 — third-tier cached content
- L3 — entry tier for newly-graduated content
- Active — recently changed or new, not cached. Holds full-file text for files the user has selected for editing, plus non-graduated history.

Each tier maps to a single cached message block in the LLM request. The system prompt sits before L0 as a non-flux head anchor — it is hashed and rendered once per session and never moves.

All four cached tiers (L0–L3) hold dir-blocks. Per **D36**, L0 is no longer content-typed: flux can promote any dir-block all the way to L0, and the edit-invariant teleport can demote any dir-block back to Active when its contents change.

The four membranes between adjacent tiers are:

| Index | Membrane | Notes |
|---|---|---|
| 0 | Active → L3 | Admission gated by `n_admit` (default 3) — items must reach minimum age before graduating. Admission-only — no flux equation. |
| 1 | L3 → L2 | Flux — rectified GHK, no admission floor |
| 2 | L2 → L1 | Flux — rectified GHK, no admission floor |
| 3 | L1 → L0 | Flux — rectified GHK, no admission floor. **Enabled** under D36 (was disabled under D27). |

## System Prompt Anchor

The system prompt sits before L0 as a fixed prefix head. It is hashed (without legend bytes) and never invalidated by the cascade. It changes only on:

1. **Application restart**.
2. **Settings reload that changes the system prompt text**. Reloads that leave the prompt bytes unchanged are no-ops.
3. **Mode switch** (code → doc or doc → code) — the prompt text swaps.
4. **Cross-reference enable/disable** — only when the prompt text changes (legends are tracked separately).

Routine session activity (file edits, selection toggles, dir-block flux, history compaction, session loads, OS-level file changes) does NOT touch the system prompt's bytes.

L0, by contrast, **is** a flux tier under D36 — dir-blocks move into and out of L0 whenever V/c warrant. The previous L0-stability contract (D27/D28: refrozen only at enumerated events) is **deleted**. Cache-write cost on L0 is bounded by the controller's deadband (Φ < threshold) and rectification clamp (Φ ≥ 0), not by an explicit freeze.

### Why this is acceptable under the membrane controller

D27 froze L0 because the N-counter cascade had no global signal — each tier-pair promoted independently and there was no negotiation when one tier filled up, so allowing L0 to be touched by the cascade meant unbounded cache-write churn. The membrane controller has both a global signal (V) and a self-arresting deadband, so it can manage all four cached tiers uniformly without runaway. Quiet turns produce Φ < threshold on every membrane and fire no moves. Active turns (edit applied, file selected) produce one or two block migrations and quiesce.

The system prompt is the only fixed point because it is the cache-prefix root — provider prefix caches require a stable head, and the prompt text is small enough that its rare re-cache cost is negligible. Everything below it is allowed to move.

## Per-Item State

Every tracked item carries:

- `tier` — current placement (Active, L3, L2, L1, or L0)
- `tokens` — current size in tokens
- `n` — the **age counter** (turns since the item last entered Active or was placed at this tier on graduation/promotion). Replaces the spec3-era "consecutive unchanged appearances" semantic. Aging is uniform: every item's `n` increments by 1 per cycle. Edits reset `n` to 0.
- `content_hash` — last-seen SHA-256 of content; mismatch on a turn signals an edit
- `arrived_at_turn` — the turn at which the item entered its current tier (used by some pick-rule modes; see §4.4)

## Content Hashing

- SHA-256 of: file content, compact symbol/doc block, or role+content string for history
- Symbol blocks use a signature hash derived from raw symbol data, not formatted output — avoids spurious hash mismatches when path aliases or exclusion sets change between requests
- System prompt is hashed from the prompt text alone (not legend) — the legend changes when file selection changes, which would prevent system prompt from stabilizing

## Edit Invariant

When the user selects a file for editing (full-text inclusion in Active):

- A `file:<path>` entry is created in Active with `n = 0`, carrying the full file text.
- The file's entry in its directory's dir-block (`symbols:<dir>`, `docs:<dir>`, or `plain_files:<dir>` depending on file type) is **removed**. The dir-block's contents change, so the dir-block is teleported to Active with `n = 0` (the membrane analogue of "ion enters bulk solution"). It rides the cascade upward via flux as it stabilises (see §4).
- If the dir-block now has zero entries (every file in the directory is in Active full-text), it is **removed entirely** from the cache rather than retained as an empty block.

When the user later **deselects** an edited file, or applies edits and the file leaves Active:

- The `file:<path>` entry is removed from Active. The file's structural presence is once again carried by its parent directory's dir-block — the user is free to deselect at any time without losing the LLM's awareness of the file.
- The dir-block grows by one entry, content changes, and is teleported to Active and re-rides flux upward.

When a file's content hash changes while it is in Active (edit applied):

- The `file:<path>` entry is updated in place (still in Active). Hash mismatch resets `n = 0`.
- The dir-block is unaffected (the file is not represented there while in Active full-text).

When a file is **deleted from disk**:

- If the file was in Active as full-text, its `file:<path>` entry is removed.
- The file's entry is removed from its dir-block. The dir-block shrinks, contents change, and it is teleported to Active to re-ride flux.
- No deletion-marker entry is created (D27's marker scheme is removed under D36 — there is no monolithic L0 to be stale against).

**No pin flag.** Earlier revisions pinned `file:<path>` entries against deselection on hash change, on the theory that an edited file's text must remain cached until rebuild or restart regardless of selection state. The membrane / flux cache model retires that protection: deselected files (edited or not) are simply removed, and the parent directory's dir-block continues to carry their structural presence. Re-selecting the file pulls the full text back into Active and re-teleports the dir-block.

**The unifying rule.** Content change ⇒ teleport to Active. "Size change" (dir-block grows or shrinks because a file moved into or out of Active) is a special case of "contents changed." The truthful, current representation of every indexed file is always present in the prompt — either as full text in Active (selected for edit) or as a dir-block entry somewhere in L0–L3 (the union of all dir-blocks covers the whole repo).

## History Graduation

- History is immutable, so waiting on N is unnecessary — graduation is controlled
- **Piggyback on Active→L3 flux** — when any Active→L3 promotion fires this cycle (a `file:<path>` graduating, or a dir-block teleported by edit/deletion graduating), all eligible history graduates for free; walks newest → oldest, keeping a verbatim window sized at `cache_target_tokens` in active and graduating everything older to L3
- **Never** — if cache target is zero, or no Active→L3 flux fired this cycle, history stays active
- **Stays in L3 forever** (D37) — once a history item lands in L3 via piggyback, the flux equation never moves it upward, the rectification clamp never moves it downward, and mover selection skips it. The only paths out of L3 for a history item are `purge_history` (compaction, new-session reset) and manual rebuild — both already-existing lifecycle hooks, not flux events

Active history is not forced to graduate on its own. A long conversation that never happens to coincide with an Active→L3 firing stays in the uncached active section until compaction deals with it. This is deliberate. `cache_target_tokens` is a per-tier caching floor (typically a few thousand tokens), not a conversation-length cap — comparing total active history against it would force graduation on almost every turn of any real conversation, tearing down the L3 cache block on every request. Compaction, which has its own much larger `trigger_tokens` budget and purges tracker history when it runs, is the correct owner of "active history is too big".

The piggyback rule's effect is unchanged from D27 in the steady state: stable conversations don't churn the L3 cache block, because steady-state turns produce no Active→L3 flux at all. Under D36 the trigger generalises slightly — dir-block teleports caused by edits and deletions now also count as Active→L3 firings, so history piggyback hops a ride on those events too rather than only on `file:<path>` graduations.

## Cache Target Tokens

- Computed from model-family minimum × buffer multiplier
- Model-aware — providers specify different minimums per model family
- User-configured minimum can override upward but never below the model's hard floor
- A fallback value (without model reference) is used when the caller has no model context
- The cache target does NOT enter the flux equation — flux drives promotion based on token-mass *imbalance*, not absolute fill. Cache target is read by prompt assembly to decide whether to emit a `cache_control` breakpoint; it no longer drives anchoring or underfill demotion (both removed under the membrane model).

---

## §4 — Membrane / Flux Cascade

The cascade replaces the spec3-era N-counter promotion algorithm with a per-turn **iterate-to-equilibrium relaxation loop** driven by Goldman-Hodgkin-Katz (GHK) flux across each tier boundary. The mathematical derivation is in [`cache-tiering-electrodiffusion.md`](../../docs/cache-tiering-electrodiffusion.md) and the multi-membrane validation is in `synth/` of the source paper. This section covers the implementation contract.

### 4.1 The flux equation

For each membrane *m* with lower tier *l* and upper tier *u*, the controller computes a per-turn flux Φₘ from four inputs read from the current tier state: the lower-tier file count *cₗ*, the upper-tier file count *cᵤ*, the lower-tier total token mass *Tₗ*, and the upper-tier total token mass *Tᵤ*. **`history:*` items are filtered out of all four counts before the equation runs** (D37 — history isolation). They neither contribute mass nor object count to either side of any membrane, so a long L3 history block never inflates V and never triggers churn. The token-mass imbalance is

> V = Tₗ − Tᵤ

A positive V means the lower tier holds more token mass than the upper — the field pushes files upward across the membrane. The flux equation is **rectified GHK**:

> Φₘ = max(0, P · V · (cₗ − cᵤ · exp(−V/V_T)) / (1 − exp(−V/V_T)))

GHK with a hard rectification clamp on the lower side. The exponential weighting sharpens response under zero-concentration conditions in the upper tier. At V → 0 the formula's Taylor limit reduces to the linear form (Flax 2026 §3.3). Numerically guarded by the standard branch:

- For |V/V_T| < 10⁻⁹: evaluate the limit `Φₘ ≈ max(0, P · V_T · (cₗ − cᵤ))` directly.
- For V/V_T > 50: evaluate the asymptote `Φₘ → P · V · cₗ` (denominator → 1; cᵤ term vanishes).
- For V/V_T < −50: evaluate the downward asymptote `Φₘ → P · V · cᵤ` (which is then clamped to 0 by rectification).

The rectification clamp makes flux upward-only — downward motion happens exclusively via the edit invariant (teleport-to-active for `file:<path>` entries on hash mismatch, and for dir-blocks on contents-changed) and explicit invalidations (selection change, file deletion). Earlier revisions exposed `linear` and `bidirectional-ghk` variants; both are retired. Flax 2026 §6.3 finds the bidirectional path empirically dead at the headline operating point — the rectification clamp is *free* — and the linear form is the V → 0 Taylor branch of GHK, redundant once the GHK form is the production default.

### 4.2 Per-membrane parameters

Every membrane carries its own (P, V_T, n_admit, pick_mode). Defaults are tuned from the synth-tuner's headline rectified-GHK fit (`runs/opt-run2/best_params.json`):

- Active → L3: **admission_only**, n_admit=3, pick_mode="oldest" — age-gated admission, no flux equation
- L3 → L2: P=1.616399379428934e-06, V_T=98952.34312610888 tokens, n_admit=0, pick_mode="smallest"
- L2 → L1: P=1.616399379428934e-06, V_T=98952.34312610888 tokens, n_admit=0, pick_mode="smallest"
- L1 → L0: P=1.616399379428934e-06, V_T=98952.34312610888 tokens, n_admit=0, pick_mode="smallest" — **enabled** under D36 (was disabled under D27/D28)

`n_admit` is an admission floor: a file can only be picked as a mover across this membrane if `f.n ≥ n_admit`. On the Active → L3 membrane (admission_only) it is a strict gate; on the flux membranes above it is a soft prefer-aged-movers rule (the loop retries without the floor if no aged candidate exists, since the flux equation has already decided promotion is warranted).

**Why Active → L3 is admission_only and not flux-coupled.** The membrane / flux model treats V (token-mass differential) as the driving force: items climb when the lower side is overfull relative to the upper. That's right for inter-cache balancing (L3 ↔ L2 ↔ L1) where each tier accumulates content over time and the controller's job is to keep them in proportion. It's wrong for the admission boundary because active is **structurally lighter** than the cached tiers — items only stay in active until they age past the admission gate, after which they leave for L3+, so total active token mass tends to *decrease* relative to the cache. With `t_active < t_L3` as the steady state, V is permanently negative and the rectified flux equation's response is permanently zero. Active items would never graduate. The fix is to recognise that admission is fundamentally an age-based gate, not a mass-balance gate, and treat it as such — `n ≥ n_admit` is the entire promotion criterion on this membrane.

Higher membranes use the flux equation alone. `history:*` items are excluded from the regular flux loop entirely — they only enter L3 via the piggyback path (§ History Graduation), which fires when L3 is already broken by another mutation; otherwise the conversation would churn the L3 cache block on every stable turn. Per **D37**, history-in-L3 is also invisible to the flux equation's V/c inputs on every membrane, not just the mover-selection step. This makes the L3 cache block a stable terminus for the conversation: history accumulates there without inflating V, and the controller does not interpret a large L3 token mass as pressure to evacuate.

The original tune was run bidirectional (`allow_negative_flux=True`); for the rectified clamp the same P and V_T are a sound starting point, but the optimum may shift slightly. Re-tune later for the last few percent.

### 4.3 The relaxation loop

Each turn, after edits have teleported and `n` has aged, the cascade runs **iterate-to-equilibrium relaxation**:

```
repeat:
  moved := False
  for m in [Active→L3, L3→L2, L2→L1, L1→L0]: # all four enabled under D36
    if m.admission_only:                       # Active→L3 path
      pick mover from lower with n ≥ n_admit
        honouring pick_mode, pin/history rules
      if no eligible mover:
        continue
      move mover to upper
      moved := True
      continue                                # next membrane

    recompute Φₘ from current tier state      # rectified — Φ ≥ 0 always
    if Φₘ < flux_threshold:                    # default 1.0 — "one
      continue                                #   block-equivalent of pressure"
    pick mover from lower
      honouring pick_mode, n_admit, pin rules
      (retry without n_admit if no aged candidate)
    if no eligible mover:
      continue
    move mover to upper
    moved := True
  until not moved
```

Termination: a full pass that fires no moves. Either every membrane has Φ < `flux_threshold` (at/near equilibrium) or no eligible movers remain.

**No cross-turn state.** Each turn solves to local flux equilibrium independently. There is no charge accumulator, no leak, no anchoring — the rectified GHK form self-arrests as V → 0, so persistent memory is unnecessary (and was empirically shown to be an artefact of integer mover discretisation, not physics; Flax 2026 §3.3).

**Direction and quiescence are intrinsic to the flux equation, not a separate gate.** The rectification clamp pins direction (Φ ≥ 0 — controller is upward-only); the deadband threshold absorbs steady-state noise so quiet turns with V ≈ 0 across all membranes self-arrest on the first pass without firing. An earlier revision applied a separate `max_membrane` scope gate — restricting flux to membranes whose upper tier had been externally invalidated — but that mechanism was a vestige of the N-counter cascade and is unnecessary under the rectified controller: the deadband + rectification jointly bound cache-write cost, and the controller no longer manufactures churn on quiet turns because Φ never clears the threshold without real token pressure.

A correctness contract: every move strictly increases the mover's tier index, so the loop is bounded by `NUM_TIERS · n_files` moves. A `max_iters` cap of 1000 is a defensive guard — convergence in real workloads is 1–3 passes.

### 4.4 Mover selection

When a membrane has decided to fire (|Φ| ≥ threshold and the direction passes the rectification check), it picks one mover from the source tier subject to the membrane's `pick_mode`:

- `"smallest"` (default) — longest residency in this tier (`turn − arrived_at_turn`), with smaller tokens as tiebreaker. Promotes the most stable, cheapest-to-promote file first.
- `"lru"` — largest `n` (turns since last edit). The same coldness signal a flat LRU policy would use.
- `"fifo"` — smallest `arrived_at_turn`. Pure arrival-order.
- `"random"` — uniform among admission-eligible files. Ablation only.

`file:<path>` entries participate in V/c counts and mover selection on the same terms as any other tracked item — there is no pin flag protecting them from promotion. An edited file's text climbs the cascade like anything else once it has aged past the `n_admit` floor on Active→L3. Dir-blocks similarly carry no pin — they are reconstructed from the live index at every freeze and inherit their consistency from the index.

### 4.5 Active → L3 graduation

The Active → L3 membrane is the entry point for new content into the cached part of the cascade. It is **admission_only**: no flux equation, no V coupling, no threshold deadband. An item (a `file:<path>` entry or a teleported dir-block) graduates when (and only when) it has aged ≥ `n_admit` turns since registration or last teleport (default `n_admit = 3`). The `pick_mode` is `"oldest"` so the longest-aged eligible item promotes first when several are ready in the same turn.

Why not the flux equation here? In AC-DC4, Active is **structurally lighter** than the cached tiers — items only sit in Active until they age past `n_admit`, then leave for L3+, so V (= t_active − t_L3) is permanently negative in steady state. The rectified flux equation responds to V ≥ 0 only, so it would never fire on this membrane. The flux model is a fit to inter-cache *balancing*; admission is fundamentally a *gating* problem (has this item proven stable enough to commit to cache?), and the right primitive for that is an age threshold, not a mass differential.

`history:*` items are excluded from this membrane (filtered as protected in the relax loop). History graduates only via the piggyback path — see § History Graduation — so a stable conversation does not rewrite the L3 cache block on every turn. Per **D37**, the same exclusion applies on every higher membrane *and* on the V/c flux inputs: once a history item is in L3, it does not contribute to `c_lower`, `c_upper`, `t_lower`, or `t_upper` on any membrane, and mover selection skips it. The L3 cache block grows arbitrarily large with conversation length without ever pressuring the controller to evacuate it.

### 4.6 Demotion semantics

The only downward force is the edit invariant: contents change → teleport the affected entry (`file:<path>` or dir-block) to Active with `n=0`. There is no controller-driven demotion. An item that should logically "cool" but is never touched stays cached indefinitely, climbing toward L0 under flux. Explicit invalidations (selection change, file deletion, history purge) propagate via the same teleport mechanism — the affected dir-block or `file:<path>` entry lands in Active and re-rides flux.

### 4.7 What was removed

The earlier cascade had several mechanisms that the membrane model subsumes or eliminates:

- **Anchoring** — items below the cache-target line had their N frozen. Replaced by the flux equation: V is computed from total tier tokens, not item-by-item, so individual items don't need a frozen-N flag. Tier-internal ordering is the mover-pick rule, not an anchor list.
- **N-cap-at-promote-when-stable-above** — items whose N grew unbounded under stable upstream conditions had their N capped. Replaced by `n` being a pure age counter (no semantic role in promotion eligibility above n_admit) — there's nothing to cap.
- **Post-cascade underfill demotion** — tiers below the cache target had items demoted to avoid wasting a cache breakpoint. Removed: prompt assembly checks tier token totals and elides cache breakpoints for under-target tiers, but tier *contents* are not rearranged on that basis.
- **L0 content-typing (D27)** — L0 was reserved for the system prompt and aggregate maps. Under D36 L0 is a flux tier; the system prompt sits before L0 as the only non-flux head anchor.
- **L0 frozen snapshot (D28)** — there is no L0 snapshot under D36; live indexes feed dir-block reconstruction directly at freeze events.
- **`backfill_l0_after_measurement`** — removed entirely. Its sole remaining caller (cross-reference activation) is replaced by a normal block-registration pass that adds the secondary index's dir-blocks to the membrane.
- **Deletion markers (D27)** — removed. File deletion shrinks the relevant dir-block directly; no marker entry is needed because there is no monolithic L0 aggregate to be stale against.
- **`meta:file_tree` synthetic entry** — removed. The union of `plain_files:<dir>` blocks across the repo replaces it.

## §5 — Configuration

The membrane controller is configured via `app.json`:

```json
{
  "cache_tiering": {
    "flux_threshold": 1.0,
    "membranes": [
      {"admission_only": true, "n_admit": 3, "pick_mode": "oldest"},
      {"P": 1.616399379428934e-06, "V_T": 98952.34312610888, "n_admit": 0, "pick_mode": "smallest"},
      {"P": 1.616399379428934e-06, "V_T": 98952.34312610888, "n_admit": 0, "pick_mode": "smallest"},
      {"P": 1.616399379428934e-06, "V_T": 98952.34312610888, "n_admit": 0, "pick_mode": "smallest"}
    ]
  }
}
```

- `flux_threshold`: minimum Φ at which a membrane fires (default 1.0 — "one block-worth of driving force"). Smaller thresholds fire more aggressively.
- `membranes`: array of four per-membrane parameter blocks, in cascade order (Active→L3, L3→L2, L2→L1, L1→L0). The first is admission-only (no flux equation, age gate only); the rest use rectified GHK. Under D36 the L1→L0 membrane is **enabled** (was disabled under D27/D28). Missing or partial blocks fall back to defaults.

Only the rectified-GHK variant is supported — the linear and bidirectional-GHK forms from earlier revisions were retired when the synth-tuner's headline rectified fit landed as the production default.

The defaults are sourced from `runs/opt-run2/best_params.json` (the synth-tuner's headline fit on the 4-membrane stack). Workloads with very large or very small working sets may benefit from raising or lowering V_T; `flux_threshold` is a coarser knob and rarely needs adjustment.

Parameter values are pinned at tracker construction. Mid-session reconfiguration is not supported — edit `app.json` and restart.

## Active Items List

Built on each request — the set of items explicitly in active (uncached) context:

- Selected file paths (full content) — `file:<path>` entries
- Dir-blocks teleported by recent edits or deletions, still climbing back toward stability
- Non-graduating history messages
- Fetched URL content (target design)

A file selected for editing has its full text in the Active list AND is removed from its dir-block; the dir-block (now without that file) sits wherever flux has placed it (typically also Active, freshly teleported, on its way back up). There is no "wide exclude" coordination needed because the file's content lives in exactly one place per turn.

## Initialization

- On startup, after the symbol/doc indexes are built, dir-blocks are constructed from the current index state (one block per `(directory, content_type)` for `content_type ∈ {symbols, docs, plain_files}`).
- Dir-blocks are seeded into L0/L1/L2/L3 using a per-directory **mtime prior**, with seed direction **inverted from the intuitive reading**:
  - Most recently modified directory tree → seeded into **L3** (the cheapest cached tier to invalidate).
  - Older directories → seeded into L2 / L1 by mtime quantile.
  - All-time-cold directories → seeded into **L0** (the most expensive cached tier to invalidate, but the least likely to need it).
- The `mtime` for each directory is its **most-recent file mtime** — `Repo.get_directory_mtime` returns `max(file.stat().st_mtime for file in dir)`. A directory with one file edited 10 seconds ago and a hundred files untouched for years is treated as hot, which is the right signal for "any dir-block in this directory is at risk of being teleported soon."
- The system prompt sits before L0 as a non-flux head anchor and is rendered from turn one regardless.
- No persistence — rebuilt fresh each session.

### Why mtime-based seeding

The seed direction is **edit-cost-aware**. The membrane is upward-only (rectified GHK with Φ ≥ 0 clamp); the only downward force is the edit invariant — a hash mismatch teleports the affected block to Active with `n=0`. Whichever tier the block currently occupies has its cache breakpoint invalidated by that teleport, and the cost of re-caching scales with the tier:

- L0 is the largest cached block and sits closest to the prefix root. Tearing it down forces the entire L0 prefix to be re-cached on the next request.
- L3 is the smallest cached block, freshly-graduated content. Tearing it down costs roughly one block-write.

If "recently edited" predicts "likely to be edited again soon" — which holds for typical interactive coding, where sessions continue recent work rather than pivoting to long-untouched code — then hot directories are exactly the directories whose dir-blocks are most likely to be teleported. Putting them at L3 absorbs the churn near the membrane's entry point. Putting cold directories at L0 means the L0 cache block survives across many turns; if a cold directory does suddenly get edited, it teleports to Active and re-rides flux at the same per-edit cost as anything else — but that's the rare case, not the steady state.

The mtime prior is heuristic, not load-bearing. Flux re-sorts dir-blocks within a few turns regardless of where they start. Two alternatives were considered and rejected:

- **All-cold-into-L3**: cleanest (no heuristic), but wastes a session on warm-up — every dir-block has to climb the full cascade before settling.
- **Tree-depth-based**: shallower directory paths → higher tier. Tempting but weak — root-level config files are not necessarily hotter than deep core modules. Tree depth correlates with nothing reliable.

mtime gives the first session a usable cache layout from turn one and is forgiving (wrong choices are corrected by flux quickly).

### Agent inheritance

When an agent is spawned (parallel-agents, see [parallel-agents.md](../7-future/parallel-agents.md)), the agent's tracker copies the parent's current tier distribution at spawn time — a snapshot of which dir-blocks sit in which tier. Agent flux thereafter is independent; the agent rebalances toward its own working set without affecting the parent. The agent does NOT re-run mtime-based seeding from scratch; the parent's tier layout (which has already absorbed several turns of real flux) is a better starting point than the cold mtime prior would be.

## Manual Cache Rebuild

A user-initiated disruptive operation that wipes all tier assignments (except history), reconstructs the dir-block set from the current index state, and re-seeds dir-blocks via the mtime prior. Exposed via the cache viewer's Rebuild button. Localhost-only — rebuild affects shared session state, remote collaborators cannot trigger it.

Rebuild and application restart are the explicit reset points. Post-commit triggers for automatic rebuild are a planned extension.

### Sequence

Atomic from the RPC caller's perspective:

- Preserve history entries in the current tracker (history graduation is controlled separately below)
- Wipe all `file:<path>` entries and dir-block entries from L0/L1/L2/L3/Active
- Reconstruct dir-blocks (`symbols:<dir>`, `docs:<dir>`, `plain_files:<dir>`) from the current index state
- Seed dir-blocks across L0/L1/L2/L3 by mtime prior (see Initialization)
- Load content for selected files into file context so real hashes and token counts can be computed; selected files land in Active as `file:<path>` entries and are removed from their dir-blocks
- If cross-reference mode is active, also seed the secondary index's dir-blocks via the same mtime prior
- **Graduate history via piggyback** — rebuild is treated as equivalent to a fresh Active→L3 firing this cycle. Walks newest → oldest, keeping the most recent messages totalling up to the cache target in active as the verbatim window; everything older graduates to L3
- Mark the tracker as initialized so subsequent chat requests skip the lazy-init path

### What Rebuild Does Not Do

- **Does not run the relaxation loop.** The mtime-seeded placement is the final state for this turn. Running flux would recompute V from the just-placed contents and immediately undo some of the placement. The next real chat request runs the relaxation loop normally and rebuilt tiers behave identically to any other tier state.
- **Does not change file selection.** The user's selected-files list is untouched.
- **Does not change session state.** History content, session ID, and review state are preserved.
- **Does not persist.** Like startup initialization, the rebuilt state lives only in memory.

## Cross-Reference Mode

- User toggle — primary mode keeps its dir-blocks; the *other* index's dir-blocks are added alongside
- Activation registers the secondary index's `symbols:<dir>` (or `docs:<dir>`) blocks with the membrane controller, seeded via the mtime prior. They participate in flux uniformly with the primary blocks.
- Deactivation removes the secondary dir-blocks from the membrane.
- Tier content dispatch is prefix-based (`symbols:` vs `docs:` vs `plain_files:`), not mode-based — the same tier can contain a mix of blocks from both indexes
- Toggle is always available once startup completes

The previous `backfill_l0_after_measurement` mechanism is removed under D36 — its sole remaining caller (cross-reference activation) is handled by the normal dir-block registration pass.

## Item Removal

- **File unchecked (modified or unmodified)** — the `file:<path>` entry (if any) is removed from Active. The file's structural presence rejoins its parent directory's dir-block, which teleports to Active to re-ride flux. Re-selecting the file at any later turn pulls the full text back into Active.
- **File deleted from disk** — `file:<path>` entry (if any) removed from Active; file's entry removed from its dir-block; dir-block teleported to Active to re-ride flux. No deletion-marker entry created.
- **URL removed** — URL entry removed from its tier (cache miss).
- **Directory deleted entirely** — every dir-block keyed at that path (`symbols:<dir>`, `docs:<dir>`, `plain_files:<dir>`) is removed from the cache.

## Order of Operations (Per Request)

Broken tiers set and change log cleared at start of each update cycle.

- **Phase 0: Detect filesystem changes** — check tracked items against current repo state. Files removed from disk are removed from their dir-blocks (and from Active if they were there); affected dir-blocks are teleported to Active. Newly added files are inserted into the appropriate dir-block; affected dir-blocks are teleported to Active.
- **Phase 1: Process active items** — hash comparison, age increment (`n += 1` on every item every cycle), edit teleport (hash mismatch → mover to Active with `n=0`), cleanup of deselected unmodified files and compacted history. Pinned `file:<path>` entries are not removed by deselection.
- **Phase 2: Reconcile dir-blocks against selected files** — for any newly-selected file, remove from its dir-block and create a `file:<path>` entry in Active; teleport the dir-block. For any newly-deselected file (not pinned), put it back into its dir-block; teleport the dir-block.
- **Phase 3: History piggyback graduation** — if any Active→L3 firing is detected this cycle (file or dir-block graduated), run the verbatim-window walk and graduate older history into L3.
- **Phase 4: Run relaxation loop** — iterate-to-equilibrium across the four live membranes (Active→L3, L3→L2, L2→L1, L1→L0). The Active→L3 membrane is admission_only (age gate); the rest use rectified GHK. The rectification clamp pins direction (Φ ≥ 0); the deadband threshold absorbs steady-state noise. Termination when a full pass fires no moves.
- **Phase 5: Record changes** — log promotions and demotions, store current active items for next request, clear the broken-tier set.

## Index Inclusion

Under D36, **every indexed file is always represented in the prompt** — either as full text in Active (selected for edit) or as an entry in its directory's dir-block (in any cached tier). There is no monolithic L0 aggregate map; coverage is distributed across the dir-block set.

A file selected for editing appears in exactly one place per turn: its full text in Active. It is removed from its dir-block at the moment it enters Active. There is no "structural summary in L0 + full text in lower tier" duplication that D27 had to manage with the system-prompt authority rule.

### User-Excluded Files

Users can still explicitly exclude files from indexing via the file picker's three-state checkbox. Excluded files are removed from the index entirely; their dir-block entry shrinks accordingly and the dir-block is teleported to Active.

## History Compaction Interaction

- Compaction purges all history entries from the tracker
- Compacted messages re-enter as new active items with `n = 0`
- One-time cache miss; shorter history re-stabilizes within a few requests

## Invariants

- **The system prompt is the only non-flux head anchor.** L0–L3 are all flux tiers under D36; the L1→L0 membrane is enabled.
- **Every indexed file is always represented in the prompt** — either as full text in Active (selected for editing) or as an entry in its directory's dir-block (in some tier L0–L3). There is no third state.
- **A file selected for editing appears in exactly one place.** Its full text is in Active; it is removed from its dir-block. No "structural summary in L0 + full text in lower tier" duplication.
- **Dir-blocks are reconstructed from the live index at every freeze.** They inherit consistency from the index.
- **No pin protection.** Files (edited or not) can be deselected at any turn — the `file:<path>` entry is removed and the file's structural presence rejoins its parent dir-block, which teleports to Active to re-ride flux. Re-selecting brings the full text back.
- **File deletion shrinks the relevant dir-block; no marker entry is created.** D27's deletion-marker scheme is removed under D36.
- **The synthetic `meta:file_tree` entry is removed.** Its contents live as `plain_files:<dir>` dir-blocks across the repo.
- **A URL never appears in both a cached tier and the uncached URL section** (design target).
- **`n` is a pure age counter.** It increments by 1 per cycle for every item; resets to 0 on hash mismatch (edit) or teleport. Aging is decoupled from promotion eligibility above the `n_admit` floor on Active→L3.
- **Each turn is a self-contained relaxation step.** No charge accumulator, no leak. Every move strictly increases the mover's tier index (under rectified variants), so the loop is bounded.
- **Rebuild does not run the relaxation loop.** The mtime-seeded placement is the final state for that turn; the next real chat request runs flux normally.
- **Manual rebuild is localhost-only.**
- **History graduates to L3 only on piggyback** (Active→L3 firing detected this cycle).
- **History never leaves L3 by flux (D37).** `history:*` items in L3 are protected from movement (skipped by mover selection on every membrane) AND invisible to V/c on every membrane. The flux equation operates on the file/dir-block population only. The only paths out of L3 for a history item are `purge_history` (compaction, new-session reset) and manual rebuild.
- **Agents inherit the parent's tier distribution at spawn**; agent flux thereafter is independent.
- **The flux variant is fixed at tracker construction.** Mid-session switching is not supported.

## Cache Warmer — Currently Unplugged

**Status (2025).** The cache warmer is currently disabled at the entry point regardless of any config flag. Field testing of the D34 / D34a stack revealed that every firing stalls the event loop for ~120 seconds inside the ``await self._broadcast_event_async(...)`` calls. Broadcasts that complete in sub-milliseconds for normal user-turn events take roughly 2 minutes when the warmer is mid-cycle. The cause is not in the warmer's own code paths (prompt assembly is instant, executor handoff is instant, the LiteLLM call itself completes in 3-15 seconds); the broadcasts are being queued or held somewhere in the WebSocket / jrpc-oo serialization path during warm-up firings. Combined with the timing drift that produces 0% cache hit rate on the firings that do complete, the warmer is currently negative-value.

The D34 (executor isolation, circuit breaker, dedicated thread pool) and D34a (wall-clock deadline anchoring) infrastructure remains in place. Re-enabling requires diagnosing the WebSocket-side stall — that work is parked, not abandoned.

To re-enable for diagnosis: remove the early return in :meth:`CacheWarmer.start`, set ``cache_warmup.enabled: true`` in ``app.json``, and pass ``--experimental`` on the CLI.

## Cache Warmer (parked design — does not currently fire)

Anthropic's prompt cache uses a 5-minute sliding TTL — any read or write extends the window. During interactive coding sessions the user often pauses for longer than 5 minutes to think, read, or context-switch. When the user returns, the cached prefix has expired and the next turn pays the full cache-write price (1.25× input on Claude) to re-prime.

The cache warmer is a background timer that issues a tiny `litellm.completion` call every `interval_seconds` seconds of inactivity. The call is shaped so the cached prefix matches the next real turn byte-for-byte, keeping L0–L3 hot at cache-read pricing rather than cache-write.

### Warm-up call shape

- Reuses the EXACT cached prefix that a real turn would. Messages up to and including the last `cache_control` marker (system + L0 history + L1/L2/L3 pairs) are byte-identical to a real turn, assembled via the same code path as `stream_chat`.
- **Post-cache content omitted.** Everything after the last `cache_control` marker — Active tier (selected files + active history), file tree, URL context, review context — is skipped. The cached prefix bytes are unchanged so L0–L3 cache hits still land. Saves input tokens on every firing.
- Appends a minimal user message asking for a 1-token acknowledgement.
- Sets `max_tokens=2`.
- Disables reasoning regardless of session config.
- No streaming. Synchronous completion via the aux executor.

The result is discarded. Warm-ups never enter conversation history, never broadcast `userMessage` or `streamComplete`, never touch the stability tracker.

### Lifecycle

- `start()` schedules the first firing.
- `cancel()` stops the pending timer without rescheduling. Called at the start of every `stream_chat` invocation.
- `reset(reason)` cancels and reschedules. Called at the end of every `stream_chat` invocation.
- `disable(reason)` cancels and stays inert until `enable()` is called explicitly.

### Two-phase wait with visible countdown

Each interval is split into two phases:

1. **Silent phase** — `interval_seconds - countdown_seconds` of `asyncio.sleep`.
2. **Visible countdown phase** — the final `countdown_seconds` (default 30s). One `cacheWarmupCountdown` event broadcast per second carrying `{seconds_remaining, total}`.

When the countdown reaches zero, the warmer broadcasts `cacheWarmupFiring` (frontend flips bar to spinner), issues the call, and broadcasts `cacheWarmupComplete` with `{success: bool, reason?: str}`.

### Single-stream guard interaction

Warm-ups skip when any LLM stream is in flight — both the main user-facing stream and any agent streams. The warmer reschedules rather than disables in this case.

### Retry budget bounded by cache TTL

The wrapped `retry_litellm_completion` call honours `config.num_retries` for retryable error types. The warmer's `on_retry` callback adds a retry-budget guard: if the cumulative elapsed time plus the next computed wait would exceed the cache TTL (5 minutes), the callback raises early.

### Auto-disable on failure

Any exception from the warm-up call disables the warmer.

### Scope

Single-instance per `LLMService`. Only the main conversation is warmed.

### Configuration

Two fields in the `cache_warmup` section of `app.json`:

- `enabled` (default `true`)
- `interval_seconds` (default `270`)

### UI surfacing

A successful warm-up triggers the floating Token HUD with the warm-up's token counts.

### Invariants

- Warm-ups never appear in conversation history.
- Warm-ups never trigger stability tracker updates.
- Warm-ups never trigger the relaxation loop — they only refresh the provider's cache TTL on already-placed content.
- Warm-up tokens DO accumulate into `_session_totals` via `_accumulate_usage`.
- The cached prefix bytes used by a warm-up are identical to those a real turn would produce.
- A failed warm-up disables the warmer; manual re-enable required.
