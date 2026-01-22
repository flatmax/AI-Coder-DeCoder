"""
Aider-based code editor using search/replace blocks.

Uses aider's battle-tested search/replace implementation for reliable code edits.
"""

from pathlib import Path

from aider.coders.editblock_prompts import EditBlockPrompts
from aider.coders.editblock_coder import find_original_update_blocks, do_replace


class AiderEditor:
    """
    Code editor using aider's search/replace block format.
    
    This class provides methods to parse LLM responses containing search/replace
    blocks and apply them to files.
    """
    
    def __init__(self, fence=None):
        """
        Initialize the editor.
        
        Args:
            fence: Tuple of (open_fence, close_fence), defaults to ("```", "```")
        """
        self.fence = fence or ("```", "```")
        self.prompts = EditBlockPrompts()
        self.files = {}  # filename -> content
    
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
    
    def get_system_prompt(self):
        """Build the system prompt from EditBlockPrompts."""
        system = self.prompts.main_system.format(
            language="the same language the user uses",
            final_reminders="",
            shell_cmd_prompt="",
        )
        return system
    
    def get_system_reminder(self):
        """Build the system reminder with rules."""
        reminder = self.prompts.system_reminder.format(
            fence=self.fence,
            quad_backtick_reminder="",
            rename_with_shell="",
            go_ahead_tip=self.prompts.go_ahead_tip,
            final_reminders="",
            shell_cmd_reminder="",
        )
        return reminder
    
    def get_example_messages(self):
        """Build the few-shot example messages."""
        examples = []
        for msg in self.prompts.example_messages:
            content = msg["content"].format(fence=self.fence)
            examples.append({
                "role": msg["role"],
                "content": content
            })
        return examples
    
    def format_files_for_prompt(self):
        """Build the file context string showing all files."""
        context_parts = []
        for filepath, content in self.files.items():
            context_parts.append(f"{filepath}\n{self.fence[0]}\n{content}\n{self.fence[1]}")
        return "\n\n".join(context_parts)
    
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
        
        for edit in edits:
            filename, original, updated = edit
            
            # Get current content
            if filename in self.files:
                content = self.files[filename]
            elif Path(filename).exists():
                content = Path(filename).read_text()
            else:
                # New file
                content = ""
            
            # Apply the replacement
            new_content = do_replace(filename, content, original, updated, self.fence)
            
            if new_content is not None:
                new_contents[filename] = new_content
                if not dry_run:
                    # Update in-memory content
                    self.files[filename] = new_content
                    # Write to disk
                    Path(filename).parent.mkdir(parents=True, exist_ok=True)
                    Path(filename).write_text(new_content)
                passed.append(edit)
            else:
                failed.append(edit)
        
        return {"passed": passed, "failed": failed, "content": new_contents}
    
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
