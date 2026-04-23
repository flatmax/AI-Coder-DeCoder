"""Tests for ac_dc.edit_protocol — parser and shell command detection.

Scope:

- ``EditParser`` state machine — full-text and streaming-chunk
  modes, every state transition, blank-line tolerance, reset on
  prose.
- ``_is_file_path`` — every branch of the detection heuristic.
- Incomplete-block surfacing — partial blocks at stream end.
- Create blocks — empty old text.
- Multiple blocks in one response.
- ``detect_shell_commands`` — fenced blocks, ``$`` / ``>``
  prefixes, prose filtering, dedup.
- ``parse_text`` convenience entry.

Strategy — the parser is pure and deterministic. No mocks, no
fixtures beyond assembled-string inputs. Each test feeds a
known text (or sequence of chunks) and asserts on the
``ParseResult``.
"""

from __future__ import annotations

from ac_dc.edit_protocol import (
    EditBlock,
    EditParser,
    ParseResult,
    _is_file_path,
    detect_shell_commands,
    parse_text,
)


# ---------------------------------------------------------------------------
# Marker strings — re-declared here so tests fail loudly if the
# module's constants drift. The system prompt documents these
# exact byte sequences, and a silent mismatch between tests and
# module would hide LLM-incompatible changes.
# ---------------------------------------------------------------------------

EDIT = "🟧🟧🟧 EDIT"
REPL = "🟨🟨🟨 REPL"
END = "🟩🟩🟩 END"


def _block(path: str, old: str, new: str) -> str:
    """Assemble one edit block as a complete response string."""
    return f"{path}\n{EDIT}\n{old}\n{REPL}\n{new}\n{END}\n"


# ---------------------------------------------------------------------------
# File path detection
# ---------------------------------------------------------------------------


class TestIsFilePath:
    """Every branch of the _is_file_path heuristic."""

    def test_empty_rejected(self) -> None:
        assert _is_file_path("") is False

    def test_whitespace_only_rejected(self) -> None:
        assert _is_file_path("   ") is False

    def test_long_line_rejected(self) -> None:
        # 200+ chars is prose, not a path.
        assert _is_file_path("a" * 250) is False

    def test_comment_prefix_hash_rejected(self) -> None:
        assert _is_file_path("# not a path") is False

    def test_comment_prefix_slash_slash_rejected(self) -> None:
        assert _is_file_path("// src/foo.py") is False

    def test_comment_prefix_asterisk_rejected(self) -> None:
        assert _is_file_path("* bullet") is False

    def test_comment_prefix_dash_rejected(self) -> None:
        assert _is_file_path("- list item") is False

    def test_comment_prefix_gt_rejected(self) -> None:
        assert _is_file_path("> quoted") is False

    def test_comment_prefix_fence_rejected(self) -> None:
        assert _is_file_path("```bash") is False

    def test_path_with_forward_slash_accepted(self) -> None:
        assert _is_file_path("src/foo.py") is True

    def test_path_with_backslash_accepted(self) -> None:
        assert _is_file_path("src\\foo.py") is True

    def test_path_with_inner_space_rejected(self) -> None:
        """Inner whitespace is prose-like — paths shouldn't contain it."""
        assert _is_file_path("src/my file.py") is False

    def test_filename_with_extension_accepted(self) -> None:
        assert _is_file_path("foo.py") is True

    def test_dotfile_with_extension_accepted(self) -> None:
        assert _is_file_path(".env.local") is True

    def test_dotfile_no_extension_accepted(self) -> None:
        assert _is_file_path(".gitignore") is True

    def test_env_dotfile_accepted(self) -> None:
        assert _is_file_path(".env") is True

    def test_known_extensionless_makefile(self) -> None:
        assert _is_file_path("Makefile") is True

    def test_known_extensionless_dockerfile(self) -> None:
        assert _is_file_path("Dockerfile") is True

    def test_known_extensionless_rakefile(self) -> None:
        assert _is_file_path("Rakefile") is True

    def test_unknown_extensionless_rejected(self) -> None:
        """Random words aren't paths."""
        assert _is_file_path("something") is False

    def test_bare_dot_rejected(self) -> None:
        assert _is_file_path(".") is False

    def test_leading_trailing_whitespace_stripped(self) -> None:
        """Whitespace around a valid path is tolerated."""
        assert _is_file_path("  src/foo.py  ") is True


