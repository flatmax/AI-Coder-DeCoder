"""Tiered context builder — assembles LLM messages with cache_control markers.

Builds the message array from stability tiers, placing cache_control
breakpoints on the last message of each non-empty tier.

Message order:
    L0 (system): system prompt + legend + L0 symbols + L0 files
    L0 history (native pairs)
    [cache breakpoint]
    L1: symbols + files as user/assistant pair
    L1 history
    [cache breakpoint]
    L2: symbols + files pair + history [cache breakpoint]
    L3: symbols + files pair + history [cache breakpoint]
    File tree (uncached)
    URL context (uncached)
    Active files (uncached)
    Active history (uncached)
    Current user prompt
"""

import logging
from typing import Optional

from .stability_tracker import StabilityTracker, Tier, ItemType, TIER_CONFIG

log = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────
# Headers (from context.py constants, duplicated here for clarity)
# ──────────────────────────────────────────────────────────────────────

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

TIER_FILE_HEADERS = {
    Tier.L0: FILES_L0_HEADER,
    Tier.L1: FILES_L1_HEADER,
    Tier.L2: FILES_L2_HEADER,
    Tier.L3: FILES_L3_HEADER,
}


def _apply_cache_control(message: dict) -> dict:
    """Apply cache_control marker to a message.

    Wraps the content in structured format with cache_control on the
    last text block, as required by Anthropic's API.
    """
    content = message.get("content", "")
    if isinstance(content, str):
        message["content"] = [
            {
                "type": "text",
                "text": content,
                "cache_control": {"type": "ephemeral"},
            }
        ]
    elif isinstance(content, list):
        # Find last text block and add cache_control
        for block in reversed(content):
            if isinstance(block, dict) and block.get("type") == "text":
                block["cache_control"] = {"type": "ephemeral"}
                break
    return message


def _format_files_block(files: dict[str, str]) -> str:
    """Format file contents as fenced code blocks."""
    if not files:
        return ""
    parts = []
    for path in sorted(files.keys()):
        content = files[path]
        parts.append(f"\n{path}\n```\n{content}\n```\n")
    return "\n".join(parts)


