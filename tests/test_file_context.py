"""Tests for ac_dc.file_context — Layer 3.3.

Scope: FileContext — path normalisation, add/remove/query,
insertion-order preservation, prompt formatting, token
counting. The repo-backed ``add_file(path)`` variant uses a
minimal mock Repo rather than constructing a real git repo —
the integration with Repo is covered by Layer 1's repo tests.
"""

from __future__ import annotations

import pytest

from ac_dc.file_context import FileContext, _normalise_rel_path
from ac_dc.token_counter import TokenCounter


# ---------------------------------------------------------------------------
# Mock repo — minimal surface FileContext consumes
# ---------------------------------------------------------------------------


class _MockRepo:
    """Stand-in for :class:`ac_dc.repo.Repo`.

    Provides ``get_file_content(path)`` returning canned content
    from an internal dict. Raises a custom exception for missing
    paths so tests can assert error propagation without needing
    the real RepoError hierarchy.
    """

    class _NotFound(Exception):
        pass

    def __init__(self, contents: dict[str, str]) -> None:
        self._contents = dict(contents)
        self.read_calls: list[str] = []

    def get_file_content(self, path: str) -> str:
        self.read_calls.append(path)
        if path not in self._contents:
            raise self._NotFound(f"missing: {path}")
        return self._contents[path]


# ---------------------------------------------------------------------------
# Path normalisation
# ---------------------------------------------------------------------------


class TestNormalisation:
    """_normalise_rel_path — shared helper behaviour."""

    def test_plain_path_unchanged(self) -> None:
        """A simple forward-slash path is returned verbatim."""
        assert _normalise_rel_path("src/main.py") == "src/main.py"

    def test_backslashes_converted(self) -> None:
        """Windows-style separators collapse to forward slashes.

        Users on Windows or configs that store paths with
        backslashes must collide on the same key as the
        forward-slash form. Matches Repo's normalisation.
        """
        assert _normalise_rel_path("src\\main.py") == "src/main.py"

    def test_leading_slash_stripped(self) -> None:
        """A leading slash doesn't produce a different key."""
        assert _normalise_rel_path("/src/main.py") == "src/main.py"

    def test_trailing_slash_stripped(self) -> None:
        """Trailing slash dropped — directory-like input normalises."""
        assert _normalise_rel_path("src/") == "src"

    def test_empty_raises(self) -> None:
        """Empty path is rejected.

        The file context never stores an empty key. The caller
        has a bug if they're passing one, so raise rather than
        silently accept.
        """
        with pytest.raises(ValueError, match="Empty path"):
            _normalise_rel_path("")

    def test_whitespace_only_raises(self) -> None:
        """A slash-only input normalises to empty and is rejected."""
        with pytest.raises(ValueError, match="Empty path"):
            _normalise_rel_path("///")

    def test_parent_traversal_raises(self) -> None:
        """``..`` segments are rejected.

        Full containment checking happens at the Repo layer
        (it resolves and checks against the repo root). This
        cheap second guard catches bypassed paths — tests and
        future callers that hand content directly without
        going through Repo.
        """
        with pytest.raises(ValueError, match="traversal"):
            _normalise_rel_path("../outside")

    def test_embedded_parent_traversal_raises(self) -> None:
        """``..`` anywhere in the path is rejected."""
        with pytest.raises(ValueError, match="traversal"):
            _normalise_rel_path("src/../etc/passwd")


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestConstruction:
    """Empty and repo-backed construction."""

    def test_empty_initially(self) -> None:
        """Fresh context has no files."""
        ctx = FileContext()
        assert ctx.get_files() == []
        assert len(ctx) == 0

    def test_repo_optional(self) -> None:
        """Construction without a repo is legal.

        Matches the contract: tests and any future non-git
        backend should be able to construct a FileContext and
        push explicit content into it.
        """
        ctx = FileContext(repo=None)
        assert len(ctx) == 0

    def test_with_repo(self) -> None:
        """Repo reference is stored but not consulted on init."""
        repo = _MockRepo({"a.py": "hi"})
        ctx = FileContext(repo=repo)
        # Construction doesn't read any files.
        assert repo.read_calls == []


# ---------------------------------------------------------------------------
# add_file
# ---------------------------------------------------------------------------


