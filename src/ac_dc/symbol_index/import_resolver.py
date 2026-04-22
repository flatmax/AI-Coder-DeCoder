"""Import resolver — maps import statements to repo-relative paths.

Turns the ``Import`` objects an extractor emits into concrete
file references that the reference graph can use. Per-language
rules from ``specs4/2-indexing/symbol-index.md#import-resolution``:

- **Python** — absolute dotted module names, ``__init__.py``
  package files, relative imports with level-aware parent
  traversal.
- **JavaScript / TypeScript** — relative paths with extension
  probing, ``index.*`` fallback for directories.
- **C / C++** — ``#include`` search across the repo.

Design notes:

- **File-set-driven, not filesystem-driven.** The resolver
  receives the full list of repo files on construction or via
  :meth:`set_files`. Every resolution reduces to a set-membership
  check plus a few candidate-path constructions. No stat calls,
  no glob walks — the orchestrator already owns the file list.

- **Per-extension index.** A reverse map from stem → full path
  lets JavaScript / TypeScript resolution handle ``./utils`` →
  ``./utils.ts`` without probing the filesystem. Built once on
  ``set_files``, rebuilt when the file set changes.

- **Silent failures.** Unresolvable imports (stdlib, external
  packages, typos) return ``None``. Callers treat None as
  "external / unknown" and skip edge creation. Raising would
  force every extractor post-processing loop into try/except.

- **Stateless across resolutions within a session.** The cache
  is just the file-set index; no per-query memoisation. The
  bottleneck is the extractor's call-site walk, not the
  resolver's dict lookups.

Governing spec: ``specs4/2-indexing/symbol-index.md#import-resolution``.
"""

from __future__ import annotations

from pathlib import PurePosixPath
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ac_dc.symbol_index.models import Import


# Extensions the resolver treats as JavaScript/TypeScript-like.
# Probed in order for bare relative imports (``./utils`` →
# ``./utils.ts`` wins over ``./utils.js`` if both exist — matches
# TypeScript resolution preference).
_JS_TS_EXTENSIONS: tuple[str, ...] = (
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
)

# Extensions the resolver treats as C/C++ headers. Probed for
# ``#include`` directives.
_C_HEADER_EXTENSIONS: tuple[str, ...] = (
    ".h",
    ".hpp",
    ".hxx",
)


