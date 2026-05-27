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


class TestPinFile:
    """``pin_file`` marks ``file:`` entries as edit-pinned."""

    def test_pin_unknown_key_returns_false(self) -> None:
        """Pinning a key that isn't tracked is a no-op."""
        tracker = StabilityTracker()
        assert tracker.pin_file("file:nope.py") is False

    def test_pin_non_file_prefix_returns_false(self) -> None:
        """Only ``file:`` entries are pinnable."""
        tracker = StabilityTracker()
        tracker.update({"symbols:src": _active_item("h1", 100)})
        tracker.update({"docs:src": _active_item("h2", 50)})
        tracker.update({"url:abc": _active_item("h3", 200)})
        tracker.update({"history:0": _active_item("h4", 30)})
        assert tracker.pin_file("symbols:src") is False
        assert tracker.pin_file("docs:src") is False
        assert tracker.pin_file("url:abc") is False
        assert tracker.pin_file("history:0") is False

    def test_pin_file_entry_returns_true(self) -> None:
        """Successful pin returns True."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        assert tracker.pin_file("file:a.py") is True

    def test_pin_idempotent(self) -> None:
        """Pinning twice is fine; second call still returns True."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        tracker.pin_file("file:a.py")
        assert tracker.pin_file("file:a.py") is True
        assert tracker.is_pinned("file:a.py") is True

    def test_is_pinned_false_by_default(self) -> None:
        """Fresh entries are not pinned."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        assert tracker.is_pinned("file:a.py") is False

    def test_is_pinned_unknown_key_false(self) -> None:
        """Unknown key → False, not error."""
        assert StabilityTracker().is_pinned("file:nope.py") is False

    def test_unpin_clears_flag(self) -> None:
        """Unpinning restores the default state."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        tracker.pin_file("file:a.py")
        assert tracker.unpin_file("file:a.py") is True
        assert tracker.is_pinned("file:a.py") is False

    def test_unpin_unpinned_returns_false(self) -> None:
        """Unpinning an entry that wasn't pinned returns False."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        assert tracker.unpin_file("file:a.py") is False

    def test_unpin_unknown_key_returns_false(self) -> None:
        """Unpinning a missing key is a no-op."""
        assert StabilityTracker().unpin_file("file:nope.py") is False

    def test_unpin_non_file_prefix_returns_false(self) -> None:
        """Only ``file:`` entries support unpin."""
        tracker = StabilityTracker()
        tracker.update({"symbols:src": _active_item("h1", 100)})
        assert tracker.unpin_file("symbols:src") is False
