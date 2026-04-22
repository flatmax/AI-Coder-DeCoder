"""Compact format — the code symbol map rendered for the LLM.

Concrete :class:`~ac_dc.base_formatter.BaseFormatter` subclass
that turns a list of :class:`~ac_dc.symbol_index.models.FileSymbols`
into the token-efficient text format documented in
``specs3/2-code-analysis/symbol_index.md#compact-format-symbol-map``
and ``specs4/2-indexing/symbol-index.md#compact-format--symbol-map``.

Two variants, selected via ``include_line_numbers``:

- **Context** (default) — no line numbers on symbol entries.
  This is what the LLM sees. Token-efficient; legend omits
  ``:N=line(s)``.
- **LSP** (``include_line_numbers=True``) — line numbers appear
  after each symbol name as ``:N``. Used by editor features.

Design notes pinned by the test suite:

- Single-letter kind codes (``c``/``m``/``f``/``af``/``am``/``v``/``p``)
- Two-space indent per nesting level
- Instance vars rendered before methods (data before behaviour)
- Annotations trail the symbol line — ``←N`` when N > 0,
  ``→names`` for outgoing calls (deduped, order preserved)
- ``←0`` never emitted — absence means zero
- Empty parens suppressed for classes without bases but retained
  for functions without parameters

Governing specs:

- ``specs3/2-code-analysis/symbol_index.md#compact-format-symbol-map``
- ``specs4/2-indexing/symbol-index.md#compact-format--symbol-map``
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Iterable

from ac_dc.base_formatter import BaseFormatter

if TYPE_CHECKING:
    from ac_dc.symbol_index.models import FileSymbols, Symbol
    from ac_dc.symbol_index.reference_index import ReferenceIndex


class CompactFormatter(BaseFormatter):
    """Render FileSymbols as the compact code symbol map."""

    def __init__(self, include_line_numbers: bool = False) -> None:
        self._include_line_numbers = include_line_numbers
        # Populated per format_files call so _format_file can
        # look up the FileSymbols for each path. Not thread-safe
        # — a single instance can't render two maps concurrently.
        self._current_by_path: dict[str, "FileSymbols"] = {}

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------
    def format_files(
        self,
        files: Iterable["FileSymbols"],
        ref_index: "ReferenceIndex | None" = None,
        exclude_files: set[str] | None = None,
    ) -> str:
        """Render the map for an iterable of FileSymbols.
        The base class's ``format`` takes path strings, so we
        stash the FileSymbols in a per-call dict keyed by path
        before delegating. ``_format_file`` reads the dict back
        to get the FileSymbols for each path.
        """
        fs_list = list(files)
        self._current_by_path = {fs.file_path: fs for fs in fs_list}
        try:
            return self.format(
                (fs.file_path for fs in fs_list),
                ref_index=ref_index,
                exclude_files=exclude_files,
            )
        finally:
            # Drop references so the dict doesn't pin FileSymbols
            # past the caller's expected lifetime.
            self._current_by_path = {}
    def get_legend(
        self,
        files: Iterable[str] | None = None,
    ) -> str:
        """Return the legend block.
        Overridden for test ergonomics — the base class's
        version requires an iterable of paths. Callers of this
        formatter typically want ``get_legend()`` with no
        argument to probe the legend text.
        """
        return super().get_legend(files)
    # ------------------------------------------------------------------
    # Legend — language-family text, no path aliases
    # ------------------------------------------------------------------
    def _legend(self) -> str:
        """Kind codes and annotation markers.
        The base class appends path aliases; this method
        returns only the per-kind and per-annotation key lines.
        """
        # Legend deliberately avoids the ← and → characters.
        # They appear only in rendered symbol lines (``←N`` as
        # reference counts, ``→name,name`` as outgoing calls).
        # Keeping them out of the legend means tests that look
        # for "the symbol line with →" via next() iteration
        # match the actual symbol line, not a legend line that
        # happens to document the marker.
        # The ``i→`` local-import prefix is also self-documenting
        # — when the LLM sees ``i→ path.py`` in a file block it
        # can infer the meaning from context.
        lines = [
            "# c=class m=method f=function af=async func am=async method",
            "# v=var p=property i=import",
        ]
        if self._include_line_numbers:
            lines.append("# :N=line(s) ->T=returns ?=optional")
        else:
            lines.append("# ->T=returns ?=optional")
        lines.append("# +N=more Nc/Nm=test summary")
        return "\n".join(lines)
    # ------------------------------------------------------------------
    # Per-file block rendering
    # ------------------------------------------------------------------
    def _format_file(
        self,
        path: str,
        aliases: dict[str, str],
        ref_index: "ReferenceIndex | None",
    ) -> str:
        """Render one file's compact block.
        Shape:
        ::
            path: ←N
            i externalmod1,externalmod2
            i→ local1.py,local2.py
            c ClassName(Base) ←N
              v instance_var
              m methodname(params)->ret ←N →call1,call2
            f funcname(params)->ret ←N →call1
            v CONSTANT ←N
        Empty sections are omitted. The caller joins blocks
        with blank lines.
        """
        fs = self._current_by_path.get(path)
        if fs is None:
            # Shouldn't happen — format_files populates the
            # dict with every path. Defensive return keeps us
            # total rather than raising on a caller bug.
            return ""
        aliased_path = self._apply_aliases(path, aliases)
        lines: list[str] = []
        # Header — ``path:`` with optional ``←N``.
        header = f"{aliased_path}:"
        if ref_index is not None:
            count = ref_index.file_ref_count(path)
            if count > 0:
                header = f"{header} ←{count}"
        lines.append(header)
        # Imports — split into external (no resolved_target)
        # and local (resolved_target set).
        self._append_import_lines(fs, lines, aliases)
        # Top-level symbols — children render recursively.
        for sym in fs.symbols:
            self._append_symbol_lines(
                sym,
                lines,
                depth=0,
                ref_index=ref_index,
            )
        return "\n".join(lines)
    def _append_import_lines(
        self,
        fs: "FileSymbols",
        lines: list[str],
        aliases: dict[str, str],
    ) -> None:
        """Emit ``i`` and ``i→`` lines for a file's imports.
        External imports (no ``resolved_target``) group under
        ``i``. Local imports (resolver set a repo-relative
        target) group under ``i→`` with paths passed through
        alias substitution. Dedupes — one entry per distinct
        module or target path.
        """
        external: list[str] = []
        local: list[str] = []
        seen_external: set[str] = set()
        seen_local: set[str] = set()
        for imp in fs.imports:
            resolved = getattr(imp, "resolved_target", None)
            if resolved:
                if resolved in seen_local:
                    continue
                seen_local.add(resolved)
                local.append(self._apply_aliases(resolved, aliases))
            else:
                if imp.module in seen_external:
                    continue
                seen_external.add(imp.module)
                external.append(imp.module)
        if external:
            lines.append(f"i {','.join(external)}")
        if local:
            lines.append(f"i→ {','.join(local)}")
    # ------------------------------------------------------------------
    # Symbol rendering (recursive)
    # ------------------------------------------------------------------
    def _append_symbol_lines(
        self,
        sym: "Symbol",
        lines: list[str],
        depth: int,
        ref_index: "ReferenceIndex | None",
    ) -> None:
        """Render a symbol and its children into ``lines``.
        ``depth`` drives the two-space indent per nesting
        level. Instance vars appear before child symbols —
        matches the "data members first, methods second"
        convention from specs3.
        """
        indent = "  " * depth
        kind_code = self._kind_code(sym)
        name_part = self._render_name_with_signature(sym)
        annotations = self._render_annotations(sym, ref_index)
        if annotations:
            lines.append(f"{indent}{kind_code} {name_part} {annotations}")
        else:
            lines.append(f"{indent}{kind_code} {name_part}")
        # Instance vars first — data before behaviour.
        child_indent = "  " * (depth + 1)
        for ivar in sym.instance_vars:
            lines.append(f"{child_indent}v {ivar}")
        # Then nested child symbols (methods, inner classes).
        for child in sym.children:
            self._append_symbol_lines(
                child,
                lines,
                depth=depth + 1,
                ref_index=ref_index,
            )
    # ------------------------------------------------------------------
    # Per-symbol helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _kind_code(sym: "Symbol") -> str:
        """Return the single-letter prefix for ``sym``'s kind.
        Async functions and methods get the ``af``/``am``
        two-letter prefix — async-ness is a structural property
        the LLM reasons about often enough to deserve its own
        code rather than a trailing annotation.
        Unknown kinds fall back to ``?`` rather than raising —
        better to emit something the LLM can ignore than to
        crash on a future extractor adding a new kind.
        """
        if sym.kind == "function":
            return "af" if sym.is_async else "f"
        if sym.kind == "method":
            return "am" if sym.is_async else "m"
        return {
            "class": "c",
            "variable": "v",
            "property": "p",
            "import": "i",
        }.get(sym.kind, "?")
    def _render_name_with_signature(self, sym: "Symbol") -> str:
        """Render the name + optional signature + optional line number.
        - Classes — ``Name(Base1,Base2)`` or ``Name`` when no
          bases. Empty parens suppressed — the legend already
          documents that a bare ``c Foo`` means no explicit
          bases.
        - Functions/methods/properties — ``name(params)->ret``
          with parens always shown even when empty. Return
          type omitted when absent.
        - Variables — bare ``name`` — no parens, no signature.
        LSP variant appends ``:N`` (1-indexed line number)
        derived from ``sym.range[0]`` (which is 0-indexed
        tree-sitter convention). Appended BEFORE the signature
        so the test's ``c Foo:5`` expectation holds.
        """
        if sym.kind == "class":
            rendered = sym.name
            if self._include_line_numbers:
                rendered = f"{rendered}:{sym.range[0] + 1}"
            if sym.bases:
                rendered = f"{rendered}({','.join(sym.bases)})"
            return rendered
        if sym.kind in ("function", "method", "property"):
            rendered = sym.name
            if self._include_line_numbers:
                rendered = f"{rendered}:{sym.range[0] + 1}"
            params = self._render_parameters(sym.parameters)
            rendered = f"{rendered}({params})"
            if sym.return_type:
                rendered = f"{rendered}->{sym.return_type}"
            return rendered
        # Variable, import, or unknown — bare name.
        rendered = sym.name
        if self._include_line_numbers:
            rendered = f"{rendered}:{sym.range[0] + 1}"
        return rendered
    @staticmethod
    def _render_parameters(params: list) -> str:
        """Render a parameter list as a comma-joined string.
        Each parameter renders as ``name``, ``name?`` (has a
        default), ``*name`` (vararg), or ``**name`` (kwarg).
        Type annotations are not currently surfaced — specs3
        didn't include them in the compact format, and the
        token budget is tighter than the LLM's ability to
        trace the type when it loads the full file.
        """
        parts: list[str] = []
        for p in params:
            if p.is_vararg:
                parts.append(f"*{p.name}")
            elif p.is_kwarg:
                parts.append(f"**{p.name}")
            elif p.default is not None:
                parts.append(f"{p.name}?")
            else:
                parts.append(p.name)
        return ",".join(parts)
    def _render_annotations(
        self,
        sym: "Symbol",
        ref_index: "ReferenceIndex | None",
    ) -> str:
        """Render trailing ``←N`` and ``→names`` annotations.
        Returns an empty string when the symbol has no
        reference count and no call sites — caller avoids
        appending a lone trailing space.
        ``←N`` comes from the reference index's count for this
        symbol's name; zero is suppressed (absence means zero).
        ``→names`` is a comma-joined, deduped list of call-site
        targets preserving first-seen order (a set would lose
        order across Python runs thanks to hash randomization).
        """
        parts: list[str] = []
        if ref_index is not None:
            locations = ref_index.references_to_symbol(sym.name)
            if locations:
                parts.append(f"←{len(locations)}")
        if sym.call_sites:
            seen: set[str] = set()
            targets: list[str] = []
            for site in sym.call_sites:
                name = site.target_symbol or site.name
                if name in seen:
                    continue
                seen.add(name)
                targets.append(name)
            parts.append(f"→{','.join(targets)}")

        return " ".join(parts)