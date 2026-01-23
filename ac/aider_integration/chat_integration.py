"""
Integration of AiderEditor with LiteLLM chat.

Provides a high-level interface for requesting code changes via LLM
and applying them using aider's search/replace format.
"""

import litellm as _litellm

from .editor import AiderEditor
from .message_builder import MessageBuilderMixin
from .context_manager import AiderContextManager


class AiderChat(MessageBuilderMixin):
    """
    High-level interface for LLM-based code editing using aider's format.
    
    Combines LiteLLM for LLM calls with AiderEditor for parsing and applying edits.
    Uses AiderContextManager for repo map and token management.
    """
    
    def __init__(self, model="gpt-4", repo=None):
        """
        Initialize the chat interface.
        
        Args:
            model: The LiteLLM model identifier
            repo: Optional Repo instance for file access
        """
        self.model = model
        self.repo = repo
        self.editor = AiderEditor(repo=repo)
        self.messages = []
        
        # Initialize context manager if we have a repo
        self._context_manager = None
        if repo:
            try:
                self._context_manager = AiderContextManager(
                    repo_root=repo.get_repo_root(),
                    model_name=model
                )
            except Exception as e:
                print(f"Warning: Could not initialize context manager: {e}")
    
    @property
    def context_manager(self):
        """Get the context manager, creating if needed."""
        return self._context_manager
    
    def add_file(self, filepath):
        """Add a file to the editing context."""
        if self.repo:
            content = self.repo.get_file_content(filepath)
            if isinstance(content, dict) and 'error' in content:
                raise FileNotFoundError(content['error'])
            self.editor.add_file_content(filepath, content)
        else:
            self.editor.add_file(filepath)
    
    def add_file_content(self, filepath, content):
        """Add a file with provided content."""
        self.editor.add_file_content(filepath, content)
    
    def get_files(self):
        """Get list of files in context."""
        return self.editor.get_file_list()
    
    def clear_files(self):
        """Clear all files from context."""
        self.editor.clear_files()
    
    def clear_history(self):
        """Clear conversation history."""
        self.messages = []
        if self._context_manager:
            self._context_manager.clear_history()
    
    def get_token_budget(self, messages=None):
        """Get token budget information."""
        if self._context_manager:
            return self._context_manager.get_budget(messages)
        return {"used": 0, "max_input": 128000, "remaining": 128000}
    
    def request_changes(self, user_request, include_examples=True, images=None, use_repo_map=True):
        """
        Send a request to the LLM and parse the response for edits.
        
        Args:
            user_request: The user's request for changes
            include_examples: Whether to include few-shot examples
            images: Optional list of image dicts with 'data' and 'mime_type'
            use_repo_map: Whether to include repo map in context
            
        Returns:
            Dict with:
            - file_edits: List of (filename, original, updated) tuples
            - shell_commands: List of shell command strings
            - response: The raw LLM response text
            - token_budget: Token usage information
        """
        messages, user_text = self._build_messages(
            user_request, images, include_examples, use_repo_map
        )
        
        response = _litellm.completion(
            model=self.model,
            messages=messages,
        )
        
        assistant_content = response.choices[0].message.content
        
        # Store in conversation history (text version only)
        self.messages.append({"role": "user", "content": user_text})
        self.messages.append({"role": "assistant", "content": assistant_content})
        
        # Also update context manager history
        if self._context_manager:
            self._context_manager.add_exchange(user_text, assistant_content)
        
        file_edits, shell_commands = self.editor.parse_response(assistant_content)
        
        return {
            "file_edits": file_edits,
            "shell_commands": shell_commands,
            "response": assistant_content,
            "token_budget": self.get_token_budget(messages)
        }
    
    def apply_edits(self, edits, dry_run=False):
        """
        Apply edits to files.
        
        Args:
            edits: List of (filename, original, updated) tuples
            dry_run: If True, don't actually write files
            
        Returns:
            Dict with 'passed', 'failed', and 'content'
        """
        return self.editor.apply_edits(edits, dry_run=dry_run)
    
    def request_and_apply(self, user_request, dry_run=False, include_examples=True, 
                          images=None, use_repo_map=True):
        """
        Request changes and apply them in one step.
        
        Args:
            user_request: The user's request for changes
            dry_run: If True, don't actually write files
            include_examples: Whether to include few-shot examples
            images: Optional list of image dicts with 'data' and 'mime_type'
            use_repo_map: Whether to include repo map in context
            
        Returns:
            Dict with:
            - file_edits: List of edits that were requested
            - shell_commands: List of shell commands
            - response: Raw LLM response
            - passed: List of successfully applied edits
            - failed: List of failed edits
            - content: Dict of new file contents
            - token_budget: Token usage information
        """
        result = self.request_changes(
            user_request, include_examples, images=images, use_repo_map=use_repo_map
        )
        
        if result["file_edits"]:
            apply_result = self.apply_edits(result["file_edits"], dry_run=dry_run)
            result.update(apply_result)
        else:
            result["passed"] = []
            result["failed"] = []
            result["content"] = {}
        
        return result
    
    def check_history_size(self):
        """Check if history needs summarization."""
        if self._context_manager:
            return self._context_manager.history_too_big()
        return False
    
    def get_summarization_split(self):
        """Get messages split for summarization."""
        if self._context_manager:
            return self._context_manager.get_summarization_split()
        return [], self.messages.copy()
    
    def set_summarized_history(self, summary, tail):
        """Set history after summarization."""
        new_history = [
            {"role": "user", "content": f"Summary of previous conversation:\n{summary}"},
            {"role": "assistant", "content": "Ok, I understand the context."}
        ] + tail
        
        self.messages = new_history
        if self._context_manager:
            self._context_manager.set_history(new_history)
