"""Edit block parser and applicator.

Parses structured edit blocks from LLM responses, validates against file content,
and applies changes. Format:

    path/to/file.ext
    ««« EDIT
    [context + old lines]
    ═══════ REPL
    [context + new lines]
    »»» EDIT END
"""

import logging
import os
import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

logger = logging.getLogger(__name__)

# Markers
EDIT_START = "««« EDIT"
EDIT_SEPARATOR = "═══════ REPL"
EDIT_END = "»»» EDIT END"


class EditStatus(Enum):
    APPLIED = "applied"
    VALIDATED = "validated"
    FAILED = "failed"
    SKIPPED = "skipped"
    NOT_IN_CONTEXT = "not_in_context"
    ALREADY_APPLIED = "already_applied"


class ParseState(Enum):
    SCANNING = "scanning"
    EXPECT_EDIT = "expect_edit"
    READING_OLD = "reading_old"
    READING_NEW = "reading_new"


@dataclass
class EditBlock:
    """A parsed edit block."""
    file_path: str
    old_lines: list = field(default_factory=list)
    new_lines: list = field(default_factory=list)
    anchor_lines: list = field(default_factory=list)
    old_only: list = field(default_factory=list)
    new_only: list = field(default_factory=list)
    is_create: bool = False


@dataclass
class EditResult:
    """Result of applying an edit block."""
    file_path: str
    status: EditStatus
    message: str = ""
    old_text: str = ""
    new_text: str = ""
    preview: str = ""


def _is_file_path(line):
    """Detect if a line looks like a file path."""
    line = line.strip()
    if not line:
        return False
    if len(line) > 200:
        return False
    if line.startswith(("#", "//", "*", "-", ">", "```")):
        return False
    # Must contain path separator or be a simple filename
    if "/" in line or "\\" in line:
        return True
    # Simple filename with extension
    if re.match(r'^[\w\-\.]+\.\w+$', line):
        return True
    # Known extensionless filenames
    if line in ("Makefile", "Dockerfile", "Vagrantfile", "Gemfile",
                "Rakefile", "Procfile", "Brewfile", "Justfile"):
        return True
    return False


def parse_edit_blocks(text):
    """Parse edit blocks from LLM response text.

    Returns a list of EditBlock objects.
    """
    lines = text.split("\n")
    blocks = []
    state = ParseState.SCANNING
    current_path = None
    old_lines = []
    new_lines = []

    for line in lines:
        stripped = line.strip()

        if state == ParseState.SCANNING:
            if _is_file_path(stripped) and stripped != EDIT_START:
                current_path = stripped
                state = ParseState.EXPECT_EDIT

        elif state == ParseState.EXPECT_EDIT:
            if stripped == EDIT_START:
                old_lines = []
                new_lines = []
                state = ParseState.READING_OLD
            else:
                # Not an edit block, re-check if this is a file path
                if _is_file_path(stripped) and stripped != EDIT_START:
                    current_path = stripped
                else:
                    state = ParseState.SCANNING

        elif state == ParseState.READING_OLD:
            if stripped == EDIT_SEPARATOR or stripped.startswith("═══════"):
                state = ParseState.READING_NEW
            else:
                old_lines.append(line)

        elif state == ParseState.READING_NEW:
            if stripped == EDIT_END:
                block = _build_edit_block(current_path, old_lines, new_lines)
                blocks.append(block)
                state = ParseState.SCANNING
                current_path = None
            else:
                new_lines.append(line)

    return blocks


def _build_edit_block(file_path, old_lines, new_lines):
    """Build an EditBlock with computed anchor."""
    # Compute common prefix (anchor)
    anchor = []
    min_len = min(len(old_lines), len(new_lines))
    for i in range(min_len):
        if old_lines[i] == new_lines[i]:
            anchor.append(old_lines[i])
        else:
            break

    old_only = old_lines[len(anchor):]
    new_only = new_lines[len(anchor):]
    is_create = len(old_lines) == 0

    return EditBlock(
        file_path=file_path,
        old_lines=old_lines,
        new_lines=new_lines,
        anchor_lines=anchor,
        old_only=old_only,
        new_only=new_only,
        is_create=is_create,
    )


