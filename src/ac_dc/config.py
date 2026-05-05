"""Configuration layer.

Single class :class:`ConfigManager` owns:

- Resolution of the config directory (dev tree vs packaged install,
  platform-specific user directory).
- Version-aware upgrade — bundled managed files get overwritten on
  upgrade (with a timestamped backup); user files are never touched.
- Cached but hot-reloadable access to the LLM config, app config,
  snippets, and the prompt markdown files.
- Model-aware cache-target computation (min cacheable tokens vary by
  Claude family).
- Per-repo ``.ac-dc4/`` working directory creation and gitignore wiring.

Governing specs: ``specs4/1-foundation/configuration.md`` and
``specs4/6-deployment/packaging.md``.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# File category constants
# ---------------------------------------------------------------------------
#
# Managed files — safe to overwrite on upgrade. The bundled copy is
# the source of truth; user customisations to these should live in
# system_extra.md (for prompt additions) or be applied via git patches
# to the source tree.
#
# User files — expected to be user-edited. Created from the bundle on
# first install, then never touched. Upgrading the app never clobbers
# the user's API keys or custom extra prompt.

_MANAGED_FILES = frozenset({
    "system.md",
    "system_doc.md",
    "system_agentic_appendix.md",
    "review.md",
    "commit.md",
    "compaction.md",
    "system_reminder.md",
    "app.json",
    "snippets.json",
})

_USER_FILES = frozenset({
    "llm.json",
    "system_extra.md",
})

# Version marker filename inside the user config dir. Hidden (leading
# dot), not in either file set so the upgrade iterator skips it.
_VERSION_MARKER = ".bundled_version"

# Per-repo working directory name. Created under the repo root on
# first run; added to .gitignore. The `4` suffix is deliberate —
# this reimplementation shares repositories with the previous
# `.ac-dc/`-using implementation during the transition, and
# colliding on the same directory name would corrupt both states.
# See IMPLEMENTATION_NOTES.md for the rename rationale.
_AC_DC_DIR = ".ac-dc4"


# ---------------------------------------------------------------------------
# Config type whitelist (for the Settings RPC service)
# ---------------------------------------------------------------------------
#
# Only these names can be read/written through the Settings service.
# Some managed files (commit.md, system_reminder.md) are deliberately
# absent — they're loaded internally but not exposed for UI editing.

CONFIG_TYPES: dict[str, str] = {
    "litellm": "llm.json",
    "app": "app.json",
    "snippets": "snippets.json",
    "system": "system.md",
    "system_extra": "system_extra.md",
    "compaction": "compaction.md",
    "review": "review.md",
    "system_doc": "system_doc.md",
}


# ---------------------------------------------------------------------------
# Model-family cache minimums
# ---------------------------------------------------------------------------
#
# Anthropic's prompt-caching docs specify different minimums per
# family. Getting this wrong means the provider silently doesn't
# cache the block and we eat the full ingestion cost.
#
# Match by lowercase substring — resilient to provider prefixes.
# Both dash and dot version variants appear in the wild.

_HIGH_MIN_MODELS = (
    "opus-4-5", "opus-4.5",
    "opus-4-6", "opus-4.6",
    "opus-4-7", "opus-4.7",
    "haiku-4-5", "haiku-4.5",
)
_HIGH_MIN_TOKENS = 4096
_DEFAULT_MIN_TOKENS = 1024


def _model_min_cacheable_tokens(model: str) -> int:
    """Return the provider's minimum cacheable token count for ``model``.

    Hardcoded per Anthropic's published minimums. Non-Claude models
    get the default (1024).
    """
    lowered = model.lower()
    for pattern in _HIGH_MIN_MODELS:
        if pattern in lowered:
            return _HIGH_MIN_TOKENS
    return _DEFAULT_MIN_TOKENS


# ---------------------------------------------------------------------------
# Config directory resolution
# ---------------------------------------------------------------------------


def _bundled_config_dir() -> Path:
    """Locate the bundled (source-of-truth) config directory.

    Under PyInstaller, ``sys._MEIPASS`` points at the unpacked bundle
    root. Under a normal install, config lives next to this module.
    """
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass is not None:
        bundled = Path(meipass) / "ac_dc" / "config"
        if bundled.is_dir():
            return bundled
        logger.warning(
            "_MEIPASS set but ac_dc/config not found; "
            "falling back to module-relative lookup"
        )
    return Path(__file__).parent / "config"


def _user_config_dir() -> Path:
    """Platform-appropriate user config directory.

    Per specs4/6-deployment/packaging.md:

    - Linux / BSD → ``~/.config/ac-dc/`` (honours XDG_CONFIG_HOME)
    - macOS      → ``~/Library/Application Support/ac-dc/``
    - Windows    → ``%APPDATA%/ac-dc/``

    ``AC_DC_CONFIG_HOME`` environment variable overrides everything —
    tests use it to redirect to tmp paths without monkeypatching.
    """
    override = os.environ.get("AC_DC_CONFIG_HOME")
    if override:
        return Path(override)
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        if appdata:
            return Path(appdata) / "ac-dc"
        return Path.home() / "AppData" / "Roaming" / "ac-dc"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "ac-dc"
    xdg = os.environ.get("XDG_CONFIG_HOME")
    if xdg:
        return Path(xdg) / "ac-dc"
    return Path.home() / ".config" / "ac-dc"


def _bundled_version() -> str:
    """Read the baked VERSION string.

    Returns an empty string on any read failure — callers treat
    empty-version installs as "never upgraded" and write a marker
    on first run.
    """
    version_file = Path(__file__).parent / "VERSION"
    try:
        return version_file.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _backup_name(original: Path, installed_version: str) -> Path:
    """Return the backup path for a managed file being overwritten.

    - With known version: ``system.md.2025.06.15-14.32-a1b2c3d4``
    - Without: ``system.md.2025.06.15-14.32`` (UTC timestamp only)
    """
    timestamp = datetime.now(timezone.utc).strftime("%Y.%m.%d-%H.%M")
    if installed_version:
        suffix = f".{timestamp}-{installed_version}"
    else:
        suffix = f".{timestamp}"
    return original.with_name(original.name + suffix)


# ---------------------------------------------------------------------------
# ConfigManager
# ---------------------------------------------------------------------------


class ConfigManager:
    """Owns the user config directory and exposes cached accessors.

    Construction performs, in order:

    1. Resolve the bundled and user config directories.
    2. Run the version-aware upgrade pass — copy new files, back up
       and overwrite managed files on version mismatch, leave user
       files alone.
    3. Lazily load config files on first property access. Hot-reload
       methods clear the cache to force re-read.

    Accessor properties are read-through — they consult the cached
    dict on every access rather than snapshotting values at
    construction time. Downstream consumers that hold a long-lived
    ConfigManager reference see hot-reloaded values on the next
    access without being re-constructed.
    """

    def __init__(self, repo_root: Path | str | None = None) -> None:
        """Initialise the config manager.

        Parameters
        ----------
        repo_root:
            Path to the git repository. When provided, the per-repo
            ``.ac-dc/`` working directory is created and added to
            ``.gitignore``. When ``None``, per-repo operations are
            skipped — useful for tests and for pre-repo tooling.
        """
        self._bundled_dir = _bundled_config_dir()
        self._user_dir = _user_config_dir()
        self._repo_root: Path | None = (
            Path(repo_root) if repo_root is not None else None
        )

        # Lazily-loaded caches. None means "not yet loaded"; a dict
        # or string means "loaded, use this value". Hot-reload
        # methods set these back to None to force re-read.
        self._llm_config: dict[str, Any] | None = None
        self._app_config: dict[str, Any] | None = None

        # Run the upgrade pass. Failure here is non-fatal — if the
        # user config directory can't be created (permissions, etc.)
        # we log and fall back to reading the bundle directly.
        try:
            self._ensure_user_dir()
            self._run_upgrade()
        except OSError as exc:
            logger.warning(
                "Failed to initialise user config dir at %s: %s. "
                "Falling back to bundled config.",
                self._user_dir,
                exc,
            )

        # Per-repo working directory (if a repo was supplied).
        if self._repo_root is not None:
            try:
                self._init_ac_dc_dir()
            except OSError as exc:
                logger.warning(
                    "Failed to create .ac-dc dir at %s: %s",
                    self._repo_root,
                    exc,
                )

    # ------------------------------------------------------------------
    # Directory management
    # ------------------------------------------------------------------

    def _ensure_user_dir(self) -> None:
        """Create the user config directory if it doesn't exist."""
        self._user_dir.mkdir(parents=True, exist_ok=True)

    def _read_installed_version(self) -> str:
        """Read the version marker from the user config dir.

        Empty string means "no marker" — either a first install or
        a pre-tracking version. Either way, the upgrade pass will
        treat all files as new.
        """
        marker = self._user_dir / _VERSION_MARKER
        try:
            return marker.read_text(encoding="utf-8").strip()
        except OSError:
            return ""

    def _write_installed_version(self, version: str) -> None:
        """Write the version marker after a successful upgrade pass."""
        marker = self._user_dir / _VERSION_MARKER
        marker.write_text(version, encoding="utf-8")

    def _run_upgrade(self) -> None:
        """Version-aware upgrade pass.

        Compares the bundled version against the installed marker:

        - Match → no action (fast path)
        - Mismatch or first install → copy new files, back up and
          overwrite managed files, leave user files alone

        Files not in either category set (the marker itself, any
        stray files users may have added) are skipped.
        """
        bundled_version = _bundled_version()
        installed_version = self._read_installed_version()

        if bundled_version and bundled_version == installed_version:
            logger.debug(
                "Config at version %s; no upgrade needed", bundled_version
            )
            return

        logger.info(
            "Config upgrade: installed=%r bundled=%r",
            installed_version or "(none)",
            bundled_version or "(none)",
        )

        for filename in sorted(_MANAGED_FILES | _USER_FILES):
            bundled_path = self._bundled_dir / filename
            user_path = self._user_dir / filename

            if not bundled_path.is_file():
                # Missing from bundle — nothing to copy. Not an
                # error (some files may be optional in future).
                continue

            if not user_path.exists():
                # New file — copy from bundle regardless of category.
                logger.info("Config install: %s", filename)
                shutil.copy2(bundled_path, user_path)
                continue

            if filename in _USER_FILES:
                # User file already exists — never touch.
                continue

            if filename in _MANAGED_FILES:
                # Back up then overwrite.
                backup = _backup_name(user_path, installed_version)
                logger.info(
                    "Config upgrade: %s → backup %s",
                    filename,
                    backup.name,
                )
                shutil.copy2(user_path, backup)
                shutil.copy2(bundled_path, user_path)

        # Only write the marker if we actually have a bundled
        # version to record. Source installs (VERSION == "dev" or
        # empty) skip the marker so the next real release still
        # triggers an upgrade.
        if bundled_version:
            self._write_installed_version(bundled_version)

    def _init_ac_dc_dir(self) -> None:
        """Create the per-repo ``.ac-dc/`` working directory.

        Idempotent — safe to call on every startup. Ensures the
        directory exists and that it appears in the repo's
        ``.gitignore``. An ``images/`` subdirectory is created here
        because the image-persistence layer (Layer 4) expects it to
        exist before it writes.
        """
        assert self._repo_root is not None  # guarded by caller
        ac_dc_path = self._repo_root / _AC_DC_DIR
        ac_dc_path.mkdir(exist_ok=True)
        (ac_dc_path / "images").mkdir(exist_ok=True)
        self._ensure_gitignore_entry()

    def _ensure_gitignore_entry(self) -> None:
        """Add ``.ac-dc/`` to the repo's ``.gitignore`` if absent.

        Idempotent — checks for an existing entry before appending.
        Creates ``.gitignore`` if it doesn't exist. If the repo
        doesn't have a git directory (not actually a git repo), we
        still write the entry because the config manager can't tell
        the difference and the file is harmless in a non-git dir.
        """
        assert self._repo_root is not None
        gitignore = self._repo_root / ".gitignore"
        entry = f"{_AC_DC_DIR}/"

        if gitignore.exists():
            existing = gitignore.read_text(encoding="utf-8")
            # Match either exact ".ac-dc/" or ".ac-dc" on its own line
            # — some users write the entry without the trailing slash.
            for line in existing.splitlines():
                stripped = line.strip()
                if stripped in (entry, _AC_DC_DIR):
                    return  # already present
            # Not present — append with a leading newline if needed.
            suffix = "" if existing.endswith("\n") else "\n"
            gitignore.write_text(
                existing + suffix + entry + "\n",
                encoding="utf-8",
            )
        else:
            gitignore.write_text(entry + "\n", encoding="utf-8")

    # ------------------------------------------------------------------
    # File-reading helpers
    # ------------------------------------------------------------------

    def _read_user_file(self, filename: str) -> str:
        """Read a file from the user config directory.

        Falls back to the bundled copy when the user file is absent
        — happens when the user-dir initialisation failed during
        construction. Returns an empty string if neither exists.
        """
        user_path = self._user_dir / filename
        try:
            return user_path.read_text(encoding="utf-8")
        except OSError:
            bundled_path = self._bundled_dir / filename
            try:
                return bundled_path.read_text(encoding="utf-8")
            except OSError:
                return ""

    def _read_user_json(self, filename: str) -> dict[str, Any]:
        """Read and parse a JSON file from the user config directory.

        Returns an empty dict on any read or parse failure and logs
        a warning — corrupt JSON should never crash construction.
        Callers that need a required field should use ``.get()``
        with a default, never index directly.
        """
        raw = self._read_user_file(filename)
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            logger.warning(
                "Failed to parse %s: %s. Using empty config.",
                filename,
                exc,
            )
            return {}
        if not isinstance(parsed, dict):
            logger.warning(
                "%s root is not an object (got %s). Using empty config.",
                filename,
                type(parsed).__name__,
            )
            return {}
        return parsed

    # ------------------------------------------------------------------
    # LLM config accessors
    # ------------------------------------------------------------------

    @property
    def llm_config(self) -> dict[str, Any]:
        """Full LLM config dict, lazily loaded."""
        if self._llm_config is None:
            self._llm_config = self._read_user_json("llm.json")
        return self._llm_config

    @property
    def model(self) -> str:
        """Primary model name (provider-prefixed, e.g. ``anthropic/...``)."""
        return self.llm_config.get(
            "model", "anthropic/claude-sonnet-4-5-20250929"
        )

    @property
    def smaller_model(self) -> str:
        """Smaller / faster model for auxiliary tasks.

        Accepts both ``smaller_model`` (snake_case, preferred) and
        ``smallerModel`` (camelCase) for compatibility — specs4 says
        both must be honoured.
        """
        cfg = self.llm_config
        return cfg.get(
            "smaller_model",
            cfg.get("smallerModel", "anthropic/claude-haiku-4-5-20251001"),
        )

    @property
    def max_output_tokens(self) -> int | None:
        """User-configured ceiling for model output tokens.

        Per specs-reference/3-llm/streaming.md § Max-tokens
        resolution: when set, overrides the per-model default from
        :class:`TokenCounter`. When absent (the default), callers
        fall back to ``counter.max_output_tokens``.

        Returning ``None`` rather than a sentinel integer lets
        callers distinguish "user set no preference" from "user
        explicitly set this low number". The two interpretations
        diverge if a future model ships with a smaller default
        than a previous user config — we want the per-model
        default to apply, not a stale override.

        Non-integer or non-positive values are ignored with a
        warning (treated as unset). A zero or negative max
        tokens is never what the user meant and would cause
        providers to reject the request outright.
        """
        raw = self.llm_config.get("max_output_tokens")
        if raw is None:
            return None
        try:
            value = int(raw)
        except (TypeError, ValueError):
            logger.warning(
                "llm.json 'max_output_tokens' is not an integer "
                "(got %r); ignoring",
                raw,
            )
            return None
        if value <= 0:
            logger.warning(
                "llm.json 'max_output_tokens' must be positive "
                "(got %d); ignoring",
                value,
            )
            return None
        return value

    @property
    def cache_min_tokens(self) -> int:
        """User-configured minimum cacheable tokens.

        Can override the model-family minimum upward but never below
        the provider's hard floor (enforced in
        :meth:`cache_target_tokens_for_model`).
        """
        return int(self.llm_config.get("cache_min_tokens", _DEFAULT_MIN_TOKENS))

    @property
    def cache_buffer_multiplier(self) -> float:
        """Multiplier applied to the cache minimum to compute target.

        Keeps cache writes above the provider's minimum by a small
        margin so a single-token edit doesn't drop the block below
        the cacheable threshold.
        """
        return float(self.llm_config.get("cache_buffer_multiplier", 1.1))

    @property
    def cache_target_tokens(self) -> int:
        """Fallback cache target for callers without a model reference.

        Computed as ``cache_min_tokens × cache_buffer_multiplier``.
        Callers that have a model name should use
        :meth:`cache_target_tokens_for_model` — it respects the
        model-family minimum.
        """
        return int(self.cache_min_tokens * self.cache_buffer_multiplier)

    def cache_target_tokens_for_model(self, model: str | None = None) -> int:
        """Compute the model-aware cache target.

        Formula: ``max(cache_min_tokens, provider_min) × multiplier``.

        Example — Opus 4.6 with the default user config:
        ``max(1024, 4096) × 1.1 = 4505``.

        Example — Sonnet with the default user config:
        ``max(1024, 1024) × 1.1 = 1126``.
        """
        target_model = model or self.model
        provider_min = _model_min_cacheable_tokens(target_model)
        effective_min = max(self.cache_min_tokens, provider_min)
        return int(effective_min * self.cache_buffer_multiplier)

    def apply_llm_env(self) -> None:
        """Export env vars declared in ``llm.json`` into the process env.

        litellm reads provider credentials from environment variables
        (``ANTHROPIC_API_KEY``, ``AWS_REGION_NAME``, etc.), so users
        can keep their keys in ``llm.json`` rather than having to set
        them in the shell. Called on construction and on hot-reload.

        Values are stringified — JSON allows numeric env values but
        ``os.environ`` requires strings.
        """
        env = self.llm_config.get("env", {})
        if not isinstance(env, dict):
            logger.warning(
                "llm.json 'env' is not an object (got %s); skipping",
                type(env).__name__,
            )
            return
        for key, value in env.items():
            if not isinstance(key, str):
                continue
            os.environ[key] = str(value)

    # ------------------------------------------------------------------
    # App config accessors
    # ------------------------------------------------------------------

    @property
    def app_config(self) -> dict[str, Any]:
        """Full app config dict, lazily loaded."""
        if self._app_config is None:
            self._app_config = self._read_user_json("app.json")
        return self._app_config

    @property
    def url_cache_config(self) -> dict[str, Any]:
        """URL cache section with defaults filled in.

        Layer 4 will consume this. Layer 1 just exposes the accessor.
        """
        section = self.app_config.get("url_cache", {})
        if not isinstance(section, dict):
            section = {}
        return {
            "path": section.get("path"),  # None → use default under tmpdir
            "ttl_hours": int(section.get("ttl_hours", 24)),
        }

    @property
    def compaction_config(self) -> dict[str, Any]:
        """History compaction section with defaults filled in."""
        section = self.app_config.get("history_compaction", {})
        if not isinstance(section, dict):
            section = {}
        return {
            "enabled": bool(section.get("enabled", True)),
            "compaction_trigger_tokens": int(
                section.get("compaction_trigger_tokens", 24000)
            ),
            "verbatim_window_tokens": int(
                section.get("verbatim_window_tokens", 4000)
            ),
            "summary_budget_tokens": int(
                section.get("summary_budget_tokens", 500)
            ),
            "min_verbatim_exchanges": int(
                section.get("min_verbatim_exchanges", 2)
            ),
        }

    @property
    def doc_convert_config(self) -> dict[str, Any]:
        """Document conversion section with defaults filled in."""
        section = self.app_config.get("doc_convert", {})
        if not isinstance(section, dict):
            section = {}
        extensions = section.get(
            "extensions",
            [".docx", ".pdf", ".pptx", ".xlsx", ".csv", ".rtf", ".odt", ".odp"],
        )
        if not isinstance(extensions, list):
            extensions = []
        return {
            "enabled": bool(section.get("enabled", True)),
            "extensions": [str(e) for e in extensions],
            "max_source_size_mb": int(section.get("max_source_size_mb", 50)),
        }

    @property
    def doc_index_config(self) -> dict[str, Any]:
        """Document index section with defaults filled in.

        Consumed by Layer 2's keyword enricher. Ranges and thresholds
        follow specs4/2-indexing/keyword-enrichment.md.
        """
        section = self.app_config.get("doc_index", {})
        if not isinstance(section, dict):
            section = {}
        ngram = section.get("keywords_ngram_range", [1, 2])
        if not isinstance(ngram, list) or len(ngram) != 2:
            ngram = [1, 2]
        return {
            "keyword_model": str(
                section.get("keyword_model", "BAAI/bge-small-en-v1.5")
            ),
            "keywords_enabled": bool(section.get("keywords_enabled", True)),
            "keywords_top_n": int(section.get("keywords_top_n", 3)),
            "keywords_ngram_range": [int(ngram[0]), int(ngram[1])],
            "keywords_min_section_chars": int(
                section.get("keywords_min_section_chars", 50)
            ),
            "keywords_min_score": float(section.get("keywords_min_score", 0.3)),
            "keywords_diversity": float(section.get("keywords_diversity", 0.5)),
            "keywords_tfidf_fallback_chars": int(
                section.get("keywords_tfidf_fallback_chars", 150)
            ),
            "keywords_max_doc_freq": float(
                section.get("keywords_max_doc_freq", 0.6)
            ),
        }

    @property
    def agents_config(self) -> dict[str, Any]:
        """Agent-mode section with defaults filled in.

        Gates the parallel-agents capability described in
        specs4/7-future/parallel-agents.md. Until agent mode is
        implemented, this flag only affects whether the system
        prompt's agent-spawn block description is visible to the
        LLM — it does not change any runtime code path beyond
        :meth:`get_system_prompt`'s fenced-section stripping.

        Kept separate from :attr:`agents_enabled` so future
        agent-mode settings (max concurrent agents, per-agent
        token budget, synthesis delay) can be added to the dict
        without changing the bool accessor's shape.
        """
        section = self.app_config.get("agents", {})
        if not isinstance(section, dict):
            section = {}
        return {
            "enabled": bool(section.get("enabled", False)),
        }

    @property
    def agents_enabled(self) -> bool:
        """Convenience accessor — True when agent mode is on.

        Callers in the hot prompt-assembly path read this rather
        than unpacking the config dict on every turn. Defaults to
        False — agent mode is strictly opt-in.
        """
        return self.agents_config["enabled"]

    # ------------------------------------------------------------------
    # Directory accessors
    # ------------------------------------------------------------------

    @property
    def repo_root(self) -> Path | None:
        """The git repository root, if one was supplied."""
        return self._repo_root

    @property
    def config_dir(self) -> Path:
        """The resolved user config directory."""
        return self._user_dir

    @property
    def ac_dc_dir(self) -> Path | None:
        """The per-repo ``.ac-dc/`` directory, if a repo was supplied."""
        if self._repo_root is None:
            return None
        return self._repo_root / _AC_DC_DIR

    # ------------------------------------------------------------------
    # Hot-reload
    # ------------------------------------------------------------------

    def reload_llm_config(self) -> None:
        """Re-read ``llm.json`` and re-apply env vars.

        Called by the Settings RPC after the user edits LLM config.
        Clearing the cached dict forces the next accessor call to
        re-read from disk. Env vars are re-applied immediately so
        new API keys take effect without waiting for the next LLM
        request.
        """
        self._llm_config = None
        self.apply_llm_env()

    def reload_app_config(self) -> None:
        """Re-read ``app.json``.

        Downstream consumers that access ``compaction_config``,
        ``doc_index_config``, etc. through this ConfigManager will
        see the new values on their next access — no need to rebuild
        the compactor or the doc index.
        """
        self._app_config = None

    # ------------------------------------------------------------------
    # Prompt assembly helpers
    # ------------------------------------------------------------------
    #
    # Prompts are read fresh from disk on every call — no caching.
    # Edits to system.md or system_extra.md take effect on the next
    # LLM request without an explicit reload call.

    def _concat_prompt(self, main: str, extra_filename: str = "system_extra.md") -> str:
        """Concatenate a main prompt with the optional extra prompt.

        The extra file may be absent (a fresh install creates it from
        the bundle, but the bundle's copy is empty) — in that case we
        return just the main prompt. Non-empty extras are separated
        from the main prompt by a blank line so the LLM treats them
        as distinct instructions.
        """
        extra = self._read_user_file(extra_filename).strip()
        if not extra:
            return main
        return f"{main}\n\n{extra}"

    def get_system_prompt(self) -> str:
        """Main coding-agent system prompt.

        Assembly order (top to bottom):

        1. ``system.md`` — base prompt
        2. ``system_agentic_appendix.md`` — appended only when
           ``agents_enabled`` is True AND the file exists in
           the user config dir. Describes the agent-spawn
           capability to the LLM. When ``False`` or file
           absent, the LLM is never told about agent mode —
           it cannot emit agent-spawn blocks even if
           ``app.json`` somehow carries a stale reference.
        3. ``system_extra.md`` — user customisation, always
           appended last so project-specific rules apply to
           everything above.

        Each section is separated from the next by a blank
        line. Absent or empty sections are skipped cleanly —
        a user install without the agentic appendix file
        (e.g., stripped-down release, or user-deleted file)
        falls through to the extra prompt without error.

        The appendix falls back to the bundled copy when the
        user-dir file is absent. This matters because
        ``system_agentic_appendix.md`` was added to the
        managed-files set in a specific release — users who
        installed AC⚡DC before that release have a version
        marker that prevents the upgrade pass from copying the
        file, but their toggle-enabled state still expects the
        appendix text to flow into the prompt. The fallback
        papers over this cross-version gap so "toggle on" reliably
        produces agent instructions regardless of install
        history. Users who explicitly want to suppress the
        appendix text can do so via the ``agents.enabled`` flag
        in ``app.json`` (which the Settings-tab toggle writes
        to); there is no use case for "toggle on but appendix
        text suppressed" that warrants a second independent
        control.
        """
        main = self._read_user_file("system.md")
        if self.agents_enabled:
            # Read from the user dir first, falling back to
            # the bundle when the user file is absent.
            #
            # The user-dir file is created by the upgrade
            # pass on install. However, users who installed
            # AC⚡DC before `system_agentic_appendix.md` was
            # added to the managed-files set have a version
            # marker that prevents the upgrade pass from
            # copying the file — the early-return on
            # matching versions skips the per-file check.
            # The bundle fallback papers over this
            # cross-version gap so "toggle on" reliably
            # produces agent instructions regardless of
            # install history.
            #
            # A user who wants to opt out of the appendix
            # text while keeping the toggle on must set
            # `agents.enabled: false` in `app.json` —
            # deleting the appendix file no longer
            # suppresses it (the bundle is still present).
            # This is a deliberate trade-off: reliability
            # of the toggle across install histories
            # outweighs the niche escape hatch of partial
            # opt-out via file deletion.
            appendix = self._read_user_file(
                "system_agentic_appendix.md"
            ).strip()
            if appendix:
                main = f"{main}\n\n{appendix}"
        return self._concat_prompt(main)

    def get_doc_system_prompt(self) -> str:
        """Document-mode system prompt (``system_doc.md`` + extra).

        Used when the user switches to document mode. The extra
        prompt is appended in both code and document modes — user
        customisations apply to both.
        """
        main = self._read_user_file("system_doc.md")
        return self._concat_prompt(main)

    def get_agent_system_prompt(self) -> str:
        """System prompt for spawned agent conversations.

        Per specs4/7-future/parallel-agents.md § Execution
        Model, agents run through the same streaming pipeline
        as main-conversation turns — same edit parsing, same
        apply path, same tool surface. They therefore need
        the same behavioural instructions as a non-agent
        turn: the core coding-agent system prompt plus any
        user customisation.

        Differs from :meth:`get_system_prompt` in one way:
        the agentic appendix is NEVER appended, regardless
        of the ``agents.enabled`` toggle. Tree depth is 1
        per spec — agents don't spawn sub-agents — so
        describing the spawn capability to an agent would
        be misleading (it could emit agent-spawn blocks
        that the parent's ``_is_child_request`` gate
        silently drops). Omitting the appendix keeps the
        agent focused on its task and saves tokens.

        Assembly: ``system.md`` → ``system_extra.md``.
        Same user-customisation contract as the main
        prompt.
        """
        main = self._read_user_file("system.md")
        return self._concat_prompt(main)

    def get_review_prompt(self) -> str:
        """Code review system prompt (``review.md`` + extra).

        Used when the user enters review mode. The extra prompt is
        appended here too so project-specific review guidance lives
        alongside project-specific coding guidance.
        """
        main = self._read_user_file("review.md")
        return self._concat_prompt(main)

    def get_compaction_prompt(self) -> str:
        """Topic-boundary detection prompt for the history compactor.

        Loaded as-is — the extra prompt does not apply because the
        compactor is a narrow auxiliary LLM call whose output format
        is rigidly defined (JSON schema).
        """
        return self._read_user_file("compaction.md")

    def get_commit_prompt(self) -> str:
        """Commit message generation prompt.

        Loaded as-is — same rationale as the compaction prompt.
        Narrow task, rigid output format.
        """
        return self._read_user_file("commit.md")

    def get_system_reminder(self) -> str:
        """Edit-format reminder appended to every user prompt.

        Returns a string prefixed with two newlines so callers can
        simply append it to the user's message. Empty when the
        reminder file is absent (shouldn't happen in practice — it's
        a managed file copied on every upgrade).
        """
        body = self._read_user_file("system_reminder.md").strip()
        if not body:
            return ""
        return f"\n\n{body}"

    # ------------------------------------------------------------------
    # Snippets
    # ------------------------------------------------------------------

    def get_snippets(self, mode: str = "code") -> list[dict[str, str]]:
        """Load quick-insert snippets for a mode.

        Parameters
        ----------
        mode:
            One of ``"code"`` (default), ``"review"``, or ``"doc"``.

        Resolution order (two-location fallback):

        1. Per-repo override at ``<repo_root>/.ac-dc/snippets.json``
        2. User config directory ``snippets.json``

        The first file that exists and parses is used; further
        fallback is not attempted. Returns an empty list on any
        failure rather than raising — a broken snippets file must
        not break the chat UI.

        Supports both the canonical nested format::

            {"code": [...], "review": [...], "doc": [...]}

        and the legacy flat format::

            {"snippets": [{"mode": "code", ...}, ...]}

        Legacy entries missing a ``mode`` field default to ``code``.
        """
        data = self._load_snippets_data()
        if not data:
            return []

        # Nested format — the mode key maps directly to its list.
        if mode in data and isinstance(data[mode], list):
            return [s for s in data[mode] if isinstance(s, dict)]

        # Legacy flat format — filter by mode field.
        if isinstance(data.get("snippets"), list):
            result: list[dict[str, str]] = []
            for entry in data["snippets"]:
                if not isinstance(entry, dict):
                    continue
                entry_mode = entry.get("mode", "code")
                if entry_mode == mode:
                    result.append(entry)
            return result

        return []

    def _load_snippets_data(self) -> dict[str, Any]:
        """Load and parse the snippets file with two-location fallback.

        Per-repo override takes precedence so users can customise
        snippets for individual repos without editing their global
        config.
        """
        # 1. Per-repo override.
        if self._repo_root is not None:
            repo_override = self._repo_root / _AC_DC_DIR / "snippets.json"
            if repo_override.is_file():
                try:
                    parsed = json.loads(
                        repo_override.read_text(encoding="utf-8")
                    )
                    if isinstance(parsed, dict):
                        return parsed
                    logger.warning(
                        "Per-repo snippets root is not an object; "
                        "falling back to user config"
                    )
                except (OSError, json.JSONDecodeError) as exc:
                    logger.warning(
                        "Failed to read per-repo snippets: %s; "
                        "falling back to user config",
                        exc,
                    )

        # 2. User config directory.
        return self._read_user_json("snippets.json")