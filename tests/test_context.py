"""Tests for the context engine (FileContext + ContextManager)."""

import subprocess
from pathlib import Path

import pytest

from ac_dc.context import (
    ContextManager,
    FileContext,
    FILES_ACTIVE_HEADER,
    FILE_TREE_HEADER,
    REPO_MAP_HEADER,
    URL_CONTEXT_HEADER,
)
from ac_dc.token_counter import TokenCounter


@pytest.fixture
def temp_repo(tmp_path):
    """Create a temporary git repo with test files."""
    repo = tmp_path / "test_repo"
    repo.mkdir()
    subprocess.run(["git", "init", str(repo)], capture_output=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", "test@test.com"],
                   capture_output=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "Test"],
                   capture_output=True)

    (repo / "src").mkdir()
    (repo / "src" / "main.py").write_text("def main():\n    print('hello')\n")
    (repo / "src" / "utils.py").write_text("def helper():\n    pass\n")
    (repo / "README.md").write_text("# Test Project\n")

    subprocess.run(["git", "-C", str(repo), "add", "-A"], capture_output=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-m", "initial"],
                   capture_output=True)

    return repo


# === FileContext Tests ===


class TestFileContext:
    def test_add_with_explicit_content(self):
        """Add with explicit content stores it."""
        fc = FileContext()
        assert fc.add_file("test.py", "print('hello')") is True
        assert fc.get_content("test.py") == "print('hello')"

    def test_add_from_disk(self, temp_repo):
        """Add from disk reads file."""
        fc = FileContext(repo_root=temp_repo)
        assert fc.add_file("src/main.py") is True
        content = fc.get_content("src/main.py")
        assert "def main()" in content

    def test_missing_file_returns_false(self, temp_repo):
        """Adding a missing file returns False."""
        fc = FileContext(repo_root=temp_repo)
        assert fc.add_file("nonexistent.py") is False

    def test_binary_file_rejected(self, temp_repo):
        """Binary file rejected."""
        bin_file = temp_repo / "data.bin"
        bin_file.write_bytes(b"text\x00binary")
        fc = FileContext(repo_root=temp_repo)
        assert fc.add_file("data.bin") is False

    def test_path_traversal_blocked(self):
        """Path traversal blocked."""
        fc = FileContext()
        assert fc.add_file("../../../etc/passwd", "bad") is False

    def test_remove(self):
        """Remove file from context."""
        fc = FileContext()
        fc.add_file("a.py", "code")
        fc.remove_file("a.py")
        assert fc.has_file("a.py") is False

    def test_get_files_sorted(self):
        """get_files returns sorted list."""
        fc = FileContext()
        fc.add_file("z.py", "z")
        fc.add_file("a.py", "a")
        fc.add_file("m.py", "m")
        assert fc.get_files() == ["a.py", "m.py", "z.py"]

    def test_clear(self):
        """clear removes all files."""
        fc = FileContext()
        fc.add_file("a.py", "a")
        fc.add_file("b.py", "b")
        fc.clear()
        assert fc.get_files() == []

    def test_format_for_prompt(self):
        """format_for_prompt includes path and fenced content."""
        fc = FileContext()
        fc.add_file("src/main.py", "def main():\n    pass")
        text = fc.format_for_prompt()
        assert "src/main.py" in text
        assert "```" in text
        assert "def main():" in text

    def test_has_file(self):
        """has_file checks membership."""
        fc = FileContext()
        fc.add_file("a.py", "a")
        assert fc.has_file("a.py") is True
        assert fc.has_file("b.py") is False

    def test_count_tokens(self):
        """count_tokens returns positive for non-empty files."""
        fc = FileContext()
        fc.add_file("a.py", "def hello(): pass")
        counter = TokenCounter()
        assert fc.count_tokens(counter) > 0

    def test_get_tokens_by_file(self):
        """get_tokens_by_file returns per-file counts."""
        fc = FileContext()
        fc.add_file("a.py", "short")
        fc.add_file("b.py", "a much longer piece of content with more tokens")
        counter = TokenCounter()
        by_file = fc.get_tokens_by_file(counter)
        assert "a.py" in by_file
        assert "b.py" in by_file
        assert by_file["b.py"] > by_file["a.py"]


# === ContextManager Tests ===


class TestContextManagerHistory:
    def test_add_message(self):
        """add_message appends to history."""
        ctx = ContextManager()
        ctx.add_message("user", "hello")
        assert len(ctx.get_history()) == 1
        assert ctx.get_history()[0]["role"] == "user"

    def test_add_exchange(self):
        """add_exchange appends pair atomically."""
        ctx = ContextManager()
        ctx.add_exchange("question", "answer")
        history = ctx.get_history()
        assert len(history) == 2
        assert history[0]["role"] == "user"
        assert history[1]["role"] == "assistant"

    def test_get_history_returns_copy(self):
        """get_history returns copy (mutation-safe)."""
        ctx = ContextManager()
        ctx.add_message("user", "hello")
        h1 = ctx.get_history()
        h1.append({"role": "user", "content": "injected"})
        assert len(ctx.get_history()) == 1

    def test_set_history_replaces(self):
        """set_history replaces entire history."""
        ctx = ContextManager()
        ctx.add_message("user", "old")
        ctx.set_history([{"role": "user", "content": "new"}])
        assert len(ctx.get_history()) == 1
        assert ctx.get_history()[0]["content"] == "new"

    def test_clear_history_empties(self):
        """clear_history empties list."""
        ctx = ContextManager()
        ctx.add_exchange("q", "a")
        ctx.clear_history()
        assert len(ctx.get_history()) == 0

    def test_history_token_count(self):
        """history_token_count > 0 for non-empty history."""
        ctx = ContextManager()
        ctx.add_exchange("What is Python?", "Python is a programming language.")
        assert ctx.history_token_count() > 0


