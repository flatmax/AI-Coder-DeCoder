# Plan: Cache Threshold Management

## Status: READY

## Problem

Anthropic requires a minimum of 1024 tokens per cache block. Our current per-tier cache markers result in small tiers (L1: 904, L2: 802, L3: 223 tokens) being ignored by the cache system, wasting the cache_control markers and paying full price for those tokens.

## Solution

Integrate minimum cache thresholds directly into the ripple promotion logic. Tiers naturally fill to meet cache minimums before promoting veterans to higher tiers.

## Configuration

Add to `llm.json`:

```json
{
  "model": "...",
  "cacheMinTokens": 1024,
  "cacheBufferMultiplier": 1.5
}
```

- `cacheMinTokens`: Provider's minimum cache block size (1024 for Anthropic)
- `cacheBufferMultiplier`: Safety margin to account for tokenizer variance (1.5 = target 1536 tokens)

## Algorithm: Threshold-Aware Ripple Promotion

### Initialization (Fresh Start)

When no persistence file exists, distribute files based on reference counts and fill tiers to meet cache thresholds:

```
target = cacheMinTokens * cacheBufferMultiplier
tiers = [L0, L1, L2, L3]

1. Sort files by ref count descending (most referenced first)
2. For each tier (L0 → L1 → L2 → L3):
   a. Add files until tier tokens >= target
   b. If no files remain, stop (current tier keeps what it has)
3. Any files remaining after L2 is filled go into L3 (dump the rest)
```

This ensures:
- L0 gets the most-referenced files and meets cache minimum first
- Each tier fills to threshold before moving to the next
- L3 absorbs all remaining files (no minimum requirement for the lowest tier)
- If we run out of files mid-way, that tier keeps whatever it has

### Regular Operation (Per-Response Cycle)

When items enter a tier:

```
target = cacheMinTokens * cacheBufferMultiplier

1. Add entering items to tier with entry_n value
2. accumulated_tokens = sum(entering item tokens)
3. Sort veterans by N ascending (lowest N first)
4. For each veteran in order:
   a. If accumulated_tokens < target:
      - Add veteran's tokens to accumulated_tokens
      - No N++ (veteran is "anchoring" this tier)
   b. Else (threshold met):
      - Veteran gets N++
      - If N >= promotion_threshold: promote to next tier
5. Promoted items become entering items for next tier (ripple continues)
```

### Key Behaviors

1. **Low-N veterans anchor tiers:** Items with lower stability scores fill the cache threshold, keeping tiers appropriately sized
2. **High-N veterans promote out:** Once threshold is met, remaining veterans can progress toward higher tiers
3. **Natural tier sizing:** Tiers grow to meet cache minimums organically through the promotion delay
4. **Eventual promotion:** As new items enter, previously anchoring veterans eventually become post-threshold and can promote

### Example Walkthrough

```
Config: cacheMinTokens=1024, cacheBufferMultiplier=1.5
Target: 1536 tokens

L2 state before update:
  Veterans: [A(N=5, 500tok), B(N=6, 400tok), C(N=7, 300tok), D(N=8, 200tok)]

Item E (400tok) leaves Active, enters L2:

1. E enters with entry_n=6, accumulated=400
2. Sort veterans by N: [A(N=5), B(N=6), C(N=7), D(N=8)]
3. Process A(N=5): accumulated(400) < 1536 → add 500 → accumulated=900, no N++
4. Process B(N=6): accumulated(900) < 1536 → add 400 → accumulated=1300, no N++
5. Process C(N=7): accumulated(1300) < 1536 → add 300 → accumulated=1600, no N++
6. Process D(N=8): accumulated(1600) >= 1536 → threshold met!
   - D gets N++ → D(N=9)
   - N=9 >= promotion_threshold(9) → D promotes to L1

Result:
  L2: [E(N=6), A(N=5), B(N=6), C(N=7)]  # 1600 tokens, meets cache minimum
  L1 receives: D(N=9) as entering item
```

### Edge Cases

**Tier cannot meet threshold:**
- Accept it. Small tiers won't cache efficiently but the system continues to function.
- As more items stabilize, tiers will naturally grow.

**All veterans consumed by filling:**
- No promotions this cycle, which is correct - the tier needs more mass before fragmenting further.

