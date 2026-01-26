
# Edit Format V2: Symbol-Anchored Edit Blocks

## Overview

Replace the current SEARCH/REPLACE edit format with a new anchored format that:
1. Uses leading and trailing context anchors to verify location
2. Requires exact matching (no fuzzy matching)
3. Provides clear success/failure feedback per edit
4. Uses a single unified format for all operations (create, modify, delete)

[new lines - will be inserted]
───────
[trailing anchor - must match exactly, remains unchanged]
»»»
```

### Rules

1. **File path is mandatory** - Must appear on line immediately before `««« EDIT`
2. **Leading anchor** - Lines between `««« EDIT` and first `───────`
   - Must match file content exactly
   - Remains in file unchanged
   - Can be empty (for insert at file start)
3. **Old lines** - Lines between first `───────` and `═══════`
   - Must match file content exactly (immediately after leading anchor)
   - Will be removed
   - Can be empty (for pure insertion)
4. **New lines** - Lines between `═══════` and second `───────`
   - Will be inserted where old lines were
   - Can be empty (for pure deletion)
5. **Trailing anchor** - Lines between second `───────` and `»»»`
   - Must match file content exactly (immediately after old lines)
   - Remains in file unchanged
   - Can be empty (for changes at file end)
6. **Exact matching** - Only line ending normalization (CRLF → LF), everything else verbatim
7. **Binary files** - Edits to binary files are rejected
═══════
[new lines - will be inserted]
───────
[trailing anchor - must match exactly, remains unchanged]
»»»
```

### Rules

1. **File path is mandatory** - Must appear on line immediately before `««« EDIT`
2. **Leading anchor** - Lines between `««« EDIT` and first `───────`
   - Must match file content exactly
   - Remains in file unchanged
   - Can be empty (for insert at file start)
3. **Old lines** - Lines between first `───────` and `═══════`
   - Must match file content exactly (immediately after leading anchor)
   - Will be removed
   - Can be empty (for pure insertion)
4. **New lines** - Lines between `═══════` and second `───────`
   - Will be inserted where old lines were
   - Can be empty (for pure deletion)
5. **Trailing anchor** - Lines between second `───────` and `»»»`
   - Must match file content exactly (immediately after old lines)
   - Remains in file unchanged
   - Can be empty (for changes at file end)
6. **Exact matching** - Only line ending normalization (CRLF → LF), everything else verbatim
7. **Binary files** - Edits to binary files are rejected

    return a * b
───────

def other_function():
»»»
```

**Insert new code:**
```
src/utils.py
««« EDIT
def existing():
    pass
───────
═══════

def new_function():
    return 42
───────

def another():
»»»
```

**Delete code:**
```
src/utils.py
««« EDIT
def main():
───────
    deprecated_call()
═══════
───────
    important_call()
»»»
```

"""New module."""

def hello():
    print("Hello!")
───────
»»»
```
(Empty leading anchor, empty old lines, empty trailing anchor)
═══════
"""New module."""

def hello():
    print("Hello!")
───────
»»»
```
(Empty leading anchor, empty old lines, empty trailing anchor)

**Append to end of file:**
```
src/utils.py
««« EDIT
    return final_value
───────
═══════

def appended_function():
    pass
───────
»»»
```
(Empty trailing anchor)

**Insert at start of file:**
```
src/utils.py
««« EDIT
───────
═══════
"""Module docstring."""

───────
import os
»»»
```
(Empty leading anchor)

**Delete file:**
Suggest shell command: `git rm path/to/file.py`

## Implementation Plan

### Phase 1: Core Parser

**New file:** `ac/edit_parser.py`

```python
from dataclasses import dataclass
from enum import Enum
from typing import Optional
from pathlib import Path
import re

class EditStatus(Enum):
    APPLIED = "applied"
    FAILED = "failed"
    SKIPPED = "skipped"

