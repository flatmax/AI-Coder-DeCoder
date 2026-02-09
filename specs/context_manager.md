# Context Manager

The context manager coordinates conversation history, token budgets, file
context, cache stability tracking, and history compaction. It is the central
state holder for an LLM session, sitting between the transport layer
(streaming, JRPC) and the individual subsystems.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  ContextManager                  │
│                                                  │
│  ┌──────────┐ ┌────────────┐ ┌────────────────┐ │
│  │  History  │ │TokenCounter│ │  FileContext    │ │
│  │ (list)    │ │            │ │                │ │
│  └──────────┘ └────────────┘ └────────────────┘ │
│  ┌──────────────────┐ ┌────────────────────────┐ │
│  │StabilityTracker   │ │  HistoryCompactor      │ │
│  │(cache_stability)  │ │  (optional)            │ │
│  └──────────────────┘ └────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

`ContextManager` is instantiated by `LiteLLM.__init__()` and stored as
`_context_manager`. It is not directly exposed over JRPC — instead,
`LiteLLM` and `StreamingMixin` delegate to it for history management,
token counting, and compaction decisions.

## Initialization

```python
ContextManager(
    model_name: str,
    repo_root: str = None,
    token_tracker=None,
    cache_target_tokens: int = 0,
    compaction_config: dict = None,
)
```

| Parameter | Description |
|-----------|-------------|
| `model_name` | LiteLLM model identifier. Passed to `TokenCounter` for accurate token counting and to `HistoryCompactor` for the summarization LLM call. |
| `repo_root` | Repository root path. Enables `FileContext` path resolution and `StabilityTracker` creation. If `None`, `FileContext` uses cwd and no stability tracker is created. |
| `token_tracker` | Optional object with `get_token_usage()` — typically the parent `LiteLLM` instance. Used only for HUD display of session totals. |
| `cache_target_tokens` | Target tokens per cache tier block. Passed to `StabilityTracker` for threshold-aware tier sizing. `0` disables target-aware behavior. |
| `compaction_config` | Dict from `app.json` `history_compaction` section. If absent, `None`, or `enabled: false`, compaction is disabled. Requires `detection_model` key when enabled. |

### Sub-Component Creation

During `__init__`, the context manager creates:

1. **`TokenCounter(model_name)`** — shared token counting instance.
2. **`FileContext(repo_root)`** — file content tracker.
3. **`StabilityTracker`** — only if `repo_root` is provided. Initialized
   with 4-tier thresholds `{L3: 3, L2: 6, L1: 9, L0: 12}`, initial tier
   `L3`, and the provided `cache_target_tokens`. Fresh each session — no
   cross-session persistence.
4. **`HistoryCompactor`** — only if compaction is enabled and
   `detection_model` is provided. See [History Compaction](history_compaction.md).

### History Token Budget

```python
max_input = token_counter.max_input_tokens
max_history_tokens = max_input // 16
```

The history budget is 1/16 of the model's maximum input tokens. This is
used in `get_token_budget()` reporting but is **not** enforced as a hard
limit — compaction uses its own `compaction_trigger_tokens` threshold.

## Conversation History

History is an in-memory list of message dicts with `role` and `content`
keys. It is **not** the same as `HistoryStore` (which handles persistent
disk storage and session management). The context manager's history is the
working copy used for assembling LLM requests.

### Adding Messages

```python
add_message(role: str, content: str) -> None
```

Appends a single message. Used by `StreamingMixin` after each user prompt
and assistant response.

```python
add_exchange(user_msg: str, assistant_msg: str) -> None
```

Appends a user/assistant pair atomically. Convenience method.

### Reading History

```python
get_history() -> list[dict]
```

Returns a **copy** of the history list. Callers cannot mutate the internal
state through this reference.

### Replacing History

```python
set_history(messages: list[dict]) -> None
```

Replaces the entire history. Used after compaction or when loading a
previous session. Takes a copy of the input list.

### Clearing History

```python
clear_history() -> None
```

Empties the history list **and** purges all `history:*` entries from the
stability tracker. Called on explicit user reset or new session.

### Re-registering After Compaction

```python
reregister_history_items() -> None
```

Removes all `history:*` entries from the stability tracker without clearing
the full history. After compaction replaces messages, the old stability
entries are stale — this method lets new entries register cleanly on the
next request cycle.

### Token Count

```python
history_token_count() -> int
```

Returns the token count of the current history using `TokenCounter`. Returns
`0` for empty history.

## File Context

`ContextManager` exposes its `FileContext` instance as `self.file_context`.
This tracks files included in the conversation with their contents.

### FileContext API

| Method | Description |
|--------|-------------|
| `add_file(filepath, content=None)` | Add file. Reads from disk if content is `None`. |
| `remove_file(filepath) -> bool` | Remove file. Returns whether it was present. |
| `get_files() -> list[str]` | List file paths in context. |
| `get_content(filepath) -> str \| None` | Get content of a specific file. |
| `has_file(filepath) -> bool` | Check membership. |
| `clear()` | Remove all files. |
| `format_for_prompt() -> str` | Format all files as fenced code blocks. |
| `count_tokens(counter) -> int` | Total tokens across all files. |
| `get_tokens_by_file(counter) -> dict` | Per-file token counts. |

