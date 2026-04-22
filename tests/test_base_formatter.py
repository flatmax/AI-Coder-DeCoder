"""Tests for ac_dc.base_formatter — Layer 2.6.

Scope: BaseFormatter's plumbing — path aliasing,
legend assembly, file sorting, exclusion handling,
empty-input behaviour. The abstract hooks (``_legend``,
``_format_file``) are exercised via a minimal concrete
subclass that renders one-line-per-file output.

Concrete per-language formatters (CompactFormatter for
code, DocFormatter for docs) land in their own test
files with their own per-kind rendering concerns.
"""

from __future__ import annotations

from ac_dc.base_formatter import BaseFormatter


class _StubFormatter(BaseFormatter):
    """Minimal concrete subclass for testing base plumbing.

    Renders one line per file: ``<aliased-path>: <ref_count>``.
    Returns empty string for a path whose basename starts with
    ``empty_`` — lets tests exercise the "subclass returned no
    content, skip this file in the join" branch.
    """

    def _legend(self) -> str:
        return "# stub legend"

    def _format_file(self, path, aliases, ref_index) -> str:
        basename = path.rsplit("/", 1)[-1]
        if basename.startswith("empty_"):
            return ""
        count = (
            ref_index.file_ref_count(path)
            if ref_index is not None
            else 0
        )
        return f"{self._apply_aliases(path, aliases)}: {count}"


class _FakeRefIndex:
    """Minimal stand-in for ReferenceIndex.

    Only the ``file_ref_count`` method is used by
    _StubFormatter, so the test double implements just that.
    Using a class rather than Mock keeps the test readable
    and gives clear failures if an unexpected method is
    called.
    """

    def __init__(self, counts: dict[str, int]) -> None:
        self._counts = counts

    def file_ref_count(self, path: str) -> int:
        return self._counts.get(path, 0)


# ---------------------------------------------------------------------------
# Empty and trivial inputs
# ---------------------------------------------------------------------------


class TestEmptyInputs:
    """format() degrades cleanly on empty or fully-excluded input."""

    def test_empty_file_list_returns_empty_string(self) -> None:
        """No files → empty string, not just the legend.

        A map with no files is rendered as nothing at all so
        the prompt assembly can skip the section cleanly
        rather than emitting a trailing legend block with no
        content.
        """
        formatter = _StubFormatter()
        assert formatter.format([]) == ""

    def test_all_files_excluded_returns_empty_string(self) -> None:
        """If every file is in exclude_files, output is empty.

        The streaming handler passes exclude_files when full
        content of a file is already in a cached tier. If
        every tracked file is excluded, nothing to render.
        """
        formatter = _StubFormatter()
        result = formatter.format(
            ["a.py", "b.py"],
            exclude_files={"a.py", "b.py"},
        )
        assert result == ""

    def test_falsy_paths_filtered_out(self) -> None:
        """Empty strings in the file list are silently dropped.

        Defends against callers that pass a list containing an
        empty string from a stripped git-ls-files line or
        similar. Not an error — the filter just skips them.
        """
        formatter = _StubFormatter()
        result = formatter.format(["", "a.py", ""])
        assert "a.py" in result


# ---------------------------------------------------------------------------
# Basic rendering
# ---------------------------------------------------------------------------


