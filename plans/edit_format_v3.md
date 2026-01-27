
# Edit Format V3: Common Prefix Edit Blocks

## Overview

This document tracks the implementation of the v3 edit format, which replaced both the original SEARCH/REPLACE format (from aider) and the planned v2 anchored format.

The v3 format uses a simpler approach: the anchor is **computed automatically** as the common prefix between the EDIT and REPL sections, eliminating the need for explicit anchor markers.

## Current Status Summary

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Core Parser | ✅ COMPLETE | `ac/edit_parser.py` with full test coverage |
| Phase 2: Backend Integration | ✅ COMPLETE | Used by `chat.py`, `streaming.py` |
| Phase 3: Prompt Update | ✅ COMPLETE | System prompt uses v3 format |
| Phase 4: Frontend Updates | ✅ COMPLETE | `CardMarkdown.js` updated for v3 markers |
| Phase 5: Cleanup | ✅ COMPLETE | Old v2 anchor format removed |

## What's Done

### Core Parser (`ac/edit_parser.py`)
- ✅ `EditParser` class with v3 format parsing
- ✅ `_compute_common_prefix()` - derives anchor from matching lines
- ✅ `validate_block()` - checks anchor+old exists in file
- ✅ `apply_block()` / `apply_edits()` - applies changes to files
- ✅ `detect_format()` - identifies v3 blocks
- ✅ `detect_shell_suggestions()` - extracts git commands
- ✅ Full test coverage in `tests/test_edit_parser.py`

### Backend Integration
- ✅ `ac/llm/chat.py` - `ChatMixin.chat()` uses `EditParser`
- ✅ `ac/llm/streaming.py` - `StreamingMixin._stream_chat()` uses `EditParser`
- ✅ Returns structured `EditResult` objects with status, line numbers
- ✅ Legacy format compatibility (`passed`, `failed`, `skipped` tuples)

### Prompt System
- ✅ System prompt teaches v3 format (in `sys_prompt.md`)
- ✅ Examples updated in `example_messages.py`


## Parser State Machine

The parser uses a line-by-line state machine to handle the nested marker structure:

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
                    ▼                                             │
┌──────┐  file path  ┌─────────────┐  ««« EDIT  ┌────────────────┐│
│ IDLE │────────────►│ EXPECT_START│───────────►│ LEADING_ANCHOR ││
└──────┘             └─────────────┘            └────────────────┘│
   ▲                       │                           │          │
   │                       │ (other line)              │ ───────  │
   │                       ▼                           ▼          │
   │                  ┌─────────┐               ┌───────────┐     │
   │                  │ (reset) │               │ OLD_LINES │     │
   │                  └─────────┘               └───────────┘     │
   │                                                   │          │
   │                                                   │ ═══════  │
   │                                                   ▼          │
   │                                            ┌───────────┐     │
   │                                            │ NEW_LINES │     │
   │                                            └───────────┘     │
   │                                                   │          │
   │                                                   │ ───────  │
   │                                                   ▼          │
   │                                           ┌────────────────┐ │
   │                                           │TRAILING_ANCHOR │ │
   │                                           └────────────────┘ │
   │                                                   │          │
   │                         »»»                       │          │
   └───────────────────────────────────────────────────┘          │
                                                                  │
   On any malformed transition: discard current block, return to IDLE
```

### State Transitions

| Current State | Line Content | Action | Next State |
|---------------|--------------|--------|------------|
| IDLE | Any non-empty line | Store as potential file path | EXPECT_START |
| EXPECT_START | `««« EDIT` | Begin new block with stored path | LEADING_ANCHOR |
| EXPECT_START | Other | Replace stored path with this line | EXPECT_START |
| LEADING_ANCHOR | `───────` | Finalize leading anchor (may be empty) | OLD_LINES |
| LEADING_ANCHOR | Other | Append to leading anchor | LEADING_ANCHOR |
| OLD_LINES | `═══════` | Finalize old lines (may be empty) | NEW_LINES |
| OLD_LINES | Other | Append to old lines | OLD_LINES |
| NEW_LINES | `───────` | Finalize new lines (may be empty) | TRAILING_ANCHOR |
| NEW_LINES | Other | Append to new lines | NEW_LINES |
| TRAILING_ANCHOR | `»»»` | Finalize block, emit EditBlock | IDLE |
| TRAILING_ANCHOR | Other | Append to trailing anchor | TRAILING_ANCHOR |

### Marker Detection Rules

- Markers must be the **entire line content** (stripped) to avoid false positives
- A line containing `x ═══════ y` is NOT a marker - it's content
- Empty lines within sections are preserved as content

## Implementation Status

### ✅ Phase 1: Core Parser (COMPLETE)

**File:** `ac/edit_parser.py`

The parser is fully implemented with:
- `EditParser` class with v3 format (common prefix computation)
- `EditBlock` dataclass with `anchor`, `old_lines`, `new_lines` fields
- `EditResult` and `ApplyResult` for structured results
- `_compute_common_prefix()` derives anchor automatically
- `validate_block()` checks anchor+old exists uniquely in file
- `apply_block()` / `apply_edits()` applies changes
- `detect_format()` identifies v3 blocks
- `detect_shell_suggestions()` extracts git commands
- Full test coverage in `tests/test_edit_parser.py`

### ✅ Phase 2: Backend Integration (COMPLETE)

**Files modified:**
- `ac/llm/chat.py` - `ChatMixin.chat()` uses `EditParser`
- `ac/llm/streaming.py` - `StreamingMixin._stream_chat()` uses `EditParser`

Both return structured results:
- `edit_results`: List of per-block status with line numbers
- `passed`/`failed`/`skipped`: Legacy tuple format for compatibility
- `files_modified`: List of changed file paths

### ✅ Phase 3: Prompt Update (COMPLETE)

- System prompt (`sys_prompt.md`) teaches v3 format
- Example messages updated to use v3 format
- No dual-format detection needed - v3 only

## Error Messages

| Error | Meaning | User Action |
|-------|---------|-------------|
| `Anchor not found in file` | Context lines don't exist in file | LLM hallucinated or file changed - refresh context |
| `Edit location is ambiguous (matches at lines X and Y)` | Anchor appears multiple times | LLM needs more unique context lines |
| `Old lines don't match content after anchor` | Lines after anchor differ from expected | File changed since context was loaded |
| `Content sequence not found in file` | Combined anchor+old not found | Refresh file context, retry |
| `File not found: {path}` | Path doesn't exist (not a create operation) | Check path spelling |
| `Cannot edit binary file` | File detected as binary | Use shell commands instead |
| `Previous edit to this file failed` | Earlier edit block to same file failed | Fix the earlier edit first |

