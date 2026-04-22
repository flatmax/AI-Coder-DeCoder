"""Tests for ac_dc.symbol_index.import_resolver — Layer 2.5.

Scope: the ImportResolver class. Each test constructs a fresh
resolver with an explicit file set so behaviour is independent
of any on-disk state. The resolver is pure — no filesystem
access, no network — so tests run in microseconds.

Covers:

- Construction and file-set management (set_files, files
  property, normalisation of Windows-style separators)
- Language dispatch by source-file extension
- Python: absolute, package (__init__.py), relative (level
  1/2), bare relative (from . import x), unresolvable stdlib
- JavaScript/TypeScript: relative with and without extension,
  index.* fallback, parent-directory traversal (../), bare
  specifiers (external packages) rejected, TS-over-JS
  priority
- C/C++: source-relative quote includes, exact-match paths,
  by-basename search for angle-bracketed system headers,
  backslash normalisation
- Edge cases: empty file set, unknown source extension,
  parent-traversal past the repo root
"""

from __future__ import annotations

from ac_dc.symbol_index.import_resolver import ImportResolver
from ac_dc.symbol_index.models import Import


# ---------------------------------------------------------------------------
# File-set management
# ---------------------------------------------------------------------------


class TestFileSetManagement:
    """set_files, files property, path normalisation."""

    def test_empty_initially(self) -> None:
        """A freshly constructed resolver has no files."""
        resolver = ImportResolver()
        assert resolver.files == set()

    def test_constructor_accepts_file_list(self) -> None:
        """Passing files to __init__ is equivalent to set_files."""
        resolver = ImportResolver(["a.py", "b.py"])
        assert resolver.files == {"a.py", "b.py"}

    def test_set_files_replaces_index(self) -> None:
        """set_files wipes prior state — not additive."""
        resolver = ImportResolver(["a.py"])
        resolver.set_files(["b.py", "c.py"])
        assert resolver.files == {"b.py", "c.py"}

    def test_set_files_normalises_backslashes(self) -> None:
        """Windows-style separators convert to forward slashes."""
        resolver = ImportResolver(["src\\main.py"])
        assert resolver.files == {"src/main.py"}

    def test_set_files_strips_leading_slash(self) -> None:
        """A leading slash doesn't produce a different key."""
        resolver = ImportResolver(["/src/main.py"])
        assert resolver.files == {"src/main.py"}

    def test_set_files_skips_empty_strings(self) -> None:
        """Empty strings in the input list are filtered out."""
        resolver = ImportResolver(["a.py", "", "b.py"])
        assert resolver.files == {"a.py", "b.py"}

    def test_files_returns_copy(self) -> None:
        """Mutating the returned set doesn't affect the resolver."""
        resolver = ImportResolver(["a.py"])
        got = resolver.files
        got.add("fake.py")
        assert resolver.files == {"a.py"}

    def test_set_files_is_idempotent(self) -> None:
        """Same input → same internal state."""
        resolver = ImportResolver()
        resolver.set_files(["a.py", "b.py"])
        resolver.set_files(["a.py", "b.py"])
        assert resolver.files == {"a.py", "b.py"}


# ---------------------------------------------------------------------------
# Dispatch by source file extension
# ---------------------------------------------------------------------------


class TestDispatch:
    """resolve() picks the right language rules from source extension."""

    def test_unknown_extension_returns_none(self) -> None:
        """Source with an unrecognised extension doesn't resolve."""
        resolver = ImportResolver(["a.py"])
        imp = Import(module="a", line=1)
        assert resolver.resolve(imp, "readme.md") is None

    def test_empty_file_set_returns_none(self) -> None:
        """With no files, nothing resolves — even well-formed imports."""
        resolver = ImportResolver()
        imp = Import(module="os", line=1)
        assert resolver.resolve(imp, "src/main.py") is None

    def test_extension_match_is_case_insensitive(self) -> None:
        """Uppercase source extension still dispatches correctly."""
        resolver = ImportResolver(["mod.py"])
        imp = Import(module="mod", line=1)
        assert resolver.resolve(imp, "Main.PY") == "mod.py"


# ---------------------------------------------------------------------------
# Python resolution
# ---------------------------------------------------------------------------


