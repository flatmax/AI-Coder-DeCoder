"""Cross-file reference graph for symbol-index data.

Builds a dependency graph from :class:`FileSymbols` objects and
exposes queries used by the symbol-map formatter (incoming
reference counts) and the stability tracker (connected
components for cache tier initialisation).

Governing spec: ``specs4/2-indexing/reference-graph.md``.

Design notes:

- **Takes pre-resolved FileSymbols as input.** Call sites must
  have ``target_file`` set before the reference index is built;
  that's the import resolver's job (Layer 2.5). The index
  itself performs no resolution — it aggregates edges from
  already-resolved data.

- **Symmetric queries.** "Files that reference X" and "files X
  depends on" are equally cheap lookups. Both are needed —
  the formatter wants incoming counts, the stability tracker
  wants connected components which need undirected edges.

- **Edges carry weight.** Multiple references from file A to
  file B (several call sites or an import plus calls) collapse
  into one weighted edge rather than being tracked
  individually. Connected-component detection doesn't care
  about weight, but :meth:`file_ref_count` does — it returns
  the total number of incoming references, not the number of
  referencing files.

- **Builtin filtering happens upstream.** Extractors already
  filter language-level builtins (``print``, ``self``, ``True``,
  test-framework hooks) from their call-site output. The
  reference index trusts that input — adding a second filter
  here would duplicate the work and make the reference graph
  inconsistent with what the extractors emitted.

- **Case-sensitive name matching.** Symbol names are matched
  exactly. Case-insensitive matching would produce false
  positives on languages where identifiers are case-sensitive
  (most of them) and mask genuine typos.

- **Plain class, not a singleton.** The orchestrator builds
  one instance per session; tests construct fresh instances
  per case. No thread-safety guarantees — callers drive the
  index from a single executor.
"""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ac_dc.symbol_index.models import FileSymbols


