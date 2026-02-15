"""Tests for symbol index — extractors, cache, resolver, references, compact format."""

import os
import tempfile
from pathlib import Path

import pytest

from ac_dc.symbol_index.parser import TreeSitterParser
from ac_dc.symbol_index.cache import SymbolCache
from ac_dc.symbol_index.import_resolver import ImportResolver
from ac_dc.symbol_index.reference_index import ReferenceIndex
from ac_dc.symbol_index.compact_format import CompactFormatter
from ac_dc.symbol_index.index import SymbolIndex
from ac_dc.symbol_index.extractors.base import FileSymbols, Import, Symbol, CallSite


@pytest.fixture
def parser():
    return TreeSitterParser()


# === Python Extractor ===

class TestPythonExtractor:
    def _parse(self, source, parser):
        from ac_dc.symbol_index.extractors.python_extractor import PythonExtractor
        tree = parser.parse(source, "python")
        assert tree is not None, "Python parser not available"
        ext = PythonExtractor()
        return ext.extract(tree, source.encode(), "test.py")

    def test_class_with_inheritance(self, parser):
        fs = self._parse("class Foo(Bar):\n    pass\n", parser)
        assert len(fs.symbols) == 1
        assert fs.symbols[0].kind == "class"
        assert fs.symbols[0].name == "Foo"
        assert "Bar" in fs.symbols[0].bases

    def test_method_as_child(self, parser):
        fs = self._parse("class Foo:\n    def bar(self):\n        pass\n", parser)
        cls = fs.symbols[0]
        assert len(cls.children) == 1
        assert cls.children[0].kind == "method"
        assert cls.children[0].name == "bar"

    def test_property_detected(self, parser):
        src = "class Foo:\n    @property\n    def bar(self):\n        return 1\n"
        fs = self._parse(src, parser)
        cls = fs.symbols[0]
        assert any(c.kind == "property" for c in cls.children)

    def test_async_method(self, parser):
        src = "class Foo:\n    async def fetch(self, url):\n        pass\n"
        fs = self._parse(src, parser)
        method = fs.symbols[0].children[0]
        assert method.is_async is True

    def test_parameters(self, parser):
        fs = self._parse("class Foo:\n    def bar(self, x, y=10):\n        pass\n", parser)
        method = fs.symbols[0].children[0]
        assert len(method.parameters) == 2
        assert method.parameters[0].name == "x"
        assert method.parameters[1].name == "y"

    def test_return_type(self, parser):
        fs = self._parse("def foo() -> str:\n    pass\n", parser)
        assert fs.symbols[0].return_type is not None

    def test_instance_vars(self, parser):
        src = "class Foo:\n    def __init__(self):\n        self.x = 1\n        self.y = 2\n"
        fs = self._parse(src, parser)
        assert "x" in fs.symbols[0].instance_vars
        assert "y" in fs.symbols[0].instance_vars

    def test_imports(self, parser):
        src = "import os\nfrom pathlib import Path\nfrom . import sibling\n"
        fs = self._parse(src, parser)
        assert len(fs.imports) >= 2
        # Check absolute
        abs_imp = [i for i in fs.imports if i.module == "os"]
        assert len(abs_imp) >= 1
        # Check relative
        rel_imp = [i for i in fs.imports if i.level > 0]
        assert len(rel_imp) >= 1

    def test_top_level_variable(self, parser):
        fs = self._parse("CONFIG = {}\n", parser)
        assert any(s.kind == "variable" and s.name == "CONFIG" for s in fs.symbols)

    def test_top_level_function(self, parser):
        fs = self._parse("def helper():\n    pass\n", parser)
        assert fs.symbols[0].kind == "function"

    def test_call_sites(self, parser):
        src = "def foo():\n    bar()\n    baz()\n"
        fs = self._parse(src, parser)
        assert len(fs.symbols[0].call_sites) >= 2


# === JavaScript Extractor ===

