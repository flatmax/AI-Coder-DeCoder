"""Context engine — manages conversation history, file context, token budgets, and prompt assembly.

This is the central state holder for an LLM session. It coordinates:
- In-memory conversation history
- File context tracking
- Token budget enforcement
- Prompt message assembly (non-tiered and tiered)
"""

import logging
import os
from enum import Enum
from pathlib import Path

from .token_counter import TokenCounter


class Mode(Enum):
    """Session mode — determines which index feeds context."""
    CODE = "code"
    DOC = "doc"

logger = logging.getLogger(__name__)

# Header constants for prompt assembly
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
REVIEW_CONTEXT_HEADER = "# Code Review Context\n\n"

DOC_MAP_HEADER = (
    "# Document Structure\n\n"
    "Below is an outline map of documentation files showing headings, keywords, and cross-references.\n"
    "Use this to understand document content and navigate without loading full files.\n\n"
)


class FileContext:
    """Tracks files included in the conversation with their contents.

    Paths are normalized relative to repo root. Binary files are rejected.
    Path traversal (../) is blocked.
    """

    def __init__(self, repo_root=None):
        self._repo_root = Path(repo_root) if repo_root else None
        self._files = {}  # path -> content

    def add_file(self, path, content=None):
        """Add file to context. Reads from disk if content not provided.

        Returns True on success, False on failure.
        """
        path = self._normalize_path(path)

        if ".." in path:
            logger.warning(f"Path traversal blocked: {path}")
            return False

        if content is not None:
            self._files[path] = content
            return True

        if self._repo_root is None:
            return False

        abs_path = self._repo_root / path
        if not abs_path.exists():
            return False

        # Reject binary files
        try:
            with open(abs_path, "rb") as f:
                chunk = f.read(8192)
                if b"\x00" in chunk:
                    return False
        except OSError:
            return False

        try:
            self._files[path] = abs_path.read_text()
            return True
        except (OSError, UnicodeDecodeError):
            return False

    def remove_file(self, path):
        """Remove from context."""
        path = self._normalize_path(path)
        self._files.pop(path, None)

    def get_files(self):
        """List paths in context, sorted."""
        return sorted(self._files.keys())

    def get_content(self, path):
        """Get specific file content."""
        path = self._normalize_path(path)
        return self._files.get(path)

    def has_file(self, path):
        """Check membership."""
        path = self._normalize_path(path)
        return path in self._files

    def clear(self):
        """Remove all."""
        self._files.clear()

    def format_for_prompt(self):
        """Format all files as fenced code blocks for prompt inclusion."""
        parts = []
        for path in sorted(self._files.keys()):
            content = self._files[path]
            parts.append(f"{path}\n```\n{content}\n```")
        return "\n\n".join(parts)

    def count_tokens(self, counter):
        """Total tokens across all files."""
        total = 0
        for content in self._files.values():
            total += counter.count(content)
        return total

    def get_tokens_by_file(self, counter):
        """Per-file token counts."""
        return {path: counter.count(content) for path, content in self._files.items()}

    def _normalize_path(self, path):
        """Normalize path separators."""
        return str(path).replace("\\", "/").strip("/")


