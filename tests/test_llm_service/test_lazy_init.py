"""Mode-aware lazy initialization of the stability tracker.

Covers :class:`TestLazyInitModeAware` —
:meth:`LLMService._try_initialize_stability` dispatches by current
mode (code → symbol/plain_files dir-blocks, doc → doc/plain_files
dir-blocks), bails cleanly when the doc index isn't ready, and
retries on the next request.

Under D36 dir-blocks the system prompt is no longer a tracker
entry — it sits before L0 as a non-flux head anchor and is
rendered live at assembly time. Initialization seeds per-directory
``symbols:<dir>`` / ``docs:<dir>`` / ``plain_files:<dir>`` blocks
quartile-split by mtime (hottest → L0).
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

    Code mode (default): seeds dir-blocks for indexed code
    directories (``symbols:<dir>``) and any plain-file
    directories (``plain_files:<dir>``).

    Doc mode: seeds dir-blocks for indexed doc directories
    (``docs:<dir>``) and plain-file directories. If the doc
    index isn't ready yet, skips cleanly — next request's
    lazy-init retry catches it.
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

    def test_code_mode_init_seeds_dir_blocks(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Code mode init seeds ``symbols:<dir>`` / ``plain_files:<dir>`` entries.

        Under D36 the tracker holds per-directory dir-block
        entries quartile-split by mtime. The system prompt is
        not a tracker entry — it's a non-flux head anchor
        rendered live at assembly time.
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
        # System prompt is NOT a tracker entry under D36.
        assert "system:prompt" not in all_keys
        # Dir-block entries appear with valid prefixes only.
        for key in all_keys:
            assert (
                key.startswith("symbols:")
                or key.startswith("docs:")
                or key.startswith("plain_files:")
            )

    def test_doc_mode_init_seeds_dir_blocks(
        self,
        config: ConfigManager,
        repo: Repo,
        fake_litellm: _FakeLiteLLM,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Doc mode init seeds ``docs:<dir>`` / ``plain_files:<dir>`` entries.

        Symmetric to the code-mode case. The system prompt is
        rendered live at assembly time, not tracked.
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
        assert "system:prompt" not in all_keys
        for key in all_keys:
            assert (
                key.startswith("symbols:")
                or key.startswith("docs:")
                or key.startswith("plain_files:")
            )

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
        # Tracker empty (no entries seeded without init).
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
