
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
| Phase 4: Frontend Updates | 🔄 PARTIAL | `CardMarkdown.js` needs update for v3 markers |
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

## Remaining Work

### Phase 4: Frontend Updates

**`webapp/src/prompt/CardMarkdown.js`**
- [ ] Update `parseEditBlocks()` to recognize v3 markers (`««« EDIT`, `═══════ REPL`, `»»» EDIT END`)
- [ ] Update `protectSearchReplaceBlocks()` for v3 format
- [ ] Display computed anchor vs old/new lines distinction
- [ ] Show edit status indicators (applied/failed/skipped) inline

**`webapp/src/PromptView.js`**
- [ ] Handle `edit_results` array from streaming response
- [ ] Display per-block status with estimated line numbers
- [ ] Click-to-navigate to failed edit location in diff viewer

**`webapp/src/diff-viewer/DiffViewer.js`**
- [ ] `_revealPosition()` already exists - verify it works with edit results
- [ ] Add highlight styling for failed edit regions

[context lines - same as above, repeated verbatim]
[new lines replacing the old]
═══════ REPL
[context lines - same as above, repeated verbatim]
[new lines replacing the old]
»»» EDIT END
```

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

## Section Handling in V3

In v3, there are only two explicit sections (EDIT and REPL). The anchor is derived from their common prefix.

### How Different Operations Work

**Modification** (anchor + old → anchor + new):
```
file.py
««« EDIT
def multiply(a, b):
    return a + b  # BUG
═══════ REPL
def multiply(a, b):
    return a * b

## Examples

### Modify existing code

```
src/math.py
««« EDIT
def multiply(a, b):
    return a + b  # BUG
═══════ REPL
def multiply(a, b):
    return a * b

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

### 🔄 Phase 4: Frontend Updates (PARTIAL)

**`webapp/src/prompt/CardMarkdown.js`** - needs update:
- [ ] Update `parseEditBlocks()` to detect v3 markers
- [ ] Update regex/parsing for `««« EDIT`, `═══════ REPL`, `»»» EDIT END`
- [ ] Display edit status from `editResults` prop

**`webapp/src/PromptView.js`** - partially done:
- [x] Receives `edit_results` from streaming response
- [ ] Pass results to CardMarkdown for display
- [ ] Click handler for navigating to edit location

**`webapp/src/diff-viewer/DiffViewer.js`** - mostly done:
- [x] `_revealPosition()` exists for line navigation
- [x] `_highlightLine()` for visual feedback
- [ ] Wire up edit result click → diff viewer navigation

### ✅ Phase 5: Cleanup (COMPLETE)

- Old v2 anchor-separator format (`───────`) removed
- `edit_applier_mixin.py` still exists but unused by main flow
- Parser only handles v3 common-prefix format


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

## Next Steps

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