class ReferenceIndex:
    """Cross-file reference graph.

    Built once from a list of :class:`FileSymbols` via
    :meth:`build`. Queries work against the built graph; rebuild
    after any source change that affects imports or call-site
    resolution.
    """

    def __init__(self) -> None:
        # Symbol name → list of (referencing_file, line) pairs.
        # Aggregated across the whole repo; one entry per call
        # site that resolved to this symbol.
        self._refs_to_symbol: dict[str, list[tuple[str, int]]] = (
            defaultdict(list)
        )

        # Incoming edges: target_file → {source_file: count}.
        # Count is the total number of references (call sites or
        # imports) from source to target, not just 1.
        self._incoming: dict[str, dict[str, int]] = defaultdict(
            lambda: defaultdict(int)
        )

        # Outgoing edges: source_file → {target_file: count}.
        # Mirror of _incoming — kept explicitly so both
        # "references to this file" and "files this file
        # depends on" are O(1) lookups.
        self._outgoing: dict[str, dict[str, int]] = defaultdict(
            lambda: defaultdict(int)
        )

        # All files we've seen, even ones with no references in
        # either direction. Used by connected_components so
        # isolated files still appear in the result (as
        # singleton components).
        self._all_files: set[str] = set()

    # ------------------------------------------------------------------
    # Build
    # ------------------------------------------------------------------

    def build(self, file_symbols_list: list["FileSymbols"]) -> None:
        """Construct the graph from a list of FileSymbols.

        Idempotent — calling build twice produces the same graph
        regardless of previous state. The implementation clears
        all internal structures first, so a rebuild after a file
        change (new imports, resolved call sites) replaces the
        old graph cleanly.

        Inputs are expected to have call-site ``target_file``
        fields populated by the import resolver. Call sites
        whose target couldn't be resolved (None target_file)
        are silently skipped — they contribute neither to
        incoming-count queries nor to the connected-component
        graph.
        """
        # Reset state. Can't just mutate — defaultdicts of
        # defaultdicts accumulate across rebuilds otherwise.
        self._refs_to_symbol = defaultdict(list)
        self._incoming = defaultdict(lambda: defaultdict(int))
        self._outgoing = defaultdict(lambda: defaultdict(int))
        self._all_files = set()

        # First pass — record every file, even ones with no
        # outgoing references. Ensures isolated files appear
        # in connected_components output as singletons.
        for fs in file_symbols_list:
            self._all_files.add(fs.file_path)

        # Second pass — collect edges from call sites and imports.
        for fs in file_symbols_list:
            source = fs.file_path
            self._record_call_sites(source, fs)
            self._record_imports(source, fs)

    def _record_call_sites(
        self,
        source: str,
        fs: "FileSymbols",
    ) -> None:
        """Record edges from resolved call sites.

        Walks all symbols (including nested children) via
        :attr:`FileSymbols.all_symbols_flat` so method-body call
        sites contribute edges just like top-level function
        bodies.
        """
        for sym in fs.all_symbols_flat:
            for site in sym.call_sites:
                target_file = site.target_file
                if target_file is None:
                    # Unresolved — import resolver didn't find
                    # the call's target. Skip rather than
                    # invent an edge.
                    continue
                target_symbol = site.target_symbol or site.name
                self._refs_to_symbol[target_symbol].append(
                    (source, site.line)
                )
                if target_file == source:
                    # Same-file reference counts for the
                    # symbol-name index (so find-references
                    # within a file still works) but NOT for
                    # file-level edges — a file referencing
                    # itself is noise in the reference graph.
                    continue
                self._outgoing[source][target_file] += 1
                self._incoming[target_file][source] += 1
                self._all_files.add(target_file)

    def _record_imports(
        self,
        source: str,
        fs: "FileSymbols",
    ) -> None:
        """Record edges from resolved import statements.

        Import entries reaching this layer have been resolved
        by the import resolver (Layer 2.5) and carry their
        target in a ``resolved_target`` attribute when the
        target is a repo-relative file path. Unresolved
        imports (external packages, standard library) have
        no target attribute or a None value — they're skipped.

        Layer 2.4 doesn't yet have the resolver in place. The
        attribute check uses ``getattr`` so pre-resolver
        FileSymbols (imports with only ``module`` populated)
        flow through without errors — they just don't
        contribute edges yet.
        """
        for imp in fs.imports:
            target_file = getattr(imp, "resolved_target", None)
            if target_file is None:
                continue
            if target_file == source:
                # Self-import is nonsensical but not an error —
                # skip without accumulating a useless edge.
                continue
            self._outgoing[source][target_file] += 1
            self._incoming[target_file][source] += 1
            self._all_files.add(target_file)

    # ------------------------------------------------------------------
    # Queries — symbol-name and file-level
    # ------------------------------------------------------------------

    def references_to_symbol(
        self,
        name: str,
    ) -> list[tuple[str, int]]:
        """All locations (file, line) referencing a symbol by name.

        Used by LSP "find references" and by the symbol-map
        formatter when rendering ``←N`` annotations. Returns
        the call-site locations themselves, not just the
        referencing files — a file with three call sites to
        the same symbol appears three times in the list.

        Returns an empty list for unknown names rather than
        raising — callers use it as a presence probe too.
        """
        # Return a copy so callers can't mutate internal state.
        return list(self._refs_to_symbol.get(name, []))

    def files_referencing(self, path: str) -> set[str]:
        """Set of files that reference ``path``.

        "Reference" means at least one call site or import with
        ``path`` as the target. Weight doesn't matter — the
        return type is a set.

        Returns empty set for unknown paths.
        """
        incoming = self._incoming.get(path)
        if incoming is None:
            return set()
        return set(incoming.keys())

    def file_dependencies(self, path: str) -> set[str]:
        """Set of files ``path`` depends on.

        Inverse of :meth:`files_referencing`. Used by the
        formatter to render "this file references X, Y, Z"
        lines.
        """
        outgoing = self._outgoing.get(path)
        if outgoing is None:
            return set()
        return set(outgoing.keys())

    def file_ref_count(self, path: str) -> int:
        """Total number of references pointing at ``path``.

        Sum of weights on incoming edges — a file with two call
        sites from A and one import from B has ref_count 3, not
        2. The symbol-map formatter uses this for the ``←N``
        annotation which is about reference volume, not
        distinct-referrer count.
        """
        incoming = self._incoming.get(path)
        if incoming is None:
            return 0
        return sum(incoming.values())

    # ------------------------------------------------------------------
    # Queries — mutual references and clustering
    # ------------------------------------------------------------------

    def bidirectional_edges(self) -> set[tuple[str, str]]:
        """Pairs of files that reference each other mutually.

        Returns canonical ``(lo, hi)`` tuples where
        ``lo < hi`` alphabetically — avoids reporting the
        same mutual pair twice. The stability tracker's
        connected-component algorithm uses this as its edge
        set: only bidirectional references count as "these
        files belong together"; unidirectional references are
        too weak a signal to cluster on.
        """
        pairs: set[tuple[str, str]] = set()
        for source, targets in self._outgoing.items():
            for target in targets:
                # Check the reverse direction exists.
                if self._outgoing.get(target, {}).get(source):
                    lo, hi = (source, target) if source < target else (target, source)
                    pairs.add((lo, hi))
        return pairs

    def connected_components(self) -> list[set[str]]:
        """Group files into clusters via mutual references only.

        Uses the undirected graph formed by
        :meth:`bidirectional_edges`. Files not in any
        bidirectional pair appear as singleton components.
        Matches the specs4 clustering rule — the stability
        tracker wants "files that mutually depend on each
        other" which is a stronger signal than one-way
        references.

        Returns components in no particular order. The
        stability tracker's greedy bin-packer doesn't depend
        on order, and imposing one would mask bugs where
        callers accidentally rely on a specific traversal.
        """
        # Union-Find over all known files.
        parent: dict[str, str] = {f: f for f in self._all_files}

        def find(x: str) -> str:
            # Path-compression union-find. Iterative to avoid
            # Python's recursion limit on pathological inputs.
            root = x
            while parent[root] != root:
                root = parent[root]
            # Compress.
            while parent[x] != root:
                parent[x], x = root, parent[x]
            return root

        def union(a: str, b: str) -> None:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb

        for lo, hi in self.bidirectional_edges():
            union(lo, hi)

        # Group by root.
        groups: dict[str, set[str]] = defaultdict(set)
        for f in self._all_files:
            groups[find(f)].add(f)
        return list(groups.values())