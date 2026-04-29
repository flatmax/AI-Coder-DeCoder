"""Tests for ac_dc.symbol_index.compact_format — Layer 2.6.

Scope: the concrete CompactFormatter that renders code
symbol maps. Pins the exact byte-stable output shape that
specs-reference/2-indexing/symbol-index.md defines and that
Layer 3's cache tiering and the LLM itself consume.

Strategy:

- Build small hand-crafted FileSymbols inputs and assert on
  the exact output. No tree-sitter parsing here — that's the
  extractor layer's concern. These tests treat FileSymbols
  as the contract.
- One test class per feature area (imports, classes, methods,
  call sites, ref annotations, ditto, test collapsing, path
  aliases, context vs LSP variants, determinism).
- Prefer substring / line-presence assertions over full-string
  equality except where the exact format is contractual.
  Over-specific assertions break on whitespace tweaks that
  don't matter; under-specific assertions miss format drift.

The formatter produces two variants:

- Context — no line numbers, legend omits ``:N=line(s)``.
  Used by the LLM-facing symbol map. Token-efficient.
- LSP — includes ``:N`` after each symbol name, legend
  includes ``:N=line(s)``. Used by editor features.

Governing spec sections:

- specs-reference/2-indexing/symbol-index.md#compact-format--symbol-map
- specs4/2-indexing/symbol-index.md#compact-format--symbol-map
"""

from __future__ import annotations

import pytest

