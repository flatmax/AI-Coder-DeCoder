"""Edit block parser, validator, and applier."""

import logging
import os
import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ── Markers ──────────────────────────────────────────────────────

EDIT_START = "<<<<<<< SEARCH"
EDIT_SEPARATOR = "======= REPLACE"
EDIT_END = ">>>>>>> END"


# ── Data Models ──────────────────────────────────────────────────

class EditStatus(Enum):
    APPLIED = "applied"
    VALIDATED = "validated"
    FAILED = "failed"
    SKIPPED = "skipped"
    NOT_IN_CONTEXT = "not_in_context"
    ALREADY_APPLIED = "already_applied"


@dataclass
class EditBlock:
    """A parsed edit block from LLM output."""
    file_path: str
    old_lines: list[str] = field(default_factory=list)
    new_lines: list[str] = field(default_factory=list)
    is_create: bool = False


@dataclass
class EditResult:
    """Result of validating/applying a single edit block."""
    file_path: str
    status: str  # EditStatus value
    message: str = ""
    error_type: str = ""
    old_preview: str = ""
    new_preview: str = ""

    def to_dict(self) -> dict:
        d = {"file": self.file_path, "status": self.status, "message": self.message}
        if self.error_type:
            d["error_type"] = self.error_type
        return d


# ── Parser ────────────────────────────────────────────────────────

class _ParseState(Enum):
    SCANNING = "scanning"
    EXPECT_EDIT = "expect_edit"
    READING_OLD = "reading_old"
    READING_NEW = "reading_new"


def _is_file_path(line: str) -> bool:
    """Heuristic: is this line a file path?"""
    stripped = line.strip()
    if not stripped or len(stripped) > 200:
        return False
    if stripped.startswith(("#", "//", "*", "-", ">", "```")):
        return False
    # Must contain / or \ or be a simple file.ext
    if "/" in stripped or "\\" in stripped:
        return True
    if re.match(r'^[\w.-]+\.\w+$', stripped):
        return True
    return False


def parse_edit_blocks(text: str) -> list[EditBlock]:
    """Parse edit blocks from LLM response text.

    State machine approach matching EDIT_START/EDIT_SEPARATOR/EDIT_END markers.
    """
    blocks = []
    state = _ParseState.SCANNING
    current_path = ""
    old_lines: list[str] = []
    new_lines: list[str] = []

    for line in text.splitlines():
        stripped = line.strip()

        if state == _ParseState.SCANNING:
            if _is_file_path(stripped):
                current_path = stripped
                state = _ParseState.EXPECT_EDIT
            continue

        elif state == _ParseState.EXPECT_EDIT:
            if stripped == EDIT_START:
                old_lines = []
                new_lines = []
                state = _ParseState.READING_OLD
            elif _is_file_path(stripped):
                # Another path line — update
                current_path = stripped
            else:
                # Not an edit marker — go back to scanning
                state = _ParseState.SCANNING

        elif state == _ParseState.READING_OLD:
            if stripped == EDIT_SEPARATOR:
                state = _ParseState.READING_NEW
            else:
                old_lines.append(line)

        elif state == _ParseState.READING_NEW:
            if stripped == EDIT_END:
                is_create = len(old_lines) == 0
                blocks.append(EditBlock(
                    file_path=current_path,
                    old_lines=old_lines,
                    new_lines=new_lines,
                    is_create=is_create,
                ))
                state = _ParseState.SCANNING
                current_path = ""
            else:
                new_lines.append(line)

    return blocks


# ── Anchor Finding ────────────────────────────────────────────────

def _find_anchor(content_lines: list[str], old_lines: list[str]) -> tuple[Optional[int], str]:
    """Find the unique anchor position in file content.

    The anchor is the common prefix of old_lines and new_lines (computed
    by caller before passing old_lines as the full old section).

    Returns (start_index, error_message).
    - start_index is None on failure.
    """
    if not old_lines:
        return None, ""

    # Compute common prefix (anchor) from old_lines
    # The caller has already ensured old_lines is the full EDIT section.
    # We search for the entire old_lines block in content_lines.

    old_count = len(old_lines)
    matches = []

    for i in range(len(content_lines) - old_count + 1):
        match = True
        for j in range(old_count):
            if content_lines[i + j] != old_lines[j]:
                match = False
                break
        if match:
            matches.append(i)

    if len(matches) == 0:
        return None, _diagnose_not_found(content_lines, old_lines)
    elif len(matches) == 1:
        return matches[0], ""
    else:
        return None, f"Ambiguous anchor: found {len(matches)} matches"


