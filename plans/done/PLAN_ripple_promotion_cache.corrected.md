# Plan: Ripple Promotion Cache Policy (Corrected)

## Overview

This document describes the "ripple promotion" cache policy implemented in `ac/context/stability_tracker.py`. The policy manages which files get cached at different tiers (L0-L3) based on usage stability.

## Core Concepts

### Tiers

Files progress through cache tiers based on stability:
- **Active (N=0)**: Files currently in context, not cached
- **L3 (N≥3)**: Entry-level cache tier
- **L2 (N≥6)**: Moderately stable
- **L1 (N≥9)**: Very stable
- **L0 (N≥12)**: Most stable, cached first (terminal tier)

### Terminology

- **Veteran**: An item already in a tier before the current update cycle
- **Direct Entry**: An item entering a tier this cycle (from Active or via promotion)
- **N value**: Stability counter that determines tier placement

## How It Works

### Phase 1: Active Context Updates

Each response cycle:
1. New items in Active context start with N=0
2. **Veterans in Active** (items in Active that weren't edited) get N++
3. Items marked as modified reset to N=0

### Phase 2: Tier Entry Processing

Items enter cache tiers in two ways:
1. **Leaving Active**: Items no longer in the Active context list enter L3 with N=3
2. **Threshold reached**: Veterans in Active that reach N≥3 enter L3

When items enter a tier:
1. Direct entries get the tier's `entry_n` value (L3=3, L2=6, L1=9, L0=12)
2. **Veterans in that tier** (items already there before this cycle) get N++ once
3. If any veteran reaches the tier's promotion threshold, they promote to the next tier
4. Promoted items become direct entries for the next tier, triggering ripple there
5. If no veterans promote, higher tiers remain unchanged (ripple stops)

### Key Behavior: Veterans Get N++ Once Per Cycle

When multiple items enter a tier in the same cycle:
- Veterans get N++ **once per cycle**, not once per entering item
- The entering items themselves are not veterans (they just arrived)
- This prevents runaway N inflation

## Configuration

```python
TIER_CONFIG = {
    'L3': {'entry_n': 3, 'promotion_threshold': 6},
    'L2': {'entry_n': 6, 'promotion_threshold': 9},
    'L1': {'entry_n': 9, 'promotion_threshold': 12},
    'L0': {'entry_n': 12, 'promotion_threshold': None},  # Terminal tier
}
```

## Example Scenarios

### Scenario 1: Basic Flow

```
Round 1: User adds files A, B, C to context
         Active: {A(N=0), B(N=0), C(N=0)}

Round 2: User only references A (B, C leave Active)
         - A is veteran in Active, not edited → A gets N++ → A(N=1)
         - B, C leave Active → enter L3 with N=3
         - B, C are direct entries (not veterans), so N stays at 3
         Active: {A(N=1)}
         L3: {B(N=3), C(N=3)}

Round 3: User references A, model edits B
         - A is veteran in Active → A(N=2)
         - B modified → returns to Active with N=0
         - C stays in L3, no entries this round → C(N=3) unchanged
         Active: {A(N=2), B(N=0)}
         L3: {C(N=3)}
```

### Scenario 2: Cascade Promotion

```
Starting state (manually set up):
  L3: {l3_item(N=5)}      # One away from promotion threshold (6)
  L2: {l2_item(N=8)}      # One away from promotion threshold (9)
  L1: {l1_item(N=11)}     # One away from promotion threshold (12)
  Active: {trigger}

Round: trigger leaves Active, enters L3
  1. trigger enters L3 with N=3
  2. l3_item is veteran in L3 → N++ → l3_item(N=6)
  3. l3_item(N=6) ≥ 6 → promotes to L2
  4. l3_item enters L2 with N=6
  5. l2_item is veteran in L2 → N++ → l2_item(N=9)
  6. l2_item(N=9) ≥ 9 → promotes to L1
  7. l2_item enters L1 with N=9
  8. l1_item is veteran in L1 → N++ → l1_item(N=12)
  9. l1_item(N=12) ≥ 12 → promotes to L0
  10. l1_item enters L0 with N=12
  11. No veterans in L0 → cascade stops

Final state:
  L3: {trigger(N=3)}
  L2: {l3_item(N=6)}
  L1: {l2_item(N=9)}
  L0: {l1_item(N=12)}
```

### Scenario 3: Multiple Items Entering Same Tier

```
Starting state:
  L3: {existing(N=3)}
  Active: {new1, new2}

Round: new1 and new2 both leave Active
  - Both enter L3 with N=3
  - existing is the only veteran in L3
  - Veterans get N++ once per cycle (not twice)
  - existing(N=3) → existing(N=4)

Final state:
  L3: {existing(N=4), new1(N=3), new2(N=3)}
```

## Initialization: Heuristic Placement

On fresh start (no persistence file), files are distributed across tiers based on reference counts from the symbol index:

```python
def initialize_from_refs(files_with_refs, exclude_active):
    # Sort by ref count descending
    # Top 20% by refs → L1 (N=9) - core/central files
    # Next 30% → L2 (N=6) - moderately referenced
    # Bottom 50% → L3 (N=3) - leaf files, tests, utilities
    # L0 is never assigned heuristically - must be earned
```

This ensures structurally important files start in higher tiers while still requiring them to demonstrate stability to reach L0.

## Demotion

Modified files are demoted regardless of their current tier:
- File in any cache tier (L0-L3) that gets modified → returns to Active with N=0
- This is tracked via content hash comparison or explicit `modified` parameter

## Implementation Details

### Key Methods

- `update_after_response()`: Main entry point, handles all tier transitions
- `_process_tier_entries()`: Processes ripple promotion through tiers
- `initialize_from_refs()`: Heuristic placement on fresh start

### Persistence

State is saved to JSON after each update:
- Each item's tier, N value, and content hash
- Response count and last active items set
- Supports migration from older format (stable_count → n_value)

## Status: COMPLETE

All implementation work is done. Operational monitoring for threshold tuning is ongoing.
