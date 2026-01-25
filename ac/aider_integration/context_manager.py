"""
Context Manager - Token counting and history management.

Handles token counting, history management, and context assembly.
Symbol index is used for repository mapping (see llm.py get_context_map).
"""

from pathlib import Path

from .token_counter import TokenCounter
from .minimal_io import MinimalIO
from .hud_mixin import HudMixin
from .history_mixin import HistoryMixin
from .token_report_mixin import TokenReportMixin
from .file_format_mixin import FileFormatMixin


class AiderContextManager(
    HudMixin,
    HistoryMixin,
    TokenReportMixin,
    FileFormatMixin,
):
    """
    Context management for LLM calls.
    Handles token counting, history, and context assembly.
    Repository mapping is handled by symbol index (see llm.py).
    """

    def __init__(self, repo_root: str, model_name: str, token_tracker=None):
        self.repo_root = Path(repo_root)
        self.model_name = model_name
        self.token_tracker = token_tracker
        self.token_counter = TokenCounter(model_name)
        self.io = MinimalIO()

        max_input = self.token_counter.info.get("max_input_tokens", 128000)

        self.done_messages = []
        self.max_history_tokens = max_input // 16
        
        # Track for HUD display
        self._last_repo_map_tokens = 0
        self._last_chat_files_count = 0

    def count_tokens(self, content) -> int:
        """Count tokens in content."""
        return self.token_counter.token_count(content)
