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
| Prompt snippets | Quick-insert buttons for the UI (all modes: code, review, doc) | JSON |
| Compaction skill prompt | Template for history compaction summarization | Markdown |
| Commit message prompt | System instructions for commit message generation | Markdown |
| System reminder | Edit-format reinforcement appended to each user prompt | Markdown |
| Review system prompt | System instructions for code review mode | Markdown |

### LLM Config

```pseudo
{
    env: { ENV_VAR: "value" },
    model: "provider/model-name",
    smaller_model: "provider/model",   # also accepts "smallerModel" (camelCase)
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

A single `snippets.json` file contains snippets for all modes (code, review, doc) in a nested structure:

```pseudo
{
    code: [
        {icon: "✂️", tooltip: "Continue truncated edit", message: "Your last edit was truncated, please continue."},
        ...
    ],
    review: [
        {icon: "🔍", tooltip: "Full review", message: "Give me a full review of this PR."},
        ...
    ],
    doc: [
        {icon: "📄", tooltip: "Summarise", message: "Summarise this document in 3-5 bullet points"},
        ...
    ]
}
```

A legacy flat format (`{snippets: [{mode: "code", ...}, ...]}`) is also supported for backwards compatibility. Snippets without a `mode` field default to code mode.

Default code snippets: ✂️ Continue truncated edit, 🔍 Check context, ✏️ Fix malformed edits, ⏸️ Pause before implementing, ✅ Verify tests, 📦 Pre-commit checklist, 🏁 Pre-commit with plan completion.

## Config Directory Resolution

### Development Mode

Config directory relative to the application source.

### Packaged Builds

1. Bundled configs embedded in the executable
2. On first run, copied to persistent user directory (platform-specific: `~/.config/ac-dc/`, `%APPDATA%/ac-dc/`, `~/Library/Application Support/ac-dc/`)
3. A `.bundled_version` marker tracks which release populated the directory
4. On upgrade (version mismatch), managed files are overwritten with backup; user files are never touched
5. All reads go to user directory so edits persist

### Config File Categories

| Category | Files | Upgrade Behavior |
|----------|-------|-----------------|
| **Managed** | `system.md`, `system_doc.md`, `compaction.md`, `commit.md`, `system_reminder.md`, `review.md`, `app.json`, `snippets.json` | Overwritten on upgrade. Old version backed up as `{file}.{version}` |
| **User** | `llm.json`, `system_extra.md` | Never overwritten. Only created if missing |

### Version-Aware Upgrade

On each packaged startup:
1. Read bundled version from `VERSION` file in the executable
2. Read installed version from `.bundled_version` marker in user config directory
3. If versions match → no config changes (fast startup)
4. If versions differ (upgrade or first install):
   - **New files** (not yet in user dir) → copied from bundle
   - **Managed files** (already exist) → old file backed up, then overwritten
   - **User files** (already exist) → never touched
   - `.bundled_version` marker updated to current version

### Backup Naming

When managed files are overwritten during upgrade, the previous version is saved:
- With known version: `system.md.2025.06.15-14.32-a1b2c3d4`
- Without version marker (pre-tracking installs): `system.md.2025.06.15-14.32` (UTC timestamp)

Users who customized managed files directly (instead of using `system_extra.md`) can diff backups to recover their changes.

## Loading and Caching

- **App config** — loaded once and cached in memory; force-reload available. Downstream consumers (e.g., `HistoryCompactor`) must read config values through `ConfigManager` properties rather than capturing snapshot dicts at construction time, so that hot-reloaded values take effect immediately
- **LLM config** — read on init and on explicit reload; env vars applied on load
- **System prompts** — read fresh from files; concatenated at assembly time (each request). Edits take effect on the next LLM request without restart
- **Snippets** — loaded on request with two-location fallback: `{repo_root}/.ac-dc/snippets.json` first, then app config directory `snippets.json`. A single file contains snippets for all modes (code, review, doc) in a nested structure; `get_snippets(mode)` returns the appropriate array

## Token Counter Data Sources

The token counter uses `litellm`'s model registry to determine model-specific limits:

| Property | Source | Fallback |
|----------|--------|----------|
| Tokenizer | `tiktoken.get_encoding()` for the configured model | ~4 characters per token estimate |
| `max_input_tokens` | `litellm` model info based on model name | Hardcoded defaults by model family |
| `max_output_tokens` | `litellm` model info | Hardcoded defaults by model family |
| `max_history_tokens` | Computed: `max_input_tokens / 16` | — |

## Settings Service (RPC)

A whitelisted set of config types can be read, written, and reloaded:

| Key | Description |
|-----|-------------|
| `litellm` | LLM provider config |
| `app` | Application settings |
| `snippets` | Prompt snippet buttons (all modes: code, review, doc) |
| `system` | Main system prompt |
| `system_extra` | Extra system prompt |
| `compaction` | Compaction skill prompt |
| `review` | Review system prompt |

Only these types are accepted — arbitrary file paths are rejected.

### Testing

- Creates `.ac-dc/` directory and `.gitignore` entry on init; no duplicate entries
- Default LLM and app configs contain expected keys
- Save and read-back round-trip for config content
- Invalid config type key rejected with error
- Cache target tokens computed from defaults (1024 × 1.5 = 1536)
- Snippets fallback returns non-empty list
- System prompt assembly returns non-empty string
- Commit prompt loads from commit.md and contains expected content
- System reminder loads from system_reminder.md and contains expected content
- Managed files overwritten on version mismatch; user files preserved
- Backup created before overwriting managed files
- `.bundled_version` marker written after upgrade
- First install copies all files and writes version marker
- Same-version restart does not modify any files

### RPC Methods

| Method | Description |
|--------|-------------|
| `Settings.get_config_content(type)` | Read a config file |
| `Settings.save_config_content(type, content)` | Write a config file |
| `Settings.reload_llm_config()` | Hot-reload LLM config and apply |
| `Settings.reload_app_config()` | Hot-reload app config |
| `Settings.get_config_info()` | Current model names and config paths |
| `Settings.get_snippets()` | Load prompt snippets (code mode — backwards compatible) |

**Note:** Snippet loading during active sessions is handled by `LLMService.get_snippets()`, which checks review/doc mode state and calls `ConfigManager.get_snippets(mode=...)` with the appropriate mode. All modes' snippets live in a single `snippets.json` file with a nested structure (`{"code": [...], "review": [...], "doc": [...]}`).

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
| `snippets.json` | Per-repo prompt snippets override (optional, all modes) | User-managed |
| `images/` | Persisted chat images | Write on paste, read on session load |