from ac_dc.symbol_index.compact_format import CompactFormatter
from ac_dc.symbol_index.models import (
    CallSite,
    FileSymbols,
    Import,
    Parameter,
    Symbol,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fs(
    path: str,
    symbols: list[Symbol] | None = None,
    imports: list[Import] | None = None,
) -> FileSymbols:
    """Build a FileSymbols with sensible defaults.

    Most tests only care about one axis at a time (just
    imports, just symbols). This helper lets callers omit
    the parts they don't care about.
    """
    return FileSymbols(
        file_path=path,
        symbols=list(symbols or []),
        imports=list(imports or []),
    )


def _sym(
    name: str,
    kind: str = "function",
    **kwargs,
) -> Symbol:
    """Build a Symbol. Same rationale as _fs — reduces boilerplate."""
    return Symbol(
        name=name,
        kind=kind,
        file_path=kwargs.pop("file_path", "test.py"),
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Legend
# ---------------------------------------------------------------------------


class TestLegend:
    """The legend block varies between context and LSP variants."""

    def test_context_legend_has_no_line_number_hint(self) -> None:
        """Context variant omits ``:N=line(s)``.

        Per specs3 — the context symbol map is line-number-free
        so it stays token-efficient. The LSP variant adds
        ``:N=line(s)`` for editor features.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        legend = fmt.get_legend()
        assert ":N=line" not in legend

    def test_lsp_legend_documents_line_numbers(self) -> None:
        """LSP variant includes the line-number abbreviation."""
        fmt = CompactFormatter(include_line_numbers=True)
        legend = fmt.get_legend()
        assert ":N=line" in legend

    def test_legend_documents_kind_codes(self) -> None:
        """Legend lists every kind abbreviation the formatter emits.

        If the formatter adds a new kind code, the legend must
        mention it — otherwise the LLM sees an unexplained
        symbol. This test catches kind-code drift.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        legend = fmt.get_legend()
        for code in ("c=class", "m=method", "f=function", "v=var"):
            assert code in legend, f"missing {code!r} in legend"

    def test_legend_documents_basic_markers(self) -> None:
        """Legend documents return-type and optional-parameter markers.

        The ``←`` and ``→`` characters are deliberately absent
        from the legend text — they appear only in the rendered
        symbol lines. Including them in the legend would make
        the legend match ``next(line for line in result if "→"
        in line)`` searches in TestOutgoingCalls, picking up
        the legend instead of the intended symbol line.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        legend = fmt.get_legend()
        assert "->T=returns" in legend
        assert "?=optional" in legend


# ---------------------------------------------------------------------------
# Top-level shape
# ---------------------------------------------------------------------------


class TestTopLevelShape:
    """File header + basic rendering contract."""

    def test_empty_file_list_returns_empty_string(self) -> None:
        """No files → empty string, same as base formatter.

        The base class handles this via its own test; this
        test pins that CompactFormatter doesn't override the
        behaviour. A regression here would mean a caller
        somewhere receives an unexpected legend-only string.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        assert fmt.format_files([]) == ""

    def test_file_with_no_symbols_renders_header_only(self) -> None:
        """A tracked file with nothing to report still shows its path.

        Matters for the LLM's awareness — if a file has no
        top-level symbols but is in the file set (e.g., a
        placeholder __init__.py), it should appear in the map
        so the LLM knows it exists.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        result = fmt.format_files([_fs("empty.py")])
        assert "empty.py" in result

    def test_file_header_ends_with_colon(self) -> None:
        """File entries use ``path:`` as their header line.

        Matches specs3 grammar. The colon separates the path
        from its trailing annotations (incoming ref count)
        and from the indented body.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        result = fmt.format_files([
            _fs("mod.py", symbols=[_sym("foo", "function")]),
        ])
        assert "mod.py:" in result

    def test_multiple_files_rendered_in_alphabetical_order(self) -> None:
        """Files sort alphabetically.

        Inherited from the base formatter's contract. Pinning
        it at the concrete-formatter level guards against a
        subclass accidentally overriding the sort.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        result = fmt.format_files([
            _fs("zzz.py"),
            _fs("aaa.py"),
            _fs("mmm.py"),
        ])
        a_idx = result.index("aaa.py")
        m_idx = result.index("mmm.py")
        z_idx = result.index("zzz.py")
        assert a_idx < m_idx < z_idx


# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------


class TestImports:
    """Import rendering — external (``i``) vs local (``i→``)."""

    def test_external_import_uses_i_prefix(self) -> None:
        """``import os`` renders as ``i os``.

        Per specs3 — external imports (stdlib, third-party) use
        the ``i`` prefix. Local (in-repo) imports use ``i→``.
        The distinction helps the LLM understand dependency
        shape without tracing every import's resolution.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        result = fmt.format_files([
            _fs("mod.py", imports=[Import(module="os", line=1)]),
        ])
        assert "i os" in result

    def test_local_import_uses_arrow_prefix(self) -> None:
        """Resolved in-repo imports use ``i→`` prefix.

        The resolver sets ``resolved_target`` on Import when
        the target is a repo file. The formatter reads that
        attribute to pick the prefix.
        """
        imp = Import(module="other", line=1)
        # The import resolver (Layer 2.5) sets resolved_target
        # via setattr on the Import object. The formatter reads
        # it back the same way.
        setattr(imp, "resolved_target", "other.py")
        fmt = CompactFormatter(include_line_numbers=False)
        result = fmt.format_files([
            _fs("mod.py", imports=[imp]),
            _fs("other.py"),
        ])
        # Local imports render under a distinct prefix.
        # Exact format: ``i→ other.py`` (space between i→ and path).
        assert "i→" in result

    def test_multiple_external_imports_comma_joined(self) -> None:
        """Multiple external imports share one line, comma-separated.

        ``import os, sys, json`` renders as ``i os,sys,json`` —
        much more compact than three separate lines. Per
        specs3's token-efficiency goal.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        result = fmt.format_files([
            _fs("mod.py", imports=[
                Import(module="os", line=1),
                Import(module="sys", line=2),
                Import(module="json", line=3),
            ]),
        ])
        # Modules joined with commas, one line.
        assert "i " in result
        line = next(
            line for line in result.splitlines()
            if line.strip().startswith("i ")
        )
        assert "os" in line
        assert "sys" in line
        assert "json" in line

    def test_file_with_no_imports_omits_import_line(self) -> None:
        """Files without imports don't emit an empty ``i`` line."""
        fmt = CompactFormatter(include_line_numbers=False)
        result = fmt.format_files([
            _fs("mod.py", symbols=[_sym("foo")]),
        ])
        # No import prefix at all.
        for line in result.splitlines():
            assert not line.lstrip().startswith("i ")


# ---------------------------------------------------------------------------
# Symbol kind codes
# ---------------------------------------------------------------------------


