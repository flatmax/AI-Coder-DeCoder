"""Initialisation, token measurement, lifecycle.

Extracted from the original monolithic ``test_stability_tracker.py``.

Under D36 the system-prompt tracker entry was removed (the
prompt is now a non-flux head anchor rendered live at
assembly time), and reference-graph clustering was replaced
with mtime-based dir-block seeding. Tests for the legacy
mechanisms have been removed; replacements live in
``test_backfill_and_distribution.py`` (dir-block seeding) and
``test_membrane_flux.py`` (cascade behaviour).
"""

from __future__ import annotations

from ac_dc.stability_tracker import (
    StabilityTracker,
    Tier,
    TrackedItem,
)

from .conftest import (
    _TIER_CONFIG_PROMOTE_L3,
    _active_item,
    xfail_legacy_cascade,
)


# ---------------------------------------------------------------------------
# Token measurement
# ---------------------------------------------------------------------------


class TestMeasureTokens:
    """measure_tokens updates token count for an existing item."""

    def test_measure_updates_tokens(self) -> None:
        """Token count refreshed for a tracked item."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1", 100)})
        tracker.measure_tokens("file:a.py", 250)
        assert tracker.get_all_items()["file:a.py"].tokens == 250

    def test_measure_unknown_key_is_noop(self) -> None:
        """Unknown keys silently ignored — no error, no side effects."""
        tracker = StabilityTracker()
        tracker.measure_tokens("symbols:not-here", 500)
        assert tracker.get_all_items() == {}


# ---------------------------------------------------------------------------
# Full-cycle integration
# ---------------------------------------------------------------------------


class TestFullCycle:
    """Multi-request simulation — the invariants hold across cycles."""

    @xfail_legacy_cascade
    def test_new_to_graduate_to_promote(self) -> None:
        """Full lifecycle — new → active → L3 → L2.

        8 cycles of unchanged content should take an item from
        never-seen to L2.
        """
        tracker = StabilityTracker()
        for _ in range(8):
            tracker.update({"file:a.py": _active_item("h1", 100)})
        assert tracker.get_all_items()["file:a.py"].tier == Tier.L2

    def test_edit_after_graduation_demotes(self) -> None:
        """Item promoted to L3 then edited → back to active."""
        tracker = StabilityTracker()
        for _ in range(5):  # graduate to L3
            tracker.update({"file:a.py": _active_item("h1")})
        # Now edit (hash changes).
        tracker.update({"file:a.py": _active_item("h2")})
        item = tracker.get_all_items()["file:a.py"]
        assert item.tier == Tier.ACTIVE
        assert item.n_value == 0

    @xfail_legacy_cascade
    def test_mixed_items_distinct_tiers(self) -> None:
        """Many items at different stability levels live correctly."""
        tracker = StabilityTracker()
        for _ in range(5):
            tracker.update({"file:old.py": _active_item("h1")})
        tracker.update(
            {
                "file:old.py": _active_item("h1"),
                "file:new.py": _active_item("h1"),
            }
        )
        tracker.update(
            {
                "file:old.py": _active_item("h1"),
                "file:new.py": _active_item("h1"),
            }
        )
        old = tracker.get_all_items()["file:old.py"]
        new = tracker.get_all_items()["file:new.py"]
        tier_rank = {
            Tier.L0: 4, Tier.L1: 3, Tier.L2: 2,
            Tier.L3: 1, Tier.ACTIVE: 0,
        }
        assert tier_rank[old.tier] > tier_rank[new.tier]

    def test_change_log_across_cycles(self) -> None:
        """Change log reflects only the most recent update."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("h1")})
        tracker.update({"file:a.py": _active_item("h1")})
        changes = tracker.get_changes()
        assert changes == []


# ---------------------------------------------------------------------------
# Introspection surface
# ---------------------------------------------------------------------------


