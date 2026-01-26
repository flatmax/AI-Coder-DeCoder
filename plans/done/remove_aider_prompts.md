# Plan: Remove Aider Dependency from Prompt Building

## Overview

Replace `aider.coders.editblock_prompts.EditBlockPrompts` with our own prompt templates while maintaining the same interface that `MessageContextMixin` and `MessageSimpleMixin` expect.

## Current State

`prompt_mixin.py` imports `from aider.coders.editblock_prompts import EditBlockPrompts` which provides:
- `main_system` - Main system prompt template (we use `sys_prompt.md` instead)
- `system_reminder` - SEARCH/REPLACE format rules with `{fence}` placeholders
- `example_messages` - Few-shot examples for the edit format
- `go_ahead_tip` - A small tip string

## Design Decisions

1. **`sys_prompt.md` is required** - Raise clear error if missing, propagates to UI
2. **`system_reminder` stays in code** - Mechanical SEARCH/REPLACE rules, not user-editable
3. **`example_messages` stays in code** - Few-shot examples for the format
4. **No fallback prompts** - Fail fast with actionable error

## File Changes

| File | Action |
|------|--------|
| `ac/aider_integration/prompts/__init__.py` | Create - exports `EditBlockPrompts` |
| `ac/aider_integration/prompts/example_messages.py` | Create - few-shot examples |
| `ac/aider_integration/prompt_mixin.py` | Modify - change import, fail if `sys_prompt.md` missing |
| `tests/test_prompts.py` | Create - unit tests |

## Implementation Details

### `ac/aider_integration/prompts/__init__.py`

```python
class EditBlockPrompts:
    """Replacement for aider's EditBlockPrompts."""
    
    main_system = ""  # Not used - we load sys_prompt.md
    system_reminder = SYSTEM_REMINDER  # SEARCH/REPLACE rules with {fence}, {go_ahead_tip} placeholders
    example_messages = EXAMPLE_MESSAGES  # Few-shot examples
    go_ahead_tip = ""  # Not needed
```

### `ac/aider_integration/prompts/example_messages.py`

Few-shot examples covering:
1. Basic edit (modify existing code)
2. New file creation (empty SEARCH block)
3. Code deletion (empty REPLACE block)
4. Multiple edits in one response

### `ac/aider_integration/prompt_mixin.py` Changes

- Change import from `aider.coders.editblock_prompts` to `.prompts`
- Make `_load_prompt_file()` raise `FileNotFoundError` if `sys_prompt.md` not found
- Remove fallback logic in `get_system_prompt()`

### Error Propagation Path

When `sys_prompt.md` is missing:
1. `_init_prompts()` raises `FileNotFoundError` with clear message
2. `AiderEditor.__init__()` fails
3. `AiderChat.__init__()` fails
4. `LiteLLM.get_aider_chat()` fails
5. Error returns to UI via JRPC

## Token Tracking

No changes needed - token tracking is independent of aider prompts:
- `TokenCounter` wraps `litellm.token_counter`
- `AiderContextManager.count_tokens()` uses `TokenCounter`
- `HudMixin.print_hud()` / `print_compact_hud()` display counts
- `LiteLLM.track_token_usage()` tracks session totals

## Testing

### Unit Tests: `tests/test_prompts.py`

```python
def test_edit_block_prompts_has_required_attributes():
    """Verify EditBlockPrompts has all required attributes."""
    from ac.aider_integration.prompts import EditBlockPrompts
    prompts = EditBlockPrompts()
    assert hasattr(prompts, 'main_system')
    assert hasattr(prompts, 'system_reminder')
    assert hasattr(prompts, 'example_messages')
    assert hasattr(prompts, 'go_ahead_tip')

def test_system_reminder_has_placeholders():
    """Verify system_reminder has required format placeholders."""
    from ac.aider_integration.prompts import EditBlockPrompts
    prompts = EditBlockPrompts()
    assert '{fence}' in prompts.system_reminder
    assert '{go_ahead_tip}' in prompts.system_reminder

def test_example_messages_format():
    """Verify example_messages have correct structure."""
    from ac.aider_integration.prompts import EditBlockPrompts
    prompts = EditBlockPrompts()
    assert isinstance(prompts.example_messages, list)
    for msg in prompts.example_messages:
        assert 'role' in msg
        assert 'content' in msg
        assert msg['role'] in ('user', 'assistant')

def test_example_messages_contain_search_replace():
    """Verify assistant examples contain SEARCH/REPLACE blocks."""
    from ac.aider_integration.prompts import EditBlockPrompts
    prompts = EditBlockPrompts()
    assistant_msgs = [m for m in prompts.example_messages if m['role'] == 'assistant']
    for msg in assistant_msgs:
        content = msg['content'].format(fence='```', go_ahead_tip='')
        assert '<<<<<<< SEARCH' in content
        assert '=======' in content
        assert '>>>>>>> REPLACE' in content

def test_missing_sys_prompt_raises_error():
    """Verify missing sys_prompt.md raises FileNotFoundError."""
    # This test requires mocking the file system or testing in isolation
    pass
```

### Manual Testing

1. Remove `sys_prompt.md` temporarily, verify clear error in UI
2. Run existing chat workflow, verify LLM produces valid SEARCH/REPLACE blocks
3. Verify HUD token counts are accurate
4. Test with `sys_prompt_extra.md` to verify it's still appended

## Rollback Plan

Revert import in `prompt_mixin.py` back to:
```python
from aider.coders.editblock_prompts import EditBlockPrompts
```