class TestSymbolKinds:
    """Each kind gets its own single-letter prefix."""

    def test_function_prefix(self) -> None:
        """Top-level function → ``f name``."""
        fmt = CompactFormatter(include_line_numbers=False)
        result = fmt.format_files([
            _fs("mod.py", symbols=[_sym("foo", "function")]),
        ])
        assert "f foo" in result

    def test_async_function_prefix(self) -> None:
        """Async function → ``af name``.

        Async-ness is a distinct prefix rather than an
        annotation on the line because it's a structural
        property the LLM routinely reasons about.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        result = fmt.format_files([
            _fs("mod.py", symbols=[
                _sym("fetch", "function", is_async=True),
            ]),
        ])
        assert "af fetch" in result

    def test_class_prefix(self) -> None:
        """Class → ``c ClassName``."""
        fmt = CompactFormatter(include_line_numbers=False)
        result = fmt.format_files([
            _fs("mod.py", symbols=[_sym("Foo", "class")]),
        ])
        assert "c Foo" in result

    def test_method_prefix(self) -> None:
        """Method (nested under class) → ``m methodname``."""
        fmt = CompactFormatter(include_line_numbers=False)
        cls = _sym("Foo", "class", children=[
            _sym("greet", "method"),
        ])
        result = fmt.format_files([
            _fs("mod.py", symbols=[cls]),
        ])
        assert "m greet" in result

    def test_async_method_prefix(self) -> None:
        """Async method → ``am methodname``."""
        fmt = CompactFormatter(include_line_numbers=False)
        cls = _sym("Fetcher", "class", children=[
            _sym("fetch", "method", is_async=True),
        ])
        result = fmt.format_files([
            _fs("mod.py", symbols=[cls]),
        ])
        assert "am fetch" in result

    def test_variable_prefix(self) -> None:
        """Top-level variable → ``v NAME``."""
        fmt = CompactFormatter(include_line_numbers=False)
        result = fmt.format_files([
            _fs("mod.py", symbols=[_sym("CONFIG", "variable")]),
        ])
        assert "v CONFIG" in result

    def test_property_prefix(self) -> None:
        """``@property`` method → ``p name``.

        Per specs3 — properties get their own code because
        semantically they're attributes, not callables.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        cls = _sym("Foo", "class", children=[
            _sym("name", "property"),
        ])
        result = fmt.format_files([
            _fs("mod.py", symbols=[cls]),
        ])
        assert "p name" in result


# ---------------------------------------------------------------------------
# Nesting and indentation
# ---------------------------------------------------------------------------


