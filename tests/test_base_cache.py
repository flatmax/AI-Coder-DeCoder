"""Tests for ac_dc.base_cache — Layer 2.3.

Scope: BaseCache — mtime-based get/put/invalidate, signature hash
accessor, path normalisation, subclass hook invocation.

BaseCache is generic over the cached-value type. Tests use a
minimal ``str``-valued subclass (``_Cache``) so we exercise the
real code path without dragging in FileSymbols. A second subclass
(``_PersistingCache``) records persistence-hook invocations so
the hook contract is independently testable — without it, the
contract (subclasses get to decorate entries and persist them)
would only be verified once SymbolCache / DocCache land.
"""

from __future__ import annotations

from typing import Any

from ac_dc.base_cache import BaseCache


class _Cache(BaseCache[str]):
    """Minimal string-valued cache. Exercises the base API only."""

    pass


class _HashingCache(BaseCache[str]):
    """Cache that hashes the value itself as its signature.

    Lets us test that put() invokes _compute_signature_hash and
    get_signature_hash surfaces the result. The default base
    implementation returns empty string, so without an override
    we couldn't tell computed-empty from never-computed.
    """

    def _compute_signature_hash(self, value: str) -> str:
        return f"sig-{value}"


class _PersistingCache(BaseCache[str]):
    """Cache that records every hook invocation.

    Lets us test that put/invalidate/clear call through to the
    persistence hooks with the right arguments, without needing
    a real filesystem.
    """

    def __init__(self) -> None:
        super().__init__()
        self.persisted: list[tuple[str, dict[str, Any]]] = []
        self.removed: list[str] = []
        self.cleared: int = 0

    def _persist(self, key: str, entry: dict[str, Any]) -> None:
        # Snapshot the entry dict — the base class mutates it
        # between calls, so a shallow reference would all end up
        # pointing at the last-put state.
        self.persisted.append((key, dict(entry)))

    def _remove_persisted(self, key: str) -> None:
        self.removed.append(key)

    def _clear_persisted(self) -> None:
        self.cleared += 1

    def _decorate_entry(
        self,
        entry: dict[str, Any],
        path,
        value: str,
    ) -> None:
        # Record the decoration so tests can assert the hook fires
        # before _persist, not after.
        entry["decorated_by"] = str(path)


# ---------------------------------------------------------------------------
# Path normalisation
# ---------------------------------------------------------------------------


class TestNormalisation:
    """_normalise_path canonicalises the key so lookups collide."""

    def test_strips_leading_slash(self) -> None:
        """A leading slash doesn't produce a different key.

        Matches the Repo layer's convention — absolute-looking
        inputs collapse to their relative form.
        """
        assert _Cache._normalise_path("/src/main.py") == "src/main.py"

    def test_strips_trailing_slash(self) -> None:
        """Trailing slash is dropped for directory-like inputs."""
        assert _Cache._normalise_path("src/") == "src"

    def test_converts_backslashes(self) -> None:
        """Windows-style separators collapse to forward slashes.

        Same rule as Repo._normalise_rel_path so a path from
        either layer produces the same cache key.
        """
        assert _Cache._normalise_path("src\\main.py") == "src/main.py"

    def test_accepts_pathlib(self) -> None:
        """PathLike inputs normalise without special-case branches."""
        from pathlib import PurePosixPath

        assert (
            _Cache._normalise_path(PurePosixPath("src/main.py"))
            == "src/main.py"
        )


# ---------------------------------------------------------------------------
# get / put round-trip
# ---------------------------------------------------------------------------


