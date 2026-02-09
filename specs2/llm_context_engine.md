# LLM Context Engine

## Overview

The context engine manages conversation history, token budgets, file context, and coordinates prompt assembly. It is the central state holder for an LLM session, sitting between the transport layer and individual subsystems.

## Architecture

```
┌──────────────────────────────────────────────┐
│              Context Manager                  │
│                                               │
│  ┌──────────┐ ┌────────────┐ ┌─────────────┐ │
│  │ History   │ │Token       │ │ File        │ │
│  │ (list)    │ │Counter     │ │ Context     │ │
│  └──────────┘ └────────────┘ └─────────────┘ │
│  ┌──────────────────┐ ┌──────────────────────┐│
│  │Stability Tracker  │ │ History Compactor    ││
│  │(cache tiers)      │ │ (optional)           ││
│  └──────────────────┘ └──────────────────────┘│
└──────────────────────────────────────────────┘
```

## Initialization

```pseudo
ContextManager(
    model_name,              // For token counting and compaction LLM calls
    repo_root?,              // Enables file context and stability tracking
    token_tracker?,          // For session total display
    cache_target_tokens,     // Per-tier minimum (0 disables)
    compaction_config?       // From app config
)
```

Creates sub-components:
1. **Token Counter** — model-aware token counting
2. **File Context** — tracks files included in conversation
3. **Stability Tracker** — assigns items to cache tiers (only if repo_root provided)
4. **History Compactor** — optional, requires compaction config with detection model

## Conversation History

An in-memory list of `{role, content}` message dicts. This is the **working copy** used for assembling LLM requests — separate from persistent storage.

### Operations

| Operation | Description |
|-----------|-------------|
| `add_message(role, content)` | Append single message |
| `add_exchange(user, assistant)` | Append pair atomically |
| `get_history()` | Return a copy (prevents mutation) |
| `set_history(messages)` | Replace entirely (after compaction or session load) |
| `clear_history()` | Empty list + purge history entries from stability tracker |
| `reregister_history_items()` | Purge stability entries without clearing history |
| `history_token_count()` | Token count of current history |

## File Context

Tracks files included in the conversation with their contents.

| Method | Description |
|--------|-------------|
| `add_file(path, content?)` | Add file; reads from disk if content not provided |
| `remove_file(path)` | Remove from context |
| `get_files()` | List paths in context |
| `get_content(path)` | Get specific file content |
| `has_file(path)` | Check membership |
| `clear()` | Remove all |
| `format_for_prompt()` | Format all as fenced code blocks |
| `count_tokens(counter)` | Total tokens across all files |
| `get_tokens_by_file(counter)` | Per-file token counts |

Paths are normalized to relative paths from repo root.

## Token Counting

Wraps the LLM provider's tokenizer with:
- **Model-aware counting** — selects correct tokenizer for the configured model
- **Fallback** — estimates ~4 characters per token on any error
- **Multiple input types** — strings, message dicts, or lists of messages
- **Model info caching** — max input/output tokens loaded once with sensible defaults

### Token Budget

```pseudo
max_history_tokens = max_input_tokens / 16
```

Used for budget reporting. Not enforced as a hard limit — compaction has its own trigger threshold.

## Stability Tracker

Assigns content items (files, symbols, history messages) to cache tiers based on how consistently they appear across requests. See the [Cache Tiering](cache_tiering.md) spec for the full algorithm.

The context manager:
- **Creates** the tracker on init (if repo_root provided)
- **Provides access** to other components
- **Cleans up** history entries on clear/compaction

## Compaction Integration

Wraps the history compactor with convenience methods:

| Method | Description |
|--------|-------------|
| `should_compact()` | True if enabled and history tokens exceed trigger |
| `compact_history_if_needed()` | Run compaction, replace history on success |
| `get_compaction_status()` | Status dict for UI (enabled, tokens, threshold, percent) |

See [History and Compaction](history_and_compaction.md) for the algorithm.

## Token Budget Reporting

```pseudo
get_token_budget() -> {
    history_tokens,
    max_history_tokens,
    max_input_tokens,
    remaining,
    needs_summary        // delegates to should_compact()
}
```

## Token Budget Enforcement

Three layers of defense prevent runaway token usage:

### Layer 1: Compaction (Normal)

History compaction triggers when tokens exceed `compaction_trigger_tokens`. See [History and Compaction](history_and_compaction.md).

### Layer 2: Emergency Truncation

If compaction fails (LLM error, timeout, parse failure) AND history exceeds `2 × compaction_trigger_tokens`, the oldest messages are dropped without summarization. Simple tail truncation — loses history but prevents budget blowout.

### Layer 3: Pre-Request Shedding

Before assembling the prompt, if total estimated tokens exceed 90% of the model's `max_input_tokens`, files are dropped from context (largest first) with a warning message in the chat. The request proceeds with reduced context rather than failing at the API.

## Lifecycle

### Session Start
1. LLM service creates Context Manager with model, repo root, config
2. Stability tracker starts empty — tiers rebuild from reference graph on first request
3. History is empty

### During Conversation
1. Streaming handler calls `add_message()` for each exchange
2. Stability tracker is updated with current items after each response
3. Post-response compaction runs if threshold exceeded

### Session Reset
Clears history, purges stability tracker history entries, starts new persistent session

### Loading a Previous Session
1. Clear current history
2. Read messages from persistent store
3. Add each to context manager
4. Set persistent store's session ID to continue in the loaded session
