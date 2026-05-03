"""Tests for ac_dc.history_store — Layer 3.2.

Scope: HistoryStore — append-only JSONL persistence, session
grouping, image round-trip, search, tolerance for mid-write
crashes.

Strategy:
- tmp_path fixture gives each test its own ``.ac-dc/`` directory
- Real filesystem writes (JSONL and image files) — no mocking of
  I/O. The code paths are simple enough that filesystem testing
  is cheaper than building mocks.
- Base64 image payloads are tiny (a few bytes) — SHA-256 and
  base64 round-trips take microseconds.
- Session IDs for tests are explicitly constructed via
  ``HistoryStore.new_session_id()`` so each test gets a fresh
  one, matching how the LLM service will use them.
"""

from __future__ import annotations

import base64
import json
import time
from pathlib import Path

import pytest

from ac_dc.history_store import HistoryStore, SessionSummary


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def ac_dc_dir(tmp_path: Path) -> Path:
    """Return a fresh ``.ac-dc4/`` directory for each test."""
    d = tmp_path / ".ac-dc4"
    d.mkdir()
    return d


@pytest.fixture
def store(ac_dc_dir: Path) -> HistoryStore:
    """Construct a HistoryStore backed by a fresh directory."""
    return HistoryStore(ac_dc_dir)


def _make_data_uri(mime: str, payload: bytes) -> str:
    """Encode raw bytes as a data URI with the given MIME."""
    b64 = base64.b64encode(payload).decode("ascii")
    return f"data:{mime};base64,{b64}"


# Tiny PNG bytes — smallest valid PNG (1x1 transparent).
_PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f"
    "15c4890000000d49444154789c6200010000000500010d0a2db40000"
    "000049454e44ae426082"
)

# Tiny JPEG bytes — minimal SOI + EOI; not a valid image but a
# plausible payload shape for MIME detection tests.
_JPEG_BYTES = b"\xff\xd8\xff\xd9"


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestConstruction:
    """Constructor creates the required directories."""

    def test_creates_ac_dc_dir_if_missing(self, tmp_path: Path) -> None:
        """Passing a non-existent dir creates it.

        The ConfigManager normally creates .ac-dc/ on init, but
        the history store mustn't depend on that — tests and
        future callers that construct a bare HistoryStore should
        get a working store.
        """
        target = tmp_path / "new-ac-dc"
        assert not target.exists()
        HistoryStore(target)
        assert target.is_dir()

    def test_creates_images_subdir(self, ac_dc_dir: Path) -> None:
        """The images/ subdirectory is created on construction."""
        HistoryStore(ac_dc_dir)
        assert (ac_dc_dir / "images").is_dir()

    def test_accepts_string_path(self, ac_dc_dir: Path) -> None:
        """String paths work, not just Path objects.

        Defensive — callers passing str from config read paths
        shouldn't need to wrap in Path() themselves.
        """
        store = HistoryStore(str(ac_dc_dir))
        # Smoke test — construction didn't raise.
        assert store is not None

    def test_noop_when_already_exists(self, ac_dc_dir: Path) -> None:
        """Running twice doesn't fail or wipe existing content.

        The ConfigManager may construct the store twice across
        a session (unlikely, but possible). Existing JSONL files
        must survive.
        """
        store1 = HistoryStore(ac_dc_dir)
        sid = HistoryStore.new_session_id()
        store1.append_message(sid, "user", "hello")

        # Re-construct — directory already exists.
        HistoryStore(ac_dc_dir)

        # Content preserved.
        assert store1.get_session_messages(sid)[0]["content"] == "hello"


# ---------------------------------------------------------------------------
# Session IDs
# ---------------------------------------------------------------------------


class TestSessionIds:
    """Session and message ID generation."""

    def test_session_id_format(self) -> None:
        """Session IDs start with ``sess_`` and include an epoch.

        Format — ``sess_{epoch_ms}_{6-char-hex}``. Pinning the
        prefix means tools that grep for sessions across logs
        can rely on it; the epoch means sessions sort
        chronologically when joined on session_id.
        """
        sid = HistoryStore.new_session_id()
        assert sid.startswith("sess_")
        # Expect exactly two underscores past the prefix.
        parts = sid.split("_")
        assert len(parts) == 3
        # Middle part is an epoch_ms — all digits.
        assert parts[1].isdigit()

    def test_session_ids_are_unique(self) -> None:
        """Back-to-back calls produce distinct IDs.

        The random suffix breaks ties when two calls hit the
        same millisecond (common on fast machines).
        """
        ids = {HistoryStore.new_session_id() for _ in range(100)}
        assert len(ids) == 100


# ---------------------------------------------------------------------------
# Append — basic
# ---------------------------------------------------------------------------


class TestAppendBasic:
    """Happy path: append user/assistant messages, read back."""

    def test_append_user_message(self, store: HistoryStore) -> None:
        """A simple user message persists and reads back."""
        sid = HistoryStore.new_session_id()
        record = store.append_message(sid, "user", "hello")
        assert record["session_id"] == sid
        assert record["role"] == "user"
        assert record["content"] == "hello"
        # Record includes an ID and timestamp.
        assert record["id"]
        assert record["timestamp"]

    def test_append_returns_full_record(self, store: HistoryStore) -> None:
        """append_message returns the record it wrote.

        The streaming handler uses the returned ID to correlate
        messages with follow-up events (edit results, etc.).
        """
        sid = HistoryStore.new_session_id()
        record = store.append_message(sid, "user", "hello")
        # Record has all the fields we care about.
        assert set(record.keys()) >= {
            "id", "session_id", "timestamp", "role", "content"
        }

    def test_append_writes_to_disk(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """The JSONL file is created and contains the record."""
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "hello")
        history_file = ac_dc_dir / "history.jsonl"
        assert history_file.is_file()
        content = history_file.read_text(encoding="utf-8")
        # Exactly one line.
        lines = [line for line in content.splitlines() if line]
        assert len(lines) == 1
        record = json.loads(lines[0])
        assert record["content"] == "hello"

    def test_multiple_appends_produce_multiple_lines(
        self, store: HistoryStore
    ) -> None:
        """Sequential appends each become a new line."""
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "one")
        store.append_message(sid, "assistant", "two")
        store.append_message(sid, "user", "three")
        msgs = store.get_session_messages(sid)
        assert len(msgs) == 3
        assert [m["content"] for m in msgs] == ["one", "two", "three"]

    def test_message_ids_are_unique(self, store: HistoryStore) -> None:
        """Each append produces a unique message ID."""
        sid = HistoryStore.new_session_id()
        ids = set()
        for i in range(20):
            rec = store.append_message(sid, "user", f"msg {i}")
            ids.add(rec["id"])
        assert len(ids) == 20

    def test_timestamp_format_is_iso_8601(
        self, store: HistoryStore
    ) -> None:
        """Timestamps use ISO 8601 with a trailing Z.

        ISO 8601 lexicographic sort == chronological sort is
        what session listing depends on.
        """
        sid = HistoryStore.new_session_id()
        rec = store.append_message(sid, "user", "hi")
        ts = rec["timestamp"]
        # Trailing Z for UTC, not +00:00.
        assert ts.endswith("Z")
        # Contains a T separator between date and time.
        assert "T" in ts


