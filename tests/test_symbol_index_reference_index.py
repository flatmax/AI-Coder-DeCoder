"""Tests for ac_dc.symbol_index.reference_index — Layer 2.4.

Scope: the ReferenceIndex class. Input is pre-resolved
FileSymbols (CallSite.target_file populated; Import objects
optionally carrying a resolved_target attribute). The index
itself performs no resolution — Layer 2.5 does that — so these
tests construct FileSymbols with targets already set.

Test design:

- Per-test helper ``_make_fs`` builds a minimal FileSymbols
  with one function containing the supplied call sites. Most
  tests only exercise call-site edges; dedicated tests cover
  import-based edges and nested-symbol traversal.
- ``_with_resolved_import`` attaches a ``resolved_target``
  attribute to an Import, matching how the resolver will
  populate it in Layer 2.5. Using setattr (not a new field on
  the dataclass) so Layer 2.4 tests don't need the model to
  change yet.
"""

from __future__ import annotations

from ac_dc.symbol_index.models import (
    CallSite,
    FileSymbols,
    Import,
    Symbol,
)
from ac_dc.symbol_index.reference_index import ReferenceIndex


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_fs(
    path: str,
    call_sites: list[CallSite] | None = None,
    imports: list[Import] | None = None,
) -> FileSymbols:
    """Build a minimal FileSymbols with one function holding the calls.

    Most reference-graph tests only care about edges between
    files; a single function wrapping the call sites is enough
    to exercise the extractor's output shape. Nested-traversal
    tests use their own builders.
    """
    return FileSymbols(
        file_path=path,
        symbols=[
            Symbol(
                name="caller",
                kind="function",
                file_path=path,
                call_sites=list(call_sites or []),
            ),
        ],
        imports=list(imports or []),
    )


def _with_resolved_import(imp: Import, target: str | None) -> Import:
    """Attach a resolver-style ``resolved_target`` attribute.

    The Layer 2.5 resolver will set this field on Import
    objects directly. Layer 2.4 doesn't own the model, so we
    use setattr to simulate. Tests pass these through to
    ``build`` which reads via getattr — the shape matches what
    the real resolver will produce.
    """
    setattr(imp, "resolved_target", target)
    return imp


# ---------------------------------------------------------------------------
# Empty and trivial inputs
# ---------------------------------------------------------------------------


class TestEmptyInputs:
    """Edge cases around empty or degenerate inputs."""

    def test_empty_list_produces_empty_graph(self) -> None:
        """No files → no edges, no components, no references."""
        idx = ReferenceIndex()
        idx.build([])
        assert idx.references_to_symbol("anything") == []
        assert idx.files_referencing("a.py") == set()
        assert idx.file_dependencies("a.py") == set()
        assert idx.file_ref_count("a.py") == 0
        assert idx.bidirectional_edges() == set()
        assert idx.connected_components() == []

    def test_single_file_no_refs_produces_singleton_component(self) -> None:
        """A file with no references still shows up as a component.

        Without this, isolated files would never register in the
        stability tracker's clustering pass — they'd be missed
        entirely at init and only enter the tracker after the
        first request that touches them.
        """
        idx = ReferenceIndex()
        idx.build([_make_fs("a.py")])
        components = idx.connected_components()
        assert len(components) == 1
        assert components[0] == {"a.py"}

    def test_unresolved_call_site_is_skipped(self) -> None:
        """A CallSite with target_file=None contributes no edge."""
        idx = ReferenceIndex()
        fs = _make_fs(
            "a.py",
            call_sites=[CallSite(name="unknown", line=1, target_file=None)],
        )
        idx.build([fs])
        assert idx.files_referencing("b.py") == set()
        assert idx.file_dependencies("a.py") == set()

    def test_unresolved_import_is_skipped(self) -> None:
        """An Import with no resolved_target contributes no edge.

        External packages (numpy, stdlib) never resolve to a
        repo-relative file. The resolver leaves their
        resolved_target as None; the index skips them silently.
        """
        idx = ReferenceIndex()
        fs = _make_fs(
            "a.py",
            imports=[
                _with_resolved_import(Import(module="numpy", line=1), None),
            ],
        )
        idx.build([fs])
        assert idx.file_dependencies("a.py") == set()

    def test_import_without_resolved_attr_is_skipped(self) -> None:
        """Pre-resolver Import (no attribute at all) flows through.

        Layer 2.4 runs before Layer 2.5 integrates; tests that
        construct Import objects without setattr should not
        crash. getattr(obj, 'resolved_target', None) handles
        both the missing-attribute and None-attribute cases.
        """
        idx = ReferenceIndex()
        fs = _make_fs(
            "a.py",
            imports=[Import(module="os", line=1)],
        )
        idx.build([fs])
        assert idx.file_dependencies("a.py") == set()


# ---------------------------------------------------------------------------
# Call-site edges
# ---------------------------------------------------------------------------


