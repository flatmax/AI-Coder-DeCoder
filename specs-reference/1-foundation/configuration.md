# Reference: Configuration

**Supplements:** `specs4/1-foundation/configuration.md`

## Byte-level formats

### Version marker file

`.bundled_version` — UTF-8 text file in the user config directory, containing a single version string and optional trailing newline. Written by the config manager after a successful upgrade pass. Absent on first run.

```
2025.06.15-14.32-a1b2c3d4
```

Format matches the baked VERSION string (timestamp + short SHA). See `specs-reference/6-deployment/build.md` (when written) for the release build format; dev installs use the literal string `dev`.

### Backup file naming

When a managed file is overwritten during upgrade, the previous version is renamed as a backup:

```
{filename}.{version}
```

With version known from the marker:

```
system.md.2025.06.15-14.32-a1b2c3d4
```

Without version marker (first upgrade of a pre-tracking install), substitutes a UTC timestamp:

```
system.md.2025.06.15-14.32
```

The version/timestamp suffix is separated from the filename by a literal `.`. Users can recover customizations by diffing backup against current.

## Numeric constants

### Platform-specific user config directory

| Platform | Path |
|---|---|
| Linux | `$XDG_CONFIG_HOME/ac-dc/` or `~/.config/ac-dc/` |
| macOS | `~/Library/Application Support/ac-dc/` |
| Windows | `%APPDATA%\ac-dc\` |

Linux respects `XDG_CONFIG_HOME` when set; otherwise falls back to `~/.config/`. The `ac-dc/` subdirectory name is literal (no version suffix — user customizations carry across releases).

### Managed files (overwritten on upgrade)

| File | Content |
|---|---|
| `system.md` | Main coding-agent system prompt |
| `system_doc.md` | Document-mode system prompt |
| `review.md` | Review-mode system prompt |
| `commit.md` | Commit message generation prompt |
| `compaction.md` | Topic boundary detection prompt |
| `system_reminder.md` | Edit-format reinforcement appended to each user prompt |
| `app.json` | App config defaults |
| `snippets.json` | Prompt snippet defaults |

Backups written before overwrite; diffs recoverable per backup naming above.

### User files (never overwritten)

| File | Content |
|---|---|
| `llm.json` | Provider settings, model names, env vars, cache tuning |
| `system_extra.md` | User-appended system prompt content |

Created from bundle on first run if absent. Subsequent upgrades leave them untouched.

### Files loaded but not exposed to Settings RPC

These files exist in the managed set but cannot be edited via the Settings tab:

| File | Rationale |
|---|---|
| `commit.md` | Rarely customized; exists for commit-message generation only |
| `system_reminder.md` | Appended to every user prompt; editing via UI could break the edit protocol |

Users wanting to customize them edit the files on disk directly.

### Token counter defaults

Hardcoded constants in `TokenCounter`, not read from config:

| Property | Value |
|---|---|
| `max_input_tokens` | `1_000_000` for all currently supported models |
| `max_output_tokens` (Claude family) | `8_192` |
| `max_output_tokens` (non-Claude) | `4_096` |
| `max_history_tokens` | `max_input_tokens / 16` |
| Tokenizer encoding | `cl100k_base` via `tiktoken` (used for all models regardless of provider) |
| Fallback estimate when tokenizer unavailable | `len(text) // 4` |

Model-family detection uses case-insensitive substring matching on the model name (e.g., `"claude"` → Claude family).

### Cache target computation

See `specs-reference/3-llm/cache-tiering.md` § Cache target computation for the formula and model-specific `min_cacheable_tokens` values.

### Config type whitelist

Eight whitelisted identifiers accepted by `Settings.get_config_content` and `Settings.save_config_content`:

| Type key | Maps to |
|---|---|
| `litellm` | `llm.json` |
| `app` | `app.json` |
| `snippets` | `snippets.json` |
| `system` | `system.md` |
| `system_extra` | `system_extra.md` |
| `compaction` | `compaction.md` |
| `review` | `review.md` |
| `system_doc` | `system_doc.md` |

Any other `type` value returns an error from both getter and setter. Arbitrary file paths are rejected — the whitelist is the only legal input.

## Schemas

### `llm.json`

Provider settings, model selection, cache tuning.

```pseudo
LlmConfig:
    env: dict[string, string]        // Environment variables to inject on load
    model: string                    // Primary model, e.g. "anthropic/claude-sonnet-4-20250514"
    smaller_model: string            // Smaller model for commit messages, topic detection, summarization
    smallerModel: string             // camelCase alias — accepted as fallback when snake_case absent
    cache_min_tokens: int            // User-configurable minimum (default 1024)
    cache_buffer_multiplier: float   // Default 1.1
```

**Field semantics:**

- `env` — each key/value pair set as an environment variable on config load. Used for provider credentials (`ANTHROPIC_API_KEY`, `AWS_REGION`, etc.) without baking them into the config itself.
- `model` — provider-prefixed identifier. Primary inference model.
- `smaller_model` — provider-prefixed identifier. Used for cheap auxiliary tasks (commit messages, topic detection for compaction, URL summarization). Can be the same as `model` if no faster alternative is desired.
- `smallerModel` — camelCase alias accepted for backwards compatibility with older configs. The accessor tries `smaller_model` first, falls back to `smallerModel` if absent.
- `cache_min_tokens` — user override that can raise the cache target above the model's hardcoded minimum, but never below. Default 1024.
- `cache_buffer_multiplier` — applied to the max of `cache_min_tokens` and the model's `min_cacheable_tokens`. Default 1.1 (10% headroom).

