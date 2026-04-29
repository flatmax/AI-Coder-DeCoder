# Reference: Viewers and HUD

**Supplements:** `specs4/5-webapp/viewers-hud.md`

## Numeric constants

### Token HUD auto-hide

| Constant | Value |
|---|---|
| `_AUTO_HIDE_MS` | 8000 (ms before fade starts) |
| `_FADE_MS` | 800 (fade duration) |
| Total visible time | 8000 + 800 = 8800 ms |
| Hover behavior | Pauses timer; mouse leave restarts auto-hide |
| Dismiss button | Hides immediately (no fade) |

### HUD geometry

| Constant | Value |
|---|---|
| Position | `position: fixed; top: 16px; right: 16px` |
| Z-index | 10000 |
| Width | 340 px fixed |
| Max height | 80 vh with overflow scroll |

### Cache hit rate color thresholds

| Rate | Color | CSS class |
|---|---|---|
| ≥ 50% | Green | `.hit-rate.good` |
| ≥ 20% | Amber | `.hit-rate.warn` |
| < 20% | Red | `.hit-rate.poor` |

Applies to both the HUD header badge and the Cache sub-view's performance bar.

### Budget bar color thresholds

| Usage % | Color |
|---|---|
| ≤ 75% | Green |
| 75–90% | Amber |
| > 90% | Red |

Applies to the Budget sub-view's token budget bar and the HUD's history budget section.

### Compaction status percent cap

Returned `percent` capped at 999 — a pathological ratio shouldn't produce a four-digit percent that overflows the UI progress bar.

## Schemas

### Tier color palette

Warm-to-cool spectrum:

| Tier | Color name | Hex | Rationale |
|---|---|---|---|
| L0 | Green | `#50c878` | Most stable — calming, rare-event |
| L1 | Teal | `#2dd4bf` | Very stable |
| L2 | Blue | `#60a5fa` | Moderately stable |
| L3 | Amber | `#f59e0b` | Entry tier — warming toward change |
| Active | Orange | `#f97316` | Uncached — warmest, most volatile |

Used consistently across:
- Token HUD tier chart
- Cache sub-view tier group headers
- Cache sub-view stability bars (per-item fill color matches tier)
- Terminal HUD (logged as prefix emoji rather than hex color)

Cross-surface consistency matters — users eyeball the tier colors and need to map them immediately.

### Category color palette (budget stacked bar)

| Category | Hex |
|---|---|
| System | `#50c878` (green) |
| Symbol map / Doc map | `#60a5fa` (blue) |
| Files | `#f59e0b` (amber) |
| URLs | `#a78bfa` (purple) |
| History | `#f97316` (orange) |

### Content group type icons

Per-item icons in the Cache sub-view:

| Type | Icon | Key prefix |
|---|---|---|
| System | ⚙️ | `system:` |
| Legend | 📖 | (rendered as part of system line) |
| Symbols | 📦 | `symbol:` |
| Doc symbols | 📝 | `doc:` |
| Files | 📄 | `file:` |
| URLs | 🔗 | `url:` |
| History | 💬 | `history:` |

### Tier change markers (terminal HUD)

| Change type | Prefix |
|---|---|
| Promotion | 📈 |
| Demotion | 📉 |

### Provider-cache-rate precedence

The `cache_hit_rate` field in the breakdown response is computed locally (cached tokens / total tokens). A separate `provider_cache_rate` is computed from cumulative session data (`cache_read_tokens / input_tokens`) — more accurate since it reflects actual provider behavior.

**Precedence rule:** Both HUD and Context tab prefer `provider_cache_rate` when non-null, falling back to the local `cache_hit_rate`. The fallback path is taken on the very first request (no cumulative session data yet).

### Reasoning row rendering

The `reasoning_tokens` field (subset of `completion_tokens` representing hidden reasoning — Claude extended thinking, o1/o3) is rendered in two places:

**Token HUD — "This Request" section:**
Persistent row, always rendered even when `reasoning_tokens == 0`. Rationale: zero is informative ("this model doesn't reason") and distinguishes genuine absence from "the backend forgot to report it". Label carries tooltip text "Hidden reasoning tokens (subset of Completion). Zero for models without extended thinking." so the user understands the relationship to `completion_tokens` without parsing field names.

**Context tab — Session Totals grid:**
Conditional row. Rendered only when the session's cumulative `completion` count is non-zero — a fresh session with no LLM calls suppresses the row entirely (an empty zero is noise). Tooltip text: "Cumulative hidden reasoning tokens across this session (subset of Completion Out — already billed inside it, shown separately for visibility)."

Neither place adds `reasoning_tokens` to the `completion_tokens` total — the provider already bills them under completion, and double-counting would inflate displayed usage. The row is a breakdown, not an addition.

### Cost row rendering (Context tab only)

