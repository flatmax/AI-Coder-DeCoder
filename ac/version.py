"""Git version detection utilities."""

import os
import sys
import subprocess
from pathlib import Path


def _get_package_dir() -> Path:
    """Get the directory containing this package."""
    return Path(__file__).parent


def _read_baked_version() -> str | None:
    """Read version from baked VERSION file (used in bundled releases)."""
    # Check multiple locations for VERSION file
    locations = [
        _get_package_dir() / 'VERSION',           # ac/VERSION (installed/bundled)
        _get_package_dir().parent / 'VERSION',    # repo root VERSION
    ]
    
    # PyInstaller sets this attribute
    if getattr(sys, 'frozen', False):
        # Running as bundled executable
        bundle_dir = Path(sys._MEIPASS) if hasattr(sys, '_MEIPASS') else Path(sys.executable).parent
        locations.insert(0, bundle_dir / 'VERSION')
    
    for version_file in locations:
        try:
            if version_file.exists():
                return version_file.read_text().strip()
        except (OSError, IOError):
            pass
    
    return None


def get_git_sha(short: bool = True) -> str | None:
    # First try baked version (for bundled releases)
    baked = _read_baked_version()
    if baked:
        return baked[:8] if short else baked

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
