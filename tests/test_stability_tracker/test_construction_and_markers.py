"""Construction and pin/unpin state.

Extracted from the original monolithic ``test_stability_tracker.py``.
The deletion-marker mechanism was removed by D36 — under
dir-blocks, file removal is handled by tracker stale-removal
on the existing_files set, with the parent directory's
dir-block re-rendering without the missing file.
"""

from __future__ import annotations

from ac_dc.stability_tracker import StabilityTracker, Tier

from .conftest import _active_item


class TestConstruction:
    """Empty state + config accessors."""

    def test_empty_initially(self) -> None:
        """Fresh tracker has no items, no changes, no broken tiers."""
        tracker = StabilityTracker()
        assert tracker.get_all_items() == {}
        assert tracker.get_changes() == []
        for tier in Tier:
            assert tracker.get_tier_items(tier) == {}

    def test_default_cache_target_tokens_is_zero(self) -> None:
        """Default disables anchoring/underfill for simple tests."""
        assert StabilityTracker().cache_target_tokens == 0

    def test_cache_target_tokens_stored(self) -> None:
        """Constructor arg is read through via property."""
        tracker = StabilityTracker(cache_target_tokens=1500)
        assert tracker.cache_target_tokens == 1500

    def test_set_cache_target_tokens_updates(self) -> None:
        """Setter works — used during mode switching."""
        tracker = StabilityTracker(cache_target_tokens=100)
        tracker.set_cache_target_tokens(2000)
        assert tracker.cache_target_tokens == 2000

    def test_has_item_false_for_unknown(self) -> None:
        """Membership probe returns False for unknown keys."""
        assert StabilityTracker().has_item("nope") is False

    def test_get_signature_hash_none_for_unknown(self) -> None:
        """Unknown key → None (not empty string)."""
        assert StabilityTracker().get_signature_hash("nope") is None
