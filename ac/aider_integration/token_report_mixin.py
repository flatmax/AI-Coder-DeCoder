"""
Token report mixin for context manager.

Generates Aider-style /tokens output for token usage breakdown.
"""

from pathlib import Path


class TokenReportMixin:
    """Mixin for token report generation."""

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

        # Symbol map (replaces aider's repo map)
        symbol_map = self._get_symbol_map_for_report(chat_files)
        if symbol_map:
            map_tokens = self.count_tokens(symbol_map)
            results.append((map_tokens, "symbol map", ""))

        # Chat files (sorted by token count)
        file_results = self._collect_file_tokens(chat_files, read_only=False)
        file_results.extend(self._collect_file_tokens(read_only_files, read_only=True))

        # Sort files by token count, add to results
        file_results.sort()
        results.extend(file_results)

        # Format output (matches Aider's format)
        report = self._format_token_report(results)
        
        # Print to terminal
        print("\n" + "=" * 60)
        print("📊 TOKEN REPORT")
        print("=" * 60)
        print(report)
        print("=" * 60 + "\n")
        
        return report

    def _collect_file_tokens(self, file_paths, read_only=False):
        """Collect token counts for a list of files."""
        results = []
        for fpath in file_paths:
            content = self.io.read_text(fpath)
            if content:
                try:
                    rel = str(Path(fpath).relative_to(self.repo_root))
                except ValueError:
                    rel = fpath
                wrapped = f"{rel}\n```\n{content}\n```\n"
                tokens = self.count_tokens(wrapped)
                label = f"{rel} (read-only)" if read_only else rel
                results.append((tokens, label, "drop to remove"))
        return results

    def _get_symbol_map_for_report(self, chat_files):
        """Get symbol map for token reporting."""
        if hasattr(self, 'token_tracker') and self.token_tracker:
            if hasattr(self.token_tracker, 'get_context_map'):
                return self.token_tracker.get_context_map(
                    chat_files=chat_files,
                    include_references=True
                )
        return None

    def _format_token_report(self, results):
        """Format the token report output."""
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

        return "\n".join(lines)