# ---------------------------------------------------------------------------
# Parser — single complete block
# ---------------------------------------------------------------------------


class TestSingleBlock:
    """Full-text parsing of a single well-formed block."""

    def test_basic_modify_block(self) -> None:
        text = _block("src/foo.py", "old content", "new content")
        result = parse_text(text)
        assert len(result.blocks) == 1
        block = result.blocks[0]
        assert block.file_path == "src/foo.py"
        assert block.old_text == "old content"
        assert block.new_text == "new content"
        assert block.is_create is False
        assert block.completed is True

    def test_multiline_content(self) -> None:
        old = "line 1\nline 2\nline 3"
        new = "line 1 modified\nline 2\nline 3"
        text = _block("foo.py", old, new)
        result = parse_text(text)
        assert len(result.blocks) == 1
        assert result.blocks[0].old_text == old
        assert result.blocks[0].new_text == new

    def test_create_block_empty_old(self) -> None:
        """Empty old text → is_create=True."""
        text = (
            f"new.py\n{EDIT}\n{REPL}\n"
            f"fresh content\n{END}\n"
        )
        result = parse_text(text)
        assert len(result.blocks) == 1
        block = result.blocks[0]
        assert block.is_create is True
        assert block.old_text == ""
        assert block.new_text == "fresh content"

    def test_delete_block_empty_new(self) -> None:
        """Deletion — old text with empty new text. Not create."""
        text = (
            f"foo.py\n{EDIT}\n"
            f"some content\n{REPL}\n{END}\n"
        )
        result = parse_text(text)
        assert len(result.blocks) == 1
        block = result.blocks[0]
        assert block.is_create is False
        assert block.new_text == ""

    def test_block_with_prose_before(self) -> None:
        """Prose preceding the block is ignored."""
        text = (
            "I'll modify the file now.\n\n"
            + _block("foo.py", "old", "new")
        )
        result = parse_text(text)
        assert len(result.blocks) == 1
        assert result.blocks[0].file_path == "foo.py"

    def test_block_with_prose_after(self) -> None:
        """Prose trailing the block is ignored."""
        text = (
            _block("foo.py", "old", "new")
            + "\nThat should do it.\n"
        )
        result = parse_text(text)
        assert len(result.blocks) == 1

    def test_blank_line_between_path_and_marker(self) -> None:
        """Tolerate a blank between path and 🟧🟧🟧 EDIT."""
        text = (
            f"foo.py\n"
            f"\n"
            f"{EDIT}\n"
            f"old\n{REPL}\nnew\n{END}\n"
        )
        result = parse_text(text)
        assert len(result.blocks) == 1
        assert result.blocks[0].file_path == "foo.py"


# ---------------------------------------------------------------------------
# Parser — multiple blocks
# ---------------------------------------------------------------------------


class TestMultipleBlocks:
    """Multiple blocks in one response."""

    def test_two_blocks_different_files(self) -> None:
        text = (
            _block("a.py", "a-old", "a-new")
            + "\n"
            + _block("b.py", "b-old", "b-new")
        )
        result = parse_text(text)
        assert len(result.blocks) == 2
        assert result.blocks[0].file_path == "a.py"
        assert result.blocks[1].file_path == "b.py"

    def test_two_blocks_same_file(self) -> None:
        text = (
            _block("a.py", "first", "first-new")
            + _block("a.py", "second", "second-new")
        )
        result = parse_text(text)
        assert len(result.blocks) == 2
        assert result.blocks[0].old_text == "first"
        assert result.blocks[1].old_text == "second"

    def test_prose_between_blocks(self) -> None:
        text = (
            _block("a.py", "a-old", "a-new")
            + "\nAnd also this change:\n\n"
            + _block("b.py", "b-old", "b-new")
        )
        result = parse_text(text)
        assert len(result.blocks) == 2


# ---------------------------------------------------------------------------
# Parser — incomplete / malformed
# ---------------------------------------------------------------------------


