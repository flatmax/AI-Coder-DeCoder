"""
History management mixin for context manager.

Handles conversation history side-loading and summarization.
"""


class HistoryMixin:
    """Mixin for history management operations."""

    def add_exchange(self, user_msg: str, assistant_msg: str):
        """Side-load a completed exchange into history"""
        self.done_messages.append({"role": "user", "content": user_msg})
        self.done_messages.append({"role": "assistant", "content": assistant_msg})

    def add_message(self, role: str, content: str):
        """Side-load a single message into history"""
        self.done_messages.append({"role": role, "content": content})

    def get_history(self) -> list:
        return self.done_messages.copy()

    def set_history(self, messages: list):
        """Replace history entirely (e.g., after your own summarization)"""
        self.done_messages = messages.copy()
        print(f"📊 History reset: {len(messages)} messages")
        self.print_hud()

    def clear_history(self):
        """Clear chat history (like aider's /clear)"""
        self.done_messages = []
        print("📊 History cleared")
        self.print_hud()

    def clear(self):
        """Alias for clear_history - matches aider's /clear command"""
        self.clear_history()

    def reset(self):
        """Clear history and reset state (like aider's /reset)"""
        self.done_messages = []
        self._last_repo_map_tokens = 0
        self._last_chat_files_count = 0
        print("📊 Context reset (history cleared)")
        self.print_hud()

    def history_too_big(self) -> bool:
        if not self.done_messages:
            return False
        return self.count_tokens(self.done_messages) > self.max_history_tokens

    def get_summarization_split(self) -> tuple:
        """
        Returns (head, tail) for summarization.
        Head = messages to summarize (~75%)
        Tail = recent messages to keep verbatim (~25%)
        """
        if not self.history_too_big():
            return [], self.done_messages.copy()

        tail_budget = self.max_history_tokens // 4
        tail = []
        tail_tokens = 0

        for msg in reversed(self.done_messages):
            msg_tokens = self.count_tokens(msg)
            if tail_tokens + msg_tokens > tail_budget:
                break
            tail.insert(0, msg)
            tail_tokens += msg_tokens

        head_count = len(self.done_messages) - len(tail)
        head = self.done_messages[:head_count]

        return head, tail