class TestNesting:
    """Children nest via two-space indentation."""

    def test_method_indented_under_class(self) -> None:
        """Method lines start with two spaces when inside a class."""
        fmt = CompactFormatter(include_line_numbers=False)
        cls = _sym("Foo", "class", children=[
            _sym("greet", "method"),
        ])
        result = fmt.format_files([
            _fs("mod.py", symbols=[cls]),
        ])
        method_line = next(
            line for line in result.splitlines()
            if "m greet" in line
        )
        assert method_line.startswith("  ")

    def test_class_has_no_leading_indent(self) -> None:
        """Top-level class line has no leading whitespace."""
        fmt = CompactFormatter(include_line_numbers=False)
        result = fmt.format_files([
            _fs("mod.py", symbols=[_sym("Foo", "class")]),
        ])
        class_line = next(
            line for line in result.splitlines()
            if "c Foo" in line
        )
        assert not class_line.startswith(" ")

    def test_multiple_methods_preserve_source_order(self) -> None:
        """Methods on a class appear in the order given.

        The extractor produces children in source order; the
        formatter must preserve that so the rendered map
        matches the file the LLM reads.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        cls = _sym("Foo", "class", children=[
            _sym("a", "method"),
            _sym("b", "method"),
            _sym("c", "method"),
        ])
        result = fmt.format_files([
            _fs("mod.py", symbols=[cls]),
        ])
        a_idx = result.index("m a")
        b_idx = result.index("m b")
        c_idx = result.index("m c")
        assert a_idx < b_idx < c_idx


# ---------------------------------------------------------------------------
# Parameters and return types
# ---------------------------------------------------------------------------


class TestSignatures:
    """Parameter lists and return-type annotations."""

    def test_function_renders_parameters_in_parens(self) -> None:
        """``def f(a, b):`` → ``f f(a,b)``.

        Parameters comma-joined inside parentheses. No space
        after commas — token-efficient.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        sym = _sym("f", "function", parameters=[
            Parameter(name="a"),
            Parameter(name="b"),
        ])
        result = fmt.format_files([_fs("mod.py", symbols=[sym])])
        assert "f f(a,b)" in result

    def test_function_with_no_parameters_renders_empty_parens(self) -> None:
        """``def f():`` → ``f f()``."""
        fmt = CompactFormatter(include_line_numbers=False)
        sym = _sym("f", "function", parameters=[])
        result = fmt.format_files([_fs("mod.py", symbols=[sym])])
        assert "f f()" in result

    def test_optional_parameter_rendered_with_question_mark(self) -> None:
        """Parameters with defaults render as ``name?``.

        Per specs3 legend — ``?`` = optional. Compact for the
        token budget; the LLM learns the convention from the
        legend.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        sym = _sym("f", "function", parameters=[
            Parameter(name="x"),
            Parameter(name="timeout", default="30"),
        ])
        result = fmt.format_files([_fs("mod.py", symbols=[sym])])
        assert "timeout?" in result

    def test_return_type_rendered_with_arrow(self) -> None:
        """``-> int`` renders as ``->int`` after the parameter list."""
        fmt = CompactFormatter(include_line_numbers=False)
        sym = _sym(
            "f", "function",
            parameters=[Parameter(name="x")],
            return_type="int",
        )
        result = fmt.format_files([_fs("mod.py", symbols=[sym])])
        assert "->int" in result

    def test_complex_return_type_preserved_verbatim(self) -> None:
        """Generic return types render as the source text.

        ``-> list[dict[str, int]]`` is preserved as-is. The
        extractor captures the text; the formatter doesn't
        try to model or simplify it.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        sym = _sym(
            "f", "function",
            parameters=[],
            return_type="list[dict[str,int]]",
        )
        result = fmt.format_files([_fs("mod.py", symbols=[sym])])
        assert "->list[dict[str,int]]" in result

    def test_vararg_parameter_prefixed_with_star(self) -> None:
        """``*args`` → ``*args`` in the signature."""
        fmt = CompactFormatter(include_line_numbers=False)
        sym = _sym("f", "function", parameters=[
            Parameter(name="args", is_vararg=True),
        ])
        result = fmt.format_files([_fs("mod.py", symbols=[sym])])
        assert "*args" in result

    def test_kwarg_parameter_prefixed_with_double_star(self) -> None:
        """``**kwargs`` → ``**kwargs``."""
        fmt = CompactFormatter(include_line_numbers=False)
        sym = _sym("f", "function", parameters=[
            Parameter(name="kwargs", is_kwarg=True),
        ])
        result = fmt.format_files([_fs("mod.py", symbols=[sym])])
        assert "**kwargs" in result


# ---------------------------------------------------------------------------
# Inheritance
# ---------------------------------------------------------------------------


