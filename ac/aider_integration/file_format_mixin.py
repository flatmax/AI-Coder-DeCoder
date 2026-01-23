"""
File formatting mixin for context manager.

Handles formatting file contents for LLM context.
"""

from pathlib import Path


class FileFormatMixin:
    """Mixin for file formatting operations."""

    def format_files(self, file_paths: list, fence=("```", "```")) -> str:
        """Format multiple files with fences."""
        output = ""
        for fpath in file_paths:
            content = self.io.read_text(fpath)
            if content:
                try:
                    rel = str(Path(fpath).relative_to(self.repo_root))
                except ValueError:
                    rel = fpath
                output += f"{rel}\n{fence[0]}\n{content}\n{fence[1]}\n\n"
        return output
