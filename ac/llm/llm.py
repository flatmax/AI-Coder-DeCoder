import os

from .config import ConfigMixin
from .file_context import FileContextMixin
from .chat import ChatMixin
from .streaming import StreamingMixin
from .history_mixin import HistoryMixin


class LiteLLM(ConfigMixin, FileContextMixin, ChatMixin, StreamingMixin, HistoryMixin):
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
        
        # Initialize history store
        self._init_history_store()
        
        # Token usage tracking
        self._total_prompt_tokens = 0
        self._total_completion_tokens = 0
        self._total_cache_hit_tokens = 0
        self._total_cache_write_tokens = 0
        
        # Last request tokens for HUD display
        self._last_request_tokens = None
        
        # Load configuration
        self.config = self._load_config(config_path)
        
        # Apply environment variables from config
        self._apply_env_vars()
        
        # Set model from config or use default
        self.model = self.config.get('model', 'gpt-4o-mini')
        self.smaller_model = self.config.get('smallerModel', 'gpt-4o-mini')
        
        # Lazy-loaded aider integration
        self._aider_chat = None
    
    def set_model(self, model):
        """Set the LLM model to use."""
        self.model = model
        if self._aider_chat:
            self._aider_chat.model = model
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
        """Clear the conversation history and start a new history session."""
        self.conversation_history = []
        if self._aider_chat:
            self._aider_chat.clear_history()
        # Start a new history session
        if self._history_store:
            new_session = self._history_store.new_session()
            print(f"📜 New history session: {new_session}")
        return "Conversation history cleared"
    
    def get_aider_chat(self):
        """Get or create the AiderChat instance for edit operations."""
        if self._aider_chat is None:
            from ac.aider_integration.chat_integration import AiderChat
            self._aider_chat = AiderChat(model=self.model, repo=self.repo, token_tracker=self)
        return self._aider_chat
    
    def track_token_usage(self, completion):
        """
        Extract and accumulate token usage from a litellm completion response.
        
        Args:
            completion: The litellm completion response object
        """
        if completion and hasattr(completion, "usage") and completion.usage is not None:
            prompt_tokens = completion.usage.prompt_tokens or 0
            completion_tokens = completion.usage.completion_tokens or 0
            cache_hit_tokens = getattr(completion.usage, "prompt_cache_hit_tokens", 0) or getattr(
                completion.usage, "cache_read_input_tokens", 0
            ) or 0
            cache_write_tokens = getattr(completion.usage, "cache_creation_input_tokens", 0) or 0
            
            self._total_prompt_tokens += prompt_tokens
            self._total_completion_tokens += completion_tokens
            self._total_cache_hit_tokens += cache_hit_tokens
            self._total_cache_write_tokens += cache_write_tokens
            
            # Store last request for HUD display
            self._last_request_tokens = {
                'prompt': prompt_tokens,
                'completion': completion_tokens,
                'cache_hit': cache_hit_tokens,
                'cache_write': cache_write_tokens
            }
    
    def get_token_usage(self):
        """
        Get accumulated token usage statistics.
        
        Returns:
            Dict with token usage breakdown
        """
        total_tokens = self._total_prompt_tokens + self._total_completion_tokens
        return {
            "prompt_tokens": self._total_prompt_tokens,
            "completion_tokens": self._total_completion_tokens,
            "total_tokens": total_tokens,
            "cache_hit_tokens": self._total_cache_hit_tokens,
            "cache_write_tokens": self._total_cache_write_tokens
        }
    
    def reset_token_usage(self):
        """Reset accumulated token usage statistics."""
        self._total_prompt_tokens = 0
        self._total_completion_tokens = 0
        self._total_cache_hit_tokens = 0
        self._total_cache_write_tokens = 0
        self._last_request_tokens = None
        return "Token usage statistics reset"
    
    def get_token_report(self, file_paths=None, read_only_files=None):
        """
        Get detailed token usage report (like aider's /tokens command).
        
        Args:
            file_paths: Optional list of file paths to include in context
            read_only_files: Optional list of read-only file paths
            
        Returns:
            Formatted string with token breakdown
        """
        aider = self.get_aider_chat()
        
        # Add files to context if provided
        if file_paths:
            aider.clear_files()
            for path in file_paths:
                try:
                    aider.add_file(path)
                except FileNotFoundError:
                    pass  # Skip files that don't exist
        
        return aider.get_token_report(read_only_files=read_only_files)
    
    def save_repo_map(self, output_path=None, exclude_files=None):
        """
        Save the repository map to a file.
        
        Args:
            output_path: Path to save the map. If None, saves to .aicoder/repo_map.txt
            exclude_files: Optional list of files to exclude (simulating chat context)
            
        Returns:
            Dict with path to saved file or error
        """
        aider = self.get_aider_chat()
        if not aider._context_manager:
            return {"error": "No repository configured"}
        
        try:
            # Convert exclude_files to absolute paths if provided
            abs_exclude = []
            if exclude_files and self.repo:
                repo_root = self.repo.get_repo_root()
                for fpath in exclude_files:
                    if os.path.isabs(fpath):
                        abs_exclude.append(fpath)
                    else:
                        abs_exclude.append(os.path.join(repo_root, fpath))
            
            saved_path = aider._context_manager.save_repo_map(
                output_path=output_path,
                chat_files=abs_exclude
            )
            return {"path": saved_path}
        except Exception as e:
            return {"error": str(e)}
    
    def parse_edits(self, response_text, file_paths=None):
        """
        Parse a response for search/replace blocks without applying them.
        
        Args:
            response_text: LLM response containing edit blocks
            file_paths: Optional list of valid file paths
            
        Returns:
            Dict with file_edits and shell_commands
        """
        aider = self.get_aider_chat()
        
        if file_paths:
            aider.clear_files()
            for path in file_paths:
                aider.add_file(path)
        
        file_edits, shell_commands = aider.editor.parse_response(response_text)
        return {
            "file_edits": file_edits,
            "shell_commands": shell_commands
        }
    
    def apply_edits(self, edits, dry_run=False):
        """
        Apply previously parsed edits to files.
        
        Args:
            edits: List of (filename, original, updated) tuples
            dry_run: If True, don't write changes to disk
            
        Returns:
            Dict with passed, failed, and content
        """
        aider = self.get_aider_chat()
        return aider.editor.apply_edits(edits, dry_run=dry_run)
