class TreeOperationsMixin:
    """Mixin for file tree operations."""
    
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
                
                current['children'].append({'name': parts[-1], 'path': file_path})
            
            return {
                'tree': root,
                'modified': status.get('modified_files', []),
                'staged': status.get('staged_files', []),
                'untracked': status.get('untracked_files', [])
            }
        except Exception as e:
            return self._create_error_response(str(e))
