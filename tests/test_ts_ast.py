from ac_dc.symbol_index.parser import TreeSitterParser

p = TreeSitterParser()
with open("expr-editor.ts", "rb") as f:
    source = f.read()

tree = p.parse(source, "typescript")

def dump(node, indent=0, max_depth=4):
    if indent > max_depth:
        return
    preview = source[node.start_byte:node.end_byte].decode()[:60].replace('\n', '\\n')
    pad = "  " * indent
    print(pad + node.type + " [" + str(node.start_point[0]+1) + "] " + repr(preview))
    for child in node.children:
        dump(child, indent + 1, max_depth)

dump(tree.root_node)