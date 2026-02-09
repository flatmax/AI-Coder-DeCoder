# Files & Chat Tab Spec

The Files tab (`TABS.FILES`) is the default tab. It combines a file picker panel on the left with the chat interface on the right. The file picker talks to `Repo` on the server; the chat talks to `LiteLLM`.

## Layout

The tab is a horizontal flex container (`.files-tab-panel`) with up to three sections:

1. **Picker panel** — File tree with selection checkboxes (optional, collapsible)
2. **Panel resizer** — Vertical drag handle + collapse button
3. **Chat panel** — Message history, URL chips, input area

## File Picker

### Component: `<file-picker>`

Composed from four mixins on `LitElement`:

- `FileSelectionMixin` — checkbox logic, select/clear all, directory selection
- `FileNodeRendererMixin` — tree node rendering, status indicators, filter matching
- `FileContextMenuMixin` — right-click context menu for git operations
- `FilePickerStyles` / `FilePickerTemplate` — presentation

### Data flow

1. `PromptView.setupDone()` calls `loadFileTree()` which invokes `Repo.get_file_tree()` via RPC.
2. The response populates `fileTree`, `modifiedFiles`, `stagedFiles`, `untrackedFiles`, and `diffStats`.
3. These are passed as properties to `<file-picker>` via the template.
4. Selection changes fire `selection-change` events, which `PromptView.handleSelectionChange` captures to update `selectedFiles`.

### Tree rendering

Each node is either a directory or a file:

- **Directories**: Expandable with `▸`/`▾` toggle. Checkbox selects/deselects all files within. Shows indeterminate state when partially selected.
- **Files**: Checkbox for selection. Name click opens the file in the diff viewer (`file-view` event). Line count shown with color coding (green < 130, orange 130–170, red > 170). Git status indicator (`M` modified, `A` staged, `U` untracked).

### Filtering

A text filter (set via `@` mentions in the chat input) narrows visible nodes. Directories auto-expand when a filter is active. `matchesFilter()` checks path substring match.

### Keyboard navigation

- Arrow keys move `focusedFile` through visible files (`navigateFocus`)
- Space/Enter toggles selection on the focused file (`toggleFocusedFile`)
- The focused file scrolls into view automatically

### Context menu

Right-click on files or directories shows a context menu with git operations:

- **Files**: Stage, Unstage, Discard changes, Delete
- **Directories**: Stage all, Unstage all, New file, New directory

These dispatch `git-operation` events handled by `FileHandlerMixin.handleGitOperation`, which calls the corresponding `Repo.*` methods.

### Auto-selection

On first load, `_autoSelectChangedFiles` automatically selects modified, staged, and untracked files. Directories containing changed files are auto-expanded via `_expandChangedFileDirs`.

### State persistence

- Expanded directories: tracked in `filePickerExpanded`, propagated via `expanded-change` events
- Left panel width: `localStorage` key `promptview-left-panel-width` (default 280px)
- Left panel collapsed: `localStorage` key `promptview-left-panel-collapsed`

## Chat Panel

### Messages

Messages are rendered as a scrollable list using Lit's `repeat()` directive for efficient keyed updates:

- `<user-card>` — User messages with optional image attachments
- `<assistant-card>` — LLM responses with markdown rendering, edit blocks, and file mentions

### Sending messages

`ChatActionsMixin.sendMessage()`:

1. Captures input text, pasted images, and fetched URL content
2. Adds a user message to the UI (without URL dump)
3. Generates a `requestId` and calls `LiteLLM.chat_streaming(requestId, message, files, images)`
4. Server streams back via `streamChunk` / `streamComplete` callbacks (see JRPC spec)
5. URL context is appended to the message sent to the LLM but not displayed in the UI

### Streaming

`StreamingMixin` manages the streaming lifecycle:

- `streamChunk(requestId, content)` — Updates the current assistant message in-place via `streamWrite`, which coalesces updates per animation frame
- `streamComplete(requestId, result)` — Finalizes the message, attaches edit results, refreshes file tree if edits were applied, shows the token HUD
- `compactionEvent(requestId, event)` — Handles history compaction notifications (start, complete, error)
- `stopStreaming()` — Calls `LiteLLM.cancel_streaming(requestId)` to abort

A 5-minute watchdog timer auto-recovers if `streamComplete` is never received.

### Token HUD

After each response, a floating overlay shows token usage (prompt, completion, cache hit/write, tier breakdown). It auto-hides after 8 seconds, pausing on hover.

### Git actions (header buttons)

- **📋 Copy diff** — `copyGitDiff()` fetches both staged and unstaged diffs via `Repo.get_staged_diff` / `Repo.get_unstaged_diff` and copies to clipboard
- **💾 Commit** — `handleCommit()` stages all, generates a commit message via `LiteLLM.get_commit_message`, and commits via `Repo.commit`
- **⚠️ Reset** — `handleResetHard()` calls `Repo.reset_hard` after confirmation

### Other header actions

- **📜 History browser** — Opens a session browser overlay (`<history-browser>`) for loading past conversations
- **🗑️ Clear** — `clearContext()` calls `LiteLLM.clear_history`, clears messages and URL state

## Backend: Repo

The `Repo` class (`ac/repo/repo.py`) wraps GitPython and is composed of four operation mixins:

- `FileOperationsMixin` — `get_file_content`, `file_exists`, `is_binary_file`, `write_file`, `create_file`, `delete_file`, `stage_files`, `unstage_files`, `discard_changes`
- `TreeOperationsMixin` — `get_file_tree` (returns nested tree with children, paths, line counts, git status)
- `CommitOperationsMixin` — `get_commit_history`, `get_branches`, `get_staged_diff`, `get_unstaged_diff`, `stage_all`, `commit`, `reset_hard`
- `SearchOperationsMixin` — `search_files` (used by the Search tab)

## Backend: LiteLLM

The `LiteLLM` class (`ac/llm/llm.py`) is the main AI interface, composed of:

- `ConfigMixin` — Model config loading from `litellm.json`
- `ContextBuilderMixin` — Builds tiered prompt messages with stability tracking
- `ChatMixin` — `get_commit_message` (non-streaming LLM call for commits)
- `StreamingMixin` — `chat_streaming` / `cancel_streaming` (the streaming chat loop)
- `HistoryMixin` — Session persistence via `HistoryStore`

Key methods called from the Files tab:
- `chat_streaming(request_id, prompt, file_paths, images)` — Main chat entry point
- `cancel_streaming(request_id)` — Abort a streaming request
- `clear_history()` — Reset conversation context
- `get_commit_message(diff)` — Generate a commit message from a diff
- `load_files_as_context(file_paths)` — Load selected files into context
- `get_context_breakdown(file_paths, urls)` — Token budget breakdown (used by history bar)
- `get_prompt_snippets()` — Load prompt snippet buttons from config
- `load_session_into_context(session_id)` — Restore a past session
- `history_list_sessions(limit)` — List available sessions
