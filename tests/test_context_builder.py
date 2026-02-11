"""Tests for the tiered context builder."""

import pytest
from ac_dc.stability_tracker import StabilityTracker, Tier, ItemType, TrackedItem
from ac_dc.context_builder import (
    TieredContextBuilder, _apply_cache_control, _format_files_block,
)


class TestApplyCacheControl:

    def test_string_content(self):
        msg = {"role": "system", "content": "hello"}
        result = _apply_cache_control(msg)
        assert isinstance(result["content"], list)
        assert result["content"][0]["type"] == "text"
        assert result["content"][0]["text"] == "hello"
        assert result["content"][0]["cache_control"] == {"type": "ephemeral"}

    def test_list_content(self):
        msg = {"role": "user", "content": [
            {"type": "text", "text": "first"},
            {"type": "text", "text": "second"},
        ]}
        result = _apply_cache_control(msg)
        # Cache control on last text block
        assert "cache_control" not in result["content"][0]
        assert result["content"][1]["cache_control"] == {"type": "ephemeral"}


class TestFormatFilesBlock:

    def test_empty(self):
        assert _format_files_block({}) == ""

    def test_single_file(self):
        result = _format_files_block({"test.py": "x = 1"})
        assert "test.py" in result
        assert "x = 1" in result
        assert "```" in result

    def test_sorted_files(self):
        result = _format_files_block({"b.py": "b", "a.py": "a"})
        assert result.index("a.py") < result.index("b.py")