class ImportResolver:
    """Resolve :class:`Import` objects to repo-relative file paths.

    Construct once per repo index pass (or reuse across passes
    and call :meth:`set_files` when the file set changes). The
    resolver is stateless beyond its file-set index — no
    per-query caching — so it's safe to call concurrently from
    multiple threads if a caller ever wants to.

    Parameters
    ----------
    files
        Iterable of repo-relative file paths. Empty initially
        is fine; :meth:`set_files` updates the index later.
    """

    def __init__(
        self,
        files: "list[str] | set[str] | tuple[str, ...] | None" = None,
    ) -> None:
        self._files: set[str] = set()
        # stem → list of full paths sharing that stem. Used by
        # JS/TS and C/C++ resolution when an import omits the
        # extension. A list because multiple extensions can share
        # a stem (``utils.ts`` and ``utils.js``).
        self._by_stem: dict[str, list[str]] = {}
        # directory path → list of files directly inside it. Used
        # for ``index.*`` fallback and for package resolution
        # (``__init__.py``). Keys are directory paths without
        # trailing slash; empty string for repo root.
        self._by_dir: dict[str, list[str]] = {}
        if files is not None:
            self.set_files(files)

    # ------------------------------------------------------------------
    # File-set management
    # ------------------------------------------------------------------

    def set_files(
        self,
        files: "list[str] | set[str] | tuple[str, ...]",
    ) -> None:
        """Replace the file-set index.

        Normalises all paths to forward slashes. Rebuilds the
        reverse indexes (by stem, by directory). Idempotent —
        calling with the same list reproduces the same indexes.
        """
        normalised = {
            str(p).replace("\\", "/").strip("/")
            for p in files
            if p
        }
        self._files = normalised
        self._by_stem = {}
        self._by_dir = {}
        for path in normalised:
            pp = PurePosixPath(path)
            stem = pp.stem
            self._by_stem.setdefault(stem, []).append(path)
            parent = str(pp.parent) if str(pp.parent) != "." else ""
            self._by_dir.setdefault(parent, []).append(path)

    @property
    def files(self) -> set[str]:
        """Return a copy of the current file set."""
        return set(self._files)

    # ------------------------------------------------------------------
    # Language dispatch
    # ------------------------------------------------------------------

    def resolve(
        self,
        imp: "Import",
        source_file: str,
    ) -> str | None:
        """Resolve an import, dispatching by source-file extension.

        Parameters
        ----------
        imp
            The :class:`Import` object to resolve.
        source_file
            Repo-relative path of the file that contains the
            import. Used to anchor relative resolution and to
            pick the right per-language rules.

        Returns
        -------
        str or None
            Repo-relative path of the resolved file, or None if
            the import targets something outside the repo
            (stdlib, third-party package, or a typo).
        """
        source = str(source_file).replace("\\", "/").strip("/")
        ext = PurePosixPath(source).suffix.lower()

        if ext == ".py":
            return self._resolve_python(imp, source)
        if ext in _JS_TS_EXTENSIONS:
            return self._resolve_js(imp, source)
        if ext in _C_HEADER_EXTENSIONS or ext in (".c", ".cpp", ".cc", ".cxx"):
            return self._resolve_c(imp, source)
        return None

    # ------------------------------------------------------------------
    # Python
    # ------------------------------------------------------------------

    def _resolve_python(
        self,
        imp: "Import",
        source: str,
    ) -> str | None:
        """Resolve a Python import.

        Handles three shapes:

        - Absolute: ``import foo.bar`` → ``foo/bar.py`` or
          ``foo/bar/__init__.py``.
        - Relative: ``from .x import y`` (level 1) →
          ``{source_dir}/x.py`` or ``{source_dir}/x/__init__.py``.
        - Bare relative: ``from . import x`` (level 1, empty
          module) → ``{source_dir}/x.py`` (using the first
          imported name as the target).

        Level counts dots: ``.foo`` is level 1, ``..foo`` is
        level 2. Each level above 1 walks up one directory from
        the source file's parent.

        Returns None for stdlib / third-party modules that don't
        exist in the repo file set.
        """
        level = imp.level
        module = imp.module or ""

        if level == 0:
            return self._python_module_to_path(module)

        source_pp = PurePosixPath(source)
        anchor = source_pp.parent
        for _ in range(level - 1):
            if str(anchor) in (".", ""):
                return None
            anchor = anchor.parent

        anchor_str = str(anchor) if str(anchor) != "." else ""

        if module:
            rel_base = module.replace(".", "/")
            candidate_base = (
                f"{anchor_str}/{rel_base}"
                if anchor_str
                else rel_base
            )
            return self._python_module_to_path(candidate_base)

        if not imp.names:
            return None
        target = imp.names[0]
        candidate_base = (
            f"{anchor_str}/{target}" if anchor_str else target
        )
        return self._python_module_to_path(candidate_base)

    def _python_module_to_path(self, module: str) -> str | None:
        """Convert a dotted Python module path to a repo file path.

        Tries two candidates in order:

        1. ``foo/bar.py`` — the module as a plain .py file
        2. ``foo/bar/__init__.py`` — the module as a package
        """
        if not module:
            return None
        base = module.replace(".", "/")
        plain = f"{base}.py"
        if plain in self._files:
            return plain
        pkg = f"{base}/__init__.py"
        if pkg in self._files:
            return pkg
        return None

    # ------------------------------------------------------------------
    # JavaScript / TypeScript
    # ------------------------------------------------------------------

    def _resolve_js(
        self,
        imp: "Import",
        source: str,
    ) -> str | None:
        """Resolve a JS/TS import.

        ESM imports carry the module path in the module field
        verbatim — ``import foo from "./utils"`` becomes
        ``module="./utils"``. Only relative imports (starting
        with ``.``) resolve to repo files; bare specifiers
        (``"react"``, ``"@org/pkg"``) are external and return
        None.

        Resolution tries, in order:

        1. Exact path as-is (if the import already includes an
           extension).
        2. Path + each extension in :data:`_JS_TS_EXTENSIONS`.
        3. Path + ``/index.{ext}`` for directory-style imports.

        The extension priority (``.ts`` before ``.js``) matches
        TypeScript's own module-resolution preference — in a
        mixed codebase where both exist, the TS file is the
        authoritative source.
        """
        module = imp.module or ""
        if not module.startswith("."):
            return None

        source_pp = PurePosixPath(source)
        anchor = source_pp.parent
        parts = list(anchor.parts) if str(anchor) != "." else []
        for segment in module.split("/"):
            if segment in ("", "."):
                continue
            if segment == "..":
                if not parts:
                    return None
                parts.pop()
            else:
                parts.append(segment)

        candidate = "/".join(parts)
        if not candidate:
            return None

        if candidate in self._files:
            return candidate

        for ext in _JS_TS_EXTENSIONS:
            probe = f"{candidate}{ext}"
            if probe in self._files:
                return probe

        for ext in _JS_TS_EXTENSIONS:
            probe = f"{candidate}/index{ext}"
            if probe in self._files:
                return probe

        return None

    # ------------------------------------------------------------------
    # C / C++
    # ------------------------------------------------------------------

    def _resolve_c(
        self,
        imp: "Import",
        source: str,
    ) -> str | None:
        """Resolve a ``#include`` directive.

        The extractor stores the bracketed or quoted path from
        ``#include`` verbatim in the module field (quotes and
        angle brackets already stripped).

        Resolution tries, in order:

        1. Source-relative — ``#include "foo.h"`` inside
           ``src/a.c`` resolves to ``src/foo.h`` if it exists.
        2. Exact match anywhere in the repo — handles
           ``#include "subdir/foo.h"`` when the source is
           elsewhere.
        3. By-basename search across the repo — ``#include
           <foo.h>`` finds the first ``foo.h`` in the file set.
           Ambiguous in principle but the reference graph only
           needs one target.

        Unresolvable includes (system headers like ``stdio.h``,
        typos) return None.
        """
        module = (imp.module or "").strip()
        if not module:
            return None

        target = module.replace("\\", "/").strip("/")

        source_pp = PurePosixPath(source)
        anchor = source_pp.parent
        anchor_str = str(anchor) if str(anchor) != "." else ""
        if anchor_str:
            candidate = f"{anchor_str}/{target}"
        else:
            candidate = target
        if candidate in self._files:
            return candidate

        if target in self._files:
            return target

        target_basename = PurePosixPath(target).name
        stem = PurePosixPath(target).stem
        candidates = self._by_stem.get(stem, [])
        for path in candidates:
            if PurePosixPath(path).name == target_basename:
                return path

        return None