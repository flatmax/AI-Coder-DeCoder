#!/usr/bin/env python3
"""Test script to verify symbol map output including in-repo imports."""

import sys
from pathlib import Path

# Add repo root to path
repo_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(repo_root))

from ac.symbol_index import SymbolIndex
from ac.symbol_index.parser import get_parser
from ac.symbol_index.extractors import get_extractor


def main():
    # Test file
    test_file = 'ac/llm/streaming.py'
    
    if len(sys.argv) > 1:
        test_file = sys.argv[1]
    
    print(f"Generating symbol map for: {test_file}")
    print("=" * 60)
    
    # First, let's debug the import extraction
    print("\nDEBUG: Raw import extraction")
    print("-" * 40)
    
    parser = get_parser()
    abs_path = repo_root / test_file
    
    with open(abs_path, 'rb') as f:
        content = f.read()
    
    tree, lang_name = parser.parse_file(str(abs_path), content)
    print(f"Language: {lang_name}")
    
    extractor = get_extractor(lang_name)
    symbols = extractor.extract_symbols(tree, test_file, content)
    
    # Get the imports
    imports = extractor.get_imports()
    print(f"\nExtracted {len(imports)} imports:")
    for imp in imports:
        print(f"  module='{imp.module}', names={imp.names}, level={imp.level}")
    
    # Now test resolution
    print("\nDEBUG: Import resolution")
    print("-" * 40)
    
    from ac.symbol_index.import_resolver import ImportResolver
    resolver = ImportResolver(str(repo_root))
    
    for imp in imports:
        is_relative = imp.level > 0
        resolved = resolver.resolve_python_import(
            module=imp.module,
            from_file=test_file,
            is_relative=is_relative,
            level=imp.level
        )
        print(f"  {imp.module} (level={imp.level}) -> {resolved}")
    
    # Now run the full index
    print("\n" + "=" * 60)
    print("Full SymbolIndex output:")
    print("=" * 60)
    
    idx = SymbolIndex(str(repo_root))
    
    # Index the file
    symbols = idx.index_file(test_file)
    print(f"\nFound {len(symbols)} top-level symbols")
    
    # Check file imports
    if test_file in idx._file_imports:
        print(f"\nResolved in-repo imports:")
        for imp in sorted(idx._file_imports[test_file]):
            print(f"  → {imp}")
    else:
        print("\nNo in-repo imports resolved (or none found)")
    
    # Generate compact output
    print("\n" + "=" * 60)
    print("Compact symbol map output:")
    print("=" * 60 + "\n")
    
    compact = idx.to_compact([test_file])
    print(compact)
    
    # Test with references if multiple files indexed
    print("\n" + "=" * 60)
    print("With references (requires indexing more files):")
    print("=" * 60 + "\n")
    
    # Index some related files to build references
    related_files = [
        test_file,
        'ac/llm/llm.py',
        'ac/llm/chat.py',
    ]
    existing_files = [f for f in related_files if (repo_root / f).exists()]
    
    if len(existing_files) > 1:
        compact_with_refs = idx.to_compact(existing_files, include_references=True)
        # Just show our test file's output
        for block in compact_with_refs.split('\n\n'):
            if block.startswith(test_file):
                print(block)
                break
    else:
        print("(skipped - need multiple files)")


if __name__ == '__main__':
    main()
