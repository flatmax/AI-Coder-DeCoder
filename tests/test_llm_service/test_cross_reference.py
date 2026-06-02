"""Cross-reference toggle lifecycle (L0-content-typed model).

Covers :class:`TestCrossReferenceLifecycle` —
:meth:`LLMService.set_cross_reference`. Under the
L0-content-typed model (D27) cross-reference is an
**L0-only affair**:

- The toggle flips ``service._cross_ref_enabled`` and
  broadcasts ``modeChanged``. It does NOT seed per-file
  tracker entries.
- :func:`_seed_cross_reference_items` is a no-op stub.
- :func:`_remove_cross_reference_items` is a defensive
  legacy-sweep no-op (clears any ``doc:{path}`` /
  ``symbol:{path}`` entries that might exist from a
  pre-D27 build, then does nothing).
- The secondary aggregate map is regenerated from the
  opposite-mode index at assembly time
  (:func:`ac_dc.llm._assembly.assemble_tiered`) and
  rendered into L0's system message under the secondary
  header — see ``specs4/3-llm/modes.md`` § Cross-Reference
  Mode: "Both legends included in the L0 cache block".
- :func:`get_context_breakdown` synthesizes a secondary
  ``meta:`` row in L0 alongside the primary so the cache
  viewer shows both maps.

Tests verify the new contract:

- Toggle on/off flips the flag and broadcasts; no tracker
  mutation.
- Readiness gate still applies to enable; disable always
  works.
- Mode switch resets the toggle to off.
- Assembly fetches the secondary map when the flag is on.
- Breakdown includes the secondary ``meta:`` row when on.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ac_dc.config import ConfigManager
from ac_dc.context_manager import Mode
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo

from .conftest import _FakeLiteLLM, _RecordingEventCallback


class TestCrossReferenceLifecycle:
    """set_cross_reference under the L0-content-typed model.

    Cross-reference is L0-only — the toggle flips a flag,
    the assembly path observes that flag, and no per-file
    tracker entries are created or destroyed by the
    toggle. Tests verify the flag-flipping contract, the
    readiness gate, the broadcast, and the assembly /
    breakdown observation paths.
    """

    def _make_service_with_both_indexes(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        symbol_paths: list[str] | None = None,
        doc_paths: list[str] | None = None,
    ) -> LLMService:
        """Service with both indexes populated for cross-ref tests.

        The symbol index stub returns non-empty
        ``get_legend()`` and ``get_symbol_map()`` outputs
        (rather than empty strings) so the assembly /
        breakdown observation tests can detect when the
        secondary map fetch fired. Earlier revisions
        returned empty strings, which made it impossible
        to tell "the fetch ran but produced nothing" from
        "the fetch was skipped entirely" in tests.
        """
        symbol_paths = symbol_paths or []
        doc_paths = doc_paths or []

        class _SymbolIndexStub:
            def __init__(self, paths: list[str]) -> None:
                self._all_symbols = {p: None for p in paths}

            def index_repo(self, file_list: list[str]) -> None:
                # No-op — the stub doesn't actually parse
                # anything. Required because
                # ``_try_initialize_stability`` calls this
                # in code mode to refresh the index's
                # mtime cache. Tests that need init to
                # succeed (the breakdown observability
                # tests) rely on this being a no-op rather
                # than AttributeError-raising.
                pass

            def get_file_symbol_block(
                self, path: str
            ) -> str | None:
                if path in self._all_symbols:
                    return f"symbol-block-for-{path}"
                return None

            def get_signature_hash(
                self, path: str
            ) -> str | None:
                if path in self._all_symbols:
                    return f"sym-sig-{path}"
                return None

            def get_legend(self) -> str:
                # Non-empty so secondary-fetch observability
                # tests can distinguish "fired" from
                # "skipped". Real legend output is multi-line
                # column descriptions; one line is enough for
                # tests.
                return "# c=class m=method\n"

            def get_symbol_map(
                self, exclude_files: set[str] | None = None
            ) -> str:
                # Non-empty for the same reason as get_legend.
                # Returns one line per path so tests can
                # spot-check "this path appears in the map".
                lines = [
                    f"{p}: stub-symbol-block"
                    for p in sorted(self._all_symbols)
                ]
                return "\n".join(lines) if lines else ""

        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=_SymbolIndexStub(symbol_paths),
        )

        # Seed doc outlines directly.
        from ac_dc.doc_index.extractors.markdown import (
            MarkdownExtractor,
        )
        from pathlib import Path as _Path

        extractor = MarkdownExtractor()
        for path in doc_paths:
            outline = extractor.extract(
                _Path(path),
                f"# Heading for {path}\n\nbody.\n",
            )
            svc._doc_index._all_outlines[path] = outline

        return svc

    def test_enable_rejected_when_not_ready(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Enable returns error when _doc_index_ready is False."""
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["guide.md"],
        )
        # Readiness flag starts False.
        assert svc._doc_index_ready is False

        result = svc.set_cross_reference(True)
        assert result.get("error") == "cross-reference not ready"
        assert "building" in result.get("reason", "").lower()
        # Flag not flipped.
        assert svc._cross_ref_enabled is False

    def test_enable_succeeds_when_ready(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Enable succeeds when _doc_index_ready is True."""
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True

        result = svc.set_cross_reference(True)
        assert result["status"] == "ok"
        assert result["cross_ref_enabled"] is True
        assert svc._cross_ref_enabled is True

    def test_disable_always_allowed(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Disable doesn't check readiness.

        Edge case: an enable succeeded previously, then the
        doc index was somehow invalidated (shouldn't happen
        in practice but defensive). Disable must still work
        to let the user clean up.
        """
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=[],
        )
        # Force the state: enabled but not ready.
        svc._cross_ref_enabled = True
        svc._doc_index_ready = False

        result = svc.set_cross_reference(False)
        assert result["status"] == "ok"
        assert result["cross_ref_enabled"] is False
        assert svc._cross_ref_enabled is False

    def test_enable_does_not_seed_per_file_tracker_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Enabling cross-ref creates NO ``doc:`` tracker entries.

        Under the L0-content-typed model, cross-reference
        is L0-only. The secondary aggregate map is
        regenerated from the doc index at assembly time;
        no per-file ``doc:{path}`` entries are ever created
        on the toggle path. This is the headline behaviour
        change vs the legacy seeding path.

        Spec: ``specs4/3-llm/cache-tiering.md`` § L0
        Stability Contract — "Symbol blocks and doc blocks
        never appear in L1–L3".
        """
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["guide.md", "README.md"],
        )
        svc._doc_index_ready = True

        assert svc._context.mode == Mode.CODE
        svc.set_cross_reference(True)

        # No doc: entries created — the toggle is a flag-flip
        # only.
        tracker_items = svc._stability_tracker.get_all_items()
        assert not any(
            k.startswith("doc:") for k in tracker_items
        )

    def test_enable_in_doc_mode_does_not_seed_symbol_entries(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Symmetric: doc mode + enable → no ``symbol:`` entries either.

        The L0-only contract applies regardless of which
        mode is primary.
        """
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker

        svc.set_cross_reference(True)

        tracker_items = svc._stability_tracker.get_all_items()
        assert not any(
            k.startswith("symbol:") for k in tracker_items
        )

    def test_enable_flips_flag(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """The toggle flips ``_cross_ref_enabled`` and returns ok.

        Replaces the legacy "seeding produced N items" tests.
        The user-visible behaviour is the flag (which the
        assembly path observes) and the success response.
        """
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True

        assert svc._cross_ref_enabled is False
        result = svc.set_cross_reference(True)
        assert result["status"] == "ok"
        assert result["cross_ref_enabled"] is True
        assert svc._cross_ref_enabled is True

    def test_disable_flips_flag(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Disable flips the flag back and returns ok."""
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True
        svc.set_cross_reference(True)
        assert svc._cross_ref_enabled is True

        result = svc.set_cross_reference(False)
        assert result["status"] == "ok"
        assert result["cross_ref_enabled"] is False
        assert svc._cross_ref_enabled is False

    def test_disable_clears_opposite_index_dir_blocks(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Disable strips opposite-mode dir-blocks from the tracker.

        Under D36 cross-reference seeds opposite-mode
        dir-blocks (``docs:<dir>`` in code mode,
        ``symbols:<dir>`` in doc mode). Disable removes them
        so the next prompt assembly doesn't render their
        content.
        """
        from ac_dc.stability_tracker import Tier, TrackedItem

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True

        # Inject an opposite-mode dir-block entry as if cross-ref
        # had seeded it.
        svc._stability_tracker._items["docs:src"] = (
            TrackedItem(
                key="docs:src",
                tier=Tier.L2,
                n_value=4,
                content_hash="h",
                tokens=100,
            )
        )

        # Disable runs the sweep.
        svc._cross_ref_enabled = True
        svc.set_cross_reference(False)

        # Opposite-mode dir-block entry gone.
        all_items = svc._stability_tracker.get_all_items()
        assert "docs:src" not in all_items

    def test_assembly_includes_secondary_legend_when_enabled(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode + cross-ref → secondary doc legend in L0 system message.

        Under D36 dir-block content rides L0–L3 as
        ``docs:<dir>`` tracker entries (rendered live from the
        doc index per turn) — but the secondary *legend*
        (column descriptions) still sits as a non-flux head
        anchor before L0 alongside the primary legend.
        Cross-ref toggles whether the secondary legend
        appears.

        Spec: ``specs-reference/3-llm/cache-tiering`` and
        ``specs-reference/3-llm/modes`` § Cross-Reference Mode.
        """
        from ac_dc.context_manager import DOC_MAP_HEADER

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["guide.md", "README.md"],
        )
        svc._doc_index_ready = True
        svc.set_cross_reference(True)

        # Build a minimal tiered-content fixture and ask the
        # assembler to render. We only need the system
        # message — the rest is irrelevant here.
        empty_tier = {
            "symbols": "",
            "plain_files": "",
            "files": "",
            "history": [],
            "graduated_files": [],
            "graduated_history_indices": [],
        }
        tiered_content = {
            t: dict(empty_tier) for t in ("L0", "L1", "L2", "L3")
        }
        messages = svc._assemble_tiered(
            user_prompt="hi",
            images=[],
            tiered_content=tiered_content,
        )
        # System message is first.
        sys_msg = messages[0]
        content = sys_msg["content"]
        if isinstance(content, list):
            text = "\n".join(
                block.get("text", "")
                for block in content
                if isinstance(block, dict)
            )
        else:
            text = content
        # Secondary header present in code mode (means doc legend
        # was attached as the cross-reference secondary).
        assert DOC_MAP_HEADER in text

    def test_assembly_omits_secondary_map_when_disabled(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode + cross-ref off → no doc header in L0 system message."""
        from ac_dc.context_manager import DOC_MAP_HEADER

        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True
        # Cross-ref OFF (default).
        assert svc._cross_ref_enabled is False

        empty_tier = {
            "symbols": "",
            "files": "",
            "history": [],
            "graduated_files": [],
            "graduated_history_indices": [],
        }
        tiered_content = {
            t: dict(empty_tier) for t in ("L0", "L1", "L2", "L3")
        }
        messages = svc._assemble_tiered(
            user_prompt="hi",
            images=[],
            tiered_content=tiered_content,
        )
        sys_msg = messages[0]
        content = sys_msg["content"]
        if isinstance(content, list):
            text = "\n".join(
                block.get("text", "")
                for block in content
                if isinstance(block, dict)
            )
        else:
            text = content
        # Secondary header absent — only the primary appears.
        assert DOC_MAP_HEADER not in text

    def test_breakdown_reports_cross_ref_flag_when_enabled(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Breakdown payload exposes the cross-reference flag.

        Under D36 there is no synthetic ``meta:repo_map`` /
        ``meta:doc_map`` row — repo structure rides as
        first-class ``symbols:<dir>`` / ``docs:<dir>``
        per-directory dir-block tracker entries. The
        cross-reference state is surfaced via the breakdown
        payload's ``cross_ref_enabled`` field, which the
        cache viewer uses to render the secondary legend.
        """
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True
        svc.set_cross_reference(True)
        svc._try_initialize_stability()

        breakdown = svc.get_context_breakdown()
        assert breakdown["cross_ref_enabled"] is True

    def test_breakdown_reports_cross_ref_flag_when_disabled(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Cross-ref off → ``cross_ref_enabled`` is False in breakdown."""
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True
        # Cross-ref OFF (default).
        svc._try_initialize_stability()

        breakdown = svc.get_context_breakdown()
        assert breakdown["cross_ref_enabled"] is False

    def test_mode_switch_resets_cross_ref_flag(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Mode switch always resets the toggle to off.

        The toggle is mode-scoped UI state per
        ``specs4/3-llm/modes.md`` §
        "Cross-Reference Activation" — it's reset on every
        mode switch, regardless of prior value.
        """
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True
        svc.set_cross_reference(True)
        assert svc._cross_ref_enabled is True

        svc.switch_mode("doc")

        assert svc._cross_ref_enabled is False

    def test_enable_broadcasts_mode_changed(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Enable still broadcasts modeChanged with new state."""
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["guide.md"],
        )
        svc._doc_index_ready = True
        svc._event_callback = event_cb
        event_cb.events.clear()

        svc.set_cross_reference(True)

        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        assert len(mode_events) == 1
        payload = mode_events[0][0]
        assert payload["cross_ref_enabled"] is True

    def test_rejection_does_not_broadcast(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Readiness rejection doesn't fire modeChanged.

        The state didn't actually change, so no broadcast.
        """
        svc = self._make_service_with_both_indexes(
            config, repo, fake_litellm,
            symbol_paths=[],
            doc_paths=["guide.md"],
        )
        svc._event_callback = event_cb
        # Readiness False.
        assert svc._doc_index_ready is False
        event_cb.events.clear()

        result = svc.set_cross_reference(True)
        assert "error" in result

        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        assert mode_events == []