class TestContextManagerBudget:
    def test_token_budget_has_required_keys(self):
        """Token budget has required keys."""
        ctx = ContextManager()
        budget = ctx.get_token_budget()
        assert "history_tokens" in budget
        assert "max_history_tokens" in budget
        assert "max_input_tokens" in budget
        assert "remaining" in budget
        assert "needs_summary" in budget

    def test_remaining_positive(self):
        """Remaining > 0 for empty context."""
        ctx = ContextManager()
        budget = ctx.get_token_budget()
        assert budget["remaining"] > 0

    def test_should_compact_false_when_disabled(self):
        """should_compact false when disabled."""
        ctx = ContextManager(compaction_config={"enabled": False})
        assert ctx.should_compact() is False

    def test_should_compact_false_below_trigger(self):
        """should_compact false below trigger."""
        ctx = ContextManager(compaction_config={
            "enabled": True,
            "compaction_trigger_tokens": 100000,
        })
        # Simulate a compactor being set
        ctx.init_compactor(object())
        ctx.add_message("user", "short message")
        assert ctx.should_compact() is False

    def test_compaction_status(self):
        """Compaction status returns enabled/trigger/percent."""
        ctx = ContextManager(compaction_config={
            "enabled": True,
            "compaction_trigger_tokens": 24000,
        })
        status = ctx.get_compaction_status()
        assert "enabled" in status
        assert status["enabled"] is True
        assert "trigger_tokens" in status
        assert "percent" in status


class TestContextManagerBudgetEnforcement:
    def test_shed_files_if_needed_no_op_under_budget(self):
        """shed_files_if_needed is no-op when under budget."""
        ctx = ContextManager()
        ctx.file_context.add_file("small.py", "x = 1")
        shed = ctx.shed_files_if_needed()
        assert shed == []

    def test_emergency_truncate_preserves_pairs(self):
        """emergency_truncate reduces message count, preserves pairs."""
        ctx = ContextManager(compaction_config={
            "enabled": True,
            "compaction_trigger_tokens": 100,
        })
        # Add many messages to exceed 2x trigger
        for i in range(50):
            ctx.add_exchange(
                f"User message {i} " * 20,
                f"Assistant response {i} " * 20,
            )
        ctx.emergency_truncate()
        history = ctx.get_history()
        assert len(history) < 100
        # Check pairs preserved
        for i in range(0, len(history), 2):
            if i + 1 < len(history):
                assert history[i]["role"] == "user"
                assert history[i + 1]["role"] == "assistant"


