"""Tests for SymbolIndex — parser, extractors, cache, formatter, reference index."""

import subprocess
from pathlib import Path

import pytest

from ac_dc.symbol_index.parser import TreeSitterParser, language_for_file
from ac_dc.symbol_index.cache import SymbolCache
from ac_dc.symbol_index.models import FileSymbols, Symbol, Import, Parameter, CallSite
from ac_dc.symbol_index.reference_index import ReferenceIndex
from ac_dc.symbol_index.compact_format import CompactFormatter
from ac_dc.symbol_index.import_resolver import ImportResolver


def _has_language(lang_name):
    """Check if a tree-sitter language package is available."""
    try:
        TreeSitterParser.reset()
        p = TreeSitterParser()
        available = p.has_language(lang_name)
        TreeSitterParser.reset()
        return available
    except Exception:
        return False


_skip_no_python = pytest.mark.skipif(
    not _has_language("python"),
    reason="tree-sitter-python not installed",
)
_skip_no_js = pytest.mark.skipif(
    not _has_language("javascript"),
    reason="tree-sitter-javascript not installed",
)
_skip_no_c = pytest.mark.skipif(
    not _has_language("c"),
    reason="tree-sitter-c not installed",
)


# ── Parser ────────────────────────────────────────────────────────

class TestParser:
    def setup_method(self):
        TreeSitterParser.reset()

    def test_language_for_python(self):
        assert language_for_file("src/main.py") == "python"

    def test_language_for_js(self):
        assert language_for_file("app.js") == "javascript"

    def test_language_for_ts(self):
        assert language_for_file("app.ts") == "typescript"

    def test_language_for_c(self):
        assert language_for_file("main.c") == "c"

    def test_language_for_matlab(self):
        assert language_for_file("script.m") == "matlab"

    def test_language_for_unknown(self):
        assert language_for_file("data.csv") is None

    def test_parser_singleton(self):
        TreeSitterParser.reset()
        p1 = TreeSitterParser()
        p2 = TreeSitterParser()
        assert p1 is p2
        TreeSitterParser.reset()


# ── Python Extractor ──────────────────────────────────────────────

class TestPythonExtractor:
    @pytest.fixture(autouse=True)
    def reset_parser(self):
        TreeSitterParser.reset()
        yield
        TreeSitterParser.reset()

    def _parse(self, source: str) -> FileSymbols:
        from ac_dc.symbol_index.extractors.python_extractor import PythonExtractor
        parser = TreeSitterParser()
        src_bytes = source.encode("utf-8")
        tree = parser.parse(src_bytes, "python")
        ext = PythonExtractor()
        return ext.extract(src_bytes, tree, "test.py")

    @_skip_no_python
    def test_class_with_inheritance(self):
        fs = self._parse("class MyClass(Base):\n    pass\n")
        assert len(fs.symbols) == 1
        assert fs.symbols[0].kind == "class"
        assert fs.symbols[0].name == "MyClass"
        assert "Base" in fs.symbols[0].bases

    @_skip_no_python
    def test_method_and_property(self):
        code = '''
class Foo:
    @property
    def bar(self):
        return self._bar

    def baz(self, x):
        return x
'''
        fs = self._parse(code)
        cls = fs.symbols[0]
        assert cls.kind == "class"
        children = {c.name: c for c in cls.children}
        assert children["bar"].kind == "property"
        assert children["baz"].kind == "method"

    @_skip_no_python
    def test_async_method(self):
        code = '''
class Svc:
    async def fetch(self, url):
        pass
'''
        fs = self._parse(code)
        method = fs.symbols[0].children[0]
        assert method.is_async

    @_skip_no_python
    def test_parameters_extracted(self):
        code = "def func(a, b=10, *args, **kwargs):\n    pass\n"
        fs = self._parse(code)
        func = fs.symbols[0]
        param_names = [p.name for p in func.parameters]
        assert "a" in param_names
        assert "b" in param_names

    @_skip_no_python
    def test_return_type(self):
        code = "def greet(name: str) -> str:\n    return name\n"
        fs = self._parse(code)
        assert fs.symbols[0].return_type is not None

    @_skip_no_python
    def test_instance_vars(self):
        code = '''
class Obj:
    def __init__(self, x):
        self.x = x
        self.y = 0
'''
        fs = self._parse(code)
        cls = fs.symbols[0]
        assert "x" in cls.instance_vars
        assert "y" in cls.instance_vars

    @_skip_no_python
    def test_imports(self):
        code = "import os\nfrom pathlib import Path\nfrom . import sibling\n"
        fs = self._parse(code)
        assert len(fs.imports) >= 2
        # Check relative import
        rel = [i for i in fs.imports if i.level > 0]
        assert len(rel) >= 1

    @_skip_no_python
    def test_top_level_variables(self):
        code = "CONFIG = {}\nMY_VAR = 42\n_private = True\n"
        fs = self._parse(code)
        names = [s.name for s in fs.symbols]
        assert "CONFIG" in names
        assert "MY_VAR" in names
        assert "_private" not in names

    @_skip_no_python
    def test_call_sites(self):
        code = "def process():\n    validate()\n    save()\n"
        fs = self._parse(code)
        func = fs.symbols[0]
        call_names = [c.name for c in func.call_sites]
        assert "validate" in call_names
        assert "save" in call_names


