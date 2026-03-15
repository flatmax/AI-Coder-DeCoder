"""Tree-sitter parser singleton — multi-language, lazy grammar init."""

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Extension -> (language_name, package_name)
LANGUAGE_MAP = {
    ".py": ("python", "tree_sitter_python"),
    ".js": ("javascript", "tree_sitter_javascript"),
    ".mjs": ("javascript", "tree_sitter_javascript"),
    ".jsx": ("javascript", "tree_sitter_javascript"),
    ".ts": ("typescript", "tree_sitter_typescript"),
    ".tsx": ("typescript", "tree_sitter_typescript"),
    ".c": ("c", "tree_sitter_c"),
    ".h": ("c", "tree_sitter_c"),
    ".cpp": ("cpp", "tree_sitter_cpp"),
    ".cc": ("cpp", "tree_sitter_cpp"),
    ".cxx": ("cpp", "tree_sitter_cpp"),
    ".hpp": ("cpp", "tree_sitter_cpp"),
    ".hxx": ("cpp", "tree_sitter_cpp"),
    ".m": ("matlab", None),  # regex-based, no tree-sitter
}


def language_for_file(path: str) -> Optional[str]:
    """Return the language name for a file path, or None."""
    ext = Path(path).suffix.lower()
    entry = LANGUAGE_MAP.get(ext)
    if entry:
        return entry[0]
    return None


class TreeSitterParser:
    """Singleton parser supporting multiple languages via tree-sitter."""

    _instance: Optional["TreeSitterParser"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._languages: dict[str, object] = {}  # lang_name -> Language
        self._parsers: dict[str, object] = {}     # lang_name -> Parser
        self._init_failures: set[str] = set()
        self._ts_available = self._check_tree_sitter()

    def _check_tree_sitter(self) -> bool:
        """Check if tree_sitter is importable."""
        try:
            import tree_sitter  # noqa: F401
            return True
        except ImportError:
            logger.warning("tree_sitter not installed — code parsing unavailable")
            return False

    def _init_language(self, lang_name: str) -> bool:
        """Lazily initialize a language grammar. Returns True on success."""
        if lang_name in self._languages:
            return True
        if lang_name in self._init_failures:
            return False
        if not self._ts_available:
            self._init_failures.add(lang_name)
            return False

        # Find the package name
        pkg_name = None
        for _ext, (lname, pname) in LANGUAGE_MAP.items():
            if lname == lang_name and pname is not None:
                pkg_name = pname
                break

        if pkg_name is None:
            self._init_failures.add(lang_name)
            return False

        try:
            import importlib
            import tree_sitter

            mod = importlib.import_module(pkg_name)
            lang_func = getattr(mod, "language", None)
            if lang_func is None:
                self._init_failures.add(lang_name)
                return False

            ts_lang = tree_sitter.Language(lang_func())
            parser = tree_sitter.Parser(ts_lang)
            self._languages[lang_name] = ts_lang
            self._parsers[lang_name] = parser
            return True

        except Exception as e:
            logger.warning(f"Failed to init {lang_name}: {e}")
            self._init_failures.add(lang_name)
            return False

    def parse(self, source: bytes, language: str) -> Optional[object]:
        """Parse source bytes and return a tree-sitter Tree, or None."""
        if not self._init_language(language):
            return None
        parser = self._parsers.get(language)
        if parser is None:
            return None
        try:
            return parser.parse(source)
        except Exception as e:
            logger.warning(f"Parse error for {language}: {e}")
            return None

    def has_language(self, language: str) -> bool:
        """Check if a language is available (initializing if needed)."""
        return self._init_language(language)

    @classmethod
    def reset(cls):
        """Reset singleton (for testing)."""
        cls._instance = None