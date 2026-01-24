"""
Edit application utilities for AiderEditor.

Handles parsing and applying search/replace edits to files.
"""

from pathlib import Path

from aider.coders.editblock_coder import find_original_update_blocks, do_replace


class EditApplierMixin:
    """Mixin for edit parsing and application."""
    
    def parse_response(self, response_text):
        """
        Parse an LLM response for search/replace blocks.
        
        Args:
            response_text: The LLM's response containing edit blocks
            
        Returns:
            Tuple of (file_edits, shell_commands) where:
            - file_edits: List of (filename, original, updated) tuples
            - shell_commands: List of shell command strings
        """
        valid_fnames = list(self.files.keys())
        edits = list(find_original_update_blocks(
            response_text, 
            self.fence, 
            valid_fnames
        ))
        
        file_edits = []
        shell_commands = []
        for edit in edits:
            if edit[0] is None:
                shell_commands.append(edit[1])
            else:
                file_edits.append(edit)
        
        return file_edits, shell_commands
    
    def apply_edits(self, edits, dry_run=False):
        """
        Apply edits to files.
        
        Args:
            edits: List of (filename, original, updated) tuples
            dry_run: If True, don't actually write files
            
        Returns:
            Dict with 'passed', 'failed', and 'content' (new file contents)
        """
        passed = []
        failed = []
        new_contents = {}
        new_files = []
        
        for edit in edits:
            filename, original, updated = edit
            
            # Get current content
            if filename in self.files:
                content = self.files[filename]
                is_new_file = False
            elif Path(filename).exists():
                content = Path(filename).read_text()
                is_new_file = False
            else:
                # New file
                content = ""
                is_new_file = True
            
            # Create parent directories if needed (before do_replace which may touch the file)
            if is_new_file:
                Path(filename).parent.mkdir(parents=True, exist_ok=True)
            
            # Apply the replacement
            new_content = do_replace(filename, content, original, updated, self.fence)
            
            if new_content is not None:
                new_contents[filename] = new_content
                if not dry_run:
                    # Update in-memory content
                    self.files[filename] = new_content
                    # Write to disk (parent dirs already created for new files)
                    if not is_new_file:
                        Path(filename).parent.mkdir(parents=True, exist_ok=True)
                    Path(filename).write_text(new_content)
                    # Track new files for git add
                    if is_new_file:
                        new_files.append(filename)
                passed.append(edit)
            else:
                failed.append(edit)
        
        # Git add new files
        if not dry_run and new_files and self.repo:
            self._git_add_files(new_files)
        
        return {"passed": passed, "failed": failed, "content": new_contents}
    
    def _git_add_files(self, file_paths):
        """
        Add files to git staging area.
        
        Args:
            file_paths: List of file paths to add
        """
        try:
            for file_path in file_paths:
                self.repo._repo.index.add([file_path])
        except Exception as e:
            print(f"Warning: Failed to git add files: {e}")
    
    def apply_edits_to_content(self, edits, file_contents):
        """
        Apply edits to provided file contents without touching disk.
        
        Args:
            edits: List of (filename, original, updated) tuples
            file_contents: Dict of filename -> content
            
        Returns:
            Dict with 'passed', 'failed', and 'content' (new file contents)
        """
        passed = []
        failed = []
        new_contents = dict(file_contents)
        
        for edit in edits:
            filename, original, updated = edit
            content = new_contents.get(filename, "")
            
            new_content = do_replace(filename, content, original, updated, self.fence)
            
            if new_content is not None:
                new_contents[filename] = new_content
                passed.append(edit)
            else:
                failed.append(edit)
        
        return {"passed": passed, "failed": failed, "content": new_contents}
