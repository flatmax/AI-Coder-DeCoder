# Aider Integration Cleanup Plan

**Status: IN PROGRESS - Phase 3 Pending**

## Overview

The `ac/aider_integration/` module has accumulated dead code and broken functionality as the codebase evolved. Edit parsing moved to `EditParser`, streaming bypasses message building mixins, and some methods reference non-existent attributes.

## Current State Analysis

### What's Actually Used

| Component | Used By | Purpose |
|-----------|---------|---------|
| `AiderChat` | `LiteLLM.get_aider_chat()` | Container for file context + history |
| `AiderEditor` | `AiderChat.editor` | File storage + prompt templates |
| `AiderContextManager` | `AiderChat._context_manager` | Token counting, history, HUD |
| `ChatHistoryMixin` | `AiderChat` | History/summarization operations |
| `FileManagementMixin` | `AiderChat` | Delegates to editor |

### What's Broken

1. **`FileMentionMixin.get_addable_files()`** (line 23 of `file_mention_mixin.py`)
   - References `self._context_manager.git_repo.get_tracked_files()`
   - `AiderContextManager` has no `git_repo` attribute
   - This means file mention detection silently fails

### What's Bypassed/Redundant

1. **`RequestMixin.request_changes()`**
   - Used by `LiteLLM.chat()` (non-streaming)
   - Completely bypassed by `LiteLLM.chat_streaming()` which is the primary path
   - `chat_streaming()` builds messages directly via `_build_streaming_messages()`

2. **`MessageBuilderMixin` and sub-mixins**
   - `_build_messages()` only called by `request_changes()`
   - `_build_messages_with_context()` in `MessageContextMixin`
   - `_build_messages_simple()` in `MessageSimpleMixin`
   - All bypassed by streaming path

3. **`FileMentionMixin`**
   - Only called by `request_changes()` 
   - Broken anyway due to missing `git_repo`

### What's Completely Replaced

1. **Edit parsing** - Now handled by `ac/edit_parser.py`
2. **Edit application** - Now handled by `EditParser.apply_edits()`

## Cleanup Options

### Option A: Minimal Fix (Low Risk)

Fix the broken code, keep the structure:

1. Fix `FileMentionMixin.get_addable_files()` to use `self.repo` directly
2. Document that `request_changes()` is legacy, `chat_streaming()` is primary

**Pros**: Low risk, quick
**Cons**: Leaves dead code paths

### Option B: Consolidate Message Building (Medium Risk)

Unify streaming and non-streaming to use the same message building:

1. Fix `FileMentionMixin`
2. Make `chat()` use `chat_streaming()` internally (or vice versa)
3. Remove duplicate message building code from `streaming.py`

**Pros**: Single code path, easier maintenance
**Cons**: Need to verify feature parity

### Option C: Full Cleanup (Higher Risk)

Remove all unused code:

1. **Delete**:
   - `RequestMixin` (replaced by direct litellm calls in streaming.py)
   - `MessageBuilderMixin`, `MessageContextMixin`, `MessageSimpleMixin` (bypassed)
   - `FileMentionMixin` (broken and bypassed)
   - `message_builder.py`, `message_context.py`, `message_simple.py`, `message_utils.py`
   - `file_mention_mixin.py`

2. **Keep**:
   - `AiderChat` (simplified - just holds editor + context_manager)
   - `AiderEditor` (file context + prompts)
   - `AiderContextManager` (token counting + history + HUD)
   - `ChatHistoryMixin` (history operations)
   - `FileManagementMixin` (file operations)

3. **Move to `ac/llm/`**:
   - File mention detection (if we want to restore it)

**Pros**: Clean codebase, no dead code
**Cons**: More changes, higher risk of breaking something

## Recommended Approach

**Option B** - Consolidate first, then clean up:

### Phase 1: Fix Broken Code
1. Fix `FileMentionMixin.get_addable_files()` or remove it entirely

### Phase 2: Audit Non-Streaming Path
1. Determine if `LiteLLM.chat()` (non-streaming) is still needed
2. If yes, make it use the same code path as streaming
3. If no, deprecate/remove it

### Phase 3: Remove Dead Code
1. Remove message building mixins if Phase 2 confirms they're unused
2. Remove `RequestMixin` if non-streaming path is removed
3. Update `__init__.py` exports

## Files to Modify

### Immediate Fixes
- `ac/aider_integration/file_mention_mixin.py` - fix or remove broken method

### Potential Deletions (Phase 3)
- `ac/aider_integration/request_mixin.py`
- `ac/aider_integration/message_builder.py`
- `ac/aider_integration/message_context.py`
- `ac/aider_integration/message_simple.py`
- `ac/aider_integration/message_utils.py`
- `ac/aider_integration/file_mention_mixin.py`

### Files to Update
- `ac/aider_integration/__init__.py` - remove deleted exports
- `ac/aider_integration/chat_integration.py` - remove unused mixin inheritance
- `ac/llm/chat.py` - potentially simplify or remove non-streaming path

## Testing Plan

1. Run existing tests: `pytest tests/`
2. Manual test streaming chat flow
3. Manual test non-streaming chat flow (if kept)
4. Verify token report still works
5. Verify history summarization still works

## Decision Needed

Before proceeding, clarify:

1. Is non-streaming `chat()` still needed, or can we remove it?
2. Is file mention detection (adding files LLM asks for) a desired feature?
3. What's the appetite for risk vs. code cleanliness?

---

## Implementation Notes (Completed)

### Files Deleted
- `ac/aider_integration/request_mixin.py` - Bypassed by streaming path
- `ac/aider_integration/file_mention_mixin.py` - Broken (referenced non-existent `git_repo`) and unused
- `ac/aider_integration/message_builder.py` - Only used by deleted RequestMixin
- `ac/aider_integration/message_context.py` - Only used by deleted MessageBuilderMixin
- `ac/aider_integration/message_simple.py` - Only used by deleted MessageBuilderMixin
- `ac/aider_integration/message_utils.py` - Only used by deleted mixins

### Files Modified
- `ac/aider_integration/chat_integration.py` - Removed unused mixin inheritance
- `ac/aider_integration/__init__.py` - Removed deleted exports

### Files Kept
- `AiderEditor` - Still used for file context and prompt templates
- `AiderContextManager` - Still used for token counting, history, HUD
- `ChatHistoryMixin` - Still used for history/summarization operations
- `FileManagementMixin` - Still used for file operations (delegates to editor)

### Notes
- Non-streaming `LiteLLM.chat()` still exists but builds messages directly
- Streaming path (`chat_streaming()`) is the primary code path
- File mention detection was broken anyway - can be re-implemented cleanly if needed
