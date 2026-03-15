"""Persistent history store — append-only JSONL per repository."""

import hashlib
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def _generate_message_id() -> str:
    """Format: {epoch_ms}-{uuid8}."""
    epoch_ms = int(time.time() * 1000)
    uid = uuid.uuid4().hex[:8]
    return f"{epoch_ms}-{uid}"


def _generate_session_id() -> str:
    """Format: sess_{epoch_ms}_{uuid6}."""
    epoch_ms = int(time.time() * 1000)
    uid = uuid.uuid4().hex[:6]
    return f"sess_{epoch_ms}_{uid}"


class HistoryStore:
    """Append-only JSONL history store for conversation persistence.

    Messages are persisted per-repository in .ac-dc/history.jsonl.
    """

    def __init__(self, ac_dc_dir: str | Path):
        self._dir = Path(ac_dc_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._path = self._dir / "history.jsonl"
        self._images_dir = self._dir / "images"
        self._current_session_id: Optional[str] = None
        self._messages: list[dict] = []
        self._load()

    def _load(self):
        """Load existing messages from JSONL file."""
        if not self._path.exists():
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
                    except json.JSONDecodeError:
                        logger.warning(f"Corrupt JSONL line {line_num}, skipping")
        except OSError as e:
            logger.warning(f"Cannot read history: {e}")

    @property
    def current_session_id(self) -> str:
        if not self._current_session_id:
            self._current_session_id = _generate_session_id()
        return self._current_session_id

    @current_session_id.setter
    def current_session_id(self, value: str):
        self._current_session_id = value

    def new_session(self) -> str:
        """Create a new session and return its ID."""
        self._current_session_id = _generate_session_id()
        return self._current_session_id

    def append_message(
        self,
        session_id: str,
        role: str,
        content: str,
        files: Optional[list[str]] = None,
        files_modified: Optional[list[str]] = None,
        images: Optional[list | int] = None,
        edit_results: Optional[list] = None,
    ) -> dict:
        """Append a message to the store and persist."""
        from datetime import datetime, timezone

        msg = {
            "id": _generate_message_id(),
            "session_id": session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "role": role,
            "content": content,
        }

        if files:
            msg["files"] = files
        if files_modified:
            msg["files_modified"] = files_modified
        if edit_results:
            msg["edit_results"] = edit_results

        # Handle images
        if isinstance(images, list) and images:
            # Save images to disk and store refs
            image_refs = self._save_images(images)
            msg["image_refs"] = image_refs
        elif isinstance(images, int):
            # Legacy count
            msg["images"] = images

        self._messages.append(msg)
        self._persist_message(msg)

        return msg

    def _persist_message(self, msg: dict):
        """Append a single message to the JSONL file."""
        try:
            with open(self._path, "a", encoding="utf-8") as f:
                f.write(json.dumps(msg, separators=(",", ":")) + "\n")
        except OSError as e:
            logger.warning(f"Cannot persist message: {e}")

    def _save_images(self, images: list[str]) -> list[str]:
        """Save base64 data URIs to disk, return filenames."""
        import base64
        self._images_dir.mkdir(exist_ok=True)

        filenames = []
        for data_uri in images:
            if not isinstance(data_uri, str) or not data_uri.startswith("data:"):
                continue

            # Parse MIME and data
            try:
                header, b64_data = data_uri.split(",", 1)
                mime = header.split(":")[1].split(";")[0]
            except (ValueError, IndexError):
                continue

            # Extension from MIME
            ext_map = {
                "image/png": ".png",
                "image/jpeg": ".jpg",
                "image/gif": ".gif",
                "image/webp": ".webp",
            }
            ext = ext_map.get(mime, ".png")

            # Hash for dedup
            hash12 = hashlib.sha256(data_uri.encode()).hexdigest()[:12]
            epoch_ms = int(time.time() * 1000)
            filename = f"{epoch_ms}-{hash12}{ext}"

            filepath = self._images_dir / filename
            if not filepath.exists():
                try:
                    data = base64.b64decode(b64_data)
                    filepath.write_bytes(data)
                except Exception as e:
                    logger.warning(f"Cannot save image: {e}")
                    continue

            filenames.append(filename)

        return filenames

    def _reconstruct_images(self, image_refs: list[str]) -> list[str]:
        """Reconstruct data URIs from image_refs filenames."""
        import base64
        result = []
        for filename in image_refs:
            filepath = self._images_dir / filename
            if not filepath.exists():
                logger.warning(f"Missing image: {filename}")
                continue

            ext = filepath.suffix.lower()
            mime_map = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".webp": "image/webp",
            }
            mime = mime_map.get(ext, "image/png")

            try:
                data = filepath.read_bytes()
                b64 = base64.b64encode(data).decode("ascii")
                result.append(f"data:{mime};base64,{b64}")
            except OSError:
                continue

        return result

    # ── Session Queries ───────────────────────────────────────────

    def list_sessions(self, limit: Optional[int] = None) -> list[dict]:
        """Recent sessions, newest first."""
        sessions: dict[str, dict] = {}
        for msg in self._messages:
            sid = msg.get("session_id", "")
            if not sid:
                continue
            if sid not in sessions:
                sessions[sid] = {
                    "session_id": sid,
                    "timestamp": msg.get("timestamp", ""),
                    "message_count": 0,
                    "preview": "",
                    "first_role": msg.get("role", ""),
                }
            sessions[sid]["message_count"] += 1
            if not sessions[sid]["preview"]:
                content = msg.get("content", "")
                sessions[sid]["preview"] = content[:100]

        result = sorted(
            sessions.values(),
            key=lambda s: s["timestamp"],
            reverse=True,
        )
        if limit:
            result = result[:limit]
        return result

    def get_session_messages(self, session_id: str) -> list[dict]:
        """All messages from a session (full metadata, with reconstructed images)."""
        msgs = [m for m in self._messages if m.get("session_id") == session_id]
        for msg in msgs:
            image_refs = msg.get("image_refs")
            if image_refs:
                msg["images"] = self._reconstruct_images(image_refs)
        return msgs

    def get_session_messages_for_context(self, session_id: str) -> list[dict]:
        """Messages for context loading — only {role, content} + _images."""
        result = []
        for msg in self._messages:
            if msg.get("session_id") != session_id:
                continue
            entry = {"role": msg["role"], "content": msg["content"]}
            image_refs = msg.get("image_refs")
            if image_refs:
                entry["_images"] = self._reconstruct_images(image_refs)
            result.append(entry)
        return result

    # ── Search ────────────────────────────────────────────────────

    def search(
        self,
        query: str,
        role: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict]:
        """Case-insensitive substring search across messages."""
        if not query:
            return []

        lower_query = query.lower()
        results: dict[str, list] = {}  # session_id -> messages

        for msg in self._messages:
            if role and msg.get("role") != role:
                continue
            content = msg.get("content", "")
            if lower_query in content.lower():
                sid = msg.get("session_id", "unknown")
                if sid not in results:
                    results[sid] = []
                results[sid].append(msg)

        flat = [
            {"session_id": sid, "messages": msgs}
            for sid, msgs in results.items()
        ]

        if limit:
            flat = flat[:limit]
        return flat