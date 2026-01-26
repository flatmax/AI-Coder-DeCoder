
# Edit Format V2: Symbol-Anchored Edit Blocks

## Overview

Replace the current SEARCH/REPLACE edit format with a new anchored format that:
1. Uses leading and trailing context anchors to verify location
2. Requires exact matching (no fuzzy matching)
3. Provides clear success/failure feedback per edit
4. Uses a single unified format for all operations (create, modify, delete)

## Format Specification

```
path/to/file.ext
<<<<<<< EDIT
[leading anchor - must match exactly, remains unchanged]
-------
[old lines - must match exactly, will be removed]
=======
[new lines - will be inserted]
-------
[trailing anchor - must match exactly, remains unchanged]
>>>>>>>
```

### Rules

1. **File path is mandatory** - Must appear on line immediately before `<<<<<<< EDIT`
2. **Leading anchor** - Lines between `<<<<<<< EDIT` and first `-------`
   - Must match file content exactly
   - Remains in file unchanged
   - Can be empty (for insert at file start)
3. **Old lines** - Lines between first `-------` and `=======`
   - Must match file content exactly (immediately after leading anchor)
   - Will be removed
   - Can be empty (for pure insertion)
4. **New lines** - Lines between `=======` and second `-------`
   - Will be inserted where old lines were
   - Can be empty (for pure deletion)
5. **Trailing anchor** - Lines between second `-------` and `>>>>>>>`
   - Must match file content exactly (immediately after old lines)
   - Remains in file unchanged
   - Can be empty (for changes at file end)
6. **Exact matching** - Only line ending normalization (CRLF → LF), everything else verbatim
7. **Binary files** - Edits to binary files are rejected

### Operations

**Modify existing code:**
```
src/utils.py
<<<<<<< EDIT
def calculate(a, b):
-------
    return a + b
=======
    return a * b
-------

def other_function():
>>>>>>>
```

**Insert new code:**
```
src/utils.py
<<<<<<< EDIT
def existing():
    pass
-------
=======

def new_function():
    return 42
-------

def another():
>>>>>>>
```

**Delete code:**
```
src/utils.py
<<<<<<< EDIT
def main():
-------
    deprecated_call()
=======
-------
    important_call()
>>>>>>>
```

**Create new file:**
```
src/new_file.py
<<<<<<< EDIT
-------
=======
"""New module."""

def hello():
    print("Hello!")
-------
>>>>>>>
```
(Empty leading anchor, empty old lines, empty trailing anchor)

**Append to end of file:**
```
src/utils.py
<<<<<<< EDIT
    return final_value
-------
=======

def appended_function():
    pass
-------
>>>>>>>
```
(Empty trailing anchor)

**Insert at start of file:**
```
src/utils.py
<<<<<<< EDIT
-------
=======
"""Module docstring."""

-------
import os
>>>>>>>
```
(Empty leading anchor)

**Delete file:**
Suggest shell command: `git rm path/to/file.py`

## Implementation Plan

### Phase 1: Core Parser

**New file:** `ac/edit_parser.py`

