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


# Legend for compact format (path aliases appended dynamically)
LEGEND_BASE = "# c=class m=method f=function v=var p=property i=import i→=local\n# :N=line(s) ->T=returns ?=optional ←=refs →=calls +N=more ″=ditto"


def _estimate_tokens(text: str) -> int:
    """Estimate token count using ~4 chars per token heuristic."""
    return len(text) // 4 + 1


def _compute_path_aliases(
    references: Optional[Dict[str, Dict[str, List]]],
    file_refs: Optional[Dict[str, Set[str]]],
    min_occurrences: int = 3,
    max_aliases: int = 9,
) -> Dict[str, str]:
    """Compute directory aliases for compressing reference paths.
    
    Analyzes all reference paths to find common directory prefixes,
    then assigns short aliases (@1, @2, etc.) to the most frequent ones.
    
    Args:
        references: Dict of file -> symbol -> [locations]
        file_refs: Dict of file -> set of files that reference it
        min_occurrences: Minimum times a prefix must appear to get an alias
        max_aliases: Maximum number of aliases to create (1-9)
        
    Returns:
        Dict mapping directory prefix to alias (e.g., "ac/llm/" -> "@1")
    """
    from collections import Counter
    
    # Collect all referenced file paths
    ref_paths = []
    
    if references:
        for file_refs_dict in references.values():
            for locations in file_refs_dict.values():
                for loc in locations:
                    if hasattr(loc, 'file_path'):
                        ref_paths.append(loc.file_path)
                    elif isinstance(loc, dict):
                        path = loc.get('file', loc.get('file_path', ''))
                        if path:
                            ref_paths.append(path)
    
    if file_refs:
        for files in file_refs.values():
            ref_paths.extend(files)
    
    if not ref_paths:
        return {}
    
    # Count directory prefixes (try multiple levels)
    prefix_counts = Counter()
    for path in ref_paths:
        parts = path.split('/')
        # Try prefixes of length 1, 2, 3 directories
        for depth in range(1, min(4, len(parts))):
            prefix = '/'.join(parts[:depth]) + '/'
            # Only count if it's a real directory (not the file itself)
            if prefix != path + '/':
                prefix_counts[prefix] += 1
    
    # Filter by minimum occurrences and calculate savings
    candidates = []
    for prefix, count in prefix_counts.items():
        if count >= min_occurrences:
            # Savings = (prefix_len - 2) * count - legend_cost
            # Legend cost is roughly len("@N=prefix/ ") ≈ len(prefix) + 5
            savings = (len(prefix) - 2) * count - (len(prefix) + 5)
            if savings > 0:
                candidates.append((prefix, count, savings))
    
    # Sort by savings descending, take top max_aliases
    candidates.sort(key=lambda x: x[2], reverse=True)
    
    # Assign aliases, avoiding prefix conflicts (longer prefixes first)
    # Sort selected candidates by length descending so longer paths match first
    selected = candidates[:max_aliases]
    selected.sort(key=lambda x: len(x[0]), reverse=True)
    
    aliases = {}
    for i, (prefix, count, savings) in enumerate(selected):
        aliases[prefix] = f"@{i + 1}"
    
    return aliases


def _apply_path_alias(path: str, aliases: Dict[str, str]) -> str:
    """Apply path aliases to a file path.
    
    Args:
        path: Full file path
        aliases: Dict mapping prefix -> alias
        
    Returns:
        Path with alias applied, or original path if no alias matches
    """
    # Try aliases in order (they're sorted by length descending)
    for prefix, alias in aliases.items():
        if path.startswith(prefix):
            return alias + path[len(prefix):]
    return path


def _format_legend(aliases: Dict[str, str]) -> str:
    """Format the legend including any path aliases.
    
    Args:
        aliases: Dict mapping prefix -> alias (e.g., "ac/llm/" -> "@1")
        
    Returns:
        Complete legend string
    """
    if not aliases:
        return LEGEND_BASE
    
    # Sort aliases by their number (@1, @2, etc.)
    sorted_aliases = sorted(aliases.items(), key=lambda x: x[1])
    alias_str = ' '.join(f"{alias}={prefix}" for prefix, alias in sorted_aliases)
    
    return f"{LEGEND_BASE}\n# {alias_str}"


