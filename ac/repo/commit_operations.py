class CommitOperationsMixin:
    """Mixin for commit-related operations."""
    
    def get_commit_history(self, max_count=50, branch=None, skip=0):
        """Get paginated commit history."""
        try:
            branch_ref = branch or self._repo.active_branch.name
            commits = []
            for commit in self._repo.iter_commits(branch_ref, max_count=max_count, skip=skip):
                commits.append({
                    'hash': commit.hexsha,
                    'short_hash': commit.hexsha[:7],
                    'message': commit.message.strip(),
                    'author': str(commit.author),
                    'date': commit.committed_datetime.isoformat()
                })
            return commits
        except Exception as e:
            return self._create_error_response(str(e))
    
    def get_branches(self):
        """List all branches with current branch flagged."""
        try:
            current = self._repo.active_branch.name
            branches = []
            for branch in self._repo.branches:
                branches.append({
                    'name': branch.name,
                    'is_current': branch.name == current
                })
            return branches
        except Exception as e:
            return self._create_error_response(str(e))
    
    def get_changed_files(self, from_commit, to_commit):
        """Get files changed between two commits."""
        try:
            commit_from = self._repo.commit(from_commit)
            commit_to = self._repo.commit(to_commit)
            diff = commit_from.diff(commit_to)
            return [item.a_path or item.b_path for item in diff]
        except Exception as e:
            return self._create_error_response(str(e))
    
    def get_staged_diff(self):
        """
        Get the diff of staged changes.
        
        Returns:
            String containing the diff, or error dict on failure
        """
        try:
            # Get diff between HEAD and staged (index)
            diff = self._repo.git.diff('--cached')
            return diff
        except Exception as e:
            return self._create_error_response(str(e))
    
    def get_unstaged_diff(self):
        """
        Get the diff of unstaged changes in working directory.
        
        Returns:
            String containing the diff, or error dict on failure
        """
        try:
            diff = self._repo.git.diff()
            return diff
        except Exception as e:
            return self._create_error_response(str(e))
    
    def stage_all(self):
        """
        Stage all changes (modified and untracked files).
        
        Returns:
            Dict with status or error
        """
        try:
            self._repo.git.add('-A')
            return {'status': 'success', 'message': 'All changes staged'}
        except Exception as e:
            return self._create_error_response(str(e))
    
    def stage_files(self, file_paths):
        """
        Stage specific files.
        
        Args:
            file_paths: List of file paths to stage
            
        Returns:
            Dict with status or error
        """
        try:
            for path in file_paths:
                self._repo.git.add(path)
            return {'status': 'success', 'message': f'Staged {len(file_paths)} file(s)'}
        except Exception as e:
            return self._create_error_response(str(e))
    
    def commit(self, message):
        """
        Create a commit with the given message.
        
        Args:
            message: The commit message
            
        Returns:
            Dict with commit hash and status, or error
        """
        try:
            # Check if there are staged changes
            if not self._repo.index.diff('HEAD') and not self._repo.untracked_files:
                # Check for staged files
                staged = list(self._repo.index.diff('HEAD'))
                if not staged:
                    return self._create_error_response('No staged changes to commit')
            
            commit = self._repo.index.commit(message)
            return {
                'status': 'success',
                'hash': commit.hexsha,
                'short_hash': commit.hexsha[:7],
                'message': message
            }
        except Exception as e:
            return self._create_error_response(str(e))
