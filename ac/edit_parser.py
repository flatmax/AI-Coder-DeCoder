"""
Edit parser for the anchored edit block format (v3).

This module provides parsing and application of edit blocks using
a simplified format where anchors are computed from common line prefixes
between edit and replace sections.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional
import re


class EditStatus(Enum):
    """Status of an edit operation."""
    APPLIED = "applied"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class EditBlock:
    """Parsed edit block from LLM response."""
    file_path: str
    anchor: str           # Computed from common prefix, "" if empty
    old_lines: str        # "" if empty, never None
    new_lines: str        # "" if empty, never None
    raw_block: str        # Original text for error reporting
    line_number: int      # Line number in response where block started


@dataclass
class EditResult:
    """Result of applying an edit block."""
    file_path: str
    status: EditStatus
    reason: Optional[str]  # None if applied, error message if failed/skipped
    anchor_preview: str    # First line of anchor for UI display
    old_preview: str       # First line of old_lines for UI display
    new_preview: str       # First line of new_lines for UI display
    block: EditBlock       # Original block for reference
    estimated_line: Optional[int]  # Approximate line number in file where edit was targeted


@dataclass
class ApplyResult:
    """Result of applying multiple edit blocks."""
    results: list[EditResult]
    files_modified: list[str]      # Paths of files that were changed
    shell_suggestions: list[str]   # Detected shell command suggestions


class EditParser:
    """Parser for the anchored edit block format (v3)."""

    # V3 format markers
    EDIT_START = "««« EDIT"
    REPL_SEPARATOR = "═══════ REPL"
    EDIT_END = "»»» EDIT END"

    # V2 format markers (for backward compatibility)
    V2_ANCHOR_SEPARATOR = "───────"
    V2_CONTENT_SEPARATOR = "═══════"
    V2_EDIT_END = "»»»"

    def parse_response(self, response_text: str) -> list[EditBlock]:
        """
        Extract all edit blocks from LLM response.

        Handles:
        - Multiple blocks in one response
        - Blocks surrounded by markdown/explanation text
        - File paths with spaces (path is entire line before EDIT_START)
        - Both v3 and v2 formats (auto-detected per block)

        Skips malformed blocks (missing markers, unclosed blocks) and continues
        parsing. Never raises exceptions for parse errors.
        """
        # Detect format and parse accordingly
        fmt = self.detect_format(response_text)
        if fmt == "edit_v3":
            return self._parse_v3(response_text)
        elif fmt == "edit_v2":
            return self._parse_v2(response_text)
        return []

    def _parse_v3(self, response_text: str) -> list[EditBlock]:
        """Parse v3 format: EDIT ... ═══════ REPL ... »»» EDIT END"""
        blocks = []
        lines = response_text.split('\n')

        state = 'IDLE'
        potential_path = None
        current_block_start_line = 0
        edit_section_lines = []
        repl_section_lines = []

        for i, line in enumerate(lines):
            stripped = line.strip()

            if state == 'IDLE':
                if stripped:  # Non-empty line could be file path
                    potential_path = stripped
                    state = 'EXPECT_START'

            elif state == 'EXPECT_START':
                if stripped == self.EDIT_START:
                    if potential_path:  # Valid file path stored
                        state = 'EDIT_SECTION'
                        current_block_start_line = i + 1  # 1-indexed
                        edit_section_lines = []
                    else:
                        state = 'IDLE'  # No path, skip this block
                elif stripped:
                    potential_path = stripped  # Update potential path
                # Empty line: keep waiting

            elif state == 'EDIT_SECTION':
                if stripped == self.REPL_SEPARATOR:
                    state = 'REPL_SECTION'
                    repl_section_lines = []
                else:
                    edit_section_lines.append(line)  # Preserve original line

            elif state == 'REPL_SECTION':
                if stripped == self.EDIT_END:
                    # Complete block - compute anchor and emit
                    anchor_lines, old_lines, new_lines = self._compute_common_prefix(
                        edit_section_lines, repl_section_lines
                    )
                    blocks.append(EditBlock(
                        file_path=potential_path,
                        anchor='\n'.join(anchor_lines),
                        old_lines='\n'.join(old_lines),
                        new_lines='\n'.join(new_lines),
                        raw_block=self._extract_raw_block(lines, current_block_start_line, i),
                        line_number=current_block_start_line
                    ))
                    state = 'IDLE'
                    potential_path = None
                else:
                    repl_section_lines.append(line)

        # If we end in a non-IDLE state, the last block was malformed - discard it
        return blocks

    def _parse_v2(self, response_text: str) -> list[EditBlock]:
        """Parse v2 format for backward compatibility."""
        blocks = []
        lines = response_text.split('\n')

        state = 'IDLE'
        potential_path = None
        current_block_start_line = 0
        leading_anchor_lines = []
        old_lines_list = []
        new_lines_list = []
        trailing_anchor_lines = []

        for i, line in enumerate(lines):
            stripped = line.strip()

            if state == 'IDLE':
                if stripped:
                    potential_path = stripped
                    state = 'EXPECT_START'

            elif state == 'EXPECT_START':
                if stripped == self.EDIT_START:
                    if potential_path:
                        state = 'LEADING_ANCHOR'
                        current_block_start_line = i + 1
                        leading_anchor_lines = []
                    else:
                        state = 'IDLE'
                elif stripped:
                    potential_path = stripped

            elif state == 'LEADING_ANCHOR':
                if stripped == self.V2_ANCHOR_SEPARATOR:
                    state = 'OLD_LINES'
                    old_lines_list = []
                else:
                    leading_anchor_lines.append(line)

            elif state == 'OLD_LINES':
                if stripped == self.V2_CONTENT_SEPARATOR:
                    state = 'NEW_LINES'
                    new_lines_list = []
                else:
                    old_lines_list.append(line)

            elif state == 'NEW_LINES':
                if stripped == self.V2_ANCHOR_SEPARATOR:
                    state = 'TRAILING_ANCHOR'
                    trailing_anchor_lines = []
                else:
                    new_lines_list.append(line)

            elif state == 'TRAILING_ANCHOR':
                if stripped == self.V2_EDIT_END:
                    # Convert v2 format to v3 EditBlock structure
                    # V2 had separate leading/trailing anchors; we merge leading into anchor
                    # and ignore trailing (it was for validation, not needed with v3 model)
                    blocks.append(EditBlock(
                        file_path=potential_path,
                        anchor='\n'.join(leading_anchor_lines),
                        old_lines='\n'.join(old_lines_list),
                        new_lines='\n'.join(new_lines_list),
                        raw_block=self._extract_raw_block(lines, current_block_start_line, i),
                        line_number=current_block_start_line
                    ))
                    state = 'IDLE'
                    potential_path = None
                else:
                    trailing_anchor_lines.append(line)

        return blocks

    def _compute_common_prefix(
        self,
        edit_lines: list[str],
        repl_lines: list[str]
    ) -> tuple[list[str], list[str], list[str]]:
        """
        Compute common prefix (anchor) between edit and repl sections.

        Returns:
            (anchor_lines, old_lines, new_lines)
        """
        anchor_lines = []
        i = 0

        # Find matching lines from the start
        while i < len(edit_lines) and i < len(repl_lines):
            if edit_lines[i] == repl_lines[i]:
                anchor_lines.append(edit_lines[i])
                i += 1
            else:
                break

        # Remainder is old/new
        old_lines = edit_lines[i:]
        new_lines = repl_lines[i:]

        return anchor_lines, old_lines, new_lines

    def _extract_raw_block(self, lines: list[str], start: int, end: int) -> str:
        """Extract raw block text for error reporting."""
        # start is 1-indexed, end is 0-indexed current position
        return '\n'.join(lines[start-1:end+1])

    def validate_block(self, block: EditBlock, file_content: str) -> tuple[Optional[str], Optional[int]]:
        """
        Validate block against file content.

        The anchor and old lines must appear contiguously in the file.

        Returns:
            (error_message, estimated_line) - error_message is None if valid,
            estimated_line is approximate location in file (for error reporting)
        """
        content = self._normalize(file_content)
        anchor = self._normalize(block.anchor)
        old = self._normalize(block.old_lines)

        # Handle new file creation: both anchor and old empty
        is_new_file = not anchor and not old
        if is_new_file:
            return (None, None)

        # Build expected sequence that must exist contiguously in file
        expected_parts = []
        if anchor:
            expected_parts.append(anchor)
        if old:
            expected_parts.append(old)

        if not expected_parts:
            return (None, None)

        expected_sequence = '\n'.join(expected_parts)

        # Find the sequence in file
        pos = content.find(expected_sequence)

        if pos == -1:
            # Provide detailed error message about which part failed
            return self._diagnose_match_failure(content, anchor, old)

        # Check for multiple matches (ambiguous edit location)
        second_pos = content.find(expected_sequence, pos + 1)
        if second_pos != -1:
            line1 = self._find_line_number(content, pos)
            line2 = self._find_line_number(content, second_pos)
            return (f"Edit location is ambiguous (matches at lines {line1} and {line2})", line1)

        return (None, self._find_line_number(content, pos))

    def _diagnose_match_failure(
        self,
        content: str,
        anchor: str,
        old: str
    ) -> tuple[str, Optional[int]]:
        """
        Diagnose why the expected sequence wasn't found.

        Returns detailed error message and estimated line number.
        """
        # Try to find anchor first
        if anchor:
            anchor_pos = content.find(anchor)
            if anchor_pos == -1:
                # Try to find first line of anchor for hint
                first_line = anchor.split('\n')[0]
                hint_pos = content.find(first_line) if first_line else -1
                hint_line = self._find_line_number(content, hint_pos) if hint_pos != -1 else None
                return ("Anchor not found in file", hint_line)

            # Anchor found - check what follows
            after_anchor = content[anchor_pos + len(anchor):]
            line_after = self._find_line_number(content, anchor_pos + len(anchor))

            if old:
                expected_old = '\n' + old
                if not after_anchor.startswith(expected_old):
                    return ("Old lines don't match content after anchor", line_after)

        elif old:
            # No anchor - find old lines directly
            old_pos = content.find(old)
            if old_pos == -1:
                return ("Old lines not found in file", None)

        return ("Content sequence not found in file", None)

    def apply_block(self, block: EditBlock, file_content: str) -> tuple[str, EditResult]:
        """
        Apply single block to content.

        Returns:
            (new_content, result) - new_content is unchanged if result.status != APPLIED
        """
        error, estimated_line = self.validate_block(block, file_content)

        def make_result(status: EditStatus, reason: Optional[str] = None) -> EditResult:
            return EditResult(
                file_path=block.file_path,
                status=status,
                reason=reason,
                anchor_preview=(block.anchor.split('\n')[0][:50]
                              if block.anchor else ""),
                old_preview=(block.old_lines.split('\n')[0][:50]
                            if block.old_lines else ""),
                new_preview=(block.new_lines.split('\n')[0][:50]
                            if block.new_lines else ""),
                block=block,
                estimated_line=estimated_line
            )

        if error:
            return file_content, make_result(EditStatus.FAILED, error)

        # Normalize
        content = self._normalize(file_content)
        anchor = self._normalize(block.anchor)
        old = self._normalize(block.old_lines)
        new = self._normalize(block.new_lines)

        # Build old and new sequences
        old_parts = []
        new_parts = []

        if anchor:
            old_parts.append(anchor)
            new_parts.append(anchor)
        if old:
            old_parts.append(old)
        if new:
            new_parts.append(new)

        old_sequence = '\n'.join(old_parts) if old_parts else ''
        new_sequence = '\n'.join(new_parts) if new_parts else ''

        if old_sequence:
            new_content = content.replace(old_sequence, new_sequence, 1)
        else:
            # New file creation
            new_content = new

        new_content = self._ensure_trailing_newline(new_content)

        return new_content, make_result(EditStatus.APPLIED)

    def apply_edits(
        self,
        blocks: list[EditBlock],
        repo,
        dry_run: bool = False,
        auto_stage: bool = True
    ) -> ApplyResult:
        """
        Apply all blocks to files.

        Args:
            blocks: Edit blocks to apply
            repo: Repository object for file access
            dry_run: If True, validate but don't write to disk
            auto_stage: If True, git add modified files after writing

        Returns:
            ApplyResult with per-block results and summary
        """
        results: list[EditResult] = []
        files_modified: list[str] = []
        failed_files: set[str] = set()

        # Track file contents for sequential edits
        file_contents: dict[str, str] = {}

        for block in blocks:
            file_path = block.file_path

            # Skip if previous edit to this file failed
            if file_path in failed_files:
                results.append(EditResult(
                    file_path=file_path,
                    status=EditStatus.SKIPPED,
                    reason="Previous edit to this file failed",
                    anchor_preview=(block.anchor.split('\n')[0][:50]
                                  if block.anchor else ""),
                    old_preview=(block.old_lines.split('\n')[0][:50]
                                if block.old_lines else ""),
                    new_preview=(block.new_lines.split('\n')[0][:50]
                                if block.new_lines else ""),
                    block=block,
                    estimated_line=None
                ))
                continue

            # Check for binary file
            if repo and repo.is_binary_file(file_path):
                results.append(EditResult(
                    file_path=file_path,
                    status=EditStatus.FAILED,
                    reason="Cannot edit binary file",
                    anchor_preview="",
                    old_preview="",
                    new_preview="",
                    block=block,
                    estimated_line=None
                ))
                failed_files.add(file_path)
                continue

            # Get current content (from cache or disk)
            if file_path in file_contents:
                content = file_contents[file_path]
            else:
                is_new_file = not block.anchor and not block.old_lines
                if is_new_file:
                    content = ""
                else:
                    try:
                        if repo:
                            content = repo.get_file_content(file_path)
                            # Handle error dict from repo
                            if isinstance(content, dict) and 'error' in content:
                                raise FileNotFoundError(content['error'])
                        else:
                            raise FileNotFoundError(f"No repo provided and file not cached: {file_path}")
                    except FileNotFoundError:
                        # Only fail if this isn't a new file creation
                        is_new_file = not block.anchor and not block.old_lines
                        if is_new_file:
                            content = ""
                            file_contents[file_path] = content
                        else:
                            results.append(EditResult(
                                file_path=file_path,
                                status=EditStatus.FAILED,
                                reason=f"File not found: {file_path}",
                                anchor_preview=(block.anchor.split('\n')[0][:50]
                                              if block.anchor else ""),
                                old_preview="",
                                new_preview="",
                                block=block,
                                estimated_line=None
                            ))
                            failed_files.add(file_path)
                            continue

            # Apply the edit
            new_content, result = self.apply_block(block, content)
            results.append(result)

            if result.status == EditStatus.APPLIED:
                file_contents[file_path] = new_content
                if file_path not in files_modified:
                    files_modified.append(file_path)
            else:
                failed_files.add(file_path)

        # Write files if not dry run
        if not dry_run and repo:
            for file_path in files_modified:
                content = file_contents[file_path]
                repo.write_file(file_path, content)

            if auto_stage and files_modified:
                repo.stage_files(files_modified)

        return ApplyResult(
            results=results,
            files_modified=files_modified,
            shell_suggestions=[]  # Populated by caller from response text
        )

    def detect_shell_suggestions(self, response_text: str) -> list[str]:
        """Extract shell command suggestions from response."""
        patterns = [
            r'`(git rm [^`]+)`',
            r'`(git mv [^`]+)`',
            r'`(mkdir -p [^`]+)`',
            r'`(rm -rf [^`]+)`',
        ]
        suggestions = []
        for pattern in patterns:
            suggestions.extend(re.findall(pattern, response_text))
        return suggestions

    def detect_format(self, response_text: str) -> str:
        """
        Detect which edit format the response uses.

        Returns:
            'edit_v3' for new format with ═══════ REPL,
            'edit_v2' for format with ───────,
            'search_replace' for old format,
            'none' if no edits
        """
        if self.EDIT_START in response_text:
            # Check for v3 vs v2
            if self.REPL_SEPARATOR in response_text:
                return "edit_v3"
            elif self.V2_ANCHOR_SEPARATOR in response_text:
                return "edit_v2"
            # Has EDIT_START but unclear format - assume v3
            return "edit_v3"
        elif "<<<<<<< SEARCH" in response_text:
            return "search_replace"
        return "none"

    def _normalize(self, text: str) -> str:
        """Normalize line endings only. Preserves all other whitespace."""
        return text.replace('\r\n', '\n')

    def _ensure_trailing_newline(self, text: str) -> str:
        """Ensure text ends with exactly one newline."""
        text = text.rstrip('\n')
        return text + '\n' if text else ''

    def _find_line_number(self, content: str, position: int) -> int:
        """Convert character position to line number (1-indexed)."""
        return content[:position].count('\n') + 1
