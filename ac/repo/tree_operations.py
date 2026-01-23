import os


class TreeOperationsMixin:
    """Mixin for file tree operations."""
    
    def _count_file_lines(self, file_path):
        """Count lines in a file. Returns 0 for binary files."""
        full_path = os.path.join(self.get_repo_root(), file_path)
        try:
            # Check if binary
            with open(full_path, 'rb') as f:
                chunk = f.read(8192)
                if b'\x00' in chunk:
                    return 0
            # Count lines
            with open(full_path, 'r', encoding='utf-8') as f:
                return sum(1 for _ in f)
        except (OSError, UnicodeDecodeError):
            return 0
    
    def get_file_tree(self):
        """
        Get the repository file structure as a tree.
        
        Returns:
            Dict with 'tree' (nested structure) and 'status' (modified/staged sets)
        """
        try:
            tracked = [f for f in self._repo.git.ls_files().split('\n') if f]
            status = self.get_status()
            
            root = {'name': self.get_repo_name(), 'children': []}
            
            for file_path in sorted(tracked):
                parts = file_path.split('/')
                current = root
                
                for part in parts[:-1]:
                    existing = next((c for c in current['children'] if c.get('children') is not None and c['name'] == part), None)
                    if existing:
                        current = existing
                    else:
                        new_dir = {'name': part, 'children': []}
                        current['children'].append(new_dir)
                        current = new_dir
                
                lines = self._count_file_lines(file_path)
                current['children'].append({'name': parts[-1], 'path': file_path, 'lines': lines})
            
            return {
                'tree': root,
                'modified': status.get('modified_files', []),
                'staged': status.get('staged_files', []),
                'untracked': status.get('untracked_files', [])
            }
        except Exception as e:
            return self._create_error_response(str(e))
