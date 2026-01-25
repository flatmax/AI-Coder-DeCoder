"""LSP helper functions for position-based operations."""

from typing import List, Dict, Optional, Any
from ac.symbol_index.models import Symbol


def find_symbol_at_position(symbols: List[Symbol], line: int, col: int) -> Optional[Symbol]:
    """
    Find the symbol at a given position.
    
    Args:
        symbols: List of symbols to search
        line: 1-based line number
        col: 1-based column number
        
    Returns:
        Symbol at position, or None
    """
    # First check children (more specific), then parent symbols
    for symbol in symbols:
        # Check children first (methods inside classes, etc.)
        if symbol.children:
            child_match = find_symbol_at_position(symbol.children, line, col)
            if child_match:
                return child_match
        
        # Check if position is within symbol's selection range (the name)
        sr = symbol.selection_range
        if sr.start_line <= line <= sr.end_line:
            if line == sr.start_line and line == sr.end_line:
                # Single line - check column
                if sr.start_col <= col <= sr.end_col:
                    return symbol
            elif line == sr.start_line:
                if col >= sr.start_col:
                    return symbol
            elif line == sr.end_line:
                if col <= sr.end_col:
                    return symbol
            else:
                # Line is between start and end
                return symbol
    
    return None


def find_identifier_at_position(file_path: str, line: int, col: int, repo) -> Optional[str]:
    """
    Find the identifier at a given position in a file.
    
    Args:
        file_path: Path to the file
        line: 1-based line number
        col: 1-based column number
        repo: Repo instance for file access
        
    Returns:
        Identifier string at position, or None
    """
    import os
    
    if not repo:
        return None
    
    try:
        # Try to read file content - handle both relative and absolute paths
        content_result = repo.get_file_content(file_path)
        if 'error' in content_result:
            # Try as absolute path by joining with repo root
            repo_root = repo.get_repo_root()
            if repo_root and not os.path.isabs(file_path):
                abs_path = os.path.join(repo_root, file_path)
                content_result = repo.get_file_content(abs_path)
                if 'error' in content_result:
                    # Try reading directly from filesystem
                    if os.path.exists(abs_path):
                        with open(abs_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                    else:
                        return None
                else:
                    content = content_result.get('content', '')
            else:
                return None
        else:
            content = content_result.get('content', '')
        if not content:
            return None
            
        lines = content.split('\n')
        
        if line < 1 or line > len(lines):
            return None
        
        line_text = lines[line - 1]  # Convert to 0-based
        
        if col < 1:
            return None
        
        # Convert to 0-based column index
        col_idx = col - 1
        
        # If col is past end of line, try the character just before
        if col_idx >= len(line_text):
            col_idx = len(line_text) - 1
            if col_idx < 0:
                return None
        
        # Check if cursor is on an identifier character
        # If not, try one position back (cursor might be just after the word)
        if not _is_identifier_char(line_text[col_idx]):
            if col_idx > 0 and _is_identifier_char(line_text[col_idx - 1]):
                col_idx -= 1
            else:
                return None
        
        # Find start of identifier
        start = col_idx
        while start > 0 and _is_identifier_char(line_text[start - 1]):
            start -= 1
        
        # Find end of identifier
        end = col_idx
        while end < len(line_text) - 1 and _is_identifier_char(line_text[end + 1]):
            end += 1
        
        identifier = line_text[start:end + 1]
        return identifier if identifier else None
    except Exception:
        return None


def _is_identifier_char(char: str) -> bool:
    """Check if character is valid in an identifier."""
    return char.isalnum() or char == '_'


def find_symbol_definition(
    identifier: str, 
    symbols_by_file: Dict[str, List[Symbol]],
    exclude_file: str = None
) -> Optional[Symbol]:
    """
    Find the definition of a symbol by name.
    
    Args:
        identifier: Name to search for
        symbols_by_file: Dict mapping file paths to their symbols
        exclude_file: Optional file to exclude from search (e.g., current file for imports)
        
    Returns:
        Symbol definition, or None
    """
    import os
    
    # Normalize exclude_file for comparison
    exclude_basename = os.path.basename(exclude_file) if exclude_file else None
    
    # Search all files for a matching symbol definition
    for file_path, symbols in symbols_by_file.items():
        # Compare by basename to handle path variations
        if exclude_file:
            if file_path == exclude_file or os.path.basename(file_path) == exclude_basename:
                continue
        
        match = _find_symbol_by_name(identifier, symbols)
        if match:
            return match
    
    return None


def _find_symbol_by_name(name: str, symbols: List[Symbol]) -> Optional[Symbol]:
    """Recursively search for a symbol by name."""
    for symbol in symbols:
        if symbol.name == name and symbol.kind != 'import':
            return symbol
        if symbol.children:
            child_match = _find_symbol_by_name(name, symbol.children)
            if child_match:
                return child_match
    return None


def get_hover_info(symbol: Symbol) -> Dict[str, Any]:
    """
    Get hover information for a symbol.
    
    Args:
        symbol: The symbol to get hover info for
        
    Returns:
        Dict with 'contents' for Monaco hover
    """
    parts = []
    
    # Build signature based on symbol kind
    if symbol.kind == 'class':
        bases = f"({', '.join(symbol.bases)})" if symbol.bases else ""
        sig = f"class {symbol.name}{bases}"
    elif symbol.kind in ('function', 'method'):
        params = ', '.join(
            p.name + (f': {p.type_annotation}' if p.type_annotation else '')
            for p in symbol.parameters
        )
        ret = f' -> {symbol.return_type}' if symbol.return_type else ''
        prefix = 'def ' if symbol.kind == 'function' else ''
        sig = f"{prefix}{symbol.name}({params}){ret}"
    elif symbol.kind == 'variable':
        sig = f"{symbol.name}"
    elif symbol.kind == 'property':
        sig = f"@property {symbol.name}"
    else:
        sig = symbol.name
    
    # Determine language for syntax highlighting
    lang = 'python'  # Default, could be detected from file extension
    parts.append(f"```{lang}\n{sig}\n```")
    
    if symbol.docstring:
        parts.append(symbol.docstring)
    
    # Add location info
    parts.append(f"*Defined in {symbol.file_path}:{symbol.range.start_line}*")
    
    return {
        'contents': '\n\n'.join(parts)
    }


def get_completions(
    prefix: str, 
    symbols_by_file: Dict[str, List[Symbol]], 
    current_file: str
) -> List[Dict[str, Any]]:
    """
    Get completion suggestions matching a prefix.
    
    Args:
        prefix: Text prefix to filter completions
        symbols_by_file: Dict mapping file paths to their symbols
        current_file: Current file being edited (prioritize its symbols)
        
    Returns:
        List of completion items for Monaco
    """
    completions = []
    seen = set()
    prefix_lower = prefix.lower()
    
    # Helper to add completions from a symbol list
    def add_from_symbols(symbols: List[Symbol], priority: int):
        for symbol in symbols:
            if symbol.kind == 'import':
                continue
            
            name = symbol.name
            if name in seen:
                continue
            
            if prefix_lower and not name.lower().startswith(prefix_lower):
                continue
            
            seen.add(name)
            completions.append({
                'label': name,
                'kind': _symbol_kind_to_completion_kind(symbol.kind),
                'detail': _get_completion_detail(symbol),
                'documentation': symbol.docstring,
                'sortText': f"{priority:02d}{name}",
                'insertText': _get_insert_text(symbol)
            })
            
            # Also add children (methods of classes)
            if symbol.children:
                add_from_symbols(symbol.children, priority + 1)
    
    # Prioritize current file
    if current_file in symbols_by_file:
        add_from_symbols(symbols_by_file[current_file], 0)
    
    # Then other files
    for file_path, symbols in symbols_by_file.items():
        if file_path != current_file:
            add_from_symbols(symbols, 10)
    
    return completions[:100]  # Limit to 100 suggestions


def _symbol_kind_to_completion_kind(kind: str) -> int:
    """Convert symbol kind to Monaco CompletionItemKind."""
    # Monaco CompletionItemKind values
    kinds = {
        'class': 6,      # Class
        'method': 1,     # Method
        'function': 2,   # Function
        'variable': 5,   # Variable
        'property': 9,   # Property
    }
    return kinds.get(kind, 5)  # Default to Variable


def _get_completion_detail(symbol: Symbol) -> str:
    """Get detail string for completion item."""
    if symbol.kind == 'class':
        bases = f"({', '.join(symbol.bases)})" if symbol.bases else ""
        return f"class{bases}"
    elif symbol.kind in ('function', 'method'):
        params = ', '.join(p.name for p in symbol.parameters[:3])
        if len(symbol.parameters) > 3:
            params += ', ...'
        ret = f" -> {symbol.return_type}" if symbol.return_type else ""
        return f"({params}){ret}"
    return symbol.kind


def _get_insert_text(symbol: Symbol) -> str:
    """Get text to insert for completion."""
    if symbol.kind in ('function', 'method'):
        # Add parentheses for callables
        return f"{symbol.name}($0)"
    return symbol.name
