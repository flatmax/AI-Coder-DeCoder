"""Membrane / flux controller for cache-tier promotion.

Implements the rectified-GHK flux controller of Flax 2026,
*A Biophysically-Inspired Feedback Controller for Multi-Class
Cache Fairness*, specialised for AC-DC's single-tenant single-
class workload.

The flux equation is GHK with a hard zero clamp on negative
values (controller never drives demotion — only edits and
explicit invalidations move content downward):

    Φ = max(0, P · V · (c_l − c_u · exp(−V/V_T))
                / (1 − exp(−V/V_T)))

with a Taylor branch near ``|V/V_T| < 1e-9``. Default parameters
(``P = 1.616399379428934e-06``, ``V_T = 98952.34312610888``,
``n_admit = 2`` on Active→L3, ``0`` on higher membranes) come
from the synth-tuner's headline fit on the 4-membrane stack
(``runs/opt-run2/best_params.json`` in
``~/flatmax/personal.work/research/cache.tiering``). The tune
was originally bidirectional; for the rectified clamp the same
P/V_T are a sound starting point — re-tune later for the last
few percent.

The relaxation loop iterates to local flux equilibrium per turn
(no cross-turn accumulator) — the rectified GHK form self-arrests
as V → 0, so persistent integration was an artefact of integer
mover discretisation rather than physics.

Spec authority: ``specs4/3-llm/cache-tiering.md``,
``specs4/impl-history/decisions.md`` D35.
Reference implementation: synth/model.py and
cache_membrane/state.py in ``~/flatmax/personal.work/research/cache.tiering``.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Sequence

logger = logging.getLogger(__name__)


# Tier index convention matches the reference model: 0 = ACTIVE
# (entry tier, uncached), 1 = L3, 2 = L2, 3 = L1, 4 = L0. Higher
# index = more stable. Files climb upward across membranes; only
# edits move them down.
ACTIVE_IDX = 0
L3_IDX = 1
L2_IDX = 2
L1_IDX = 3
L0_IDX = 4

# Live membranes. Under D36 every tier participates in flux —
# the system prompt is the only non-flux head anchor and is not
# a tracker entry, so the controller spans Active → L0 uniformly.
LIVE_MEMBRANES: tuple[tuple[int, int], ...] = (
    (ACTIVE_IDX, L3_IDX),
    (L3_IDX, L2_IDX),
    (L2_IDX, L1_IDX),
    (L1_IDX, L0_IDX),
)


_GHK_OVERFLOW_RATIO = 50.0
_GHK_TAYLOR_EPS = 1e-9


# Tuned defaults sourced from runs/opt-run2/best_params.json
# (synth-tuner headline fit). Original tune ran bidirectional;
# the same P/V_T are a sound starting point under rectified
# clamp — re-tune later for the last few percent.
_DEFAULT_P = 1.616399379428934e-06
_DEFAULT_V_T = 98952.34312610888
_DEFAULT_N_ADMIT_ACTIVE = 3  # Active→L3 admission age (turns).


@dataclass(frozen=True)
class MembraneParams:
    """Per-membrane tunables.

    - ``P`` — permeability / overall flow rate. (Unused on
      admission-only membranes.)
    - ``V_T`` — soft-knee voltage scale, in token units. Larger
      values flatten the response (linear regime); smaller values
      sharpen it (saturation regime). (Unused on admission-only
      membranes.)
    - ``n_admit`` — minimum age (in turns since last edit) for a
      file to be eligible to climb this membrane. On
      admission-only membranes this is the *promotion threshold*
      and the only gate; on flux membranes it is a soft prefer-
      aged-movers rule (the loop retries without it if no aged
      candidate exists).
    - ``pick_mode`` — within-tier mover-pick rule:

        - ``"smallest"`` (default): smallest tokens then largest
          ``n``, then key — promotes the cheapest stable item.
        - ``"oldest"``: largest ``n``, then smallest tokens, then
          key — promotes the longest-aged item.
    - ``admission_only`` — when True the membrane bypasses the
      flux equation and fires whenever an aged-enough mover
      exists (``n ≥ n_admit``). Used on Active→L3, where V
      coupling degenerates: active is structurally lighter than
      the cache (active items get promoted out as they age, so
      total active token mass tends to *decrease* relative to
      L3+), making V negative and rectified Φ permanently zero.
      The biophysical model is right for cache↔cache balancing
      but wrong for the admission boundary, which is fundamentally
      an age-based gate, not a mass-balance gate.
    """

    P: float = _DEFAULT_P
    V_T: float = _DEFAULT_V_T
    n_admit: int = 0
    pick_mode: str = "smallest"
    admission_only: bool = False


@dataclass(frozen=True)
class FluxConfig:
    """Resolved flux controller config for one tracker.

    Constructed once at tracker init from
    ``ConfigManager.cache_tiering_config``; immutable thereafter.

    Only the rectified-GHK variant is supported — the linear and
    bidirectional-GHK variants from earlier revisions are
    retired.
    """

    threshold: float = 1.0
    membranes: tuple[
        MembraneParams,
        MembraneParams,
        MembraneParams,
        MembraneParams,
    ] = (
        MembraneParams(
            P=_DEFAULT_P, V_T=_DEFAULT_V_T,
            n_admit=_DEFAULT_N_ADMIT_ACTIVE, pick_mode="oldest",
            admission_only=True,
        ),
        MembraneParams(
            P=_DEFAULT_P, V_T=_DEFAULT_V_T,
            n_admit=0, pick_mode="smallest",
        ),
        MembraneParams(
            P=_DEFAULT_P, V_T=_DEFAULT_V_T,
            n_admit=0, pick_mode="smallest",
        ),
        MembraneParams(
            P=_DEFAULT_P, V_T=_DEFAULT_V_T,
            n_admit=0, pick_mode="smallest",
        ),
    )

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "FluxConfig":
        """Build from the dict returned by `cache_tiering_config`.

        Falls back to defaults for any missing or malformed
        fields — `ConfigManager.cache_tiering_config` already
        normalises everything, but we accept raw dicts too so
        tests can construct configs without going through
        `ConfigManager`.
        """
        try:
            threshold = float(data.get("flux_threshold", 1.0))
        except (TypeError, ValueError):
            threshold = 1.0
        if threshold <= 0.0:
            threshold = 1.0

        defaults = (
            MembraneParams(
                P=_DEFAULT_P, V_T=_DEFAULT_V_T,
                n_admit=_DEFAULT_N_ADMIT_ACTIVE, pick_mode="oldest",
                admission_only=True,
            ),
            MembraneParams(
                P=_DEFAULT_P, V_T=_DEFAULT_V_T,
                n_admit=0, pick_mode="smallest",
            ),
            MembraneParams(
                P=_DEFAULT_P, V_T=_DEFAULT_V_T,
                n_admit=0, pick_mode="smallest",
            ),
            MembraneParams(
                P=_DEFAULT_P, V_T=_DEFAULT_V_T,
                n_admit=0, pick_mode="smallest",
            ),
        )
        raw = data.get("membranes") or []
        if not isinstance(raw, list):
            raw = []
        membranes: list[MembraneParams] = []
        for idx, default in enumerate(defaults):
            entry = raw[idx] if idx < len(raw) else {}
            if not isinstance(entry, dict):
                entry = {}
            try:
                p_val = float(entry.get("P", default.P))
            except (TypeError, ValueError):
                p_val = default.P
            try:
                vt_val = float(entry.get("V_T", default.V_T))
            except (TypeError, ValueError):
                vt_val = default.V_T
            try:
                n_admit = int(entry.get("n_admit", default.n_admit))
            except (TypeError, ValueError):
                n_admit = default.n_admit
            if n_admit < 0:
                n_admit = 0
            pick = entry.get("pick_mode", default.pick_mode)
            if pick not in {"smallest", "oldest"}:
                pick = default.pick_mode
            admission_only = bool(
                entry.get("admission_only", default.admission_only)
            )
            membranes.append(
                MembraneParams(
                    P=p_val, V_T=vt_val, n_admit=n_admit,
                    pick_mode=pick, admission_only=admission_only,
                )
            )
        return cls(
            threshold=threshold,
            membranes=tuple(membranes),  # type: ignore[arg-type]
        )


def ghk_flux(
    c_lower: int,
    t_lower: float,
    t_upper: float,
    params: MembraneParams,
    c_upper: int = 0,
) -> float:
    """GHK two-sided flux (paper §3.3) — signed value.

    `Φ = P · V · (c_lower − c_upper · exp(−V / V_T))
         / (1 − exp(−V / V_T))`

    Sign of Φ encodes direction:

    - **Φ > 0** — upward flux (lower → upper)
    - **Φ < 0** — downward flux (upper → lower)
    - **Φ = 0** — at equilibrium (V = V_rev)

    The caller (:func:`compute_flux`) applies the rectification
    clamp on the way out.

    Numerical guards:

    - ``|V/V_T| < 1e-9`` — Taylor branch:
      `Φ ≈ P · V_T · (c_lower − c_upper)`.
    - ``V/V_T > 50`` — upward asymptote: `Φ → P · V · c_lower`.
    - ``V/V_T < -50`` — downward asymptote: `Φ → P · V · c_upper`.
    """
    if params.V_T == 0.0:
        return 0.0
    V = t_lower - t_upper
    ratio = V / params.V_T
    if abs(ratio) < _GHK_TAYLOR_EPS:
        return params.P * params.V_T * (c_lower - c_upper)
    if ratio > _GHK_OVERFLOW_RATIO:
        return params.P * V * c_lower
    if ratio < -_GHK_OVERFLOW_RATIO:
        return params.P * V * c_upper
    exp_term = math.exp(-ratio)
    numerator = c_lower - c_upper * exp_term
    denom = 1.0 - exp_term
    return params.P * V * numerator / denom


def compute_flux(
    c_lower: int,
    t_lower: float,
    t_upper: float,
    c_upper: int,
    params: MembraneParams,
) -> float:
    """Rectified GHK flux — never negative.

    Hard clamp on the lower side: the controller is one-way
    (upward only). Demotion is the responsibility of the edit
    invariant (hash mismatch teleports to Active) and explicit
    invalidations (selection change, deletion marker, etc.) —
    never the flux equation.
    """
    return max(0.0, ghk_flux(c_lower, t_lower, t_upper, params, c_upper=c_upper))


# ---------------------------------------------------------------------------
# Mover pick
# ---------------------------------------------------------------------------


def pick_mover(
    files: Sequence[Any],
    *,
    tier_idx: int,
    n_admit: int,
    pick_mode: str,
    tier_of: Callable[[Any], int],
    n_of: Callable[[Any], int],
    tokens_of: Callable[[Any], float],
    key_of: Callable[[Any], str],
    excluded: Iterable[Any] = (),
) -> Any | None:
    """Select the best mover from ``tier_idx`` to climb upward.

    Eligibility: ``tier_of(file) == tier_idx`` and
    ``n_of(file) >= n_admit`` and ``file not in excluded``.

    ``pick_mode``:

    - ``"smallest"`` — primary: smallest tokens (cheapest
      promotion preserves cache headroom). Secondary: largest
      ``n`` (longest-aged). Tertiary: key for determinism.
    - ``"oldest"``  — primary: largest ``n``. Secondary: smallest
      tokens. Tertiary: key.

    Returns the chosen file or None if no eligible candidate.

    A retry-without-floor fallback is *not* performed here — the
    caller (the relaxation loop) decides whether to retry with
    n_admit=0; otherwise the floor is honoured strictly.
    """
    excluded_set = set(id(x) for x in excluded)
    best = None
    best_key: tuple[Any, ...] | None = None
    for f in files:
        if id(f) in excluded_set:
            continue
        if tier_of(f) != tier_idx:
            continue
        if n_of(f) < n_admit:
            continue
        if pick_mode == "oldest":
            cmp_key = (-n_of(f), tokens_of(f), key_of(f))
        else:
            cmp_key = (tokens_of(f), -n_of(f), key_of(f))
        if best_key is None or cmp_key < best_key:
            best = f
            best_key = cmp_key
    return best


# ---------------------------------------------------------------------------
# Relaxation loop
# ---------------------------------------------------------------------------


@dataclass
class RelaxationStats:
    """Telemetry for one call to :func:`relax`."""

    iters: int = 0
    moves: list[tuple[int, str]] = None  # type: ignore[assignment]
    fired_via_flux: int = 0
    fired_via_backstop: int = 0

    def __post_init__(self) -> None:
        if self.moves is None:
            self.moves = []


_MAX_RELAX_ITERS = 1000


def relax(
    files: list[Any],
    *,
    config: FluxConfig,
    tier_of: Callable[[Any], int],
    set_tier: Callable[[Any, int], None],
    n_of: Callable[[Any], int],
    tokens_of: Callable[[Any], float],
    key_of: Callable[[Any], str],
    is_protected: Callable[[Any], bool] = lambda f: False,
    is_balance_excluded: Callable[[Any], bool] = lambda f: False,
    max_moves: int | None = None,
) -> RelaxationStats:
    """Iterate to within-turn flux equilibrium.

    Each pass:

    1. For every live membrane ``(lower, upper)``, recompute V
       and Φ from current tier counts/tokens.
    2. If ``Φ >= config.threshold`` and an eligible mover
       exists, move it and add to ``stats.moves``.
    3. Tier counts update immediately, so neighbouring
       membranes share state on the next pass.

    Direction is fixed by the rectification clamp on
    :func:`compute_flux` (Φ ≥ 0 — upward only); the deadband
    threshold absorbs steady-state noise, so quiet turns
    (V ≈ 0 across all membranes) self-arrest without firing.

    Per-call iteration cap is :data:`_MAX_RELAX_ITERS` (1000) —
    the rectified GHK form self-arrests within a single turn so
    this cap is defensive against parameter pathologies, never
    expected to bind in practice.

    Protected files (pinned files, deletion markers) are not
    selectable as movers — the caller's ``is_protected`` predicate
    returns True for them.

    Balance-excluded files (D37 — ``history:*`` entries) are
    skipped from V/c accumulation entirely so they neither
    inflate ``c_lower``/``c_upper`` nor ``t_lower``/``t_upper``.
    The caller's ``is_balance_excluded`` predicate returns True
    for them. Distinct from ``is_protected``: pinned files still
    contribute mass to V/c (their bytes really are in their
    tier) but cannot be picked as movers.

    Returns a :class:`RelaxationStats` record. ``moves`` is a list
    of ``(membrane_idx, key)`` tuples in firing order.
    """
    stats = RelaxationStats()
    if max_moves == 0:
        return stats

    threshold = config.threshold

    for it in range(_MAX_RELAX_ITERS):
        moved_any = False
        for m_idx, (lower, upper) in enumerate(LIVE_MEMBRANES):
            params = config.membranes[m_idx]

            if params.admission_only:
                # Age-gated admission: no flux equation, no V
                # coupling. Fire whenever an aged-enough mover
                # exists. Used on Active→L3 where V degenerates
                # (active is structurally lighter than the
                # cache).
                mover = pick_mover(
                    files,
                    tier_idx=lower,
                    n_admit=params.n_admit,
                    pick_mode=params.pick_mode,
                    tier_of=tier_of,
                    n_of=n_of,
                    tokens_of=tokens_of,
                    key_of=key_of,
                    excluded=[f for f in files if is_protected(f)],
                )
                if mover is None:
                    continue
                set_tier(mover, upper)
                stats.fired_via_flux += 1
                stats.moves.append((m_idx, key_of(mover)))
                moved_any = True
                if max_moves is not None and len(stats.moves) >= max_moves:
                    stats.iters = it + 1
                    return stats
                continue

            c_lower = 0
            c_upper = 0
            t_lower = 0.0
            t_upper = 0.0
            for f in files:
                if is_balance_excluded(f):
                    continue
                t = tier_of(f)
                if t == lower:
                    c_lower += 1
                    t_lower += tokens_of(f)
                elif t == upper:
                    c_upper += 1
                    t_upper += tokens_of(f)

            if c_lower == 0 and c_upper == 0:
                continue

            phi = compute_flux(c_lower, t_lower, t_upper, c_upper, params)

            if phi < threshold:
                continue

            mover = pick_mover(
                files,
                tier_idx=lower,
                n_admit=params.n_admit,
                pick_mode=params.pick_mode,
                tier_of=tier_of,
                n_of=n_of,
                tokens_of=tokens_of,
                key_of=key_of,
                excluded=[f for f in files if is_protected(f)],
            )
            if mover is None and params.n_admit > 0:
                # Retry without the admission floor — on flux
                # membranes the floor is a soft prefer-aged-
                # movers rule, not a strict gate.
                mover = pick_mover(
                    files,
                    tier_idx=lower,
                    n_admit=0,
                    pick_mode=params.pick_mode,
                    tier_of=tier_of,
                    n_of=n_of,
                    tokens_of=tokens_of,
                    key_of=key_of,
                    excluded=[f for f in files if is_protected(f)],
                )
            if mover is None:
                continue
            set_tier(mover, upper)

            stats.fired_via_flux += 1
            stats.moves.append((m_idx, key_of(mover)))
            moved_any = True
            if max_moves is not None and len(stats.moves) >= max_moves:
                stats.iters = it + 1
                return stats

        if not moved_any:
            stats.iters = it + 1
            return stats

    # Falling off the loop is a correctness violation under the
    # rectified variant (it self-arrests as V → 0). Most likely
    # cause: pathological params, or a caller mutating tiers
    # mid-relaxation.
    stats.iters = _MAX_RELAX_ITERS
    logger.warning(
        "cache_membrane.relax: reached %d iterations without convergence "
        "(moves=%d) — check params",
        _MAX_RELAX_ITERS,
        len(stats.moves),
    )
    return stats
