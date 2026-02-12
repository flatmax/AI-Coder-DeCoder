"""Model-aware token counting with fallback estimation."""

import logging

logger = logging.getLogger(__name__)

# Fallback: ~4 characters per token
CHARS_PER_TOKEN = 4


class TokenCounter:
    """Token counter that uses tiktoken when available, with fallback estimation."""

    def __init__(self, model_name="anthropic/claude-sonnet-4-20250514"):
        self._model_name = model_name
        self._encoder = None
        self._init_encoder()

    def _init_encoder(self):
        """Initialize the tokenizer for the model."""
        try:
            import tiktoken
            # Most Anthropic/OpenAI models use cl100k_base
            self._encoder = tiktoken.get_encoding("cl100k_base")
        except Exception as e:
            logger.warning(f"Failed to initialize tiktoken: {e}. Using fallback estimation.")

    def count(self, text):
        """Count tokens in a string."""
        if not text:
            return 0
        if isinstance(text, list):
            return self.count_messages(text)
        if isinstance(text, dict):
            return self.count_message(text)
        if not isinstance(text, str):
            text = str(text)
        if self._encoder:
            try:
                return len(self._encoder.encode(text))
            except Exception:
                pass
        return max(1, len(text) // CHARS_PER_TOKEN)

    def count_message(self, message):
        """Count tokens in a single message dict."""
        content = message.get("content", "")
        if isinstance(content, list):
            # Multimodal content
            total = 0
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text":
                        total += self.count(block.get("text", ""))
                    elif block.get("type") == "image_url":
                        total += 1000  # Fallback image token estimate
                else:
                    total += self.count(str(block))
            return total + 4  # Message overhead
        return self.count(content) + 4  # Message overhead

    def count_messages(self, messages):
        """Count tokens in a list of messages."""
        return sum(self.count_message(m) for m in messages)

    @property
    def model_name(self):
        return self._model_name

    @property
    def max_input_tokens(self):
        """Maximum input tokens for the model."""
        model = self._model_name.lower()
        if "claude" in model:
            if "opus" in model:
                return 200000
            return 200000  # Sonnet, Haiku
        if "gpt-4" in model:
            return 128000
        if "gpt-3.5" in model:
            return 16385
        return 200000  # Default

    @property
    def max_output_tokens(self):
        """Maximum output tokens for the model."""
        model = self._model_name.lower()
        if "claude" in model:
            return 8192
        if "gpt-4" in model:
            return 4096
        return 4096

    @property
    def max_history_tokens(self):
        """Maximum tokens for conversation history (1/16 of max input)."""
        return self.max_input_tokens // 16
