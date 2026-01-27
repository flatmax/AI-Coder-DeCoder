# High Impact Refactors Plan

## Overview

This document outlines a plan to address three high-impact refactoring opportunities:
1. Single history source (remove duplication)
2. Base extractor methods (DRY symbol extraction)
3. Unified pointer mixin (merge drag/resize handlers)

## Refactor 1: Single History Source

### Current State

There are THREE places tracking conversation history:

1. **`LiteLLM.conversation_history`** (list of dicts) - Used for building messages
2. **`ContextManager._history`** (list of dicts) - Used for token counting/summarization
3. **`HistoryStore`** (JSONL file) - Used for persistence across sessions

The code currently:
- Appends to `conversation_history` in `_stream_chat`
- Calls `_context_manager.add_exchange()` separately
- Calls `store_user_message()` and `store_assistant_message()` for persistence

### Problems

- Easy to get out of sync
- Summarization updates `_context_manager` but not `conversation_history` directly
- Three places to maintain

### Solution

Make `ContextManager` the single source of truth for in-memory history:
- Remove `LiteLLM.conversation_history` 
- Access history via `_context_manager.get_history()`
- Keep `HistoryStore` for persistence (it serves a different purpose - cross-session)

### Files to Modify

- `ac/llm/llm.py` - Remove `conversation_history`, delegate to context manager
- `ac/llm/streaming.py` - Use context manager for history
- `ac/llm/chat.py` - Use context manager for summarization

### Tests to Add

- `tests/test_llm_history.py` - Test history operations through LiteLLM

---

## Refactor 2: Base Extractor Methods

### Current State

`PythonExtractor` and `JavaScriptExtractor` both implement:
- `_make_range(node)` - Identical implementation
- `_find_child(node, type_name)` - Identical implementation
- `_get_node_text(node, content)` - Already in base but reimplemented
- `_extract_calls_with_context()` - Very similar pattern
- `get_imports()` - Same signature, could be abstract

### Solution

Move common methods to `BaseExtractor`:
- `_make_range()` 
- `_find_child()`
- `get_imports()` as abstract method
- Common call extraction patterns

### Files to Modify

- `ac/symbol_index/extractors/base.py` - Add common methods
- `ac/symbol_index/extractors/python.py` - Remove duplicates, inherit
- `ac/symbol_index/extractors/javascript.py` - Remove duplicates, inherit

### Tests to Add

- `tests/test_extractors.py` - Test extractor methods work after refactor

---

## Refactor 3: Unified Pointer Mixin

### Current State

`DragHandlerMixin` and `ResizeHandlerMixin` both:
- Track `_isDragging` / `_isResizing` state
- Store start positions (`_dragStartX` / `_resizeStartX`)
- Bind mousemove/mouseup handlers
- Have init/destroy lifecycle methods
- Follow identical event handler patterns

### Solution

Create a unified `PointerInteractionMixin` that:
- Provides base pointer tracking infrastructure
- Allows subclasses/configs for drag vs resize behavior
- Reduces code duplication

However, after closer analysis, these mixins are already fairly minimal (~50 lines each) and serve distinct purposes. The "unified" version might actually be MORE complex due to needing to handle both cases.

**Revised recommendation:** Keep separate but extract shared utilities if needed. Lower priority than refactors 1 and 2.

---

## Implementation Order

1. **Refactor 2 (Base Extractor)** - ✅ COMPLETE
2. **Refactor 1 (Single History)** - ✅ COMPLETE
3. **Refactor 3 (Pointer Mixin)** - Skip or defer (minimal gain)

---

## Implementation Status

### Refactor 2: Base Extractor - COMPLETE

Changes made:
- Added `__init__`, `get_imports()`, `_find_child()`, `_make_range()` to `BaseExtractor`
- Removed duplicate methods from `PythonExtractor` and `JavaScriptExtractor`
- Both extractors now call `super().__init__()` and inherit common functionality
- Added comprehensive tests in `tests/test_extractors.py`

Files modified:
- `ac/symbol_index/extractors/base.py`
- `ac/symbol_index/extractors/python.py`
- `ac/symbol_index/extractors/javascript.py`

### Refactor 1: Single History Source - COMPLETE

Changes made:
- Removed `self.conversation_history = []` from `LiteLLM.__init__`
- Added `conversation_history` property that delegates to `_context_manager`
- `ContextManager` is now always created (even without repo)
- Removed duplicate history updates in `streaming.py`
- Removed duplicate history assignment in `chat.py`
- Added comprehensive tests in `tests/test_llm_history.py`

Files modified:
- `ac/llm/llm.py`
- `ac/llm/streaming.py`
- `ac/llm/chat.py`

---

## Detailed Implementation: Refactor 2

### Step 1: Update BaseExtractor

Add to `ac/symbol_index/extractors/base.py`:

```python
from abc import abstractmethod
from typing import List, Optional
from ..models import Symbol, Range, Import

class BaseExtractor(ABC):
    
    def __init__(self):
        self._imports: List[Import] = []
    
    @abstractmethod
    def extract_symbols(self, tree, file_path: str, content: bytes) -> List[Symbol]:
        pass
    
    @abstractmethod
    def get_imports(self) -> List[Import]:
        """Get structured imports from last extraction."""
        pass
    
    def _get_node_text(self, node, content: bytes) -> str:
        """Get the text content of a node."""
        return content[node.start_byte:node.end_byte].decode('utf-8')
    
    def _find_child(self, node, type_name: str):
        """Find the first child of a given type."""
        for child in node.children:
            if child.type == type_name:
                return child
        return None
    
    def _make_range(self, node) -> Range:
        """Create a Range from a tree-sitter node."""
        return Range(
            start_line=node.start_point[0] + 1,
            start_col=node.start_point[1],
            end_line=node.end_point[0] + 1,
            end_col=node.end_point[1],
        )
```

### Step 2: Update PythonExtractor

Remove duplicated methods, keep only Python-specific logic.

### Step 3: Update JavaScriptExtractor

Remove duplicated methods, keep only JS-specific logic.

### Step 4: Add Tests

```python
# tests/test_extractors.py
import pytest
from ac.symbol_index.extractors import get_extractor, PythonExtractor, JavaScriptExtractor

class TestBaseExtractorMethods:
    def test_make_range_python(self):
        # Test _make_range works correctly
        pass
    
    def test_find_child(self):
        # Test _find_child works correctly
        pass
    
    def test_get_imports_python(self):
        # Test get_imports returns structured data
        pass
    
    def test_get_imports_javascript(self):
        # Test get_imports returns structured data
        pass
```

---

## Detailed Implementation: Refactor 1

### Step 1: Update LiteLLM.__init__

Remove `self.conversation_history = []`

### Step 2: Add history property

```python
@property
def conversation_history(self) -> list[dict]:
    """Get conversation history from context manager."""
    if self._context_manager:
        return self._context_manager.get_history()
    return []
```

### Step 3: Update streaming.py

Replace direct `conversation_history` manipulation with context manager calls.

### Step 4: Update chat.py  

Ensure summarization works with single source.

### Step 5: Add Tests

```python
# tests/test_llm_history.py
class TestLiteLLMHistory:
    def test_history_empty_initially(self):
        pass
    
    def test_history_after_exchange(self):
        pass
    
    def test_history_after_summarization(self):
        pass
    
    def test_history_cleared(self):
        pass
```

---

## Success Criteria

1. All existing tests pass
2. New tests pass
3. No behavioral changes to end users
4. Reduced lines of code
5. Single source of truth for history

---

## Rollback Plan

Each refactor is independent. If issues arise:
1. Revert the specific commit
2. Keep other refactors in place
