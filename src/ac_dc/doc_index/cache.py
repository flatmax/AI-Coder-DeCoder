"""Document cache — mtime-based with disk persistence via JSON sidecars."""

import hashlib
import json
import logging
from dataclasses import asdict
from pathlib import Path
from typing import Any, Optional

from ac_dc.base_cache import BaseCache
from ac_dc.doc_index.models import DocHeading, DocLink, DocOutline, DocSectionRef

logger = logging.getLogger(__name__)


class DocCache(BaseCache):
    """Mtime-based cache for DocOutline with disk persistence.

    Sidecar JSON files in .ac-dc/doc_cache/ survive server restarts.
    """

    def __init__(self, repo_root: Optional[str | Path] = None,
                 keyword_model: Optional[str] = None):
        super().__init__()
        self._keyword_model = keyword_model
        self._cache_dir: Optional[Path] = None

        if repo_root:
            self._cache_dir = Path(repo_root).resolve() / ".ac-dc" / "doc_cache"
            self._cache_dir.mkdir(parents=True, exist_ok=True)
            self._load_from_disk()

    def get(self, path: str, mtime: float,
            keyword_model: Optional[str] = None) -> Optional[DocOutline]:
        """Return cached outline if mtime matches and keyword model matches."""
        entry = self._cache.get(path)
        if entry and entry["mtime"] == mtime:
            # Check keyword model if specified
            stored_model = entry.get("keyword_model")
            if keyword_model and stored_model and stored_model != keyword_model:
                return None  # Stale due to model change
            return entry["data"]
        return None

    def put(self, path: str, mtime: float, data: DocOutline,
            content_hash: Optional[str] = None,
            keyword_model: Optional[str] = None):
        """Store outline with mtime and optionally write to disk."""
        if content_hash is None:
            content_hash = self._compute_hash(data)

        self._cache[path] = {
            "mtime": mtime,
            "data": data,
            "content_hash": content_hash,
            "keyword_model": keyword_model,
        }

        # Write sidecar
        if self._cache_dir:
            self._write_sidecar(path, mtime, data, content_hash, keyword_model)

    def invalidate(self, path: str):
        """Remove from memory and disk."""
        super().invalidate(path)
        if self._cache_dir:
            sidecar = self._sidecar_path(path)
            if sidecar.exists():
                try:
                    sidecar.unlink()
                except OSError:
                    pass

    def clear(self):
        """Remove all entries from memory and disk."""
        super().clear()
        if self._cache_dir and self._cache_dir.exists():
            for f in self._cache_dir.glob("*.json"):
                try:
                    f.unlink()
                except OSError:
                    pass

    # ── Disk Persistence ──────────────────────────────────────────

    def _sidecar_path(self, path: str) -> Path:
        """Get the sidecar JSON path for a doc file."""
        safe = path.replace("/", "__").replace("\\", "__")
        return self._cache_dir / f"{safe}.json"

    def _write_sidecar(self, path: str, mtime: float, data: DocOutline,
                       content_hash: str, keyword_model: Optional[str]):
        """Write a sidecar JSON file."""
        try:
            entry = {
                "path": path,
                "mtime": mtime,
                "content_hash": content_hash,
                "keyword_model": keyword_model,
                "outline": self._serialize_outline(data),
            }
            sidecar = self._sidecar_path(path)
            sidecar.write_text(
                json.dumps(entry, separators=(",", ":")),
                encoding="utf-8",
            )
        except Exception as e:
            logger.warning(f"Failed to write doc cache sidecar for {path}: {e}")

    def _load_from_disk(self):
        """Load all sidecars from disk on init."""
        if not self._cache_dir or not self._cache_dir.exists():
            return

        for sidecar in self._cache_dir.glob("*.json"):
            try:
                data = json.loads(sidecar.read_text(encoding="utf-8"))
                path = data["path"]
                outline = self._deserialize_outline(data["outline"])
                self._cache[path] = {
                    "mtime": data["mtime"],
                    "data": outline,
                    "content_hash": data.get("content_hash", ""),
                    "keyword_model": data.get("keyword_model"),
                }
            except Exception:
                # Corrupt sidecar — remove it
                try:
                    sidecar.unlink()
                except OSError:
                    pass

    def _serialize_outline(self, outline: DocOutline) -> dict:
        """Serialize DocOutline to a JSON-safe dict."""
        return {
            "path": outline.path,
            "doc_type": outline.doc_type,
            "headings": [self._serialize_heading(h) for h in outline.headings],
            "links": [
                {
                    "target": l.target,
                    "target_heading": l.target_heading,
                    "source_heading": l.source_heading,
                    "is_image": l.is_image,
                }
                for l in outline.links
            ],
        }

    def _serialize_heading(self, h: DocHeading) -> dict:
        return {
            "text": h.text,
            "level": h.level,
            "keywords": h.keywords,
            "start_line": h.start_line,
            "content_types": h.content_types,
            "section_lines": h.section_lines,
            "incoming_ref_count": h.incoming_ref_count,
            "outgoing_refs": [
                {"target_path": r.target_path, "target_heading": r.target_heading}
                for r in h.outgoing_refs
            ],
            "children": [self._serialize_heading(c) for c in h.children],
        }

    def _deserialize_outline(self, data: dict) -> DocOutline:
        return DocOutline(
            path=data["path"],
            doc_type=data.get("doc_type", "unknown"),
            headings=[self._deserialize_heading(h) for h in data.get("headings", [])],
            links=[
                DocLink(
                    target=l["target"],
                    target_heading=l.get("target_heading"),
                    source_heading=l.get("source_heading"),
                    is_image=l.get("is_image", False),
                )
                for l in data.get("links", [])
            ],
        )

    def _deserialize_heading(self, data: dict) -> DocHeading:
        return DocHeading(
            text=data["text"],
            level=data["level"],
            keywords=data.get("keywords", []),
            start_line=data.get("start_line", 0),
            content_types=data.get("content_types", []),
            section_lines=data.get("section_lines", 0),
            incoming_ref_count=data.get("incoming_ref_count", 0),
            outgoing_refs=[
                DocSectionRef(
                    target_path=r["target_path"],
                    target_heading=r.get("target_heading"),
                )
                for r in data.get("outgoing_refs", [])
            ],
            children=[self._deserialize_heading(c) for c in data.get("children", [])],
        )