"""Import resolution — maps import statements to repo file paths."""

import os
from pathlib import Path


class ImportResolver:
    """Resolves import statements to file paths within the repository."""

    def __init__(self, repo_root):
        self._root = Path(repo_root)
        self._file_cache = None  # Cleared when new files detected

    def _get_repo_files(self):
        """Get all files in the repo (cached)."""
        if self._file_cache is None:
            self._file_cache = set()
            for dirpath, dirnames, filenames in os.walk(self._root):
                # Skip hidden dirs and common non-source dirs
                dirnames[:] = [d for d in dirnames
                              if not d.startswith('.') and d not in
                              ('node_modules', '__pycache__', 'venv', '.venv',
                               'dist', 'build', '.git')]
                for f in filenames:
                    rel = os.path.relpath(os.path.join(dirpath, f), self._root)
                    self._file_cache.add(rel)
        return self._file_cache

    def clear_cache(self):
        """Clear file cache (call when new files detected)."""
        self._file_cache = None

    def resolve(self, imp, source_file, language):
        """Resolve an Import to a file path.

        Returns: str (relative path) or None
        """
        if language == "python":
            return self._resolve_python(imp, source_file)
        elif language in ("javascript", "typescript"):
            return self._resolve_javascript(imp, source_file)
        elif language in ("c", "cpp"):
            return self._resolve_c(imp, source_file)
        return None

    def _resolve_python(self, imp, source_file):
        """Resolve Python import."""
        if imp.level > 0:
            # Relative import
            source_dir = Path(source_file).parent
            # Go up (level - 1) directories
            base = source_dir
            for _ in range(imp.level - 1):
                base = base.parent

            if imp.module:
                parts = imp.module.split(".")
                candidate = base / "/".join(parts)
            else:
                candidate = base

            # Try as module file
            as_file = str(candidate) + ".py"
            if as_file in self._get_repo_files():
                return as_file

            # Try as package
            as_init = str(candidate / "__init__.py")
            if as_init in self._get_repo_files():
                return as_init

            return None

        # Absolute import
        if not imp.module:
            return None

        parts = imp.module.split(".")

        # Try direct file
        as_file = "/".join(parts) + ".py"
        if as_file in self._get_repo_files():
            return as_file

        # Try package (__init__.py)
        as_init = "/".join(parts) + "/__init__.py"
        if as_init in self._get_repo_files():
            return as_init

        return None  # External module

    def _resolve_javascript(self, imp, source_file):
        """Resolve JavaScript/TypeScript import."""
        module = imp.module
        if not module:
            return None

        # Only resolve relative imports
        if not module.startswith("."):
            return None  # External module

        source_dir = Path(source_file).parent
        resolved = (source_dir / module)
        rel = str(resolved)

        # Normalize path
        rel = os.path.normpath(rel)

        # Try exact match
        if rel in self._get_repo_files():
            return rel

        # Extension probing
        for ext in (".js", ".ts", ".jsx", ".tsx", ".mjs"):
            candidate = rel + ext
            if candidate in self._get_repo_files():
                return candidate

        # Index file resolution
        for ext in (".js", ".ts", ".jsx", ".tsx"):
            candidate = os.path.join(rel, "index" + ext)
            if candidate in self._get_repo_files():
                return candidate

        return None

    def _resolve_c(self, imp, source_file):
        """Resolve C #include."""
        header = imp.module
        if not header:
            return None

        # Search in repo
        for f in self._get_repo_files():
            if f.endswith(header) or f == header:
                return f

        return None