class TestBasicRendering:
    """Single-file and multi-file rendering shape."""

    def test_single_file_output_has_legend_and_block(self) -> None:
        """One file → legend + one block + trailing newline."""
        formatter = _StubFormatter()
        result = formatter.format(["a.py"])
        assert result.startswith("# stub legend")
        assert "a.py: 0" in result
        assert result.endswith("\n")

    def test_files_sorted_alphabetically(self) -> None:
        """Order of ``files`` argument doesn't affect output.

        Stable ordering is the stability-tracker contract.
        Unsorted input would produce a different hash per
        call even when the file set is unchanged.
        """
        formatter = _StubFormatter()
        unsorted = formatter.format(["z.py", "a.py", "m.py"])
        sorted_ = formatter.format(["a.py", "m.py", "z.py"])
        assert unsorted == sorted_
        # Sanity — a, m, z appear in that order in the output.
        a_idx = unsorted.index("a.py")
        m_idx = unsorted.index("m.py")
        z_idx = unsorted.index("z.py")
        assert a_idx < m_idx < z_idx

    def test_include_legend_false_omits_legend(self) -> None:
        """With include_legend=False, only file blocks appear.

        Used by the streaming handler when rendering a
        continuation block for a cached tier — the L0 legend
        already covers the abbreviations.
        """
        formatter = _StubFormatter()
        result = formatter.format(
            ["a.py", "b.py"],
            include_legend=False,
        )
        assert "# stub legend" not in result
        assert "a.py: 0" in result
        assert "b.py: 0" in result

    def test_empty_per_file_blocks_are_skipped(self) -> None:
        """Files whose _format_file returns "" don't add join artifacts.

        The stub returns empty for basenames starting with
        ``empty_``. The output must not have stray blank
        sections or malformed separators.
        """
        formatter = _StubFormatter()
        result = formatter.format(["empty_x.py", "real.py"])
        # real.py renders, empty_x.py doesn't.
        assert "real.py: 0" in result
        assert "empty_x" not in result
        # No consecutive blank lines (would signal a bad join).
        assert "\n\n\n" not in result


# ---------------------------------------------------------------------------
# Reference counts
# ---------------------------------------------------------------------------


class TestReferenceCounts:
    """ref_index integration — counts flow into per-file blocks."""

    def test_ref_index_none_yields_zero_counts(self) -> None:
        """Stub renders ``: 0`` when no ref_index is supplied.

        The base class allows None ref_index; subclasses
        decide how to render it. The stub returns 0, which
        lets this test pin the "None passes through cleanly"
        contract without mocking.
        """
        formatter = _StubFormatter()
        result = formatter.format(["a.py"], ref_index=None)
        assert "a.py: 0" in result

    def test_ref_index_counts_reach_subclass(self) -> None:
        """A ref_index argument flows to _format_file's ref_index parameter."""
        formatter = _StubFormatter()
        ref = _FakeRefIndex({"a.py": 5, "b.py": 2})
        result = formatter.format(["a.py", "b.py"], ref_index=ref)
        assert "a.py: 5" in result
        assert "b.py: 2" in result

    def test_ref_index_missing_path_defaults_to_zero(self) -> None:
        """Files with no count in the index render 0, not an error.

        The reference index returns 0 for untracked paths by
        convention — a file with no incoming references is
        valid, not an error. Matches the spec requirement
        that isolated files still appear in the map.
        """
        formatter = _StubFormatter()
        ref = _FakeRefIndex({"a.py": 3})  # b.py missing
        result = formatter.format(["a.py", "b.py"], ref_index=ref)
        assert "a.py: 3" in result
        assert "b.py: 0" in result


# ---------------------------------------------------------------------------
# Path aliasing
# ---------------------------------------------------------------------------


