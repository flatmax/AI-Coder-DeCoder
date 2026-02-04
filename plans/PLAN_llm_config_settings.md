# Plan: LLM Config Settings UI

## Status: IMPLEMENTED

## Overview

Add a settings tab to the webapp left panel (alongside files/search/context/cache) that allows users to edit config files using an in-app Monaco editor and reload configurations.

## Goals

1. Settings tab with gear icon in PromptView left panel header
2. List editable config files with "Edit" buttons that load into main diff viewer
3. "Reload LLM Config" button to re-read llm.json and apply changes
4. "Reload App Config" button to refresh app.json settings

## Non-Goals

- Creating new config files (use existing bundled configs)
- Opening external editors (using main Monaco diff viewer instead)

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

### Backend: Settings Class

The `Settings` class in `ac/settings.py`:
- Is registered with JRPC (like `Repo` and `LiteLLM`)
- Holds a reference to the `LiteLLM` instance (to call its reload method)
- Provides RPC methods for config operations
- Whitelists allowed config types for security

```python
ALLOWED_CONFIGS = {
    'llm': 'llm.json',
    'app': 'app.json',
    'snippets': 'prompt-snippets.json',
    'system': 'prompts/system.md',
    'system_extra': 'prompts/system_extra.md',
    'compaction': 'prompts/skills/compaction.md',
}

class Settings:
    def __init__(self, llm: 'LiteLLM'):
        self._llm = llm
    
    def get_config_content(self, config_type: str) -> dict:
        """Get content of a config file for editing."""
        ...
    
    def save_config_content(self, config_type: str, content: str) -> dict:
        """Save edited content back to config file."""
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
- Dispatches `config-edit-request` event to load config into main diff viewer
- Uses `RpcMixin` to call `Settings.*` RPC methods for reload operations

```javascript
export class SettingsPanel extends RpcMixin(LitElement) {
  editConfig(configType) {
    // Dispatch event for AppShell to load config into diff viewer
    this.dispatchEvent(new CustomEvent('config-edit-request', {
      bubbles: true, composed: true,
      detail: { configType }
    }));
  }
  
  async reloadLlmConfig() {
    const result = await this._rpcExtract('Settings.reload_llm_config');
    // handle result  
  }
}
```

### Frontend: AppShell Integration

AppShell handles the `config-edit-request` event:
- Fetches config content via `Settings.get_config_content`
- Loads into diff viewer with `isConfig: true` metadata
- Saves via `Settings.save_config_content` when user saves (Ctrl+S)

## Design

### UI Changes

**PromptView Left Panel:**
- Add "settings" tab (gear icon ⚙️) alongside files/search/context/cache
- Settings panel shows:
  - Section: "LLM Configuration"
    - Current model name (readonly display)
    - "Edit llm.json" button → loads into main diff viewer
    - "Reload" button → re-reads config and applies changes
  - Section: "App Configuration"  
    - "Edit app.json" button → loads into main diff viewer
    - "Reload" button → clears config cache
    - Note: "Some settings may require restart"
  - Section: "Prompts (live-reloaded)"
    - "system.md" button → loads into diff viewer
    - "system_extra.md" button
    - "prompt-snippets.json" button
  - Section: "Skills (live-reloaded)"
    - "compaction.md" button

### Backend Changes

**ac/settings.py:**
- `Settings` class with JRPC methods:
  - `get_config_content(config_type)` - returns file content for editing
  - `save_config_content(config_type, content)` - saves edited content
  - `reload_llm_config()` - delegates to LiteLLM.reload_config()
  - `reload_app_config()` - clears app config cache
  - `get_config_info()` - returns current model and config paths

**ac/llm/llm.py:**
- `reload_config()` method to re-read llm.json and apply changes

**ac/config.py:**
- `load_app_config(force_reload=True)` to clear cached config

**ac/dc.py:**
- Register `Settings` class with JRPC server

### Frontend Changes

**webapp/src/settings/SettingsPanel.js:**
- Dispatches `config-edit-request` event when edit button clicked
- Calls reload RPC methods

**webapp/src/app-shell/AppShell.js:**
- Handles `config-edit-request` to load config into diff viewer
- Routes config file saves to `Settings.save_config_content`

**webapp/src/diff-viewer/DiffEditorMixin.js:**
- Passes `isConfig` and `configType` metadata in save events

## Implementation Steps (Completed)

### Phase 1: Backend - Settings Class
1. ✅ Created `ac/settings.py` with `Settings` class
   - Whitelist allowed config types via `ALLOWED_CONFIGS`
   - `get_config_content()` and `save_config_content()` for in-app editing
2. ✅ Added `reload_config()` method to `LiteLLM`
3. ✅ Registered `Settings` with JRPC in `ac/dc.py`

### Phase 2: Frontend - Settings Tab
1. ✅ Added 'settings' to `activeLeftTab` options in PromptView
2. ✅ Added gear icon to tab bar in PromptViewTemplate.js
3. ✅ Created SettingsPanel.js component
4. ✅ Created SettingsPanelStyles.js
5. ✅ Created SettingsPanelTemplate.js
6. ✅ Added `webapp/settings-panel.js` entry point
7. ✅ Wired up config editing via diff viewer
8. ✅ Added toast notifications for reload feedback

### Phase 3: Integration
1. ✅ AppShell handles `config-edit-request` event
2. ✅ DiffEditorMixin passes config metadata in save events
3. ✅ AppShell routes config saves to Settings RPC

## File Changes

### New Files
- `ac/settings.py` - Settings class with JRPC methods
- `webapp/src/settings/SettingsPanel.js` - Settings panel component
- `webapp/src/settings/SettingsPanelStyles.js` - Styles
- `webapp/src/settings/SettingsPanelTemplate.js` - Template
- `webapp/settings-panel.js` - Entry point for the component

### Modified Files
- `ac/llm/llm.py` - Add `reload_config()` method
- `ac/dc.py` - Register Settings class with JRPC
- `webapp/src/PromptView.js` - Add 'settings' tab, forward config-edit-request
- `webapp/src/prompt/PromptViewTemplate.js` - Add settings tab icon and panel rendering
- `webapp/src/app-shell/AppShell.js` - Handle config editing and saving
- `webapp/src/diff-viewer/DiffEditorMixin.js` - Pass config metadata in save events

## Edge Cases

1. **Config syntax error after edit:** Catch JSON parse error on reload, show error message, keep previous config working
2. **LLM reload with invalid model:** Catch LiteLLM error on next request, show error message
3. **File permissions:** Return error if file can't be written
4. **StabilityTracker cache threshold:** Document that this setting requires restart to take effect

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
│ │ [Edit llm.json] [Reload]        │ │
│ └─────────────────────────────────┘ │
│                                     │
│ App Configuration                   │
│ ┌─────────────────────────────────┐ │
│ │ [Edit app.json] [Reload]        │ │
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

Clicking any "Edit" or file button loads the config into the main Monaco diff viewer.
Save with Ctrl+S. Changes are written via Settings RPC.

### Toast Notification States

- **Success:** Green background, checkmark icon, "Config reloaded successfully"
- **Error:** Red background, X icon, error message from backend
- **Auto-dismiss:** Toast disappears after 3 seconds, or on click
