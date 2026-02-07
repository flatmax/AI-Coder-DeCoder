# Cache Optimization Plan

## Status: IN PROGRESS

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
same ripple promotion system as files and symbol entries. Each message is
registered as a tracked item (e.g., `history:0`, `history:1`, ...) and
participates in the same tier promotion as everything else.

**Key design: Controlled ripple to avoid per-request cache churn**

Naively registering all history messages as active items causes a ripple event
on every single request — each new exchange adds a message that increments N
and enters L3 after 3 rounds, triggering veteran N++ cascades constantly. This
churns cache tiers every request, defeating the purpose of caching.

The solution uses two mechanisms to control when history graduates from active
into the tier system:

1. **Token threshold gate**: History messages stay in active until the total
   active history tokens exceed `cache_target_tokens`. Only then do older
   messages graduate to L3, and only enough to bring the active total back
   under threshold. This ensures history only enters the cache system when
   there's enough content to justify a cache block.

2. **Opportunistic piggybacking**: When a file or symbol entry is already
   entering L3 (causing a ripple anyway), eligible history messages (N >= 3)
   are included in the same batch at zero additional cache cost — the tier
   block is being rewritten regardless.

**How it works**:

1. Each message is a tracked item with a content hash (hash of role + content).
2. All history messages are in the active items list every round, accumulating
   N via the normal "veteran in active, not edited" path.
3. History messages do NOT automatically enter L3 when they reach N=3. Instead,
   they remain in active until one of these conditions triggers graduation:
   
   a. **Piggyback**: A file or symbol entry is entering L3 this round (ripple
      is already happening). All history messages with N >= 3 are included in
      the same L3 entry batch.
   
   b. **Token threshold**: No file/symbol ripple is happening, but the total
      tokens of active history messages with N >= 3 exceeds
      `cache_target_tokens`. The oldest eligible messages graduate to L3,
      keeping the most recent `cache_target_tokens` worth of eligible messages
      in active.
   
   c. **Neither condition met**: All history stays active. No ripple. N keeps
      incrementing for next round's check.

4. Once in L3, history messages promote through L3 → L2 → L1 → L0 via normal
   ripple promotion. Since history content never changes, they only ever
   promote — never demote.

5. In `_build_streaming_messages`, history messages are placed into their
   assigned tier block alongside symbols and files for that tier. Only messages
   still in active are sent as raw user/assistant pairs.

**Why this works well**:

- **Short conversations**: All history stays active, zero ripple overhead.
- **Long quiet conversations** (stable files): History accumulates until token
  threshold is met, then graduates in a batch — one ripple event.
- **Active file editing**: Files entering/leaving context cause ripples anyway;
  history piggybacks for free.
- **Steady state**: After initial graduation, older messages sit stably in
  higher tiers. Only the recent active window changes between requests.
- History is append-only — content never changes, so items only ever promote.
  Oldest messages reach L0 first, which is correct.

**Message ordering within tiers**: Within each tier block, history messages
appear after symbols and files. This keeps the existing content ordering
(symbols → files → history) consistent and readable.

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
currently in `self.conversation_history` are in the active items list. The
graduation logic (token threshold gate + opportunistic piggybacking) controls
when they actually leave active and enter L3.

## Design Details

### Controlled ripple: graduation logic

The graduation logic is implemented in `_update_cache_stability` in
`streaming.py`. After the normal stability tracker update (which handles
files and symbol entries), a separate pass determines which history messages
should graduate from active to L3:

```python
# Phase 1: Normal update - files and symbols enter/leave active as usual
#           History messages are always in active items list, accumulating N
#           but NOT automatically entering L3

# Phase 2: Determine if history should graduate this round
items_entering_l3 = [items that left active from phase 1]  # files/symbols only

eligible_history = [
    f"history:{i}" for i in range(len(history))
    if stability.get_n_value(f"history:{i}") >= 3
    and stability.get_tier(f"history:{i}") == 'active'
]

if items_entering_l3:
    # Piggyback: ripple already happening, include all eligible history
    items_entering_l3 += eligible_history

elif eligible_history:
    # Check token threshold for standalone graduation
    eligible_tokens = sum(get_tokens(item) for item in eligible_history)
    if eligible_tokens >= cache_target_tokens:
        # Graduate oldest, keeping recent cache_target_tokens in active
        # Sort eligible by index ascending (oldest first)
        graduated, kept = split_by_token_budget(eligible_history, cache_target_tokens)
        items_entering_l3 += graduated

# Phase 3: Process L3 entries (ripple promotion as normal)
```

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

