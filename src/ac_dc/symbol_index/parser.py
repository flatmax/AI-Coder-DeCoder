"""Tree-sitter parser — singleton with per-language lazy loading.

Design points pinned by specs3 (detail reference) and carried
forward as interop contracts:

- **Per-language grammar packages** — we consume upstream
  ``tree-sitter-{language}`` wheels rather than building grammars
  from source. Each package exposes a ``language()`` callable we
  pass to ``tree_sitter.Language(...)``.

- **TypeScript quirk** — the ``tree-sitter-typescript`` package
  is the one exception. It ships TWO grammars (TypeScript and
  TSX) and exposes ``language_typescript()`` and ``language_tsx()``
  functions — NOT a plain ``language()``. Implementers searching
  for ``language()`` on TypeScript fail silently. The loader
  probes both names.

- **Silent unavailability** — if a grammar package isn't
  installed, that language is simply unavailable. We log a debug
  message and return None. No crashes, no retries. A repo with
  Python code still indexes even if the user didn't install the
  C++ grammar.

- **Singleton** — grammar loading is expensive enough (a few ms
  per language) to cache. Tree-sitter ``Language`` and ``Parser``
  objects are thread-safe for read-only parsing use.

- **Regex-based extractors** — some languages (MATLAB) have no
  maintained tree-sitter grammar. Those declare
  ``tree_optional = True`` on their extractor class; the
  orchestrator (Layer 2.7) passes ``tree=None`` to them. This
  file knows nothing about that — extractors without a grammar
  simply don't appear in ``LANGUAGE_MAP`` here.

Governing spec: ``specs4/2-indexing/symbol-index.md#grammar-acquisition``.
"""

from __future__ import annotations

import importlib
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import tree_sitter

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LanguageSpec:
    """Static description of one tree-sitter language binding.

    - ``package`` — the import name of the grammar wheel
      (e.g. ``tree_sitter_python``).
    - ``function_names`` — ordered list of attributes on that
      module that return a ``tree_sitter`` language pointer. First
      match wins. Most languages only need ``("language",)``;
      TypeScript needs ``("language_typescript", "language")`` so
      the probe finds the TypeScript grammar.
    - ``extensions`` — file extensions (lowercase, with leading
      dot) associated with this language.
    """

    name: str
    package: str
    function_names: tuple[str, ...]
    extensions: tuple[str, ...]


# Language registry. New languages go here and only here — the
# parser and any caller needing extension → language resolution
# both read from this map. Keep the keys (``name`` field on the
# spec and the dict key) identical; the dict key is the canonical
# identifier used by extractors.
LANGUAGE_MAP: dict[str, LanguageSpec] = {
    "python": LanguageSpec(
        name="python",
        package="tree_sitter_python",
        function_names=("language",),
        extensions=(".py",),
    ),
    "javascript": LanguageSpec(
        name="javascript",
        package="tree_sitter_javascript",
        function_names=("language",),
        extensions=(".js", ".mjs", ".jsx"),
    ),
    "typescript": LanguageSpec(
        name="typescript",
        package="tree_sitter_typescript",
        # TypeScript quirk — the wheel exposes language_typescript
        # and language_tsx, NOT language. Probe both names so a
        # future wheel release that adds a plain language() still
        # works, but today's wheel succeeds.
        function_names=("language_typescript", "language"),
        extensions=(".ts", ".tsx"),
    ),
    "c": LanguageSpec(
        name="c",
        package="tree_sitter_c",
        function_names=("language",),
        extensions=(".c", ".h"),
    ),
    "cpp": LanguageSpec(
        name="cpp",
        package="tree_sitter_cpp",
        function_names=("language",),
        # .h is deliberately claimed by C, not C++. In a mixed
        # repo the C parser handles both; only truly C++-only
        # extensions route here.
        extensions=(".cpp", ".cc", ".cxx", ".hpp", ".hxx"),
    ),
}