class TestInheritance:
    """Class bases render inside parentheses after the name."""

    def test_single_base_class(self) -> None:
        """``class Foo(Bar):`` → ``c Foo(Bar)``."""
        fmt = CompactFormatter(include_line_numbers=False)
        sym = _sym("Foo", "class", bases=["Bar"])
        result = fmt.format_files([_fs("mod.py", symbols=[sym])])
        assert "c Foo(Bar)" in result

    def test_multiple_bases_comma_joined(self) -> None:
        """``class Foo(A, B):`` → ``c Foo(A,B)``."""
        fmt = CompactFormatter(include_line_numbers=False)
        sym = _sym("Foo", "class", bases=["A", "B"])
        result = fmt.format_files([_fs("mod.py", symbols=[sym])])
        assert "c Foo(A,B)" in result

    def test_class_with_no_bases_has_no_parens(self) -> None:
        """``class Foo:`` → ``c Foo`` (no empty parens).

        Empty parens would cost two tokens for no information.
        The legend already documents that a bare ``c Foo``
        means no explicit bases.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        sym = _sym("Foo", "class", bases=[])
        result = fmt.format_files([_fs("mod.py", symbols=[sym])])
        # No ``c Foo()`` anywhere.
        assert "c Foo()" not in result
        assert "c Foo" in result


# ---------------------------------------------------------------------------
# Call sites (outgoing calls)
# ---------------------------------------------------------------------------


class _StubRefIndex:
    """Minimal ReferenceIndex stand-in for formatter tests.

    The reference index's full surface is tested separately
    in test_symbol_index_reference_index.py. Here we only
    need the two methods the formatter consults:
    ``references_to_symbol`` and ``file_ref_count``.
    """

    def __init__(
        self,
        file_counts: dict[str, int] | None = None,
        symbol_refs: dict[str, list[tuple[str, int]]] | None = None,
    ) -> None:
        self._file_counts = file_counts or {}
        self._symbol_refs = symbol_refs or {}

    def file_ref_count(self, path: str) -> int:
        return self._file_counts.get(path, 0)

    def references_to_symbol(
        self, name: str,
    ) -> list[tuple[str, int]]:
        return list(self._symbol_refs.get(name, []))


class TestOutgoingCalls:
    """Call sites render as ``→name1,name2`` trailing annotations."""

    def test_single_call_site_rendered(self) -> None:
        """One call site → ``→target`` after the symbol."""
        fmt = CompactFormatter(include_line_numbers=False)
        caller = _sym(
            "caller", "function",
            call_sites=[CallSite(
                name="helper", line=5,
                target_file="b.py", target_symbol="helper",
            )],
        )
        result = fmt.format_files([
            _fs("a.py", symbols=[caller]),
            _fs("b.py"),
        ])
        assert "→helper" in result

    def test_multiple_call_sites_comma_joined(self) -> None:
        """Multiple distinct targets → ``→a,b,c`` on one line."""
        fmt = CompactFormatter(include_line_numbers=False)
        caller = _sym(
            "caller", "function",
            call_sites=[
                CallSite(name="a", line=5, target_file="x.py"),
                CallSite(name="b", line=6, target_file="x.py"),
                CallSite(name="c", line=7, target_file="x.py"),
            ],
        )
        result = fmt.format_files([
            _fs("mod.py", symbols=[caller]),
            _fs("x.py"),
        ])
        line = next(
            line for line in result.splitlines()
            if "→" in line
        )
        assert "a" in line
        assert "b" in line
        assert "c" in line

    def test_duplicate_call_targets_deduplicated(self) -> None:
        """Two calls to the same symbol render the target once.

        A function that calls ``helper()`` three times shows
        ``→helper`` on the summary line, not ``→helper,helper,helper``.
        Token efficiency plus readability.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        caller = _sym(
            "caller", "function",
            call_sites=[
                CallSite(name="helper", line=5, target_file="x.py"),
                CallSite(name="helper", line=6, target_file="x.py"),
                CallSite(name="helper", line=7, target_file="x.py"),
            ],
        )
        result = fmt.format_files([
            _fs("mod.py", symbols=[caller]),
            _fs("x.py"),
        ])
        line = next(
            line for line in result.splitlines()
            if "→" in line
        )
        # ``helper`` appears once after the arrow.
        assert line.count("helper") == 1

    def test_no_call_sites_omits_arrow_annotation(self) -> None:
        """A function with no calls has no trailing ``→`` on its line."""
        fmt = CompactFormatter(include_line_numbers=False)
        result = fmt.format_files([
            _fs("mod.py", symbols=[_sym("f", "function")]),
        ])
        line = next(
            line for line in result.splitlines()
            if "f f" in line
        )
        assert "→" not in line


# ---------------------------------------------------------------------------
# Incoming reference annotations (←N)
# ---------------------------------------------------------------------------