History can grow large. The graduation logic uses `cache_target_tokens` as
the gate — history only enters the tier system when there's enough accumulated
to justify a cache block. Once in the tier system, the existing threshold-aware
promotion mechanism ensures tiers meet cache minimums before promoting veterans.

### Compaction interaction

The history compactor runs post-response (`_run_post_response_compaction`).
After compaction completes:

1. The compacted messages replace `self.conversation_history`.
2. All `history:*` entries are purged from the stability tracker.
3. New `history:*` entries are registered for the compacted messages.
4. On the next request, compacted history enters active and promotes normally.

The frontend receives a `compaction_complete` event with the new messages.
No changes needed to the compaction event flow.

### Ripple frequency analysis

With the controlled graduation logic, ripple events from history occur only:

1. **Piggybacking on file/symbol ripple**: Zero additional cost. Frequency
   depends on how often the user changes which files are in context.
   
2. **Standalone token threshold**: Once per ~5-15 exchanges (depending on
   message length and `cache_target_tokens`). A typical exchange is ~200-500
   tokens, so with `cache_target_tokens=1536`, standalone graduation happens
   roughly every 3-8 exchanges.

3. **Never for short conversations**: A 2-3 exchange conversation never
   triggers any history ripple at all.

Compare to naive approach: ripple on every single request after the 3rd
exchange. The controlled approach reduces history-caused ripples by ~5-10x.

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

1. **#1** - Controlled graduation logic for history caching

## Implementation Plan

### What's already done

The following infrastructure is already implemented and working:

- ✅ **`ac/context/stability_tracker.py`** — `remove_by_prefix(prefix)` method
  exists, removes all items matching a prefix (e.g., `history:`)
- ✅ **`ac/context/manager.py`** — `clear_history()` calls
  `remove_by_prefix('history:')` on stability tracker.
  `reregister_history_items()` method exists for post-compaction cleanup.
- ✅ **`ac/llm/history_mixin.py`** — `load_session_into_context` calls
  `clear_history()` which purges `history:*` from stability tracker.
- ✅ **`ac/llm/context_builder.py`** — `_build_history_items` exists for
  context breakdown API.
- ✅ **`ac/llm/llm.py`** — `get_context_breakdown` includes history items
  in tier breakdown with per-tier counts.
- ✅ **`ac/llm/streaming.py`** — `_get_history_tiers()`,
  `_format_history_for_cache()`, `_build_tier_cache_block` handles history,
  `_build_streaming_messages` places history into tier blocks,
  `_update_cache_stability` registers history items.

### What remains: controlled graduation logic

Currently all history messages are always included in the active items list
passed to `update_after_response`. This means each message enters L3
individually after N=3, causing a ripple every round in long conversations.

The remaining work adds graduation gating to `_update_cache_stability` in
`streaming.py`:

