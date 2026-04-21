"""Logging configuration for AC-DC.

Installed by :func:`ac_dc.cli.main` before any other code path runs, so
every log statement from Layer 1 onward lands on a consistent handler.
Kept narrow — one public function, idempotent, no global mutable state
beyond what :mod:`logging` already owns.

Idempotence matters because:

- Tests import and configure the logger repeatedly.
- Future hot-reload paths (e.g. re-applying user config after a settings
  edit) may want to re-invoke ``configure`` with a different verbosity
  without stacking handlers.

Noisy-library capping matters because:

- ``--verbose`` sets the root to DEBUG, which otherwise floods the
  console with per-frame WebSocket logs and per-request LLM payloads.
  Our own DEBUG output would be unreadable.
- The cap is INFO rather than WARNING so operators can still see
  meaningful library-level messages (connection lifecycle, request
  start/end) without drowning in per-frame chatter.

stderr rather than stdout because:

- stdout is reserved for protocol output in future layers (e.g. a
  subprocess pipe for the Vite dev server, or machine-readable RPC
  dumps). Log noise on stdout could corrupt that channel.
- Matches the established CLI convention (git, ssh, build tools all
  log to stderr).
"""

from __future__ import annotations

import logging
import sys

# Sentinel attribute attached to the root logger the first time
# ``configure`` runs. Subsequent calls see the sentinel and skip
# handler construction — they only update levels. This is how we
# achieve idempotence without introducing a module-level flag (which
# would leak state across test boundaries that reset the root
# logger's handlers).
_SENTINEL_ATTR = "_ac_dc_logging_configured"

# Third-party loggers that emit at DEBUG level prolifically. Capped at
# INFO even when the root is DEBUG so ``--verbose`` remains useful for
# our own code. Casing matches what each library actually uses for its
# logger name — ``litellm`` and ``LiteLLM`` both appear in the wild
# depending on import path, so we set both.
_NOISY_LIBRARIES = (
    "websockets",
    "litellm",
    "LiteLLM",
    "urllib3",
    "httpx",
    "httpcore",
)

# Format: timestamp, level, logger name, message. Timestamps are kept
# because a terminal app can run for hours and the relative ordering of
# log lines across subsystems matters during debugging. The logger name
# enables ``grep ac_dc.repo`` workflows.
_LOG_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"
_DATE_FORMAT = "%H:%M:%S"


def configure(verbose: bool = False) -> None:
    """Install a stderr handler on the root logger.

    Parameters
    ----------
    verbose:
        When True, set root level to DEBUG. When False, INFO.

    Safe to call multiple times — the first call installs the handler,
    subsequent calls only update the level. Noisy-library caps are
    re-applied on every call so a change in verbosity still enforces
    the cap.
    """
    root = logging.getLogger()

    if not getattr(root, _SENTINEL_ATTR, False):
        # First-time setup. Install a single stderr handler with our
        # formatter. Using ``StreamHandler(sys.stderr)`` explicitly
        # rather than the default-constructed handler (which also
        # targets stderr but via ``sys.stderr`` captured at handler
        # construction time, which can get stale in test environments
        # that swap out sys.stderr).
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter(_LOG_FORMAT, datefmt=_DATE_FORMAT))
        # Mark the handler so tests (and any future introspection) can
        # identify it unambiguously. Format-string matching is
        # unreliable — pytest's caplog machinery sometimes produces
        # handlers whose formatter happens to share our format string.
        # An explicit attribute on the handler instance can't collide.
        handler._ac_dc_handler = True  # type: ignore[attr-defined]
        root.addHandler(handler)
        setattr(root, _SENTINEL_ATTR, True)

    # Level is set (or updated) on every call so a second invocation
    # with a different verbose value actually changes the effective
    # level. Without this, a test that calls configure(verbose=False)
    # after configure(verbose=True) would still see DEBUG output.
    root.setLevel(logging.DEBUG if verbose else logging.INFO)

    # Noisy-library caps are re-applied on every call. The caps are
    # per-logger levels — setting them once would be enough in practice,
    # but re-applying is cheap and makes the behaviour independent of
    # call order.
    for name in _NOISY_LIBRARIES:
        logging.getLogger(name).setLevel(logging.INFO)