# ── JavaScript Extractor ──────────────────────────────────────────

class TestJavaScriptExtractor:
    @pytest.fixture(autouse=True)
    def reset_parser(self):
        TreeSitterParser.reset()
        yield
        TreeSitterParser.reset()

    def _parse(self, source: str) -> FileSymbols:
        from ac_dc.symbol_index.extractors.javascript_extractor import JavaScriptExtractor
        parser = TreeSitterParser()
        src_bytes = source.encode("utf-8")
        tree = parser.parse(src_bytes, "javascript")
        ext = JavaScriptExtractor()
        return ext.extract(src_bytes, tree, "test.js")

    @_skip_no_js
    def test_class_with_extends(self):
        code = "class App extends Base {\n  render() { return null; }\n}\n"
        fs = self._parse(code)
        assert len(fs.symbols) >= 1
        cls = [s for s in fs.symbols if s.kind == "class"][0]
        assert cls.name == "App"
        assert "Base" in cls.bases

    @_skip_no_js
    def test_async_method(self):
        code = "class Svc {\n  async fetch(url) { return null; }\n}\n"
        fs = self._parse(code)
        method = fs.symbols[0].children[0]
        assert method.is_async

    @_skip_no_js
    def test_top_level_function_and_variable(self):
        code = "function helper() {}\nconst MAX = 100;\n"
        fs = self._parse(code)
        names = [s.name for s in fs.symbols]
        assert "helper" in names
        assert "MAX" in names

    @_skip_no_js
    def test_imports(self):
        code = "import { foo, bar } from './utils';\n"
        fs = self._parse(code)
        assert len(fs.imports) >= 1


# ── C Extractor ───────────────────────────────────────────────────

class TestCExtractor:
    @pytest.fixture(autouse=True)
    def reset_parser(self):
        TreeSitterParser.reset()
        yield
        TreeSitterParser.reset()

    def _parse(self, source: str) -> FileSymbols:
        from ac_dc.symbol_index.extractors.c_extractor import CExtractor
        parser = TreeSitterParser()
        src_bytes = source.encode("utf-8")
        tree = parser.parse(src_bytes, "c")
        ext = CExtractor()
        return ext.extract(src_bytes, tree, "test.c")

    @_skip_no_c
    def test_struct_as_class(self):
        code = "struct Point {\n    int x;\n    int y;\n};\n"
        fs = self._parse(code)
        assert any(s.kind == "class" and s.name == "Point" for s in fs.symbols)

    @_skip_no_c
    def test_function_with_params(self):
        code = "int add(int a, int b) {\n    return a + b;\n}\n"
        fs = self._parse(code)
        func = [s for s in fs.symbols if s.name == "add"]
        assert len(func) == 1
        assert len(func[0].parameters) == 2

    @_skip_no_c
    def test_include_as_import(self):
        code = '#include "myheader.h"\n#include <stdio.h>\n'
        fs = self._parse(code)
        assert len(fs.imports) >= 1


# ── MATLAB Extractor ──────────────────────────────────────────────

