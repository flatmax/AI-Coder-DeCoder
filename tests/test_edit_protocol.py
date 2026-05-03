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
- Agent-spawn blocks — reserved marker recognition, field
  parsing, multi-line task support, validity flag, streaming
  chunk accumulation.

Strategy — the parser is pure and deterministic. No mocks, no
fixtures beyond assembled-string inputs. Each test feeds a
known text (or sequence of chunks) and asserts on the
``ParseResult``.
"""

from __future__ import annotations

from ac_dc.edit_protocol import (
    AgentBlock,
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

# Agent-spawn markers — reserved for the future parallel-agents
# feature. Same re-declaration discipline as the edit markers:
# drift between this module and edit_protocol.py surfaces as
# test failures rather than silent protocol violations.
AGENT = "🟧🟧🟧 AGENT"
AGEND = "🟩🟩🟩 AGEND"


def _block(path: str, old: str, new: str) -> str:
    """Assemble one edit block as a complete response string."""
    return f"{path}\n{EDIT}\n{old}\n{REPL}\n{new}\n{END}\n"


def _agent_block(body: str) -> str:
    """Assemble one agent-spawn block as a complete response string.

    ``body`` is inserted verbatim between the start and end
    markers. Callers supply already-formatted YAML-ish
    ``key: value`` lines including any trailing newlines.
    """
    return f"{AGENT}\n{body}{AGEND}\n"


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


# ---------------------------------------------------------------------------
# Agent-spawn blocks — Slice 3 of the parallel-agents foundation
# ---------------------------------------------------------------------------


class TestAgentBlockShape:
    """AgentBlock dataclass defaults and fields."""

    def test_default_valid_true(self) -> None:
        """A hand-constructed AgentBlock defaults to valid=True."""
        b = AgentBlock(id="agent-0", task="do the thing")
        assert b.valid is True

    def test_default_completed_true(self) -> None:
        """Hand-constructed blocks default to completed=True."""
        b = AgentBlock(id="a", task="t")
        assert b.completed is True

    def test_default_extras_empty_dict(self) -> None:
        """extras defaults to a fresh empty dict per instance."""
        b1 = AgentBlock(id="a", task="t")
        b2 = AgentBlock(id="b", task="t")
        b1.extras["shared"] = "bad"
        # Mutating one doesn't affect the other — separate
        # default dicts, not a shared reference.
        assert b2.extras == {}


class TestAgentBlockParsing:
    """Parser accepts a well-formed agent block."""

    def test_minimal_agent_block(self) -> None:
        """id + task only — minimum valid agent block."""
        text = _agent_block("id: agent-0\ntask: do the thing\n")
        result = parse_text(text)
        assert len(result.agent_blocks) == 1
        block = result.agent_blocks[0]
        assert block.id == "agent-0"
        assert block.task == "do the thing"
        assert block.extras == {}
        assert block.valid is True
        assert block.completed is True

    def test_no_edit_blocks_produced(self) -> None:
        """Agent block doesn't accidentally register as an edit block."""
        text = _agent_block("id: a\ntask: t\n")
        result = parse_text(text)
        assert result.blocks == []
        assert result.incomplete == []

    def test_multiline_task(self) -> None:
        """Continuation lines are appended to task with newlines.

        Pins the load-bearing "task may span multiple lines"
        behaviour from specs4/7-future/parallel-agents.md §
        Agent-spawn block format.
        """
        body = (
            "id: agent-0\n"
            "task: Refactor the auth module to extract session\n"
            "logic into a new SessionManager class. Update\n"
            "callers of auth.Session to use the new class.\n"
        )
        text = _agent_block(body)
        result = parse_text(text)
        assert len(result.agent_blocks) == 1
        block = result.agent_blocks[0]
        assert block.id == "agent-0"
        # Multi-line task joined with newlines.
        assert "Refactor the auth module" in block.task
        assert "SessionManager class" in block.task
        assert "callers of auth.Session" in block.task
        assert "\n" in block.task

    def test_task_before_id(self) -> None:
        """Field order doesn't matter — task can come first."""
        body = "task: do it\nid: agent-5\n"
        text = _agent_block(body)
        result = parse_text(text)
        assert len(result.agent_blocks) == 1
        block = result.agent_blocks[0]
        assert block.id == "agent-5"
        assert block.task == "do it"

    def test_unknown_fields_captured_in_extras(self) -> None:
        """Forward-compat: unknown keys land in ``extras``.

        Per specs4/7-future/mcp-integration.md § Agent block
        extension for MCP, a future ``tools:`` field uses the
        extras slot without requiring a parser change. This
        test uses ``tools`` as the representative unknown
        field.
        """
        body = "id: a\ntask: t\ntools: gitlab, slack\n"
        text = _agent_block(body)
        result = parse_text(text)
        assert len(result.agent_blocks) == 1
        block = result.agent_blocks[0]
        assert block.extras == {"tools": "gitlab, slack"}
        # Required fields still populated.
        assert block.id == "a"
        assert block.task == "t"

    def test_multiple_unknown_fields(self) -> None:
        """Every unknown key is captured independently."""
        body = (
            "id: a\n"
            "task: t\n"
            "tools: jira\n"
            "priority: high\n"
            "timeout: 30s\n"
        )
        text = _agent_block(body)
        result = parse_text(text)
        block = result.agent_blocks[0]
        assert block.extras == {
            "tools": "jira",
            "priority": "high",
            "timeout": "30s",
        }

    def test_value_with_spaces(self) -> None:
        """Values with internal whitespace round-trip verbatim."""
        body = (
            "id: agent-0\n"
            "task: analyse src/foo.py and src/bar.py\n"
        )
        text = _agent_block(body)
        result = parse_text(text)
        block = result.agent_blocks[0]
        assert block.task == "analyse src/foo.py and src/bar.py"

    def test_empty_value_on_header_line_with_continuation(self) -> None:
        """Field with no inline value takes its value from continuations.

        LLMs sometimes emit ``task:\\n  the task text`` — the
        value lives on the following line(s). The parser
        handles this by treating the empty initial value as
        "no leading newline separator" so the first
        continuation line becomes the value directly.
        """
        body = (
            "id: agent-0\n"
            "task:\n"
            "Do the thing.\n"
        )
        text = _agent_block(body)
        result = parse_text(text)
        block = result.agent_blocks[0]
        assert block.task == "Do the thing."