# ---------------------------------------------------------------------------
# Append — metadata
# ---------------------------------------------------------------------------


class TestAppendMetadata:
    """Optional metadata fields: files, edit_results, system_event."""

    def test_files_persisted(self, store: HistoryStore) -> None:
        """Files-in-context list round-trips."""
        sid = HistoryStore.new_session_id()
        store.append_message(
            sid, "user", "hi", files=["a.py", "b.py"]
        )
        msgs = store.get_session_messages(sid)
        assert msgs[0]["files"] == ["a.py", "b.py"]

    def test_files_modified_persisted(self, store: HistoryStore) -> None:
        """Assistant files_modified list round-trips."""
        sid = HistoryStore.new_session_id()
        store.append_message(
            sid, "assistant", "done", files_modified=["x.py"]
        )
        msgs = store.get_session_messages(sid)
        assert msgs[0]["files_modified"] == ["x.py"]

    def test_edit_results_persisted(self, store: HistoryStore) -> None:
        """Edit results list of dicts round-trips."""
        sid = HistoryStore.new_session_id()
        results = [
            {"file": "a.py", "status": "applied"},
            {"file": "b.py", "status": "failed", "error": "not found"},
        ]
        store.append_message(
            sid, "assistant", "done", edit_results=results
        )
        msgs = store.get_session_messages(sid)
        assert msgs[0]["edit_results"] == results

    def test_system_event_flag_persisted(
        self, store: HistoryStore
    ) -> None:
        """system_event=True appears on the persisted record."""
        sid = HistoryStore.new_session_id()
        store.append_message(
            sid, "user", "Committed abc1234", system_event=True
        )
        msgs = store.get_session_messages(sid)
        assert msgs[0].get("system_event") is True

    def test_system_event_absent_when_false(
        self, store: HistoryStore
    ) -> None:
        """system_event field omitted when not a system event.

        Keeps records small for the common case. Callers that
        check the field use ``.get("system_event")`` so absence
        reads as falsy.
        """
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "regular message")
        msgs = store.get_session_messages(sid)
        assert "system_event" not in msgs[0]

    def test_optional_fields_omitted_when_empty(
        self, store: HistoryStore
    ) -> None:
        """Empty lists don't appear in the persisted record.

        Keeps JSONL compact. None and [] both omit the field.
        """
        sid = HistoryStore.new_session_id()
        store.append_message(
            sid, "user", "hi", files=[], edit_results=[]
        )
        msgs = store.get_session_messages(sid)
        assert "files" not in msgs[0]
        assert "edit_results" not in msgs[0]


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------