class TestGetPut:
    """Core mtime-based get/put contract."""

    def test_put_then_get_matching_mtime(self) -> None:
        """A put followed by get with the same mtime returns the value."""
        cache: _Cache = _Cache()
        cache.put("a.py", 123.0, "hello")
        assert cache.get("a.py", 123.0) == "hello"

    def test_get_miss_when_absent(self) -> None:
        """Unknown path returns None, not an error."""
        cache: _Cache = _Cache()
        assert cache.get("nope.py", 0.0) is None

    def test_get_miss_on_mtime_mismatch(self) -> None:
        """Stale mtime returns None — invalidates transparently."""
        cache: _Cache = _Cache()
        cache.put("a.py", 123.0, "v1")
        assert cache.get("a.py", 456.0) is None

    def test_get_with_none_mtime_is_miss(self) -> None:
        """Caller that couldn't stat the file gets a clean miss.

        Defends against a stat failure silently serving stale data
        — if the caller doesn't know the mtime, we can't verify
        freshness, so we refuse to return anything.
        """
        cache: _Cache = _Cache()
        cache.put("a.py", 123.0, "v1")
        assert cache.get("a.py", None) is None

    def test_stale_entry_survives_mismatch(self) -> None:
        """A mismatched get doesn't evict — preserves the entry
        for the next put to overwrite cleanly.

        Eviction-on-miss would let a rapid check-then-stat race
        drop the entry temporarily. The contract is "get tells
        you whether the cache is valid right now"; eviction is
        put's job.
        """
        cache: _Cache = _Cache()
        cache.put("a.py", 123.0, "v1")
        assert cache.get("a.py", 999.0) is None
        # Entry still present, so a retry with the right mtime works.
        assert cache.get("a.py", 123.0) == "v1"

    def test_put_overwrites_existing(self) -> None:
        """Putting the same path twice replaces the old value."""
        cache: _Cache = _Cache()
        cache.put("a.py", 1.0, "old")
        cache.put("a.py", 2.0, "new")
        assert cache.get("a.py", 2.0) == "new"
        # Old mtime no longer matches.
        assert cache.get("a.py", 1.0) is None

    def test_different_paths_do_not_collide(self) -> None:
        """Two files with the same mtime live in separate slots."""
        cache: _Cache = _Cache()
        cache.put("a.py", 5.0, "A")
        cache.put("b.py", 5.0, "B")
        assert cache.get("a.py", 5.0) == "A"
        assert cache.get("b.py", 5.0) == "B"

    def test_equivalent_paths_share_slot(self) -> None:
        """Paths that normalise to the same key share one entry.

        Exercises the contract that normalisation happens inside
        the API, so callers needn't canonicalise themselves.
        """
        cache: _Cache = _Cache()
        cache.put("/src/main.py", 1.0, "hi")
        assert cache.get("src\\main.py", 1.0) == "hi"


# ---------------------------------------------------------------------------
# invalidate / clear
# ---------------------------------------------------------------------------


class TestInvalidation:
    """Removal operations."""

    def test_invalidate_removes_entry(self) -> None:
        """Entry is gone after invalidate; get returns None."""
        cache: _Cache = _Cache()
        cache.put("a.py", 1.0, "hi")
        assert cache.invalidate("a.py") is True
        assert cache.get("a.py", 1.0) is None

    def test_invalidate_absent_returns_false(self) -> None:
        """Invalidating a non-existent path is a silent no-op.

        Callers use the return value to log "we cleaned up N
        entries"; raising on missing would force wrapping every
        call in try/except.
        """
        cache: _Cache = _Cache()
        assert cache.invalidate("nope.py") is False

    def test_invalidate_normalises_path(self) -> None:
        """Stored and invalidated paths match after normalisation."""
        cache: _Cache = _Cache()
        cache.put("src/main.py", 1.0, "hi")
        assert cache.invalidate("/src/main.py") is True
        assert cache.has("src/main.py") is False

    def test_clear_removes_all(self) -> None:
        """Clear empties the cache; all subsequent gets miss."""
        cache: _Cache = _Cache()
        cache.put("a.py", 1.0, "A")
        cache.put("b.py", 2.0, "B")
        cache.clear()
        assert cache.get("a.py", 1.0) is None
        assert cache.get("b.py", 2.0) is None
        assert cache.cached_paths == set()

    def test_clear_on_empty_is_safe(self) -> None:
        """Clearing an already-empty cache doesn't raise."""
        cache: _Cache = _Cache()
        cache.clear()
        assert cache.cached_paths == set()


# ---------------------------------------------------------------------------
# Introspection
# ---------------------------------------------------------------------------


