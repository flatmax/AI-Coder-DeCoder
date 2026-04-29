# Packaging

How config defaults, prompts, and per-repo working state are distributed with the application and managed across upgrades. The bundle embeds sensible defaults; the user config directory persists customizations across releases. A per-repo working directory holds conversation history and caches.

## Config Directory Resolution

### Development Mode

- Config directory is relative to the application source
- Used when running from source during development (not from a packaged build or pip-installed package)

### Packaged Builds

- Bundled configs are embedded in the executable (PyInstaller) or installed package data (pip)
- On first run, configs are copied to a persistent user directory
- All reads go to the user directory so edits persist across runs

### Platform-Specific User Directory

| Platform | Path |
|---|---|
| Linux | `~/.config/ac-dc/` |
| Windows | `%APPDATA%/ac-dc/` |
| macOS | `~/Library/Application Support/ac-dc/` |

Resolution uses the platform's standard user config location. Created on first run if missing.

## Version Marker

- A marker file records which release populated the user config directory
- Name indicates this is the bundled-version marker
- Compared against the current bundled version at startup
- Controls the upgrade flow

## File Categories

Two constant sets in the config module control upgrade behavior:

- **Managed files** — safe to overwrite on upgrade (prompts, default settings)
- **User files** — expected to be user-edited, never overwritten

| Category | Typical files | Upgrade behavior |
|---|---|---|
| Managed | System prompts, review prompt, compaction skill, commit message prompt, document system prompt, system reminder, app config defaults, snippets | Overwritten on upgrade; old version backed up with a timestamp/version suffix |
| User | LLM config, extra system prompt | Never overwritten; only created if missing |

Files not in either set (e.g., the version marker, directory entries with a leading dot) are skipped during iteration.

### Exempt Managed Files

Some managed files are loaded internally but not exposed to the settings RPC whitelist — they cannot be edited via the Settings tab. Loaded directly from disk by the config manager. Example — commit message prompt, system reminder.

## Version-Aware Upgrade

On each packaged startup:

1. Read bundled version from the version file inside the executable/package
2. Read installed version from the marker in the user config directory
3. If versions match — no config changes (fast startup)
4. If versions differ (upgrade or first install):
   - **New files** (not yet in user dir) — copied from bundle
   - **Managed files** (already exist) — old file backed up, then overwritten
   - **User files** (already exist) — never touched
   - Version marker updated to the current version

## Backup Naming

When managed files are overwritten during upgrade, the previous version is saved:

- With known version — file plus dot plus timestamp plus dash plus version short SHA
- Without version marker (pre-tracking installs) — file plus dot plus UTC timestamp only

Users who customized managed files directly (instead of using the extra prompt) can diff backups to recover their changes.

## Default Config Values

### LLM Config

Default values for each field:

- Primary model — provider-prefixed identifier (e.g., an Anthropic Sonnet model)
- Smaller model — provider-prefixed identifier for auxiliary tasks
- Environment variables — empty by default
- Cache minimum tokens — reasonable default
- Cache buffer multiplier — reasonable default
- Accepts both snake-case and camelCase keys for compatibility

### App Config

Default sections:

- URL cache — path, TTL hours
- History compaction — enabled, trigger tokens, verbatim window, summary budget, min verbatim exchanges
- Document conversion — enabled, supported extensions, max source size
- Document index — keyword model, enabled, top-N, n-gram range, min section chars, min score, diversity, TF-IDF fallback chars, max document frequency

### System Prompts

- Main prompt — coding-agent role, symbol map navigation, edit protocol rules, workflow guidance, failure recovery, context trust
- Document prompt — documentation-focused role
- Review prompt — code reviewer role
- Commit prompt — conventional-commit style instructions
- Compaction prompt — summarization template for topic detection
- System reminder — edit-format reinforcement
- Extra prompt — empty by default (user customization slot)

### Snippets

- Single file with nested structure keyed by mode (code, review, doc)
- Default code snippets cover common LLM interaction patterns (continue edit, check context, verify tests, pre-commit checklist, etc.)
- Review and doc snippets cover their respective mode workflows
- Legacy flat format supported for backwards compatibility

## Per-Repository Working Directory

A per-repo working directory at the repo root, hidden (leading dot). Created on first run by the config manager and added to the repo's `.gitignore` file.

### Contents

| Entry | Purpose | Lifecycle |
|---|---|---|
| Conversation history file | Persistent JSONL history | Append-only |
| Symbol map snapshot | Current symbol map | Rewritten after each LLM response |
| Images directory | Persisted chat images | Write on paste, read on session load |
| Document cache directory | Disk-persisted document outline cache (keyword-enriched) | Auto-managed by the doc index cache |
| TeX preview directory | Transient working dir for TeX compilation | Cleaned up on next compilation and on startup |
| Repo-local snippet override | Optional user-managed | User-edited |

### Creation and Gitignore

- Working directory created on first run (idempotent)
- Subdirectories (images, document cache) created by their respective subsystems with exist-ok semantics
- Gitignore entry added — if the working directory is not already ignored, an entry is appended to the repo's gitignore; duplicate entries avoided
- All operations are idempotent — safe to re-run on subsequent startups

### Cleanup

- No automatic cleanup of old data
- Users can delete the working directory to reclaim space or reset state without affecting application functionality (history, images, caches all rebuild or restart empty)
- TeX preview directory is the exception — cleaned on every compilation and on server startup since it holds only transient data

## Packaging and Distribution

- PyInstaller builds produce single-file binaries per platform (see [build.md](build.md))
- Pip install distributes the Python package with bundled config defaults as package data
- GitHub Pages deployment serves the built webapp for pip installs that skip the local webapp build

## Invariants

- User files are never modified during an upgrade
- Managed files are always backed up before being overwritten
- Version marker is always updated after a successful upgrade pass
- First run always copies all files and writes the version marker
- Same-version restart never modifies any files
- Gitignore entry for the per-repo working directory is never duplicated
- Per-repo working directory creation is idempotent
- All reads go to the user config directory, not the bundle
- Files outside the managed or user set are never copied or overwritten