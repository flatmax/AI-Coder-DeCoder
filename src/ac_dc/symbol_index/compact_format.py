"""Compact format output for LLM context — the 'repository map'."""

import logging
from collections import Counter, defaultdict
from pathlib import PurePosixPath
from typing import Optional

from .models import (
    Symbol, SymbolKind, FileSymbols, Parameter,
)
from .reference_index import ReferenceIndex

log = logging.getLogger(__name__)

# Compact kind prefixes
KIND_PREFIX = {
    SymbolKind.CLASS: "c",
    SymbolKind.FUNCTION: "f",
    SymbolKind.METHOD: "m",
    SymbolKind.VARIABLE: "v",
    SymbolKind.IMPORT: "i",
    SymbolKind.PROPERTY: "p",
}

# Test file detection
TEST_PATTERNS = {
    "test_", "_test.", "tests/", "test/", "spec/", "specs/",
    ".test.", ".spec.",
}


def _is_test_file(path: str) -> bool:
    """Heuristic: is this a test file?"""
    lower = path.lower()
    return any(p in lower for p in TEST_PATTERNS)


class CompactFormatter:
    """Generate compact symbol map text for LLM context."""

    def __init__(self, ref_index: Optional[ReferenceIndex] = None):
        self._ref_index = ref_index
        self._aliases: dict[str, str] = {}  # full prefix -> @N/
        self._exclude_files: set[str] = set()

    def format_all(
        self,
        all_symbols: dict[str, FileSymbols],
        exclude_files: set[str] | None = None,
    ) -> str:
        """Format all files into a complete symbol map.

        Args:
            all_symbols: dict of file_path -> FileSymbols
            exclude_files: files to exclude (e.g. files in active context)
        """
        exclude = exclude_files or set()
        files = {k: v for k, v in all_symbols.items() if k not in exclude}

        if not files:
            return ""

        # Store exclude set for annotation filtering
        self._exclude_files = exclude

        # Compute path aliases
        self._aliases = self._compute_aliases(files)

        # Build legend
        parts = [self._format_legend()]

        # Sort files: by reference count descending, then alphabetically
        sorted_files = sorted(
            files.keys(),
            key=lambda f: (-self._file_ref_count(f), f),
        )

        prev_refs: Optional[list[str]] = None
        for fpath in sorted_files:
            fsyms = files[fpath]
            block, prev_refs = self._format_file(
                fpath, fsyms, prev_refs,
            )
            if block:
                parts.append(block)

        return "\n".join(parts)

    def format_file_block(
        self, file_path: str, fsyms: FileSymbols
    ) -> str:
        """Format a single file's symbol block."""
        block, _ = self._format_file(file_path, fsyms, None)
        return block or ""

    def format_legend(self) -> str:
        """Return just the legend text."""
        return self._format_legend()

    def get_chunks(
        self,
        all_symbols: dict[str, FileSymbols],
        exclude_files: set[str] | None = None,
        num_chunks: int = 3,
    ) -> list[dict]:
        """Split the symbol map into chunks for cache tier distribution.

        Returns list of {content, files, token_estimate}.
        """
        exclude = exclude_files or set()
        files = {k: v for k, v in all_symbols.items() if k not in exclude}

        if not files:
            return []

        self._aliases = self._compute_aliases(files)

        sorted_files = sorted(
            files.keys(),
            key=lambda f: (-self._file_ref_count(f), f),
        )

        # Build per-file blocks
        file_blocks: list[tuple[str, str, int]] = []  # (path, content, token_est)
        prev_refs = None
        for fpath in sorted_files:
            block, prev_refs = self._format_file(fpath, files[fpath], prev_refs)
            if block:
                token_est = max(1, len(block) // 4)
                file_blocks.append((fpath, block, token_est))

        if not file_blocks:
            return []

        # Distribute into chunks (round-robin by token count)
        chunks: list[dict] = [
            {"content": "", "files": [], "token_estimate": 0}
            for _ in range(min(num_chunks, len(file_blocks)))
        ]

        for fpath, block, tokens in file_blocks:
            # Add to chunk with fewest tokens
            target = min(range(len(chunks)), key=lambda i: chunks[i]["token_estimate"])
            if chunks[target]["content"]:
                chunks[target]["content"] += "\n"
            chunks[target]["content"] += block
            chunks[target]["files"].append(fpath)
            chunks[target]["token_estimate"] += tokens

        return [c for c in chunks if c["content"]]

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _format_legend(self) -> str:
        lines = [
            "# c=class m=method f=function af=async func am=async method "
            "v=var p=property i=import i→=local",
            "# :N=line(s) ->T=returns ?=optional ←N=refs →=calls "
            "+N=more ″=ditto Nc/Nm=test summary",
        ]

        if self._aliases:
            alias_parts = []
            for prefix, alias in sorted(self._aliases.items(), key=lambda x: x[1]):
                alias_parts.append(f"{alias}={prefix}")
            lines.append(f"# {' '.join(alias_parts)}")

        return "\n".join(lines)

    def _compute_aliases(self, files: dict[str, FileSymbols]) -> dict[str, str]:
        """Compute @N/ aliases for frequent directory prefixes."""
        dir_counts: Counter = Counter()

        for fpath in files:
            parts = PurePosixPath(fpath).parts
            for i in range(1, len(parts)):
                prefix = "/".join(parts[:i]) + "/"
                dir_counts[prefix] += 1

        # Take top prefixes that appear 3+ times and save tokens
        aliases = {}
        idx = 1
        for prefix, count in dir_counts.most_common(10):
            if count < 3:
                break
            if len(prefix) < 6:
                continue  # Not worth aliasing short prefixes
            aliases[prefix] = f"@{idx}/"
            idx += 1
            if idx > 9:
                break

        return aliases

    def _alias_path(self, path: str) -> str:
        """Apply aliases to a path."""
        for prefix, alias in self._aliases.items():
            if path.startswith(prefix):
                return alias + path[len(prefix):]
        return path

    def _file_ref_count(self, file_path: str) -> int:
        """Get ref count for sorting."""
        if self._ref_index:
            return self._ref_index.file_ref_count(file_path)
        return 0

    def _format_file(
        self,
        file_path: str,
        fsyms: FileSymbols,
        prev_refs: Optional[list[str]],
    ) -> tuple[str, Optional[list[str]]]:
        """Format a single file block.

        Returns (formatted_text, current_refs_for_ditto).
        """
        aliased = self._alias_path(file_path)
        ref_count = self._file_ref_count(file_path)

        # Test file collapsing
        if _is_test_file(file_path):
            return self._format_test_file(aliased, fsyms, ref_count), prev_refs

        lines = []

        # File header
        header = f"\n{aliased}:"
        if ref_count > 0:
            header += f" ←{ref_count}"
        lines.append(header)

        # Imports
        import_line = self._format_imports(fsyms, file_path)
        if import_line:
            lines.append(import_line)

        # Symbols
        current_refs = prev_refs
        for sym in fsyms.symbols:
            sym_lines, current_refs = self._format_symbol(
                sym, file_path, indent=0, prev_refs=current_refs,
            )
            lines.extend(sym_lines)

        return "\n".join(lines), current_refs

    def _format_test_file(
        self, aliased_path: str, fsyms: FileSymbols, ref_count: int
    ) -> str:
        """Collapsed test file format."""
        all_syms = fsyms.all_symbols_flat
        class_count = sum(1 for s in all_syms if s.kind == SymbolKind.CLASS)
        method_count = sum(
            1 for s in all_syms
            if s.kind in (SymbolKind.METHOD, SymbolKind.FUNCTION)
        )

        # Find fixtures (functions with common test fixture names)
        fixture_names = []
        for sym in all_syms:
            if sym.kind == SymbolKind.FUNCTION and not sym.name.startswith("test"):
                fixture_names.append(sym.name)

        header = f"\n{aliased_path}:"
        if ref_count > 0:
            header += f" ←{ref_count}"

        # Imports
        import_line = self._format_imports(fsyms, aliased_path)

        summary_parts = []
        if class_count:
            summary_parts.append(f"{class_count}c")
        if method_count:
            summary_parts.append(f"/{method_count}m" if summary_parts else f"{method_count}m")

        summary = " ".join(summary_parts) if summary_parts else ""
        fixtures = f" fixtures:{','.join(fixture_names)}" if fixture_names else ""

        result = header
        if import_line:
            result += f"\n{import_line}"
        result += f"\n# {''.join(summary_parts)}{fixtures}"

        return result

    def _format_imports(self, fsyms: FileSymbols, file_path: str) -> str:
        """Format import lines."""
        stdlib_imports = []
        local_imports = []

        for imp in fsyms.imports:
            if imp.level > 0 or imp.module.startswith("."):
                # Relative/local
                local_imports.append(imp.module)
            elif "/" in imp.module or imp.module.startswith("."):
                local_imports.append(imp.module)
            else:
                # Stdlib/external
                stdlib_imports.append(imp.module)

        lines = []
        if stdlib_imports:
            lines.append(f"i {','.join(stdlib_imports)}")
        if local_imports:
            aliased = [self._alias_path(p) for p in local_imports]
            lines.append(f"i→ {','.join(aliased)}")

        return "\n".join(lines)

    def _format_symbol(
        self,
        sym: Symbol,
        file_path: str,
        indent: int,
        prev_refs: Optional[list[str]],
    ) -> tuple[list[str], Optional[list[str]]]:
        """Format a symbol and its children.

        Returns (lines, current_refs_for_ditto).
        """
        prefix = "  " * indent
        lines = []

        # Kind prefix
        if sym.is_async and sym.kind == SymbolKind.FUNCTION:
            kind_str = "af"
        elif sym.is_async and sym.kind == SymbolKind.METHOD:
            kind_str = "am"
        else:
            kind_str = KIND_PREFIX.get(sym.kind, "?")

        # Name with bases
        name = sym.name
        if sym.bases:
            name += f"({','.join(sym.bases)})"

        # Parameters
        if sym.kind in (SymbolKind.FUNCTION, SymbolKind.METHOD) or (
            sym.kind == SymbolKind.PROPERTY and sym.parameters
        ):
            param_str = ",".join(self._format_param(p) for p in sym.parameters)
            name += f"({param_str})"

        # Return type
        if sym.return_type:
            opt = "?" if sym.is_optional_return else ""
            name += f"->{opt}{sym.return_type}"

        # Line number
        line_str = f":{sym.range.start_line}"

        # Annotations
        annotations = self._format_annotations(sym, file_path, prev_refs)
        ann_str = f" {annotations}" if annotations else ""

        lines.append(f"{prefix}{kind_str} {name}{line_str}{ann_str}")

        # Instance vars for classes
        if sym.kind == SymbolKind.CLASS:
            for ivar in sym.instance_vars:
                lines.append(f"{prefix}  v {ivar}")

        # Children
        current_refs = prev_refs
        for child in sym.children:
            child_lines, current_refs = self._format_symbol(
                child, file_path, indent + 1, current_refs,
            )
            lines.extend(child_lines)

        # Update prev_refs with current symbol's refs
        if self._ref_index:
            refs, _ = self._ref_index.reference_annotations(sym.name, file_path)
            if refs:
                current_refs = refs

        return lines, current_refs

    def _format_param(self, p: Parameter) -> str:
        """Format a single parameter."""
        s = p.name
        if p.is_variadic:
            s = f"*{s}"
        elif p.is_keyword:
            s = f"**{s}"
        elif p.default is not None:
            s += "?"
        return s

    def _format_annotations(
        self, sym: Symbol, file_path: str, prev_refs: Optional[list[str]]
    ) -> str:
        """Format ←refs and →calls annotations."""
        parts = []
        exclude = getattr(self, '_exclude_files', set())

        # Incoming references
        if self._ref_index:
            refs, remaining = self._ref_index.reference_annotations(
                sym.name, file_path,
            )
            if refs:
                # Filter out references from excluded files
                filtered = [r for r in refs if not any(
                    r.startswith(ex) or r.split(":")[0] == ex for ex in exclude
                )]
                extra_filtered = len(refs) - len(filtered)
                remaining += extra_filtered

                if filtered:
                    # Check for ditto
                    if prev_refs and filtered == prev_refs:
                        parts.append("←″")
                    else:
                        ref_strs = [self._alias_path(r) for r in filtered]
                        parts.append(f"←{','.join(ref_strs)}")
                        if remaining > 0:
                            parts.append(f"+{remaining}")

        # Outgoing calls
        if sym.call_sites:
            call_names = []
            seen = set()
            for cs in sym.call_sites:
                short = cs.name.split(".")[-1]
                if short not in seen and short not in (sym.name,):
                    seen.add(short)
                    target = short
                    if cs.target_file:
                        target = f"{self._alias_path(cs.target_file)}:{short}"
                    call_names.append(target)
                    if len(call_names) >= 4:
                        break
            if call_names:
                parts.append(f"→{','.join(call_names)}")

        return " ".join(parts)
