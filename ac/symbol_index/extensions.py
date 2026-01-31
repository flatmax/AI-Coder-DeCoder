"""
Shared file extension configuration for symbol indexing.

Single source of truth for which file extensions are supported
across the codebase.
"""

# Extensions supported for symbol extraction (tree-sitter parsing)
SUPPORTED_EXTENSIONS = frozenset({
    # Python
    '.py',
    # JavaScript/TypeScript
    '.js', '.mjs', '.jsx', '.ts', '.tsx',
    # C/C++
    '.cpp', '.cc', '.cxx', '.c++', '.C',
    '.hpp', '.hh', '.hxx', '.h++', '.H', '.h',
})

# Extension to language name mapping (for tree-sitter)
EXTENSION_TO_LANGUAGE = {
    '.py': 'python',
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.c++': 'cpp',
    '.C': 'cpp',
    '.hpp': 'cpp',
    '.hh': 'cpp',
    '.hxx': 'cpp',
    '.h++': 'cpp',
    '.H': 'cpp',
    '.h': 'cpp',
}


def is_supported_file(filepath: str) -> bool:
    """Check if a file has a supported extension.
    
    Args:
        filepath: Path to check (can be relative or absolute)
        
    Returns:
        True if file extension is supported for symbol extraction
    """
    from pathlib import Path
    ext = Path(filepath).suffix.lower()
    # Special case: .C is uppercase-sensitive for C++
    if filepath.endswith('.C'):
        return True
    return ext in SUPPORTED_EXTENSIONS


def get_language_for_extension(ext: str) -> str | None:
    """Get the language name for a file extension.
    
    Args:
        ext: File extension including dot (e.g., '.py')
        
    Returns:
        Language name or None if not supported
    """
    return EXTENSION_TO_LANGUAGE.get(ext.lower() if ext != '.C' else ext)


def filter_supported_files(file_paths: list[str]) -> list[str]:
    """Filter a list of file paths to only supported extensions.
    
    Args:
        file_paths: List of file paths
        
    Returns:
        Filtered list containing only supported files
    """
    return [f for f in file_paths if is_supported_file(f)]
