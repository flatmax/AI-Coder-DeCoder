"""Git version detection utilities."""

import os
import subprocess
from pathlib import Path


def get_git_sha(short: bool = True) -> str | None:
    """Get current git commit SHA.
    
    Args:
        short: If True, return 8-char short SHA. Otherwise full SHA.
    
    Returns:
        Git SHA string, or None if not in a git repo or git not available.
    """
    # Try git command first (most reliable, handles all edge cases)
    try:
        cmd = ['git', 'rev-parse', 'HEAD']
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=Path(__file__).parent,
            timeout=5
        )
        if result.returncode == 0:
            full_sha = result.stdout.strip()
            return full_sha[:8] if short else full_sha
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass
    
    # Fallback: read .git/HEAD directly
    try:
        git_dir = _find_git_dir()
        if git_dir:
            head_file = git_dir / 'HEAD'
            if head_file.exists():
                content = head_file.read_text().strip()
                
                # HEAD could be a direct SHA (detached) or a ref
                if content.startswith('ref: '):
                    # It's a reference, resolve it
                    ref_path = content[5:]  # Remove 'ref: ' prefix
                    ref_file = git_dir / ref_path
                    if ref_file.exists():
                        full_sha = ref_file.read_text().strip()
                        return full_sha[:8] if short else full_sha
                else:
                    # Direct SHA (detached HEAD)
                    return content[:8] if short else content
    except (OSError, IOError):
        pass
    
    return None


def _find_git_dir() -> Path | None:
    """Find .git directory by walking up from this file's location."""
    current = Path(__file__).parent.resolve()
    
    while current != current.parent:
        git_dir = current / '.git'
        if git_dir.is_dir():
            return git_dir
        current = current.parent
    
    return None


def get_webapp_base_url() -> str:
    """Get the base URL for GitHub Pages webapp."""
    # Could be made configurable via environment variable
    return os.environ.get(
        'AC_WEBAPP_BASE_URL',
        'https://flatmax.github.io/AI-Coder-DeCoder'
    )
