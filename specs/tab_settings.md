# Settings Tab Spec

The Settings tab (`TABS.SETTINGS`) provides access to configuration file editing and config reloading. The UI component is `<settings-panel>` and the backend is the `Settings` class.

## Lazy Loading

Imported on first visit:
```
await import('./settings/SettingsPanel.js')
```
Switching to the tab calls `_refreshSettingsPanel()` which invokes `loadConfigInfo()`.

## Component: `<settings-panel>`

Uses `RpcMixin` for RPC access.

### Config info display

On load, `loadConfigInfo()` calls `Settings.get_config_info()` which returns:
- Current model name
- Current smaller model name
- Paths to all config files

### Sections

The panel is organized into four sections rendered by `SettingsPanelTemplate.js`:

#### LLM Section

- Displays the current model and smaller model
- **Edit** button — Opens `litellm.json` in the diff viewer for editing
- **Reload** button — Calls `Settings.reload_llm_config()` to hot-reload the config without restarting. Updates the displayed model names on success.

#### App Section

- **Edit** button — Opens `app.json` in the diff viewer
- **Reload** button — Calls `Settings.reload_app_config()` to reload app configuration. Shows a note that some settings may require restart.

#### Prompts Section

Edit buttons for prompt files (no reload — prompts are read fresh each request):
- `system.md` — Main system prompt
- `system_extra.md` — Additional system prompt content
- `compaction.md` — History compaction skill prompt

#### Snippets Section

- **Edit** button — Opens `prompts/prompt-snippets.json` in the diff viewer

### Config editing flow

1. User clicks an Edit button
2. `editConfig(configType)` dispatches a `config-edit-request` event with `{ configType }`
3. `PromptView` forwards the event to `AppShell`
4. `AppShell.handleConfigEditRequest()`:
   a. Calls `Settings.get_config_content(configType)` to get the file content and path
   b. Loads the content into the diff viewer as both original and modified (so edits show as diffs)
5. User edits in the Monaco diff editor
6. On save, `AppShell.handleFileSave()` calls `Settings.save_config_content(configType, newContent)` followed by `Repo.stage_files([path])`

### Toast messages

Success/error feedback is shown as a temporary toast message (`_showMessage`). Messages auto-dismiss after 3 seconds and can be manually dismissed via `dismissMessage()`.

## Backend: `Settings`

The `Settings` class (`ac/settings.py`) is registered with JRPC as a third server-side class alongside `Repo` and `LiteLLM`.

### Whitelisted configs

A fixed whitelist maps config type keys to relative paths from the config directory:

| Key | Path |
|---|---|
| `litellm` | `litellm.json` |
| `app` | `app.json` |
| `snippets` | `prompts/prompt-snippets.json` |
| `system` | `prompts/system.md` |
| `system_extra` | `prompts/system_extra.md` |
| `compaction` | `prompts/skills/compaction.md` |

Only whitelisted types can be read or written — arbitrary file access is not allowed.

### Methods

#### `get_config_info() -> dict`

Returns current model names and all config file paths. Called when the Settings tab becomes visible.

#### `get_config_content(config_type) -> dict`

Reads and returns the content of a config file. Returns `{ success, content, path, config_type }` or `{ success: false, error }`.

#### `save_config_content(config_type, content) -> dict`

Writes new content to a config file. Returns `{ success, path, config_type }` or `{ success: false, error }`.

#### `reload_llm_config() -> dict`

Delegates to `LiteLLM.reload_config()` which re-reads `litellm.json`, re-applies environment variable overrides, and updates the active model. Returns the new model names so the UI can update without a full refresh.

#### `reload_app_config() -> dict`

Calls `load_app_config(force_reload=True)` to re-read `app.json`. Returns a success message noting that some settings may require a restart to take effect.

### Config directory

The config directory is determined by `_get_config_dir()` in `ac/llm/config.py`, which delegates to `ac/config.py:get_config_dir()`. On first run, `ensure_user_config()` copies bundled defaults to the user config directory.