class TestPathAliasing:
    """_compute_aliases and _apply_aliases."""

    def test_short_prefix_not_aliased(self) -> None:
        """A prefix below MIN_ALIAS_PREFIX_LEN earns no alias.

        ``src/`` is only 4 characters — shorter than the
        threshold. The legend cost would outweigh any per-use
        savings.
        """
        formatter = _StubFormatter()
        aliases = formatter._compute_aliases([
            "src/a.py", "src/b.py", "src/c.py",
        ])
        assert aliases == {}

    def test_single_use_prefix_not_aliased(self) -> None:
        """A long prefix used by only one file earns no alias.

        One use can't recoup the legend-line cost of declaring
        the alias. MIN_ALIAS_USE_COUNT is 3.
        """
        formatter = _StubFormatter()
        aliases = formatter._compute_aliases([
            "src/ac_dc/symbol_index/parser.py",
            "other.py",
        ])
        assert aliases == {}

    def test_qualifying_prefix_earns_alias(self) -> None:
        """A long prefix used by many files gets ``@1/``."""
        formatter = _StubFormatter()
        files = [
            "src/ac_dc/symbol_index/a.py",
            "src/ac_dc/symbol_index/b.py",
            "src/ac_dc/symbol_index/c.py",
            "src/ac_dc/symbol_index/d.py",
        ]
        aliases = formatter._compute_aliases(files)
        assert len(aliases) == 1
        prefix, alias = next(iter(aliases.items()))
        assert alias == "@1/"
        # Longest qualifying prefix wins — full directory.
        assert prefix == "src/ac_dc/symbol_index/"

    def test_sub_prefix_of_alias_skipped(self) -> None:
        """Greedy: ``src/ac_dc/`` skipped when ``src/ac_dc/lib/`` aliased.

        Without this, the longest prefix gets ``@1/`` and its
        parent ``@2/`` — the second alias shadows the first
        for every file it covers, costing a legend line for
        zero savings.
        """
        formatter = _StubFormatter()
        files = [
            "src/ac_dc/lib/foo.py",
            "src/ac_dc/lib/bar.py",
            "src/ac_dc/lib/baz.py",
            "src/ac_dc/lib/qux.py",
        ]
        aliases = formatter._compute_aliases(files)
        # Exactly one alias — the deepest qualifying prefix.
        assert len(aliases) == 1
        assert "src/ac_dc/lib/" in aliases

    def test_multiple_independent_prefixes_both_aliased(self) -> None:
        """Disjoint prefixes both earn aliases up to the max."""
        formatter = _StubFormatter()
        files = [
            # src/ac_dc/symbol_index/ — 4 files, qualifies
            "src/ac_dc/symbol_index/a.py",
            "src/ac_dc/symbol_index/b.py",
            "src/ac_dc/symbol_index/c.py",
            "src/ac_dc/symbol_index/d.py",
            # webapp/src/components/ — 3 files, qualifies
            "webapp/src/components/x.js",
            "webapp/src/components/y.js",
            "webapp/src/components/z.js",
        ]
        aliases = formatter._compute_aliases(files)
        assert len(aliases) == 2
        assigned = set(aliases.values())
        assert assigned == {"@1/", "@2/"}

    def test_aliases_applied_to_paths(self) -> None:
        """_apply_aliases substitutes the longest matching prefix."""
        aliases = {"src/ac_dc/symbol_index/": "@1/"}
        result = BaseFormatter._apply_aliases(
            "src/ac_dc/symbol_index/parser.py",
            aliases,
        )
        assert result == "@1/parser.py"

    def test_apply_aliases_no_match_returns_path(self) -> None:
        """A path not covered by any alias passes through unchanged."""
        aliases = {"src/ac_dc/symbol_index/": "@1/"}
        result = BaseFormatter._apply_aliases("other/file.py", aliases)
        assert result == "other/file.py"

    def test_apply_aliases_empty_map_returns_path(self) -> None:
        """Empty alias dict — path unchanged."""
        assert (
            BaseFormatter._apply_aliases("src/file.py", {})
            == "src/file.py"
        )

    def test_compute_aliases_is_deterministic(self) -> None:
        """Same input → same alias assignment, every call.

        Stability-tracker contract: the formatted block's
        hash must be stable across regenerations when the
        input is unchanged. Non-deterministic alias numbering
        would make every file appear to change on every
        request.
        """
        formatter = _StubFormatter()
        files = [
            "src/ac_dc/symbol_index/a.py",
            "src/ac_dc/symbol_index/b.py",
            "src/ac_dc/symbol_index/c.py",
            "webapp/src/components/x.js",
            "webapp/src/components/y.js",
            "webapp/src/components/z.js",
        ]
        a1 = formatter._compute_aliases(files)
        a2 = formatter._compute_aliases(files)
        assert a1 == a2

    def test_full_format_uses_aliases_in_output(self) -> None:
        """End-to-end: format() output shows aliased paths."""
        formatter = _StubFormatter()
        files = [
            "src/ac_dc/symbol_index/a.py",
            "src/ac_dc/symbol_index/b.py",
            "src/ac_dc/symbol_index/c.py",
            "src/ac_dc/symbol_index/d.py",
        ]
        result = formatter.format(files)
        assert "@1/a.py: 0" in result
        assert "# @1/=src/ac_dc/symbol_index/" in result


# ---------------------------------------------------------------------------
# get_legend
# ---------------------------------------------------------------------------


