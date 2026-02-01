# Plan: Topic-Aware History Compaction

## Overview

Implement intelligent history compaction that preserves the current conversation topic while summarizing older content. The system identifies topic boundaries and uses them as natural truncation points, with optional summarization of content before the boundary.

## Problem Statement

Currently, when history grows too large:
- Simple token-based truncation can cut mid-topic, losing context
- No awareness of conversation flow or topic changes
- Summarization doesn't consider what's actually relevant to current discussion

## Design

### Core Concept: Topic-Bounded Rolling Window

```
HISTORY TIMELINE:
[old msgs...] [TOPIC BOUNDARY] [current topic msgs...] [recent exchange]
              ↑                ↑                        ↑
              │                │                        └── Always keep verbatim
              │                └── Keep verbatim if within token budget
              └── Truncate here (optionally summarize content before)
```

### Two-Threshold System

The compaction system uses two distinct thresholds:

1. **Compaction Trigger Threshold** - When total history exceeds this, compaction runs
2. **Verbatim Window Threshold** - How much recent history to preserve unchanged

```
EXAMPLE CONFIGURATION:
┌─────────────────────────────────────────────────────────────┐
│ compaction_trigger_tokens = 6000  (when to start compacting)│
│ verbatim_window_tokens    = 3000  (recent msgs to preserve) │
│ summary_budget_tokens     = 500   (max tokens for summary)  │
└─────────────────────────────────────────────────────────────┘

TIMELINE VISUALIZATION:
                                          
│◄──────── TOTAL HISTORY ────────────────────────────────────►│
│                                                              │
│ [old messages...]  [topic boundary?]  [VERBATIM WINDOW]      │
│        ↓                                     ↓               │
│  Summarize or                          Never touched         │
│  truncate when                         (last 3000 tokens)    │
│  trigger hit                                                 │
│                                                              │
│◄─── if > 6000 tokens, compact ──────►│◄── always keep ─────►│
```

### Trigger Logic Flow

```
on_before_llm_call():
    total_tokens = count_history_tokens()
    
    if total_tokens > COMPACTION_TRIGGER (6000):
        verbatim_start_idx = find_verbatim_window_start()  # Last 3000 tokens
        topic_boundary_idx = detect_topic_boundary(all_messages)
        
        # TWO CONDITIONAL APPROACHES:
        
        if topic_boundary_idx >= verbatim_start_idx:
            # CASE 1: Topic boundary is INSIDE verbatim window
            # The current topic started recently - just truncate, no summary needed
            history = messages[topic_boundary_idx:]
            
        else:
            # CASE 2: Topic boundary is OUTSIDE (before) verbatim window
            # Current topic started earlier - summarize the gap, keep verbatim window
            old_messages = messages[:verbatim_start_idx]
            summary = summarize(old_messages)  # Max 500 tokens
            history = [summary_msg] + messages[verbatim_start_idx:]
```

### Two Conditional Approaches Explained

**Case 1: Topic Boundary INSIDE Verbatim Window (Truncate Only)**

```
│ [old msgs] [old topic] │ [TOPIC BOUNDARY] [current topic...] │
│                        │ ↑                                    │
│                        │ └── boundary is within last 3000 tok │
│                        │                                      │
│◄─── TRUNCATE (discard) ─┤◄───── KEEP (no summary needed) ────►│
```

- Topic started recently, within the verbatim window
- Simply discard everything before the topic boundary
- No summarization needed - we have the full current topic

**Case 2: Topic Boundary OUTSIDE Verbatim Window (Summarize + Keep Window)**

```
│ [old msgs] [TOPIC BOUNDARY] [current topic cont'd...] │ [VERBATIM WINDOW] │
│            ↑                                          │                   │
│            └── boundary is before verbatim window     │                   │
│                                                       │                   │
│◄─────────── SUMMARIZE this region ───────────────────►│◄── KEEP as-is ──►│
```

- Topic started earlier, before the verbatim window
- Summarize content from topic boundary to verbatim window start
- Keep the verbatim window unchanged
- Result: [summary] + [verbatim window messages]

### Token Budget Allocation

```
┌───────────────────────────────────────────────────────────────┐
│ compaction_trigger_tokens = 6000  # Trigger compaction        │
│ verbatim_window_tokens    = 3000  # Always preserve recent    │
│ summary_budget_tokens     = 500   # Max summary size          │
│ detection_sample_tokens   = 1000  # Context for topic detect  │
└───────────────────────────────────────────────────────────────┘
```

