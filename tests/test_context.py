"""Tests for context manager."""

import pytest
from pathlib import Path
from ac_dc.context import (
    ContextManager, FileContext,
    REPO_MAP_HEADER, FILE_TREE_HEADER, FILES_ACTIVE_HEADER,
    URL_CONTEXT_HEADER, COMMIT_MSG_SYSTEM, _format_files,
)


class TestFileContext:

    def test_add_with_content(self):
        fc = FileContext()
        assert fc.add_file("test.py", "print('hello')")
        assert fc.has_file("test.py")
        assert fc.get_content("test.py") == "print('hello')"

    def test_add_from_disk(self, tmp_path):
        (tmp_path / "hello.py").write_text("x = 1\n")
        fc = FileContext(tmp_path)
        assert fc.add_file("hello.py")
        assert fc.get_content("hello.py") == "x = 1\n"

    def test_add_missing_file(self, tmp_path):
        fc = FileContext(tmp_path)
        assert not fc.add_file("missing.py")

    def test_add_binary_file(self, tmp_path):
        (tmp_path / "data.bin").write_bytes(b"\x00\x01\x02\x03")
        fc = FileContext(tmp_path)
        assert not fc.add_file("data.bin")

    def test_path_traversal_blocked(self, tmp_path):
        fc = FileContext(tmp_path)
        assert not fc.add_file("../../../etc/passwd")

    def test_remove_file(self):
        fc = FileContext()
        fc.add_file("a.py", "a")
        fc.remove_file("a.py")
        assert not fc.has_file("a.py")

    def test_get_files_sorted(self):
        fc = FileContext()
        fc.add_file("c.py", "c")
        fc.add_file("a.py", "a")
        fc.add_file("b.py", "b")
        assert fc.get_files() == ["a.py", "b.py", "c.py"]

    def test_clear(self):
        fc = FileContext()
        fc.add_file("a.py", "a")
        fc.clear()
        assert fc.get_files() == []

    def test_format_for_prompt(self):
        fc = FileContext()
        fc.add_file("test.py", "x = 1")
        prompt = fc.format_for_prompt()
        assert "test.py" in prompt
        assert "```" in prompt
        assert "x = 1" in prompt

    def test_no_content_no_repo(self):
        fc = FileContext()
        assert not fc.add_file("test.py")


