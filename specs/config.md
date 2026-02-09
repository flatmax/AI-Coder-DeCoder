# Configuration

## Overview

Configuration is split across multiple files in the `config/` directory, each serving a distinct purpose. A `Settings` class provides RPC methods for the webapp to read, edit, and reload configs. For frozen (PyInstaller) builds, configs are copied to a persistent user directory on first run.

## Config Files

| File | Purpose | Format |
|------|---------|--------|
| `config/litellm.json` | LLM provider settings (model, env vars, cache tuning) | JSON |
| `config/app.json` | Application settings (URL cache, history compaction) | JSON |
| `config/prompts/system.md` | System prompt sent to the LLM | Markdown |
| `config/prompts/system_extra.md` | Additional system prompt appended after `system.md` | Markdown |
| `config/prompts/prompt-snippets.json` | Quick-insert prompt buttons for the UI | JSON |
| `config/prompts/skills/compaction.md` | Prompt template for history compaction summarization | Markdown |

### `litellm.json`

```json
{
  "env": {
    "AWS_REGION": "ap-northeast-2"
  },
  "model": "bedrock/global.anthropic.claude-opus-4-6-v1",
  "smallerModel": "bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0",
  "cacheMinTokens": 1024,
  "cacheBufferMultiplier": 1.5
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `env` | `object` | `{}` | Environment variables to set (e.g. AWS credentials) |
| `model` | `string` | — | Primary LLM model identifier (litellm format) |
| `smallerModel` | `string` | — | Faster/cheaper model for commit messages etc. |
| `cacheMinTokens` | `int` | `1024` | Minimum tokens for a cache block |
| `cacheBufferMultiplier` | `float` | `1.5` | Safety margin multiplier on cache threshold |

The cache target tokens = `cacheMinTokens × cacheBufferMultiplier` (default: 1536).

### `app.json`

```json
{
  "url_cache": {
    "path": "/tmp/ac-dc_url_cache",
    "ttl_hours": 24
  },
  "history_compaction": {
    "enabled": true,
    "compaction_trigger_tokens": 24000,
    "verbatim_window_tokens": 4000,
    "summary_budget_tokens": 500,
    "min_verbatim_exchanges": 2
  }
}
```

#### `url_cache` Section

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `path` | `string` | `"/tmp/ac_url_cache"` | Directory for cached URL fetches |
| `ttl_hours` | `int` | `24` | Hours before cached URLs expire |

#### `history_compaction` Section

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | `bool` | `true` | Whether automatic compaction is active |
| `compaction_trigger_tokens` | `int` | `24000` | Token count that triggers compaction |
| `verbatim_window_tokens` | `int` | `4000` | Recent tokens kept verbatim (not summarized) |
| `summary_budget_tokens` | `int` | `500` | Target size for the summary of older messages |
| `min_verbatim_exchanges` | `int` | `2` | Minimum recent exchanges always kept verbatim |

### `system.md`

The main system prompt. Defines the LLM's role, edit protocol, symbol map navigation instructions, and failure recovery. This is loaded at the start of every conversation and placed in the first message.

### `system_extra.md`

Appended after `system.md`. Used for project-specific instructions that should not modify the core prompt. Loaded by `load_extra_prompt()` and concatenated by `build_system_prompt()`.

### `prompt-snippets.json`

Quick-insert buttons displayed in the prompt UI.

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

| Field | Type | Description |
|-------|------|-------------|
| `icon` | `string` | Emoji displayed on the button |
| `tooltip` | `string` | Hover text |
| `message` | `string` | Text inserted into the prompt input when clicked |

Loaded via `LiteLLM.get_prompt_snippets()` RPC and rendered as buttons above the input area.

## Config Directory Resolution

### Development Mode

Config directory is `<repo_root>/config/`.

### Frozen Builds (PyInstaller)

1. Bundled configs are embedded in the executable under `<MEIPASS>/config/`
2. On first run, `ensure_user_config()` copies them to a persistent user directory:
   - Linux/macOS: `~/.config/ac-dc/`
   - Windows: `%APPDATA%/ac-dc/`
3. On subsequent runs, only new files from updates are copied (existing user files are not overwritten)
4. All reads go to the user directory, so edits persist across updates

The resolution is handled by `get_config_dir()` in `ac/config.py`.

## Loading and Caching

### `app.json` (`ac/config.py`)

- `load_app_config(config_path?, force_reload?)` loads and caches the config
- Cached in module-level `_cached_config` — only reloaded on `force_reload=True` or different path
- Helper accessors: `get_url_cache_config()`, `get_history_compaction_config()`, `is_compaction_enabled()`

### `litellm.json` (`ac/llm/config.py`)

- `ConfigMixin._load_config(config_path?)` reads the file (no module-level cache)
- `ConfigMixin._apply_env_vars()` sets environment variables from the `env` section
- Cache tuning accessors: `get_cache_min_tokens()`, `get_cache_buffer_multiplier()`, `get_cache_target_tokens()`
- Compaction config delegates to `ac/config.py`

### System Prompts (`ac/prompts/loader.py`)

- `load_system_prompt()` reads `system.md`
- `load_extra_prompt()` reads `system_extra.md` (returns `None` if missing)
- `build_system_prompt()` concatenates both with a separator

## Settings Management (RPC)

The `Settings` class (`ac/settings.py`) is registered with JRPC and provides config management to the webapp.

### Whitelisted Config Types

| Key | File Path |
|-----|-----------|
| `litellm` | `litellm.json` |
| `app` | `app.json` |
| `snippets` | `prompts/prompt-snippets.json` |
| `system` | `prompts/system.md` |
| `system_extra` | `prompts/system_extra.md` |
| `compaction` | `prompts/skills/compaction.md` |

Only these types are accepted — arbitrary file paths are rejected.

### RPC Methods

| Method | Args | Returns | Description |
|--------|------|---------|-------------|
| `Settings.get_config_content` | `config_type` | `{ success, content, path }` | Read a config file |
| `Settings.save_config_content` | `config_type, content` | `{ success, path }` | Write a config file |
| `Settings.reload_llm_config` | — | `{ success, model, smaller_model }` | Reload `litellm.json` and apply |
| `Settings.reload_app_config` | — | `{ success, message }` | Reload `app.json` (force cache clear) |
| `Settings.get_config_info` | — | `{ success, model, smaller_model, config_paths }` | Current config summary |

### Settings Panel UI

`SettingsPanel` (`webapp/src/settings/SettingsPanel.js`) renders config management controls:

- Displays current model names from `get_config_info`
- **Edit** buttons dispatch `config-edit-request` events — `AppShell` loads the config file into the diff viewer with a `[config]/` path prefix and `isConfig: true` metadata
- **Reload** buttons call `reload_llm_config` or `reload_app_config` and show toast messages
- Toast messages auto-dismiss after 3 seconds

### Config Editing Flow

1. User clicks "Edit" on a config type in the Settings panel
2. `SettingsPanel` dispatches `config-edit-request` with `{ configType }`
3. `AppShell.handleConfigEditRequest` calls `Settings.get_config_content` via RPC
4. Response content is loaded into the diff viewer as `[config]/<configType>`
5. User edits in Monaco and presses Ctrl+S
6. `DiffViewer` dispatches `file-save` with `{ isConfig: true, configType }`
7. `AppShell.handleFileSave` routes to `Settings.save_config_content`
8. User clicks "Reload" to apply changes without restart
