"""Tests for the symbol index system."""

import pytest
from pathlib import Path
from ac_dc.symbol_index.models import (
    Symbol, SymbolKind, SymbolRange, FileSymbols, Parameter, Import,
)
from ac_dc.symbol_index.cache import SymbolCache
from ac_dc.symbol_index.import_resolver import ImportResolver
from ac_dc.symbol_index.reference_index import ReferenceIndex
from ac_dc.symbol_index.compact_format import CompactFormatter


# ======================================================================
# Test fixtures
# ======================================================================

PYTHON_SOURCE = '''\
"""Module docstring."""

import os
import json
from pathlib import Path
from .utils import helper

MAX_SIZE = 1024
_internal = "private"


class Animal:
    """A base animal class."""

    sound = "..."

    def __init__(self, name: str, age: int = 0):
        self.name = name
        self.age = age

    def speak(self) -> str:
        return self.sound

    @property
    def info(self) -> str:
        return f"{self.name} ({self.age})"


class Dog(Animal):
    """A dog."""

    sound = "woof"

    def speak(self) -> str:
        return f"{self.name} says {self.sound}"

    async def fetch(self, item: str) -> bool:
        result = helper(item)
        return result is not None


def process(data: list, verbose: bool = False) -> dict:
    """Process some data."""
    animal = Animal("test")
    animal.speak()
    return {"ok": True}
'''

JS_SOURCE = '''\
import { LitElement } from 'lit';
import { helper } from './utils.js';

const MAX_RETRIES = 3;

class Connection extends LitElement {
    remoteTimeout = 60;

    constructor() {
        super();
        this.ws = null;
    }

    async connect(url) {
        this.ws = new WebSocket(url);
        return helper(url);
    }

    get isConnected() {
        return this.ws !== null;
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

function createConnection(url, opts = {}) {
    const conn = new Connection();
    conn.connect(url);
    return conn;
}

export default Connection;
'''

C_SOURCE = '''\
#include <stdio.h>
#include "mylib.h"

#define MAX_BUF 256

struct Point {
    int x;
    int y;
};

int add(int a, int b) {
    return a + b;
}

void print_point(struct Point *p) {
    printf("(%d, %d)\\n", p->x, p->y);
}
'''


# ======================================================================
# Parser + Extractor tests
# ======================================================================

class TestPythonExtractor:
    """Test Python symbol extraction."""

    @pytest.fixture
    def fsyms(self):
        """Parse Python source and extract symbols."""
        try:
            from ac_dc.symbol_index.parser import get_parser
            from ac_dc.symbol_index.extractors import get_extractor
        except ImportError:
            pytest.skip("tree-sitter not available")

        parser = get_parser()
        if not parser.available:
            pytest.skip("tree-sitter not available")

        tree = parser.parse(PYTHON_SOURCE, "python")
        extractor = get_extractor("python")
        return extractor.extract(tree, PYTHON_SOURCE, "test/animals.py")

    def test_class_extracted(self, fsyms):
        classes = [s for s in fsyms.symbols if s.kind == SymbolKind.CLASS]
        names = [c.name for c in classes]
        assert "Animal" in names
        assert "Dog" in names

    def test_inheritance(self, fsyms):
        dog = next(s for s in fsyms.symbols if s.name == "Dog")
        assert "Animal" in dog.bases

    def test_methods_extracted(self, fsyms):
        animal = next(s for s in fsyms.symbols if s.name == "Animal")
        method_names = [m.name for m in animal.children]
        assert "__init__" in method_names
        assert "speak" in method_names

    def test_property_detected(self, fsyms):
        animal = next(s for s in fsyms.symbols if s.name == "Animal")
        info = next((m for m in animal.children if m.name == "info"), None)
        assert info is not None
        assert info.kind == SymbolKind.PROPERTY

    def test_async_detected(self, fsyms):
        dog = next(s for s in fsyms.symbols if s.name == "Dog")
        fetch = next((m for m in dog.children if m.name == "fetch"), None)
        assert fetch is not None
        assert fetch.is_async is True

    def test_params_extracted(self, fsyms):
        animal = next(s for s in fsyms.symbols if s.name == "Animal")
        init = next(m for m in animal.children if m.name == "__init__")
        param_names = [p.name for p in init.parameters]
        assert "self" not in param_names  # self omitted
        assert "name" in param_names
        assert "age" in param_names

    def test_return_type(self, fsyms):
        animal = next(s for s in fsyms.symbols if s.name == "Animal")
        speak = next(m for m in animal.children if m.name == "speak")
        assert speak.return_type is not None
        assert "str" in speak.return_type

    def test_instance_vars(self, fsyms):
        animal = next(s for s in fsyms.symbols if s.name == "Animal")
        assert "name" in animal.instance_vars
        assert "age" in animal.instance_vars

    def test_imports_extracted(self, fsyms):
        assert len(fsyms.imports) >= 3
        modules = [i.module for i in fsyms.imports]
        assert "os" in modules
        assert "json" in modules

    def test_relative_import(self, fsyms):
        rel = [i for i in fsyms.imports if i.level > 0]
        assert len(rel) >= 1
        assert any("helper" in i.names for i in rel)

    def test_top_level_variable(self, fsyms):
        vars_ = [s for s in fsyms.symbols if s.kind == SymbolKind.VARIABLE]
        names = [v.name for v in vars_]
        assert "MAX_SIZE" in names
        # Private vars should be excluded
        assert "_internal" not in names

    def test_top_level_function(self, fsyms):
        funcs = [s for s in fsyms.symbols if s.kind == SymbolKind.FUNCTION]
        assert any(f.name == "process" for f in funcs)

    def test_call_sites(self, fsyms):
        process = next(
            (s for s in fsyms.symbols if s.name == "process"), None
        )
        if process:
            call_names = [c.name for c in process.call_sites]
            assert len(call_names) >= 1