class TestJavaScriptExtractor:
    def _parse(self, source, parser):
        from ac_dc.symbol_index.extractors.javascript_extractor import JavaScriptExtractor
        tree = parser.parse(source, "javascript")
        assert tree is not None, "JavaScript parser not available"
        ext = JavaScriptExtractor()
        return ext.extract(tree, source.encode(), "test.js")

    def test_class_with_extends(self, parser):
        src = "class Foo extends Bar {\n    constructor() {}\n}\n"
        fs = self._parse(src, parser)
        assert len(fs.symbols) >= 1
        cls = fs.symbols[0]
        assert cls.kind == "class"
        assert "Bar" in cls.bases

    def test_method_and_getter(self, parser):
        src = "class Foo {\n    get name() { return 'foo'; }\n    async fetch(url) {}\n}\n"
        fs = self._parse(src, parser)
        cls = fs.symbols[0]
        assert any(c.kind == "property" for c in cls.children)
        assert any(c.is_async for c in cls.children)

    def test_function_declaration(self, parser):
        src = "function hello(name) { return 'hi ' + name; }\n"
        fs = self._parse(src, parser)
        assert any(s.kind == "function" and s.name == "hello" for s in fs.symbols)

    def test_const_variable(self, parser):
        src = "const MAX = 100;\n"
        fs = self._parse(src, parser)
        assert any(s.kind == "variable" and s.name == "MAX" for s in fs.symbols)

    def test_imports(self, parser):
        src = "import { foo, bar } from './utils';\nimport React from 'react';\n"
        fs = self._parse(src, parser)
        assert len(fs.imports) >= 2


# === C Extractor ===

class TestCExtractor:
    def _parse(self, source, parser):
        from ac_dc.symbol_index.extractors.c_extractor import CExtractor
        tree = parser.parse(source, "c")
        assert tree is not None, "C parser not available"
        ext = CExtractor()
        return ext.extract(tree, source.encode(), "test.c")

    def test_struct(self, parser):
        src = "struct Point {\n    int x;\n    int y;\n};\n"
        fs = self._parse(src, parser)
        assert any(s.kind == "class" and s.name == "Point" for s in fs.symbols)

    def test_function(self, parser):
        src = "int add(int a, int b) {\n    return a + b;\n}\n"
        fs = self._parse(src, parser)
        assert any(s.kind == "function" and s.name == "add" for s in fs.symbols)

    def test_include(self, parser):
        src = '#include "header.h"\n#include <stdio.h>\n'
        fs = self._parse(src, parser)
        assert len(fs.imports) >= 1


# === Symbol Cache ===

class TestSymbolCache:
    def test_put_get(self):
        cache = SymbolCache()
        fs = FileSymbols(file_path="test.py", symbols=[
            Symbol(name="Foo", kind="class")
        ])
        cache.put("test.py", 1000.0, fs)
        result = cache.get("test.py", 1000.0)
        assert result is not None
        assert result.symbols[0].name == "Foo"

    def test_stale_mtime(self):
        cache = SymbolCache()
        fs = FileSymbols(file_path="test.py")
        cache.put("test.py", 1000.0, fs)
        assert cache.get("test.py", 2000.0) is None

    def test_invalidate(self):
        cache = SymbolCache()
        fs = FileSymbols(file_path="test.py")
        cache.put("test.py", 1000.0, fs)
        cache.invalidate("test.py")
        assert cache.get("test.py", 1000.0) is None

    def test_content_hash(self):
        cache = SymbolCache()
        fs1 = FileSymbols(file_path="a.py", symbols=[Symbol(name="X", kind="class")])
        fs2 = FileSymbols(file_path="b.py", symbols=[Symbol(name="Y", kind="function")])
        cache.put("a.py", 1.0, fs1)
        cache.put("b.py", 1.0, fs2)
        h1 = cache.get_hash("a.py")
        h2 = cache.get_hash("b.py")
        assert h1 is not None and h2 is not None
        assert h1 != h2
        assert len(h1) == 16

    def test_cached_files(self):
        cache = SymbolCache()
        cache.put("a.py", 1.0, FileSymbols(file_path="a.py"))
        cache.put("b.py", 1.0, FileSymbols(file_path="b.py"))
        assert cache.cached_files == {"a.py", "b.py"}


# === Import Resolver ===