@dataclass
class EditBlock:
    file_path: str
    leading_anchor: str
    old_lines: str
    new_lines: str
    trailing_anchor: str
    raw_block: str  # Original text for error reporting
    line_number: int  # Line number in response where block started

@dataclass  
class EditResult:
    file_path: str
    status: EditStatus
    reason: Optional[str]  # None if applied, error message if failed/skipped
    anchor_preview: str  # First line of leading anchor for UI display
    old_preview: str  # First line of old_lines for UI display
    new_preview: str  # First line of new_lines for UI display
    block: EditBlock  # Original block for reference
    estimated_line: Optional[int]  # Approximate line number in file where edit was targeted

@dataclass
class ApplyResult:
    results: list[EditResult]
    files_modified: list[str]  # Paths of files that were changed
    shell_suggestions: list[str]  # Detected shell command suggestions

class EditParser:
    """Parser for the anchored edit block format."""
    
    EDIT_START = "««« EDIT"
    ANCHOR_SEPARATOR = "───────"
    CONTENT_SEPARATOR = "═══════"
    EDIT_END = "»»»"
    
    def parse_response(self, response_text: str) -> list[EditBlock]:
        """
        Extract all edit blocks from LLM response.
        
        Handles:
        - Multiple blocks in one response
        - Blocks surrounded by markdown/explanation text
        - File paths with spaces (path is entire line before EDIT_START)
        
        Skips malformed blocks (missing markers, unclosed blocks) and continues
        parsing. Never raises exceptions for parse errors.
        """
        
    def validate_block(self, block: EditBlock, file_content: str) -> tuple[Optional[str], Optional[int]]:
        """
        Validate block against file content.
        
        Returns:
            (error_message, estimated_line) - error_message is None if valid,
            estimated_line is approximate location in file (for error reporting)
        """
        
    def apply_block(self, block: EditBlock, file_content: str) -> tuple[str, EditResult]:
        """
        Apply single block to content.
        
        Returns:
            (new_content, result) - new_content is unchanged if result.status != APPLIED
        """
        
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
        
    def is_binary_file(self, file_path: str, repo) -> bool:
        """Check if file is binary using git's detection or heuristics."""
        
    def detect_shell_suggestions(self, response_text: str) -> list[str]:
        """Extract shell command suggestions from response."""
```

### Phase 2: Integration

**Modify:** `ac/llm/llm.py`
- Add method to use new `EditParser`
- Replace calls to aider's edit applier

**Modify:** `ac/llm/streaming.py`
- Update `_stream_chat` to use new parser
- Return structured `EditResult` list

**Modify:** `ac/llm/chat.py`  
- Update `chat()` method to use new parser

### Phase 3: Prompt Update

**Update:** `ac/aider_integration/prompts/sys_prompt.md`
- Replace SEARCH/REPLACE instructions with new EDIT format
- Add examples for each operation type
- Emphasize exact matching requirement
- Document shell command suggestions for file operations

**Modify:** `ac/aider_integration/prompts/__init__.py`
- Load updated prompt format

### Phase 4: Frontend Updates

**Modify:** `webapp/src/prompt/CardMarkdown.js`
- Update block detection to recognize new format
- Parse edit blocks for inline status display
- Show success/failure indicators per block

**Modify:** `webapp/src/PromptView.js`
- Add optional slide-out panel for edit summary
- Handle click-to-diff-editor navigation
- Display edit results from response

**Modify:** `webapp/src/diff-viewer/DiffViewer.js`
- Add method to highlight specific line/region
- Support jumping to failed edit location

## Validation Logic

```python
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