class TestMatlabExtractor:
    def _parse(self, source: str) -> FileSymbols:
        from ac_dc.symbol_index.extractors.matlab_extractor import MatlabExtractor
        ext = MatlabExtractor()
        return ext.extract(source.encode("utf-8"), None, "test.m")

    def test_classdef_with_bases(self):
        code = "classdef MyClass < Base1 & Base2\nend\n"
        fs = self._parse(code)
        cls = [s for s in fs.symbols if s.kind == "class"]
        assert len(cls) == 1
        assert cls[0].name == "MyClass"
        assert "Base1" in cls[0].bases
        assert "Base2" in cls[0].bases

    def test_function_with_outputs(self):
        code = "function [a, b] = myFunc(x, y)\n    a = x;\n    b = y;\nend\n"
        fs = self._parse(code)
        func = [s for s in fs.symbols if s.name == "myFunc"]
        assert len(func) == 1
        assert func[0].return_type == "a, b"
        assert len(func[0].parameters) == 2

    def test_method_inside_classdef(self):
        code = "classdef Foo\nfunction out = bar(obj)\n    out = 1;\nend\nend\n"
        fs = self._parse(code)
        cls = [s for s in fs.symbols if s.kind == "class"]
        assert len(cls) == 1
        methods = [c for c in cls[0].children if c.kind == "method"]
        assert any(m.name == "bar" for m in methods)

    def test_imports(self):
        code = "import pkg.Class\n"
        fs = self._parse(code)
        assert len(fs.imports) == 1

    def test_top_level_variables(self):
        code = "MY_VAR = 42\n_private = 1\n"
        fs = self._parse(code)
        names = [s.name for s in fs.symbols if s.kind == "variable"]
        assert "MY_VAR" in names
        assert "_private" not in names

    def test_call_sites(self):
        code = "function out = f(x)\n    out = helper(x);\nend\n"
        fs = self._parse(code)
        func = [s for s in fs.symbols if s.name == "f"][0]
        call_names = [c.name for c in func.call_sites]
        assert "helper" in call_names

    def test_tree_optional(self):
        from ac_dc.symbol_index.extractors.matlab_extractor import MatlabExtractor
        assert MatlabExtractor.tree_optional is True


# ── Symbol Cache ──────────────────────────────────────────────────

class TestSymbolCache:
    def test_put_get(self):
        cache = SymbolCache()
        fs = FileSymbols(file_path="test.py", symbols=[
            Symbol(name="Foo", kind="class", file_path="test.py"),
        ])
        cache.put("test.py", 1234.0, fs)
        result = cache.get("test.py", 1234.0)
        assert result is not None
        assert result.file_path == "test.py"

    def test_stale_mtime(self):
        cache = SymbolCache()
        fs = FileSymbols(file_path="test.py")
        cache.put("test.py", 1234.0, fs)
        assert cache.get("test.py", 9999.0) is None

    def test_invalidate(self):
        cache = SymbolCache()
        fs = FileSymbols(file_path="test.py")
        cache.put("test.py", 1234.0, fs)
        cache.invalidate("test.py")
        assert cache.get("test.py", 1234.0) is None

    def test_content_hash_deterministic(self):
        cache = SymbolCache()
        fs = FileSymbols(file_path="test.py", symbols=[
            Symbol(name="X", kind="class", file_path="test.py"),
        ])
        cache.put("test.py", 1.0, fs)
        h1 = cache.get_content_hash("test.py")
        cache.put("test.py", 1.0, fs)
        h2 = cache.get_content_hash("test.py")
        assert h1 == h2
        assert len(h1) == 16

    def test_content_hash_distinct(self):
        cache = SymbolCache()
        fs1 = FileSymbols(file_path="a.py", symbols=[
            Symbol(name="A", kind="class", file_path="a.py"),
        ])
        fs2 = FileSymbols(file_path="b.py", symbols=[
            Symbol(name="B", kind="function", file_path="b.py"),
        ])
        cache.put("a.py", 1.0, fs1)
        cache.put("b.py", 1.0, fs2)
        assert cache.get_content_hash("a.py") != cache.get_content_hash("b.py")

    def test_cached_files(self):
        cache = SymbolCache()
        cache.put("a.py", 1.0, FileSymbols(file_path="a.py"))
        cache.put("b.py", 1.0, FileSymbols(file_path="b.py"))
        assert cache.cached_files == {"a.py", "b.py"}


# ── Import Resolver ───────────────────────────────────────────────