class TestAgentBlockValidation:
    """Missing required fields produce valid=False, not silent drops."""

    def test_missing_id_marks_invalid(self) -> None:
        """task without id → block emitted with valid=False."""
        body = "task: do the thing\n"
        text = _agent_block(body)
        result = parse_text(text)
        assert len(result.agent_blocks) == 1
        block = result.agent_blocks[0]
        assert block.valid is False
        assert block.id == ""
        assert block.task == "do the thing"

    def test_missing_task_marks_invalid(self) -> None:
        """id without task → block emitted with valid=False."""
        body = "id: agent-0\n"
        text = _agent_block(body)
        result = parse_text(text)
        assert len(result.agent_blocks) == 1
        block = result.agent_blocks[0]
        assert block.valid is False
        assert block.id == "agent-0"
        assert block.task == ""

    def test_empty_body_marks_invalid(self) -> None:
        """AGENT / AGEND with nothing between → invalid block emitted."""
        text = _agent_block("")
        result = parse_text(text)
        assert len(result.agent_blocks) == 1
        block = result.agent_blocks[0]
        assert block.valid is False
        assert block.id == ""
        assert block.task == ""

    def test_blank_values_count_as_missing(self) -> None:
        """``id:`` or ``task:`` with only whitespace → invalid."""
        body = "id:   \ntask:   \n"
        text = _agent_block(body)
        result = parse_text(text)
        block = result.agent_blocks[0]
        assert block.valid is False


