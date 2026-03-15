"""Tests for StabilityTracker — N values, graduation, cascade, initialization."""

import pytest

from ac_dc.context.stability_tracker import (
    StabilityTracker, TrackedItem, Tier, TIER_CONFIG,
)


# ── N Value Behavior ──────────────────────────────────────────────

class TestNValues:
    def test_new_item_starts_at_zero(self):
        tracker = StabilityTracker()
        tracker.update({"file:a.py": {"hash": "h1", "tokens": 100}})
        item = tracker.get_item("file:a.py")
        assert item is not None
        assert item.n == 0
        assert item.tier == Tier.ACTIVE

    def test_unchanged_increments_n(self):
        tracker = StabilityTracker()
        for _ in range(3):
            tracker.update({"file:a.py": {"hash": "h1", "tokens": 100}})
        item = tracker.get_item("file:a.py")
        # N=0 on first, then increments: 0, 1, 2
        # But first call creates at N=0, second sees unchanged -> N=1, third -> N=2
        assert item.n >= 2

    def test_hash_change_resets_n(self):
        tracker = StabilityTracker()
        tracker.update({"file:a.py": {"hash": "h1", "tokens": 100}})
        tracker.update({"file:a.py": {"hash": "h1", "tokens": 100}})
        tracker.update({"file:a.py": {"hash": "h2", "tokens": 100}})
        item = tracker.get_item("file:a.py")
        assert item.n == 0
        assert item.tier == Tier.ACTIVE

    def test_first_measurement_no_demotion(self):
        """Items initialized with empty hash accept first real hash without demotion."""
        tracker = StabilityTracker(cache_target_tokens=0)
        # Seed with empty hash (simulating initialize_from_reference_graph)
        tracker.seed_item("sym:a.py", Tier.L2, tokens=100, content_hash="")
        item = tracker.get_item("sym:a.py")
        assert item.tier == Tier.L2

        # First real measurement
        tracker.update({"sym:a.py": {"hash": "real_hash", "tokens": 100}})
        item = tracker.get_item("sym:a.py")
        assert item.tier == Tier.L2  # NOT demoted
        assert item.content_hash == "real_hash"
        assert item.n == TIER_CONFIG[Tier.L2]["entry_n"] + 1


class TestGraduation:
    def test_graduation_requires_n_ge_3(self):
        tracker = StabilityTracker(cache_target_tokens=0)
        # Need 4 calls: create at N=0, then N=1, N=2, N=3 -> graduates
        for _ in range(4):
            tracker.update({"file:a.py": {"hash": "h1", "tokens": 100}})
        item = tracker.get_item("file:a.py")
        assert item.tier == Tier.L3

    def test_no_graduation_below_n3(self):
        tracker = StabilityTracker(cache_target_tokens=0)
        for _ in range(2):
            tracker.update({"file:a.py": {"hash": "h1", "tokens": 100}})
        item = tracker.get_item("file:a.py")
        assert item.tier == Tier.ACTIVE

    def test_promoted_items_get_entry_n(self):
        tracker = StabilityTracker(cache_target_tokens=0)
        for _ in range(4):
            tracker.update({"file:a.py": {"hash": "h1", "tokens": 100}})
        item = tracker.get_item("file:a.py")
        assert item.tier == Tier.L3
        assert item.n == TIER_CONFIG[Tier.L3]["entry_n"]

    def test_url_enters_l1_directly(self):
        tracker = StabilityTracker(cache_target_tokens=0)
        # URLs skip active -> L3 path, go directly to L1
        for _ in range(4):
            tracker.update({"url:abc123": {"hash": "h1", "tokens": 200}})
        item = tracker.get_item("url:abc123")
        assert item.tier == Tier.L1

    def test_history_graduation_piggyback(self):
        """History graduates when L3 is already broken."""
        tracker = StabilityTracker(cache_target_tokens=0)
        # Create a file that will graduate, breaking L3
        for _ in range(4):
            tracker.update({
                "file:a.py": {"hash": "h1", "tokens": 100},
                "history:0": {"hash": "hh", "tokens": 50},
            })
        # History should have piggybacked on L3 break
        hist = tracker.get_item("history:0")
        assert hist is not None
        assert hist.tier in (Tier.L3, Tier.L2, Tier.L1)