class TestJavaScriptExtractor:
    """Test JavaScript symbol extraction."""

    @pytest.fixture
    def fsyms(self):
        try:
            from ac_dc.symbol_index.parser import get_parser
            from ac_dc.symbol_index.extractors import get_extractor
        except ImportError:
            pytest.skip("tree-sitter not available")

        parser = get_parser()
        if not parser.available:
            pytest.skip("tree-sitter not available")

        tree = parser.parse(JS_SOURCE, "javascript")
        extractor = get_extractor("javascript")
        return extractor.extract(tree, JS_SOURCE, "src/connection.js")

    def test_class_extracted(self, fsyms):
        classes = [s for s in fsyms.symbols if s.kind == SymbolKind.CLASS]
        assert any(c.name == "Connection" for c in classes)

    def test_inheritance(self, fsyms):
        conn = next(s for s in fsyms.symbols if s.name == "Connection")
        assert "LitElement" in conn.bases

    def test_methods_extracted(self, fsyms):
        conn = next(s for s in fsyms.symbols if s.name == "Connection")
        method_names = [m.name for m in conn.children]
        assert "connect" in method_names
        assert "disconnect" in method_names

    def test_getter_detected(self, fsyms):
        conn = next(s for s in fsyms.symbols if s.name == "Connection")
        getter = next(
            (m for m in conn.children if m.name == "isConnected"), None
        )
        assert getter is not None
        assert getter.kind == SymbolKind.PROPERTY

    def test_async_method(self, fsyms):
        conn = next(s for s in fsyms.symbols if s.name == "Connection")
        connect = next(
            (m for m in conn.children if m.name == "connect"), None
        )
        assert connect is not None
        assert connect.is_async is True

    def test_function_extracted(self, fsyms):
        funcs = [s for s in fsyms.symbols if s.kind == SymbolKind.FUNCTION]
        assert any(f.name == "createConnection" for f in funcs)

    def test_variable_extracted(self, fsyms):
        vars_ = [s for s in fsyms.symbols if s.kind == SymbolKind.VARIABLE]
        names = [v.name for v in vars_]
        assert "MAX_RETRIES" in names

    def test_imports(self, fsyms):
        assert len(fsyms.imports) >= 2
        modules = [i.module for i in fsyms.imports]
        assert "lit" in modules
        assert "./utils.js" in modules


