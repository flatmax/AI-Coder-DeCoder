"""Context manager — conversation history, file context, token budgets.

Central state holder for an LLM session, sitting between the transport
layer and individual subsystems (stability tracker, compactor, etc.).
"""

import logging
from pathlib import Path
from typing import Optional, Union

from .token_counter import TokenCounter
from .stability_tracker import (
    StabilityTracker, Tier, ItemType, TierChange,
    TIER_CONFIG, _hash_content, cluster_for_tiers,
)
from .context_builder import TieredContextBuilder

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt assembly constants
# ---------------------------------------------------------------------------

REPO_MAP_HEADER = (
    "# Repository Structure\n\n"
    "Below is a map of the repository showing classes, functions, and their relationships.\n"
    "Use this to understand the codebase structure and find relevant code.\n\n"
)

FILE_TREE_HEADER = (
    "# Repository Files\n\n"
    "Complete list of files in the repository:\n\n"
)

URL_CONTEXT_HEADER = (
    "# URL Context\n\n"
    "The following content was fetched from URLs mentioned in the conversation:\n\n"
)

FILES_ACTIVE_HEADER = (
    "# Working Files\n\n"
    "Here are the files:\n\n"
)

FILES_L0_HEADER = (
    "# Reference Files (Stable)\n\n"
    "These files are included for reference:\n\n"
)

FILES_L1_HEADER = (
    "# Reference Files\n\n"
    "These files are included for reference:\n\n"
)

FILES_L2_HEADER = (
    "# Reference Files (L2)\n\n"
    "These files are included for reference:\n\n"
)

FILES_L3_HEADER = (
    "# Reference Files (L3)\n\n"
    "These files are included for reference:\n\n"
)

TIER_SYMBOLS_HEADER = "# Repository Structure (continued)\n\n"

# System reminder — compact edit format reference.
# Exists as infrastructure for potential mid-conversation reinforcement.
SYSTEM_REMINDER = """\
Edit format reminder:
path/to/file
<<<< EDIT
[old text with anchor context]
==== REPLACE
[new text with same anchor context]
>>>> EDIT END
Rules: exact whitespace match, enough context for unique anchor, no placeholders."""

COMMIT_MSG_SYSTEM = """\
You are an expert software engineer writing git commit messages.

Format: conventional commit style.
- Type: feat, fix, refactor, docs, test, chore, style, perf, ci, build
- Subject: imperative mood, max 72 chars, no period
- Body: wrap at 72 chars, explain what and why (not how)

Output ONLY the commit message. No commentary, no markdown fencing."""


class FileContext:
    """Tracks files included in conversation context."""

    def __init__(self, repo_root: Optional[Path] = None):
        self._repo_root = repo_root
        self._files: dict[str, str] = {}  # path -> content

    def add_file(self, path: str, content: Optional[str] = None) -> bool:
        """Add a file to context. Reads from disk if content not provided."""
        if content is not None:
            self._files[path] = content
            return True
        if self._repo_root is None:
            return False
        try:
            full = self._repo_root / path
            resolved = full.resolve()
            if not str(resolved).startswith(str(self._repo_root.resolve())):
                return False
            if not full.exists():
                return False
            # Binary check
            with open(full, "rb") as f:
                if b"\x00" in f.read(8192):
                    return False
            self._files[path] = full.read_text(encoding="utf-8", errors="replace")
            return True
        except Exception as e:
            log.warning("Failed to read file %s: %s", path, e)
            return False

    def remove_file(self, path: str):
        """Remove a file from context."""
        self._files.pop(path, None)

    def get_files(self) -> list[str]:
        """List paths in context."""
        return sorted(self._files.keys())

    def get_content(self, path: str) -> Optional[str]:
        """Get content for a specific file."""
        return self._files.get(path)

    def has_file(self, path: str) -> bool:
        return path in self._files

    def clear(self):
        self._files.clear()

    def format_for_prompt(self) -> str:
        """Format all files as fenced code blocks for prompt inclusion."""
        return _format_files(self._files)

    def count_tokens(self, counter: TokenCounter) -> int:
        """Total tokens across all files."""
        if not self._files:
            return 0
        return counter.count(self.format_for_prompt())

    def get_tokens_by_file(self, counter: TokenCounter) -> dict[str, int]:
        """Per-file token counts."""
        result = {}
        for path, content in self._files.items():
            block = f"\n{path}\n```\n{content}\n```\n"
            result[path] = counter.count(block)
        return result


