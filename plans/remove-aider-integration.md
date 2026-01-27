# Plan: Remove Aider Integration

## Goal

Remove the `ac/aider_integration/` module and replace it with cleaner, standalone modules that provide the same functionality without the aider-specific abstractions.

## Current State

The `ac/aider_integration/` module contains:
- Token counting and context management
- Conversation history with summarization
- File context tracking
- Prompt templates and system messages
- HUD (terminal output)
- Token reporting

Most of this is still used, but wrapped in unnecessary abstraction layers (`AiderChat`, `AiderEditor`, multiple mixins).

## What's Already Been Replaced

- **Edit parsing**: `ac/edit_parser.py` (v3 EDIT/REPL format)
- **Repository mapping**: `ac/symbol_index/` (tree-sitter based)
- **History persistence**: `ac/history/history_store.py`

## New Structure

```
ac/
├── context/
│   ├── __init__.py
│   ├── token_counter.py      # Wrap litellm token counting
│   ├── manager.py            # History buffer, summarization, HUD
│   └── file_context.py       # Track files in chat, format for prompt
├── prompts/
│   ├── __init__.py
│   ├── loader.py             # Load sys_prompt*.md files
│   ├── system_reminder.py    # Edit format rules
│   └── examples.py           # Few-shot examples
└── ... (existing modules unchanged)
```

## Phases

### Phase 1: Create `ac/context/token_counter.py`

Extract token counting into a standalone module.

**From:** `ac/aider_integration/token_counter.py`

**Changes:**
- Keep the same interface
- Add model info caching
- No functional changes, just relocation

**Files to create:**
- `ac/context/__init__.py`
- `ac/context/token_counter.py`

**Tests:**
- Token counting for strings
- Token counting for message lists
- Fallback when model not recognized

---

### Phase 2: Create `ac/context/file_context.py`

Consolidate file context tracking and formatting.

**From:**
- `ac/aider_integration/file_context_mixin.py`
- `ac/aider_integration/file_format_mixin.py`

**New class: `FileContext`**
```python
class FileContext:
    def __init__(self, repo_root: str = None):
        ...
    
    def add_file(self, filepath: str, content: str = None):
        """Add a file to context (loads from disk if content not provided)."""
    
    def remove_file(self, filepath: str):
        """Remove a file from context."""
    
    def get_files(self) -> list[str]:
        """Get list of file paths in context."""
    
    def get_content(self, filepath: str) -> str:
        """Get content of a file in context."""
    
    def clear(self):
        """Clear all files from context."""
    
    def format_for_prompt(self, fence=("```", "```")) -> str:
        """Format all files for inclusion in prompt."""
    
    def count_tokens(self, token_counter) -> int:
        """Count total tokens in all files."""
```

**Tests:**
- Add/remove files
- Format output
- Token counting

---

### Phase 3: Create `ac/context/manager.py`

Consolidate history management, summarization, and HUD.

**From:**
- `ac/aider_integration/context_manager.py`
- `ac/aider_integration/history_mixin.py`
- `ac/aider_integration/hud_mixin.py`
- `ac/aider_integration/token_report_mixin.py`
- `ac/aider_integration/minimal_io.py`

**New class: `ContextManager`**
```python
class ContextManager:
    def __init__(self, model_name: str, repo_root: str = None, token_tracker=None):
        self.token_counter = TokenCounter(model_name)
        self.file_context = FileContext(repo_root)
        self.history: list[dict] = []
        self.max_history_tokens = ...
    
    # History management
    def add_message(self, role: str, content: str):
        """Add a message to history."""
    
    def add_exchange(self, user_msg: str, assistant_msg: str):
        """Add a user/assistant exchange to history."""
    
    def get_history(self) -> list[dict]:
        """Get conversation history."""
    
    def set_history(self, messages: list[dict]):
        """Replace history (e.g., after summarization)."""
    
    def clear_history(self):
        """Clear conversation history."""
    
    # Summarization
    def history_needs_summary(self) -> bool:
        """Check if history exceeds token budget."""
    
    def get_summarization_split(self) -> tuple[list, list]:
        """Split history into (to_summarize, to_keep)."""
    
    # Token counting
    def count_tokens(self, content) -> int:
        """Count tokens in content."""
    
    def get_token_budget(self) -> dict:
        """Get token budget info."""
    
    # Reporting
    def print_hud(self, messages: list = None, extra_info: dict = None):
        """Print context HUD to terminal."""
    
    def get_token_report(self, system_prompt: str, symbol_map: str = None) -> str:
        """Generate detailed token report."""
```

**Tests:**
- History operations
- Summarization split logic
- Token budget calculation
- HUD output format

---

### Phase 4: Create `ac/prompts/` module

Simplified prompt loading - just loads the system prompt files.

**Note:** After investigation, `SYSTEM_REMINDER` and `EXAMPLE_MESSAGES` from the old
aider integration were **not actually sent to the LLM**. They were only used for
token counting/reporting. The actual prompt comes from `sys_prompt_v2.md` only.

**New structure:**

`ac/prompts/__init__.py`:
```python
from .loader import load_system_prompt, load_extra_prompt, build_system_prompt
```

