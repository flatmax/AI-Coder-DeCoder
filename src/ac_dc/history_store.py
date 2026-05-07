"""Persistent conversation history — append-only JSONL store.

Stores one JSON record per line in ``.ac-dc4/history.jsonl`` under
the repo root. Each record captures one user or assistant message
plus enough metadata to reconstruct the conversation on session
load: role, content, timestamp, session ID, and optional fields
for files-in-context, files modified, edit results, and image
references.

Image data URIs pasted into messages are decoded and saved as
separate files in ``.ac-dc4/images/`` so the JSONL file itself
doesn't balloon with megabytes of base64 per image. The filename
is ``{epoch_ms}-{sha256_prefix}.{ext}`` — deterministic per
content, so re-pasting the same image produces one file on disk.
Matches specs4/4-features/images.md's content-hash dedup rule.

Design points pinned by specs4/3-llm/history.md:

- **Append-only.** Every write is an append to the JSONL file.
  Mid-write crashes leave partial lines which are tolerated by
  the reader (per-line JSON parse with warning-log on failure).
- **Write-before-broadcast.** The streaming handler persists the
  user message before the LLM call starts — intentional so a
  mid-stream crash preserves user intent rather than losing it.
- **Session IDs group messages.** No dedicated "session"
  document exists on disk; sessions are emergent from the set
  of records sharing a session_id. Listing sessions is a scan.
- **Retrieval asymmetry.** Two read paths exist:
  ``get_session_messages`` returns full metadata for the history
  browser; ``get_session_messages_for_context`` returns a
  compact role/content shape with reconstructed image data URIs
  for loading into a context manager.

Governing spec: ``specs4/3-llm/history.md``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Module constants
# ---------------------------------------------------------------------------
#
# The per-repo working directory name matches the config module's
# constant. Not imported to avoid a circular dependency — the history
# store must work with any directory its caller hands it, and in
# practice the caller (LLMService) composes the path from repo_root.

_HISTORY_FILENAME = "history.jsonl"
_IMAGES_DIRNAME = "images"

# Agent turn archive layout. Per specs4/3-llm/history.md § Agent
# Turn Archive, agent conversations live under
# ``.ac-dc4/agents/{turn_id}/agent-NN.jsonl`` — one directory per
# turn that spawned agents, one JSONL file per agent. The
# directories are created lazily on first write so turns that
# didn't spawn agents never touch the agents/ tree.
_AGENTS_DIRNAME = "agents"

# Agent file name pattern. Zero-padded to 2 digits so
# filesystem-sort order matches agent-index order. Beyond
# 99 agents the padding would need to extend, but realistic
# turns spawn 2-8 agents; a future refactor can widen without
# breaking existing archives because the pattern validates
# "digits only" rather than "exactly two digits".
_AGENT_FILE_REGEX = re.compile(r"^agent-(\d+)\.jsonl$")

# Preview length in the session-list summary. Long enough to
# disambiguate sessions, short enough to fit one line in the
# history browser UI.
_PREVIEW_MAX_CHARS = 100

# MIME to file extension. Used when saving a pasted image data
# URI. Covers every image format any modern browser will paste;
# unknown MIMEs fall through to ``.png`` which renders correctly
# in practice since browsers tolerate mislabelled-as-PNG decoding
# for real PNG payloads.
_MIME_TO_EXT: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
}

# Extension to MIME — reverse lookup for reconstructing data URIs
# on session load. Includes ``.jpeg`` (written as ``.jpg`` on
# save, but historical records might contain ``.jpeg``). Unknown
# extensions fall back to ``application/octet-stream`` which
# renders as a broken image but doesn't crash the UI.
_EXT_TO_MIME: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}


# ---------------------------------------------------------------------------
# Session summary shape
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SessionSummary:
    """One-line description of a session for the history browser.

    Built on demand by :meth:`HistoryStore.list_sessions` — no
    per-session record exists on disk. Frozen so callers can put
    these in sets or use them as dict keys if they want.
    """

    session_id: str
    timestamp: str
    message_count: int
    preview: str
    first_role: str


# ---------------------------------------------------------------------------
# HistoryStore
# ---------------------------------------------------------------------------


class HistoryStore:
    """Append-only JSONL conversation history with image persistence.

    Constructor takes the per-repo ``.ac-dc/`` directory path
    (typically from :attr:`ConfigManager.ac_dc_dir`). Creates the
    JSONL file and images subdirectory if they don't exist.

    All read methods open the JSONL file fresh each call — no
    caching, no lock. The JSONL file format is forward-compatible:
    older records with missing fields are tolerated, newer records
    with extra fields round-trip through the JSON load.
    """

    def __init__(self, ac_dc_dir: Path | str) -> None:
        """Initialise the store against an existing working directory.

        Parameters
        ----------
        ac_dc_dir:
            Path to the per-repo ``.ac-dc/`` directory. Must
            already exist or be creatable — the constructor
            creates it (and the nested ``images/`` subdirectory)
            if missing. Typically supplied as
            :attr:`ConfigManager.ac_dc_dir`.
        """
        self._ac_dc_dir = Path(ac_dc_dir)
        self._history_file = self._ac_dc_dir / _HISTORY_FILENAME
        self._images_dir = self._ac_dc_dir / _IMAGES_DIRNAME
        # Agents root — parent of per-turn subdirectories. Not
        # created here; we create it lazily on the first
        # per-turn write so turns that never spawn agents leave
        # no trace on disk (per spec). The per-turn subdirectory
        # itself is the lazy-create boundary.
        self._agents_dir = self._ac_dc_dir / _AGENTS_DIRNAME
        # Create directories on construction. This is idempotent —
        # ConfigManager also creates .ac-dc/images/ on init, so
        # whichever runs first wins and the other is a no-op.
        self._ac_dc_dir.mkdir(parents=True, exist_ok=True)
        self._images_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Session ID generation
    # ------------------------------------------------------------------

    @staticmethod
    def new_session_id() -> str:
        """Generate a fresh session ID.

        Format — ``sess_{epoch_ms}_{6-char-hex}``. The epoch
        prefix orders sessions chronologically in filesystem and
        alphabetical sorts; the random suffix breaks ties on the
        same-millisecond case (rare but possible in tests).
        """
        epoch_ms = int(time.time() * 1000)
        suffix = uuid.uuid4().hex[:6]
        return f"sess_{epoch_ms}_{suffix}"

    @staticmethod
    def new_turn_id() -> str:
        """Generate a fresh turn ID.

        Format — ``turn_{epoch_ms}_{6-char-hex}``. Matches the
        session ID convention (same prefix-epoch-suffix shape)
        so IDs from the two namespaces are visually
        distinguishable but structurally uniform. Per
        specs4/3-llm/history.md § Turns and
        specs-reference/3-llm/history.md § Session ID, turn IDs
        are globally unique across sessions and agent archives
        are keyed by them.

        A turn covers one user request from the user message
        through the final assistant response. In non-agent mode
        a turn contains a single LLM call; in agent mode a turn
        may spawn N agents across multiple iteration rounds —
        the turn ID groups every record the request produces.
        """
        epoch_ms = int(time.time() * 1000)
        suffix = uuid.uuid4().hex[:6]
        return f"turn_{epoch_ms}_{suffix}"

    @staticmethod
    def _new_message_id() -> str:
        """Generate a message ID.

        Format — ``{epoch_ms}-{8-char-hex}``. Distinct from
        session IDs so a stray cross-collision is impossible.
        """
        epoch_ms = int(time.time() * 1000)
        suffix = uuid.uuid4().hex[:8]
        return f"{epoch_ms}-{suffix}"

    @staticmethod
    def _now_iso() -> str:
        """Return the current UTC time as an ISO 8601 string.

        Timestamp format used throughout the store. ISO 8601 with
        the ``Z`` suffix is unambiguous across locales and sorts
        lexicographically in the same order as chronologically,
        which the session lister relies on.
        """
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # ------------------------------------------------------------------
    # Image persistence
    # ------------------------------------------------------------------

    def _save_image(self, data_uri: str) -> str | None:
        """Save one base64 data URI to disk and return its filename.

        Filename is ``{epoch_ms}-{content_hash}.{ext}``:

        - ``epoch_ms`` gives chronological sort order in the
          images directory.
        - ``content_hash`` (first 12 hex chars of SHA-256 over
          the raw data URI string) guarantees identical images
          produce identical filenames — re-pasting the same image
          in a later message doesn't duplicate it on disk.
        - ``ext`` comes from the declared MIME, falling back to
          ``.png`` for unknown MIMEs.

        The save is idempotent — if the file already exists with
        the same name, we skip the write and return the name
        unchanged. Malformed data URIs return None and the caller
        omits them from the record.
        """
        if not data_uri or not data_uri.startswith("data:"):
            return None
        try:
            # Format: data:{mime};base64,{payload}
            header, _, payload = data_uri.partition(",")
            if not payload or ";base64" not in header:
                # Not a base64 data URI — unsupported.
                return None
            mime = header[len("data:"):].split(";", 1)[0].strip().lower()
        except Exception as exc:
            logger.debug("Malformed image data URI: %s", exc)
            return None

        ext = _MIME_TO_EXT.get(mime, ".png")
        hash_prefix = hashlib.sha256(
            data_uri.encode("utf-8")
        ).hexdigest()[:12]
        # Filename is purely content-addressed: same data URI →
        # same filename, every time. An earlier draft prefixed
        # the name with an epoch timestamp for chronological sort
        # order, but that broke idempotence — every call produced
        # a different filename, so the exists-check never matched
        # a prior save and duplicates accumulated on disk. The
        # test suite (test_duplicate_image_deduplicated) pins the
        # one-file-per-content-hash contract; chronological order
        # can be recovered from the filesystem mtime if needed.
        filename = f"{hash_prefix}{ext}"
        path = self._images_dir / filename

        if path.exists():
            # Content-addressed by hash — if a file with this
            # exact name exists it's the same payload. Skip the
            # decode + write.
            return filename

        try:
            import base64

            raw = base64.b64decode(payload, validate=False)
        except Exception as exc:
            logger.debug(
                "Failed to decode image payload: %s", exc
            )
            return None

        try:
            path.write_bytes(raw)
        except OSError as exc:
            logger.warning(
                "Failed to write image %s: %s", filename, exc
            )
            return None
        return filename

    def _reconstruct_image(self, filename: str) -> str | None:
        """Read an image file back and return its data URI.

        Used during session load so the chat panel can render
        thumbnails without an extra RPC round-trip per image.
        Missing files log at debug level and return None —
        callers (the context retrieval path) skip None entries.

        MIME is detected from the file extension via
        :data:`_EXT_TO_MIME`. Unknown extensions fall back to
        ``application/octet-stream`` which the browser renders as
        a broken image rather than crashing.
        """
        path = self._images_dir / filename
        try:
            raw = path.read_bytes()
        except OSError:
            logger.debug("Image file missing: %s", filename)
            return None

        import base64

        suffix = path.suffix.lower()
        mime = _EXT_TO_MIME.get(suffix, "application/octet-stream")
        payload = base64.b64encode(raw).decode("ascii")
        return f"data:{mime};base64,{payload}"

    # ------------------------------------------------------------------
    # Append
    # ------------------------------------------------------------------

    def append_message(
        self,
        session_id: str,
        role: str,
        content: str,
        *,
        files: list[str] | None = None,
        images: list[str] | int | None = None,
        files_modified: list[str] | None = None,
        edit_results: list[dict[str, Any]] | None = None,
        system_event: bool = False,
        turn_id: str | None = None,
    ) -> dict[str, Any]:
        """Append one message to the JSONL store.

        Parameters
        ----------
        session_id:
            The session this message belongs to. Caller manages
            session identity; the store never generates session
            IDs implicitly.
        role:
            ``"user"`` or ``"assistant"``. System-event messages
            use ``role="user"`` with ``system_event=True`` so the
            LLM sees them in context — a separate role would
            require per-provider mapping.
        content:
            The message text.
        files:
            Optional list of repo-relative paths that were in
            context when the user sent this message (user
            messages only). Persisted for the history browser;
            not used by the context retrieval path.
        images:
            Optional list of base64 data URIs to save as
            separate files. Accepts an ``int`` count as a
            legacy shape — records with integer counts load
            back without images (the images weren't saved
            at write time). New callers should always pass
            the data URI list.
        files_modified:
            Optional list of repo-relative paths modified by
            this assistant message's edits.
        edit_results:
            Optional per-edit status records for the history
            browser (status, error, old/new previews).
        system_event:
            When True, marks this message as a system event
            (commit, reset, mode switch) — rendered distinctly
            in the chat UI.
        turn_id:
            Optional turn identifier grouping this record with
            other records produced by the same user request.
            Per specs4/3-llm/history.md § Turns, every record
            in a turn (user message, assistant response, any
            system events fired during the turn, and the
            compaction event if one fires post-response) carries
            the same turn_id. The turn_id is generated at the
            top of the streaming pipeline and propagated
            through. Omitted from records whose callers haven't
            yet adopted turn propagation — readers tolerate its
            absence and the chat panel simply does not offer
            the "show agents" affordance for records lacking it.

        Returns
        -------
        dict
            The full record that was persisted. Includes the
            generated ``id`` and ``timestamp`` so callers can
            use the ID for follow-up lookups.
        """
        # Image handling — convert a data-URI list to filename
        # refs, or pass through an integer count for legacy
        # compatibility. Anything else (None, empty list) omits
        # the image fields entirely.
        image_refs: list[str] | None = None
        image_count_legacy: int | None = None
        if isinstance(images, list):
            saved: list[str] = []
            for uri in images:
                if not isinstance(uri, str):
                    continue
                name = self._save_image(uri)
                if name is not None:
                    saved.append(name)
            if saved:
                image_refs = saved
        elif isinstance(images, int):
            # Legacy shape — we don't have the image data, just
            # the count. Record it but never try to reconstruct.
            if images > 0:
                image_count_legacy = images

        record: dict[str, Any] = {
            "id": self._new_message_id(),
            "session_id": session_id,
            "timestamp": self._now_iso(),
            "role": role,
            "content": content,
        }
        if system_event:
            record["system_event"] = True
        if turn_id:
            # Omitted when None or empty so records predating
            # turn-ID adoption stay byte-identical to their
            # current shape; readers tolerate the absence.
            record["turn_id"] = turn_id
        if files:
            record["files"] = list(files)
        if image_refs is not None:
            record["image_refs"] = image_refs
        elif image_count_legacy is not None:
            record["images"] = image_count_legacy
        if files_modified:
            record["files_modified"] = list(files_modified)
        if edit_results:
            record["edit_results"] = list(edit_results)

        # Append one line. Open in append-text mode; on POSIX
        # this is atomic for a single write call under the pipe
        # buffer size (4096 bytes), which JSONL records easily
        # fit within. Crashes mid-write leave a partial line
        # that the reader's per-line try/except tolerates.
        line = json.dumps(record, ensure_ascii=False)
        with self._history_file.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
        return record

    # ------------------------------------------------------------------
    # Raw record iteration
    # ------------------------------------------------------------------

    def _iter_records(self) -> list[dict[str, Any]]:
        """Read and parse the JSONL file, skipping corrupt lines.

        Returns all records in write order. Lines that fail JSON
        parse (from mid-write crashes) are logged at warning
        level and skipped — matches the specs4 contract.
        """
        if not self._history_file.exists():
            return []
        records: list[dict[str, Any]] = []
        with self._history_file.open(
            "r", encoding="utf-8", errors="replace"
        ) as fh:
            for i, raw in enumerate(fh, start=1):
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    record = json.loads(raw)
                except json.JSONDecodeError as exc:
                    logger.warning(
                        "Skipping corrupt history line %d: %s",
                        i, exc,
                    )
                    continue
                if isinstance(record, dict):
                    records.append(record)
                else:
                    logger.warning(
                        "Skipping history line %d: not an object", i
                    )
        return records

    # ------------------------------------------------------------------
    # Session listing
    # ------------------------------------------------------------------

    def list_sessions(
        self, limit: int | None = None
    ) -> list[SessionSummary]:
        """Return session summaries sorted newest-first.

        Parameters
        ----------
        limit:
            Optional cap on the number of sessions returned.
            Applied after sorting so ``limit=1`` reliably gives
            the newest session (what auto-restore needs).

        Returns
        -------
        list[SessionSummary]
            One summary per distinct session ID. ``timestamp``
            is the newest message's timestamp; ``preview`` is
            the first ~100 chars of the first message's content;
            ``first_role`` is that first message's role.
        """
        records = self._iter_records()
        if not records:
            return []

        # Group by session_id, keeping first and last records.
        first_by_session: dict[str, dict[str, Any]] = {}
        last_by_session: dict[str, dict[str, Any]] = {}
        count_by_session: dict[str, int] = {}
        for rec in records:
            sid = rec.get("session_id")
            if not isinstance(sid, str):
                continue
            if sid not in first_by_session:
                first_by_session[sid] = rec
            last_by_session[sid] = rec
            count_by_session[sid] = count_by_session.get(sid, 0) + 1

        summaries: list[SessionSummary] = []
        for sid, first in first_by_session.items():
            last = last_by_session[sid]
            content = first.get("content", "") or ""
            preview = content[:_PREVIEW_MAX_CHARS]
            if len(content) > _PREVIEW_MAX_CHARS:
                preview = preview.rstrip() + "…"
            summaries.append(
                SessionSummary(
                    session_id=sid,
                    timestamp=last.get("timestamp", ""),
                    message_count=count_by_session[sid],
                    preview=preview,
                    first_role=first.get("role", "user"),
                )
            )

        # Sort by latest-message timestamp descending (newest
        # first). ISO 8601 lexicographic sort matches
        # chronological sort so a plain string comparison is
        # correct here.
        summaries.sort(key=lambda s: s.timestamp, reverse=True)
        if limit is not None:
            summaries = summaries[:limit]
        return summaries

    # ------------------------------------------------------------------
    # Session retrieval — full vs context-ready
    # ------------------------------------------------------------------

    def get_session_messages(
        self, session_id: str
    ) -> list[dict[str, Any]]:
        """Return every message in a session with full metadata.

        Used by the history browser, which needs all the fields
        (files, files_modified, edit_results, image_refs) to
        render its detail view. Order is write order, which is
        also chronological given monotonic epoch timestamps.

        ``image_refs`` (the on-disk filenames) is preserved for
        diagnostics, and an ``images`` field is added alongside
        carrying the reconstructed base64 data URIs so the
        browser can render thumbnails without a second RPC.
        Missing image files are silently skipped — a broken
        images directory never prevents browsing. Legacy
        records carrying an integer ``images`` field yield
        no ``images`` list (same behaviour as the
        context-retrieval path).

        Returns an empty list for unknown session IDs — never
        raises. The browser handles empty sessions gracefully.
        """
        result: list[dict[str, Any]] = []
        for rec in self._iter_records():
            if rec.get("session_id") != session_id:
                continue
            shape = dict(rec)
            refs = shape.get("image_refs")
            if isinstance(refs, list) and refs:
                uris: list[str] = []
                for name in refs:
                    if not isinstance(name, str):
                        continue
                    uri = self._reconstruct_image(name)
                    if uri is not None:
                        uris.append(uri)
                if uris:
                    shape["images"] = uris
            result.append(shape)
        return result

    def get_session_messages_for_context(
        self, session_id: str
    ) -> list[dict[str, Any]]:
        """Return session messages in the shape context-load expects.

        Strips history-browser metadata (files, edit_results,
        etc.) and keeps only role + content, with one
        reconstruction: ``image_refs`` becomes an ``images``
        list of data URIs so the chat panel can render
        thumbnails without extra RPC calls.

        Missing image files are silently skipped — a broken
        images directory should never prevent a session reload.
        Legacy records with an integer ``images`` count yield
        messages without images (same behaviour as specs4
        documented for backward compatibility).
        """
        result: list[dict[str, Any]] = []
        for rec in self._iter_records():
            if rec.get("session_id") != session_id:
                continue
            shape: dict[str, Any] = {
                "role": rec.get("role", "user"),
                "content": rec.get("content", ""),
            }
            # turn_id rides along so a restored session keeps
            # the "show agents" affordance for records that
            # had it. Records predating turn-ID adoption omit
            # the field; readers must tolerate its absence.
            turn_id = rec.get("turn_id")
            if isinstance(turn_id, str) and turn_id:
                shape["turn_id"] = turn_id
            refs = rec.get("image_refs")
            if isinstance(refs, list) and refs:
                uris: list[str] = []
                for name in refs:
                    if not isinstance(name, str):
                        continue
                    uri = self._reconstruct_image(name)
                    if uri is not None:
                        uris.append(uri)
                if uris:
                    shape["images"] = uris
            result.append(shape)
        return result

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def search_messages(
        self,
        query: str,
        *,
        role: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        """Case-insensitive substring search across message content.

        Parameters
        ----------
        query:
            Search term. Empty or whitespace-only queries return
            an empty list immediately (cheap guard so typing an
            empty box in the UI doesn't scan the whole file).
        role:
            Optional role filter — ``"user"`` or ``"assistant"``.
            System-event messages use ``role="user"`` so they
            match a user-role filter (intentional — users may
            want to search for commit messages recorded as system
            events).
        limit:
            Optional cap on returned hits. Hits are ordered by
            write order (oldest first).

        Returns
        -------
        list[dict]
            One entry per matching message:
            ``{session_id, message_id, role, content_preview, timestamp}``.
            The preview is truncated to :data:`_PREVIEW_MAX_CHARS`
            so a huge assistant message doesn't bloat the
            response.
        """
        needle = (query or "").strip().lower()
        if not needle:
            return []
        hits: list[dict[str, Any]] = []
        for rec in self._iter_records():
            if role and rec.get("role") != role:
                continue
            content = rec.get("content", "") or ""
            if not isinstance(content, str):
                continue
            if needle not in content.lower():
                continue
            preview = content[:_PREVIEW_MAX_CHARS]
            if len(content) > _PREVIEW_MAX_CHARS:
                preview = preview.rstrip() + "…"
            hits.append({
                "session_id": rec.get("session_id", ""),
                "message_id": rec.get("id", ""),
                "role": rec.get("role", "user"),
                "content_preview": preview,
                "timestamp": rec.get("timestamp", ""),
            })
            if limit is not None and len(hits) >= limit:
                break
        return hits

    # ------------------------------------------------------------------
    # Agent turn archive — Slice 2 of parallel-agents foundation
    # ------------------------------------------------------------------

    def get_agent_archive_path(self, turn_id: str) -> Path:
        """Return the archive directory path for ``turn_id``.

        Does NOT create the directory — this is a path accessor,
        not a mutator. Callers that intend to write use
        :meth:`append_agent_message` which creates the directory
        lazily as part of the append.

        Used by read-side callers (loader, UI RPC) to check
        existence without side effects. A future cleanup affordance
        (per specs4/3-llm/history.md § Disk Usage Monitoring) will
        iterate the agents/ directory and use this helper to map
        turn IDs back to their on-disk locations.

        Parameters
        ----------
        turn_id:
            The turn identifier. Must match
            :meth:`new_turn_id`'s format — non-empty string
            matching ``turn_{digits}_{hex}``. Invalid turn IDs
            still return a path (the helper doesn't validate
            the shape), but callers that plan to write should
            supply IDs produced by :meth:`new_turn_id`.

        Returns
        -------
        Path
            ``{ac_dc_dir}/agents/{turn_id}/``. The directory may
            or may not exist on disk.
        """
        return self._agents_dir / turn_id

    def append_agent_message(
        self,
        turn_id: str,
        agent_idx: int,
        role: str,
        content: str,
        *,
        session_id: str | None = None,
        system_event: bool = False,
        image_refs: list[str] | None = None,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Append one message to an agent's archive file.

        Creates the turn's archive directory lazily on first call —
        the path ``{ac_dc_dir}/agents/{turn_id}/`` materialises only
        when a turn actually produces agent output. Per spec, turns
        that did not spawn agents leave no trace on disk.

        Writes to ``agent-NN.jsonl`` where ``NN`` is
        ``agent_idx`` zero-padded to 2 digits. Re-iteration within
        a turn (main LLM spawns agents, reviews, spawns different
        agents with revised scope) appends to the existing per-agent
        file rather than creating a new one — so ``agent-00.jsonl``
        contains ALL iterations of agent 0 within that turn, with
        iteration boundaries implicit in the conversation flow.

        Parameters
        ----------
        turn_id:
            The turn identifier from
            :meth:`HistoryStore.new_turn_id`. The archive directory
            is keyed by this value.
        agent_idx:
            Zero-based agent index within the turn. Stable across
            iterations — agent 0 in iteration 2 writes to the same
            file as agent 0 in iteration 1. Must be non-negative.
        role:
            ``"user"`` or ``"assistant"``. Agent ContextManagers
            record their initial prompt as ``role="user"`` (the
            task string from the main LLM's spawn block) and their
            responses as ``role="assistant"``.
        content:
            The message text.
        session_id:
            Optional session identifier for back-reference to the
            user session that triggered this turn. Matches the
            main store's convention — every record carries a
            session_id. When None, the record omits the field
            (legal for agent archives since they're scoped by
            turn_id rather than session_id).
        system_event:
            Marks operational events (agent spawn, review
            directives). Distinct from the main store's system
            events — agents rarely fire them, but the flag exists
            for symmetry.
        image_refs:
            Optional list of image filenames (from the main
            store's images/ directory). Agents can reference
            images the user pasted into the triggering turn; the
            archive records the reference but the image bytes
            stay in the shared images/ directory, not duplicated
            per agent.
        extra:
            Additional fields to stash on the record (e.g.,
            ``edit_results``, ``files_modified`` if the agent
            emitted edits). Forwarded unchanged; the store
            doesn't interpret them.

        Returns
        -------
        dict
            The full record that was persisted. Includes the
            generated ``id``, ``timestamp``, and ``turn_id`` so
            callers can use the ID for follow-up correlation.

        Raises
        ------
        ValueError
            If ``turn_id`` is empty, ``agent_idx`` is negative, or
            ``role`` is not one of the expected values. These are
            programmer errors — the agent-spawning path should
            never produce invalid inputs.
        """
        if not turn_id:
            raise ValueError("turn_id must be non-empty")
        if agent_idx < 0:
            raise ValueError(
                f"agent_idx must be non-negative, got {agent_idx}"
            )
        if role not in ("user", "assistant"):
            raise ValueError(
                f"role must be 'user' or 'assistant', got {role!r}"
            )

        # Lazy directory creation. Two-level mkdir — agents/ and
        # agents/{turn_id}/ — handled by a single ``parents=True``
        # call. exist_ok covers concurrent writes from multiple
        # agents on the same turn (the Slice 6 parallel-execution
        # case).
        turn_dir = self._agents_dir / turn_id
        turn_dir.mkdir(parents=True, exist_ok=True)

        agent_file = turn_dir / f"agent-{agent_idx:02d}.jsonl"

        # Build the record. Shape mirrors ``append_message`` so a
        # future loader can reuse the parsing path. Optional
        # fields are omitted when unset to keep records compact.
        record: dict[str, Any] = {
            "id": self._new_message_id(),
            "turn_id": turn_id,
            "agent_idx": agent_idx,
            "timestamp": self._now_iso(),
            "role": role,
            "content": content,
        }
        if session_id:
            record["session_id"] = session_id
        if system_event:
            record["system_event"] = True
        if image_refs:
            record["image_refs"] = list(image_refs)
        if extra:
            # Shallow merge. Caller-supplied keys take precedence
            # over defaults except the ones we've already set
            # above — those are contract fields and must not be
            # overridden by extras. Filter defensively.
            reserved = {
                "id", "turn_id", "agent_idx", "timestamp",
                "role", "content",
            }
            for key, value in extra.items():
                if key not in reserved:
                    record[key] = value

        # Append one line. Same atomic-within-pipe-buffer guarantee
        # as the main store's append_message. Mid-write crashes
        # leave partial lines that the reader's per-line try/except
        # tolerates.
        line = json.dumps(record, ensure_ascii=False)
        with agent_file.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
        return record

    def get_turn_archive(
        self, turn_id: str
    ) -> list[dict[str, Any]]:
        """Return every agent's conversation for a turn.

        Reads every ``agent-NN.jsonl`` file under
        ``{ac_dc_dir}/agents/{turn_id}/`` and returns them as an
        ordered list keyed by agent index. Missing directory
        (turn did not spawn agents, or archive was deleted)
        produces an empty list.

        Returns
        -------
        list[dict]
            One entry per agent, sorted by ``agent_idx`` ascending.
            Each entry:

            - ``agent_idx`` — zero-based integer index
            - ``messages`` — list of record dicts in write order

            Empty list when the turn has no archive directory or
            the directory exists but contains no readable
            ``agent-NN.jsonl`` files.

        Notes
        -----
        Returns a list rather than a dict because JSON-RPC doesn't
        serialise integer keys and the frontend's agent-browser
        iterates in order anyway. A list preserves ordering across
        the transport boundary without the frontend having to
        re-sort.

        Corrupt JSON lines within a file are skipped with a warning
        log (same discipline as :meth:`_iter_records` for the
        main store). A file that fails to open entirely is also
        logged and skipped — the other agents' files still load.
        """
        turn_dir = self._agents_dir / turn_id
        if not turn_dir.is_dir():
            return []

        # Collect and sort agent files. Sort by the captured
        # agent_idx rather than the filename so padding changes
        # (if we ever widen past 2 digits) don't break ordering.
        agent_entries: list[tuple[int, Path]] = []
        try:
            for entry in turn_dir.iterdir():
                if not entry.is_file():
                    continue
                match = _AGENT_FILE_REGEX.match(entry.name)
                if match is None:
                    continue
                agent_idx = int(match.group(1))
                agent_entries.append((agent_idx, entry))
        except OSError as exc:
            logger.warning(
                "Failed to list agent archive for turn %s: %s",
                turn_id, exc,
            )
            return []

        agent_entries.sort(key=lambda pair: pair[0])

        result: list[dict[str, Any]] = []
        for agent_idx, agent_file in agent_entries:
            messages = self._read_agent_file(agent_file)
            result.append({
                "agent_idx": agent_idx,
                "messages": messages,
            })
        return result

    def _read_agent_file(
        self, path: Path
    ) -> list[dict[str, Any]]:
        """Parse one agent archive file, skipping corrupt lines.

        Mirrors :meth:`_iter_records` for the main store —
        per-line try/except, corrupt lines logged at warning,
        non-dict records skipped. Missing file returns an empty
        list rather than raising (defensive — the caller just
        enumerated the directory, but a concurrent delete is
        possible).
        """
        records: list[dict[str, Any]] = []
        try:
            with path.open(
                "r", encoding="utf-8", errors="replace"
            ) as fh:
                for i, raw in enumerate(fh, start=1):
                    raw = raw.strip()
                    if not raw:
                        continue
                    try:
                        record = json.loads(raw)
                    except json.JSONDecodeError as exc:
                        logger.warning(
                            "Skipping corrupt agent line %s:%d: %s",
                            path.name, i, exc,
                        )
                        continue
                    if isinstance(record, dict):
                        records.append(record)
                    else:
                        logger.warning(
                            "Skipping agent line %s:%d: not an object",
                            path.name, i,
                        )
        except OSError as exc:
            logger.warning(
                "Failed to read agent archive file %s: %s",
                path, exc,
            )
        return records