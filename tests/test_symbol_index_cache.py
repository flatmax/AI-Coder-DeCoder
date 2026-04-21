"""Tests for ac_dc.symbol_index.cache — Layer 2.3.

Scope: the SymbolCache signature-hash logic. Most behaviour
(get/put/invalidate/clear/has/cached_paths) is inherited from
BaseCache and covered in test_base_cache.py. Here we focus on
what SymbolCache actually implements:

- Signature hashing over FileSymbols structure
- Deterministic, same-input-same-output hashing
- Structural sensitivity (names, kinds, params, bases, children)
- Structural insensitivity (ranges, call sites, file paths)
- The cached_files alias
- Round-trip storage and retrieval of real FileSymbols objects
"""

from __future__ import annotations

from ac_dc.symbol_index.cache import SymbolCache
from ac_dc.symbol_index.models import (
    CallSite,
    FileSymbols,
    Import,
    Parameter,
    Symbol,
)


def _make_simple_file(name: str = "foo") -> FileSymbols:
    """Build a minimal FileSymbols for hashing/round-trip tests.

    One function, one import, no children. Easy to perturb in
    individual test cases without boilerplate.
    """
    return FileSymbols(
        file_path="src/mod.py",
        symbols=[
            Symbol(
                name=name,
                kind="function",
                file_path="src/mod.py",
                range=(0, 0, 2, 0),
                parameters=[Parameter(name="x")],
            ),
        ],
        imports=[Import(module="os", line=1)],
    )


# ---------------------------------------------------------------------------
# Round-trip storage
# ---------------------------------------------------------------------------


class TestRoundTrip:
    """FileSymbols can be stored and retrieved unchanged."""

    def test_put_then_get_returns_same_instance(self) -> None:
        """The cache stores references, not copies — cheap and fine.

        Callers don't mutate FileSymbols after caching; the
        extractor produces fresh instances on each parse.
        """
        cache = SymbolCache()
        fs = _make_simple_file()
        cache.put("src/mod.py", 1.0, fs)
        assert cache.get("src/mod.py", 1.0) is fs

    def test_multiple_files_stored_independently(self) -> None:
        """Different paths produce independent cache entries."""
        cache = SymbolCache()
        fs_a = _make_simple_file(name="a")
        fs_b = _make_simple_file(name="b")
        cache.put("a.py", 1.0, fs_a)
        cache.put("b.py", 2.0, fs_b)
        got_a = cache.get("a.py", 1.0)
        got_b = cache.get("b.py", 2.0)
        assert got_a is fs_a
        assert got_b is fs_b

    def test_empty_file_symbols_round_trip(self) -> None:
        """An empty FileSymbols (placeholder __init__.py) caches cleanly."""
        cache = SymbolCache()
        fs = FileSymbols(file_path="empty.py")
        cache.put("empty.py", 1.0, fs)
        assert cache.get("empty.py", 1.0) is fs


# ---------------------------------------------------------------------------
# Signature hash — shape and determinism
# ---------------------------------------------------------------------------


class TestHashShape:
    """The hash is a well-formed SHA-256 hex digest."""

    def test_hash_is_64_hex_chars(self) -> None:
        """SHA-256 produces a 64-character lowercase hex string."""
        cache = SymbolCache()
        cache.put("a.py", 1.0, _make_simple_file())
        h = cache.get_signature_hash("a.py")
        assert h is not None
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_hash_deterministic_across_instances(self) -> None:
        """Same FileSymbols → same hash, even across fresh caches.

        The stability tracker compares hashes between sessions;
        run-to-run determinism is the whole point.
        """
        fs = _make_simple_file()
        c1 = SymbolCache()
        c2 = SymbolCache()
        c1.put("a.py", 1.0, fs)
        c2.put("a.py", 1.0, fs)
        assert c1.get_signature_hash("a.py") == c2.get_signature_hash("a.py")

    def test_empty_file_symbols_has_hash(self) -> None:
        """Empty FileSymbols still produces a deterministic hash.

        The hash of empty input is the SHA-256 of an empty
        bytestring — a well-known constant. The stability tracker
        will treat two empty files as "same signature" which is
        correct.
        """
        cache = SymbolCache()
        cache.put("empty.py", 1.0, FileSymbols(file_path="empty.py"))
        h = cache.get_signature_hash("empty.py")
        assert h is not None
        assert len(h) == 64


# ---------------------------------------------------------------------------
# Signature hash — structural sensitivity
# ---------------------------------------------------------------------------