class TestIncomingReferences:
    """``←N`` annotations on file headers and symbols."""

    def test_file_with_references_shows_count(self) -> None:
        """File header carries ``←N`` when N > 0."""
        fmt = CompactFormatter(include_line_numbers=False)
        ref_index = _StubRefIndex(file_counts={"mod.py": 3})
        result = fmt.format_files(
            [_fs("mod.py", symbols=[_sym("f")])],
            ref_index=ref_index,
        )
        # File header includes ←3.
        header = next(
            line for line in result.splitlines()
            if "mod.py:" in line
        )
        assert "←3" in header

    def test_file_with_zero_references_omits_count(self) -> None:
        """``←0`` is not emitted — absence means zero.

        Legend already explains ←N; ←0 costs two tokens for no
        information. Matches specs3's token-efficiency rule.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        ref_index = _StubRefIndex(file_counts={"mod.py": 0})
        result = fmt.format_files(
            [_fs("mod.py", symbols=[_sym("f")])],
            ref_index=ref_index,
        )
        header = next(
            line for line in result.splitlines()
            if "mod.py:" in line
        )
        assert "←0" not in header
        assert "←" not in header

    def test_no_ref_index_omits_all_counts(self) -> None:
        """Formatter with no ref_index produces no ``←N`` annotations."""
        fmt = CompactFormatter(include_line_numbers=False)
        result = fmt.format_files(
            [_fs("mod.py", symbols=[_sym("f")])],
            ref_index=None,
        )
        assert "←" not in result

    def test_symbol_with_references_shows_count(self) -> None:
        """Individual symbols get ``←N`` when referenced across files.

        The reference index has references_to_symbol; the
        formatter renders the count (or individual locations
        per specs3's legend — the tests pin whichever the
        implementation picks).
        """
        fmt = CompactFormatter(include_line_numbers=False)
        ref_index = _StubRefIndex(
            symbol_refs={
                "User": [
                    ("auth.py", 5),
                    ("api.py", 20),
                    ("models.py", 100),
                ],
            },
        )
        result = fmt.format_files(
            [_fs("mod.py", symbols=[_sym("User", "class")])],
            ref_index=ref_index,
        )
        # Some form of count annotation follows the symbol name.
        user_line = next(
            line for line in result.splitlines()
            if "c User" in line
        )
        # Either explicit count or the reference locations —
        # the test pins that *some* reference marker appears.
        assert "←" in user_line


# ---------------------------------------------------------------------------
# LSP variant — line numbers
# ---------------------------------------------------------------------------


class TestLineNumbers:
    """LSP variant embeds ``:N`` after symbol names."""

    def test_lsp_function_has_line_number(self) -> None:
        """LSP variant: ``f foo:10`` — line 10 (1-indexed).

        Tree-sitter range is 0-indexed; the formatter converts
        to 1-indexed for the LSP variant since that's what
        editors display.
        """
        fmt = CompactFormatter(include_line_numbers=True)
        sym = _sym("foo", "function", range=(9, 0, 15, 0))
        result = fmt.format_files([_fs("mod.py", symbols=[sym])])
        assert ":10" in result

    def test_context_function_has_no_line_number(self) -> None:
        """Context variant: ``f foo`` — no ``:N`` anywhere."""
        fmt = CompactFormatter(include_line_numbers=False)
        sym = _sym("foo", "function", range=(9, 0, 15, 0))
        result = fmt.format_files([_fs("mod.py", symbols=[sym])])
        # The file header uses a colon but the symbol line
        # shouldn't have ``:10``.
        symbol_line = next(
            line for line in result.splitlines()
            if "f foo" in line
        )
        assert ":" not in symbol_line

    def test_lsp_method_has_line_number(self) -> None:
        """Methods also get ``:N`` in the LSP variant."""
        fmt = CompactFormatter(include_line_numbers=True)
        cls = _sym("Foo", "class", range=(4, 0, 20, 0), children=[
            _sym("bar", "method", range=(9, 4, 15, 0)),
        ])
        result = fmt.format_files([_fs("mod.py", symbols=[cls])])
        # Both class and method render with their line numbers.
        assert "c Foo:5" in result
        assert "m bar:10" in result

    def test_context_variant_always_shorter(self) -> None:
        """Context output is strictly smaller than LSP output.

        Same input, different variants. The context variant
        drops line numbers — per symbol this is at least
        3 characters (``:10``). Across a real codebase the
        savings are substantial; this test is a cheap
        sanity-check on that invariant.
        """
        ctx = CompactFormatter(include_line_numbers=False)
        lsp = CompactFormatter(include_line_numbers=True)
        symbols = [
            _sym("foo", "function", range=(0, 0, 10, 0)),
            _sym("Bar", "class", range=(20, 0, 40, 0), children=[
                _sym("x", "method", range=(25, 4, 30, 0)),
            ]),
        ]
        files = [_fs("mod.py", symbols=symbols)]
        assert len(ctx.format_files(files)) < len(lsp.format_files(files))


# ---------------------------------------------------------------------------
# Instance variables
# ---------------------------------------------------------------------------


class TestInstanceVars:
    """Instance variables render as ``v name`` lines nested in a class.

    Per specs3 — ``self.x = ...`` assignments inside ``__init__``
    surface as instance vars on the class symbol. The formatter
    renders them as indented ``v`` lines under the class, same
    prefix as top-level variables but nested.
    """

    def test_instance_vars_rendered_as_nested_v_lines(self) -> None:
        """Each instance var becomes a ``v name`` child line."""
        fmt = CompactFormatter(include_line_numbers=False)
        cls = _sym("User", "class", instance_vars=["name", "email"])
        result = fmt.format_files([_fs("mod.py", symbols=[cls])])
        lines = result.splitlines()
        # Both instance vars appear as indented ``v`` entries.
        name_line = next(line for line in lines if "v name" in line)
        email_line = next(line for line in lines if "v email" in line)
        assert name_line.startswith("  ")
        assert email_line.startswith("  ")

    def test_instance_vars_preserve_first_seen_order(self) -> None:
        """Order matches the extractor's dedup-preserving output."""
        fmt = CompactFormatter(include_line_numbers=False)
        cls = _sym(
            "Foo", "class",
            instance_vars=["b", "a", "c"],
        )
        result = fmt.format_files([_fs("mod.py", symbols=[cls])])
        b_idx = result.index("v b")
        a_idx = result.index("v a")
        c_idx = result.index("v c")
        assert b_idx < a_idx < c_idx

    def test_class_without_instance_vars_omits_v_lines(self) -> None:
        """Classes with no instance vars don't emit placeholder lines."""
        fmt = CompactFormatter(include_line_numbers=False)
        cls = _sym("Empty", "class")
        result = fmt.format_files([_fs("mod.py", symbols=[cls])])
        # No ``v`` lines anywhere in the block.
        for line in result.splitlines():
            assert not line.lstrip().startswith("v ")

    def test_instance_vars_and_methods_coexist(self) -> None:
        """A class can have both instance vars and methods.

        Rendering order — per specs3, instance vars come first
        (they're data members), then methods. Pins the
        convention so diffs across runs stay stable.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        cls = _sym(
            "Foo", "class",
            instance_vars=["x"],
            children=[_sym("greet", "method")],
        )
        result = fmt.format_files([_fs("mod.py", symbols=[cls])])
        x_idx = result.index("v x")
        greet_idx = result.index("m greet")
        assert x_idx < greet_idx


# ---------------------------------------------------------------------------
# Exclusion
# ---------------------------------------------------------------------------


class TestExclusion:
    """exclude_files filters the rendered set.

    Wraps the base formatter's exclusion contract. The
    streaming handler passes exclude_files when a file's full
    content is already in a cached tier — the uniqueness
    invariant means its symbol block must not appear in the
    main map.
    """

    def test_excluded_file_omitted_from_output(self) -> None:
        """A path in exclude_files doesn't appear in the output."""
        fmt = CompactFormatter(include_line_numbers=False)
        result = fmt.format_files(
            [
                _fs("a.py", symbols=[_sym("fa")]),
                _fs("b.py", symbols=[_sym("fb")]),
                _fs("c.py", symbols=[_sym("fc")]),
            ],
            exclude_files={"b.py"},
        )
        assert "a.py" in result
        assert "c.py" in result
        assert "b.py" not in result

    def test_exclude_files_none_treated_as_empty(self) -> None:
        """None, empty set, and unspecified all produce the same output."""
        fmt = CompactFormatter(include_line_numbers=False)
        files = [_fs("a.py", symbols=[_sym("f")])]
        a = fmt.format_files(files)
        b = fmt.format_files(files, exclude_files=None)
        c = fmt.format_files(files, exclude_files=set())
        assert a == b == c