def _find_anchor(file_content, anchor_lines, old_only=None):
    """Find the anchor position in file content.

    Returns (line_index, match_count) or (-1, 0) if not found.
    """
    file_lines = file_content.split("\n")

    if not anchor_lines:
        # No anchor — search for the old_only lines directly
        if not old_only:
            return 0, 1  # Empty anchor + empty old = start of file (create/insert)
        search_lines = old_only
        matches = []
        for i in range(len(file_lines) - len(search_lines) + 1):
            candidate = "\n".join(file_lines[i:i + len(search_lines)])
            if candidate == "\n".join(search_lines):
                matches.append(i)
        if len(matches) == 1:
            return matches[0], 1
        elif len(matches) == 0:
            return -1, 0
        else:
            return matches[0], len(matches)

    anchor_text = "\n".join(anchor_lines)
    matches = []

    for i in range(len(file_lines) - len(anchor_lines) + 1):
        candidate = "\n".join(file_lines[i:i + len(anchor_lines)])
        if candidate == anchor_text:
            matches.append(i)

    if len(matches) == 1:
        return matches[0], 1
    elif len(matches) == 0:
        return -1, 0
    else:
        return matches[0], len(matches)


def _diagnose_failure(file_content, anchor_lines, old_only):
    """Provide diagnostics for a failed edit."""
    file_lines = file_content.split("\n")

    if anchor_lines:
        first_anchor = anchor_lines[0].strip()
        for i, line in enumerate(file_lines):
            if first_anchor and first_anchor in line.strip():
                # Check if it's a whitespace issue
                if line != anchor_lines[0]:
                    return f"Whitespace mismatch at line {i+1}: expected {repr(anchor_lines[0])}, found {repr(line)}"
                return f"Near match at line {i+1}, but subsequent lines differ"

    if old_only:
        first_old = old_only[0].strip()
        for i, line in enumerate(file_lines):
            if first_old and first_old in line.strip():
                return f"Old text partially found at line {i+1}"

    return "Anchor not found in file"


def _check_already_applied(block, file_content):
    """Check if an edit's new content is already present in the file.

    Returns True if the new_lines (anchor + new_only) can be found in
    the file, suggesting the edit was already applied in a prior request.
    """
    if not block.new_lines:
        return False

    # Search for the full new content (anchor + new_only) in the file
    new_text = "\n".join(block.new_lines)
    if not new_text.strip():
        return False

    file_lines = file_content.split("\n")
    search_lines = block.new_lines
    if len(search_lines) > len(file_lines):
        return False

    for i in range(len(file_lines) - len(search_lines) + 1):
        candidate = "\n".join(file_lines[i:i + len(search_lines)])
        if candidate == new_text:
            return True

    return False


def validate_edit(block, file_content):
    """Validate an edit block against file content.

    Returns (is_valid, error_message).
    """
    if block.is_create:
        return True, ""

    if file_content is None:
        return False, "File not found"

    # Find anchor
    anchor_idx, match_count = _find_anchor(file_content, block.anchor_lines, block.old_only)

    if match_count == 0:
        # Check if the edit was already applied (new content already present)
        if _check_already_applied(block, file_content):
            return False, "already_applied"
        diag = _diagnose_failure(file_content, block.anchor_lines, block.old_only)
        return False, f"Anchor not found: {diag}"

    if match_count > 1:
        return False, f"Ambiguous anchor: {match_count} matches found"

    # Verify old text at anchored position
    if block.old_only:
        file_lines = file_content.split("\n")
        old_start = anchor_idx + len(block.anchor_lines)
        old_end = old_start + len(block.old_only)

        if old_end > len(file_lines):
            return False, "Old text extends past end of file"

        file_old = "\n".join(file_lines[old_start:old_end])
        expected_old = "\n".join(block.old_only)

        if file_old != expected_old:
            return False, f"Old text mismatch at line {old_start + 1}"

    return True, ""


