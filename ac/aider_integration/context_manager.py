"""
Aider Context Manager - Side-load messages in/out
You handle: litellm calls, edit parsing/applying
Aider handles: repo map, token counting, history management, context assembly
"""

from pathlib import Path

from .token_counter import TokenCounter
from .minimal_io import MinimalIO
from .hud_mixin import HudMixin
from .history_mixin import HistoryMixin
from .repo_map_mixin import RepoMapMixin


class AiderContextManager(HudMixin, HistoryMixin, RepoMapMixin):
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
    # TOKEN REPORT (like aider's /tokens command)
    # =========================================================================

    def print_tokens(
        self,
        system_prompt: str,
        chat_files: list = None,
        read_only_files: list = None,
    ) -> str:
        """
        Generate Aider-style /tokens output.
        
        Args:
            system_prompt: The system prompt text
            chat_files: List of absolute file paths in chat context
            read_only_files: List of absolute file paths that are read-only
            
        Returns:
            Formatted string with token usage breakdown
        """
        chat_files = chat_files or []
        read_only_files = read_only_files or []
        results = []  # (tokens, label, tip)

        # System messages
        sys_tokens = self.count_tokens(system_prompt)
        results.append((sys_tokens, "system messages", ""))

        # Chat history
        if self.done_messages:
            hist_tokens = self.count_tokens(self.done_messages)
            results.append((hist_tokens, "chat history", "use clear() to clear"))

        # Repo map
        repo_content = self.get_repo_map(chat_files)
        if repo_content:
            repo_tokens = self.count_tokens(repo_content)
            results.append((repo_tokens, "repository map", "use map_tokens to resize"))

        # Chat files (sorted by token count)
        file_results = []
        for fpath in chat_files:
            content = self.io.read_text(fpath)
            if content:
                try:
                    rel = str(Path(fpath).relative_to(self.repo_root))
                except ValueError:
                    rel = fpath
                wrapped = f"{rel}\n```\n{content}\n```\n"
                tokens = self.count_tokens(wrapped)
                file_results.append((tokens, rel, "drop to remove"))

        # Read-only files
        for fpath in read_only_files:
            content = self.io.read_text(fpath)
            if content:
                try:
                    rel = str(Path(fpath).relative_to(self.repo_root))
                except ValueError:
                    rel = fpath
                wrapped = f"{rel}\n```\n{content}\n```\n"
                tokens = self.count_tokens(wrapped)
                file_results.append((tokens, f"{rel} (read-only)", "drop to remove"))

        # Sort files by token count, add to results
        file_results.sort()
        results.extend(file_results)

        # Format output (matches Aider's format)
        max_input = self.token_counter.info.get("max_input_tokens", 128000)
        input_cost_per_token = self.token_counter.info.get("input_cost_per_token", 0)

        lines = [f"Approximate context window usage for {self.model_name}, in tokens:\n"]

        col_width = max(len(r[1]) for r in results) if results else 20
        total_tokens = 0
        total_cost = 0.0

        for tokens, label, tip in results:
            total_tokens += tokens
            cost = tokens * input_cost_per_token
            total_cost += cost
            lines.append(f"${cost:7.4f} {tokens:>8,} {label.ljust(col_width)} {tip}")

        lines.append("=" * 18)
        lines.append(f"${total_cost:7.4f} {total_tokens:>8,} tokens total")

        remaining = max_input - total_tokens
        if remaining > 1024:
            lines.append(f"         {remaining:>8,} tokens remaining in context window")
        elif remaining > 0:
            lines.append(f"  WARNING {remaining:>8,} tokens remaining (use clear/drop to make space)")
        else:
            lines.append(f"    ERROR {remaining:>8,} tokens remaining, window exhausted!")

        lines.append(f"         {max_input:>8,} tokens max context window size")

        report = "\n".join(lines)
        
        # Print to terminal
        print("\n" + "=" * 60)
        print("📊 TOKEN REPORT")
        print("=" * 60)
        print(report)
        print("=" * 60 + "\n")
        
        return report

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
