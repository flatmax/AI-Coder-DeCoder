# Plan: Handle Binary Files in LLM Context

## Status: IMPLEMENTED ✅

## Problem

When a user selects a binary file in the file picker, the system crashes with:
```
'utf-8' codec can't decode byte 0xc7 in position 10: invalid continuation byte
```

Binary files can't be sent to the LLM (expects text/images only).

## Solution Implemented

### Phase 1: Backend Protection ✅

**1. `ac/repo/file_operations.py` - `get_file_content`**

Added binary check before reading working copy files:
- Calls `is_binary_file()` before attempting UTF-8 decode
- Returns error response for binary files instead of crashing

**2. `ac/llm/streaming.py` - `_build_streaming_messages`**

Skip files that return errors:
- Checks for error dict responses from `get_file_content()`
- Logs skipped files server-side for debugging
- Continues processing remaining valid files

### Phase 2: Frontend Prevention ✅

**1. `webapp/src/file-picker/FileSelectionMixin.js`**

Added binary file detection on selection:
- Async RPC call to `is_binary_file` when checkbox clicked
- If binary: shows toast/error message, prevents selection
- If text: proceeds with normal selection

**2. Visual feedback in file picker**

- Binary files show error state briefly when user attempts selection
- Clear user feedback explaining why file cannot be selected

## Files Changed

1. `ac/repo/file_operations.py` - Binary guard in `get_file_content`
2. `ac/llm/streaming.py` - Skip error responses gracefully
3. `webapp/src/file-picker/FileSelectionMixin.js` - Frontend binary check

## Testing

1. ✅ Select binary file via picker → immediate error shown, not selected
2. ✅ If binary file somehow reaches backend → gracefully skipped, no crash
3. ✅ Text files continue to work normally

## Non-Goals (Unchanged)

- No streaming metadata for skipped files (avoids signal flow complexity)
- No automatic unchecking of files (user controls selection)