class TieredContextBuilder:
    """Builds the tiered message array for an LLM request.

    Uses the stability tracker to determine which content goes in which
    cache tier, and places cache_control breakpoints appropriately.
    """

    def __init__(self, tracker: StabilityTracker):
        self._tracker = tracker

    def build_messages(
        self,
        system_prompt: str,
        symbol_map_legend: str,
        symbol_blocks: dict[str, str],
        file_contents: dict[str, str],
        history: list[dict],
        history_tier_map: dict[int, Tier],
        file_tree: str = "",
        url_context: str = "",
        review_context: str = "",
        active_file_contents: dict[str, str] | None = None,
        user_prompt: str = "",
        images: list[str] | None = None,
    ) -> list[dict]:
        """Assemble the full tiered message array.

        Args:
            system_prompt: Main system prompt text
            symbol_map_legend: Legend text for the symbol map
            symbol_blocks: symbol_key → compact format block text
            file_contents: file_key → full file content
            history: Full conversation history as [{role, content}, ...]
            history_tier_map: message_index → Tier assignment
            file_tree: Flat file tree text
            url_context: Formatted URL context text
            active_file_contents: Files in active context (user-selected)
            user_prompt: Current user message
            images: Optional image data URIs

        Returns:
            List of message dicts ready for the LLM API.
        """
        messages: list[dict] = []

        # ── L0: System message ──
        l0_messages = self._build_l0(
            system_prompt, symbol_map_legend, symbol_blocks, file_contents,
        )
        l0_history = self._get_tier_history(history, history_tier_map, Tier.L0)

        if l0_history:
            # System message as plain string, cache on last history msg
            messages.extend(l0_messages)
            messages.extend(l0_history)
            _apply_cache_control(messages[-1])
        elif l0_messages:
            # Cache on the system message itself
            _apply_cache_control(l0_messages[-1])
            messages.extend(l0_messages)

        # ── L1, L2, L3 blocks ──
        for tier in [Tier.L1, Tier.L2, Tier.L3]:
            tier_msgs = self._build_tier_block(
                tier, symbol_blocks, file_contents,
            )
            tier_history = self._get_tier_history(history, history_tier_map, tier)

            if tier_msgs or tier_history:
                messages.extend(tier_msgs)
                messages.extend(tier_history)
                # Cache breakpoint on last message
                if messages:
                    _apply_cache_control(messages[-1])

        # ── File tree (uncached) ──
        if file_tree:
            messages.append({"role": "user", "content": FILE_TREE_HEADER + file_tree})
            messages.append({"role": "assistant", "content": "Ok."})

        # ── URL context (uncached) ──
        if url_context:
            messages.append({"role": "user", "content": URL_CONTEXT_HEADER + url_context})
            messages.append({
                "role": "assistant",
                "content": "Ok, I've reviewed the URL content.",
            })

        # ── Review context (uncached) ──
        if review_context:
            messages.append({"role": "user", "content": review_context})
            messages.append({
                "role": "assistant",
                "content": "Ok, I've reviewed the code changes.",
            })

        # ── Active files (uncached) ──
        if active_file_contents:
            file_text = _format_files_block(active_file_contents)
            if file_text:
                messages.append({
                    "role": "user",
                    "content": FILES_ACTIVE_HEADER + file_text,
                })
                messages.append({"role": "assistant", "content": "Ok."})

        # ── Active history (uncached) ──
        active_history = self._get_tier_history(
            history, history_tier_map, Tier.ACTIVE,
        )
        messages.extend(active_history)

        # ── Current user prompt ──
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

    # ------------------------------------------------------------------
    # L0 construction
    # ------------------------------------------------------------------

    def _build_l0(
        self,
        system_prompt: str,
        symbol_map_legend: str,
        symbol_blocks: dict[str, str],
        file_contents: dict[str, str],
    ) -> list[dict]:
        """Build L0 system message."""
        parts = [system_prompt]

        # Symbol map legend + L0 symbols
        l0_symbol_items = self._tracker.get_tier_items(Tier.L0)
        l0_symbol_keys = [it.key for it in l0_symbol_items if it.item_type == ItemType.SYMBOL]
        l0_file_keys = [it.key for it in l0_symbol_items if it.item_type == ItemType.FILE]

        symbol_parts = []
        if symbol_map_legend:
            symbol_parts.append(symbol_map_legend)
        for key in sorted(l0_symbol_keys):
            block = symbol_blocks.get(key, "")
            if block:
                symbol_parts.append(block)

        if symbol_parts:
            parts.append(REPO_MAP_HEADER + "\n".join(symbol_parts))

        # L0 files
        l0_files = {}
        for key in sorted(l0_file_keys):
            path = key.split(":", 1)[1] if ":" in key else key
            content = file_contents.get(key, "")
            if content:
                l0_files[path] = content

        if l0_files:
            parts.append(FILES_L0_HEADER + _format_files_block(l0_files))

        system_content = "\n\n".join(p for p in parts if p)
        return [{"role": "system", "content": system_content}]

    # ------------------------------------------------------------------
    # L1/L2/L3 block construction
    # ------------------------------------------------------------------

    def _build_tier_block(
        self,
        tier: Tier,
        symbol_blocks: dict[str, str],
        file_contents: dict[str, str],
    ) -> list[dict]:
        """Build a user/assistant pair for a cached tier."""
        tier_items = self._tracker.get_tier_items(tier)
        if not tier_items:
            return []

        symbol_keys = [it.key for it in tier_items if it.item_type == ItemType.SYMBOL]
        file_keys = [it.key for it in tier_items if it.item_type == ItemType.FILE]

        content_parts = []

        # Symbols
        sym_texts = []
        for key in sorted(symbol_keys):
            block = symbol_blocks.get(key, "")
            if block:
                sym_texts.append(block)
        if sym_texts:
            content_parts.append(TIER_SYMBOLS_HEADER + "\n".join(sym_texts))

        # Files
        tier_files = {}
        for key in sorted(file_keys):
            path = key.split(":", 1)[1] if ":" in key else key
            content = file_contents.get(key, "")
            if content:
                tier_files[path] = content

        file_header = TIER_FILE_HEADERS.get(tier, FILES_L1_HEADER)
        if tier_files:
            content_parts.append(file_header + _format_files_block(tier_files))

        if not content_parts:
            return []

        user_content = "\n\n".join(content_parts)
        return [
            {"role": "user", "content": user_content},
            {"role": "assistant", "content": "Ok."},
        ]

    # ------------------------------------------------------------------
    # History tier extraction
    # ------------------------------------------------------------------

    def _get_tier_history(
        self,
        history: list[dict],
        history_tier_map: dict[int, Tier],
        tier: Tier,
    ) -> list[dict]:
        """Extract history messages assigned to a specific tier.

        History messages are native user/assistant pairs, returned as-is.
        """
        result = []
        for idx, msg in enumerate(history):
            msg_tier = history_tier_map.get(idx, Tier.ACTIVE)
            if msg_tier == tier:
                result.append(dict(msg))  # Copy
        return result