class TestPythonResolution:
    """Per-language rules for .py source files."""

    def test_absolute_import_to_module_file(self) -> None:
        """``import foo.bar`` → ``foo/bar.py``."""
        resolver = ImportResolver(["foo/bar.py", "main.py"])
        imp = Import(module="foo.bar", level=0, line=1)
        assert resolver.resolve(imp, "main.py") == "foo/bar.py"

    def test_absolute_import_to_package_init(self) -> None:
        """``import foo`` → ``foo/__init__.py`` when only the package exists."""
        resolver = ImportResolver(["foo/__init__.py", "main.py"])
        imp = Import(module="foo", level=0, line=1)
        assert resolver.resolve(imp, "main.py") == "foo/__init__.py"

    def test_plain_py_preferred_over_init(self) -> None:
        """``foo.py`` wins over ``foo/__init__.py`` when both exist."""
        resolver = ImportResolver([
            "foo.py",
            "foo/__init__.py",
            "main.py",
        ])
        imp = Import(module="foo", level=0, line=1)
        assert resolver.resolve(imp, "main.py") == "foo.py"

    def test_absolute_unknown_module_returns_none(self) -> None:
        """Stdlib / third-party modules aren't in the repo."""
        resolver = ImportResolver(["main.py"])
        imp = Import(module="os", level=0, line=1)
        assert resolver.resolve(imp, "main.py") is None

    def test_relative_level_1_same_directory(self) -> None:
        """``from .sibling import x`` resolves to a same-dir file."""
        resolver = ImportResolver([
            "pkg/__init__.py",
            "pkg/main.py",
            "pkg/sibling.py",
        ])
        imp = Import(module="sibling", names=["x"], level=1, line=1)
        assert resolver.resolve(imp, "pkg/main.py") == "pkg/sibling.py"

    def test_relative_level_2_parent_directory(self) -> None:
        """``from ..other import x`` resolves up one directory."""
        resolver = ImportResolver([
            "pkg/__init__.py",
            "pkg/sub/__init__.py",
            "pkg/sub/main.py",
            "pkg/other.py",
        ])
        imp = Import(module="other", names=["x"], level=2, line=1)
        assert resolver.resolve(imp, "pkg/sub/main.py") == "pkg/other.py"

    def test_bare_relative_uses_first_name(self) -> None:
        """``from . import x`` — empty module, uses first name as target."""
        resolver = ImportResolver([
            "pkg/__init__.py",
            "pkg/main.py",
            "pkg/helper.py",
        ])
        imp = Import(module="", names=["helper"], level=1, line=1)
        assert resolver.resolve(imp, "pkg/main.py") == "pkg/helper.py"

    def test_bare_relative_no_names_returns_none(self) -> None:
        """``from . import *`` or similar degenerate cases → None."""
        resolver = ImportResolver([
            "pkg/__init__.py",
            "pkg/main.py",
        ])
        imp = Import(module="", names=[], level=1, line=1)
        assert resolver.resolve(imp, "pkg/main.py") is None

    def test_relative_walks_above_repo_root_returns_none(self) -> None:
        """``from ..x import y`` at repo root walks above → None."""
        resolver = ImportResolver(["main.py"])
        imp = Import(module="x", names=["y"], level=2, line=1)
        assert resolver.resolve(imp, "main.py") is None

    def test_relative_to_package_init(self) -> None:
        """``from .sub import x`` resolves to ``sub/__init__.py``."""
        resolver = ImportResolver([
            "pkg/__init__.py",
            "pkg/main.py",
            "pkg/sub/__init__.py",
        ])
        imp = Import(module="sub", names=["x"], level=1, line=1)
        assert resolver.resolve(imp, "pkg/main.py") == "pkg/sub/__init__.py"

    def test_dotted_absolute_uses_directory_path(self) -> None:
        """``import a.b.c`` → ``a/b/c.py`` (dots → directory separators)."""
        resolver = ImportResolver([
            "a/b/c.py",
            "main.py",
        ])
        imp = Import(module="a.b.c", level=0, line=1)
        assert resolver.resolve(imp, "main.py") == "a/b/c.py"

    def test_empty_module_absolute_returns_none(self) -> None:
        """Empty module name with level 0 can't resolve anywhere."""
        resolver = ImportResolver(["main.py"])
        imp = Import(module="", level=0, line=1)
        assert resolver.resolve(imp, "main.py") is None


# ---------------------------------------------------------------------------
# JavaScript / TypeScript resolution
# ---------------------------------------------------------------------------