`ac/prompts/loader.py`:
```python
def load_system_prompt() -> str:
    """Load sys_prompt_v3.md, sys_prompt_v2.md, or sys_prompt.md."""

def load_extra_prompt() -> str:
    """Load optional sys_prompt_extra.md."""

def build_system_prompt() -> str:
    """Build complete system prompt (main + extra)."""
```

**Tests:**
- Prompt loading from files
- Missing file handling
- build_system_prompt combines main + extra

---

### Phase 5: Update `ac/llm/` to use new modules

Split into smaller steps:

#### Phase 5a: Switch prompt loading ✅ COMPLETE
- Change `streaming.py` to use `ac/prompts.build_system_prompt()` instead of `ac/aider_integration/prompts.build_edit_system_prompt()`

#### Phase 5b: Add new ContextManager to LiteLLM
- Add `self._new_context_manager` using `ac/context/ContextManager`
- Keep `AiderChat` working in parallel for now
- Wire up token tracking to new context manager

#### Phase 5c: Switch file context management
- Replace `aider_chat.add_file()` → `self._new_context_manager.file_context.add_file()`
- Replace `aider_chat.clear_files()` → `self._new_context_manager.file_context.clear()`
- Update `streaming.py` to use new file context

#### Phase 5d: Switch history management  
- Replace `aider_chat.check_history_size()` → `self._new_context_manager.history_needs_summary()`
- Replace `aider_chat.get_summarization_split()` → `self._new_context_manager.get_summarization_split()`
- Update `chat.py` summarization to use new context manager

#### Phase 5e: Switch token reporting
- Replace `aider_chat.get_token_report()` → `self._new_context_manager.get_token_report()`
- Update HUD printing to use new context manager

#### Phase 5f: Remove AiderChat dependency
- Remove `get_aider_chat()` method
- Remove `self._aider_chat`
- Remove import of `AiderChat`

---

### Phase 6: Remove `ac/aider_integration/`

Once all functionality is migrated and tests pass:

1. Delete `ac/aider_integration/` directory
2. Update any remaining imports
3. Run full test suite
4. Update documentation

**Files to delete:**
- `ac/aider_integration/__init__.py`
- `ac/aider_integration/chat_integration.py`
- `ac/aider_integration/editor.py`
- `ac/aider_integration/context_manager.py`
- `ac/aider_integration/token_counter.py`
- `ac/aider_integration/minimal_io.py`
- `ac/aider_integration/prompt_mixin.py`
- `ac/aider_integration/file_context_mixin.py`
- `ac/aider_integration/file_format_mixin.py`
- `ac/aider_integration/file_management_mixin.py`
- `ac/aider_integration/chat_history_mixin.py`
- `ac/aider_integration/history_mixin.py`
- `ac/aider_integration/hud_mixin.py`
- `ac/aider_integration/token_report_mixin.py`
- `ac/aider_integration/prompts/__init__.py`
- `ac/aider_integration/prompts/system_reminder.py`
- `ac/aider_integration/prompts/example_messages.py`

---

## Token Report Format

Keep both summary and detailed information:

```
Token Usage (claude-3-5-sonnet-20241022)
────────────────────────────────────────────────────
     1,234  system prompt
       823  chat history              [clear to reset]
     1,502  symbol map
     2,345  ac/llm/llm.py
     1,123  ac/edit_parser.py
────────────────────────────────────────────────────
     7,027  total
   120,973  remaining (94%)
   128,000  context window
────────────────────────────────────────────────────
Session: 45.2K in, 12.1K out (8.3K cache hit, 2.1K cache write)
```

Features:
- Show token counts per component
- Show remaining capacity with percentage
- Session totals at bottom (prompt in, completion out)
- Cache token info displayed if present (cache hits save cost/time)
- No cost calculations (too variable with caching and provider differences)

---

## Order of Implementation

1. **Phase 1**: Token counter (foundation, no dependencies) ✅ COMPLETE
2. **Phase 2**: File context (depends on phase 1 for token counting) ✅ COMPLETE
3. **Phase 3**: Context manager (depends on phases 1-2) ✅ COMPLETE
4. **Phase 4**: Prompts (independent, can be done in parallel) ✅ COMPLETE
5. **Phase 5**: Update LLM module (depends on phases 1-4)
6. **Phase 6**: Remove old code (after all tests pass)

## Risks

- **Subtle behavior differences**: The mixin-based approach has complex inheritance. Need thorough testing.
- **History summarization**: This is called automatically and could break conversations if not working correctly.
- **Token counting accuracy**: Different models have different tokenizers. Keep fallback behavior.

## Success Criteria

- [ ] All existing tests pass
- [ ] Token counting works for all supported models
- [ ] History summarization triggers correctly
- [ ] HUD displays accurate information
- [ ] Token report matches expected format
- [ ] No imports from `ac/aider_integration/` remain
- [ ] Session token totals are tracked and displayed (kept in `LiteLLM` class)
- [ ] Cache token info displayed when available

## Decisions Made

- **Cost tracking**: Skip $ cost calculations - too variable with caching and provider differences
- **Session totals**: Keep in `LiteLLM` class (tracks actual API usage, not context)
- **Cache tokens**: Display cache hit/write info in session totals when available (useful to know caching is working)
- **Test files**: Create new test files for each new module (`tests/test_token_counter.py`, etc.)
- **Backward compatibility**: OK to break `ac/aider_integration/` during migration
