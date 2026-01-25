"""LSP format for Monaco editor integration."""

from typing import List, Dict, Optional
from .models import Symbol


def to_lsp(symbols_by_file: Dict[str, List[Symbol]]) -> Dict:
    """Generate LSP-compatible format for Monaco.
    
    Format:
    ```json
    {
      "file.py": {
        "symbols": [...],
        "imports": [...]
      }
    }
    ```
    
    Args:
        symbols_by_file: Dict mapping file paths to their symbols
        
    Returns:
        LSP-compatible dict structure
    """
    result = {}
    
    for file_path, symbols in symbols_by_file.items():
        imports = []
        main_symbols = []
        
        for symbol in symbols:
            if symbol.kind == 'import':
                imports.append(_format_import(symbol))
            else:
                main_symbols.append(symbol.to_dict())
        
        result[file_path] = {
            'symbols': main_symbols,
            'imports': imports,
        }
    
    return result


def _format_import(symbol: Symbol) -> Dict:
    """Format an import symbol for LSP output."""
    import_text = symbol.name
    
    module = None
    names = None
    
    if import_text.startswith('import '):
        # import foo, bar or import foo as f
        parts = import_text[7:].split(',')
        names = [p.strip() for p in parts]
        module = names[0].split('.')[0] if names else None
    elif import_text.startswith('from '):
        # from foo import bar, baz
        parts = import_text[5:].split(' import ')
        if len(parts) >= 2:
            module = parts[0].strip()
            names = [n.strip() for n in parts[1].split(',')]
    
    return {
        'module': module,
        'names': names,
        'line': symbol.range.start_line,
    }


def get_document_symbols(symbols: List[Symbol]) -> List[Dict]:
    """Get document symbols in LSP DocumentSymbol format.
    
    This format is used by Monaco's outline view.
    
    Args:
        symbols: List of symbols for a single file
        
    Returns:
        List of LSP DocumentSymbol dicts
    """
    result = []
    
    for symbol in symbols:
        if symbol.kind == 'import':
            continue  # Skip imports for outline
        
        doc_symbol = {
            'name': symbol.name,
            'kind': _symbol_kind_to_lsp(symbol.kind),
            'range': symbol.range.to_dict(),
            'selectionRange': symbol.selection_range.to_dict(),
        }
        
        if symbol.children:
            doc_symbol['children'] = get_document_symbols(symbol.children)
        
        result.append(doc_symbol)
    
    return result


def _symbol_kind_to_lsp(kind: str) -> int:
    """Convert symbol kind string to LSP SymbolKind number."""
    # LSP SymbolKind values
    kinds = {
        'class': 5,      # Class
        'method': 6,     # Method
        'property': 7,   # Property
        'function': 12,  # Function
        'variable': 13,  # Variable
        'import': 2,     # Module
    }
    return kinds.get(kind, 13)  # Default to Variable


def get_hover_info(symbol: Symbol) -> Dict:
    """Get hover information for a symbol.
    
    Args:
        symbol: The symbol to get hover info for
        
    Returns:
        Dict with 'contents' for Monaco hover
    """
    parts = []
    
    # Build signature
    sig = symbol.name
    if symbol.kind == 'class' and symbol.bases:
        sig = f"class {symbol.name}({', '.join(symbol.bases)})"
    elif symbol.kind in ('function', 'method'):
        params = ', '.join(
            p.name + (f': {p.type_annotation}' if p.type_annotation else '')
            for p in symbol.parameters
        )
        ret = f' -> {symbol.return_type}' if symbol.return_type else ''
        sig = f"def {symbol.name}({params}){ret}"
    
    parts.append(f"```python\n{sig}\n```")
    
    if symbol.docstring:
        parts.append(symbol.docstring)
    
    return {
        'contents': '\n\n'.join(parts)
    }
