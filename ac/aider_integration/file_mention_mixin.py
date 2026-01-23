"""
File mention detection mixin for AiderChat.

Uses aider's word-matching approach to detect file mentions in LLM responses.
"""

import os


class FileMentionMixin:
    """Mixin for detecting file mentions in LLM responses."""
    
    def get_addable_files(self):
        """
        Get files that are in the repo but not in the current chat context.
        
        Returns:
            Set of relative file paths that could be added
        """
        if not self.repo or not self._context_manager:
            return set()
        
        # Get all tracked files from the git repo
        tracked = set(self._context_manager.git_repo.get_tracked_files())
        
        # Get files currently in chat context
        current_files = set(self.editor.get_file_list())
        
        # Return files not yet in context
        return tracked - current_files
    
    def detect_file_mentions(self, response_text: str) -> set:
        """
        Detect files mentioned in LLM response that aren't in context.
        
        Uses aider's word-matching approach against known repo files.
        
        Args:
            response_text: The LLM response text to analyze
            
        Returns:
            Set of relative file paths mentioned but not in context
        """
        addable_files = self.get_addable_files()
        if not addable_files:
            return set()
        
        # Normalize response text into words
        words = set(word for word in response_text.split())
        words = set(word.rstrip(",.!;:?") for word in words)
        words = set(word.strip("\"'`*_") for word in words)
        words = set(word.replace("\\", "/") for word in words)
        
        mentioned = set()
        
        # Check full paths
        for rel_fname in addable_files:
            normalized = rel_fname.replace("\\", "/")
            if normalized in words:
                mentioned.add(rel_fname)
        
        # Build basename -> full paths mapping
        fname_to_rel = {}
        for rel_fname in addable_files:
            basename = os.path.basename(rel_fname)
            fname_to_rel.setdefault(basename, []).append(rel_fname)
        
        # Check basenames (only if unique and looks like a filename)
        for basename, rel_fnames in fname_to_rel.items():
            if basename in words:
                # Only match if basename uniquely identifies one file
                # and contains path-like characters (to avoid matching common words)
                if len(rel_fnames) == 1:
                    if any(c in basename for c in "._-") or basename.count('.') > 0:
                        mentioned.add(rel_fnames[0])
        
        return mentioned
    
    def check_for_file_requests(self, response_text: str) -> dict:
        """
        Check if the LLM is asking for files to be added to context.
        
        Args:
            response_text: The LLM response text
            
        Returns:
            Dict with:
            - mentioned_files: Set of files mentioned but not in context
            - needs_files: Boolean indicating if LLM seems to need more files
        """
        mentioned = self.detect_file_mentions(response_text)
        
        # Check for common phrases indicating the LLM needs files
        needs_files_phrases = [
            "add the file",
            "add the files",
            "need to see",
            "please add",
            "haven't been added",
            "not in the chat",
            "not added to the chat",
            "share the file",
            "share the content",
            "provide the file",
            "provide the content",
            "show me the file",
            "include the file",
        ]
        
        response_lower = response_text.lower()
        needs_files = any(phrase in response_lower for phrase in needs_files_phrases)
        
        return {
            "mentioned_files": mentioned,
            "needs_files": needs_files or bool(mentioned)
        }