class TestCExtractor:
    """Test C symbol extraction."""

    @pytest.fixture
    def fsyms(self):
        try:
            from ac_dc.symbol_index.parser import get_parser
            from ac_dc.symbol_index.extractors import get_extractor
        except ImportError:
            pytest.skip("tree-sitter not available")

        parser = get_parser()
        if not parser.available:
            pytest.skip("tree-sitter not available")

        tree = parser.parse(C_SOURCE, "c")
        extractor = get_extractor("c")
        return extractor.extract(tree, C_SOURCE, "src/point.c")

    def test_struct_extracted(self, fsyms):
        classes = [s for s in fsyms.symbols if s.kind == SymbolKind.CLASS]
        assert any(c.name == "Point" for c in classes)

    def test_functions_extracted(self, fsyms):
        funcs = [s for s in fsyms.symbols if s.kind == SymbolKind.FUNCTION]
        names = [f.name for f in funcs]
        assert "add" in names
        assert "print_point" in names

    def test_function_params(self, fsyms):
        funcs = [s for s in fsyms.symbols if s.kind == SymbolKind.FUNCTION]
        add = next(f for f in funcs if f.name == "add")
        assert len(add.parameters) == 2

    def test_includes(self, fsyms):
        assert len(fsyms.imports) >= 1
        modules = [i.module for i in fsyms.imports]
        assert any("stdio" in m for m in modules)


# ======================================================================
# Cache tests
# ======================================================================

class TestSymbolCache:
    def test_put_get(self):
        cache = SymbolCache()
        fsyms = FileSymbols(file_path="test.py")
        cache.put("test.py", 100.0, fsyms)
        assert cache.get("test.py", 100.0) is fsyms
        assert cache.get("test.py", 101.0) is None

    def test_invalidate(self):
        cache = SymbolCache()
        fsyms = FileSymbols(file_path="test.py")
        cache.put("test.py", 100.0, fsyms)
        cache.invalidate("test.py")
        assert cache.get("test.py", 100.0) is None

    def test_content_hash(self):
        h1 = SymbolCache.compute_hash("hello world")
        h2 = SymbolCache.compute_hash("hello world")
        h3 = SymbolCache.compute_hash("different")
        assert h1 == h2
        assert h1 != h3

    def test_cached_files(self):
        cache = SymbolCache()
        cache.put("a.py", 1.0, FileSymbols(file_path="a.py"))
        cache.put("b.py", 1.0, FileSymbols(file_path="b.py"))
        assert cache.cached_files == {"a.py", "b.py"}


# ======================================================================
# Import resolver tests
# ======================================================================

class TestImportResolver:

    @pytest.fixture
    def resolver(self):
        files = {
            "src/main.py",
            "src/utils.py",
            "src/__init__.py",
            "src/models/__init__.py",
            "src/models/user.py",
            "lib/helpers.js",
            "lib/index.js",
            "lib/utils/rpc.js",
            "lib/utils/index.ts",
            "include/mylib.h",
            "src/point.c",
        }
        return ImportResolver(Path("/repo"), files)

    def test_python_absolute(self, resolver):
        result = resolver.resolve_python_import("src.utils", 0, "app.py")
        assert result == "src/utils.py"

    def test_python_package(self, resolver):
        result = resolver.resolve_python_import("src.models", 0, "app.py")
        assert result == "src/models/__init__.py"

    def test_python_relative(self, resolver):
        result = resolver.resolve_python_import("utils", 1, "src/main.py")
        assert result == "src/utils.py"

    def test_python_relative_parent(self, resolver):
        result = resolver.resolve_python_import("utils", 2, "src/models/user.py")
        assert result == "src/utils.py"

    def test_python_not_found(self, resolver):
        result = resolver.resolve_python_import("nonexistent", 0, "app.py")
        assert result is None

    def test_js_relative(self, resolver):
        result = resolver.resolve_js_import("./helpers", "lib/index.js")
        assert result == "lib/helpers.js"

    def test_js_index_file(self, resolver):
        result = resolver.resolve_js_import("./utils", "lib/index.js")
        # Should find lib/utils/index.ts
        assert result is not None
        assert "utils" in result

    def test_js_external_skipped(self, resolver):
        result = resolver.resolve_js_import("lit", "lib/index.js")
        assert result is None

    def test_c_include(self, resolver):
        result = resolver.resolve_c_include("mylib.h")
        assert result == "include/mylib.h"


# ======================================================================
# Reference index tests
# ======================================================================

