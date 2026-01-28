# Plan: Handle Binary Files in LLM Context

## Problem

When a user selects a binary file in the file picker, the system crashes with:
```
'utf-8' codec can't decode byte 0xc7 in position 10: invalid continuation byte
```

Binary files can't be sent to the LLM (expects text/images only).

## Solution

### Phase 1: Backend Protection (Immediate)

Prevent crashes by detecting binary files before attempting to read them as UTF-8.

**1. `ac/repo/file_operations.py` - `get_file_content`**

Add binary check before reading:
```python
if version == 'working':
    if self.is_binary_file(file_path):
        return self._create_error_response(f"Cannot read binary file: {file_path}")
    # ... existing read logic
```

**2. `ac/llm/streaming.py` - `_build_streaming_messages`**

Skip files that return errors (log server-side for debugging):
```python
for path in file_paths:
    content = self.repo.get_file_content(path, version='working')
    if isinstance(content, dict) and 'error' in content:
        print(f"Skipping file: {content['error']}")  # Server-side log
        continue
    # ... include file
```

### Phase 2: Frontend Prevention (Immediate)

Prevent binary file selection at the source - in the file picker.

**1. Add RPC method to check if file is binary**

Expose `is_binary_file` via RPC so frontend can call it.

**2. `webapp/src/file-picker/FileSelectionMixin.js`**

When user clicks a file checkbox:
- Call RPC to check if binary
- If binary: show inline error, prevent selection
- If text: allow selection as normal

This gives immediate feedback without complex streaming metadata flow.

## Files to Modify

### Phase 1 (Backend)
1. `ac/repo/file_operations.py` - Add binary guard in `get_file_content`
2. `ac/llm/streaming.py` - Skip error responses gracefully with server log

### Phase 2 (Frontend)
3. RPC handler - Expose `is_binary_file` method
4. `webapp/src/file-picker/FileSelectionMixin.js` - Check before selecting

## Testing

1. **Phase 1:** Select binary file, send message → no crash, file silently skipped
2. **Phase 2:** Click binary file in picker → immediate error shown, checkbox not checked

## Non-Goals

- No streaming metadata for skipped files (avoids signal flow complexity)
- No automatic unchecking of files (user controls selection)
