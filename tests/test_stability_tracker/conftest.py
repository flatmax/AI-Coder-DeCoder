"""Shared fakes and helpers for stability-tracker tests — Layer 3.5.

Scope: the StabilityTracker — tier assignment, N-value
tracking, cascade promotion, anchoring, demotion, stale
removal, history purge, initialisation from reference graph.

Strategy:

- Drive :meth:`StabilityTracker.update` directly with hand-built
  active-items dicts. No real symbol index; no file system. The
  tracker's logic is pure.
- Use small synthetic hashes (``"h1"``, ``"h2"``) rather than
  SHA-256 — the tracker treats hashes as opaque strings.
- Tests that exercise anchoring or underfill pass explicit
  ``cache_target_tokens`` values matched to the per-item token
  counts. Tests that exercise the simple promote/demote path
  pass ``cache_target_tokens=0`` to disable anchoring and
  underfill demotion.
- The :class:`_FakeRefIndex` doubles the reference-graph
  protocol (``connected_components``, ``file_ref_count``).
  Matches what the real :class:`ReferenceIndex` exposes.

This module is the shared conftest for the
:mod:`tests.test_stability_tracker` package; sibling test modules
import the fakes and helpers below directly.
"""

from __future__ import annotations

import pytest

from ac_dc.stability_tracker import (
    DELETION_MARKER_TEXT,
    StabilityTracker,
    Tier,
    TrackedItem,
    _DELETION_MARKER_HASH,
    _TIER_CONFIG,
)

# Convenience alias for the L3 promote threshold — used by
# tests that seed items directly into L3 and want to exercise
# promotion without reproducing the numeric literal.
_TIER_CONFIG_PROMOTE_L3 = _TIER_CONFIG[Tier.L3]["promote_n"]


# Shared xfail marker for tests that encode the legacy N-counter
# cascade semantics removed by D35 (membrane / flux controller).
# The legacy mechanisms — anchoring, underfill demotion,
# ripple-promotion-without-flux, N-threshold graduation — no
# longer exist. Tests asserting their behaviour are kept in the
# tree as historical record but excluded from CI; replacements
# covering flux-driven promotion live in ``test_membrane_flux.py``.
xfail_legacy_cascade = pytest.mark.xfail(
    reason=(
        "Legacy N-counter cascade behaviour removed by D35 "
        "(membrane / flux controller). See "
        "specs4/3-llm/cache-tiering.md and "
        "specs4/impl-history/decisions.md D35. "
        "Replacements in test_membrane_flux.py."
    ),
    strict=False,
)


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeRefIndex:
    """Stand-in for :class:`ReferenceIndex`.

    Only the two methods the tracker actually consumes —
    ``connected_components`` and ``file_ref_count`` — are
    implemented. Tests construct with a list of component sets
    plus a mapping of path → incoming reference count.
    """

    def __init__(
        self,
        components: list[set[str]] | None = None,
        ref_counts: dict[str, int] | None = None,
    ) -> None:
        self._components = components or []
        self._ref_counts = ref_counts or {}

    def connected_components(self) -> list[set[str]]:
        # Return a fresh list — caller may filter in place.
        return [set(c) for c in self._components]

    def file_ref_count(self, path: str) -> int:
        return self._ref_counts.get(path, 0)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _active_item(
    hash_value: str = "h1",
    tokens: int = 100,
) -> dict[str, object]:
    """Shorthand for the active-items dict entry shape."""
    return {"hash": hash_value, "tokens": tokens}


def _drive_n_unchanged(
    tracker: StabilityTracker,
    key: str,
    hash_value: str,
    tokens: int,
    cycles: int,
) -> None:
    """Run ``cycles`` update passes with the same item unchanged.

    Convenience for tests that need to reach a specific N value
    without repeating the update call by hand.
    """
    for _ in range(cycles):
        tracker.update({key: _active_item(hash_value, tokens)})