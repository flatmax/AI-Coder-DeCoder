"""Tests for ContextManager.assemble_tiered_messages (Layer 3.8).

Scope — the tiered assembly method only. Exercises message
ordering, cache-control placement, tier-exclusion semantics, the
cross-reference legend slot, multimodal user messages, and the
graduated-file / graduated-history exclusions.

Uses real `ContextManager` instances rather than stubs — the
method is a pure function of the manager's state plus its
arguments, and constructing a real manager is cheap.

Tiered-content fixtures are built via a helper that fills in
empty tiers by default; tests only set the fields they care
about.
"""

from __future__ import annotations

from typing import Any

import pytest

from ac_dc.context_manager import (
    DOC_MAP_HEADER,
    FILE_TREE_HEADER,
    FILES_ACTIVE_HEADER,
    FILES_L0_HEADER,
    FILES_L1_HEADER,
    FILES_L2_HEADER,
    FILES_L3_HEADER,
    REPO_MAP_HEADER,
    REVIEW_CONTEXT_HEADER,
    TIER_SYMBOLS_HEADER,
    URL_CONTEXT_HEADER,
    ContextManager,
    Mode,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _empty_tier() -> dict[str, Any]:
    """Return an empty tier-content dict matching the assembler's shape."""
    return {
        "symbols": "",
        "files": "",
        "history": [],
        "graduated_files": [],
        "graduated_history_indices": [],
    }


def _tiered(**tiers: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Build a four-tier dict, filling unspecified tiers with empties."""
    base = {t: _empty_tier() for t in ("L0", "L1", "L2", "L3")}
    for name, content in tiers.items():
        merged = _empty_tier()
        merged.update(content)
        base[name] = merged
    return base


def _cm(**kwargs: Any) -> ContextManager:
    """Construct a ContextManager with a fake model for tests."""
    defaults = {"model_name": "anthropic/claude-sonnet-4-5-20250929"}
    defaults.update(kwargs)
    return ContextManager(**defaults)


def _has_cache_control(msg: dict[str, Any]) -> bool:
    """Return True if the message's content carries cache_control."""
    content = msg.get("content")
    if not isinstance(content, list):
        return False
    return any(
        isinstance(block, dict) and block.get("cache_control") == {"type": "ephemeral"}
        for block in content
    )


def _text_of(msg: dict[str, Any]) -> str:
    """Return the text content of a message regardless of shape."""
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text") or "")
        return "\n".join(parts)
    return ""


# ---------------------------------------------------------------------------
# Basic shape and fallback
# ---------------------------------------------------------------------------


class TestBasicShape:
    """The top-level structure of the returned message array."""

    def test_none_tiered_content_raises(self) -> None:
        cm = _cm()
        with pytest.raises(ValueError):
            cm.assemble_tiered_messages(
                user_prompt="hi", tiered_content=None
            )

    def test_empty_tiers_produces_system_plus_user(self) -> None:
        cm = _cm(system_prompt="SYS")
        messages = cm.assemble_tiered_messages(
            user_prompt="hello",
            tiered_content=_tiered(),
        )
        # System message first, user message last. No tier pairs
        # between because every tier is empty.
        assert messages[0]["role"] == "system"
        assert messages[-1]["role"] == "user"
        assert _text_of(messages[-1]) == "hello"

    def test_system_prompt_in_l0(self) -> None:
        cm = _cm(system_prompt="SYS")
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(),
        )
        assert "SYS" in _text_of(messages[0])

    def test_current_user_message_is_last(self) -> None:
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="the prompt",
            tiered_content=_tiered(),
        )
        assert messages[-1] == {"role": "user", "content": "the prompt"}


# ---------------------------------------------------------------------------
# Cache-control placement
# ---------------------------------------------------------------------------