```python
from dataclasses import dataclass
from typing import Optional, Literal
import re

@dataclass
class EditBlock:
    file_path: str
    leading_anchor: str
    old_lines: str
    new_lines: str
    trailing_anchor: str
    raw_block: str  # Original text for error reporting

@dataclass  
class EditResult:
    file_path: str
    status: Literal["applied", "failed", "skipped"]
    reason: Optional[str]  # None if applied, error message if failed/skipped
    anchor_preview: str  # First line of leading anchor for UI display
    old_preview: str  # First line of old_lines for UI display
    new_preview: str  # First line of new_lines for UI display
    block: EditBlock  # Original block for reference

class EditParser:
    """Parser for the anchored edit block format."""
    
    EDIT_START = "<<<<<<< EDIT"
    ANCHOR_SEPARATOR = "-------"
    CONTENT_SEPARATOR = "======="
    EDIT_END = ">>>>>>>"
    
    def parse_response(self, response_text: str) -> list[EditBlock]:
        """Extract all edit blocks from LLM response."""
        
    def validate_block(self, block: EditBlock, file_content: str) -> Optional[str]:
        """Validate block against file. Returns error message or None."""
        
    def apply_block(self, block: EditBlock, file_content: str) -> tuple[str, EditResult]:
        """Apply single block, return new content and result."""
        
    def apply_edits(self, blocks: list[EditBlock], repo) -> list[EditResult]:
        """Apply all blocks to files, return results."""
        
    def is_binary_file(self, file_path: str, repo) -> bool:
        """Check if file is binary."""
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
def validate_block(self, block: EditBlock, file_content: str) -> Optional[str]:
    """
    Validate edit block against file content.
    Returns error message or None if valid.
    """
    # Normalize line endings only
    content = file_content.replace('\r\n', '\n')
    leading = block.leading_anchor.replace('\r\n', '\n')
    old = block.old_lines.replace('\r\n', '\n')
    trailing = block.trailing_anchor.replace('\r\n', '\n')
    
    # Handle new file creation
    if not leading and not old and not trailing:
        return None  # New file, no validation needed
    
    # Build expected sequence that must exist contiguously
    expected_sequence = leading + old + trailing
    
    # Find the sequence in file
    if expected_sequence:
        pos = content.find(expected_sequence)
        if pos == -1:
            # Determine which part failed
            if leading and content.find(leading) == -1:
                return f"Leading anchor not found"
            if leading:
                anchor_pos = content.find(leading)
                after_anchor = content[anchor_pos + len(leading):]
                if old and not after_anchor.startswith(old):
                    return f"Old lines don't match content after anchor"
                if old:
                    after_old = after_anchor[len(old):]
                    if trailing and not after_old.startswith(trailing):
                        return f"Trailing anchor not found after old lines"
            return f"Content sequence not found in file"
        
        # Check for multiple matches (ambiguous)
        if content.find(expected_sequence, pos + 1) != -1:
            return f"Edit location is ambiguous (multiple matches)"
    
    return None  # Valid


def apply_block(self, block: EditBlock, file_content: str) -> tuple[str, EditResult]:
    """Apply single block, return new content and result."""
    error = self.validate_block(block, file_content)
    
    if error:
        return file_content, EditResult(
            file_path=block.file_path,
            status="failed",
            reason=error,
            anchor_preview=block.leading_anchor.split('\n')[0][:50] if block.leading_anchor else "",
            old_preview=block.old_lines.split('\n')[0][:50] if block.old_lines else "",
            new_preview=block.new_lines.split('\n')[0][:50] if block.new_lines else "",
            block=block
        )
    
    # Normalize line endings
    content = file_content.replace('\r\n', '\n')
    leading = block.leading_anchor.replace('\r\n', '\n')
    old = block.old_lines.replace('\r\n', '\n')
    new = block.new_lines.replace('\r\n', '\n')
    trailing = block.trailing_anchor.replace('\r\n', '\n')
    
    # Find and replace
    old_sequence = leading + old + trailing
    new_sequence = leading + new + trailing
    
    if old_sequence:
        new_content = content.replace(old_sequence, new_sequence, 1)
    else:
        # New file
        new_content = new
    
    return new_content, EditResult(
        file_path=block.file_path,
        status="applied",
        reason=None,
        anchor_preview=block.leading_anchor.split('\n')[0][:50] if block.leading_anchor else "",
        old_preview=block.old_lines.split('\n')[0][:50] if block.old_lines else "",
        new_preview=block.new_lines.split('\n')[0][:50] if block.new_lines else "",
        block=block
    )
```

## Error Messages

| Error | Meaning | User Action |
|-------|---------|-------------|
| `Leading anchor not found` | File changed or LLM hallucinated | Refresh context, retry |
| `Edit location is ambiguous` | Anchor not unique enough | LLM needs more context lines |
| `Old lines don't match content after anchor` | Content between anchors changed | Refresh context, retry |
| `Trailing anchor not found after old lines` | File structure changed | Refresh context, retry |
| `File not found` | Path doesn't exist (and not a create) | Check path |
| `Binary file` | Cannot edit binary files | Use shell commands |

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

## Migration Steps

1. Create `ac/edit_parser.py` with new parser
2. Update system prompt with new format
3. Update `ac/llm/chat.py` and `ac/llm/streaming.py` to use new parser
4. Update frontend to recognize and display new format
5. Test thoroughly
6. Remove old aider edit applier code

## Testing

**Unit tests for parser:**
- Parse single edit block
- Parse multiple edit blocks in one response
- Parse edit block with surrounding markdown/text
- Handle malformed blocks gracefully (return empty list, don't crash)
- Validate exact matching
- Reject when anchor not found
- Reject when multiple anchor matches
- Reject when old lines don't match
- Reject binary files
- Apply modifications correctly
- Apply insertions correctly  
- Apply deletions correctly
- Create new files
- Handle empty anchors correctly

**Integration tests:**
- Full flow: prompt → LLM → parse → apply → verify file
- Streaming with edit detection
- Multiple edits to same file in sequence
- Mix of successful and failed edits
- UI displays results correctly
