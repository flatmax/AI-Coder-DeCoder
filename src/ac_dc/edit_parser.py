"""Edit block parser and applicator.

Parses structured edit blocks from LLM output and applies them to files.
Uses the edit protocol markers defined in the spec:
  <<<< EDIT / ==== REPLACE / >>>> EDIT END
"""

import logging
from dataclasses import dataclass, field
from enum import Enum, auto
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

# Primary markers from the spec (edit_protocol.md)
EDIT_START = "<<<< EDIT"
EDIT_SEPARATOR = "==== REPLACE"
EDIT_END = ">>>> EDIT END"


class EditStatus(Enum):
    APPLIED = auto()
    VALIDATED = auto()
    FAILED = auto()
    SKIPPED = auto()


@dataclass
class EditBlock:
    """A parsed edit block."""
    file_path: str
    old_lines: list[str] = field(default_factory=list)
    new_lines: list[str] = field(default_factory=list)
    anchor_lines: list[str] = field(default_factory=list)
    old_only: list[str] = field(default_factory=list)
    new_only: list[str] = field(default_factory=list)
    is_create: bool = False


@dataclass
class EditResult:
    """Result of applying a single edit block."""
    file_path: str
    status: EditStatus
    error: Optional[str] = None
    old_text: str = ""
    new_text: str = ""


class ParseState(Enum):
    SCANNING = auto()
    EXPECT_EDIT = auto()
    READING_OLD = auto()
    READING_NEW = auto()


def _is_marker(line: str, marker: str) -> bool:
    """Check if a line matches a marker (with tolerance for whitespace)."""
    return line.strip() == marker


def _looks_like_path(line: str) -> bool:
    """Heuristic: does this line look like a file path?"""
    stripped = line.strip()
    if not stripped or len(stripped) > 200:
        return False
    if stripped.startswith(("#", "//", "/*", "*", "-", ">", "```")):
        return False
    if "/" in stripped or "\\" in stripped:
        return True
    # Single filename with extension
    if "." in stripped and " " not in stripped:
        return True
    return False


def parse_edit_blocks(text: str) -> list[EditBlock]:
    """Extract edit blocks from free-form LLM text.

    Recognizes the spec markers:
        path/to/file.ext
        <<<< EDIT
        [old content]
        ==== REPLACE
        [new content]
        >>>> EDIT END
    """
    blocks: list[EditBlock] = []
    state = ParseState.SCANNING
    candidate_path = ""
    old_lines: list[str] = []
    new_lines: list[str] = []

    for line in text.splitlines():
        if state == ParseState.SCANNING:
            if _is_marker(line, EDIT_START):
                # Path should have been set by previous line
                if candidate_path:
                    state = ParseState.READING_OLD
                    old_lines = []
                    new_lines = []
                continue

            if _looks_like_path(line):
                candidate_path = line.strip()
            else:
                candidate_path = ""

        elif state == ParseState.EXPECT_EDIT:
            if _is_marker(line, EDIT_START):
                state = ParseState.READING_OLD
                old_lines = []
                new_lines = []
            else:
                state = ParseState.SCANNING
                candidate_path = ""

        elif state == ParseState.READING_OLD:
            if _is_marker(line, EDIT_SEPARATOR):
                state = ParseState.READING_NEW
            else:
                old_lines.append(line)

        elif state == ParseState.READING_NEW:
            if _is_marker(line, EDIT_END):
                block = _build_block(candidate_path, old_lines, new_lines)
                blocks.append(block)
                state = ParseState.SCANNING
                candidate_path = ""
            else:
                new_lines.append(line)

    return blocks


def _build_block(file_path: str, old_lines: list[str], new_lines: list[str]) -> EditBlock:
    """Compute anchor (common prefix) and build EditBlock."""
    block = EditBlock(file_path=file_path)
    block.old_lines = list(old_lines)
    block.new_lines = list(new_lines)

    # Compute common prefix
    anchor = []
    min_len = min(len(old_lines), len(new_lines))
    for i in range(min_len):
        if old_lines[i] == new_lines[i]:
            anchor.append(old_lines[i])
        else:
            break

    block.anchor_lines = anchor
    block.old_only = old_lines[len(anchor):]
    block.new_only = new_lines[len(anchor):]
    block.is_create = len(old_lines) == 0

    return block