class TestHashSensitivity:
    """Hash changes for structural differences that matter."""

    def _hash_of(self, fs: FileSymbols) -> str:
        """Helper — fresh cache, put, read hash."""
        cache = SymbolCache()
        cache.put("a.py", 1.0, fs)
        h = cache.get_signature_hash("a.py")
        assert h is not None
        return h

    def test_renaming_a_symbol_changes_hash(self) -> None:
        """A function rename is a structural change."""
        h1 = self._hash_of(_make_simple_file(name="foo"))
        h2 = self._hash_of(_make_simple_file(name="bar"))
        assert h1 != h2

    def test_changing_kind_changes_hash(self) -> None:
        """Promoting a method to a function is structural.

        Two symbols with the same name but different kinds
        should hash distinctly — otherwise a refactor that
        turns a helper function into a method wouldn't appear
        to change the file's shape.
        """
        fs_func = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="foo", kind="function", file_path="a.py",
            )],
        )
        fs_method = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="foo", kind="method", file_path="a.py",
            )],
        )
        assert self._hash_of(fs_func) != self._hash_of(fs_method)

    def test_adding_a_parameter_changes_hash(self) -> None:
        """Signature changes are structural."""
        fs1 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="f", kind="function", file_path="a.py",
                parameters=[Parameter(name="x")],
            )],
        )
        fs2 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="f", kind="function", file_path="a.py",
                parameters=[Parameter(name="x"), Parameter(name="y")],
            )],
        )
        assert self._hash_of(fs1) != self._hash_of(fs2)

    def test_changing_parameter_type_changes_hash(self) -> None:
        """Adding a type annotation is a structural change."""
        fs1 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="f", kind="function", file_path="a.py",
                parameters=[Parameter(name="x")],
            )],
        )
        fs2 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="f", kind="function", file_path="a.py",
                parameters=[Parameter(name="x", type_annotation="int")],
            )],
        )
        assert self._hash_of(fs1) != self._hash_of(fs2)

    def test_changing_vararg_flag_changes_hash(self) -> None:
        """``*args`` and plain ``args`` hash differently."""
        fs1 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="f", kind="function", file_path="a.py",
                parameters=[Parameter(name="args")],
            )],
        )
        fs2 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="f", kind="function", file_path="a.py",
                parameters=[Parameter(name="args", is_vararg=True)],
            )],
        )
        assert self._hash_of(fs1) != self._hash_of(fs2)

    def test_changing_bases_changes_hash(self) -> None:
        """Class inheritance is part of the structural signature."""
        fs1 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(name="C", kind="class", file_path="a.py")],
        )
        fs2 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="C", kind="class", file_path="a.py",
                bases=["Base"],
            )],
        )
        assert self._hash_of(fs1) != self._hash_of(fs2)

    def test_changing_return_type_changes_hash(self) -> None:
        """Return-type annotation contributes to the signature."""
        fs1 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="f", kind="function", file_path="a.py",
            )],
        )
        fs2 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="f", kind="function", file_path="a.py",
                return_type="int",
            )],
        )
        assert self._hash_of(fs1) != self._hash_of(fs2)

    def test_changing_async_flag_changes_hash(self) -> None:
        """sync vs async is a structural distinction."""
        fs1 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="f", kind="function", file_path="a.py",
            )],
        )
        fs2 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="f", kind="function", file_path="a.py",
                is_async=True,
            )],
        )
        assert self._hash_of(fs1) != self._hash_of(fs2)

    def test_adding_child_changes_hash(self) -> None:
        """Nested structure (methods on a class) counts.

        A class gaining a method is a structural change the
        stability tracker must see. Without this, refactors that
        split one method into several wouldn't demote the class.
        """
        fs1 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(name="C", kind="class", file_path="a.py")],
        )
        fs2 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="C", kind="class", file_path="a.py",
                children=[Symbol(
                    name="m", kind="method", file_path="a.py",
                )],
            )],
        )
        assert self._hash_of(fs1) != self._hash_of(fs2)

    def test_changing_instance_vars_changes_hash(self) -> None:
        """Instance variables on a class are part of the signature."""
        fs1 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(name="C", kind="class", file_path="a.py")],
        )
        fs2 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="C", kind="class", file_path="a.py",
                instance_vars=["x", "y"],
            )],
        )
        assert self._hash_of(fs1) != self._hash_of(fs2)

    def test_adding_import_changes_hash(self) -> None:
        """Imports are part of the structural topology."""
        fs1 = FileSymbols(file_path="a.py")
        fs2 = FileSymbols(
            file_path="a.py",
            imports=[Import(module="os", line=1)],
        )
        assert self._hash_of(fs1) != self._hash_of(fs2)

    def test_changing_import_module_changes_hash(self) -> None:
        """Replacing an import with a different module is structural."""
        fs1 = FileSymbols(
            file_path="a.py",
            imports=[Import(module="os", line=1)],
        )
        fs2 = FileSymbols(
            file_path="a.py",
            imports=[Import(module="sys", line=1)],
        )
        assert self._hash_of(fs1) != self._hash_of(fs2)

    def test_reordering_symbols_changes_hash(self) -> None:
        """Source order is part of the signature.

        The compact map output is order-sensitive (stable diffs
        matter), so the hash must reflect order too. Otherwise
        a file that shuffles two top-level functions would hash
        identically but render differently in the symbol map.
        """
        sym_a = Symbol(name="a", kind="function", file_path="f.py")
        sym_b = Symbol(name="b", kind="function", file_path="f.py")
        fs1 = FileSymbols(file_path="f.py", symbols=[sym_a, sym_b])
        fs2 = FileSymbols(file_path="f.py", symbols=[sym_b, sym_a])
        assert self._hash_of(fs1) != self._hash_of(fs2)


