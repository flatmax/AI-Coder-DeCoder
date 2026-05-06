"""Mode-aware lazy initialization of the stability tracker.

Covers :class:`TestLazyInitModeAware` — :meth:`LLMService._try_initialize_stability`
dispatches by current mode (code → symbol:, doc → doc:), bails
cleanly when the doc index isn't ready, retries on the next
request, measures real tokens, and seeds the mode-appropriate
system prompt hash.
"""

from __future__ import annotations

import pytest

from ac_dc.config import ConfigManager
from ac_dc.context_manager import Mode
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo

from .conftest import _FakeLiteLLM, _FakeSymbolIndexWithRefs


class TestLazyInitModeAware:
    """_try_initialize_stability dispatches by current mode.

    Code mode (default): seeds the tracker from the symbol
    index's reference graph with ``symbol:`` prefix.

    Doc mode: seeds from the doc index's reference graph with
    ``doc:`` prefix. If doc index isn't ready yet, skips
    cleanly — next request's lazy-init retry catches it.

    Mode switches before init cause the switch's own state
    setup to drive the tracker; this test class covers only
    the first-call init path.
    """

    def _seed_doc_outlines(
        self, svc: LLMService, paths: list[str]
    ) -> None:
        """Seed the doc index with markdown outlines."""
        from ac_dc.doc_index.extractors.markdown import (
            MarkdownExtractor,
        )
        from pathlib import Path as _Path

        extractor = MarkdownExtractor()
        for path in paths:
            outline = extractor.extract(
                _Path(path),
                f"# Heading for {path}\n\nbody.\n",
            )
            svc._doc_index._all_outlines[path] = outline

    def _make_service(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        symbol_paths: list[str] | None = None,
        repo_files: list[str] | None = None,
        monkeypatch: pytest.MonkeyPatch | None = None,
    ) -> LLMService:
        """Build a service with a controllable symbol index and repo."""
        symbol_paths = symbol_paths or []
        fake_index = _FakeSymbolIndexWithRefs(
            blocks={p: f"block-{p}" for p in symbol_paths},
            ref_counts={p: 1 for p in symbol_paths},
            components=[],
        )
        # Stub the symbol index's index_repo so it doesn't try
        # to re-walk the repo on init.
        fake_index.index_repo = lambda files: None  # type: ignore[method-assign]

        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=fake_index,
        )
        if repo_files is not None and monkeypatch is not None:
            monkeypatch.setattr(
                repo,
                "get_flat_file_list",
                lambda: "\n".join(repo_files),
            )
        return svc

    def test_code_mode_init_registers_only_system_prompt(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Code mode init registers system:prompt and nothing else.

        Under the L0-content-typed model (D27), init does NOT
        seed ``symbol:{path}`` entries into cascade-tracked
        tiers. The aggregate symbol map that L0 presents to
        the LLM is regenerated from the symbol index at
        assembly time, not held as tracker entries. The only
        cascade-tracked L0 entry is ``system:prompt``.

        Files enter Active when selected and graduate upward
        through the cascade as they stabilise. Users who want
        immediate redistribution use ``rebuild_cache``.
        """
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["a.py", "b.py"],
            repo_files=["a.py", "b.py"],
            monkeypatch=monkeypatch,
        )
        assert svc._context.mode == Mode.CODE

        svc._try_initialize_stability()

        assert svc._stability_initialized.get(Mode.CODE, False) is True
        all_keys = set(
            svc._stability_tracker.get_all_items().keys()
        )
        # Only system:prompt — no per-file symbol: or doc:
        # entries from init under the L0-content-typed model.
        assert all_keys == {"system:prompt"}

    def test_doc_mode_init_registers_only_system_prompt(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Doc mode init registers system:prompt and nothing else.

        Symmetric to the code-mode case. Under D27, neither
        ``doc:{path}`` nor ``symbol:{path}`` entries are
        seeded into the tracker on init. The aggregate doc
        map that L0 presents to the LLM is regenerated from
        the doc index at assembly time.
        """
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["ignored.py"],
            repo_files=["ignored.py", "guide.md"],
            monkeypatch=monkeypatch,
        )
        # Seed doc outlines and switch to doc mode.
        self._seed_doc_outlines(svc, ["guide.md", "README.md"])
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker
        # Doc index must be marked ready for init to proceed.
        svc._doc_index_ready = True

        svc._try_initialize_stability()

        assert svc._stability_initialized.get(Mode.DOC, False) is True
        all_keys = set(
            svc._stability_tracker.get_all_items().keys()
        )
        # Only system:prompt — no per-file doc: or symbol:
        # entries from init.
        assert all_keys == {"system:prompt"}

    def test_doc_mode_init_skipped_when_not_ready(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Doc mode + _doc_index_ready False → skip init cleanly.

        The next chat request's lazy-init retry will try again
        once the background build completes. Meanwhile the
        tracker stays uninitialized, which is the correct
        state — we don't want to seed a stale/empty doc index.
        """
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=[],
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker
        # Doc index NOT ready.
        assert svc._doc_index_ready is False

        svc._try_initialize_stability()

        # Not initialized — next retry will pick it up.
        assert svc._stability_initialized.get(Mode.DOC, False) is False
        # Tracker empty (system:prompt isn't seeded without init).
        assert svc._stability_tracker.get_all_items() == {}

    def test_doc_mode_init_retry_succeeds_after_ready(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """First call skips; second call after ready succeeds.

        Simulates the "request arrives before build completes"
        case. The first _try_initialize_stability bails; when
        the background build finishes and sets _doc_index_ready,
        the next retry initializes correctly.
        """
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=[],
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        self._seed_doc_outlines(svc, ["guide.md"])
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker

        # First attempt — not ready, bails.
        assert svc._doc_index_ready is False
        svc._try_initialize_stability()
        assert svc._stability_initialized.get(Mode.DOC, False) is False

        # Background build "completes"; retry.
        svc._doc_index_ready = True
        svc._try_initialize_stability()

        assert svc._stability_initialized.get(Mode.DOC, False) is True
        # Under D27 the tracker holds only system:prompt
        # post-init; doc: entries are not cascade-tracked.
        assert "system:prompt" in (
            svc._stability_tracker.get_all_items()
        )

    def test_doc_mode_init_uses_doc_prompt(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Doc mode init seeds with the doc system prompt hash.

        The system prompt hash stored in the tracker should
        correspond to the doc prompt, not the code prompt —
        so when the user later switches to code mode, the
        hash mismatch triggers a reinstall rather than a
        silent drift.
        """
        import hashlib

        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=[],
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        self._seed_doc_outlines(svc, ["guide.md"])
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker
        svc._doc_index_ready = True

        svc._try_initialize_stability()

        # system:prompt registered with the doc prompt's hash.
        doc_prompt = config.get_doc_system_prompt()
        expected_hash = hashlib.sha256(
            doc_prompt.encode("utf-8")
        ).hexdigest()
        item = svc._stability_tracker.get_all_items().get(
            "system:prompt"
        )
        assert item is not None
        assert item.content_hash == expected_hash

    def test_code_mode_init_uses_code_prompt(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Code mode init seeds with the code prompt's hash."""
        import hashlib

        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            repo_files=["a.py"],
            monkeypatch=monkeypatch,
        )
        # Default: code mode.
        svc._try_initialize_stability()

        code_prompt = config.get_system_prompt()
        expected_hash = hashlib.sha256(
            code_prompt.encode("utf-8")
        ).hexdigest()
        item = svc._stability_tracker.get_all_items().get(
            "system:prompt"
        )
        assert item is not None
        assert item.content_hash == expected_hash

    def test_code_mode_no_symbol_index_skips(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Code mode without symbol index → skip gracefully."""
        svc = LLMService(
            config=config,
            repo=repo,
            symbol_index=None,
        )
        assert svc._context.mode == Mode.CODE

        svc._try_initialize_stability()

        assert svc._stability_initialized.get(Mode.CODE, False) is False

    def test_init_is_idempotent(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Second call after successful init is a no-op."""
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=["a.py"],
            repo_files=["a.py"],
            monkeypatch=monkeypatch,
        )
        svc._try_initialize_stability()
        assert svc._stability_initialized.get(Mode.CODE, False) is True
        first_items = set(
            svc._stability_tracker.get_all_items().keys()
        )

        # Simulate something changing in the index that would
        # alter init output. The no-op guard means this change
        # isn't reflected — as expected.
        svc._symbol_index._all_symbols["new.py"] = None

        svc._try_initialize_stability()
        second_items = set(
            svc._stability_tracker.get_all_items().keys()
        )
        assert first_items == second_items

    def test_doc_mode_init_seeds_real_system_prompt_tokens(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Doc mode init seeds system:prompt with a real token count.

        Under D27 init no longer seeds per-file ``doc:``
        entries with placeholder tokens — there's nothing to
        measure on the per-file side. The remaining
        token-measurement contract is on ``system:prompt``:
        :meth:`register_system_prompt` is called with the
        result of ``counter.count(prompt + legend)``, so the
        stored token count must reflect the actual content,
        not a placeholder or zero.
        """
        svc = self._make_service(
            config, repo, fake_litellm,
            symbol_paths=[],
            repo_files=[],
            monkeypatch=monkeypatch,
        )
        self._seed_doc_outlines(svc, ["guide.md"])
        svc._context.set_mode(Mode.DOC)
        svc._trackers[Mode.DOC] = svc._stability_tracker
        svc._doc_index_ready = True

        svc._try_initialize_stability()

        item = svc._stability_tracker.get_all_items().get(
            "system:prompt"
        )
        assert item is not None
        # Doc system prompt is non-trivially long; real token
        # count is well above zero and well above the 100-token
        # placeholder used by the legacy four-tier seed.
        assert item.tokens > 100