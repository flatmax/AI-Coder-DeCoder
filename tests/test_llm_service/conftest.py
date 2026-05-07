"""Shared fixtures and helpers for the LLM service test package.

This package mirrors the ``src/ac_dc/llm/`` module split. Each
sub-file exercises one slice of the service surface; all of them
share the same fake LiteLLM, recording event callback, repo
fixture, and helper stubs, which live here.

Strategy (preserved from the original monolithic test file):

- Real ContextManager / FileContext / HistoryStore / TokenCounter /
  StabilityTracker / HistoryCompactor — no mocking of Layer 3
  components. These have their own test suites; the LLMService
  test suite exercises integration.
- litellm is mocked at the boundary via a module-level monkeypatch
  (:func:`fake_litellm`). Two fake completions — streaming (yields
  pre-seeded chunks) and non-streaming (returns a canned string).
  No network, no real tokens.
- Event callback is a recording stub. Tests assert on the sequence
  of (event_name, args) tuples captured.
- Repo is a minimal real git clone via :func:`repo_dir` / :func:`repo`.
  Tests that need richer git behaviour build on these.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest

from ac_dc.config import ConfigManager
from ac_dc.history_store import HistoryStore
from ac_dc.llm_service import LLMService
from ac_dc.repo import Repo


# ---------------------------------------------------------------------------
# Recording event callback
# ---------------------------------------------------------------------------


class _RecordingEventCallback:
    """Recording stub for the event callback.

    Mimics the signature ``(event_name, *args) -> awaitable`` and
    captures every invocation. Tests assert on the sequence of
    (event_name, args_tuple) tuples.
    """

    def __init__(self) -> None:
        self.events: list[tuple[str, tuple[Any, ...]]] = []

    def __call__(self, event_name: str, *args: Any):
        self.events.append((event_name, args))

        async def _noop() -> None:
            return None

        return _noop()


# ---------------------------------------------------------------------------
# Fake LiteLLM
# ---------------------------------------------------------------------------


class _FakeLiteLLM:
    """Fake litellm module for the streaming and non-streaming paths.

    Test setup patches ``ac_dc.llm_service`` lookups for
    ``import litellm`` via monkeypatching ``sys.modules`` so both
    the streaming and aux completion paths see this fake.

    For single-call tests, ``set_streaming_chunks([...])`` seeds
    the next streaming completion. For multi-call tests (parallel
    agents), ``queue_streaming_chunks([...])`` appends to a FIFO
    that each ``completion(stream=True)`` call pops from —
    so N parallel agents each get their pre-planned chunks
    regardless of which call hits the fake first.

    Exceptions can be queued too via ``queue_streaming_error`` —
    each exception pops from the same FIFO as chunks and raises
    on the corresponding ``completion()`` call. Useful for
    testing sibling-exception isolation.
    """

    def __init__(self) -> None:
        self.streaming_chunks: list[str] = []
        self.non_streaming_reply: str = ""
        self.call_count = 0
        self.last_call_args: dict[str, Any] = {}
        # FIFO of per-call directives. Each entry is either a
        # list[str] of chunks or an Exception. Consumed in
        # order on each streaming completion() call. When the
        # FIFO is empty, falls back to the single-call
        # ``streaming_chunks`` field for backward compatibility.
        self._streaming_queue: list[Any] = []

    def set_streaming_chunks(self, chunks: list[str]) -> None:
        """Pre-seed content for the next streaming completion.

        Each string becomes the INCREMENTAL delta of one chunk.
        The service accumulates these and fires streamChunk with
        the running total.
        """
        self.streaming_chunks = list(chunks)

    def queue_streaming_chunks(self, chunks: list[str]) -> None:
        """Append a chunk-list to the per-call FIFO.

        Each queued entry is consumed by one streaming
        ``completion()`` call. Use this for parallel-agent
        tests where two or more concurrent calls each need
        their own pre-planned output.
        """
        self._streaming_queue.append(list(chunks))

    def queue_streaming_error(self, exc: BaseException) -> None:
        """Append an exception to the per-call FIFO.

        The next streaming ``completion()`` call raises this
        exception instead of returning chunks. Useful for
        testing sibling-exception isolation across parallel
        agents.
        """
        self._streaming_queue.append(exc)

    def set_non_streaming_reply(self, reply: str) -> None:
        """Pre-seed content for the next non-streaming call."""
        self.non_streaming_reply = reply

    def completion(self, **kwargs: Any) -> Any:
        """Match litellm.completion's public signature."""
        self.call_count += 1
        self.last_call_args = kwargs
        if kwargs.get("stream"):
            # If we have queued directives, consume one;
            # otherwise fall through to the single-call field.
            if self._streaming_queue:
                directive = self._streaming_queue.pop(0)
                if isinstance(directive, BaseException):
                    raise directive
                return self._build_stream_from(directive)
            return self._build_stream()
        return self._build_response(self.non_streaming_reply)

    def _build_stream_from(self, chunks: list[str]):
        """Yield chunks supplied directly (bypasses single-call field)."""
        # Re-use the same chunk-wrapping machinery as
        # _build_stream; we just start with a specific list.
        return self._wrap_chunks(list(chunks))

    def _build_stream(self):
        """Yield fake streaming chunks."""
        chunks = list(self.streaming_chunks)
        # Reset so a second call doesn't replay stale content.
        self.streaming_chunks = []
        return self._wrap_chunks(chunks)

    def _wrap_chunks(self, chunks: list[str]):
        """Shared chunk-wrapping machinery for both entry points."""

        class _Delta:
            def __init__(self, content: str) -> None:
                self.content = content

        class _Choice:
            def __init__(self, content: str) -> None:
                self.delta = _Delta(content)

        class _Chunk:
            def __init__(self, content: str) -> None:
                self.choices = [_Choice(content)]
                self.usage = None

        class _FinalChunk:
            def __init__(self, usage: dict[str, int]) -> None:
                self.choices = []
                self.usage = usage

        def _gen():
            for c in chunks:
                yield _Chunk(c)
            # Final chunk with usage — mirrors provider behaviour.
            yield _FinalChunk({
                "prompt_tokens": 10,
                "completion_tokens": 5,
            })

        return _gen()

    def _build_response(self, content: str) -> Any:
        """Return a non-streaming response object."""
        class _Message:
            def __init__(self, content: str) -> None:
                self.content = content

        class _Choice:
            def __init__(self, content: str) -> None:
                self.message = _Message(content)

        class _Response:
            def __init__(self, content: str) -> None:
                self.choices = [_Choice(content)]

        return _Response(content)


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------