def _format_files(files: dict[str, str]) -> str:
    """Format file dict as fenced code blocks (no language tags)."""
    parts = []
    for path in sorted(files.keys()):
        content = files[path]
        parts.append(f"\n{path}\n```\n{content}\n```\n")
    return "\n".join(parts)


class ContextManager:
    """Manages conversation history, file context, and token budgets.

    This is the central state holder for an LLM session.
    """

    def __init__(
        self,
        model_name: str = "",
        repo_root: Optional[Path] = None,
        cache_target_tokens: int = 1536,
        compaction_config: Optional[dict] = None,
    ):
        self.model_name = model_name
        self.repo_root = repo_root
        self.cache_target_tokens = cache_target_tokens
        self._compaction_config = compaction_config or {}

        # Sub-components
        self.counter = TokenCounter(model_name)
        self.file_context = FileContext(repo_root)

        # Stability tracker (cache tiering)
        self.stability = StabilityTracker(cache_target_tokens)

        # Tiered context builder
        self._builder = TieredContextBuilder(self.stability)

        # Conversation history — working copy for LLM requests
        self._messages: list[dict] = []

    # ------------------------------------------------------------------
    # History operations
    # ------------------------------------------------------------------

    def add_message(self, role: str, content: str):
        """Append a single message to history."""
        self._messages.append({"role": role, "content": content})

    def add_exchange(self, user_content: str, assistant_content: str):
        """Append a user/assistant pair atomically."""
        self._messages.append({"role": "user", "content": user_content})
        self._messages.append({"role": "assistant", "content": assistant_content})

    def get_history(self) -> list[dict]:
        """Return a copy of current history."""
        return list(self._messages)

    def set_history(self, messages: list[dict]):
        """Replace history entirely (e.g. after compaction or session load)."""
        self._messages = list(messages)

    def clear_history(self):
        """Empty the history."""
        self._messages.clear()

    def history_token_count(self) -> int:
        """Token count of current history."""
        return self.counter.count(self._messages)

    @property
    def max_history_tokens(self) -> int:
        return self.counter.max_history_tokens

    # ------------------------------------------------------------------
    # Token budget
    # ------------------------------------------------------------------

    def get_token_budget(self) -> dict:
        """Return token budget breakdown."""
        history_tokens = self.history_token_count()
        max_history = self.max_history_tokens
        max_input = self.counter.max_input_tokens
        return {
            "history_tokens": history_tokens,
            "max_history_tokens": max_history,
            "max_input_tokens": max_input,
            "remaining": max(0, max_input - history_tokens),
            "needs_summary": self.should_compact(),
        }

    # ------------------------------------------------------------------
    # Compaction stubs (Phase 5 will fill these in)
    # ------------------------------------------------------------------

    def should_compact(self) -> bool:
        """True if enabled and history tokens exceed trigger."""
        if not self._compaction_config.get("enabled", False):
            return False
        trigger = self._compaction_config.get("compaction_trigger_tokens", 24000)
        return self.history_token_count() > trigger

    def get_compaction_status(self) -> dict:
        """Status dict for UI."""
        trigger = self._compaction_config.get("compaction_trigger_tokens", 24000)
        history_tokens = self.history_token_count()
        return {
            "enabled": self._compaction_config.get("enabled", False),
            "history_tokens": history_tokens,
            "trigger_tokens": trigger,
            "percent": min(100, int(history_tokens / max(1, trigger) * 100)),
        }

    # ------------------------------------------------------------------
    # Prompt assembly
    # ------------------------------------------------------------------

    def assemble_messages(
        self,
        user_prompt: str,
        system_prompt: str,
        symbol_map: str = "",
        file_tree: str = "",
        url_context: str = "",
        images: Optional[list[str]] = None,
    ) -> list[dict]:
        """Assemble the full message array for an LLM request.

        Non-tiered assembly — used when stability tracker has no items.
        """
        messages: list[dict] = []

        # 1. System message (L0 equivalent)
        system_parts = [system_prompt]
        if symbol_map:
            system_parts.append(REPO_MAP_HEADER + symbol_map)
        system_content = "\n\n".join(p for p in system_parts if p)
        messages.append({"role": "system", "content": system_content})

        # 2. File tree
        if file_tree:
            messages.append({"role": "user", "content": FILE_TREE_HEADER + file_tree})
            messages.append({"role": "assistant", "content": "Ok."})

        # 3. URL context
        if url_context:
            messages.append({"role": "user", "content": URL_CONTEXT_HEADER + url_context})
            messages.append({
                "role": "assistant",
                "content": "Ok, I've reviewed the URL content.",
            })

        # 4. Active files
        file_prompt = self.file_context.format_for_prompt()
        if file_prompt:
            messages.append({
                "role": "user",
                "content": FILES_ACTIVE_HEADER + file_prompt,
            })
            messages.append({"role": "assistant", "content": "Ok."})

        # 5. History
        messages.extend(self._messages)

        # 6. Current user message
        if images:
            content_blocks: list[dict] = [{"type": "text", "text": user_prompt}]
            for img in images:
                content_blocks.append({
                    "type": "image_url",
                    "image_url": {"url": img},
                })
            messages.append({"role": "user", "content": content_blocks})
        else:
            messages.append({"role": "user", "content": user_prompt})

        return messages

    def assemble_tiered_messages(
        self,
        user_prompt: str,
        system_prompt: str,
        symbol_map_legend: str = "",
        symbol_blocks: Optional[dict[str, str]] = None,
        file_contents: Optional[dict[str, str]] = None,
        file_tree: str = "",
        url_context: str = "",
        images: Optional[list[str]] = None,
    ) -> list[dict]:
        """Assemble messages with cache tiering.

        Uses the stability tracker to organize content into cached tiers
        with cache_control breakpoints.
        """
        # Build history tier map
        history_tier_map = self._build_history_tier_map()

        # Active file contents
        active_files = {}
        for path in self.file_context.get_files():
            content = self.file_context.get_content(path)
            if content is not None:
                active_files[path] = content

        return self._builder.build_messages(
            system_prompt=system_prompt,
            symbol_map_legend=symbol_map_legend,
            symbol_blocks=symbol_blocks or {},
            file_contents=file_contents or {},
            history=self._messages,
            history_tier_map=history_tier_map,
            file_tree=file_tree,
            url_context=url_context,
            active_file_contents=active_files,
            user_prompt=user_prompt,
            images=images,
        )

    def _build_history_tier_map(self) -> dict[int, Tier]:
        """Map each message index to its assigned tier."""
        tier_map: dict[int, Tier] = {}
        for idx in range(len(self._messages)):
            key = f"history:{idx}"
            item = self.stability.get_item(key)
            if item is not None:
                tier_map[idx] = item.tier
            else:
                tier_map[idx] = Tier.ACTIVE
        return tier_map

    # ------------------------------------------------------------------
    # Stability integration
    # ------------------------------------------------------------------

    def build_active_items(
        self,
        selected_files: list[str],
        symbol_blocks: Optional[dict[str, str]] = None,
    ) -> dict[str, dict]:
        """Build the active items dict for stability tracking.

        Active items are those explicitly in the active (uncached) context:
        - Selected file paths
        - Symbol entries for selected files
        - History messages not yet graduated
        """
        active: dict[str, dict] = {}

        # Selected files
        for fpath in selected_files:
            content = self.file_context.get_content(fpath)
            if content is not None:
                file_key = f"file:{fpath}"
                active[file_key] = {
                    "hash": _hash_content(content),
                    "tokens": max(1, len(content) // 4),
                    "type": ItemType.FILE,
                }
                # Symbol entry for selected file (excluded from symbol map)
                sym_key = f"symbol:{fpath}"
                sym_block = (symbol_blocks or {}).get(sym_key, "")
                if sym_block:
                    active[sym_key] = {
                        "hash": _hash_content(sym_block),
                        "tokens": max(1, len(sym_block) // 4),
                        "type": ItemType.SYMBOL,
                    }

        # History messages — register all that aren't already graduated
        for idx, msg in enumerate(self._messages):
            key = f"history:{idx}"
            item = self.stability.get_item(key)
            if item is None or item.tier == Tier.ACTIVE:
                content_str = f"{msg.get('role', '')}:{msg.get('content', '')}"
                active[key] = {
                    "hash": _hash_content(content_str),
                    "tokens": self.counter.count(msg),
                    "type": ItemType.HISTORY,
                }

        return active

    def initialize_stability(self, symbol_index, ref_index):
        """Initialize stability tracker from reference graph.

        Called once on startup when the symbol index is first built.
        """
        clusters = cluster_for_tiers(
            ref_index, symbol_index, self.cache_target_tokens,
        )
        token_estimates = {}
        for tier, keys in clusters:
            for key in keys:
                path = key.split(":", 1)[1] if ":" in key else key
                block = symbol_index.get_file_block(path)
                token_estimates[key] = max(1, len(block) // 4) if block else 0

        self.stability.initialize_from_reference_graph(clusters, token_estimates)
        log.info(
            "Stability initialized: %d items across %d clusters",
            self.stability.item_count, len(clusters),
        )

    def reregister_history_items(self):
        """Purge history entries from stability tracker without clearing history."""
        self.stability.purge_history_items()

    @property
    def has_tiered_content(self) -> bool:
        """True if the stability tracker has items in cached tiers."""
        return self.stability.item_count > 0

    def estimate_prompt_tokens(
        self,
        user_prompt: str,
        system_prompt: str,
        symbol_map: str = "",
        file_tree: str = "",
        url_context: str = "",
    ) -> int:
        """Estimate total tokens for a prompt without building the full array."""
        total = self.counter.count(system_prompt)
        if symbol_map:
            total += self.counter.count(REPO_MAP_HEADER + symbol_map)
        if file_tree:
            total += self.counter.count(FILE_TREE_HEADER + file_tree) + 4
        if url_context:
            total += self.counter.count(URL_CONTEXT_HEADER + url_context) + 4
        total += self.file_context.count_tokens(self.counter)
        total += self.history_token_count()
        total += self.counter.count(user_prompt)
        return total

    def shed_files_if_needed(
        self,
        user_prompt: str,
        system_prompt: str,
        symbol_map: str = "",
        file_tree: str = "",
        url_context: str = "",
    ) -> list[str]:
        """Drop largest files if estimated tokens exceed 90% of max.

        Returns list of shed file paths.
        """
        max_input = self.counter.max_input_tokens
        threshold = int(max_input * 0.9)
        shed: list[str] = []

        while True:
            est = self.estimate_prompt_tokens(
                user_prompt, system_prompt, symbol_map, file_tree, url_context,
            )
            if est <= threshold:
                break
            # Find largest file
            tokens_by_file = self.file_context.get_tokens_by_file(self.counter)
            if not tokens_by_file:
                break
            largest = max(tokens_by_file, key=tokens_by_file.get)
            log.warning("Shedding file %s (%d tokens) — budget exceeded", largest, tokens_by_file[largest])
            self.file_context.remove_file(largest)
            shed.append(largest)

        return shed

    def emergency_truncate(self):
        """Drop oldest messages if history exceeds 2x compaction trigger.

        Layer 2 defense — simple tail truncation.
        """
        trigger = self._compaction_config.get("compaction_trigger_tokens", 24000)
        limit = trigger * 2
        while self.history_token_count() > limit and len(self._messages) > 2:
            self._messages.pop(0)
            # Keep pairs aligned — if we removed a user msg, remove next assistant too
            if self._messages and self._messages[0]["role"] == "assistant":
                self._messages.pop(0)