class TestPromptAssembly:
    def test_system_message_first(self):
        """System message first with system prompt content."""
        ctx = ContextManager(system_prompt="You are helpful.")
        messages = ctx.assemble_messages("Hello")
        assert messages[0]["role"] == "system"
        assert "You are helpful." in messages[0]["content"]

    def test_symbol_map_appended_to_system(self):
        """Symbol map appended to system message under Repository Structure header."""
        ctx = ContextManager(system_prompt="System prompt")
        messages = ctx.assemble_messages(
            "Hello", symbol_map="f main :1", symbol_legend="Legend text"
        )
        system = messages[0]["content"]
        assert "Repository Structure" in system
        assert "Legend text" in system
        assert "f main :1" in system

    def test_file_tree_as_pair(self):
        """File tree as user/assistant pair with Repository Files header."""
        ctx = ContextManager()
        messages = ctx.assemble_messages("Hello", file_tree="src/main.py\nsrc/utils.py")
        # Find the file tree message
        tree_msg = None
        for msg in messages:
            if msg["role"] == "user" and "Repository Files" in msg.get("content", ""):
                tree_msg = msg
                break
        assert tree_msg is not None
        assert "src/main.py" in tree_msg["content"]

    def test_url_context_as_pair(self):
        """URL context as user/assistant pair with acknowledgement."""
        ctx = ContextManager()
        ctx.set_url_context(["URL 1 content", "URL 2 content"])
        messages = ctx.assemble_messages("Hello")
        # Find URL context
        url_msg = None
        ack_msg = None
        for i, msg in enumerate(messages):
            if msg["role"] == "user" and "URL Context" in msg.get("content", ""):
                url_msg = msg
                if i + 1 < len(messages):
                    ack_msg = messages[i + 1]
                break
        assert url_msg is not None
        assert "URL 1 content" in url_msg["content"]
        assert ack_msg is not None
        assert "reviewed" in ack_msg["content"].lower()

    def test_active_files_as_pair(self):
        """Active files as user/assistant pair with Working Files header."""
        ctx = ContextManager()
        ctx.file_context.add_file("src/main.py", "def main(): pass")
        messages = ctx.assemble_messages("Hello")
        files_msg = None
        for msg in messages:
            if msg["role"] == "user" and "Working Files" in msg.get("content", ""):
                files_msg = msg
                break
        assert files_msg is not None
        assert "src/main.py" in files_msg["content"]

    def test_history_before_user_prompt(self):
        """History messages appear before current user prompt."""
        ctx = ContextManager()
        ctx.add_exchange("prev question", "prev answer")
        messages = ctx.assemble_messages("current question")
        # Last message should be the current prompt
        assert messages[-1]["content"] == "current question"
        # History should appear before it
        history_found = False
        for msg in messages[:-1]:
            if msg.get("content") == "prev question":
                history_found = True
        assert history_found

    def test_images_multimodal(self):
        """Images produce multimodal content blocks."""
        ctx = ContextManager()
        messages = ctx.assemble_messages(
            "Look at this", images=["data:image/png;base64,abc123"]
        )
        last = messages[-1]
        assert isinstance(last["content"], list)
        assert last["content"][0]["type"] == "text"
        assert last["content"][1]["type"] == "image_url"

    def test_no_images_string_content(self):
        """No images produces string content."""
        ctx = ContextManager()
        messages = ctx.assemble_messages("Hello")
        last = messages[-1]
        assert isinstance(last["content"], str)

    def test_estimate_prompt_tokens_positive(self):
        """estimate_prompt_tokens > 0."""
        ctx = ContextManager(system_prompt="System")
        ctx.add_message("user", "hello")
        tokens = ctx.estimate_prompt_tokens("new message")
        assert tokens > 0

    def test_graduated_files_excluded(self):
        """Graduated files excluded from active files section."""
        ctx = ContextManager()
        ctx.file_context.add_file("a.py", "code a")
        ctx.file_context.add_file("b.py", "code b")
        messages = ctx.assemble_messages("Hello", graduated_files={"a.py"})
        # Find working files section
        for msg in messages:
            if msg["role"] == "user" and "Working Files" in msg.get("content", ""):
                assert "a.py" not in msg["content"]
                assert "b.py" in msg["content"]
                break

    def test_all_graduated_no_working_files(self):
        """All files graduated -> no Working Files section."""
        ctx = ContextManager()
        ctx.file_context.add_file("a.py", "code")
        messages = ctx.assemble_messages("Hello", graduated_files={"a.py"})
        for msg in messages:
            if msg["role"] == "user" and "Working Files" in msg.get("content", ""):
                pytest.fail("Working Files section should not exist when all graduated")


class TestTieredAssembly:
    def test_l0_system_with_cache_control_no_history(self):
        """L0 system message has cache_control when no L0 history."""
        ctx = ContextManager(system_prompt="System")
        messages = ctx.assemble_tiered_messages(
            "Hello",
            tiered_content={"l0": {"symbols": "", "files": "", "history": []}}
        )
        system = messages[0]
        assert system["role"] == "system"
        # Should have cache_control in structured content
        if isinstance(system["content"], list):
            assert system["content"][0].get("cache_control") is not None

    def test_l0_with_history_cache_on_last(self):
        """L0 with history: cache_control on last history message, not system."""
        ctx = ContextManager(system_prompt="System")
        messages = ctx.assemble_tiered_messages(
            "Hello",
            tiered_content={
                "l0": {
                    "symbols": "",
                    "files": "",
                    "history": [
                        {"role": "user", "content": "old q"},
                        {"role": "assistant", "content": "old a"},
                    ],
                }
            }
        )
        # System should be plain string
        assert isinstance(messages[0]["content"], str)
        # Last L0 history message should have cache_control
        assert isinstance(messages[2]["content"], list)
        assert messages[2]["content"][0].get("cache_control") is not None

    def test_l1_block_pair(self):
        """L1 block produces user/assistant pair containing symbol content."""
        ctx = ContextManager(system_prompt="System")
        messages = ctx.assemble_tiered_messages(
            "Hello",
            tiered_content={
                "l1": {"symbols": "f main :1", "files": "", "history": []},
            }
        )
        # Find L1 pair
        found = False
        for i, msg in enumerate(messages):
            if msg["role"] == "user" and "Repository Structure (continued)" in str(msg.get("content", "")):
                found = True
                break
        assert found

    def test_empty_tiers_no_messages(self):
        """Empty tiers produce no messages."""
        ctx = ContextManager(system_prompt="System")
        messages_with = ctx.assemble_tiered_messages(
            "Hello",
            tiered_content={"l2": {"symbols": "content", "files": "", "history": []}},
        )
        messages_without = ctx.assemble_tiered_messages(
            "Hello",
            tiered_content={},
        )
        # Messages with L2 content should have more messages
        assert len(messages_with) > len(messages_without)
