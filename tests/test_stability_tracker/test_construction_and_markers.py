"""Construction, deletion-marker constants, pin/mark-deleted state.

Extracted from the original monolithic ``test_stability_tracker.py``.
"""

from __future__ import annotations

import hashlib

import pytest

from ac_dc.stability_tracker import (
    DELETION_MARKER_TEXT,
    StabilityTracker,
    Tier,
    _DELETION_MARKER_HASH,
)

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


# ---------------------------------------------------------------------------
# Deletion marker constants and pin/marker helpers
# ---------------------------------------------------------------------------


class TestDeletionMarkerConstants:
    """The marker text and pre-computed hash are byte-stable.

    Reimplementer note: the exact text is documented in
    ``specs-reference/3-llm/cache-tiering.md`` § Deletion
    marker content. Variations would defeat the cross-deletion
    cache-stability invariant.
    """

    def test_marker_text_exact(self) -> None:
        """Pin the canonical marker string."""
        assert DELETION_MARKER_TEXT == (
            "[deleted in this session — see L0 symbol/doc "
            "map for last-known structure]"
        )

    def test_marker_hash_is_sha256_hex(self) -> None:
        """Hash is 64 hex chars (SHA-256 hex digest)."""
        assert len(_DELETION_MARKER_HASH) == 64
        assert all(c in "0123456789abcdef" for c in _DELETION_MARKER_HASH)

    def test_marker_hash_matches_text(self) -> None:
        """Hash is the SHA-256 of the literal marker text."""
        import hashlib
        expected = hashlib.sha256(
            DELETION_MARKER_TEXT.encode("utf-8")
        ).hexdigest()
        assert _DELETION_MARKER_HASH == expected

    def test_marker_text_describes_pointer_to_l0(self) -> None:
        """Marker text mentions the L0 symbol/doc map.

        This is load-bearing for the LLM's interpretation:
        when the assistant sees a deletion marker, the
        accompanying instruction is to consult L0's structural
        map for last-known signatures. A reimplementer changing
        the wording in a way that drops this pointer would
        produce subtly worse model behaviour on deletion-aware
        tasks.
        """
        assert "L0" in DELETION_MARKER_TEXT
        assert "map" in DELETION_MARKER_TEXT


class TestPinFile:
    """``pin_file`` marks ``file:`` entries as edit-pinned."""

    def test_pin_unknown_key_returns_false(self) -> None:
        """Pinning a key that isn't tracked is a no-op."""
        tracker = StabilityTracker()
        assert tracker.pin_file("file:nope.py") is False

    def test_pin_non_file_prefix_returns_false(self) -> None:
        """Only ``file:`` entries are pinnable."""
        tracker = StabilityTracker()
        tracker.update({"symbol:a.py": _active_item("h1", 100)})
        tracker.update({"doc:a.md": _active_item("h2", 50)})
        tracker.update({"url:abc": _active_item("h3", 200)})
        tracker.update({"history:0": _active_item("h4", 30)})
        assert tracker.pin_file("symbol:a.py") is False
        assert tracker.pin_file("doc:a.md") is False
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
        tracker.update({"symbol:a.py": _active_item("h1", 100)})
        assert tracker.unpin_file("symbol:a.py") is False


class TestMarkDeleted:
    """``mark_deleted`` converts ``file:`` entries to markers."""

    def test_mark_deleted_unknown_returns_false(self) -> None:
        """Unknown key → no-op, False."""
        assert StabilityTracker().mark_deleted("file:nope.py") is False

    def test_mark_deleted_non_file_prefix_returns_false(self) -> None:
        """Only ``file:`` entries can become markers."""
        tracker = StabilityTracker()
        tracker.update({"symbol:a.py": _active_item("h1", 100)})
        assert tracker.mark_deleted("symbol:a.py") is False

    def test_mark_deleted_returns_true_on_success(self) -> None:
        """Successful conversion returns True."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        assert tracker.mark_deleted("file:a.py") is True

    def test_mark_deleted_replaces_hash_with_marker_hash(self) -> None:
        """Content hash is the constant deletion-marker hash."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("original", 100)})
        tracker.mark_deleted("file:a.py")
        assert (
            tracker.get_signature_hash("file:a.py")
            == _DELETION_MARKER_HASH
        )

    def test_mark_deleted_updates_token_count(self) -> None:
        """Token count reflects marker text length, not original."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 50_000)})
        tracker.mark_deleted("file:a.py")
        item = tracker.get_all_items()["file:a.py"]
        # Marker text is short — never as big as the original
        # 50000-token file. Use a generous upper bound rather
        # than pinning the exact len() to keep the test stable
        # against minor wording variations within the
        # specs-mandated "L0 symbol/doc map" phrasing.
        assert 0 < item.tokens < 200

    def test_mark_deleted_preserves_tier_and_n(self) -> None:
        """Tier and N are unchanged by marker conversion.

        Phase 0 transitions deleted files to markers; the
        cascade then handles them like any normal hash-change
        (which they appear to be — old hash differs from the
        marker hash). Per-tier-N invariants are the cascade's
        problem, not :meth:`mark_deleted`'s.
        """
        tracker = StabilityTracker()
        # Drive the file up to L2.
        for _ in range(8):
            tracker.update({"file:a.py": _active_item("h1", 100)})
        item_before = tracker.get_all_items()["file:a.py"]
        tier_before = item_before.tier
        n_before = item_before.n_value
        tracker.mark_deleted("file:a.py")
        item_after = tracker.get_all_items()["file:a.py"]
        assert item_after.tier == tier_before
        assert item_after.n_value == n_before

    def test_mark_deleted_clears_pin_flag(self) -> None:
        """Deletion supersedes pin status.

        A pinned file that gets deleted no longer needs pin
        protection — its constant marker hash provides
        cross-cycle stability without it. ``mark_deleted``
        clears the pin so the two flags don't overlap.
        """
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        tracker.pin_file("file:a.py")
        assert tracker.is_pinned("file:a.py") is True
        tracker.mark_deleted("file:a.py")
        assert tracker.is_pinned("file:a.py") is False

    def test_is_deleted_false_by_default(self) -> None:
        """Fresh entries are not marker entries."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        assert tracker.is_deleted("file:a.py") is False

    def test_is_deleted_true_after_mark(self) -> None:
        """``is_deleted`` reflects ``mark_deleted`` state."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        tracker.mark_deleted("file:a.py")
        assert tracker.is_deleted("file:a.py") is True

    def test_is_deleted_unknown_key_false(self) -> None:
        """Unknown key → False, not error."""
        assert StabilityTracker().is_deleted("file:nope.py") is False

    def test_two_deleted_files_share_hash(self) -> None:
        """All deletion markers have byte-identical hashes.

        The cross-deletion stability invariant: many deleted
        files in the same session produce indistinguishable
        marker entries (apart from their key/path). This is
        the point of having a constant marker text.

        Both files must be present in the same update —
        Phase 1 cleanup removes ``file:`` entries not in the
        active list, so a separate-update style would lose
        the first file before the second arrived.
        """
        tracker = StabilityTracker()
        tracker.update(
            {
                "file:a.py": _active_item("ha", 100),
                "file:b.py": _active_item("hb", 200),
            }
        )
        tracker.mark_deleted("file:a.py")
        tracker.mark_deleted("file:b.py")
        assert (
            tracker.get_signature_hash("file:a.py")
            == tracker.get_signature_hash("file:b.py")
            == _DELETION_MARKER_HASH
        )