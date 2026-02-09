"""Tree-sitter parser singleton with multi-language support."""

import logging
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

# Language extension mapping
LANGUAGE_MAP: dict[str, str] = {
    ".py": "python",
    ".js": "javascript",
    ".mjs": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".c": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".hxx": "cpp",
}

# Singleton instance
_parser_instance: Optional["TreeSitterParser"] = None


def get_parser() -> "TreeSitterParser":
    """Get or create the singleton parser."""
    global _parser_instance
    if _parser_instance is None:
        _parser_instance = TreeSitterParser()
    return _parser_instance


def reset_parser():
    """Reset singleton (for testing or after config change)."""
    global _parser_instance
    _parser_instance = None


def _get_language(lang_name: str):
    """Load language object, trying individual packages then tree_sitter_languages.

    Individual tree-sitter-{lang} packages return a PyCapsule.
    tree-sitter's Parser requires a tree_sitter.Language wrapper.
    This function returns a wrapped Language object ready for use.
    """
    capsule = _get_language_capsule(lang_name)
    if capsule is not None:
        return _wrap_language(capsule)

    # Fallback: tree_sitter_languages bundle
    try:
        from tree_sitter_languages import get_language
        return get_language(lang_name)
    except Exception as e:
        log.debug("tree_sitter_languages.get_language(%s) failed: %s", lang_name, e)

    return None


def _get_language_capsule(lang_name: str):
    """Get raw language capsule from individual tree-sitter-{lang} packages."""
    try:
        if lang_name == "python":
            import tree_sitter_python
            return tree_sitter_python.language()
        elif lang_name == "javascript":
            import tree_sitter_javascript
            return tree_sitter_javascript.language()
        elif lang_name == "typescript":
            import tree_sitter_typescript
            return tree_sitter_typescript.language_typescript()
        elif lang_name == "tsx":
            import tree_sitter_typescript
            return tree_sitter_typescript.language_tsx()
        elif lang_name == "c":
            import tree_sitter_c
            return tree_sitter_c.language()
        elif lang_name == "cpp":
            import tree_sitter_cpp
            return tree_sitter_cpp.language()
    except ImportError as e:
        log.debug("Individual package for %s not installed: %s", lang_name, e)
    except Exception as e:
        log.debug("Failed to load %s from individual package: %s", lang_name, e)
    return None


def _wrap_language(capsule):
    """Wrap a PyCapsule in tree_sitter.Language if needed."""
    try:
        import tree_sitter
        # Already a Language object — return as-is
        if isinstance(capsule, tree_sitter.Language):
            return capsule
        # Wrap PyCapsule -> Language
        return tree_sitter.Language(capsule)
    except Exception as e:
        log.debug("Failed to wrap language capsule: %s", e)
    return None


# Cache for tsl parsers (tree_sitter_languages provides ready-made parsers)
_tsl_parsers: dict[str, object] = {}


def _get_tsl_parser(lang_name: str):
    """Try to get a ready-made parser from tree_sitter_languages."""
    if lang_name in _tsl_parsers:
        return _tsl_parsers[lang_name]
    try:
        from tree_sitter_languages import get_parser as tsl_get_parser
        p = tsl_get_parser(lang_name)
        if p is not None:
            tree = p.parse(b"x")
            if tree is not None:
                _tsl_parsers[lang_name] = p
                return p
    except Exception as e:
        log.debug("tsl_get_parser(%s) failed: %s", lang_name, e)
    return None


class TreeSitterParser:
    """Multi-language tree-sitter parser."""

    def __init__(self):
        self._parsers: dict[str, object] = {}  # lang_name -> ready-to-use parser
        self._ts_available = False
        self._strategy = None  # "native" | "tsl" | None
        self._init_parser()

    def _init_parser(self):
        """Initialize tree-sitter parser.

        Tries three strategies in order:
        1. Plain tree-sitter + individual grammar packages (preferred)
        2. tree_sitter_languages bundle (fallback)
        3. Disabled
        """
        # Strategy 1: tree-sitter + individual packages
        try:
            import tree_sitter
            lang = _get_language("python")
            if lang is not None:
                # Try new API: Parser(language)
                try:
                    p = tree_sitter.Parser(lang)
                    tree = p.parse(b"x = 1")
                    if tree is not None and tree.root_node is not None:
                        self._strategy = "native"
                        self._ts_available = True
                        log.debug("tree-sitter initialized (native, constructor API)")
                        return
                except TypeError:
                    pass
                # Try legacy API: Parser().set_language(language)
                try:
                    p = tree_sitter.Parser()
                    p.set_language(lang)
                    tree = p.parse(b"x = 1")
                    if tree is not None and tree.root_node is not None:
                        self._strategy = "native"
                        self._ts_available = True
                        log.debug("tree-sitter initialized (native, set_language API)")
                        return
                except (TypeError, AttributeError):
                    pass
        except ImportError:
            pass
        except Exception as e:
            log.debug("Native tree-sitter init failed: %s", e)

        # Strategy 2: tree_sitter_languages provides ready-made parsers
        p = _get_tsl_parser("python")
        if p is not None:
            self._strategy = "tsl"
            self._ts_available = True
            log.debug("tree-sitter initialized (tree_sitter_languages)")
            return

        log.warning("tree-sitter not available — symbol extraction disabled")
        self._ts_available = False

    @property
    def available(self) -> bool:
        return self._ts_available

    def language_for_file(self, file_path: str) -> Optional[str]:
        """Determine language from file extension."""
        ext = Path(file_path).suffix.lower()
        return LANGUAGE_MAP.get(ext)

    def _get_parser_for_lang(self, lang_name: str):
        """Get a ready-to-use parser for the given language, or None."""
        if lang_name in self._parsers:
            return self._parsers[lang_name]

        parser = self._build_parser(lang_name)
        if parser is not None:
            self._parsers[lang_name] = parser
        return parser

    def _build_parser(self, lang_name: str):
        """Build a parser for the given language."""
        if self._strategy == "tsl":
            return _get_tsl_parser(lang_name)

        # Native strategy: load language, create parser
        lang = _get_language(lang_name)
        if lang is None:
            # Last resort: try tsl even if we started with native
            p = _get_tsl_parser(lang_name)
            if p is not None:
                return p
            log.warning("Cannot load grammar for %s", lang_name)
            return None

        import tree_sitter

        # Try new API: Parser(language)
        try:
            p = tree_sitter.Parser(lang)
            tree = p.parse(b"x")
            if tree is not None:
                return p
        except TypeError:
            pass
        except Exception as e:
            log.debug("Parser(lang) failed for %s: %s", lang_name, e)

        # Try legacy API: set_language
        try:
            p = tree_sitter.Parser()
            p.set_language(lang)
            tree = p.parse(b"x")
            if tree is not None:
                return p
        except Exception as e:
            log.debug("set_language failed for %s: %s", lang_name, e)

        log.warning("Failed to create parser for %s", lang_name)
        return None

    def parse(self, source: str, language: str):
        """Parse source code and return the tree-sitter tree."""
        if not self._ts_available:
            return None

        parser = self._get_parser_for_lang(language)
        if parser is None:
            return None

        try:
            return parser.parse(source.encode("utf-8"))
        except Exception as e:
            log.warning("Parse failed for %s: %s", language, e)
            return None

    def supported_extensions(self) -> set[str]:
        """Return set of supported file extensions."""
        return set(LANGUAGE_MAP.keys())
