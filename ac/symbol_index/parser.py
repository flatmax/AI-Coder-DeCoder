"""Tree-sitter parsing wrapper with lazy grammar loading."""

import tree_sitter_python
import tree_sitter_javascript
import tree_sitter_typescript
from tree_sitter import Language, Parser
from typing import Optional
from pathlib import Path


class TreeSitterParser:
    """Wraps tree-sitter with lazy grammar loading."""
    
    # Extension to language mapping
    EXTENSION_MAP = {
        '.py': 'python',
        '.js': 'javascript',
        '.mjs': 'javascript',
        '.jsx': 'javascript',
        '.ts': 'typescript',
        '.tsx': 'tsx',
    }
    
    def __init__(self):
        self._languages: dict[str, Language] = {}
        self._parsers: dict[str, Parser] = {}
    
    def _load_language(self, lang_name: str) -> Optional[Language]:
        """Lazy-load a language grammar."""
        if lang_name in self._languages:
            return self._languages[lang_name]
        
        language = None
        if lang_name == 'python':
            language = Language(tree_sitter_python.language())
        elif lang_name == 'javascript':
            language = Language(tree_sitter_javascript.language())
        elif lang_name == 'typescript':
            language = Language(tree_sitter_typescript.language_typescript())
        elif lang_name == 'tsx':
            language = Language(tree_sitter_typescript.language_tsx())
        
        if language:
            self._languages[lang_name] = language
        return language
    
    def _get_parser(self, lang_name: str) -> Optional[Parser]:
        """Get or create a parser for the given language."""
        if lang_name in self._parsers:
            return self._parsers[lang_name]
        
        language = self._load_language(lang_name)
        if not language:
            return None
        
        parser = Parser(language)
        self._parsers[lang_name] = parser
        return parser
    
    def get_language_for_file(self, file_path: str) -> Optional[str]:
        """Determine language from file extension."""
        ext = Path(file_path).suffix.lower()
        return self.EXTENSION_MAP.get(ext)
    
    def parse_file(self, file_path: str, content: Optional[str] = None):
        """Parse a file and return the tree-sitter tree.
        
        Args:
            file_path: Path to the file (used to determine language)
            content: Optional file content. If not provided, reads from disk.
            
        Returns:
            Tuple of (tree, language_name) or (None, None) if unsupported
        """
        lang_name = self.get_language_for_file(file_path)
        if not lang_name:
            return None, None
        
        parser = self._get_parser(lang_name)
        if not parser:
            return None, None
        
        if content is None:
            with open(file_path, 'rb') as f:
                content = f.read()
        elif isinstance(content, str):
            content = content.encode('utf-8')
        
        tree = parser.parse(content)
        return tree, lang_name
    
    def get_language(self, lang_name: str) -> Optional[Language]:
        """Get a Language object for running queries."""
        return self._load_language(lang_name)


# Global parser instance
_parser: Optional[TreeSitterParser] = None


def get_parser() -> TreeSitterParser:
    """Get the global parser instance."""
    global _parser
    if _parser is None:
        _parser = TreeSitterParser()
    return _parser