class TestIncomplete:
    """Partial blocks at stream end become ``incomplete`` entries."""

    def test_block_missing_end_marker(self) -> None:
        """EDIT and REPL present, END missing → incomplete."""
        text = (
            f"foo.py\n{EDIT}\n"
            f"old\n{REPL}\n"
            f"new-in-progress"
        )
        result = parse_text(text)
        assert len(result.blocks) == 0
        assert len(result.incomplete) == 1
        incomplete = result.incomplete[0]
        assert incomplete.file_path == "foo.py"
        assert incomplete.old_text == "old"
        assert incomplete.new_text == "new-in-progress"
        assert incomplete.completed is False

    def test_block_missing_separator_and_end(self) -> None:
        """EDIT present, REPL and END missing → incomplete."""
        text = f"foo.py\n{EDIT}\nold content still arriving"
        result = parse_text(text)
        assert len(result.blocks) == 0
        assert len(result.incomplete) == 1
        incomplete = result.incomplete[0]
        assert incomplete.file_path == "foo.py"
        assert incomplete.old_text == "old content still arriving"
        assert incomplete.new_text == ""

    def test_expect_edit_reset_on_prose(self) -> None:
        """Path followed by prose (not EDIT marker) resets state."""
        text = "src/foo.py\nJust some prose here.\n"
        result = parse_text(text)
        assert len(result.blocks) == 0
        assert len(result.incomplete) == 0

    def test_bare_path_at_end(self) -> None:
        """Path line at end of stream, never followed by EDIT."""
        text = "Here's a file: src/foo.py\n"
        result = parse_text(text)
        assert len(result.blocks) == 0
        assert len(result.incomplete) == 0

    def test_edit_marker_without_prior_path(self) -> None:
        """EDIT marker with no preceding path — nothing produced."""
        text = f"{EDIT}\nold\n{REPL}\nnew\n{END}\n"
        result = parse_text(text)
        assert len(result.blocks) == 0
        assert len(result.incomplete) == 0


# ---------------------------------------------------------------------------
# Parser — streaming chunks
# ---------------------------------------------------------------------------


class TestStreamingChunks:
    """EditParser.feed() accumulates across chunk boundaries."""

    def test_complete_block_in_one_chunk(self) -> None:
        parser = EditParser()
        parser.feed(_block("foo.py", "old", "new"))
        result = parser.finalize()
        assert len(result.blocks) == 1

    def test_block_split_across_two_chunks(self) -> None:
        parser = EditParser()
        full = _block("foo.py", "old content", "new content")
        mid = len(full) // 2
        parser.feed(full[:mid])
        parser.feed(full[mid:])
        result = parser.finalize()
        assert len(result.blocks) == 1
        assert result.blocks[0].file_path == "foo.py"

    def test_block_split_at_every_char(self) -> None:
        """Pathological chunk boundary — one char at a time."""
        parser = EditParser()
        for ch in _block("foo.py", "old", "new"):
            parser.feed(ch)
        result = parser.finalize()
        assert len(result.blocks) == 1

    def test_split_mid_marker(self) -> None:
        """Chunk boundary inside a marker line."""
        parser = EditParser()
        full = _block("foo.py", "old", "new")
        # Split right in the middle of the 🟨🟨🟨 REPL line.
        repl_pos = full.index(REPL)
        split = repl_pos + 3  # arbitrary mid-marker index
        parser.feed(full[:split])
        parser.feed(full[split:])
        result = parser.finalize()
        assert len(result.blocks) == 1

    def test_trailing_partial_line_retained(self) -> None:
        """A chunk ending mid-line buffers the tail."""
        parser = EditParser()
        # "foo" is incomplete — no newline yet. Parser should not
        # have processed it as a line.
        parser.feed("foo")
        # No blocks produced yet.
        result_mid = parser.finalize()
        # finalize flushes the buffer; but since "foo" alone
        # can't form a block, we still have nothing.
        assert len(result_mid.blocks) == 0

    def test_streaming_block_feeds_before_completion(self) -> None:
        """Chunks arrive incrementally — completion at end."""
        parser = EditParser()
        parser.feed("foo.py\n")
        assert len(parser._blocks) == 0
        parser.feed(f"{EDIT}\n")
        parser.feed("old\n")
        parser.feed(f"{REPL}\n")
        parser.feed("new\n")
        assert len(parser._blocks) == 0  # still no END
        parser.feed(f"{END}\n")
        assert len(parser._blocks) == 1  # now completed
        result = parser.finalize()
        assert len(result.blocks) == 1

    def test_two_blocks_streamed_across_chunks(self) -> None:
        parser = EditParser()
        full = (
            _block("a.py", "a-old", "a-new")
            + _block("b.py", "b-old", "b-new")
        )
        # Quarter-sized chunks.
        q = len(full) // 4
        parser.feed(full[:q])
        parser.feed(full[q:2*q])
        parser.feed(full[2*q:3*q])
        parser.feed(full[3*q:])
        result = parser.finalize()
        assert len(result.blocks) == 2

    def test_incomplete_block_at_end_of_stream(self) -> None:
        """Block that ended mid-REPL section surfaces as incomplete."""
        parser = EditParser()
        parser.feed(f"foo.py\n{EDIT}\nold\n{REPL}\nnew-")
        result = parser.finalize()
        assert len(result.blocks) == 0
        assert len(result.incomplete) == 1


