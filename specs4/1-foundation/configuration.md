# Configuration

**Status:** stub

Configuration is split across multiple files, each with a distinct purpose. A settings service provides RPC methods for reading, editing, and reloading configs. Packaged builds copy configs to a persistent user directory on first run.

## Config File Set

- LLM config (provider settings, model, env vars, cache tuning)
- App config (URL cache, history compaction, document conversion, document index)
- System prompt (main LLM instructions)
- Extra prompt (appended to system prompt)
- Document system prompt (replaces main prompt in document mode)
- Review system prompt (replaces main prompt in review mode)
- Compaction skill prompt (template for history summarization)
- Commit message prompt (for commit message generation)
- System reminder (edit-format reinforcement appended to each user prompt)
- Snippets (quick-insert buttons, all modes in one file)

## LLM Config

- Environment variables to inject on load
- Primary model name (accepts both snake_case and camelCase for secondary fields)
- Smaller/faster model for auxiliary tasks (commit messages, topic detection, summarization)
- Cache tuning — minimum cacheable tokens, buffer multiplier
- Model-aware cache target computation (provider-specific minimums)

## App Config

- URL cache — path, TTL hours
- History compaction — enabled flag, trigger threshold, verbatim window, summary budget, minimum verbatim exchanges
- Document conversion — enabled flag, supported extensions, max source size
- Document index — keyword model name, enabled flag, top-N, n-gram range, min section chars, min score, diversity, TF-IDF fallback threshold, max document frequency

## Snippets

- Single file with nested structure keyed by mode (code, review, doc)
- Each snippet has an icon, tooltip, and message text
- Default code snippets cover common LLM interaction patterns
- Legacy flat format supported for backwards compatibility

## Config Directory Resolution

- Development mode — config directory relative to source tree
- Packaged builds — bundled configs embedded in executable, copied to platform-specific user directory on first run
- Platform paths — Linux, Windows, macOS conventions
- Version marker file tracks which release populated the directory
- All reads go to user directory so edits persist

## Managed vs User Files

- Managed files — safe to overwrite on upgrade (prompts, default settings)
- User files — never overwritten (LLM config, extra prompt)
- Upgrade creates backup copies of overwritten managed files with version suffix
- Files outside either set are skipped during iteration

## Version-Aware Upgrade

- On startup, compare bundled version against installed version marker
- Matching versions — no action (fast path)
- Differing versions — new files copied, managed files backed up and overwritten, user files preserved
- Version marker updated to current

## Backup Naming

- Timestamped with UTC
- Version SHA appended when known
- Allows users to recover customizations made directly to managed files

## Loading and Caching

- App config loaded once and cached; hot-reload available
- Downstream consumers read config values through accessor methods, not snapshot dicts — allows hot-reloaded values to take effect immediately
- LLM config read on init and on explicit reload; env vars applied on load
- System prompts read fresh from files; concatenated at assembly time — edits take effect on next LLM request
- Snippets loaded on request with two-location fallback: repo-local first, then app config directory

## Token Counter Data Sources

- Hardcoded model-family defaults (no runtime provider registry lookup)
- Fallback estimate when tokenizer unavailable
- Model-aware minimum cacheable tokens

## Settings Service

- Whitelisted config types can be read, written, and reloaded
- Arbitrary file paths rejected
- Some managed files (commit prompt, system reminder) are loaded internally but not exposed via the RPC whitelist — can only be edited directly on disk

## Prompt Assembly Helpers

- System prompt (main + extra)
- Document system prompt (doc + extra)
- Review prompt (review + extra)
- Compaction prompt
- Commit prompt
- System reminder (prepended with blank lines)
- Snippets (mode-aware)

## Per-Repository Working Directory

- Created on first run under repository root (hidden)
- Auto-added to `.gitignore`
- Holds persistent history, symbol map snapshot, image files, per-repo snippet overrides, document outline cache

## Invariants

- User files are never modified during upgrade
- All reads go to the user config directory (not the bundle)
- Hot-reload changes take effect on the next LLM request without server restart
- The whitelist rejects unknown config type names