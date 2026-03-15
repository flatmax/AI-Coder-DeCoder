"""File context — tracks files included in conversation."""

import logging
from pathlib import PurePosixPath
from typing import Optional

logger = logging.getLogger(__name__)


class FileContext:
    """Tracks files included in the LLM conversation with their contents.

    Paths are normalized to forward-slash relative paths.
    Binary files are rejected. Path traversal is blocked.
    """

    def __init__(self, repo_root: Optional[str] = None):
        self._files: dict[str, str] = {}  # normalized_path -> content
        self._repo_root = repo_root

    def _normalize_path(self, path: str) -> str:
        """Normalize to forward-slash, strip leading/trailing slashes."""
        path = path.replace("\\", "/").strip("/")
        if ".." in path:
            raise ValueError(f"Path traversal rejected: {path}")
        return path

    def add_file(self, path: str, content: Optional[str] = None) -> bool:
        """Add a file to context. Returns False if file cannot be added."""
        try:
            path = self._normalize_path(path)
        except ValueError:
            return False

        if content is not None:
            self._files[path] = content
            return True

        # Read from disk if no content provided
        if not self._repo_root:
            return False

        from pathlib import Path as PathLib
        abs_path = PathLib(self._repo_root) / path
        if not abs_path.exists():
            return False

        # Binary check
        try:
            with open(abs_path, "rb") as f:
                chunk = f.read(8192)
            if b"\x00" in chunk:
                return False
            content = abs_path.read_text(encoding="utf-8", errors="replace")
            self._files[path] = content
            return True
        except OSError:
            return False

    def remove_file(self, path: str):
        """Remove a file from context."""
        try:
            path = self._normalize_path(path)
        except ValueError:
            return
        self._files.pop(path, None)

    def get_files(self) -> list[str]:
        """Sorted list of file paths in context."""
        return sorted(self._files.keys())

    def get_content(self, path: str) -> Optional[str]:
        """Get content for a specific file."""
        try:
            path = self._normalize_path(path)
        except ValueError:
            return None
        return self._files.get(path)

    def has_file(self, path: str) -> bool:
        """Check if file is in context."""
        try:
            path = self._normalize_path(path)
        except ValueError:
            return False
        return path in self._files

    def clear(self):
        """Remove all files."""
        self._files.clear()

    def format_for_prompt(self) -> str:
        """Format all files as fenced code blocks."""
        blocks = []
        for path in sorted(self._files.keys()):
            content = self._files[path]
            blocks.append(f"{path}\n```\n{content}\n```")
        return "\n\n".join(blocks)

    def count_tokens(self, counter) -> int:
        """Total tokens across all files."""
        total = 0
        for path, content in self._files.items():
            # Path + fencing + content
            text = f"{path}\n```\n{content}\n```"
            total += counter.count(text)
        return total

    def get_tokens_by_file(self, counter) -> dict[str, int]:
        """Per-file token counts."""
        result = {}
        for path, content in self._files.items():
            text = f"{path}\n```\n{content}\n```"
            result[path] = counter.count(text)
        return result