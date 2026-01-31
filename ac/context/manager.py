"""
Context manager for LLM conversations.

Handles conversation history, token budgets, summarization triggers,
and HUD (terminal output) for context status.
"""

from pathlib import Path
from typing import Optional

from .token_counter import TokenCounter, format_tokens
from .file_context import FileContext
from .stability_tracker import StabilityTracker


def _progress_bar(used: int, total: int, width: int = 20) -> str:
    """Create a simple ASCII progress bar."""
    if total == 0:
        return "[" + "?" * width + "]"
    ratio = min(used / total, 1.0)
    filled = int(width * ratio)
    bar = "█" * filled + "░" * (width - filled)
    return f"[{bar}]"


class ContextManager:
    """
    Manages LLM conversation context.
    
    Tracks conversation history, manages token budgets,
    and provides summarization support when history grows too large.
    """
    
    def __init__(
        self,
        model_name: str,
        repo_root: str = None,
        token_tracker=None
    ):
        """
        Initialize context manager.
        
        Args:
            model_name: LLM model identifier for token counting
            repo_root: Repository root for file context
            token_tracker: Optional object with get_token_usage() for session totals
        """
        self.model_name = model_name
        self.token_counter = TokenCounter(model_name)
        self.file_context = FileContext(repo_root)
        self.token_tracker = token_tracker
        
        # Unified cache stability tracker for files AND symbol map entries
        # (4-tier for Bedrock compatibility: L0-L3 cached, active uncached)
        self.cache_stability: Optional[StabilityTracker] = None
        if repo_root:
            stability_path = Path(repo_root) / '.aicoder' / 'cache_stability.json'
            self.cache_stability = StabilityTracker(
                persistence_path=stability_path,
                thresholds={'L3': 3, 'L2': 6, 'L1': 9, 'L0': 12},
                initial_tier='L3'
            )
        
        # Conversation history
        self._history: list[dict] = []
        
        # History token budget (1/16 of max input)
        max_input = self.token_counter.max_input_tokens
        self.max_history_tokens = max_input // 16
    
    # ========== History Management ==========
    
    def add_message(self, role: str, content: str) -> None:
        """
        Add a single message to history.
        
        Args:
            role: Message role ('user' or 'assistant')
            content: Message content
        """
        self._history.append({"role": role, "content": content})
    
    def add_exchange(self, user_msg: str, assistant_msg: str) -> None:
        """
        Add a user/assistant exchange to history.
        
        Args:
            user_msg: User message content
            assistant_msg: Assistant message content
        """
        self._history.append({"role": "user", "content": user_msg})
        self._history.append({"role": "assistant", "content": assistant_msg})
    
    def get_history(self) -> list[dict]:
        """Get a copy of conversation history."""
        return self._history.copy()
    
    def set_history(self, messages: list[dict]) -> None:
        """
        Replace history (e.g., after summarization).
        
        Args:
            messages: New history messages
        """
        self._history = messages.copy()
    
    def clear_history(self) -> None:
        """Clear conversation history."""
        self._history = []
    
    def history_token_count(self) -> int:
        """Get token count of current history."""
        if not self._history:
            return 0
        return self.token_counter.count(self._history)
    
    # ========== Summarization ==========
    
    def history_needs_summary(self) -> bool:
        """
        Check if history exceeds token budget and needs summarization.
        
        Returns:
            True if history tokens exceed max_history_tokens
        """
        if not self._history:
            return False
        return self.history_token_count() > self.max_history_tokens
    
    def get_summarization_split(self) -> tuple[list[dict], list[dict]]:
        """
        Split history for summarization.
        
        Returns:
            Tuple of (head, tail) where:
            - head: Messages to summarize (~75% of history)
            - tail: Recent messages to keep verbatim (~25%)
        """
        if not self.history_needs_summary():
            return [], self._history.copy()
        
        # Keep ~25% of budget as tail
        tail_budget = self.max_history_tokens // 4
        tail = []
        tail_tokens = 0
        
        # Build tail from most recent messages
        for msg in reversed(self._history):
            msg_tokens = self.token_counter.count(msg)
            if tail_tokens + msg_tokens > tail_budget:
                break
            tail.insert(0, msg)
            tail_tokens += msg_tokens
        
        # Head is everything before tail
        head_count = len(self._history) - len(tail)
        head = self._history[:head_count]
        
        return head, tail
    
    # ========== Token Counting ==========
    
    def count_tokens(self, content) -> int:
        """
        Count tokens in content.
        
        Args:
            content: String, dict, or list of dicts
            
        Returns:
            Token count
        """
        return self.token_counter.count(content)
    
    def get_token_budget(self) -> dict:
        """
        Get token budget information.
        
        Returns:
            Dict with used, max_input, remaining, and needs_summary
        """
        history_tokens = self.history_token_count()
        max_input = self.token_counter.max_input_tokens
        
        return {
            "history_tokens": history_tokens,
            "max_history_tokens": self.max_history_tokens,
            "max_input_tokens": max_input,
            "remaining": max_input - history_tokens,
            "needs_summary": self.history_needs_summary()
        }
    
    # ========== HUD Output ==========
    
    def print_hud(
        self,
        system_tokens: int = 0,
        symbol_map_tokens: int = 0,
        file_tokens: int = 0,
        extra_info: dict = None
    ) -> None:
        """
        Print context HUD to terminal.
        
        Args:
            system_tokens: Tokens in system prompt
            symbol_map_tokens: Tokens in symbol map
            file_tokens: Tokens in file context
            extra_info: Optional extra info to display
        """
        max_input = self.token_counter.max_input_tokens
        max_output = self.token_counter.max_output_tokens
        history_tokens = self.history_token_count()
        
        # Calculate total
        total_tokens = system_tokens + symbol_map_tokens + file_tokens + history_tokens
        
        # History status
        history_status = "⚠️  NEEDS SUMMARY" if self.history_needs_summary() else "✓"
        
        print("\n" + "=" * 60)
        print(f"📊 CONTEXT HUD - {self.model_name}")
        print("=" * 60)
        print(f"Max Input: {format_tokens(max_input)} | Max Output: {format_tokens(max_output)}")
        print("-" * 60)
        
        # Token breakdown
        print("Token Usage:")
        print(f"  System:     {system_tokens:>8,}")
        print(f"  Symbol Map: {symbol_map_tokens:>8,}")
        print(f"  Files:      {file_tokens:>8,}")
        print(f"  History:    {history_tokens:>8,} / {self.max_history_tokens:,} {history_status}")
        print("-" * 60)
        print(f"  Total:      {total_tokens:>8,} / {max_input:,}")
        
        pct = total_tokens * 100 // max_input if max_input else 0
        print(f"  {_progress_bar(total_tokens, max_input, 40)} {pct}%")
        
        print("-" * 60)
        print(f"History: {len(self._history)} messages")
        print(f"Files: {len(self.file_context)} in context")
        
        # Session totals from token tracker
        if self.token_tracker and hasattr(self.token_tracker, 'get_token_usage'):
            usage = self.token_tracker.get_token_usage()
            print("-" * 60)
            
            # Last request info
            last_req = getattr(self.token_tracker, '_last_request_tokens', None)
            if last_req:
                parts = [f"+{last_req.get('prompt', 0)} prompt", 
                        f"+{last_req.get('completion', 0)} completion"]
                if last_req.get('cache_hit', 0):
                    parts.append(f"{last_req.get('cache_hit', 0)} cache hit")
                if last_req.get('cache_write', 0):
                    parts.append(f"{last_req.get('cache_write', 0)} cache write")
                print(f"Last: {', '.join(parts)}")
            
            # Session totals
            prompt = format_tokens(usage.get('prompt_tokens', 0))
            completion = format_tokens(usage.get('completion_tokens', 0))
            total = format_tokens(usage.get('total_tokens', 0))
            
            session_parts = [f"{prompt} prompt", f"{completion} completion", f"{total} total"]
            
            cache_hit = usage.get('cache_hit_tokens', 0)
            cache_write = usage.get('cache_write_tokens', 0)
            if cache_hit:
                session_parts.append(f"{format_tokens(cache_hit)} cache hit")
            if cache_write:
                session_parts.append(f"{format_tokens(cache_write)} cache write")
            
            print(f"Session: {', '.join(session_parts)}")
        
        print("=" * 60 + "\n")
    
    def print_compact_hud(self) -> None:
        """Print a compact one-line HUD."""
        max_input = self.token_counter.max_input_tokens
        history_tokens = self.history_token_count()
        
        pct = history_tokens * 100 // self.max_history_tokens if self.max_history_tokens else 0
        history_warn = " ⚠️SUMMARIZE" if self.history_needs_summary() else ""
        
        # Session totals if available
        session_info = ""
        if self.token_tracker and hasattr(self.token_tracker, 'get_token_usage'):
            usage = self.token_tracker.get_token_usage()
            total = usage.get('total_tokens', 0)
            if total:
                session_info = f" | Session: {format_tokens(total)}"
        
        print(f"📊 History: {format_tokens(history_tokens)}/{format_tokens(self.max_history_tokens)} ({pct}%) | Msgs: {len(self._history)}{session_info}{history_warn}")
    
    # ========== Token Report ==========
    
    def get_token_report(
        self,
        system_prompt: str = "",
        symbol_map: str = "",
        read_only_files: list[str] = None
    ) -> str:
        """
        Generate detailed token report (like aider's /tokens).
        
        Args:
            system_prompt: System prompt text
            symbol_map: Symbol map content
            read_only_files: Optional list of read-only file paths
            
        Returns:
            Formatted token report string
        """
        max_input = self.token_counter.max_input_tokens
        results = []  # (tokens, label, tip)
        
        # System prompt
        if system_prompt:
            sys_tokens = self.token_counter.count(system_prompt)
            results.append((sys_tokens, "system messages", ""))
        
        # Chat history
        if self._history:
            hist_tokens = self.history_token_count()
            results.append((hist_tokens, "chat history", "use clear_history() to clear"))
        
        # Symbol map
        if symbol_map:
            map_tokens = self.token_counter.count(symbol_map)
            results.append((map_tokens, "symbol map", ""))
        
        # Files in context
        for filepath in self.file_context.get_files():
            content = self.file_context.get_content(filepath)
            if content:
                wrapped = f"{filepath}\n```\n{content}\n```\n"
                tokens = self.token_counter.count(wrapped)
                results.append((tokens, filepath, "remove to drop"))
        
        # Read-only files
        if read_only_files:
            for filepath in read_only_files:
                # Would need to read content - skip for now unless provided
                results.append((0, f"{filepath} (read-only)", "drop to remove"))
        
        # Format output
        lines = [f"Approximate context window usage for {self.model_name}, in tokens:\n"]
        
        col_width = max(len(r[1]) for r in results) if results else 20
        total_tokens = 0
        
        for tokens, label, tip in results:
            total_tokens += tokens
            lines.append(f"  {tokens:>8,} {label.ljust(col_width)} {tip}")
        
        lines.append("=" * 40)
        lines.append(f"  {total_tokens:>8,} tokens total")
        
        remaining = max_input - total_tokens
        if remaining > 1024:
            lines.append(f"  {remaining:>8,} tokens remaining in context window")
        elif remaining > 0:
            lines.append(f"  WARNING: {remaining:>8,} tokens remaining (use clear/drop)")
        else:
            lines.append(f"  ERROR: {remaining:>8,} tokens over limit!")
        
        lines.append(f"  {max_input:>8,} tokens max context window size")
        
        return "\n".join(lines)
