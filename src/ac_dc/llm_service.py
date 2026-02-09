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


def _init_symbol_index(repo_root: Path):
    """Initialize symbol index, returning None if tree-sitter unavailable."""
    try:
        from .symbol_index import SymbolIndex
        idx = SymbolIndex(repo_root)
        if idx.available:
            return idx
        log.warning("Tree-sitter not available — symbol index disabled")
    except Exception as e:
        log.warning("Symbol index init failed: %s", e)
    return None


class LLM:
    """LLM service exposed via RPC.

    All public methods become remotely callable as LLM.<method_name>.
    """

    def __init__(self, config: ConfigManager, repo: Repo):
        self._config = config
        self._repo = repo
        self._model = config.get_llm_config().get("model", "")
        self._counter = TokenCounter(self._model)

        # Symbol index
        self._symbol_index = _init_symbol_index(repo.root)
        if self._symbol_index:
            self._build_symbol_index()

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
    # Symbol index
    # ------------------------------------------------------------------

    def _build_symbol_index(self):
        """Build the symbol index from repo files."""
        if self._symbol_index is None:
            return
        try:
            self._symbol_index.index_repo()
            # Save symbol map to .ac-dc/
            self._save_symbol_map()
        except Exception as e:
            log.warning("Symbol index build failed: %s", e)

    def _save_symbol_map(self):
        """Save symbol map to .ac-dc/symbol_map.txt."""
        if self._symbol_index is None:
            return
        try:
            out_path = self._config.ac_dc_dir / "symbol_map.txt"
            symbol_map = self._symbol_index.get_symbol_map(
                exclude_files=set(self._selected_files),
            )
            out_path.write_text(symbol_map, encoding="utf-8")
        except Exception as e:
            log.warning("Failed to save symbol map: %s", e)

    def rebuild_symbol_index(self) -> dict:
        """Rebuild the symbol index (e.g. after file changes)."""
        if self._symbol_index is None:
            return {"error": "Symbol index not available"}
        self._build_symbol_index()
        return {"ok": True}

    def invalidate_symbol_files(self, file_paths: list[str]):
        """Invalidate symbol cache for modified files."""
        if self._symbol_index:
            self._symbol_index.invalidate_files(file_paths)

    def get_symbol_map(self) -> str:
        """Return the current symbol map text."""
        if self._symbol_index is None:
            return ""
        return self._symbol_index.get_symbol_map(
            exclude_files=set(self._selected_files),
        )

    def get_symbol_map_chunks(self, num_chunks: int = 3) -> list[dict]:
        """Get symbol map split into chunks for cache tier distribution."""
        if self._symbol_index is None:
            return []
        return self._symbol_index.get_symbol_map_chunks(
            exclude_files=set(self._selected_files),
            num_chunks=num_chunks,
        )

    # ------------------------------------------------------------------
    # LSP
    # ------------------------------------------------------------------

    def lsp_get_hover(self, path: str, line: int, col: int) -> str:
        if self._symbol_index is None:
            return ""
        return self._symbol_index.get_hover_info(path, line, col)

    def lsp_get_definition(self, path: str, line: int, col: int) -> Optional[dict]:
        if self._symbol_index is None:
            return None
        return self._symbol_index.get_definition(path, line, col)

    def lsp_get_references(self, path: str, line: int, col: int) -> list[dict]:
        if self._symbol_index is None:
            return []
        return self._symbol_index.get_references(path, line, col)

    def lsp_get_completions(self, path: str, line: int, col: int) -> list[dict]:
        if self._symbol_index is None:
            return []
        # Extract prefix from the line
        try:
            file_result = self._repo.get_file_content(path)
            content = file_result.get("content", "")
            lines = content.splitlines()
            if 0 < line <= len(lines):
                line_text = lines[line - 1]
                prefix = ""
                if col > 0 and col <= len(line_text):
                    # Walk backwards from cursor to find word start
                    i = col - 1
                    while i >= 0 and (line_text[i].isalnum() or line_text[i] == "_"):
                        i -= 1
                    prefix = line_text[i + 1:col]
                return self._symbol_index.get_completions(path, line, col, prefix)
        except Exception:
            pass
        return self._symbol_index.get_completions(path, line, col)