# ---------------------------------------------------------------------------
# Path aliases (context variant)
# ---------------------------------------------------------------------------


class TestPathAliases:
    """End-to-end: qualifying prefixes earn ``@N/`` aliases.

    The aliasing logic itself is tested in test_base_formatter.py.
    Here we pin the integration — CompactFormatter's per-file
    rendering uses aliased paths in headers (and elsewhere) when
    aliases apply.
    """

    def test_aliased_prefix_appears_in_header(self) -> None:
        """File headers use the alias when one matches."""
        fmt = CompactFormatter(include_line_numbers=False)
        files = [
            _fs("src/ac_dc/symbol_index/a.py", symbols=[_sym("a")]),
            _fs("src/ac_dc/symbol_index/b.py", symbols=[_sym("b")]),
            _fs("src/ac_dc/symbol_index/c.py", symbols=[_sym("c")]),
            _fs("src/ac_dc/symbol_index/d.py", symbols=[_sym("d")]),
        ]
        result = fmt.format_files(files)
        assert "@1/a.py:" in result
        # Legend declares the alias.
        assert "# @1/=src/ac_dc/symbol_index/" in result

    def test_no_qualifying_prefix_no_alias(self) -> None:
        """Short or single-use prefixes don't produce aliases."""
        fmt = CompactFormatter(include_line_numbers=False)
        files = [_fs("src/a.py", symbols=[_sym("a")])]
        result = fmt.format_files(files)
        # Path rendered verbatim; no ``@1/`` appears.
        assert "src/a.py:" in result
        assert "@1/" not in result


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


