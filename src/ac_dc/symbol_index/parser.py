"""Tree-sitter multi-language parser singleton."""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Extension → language mapping
LANGUAGE_MAP = {
    ".py": "python",
    ".js": "javascript",
    ".mjs": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".hxx": "cpp",
}


class TreeSitterParser:
    """Singleton multi-language parser using tree-sitter."""

    _instance = None
    _languages = {}

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._languages = {}
        self._init_languages()

    def _init_languages(self):
        """Initialize language parsers."""
        lang_modules = {
            "python": "tree_sitter_python",
            "javascript": "tree_sitter_javascript",
            "typescript": "tree_sitter_typescript",
            "c": "tree_sitter_c",
            "cpp": "tree_sitter_cpp",
        }

        for lang_name, module_name in lang_modules.items():
            try:
                self._load_language(lang_name, module_name)
            except Exception as e:
                logger.debug(f"Failed to load {lang_name}: {e}")

    def _load_language(self, lang_name, module_name):
        """Try to load a language grammar."""
        import tree_sitter

        try:
            mod = __import__(module_name)
            # tree-sitter-typescript has separate tsx/typescript
            if lang_name == "typescript":
                lang_func = getattr(mod, "language_typescript", None) or getattr(mod, "language", None)
            else:
                lang_func = getattr(mod, "language", None)

            if lang_func:
                ts_lang = tree_sitter.Language(lang_func())
                self._languages[lang_name] = ts_lang
                logger.debug(f"Loaded {lang_name} grammar")
        except Exception as e:
            logger.debug(f"Cannot load {lang_name} via {module_name}: {e}")

    def get_language(self, lang_name):
        """Get a language instance."""
        return self._languages.get(lang_name)

    def parse(self, source_code, language):
        """Parse source code into an AST.

        Args:
            source_code: str or bytes
            language: language name string

        Returns:
            tree-sitter Tree or None
        """
        import tree_sitter

        lang = self.get_language(language)
        if lang is None:
            return None

        parser = tree_sitter.Parser(lang)
        if isinstance(source_code, str):
            source_code = source_code.encode("utf-8")

        try:
            return parser.parse(source_code)
        except Exception as e:
            logger.warning(f"Parse error for {language}: {e}")
            return None

    def language_for_file(self, filepath):
        """Determine language from file extension."""
        ext = Path(filepath).suffix.lower()
        return LANGUAGE_MAP.get(ext)

    @property
    def available_languages(self):
        return set(self._languages.keys())
