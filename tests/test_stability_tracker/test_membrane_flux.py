"""Membrane / flux controller behaviour — D35 replacement layer.

These tests cover the post-D35 cascade: a relaxation loop that
iterates to within-turn flux equilibrium across three live
membranes (Active→L3, L3→L2, L2→L1). L1→L0 is structurally
absent (L0 is content-typed, D27); promotion into L0 is the
sole responsibility of ``backfill_l0_after_measurement``.

Only the rectified-GHK variant is supported — the linear and
bidirectional-GHK forms from earlier revisions were retired
when the synth-tuner's headline rectified fit landed as the
production default (``runs/opt-run2/best_params.json``).

Scope:

- Direct ``cache_membrane`` unit coverage — ``compute_flux``
  rectification, threshold gating, mover-pick rules,
  protected files.
- Integration coverage — :class:`StabilityTracker` correctly
  wires :class:`FluxConfig` and the ``relax`` loop into
  :meth:`update`.

Spec authority: ``specs4/3-llm/cache-tiering.md`` and
``specs4/impl-history/decisions.md`` D35.
"""

from __future__ import annotations

import pytest

from ac_dc.cache_membrane import (
    ACTIVE_IDX,
    L0_IDX,
    L1_IDX,
    L2_IDX,
    L3_IDX,
    LIVE_MEMBRANES,
    FluxConfig,
    MembraneParams,
    compute_flux,
    ghk_flux,
    pick_mover,
    relax,
)
from ac_dc.stability_tracker import (
    StabilityTracker,
    Tier,
    TrackedItem,
)

from .conftest import _active_item


# Test-only membrane parameters with stronger response than the
# production tuned defaults. The production P (~1.6e-6) and V_T
# (~99k) are tuned for realistic token loads; the unit tests here
# use synthetic small-token setups, so we override to a regime
# where Φ clears the unit threshold at modest token counts.
_TEST_PARAMS = MembraneParams(P=1.0, V_T=2000.0)


def _test_config(*, n_admit_active: int = 3) -> FluxConfig:
    """Build a FluxConfig with test-friendly per-membrane params.

    Active→L3 mirrors the production admission_only semantics
    (age-gated, no flux equation). Higher membranes use the
    flux equation with test-friendly P/V_T so Φ clears the
    unit threshold at modest token counts.
    """
    return FluxConfig(
        threshold=1.0,
        membranes=(
            MembraneParams(
                P=1.0, V_T=2000.0,
                n_admit=n_admit_active, pick_mode="oldest",
                admission_only=True,
            ),
            MembraneParams(
                P=1.0, V_T=2000.0,
                n_admit=0, pick_mode="smallest",
            ),
            MembraneParams(
                P=1.0, V_T=2000.0,
                n_admit=0, pick_mode="smallest",
            ),
        ),
    )


# ---------------------------------------------------------------------------
# FluxConfig — defaults, parsing
# ---------------------------------------------------------------------------