# Reverse map built once — extension → language name. Built at
# module import so lookup is O(1) without re-scanning LANGUAGE_MAP
# on every file. If two languages claim the same extension, the
# later one in LANGUAGE_MAP wins (dict assignment semantics).
# Today no extensions collide; if they do in future we'll log
# during construction.
def _build_extension_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for lang_name, spec in LANGUAGE_MAP.items():
        for ext in spec.extensions:
            if ext in mapping:
                logger.warning(
                    "Extension %s claimed by both %s and %s; "
                    "later wins",
                    ext,
                    mapping[ext],
                    lang_name,
                )
            mapping[ext] = lang_name
    return mapping


_EXTENSION_MAP: dict[str, str] = _build_extension_map()


def language_for_file(path: str | os.PathLike[str]) -> str | None:
    """Return the language name for a file path, or None if unknown.

    Matches purely on the lowercased extension — no content sniff,
    no shebang inspection. Files without a recognised extension
    return None and the orchestrator skips them.

    Used by both the symbol-index walker (to decide which files
    to parse) and the extractors (to pick the right extractor for
    a given path). Kept here rather than on the parser itself so
    callers that only want the language name — without triggering
    grammar load — don't pay the tree-sitter import cost.
    """
    ext = Path(os.fspath(path)).suffix.lower()
    return _EXTENSION_MAP.get(ext)


