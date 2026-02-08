# Cache Management System

## Overview

The cache management system organizes LLM context into stability-based tiers that align with provider cache breakpoints (e.g., Anthropic's `cache_control: {"type": "ephemeral"}`). Content that remains unchanged across requests gradually promotes to higher cache tiers, reducing re-ingestion costs. Content that changes demotes back to the uncached active tier.

The system manages three categories of content:
- **Files**: Full file content included as working context
- **Symbol map entries**: Compact representations of file structure (classes, functions, imports)
- **History messages**: Conversation history (user/assistant pairs)

## Tier Structure

Five tiers, from most stable (cached first) to least stable (uncached):

| Tier | Entry N | Promotion N | Description |
|------|---------|-------------|-------------|
| L0 | 12 | — (terminal) | Most stable. System prompt, legend, core symbols/files |
| L1 | 9 | 12 | Very stable. Central files and symbols |
| L2 | 6 | 9 | Stable. Moderately referenced content |
| L3 | 3 | 6 | Moderately stable. Entry tier for graduated content |
| active | 0 | 3 | Recently changed or new. Not cached |

Each tier maps to a single cached message block sent to the LLM provider. The L0 block always includes the system prompt and the symbol map legend — these are **fixed L0 content** placed there at initialization, not earned through stability. Veterans that promote into L0 via ripple promotion join this fixed content.

## N Value and Stability Tracking

Every item tracked by the system has an **N value** — a counter that measures how long the item has remained unchanged.

### N Progression

1. **New item appears in active context**: N = 0
2. **Item unchanged across a request**: N increments by 1 each request. This applies in **all tiers** — active, L3, L2, L1, and L0. N continues incrementing in cached tiers, which is how veterans eventually reach the promotion threshold for the next tier.
3. **Item content changes** (hash mismatch or explicit modification): N resets to 0, demotes to active
4. **Item reaches N ≥ 3**: Eligible for graduation from active to L3 (files and symbols only — history is eligible immediately since it is immutable)

**Exception**: Veterans held back by the minimum token requirement (see "Threshold-Aware Promotion") do **not** get N incremented — their N stays frozen. Additionally, when the tier above is not invalidated, N++ is capped at the tier's promotion threshold to prevent artificial accumulation. See the per-tier algorithm for full details.

### Content Hashing

Each item's content is hashed (SHA256) to detect changes:
- **Files**: Hash of file content
- **Symbol entries**: Hash of the compact symbol block (`compute_file_block_hash`)
- **History messages**: Hash of `"role:content"` string

When the hash changes between requests, the item is considered modified — N resets to 0 and the item returns to active.

## Graduation: Active → L3

Items don't auto-promote while in the active items list. They must **leave** the active list to graduate. The `_update_cache_stability` method in `streaming.py` controls when items leave:

### Files and Symbols

Files and symbol entries with N ≥ 3 are **always** graduated — they are excluded from the active items list on the next request. There is no reason to delay caching a stable file; its content is identical whether served from active or a cached tier.

When a file graduates, its symbol entry (prefixed `symbol:`) also graduates independently (symbols and files are tracked separately since a file in active context has its full content included while its symbol entry is excluded from the symbol map).

File graduation itself counts as a ripple — when files leave the active set, this triggers piggybacking for history messages (see below).

### History Messages

History messages are **immutable** — once written to the conversation, their content never changes. Unlike files and symbols, there is no need to wait for N ≥ 3 to confirm stability. Any active history message is immediately eligible for graduation.

The difference between history and files/symbols exists **only in the active tier**. Once history graduates to L3, it follows the exact same veteran rules — N increments, threshold-aware promotion, ripple cascade — as files and symbols. The special handling below applies solely to the active → L3 transition.

However, the active set changes **every exchange** (new user/assistant messages are added), so graduating history on every request would break the cache every time. To avoid this churn, history graduation from active to L3 is **controlled**:

1. **Piggybacking on an existing ripple**: If files or symbols are already changing the active set (file selection changed, file/symbol graduation happening), all eligible active history graduates for free — the cache blocks are already being invalidated by the file/symbol changes.

2. **Token threshold met**: If total eligible history tokens exceed `cache_target_tokens`, the oldest eligible messages graduate even without a ripple. This ensures the resulting cache block meets provider minimums (e.g., 1024 tokens for Anthropic).

3. **Never** (if `cache_target_tokens = 0`): With the default configuration, history stays in active permanently. Set `cacheMinTokens` and `cacheBufferMultiplier` in `litellm.json` to enable.

The `cache_target_tokens` is computed as `cacheMinTokens × cacheBufferMultiplier` (default: 1024 × 1.5 = 1536).

**Once graduated to L3**, history messages follow the same veteran rules as files and symbols — N increments each request, and they promote through L3 → L2 → L1 → L0 via normal ripple promotion when their N exceeds the tier's promotion threshold.

## Ripple Promotion

When a tier's cache block is invalidated (an item is demoted or removed), veterans in the tier below may promote upward. This cascading behavior is called **ripple promotion**. Crucially, promotions **only happen into tiers that are already broken** — stable tiers are never disturbed.

### How It Works

1. A tier breaks (cache miss) because an item was demoted, removed, or had content change
2. The most stable veterans (highest N) from the next lower tier promote **up** into the broken tier
3. This breaks the source tier (its content changed), allowing veterans from the tier below *that* to promote up
4. The cascade propagates **downward through the tier stack**: an L1 break pulls veterans up from L2 → L2 breaks → pulls veterans up from L3 → L3 breaks → pulls eligible items up from active
5. If a tier is **not broken**, the cascade stops — no items move through that tier, and all tiers below it remain cached

In other words, content flows **upward** (toward L0) while the cascade signal propagates **downward** (toward active). Each break at a higher tier creates an opening that the most stable content from below fills.

### Why This Works

The cost of cascading is temporary — you pay for multiple cache misses on one request. But each tier's content becomes more optimal:

- The most stable content floats to L1/L0 over time
- After a few requests, all tiers resettle and cache hit rates improve
- Eventually L1 contains rock-solid content that rarely changes, so breaks become rare
- When everything is stable, **nothing moves** — all tiers stay cached

Without promotion, items stay wherever they were initialized. If the initial clustering was slightly wrong, you're stuck with a suboptimal layout for the entire session.

### Promotion Threshold

Veterans promote when their N value reaches the tier's `promotion_threshold`:

| Tier | Promotion N | Destination |
|------|-------------|-------------|
| L3 | 6 | L2 |
| L2 | 9 | L1 |
| L1 | 12 | L0 |
| L0 | — | Terminal (no further promotion) |

When a veteran promotes, it enters the destination tier with that tier's `entry_n` value and begins accumulating stability again.

### Threshold-Aware Promotion (Per-Tier Algorithm)

N increments are **not** a global end-of-request step. They happen inside the per-tier promotion algorithm, which runs during the cascade for each tier that receives incoming items. This is the single place where N values change.

**Inputs**: Incoming items (newly graduated from active, or promoted from the tier below)
**Outputs**: Outgoing items (promoted to the tier above, if that tier is invalidated)

The algorithm for a single tier:

1. **Merge** incoming items into the existing veteran list. Veterans are already ordered by N descending from previous requests. Incoming items enter with the tier's `entry_n` value and are inserted at their correct position (typically the bottom, since `entry_n` is the tier's minimum N). The ordering is **maintained across requests** — no full re-sort is needed.
2. **Walk the ordered list from the top** (highest N first), accumulating tokens:
   - **While accumulated tokens < `cache_target_tokens`**: these items are **held back** to meet the minimum. Their N is **frozen** — no increment. They remain in the tier to ensure the cache block meets the provider's minimum (e.g., 1024 tokens for Anthropic).
   - **Once the minimum is met**: remaining items (those not needed to fill the budget) receive **N++**