class TestImportResolver:
    def test_python_absolute(self):
        files = {"foo/bar.py", "foo/__init__.py"}
        resolver = ImportResolver("/repo", files)
        imp = Import(module="foo.bar", names=["bar"], level=0)
        assert resolver.resolve(imp, "main.py") == "foo/bar.py"

    def test_python_package(self):
        files = {"foo/__init__.py"}
        resolver = ImportResolver("/repo", files)
        imp = Import(module="foo", names=["foo"], level=0)
        assert resolver.resolve(imp, "main.py") == "foo/__init__.py"

    def test_python_relative_level1(self):
        files = {"pkg/sibling.py"}
        resolver = ImportResolver("/repo", files)
        imp = Import(module="sibling", names=["sibling"], level=1)
        assert resolver.resolve(imp, "pkg/main.py") == "pkg/sibling.py"

    def test_python_relative_level2(self):
        files = {"pkg/parent.py"}
        resolver = ImportResolver("/repo", files)
        imp = Import(module="parent", names=["parent"], level=2)
        assert resolver.resolve(imp, "pkg/sub/main.py") == "pkg/parent.py"

    def test_js_relative(self):
        files = {"src/utils.js"}
        resolver = ImportResolver("/repo", files)
        imp = Import(module="./utils", names=[], level=0)
        assert resolver.resolve(imp, "src/main.js") == "src/utils.js"

    def test_js_index_file(self):
        files = {"src/utils/index.js"}
        resolver = ImportResolver("/repo", files)
        imp = Import(module="./utils", names=[], level=0)
        assert resolver.resolve(imp, "src/main.js") == "src/utils/index.js"

    def test_external_returns_none(self):
        files = {"src/main.py"}
        resolver = ImportResolver("/repo", files)
        imp = Import(module="requests", names=["get"], level=0)
        assert resolver.resolve(imp, "src/main.py") is None

    def test_c_include(self):
        files = {"include/header.h"}
        resolver = ImportResolver("/repo", files)
        imp = Import(module="header.h", names=["header.h"], level=0)
        assert resolver.resolve(imp, "src/main.c") == "include/header.h"


# ── Reference Index ───────────────────────────────────────────────

class TestReferenceIndex:
    def test_build_and_query(self):
        idx = ReferenceIndex()
        fs_a = FileSymbols(file_path="a.py", symbols=[
            Symbol(name="Foo", kind="class", file_path="a.py"),
        ])
        fs_b = FileSymbols(file_path="b.py", symbols=[
            Symbol(name="use_foo", kind="function", file_path="b.py",
                   call_sites=[CallSite(name="Foo", line=5)]),
        ])
        idx.build({"a.py": fs_a, "b.py": fs_b})
        refs = idx.references_to_symbol("Foo")
        assert len(refs) >= 1
        assert any(r["file"] == "b.py" for r in refs)

    def test_bidirectional_edges(self):
        idx = ReferenceIndex()
        fs_a = FileSymbols(file_path="a.py", symbols=[
            Symbol(name="A", kind="class", file_path="a.py",
                   call_sites=[CallSite(name="B", line=1)]),
        ])
        fs_b = FileSymbols(file_path="b.py", symbols=[
            Symbol(name="B", kind="class", file_path="b.py",
                   call_sites=[CallSite(name="A", line=1)]),
        ])
        idx.build({"a.py": fs_a, "b.py": fs_b})
        edges = idx.bidirectional_edges()
        assert len(edges) == 1

    def test_connected_components(self):
        idx = ReferenceIndex()
        fs_a = FileSymbols(file_path="a.py", symbols=[
            Symbol(name="A", kind="class", file_path="a.py",
                   call_sites=[CallSite(name="B", line=1)]),
        ])
        fs_b = FileSymbols(file_path="b.py", symbols=[
            Symbol(name="B", kind="class", file_path="b.py",
                   call_sites=[CallSite(name="A", line=1)]),
        ])
        fs_c = FileSymbols(file_path="c.py", symbols=[
            Symbol(name="C", kind="class", file_path="c.py"),
        ])
        idx.build({"a.py": fs_a, "b.py": fs_b, "c.py": fs_c})
        comps = idx.connected_components()
        assert len(comps) == 1  # Only a<->b are bidirectional
        assert set(comps[0]) == {"a.py", "b.py"}

    def test_file_ref_count(self):
        idx = ReferenceIndex()
        fs_a = FileSymbols(file_path="a.py", symbols=[
            Symbol(name="SharedUtil", kind="function", file_path="a.py"),
        ])
        fs_b = FileSymbols(file_path="b.py", symbols=[
            Symbol(name="use_b", kind="function", file_path="b.py",
                   call_sites=[CallSite(name="SharedUtil", line=1)]),
        ])
        fs_c = FileSymbols(file_path="c.py", symbols=[
            Symbol(name="use_c", kind="function", file_path="c.py",
                   call_sites=[CallSite(name="SharedUtil", line=1)]),
        ])
        idx.build({"a.py": fs_a, "b.py": fs_b, "c.py": fs_c})
        assert idx.file_ref_count("a.py") == 2