class TreeSitterParser:
    """Singleton owning tree-sitter ``Language`` and ``Parser`` objects.

    Lazy per-language — a grammar is loaded on the first request
    for that language and reused thereafter. Missing grammars are
    cached as ``None`` so repeated queries don't re-probe the
    import system.

    Thread-safety — tree-sitter's Python binding documents that
    ``Parser.parse()`` is safe to call concurrently for reads.
    The loader itself is not thread-safe (no lock around the
    cache populate), but in practice Layer 2's orchestrator
    drives parsing from a single executor; the race is harmless
    (worst case: two threads both load the same grammar, one
    overwrites the other's identical reference).

    Not strictly a singleton from a Python-language point of view
    — callers can construct multiple instances — but in practice
    the orchestrator creates exactly one per session. The
    ``instance()`` classmethod exposes the shared instance for
    tests and for code that wants to be explicit.
    """

    _shared: "TreeSitterParser | None" = None

    def __init__(self) -> None:
        # Per-language cache of Language objects. None means
        # "attempted load, grammar not available" — distinct from
        # the key being absent ("not yet attempted").
        self._languages: dict[str, "tree_sitter.Language | None"] = {}
        # Per-language cache of Parser objects, each configured
        # with its Language. Only populated for languages whose
        # grammar loaded successfully.
        self._parsers: dict[str, "tree_sitter.Parser"] = {}

    @classmethod
    def instance(cls) -> "TreeSitterParser":
        """Return the process-wide shared parser instance."""
        if cls._shared is None:
            cls._shared = cls()
        return cls._shared

    @classmethod
    def reset_instance(cls) -> None:
        """Discard the shared instance.

        Test hook only. Production code never calls this. Used by
        the test suite to clear cached-None entries between tests
        that simulate missing grammars.
        """
        cls._shared = None

    # ------------------------------------------------------------------
    # Grammar loading
    # ------------------------------------------------------------------

    def _load_language(
        self, spec: LanguageSpec
    ) -> "tree_sitter.Language | None":
        """Import the grammar package and wrap its language pointer.

        Returns None on any failure (missing package, no matching
        function name, tree-sitter construction error). Failure is
        cached by the caller so repeated lookups are cheap.
        """
        try:
            module = importlib.import_module(spec.package)
        except ImportError:
            # Expected case — the user hasn't installed this
            # grammar. Debug-level because it's not actionable
            # unless the user genuinely wants that language.
            logger.debug(
                "tree-sitter grammar %s not installed; "
                "language %s unavailable",
                spec.package,
                spec.name,
            )
            return None

        # Probe the module for any of the documented function
        # names. TypeScript needs this probe; all other languages
        # resolve on the first attempt.
        lang_fn = None
        for fn_name in spec.function_names:
            candidate = getattr(module, fn_name, None)
            if callable(candidate):
                lang_fn = candidate
                break

        if lang_fn is None:
            logger.warning(
                "tree-sitter grammar %s is installed but exposes "
                "none of %s; language %s unavailable",
                spec.package,
                spec.function_names,
                spec.name,
            )
            return None

        # Wrap in tree_sitter.Language. The wheel returns a raw
        # pointer (a PyCapsule under the hood); the Language
        # constructor adapts it to the Python API.
        try:
            import tree_sitter
        except ImportError:
            logger.warning(
                "tree-sitter core library not installed; "
                "cannot use %s grammar",
                spec.name,
            )
            return None

        try:
            return tree_sitter.Language(lang_fn())
        except Exception as exc:
            # Grammar / core version mismatch, ABI incompatibility,
            # or similar. Log loud — the user's install is in a
            # confusing state — but don't crash the whole index.
            logger.warning(
                "Failed to construct tree-sitter Language for %s: %s",
                spec.name,
                exc,
            )
            return None

    def get_language(
        self, name: str
    ) -> "tree_sitter.Language | None":
        """Return the cached Language for ``name``, loading on demand.

        Returns None if the grammar is unavailable. The cache
        stores the None result so we don't retry the import on
        every call — a missing grammar stays missing for the
        lifetime of this parser instance (use ``reset_instance``
        from tests to clear).
        """
        if name in self._languages:
            return self._languages[name]
        spec = LANGUAGE_MAP.get(name)
        if spec is None:
            # Unknown language name — cache the None so a bogus
            # lookup from a caller bug doesn't hammer this method.
            self._languages[name] = None
            return None
        language = self._load_language(spec)
        self._languages[name] = language
        return language

    def get_parser(self, name: str) -> "tree_sitter.Parser | None":
        """Return a Parser configured for ``name``, or None.

        Parsers are cheap to construct but we cache them anyway —
        repeated construction across thousands of files during a
        full re-index adds up, and the cache avoids re-binding
        the Language on every call.
        """
        if name in self._parsers:
            return self._parsers[name]
        language = self.get_language(name)
        if language is None:
            return None
        try:
            import tree_sitter
        except ImportError:
            # Already logged inside _load_language — the Language
            # couldn't have been constructed without tree_sitter.
            # This is just a belt-and-braces guard for a future
            # refactor that might reorder the imports.
            return None
        parser = tree_sitter.Parser(language)
        self._parsers[name] = parser
        return parser

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------

    def parse(
        self,
        source: bytes,
        language: str,
    ) -> "tree_sitter.Tree | None":
        """Parse ``source`` as ``language``, returning the tree or None.

        ``source`` must be bytes — tree-sitter's C core requires a
        byte buffer and doing the encode here centralises that
        convention. Callers with str content encode via
        ``source.encode('utf-8')``; invalid-UTF-8 bytes round-trip
        through tree-sitter without issue because the parser
        operates on raw bytes.

        Returns None when the language's grammar isn't available.
        Tree-sitter itself rarely fails to produce a tree — even
        severely malformed source parses to a tree riddled with
        ``ERROR`` nodes — so None genuinely means "grammar
        unavailable", not "source too broken to parse".
        """
        parser = self.get_parser(language)
        if parser is None:
            return None
        return parser.parse(source)

    def parse_file(
        self,
        path: str | os.PathLike[str],
    ) -> "tree_sitter.Tree | None":
        """Read and parse a file, picking the language by extension.

        Returns None when the extension is unknown or the grammar
        is unavailable. File-read errors (missing file, permission
        denied) propagate as OSError — they're caller bugs at
        this layer, not expected conditions the parser should
        silence.
        """
        language = language_for_file(path)
        if language is None:
            return None
        with open(path, "rb") as fh:
            source = fh.read()
        return self.parse(source, language)

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def available_languages(self) -> list[str]:
        """Return names of languages whose grammar has loaded OK.

        Only reports languages that have been previously requested
        AND loaded successfully. Languages that haven't been
        touched yet don't appear — probing them would defeat the
        lazy-loading design. Tests wanting to force-probe
        everything iterate ``LANGUAGE_MAP`` and call
        ``get_language`` on each.
        """
        return sorted(
            name
            for name, lang in self._languages.items()
            if lang is not None
        )

    def is_available(self, name: str) -> bool:
        """Return True if ``name``'s grammar can be loaded.

        Triggers the load if not already attempted. Caches the
        result either way, so repeated calls are O(1) after the
        first.
        """
        return self.get_language(name) is not None