"""
Aider Context Manager - Side-load messages in/out
You handle: litellm calls, edit parsing/applying
Aider handles: repo map, token counting, history management, context assembly
"""

from pathlib import Path

from .token_counter import TokenCounter
from .minimal_io import MinimalIO
from .hud_mixin import HudMixin
from .history_mixin import HistoryMixin
from .repo_map_mixin import RepoMapMixin
from .token_report_mixin import TokenReportMixin
from .file_format_mixin import FileFormatMixin
from .context_builder_mixin import ContextBuilderMixin


class AiderContextManager(
    HudMixin,
    HistoryMixin,
    RepoMapMixin,
    TokenReportMixin,
    FileFormatMixin,
    ContextBuilderMixin,
):
    """
    Side-load messages in/out for context management.
    No LLM calls - you handle those.
    """

    def __init__(self, repo_root: str, model_name: str, token_tracker=None):
        from aider.repo import GitRepo
        from aider.repomap import RepoMap

        self.repo_root = Path(repo_root)
        self.model_name = model_name
        self.token_tracker = token_tracker
        self.token_counter = TokenCounter(model_name)
        self.io = MinimalIO()

        # Use aider's GitRepo to get tracked files only
        self.git_repo = GitRepo(
            self.io,
            fnames=[],
            git_dname=str(repo_root),
        )

        max_input = self.token_counter.info.get("max_input_tokens", 128000)

        self.repo_map = RepoMap(
            map_tokens=max_input // 32,
            root=str(repo_root),
            main_model=self.token_counter,
            io=self.io,
            max_context_window=max_input,
        )

        self.done_messages = []
        self.max_history_tokens = max_input // 16
        
        # Track last repo map token count for HUD
        self._last_repo_map_tokens = 0
        self._last_chat_files_count = 0

    def count_tokens(self, content) -> int:
        """Count tokens in content."""
        return self.token_counter.token_count(content)