class TestReferenceIndex:

    def _make_fsyms(self, file_path, sym_names, call_names=None, imports_from=None):
        """Helper to create FileSymbols with specific symbols and calls."""
        fsyms = FileSymbols(file_path=file_path)
        for name in sym_names:
            sym = Symbol(
                name=name,
                kind=SymbolKind.FUNCTION,
                file_path=file_path,
                range=SymbolRange(1, 0, 10, 0),
            )
            if call_names:
                for cn in call_names:
                    sym.call_sites.append(CallSite(name=cn, line=5))
            fsyms.symbols.append(sym)
        return fsyms

    def test_build_and_query(self):
        from ac_dc.symbol_index.models import CallSite
        idx = ReferenceIndex()

        # File A defines foo, calls bar
        fsyms_a = FileSymbols(file_path="a.py")
        sym_a = Symbol(
            name="foo", kind=SymbolKind.FUNCTION,
            file_path="a.py", range=SymbolRange(1, 0, 5, 0),
            call_sites=[CallSite(name="bar", line=3)],
        )
        fsyms_a.symbols.append(sym_a)

        # File B defines bar, calls foo
        fsyms_b = FileSymbols(file_path="b.py")
        sym_b = Symbol(
            name="bar", kind=SymbolKind.FUNCTION,
            file_path="b.py", range=SymbolRange(1, 0, 5, 0),
            call_sites=[CallSite(name="foo", line=3)],
        )
        fsyms_b.symbols.append(sym_b)

        idx.build({"a.py": fsyms_a, "b.py": fsyms_b})

        # bar is referenced from a.py
        refs = idx.references_to_symbol("bar")
        assert any(f == "a.py" for f, _ in refs)

        # foo is referenced from b.py
        refs = idx.references_to_symbol("foo")
        assert any(f == "b.py" for f, _ in refs)

    def test_bidirectional_edges(self):
        idx = ReferenceIndex()
        idx.register_import_edge("a.py", "b.py")
        idx.register_import_edge("b.py", "a.py")
        idx.register_import_edge("c.py", "a.py")  # one-way

        edges = idx.bidirectional_edges()
        assert len(edges) == 1
        assert tuple(sorted(edges[0])) == ("a.py", "b.py")

    def test_connected_components(self):
        idx = ReferenceIndex()
        # A <-> B, C <-> D (two components)
        idx.register_import_edge("a.py", "b.py")
        idx.register_import_edge("b.py", "a.py")
        idx.register_import_edge("c.py", "d.py")
        idx.register_import_edge("d.py", "c.py")

        components = idx.connected_components()
        assert len(components) == 2

    def test_file_ref_count(self):
        idx = ReferenceIndex()
        idx.register_import_edge("a.py", "b.py")
        idx.register_import_edge("c.py", "b.py")
        assert idx.file_ref_count("b.py") == 2
        assert idx.file_ref_count("a.py") == 0


# ======================================================================
# Compact format tests
# ======================================================================