## Implementation

### Phase 1: Topic Boundary Detection

**New file: `ac/prompts/compaction_skill.md`**

This prompt instructs the small model to analyze conversation history and perform both topic boundary detection and summarization in a single call:

```markdown
# History Compaction Assistant

You are analyzing a conversation history to help compact it while preserving context.

## Your Tasks

1. **Identify the current topic**: What is the user currently working on or discussing?

2. **Find the topic boundary**: At which message index did the current topic/task begin? 
   - Look for clear shifts: new files, new features, new questions
   - If the conversation is one continuous topic, return index 0

3. **Summarize prior content** (if any exists before the topic boundary):
   - Capture key decisions made
   - Note any important context established
   - Keep under {summary_budget} tokens
   - If no prior content, return null

## Input Format

You will receive messages in this format:
```
[0] USER: <message>
[1] ASSISTANT: <message>
[2] USER: <message>
...
```

## Output Format

Respond with JSON only:
```json
{
  "current_topic": "Brief description of what user is currently working on",
  "topic_start_index": <integer>,
  "prior_summary": "Summary of content before topic boundary, or null if none",
  "confidence": <float 0.0-1.0>
}
```

## Examples

### Example 1: Clear topic shift
Input shows user discussing auth module in messages 0-3, then switching to database schema in messages 4-7.
```json
{
  "current_topic": "Designing database schema for user profiles",
  "topic_start_index": 4,
  "prior_summary": "Previously discussed auth module: decided to use JWT tokens, implemented login endpoint, added refresh token rotation.",
  "confidence": 0.95
}
```

### Example 2: Continuous single topic
Input shows ongoing discussion about the same feature throughout.
```json
{
  "current_topic": "Implementing file upload feature",
  "topic_start_index": 0,
  "prior_summary": null,
  "confidence": 0.9
}
```

## Guidelines

- Be conservative: if unsure about a topic boundary, prefer keeping more context
- Focus on what's actionable: decisions, code changes, agreed approaches
- Ignore small tangents that don't affect the main topic
- The summary should help an LLM continue the conversation without the original messages
```

**New file: `ac/history/topic_detector.py`**

```python
from dataclasses import dataclass
from pathlib import Path
import json
import litellm

@dataclass
class TopicBoundaryResult:
    boundary_index: int          # Message index where current topic starts
    topic_summary: str           # Brief description of current topic
    prior_summary: str | None    # Summary of content before boundary
    confidence: float            # 0.0-1.0 confidence in boundary detection


class TopicDetector:
    """Detects topic boundaries in conversation history."""
    
    def __init__(self, model: str = "gpt-4o-mini", summary_budget: int = 500):
        self.model = model
        self.summary_budget = summary_budget
        self._prompt_template = self._load_prompt()
    
    def _load_prompt(self) -> str:
        """Load the compaction prompt template."""
        prompt_path = Path(__file__).parent.parent / "prompts" / "compaction_skill.md"
        return prompt_path.read_text()
    
    def find_topic_boundary(
        self, 
        messages: list[dict], 
        max_lookback_tokens: int = 3000
    ) -> TopicBoundaryResult:
        """
        Analyze messages to find where current topic began.
        Uses compaction_prompt_v1.md to instruct the small model.
        
        Returns:
            TopicBoundaryResult with:
            - boundary_index: message index where current topic starts
            - topic_summary: brief description of current topic
            - prior_summary: summary of content before boundary (or None)
            - confidence: 0.0-1.0 confidence in boundary detection
        """
        formatted_messages = self._format_messages_for_detection(messages)
        prompt = self._prompt_template.replace("{summary_budget}", str(self.summary_budget))
        
        response = litellm.completion(
            model=self.model,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": formatted_messages}
            ],
            response_format={"type": "json_object"}
        )
        
        result = json.loads(response.choices[0].message.content)
        return TopicBoundaryResult(
            boundary_index=result["topic_start_index"],
            topic_summary=result["current_topic"],
            prior_summary=result.get("prior_summary"),
            confidence=result["confidence"]
        )
    
    def _format_messages_for_detection(self, messages: list[dict]) -> str:
        """Format messages for the detection prompt."""
        lines = []
        for i, msg in enumerate(messages):
            role = msg["role"].upper()
            content = msg["content"]
            # Truncate very long messages for detection
            if len(content) > 1000:
                content = content[:1000] + "..."
            lines.append(f"[{i}] {role}: {content}")
        return "\n".join(lines)
```