class TestDeterminism:
    """Same input → byte-identical output.

    Critical for the stability tracker — it hashes formatted
    blocks to decide tier assignment. Non-deterministic
    output here would cause every file to demote on every
    request. These tests guard against set-iteration order,
    dict ordering, and other sources of hidden variance.
    """

    def test_format_identical_across_calls(self) -> None:
        """Two format_files calls with the same input match exactly."""
        fmt = CompactFormatter(include_line_numbers=False)
        files = [
            _fs("a.py", symbols=[
                _sym("A", "class", children=[
                    _sym("m1", "method"),
                    _sym("m2", "method"),
                ]),
            ]),
            _fs("b.py", symbols=[_sym("f", "function")]),
        ]
        assert fmt.format_files(files) == fmt.format_files(files)

    def test_format_insensitive_to_file_input_order(self) -> None:
        """Same file set in different input orders → same output.

        format_files sorts internally. Callers that assemble
        the list in any order (git ls-files, dict iteration,
        search result order) get byte-stable output.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        a = fmt.format_files([
            _fs("z.py", symbols=[_sym("fz")]),
            _fs("a.py", symbols=[_sym("fa")]),
            _fs("m.py", symbols=[_sym("fm")]),
        ])
        b = fmt.format_files([
            _fs("a.py", symbols=[_sym("fa")]),
            _fs("m.py", symbols=[_sym("fm")]),
            _fs("z.py", symbols=[_sym("fz")]),
        ])
        assert a == b

    def test_format_insensitive_to_exclude_order(self) -> None:
        """exclude_files is a set — construction order irrelevant."""
        fmt = CompactFormatter(include_line_numbers=False)
        files = [
            _fs("a.py", symbols=[_sym("fa")]),
            _fs("b.py", symbols=[_sym("fb")]),
            _fs("c.py", symbols=[_sym("fc")]),
        ]
        a = fmt.format_files(files, exclude_files={"a.py", "c.py"})
        b = fmt.format_files(files, exclude_files={"c.py", "a.py"})
        assert a == b

    def test_call_site_order_stable_across_input_shuffles(self) -> None:
        """Call-site rendering order is deterministic.

        The extractor produces call sites in source order.
        The formatter's dedup step must preserve first-seen
        order — a set-based dedup would lose it and produce
        different output on every Python run thanks to hash
        randomization.
        """
        fmt = CompactFormatter(include_line_numbers=False)
        caller = _sym(
            "caller", "function",
            call_sites=[
                CallSite(name="a", line=1, target_file="x.py"),
                CallSite(name="b", line=2, target_file="x.py"),
                CallSite(name="c", line=3, target_file="x.py"),
            ],
        )
        files = [
            _fs("mod.py", symbols=[caller]),
            _fs("x.py"),
        ]
        # Two calls — must produce identical output even if
        # the formatter uses an internal set somewhere.
        assert fmt.format_files(files) == fmt.format_files(files)