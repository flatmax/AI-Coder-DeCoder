"""Tests for the context engine — token counter, file context, context manager."""

import pytest

from ac_dc.context.token_counter import TokenCounter
from ac_dc.context.file_context import FileContext
from ac_dc.context.context_manager import (
    ContextManager, REPO_MAP_HEADER, FILE_TREE_HEADER,
    URL_CONTEXT_HEADER, FILES_ACTIVE_HEADER,
)


# ── Token Counter ─────────────────────────────────────────────────

class TestTokenCounter:
    def test_count_string(self):
        tc = TokenCounter()
        count = tc.count("Hello, world!")
        assert count > 0

    def test_count_empty(self):
        tc = TokenCounter()
        assert tc.count("") == 0

    def test_count_message(self):
        tc = TokenCounter()
        msg = {"role": "user", "content": "Hello"}
        assert tc.count(msg) > 0

    def test_count_list(self):
        tc = TokenCounter()
        msgs = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
        ]
        assert tc.count(msgs) > 0

    def test_max_input_tokens(self):
        tc = TokenCounter()
        assert tc.max_input_tokens > 0

    def test_max_output_tokens(self):
        tc = TokenCounter()
        assert tc.max_output_tokens > 0

    def test_max_history_tokens(self):
        tc = TokenCounter()
        assert tc.max_history_tokens == tc.max_input_tokens // 16


# ── File Context ──────────────────────────────────────────────────

class TestFileContext:
    def test_add_with_content(self):
        fc = FileContext()
        assert fc.add_file("test.py", "print('hello')")
        assert fc.has_file("test.py")

    def test_add_from_disk(self, tmp_path):
        (tmp_path / "test.py").write_text("content")
        fc = FileContext(str(tmp_path))
        assert fc.add_file("test.py")
        assert fc.get_content("test.py") == "content"

    def test_add_missing_file(self, tmp_path):
        fc = FileContext(str(tmp_path))
        assert not fc.add_file("nonexistent.py")

    def test_binary_rejected(self, tmp_path):
        (tmp_path / "bin.dat").write_bytes(b"\x00\x01\x02")
        fc = FileContext(str(tmp_path))
        assert not fc.add_file("bin.dat")

    def test_path_traversal_blocked(self):
        fc = FileContext()
        assert not fc.add_file("../../etc/passwd", "hack")

    def test_remove(self):
        fc = FileContext()
        fc.add_file("a.py", "x")
        fc.remove_file("a.py")
        assert not fc.has_file("a.py")

    def test_get_files_sorted(self):
        fc = FileContext()
        fc.add_file("b.py", "b")
        fc.add_file("a.py", "a")
        assert fc.get_files() == ["a.py", "b.py"]

    def test_clear(self):
        fc = FileContext()
        fc.add_file("a.py", "a")
        fc.clear()
        assert fc.get_files() == []

    def test_format_for_prompt(self):
        fc = FileContext()
        fc.add_file("main.py", "print('hi')")
        output = fc.format_for_prompt()
        assert "main.py" in output
        assert "print('hi')" in output
        assert "```" in output


# ── Context Manager ───────────────────────────────────────────────

class TestContextManager:
    def test_add_message(self):
        cm = ContextManager("test-model")
        cm.add_message("user", "hello")
        assert len(cm.get_history()) == 1

    def test_add_exchange(self):
        cm = ContextManager("test-model")
        cm.add_exchange("hello", "hi")
        history = cm.get_history()
        assert len(history) == 2
        assert history[0]["role"] == "user"
        assert history[1]["role"] == "assistant"

    def test_get_history_returns_copy(self):
        cm = ContextManager("test-model")
        cm.add_message("user", "test")
        history = cm.get_history()
        history.append({"role": "user", "content": "mutation"})
        assert len(cm.get_history()) == 1  # Original unchanged

    def test_set_history(self):
        cm = ContextManager("test-model")
        cm.set_history([{"role": "user", "content": "replaced"}])
        assert len(cm.get_history()) == 1

    def test_clear_history(self):
        cm = ContextManager("test-model")
        cm.add_message("user", "test")
        cm.clear_history()
        assert len(cm.get_history()) == 0

    def test_history_token_count(self):
        cm = ContextManager("test-model")
        cm.add_message("user", "Hello world, this is a test message.")
        assert cm.history_token_count() > 0

    def test_token_budget(self):
        cm = ContextManager("test-model")
        budget = cm.get_token_budget()
        assert "history_tokens" in budget
        assert "max_history_tokens" in budget
        assert "max_input_tokens" in budget
        assert "remaining" in budget
        assert budget["remaining"] > 0

    def test_should_compact_disabled(self):
        cm = ContextManager("test-model", compaction_config={"enabled": False})
        assert not cm.should_compact()

    def test_should_compact_below_trigger(self):
        cm = ContextManager(
            "test-model",
            compaction_config={"enabled": True, "compaction_trigger_tokens": 99999},
        )
        cm.add_message("user", "short")
        assert not cm.should_compact()

    def test_compaction_status(self):
        cm = ContextManager("test-model")
        status = cm.get_compaction_status()
        assert "enabled" in status
        assert "trigger_tokens" in status
        assert "percent" in status