### Phase 2: Compaction Engine

**New file: `ac/history/compactor.py`**

```python
from dataclasses import dataclass
from ac.history.topic_detector import TopicDetector, TopicBoundaryResult
from ac.context.token_counter import TokenCounter

@dataclass
class CompactionConfig:
    # Two-threshold system
    compaction_trigger_tokens: int = 6000  # When to trigger compaction
    verbatim_window_tokens: int = 3000     # Recent history to preserve verbatim
    summary_budget_tokens: int = 500       # Max tokens for summary of old content
    
    # Safety minimums
    min_verbatim_exchanges: int = 2        # Always keep at least N exchanges
    
    # Models for detection/summarization
    detection_model: str = "gpt-4o-mini"
    summarization_model: str = "gpt-4o-mini"

@dataclass  
class CompactionResult:
    compacted_messages: list[dict]  # New message list to use
    summary_message: dict | None    # Optional summary of truncated content
    truncated_count: int            # How many messages were removed
    topic_detected: str | None      # What topic was identified
    tokens_before: int              # Tokens before compaction
    tokens_after: int               # Tokens after compaction

class HistoryCompactor:
    """Compacts conversation history using topic-aware truncation."""
    
    def __init__(self, config: CompactionConfig, token_counter: TokenCounter):
        self.config = config
        self.token_counter = token_counter
        self.topic_detector = TopicDetector(config.detection_model)
    
    def should_compact(self, messages: list[dict]) -> bool:
        """Check if history exceeds trigger threshold."""
        total_tokens = self._count_messages_tokens(messages)
        return total_tokens > self.config.compaction_trigger_tokens
    
    def compact(self, messages: list[dict]) -> CompactionResult:
        """
        Compact history preserving current topic context.
        
        Strategy:
        1. Find verbatim window boundary (last N tokens)
        2. Look for topic boundary before that
        3. If boundary found: truncate there
        4. If valuable content before boundary: summarize it
        5. Return compacted messages with optional summary prefix
        """
        ...
    
    def _find_verbatim_window_start(self, messages: list[dict]) -> int:
        """
        Find the message index where verbatim window starts.
        Scans backward from end until token limit reached.
        """
        ...
    
    def _count_messages_tokens(self, messages: list[dict]) -> int:
        """Count total tokens in message list."""
        ...
    
    def _generate_summary(
        self, 
        messages: list[dict],
        prior_topic_summary: str | None
    ) -> dict:
        """Generate a summary message for truncated content."""
        ...
```

### Phase 3: Integration with ContextManager

**Modify: `ac/context/manager.py`**

```python
from ac.history.compactor import HistoryCompactor, CompactionConfig, CompactionResult

class ContextManager:
    def __init__(self, ...):
        # ... existing init ...
        self._compactor = HistoryCompactor(
            CompactionConfig(),
            self.token_counter
        )
    
    def compact_history_if_needed(self) -> CompactionResult | None:
        """
        Check if history needs compaction and perform it.
        Called before building messages for LLM.
        
        Uses two-threshold system:
        - Triggers when history > compaction_trigger_tokens (e.g., 6000)
        - Preserves last verbatim_window_tokens (e.g., 3000) unchanged
        - Summarizes/truncates everything older
        """
        if self._compactor.should_compact(self._history):
            result = self._compactor.compact(self._history)
            self._history = result.compacted_messages
            return result
        return None
    
    # Keep existing methods for backward compatibility
    def history_needs_summary(self) -> bool:
        """Legacy method - checks against compaction trigger threshold."""
        return self._compactor.should_compact(self._history)
```

### Phase 4: Streaming Integration

**Modify: `ac/llm/streaming.py`**

In `_stream_chat`, before building messages:

```python
async def _stream_chat(self, ...):
    # Compact history if needed (topic-aware)
    compaction = self._context_manager.compact_history_if_needed()
    if compaction:
        # Log what happened
        print(f"[Compacted history] Removed {compaction.truncated_count} messages, "
              f"saved {compaction.tokens_before - compaction.tokens_after} tokens, "
              f"topic: {compaction.topic_detected}")
    
    # ... rest of existing streaming logic ...
```

### Phase 5: User Interface Integration

The UI must communicate compaction status to the user through chat messages and button states.

#### 5.1 Compaction Flow with UI Feedback

