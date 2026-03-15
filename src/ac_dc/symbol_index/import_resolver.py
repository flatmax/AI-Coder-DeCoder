"""Import resolution — maps import statements to repo file paths."""

import logging
from pathlib import Path, PurePosixPath
from typing import Optional

from ac_dc.symbol_index.models import Import
from ac_dc.repo import EXCLUDED_DIRS

logger = logging.getLogger(__name__)


class ImportResolver:
    """Resolve import statements to file paths within a repository."""

    def __init__(self, repo_root: str | Path, file_set: set[str]):
        """
        Args:
            repo_root: Absolute path to the repository root.
            file_set: Set of relative file paths in the repo.
        """
        self._root = Path(repo_root).resolve()
        self._files = file_set
        self._cache: dict[tuple, Optional[str]] = {}

    def update_files(self, file_set: set[str]):
        """Update the known file set (clears resolution cache)."""
        self._files = file_set
        self._cache.clear()

    def resolve(self, imp: Import, source_file: str) -> Optional[str]:
        """Resolve an import to a repo-relative file path.

        Returns None if the import targets an external package.
        """
        cache_key = (imp.module, imp.level, source_file)
        if cache_key in self._cache:
            return self._cache[cache_key]

        result = self._do_resolve(imp, source_file)
        self._cache[cache_key] = result
        return result

    def _do_resolve(self, imp: Import, source_file: str) -> Optional[str]:
        """Internal resolution logic."""
        source_path = PurePosixPath(source_file)

        if imp.level > 0:
            # Relative import (Python)
            return self._resolve_python_relative(imp, source_path)

        module = imp.module
        if not module:
            return None

        # Check if it looks like a local path (JS/TS relative imports)
        if module.startswith("./") or module.startswith("../"):
            return self._resolve_js_relative(module, source_path)

        # C #include
        if "/" in module or module.endswith((".h", ".hpp", ".hxx")):
            return self._resolve_c_include(module)

        # Python absolute import
        return self._resolve_python_absolute(module)

    def _resolve_python_relative(self, imp: Import, source: PurePosixPath) -> Optional[str]:
        """Resolve Python relative import."""
        # Go up `level` directories from the source file's directory
        base = source.parent
        for _ in range(imp.level - 1):
            base = base.parent

        if imp.module:
            parts = imp.module.split(".")
            candidate = base / "/".join(parts)
        else:
            candidate = base

        # Try as file
        for ext in (".py",):
            path = str(candidate) + ext
            if path in self._files:
                return path

        # Try as package
        init = str(candidate / "__init__.py")
        if init in self._files:
            return init

        return None

    def _resolve_python_absolute(self, module: str) -> Optional[str]:
        """Resolve Python absolute import."""
        parts = module.split(".")
        candidate = "/".join(parts)

        # Try as file
        path = candidate + ".py"
        if path in self._files:
            return path

        # Try as package
        init = candidate + "/__init__.py"
        if init in self._files:
            return init

        return None

    def _resolve_js_relative(self, module: str, source: PurePosixPath) -> Optional[str]:
        """Resolve JS/TS relative import."""
        base = source.parent
        target = (base / module).as_posix()
        # Normalize
        target = str(PurePosixPath(target))

        # Try direct
        if target in self._files:
            return target

        # Try with extensions
        for ext in (".js", ".ts", ".jsx", ".tsx", ".mjs"):
            candidate = target + ext
            if candidate in self._files:
                return candidate

        # Try as directory index
        for ext in (".js", ".ts", ".jsx", ".tsx"):
            candidate = target + "/index" + ext
            if candidate in self._files:
                return candidate

        return None

    def _resolve_c_include(self, header: str) -> Optional[str]:
        """Resolve C/C++ #include to a repo path."""
        if header in self._files:
            return header

        # Search for it anywhere in the repo
        basename = PurePosixPath(header).name
        for f in self._files:
            if f.endswith("/" + basename) or f == basename:
                # Skip excluded dirs
                parts = f.split("/")
                if any(p in EXCLUDED_DIRS for p in parts[:-1]):
                    continue
                return f

        return None