class TestIntrospection:
    """cached_paths, has, get_signature_hash."""

    def test_cached_paths_returns_all_keys(self) -> None:
        """cached_paths is the set of normalised paths in the cache."""
        cache: _Cache = _Cache()
        cache.put("a.py", 1.0, "A")
        cache.put("b.py", 2.0, "B")
        assert cache.cached_paths == {"a.py", "b.py"}

    def test_cached_paths_returns_copy(self) -> None:
        """Mutating the returned set doesn't affect the cache.

        Defends against callers who treat it as a view — returning
        the live dict keys would let an outer ``.clear()`` wipe
        the cache silently.
        """
        cache: _Cache = _Cache()
        cache.put("a.py", 1.0, "A")
        paths = cache.cached_paths
        paths.add("fake.py")
        assert cache.cached_paths == {"a.py"}

    def test_cached_paths_empty_initially(self) -> None:
        """Fresh cache has no paths."""
        cache: _Cache = _Cache()
        assert cache.cached_paths == set()

    def test_has_true_for_present(self) -> None:
        """has returns True for any tracked path."""
        cache: _Cache = _Cache()
        cache.put("a.py", 1.0, "A")
        assert cache.has("a.py") is True

    def test_has_ignores_mtime(self) -> None:
        """has returns True even if the entry is stale.

        has is the "is this path tracked at all" probe — distinct
        from get which checks freshness. The orchestrator uses
        has for stale-removal diffing against the repo file list.
        """
        cache: _Cache = _Cache()
        cache.put("a.py", 1.0, "A")
        # Mtime doesn't matter — entry exists.
        assert cache.has("a.py") is True

    def test_has_false_for_absent(self) -> None:
        """has returns False for untracked paths."""
        cache: _Cache = _Cache()
        assert cache.has("nope.py") is False

    def test_has_normalises_path(self) -> None:
        """has applies the same path normalisation as put/get."""
        cache: _Cache = _Cache()
        cache.put("src/main.py", 1.0, "hi")
        assert cache.has("/src/main.py") is True
        assert cache.has("src\\main.py") is True


# ---------------------------------------------------------------------------
# Signature hash
# ---------------------------------------------------------------------------


class TestSignatureHash:
    """_compute_signature_hash is invoked on put; exposed via accessor."""

    def test_default_hash_is_empty(self) -> None:
        """Base class default hash is the empty string.

        Subclasses that don't need stability tracking can rely on
        the default. The stability tracker treats this as "no
        signal" and falls back to content hashing.
        """
        cache: _Cache = _Cache()
        cache.put("a.py", 1.0, "hello")
        assert cache.get_signature_hash("a.py") == ""

    def test_subclass_hash_surfaces_on_accessor(self) -> None:
        """Overridden hash computed on put, readable afterwards."""
        cache: _HashingCache = _HashingCache()
        cache.put("a.py", 1.0, "hello")
        assert cache.get_signature_hash("a.py") == "sig-hello"

    def test_hash_updates_on_overwrite(self) -> None:
        """Re-putting with a different value recomputes the hash."""
        cache: _HashingCache = _HashingCache()
        cache.put("a.py", 1.0, "v1")
        assert cache.get_signature_hash("a.py") == "sig-v1"
        cache.put("a.py", 2.0, "v2")
        assert cache.get_signature_hash("a.py") == "sig-v2"

    def test_hash_returns_none_for_absent(self) -> None:
        """Missing path returns None — not empty string.

        Callers must distinguish "no entry" from "entry with empty
        hash" (which is the default-subclass case). None is the
        unambiguous signal.
        """
        cache: _HashingCache = _HashingCache()
        assert cache.get_signature_hash("nope.py") is None

    def test_hash_returns_none_after_invalidate(self) -> None:
        """Invalidated entries have no hash."""
        cache: _HashingCache = _HashingCache()
        cache.put("a.py", 1.0, "hi")
        cache.invalidate("a.py")
        assert cache.get_signature_hash("a.py") is None

    def test_hash_normalises_path(self) -> None:
        """Hash lookup normalises the key the same way as put."""
        cache: _HashingCache = _HashingCache()
        cache.put("src/main.py", 1.0, "hi")
        assert cache.get_signature_hash("/src/main.py") == "sig-hi"


