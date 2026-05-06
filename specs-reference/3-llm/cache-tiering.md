# Reference: Cache Tiering

**Supplements:** `specs4/3-llm/cache-tiering.md`

## Numeric constants

### Tier parameters

Each stability tier (L1, L2, L3, Active) has an **entry N** (the N value assigned on arrival) and a **promotion N** (the threshold above which an item is eligible to promote to the next tier up). L0 is content-typed (system prompt + aggregate maps) and not subject to the N-counter cascade.

| Tier | Entry N | Promotion N | Notes |
|---|---|---|---|
| L0 | — | — | Content-typed; system prompt + aggregate symbol/doc maps; never invalidated by routine events |
| L1 | 9 | — (terminal for cascade-mobile content) | Most stable promoted concrete content |
| L2 | 6 | 9 | |
| L3 | 3 | 6 | Entry tier for graduated content |
| Active | 0 | 3 | Uncached; N ≥ 3 makes an item eligible to graduate to L3 |

Promoted items enter their destination tier with the destination's entry N, **not** preserving their source-tier N. An item promoting from L3 → L2 arrives at L2 with N = 6, regardless of whether its L3 N was 6, 7, or 8.

Cascade-mobile content (`file:`, `url:`, `history:`) never reaches L0 — the cascade respects the L0 content-type policy and stops promotion at L1.

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

### Post-measurement L0 backfill (cross-reference enable only)

Under the L0-content-typed model, init and rebuild do not run L0 backfill — L0 is populated directly with the aggregate maps. `backfill_l0_after_measurement` remains wired into `seed_cross_reference_items` so cross-reference activation can promote the most-connected opposite-index items into L0 alongside the primary aggregate map. This is the only remaining caller.

| Value | Purpose |
|---|---|
| 2.0 | Default `overshoot_multiplier` |

When called, the backfill ranks candidates by reference count descending and promotes until real token total reaches `cache_target_tokens × overshoot_multiplier`. Source tiers marked broken; L0 not marked broken (promoted items earn their slot). Scoped to `candidate_keys` when provided (cross-reference enable uses this to avoid promoting pre-existing tracker entries).

Cross-reference items are structural (symbol or doc blocks), so promoting them into L0 is consistent with L0's content-type policy. File and URL content is never a candidate for this backfill.

### Cascade iteration cap

The bottom-up cascade (L3 → L2 → L1 → L0) repeats until no promotions occur in a full pass. To prevent infinite loops under pathological conditions:

| Value | Purpose |
|---|---|
| 8 | Maximum cascade iterations per update cycle |

In practice the cascade stabilises within 2–3 iterations; the cap is defensive. If hit, the update cycle logs a warning and stops — the tracker remains correct but may be sub-optimally distributed until the next request.

### Graduation thresholds

| Threshold | Value | Used by |
|---|---|---|
| Graduation N (active → L3) | 3 | Files (including edit-pinned), URLs, deletion markers |
| URL direct-entry tier | L1 (entry N = 9) | URLs skip the graduation wait; static content enters directly cached |

Symbol blocks and doc blocks do not graduate — they live permanently in L0's aggregate maps from session start (or last `rebuild_cache`) and are not subject to the N-counter cascade.

History does not use an N threshold and does not use a token-budget threshold. It graduates only on piggyback — when L3 is already marked broken for an unrelated reason, newest → oldest history fills a verbatim window sized at `cache_target_tokens` in active and everything older promotes to L3. See the behavioural spec for rationale (`cache_target_tokens` is a caching floor, not a conversation-length cap, and token-driven history graduation would destabilise L3 on almost every turn).

### Deletion marker content

When a `file:<path>` entry transitions to a deletion-marker entry (file deleted from disk during the session), its content is replaced by a fixed string:

| Constant | Value |
|---|---|
| `DELETION_MARKER_TEXT` | `"[deleted in this session — see L0 symbol/doc map for last-known structure]"` |

Byte-identical across all marker entries — the marker hash is `SHA-256(DELETION_MARKER_TEXT)` and is therefore the same for every deletion. This is intentional: identical hashes mean the cascade sees deletion markers as stable content (no spurious demotions across requests) and lets multiple deleted files share an indistinguishable marker representation.

The marker text is rendered into the prompt verbatim wherever the deleted file would have appeared (Active working files section, or the appropriate L1/L2/L3 reference-files block). Path is shown above the marker via the standard fenced-block format documented in `specs-reference/3-llm/prompt-assembly.md` § File content formatting:

```
path/to/deleted_file.py
```
[deleted in this session — see L0 symbol/doc map for last-known structure]
```
```

Reimplementer note: keep this string byte-identical. A regex or fuzzy match in the LLM's training data may key on the bracket-prefix shape; small variations (different bracket style, different wording) may produce subtly different model behaviour. The exact text was chosen for clarity to the LLM ("see L0 symbol/doc map" tells the model where to find structural information about what was deleted) and brevity (no wasted tokens when many files are deleted in a session).

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

| Prefix | Source | Stored value | Tier eligibility |
|---|---|---|---|
| `file:{path}` | Selected files | Full file content hash | Active, L3, L2, L1 (never L0) |
| `file:{path}` (deletion marker) | File deleted from disk during session | Hash of `DELETION_MARKER_TEXT` (constant — see below) | Active, L3, L2, L1 (never L0) |
| `symbol:{path}` | Symbol index entries | Signature hash (raw symbol data, not formatted output) | L0 only (aggregate map); cross-reference activation may seed additional `symbol:` entries into L0 |
| `doc:{path}` | Document index entries | Signature hash (raw outline data) | L0 only (aggregate map); cross-reference activation may seed additional `doc:` entries into L0 |
| `history:{N}` | Conversation history | Hash of `role + content` string, where N is the integer index | Active, L3, L2, L1 (never L0) |
| `url:{hash12}` | Fetched URL content | Hash of URL content; hash12 is the first 12 chars of SHA-256(url) | Active, L3, L2, L1 (never L0) |
| `system:prompt` | System prompt + legend | Hash of prompt text only (excludes legend, so file-selection-driven legend changes don't destabilise the system entry) | L0 only |

`file:` entries acquire an additional transient `_pinned` flag when the file is edited during the session. Pinned entries are not subject to stale-cleanup eviction. Pin flags are cleared by application restart or explicit `rebuild_cache`.

Deletion-marker entries reuse the `file:{path}` key prefix — they're the same key as the original file, with content and hash replaced. Path-keyed identity means re-creating a file at the same path during the session naturally promotes the marker back to a normal `file:` entry on the next hash-change cycle (the new content hashes differently from `DELETION_MARKER_TEXT`, demoting the entry to Active with fresh content). Deletion markers do NOT carry the `_pinned` flag; they are intrinsically stable (constant hash) and don't need pin-protection — only `rebuild_cache` and application restart clear them.

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