class TestPromptAssemblyFlat:
    def test_system_message_first(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("You are helpful.")
        msgs = cm.assemble_messages("Hello")
        assert msgs[0]["role"] == "system"
        assert "helpful" in msgs[0]["content"]

    def test_symbol_map_in_system(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("Base prompt")
        msgs = cm.assemble_messages("Hi", symbol_map="c MyClass")
        assert "Repository Structure" in msgs[0]["content"]

    def test_file_tree_pair(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("Base")
        msgs = cm.assemble_messages("Hi", file_tree="src/main.py")
        tree_msgs = [m for m in msgs if "File Tree" in m.get("content", "")]
        assert len(tree_msgs) == 1

    def test_url_context_pair(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("Base")
        cm.set_url_context("URL content here")
        msgs = cm.assemble_messages("Hi")
        url_msgs = [m for m in msgs if "URL Context" in m.get("content", "")]
        assert len(url_msgs) == 1

    def test_active_files_pair(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("Base")
        cm.file_context.add_file("test.py", "content")
        msgs = cm.assemble_messages("Hi")
        file_msgs = [m for m in msgs if "Working Files" in m.get("content", "")]
        assert len(file_msgs) == 1

    def test_history_before_prompt(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("Base")
        cm.add_exchange("prev question", "prev answer")
        msgs = cm.assemble_messages("New question")
        # Last message should be the user prompt
        assert msgs[-1]["role"] == "user"
        assert "New question" in msgs[-1]["content"]
        # History should be before it
        assert any("prev question" in m.get("content", "") for m in msgs)

    def test_images_multimodal(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("Base")
        msgs = cm.assemble_messages("Describe", images=["data:image/png;base64,abc"])
        last = msgs[-1]
        assert isinstance(last["content"], list)
        assert any(b.get("type") == "image_url" for b in last["content"])

    def test_no_images_string(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("Base")
        msgs = cm.assemble_messages("Hello")
        last = msgs[-1]
        assert isinstance(last["content"], str)

    def test_estimate_prompt_tokens(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("You are a helpful assistant.")
        cm.add_message("user", "Hello world")
        tokens = cm.estimate_prompt_tokens(symbol_map="c Foo")
        assert tokens > 0


class TestPromptAssemblyTiered:
    def test_l0_system_cached(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("Base prompt")
        msgs = cm.assemble_tiered_messages("Hi")
        sys_msg = msgs[0]
        assert sys_msg["role"] == "system"
        # Should have cache_control
        content = sys_msg["content"]
        if isinstance(content, list):
            assert any(
                b.get("cache_control") for b in content if isinstance(b, dict)
            )

    def test_l0_with_history_cache_on_last(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("Base")
        tiered = {
            "L0": {
                "symbols": "",
                "files": "",
                "history": [
                    {"role": "user", "content": "old q"},
                    {"role": "assistant", "content": "old a"},
                ],
            },
        }
        msgs = cm.assemble_tiered_messages("New q", tiered_content=tiered)
        # L0 history last msg should have cache_control
        # System msg should NOT have cache_control (it's on the history msg)
        sys_msg = msgs[0]
        assert sys_msg["role"] == "system"
        assert isinstance(sys_msg["content"], str)  # No cache_control on system

    def test_l1_block_pair(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("Base")
        tiered = {
            "L1": {"symbols": "c Foo", "files": "", "history": []},
        }
        msgs = cm.assemble_tiered_messages("Hi", tiered_content=tiered)
        # Should have a user/assistant pair for L1
        found = False
        for i, m in enumerate(msgs):
            content = m.get("content", "")
            if isinstance(content, list):
                content = " ".join(b.get("text", "") for b in content if isinstance(b, dict))
            if "continued" in content or "c Foo" in content:
                found = True
                # The assistant "Ok." may have been wrapped with cache_control
                next_content = msgs[i + 1]["content"]
                if isinstance(next_content, list):
                    assert any(b.get("text") == "Ok." for b in next_content if isinstance(b, dict))
                else:
                    assert next_content == "Ok."
        assert found

    def test_empty_tiers_skipped(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("Base")
        tiered = {
            "L1": {"symbols": "", "files": "", "history": []},
            "L2": {"symbols": "", "files": "", "history": []},
        }
        msgs = cm.assemble_tiered_messages("Hi", tiered_content=tiered)
        # Only system + user prompt (no L1/L2 blocks)
        assert len(msgs) == 2

    def test_file_tree_and_active_files(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("Base")
        cm.file_context.add_file("test.py", "content")
        msgs = cm.assemble_tiered_messages("Hi", file_tree="file list")
        contents = [m.get("content", "") for m in msgs]
        has_tree = any("File Tree" in c for c in contents)
        has_files = any("Working Files" in c for c in contents)
        assert has_tree
        assert has_files

    def test_multi_tier_order(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("Base")
        tiered = {
            "L0": {"symbols": "L0 sym", "files": "", "history": []},
            "L1": {"symbols": "L1 sym", "files": "", "history": []},
            "L3": {"symbols": "L3 sym", "files": "", "history": []},
        }
        msgs = cm.assemble_tiered_messages(
            "Hi", file_tree="tree", tiered_content=tiered,
        )
        # Check ordering: L0 (system) < L1 < L3 < tree < prompt
        indices = {}
        for i, m in enumerate(msgs):
            c = m.get("content", "")
            if isinstance(c, list):
                c = " ".join(b.get("text", "") for b in c if isinstance(b, dict))
            if "L1 sym" in c:
                indices["L1"] = i
            if "L3 sym" in c:
                indices["L3"] = i
            if "File Tree" in c:
                indices["tree"] = i
        if "L1" in indices and "L3" in indices:
            assert indices["L1"] < indices["L3"]
        if "L3" in indices and "tree" in indices:
            assert indices["L3"] < indices["tree"]

    def test_cached_tier_has_cache_control(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("Base")
        tiered = {
            "L1": {"symbols": "sym content", "files": "", "history": []},
        }
        msgs = cm.assemble_tiered_messages("Hi", tiered_content=tiered)
        # The Ok. after L1 content should have cache_control
        for i, m in enumerate(msgs):
            if m.get("content") == "Ok." or (
                isinstance(m.get("content"), list) and
                any(b.get("text") == "Ok." for b in m["content"] if isinstance(b, dict))
            ):
                content = m.get("content")
                if isinstance(content, list):
                    assert any(
                        b.get("cache_control") for b in content if isinstance(b, dict)
                    )
                    break


class TestBudgetEnforcement:
    def test_shed_files_under_budget(self):
        cm = ContextManager("test-model")
        cm.file_context.add_file("small.py", "x = 1")
        shed = cm.shed_files_if_needed()
        assert shed == []

    def test_shed_files_over_budget(self):
        cm = ContextManager("test-model")
        cm.set_system_prompt("x" * 100000)
        cm.file_context.add_file("big.py", "y" * 50000)
        shed = cm.shed_files_if_needed(max_tokens=100)
        assert len(shed) > 0

    def test_emergency_truncate(self):
        cm = ContextManager(
            "test-model",
            compaction_config={"compaction_trigger_tokens": 10},
        )
        for i in range(50):
            cm.add_message("user", f"Message {i} " + "x" * 100)
            cm.add_message("assistant", f"Reply {i} " + "y" * 100)
        original_len = len(cm.get_history())
        cm.emergency_truncate()
        assert len(cm.get_history()) < original_len