"""GitHub repository and file handling."""

import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional, List
from datetime import datetime

from .models import URLContent, URLType, GitHubInfo


class GitHubHandler:
    """Handle GitHub URLs - clone repos, fetch files, extract content."""
    
    # README variants in priority order
    README_VARIANTS = [
        'README.md',
        'README.rst',
        'README.txt',
        'README',
        'readme.md',
        'readme.rst',
        'readme.txt',
        'readme',
        'Readme.md',
    ]
    
    def __init__(self, cache_path: Optional[Path] = None):
        """
        Initialize GitHub handler.
        
        Args:
            cache_path: Optional path for caching cloned repos.
                       If None, uses temp directory.
        """
        self.cache_path = cache_path
    
    def fetch_repo(
        self,
        github_info: GitHubInfo,
        include_symbol_map: bool = True,
        include_readme: bool = True,
    ) -> URLContent:
        """
        Fetch a GitHub repository via shallow clone.
        
        Args:
            github_info: Parsed GitHub URL info
            include_symbol_map: Whether to generate symbol map
            include_readme: Whether to extract README
            
        Returns:
            URLContent with repo data
        """
        clone_dir = None
        try:
            # Create temp directory for clone
            clone_dir = tempfile.mkdtemp(prefix='ac_github_')
            
            # Shallow clone
            clone_url = github_info.clone_url
            success = self._shallow_clone(clone_url, clone_dir)
            
            if not success:
                return URLContent(
                    url=github_info.repo_url,
                    url_type=URLType.GITHUB_REPO,
                    github_info=github_info,
                    fetched_at=datetime.now(),
                    error="Failed to clone repository",
                )
            
            # Extract README
            readme = None
            if include_readme:
                readme = self._find_readme(clone_dir)
            
            # Generate symbol map
            symbol_map = None
            if include_symbol_map:
                symbol_map = self._generate_symbol_map(clone_dir)
            
            return URLContent(
                url=github_info.repo_url,
                url_type=URLType.GITHUB_REPO,
                github_info=github_info,
                readme=readme,
                symbol_map=symbol_map,
                fetched_at=datetime.now(),
            )
            
        except Exception as e:
            return URLContent(
                url=github_info.repo_url,
                url_type=URLType.GITHUB_REPO,
                github_info=github_info,
                fetched_at=datetime.now(),
                error=str(e),
            )
        finally:
            # Cleanup temp directory
            if clone_dir and os.path.exists(clone_dir):
                shutil.rmtree(clone_dir, ignore_errors=True)
    
    def fetch_file(self, github_info: GitHubInfo) -> URLContent:
        """
        Fetch a single file from GitHub via raw URL.
        
        Args:
            github_info: Parsed GitHub URL info with path
            
        Returns:
            URLContent with file content
        """
        import urllib.request
        import urllib.error
        
        if not github_info.path:
            return URLContent(
                url=github_info.repo_url,
                url_type=URLType.GITHUB_FILE,
                github_info=github_info,
                fetched_at=datetime.now(),
                error="No file path specified",
            )
        
        # Build raw URL
        branch = github_info.branch or 'main'
        raw_url = (
            f"https://raw.githubusercontent.com/"
            f"{github_info.owner}/{github_info.repo}/{branch}/{github_info.path}"
        )
        
        try:
            with urllib.request.urlopen(raw_url, timeout=30) as response:
                content = response.read().decode('utf-8')
            
            # Use filename as title
            title = Path(github_info.path).name
            
            return URLContent(
                url=raw_url,
                url_type=URLType.GITHUB_FILE,
                title=title,
                content=content,
                github_info=github_info,
                fetched_at=datetime.now(),
            )
            
        except urllib.error.HTTPError as e:
            # Try 'master' branch if 'main' failed
            if branch == 'main' and e.code == 404:
                github_info_master = GitHubInfo(
                    owner=github_info.owner,
                    repo=github_info.repo,
                    branch='master',
                    path=github_info.path,
                )
                return self._fetch_file_with_branch(github_info_master, 'master')
            
            return URLContent(
                url=raw_url,
                url_type=URLType.GITHUB_FILE,
                github_info=github_info,
                fetched_at=datetime.now(),
                error=f"HTTP {e.code}: {e.reason}",
            )
        except Exception as e:
            return URLContent(
                url=raw_url,
                url_type=URLType.GITHUB_FILE,
                github_info=github_info,
                fetched_at=datetime.now(),
                error=str(e),
            )
    
    def _fetch_file_with_branch(self, github_info: GitHubInfo, branch: str) -> URLContent:
        """Fetch file with explicit branch (no fallback)."""
        import urllib.request
        import urllib.error
        
        raw_url = (
            f"https://raw.githubusercontent.com/"
            f"{github_info.owner}/{github_info.repo}/{branch}/{github_info.path}"
        )
        
        try:
            with urllib.request.urlopen(raw_url, timeout=30) as response:
                content = response.read().decode('utf-8')
            
            title = Path(github_info.path).name
            
            return URLContent(
                url=raw_url,
                url_type=URLType.GITHUB_FILE,
                title=title,
                content=content,
                github_info=github_info,
                fetched_at=datetime.now(),
            )
        except Exception as e:
            return URLContent(
                url=raw_url,
                url_type=URLType.GITHUB_FILE,
                github_info=github_info,
                fetched_at=datetime.now(),
                error=str(e),
            )
    
    def _shallow_clone(self, clone_url: str, dest_dir: str) -> bool:
        """
        Perform shallow clone of repository.
        
        Args:
            clone_url: Git clone URL
            dest_dir: Destination directory
            
        Returns:
            True if successful
        """
        import subprocess
        
        try:
            result = subprocess.run(
                ['git', 'clone', '--depth', '1', clone_url, dest_dir],
                capture_output=True,
                text=True,
                timeout=120,  # 2 minute timeout
            )
            return result.returncode == 0
        except subprocess.TimeoutExpired:
            return False
        except Exception:
            return False
    
    def _find_readme(self, repo_dir: str) -> Optional[str]:
        """
        Find and read README file.
        
        Args:
            repo_dir: Path to cloned repository
            
        Returns:
            README content or None
        """
        for variant in self.README_VARIANTS:
            readme_path = os.path.join(repo_dir, variant)
            if os.path.isfile(readme_path):
                try:
                    with open(readme_path, 'r', encoding='utf-8') as f:
                        return f.read()
                except Exception:
                    continue
        return None
    
    def _generate_symbol_map(self, repo_dir: str) -> Optional[str]:
        """
        Generate symbol map for repository.
        
        Args:
            repo_dir: Path to cloned repository
            
        Returns:
            Symbol map string or None
        """
        try:
            from ..symbol_index import SymbolIndex
            
            # Find all supported files
            file_paths = self._find_supported_files(repo_dir)
            
            if not file_paths:
                return None
            
            # Create symbol index and generate map
            symbol_index = SymbolIndex(repo_dir)
            symbol_index.index_files(file_paths)
            
            return symbol_index.to_compact(
                file_paths=file_paths,
                include_references=True,
            )
        except Exception as e:
            # Log but don't fail - symbol map is optional
            print(f"Warning: Failed to generate symbol map: {e}")
            return None
    
    def _find_supported_files(self, repo_dir: str) -> List[str]:
        """
        Find all files with supported extensions.
        
        Args:
            repo_dir: Path to repository
            
        Returns:
            List of relative file paths
        """
        from ..symbol_index import SUPPORTED_EXTENSIONS
        
        files = []
        repo_path = Path(repo_dir)
        
        for ext in SUPPORTED_EXTENSIONS:
            for file_path in repo_path.rglob(f'*{ext}'):
                # Skip hidden directories and node_modules
                parts = file_path.relative_to(repo_path).parts
                if any(p.startswith('.') or p == 'node_modules' for p in parts):
                    continue
                
                # Use relative path
                rel_path = str(file_path.relative_to(repo_path))
                files.append(rel_path)
        
        return sorted(files)
