"""System-prompt registration, init from ref graph, full lifecycle.

Extracted from the original monolithic ``test_stability_tracker.py``.
"""

from __future__ import annotations

import pytest

from ac_dc.stability_tracker import (
    StabilityTracker,
    Tier,
    TrackedItem,
)

from .conftest import (
    _FakeRefIndex,
    _TIER_CONFIG_PROMOTE_L3,
    _active_item,
)


# ---------------------------------------------------------------------------
# System prompt registration
# ---------------------------------------------------------------------------


class TestRegisterSystemPrompt:
    """register_system_prompt pins system:prompt into L0."""

    def test_register_new_places_in_l0(self) -> None:
        """Fresh registration places system:prompt at L0."""
        tracker = StabilityTracker()
        tracker.register_system_prompt("hash1", tokens=1000)
        item = tracker.get_all_items()["system:prompt"]
        assert item.tier == Tier.L0
        assert item.content_hash == "hash1"
        assert item.tokens == 1000
        # L0's entry_n = 12.
        assert item.n_value == 12

    def test_register_same_hash_updates_tokens_only(self) -> None:
        """Re-registering with same hash updates tokens; N preserved."""
        tracker = StabilityTracker()
        tracker.register_system_prompt("hash1", tokens=1000)
        # Simulate N growth over cycles (can't happen without
        # update, but directly manipulate for the test).
        tracker._items["system:prompt"].n_value = 20
        # Re-register with same hash, different tokens.
        tracker.register_system_prompt("hash1", tokens=1500)
        item = tracker.get_all_items()["system:prompt"]
        assert item.tokens == 1500
        # N preserved.
        assert item.n_value == 20

    def test_register_different_hash_reinstalls(self) -> None:
        """New hash creates a fresh L0 entry.

        Rare in practice — system prompt only changes on mode
        switch or review entry/exit, both of which create a
        fresh tracker anyway. Still, the contract is that a
        changed hash reinstalls cleanly.
        """
        tracker = StabilityTracker()
        tracker.register_system_prompt("hash1", tokens=1000)
        tracker._items["system:prompt"].n_value = 20
        tracker.register_system_prompt("hash2", tokens=500)
        item = tracker.get_all_items()["system:prompt"]
        assert item.content_hash == "hash2"
        assert item.tokens == 500
        # Fresh install — N reset to entry_n.
        assert item.n_value == 12


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
        tracker.measure_tokens("symbol:not-here.py", 500)
        assert tracker.get_all_items() == {}


# ---------------------------------------------------------------------------
# Initialisation from reference graph
# ---------------------------------------------------------------------------


