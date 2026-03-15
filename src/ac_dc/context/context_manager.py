"""Context manager — central state holder for an LLM session."""

import logging
from pathlib import Path
from typing import Optional

from ac_dc.context.file_context import FileContext
from ac_dc.context.token_counter import TokenCounter

logger = logging.getLogger(__name__)

# ── Header Constants ──────────────────────────────────────────────

REPO_MAP_HEADER = (
    "# Repository Structure\n\n"
    "Below is a map of the repository showing classes, functions, "
    "and their relationships.\nUse this to understand the codebase "
    "structure and find relevant code.\n\n"
)

DOC_MAP_HEADER = (
    "# Document Structure\n\n"
    "Below is an outline map of documentation files showing headings, "
    "keywords, and cross-references.\nUse this to understand the "
    "documentation structure and find relevant content.\n\n"
)

FILE_TREE_HEADER = "# File Tree"

URL_CONTEXT_HEADER = "# URL Context\n\n"

FILES_ACTIVE_HEADER = "# Working Files\n\nThese files are currently being worked on:\n\n"

FILES_L0_HEADER = "# Reference Files (Stable)\n\nThese files are included for reference:\n\n"
FILES_L1_HEADER = "# Reference Files\n\nThese files are included for reference:\n\n"
FILES_L2_HEADER = "# Reference Files (L2)\n\nThese files are included for reference:\n\n"
FILES_L3_HEADER = "# Reference Files (L3)\n\nThese files are included for reference:\n\n"

TIER_SYMBOLS_HEADER = "# Repository Structure (continued)\n\n"

REVIEW_CONTEXT_HEADER = "# Code Review Context\n\n"