class TestJavaScriptResolution:
    """Per-language rules for JS / TS / JSX / TSX / MJS source files."""

    def test_relative_with_extension(self) -> None:
        """``import foo from "./utils.ts"`` → ``./utils.ts``."""
        resolver = ImportResolver(["src/main.ts", "src/utils.ts"])
        imp = Import(module="./utils.ts", line=1)
        assert resolver.resolve(imp, "src/main.ts") == "src/utils.ts"

    def test_relative_without_extension_probes_ts(self) -> None:
        """``./utils`` without extension finds ``utils.ts``."""
        resolver = ImportResolver(["src/main.ts", "src/utils.ts"])
        imp = Import(module="./utils", line=1)
        assert resolver.resolve(imp, "src/main.ts") == "src/utils.ts"

    def test_ts_wins_over_js_with_same_stem(self) -> None:
        """In a mixed repo, ``.ts`` wins over ``.js`` for ``./utils``.

        Matches TypeScript's own module-resolution preference.
        If both exist, the TS file is the authoritative source.
        """
        resolver = ImportResolver([
            "src/main.ts",
            "src/utils.ts",
            "src/utils.js",
        ])
        imp = Import(module="./utils", line=1)
        assert resolver.resolve(imp, "src/main.ts") == "src/utils.ts"

    def test_relative_without_extension_probes_js(self) -> None:
        """Falls back to ``.js`` when no ``.ts`` exists."""
        resolver = ImportResolver(["src/main.js", "src/utils.js"])
        imp = Import(module="./utils", line=1)
        assert resolver.resolve(imp, "src/main.js") == "src/utils.js"

    def test_directory_index_fallback(self) -> None:
        """``./utils`` → ``./utils/index.ts`` when no file exists."""
        resolver = ImportResolver([
            "src/main.ts",
            "src/utils/index.ts",
        ])
        imp = Import(module="./utils", line=1)
        assert resolver.resolve(imp, "src/main.ts") == "src/utils/index.ts"

    def test_directory_index_js_fallback(self) -> None:
        """``./utils`` → ``./utils/index.js`` when no TS variants exist."""
        resolver = ImportResolver([
            "src/main.js",
            "src/utils/index.js",
        ])
        imp = Import(module="./utils", line=1)
        assert resolver.resolve(imp, "src/main.js") == "src/utils/index.js"

    def test_file_wins_over_directory_index(self) -> None:
        """``./utils.ts`` beats ``./utils/index.ts`` when both exist.

        Extension probing runs before index fallback. A file
        at the requested path is always more specific than a
        directory-index convention.
        """
        resolver = ImportResolver([
            "src/main.ts",
            "src/utils.ts",
            "src/utils/index.ts",
        ])
        imp = Import(module="./utils", line=1)
        assert resolver.resolve(imp, "src/main.ts") == "src/utils.ts"

    def test_parent_directory_traversal(self) -> None:
        """``../shared/foo`` walks up one directory."""
        resolver = ImportResolver([
            "src/pages/home.ts",
            "src/shared/foo.ts",
        ])
        imp = Import(module="../shared/foo", line=1)
        assert resolver.resolve(imp, "src/pages/home.ts") == "src/shared/foo.ts"

    def test_multiple_parent_traversal(self) -> None:
        """``../../lib/util`` walks up two directories."""
        resolver = ImportResolver([
            "src/a/b/c.ts",
            "src/lib/util.ts",
        ])
        imp = Import(module="../../lib/util", line=1)
        assert resolver.resolve(imp, "src/a/b/c.ts") == "src/lib/util.ts"

    def test_parent_traversal_past_root_returns_none(self) -> None:
        """Walking above the repo root fails cleanly."""
        resolver = ImportResolver(["main.ts"])
        imp = Import(module="../outside", line=1)
        assert resolver.resolve(imp, "main.ts") is None

    def test_bare_specifier_returns_none(self) -> None:
        """``import React from "react"`` — external, not in repo."""
        resolver = ImportResolver(["src/main.ts"])
        imp = Import(module="react", line=1)
        assert resolver.resolve(imp, "src/main.ts") is None

    def test_scoped_package_returns_none(self) -> None:
        """``import x from "@org/pkg"`` — scoped external package."""
        resolver = ImportResolver(["src/main.ts"])
        imp = Import(module="@org/pkg", line=1)
        assert resolver.resolve(imp, "src/main.ts") is None

    def test_current_directory_dot_slash(self) -> None:
        """``./foo`` from a deep file resolves relative to its dir."""
        resolver = ImportResolver([
            "src/a/b/main.ts",
            "src/a/b/foo.ts",
        ])
        imp = Import(module="./foo", line=1)
        assert resolver.resolve(imp, "src/a/b/main.ts") == "src/a/b/foo.ts"

    def test_tsx_extension_resolved(self) -> None:
        """``./Component`` finds ``./Component.tsx``."""
        resolver = ImportResolver([
            "src/App.tsx",
            "src/Component.tsx",
        ])
        imp = Import(module="./Component", line=1)
        assert resolver.resolve(imp, "src/App.tsx") == "src/Component.tsx"

    def test_jsx_extension_resolved(self) -> None:
        """``./Widget`` finds ``./Widget.jsx`` in a JSX-only repo."""
        resolver = ImportResolver([
            "src/App.jsx",
            "src/Widget.jsx",
        ])
        imp = Import(module="./Widget", line=1)
        assert resolver.resolve(imp, "src/App.jsx") == "src/Widget.jsx"

    def test_mjs_source_can_resolve_imports(self) -> None:
        """``.mjs`` source files use the same JS resolution rules."""
        resolver = ImportResolver(["src/main.mjs", "src/util.mjs"])
        imp = Import(module="./util", line=1)
        assert resolver.resolve(imp, "src/main.mjs") == "src/util.mjs"

    def test_unresolvable_relative_returns_none(self) -> None:
        """A relative import to a nonexistent file → None."""
        resolver = ImportResolver(["src/main.ts"])
        imp = Import(module="./nope", line=1)
        assert resolver.resolve(imp, "src/main.ts") is None


