"""LLM service — orchestrates context, streaming, and edit application.

This is a stub for Phase 1. Full implementation comes in Phase 3+.
"""

import logging
import uuid
import time
from pathlib import Path
from typing import Any, Optional

from .config import ConfigManager
from .repo import Repo
from .token_counter import TokenCounter

log = logging.getLogger(__name__)


class LLM:
    """LLM service exposed via RPC.

    All public methods become remotely callable as LLM.<method_name>.
    """

    def __init__(self, config: ConfigManager, repo: Repo):
        self._config = config
        self._repo = repo
        self._model = config.get_llm_config().get("model", "")
        self._counter = TokenCounter(self._model)

        # Session state
        self._session_id = self._new_session_id()
        self._messages: list[dict] = []
        self._selected_files: list[str] = []
        self._streaming_active = False
        self._active_request_id: Optional[str] = None

    def _new_session_id(self) -> str:
        return f"sess_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}"

    # ------------------------------------------------------------------
    # State management
    # ------------------------------------------------------------------

    def get_current_state(self) -> dict:
        """Return current session state for client reconnection."""
        return {
            "messages": list(self._messages),
            "selected_files": list(self._selected_files),
            "streaming_active": self._streaming_active,
            "session_id": self._session_id,
        }

    def set_selected_files(self, files: list[str]) -> dict:
        """Update selected files list."""
        self._selected_files = list(files)
        return {"ok": True, "selected_files": self._selected_files}

    def get_selected_files(self) -> list[str]:
        return list(self._selected_files)

    # ------------------------------------------------------------------
    # Chat (stub — Phase 3 will implement full streaming)
    # ------------------------------------------------------------------

    def chat_streaming(self, request_id: str, message: str,
                       files: list[str] = None, images: list[str] = None) -> dict:
        """Start a streaming chat request. Stub implementation."""
        if self._streaming_active:
            return {"error": "A stream is already active"}

        self._streaming_active = True
        self._active_request_id = request_id

        # For now, just record the message
        self._messages.append({"role": "user", "content": message})
        self._messages.append({"role": "assistant", "content": "[LLM streaming not yet implemented]"})

        self._streaming_active = False
        self._active_request_id = None

        return {"status": "started"}

    def cancel_streaming(self, request_id: str) -> dict:
        if self._active_request_id == request_id:
            self._streaming_active = False
            self._active_request_id = None
            return {"ok": True}
        return {"error": "No matching active stream"}

    # ------------------------------------------------------------------
    # History (stub — Phase 5)
    # ------------------------------------------------------------------

    def history_new_session(self) -> dict:
        self._session_id = self._new_session_id()
        self._messages = []
        return {"session_id": self._session_id}

    def history_list_sessions(self, limit: int = 20) -> list[dict]:
        return []

    def history_get_session(self, session_id: str) -> list[dict]:
        return []

    def history_search(self, query: str, role: str = None, limit: int = 50) -> list[dict]:
        return []

    # ------------------------------------------------------------------
    # Context info (stub — Phase 4)
    # ------------------------------------------------------------------

    def get_context_breakdown(self, selected_files: list[str] = None,
                               included_urls: list[str] = None) -> dict:
        return {
            "blocks": [],
            "breakdown": {
                "system": {"tokens": 0},
                "symbol_map": {"tokens": 0, "files": 0, "chunks": []},
                "files": {"tokens": 0, "items": []},
                "urls": {"tokens": 0, "items": []},
                "history": {"tokens": 0, "needs_summary": False, "max_tokens": 0},
            },
            "total_tokens": 0,
            "cached_tokens": 0,
            "cache_hit_rate": 0,
            "max_input_tokens": self._counter.max_input_tokens,
            "model": self._model,
            "promotions": [],
            "demotions": [],
            "session_totals": {
                "prompt": 0, "completion": 0, "total": 0,
                "cache_hit": 0, "cache_write": 0,
            },
        }

    # ------------------------------------------------------------------
    # LSP stubs (Phase 2)
    # ------------------------------------------------------------------

    def lsp_get_hover(self, path: str, line: int, col: int) -> str:
        return ""

    def lsp_get_definition(self, path: str, line: int, col: int) -> Optional[dict]:
        return None

    def lsp_get_references(self, path: str, line: int, col: int) -> list[dict]:
        return []

    def lsp_get_completions(self, path: str, line: int, col: int) -> list[dict]:
        return []