class TestAddFile:
    """add_file behaviour — explicit content, disk read, errors."""

    def test_explicit_content(self) -> None:
        """Passing content skips the repo entirely."""
        ctx = FileContext(repo=_MockRepo({}))
        ctx.add_file("a.py", "my content")
        assert ctx.get_content("a.py") == "my content"

    def test_reads_from_repo_when_no_content(self) -> None:
        """Without explicit content, reads via the attached repo."""
        repo = _MockRepo({"a.py": "repo content"})
        ctx = FileContext(repo=repo)
        ctx.add_file("a.py")
        assert ctx.get_content("a.py") == "repo content"
        assert repo.read_calls == ["a.py"]

    def test_missing_content_without_repo_raises(self) -> None:
        """content=None with no repo attached is a caller bug.

        Raises ValueError loudly rather than falling back to
        an empty string — silent empty content in the prompt
        would mislead the LLM.
        """
        ctx = FileContext(repo=None)
        with pytest.raises(ValueError, match="without content"):
            ctx.add_file("a.py")

    def test_repo_error_propagates(self) -> None:
        """Repo-level failures propagate verbatim.

        Binary files, missing files, traversal attempts caught
        by the repo layer — the caller must see the exact
        error, not a generic "couldn't add".
        """
        repo = _MockRepo({"a.py": "hi"})
        ctx = FileContext(repo=repo)
        with pytest.raises(_MockRepo._NotFound):
            ctx.add_file("missing.py")

    def test_path_normalised_on_add(self) -> None:
        """Paths are stored in canonical form.

        Two spellings of the same path (backslashes vs slashes,
        leading slash vs none) produce one entry.
        """
        ctx = FileContext()
        ctx.add_file("src\\main.py", "first")
        ctx.add_file("/src/main.py", "second")
        assert len(ctx) == 1
        # Canonical form stored.
        assert ctx.get_files() == ["src/main.py"]

    def test_re_add_updates_content(self) -> None:
        """Re-adding an existing path overwrites the content."""
        ctx = FileContext()
        ctx.add_file("a.py", "v1")
        ctx.add_file("a.py", "v2")
        assert ctx.get_content("a.py") == "v2"

    def test_re_add_preserves_position(self) -> None:
        """Re-adding doesn't move the file to the end.

        Selection order in the file picker stays stable — a
        user editing a file and the context re-reading it
        shouldn't shuffle the working-files section order.
        Callers that want "move to end" use remove + add.
        """
        ctx = FileContext()
        ctx.add_file("a.py", "1")
        ctx.add_file("b.py", "2")
        ctx.add_file("c.py", "3")
        # Update middle file.
        ctx.add_file("b.py", "2v2")
        assert ctx.get_files() == ["a.py", "b.py", "c.py"]

    def test_traversal_rejected(self) -> None:
        """Paths with ``..`` raise at the normalisation boundary."""
        ctx = FileContext()
        with pytest.raises(ValueError, match="traversal"):
            ctx.add_file("../escape.py", "content")


# ---------------------------------------------------------------------------
# remove_file / clear
# ---------------------------------------------------------------------------


class TestRemoveAndClear:
    """Removal and clear semantics."""

    def test_remove_present_returns_true(self) -> None:
        """Removing an existing file returns True."""
        ctx = FileContext()
        ctx.add_file("a.py", "hi")
        assert ctx.remove_file("a.py") is True
        assert ctx.has_file("a.py") is False

    def test_remove_absent_returns_false(self) -> None:
        """Removing a missing file returns False without raising.

        Call sites that toggle membership use the return value
        — "was this change a remove or nothing?". Raising would
        force try/except for a common case.
        """
        ctx = FileContext()
        assert ctx.remove_file("nope.py") is False

    def test_remove_normalises_path(self) -> None:
        """Stored and removed paths collide after normalisation."""
        ctx = FileContext()
        ctx.add_file("src/main.py", "hi")
        assert ctx.remove_file("/src/main.py") is True

    def test_clear_empties(self) -> None:
        """Clear drops every file."""
        ctx = FileContext()
        ctx.add_file("a.py", "1")
        ctx.add_file("b.py", "2")
        ctx.clear()
        assert len(ctx) == 0
        assert ctx.get_files() == []


# ---------------------------------------------------------------------------
# Query
# ---------------------------------------------------------------------------


