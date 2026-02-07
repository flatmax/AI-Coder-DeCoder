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

Each tier maps to a single cached message block sent to the LLM provider. The L0 block always includes the system prompt.

## N Value and Stability Tracking

Every item tracked by the system has an **N value** — a counter that measures how long the item has remained unchanged.

### N Progression

1. **New item appears in active context**: N = 0
2. **Item unchanged in active context**: N increments by 1 each request
3. **Item content changes** (hash mismatch or explicit modification): N resets to 0, demotes to active
4. **Item reaches N ≥ 3**: Eligible for graduation from active to L3 (files and symbols only — history is eligible immediately since it is immutable)

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

History messages are **immutable** — once written to the conversation, their content never changes. Unlike files and symbols, there is no need to wait for N ≥ 3 to confirm stability. Any history message still in the active tier is immediately eligible for graduation.

However, history graduation is **controlled** to avoid unnecessary cache churn. Graduating history changes the content of a cached tier block, which invalidates that block for the current request. History graduates only when:

1. **Piggybacking on an existing ripple**: If files or symbols are already changing the active set (file selection changed, file/symbol graduation happening), all eligible history graduates for free — the cache blocks are already being invalidated.

2. **Token threshold met**: If total eligible history tokens exceed `cache_target_tokens`, the oldest eligible messages graduate even without a ripple. This ensures the resulting cache block meets provider minimums (e.g., 1024 tokens for Anthropic).

3. **Never** (if `cache_target_tokens = 0`): With the default configuration, history stays in active permanently. Set `cacheMinTokens` and `cacheBufferMultiplier` in `litellm.json` to enable.

The `cache_target_tokens` is computed as `cacheMinTokens × cacheBufferMultiplier` (default: 1024 × 1.5 = 1536).

## Ripple Promotion

When items enter a tier, existing items (veterans) in that tier may promote to the next tier. This cascading behavior is called **ripple promotion**.

### How It Works

1. Items entering a tier get that tier's `entry_n` value
2. Veterans (items already in the tier) get N incremented by 1
3. If a veteran's N reaches the tier's `promotion_threshold`, it promotes to the next tier
4. Promoted items become entries for the next tier, potentially triggering further ripples
5. If no veterans promote, higher tiers remain unchanged (ripple stops)

### Threshold-Aware Promotion

When `cache_target_tokens > 0`, promotion is threshold-aware:

1. Accumulate tokens from entering items
2. Sort veterans by N ascending (lowest first)
3. Veterans below the token threshold **anchor** the tier (no N increment) — they fill the cache block to meet provider minimums
4. Veterans past the threshold get N++ and can promote

This ensures each cache block meets the provider's minimum token requirement while still allowing veteran content to progress toward higher tiers.

### Ripple Detection

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

## Cache Block Structure

Each request sends messages organized as:

```
Message 1 (system, cached):
  L0: system prompt + legend + L0 symbols + L0 files + L0 history

Message 2-3 (user+assistant, cached):
  L1: L1 symbols + L1 files + L1 history

Message 4-5 (user+assistant, cached):
  L2: L2 symbols + L2 files + L2 history

Message 6-7 (user+assistant, cached):
  L3: L3 symbols + L3 files + L3 history

Message 8-9 (user+assistant, uncached):
  File tree

Message 10-11 (user+assistant, uncached):
  URL context (if any)

Message 12-13 (user+assistant, uncached):
  Active files

Messages 14+ (alternating user/assistant, uncached):
  Active history (raw conversation turns)

Final message (user):
  Current user prompt
```

Empty tiers are skipped (no messages emitted). The number of cache breakpoints is bounded by the number of non-empty tiers (max 4 for L0-L3).

### History Format in Cached vs Active

- **Cached history** (in tier blocks): Formatted as markdown within the tier's user message:
  ```
  ## Conversation History (L3)

  ### User
  content

  ### Assistant
  content
  ```
  This preserves conversational structure while fitting inside a single cached message block.

- **Active history**: Raw `{"role": "user/assistant", "content": "..."}` message pairs, maintaining full conversational turn structure.

## Symbol Map Exclusion

When a file is in active context (selected by the user), its **full content** is included in the file section. Its symbol map entry is **excluded** from the symbol map tiers to avoid redundancy. The exclusion set is:

```
active_context_files = set(file_paths)
```

Symbol tiers only include entries for files **not** in this set. When a file is added to context, its symbol entry disappears from its cached tier — changing that tier's block content and causing a cache miss (which is also a ripple for piggybacking purposes).

## Demotion

Items demote to active (N = 0) when:

1. **Content changes**: The hash of the item's content differs from the stored hash
2. **Explicit modification**: The item appears in the `files_modified` list (files edited by the assistant)
3. **Symbol invalidation**: When a file is modified, both the file and its `symbol:` entry are marked as modified

Demotion removes the item from its cached tier — that tier's block changes on the next request (cache miss), which constitutes a ripple.

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

- **L0 is never assigned on initialization** — it must be earned through stability (ripple promotion during the session).
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

## No Persistence

Stability data is **not persisted** across sessions. On each application startup, the tracker begins empty and initializes from the reference graph (see "Initialization from Reference Graph Clustering" above).

Within a session, the tracker maintains in-memory state:
- `response_count`: Total responses this session
- `last_active_items`: Items in active on the last request
- `items`: Map of item key → `{content_hash, n_value, tier}`

On startup, `_last_active_file_symbol_items` in `llm.py` is empty, so the first request with files selected detects a ripple (empty ≠ current files). Tiers rebuild from the reference graph within 1-2 requests.
