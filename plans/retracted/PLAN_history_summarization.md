# Plan: Align History Summarization with Aider's Approach

## Overview

Update conversation history compaction to match aider's battle-tested approach:
- Code-aware summarization prompt
- 50/50 split ratio with assistant message boundaries
- Proper history budget calculation (clamped 1k-8k)
- Recursive summarization for very long histories

## Files to Modify

1. `ac/aider_integration/context_manager.py` - Fix `max_history_tokens` calculation
2. `ac/aider_integration/history_mixin.py` - Update split logic
3. `ac/llm/chat.py` - Update summarization prompt
4. `ac/aider_integration/chat_history_mixin.py` - Update `set_summarized_history`

## Changes

### 1. `ac/aider_integration/context_manager.py`

**Current:**
```python
self.max_history_tokens = max_input // 16
```

**Change to:**
```python
# Calculate max_history_tokens as 1/16th of max_input_tokens,
# with minimum 1k and maximum 8k (matches aider)
self.max_history_tokens = min(max(max_input // 16, 1024), 8192)
```

### 2. `ac/aider_integration/history_mixin.py`

**Changes:**

a) Update `get_summarization_split()`:
   - Change from 75/25 to **50/50** split
   - Ensure split occurs at **assistant message boundary**
   - Return all messages for summarization when ≤4 messages

b) Add helper to format messages for summarization

**New implementation:**
```python
def get_summarization_split(self) -> tuple:
    """
    Returns (head, tail) for summarization.
    Head = older messages to summarize (~50%)
    Tail = recent messages to keep verbatim (~50%)
    Split must occur at assistant message boundary.
    """
    if not self.history_too_big():
        return [], self.done_messages.copy()

    min_split = 4
    if len(self.done_messages) <= min_split:
        return self.done_messages.copy(), []  # Summarize all

    half_max_tokens = self.max_history_tokens // 2
    tail_tokens = 0
    split_index = len(self.done_messages)

    # Build tail from recent messages up to half budget
    for i in range(len(self.done_messages) - 1, -1, -1):
        msg_tokens = self.count_tokens(self.done_messages[i])
        if tail_tokens + msg_tokens < half_max_tokens:
            tail_tokens += msg_tokens
            split_index = i
        else:
            break

    # Ensure head ends with assistant message
    while split_index > 1 and self.done_messages[split_index - 1]["role"] != "assistant":
        split_index -= 1

    if split_index <= min_split:
        return self.done_messages.copy(), []  # Summarize all

    head = self.done_messages[:split_index]
    tail = self.done_messages[split_index:]
    return head, tail

def format_messages_for_summary(self, messages) -> str:
    """Format messages for summarization prompt (aider format)."""
    content = ""
    for msg in messages:
        role = msg.get("role", "").upper()
        if role not in ("USER", "ASSISTANT"):
            continue
        msg_content = msg.get("content", "")
        if isinstance(msg_content, list):
            # Handle multimodal messages
            msg_content = " ".join(
                part.get("text", "") for part in msg_content 
                if part.get("type") == "text"
            )
        content += f"# {role}\n{msg_content}"
        if not content.endswith("\n"):
            content += "\n"
    return content
```

### 3. `ac/llm/chat.py`

**Add constants at top of file (after existing imports and constants):**
```python
SUMMARIZE_PROMPT = """*Briefly* summarize this partial conversation about programming.
Include less detail about older parts and more detail about the most recent messages.
Start a new paragraph every time the topic changes!

This is only part of a longer conversation so *DO NOT* conclude the summary with language like "Finally, ...". Because the conversation continues after the summary.
The summary *MUST* include the function names, libraries, packages that are being discussed.
The summary *MUST* include the filenames that are being referenced by the assistant inside the ```...``` fenced code blocks!
The summaries *MUST NOT* include ```...``` fenced code blocks!

Phrase the summary with the USER in first person, telling the ASSISTANT about the conversation.
Write *as* the user.
The user should refer to the assistant as *you*.
Start the summary with "I asked you..."."""

SUMMARY_PREFIX = "I spoke to you previously about a number of things.\n"
```

**Update `summarize_history()` method:**
- Use the code-aware `SUMMARIZE_PROMPT`
- Use `format_messages_for_summary()` helper from context manager
- Add recursion with max depth of 3
- Use `SUMMARY_PREFIX` for injected summary

### 4. `ac/aider_integration/chat_history_mixin.py`

**Update `set_summarized_history()`:**

The summary passed in should already be prefixed, so keep the method simple. The prefix is applied in `chat.py` after getting the LLM response.

## Testing

1. Test with a long conversation that exceeds history budget
2. Verify split occurs at assistant message boundary
3. Verify summary includes filenames and function names
4. Test recursion when result is still too big
5. Verify summary is written in first-person as user

## Future Consideration: Async Summarization

Aider runs summarization in a background thread for better UX. This could be added later but is out of scope for this change.