class TestTieredContextBuilder:

    @pytest.fixture
    def tracker(self):
        return StabilityTracker(cache_target_tokens=100)

    @pytest.fixture
    def builder(self, tracker):
        return TieredContextBuilder(tracker)

    def test_minimal_build(self, builder):
        """Minimal build with just system prompt and user message."""
        msgs = builder.build_messages(
            system_prompt="You are helpful.",
            symbol_map_legend="",
            symbol_blocks={},
            file_contents={},
            history=[],
            history_tier_map={},
            user_prompt="Hello",
        )
        assert msgs[0]["role"] == "system"
        assert msgs[-1]["role"] == "user"
        assert msgs[-1]["content"] == "Hello"

    def test_l0_system_message_has_cache_control(self, builder):
        """L0 without history: cache_control on system message."""
        msgs = builder.build_messages(
            system_prompt="System",
            symbol_map_legend="legend",
            symbol_blocks={},
            file_contents={},
            history=[],
            history_tier_map={},
            user_prompt="Hi",
        )
        system_msg = msgs[0]
        assert isinstance(system_msg["content"], list)
        assert system_msg["content"][0]["cache_control"] == {"type": "ephemeral"}

    def test_l0_with_history_cache_on_last_history(self, tracker, builder):
        """L0 with history: cache on last history msg, not system."""
        # Put a history message in L0
        tracker._items["history:0"] = TrackedItem(
            key="history:0", item_type=ItemType.HISTORY,
            tier=Tier.L0, n=12, content_hash="h", token_estimate=50,
        )
        tracker._items["history:1"] = TrackedItem(
            key="history:1", item_type=ItemType.HISTORY,
            tier=Tier.L0, n=12, content_hash="h", token_estimate=50,
        )

        history = [
            {"role": "user", "content": "q1"},
            {"role": "assistant", "content": "a1"},
        ]
        tier_map = {0: Tier.L0, 1: Tier.L0}

        msgs = builder.build_messages(
            system_prompt="System",
            symbol_map_legend="",
            symbol_blocks={},
            file_contents={},
            history=history,
            history_tier_map=tier_map,
            user_prompt="Hi",
        )

        # System message should be plain string
        assert isinstance(msgs[0]["content"], str)
        # Last L0 history message should have cache_control
        # It should be msgs[2] (system, user_q1, assistant_a1)
        assert isinstance(msgs[2]["content"], list)
        assert msgs[2]["content"][0]["cache_control"] == {"type": "ephemeral"}

    def test_l1_block_with_symbols(self, tracker, builder):
        """L1 tier produces user/assistant pair with symbols."""
        tracker._items["symbol:a.py"] = TrackedItem(
            key="symbol:a.py", item_type=ItemType.SYMBOL,
            tier=Tier.L1, n=9, content_hash="h", token_estimate=100,
        )

        msgs = builder.build_messages(
            system_prompt="System",
            symbol_map_legend="",
            symbol_blocks={"symbol:a.py": "c MyClass:10\n  m method():15"},
            file_contents={},
            history=[],
            history_tier_map={},
            user_prompt="Hi",
        )

        # Should have system, L1 user, L1 assistant (with cache), user prompt
        # Find the L1 pair
        l1_user = None
        for m in msgs:
            if m["role"] == "user" and "Repository Structure (continued)" in str(m.get("content", "")):
                l1_user = m
                break
        assert l1_user is not None
        assert "MyClass" in str(l1_user["content"])

    def test_empty_tier_skipped(self, builder):
        """Empty tiers produce no messages."""
        msgs = builder.build_messages(
            system_prompt="System",
            symbol_map_legend="",
            symbol_blocks={},
            file_contents={},
            history=[],
            history_tier_map={},
            user_prompt="Hi",
        )
        # Only system + user prompt (no empty tier pairs)
        assert len(msgs) == 2

    def test_file_tree_included(self, builder):
        msgs = builder.build_messages(
            system_prompt="System",
            symbol_map_legend="",
            symbol_blocks={},
            file_contents={},
            history=[],
            history_tier_map={},
            file_tree="README.md\nsrc/main.py",
            user_prompt="Hi",
        )
        tree_msg = next(
            m for m in msgs
            if "Repository Files" in str(m.get("content", ""))
        )
        assert tree_msg["role"] == "user"
        assert "README.md" in str(tree_msg["content"])

    def test_url_context_included(self, builder):
        msgs = builder.build_messages(
            system_prompt="System",
            symbol_map_legend="",
            symbol_blocks={},
            file_contents={},
            history=[],
            history_tier_map={},
            url_context="## https://example.com\nContent",
            user_prompt="Hi",
        )
        url_msg = next(
            m for m in msgs
            if "URL Context" in str(m.get("content", ""))
        )
        assert "example.com" in str(url_msg["content"])

    def test_active_files_included(self, builder):
        msgs = builder.build_messages(
            system_prompt="System",
            symbol_map_legend="",
            symbol_blocks={},
            file_contents={},
            history=[],
            history_tier_map={},
            active_file_contents={"test.py": "x = 1"},
            user_prompt="Hi",
        )
        files_msg = next(
            m for m in msgs
            if "Working Files" in str(m.get("content", ""))
        )
        assert "test.py" in str(files_msg["content"])

    def test_images_multimodal(self, builder):
        msgs = builder.build_messages(
            system_prompt="System",
            symbol_map_legend="",
            symbol_blocks={},
            file_contents={},
            history=[],
            history_tier_map={},
            user_prompt="describe",
            images=["data:image/png;base64,abc"],
        )
        last = msgs[-1]
        assert isinstance(last["content"], list)
        assert last["content"][0]["type"] == "text"
        assert last["content"][1]["type"] == "image_url"

    def test_active_history_at_end(self, tracker, builder):
        """Active history appears after active files, before user prompt."""
        history = [
            {"role": "user", "content": "prev q"},
            {"role": "assistant", "content": "prev a"},
        ]
        tier_map = {0: Tier.ACTIVE, 1: Tier.ACTIVE}

        msgs = builder.build_messages(
            system_prompt="System",
            symbol_map_legend="",
            symbol_blocks={},
            file_contents={},
            history=history,
            history_tier_map=tier_map,
            user_prompt="new q",
        )

        # History should be before user prompt
        contents = [m.get("content", "") for m in msgs]
        assert "prev q" in contents
        assert "prev a" in contents
        # User prompt is last
        assert msgs[-1]["content"] == "new q"

    def test_multi_tier_message_order(self, tracker, builder):
        """Messages follow tier order: L0, L1, L2, L3, tree, urls, active, prompt."""
        # Set up items in multiple tiers
        tracker._items["symbol:core.py"] = TrackedItem(
            key="symbol:core.py", item_type=ItemType.SYMBOL,
            tier=Tier.L1, n=9, content_hash="h", token_estimate=100,
        )
        tracker._items["symbol:util.py"] = TrackedItem(
            key="symbol:util.py", item_type=ItemType.SYMBOL,
            tier=Tier.L3, n=3, content_hash="h", token_estimate=100,
        )

        msgs = builder.build_messages(
            system_prompt="System",
            symbol_map_legend="legend",
            symbol_blocks={
                "symbol:core.py": "f core_fn():1",
                "symbol:util.py": "f util_fn():1",
            },
            file_contents={},
            history=[],
            history_tier_map={},
            file_tree="README.md",
            active_file_contents={"app.py": "x = 1"},
            user_prompt="Hi",
        )

        # Verify order: system (L0), L1 pair, L3 pair, file tree, active files, prompt
        roles = [m["role"] for m in msgs]
        contents_flat = [str(m.get("content", "")) for m in msgs]

        # Find indices
        system_idx = 0
        l1_idx = next(i for i, c in enumerate(contents_flat) if "core_fn" in c)
        l3_idx = next(i for i, c in enumerate(contents_flat) if "util_fn" in c)
        tree_idx = next(i for i, c in enumerate(contents_flat) if "Repository Files" in c)
        active_idx = next(i for i, c in enumerate(contents_flat) if "Working Files" in c)
        prompt_idx = len(msgs) - 1

        assert system_idx < l1_idx < l3_idx < tree_idx < active_idx < prompt_idx

    def test_cache_breakpoints_on_tier_boundaries(self, tracker, builder):
        """Each non-empty cached tier has a cache_control on its last message."""
        tracker._items["symbol:a.py"] = TrackedItem(
            key="symbol:a.py", item_type=ItemType.SYMBOL,
            tier=Tier.L1, n=9, content_hash="h", token_estimate=100,
        )
        tracker._items["symbol:b.py"] = TrackedItem(
            key="symbol:b.py", item_type=ItemType.SYMBOL,
            tier=Tier.L2, n=6, content_hash="h", token_estimate=100,
        )

        msgs = builder.build_messages(
            system_prompt="System",
            symbol_map_legend="",
            symbol_blocks={
                "symbol:a.py": "block_a",
                "symbol:b.py": "block_b",
            },
            file_contents={},
            history=[],
            history_tier_map={},
            user_prompt="Hi",
        )

        # Count cache_control markers
        cache_controlled = 0
        for m in msgs:
            content = m.get("content", "")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and "cache_control" in block:
                        cache_controlled += 1

        # Should have: L0 (system), L1, L2 = 3 breakpoints
        assert cache_controlled == 3


