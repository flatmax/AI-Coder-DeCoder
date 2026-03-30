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
| Document system prompt | System instructions for document mode | Markdown |

### LLM Config

The Python property default for `model` is `anthropic/claude-sonnet-4-20250514`. The bundled `llm.json` may specify a different default for packaged builds (e.g., a Bedrock model). When the config file is missing or the `model` key is absent, the property default is used.

```pseudo
{
    env: { ENV_VAR: "value" },
    model: "provider/model-name",
    smaller_model: "provider/model",   # also accepts "smallerModel" (camelCase)
    cache_min_tokens: 1024,
    cache_buffer_multiplier: 1.1
}
```

**Cache target tokens** = `max(cache_min_tokens, min_cacheable_tokens) × cache_buffer_multiplier`

The `min_cacheable_tokens` is model-aware — per Anthropic's prompt caching docs:
- **4096 tokens** for Claude Opus 4.5/4.6, Haiku 4.5
- **1024 tokens** for Claude Sonnet and other Claude models

The version matching uses string-contains checks on the lowercased model name, matching both dash-separated and dot-separated version patterns (e.g., `"4-5"` and `"4.5"` both match). Non-Claude models default to 1024.

The `cache_min_tokens` config value (default: 1024) can override upward but never below the model's hard minimum. The `cache_buffer_multiplier` defaults to `1.1`. Example: Opus 4.6 → `max(1024, 4096) × 1.1 = 4505`. Sonnet → `max(1024, 1024) × 1.1 = 1126`.