def apply_edit(block, file_content):
    """Apply an edit block to file content.

    Returns (new_content, EditResult).
    """
    if block.is_create:
        new_content = "\n".join(block.new_lines)
        return new_content, EditResult(
            file_path=block.file_path,
            status=EditStatus.APPLIED,
            message="File created",
            new_text=new_content,
        )

    if file_content is None:
        return None, EditResult(
            file_path=block.file_path,
            status=EditStatus.FAILED,
            message="File not found",
        )

    valid, error = validate_edit(block, file_content)
    if not valid:
        if error == "already_applied":
            return file_content, EditResult(
                file_path=block.file_path,
                status=EditStatus.ALREADY_APPLIED,
                message="Edit already applied",
            )
        return file_content, EditResult(
            file_path=block.file_path,
            status=EditStatus.FAILED,
            message=error,
        )

    file_lines = file_content.split("\n")
    anchor_idx, _ = _find_anchor(file_content, block.anchor_lines, block.old_only)

    # Replace old with new
    old_start = anchor_idx + len(block.anchor_lines)
    old_end = old_start + len(block.old_only)

    new_file_lines = (
        file_lines[:anchor_idx]
        + block.anchor_lines
        + block.new_only
        + file_lines[old_end:]
    )

    # Compute preview
    old_text = "\n".join(block.old_only) if block.old_only else ""
    new_text = "\n".join(block.new_only) if block.new_only else ""

    return "\n".join(new_file_lines), EditResult(
        file_path=block.file_path,
        status=EditStatus.APPLIED,
        message="Edit applied",
        old_text=old_text,
        new_text=new_text,
    )


def apply_edits_to_repo(blocks, repo_root, dry_run=False):
    """Apply edit blocks to files in a repository.

    Returns list of EditResult objects.
    """
    repo_path = Path(repo_root)
    results = []
    # Track modified content per file for sequential edits
    file_contents = {}

    for block in blocks:
        # Security: reject path traversal
        if ".." in block.file_path:
            results.append(EditResult(
                file_path=block.file_path,
                status=EditStatus.SKIPPED,
                message="Path traversal not allowed",
            ))
            continue

        file_path = repo_path / block.file_path

        # Check for binary files
        if file_path.exists() and not block.is_create:
            try:
                with open(file_path, "rb") as f:
                    chunk = f.read(8192)
                    if b"\x00" in chunk:
                        results.append(EditResult(
                            file_path=block.file_path,
                            status=EditStatus.SKIPPED,
                            message="Binary file",
                        ))
                        continue
            except OSError:
                pass

        # Get current content (may have been modified by previous edit)
        if block.file_path in file_contents:
            content = file_contents[block.file_path]
        elif block.is_create:
            content = None
        elif file_path.exists():
            try:
                content = file_path.read_text()
            except OSError as e:
                results.append(EditResult(
                    file_path=block.file_path,
                    status=EditStatus.FAILED,
                    message=f"Cannot read file: {e}",
                ))
                continue
        else:
            results.append(EditResult(
                file_path=block.file_path,
                status=EditStatus.FAILED,
                message="File not found",
            ))
            continue

        if dry_run:
            valid, error = validate_edit(block, content)
            if not valid and error == "already_applied":
                results.append(EditResult(
                    file_path=block.file_path,
                    status=EditStatus.ALREADY_APPLIED,
                    message="Edit already applied",
                ))
            else:
                results.append(EditResult(
                    file_path=block.file_path,
                    status=EditStatus.VALIDATED if valid else EditStatus.FAILED,
                    message=error if error else "Validation passed",
                ))
            if valid and content is not None:
                new_content, _ = apply_edit(block, content)
                file_contents[block.file_path] = new_content
            continue

        new_content, result = apply_edit(block, content)

        if result.status == EditStatus.APPLIED:
            try:
                file_path.parent.mkdir(parents=True, exist_ok=True)
                file_path.write_text(new_content)
                file_contents[block.file_path] = new_content
            except OSError as e:
                result = EditResult(
                    file_path=block.file_path,
                    status=EditStatus.FAILED,
                    message=f"Write failed: {e}",
                )
        results.append(result)

    return results


def detect_shell_commands(text):
    """Extract shell commands from assistant response.

    Detects commands in ```bash blocks, $ prefixed lines, > prefixed lines.
    """
    commands = []
    in_bash_block = False
    lines = text.split("\n")

    for line in lines:
        stripped = line.strip()

        if stripped.startswith("```bash") or stripped.startswith("```shell") or stripped.startswith("```sh"):
            in_bash_block = True
            continue
        elif stripped.startswith("```") and in_bash_block:
            in_bash_block = False
            continue

        if in_bash_block:
            if stripped and not stripped.startswith("#"):
                commands.append(stripped)
        elif stripped.startswith("$ "):
            cmd = stripped[2:].strip()
            if cmd:
                commands.append(cmd)
        elif stripped.startswith("> "):
            cmd = stripped[2:].strip()
            if cmd and not cmd.startswith(("Note", "Warning", "This", "The", "Make")):
                commands.append(cmd)

    return commands