# ── Compact Formatter ─────────────────────────────────────────────

class TestCompactFormatter:
    def test_format_includes_class_method(self):
        fmt = CompactFormatter(include_lines=False)
        fs = FileSymbols(file_path="app.py", symbols=[
            Symbol(name="App", kind="class", file_path="app.py", children=[
                Symbol(name="run", kind="method", file_path="app.py"),
            ]),
        ])
        output = fmt.format_file("app.py", fs)
        assert "c App" in output
        assert "m run" in output

    def test_legend_present(self):
        fmt = CompactFormatter(include_lines=False)
        legend = fmt.get_legend()
        assert "c=class" in legend
        assert "m=method" in legend

    def test_imports_formatted(self):
        fmt = CompactFormatter()
        fs = FileSymbols(file_path="test.py", imports=[
            Import(module="os", names=["os"], level=0),
            Import(module="sibling", names=["sibling"], level=1),
        ])
        output = fmt.format_file("test.py", fs)
        assert "i " in output
        assert "i→" in output

    def test_instance_vars_listed(self):
        fmt = CompactFormatter()
        fs = FileSymbols(file_path="test.py", symbols=[
            Symbol(name="Obj", kind="class", file_path="test.py",
                   instance_vars=["x", "y"]),
        ])
        output = fmt.format_file("test.py", fs)
        assert "v x" in output
        assert "v y" in output

    def test_exclude_files(self):
        fmt = CompactFormatter()
        syms = {
            "a.py": FileSymbols(file_path="a.py", symbols=[
                Symbol(name="A", kind="class", file_path="a.py"),
            ]),
            "b.py": FileSymbols(file_path="b.py", symbols=[
                Symbol(name="B", kind="class", file_path="b.py"),
            ]),
        }
        output = fmt.format_map(syms, exclude_files={"b.py"})
        assert "A" in output
        assert "B" not in output

    def test_test_files_collapsed(self):
        fmt = CompactFormatter()
        syms = {
            "tests/test_foo.py": FileSymbols(file_path="tests/test_foo.py", symbols=[
                Symbol(name="TestFoo", kind="class", file_path="tests/test_foo.py", children=[
                    Symbol(name="test_a", kind="method", file_path="tests/test_foo.py"),
                    Symbol(name="test_b", kind="method", file_path="tests/test_foo.py"),
                ]),
            ]),
        }
        output = fmt.format_map(syms)
        assert "1c/2m" in output

    def test_chunks_split(self):
        fmt = CompactFormatter()
        syms = {f"file{i}.py": FileSymbols(file_path=f"file{i}.py", symbols=[
            Symbol(name=f"Cls{i}", kind="class", file_path=f"file{i}.py"),
        ]) for i in range(8)}
        chunks = fmt.format_chunks(syms, num_chunks=4)
        assert len(chunks) >= 2
        total = sum(chunk.count("c Cls") for chunk in chunks)
        assert total == 8

    def test_async_prefix(self):
        fmt = CompactFormatter()
        fs = FileSymbols(file_path="test.py", symbols=[
            Symbol(name="fetch", kind="function", file_path="test.py", is_async=True),
        ])
        output = fmt.format_file("test.py", fs)
        assert "af fetch" in output

    def test_path_aliases(self):
        fmt = CompactFormatter()
        syms = {f"long/prefix/{i}.py": FileSymbols(
            file_path=f"long/prefix/{i}.py", symbols=[
                Symbol(name=f"C{i}", kind="class", file_path=f"long/prefix/{i}.py"),
            ]
        ) for i in range(5)}
        output = fmt.format_map(syms)
        assert "@1/" in output

    def test_lsp_legend_includes_line_numbers(self):
        fmt = CompactFormatter(include_lines=True)
        legend = fmt.get_legend()
        assert ":N=line(s)" in legend

    def test_context_legend_omits_line_numbers(self):
        fmt = CompactFormatter(include_lines=False)
        legend = fmt.get_legend()
        assert ":N=line(s)" not in legend

    def test_lsp_mode_has_line_numbers(self):
        fmt = CompactFormatter(include_lines=True)
        fs = FileSymbols(file_path="test.py", symbols=[
            Symbol(name="Foo", kind="class", file_path="test.py",
                   range={"start_line": 10, "start_col": 0,
                          "end_line": 20, "end_col": 0}),
        ])
        output = fmt.format_file("test.py", fs)
        assert ":10" in output

    def test_context_mode_no_line_numbers(self):
        fmt = CompactFormatter(include_lines=False)
        fs = FileSymbols(file_path="test.py", symbols=[
            Symbol(name="Foo", kind="class", file_path="test.py",
                   range={"start_line": 10, "start_col": 0,
                          "end_line": 20, "end_col": 0}),
        ])
        output = fmt.format_file("test.py", fs)
        assert ":10" not in output