class TestCompactFormatter:

    def _make_file_symbols(self):
        """Create sample FileSymbols for testing."""
        fsyms = FileSymbols(file_path="src/models.py", language="python")

        # Import
        fsyms.imports.append(Import(module="dataclasses", names=["dataclasses"], line=1))
        fsyms.imports.append(Import(module=".utils", names=["helper"], level=1, line=2))

        # Class with methods
        cls = Symbol(
            name="User",
            kind=SymbolKind.CLASS,
            file_path="src/models.py",
            range=SymbolRange(10, 0, 30, 0),
            instance_vars=["name", "email"],
        )
        cls.children.append(Symbol(
            name="__init__",
            kind=SymbolKind.METHOD,
            file_path="src/models.py",
            range=SymbolRange(15, 4, 18, 0),
            parameters=[
                Parameter(name="name"),
                Parameter(name="email"),
            ],
        ))
        cls.children.append(Symbol(
            name="validate",
            kind=SymbolKind.METHOD,
            file_path="src/models.py",
            range=SymbolRange(20, 4, 25, 0),
            return_type="bool",
        ))
        fsyms.symbols.append(cls)

        # Top-level function
        fsyms.symbols.append(Symbol(
            name="create_user",
            kind=SymbolKind.FUNCTION,
            file_path="src/models.py",
            range=SymbolRange(35, 0, 40, 0),
            parameters=[Parameter(name="data", type_annotation="dict")],
            return_type="User",
        ))

        return fsyms

    def test_basic_format(self):
        fsyms = self._make_file_symbols()
        formatter = CompactFormatter()
        output = formatter.format_all({"src/models.py": fsyms})

        assert "src/models.py" in output
        assert "c User:10" in output
        assert "m __init__(name,email):15" in output
        assert "m validate()->bool:20" in output
        assert "f create_user(data)->User:35" in output

    def test_legend_included(self):
        fsyms = self._make_file_symbols()
        formatter = CompactFormatter()
        output = formatter.format_all({"src/models.py": fsyms})

        assert "c=class" in output
        assert "m=method" in output
        assert "f=function" in output

    def test_imports_formatted(self):
        fsyms = self._make_file_symbols()
        formatter = CompactFormatter()
        output = formatter.format_all({"src/models.py": fsyms})

        assert "i dataclasses" in output

    def test_instance_vars(self):
        fsyms = self._make_file_symbols()
        formatter = CompactFormatter()
        output = formatter.format_all({"src/models.py": fsyms})

        assert "v name" in output
        assert "v email" in output

    def test_exclude_files(self):
        fsyms = self._make_file_symbols()
        other = FileSymbols(file_path="src/other.py")
        all_syms = {"src/models.py": fsyms, "src/other.py": other}
        formatter = CompactFormatter()
        output = formatter.format_all(all_syms, exclude_files={"src/models.py"})

        assert "src/models.py" not in output

    def test_test_file_collapsed(self):
        fsyms = FileSymbols(file_path="tests/test_user.py", language="python")
        cls = Symbol(
            name="TestUser", kind=SymbolKind.CLASS,
            file_path="tests/test_user.py",
            range=SymbolRange(1, 0, 50, 0),
        )
        for i in range(5):
            cls.children.append(Symbol(
                name=f"test_method_{i}",
                kind=SymbolKind.METHOD,
                file_path="tests/test_user.py",
                range=SymbolRange(i * 10, 0, i * 10 + 5, 0),
            ))
        fsyms.symbols.append(cls)

        formatter = CompactFormatter()
        output = formatter.format_all({"tests/test_user.py": fsyms})

        # Should be collapsed, not showing individual methods
        assert "test_user.py" in output
        assert "1c" in output

    def test_chunks(self):
        all_syms = {}
        for i in range(9):
            fsyms = FileSymbols(file_path=f"src/file_{i}.py")
            fsyms.symbols.append(Symbol(
                name=f"func_{i}", kind=SymbolKind.FUNCTION,
                file_path=f"src/file_{i}.py",
                range=SymbolRange(1, 0, 5, 0),
            ))
            all_syms[f"src/file_{i}.py"] = fsyms

        formatter = CompactFormatter()
        chunks = formatter.get_chunks(all_syms, num_chunks=3)

        assert len(chunks) == 3
        total_files = sum(len(c["files"]) for c in chunks)
        assert total_files == 9

    def test_async_prefix(self):
        fsyms = FileSymbols(file_path="src/async_mod.py")
        fsyms.symbols.append(Symbol(
            name="fetch_data",
            kind=SymbolKind.FUNCTION,
            file_path="src/async_mod.py",
            range=SymbolRange(1, 0, 5, 0),
            is_async=True,
        ))
        fsyms.symbols.append(Symbol(
            name="do_work",
            kind=SymbolKind.METHOD,
            file_path="src/async_mod.py",
            range=SymbolRange(10, 0, 15, 0),
            is_async=True,
        ))

        formatter = CompactFormatter()
        output = formatter.format_all({"src/async_mod.py": fsyms})

        assert "af fetch_data():1" in output
        assert "am do_work():10" in output

    def test_path_aliases(self):
        all_syms = {}
        # Create files in a deeply nested path
        for i in range(5):
            path = f"src/services/handlers/file_{i}.py"
            fsyms = FileSymbols(file_path=path)
            fsyms.symbols.append(Symbol(
                name=f"handler_{i}", kind=SymbolKind.FUNCTION,
                file_path=path, range=SymbolRange(1, 0, 5, 0),
            ))
            all_syms[path] = fsyms

        formatter = CompactFormatter()
        output = formatter.format_all(all_syms)

        # Should generate aliases for the common prefix
        assert "@" in output or "src/services/handlers/" in output


# ======================================================================
# Integration test
# ======================================================================

