"""Settings RPC service — Layer 1 (deferred) / Layer 4.4.2 (restriction).

The Settings service exposes a narrow, whitelisted surface for reading
and writing user-editable config files. It's registered alongside
:class:`Repo` and :class:`LLMService` via ``server.add_class(settings)``
so the browser can call ``Settings.get_config_content(...)`` etc.

Scope pinned by specs4/1-foundation/configuration.md#settings-service
and specs4/1-foundation/rpc-inventory.md:

- **Whitelisted config types only.** The :data:`CONFIG_TYPES` map in
  :mod:`ac_dc.config` is the authoritative allow-list. Callers pass
  a type key (``"litellm"``, ``"system"``, etc.); the service maps
  that to a real filename and reads / writes inside the user config
  directory. Arbitrary paths are rejected — a caller that asks for
  ``"commit"`` (loaded internally but not exposed for UI editing)
  gets an error, not the file content.

- **Reload is type-aware.** Editing ``llm.json`` re-applies env vars
  and rebinds the model name; editing ``app.json`` invalidates the
  compaction / doc-index / url-cache caches. Markdown prompts are
  read fresh on every request (no cache to invalidate), so save is
  sufficient — no reload RPC needed for prompt edits. Snippets are
  the same — loaded on demand.

- **Localhost-only for writes and reloads.** Specs4's collaboration
  policy treats config edits as mutation-class operations. Read
  methods (``get_config_content``, ``get_config_info``,
  ``get_snippets``, ``get_review_snippets``) are always allowed;
  write and reload methods check :meth:`_check_localhost_only` and
  return the restricted-error shape when a non-localhost
  participant calls them. Matches the pattern established in
  :class:`Repo` and :class:`LLMService` in Layer 4.4.2.

- **No caller-side file discovery.** The browser asks for a config
  type; the service maps it to the disk path. Arbitrary paths
  never cross the RPC boundary — makes it impossible for a
  misbehaving client to read or write outside the user config
  dir.

- **Direct file I/O, not going through private ConfigManager
  methods.** :class:`ConfigManager` has an internal
  ``_read_user_file`` that falls back to the bundle when the user
  file is absent. That fallback is wrong for Settings — we want to
  present the user's edited content, not silently show the bundle
  when the user file is missing. Read directly from
  ``config.config_dir / filename`` so the UI reflects the actual
  on-disk state.

Design notes:

- **JSON validation on write is advisory.** The service tries
  ``json.loads`` on ``.json``-suffixed content after a successful
  write and emits a warning to the returned dict when parse fails.
  The file is still written — users may save a broken file
  intentionally (mid-edit) and reload it later. Rejecting malformed
  JSON at the write boundary would force users into a third-party
  editor to fix syntax errors.

- **Reload is a separate RPC, not implicit on save.** Specs4 says
  "For reloadable configs, save automatically triggers the
  corresponding reload RPC" — but the frontend controls that
  dispatch, not the service. The service exposes `reload_llm_config`
  and `reload_app_config` as distinct calls so the UI can decide
  (e.g., after a save succeeded AND passed JSON validation). A
  separate Reload button is also available for the user-edited-on-
  disk case.

- **`get_config_info` returns a snapshot.** Model names, smaller
  model names, config dir path. Used by the Settings tab's info
  banner. Returns a dict rather than individual fields so the
  browser can render the whole banner from one RPC call.

Governing spec: ``specs4/1-foundation/configuration.md#settings-service``.
Restriction pattern: ``specs4/1-foundation/communication-layer.md#restricted-operations``.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from ac_dc.config import CONFIG_TYPES

if TYPE_CHECKING:
    from ac_dc.config import ConfigManager

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Reload-trigger map
# ---------------------------------------------------------------------------
#
# Which config types cause a reload call into ConfigManager on save.
# Markdown prompts are read fresh on every request via the prompt
# helpers (get_system_prompt etc.), so no reload is needed — edits
# take effect on the next LLM request. Snippets are the same —
# loaded on demand.
#
# "litellm" → reload_llm_config (also re-applies env vars)
# "app"     → reload_app_config (invalidates compaction/doc-index caches)
# Everything else → no reload needed.

_RELOADABLE_TYPES = frozenset({"litellm", "app"})


class Settings:
    """Config-editing RPC service.

    Construct once per backend process and register via
    ``server.add_class(settings)``. Holds a reference to the
    :class:`ConfigManager` — the authoritative owner of config
    state — and delegates all heavy lifting to it. The Settings
    service is just the RPC surface.

    Thread-safety — reads and writes run on the event loop thread.
    No internal state beyond the config manager reference and the
    collab reference (for localhost checks).
    """

    def __init__(
        self,
        config: "ConfigManager",
        llm_service: "Any | None" = None,
    ) -> None:
        """Construct against an existing ConfigManager.

        Parameters
        ----------
        config:
            The central config manager. Settings never replaces
            the instance; saves write to disk and then (optionally)
            ask the config manager to reload.
        llm_service:
            Optional :class:`LLMService` reference. When provided,
            :meth:`reload_app_config` calls
            :meth:`LLMService.refresh_system_prompt` after the
            config reload succeeds, so app-config changes that
            affect prompt composition (notably the
            ``agents.enabled`` toggle) take effect on the next
            LLM request rather than waiting for the next mode
            switch or session restart. When None, config reload
            still works — the prompt refresh just doesn't fire,
            matching the pre-commit-3 behaviour. Tests that
            construct Settings without an LLM service continue
            to pass unchanged.
        """
        self._config = config
        self._llm_service = llm_service
        # Collaboration reference — set by main.py when collab mode
        # is active, None otherwise. When None, every caller is
        # treated as localhost. Matches the pattern on Repo and
        # LLMService.
        self._collab: Any = None

    # ------------------------------------------------------------------
    # Localhost-only guard
    # ------------------------------------------------------------------

    def _check_localhost_only(self) -> dict[str, Any] | None:
        """Return a restricted-error dict when the caller is non-localhost.

        Same contract as :meth:`Repo._check_localhost_only` and
        :meth:`LLMService._check_localhost_only` — returns None for
        allowed callers (no collab attached, or localhost), returns
        the specs4-mandated shape otherwise. Fails closed on collab
        check exceptions — better to deny a legitimate call than to
        let an unauthenticated caller mutate config.
        """
        if self._collab is None:
            return None
        try:
            is_local = self._collab.is_caller_localhost()
        except Exception as exc:
            logger.warning(
                "Collab localhost check raised: %s; denying",
                exc,
            )
            return {
                "error": "restricted",
                "reason": (
                    "Internal error checking caller identity"
                ),
            }
        if is_local:
            return None
        return {
            "error": "restricted",
            "reason": (
                "Participants cannot perform this action"
            ),
        }

    # ------------------------------------------------------------------
    # Whitelist helpers
    # ------------------------------------------------------------------

    def _resolve_filename(self, type_key: str) -> str | None:
        """Map a whitelisted type key to its filename, or None.

        Returns None for unknown types — caller produces the error
        dict with a consistent message.
        """
        return CONFIG_TYPES.get(type_key)

    # ------------------------------------------------------------------
    # Read operations (always allowed)
    # ------------------------------------------------------------------

    def get_config_content(self, type_key: str) -> dict[str, Any]:
        """Return the raw content of a whitelisted config file.

        Reads directly from the user config directory — NOT via
        :meth:`ConfigManager._read_user_file`, which falls back to
        the bundle when the user file is missing. For the Settings
        UI we want to present the user's actual on-disk state, so
        a missing user file returns an empty string (the bundle's
        defaults will be copied on the next startup anyway).

        Parameters
        ----------
        type_key:
            One of the whitelisted types from :data:`CONFIG_TYPES`.
            Unknown keys return an error dict.

        Returns
        -------
        dict
            ``{"type": type_key, "content": "..."}`` on success.
            ``{"error": "..."}`` on unknown type or read failure.
            Missing user files succeed with empty content — the
            Settings UI opens a fresh editor.
        """
        filename = self._resolve_filename(type_key)
        if filename is None:
            return {"error": f"Unknown config type: {type_key!r}"}
        path = self._config.config_dir / filename
        if not path.is_file():
            # Missing file — return empty content. The next save
            # will create the file; startup will repopulate from
            # the bundle.
            return {"type": type_key, "content": ""}
        try:
            content = path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning(
                "Failed to read config %s (%s): %s",
                type_key, filename, exc,
            )
            return {"error": f"Read failed: {exc}"}
        return {"type": type_key, "content": content}

    def get_config_info(self) -> dict[str, Any]:
        """Return a snapshot of current config state for the UI banner.

        Used by the Settings tab's info banner to show which model
        is currently configured and where the config files live.
        """
        return {
            "model": self._config.model,
            "smaller_model": self._config.smaller_model,
            "config_dir": str(self._config.config_dir),
        }

    def get_snippets(self) -> list[dict[str, str]]:
        """Return code-mode snippets.

        Layer 4.3 adds review snippets and doc-mode dispatch via
        :meth:`LLMService.get_snippets`. The Settings-level helper
        is a simpler direct access to the code snippets, used by
        the snippet editor in the Settings UI.
        """
        return self._config.get_snippets("code")

    def get_review_snippets(self) -> list[dict[str, str]]:
        """Return review-mode snippets."""
        return self._config.get_snippets("review")

    # ------------------------------------------------------------------
    # Write operations (localhost-only)
    # ------------------------------------------------------------------

    def save_config_content(
        self,
        type_key: str,
        content: str,
    ) -> dict[str, Any]:
        """Write content to a whitelisted config file.

        JSON content is validated advisorily — a parse failure
        emits a warning in the result but the file is still
        written. Users may save a partially-edited file and
        continue editing.

        Parameters
        ----------
        type_key:
            Whitelisted config type.
        content:
            New file content as a string.

        Returns
        -------
        dict
            ``{"status": "ok", "type": type_key}`` on success.
            ``{"status": "ok", "type": type_key, "warning": "..."}``
            when JSON validation failed but the write succeeded.
            ``{"error": "..."}`` on unknown type or write failure.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
        filename = self._resolve_filename(type_key)
        if filename is None:
            return {"error": f"Unknown config type: {type_key!r}"}
        path = self._config.config_dir / filename
        try:
            # Ensure the directory exists. The config manager
            # creates it at construction, but a later directory
            # deletion (rare but possible) shouldn't wedge the
            # save path.
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        except OSError as exc:
            logger.warning(
                "Failed to write config %s (%s): %s",
                type_key, filename, exc,
            )
            return {"error": f"Write failed: {exc}"}

        # Advisory JSON validation for .json-suffixed files.
        # The write has already succeeded — we're just telling
        # the user they've got a parse error.
        result: dict[str, Any] = {"status": "ok", "type": type_key}
        if filename.endswith(".json"):
            try:
                json.loads(content)
            except json.JSONDecodeError as exc:
                result["warning"] = f"JSON parse error: {exc}"
        return result

    def reload_llm_config(self) -> dict[str, Any]:
        """Re-read ``llm.json`` and re-apply env vars.

        Called by the Settings UI after a successful save of
        ``llm.json``. Hot-reloaded values take effect on the next
        LLM request without restart — matches specs4's promise of
        "Editing llm.json and calling reload_llm_config reflects
        changes."
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
        try:
            self._config.reload_llm_config()
        except Exception as exc:
            logger.warning(
                "LLM config reload failed: %s", exc
            )
            return {"error": f"Reload failed: {exc}"}
        return {"status": "ok"}

    def reload_app_config(self) -> dict[str, Any]:
        """Re-read ``app.json`` and refresh the system prompt.

        Called by the Settings UI after a successful save of
        ``app.json``. Downstream consumers (compactor, doc index,
        URL cache config) read values through accessor methods, so
        hot-reloaded values take effect on the next access.

        Also asks the LLM service (if wired) to refresh its
        context manager's system prompt. This covers the
        ``agents.enabled`` toggle — flipping it changes
        whether the agentic appendix is appended during
        prompt assembly, but the context manager caches the
        assembled prompt. Without the refresh, the toggle
        would only take effect on the next mode switch or
        session restart — a confusing UX where the Settings
        tab says "agents on" but the LLM doesn't see the
        appendix for several turns.

        The refresh is best-effort: a failing refresh logs a
        warning but doesn't propagate an error back to the
        caller. The config reload itself already succeeded;
        the next mode switch or session restart will pick up
        the new prompt state.
        """
        restricted = self._check_localhost_only()
        if restricted is not None:
            return restricted
        try:
            self._config.reload_app_config()
        except Exception as exc:
            logger.warning(
                "App config reload failed: %s", exc
            )
            return {"error": f"Reload failed: {exc}"}
        # Refresh the system prompt so app-config changes
        # that affect prompt composition take effect
        # immediately. Best-effort — a failure here doesn't
        # invalidate the config reload.
        if self._llm_service is not None:
            try:
                self._llm_service.refresh_system_prompt()
            except Exception as exc:
                logger.warning(
                    "System prompt refresh failed: %s", exc
                )
        return {"status": "ok"}

    # ------------------------------------------------------------------
    # Introspection helper (for diagnostics, not RPC-exposed)
    # ------------------------------------------------------------------

    @staticmethod
    def is_reloadable(type_key: str) -> bool:
        """Return True when saving ``type_key`` should trigger a reload.

        Helper for callers (tests, a future UI-side dispatch layer)
        that want to know whether a save on this type warrants a
        reload RPC. Underscore-prefixed so it's not auto-exposed
        by jrpc-oo's ``add_class`` introspection — actually wait,
        jrpc-oo exposes everything non-underscored. This IS a
        public method. That's fine — it's a pure query with no
        state, safe to expose.
        """
        return type_key in _RELOADABLE_TYPES