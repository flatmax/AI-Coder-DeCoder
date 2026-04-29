# Reference: Context Model

**Supplements:** `specs4/3-llm/context-model.md`

## Numeric constants

### Pre-request shedding threshold

```
0.90 (90% of max_input_tokens)
```

Before assembling the prompt, if total estimated tokens exceed 90% of `max_input_tokens`, files are dropped from context (largest first) until the total drops below threshold or no files remain. Applied in `shed_files_if_needed()`.

Threshold is a module constant `_SHED_THRESHOLD_FRACTION = 0.90`, not user-configurable. Tightening (e.g., 0.85) causes shedding on requests that would have succeeded; loosening (e.g., 0.95) causes occasional provider rejections when estimates undercount actual usage.

### Estimate overhead

```
500 tokens
```

Added to every `estimate_request_tokens()` call as a fixed margin for structural content not counted by per-section token counts:

- Section headers (Repository Structure, Working Files, URL Context, etc.)
- Acknowledgement messages ("Ok.", "Ok, I've reviewed...")
- Legend text
- Streaming margin
- Provider-specific framing

Module constant `_BUDGET_ESTIMATE_OVERHEAD = 500`. The shedding decision is relative to `max_input_tokens`, so exact overhead doesn't matter provided it's positive and reasonably representative.

### Emergency truncation multiplier

```
2 × compaction_trigger_tokens
```

If compaction fails AND history exceeds this threshold, oldest messages are dropped without summarization via `emergency_truncate()`. The method drops messages until history is back at `compaction_trigger_tokens`, not at zero — goal is restoring the comfortable operating zone, not stripping all history.

When `compaction_trigger_tokens` is zero (compaction disabled), emergency truncation is a no-op. Prevents stripping history when the user has explicitly opted out of compaction.

### Verbatim-window-shrink monotonicity

When the history compactor's `verbatim_window_tokens` is reduced (via hot-reload of app config), the message count of the verbatim window monotonically decreases or stays equal — never increases. Tested but not a user-configurable constant.

### Compaction status percent cap

```
999
```

`get_compaction_status()` returns `percent` capped at 999 for display sanity. A pathological token-to-trigger ratio (e.g., history at 20× the trigger) would otherwise produce a four-digit percent that overflows the UI progress bar rendering.

## Schemas

### Token budget response

`get_token_budget()` returns:

```pseudo
{
    history_tokens: int,          # current history token count
    max_history_tokens: int,      # max_input_tokens / 16
    max_input_tokens: int,        # from TokenCounter
    remaining: int,               # max_input_tokens - estimated_total
    needs_summary: bool            # delegates to compactor.should_compact()
}
```

When no compactor is attached, `needs_summary` is always `False`.

### Compaction status response

`get_compaction_status()` returns:

```pseudo
{
    enabled: bool,                # from compactor config
    trigger_tokens: int,           # from compactor config
    current_tokens: int,           # current history token count
    percent: int                   # clamp(current/trigger*100, 0, 999)
}
```

When no compactor is attached, `enabled` is `False` and `trigger_tokens` is 0.

### Message dict shape (in-memory working copy)

Messages in the context manager's history list are plain dicts:

```pseudo
Message:
    role: "user" | "assistant"
    content: str | list[ContentBlock]
    system_event: bool?            # present only when true
    # Additional keys forwarded from add_message(**extra) — e.g.,
    # files, edit_results, image_refs — stored verbatim but not
    # interpreted by the context manager
```

Multimodal `content` is a list of content blocks (see `specs-reference/3-llm/streaming.md` for block shapes).

## Dependency quirks

### System reminder prepends with blank lines

`config.get_system_reminder()` returns the reminder file's content prefixed with `\n\n`. The streaming handler appends this directly to the user prompt text:

```python
augmented_message = message + config.get_system_reminder()
```

An empty reminder file produces an empty string (no leading newlines). A non-empty file produces `\n\n{content}` which guarantees a blank line separates the user's prompt from the reminder, regardless of how the user ended their message.

Implementers adding newlines in the caller produce double-blank-line separation (harmless but noisy). Omitting the prepend when the file starts with text produces cramped prompts (reminder runs into the last line of the user's message).

### Mode enum subclasses str

`Mode(str, Enum)` — members compare equal to their string values:

```python
Mode.CODE == "code"   # True
Mode.DOC == "doc"     # True
```

This lets downstream dispatch (RPC handlers, tier builder, UI state) work with either enum members or plain strings without explicit coercion. The round-trip `Mode("code") → Mode.CODE` is how `set_mode("code")` resolves user-supplied strings.

Unknown strings raise `ValueError` in the enum constructor — `set_mode` catches this and produces a user-friendly error rather than propagating the exception.

## Cross-references

- Behavioral history operations, mode swap, stability tracker attachment, lifecycle: `specs4/3-llm/context-model.md`
- Compaction algorithm and config defaults: `specs-reference/3-llm/history.md` § Compaction config defaults
- Prompt assembly header constants and acknowledgement text: `specs-reference/3-llm/prompt-assembly.md`
- Token counter constants: `specs-reference/1-foundation/configuration.md` § Token counter defaults
- Cache tier target computation (used by shedding): `specs-reference/3-llm/cache-tiering.md`