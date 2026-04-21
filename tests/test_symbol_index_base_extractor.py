"""Tests for ac_dc.symbol_index.extractors.base — Layer 2.2.

Scope: the plumbing helpers on BaseExtractor — text decoding,
range extraction, child lookup, tree walking.

Uses real tree-sitter parses (via the Python grammar, which is
the most likely to be installed) rather than mock nodes. Real
parses are simpler to set up and catch tree-sitter API drift
that mock-based tests wouldn't.

A couple of tests skip when tree_sitter_python isn't installed —
matches the pattern in test_symbol_index_parser.py.
"""

from __future__ import annotations

import pytest

from ac_dc.symbol_index.extractors.base import BaseExtractor
from ac_dc.symbol_index.parser import TreeSitterParser


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def parser() -> TreeSitterParser:
    """Fresh parser instance per test (no singleton coupling)."""
    return TreeSitterParser()


@pytest.fixture
def python_tree(parser: TreeSitterParser):
    """A real tree-sitter tree for a small Python snippet.

    Source has one top-level function and one top-level class
    — enough structure for every helper to exercise its path
    without being so big that tree-shape assertions become
    fragile.
    """
    if not parser.is_available("python"):
        pytest.skip("tree_sitter_python not installed")
    source = (
        b"def hello(name):\n"
        b"    return name\n"
        b"\n"
        b"class Greeter:\n"
        b"    pass\n"
    )
    tree = parser.parse(source, "python")
    return tree, source


# ---------------------------------------------------------------------------
# Class-level contract
# ---------------------------------------------------------------------------


class TestBaseExtractorContract:
    """extract() is abstract; attributes have sensible defaults."""

    def test_extract_raises_notimplemented(self) -> None:
        """Calling extract on the base class fails loudly.

        Subclasses must override. Default implementation raises
        rather than silently returning an empty FileSymbols —
        silent default would hide the "forgot to implement" bug.
        """
        extractor = BaseExtractor()
        with pytest.raises(NotImplementedError):
            extractor.extract(None, b"", "foo.py")

    def test_error_message_names_subclass(self) -> None:
        """NotImplementedError message identifies the subclass.

        When a future contributor subclasses without overriding,
        the error should say which subclass forgot — debugging
        "BaseExtractor must implement extract" is less useful
        than "MyPythonExtractor must implement extract".
        """

        class StubExtractor(BaseExtractor):
            pass

        extractor = StubExtractor()
        with pytest.raises(NotImplementedError, match="StubExtractor"):
            extractor.extract(None, b"", "foo.py")

    def test_default_tree_optional_is_false(self) -> None:
        """Most extractors need tree-sitter; default reflects that.

        Only MATLAB (deferred) sets tree_optional = True. A typo
        in a subclass that accidentally flipped the default would
        break the orchestrator's tree-requirement check — pin
        the default down.
        """
        assert BaseExtractor.tree_optional is False

    def test_default_language_is_empty_string(self) -> None:
        """Subclasses override; base has no specific language.

        Empty string rather than None so isinstance checks and
        string operations on the attribute don't need to
        defensively handle None.
        """
        assert BaseExtractor.language == ""


# ---------------------------------------------------------------------------
# _node_text — byte-range decoding
# ---------------------------------------------------------------------------


class TestNodeText:
    """_node_text slices bytes by node position and decodes UTF-8."""

    def test_extracts_identifier_text(self, python_tree) -> None:
        """A named identifier node decodes to its source text.

        End-to-end sanity — parse real code, find the function
        name via tree-sitter's field-name lookup, confirm
        _node_text returns "hello".
        """
        tree, source = python_tree
        root = tree.root_node
        func_def = root.children[0]
        # child_by_field_name is the stable tree-sitter API for
        # named fields on a node (vs walking children by type).
        name_node = func_def.child_by_field_name("name")
        assert name_node is not None
        assert BaseExtractor._node_text(name_node, source) == "hello"

    def test_handles_non_utf8_bytes_with_replacement(self) -> None:
        """Invalid UTF-8 in the source is replaced, not raised.

        The parser tolerates non-UTF-8 input (tree-sitter works
        on raw bytes); _node_text must match by using
        errors='replace'. If it raised instead, a file with a
        stray 0xFF would crash the whole extraction.

        Uses a minimal fake node (just start_byte/end_byte)
        rather than coaxing tree-sitter into producing a node
        over invalid bytes — keeps the test hermetic.
        """

        class FakeNode:
            start_byte = 0
            end_byte = 5

        source = b"ab\xff\xfecd"
        result = BaseExtractor._node_text(FakeNode(), source)
        # Valid prefix preserved; invalid bytes become the
        # Unicode replacement character. Don't pin the exact
        # string — different Python versions may differ on
        # whether replacement is one or two chars — just
        # assert the prefix and length.
        assert result.startswith("ab")
        assert len(result) >= 3

    def test_empty_range_returns_empty_string(self) -> None:
        """A node with start_byte == end_byte decodes to "".

        Tree-sitter produces zero-width nodes for missing
        optional elements (e.g. a function with no return type
        annotation). _node_text must handle them without
        special-casing.
        """

        class FakeNode:
            start_byte = 3
            end_byte = 3

        assert BaseExtractor._node_text(FakeNode(), b"abcdef") == ""