class ContextManager:
    """Central state holder for an LLM session.

    Manages conversation history, file context, token budgets,
    and coordinates prompt assembly.
    """

    def __init__(self, model_name=None, repo_root=None,
                 cache_target_tokens=1536, compaction_config=None,
                 system_prompt=""):
        self._model_name = model_name or "anthropic/claude-sonnet-4-20250514"
        self._repo_root = repo_root
        self._cache_target_tokens = cache_target_tokens
        self._compaction_config = compaction_config or {}
        self._system_prompt = system_prompt

        # Core components
        self._counter = TokenCounter(self._model_name)
        self._file_context = FileContext(repo_root)
        self._history = []  # list of {role, content} dicts

        # Stability tracker and compactor (set up later via init methods)
        self._stability_tracker = None
        self._compactor = None

        # URL context
        self._url_context = []  # list of formatted URL strings

        # Review context
        self._review_context = None  # string or None

        # Mode
        self._mode = Mode.CODE

    # === Mode ===

    @property
    def mode(self):
        return self._mode

    def set_mode(self, mode):
        """Switch mode. Caller is responsible for rebuilding context."""
        if isinstance(mode, str):
            mode = Mode(mode)
        self._mode = mode

    # === Conversation History ===

    def add_message(self, role, content):
        """Append single message to history."""
        self._history.append({"role": role, "content": content})

    def add_exchange(self, user_content, assistant_content):
        """Append user/assistant pair atomically."""
        self._history.append({"role": "user", "content": user_content})
        self._history.append({"role": "assistant", "content": assistant_content})

    def get_history(self):
        """Return a copy of conversation history."""
        return [dict(m) for m in self._history]

    def set_history(self, messages):
        """Replace history entirely (after compaction or session load)."""
        self._history = [dict(m) for m in messages]

    def clear_history(self):
        """Empty history and purge stability tracker history entries."""
        self._history.clear()
        if self._stability_tracker:
            self._stability_tracker.purge_history_items()

    def reregister_history_items(self):
        """Purge stability entries without clearing history."""
        if self._stability_tracker:
            self._stability_tracker.purge_history_items()

    def history_token_count(self):
        """Token count of current history."""
        return self._counter.count_messages(self._history)

    # === File Context Delegation ===

    @property
    def file_context(self):
        return self._file_context

    # === Token Budget ===

    @property
    def counter(self):
        return self._counter

    def get_token_budget(self):
        """Token budget report."""
        history_tokens = self.history_token_count()
        max_history = self._counter.max_history_tokens
        max_input = self._counter.max_input_tokens
        remaining = max_input - history_tokens - self._file_context.count_tokens(self._counter)
        return {
            "history_tokens": history_tokens,
            "max_history_tokens": max_history,
            "max_input_tokens": max_input,
            "remaining": max(0, remaining),
            "needs_summary": self.should_compact(),
        }

    def should_compact(self):
        """Check if compaction should run. Delegates to compactor."""
        if self._compactor is None:
            logger.debug("Compaction check: no compactor instance")
            return False
        return self._compactor.should_compact(self._history)

    def get_compaction_status(self):
        """Return compaction status info."""
        if self._compactor:
            trigger = self._compactor.trigger_tokens
            enabled = self._compactor.enabled
        else:
            trigger = self._compaction_config.get("compaction_trigger_tokens", 24000)
            enabled = self._compaction_config.get("enabled", False)
        current = self.history_token_count()
        return {
            "enabled": enabled,
            "trigger_tokens": trigger,
            "current_tokens": current,
            "percent": round((current / trigger * 100) if trigger > 0 else 0, 1),
        }

    # === Compactor Integration ===

    def init_compactor(self, compactor):
        """Attach a history compactor instance."""
        self._compactor = compactor

    async def compact_history_if_needed(self, already_checked=False):
        """Run compaction if threshold exceeded. Returns compaction result or None."""
        if not already_checked and not self.should_compact():
            return None

        logger.info(f"🗜️  Compaction starting — {len(self._history)} messages, {self.history_token_count():,} tokens")
        result = await self._compactor.compact(self._history)
        case = result.get("case", "?") if result else "null"
        msg_count = len(result.get("messages", [])) if result else 0
        logger.info(f"🗜️  Compaction result: case={case}, messages: {len(self._history)} → {msg_count}")
        if result and result.get("case") != "none":
            self.set_history(result["messages"])
            self.reregister_history_items()
            logger.info(f"🗜️  History replaced — now {len(self._history)} messages, {self.history_token_count():,} tokens")
        return result

    # === Stability Tracker Integration ===

    def set_stability_tracker(self, tracker):
        """Attach a stability tracker instance."""
        self._stability_tracker = tracker

    # === System Prompt ===

    def set_system_prompt(self, prompt):
        """Replace the system prompt (e.g., for review mode swap)."""
        self._system_prompt = prompt

    def get_system_prompt(self):
        """Return the current system prompt."""
        return self._system_prompt

    # === URL Context ===

    def set_url_context(self, url_parts):
        """Set URL context parts for prompt assembly."""
        self._url_context = list(url_parts) if url_parts else []

    def clear_url_context(self):
        """Clear URL context."""
        self._url_context.clear()

    # === Review Context ===

    def set_review_context(self, review_text):
        """Set review context string for prompt assembly."""
        self._review_context = review_text if review_text else None

    def clear_review_context(self):
        """Clear review context."""
        self._review_context = None

    # === Budget Enforcement ===

    def shed_files_if_needed(self):
        """Pre-request shedding: drop largest files if total exceeds 90% of max_input.

        Returns list of shed file paths (empty if none shed).
        """
        max_input = self._counter.max_input_tokens
        threshold = int(max_input * 0.9)

        shed = []
        while True:
            total = self._estimate_total_tokens()
            if total <= threshold:
                break

            files = self._file_context.get_files()
            if not files:
                break

            # Find largest file
            tokens_by_file = self._file_context.get_tokens_by_file(self._counter)
            if not tokens_by_file:
                break

            largest = max(tokens_by_file, key=tokens_by_file.get)
            self._file_context.remove_file(largest)
            shed.append(largest)
            logger.warning(f"Shed file from context (budget): {largest}")

        return shed

    def emergency_truncate(self):
        """Emergency truncation: drop oldest messages if history is way too large.

        Triggers when history > 2x compaction trigger.
        Preserves user/assistant pairs.
        """
        if self._compactor:
            trigger = self._compactor.trigger_tokens
        else:
            trigger = self._compaction_config.get("compaction_trigger_tokens", 24000)
        limit = trigger * 2

        if self.history_token_count() <= limit:
            return

        # Drop pairs from the front until under limit
        while self.history_token_count() > limit and len(self._history) >= 2:
            # Remove oldest pair
            self._history.pop(0)
            if self._history and self._history[0]["role"] == "assistant":
                self._history.pop(0)

    def _estimate_total_tokens(self):
        """Estimate total prompt tokens (system + files + history + overhead)."""
        total = 0
        total += self._counter.count(self._system_prompt)
        total += self._file_context.count_tokens(self._counter)
        total += self.history_token_count()
        total += 500  # overhead for headers, formatting
        return total

    # === Prompt Assembly (Non-Tiered) ===

    def assemble_messages(self, user_prompt, images=None,
                          symbol_map="", symbol_legend="",
                          file_tree="", graduated_files=None):
        """Assemble the complete message array for the LLM.

        Non-tiered assembly (no cache_control markers).

        Args:
            user_prompt: current user message text
            images: list of base64-encoded image data URIs
            symbol_map: compact symbol map text
            symbol_legend: symbol map legend text
            file_tree: flat file tree text
            graduated_files: set of file paths graduated to cached tiers (excluded from active)

        Returns:
            list of message dicts
        """
        graduated = set(graduated_files or [])
        messages = []

        # [0] System message: system prompt + legend + symbol map
        system_content = self._system_prompt
        if symbol_legend or symbol_map:
            map_header = DOC_MAP_HEADER if self._mode == Mode.DOC else REPO_MAP_HEADER
            system_content += "\n\n" + map_header
            if symbol_legend:
                system_content += symbol_legend + "\n\n"
            if symbol_map:
                system_content += symbol_map

        messages.append({"role": "system", "content": system_content})

        # File tree as user/assistant pair
        if file_tree:
            messages.append({"role": "user", "content": FILE_TREE_HEADER + file_tree})
            messages.append({"role": "assistant", "content": "Ok."})

        # URL context as user/assistant pair
        if self._url_context:
            url_text = "\n---\n".join(self._url_context)
            messages.append({"role": "user", "content": URL_CONTEXT_HEADER + url_text})
            messages.append({"role": "assistant", "content": "Ok, I've reviewed the URL content."})

        # Review context as user/assistant pair
        if self._review_context:
            messages.append({"role": "user", "content": REVIEW_CONTEXT_HEADER + self._review_context})
            messages.append({"role": "assistant", "content": "Ok, I've reviewed the code changes."})

        # Active files as user/assistant pair
        active_files = self._file_context.get_files()
        active_files = [f for f in active_files if f not in graduated]
        if active_files:
            parts = []
            for path in active_files:
                content = self._file_context.get_content(path)
                if content is not None:
                    parts.append(f"{path}\n```\n{content}\n```")
            if parts:
                files_text = "\n\n".join(parts)
                messages.append({"role": "user", "content": FILES_ACTIVE_HEADER + files_text})
                messages.append({"role": "assistant", "content": "Ok."})

        # History messages
        for msg in self._history:
            messages.append(dict(msg))

        # Current user prompt
        if images:
            content_blocks = [{"type": "text", "text": user_prompt}]
            for img in images:
                content_blocks.append({
                    "type": "image_url",
                    "image_url": {"url": img}
                })
            messages.append({"role": "user", "content": content_blocks})
        else:
            messages.append({"role": "user", "content": user_prompt})

        return messages

    def estimate_prompt_tokens(self, user_prompt="", images=None,
                                symbol_map="", symbol_legend="",
                                file_tree=""):
        """Estimate total tokens for a prompt assembly."""
        messages = self.assemble_messages(
            user_prompt=user_prompt,
            images=images,
            symbol_map=symbol_map,
            symbol_legend=symbol_legend,
            file_tree=file_tree,
        )
        return self._counter.count_messages(messages)

    # === Tiered Prompt Assembly ===

    def assemble_tiered_messages(self, user_prompt, images=None,
                                  symbol_map="", symbol_legend="",
                                  doc_legend="",
                                  file_tree="",
                                  tiered_content=None):
        """Assemble message array with cache tier breakpoints.

        Args:
            user_prompt: current user message text
            images: list of base64 image data URIs
            symbol_map: compact symbol map for active (non-tiered) display
            symbol_legend: legend text
            doc_legend: document index legend text (included when cross-ref active)
            file_tree: flat file tree text
            tiered_content: dict with keys l0, l1, l2, l3, each containing:
                {symbols: str, files: str, history: list[{role, content}]}

        Returns:
            list of message dicts with cache_control markers
        """
        tiers = tiered_content or {}
        messages = []

        # L0: System message
        l0 = tiers.get("l0", {})
        system_parts = [self._system_prompt]
        if symbol_legend or doc_legend or symbol_map or l0.get("symbols"):
            map_header = DOC_MAP_HEADER if self._mode == Mode.DOC else REPO_MAP_HEADER
            system_parts.append(map_header)
            if symbol_legend:
                system_parts.append(symbol_legend)
            if doc_legend:
                # Cross-reference mode: include the other index's legend.
                # Use the opposite header from the primary mode's header.
                cross_header = REPO_MAP_HEADER if self._mode == Mode.DOC else DOC_MAP_HEADER
                system_parts.append(cross_header)
                system_parts.append(doc_legend)
            if l0.get("symbols"):
                system_parts.append(l0["symbols"])
            elif symbol_map:
                system_parts.append(symbol_map)
        if l0.get("files"):
            system_parts.append(FILES_L0_HEADER + l0["files"])

        system_content = "\n\n".join(p for p in system_parts if p)

        l0_history = l0.get("history", [])
        if not l0_history:
            # Cache control on system message itself
            messages.append({
                "role": "system",
                "content": [{"type": "text", "text": system_content,
                             "cache_control": {"type": "ephemeral"}}]
            })
        else:
            messages.append({"role": "system", "content": system_content})
            for i, msg in enumerate(l0_history):
                if i == len(l0_history) - 1:
                    messages.append({
                        "role": msg["role"],
                        "content": [{"type": "text", "text": msg["content"],
                                     "cache_control": {"type": "ephemeral"}}]
                    })
                else:
                    messages.append(dict(msg))

        # L1, L2, L3 blocks
        file_headers = {"l1": FILES_L1_HEADER, "l2": FILES_L2_HEADER, "l3": FILES_L3_HEADER}
        for tier_key in ("l1", "l2", "l3"):
            tier = tiers.get(tier_key, {})
            tier_symbols = tier.get("symbols", "")
            tier_files = tier.get("files", "")
            tier_history = tier.get("history", [])

            if not tier_symbols and not tier_files and not tier_history:
                continue

            # Build user content
            user_parts = []
            if tier_symbols:
                user_parts.append(TIER_SYMBOLS_HEADER + tier_symbols)
            if tier_files:
                user_parts.append(file_headers[tier_key] + tier_files)

            if user_parts:
                messages.append({"role": "user", "content": "\n\n".join(user_parts)})
                messages.append({"role": "assistant", "content": "Ok."})

            # Tier history
            for msg in tier_history:
                messages.append(dict(msg))

            # Cache control on last message in tier sequence
            if messages:
                last = messages[-1]
                content = last.get("content", "")
                if isinstance(content, str):
                    messages[-1] = {
                        "role": last["role"],
                        "content": [{"type": "text", "text": content,
                                     "cache_control": {"type": "ephemeral"}}]
                    }

        # Uncached sections: file tree, URL context, active files, active history
        if file_tree:
            messages.append({"role": "user", "content": FILE_TREE_HEADER + file_tree})
            messages.append({"role": "assistant", "content": "Ok."})

        if self._url_context:
            url_text = "\n---\n".join(self._url_context)
            messages.append({"role": "user", "content": URL_CONTEXT_HEADER + url_text})
            messages.append({"role": "assistant", "content": "Ok, I've reviewed the URL content."})

        # Review context as user/assistant pair
        if self._review_context:
            messages.append({"role": "user", "content": REVIEW_CONTEXT_HEADER + self._review_context})
            messages.append({"role": "assistant", "content": "Ok, I've reviewed the code changes."})

        # Active files (non-graduated)
        graduated = set()
        if tiered_content:
            for tk in ("l0", "l1", "l2", "l3"):
                tier = tiered_content.get(tk, {})
                graduated.update(tier.get("graduated_files", []))

        active_files = [f for f in self._file_context.get_files() if f not in graduated]
        if active_files:
            parts = []
            for path in active_files:
                content = self._file_context.get_content(path)
                if content is not None:
                    parts.append(f"{path}\n```\n{content}\n```")
            if parts:
                files_text = "\n\n".join(parts)
                messages.append({"role": "user", "content": FILES_ACTIVE_HEADER + files_text})
                messages.append({"role": "assistant", "content": "Ok."})

        # Active history
        active_history_indices = set()
        if tiered_content:
            for tk in ("l0", "l1", "l2", "l3"):
                tier = tiered_content.get(tk, {})
                active_history_indices.update(tier.get("graduated_history_indices", []))

        for i, msg in enumerate(self._history):
            if i not in active_history_indices:
                messages.append(dict(msg))

        # Current user prompt
        if images:
            content_blocks = [{"type": "text", "text": user_prompt}]
            for img in images:
                content_blocks.append({
                    "type": "image_url",
                    "image_url": {"url": img}
                })
            messages.append({"role": "user", "content": content_blocks})
        else:
            messages.append({"role": "user", "content": user_prompt})

        return messages