class TestFluxConfig:
    """FluxConfig.from_dict normalises and clamps inputs."""

    def test_default_threshold_and_membranes(self) -> None:
        """No config dict → 1.0 threshold and tuned default membranes."""
        cfg = FluxConfig.from_dict({})
        assert cfg.threshold == 1.0
        # Tuned defaults from runs/opt-run2/best_params.json.
        assert cfg.membranes[0].P == pytest.approx(1.616399379428934e-06)
        assert cfg.membranes[0].V_T == pytest.approx(98952.34312610888)
        # Active→L3 is an admission gate: admission_only with
        # an age threshold of 3 turns.
        assert cfg.membranes[0].admission_only is True
        assert cfg.membranes[0].n_admit == 3
        # Higher membranes are flux-driven with no floor.
        assert cfg.membranes[1].admission_only is False
        assert cfg.membranes[1].n_admit == 0
        assert cfg.membranes[2].admission_only is False
        assert cfg.membranes[2].n_admit == 0

    def test_threshold_clamps_non_positive(self) -> None:
        """Zero or negative thresholds normalise to 1.0."""
        assert FluxConfig.from_dict(
            {"flux_threshold": 0.0}
        ).threshold == 1.0
        assert FluxConfig.from_dict(
            {"flux_threshold": -5.0}
        ).threshold == 1.0

    def test_per_membrane_overrides(self) -> None:
        """Per-membrane params override the defaults."""
        cfg = FluxConfig.from_dict(
            {
                "membranes": [
                    {"P": 2.5, "V_T": 500.0, "n_admit": 5,
                     "pick_mode": "oldest"},
                    {},
                    {},
                ]
            }
        )
        assert cfg.membranes[0].P == 2.5
        assert cfg.membranes[0].V_T == 500.0
        assert cfg.membranes[0].n_admit == 5
        assert cfg.membranes[0].pick_mode == "oldest"

    def test_invalid_pick_mode_falls_back_to_default(self) -> None:
        """Unknown pick_mode strings fall back to the default."""
        # Active→L3 default is "oldest" (admission gate prefers
        # the longest-aged candidate); higher membranes default
        # to "smallest".
        cfg = FluxConfig.from_dict(
            {"membranes": [{"pick_mode": "zonk"}, {"pick_mode": "zonk"}, {}]}
        )
        assert cfg.membranes[0].pick_mode == "oldest"
        assert cfg.membranes[1].pick_mode == "smallest"


# ---------------------------------------------------------------------------
# Flux equation — rectified GHK
# ---------------------------------------------------------------------------


class TestFluxEquation:
    """Rectified-GHK flux behaviour."""

    def test_ghk_signed_zero_when_voltage_zero(self) -> None:
        """V=0 with equal counts → zero (Taylor branch)."""
        # When t_lower == t_upper exactly, V == 0; the Taylor
        # branch returns P · V_T · (c_l − c_u). Equal counts on
        # each side means zero.
        phi = ghk_flux(c_lower=10, t_lower=500.0,
                       t_upper=500.0, params=_TEST_PARAMS, c_upper=10)
        assert phi == 0.0

    def test_ghk_taylor_branch_near_zero_voltage(self) -> None:
        """|V/V_T| < 1e-9 takes the symmetric expansion."""
        # V chosen so V/V_T is well below the 1e-9 epsilon.
        phi = ghk_flux(c_lower=10, t_lower=1.0e-12,
                       t_upper=0.0, params=_TEST_PARAMS)
        # Taylor branch: P · V_T · (c_lower − c_upper).
        assert phi == pytest.approx(2000.0 * 10)

    def test_ghk_positive_when_voltage_and_lower_count_positive(self) -> None:
        """V>0 and c_lower>0 → positive flux."""
        phi = ghk_flux(c_lower=5, t_lower=1000.0,
                       t_upper=0.0, params=_TEST_PARAMS)
        assert phi > 0

    def test_compute_flux_rectifies_negative(self) -> None:
        """compute_flux clamps negative GHK output to zero.

        Use ``c_lower=1, c_upper=20`` with V<0 — the GHK form
        is unambiguously negative because c_upper·exp(−V/V_T)
        dominates c_lower in the numerator.
        """
        phi = compute_flux(
            c_lower=1, t_lower=0.0,
            t_upper=1000.0, c_upper=20,
            params=_TEST_PARAMS,
        )
        assert phi == 0.0

    def test_compute_flux_passes_positive_through(self) -> None:
        """Positive GHK output passes through compute_flux unchanged."""
        phi = compute_flux(
            c_lower=5, t_lower=1000.0,
            t_upper=0.0, c_upper=0,
            params=_TEST_PARAMS,
        )
        assert phi > 0


# ---------------------------------------------------------------------------
# pick_mover — eligibility, modes, exclusion
# ---------------------------------------------------------------------------


class _StubFile:
    """Lightweight stand-in for TrackedItem in mover-pick tests."""

    __slots__ = ("key", "tier", "n", "tokens")

    def __init__(
        self, key: str, tier: int, n: int, tokens: float
    ) -> None:
        self.key = key
        self.tier = tier
        self.n = n
        self.tokens = tokens