```
USER CLICKS SEND
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│ Check if compaction needed                               │
│ (total history > compaction_trigger_tokens)              │
└──────────────────────────────────────────────────────────┘
       │
       │ YES, compaction needed
       ▼
┌──────────────────────────────────────────────────────────┐
│ 1. Add user message to chat:                             │
│    "🗜️ Compacting history..."                            │
│                                                          │
│ 2. Send button changes to "Stop" (normal streaming UX)   │
│                                                          │
│ 3. Run topic detection + compaction (small model call)   │
└──────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│ Compaction complete - add assistant message:             │
│                                                          │
│ CASE 1 (summary generated):                              │
│   "📋 **History Summary**                                │
│    [500 token summary of truncated content]              │
│    ---                                                   │
│    _X messages compacted, Y tokens saved_"               │
│                                                          │
│ CASE 2 (truncation only, topic boundary inside window):  │
│   "✂️ **History Truncated**                              │
│    Older messages from previous topic removed.           │
│    Current topic context preserved.                      │
│    ---                                                   │
│    _X messages removed, Y tokens saved_"                 │
└──────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│ Continue with normal message send to main LLM            │
└──────────────────────────────────────────────────────────┘
```

#### 5.2 HUD Token Display

Add history token usage to the existing HUD display:

```
┌─────────────────────────────────────────────────────────┐
│  Tokens: 45.2k/128k  │  Cache: 82%  │  History: 2.8k/6k │
│                                              ▲          │
│                                              │          │
│                          current/trigger threshold      │
└─────────────────────────────────────────────────────────┘
```

- Shows current history tokens vs. compaction trigger threshold
- Visual indicator when approaching threshold (e.g., yellow at 80%, red at 95%)
- After compaction, shows reduced count

#### 5.3 Implementation Details

**Modify: `ac/llm/streaming.py`**

```python
async def _stream_chat(self, request_id, ...):
    # Check if compaction needed BEFORE main LLM call
    if self._context_manager.should_compact():
        # Fire UI message: "Compacting history..."
        self._fire_stream_chunk(request_id, {
            'type': 'compaction_start',
            'message': '🗜️ Compacting history...'
        }, loop)
        
        # Run compaction (includes small model call for topic detection)
        compaction = await self._context_manager.compact_history_async()
        
        # Fire UI message with result
        if compaction.summary_message:
            # Case 1: Summary generated
            self._fire_stream_chunk(request_id, {
                'type': 'compaction_complete',
                'summary': compaction.summary_message['content'],
                'stats': {
                    'messages_removed': compaction.truncated_count,
                    'tokens_saved': compaction.tokens_before - compaction.tokens_after
                }
            }, loop)
        else:
            # Case 2: Truncation only
            self._fire_stream_chunk(request_id, {
                'type': 'compaction_complete',
                'truncated': True,
                'stats': {
                    'messages_removed': compaction.truncated_count,
                    'tokens_saved': compaction.tokens_before - compaction.tokens_after
                }
            }, loop)
    
    # Continue with normal streaming...
```

**Modify: `webapp/src/prompt/StreamingMixin.js`**

```javascript
streamChunk(requestId, content) {
    // Handle compaction messages
    if (content.type === 'compaction_start') {
        this.addMessage('system', content.message);
        return;
    }
    
    if (content.type === 'compaction_complete') {
        if (content.summary) {
            const msg = `📋 **History Summary**\n\n${content.summary}\n\n---\n_${content.stats.messages_removed} messages compacted, ${content.stats.tokens_saved} tokens saved_`;
            this.addMessage('assistant', msg);
        } else {
            const msg = `✂️ **History Truncated**\n\nOlder messages from previous topic removed. Current topic context preserved.\n\n---\n_${content.stats.messages_removed} messages removed, ${content.stats.tokens_saved} tokens saved_`;
            this.addMessage('assistant', msg);
        }
        return;
    }
    
    // Normal chunk handling...
}
```

**Modify: `webapp/src/prompt/PromptViewTemplate.js`** (HUD section)

Add history token display to the existing HUD:

```javascript
function renderHud(component) {
    // ... existing token/cache display ...
    
    // Add history usage
    const historyTokens = component.hudData?.historyTokens || 0;
    const historyThreshold = component.hudData?.historyThreshold || 6000;
    const historyPercent = (historyTokens / historyThreshold) * 100;
    const historyClass = historyPercent > 95 ? 'critical' : 
                         historyPercent > 80 ? 'warning' : '';
    
    return html`
        <!-- existing HUD content -->
        <span class="hud-history ${historyClass}">
            History: ${formatTokens(historyTokens)}/${formatTokens(historyThreshold)}
        </span>
    `;
}
```