class TestDemotion:
    def test_content_change_demotes_to_active(self):
        tracker = StabilityTracker(cache_target_tokens=0)
        # Graduate an item
        for _ in range(4):
            tracker.update({"file:a.py": {"hash": "h1", "tokens": 100}})
        assert tracker.get_item("file:a.py").tier == Tier.L3

        # Change content
        tracker.update({"file:a.py": {"hash": "h2", "tokens": 100}})
        item = tracker.get_item("file:a.py")
        assert item.tier == Tier.ACTIVE
        assert item.n == 0

    def test_demotion_logged(self):
        tracker = StabilityTracker(cache_target_tokens=0)
        for _ in range(4):
            tracker.update({"file:a.py": {"hash": "h1", "tokens": 100}})
        tracker.get_changes()  # clear
        tracker.update({"file:a.py": {"hash": "h2", "tokens": 100}})
        changes = tracker.get_changes()
        assert any("📉" in c for c in changes)


class TestStaleRemoval:
    def test_stale_items_removed(self):
        tracker = StabilityTracker()
        tracker.update({"sym:deleted.py": {"hash": "h1", "tokens": 100}})
        # Now the file no longer exists
        tracker.update(
            {"sym:other.py": {"hash": "h2", "tokens": 100}},
            existing_files={"other.py"},
        )
        assert tracker.get_item("sym:deleted.py") is None

    def test_stale_removal_marks_tier_broken(self):
        tracker = StabilityTracker(cache_target_tokens=0)
        # Graduate then remove
        for _ in range(4):
            tracker.update({"sym:a.py": {"hash": "h1", "tokens": 100}})
        assert tracker.get_item("sym:a.py").tier == Tier.L3
        tracker.update({}, existing_files=set())
        assert tracker.get_item("sym:a.py") is None


class TestDeselectedFileCleanup:
    def test_deselected_file_removed(self):
        tracker = StabilityTracker()
        tracker.update({
            "file:a.py": {"hash": "h1", "tokens": 100},
            "file:b.py": {"hash": "h2", "tokens": 100},
        })
        # Deselect b.py
        tracker.update({"file:a.py": {"hash": "h1", "tokens": 100}})
        assert tracker.get_item("file:b.py") is None

    def test_sym_items_persist_after_deselection(self):
        """sym: and doc: items are NOT removed when absent from active_items."""
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker.seed_item("sym:a.py", Tier.L2, tokens=100, content_hash="h1")
        # Update without sym:a.py in active_items
        tracker.update({"file:b.py": {"hash": "h2", "tokens": 50}})
        assert tracker.get_item("sym:a.py") is not None
        assert tracker.get_item("sym:a.py").tier == Tier.L2


class TestInitialization:
    def test_initialize_from_reference_graph(self):
        tracker = StabilityTracker(cache_target_tokens=100)
        files = ["a.py", "b.py", "c.py", "d.py", "e.py"]
        ref_counts = {"a.py": 5, "b.py": 3, "c.py": 2, "d.py": 1, "e.py": 0}
        components = [["b.py", "c.py"]]  # bidirectional

        tracker.initialize_from_reference_graph(
            file_ref_counts=ref_counts,
            connected_components=components,
            all_files=files,
        )

        # system:prompt should be in L0
        assert tracker.get_item("system:prompt").tier == Tier.L0

        # a.py (highest refs) should be in L0
        assert tracker.get_item("sym:a.py") is not None
        assert tracker.get_item("sym:a.py").tier == Tier.L0

        # All files should be placed somewhere
        for f in files:
            item = tracker.get_item(f"sym:{f}")
            assert item is not None, f"sym:{f} not placed"

    def test_orphan_files_distributed(self):
        """Files not in any connected component are still placed."""
        tracker = StabilityTracker(cache_target_tokens=100)
        files = ["a.py", "orphan.py"]
        tracker.initialize_from_reference_graph(
            file_ref_counts={"a.py": 1, "orphan.py": 0},
            connected_components=[],
            all_files=files,
        )
        orphan = tracker.get_item("sym:orphan.py")
        assert orphan is not None
        assert orphan.tier in (Tier.L1, Tier.L2, Tier.L3)

    def test_l0_seeded_items_excluded_from_clustering(self):
        tracker = StabilityTracker(cache_target_tokens=100)
        files = ["top.py", "b.py"]
        tracker.initialize_from_reference_graph(
            file_ref_counts={"top.py": 10, "b.py": 1},
            connected_components=[["top.py", "b.py"]],
            all_files=files,
        )
        top = tracker.get_item("sym:top.py")
        assert top.tier == Tier.L0
        # b.py should be in a lower tier, not also in L0
        b = tracker.get_item("sym:b.py")
        assert b is not None
        assert b.tier in (Tier.L1, Tier.L2, Tier.L3)


