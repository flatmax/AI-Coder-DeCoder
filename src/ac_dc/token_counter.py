"""Token counting with model-aware tokenizer and fallback estimation."""

import logging
from typing import Any, Optional, Union

log = logging.getLogger(__name__)

# Lazy-loaded tokenizer
_tokenizer = None
_tokenizer_model = None

# Sensible defaults for common models
MODEL_INFO = {
    "default": {"max_input_tokens": 200000, "max_output_tokens": 8192},
}


def _get_tokenizer(model: str):
    """Get or create tokenizer for counting."""
    global _tokenizer, _tokenizer_model
    if _tokenizer is not None and _tokenizer_model == model:
        return _tokenizer
    try:
        import tiktoken
        # Try to get encoding for model; fall back to cl100k_base
        try:
            _tokenizer = tiktoken.encoding_for_model(model.split("/")[-1])
        except KeyError:
            _tokenizer = tiktoken.get_encoding("cl100k_base")
        _tokenizer_model = model
        return _tokenizer
    except Exception as e:
        log.warning("tiktoken unavailable: %s — using character estimation", e)
        return None


class TokenCounter:
    """Model-aware token counting."""

    def __init__(self, model: str = ""):
        self.model = model
        self._max_input: Optional[int] = None
        self._max_output: Optional[int] = None
        self._load_model_info()

    def _load_model_info(self):
        """Load model limits."""
        try:
            import litellm
            info = litellm.get_model_info(self.model)
            self._max_input = info.get("max_input_tokens", 200000)
            self._max_output = info.get("max_output_tokens", 8192)
        except Exception:
            self._max_input = 200000
            self._max_output = 8192

    @property
    def max_input_tokens(self) -> int:
        return self._max_input or 200000

    @property
    def max_output_tokens(self) -> int:
        return self._max_output or 8192

    @property
    def max_history_tokens(self) -> int:
        return self.max_input_tokens // 16

    def count(self, text: Union[str, dict, list]) -> int:
        """Count tokens in text, message dict, or list of messages."""
        if isinstance(text, list):
            return sum(self.count(item) for item in text)
        if isinstance(text, dict):
            content = text.get("content", "")
            if isinstance(content, list):
                # Multimodal content blocks
                total = 0
                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            total += self.count(block.get("text", ""))
                        elif block.get("type") == "image_url":
                            total += 1000  # Estimate per image
                    elif isinstance(block, str):
                        total += self.count(block)
                return total + 4  # Message overhead
            return self.count(str(content)) + 4
        if not isinstance(text, str):
            text = str(text)

        tokenizer = _get_tokenizer(self.model)
        if tokenizer:
            try:
                return len(tokenizer.encode(text))
            except Exception:
                pass
        # Fallback: ~4 chars per token
        return max(1, len(text) // 4)
