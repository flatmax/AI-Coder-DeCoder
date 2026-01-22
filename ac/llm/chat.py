import litellm as _litellm


class ChatMixin:
    """Mixin for chat and message building operations."""
    
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
            response = _litellm.completion(
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