class TestContextManagerTieredIntegration:
    """Integration tests for ContextManager with stability tracker."""

    def test_has_tiered_content_initially_false(self):
        from ac_dc.context import ContextManager
        cm = ContextManager()
        assert not cm.has_tiered_content

    def test_has_tiered_content_after_init(self):
        from ac_dc.context import ContextManager
        cm = ContextManager(cache_target_tokens=100)
        cm.stability.initialize_from_reference_graph(
            [(Tier.L1, ["symbol:a.py"])],
            {"symbol:a.py": 100},
        )
        assert cm.has_tiered_content

    def test_build_active_items(self, tmp_path):
        from ac_dc.context import ContextManager
        (tmp_path / "test.py").write_text("x = 1\n")
        cm = ContextManager(repo_root=tmp_path)
        cm.file_context.add_file("test.py")
        cm.add_exchange("q", "a")

        active = cm.build_active_items(["test.py"])
        assert "file:test.py" in active
        assert "history:0" in active
        assert "history:1" in active
        assert active["file:test.py"]["type"] == ItemType.FILE

    def test_build_history_tier_map(self):
        from ac_dc.context import ContextManager
        cm = ContextManager()
        cm.add_exchange("q1", "a1")
        cm.add_exchange("q2", "a2")

        # All should be active by default
        tier_map = cm._build_history_tier_map()
        assert tier_map[0] == Tier.ACTIVE
        assert tier_map[1] == Tier.ACTIVE
        assert tier_map[2] == Tier.ACTIVE
        assert tier_map[3] == Tier.ACTIVE

    def test_assemble_tiered_messages(self):
        from ac_dc.context import ContextManager
        cm = ContextManager()
        msgs = cm.assemble_tiered_messages(
            user_prompt="Hello",
            system_prompt="Be helpful.",
        )
        assert msgs[0]["role"] == "system"
        assert msgs[-1]["content"] == "Hello"

    def test_reregister_history(self):
        from ac_dc.context import ContextManager
        cm = ContextManager()
        cm.stability.register_item("history:0", ItemType.HISTORY, "h", 50)
        cm.reregister_history_items()
        assert cm.stability.get_item("history:0") is None

    def test_graduated_files_excluded_from_active(self, tmp_path):
        """Files graduated to L3 should not appear in active files section."""
        from ac_dc.context import ContextManager
        (tmp_path / "stable.py").write_text("x = 1\n")
        (tmp_path / "new.py").write_text("y = 2\n")

        cm = ContextManager(repo_root=tmp_path, cache_target_tokens=100)
        cm.file_context.add_file("stable.py")
        cm.file_context.add_file("new.py")

        # Graduate stable.py to L3
        cm.stability.register_item(
            "file:stable.py", ItemType.FILE, "h", 50, tier=Tier.L3,
        )

        msgs = cm.assemble_tiered_messages(
            user_prompt="Hello",
            system_prompt="System",
            file_contents={"file:stable.py": "x = 1\n"},
        )

        # Find the active files section
        active_msg = None
        for m in msgs:
            content = str(m.get("content", ""))
            if "Working Files" in content:
                active_msg = m
                break

        # stable.py should NOT be in active files
        if active_msg:
            assert "stable.py" not in str(active_msg["content"])
        # new.py should be in active files
        assert active_msg is not None
        assert "new.py" in str(active_msg["content"])

    def test_all_files_graduated_no_active_section(self, tmp_path):
        """If all selected files graduated, no active files section."""
        from ac_dc.context import ContextManager
        (tmp_path / "stable.py").write_text("x = 1\n")

        cm = ContextManager(repo_root=tmp_path, cache_target_tokens=100)
        cm.file_context.add_file("stable.py")

        # Graduate to L3
        cm.stability.register_item(
            "file:stable.py", ItemType.FILE, "h", 50, tier=Tier.L3,
        )

        msgs = cm.assemble_tiered_messages(
            user_prompt="Hello",
            system_prompt="System",
            file_contents={"file:stable.py": "x = 1\n"},
        )

        # No "Working Files" section should appear
        for m in msgs:
            content = str(m.get("content", ""))
            assert "Working Files" not in content