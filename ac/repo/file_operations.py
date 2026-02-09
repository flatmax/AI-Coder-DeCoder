import os


class FileOperationsMixin:
    """Mixin for file-related operations."""
    
    def unstage_files(self, file_paths):
        """
        Unstage files from the index.
        
        Args:
            file_paths: List of file paths to unstage
            
        Returns:
            Dict with success status or error
        """
        try:
            if isinstance(file_paths, str):
                file_paths = [file_paths]
            self._repo.index.reset(paths=file_paths)
            return {"success": True, "unstaged": file_paths}
        except Exception as e:
            return self._create_error_response(str(e))
    
    def discard_changes(self, file_paths):
        """
        Discard working directory changes for files (revert to HEAD).
        
        Args:
            file_paths: List of file paths to discard changes for
            
        Returns:
            Dict with success status or error
        """
        try:
            if isinstance(file_paths, str):
                file_paths = [file_paths]
            
            for file_path in file_paths:
                # Check if file exists in HEAD
                try:
                    blob = self._repo.head.commit.tree[file_path]
                    full_path = os.path.join(self.get_repo_root(), file_path)
                    with open(full_path, 'wb') as f:
                        f.write(blob.data_stream.read())
                except KeyError:
                    # File doesn't exist in HEAD - it's untracked, delete it
                    full_path = os.path.join(self.get_repo_root(), file_path)
                    if os.path.exists(full_path):
                        os.remove(full_path)
            
            return {"success": True, "discarded": file_paths}
        except Exception as e:
            return self._create_error_response(str(e))
    
    def delete_file(self, file_path):
        """
        Delete a file from the working directory.
        
        Args:
            file_path: Path to file relative to repo root
            
        Returns:
            Dict with success status or error
        """
        try:
            full_path = os.path.join(self.get_repo_root(), file_path)
            if not os.path.exists(full_path):
                return self._create_error_response(f"File not found: {file_path}")
            os.remove(full_path)
            return {"success": True, "deleted": file_path}
        except Exception as e:
            return self._create_error_response(str(e))
    
    def create_file(self, file_path, content=''):
        """
        Create a new file in the repository.
        
        Args:
            file_path: Path to file relative to repo root
            content: Initial file content (default empty)
            
        Returns:
            Dict with success status or error
        """
        try:
            full_path = os.path.join(self.get_repo_root(), file_path)
            if os.path.exists(full_path):
                return self._create_error_response(f"File already exists: {file_path}")
            
            # Create parent directories if needed
            parent_dir = os.path.dirname(full_path)
            if parent_dir and not os.path.exists(parent_dir):
                os.makedirs(parent_dir)
            
            with open(full_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return {"success": True, "created": file_path}
        except Exception as e:
            return self._create_error_response(str(e))
    
    def create_directory(self, dir_path):
        """
        Create a new directory in the repository.
        
        Args:
            dir_path: Path to directory relative to repo root
            
        Returns:
            Dict with success status or error
        """
        try:
            full_path = os.path.join(self.get_repo_root(), dir_path)
            if os.path.exists(full_path):
                return self._create_error_response(f"Directory already exists: {dir_path}")
            os.makedirs(full_path)
            return {"success": True, "created": dir_path}
        except Exception as e:
            return self._create_error_response(str(e))
    
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
                if self.is_binary_file(file_path):
                    return self._create_error_response(f"Cannot read binary file: {file_path}")
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
    
    def write_file(self, file_path, content):
        """
        Write content to a file in the repository.
        
        Args:
            file_path: Path to file relative to repo root
            content: File content to write
            
        Returns:
            Dict with success status or error
        """
        try:
            full_path = os.path.join(self.get_repo_root(), file_path)
            
            # Create parent directories if needed
            parent_dir = os.path.dirname(full_path)
            if parent_dir and not os.path.exists(parent_dir):
                os.makedirs(parent_dir)
            
            with open(full_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return {"success": True, "path": file_path}
        except Exception as e:
            return self._create_error_response(str(e))

    def rename_file(self, old_path, new_path):
        """Rename or move a file, using git mv if tracked.

        Args:
            old_path: Current relative path of the file
            new_path: Desired relative path of the file

        Returns:
            dict with success/error status
        """
        try:
            repo_root = self.get_repo_root()
            abs_old = os.path.join(repo_root, old_path)
            abs_new = os.path.join(repo_root, new_path)

            if not os.path.exists(abs_old):
                return self._create_error_response(f"File not found: {old_path}")

            if os.path.exists(abs_new):
                return self._create_error_response(f"Destination already exists: {new_path}")

            # Ensure destination directory exists
            dest_dir = os.path.dirname(abs_new)
            if dest_dir:
                os.makedirs(dest_dir, exist_ok=True)

            # Check if file is tracked by git
            try:
                self._repo.git.ls_files('--error-unmatch', old_path)
                # File is tracked — use git mv
                self._repo.git.mv(old_path, new_path)
            except Exception:
                # File is untracked — plain filesystem rename
                os.rename(abs_old, abs_new)

            return {"success": True, "old_path": old_path, "new_path": new_path}
        except Exception as e:
            return self._create_error_response(str(e))

    def rename_directory(self, old_path, new_path):
        """Rename or move a directory, using git mv for tracked files.

        Args:
            old_path: Current relative directory path
            new_path: Desired relative directory path

        Returns:
            dict with success/error status
        """
        try:
            repo_root = self.get_repo_root()
            abs_old = os.path.join(repo_root, old_path)
            abs_new = os.path.join(repo_root, new_path)

            if not os.path.isdir(abs_old):
                return self._create_error_response(f"Directory not found: {old_path}")

            if os.path.exists(abs_new):
                return self._create_error_response(f"Destination already exists: {new_path}")

            # Use git mv which handles the entire directory
            try:
                self._repo.git.mv(old_path, new_path)
            except Exception:
                # Fallback: plain filesystem rename (e.g. untracked directory)
                dest_parent = os.path.dirname(abs_new)
                if dest_parent:
                    os.makedirs(dest_parent, exist_ok=True)
                os.rename(abs_old, abs_new)

            return {"success": True, "old_path": old_path, "new_path": new_path}
        except Exception as e:
            return self._create_error_response(str(e))
