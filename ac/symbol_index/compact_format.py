"""Compact format for LLM context."""

from typing import List, Dict, Optional, Set
from .models import Symbol


# Single-letter kind prefixes
KIND_PREFIX = {
    'class': 'c',
    'method': 'm',
    'function': 'f',
    'variable': 'v',
    'import': 'i',
    'property': 'p',
}


def to_compact(
    symbols_by_file: Dict[str, List[Symbol]],
    references: Optional[Dict[str, Dict[str, List]]] = None,
    file_refs: Optional[Dict[str, Set[str]]] = None,
    include_instance_vars: bool = True,
    include_calls: bool = False,
) -> str:
    """Generate compact format suitable for LLM context.
    
    Basic format:
    ```
    file.py:
    │c ClassName(Base1,Base2):10
    │  m method_name(arg1,arg2)->str:15
    │  p property_name:20
    │f function_name(x)->int:50
    │i module1,module2.thing
    ```
    
    With references (hybrid format):
    ```
    file.py:
    │c ClassName(Base1,Base2):10
    │  m method_name(arg1,arg2)->str:15 ←other.py:45
    │f function_name(x)->int:50 ←test.py:20,main.py:12
    │i module1,module2
    │←refs: other.py,test.py,main.py
    ```
    
    Args:
        symbols_by_file: Dict mapping file paths to their symbols
        references: Optional dict of file -> symbol -> [locations]
        file_refs: Optional dict of file -> set of files that reference it
        
    Returns:
        Compact string representation
    """
    lines = []
    
    for file_path in sorted(symbols_by_file.keys()):
        symbols = symbols_by_file[file_path]
        if not symbols:
            continue
        
        lines.append(f"{file_path}:")
        
        # Get references for this file if available
        file_references = references.get(file_path, {}) if references else {}
        
        # Group imports together
        imports = [s for s in symbols if s.kind == 'import']
        other_symbols = [s for s in symbols if s.kind != 'import']
        
        # Output imports on one line if any
        if imports:
            import_names = _extract_import_names(imports)
            if import_names:
                lines.append(f"│i {','.join(import_names)}")
        
        # Output other symbols
        for symbol in other_symbols:
            symbol_refs = file_references.get(symbol.name, [])
            lines.extend(_format_symbol(
                symbol, indent=0, refs=symbol_refs,
                include_instance_vars=include_instance_vars,
                include_calls=include_calls,
            ))
        
        # Add file-level reference summary if available
        if file_refs and file_path in file_refs:
            ref_files = sorted(file_refs[file_path])
            if ref_files:
                # Limit to first 5 files to keep it compact
                if len(ref_files) > 5:
                    ref_summary = ','.join(ref_files[:5]) + f",+{len(ref_files)-5}"
                else:
                    ref_summary = ','.join(ref_files)
                lines.append(f"│←refs: {ref_summary}")
        
        lines.append("")  # Blank line between files
    
    return '\n'.join(lines)


def _extract_import_names(import_symbols: List[Symbol]) -> List[str]:
    """Extract module names from import statements."""
    names = []
    for sym in import_symbols:
        # Parse import statement to get module name
        import_text = sym.name
        if import_text.startswith('import '):
            # import foo, bar
            parts = import_text[7:].split(',')
            for part in parts:
                name = part.strip().split(' as ')[0].split('.')[0]
                if name and name not in names:
                    names.append(name)
        elif import_text.startswith('from '):
            # from foo import bar
            parts = import_text[5:].split(' import ')
            if parts:
                name = parts[0].strip().split('.')[0]
                if name and name not in names:
                    names.append(name)
    return names


def _format_symbol(
    symbol: Symbol, 
    indent: int = 0, 
    refs: List = None,
    parent_refs: Dict = None,
    include_instance_vars: bool = True,
    include_calls: bool = False,
) -> List[str]:
    """Format a single symbol and its children.
    
    Args:
        symbol: The symbol to format
        indent: Current indentation level
        refs: List of locations referencing this symbol
        parent_refs: Dict of child_name -> [locations] for children
        include_instance_vars: Whether to include instance variables
        include_calls: Whether to include call information
    """
    lines = []
    prefix = KIND_PREFIX.get(symbol.kind, '?')
    indent_str = "│" + "  " * indent
    
    # Build the symbol line
    line_parts = [f"{indent_str}{prefix} {symbol.name}"]
    
    # Add bases for classes
    if symbol.bases:
        line_parts.append(f"({','.join(symbol.bases)})")
    
    # Add parameters for functions/methods
    elif symbol.parameters:
        param_names = []
        for p in symbol.parameters:
            if p.name not in ('self', 'cls'):
                param_names.append(p.name)
        if param_names:
            line_parts.append(f"({','.join(param_names)})")
        else:
            line_parts.append("()")
    
    # Add return type
    if symbol.return_type:
        ret = symbol.return_type
        # Abbreviate common types
        ret = ret.replace('Optional[', '?').replace(']', '')
        ret = ret.replace('List[', '[').replace(']', '')
        line_parts.append(f"->{ret}")
    
    # Add line number
    line_parts.append(f":{symbol.range.start_line}")
    
    # Add call annotations if enabled
    if include_calls and symbol.calls:
        call_str = ','.join(symbol.calls[:5])
        if len(symbol.calls) > 5:
            call_str += f",+{len(symbol.calls)-5}"
        line_parts.append(f" →{call_str}")
    
    # Add reference annotations if available
    if refs:
        ref_annotations = _format_refs(refs)
        if ref_annotations:
            line_parts.append(f" {ref_annotations}")
    
    lines.append(''.join(line_parts))
    
    # Add instance variables for classes
    if include_instance_vars and symbol.kind == 'class' and symbol.instance_vars:
        var_indent = "│" + "  " * (indent + 1)
        for var in symbol.instance_vars:
            lines.append(f"{var_indent}v {var}")
    
    # Format children (methods, nested classes)
    for child in symbol.children:
        # Get child refs if available
        child_refs = parent_refs.get(child.name, []) if parent_refs else []
        lines.extend(_format_symbol(
            child, indent + 1, refs=child_refs,
            include_instance_vars=include_instance_vars,
            include_calls=include_calls,
        ))
    
    return lines


def _format_refs(locations: List) -> str:
    """Format reference locations compactly.
    
    Args:
        locations: List of Location objects or dicts
        
    Returns:
        String like "←file.py:10,other.py:20" or empty string
    """
    if not locations:
        return ""
    
    # Group by file and take first line number per file
    by_file = {}
    for loc in locations:
        if hasattr(loc, 'file_path'):
            file_path = loc.file_path
            line = loc.line
        else:
            file_path = loc.get('file', loc.get('file_path', ''))
            line = loc.get('line', 0)
        
        if file_path not in by_file:
            by_file[file_path] = line
    
    # Format compactly
    if len(by_file) == 0:
        return ""
    
    # Sort by file name and limit to 3 references
    items = sorted(by_file.items())[:3]
    parts = [f"{f}:{l}" for f, l in items]
    
    result = "←" + ",".join(parts)
    if len(by_file) > 3:
        result += f",+{len(by_file)-3}"
    
    return result


def to_compact_for_files(symbol_index, file_paths: List[str]) -> str:
    """Generate compact format for specific files.
    
    Args:
        symbol_index: SymbolIndex instance
        file_paths: List of files to include
        
    Returns:
        Compact string representation
    """
    symbols_by_file = symbol_index.index_files(file_paths)
    return to_compact(symbols_by_file)
