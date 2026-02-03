# Plan: LLM Config Settings UI

## Overview

Add a settings tab to the webapp left panel (alongside files/search/context/cache) that allows users to open config files in the OS default editor and reload configurations.

## Goals

1. Settings tab with gear icon in PromptView left panel header
2. List editable config files with "Open in Editor" buttons
3. "Reload LLM Config" button to re-read llm.json and apply changes
4. "Reload App Config" button to refresh app.json settings

## Non-Goals

- Building a custom config editor UI in the webapp
- Creating new config files (use existing bundled configs)
- Editing files within the webapp

## Config Files

All config files are bundled with the application:

| File | Purpose | Reload Behavior |
|------|---------|-----------------|
| `config/llm.json` | LLM model, env vars, cache settings | Requires explicit reload |
| `config/app.json` | URL cache, history compaction settings | Requires explicit reload |
| `config/prompt-snippets.json` | Prompt snippet buttons | Live-reloaded (reads on each use) |
| `config/prompts/system.md` | System prompt | Live-reloaded (reads on each use) |
| `config/prompts/system_extra.md` | Extra system prompt | Live-reloaded (reads on each use) |
| `config/prompts/skills/compaction.md` | Compaction skill prompt | Live-reloaded (reads on each use) |

## Current Config Loading Analysis

### llm.json
- Loaded in `LiteLLM.__init__()` via `ConfigMixin._load_config()`
- Stored in `self.config`, `self.model`, `self.smaller_model`
- `_apply_env_vars()` sets environment variables from `config.env`
- **Reload approach:** Add `reload_config()` method to `LiteLLM` that:
  1. Re-reads llm.json
  2. Updates `self.config`
  3. Calls `_apply_env_vars()` to update env vars
  4. Updates `self.model` and `self.smaller_model`
  - No restart needed - LiteLLM library uses model string per-request

