# Settings Interface

## Overview

Provides access to configuration file editing and hot-reload. Lazily loaded on first visit.

## Layout

Four sections:

### LLM Section
- Display current model and smaller model names
- **Edit** button → opens LLM config in diff viewer
- **Reload** button → hot-reload without restart, updates displayed names

### App Section
- **Edit** button → opens app config in diff viewer
- **Reload** button → reload app config (some settings may need restart)

### Prompts Section
- Edit buttons for: system prompt, extra prompt, compaction skill prompt
- No reload needed — prompts are read fresh each request

### Snippets Section
- **Edit** button → opens snippet config in diff viewer

## Config Editing Flow

1. User clicks Edit → `config-edit-request` event dispatched
2. Parent loads config content via `Settings.get_config_content`
3. Content shown in diff viewer (both sides identical initially)
4. User edits and saves (Ctrl+S)
5. Save routes to `Settings.save_config_content`
6. User clicks Reload to apply

## Toast Messages

Success/error feedback as temporary messages, auto-dismiss after 3 seconds.