A fallback `cache_target_tokens` property (without model reference) computes `cache_min_tokens × cache_buffer_multiplier` (default: `1024 × 1.1 = 1126`) for callers that don't have a model reference.

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
    },
    doc_convert: {
        enabled: true,
        extensions: [".docx", ".pdf", ".pptx", ".xlsx", ".csv", ".rtf", ".odt", ".odp"],
        max_source_size_mb: 50
    },
    doc_index: {
        keyword_model: "BAAI/bge-small-en-v1.5",
        keywords_enabled: true,
        keywords_top_n: 3,
        keywords_ngram_range: [1, 2],
        keywords_min_section_chars: 50,
        keywords_min_score: 0.3,
        keywords_diversity: 0.5,
        keywords_tfidf_fallback_chars: 150,
        keywords_max_doc_freq: 0.6
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

Two constant sets in `config.py` control upgrade behavior:

- `_MANAGED_FILES`: files safe to overwrite on upgrade (prompts, default settings)
- `_USER_FILES`: files the user is expected to edit (never overwritten)

| Category | Files (constants in `config.py`) | Upgrade Behavior |
|----------|-------|-----------------|
| **Managed** (`_MANAGED_FILES`) | `system.md`, `system_doc.md`, `compaction.md`, `commit.md`, `system_reminder.md`, `review.md`, `app.json`, `snippets.json` | Overwritten on upgrade. Old version backed up as `{file}.{version}`. Note: `commit.md` and `system_reminder.md` are managed files but are not exposed via the Settings RPC whitelist — they are loaded directly by `ConfigManager` methods |
| **User** (`_USER_FILES`) | `llm.json`, `system_extra.md` | Never overwritten. Only created if missing |

These two sets are defined as module-level constants (`_MANAGED_FILES`, `_USER_FILES`) and checked during `_resolve_config_dir()` for packaged builds. Files not in either set (e.g., files with `.` prefix like `.bundled_version`) are skipped during iteration.

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

The token counter uses hardcoded model-family defaults for limits and `tiktoken` for tokenization:

| Property | Source | Fallback |
|----------|--------|----------|
| Tokenizer | `tiktoken.get_encoding("cl100k_base")` | ~4 characters per token estimate |
| `max_input_tokens` | Hardcoded: 1,000,000 for all currently supported models (Claude, GPT-4, GPT-3.5) | 1,000,000 |
| `max_output_tokens` | Hardcoded: 8,192 for Claude models, 4,096 for others | 4,096 |
| `max_history_tokens` | Computed: `max_input_tokens / 16` | — |

**Note:** The implementation does not query `litellm`'s model registry at runtime. All limits are hardcoded constants in `token_counter.py`. The `cl100k_base` encoding is used for all models regardless of provider.

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
| `system_doc` | Document mode system prompt |

Only these types are accepted — arbitrary file paths are rejected.

### Testing

- Creates `.ac-dc/` directory and `.gitignore` entry on init; no duplicate entries
- Default LLM and app configs contain expected keys
- Save and read-back round-trip for config content
- Invalid config type key rejected with error
- Cache target tokens fallback computed from defaults (`1024 × 1.1 = 1126`)
- Cache target tokens model-aware: Opus 4.6 → `max(1024, 4096) × 1.1 = 4505`, Sonnet → `max(1024, 1024) × 1.1 = 1126`
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
| `Settings.get_review_snippets()` | Load review-specific prompt snippets |

**Note:** Snippet loading during active sessions is handled by `LLMService.get_snippets()`, which checks review/doc mode state and calls `ConfigManager.get_snippets(mode=...)` with the appropriate mode. All modes' snippets live in a single `snippets.json` file with a nested structure (`{"code": [...], "review": [...], "doc": [...]}`).

### Non-Editable Config Files

The following config files are loaded by `ConfigManager` methods but are **not** in the `CONFIG_TYPES` whitelist, so they cannot be edited via the Settings RPC:

| File | Loader | Reason |
|------|--------|--------|
| `commit.md` | `get_commit_prompt()` | Rarely customized; used only for commit message generation |
| `system_reminder.md` | `get_system_reminder()` | Appended to every user prompt; editing via UI could break edit protocol |

These files can still be edited directly on disk in the config directory.

### ConfigManager Properties

The following computed properties on `ConfigManager` provide structured access to config sections:

| Property | Returns | Source |
|----------|---------|--------|
| `llm_config` | Full LLM config dict | `llm.json` |
| `app_config` | Full app config dict | `app.json` |
| `model` | Primary model name | `llm_config.model` (default: `anthropic/claude-sonnet-4-20250514`) |
| `smaller_model` | Smaller model name | `llm_config.smaller_model` or `llm_config.smallerModel` — accepts both snake_case and camelCase keys (default: `anthropic/claude-haiku-4-20250414`) |
| `cache_min_tokens` | Minimum cache tokens | `llm_config.cache_min_tokens` (default: 1024) |
| `cache_buffer_multiplier` | Buffer multiplier | `llm_config.cache_buffer_multiplier` (default: 1.1) |
| `cache_target_tokens` | Fallback cache target | `cache_min_tokens × cache_buffer_multiplier` |
| `compaction_config` | History compaction settings | `app_config.history_compaction` with defaults |
| `doc_index_config` | Document index settings | `app_config.doc_index` with defaults |
| `doc_convert_config` | Document conversion settings | `app_config.doc_convert` with defaults |
| `url_cache_config` | URL cache settings | `app_config.url_cache` with defaults |
| `repo_root` | Repository root path | Set at construction |
| `config_dir` | Resolved config directory | Platform-dependent |

Additionally, `cache_target_tokens_for_model(min_cacheable_tokens)` computes the model-aware cache target: `max(cache_min_tokens, min_cacheable_tokens) × cache_buffer_multiplier`.

### Prompt Assembly Methods

| Method | Description |
|--------|-------------|
| `get_system_prompt()` | Concatenate `system.md` + `system_extra.md` |
| `get_doc_system_prompt()` | Concatenate `system_doc.md` + `system_extra.md` |
| `get_review_prompt()` | Concatenate `review.md` + `system_extra.md` |
| `get_compaction_prompt()` | Load `compaction.md` |
| `get_commit_prompt()` | Load `commit.md` |
| `get_system_reminder()` | Load `system_reminder.md`, prepend `\n\n` |
| `get_snippets(mode?)` | Load snippets for a mode ("code", "review", "doc"). Two-location fallback: repo-local `.ac-dc/snippets.json` first, then config directory. Supports nested format (`{"code": [...]}`) and legacy flat format (`{"snippets": [...]}`) |
| `get_review_snippets()` | Convenience: `get_snippets(mode="review")` |
| `get_doc_snippets()` | Convenience: `get_snippets(mode="doc")` |

### Config Editing Flow

1. User clicks Edit in settings panel
2. Config content loaded into the diff viewer
3. User edits and saves (Ctrl+S)
4. Content written via `save_config_content`
5. User clicks Reload to apply changes

## `.ac-dc/` Directory

A per-repository working directory at `{repo_root}/.ac-dc/`. Created on first run by `ConfigManager._init_ac_dc_dir()` and added to `.gitignore`. The `images/` subdirectory is also created at this time (not lazily by the history store).

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `history.jsonl` | Persistent conversation history | Append-only |
| `symbol_map.txt` | Current symbol map | Rebuilt on startup and before each LLM request |
| `snippets.json` | Per-repo prompt snippets override (optional, all modes) | User-managed |
| `images/` | Persisted chat images | Created by ConfigManager on init; write on paste, read on session load |
| `doc_cache/` | Disk-persisted document outline cache (keyword-enriched) | Auto-managed |