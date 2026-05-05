# Reference: Cache Tiering

**Supplements:** `specs4/3-llm/cache-tiering.md`

## Numeric constants

### Tier parameters

Each stability tier has an **entry N** (the N value assigned on arrival) and a **promotion N** (the threshold above which an item is eligible to promote to the next tier up).

| Tier | Entry N | Promotion N | Notes |
|---|---|---|---|
| L0 | 12 | — (terminal) | Most stable; items here never promote further |
| L1 | 9 | 12 | |
| L2 | 6 | 9 | |
| L3 | 3 | 6 | Entry tier for graduated content |
| Active | 0 | 3 | Uncached; N ≥ 3 makes an item eligible to graduate to L3 |

Promoted items enter their destination tier with the destination's entry N, **not** preserving their source-tier N. An item promoting from L3 → L2 arrives at L2 with N = 6, regardless of whether its L3 N was 6, 7, or 8.

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

### L0 seeding estimate

Initial tier assignment from the reference graph seeds L0 with highest-ref-count files until the cache target is met. Since real token counts aren't available until after initialisation (the measurement pass runs after seeding), a per-entry estimate is used:

| Value | Purpose |
|---|---|
| 400 tokens | Conservative per-entry estimate during L0 seeding |

Chosen conservatively — the real post-measurement values are usually *lower* than the 400-token placeholder (real symbol/doc blocks are typically 50–300 tokens), so the placeholder under-seeds. The post-measurement backfill pass (below) corrects the under-seed.

### L0 post-measurement backfill overshoot

After the measurement pass replaces placeholder tokens with real counts, a backfill pass pulls high-ref-count candidates from L1/L2/L3 into L0 until the real token total meets a target with deliberate overshoot:

| Value | Purpose |
|---|---|
| 1.5 | `overshoot_multiplier` — multiplies `cache_target_tokens` to produce the backfill target |

Target computation: `backfill_target = cache_target_tokens × overshoot_multiplier`. At the default 1.5, L0 is filled to ~150% of the cache-min threshold, providing ~50% headroom above the provider's floor. The overshoot is load-bearing:

- Below 1.0 — L0 sits at or below the cache-min floor; the provider refuses to cache it
- Exactly 1.0 — any single-request content change drops L0 below the floor again
- 1.5 (default) — enough headroom for the cascade's anchor-veterans-above-threshold path to trigger, so L1 items can promote upward as low-ref L0 content cycles out
- Above 2.0 — too much pull from L1/L2/L3, starves the lower tiers

The backfill preserves each promoted item's real token count and content hash (measurement already populated them); only `tier` and `n_value` change, with `n_value` set to L0's entry N (12). Source tiers are marked broken so the next cascade rebalances their distribution.

Fires in both init paths — startup stability initialization and manual cache rebuild — immediately after the measurement pass. No-op when `cache_target_tokens == 0` (caching disabled) or when L0 already exceeds the overshoot target.

### Cascade iteration cap

The bottom-up cascade (L3 → L2 → L1 → L0) repeats until no promotions occur in a full pass. To prevent infinite loops under pathological conditions:

| Value | Purpose |
|---|---|
| 8 | Maximum cascade iterations per update cycle |

In practice the cascade stabilises within 2–3 iterations; the cap is defensive. If hit, the update cycle logs a warning and stops — the tracker remains correct but may be sub-optimally distributed until the next request.

### Graduation thresholds

| Threshold | Value | Used by |
|---|---|---|
| Graduation N (active → L3) | 3 | Files, symbols, doc blocks |
| URL direct-entry tier | L1 (entry N = 9) | URLs skip the graduation wait; static content enters directly cached |

History does not use an N threshold and does not use a token-budget threshold. It graduates only on piggyback — when L3 is already marked broken for an unrelated reason, newest → oldest history fills a verbatim window sized at `cache_target_tokens` in active and everything older promotes to L3. See the behavioural spec for rationale (`cache_target_tokens` is a caching floor, not a conversation-length cap, and token-driven history graduation would destabilise L3 on almost every turn).

### Minimum verbatim exchange safeguard

Not strictly a cache-tiering constant but co-resident in the same subsystem:

| Threshold | Default | Source |
|---|---|---|
| History messages never graduated regardless of token budget | 2 exchanges | Compaction config (`app.json`), owned by history compaction — see `specs-reference/3-llm/history.md` when written |

## Schemas

### TrackedItem shape

Each tracker entry carries:

| Field | Type | Notes |
|---|---|---|
| `key` | string | Prefixed by type — `file:`, `symbol:`, `doc:`, `history:`, `url:`, `system:` |
| `tier` | enum | `L0` / `L1` / `L2` / `L3` / `active` |
| `n` | int | Consecutive unchanged appearances |
| `content_hash` | string | 64-char SHA-256 hex, or empty string for placeholder-initialised entries |
| `tokens` | int | Measured token count; 0 for placeholder-initialised entries awaiting first measurement |

The `_anchored` flag is a transient per-cascade attribute set dynamically via `setattr`, not a declared field. It's re-evaluated from scratch on each cascade pass and never persists across update cycles.

### Key prefixes

| Prefix | Source | Stored value |
|---|---|---|
| `file:{path}` | Selected files | Full file content hash |
| `symbol:{path}` | Symbol index entries | Signature hash (raw symbol data, not formatted output) |
| `doc:{path}` | Document index entries | Signature hash (raw outline data) |
| `history:{N}` | Conversation history | Hash of `role + content` string, where N is the integer index |
| `url:{hash12}` | Fetched URL content | Hash of URL content; hash12 is the first 12 chars of SHA-256(url) |
| `system:prompt` | System prompt + legend | Hash of prompt text only (excludes legend, so file-selection-driven legend changes don't destabilise the system entry) |

## Dependency quirks

### Symbol block signature hash

Symbol blocks are hashed from their raw structural data, not from the formatted compact output. The formatted output includes path aliases and `exclude_files`-aware rendering that changes between requests without the underlying symbols changing. Hashing raw data avoids spurious demotions from purely-rendering differences.

Consumers should use `SymbolIndex.get_signature_hash(path)` (authoritative) rather than hashing `get_file_symbol_block(path)` output themselves.

### System prompt hash excludes legend

The system prompt hash covers prompt text only. The legend (path aliases, abbreviation reference) is concatenated at render time but NOT part of the hashed content. Rationale: the legend changes whenever file selections change (path aliases update), and hashing the combined string would cause the `system:prompt` entry to demote on every file-selection change — preventing it from ever stabilising into L0.

## Cross-references

- Behavioral cascade algorithm, promotion/demotion semantics, mode dispatch, rebuild semantics, invariants: `specs4/3-llm/cache-tiering.md`
- Stability tracker attachment pattern: `specs4/3-llm/context-model.md`
- History compaction thresholds (`trigger_tokens`, `verbatim_window_tokens`, etc.): `specs-reference/3-llm/history.md` (when written) — separate config domain, separate constants
- Prompt assembly consuming tier outputs: `specs4/3-llm/prompt-assembly.md`