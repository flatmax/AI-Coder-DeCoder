"""Persistent history store — JSONL-based conversation persistence.

Provides:
- Append-only JSONL storage at {repo_root}/.ac-dc/history.jsonl
- Session management (create, list, load)
- Search across sessions
- Image persistence to .ac-dc/images/
"""

import base64
import hashlib
import json
import logging
import os
import time
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)

# MIME type to extension mapping
MIME_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


def _generate_message_id():
    """Generate message ID: {epoch_ms}-{uuid8}."""
    epoch_ms = int(time.time() * 1000)
    uid = uuid.uuid4().hex[:8]
    return f"{epoch_ms}-{uid}"


def _generate_session_id():
    """Generate session ID: sess_{epoch_ms}_{uuid6}."""
    epoch_ms = int(time.time() * 1000)
    uid = uuid.uuid4().hex[:6]
    return f"sess_{epoch_ms}_{uid}"


def _parse_data_uri(data_uri):
    """Parse a data URI into (mime_type, data_bytes).

    Returns (mime_type, data_bytes) or (None, None) on failure.
    """
    try:
        # data:image/png;base64,iVBOR...
        if not data_uri.startswith("data:"):
            return None, None
        header, encoded = data_uri.split(",", 1)
        mime = header.split(":")[1].split(";")[0]
        data = base64.b64decode(encoded)
        return mime, data
    except Exception:
        return None, None


def _data_uri_hash(data_uri):
    """SHA-256 of the data URI string, first 12 chars."""
    return hashlib.sha256(data_uri.encode()).hexdigest()[:12]