class TestImages:
    """Image persistence: data URI → file → data URI round-trip."""

    def test_image_saved_to_disk(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """A data URI becomes a file in images/."""
        sid = HistoryStore.new_session_id()
        uri = _make_data_uri("image/png", _PNG_BYTES)
        store.append_message(sid, "user", "look", images=[uri])
        images = list((ac_dc_dir / "images").iterdir())
        # Exactly one image file.
        assert len(images) == 1
        # Payload bytes preserved.
        assert images[0].read_bytes() == _PNG_BYTES

    def test_image_ref_stored_not_data_uri(
        self, store: HistoryStore
    ) -> None:
        """JSONL stores the filename, not the full base64 payload.

        The whole point of the images dir — without this, a
        session with a dozen pasted screenshots would bloat the
        JSONL into megabytes.
        """
        sid = HistoryStore.new_session_id()
        uri = _make_data_uri("image/png", _PNG_BYTES)
        store.append_message(sid, "user", "look", images=[uri])
        msgs = store.get_session_messages(sid)
        refs = msgs[0]["image_refs"]
        assert len(refs) == 1
        # Filename, not a data URI.
        assert not refs[0].startswith("data:")
        assert refs[0].endswith(".png")

    def test_image_reconstructed_on_context_load(
        self, store: HistoryStore
    ) -> None:
        """get_session_messages_for_context returns data URIs.

        The chat panel re-renders thumbnails from these; without
        reconstruction, loaded sessions would show broken images.
        """
        sid = HistoryStore.new_session_id()
        uri = _make_data_uri("image/png", _PNG_BYTES)
        store.append_message(sid, "user", "look", images=[uri])
        msgs = store.get_session_messages_for_context(sid)
        assert msgs[0]["images"] == [uri]

    def test_duplicate_image_deduplicated(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """Posting the same image twice produces one file on disk.

        Content-hash filename guarantees this. A user who
        re-pastes an image they pasted earlier shouldn't double
        the disk usage.
        """
        sid = HistoryStore.new_session_id()
        uri = _make_data_uri("image/png", _PNG_BYTES)
        store.append_message(sid, "user", "first", images=[uri])
        store.append_message(sid, "user", "second", images=[uri])
        images = list((ac_dc_dir / "images").iterdir())
        assert len(images) == 1

    def test_different_images_produce_different_files(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """Distinct payloads don't collide on the same filename."""
        sid = HistoryStore.new_session_id()
        uri_png = _make_data_uri("image/png", _PNG_BYTES)
        uri_jpg = _make_data_uri("image/jpeg", _JPEG_BYTES)
        store.append_message(
            sid, "user", "both", images=[uri_png, uri_jpg]
        )
        images = list((ac_dc_dir / "images").iterdir())
        assert len(images) == 2

    def test_jpeg_extension(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """JPEG MIME maps to .jpg extension."""
        sid = HistoryStore.new_session_id()
        uri = _make_data_uri("image/jpeg", _JPEG_BYTES)
        store.append_message(sid, "user", "look", images=[uri])
        images = list((ac_dc_dir / "images").iterdir())
        assert len(images) == 1
        assert images[0].suffix == ".jpg"

    def test_unknown_mime_falls_back_to_png(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """Unknown MIME types save with .png extension.

        Browsers tolerate this for real PNG payloads. A truly
        exotic image format would produce a broken thumbnail
        but wouldn't crash anything.
        """
        sid = HistoryStore.new_session_id()
        uri = _make_data_uri("image/xyz-unknown", _PNG_BYTES)
        store.append_message(sid, "user", "look", images=[uri])
        images = list((ac_dc_dir / "images").iterdir())
        assert images[0].suffix == ".png"

    def test_malformed_data_uri_skipped(
        self, store: HistoryStore
    ) -> None:
        """A malformed URI is silently dropped — doesn't raise.

        A single bad URI in a message shouldn't fail the whole
        append. The other valid URIs still persist.
        """
        sid = HistoryStore.new_session_id()
        good = _make_data_uri("image/png", _PNG_BYTES)
        store.append_message(
            sid, "user", "mixed", images=["not-a-data-uri", good]
        )
        msgs = store.get_session_messages(sid)
        # Only one image ref (the good one).
        assert len(msgs[0]["image_refs"]) == 1

    def test_missing_image_file_skipped_on_load(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """Deleted image files produce no crash on session load.

        Users can delete .ac-dc/images/ manually to reclaim
        space — specs4 explicitly documents this. The store
        must tolerate the resulting dangling refs.
        """
        sid = HistoryStore.new_session_id()
        uri = _make_data_uri("image/png", _PNG_BYTES)
        store.append_message(sid, "user", "look", images=[uri])
        # Delete the image file.
        for f in (ac_dc_dir / "images").iterdir():
            f.unlink()
        msgs = store.get_session_messages_for_context(sid)
        # Message still exists, just without the images field.
        assert msgs[0]["content"] == "look"
        assert "images" not in msgs[0]

    def test_legacy_integer_count(self, store: HistoryStore) -> None:
        """Integer image count still persists, without image data.

        Backward compatibility — old records that stored a count
        instead of refs must load cleanly. The reconstruction
        path skips them (no data to rebuild).
        """
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "old", images=3)
        msgs = store.get_session_messages(sid)
        assert msgs[0].get("images") == 3
        # Context load — no images reconstructed.
        ctx = store.get_session_messages_for_context(sid)
        assert "images" not in ctx[0]

    def test_no_images_field_when_list_empty(
        self, store: HistoryStore
    ) -> None:
        """Empty image list omits both ``images`` and ``image_refs``."""
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "no attach", images=[])
        msgs = store.get_session_messages(sid)
        assert "images" not in msgs[0]
        assert "image_refs" not in msgs[0]


# ---------------------------------------------------------------------------
# Session listing
# ---------------------------------------------------------------------------


class TestListSessions:
    """list_sessions — one SessionSummary per session ID."""

    def test_empty_store_returns_empty(self, store: HistoryStore) -> None:
        """Fresh store — no sessions."""
        assert store.list_sessions() == []

    def test_single_session_single_summary(
        self, store: HistoryStore
    ) -> None:
        """One session with messages → one summary."""
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "hello")
        store.append_message(sid, "assistant", "hi")
        sessions = store.list_sessions()
        assert len(sessions) == 1
        assert sessions[0].session_id == sid
        assert sessions[0].message_count == 2
        assert sessions[0].first_role == "user"

    def test_multiple_sessions_sorted_newest_first(
        self, store: HistoryStore
    ) -> None:
        """Sessions sort by latest-message timestamp descending."""
        sid_old = HistoryStore.new_session_id()
        store.append_message(sid_old, "user", "old")
        # Sleep briefly so timestamps differ — the store uses
        # 1-second resolution.
        time.sleep(1.1)
        sid_new = HistoryStore.new_session_id()
        store.append_message(sid_new, "user", "new")
        sessions = store.list_sessions()
        assert len(sessions) == 2
        # Newest first.
        assert sessions[0].session_id == sid_new
        assert sessions[1].session_id == sid_old

    def test_preview_truncation(self, store: HistoryStore) -> None:
        """Preview is capped to ~100 chars with ellipsis."""
        sid = HistoryStore.new_session_id()
        long_content = "a" * 500
        store.append_message(sid, "user", long_content)
        sessions = store.list_sessions()
        preview = sessions[0].preview
        # Substantially shorter than the original.
        assert len(preview) < 120
        # Ends with ellipsis.
        assert preview.endswith("…")

    def test_preview_not_truncated_when_short(
        self, store: HistoryStore
    ) -> None:
        """Short messages appear verbatim, no ellipsis."""
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "brief")
        sessions = store.list_sessions()
        assert sessions[0].preview == "brief"

    def test_limit_returns_newest_only(
        self, store: HistoryStore
    ) -> None:
        """limit=1 returns just the newest session.

        Auto-restore-on-startup uses list_sessions(limit=1) to
        find the last session to reload.
        """
        sid1 = HistoryStore.new_session_id()
        store.append_message(sid1, "user", "first")
        time.sleep(1.1)
        sid2 = HistoryStore.new_session_id()
        store.append_message(sid2, "user", "second")
        sessions = store.list_sessions(limit=1)
        assert len(sessions) == 1
        assert sessions[0].session_id == sid2

    def test_message_count_accurate(
        self, store: HistoryStore
    ) -> None:
        """message_count reflects total records in the session."""
        sid = HistoryStore.new_session_id()
        for i in range(5):
            store.append_message(sid, "user", f"msg {i}")
        sessions = store.list_sessions()
        assert sessions[0].message_count == 5


# ---------------------------------------------------------------------------
# Session retrieval
# ---------------------------------------------------------------------------


class TestSessionRetrieval:
    """get_session_messages and get_session_messages_for_context."""

    def test_get_session_messages_returns_full_records(
        self, store: HistoryStore
    ) -> None:
        """Full retrieval includes all metadata fields."""
        sid = HistoryStore.new_session_id()
        store.append_message(
            sid, "user", "hi",
            files=["a.py"],
            files_modified=None,
        )
        msgs = store.get_session_messages(sid)
        assert len(msgs) == 1
        m = msgs[0]
        # Full shape — includes metadata.
        assert m["content"] == "hi"
        assert m["files"] == ["a.py"]
        assert m["timestamp"]
        assert m["id"]

    def test_get_session_messages_for_context_minimal_shape(
        self, store: HistoryStore
    ) -> None:
        """Context-load path returns only role/content (+ images).

        History-browser metadata (files, edit_results) isn't
        useful when loading a conversation back into context —
        specs4 documents this asymmetry explicitly.
        """
        sid = HistoryStore.new_session_id()
        store.append_message(
            sid, "user", "hi",
            files=["a.py"],
            files_modified=None,
        )
        msgs = store.get_session_messages_for_context(sid)
        assert len(msgs) == 1
        m = msgs[0]
        # Only role and content.
        assert set(m.keys()) == {"role", "content"}

    def test_messages_in_write_order(
        self, store: HistoryStore
    ) -> None:
        """Session messages return in the order they were appended."""
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "one")
        store.append_message(sid, "assistant", "two")
        store.append_message(sid, "user", "three")
        msgs = store.get_session_messages(sid)
        assert [m["content"] for m in msgs] == [
            "one", "two", "three"
        ]

    def test_unknown_session_returns_empty(
        self, store: HistoryStore
    ) -> None:
        """Missing session ID → empty list, no error.

        The history browser does a session load after a click;
        a stale click on a deleted session shouldn't crash.
        """
        # Add one real session so the file isn't empty.
        sid_real = HistoryStore.new_session_id()
        store.append_message(sid_real, "user", "hi")
        # Query a different session ID.
        assert store.get_session_messages("sess_nope_abc") == []
        assert (
            store.get_session_messages_for_context("sess_nope_abc")
            == []
        )

    def test_sessions_are_isolated(
        self, store: HistoryStore
    ) -> None:
        """Messages from different sessions don't cross-pollute."""
        sid1 = HistoryStore.new_session_id()
        sid2 = HistoryStore.new_session_id()
        store.append_message(sid1, "user", "session 1")
        store.append_message(sid2, "user", "session 2")
        store.append_message(sid1, "assistant", "reply to 1")
        msgs1 = store.get_session_messages(sid1)
        msgs2 = store.get_session_messages(sid2)
        assert len(msgs1) == 2
        assert len(msgs2) == 1
        assert all(m["session_id"] == sid1 for m in msgs1)
        assert msgs2[0]["content"] == "session 2"


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


class TestSearch:
    """search_messages — substring matching with optional role filter."""

    def test_basic_substring_match(self, store: HistoryStore) -> None:
        """A query matches content containing the substring."""
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "implement feature X")
        store.append_message(sid, "assistant", "here's how")
        hits = store.search_messages("feature")
        assert len(hits) == 1
        assert "feature" in hits[0]["content_preview"].lower()

    def test_case_insensitive(self, store: HistoryStore) -> None:
        """Matching is case-insensitive.

        Users rarely type with exact case; the history browser's
        search box would be annoying if it required it.
        """
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "Implement FEATURE X")
        # All cases should match.
        assert len(store.search_messages("feature")) == 1
        assert len(store.search_messages("FEATURE")) == 1
        assert len(store.search_messages("FeAtUrE")) == 1

    def test_empty_query_returns_empty(
        self, store: HistoryStore
    ) -> None:
        """Empty query returns no hits without scanning.

        Prevents the history browser from returning every
        message when the user clears the search box.
        """
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "anything")
        assert store.search_messages("") == []
        assert store.search_messages("   ") == []

    def test_no_match_returns_empty(
        self, store: HistoryStore
    ) -> None:
        """A query with no matches returns an empty list."""
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "hello")
        assert store.search_messages("xyzzy") == []

    def test_role_filter_user(self, store: HistoryStore) -> None:
        """role='user' restricts matches to user messages."""
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "find me user")
        store.append_message(sid, "assistant", "find me assistant")
        hits = store.search_messages("find me", role="user")
        assert len(hits) == 1
        assert hits[0]["role"] == "user"

    def test_role_filter_assistant(self, store: HistoryStore) -> None:
        """role='assistant' restricts matches to assistant messages."""
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "find me user")
        store.append_message(sid, "assistant", "find me assistant")
        hits = store.search_messages("find me", role="assistant")
        assert len(hits) == 1
        assert hits[0]["role"] == "assistant"

    def test_hits_include_context_fields(
        self, store: HistoryStore
    ) -> None:
        """Each hit carries session, message ID, role, preview, timestamp.

        The history browser needs these to render a clickable
        result list that jumps to the matching session.
        """
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "matching content")
        hits = store.search_messages("matching")
        assert len(hits) == 1
        hit = hits[0]
        assert hit["session_id"] == sid
        assert hit["message_id"]
        assert hit["role"] == "user"
        assert "matching" in hit["content_preview"]
        assert hit["timestamp"]

    def test_limit_caps_results(self, store: HistoryStore) -> None:
        """limit truncates the hit list to that many matches."""
        sid = HistoryStore.new_session_id()
        for i in range(10):
            store.append_message(sid, "user", f"match {i}")
        hits = store.search_messages("match", limit=3)
        assert len(hits) == 3

    def test_search_across_sessions(
        self, store: HistoryStore
    ) -> None:
        """Search spans all sessions, not just the current one."""
        sid1 = HistoryStore.new_session_id()
        sid2 = HistoryStore.new_session_id()
        store.append_message(sid1, "user", "shared word appears")
        store.append_message(sid2, "user", "shared word elsewhere")
        hits = store.search_messages("shared")
        assert len(hits) == 2
        # Different sessions.
        session_ids = {h["session_id"] for h in hits}
        assert session_ids == {sid1, sid2}