#### 5.4 Files to Modify for UI

- `ac/llm/streaming.py` - Send compaction events to frontend
- `webapp/src/prompt/StreamingMixin.js` - Handle compaction events, display messages
- `webapp/src/prompt/PromptViewTemplate.js` - Add history tokens to HUD
- `webapp/src/prompt/PromptViewStyles.js` - Styles for history indicator (warning/critical states)

## Configuration

**Add to `ac-dc.json`:**

```json
{
  "history_compaction": {
    "enabled": true,
    "compaction_trigger_tokens": 6000,
    "verbatim_window_tokens": 3000,
    "summary_budget_tokens": 500,
    "min_verbatim_exchanges": 2,
    "detection_model": "gpt-4o-mini",
    "summarization_model": "gpt-4o-mini"
  }
}
```

No settings UI - all configuration is done via `ac-dc.json`.

## Example Scenarios

### Scenario 1: Topic Boundary INSIDE Verbatim Window (Case 1 - Truncate Only)

```
Total history: 7000 tokens (exceeds 6000 trigger)
Verbatim window start: message index 4 (last 3000 tokens = [U4, A4, U5, A5])
Topic boundary detected: message index 4 (U4) - INSIDE verbatim window

         [A1, U1, A2, U2, A3, U3]  [U4, A4, U5, A5]
         │                      │  │              │
         │    old topic         │  │ current topic│
         │                      │  ↑              │
         │                      │  topic boundary │
         │                      │                 │
         └──── TRUNCATE ────────┘  └─── KEEP ─────┘

Result: 
- Truncate [A1, U1, A2, U2, A3, U3] - old topic, not needed
- Keep [U4, A4, U5, A5] - entire current topic preserved
- NO summary needed (we have complete topic context)
```

### Scenario 2: Topic Boundary OUTSIDE Verbatim Window (Case 2 - Summarize + Keep)

```
Total history: 8000 tokens (exceeds 6000 trigger)
Verbatim window start: message index 4 (last 3000 tokens = [U4, A4, U5, A5])
Topic boundary detected: message index 2 (U2) - OUTSIDE/BEFORE verbatim window

         [A1, U1]  [U2, A2, U3, A3]  [U4, A4, U5, A5]
         │      │  │              │  │              │
         │ old  │  │ current topic│  │ current topic│
         │      │  ↑ (continued)  │  │ (recent)     │
         │      │  topic boundary │  │              │
         │      │                 │  │              │
         └─TRUNC┘  └─ SUMMARIZE ──┘  └── KEEP ─────┘

Result:
- Truncate [A1, U1] - before topic boundary
- Summarize [U2, A2, U3, A3]: "Discussed refactoring auth module, decided on..."
- Keep [U4, A4, U5, A5] verbatim - recent exchanges unchanged
- Final: [summary_msg, U4, A4, U5, A5]
```

### Scenario 3: No Clear Topic Boundary (Fallback - Keep Verbatim Window)

```
Total history: 7500 tokens (exceeds 6000 trigger)
Verbatim window start: message index 3 (last 3000 tokens = [U3, A3, U4, A4, U5, A5])
Topic boundary: NOT DETECTED (continuous single-topic discussion)

         [A1, U1, A2, U2]  [U3, A3, U4, A4, U5, A5]
         │              │  │                      │
         │ same topic   │  │ same topic (recent)  │
         │ (older)      │  │                      │
         │              │  │                      │
         └─ SUMMARIZE ──┘  └────── KEEP ──────────┘

Result:
- Summarize [A1, U1, A2, U2]: "Earlier in this discussion about X feature..."
- Keep [U3, A3, U4, A4, U5, A5] verbatim
- Final: [summary_msg, U3, A3, U4, A4, U5, A5]
```

## Testing Strategy

### Unit Tests (`tests/test_history_compaction.py`)

1. **Topic detection accuracy:**
   - Clear topic shifts (new file, new task)
   - Subtle shifts (refinement of approach)
   - No shift (continuous discussion)

2. **Compaction correctness:**
   - Token counting accuracy
   - Boundary respect (verbatim window never touched)
   - Summary generation within budget

3. **Threshold behavior:**
   - No compaction when under trigger threshold
   - Correct compaction when over trigger
   - Verbatim window size respected

4. **Edge cases:**
   - Very short history (< trigger threshold)
   - History exactly at trigger threshold
   - Single topic throughout
   - Rapid topic switches

### Integration Tests