class TestQuery:
    """has_file, get_content, get_files, __contains__, __len__."""

    def test_has_file_true_for_present(self) -> None:
        ctx = FileContext()
        ctx.add_file("a.py", "hi")
        assert ctx.has_file("a.py") is True

    def test_has_file_false_for_absent(self) -> None:
        ctx = FileContext()
        assert ctx.has_file("nope.py") is False

    def test_has_file_false_for_invalid_path(self) -> None:
        """Traversal attempts return False rather than raising.

        ``has_file`` is a predicate — callers expect False for
        "not in context", including inputs that couldn't even
        be in the context.
        """
        ctx = FileContext()
        assert ctx.has_file("../escape.py") is False
        assert ctx.has_file("") is False

    def test_get_content_present(self) -> None:
        ctx = FileContext()
        ctx.add_file("a.py", "content")
        assert ctx.get_content("a.py") == "content"

    def test_get_content_absent_returns_none(self) -> None:
        """Missing file returns None, not an error.

        Matches dict.get() — callers use None as the "not
        present" signal.
        """
        ctx = FileContext()
        assert ctx.get_content("nope.py") is None

    def test_get_content_invalid_path_returns_none(self) -> None:
        """Traversal attempts return None — consistent with has_file."""
        ctx = FileContext()
        assert ctx.get_content("../escape.py") is None

    def test_get_files_returns_insertion_order(self) -> None:
        """Insertion order preserved — drives prompt rendering order."""
        ctx = FileContext()
        ctx.add_file("z.py", "3")
        ctx.add_file("a.py", "1")
        ctx.add_file("m.py", "2")
        assert ctx.get_files() == ["z.py", "a.py", "m.py"]

    def test_get_files_returns_copy(self) -> None:
        """Mutating the returned list doesn't affect the context.

        Defence against callers that treat it as a view —
        appending to the returned list must not corrupt the
        stored order.
        """
        ctx = FileContext()
        ctx.add_file("a.py", "hi")
        files = ctx.get_files()
        files.append("fake.py")
        assert ctx.get_files() == ["a.py"]

    def test_contains_operator(self) -> None:
        """``path in ctx`` works."""
        ctx = FileContext()
        ctx.add_file("a.py", "hi")
        assert "a.py" in ctx
        assert "other.py" not in ctx

    def test_len(self) -> None:
        """``len(ctx)`` returns the file count."""
        ctx = FileContext()
        assert len(ctx) == 0
        ctx.add_file("a.py", "hi")
        ctx.add_file("b.py", "hi")
        assert len(ctx) == 2


# ---------------------------------------------------------------------------
# Prompt rendering
# ---------------------------------------------------------------------------


class TestFormatForPrompt:
    """format_for_prompt — fenced blocks, no language tags."""

    def test_empty_returns_empty_string(self) -> None:
        """No files → empty string.

        Prompt assembly skips the "Working Files" section when
        this is empty. Returning a header or whitespace would
        clutter the prompt with an empty section.
        """
        ctx = FileContext()
        assert ctx.format_for_prompt() == ""

    def test_single_file_shape(self) -> None:
        r"""One file: ``path\n``` \n<content>\n``` ``.

        specs4/3-llm/prompt-assembly.md#file-content-formatting
        mandates no language tag on the fence. Pinned by
        substring search: the opening fence is ``\n``` \n``
        with nothing between the backticks and the next newline.
        """
        ctx = FileContext()
        ctx.add_file("src/main.py", "def foo(): pass")
        result = ctx.format_for_prompt()
        # Path appears first.
        assert result.startswith("src/main.py\n")
        # Opening fence — no language tag between ``` and \n.
        assert "\n```\n" in result
        # Content appears between fences.
        assert "def foo(): pass" in result
        # Closing fence.
        assert result.endswith("\n```")

    def test_no_language_tag_on_fence(self) -> None:
        """No ``python``, ``js``, etc. suffix on the opening fence.

        Tests that a common language that might be auto-inferred
        (``.py``) doesn't produce a tagged fence. The LLM
        doesn't need the hint and its absence is the contract.
        """
        ctx = FileContext()
        ctx.add_file("a.py", "x = 1")
        result = ctx.format_for_prompt()
        # Should never see language-tagged fences.
        assert "```python" not in result
        assert "```py" not in result

    def test_multiple_files_joined_by_blank_line(self) -> None:
        """Adjacent file blocks are separated by a blank line."""
        ctx = FileContext()
        ctx.add_file("a.py", "1")
        ctx.add_file("b.py", "2")
        result = ctx.format_for_prompt()
        # The closing fence of file A, blank line, then file B's path.
        assert "```\n\na.py" not in result  # a.py renders first
        assert "```\n\nb.py" in result

    def test_rendering_order_matches_insertion(self) -> None:
        """First-added file renders first in the output."""
        ctx = FileContext()
        ctx.add_file("z.py", "z")
        ctx.add_file("a.py", "a")
        result = ctx.format_for_prompt()
        # z appears before a.
        z_idx = result.index("z.py")
        a_idx = result.index("a.py")
        assert z_idx < a_idx

    def test_content_with_backticks_preserved(self) -> None:
        """Content containing triple backticks is preserved verbatim.

        The LLM sees the content as-is. If the file itself
        contains triple-backtick sequences (common in markdown),
        they'll break the outer fence. We could use longer
        fence delimiters but specs4 doesn't prescribe that —
        the user's markdown-in-markdown case is inherently
        ambiguous. Pin the "content is not escaped" contract;
        a future sub-layer can add dynamic fence sizing if
        real-world usage demands it.
        """
        ctx = FileContext()
        ctx.add_file("readme.md", "Use ```py`` for code.")
        result = ctx.format_for_prompt()
        assert "Use ```py`` for code." in result


