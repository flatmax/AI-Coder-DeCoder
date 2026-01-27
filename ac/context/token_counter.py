"""
Token counting utilities using litellm.

Provides a simple interface for counting tokens across different LLM models.
"""

import litellm as _litellm


class TokenCounter:
    """
    Token counter for LLM context management.
    
    Wraps litellm's token counting with caching of model info
    and fallback behavior for unknown models.
    """
    
    # Default model info for fallback
    DEFAULT_INFO = {
        "max_input_tokens": 128000,
        "max_output_tokens": 4096
    }
    
    def __init__(self, model_name: str):
        """
        Initialize token counter for a specific model.
        
        Args:
            model_name: The LiteLLM model identifier (e.g., "gpt-4", "claude-3-sonnet")
        """
        self.model_name = model_name
        self._info = None  # Lazy-loaded
    
    @property
    def info(self) -> dict:
        """Get model info (max tokens, etc.). Cached after first access."""
        if self._info is None:
            self._info = self._load_model_info()
        return self._info
    
    def _load_model_info(self) -> dict:
        """Load model info from litellm, with fallback for unknown models."""
        try:
            return _litellm.get_model_info(self.model_name)
        except Exception:
            return self.DEFAULT_INFO.copy()
    
    @property
    def max_input_tokens(self) -> int:
        """Get maximum input tokens for this model."""
        return self.info.get("max_input_tokens", self.DEFAULT_INFO["max_input_tokens"])
    
    @property
    def max_output_tokens(self) -> int:
        """Get maximum output tokens for this model."""
        return self.info.get("max_output_tokens", self.DEFAULT_INFO["max_output_tokens"])
    
    def count(self, content) -> int:
        """
        Count tokens in content.
        
        Args:
            content: String, message dict, or list of message dicts
            
        Returns:
            Token count (0 on error)
        """
        try:
            if isinstance(content, str):
                return _litellm.token_counter(model=self.model_name, text=content)
            elif isinstance(content, list):
                return _litellm.token_counter(model=self.model_name, messages=content)
            elif isinstance(content, dict):
                return _litellm.token_counter(model=self.model_name, messages=[content])
        except Exception:
            # Fallback: rough estimate of ~4 chars per token
            if isinstance(content, str):
                return len(content) // 4
            elif isinstance(content, list):
                total = sum(len(m.get("content", "")) for m in content if isinstance(m, dict))
                return total // 4
            elif isinstance(content, dict):
                return len(content.get("content", "")) // 4
        return 0