class TestAgentBlockStreaming:
    """Streaming chunk accumulation for agent blocks."""

    def test_split_across_two_chunks(self) -> None:
        """An agent block split mid-body parses correctly."""
        parser = EditParser()
        full = _agent_block("id: a\ntask: do the thing\n")
        mid = len(full) // 2
        parser.feed(full[:mid])
        parser.feed(full[mid:])
        result = parser.finalize()
        assert len(result.agent_blocks) == 1
        assert result.agent_blocks[0].id == "a"

    def test_split_one_char_at_a_time(self) -> None:
        """Pathological per-char streaming still produces a valid block."""
        parser = EditParser()
        for ch in _agent_block("id: x\ntask: t\n"):
            parser.feed(ch)
        result = parser.finalize()
        assert len(result.agent_blocks) == 1
        assert result.agent_blocks[0].valid is True

    def test_split_mid_marker(self) -> None:
        """Chunk boundary inside the AGEND marker — still works."""
        parser = EditParser()
        full = _agent_block("id: a\ntask: t\n")
        agend_pos = full.index(AGEND)
        split = agend_pos + 3  # mid-marker
        parser.feed(full[:split])
        parser.feed(full[split:])
        result = parser.finalize()
        assert len(result.agent_blocks) == 1

    def test_incomplete_agent_block_surfaced(self) -> None:
        """Stream ending mid-agent-block produces an incomplete entry.

        Mirrors the edit-block incomplete-surfacing behaviour.
        The agent block has no AGEND when the stream ends, so
        whatever fields were parsed become an incomplete block
        with ``completed=False``.
        """
        parser = EditParser()
        # AGENT + partial body, no AGEND.
        parser.feed(f"{AGENT}\nid: agent-0\ntask: partial")
        result = parser.finalize()
        # No completed agent blocks.
        assert result.agent_blocks == []
        # Incomplete captures whatever we had.
        assert len(result.incomplete_agents) == 1
        block = result.incomplete_agents[0]
        assert block.completed is False
        assert block.id == "agent-0"
        assert "partial" in block.task

    def test_incomplete_agent_block_preserves_partial_fields(
        self,
    ) -> None:
        """Incomplete block carries the fields parsed so far."""
        parser = EditParser()
        parser.feed(f"{AGENT}\nid: agent-0\n")
        # Stream ends after id, before task.
        result = parser.finalize()
        assert len(result.incomplete_agents) == 1
        block = result.incomplete_agents[0]
        assert block.id == "agent-0"
        assert block.task == ""
        # Missing required task → flagged invalid.
        assert block.valid is False


class TestAgentBlockMixedWithEditBlocks:
    """Responses containing both block types parse independently."""

    def test_edit_then_agent(self) -> None:
        """Edit block followed by agent block — both produced."""
        text = (
            _block("foo.py", "old", "new")
            + _agent_block("id: a\ntask: t\n")
        )
        result = parse_text(text)
        assert len(result.blocks) == 1
        assert result.blocks[0].file_path == "foo.py"
        assert len(result.agent_blocks) == 1
        assert result.agent_blocks[0].id == "a"

    def test_agent_then_edit(self) -> None:
        """Agent block followed by edit block — both produced."""
        text = (
            _agent_block("id: a\ntask: t\n")
            + _block("foo.py", "old", "new")
        )
        result = parse_text(text)
        assert len(result.blocks) == 1
        assert len(result.agent_blocks) == 1

    def test_interleaved_with_prose(self) -> None:
        """Prose between blocks doesn't confuse the parser."""
        text = (
            "First I'll edit:\n\n"
            + _block("a.py", "old", "new")
            + "\nThen spawn some agents:\n\n"
            + _agent_block("id: agent-0\ntask: task1\n")
            + "\n"
            + _agent_block("id: agent-1\ntask: task2\n")
        )
        result = parse_text(text)
        assert len(result.blocks) == 1
        assert len(result.agent_blocks) == 2
        ids = [b.id for b in result.agent_blocks]
        assert ids == ["agent-0", "agent-1"]

    def test_multiple_agent_blocks(self) -> None:
        """Multiple agent blocks in one response all captured."""
        text = (
            _agent_block("id: agent-0\ntask: task0\n")
            + _agent_block("id: agent-1\ntask: task1\n")
            + _agent_block("id: agent-2\ntask: task2\n")
        )
        result = parse_text(text)
        assert len(result.agent_blocks) == 3
        assert [b.id for b in result.agent_blocks] == [
            "agent-0", "agent-1", "agent-2",
        ]


