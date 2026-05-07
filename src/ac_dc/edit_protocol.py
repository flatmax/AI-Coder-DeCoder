"""Edit protocol parser — stateless block extraction.

Parses the LLM's streaming response text for edit blocks and
returns structured results. Does NOT touch the filesystem or the
repo — validation (anchor matching) and application live in
:mod:`edit_pipeline`.

Governing specs:

- ``specs4/3-llm/edit-protocol.md`` — block structure, marker
  byte sequences, state machine, file-path detection, streaming
  considerations
- ``specs-reference/3-llm/edit-protocol.md`` — concrete regex
  rules for file path detection (Python-side, more permissive
  than the frontend parser)

## Block Shape

Each edit block comprises four literal marker-bearing lines
bracketing two content sections:

1. A line containing the file path (relative to repo root)
2. Start marker: ``🟧🟧🟧 EDIT``
3. Old text — exact copy from the file (the anchor)
4. Separator marker: ``🟨🟨🟨 REPL``
5. New text — the replacement content
6. End marker: ``🟩🟩🟩 END``

The orange → yellow → green colour progression makes malformed
blocks (missing separator, missing end) visible at review time.
The parser matches on the literal byte sequences; it does NOT
do fuzzy matching.

## Streaming Discipline

The parser is a stateful finite-state machine designed to
accumulate across chunks. Call :meth:`EditParser.feed` with each
streaming chunk; completed blocks emerge from :meth:`finalize`
after the stream ends. A block that's partially received when
the stream ends becomes an ``incomplete`` result rather than
silently failing — the streaming handler surfaces these as
"pending" edit cards in the UI.

## Design Decisions Pinned Here

- **Marker bytes are exact.** The Python parser never accepts
  ASCII substitutions like ``<<< EDIT`` or ``=== REPL``. The
  system prompt explicitly instructs the LLM to emit the emoji
  sequences; a malformed block is an LLM error, not a parser
  tolerance concern.
- **File path detection is Python-side authoritative.** The
  frontend has its own simpler heuristic (see
  specs-reference/3-llm/edit-protocol.md § Frontend vs backend
  detection divergence); the backend's is permissive enough to recognise
  ``Makefile``, ``Dockerfile``, ``.gitignore`` etc. without
  requiring extensions.
- **No anchor validation here.** This module returns parsed
  blocks with ``old_text`` and ``new_text`` strings; the
  pipeline module matches anchors against file content.
  Separating parse from apply keeps streaming chunk handling
  simple and lets tests exercise each concern in isolation.
- **Create blocks have empty old text.** A block whose EDIT
  section is empty is a file-creation directive. Parsing
  doesn't distinguish — the ``is_create`` flag is derived from
  ``not old_text`` at the edge between parser and pipeline.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Marker constants — exact byte sequences
# ---------------------------------------------------------------------------
#
# The markers are three emoji squares followed by a space and a
# three-letter keyword. The emoji are U+1F7E7 (orange), U+1F7E8
# (yellow), U+1F7E9 (green). These must match the system prompt's
# documentation exactly — a mismatch here means the LLM's emitted
# blocks are silently ignored.

_MARKER_EDIT = "🟧🟧🟧 EDIT"
_MARKER_REPL = "🟨🟨🟨 REPL"
_MARKER_END = "🟩🟩🟩 END"

# Agent-spawn block markers — reserved for the future
# parallel-agents feature (specs4/7-future/parallel-agents.md).
# Distinct end marker (``AGEND`` vs ``END``) so the parser can
# dispatch on the literal line without tracking which start
# marker opened the current block — see the rationale in
# specs-reference/3-llm/edit-protocol.md § Agent-spawn marker
# sequences. Agent blocks have no middle separator — the body
# is a YAML-ish payload of ``key: value`` pairs directly
# between the start and end markers.
_MARKER_AGENT = "🟧🟧🟧 AGENT"
_MARKER_AGEND = "🟩🟩🟩 AGEND"

# Matches ``key: value`` on a line — the field-start pattern
# inside an agent block. A line that doesn't match this
# pattern is a continuation of the previous field's value
# (supports multi-line ``task``). The ``\w`` class excludes
# leading whitespace so indented continuation lines don't
# accidentally match as new fields.
_AGENT_FIELD_REGEX = re.compile(r"^(\w+):\s*(.*)$")

# Known agent-block field names. A ``word:`` line inside an
# agent block is treated as a field-start ONLY when the word
# appears here; otherwise the line is a continuation of the
# current field's value.
#
# Why an allowlist rather than accepting every ``word:``
# match: the ``task`` field typically contains multi-paragraph
# markdown prose, and markdown headings like ``Requirements:``
# or ``Notes:`` match the field-start pattern. Without this
# filter, the parser would silently terminate ``task`` at the
# first such heading and route everything after it into an
# ``extras`` key — so the agent's user message ends up as just
# the first line of its task. This was a real bug: a task body
# starting with "Build the thing." followed by a blank line
# and then "Requirements:\n- do X\n- do Y" reached the agent
# as "Build the thing." with everything else lost.
#
# Extending this set when new structured fields are added
# (e.g., ``tools:`` for the future MCP integration per
# specs4/7-future/mcp-integration.md) is a one-line change
# here. Until then, ``id`` and ``task`` are the only
# structured fields the parser knows about; everything else
# is prose.
_AGENT_KNOWN_FIELDS: frozenset[str] = frozenset({"id", "task"})


# ---------------------------------------------------------------------------
# File path detection — Python-side authoritative heuristic
# ---------------------------------------------------------------------------
#
# Returns True if a line looks like a repo-relative file path. Used
# by the parser to decide whether the line immediately before
# 🟧🟧🟧 EDIT is an intentional path declaration or just prose that
# happens to precede the block.
#
# Rules (in order):
# 1. Must be non-empty, < 200 chars, no leading/trailing whitespace
#    once stripped.
# 2. Reject comment/prose prefixes.
# 3. Accept paths with separators.
# 4. Accept filenames with extensions.
# 5. Accept dotfiles.
# 6. Accept known extensionless filenames (Makefile, Dockerfile, …).

_COMMENT_PREFIXES = ("#", "//", "*", "-", ">", "```")

# Matches ``foo.ext``, ``.foo.ext`` (one leading dot OK), or
# dotted paths like ``file.py.bak``. No path separators required
# — those are handled by the separators branch.
_FILENAME_WITH_EXT = re.compile(r"^\.?[\w\-\.]+\.\w+$")

# Matches ``.gitignore``, ``.env``, ``.dockerignore`` — dotfile
# names without an extension. Single leading dot, then word
# characters / dashes / dots. The leading dot is mandatory;
# non-dotfile extensionless names are handled by the whitelist.
_DOTFILE_NO_EXT = re.compile(r"^\.\w[\w\-\.]*$")

# Extensionless filenames we recognise unconditionally. Covers the
# build-tooling conventions users expect to be able to edit.
_KNOWN_EXTENSIONLESS = frozenset({
    "Makefile", "Dockerfile", "Vagrantfile",
    "Gemfile", "Rakefile", "Procfile",
    "Brewfile", "Justfile",
})


def _is_file_path(line: str) -> bool:
    """Return True if ``line`` looks like a repo-relative file path.

    Authoritative Python-side heuristic. Matches the rules
    in specs-reference/3-llm/edit-protocol.md § Frontend vs
    backend detection divergence.
    """
    # Defensive input-sanitisation. Empty-after-strip lines never
    # count; very long lines (200+ chars) are almost certainly
    # prose.
    if not line or len(line) >= 200:
        return False
    stripped = line.strip()
    if not stripped or len(stripped) >= 200:
        return False
    # Comment / prose prefixes — reject outright.
    for prefix in _COMMENT_PREFIXES:
        if stripped.startswith(prefix):
            return False
    # Path with separators — the common case.
    if "/" in stripped or "\\" in stripped:
        # Sanity-check: no inner whitespace. A real path might
        # contain one (rare but valid) but the LLM almost never
        # emits such; a line with spaces is almost always prose.
        return " " not in stripped
    # Filename with extension — ``foo.py``, ``.env.local``, etc.
    if _FILENAME_WITH_EXT.match(stripped):
        return True
    # Dotfile without extension — ``.gitignore``, ``.env``.
    if _DOTFILE_NO_EXT.match(stripped):
        return True
    # Known extensionless filenames.
    if stripped in _KNOWN_EXTENSIONLESS:
        return True
    return False


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


class EditStatus(str, Enum):
    """Status values for applied edit blocks.

    Subclasses :class:`str` so RPC serialisation works without
    unwrapping. The enum is the authoritative set; new statuses
    require an explicit frontend update.
    """

    APPLIED = "applied"
    ALREADY_APPLIED = "already_applied"
    FAILED = "failed"
    SKIPPED = "skipped"
    VALIDATED = "validated"
    NOT_IN_CONTEXT = "not_in_context"


class EditErrorType(str, Enum):
    """Machine-readable error classification for failed edits.

    Paired with :class:`EditStatus` on the result. A successful
    edit has ``error_type = ""`` (empty string, not a real enum
    member — keeps the JSON shape simple).
    """

    ANCHOR_NOT_FOUND = "anchor_not_found"
    AMBIGUOUS_ANCHOR = "ambiguous_anchor"
    FILE_NOT_FOUND = "file_not_found"
    WRITE_ERROR = "write_error"
    VALIDATION_ERROR = "validation_error"


@dataclass
class EditBlock:
    """A parsed edit block — pre-validation.

    Produced by :class:`EditParser`. The pipeline validates and
    applies these; here we only care about the textual structure.
    """

    file_path: str
    old_text: str
    new_text: str
    # Is this a create block (empty old text)?
    is_create: bool = False
    # Was the block completed normally (end marker seen)? Blocks
    # left unterminated when the stream ends have
    # ``completed=False`` and are surfaced as pending in the UI.
    completed: bool = True


@dataclass
class AgentBlock:
    """A parsed agent-spawn block.

    Reserved for the future parallel-agents feature (see
    ``specs4/7-future/parallel-agents.md``). The current
    single-agent implementation does NOT execute these blocks
    — the parser surfaces them so a future agent-spawning path
    can pick them up without a parser rewrite.

    Two required fields:

    - ``id`` — identifier the main LLM uses to reference this
      agent in subsequent review / synthesis. Scoped to the
      turn; unique within the turn's decomposition. Convention
      is ``agent-N`` (zero-indexed) but the parser accepts any
      non-empty string.
    - ``task`` — the initial prompt handed to the agent. May
      span multiple lines (continuation lines without a
      ``key:`` prefix are appended to the current field's
      value with a newline separator).

    ``extras`` carries forward-compatible unknown fields. Per
    ``specs4/7-future/mcp-integration.md``, a future MCP
    integration uses this slot for the optional ``tools:``
    field without requiring a parser change. The current
    implementation doesn't interpret these — it just captures
    them.

    ``valid`` flags whether the block had both required fields
    on emission. Missing required fields don't silently drop
    the block — callers can surface the malformed output to
    the user / LLM as feedback.

    ``completed`` mirrors :class:`EditBlock.completed` —
    ``False`` when the stream ended mid-block (no closing
    ``🟩🟩🟩 AGEND`` seen).
    """

    id: str = ""
    task: str = ""
    extras: dict[str, str] = field(default_factory=dict)
    valid: bool = True
    completed: bool = True


@dataclass
class EditResult:
    """Outcome of applying one edit block.

    Mirrors the shape the frontend expects in the
    ``edit_results`` array of the streamComplete event.
    """

    file_path: str
    status: EditStatus
    message: str = ""
    error_type: str = ""  # "" on success, enum value string on failure
    # Optional previews for the UI to render on failed / skipped
    # blocks. Populated by the pipeline when available.
    old_preview: str = ""
    new_preview: str = ""


@dataclass
class ParseResult:
    """The output of a complete parse pass.

    - ``blocks`` — complete edit blocks ready for apply.
    - ``incomplete`` — edit blocks where the stream ended before
      the end marker. The streaming handler renders these as
      "pending" cards so the user can see the partial LLM
      output.
    - ``shell_commands`` — detected shell command suggestions
      (extracted from fenced code blocks and ``$``/``>``
      prefixes). See :func:`detect_shell_commands`.
    - ``agent_blocks`` — parsed agent-spawn blocks. Reserved for
      the future parallel-agents feature. Callers that don't
      support agent spawning can ignore this field — the
      parser never raises on agent blocks, even when they
      carry malformed fields (those are flagged via
      ``AgentBlock.valid``).
    - ``incomplete_agents`` — agent blocks where the stream
      ended before the closing ``🟩🟩🟩 AGEND`` marker. Parallel
      to ``incomplete`` for edit blocks. Not currently surfaced
      to the frontend (the agent-browser UI doesn't render
      pending agents) but kept in the ParseResult so a future
      UI surface can pick them up.
    """

    blocks: list[EditBlock] = field(default_factory=list)
    incomplete: list[EditBlock] = field(default_factory=list)
    shell_commands: list[str] = field(default_factory=list)
    agent_blocks: list[AgentBlock] = field(default_factory=list)
    incomplete_agents: list[AgentBlock] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Parser — state machine
# ---------------------------------------------------------------------------


class _State:
    """Parser state constants."""

    SCANNING = "scanning"          # Looking for file path
    EXPECT_EDIT = "expect_edit"     # Path found, waiting for 🟧🟧🟧 EDIT
    READING_OLD = "reading_old"     # Inside old-text section
    READING_NEW = "reading_new"     # Inside new-text section
    # Inside an agent-spawn block's body, accumulating
    # ``key: value`` lines until 🟩🟩🟩 AGEND. No expect-start
    # state is needed — the AGENT marker triggers this
    # transition directly from SCANNING (or EXPECT_EDIT, if
    # the parser just saw a bogus path candidate).
    READING_AGENT = "reading_agent"


class EditParser:
    """Stateful parser that accumulates chunks across a stream.

    Construct once per streaming response. Call :meth:`feed` with
    each chunk (or the full text, if not streaming). Call
    :meth:`finalize` when the stream ends to get the final
    :class:`ParseResult`.

    The parser does NOT touch the filesystem. It only extracts
    structure; the pipeline module validates anchors and applies.
    """

    def __init__(self) -> None:
        self._state = _State.SCANNING
        # Accumulated unprocessed text. Lines are processed only
        # when a newline arrives so we never commit a partial
        # line's decision (e.g., deciding a line is a file path
        # before its full content has arrived).
        self._buffer = ""
        # The most recently seen candidate file-path line. Set
        # when SCANNING encounters a path-like line; consumed
        # when the next line is 🟧🟧🟧 EDIT. Cleared on blank line
        # or any other non-path content.
        self._pending_path: str | None = None
        # Accumulating state for the edit block currently being
        # built.
        self._current_path: str | None = None
        self._old_lines: list[str] = []
        self._new_lines: list[str] = []
        # Completed edit blocks.
        self._blocks: list[EditBlock] = []
        # Agent-block state. Reserved for the future
        # parallel-agents feature. The parser recognises and
        # accumulates these blocks; the current streaming
        # handler ignores ``ParseResult.agent_blocks`` entirely.
        #
        # ``_agent_fields`` holds the fields parsed so far —
        # keys map to their accumulated values. Multi-line
        # field values are joined with newlines as continuation
        # lines arrive.
        # ``_agent_current_field`` is the name of the field
        # that's currently receiving continuation lines (None
        # before the first ``key:`` line, or after a previous
        # field was terminated by encountering another ``key:``
        # line).
        self._agent_fields: dict[str, str] = {}
        self._agent_current_field: str | None = None
        self._agent_blocks: list[AgentBlock] = []

    def feed(self, chunk: str) -> None:
        """Consume a streaming chunk.

        The chunk may contain any number of complete lines plus a
        trailing partial line. The parser processes only complete
        lines; the tail is buffered for the next chunk.
        """
        self._buffer += chunk
        # Process line-by-line. Split on '\n' rather than
        # splitlines() so we preserve the trailing-partial-line
        # semantic — the split leaves the incomplete tail as the
        # final element, and we re-buffer it.
        parts = self._buffer.split("\n")
        # Every element except the last is a complete line.
        # The last element is the tail to re-buffer.
        self._buffer = parts[-1]
        for line in parts[:-1]:
            self._process_line(line)

    def finalize(self) -> ParseResult:
        """Flush the buffer and return the final ParseResult.

        Any partially-received block at the end of the stream
        becomes an ``incomplete`` entry rather than being
        silently dropped. Callers (the streaming handler) render
        these as "pending" edit cards. Agent blocks get the same
        treatment via ``incomplete_agents`` — not currently
        surfaced to the UI but preserved for future agent-
        spawning code.
        """
        # Flush any buffered partial line by treating it as a
        # final line. This is safe — the state machine handles
        # unterminated lines identically to terminated ones from
        # its perspective (it only reacts to marker matches).
        if self._buffer:
            self._process_line(self._buffer)
            self._buffer = ""

        incomplete: list[EditBlock] = []
        incomplete_agents: list[AgentBlock] = []
        if self._state in (_State.READING_OLD, _State.READING_NEW):
            # Edit block was mid-stream when input ended.
            # Surface as incomplete so the UI can show a pending
            # card.
            if self._current_path is not None:
                old_text = "\n".join(self._old_lines)
                new_text = "\n".join(self._new_lines)
                incomplete.append(EditBlock(
                    file_path=self._current_path,
                    old_text=old_text,
                    new_text=new_text,
                    is_create=not old_text.strip(),
                    completed=False,
                ))
        elif self._state == _State.READING_AGENT:
            # Agent block was mid-stream. Produce an incomplete
            # agent block using whatever fields we'd parsed.
            incomplete_agents.append(
                self._build_agent_block(completed=False)
            )

        return ParseResult(
            blocks=list(self._blocks),
            incomplete=incomplete,
            agent_blocks=list(self._agent_blocks),
            incomplete_agents=incomplete_agents,
        )

    # ------------------------------------------------------------------
    # Internal state machine
    # ------------------------------------------------------------------

    def _process_line(self, line: str) -> None:
        """Dispatch one complete line based on current state."""
        if self._state == _State.SCANNING:
            self._handle_scanning(line)
        elif self._state == _State.EXPECT_EDIT:
            self._handle_expect_edit(line)
        elif self._state == _State.READING_OLD:
            self._handle_reading_old(line)
        elif self._state == _State.READING_NEW:
            self._handle_reading_new(line)
        elif self._state == _State.READING_AGENT:
            self._handle_reading_agent(line)

    def _handle_scanning(self, line: str) -> None:
        """Scan for a file-path candidate or an agent-spawn start.

        The file-path path: a file path must be followed
        (possibly after blank lines) by a 🟧🟧🟧 EDIT marker. We
        record the candidate; the EXPECT_EDIT state resolves it.

        The agent-spawn path: a 🟧🟧🟧 AGENT marker on its own line
        enters READING_AGENT directly. No path precedes an agent
        block — the body is a YAML-ish payload of key:value
        pairs bracketed by the start and end markers.

        Any non-path, non-marker, non-blank line clears the
        pending candidate and stays in SCANNING.
        """
        stripped = line.strip()
        if stripped == _MARKER_AGENT:
            self._begin_agent_block()
            return
        if _is_file_path(line):
            self._pending_path = line.strip()
            self._state = _State.EXPECT_EDIT
            return
        # Non-path, non-marker line in SCANNING — ignore,
        # stay in SCANNING.

    def _handle_expect_edit(self, line: str) -> None:
        """After a candidate path, look for 🟧🟧🟧 EDIT.

        - 🟧🟧🟧 EDIT → consume the path, enter READING_OLD.
        - 🟧🟧🟧 AGENT → the pending path was prose; discard it
          and start an agent block. Agents don't have a
          preceding path, so seeing the AGENT marker here
          unambiguously terminates the path-candidate state.
        - Blank line → stay in EXPECT_EDIT; the LLM sometimes
          emits a blank between the path and the marker.
        - Another path-like line → the previous was prose;
          update candidate and stay.
        - Anything else → reset to SCANNING (the candidate was
          prose).
        """
        stripped = line.strip()
        if stripped == _MARKER_EDIT:
            self._current_path = self._pending_path
            self._pending_path = None
            self._old_lines = []
            self._new_lines = []
            self._state = _State.READING_OLD
            return
        if stripped == _MARKER_AGENT:
            # Pending path was prose that happened to precede
            # an agent block. Discard it and route to the
            # agent-body reader.
            self._pending_path = None
            self._begin_agent_block()
            return
        if not stripped:
            # Blank line between path and marker — tolerated.
            return
        if _is_file_path(line):
            # Previous path was prose; new candidate.
            self._pending_path = line.strip()
            return
        # Something else — reset.
        self._pending_path = None
        self._state = _State.SCANNING

    def _handle_reading_old(self, line: str) -> None:
        """Accumulate old-text lines until 🟨🟨🟨 REPL."""
        if line.strip() == _MARKER_REPL:
            self._state = _State.READING_NEW
            return
        self._old_lines.append(line)

    def _handle_reading_new(self, line: str) -> None:
        """Accumulate new-text lines until 🟩🟩🟩 END."""
        if line.strip() == _MARKER_END:
            # Emit the completed block.
            assert self._current_path is not None
            old_text = "\n".join(self._old_lines)
            new_text = "\n".join(self._new_lines)
            self._blocks.append(EditBlock(
                file_path=self._current_path,
                old_text=old_text,
                new_text=new_text,
                is_create=not old_text.strip(),
                completed=True,
            ))
            # Reset for the next block.
            self._current_path = None
            self._old_lines = []
            self._new_lines = []
            self._state = _State.SCANNING
            return
        self._new_lines.append(line)

    def _begin_agent_block(self) -> None:
        """Enter READING_AGENT with fresh accumulator state.

        Called from SCANNING or EXPECT_EDIT when a
        🟧🟧🟧 AGENT marker is recognised. Resets the per-block
        field dict and the current-field cursor. No path or
        other setup — agents have no header beyond the marker.
        """
        self._agent_fields = {}
        self._agent_current_field = None
        self._state = _State.READING_AGENT

    def _handle_reading_agent(self, line: str) -> None:
        """Accumulate agent-block fields until 🟩🟩🟩 AGEND.

        Two kinds of line:

        1. Field-start — matches ``^\\w+:\\s*(.*)$``. Starts a
           new field. The captured value portion becomes the
           field's initial content (possibly empty if the value
           is on subsequent continuation lines).
        2. Continuation — any other non-marker line. Appended
           to the current field's value with a leading newline
           separator. Required for multi-line ``task`` values.

        The 🟩🟩🟩 AGEND marker terminates the block; the
        accumulated fields become an AgentBlock.

        An agent block with no fields at all (end marker
        immediately after start marker) produces a block with
        ``valid=False`` and empty ``id``/``task`` — callers
        can surface this as malformed output from the LLM.
        """
        stripped = line.strip()
        if stripped == _MARKER_AGEND:
            self._agent_blocks.append(
                self._build_agent_block(completed=True)
            )
            self._agent_fields = {}
            self._agent_current_field = None
            self._state = _State.SCANNING
            return

        # Field-start detection. The regex matches leading
        # word-character sequences followed by a colon; lines
        # starting with whitespace or punctuation fall through
        # to continuation handling. We additionally gate on the
        # known-fields allowlist so markdown prose inside a
        # field's value (``Requirements:``, ``Notes:``, etc.)
        # doesn't terminate the current field — such lines are
        # treated as continuations and land in the accumulated
        # value verbatim. See ``_AGENT_KNOWN_FIELDS`` for the
        # full rationale.
        match = _AGENT_FIELD_REGEX.match(line)
        if (
            match is not None
            and match.group(1) in _AGENT_KNOWN_FIELDS
        ):
            field_name = match.group(1)
            field_value = match.group(2)
            self._agent_fields[field_name] = field_value
            self._agent_current_field = field_name
            return

        # Continuation line. If we have a current field, append
        # to it. Otherwise (continuation before any field
        # started — malformed body), silently drop the line
        # rather than raise; the block will be flagged invalid
        # at emission time because ``id`` and ``task`` will be
        # missing.
        if self._agent_current_field is not None:
            existing = self._agent_fields.get(
                self._agent_current_field, ""
            )
            if existing:
                self._agent_fields[
                    self._agent_current_field
                ] = existing + "\n" + line
            else:
                # Field started with empty value on its header
                # line; continuation becomes the value without a
                # leading newline separator.
                self._agent_fields[
                    self._agent_current_field
                ] = line

    def _build_agent_block(self, *, completed: bool) -> AgentBlock:
        """Materialise an :class:`AgentBlock` from current fields.

        Extracts ``id`` and ``task`` from the field dict,
        dropping them from the dict so the remainder lands in
        ``extras``. Missing required fields → ``valid=False``.
        Blank values for required fields also count as missing.

        ``completed`` mirrors the caller's state: True from the
        normal-termination path, False from the stream-ended-
        mid-block path in :meth:`finalize`.
        """
        fields = dict(self._agent_fields)
        agent_id = fields.pop("id", "").strip()
        task = fields.pop("task", "").strip()
        valid = bool(agent_id and task)
        # Strip extras values — multi-line extras get the same
        # whitespace treatment as ``task``.
        extras = {k: v.strip() for k, v in fields.items()}
        return AgentBlock(
            id=agent_id,
            task=task,
            extras=extras,
            valid=valid,
            completed=completed,
        )


# ---------------------------------------------------------------------------
# Convenience — non-streaming parse
# ---------------------------------------------------------------------------


def parse_text(text: str) -> ParseResult:
    """Parse a complete response string in one shot.

    Convenience wrapper for callers that don't need the
    streaming chunk API (tests, batch processing).
    """
    parser = EditParser()
    parser.feed(text)
    result = parser.finalize()
    # Also detect shell commands — non-streaming callers
    # typically want both.
    result.shell_commands = detect_shell_commands(text)
    return result


# ---------------------------------------------------------------------------
# Shell command detection
# ---------------------------------------------------------------------------


def detect_shell_commands(text: str) -> list[str]:
    """Extract shell command suggestions from assistant text.

    Three detection patterns:

    1. Fenced code blocks with ``bash``/``shell``/``sh``
       language tags. Lines starting with ``#`` inside those
       blocks are comments and skipped.
    2. Lines prefixed with ``$ `` (dollar-space) outside code
       blocks — the conventional "here's a shell command"
       prefix.
    3. Lines prefixed with ``> `` (greater-than-space) outside
       code blocks, EXCEPT when starting with common prose words
       like ``Note``, ``Warning``, ``This``, ``The``, ``Make``,
       which are block-quote-style prose rather than shell
       commands.

    Returns deduplicated commands in encounter order. Empty
    lines and whitespace-only lines are dropped.
    """
    commands: list[str] = []
    seen: set[str] = set()

    def _add(cmd: str) -> None:
        cmd = cmd.strip()
        if not cmd:
            return
        if cmd in seen:
            return
        seen.add(cmd)
        commands.append(cmd)

    # Fenced code blocks — multiline match.
    # Matches ```bash, ```sh, or ```shell followed by content up
    # to the closing fence. Lazy match so multiple fenced blocks
    # in one response are handled independently.
    fence_pattern = re.compile(
        r"```(?:bash|shell|sh)\s*\n(.*?)```",
        re.DOTALL | re.IGNORECASE,
    )
    for match in fence_pattern.finditer(text):
        body = match.group(1)
        for raw_line in body.split("\n"):
            line = raw_line.rstrip()
            if not line.strip():
                continue
            if line.lstrip().startswith("#"):
                continue
            _add(line)

    # Prose-word prefixes for the ``>`` filter.
    prose_prefixes = ("Note", "Warning", "This", "The", "Make")

    # Dollar and greater-than prefixes outside fenced blocks.
    # We strip out fenced blocks first so the ``> `` check
    # doesn't match inline citations inside them.
    fence_stripped = fence_pattern.sub("", text)
    for raw_line in fence_stripped.split("\n"):
        line = raw_line.rstrip()
        if line.startswith("$ "):
            _add(line[2:])
            continue
        if line.startswith("> "):
            remainder = line[2:]
            # Skip prose block-quotes.
            if any(
                remainder.startswith(p) for p in prose_prefixes
            ):
                continue
            _add(remainder)

    return commands