def _stub_accessors() -> dict:
    return dict(
        tier_of=lambda f: f.tier,
        n_of=lambda f: f.n,
        tokens_of=lambda f: f.tokens,
        key_of=lambda f: f.key,
    )


class TestPickMover:
    """Mover-pick eligibility and ordering."""

    def test_returns_none_when_no_candidates(self) -> None:
        """No file at the given tier → None."""
        files = [_StubFile("a.py", L3_IDX, 5, 100)]
        chosen = pick_mover(
            files, tier_idx=ACTIVE_IDX, n_admit=0,
            pick_mode="smallest", **_stub_accessors(),
        )
        assert chosen is None

    def test_admission_floor_filters_unaged(self) -> None:
        """n_admit gate filters items with n below the floor."""
        files = [
            _StubFile("a.py", ACTIVE_IDX, 1, 100),  # n too low
            _StubFile("b.py", ACTIVE_IDX, 5, 200),  # eligible
        ]
        chosen = pick_mover(
            files, tier_idx=ACTIVE_IDX, n_admit=3,
            pick_mode="smallest", **_stub_accessors(),
        )
        assert chosen is not None
        assert chosen.key == "b.py"

    def test_smallest_mode_picks_smallest_tokens(self) -> None:
        """Default 'smallest' mode prefers the cheapest item."""
        files = [
            _StubFile("a.py", ACTIVE_IDX, 5, 500),
            _StubFile("b.py", ACTIVE_IDX, 5, 100),  # cheapest
            _StubFile("c.py", ACTIVE_IDX, 5, 300),
        ]
        chosen = pick_mover(
            files, tier_idx=ACTIVE_IDX, n_admit=0,
            pick_mode="smallest", **_stub_accessors(),
        )
        assert chosen.key == "b.py"

    def test_oldest_mode_picks_largest_n(self) -> None:
        """'oldest' mode prefers the longest-aged item."""
        files = [
            _StubFile("a.py", ACTIVE_IDX, 5, 100),
            _StubFile("b.py", ACTIVE_IDX, 12, 100),  # oldest
            _StubFile("c.py", ACTIVE_IDX, 7, 100),
        ]
        chosen = pick_mover(
            files, tier_idx=ACTIVE_IDX, n_admit=0,
            pick_mode="oldest", **_stub_accessors(),
        )
        assert chosen.key == "b.py"

    def test_excluded_files_skipped(self) -> None:
        """Excluded items (protected) are not selectable as movers."""
        files = [
            _StubFile("a.py", ACTIVE_IDX, 5, 100),
            _StubFile("b.py", ACTIVE_IDX, 5, 200),
        ]
        chosen = pick_mover(
            files, tier_idx=ACTIVE_IDX, n_admit=0,
            pick_mode="smallest",
            excluded=[files[0]],
            **_stub_accessors(),
        )
        assert chosen.key == "b.py"


# ---------------------------------------------------------------------------
# relax — V≤0 no-fire, protected files, rectification
# ---------------------------------------------------------------------------


def _files_to_callbacks(files):
    moves: list[tuple[int, int]] = []

    def set_tier(f, new_idx):
        moves.append((files.index(f), new_idx))
        f.tier = new_idx

    return set_tier, moves