class TestImportResolver:
    @pytest.fixture
    def repo(self, tmp_path):
        (tmp_path / "foo").mkdir()
        (tmp_path / "foo" / "__init__.py").write_text("")
        (tmp_path / "foo" / "bar.py").write_text("")
        (tmp_path / "foo" / "models.py").write_text("")
        (tmp_path / "utils").mkdir()
        (tmp_path / "utils" / "index.js").write_text("")
        (tmp_path / "utils" / "rpc.ts").write_text("")
        (tmp_path / "include").mkdir()
        (tmp_path / "include" / "header.h").write_text("")
        return ImportResolver(str(tmp_path))

    def test_python_absolute(self, repo):
        imp = Import(module="foo.bar", names=["Baz"])
        result = repo.resolve(imp, "main.py", "python")
        assert result == "foo/bar.py"

    def test_python_package(self, repo):
        imp = Import(module="foo", names=["bar"])
        result = repo.resolve(imp, "main.py", "python")
        assert result == "foo/__init__.py"

    def test_python_relative(self, repo):
        imp = Import(module="models", names=["X"], level=1)
        result = repo.resolve(imp, "foo/bar.py", "python")
        assert result == "foo/models.py"

    def test_python_relative_level2(self, repo):
        imp = Import(module="", names=["something"], level=2)
        result = repo.resolve(imp, "foo/sub/deep.py", "python")
        # Goes up 1 from foo/sub -> foo, can't resolve empty module
        # This tests graceful handling
        assert result is None or isinstance(result, str)

    def test_python_not_found(self, repo):
        imp = Import(module="nonexistent", names=[])
        result = repo.resolve(imp, "main.py", "python")
        assert result is None

    def test_js_relative(self, repo):
        imp = Import(module="./rpc", names=["RPC"])
        result = repo.resolve(imp, "utils/index.js", "javascript")
        assert result is not None and "rpc" in result

    def test_js_index_file(self, repo):
        imp = Import(module="./utils", names=["helper"])
        result = repo.resolve(imp, "main.js", "javascript")
        assert result is not None

    def test_js_external(self, repo):
        imp = Import(module="react", names=["Component"])
        result = repo.resolve(imp, "app.js", "javascript")
        assert result is None

    def test_c_include(self, repo):
        imp = Import(module="header.h", names=[])
        result = repo.resolve(imp, "main.c", "c")
        assert result is not None and "header.h" in result


# === Reference Index ===

class TestReferenceIndex:
    def test_build_and_query(self):
        idx = ReferenceIndex()
        fs_a = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(name="Foo", kind="class", call_sites=[
                CallSite(name="bar", line=10),
            ])],
        )
        fs_b = FileSymbols(
            file_path="b.py",
            symbols=[Symbol(name="bar", kind="function")],
        )
        idx.build({"a.py": fs_a, "b.py": fs_b})
        refs = idx.references_to_symbol("bar")
        assert len(refs) >= 1
        assert refs[0]["file"] == "a.py"

    def test_bidirectional_edges(self):
        idx = ReferenceIndex()
        fs_a = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(name="Foo", kind="class", call_sites=[
                CallSite(name="Bar", line=5),
            ])],
        )
        fs_b = FileSymbols(
            file_path="b.py",
            symbols=[Symbol(name="Bar", kind="class", call_sites=[
                CallSite(name="Foo", line=5),
            ])],
        )
        idx.build({"a.py": fs_a, "b.py": fs_b})
        edges = idx.bidirectional_edges()
        assert len(edges) >= 1

    def test_connected_components(self):
        idx = ReferenceIndex()
        fs_a = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(name="Foo", kind="class", call_sites=[
                CallSite(name="Bar", line=5),
            ])],
        )
        fs_b = FileSymbols(
            file_path="b.py",
            symbols=[Symbol(name="Bar", kind="class", call_sites=[
                CallSite(name="Foo", line=5),
            ])],
        )
        idx.build({"a.py": fs_a, "b.py": fs_b})
        components = idx.connected_components()
        assert len(components) >= 1
        assert "a.py" in components[0] and "b.py" in components[0]

    def test_file_ref_count(self):
        idx = ReferenceIndex()
        fs_a = FileSymbols(
            file_path="a.py",
            symbols=[Symbol(name="Foo", kind="class", call_sites=[
                CallSite(name="helper", line=5),
            ])],
        )
        fs_b = FileSymbols(
            file_path="b.py",
            symbols=[Symbol(name="helper", kind="function")],
        )
        idx.build({"a.py": fs_a, "b.py": fs_b})
        assert idx.file_ref_count("b.py") >= 1


# === Compact Formatter ===

