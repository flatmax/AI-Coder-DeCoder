"""Compact format for LLM context."""

from typing import List, Dict, Optional, Set, Union
from .models import Symbol, CallSite


# Single-letter kind prefixes
KIND_PREFIX = {
    'class': 'c',
    'method': 'm',
    'function': 'f',
    'variable': 'v',
    'import': 'i',
    'property': 'p',
}

# Conditional marker
CONDITIONAL_MARKER = '?'


# Legend for compact format
LEGEND = "# c=class m=method f=function v=var p=property i=import i→=local\n# :N=line ->T=returns ?=optional ←=refs →=calls +N=more ″=ditto"


def _estimate_tokens(text: str) -> int:
    """Estimate token count using ~4 chars per token heuristic."""
    return len(text) // 4 + 1


def _format_file_block(
    file_path: str,
    symbols: List[Symbol],
    references: Optional[Dict[str, Dict[str, List]]],
    file_refs: Optional[Dict[str, Set[str]]],
    file_imports: Optional[Dict[str, Set[str]]],
    include_instance_vars: bool,
    include_calls: bool,
) -> List[str]:
    """Format a single file's symbols into lines.
    
    Args:
        file_path: Path to the file
        symbols: List of symbols in the file
        references: Optional dict of file -> symbol -> [locations]
        file_refs: Optional dict of file -> set of files that reference it
        file_imports: Optional dict of file -> set of in-repo files it imports
        include_instance_vars: Whether to include instance variables
        include_calls: Whether to include call information
        
    Returns:
        List of formatted lines for this file
    """
    if not symbols:
        return []
    
    lines = []
    lines.append(f"{file_path}:")
    
    # Get references for this file if available
    file_references = references.get(file_path, {}) if references else {}
    
    # Group imports together
    imports = [s for s in symbols if s.kind == 'import']
    other_symbols = [s for s in symbols if s.kind != 'import']
    
    # Group same-named variables together to avoid redundant reference output
    # e.g., 15 "result" vars with identical refs become one line with multiple line numbers
    var_groups = {}  # name -> list of symbols
    non_var_symbols = []
    for s in other_symbols:
        if s.kind == 'variable':
            if s.name not in var_groups:
                var_groups[s.name] = []
            var_groups[s.name].append(s)
        else:
            non_var_symbols.append(s)
    
    # Output imports on one line if any
    if imports:
        import_names = _extract_import_names(imports)
        if import_names:
            lines.append(f"│i {','.join(import_names)}")
    
    # Output in-repo file imports (outgoing dependencies)
    if file_imports and file_path in file_imports:
        in_repo_imports = sorted(file_imports[file_path])
        if in_repo_imports:
            lines.append(f"│i→ {','.join(in_repo_imports)}")
    
    # Output non-variable symbols
    for symbol in non_var_symbols:
        symbol_refs = file_references.get(symbol.name, [])
        lines.extend(_format_symbol(
            symbol, indent=0, refs=symbol_refs,
            include_instance_vars=include_instance_vars,
            include_calls=include_calls,
        ))
    
    # Output grouped variables (consolidate same-named vars onto one line)
    for var_name, var_symbols in sorted(var_groups.items(), key=lambda x: x[1][0].range.start_line):
        var_refs = file_references.get(var_name, [])
        if len(var_symbols) == 1:
            # Single variable, output normally
            lines.extend(_format_symbol(
                var_symbols[0], indent=0, refs=var_refs,
                include_instance_vars=include_instance_vars,
                include_calls=include_calls,
            ))
        else:
            # Multiple variables with same name - consolidate line numbers
            line_nums = [str(s.range.start_line) for s in var_symbols]
            line_str = ','.join(line_nums[:5])
            if len(line_nums) > 5:
                line_str += f",+{len(line_nums)-5}"
            
            line_parts = [f"│v {var_name}:{line_str}"]
            
            # Add refs for first occurrence, ditto for rest is implicit
            if var_refs:
                ref_annotations = _format_refs(var_refs)
                if ref_annotations:
                    line_parts.append(f" {ref_annotations}")
            
            lines.append(''.join(line_parts))
    
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
    
    return lines