class TestCacheControl:
    """Cache-control markers land where specs4 says they should."""

    def test_l0_without_history_marks_system_message(self) -> None:
        cm = _cm(system_prompt="SYS")
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(),
        )
        # System is the breakpoint when L0 has no history.
        assert _has_cache_control(messages[0])

    def test_l0_with_history_marks_last_l0_history(self) -> None:
        cm = _cm(system_prompt="SYS")
        l0_history = [
            {"role": "user", "content": "early user"},
            {"role": "assistant", "content": "early reply"},
        ]
        messages = cm.assemble_tiered_messages(
            user_prompt="now",
            tiered_content=_tiered(L0={"history": l0_history}),
        )
        # System is plain string content (no cache_control) when
        # L0 history carries the breakpoint.
        assert isinstance(messages[0]["content"], str)
        # The LAST L0 history message gets the marker.
        last_l0 = messages[1 + len(l0_history) - 1]
        assert _has_cache_control(last_l0)
        # Earlier L0 history entries don't.
        if len(l0_history) > 1:
            assert not _has_cache_control(messages[1])

    def test_each_cached_tier_gets_exactly_one_marker(self) -> None:
        cm = _cm(system_prompt="SYS")
        tiered = _tiered(
            L1={"symbols": "L1-sym"},
            L2={"symbols": "L2-sym"},
            L3={"symbols": "L3-sym"},
        )
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=tiered,
        )
        marker_count = sum(1 for m in messages if _has_cache_control(m))
        # L0 (system) + L1 + L2 + L3 = 4 markers.
        assert marker_count == 4

    def test_empty_tier_produces_no_marker(self) -> None:
        cm = _cm()
        tiered = _tiered(L1={"symbols": "L1-sym"})
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=tiered,
        )
        # Only L0 and L1 have markers. L2 and L3 are empty so
        # they contribute none.
        marker_count = sum(1 for m in messages if _has_cache_control(m))
        assert marker_count == 2


# ---------------------------------------------------------------------------
# Headers and mode dispatch
# ---------------------------------------------------------------------------


class TestHeaders:
    """Map and section headers render correctly per mode."""

    def test_code_mode_uses_repo_header(self) -> None:
        cm = _cm()
        cm.set_mode(Mode.CODE)
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            symbol_legend="LEGEND",
            tiered_content=_tiered(),
        )
        assert REPO_MAP_HEADER in _text_of(messages[0])
        assert "LEGEND" in _text_of(messages[0])

    def test_doc_mode_uses_doc_header(self) -> None:
        cm = _cm()
        cm.set_mode(Mode.DOC)
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            symbol_legend="DOCLEGEND",
            tiered_content=_tiered(),
        )
        assert DOC_MAP_HEADER in _text_of(messages[0])

    def test_cross_ref_places_secondary_legend_under_other_header(
        self,
    ) -> None:
        """Cross-reference mode uses opposite header for secondary legend."""
        cm = _cm()
        cm.set_mode(Mode.CODE)
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            symbol_legend="CODE_LEGEND",
            doc_legend="DOC_LEGEND",
            tiered_content=_tiered(),
        )
        system_text = _text_of(messages[0])
        # Primary is code → under REPO header.
        assert REPO_MAP_HEADER in system_text
        # Secondary is doc → under DOC header (the opposite).
        assert DOC_MAP_HEADER in system_text
        assert "DOC_LEGEND" in system_text

    def test_file_tree_renders_as_uncached_pair(self) -> None:
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            file_tree="a.py\nb.py",
            tiered_content=_tiered(),
        )
        # File-tree pair appears after the system message but
        # before the final user message.
        tree_msg = next(
            m for m in messages
            if m.get("role") == "user"
            and FILE_TREE_HEADER in _text_of(m)
        )
        assert "a.py\nb.py" in _text_of(tree_msg)
        # Not cached — plain string content.
        assert isinstance(tree_msg["content"], str)

    def test_l0_files_use_l0_header(self) -> None:
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(
                L0={"files": "some-file.py content"}
            ),
        )
        assert FILES_L0_HEADER in _text_of(messages[0])

    def test_l1_files_use_l1_header(self) -> None:
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(L1={"files": "l1.py body"}),
        )
        l1_text = "\n\n".join(_text_of(m) for m in messages)
        assert FILES_L1_HEADER in l1_text

    def test_l2_files_use_l2_header(self) -> None:
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(L2={"files": "l2.py body"}),
        )
        all_text = "\n\n".join(_text_of(m) for m in messages)
        assert FILES_L2_HEADER in all_text

    def test_l3_files_use_l3_header(self) -> None:
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(L3={"files": "l3.py body"}),
        )
        all_text = "\n\n".join(_text_of(m) for m in messages)
        assert FILES_L3_HEADER in all_text

    def test_tier_symbols_use_continued_header(self) -> None:
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(L1={"symbols": "L1-SYM"}),
        )
        all_text = "\n\n".join(_text_of(m) for m in messages)
        assert TIER_SYMBOLS_HEADER in all_text
        assert "L1-SYM" in all_text