# ── Integration ───────────────────────────────────────────────────

class TestSymbolIndexIntegration:
    @pytest.fixture(autouse=True)
    def reset_parser(self):
        TreeSitterParser.reset()
        yield
        TreeSitterParser.reset()

    @_skip_no_python
    def test_index_repo(self, tmp_repo_with_files):
        from ac_dc.symbol_index.index import SymbolIndex
        idx = SymbolIndex(tmp_repo_with_files)
        result = idx.index_repo()
        # Should have indexed the Python files
        assert any("main.py" in p for p in result)

    @_skip_no_python
    def test_symbol_map_output(self, tmp_repo_with_files):
        from ac_dc.symbol_index.index import SymbolIndex
        idx = SymbolIndex(tmp_repo_with_files)
        idx.index_repo()
        output = idx.get_symbol_map()
        assert "main" in output or "helper" in output

    @_skip_no_python
    def test_exclude_active_files(self, tmp_repo_with_files):
        from ac_dc.symbol_index.index import SymbolIndex
        idx = SymbolIndex(tmp_repo_with_files)
        idx.index_repo()
        full = idx.get_symbol_map()
        excluded = idx.get_symbol_map(exclude_files={"src/main.py"})
        assert len(excluded) <= len(full)

    @_skip_no_python
    def test_reindex_picks_up_changes(self, tmp_repo_with_files):
        from ac_dc.symbol_index.index import SymbolIndex
        idx = SymbolIndex(tmp_repo_with_files)
        idx.index_repo()

        # Modify file
        (tmp_repo_with_files / "src" / "main.py").write_text(
            "def main():\n    pass\n\ndef new_func():\n    pass\n"
        )
        idx.invalidate_file("src/main.py")
        idx.index_file("src/main.py")
        output = idx.get_symbol_map()
        assert "new_func" in output

    @_skip_no_python
    def test_hover_info(self, tmp_repo_with_files):
        from ac_dc.symbol_index.index import SymbolIndex
        idx = SymbolIndex(tmp_repo_with_files)
        idx.index_repo()
        result = idx.lsp_get_hover("src/main.py", 1, 0)
        if result:
            assert "main" in result["contents"]

    @_skip_no_python
    def test_completions_filtered(self, tmp_repo_with_files):
        from ac_dc.symbol_index.index import SymbolIndex
        idx = SymbolIndex(tmp_repo_with_files)
        idx.index_repo()
        result = idx.lsp_get_completions("src/main.py", 1, 0, prefix="mai")
        if result:
            assert any("main" in c["label"] for c in result)

    @_skip_no_python
    def test_signature_hash_stable(self, tmp_repo_with_files):
        from ac_dc.symbol_index.index import SymbolIndex
        idx = SymbolIndex(tmp_repo_with_files)
        idx.index_repo()
        h1 = idx.cache.get_content_hash("src/main.py")
        # Re-index same content
        idx.invalidate_file("src/main.py")
        idx.index_file("src/main.py")
        h2 = idx.cache.get_content_hash("src/main.py")
        assert h1 == h2
        assert h1 is not None
        assert len(h1) == 16

    @_skip_no_python
    def test_context_shorter_than_lsp(self, tmp_repo_with_files):
        from ac_dc.symbol_index.index import SymbolIndex
        idx = SymbolIndex(tmp_repo_with_files)
        idx.index_repo()
        ctx = idx.get_symbol_map()
        lsp = idx.get_lsp_symbol_map()
        assert len(ctx) <= len(lsp)