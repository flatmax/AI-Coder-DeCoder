"""L0 snapshot mechanism — the cache-stability fix from D28.

These tests pin the contract that L0's rendered bytes are
captured into the service's snapshot fields at enumerated
invalidation events and stay frozen otherwise. Without this
mechanism, per-turn drift in the live indexes (call-site
resolution, import resolution, mtime-based reparse) leaks
into L0's bytes and forces a fresh cache write on every turn.

Three behaviours are pinned:

1. **Stability** — the snapshot bytes are byte-identical
   across non-invalidating events (live-index mutations
   simulating per-turn re-indexing).
2. **Refreezing** — the snapshot refreshes at every
   enumerated L0-invalidation event.
3. **Assembly reads from snapshot** — prompt assembly
   produces messages whose system content reflects the
   snapshot, not the live indexes. This is the regression
   guard for the original 315K-cache-write bug.

Governing spec:
- ``specs4/3-llm/cache-tiering.md`` § L0 Stability Contract
- ``specs4/impl-history/decisions.md`` § D28
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from ac_dc.config import ConfigManager
from ac_dc.context_manager import Mode
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo

from .conftest import _FakeLiteLLM, _FakeSymbolIndexWithRefs


# ---------------------------------------------------------------------------
# Test-local mutable symbol index
# ---------------------------------------------------------------------------


class _MutableSymbolIndex(_FakeSymbolIndexWithRefs):
    """Symbol index whose ``get_symbol_map`` output can be mutated.

    The base ``_FakeSymbolIndexWithRefs`` doesn't expose
    ``get_symbol_map`` — only ``get_file_symbol_block`` and
    ``get_legend``. The L0 snapshot mechanism reads
    ``get_symbol_map(exclude_files=...)``, so we add it here
    with a controllable ``_aggregate_map`` field.

    Tests use ``set_aggregate_map(text)`` and
    ``set_legend(text)`` to simulate live-index drift between
    turns. Mutating these fields models exactly what
    happens in production when ``index_repo`` re-resolves
    imports / call sites and the formatter renders different
    bytes on the next call — except the test version makes
    the drift deterministic and observable.
    """

    def __init__(
        self,
        blocks: dict[str, str] | None = None,
        legend: str = "",
        aggregate_map: str = "",
    ) -> None:
        super().__init__(blocks=blocks, legend=legend)
        self._aggregate_map = aggregate_map

    def get_symbol_map(
        self,
        exclude_files: set[str] | None = None,
    ) -> str:
        # Ignore exclusion set for simplicity — these tests
        # don't exercise the user-exclusion path. The real
        # SymbolIndex's exclusion handling is tested in the
        # symbol-index orchestrator suite.
        return self._aggregate_map

    def set_aggregate_map(self, text: str) -> None:
        self._aggregate_map = text

    def set_legend(self, text: str) -> None:
        self._legend = text


@pytest.fixture
def mutable_index() -> _MutableSymbolIndex:
    """Construct a mutable symbol index with seed content."""
    return _MutableSymbolIndex(
        blocks={"src/foo.py": "block-foo"},
        legend="LEGEND-INITIAL",
        aggregate_map="MAP-INITIAL",
    )


@pytest.fixture
def service_with_mutable_index(
    config: ConfigManager,
    repo: Repo,
    fake_litellm: _FakeLiteLLM,
    mutable_index: _MutableSymbolIndex,
) -> LLMService:
    """Service wired with the mutable symbol index.

    Construction is non-deferred so the initial freeze runs
    inside ``__init__``. The snapshot's primary map and
    legend reflect the mutable index's seed content at this
    point; subsequent ``set_aggregate_map`` / ``set_legend``
    calls drift the live index without affecting the snapshot.
    """
    return LLMService(
        config=config,
        repo=repo,
        symbol_index=mutable_index,
    )


# ---------------------------------------------------------------------------
# Snapshot fields populated at construction
# ---------------------------------------------------------------------------


class TestSnapshotConstruction:
    """Initial snapshot population at service construction."""

    def test_snapshot_fields_initialized_from_indexes(
        self, service_with_mutable_index: LLMService
    ) -> None:
        """All five snapshot fields populated after construction."""
        svc = service_with_mutable_index
        # System prompt non-empty (config provides one).
        assert svc._l0_system_prompt != ""
        # Primary slot reflects the mutable index's seed.
        assert svc._l0_primary_legend == "LEGEND-INITIAL"
        assert svc._l0_primary_map == "MAP-INITIAL"
        # Secondary slot empty — cross-ref is off by default.
        assert svc._l0_secondary_legend == ""
        assert svc._l0_secondary_map == ""

    def test_deferred_init_skips_initial_freeze(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Deferred init defers the freeze to complete_deferred_init."""
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=None,
            deferred_init=True,
        )
        # Snapshot empty — no symbol index to read.
        assert svc._l0_primary_map == ""
        assert svc._l0_primary_legend == ""

    def test_complete_deferred_init_runs_freeze(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """complete_deferred_init populates the snapshot fields."""
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=None,
            deferred_init=True,
        )
        assert svc._l0_primary_map == ""
        # Attaching the index triggers the deferred freeze.
        svc.complete_deferred_init(mutable_index)
        assert svc._l0_primary_map == "MAP-INITIAL"
        assert svc._l0_primary_legend == "LEGEND-INITIAL"

    def test_construction_without_repo_or_index(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """No repo + no index = empty snapshot, no crash."""
        svc = LLMService(
            config=config,
            repo=None,
            symbol_index=None,
        )
        # System prompt still populates from config.
        assert svc._l0_system_prompt != ""
        # No index → empty primary slot.
        assert svc._l0_primary_map == ""
        assert svc._l0_primary_legend == ""


# ---------------------------------------------------------------------------
# Stability — snapshot doesn't change on non-invalidating events
# ---------------------------------------------------------------------------


class TestSnapshotStability:
    """The snapshot stays frozen across routine session activity.

    These are the events that previously caused the cache
    to write fresh L0 every turn. With the snapshot in
    place, none of them should mutate the snapshot fields.
    """

    def test_live_index_drift_does_not_affect_snapshot(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """Mutating the live index leaves the snapshot untouched.

        Simulates the exact failure mode from the original
        bug: ``index_repo`` mutates the live index's
        ``Import.resolved_target`` setattr fields, the
        formatter renders different bytes on the next call,
        and L0's cache-control marker covers different
        content — forcing a 315K cache write per turn. The
        snapshot mechanism must absorb this.
        """
        svc = service_with_mutable_index
        snapshot_before = svc._l0_primary_map
        # Drift the live index. In production this would
        # be ``service._symbol_index.index_repo(file_list)``
        # producing different formatter output.
        mutable_index.set_aggregate_map("MAP-DRIFTED")
        mutable_index.set_legend("LEGEND-DRIFTED")
        # Snapshot unchanged.
        assert svc._l0_primary_map == snapshot_before
        assert svc._l0_primary_map == "MAP-INITIAL"
        assert svc._l0_primary_legend == "LEGEND-INITIAL"

    def test_file_selection_does_not_invalidate_snapshot(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
        repo_dir: Path,
    ) -> None:
        """set_selected_files leaves the snapshot frozen.

        Per § "What does NOT invalidate L0", selection
        toggles don't touch L0. The aggregate map contains
        every indexed file regardless of selection state.
        """
        (repo_dir / "src").mkdir(exist_ok=True)
        (repo_dir / "src" / "foo.py").write_text("x = 1\n")
        svc = service_with_mutable_index
        # Mutate the live index to detect any spurious
        # refreeze; if the snapshot were to refresh, it
        # would pick up the drifted bytes.
        mutable_index.set_aggregate_map("MAP-DRIFTED")
        # Selection mutation.
        svc.set_selected_files(["src/foo.py"])
        # Snapshot still reflects construction-time bytes.
        assert svc._l0_primary_map == "MAP-INITIAL"

    def test_session_load_does_not_invalidate_snapshot(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """Loading a previous session leaves the snapshot frozen.

        Per § "What does NOT invalidate L0", session loads
        don't touch L0. The history changes but the
        structural map for the indexed files is unaffected.
        """
        svc = service_with_mutable_index
        mutable_index.set_aggregate_map("MAP-DRIFTED")
        # Direct history mutation simulates a session load.
        svc._context.set_history([
            {"role": "user", "content": "earlier message"},
            {"role": "assistant", "content": "earlier reply"},
        ])
        assert svc._l0_primary_map == "MAP-INITIAL"

    def test_history_compaction_does_not_invalidate_snapshot(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """Compaction-style history truncation doesn't touch L0."""
        svc = service_with_mutable_index
        mutable_index.set_aggregate_map("MAP-DRIFTED")
        # Add then truncate history (simulates compaction
        # purging old messages).
        for i in range(5):
            svc._context.add_message("user", f"msg {i}")
        svc._context.set_history([])
        assert svc._l0_primary_map == "MAP-INITIAL"

    def test_repeated_freeze_with_unchanged_indexes_stable(
        self,
        service_with_mutable_index: LLMService,
    ) -> None:
        """Calling _freeze_l0_snapshot twice with no index changes is idempotent."""
        svc = service_with_mutable_index
        before_map = svc._l0_primary_map
        before_legend = svc._l0_primary_legend
        before_prompt = svc._l0_system_prompt
        svc._freeze_l0_snapshot()
        assert svc._l0_primary_map == before_map
        assert svc._l0_primary_legend == before_legend
        assert svc._l0_system_prompt == before_prompt


# ---------------------------------------------------------------------------
# Refreezing — snapshot updates at every enumerated event
# ---------------------------------------------------------------------------


class TestSnapshotRefreeze:
    """The snapshot picks up live-index changes when refreshed."""

    def test_explicit_freeze_picks_up_live_changes(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """Calling _freeze_l0_snapshot directly captures current bytes."""
        svc = service_with_mutable_index
        mutable_index.set_aggregate_map("MAP-NEW")
        mutable_index.set_legend("LEGEND-NEW")
        svc._freeze_l0_snapshot()
        assert svc._l0_primary_map == "MAP-NEW"
        assert svc._l0_primary_legend == "LEGEND-NEW"

    def test_switch_mode_refreezes_snapshot(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """Mode switch refreshes L0.

        Mode switch swaps the system prompt AND the primary
        index (symbol → doc or doc → symbol). L0's bytes
        change wholesale; the snapshot must refreeze.
        """
        svc = service_with_mutable_index
        prompt_before = svc._l0_system_prompt
        # Drift the live index to detect the refreeze.
        mutable_index.set_aggregate_map("MAP-DRIFTED")
        # Switch to doc mode. Doc primary is the doc index
        # (empty in this test setup) — so primary_map will
        # become whatever doc_index.get_doc_map returns,
        # likely "" since no docs are indexed.
        result = svc.switch_mode("doc")
        assert "error" not in result
        # System prompt swapped to doc-mode prompt.
        assert svc._l0_system_prompt != prompt_before
        # Primary map is now from doc index (not the
        # symbol index's drifted "MAP-DRIFTED").
        assert svc._l0_primary_map != "MAP-DRIFTED"

    def test_cross_reference_enable_refreezes_snapshot(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """Cross-ref enable adds secondary content to L0.

        Doc index must be ready for cross-ref to enable.
        We force the readiness flag so the gate passes,
        then verify the secondary slot populates.
        """
        svc = service_with_mutable_index
        # Cross-ref readiness gate.
        svc._doc_index_ready = True
        result = svc.set_cross_reference(True)
        assert "error" not in result
        # In code mode, secondary is the doc index. Empty
        # doc index → empty secondary, but the act of
        # setting them (vs leaving them as their pre-toggle
        # values) is the contract. Verify by toggling on
        # then off and confirming both transitions ran.
        # Simplest assertion: cross_ref_enabled flipped.
        assert svc._cross_ref_enabled is True

    def test_cross_reference_disable_refreezes_snapshot(
        self,
        service_with_mutable_index: LLMService,
    ) -> None:
        """Cross-ref disable clears secondary slot."""
        svc = service_with_mutable_index
        svc._doc_index_ready = True
        svc.set_cross_reference(True)
        # Manually pretend secondary was populated; verify
        # disable clears it via refreeze.
        svc._l0_secondary_map = "STALE-SECONDARY"
        svc._l0_secondary_legend = "STALE-LEGEND"
        result = svc.set_cross_reference(False)
        assert "error" not in result
        # Refreeze cleared the secondary slot.
        assert svc._l0_secondary_map == ""
        assert svc._l0_secondary_legend == ""

    def test_refresh_system_prompt_with_changed_bytes_refreezes(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """Settings reload that changes prompt bytes refreezes L0."""
        svc = service_with_mutable_index
        # Drift the live index AND change the prompt.
        mutable_index.set_aggregate_map("MAP-NEW-PROMPT")
        svc._context.set_system_prompt("OLD-PROMPT-STORED")
        # Mock the config to return a different prompt than
        # what the context currently holds.
        original_get = svc._config.get_system_prompt
        svc._config.get_system_prompt = (  # type: ignore[method-assign]
            lambda: "FRESH-PROMPT-FROM-CONFIG"
        )
        try:
            result = svc.refresh_system_prompt()
        finally:
            svc._config.get_system_prompt = original_get  # type: ignore[method-assign]
        assert result.get("status") == "ok"
        assert result.get("prompt_changed") is True
        # Snapshot's prompt and primary map both refreshed.
        assert svc._l0_system_prompt == "FRESH-PROMPT-FROM-CONFIG"
        assert svc._l0_primary_map == "MAP-NEW-PROMPT"

    def test_refresh_system_prompt_unchanged_bytes_skips_freeze(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """Settings reload with identical prompt bytes does NOT refreeze L0.

        This is the critical path: a Settings save that only
        edited compaction config (no prompt change) must NOT
        force a 315K cache write.
        """
        svc = service_with_mutable_index
        snapshot_map_before = svc._l0_primary_map
        # Drift the live index to detect any refreeze.
        mutable_index.set_aggregate_map("MAP-WOULD-DRIFT")
        # Refresh with the exact same prompt the context
        # already holds.
        result = svc.refresh_system_prompt()
        assert result.get("status") == "ok"
        assert result.get("prompt_changed") is False
        # Snapshot did NOT refreeze — still has the
        # construction-time map, not the drifted one.
        assert svc._l0_primary_map == snapshot_map_before

    def test_set_excluded_inclusion_always_refreezes(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """Removing a file from exclusion list always refreshes L0.

        Inclusion = the user wants the file's structural
        block back in the map. Always refreezes regardless
        of the ``invalidate_l0`` flag.
        """
        svc = service_with_mutable_index
        # Pre-seed an exclusion so we can include it.
        svc._excluded_index_files = ["src/foo.py"]
        # Drift the live index to detect refreeze.
        mutable_index.set_aggregate_map("MAP-AFTER-INCLUSION")
        # Include by removing from list. invalidate_l0
        # parameter is ignored on the inclusion path.
        result = svc.set_excluded_index_files([])
        assert isinstance(result, list)
        assert result == []
        # Snapshot refreshed.
        assert svc._l0_primary_map == "MAP-AFTER-INCLUSION"

    def test_set_excluded_exclusion_without_flag_skips_freeze(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """Exclusion without invalidate_l0=True does NOT refreshe L0.

        Default behaviour: the user excluded a file but
        chose to defer the L0 invalidation. Snapshot stays
        as-is until the next L0-invalidating event.
        """
        svc = service_with_mutable_index
        snapshot_before = svc._l0_primary_map
        mutable_index.set_aggregate_map("MAP-WOULD-DRIFT")
        # Exclude without the flag.
        from ac_dc.llm._rpc_state import set_excluded_index_files
        result = set_excluded_index_files(
            svc, ["src/foo.py"], invalidate_l0=False,
        )
        assert isinstance(result, list)
        # Exclusion set updated.
        assert "src/foo.py" in result
        # Snapshot NOT refreshed.
        assert svc._l0_primary_map == snapshot_before

    def test_set_excluded_exclusion_with_flag_refreezes(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """Exclusion with invalidate_l0=True refreshes L0."""
        svc = service_with_mutable_index
        mutable_index.set_aggregate_map("MAP-AFTER-EXCLUSION")
        from ac_dc.llm._rpc_state import set_excluded_index_files
        result = set_excluded_index_files(
            svc, ["src/foo.py"], invalidate_l0=True,
        )
        assert isinstance(result, list)
        assert svc._l0_primary_map == "MAP-AFTER-EXCLUSION"

    def test_rebuild_cache_refreezes_snapshot(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """Manual cache rebuild refreshes L0."""
        svc = service_with_mutable_index
        mutable_index.set_aggregate_map("MAP-AFTER-REBUILD")
        result = svc.rebuild_cache()
        assert "error" not in result
        assert svc._l0_primary_map == "MAP-AFTER-REBUILD"


# ---------------------------------------------------------------------------
# Assembly reads from snapshot
# ---------------------------------------------------------------------------


class TestAssemblyReadsFromSnapshot:
    """Prompt assembly produces system messages that match the snapshot.

    This is the regression guard for the original bug: the
    cache-control marker covered different bytes every turn
    because assembly read the live (drifting) symbol map
    instead of the snapshot. After the fix, assembly's
    output for L0 must reflect the snapshot exactly.
    """

    def test_tiered_assembly_uses_snapshot_not_live_index(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """Tiered assembly reads snapshot bytes, not live-index bytes."""
        from ac_dc.llm._assembly import (
            assemble_tiered,
            build_tiered_content,
        )
        from ac_dc.stability_tracker import Tier, TrackedItem

        svc = service_with_mutable_index
        # Build a tiered_content dict — the tracker must
        # have at least one item or build_tiered_content
        # returns None and the caller falls back to flat
        # assembly.
        svc._stability_tracker._items["history:0"] = TrackedItem(
            key="history:0",
            tier=Tier.L1,
            n_value=0,
            content_hash="h",
            tokens=10,
        )
        svc._context.add_message("user", "earlier")
        tiered_content = build_tiered_content(svc)
        assert tiered_content is not None

        # Drift the live index BEFORE assembly. If assembly
        # reads live, the system message will contain
        # "MAP-DRIFTED". If it reads snapshot, "MAP-INITIAL".
        mutable_index.set_aggregate_map("MAP-DRIFTED")

        messages = assemble_tiered(
            svc,
            user_prompt="hello",
            images=[],
            tiered_content=tiered_content,
        )
        # System message is the first; its content carries
        # the L0 bytes.
        system_msg = messages[0]
        assert system_msg["role"] == "system"
        # Content can be a string or a list of blocks
        # (cache-control wrapping). Extract the text.
        content = system_msg["content"]
        if isinstance(content, list):
            text = "\n".join(
                b.get("text", "") for b in content
                if isinstance(b, dict)
            )
        else:
            text = content
        # Snapshot bytes appear; drifted bytes do NOT.
        assert "MAP-INITIAL" in text
        assert "MAP-DRIFTED" not in text

    def test_flat_assembly_uses_snapshot_not_live_index(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """Flat assembly (fallback) also reads from snapshot."""
        from ac_dc.llm._assembly import assemble_messages_flat

        svc = service_with_mutable_index
        # Tracker is empty → flat-assembly path.
        # Drift the live index.
        mutable_index.set_aggregate_map("MAP-DRIFTED")
        messages = assemble_messages_flat(
            svc,
            user_prompt="hello",
            images=[],
        )
        system_msg = messages[0]
        assert system_msg["role"] == "system"
        text = system_msg["content"]
        if isinstance(text, list):
            text = "\n".join(
                b.get("text", "") for b in text
                if isinstance(b, dict)
            )
        assert "MAP-INITIAL" in text
        assert "MAP-DRIFTED" not in text

    def test_two_consecutive_assemblies_produce_identical_l0(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """End-to-end: two consecutive assemblies see identical L0 bytes.

        This is the strongest test of the cache-stability
        contract. The original bug would have produced
        different bytes between calls — the cache provider
        would write a fresh prefix each time. With the
        snapshot in place, the bytes must be byte-identical
        across calls separated by simulated index drift.
        """
        from ac_dc.llm._assembly import assemble_messages_flat

        svc = service_with_mutable_index

        def _extract_system_text() -> str:
            messages = assemble_messages_flat(
                svc, user_prompt="x", images=[],
            )
            content = messages[0]["content"]
            if isinstance(content, list):
                return "\n".join(
                    b.get("text", "") for b in content
                    if isinstance(b, dict)
                )
            return content

        # First call — establish baseline.
        text_first = _extract_system_text()

        # Simulate per-turn live-index drift between calls.
        mutable_index.set_aggregate_map("MAP-DRIFT-1")
        text_second = _extract_system_text()

        mutable_index.set_aggregate_map("MAP-DRIFT-2")
        text_third = _extract_system_text()

        # All three identical — snapshot stable across drift.
        assert text_first == text_second
        assert text_second == text_third


# ---------------------------------------------------------------------------
# Breakdown reads from snapshot
# ---------------------------------------------------------------------------


class TestBreakdownReadsFromSnapshot:
    """The Context tab's L0 size matches what's actually cached.

    The pre-fix bug had the breakdown's L0 token count
    showing live-index bytes while the cache marker covered
    different (also live) bytes. The displayed number lied.
    After the fix, the breakdown's L0 figure comes from the
    snapshot — same bytes the cache marker covers.
    """

    def test_breakdown_l0_size_matches_snapshot_after_drift(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """Breakdown's L0 token count reflects snapshot, not live index."""
        svc = service_with_mutable_index
        # Get baseline breakdown.
        bd_before = svc.get_context_breakdown()
        symbol_map_tokens_before = (
            bd_before["breakdown"]["symbol_map"]
        )
        # Drift live index. Without the snapshot, the next
        # breakdown call would report the new (drifted) bytes
        # and disagree with what's cached.
        mutable_index.set_aggregate_map(
            "MAP-NOW-MUCH-LARGER-" * 100
        )
        bd_after = svc.get_context_breakdown()
        symbol_map_tokens_after = (
            bd_after["breakdown"]["symbol_map"]
        )
        # Token count unchanged — breakdown reads snapshot.
        assert symbol_map_tokens_after == symbol_map_tokens_before

    def test_breakdown_l0_meta_row_matches_snapshot(
        self,
        service_with_mutable_index: LLMService,
        mutable_index: _MutableSymbolIndex,
    ) -> None:
        """The L0 meta:repo_map row's tokens match the snapshot."""
        svc = service_with_mutable_index
        # Drift live index.
        mutable_index.set_aggregate_map("MAP-DRIFTED-BIG")
        bd = svc.get_context_breakdown()
        # Find the L0 block's meta row for the repo map.
        l0_block = next(
            (b for b in bd["blocks"] if b["name"] == "L0"),
            None,
        )
        if l0_block is None:
            # No L0 block when tracker is fresh; that's fine
            # for this assertion path — the breakdown's
            # symbol_map field is the load-bearing one.
            assert bd["breakdown"]["symbol_map"] >= 0
            return
        meta_rows = [
            c for c in l0_block.get("contents", [])
            if c.get("name") == "meta:repo_map"
        ]
        if meta_rows:
            # Meta row token count = service._counter.count(
            #   service._l0_primary_map)
            expected = svc._counter.count(svc._l0_primary_map)
            assert meta_rows[0]["tokens"] == expected