class HistoryStore:
    """Append-only JSONL history store with session management.

    Storage: {repo_root}/.ac-dc/history.jsonl
    Images:  {repo_root}/.ac-dc/images/
    """

    def __init__(self, repo_root):
        self._repo_root = Path(repo_root)
        self._ac_dc_dir = self._repo_root / ".ac-dc"
        self._history_file = self._ac_dc_dir / "history.jsonl"
        self._images_dir = self._ac_dc_dir / "images"

        # Ensure directories exist
        self._ac_dc_dir.mkdir(exist_ok=True)
        self._images_dir.mkdir(exist_ok=True)

    def append_message(self, session_id, role, content,
                       files=None, images=None, files_modified=None,
                       edit_results=None):
        """Append a message to the JSONL store.

        Args:
            session_id: session identifier
            role: "user" or "assistant"
            content: message text
            files: list of file paths in context (user messages)
            images: list of data URI strings, or int (legacy)
            files_modified: list of modified file paths (assistant messages)
            edit_results: list of edit result dicts (assistant messages)

        Returns:
            The message dict that was stored.
        """
        msg = {
            "id": _generate_message_id(),
            "session_id": session_id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "role": role,
            "content": content,
        }

        if files:
            msg["files"] = list(files)

        if files_modified:
            msg["files_modified"] = list(files_modified)

        if edit_results:
            msg["edit_results"] = list(edit_results)

        # Handle images
        if images is not None:
            if isinstance(images, int):
                # Legacy: store count
                msg["images"] = images
            elif isinstance(images, list) and images:
                # Save image files and store references
                image_refs = []
                for data_uri in images:
                    filename = self._save_image(data_uri)
                    if filename:
                        image_refs.append(filename)
                if image_refs:
                    msg["image_refs"] = image_refs

        # Append to JSONL
        try:
            with open(self._history_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(msg, ensure_ascii=False) + "\n")
        except OSError as e:
            logger.error(f"Failed to write history: {e}")

        return msg

    def _save_image(self, data_uri):
        """Save a data URI image to .ac-dc/images/.

        Returns filename on success, None on failure.
        """
        mime, data = _parse_data_uri(data_uri)
        if data is None:
            return None

        ext = MIME_EXTENSIONS.get(mime, ".png")
        hash_str = _data_uri_hash(data_uri)
        epoch_ms = int(time.time() * 1000)
        filename = f"{epoch_ms}-{hash_str}{ext}"

        filepath = self._images_dir / filename
        if filepath.exists():
            return filename  # Deduplicate

        try:
            filepath.write_bytes(data)
            return filename
        except OSError as e:
            logger.error(f"Failed to save image: {e}")
            return None

    def _load_image(self, filename):
        """Load an image file and return data URI string, or None."""
        filepath = self._images_dir / filename
        if not filepath.exists():
            logger.warning(f"Image file missing: {filename}")
            return None

        try:
            data = filepath.read_bytes()
        except OSError as e:
            logger.warning(f"Failed to read image {filename}: {e}")
            return None

        # Determine MIME from extension
        ext = filepath.suffix.lower()
        ext_to_mime = {v: k for k, v in MIME_EXTENSIONS.items()}
        mime = ext_to_mime.get(ext, "image/png")

        encoded = base64.b64encode(data).decode("ascii")
        return f"data:{mime};base64,{encoded}"

    def _reconstruct_images(self, msg):
        """Reconstruct image data URIs from image_refs in a message.

        Returns list of data URI strings, or empty list.
        """
        refs = msg.get("image_refs", [])
        if not refs:
            return []

        images = []
        for filename in refs:
            uri = self._load_image(filename)
            if uri:
                images.append(uri)
        return images

    def _load_all_messages(self):
        """Load all messages from JSONL. Skips corrupt lines."""
        messages = []
        if not self._history_file.exists():
            return messages

        try:
            with open(self._history_file, "r", encoding="utf-8") as f:
                for line_num, line in enumerate(f, 1):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        msg = json.loads(line)
                        messages.append(msg)
                    except json.JSONDecodeError:
                        logger.warning(
                            f"Skipping corrupt JSONL line {line_num} in history"
                        )
        except OSError as e:
            logger.error(f"Failed to read history: {e}")

        return messages

    def get_session_messages(self, session_id):
        """Get all messages from a specific session.

        Returns list of full message dicts (with metadata).
        """
        all_msgs = self._load_all_messages()
        session_msgs = [m for m in all_msgs if m.get("session_id") == session_id]

        # Reconstruct images
        for msg in session_msgs:
            images = self._reconstruct_images(msg)
            if images:
                msg["_images"] = images

        return session_msgs

    def get_session_messages_for_context(self, session_id):
        """Get messages for loading into context manager.

        Returns list of {role, content} dicts only (no metadata).
        Images are reconstructed into a separate _images field.
        """
        all_msgs = self._load_all_messages()
        result = []
        for msg in all_msgs:
            if msg.get("session_id") != session_id:
                continue
            entry = {
                "role": msg.get("role", "user"),
                "content": msg.get("content", ""),
            }
            images = self._reconstruct_images(msg)
            if images:
                entry["_images"] = images
            result.append(entry)
        return result

    def list_sessions(self, limit=None):
        """List sessions, newest first.

        Returns list of SessionSummary dicts:
            session_id, timestamp, message_count, preview, first_role
        """
        all_msgs = self._load_all_messages()

        # Group by session
        sessions = {}
        for msg in all_msgs:
            sid = msg.get("session_id")
            if not sid:
                continue
            if sid not in sessions:
                sessions[sid] = []
            sessions[sid].append(msg)

        # Build summaries
        summaries = []
        for sid, msgs in sessions.items():
            if not msgs:
                continue
            first = msgs[0]
            preview = first.get("content", "")[:100]
            summaries.append({
                "session_id": sid,
                "timestamp": first.get("timestamp", ""),
                "message_count": len(msgs),
                "preview": preview,
                "first_role": first.get("role", "user"),
            })

        # Sort by timestamp descending (newest first)
        summaries.sort(key=lambda s: s["timestamp"], reverse=True)

        if limit is not None:
            summaries = summaries[:limit]

        return summaries

    def search(self, query, role=None, limit=50):
        """Case-insensitive substring search across all messages.

        Args:
            query: search string (empty returns empty)
            role: optional role filter ("user" or "assistant")
            limit: max results

        Returns list of message dicts.
        """
        if not query:
            return []

        all_msgs = self._load_all_messages()
        query_lower = query.lower()
        results = []

        for msg in all_msgs:
            if role and msg.get("role") != role:
                continue
            content = msg.get("content", "")
            if query_lower in content.lower():
                results.append(msg)
                if len(results) >= limit:
                    break

        return results