def _run_git(cwd: Path, *args: str) -> None:
    """Run git inside a test repo, failing loudly on error.

    Exported (via ``from .conftest import _run_git``) so test
    modules needing git setup — :mod:`test_review` in particular
    — don't have to re-implement the helper.
    """
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, (
        f"git {' '.join(args)} failed: {result.stderr}"
    )


# ---------------------------------------------------------------------------
# Symbol index fakes (shared by multiple test modules)
# ---------------------------------------------------------------------------


class _FakeSymbolIndex:
    """Minimal symbol index stub for tier-builder tests.

    Exposes ``get_file_symbol_block(path)`` matching the real
    interface. Returns pre-seeded blocks from an in-memory dict;
    missing paths return None (matches the real index's behaviour
    for unknown files).
    """

    def __init__(self, blocks: dict[str, str] | None = None) -> None:
        self._blocks = dict(blocks or {})

    def get_file_symbol_block(self, path: str) -> str | None:
        return self._blocks.get(path)


class _FakeRefIndex:
    """Minimal reference-index stub for rebuild_cache tests.

    Exposes the two methods ``StabilityTracker.initialize_with_keys``
    calls: ``file_ref_count`` (for L0 seeding order) and
    ``connected_components`` (for L1/L2/L3 clustering). Matches
    the shape of Layer 2.4's :class:`ReferenceIndex` without
    pulling in the real tree-sitter stack.
    """

    def __init__(
        self,
        ref_counts: dict[str, int] | None = None,
        components: list[set[str]] | None = None,
    ) -> None:
        self._ref_counts = dict(ref_counts or {})
        self._components = list(components or [])

    def file_ref_count(self, path: str) -> int:
        return self._ref_counts.get(path, 0)

    def connected_components(self) -> list[set[str]]:
        # Return copies so the tracker can't mutate our fixture.
        return [set(c) for c in self._components]