def _diagnose_not_found(content_lines: list[str], old_lines: list[str]) -> str:
    """Provide diagnostic info for anchor not found."""
    if not old_lines:
        return "Empty anchor"

    first_old = old_lines[0]

    # Check for whitespace-only mismatch
    for i, cl in enumerate(content_lines):
        if cl.strip() == first_old.strip() and cl != first_old:
            return (
                f"Old text not found in file (whitespace mismatch near line {i + 1}: "
                f"expected {repr(first_old)}, found {repr(cl)})"
            )

    # Check for near matches
    for i, cl in enumerate(content_lines):
        if first_old.strip() and first_old.strip() in cl:
            return f"Old text not found in file (nearest match at line {i + 1}: {repr(cl[:80])})"

    return "Old text not found in file"


# ── Validator ─────────────────────────────────────────────────────

def validate_edit(
    block: EditBlock,
    content: str,
) -> EditResult:
    """Validate an edit block against file content.

    Returns an EditResult with validation status.
    """
    content_lines = content.splitlines()

    # Create block — always valid
    if block.is_create:
        return EditResult(
            file_path=block.file_path,
            status=EditStatus.VALIDATED.value,
        )

    # Find anchor
    start, error = _find_anchor(content_lines, block.old_lines)
    if start is None:
        # Determine error type
        if "Ambiguous" in error:
            error_type = "ambiguous_anchor"
        elif "whitespace" in error.lower():
            error_type = "anchor_not_found"
        else:
            error_type = "anchor_not_found"

        return EditResult(
            file_path=block.file_path,
            status=EditStatus.FAILED.value,
            message=error,
            error_type=error_type,
        )

    # Check if already applied (new content already present)
    new_count = len(block.new_lines)
    if new_count <= len(content_lines) - start:
        already = True
        for j in range(new_count):
            if start + j >= len(content_lines) or content_lines[start + j] != block.new_lines[j]:
                already = False
                break
        if already and block.old_lines != block.new_lines:
            return EditResult(
                file_path=block.file_path,
                status=EditStatus.ALREADY_APPLIED.value,
                message="New content already present in file",
            )

    return EditResult(
        file_path=block.file_path,
        status=EditStatus.VALIDATED.value,
    )


# ── Applier ───────────────────────────────────────────────────────

def apply_edit(
    block: EditBlock,
    content: str,
) -> tuple[str, EditResult]:
    """Apply an edit block to file content.

    Returns (new_content, EditResult).
    """
    content_lines = content.splitlines()

    # Create block
    if block.is_create:
        new_content = "\n".join(block.new_lines)
        if block.new_lines:
            new_content += "\n"
        return new_content, EditResult(
            file_path=block.file_path,
            status=EditStatus.APPLIED.value,
        )

    # Validate first
    result = validate_edit(block, content)
    if result.status == EditStatus.ALREADY_APPLIED.value:
        return content, result
    if result.status != EditStatus.VALIDATED.value:
        return content, result

    # Find anchor again
    start, _ = _find_anchor(content_lines, block.old_lines)
    if start is None:
        return content, EditResult(
            file_path=block.file_path,
            status=EditStatus.FAILED.value,
            message="Anchor not found on apply",
            error_type="anchor_not_found",
        )

    # Replace old lines with new lines
    old_count = len(block.old_lines)
    new_lines = content_lines[:start] + block.new_lines + content_lines[start + old_count:]
    new_content = "\n".join(new_lines)
    if content.endswith("\n"):
        new_content += "\n"

    return new_content, EditResult(
        file_path=block.file_path,
        status=EditStatus.APPLIED.value,
    )


