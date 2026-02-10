"""Persistent conversation history — append-only JSONL storage.

Stores messages per-repository in `.ac-dc/history.jsonl`.
Supports session management, search, and loading into active context.
"""

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)


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

    def append_message(
        self,
        session_id: str,
        role: str,
        content: str,
        files: Optional[list[str]] = None,
        files_modified: Optional[list[str]] = None,
        edit_results: Optional[list[dict]] = None,
        images: int = 0,
    ) -> dict:
        """Append a message to the JSONL file and in-memory index."""
        self._ensure_loaded()

        msg = {
            "id": _make_message_id(),
            "session_id": session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "role": role,
            "content": content,
        }
        if images:
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
        """Get session messages in context manager format ({role, content})."""
        msgs = self.get_session(session_id)
        return [{"role": m["role"], "content": m["content"]} for m in msgs]