class ContextManager:
    """Central state holder for an LLM session.

    Manages conversation history, file context, token counting,
    and prompt assembly (both flat and tiered).
    """

    def __init__(
        self,
        model_name: str,
        repo_root: Optional[str] = None,
        cache_target_tokens: int = 1126,
        compaction_config: Optional[dict] = None,
    ):
        self._model_name = model_name
        self._repo_root = repo_root
        self._cache_target_tokens = cache_target_tokens
        self._compaction_config = compaction_config or {}

        self.token_counter = TokenCounter(model_name)
        self.file_context = FileContext(repo_root)

        self._history: list[dict] = []
        self._url_context: str = ""
        self._system_prompt: str = ""

    # ── History ───────────────────────────────────────────────────

    def add_message(self, role: str, content: str):
        """Append a single message."""
        self._history.append({"role": role, "content": content})

    def add_exchange(self, user: str, assistant: str):
        """Append a user/assistant pair atomically."""
        self._history.append({"role": "user", "content": user})
        self._history.append({"role": "assistant", "content": assistant})

    def get_history(self) -> list[dict]:
        """Return a copy of the history."""
        return list(self._history)

    def set_history(self, messages: list[dict]):
        """Replace history entirely."""
        self._history = list(messages)

    def clear_history(self):
        """Empty the history list."""
        self._history.clear()

    def reregister_history_items(self, stability_tracker=None):
        """Purge history entries from stability tracker without clearing history.

        Called after compaction to force re-registration of compacted messages
        as new active items on the next request.
        """
        if stability_tracker is not None:
            stability_tracker.purge_history()

    def history_token_count(self) -> int:
        """Token count of current history."""
        return self.token_counter.count(self._history)

    # ── URL Context ───────────────────────────────────────────────

    def set_url_context(self, context: str):
        """Set the URL context string (pre-joined)."""
        self._url_context = context

    def get_url_context(self) -> str:
        return self._url_context

    # ── System Prompt ─────────────────────────────────────────────

    def set_system_prompt(self, prompt: str):
        self._system_prompt = prompt

    def get_system_prompt(self) -> str:
        return self._system_prompt

    # ── Token Budget ──────────────────────────────────────────────

    def get_token_budget(self) -> dict:
        """Token budget report."""
        history_tokens = self.history_token_count()
        max_input = self.token_counter.max_input_tokens
        max_history = self.token_counter.max_history_tokens
        return {
            "history_tokens": history_tokens,
            "max_history_tokens": max_history,
            "max_input_tokens": max_input,
            "remaining": max_input - history_tokens,
            "needs_summary": self.should_compact(),
        }

    def should_compact(self) -> bool:
        """Check if compaction should run."""
        if not self._compaction_config.get("enabled", True):
            return False
        trigger = self._compaction_config.get("compaction_trigger_tokens", 24000)
        return self.history_token_count() > trigger

    def get_compaction_status(self) -> dict:
        """Compaction status info."""
        trigger = self._compaction_config.get("compaction_trigger_tokens", 24000)
        history_tokens = self.history_token_count()
        return {
            "enabled": self._compaction_config.get("enabled", True),
            "trigger_tokens": trigger,
            "history_tokens": history_tokens,
            "percent": (history_tokens / trigger * 100) if trigger > 0 else 0,
        }

    # ── Budget Enforcement ────────────────────────────────────────

    def emergency_truncate(self):
        """Drop oldest messages if history exceeds 2× compaction trigger."""
        trigger = self._compaction_config.get("compaction_trigger_tokens", 24000)
        limit = trigger * 2
        if self.history_token_count() <= limit:
            return

        # Drop oldest pairs until under limit
        while len(self._history) > 2 and self.history_token_count() > limit:
            # Remove oldest pair
            self._history.pop(0)
            if self._history and self._history[0]["role"] == "assistant":
                self._history.pop(0)

    def shed_files_if_needed(self, max_tokens: Optional[int] = None) -> list[str]:
        """Drop largest files if total estimated tokens exceed 90% of max_input.

        Returns list of shed file paths.
        """
        if max_tokens is None:
            max_tokens = self.token_counter.max_input_tokens
        threshold = int(max_tokens * 0.9)

        # Estimate total
        total = (
            self.token_counter.count(self._system_prompt)
            + self.history_token_count()
            + self.file_context.count_tokens(self.token_counter)
        )

        if total <= threshold:
            return []

        shed = []
        # Get files sorted by size descending
        by_file = self.file_context.get_tokens_by_file(self.token_counter)
        for path, tokens in sorted(by_file.items(), key=lambda x: -x[1]):
            if total <= threshold:
                break
            self.file_context.remove_file(path)
            total -= tokens
            shed.append(path)

        return shed

    # ── Prompt Assembly (Flat) ────────────────────────────────────

    def assemble_messages(
        self,
        user_prompt: str,
        images: Optional[list[str]] = None,
        symbol_map: str = "",
        symbol_legend: str = "",
        file_tree: str = "",
        system_reminder: str = "",
    ) -> list[dict]:
        """Assemble a flat (non-tiered) message array."""
        messages = []

        # System message
        system_content = self._system_prompt
        if symbol_legend:
            system_content += "\n\n" + REPO_MAP_HEADER + symbol_legend
        if symbol_map:
            if not symbol_legend:
                system_content += "\n\n" + REPO_MAP_HEADER
            system_content += "\n\n" + symbol_map
        messages.append({"role": "system", "content": system_content})

        # File tree
        if file_tree:
            file_count = len(file_tree.strip().splitlines()) if file_tree.strip() else 0
            tree_header = f"{FILE_TREE_HEADER} ({file_count} files)\n\n"
            messages.append({"role": "user", "content": tree_header + file_tree})
            messages.append({"role": "assistant", "content": "Ok."})

        # URL context
        if self._url_context:
            messages.append({"role": "user", "content": URL_CONTEXT_HEADER + self._url_context})
            messages.append({"role": "assistant", "content": "Ok, I've reviewed the URL content."})

        # Active files
        files_text = self.file_context.format_for_prompt()
        if files_text:
            messages.append({"role": "user", "content": FILES_ACTIVE_HEADER + files_text})
            messages.append({"role": "assistant", "content": "Ok."})

        # History
        messages.extend(self._history)

        # Current user prompt
        full_prompt = user_prompt + system_reminder
        messages.append(self._build_user_message(full_prompt, images))

        return messages

    # ── Prompt Assembly (Tiered) ──────────────────────────────────

    def assemble_tiered_messages(
        self,
        user_prompt: str,
        images: Optional[list[str]] = None,
        symbol_map: str = "",
        symbol_legend: str = "",
        doc_legend: Optional[str] = None,
        file_tree: str = "",
        tiered_content: Optional[dict] = None,
        review_context: str = "",
        system_reminder: str = "",
    ) -> list[dict]:
        """Assemble a tiered message array with cache_control markers.

        tiered_content: {tier_name: {"symbols": str, "files": str, "history": [msg]}}
        """
        messages = []
        tiered_content = tiered_content or {}

        # ── L0: System message ────────────────────────────────────
        l0 = tiered_content.get("L0", {})
        system_content = self._system_prompt

        # Legend(s)
        if symbol_legend:
            system_content += "\n\n" + REPO_MAP_HEADER + symbol_legend
        if doc_legend:
            system_content += "\n\n" + DOC_MAP_HEADER + doc_legend

        # L0 symbols
        l0_symbols = l0.get("symbols", "")
        if l0_symbols:
            system_content += "\n\n" + l0_symbols

        # L0 files
        l0_files = l0.get("files", "")
        if l0_files:
            system_content += "\n\n" + FILES_L0_HEADER + l0_files

        l0_history = l0.get("history", [])

        if l0_history:
            messages.append({"role": "system", "content": system_content})
            messages.extend(l0_history)
            # cache_control on last L0 history message
            self._add_cache_control(messages[-1])
        else:
            messages.append(self._make_cached_system_message(system_content))

        # ── L1, L2, L3 blocks ────────────────────────────────────
        file_headers = {"L1": FILES_L1_HEADER, "L2": FILES_L2_HEADER, "L3": FILES_L3_HEADER}
        for tier_name in ("L1", "L2", "L3"):
            tier = tiered_content.get(tier_name, {})
            tier_symbols = tier.get("symbols", "")
            tier_files = tier.get("files", "")
            tier_history = tier.get("history", [])

            if tier_symbols or tier_files:
                content = ""
                if tier_symbols:
                    content += TIER_SYMBOLS_HEADER + tier_symbols
                if tier_files:
                    if content:
                        content += "\n\n"
                    content += file_headers[tier_name] + tier_files

                messages.append({"role": "user", "content": content})
                messages.append({"role": "assistant", "content": "Ok."})

            if tier_history:
                messages.extend(tier_history)

            # cache_control on last message in tier sequence
            if tier_symbols or tier_files or tier_history:
                self._add_cache_control(messages[-1])

        # ── File tree (uncached) ──────────────────────────────────
        if file_tree:
            file_count = len(file_tree.strip().splitlines()) if file_tree.strip() else 0
            tree_header = f"{FILE_TREE_HEADER} ({file_count} files)\n\n"
            messages.append({"role": "user", "content": tree_header + file_tree})
            messages.append({"role": "assistant", "content": "Ok."})

        # ── URL context (uncached) ────────────────────────────────
        if self._url_context:
            messages.append({"role": "user", "content": URL_CONTEXT_HEADER + self._url_context})
            messages.append({"role": "assistant", "content": "Ok, I've reviewed the URL content."})

        # ── Review context (uncached) ─────────────────────────────
        if review_context:
            messages.append({"role": "user", "content": REVIEW_CONTEXT_HEADER + review_context})
            messages.append({"role": "assistant", "content": "Ok, I've reviewed the code changes."})

        # ── Active files (uncached) ───────────────────────────────
        active = tiered_content.get("active", {})
        active_files = active.get("files", "")
        if not active_files:
            # Fall back to file context
            active_files = self.file_context.format_for_prompt()
        if active_files:
            messages.append({"role": "user", "content": FILES_ACTIVE_HEADER + active_files})
            messages.append({"role": "assistant", "content": "Ok."})

        # ── Active history (uncached) ─────────────────────────────
        active_history = active.get("history", [])
        if active_history:
            messages.extend(active_history)
        elif not tiered_content:
            # No tiered content — use full history
            messages.extend(self._history)

        # ── Current user prompt ───────────────────────────────────
        full_prompt = user_prompt + system_reminder
        messages.append(self._build_user_message(full_prompt, images))

        return messages

    def estimate_prompt_tokens(
        self,
        symbol_map: str = "",
        file_tree: str = "",
    ) -> int:
        """Estimate total prompt tokens for budget checking."""
        total = self.token_counter.count(self._system_prompt)
        total += self.token_counter.count(symbol_map)
        total += self.token_counter.count(file_tree)
        total += self.file_context.count_tokens(self.token_counter)
        total += self.history_token_count()
        if self._url_context:
            total += self.token_counter.count(self._url_context)
        return total

    # ── Private Helpers ───────────────────────────────────────────

    def _build_user_message(self, text: str, images: Optional[list[str]] = None) -> dict:
        """Build the user message, with multimodal blocks if images present."""
        if not images:
            return {"role": "user", "content": text}

        content = [{"type": "text", "text": text}]
        for img in images:
            content.append({
                "type": "image_url",
                "image_url": {"url": img},
            })
        return {"role": "user", "content": content}

    def _make_cached_system_message(self, content: str) -> dict:
        """System message with cache_control on content."""
        return {
            "role": "system",
            "content": [
                {
                    "type": "text",
                    "text": content,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
        }

    @staticmethod
    def _add_cache_control(message: dict):
        """Add cache_control to the last content block of a message."""
        content = message.get("content", "")
        if isinstance(content, str):
            message["content"] = [
                {
                    "type": "text",
                    "text": content,
                    "cache_control": {"type": "ephemeral"},
                }
            ]
        elif isinstance(content, list) and content:
            # Add to last block
            last = content[-1]
            if isinstance(last, dict):
                last["cache_control"] = {"type": "ephemeral"}