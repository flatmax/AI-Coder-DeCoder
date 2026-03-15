"""Token counting — model-aware with fallback estimation."""

import logging
from typing import Optional, Union

logger = logging.getLogger(__name__)


class TokenCounter:
    """Model-aware token counter using tiktoken with fallback.

    Provides token counting for strings, message dicts, and lists.
    Also exposes model limits (max_input_tokens, max_output_tokens).
    """

    def __init__(self, model_name: str = "anthropic/claude-sonnet-4-20250514"):
        self._model_name = model_name
        self._encoding = None
        self._max_input_tokens: Optional[int] = None
        self._max_output_tokens: Optional[int] = None
        self._init_encoding()
        self._init_model_info()

    def _init_encoding(self):
        """Initialize tiktoken encoding for the model."""
        try:
            import tiktoken
            # Try model-specific encoding
            try:
                self._encoding = tiktoken.encoding_for_model(self._model_name)
            except KeyError:
                # Fallback to cl100k_base (GPT-4/Claude compatible)
                self._encoding = tiktoken.get_encoding("cl100k_base")
        except Exception as e:
            logger.warning(f"tiktoken unavailable: {e}; using character estimate")
            self._encoding = None

    def _init_model_info(self):
        """Load model limits from litellm."""
        try:
            import litellm
            info = litellm.get_model_info(self._model_name)
            if info:
                self._max_input_tokens = info.get("max_input_tokens")
                self._max_output_tokens = info.get("max_output_tokens")
        except Exception as e:
            logger.debug(f"litellm model info unavailable for {self._model_name}: {e}")

        # Hardcoded fallbacks
        if not self._max_input_tokens:
            self._max_input_tokens = self._default_max_input()
        if not self._max_output_tokens:
            self._max_output_tokens = self._default_max_output()

    def _default_max_input(self) -> int:
        lower = self._model_name.lower()
        if "opus" in lower:
            return 200000
        if "sonnet" in lower:
            return 200000
        if "haiku" in lower:
            return 200000
        if "gpt-4" in lower:
            return 128000
        return 200000

    def _default_max_output(self) -> int:
        lower = self._model_name.lower()
        if "opus" in lower:
            return 32000
        if "sonnet" in lower:
            return 16000
        if "haiku" in lower:
            return 8192
        if "gpt-4" in lower:
            return 16384
        return 16000

    @property
    def max_input_tokens(self) -> int:
        return self._max_input_tokens

    @property
    def max_output_tokens(self) -> int:
        return self._max_output_tokens

    @property
    def max_history_tokens(self) -> int:
        """Computed: max_input_tokens / 16."""
        return self._max_input_tokens // 16

    def count(self, text: Union[str, dict, list]) -> int:
        """Count tokens in a string, message dict, or list of messages."""
        if isinstance(text, str):
            return self._count_string(text)
        elif isinstance(text, dict):
            return self._count_message(text)
        elif isinstance(text, list):
            return sum(self._count_message(m) if isinstance(m, dict)
                       else self._count_string(str(m)) for m in text)
        return 0

    def _count_string(self, text: str) -> int:
        """Count tokens in a string."""
        if not text:
            return 0
        if self._encoding:
            try:
                return len(self._encoding.encode(text))
            except Exception:
                pass
        # Fallback: ~4 chars per token
        return len(text) // 4

    def _count_message(self, message: dict) -> int:
        """Count tokens in a message dict ({role, content})."""
        content = message.get("content", "")
        if isinstance(content, str):
            return self._count_string(content) + 4  # role overhead
        elif isinstance(content, list):
            # Multimodal content blocks
            total = 4
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text":
                        total += self._count_string(block.get("text", ""))
                    elif block.get("type") == "image_url":
                        total += 1000  # Estimate per image
                else:
                    total += self._count_string(str(block))
            return total
        return 4