# Settings Interface

## Overview

Provides access to configuration file editing and hot-reload. Lazily loaded on first visit.

## Layout

An info banner at the top showing current model names and config directory, followed by a card grid of config types, and an inline editor area that opens below the cards.

### Info Banner
- Current model name
- Smaller model name
- Config directory path

### Config Cards

A grid of clickable cards, one per config type:

| Card | Icon | Format | Reloadable |
|------|------|--------|------------|
| LLM Config | 🤖 | JSON | Yes |
| App Config | ⚙️ | JSON | Yes |
| System Prompt | 📝 | Markdown | No |
| System Extra | 📎 | Markdown | No |
| Compaction Skill | 🗜️ | Markdown | No |
| Snippets | ✂️ | JSON | No |

Clicking a card opens its content in the inline editor below. The active card is highlighted.

## Config Editing Flow

1. User clicks a config card
2. Config content loaded via `Settings.get_config_content`
3. Content shown in an inline monospace textarea within the settings tab
4. User edits directly in the textarea
5. User clicks 💾 Save (or Ctrl+S) → calls `Settings.save_config_content`
6. For reloadable configs (LLM, App), save automatically triggers a reload
7. For reloadable configs, a separate ↻ Reload button is also available in the editor toolbar
8. User clicks ✕ to close the editor and return to the card grid

### Editor Toolbar

The inline editor has a toolbar showing:
- Config type icon and label
- File path (truncated, with tooltip)
- ↻ Reload button (only for reloadable configs)
- 💾 Save button
- ✕ Close button

## Toast Messages

Success/error feedback as temporary messages, auto-dismiss after 3 seconds. Toasts appear at the bottom center of the viewport. Types: success (green), error (red), info (blue).