"""Resolve imports to in-repo file paths."""

from pathlib import Path
from typing import Optional, Dict, Set


class ImportResolver:
    """Resolves import statements to file paths within the repository."""
    
    def __init__(self, repo_root: str):
        self.repo_root = Path(repo_root)
        self._file_cache: Optional[Set[str]] = None
        self._module_cache: Dict[str, Optional[str]] = {}
    
    def _get_repo_files(self) -> Set[str]:
        """Get all Python/JS files in repo (cached)."""
        if self._file_cache is not None:
            return self._file_cache
        
        self._file_cache = set()
        for ext in ('*.py', '*.js', '*.ts', '*.jsx', '*.tsx', '*.mjs'):
            for path in self.repo_root.rglob(ext):
                try:
                    rel = path.relative_to(self.repo_root)
                    self._file_cache.add(str(rel))
                except ValueError:
                    pass
        return self._file_cache
    
    def resolve_python_import(
        self, 
        module: str, 
        from_file: str = None,
        is_relative: bool = False,
        level: int = 0
    ) -> Optional[str]:
        """Resolve a Python import to a file path.
        
        Args:
            module: Module name like "foo.bar" or "baz"
            from_file: File containing the import (for relative imports)
            is_relative: Whether this is a relative import
            level: Number of dots for relative import (1 = ., 2 = .., etc)
            
        Returns:
            Relative file path if found in repo, None otherwise
        """
        cache_key = f"py:{module}:{from_file}:{level}"
        if cache_key in self._module_cache:
            return self._module_cache[cache_key]
        
        result = self._resolve_python_import_uncached(
            module, from_file, is_relative, level
        )
        self._module_cache[cache_key] = result
        return result
    
    def _resolve_python_import_uncached(
        self,
        module: str,
        from_file: str,
        is_relative: bool,
        level: int
    ) -> Optional[str]:
        """Actual resolution logic."""
        repo_files = self._get_repo_files()
        
        # Handle relative imports
        if is_relative and from_file:
            from_path = Path(from_file)
            # Go up 'level' directories
            base_dir = from_path.parent
            for _ in range(level - 1):
                base_dir = base_dir.parent
            
            if module:
                # from .foo import bar -> look for foo.py in same dir
                candidates = self._module_to_paths(module, str(base_dir))
            else:
                # from . import foo -> the package itself
                candidates = [str(base_dir / '__init__.py')]
        else:
            # Absolute import
            candidates = self._module_to_paths(module)
        
        # Check candidates against repo files
        for candidate in candidates:
            normalized = candidate.replace('\\', '/')
            if normalized in repo_files:
                return normalized
        
        return None
    
    def _module_to_paths(self, module: str, base: str = '') -> list:
        """Convert module.name to possible file paths."""
        parts = module.split('.')
        
        if base:
            base_path = Path(base)
        else:
            base_path = Path()
        
        # Try as a package (foo/bar/__init__.py)
        package_path = base_path.joinpath(*parts) / '__init__.py'
        
        # Try as a module (foo/bar.py)
        if parts:
            module_path = base_path.joinpath(*parts[:-1]) / f'{parts[-1]}.py'
        else:
            module_path = None
        
        candidates = [str(package_path)]
        if module_path:
            candidates.append(str(module_path))
        
        return candidates
    
    def resolve_js_import(
        self,
        import_path: str,
        from_file: str
    ) -> Optional[str]:
        """Resolve a JavaScript/TypeScript import to a file path.
        
        Args:
            import_path: Import path like './foo', '../bar', or 'lodash'
            from_file: File containing the import
            
        Returns:
            Relative file path if found in repo, None otherwise
        """
        cache_key = f"js:{import_path}:{from_file}"
        if cache_key in self._module_cache:
            return self._module_cache[cache_key]
        
        result = self._resolve_js_import_uncached(import_path, from_file)
        self._module_cache[cache_key] = result
        return result
    
    def _resolve_js_import_uncached(
        self,
        import_path: str,
        from_file: str
    ) -> Optional[str]:
        """Actual JS resolution logic."""
        # Skip node_modules / bare imports
        if not import_path.startswith('.') and not import_path.startswith('/'):
            return None
        
        repo_files = self._get_repo_files()
        from_path = Path(from_file)
        base_dir = from_path.parent
        
        # Resolve the path
        if import_path.startswith('./'):
            target = base_dir / import_path[2:]
        elif import_path.startswith('../'):
            target = (base_dir / import_path).resolve()
            try:
                target = target.relative_to(self.repo_root)
            except ValueError:
                return None
        else:
            target = Path(import_path)
        
        # Try various extensions
        extensions = ['', '.js', '.ts', '.jsx', '.tsx', '.mjs', '/index.js', '/index.ts']
        
        for ext in extensions:
            candidate = str(target) + ext
            normalized = candidate.replace('\\', '/')
            if normalized in repo_files:
                return normalized
        
        return None
    
    def clear_cache(self):
        """Clear resolution caches."""
        self._file_cache = None
        self._module_cache.clear()