def validate_edit(block: EditBlock, file_content: str) -> Optional[str]:
    """Validate an edit block against file content. Returns error or None."""
    if block.is_create:
        return None  # Creates are always valid here

    lines = file_content.splitlines()

    if not block.anchor_lines and not block.old_only:
        return None  # Empty old section = append/prepend

    # Find anchor in file
    search_lines = block.anchor_lines + block.old_only
    matches = _find_matches(lines, search_lines)

    if len(matches) == 0:
        # Try to diagnose
        diag = _diagnose_failure(lines, block)
        return f"Anchor not found in {block.file_path}. {diag}"
    elif len(matches) > 1:
        return f"Ambiguous match: anchor found at {len(matches)} locations in {block.file_path}"

    return None


def _find_matches(file_lines: list[str], search_lines: list[str]) -> list[int]:
    """Find all positions where search_lines appear contiguously in file_lines."""
    if not search_lines:
        return [0]

    matches = []
    for i in range(len(file_lines) - len(search_lines) + 1):
        if all(file_lines[i + j] == search_lines[j] for j in range(len(search_lines))):
            matches.append(i)
    return matches


def _diagnose_failure(file_lines: list[str], block: EditBlock) -> str:
    """Try to diagnose why an edit failed."""
    search = block.anchor_lines + block.old_only
    if not search:
        return "Empty search pattern."

    # Check for whitespace-only differences
    stripped_file = [l.strip() for l in file_lines]
    stripped_search = [l.strip() for l in search]
    stripped_matches = _find_matches(stripped_file, stripped_search)
    if stripped_matches:
        return f"Whitespace mismatch near line {stripped_matches[0] + 1}."

    # Check first line only
    first = search[0]
    for i, fl in enumerate(file_lines):
        if first.strip() == fl.strip():
            return f"Near match at line {i + 1} (whitespace or content difference)."

    return "Content not found in file."


def apply_edit(block: EditBlock, file_content: str) -> tuple[str, Optional[str]]:
    """Apply an edit block to file content. Returns (new_content, error_or_none)."""
    if block.is_create:
        return "\n".join(block.new_lines), None

    lines = file_content.splitlines()
    search_lines = block.anchor_lines + block.old_only

    if not search_lines:
        # Empty old = prepend
        new_content = "\n".join(block.new_only + lines)
        return new_content, None

    matches = _find_matches(lines, search_lines)
    if len(matches) == 0:
        diag = _diagnose_failure(lines, block)
        return file_content, f"Anchor not found. {diag}"
    if len(matches) > 1:
        return file_content, f"Ambiguous: {len(matches)} matches"

    pos = matches[0]
    # Replace: keep anchor, swap old_only with new_only
    before = lines[:pos]
    after = lines[pos + len(search_lines):]
    replacement = block.anchor_lines + block.new_only
    result = before + replacement + after

    return "\n".join(result), None


def apply_edits_to_repo(
    blocks: list[EditBlock],
    repo_root: Path,
    dry_run: bool = False,
) -> list[EditResult]:
    """Apply a list of edit blocks to files in a repository."""
    results = []

    for block in blocks:
        path = repo_root / block.file_path
        try:
            # Safety check
            resolved = path.resolve()
            if not str(resolved).startswith(str(repo_root.resolve())):
                results.append(EditResult(block.file_path, EditStatus.SKIPPED, "Path escapes repo"))
                continue

            if block.is_create:
                if dry_run:
                    results.append(EditResult(block.file_path, EditStatus.VALIDATED))
                else:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    content = "\n".join(block.new_lines)
                    path.write_text(content, encoding="utf-8")
                    results.append(EditResult(
                        block.file_path, EditStatus.APPLIED,
                        new_text=content,
                    ))
                continue

            if not path.exists():
                results.append(EditResult(block.file_path, EditStatus.FAILED, "File not found"))
                continue

            # Binary check
            with open(path, "rb") as f:
                if b"\x00" in f.read(8192):
                    results.append(EditResult(block.file_path, EditStatus.SKIPPED, "Binary file"))
                    continue

            content = path.read_text(encoding="utf-8", errors="replace")
            new_content, error = apply_edit(block, content)

            if error:
                results.append(EditResult(block.file_path, EditStatus.FAILED, error))
            elif dry_run:
                results.append(EditResult(
                    block.file_path, EditStatus.VALIDATED,
                    old_text=content, new_text=new_content,
                ))
            else:
                path.write_text(new_content, encoding="utf-8")
                results.append(EditResult(
                    block.file_path, EditStatus.APPLIED,
                    old_text=content, new_text=new_content,
                ))

        except Exception as e:
            results.append(EditResult(block.file_path, EditStatus.FAILED, str(e)))

    return results
