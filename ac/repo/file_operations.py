import os


class FileOperationsMixin:
    """Mixin for file-related operations."""
    
    def get_file_content(self, file_path, version='working'):
        """
        Get file content from the repository.
        
        Args:
            file_path: Path to file relative to repo root
            version: 'working' for working directory, 'HEAD' for last commit,
                    or a commit hash for specific commit
        
        Returns:
            File content as string, or error dict on failure
        """
        try:
            if version == 'working':
                full_path = os.path.join(self.get_repo_root(), file_path)
                if not os.path.exists(full_path):
                    return self._create_error_response(f"File not found: {file_path}")
                with open(full_path, 'r', encoding='utf-8') as f:
                    return f.read()
            elif version == 'HEAD':
                blob = self._repo.head.commit.tree[file_path]
                return blob.data_stream.read().decode('utf-8')
            else:
                # Specific commit hash
                commit = self._repo.commit(version)
                blob = commit.tree[file_path]
                return blob.data_stream.read().decode('utf-8')
        except KeyError:
            return self._create_error_response(f"File not found in {version}: {file_path}")
        except Exception as e:
            return self._create_error_response(str(e))
    
    def file_exists(self, file_path, version='working'):
        """Check if a file exists in the repository."""
        try:
            if version == 'working':
                full_path = os.path.join(self.get_repo_root(), file_path)
                return os.path.exists(full_path)
            elif version == 'HEAD':
                try:
                    self._repo.head.commit.tree[file_path]
                    return True
                except KeyError:
                    return False
            else:
                try:
                    commit = self._repo.commit(version)
                    commit.tree[file_path]
                    return True
                except KeyError:
                    return False
        except Exception:
            return False
    
    def is_binary_file(self, file_path):
        """Check if a file is binary."""
        try:
            full_path = os.path.join(self.get_repo_root(), file_path)
            with open(full_path, 'rb') as f:
                chunk = f.read(8192)
                return b'\x00' in chunk
        except Exception:
            return False