3. **After N++**, check each incremented item against the tier's promotion threshold:
   - If the **tier above is invalidated** and the item's new N exceeds the promotion threshold → the item **promotes out** (becomes an outgoing item, enters the tier above with that tier's `entry_n`)
   - If the **tier above is NOT invalidated** → N++ still applies but is **capped at the promotion threshold**. The item cannot leave, so its N does not accumulate past the maximum valid value for this tier. This prevents artificial N inflation when an item is stuck.
4. **Outgoing items** become the incoming items for the next tier up in the cascade

**Key properties:**

- The minimum token constraint is the primary throttle on promotion velocity — in a tier with many veterans above the promotion threshold, only as many can leave as the token budget allows
- Items held back to meet the minimum retain their current N, preserving their relative ordering. As new content enters the tier on subsequent requests and fills the token budget, previously held-back veterans become eligible for N++ and eventual promotion
- The N cap when the tier above is stable prevents veterans from accumulating arbitrarily high N values while stuck — when the tier above finally breaks, they promote immediately rather than overshooting

### The Guard: Only Promote Into Broken Tiers

This is the critical rule that prevents unnecessary cache invalidation:

- If L1 is stable (no cache miss), **nothing promotes into L1** — L2 and L3 stay cached
- If L1 breaks, L2 veterans can promote into L1 — this breaks L2
- If L2 breaks (from the cascade), L3 veterans can promote into L2 — this breaks L3
- If L3 breaks (from the cascade), eligible active items can graduate into L3

