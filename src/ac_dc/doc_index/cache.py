"""Document-index cache with disk persistence.

``DocCache(BaseCache[DocOutline])`` layers JSON sidecar files
under ``.ac-dc/doc_cache/`` on top of the in-memory mtime cache
that :class:`~ac_dc.base_cache.BaseCache` provides. Keyword
enrichment (Layer 2.8.4) costs ~500ms per file and must survive
server restarts; the symbol cache is in-memory only because
tree-sitter re-parse is cheap enough that session-scoped caching
suffices.

Design notes pinned by specs4/2-indexing/document-index.md:

- **Per-file sidecar.** One JSON file per cached outline, named
  by replacing ``/`` (and ``\\``) with ``__`` in the repo-relative
  path and appending ``.json``. Tooling inspecting the directory
  sees one file per source document — easy to audit and remove
  selectively.

- **Keyword-model field on every entry.** 2.8.1c writes ``None``
  because extraction is structural-only; 2.8.4 overwrites with
  the sentence-transformer model name when enrichment completes.
  On lookup, callers that don't care about enrichment pass
  ``keyword_model=None`` and accept any cached entry (used by
  mode switch and chat requests — they can't block on a 500ms
  enrichment). Callers that need enriched outlines pass the
  expected model name; mismatches treat the entry as stale and
  force re-extraction.

- **Serialisation owned here.** The model dataclasses stay
  serialisation-agnostic so a future switch to msgpack or cbor
  touches only :meth:`_outline_to_json` and
  :meth:`_outline_from_json`.

- **Corrupt sidecars are benign.** A mid-write crash or disk
  corruption leaves one file unreadable; ``_load_all`` logs
  and removes the bad sidecar, the rest of the cache loads
  normally, and the affected file re-extracts on next access.
  A partial cache is better than no cache.

- **``repo_root`` optional.** When None, persistence hooks are
  no-ops and the cache is purely in-memory — useful for tests
  and for single-file extraction paths that run without a
  repo working directory.

Governing spec: ``specs4/2-indexing/document-index.md`` § Disk Persistence.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import fields
from pathlib import Path
from typing import Any

from ac_dc.base_cache import BaseCache
from ac_dc.config import _AC_DC_DIR
from ac_dc.doc_index.models import (
    DocHeading,
    DocLink,
    DocOutline,
    DocProseBlock,
)

logger = logging.getLogger(__name__)


# Sidecar directory name under the per-repo ``.ac-dc4/`` working
# directory. Separate from ``symbol_cache/`` (which doesn't
# exist — symbol cache is in-memory only) so a future migration
# that wanted to add on-disk symbol persistence wouldn't collide.
#
# The parent directory name (``.ac-dc4``) is imported from the
# config module rather than hardcoded here — ``.ac-dc`` belongs
# to the previous AC-DC implementation that shares repositories
# with this one during the transition, and colliding on that
# name would corrupt both states. See config._AC_DC_DIR.
_SIDECAR_DIR_NAME = "doc_cache"

# Current sidecar schema version. Bumped when the on-disk
# format changes in an incompatible way. Load-side checks the
# version and removes mismatched sidecars rather than trying
# to migrate — re-extraction is cheap enough that upgrade
# logic would cost more than it saves.
_SIDECAR_VERSION = 1


class DocCache(BaseCache[DocOutline]):
    """Mtime-based cache for :class:`DocOutline` with disk persistence.

    Construct with a ``repo_root`` to enable on-disk persistence
    (sidecars live at ``{repo_root}/.ac-dc/doc_cache/``).
    Construct with ``repo_root=None`` for pure in-memory caching
    (matches :class:`~ac_dc.symbol_index.cache.SymbolCache`).

    Lookup semantics match the base class, with one addition:
    :meth:`get` accepts an optional ``keyword_model`` argument
    that, when non-None, requires the cached entry to have been
    produced with that model. Used by 2.8.4's enrichment flow to
    detect "this outline was enriched with an older model; treat
    as stale".
    """

    def __init__(self, repo_root: Path | str | None = None) -> None:
        """Initialise the cache.

        Parameters
        ----------
        repo_root
            The repository root directory. When set, sidecars
            are persisted to ``{repo_root}/.ac-dc/doc_cache/``.
            When None, persistence hooks are no-ops.
        """
        super().__init__()
        self._repo_root: Path | None = (
            Path(repo_root) if repo_root is not None else None
        )
        # Populate from disk on construction. A fresh install
        # with no sidecars is a no-op.
        if self._repo_root is not None:
            self._load_all()

    # ------------------------------------------------------------------
    # Enhanced get — keyword model matching
    # ------------------------------------------------------------------

    def get(  # type: ignore[override]
        self,
        path: str | Path,
        mtime: float | None,
        keyword_model: str | None = None,
    ) -> DocOutline | None:
        """Return the cached outline when valid, else None.

        Extends the base class with keyword-model matching:

        - ``keyword_model=None`` (default): accept any cached
          outline regardless of enrichment state. Used by mode
          switch and chat requests that must not block on
          enrichment — an unenriched outline is fully usable
          for tier assembly.
        - ``keyword_model="..."``: require the cached outline
          to have been enriched with exactly that model. A
          mismatch is a cache miss; the caller re-extracts and
          re-enriches with the current model.

        Falls through to the base class's mtime check first —
        a stale mtime short-circuits regardless of model.
        """
        if mtime is None:
            return None
        key = self._normalise_path(path)
        entry = self._entries.get(key)
        if entry is None:
            return None
        if entry.get("mtime") != mtime:
            return None
        # Model-match check only fires when the caller supplied
        # a model. Structure-only lookups (model=None) accept
        # any entry.
        if keyword_model is not None:
            stored_model = entry.get("keyword_model")
            if stored_model != keyword_model:
                return None
        return entry.get("value")

    # ------------------------------------------------------------------
    # Enhanced put — keyword model tag
    # ------------------------------------------------------------------

    def put(  # type: ignore[override]
        self,
        path: str | Path,
        mtime: float,
        value: DocOutline,
        keyword_model: str | None = None,
    ) -> None:
        """Store an outline with an optional keyword-model tag.

        The ``keyword_model`` argument records which enrichment
        model (if any) produced the outline. 2.8.1c callers always
        pass None (no enrichment); 2.8.4 passes the real model
        name. The base class's ``put`` path is delegated to via
        ``_decorate_entry`` reading from a per-call slot.
        """
        # Stash the model through the base class's decorate hook.
        # _decorate_entry picks it up and adds it to the entry
        # dict before _persist runs.
        self._pending_keyword_model = keyword_model
        try:
            super().put(path, mtime, value)
        finally:
            # Clear the slot — never leak a stale model to a
            # subsequent put that doesn't supply one.
            self._pending_keyword_model = None

    # ------------------------------------------------------------------
    # Hook overrides
    # ------------------------------------------------------------------

    def _compute_signature_hash(self, value: DocOutline) -> str:
        """Hash the outline's structural shape.

        Covers every field that affects the rendered output:
        doc_type, headings (recursively — text, level, keywords,
        content_types, section_lines, outgoing_refs), links
        (target + source_heading + is_image), prose_blocks (text
        + keywords). Excludes:

        - ``file_path`` — already the cache key
        - Heading ``start_line`` and heading ``incoming_ref_count`` —
          derived from surrounding structure; a whitespace-only
          edit that shifts line numbers but doesn't change
          structure should not demote

        The stability tracker (Layer 3.5) uses this to decide
        when to demote an entry's tier. An unchanged signature
        across mtime bumps keeps the tier stable.
        """
        parts: list[str] = [value.doc_type]
        _append_headings_signature(parts, value.headings)
        for link in value.links:
            parts.append(
                f"link:{link.target}|{link.source_heading}|"
                f"{int(link.is_image)}"
            )
        for block in value.prose_blocks:
            parts.append(
                f"prose:{block.container_heading_id or ''}|"
                f"{block.text}|{','.join(block.keywords)}"
            )
        joined = "\n".join(parts).encode("utf-8")
        return hashlib.sha256(joined).hexdigest()

    def _decorate_entry(
        self,
        entry: dict[str, Any],
        path: str | Path,
        value: DocOutline,
    ) -> None:
        """Attach the keyword-model tag to the entry dict.

        Reads from the ``_pending_keyword_model`` slot set by
        :meth:`put`. Defaults to None when the slot hasn't been
        set (which shouldn't happen in practice — put always
        sets it — but is defensive).
        """
        del path, value  # unused here
        entry["keyword_model"] = getattr(
            self, "_pending_keyword_model", None
        )

    def _persist(self, key: str, entry: dict[str, Any]) -> None:
        """Write the entry to a JSON sidecar.

        No-op when no repo root. Disk errors bubble up as OSError
        — the base class catches and logs them without affecting
        in-memory state.
        """
        sidecar_dir = self._sidecar_dir()
        if sidecar_dir is None:
            return
        sidecar_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": _SIDECAR_VERSION,
            "path": key,
            "mtime": entry["mtime"],
            "signature_hash": entry["signature_hash"],
            "keyword_model": entry.get("keyword_model"),
            "outline": self._outline_to_json(entry["value"]),
        }
        sidecar_path = sidecar_dir / self._sidecar_filename(key)
        # Write-then-rename via temp file. A mid-write crash
        # leaves a .tmp file rather than a partially-populated
        # sidecar that would parse as invalid on next load.
        tmp_path = sidecar_path.with_suffix(".json.tmp")
        tmp_path.write_text(
            json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )
        tmp_path.replace(sidecar_path)

    def _remove_persisted(self, key: str) -> None:
        """Delete the sidecar for ``key``.

        No-op when no repo root or when the file doesn't exist
        (a stale in-memory entry without a sidecar is legal —
        e.g., an entry that was put after a clear but before a
        persist completed). OSError bubbles to the base class's
        catch-and-log.
        """
        sidecar_dir = self._sidecar_dir()
        if sidecar_dir is None:
            return
        sidecar_path = sidecar_dir / self._sidecar_filename(key)
        if sidecar_path.exists():
            sidecar_path.unlink()

    def _clear_persisted(self) -> None:
        """Remove all sidecar files.

        Preserves the directory itself — future puts will
        re-populate. A missing directory is a no-op.
        """
        sidecar_dir = self._sidecar_dir()
        if sidecar_dir is None or not sidecar_dir.exists():
            return
        for entry in sidecar_dir.iterdir():
            if entry.is_file() and entry.suffix == ".json":
                try:
                    entry.unlink()
                except OSError as exc:
                    # Log and continue — clearing should never
                    # crash on a single stuck file.
                    logger.warning(
                        "Could not remove sidecar %s: %s",
                        entry,
                        exc,
                    )

    def _load_all(self) -> None:
        """Populate ``_entries`` from sidecar files.

        Called by the constructor. Corrupt sidecars are logged
        and removed — a partial cache is better than refusing
        to start.
        """
        sidecar_dir = self._sidecar_dir()
        if sidecar_dir is None or not sidecar_dir.exists():
            return
        for entry_path in sidecar_dir.iterdir():
            if not entry_path.is_file():
                continue
            if entry_path.suffix != ".json":
                continue
            try:
                raw = entry_path.read_text(encoding="utf-8")
                payload = json.loads(raw)
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning(
                    "Removing corrupt doc cache sidecar %s: %s",
                    entry_path,
                    exc,
                )
                try:
                    entry_path.unlink()
                except OSError:
                    # Best effort — if we can't even delete it,
                    # just skip and continue loading.
                    pass
                continue
            if not isinstance(payload, dict):
                logger.warning(
                    "Sidecar %s is not a dict; removing",
                    entry_path,
                )
                try:
                    entry_path.unlink()
                except OSError:
                    pass
                continue
            if payload.get("version") != _SIDECAR_VERSION:
                logger.info(
                    "Sidecar %s has version %r (expected %d); removing",
                    entry_path,
                    payload.get("version"),
                    _SIDECAR_VERSION,
                )
                try:
                    entry_path.unlink()
                except OSError:
                    pass
                continue
            try:
                outline = self._outline_from_json(payload["outline"])
            except (KeyError, TypeError, ValueError) as exc:
                logger.warning(
                    "Sidecar %s could not be deserialised: %s; removing",
                    entry_path,
                    exc,
                )
                try:
                    entry_path.unlink()
                except OSError:
                    pass
                continue
            key = payload.get("path")
            mtime = payload.get("mtime")
            if not isinstance(key, str) or not isinstance(
                mtime, (int, float)
            ):
                logger.warning(
                    "Sidecar %s missing path/mtime; removing",
                    entry_path,
                )
                try:
                    entry_path.unlink()
                except OSError:
                    pass
                continue
            entry = {
                "value": outline,
                "mtime": float(mtime),
                "signature_hash": payload.get("signature_hash", ""),
                "keyword_model": payload.get("keyword_model"),
            }
            self._entries[key] = entry

    # ------------------------------------------------------------------
    # Sidecar path helpers
    # ------------------------------------------------------------------

    def _sidecar_dir(self) -> Path | None:
        """Return the sidecar directory, or None if disabled."""
        if self._repo_root is None:
            return None
        return self._repo_root / _AC_DC_DIR / _SIDECAR_DIR_NAME

    @staticmethod
    def _sidecar_filename(key: str) -> str:
        """Translate a cache key to a sidecar filename.

        Replaces ``/`` and ``\\`` with ``__``. Handles dotfiles
        at the root correctly (``.gitignore`` → ``.gitignore.json``).
        """
        safe = key.replace("/", "__").replace("\\", "__")
        return f"{safe}.json"

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------

    @classmethod
    def _outline_to_json(cls, outline: DocOutline) -> dict[str, Any]:
        """Serialise a :class:`DocOutline` to a JSON-safe dict.

        Models are plain dataclasses but contain nested mutable
        structures (children lists, outgoing_refs); we walk the
        tree explicitly rather than relying on ``dataclasses.asdict``
        because asdict's recursion doesn't handle our specific
        shape more cleanly.
        """
        return {
            "file_path": outline.file_path,
            "doc_type": outline.doc_type,
            "headings": [
                cls._heading_to_json(h) for h in outline.headings
            ],
            "links": [cls._link_to_json(ln) for ln in outline.links],
            "prose_blocks": [
                cls._prose_to_json(b) for b in outline.prose_blocks
            ],
        }

    @classmethod
    def _heading_to_json(cls, h: DocHeading) -> dict[str, Any]:
        return {
            "text": h.text,
            "level": h.level,
            "start_line": h.start_line,
            "section_lines": h.section_lines,
            "keywords": list(h.keywords),
            "content_types": list(h.content_types),
            "children": [
                cls._heading_to_json(c) for c in h.children
            ],
            "outgoing_refs": [
                {
                    "target_path": r.target_path,
                    "target_heading": r.target_heading,
                }
                for r in h.outgoing_refs
            ],
            "incoming_ref_count": h.incoming_ref_count,
        }

    @staticmethod
    def _link_to_json(link: DocLink) -> dict[str, Any]:
        return {
            "target": link.target,
            "line": link.line,
            "source_heading": link.source_heading,
            "is_image": link.is_image,
        }

    @staticmethod
    def _prose_to_json(block: DocProseBlock) -> dict[str, Any]:
        return {
            "text": block.text,
            "container_heading_id": block.container_heading_id,
            "start_line": block.start_line,
            "keywords": list(block.keywords),
        }

    @classmethod
    def _outline_from_json(cls, data: dict[str, Any]) -> DocOutline:
        """Inverse of :meth:`_outline_to_json`.

        Defensive on missing fields — a future schema addition
        that isn't in an older sidecar uses the dataclass default.
        Unknown fields are silently ignored (forward compat).
        """
        if not isinstance(data, dict):
            raise TypeError(f"expected dict, got {type(data).__name__}")
        outline = DocOutline(
            file_path=_required_str(data, "file_path"),
            doc_type=data.get("doc_type", "unknown"),
        )
        raw_headings = data.get("headings", [])
        if not isinstance(raw_headings, list):
            raise TypeError("headings must be a list")
        outline.headings = [
            cls._heading_from_json(h) for h in raw_headings
        ]
        raw_links = data.get("links", [])
        if not isinstance(raw_links, list):
            raise TypeError("links must be a list")
        outline.links = [cls._link_from_json(ln) for ln in raw_links]
        raw_prose = data.get("prose_blocks", [])
        if not isinstance(raw_prose, list):
            raise TypeError("prose_blocks must be a list")
        outline.prose_blocks = [
            cls._prose_from_json(b) for b in raw_prose
        ]
        return outline

    @classmethod
    def _heading_from_json(cls, data: dict[str, Any]) -> DocHeading:
        from ac_dc.doc_index.models import DocSectionRef

        if not isinstance(data, dict):
            raise TypeError(
                f"heading entry must be dict, got {type(data).__name__}"
            )
        heading = DocHeading(
            text=_required_str(data, "text"),
            level=int(data.get("level", 1)),
            start_line=int(data.get("start_line", 0)),
            section_lines=int(data.get("section_lines", 0)),
            keywords=list(data.get("keywords", [])),
            content_types=list(data.get("content_types", [])),
            incoming_ref_count=int(
                data.get("incoming_ref_count", 0)
            ),
        )
        raw_children = data.get("children", [])
        if not isinstance(raw_children, list):
            raise TypeError("heading.children must be a list")
        heading.children = [
            cls._heading_from_json(c) for c in raw_children
        ]
        raw_refs = data.get("outgoing_refs", [])
        if not isinstance(raw_refs, list):
            raise TypeError("heading.outgoing_refs must be a list")
        heading.outgoing_refs = [
            DocSectionRef(
                target_path=_required_str(r, "target_path"),
                target_heading=r.get("target_heading"),
            )
            for r in raw_refs
            if isinstance(r, dict)
        ]
        return heading

    @staticmethod
    def _link_from_json(data: dict[str, Any]) -> DocLink:
        if not isinstance(data, dict):
            raise TypeError(
                f"link entry must be dict, got {type(data).__name__}"
            )
        return DocLink(
            target=_required_str(data, "target"),
            line=int(data.get("line", 0)),
            source_heading=data.get("source_heading", ""),
            is_image=bool(data.get("is_image", False)),
        )

    @staticmethod
    def _prose_from_json(data: dict[str, Any]) -> DocProseBlock:
        if not isinstance(data, dict):
            raise TypeError(
                f"prose entry must be dict, got {type(data).__name__}"
            )
        return DocProseBlock(
            text=_required_str(data, "text"),
            container_heading_id=data.get("container_heading_id"),
            start_line=int(data.get("start_line", 0)),
            keywords=list(data.get("keywords", [])),
        )


# ---------------------------------------------------------------------------
# Module helpers
# ---------------------------------------------------------------------------


def _required_str(data: dict[str, Any], key: str) -> str:
    """Extract a required string field from a JSON dict.

    Raises TypeError rather than returning a default — missing
    or non-string values mean the sidecar is corrupt; the
    loader catches TypeError and removes the sidecar.
    """
    value = data.get(key)
    if not isinstance(value, str):
        raise TypeError(
            f"field {key!r} must be str, got "
            f"{type(value).__name__ if value is not None else 'missing'}"
        )
    return value


def _append_headings_signature(
    parts: list[str],
    headings: list[DocHeading],
) -> None:
    """Append a deterministic representation of the heading tree.

    Consumed by :meth:`DocCache._compute_signature_hash`. Deeply
    walks children. Content-types sorted for determinism (the
    extractor emits them in first-seen order but the hash
    shouldn't depend on which marker was detected first).
    Keywords NOT sorted — order matters to the formatter and
    the enricher produces them in rank order.
    """
    for h in headings:
        parts.append(
            f"h:{h.level}:{h.text}|"
            f"{','.join(h.keywords)}|"
            f"{','.join(sorted(h.content_types))}|"
            f"{h.section_lines}"
        )
        for ref in h.outgoing_refs:
            parts.append(
                f"hr:{ref.target_path}|{ref.target_heading or ''}"
            )
        if h.children:
            parts.append("hchildren_open")
            _append_headings_signature(parts, h.children)
            parts.append("hchildren_close")


# Unused imports kept intentional — `fields` could be useful in
# a future dataclasses-based refactor. Remove the `from
# dataclasses import fields` line once it's clear we won't use
# it.
_ = fields