def validate_block(self, block: EditBlock, file_content: str) -> tuple[Optional[str], Optional[int]]:
    """
    Validate edit block against file content.
    Returns (error_message, estimated_line) - error_message is None if valid.
    """
    content = self._normalize(file_content)
    leading = self._normalize(block.leading_anchor)
    old = self._normalize(block.old_lines)
    trailing = self._normalize(block.trailing_anchor)
    
    # Handle new file creation: all sections empty
    is_new_file = not leading and not old and not trailing
    if is_new_file:
        return (None, None)
    
    # Build expected sequence that must exist contiguously
    expected_sequence = leading + old + trailing
    
    if not expected_sequence:
        # Shouldn't happen given is_new_file check, but defensive
        return (None, None)
    
    # Find the sequence in file
    pos = content.find(expected_sequence)
    
    if pos == -1:
        # Determine which part failed for better error message
        if leading:
            anchor_pos = content.find(leading)
            if anchor_pos == -1:
                # Try to find partial match for line number hint
                first_anchor_line = leading.split('\n')[0] if leading else ''
                hint_pos = content.find(first_anchor_line) if first_anchor_line else -1
                hint_line = self._find_line_number(content, hint_pos) if hint_pos != -1 else None
                return (f"Leading anchor not found in file", hint_line)
            
            after_anchor = content[anchor_pos + len(leading):]
            line_after_anchor = self._find_line_number(content, anchor_pos + len(leading))
            
            if old and not after_anchor.startswith(old):
                return (f"Old lines don't match content after anchor", line_after_anchor)
            
            if old:
                after_old = after_anchor[len(old):]
                if trailing and not after_old.startswith(trailing):
                    line_after_old = self._find_line_number(content, anchor_pos + len(leading) + len(old))
                    return (f"Trailing anchor not found after old lines", line_after_old)
        else:
            # No leading anchor - search for old lines directly
            if old:
                old_pos = content.find(old)
                if old_pos == -1:
                    return (f"Old lines not found in file", None)
                line_at_old = self._find_line_number(content, old_pos)
                if trailing:
                    after_old = content[old_pos + len(old):]
                    if not after_old.startswith(trailing):
                        return (f"Trailing anchor not found after old lines", line_at_old)
        
        return (f"Content sequence not found in file", None)
    
    # Check for multiple matches (ambiguous)
    second_pos = content.find(expected_sequence, pos + 1)
    if second_pos != -1:
        line1 = self._find_line_number(content, pos)
        line2 = self._find_line_number(content, second_pos)
        return (f"Edit location is ambiguous (matches at lines {line1} and {line2})", line1)
    
    return (None, self._find_line_number(content, pos))