# ---------------------------------------------------------------------------
# Persistence hook contract
# ---------------------------------------------------------------------------


class TestPersistenceHooks:
    """Subclasses that persist see put/invalidate/clear reliably."""

    def test_put_calls_persist_with_normalised_key(self) -> None:
        """_persist receives the normalised path, not raw input.

        Ensures disk sidecars use canonical filenames, so
        forward-vs-back slash variants don't produce two sidecars
        for one logical file.
        """
        cache = _PersistingCache()
        cache.put("/src/main.py", 1.0, "hi")
        assert len(cache.persisted) == 1
        key, entry = cache.persisted[0]
        assert key == "src/main.py"
        assert entry["value"] == "hi"
        assert entry["mtime"] == 1.0

    def test_put_calls_decorate_before_persist(self) -> None:
        """_decorate_entry fires before _persist sees the dict.

        Subclasses that add extra fields (doc cache's
        keyword_model) expect those fields to be in the persisted
        payload — _persist should never see an undecorated entry.
        """
        cache = _PersistingCache()
        cache.put("a.py", 1.0, "hi")
        # _PersistingCache._decorate_entry adds "decorated_by".
        # If _persist fired before _decorate_entry, the snapshot
        # wouldn't have it.
        _, entry = cache.persisted[0]
        assert entry.get("decorated_by") == "a.py"

    def test_invalidate_calls_remove_persisted(self) -> None:
        """_remove_persisted fires with the normalised key."""
        cache = _PersistingCache()
        cache.put("a.py", 1.0, "hi")
        cache.invalidate("a.py")
        assert cache.removed == ["a.py"]

    def test_invalidate_absent_still_calls_remove(self) -> None:
        """Hook fires even for non-existent entries.

        The base class doesn't know whether the subclass's disk
        store has the file — maybe an earlier crash left an
        orphan sidecar. Calling unconditionally lets the subclass
        clean up aggressively.
        """
        cache = _PersistingCache()
        cache.invalidate("nope.py")
        assert cache.removed == ["nope.py"]

    def test_clear_calls_clear_persisted_once(self) -> None:
        """_clear_persisted fires exactly once per clear call."""
        cache = _PersistingCache()
        cache.put("a.py", 1.0, "A")
        cache.put("b.py", 2.0, "B")
        cache.clear()
        assert cache.cleared == 1

    def test_persist_oserror_is_caught(self) -> None:
        """OSError from _persist doesn't propagate to the caller.

        The in-memory cache must remain correct even when disk
        writes fail. The failed entry is still readable via get
        — it just won't survive a restart.
        """

        class _BrokenPersist(BaseCache[str]):
            def _persist(self, key: str, entry: dict[str, Any]) -> None:
                raise OSError("disk full")

        cache: _BrokenPersist = _BrokenPersist()
        cache.put("a.py", 1.0, "hi")  # must not raise
        # In-memory state is authoritative.
        assert cache.get("a.py", 1.0) == "hi"

    def test_remove_persisted_oserror_is_caught(self) -> None:
        """OSError from _remove_persisted doesn't propagate."""

        class _BrokenRemove(BaseCache[str]):
            def _remove_persisted(self, key: str) -> None:
                raise OSError("permission denied")

        cache: _BrokenRemove = _BrokenRemove()
        cache.put("a.py", 1.0, "hi")
        # Must not raise; in-memory removal still succeeds.
        assert cache.invalidate("a.py") is True
        assert cache.get("a.py", 1.0) is None

    def test_clear_persisted_oserror_is_caught(self) -> None:
        """OSError from _clear_persisted doesn't propagate."""

        class _BrokenClear(BaseCache[str]):
            def _clear_persisted(self) -> None:
                raise OSError("disk unavailable")

        cache: _BrokenClear = _BrokenClear()
        cache.put("a.py", 1.0, "hi")
        cache.clear()  # must not raise
        # In-memory is cleared even though disk wasn't.
        assert cache.cached_paths == set()