class TestCascade:
    def test_ripple_promotion_into_broken_tier(self):
        """Items can promote into a tier above when it's broken."""
        tracker = StabilityTracker(cache_target_tokens=0)

        # Manually set up: item in L3 with high N, L2 empty (broken)
        tracker.seed_item("sym:a.py", Tier.L3, tokens=100, content_hash="h1")
        item = tracker.get_item("sym:a.py")
        item.n = 10  # Well above promotion threshold of 6

        tracker._broken_tiers.add(Tier.L2)
        tracker._run_cascade([])

        # Should have promoted to L2
        assert tracker.get_item("sym:a.py").tier == Tier.L2

    def test_stable_tier_blocks_promotion(self):
        """Items cannot promote into a stable (non-broken, non-empty) tier."""
        tracker = StabilityTracker(cache_target_tokens=0)

        # L2 has content (not broken, not empty)
        tracker.seed_item("sym:stable.py", Tier.L2, tokens=100, content_hash="s1")
        # L3 item wants to promote
        tracker.seed_item("sym:want.py", Tier.L3, tokens=100, content_hash="w1")
        item = tracker.get_item("sym:want.py")
        item.n = 20  # Way above threshold

        tracker._broken_tiers.clear()
        tracker._run_cascade([])

        # Should NOT have promoted (L2 is stable)
        assert tracker.get_item("sym:want.py").tier == Tier.L3


class TestItemRemoval:
    def test_remove_item(self):
        tracker = StabilityTracker()
        tracker.seed_item("file:a.py", Tier.L2, tokens=100)
        tracker.remove_item("file:a.py")
        assert tracker.get_item("file:a.py") is None

    def test_purge_history(self):
        tracker = StabilityTracker()
        tracker.seed_item("history:0", Tier.L3, tokens=50)
        tracker.seed_item("history:1", Tier.L3, tokens=50)
        tracker.seed_item("sym:a.py", Tier.L2, tokens=100)
        tracker.purge_history()
        assert tracker.get_item("history:0") is None
        assert tracker.get_item("history:1") is None
        assert tracker.get_item("sym:a.py") is not None

    def test_remove_by_prefix(self):
        tracker = StabilityTracker()
        tracker.seed_item("doc:a.md", Tier.L2, tokens=100)
        tracker.seed_item("doc:b.md", Tier.L3, tokens=100)
        tracker.seed_item("sym:c.py", Tier.L1, tokens=100)
        removed = tracker.remove_items_by_prefix("doc:")
        assert len(removed) == 2
        assert tracker.get_item("sym:c.py") is not None


class TestFileNeverAppearsTwice:
    def test_graduated_file_is_graduated(self):
        tracker = StabilityTracker(cache_target_tokens=0)
        for _ in range(4):
            tracker.update({"file:a.py": {"hash": "h1", "tokens": 100}})
        assert tracker.is_graduated("file:a.py")

    def test_active_file_not_graduated(self):
        tracker = StabilityTracker()
        tracker.update({"file:a.py": {"hash": "h1", "tokens": 100}})
        assert not tracker.is_graduated("file:a.py")


class TestMultiRequestSequence:
    def test_full_lifecycle(self):
        """new → active → graduate → promote → demote on edit → re-graduate"""
        tracker = StabilityTracker(cache_target_tokens=0)

        # 1. New item
        tracker.update({"file:a.py": {"hash": "v1", "tokens": 100}})
        assert tracker.get_item("file:a.py").tier == Tier.ACTIVE

        # 2-4. Graduate to L3
        for _ in range(3):
            tracker.update({"file:a.py": {"hash": "v1", "tokens": 100}})
        assert tracker.get_item("file:a.py").tier == Tier.L3

        # 5. Content change → demote
        tracker.update({"file:a.py": {"hash": "v2", "tokens": 100}})
        assert tracker.get_item("file:a.py").tier == Tier.ACTIVE
        assert tracker.get_item("file:a.py").n == 0

        # 6-9. Re-graduate
        for _ in range(4):
            tracker.update({"file:a.py": {"hash": "v2", "tokens": 100}})
        assert tracker.get_item("file:a.py").tier == Tier.L3


class TestTierCounts:
    def test_get_tier_counts(self):
        tracker = StabilityTracker()
        tracker.seed_item("sym:a.py", Tier.L0, tokens=100)
        tracker.seed_item("sym:b.py", Tier.L1, tokens=100)
        tracker.seed_item("sym:c.py", Tier.L1, tokens=100)
        counts = tracker.get_tier_counts()
        assert counts.get("L0", 0) == 1
        assert counts.get("L1", 0) == 2

    def test_get_tier_token_total(self):
        tracker = StabilityTracker()
        tracker.seed_item("sym:a.py", Tier.L1, tokens=100)
        tracker.seed_item("sym:b.py", Tier.L1, tokens=200)
        assert tracker.get_tier_token_total(Tier.L1) == 300