class _FakeSymbolIndexWithRefs:
    """Symbol index stub that also carries a ``_ref_index`` attribute.

    Layer 3.7's ``_try_initialize_stability`` and
    ``rebuild_cache_impl`` both reach into ``symbol_index._ref_index``
    — the real :class:`SymbolIndex` exposes it as a private
    attribute used for tier initialisation. Tests use this stub to
    supply a controllable reference graph without needing a real
    tree-sitter-backed index.
    """

    def __init__(
        self,
        blocks: dict[str, str] | None = None,
        ref_counts: dict[str, int] | None = None,
        components: list[set[str]] | None = None,
        legend: str = "",
        all_symbols: dict[str, Any] | None = None,
    ) -> None:
        self._blocks = dict(blocks or {})
        self._ref_index = _FakeRefIndex(ref_counts, components)
        self._legend = legend
        # _all_symbols is consumed by both _update_stability's
        # step-3 loop AND _rebuild_cache_impl's indexed-files
        # filter (`path in self._symbol_index._all_symbols`).
        # When callers don't supply all_symbols explicitly, we
        # default to the same key set as blocks — matching the
        # real SymbolIndex invariant that every indexed file
        # appears in both _all_symbols (FileSymbols objects)
        # and is queryable via get_file_symbol_block. A test
        # that wants to desync them (e.g., to exercise an
        # error path) can pass all_symbols=... explicitly.
        if all_symbols is None:
            # Mirror blocks so rebuild's filter admits the
            # same files the stub says it can render blocks
            # for. None values are a cheap sentinel — rebuild
            # only tests membership, not the value shape.
            self._all_symbols = {k: None for k in self._blocks}
        else:
            self._all_symbols = dict(all_symbols)

    def get_file_symbol_block(self, path: str) -> str | None:
        return self._blocks.get(path)

    def get_legend(self) -> str:
        return self._legend

    def get_signature_hash(self, path: str) -> str | None:
        # Rebuild doesn't call this; return a stable per-path
        # digest so _update_stability doesn't raise if a future
        # test composes rebuild with a stability update.
        if path in self._blocks:
            return f"sig-{path}"
        return None


def _place_item(
    tracker,
    key: str,
    tier_name: str,
    content_hash: str = "h",
    tokens: int = 10,
) -> None:
    """Helper: put an item directly into a tier on the tracker.

    The tracker's public update() flow expects an active-items
    dict and runs its own state machine. For testing the
    tier-builder we just want items parked in specific tiers —
    we construct TrackedItem directly and inject into the
    tracker's internal map.

    This is a white-box helper; the real cascade is tested in
    test_stability_tracker.py.
    """
    from ac_dc.stability_tracker import Tier, TrackedItem

    tier = Tier(tier_name)
    tracker._items[key] = TrackedItem(
        key=key,
        tier=tier,
        n_value=0,
        content_hash=content_hash,
        tokens=tokens,
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def config_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Path:
    """Isolate config directory per test."""
    d = tmp_path / "config"
    monkeypatch.setenv("AC_DC_CONFIG_HOME", str(d))
    return d


@pytest.fixture
def repo_dir(tmp_path: Path) -> Path:
    """Initialise a minimal git repo for tests."""
    d = tmp_path / "repo"
    d.mkdir()
    _run_git(d, "init", "-q")
    _run_git(d, "config", "user.email", "test@example.com")
    _run_git(d, "config", "user.name", "Test")
    _run_git(d, "config", "init.defaultBranch", "main")
    _run_git(d, "checkout", "-q", "-b", "main")
    # Seed commit so HEAD resolves.
    (d / "seed.md").write_text("seed\n")
    _run_git(d, "add", "seed.md")
    _run_git(d, "commit", "-q", "-m", "seed")
    return d


@pytest.fixture
def repo(repo_dir: Path) -> Repo:
    return Repo(repo_dir)


@pytest.fixture
def config(config_dir: Path, repo_dir: Path) -> ConfigManager:
    """Configured ConfigManager — triggers first-install bundle copy."""
    return ConfigManager(repo_root=repo_dir)


@pytest.fixture
def history_store(repo_dir: Path) -> HistoryStore:
    ac_dc_dir = repo_dir / ".ac-dc4"
    ac_dc_dir.mkdir(exist_ok=True)
    return HistoryStore(ac_dc_dir)


@pytest.fixture
def fake_litellm(monkeypatch: pytest.MonkeyPatch) -> _FakeLiteLLM:
    """Install a fake litellm module.

    Patches sys.modules so ``import litellm`` inside the service
    module resolves to our fake. Restored automatically by
    monkeypatch fixture teardown.
    """
    fake = _FakeLiteLLM()
    monkeypatch.setitem(__import__("sys").modules, "litellm", fake)
    return fake


@pytest.fixture
def event_cb() -> _RecordingEventCallback:
    return _RecordingEventCallback()


@pytest.fixture
def service(
    config: ConfigManager,
    repo: Repo,
    history_store: HistoryStore,
    event_cb: _RecordingEventCallback,
    fake_litellm: _FakeLiteLLM,
) -> LLMService:
    """Fully-wired service for most tests."""
    return LLMService(
        config=config,
        repo=repo,
        event_callback=event_cb,
        history_store=history_store,
    )