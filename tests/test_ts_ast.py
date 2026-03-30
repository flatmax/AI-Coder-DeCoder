"""AST dump utility for TypeScript files — not a pytest test suite.

Run directly:  python tests/test_ts_ast.py expr-editor.ts
"""
import sys
import os

from ac_dc.symbol_index.parser import TreeSitterParser


def dump(node, source, indent=0, max_depth=4):
    if indent > max_depth:
        return
    preview = source[node.start_byte:node.end_byte].decode()[:60].replace('\n', '\\n')
    pad = "  " * indent
    print(pad + node.type + " [" + str(node.start_point[0]+1) + "] " + repr(preview))
    for child in node.children:
        dump(child, source, indent + 1, max_depth)


def main(filepath):
    p = TreeSitterParser()
    with open(filepath, "rb") as f:
        source = f.read()
    tree = p.parse(source, "typescript")
    dump(tree.root_node, source)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python tests/test_ts_ast.py <file.ts>")
        sys.exit(1)
    main(sys.argv[1])