1. Full conversation simulation with compaction triggers
2. Verify LLM still understands context after compaction
3. Performance: compaction should add < 2s latency (LLM call)

## Migration Path

1. **Phase 1:** Add `TopicDetector` and `HistoryCompactor` classes
2. **Phase 2:** Add config options, integrate with `ContextManager`
3. **Phase 3:** Enable by default, deprecate old `summarize_history()` in `chat.py`
4. **Phase 4:** Remove legacy summarization code

## Files to Create

- `ac/prompts/compaction_skill.md` - Prompt for small model to detect topics and summarize ✅ DONE
- `ac/context/topic_detector.py` - Topic boundary detection ✅ DONE (note: in context/, not history/)
- `ac/history/compactor.py` - Compaction logic ✅ DONE
- `tests/test_topic_detector.py` - Detection tests ✅ DONE
- `tests/test_history_compaction.py` - Compaction tests ✅ DONE

## Files to Modify

- `ac/context/__init__.py` - Export TopicDetector and TopicBoundaryResult ✅ DONE
- `ac/context/manager.py` - Integrate compactor, add `compact_history_if_needed()` ✅ DONE
- `ac/llm/config.py` - Add compaction config loading ✅ DONE
- `ac-dc.json` - Add history_compaction configuration block ✅ DONE
- `tests/test_context_manager.py` - Add compaction integration tests ✅ DONE
- `ac/llm/llm.py` - Pass compaction config to ContextManager ✅ DONE
- `ac/llm/streaming.py` - Call compaction before streaming, return compaction info ✅ DONE
- `ac/llm/chat.py` - Deprecate old `summarize_history()` ✅ DONE
- `tests/test_llm_history.py` - Add LiteLLM compaction config tests ✅ DONE
- `webapp/src/prompt/StreamingMixin.js` - Handle compaction events, display chat messages (Phase 5)
- `webapp/src/prompt/PromptViewTemplate.js` - Add history token usage to HUD (Phase 5)
- `webapp/src/prompt/PromptViewStyles.js` - Styles for history indicator states (Phase 5)

## History Architecture Clarification

The system has two distinct history concepts that must remain separate:

### 1. History Store (Permanent Record)
- **Location:** `ac/history/history_store.py` → `HistoryStore` class
- **Storage:** `.aicoder/history.jsonl` (append-only file)
- **Purpose:** Complete, immutable log of all conversations
- **Behavior:** Only appends, never modified or truncated
- **Used for:** Session browsing, search, audit trail

### 2. Context History (Working Memory)
- **Location:** `ac/context/manager.py` → `ContextManager._history`
- **Storage:** In-memory list
- **Purpose:** Messages to send to LLM for current context
- **Behavior:** Can be compacted, summarized, truncated
- **Used for:** Building LLM prompts

### Compaction Scope

```
┌─────────────────────────────────────────────────────────────────┐
│                     HISTORY STORE                               │
│  (permanent, append-only, never touched by compaction)          │
│                                                                 │
│  [msg1] [msg2] [msg3] [msg4] [msg5] [msg6] [msg7] [msg8] ...   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ on session load / new message
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CONTEXT HISTORY                              │
│  (working memory, subject to compaction)                        │
│                                                                 │
│  Before: [msg1] [msg2] [msg3] [msg4] [msg5] [msg6] [msg7] [msg8]│
│                                                                 │
│  After compaction:                                              │
│          [summary] [msg6] [msg7] [msg8]                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ sent to LLM
                              ▼
                        ┌───────────┐
                        │    LLM    │
                        └───────────┘
```

### Key Principle

**Compaction ONLY affects `ContextManager._history` (in-memory working set).**

The `HistoryStore` remains untouched - it's the source of truth that can always be used to:
- Browse full session history in UI
- Search across all conversations
- Reload/restore sessions
- Debug what actually happened

When a session is loaded from `HistoryStore`, it populates `ContextManager._history`. 
Compaction then operates on that working copy without affecting the stored original.

## Open Questions

1. **Summary format:** Should summaries be structured or prose? (Leaning toward prose for natural flow)
2. **Persistence:** Should we log compaction events for debugging?
3. **User visibility:** Should the UI indicate when compaction occurred?
4. **Code preservation:** Should code blocks in truncated messages get special handling?

## Success Metrics

- History stays within budget without manual intervention
- Current topic context is preserved after compaction
- No noticeable degradation in LLM response quality
- Compaction latency < 2 seconds (single small-model LLM call)
