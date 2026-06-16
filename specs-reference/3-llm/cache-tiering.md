# Reference: Cache Tiering

**Supplements:** `specs4/3-llm/cache-tiering.md`

> **D36 update:** L0 is no longer content-typed. Every tier L0–L3 is a uniform flux tier with its own GHK membrane; only the system prompt sits before L0 as a non-flux head anchor. The aggregate `meta:repo_map` / `meta:doc_map` / `meta:file_tree` rows are replaced by per-directory dir-blocks (`symbols:<dir>`, `docs:<dir>`, `plain_files:<dir>`) which can sit in any tier. Deletion markers are removed. Sections of this reference describing the L0 snapshot, L0 backfill, deletion-marker text, and `symbol:<path>` / `doc:<path>` per-file keys have been rewritten.

## Numeric constants

### Tier parameters

Each stability tier (L0, L1, L2, L3, Active) has an **entry N** (the N value assigned on arrival) and a **promotion N** (the threshold above which an item is eligible to promote to the next tier up). Under D36 every tier participates in the N-counter cascade; the system prompt is not a tracker entry.

| Tier | Entry N | Promotion N | Notes |
|---|---|---|---|
| L0 | 12 | — (terminal) | Most stable cached tier; reached by long-lived dir-blocks and other cascade-mobile content |
| L1 | 9 | 12 | |
| L2 | 6 | 9 | |
| L3 | 3 | 6 | Entry tier for graduated content |
| Active | 0 | 3 | Uncached; N ≥ 3 makes an item eligible to graduate to L3 |

Promoted items enter their destination tier with the destination's entry N, **not** preserving their source-tier N. An item promoting from L3 → L2 arrives at L2 with N = 6, regardless of whether its L3 N was 6, 7, or 8.

All cascade-mobile content (`file:`, `url:`, `history:`, `symbols:<dir>`, `docs:<dir>`, `plain_files:<dir>`) is eligible for any tier L0–L3. The system prompt sits outside the cascade as the only non-flux head anchor and is excluded from tracker entries.

### Cache target computation

```
cache_target_tokens = max(cache_min_tokens, min_cacheable_tokens) × cache_buffer_multiplier
```

Inputs:

| Input | Default | Source |
|---|---|---|
| `cache_min_tokens` | 1024 | User config (`llm.json`) — can raise above the per-model minimum, never below |
| `cache_buffer_multiplier` | 1.1 | User config (`llm.json`) |
| `min_cacheable_tokens` | Model-dependent (see below) | Hardcoded per model family |

### Per-model `min_cacheable_tokens`

Anthropic's prompt caching uses different minimum block sizes across the Claude family:

| Model family | `min_cacheable_tokens` |
|---|---|
| Claude Opus 4.5 | 4096 |
| Claude Opus 4.6 | 4096 |
| Claude Haiku 4.5 | 4096 |
| Claude Sonnet 4, 4.5, 4.6 | 1024 |
| Claude Opus 4, 4.1 | 1024 |
| Other Claude models (fallback) | 1024 |

The cache target computation uses `max(...)` so user configuration can raise the threshold but never drop below the model's hardcoded minimum. A user who sets `cache_min_tokens = 512` on an Opus 4.6 session still gets `cache_target = max(512, 4096) × 1.1 = 4505.6` (effectively 4506 tokens after integer clamp).

### Fallback cache target

When a caller has no model reference available (e.g., constructing a stability tracker before the model is known), the fallback cache target uses a conservative default:

| Value | Purpose |
|---|---|
| 1536 | StabilityTracker default constructor argument — used only until LLMService overrides with the model-aware computed value |

This value is immediately overridden in production use; it exists only so standalone tracker construction has a sensible placeholder.

### Placeholder tokens during initial placement

The four-tier even split uses a per-entry placeholder token count while bin-packing, before the measurement pass runs:

| Value | Purpose |
|---|---|
| 100 tokens | Conservative per-entry estimate for clustering bin-pack math |

Deliberately below the common real-block range (50–300 tokens) — a slight underestimate means post-measurement tier totals end up a little smaller than the placeholder budget suggested, which is safe. Overestimating would pack too many files into each tier and trigger immediate demotion cascades on the first post-measurement request.

### L0 backfill (removed)

Under D36 there is no L0 backfill. L0 is a flux tier filled by the membrane controller from the bottom up, the same as L1–L3. Cross-reference activation seeds the secondary index's dir-blocks into the cascade with mtime-based tier assignment (see `specs4/3-llm/cache-tiering.md § Cross-Reference Mode`); the membrane then promotes them as their stability evidence accumulates. The `backfill_l0_after_measurement` helper and its `overshoot_multiplier` parameter are removed.

