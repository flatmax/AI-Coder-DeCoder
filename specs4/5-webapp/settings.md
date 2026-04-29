# Settings

The Settings tab provides access to configuration editing and hot-reload. Config files are read, written, and reloaded via the settings RPC service with a whitelisted type set. Editing happens inline within the tab — no separate window or modal.

## Layout

- Info banner at top — shows current model names (primary and smaller) and config directory path
- Card grid — one card per whitelisted config type
- Inline editor area below the grid — shown when a card is selected
- Active card visually highlighted when its editor is open

## Config Cards

Each card represents one whitelisted config type:

| Card | Format | Reloadable |
|---|---|---|
| LLM config | JSON | Yes (hot-reload applies env vars and model name) |
| App config | JSON | Yes (hot-reload applies to all consumers via accessor methods) |
| System prompt | Markdown | No (read fresh on each request) |
| System extra | Markdown | No (read fresh on each request) |
| Compaction skill | Markdown | No |
| Review prompt | Markdown | No |
| Document system prompt | Markdown | No |
| Snippets | JSON | No (loaded on each request) |

Card visual style — icon, label, optional subtitle. Clicking a card opens its content in the inline editor.

## Editing Flow

1. User clicks a config card
2. Card highlights; its content is loaded via the read-content RPC
3. Content appears in a monospace textarea within the tab (not a separate editor)
4. User edits directly
5. Ctrl+S or Save button writes via the save-content RPC
6. For reloadable configs, save automatically triggers the corresponding reload RPC
7. A separate Reload button is also available for reloadable configs (useful if the user edited the file on disk directly)
8. Close button exits the editor and returns to the card grid

## Editor Toolbar

When an editor is open, a toolbar above the textarea shows:

- Config type icon and label
- File path
- Reload button (reloadable configs only)
- Save button
- Close button

## Save Behavior

- Content is written via the save-content RPC
- On success, for reloadable configs, the reload RPC is invoked automatically
- Feedback toasts communicate success or failure
- Invalid content (e.g., malformed JSON) produces an error toast with the parse error message; the file is still saved (allows recovery by re-editing)

## Reload Behavior

- LLM config reload — re-reads the file, applies environment variables, updates the model name reference
- App config reload — re-reads the file; downstream consumers read config values through accessor methods rather than snapshot dicts, so hot-reloaded values take effect on the next access
- Non-reloadable configs — no reload needed since they are read fresh on each use

## Restrictions

- Only whitelisted config types can be edited via this UI
- Arbitrary file paths rejected by the RPC
- Some managed files (e.g., the commit prompt, system reminder) are loaded internally but not exposed to the whitelist — they can only be edited by direct filesystem access

## Non-Localhost Participants

When collaboration mode is active and the client is non-localhost:

- Save button is disabled or hidden
- Reload button is disabled or hidden
- Editor may still be shown in read-only mode for viewing, or the whole Settings tab may be hidden
- Follows the mutation-allowed flag pattern used elsewhere

## Feedback

- Save success — brief success toast
- Save failure — error toast with details
- Reload success — brief success toast
- Invalid content warnings — shown inline in the editor or via toast

## Info Banner

Shows current state:

- Primary model name
- Smaller model name
- Config directory path
- Clicking the directory path may open the directory in the system file manager (optional enhancement)

## State Persistence

- Currently active card / open editor not persisted across tab switches
- Closing and reopening the Settings tab returns to the card grid

## Invariants

- Only whitelisted config types can be read or written via the settings RPC
- Save always writes to the user config directory, never the bundle
- Reloadable configs always trigger their reload RPC on successful save
- Non-reloadable prompt changes take effect on the next LLM request without any explicit reload
- Editor shows the current file content on open — no cached stale content
- Feedback toasts appear for every save and reload operation
- Non-localhost participants cannot save or reload — UI affordances for these actions are hidden or disabled