# ---------------------------------------------------------------------------
# Tier pair rendering
# ---------------------------------------------------------------------------


class TestTierPairs:
    """L1–L3 each produce a user/assistant pair when non-empty."""

    def test_tier_with_symbols_produces_user_assistant_pair(self) -> None:
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(L1={"symbols": "L1-content"}),
        )
        # Find the L1 pair.
        l1_user = next(
            (m for m in messages
             if m.get("role") == "user"
             and TIER_SYMBOLS_HEADER in _text_of(m)),
            None,
        )
        assert l1_user is not None
        # The message immediately after is the assistant ack.
        idx = messages.index(l1_user)
        ack = messages[idx + 1]
        assert ack["role"] == "assistant"
        assert _text_of(ack) == "Ok."

    def test_tier_with_files_only_still_produces_pair(self) -> None:
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(L1={"files": "l1.py body"}),
        )
        l1_user = next(
            (m for m in messages
             if m.get("role") == "user"
             and FILES_L1_HEADER in _text_of(m)),
            None,
        )
        assert l1_user is not None
        idx = messages.index(l1_user)
        assert messages[idx + 1]["role"] == "assistant"

    def test_tier_with_history_only_appends_native_messages(self) -> None:
        cm = _cm()
        l1_history = [
            {"role": "user", "content": "graduated q"},
            {"role": "assistant", "content": "graduated a"},
        ]
        messages = cm.assemble_tiered_messages(
            user_prompt="now",
            tiered_content=_tiered(L1={"history": l1_history}),
        )
        # Find the two graduated history messages in order.
        contents = [_text_of(m) for m in messages]
        assert "graduated q" in contents
        assert "graduated a" in contents
        # The LAST of the tier's messages gets the breakpoint.
        last_idx = contents.index("graduated a")
        assert _has_cache_control(messages[last_idx])

    def test_tier_ordering_l1_l2_l3(self) -> None:
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(
                L1={"symbols": "L1-SYM"},
                L2={"symbols": "L2-SYM"},
                L3={"symbols": "L3-SYM"},
            ),
        )
        all_text = "\n\n".join(_text_of(m) for m in messages)
        assert all_text.index("L1-SYM") < all_text.index("L2-SYM")
        assert all_text.index("L2-SYM") < all_text.index("L3-SYM")


# ---------------------------------------------------------------------------
# URL and review context
# ---------------------------------------------------------------------------


class TestOptionalContext:
    """URL and review context sections render when set."""

    def test_url_context_renders_when_present(self) -> None:
        cm = _cm()
        cm.set_url_context(["URL-A-CONTENT", "URL-B-CONTENT"])
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(),
        )
        url_msg = next(
            (m for m in messages
             if m.get("role") == "user"
             and URL_CONTEXT_HEADER in _text_of(m)),
            None,
        )
        assert url_msg is not None
        text = _text_of(url_msg)
        assert "URL-A-CONTENT" in text
        assert "URL-B-CONTENT" in text

    def test_url_context_omitted_when_empty(self) -> None:
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(),
        )
        all_text = "\n\n".join(_text_of(m) for m in messages)
        assert URL_CONTEXT_HEADER not in all_text

    def test_review_context_renders_when_set(self) -> None:
        cm = _cm()
        cm.set_review_context("REVIEW-BODY")
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(),
        )
        review_msg = next(
            (m for m in messages
             if m.get("role") == "user"
             and REVIEW_CONTEXT_HEADER in _text_of(m)),
            None,
        )
        assert review_msg is not None
        assert "REVIEW-BODY" in _text_of(review_msg)

    def test_review_context_omitted_when_not_set(self) -> None:
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(),
        )
        all_text = "\n\n".join(_text_of(m) for m in messages)
        assert REVIEW_CONTEXT_HEADER not in all_text


