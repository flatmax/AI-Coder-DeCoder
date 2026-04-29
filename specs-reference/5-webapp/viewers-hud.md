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