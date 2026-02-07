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
4. **Item reaches N ≥ 3**: Eligible for graduation from active to L3

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

### History Messages

History graduation is **controlled** to avoid unnecessary cache churn. Unlike files, graduating history changes the content of a cached tier block, which invalidates that block for the current request. History graduates only when:

1. **Piggybacking on an existing ripple**: If files or symbols are already changing the active set (file selection changed, file/symbol graduation happening), eligible history graduates for free — the cache blocks are already being invalidated.

2. **Token threshold met**: If total eligible history tokens exceed `cache_target_tokens`, the oldest eligible messages graduate. This ensures the resulting cache block meets provider minimums (e.g., 1024 tokens for Anthropic).

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

A ripple is detected when the set of active file/symbol items changes between requests:

```
has_file_symbol_ripple = (last_active_items != current_active_items)
```

This fires on any change — adding a file, removing a file, swapping files, or files/symbols graduating out of active. File graduation itself counts as a ripple, allowing history to piggyback.

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

## Initialization from References

On first run (no stability data), the tracker initializes tier assignments heuristically from reference counts (`←refs` in the symbol map):

- **With threshold-aware mode** (`cache_target_tokens > 0`): Fill tiers top-down (L1 → L2 → L3) until each meets the token target. Most-referenced files go to L1.
- **Without threshold mode** (legacy): Top 20% by refs → L1, next 30% → L2, bottom 50% → L3.

L0 is never assigned heuristically — it must be earned through stability. Files in active context are excluded from initialization.

## Configuration

In `litellm.json`:

| Key | Default | Description |
|-----|---------|-------------|
| `cacheMinTokens` | 1024 | Minimum tokens for a cache block (provider requirement) |
| `cacheBufferMultiplier` | 1.5 | Safety margin multiplier for cache threshold |

The effective `cache_target_tokens = cacheMinTokens × cacheBufferMultiplier`.

Setting `cacheMinTokens` to 0 disables threshold-aware behavior — all promotions happen without token gating, and history never graduates (stays active).

## Persistence

Stability data is persisted to `.aicoder/stability.json` in the repository root. The file stores:
- `response_count`: Total responses tracked
- `last_active_items`: Items in active on the last request
- `items`: Map of item key → `{content_hash, n_value, tier}`

Data survives restarts. On restart, `_last_active_file_symbol_items` in `llm.py` resets to empty set, so the first request with files selected detects a ripple (empty ≠ current files).