def apply_edits_to_repo(
    blocks: list[EditBlock],
    repo_root: str | Path,
    dry_run: bool = False,
    in_context_files: Optional[set[str]] = None,
) -> list[EditResult]:
    """Apply edit blocks to repository files.

    Args:
        blocks: Parsed edit blocks.
        repo_root: Repository root path.
        dry_run: If True, validate without writing.
        in_context_files: Set of files currently in context.
                          If None, all files are considered in context.

    Returns list of EditResults.
    """
    repo = Path(repo_root).resolve()
    results = []
    modified_files: set[str] = set()

    for block in blocks:
        path = block.file_path

        # Path validation
        if ".." in path:
            results.append(EditResult(
                file_path=path,
                status=EditStatus.SKIPPED.value,
                message="Path traversal rejected",
                error_type="validation_error",
            ))
            continue

        abs_path = (repo / path).resolve()
        try:
            abs_path.relative_to(repo)
        except ValueError:
            results.append(EditResult(
                file_path=path,
                status=EditStatus.SKIPPED.value,
                message="Path escapes repository root",
                error_type="validation_error",
            ))
            continue

        # Not-in-context check (skip for creates)
        if not block.is_create and in_context_files is not None:
            if path not in in_context_files:
                results.append(EditResult(
                    file_path=path,
                    status=EditStatus.NOT_IN_CONTEXT.value,
                    message="File not in active context",
                    error_type="",
                ))
                continue

        # Create
        if block.is_create:
            if dry_run:
                results.append(EditResult(
                    file_path=path,
                    status=EditStatus.VALIDATED.value,
                ))
                continue

            abs_path.parent.mkdir(parents=True, exist_ok=True)
            new_content = "\n".join(block.new_lines)
            if block.new_lines:
                new_content += "\n"
            try:
                abs_path.write_text(new_content, encoding="utf-8")
                modified_files.add(path)
                results.append(EditResult(
                    file_path=path,
                    status=EditStatus.APPLIED.value,
                ))
            except OSError as e:
                results.append(EditResult(
                    file_path=path,
                    status=EditStatus.FAILED.value,
                    message=str(e),
                    error_type="write_error",
                ))
            continue

        # Modification
        if not abs_path.exists():
            results.append(EditResult(
                file_path=path,
                status=EditStatus.FAILED.value,
                message=f"File not found: {path}",
                error_type="file_not_found",
            ))
            continue

        # Binary check
        try:
            with open(abs_path, "rb") as f:
                chunk = f.read(8192)
            if b"\x00" in chunk:
                results.append(EditResult(
                    file_path=path,
                    status=EditStatus.SKIPPED.value,
                    message="Binary file",
                    error_type="validation_error",
                ))
                continue
        except OSError:
            pass

        try:
            content = abs_path.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            results.append(EditResult(
                file_path=path,
                status=EditStatus.FAILED.value,
                message=str(e),
                error_type="file_not_found",
            ))
            continue

        if dry_run:
            result = validate_edit(block, content)
            results.append(result)
        else:
            new_content, result = apply_edit(block, content)
            if result.status == EditStatus.APPLIED.value:
                try:
                    abs_path.write_text(new_content, encoding="utf-8")
                    modified_files.add(path)
                except OSError as e:
                    result = EditResult(
                        file_path=path,
                        status=EditStatus.FAILED.value,
                        message=str(e),
                        error_type="write_error",
                    )
            results.append(result)

    # Stage modified files
    if modified_files and not dry_run:
        _stage_files(repo, list(modified_files))

    return results


def _stage_files(repo_root: Path, paths: list[str]):
    """Stage modified files in git."""
    import subprocess
    try:
        subprocess.run(
            ["git", "-C", str(repo_root), "add", "--"] + paths,
            capture_output=True, check=False,
        )
    except Exception as e:
        logger.warning(f"Failed to stage files: {e}")


# ── Shell Command Detection ──────────────────────────────────────

def detect_shell_commands(text: str) -> list[str]:
    """Extract shell commands from assistant response.

    Detects commands in ```bash blocks, $ prefix, > prefix.
    Skips comments and non-command text.
    """
    commands = []

    # Fenced bash blocks
    in_bash_block = False
    for line in text.splitlines():
        stripped = line.strip()
        if re.match(r'^```(?:bash|sh|shell)\s*$', stripped):
            in_bash_block = True
            continue
        if stripped == "```" and in_bash_block:
            in_bash_block = False
            continue
        if in_bash_block:
            if stripped and not stripped.startswith("#"):
                commands.append(stripped)
            continue

        # $ prefix
        if stripped.startswith("$ "):
            cmd = stripped[2:].strip()
            if cmd:
                commands.append(cmd)
            continue

        # > prefix (but not >> or markdown quotes)
        if stripped.startswith("> ") and not stripped.startswith(">> "):
            cmd = stripped[2:].strip()
            if cmd and not cmd.startswith(">"):
                commands.append(cmd)

    return commands