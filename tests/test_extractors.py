"""Tests for symbol extractors."""

import pytest
from ac.symbol_index.extractors import get_extractor, PythonExtractor, JavaScriptExtractor
from ac.symbol_index.extractors.base import BaseExtractor
from ac.symbol_index.parser import get_parser


class TestGetExtractor:
    def test_get_python_extractor(self):
        extractor = get_extractor('python')
        assert isinstance(extractor, PythonExtractor)
        assert isinstance(extractor, BaseExtractor)
    
    def test_get_javascript_extractor(self):
        extractor = get_extractor('javascript')
        assert isinstance(extractor, JavaScriptExtractor)
        assert isinstance(extractor, BaseExtractor)
    
    def test_get_typescript_extractor(self):
        extractor = get_extractor('typescript')
        assert isinstance(extractor, JavaScriptExtractor)
    
    def test_get_unknown_extractor_raises(self):
        with pytest.raises(ValueError):
            get_extractor('unknown_language')


class TestBaseExtractorMethods:
    """Test that base extractor methods work correctly when inherited."""
    
    def test_python_make_range(self):
        """Test _make_range produces correct Range objects."""
        extractor = PythonExtractor()
        parser = get_parser()
        
        code = b"def foo():\n    pass"
        tree, lang = parser.parse_file("test.py", code)
        
        # Find the function node
        func_node = tree.root_node.children[0]
        assert func_node.type == 'function_definition'
        
        range_obj = extractor._make_range(func_node)
        assert range_obj.start_line == 1
        assert range_obj.start_col == 0
        assert range_obj.end_line == 2
    
    def test_javascript_make_range(self):
        """Test _make_range works for JavaScript extractor."""
        extractor = JavaScriptExtractor()
        parser = get_parser()
        
        code = b"function foo() {\n  return 1;\n}"
        tree, lang = parser.parse_file("test.js", code)
        
        func_node = tree.root_node.children[0]
        assert func_node.type == 'function_declaration'
        
        range_obj = extractor._make_range(func_node)
        assert range_obj.start_line == 1
        assert range_obj.start_col == 0
        assert range_obj.end_line == 3
    
    def test_python_find_child(self):
        """Test _find_child finds correct node."""
        extractor = PythonExtractor()
        parser = get_parser()
        
        code = b"def foo():\n    pass"
        tree, lang = parser.parse_file("test.py", code)
        
        func_node = tree.root_node.children[0]
        
        # Find the identifier (function name)
        name_node = extractor._find_child(func_node, 'identifier')
        assert name_node is not None
        assert extractor._get_node_text(name_node, code) == 'foo'
    
    def test_javascript_find_child(self):
        """Test _find_child works for JavaScript extractor."""
        extractor = JavaScriptExtractor()
        parser = get_parser()
        
        code = b"function bar() {}"
        tree, lang = parser.parse_file("test.js", code)
        
        func_node = tree.root_node.children[0]
        
        name_node = extractor._find_child(func_node, 'identifier')
        assert name_node is not None
        assert extractor._get_node_text(name_node, code) == 'bar'
    
    def test_find_child_returns_none_if_not_found(self):
        """Test _find_child returns None when child type doesn't exist."""
        extractor = PythonExtractor()
        parser = get_parser()
        
        code = b"x = 1"
        tree, lang = parser.parse_file("test.py", code)
        
        result = extractor._find_child(tree.root_node, 'nonexistent_type')
        assert result is None
    
    def test_get_node_text(self):
        """Test _get_node_text extracts correct text."""
        extractor = PythonExtractor()
        parser = get_parser()
        
        code = b"variable_name = 42"
        tree, lang = parser.parse_file("test.py", code)
        
        # The first child should be expression_statement containing assignment
        expr_stmt = tree.root_node.children[0]
        text = extractor._get_node_text(expr_stmt, code)
        assert text == "variable_name = 42"


class TestPythonExtractorSymbols:
    """Test Python symbol extraction."""
    
    def test_extract_function(self):
        extractor = PythonExtractor()
        parser = get_parser()
        
        code = b"def my_function(x, y):\n    return x + y"
        tree, lang = parser.parse_file("test.py", code)
        
        symbols = extractor.extract_symbols(tree, "test.py", code)
        
        assert len(symbols) == 1
        assert symbols[0].name == 'my_function'
        assert symbols[0].kind == 'function'
        assert len(symbols[0].parameters) == 2
    
    def test_extract_class(self):
        extractor = PythonExtractor()
        parser = get_parser()
        
        code = b"class MyClass:\n    def method(self):\n        pass"
        tree, lang = parser.parse_file("test.py", code)
        
        symbols = extractor.extract_symbols(tree, "test.py", code)
        
        assert len(symbols) == 1
        assert symbols[0].name == 'MyClass'
        assert symbols[0].kind == 'class'
        assert len(symbols[0].children) == 1
        assert symbols[0].children[0].name == 'method'
        assert symbols[0].children[0].kind == 'method'
    
    def test_extract_imports(self):
        extractor = PythonExtractor()
        parser = get_parser()
        
        code = b"import os\nfrom pathlib import Path"
        tree, lang = parser.parse_file("test.py", code)
        
        symbols = extractor.extract_symbols(tree, "test.py", code)
        imports = extractor.get_imports()
        
        assert len(imports) == 2
        assert imports[0].module == 'os'
        assert imports[1].module == 'pathlib'
        assert 'Path' in imports[1].names
    
    def test_extract_class_with_bases(self):
        extractor = PythonExtractor()
        parser = get_parser()
        
        code = b"class Child(Parent, Mixin):\n    pass"
        tree, lang = parser.parse_file("test.py", code)
        
        symbols = extractor.extract_symbols(tree, "test.py", code)
        
        assert len(symbols) == 1
        assert symbols[0].bases == ['Parent', 'Mixin']