Paths are normalized to relative paths from `repo_root` where possible.
Absolute paths outside the repo are stored as-is.

## Token Counting

`ContextManager` exposes token counting both through the `TokenCounter`
instance and through convenience methods:

```python
count_tokens(content) -> int
```

Delegates to `TokenCounter.count()`. Accepts strings, message dicts, or
lists of message dicts.

### TokenCounter Details

`TokenCounter` wraps `litellm.token_counter()` with:

- **Model-aware counting**: Uses the model name to select the correct
  tokenizer.
- **Fallback**: On any error, estimates ~4 characters per token.
- **Model info caching**: `max_input_tokens` and `max_output_tokens` are
  loaded once from `litellm.get_model_info()` with defaults of 128K input
  and 4K output if the model is unknown.
- **Multiple input types**: Strings counted via `text=`, message dicts/lists
  via `messages=`.

### format_tokens

```python
format_tokens(count: int) -> str
```

Utility function (not a method) that formats token counts for display:
`1500` → `"1.5K"`, `500` → `"500"`.

## Cache Stability Tracker

The `cache_stability` attribute is a `StabilityTracker` instance (or `None`
if `repo_root` was not provided). It tracks how consistently items appear
across requests and assigns them to cache tiers (`L0`–`L3` plus `active`).

The context manager does not drive stability updates directly — that
responsibility belongs to `StreamingMixin._update_cache_stability()`. The
context manager provides:

- **Ownership**: Creates and holds the tracker instance.
- **Cleanup**: `clear_history()` purges `history:*` entries.
  `reregister_history_items()` purges them without clearing history.
- **Access**: Other components read `context_manager.cache_stability`
  directly.

See [Cache Management](cache_management.md) for tier promotion rules and
[History Compaction](history_compaction.md) for post-compaction
re-registration.

## Compaction Integration

The context manager wraps `HistoryCompactor` with convenience methods:

### should_compact

```python
should_compact() -> bool
```

Returns `True` if compaction is enabled and history tokens exceed the
trigger threshold. Returns `False` if compaction is disabled or the
compactor is not initialized.

### compact_history_if_needed (async)

```python
async compact_history_if_needed() -> CompactionResult | None
```

Runs compaction if `should_compact()` is true. On success, replaces
internal `_history` with the compacted messages. Returns the
`CompactionResult` or `None` if compaction was not needed.

### compact_history_if_needed_sync

```python
compact_history_if_needed_sync() -> CompactionResult | None
```

Synchronous wrapper. Used by `StreamingMixin._run_post_response_compaction()`
which runs in a thread executor.

### get_compaction_status

```python
get_compaction_status() -> dict
```

Returns a status dict for UI display:

```python
{
    "enabled": True,
    "history_tokens": 5200,
    "trigger_threshold": 6000,
    "percent_used": 86
}
```

If compaction is disabled, returns `enabled: False` with zero thresholds.

## Token Budget Reporting

### get_token_budget

```python
get_token_budget() -> dict
```

Returns budget information:

```python
{
    "history_tokens": 3200,
    "max_history_tokens": 8000,    # max_input // 16
    "max_input_tokens": 128000,
    "remaining": 124800,
    "needs_summary": False          # delegates to should_compact()
}
```

### get_token_report

```python
get_token_report(
    system_prompt: str = "",
    symbol_map: str = "",
    read_only_files: list[str] = None
) -> str
```

Generates a detailed multi-line token report (inspired by aider's
`/tokens` command). Breaks down token usage by:

- System messages
- Chat history
- Symbol map
- Individual files in context (with token counts per file)
- Read-only files

Includes a total, remaining budget, and warnings when close to or
exceeding the context window.

## HUD Output

Two terminal output methods for development/debugging:

### print_hud

```python
print_hud(
    system_tokens: int = 0,
    symbol_map_tokens: int = 0,
    file_tokens: int = 0,
    extra_info: dict = None
) -> None
```

Prints a full-width terminal HUD with token breakdown, progress bar,
message count, file count, and session totals (if `token_tracker` is
available). Includes cache hit/write info from the last request.

### print_compact_hud

```python
print_compact_hud() -> None
```

Single-line summary: history tokens, message count, session total, and
compaction warning if needed.

## Lifecycle

### Session Start

1. `LiteLLM.__init__()` creates `ContextManager` with model, repo root,
   cache target tokens, and compaction config.
2. Stability tracker starts empty — tiers rebuild from the reference graph
   on the first streaming request.
3. History is empty.

### During Conversation

1. `StreamingMixin._stream_chat()` calls `add_message()` for each
   user/assistant exchange.
2. `_update_cache_stability()` reads and updates `cache_stability`.
3. `_run_post_response_compaction()` calls `should_compact()` and
   `compact_history_if_needed_sync()`.

### Session Reset

`LiteLLM.clear_history()` calls `context_manager.clear_history()` +
`history_store.new_session()`. This clears in-memory history and stability
tracker history entries, and starts a new persistent session.

### Loading a Previous Session

`load_session_into_context()` in `HistoryMixin`:
1. Calls `context_manager.clear_history()`.
2. Reads messages from `HistoryStore`.
3. Calls `context_manager.add_message()` for each.
4. Returns the loaded history via `context_manager.get_history()`.
