from .config import ConfigMixin
from .file_context import FileContextMixin
from .chat import ChatMixin


class LiteLLM(ConfigMixin, FileContextMixin, ChatMixin):
    """LiteLLM wrapper for AI completions with file context support."""
    
    def __init__(self, repo=None, config_path=None):
        """
        Initialize LiteLLM with optional repository.
        
        Args:
            repo: Repo instance for file access. If None, file operations won't be available.
            config_path: Path to llm.json config file. If None, looks in ac/ directory.
        """
        self.repo = repo
        self.conversation_history = []
        
        # Load configuration
        self.config = self._load_config(config_path)
        
        # Apply environment variables from config
        self._apply_env_vars()
        
        # Set model from config or use default
        self.model = self.config.get('model', 'gpt-4o-mini')
        self.smaller_model = self.config.get('smallerModel', 'gpt-4o-mini')
    
    def set_model(self, model):
        """Set the LLM model to use."""
        self.model = model
        return f"Model set to: {model}"
    
    def get_model(self):
        """Get the current model name."""
        return self.model
    
    def get_smaller_model(self):
        """Get the smaller/faster model name."""
        return self.smaller_model
    
    def get_config(self):
        """Get the current configuration."""
        return {
            'model': self.model,
            'smallerModel': self.smaller_model,
            'env': {k: v for k, v in self.config.get('env', {}).items()}
        }
    
    def ping(self):
        """Simple ping to test connection."""
        print('ping returning pong')
        return "pong"
    
    def clear_history(self):
        """Clear the conversation history."""
        self.conversation_history = []
        return "Conversation history cleared"