1. **`ac/llm/streaming.py`** — `_update_cache_stability`: add controlled
   graduation logic. Instead of unconditionally including all history in
   the active items list, determine which should graduate based on:
   - **Opportunistic piggybacking**: if files/symbols are already causing
     a ripple (items leaving active), include all eligible history (N >= 3)
     in the same batch.
   - **Token threshold gate**: if no file/symbol ripple, but eligible
     history tokens exceed `cache_target_tokens`, graduate oldest eligible
     messages keeping the most recent `cache_target_tokens` worth active.
   - **Otherwise**: all history stays active, no ripple.

   Add `_select_history_to_graduate` helper method: given a list of eligible
   history items sorted by index (oldest first), accumulate tokens from the
   newest end, keep the last `cache_target_tokens` worth in active, return
   the rest as graduated. This ensures the most recent eligible messages
   stay active (they're most likely to be referenced by the LLM) while
   graduating older ones that have accumulated enough tokens to justify a
   cache block.

2. **`ac/llm/llm.py`** — Add `self._last_active_file_symbol_items = set()`
   in `__init__` alongside existing session-level tracking variables
   (e.g., `_session_empty_tier_count`). This tracks which file+symbol items
   were in the active items list last round, used to detect file/symbol
   churn for the piggybacking logic.

3. **Tests**: Add tests for graduation gating behavior:
   - Short conversation: all history stays active, zero ripple
   - Piggyback: file leaving context triggers history graduation
   - Token threshold: standalone graduation when enough tokens accumulate
   - Below threshold: eligible history stays active
   - Mixed: piggyback takes precedence over threshold check
   - Token window: newest eligible messages kept active, oldest graduated
   - Graduation disabled: `cache_target_tokens == 0` means all history
     stays active regardless of N values (original behavior preserved)

### Implementation notes for graduation logic

The graduation logic lives in `_update_cache_stability` in `streaming.py`,
NOT in the stability tracker itself. The tracker is a general-purpose ripple
promotion engine — it processes whatever items list it receives. The policy
decision about *when* history messages should leave the active items list
is the caller's responsibility.

The key change: instead of always including all `history:*` items in the
`active_items` list passed to `update_after_response`, the caller computes
which history messages should remain active and which should be omitted
(allowing them to "leave active" and enter L3 via the normal mechanism).

**Initialization** in `LiteLLM.__init__` (in `llm.py`):

```python
# Session-level tracking for file/symbol churn detection
self._last_active_file_symbol_items = set()
```

**Graduation logic** in `_update_cache_stability` (in `streaming.py`):

```python
# 1. Determine if files/symbols are causing a ripple this round
#    (compare current file_paths + symbol entries vs last round)
file_symbol_items = set(file_paths or []) | {f"symbol:{f}" for f in (file_paths or [])}
has_file_symbol_ripple = bool(self._last_active_file_symbol_items - file_symbol_items)
self._last_active_file_symbol_items = file_symbol_items

# 2. Get cache target tokens; skip graduation if disabled (0)
cache_target = stability.get_cache_target_tokens()

# 3. Decide which history messages stay active vs graduate
all_history = [f"history:{i}" for i in range(len(history))]

if not cache_target:
    # Graduation disabled — all history stays active (original behavior)
    active_history = all_history
else:
    eligible = [h for h in all_history
                if stability.get_n_value(h) >= 3
                and stability.get_tier(h) == 'active']

    if has_file_symbol_ripple and eligible:
        # Piggyback: ripple already happening, graduate all eligible history
        active_history = [h for h in all_history if h not in eligible]

    elif eligible:
        # Check token threshold for standalone graduation
        eligible_tokens = sum(get_item_tokens(item) for item in eligible)
        if eligible_tokens >= cache_target:
            # Graduate oldest, keeping recent cache_target worth in active
            graduated = self._select_history_to_graduate(
                eligible, get_item_tokens, cache_target
            )
            active_history = [h for h in all_history if h not in graduated]
        else:
            active_history = all_history  # Not enough tokens, keep all active
    else:
        active_history = all_history  # Nothing eligible yet

# 4. Build final active items list
active_items = list(file_symbol_items) + active_history
stability.update_after_response(items=active_items, ...)
```

**`_select_history_to_graduate` helper** (in `streaming.py`):

```python
def _select_history_to_graduate(self, eligible, get_tokens, keep_tokens):
    """Select which eligible history messages to graduate.

    Keeps the most recent `keep_tokens` worth of eligible messages in
    active. Graduates the rest (older messages).

    Args:
        eligible: History item keys sorted by index ascending (oldest first)
        get_tokens: Callable to get token count for an item
        keep_tokens: Token budget to keep in active

    Returns:
        Set of items to graduate (exclude from active_items)
    """
    # Walk from newest to oldest, accumulating a "keep" budget
    kept_tokens = 0
    keep_set = set()
    for item in reversed(eligible):
        item_tokens = get_tokens(item)
        if kept_tokens + item_tokens <= keep_tokens:
            kept_tokens += item_tokens
            keep_set.add(item)
        else:
            break  # Budget exhausted, graduate the rest
    return set(eligible) - keep_set
```

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
- **Per-request ripple churn from history**: Solved by token threshold gate
  and opportunistic piggybacking. History only graduates when there's enough
  tokens to justify a cache block OR when a file/symbol ripple is already
  happening. See "Controlled ripple" section for details.
- **Graduation threshold value**: Reuses `cache_target_tokens` (default 1536)
  rather than introducing a separate config value. This is consistent with the
  existing threshold-aware promotion mechanism and avoids config proliferation.
- **Token-based vs count-based active window**: Token-based. When graduating
  standalone (no piggyback), keep the most recent `cache_target_tokens` worth
  of eligible messages in active. Graduate the rest. This handles variable
  message sizes correctly.

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
