"""Base class for language-specific symbol extractors.

Design notes:

- **Thin base** — plumbing only. Text decoding, range conversion,
  tree walking. No per-node-type dispatch; each subclass handles
  its own AST shape. Shared semantic helpers can graduate here
  later when a pattern genuinely appears in 3+ languages.

- **``tree_optional``** — when True, the extractor runs without
  a parse tree. Used by the (deferred) MATLAB extractor which
  has no maintained tree-sitter grammar. The orchestrator checks
  this flag before requiring a tree; default False means "needs
  tree-sitter".

- **Byte-oriented** — the API takes raw bytes because that's
  what tree-sitter produces. Extractors decode on demand via
  ``_node_text``. Invalid UTF-8 bytes are replaced rather than
  raised (matches the parser's tolerant behaviour).

- **0-indexed ranges** — matches tree-sitter's native convention.
  Callers presenting line numbers to users add 1 at the UI
  boundary. Consistency with :class:`~ac_dc.symbol_index.models.Symbol.range`.

Governing spec: ``specs4/2-indexing/symbol-index.md#per-language-extractors``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Callable

from ac_dc.symbol_index.models import FileSymbols

if TYPE_CHECKING:
    import tree_sitter


class BaseExtractor:
    """Abstract base for per-language symbol extractors.

    Subclasses implement :meth:`extract`. The base provides
    helpers for common tree-sitter manipulations every extractor
    needs — text decoding from byte ranges, node position
    conversion, child lookup, tree traversal.

    Attributes
    ----------
    language : str
        The language name this extractor handles. Must match a
        key in :data:`~ac_dc.symbol_index.parser.LANGUAGE_MAP`
        (or be set on the subclass for tree-optional extractors
        like MATLAB). Subclasses override as a class-level
        constant.
    tree_optional : bool
        When True, the extractor runs without a parse tree. The
        orchestrator passes ``tree=None`` to such extractors.
        Default False — most languages require tree-sitter.
    """

    language: str = ""
    tree_optional: bool = False

    def extract(
        self,
        tree: "tree_sitter.Tree | None",
        source: bytes,
        path: str,
    ) -> FileSymbols:
        """Extract symbols from a parsed tree.

        Parameters
        ----------
        tree
            The tree-sitter parse tree. Always non-None for normal
            extractors; None only for extractors that declare
            ``tree_optional = True``.
        source
            The raw source bytes that were parsed. Required even
            when the tree is provided — tree-sitter nodes carry
            byte offsets, not content, so the extractor needs the
            bytes to decode names and signatures.
        path
            Repo-relative file path. Stored on the returned
            :class:`FileSymbols` for downstream consumers
            (reference index, formatter).

        Returns
        -------
        FileSymbols
            The extracted symbols. Empty lists rather than None
            when nothing was found — makes callers simpler.

        Raises
        ------
        NotImplementedError
            Subclasses must override.
        """
        raise NotImplementedError(
            f"{type(self).__name__} must implement extract()"
        )

    # ------------------------------------------------------------------
    # Text and range helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _node_text(node: "tree_sitter.Node", source: bytes) -> str:
        """Return the UTF-8-decoded text of a node.

        Uses ``errors='replace'`` so non-UTF-8 bytes (a Python file
        with a mis-declared encoding, for instance) don't raise —
        the replacement character is better than crashing the whole
        extraction. Matches the parser's lenience on decode.

        Works by slicing the source bytes between the node's
        start and end byte offsets. Tree-sitter nodes don't carry
        content; they only carry positions.
        """
        return source[node.start_byte:node.end_byte].decode(
            "utf-8", errors="replace"
        )

    @staticmethod
    def _range(
        node: "tree_sitter.Node",
    ) -> tuple[int, int, int, int]:
        """Return the 0-indexed (start_line, start_col, end_line, end_col).

        Matches :class:`~ac_dc.symbol_index.models.Symbol.range`.
        Tree-sitter's ``start_point`` / ``end_point`` are already
        0-indexed ``(row, column)`` tuples.
        """
        start_row, start_col = node.start_point
        end_row, end_col = node.end_point
        return (start_row, start_col, end_row, end_col)

    @staticmethod
    def _start_line(node: "tree_sitter.Node") -> int:
        """0-indexed start row of a node.

        Convenience for callers that only need the line. Common in
        call-site extraction where the full range is overkill.
        """
        return node.start_point[0]

    # ------------------------------------------------------------------
    # Tree navigation
    # ------------------------------------------------------------------

    @staticmethod
    def _find_child(
        node: "tree_sitter.Node",
        *types: str,
    ) -> "tree_sitter.Node | None":
        """Return the first direct child matching any of ``types``.

        Order preserved — useful when the language grammar puts
        a named identifier at a predictable position (e.g.
        Python's ``class`` node has ``name`` as its first
        ``identifier`` child).

        Returns None when no child matches. Callers handle None
        by treating it as "malformed source, skip this node" —
        tree-sitter produces nodes with missing children when
        parsing broken code, and we shouldn't crash on that.
        """
        type_set = set(types)
        for child in node.children:
            if child.type in type_set:
                return child
        return None

    @staticmethod
    def _find_children(
        node: "tree_sitter.Node",
        *types: str,
    ) -> list["tree_sitter.Node"]:
        """Return all direct children matching any of ``types``.

        Order preserved. Empty list when no match — never None,
        to keep list-comprehension callers simple.
        """
        type_set = set(types)
        return [c for c in node.children if c.type in type_set]

    @staticmethod
    def _walk(
        node: "tree_sitter.Node",
        visitor: Callable[["tree_sitter.Node"], None],
    ) -> None:
        """Depth-first walk — call ``visitor`` for every descendant.

        Does NOT include the root ``node`` itself — the visitor
        fires only for children, grandchildren, etc. This matches
        the common extractor pattern of "scan inside this function
        body for call sites" where the function node itself is
        irrelevant.

        Iterative (uses an explicit stack) rather than recursive
        to avoid hitting Python's default recursion limit on
        deeply nested source (large JavaScript files with
        deeply-chained promise expressions can nest 1000+
        levels).

        Source-order guarantee — the visitor sees descendants
        in left-to-right source order. LIFO stack semantics
        flip the natural order, so we reverse twice: once when
        seeding the stack from ``node.children`` and again on
        each ``extend`` of a popped node's children. Without
        the initial reverse, the root's children get visited
        right-to-left even though subsequent levels would be
        left-to-right — a subtle bug the tests caught.
        """
        stack: list["tree_sitter.Node"] = list(reversed(node.children))
        while stack:
            current = stack.pop()
            visitor(current)
            # Reverse before extending so LIFO stack order
            # produces left-to-right visitation on the next
            # iteration.
            stack.extend(reversed(current.children))

    @staticmethod
    def _walk_named(
        node: "tree_sitter.Node",
        visitor: Callable[["tree_sitter.Node"], None],
    ) -> None:
        """Like :meth:`_walk` but only visits named nodes.

        Tree-sitter distinguishes "named" nodes (grammar rules)
        from anonymous ones (literal punctuation — commas,
        brackets, semicolons). Extractors usually only care about
        named nodes; skipping punctuation cuts the visitor's
        work substantially on large files.

        Source-order guarantee matches :meth:`_walk` — the
        initial stack is seeded in reverse so LIFO pop yields
        left-to-right visitation.
        """
        stack: list["tree_sitter.Node"] = [
            c for c in reversed(list(node.children)) if c.is_named
        ]
        while stack:
            current = stack.pop()
            visitor(current)
            stack.extend(
                c for c in reversed(list(current.children))
                if c.is_named
            )