# ---------------------------------------------------------------------------
# Active files
# ---------------------------------------------------------------------------


class TestActiveFiles:
    """Files in FileContext render as the active working-files section."""

    def test_active_files_render_when_not_graduated(self) -> None:
        cm = _cm()
        cm.file_context.add_file("a.py", "A content")
        cm.file_context.add_file("b.py", "B content")
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(),
        )
        active_msg = next(
            (m for m in messages
             if m.get("role") == "user"
             and FILES_ACTIVE_HEADER in _text_of(m)),
            None,
        )
        assert active_msg is not None
        text = _text_of(active_msg)
        assert "a.py" in text
        assert "A content" in text
        assert "b.py" in text

    def test_graduated_file_excluded_from_active(self) -> None:
        cm = _cm()
        cm.file_context.add_file("a.py", "A content")
        cm.file_context.add_file("b.py", "B content")
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(
                L1={
                    "files": "a.py\n```\nA content\n```",
                    "graduated_files": ["a.py"],
                },
            ),
        )
        active_msg = next(
            (m for m in messages
             if m.get("role") == "user"
             and FILES_ACTIVE_HEADER in _text_of(m)),
            None,
        )
        assert active_msg is not None
        text = _text_of(active_msg)
        # a.py is graduated — excluded from active. b.py stays.
        assert "A content" not in text
        assert "B content" in text

    def test_all_files_graduated_omits_active_section(self) -> None:
        cm = _cm()
        cm.file_context.add_file("a.py", "A content")
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(
                L1={
                    "files": "a.py\n```\nA content\n```",
                    "graduated_files": ["a.py"],
                },
            ),
        )
        all_text = "\n\n".join(_text_of(m) for m in messages)
        # FILES_ACTIVE_HEADER string contains both "Working Files"
        # and the "Here are the files" intro — check the header
        # literal isn't present.
        assert FILES_ACTIVE_HEADER not in all_text

    def test_no_file_context_omits_active_section(self) -> None:
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(),
        )
        all_text = "\n\n".join(_text_of(m) for m in messages)
        assert FILES_ACTIVE_HEADER not in all_text


# ---------------------------------------------------------------------------
# Active history
# ---------------------------------------------------------------------------


class TestActiveHistory:
    """History messages not in any cached tier appear as active history."""

    def test_active_history_rendered_in_order(self) -> None:
        cm = _cm()
        cm.add_message("user", "user 0")
        cm.add_message("assistant", "assistant 0")
        cm.add_message("user", "user 1")
        # assistant 1 is the assistant reply we're constructing —
        # so the "current" user message is the last user msg.
        # Assembly strips that last user msg before rendering
        # since it's rebuilt from user_prompt.
        messages = cm.assemble_tiered_messages(
            user_prompt="user 1",
            tiered_content=_tiered(),
        )
        contents = [_text_of(m) for m in messages]
        # user 0 and assistant 0 appear before the final user prompt.
        # The last user message ("user 1") from history is stripped
        # since it would duplicate user_prompt.
        idx_u0 = contents.index("user 0")
        idx_a0 = contents.index("assistant 0")
        assert idx_u0 < idx_a0
        # Final user message is the last entry.
        assert contents[-1] == "user 1"
        # "user 1" should appear exactly once (not twice).
        assert contents.count("user 1") == 1

    def test_graduated_history_excluded_from_active(self) -> None:
        cm = _cm()
        cm.add_message("user", "user 0")
        cm.add_message("assistant", "assistant 0")
        cm.add_message("user", "user 1")
        cm.add_message("assistant", "assistant 1")
        # Graduate indices 0 and 1 to L1.
        l1_history = [
            {"role": "user", "content": "user 0"},
            {"role": "assistant", "content": "assistant 0"},
        ]
        messages = cm.assemble_tiered_messages(
            user_prompt="now",
            tiered_content=_tiered(
                L1={
                    "history": l1_history,
                    "graduated_history_indices": [0, 1],
                },
            ),
        )
        contents = [_text_of(m) for m in messages]
        # user 0 and assistant 0 appear in the L1 tier block, not
        # in active history. Since the tier block renders them
        # before active history, their first appearance is the
        # tier. If they also appeared in active history we'd see
        # them twice.
        assert contents.count("user 0") == 1
        assert contents.count("assistant 0") == 1


