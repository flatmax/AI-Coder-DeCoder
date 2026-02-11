"""Persistent conversation history — append-only JSONL storage.

Stores messages per-repository in `.ac-dc/history.jsonl`.
Supports session management, search, and loading into active context.
"""

import base64
import hashlib
import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Union

log = logging.getLogger(__name__)

# MIME type → file extension mapping for saved images
_MIME_TO_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
}

# Extension → MIME type for reading
_EXT_TO_MIME = {v: k for k, v in _MIME_TO_EXT.items()}


def _make_message_id() -> str:
    """Generate a unique message ID: {epoch_ms}-{uuid8}."""
    return f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"


def _make_session_id() -> str:
    """Generate a session ID: sess_{epoch_ms}_{uuid6}."""
    return f"sess_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}"


class HistoryStore:
    """Append-only JSONL history with session grouping and search.

    Each line in the JSONL file is a single message with metadata.
    Messages are grouped into sessions via session_id.
    """

    def __init__(self, ac_dc_dir: Path):
        self._path = ac_dc_dir / "history.jsonl"
        self._ac_dc_dir = ac_dc_dir
        # In-memory index for fast queries (rebuilt on load)
        self._messages: list[dict] = []
        self._sessions: dict[str, list[dict]] = {}  # session_id -> [messages]
        self._loaded = False

    @property
    def path(self) -> Path:
        return self._path

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------

    def _ensure_loaded(self):
        """Lazy-load the JSONL file into memory."""
        if self._loaded:
            return
        self._messages.clear()
        self._sessions.clear()
        if not self._path.exists():
            self._loaded = True
            return
        try:
            with open(self._path, "r", encoding="utf-8") as f:
                for line_num, line in enumerate(f, 1):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        msg = json.loads(line)
                        self._messages.append(msg)
                        sid = msg.get("session_id", "")
                        if sid not in self._sessions:
                            self._sessions[sid] = []
                        self._sessions[sid].append(msg)
                    except json.JSONDecodeError:
                        log.warning(
                            "Skipping corrupt line %d in %s", line_num, self._path
                        )
        except OSError as e:
            log.warning("Failed to load history: %s", e)
        self._loaded = True
        log.info("Loaded %d history messages across %d sessions",
                 len(self._messages), len(self._sessions))

    def reload(self):
        """Force reload from disk."""
        self._loaded = False
        self._ensure_loaded()

    # ------------------------------------------------------------------
    # Writing
    # ------------------------------------------------------------------

    def _save_images(self, data_uris: list[str]) -> list[str]:
        """Save base64 data URI images to .ac-dc/images/ and return filenames.

        Each image is named {epoch_ms}-{hash12}.{ext} for chronological
        sort order on disk with content-based deduplication.
        """
        images_dir = self._ac_dc_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        filenames = []
        epoch_ms = int(time.time() * 1000)

        for uri in data_uris:
            try:
                # Parse data URI: data:image/TYPE;base64,PAYLOAD
                match = re.match(r"data:(image/[^;]+);base64,(.*)", uri, re.DOTALL)
                if not match:
                    log.warning("Skipping invalid image data URI (no match)")
                    continue

                mime_type = match.group(1)
                b64_payload = match.group(2)

                # Compute hash from full data URI for dedup
                content_hash = hashlib.sha256(uri.encode()).hexdigest()[:12]

                # Determine extension
                ext = _MIME_TO_EXT.get(mime_type, ".png")

                filename = f"{epoch_ms}-{content_hash}{ext}"
                filepath = images_dir / filename

                if not filepath.exists():
                    binary_data = base64.b64decode(b64_payload)
                    filepath.write_bytes(binary_data)

                filenames.append(filename)
            except Exception as e:
                log.warning("Failed to save image: %s", e)

        return filenames

    def _load_image(self, filename: str) -> Optional[str]:
        """Load an image file and return it as a base64 data URI.

        Returns None if the file doesn't exist or can't be read.
        """
        filepath = self._ac_dc_dir / "images" / filename
        if not filepath.exists():
            log.warning("Image file not found: %s", filename)
            return None
        try:
            binary_data = filepath.read_bytes()
            ext = filepath.suffix.lower()
            mime_type = _EXT_TO_MIME.get(ext, "image/png")
            b64 = base64.b64encode(binary_data).decode("ascii")
            return f"data:{mime_type};base64,{b64}"
        except Exception as e:
            log.warning("Failed to load image %s: %s", filename, e)
            return None

    def _reconstruct_images(self, msg: dict) -> list[str]:
        """Reconstruct image data URIs from a message's image_refs.

        Returns a list of data URI strings, skipping any that can't be loaded.
        """
        refs = msg.get("image_refs")
        if not refs or not isinstance(refs, list):
            return []
        images = []
        for filename in refs:
            uri = self._load_image(filename)
            if uri:
                images.append(uri)
        return images

    def append_message(
        self,
        session_id: str,
        role: str,
        content: str,
        files: Optional[list[str]] = None,
        files_modified: Optional[list[str]] = None,
        edit_results: Optional[list[dict]] = None,
        images: Union[int, list[str], None] = None,
    ) -> dict:
        """Append a message to the JSONL file and in-memory index.

        Args:
            images: Either a list of base64 data URIs (saves to disk,
                    stores filenames as image_refs) or an integer count
                    (legacy, stored as-is).
        """
        self._ensure_loaded()

        msg = {
            "id": _make_message_id(),
            "session_id": session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "role": role,
            "content": content,
        }
        # Handle images — list of data URIs or legacy integer count
        if isinstance(images, list) and images:
            image_refs = self._save_images(images)
            if image_refs:
                msg["image_refs"] = image_refs
        elif isinstance(images, int) and images:
            msg["images"] = images
        if files:
            msg["files"] = files
        if files_modified:
            msg["files_modified"] = files_modified
        if edit_results:
            msg["edit_results"] = edit_results

        # Append to file
        try:
            self._ac_dc_dir.mkdir(exist_ok=True)
            with open(self._path, "a", encoding="utf-8") as f:
                f.write(json.dumps(msg, ensure_ascii=False) + "\n")
        except OSError as e:
            log.error("Failed to write history: %s", e)
            return {"error": str(e)}

        # Update in-memory index
        self._messages.append(msg)
        if session_id not in self._sessions:
            self._sessions[session_id] = []
        self._sessions[session_id].append(msg)

        return msg

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    def list_sessions(self, limit: int = 20) -> list[dict]:
        """List recent sessions, newest first."""
        self._ensure_loaded()
        summaries = []
        for sid, msgs in self._sessions.items():
            if not msgs:
                continue
            first_msg = msgs[0]
            preview = first_msg.get("content", "")[:100]
            summaries.append({
                "session_id": sid,
                "timestamp": first_msg.get("timestamp", ""),
                "message_count": len(msgs),
                "preview": preview,
                "first_role": first_msg.get("role", ""),
            })
        # Sort by timestamp descending
        summaries.sort(key=lambda s: s["timestamp"], reverse=True)
        return summaries[:limit]

    def get_session(self, session_id: str) -> list[dict]:
        """Get all messages from a session."""
        self._ensure_loaded()
        return list(self._sessions.get(session_id, []))

    def search(
        self, query: str, role: Optional[str] = None, limit: int = 50
    ) -> list[dict]:
        """Case-insensitive substring search across messages."""
        self._ensure_loaded()
        if not query:
            return []
        query_lower = query.lower()
        results = []
        for msg in reversed(self._messages):  # newest first
            if role and msg.get("role") != role:
                continue
            content = msg.get("content", "")
            if query_lower in content.lower():
                results.append(msg)
                if len(results) >= limit:
                    break
        return results

    def get_session_messages_for_context(self, session_id: str) -> list[dict]:
        """Get session messages in context manager format ({role, content}).

        Reconstructs images from image_refs so the frontend can display them.
        """
        msgs = self.get_session(session_id)
        result = []
        for m in msgs:
            entry = {"role": m["role"], "content": m["content"]}
            images = self._reconstruct_images(m)
            if images:
                entry["images"] = images
            result.append(entry)
        return result