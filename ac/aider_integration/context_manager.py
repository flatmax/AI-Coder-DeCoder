"""
Aider Context Manager - Side-load messages in/out
You handle: litellm calls, edit parsing/applying
Aider handles: repo map, token counting, history management, context assembly
"""

from pathlib import Path

import litellm as _litellm


class MinimalIO:
    """Minimal IO stub for RepoMap"""
    def __init__(self, encoding="utf-8"):
        self.encoding = encoding

    def read_text(self, filename, silent=False):
        try:
            with open(str(filename), "r", encoding=self.encoding) as f:
                return f.read()
        except (FileNotFoundError, IsADirectoryError, OSError, UnicodeError):
            return None

    def tool_output(self, msg): pass
    def tool_error(self, msg): pass
    def tool_warning(self, msg): pass


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


class AiderContextManager:
    """
    Side-load messages in/out for context management.
    No LLM calls - you handle those.
    """

    def __init__(self, repo_root: str, model_name: str):
        from aider.repo import GitRepo
        from aider.repomap import RepoMap

        self.repo_root = Path(repo_root)
        self.model_name = model_name
        self.token_counter = TokenCounter(model_name)
        self.io = MinimalIO()

        # Use aider's GitRepo to get tracked files only
        self.git_repo = GitRepo(
            self.io,
            fnames=[],
            git_dname=str(repo_root),
        )

        max_input = self.token_counter.info.get("max_input_tokens", 128000)

        self.repo_map = RepoMap(
            map_tokens=max_input // 32,
            root=str(repo_root),
            main_model=self.token_counter,
            io=self.io,
            max_context_window=max_input,
        )

        self.done_messages = []
        self.max_history_tokens = max_input // 16
        
        # Track last repo map token count for HUD
        self._last_repo_map_tokens = 0
        self._last_chat_files_count = 0

    # =========================================================================
    # HUD - Heads Up Display
    # =========================================================================

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
        
        print("=" * 60 + "\n")

    def print_compact_hud(self, messages: list = None):
        """Print a compact one-line HUD."""
        max_input = self.token_counter.info.get("max_input_tokens", 128000)
        history_tokens = self.count_tokens(self.done_messages) if self.done_messages else 0
        messages_tokens = self.count_tokens(messages) if messages else 0
        
        pct = messages_tokens * 100 // max_input if max_input else 0
        history_warn = " ⚠️SUMMARIZE" if self.history_too_big() else ""
        
        print(f"📊 Tokens: {_format_tokens(messages_tokens)}/{_format_tokens(max_input)} ({pct}%) | History: {_format_tokens(history_tokens)} | Msgs: {len(self.done_messages)}{history_warn}")

    # =========================================================================
    # TOKEN COUNTING
    # =========================================================================

    def count_tokens(self, content) -> int:
        return self.token_counter.token_count(content)

    def get_budget(self, messages: list = None) -> dict:
        max_input = self.token_counter.info.get("max_input_tokens", 128000)
        used = self.count_tokens(messages) if messages else 0
        return {
            "used": used,
            "max_input": max_input,
            "remaining": max_input - used,
            "history_tokens": self.count_tokens(self.done_messages),
            "history_budget": self.max_history_tokens,
        }

    # =========================================================================
    # REPO MAP
    # =========================================================================

    def get_repo_map(
        self,
        chat_files: list,
        mentioned_fnames: set = None,
        mentioned_idents: set = None,
    ) -> str:
        """Generate intelligent repo map. Returns formatted string or None."""
        # Get git-tracked files only (respects .gitignore)
        tracked = self.git_repo.get_tracked_files()

        # Convert to absolute paths, excluding chat_files
        other_files = [
            str(self.repo_root / f)
            for f in tracked
            if str(self.repo_root / f) not in chat_files
        ]

        result = self.repo_map.get_repo_map(
            chat_files=chat_files,
            other_files=other_files,
            mentioned_fnames=mentioned_fnames or set(),
            mentioned_idents=mentioned_idents or set(),
        )
        
        # Track for HUD
        self._last_repo_map_tokens = self.count_tokens(result) if result else 0
        self._last_chat_files_count = len(chat_files)
        
        return result

    # =========================================================================
    # FILE CONTENT
    # =========================================================================

    def format_files(self, file_paths: list, fence=("```", "```")) -> str:
        """Format multiple files with fences"""
        output = ""
        for fpath in file_paths:
            content = self.io.read_text(fpath)
            if content:
                try:
                    rel = str(Path(fpath).relative_to(self.repo_root))
                except ValueError:
                    rel = fpath
                output += f"{rel}\n{fence[0]}\n{content}\n{fence[1]}\n\n"
        return output

    # =========================================================================
    # HISTORY MANAGEMENT (side-load in/out)
    # =========================================================================

    def add_exchange(self, user_msg: str, assistant_msg: str):
        """Side-load a completed exchange into history"""
        self.done_messages.append({"role": "user", "content": user_msg})
        self.done_messages.append({"role": "assistant", "content": assistant_msg})
        # Print compact HUD after exchange
        self.print_compact_hud()

    def add_message(self, role: str, content: str):
        """Side-load a single message into history"""
        self.done_messages.append({"role": role, "content": content})

    def get_history(self) -> list:
        return self.done_messages.copy()

    def set_history(self, messages: list):
        """Replace history entirely (e.g., after your own summarization)"""
        self.done_messages = messages.copy()
        print(f"📊 History reset: {len(messages)} messages")

    def clear_history(self):
        self.done_messages = []
        print("📊 History cleared")

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

    # =========================================================================
    # CONTEXT ASSEMBLY
    # =========================================================================

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
