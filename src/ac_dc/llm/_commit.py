"""Commit and reset flow — git write operations.

Extracted from :mod:`ac_dc.llm_service` to keep that module
focused on the service class and its RPC surface. Three
entry points:

- :func:`commit_all` — stage all changes, generate a commit
  message via the smaller model, commit, and record a
  system event in both context and history. Captures the
  session ID synchronously on the event-loop thread before
  launching the background task (D10: a concurrent
  session restore during a hypothetical reconnect could
  otherwise replace ``self._session_id`` mid-task, causing
  the commit event to persist to the wrong session).
- :func:`reset_to_head` — discard uncommitted changes,
  record a system event. Synchronous — no LLM call, no
  background task.
- :func:`generate_commit_message` — internal helper that
  runs a blocking LiteLLM call in the aux executor to
  produce a commit message from a staged diff.

Governing spec: :doc:`specs-reference/3-llm/streaming`
§ Commit flow.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from ac_dc.llm._helpers import (
    _classify_litellm_error,
    _resolve_max_output_tokens,
)
from ac_dc.token_counter import TokenCounter

if TYPE_CHECKING:
    from ac_dc.llm_service import LLMService

logger = logging.getLogger("ac_dc.llm_service")


# ---------------------------------------------------------------------------
# Commit — public RPC entry
# ---------------------------------------------------------------------------


async def commit_all(service: "LLMService") -> dict[str, Any]:
    """Stage all changes, generate a commit message, and commit.

    Returns ``{"status": "started"}`` immediately. The actual
    work runs as a background task launched via
    :func:`asyncio.ensure_future`. On completion, a
    ``commitResult`` event is broadcast.

    **Session ID capture contract:** captured synchronously
    on the event-loop thread BEFORE launching the background
    task. Passed into :func:`commit_all_background` as a
    parameter. A concurrent ``_restore_last_session`` during
    a hypothetical browser reconnect could otherwise replace
    ``service._session_id`` mid-task and the commit event
    would persist to a different session. Pattern mirrors
    specs3's commit-flow invariant.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    if service._committing:
        return {"error": "A commit is already in progress"}
    if service._repo is None:
        return {"error": "No repository attached"}

    # Capture the event loop reference on the RPC thread. The
    # background task's generate_commit_message step will
    # schedule a blocking litellm call via run_in_executor
    # against this loop. Same D10 capture pattern as
    # chat_streaming — any async RPC that spawns executor work
    # must capture the loop here, not inside the background
    # task (where asyncio.get_event_loop() is unreliable).
    service._main_loop = asyncio.get_event_loop()

    # Capture session ID on the event loop thread, before the
    # background task runs. This value is immutable for the
    # lifetime of the task.
    session_id = service._session_id
    service._committing = True

    asyncio.ensure_future(commit_all_background(service, session_id))
    return {"status": "started"}


async def commit_all_background(
    service: "LLMService",
    session_id: str,
) -> None:
    """The commit pipeline — stage, generate, commit, record.

    Runs as a background task. The ``session_id`` parameter
    is the captured value from :func:`commit_all`; never
    read ``service._session_id`` here.
    """
    assert service._repo is not None
    try:
        # Stage all changes first.
        service._repo.stage_all()
        diff = service._repo.get_staged_diff()
        if not diff.strip():
            service._committing = False
            await service._broadcast_event_async(
                "commitResult",
                {"error": "No staged changes to commit"},
            )
            return

        # Generate commit message via the smaller model.
        message = await generate_commit_message(service, diff)
        if not message:
            message = "chore: update files"

        # Commit.
        result = service._repo.commit(message)

        # Record a system event message in context and history.
        event_text = (
            f"**Committed** `{result['sha'][:7]}`\n\n"
            f"```\n{result['message']}\n```"
        )
        service._context.add_message(
            "user", event_text, system_event=True
        )
        # History store: persist with the CAPTURED session_id,
        # not service._session_id.
        if service._history_store is not None:
            service._history_store.append_message(
                session_id=session_id,
                role="user",
                content=event_text,
                system_event=True,
            )

        # Broadcast to all clients.
        await service._broadcast_event_async(
            "commitResult",
            {
                "sha": result["sha"],
                "short_sha": result["sha"][:7],
                "message": result["message"],
                "system_event_message": event_text,
            },
        )

        # Signal the picker to reload. A commit doesn't
        # touch working-tree content but flips every
        # staged file's status badge (S → clean), and
        # previously-clean files may have become
        # untracked if the commit wasn't `stage_all`.
        service._broadcast_event("filesModified", [])
    except Exception as exc:
        logger.exception("Commit failed: %s", exc)
        await service._broadcast_event_async(
            "commitResult", {"error": str(exc)}
        )
    finally:
        service._committing = False


async def generate_commit_message(
    service: "LLMService",
    diff: str,
) -> str:
    """Generate a commit message via the smaller model.

    Runs the blocking LiteLLM call in the aux executor.
    Failures (rate limit, auth, context overflow, unknown
    model) are classified and logged at WARNING; returns
    empty string on any failure so the caller substitutes
    a default message.
    """
    try:
        import litellm
    except ImportError:
        return ""

    prompt = service._config.get_commit_prompt()
    assert service._main_loop is not None
    loop = service._main_loop

    # Smaller model gets its own counter for ceiling lookup —
    # its max_output_tokens may differ from the primary
    # model's. The config override applies across all calls.
    aux_counter = TokenCounter(service._config.smaller_model)
    max_output = _resolve_max_output_tokens(
        service._config, aux_counter
    )

    def _call() -> str:
        try:
            response = litellm.completion(
                model=service._config.smaller_model,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": diff},
                ],
                stream=False,
                max_tokens=max_output,
            )
            return response.choices[0].message.content or ""
        except Exception as exc:
            info = _classify_litellm_error(litellm, exc)
            logger.warning(
                "Commit message generation failed: "
                "type=%s provider=%s model=%s msg=%s",
                info.get("error_type"),
                info.get("provider"),
                info.get("model"),
                info.get("message"),
            )
            return ""

    return await loop.run_in_executor(service._aux_executor, _call)


# ---------------------------------------------------------------------------
# Reset — public RPC entry
# ---------------------------------------------------------------------------


def reset_to_head(service: "LLMService") -> dict[str, Any]:
    """Discard uncommitted changes, record a system event.

    Synchronous RPC — no LLM call, no background task.
    Records the reset as a system event in both the context
    manager's in-memory history and the persistent JSONL
    store. Broadcasts ``filesModified`` with an empty payload
    so the picker reloads its tree (every modified / staged
    file reverts, so badges change wholesale).
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    if service._repo is None:
        return {"error": "No repository attached"}
    try:
        service._repo.reset_hard()
    except Exception as exc:
        return {"error": str(exc)}

    event_text = (
        "**Reset to HEAD** — all uncommitted changes have "
        "been discarded."
    )
    service._context.add_message(
        "user", event_text, system_event=True
    )
    if service._history_store is not None:
        service._history_store.append_message(
            session_id=service._session_id,
            role="user",
            content=event_text,
            system_event=True,
        )

    # Every staged / modified / untracked file reverted
    # to HEAD or was deleted. Picker must reload.
    service._broadcast_event("filesModified", [])

    return {
        "status": "ok",
        "system_event_message": event_text,
    }