### `app.json`

App-wide settings organized into four sections.

```pseudo
AppConfig:
    url_cache: UrlCacheConfig
    history_compaction: HistoryCompactionConfig
    doc_convert: DocConvertConfig
    doc_index: DocIndexConfig
```

**`url_cache` section:**

```pseudo
UrlCacheConfig:
    path: string      // Directory for cached URL content; defaults to user-cache dir
    ttl_hours: int    // Default 24
```

**`history_compaction` section:**

See `specs-reference/3-llm/history.md` § Compaction config defaults for field names, types, and default values.

**`doc_convert` section:**

```pseudo
DocConvertConfig:
    enabled: bool                  // Default true
    extensions: list[string]       // File extensions to offer for conversion
    max_source_size_mb: int        // Default 50
```

Default extensions list:

```json
[".docx", ".pdf", ".pptx", ".xlsx", ".csv", ".rtf", ".odt", ".odp"]
```

**`doc_index` section:**

```pseudo
DocIndexConfig:
    keyword_model: string                  // Sentence-transformer model name
    keywords_enabled: bool                 // Default true
    keywords_top_n: int                    // Default 3
    keywords_ngram_range: [int, int]       // Default [1, 2]
    keywords_min_section_chars: int        // Default 50
    keywords_min_score: float              // Default 0.3
    keywords_diversity: float              // Default 0.5
    keywords_tfidf_fallback_chars: int     // Default 150
    keywords_max_doc_freq: float           // Default 0.6
```

Default `keyword_model` is `"BAAI/bge-small-en-v1.5"` — a compact English sentence-transformer. Changing the model invalidates all cached keyword enrichments (the cache key includes the model name).

### `snippets.json`

Quick-insert message templates for the chat panel, organized by mode.

**Primary format (nested):**

```json
{
  "code": [
    {"icon": "✂️", "tooltip": "Continue truncated edit", "message": "Your last edit was truncated, please continue."},
    {"icon": "🔍", "tooltip": "Check context", "message": "Before you make changes, tell me what you understand about the context so far."}
  ],
  "review": [
    {"icon": "🔍", "tooltip": "Full review", "message": "Give me a full review of this PR."}
  ],
  "doc": [
    {"icon": "📄", "tooltip": "Summarise", "message": "Summarise this document in 3-5 bullet points"}
  ]
}
```

Each snippet entry has:

| Field | Type | Notes |
|---|---|---|
| `icon` | string | Emoji or short glyph shown on the button |
| `tooltip` | string | Hover text |
| `message` | string | Inserted into the chat input on click |

**Legacy flat format (backwards-compatible fallback):**

```json
{
  "snippets": [
    {"mode": "code", "icon": "✂️", "tooltip": "...", "message": "..."},
    {"mode": "review", "icon": "🔍", "tooltip": "...", "message": "..."}
  ]
}
```

Reader detects the flat format by the presence of a top-level `snippets` key, groups entries by their `mode` field (default `"code"` if absent), and surfaces the result in the same nested shape as the primary format.

### Per-repo snippets override

A repo-local `{repo_root}/.ac-dc4/snippets.json` takes precedence over the user-config version when present. Same format. Falls through to the user config if the repo-local file is absent or fails to parse.

## Dependency quirks

### camelCase fallback for `smaller_model`

The `LlmConfig.smaller_model` accessor tries both forms:

```python
smaller_model = config.get("smaller_model") or config.get("smallerModel")
```

This exists because an earlier version of the config accepted camelCase (JavaScript convention) and some users have that form baked into their `llm.json`. New writes always use snake_case; reads tolerate both. No other field in `llm.json` has this fallback — only `smaller_model`.

### `tiktoken` encoding is the same for all models

All token counting uses `cl100k_base` regardless of the model provider. Claude models, GPT models, Bedrock models — all counted with the same encoding. This is a deliberate simplification: the per-model differences in tokenization are small enough that budget decisions stay correct, and using one encoding avoids multi-provider tokenizer dependencies. The cost is that token counts shown to the user are approximate when the actual model is non-OpenAI.

### Model name substring matching for limits

`TokenCounter._min_cacheable_for(model_name)` does case-insensitive substring checks:

- `"opus-4-5"` / `"opus-4.5"` → 4096
- `"opus-4-6"` / `"opus-4.6"` → 4096
- `"haiku-4-5"` / `"haiku-4.5"` → 4096
- Any other `"claude"` substring → 1024
- Anything else → 1024

Both dash and dot separators match because different providers format version numbers differently (`anthropic/claude-opus-4-5` vs `anthropic/claude-opus-4.5`). The substring check catches both.

### Upgrade atomicity

The version-aware upgrade is not atomic — if the process crashes mid-upgrade, some managed files may be overwritten and others not. On next startup the version marker still reflects the OLD bundled version (it's written last), so the upgrade re-runs and catches unfinished files. Partially-written files are simply overwritten again with the new bundle content; user files are never touched either way.

## Cross-references

- Hot reload semantics, accessor patterns, upgrade flow narrative: `specs4/1-foundation/configuration.md`
- Cache target computation formula and per-model minimums: `specs-reference/3-llm/cache-tiering.md`
- Compaction config field names and defaults: `specs-reference/3-llm/history.md` § Compaction config defaults
- Keyword enrichment behavioral detail: `specs4/2-indexing/keyword-enrichment.md`
- Settings RPC whitelist enforcement: `specs-reference/1-foundation/rpc-inventory.md` § Service: Settings
- Managed vs user file upgrade behavior: `specs4/1-foundation/configuration.md` § Version-Aware Upgrade