class TestAgentBlockEdgeCases:
    """Parser tolerance for malformed or unusual agent blocks."""

    def test_agent_block_with_pending_path_before(self) -> None:
        """A file-path-like line before AGENT is discarded.

        Agents don't take preceding paths. If the parser sees
        ``src/foo.py`` then ``🟧🟧🟧 AGENT``, the path was prose
        and should be ignored — not attached to the agent block.
        """
        text = (
            "src/foo.py\n"
            + _agent_block("id: a\ntask: t\n")
        )
        result = parse_text(text)
        assert len(result.agent_blocks) == 1
        # No edit blocks produced — the path was discarded.
        assert result.blocks == []

    def test_continuation_before_first_field_dropped(self) -> None:
        """Continuation line before any ``key:`` header is dropped.

        Defensive against malformed LLM output — a block body
        starting with a non-field line shouldn't crash the
        parser. The block will end up with no fields and be
        flagged invalid.
        """
        body = (
            "random text before any field\n"
            "id: a\n"
            "task: t\n"
        )
        text = _agent_block(body)
        result = parse_text(text)
        assert len(result.agent_blocks) == 1
        block = result.agent_blocks[0]
        # id and task still parsed.
        assert block.id == "a"
        assert block.task == "t"
        # Random text silently dropped — no crash, no extras
        # key for it.
        assert "random" not in block.task
        assert "random" not in " ".join(block.extras.values())

    def test_colon_in_value(self) -> None:
        """Values containing colons round-trip correctly.

        The field-start regex matches ``^\\w+:`` — a leading
        word then colon. Subsequent colons within the value
        stay as part of the value.
        """
        body = "id: a\ntask: Parse key:value pairs in config.\n"
        text = _agent_block(body)
        result = parse_text(text)
        block = result.agent_blocks[0]
        assert block.task == "Parse key:value pairs in config."

    def test_indented_continuation_line(self) -> None:
        """Indented lines after a field-start are continuations.

        The regex anchors on ``^\\w+:`` so leading whitespace
        prevents field-start recognition — the line is treated
        as a continuation. Preserves exact text including the
        leading whitespace.
        """
        body = (
            "id: a\n"
            "task: Do the work\n"
            "  with nested indentation\n"
        )
        text = _agent_block(body)
        result = parse_text(text)
        block = result.agent_blocks[0]
        assert "with nested indentation" in block.task

    def test_agent_marker_with_trailing_whitespace(self) -> None:
        """Trailing whitespace on the start marker is tolerated.

        Pragmatic — LLMs occasionally emit ``🟧🟧🟧 AGENT `` with
        a stray trailing space. The state machine strips lines
        before comparison.
        """
        # Start marker with trailing space.
        text = f"{AGENT} \nid: a\ntask: t\n{AGEND}\n"
        result = parse_text(text)
        assert len(result.agent_blocks) == 1
        assert result.agent_blocks[0].valid is True

    def test_agend_marker_with_trailing_whitespace(self) -> None:
        """Trailing whitespace on the end marker is tolerated."""
        text = f"{AGENT}\nid: a\ntask: t\n{AGEND}  \n"
        result = parse_text(text)
        assert len(result.agent_blocks) == 1
        assert result.agent_blocks[0].completed is True


class TestParseResultAgentFields:
    """ParseResult carries agent_blocks and incomplete_agents."""

    def test_empty_input_has_empty_agent_fields(self) -> None:
        """No agent blocks in input → empty lists, not None."""
        result = parse_text("")
        assert result.agent_blocks == []
        assert result.incomplete_agents == []

    def test_agent_fields_present_on_every_result(self) -> None:
        """Both fields always present, regardless of input shape."""
        result = parse_text("just prose")
        assert isinstance(result.agent_blocks, list)
        assert isinstance(result.incomplete_agents, list)

    def test_finalize_agent_blocks_is_copy(self) -> None:
        """finalize's agent_blocks list is a copy — no state leak."""
        parser = EditParser()
        parser.feed(_agent_block("id: a\ntask: t\n"))
        result = parser.finalize()
        result.agent_blocks.append(
            AgentBlock(id="fake", task="fake")
        )
        # Parser's internal list unaffected.
        assert len(parser._agent_blocks) == 1