"""Tests for ac_dc.logging_setup.

Covers:
- idempotent configuration (no duplicate handlers)
- level switching between verbose and non-verbose
- noisy third-party libraries are capped at INFO even in verbose mode
"""

from __future__ import annotations

import logging

import pytest

from ac_dc.logging_setup import configure


@pytest.fixture(autouse=True)
def reset_ac_dc_handler():
    """Isolate our own handler from other tests.

    ``configure()`` mutates the process-wide root logger. We want each
    test to start without our handler installed and without the
    idempotence sentinel set — so ``configure()`` genuinely runs its
    first-time-setup branch.

    We do NOT try to clear pytest's own log-capture handlers. Pytest
    installs those via its ``_pytest.logging`` plugin as part of
    per-test setup (it happens after autouse fixtures, so clearing
    them here does nothing useful), and touching them breaks caplog
    for any test that uses it. Instead we identify our handler by the
    formatter we installed and restore exactly what we changed.

    The invariant being preserved — "our handler is installed exactly
    once after ``configure()`` runs" — is expressed against the subset
    of handlers that belong to us, not the total count.
    """
    root = logging.getLogger()
    # Snapshot everything we might perturb.
    saved_handlers = list(root.handlers)
    saved_level = root.level
    saved_sentinel = getattr(root, "_ac_dc_logging_configured", False)
    saved_noisy_levels = {
        name: logging.getLogger(name).level
        for name in (
            "websockets",
            "litellm",
            "LiteLLM",
            "urllib3",
            "httpx",
            "httpcore",
        )
    }

    # Clear our sentinel so ``configure()`` runs fresh.
    if hasattr(root, "_ac_dc_logging_configured"):
        delattr(root, "_ac_dc_logging_configured")

    # Defensively remove any stray handlers of ours that leaked from a
    # prior test — identified by the unique marker attribute set in
    # ``configure()``. Pytest's own caplog handlers are left in place.
    root.handlers = [
        h for h in root.handlers if not getattr(h, "_ac_dc_handler", False)
    ]

    try:
        yield
    finally:
        # Remove any handlers ``configure()`` added during the test by
        # restoring the exact snapshot — safer than trying to identify
        # "our" handlers by type, because a test might install another
        # StreamHandler for unrelated reasons.
        root.handlers = saved_handlers
        root.setLevel(saved_level)
        if saved_sentinel:
            setattr(root, "_ac_dc_logging_configured", True)
        elif hasattr(root, "_ac_dc_logging_configured"):
            delattr(root, "_ac_dc_logging_configured")
        for name, lvl in saved_noisy_levels.items():
            logging.getLogger(name).setLevel(lvl)


def _ac_dc_handlers():
    """Return the handlers ``configure()`` installed on the root logger.

    Identified by the ``_ac_dc_handler`` attribute we set when
    constructing the handler. Format-string matching turned out to be
    unreliable — pytest's caplog machinery produced handlers whose
    formatters shared our format string under some configurations.
    An explicit marker attribute is collision-proof.
    """
    return [
        h
        for h in logging.getLogger().handlers
        if getattr(h, "_ac_dc_handler", False)
    ]


def test_configure_installs_single_handler():
    """First call to configure() attaches exactly one of our handlers.

    Pytest's caplog plugin installs its own handlers on the root logger
    for every test — we only assert about the handlers that belong to
    us (identified by our formatter's format string).
    """
    assert _ac_dc_handlers() == []

    configure(verbose=False)

    ours = _ac_dc_handlers()
    assert len(ours) == 1
    assert isinstance(ours[0], logging.StreamHandler)


def test_configure_is_idempotent():
    """Calling configure() multiple times doesn't stack our handler.

    This is the key invariant — in normal runtime the CLI calls
    configure() once, but tests and future call paths (hot-reload,
    re-init after a config change) must be safe to call it again.
    """
    configure(verbose=False)
    configure(verbose=False)
    configure(verbose=True)

    assert len(_ac_dc_handlers()) == 1


def test_verbose_false_sets_info_level():
    """Non-verbose mode uses INFO level."""
    configure(verbose=False)
    assert logging.getLogger().level == logging.INFO


def test_verbose_true_sets_debug_level():
    """Verbose mode uses DEBUG level."""
    configure(verbose=True)
    assert logging.getLogger().level == logging.DEBUG


def test_second_call_updates_level():
    """Subsequent calls update the level even though handler is kept."""
    configure(verbose=False)
    assert logging.getLogger().level == logging.INFO

    configure(verbose=True)
    assert logging.getLogger().level == logging.DEBUG

    configure(verbose=False)
    assert logging.getLogger().level == logging.INFO


def test_noisy_libraries_are_capped_at_info_in_verbose_mode():
    """Third-party library loggers stay at INFO even when we're verbose.

    Without this cap, enabling --verbose would flood the console with
    per-frame WebSocket logs and per-request LLM payloads, making our
    own DEBUG output unreadable.
    """
    configure(verbose=True)

    # Root is DEBUG, but these should be at INFO.
    for noisy_name in (
        "websockets",
        "litellm",
        "LiteLLM",
        "urllib3",
        "httpx",
        "httpcore",
    ):
        noisy_logger = logging.getLogger(noisy_name)
        assert noisy_logger.level == logging.INFO, (
            f"{noisy_name} logger should be capped at INFO, got "
            f"{logging.getLevelName(noisy_logger.level)}"
        )


def test_handler_emits_to_stderr():
    """Our handler writes to stderr, not stdout.

    stdout is reserved for RPC protocol output in future layers (not
    currently, but we're establishing the convention now). Log noise
    on stdout could corrupt that channel.
    """
    import sys

    configure(verbose=False)
    ours = _ac_dc_handlers()
    assert len(ours) == 1
    assert ours[0].stream is sys.stderr


def test_log_format_includes_level_name_and_logger_name():
    """The log format carries enough info to filter output by module.

    We don't pin the exact format string — it can evolve — but we do
    require that both the level name and the logger name appear, since
    downstream grep/log-parsing workflows depend on them.
    """
    configure(verbose=True)
    root = logging.getLogger()
    formatter = root.handlers[0].formatter

    sample = logging.LogRecord(
        name="ac_dc.something",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="hello world",
        args=(),
        exc_info=None,
    )
    formatted = formatter.format(sample)

    assert "INFO" in formatted
    assert "ac_dc.something" in formatted
    assert "hello world" in formatted