# ---------------------------------------------------------------------------
# Turn IDs
# ---------------------------------------------------------------------------


class TestTurnIds:
    """Turn ID generation and round-trip through records."""

    def test_turn_id_format(self) -> None:
        """Turn IDs start with ``turn_`` and include an epoch.

        Format — ``turn_{epoch_ms}_{6-char-hex}``. Pinning the
        prefix keeps turn IDs visually distinct from session
        IDs while sharing the structural shape documented in
        specs-reference/3-llm/history.md.
        """
        tid = HistoryStore.new_turn_id()
        assert tid.startswith("turn_")
        parts = tid.split("_")
        assert len(parts) == 3
        assert parts[1].isdigit()

    def test_turn_ids_are_unique(self) -> None:
        """Back-to-back calls produce distinct IDs.

        Same rationale as session IDs — random suffix breaks
        same-millisecond ties.
        """
        ids = {HistoryStore.new_turn_id() for _ in range(100)}
        assert len(ids) == 100

    def test_turn_id_distinct_from_session_id(self) -> None:
        """Turn and session IDs never alias.

        Different prefixes are the only guarantee; the uuid
        space is shared. Assert the prefix invariant directly
        so a future refactor that tries to unify the
        generators trips the test.
        """
        sid = HistoryStore.new_session_id()
        tid = HistoryStore.new_turn_id()
        assert sid.startswith("sess_")
        assert tid.startswith("turn_")
        assert not sid.startswith("turn_")
        assert not tid.startswith("sess_")

    def test_append_without_turn_id_omits_field(
        self, store: HistoryStore
    ) -> None:
        """Records without a turn_id argument don't persist the field.

        Pins the backwards-compat invariant: before turn
        propagation lands in the streaming handler, records
        must stay byte-identical to their current shape.
        """
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "hi")
        msgs = store.get_session_messages(sid)
        assert "turn_id" not in msgs[0]

    def test_append_with_turn_id_persists(
        self, store: HistoryStore
    ) -> None:
        """turn_id is written to the record and reads back."""
        sid = HistoryStore.new_session_id()
        tid = HistoryStore.new_turn_id()
        store.append_message(sid, "user", "hi", turn_id=tid)
        msgs = store.get_session_messages(sid)
        assert msgs[0].get("turn_id") == tid

    def test_turn_id_none_omits_field(
        self, store: HistoryStore
    ) -> None:
        """Explicit None omits the field (not ``"None"``).

        Callers that haven't yet adopted turn propagation may
        pass None; the record must match the
        didn't-pass-the-arg shape byte-for-byte so tests and
        downstream consumers can't distinguish the two.
        """
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "hi", turn_id=None)
        msgs = store.get_session_messages(sid)
        assert "turn_id" not in msgs[0]

    def test_turn_id_empty_string_omits_field(
        self, store: HistoryStore
    ) -> None:
        """Empty string is treated as "no turn_id".

        Defensive against a caller that initialises a variable
        to ``""`` before deciding to populate it and forgets
        to replace it. The persisted record matches the None
        case.
        """
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "hi", turn_id="")
        msgs = store.get_session_messages(sid)
        assert "turn_id" not in msgs[0]

    def test_turn_id_groups_multiple_messages(
        self, store: HistoryStore
    ) -> None:
        """A turn's user + assistant messages share one turn_id.

        Simulates the streaming-handler pattern: generate one
        turn_id, thread it through every append for that
        request.
        """
        sid = HistoryStore.new_session_id()
        tid = HistoryStore.new_turn_id()
        store.append_message(sid, "user", "q", turn_id=tid)
        store.append_message(sid, "assistant", "a", turn_id=tid)
        msgs = store.get_session_messages(sid)
        assert len(msgs) == 2
        assert all(m.get("turn_id") == tid for m in msgs)

    def test_different_turns_have_different_ids(
        self, store: HistoryStore
    ) -> None:
        """Two turns in one session have distinct turn_ids.

        Pins the grouping contract: records in the same turn
        share an ID; records in different turns don't.
        """
        sid = HistoryStore.new_session_id()
        tid1 = HistoryStore.new_turn_id()
        tid2 = HistoryStore.new_turn_id()
        store.append_message(sid, "user", "q1", turn_id=tid1)
        store.append_message(sid, "assistant", "a1", turn_id=tid1)
        store.append_message(sid, "user", "q2", turn_id=tid2)
        store.append_message(sid, "assistant", "a2", turn_id=tid2)
        msgs = store.get_session_messages(sid)
        assert [m.get("turn_id") for m in msgs] == [
            tid1, tid1, tid2, tid2,
        ]

    def test_context_retrieval_carries_turn_id(
        self, store: HistoryStore
    ) -> None:
        """Context-load shape includes turn_id when present.

        Needed so a session restored via session-load keeps the
        "show agents" affordance for records that had it.
        Records without turn_id still round-trip through the
        minimal role/content shape.
        """
        sid = HistoryStore.new_session_id()
        tid = HistoryStore.new_turn_id()
        store.append_message(sid, "user", "q", turn_id=tid)
        msgs = store.get_session_messages_for_context(sid)
        assert msgs[0].get("turn_id") == tid

    def test_context_retrieval_omits_when_absent(
        self, store: HistoryStore
    ) -> None:
        """Context-load shape has no turn_id when record had none.

        Backwards-compat — the minimal role/content shape
        stays minimal for pre-turn records.
        """
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "q")
        msgs = store.get_session_messages_for_context(sid)
        assert "turn_id" not in msgs[0]

    def test_system_event_carries_turn_id(
        self, store: HistoryStore
    ) -> None:
        """System events accept and persist turn_id.

        Per specs4/3-llm/history.md § Main Store Records, system
        events fired during a turn (commit, reset, mode switch,
        compaction) inherit the triggering user message's
        turn_id so all records for the turn group together.
        """
        sid = HistoryStore.new_session_id()
        tid = HistoryStore.new_turn_id()
        store.append_message(
            sid, "user", "Committed abc1234",
            system_event=True, turn_id=tid,
        )
        msgs = store.get_session_messages(sid)
        assert msgs[0].get("system_event") is True
        assert msgs[0].get("turn_id") == tid


