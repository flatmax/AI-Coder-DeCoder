# Cache Optimization Plan

## Status: DISCUSSION

## Problem

The LLM prompt caching system works but has several inefficiencies that reduce
cache hit rates and waste tokens. This plan addresses targeted improvements
that work *with* the existing ripple promotion architecture.

## Current Architecture

- **Prefix-based caching**: Anthropic/Bedrock cache the conversation prefix up to
  each breakpoint. Changing an early block invalidates all later blocks' caches.
- **Stability Tracker** with ripple promotion assigns items to tiers: L0 (most
  stable) → L3 → active. Items naturally migrate upward as they prove stable.
- **Up to 4 cache breakpoints** placed on L0, L1, L2, L3 tier blocks.
- **Message structure**:
  ```
  [System: system prompt + legend + L0 symbols + L0 files] ← breakpoint
  [User: L1 symbols + L1 files] ← breakpoint, [Asst: "Ok."]
  [User: L2 symbols + L2 files] ← breakpoint, [Asst: "Ok."]
  [User: L3 symbols + L3 files] ← breakpoint, [Asst: "Ok."]
  [User: file tree] [Asst: "Ok."]
  [User: URL context] [Asst: "Ok."]
  [User: active files] [Asst: "Ok."]
  [history messages...]
  [User: prompt]
  ```
- Design principle: most stable content at the front (prefix), most volatile at
  the back. Changes to later content don't invalidate earlier cache blocks.

## Confirmed Improvements

### 1. Cache history messages via ripple promotion (HIGH impact, MEDIUM effort)

**Problem**: Conversation history is entirely uncached. After a few exchanges it
becomes the most token-expensive part of the prompt. Between consecutive requests,
all messages except the last exchange are identical — yet none cache-hit.

**Current behavior**: History messages are dumped raw into the active (uncached)
block. They are not tracked by the stability tracker. Every history token is
re-sent uncached every request.

**Fix**: Track history exchanges as items in the stability tracker, using the
same ripple promotion system as files and symbol entries. Each exchange (user +
assistant message pair) is registered as a tracked item (e.g., `history:0`,
`history:1`, ...) and participates in the same tier promotion as everything else.

**How it works**:

1. Each exchange is a tracked item with a content hash (hash of the combined
   user + assistant message content).
2. New exchanges enter active context (N=0), same as new files.
3. Each subsequent response where the exchange is unchanged, N increments.
4. Exchanges promote through L3 → L2 → L1 → L0 via normal ripple promotion.
5. In `_build_streaming_messages`, history messages are placed into their
   assigned tier block alongside symbols and files for that tier.
6. The last 1-2 exchanges remain in active (they just entered, N is low).
7. Older exchanges naturally migrate to higher tiers over time.

**Why ripple promotion works well for history**:

- History is append-only — content never changes, so items only ever promote.
  This means history exchanges are ideal cache candidates: once written, they
  are maximally stable.
- Oldest exchanges reach L0 first, which is correct — they are the most stable
  content in the entire prompt.
- No special-case logic needed. The existing maturity model handles it.
- History messages are interleaved with symbols and files in their respective
  tier blocks, which is fine — the LLM doesn't care about content ordering
  within a cache block, only that the prefix is stable.

**Message ordering within tiers**: Within each tier block, history messages
should appear after symbols and files for that tier. This keeps the existing
content ordering (symbols → files → history) consistent and readable.

**Lifecycle events**:

History has lifecycle events that files and symbols don't. Each must correctly
update the stability tracker:

- **History clear**: When the user clears history (`clear_history()`), all
  `history:*` entries must be removed from the stability tracker. This causes
  cache invalidation for any tier that contained history entries, which is
  correct — that content is gone.

- **History compaction**: When old messages are summarized by the compactor,
  the original `history:N` entries are replaced. Implementation:
  1. Remove all `history:*` entries from the stability tracker.
  2. Register the compacted messages as new `history:*` entries starting from
     index 0.
  3. These new entries enter at active (N=0) and promote normally.
  This means compaction causes a one-time cache miss (compacted content is
  new), after which the compacted messages quickly re-promote. This is correct
  behavior — the content genuinely changed.

