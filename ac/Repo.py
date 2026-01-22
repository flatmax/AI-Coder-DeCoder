import os
from git import Repo as GitRepo
from git.exc import InvalidGitRepositoryError, GitCommandError


class Repo:
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
                'staged': status.get('staged_files', [])
            }
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
    
    def search_files(self, query, word=False, regex=False, ignore_case=True):
        """
        Search for text in repository files.
        
        Args:
            query: Search string
            word: Match whole words only
            regex: Treat query as regex
            ignore_case: Case insensitive search
        
        Returns:
            List of dicts with file paths and matching lines
        """
        try:
            args = ['grep', '-n']
            if ignore_case:
                args.append('-i')
            if word:
                args.append('-w')
            if regex:
                args.append('-E')
            args.append(query)
            
            result = self._repo.git.execute(args)
            matches = []
            current_file = None
            current_matches = []
            
            for line in result.split('\n'):
                if not line:
                    continue
                parts = line.split(':', 2)
                if len(parts) >= 3:
                    file_path, line_num, content = parts[0], parts[1], parts[2]
                    if current_file != file_path:
                        if current_file:
                            matches.append({'file': current_file, 'matches': current_matches})
                        current_file = file_path
                        current_matches = []
                    current_matches.append({'line_num': int(line_num), 'line': content})
            
            if current_file:
                matches.append({'file': current_file, 'matches': current_matches})
            
            return matches
        except GitCommandError:
            return []  # No matches found
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
    
    def _create_error_response(self, message):
        """Create a standardized error response."""
        return {'error': message}