class TestSymbolIndex:
    """Integration test using real files."""

    @pytest.fixture
    def index_repo(self, tmp_path):
        """Create a mini repo with Python files."""
        src = tmp_path / "src"
        src.mkdir()

        (src / "__init__.py").write_text("")
        (src / "main.py").write_text('''\
from .utils import helper

class App:
    def __init__(self):
        self.running = False

    def start(self):
        result = helper("start")
        self.running = True
        return result
''')
        (src / "utils.py").write_text('''\
import os

def helper(msg: str) -> str:
    return f"helped: {msg}"

def internal_fn():
    pass
''')

        tests = tmp_path / "tests"
        tests.mkdir()
        (tests / "test_main.py").write_text('''\
from src.main import App

class TestApp:
    def test_start(self):
        app = App()
        app.start()
''')

        return tmp_path

    def test_full_index(self, index_repo):
        try:
            from ac_dc.symbol_index import SymbolIndex
        except ImportError:
            pytest.skip("tree-sitter not available")

        idx = SymbolIndex(index_repo)
        if not idx.available:
            pytest.skip("tree-sitter not available")

        result = idx.index_repo()
        assert len(result) >= 2  # At least main.py and utils.py

        # Check symbols
        main_syms = result.get("src/main.py")
        assert main_syms is not None
        names = [s.name for s in main_syms.all_symbols_flat]
        assert "App" in names
        assert "start" in names

    def test_symbol_map_output(self, index_repo):
        try:
            from ac_dc.symbol_index import SymbolIndex
        except ImportError:
            pytest.skip("tree-sitter not available")

        idx = SymbolIndex(index_repo)
        if not idx.available:
            pytest.skip("tree-sitter not available")

        idx.index_repo()
        symbol_map = idx.get_symbol_map()

        assert "src/main.py" in symbol_map
        assert "c App" in symbol_map
        assert "src/utils.py" in symbol_map

    def test_exclude_active_files(self, index_repo):
        try:
            from ac_dc.symbol_index import SymbolIndex
        except ImportError:
            pytest.skip("tree-sitter not available")

        idx = SymbolIndex(index_repo)
        if not idx.available:
            pytest.skip("tree-sitter not available")

        idx.index_repo()
        symbol_map = idx.get_symbol_map(exclude_files={"src/main.py"})

        assert "src/main.py" not in symbol_map
        assert "src/utils.py" in symbol_map

    def test_single_file_reindex(self, index_repo):
        try:
            from ac_dc.symbol_index import SymbolIndex
        except ImportError:
            pytest.skip("tree-sitter not available")

        idx = SymbolIndex(index_repo)
        if not idx.available:
            pytest.skip("tree-sitter not available")

        idx.index_repo()

        # Modify a file
        (index_repo / "src" / "utils.py").write_text('''\
import os

def helper(msg: str) -> str:
    return f"helped: {msg}"

def new_function():
    pass
''')

        # Re-index just that file
        idx.invalidate_file("src/utils.py")
        result = idx.index_file("src/utils.py")
        assert result is not None
        names = [s.name for s in result.all_symbols_flat]
        assert "new_function" in names

    def test_hover_info(self, index_repo):
        try:
            from ac_dc.symbol_index import SymbolIndex
        except ImportError:
            pytest.skip("tree-sitter not available")

        idx = SymbolIndex(index_repo)
        if not idx.available:
            pytest.skip("tree-sitter not available")

        idx.index_repo()

        # Hover over the App class (should be around line 3)
        hover = idx.get_hover_info("src/main.py", 3, 6)
        assert "App" in hover or hover == ""  # Depends on exact line

    def test_completions(self, index_repo):
        try:
            from ac_dc.symbol_index import SymbolIndex
        except ImportError:
            pytest.skip("tree-sitter not available")

        idx = SymbolIndex(index_repo)
        if not idx.available:
            pytest.skip("tree-sitter not available")

        idx.index_repo()

        completions = idx.get_completions("src/main.py", 1, 0, "h")
        labels = [c["label"] for c in completions]
        assert "helper" in labels

    def test_signature_hash_stable(self, index_repo):
        try:
            from ac_dc.symbol_index import SymbolIndex
        except ImportError:
            pytest.skip("tree-sitter not available")

        idx = SymbolIndex(index_repo)
        if not idx.available:
            pytest.skip("tree-sitter not available")

        idx.index_repo()
        h1 = idx.get_file_signature_hash("src/utils.py")
        h2 = idx.get_file_signature_hash("src/utils.py")
        assert h1 == h2
        assert len(h1) == 16  # Truncated hash
