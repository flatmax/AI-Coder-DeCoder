# Prompt Construction

This spec covers how system prompts, extra prompts, skill prompts, and
prompt snippets are loaded, assembled, and injected into LLM requests.

## Prompt Files

All prompt content lives under `config/prompts/`:

```
config/prompts/
├── system.md                  # Main system prompt
├── system_extra.md            # Optional extra instructions
├── prompt-snippets.json       # Quick-insert buttons for the UI
└── skills/
    └── compaction.md          # Skill prompt for history compaction
```

## System Prompt

### Loading

`ac/prompts/loader.py` provides three functions:

```python
load_system_prompt() -> str        # Load config/prompts/system.md
load_extra_prompt() -> str | None  # Load config/prompts/system_extra.md
build_system_prompt() -> str       # Combine both
```

**`load_system_prompt()`** reads `config/prompts/system.md` from the
repository root. Raises `FileNotFoundError` if the file does not exist.

**`load_extra_prompt()`** reads `config/prompts/system_extra.md`. Returns
`None` if the file does not exist — the extra prompt is optional.

**`build_system_prompt()`** concatenates the two:

```
<system.md content>

<system_extra.md content>     ← only if file exists
```

Separated by `\n\n`. This is the function called by all LLM request paths.

### Repository Root Resolution

The loader finds the repo root by walking up from `ac/prompts/loader.py`
(two parent directories). In PyInstaller bundles, it uses `sys._MEIPASS`
or `sys.executable` parent instead.

### Content

`system.md` contains the full agent instructions:

1. **Role** — Expert coding agent with symbol map navigation.
2. **Symbol Map** — How to read the map notation (`←refs`, `i→` imports,
   kind prefixes). Rules for inherited methods, excluded files, requesting
   files.
3. **Edit Protocol** — The EDIT/REPL block format with examples. Critical
   rules about no markdown fencing, exact matching, context in both
   sections, edit sizing, and sequential dependency merging.
4. **Workflow** — Query → Search Map → Trace → Request files → Edit.
   Pre-edit checklist. Never-edit-unseen-files rule.
5. **Examples** — Modify, insert, create, edit-with-backticks examples.
6. **Failure Recovery** — Steps for retrying failed edits.

`system_extra.md` contains lightweight behavioral guidance:
- Request files before modifying them.
- Be lean but understandable.

## System Reminder

`ac/prompts/system_reminder.py` contains `SYSTEM_REMINDER`, a standalone
string with the EDIT/REPL format rules. This is a compact mechanical
reference for the edit block format — shorter than the full system prompt's
edit protocol section.

```python
get_system_reminder(go_ahead_tip: str = "") -> str
```

Returns the reminder text, optionally appending a tip string. The reminder
is defined in Python code (not loaded from a file) for simplicity.

> **Note:** The system reminder is currently defined but not injected into
> streaming requests — `_build_streaming_messages()` uses only
> `build_system_prompt()`. The reminder exists as infrastructure for
> potential mid-conversation reinforcement of edit format rules.

## Commit Message Prompt

`ac/llm/chat.py` defines `COMMIT_SYSTEM_PROMPT` as an inline Python string.
This is a separate system prompt used only for `get_commit_message()` calls:

- Role: Expert software engineer for git commit messages.
- Format: `<type>: <subject>\n\n<body>` with conventional commit types.
- Rules: Imperative mood, 50-char subject, 72-char body wrap.
- Output: Commit message only, no commentary.

This prompt is not assembled from files — it is a constant in the chat
module. It does not use `build_system_prompt()` or any of the prompt
loading infrastructure.

## Skill Prompts

Skill prompts are markdown files under `config/prompts/skills/` loaded by
the subsystems that need them. Currently:

### compaction.md

Loaded by `TopicDetector._load_compaction_prompt()` using the same
repo-root resolution as the main prompt loader. Contains instructions for
the topic boundary detection LLM call — see
[History Compaction](history_compaction.md).

Skill prompts are loaded lazily on first use and are independent of the
main system prompt pipeline.

## Message Assembly

The system prompt is injected into LLM messages by
`StreamingMixin._build_streaming_messages()`. The assembly flow:

```
build_system_prompt()
    → system.md + system_extra.md

L0 block content:
    system_text                     ← from build_system_prompt()
    + REPO_MAP_HEADER + legend      ← symbol map legend (if present)
    + L0 symbol map entries         ← stable symbols
    + L0 files                      ← stable file contents
    + L0 history messages           ← stable conversation turns

→ messages[0] = {role: "system", content: L0 block}
```

The system prompt is always the first content in the L0 cache block.
Subsequent tiers (L1–L3, active) are user/assistant message pairs — they
do not contain system prompt content.

See [Streaming Chat](streaming_chat.md) and
[Cache Management](cache_management.md) for the full message structure.

## Prompt Snippets

Prompt snippets are predefined messages shown as quick-insert buttons in
the webapp UI. They are not part of the LLM system prompt — they are user
convenience features that insert text into the user's input field.

### File Format

`config/prompts/prompt-snippets.json`:

```json
{
  "snippets": [
    {
      "icon": "✂️",
      "tooltip": "Your last edit was truncated",
      "message": "Your last edit was truncated, please continue."
    }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `icon` | Yes | Emoji or character shown on the button |
| `tooltip` | No | Hover text. Falls back to first 50 chars of message. |
| `message` | Yes | Text inserted into the input field when clicked |

### Loading

`LiteLLM.get_prompt_snippets()` loads snippets with a two-location
fallback:

1. **Repo config**: `<repo_root>/config/prompts/prompt-snippets.json`
2. **Aicoder config**: `<aicoder_root>/config/prompts/prompt-snippets.json`

The repo-local file takes precedence, allowing per-project snippet
customization. Each snippet is validated to require at least `icon` and
`message` keys.

### Frontend Integration

`PromptView.loadPromptSnippets()` calls `get_prompt_snippets()` over JRPC
and stores the result. The snippet drawer UI renders each snippet as a
button. Clicking a snippet calls `PromptView.appendSnippet(message)` which
inserts the message text at the cursor position in the input textarea and
auto-resizes it.

The snippet drawer is toggled via a button in the input area and closes on
outside click or Escape keypress.

### Default Snippets

The bundled snippets cover common interaction patterns:

| Icon | Purpose |
|------|---------|
| ✂️ | Continue a truncated edit |
| 🔍 | Remind AI to check its context |
| ✏️ | Correct malformed edit blocks |
| ⏸️ | Pause before implementation |
| ✅ | Verify test coverage |
| 📦 | Pre-commit checklist |
| 🏁 | Pre-commit with plan completion |

## Prompt Exports

`ac/prompts/__init__.py` exports:

```python
from .loader import load_system_prompt, load_extra_prompt, build_system_prompt

__all__ = ['load_system_prompt', 'load_extra_prompt', 'build_system_prompt']
```

`system_reminder.py` is not re-exported from the package — it is imported
directly by consumers that need it.
