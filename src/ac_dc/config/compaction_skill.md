# Topic Boundary Detection

You are analyzing a conversation to find where the topic changed.

## Input
A numbered list of conversation messages.

## Task
Find the message index where the conversation shifted to a NEW topic. Look for:
- Explicit task switches ("now let's work on...")
- Shift to a different file or component
- Change in work type (debugging → feature development)
- Context resets ("forget that", "let's try something else")

## Output
Return JSON (no markdown fencing):
```json
{
    "boundary_index": <integer or null>,
    "boundary_reason": "<why this is a boundary>",
    "confidence": <0.0 to 1.0>,
    "summary": "<summary of messages before boundary>"
}
```

If the entire conversation is one topic, set boundary_index to null.
Look for boundaries in the MIDDLE, not at the very end.