class TestInitialiseFromReferenceGraph:
    """Startup seeding — L0 pre-fill, clustering, orphan distribution."""

    def test_empty_files_does_nothing(self) -> None:
        """No files → no items."""
        tracker = StabilityTracker(cache_target_tokens=1000)
        tracker.initialize_from_reference_graph(_FakeRefIndex(), [])
        assert tracker.get_all_items() == {}

    def test_highest_ref_lands_in_l0(self) -> None:
        """Most-referenced file lands in L0.

        Under the four-tier even split, the highest-aggregate-
        ref-count cluster is processed first by the bin-packer.
        With all tiers at zero tokens and L0 tied with others
        for ``min(tier_sizes)``, L0 wins the insertion-order
        tie-break and receives the highest-rank cluster.

        Three orphan files with ref counts 10/5/1 become three
        singleton clusters. Walking in aggregate-descending
        order: high.py (10) goes first → L0 (tied at 0,
        insertion order picks L0). medium.py (5) next → L1
        (L0 now has tokens, so L1 is the smallest). low.py (1)
        → L2. L3 stays empty for this three-file case.
        """
        ref = _FakeRefIndex(
            ref_counts={
                "high.py": 10,
                "medium.py": 5,
                "low.py": 1,
            }
        )
        tracker = StabilityTracker(cache_target_tokens=500)
        tracker.initialize_from_reference_graph(
            ref,
            files=["high.py", "medium.py", "low.py"],
        )
        # The highest-ref file must end up in L0.
        l0_items = tracker.get_tier_items(Tier.L0)
        assert "symbol:high.py" in l0_items
        # The other two distribute across L1/L2 (four-tier split
        # plus bin-packing — each tier gets a file until exhausted).
        all_items = tracker.get_all_items()
        medium_tier = all_items["symbol:medium.py"].tier
        low_tier = all_items["symbol:low.py"].tier
        assert medium_tier != Tier.L0  # L0 is high.py's
        assert low_tier != Tier.L0
        # All three in cached tiers — no file should end up in active.
        for item in all_items.values():
            assert item.tier != Tier.ACTIVE

    def test_clustered_files_share_a_tier(self) -> None:
        """Files in the same connected component land in the same tier.

        The four-tier even split processes clusters as units —
        each component is assigned to one tier (whichever has
        the smallest current token total). Two files in the same
        component land in the same tier regardless of their
        individual ref counts.
        """
        ref = _FakeRefIndex(
            components=[{"high.py", "other.py"}],
            ref_counts={"high.py": 100, "other.py": 2},
        )
        tracker = StabilityTracker(cache_target_tokens=300)
        tracker.initialize_from_reference_graph(
            ref,
            files=["high.py", "other.py"],
        )
        all_items = tracker.get_all_items()
        assert all_items["symbol:high.py"].tier == all_items["symbol:other.py"].tier
        # And that shared tier should be L0 — this cluster's
        # aggregate (100+2=102) is the highest available, and
        # L0 wins the insertion-order tie-break when all tiers
        # are at zero tokens.
        assert all_items["symbol:high.py"].tier == Tier.L0

    def test_orphan_files_distributed(self) -> None:
        """Files with no mutual references become singletons.

        The real reference index only emits components for
        bidirectional edges. Orphan files (no mutual refs)
        must still get a tier assignment or they'd never
        register in the tracker.
        """
        ref = _FakeRefIndex(
            components=[],  # no mutual references
            ref_counts={"a.py": 0, "b.py": 0},
        )
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker.initialize_from_reference_graph(
            ref,
            files=["a.py", "b.py"],
        )
        all_items = tracker.get_all_items()
        assert "symbol:a.py" in all_items
        assert "symbol:b.py" in all_items

    def test_placeholder_hash_and_tokens(self) -> None:
        """Initialised items start with empty hash and placeholder tokens.

        Phase 1's first-measurement acceptance depends on the
        empty hash — items with an empty hash accept their
        first real hash without triggering demotion.
        """
        from ac_dc.stability_tracker import _PLACEHOLDER_TOKENS
        ref = _FakeRefIndex(ref_counts={"a.py": 5})
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker.initialize_from_reference_graph(ref, files=["a.py"])
        item = tracker.get_all_items()["symbol:a.py"]
        assert item.content_hash == ""
        assert item.tokens == _PLACEHOLDER_TOKENS

    def test_clustering_distributes_components_across_tiers(self) -> None:
        """Multiple components → bin-packed across all four cached tiers.

        Four components of size 2, 12 files total. The four-tier
        even split lands each component in its own tier — L0
        takes the first (highest aggregate), L1/L2/L3 take the
        others by bin-pack order.
        """
        ref = _FakeRefIndex(
            components=[
                {"a.py", "b.py"},
                {"c.py", "d.py"},
                {"e.py", "f.py"},
                {"g.py", "h.py"},
            ]
        )
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker.initialize_from_reference_graph(
            ref,
            files=["a.py", "b.py", "c.py", "d.py",
                   "e.py", "f.py", "g.py", "h.py"],
        )
        # All four cached tiers should have at least one item.
        for tier in (Tier.L0, Tier.L1, Tier.L2, Tier.L3):
            assert len(tracker.get_tier_items(tier)) > 0, f"{tier} empty"

    def test_no_files_land_in_active(self) -> None:
        """Four-tier split places every file in a cached tier.

        The core invariant of the new algorithm — no indexed
        file should land in ACTIVE on startup, regardless of
        its ref count. Even fully-isolated files get placed.
        """
        ref = _FakeRefIndex()  # no components, no ref counts
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker.initialize_from_reference_graph(
            ref,
            files=["a.py", "b.py", "c.py", "d.py", "e.py"],
        )
        all_items = tracker.get_all_items()
        for item in all_items.values():
            assert item.tier != Tier.ACTIVE, (
                f"{item.key} landed in ACTIVE; expected L0/L1/L2/L3"
            )

    def test_aggregate_ranking_places_biggest_cluster_in_l0(self) -> None:
        """Clusters with higher aggregate ref counts sort earlier.

        A small cluster with high per-member ref counts should
        outrank a larger cluster of orphans. The high-aggregate
        cluster lands in L0 (insertion-order tie-break with all
        tiers at zero); the orphan cluster lands in L1.
        """
        ref = _FakeRefIndex(
            components=[{"high1.py", "high2.py"}],
            ref_counts={
                "high1.py": 10,
                "high2.py": 10,
                "orphan1.py": 0,
                "orphan2.py": 0,
                "orphan3.py": 0,
            },
        )
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker.initialize_from_reference_graph(
            ref,
            files=["high1.py", "high2.py",
                   "orphan1.py", "orphan2.py", "orphan3.py"],
        )
        all_items = tracker.get_all_items()
        # Both high-ref files share a tier (same cluster).
        assert (
            all_items["symbol:high1.py"].tier
            == all_items["symbol:high2.py"].tier
        )
        # And that tier is L0 — aggregate 20 outranks orphan
        # singletons at 0.
        assert all_items["symbol:high1.py"].tier == Tier.L0

    def test_initialize_with_keys_mismatch_raises(self) -> None:
        """keys/files length mismatch raises ValueError."""
        tracker = StabilityTracker()
        with pytest.raises(ValueError, match="length"):
            tracker.initialize_with_keys(
                _FakeRefIndex(),
                keys=["symbol:a.py", "symbol:b.py"],
                files=["a.py"],
            )

    def test_initialize_with_doc_keys(self) -> None:
        """initialize_with_keys supports doc:{path} keys."""
        ref = _FakeRefIndex(ref_counts={"a.md": 5, "b.md": 3})
        tracker = StabilityTracker(cache_target_tokens=0)
        tracker.initialize_with_keys(
            ref,
            keys=["doc:a.md", "doc:b.md"],
            files=["a.md", "b.md"],
        )
        all_items = tracker.get_all_items()
        assert "doc:a.md" in all_items
        assert "doc:b.md" in all_items


