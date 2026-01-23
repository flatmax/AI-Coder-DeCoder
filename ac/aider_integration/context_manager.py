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

        return self.repo_map.get_repo_map(
            chat_files=chat_files,
            other_files=other_files,
            mentioned_fnames=mentioned_fnames or set(),
            mentioned_idents=mentioned_idents or set(),
        )

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

    def add_message(self, role: str, content: str):
        """Side-load a single message into history"""
        self.done_messages.append({"role": role, "content": content})

    def get_history(self) -> list:
        return self.done_messages.copy()

    def set_history(self, messages: list):
        """Replace history entirely (e.g., after your own summarization)"""
        self.done_messages = messages.copy()

    def clear_history(self):
        self.done_messages = []

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

        return messages
