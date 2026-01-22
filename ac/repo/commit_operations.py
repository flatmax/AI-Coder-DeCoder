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
