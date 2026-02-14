# Configuration

## Overview

Configuration is split across multiple files, each serving a distinct purpose. A settings service provides RPC methods for the webapp to read, edit, and reload configs. For packaged builds, configs are copied to a persistent user directory on first run.

## Config Files

| File | Purpose | Format |
|------|---------|--------|
| LLM config | Provider settings (model, env vars, cache tuning) | JSON |
| App config | Application settings (URL cache, history compaction) | JSON |
| System prompt | Main LLM instructions | Markdown |
| Extra prompt | Additional instructions appended to system prompt | Markdown |
| Prompt snippets | Quick-insert buttons for the UI | JSON |
| Compaction skill prompt | Template for history compaction summarization | Markdown |
| Review system prompt | System instructions for code review mode | Markdown |
| Review snippets | Quick-insert buttons for review mode UI | JSON |

### LLM Config

```pseudo
{
    env: { ENV_VAR: "value" },
    model: "provider/model-name",
    smaller_model: "provider/model",
    cache_min_tokens: 1024,
    cache_buffer_multiplier: 1.5
}
```

**Cache target tokens** = `cache_min_tokens × cache_buffer_multiplier` (default: 1536)

### App Config

```pseudo
{
    url_cache: {
        path: "/tmp/url_cache",
        ttl_hours: 24
    },
    history_compaction: {
        enabled: true,
        compaction_trigger_tokens: 24000,
        verbatim_window_tokens: 4000,
        summary_budget_tokens: 500,
        min_verbatim_exchanges: 2
    }
}
```

### Prompt Snippets

```pseudo
{
    snippets: [
        {
            icon: "✂️",
            tooltip: "Continue truncated edit",
            message: "Your last edit was truncated, please continue."
        }
    ]
}
```

Default snippets: ✂️ Continue truncated edit, 🔍 Check context, ✏️ Fix malformed edits, ⏸️ Pause before implementing, ✅ Verify tests, 📦 Pre-commit checklist, 🏁 Pre-commit with plan completion.

## Config Directory Resolution

### Development Mode

Config directory relative to the application source.

### Packaged Builds

1. Bundled configs embedded in the executable
2. On first run, copied to persistent user directory (platform-specific: `~/.config/app/`, `%APPDATA%/app/`, etc.)
3. Subsequent runs: only new files from updates are copied (existing files not overwritten)
4. All reads go to user directory so edits persist

## Loading and Caching

- **App config** — loaded once and cached in memory; force-reload available
- **LLM config** — read on init and on explicit reload; env vars applied on load
- **System prompts** — read fresh from files; concatenated at assembly time
- **Snippets** — loaded on request with two-location fallback: `{repo_root}/.ac-dc/snippets.json` first, then app config directory `snippets.json`

## Settings Service (RPC)

A whitelisted set of config types can be read, written, and reloaded:

| Key | Description |
|-----|-------------|
| `litellm` | LLM provider config |
| `app` | Application settings |
| `snippets` | Prompt snippet buttons |
| `system` | Main system prompt |
| `system_extra` | Extra system prompt |
| `compaction` | Compaction skill prompt |
| `review` | Review system prompt |
| `review_snippets` | Review snippet buttons |

Only these types are accepted — arbitrary file paths are rejected.

### Testing

- Creates `.ac-dc/` directory and `.gitignore` entry on init; no duplicate entries
- Default LLM and app configs contain expected keys
- Save and read-back round-trip for config content
- Invalid config type key rejected with error
- Cache target tokens computed from defaults (1024 × 1.5 = 1536)
- Snippets fallback returns non-empty list
- System prompt assembly returns non-empty string

### RPC Methods

| Method | Description |
|--------|-------------|
| `Settings.get_config_content(type)` | Read a config file |
| `Settings.save_config_content(type, content)` | Write a config file |
| `Settings.reload_llm_config()` | Hot-reload LLM config and apply |
| `Settings.reload_app_config()` | Hot-reload app config |
| `Settings.get_config_info()` | Current model names and config paths |
| `Settings.get_snippets()` | Load prompt snippets |

### Config Editing Flow

1. User clicks Edit in settings panel
2. Config content loaded into the diff viewer
3. User edits and saves (Ctrl+S)
4. Content written via `save_config_content`
5. User clicks Reload to apply changes

## `.ac-dc/` Directory

A per-repository working directory at `{repo_root}/.ac-dc/`. Created on first run and added to `.gitignore`.

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `history.jsonl` | Persistent conversation history | Append-only |
| `symbol_map.txt` | Current symbol map | Rebuilt on startup and before each LLM request |
| `snippets.json` | Per-repo prompt snippets (optional) | User-managed |
| `images/` | Persisted chat images | Write on paste, read on session load |