## Parser Edge Cases

The parser handles these edge cases gracefully:

| Case | Behavior |
|------|----------|
| File path with spaces | Entire line before `««« EDIT` is treated as path (trimmed) |
| Empty or whitespace-only path | Block is skipped, parsing continues |
| Unclosed block (no `»»» EDIT END`) | Block is skipped, parsing continues |
| Missing `═══════ REPL` separator | Block is skipped, parsing continues |
| Markers mid-line | Not recognized (e.g., `x ═══════ REPL y` is content) |
| Nested blocks | Outer block parsed; inner markers treated as content |
| Empty response | Returns empty list |
| No edit blocks in response | Returns empty list |
| All lines match (100% common prefix) | Empty old_lines, entire content is anchor |
| No lines match (0% common prefix) | Empty anchor, all lines are old/new |



## Testing

### Unit Tests (`tests/test_edit_parser.py`)

```python
class TestEditParserParse:
    """Tests for EditParser.parse_response()"""
    
    def test_parse_single_block(self):
        """Basic single edit block parsing."""
        
    def test_parse_multiple_blocks(self):
        """Multiple edit blocks in one response."""
        
    def test_parse_with_surrounding_text(self):
        """Edit blocks surrounded by markdown explanation."""
        
    def test_parse_file_path_with_spaces(self):
        """File path containing spaces."""
        
    def test_skip_empty_path(self):
        """Block with empty/whitespace path is skipped."""
        
    def test_skip_unclosed_block(self):
        """Unclosed block skipped, rest of response parsed."""
        
    def test_skip_missing_content_separator(self):
        """Block missing ═══════ is skipped."""
        
    def test_skip_missing_second_anchor_separator(self):
        """Block missing second ─────── is skipped."""
        
    def test_marker_mid_line_not_recognized(self):
        """Markers appearing mid-line are treated as content."""
        
    def test_empty_leading_anchor(self):
        """Empty leading anchor (─────── right after ««« EDIT)."""
        
    def test_empty_old_lines(self):
        """Empty old lines (═══════ right after first ───────)."""
        
    def test_empty_new_lines(self):
        """Empty new lines (─────── right after ═══════)."""
        
    def test_empty_trailing_anchor(self):
        """Empty trailing anchor (»»» right after second ───────)."""
        
    def test_all_sections_empty_except_new(self):
        """New file creation pattern."""
        
    def test_preserves_internal_blank_lines(self):
        """Blank lines within sections are preserved."""
        
    def test_preserves_indentation(self):
        """Indentation in content is preserved exactly."""


class TestEditParserValidate:
    """Tests for EditParser.validate_block()"""
    
    def test_valid_block(self):
        """Block that matches file content exactly."""
        
    def test_leading_anchor_not_found(self):
        """Error when leading anchor doesn't exist in file."""
        
    def test_leading_anchor_multiple_matches(self):
        """Error when leading anchor matches multiple locations."""
        
    def test_old_lines_mismatch(self):
        """Error when old lines don't match after anchor."""
        
    def test_trailing_anchor_mismatch(self):
        """Error when trailing anchor doesn't match after old lines."""
        
    def test_new_file_validation(self):
        """New file (all empty) validates against empty/missing file."""
        
    def test_line_number_in_error(self):
        """Error includes estimated line number."""


class TestEditParserApply:
    """Tests for EditParser.apply_block() and apply_edits()"""
    
    def test_apply_modification(self):
        """Replace old lines with new lines."""
        
    def test_apply_insertion(self):
        """Insert new lines (empty old lines)."""
        
    def test_apply_deletion(self):
        """Delete old lines (empty new lines)."""
        
    def test_apply_new_file(self):
        """Create new file from empty content."""
        
    def test_trailing_newline_normalization(self):
        """Result always has exactly one trailing newline."""
        
    def test_crlf_normalization(self):
        """CRLF in file content normalized to LF."""
        
    def test_sequential_edits_same_file(self):
        """Multiple edits to same file applied in order."""
        
    def test_skip_after_failure(self):
        """Subsequent edits to file skipped after failure."""
        
    def test_dry_run_no_write(self):
        """Dry run validates but doesn't write."""
        
    def test_auto_stage(self):
        """Modified files are git staged."""
        
    def test_binary_file_rejected(self):
        """Binary files cannot be edited."""
```

### Integration Tests

- Full flow: prompt → LLM → parse → apply → verify file
- Streaming with edit detection
- Multiple edits to same file in sequence (all succeed)
- Multiple edits to same file with middle one failing (rest skipped)
- Mix of successful and failed edits across different files
- UI displays results correctly with line numbers
- Shell suggestion detection and display