class TestIntrospection:
    """Read methods return fresh copies and reflect current state."""

    def test_get_tier_items_returns_fresh_dict(self) -> None:
        """Mutating the returned dict doesn't affect tracker."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item()})
        items = tracker.get_tier_items(Tier.ACTIVE)
        items.clear()
        assert tracker.has_item("file:a.py")

    def test_get_all_items_returns_fresh_dict(self) -> None:
        """Same for get_all_items."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item()})
        got = tracker.get_all_items()
        got.clear()
        assert tracker.has_item("file:a.py")

    @xfail_legacy_cascade
    def test_get_changes_returns_fresh_list(self) -> None:
        """Mutating the returned changes list doesn't affect tracker."""
        tracker = StabilityTracker()
        for _ in range(4):
            tracker.update({"file:a.py": _active_item("h1")})
        changes = tracker.get_changes()
        changes.clear()
        assert tracker.get_changes() != []

    def test_get_signature_hash_reflects_current(self) -> None:
        """Hash accessor returns the current hash after update."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item("original")})
        tracker.update({"file:a.py": _active_item("modified")})
        assert tracker.get_signature_hash("file:a.py") == "modified"


# ---------------------------------------------------------------------------
# History graduation — gated, NOT N-based
# ---------------------------------------------------------------------------


class TestHistoryGraduation:
    """History graduates only via piggyback or token threshold.

    Per specs-reference/3-llm/cache-tiering, history is
    immutable so waiting on an N-value progression is the
    wrong signal. Graduation is controlled by two gates:

    1. Piggyback — L3 is already broken this cycle.
    2. Token threshold — active history tokens exceed cache target.

    When cache_target_tokens=0, neither gate fires.
    """

    def test_history_stays_active_under_n_progression(self) -> None:
        """N reaching the active promote threshold does NOT graduate history."""
        tracker = StabilityTracker(cache_target_tokens=10_000)
        for _ in range(10):
            tracker.update({"history:0": _active_item("h1", 100)})
        item = tracker.get_all_items()["history:0"]
        assert item.tier == Tier.ACTIVE

    @xfail_legacy_cascade
    def test_cache_target_zero_never_graduates(self) -> None:
        """With cache_target_tokens=0, history stays active forever."""
        tracker = StabilityTracker(cache_target_tokens=0)
        active = {
            f"history:{i}": _active_item("h1", 10_000)
            for i in range(20)
        }
        tracker.update(active)
        for _ in range(5):
            tracker.update(active)
        for i in range(20):
            item = tracker.get_all_items()[f"history:{i}"]
            assert item.tier == Tier.ACTIVE

    @xfail_legacy_cascade
    def test_piggyback_graduates_when_file_graduates(self) -> None:
        """File graduation marks L3 broken → history piggybacks."""
        tracker = StabilityTracker(cache_target_tokens=500)
        for i in range(3):
            tracker.update(
                {f"history:{i}": _active_item("h_hist", 200)}
            )
        for _ in range(4):
            tracker.update(
                {
                    "file:a.py": _active_item("h_file", 100),
                    "history:0": _active_item("h_hist", 200),
                    "history:1": _active_item("h_hist", 200),
                    "history:2": _active_item("h_hist", 200),
                }
            )
        item0 = tracker.get_all_items()["history:0"]
        item2 = tracker.get_all_items()["history:2"]
        assert item0.tier == Tier.L3
        assert item2.tier == Tier.ACTIVE

    def test_token_threshold_alone_does_not_graduate(self) -> None:
        """Active history exceeding cache_target does NOT graduate without piggyback."""
        tracker = StabilityTracker(cache_target_tokens=500)
        for i in range(4):
            tracker.update(
                {f"history:{i}": _active_item("h_hist", 200)}
            )
        tracker.update(
            {
                "history:0": _active_item("h_hist", 200),
                "history:1": _active_item("h_hist", 200),
                "history:2": _active_item("h_hist", 200),
                "history:3": _active_item("h_hist", 200),
            }
        )
        items = tracker.get_all_items()
        assert items["history:0"].tier == Tier.ACTIVE
        assert items["history:1"].tier == Tier.ACTIVE
        assert items["history:2"].tier == Tier.ACTIVE
        assert items["history:3"].tier == Tier.ACTIVE

    def test_piggyback_noop_when_history_fits_window(self) -> None:
        """Piggyback with small history → nothing graduates."""
        tracker = StabilityTracker(cache_target_tokens=1000)
        for i in range(2):
            tracker.update(
                {f"history:{i}": _active_item("h_hist", 100)}
            )
        for _ in range(4):
            tracker.update(
                {
                    "file:a.py": _active_item("h_file", 100),
                    "history:0": _active_item("h_hist", 100),
                    "history:1": _active_item("h_hist", 100),
                }
            )
        items = tracker.get_all_items()
        assert items["history:0"].tier == Tier.ACTIVE
        assert items["history:1"].tier == Tier.ACTIVE

    @xfail_legacy_cascade
    def test_graduated_history_logs_piggyback_reason(self) -> None:
        """Change log annotates history graduation with the piggyback reason."""
        tracker = StabilityTracker(cache_target_tokens=300)
        for i in range(3):
            tracker.update(
                {f"history:{i}": _active_item("h_hist", 200)}
            )
        for _ in range(4):
            tracker.update(
                {
                    "file:a.py": _active_item("h_file", 100),
                    "history:0": _active_item("h_hist", 200),
                    "history:1": _active_item("h_hist", 200),
                    "history:2": _active_item("h_hist", 200),
                }
            )
        changes = tracker.get_changes()
        history_grads = [
            c for c in changes
            if "history:" in c and "→ L3" in c
        ]
        assert history_grads
        assert any("piggyback" in c for c in history_grads)

    @xfail_legacy_cascade
    def test_history_graduation_marks_l3_broken(self) -> None:
        """Graduating history joins the cascade's broken-tier set."""
        tracker = StabilityTracker(cache_target_tokens=300)
        for i in range(3):
            tracker.update(
                {f"history:{i}": _active_item("h_hist", 150)}
            )
        for _ in range(4):
            tracker.update(
                {
                    "file:a.py": _active_item("h_file", 100),
                    "history:0": _active_item("h_hist", 150),
                    "history:1": _active_item("h_hist", 150),
                    "history:2": _active_item("h_hist", 150),
                }
            )
        changes = tracker.get_changes()
        assert any("→ L3: history:" in c for c in changes)

    @xfail_legacy_cascade
    def test_history_in_cached_tier_promotes_normally(self) -> None:
        """Once graduated, history items cascade like any other tier resident."""
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker._items["history:0"] = TrackedItem(
            key="history:0",
            tier=Tier.L3,
            n_value=_TIER_CONFIG_PROMOTE_L3,
            content_hash="h1",
            tokens=100,
        )
        tracker.update({"history:0": _active_item("h1", 100)})
        item = tracker.get_all_items()["history:0"]
        assert item.tier == Tier.L2
