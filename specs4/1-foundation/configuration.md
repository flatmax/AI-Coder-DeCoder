# Configuration

Configuration is split across multiple files, each with a distinct purpose. A settings service provides RPC methods for reading, editing, and reloading configs. Packaged builds copy configs to a persistent user directory on first run.

## Config File Set

- LLM config (provider settings, model, env vars, cache tuning)
- App config (URL cache, history compaction, document conversion, document index)
- System prompt (main LLM instructions)
- Agentic coding appendix (optional — describes the agent-spawn capability; appended to the system prompt only when `agents.enabled` is true in app config)
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
- Agents — `enabled` flag gating the parallel-agents capability (default `false`). When `false`, the system prompt omits the agent-spawn block description and the main LLM cannot emit agent-spawn blocks regardless of task shape. See [parallel-agents.md](../7-future/parallel-agents.md#user-control--agent-mode-toggle) for the user-facing toggle and [settings.md](../5-webapp/settings.md#agentic-coding-toggle) for the Settings card

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
- System prompts read fresh from files; concatenated at assembly time — edits to prompt files (e.g. `system.md`, `system_extra.md`) take effect on next LLM request without any explicit reload
- Snippets loaded on request with two-location fallback: repo-local first, then app config directory

### System Prompt Refresh on App-Config Reload

Some prompt composition depends on app-config values rather than prompt files. The agent-mode toggle (`agents.enabled`) is the canonical example — flipping it changes whether `get_system_prompt()` appends the agentic appendix.

The context manager caches the assembled prompt: at session start, at mode switches, and at review entry / exit. Without explicit refresh, an app-config change that affects prompt composition only takes effect on the next mode switch or session restart — a confusing UX where the Settings tab says the toggle is on but the LLM doesn't see the agentic appendix for several turns.

The Settings service handles this by calling `LLMService.refresh_system_prompt()` after a successful `reload_app_config()`. The refresh re-reads the current mode's prompt from the config manager and installs it on the context manager. The change is visible on the very next user turn.

Refresh semantics:

- Respects review mode — if review is active, the refresh is skipped. The review prompt was installed via `save_and_replace_system_prompt` and remains authoritative until review exit, at which point `restore_system_prompt` re-reads the current base prompt from config.
- Respects the active mode — refreshes the doc-mode prompt in doc mode, the code-mode prompt otherwise.
- Best-effort from the Settings side — a refresh failure logs a warning but doesn't invalidate the config reload. The next mode switch or session restart picks up the new prompt regardless.
- Localhost-only — the same gate as all other mutation-class operations.

Reloading LLM config (`reload_llm_config`) does NOT trigger a prompt refresh. LLM config affects model selection and provider credentials; it doesn't affect prompt composition.

### Bundled Fallback for the Agentic Appendix

The agent-spawn capability file (`system_agentic_appendix.md`) uses the standard two-stage read: user config directory first, then the bundled copy when the user file is absent. This matches the fallback rule for the base system prompt and every other prompt-composition file.

The rationale is cross-version compatibility. `system_agentic_appendix.md` was added to the managed-files set in a specific release. Users who installed AC⚡DC before that release have a version marker that prevents the upgrade pass from copying the file on subsequent startups (version-matching short-circuits the upgrade). Their `agents.enabled` toggle would then silently produce no appendix text — the toggle would appear to flip on in the Settings tab, the `agents_enabled` flag in `app.json` would read `true`, but the LLM would receive the base prompt without agent instructions and agent-spawn blocks would never appear. The bundled fallback papers over the cross-version gap so "toggle on" reliably produces agent instructions regardless of install history.

Users who want to suppress the appendix text do so via the `agents.enabled` flag in `app.json` (the Settings-tab toggle writes to this flag). There is no separate "toggle on but appendix suppressed" configuration — the toggle is the one and only control for whether agent instructions reach the LLM.

Users who want to customise the appendix text can edit their user-directory copy. Edits survive upgrades via the standard managed-file backup mechanism — the upgrade pass backs up the user copy with a timestamped suffix and installs the new bundled version, so customisations remain recoverable.

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