# ---------------------------------------------------------------------------
# Full-cycle integration
# ---------------------------------------------------------------------------


class TestFullCycle:
    """Multi-request simulation — the invariants hold across cycles."""

    def test_new_to_graduate_to_promote(self) -> None:
        """Full lifecycle — new → active → L3 → L2.

        8 cycles of unchanged content should take an item from
        never-seen to L2.
        """
        tracker = StabilityTracker()
        for _ in range(8):
            tracker.update({"file:a.py": _active_item("h1", 100)})
        # After 1 cycle: N=0 active. After 4: N=3, graduates to L3
        # (entry_n=3). After 7: L3 N=6, promotes to L2 (entry_n=6).
        # After 8: L2 N=7.
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

    def test_mixed_items_distinct_tiers(self) -> None:
        """Many items at different stability levels live correctly.

        Add items at different cycles so they have different N
        values; verify each ends up in the appropriate tier.
        """
        tracker = StabilityTracker()
        # First 5 cycles with file:old.py.
        for _ in range(5):
            tracker.update({"file:old.py": _active_item("h1")})
        # Now add new.py and run 2 more cycles with both.
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
        # old.py should be higher in tier hierarchy than new.py.
        # tier order: L0 > L1 > L2 > L3 > active.
        tier_rank = {
            Tier.L0: 4, Tier.L1: 3, Tier.L2: 2,
            Tier.L3: 1, Tier.ACTIVE: 0,
        }
        assert tier_rank[old.tier] > tier_rank[new.tier]

    def test_change_log_across_cycles(self) -> None:
        """Change log reflects only the most recent update.

        Run multiple cycles and check that get_changes() only
        shows the latest cycle's activity.
        """
        tracker = StabilityTracker()
        # Cycle 1: new item.
        tracker.update({"file:a.py": _active_item("h1")})
        # Cycle 2: unchanged.
        tracker.update({"file:a.py": _active_item("h1")})
        # Second cycle's changes should not include "registered"
        # or similar from the first cycle.
        changes = tracker.get_changes()
        # Unchanged items at active don't log anything.
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
        # Tracker still has the item.
        assert tracker.has_item("file:a.py")

    def test_get_all_items_returns_fresh_dict(self) -> None:
        """Same for get_all_items."""
        tracker = StabilityTracker()
        tracker.update({"file:a.py": _active_item()})
        got = tracker.get_all_items()
        got.clear()
        assert tracker.has_item("file:a.py")

    def test_get_changes_returns_fresh_list(self) -> None:
        """Mutating the returned changes list doesn't affect tracker."""
        tracker = StabilityTracker()
        for _ in range(4):
            tracker.update({"file:a.py": _active_item("h1")})
        changes = tracker.get_changes()
        changes.clear()
        # Fetch again — still populated.
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

    Per specs4/3-llm/cache-tiering.md § "History Graduation",
    history is immutable so waiting on an N-value progression
    is the wrong signal. Graduation is controlled by two gates:

    1. Piggyback — L3 is already broken this cycle (file/symbol
       graduated in, or L3 item demoted/promoted out).
    2. Token threshold — active history tokens exceed cache target.

    When cache_target_tokens=0, neither gate fires — history
    stays active forever.
    """

    def test_history_stays_active_under_n_progression(self) -> None:
        """N reaching the active promote threshold does NOT graduate history.

        The critical regression test — before the fix, history
        items were promoted identically to file items, causing
        cache churn on every stable conversation cycle.
        Without a piggyback or token-threshold trigger, history
        must stay in active no matter how stable it becomes.
        """
        tracker = StabilityTracker(cache_target_tokens=10_000)
        # Drive many unchanged cycles — N grows indefinitely.
        for _ in range(10):
            tracker.update({"history:0": _active_item("h1", 100)})
        item = tracker.get_all_items()["history:0"]
        assert item.tier == Tier.ACTIVE

    def test_cache_target_zero_never_graduates(self) -> None:
        """With cache_target_tokens=0, history stays active forever.

        Even with an enormous active history that would trip
        the token-threshold gate, cache_target=0 disables the
        whole mechanism.
        """
        tracker = StabilityTracker(cache_target_tokens=0)
        # Seed 20 history entries with large token counts in a
        # single update — Phase 1 cleanup removes history:* items
        # not present in the current active_items dict, so we
        # can't seed them in separate cycles.
        active = {
            f"history:{i}": _active_item("h1", 10_000)
            for i in range(20)
        }
        tracker.update(active)
        # Run a few more cycles with the same set so N grows.
        # Without the cache_target=0 guard these would graduate
        # (large tokens → token-threshold gate would fire).
        for _ in range(5):
            tracker.update(active)
        # All should still be in active.
        for i in range(20):
            item = tracker.get_all_items()[f"history:{i}"]
            assert item.tier == Tier.ACTIVE

    def test_piggyback_graduates_when_file_graduates(self) -> None:
        """File graduation marks L3 broken → history piggybacks.

        A file graduating from active to L3 invalidates L3's
        cache block. Since the block is going to be rebuilt,
        graduating history at the same time is free. Older
        history messages graduate; newer ones stay in the
        verbatim window sized at cache_target_tokens.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        # Seed history entries (tokens intentionally small so
        # they fit comfortably within the verbatim window when
        # not graduated, and the oldest falls outside once the
        # verbatim window accumulates 500 tokens).
        # tokens=200 means the window holds 2 messages (400
        # accumulated), and the third would push to 600 > 500
        # → becomes the graduation boundary.
        for i in range(3):
            tracker.update(
                {f"history:{i}": _active_item("h_hist", 200)}
            )
        # Drive a file through to graduation. 4 cycles of
        # unchanged content → file:a.py graduates on cycle 4.
        # We also keep history present each cycle so it's not
        # cleaned up as departed.
        for _ in range(4):
            tracker.update(
                {
                    "file:a.py": _active_item("h_file", 100),
                    "history:0": _active_item("h_hist", 200),
                    "history:1": _active_item("h_hist", 200),
                    "history:2": _active_item("h_hist", 200),
                }
            )
        # file:a.py graduated — L3 was broken that cycle, so
        # history piggyback fires. Walking newest→oldest with
        # cache_target=500 and 200-token items:
        #   idx=2 (newest): accumulated 200, stays
        #   idx=1: accumulated 400, stays
        #   idx=0 (oldest): accumulated 600 > 500, graduates
        item0 = tracker.get_all_items()["history:0"]
        item2 = tracker.get_all_items()["history:2"]
        assert item0.tier == Tier.L3, (
            f"oldest history should graduate on piggyback; "
            f"got tier={item0.tier}"
        )
        assert item2.tier == Tier.ACTIVE, (
            f"newest history should stay in verbatim window; "
            f"got tier={item2.tier}"
        )

    def test_token_threshold_alone_does_not_graduate(self) -> None:
        """Active history exceeding cache_target does NOT graduate without piggyback.

        The regression guard for the cache-thrash bug. Before
        the fix, a token-threshold rule (active history tokens
        > cache_target_tokens) forced graduation every turn
        once the conversation grew past the per-tier caching
        floor — tearing down L3's cache block on every request.
        Now the only gate is piggyback; without an independent
        L3 invalidation this cycle, all history must stay in
        active no matter how large.
        """
        tracker = StabilityTracker(cache_target_tokens=500)
        # Seed 4 history entries at 200 tokens each.
        # Total: 800 tokens > 500 cache target. Under the old
        # rule this would have graduated the oldest messages;
        # under the new rule it does nothing.
        for i in range(4):
            tracker.update(
                {f"history:{i}": _active_item("h_hist", 200)}
            )
        # One more cycle with all four present. No file work,
        # no other L3 activity → piggyback gate stays closed.
        tracker.update(
            {
                "history:0": _active_item("h_hist", 200),
                "history:1": _active_item("h_hist", 200),
                "history:2": _active_item("h_hist", 200),
                "history:3": _active_item("h_hist", 200),
            }
        )
        items = tracker.get_all_items()
        # All four must remain in active — no graduation.
        assert items["history:0"].tier == Tier.ACTIVE
        assert items["history:1"].tier == Tier.ACTIVE
        assert items["history:2"].tier == Tier.ACTIVE
        assert items["history:3"].tier == Tier.ACTIVE

    def test_piggyback_noop_when_history_fits_window(self) -> None:
        """Piggyback with small history → nothing graduates.

        L3 gets broken by a file graduation, but the entire
        active history fits inside the verbatim window
        (total tokens ≤ cache_target_tokens). No graduation
        boundary exists; every history message stays in active.
        """
        tracker = StabilityTracker(cache_target_tokens=1000)
        # Two history messages, 100 tokens each → 200 total,
        # well under cache_target=1000.
        for i in range(2):
            tracker.update(
                {f"history:{i}": _active_item("h_hist", 100)}
            )
        # Graduate a file (4 unchanged cycles) with history
        # also present each cycle.
        for _ in range(4):
            tracker.update(
                {
                    "file:a.py": _active_item("h_file", 100),
                    "history:0": _active_item("h_hist", 100),
                    "history:1": _active_item("h_hist", 100),
                }
            )
        # File graduated — L3 broken. Piggyback gate opens.
        # But total active history (200) < cache_target (1000)
        # → no graduation boundary → history stays put.
        items = tracker.get_all_items()
        assert items["history:0"].tier == Tier.ACTIVE
        assert items["history:1"].tier == Tier.ACTIVE

    def test_graduated_history_logs_piggyback_reason(self) -> None:
        """Change log annotates history graduation with the piggyback reason.

        Piggyback is now the only path by which history
        reaches L3. The log message includes the reason so
        operators watching the terminal HUD can see that the
        cache-block churn was amortised onto an unrelated L3
        invalidation rather than having been a standalone event.
        """
        tracker = StabilityTracker(cache_target_tokens=300)
        # Seed 3 history items, 200 tokens each → 600 total.
        for i in range(3):
            tracker.update(
                {f"history:{i}": _active_item("h_hist", 200)}
            )
        # Drive a file through to graduation while keeping
        # history present each cycle. File graduation breaks
        # L3 → piggyback gate opens.
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
        assert history_grads, (
            f"expected history graduation in change log, "
            f"got: {changes}"
        )
        assert any(
            "piggyback" in c for c in history_grads
        ), (
            f"expected 'piggyback' reason, "
            f"got: {history_grads}"
        )

    def test_history_graduation_marks_l3_broken(self) -> None:
        """Graduating history joins the cascade's broken-tier set.

        When history graduates via piggyback, L3 is marked
        broken so downstream passes can rebalance — e.g., an
        L2 item ready to promote would flow into L3's refreshed
        cache block on the next cycle.
        """
        tracker = StabilityTracker(cache_target_tokens=300)
        # Seed history items small enough that two fit in the
        # 300-token verbatim window but three don't, so the
        # oldest will graduate when piggyback opens the gate.
        for i in range(3):
            tracker.update(
                {f"history:{i}": _active_item("h_hist", 150)}
            )
        # Drive a file to graduation to open the piggyback gate.
        for _ in range(4):
            tracker.update(
                {
                    "file:a.py": _active_item("h_file", 100),
                    "history:0": _active_item("h_hist", 150),
                    "history:1": _active_item("h_hist", 150),
                    "history:2": _active_item("h_hist", 150),
                }
            )
        # The cascade consumes _broken_tiers mid-method and
        # clears it per-cycle. We can't read the set after
        # update() returns, but we CAN verify the downstream
        # effect: the change log should show an L3 entry for
        # the oldest history item.
        changes = tracker.get_changes()
        assert any("→ L3: history:" in c for c in changes)

    def test_history_in_cached_tier_promotes_normally(self) -> None:
        """Once graduated, history items cascade like any other tier resident.

        The immutability argument that gates the ACTIVE → L3
        transition doesn't apply to L3 → L2 → L1 → L0 promotions.
        Once in a cached tier, history is ordinary content and
        flows upward via _try_promote_from as N progresses.
        """
        tracker = StabilityTracker(cache_target_tokens=0)
        # Seed a history item directly into L3 with N at L3's
        # promote threshold. With cache_target=0 (no anchoring,
        # no underfill demotion) and L2 empty (broken), it
        # should promote on the next update.
        tracker._items["history:0"] = TrackedItem(
            key="history:0",
            tier=Tier.L3,
            n_value=_TIER_CONFIG_PROMOTE_L3,
            content_hash="h1",
            tokens=100,
        )
        # Include the item in active_items with unchanged hash
        # so Phase 1 doesn't drop it as departed. N increments
        # past promote_n, which is fine.
        tracker.update({"history:0": _active_item("h1", 100)})
        item = tracker.get_all_items()["history:0"]
        assert item.tier == Tier.L2