# ---------------------------------------------------------------------------
# Parser — edge cases around path detection interaction
# ---------------------------------------------------------------------------


class TestPathDetectionIntegration:
    """Parser's behaviour when path-detection-vs-prose is ambiguous."""

    def test_multiple_prose_paths_then_real_block(self) -> None:
        """Paths mentioned in prose don't prevent a later real block."""
        text = (
            "Consider src/a.py and src/b.py.\n"
            "Now here's the change:\n\n"
            + _block("src/c.py", "old", "new")
        )
        result = parse_text(text)
        assert len(result.blocks) == 1
        assert result.blocks[0].file_path == "src/c.py"

    def test_path_then_another_path_then_edit(self) -> None:
        """Path followed by another path: second wins."""
        text = (
            "old.py\n"
            "new.py\n"
            f"{EDIT}\nold\n{REPL}\nnew\n{END}\n"
        )
        result = parse_text(text)
        assert len(result.blocks) == 1
        # The second path is the one immediately before 🟧🟧🟧 EDIT.
        assert result.blocks[0].file_path == "new.py"

    def test_path_in_old_text_not_treated_as_new_path(self) -> None:
        """Path-like lines inside old/new text are just content."""
        # READING_OLD state doesn't do path detection; every
        # non-REPL line is content.
        text = (
            f"foo.py\n{EDIT}\n"
            f"bar.py\n"  # path-like, but inside old text
            f"other content\n"
            f"{REPL}\n"
            f"replacement\n{END}\n"
        )
        result = parse_text(text)
        assert len(result.blocks) == 1
        assert "bar.py" in result.blocks[0].old_text


# ---------------------------------------------------------------------------
# parse_text convenience wrapper
# ---------------------------------------------------------------------------


class TestParseText:
    """parse_text() is the one-shot entry."""

    def test_returns_parse_result(self) -> None:
        result = parse_text(_block("foo.py", "old", "new"))
        assert isinstance(result, ParseResult)
        assert len(result.blocks) == 1

    def test_populates_shell_commands(self) -> None:
        """parse_text also extracts shell commands."""
        text = (
            "Run this first:\n"
            "$ npm install\n\n"
            + _block("foo.py", "old", "new")
        )
        result = parse_text(text)
        assert "npm install" in result.shell_commands

    def test_empty_input(self) -> None:
        result = parse_text("")
        assert result.blocks == []
        assert result.incomplete == []
        assert result.shell_commands == []


# ---------------------------------------------------------------------------
# Shell command detection
# ---------------------------------------------------------------------------


