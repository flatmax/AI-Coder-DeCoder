import base64
import json
import mimetypes
import os

from litellm import completion


class LiteLLM:
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
    
    def _load_config(self, config_path=None):
        """
        Load configuration from llm.json file.
        
        Args:
            config_path: Optional path to config file
        
        Returns:
            Dict with configuration settings
        """
        if config_path is None:
            # Look for llm.json in the ac/ directory (same directory as this file)
            config_path = os.path.join(os.path.dirname(__file__), 'llm.json')
        
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            print(f"Config file not found: {config_path}, using defaults")
            return {}
        except json.JSONDecodeError as e:
            print(f"Error parsing config file: {e}, using defaults")
            return {}
    
    def _apply_env_vars(self):
        """Apply environment variables from config."""
        env_vars = self.config.get('env', {})
        for key, value in env_vars.items():
            os.environ[key] = value
            print(f"Set environment variable: {key}={value}")
    
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
    
    def load_files_as_context(self, file_paths, version='working'):
        """
        Load multiple files from the repository as context.
        
        Args:
            file_paths: List of file paths relative to repo root
            version: 'working', 'HEAD', or commit hash
        
        Returns:
            List of dicts with file path and content
        """
        if not self.repo:
            return [{'error': 'No repository configured'}]
        
        files_content = []
        for file_path in file_paths:
            if self.repo.is_binary_file(file_path):
                files_content.append({
                    'path': file_path,
                    'content': None,
                    'is_binary': True,
                    'error': 'Binary file - content not loaded as text'
                })
                continue
            
            content = self.repo.get_file_content(file_path, version)
            if isinstance(content, dict) and 'error' in content:
                files_content.append({
                    'path': file_path,
                    'content': None,
                    'error': content['error']
                })
            else:
                files_content.append({
                    'path': file_path,
                    'content': content,
                    'is_binary': False
                })
        
        return files_content
    
    def _format_files_for_prompt(self, files_content):
        """Format loaded files into a prompt-friendly string."""
        formatted_parts = []
        for file_info in files_content:
            if file_info.get('error'):
                formatted_parts.append(f"File: {file_info['path']}\nError: {file_info['error']}\n")
            elif file_info.get('is_binary'):
                formatted_parts.append(f"File: {file_info['path']}\n[Binary file]\n")
            else:
                formatted_parts.append(
                    f"File: {file_info['path']}\n```\n{file_info['content']}\n```\n"
                )
        return "\n".join(formatted_parts)
    
    def _build_messages(self, user_prompt, files_content=None, images=None, system_prompt=None):
        """
        Build the messages array for the LLM API call.
        
        Args:
            user_prompt: The user's message
            files_content: Optional list of file content dicts
            images: Optional list of base64 encoded images
            system_prompt: Optional system prompt
        
        Returns:
            List of message dicts for the API
        """
        messages = []
        
        # Add system prompt if provided
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        
        # Add conversation history
        messages.extend(self.conversation_history)
        
        # Build user message content
        user_content = []
        
        # Add file context if provided
        if files_content:
            file_context = self._format_files_for_prompt(files_content)
            user_content.append({
                "type": "text",
                "text": f"Here are the relevant files:\n\n{file_context}"
            })
        
        # Add images if provided
        if images:
            for image_data in images:
                if isinstance(image_data, dict):
                    # Already formatted with mime type
                    mime_type = image_data.get('mime_type', 'image/png')
                    base64_data = image_data.get('data')
                else:
                    # Assume base64 string, default to png
                    mime_type = 'image/png'
                    base64_data = image_data
                
                user_content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{mime_type};base64,{base64_data}"
                    }
                })
        
        # Add the user's text prompt
        user_content.append({
            "type": "text",
            "text": user_prompt
        })
        
        # If only text content, simplify the message format
        if len(user_content) == 1 and user_content[0]["type"] == "text":
            messages.append({"role": "user", "content": user_prompt})
        else:
            messages.append({"role": "user", "content": user_content})
        
        return messages
    
    def chat(self, user_prompt, file_paths=None, images=None, system_prompt=None, 
             file_version='working', stream=False, use_smaller_model=False):
        """
        Send a chat message with optional file and image context.
        
        Args:
            user_prompt: The user's message
            file_paths: Optional list of file paths to include as context
            images: Optional list of base64 encoded images or dicts with 'data' and 'mime_type'
            system_prompt: Optional system prompt
            file_version: Version of files to load ('working', 'HEAD', or commit hash)
            stream: Whether to stream the response (not yet implemented)
            use_smaller_model: Whether to use the smaller/faster model
        
        Returns:
            The assistant's response text
        """
        # Load file contents if paths provided
        files_content = None
        if file_paths:
            files_content = self.load_files_as_context(file_paths, file_version)
        
        # Build messages
        messages = self._build_messages(user_prompt, files_content, images, system_prompt)
        
        # Select model
        model = self.smaller_model if use_smaller_model else self.model
        
        try:
            # Call LiteLLM
            response = completion(
                model=model,
                messages=messages
            )
            
            assistant_message = response.choices[0].message.content
            
            # Store in conversation history (simplified version without images)
            self.conversation_history.append({"role": "user", "content": user_prompt})
            self.conversation_history.append({"role": "assistant", "content": assistant_message})
            
            return assistant_message
            
        except Exception as e:
            error_msg = f"Error calling LLM: {str(e)}"
            print(error_msg)
            return error_msg
    
    def list_files_in_context(self, file_paths):
        """
        Check which files exist and can be loaded.
        
        Args:
            file_paths: List of file paths to check
        
        Returns:
            Dict with 'valid' and 'invalid' file lists
        """
        if not self.repo:
            return {'error': 'No repository configured'}
        
        valid = []
        invalid = []
        
        for file_path in file_paths:
            if self.repo.file_exists(file_path):
                is_binary = self.repo.is_binary_file(file_path)
                valid.append({
                    'path': file_path,
                    'is_binary': is_binary
                })
            else:
                invalid.append(file_path)
        
        return {'valid': valid, 'invalid': invalid}