**Large single item exceeds threshold:**
- Item alone meets threshold, all veterans get N++ and can promote normally.

**Initialization: Not enough files to fill all tiers:**
- Fill tiers top-down (L0 first) until files are exhausted
- If a tier is partially filled when files run out, it keeps what it has (even if under threshold)
- Lower tiers remain empty
- This is acceptable - tiers will fill naturally during regular operation as new files enter the system

## Token Counting

LiteLLM provides token counting via `litellm.token_counter()`. This uses:
- `tiktoken` for OpenAI models
- Approximate BPE tokenizers for Anthropic

Token counts are estimates. The `cacheBufferMultiplier` (1.5x) provides safety margin for tokenizer variance between our estimates and the actual provider tokenizer.

## Implementation Changes

### Files to Modify

1. **ac/llm/config.py**
   - Read `cacheMinTokens` and `cacheBufferMultiplier` from config
   - Provide defaults (1024, 1.5)

2. **ac/context/stability_tracker.py**
   - Modify `_process_tier_entries()` to implement threshold-aware promotion
   - Modify `initialize_from_refs()` to respect cache thresholds during initial placement
   - Add token counting integration (pass token counts with items)

3. **ac/llm/streaming.py**
   - Pass token counts when calling stability tracker
   - Ensure cache_control markers align with tier boundaries

4. **llm.json**
   - Add new configuration values

### Interface Changes

The stability tracker will need token information for items:

```python
# Current
def update_after_response(self, items, get_content, modified) -> dict[str, str]:

# New - items now include token counts
def update_after_response(self, items_with_tokens, get_content, modified) -> dict[str, str]:
    # items_with_tokens: list of (item_path, token_count) tuples
```

Or alternatively, pass a token counting function:

```python
def update_after_response(self, items, get_content, get_tokens, modified) -> dict[str, str]:
```

## Testing

1. **Unit tests for threshold-aware promotion:**
   - Verify anchoring behavior (low-N items stay when filling)
   - Verify promotion resumes after threshold met
   - Test with various token distributions

2. **Integration tests:**
   - Verify cache blocks meet minimum sizes
   - Monitor actual cache hit rates

## Rollout

1. Add configuration with defaults matching current behavior
2. Implement threshold-aware initialization
3. Implement threshold-aware promotion
4. Monitor cache efficiency in production
5. Tune `cacheBufferMultiplier` if needed

## Design Decisions

1. **No special logging for undersized tiers** - visibility is already provided through the HUD and web UI cache breakdown
2. **Single provider focus** - this implementation targets Anthropic models only; multi-provider support is a future consideration
3. **Compute tokens on the fly** - token counting is inexpensive; simplicity over optimization
4. **All context entries are token-counted** - the LLM doesn't discriminate between files, symbol map entries, or other content; everything contributing to a cache tier counts toward the threshold
5. **Same multiplier for init and regular operation** - use `cacheBufferMultiplier` consistently; simplicity in first implementation

## Clarifications

### Symbol Map Entry Token Counting

Symbol map entries (prefixed with `symbol:` in the tracker) should have their tokens counted from the **formatted symbol block string**. This is the actual content that will be included in the cache block, computed via `format_file_symbol_block()` in `compact_format.py`.

### Callback Interface for Token Counting

Following the existing pattern of `get_content: Callable[[str], str]`, add a parallel `get_tokens: Callable[[str], int]` callback to `update_after_response()`. The caller in `streaming.py` provides this callback, which:
- For regular files: returns `token_counter.count(file_content)`
- For symbol entries: returns `token_counter.count(formatted_symbol_block)`

### Initialization Token Counting

The `initialize_from_refs()` method can and should be threshold-aware. The caller already has access to:
- `symbols_by_file` - the indexed symbols for each file
- `format_file_symbol_block()` - to generate the formatted content
- `token_counter.count()` - to count tokens

The interface changes to accept token counts alongside ref counts:

```python
def initialize_from_refs(
    self,
    files_with_refs: list[tuple[str, int, int]],  # (path, ref_count, tokens)
    exclude_active: Optional[set[str]] = None,
    target_tokens: int = 1536,  # cacheMinTokens * multiplier
) -> dict[str, str]:
```

This allows initialization to fill tiers top-down (L0 → L1 → L2 → L3) respecting cache thresholds from the very first request.
