# History Compaction Skill

You are analyzing a conversation history to identify topic boundaries and create a summary.

## Task

1. **Identify the most recent topic boundary** - Find where the conversation shifted to a new subject, task, or focus area.
2. **Summarize everything before that boundary** - Create a concise summary preserving key context.

## What constitutes a topic boundary?

- User starts a new task ("now let's work on...", "moving on to...", "can you help with...")
- Shift to a different file or component
- Change from one type of work to another (debugging → feature development)
- Explicit context reset ("forget that", "actually", "let's try something else")

## Output Format

Respond with ONLY a JSON object (no markdown fencing):

```
{
  "boundary_index": <integer or null>,
  "boundary_reason": "<brief explanation of why this is a topic boundary>",
  "confidence": <0.0-1.0>,
  "summary": "<concise summary of messages BEFORE the boundary>"
}
```

- `boundary_index`: The message index (0-based) where the NEW topic starts. Messages 0 to boundary_index-1 will be summarized. Use `null` if no clear boundary exists.
- `confidence`: How confident you are that this is a real topic boundary (0.5+ suggests a real boundary)
- `summary`: Summary of context from messages BEFORE the boundary. Include: files discussed, decisions made, key outcomes. Keep under 500 words.

## Guidelines

- Look for boundaries in the MIDDLE of the conversation, not at the very end
- If the entire conversation is one continuous topic, set boundary_index to null
- The summary should give a future reader enough context to continue the work
- Focus on WHAT was done and WHY, not detailed HOW