class TestCallSiteEdges:
    """Edges derived from resolved call sites."""

    def test_single_call_creates_edge(self) -> None:
        """A → B call site produces an outgoing edge from A."""
        idx = ReferenceIndex()
        fs_a = _make_fs(
            "a.py",
            call_sites=[CallSite(
                name="helper", line=5,
                target_file="b.py", target_symbol="helper",
            )],
        )
        fs_b = _make_fs("b.py")
        idx.build([fs_a, fs_b])
        assert idx.file_dependencies("a.py") == {"b.py"}
        assert idx.files_referencing("b.py") == {"a.py"}

    def test_multiple_calls_to_same_target_weight_edge(self) -> None:
        """Two call sites from A to B count as two references, one edge.

        file_ref_count returns the total call-site count (2),
        files_referencing returns distinct referrers (1).
        """
        idx = ReferenceIndex()
        fs_a = _make_fs(
            "a.py",
            call_sites=[
                CallSite(name="f", line=1, target_file="b.py", target_symbol="f"),
                CallSite(name="g", line=2, target_file="b.py", target_symbol="g"),
            ],
        )
        fs_b = _make_fs("b.py")
        idx.build([fs_a, fs_b])
        assert idx.file_ref_count("b.py") == 2
        assert idx.files_referencing("b.py") == {"a.py"}

    def test_same_file_call_site_is_symbol_only(self) -> None:
        """A file referencing itself contributes no file-level edge.

        Same-file references should still populate
        references_to_symbol (find-references within a file
        works) but must not create a self-loop in the file
        graph — the stability tracker's clustering would
        otherwise treat every file with internal calls as
        "depends on itself", which is noise.
        """
        idx = ReferenceIndex()
        fs = _make_fs(
            "a.py",
            call_sites=[CallSite(
                name="helper", line=5,
                target_file="a.py", target_symbol="helper",
            )],
        )
        idx.build([fs])
        assert idx.file_ref_count("a.py") == 0
        assert idx.file_dependencies("a.py") == set()
        assert idx.references_to_symbol("helper") == [("a.py", 5)]

    def test_target_symbol_falls_back_to_name(self) -> None:
        """When target_symbol is None, the call's `name` is used.

        The resolver populates target_symbol when it can
        disambiguate (e.g. ``foo.bar()`` resolves to symbol
        ``bar`` in ``foo.py``). For unqualified calls the
        symbol name usually matches the call's name; using it
        as a fallback lets find-references work without forcing
        the resolver to always populate both.
        """
        idx = ReferenceIndex()
        fs_a = _make_fs(
            "a.py",
            call_sites=[CallSite(
                name="helper", line=3,
                target_file="b.py", target_symbol=None,
            )],
        )
        fs_b = _make_fs("b.py")
        idx.build([fs_a, fs_b])
        assert idx.references_to_symbol("helper") == [("a.py", 3)]

    def test_nested_symbol_call_sites_contribute_edges(self) -> None:
        """Call sites inside methods on a class are walked too.

        The extractor nests method symbols under class symbols.
        The reference index must follow children via
        all_symbols_flat — otherwise method-body call sites
        would be invisible and the reference graph would be
        dominated by top-level-function-only edges.
        """
        idx = ReferenceIndex()
        method = Symbol(
            name="greet", kind="method", file_path="a.py",
            call_sites=[CallSite(
                name="log", line=5,
                target_file="b.py", target_symbol="log",
            )],
        )
        cls = Symbol(
            name="C", kind="class", file_path="a.py",
            children=[method],
        )
        fs_a = FileSymbols(file_path="a.py", symbols=[cls])
        fs_b = _make_fs("b.py")
        idx.build([fs_a, fs_b])
        assert idx.file_dependencies("a.py") == {"b.py"}
        assert idx.files_referencing("b.py") == {"a.py"}


# ---------------------------------------------------------------------------
# Import edges
# ---------------------------------------------------------------------------


class TestImportEdges:
    """Edges derived from resolved imports."""

    def test_resolved_import_creates_edge(self) -> None:
        """Import with resolved_target produces an A → target edge."""
        idx = ReferenceIndex()
        fs_a = _make_fs(
            "a.py",
            imports=[_with_resolved_import(
                Import(module="b", line=1), "b.py",
            )],
        )
        fs_b = _make_fs("b.py")
        idx.build([fs_a, fs_b])
        assert idx.file_dependencies("a.py") == {"b.py"}
        assert idx.files_referencing("b.py") == {"a.py"}

    def test_import_self_is_skipped(self) -> None:
        """A file importing itself contributes no edge.

        Self-imports aren't legal Python but can arise as a
        resolver artefact (e.g., a package __init__.py
        importing from its own module path). Dropping them
        silently keeps the graph clean.
        """
        idx = ReferenceIndex()
        fs = _make_fs(
            "a.py",
            imports=[_with_resolved_import(
                Import(module="a", line=1), "a.py",
            )],
        )
        idx.build([fs])
        assert idx.file_dependencies("a.py") == set()
        assert idx.file_ref_count("a.py") == 0

    def test_call_and_import_both_count_toward_ref_count(self) -> None:
        """A call site plus an import produce a weighted edge of 2.

        The reference graph collapses the two edge sources into
        one direction, but the count on the incoming edge is
        the sum — matches the ``←N`` annotation contract, which
        counts total references not distinct referrers or
        distinct sources.
        """
        idx = ReferenceIndex()
        fs_a = _make_fs(
            "a.py",
            call_sites=[CallSite(
                name="f", line=5,
                target_file="b.py", target_symbol="f",
            )],
            imports=[_with_resolved_import(
                Import(module="b", line=1), "b.py",
            )],
        )
        fs_b = _make_fs("b.py")
        idx.build([fs_a, fs_b])
        assert idx.file_ref_count("b.py") == 2
        assert idx.file_dependencies("a.py") == {"b.py"}

    def test_multiple_imports_same_target_accumulate(self) -> None:
        """Two imports from A targeting B produce ref_count 2.

        Rare in practice (one import per module is the norm)
        but the resolver may emit multiple entries for
        ``from b import x`` and ``from b import y``. Each
        contributes to the weighted count.
        """
        idx = ReferenceIndex()
        fs_a = _make_fs(
            "a.py",
            imports=[
                _with_resolved_import(
                    Import(module="b", names=["x"], line=1), "b.py",
                ),
                _with_resolved_import(
                    Import(module="b", names=["y"], line=2), "b.py",
                ),
            ],
        )
        fs_b = _make_fs("b.py")
        idx.build([fs_a, fs_b])
        assert idx.file_ref_count("b.py") == 2