def to_compact(
    symbols_by_file: Dict[str, List[Symbol]],
    references: Optional[Dict[str, Dict[str, List]]] = None,
    file_refs: Optional[Dict[str, Set[str]]] = None,
    file_imports: Optional[Dict[str, Set[str]]] = None,
    include_instance_vars: bool = True,
    include_calls: bool = False,
    include_legend: bool = True,
    file_order: Optional[List[str]] = None,
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
        file_imports: Optional dict of file -> set of in-repo files it imports
        include_legend: Whether to include the legend at the top
        file_order: Optional list specifying file output order (for prefix cache optimization).
                   If None, files are sorted alphabetically.
        
    Returns:
        Compact string representation
    """
    # Use _split_by_token_threshold with 0 to get single chunk
    # This avoids the num_chunks logic which would still create 1 chunk
    
    # Use provided order, or fall back to sorted for determinism
    if file_order:
        ordered_files = [f for f in file_order if f in symbols_by_file]
    else:
        ordered_files = sorted(symbols_by_file.keys())
    
    if not ordered_files:
        return ''
    
    lines = []
    
    if include_legend:
        lines.extend([LEGEND, ""])
    
    for file_path in ordered_files:
        symbols = symbols_by_file[file_path]
        file_lines = _format_file_block(
            file_path=file_path,
            symbols=symbols,
            references=references,
            file_refs=file_refs,
            file_imports=file_imports,
            include_instance_vars=include_instance_vars,
            include_calls=include_calls,
        )
        if file_lines:
            lines.extend(file_lines)
    
    return '\n'.join(lines)


def to_compact_chunked(
    symbols_by_file: Dict[str, List[Symbol]],
    references: Optional[Dict[str, Dict[str, List]]] = None,
    file_refs: Optional[Dict[str, Set[str]]] = None,
    file_imports: Optional[Dict[str, Set[str]]] = None,
    include_instance_vars: bool = True,
    include_calls: bool = False,
    include_legend: bool = True,
    file_order: Optional[List[str]] = None,
    min_chunk_tokens: int = 1024,
    num_chunks: int = None,
    return_metadata: bool = False,
) -> Union[List[str], List[dict]]:
    """Generate compact format as cacheable chunks.
    
    Files are processed in order and grouped into chunks. If num_chunks is
    specified, splits into exactly that many chunks (for Bedrock's 4-block
    cache limit). Otherwise uses min_chunk_tokens threshold.
    
    Args:
        symbols_by_file: Dict mapping file paths to their symbols
        references: Optional dict of file -> symbol -> [locations]
        file_refs: Optional dict of file -> set of files that reference it
        file_imports: Optional dict of file -> set of in-repo files it imports
        include_instance_vars: Whether to include instance variables
        include_calls: Whether to include call information
        include_legend: Whether to include the legend in the first chunk
        file_order: Optional list specifying file output order
        min_chunk_tokens: Minimum tokens per chunk (default 1024 for Anthropic cache)
        num_chunks: If specified, split into exactly this many chunks
        return_metadata: If True, return list of dicts with content, files, tokens, cached
        
    Returns:
        List of chunk strings (or dicts if return_metadata=True)
    """
    # Use provided order, or fall back to sorted for determinism
    if file_order:
        ordered_files = [f for f in file_order if f in symbols_by_file]
    else:
        ordered_files = sorted(symbols_by_file.keys())
    
    if not ordered_files:
        return []
    
    # First, format all files
    all_file_blocks = []
    for file_path in ordered_files:
        symbols = symbols_by_file[file_path]
        file_lines = _format_file_block(
            file_path=file_path,
            symbols=symbols,
            references=references,
            file_refs=file_refs,
            file_imports=file_imports,
            include_instance_vars=include_instance_vars,
            include_calls=include_calls,
        )
        if file_lines:
            all_file_blocks.append(file_lines)
    
    if not all_file_blocks:
        return []
    
    # If num_chunks specified, distribute files evenly across chunks
    if num_chunks and num_chunks > 0:
        if return_metadata:
            return _split_into_n_chunks_with_metadata(
                all_file_blocks, num_chunks, include_legend, ordered_files
            )
        return _split_into_n_chunks(all_file_blocks, num_chunks, include_legend)
    
    # Otherwise use token-based chunking
    return _split_by_token_threshold(all_file_blocks, min_chunk_tokens, include_legend)


def _split_into_n_chunks(
    file_blocks: List[List[str]],
    num_chunks: int,
    include_legend: bool,
    file_paths: List[str] = None,
) -> List[str]:
    """Split file blocks into exactly N chunks.
    
    Args:
        file_blocks: List of formatted line lists, one per file
        num_chunks: Target number of chunks
        include_legend: Whether to include legend in first chunk
        file_paths: Optional list of file paths (parallel to file_blocks) for metadata
        
    Returns:
        List of chunk strings
    """
    if num_chunks <= 0:
        num_chunks = 1
    
    # Calculate files per chunk (distribute evenly, extras go to later chunks)
    total_files = len(file_blocks)
    base_size = total_files // num_chunks
    extras = total_files % num_chunks
    
    chunks = []
    file_idx = 0
    
    for chunk_idx in range(num_chunks):
        # Earlier chunks get base_size, later chunks get base_size + 1 if there are extras
        # This puts newer/volatile files in later chunks (which won't be cached)
        chunk_size = base_size + (1 if chunk_idx >= (num_chunks - extras) else 0)
        
        if chunk_size == 0:
            continue
        
        chunk_lines = []
        
        # Add legend to first chunk
        if chunk_idx == 0 and include_legend:
            chunk_lines.extend([LEGEND, ""])
        
        # Add files for this chunk
        for _ in range(chunk_size):
            if file_idx < total_files:
                chunk_lines.extend(file_blocks[file_idx])
                file_idx += 1
        
        if chunk_lines:
            chunks.append('\n'.join(chunk_lines))
    
    return chunks


def _split_into_n_chunks_with_metadata(
    file_blocks: List[List[str]],
    num_chunks: int,
    include_legend: bool,
    file_paths: List[str],
) -> List[dict]:
    """Split file blocks into exactly N chunks with metadata.
    
    Args:
        file_blocks: List of formatted line lists, one per file
        num_chunks: Target number of chunks
        include_legend: Whether to include legend in first chunk
        file_paths: List of file paths (parallel to file_blocks)
        
    Returns:
        List of dicts with 'content', 'files', 'tokens', 'cached' keys
    """
    if num_chunks <= 0:
        num_chunks = 1
    
    total_files = len(file_blocks)
    base_size = total_files // num_chunks
    extras = total_files % num_chunks
    
    # Bedrock limit: 4 cache blocks total, 1 for system prompt = 3 for symbol map
    max_cached_chunks = 3
    
    chunks = []
    file_idx = 0
    
    for chunk_idx in range(num_chunks):
        chunk_size = base_size + (1 if chunk_idx >= (num_chunks - extras) else 0)
        
        if chunk_size == 0:
            continue
        
        chunk_lines = []
        chunk_files = []
        
        if chunk_idx == 0 and include_legend:
            chunk_lines.extend([LEGEND, ""])
        
        for _ in range(chunk_size):
            if file_idx < total_files:
                chunk_lines.extend(file_blocks[file_idx])
                chunk_files.append(file_paths[file_idx])
                file_idx += 1
        
        if chunk_lines:
            content = '\n'.join(chunk_lines)
            chunks.append({
                'content': content,
                'files': chunk_files,
                'tokens': _estimate_tokens(content),
                'chars': len(content),
                'lines': content.count('\n'),
                'cached': chunk_idx < max_cached_chunks,
            })
    
    return chunks


def _split_by_token_threshold(
    file_blocks: List[List[str]],
    min_chunk_tokens: int,
    include_legend: bool
) -> List[str]:
    """Split file blocks using token threshold."""
    chunks = []
    current_chunk_lines = []
    current_tokens = 0
    
    # Add legend to first chunk if requested
    if include_legend:
        legend_lines = [LEGEND, ""]
        current_chunk_lines.extend(legend_lines)
        current_tokens += _estimate_tokens('\n'.join(legend_lines))
    
    for file_lines in file_blocks:
        file_text = '\n'.join(file_lines)
        file_tokens = _estimate_tokens(file_text)
        
        # Check if we should start a new chunk
        if (min_chunk_tokens > 0 and 
            current_tokens >= min_chunk_tokens and 
            current_chunk_lines):
            chunks.append('\n'.join(current_chunk_lines))
            current_chunk_lines = []
            current_tokens = 0
        
        current_chunk_lines.extend(file_lines)
        current_tokens += file_tokens
    
    # Don't forget the last chunk
    if current_chunk_lines:
        chunks.append('\n'.join(current_chunk_lines))
    
    return chunks


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
    
    # Add call annotations if enabled (now with conditional markers)
    if include_calls:
        call_str = _format_calls(symbol)
        if call_str:
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


def _format_calls(symbol: Symbol) -> str:
    """Format calls with conditional markers.
    
    Uses call_sites if available for richer info, falls back to calls.
    
    Format: "foo,bar?,baz" where ? indicates conditional call
    """
    if symbol.call_sites:
        # Use rich call sites
        parts = []
        seen = set()
        for site in symbol.call_sites[:7]:  # Limit to 7 calls
            name = site.name
            if name in seen:
                continue
            seen.add(name)
            
            if site.is_conditional:
                parts.append(f"{name}{CONDITIONAL_MARKER}")
            else:
                parts.append(name)
        
        if len(symbol.call_sites) > 7:
            parts.append(f"+{len(symbol.call_sites)-7}")
        
        return ','.join(parts)
    
    elif symbol.calls:
        # Fall back to simple calls list
        if len(symbol.calls) <= 5:
            return ','.join(symbol.calls)
        else:
            return ','.join(symbol.calls[:5]) + f",+{len(symbol.calls)-5}"
    
    return ''


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