The result: in steady state, all tiers are cached. Only an actual content change triggers movement, and the cascade ensures each tier ends up with progressively more stable content.

**Empty active set**: If no files are selected, the active set is empty and nothing graduates into L3. However, the cascade still operates on cached tiers — if a tier is invalidated (e.g., a file was unchecked, removing its entry from a cached tier), veterans in lower tiers can still promote upward through the normal cascade rules, provided each tier meets its minimum token requirement.

### Ripple Detection and Cascade Trigger

A ripple is detected when the set of active file/symbol items changes between requests. There are two sources of ripple:

1. **File selection ripple**: The user changed which files are in active context (added, removed, or swapped files):
   ```
   has_file_symbol_ripple = (last_active_items != current_active_items)
   ```
   This is a symmetric check — both additions and removals trigger it.

2. **Graduation ripple**: Files or symbols with N ≥ 3 graduated out of active on this request, shrinking the active set:
   ```
   has_graduation_ripple = (active_file_symbols != file_symbol_items)
   ```
   This fires when the controlled graduation logic excludes eligible items from the active list.

Either source of ripple allows history to piggyback. The combined check is:
```
has_any_ripple = has_file_symbol_ripple or has_graduation_ripple
```

### How the Cascade Executes

The cascade is evaluated **every request**, bottom-up from active through the tier stack:

1. **First, handle invalidations at the top**: Items that were demoted (content changed, file modified) or removed (file unchecked/deleted) are removed from their current tier. This marks those tiers as invalidated (cache miss).

2. **Then, cascade bottom-up**: Starting from active, evaluate each tier in order: active → L3 → L2 → L1. At each tier, if the tier above is invalidated, promote eligible veterans upward (see "Threshold-Aware Promotion"). Promoting items out of a tier changes its content, invalidating it and allowing the cascade to continue.

3. **Stop at stable tiers**: If a tier above is **not** invalidated, no veterans promote through it. The cascade stops, and all higher tiers remain cached.

Example: User checks file F in the picker (adding it to active context):
- F's symbol entry is removed from L1 (invalidating L1), F's full content enters active
- Cascade starts: active → L3 (L3 is not invalidated, but L2 and L1 are)
- Veterans from L2 promote into L1 (L1 was invalidated) → L2 is now invalidated
- Veterans from L3 promote into L2 (L2 was invalidated) → L3 is now invalidated
- Eligible items from active graduate into L3 (L3 was invalidated)
- L0 was never invalidated → nothing moves into L0, L0 stays cached

Note: Ripple detection (active set changed?) governs **history graduation** — whether active history piggybacks into L3. The tier-to-tier veteran cascade is driven by **tier invalidation** and runs regardless of whether the active set rippled.

## Cache Block Structure

Each request sends messages organized as a linear sequence. Anthropic caches everything up to each `cache_control` marker as a prefix, so the order matters — cached tiers come first, active content last.