class TestRelaxLoop:
    """Relaxation loop driver behaviour."""

    def test_relax_climbs_to_top_when_unconstrained(self) -> None:
        """Single item, all upper tiers empty → climbs to L1.

        The relax loop iterates to equilibrium across all live
        membranes. A lone item at ACTIVE with empty L3/L2/L1 has
        positive flux at every membrane and ends up at L1 (the
        topmost flux-reachable tier). L1→L0 is structurally
        absent so L0 is never touched.

        Tokens chosen so ``Φ`` clears the unit threshold under
        the test config's V_T=2000.
        """
        cfg = _test_config()
        files = [_StubFile("a.py", ACTIVE_IDX, 5, 5000)]
        set_tier, _ = _files_to_callbacks(files)
        relax(
            files, config=cfg,
            tier_of=lambda f: f.tier, set_tier=set_tier,
            n_of=lambda f: f.n, tokens_of=lambda f: f.tokens,
            key_of=lambda f: f.key,
        )
        # Climbed to L1 — the topmost flux-reachable tier.
        assert files[0].tier == L1_IDX

    def test_v_le_zero_does_not_fire_active_to_l3(self) -> None:
        """V ≤ 0 (lower has no/less tokens) → no flux upward.

        Empty lower tier means t_lower=0 and t_upper>0, so V<0.
        The rectified clamp drops to 0; no Active→L3 fire.
        """
        cfg = _test_config()
        files = [_StubFile("l3.py", L3_IDX, 6, 5000)]  # only L3 has tokens
        set_tier, _ = _files_to_callbacks(files)
        stats = relax(
            files, config=cfg,
            tier_of=lambda f: f.tier, set_tier=set_tier,
            n_of=lambda f: f.n, tokens_of=lambda f: f.tokens,
            key_of=lambda f: f.key,
        )
        # Active→L3 has V=−5000 < 0 → rectified to 0, no fire.
        # L3→L2 has V=+5000, c_lower=1 → would fire upward; that's
        # legitimate (paper §3.2 — promotion when V_lower > V_upper).
        # The assertion: no Active→L3 fire (membrane 0).
        assert all(m_idx != 0 for m_idx, _ in stats.moves)

    def test_no_flux_when_all_v_at_or_below_zero(self) -> None:
        """All membranes at V≤0 across the stack → no moves.

        Place a single resident at L1 with no occupants below.
        Every live membrane sees t_lower=0, t_upper>0 (or both
        zero); the rectified clamp clamps Φ to zero across the
        board and the loop self-arrests on the first pass.
        """
        cfg = _test_config()
        files = [_StubFile("l1.py", L1_IDX, 12, 5000)]
        set_tier, moves = _files_to_callbacks(files)
        stats = relax(
            files, config=cfg,
            tier_of=lambda f: f.tier, set_tier=set_tier,
            n_of=lambda f: f.n, tokens_of=lambda f: f.tokens,
            key_of=lambda f: f.key,
        )
        assert stats.moves == []
        assert moves == []
        assert files[0].tier == L1_IDX

    def test_protected_files_are_not_movers(self) -> None:
        """Files flagged protected are excluded from the mover pool."""
        cfg = _test_config()
        files = [
            _StubFile("pinned.py", ACTIVE_IDX, 5, 3000),
            _StubFile("free.py", ACTIVE_IDX, 5, 5000),
        ]
        set_tier, _ = _files_to_callbacks(files)
        relax(
            files, config=cfg,
            tier_of=lambda f: f.tier, set_tier=set_tier,
            n_of=lambda f: f.n, tokens_of=lambda f: f.tokens,
            key_of=lambda f: f.key,
            is_protected=lambda f: f.key == "pinned.py",
        )
        # The free.py file moved (n_admit gate met, smallest non-
        # protected). The pinned file stayed at ACTIVE.
        assert files[0].tier == ACTIVE_IDX
        assert files[1].tier != ACTIVE_IDX

    def test_rectified_does_not_demote(self) -> None:
        """The controller never fires downward.

        L2 resident heavier than L3 → V<0 across L3→L2.
        Rectified clamp clamps to 0; the L3→L2 membrane does
        not pull the L2 file back down to L3. (The L2→L1
        membrane may fire upward — that's fine; the contract
        is "no demotion via flux", not "no upward motion".)
        """
        cfg = _test_config()
        files = [
            _StubFile("l3.py", L3_IDX, 6, 1000),
            _StubFile("l2.py", L2_IDX, 9, 10000),
        ]
        set_tier, _ = _files_to_callbacks(files)
        relax(
            files, config=cfg,
            tier_of=lambda f: f.tier, set_tier=set_tier,
            n_of=lambda f: f.n, tokens_of=lambda f: f.tokens,
            key_of=lambda f: f.key,
        )
        # The L2 file did not demote — it ends at L2 or higher.
        assert files[1].tier >= L2_IDX
        # The L3 file did not demote either.
        assert files[0].tier >= L3_IDX


