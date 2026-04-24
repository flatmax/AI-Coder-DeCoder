"""Cross-document reference graph for the document index.

Mirrors :class:`ac_dc.symbol_index.reference_index.ReferenceIndex`
but operates on :class:`DocOutline` objects instead of
:class:`FileSymbols`. Edges represent "document A's heading links
to document B's heading" rather than "function A calls function B".

Governing spec: ``specs4/2-indexing/document-index.md`` §
Cross-Reference Index.

Design points pinned by the test suite:

- **Section-level incoming counts.** A :class:`DocLink` with
  fragment ``#section-two`` resolves to the specific heading
  and increments that heading's :attr:`DocHeading.incoming_ref_count`.
  A fragment-less link increments the target document's
  top-level heading count — treated as a document-level ref.

- **Self-references dropped.** Links from a document to its own
  headings don't count. Otherwise a README with a ToC would
  inflate every heading's count by one for no useful signal.

- **Per-(source-heading, target-heading) deduplication.** Two
  links from the same source heading to the same target pair
  count once. Matches the code-side reference graph's
  "collapsed weighted edge" model — multiple references are
  still one conceptual "A depends on B" relationship.

- **Unresolved anchors fall back to document-level.** A link
  with a ``#does-not-exist`` fragment still counts — against
  the target document's top-level heading. Better than silently
  losing the signal entirely; the author's *intent* was to
  reference that document.

- **GitHub-style anchor slugging.** Lowercase, spaces →
  hyphens, punctuation stripped. Matches how most markdown
  renderers (and GitHub itself) generate heading anchors.
  Enables cross-document links written with either the original
  heading text as fragment or the rendered slug.

- **Same protocol as code-side reference index.** Exposes
  :meth:`connected_components` and :meth:`file_ref_count` so
  the stability tracker's ``initialize_from_reference_graph``
  and ``initialize_with_keys`` methods work without changes.
  Tracker doesn't know or care about symbol vs doc semantics;
  it operates on file-level connectivity only.

- **Bidirectional-only clustering.** Connected components are
  built from mutual links (A → B AND B → A). One-way links
  don't cluster — matches the code-side rationale that weak
  signals would pollute tier placement more than they'd help.

- **Image links participate.** A :class:`DocLink` with
  ``is_image=True`` creates edges the same way regular links
  do. Lets doc → SVG pairs cluster together in the tier map.

- **Rebuild is fully idempotent.** :meth:`build` clears all
  internal state before processing. Orchestrator calls it after
  every re-index pass; accumulating state across rebuilds would
  produce stale edges to deleted files.

- **Input is authoritative, not validated.** The orchestrator
  (2.8.1f) assembles the outline list; this class trusts that
  every ``file_path`` is canonical and every link's ``target``
  is a repo-relative path (produced by extractors that already
  validated against the repo tree). No re-validation here.
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ac_dc.doc_index.models import DocHeading, DocLink, DocOutline


# ---------------------------------------------------------------------------
# Anchor slug helper
# ---------------------------------------------------------------------------


# GitHub-style slug. Lowercase, replace runs of whitespace with
# a single hyphen, strip characters that aren't alphanumeric or
# hyphen. Matches the rendering most markdown processors use —
# means a link written with either the original heading text or
# a manually-typed slug resolves the same way.
_SLUG_WHITESPACE_RE = re.compile(r"\s+")
_SLUG_STRIP_RE = re.compile(r"[^a-z0-9\-]+")


def _slugify(text: str) -> str:
    """Return a GitHub-style anchor slug for ``text``.

    Empty string in → empty string out. Whitespace-only in →
    empty string out. Punctuation-only in → empty string out.
    Callers should treat empty-slug returns as "no anchor" and
    fall back to document-level resolution.
    """
    lowered = text.strip().lower()
    if not lowered:
        return ""
    hyphenated = _SLUG_WHITESPACE_RE.sub("-", lowered)
    return _SLUG_STRIP_RE.sub("", hyphenated)


def _parse_link_target(target: str) -> tuple[str, str | None]:
    """Split a link target into (path, fragment).

    ``foo.md`` → ``("foo.md", None)``.
    ``foo.md#section-two`` → ``("foo.md", "section-two")``.
    ``foo.md#`` → ``("foo.md", None)`` — empty fragment treated
    as absent.
    Fragment-only targets (``#section``) land with empty path —
    the caller should reject these (self-reference at best,
    malformed at worst).
    """
    idx = target.find("#")
    if idx < 0:
        return target, None
    path = target[:idx]
    fragment = target[idx + 1:]
    return path, (fragment if fragment else None)


# ---------------------------------------------------------------------------
# DocReferenceIndex
# ---------------------------------------------------------------------------


class DocReferenceIndex:
    """In-memory graph of document-to-document references.

    Construct once, call :meth:`build` with a list of outlines,
    then query. :meth:`build` is idempotent — the orchestrator
    calls it after every re-index pass.

    Queries are cheap — all the heavy work happens during build.
    The stability tracker calls :meth:`file_ref_count` and
    :meth:`connected_components` once per initialization, so
    caching here would be overkill.
    """

    def __init__(self) -> None:
        # Outgoing edge multiplicities per source file. Key is
        # the source file path; value is a dict mapping target
        # file path to the number of deduplicated refs. Matches
        # the code-side reference index's shape for
        # :meth:`file_dependencies`.
        self._outgoing: dict[str, dict[str, int]] = defaultdict(dict)
        # Incoming edge multiplicities per target file. Mirror of
        # _outgoing indexed the other way. Matches
        # :meth:`files_referencing` and
        # :meth:`file_ref_count`.
        self._incoming: dict[str, dict[str, int]] = defaultdict(dict)
        # Set of every file path seen, including those with no
        # edges. Lets :meth:`connected_components` produce
        # singletons for isolated files — the tracker's
        # clustering step must see every file or newly-created
        # files would never register.
        self._all_files: set[str] = set()

    # ------------------------------------------------------------------
    # Build
    # ------------------------------------------------------------------

    def build(self, outlines: list["DocOutline"]) -> None:
        """Rebuild the graph from a list of outlines.

        Clears prior state. Iterates every link in every
        outline, resolves the target heading via slug matching,
        increments the target heading's
        :attr:`DocHeading.incoming_ref_count`, and records the
        collapsed file-level edge.

        Target-heading resolution is best-effort. When the
        fragment matches a heading, that heading's count is
        incremented. When it doesn't, the target document's
        top-level heading receives the count — matches the
        "unresolved anchor falls back to document-level"
        contract from specs4.

        Mutates heading ``incoming_ref_count`` values in-place
        on the passed-in outlines. This is intentional — the
        formatter reads these counts directly from the outline
        tree at render time, so the graph and the outlines
        stay in sync without a separate lookup.
        """
        # Reset. Three dicts + one set — cheap.
        self._outgoing = defaultdict(dict)
        self._incoming = defaultdict(dict)
        self._all_files = set()

        # Reset every heading's incoming count. A previous build
        # left counts on headings we're about to recount; leaving
        # them would inflate counts on rebuild. The outlines we
        # have are the whole world — anything not in this pass
        # gets zero.
        for outline in outlines:
            self._all_files.add(outline.file_path)
            self._reset_heading_counts(outline.headings)

        # Build a lookup from file path to outline for target
        # resolution. Extractors may hand us multiple outlines
        # for the same path — last one wins (shouldn't happen in
        # practice; tests pin the normal case).
        by_path: dict[str, "DocOutline"] = {
            outline.file_path: outline for outline in outlines
        }

        # Per-source-heading dedup key set. Keys are
        # (source_file, source_heading_slug, target_file,
        # target_heading_slug_or_empty). A second link with the
        # same key is dropped — matches the "multiple links from
        # the same source section to the same target section
        # count as one" rule from specs4.
        seen_edges: set[tuple[str, str, str, str]] = set()

        for outline in outlines:
            source_path = outline.file_path
            # Build a heading-slug → DocHeading lookup for THIS
            # outline. Also build reverse lookup from raw heading
            # text to slug for the dedup key.
            source_slug_to_heading = self._build_slug_map(
                outline.headings
            )

            for link in outline.links:
                self._process_link(
                    link=link,
                    source_path=source_path,
                    source_slug_to_heading=source_slug_to_heading,
                    by_path=by_path,
                    seen_edges=seen_edges,
                )

    def _process_link(
        self,
        *,
        link: "DocLink",
        source_path: str,
        source_slug_to_heading: dict[str, "DocHeading"],
        by_path: dict[str, "DocOutline"],
        seen_edges: set[tuple[str, str, str, str]],
    ) -> None:
        """Handle a single link during build.

        Factored out of :meth:`build` because the nesting is
        otherwise too deep — per-outline × per-link loop with
        three levels of branching for (a) self-reference check,
        (b) target-heading resolution, (c) dedup.
        """
        target_path, fragment = _parse_link_target(link.target)

        # Fragment-only target or empty target — skip. Either
        # a malformed link or an internal in-page anchor. The
        # extractor should filter these too, but we're defensive.
        if not target_path:
            return

        # Self-reference — skip. A README linking to one of its
        # own headings is navigation UI, not a cross-doc ref.
        if target_path == source_path:
            return

        # Resolve source heading slug. ``source_heading`` on the
        # link is the raw heading text (the extractor stores
        # "Section Two", not "section-two"); we slug it for the
        # dedup key and for matching against the source outline's
        # headings. Links that sit above the first heading (rare
        # but possible — e.g., a logo link at the top of a README)
        # have an empty source_heading; we treat these as having
        # slug "" for dedup purposes.
        source_slug = _slugify(link.source_heading)

        # Resolve target heading slug. Empty fragment means
        # "document-level link".
        target_slug = _slugify(fragment) if fragment else ""

        # Dedup key. Multiple links with the same source and
        # target pair (including heading-level specificity)
        # count once.
        edge_key = (source_path, source_slug, target_path, target_slug)
        if edge_key in seen_edges:
            return
        seen_edges.add(edge_key)

        # Record the file-level edge. The target may not be in
        # our by_path dict (extractor-validated paths should
        # always be present, but defensively we don't crash on
        # missing targets — we still record the edge for
        # clustering purposes).
        self._all_files.add(target_path)
        self._outgoing[source_path][target_path] = (
            self._outgoing[source_path].get(target_path, 0) + 1
        )
        self._incoming[target_path][source_path] = (
            self._incoming[target_path].get(source_path, 0) + 1
        )

        # Increment the target heading's incoming count. Resolve
        # by slug. Unresolved anchor or document-level link
        # falls back to the top-level heading.
        target_outline = by_path.get(target_path)
        if target_outline is None:
            return  # target file not in the outline set
        target_heading = self._resolve_target_heading(
            target_outline, target_slug
        )
        if target_heading is not None:
            target_heading.incoming_ref_count += 1

    def _resolve_target_heading(
        self,
        outline: "DocOutline",
        slug: str,
    ) -> "DocHeading | None":
        """Return the matching heading or the top-level fallback.

        Empty slug (document-level link) → return the first
        top-level heading. Non-empty slug that matches →
        return the matching heading. Non-empty slug that
        doesn't match → still return the top-level heading
        (unresolved-anchor fallback per specs4).
        """
        if not outline.headings:
            return None
        if not slug:
            return outline.headings[0]
        # Walk the flat list to find a matching slug.
        for heading in outline.all_headings_flat:
            if _slugify(heading.text) == slug:
                return heading
        # Unresolved anchor — fall back to document-level.
        return outline.headings[0]

    @staticmethod
    def _build_slug_map(
        headings: list["DocHeading"],
    ) -> dict[str, "DocHeading"]:
        """Return a slug → heading map for outline headings.

        Walks the full heading tree. Collisions (two headings
        slug to the same string — e.g., two H2s both titled
        "Overview" in different sections) retain the first.
        Per specs4 this is acceptable — duplicated slug handling
        is a markdown processor's convention, not ours to solve.
        """
        result: dict[str, "DocHeading"] = {}

        def _walk(nodes: list["DocHeading"]) -> None:
            for node in nodes:
                slug = _slugify(node.text)
                if slug and slug not in result:
                    result[slug] = node
                if node.children:
                    _walk(node.children)

        _walk(headings)
        return result

    @classmethod
    def _reset_heading_counts(
        cls,
        headings: list["DocHeading"],
    ) -> None:
        """Zero every heading's incoming_ref_count."""
        for heading in headings:
            heading.incoming_ref_count = 0
            if heading.children:
                cls._reset_heading_counts(heading.children)

    # ------------------------------------------------------------------
    # Query surface — matches ReferenceIndex's protocol
    # ------------------------------------------------------------------

    def file_ref_count(self, path: str) -> int:
        """Return total incoming references to ``path``.

        Sum over incoming edges. A file referenced twice from
        one source and once from another returns 3. Zero for
        isolated files or paths not in the index.

        Consumed by stability tracker's L0-seed ranking.
        """
        incoming = self._incoming.get(path)
        if not incoming:
            return 0
        return sum(incoming.values())

    def files_referencing(self, path: str) -> set[str]:
        """Return distinct source files referencing ``path``.

        Weighted multiplicities collapse to distinct paths.
        Fresh set — caller mutations don't affect stored state.
        """
        incoming = self._incoming.get(path)
        if not incoming:
            return set()
        return set(incoming.keys())

    def file_dependencies(self, path: str) -> set[str]:
        """Return distinct target files that ``path`` references."""
        outgoing = self._outgoing.get(path)
        if not outgoing:
            return set()
        return set(outgoing.keys())

    def bidirectional_edges(self) -> set[tuple[str, str]]:
        """Return canonical (lo, hi) pairs that reference each other.

        Each edge appears once with lexicographically lower path
        first. Consumed by :meth:`connected_components`.
        """
        result: set[tuple[str, str]] = set()
        for source, targets in self._outgoing.items():
            for target in targets:
                if source == target:
                    continue
                # Is there a reverse edge?
                reverse = self._outgoing.get(target)
                if reverse and source in reverse:
                    pair = (
                        (source, target)
                        if source < target
                        else (target, source)
                    )
                    result.add(pair)
        return result

    def connected_components(self) -> list[set[str]]:
        """Return connected components via union-find on bidirectional edges.

        Isolated files (no bidirectional edges) appear as
        singleton components. Matches the code-side contract so
        the stability tracker's clustering pass treats both
        indexes uniformly.

        One-way edges don't cluster — per specs4 the weak
        signal would hurt more than it helps.
        """
        # Union-find over _all_files. Parent dict; each file
        # initially its own root.
        parent: dict[str, str] = {
            path: path for path in self._all_files
        }

        def find(x: str) -> str:
            # Path compression.
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a: str, b: str) -> None:
            ra, rb = find(a), find(b)
            if ra != rb:
                # Deterministic by lex order so repeated builds
                # produce the same component roots.
                if ra < rb:
                    parent[rb] = ra
                else:
                    parent[ra] = rb

        for a, b in self.bidirectional_edges():
            union(a, b)

        # Group by root.
        components: dict[str, set[str]] = defaultdict(set)
        for path in self._all_files:
            components[find(path)].add(path)
        return list(components.values())