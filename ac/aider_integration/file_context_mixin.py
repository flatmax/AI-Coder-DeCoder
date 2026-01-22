"""
File context management for AiderEditor.

Handles loading and formatting files for LLM context.
"""

from pathlib import Path


class FileContextMixin:
    """Mixin for file context operations."""
    
    def _init_files(self):
        """Initialize the files dict."""
        self.files = {}
    
    def add_file(self, filepath):
        """
        Add a file to the context from disk.
        
        Args:
            filepath: Path to the file to add
        """
        path = Path(filepath)
        if path.exists():
            self.files[str(filepath)] = path.read_text()
        else:
            raise FileNotFoundError(f"File not found: {filepath}")
    
    def add_file_content(self, filepath, content):
        """
        Add a file with provided content (useful for in-memory files).
        
        Args:
            filepath: The filename/path to use
            content: The file content
        """
        self.files[str(filepath)] = content
    
    def get_file_content(self, filepath):
        """Get content of a file in context."""
        return self.files.get(str(filepath))
    
    def get_file_list(self):
        """Return list of files in context."""
        return list(self.files.keys())
    
    def clear_files(self):
        """Clear all files from context."""
        self.files = {}
    
    def format_files_for_prompt(self):
        """Build the file context string showing all files."""
        context_parts = []
        for filepath, content in self.files.items():
            context_parts.append(f"{filepath}\n{self.fence[0]}\n{content}\n{self.fence[1]}")
        return "\n\n".join(context_parts)