# ---------------------------------------------------------------------------
# Multimodal user message
# ---------------------------------------------------------------------------


class TestMultimodal:
    """Images produce multimodal content blocks on the final user message."""

    def test_images_produce_multimodal_content(self) -> None:
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="describe this",
            images=["data:image/png;base64,AAAA"],
            tiered_content=_tiered(),
        )
        user_msg = messages[-1]
        assert user_msg["role"] == "user"
        assert isinstance(user_msg["content"], list)
        # First block is text, second is image_url.
        assert user_msg["content"][0]["type"] == "text"
        assert user_msg["content"][0]["text"] == "describe this"
        assert user_msg["content"][1]["type"] == "image_url"
        assert user_msg["content"][1]["image_url"]["url"].startswith(
            "data:image/png"
        )

    def test_no_images_produces_plain_text(self) -> None:
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            tiered_content=_tiered(),
        )
        user_msg = messages[-1]
        assert isinstance(user_msg["content"], str)
        assert user_msg["content"] == "hi"

    def test_non_data_uri_image_skipped(self) -> None:
        """A non-data: URI isn't a valid inline image; assembly skips it."""
        cm = _cm()
        messages = cm.assemble_tiered_messages(
            user_prompt="hi",
            images=["https://example.com/pic.png"],
            tiered_content=_tiered(),
        )
        user_msg = messages[-1]
        assert isinstance(user_msg["content"], list)
        # Only the text block survives — the URL isn't a data URI
        # so it's filtered out.
        image_blocks = [
            b for b in user_msg["content"]
            if b.get("type") == "image_url"
        ]
        assert image_blocks == []


# ---------------------------------------------------------------------------
# Ordering invariants
# ---------------------------------------------------------------------------


class TestOrdering:
    """Overall ordering: L0 → tiers → tree → URL → review → active files → active history → prompt."""

    def test_full_ordering_with_every_section(self) -> None:
        cm = _cm(system_prompt="SYS")
        cm.add_message("user", "history-u")
        cm.add_message("assistant", "history-a")
        cm.file_context.add_file("keep.py", "KEEP")
        cm.set_url_context(["URL-BODY"])
        cm.set_review_context("REVIEW-BODY")

        messages = cm.assemble_tiered_messages(
            user_prompt="now",
            symbol_legend="LEG",
            file_tree="tree.py",
            tiered_content=_tiered(L1={"symbols": "L1-SYM"}),
        )
        all_text = "\n\n".join(_text_of(m) for m in messages)
        # Ordering spot-checks — each marker should appear before
        # the next.
        positions = {
            "SYS": all_text.index("SYS"),
            "LEG": all_text.index("LEG"),
            "L1-SYM": all_text.index("L1-SYM"),
            "tree.py": all_text.index("tree.py"),
            "URL-BODY": all_text.index("URL-BODY"),
            "REVIEW-BODY": all_text.index("REVIEW-BODY"),
            "KEEP": all_text.index("KEEP"),
            "history-u": all_text.index("history-u"),
            "now": all_text.rindex("now"),
        }
        ordered_labels = [
            "SYS", "LEG", "L1-SYM", "tree.py", "URL-BODY",
            "REVIEW-BODY", "KEEP", "history-u", "now",
        ]
        for a, b in zip(ordered_labels, ordered_labels[1:]):
            assert positions[a] < positions[b], (
                f"{a} should appear before {b} in assembled prompt"
            )