def _format_file_block(
    file_path: str,
    symbols: List[Symbol],
    references: Optional[Dict[str, Dict[str, List]]],
    file_refs: Optional[Dict[str, Set[str]]],
    file_imports: Optional[Dict[str, Set[str]]],
    include_instance_vars: bool,
    include_calls: bool,
    aliases: Dict[str, str] = None,
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
        aliases: Optional dict mapping path prefixes to short aliases
        
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
    
    aliases = aliases or {}
    
    # Group symbols by their reference signature to use ditto marks
    # This handles cases like TEST(...) macros that all reference the same location
    def _refs_signature(refs: List) -> str:
        """Create a hashable signature for a reference list."""
        if not refs:
            return ""
        return _format_refs(refs, aliases)
    
    # Output imports on one line if any
    if imports:
        import_names = _extract_import_names(imports)
        if import_names:
            lines.append(f"i {','.join(import_names)}")
    
    # Output in-repo file imports (outgoing dependencies)
    if file_imports and file_path in file_imports:
        in_repo_imports = sorted(file_imports[file_path])
        if in_repo_imports:
            lines.append(f"i→ {','.join(in_repo_imports)}")
    
    # Output non-variable symbols, using ditto marks for repeated references
    last_refs_str = None
    for symbol in non_var_symbols:
        symbol_refs = file_references.get(symbol.name, [])
        refs_str = _refs_signature(symbol_refs)
        
        # Use ditto mark if refs are identical to previous symbol
        use_ditto = (refs_str and refs_str == last_refs_str)
        
        lines.extend(_format_symbol(
            symbol, indent=0, refs=symbol_refs,
            include_instance_vars=include_instance_vars,
            include_calls=include_calls,
            use_ditto_refs=use_ditto,
            aliases=aliases,
        ))
        
        if refs_str:
            last_refs_str = refs_str
    
    # Output grouped variables (consolidate same-named vars onto one line)
    for var_name, var_symbols in sorted(var_groups.items(), key=lambda x: x[1][0].range.start_line):
        var_refs = file_references.get(var_name, [])
        if len(var_symbols) == 1:
            # Single variable, output normally
            lines.extend(_format_symbol(
                var_symbols[0], indent=0, refs=var_refs,
                include_instance_vars=include_instance_vars,
                include_calls=include_calls,
                aliases=aliases,
            ))
        else:
            # Multiple variables with same name - consolidate line numbers
            line_nums = [str(s.range.start_line) for s in var_symbols]
            line_str = ','.join(line_nums[:5])
            if len(line_nums) > 5:
                line_str += f",+{len(line_nums)-5}"
            
            line_parts = [f"v {var_name}:{line_str}"]
            
            # Add refs for first occurrence, ditto for rest is implicit
            if var_refs:
                ref_annotations = _format_refs(var_refs, aliases)
                if ref_annotations:
                    line_parts.append(f" {ref_annotations}")
            
            lines.append(''.join(line_parts))
    
    # Add file-level reference summary if available
    if file_refs and file_path in file_refs:
        ref_files = sorted(file_refs[file_path])
        if ref_files:
            # Apply aliases to file-level refs too
            aliased_refs = [_apply_path_alias(f, aliases) for f in ref_files]
            # Limit to first 5 files to keep it compact
            if len(aliased_refs) > 5:
                ref_summary = ','.join(aliased_refs[:5]) + f",+{len(aliased_refs)-5}"
            else:
                ref_summary = ','.join(aliased_refs)
            lines.append(f"←refs: {ref_summary}")
    
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
    
    Path aliases are automatically computed for frequently-referenced directories:
    ```
    # @1=ac/llm/ @2=tests/
    ac/foo.py:
    │f func:10 ←@1streaming.py:20,@2test_foo.py:15
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
    # Use provided order, or fall back to sorted for determinism
    if file_order:
        ordered_files = [f for f in file_order if f in symbols_by_file]
    else:
        ordered_files = sorted(symbols_by_file.keys())
    
    if not ordered_files:
        return ''
    
    # Compute path aliases for references
    aliases = _compute_path_aliases(references, file_refs)
    
    lines = []
    
    if include_legend:
        lines.extend([_format_legend(aliases), ""])
    
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
            aliases=aliases,
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
    
    # Compute path aliases for references
    aliases = _compute_path_aliases(references, file_refs)
    
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
            aliases=aliases,
        )
        if file_lines:
            all_file_blocks.append(file_lines)
    
    if not all_file_blocks:
        return []
    
    # Compute legend with aliases for chunking functions
    legend = _format_legend(aliases) if include_legend else None
    
    # If num_chunks specified, distribute files evenly across chunks
    if num_chunks and num_chunks > 0:
        if return_metadata:
            return _split_into_n_chunks_with_metadata(
                all_file_blocks, num_chunks, legend, ordered_files
            )
        return _split_into_n_chunks(all_file_blocks, num_chunks, legend)
    
    # Otherwise use token-based chunking
    return _split_by_token_threshold(all_file_blocks, min_chunk_tokens, legend)


def _split_into_n_chunks(
    file_blocks: List[List[str]],
    num_chunks: int,
    legend: Optional[str],
    file_paths: List[str] = None,
) -> List[str]:
    """Split file blocks into exactly N chunks.
    
    Args:
        file_blocks: List of formatted line lists, one per file
        num_chunks: Target number of chunks
        legend: Legend string to include in first chunk, or None
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
        if chunk_idx == 0 and legend:
            chunk_lines.extend([legend, ""])
        
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
    legend: Optional[str],
    file_paths: List[str],
) -> List[dict]:
    """Split file blocks into exactly N chunks with metadata.
    
    Args:
        file_blocks: List of formatted line lists, one per file
        num_chunks: Target number of chunks
        legend: Legend string to include in first chunk, or None
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
        
        if chunk_idx == 0 and legend:
            chunk_lines.extend([legend, ""])
        
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
    legend: Optional[str]
) -> List[str]:
    """Split file blocks using token threshold."""
    chunks = []
    current_chunk_lines = []
    current_tokens = 0
    
    # Add legend to first chunk if requested
    if legend:
        legend_lines = [legend, ""]
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
    use_ditto_refs: bool = False,
    aliases: Dict[str, str] = None,
) -> List[str]:
    """Format a single symbol and its children.
    
    Args:
        symbol: The symbol to format
        indent: Current indentation level
        refs: List of locations referencing this symbol
        parent_refs: Dict of child_name -> [locations] for children
        include_instance_vars: Whether to include instance variables
        include_calls: Whether to include call information
        use_ditto_refs: If True, use ″ instead of full ref list (same as previous)
        aliases: Optional dict mapping path prefixes to short aliases
    """
    lines = []
    prefix = KIND_PREFIX.get(symbol.kind, '?')
    indent_str = "  " * indent
    
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
        if use_ditto_refs:
            line_parts.append(" ←″")
        else:
            ref_annotations = _format_refs(refs, aliases)
            if ref_annotations:
                line_parts.append(f" {ref_annotations}")
    
    lines.append(''.join(line_parts))
    
    # Add instance variables for classes
    if include_instance_vars and symbol.kind == 'class' and symbol.instance_vars:
        var_indent = "  " * (indent + 1)
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
            aliases=aliases,
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


def _format_refs(locations: List, aliases: Dict[str, str] = None) -> str:
    """Format reference locations compactly.
    
    Args:
        locations: List of Location objects or dicts
        aliases: Optional dict mapping path prefixes to short aliases
        
    Returns:
        String like "←file.py:10,other.py:20" or empty string
    """
    if not locations:
        return ""
    
    aliases = aliases or {}
    
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
    parts = []
    for f, l in items:
        aliased_path = _apply_path_alias(f, aliases) if aliases else f
        parts.append(f"{aliased_path}:{l}")
    
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