- **Session load**: When the user loads a previous session, all current
  `history:*` entries are removed and replaced with the loaded session's
  messages. Same as compaction — remove old entries, register new ones at
  active, let them promote naturally.

**Item naming convention**: History messages are tracked as `history:N` where
N is the message index (0-based) into `self.conversation_history`. Each message
is its own tracked item — no exchange pairing logic. This handles edge cases
cleanly: compaction summaries (standalone assistant messages), cancelled
responses (user message without assistant reply), and arbitrary session loads.

**Content hashing**: The hash for a history message is computed from the
concatenation of the message role and content (e.g., `f"{role}:{content}"`).

**Registration timing**: History items are registered in
`_update_cache_stability` alongside files and symbol entries. All messages
currently in `self.conversation_history` are the "active items" for history,
analogous to `file_paths` for files.

## Design Details

### Interaction with existing tier blocks

Currently each tier block contains: symbols + files. With this change, each
tier block contains: symbols + files + history messages. The block structure
becomes:

```
[System: system prompt + legend + L0 symbols + L0 files + L0 history] ← breakpoint
[User: L1 symbols + L1 files + L1 history] ← breakpoint, [Asst: "Ok."]
[User: L2 symbols + L2 files + L2 history] ← breakpoint, [Asst: "Ok."]
[User: L3 symbols + L3 files + L3 history] ← breakpoint, [Asst: "Ok."]
[User: file tree] [Asst: "Ok."]
[User: URL context] [Asst: "Ok."]
[User: active files] [Asst: "Ok."]
[active history messages...]
[User: prompt]
```

Note: History messages in cached tiers are formatted as quoted content within
the tier block (not as separate user/assistant message pairs, since they must
be inside the cached user message). Active history messages retain their
original user/assistant structure.

### Formatting cached history

History messages in cached tiers cannot be injected as raw user/assistant
message pairs (that would break the single-user-message cache block structure).
Instead, they are formatted as quoted content:

```
## Conversation History (L1)

### User
<content>

### Assistant
<content>

---

### User
<content>

### Assistant
<content>
```

