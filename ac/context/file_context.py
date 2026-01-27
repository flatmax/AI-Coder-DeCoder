"""
File context management for LLM prompts.

Tracks files in the conversation context and formats them for inclusion in prompts.
"""

from pathlib import Path
from typing import Optional


class FileContext:
    """
    Manages files included in LLM conversation context.
    
    Tracks file contents and provides formatting for prompt inclusion.
    """
    
    def __init__(self, repo_root: str = None):
        """
        Initialize file context.
        
        Args:
            repo_root: Repository root for resolving relative paths.
                      If None, uses current working directory.
        """
        self.repo_root = Path(repo_root) if repo_root else Path.cwd()
        self._files: dict[str, str] = {}  # path -> content
    
    def add_file(self, filepath: str, content: str = None) -> None:
        """
        Add a file to the context.
        
        Args:
            filepath: Path to the file (relative to repo_root or absolute)
            content: File content. If None, reads from disk.
            
        Raises:
            FileNotFoundError: If content is None and file doesn't exist
        """
        # Normalize path
        path = Path(filepath)
        if not path.is_absolute():
            abs_path = self.repo_root / path
        else:
            abs_path = path
            # Try to make it relative for storage
            try:
                filepath = str(path.relative_to(self.repo_root))
            except ValueError:
                filepath = str(path)
        
        if content is None:
            if not abs_path.exists():
                raise FileNotFoundError(f"File not found: {filepath}")
            content = abs_path.read_text(encoding='utf-8')
        
        # Store with normalized relative path
        self._files[str(filepath)] = content
    
    def remove_file(self, filepath: str) -> bool:
        """
        Remove a file from the context.
        
        Args:
            filepath: Path to the file
            
        Returns:
            True if file was removed, False if it wasn't in context
        """
        filepath = str(filepath)
        if filepath in self._files:
            del self._files[filepath]
            return True
        return False
    
    def get_files(self) -> list[str]:
        """
        Get list of file paths in context.
        
        Returns:
            List of file paths (as stored, typically relative)
        """
        return list(self._files.keys())
    
    def get_content(self, filepath: str) -> Optional[str]:
        """
        Get content of a file in context.
        
        Args:
            filepath: Path to the file
            
        Returns:
            File content, or None if not in context
        """
        return self._files.get(str(filepath))
    
    def has_file(self, filepath: str) -> bool:
        """
        Check if a file is in context.
        
        Args:
            filepath: Path to the file
            
        Returns:
            True if file is in context
        """
        return str(filepath) in self._files
    
    def clear(self) -> None:
        """Clear all files from context."""
        self._files.clear()
    
    def __len__(self) -> int:
        """Return number of files in context."""
        return len(self._files)
    
    def __contains__(self, filepath: str) -> bool:
        """Check if file is in context."""
        return self.has_file(filepath)
    
    def format_for_prompt(self, fence: tuple[str, str] = ("```", "```")) -> str:
        """
        Format all files for inclusion in a prompt.
        
        Args:
            fence: Tuple of (open_fence, close_fence) for code blocks
            
        Returns:
            Formatted string with all files wrapped in fences
        """
        if not self._files:
            return ""
        
        parts = []
        for filepath, content in self._files.items():
            parts.append(f"{filepath}\n{fence[0]}\n{content}\n{fence[1]}")
        
        return "\n\n".join(parts)
    
    def count_tokens(self, token_counter) -> int:
        """
        Count total tokens in all files.
        
        Args:
            token_counter: TokenCounter instance
            
        Returns:
            Total token count across all files
        """
        if not self._files:
            return 0
        
        # Count tokens in formatted output (includes filenames and fences)
        formatted = self.format_for_prompt()
        return token_counter.count(formatted)
    
    def get_tokens_by_file(self, token_counter) -> dict[str, int]:
        """
        Get token count for each file.
        
        Args:
            token_counter: TokenCounter instance
            
        Returns:
            Dict mapping filepath to token count
        """
        result = {}
        fence = ("```", "```")
        
        for filepath, content in self._files.items():
            # Format single file the same way as format_for_prompt
            formatted = f"{filepath}\n{fence[0]}\n{content}\n{fence[1]}"
            result[filepath] = token_counter.count(formatted)
        
        return result
