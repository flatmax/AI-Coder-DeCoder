import os
from git import Repo as GitRepo
from git.exc import InvalidGitRepositoryError

from .file_operations import FileOperationsMixin
from .tree_operations import TreeOperationsMixin
from .commit_operations import CommitOperationsMixin
from .search_operations import SearchOperationsMixin


class Repo(FileOperationsMixin, TreeOperationsMixin, CommitOperationsMixin, SearchOperationsMixin):
    """Git repository wrapper for file access and repository information."""
    
    def __init__(self, path=None):
        """Initialize the Repo with a path. If None, uses current directory."""
        self.path = path or os.getcwd()
        self._repo = None
        self._init_repo()
    
    def _init_repo(self):
        """Initialize the GitPython Repo object."""
        try:
            self._repo = GitRepo(self.path, search_parent_directories=True)
        except InvalidGitRepositoryError:
            raise ValueError(f"Not a valid git repository: {self.path}")
    
    def get_repo_name(self):
        """Returns the repository directory name."""
        return os.path.basename(self.get_repo_root())
    
    def get_repo_root(self):
        """Returns absolute path to repo root."""
        return self._repo.working_tree_dir
    
    def get_status(self):
        """Returns dict with branch name, dirty state, untracked/modified/staged files."""
        try:
            return {
                'branch': self._repo.active_branch.name,
                'is_dirty': self._repo.is_dirty(),
                'untracked_files': self._repo.untracked_files,
                'modified_files': [item.a_path for item in self._repo.index.diff(None)],
                'staged_files': [item.a_path for item in self._repo.index.diff('HEAD')]
            }
        except Exception as e:
            return self._create_error_response(str(e))
    
    def _create_error_response(self, message):
        """Create a standardized error response."""
        return {'error': message}