class TestCompactFormatter:
    def _make_fs(self):
        return {
            "app/models.py": FileSymbols(
                file_path="app/models.py",
                symbols=[
                    Symbol(name="User", kind="class", start_line=10, children=[
                        Symbol(name="__init__", kind="method", start_line=15,
                               parameters=[]),
                        Symbol(name="validate", kind="method", start_line=20,
                               return_type="bool"),
                    ]),
                ],
                imports=[Import(module="dataclasses", names=["dataclass"])],
            ),
        }

    def test_output_includes_class(self):
        fmt = CompactFormatter()
        output = fmt.format_all(self._make_fs())
        assert "User" in output
        assert "c User" in output

    def test_legend_present(self):
        fmt = CompactFormatter()
        output = fmt.format_all(self._make_fs())
        assert "c=class" in output

    def test_imports_formatted(self):
        fmt = CompactFormatter()
        output = fmt.format_all(self._make_fs())
        assert "i dataclasses" in output

    def test_line_numbers(self):
        fmt = CompactFormatter()
        output = fmt.format_all(self._make_fs())
        assert ":10" in output

    def test_exclude_files(self):
        fmt = CompactFormatter()
        output = fmt.format_all(self._make_fs(), exclude_files={"app/models.py"})
        assert "User" not in output

    def test_test_file_collapsed(self):
        fs = {
            "tests/test_foo.py": FileSymbols(
                file_path="tests/test_foo.py",
                symbols=[
                    Symbol(name="TestFoo", kind="class", children=[
                        Symbol(name="test_a", kind="method"),
                        Symbol(name="test_b", kind="method"),
                    ]),
                ],
            ),
        }
        fmt = CompactFormatter()
        output = fmt.format_all(fs)
        assert "c/" in output  # Nc/Nm format

    def test_chunks(self):
        fs = {}
        for i in range(10):
            fs[f"file{i}.py"] = FileSymbols(
                file_path=f"file{i}.py",
                symbols=[Symbol(name=f"Cls{i}", kind="class")],
            )
        fmt = CompactFormatter()
        chunks = fmt.format_all(fs, chunks=3)
        assert isinstance(chunks, list)
        assert len(chunks) <= 3
        # Total files across chunks
        total = sum(c.count(".py:") for c in chunks)
        assert total == 10

    def test_async_prefix(self):
        fs = {
            "app.py": FileSymbols(
                file_path="app.py",
                symbols=[Symbol(name="fetch", kind="function", is_async=True, start_line=1)],
            ),
        }
        fmt = CompactFormatter()
        output = fmt.format_all(fs)
        assert "af fetch" in output

    def test_signature_hash_stable(self):
        fmt = CompactFormatter()
        fs = FileSymbols(file_path="a.py", symbols=[
            Symbol(name="Foo", kind="class"),
        ])
        h1 = fmt.signature_hash(fs)
        h2 = fmt.signature_hash(fs)
        assert h1 == h2
        assert len(h1) == 16


# === Integration ===

class TestSymbolIndexIntegration:
    @pytest.fixture
    def repo(self, tmp_path):
        (tmp_path / "app.py").write_text(
            "import os\n\nclass App:\n    def run(self):\n        helper()\n"
        )
        (tmp_path / "utils.py").write_text(
            "def helper():\n    return 42\n"
        )
        return tmp_path

    def test_index_repo(self, repo):
        idx = SymbolIndex(str(repo))
        result = idx.index_repo()
        assert "app.py" in result
        assert "utils.py" in result

    def test_symbol_map_output(self, repo):
        idx = SymbolIndex(str(repo))
        idx.index_repo()
        output = idx.get_symbol_map()
        assert "App" in output
        assert "helper" in output

    def test_exclude_active_files(self, repo):
        idx = SymbolIndex(str(repo))
        idx.index_repo()
        output = idx.get_symbol_map(exclude_files={"app.py"})
        assert "App" not in output
        assert "helper" in output

    def test_reindex_after_modification(self, repo):
        idx = SymbolIndex(str(repo))
        idx.index_repo()

        # Modify file
        (repo / "utils.py").write_text(
            "def helper():\n    return 42\n\ndef new_func():\n    pass\n"
        )
        idx.invalidate_file("utils.py")
        idx.index_file("utils.py")
        idx.reference_index.build(idx._all_symbols)

        output = idx.get_symbol_map()
        assert "new_func" in output

    def test_hover(self, repo):
        idx = SymbolIndex(str(repo))
        idx.index_repo()
        result = idx.lsp_get_hover("app.py", 3, 5)  # class App line
        assert result is not None

    def test_completions(self, repo):
        idx = SymbolIndex(str(repo))
        idx.index_repo()
        result = idx.lsp_get_completions("app.py", 4, 0, prefix="r")
        assert isinstance(result, list)
