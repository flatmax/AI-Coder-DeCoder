"""Base formatter — shared logic for symbol map and doc index output."""

from abc import ABC, abstractmethod
from collections import Counter
from typing import Optional


class BaseFormatter(ABC):
    """Base class for compact text output formatters.

    Provides path aliasing and the framework for legend generation.
    Subclasses implement format-specific output.
    """

    def __init__(self):
        self._path_aliases: dict[str, str] = {}  # prefix -> alias
        self._alias_counter = 0

    def compute_path_aliases(self, file_paths: list[str], min_refs: int = 3):
        """Compute short aliases for frequently repeated path prefixes.

        Only prefixes appearing >= min_refs times get aliases.
        """
        self._path_aliases.clear()
        self._alias_counter = 0

        # Count directory prefixes
        prefix_counts: Counter[str] = Counter()
        for path in file_paths:
            parts = path.rsplit("/", 1)
            if len(parts) == 2:
                prefix_counts[parts[0] + "/"] += 1

        # Assign aliases to frequent prefixes, sorted by count descending
        for prefix, count in prefix_counts.most_common():
            if count < min_refs:
                break
            self._alias_counter += 1
            self._path_aliases[prefix] = f"@{self._alias_counter}/"

    def alias_path(self, path: str) -> str:
        """Replace a known prefix with its alias."""
        for prefix, alias in self._path_aliases.items():
            if path.startswith(prefix):
                return alias + path[len(prefix):]
        return path

    def format_alias_legend(self) -> str:
        """Format path alias lines for the legend."""
        lines = []
        for prefix, alias in self._path_aliases.items():
            lines.append(f"# {alias}={prefix}")
        return "\n".join(lines)

    @abstractmethod
    def get_legend(self) -> str:
        """Return the full legend text including abbreviations and aliases."""
        ...

    @abstractmethod
    def format_file(self, path: str, data: object, **kwargs) -> str:
        """Format a single file's data into compact text."""
        ...