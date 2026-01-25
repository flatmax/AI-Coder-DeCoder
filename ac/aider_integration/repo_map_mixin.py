"""
Repo map mixin for context manager.

Handles intelligent repository map generation using aider's RepoMap.
"""


class RepoMapMixin:
    """Mixin for repo map operations."""

    def get_repo_map(
        self,
        chat_files: list,
        mentioned_fnames: set = None,
        mentioned_idents: set = None,
    ) -> str:
        """Generate intelligent repo map. Returns formatted string or None."""
        # Get git-tracked files only (respects .gitignore)
        tracked = self.git_repo.get_tracked_files()

        # Convert to absolute paths, excluding chat_files
        other_files = [
            str(self.repo_root / f)
            for f in tracked
            if str(self.repo_root / f) not in chat_files
        ]

        result = self.repo_map.get_repo_map(
            chat_files=chat_files,
            other_files=other_files,
            mentioned_fnames=mentioned_fnames or set(),
            mentioned_idents=mentioned_idents or set(),
        )
        
        # Track for HUD
        self._last_repo_map_tokens = self.count_tokens(result) if result else 0
        self._last_chat_files_count = len(chat_files)
        
        # Cache the last generated repo map
        self._last_repo_map = result
        
        return result