```
Message 1 (system, cache_control):
  L0: system prompt + legend + L0 symbols + L0 files

Messages 2+ (native user/assistant pairs):
  L0 history (if any), cache_control on last message

Messages N+ (user+assistant, cache_control on last):
  L1: symbols + files as user/assistant pair

Messages N+ (native user/assistant pairs):
  L1 history (if any), cache_control on last message

Messages N+ (user+assistant, cache_control on last):
  L2: symbols + files as user/assistant pair

Messages N+ (native user/assistant pairs):
  L2 history (if any), cache_control on last message

Messages N+ (user+assistant, cache_control on last):
  L3: symbols + files as user/assistant pair

Messages N+ (native user/assistant pairs):
  L3 history (if any), cache_control on last message

Messages N+ (user+assistant, uncached):
  File tree

Messages N+ (user+assistant, uncached):
  URL context (if any)

Messages N+ (user+assistant, uncached):
  Active files

Messages N+ (native user/assistant pairs, uncached):
  Active history

Final message (user):
  Current user prompt
```

Empty tiers are skipped (no messages emitted). Each `cache_control` marker tells Anthropic to cache the entire prefix up to that point.

### History as Native Message Pairs

History messages are **always** sent as native user/assistant message pairs, whether cached or active. They are never flattened into markdown strings inside a wrapper message.

**Why native pairs:**
- The LLM sees real conversation turns, maintaining its assistant persona
- Better comprehension than quoted markdown (the model treats `### Assistant` text differently from an actual assistant message)
- Simpler code — no formatting/unformatting logic needed

**Cache marker placement:** The `cache_control: {"type": "ephemeral"}` marker goes on the **last message** in each tier's sequence. Anthropic caches the entire prefix up to that point, so a single marker on the last L3 history message caches all L0 + L1 + L2 + L3 content preceding it.

**Example — L3 tier with history:**
```json
[
  // ... L0, L1, L2 blocks above ...

  // L3 symbols/files
  {"role": "user", "content": "# Repository Structure (continued)\n..."},
  {"role": "assistant", "content": "Ok."},

  // L3 history (native pairs)
  {"role": "user", "content": "Hi, I have a bug."},
  {"role": "assistant", "content": "What is the error?"},
  {"role": "user", "content": "It is a 404 error."},
  {"role": "assistant", "content": [
    {
      "type": "text",
      "text": "I see. Let's check the routing.",
      "cache_control": {"type": "ephemeral"}
    }
  ]},

  // Active content follows (uncached)
  {"role": "user", "content": "Here are the files:\n..."},
  {"role": "assistant", "content": "Ok."},

  // Active history (native pairs, uncached)
  {"role": "user", "content": "Can you fix the route?"},
  {"role": "assistant", "content": "Sure, here's the edit..."},

  // Current prompt
  {"role": "user", "content": "Now add a test for it."}
]
```

### Cache Breakpoint Budget

Anthropic allows up to 4 `cache_control` breakpoints per request. Each non-empty tier (L0-L3) uses one breakpoint. If a tier has both symbols/files and history, the history's last message carries the breakpoint (since it comes after the symbols/files in the sequence, caching the entire tier as one prefix).

If a tier has symbols/files but no history, the `cache_control` goes on the assistant's "Ok." response after the symbols/files user message.

Blocks under 1024 tokens won't actually be cached by Anthropic (the breakpoint is silently ignored). This is why empty tiers are skipped and the minimum token threshold exists — don't waste a breakpoint on a block too small to cache.

## Symbol Map Exclusion

When a file is in active context (selected by the user), its **full content** is included in the file section. Its symbol map entry is **excluded** from the symbol map tiers to avoid redundancy. The exclusion set is:

```
active_context_files = set(file_paths)
```

Symbol tiers only include entries for files **not** in this set. When a file is added to context, its symbol entry disappears from its cached tier — changing that tier's block content and causing a cache miss (which constitutes a tier invalidation for cascade purposes).

## Demotion

Items demote to active (N = 0) when:

1. **Content changes**: The hash of the item's content differs from the stored hash
2. **Explicit modification**: The item appears in the `files_modified` list (files edited by the assistant)
3. **Symbol invalidation**: When a file is modified, both the file and its `symbol:` entry are marked as modified. The symbol index must be rebuilt for modified files so the symbol block reflects current content.

Demotion removes the item from its cached tier — that tier's block changes on the next request (cache miss), which constitutes a ripple.

## Item Removal

When a file is removed from active context (unchecked in the file picker) or deleted from the project:

