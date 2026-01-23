"""
File management mixin for AiderChat.

Handles adding, clearing, and retrieving files from the editing context.
"""


class FileManagementMixin:
    """Mixin for file management operations."""
    
    def add_file(self, filepath):
        """Add a file to the editing context."""
        if self.repo:
            content = self.repo.get_file_content(filepath)
            if isinstance(content, dict) and 'error' in content:
                raise FileNotFoundError(content['error'])
            self.editor.add_file_content(filepath, content)
        else:
            self.editor.add_file(filepath)
    
    def add_file_content(self, filepath, content):
        """Add a file with provided content."""
        self.editor.add_file_content(filepath, content)
    
    def get_files(self):
        """Get list of files in context."""
        return self.editor.get_file_list()
    
    def clear_files(self):
        """Clear all files from context."""
        self.editor.clear_files()
