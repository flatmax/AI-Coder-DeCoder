"""Tests for ac_dc.symbol_index.parser — Layer 2.1.

Scope:

- ``language_for_file`` — extension → language mapping
- ``LANGUAGE_MAP`` — registry shape and the TypeScript quirk
- ``TreeSitterParser`` — lazy load, caching, parse round-trip,
  missing-grammar handling
- Integration — each installed grammar actually parses a minimal
  source snippet to a non-error tree

Strategy:

- Tests that need real grammars use the packages declared in
  pyproject.toml ``[project.dependencies]``. These ship in every
  dev install.
- Missing-grammar behaviour is simulated with monkeypatched
  ``importlib.import_module``, not by uninstalling packages. This
  keeps the test hermetic and fast.
- The ``reset_instance`` test hook clears ``TreeSitterParser``'s
  shared-instance cache between tests so one test's monkeypatched
  environment doesn't leak into the next.
"""

from __future__ import annotations

import importlib
from unittest.mock import patch

import pytest

from ac_dc.symbol_index.parser import (
    LANGUAGE_MAP,
    LanguageSpec,
    TreeSitterParser,
    language_for_file,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_parser_singleton() -> None:
    """Clear the shared TreeSitterParser between tests.

    Tests that simulate a missing grammar via monkeypatching must
    not leak their patched state into the next test's cache. The
    singleton caches the failed-load result (as None) so even
    after the monkeypatch is removed, the next lookup would still
    return None without this reset.
    """
    TreeSitterParser.reset_instance()
    yield
    TreeSitterParser.reset_instance()


# ---------------------------------------------------------------------------
# LANGUAGE_MAP registry
# ---------------------------------------------------------------------------


class TestLanguageMap:
    """Registry shape and language-specific quirks."""

    def test_all_five_languages_registered(self) -> None:
        """Python, JS, TS, C, C++ are all in the registry."""
        assert set(LANGUAGE_MAP.keys()) == {
            "python",
            "javascript",
            "typescript",
            "c",
            "cpp",
        }

    def test_every_spec_is_frozen(self) -> None:
        """LanguageSpec is a frozen dataclass — immutable by design.

        Immutable registry entries prevent accidental mutation at
        import time (a caller monkeypatching a spec to test
        something, then forgetting to restore).
        """
        for spec in LANGUAGE_MAP.values():
            with pytest.raises(Exception):
                # Frozen dataclass — setattr raises FrozenInstanceError.
                spec.name = "different"  # type: ignore[misc]

    def test_typescript_probes_both_function_names(self) -> None:
        """TypeScript quirk — probe language_typescript FIRST.

        Pinning the probe order matters: tree_sitter_typescript
        today exposes only language_typescript and language_tsx,
        so listing 'language' first would match nothing. Listing
        'language_typescript' first finds the grammar on the
        current wheel; keeping 'language' as a fallback means a
        future wheel adding a plain language() still works.
        """
        spec = LANGUAGE_MAP["typescript"]
        assert spec.function_names[0] == "language_typescript"
        assert "language" in spec.function_names

    def test_other_languages_use_plain_language(self) -> None:
        """All non-TypeScript grammars expose a plain language()."""
        for name in ("python", "javascript", "c", "cpp"):
            spec = LANGUAGE_MAP[name]
            assert spec.function_names == ("language",), (
                f"{name}'s function_names should be ('language',), "
                f"got {spec.function_names}"
            )

    def test_spec_name_matches_dict_key(self) -> None:
        """Spec.name equals its LANGUAGE_MAP key.

        The extension-reverse-map builder and several downstream
        callers assume these agree. Catch divergence at test time
        rather than debugging a missing language at runtime.
        """
        for key, spec in LANGUAGE_MAP.items():
            assert key == spec.name, (
                f"LANGUAGE_MAP key {key!r} does not match "
                f"spec.name {spec.name!r}"
            )

    def test_extensions_are_lowercase_with_dot(self) -> None:
        """All extensions are lowercase and start with a dot.

        language_for_file lowercases the incoming path's suffix
        before lookup — inconsistent casing in the registry would
        produce silent misses.
        """
        for spec in LANGUAGE_MAP.values():
            for ext in spec.extensions:
                assert ext.startswith("."), (
                    f"extension {ext!r} should start with '.'"
                )
                assert ext == ext.lower(), (
                    f"extension {ext!r} should be lowercase"
                )

    def test_h_claimed_by_c_not_cpp(self) -> None:
        """.h routes to C, not C++.

        Deliberate choice (specs4/2-indexing/symbol-index.md) —
        in a mixed repo the C parser handles both, and only
        C++-exclusive extensions route to the C++ grammar.
        """
        assert ".h" in LANGUAGE_MAP["c"].extensions
        assert ".h" not in LANGUAGE_MAP["cpp"].extensions


# ---------------------------------------------------------------------------
# language_for_file — extension resolution
# ---------------------------------------------------------------------------


class TestLanguageForFile:
    """Extension → language mapping."""

    @pytest.mark.parametrize(
        "path,expected",
        [
            ("foo.py", "python"),
            ("src/bar.py", "python"),
            ("/abs/path/baz.py", "python"),
            ("foo.js", "javascript"),
            ("foo.mjs", "javascript"),
            ("foo.jsx", "javascript"),
            ("foo.ts", "typescript"),
            ("foo.tsx", "typescript"),
            ("foo.c", "c"),
            ("foo.h", "c"),
            ("foo.cpp", "cpp"),
            ("foo.cc", "cpp"),
            ("foo.cxx", "cpp"),
            ("foo.hpp", "cpp"),
            ("foo.hxx", "cpp"),
        ],
    )
    def test_known_extensions(self, path: str, expected: str) -> None:
        """Every registered extension resolves to its language."""
        assert language_for_file(path) == expected

    def test_case_insensitive(self) -> None:
        """Uppercase extensions resolve the same as lowercase.

        Real repos contain .PY, .JS, .C — especially on
        case-preserving filesystems copied from case-insensitive
        ones. The registry is lowercase-only so the lookup
        lowercases the incoming suffix before probing.
        """
        assert language_for_file("Foo.PY") == "python"
        assert language_for_file("bar.JS") == "javascript"
        assert language_for_file("baz.Cpp") == "cpp"

    def test_unknown_extension_returns_none(self) -> None:
        """Unrecognised extensions produce None, not an error.

        The orchestrator walks the repo and calls this per file;
        a file the index doesn't care about (README.md, package.json)
        must produce None cleanly so the caller just skips it.
        """
        assert language_for_file("README.md") is None
        assert language_for_file("config.toml") is None
        assert language_for_file("data.bin") is None

    def test_extensionless_returns_none(self) -> None:
        """Files with no extension produce None.

        Makefile, LICENSE, Dockerfile and similar intentionally
        don't have a tree-sitter language associated. The doc
        index handles those separately.
        """
        assert language_for_file("Makefile") is None
        assert language_for_file("LICENSE") is None

    def test_accepts_pathlib_path(self) -> None:
        """PathLike objects are handled, not just strings.

        Callers hold paths as pathlib.Path all over the codebase;
        converting them to str at every boundary would be noisy.
        """
        from pathlib import Path

        assert language_for_file(Path("foo.py")) == "python"


# ---------------------------------------------------------------------------
# TreeSitterParser — singleton, lifecycle, caching
# ---------------------------------------------------------------------------


class TestTreeSitterParserSingleton:
    """The shared-instance lifecycle.

    Not testing that it's a *strict* singleton (Python can't
    enforce that anyway) — testing that ``instance()`` returns
    the same object across calls, and ``reset_instance()``
    releases it.
    """

    def test_instance_returns_same_object(self) -> None:
        a = TreeSitterParser.instance()
        b = TreeSitterParser.instance()
        assert a is b

    def test_reset_instance_creates_fresh(self) -> None:
        a = TreeSitterParser.instance()
        TreeSitterParser.reset_instance()
        b = TreeSitterParser.instance()
        assert a is not b

    def test_direct_construction_is_allowed(self) -> None:
        """Nothing prevents constructing multiple instances.

        Tests sometimes want an isolated parser without touching
        the shared one — for example when driving a parametrised
        benchmark against a fresh cache each time. The class
        isn't strictly a singleton in the Python sense; the
        ``instance()`` method is a convenience, not a constraint.
        """
        p1 = TreeSitterParser()
        p2 = TreeSitterParser()
        assert p1 is not p2
        shared = TreeSitterParser.instance()
        assert shared is not p1
        assert shared is not p2


class TestGrammarLoading:
    """get_language / get_parser — lazy load and cache."""

    def test_unknown_language_returns_none(self) -> None:
        """An unknown language name resolves to None without raising.

        Guards against a caller bug (typo in a language name)
        causing an AttributeError or KeyError deep in the parser.
        """
        parser = TreeSitterParser()
        assert parser.get_language("klingon") is None
        assert parser.get_parser("klingon") is None

    def test_missing_grammar_returns_none(self) -> None:
        """A grammar whose package can't be imported produces None.

        Simulated by patching importlib.import_module to raise
        ImportError for the target package. Real uninstallation
        would corrupt the test environment; the patched-import
        approach is hermetic and reversible.
        """
        parser = TreeSitterParser()
        original_import = importlib.import_module

        def fake_import(name: str, *args, **kwargs):
            if name == "tree_sitter_python":
                raise ImportError("simulated missing grammar")
            return original_import(name, *args, **kwargs)

        with patch("ac_dc.symbol_index.parser.importlib.import_module",
                   side_effect=fake_import):
            assert parser.get_language("python") is None
            assert parser.get_parser("python") is None

    def test_missing_grammar_caches_none(self) -> None:
        """Failed loads are cached so repeated calls don't re-probe.

        Critical for performance — during a full repo scan the
        orchestrator may ask for the same language hundreds of
        times. Re-running importlib.import_module on every call
        would be wasteful and would also re-emit the log message
        every time.
        """
        parser = TreeSitterParser()
        original_import = importlib.import_module
        call_count = 0

        def counting_import(name: str, *args, **kwargs):
            nonlocal call_count
            if name == "tree_sitter_python":
                call_count += 1
                raise ImportError("simulated missing grammar")
            return original_import(name, *args, **kwargs)

        with patch("ac_dc.symbol_index.parser.importlib.import_module",
                   side_effect=counting_import):
            parser.get_language("python")
            parser.get_language("python")
            parser.get_language("python")

        # First call attempts the import; subsequent calls hit
        # the cache. Exactly one import attempt.
        assert call_count == 1

    def test_language_cached_on_success(self) -> None:
        """Successive get_language calls return the same object.

        The Language object is constructed once per parser
        instance. Callers holding a reference to it across calls
        can rely on identity.
        """
        parser = TreeSitterParser()
        lang1 = parser.get_language("python")
        lang2 = parser.get_language("python")
        # If the grammar isn't installed, the whole test is
        # meaningless — skip rather than fail.
        if lang1 is None:
            pytest.skip("tree_sitter_python not installed")
        assert lang1 is lang2

    def test_parser_cached_on_success(self) -> None:
        """Successive get_parser calls return the same object."""
        parser = TreeSitterParser()
        p1 = parser.get_parser("python")
        p2 = parser.get_parser("python")
        if p1 is None:
            pytest.skip("tree_sitter_python not installed")
        assert p1 is p2

    def test_available_languages_empty_before_requests(self) -> None:
        """Fresh parser reports no available languages.

        Lazy-load design — we don't probe any grammar until
        someone asks. available_languages only reports what's
        been touched.
        """
        parser = TreeSitterParser()
        assert parser.available_languages() == []

    def test_available_languages_populated_after_get(self) -> None:
        """After a successful get_language, the name appears."""
        parser = TreeSitterParser()
        lang = parser.get_language("python")
        if lang is None:
            pytest.skip("tree_sitter_python not installed")
        assert "python" in parser.available_languages()

    def test_available_languages_excludes_failed(self) -> None:
        """A failed load doesn't appear in available_languages."""
        parser = TreeSitterParser()
        original_import = importlib.import_module

        def fake_import(name: str, *args, **kwargs):
            if name == "tree_sitter_python":
                raise ImportError("simulated missing")
            return original_import(name, *args, **kwargs)

        with patch("ac_dc.symbol_index.parser.importlib.import_module",
                   side_effect=fake_import):
            parser.get_language("python")

        assert "python" not in parser.available_languages()

    def test_is_available_true_for_installed(self) -> None:
        """is_available returns True for installed grammars."""
        parser = TreeSitterParser()
        if not parser.is_available("python"):
            pytest.skip("tree_sitter_python not installed")
        assert parser.is_available("python") is True

    def test_is_available_false_for_missing(self) -> None:
        """is_available returns False for missing grammars."""
        parser = TreeSitterParser()
        original_import = importlib.import_module

        def fake_import(name: str, *args, **kwargs):
            if name == "tree_sitter_python":
                raise ImportError("simulated missing")
            return original_import(name, *args, **kwargs)

        with patch("ac_dc.symbol_index.parser.importlib.import_module",
                   side_effect=fake_import):
            assert parser.is_available("python") is False


# ---------------------------------------------------------------------------
# Integration — real grammars parse real source
# ---------------------------------------------------------------------------


# Minimal source snippets per language. Each one exercises the
# core node types the language extractor will later need. Kept
# small so a grammar regression produces a clear, localised
# failure.
_SAMPLES: dict[str, bytes] = {
    "python": b"def hello():\n    return 42\n",
    "javascript": b"function hello() { return 42; }\n",
    "typescript": b"function hello(): number { return 42; }\n",
    "c": b"int hello(void) { return 42; }\n",
    "cpp": b"int hello() { return 42; }\n",
}


class TestParseIntegration:
    """End-to-end parse — every installed grammar produces a tree.

    These tests skip when a grammar isn't installed. They don't
    fail: specs4 is explicit that grammars may be selectively
    installed and the indexer tolerates absence gracefully.
    """

    @pytest.mark.parametrize("language", sorted(_SAMPLES.keys()))
    def test_parse_produces_non_error_tree(self, language: str) -> None:
        """Parsing valid source yields a tree with no top-level ERROR.

        A clean parse on well-formed source is the smoke test for
        grammar installation. Tree-sitter will produce a tree for
        almost any input, but an ERROR at the root usually means
        the grammar didn't load correctly.
        """
        parser = TreeSitterParser()
        if not parser.is_available(language):
            pytest.skip(f"tree_sitter_{language} not installed")
        tree = parser.parse(_SAMPLES[language], language)
        assert tree is not None
        # Root node exists and isn't itself an error.
        assert tree.root_node is not None
        assert tree.root_node.type != "ERROR", (
            f"{language} root parsed as ERROR; grammar may be broken"
        )

    def test_parse_returns_none_for_missing_grammar(self) -> None:
        """parse returns None when the target grammar isn't available.

        The orchestrator uses this None return to skip the file
        rather than surfacing an exception to the user. Matches
        the is_available contract.
        """
        parser = TreeSitterParser()
        original_import = importlib.import_module

        def fake_import(name: str, *args, **kwargs):
            if name == "tree_sitter_python":
                raise ImportError("simulated missing")
            return original_import(name, *args, **kwargs)

        with patch("ac_dc.symbol_index.parser.importlib.import_module",
                   side_effect=fake_import):
            tree = parser.parse(b"def foo(): pass\n", "python")
        assert tree is None


class TestParseFile:
    """parse_file — read + dispatch-by-extension convenience."""

    def test_parse_file_dispatches_by_extension(self, tmp_path) -> None:
        """.py file is parsed with the Python grammar."""
        parser = TreeSitterParser()
        if not parser.is_available("python"):
            pytest.skip("tree_sitter_python not installed")
        source = tmp_path / "hello.py"
        source.write_text("def hello():\n    return 42\n")
        tree = parser.parse_file(source)
        assert tree is not None
        assert tree.root_node.type == "module"

    def test_parse_file_unknown_extension_returns_none(
        self, tmp_path
    ) -> None:
        """Unknown extensions return None without reading the file.

        Strictly speaking the current implementation never reads
        the file when the extension is unknown — the language
        check happens first. That's the contract: save the I/O
        on files we couldn't parse anyway.
        """
        parser = TreeSitterParser()
        source = tmp_path / "data.unknown"
        source.write_text("gibberish")
        tree = parser.parse_file(source)
        assert tree is None

    def test_parse_file_missing_file_raises_oserror(
        self, tmp_path
    ) -> None:
        """Missing files raise OSError, not silently return None.

        File-read failures at this layer are caller bugs — the
        orchestrator walks existing files, so a missing file
        means something has gone wrong upstream and we want to
        see it. None-on-missing would mask real bugs.
        """
        parser = TreeSitterParser()
        if not parser.is_available("python"):
            pytest.skip("tree_sitter_python not installed")
        missing = tmp_path / "does_not_exist.py"
        with pytest.raises(OSError):
            parser.parse_file(missing)

    def test_parse_file_accepts_string_path(self, tmp_path) -> None:
        """str paths work, not just Path objects.

        The orchestrator passes both shapes depending on how the
        path arrived — from git ls-files output (str) or from a
        pathlib walk (Path).
        """
        parser = TreeSitterParser()
        if not parser.is_available("python"):
            pytest.skip("tree_sitter_python not installed")
        source = tmp_path / "hello.py"
        source.write_text("x = 1\n")
        tree = parser.parse_file(str(source))
        assert tree is not None


class TestParseEdgeCases:
    """parse() edge cases — empty source, non-UTF-8 bytes."""

    def test_parse_empty_source_returns_tree(self) -> None:
        """Empty bytes parse cleanly — zero-symbol file.

        The orchestrator walks every tracked file including
        empty ones (e.g. ``__init__.py`` placeholders). Parsing
        must not crash on empty input; it produces an empty
        tree that the extractor walks as zero symbols.
        """
        parser = TreeSitterParser()
        if not parser.is_available("python"):
            pytest.skip("tree_sitter_python not installed")
        tree = parser.parse(b"", "python")
        assert tree is not None
        assert tree.root_node is not None

    def test_parse_invalid_utf8_does_not_crash(self) -> None:
        """Bytes that aren't valid UTF-8 still produce a tree.

        Tree-sitter operates on raw bytes — it doesn't decode
        first. A file with a stray 0xFF (lone continuation byte)
        will parse to a tree riddled with ERROR nodes, but the
        parser itself must not raise. The extractor layer
        decides what to do with ERROR-heavy trees.
        """
        parser = TreeSitterParser()
        if not parser.is_available("python"):
            pytest.skip("tree_sitter_python not installed")
        # Valid Python prefix plus an invalid UTF-8 tail.
        source = b"x = 1\n\xff\xfe\xfd\n"
        tree = parser.parse(source, "python")
        assert tree is not None
        assert tree.root_node is not None

    def test_parse_unknown_language_returns_none(self) -> None:
        """parse() with a bogus language name returns None."""
        parser = TreeSitterParser()
        tree = parser.parse(b"whatever", "klingon")
        assert tree is None