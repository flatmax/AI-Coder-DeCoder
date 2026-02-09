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

### LLM Config

```pseudo
{
    env: { ENV_VAR: "value" },        // Environment variables to set
    model: "provider/model-name",      // Primary LLM model
    smaller_model: "provider/model",   // Faster/cheaper model for tasks like commit messages
    cache_min_tokens: 1024,            // Minimum tokens for a cache block
    cache_buffer_multiplier: 1.5       // Safety margin on cache threshold
}
```

**Cache target tokens** = `cache_min_tokens × cache_buffer_multiplier` (default: 1536)

### App Config

```pseudo
{
    url_cache: {
        path: "/tmp/url_cache",        // Cache directory
        ttl_hours: 24                  // Expiration
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

Only these types are accepted — arbitrary file paths are rejected.

### RPC Methods

| Method | Description |
|--------|-------------|
| `get_config_content(type)` | Read a config file |
| `save_config_content(type, content)` | Write a config file |
| `reload_llm_config()` | Hot-reload LLM config and apply |
| `reload_app_config()` | Hot-reload app config |
| `get_config_info()` | Current model names and config paths |

### Config Editing Flow

1. User clicks Edit in settings panel
2. Config content loaded into the diff viewer
3. User edits and saves (Ctrl+S)
4. Content written via `save_config_content`
5. User clicks Reload to apply changes