# ---------------------------------------------------------------------------
# Signature hash — structural insensitivity
# ---------------------------------------------------------------------------


class TestHashInsensitivity:
    """Hash is stable across changes the tracker shouldn't care about."""

    def _hash_of(self, fs: FileSymbols) -> str:
        cache = SymbolCache()
        cache.put("a.py", 1.0, fs)
        h = cache.get_signature_hash("a.py")
        assert h is not None
        return h

    def test_range_changes_do_not_affect_hash(self) -> None:
        """Moving a symbol to a different line doesn't change the hash.

        An unrelated edit earlier in the file shifts every
        following symbol's line number. The tracker would
        demote the whole file every time if ranges were in
        the signature.
        """
        fs1 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="f", kind="function", file_path="a.py",
                range=(0, 0, 5, 0),
            )],
        )
        fs2 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="f", kind="function", file_path="a.py",
                range=(10, 0, 15, 0),
            )],
        )
        assert self._hash_of(fs1) == self._hash_of(fs2)

    def test_call_sites_do_not_affect_hash(self) -> None:
        """Body-level call sites are excluded from the signature.

        A refactor that moves a call site within a function
        body shouldn't trip stability tracking — the public
        surface is unchanged.
        """
        fs1 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="f", kind="function", file_path="a.py",
            )],
        )
        fs2 = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(
                name="f", kind="function", file_path="a.py",
                call_sites=[CallSite(name="helper", line=5)],
            )],
        )
        assert self._hash_of(fs1) == self._hash_of(fs2)

    def test_import_line_does_not_affect_hash(self) -> None:
        """Reordering imports without changing modules is invisible.

        An auto-importer that reorders imports alphabetically
        shifts every import's line number. The set of imports
        is unchanged; the hash should be too.
        """
        fs1 = FileSymbols(
            file_path="a.py",
            imports=[Import(module="os", line=1)],
        )
        fs2 = FileSymbols(
            file_path="a.py",
            imports=[Import(module="os", line=5)],
        )
        assert self._hash_of(fs1) == self._hash_of(fs2)

    def test_import_alias_does_not_affect_hash(self) -> None:
        """Adding an alias to an existing import is invisible.

        ``import numpy`` and ``import numpy as np`` reference the
        same module. The aliased name is a local binding detail
        that doesn't change the file's dependency topology.
        """
        fs1 = FileSymbols(
            file_path="a.py",
            imports=[Import(module="numpy", line=1)],
        )
        fs2 = FileSymbols(
            file_path="a.py",
            imports=[Import(module="numpy", alias="np", line=1)],
        )
        assert self._hash_of(fs1) == self._hash_of(fs2)


# ---------------------------------------------------------------------------
# cached_files alias
# ---------------------------------------------------------------------------


class TestCachedFilesAlias:
    """``cached_files`` reads the same set as ``cached_paths``."""

    def test_alias_returns_same_content(self) -> None:
        """The two accessors produce equal sets of paths.

        The alias exists for readability — symbol-index code
        reads more naturally with ``cache.cached_files`` when
        the values are specifically source files. The behaviour
        is identical to the base class's ``cached_paths``.
        """
        cache = SymbolCache()
        cache.put("a.py", 1.0, _make_simple_file(name="a"))
        cache.put("b.py", 2.0, _make_simple_file(name="b"))
        assert cache.cached_files == cache.cached_paths
        assert cache.cached_files == {"a.py", "b.py"}

    def test_alias_empty_initially(self) -> None:
        """Fresh cache reports no cached files."""
        cache = SymbolCache()
        assert cache.cached_files == set()

    def test_alias_returns_copy(self) -> None:
        """Mutating the result doesn't affect the cache.

        Same defensive contract as ``cached_paths`` — callers
        that treat it as a view would otherwise be able to wipe
        the cache by clearing the returned set.
        """
        cache = SymbolCache()
        cache.put("a.py", 1.0, _make_simple_file())
        files = cache.cached_files
        files.add("fake.py")
        assert cache.cached_files == {"a.py"}