### app.json
- Loaded via `load_app_config()` in `ac/config.py`
- Cached in module-level `_cached_config`
- Consumers:
  - `StabilityTracker` - stores `_cache_target_tokens` at init (won't auto-update)
  - `URLConfig.load()` - calls `load_app_config()` each time (will get fresh values)
  - `get_history_compaction_config()` - calls `load_app_config()` (will get fresh values)
- **Reload approach:** Call `load_app_config(force_reload=True)` to clear cache
- **Limitation:** StabilityTracker's `_cache_target_tokens` won't update until next session. Document this - most settings take effect immediately, but cache tier thresholds may need restart.

## Architecture

### Backend: New Settings Class

Create a new `Settings` class in `ac/settings.py` that:
- Is registered with JRPC (like `Repo` and `LiteLLM`)
- Holds a reference to the `LiteLLM` instance (to call its reload method)
- Provides RPC methods for config operations

```python
class Settings:
    def __init__(self, llm: 'LiteLLM'):
        self._llm = llm
    
    def open_config_file(self, config_type: str) -> dict:
        """Open a config file in OS default editor."""
        ...
    
    def reload_llm_config(self) -> dict:
        """Reload LLM configuration from llm.json."""
        return self._llm.reload_config()
    
    def reload_app_config(self) -> dict:
        """Reload app configuration from app.json."""
        ...
    
    def get_config_info(self) -> dict:
        """Get current configuration info for display."""
        ...
```

### Frontend: SettingsPanel Component

`SettingsPanel` extends `LitElement` with `RpcMixin`:
- Embedded in `PromptView` like other panels (`CacheViewer`, `FindInFiles`, etc.)
- Uses `RpcMixin` to call `Settings.*` RPC methods
- No need to extend `JRPCClient` directly

```javascript
import { LitElement, html } from 'lit';
import { RpcMixin } from '../utils/rpc.js';

export class SettingsPanel extends RpcMixin(LitElement) {
  async openConfig(configType) {
    const result = await this._rpc('Settings.open_config_file', configType);
    // handle result
  }
  
  async reloadLlmConfig() {
    const result = await this._rpc('Settings.reload_llm_config');
    // handle result  
  }
}
```

## Design

### UI Changes

**PromptView Left Panel:**
- Add "settings" tab (gear icon ⚙️) alongside files/search/context/cache
- Settings panel shows:
  - Section: "LLM Configuration"
    - Current model name (readonly display)
    - "Open llm.json" button → opens in OS editor
    - "Reload" button → re-reads config and applies changes
  - Section: "App Configuration"  
    - "Open app.json" button → opens in OS editor
    - "Reload" button → clears config cache
    - Note: "Some settings may require restart"
  - Section: "Prompts (live-reloaded)"
    - "Open system.md" button
    - "Open system_extra.md" button
    - "Open prompt-snippets.json" button
  - Section: "Skills (live-reloaded)"
    - "Open compaction.md" button

### Backend Changes

**New: ac/settings.py:**
- `Settings` class with JRPC methods:
  - `open_config_file(config_type)` - opens specified config in OS editor
  - `reload_llm_config()` - delegates to LiteLLM.reload_config()
  - `reload_app_config()` - clears app config cache
  - `get_config_info()` - returns current model and config paths

**ac/llm/config.py:**
- Add `open_in_editor(file_path)` - utility to open file in OS default editor
- Add `get_config_paths()` - returns dict of all config file paths

**ac/llm/llm.py:**
- Add `reload_config()` method to re-read llm.json and apply changes

**ac/config.py:**
- Add `reload_app_config()` wrapper function

**ac/dc.py:**
- Register `Settings` class with JRPC server

### Opening OS Editor

```python
import subprocess
import platform
import os
from pathlib import Path

def open_in_editor(file_path: Path) -> dict:
    """Open file in OS default editor."""
    if not file_path.exists():
        return {"success": False, "error": f"File not found: {file_path}"}
    
    system = platform.system()
    try:
        if system == 'Darwin':  # macOS
            subprocess.Popen(['open', str(file_path)])
        elif system == 'Windows':
            os.startfile(str(file_path))
        else:  # Linux/Unix
            editor = os.environ.get('EDITOR', 'xdg-open')
            subprocess.Popen([editor, str(file_path)])
        return {"success": True, "path": str(file_path)}
    except Exception as e:
        return {"success": False, "error": str(e)}
```

### Frontend Changes

**webapp/src/PromptView.js:**
- Add 'settings' to `activeLeftTab` options

**webapp/src/prompt/PromptViewTemplate.js:**
- Add settings tab icon to tab bar
- Render settings panel when tab is active

**webapp/src/settings/SettingsPanel.js:**
- Settings panel component with config sections
- Buttons for open/reload actions
- Display current config values

**webapp/src/settings/SettingsPanelStyles.js:**
- Styles for the settings panel

**webapp/src/settings/SettingsPanelTemplate.js:**
- Template rendering for settings panel

## Implementation Steps

### Phase 1: Backend - Settings Class
1. Create `ac/settings.py` with `Settings` class
2. Add `open_in_editor()` utility to `ac/llm/config.py`
3. Add `get_config_paths()` function to `ac/llm/config.py`
4. Add `reload_app_config()` wrapper to `ac/config.py`
5. Add `reload_config()` method to `LiteLLM`
6. Register `Settings` with JRPC in `ac/dc.py`

### Phase 2: Frontend - Settings Tab
1. Add 'settings' tab option to PromptView
2. Add gear icon to tab bar in PromptViewTemplate.js
3. Create SettingsPanel.js component with sections for each config type
4. Create SettingsPanelStyles.js with appropriate styling
5. Create SettingsPanelTemplate.js with render functions
6. Wire up RPC calls for open/reload buttons
7. Display current model name and reload status messages

### Phase 4: Testing
1. Test editor opening on macOS and Linux
2. Test LLM config reload picks up new model name
3. Test LLM config reload applies new env vars
4. Test app config reload clears cache
5. Test UI displays correct current config info
6. Test error handling for missing files or parse errors

## File Changes

### New Files
- `ac/settings.py` - Settings class with JRPC methods
- `webapp/src/settings/SettingsPanel.js` - Settings panel component
- `webapp/src/settings/SettingsPanelStyles.js` - Styles
- `webapp/src/settings/SettingsPanelTemplate.js` - Template

### Modified Files
- `ac/llm/config.py` - Add `open_in_editor()`, `get_config_paths()`
- `ac/llm/llm.py` - Add `reload_config()` method
- `ac/config.py` - Add `reload_app_config()` wrapper
- `ac/dc.py` - Register Settings class with JRPC
- `webapp/src/PromptView.js` - Add 'settings' to activeLeftTab options
- `webapp/src/prompt/PromptViewTemplate.js` - Add settings tab icon and panel rendering

## Edge Cases

1. **Editor not found (Linux):** Return error with file path so user can edit manually
2. **Config syntax error after edit:** Catch JSON parse error on reload, show error message, keep previous config working
3. **LLM reload with invalid model:** Catch LiteLLM error on next request, show error message
4. **File permissions:** Return error if file can't be opened
5. **StabilityTracker cache threshold:** Document that this setting requires restart to take effect

## UI Mockup

```
┌─────────────────────────────────────┐
│ [📁] [🔍] [📊] [💾] [⚙️]           │  ← Tab bar with settings icon
├─────────────────────────────────────┤
│ Settings                            │
│                                     │
│ LLM Configuration                   │
│ ┌─────────────────────────────────┐ │
│ │ Model: claude-opus-4-5-...      │ │
│ │ [Open llm.json] [Reload]        │ │
│ └─────────────────────────────────┘ │
│                                     │
│ App Configuration                   │
│ ┌─────────────────────────────────┐ │
│ │ [Open app.json] [Reload]        │ │
│ │ ⓘ Some settings require restart │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Prompts (live-reloaded)             │
│ ┌─────────────────────────────────┐ │
│ │ [system.md]                     │ │
│ │ [system_extra.md]               │ │
│ │ [prompt-snippets.json]          │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Skills (live-reloaded)              │
│ ┌─────────────────────────────────┐ │
│ │ [compaction.md]                 │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```