# ---------------------------------------------------------------------------
# _range and _start_line — position conversion
# ---------------------------------------------------------------------------


class TestRange:
    """_range / _start_line produce 0-indexed tuples."""

    def test_range_returns_four_tuple(self, python_tree) -> None:
        """_range matches the (start_line, start_col, end_line, end_col) shape.

        The symbol data model stores ranges in this exact shape;
        a mismatch here propagates to every downstream consumer.
        """
        tree, _source = python_tree
        root = tree.root_node
        func_def = root.children[0]
        result = BaseExtractor._range(func_def)
        assert isinstance(result, tuple)
        assert len(result) == 4
        assert all(isinstance(n, int) for n in result)

    def test_range_is_zero_indexed(self, python_tree) -> None:
        """First line is row 0, not row 1.

        Tree-sitter's native convention is 0-indexed rows and
        columns. Symbol.range preserves that (specs4 matches).
        Callers converting to 1-indexed for UI do so at the
        boundary — this helper doesn't.
        """
        tree, _source = python_tree
        root = tree.root_node
        # `def hello` is on line 0 (first line) starting at col 0.
        func_def = root.children[0]
        start_row, start_col, _, _ = BaseExtractor._range(func_def)
        assert start_row == 0
        assert start_col == 0

    def test_range_spans_multiple_lines(self, python_tree) -> None:
        """Multi-line nodes have end_line > start_line.

        ``def hello(name):\\n    return name`` spans two lines,
        so end_row should be at least one greater than start_row.
        """
        tree, _source = python_tree
        root = tree.root_node
        func_def = root.children[0]
        start_row, _, end_row, _ = BaseExtractor._range(func_def)
        assert end_row > start_row

    def test_start_line_matches_range(self, python_tree) -> None:
        """_start_line returns the same row as _range's first element.

        It's a convenience alias; pin the relationship so a
        future refactor can't drift one without the other.
        """
        tree, _source = python_tree
        root = tree.root_node
        func_def = root.children[0]
        assert (
            BaseExtractor._start_line(func_def)
            == BaseExtractor._range(func_def)[0]
        )


# ---------------------------------------------------------------------------
# _find_child / _find_children
# ---------------------------------------------------------------------------


class TestFindChild:
    """Direct-child lookup by node type."""

    def test_finds_first_matching_child(self, python_tree) -> None:
        """_find_child returns the first child of the given type."""
        tree, _source = python_tree
        root = tree.root_node
        func = BaseExtractor._find_child(root, "function_definition")
        assert func is not None
        assert func.type == "function_definition"

    def test_returns_none_when_no_match(self, python_tree) -> None:
        """No matching child → None, not exception.

        Callers treat None as "malformed source, skip" —
        tree-sitter produces nodes with missing children when
        parsing broken code, and we shouldn't crash on that.
        """
        tree, _source = python_tree
        root = tree.root_node
        result = BaseExtractor._find_child(root, "interface_declaration")
        assert result is None

    def test_accepts_multiple_types(self, python_tree) -> None:
        """Multiple type names — first match of any wins.

        Useful when a language has several node types that serve
        the same semantic role (e.g. JS has both
        ``function_declaration`` and ``arrow_function`` for
        callables).
        """
        tree, _source = python_tree
        root = tree.root_node
        # Either type should match; real result is
        # function_definition since it appears first in source.
        result = BaseExtractor._find_child(
            root, "interface_declaration", "function_definition"
        )
        assert result is not None
        assert result.type == "function_definition"

    def test_searches_direct_children_only(self, python_tree) -> None:
        """Doesn't recurse into grandchildren.

        The helper's job is "look in the immediate children";
        callers wanting recursion use _walk.
        """
        tree, _source = python_tree
        root = tree.root_node
        # `identifier` appears deep inside function_definition
        # but not as a direct child of the module root.
        result = BaseExtractor._find_child(root, "identifier")
        assert result is None


class TestFindChildren:
    """_find_children returns all matches, preserving order."""

    def test_returns_all_matches(self, python_tree) -> None:
        """All children of the requested type come back.

        The fixture has one function_definition and one
        class_definition at top level; asking for both types
        should return both nodes.
        """
        tree, _source = python_tree
        root = tree.root_node
        callable_like = BaseExtractor._find_children(
            root, "function_definition", "class_definition"
        )
        assert len(callable_like) == 2
        types = [n.type for n in callable_like]
        assert "function_definition" in types
        assert "class_definition" in types

    def test_preserves_source_order(self, python_tree) -> None:
        """Results come back in source order, not grammar order.

        Source is ``def hello`` THEN ``class Greeter``. That
        order matters — downstream rendering (symbol map output)
        respects source order so diffs stay stable.
        """
        tree, _source = python_tree
        root = tree.root_node
        matches = BaseExtractor._find_children(
            root, "function_definition", "class_definition"
        )
        assert matches[0].type == "function_definition"
        assert matches[1].type == "class_definition"

    def test_returns_empty_list_when_no_match(self, python_tree) -> None:
        """No match → [], not None.

        List comprehension callers (``[x for x in result]``)
        need an iterable; None would break them.
        """
        tree, _source = python_tree
        root = tree.root_node
        result = BaseExtractor._find_children(root, "interface_declaration")
        assert result == []