class TestJavaScriptExtractorSymbols:
    """Test JavaScript symbol extraction."""
    
    def test_extract_function(self):
        extractor = JavaScriptExtractor()
        parser = get_parser()
        
        code = b"function myFunction(x, y) { return x + y; }"
        tree, lang = parser.parse_file("test.js", code)
        
        symbols = extractor.extract_symbols(tree, "test.js", code)
        
        assert len(symbols) == 1
        assert symbols[0].name == 'myFunction'
        assert symbols[0].kind == 'function'
    
    def test_extract_class(self):
        extractor = JavaScriptExtractor()
        parser = get_parser()
        
        code = b"class MyClass {\n  method() {}\n}"
        tree, lang = parser.parse_file("test.js", code)
        
        symbols = extractor.extract_symbols(tree, "test.js", code)
        
        assert len(symbols) == 1
        assert symbols[0].name == 'MyClass'
        assert symbols[0].kind == 'class'
        assert len(symbols[0].children) == 1
        assert symbols[0].children[0].name == 'method'
    
    def test_extract_arrow_function(self):
        extractor = JavaScriptExtractor()
        parser = get_parser()
        
        code = b"const add = (a, b) => a + b;"
        tree, lang = parser.parse_file("test.js", code)
        
        symbols = extractor.extract_symbols(tree, "test.js", code)
        
        assert len(symbols) == 1
        assert symbols[0].name == 'add'
        assert symbols[0].kind == 'function'
    
    def test_extract_imports(self):
        extractor = JavaScriptExtractor()
        parser = get_parser()
        
        code = b"import { foo, bar } from './module';"
        tree, lang = parser.parse_file("test.js", code)
        
        symbols = extractor.extract_symbols(tree, "test.js", code)
        imports = extractor.get_imports()
        
        assert len(imports) == 1
        assert imports[0].module == './module'
        assert 'foo' in imports[0].names
        assert 'bar' in imports[0].names


class TestExtractorGetImportsEmpty:
    """Test get_imports returns empty list before extraction."""
    
    def test_python_imports_empty_initially(self):
        extractor = PythonExtractor()
        assert extractor.get_imports() == []
    
    def test_javascript_imports_empty_initially(self):
        extractor = JavaScriptExtractor()
        assert extractor.get_imports() == []


class TestAsyncFunctionExtraction:
    """Test async function/method extraction."""
    
    def test_python_async_function(self):
        """Test that async def is detected and is_async flag is set."""
        extractor = PythonExtractor()
        parser = get_parser()
        
        code = b"async def fetch_data(url):\n    return await get(url)"
        tree, lang = parser.parse_file("test.py", code)
        
        symbols = extractor.extract_symbols(tree, "test.py", code)
        
        assert len(symbols) == 1
        assert symbols[0].name == 'fetch_data'
        assert symbols[0].kind == 'function'
        assert symbols[0].is_async is True
    
    def test_python_sync_function_not_async(self):
        """Test that regular def does not set is_async."""
        extractor = PythonExtractor()
        parser = get_parser()
        
        code = b"def regular_func():\n    pass"
        tree, lang = parser.parse_file("test.py", code)
        
        symbols = extractor.extract_symbols(tree, "test.py", code)
        
        assert len(symbols) == 1
        assert symbols[0].is_async is False
    
    def test_python_async_method(self):
        """Test async methods in classes."""
        extractor = PythonExtractor()
        parser = get_parser()
        
        code = b"class MyClass:\n    async def async_method(self):\n        pass"
        tree, lang = parser.parse_file("test.py", code)
        
        symbols = extractor.extract_symbols(tree, "test.py", code)
        
        assert len(symbols) == 1
        assert symbols[0].name == 'MyClass'
        assert len(symbols[0].children) == 1
        assert symbols[0].children[0].name == 'async_method'
        assert symbols[0].children[0].kind == 'method'
        assert symbols[0].children[0].is_async is True
    
    def test_javascript_async_function(self):
        """Test JavaScript async function detection."""
        extractor = JavaScriptExtractor()
        parser = get_parser()
        
        code = b"async function fetchData(url) { return await fetch(url); }"
        tree, lang = parser.parse_file("test.js", code)
        
        symbols = extractor.extract_symbols(tree, "test.js", code)
        
        assert len(symbols) == 1
        assert symbols[0].name == 'fetchData'
        assert symbols[0].kind == 'function'
        assert symbols[0].is_async is True
    
    def test_javascript_async_method(self):
        """Test JavaScript async method detection."""
        extractor = JavaScriptExtractor()
        parser = get_parser()
        
        code = b"class Api {\n  async getData() { return 1; }\n}"
        tree, lang = parser.parse_file("test.js", code)
        
        symbols = extractor.extract_symbols(tree, "test.js", code)
        
        assert len(symbols) == 1
        assert len(symbols[0].children) == 1
        assert symbols[0].children[0].name == 'getData'
        assert symbols[0].children[0].is_async is True
