"""Tests for :class:`DocCache` — Layer 2.8.1c.

Covers the mtime cache contract inherited from :class:`BaseCache`
plus the disk-persistence and keyword-model semantics specific to
DocCache. Uses real filesystem via ``tmp_path`` — no mock for the
disk layer because the sidecar format is the authoritative wire
contract and mock-based tests would miss round-trip fidelity
issues.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ac_dc.doc_index.cache import DocCache, _SIDECAR_VERSION
from ac_dc.doc_index.models import (
    DocHeading,
    DocLink,
    DocOutline,
    DocProseBlock,
    DocSectionRef,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def repo_root(tmp_path: Path) -> Path:
    """Repo root with a prepared .ac-dc directory."""
    root = tmp_path / "repo"
    root.mkdir()
    return root


@pytest.fixture
def cache(repo_root: Path) -> DocCache:
    """Cache instance with disk persistence enabled."""
    return DocCache(repo_root)


@pytest.fixture
def memory_cache() -> DocCache:
    """Cache instance without disk persistence."""
    return DocCache(repo_root=None)


def _make_outline(path: str = "doc.md") -> DocOutline:
    """Build a minimal-but-representative outline for round-trip tests."""
    inner = DocHeading(
        text="Child",
        level=2,
        start_line=5,
        section_lines=10,
        keywords=["sub", "detail"],
        content_types=["code"],
    )
    inner.outgoing_refs.append(
        DocSectionRef(
            target_path="other.md",
            target_heading="Section",
        )
    )
    top = DocHeading(
        text="Top",
        level=1,
        start_line=1,
        section_lines=20,
        keywords=["intro", "overview"],
        content_types=["table"],
        incoming_ref_count=3,
    )
    top.children.append(inner)
    return DocOutline(
        file_path=path,
        doc_type="spec",
        headings=[top],
        links=[
            DocLink(
                target="ref.md",
                line=8,
                source_heading="Top",
                is_image=False,
            ),
            DocLink(
                target="diagram.svg",
                line=12,
                source_heading="Child",
                is_image=True,
            ),
        ],
        prose_blocks=[
            DocProseBlock(
                text="A long prose paragraph for enrichment.",
                container_heading_id="Top",
                start_line=3,
                keywords=["prose", "example"],
            ),
        ],
    )


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestConstruction:
    def test_with_repo_root(self, repo_root: Path) -> None:
        cache = DocCache(repo_root)
        assert cache._repo_root == repo_root

    def test_with_repo_root_as_string(self, repo_root: Path) -> None:
        # Strings coerced to Path for uniformity.
        cache = DocCache(str(repo_root))
        assert cache._repo_root == repo_root

    def test_without_repo_root(self) -> None:
        cache = DocCache(repo_root=None)
        assert cache._repo_root is None

    def test_default_argument(self) -> None:
        # Calling DocCache() with no args is pure in-memory.
        cache = DocCache()
        assert cache._repo_root is None

    def test_load_all_with_no_sidecar_dir(
        self, repo_root: Path
    ) -> None:
        # Fresh repo with no .ac-dc/doc_cache — construction
        # should succeed and load nothing.
        cache = DocCache(repo_root)
        assert cache.cached_paths == set()

    def test_sidecar_directory_created_on_first_put(
        self, cache: DocCache, repo_root: Path
    ) -> None:
        # Put triggers directory creation; we don't pre-create it.
        sidecar_dir = repo_root / ".ac-dc" / "doc_cache"
        assert not sidecar_dir.exists()
        cache.put("doc.md", 123.0, _make_outline())
        assert sidecar_dir.is_dir()


# ---------------------------------------------------------------------------
# In-memory contract (inherited from BaseCache)
# ---------------------------------------------------------------------------


class TestMemoryContract:
    def test_get_miss_when_empty(self, memory_cache: DocCache) -> None:
        assert memory_cache.get("doc.md", 123.0) is None

    def test_put_then_get_round_trip(
        self, memory_cache: DocCache
    ) -> None:
        outline = _make_outline()
        memory_cache.put("doc.md", 123.0, outline)
        retrieved = memory_cache.get("doc.md", 123.0)
        # Same object — no unnecessary deserialisation for
        # in-memory hits.
        assert retrieved is outline

    def test_get_miss_on_mtime_mismatch(
        self, memory_cache: DocCache
    ) -> None:
        memory_cache.put("doc.md", 123.0, _make_outline())
        assert memory_cache.get("doc.md", 124.0) is None

    def test_get_miss_on_mtime_none(
        self, memory_cache: DocCache
    ) -> None:
        memory_cache.put("doc.md", 123.0, _make_outline())
        assert memory_cache.get("doc.md", None) is None

    def test_stale_entry_survives_mismatch(
        self, memory_cache: DocCache
    ) -> None:
        # Mtime mismatch is a miss but doesn't evict — the next
        # put will overwrite.
        outline = _make_outline()
        memory_cache.put("doc.md", 123.0, outline)
        assert memory_cache.get("doc.md", 124.0) is None
        # Entry still there at the original mtime.
        assert memory_cache.get("doc.md", 123.0) is outline

    def test_put_overwrites_existing(
        self, memory_cache: DocCache
    ) -> None:
        first = _make_outline("doc.md")
        second = _make_outline("doc.md")
        second.doc_type = "guide"
        memory_cache.put("doc.md", 123.0, first)
        memory_cache.put("doc.md", 124.0, second)
        retrieved = memory_cache.get("doc.md", 124.0)
        assert retrieved.doc_type == "guide"

    def test_different_paths_independent(
        self, memory_cache: DocCache
    ) -> None:
        memory_cache.put("a.md", 1.0, _make_outline("a.md"))
        memory_cache.put("b.md", 2.0, _make_outline("b.md"))
        assert memory_cache.get("a.md", 1.0) is not None
        assert memory_cache.get("b.md", 2.0) is not None

    def test_invalidate_removes_entry(
        self, memory_cache: DocCache
    ) -> None:
        memory_cache.put("doc.md", 123.0, _make_outline())
        assert memory_cache.invalidate("doc.md") is True
        assert memory_cache.get("doc.md", 123.0) is None

    def test_invalidate_absent_returns_false(
        self, memory_cache: DocCache
    ) -> None:
        assert memory_cache.invalidate("never-put.md") is False

    def test_clear_removes_all(
        self, memory_cache: DocCache
    ) -> None:
        memory_cache.put("a.md", 1.0, _make_outline("a.md"))
        memory_cache.put("b.md", 2.0, _make_outline("b.md"))
        memory_cache.clear()
        assert memory_cache.cached_paths == set()

    def test_path_normalisation(
        self, memory_cache: DocCache
    ) -> None:
        # Equivalent paths collide on the same key.
        memory_cache.put("foo/bar.md", 1.0, _make_outline())
        assert memory_cache.get("/foo/bar.md", 1.0) is not None
        assert memory_cache.get("foo/bar.md/", 1.0) is not None
        assert memory_cache.get("foo\\bar.md", 1.0) is not None


# ---------------------------------------------------------------------------
# Keyword-model matching
# ---------------------------------------------------------------------------


class TestKeywordModel:
    def test_put_without_model_stores_none(
        self, memory_cache: DocCache
    ) -> None:
        memory_cache.put("doc.md", 1.0, _make_outline())
        entry = memory_cache._entries["doc.md"]
        assert entry["keyword_model"] is None

    def test_put_with_model_stores_it(
        self, memory_cache: DocCache
    ) -> None:
        memory_cache.put(
            "doc.md", 1.0, _make_outline(),
            keyword_model="bge-small-en-v1.5",
        )
        entry = memory_cache._entries["doc.md"]
        assert entry["keyword_model"] == "bge-small-en-v1.5"

    def test_get_without_model_accepts_any_entry(
        self, memory_cache: DocCache
    ) -> None:
        # Structure-only lookup — used by mode switch.
        memory_cache.put(
            "doc.md", 1.0, _make_outline(),
            keyword_model="some-model",
        )
        # None model arg — don't care about enrichment.
        result = memory_cache.get("doc.md", 1.0, keyword_model=None)
        assert result is not None

    def test_get_without_model_accepts_unenriched(
        self, memory_cache: DocCache
    ) -> None:
        # Unenriched entry (model=None on put) also matches
        # None lookup.
        memory_cache.put("doc.md", 1.0, _make_outline())
        assert memory_cache.get(
            "doc.md", 1.0, keyword_model=None
        ) is not None

    def test_get_with_model_requires_match(
        self, memory_cache: DocCache
    ) -> None:
        memory_cache.put(
            "doc.md", 1.0, _make_outline(),
            keyword_model="model-A",
        )
        # Matching model — hit.
        assert memory_cache.get(
            "doc.md", 1.0, keyword_model="model-A"
        ) is not None
        # Different model — miss.
        assert memory_cache.get(
            "doc.md", 1.0, keyword_model="model-B"
        ) is None

    def test_get_with_model_rejects_unenriched(
        self, memory_cache: DocCache
    ) -> None:
        # Unenriched entry doesn't match a specific model request.
        memory_cache.put("doc.md", 1.0, _make_outline())
        assert memory_cache.get(
            "doc.md", 1.0, keyword_model="model-A"
        ) is None

    def test_mtime_mismatch_short_circuits_model_check(
        self, memory_cache: DocCache
    ) -> None:
        # Wrong mtime is a miss even when the model would match —
        # mtime check runs first.
        memory_cache.put(
            "doc.md", 1.0, _make_outline(),
            keyword_model="model-A",
        )
        assert memory_cache.get(
            "doc.md", 2.0, keyword_model="model-A"
        ) is None

    def test_put_clears_pending_model_slot(
        self, memory_cache: DocCache
    ) -> None:
        # Put with a model, then put without — the second must
        # store None, not leak the first's model.
        memory_cache.put(
            "a.md", 1.0, _make_outline("a.md"),
            keyword_model="model-A",
        )
        memory_cache.put("b.md", 1.0, _make_outline("b.md"))
        assert (
            memory_cache._entries["b.md"]["keyword_model"]
            is None
        )


# ---------------------------------------------------------------------------
# Signature hash
# ---------------------------------------------------------------------------


class TestSignatureHash:
    def test_hash_populated_on_put(
        self, memory_cache: DocCache
    ) -> None:
        memory_cache.put("doc.md", 1.0, _make_outline())
        h = memory_cache.get_signature_hash("doc.md")
        assert h is not None
        # SHA-256 hex — 64 characters.
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_hash_deterministic(
        self, memory_cache: DocCache
    ) -> None:
        # Two identical outlines produce identical hashes.
        c1 = DocCache()
        c2 = DocCache()
        c1.put("doc.md", 1.0, _make_outline())
        c2.put("doc.md", 1.0, _make_outline())
        assert c1.get_signature_hash("doc.md") == c2.get_signature_hash(
            "doc.md"
        )

    def test_hash_changes_on_heading_text(
        self, memory_cache: DocCache
    ) -> None:
        o1 = _make_outline()
        o2 = _make_outline()
        o2.headings[0].text = "Different"
        memory_cache.put("a.md", 1.0, o1)
        h1 = memory_cache.get_signature_hash("a.md")
        memory_cache.put("a.md", 2.0, o2)
        h2 = memory_cache.get_signature_hash("a.md")
        assert h1 != h2

    def test_hash_changes_on_level(
        self, memory_cache: DocCache
    ) -> None:
        o1 = _make_outline()
        o2 = _make_outline()
        o2.headings[0].level = 2
        memory_cache.put("a.md", 1.0, o1)
        h1 = memory_cache.get_signature_hash("a.md")
        memory_cache.put("a.md", 2.0, o2)
        h2 = memory_cache.get_signature_hash("a.md")
        assert h1 != h2

    def test_hash_changes_on_keywords(
        self, memory_cache: DocCache
    ) -> None:
        # Keyword changes matter — enrichment updates the hash.
        o1 = _make_outline()
        o2 = _make_outline()
        o2.headings[0].keywords = ["different", "words"]
        memory_cache.put("a.md", 1.0, o1)
        h1 = memory_cache.get_signature_hash("a.md")
        memory_cache.put("a.md", 2.0, o2)
        h2 = memory_cache.get_signature_hash("a.md")
        assert h1 != h2

    def test_hash_changes_on_content_types(
        self, memory_cache: DocCache
    ) -> None:
        o1 = _make_outline()
        o2 = _make_outline()
        o2.headings[0].content_types = ["code", "formula"]
        memory_cache.put("a.md", 1.0, o1)
        h1 = memory_cache.get_signature_hash("a.md")
        memory_cache.put("a.md", 2.0, o2)
        h2 = memory_cache.get_signature_hash("a.md")
        assert h1 != h2

    def test_hash_changes_on_links(
        self, memory_cache: DocCache
    ) -> None:
        o1 = _make_outline()
        o2 = _make_outline()
        o2.links.append(
            DocLink(
                target="new.md",
                line=20,
                source_heading="Top",
                is_image=False,
            )
        )
        memory_cache.put("a.md", 1.0, o1)
        h1 = memory_cache.get_signature_hash("a.md")
        memory_cache.put("a.md", 2.0, o2)
        h2 = memory_cache.get_signature_hash("a.md")
        assert h1 != h2

    def test_hash_changes_on_prose_blocks(
        self, memory_cache: DocCache
    ) -> None:
        o1 = _make_outline()
        o2 = _make_outline()
        o2.prose_blocks.append(
            DocProseBlock(text="extra prose")
        )
        memory_cache.put("a.md", 1.0, o1)
        h1 = memory_cache.get_signature_hash("a.md")
        memory_cache.put("a.md", 2.0, o2)
        h2 = memory_cache.get_signature_hash("a.md")
        assert h1 != h2

    def test_hash_insensitive_to_start_line(
        self, memory_cache: DocCache
    ) -> None:
        # start_line changes shouldn't demote — whitespace edits
        # above a section shift lines without changing structure.
        o1 = _make_outline()
        o2 = _make_outline()
        o2.headings[0].start_line = 100
        o2.headings[0].children[0].start_line = 105
        memory_cache.put("a.md", 1.0, o1)
        h1 = memory_cache.get_signature_hash("a.md")
        memory_cache.put("a.md", 2.0, o2)
        h2 = memory_cache.get_signature_hash("a.md")
        assert h1 == h2

    def test_hash_insensitive_to_incoming_ref_count(
        self, memory_cache: DocCache
    ) -> None:
        # Incoming refs are derived from the wider repo graph —
        # a single file's outline shouldn't hash-differently when
        # another file's links change.
        o1 = _make_outline()
        o2 = _make_outline()
        o2.headings[0].incoming_ref_count = 999
        memory_cache.put("a.md", 1.0, o1)
        h1 = memory_cache.get_signature_hash("a.md")
        memory_cache.put("a.md", 2.0, o2)
        h2 = memory_cache.get_signature_hash("a.md")
        assert h1 == h2

    def test_hash_missing_returns_none(
        self, memory_cache: DocCache
    ) -> None:
        assert memory_cache.get_signature_hash("never.md") is None


# ---------------------------------------------------------------------------
# Disk persistence — basic round-trip
# ---------------------------------------------------------------------------


class TestDiskPersistence:
    def test_put_writes_sidecar(
        self, cache: DocCache, repo_root: Path
    ) -> None:
        cache.put("doc.md", 1.0, _make_outline())
        sidecar = (
            repo_root / ".ac-dc" / "doc_cache" / "doc.md.json"
        )
        assert sidecar.is_file()

    def test_sidecar_filename_translates_slashes(
        self, cache: DocCache, repo_root: Path
    ) -> None:
        cache.put("a/b/c.md", 1.0, _make_outline("a/b/c.md"))
        sidecar = (
            repo_root / ".ac-dc" / "doc_cache" / "a__b__c.md.json"
        )
        assert sidecar.is_file()

    def test_sidecar_filename_translates_backslashes(
        self, cache: DocCache, repo_root: Path
    ) -> None:
        # Even though the normaliser converts on input, the
        # filename function is tested directly.
        assert DocCache._sidecar_filename("a\\b.md") == "a__b.md.json"

    def test_sidecar_contains_version_field(
        self, cache: DocCache, repo_root: Path
    ) -> None:
        cache.put("doc.md", 1.0, _make_outline())
        raw = (
            repo_root / ".ac-dc" / "doc_cache" / "doc.md.json"
        ).read_text()
        payload = json.loads(raw)
        assert payload["version"] == _SIDECAR_VERSION

    def test_sidecar_contains_metadata(
        self, cache: DocCache, repo_root: Path
    ) -> None:
        cache.put(
            "doc.md", 1.0, _make_outline(),
            keyword_model="model-X",
        )
        payload = json.loads(
            (repo_root / ".ac-dc" / "doc_cache" / "doc.md.json")
            .read_text()
        )
        assert payload["path"] == "doc.md"
        assert payload["mtime"] == 1.0
        assert payload["keyword_model"] == "model-X"
        assert "signature_hash" in payload
        assert "outline" in payload

    def test_reconstruct_from_sidecar(
        self, repo_root: Path
    ) -> None:
        # Write via one cache instance...
        c1 = DocCache(repo_root)
        outline = _make_outline()
        c1.put("doc.md", 1.0, outline)

        # ... load via a fresh instance.
        c2 = DocCache(repo_root)
        reloaded = c2.get("doc.md", 1.0)
        assert reloaded is not None
        assert reloaded.file_path == outline.file_path
        assert reloaded.doc_type == outline.doc_type

    def test_reconstruct_preserves_heading_tree(
        self, repo_root: Path
    ) -> None:
        c1 = DocCache(repo_root)
        c1.put("doc.md", 1.0, _make_outline())
        c2 = DocCache(repo_root)
        reloaded = c2.get("doc.md", 1.0)
        assert reloaded is not None
        assert len(reloaded.headings) == 1
        top = reloaded.headings[0]
        assert top.text == "Top"
        assert top.keywords == ["intro", "overview"]
        assert top.content_types == ["table"]
        assert top.incoming_ref_count == 3
        assert len(top.children) == 1
        child = top.children[0]
        assert child.text == "Child"
        assert child.keywords == ["sub", "detail"]
        assert len(child.outgoing_refs) == 1
        assert child.outgoing_refs[0].target_path == "other.md"

    def test_reconstruct_preserves_links(
        self, repo_root: Path
    ) -> None:
        c1 = DocCache(repo_root)
        c1.put("doc.md", 1.0, _make_outline())
        c2 = DocCache(repo_root)
        reloaded = c2.get("doc.md", 1.0)
        assert reloaded is not None
        assert len(reloaded.links) == 2
        text_links = [ln for ln in reloaded.links if not ln.is_image]
        image_links = [ln for ln in reloaded.links if ln.is_image]
        assert len(text_links) == 1
        assert text_links[0].target == "ref.md"
        assert len(image_links) == 1
        assert image_links[0].target == "diagram.svg"

    def test_reconstruct_preserves_prose_blocks(
        self, repo_root: Path
    ) -> None:
        c1 = DocCache(repo_root)
        c1.put("doc.md", 1.0, _make_outline())
        c2 = DocCache(repo_root)
        reloaded = c2.get("doc.md", 1.0)
        assert reloaded is not None
        assert len(reloaded.prose_blocks) == 1
        block = reloaded.prose_blocks[0]
        assert block.text == "A long prose paragraph for enrichment."
        assert block.container_heading_id == "Top"
        assert block.keywords == ["prose", "example"]

    def test_reconstruct_preserves_keyword_model(
        self, repo_root: Path
    ) -> None:
        c1 = DocCache(repo_root)
        c1.put(
            "doc.md", 1.0, _make_outline(),
            keyword_model="my-model",
        )
        c2 = DocCache(repo_root)
        # Should still match on model.
        result = c2.get("doc.md", 1.0, keyword_model="my-model")
        assert result is not None

    def test_reconstruct_preserves_signature_hash(
        self, repo_root: Path
    ) -> None:
        c1 = DocCache(repo_root)
        c1.put("doc.md", 1.0, _make_outline())
        h1 = c1.get_signature_hash("doc.md")
        c2 = DocCache(repo_root)
        h2 = c2.get_signature_hash("doc.md")
        assert h1 == h2

    def test_invalidate_removes_sidecar(
        self, cache: DocCache, repo_root: Path
    ) -> None:
        cache.put("doc.md", 1.0, _make_outline())
        sidecar = (
            repo_root / ".ac-dc" / "doc_cache" / "doc.md.json"
        )
        assert sidecar.exists()
        cache.invalidate("doc.md")
        assert not sidecar.exists()

    def test_invalidate_absent_no_error(
        self, cache: DocCache, repo_root: Path
    ) -> None:
        # Invalidate a path that was never cached — no error.
        cache.invalidate("never.md")

    def test_clear_removes_all_sidecars(
        self, cache: DocCache, repo_root: Path
    ) -> None:
        cache.put("a.md", 1.0, _make_outline("a.md"))
        cache.put("b.md", 2.0, _make_outline("b.md"))
        sidecar_dir = repo_root / ".ac-dc" / "doc_cache"
        assert len(list(sidecar_dir.iterdir())) == 2
        cache.clear()
        assert list(sidecar_dir.iterdir()) == []

    def test_clear_preserves_directory(
        self, cache: DocCache, repo_root: Path
    ) -> None:
        cache.put("a.md", 1.0, _make_outline("a.md"))
        cache.clear()
        sidecar_dir = repo_root / ".ac-dc" / "doc_cache"
        # Directory still exists — ready for next put.
        assert sidecar_dir.is_dir()

    def test_put_overwrite_updates_sidecar(
        self, cache: DocCache, repo_root: Path
    ) -> None:
        first = _make_outline()
        second = _make_outline()
        second.doc_type = "guide"
        cache.put("doc.md", 1.0, first)
        cache.put("doc.md", 2.0, second)
        payload = json.loads(
            (repo_root / ".ac-dc" / "doc_cache" / "doc.md.json")
            .read_text()
        )
        assert payload["mtime"] == 2.0
        assert payload["outline"]["doc_type"] == "guide"


# ---------------------------------------------------------------------------
# Disk persistence — crash recovery
# ---------------------------------------------------------------------------


class TestCrashRecovery:
    def test_corrupt_json_removed_on_load(
        self, repo_root: Path
    ) -> None:
        sidecar_dir = repo_root / ".ac-dc" / "doc_cache"
        sidecar_dir.mkdir(parents=True)
        bad = sidecar_dir / "broken.md.json"
        bad.write_text("{not valid json", encoding="utf-8")
        cache = DocCache(repo_root)
        # Bad file removed, cache loaded empty.
        assert not bad.exists()
        assert cache.cached_paths == set()

    def test_non_dict_payload_removed(
        self, repo_root: Path
    ) -> None:
        sidecar_dir = repo_root / ".ac-dc" / "doc_cache"
        sidecar_dir.mkdir(parents=True)
        bad = sidecar_dir / "array.md.json"
        bad.write_text('["not a dict"]', encoding="utf-8")
        cache = DocCache(repo_root)
        assert not bad.exists()

    def test_wrong_version_removed(
        self, repo_root: Path
    ) -> None:
        sidecar_dir = repo_root / ".ac-dc" / "doc_cache"
        sidecar_dir.mkdir(parents=True)
        old = sidecar_dir / "stale.md.json"
        old.write_text(
            json.dumps({
                "version": 0,  # wrong version
                "path": "stale.md",
                "mtime": 1.0,
                "signature_hash": "",
                "keyword_model": None,
                "outline": {"file_path": "stale.md"},
            }),
            encoding="utf-8",
        )
        cache = DocCache(repo_root)
        assert not old.exists()

    def test_missing_outline_field_removed(
        self, repo_root: Path
    ) -> None:
        sidecar_dir = repo_root / ".ac-dc" / "doc_cache"
        sidecar_dir.mkdir(parents=True)
        bad = sidecar_dir / "nooutline.md.json"
        bad.write_text(
            json.dumps({
                "version": _SIDECAR_VERSION,
                "path": "nooutline.md",
                "mtime": 1.0,
                # outline field missing
            }),
            encoding="utf-8",
        )
        cache = DocCache(repo_root)
        assert not bad.exists()

    def test_missing_path_field_removed(
        self, repo_root: Path
    ) -> None:
        sidecar_dir = repo_root / ".ac-dc" / "doc_cache"
        sidecar_dir.mkdir(parents=True)
        bad = sidecar_dir / "nopath.md.json"
        bad.write_text(
            json.dumps({
                "version": _SIDECAR_VERSION,
                # path missing
                "mtime": 1.0,
                "outline": {"file_path": "x.md"},
            }),
            encoding="utf-8",
        )
        cache = DocCache(repo_root)
        assert not bad.exists()

    def test_other_sidecars_preserved_when_one_corrupt(
        self, repo_root: Path
    ) -> None:
        # Good sidecar + bad sidecar. Good survives.
        c1 = DocCache(repo_root)
        c1.put("good.md", 1.0, _make_outline("good.md"))

        sidecar_dir = repo_root / ".ac-dc" / "doc_cache"
        bad = sidecar_dir / "bad.md.json"
        bad.write_text("corrupted", encoding="utf-8")

        c2 = DocCache(repo_root)
        # Bad removed, good loaded.
        assert not bad.exists()
        assert c2.get("good.md", 1.0) is not None

    def test_tmp_file_left_by_crash_not_loaded(
        self, repo_root: Path
    ) -> None:
        # A .json.tmp file is write-in-progress residue. It
        # doesn't have the .json suffix (it has .tmp) so the
        # loader skips it naturally. Should NOT be removed or
        # loaded.
        sidecar_dir = repo_root / ".ac-dc" / "doc_cache"
        sidecar_dir.mkdir(parents=True)
        tmp = sidecar_dir / "inprogress.md.json.tmp"
        tmp.write_text("partial", encoding="utf-8")
        cache = DocCache(repo_root)
        # Tmp file still there — loader ignored it rather than
        # removing it (another writer might own it).
        assert tmp.exists()
        assert cache.cached_paths == set()

    def test_non_json_file_ignored(
        self, repo_root: Path
    ) -> None:
        sidecar_dir = repo_root / ".ac-dc" / "doc_cache"
        sidecar_dir.mkdir(parents=True)
        stray = sidecar_dir / "README"
        stray.write_text("documentation")
        cache = DocCache(repo_root)
        assert stray.exists()


# ---------------------------------------------------------------------------
# Cross-instance round-trips with keyword model
# ---------------------------------------------------------------------------


class TestKeywordModelAcrossRestart:
    def test_enriched_entry_reloadable_with_model(
        self, repo_root: Path
    ) -> None:
        c1 = DocCache(repo_root)
        c1.put(
            "doc.md", 1.0, _make_outline(),
            keyword_model="model-A",
        )
        c2 = DocCache(repo_root)
        result = c2.get("doc.md", 1.0, keyword_model="model-A")
        assert result is not None

    def test_unenriched_entry_reloadable_without_model(
        self, repo_root: Path
    ) -> None:
        c1 = DocCache(repo_root)
        c1.put("doc.md", 1.0, _make_outline())
        c2 = DocCache(repo_root)
        result = c2.get("doc.md", 1.0, keyword_model=None)
        assert result is not None

    def test_model_change_invalidates(
        self, repo_root: Path
    ) -> None:
        # Simulates user changing their keyword_model config.
        # The cache loads the old entry but the orchestrator's
        # next query with the new model misses and re-enriches.
        c1 = DocCache(repo_root)
        c1.put(
            "doc.md", 1.0, _make_outline(),
            keyword_model="old-model",
        )
        c2 = DocCache(repo_root)
        # Query with new model — miss.
        assert c2.get(
            "doc.md", 1.0, keyword_model="new-model"
        ) is None
        # Structure-only query still hits.
        assert c2.get(
            "doc.md", 1.0, keyword_model=None
        ) is not None


# ---------------------------------------------------------------------------
# No-repo-root variant
# ---------------------------------------------------------------------------


class TestNoRepoRoot:
    def test_put_does_not_create_sidecar(
        self, memory_cache: DocCache, tmp_path: Path
    ) -> None:
        memory_cache.put("doc.md", 1.0, _make_outline())
        # Nothing at the default path.
        assert not (tmp_path / ".ac-dc").exists()

    def test_invalidate_is_pure_memory(
        self, memory_cache: DocCache
    ) -> None:
        memory_cache.put("doc.md", 1.0, _make_outline())
        memory_cache.invalidate("doc.md")
        assert memory_cache.get("doc.md", 1.0) is None

    def test_clear_is_pure_memory(
        self, memory_cache: DocCache
    ) -> None:
        memory_cache.put("a.md", 1.0, _make_outline("a.md"))
        memory_cache.clear()
        assert memory_cache.cached_paths == set()