- **File entry**: Removed from whatever tier it occupied (active or cached). This changes that tier's content, causing a cache miss (ripple).
- **Symbol entry on file uncheck**: The file's full content is no longer in active context, so its symbol entry is **returned to active** (N = 0) to be included in the symbol map again. It re-enters the normal graduation flow.
- **Symbol entry on file deletion**: Both the file entry and symbol entry are removed entirely. The symbol index no longer contains the file.

Note that unchecking a file is not the same as deleting it — unchecking removes the full file content from context but the file's compact symbol representation returns to the symbol map tiers.

## History Compaction Interaction

When history compaction runs (post-response, via `TopicDetector` + `HistoryCompactor`), many old messages are removed and replaced with a summary message. This invalidates all cached history entries:

1. **Purge all `history:*` entries** from the stability tracker via `remove_by_prefix("history:")`
2. **Re-index**: On the next request, the compacted history (summary + retained messages) appears as new active items with N = 0
3. **Graduation restarts**: The compacted messages re-enter the normal active → L3 → L2 → L1 flow from scratch

Only `history:*` entries are purged. The system prompt and legend in L0 are not history items — they remain in L0 undisturbed. However, any tier that contained graduated history entries will have its content change (the history is gone), causing a cache miss for that tier.

This means compaction causes a one-time cache miss for tiers that contained history. This is unavoidable — the old messages no longer exist, so their cached content is invalid. The cost is temporary; the new (smaller) history re-stabilizes within a few requests.

Compaction runs **after** the response is delivered to the user, so the cache miss doesn't affect the current request — only subsequent ones.

## Initialization from Reference Graph Clustering

On startup (and every restart), the tracker initializes tier assignments from the cross-file reference graph. **There is no persistence** — stability data is rebuilt fresh each session.

### Why No Persistence

Persisting stability data across sessions causes stale state problems — files accumulate high N values and reach L0 in one session, then remain there even when the project focus shifts. A fresh start each session is simpler and more predictable: tiers rebuild from the reference graph in 1-2 requests, and the graph already encodes the structural relationships that matter.

### Data Source

The `ReferenceIndex` in `references.py` provides two directed graphs:
- `_file_deps[A]` — set of files that A references (A uses symbols from these files)
- `_file_refs[A]` — set of files that reference A (these files use symbols from A)

These capture all cross-file symbol usage: function calls, class inheritance, variable references, type annotations. This is broader than a strict call graph, which is desirable — it captures the coupling that determines whether editing one file invalidates another's symbol block.

### Clustering Algorithm

#### Step 1: Build Mutual Reference Graph

Extract **bidirectional edges only** — pairs where A references B **and** B references A. One-way references (e.g., many files import `models.py` but `models.py` imports nothing) are excluded from clustering edges.

Why bidirectional only: Transitive closure over all reference edges creates one giant component in most codebases. A utility file like `models.py` is referenced by 15+ files, connecting them all transitively. Bidirectional edges identify **mutual coupling** — files that are tightly interdependent and likely to be edited together. Files like `models.py` that are widely imported but import nothing back remain isolated, which is correct — editing `models.py` should invalidate its own tier, not drag half the codebase with it.

Example bidirectional pairs in this repo:
- `streaming.py` ↔ `context_builder.py` (mutual imports)
- `stability_tracker.py` ↔ `context_builder.py` (mutual imports)
- `fetcher.py` ↔ `cache.py` (mutual references within url_handler)

Example one-way (excluded from edges):
- `models.py` ← many files (widely imported, imports nothing back)
- `extensions.py` ← several files (utility, no back-references)

#### Step 2: Find Connected Components

Build connected components from the bidirectional edge graph. Each component is a cluster of mutually coupled files.

This naturally produces:
- **Language separation**: JS and Python never have bidirectional references, so they form separate clusters.
- **Subsystem separation**: Within Python, `url_handler/*.py` forms its own cluster separate from `llm/*.py` because they don't mutually reference each other.
- **Reasonable cluster sizes**: Without transitive one-way edges, clusters stay small (typically 2-6 files). Isolated files (no bidirectional edges) form singleton clusters.

#### Step 3: Distribute Clusters Across L1, L2, L3

Estimate tokens for each cluster (sum of symbol block tokens for all files in the cluster). Sort clusters by token count descending.