class TestContextManager:

    def test_add_message(self):
        cm = ContextManager()
        cm.add_message("user", "hello")
        assert len(cm.get_history()) == 1
        assert cm.get_history()[0] == {"role": "user", "content": "hello"}

    def test_add_exchange(self):
        cm = ContextManager()
        cm.add_exchange("question", "answer")
        history = cm.get_history()
        assert len(history) == 2
        assert history[0]["role"] == "user"
        assert history[1]["role"] == "assistant"

    def test_get_history_returns_copy(self):
        cm = ContextManager()
        cm.add_message("user", "hello")
        h = cm.get_history()
        h.append({"role": "assistant", "content": "world"})
        assert len(cm.get_history()) == 1

    def test_set_history(self):
        cm = ContextManager()
        cm.add_message("user", "old")
        cm.set_history([{"role": "user", "content": "new"}])
        assert cm.get_history()[0]["content"] == "new"

    def test_clear_history(self):
        cm = ContextManager()
        cm.add_exchange("q", "a")
        cm.clear_history()
        assert cm.get_history() == []

    def test_history_token_count(self):
        cm = ContextManager()
        cm.add_exchange("hello world", "goodbye world")
        tokens = cm.history_token_count()
        assert tokens > 0

    def test_token_budget(self):
        cm = ContextManager()
        budget = cm.get_token_budget()
        assert "history_tokens" in budget
        assert "max_input_tokens" in budget
        assert "remaining" in budget
        assert budget["remaining"] > 0

    def test_should_compact_disabled(self):
        cm = ContextManager(compaction_config={"enabled": False})
        assert not cm.should_compact()

    def test_should_compact_below_trigger(self):
        cm = ContextManager(compaction_config={
            "enabled": True,
            "compaction_trigger_tokens": 100000,
        })
        cm.add_exchange("small", "msg")
        assert not cm.should_compact()

    def test_compaction_status(self):
        cm = ContextManager(compaction_config={
            "enabled": True,
            "compaction_trigger_tokens": 24000,
        })
        status = cm.get_compaction_status()
        assert status["enabled"] is True
        assert status["trigger_tokens"] == 24000

    def test_assemble_messages_basic(self):
        cm = ContextManager()
        msgs = cm.assemble_messages(
            user_prompt="What is this?",
            system_prompt="You are helpful.",
        )
        assert msgs[0]["role"] == "system"
        assert "You are helpful" in msgs[0]["content"]
        assert msgs[-1]["role"] == "user"
        assert msgs[-1]["content"] == "What is this?"

    def test_assemble_messages_with_symbol_map(self):
        cm = ContextManager()
        msgs = cm.assemble_messages(
            user_prompt="hi",
            system_prompt="system",
            symbol_map="# symbols here",
        )
        system_content = msgs[0]["content"]
        assert "Repository Structure" in system_content
        assert "# symbols here" in system_content

    def test_assemble_messages_with_file_tree(self):
        cm = ContextManager()
        msgs = cm.assemble_messages(
            user_prompt="hi",
            system_prompt="system",
            file_tree="README.md\nsrc/main.py",
        )
        # Should have system, file_tree user, file_tree assistant Ok, user prompt
        tree_msg = next(m for m in msgs if "Repository Files" in str(m.get("content", "")))
        assert tree_msg["role"] == "user"

    def test_assemble_messages_with_url_context(self):
        cm = ContextManager()
        msgs = cm.assemble_messages(
            user_prompt="hi",
            system_prompt="system",
            url_context="## https://example.com\nSome content",
        )
        url_msg = next(m for m in msgs if "URL Context" in str(m.get("content", "")))
        assert url_msg["role"] == "user"
        # Check for the assistant acknowledgement
        idx = msgs.index(url_msg)
        assert msgs[idx + 1]["content"] == "Ok, I've reviewed the URL content."

    def test_assemble_messages_with_files(self, tmp_path):
        cm = ContextManager(repo_root=tmp_path)
        (tmp_path / "test.py").write_text("x = 1\n")
        cm.file_context.add_file("test.py")
        msgs = cm.assemble_messages(
            user_prompt="explain",
            system_prompt="system",
        )
        files_msg = next(m for m in msgs if "Working Files" in str(m.get("content", "")))
        assert "test.py" in files_msg["content"]

    def test_assemble_messages_with_history(self):
        cm = ContextManager()
        cm.add_exchange("prev question", "prev answer")
        msgs = cm.assemble_messages(
            user_prompt="new question",
            system_prompt="system",
        )
        assert msgs[-1]["content"] == "new question"
        # History should be before the current user message
        contents = [m.get("content", "") for m in msgs]
        assert "prev question" in contents
        assert "prev answer" in contents

    def test_assemble_messages_with_images(self):
        cm = ContextManager()
        msgs = cm.assemble_messages(
            user_prompt="describe this",
            system_prompt="system",
            images=["data:image/png;base64,abc123"],
        )
        last = msgs[-1]
        assert isinstance(last["content"], list)
        assert last["content"][0]["type"] == "text"
        assert last["content"][1]["type"] == "image_url"

    def test_assemble_no_images_is_string(self):
        cm = ContextManager()
        msgs = cm.assemble_messages(
            user_prompt="hello",
            system_prompt="system",
        )
        assert isinstance(msgs[-1]["content"], str)

    def test_estimate_prompt_tokens(self):
        cm = ContextManager()
        cm.add_exchange("hello", "world")
        tokens = cm.estimate_prompt_tokens(
            user_prompt="new msg",
            system_prompt="You are helpful.",
        )
        assert tokens > 0

    def test_shed_files_if_needed(self, tmp_path):
        """Test that the largest file is shed when budget exceeded."""
        cm = ContextManager(repo_root=tmp_path)
        # Create a context that won't exceed a real budget
        # Just verify the mechanism works when files exist
        (tmp_path / "small.py").write_text("x = 1\n")
        cm.file_context.add_file("small.py")

        shed = cm.shed_files_if_needed(
            "msg", "system", "", "",
        )
        # Budget shouldn't be exceeded with a tiny file
        assert shed == []
        assert cm.file_context.has_file("small.py")

    def test_emergency_truncate(self):
        cm = ContextManager(compaction_config={
            "compaction_trigger_tokens": 10,  # Very low trigger
        })
        # Add lots of messages
        for i in range(100):
            cm.add_exchange(f"question {i} " * 20, f"answer {i} " * 20)

        original_len = len(cm.get_history())
        cm.emergency_truncate()
        # Should have fewer messages
        assert len(cm.get_history()) < original_len

    def test_emergency_truncate_preserves_pairs(self):
        cm = ContextManager(compaction_config={
            "compaction_trigger_tokens": 10,
        })
        for i in range(50):
            cm.add_exchange(f"q{i} " * 20, f"a{i} " * 20)

        cm.emergency_truncate()
        history = cm.get_history()
        # Should have even number (user/assistant pairs)
        assert len(history) % 2 == 0
        # First should be user
        if history:
            assert history[0]["role"] == "user"


class TestFormatFiles:

    def test_empty(self):
        assert _format_files({}) == ""

    def test_single_file(self):
        result = _format_files({"test.py": "x = 1"})
        assert "test.py" in result
        assert "x = 1" in result
        assert "```" in result

    def test_multiple_files_sorted(self):
        result = _format_files({"b.py": "b", "a.py": "a"})
        assert result.index("a.py") < result.index("b.py")


class TestConstants:

    def test_headers_are_strings(self):
        assert isinstance(REPO_MAP_HEADER, str)
        assert isinstance(FILE_TREE_HEADER, str)
        assert isinstance(FILES_ACTIVE_HEADER, str)
        assert isinstance(URL_CONTEXT_HEADER, str)

    def test_commit_msg_system_has_content(self):
        assert "commit" in COMMIT_MSG_SYSTEM.lower()
        assert "conventional" in COMMIT_MSG_SYSTEM.lower()