class TestShellCommands:
    """detect_shell_commands extraction patterns."""

    def test_fenced_bash_block(self) -> None:
        text = "```bash\nnpm install\nnpm run build\n```\n"
        cmds = detect_shell_commands(text)
        assert cmds == ["npm install", "npm run build"]

    def test_fenced_shell_block(self) -> None:
        text = "```shell\nls -la\n```\n"
        assert detect_shell_commands(text) == ["ls -la"]

    def test_fenced_sh_block(self) -> None:
        text = "```sh\necho hello\n```\n"
        assert detect_shell_commands(text) == ["echo hello"]

    def test_fenced_block_skips_comments(self) -> None:
        """Lines starting with # inside fenced blocks are skipped."""
        text = (
            "```bash\n"
            "# This is a comment\n"
            "npm install\n"
            "# another comment\n"
            "npm test\n"
            "```\n"
        )
        cmds = detect_shell_commands(text)
        assert cmds == ["npm install", "npm test"]

    def test_fenced_block_skips_blank_lines(self) -> None:
        text = "```bash\n\nnpm install\n\n```\n"
        assert detect_shell_commands(text) == ["npm install"]

    def test_dollar_prefix(self) -> None:
        text = "Run this:\n$ npm install\nThat's it."
        assert detect_shell_commands(text) == ["npm install"]

    def test_gt_prefix(self) -> None:
        text = "Try:\n> git status\n"
        assert detect_shell_commands(text) == ["git status"]

    def test_gt_prefix_filters_prose_note(self) -> None:
        """> Note: ... is prose, not a command."""
        text = "> Note: this is important.\n> Warning: careful.\n"
        assert detect_shell_commands(text) == []

    def test_gt_prefix_filters_prose_this(self) -> None:
        text = "> This is a block quote.\n"
        assert detect_shell_commands(text) == []

    def test_gt_prefix_filters_prose_the(self) -> None:
        text = "> The result is...\n"
        assert detect_shell_commands(text) == []

    def test_gt_prefix_filters_prose_make(self) -> None:
        """Prose filter catches 'Make sure'; but 'make test' is a command."""
        text = "> Make sure you install first.\n"
        assert detect_shell_commands(text) == []

    def test_gt_prefix_accepts_make_command(self) -> None:
        """Lowercase 'make' is not a prose word."""
        text = "> make test\n"
        assert detect_shell_commands(text) == ["make test"]

    def test_dedup_across_patterns(self) -> None:
        """Same command in fenced block and $ prefix → single entry."""
        text = (
            "$ npm install\n"
            "```bash\n"
            "npm install\n"
            "```\n"
        )
        cmds = detect_shell_commands(text)
        assert cmds.count("npm install") == 1

    def test_encounter_order_preserved(self) -> None:
        """Commands appear in encounter order."""
        text = (
            "```bash\n"
            "first\n"
            "second\n"
            "```\n"
            "$ third\n"
            "> fourth\n"
        )
        cmds = detect_shell_commands(text)
        assert cmds == ["first", "second", "third", "fourth"]

    def test_no_commands(self) -> None:
        text = "Just prose. No commands here.\n"
        assert detect_shell_commands(text) == []

    def test_fenced_block_not_shell_language(self) -> None:
        """Non-shell language tags don't match."""
        text = "```python\nprint('hi')\n```\n"
        assert detect_shell_commands(text) == []

    def test_gt_prefix_inside_fenced_block_not_double_matched(self) -> None:
        """> inside a fenced block is code, but also shouldn't match
        as gt-prefix after fence stripping."""
        text = (
            "```bash\n"
            "echo hello\n"
            "```\n"
            "> git status\n"
        )
        cmds = detect_shell_commands(text)
        assert cmds == ["echo hello", "git status"]


# ---------------------------------------------------------------------------
# Parser — field defaults and shape
# ---------------------------------------------------------------------------


class TestEditBlockShape:
    """EditBlock dataclass defaults."""

    def test_default_completed_true(self) -> None:
        b = EditBlock(file_path="foo", old_text="o", new_text="n")
        assert b.completed is True

    def test_default_is_create_false(self) -> None:
        b = EditBlock(file_path="foo", old_text="o", new_text="n")
        assert b.is_create is False


# ---------------------------------------------------------------------------
# Finalize idempotence
# ---------------------------------------------------------------------------


class TestFinalize:
    """finalize() behaviour — buffer flush, state handling."""

    def test_finalize_on_empty_parser(self) -> None:
        parser = EditParser()
        result = parser.finalize()
        assert result.blocks == []
        assert result.incomplete == []

    def test_finalize_flushes_partial_tail(self) -> None:
        """A final chunk without trailing newline is still processed."""
        parser = EditParser()
        # Full block but last line has no trailing newline.
        parser.feed(f"foo.py\n{EDIT}\nold\n{REPL}\nnew\n{END}")
        result = parser.finalize()
        assert len(result.blocks) == 1

    def test_finalize_returns_blocks_copy(self) -> None:
        """finalize's blocks list is a copy — parser state not leaked."""
        parser = EditParser()
        parser.feed(_block("foo.py", "old", "new"))
        result = parser.finalize()
        result.blocks.append(
            EditBlock(file_path="x", old_text="", new_text="")
        )
        # Parser's internal list unaffected.
        assert len(parser._blocks) == 1