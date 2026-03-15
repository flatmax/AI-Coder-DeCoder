"""Compact formatter for symbol map output — extends BaseFormatter."""

import re
from typing import Optional

from ac_dc.base_formatter import BaseFormatter
from ac_dc.symbol_index.models import FileSymbols, Symbol, Import
from ac_dc.symbol_index.reference_index import ReferenceIndex


# Test file patterns
_TEST_PATTERNS = (
    re.compile(r'test[_/]'),
    re.compile(r'[_/]test\.'),
    re.compile(r'tests?/'),
    re.compile(r'_test\.py$'),
    re.compile(r'\.test\.[jt]sx?$'),
    re.compile(r'\.spec\.[jt]sx?$'),
)


def _is_test_file(path: str) -> bool:
    lower = path.lower()
    return any(p.search(lower) for p in _TEST_PATTERNS)


class CompactFormatter(BaseFormatter):
    """Format FileSymbols into compact text for LLM context.

    Two modes:
    - Context mode (include_lines=False): no line numbers, for LLM prompt
    - LSP mode (include_lines=True): with line numbers, for editor features
    """

    def __init__(self, include_lines: bool = False):
        super().__init__()
        self._include_lines = include_lines

    def get_legend(self) -> str:
        """Return the legend text."""
        lines = []
        lines.append("# c=class m=method f=function af=async func am=async method")
        lines.append("# v=var p=property i=import i→=local")
        if self._include_lines:
            lines.append("# :N=line(s) ->T=returns ?=optional ←N=refs →=calls")
        else:
            lines.append("# ->T=returns ?=optional ←N=refs →=calls")
        lines.append("# +N=more ″=ditto Nc/Nm=test summary")
        alias_legend = self.format_alias_legend()
        if alias_legend:
            lines.append(alias_legend)
        return "\n".join(lines)

    def format_file(self, path: str, data: object,
                    ref_index: Optional[ReferenceIndex] = None,
                    exclude_files: Optional[set[str]] = None) -> str:
        """Format a single file's symbols into compact text."""
        if not isinstance(data, FileSymbols):
            return ""

        fs: FileSymbols = data
        lines = []

        # File header with ref count
        display_path = self.alias_path(path)
        ref_count = ref_index.file_ref_count(path) if ref_index else 0
        header = f"{display_path}:"
        if ref_count > 0:
            header += f" ←{ref_count}"
        lines.append(header)

        # Imports
        ext_imports, local_imports = self._split_imports(fs.imports, exclude_files)
        if ext_imports:
            lines.append(f"i {','.join(ext_imports)}")
        if local_imports:
            lines.append(f"i→ {','.join(local_imports)}")

        # Symbols
        for sym in fs.symbols:
            self._format_symbol(sym, lines, ref_index, indent=0)

        return "\n".join(lines)

    def format_file_collapsed(self, path: str, data: object) -> str:
        """Format a test file as a collapsed summary."""
        if not isinstance(data, FileSymbols):
            return ""
        fs: FileSymbols = data
        all_syms = fs.all_symbols_flat
        class_count = sum(1 for s in all_syms if s.kind == "class")
        method_count = sum(1 for s in all_syms if s.kind in ("method", "function"))

        # Find fixture names (top-level functions with "fixture" hints)
        fixtures = []
        for sym in fs.symbols:
            if sym.kind == "function" and sym.name.startswith(("setup", "teardown", "fixture")):
                fixtures.append(sym.name)
        for sym in fs.symbols:
            if sym.kind == "function" and not sym.name.startswith("test"):
                if sym.name not in fixtures:
                    fixtures.append(sym.name)

        display_path = self.alias_path(path)
        parts = [f"{display_path}:"]
        summary = f"# {class_count}c/{method_count}m"
        if fixtures:
            summary += f" fixtures:{','.join(fixtures[:3])}"
        parts.append(summary)
        return "\n".join(parts)

    def format_map(
        self,
        all_symbols: dict[str, FileSymbols],
        ref_index: Optional[ReferenceIndex] = None,
        exclude_files: Optional[set[str]] = None,
    ) -> str:
        """Format the complete symbol map."""
        exclude_files = exclude_files or set()

        # Compute path aliases from non-excluded files
        paths = [p for p in all_symbols if p not in exclude_files]
        self.compute_path_aliases(paths)

        parts = []
        for path in sorted(all_symbols.keys()):
            if path in exclude_files:
                continue
            fs = all_symbols[path]
            if _is_test_file(path):
                text = self.format_file_collapsed(path, fs)
            else:
                text = self.format_file(path, fs, ref_index, exclude_files)
            if text:
                parts.append(text)

        return "\n\n".join(parts)

    def format_chunks(
        self,
        all_symbols: dict[str, FileSymbols],
        ref_index: Optional[ReferenceIndex] = None,
        exclude_files: Optional[set[str]] = None,
        num_chunks: int = 4,
    ) -> list[str]:
        """Split the symbol map into roughly equal chunks."""
        exclude_files = exclude_files or set()
        paths = sorted(p for p in all_symbols if p not in exclude_files)
        self.compute_path_aliases(paths)

        blocks = []
        for path in paths:
            fs = all_symbols[path]
            if _is_test_file(path):
                text = self.format_file_collapsed(path, fs)
            else:
                text = self.format_file(path, fs, ref_index, exclude_files)
            if text:
                blocks.append(text)

        if not blocks:
            return []

        # Distribute blocks across chunks roughly evenly
        chunk_size = max(1, len(blocks) // num_chunks)
        chunks = []
        for i in range(0, len(blocks), chunk_size):
            chunk_blocks = blocks[i:i + chunk_size]
            chunks.append("\n\n".join(chunk_blocks))

        return chunks

    # ── Private Helpers ───────────────────────────────────────────

    def _format_symbol(self, sym: Symbol, lines: list[str],
                       ref_index: Optional[ReferenceIndex],
                       indent: int):
        """Format a single symbol and its children."""
        prefix = "  " * indent
        kind_prefix = self._kind_prefix(sym)
        name_str = sym.name

        # Parameters
        if sym.parameters:
            param_strs = []
            for p in sym.parameters:
                ps = p.name
                if p.is_variadic:
                    ps = "*" + ps
                if p.is_keyword:
                    ps = "**" + ps
                if p.default is not None:
                    ps += "?"
                param_strs.append(ps)
            name_str += f"({','.join(param_strs)})"

        # Return type
        if sym.return_type:
            optional = sym.return_type.startswith("Optional") or sym.return_type.endswith("| None")
            if optional:
                name_str += f"->?{sym.return_type}"
            else:
                name_str += f"->{sym.return_type}"

        # Bases
        if sym.bases and sym.kind == "class":
            name_str += f"({','.join(sym.bases)})"

        # Line number (LSP mode only)
        line_str = ""
        if self._include_lines and sym.range.get("start_line"):
            line_str = f":{sym.range['start_line']}"

        # Reference count
        ref_str = ""
        if ref_index:
            refs = ref_index.references_to_symbol(sym.name)
            if refs:
                ref_str = f" ←{len(refs)}"

        # Call sites
        call_str = ""
        if sym.call_sites:
            call_names = [c.name for c in sym.call_sites[:5]]
            call_str = f" →{','.join(call_names)}"

        line = f"{prefix}{kind_prefix} {name_str}{line_str}{ref_str}{call_str}"
        lines.append(line)

        # Instance variables
        for var_name in sym.instance_vars:
            lines.append(f"{prefix}  v {var_name}")

        # Children
        for child in sym.children:
            self._format_symbol(child, lines, ref_index, indent + 1)

    def _kind_prefix(self, sym: Symbol) -> str:
        """Get the compact kind prefix."""
        if sym.is_async:
            if sym.kind == "function":
                return "af"
            if sym.kind == "method":
                return "am"
        kind_map = {
            "class": "c",
            "function": "f",
            "method": "m",
            "variable": "v",
            "property": "p",
            "import": "i",
        }
        return kind_map.get(sym.kind, sym.kind)

    def _split_imports(self, imports: list[Import],
                       exclude_files: Optional[set[str]] = None) -> tuple[list[str], list[str]]:
        """Split imports into external and local."""
        external = []
        local = []
        for imp in imports:
            if imp.level > 0:
                # Relative imports are always local
                mod = imp.module or "."
                display = self.alias_path(mod)
                local.append(display)
            else:
                # Check if module resolves to a repo file
                # For now, treat all absolute as external (resolver needed for accuracy)
                module_parts = imp.module.split(".")
                external.append(module_parts[0])

        return sorted(set(external)), sorted(set(local))