# ---------------------------------------------------------------------------
# C / C++ resolution
# ---------------------------------------------------------------------------


class TestCResolution:
    """Per-language rules for C and C++ source / header files."""

    def test_source_relative_quote_include(self) -> None:
        """``#include "foo.h"`` from ``src/a.c`` → ``src/foo.h``."""
        resolver = ImportResolver(["src/a.c", "src/foo.h"])
        imp = Import(module="foo.h", line=1)
        assert resolver.resolve(imp, "src/a.c") == "src/foo.h"

    def test_relative_with_subdirectory(self) -> None:
        """``#include "sub/foo.h"`` resolves relative to source dir."""
        resolver = ImportResolver([
            "src/a.c",
            "src/sub/foo.h",
        ])
        imp = Import(module="sub/foo.h", line=1)
        assert resolver.resolve(imp, "src/a.c") == "src/sub/foo.h"

    def test_exact_match_from_repo_root(self) -> None:
        """``#include "lib/foo.h"`` matches at repo root if source-rel fails.

        When a header's path is given verbatim and source-relative
        probing doesn't find it, the exact path is tried as a
        second step. This handles includes that assume a repo-root
        build directory.
        """
        resolver = ImportResolver([
            "src/a.c",
            "lib/foo.h",
        ])
        imp = Import(module="lib/foo.h", line=1)
        assert resolver.resolve(imp, "src/a.c") == "lib/foo.h"

    def test_by_basename_search(self) -> None:
        """``#include <foo.h>`` finds any foo.h in the repo.

        Angle-bracketed includes have no directory information
        beyond what's written. The resolver falls back to a
        basename search — any matching file wins. In principle
        ambiguous if two foo.h exist; the reference graph only
        needs one target.
        """
        resolver = ImportResolver([
            "src/main.c",
            "third_party/lib/foo.h",
        ])
        imp = Import(module="foo.h", line=1)
        assert resolver.resolve(imp, "src/main.c") == "third_party/lib/foo.h"

    def test_source_relative_wins_over_basename(self) -> None:
        """A header next to the source wins over one elsewhere.

        When ``src/a.c`` includes ``foo.h`` and both
        ``src/foo.h`` and ``other/foo.h`` exist, the one in the
        source's directory is the right answer. Tests the
        ordering of the resolver's three fallback steps.
        """
        resolver = ImportResolver([
            "src/a.c",
            "src/foo.h",
            "other/foo.h",
        ])
        imp = Import(module="foo.h", line=1)
        assert resolver.resolve(imp, "src/a.c") == "src/foo.h"

    def test_unknown_system_header_returns_none(self) -> None:
        """``#include <stdio.h>`` — not in repo, no resolution."""
        resolver = ImportResolver(["src/main.c"])
        imp = Import(module="stdio.h", line=1)
        assert resolver.resolve(imp, "src/main.c") is None

    def test_cpp_source_uses_c_rules(self) -> None:
        """``.cpp`` source files dispatch to the same C resolver."""
        resolver = ImportResolver(["src/a.cpp", "src/foo.hpp"])
        imp = Import(module="foo.hpp", line=1)
        assert resolver.resolve(imp, "src/a.cpp") == "src/foo.hpp"

    def test_h_source_uses_c_rules(self) -> None:
        """A ``.h`` file including another header resolves correctly.

        Headers are a valid source file type — the dispatch
        extension set includes ``.h``, ``.hpp``, ``.hxx`` so
        inclusion chains within headers are captured.
        """
        resolver = ImportResolver(["src/foo.h", "src/bar.h"])
        imp = Import(module="bar.h", line=1)
        assert resolver.resolve(imp, "src/foo.h") == "src/bar.h"

    def test_include_with_backslashes_normalised(self) -> None:
        """``#include "sub\\foo.h"`` normalises to forward slashes.

        Unlikely in practice (most C code uses forward slashes)
        but cheap to handle — the extractor passes through
        whatever bytes the preprocessor directive contained.
        """
        resolver = ImportResolver([
            "src/a.c",
            "src/sub/foo.h",
        ])
        imp = Import(module="sub\\foo.h", line=1)
        assert resolver.resolve(imp, "src/a.c") == "src/sub/foo.h"

    def test_empty_include_returns_none(self) -> None:
        """``#include ""`` (empty include) can't resolve."""
        resolver = ImportResolver(["src/a.c"])
        imp = Import(module="", line=1)
        assert resolver.resolve(imp, "src/a.c") is None