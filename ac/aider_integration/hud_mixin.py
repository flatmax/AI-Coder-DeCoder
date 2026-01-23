"""
HUD (Heads Up Display) mixin for context manager.

Provides terminal output for token usage and context information.
"""


def _format_tokens(count):
    """Format token count with K suffix for readability."""
    if count >= 1000:
        return f"{count / 1000:.1f}K"
    return str(count)


def _progress_bar(used, total, width=20):
    """Create a simple ASCII progress bar."""
    if total == 0:
        return "[" + "?" * width + "]"
    ratio = min(used / total, 1.0)
    filled = int(width * ratio)
    bar = "█" * filled + "░" * (width - filled)
    return f"[{bar}]"


class HudMixin:
    """Mixin for HUD (Heads Up Display) operations."""

    def print_hud(self, messages: list = None, chat_files: list = None):
        """Print context HUD to terminal."""
        max_input = self.token_counter.info.get("max_input_tokens", 128000)
        max_output = self.token_counter.info.get("max_output_tokens", 4096)
        
        # Calculate token usage
        history_tokens = self.count_tokens(self.done_messages) if self.done_messages else 0
        messages_tokens = self.count_tokens(messages) if messages else 0
        repo_map_tokens = self._last_repo_map_tokens
        
        # History status
        history_status = "⚠️  NEEDS SUMMARY" if self.history_too_big() else "✓"
        
        print("\n" + "=" * 60)
        print("📊 CONTEXT HUD")
        print("=" * 60)
        print(f"Model: {self.model_name}")
        print(f"Max Input: {_format_tokens(max_input)} | Max Output: {_format_tokens(max_output)}")
        print("-" * 60)
        
        # Token breakdown
        print("Token Usage:")
        print(f"  History:    {_format_tokens(history_tokens):>8} / {_format_tokens(self.max_history_tokens)} {history_status}")
        print(f"  Repo Map:   {_format_tokens(repo_map_tokens):>8}")
        if messages_tokens:
            print(f"  Total Msg:  {_format_tokens(messages_tokens):>8} / {_format_tokens(max_input)}")
            print(f"  {_progress_bar(messages_tokens, max_input, 40)} {messages_tokens * 100 // max_input}%")
        
        print("-" * 60)
        
        # History info
        print(f"History: {len(self.done_messages)} messages")
        if chat_files:
            print(f"Chat Files: {len(chat_files)} files")
        
        # Session totals from token tracker - horizontal layout
        if self.token_tracker and hasattr(self.token_tracker, 'get_token_usage'):
            usage = self.token_tracker.get_token_usage()
            print("-" * 60)
            
            # Last request info
            last_req = getattr(self.token_tracker, '_last_request_tokens', None)
            if last_req:
                print(f"Last: +{last_req.get('prompt', 0)} prompt, +{last_req.get('completion', 0)} completion" +
                      (f", {last_req.get('cache_hit', 0)} cache hit" if last_req.get('cache_hit', 0) else "") +
                      (f", {last_req.get('cache_write', 0)} cache write" if last_req.get('cache_write', 0) else ""))
            
            # Session totals - horizontal
            prompt = _format_tokens(usage.get('prompt_tokens', 0))
            completion = _format_tokens(usage.get('completion_tokens', 0))
            total = _format_tokens(usage.get('total_tokens', 0))
            cache_hit = usage.get('cache_hit_tokens', 0)
            cache_write = usage.get('cache_write_tokens', 0)
            
            session_line = f"Session: {prompt} prompt, {completion} completion, {total} total"
            if cache_hit:
                session_line += f", {_format_tokens(cache_hit)} cache hit"
            if cache_write:
                session_line += f", {_format_tokens(cache_write)} cache write"
            print(session_line)
        
        print("=" * 60 + "\n")

    def print_compact_hud(self, messages: list = None):
        """Print a compact one-line HUD."""
        max_input = self.token_counter.info.get("max_input_tokens", 128000)
        history_tokens = self.count_tokens(self.done_messages) if self.done_messages else 0
        messages_tokens = self.count_tokens(messages) if messages else 0
        
        pct = messages_tokens * 100 // max_input if max_input else 0
        history_warn = " ⚠️SUMMARIZE" if self.history_too_big() else ""
        
        # Include session totals if available
        session_info = ""
        if self.token_tracker and hasattr(self.token_tracker, 'get_token_usage'):
            usage = self.token_tracker.get_token_usage()
            total = usage.get('total_tokens', 0)
            if total:
                session_info = f" | Session: {_format_tokens(total)}"
        
        print(f"📊 Tokens: {_format_tokens(messages_tokens)}/{_format_tokens(max_input)} ({pct}%) | History: {_format_tokens(history_tokens)} | Msgs: {len(self.done_messages)}{session_info}{history_warn}")
