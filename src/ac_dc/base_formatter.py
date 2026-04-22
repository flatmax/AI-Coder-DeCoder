"""Base class for compact-format output generators.

Shared infrastructure for :class:`~ac_dc.symbol_index.compact_format.CompactFormatter`
(Layer 2.6) and :class:`~ac_dc.doc_index.formatter.DocFormatter`
(Layer 2.7 / future). Both produce token-efficient text maps
of the repo — the symbol formatter for code, the doc formatter
for markdown and SVG outlines — and both share the same
plumbing for path aliases and incoming reference counts.

Governing specs:

- ``specs4/2-indexing/symbol-index.md#compact-format--symbol-map``
- ``specs4/2-indexing/document-index.md#compact-output-format``

Design points:

- Path aliasing is the biggest token win — long repeated
  path prefixes get short aliases, computed once per map
  generation from reference-frequency data. Content-stable
  across regenerations so the cache stability tracker doesn't
  see spurious changes.
- Reference counts come from the reference index. The
  formatter never computes them itself.
- Per-file block generation is the unit. Subclasses implement
  ``_format_file`` for one file's block; the base handles
  legend assembly, alias computation, ordering, concatenation.
- Legend is language-family-specific — subclasses return their
  own legend text via :meth:`_legend`.
- Deterministic output — same input produces byte-identical
  output. The stability tracker hashes formatted blocks.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Iterable

if TYPE_CHECKING:
    from ac_dc.symbol_index.reference_index import ReferenceIndex


# Minimum length before a prefix earns an alias. Shorter
# prefixes save nothing — the alias ``@1/`` is 3 chars and
# each use adds those 3 chars. A prefix must be long enough
# that per-use savings outweigh the legend cost.
_MIN_ALIAS_PREFIX_LEN = 8

# Minimum number of files sharing a prefix before aliasing.
# One file with a long path is cheaper to leave alone than
# to alias; two files is break-even; three comfortably worth it.
_MIN_ALIAS_USE_COUNT = 3

# Maximum number of aliases to emit. The legend competes with
# file content for token budget.
_MAX_ALIASES = 5


class BaseFormatter(ABC):
    """Abstract base for compact-map formatters.

    Subclasses implement :meth:`_format_file` to render one
    file's block and :meth:`_legend` for the language-specific
    abbreviation key. The base class handles legend assembly,
    alias computation, ordering, and concatenation.

    Stateless across format() calls — construct once, reuse.
    """

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def format(
        self,
        files: Iterable[str],
        ref_index: "ReferenceIndex | None" = None,
        exclude_files: "set[str] | None" = None,
        include_legend: bool = True,
    ) -> str:
        """Render a complete map for ``files``.

        Parameters
        ----------
        files
            Repo-relative paths to include. Order doesn't
            matter — the formatter sorts before rendering.
        ref_index
            Optional reference index for ``←N`` annotations.
            When None, counts are omitted.
        exclude_files
            Paths to skip even when in ``files``. Used by the
            streaming handler to hide files whose full content
            is already in a cached tier (uniqueness invariant).
        include_legend
            When True (default), prepends the legend block.
            Set False when rendering a continuation block for
            a cached tier.
        """
        excluded = exclude_files or set()
        sorted_files = sorted(
            p for p in files if p and p not in excluded
        )
        if not sorted_files:
            return ""

        aliases = self._compute_aliases(sorted_files)
        parts: list[str] = []
        if include_legend:
            parts.append(self._render_legend(aliases))

        for path in sorted_files:
            block = self._format_file(path, aliases, ref_index)
            if block:
                parts.append(block)

        return "\n\n".join(parts) + "\n"

    def get_legend(
        self,
        files: Iterable[str] | None = None,
    ) -> str:
        """Return just the legend block, without file content.

        Used by the L0 cache tier block which wants the legend
        separately from file entries (so the legend can be
        cached alongside the system prompt while file blocks
        cascade through tiers independently).
        """
        aliases = self._compute_aliases(
            sorted(files) if files else []
        )
        return self._render_legend(aliases)

    # ------------------------------------------------------------------
    # Abstract hooks
    # ------------------------------------------------------------------

    @abstractmethod
    def _legend(self) -> str:
        """Return the language-family-specific legend text.

        Should NOT include path aliases — those are appended
        by :meth:`_render_legend`. Just the abbreviation key
        for the kind codes this formatter emits.
        """
        raise NotImplementedError

    @abstractmethod
    def _format_file(
        self,
        path: str,
        aliases: dict[str, str],
        ref_index: "ReferenceIndex | None",
    ) -> str:
        """Render one file's compact block.

        Returns empty string when the file has no renderable
        content. The caller skips empty strings when joining.
        """
        raise NotImplementedError

    # ------------------------------------------------------------------
    # Path aliasing
    # ------------------------------------------------------------------

    def _compute_aliases(
        self,
        sorted_files: list[str],
    ) -> dict[str, str]:
        """Compute prefix → alias map for the current file set.

        Strategy:

        1. For every file, enumerate its directory prefixes.
        2. Count how many files each prefix covers.
        3. Drop prefixes shorter than :data:`_MIN_ALIAS_PREFIX_LEN`
           or used by fewer than :data:`_MIN_ALIAS_USE_COUNT` files.
        4. Sort by (savings desc, length desc, text asc) —
           deterministic tie-break ensures byte-stable output.
        5. Greedily assign aliases ``@1/`` through ``@N/`` up
           to :data:`_MAX_ALIASES`, skipping sub-prefixes of
           already-assigned aliases.

        Returns a dict of prefix (with trailing slash) → alias
        (``"@N/"``). Empty dict when no prefix qualifies.
        """
        if not sorted_files:
            return {}

        # Count prefix occurrences across files.
        prefix_counts: dict[str, int] = {}
        for path in sorted_files:
            parts = path.split("/")
            # Enumerate every directory prefix. A single-segment
            # path has no meaningful directory prefix.
            for i in range(1, len(parts)):
                prefix = "/".join(parts[:i]) + "/"
                prefix_counts[prefix] = prefix_counts.get(prefix, 0) + 1

        # Filter by length and use-count thresholds. Compute
        # savings per candidate to drive the sort.
        candidates: list[tuple[str, int, int]] = []
        for prefix, count in prefix_counts.items():
            if len(prefix) < _MIN_ALIAS_PREFIX_LEN:
                continue
            if count < _MIN_ALIAS_USE_COUNT:
                continue
            # Alias is ``@N/`` = 3 chars; savings per use = len - 3.
            savings = (len(prefix) - 3) * count
            candidates.append((prefix, count, savings))

        # Sort by savings desc, length desc, prefix asc.
        candidates.sort(key=lambda x: (-x[2], -len(x[0]), x[0]))

        aliases: dict[str, str] = {}
        next_id = 1
        for prefix, _count, _savings in candidates:
            if next_id > _MAX_ALIASES:
                break
            # Skip prefixes that are an ancestor of an already-
            # assigned alias. The candidate list is sorted by
            # savings descending, so the deepest qualifying
            # prefix wins first — its shallower parents would
            # shadow it for every file they cover, costing a
            # legend line for zero additional savings.
            if any(p.startswith(prefix) for p in aliases):
                continue
            aliases[prefix] = f"@{next_id}/"
            next_id += 1

        return aliases

    @staticmethod
    def _apply_aliases(
        path: str,
        aliases: dict[str, str],
    ) -> str:
        """Replace the longest matching prefix in ``path`` with its alias.

        Subclasses use this when rendering paths in per-file
        blocks — incoming reference locations, outgoing calls,
        import targets. Always picks the longest matching
        prefix so a deeper alias wins over a shallower one.
        """
        best_prefix = ""
        for prefix in aliases:
            if path.startswith(prefix) and len(prefix) > len(best_prefix):
                best_prefix = prefix
        if best_prefix:
            return aliases[best_prefix] + path[len(best_prefix):]
        return path

    # ------------------------------------------------------------------
    # Legend assembly
    # ------------------------------------------------------------------

    def _render_legend(self, aliases: dict[str, str]) -> str:
        """Assemble the full legend block: subclass legend + aliases.

        The subclass legend (abbreviation key) is followed by
        an alias block when any aliases exist. Output is a
        block of commented lines — the leading ``# `` means
        the LLM treats it as context rather than something to
        act on.
        """
        parts = [self._legend()]
        if aliases:
            # Render in assignment order (@1 before @2) so the
            # legend reads predictably top-to-bottom.
            sorted_items = sorted(
                aliases.items(), key=lambda kv: kv[1]
            )
            alias_lines = [
                f"# {alias}={prefix}"
                for prefix, alias in sorted_items
            ]
            parts.append("\n".join(alias_lines))
        return "\n".join(parts)