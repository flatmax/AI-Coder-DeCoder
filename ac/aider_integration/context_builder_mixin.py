"""
Context building mixin for context manager.

Handles assembling full message lists for LLM calls.
"""


class ContextBuilderMixin:
    """Mixin for context assembly operations."""

    def build_messages(
        self,
        system_prompt: str,
        chat_files: list,
        current_message: str,
        mentioned_fnames: set = None,
        mentioned_idents: set = None,
        include_repo_map: bool = True,
        include_file_contents: bool = True,
    ) -> list:
        """
        Assemble full message list for your litellm call.
        Order: system → repo_map → files → history → current
        """
        messages = [{"role": "system", "content": system_prompt}]

        if include_repo_map:
            repo = self.get_repo_map(chat_files, mentioned_fnames, mentioned_idents)
            if repo:
                messages.append({"role": "user", "content": f"Repository map:\n{repo}"})
                messages.append({"role": "assistant", "content": "Ok."})

        if include_file_contents:
            files_content = self.format_files(chat_files)
            if files_content:
                messages.append({"role": "user", "content": files_content})
                messages.append({"role": "assistant", "content": "Ok."})

        messages.extend(self.done_messages)
        messages.append({"role": "user", "content": current_message})

        # Print HUD after building messages
        self.print_hud(messages, chat_files)

        return messages

    def get_budget(self, messages: list = None) -> dict:
        """Get token budget information."""
        max_input = self.token_counter.info.get("max_input_tokens", 128000)
        used = self.count_tokens(messages) if messages else 0
        return {
            "used": used,
            "max_input": max_input,
            "remaining": max_input - used,
            "history_tokens": self.count_tokens(self.done_messages),
            "history_budget": self.max_history_tokens,
        }