Active history messages keep their original user/assistant message structure
(they're outside cached blocks, so no formatting constraint).

### Token budget awareness

History can grow large. The stability tracker's existing `cache_target_tokens`
mechanism naturally handles this — tiers fill to meet cache minimums before
promoting items. No special token budgeting needed for history.

### Compaction interaction

The history compactor runs post-response (`_run_post_response_compaction`).
After compaction completes:

1. The compacted messages replace `self.conversation_history`.
2. All `history:*` entries are purged from the stability tracker.
3. New `history:*` entries are registered for the compacted messages.
4. On the next request, compacted history enters active and promotes normally.

The frontend receives a `compaction_complete` event with the new messages.
No changes needed to the compaction event flow.

## Rejected Ideas

### Separate system prompt into its own cached block

System prompt is ~1.3k tokens — barely above Anthropic's cache minimum. Dedicating
a breakpoint to it is not worthwhile. The system prompt is already at the very
start of the L0 block, so it benefits from prefix caching automatically (changing
L0 content invalidates L0's cache, but the system prompt portion would still be
part of the cache-hit prefix if only later content in L0 changes — though in
practice Anthropic caches the entire block or nothing).

### Keep symbol entries for active context files in the map

If the full file has changed but the cached symbol entry shows old signatures,
the LLM sees contradictory information. This is worse than tier churn. The
current exclusion behavior is correct.

### Restore symbol entries to previous tier on context exit

When a file leaves active context, its symbol entry re-enters at L3 via normal
ripple promotion. Initially considered "suspending" the entry and restoring it
to its previous tier to avoid L3 churn.

Rejected because this fights the maturity model's core principle: items earn
their tier by proving stability. The L3 churn is by design — L3 is the most
volatile tier, positioned last in the prefix, so its cache invalidation doesn't
affect L0/L1/L2. The cost is one L3 cache miss per re-entry, which is minimal.
The ripple system handles this correctly already.

### Merge small tier blocks into adjacent tiers

Merging changes the tier boundaries, which invalidates cache blocks. If L1 is
merged into L2 one request, then L1 fills up and un-merges the next request, both
L1 and L2 caches are invalidated. This works against the stability principle that
the ripple promotion system is built on. The existing `cache_target_tokens`
threshold-aware promotion (when enabled) already prevents premature promotion
of items from small tiers, which is the right approach.

### Reduce "Ok." padding messages

These "Ok." messages are inside cached blocks. Once cached, they cost nothing
extra. Removing them would change the block content, invalidating caches for
zero ongoing benefit. Not worth the disruption.

## Implementation Order

1. **#1** - Cache old history with spare breakpoints (high-value, moderate scope)

## Implementation Plan

### Files to modify

1. **`ac/llm/streaming.py`** — `_build_streaming_messages`: place history
   messages into tier blocks based on stability tracker assignment.
   `_update_cache_stability`: register history exchanges as tracked items.
   `_build_tier_cache_block`: include history content in tier blocks.
   `_format_history_for_cache`: new method to format history exchanges as
   quoted content for inclusion in cached blocks.

2. **`ac/context/stability_tracker.py`** — Add `remove_by_prefix(prefix)`
   method to remove all items matching a prefix (e.g., `history:`). Used by
   history clear, compaction, and session load.

3. **`ac/context/manager.py`** — `clear_history`: also call
   `remove_by_prefix('history:')` on stability tracker. Add method to
   re-register history after compaction.

4. **`ac/llm/llm.py`** — `clear_history`: ensure stability tracker
   `remove_by_prefix('history:')`. `get_context_breakdown`: include history
   items in tier breakdown.

5. **`ac/llm/context_builder.py`** — `_build_file_items` / `_build_symbol_items`:
   add parallel `_build_history_items` for context breakdown API.

### Migration

Existing `cache_stability.json` files contain no `history:*` entries. No
migration needed — history items will be registered on the next request and
promote naturally from there.

## Resolved Questions

- **Compaction summary tracking**: The compacted messages (summary + retained
  verbatim) are tracked as `history:0`, `history:1`, etc. — same as normal
  messages. No special handling needed.
- **Section header for cached history**: Use "Conversation History" with the
  tier name in parentheses, e.g., `## Conversation History (L1)`.
- **URL context in ripple promotion**: Out of scope for this plan. URLs could
  benefit from the same approach but that's a future enhancement.

## UI Changes

### Cache Viewer (`CacheViewerTemplate.js`)

The cache viewer already renders content groups per tier (symbols, files, URLs).
History items need to appear in tier blocks alongside existing content:

- Add a `"history"` content type to tier blocks returned by
  `get_context_breakdown()`. Each history entry includes: exchange index,
  preview of user message (truncated), token count, and stability info
  (N value, progress toward next tier).
- Add `renderHistoryItem(component, item, tier)` renderer in the template,
  showing a chat bubble icon, truncated user message preview, token count,
  and stability progress bar (same as files/symbols).
- History items in cached tiers show a lock icon indicating they're cached.
  History items in active tier show no lock (same pattern as files).
- The existing `renderHistoryGroup` (which shows aggregate history stats in
  the active block) remains for the active tier. Cached tiers use the
  per-item renderer instead.

### Context Viewer (`ContextViewerTemplate.js`)

The context viewer shows a category-level breakdown. Changes:

- The "History" category row now shows tier distribution alongside token count,
  e.g., "History (8 messages) — 2 L1, 3 L2, 1 L3, 2 active".
- When expanded, history items are grouped by tier with the same styling as
  the file items (tier badge, token count, stability progress).
- Each history item shows: exchange number, truncated user message preview,
  role indicators (user/assistant), and token count.

### HUD (`HudTemplate.js`)

The streaming HUD's tier breakdown already shows counts per content type. The
`tier_info` dict gains a `history` count per tier (alongside `symbols` and
`files`). The HUD template renders this as e.g., "12 symbols + 2 files +
3 history" in each tier's content description.

### No changes needed

- **HistoryBarTemplate**: Already shows aggregate history token usage. No
  per-tier detail needed here (it's a compact summary bar).
- **StreamingMixin HUD data**: The `_showHud` method passes through tier info
  which will naturally include history counts once the backend populates them.