Per operator preference, `cost_usd` renders in the Context tab's Session Totals only — not in the per-request HUD. The HUD shows transient per-request state; cost belongs with cumulative session metrics.

Three display cases driven by `priced_request_count` and `unpriced_request_count`:

| Condition | Row visibility | Label | Value format | Tooltip |
|---|---|---|---|---|
| `priced == 0 && unpriced == 0` | Row hidden | — | — | — |
| `priced > 0 && unpriced == 0` | Shown | Cost | `$0.0000` (4 decimals) | `{N} request(s) priced.` |
| `priced > 0 && unpriced > 0` | Shown | Cost | `$0.0000 (partial)` | `Priced: {N} request(s). {M} additional request(s) could not be priced (LiteLLM pricing table missing the model). True total is higher.` |
| `priced == 0 && unpriced > 0` | Shown | Cost | `—` | `{N} request(s) could not be priced (LiteLLM pricing table missing the model used).` |

The `—` case (no priced requests but requests were made) is distinct from the hidden case (no requests at all). Distinguishing "unknown cost" from "no activity" matters for self-hosted models and brand-new releases where LiteLLM's pricing table hasn't caught up yet — rendering `$0.0000` there would misleadingly suggest the session was free.

**4-decimal precision:** Typical per-session costs range from `$0.01` to `$10`; 4 decimals preserve sub-cent granularity for cheap auxiliary-model calls (commit-message generation, topic detection) which individually cost fractions of a cent. A session with many aux calls and few primary-model calls would round to `$0.00` at 2 decimals, hiding the actual spend.

**Color:** Green (`#7ee787`) when priced > 0, secondary text color when rendering `—`. Matches the color treatment of `cache_hit` in the same grid.

### Startup init HUD

Printed once during server startup after stability tracker initialization completes:

```
╭─ Initial Tier Distribution ─╮
│ L0       12 items            │
│ L1       18 items            │
│ L2       17 items            │
│ L3       17 items            │
├─────────────────────────────┤
│ Total: 64 items              │
╰─────────────────────────────╯
```

Shows per-tier item counts for all non-empty tiers. Box auto-sizes to widest line. Provides immediate visibility into how the reference graph was distributed on startup.

### Post-response HUD

Three sections printed after each LLM response:

**Cache blocks (boxed):**

```
╭─ Cache Blocks ────────────────────────────╮
│ L0         (12+)    1,622 tokens [cached] │
│ L1          (9+)   11,137 tokens [cached] │
│ L2          (6+)    8,462 tokens [cached] │
│ L3          (3+)      388 tokens [cached] │
│ active             19,643 tokens          │
├───────────────────────────────────────────┤
│ Total: 41,252 | Cache hit: 52%           │
╰───────────────────────────────────────────╯
```

Each cached tier shows `{name} ({entry_n}+)` — the entry N threshold — followed by token count and `[cached]` marker. Active tier shows token count only. Only non-empty tiers listed. Box width auto-sizes to the widest line.

**Token usage:**

```
Model: bedrock/anthropic.claude-sonnet-4-20250514
System:         1,622
Symbol Map:    34,355
Files:              0
History:       21,532
Total:         57,509 / 1,000,000
Last request:  74,708 in, 34 out
Cache:         read: 21,640, write: 48,070
Session total: 182,756
```

Labels adapt by mode: "Symbol Map" in code mode, "Doc Map" in document mode. Cross-reference mode adds an additional line.

**Tier changes:**

```
📈 L3 → L2: symbol:src/ac_dc/context.py
📉 L2 → active: symbol:src/ac_dc/repo.py
```

One line per change from the stability tracker's change log. Promotions first, then demotions.

## Schemas

### localStorage keys

| Key | Purpose |
|---|---|
| `ac-dc-context-subview` | `"budget"` / `"cache"` — active Context tab sub-view |
| `ac-dc-cache-expanded` | JSON-serialized array of expanded tier names |
| `ac-dc-cache-sort` | `"size"` / `"name"` — Cache sub-view sort mode |
| `ac-dc-budget-expanded` | JSON-serialized array of expanded category names |
| `ac-dc-hud-collapsed` | JSON-serialized array of collapsed section names in the Token HUD |

Cache sub-view defaults: L0 and active expanded; L1/L2/L3 collapsed.

## Cross-references

- Behavioral specification (Context tab, HUD lifecycle, Cache sub-view rebuild): `specs4/5-webapp/viewers-hud.md`
- Cache tier numeric thresholds (entry_n, promotion thresholds): `specs-reference/3-llm/cache-tiering.md`
- Session totals and token usage shape: `specs-reference/3-llm/streaming.md` § Token usage shape
- Context breakdown RPC payload: `specs-reference/1-foundation/rpc-inventory.md` § LLMService.get_context_breakdown