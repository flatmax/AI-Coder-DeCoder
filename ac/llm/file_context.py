class FileContextMixin:
    """Mixin for file context loading operations."""
    
    def load_files_as_context(self, file_paths, version='working'):
        """
        Load multiple files from the repository as context.
        
        Args:
            file_paths: List of file paths relative to repo root
            version: 'working', 'HEAD', or commit hash
        
        Returns:
            List of dicts with file path and content
        """
        if not self.repo:
            return [{'error': 'No repository configured'}]
        
        files_content = []
        for file_path in file_paths:
            if self.repo.is_binary_file(file_path):
                files_content.append({
                    'path': file_path,
                    'content': None,
                    'is_binary': True,
                    'error': 'Binary file - content not loaded as text'
                })
                continue
            
            content = self.repo.get_file_content(file_path, version)
            if isinstance(content, dict) and 'error' in content:
                files_content.append({
                    'path': file_path,
                    'content': None,
                    'error': content['error']
                })
            else:
                files_content.append({
                    'path': file_path,
                    'content': content,
                    'is_binary': False
                })
        
        return files_content
    
    def list_files_in_context(self, file_paths):
        """
        Check which files exist and can be loaded.
        
        Args:
            file_paths: List of file paths to check
        
        Returns:
            Dict with 'valid' and 'invalid' file lists
        """
        if not self.repo:
            return {'error': 'No repository configured'}
        
        valid = []
        invalid = []
        
        for file_path in file_paths:
            if self.repo.file_exists(file_path):
                is_binary = self.repo.is_binary_file(file_path)
                valid.append({
                    'path': file_path,
                    'is_binary': is_binary
                })
            else:
                invalid.append(file_path)
        
        return {'valid': valid, 'invalid': invalid}