def apply_block(self, block: EditBlock, file_content: str) -> tuple[str, EditResult]:
    """Apply single block, return new content and result."""
    error, estimated_line = self.validate_block(block, file_content)
    
    def make_result(status: EditStatus, reason: Optional[str] = None) -> EditResult:
        return EditResult(
            file_path=block.file_path,
            status=status,
            reason=reason,
            anchor_preview=(block.leading_anchor.split('\n')[0][:50] 
                          if block.leading_anchor else ""),
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
    leading = self._normalize(block.leading_anchor)
    old = self._normalize(block.old_lines)
    new = self._normalize(block.new_lines)
    trailing = self._normalize(block.trailing_anchor)
    
    # Construct old and new sequences
    old_sequence = leading + old + trailing
    new_sequence = leading + new + trailing
    
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
    """Apply all blocks to files."""
    results: list[EditResult] = []
    files_modified: list[str] = []
    failed_files: set[str] = set()
    
    # Group blocks by file to handle sequential edits
    file_contents: dict[str, str] = {}
    
    for block in blocks:
        file_path = block.file_path
        
        # Skip if previous edit to this file failed
        if file_path in failed_files:
            results.append(EditResult(
                file_path=file_path,
                status=EditStatus.SKIPPED,
                reason="Previous edit to this file failed",
                anchor_preview=(block.leading_anchor.split('\n')[0][:50] 
                              if block.leading_anchor else ""),
                old_preview=(block.old_lines.split('\n')[0][:50] 
                            if block.old_lines else ""),
                new_preview=(block.new_lines.split('\n')[0][:50] 
                            if block.new_lines else ""),
                block=block,
                estimated_line=None
            ))
            continue
        
        # Check for binary file
        if self.is_binary_file(file_path, repo):
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
            is_new_file = (not block.leading_anchor and 
                         not block.old_lines and 
                         not block.trailing_anchor)
            if is_new_file:
                content = ""
            else:
                try:
                    content = repo.get_file_content(file_path)
                except FileNotFoundError:
                    results.append(EditResult(
                        file_path=file_path,
                        status=EditStatus.FAILED,
                        reason=f"File not found: {file_path}",
                        anchor_preview=(block.leading_anchor.split('\n')[0][:50] 
                                      if block.leading_anchor else ""),
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
    if not dry_run:
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
```

## Error Messages

| Error | Meaning | User Action |
|───────|───────--|───────------|
| `Leading anchor not found in file` | File changed or LLM hallucinated content | Refresh context, retry |
| `Edit location is ambiguous (matches at lines X and Y)` | Anchor appears multiple times | LLM needs more unique context lines |
| `Old lines don't match content after anchor` | Content between anchors changed | Refresh context, retry |
| `Trailing anchor not found after old lines` | File structure changed | Refresh context, retry |
| `File not found: {path}` | Path doesn't exist (and not a create operation) | Check path spelling |
| `Cannot edit binary file` | File detected as binary | Use shell commands instead |
| `Previous edit to this file failed` | Earlier edit block to same file failed | Fix the earlier edit first |

## Shell Command Detection

While we don't execute shell commands, we can detect and display suggestions:

```python
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
```

These can be displayed in the UI for the user to manually execute.

## Parser Edge Cases

The parser handles these edge cases gracefully:

| Case | Behavior |
|------|───────---|
| File path with spaces | Entire line before `««« EDIT` is treated as path (trimmed) |
| Empty or whitespace-only path | Block is skipped, parsing continues |
| Unclosed block (no `»»»`) | Block is skipped, parsing continues |
| Missing internal markers | Block is skipped, parsing continues |
| Markers not at line start | Not recognized as markers (content containing `───────` mid-line is safe) |
| Nested blocks | Outer block parsed; inner markers treated as content |
| Empty response | Returns empty list |
| No edit blocks in response | Returns empty list |
| Malformed UTF-8 | Attempt decode with `errors='replace'`, log warning |

## Shell Command Detection

While we don't execute shell commands, we can detect and display suggestions:

```python
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
```

These can be displayed in the UI for the user to manually execute.

## Migration Strategy

### The Atomic Switchover Problem

During transition, two components must change simultaneously:
1. **The parser (backend)** - switches from SEARCH/REPLACE to EDIT format
2. **The prompt (LLM instructions)** - tells LLM to use EDIT format

If these are out of sync:
- New parser + old prompt = LLM outputs SEARCH/REPLACE, parser expects EDIT → **all edits fail**
- Old parser + new prompt = LLM outputs EDIT, parser expects SEARCH/REPLACE → **all edits fail**

### Dual-Format Detection (Transition Period)

During the transition period, the new parser should detect both formats:

```python
def detect_format(self, response_text: str) -> str:
    """Detect which edit format the response uses."""
    if "««« EDIT" in response_text:
        return "edit_v2"
    elif "<<<<<<< SEARCH" in response_text:
        return "search_replace"
    return "none"

def parse_response(self, response_text: str) -> list[EditBlock]:
    """Parse response, handling both formats during transition."""
    format_type = self.detect_format(response_text)
    if format_type == "edit_v2":
        return self._parse_edit_v2(response_text)
    elif format_type == "search_replace":
        # Delegate to old parser or convert
        return self._parse_search_replace_legacy(response_text)
    return []
```

This allows:
- Testing new format while old prompt is still active
- Graceful handling if LLM occasionally reverts to old format
- Safe rollback by just reverting the prompt

### Files That Must Change Together

When switching to the new format, these files form an atomic unit:

| File | Change |
|------|--------|
| `ac/edit_parser.py` | New file - the v2 parser |
| `ac/aider_integration/prompts/sys_prompt.md` | Update instructions to EDIT format |
| `ac/aider_integration/prompts/__init__.py` | Update any format-specific constants |
| `ac/aider_integration/prompts/example_messages.py` | Update examples to use EDIT format |
| `ac/llm/chat.py` | Switch to new parser |
| `ac/llm/streaming.py` | Switch to new parser |

### Rollback Procedure

If issues arise after deployment:

1. **Quick rollback**: Revert `sys_prompt.md` to SEARCH/REPLACE instructions
   - Dual-format parser will handle old format
   - No code changes needed

2. **Full rollback**: `git revert` the entire changeset
   - Returns to aider edit applier
   - All files revert together

### Phased Migration Steps

**Phase 1: Core Parser (No User Impact)**
1. Create `ac/edit_parser.py` with new parser
2. Create `tests/test_edit_parser.py` with comprehensive unit tests
3. Implement dual-format detection
4. **Acceptance**: All unit tests pass, parser handles both formats

**Phase 2: Backend Integration (No User Impact)**
1. Add new parser alongside existing aider integration
2. Wire up new parser in `chat.py` and `streaming.py` behind feature detection
3. Create integration tests that mock LLM responses
4. **Acceptance**: Integration tests pass, existing functionality unchanged

**Phase 3: Prompt Update (User Impact - Requires LLM Testing)**
1. Update `sys_prompt.md` with new EDIT format instructions
2. Update `example_messages.py` with new format examples
3. **Manual testing required**: Run real prompts against LLM, verify edits apply
4. **Acceptance**: 10+ real edit operations succeed with new format

**Phase 4: Frontend Updates**
1. Update `CardMarkdown.js` to recognize new format markers
2. Update `PromptView.js` to display edit results
3. Update `DiffViewer.js` for line highlighting on errors
4. **Acceptance**: UI displays edit blocks correctly, shows success/failure status

**Phase 5: Cleanup (After Stability Period)**
1. Remove dual-format detection (after 1-2 weeks of stable operation)
2. Remove old aider edit applier code from `ac/aider_integration/edit_applier_mixin.py`
3. Remove legacy parser code path
4. Update documentation
5. **Acceptance**: Codebase clean, only new format supported

### Integration Testing Requirements

Unit tests cannot verify the prompt-to-LLM-to-parser loop. Required integration tests:

1. **Format compliance test**: Send coding request to LLM, verify response contains valid EDIT blocks
2. **Round-trip test**: Request edit → parse → apply → verify file content
3. **Multi-edit test**: Request requiring multiple edits to same file
4. **Error recovery test**: Verify graceful handling when LLM produces malformed blocks
5. **Regression test**: Verify complex edits that worked with old format still work

These tests should run against a real LLM (can use smaller/cheaper model for CI).

## Testing

**Unit tests for parser:**
- Parse single edit block
- Parse multiple edit blocks in one response
- Parse edit block with surrounding markdown/explanation text
- Parse file path with spaces
- Skip block with empty/whitespace path
- Skip unclosed block, continue parsing rest
- Skip block with missing internal markers
- Handle markers appearing mid-line in content (not recognized as markers)
- Validate exact matching
- Reject when anchor not found (with line number hint)
- Reject when multiple anchor matches (with both line numbers)
- Reject when old lines don't match (with line number)
- Reject binary files
- Apply modifications correctly
- Apply insertions correctly  
- Apply deletions correctly
- Create new files (all empty anchors)
- Handle sequential edits to same file
- Skip subsequent edits after failure in same file
- Dry run mode doesn't write files
- Auto-stage behavior
- Trailing newline normalization

**Integration tests:**
- Full flow: prompt → LLM → parse → apply → verify file
- Streaming with edit detection
- Multiple edits to same file in sequence (all succeed)
- Multiple edits to same file with middle one failing (rest skipped)
- Mix of successful and failed edits across different files
- UI displays results correctly with line numbers
- Shell suggestion detection and display
