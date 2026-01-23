"""
Token counting utilities using litellm.
"""

import litellm as _litellm


class TokenCounter:
    """Wraps litellm token counting - satisfies RepoMap's main_model interface"""
    
    def __init__(self, model_name: str):
        self.model_name = model_name
        try:
            self.info = _litellm.get_model_info(model_name)
        except Exception:
            self.info = {"max_input_tokens": 128000, "max_output_tokens": 4096}

    def token_count(self, content) -> int:
        try:
            if isinstance(content, str):
                return _litellm.token_counter(model=self.model_name, text=content)
            elif isinstance(content, list):
                return _litellm.token_counter(model=self.model_name, messages=content)
            elif isinstance(content, dict):
                return _litellm.token_counter(model=self.model_name, messages=[content])
        except Exception:
            # Fallback: rough estimate
            if isinstance(content, str):
                return len(content) // 4
            return 0
        return 0