# ---------------------------------------------------------------------------
# Tracker integration — FluxConfig wired in, deadband + rectification
# ---------------------------------------------------------------------------


class TestTrackerIntegration:
    """StabilityTracker wires FluxConfig and relax into update()."""

    def test_below_threshold_no_flux(self) -> None:
        """L3 resident with Φ < threshold → does not climb to L2.

        Use an L3-seeded item with a large deadband threshold
        on the L3→L2 membrane: Φ never clears, so the item
        stays at L3. The Active→L3 membrane is admission_only
        and not exercised here. Items would still graduate via
        the admission gate; the test asserts deadband behaviour
        on the flux membranes specifically.
        """
        cfg = FluxConfig(
            threshold=1e9,
            membranes=_test_config().membranes,
        )
        tracker = StabilityTracker(flux_config=cfg)
        # Seed an L3 resident directly so we test the L3→L2
        # flux membrane, not the admission gate.
        tracker._items["file:a.py"] = TrackedItem(
            "file:a.py", Tier.L3, n_value=5,
            content_hash="h1", tokens=100,
        )
        for _ in range(10):
            tracker.update({"file:a.py": _active_item("h1", 100)})
        item = tracker.get_all_items()["file:a.py"]
        # Stayed at L3 — Φ across L3→L2 never cleared the deadband.
        assert item.tier == Tier.L3

    def test_active_item_graduates_when_aged(self) -> None:
        """Aged active item with V above threshold graduates.

        With the broken-tier gate retired, flux fires every
        turn whenever Φ ≥ threshold. A sole large active item
        crosses the deadband and climbs upward without needing
        any external invalidation. The relax loop iterates to
        equilibrium so it may chain past L3 in one turn —
        assert "no longer ACTIVE" rather than a specific
        destination.
        """
        tracker = StabilityTracker(flux_config=_test_config())
        # Drive the item past the n_admit floor of 2.
        for _ in range(5):
            tracker.update({"file:a.py": _active_item("h1", 5000)})
        item = tracker.get_all_items()["file:a.py"]
        # The aged active item moved up — Active→L3 fired
        # (possibly chained higher since it's the only item
        # present).
        assert item.tier != Tier.ACTIVE

    def test_admission_floor_blocks_unaged_item(self) -> None:
        """The admission_only floor is a strict gate.

        On Active→L3 the ``n_admit`` floor is the *only* gate
        (the membrane is admission_only — no flux equation, no
        retry-without-floor). A freshly-registered item with
        n=0 cannot graduate until it has aged ``n_admit`` turns.
        """
        tracker = StabilityTracker(flux_config=_test_config())
        # Single update — item is freshly registered, n=0.
        tracker.update({"file:a.py": _active_item("h1", 5000)})
        item = tracker.get_all_items()["file:a.py"]
        # Stayed in ACTIVE — n=0 below the floor of 3.
        assert item.tier == Tier.ACTIVE

    def test_l2_resident_climbs_when_above_threshold(self) -> None:
        """All membranes run every turn; an L2 resident may climb to L1.

        With the broken-tier gate retired, L2→L1 fires whenever
        Φ ≥ threshold regardless of the source of invalidation.
        A sole heavy L2 resident with empty L1 has positive flux
        across L2→L1 and climbs.
        """
        tracker = StabilityTracker(flux_config=_test_config())
        # Seed an L2 resident directly.
        tracker._items["file:l2.py"] = TrackedItem(
            "file:l2.py", Tier.L2, n_value=9,
            content_hash="h1", tokens=5000,
        )
        # Drive a cycle.
        tracker.update(
            {"file:l2.py": _active_item("h1", 5000)}
        )
        item = tracker.get_all_items()["file:l2.py"]
        # L2 resident climbed to L1 — empty upper, positive flux.
        assert item.tier == Tier.L1

    def test_pinned_item_protected_from_flux(self) -> None:
        """Pinned items are excluded from the mover pool."""
        tracker = StabilityTracker(flux_config=_test_config())
        # Seed a pinned active item directly so the pin is in
        # place before the first relax pass — otherwise the
        # registration-cycle flux fires before we get a chance
        # to set the pin attribute.
        seeded = TrackedItem(
            "file:a.py", Tier.ACTIVE, n_value=0,
            content_hash="h1", tokens=5000,
        )
        seeded._pinned = True  # type: ignore[attr-defined]
        tracker._items["file:a.py"] = seeded
        # Run several cycles that would normally graduate the
        # item.
        for _ in range(5):
            tracker.update({"file:a.py": _active_item("h1", 5000)})
        item = tracker.get_all_items()["file:a.py"]
        # Stayed in ACTIVE — pin protected it from the flux move.
        assert item.tier == Tier.ACTIVE

    def test_deletion_marker_protected_from_flux(self) -> None:
        """Deletion-marker items are excluded from the mover pool.

        Once a file is marked deleted, its entry is preserved as
        a constant marker and must not be promoted by flux —
        the marker is a placeholder, not a meaningful candidate
        for upward movement.
        """
        tracker = StabilityTracker(flux_config=_test_config())
        # Drive the item up so age is past floor.
        for _ in range(5):
            tracker.update(
                {"file:a.py": _active_item("h1", 5000)},
                existing_files={"a.py"},
            )
        # Now the file gets deleted on disk → Phase 0 transitions
        # the entry to a deletion marker.
        tracker.update(
            {"file:a.py": _active_item("h1", 5000)},
            existing_files=set(),
        )
        # Deletion marker is in place — entry survives.
        assert tracker.is_deleted("file:a.py")
        marker_tier_before = tracker.get_all_items()["file:a.py"].tier
        tracker.update(
            {"file:a.py": _active_item(
                tracker.get_all_items()["file:a.py"].content_hash,
                1000,
            )},
            existing_files=set(),
        )
        item = tracker.get_all_items()["file:a.py"]
        # Marker stays where the deletion put it — no flux move.
        assert item.tier == marker_tier_before

    def test_flux_move_change_log_format(self) -> None:
        """Successful flux move logs as 'src → dst: key (flux)'.

        The log format is consumed by the HUD; the suffix
        distinguishes flux moves from other transitions
        (hash changes, deletion markers, history piggyback).
        """
        tracker = StabilityTracker(flux_config=_test_config())
        for _ in range(5):
            tracker.update({"file:a.py": _active_item("h1", 5000)})
        changes = tracker.get_changes()
        flux_entries = [c for c in changes if "(flux)" in c]
        assert flux_entries, (
            f"expected at least one flux move logged; got: {changes}"
        )
        assert any(
            "active → L3" in c and "file:a.py" in c
            for c in flux_entries
        )

    def test_l1_to_l0_membrane_absent(self) -> None:
        """L1→L0 is structurally absent — nothing climbs into L0 via flux.

        L0 is content-typed (D27); promotion into L0 is
        ``backfill_l0_after_measurement``'s sole responsibility.
        LIVE_MEMBRANES omits the (L1_IDX, L0_IDX) pair.
        """
        assert (L1_IDX, L0_IDX) not in LIVE_MEMBRANES
        # Verify integration: an L1 resident does not climb to
        # L0 under any flux — there is no membrane for it.
        tracker = StabilityTracker(flux_config=_test_config())
        tracker._items["file:l1.py"] = TrackedItem(
            "file:l1.py", Tier.L1, n_value=12,
            content_hash="h1", tokens=5000,
        )
        tracker.update(
            {"file:l1.py": _active_item("h1", 5000)}
        )
        # L1 resident stays at L1 — there is no membrane
        # capable of moving it into L0.
        assert tracker.get_all_items()["file:l1.py"].tier == Tier.L1