Use **greedy bin-packing**: assign each cluster to the tier (L1, L2, or L3) with the fewest tokens so far. This keeps the three tiers approximately balanced.

The key constraint is that **each cluster stays together in one tier**. When you edit a file in one cluster, only that cluster's tier invalidates. The other two tiers remain cached.

#### Step 4: Respect Minimum Tokens

Each tier must meet `cache_target_tokens` from config (default: `cacheMinTokens × cacheBufferMultiplier`). If total symbol content is insufficient to fill all three tiers above the minimum:

- Fill fewer tiers, preferring L1 first, then L2, then L3
- An empty tier is better than a tier below the provider's cache minimum (e.g., 1024 tokens for Anthropic)
- If all content fits in one tier, put it all in L1

### What This Achieves

- **Locality of invalidation**: Working on one subsystem invalidates only that subsystem's cache tier. The other tiers remain cached.
- **Language separation**: JS and Python code naturally land in different tiers since they never have bidirectional references.
- **Subsystem separation**: Within a language, loosely coupled subsystems (e.g., url_handler vs llm) land in different tiers.
- **Even cache utilization**: Balanced token distribution means each cache block is a similar size, maximizing cache hit efficiency.
- **Utility file isolation**: Widely-imported files like `models.py` form singleton clusters and are distributed independently, so editing them doesn't cascade.

### Constraints

- **L0 is never assigned by clustering** — the clustering algorithm distributes content across L1, L2, and L3 only. L0 contains fixed content (system prompt, legend) from the start, and additional content must be earned through ripple promotion during the session.
- **Files in active context are excluded** — they have full content included separately.
- **Symbol entries only** — initialization assigns `symbol:` prefixed entries. File entries start in active and graduate through the normal stability flow.

## Configuration

In `litellm.json`:

| Key | Default | Description |
|-----|---------|-------------|
| `cacheMinTokens` | 1024 | Minimum tokens for a cache block (provider requirement) |
| `cacheBufferMultiplier` | 1.5 | Safety margin multiplier for cache threshold |

The effective `cache_target_tokens = cacheMinTokens × cacheBufferMultiplier`.

Setting `cacheMinTokens` to 0 disables threshold-aware behavior — all promotions happen without token gating, and history never graduates (stays active).

## Order of Operations

Each request processes stability updates in this sequence:

1. **Detect demotions**: Check content hashes for all tracked items. Items with hash mismatches or in the `files_modified` list reset to N = 0 and return to active. Their former tiers are marked as invalidated.

2. **Handle removals**: Files unchecked from the picker or deleted have their entries removed from their current tier (invalidating it). For unchecked files, the symbol entry returns to active (N = 0). For deleted files, both file and symbol entries are removed entirely.

3. **Rebuild symbol index**: Modified files have their symbol blocks rebuilt so the symbol map reflects current content.

4. **Compute current active set**: Determine which files, symbols, and history messages are in active context.

5. **Graduate eligible files/symbols**: Files and symbols with N ≥ 3 are removed from active and placed into L3.

6. **Detect ripple**: Compare current active file/symbol set against last request's set. If different, a ripple exists.

7. **Graduate eligible history**: If a ripple exists or the token threshold is met, eligible active history messages graduate to L3.

8. **Run cascade bottom-up**: Starting from active, evaluate each tier using the per-tier promotion algorithm (see "Threshold-Aware Promotion"). The algorithm merges incoming items with veterans, applies N++ to eligible items (those past the token minimum), and promotes items whose N exceeds the promotion threshold into the tier above (if invalidated). N increments happen **inside** this algorithm — there is no separate global N++ step.

9. **Store current active set**: Save for ripple detection on the next request.

## No Persistence

Stability data is **not persisted** across sessions. On each application startup, the tracker begins empty and initializes from the reference graph (see "Initialization from Reference Graph Clustering" above).

Within a session, the tracker maintains in-memory state:
- `response_count`: Total responses this session
- `last_active_items`: Items in active on the last request
- `items`: Map of item key → `{content_hash, n_value, tier}`

On startup, `_last_active_file_symbol_items` in `llm.py` is empty, so the first request with files selected detects a ripple (empty ≠ current files). Tiers rebuild from the reference graph within 1-2 requests.