class TestGetLegend:
    """Standalone legend retrieval."""

    def test_get_legend_no_files_has_subclass_text(self) -> None:
        """Without files, legend is just the subclass's text."""
        formatter = _StubFormatter()
        legend = formatter.get_legend()
        assert legend == "# stub legend"

    def test_get_legend_with_files_includes_aliases(self) -> None:
        """With qualifying files, aliases appear in the legend."""
        formatter = _StubFormatter()
        files = [
            "src/ac_dc/symbol_index/a.py",
            "src/ac_dc/symbol_index/b.py",
            "src/ac_dc/symbol_index/c.py",
            "src/ac_dc/symbol_index/d.py",
        ]
        legend = formatter.get_legend(files)
        assert "# stub legend" in legend
        assert "# @1/=src/ac_dc/symbol_index/" in legend

    def test_get_legend_empty_files_list_treated_as_none(self) -> None:
        """Empty list → legend without aliases, same as None."""
        formatter = _StubFormatter()
        assert formatter.get_legend([]) == formatter.get_legend()


# ---------------------------------------------------------------------------
# Exclusion
# ---------------------------------------------------------------------------


class TestExclusion:
    """exclude_files filters the rendered set."""

    def test_excluded_file_omitted_from_output(self) -> None:
        """A path in exclude_files doesn't appear in the rendered map."""
        formatter = _StubFormatter()
        result = formatter.format(
            ["a.py", "b.py", "c.py"],
            exclude_files={"b.py"},
        )
        assert "a.py: 0" in result
        assert "c.py: 0" in result
        assert "b.py" not in result

    def test_excluded_file_omitted_from_alias_computation(self) -> None:
        """Excluded files don't contribute to prefix use counts."""
        formatter = _StubFormatter()
        files = [
            "src/ac_dc/symbol_index/a.py",
            "src/ac_dc/symbol_index/b.py",
            "src/ac_dc/symbol_index/c.py",
        ]
        result = formatter.format(
            files,
            exclude_files={
                "src/ac_dc/symbol_index/a.py",
                "src/ac_dc/symbol_index/b.py",
            },
        )
        # Only one file remains — no alias should appear.
        assert "@1/" not in result
        assert "src/ac_dc/symbol_index/c.py: 0" in result

    def test_exclude_files_none_treated_as_empty_set(self) -> None:
        """exclude_files=None doesn't filter anything."""
        formatter = _StubFormatter()
        a = formatter.format(["a.py", "b.py"])
        b = formatter.format(["a.py", "b.py"], exclude_files=None)
        c = formatter.format(["a.py", "b.py"], exclude_files=set())
        assert a == b == c


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


class TestDeterminism:
    """Same input produces byte-identical output.

    The stability tracker hashes the rendered block; any
    non-determinism here would cause every file to demote on
    every request. These tests catch ordering or set-iteration
    bugs that happen to work on small inputs but drift on
    larger ones.
    """

    def test_format_identical_across_calls(self) -> None:
        """Two format() calls with the same input match byte-for-byte."""
        formatter = _StubFormatter()
        files = [
            "src/ac_dc/symbol_index/a.py",
            "src/ac_dc/symbol_index/b.py",
            "src/ac_dc/symbol_index/c.py",
            "src/ac_dc/symbol_index/d.py",
            "webapp/src/components/x.js",
            "webapp/src/components/y.js",
            "webapp/src/components/z.js",
        ]
        assert formatter.format(files) == formatter.format(files)

    def test_format_insensitive_to_input_order(self) -> None:
        """Same set of files in different orders → identical output.

        Input is a collection, not a sequence — sorting happens
        inside format(). Callers that build the list in any
        order (git ls-files output, dict iteration, search
        result order) get stable output.
        """
        formatter = _StubFormatter()
        set_a = [
            "src/a.py",
            "src/b.py",
            "other/c.py",
        ]
        set_b = [
            "other/c.py",
            "src/b.py",
            "src/a.py",
        ]
        assert formatter.format(set_a) == formatter.format(set_b)

    def test_format_insensitive_to_exclude_order(self) -> None:
        """exclude_files is a set — order of construction irrelevant."""
        formatter = _StubFormatter()
        files = ["a.py", "b.py", "c.py"]
        a = formatter.format(files, exclude_files={"a.py", "c.py"})
        b = formatter.format(files, exclude_files={"c.py", "a.py"})
        assert a == b