# ---------------------------------------------------------------------------
# JSONL resilience
# ---------------------------------------------------------------------------


class TestJsonlResilience:
    """Malformed lines don't break reads — matches specs4 contract."""

    def test_corrupt_line_skipped(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """A corrupt line (delimited by newlines) is skipped.

        Mid-write crashes that leave a partial line terminated
        by a newline (e.g. a flush that wrote header+partial-
        payload and then died before the close brace) produce
        exactly this shape: one JSON-invalid line between two
        valid lines. The reader must skip the corrupt one and
        return the rest.

        Note — a partial line WITHOUT a trailing newline, followed
        by a subsequent write, concatenates into a single bogus
        line the reader can't recover. That failure mode is
        acceptable (mid-write crashes are rare and the preceding
        record is preserved); this test pins the common case.
        """
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "first")
        # Simulate a mid-write crash that flushed a partial line
        # terminated by a newline — the next write starts on its
        # own line.
        history_file = ac_dc_dir / "history.jsonl"
        with history_file.open("a", encoding="utf-8") as fh:
            fh.write('{"role": "user", "content": "partial\n')
        # Append a subsequent valid line.
        store.append_message(sid, "user", "second")

        msgs = store.get_session_messages(sid)
        # Only the two valid messages.
        assert len(msgs) == 2
        assert [m["content"] for m in msgs] == ["first", "second"]

    def test_empty_lines_tolerated(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """Blank lines between records are skipped.

        Not something we produce, but a file edited by hand or
        concatenated from fragments could end up with blank
        lines. Must not crash.
        """
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "hi")
        # Add blank lines manually.
        history_file = ac_dc_dir / "history.jsonl"
        with history_file.open("a", encoding="utf-8") as fh:
            fh.write("\n\n\n")
        store.append_message(sid, "user", "bye")
        msgs = store.get_session_messages(sid)
        assert len(msgs) == 2

    def test_empty_file_returns_empty(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """Empty JSONL file produces no records, no error."""
        # Create an empty history file.
        history_file = ac_dc_dir / "history.jsonl"
        history_file.touch()
        assert store.list_sessions() == []
        assert store.get_session_messages("any") == []
        assert store.search_messages("anything") == []

    def test_non_existent_file_returns_empty(
        self, ac_dc_dir: Path
    ) -> None:
        """Reading before any append returns empty.

        Fresh-install case — the file hasn't been written yet.
        """
        store = HistoryStore(ac_dc_dir)
        # File doesn't exist yet.
        assert not (ac_dc_dir / "history.jsonl").exists()
        # All read methods still work.
        assert store.list_sessions() == []
        assert store.search_messages("anything") == []

    def test_non_object_line_skipped(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """A valid-JSON-but-not-an-object line is skipped.

        Someone could sneak a bare array or number into the
        file. It's valid JSON but not a message record; we
        silently skip rather than crash.
        """
        sid = HistoryStore.new_session_id()
        store.append_message(sid, "user", "valid")
        history_file = ac_dc_dir / "history.jsonl"
        with history_file.open("a", encoding="utf-8") as fh:
            fh.write('["not", "an", "object"]\n')
            fh.write("42\n")
        store.append_message(sid, "user", "also valid")
        msgs = store.get_session_messages(sid)
        assert len(msgs) == 2
        assert [m["content"] for m in msgs] == ["valid", "also valid"]


# ---------------------------------------------------------------------------
# Agent archive — Slice 2 of parallel-agents foundation
# ---------------------------------------------------------------------------


class TestAgentArchivePath:
    """``get_agent_archive_path`` returns the correct directory.

    Read-only accessor — must never create directories or fail
    on missing turn IDs. The lazy-create contract lives in
    :meth:`append_agent_message`.
    """

    def test_returns_path_under_ac_dc_agents(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """Path is ``{ac_dc_dir}/agents/{turn_id}/``."""
        tid = HistoryStore.new_turn_id()
        path = store.get_agent_archive_path(tid)
        assert path == ac_dc_dir / "agents" / tid

    def test_does_not_create_directory(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """Path accessor has no side effects.

        Pins the "turns without agents leave no disk trace"
        contract at the accessor level — a caller that just
        probes the path can't accidentally materialise the
        directory.
        """
        tid = HistoryStore.new_turn_id()
        path = store.get_agent_archive_path(tid)
        assert not path.exists()
        # The agents/ root itself should also not exist yet —
        # construction doesn't create it.
        assert not (ac_dc_dir / "agents").exists()

    def test_same_turn_id_returns_same_path(
        self, store: HistoryStore
    ) -> None:
        """Deterministic — repeated calls with same ID agree."""
        tid = HistoryStore.new_turn_id()
        path1 = store.get_agent_archive_path(tid)
        path2 = store.get_agent_archive_path(tid)
        assert path1 == path2


class TestAppendAgentMessage:
    """``append_agent_message`` writes JSONL records lazily."""

    def test_creates_directory_lazily(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """First write creates the per-turn directory.

        Pins the lazy-create rule: before the first append,
        no directory exists; after the first append, it does.
        """
        tid = HistoryStore.new_turn_id()
        turn_dir = ac_dc_dir / "agents" / tid
        assert not turn_dir.exists()

        store.append_agent_message(tid, 0, "user", "task")
        assert turn_dir.is_dir()

    def test_creates_agent_file_with_zero_padded_name(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """Agent file is ``agent-NN.jsonl`` with 2-digit padding."""
        tid = HistoryStore.new_turn_id()
        store.append_agent_message(tid, 0, "user", "msg")
        store.append_agent_message(tid, 7, "user", "msg")

        turn_dir = ac_dc_dir / "agents" / tid
        files = sorted(p.name for p in turn_dir.iterdir())
        assert files == ["agent-00.jsonl", "agent-07.jsonl"]

    def test_record_carries_turn_id_and_agent_idx(
        self, store: HistoryStore
    ) -> None:
        """Persisted record has turn_id and agent_idx."""
        tid = HistoryStore.new_turn_id()
        record = store.append_agent_message(
            tid, 3, "assistant", "reply"
        )
        assert record["turn_id"] == tid
        assert record["agent_idx"] == 3
        assert record["role"] == "assistant"
        assert record["content"] == "reply"

    def test_record_has_id_and_timestamp(
        self, store: HistoryStore
    ) -> None:
        """Generated fields present on every record."""
        tid = HistoryStore.new_turn_id()
        record = store.append_agent_message(
            tid, 0, "user", "hi"
        )
        assert record["id"]
        assert record["timestamp"]
        assert record["timestamp"].endswith("Z")

    def test_optional_session_id_persisted(
        self, store: HistoryStore
    ) -> None:
        """session_id round-trips when supplied."""
        tid = HistoryStore.new_turn_id()
        sid = HistoryStore.new_session_id()
        record = store.append_agent_message(
            tid, 0, "user", "hi", session_id=sid
        )
        assert record.get("session_id") == sid

    def test_session_id_omitted_when_none(
        self, store: HistoryStore
    ) -> None:
        """session_id absent from record when not supplied.

        Keeps records compact for the agent-archive case where
        session_id isn't needed (turn_id is the primary key).
        """
        tid = HistoryStore.new_turn_id()
        record = store.append_agent_message(
            tid, 0, "user", "hi"
        )
        assert "session_id" not in record

    def test_system_event_flag_persisted(
        self, store: HistoryStore
    ) -> None:
        """system_event=True appears on the record."""
        tid = HistoryStore.new_turn_id()
        record = store.append_agent_message(
            tid, 0, "user", "spawn", system_event=True
        )
        assert record.get("system_event") is True

    def test_system_event_absent_when_false(
        self, store: HistoryStore
    ) -> None:
        """Default system_event is omitted."""
        tid = HistoryStore.new_turn_id()
        record = store.append_agent_message(
            tid, 0, "user", "hi"
        )
        assert "system_event" not in record

    def test_image_refs_persisted(
        self, store: HistoryStore
    ) -> None:
        """image_refs list round-trips when non-empty."""
        tid = HistoryStore.new_turn_id()
        record = store.append_agent_message(
            tid, 0, "user", "look",
            image_refs=["abc123.png", "def456.jpg"],
        )
        assert record.get("image_refs") == [
            "abc123.png", "def456.jpg",
        ]

    def test_image_refs_absent_when_empty(
        self, store: HistoryStore
    ) -> None:
        """Empty or None image_refs omits the field."""
        tid = HistoryStore.new_turn_id()
        record = store.append_agent_message(
            tid, 0, "user", "hi", image_refs=[]
        )
        assert "image_refs" not in record

    def test_extra_fields_preserved(
        self, store: HistoryStore
    ) -> None:
        """extra dict merges into the record."""
        tid = HistoryStore.new_turn_id()
        record = store.append_agent_message(
            tid, 0, "assistant", "done",
            extra={
                "files_modified": ["a.py"],
                "edit_results": [{"file": "a.py", "status": "applied"}],
            },
        )
        assert record["files_modified"] == ["a.py"]
        assert record["edit_results"][0]["file"] == "a.py"

    def test_extra_cannot_override_reserved_fields(
        self, store: HistoryStore
    ) -> None:
        """Reserved contract fields are immune to extras.

        A caller passing ``extra={"turn_id": "sneaky"}`` or
        ``extra={"role": "system"}`` must not corrupt the
        record's core identity. The reserved-key filter
        guarantees the record's shape across the archival
        layer's contract.
        """
        tid = HistoryStore.new_turn_id()
        record = store.append_agent_message(
            tid, 0, "user", "content",
            extra={
                "turn_id": "sneaky",
                "agent_idx": 999,
                "role": "system",
                "content": "overwritten",
                "id": "fake-id",
                "timestamp": "2000-01-01T00:00:00Z",
            },
        )
        # All reserved fields carry the intended values.
        assert record["turn_id"] == tid
        assert record["agent_idx"] == 0
        assert record["role"] == "user"
        assert record["content"] == "content"
        # id and timestamp were generated, not "fake-id".
        assert record["id"] != "fake-id"
        assert record["timestamp"] != "2000-01-01T00:00:00Z"

    def test_appends_to_existing_agent_file(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """Multiple calls append to the same file, not overwrite.

        Pins the re-iteration contract: within one turn, agent
        N's file accumulates all messages across iterations.
        """
        tid = HistoryStore.new_turn_id()
        store.append_agent_message(tid, 0, "user", "first")
        store.append_agent_message(tid, 0, "assistant", "second")
        store.append_agent_message(tid, 0, "user", "third")

        agent_file = ac_dc_dir / "agents" / tid / "agent-00.jsonl"
        content = agent_file.read_text(encoding="utf-8")
        lines = [line for line in content.splitlines() if line]
        assert len(lines) == 3

    def test_different_agents_different_files(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """Two agents in one turn write to separate files."""
        tid = HistoryStore.new_turn_id()
        store.append_agent_message(tid, 0, "user", "a0 msg")
        store.append_agent_message(tid, 1, "user", "a1 msg")

        turn_dir = ac_dc_dir / "agents" / tid
        a0_file = turn_dir / "agent-00.jsonl"
        a1_file = turn_dir / "agent-01.jsonl"
        assert a0_file.is_file()
        assert a1_file.is_file()
        assert "a0 msg" in a0_file.read_text(encoding="utf-8")
        assert "a1 msg" in a1_file.read_text(encoding="utf-8")

    def test_different_turns_different_directories(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """Two turns produce two archive directories."""
        tid1 = HistoryStore.new_turn_id()
        tid2 = HistoryStore.new_turn_id()
        store.append_agent_message(tid1, 0, "user", "turn1")
        store.append_agent_message(tid2, 0, "user", "turn2")

        agents_root = ac_dc_dir / "agents"
        dirs = sorted(p.name for p in agents_root.iterdir())
        assert tid1 in dirs
        assert tid2 in dirs

    def test_rejects_empty_turn_id(
        self, store: HistoryStore
    ) -> None:
        """Empty turn_id raises ValueError."""
        with pytest.raises(ValueError, match="turn_id"):
            store.append_agent_message("", 0, "user", "hi")

    def test_rejects_negative_agent_idx(
        self, store: HistoryStore
    ) -> None:
        """Negative agent_idx raises ValueError."""
        tid = HistoryStore.new_turn_id()
        with pytest.raises(ValueError, match="agent_idx"):
            store.append_agent_message(tid, -1, "user", "hi")

    def test_rejects_invalid_role(
        self, store: HistoryStore
    ) -> None:
        """Roles other than user/assistant raise ValueError."""
        tid = HistoryStore.new_turn_id()
        with pytest.raises(ValueError, match="role"):
            store.append_agent_message(
                tid, 0, "system", "hi"
            )

    def test_large_agent_idx_pads_to_two_digits(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """agent_idx=99 still uses 2-digit padding."""
        tid = HistoryStore.new_turn_id()
        store.append_agent_message(tid, 99, "user", "msg")
        turn_dir = ac_dc_dir / "agents" / tid
        files = [p.name for p in turn_dir.iterdir()]
        assert files == ["agent-99.jsonl"]


class TestGetTurnArchive:
    """``get_turn_archive`` reads per-agent files and orders them."""

    def test_missing_directory_returns_empty(
        self, store: HistoryStore
    ) -> None:
        """Turn with no archive directory produces empty list.

        Covers both cases where it matters: a turn that didn't
        spawn agents, and a turn whose archive was deleted.
        Both return the same shape so the frontend has one
        code path.
        """
        tid = HistoryStore.new_turn_id()
        result = store.get_turn_archive(tid)
        assert result == []

    def test_single_agent_single_message(
        self, store: HistoryStore
    ) -> None:
        """One agent, one message returns the expected shape."""
        tid = HistoryStore.new_turn_id()
        store.append_agent_message(tid, 0, "user", "task")

        result = store.get_turn_archive(tid)
        assert len(result) == 1
        assert result[0]["agent_idx"] == 0
        assert len(result[0]["messages"]) == 1
        assert result[0]["messages"][0]["content"] == "task"

    def test_multiple_agents_sorted_by_idx(
        self, store: HistoryStore
    ) -> None:
        """Agents returned in index-ascending order.

        Critical for the frontend's left-to-right column
        rendering: the iteration order of ``os.listdir`` is
        not defined on many filesystems, so we must sort.
        """
        tid = HistoryStore.new_turn_id()
        # Append out of order to stress the sort.
        store.append_agent_message(tid, 2, "user", "a2")
        store.append_agent_message(tid, 0, "user", "a0")
        store.append_agent_message(tid, 1, "user", "a1")

        result = store.get_turn_archive(tid)
        assert [entry["agent_idx"] for entry in result] == [
            0, 1, 2,
        ]

    def test_messages_in_write_order(
        self, store: HistoryStore
    ) -> None:
        """An agent's messages come back in write order."""
        tid = HistoryStore.new_turn_id()
        store.append_agent_message(tid, 0, "user", "first")
        store.append_agent_message(tid, 0, "assistant", "second")
        store.append_agent_message(tid, 0, "user", "third")

        result = store.get_turn_archive(tid)
        messages = result[0]["messages"]
        assert [m["content"] for m in messages] == [
            "first", "second", "third",
        ]

    def test_records_carry_full_metadata(
        self, store: HistoryStore
    ) -> None:
        """Retrieved records preserve every field from append.

        The retrieval path is lossless — optional fields
        (system_event, image_refs, extras) all round-trip.
        Agent-browser UI needs full metadata to render card
        content correctly.
        """
        tid = HistoryStore.new_turn_id()
        sid = HistoryStore.new_session_id()
        store.append_agent_message(
            tid, 0, "user", "task",
            session_id=sid,
            system_event=True,
            image_refs=["foo.png"],
            extra={"files_modified": ["x.py"]},
        )

        result = store.get_turn_archive(tid)
        msg = result[0]["messages"][0]
        assert msg["turn_id"] == tid
        assert msg["agent_idx"] == 0
        assert msg["session_id"] == sid
        assert msg["system_event"] is True
        assert msg["image_refs"] == ["foo.png"]
        assert msg["files_modified"] == ["x.py"]

    def test_corrupt_line_skipped(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """Corrupt JSON lines inside an agent file don't break reads.

        Mirrors :class:`TestJsonlResilience` — mid-write crashes
        leave partial lines that the per-line parse tolerates.
        The agent archive must be as robust as the main store.
        """
        tid = HistoryStore.new_turn_id()
        store.append_agent_message(tid, 0, "user", "first")
        # Corrupt the file by appending a partial line.
        agent_file = ac_dc_dir / "agents" / tid / "agent-00.jsonl"
        with agent_file.open("a", encoding="utf-8") as fh:
            fh.write('{"role": "user", "content": "partial\n')
        # Append a valid line after.
        store.append_agent_message(tid, 0, "user", "second")

        result = store.get_turn_archive(tid)
        contents = [
            m["content"] for m in result[0]["messages"]
        ]
        assert contents == ["first", "second"]

    def test_non_agent_files_ignored(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """Files that don't match agent-NN.jsonl are skipped.

        The directory could contain stray files (a user's
        ``.DS_Store`` on macOS, a README someone dropped in).
        The reader must tolerate them without breaking.
        """
        tid = HistoryStore.new_turn_id()
        store.append_agent_message(tid, 0, "user", "hi")

        # Drop a garbage file alongside.
        turn_dir = ac_dc_dir / "agents" / tid
        (turn_dir / "README").write_text("not an agent file")
        (turn_dir / ".DS_Store").write_text("mac junk")
        (turn_dir / "agent.jsonl").write_text(
            "missing-NN suffix"
        )

        result = store.get_turn_archive(tid)
        # Only agent-00.jsonl was read.
        assert len(result) == 1
        assert result[0]["agent_idx"] == 0

    def test_empty_turn_directory_returns_empty(
        self, store: HistoryStore, ac_dc_dir: Path
    ) -> None:
        """Turn directory exists but has no agent files.

        Edge case: directory created by an earlier attempt that
        failed before writing, or a manual mkdir. Don't crash,
        just return nothing.
        """
        tid = HistoryStore.new_turn_id()
        (ac_dc_dir / "agents" / tid).mkdir(parents=True)
        result = store.get_turn_archive(tid)
        assert result == []