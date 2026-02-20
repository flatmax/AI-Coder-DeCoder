"""Document cache — mtime-based outline caching with keyword model tracking.

Extends BaseCache. Stores DocOutline objects and tracks which keyword model
was used so that changing the model invalidates enriched entries.

Adds disk persistence: on put(), a JSON sidecar is written to
.ac-dc/doc_cache/.  On init, existing sidecar files are loaded so that
keyword-enriched outlines survive server restarts.
"""

import hashlib
import json
import logging
import os
from pathlib import Path

from ..base_cache import BaseCache
from .extractors.base import DocHeading, DocLink, DocOutline, DocSectionRef

logger = logging.getLogger(__name__)


def _outline_to_dict(outline):
    """Serialize a DocOutline to a JSON-safe dict."""

    def _heading_to_dict(h):
        d = {
            "text": h.text,
            "level": h.level,
            "start_line": h.start_line,
        }
        if h.keywords:
            d["keywords"] = h.keywords
        if h.outgoing_refs:
            d["outgoing_refs"] = [
                {"target_path": r.target_path, "target_heading": r.target_heading}
                for r in h.outgoing_refs
            ]
        if h.incoming_ref_count:
            d["incoming_ref_count"] = h.incoming_ref_count
        if h.content_types:
            d["content_types"] = h.content_types
        if h.section_lines:
            d["section_lines"] = h.section_lines
        if h.children:
            d["children"] = [_heading_to_dict(c) for c in h.children]
        return d

    d = {
        "path": outline.path,
        "headings": [_heading_to_dict(h) for h in outline.headings],
        "links": [
            {
                "target": lnk.target,
                "target_heading": lnk.target_heading,
                "source_heading": lnk.source_heading,
                **({"is_image": True} if lnk.is_image else {}),
            }
            for lnk in outline.links
        ],
    }
    if outline.doc_type != "unknown":
        d["doc_type"] = outline.doc_type
    return d


def _dict_to_outline(d):
    """Deserialize a dict back to a DocOutline."""

    def _dict_to_heading(hd):
        outgoing_refs = [
            DocSectionRef(
                target_path=r["target_path"],
                target_heading=r.get("target_heading", ""),
            )
            for r in hd.get("outgoing_refs", [])
        ]
        return DocHeading(
            text=hd["text"],
            level=hd["level"],
            start_line=hd.get("start_line", 0),
            keywords=hd.get("keywords", []),
            children=[_dict_to_heading(c) for c in hd.get("children", [])],
            outgoing_refs=outgoing_refs,
            incoming_ref_count=hd.get("incoming_ref_count", 0),
            content_types=hd.get("content_types", []),
            section_lines=hd.get("section_lines", 0),
        )

    return DocOutline(
        path=d["path"],
        doc_type=d.get("doc_type", "unknown"),
        headings=[_dict_to_heading(h) for h in d.get("headings", [])],
        links=[
            DocLink(
                target=lnk["target"],
                target_heading=lnk.get("target_heading", ""),
                source_heading=lnk.get("source_heading", ""),
                is_image=lnk.get("is_image", False),
            )
            for lnk in d.get("links", [])
        ],
    )


class DocCache(BaseCache):
    """Cache document outlines per file, invalidated by mtime or model change.

    Persists enriched outlines to disk so keyword extraction results survive
    server restarts.
    """

    def __init__(self, repo_root=None):
        super().__init__()
        self._disk_dir = None
        if repo_root:
            self._disk_dir = Path(repo_root) / ".ac-dc" / "doc_cache"
            try:
                self._disk_dir.mkdir(parents=True, exist_ok=True)
            except OSError as e:
                logger.warning(f"Cannot create doc cache dir {self._disk_dir}: {e}")
                self._disk_dir = None
            # Load existing sidecar files into memory
            self._load_from_disk()

    # --- disk helpers ---

    def _sidecar_path(self, path):
        """Return the sidecar JSON path for a given source file path."""
        if not self._disk_dir:
            return None
        safe = path.replace("/", "__").replace("\\", "__") + ".json"
        return self._disk_dir / safe

    def _write_sidecar(self, path, mtime, outline, content_hash, keyword_model):
        """Write a sidecar JSON file for one cached entry."""
        sp = self._sidecar_path(path)
        if not sp:
            return
        try:
            data = {
                "path": path,
                "mtime": mtime,
                "content_hash": content_hash,
                "keyword_model": keyword_model,
                "outline": _outline_to_dict(outline),
            }
            sp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        except Exception as e:
            logger.debug(f"Failed to write doc cache sidecar for {path}: {e}")

    def _remove_sidecar(self, path):
        """Remove the sidecar JSON file for a cached entry."""
        sp = self._sidecar_path(path)
        if sp and sp.exists():
            try:
                sp.unlink()
            except OSError:
                pass

    def _load_from_disk(self):
        """Load all sidecar JSON files into the in-memory cache."""
        if not self._disk_dir or not self._disk_dir.exists():
            return
        loaded = 0
        for fp in self._disk_dir.glob("*.json"):
            try:
                raw = json.loads(fp.read_text(encoding="utf-8"))
                path = raw["path"]
                mtime = raw["mtime"]
                content_hash = raw.get("content_hash")
                keyword_model = raw.get("keyword_model")
                outline = _dict_to_outline(raw["outline"])

                # Store into in-memory cache via parent put()
                super().put(
                    path, mtime, outline,
                    content_hash=content_hash,
                    keyword_model=keyword_model,
                )
                loaded += 1
            except Exception as e:
                logger.debug(f"Skipping corrupt doc cache sidecar {fp.name}: {e}")
                # Remove corrupt files
                try:
                    fp.unlink()
                except OSError:
                    pass
        if loaded:
            logger.info(f"Loaded {loaded} doc cache entries from disk")

    # --- public API ---

    def get(self, path, mtime, keyword_model=None):
        """Get cached outline if mtime matches and keyword model is current.

        Args:
            path: file path
            mtime: file modification time
            keyword_model: current keyword model name (None = no enrichment)

        Returns:
            DocOutline or None
        """
        entry = self._cache.get(path)
        if not entry:
            return None
        if entry["mtime"] != mtime:
            return None
        # Check keyword model matches
        if keyword_model is not None:
            cached_model = entry.get("keyword_model")
            if cached_model != keyword_model:
                return None
        return entry["data"]

    def put(self, path, mtime, outline, keyword_model=None):
        """Store outline with mtime and keyword model name.

        Writes both to in-memory cache and to a disk sidecar file.

        Args:
            path: file path
            mtime: file modification time
            outline: DocOutline instance
            keyword_model: model name used for keyword enrichment
        """
        content_hash = self._compute_hash(outline)
        super().put(
            path, mtime, outline,
            content_hash=content_hash,
            keyword_model=keyword_model,
        )
        self._write_sidecar(path, mtime, outline, content_hash, keyword_model)

    def invalidate(self, path):
        """Remove entry from both in-memory cache and disk."""
        super().invalidate(path)
        self._remove_sidecar(path)

    def clear(self):
        """Clear all entries from memory and disk."""
        # Remove all sidecar files
        if self._disk_dir and self._disk_dir.exists():
            for fp in self._disk_dir.glob("*.json"):
                try:
                    fp.unlink()
                except OSError:
                    pass
        super().clear()

    def _compute_hash(self, data):
        """Compute deterministic hash of document outline."""
        content = data.signature_hash_content()
        return hashlib.sha256(content.encode()).hexdigest()[:16]