### Cascade iteration cap

The bottom-up cascade (Active → L3 → L2 → L1 → L0) repeats until no promotions occur in a full pass. To prevent infinite loops under pathological conditions:

| Value | Purpose |
|---|---|
| 8 | Maximum cascade iterations per update cycle |

In practice the cascade stabilises within 2–3 iterations; the cap is defensive. If hit, the update cycle logs a warning and stops — the tracker remains correct but may be sub-optimally distributed until the next request.

### Graduation thresholds

| Threshold | Value | Used by |
|---|---|---|
| Graduation N (active → L3) | 3 | Files (including edit-pinned), URLs, dir-blocks rebuilt by edits |
| URL direct-entry tier | L1 (entry N = 9) | URLs skip the graduation wait; static content enters directly cached |

Dir-blocks (`symbols:<dir>`, `docs:<dir>`, `plain_files:<dir>`) follow the same N-counter cascade as files. At session start they are seeded across L0–L3 by mtime (see Initialization in the behavioural spec). Subsequent block content changes (file added/removed from the directory's set, or a file in the block edited) demote the block to Active where it must re-earn its tier with a fresh N counter.

History does not use an N threshold and does not use a token-budget threshold. It graduates only on piggyback — when any tier is already marked broken for an unrelated reason on a given turn, newest → oldest history fills a verbatim window sized at `cache_target_tokens` in active and everything older rides the flux. See the behavioural spec for rationale (`cache_target_tokens` is a caching floor, not a conversation-length cap, and token-driven history graduation would destabilise lower tiers on almost every turn).

### Deletion markers (removed)

Under D36 there are no deletion markers. When a file is deleted during the session:

- If the file is in Active full-text, the `file:<path>` tracker entry is removed (the file is no longer renderable).
- If the file is represented inside a dir-block, the entry is removed from the block's set, the block's content shrinks, and the block teleports back to Active to re-ride the flux on the next freeze.

The previous `DELETION_MARKER_TEXT` constant and its rendered fenced-block representation are gone. The model never sees a "this file used to exist" placeholder — the structural index simply no longer mentions the file.

### Minimum verbatim exchange safeguard

Not strictly a cache-tiering constant but co-resident in the same subsystem:

| Threshold | Default | Source |
|---|---|---|
| History messages never graduated regardless of token budget | 2 exchanges | Compaction config (`app.json`), owned by history compaction — see `specs-reference/3-llm/history.md` when written |

### Cache warmer

Module-level constants in `src/ac_dc/llm/_cache_warmer.py`:

| Constant | Value | Purpose |
|---|---|---|
| `_WARMUP_PROMPT` | `"ping (cache warm-up — respond with 'ok')"` | User message text appended after the cached prefix. Stable across calls so the cached suffix tail matches between warm-ups |
| `_WARMUP_MAX_TOKENS` | 2 | `max_tokens` argument to `litellm.completion`. Providers reject 0; 2 covers a single token plus framing |
| `_CACHE_TTL_SECONDS` | 300.0 | Anthropic prompt cache TTL. Used as the retry-budget cutoff: if a retry would push elapsed + wait past this, the warmer aborts and disables |
| `_COUNTDOWN_SECONDS` | 30.0 | Visible countdown phase before each warm-up firing. The frontend renders one tick per second |
| `_HEARTBEAT_POLL_SECONDS` | 1.0 | Silent-phase polling chunk size against a wall-clock deadline. Tightened from 5.0s under D38 for OS-level idle-throttling resistance — macOS App Nap and similar park "idle-looking" processes; a 1s poll keeps the warmer visibly active to the kernel. Renamed from `_DRIFT_POLL_SECONDS` to reflect the broader role: drift bound + idle-throttle resistance + heartbeat for the diagnostic stall warning |
| `_BROADCAST_TIMEOUT_SECONDS` | 5.0 | Per-broadcast timeout for `cacheWarmup*` events. A hung WebSocket / jrpc-oo send is logged and bypassed rather than wedging the warmer's event loop. The next cycle gets a fresh timeout budget. Added under D38 |
| `_HEARTBEAT_INTERVAL_SECONDS` | 0.1 | Diagnostic heartbeat task wake cadence. 100ms catches sub-second stalls without dominating scheduler time |
| `_HEARTBEAT_WARN_THRESHOLD_SECONDS` | 1.0 | WARNING-log threshold on heartbeat gap. >1s between wakes means the event loop was held — by a blocking call, a long synchronous code path, or OS-level process suspension |
| `_CIRCUIT_BREAKER_STRIKES` | 3 | Consecutive TTL-exceeded cycles before auto-disable. Resets to 0 on any in-TTL cycle |

Default config values (in `app.json` under the `cache_warmup` section):

| Field | Default | Notes |
|---|---|---|
| `enabled` | `false` | Bundled default. Operators must opt in via both this flag AND the CLI `--experimental` flag for any warm-up to fire. Auto-disable on failure flips an independent runtime flag — under D38, re-enabling can be triggered via `enable()` once the underlying issue is resolved without application restart, but only when `cache_warmup.enabled: true` in config (the operator must edit `app.json` first if config has explicitly disabled the warmer) |
| `interval_seconds` | 240 | 4:00, sits inside the 5-minute TTL with a 60s margin for countdown + provider latency + system drift. Clamped at upper bound (`_CACHE_TTL_SECONDS - 60` = 240s); values above this are silently lowered with a WARNING log |

**Executor isolation (D34).** The warmer runs on a dedicated single-worker `ThreadPoolExecutor` (`_warmer_executor`), separate from the `_aux_executor` used by KeyBERT enrichment, commit-message generation, topic detection, and URL fetching. Pre-D34, the warmer shared `_aux_executor`; in 15-file doc-mode sessions, KeyBERT enrichment saturated both aux workers, queueing the warmer's LiteLLM call for ~120s and producing 100% cache-write rate. The dedicated pool removes the queueing path entirely. `_completion_sync` measures and logs `queue_duration` on entry — non-trivial readings indicate the executor isolation has regressed.

**Wall-clock deadline anchoring (D34 follow-up).** The silent-phase polling loop and the visible-phase countdown both anchor on `time.time()` (wall-clock epoch) rather than `time.monotonic()`. On macOS / Linux the process can be suspended (App Nap, container freezer, laptop sleep). During suspension `time.monotonic()` may not advance — a polling loop using monotonic deadlines wakes up post-resume, sees the deadline as still in the future against a frozen monotonic clock, sleeps another `_DRIFT_POLL_SECONDS` chunk against post-resume wall-clock time, and the firing lands long after the cached prefix expired. Field observation: 84-second drift past TTL on a 240-second interval with 5-second polling cadence — only explicable if the monotonic clock paused during system suspension. Wall-clock anchoring makes the post-resume wake see the deadline as already passed and exits immediately. NTP step magnitudes at the 240-second-interval scale stay well below the 60-second TTL margin. TTL-exceeded firings (long suspension that crosses the cache window) are skipped rather than fired — writing a fresh cache here just to prime the next 5-minute window is the same outcome as letting the next user turn write the cache, at the same provider cost, with no benefit. Skipped cycles still count as strikes against the circuit breaker so repeated suspensions trip it.

**Trade-offs of wall-clock anchoring.** The choice between `time.time()` and `time.monotonic()` is not free. Wall-clock anchoring is correct under OS-level process suspension on every platform that exposes a wall clock (Linux, macOS, Windows, BSD, container runtimes). It is *not* correct under arbitrary clock manipulation:

- **NTP step backward** (chronyd / ntpd performing a corrective step rather than a slew, manual `date -s` from user-space, VM resume from a snapshot with badly-skewed clock): the deadline recedes by the step magnitude and the warmer fires late by the same amount. Modern distros disable steps after initial sync (chronyd's `makestep 1.0 3` defaults), so steady-state steps are rare in normal operation. The 60-second TTL margin absorbs typical multi-second steps.
- **NTP step forward**: symmetric — the warmer fires early. Harmless (a slightly-early warm-up still hits the cache).
- **Linux-specific monotonic semantics.** Python's `time.monotonic()` maps to `CLOCK_MONOTONIC` on Linux, which historically does NOT advance during system suspend (`CLOCK_BOOTTIME` does). The user's observed bug was on Ubuntu; other Linux configurations with `CLOCK_MONOTONIC_RAW` semantics may have been fine on the original code. Wall-clock anchoring is correct in both cases.

For pathological clock-manipulation environments (VM-snapshot-restoration without time-sync coordination, embedded Linux without NTP, hand-edited system clocks), the circuit breaker remains the safety net: three consecutive cycles drifting past TTL trips the breaker, the warmer auto-disables, the operator sees the disable reason in logs. Operators in those environments either fix their clock discipline or accept that the warmer is best-effort. The alternative — building a hybrid anchor that uses monotonic time for "is this clock manipulation?" detection — adds complexity for an exotic case.

**Circuit breaker (D34).** After every firing the warmer compares `actual_delay` against `_CACHE_TTL_SECONDS`. A drift past the TTL increments `_consecutive_drift_strikes`; a successful in-TTL cycle resets it. After `_CIRCUIT_BREAKER_STRIKES` (3) strikes in a row the warmer auto-disables via `disable("circuit breaker — drift exceeded TTL N times")`, broadcasting `cacheWarmupComplete` with `success=false` first so the UI can render a failure flash. Operators see the strike count in the per-cycle WARNING log (`strikes=N/3`) so escalation is visible before the breaker trips. D38 adds an `enable()` method so a tripped breaker can be reset operator-side without application restart, provided config has not also disabled the warmer.

**Runtime reasoning tracking (D38).** The warmer mirrors the most recent user call's resolved reasoning state rather than reading `config.reasoning_enabled`. The streaming pipeline writes the resolved per-request bool onto `service._last_reasoning_used` after every user call; `_completion_sync` reads it on each firing and constructs the `thinking` kwarg accordingly. The UI toggle (per-request `reasoning` arg sent by the chat panel) is the single user-facing control — `config.reasoning.enabled` is no-longer-load-bearing in the live path, retained only for tests and any future consumer that needs a config default. Earlier revisions either disabled reasoning unconditionally on every firing or read the config flag directly; both produced cache-slot mismatches when the user toggled reasoning per-request via the UI, and reasoning user calls landed cold-writes regardless of whether the warmer was firing on schedule. Defaults to False on startup so warm-ups before any user call are cheap; once the user fires a reasoning call the warmer adopts that posture and stays until the user toggles back. One-cycle adaptation lag on toggle change. Reasoning warm-ups use `config.reasoning_request_timeout_seconds` (default 1200s) and raise `_WARMUP_MAX_TOKENS` to `budget_tokens + 100` for legacy thinking models; adaptive models keep `_WARMUP_MAX_TOKENS=2` because they bound their own reasoning internally.

**Bounded broadcast waits (D38).** Each `cacheWarmup*` broadcast is wrapped in `asyncio.wait_for(..., timeout=_BROADCAST_TIMEOUT_SECONDS)`. Field observation under D34 / D34a showed broadcasts occasionally hanging for ~120 seconds in the WebSocket / jrpc-oo serialisation path during warm-up cycles — root cause undiagnosed but the fix is structural: a stall affects only one broadcast (logs and continues), the next warmer cycle gets a fresh budget, and the diagnostic heartbeat task runs independently of the broadcast loop so loop-stall WARNINGs surface even when the broadcast helper's own log is delayed by the timeout. The sub-second poll cadence works alongside the bounded waits — together they ensure the warmer's event loop can't be wedged for more than a few seconds by any single failure mode.

## Schemas

### TrackedItem shape

Each tracker entry carries:

| Field | Type | Notes |
|---|---|---|
| `key` | string | Prefixed by type — `file:`, `symbols:`, `docs:`, `plain_files:`, `history:`, `url:` |
| `tier` | enum | `L0` / `L1` / `L2` / `L3` / `active` |
| `n` | int | Consecutive unchanged appearances |
| `content_hash` | string | 64-char SHA-256 hex, or empty string for placeholder-initialised entries |
| `tokens` | int | Measured token count; 0 for placeholder-initialised entries awaiting first measurement |

The `_anchored` flag is a transient per-cascade attribute set dynamically via `setattr`, not a declared field. It's re-evaluated from scratch on each cascade pass and never persists across update cycles. Earlier revisions also defined a transient `_pinned` flag protecting edited `file:` entries from cleanup; this is removed under the membrane / flux model. Files (edited or not) can be deselected at any turn — the parent directory's dir-block carries the structural presence, and re-selection brings the full text back.

### Key prefixes

| Prefix | Source | Stored value | Tier eligibility |
|---|---|---|---|
| `file:{path}` | Selected files (Active full-text) | Full file content hash | Active, L3, L2, L1, L0 |
| `symbols:{dir}` | Per-directory union of symbol-table blocks | Hash of the directory's rendered symbols block (excluding files currently in Active) | Active, L3, L2, L1, L0 |
| `docs:{dir}` | Per-directory union of doc-outline blocks | Hash of the directory's rendered docs block (excluding files currently in Active) | Active, L3, L2, L1, L0 |
| `plain_files:{dir}` | Per-directory listing of files not covered by a *currently-surfacing* index in the active mode | Hash of the directory's rendered filename listing | Active, L3, L2, L1, L0 |
| `history:{N}` | Conversation history | Hash of `role + content` string, where N is the integer index | Active, L3, L2, L1, L0 |
| `url:{hash12}` | Fetched URL content | Hash of URL content; hash12 is the first 12 chars of SHA-256(url) | Active, L3, L2, L1, L0 |

The `system:prompt` tracker entry from D27 is **removed**. The system prompt sits before L0 as the only non-flux head anchor and is rendered directly from `ContextManager.get_system_prompt()` at assembly time; it is not represented as a tracker entry and not subject to the N-counter cascade.

The `symbol:{path}` and `doc:{path}` per-file keys from D27 are **removed**. Their content lives inside the directory's `symbols:<dir>` / `docs:<dir>` block, hashed and counted as a unit. A file's symbol-table change perturbs the block's hash, demotes the block to Active, and the block re-rides the flux as a single tracker entry.

When a file enters Active full-text, the tracker invariant guarantees it is removed from its directory's `symbols:<dir>` / `docs:<dir>` / `plain_files:<dir>` block at the same time, causing that block's content to shrink (hash change → demote to Active). When the file leaves Active, it re-enters the block, growing it (hash change → demote to Active). This block-rebuild rule keeps every indexed file represented in exactly one place per turn.

## Dependency quirks

### Dir-block signature hash

Each `symbols:<dir>` / `docs:<dir>` block is hashed from the concatenation of the directory's per-file raw structural-data hashes, in stable filename order, **excluding** any file currently in Active full-text. The formatted compact output (path aliases, abbreviation rendering) is computed at assembly time but is NOT part of the hash — same rationale as the per-file symbol hash under D27 (avoid spurious demotions from purely-rendering differences).

`plain_files:<dir>` blocks hash the sorted list of filenames in the directory not covered by a *currently-surfacing* index (see the coverage quirk below).

Consumers should use `SymbolIndex.get_dir_signature_hash(dir, active_excluded)` and `DocIndex.get_dir_signature_hash(dir, active_excluded)` (authoritative) rather than hashing rendered output themselves.

### Mode-surfacing coverage for `plain_files`

A file is subtracted from its directory's `plain_files:<dir>` listing only when it is covered by an index that is **currently surfacing dir-blocks in the active mode** — not whenever it appears in *any* index. The surfacing rules:

- Symbol index surfaces in code mode, or any mode with cross-reference enabled.
- Doc index surfaces in doc mode, or any mode with cross-reference enabled.

A file covered only by a non-surfacing index stays in `plain_files`. The load-bearing case: a `.md` / `.svg` file in **code mode without cross-reference** is doc-indexed, but the doc index is not surfacing `docs:<dir>` blocks. If coverage were computed from both indexes unconditionally, that file would be subtracted from `plain_files` (as "covered") yet never seeded into any `docs:<dir>` block (that branch is doc-mode-only) — vanishing from the structural cache entirely, surviving only if the user happened to select it as a full-text `file:` entry. Gating coverage on surfacing keeps the file visible by filename through `plain_files:<dir>` until cross-reference toggles on or the mode switches.

The implementation lives in `_indexed_paths_in_dir` (`src/ac_dc/llm/_stability.py`); it is consumed by initial seeding, manual rebuild, and per-turn `plain_files` refresh, so the gate is applied consistently across all three.

### No L0 snapshot

D36 removes the L0 snapshot mechanism. Prompt assembly renders dir-blocks directly from the live indexes at each turn, with the tracker's recorded hash and tokens used by the membrane controller to detect content changes. There are no `_l0_system_prompt` / `_l0_primary_legend` / `_l0_primary_map` / `_l0_secondary_legend` / `_l0_secondary_map` snapshot fields.

The system prompt is read fresh from `ContextManager.get_system_prompt()` at assembly time and concatenated with the legend(s) into the L0 system message. Legends are rendered live from `SymbolIndex.get_legend()` / `DocIndex.get_legend()`. None of these are tracker entries; their bytes are part of the L0 system message but their stability is enforced structurally (the system prompt is the head anchor and changes only at the documented invalidation events — see `specs4/3-llm/cache-tiering.md`).

## Cross-references

- Behavioral cascade algorithm, promotion/demotion semantics, mode dispatch, rebuild semantics, invariants: `specs4/3-llm/cache-tiering.md`
- Stability tracker attachment pattern: `specs4/3-llm/context-model.md`
- History compaction thresholds (`trigger_tokens`, `verbatim_window_tokens`, etc.): `specs-reference/3-llm/history.md` (when written) — separate config domain, separate constants
- Prompt assembly consuming tier outputs: `specs4/3-llm/prompt-assembly.md`