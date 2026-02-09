"""Import resolution — maps import statements to repo file paths."""

import logging
from pathlib import Path, PurePosixPath
from typing import Optional

log = logging.getLogger(__name__)


class ImportResolver:
    """Resolve import statements to repository file paths."""

    def __init__(self, repo_root: Path, all_files: set[str]):
        self.repo_root = repo_root
        self._files = all_files  # Set of repo-relative paths
        self._module_cache: dict[str, Optional[str]] = {}

    def update_files(self, all_files: set[str]):
        """Update the known file set and clear caches."""
        self._files = all_files
        self._module_cache.clear()

    def resolve_python_import(
        self, module: str, level: int, from_file: str
    ) -> Optional[str]:
        """Resolve a Python import to a repo-relative file path.

        Args:
            module: The module path (e.g. 'foo.bar')
            level: 0 for absolute, 1+ for relative
            from_file: The file containing the import
        """
        cache_key = f"py:{module}:{level}:{from_file}"
        if cache_key in self._module_cache:
            return self._module_cache[cache_key]

        result = self._resolve_python(module, level, from_file)
        self._module_cache[cache_key] = result
        return result

    def _resolve_python(
        self, module: str, level: int, from_file: str
    ) -> Optional[str]:
        if level > 0:
            # Relative import
            from_dir = PurePosixPath(from_file).parent
            # Go up (level - 1) directories
            for _ in range(level - 1):
                from_dir = from_dir.parent

            if module:
                parts = module.split(".")
                candidate = str(from_dir / "/".join(parts))
            else:
                candidate = str(from_dir)
        else:
            # Absolute import
            if not module:
                return None
            parts = module.split(".")
            candidate = "/".join(parts)

        # Try as file
        for ext in (".py",):
            path = candidate + ext
            if path in self._files:
                return path

        # Try as package
        init = candidate + "/__init__.py"
        if init in self._files:
            return init

        return None

    def resolve_js_import(
        self, module: str, from_file: str
    ) -> Optional[str]:
        """Resolve a JS/TS import to a repo-relative file path.

        Args:
            module: The module specifier (e.g. './utils/rpc')
            from_file: The file containing the import
        """
        cache_key = f"js:{module}:{from_file}"
        if cache_key in self._module_cache:
            return self._module_cache[cache_key]

        result = self._resolve_js(module, from_file)
        self._module_cache[cache_key] = result
        return result

    def _resolve_js(self, module: str, from_file: str) -> Optional[str]:
        if not module.startswith("."):
            return None  # External package

        from_dir = PurePosixPath(from_file).parent
        resolved = str((from_dir / module).as_posix())

        # Normalize path (handle ../  etc)
        try:
            resolved = str(PurePosixPath(resolved))
            # Remove any leading ./
            if resolved.startswith("./"):
                resolved = resolved[2:]
        except Exception:
            return None

        # Try exact path
        if resolved in self._files:
            return resolved

        # Try with extensions
        for ext in (".js", ".jsx", ".ts", ".tsx", ".mjs"):
            candidate = resolved + ext
            if candidate in self._files:
                return candidate

        # Try as directory with index
        for ext in ("/index.js", "/index.ts", "/index.jsx", "/index.tsx"):
            candidate = resolved + ext
            if candidate in self._files:
                return candidate

        return None

    def resolve_c_include(self, path: str) -> Optional[str]:
        """Resolve a C/C++ #include to a repo-relative file path."""
        cache_key = f"c:{path}"
        if cache_key in self._module_cache:
            return self._module_cache[cache_key]

        # Direct match
        if path in self._files:
            self._module_cache[cache_key] = path
            return path

        # Try common prefixes
        for prefix in ("src/", "include/", "lib/"):
            candidate = prefix + path
            if candidate in self._files:
                self._module_cache[cache_key] = candidate
                return candidate

        # Search for matching filename
        filename = PurePosixPath(path).name
        for f in self._files:
            if f.endswith("/" + filename) or f == filename:
                self._module_cache[cache_key] = f
                return f

        self._module_cache[cache_key] = None
        return None
