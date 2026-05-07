"""Mode switching, cross-reference toggle, enrichment status.

Covers:

- :class:`TestMode` — :meth:`LLMService.get_mode`,
  :meth:`LLMService.switch_mode`,
  :meth:`LLMService.set_cross_reference` — snapshot shape,
  tracker swap semantics, system-prompt swap, broadcast rules.
- :class:`TestEnrichmentStatus` — the ``enrichment_status``
  tristate (pending / building / complete / unavailable) and
  its backwards-compatibility boolean.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from ac_dc.config import ConfigManager
from ac_dc.context_manager import Mode
from ac_dc.history_store import HistoryStore
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo

from .conftest import _FakeLiteLLM, _RecordingEventCallback


class TestMode:
    """Mode switching, cross-reference toggle, state snapshot fields."""

    def test_get_mode_default_shape(
        self, service: LLMService
    ) -> None:
        """get_mode returns the documented shape in default state.

        Default state has all readiness flags False — tracker
        hasn't run the background build yet, enrichment starts
        in "pending".
        """
        result = service.get_mode()
        assert result == {
            "mode": "code",
            "doc_index_ready": False,
            "doc_index_building": False,
            "doc_index_enriched": False,
            "enrichment_status": "pending",
            "cross_ref_ready": False,
            "cross_ref_enabled": False,
        }

    def test_state_snapshot_includes_cross_ref(
        self, service: LLMService
    ) -> None:
        """get_current_state carries cross_ref_enabled field."""
        state = service.get_current_state()
        assert "cross_ref_enabled" in state
        assert state["cross_ref_enabled"] is False

    async def test_get_mode_reflects_doc_index_ready(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """After background build completes, ready flags flip True."""
        (repo_dir / "doc.md").write_text("# Doc\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        # Pre-build: all readiness flags False.
        before = svc.get_mode()
        assert before["doc_index_ready"] is False
        assert before["doc_index_building"] is False
        assert before["cross_ref_ready"] is False

        # Run the background build.
        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        # Post-build: structural flags flip True, cross_ref_ready
        # mirrors doc_index_ready.
        after = svc.get_mode()
        assert after["doc_index_ready"] is True
        assert after["doc_index_building"] is False
        assert after["cross_ref_ready"] is True

    def test_get_mode_enriched_stays_false_in_2_8_2(
        self, service: LLMService
    ) -> None:
        """doc_index_enriched is always False in 2.8.2.

        Enrichment lands in 2.8.4. Until then the flag is
        hardcoded False regardless of structural readiness.
        Matches the two-phase principle from specs4 — structural
        extraction and enrichment are independent phases.
        """
        # Fake a post-build state to prove enriched stays False
        # even when structure is ready.
        service._doc_index_ready = True
        service._doc_index_building = False
        # Enrichment hasn't run.
        assert service._doc_index_enriched is False
        result = service.get_mode()
        assert result["doc_index_enriched"] is False

    def test_get_mode_cross_ref_ready_mirrors_doc_index_ready(
        self, service: LLMService
    ) -> None:
        """cross_ref_ready follows doc_index_ready.

        Structural extraction is the minimum readiness for
        cross-reference to produce content. Enrichment improves
        output quality but isn't a gate — the toggle is available
        once structure is ready, regardless of enrichment state.
        """
        # Initial state — both False.
        result = service.get_mode()
        assert result["cross_ref_ready"] == result["doc_index_ready"]
        # Flip structural readiness without enrichment.
        service._doc_index_ready = True
        result = service.get_mode()
        assert result["cross_ref_ready"] is True
        assert result["doc_index_enriched"] is False

    def test_switch_to_same_mode_is_noop(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
        history_store: HistoryStore,
    ) -> None:
        """Switching to the already-active mode produces no side effects."""
        # Clear any events from construction.
        event_cb.events.clear()

        result = service.switch_mode("code")

        assert result["mode"] == "code"
        assert "Already" in result.get("message", "")
        # No system event message added.
        assert service.get_current_state()["messages"] == []
        # No broadcast.
        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        assert mode_events == []

    def test_switch_to_unknown_mode_rejected(
        self, service: LLMService
    ) -> None:
        """Unknown mode string returns a clean error."""
        result = service.switch_mode("invalid")
        assert "error" in result
        assert "code" in result["error"]
        assert "doc" in result["error"]
        # Mode unchanged.
        assert service.get_current_state()["mode"] == "code"

    def test_switch_code_to_doc_changes_mode(
        self, service: LLMService
    ) -> None:
        """Switching code → doc updates the context manager's mode."""
        result = service.switch_mode("doc")
        assert result == {"mode": "doc"}
        assert service.get_current_state()["mode"] == "doc"

    def test_switch_swaps_system_prompt(
        self,
        service: LLMService,
        config: ConfigManager,
    ) -> None:
        """Mode switch installs the mode-appropriate system prompt."""
        code_prompt = service._context.get_system_prompt()
        service.switch_mode("doc")
        doc_prompt = service._context.get_system_prompt()
        assert doc_prompt == config.get_doc_system_prompt()
        assert doc_prompt != code_prompt
        # Switch back — original code prompt restored (via the
        # config, not via save-and-restore — mode switch uses
        # plain set_system_prompt).
        service.switch_mode("code")
        assert service._context.get_system_prompt() == (
            config.get_system_prompt()
        )

    def test_switch_swaps_stability_tracker(
        self, service: LLMService
    ) -> None:
        """Each mode has its own tracker; switching swaps the active one."""
        code_tracker = service._stability_tracker
        service.switch_mode("doc")
        doc_tracker = service._stability_tracker
        # Distinct instances.
        assert doc_tracker is not code_tracker
        # Context manager's attached tracker updated too.
        assert service._context.stability_tracker is doc_tracker

    def test_switch_preserves_tracker_state(
        self, service: LLMService
    ) -> None:
        """Switching away and back returns to the original tracker."""
        first_code_tracker = service._stability_tracker
        service.switch_mode("doc")
        service.switch_mode("code")
        # Same instance as before — not reconstructed.
        assert service._stability_tracker is first_code_tracker

    def test_switch_lazy_constructs_doc_tracker(
        self, service: LLMService
    ) -> None:
        """Doc tracker only exists once doc mode is first entered."""
        assert Mode.DOC not in service._trackers
        service.switch_mode("doc")
        assert Mode.DOC in service._trackers

    def test_switch_records_system_event_in_context(
        self, service: LLMService
    ) -> None:
        """Mode switch appends a system event to conversation history."""
        service.switch_mode("doc")
        messages = service.get_current_state()["messages"]
        assert len(messages) == 1
        event = messages[0]
        assert event["role"] == "user"
        assert event.get("system_event") is True
        assert "doc" in event["content"].lower()

    def test_switch_records_system_event_in_history_store(
        self,
        service: LLMService,
        history_store: HistoryStore,
    ) -> None:
        """Mode switch persists the system event to JSONL."""
        service.switch_mode("doc")
        sid = service.get_current_state()["session_id"]
        persisted = history_store.get_session_messages(sid)
        events = [
            m for m in persisted
            if m.get("system_event")
            and "doc" in m.get("content", "").lower()
        ]
        assert len(events) == 1

    def test_switch_broadcasts_mode_changed(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """modeChanged event fires with the new mode."""
        event_cb.events.clear()
        service.switch_mode("doc")
        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        assert len(mode_events) == 1
        payload = mode_events[0][0]
        assert payload == {"mode": "doc"}

    def test_set_cross_reference_enable(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Enabling cross-reference flips the flag and broadcasts.

        Pre-flip readiness gate: we fake-mark the doc index
        ready since the real background build isn't wired in
        this fixture.
        """
        service._doc_index_ready = True
        event_cb.events.clear()
        result = service.set_cross_reference(True)
        assert result == {
            "status": "ok",
            "cross_ref_enabled": True,
        }
        assert service.get_current_state()["cross_ref_enabled"] is True
        # Broadcast carries both mode and new state.
        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        assert len(mode_events) == 1
        payload = mode_events[0][0]
        assert payload["mode"] == "code"
        assert payload["cross_ref_enabled"] is True

    def test_set_cross_reference_disable(
        self,
        service: LLMService,
    ) -> None:
        """Disabling cross-reference flips the flag back."""
        service._doc_index_ready = True
        service.set_cross_reference(True)
        result = service.set_cross_reference(False)
        assert result == {
            "status": "ok",
            "cross_ref_enabled": False,
        }
        assert service.get_current_state()["cross_ref_enabled"] is False

    def test_set_cross_reference_idempotent(
        self,
        service: LLMService,
        event_cb: _RecordingEventCallback,
    ) -> None:
        """Setting cross-reference to its current value is a no-op."""
        event_cb.events.clear()
        # Default is False; setting to False should not broadcast.
        result = service.set_cross_reference(False)
        assert result["cross_ref_enabled"] is False
        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        assert mode_events == []

    def test_cross_reference_resets_on_mode_switch(
        self, service: LLMService
    ) -> None:
        """Cross-reference flag resets to False on every mode switch."""
        service._doc_index_ready = True
        service.set_cross_reference(True)
        assert service.get_current_state()["cross_ref_enabled"] is True
        service.switch_mode("doc")
        assert service.get_current_state()["cross_ref_enabled"] is False
        # And staying on: re-enable, switch back to code, reset.
        service.set_cross_reference(True)
        service.switch_mode("code")
        assert service.get_current_state()["cross_ref_enabled"] is False


class TestEnrichmentStatus:
    """The ``enrichment_status`` field on ``get_mode()``.

    Four states track the keyword-enrichment lifecycle:

    - ``"pending"`` — initial state, or structural extraction
      still running before enrichment starts
    - ``"building"`` — enrichment loop is actively processing files
    - ``"complete"`` — all files enriched
    - ``"unavailable"`` — KeyBERT or sentence-transformers not
      installed, or model load failed

    The transitions "pending → building → complete" cover the
    happy path; "pending → complete" handles the cache-hit case
    where everything was already enriched from a prior session;
    "pending → unavailable" handles missing dependencies or
    model load failures.

    Tests drive the background enrichment loop via
    :meth:`LLMService.complete_deferred_init` with a controlled
    :class:`KeywordEnricher` stub — real KeyBERT isn't available
    in the test environment and we don't want to exercise the
    real model download path. Status transitions are checked
    synchronously via ``asyncio.sleep`` to let the executor
    task complete.
    """

    async def test_initial_state_is_pending(
        self, service: LLMService
    ) -> None:
        """Fresh service reports pending — enrichment hasn't run."""
        result = service.get_mode()
        assert result["enrichment_status"] == "pending"
        assert result["doc_index_enriched"] is False

    async def test_unavailable_when_enricher_probe_fails(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """KeyBERT probe returns False → status flips to unavailable."""
        (repo_dir / "doc.md").write_text("# Doc\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        # Force the enricher to report unavailable. The probe
        # caches its result, so setting _available directly
        # short-circuits future is_available() calls.
        svc._enricher._available = False

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        result = svc.get_mode()
        assert result["enrichment_status"] == "unavailable"
        # Backwards-compatibility boolean stays False.
        assert result["doc_index_enriched"] is False

    async def test_unavailable_when_model_load_fails(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Model load failure → unavailable.

        Enricher passes the probe (library importable) but the
        KeyBERT instance can't be constructed — matches the
        real case of corrupted model cache or HF Hub rate limit.
        """
        (repo_dir / "doc.md").write_text("# Doc\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        # Force probe to pass but ensure_loaded to fail.
        svc._enricher._available = True
        monkeypatch.setattr(
            svc._enricher, "ensure_loaded", lambda: False
        )

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        result = svc.get_mode()
        assert result["enrichment_status"] == "unavailable"
        assert result["doc_index_enriched"] is False

    async def test_complete_when_no_files_queued(
        self,
        config: ConfigManager,
        repo: Repo,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Empty queue → pending → complete (skips building).

        Common case on a warm start: every file was enriched in
        a prior session and the disk cache carries forward.
        The enricher loads the model but the queue is empty;
        status skips "building" and goes straight to "complete".
        """
        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        # Probe passes; model loads; queue is empty.
        svc._enricher._available = True
        monkeypatch.setattr(
            svc._enricher, "ensure_loaded", lambda: True
        )
        # Ensure the queue is empty regardless of any files
        # that the doc index might have picked up.
        monkeypatch.setattr(
            svc._doc_index, "queue_enrichment", lambda: []
        )

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        result = svc.get_mode()
        assert result["enrichment_status"] == "complete"
        assert result["doc_index_enriched"] is True

    async def test_complete_after_enriching_queued_files(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Happy path: pending → building → complete.

        Files are queued, enrichment runs, status ends at
        "complete". We can't easily observe "building" mid-flight
        from a sync test (the loop completes quickly with stub
        enrichment), but we can pin that the terminal state is
        correct and that the loop path was actually taken.
        """
        (repo_dir / "doc.md").write_text("# Doc\n\nBody.\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        svc._enricher._available = True
        monkeypatch.setattr(
            svc._enricher, "ensure_loaded", lambda: True
        )
        # Stub enrich_single_file so we don't exercise real
        # KeyBERT. Just records that enrichment happened.
        enrichment_calls: list[str] = []

        def _stub_enrich(
            path: str, source_text: str = ""
        ) -> Any:
            enrichment_calls.append(path)
            return svc._doc_index._all_outlines.get(path)

        monkeypatch.setattr(
            svc._doc_index, "enrich_single_file", _stub_enrich
        )

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        result = svc.get_mode()
        assert result["enrichment_status"] == "complete"
        assert result["doc_index_enriched"] is True
        # Enrichment actually ran (loop path taken, not
        # early-return from empty queue).
        assert len(enrichment_calls) >= 1

    async def test_doc_index_enriched_mirrors_complete_status(
        self,
        config: ConfigManager,
        repo: Repo,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Backwards-compat boolean stays consistent with tristate.

        ``doc_index_enriched`` is True iff ``enrichment_status``
        is "complete". Pinning this so a future refactor that
        drops the boolean doesn't silently diverge the two
        fields during the transition.
        """
        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        svc._enricher._available = True
        monkeypatch.setattr(
            svc._enricher, "ensure_loaded", lambda: True
        )
        monkeypatch.setattr(
            svc._doc_index, "queue_enrichment", lambda: []
        )

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        result = svc.get_mode()
        # Both indicate complete.
        assert result["enrichment_status"] == "complete"
        assert result["doc_index_enriched"] is True

    def test_unavailable_keeps_doc_index_enriched_false(
        self, service: LLMService
    ) -> None:
        """Unavailable → doc_index_enriched stays False.

        Critical for the frontend: the old boolean alone would
        report False both during "still building" and during
        "can't build". The new tristate distinguishes them, but
        the boolean must remain reliable for existing callers
        that haven't migrated yet.
        """
        service._enrichment_status = "unavailable"
        service._doc_index_enriched = False

        result = service.get_mode()
        assert result["enrichment_status"] == "unavailable"
        assert result["doc_index_enriched"] is False

    def test_state_snapshot_includes_enrichment_status(
        self, service: LLMService
    ) -> None:
        """get_current_state carries enrichment_status for clients.

        Frontend reads this on connect / reconnect to decide
        whether to show the one-shot unavailable toast without
        waiting for a separate get_mode call.
        """
        state = service.get_current_state()
        assert "enrichment_status" in state
        assert state["enrichment_status"] == "pending"

    def test_state_snapshot_reflects_unavailable_status(
        self, service: LLMService
    ) -> None:
        """Snapshot updates as the backend state changes."""
        service._enrichment_status = "unavailable"
        state = service.get_current_state()
        assert state["enrichment_status"] == "unavailable"

    async def test_unavailable_triggers_mode_changed_broadcast(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Probe failure broadcasts modeChanged with status.

        Mid-session clients (browser reload during a build that
        then fails) need to learn about the unavailable state
        without polling. The broadcast carries mode +
        cross-reference + enrichment_status so the frontend's
        modeChanged handler can route it.
        """
        (repo_dir / "doc.md").write_text("# Doc\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        # Force probe failure.
        svc._enricher._available = False

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        # Filter to modeChanged events carrying the status.
        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        # At least one mode-changed broadcast with unavailable.
        unavailable_broadcasts = [
            args[0] for args in mode_events
            if isinstance(args[0], dict)
            and args[0].get("enrichment_status") == "unavailable"
        ]
        assert len(unavailable_broadcasts) >= 1
        payload = unavailable_broadcasts[0]
        # Mode and cross-ref carried along so the frontend's
        # handler sees a consistent snapshot.
        assert payload["mode"] == "code"
        assert "cross_ref_enabled" in payload

    async def test_model_load_failure_triggers_broadcast(
        self,
        config: ConfigManager,
        repo: Repo,
        repo_dir: Path,
        event_cb: _RecordingEventCallback,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Model load failure also broadcasts.

        Symmetric with the probe failure — both paths set
        `_enrichment_status = "unavailable"` and both must
        broadcast so the frontend can react.
        """
        (repo_dir / "doc.md").write_text("# Doc\n")

        svc = LLMService(
            config=config,
            repo=repo,
            event_callback=event_cb,
            deferred_init=True,
        )
        svc._enricher._available = True
        monkeypatch.setattr(
            svc._enricher, "ensure_loaded", lambda: False
        )

        svc.complete_deferred_init(symbol_index=object())
        await asyncio.sleep(0.3)

        mode_events = [
            args for name, args in event_cb.events
            if name == "modeChanged"
        ]
        unavailable_broadcasts = [
            args[0] for args in mode_events
            if isinstance(args[0], dict)
            and args[0].get("enrichment_status") == "unavailable"
        ]
        assert len(unavailable_broadcasts) >= 1