# ---------------------------------------------------------------------------
# Token counting
# ---------------------------------------------------------------------------


class TestTokenCounting:
    """count_tokens and get_tokens_by_file."""

    def test_empty_context_counts_zero(self) -> None:
        """Empty context → zero tokens."""
        counter = TokenCounter("anthropic/claude-sonnet-4-5")
        ctx = FileContext()
        assert ctx.count_tokens(counter) == 0

    def test_single_file_positive_count(self) -> None:
        """A populated context produces a positive count.

        Relative-only assertion — exact token counts are
        tiktoken-version dependent.
        """
        counter = TokenCounter("anthropic/claude-sonnet-4-5")
        ctx = FileContext()
        ctx.add_file("a.py", "def hello(): pass")
        assert ctx.count_tokens(counter) > 0

    def test_more_content_more_tokens(self) -> None:
        """Longer content produces higher token counts.

        Monotonicity is what budget checks care about. Pinning
        relative ordering rather than exact values.
        """
        counter = TokenCounter("anthropic/claude-sonnet-4-5")
        short_ctx = FileContext()
        short_ctx.add_file("a.py", "x = 1")
        long_ctx = FileContext()
        long_ctx.add_file(
            "a.py", "x = 1\ny = 2\nz = 3\nprint(x, y, z)\n" * 10
        )
        assert long_ctx.count_tokens(counter) > short_ctx.count_tokens(
            counter
        )

    def test_get_tokens_by_file_returns_per_file(self) -> None:
        """Per-file breakdown has one entry per file."""
        counter = TokenCounter("anthropic/claude-sonnet-4-5")
        ctx = FileContext()
        ctx.add_file("a.py", "short")
        ctx.add_file("b.py", "slightly longer content here")
        breakdown = ctx.get_tokens_by_file(counter)
        assert set(breakdown.keys()) == {"a.py", "b.py"}
        # Both positive.
        assert all(v > 0 for v in breakdown.values())
        # Longer file has more tokens.
        assert breakdown["b.py"] > breakdown["a.py"]

    def test_get_tokens_by_file_empty(self) -> None:
        """Empty context returns an empty dict."""
        counter = TokenCounter("anthropic/claude-sonnet-4-5")
        ctx = FileContext()
        assert ctx.get_tokens_by_file(counter) == {}

    def test_count_tokens_reads_fenced_form(self) -> None:
        """Total token count is computed from format_for_prompt.

        Fenced syntax contributes tokens that raw content
        doesn't. Downstream budget checks see the fenced form
        in the actual prompt, so the count must match.
        """
        counter = TokenCounter("anthropic/claude-sonnet-4-5")
        ctx = FileContext()
        ctx.add_file("a.py", "x = 1")
        # Fenced count ≥ raw count (fences add tokens).
        raw = counter.count("x = 1")
        total = ctx.count_tokens(counter)
        assert total >= raw