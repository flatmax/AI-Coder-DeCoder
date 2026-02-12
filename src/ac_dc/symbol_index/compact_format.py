"""Compact symbol map formatter for LLM context."""

import os
import re
from collections import Counter


LEGEND = """# c=class m=method f=function af=async func am=async method
# v=var p=property i=import i→=local
# :N=line(s) ->T=returns ?=optional ←N=refs →=calls
# +N=more ″=ditto Nc/Nm=test summary"""


class CompactFormatter:
    """Format symbols into LLM-optimized compact text."""

    def __init__(self, reference_index=None):
        self._ref_index = reference_index
        self._path_aliases = {}

    def format_all(self, all_file_symbols, exclude_files=None, chunks=1):
        """Format all file symbols into compact text.

        Args:
            all_file_symbols: dict of {path: FileSymbols}
            exclude_files: set of paths to exclude
            chunks: number of chunks to split into

        Returns:
            str or list[str] if chunks > 1
        """
        exclude = set(exclude_files or [])
        paths = sorted(p for p in all_file_symbols if p not in exclude)

        # Compute path aliases
        self._path_aliases = self._compute_aliases(paths)

        # Format each file
        blocks = []
        test_blocks = []
        for path in paths:
            fs = all_file_symbols[path]
            if self._is_test_file(path):
                test_blocks.append(self._format_test_file(path, fs))
            else:
                blocks.append(self._format_file(path, fs))

        all_blocks = blocks + test_blocks

        if chunks <= 1:
            legend = self._format_legend()
            return legend + "\n\n" + "\n\n".join(all_blocks)

        # Split into chunks
        chunk_size = max(1, len(all_blocks) // chunks)
        result = []
        for i in range(0, len(all_blocks), chunk_size):
            chunk_blocks = all_blocks[i:i + chunk_size]
            if i == 0:
                result.append(self._format_legend() + "\n\n" + "\n\n".join(chunk_blocks))
            else:
                result.append("\n\n".join(chunk_blocks))
        return result

    def format_file(self, path, file_symbols):
        """Format a single file's symbols."""
        return self._format_file(path, file_symbols)

    def _format_legend(self):
        """Format the legend with path aliases."""
        legend = LEGEND
        for alias, prefix in sorted(self._path_aliases.items()):
            legend += f"\n# {alias}={prefix}"
        return legend

    def get_legend(self):
        """Get just the legend text."""
        return self._format_legend()

    def _compute_aliases(self, paths):
        """Compute path aliases for frequent prefixes."""
        if not paths:
            return {}

        # Count directory prefixes
        prefix_count = Counter()
        for p in paths:
            parts = p.split("/")
            for i in range(1, len(parts)):
                prefix = "/".join(parts[:i]) + "/"
                prefix_count[prefix] += 1

        # Select prefixes that appear 3+ times and save significant chars
        aliases = {}
        alias_num = 1
        for prefix, count in prefix_count.most_common(5):
            if count >= 3 and len(prefix) > 5:
                aliases[f"@{alias_num}/"] = prefix
                alias_num += 1

        return aliases

    def _alias_path(self, path):
        """Replace path prefix with alias if available."""
        for alias, prefix in self._path_aliases.items():
            if path.startswith(prefix):
                return alias + path[len(prefix):]
        return path

    def _format_file(self, path, fs):
        """Format a single file block."""
        lines = []

        # File header with ref count
        ref_count = self._ref_index.file_ref_count(path) if self._ref_index else 0
        header = self._alias_path(path) + ":"
        if ref_count > 0:
            header += f" ←{ref_count}"
        lines.append(header)

        # Imports
        ext_imports = []
        local_imports = []
        for imp in fs.imports:
            if imp.level > 0 or (imp.module and "/" in imp.module):
                local_imports.append(imp.module or ",".join(imp.names))
            elif imp.module and not imp.module.startswith("."):
                ext_imports.append(imp.module)

        if ext_imports:
            lines.append("i " + ",".join(ext_imports))
        if local_imports:
            lines.append("i→ " + ",".join(local_imports))

        # Symbols
        prev_refs = None
        for sym in fs.symbols:
            sym_lines, prev_refs = self._format_symbol(sym, indent=0, prev_refs=prev_refs, path=path)
            lines.extend(sym_lines)

        return "\n".join(lines)

    def _format_symbol(self, sym, indent=0, prev_refs=None, path=""):
        """Format a single symbol with children."""
        lines = []
        prefix = "  " * indent

        # Kind abbreviation
        kind_map = {
            "class": "c",
            "function": "f",
            "method": "m",
            "variable": "v",
            "property": "p",
        }
        kind = kind_map.get(sym.kind, sym.kind)
        if sym.is_async:
            if kind == "f":
                kind = "af"
            elif kind == "m":
                kind = "am"

        # Build the line
        parts = [prefix + kind + " " + sym.name]

        # Parameters (for functions/methods)
        if sym.parameters and sym.kind in ("function", "method", "property"):
            param_strs = []
            for p in sym.parameters:
                s = p.name
                if p.default:
                    s += "?"
                param_strs.append(s)
            parts[0] += "(" + ",".join(param_strs) + ")"

        # Bases (for classes)
        if sym.bases:
            parts[0] += "(" + ",".join(sym.bases) + ")"

        # Return type
        if sym.return_type:
            parts[0] += f"->{sym.return_type}"

        # Line number
        parts[0] += f":{sym.start_line}"

        # Instance vars
        if sym.instance_vars:
            for iv in sym.instance_vars:
                lines.append(parts[0])
                parts[0] = prefix + "  v " + iv

        # References
        refs_str = self._format_refs(sym.name, path)
        if refs_str:
            if refs_str == prev_refs:
                parts[0] += " ″"
            else:
                parts[0] += " " + refs_str
                prev_refs = refs_str

        # Calls
        if sym.call_sites:
            call_names = list(dict.fromkeys(c.name for c in sym.call_sites[:5]))
            if call_names:
                parts[0] += " →" + ",".join(call_names)

        lines.append(parts[0])

        # Children
        for child in sym.children:
            child_lines, prev_refs = self._format_symbol(
                child, indent=indent + 1, prev_refs=prev_refs, path=path)
            lines.extend(child_lines)

        return lines, prev_refs

    def _format_refs(self, symbol_name, source_path):
        """Format reference annotations for a symbol."""
        if not self._ref_index:
            return ""
        refs = self._ref_index.references_to_symbol(symbol_name)
        if not refs:
            return ""

        # Group by file
        by_file = {}
        for ref in refs:
            if ref["file"] != source_path:
                f = self._alias_path(ref["file"])
                if f not in by_file:
                    by_file[f] = []
                by_file[f].append(ref["line"])

        if not by_file:
            return ""

        if len(by_file) <= 3:
            parts = []
            for f, lines_list in list(by_file.items())[:3]:
                parts.append(f"←{f}:{lines_list[0]}")
            remaining = len(by_file) - 3
            result = ",".join(parts)
            if remaining > 0:
                result += f",+{remaining}"
            return result
        else:
            return f"←{len(by_file)}"

    def _is_test_file(self, path):
        """Check if a path is a test file."""
        basename = os.path.basename(path)
        return (basename.startswith("test_") or
                basename.endswith("_test.py") or
                basename.endswith(".test.js") or
                basename.endswith(".test.ts") or
                basename.endswith(".spec.js") or
                basename.endswith(".spec.ts") or
                "/test/" in path or
                "/tests/" in path)

    def _format_test_file(self, path, fs):
        """Format test file as collapsed summary."""
        classes = sum(1 for s in fs.symbols if s.kind == "class")
        methods = sum(1 for s in fs.all_symbols_flat
                     if s.kind in ("method", "function"))

        # Collect fixture names
        fixtures = []
        for sym in fs.all_symbols_flat:
            if sym.name and ("fixture" in sym.name.lower() or
                            "setup" in sym.name.lower() or
                            "teardown" in sym.name.lower()):
                fixtures.append(sym.name)

        header = self._alias_path(path) + ":"
        summary = f"# {classes}c/{methods}m"
        if fixtures:
            summary += " fixtures:" + ",".join(fixtures[:3])

        return header + "\n" + summary

    def signature_hash(self, file_symbols):
        """Compute a stable hash of file's symbol signatures."""
        import hashlib
        parts = []
        for sym in file_symbols.symbols:
            parts.append(sym.signature_hash_content())
        for imp in file_symbols.imports:
            parts.append(f"import:{imp.module}")
        content = "\n".join(parts)
        return hashlib.sha256(content.encode()).hexdigest()[:16]