# ---------------------------------------------------------------------------
# _walk / _walk_named — tree traversal
# ---------------------------------------------------------------------------


class TestWalk:
    """Depth-first walk visiting every descendant."""

    def test_visits_all_descendants(self, python_tree) -> None:
        """Walk sees children, grandchildren, and deeper.

        The identifier inside ``def hello(name)`` sits three
        levels deep; seeing it proves the walk recurses, not
        just iterates direct children.
        """
        tree, _source = python_tree
        root = tree.root_node
        visited: list[str] = []
        BaseExtractor._walk(root, lambda n: visited.append(n.type))
        assert "function_definition" in visited
        assert "class_definition" in visited
        # identifier lives inside function_definition (the name),
        # and walking must descend that far.
        assert "identifier" in visited

    def test_does_not_visit_root(self, python_tree) -> None:
        """The root node itself isn't passed to the visitor.

        Documented contract — callers use _walk inside "scan the
        body of X" helpers where X is already known and only its
        descendants are interesting.
        """
        tree, _source = python_tree
        root = tree.root_node
        # Module is the root node's type for Python.
        assert root.type == "module"
        visited: list[str] = []
        BaseExtractor._walk(root, lambda n: visited.append(n.type))
        assert "module" not in visited

    def test_visits_in_source_order(self, python_tree) -> None:
        """Visitor sees top-level children in source order.

        The explicit-stack iteration uses ``reversed`` on extend
        to preserve this property against LIFO stack semantics.
        Pin it — a regression would subtly reorder call-site
        lists and make diffs noisy downstream.
        """
        tree, _source = python_tree
        root = tree.root_node
        visited: list[str] = []
        BaseExtractor._walk(root, lambda n: visited.append(n.type))
        # function_definition should appear before
        # class_definition in the walk order.
        func_idx = visited.index("function_definition")
        class_idx = visited.index("class_definition")
        assert func_idx < class_idx

    def test_handles_empty_children(self, parser: TreeSitterParser) -> None:
        """Walking a node with no child nodes is a no-op.

        Not strictly "no children" in tree-sitter terms (even a
        single ``pass`` statement has anonymous keyword tokens
        as children), but the visitor handler should just run
        cleanly over whatever's there without raising.
        """
        if not parser.is_available("python"):
            pytest.skip("tree_sitter_python not installed")
        tree = parser.parse(b"pass\n", "python")
        assert tree is not None
        pass_stmt = tree.root_node.children[0]
        # No assertion on what's visited — just proving the walk
        # completes without raising on a minimal tree.
        BaseExtractor._walk(pass_stmt, lambda _n: None)


class TestWalkNamed:
    """_walk_named filters out anonymous punctuation nodes."""

    def test_still_visits_named_descendants(self, python_tree) -> None:
        """Named nodes reach the visitor just like in _walk.

        Smoke test — function_definition, class_definition,
        identifier are all named nodes and must still be
        reported.
        """
        tree, _source = python_tree
        root = tree.root_node
        visited: list[str] = []
        BaseExtractor._walk_named(root, lambda n: visited.append(n.type))
        assert "function_definition" in visited
        assert "class_definition" in visited
        assert "identifier" in visited

    def test_only_visits_named_nodes(self, python_tree) -> None:
        """Anonymous nodes (keywords, punctuation) are skipped.

        Every node the visitor receives should report
        ``is_named=True``. Anonymous nodes in a Python parse
        include the literal ``def`` keyword, parentheses,
        commas, the colon after the signature, etc.
        """
        tree, _source = python_tree
        root = tree.root_node
        named_flags: list[bool] = []
        BaseExtractor._walk_named(
            root, lambda n: named_flags.append(n.is_named)
        )
        assert named_flags  # non-empty — we visited something
        assert all(named_flags), (
            "_walk_named must only visit named nodes"
        )

    def test_visits_fewer_nodes_than_walk(self, python_tree) -> None:
        """_walk_named visits strictly fewer nodes than _walk.

        The whole point of the helper — skipping anonymous
        punctuation cuts the visitor's work. If the two counts
        matched, the filtering logic would be a no-op.
        """
        tree, _source = python_tree
        root = tree.root_node
        walk_count = 0
        named_count = 0

        def _count_walk(_n):
            nonlocal walk_count
            walk_count += 1

        def _count_named(_n):
            nonlocal named_count
            named_count += 1

        BaseExtractor._walk(root, _count_walk)
        BaseExtractor._walk_named(root, _count_named)
        assert named_count < walk_count