"""Streaming pipeline — the LLM call lifecycle.

Extracted from :mod:`ac_dc.llm_service` to keep that module
focused on the service class and its RPC surface. Functions
here own the end-to-end flow from user message through
streamed response to edit application:

- :func:`stream_chat` — the background task orchestrator.
  Syncs file context, re-indexes the repo, persists the user
  message, fetches URLs, injects review context, lazy-inits
  the tracker, assembles messages, runs the LLM call,
  persists the response, spawns agent sub-tasks, and builds
  the completion result. Full per-request pipeline.
- :func:`run_completion_sync` — blocking LiteLLM call. Runs
  in the worker thread. Emits streaming chunks via the
  event callback, accumulates usage, extracts cost,
  classifies exceptions.
- :func:`build_completion_result` — parses the response for
  edit / agent / shell blocks, applies edits via
  :class:`EditPipeline` (gated on review mode), auto-adds
  modified and created files to the scope's selection,
  refreshes their content in the file context, and
  assembles the result dict the browser consumes.
- :func:`accumulate_usage` / :func:`accumulate_cost` —
  fold per-request usage into session totals.
- :func:`detect_and_fetch_urls` / :func:`fetch_url_sync` —
  pre-prompt URL detection, fetch loop via the aux
  executor, context attachment.
- :func:`serialise_edit_result` — EditResult → RPC dict.

Every function takes the :class:`LLMService` as its first
argument. Per-conversation state (history, file context,
tracker, session id, selected files, archival sink) is
threaded via :class:`ConversationScope`; shared
infrastructure (repo, config, indexes, executors, URL
service, guard state) continues to live on ``self``.

Governing specs: :doc:`specs4/3-llm/streaming`,
:doc:`specs4/3-llm/edit-protocol`,
:doc:`specs4/4-features/url-content`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from ac_dc.context_manager import Mode
from ac_dc.edit_protocol import EditResult, parse_text
from ac_dc.history_store import HistoryStore
from ac_dc.llm._helpers import (
    _classify_litellm_error,
    _extract_finish_reason,
    _extract_response_cost,
    _resolve_max_output_tokens,
    build_thinking_kwargs,
    retry_litellm_completion,
)
from ac_dc.llm._types import _URL_PER_MESSAGE_LIMIT

if TYPE_CHECKING:
    from ac_dc.llm._types import ConversationScope
    from ac_dc.llm_service import LLMService

logger = logging.getLogger("ac_dc.llm_service")


# ---------------------------------------------------------------------------
# Top-level stream orchestrator
# ---------------------------------------------------------------------------


async def stream_chat(
    service: "LLMService",
    request_id: str,
    message: str,
    files: list[str],
    images: list[str],
    excluded_urls: list[str] | None = None,
    *,
    scope: "ConversationScope | None" = None,
    agent_key: str | None = None,
    reasoning: bool | None = None,
) -> dict[str, Any]:
    """Background task — the actual streaming logic.

    ``agent_key`` is the agent's LLM-chosen id when this
    stream runs under an agent scope, None for the
    main-conversation path. Used for the per-agent
    single-stream guard slot in
    ``service._active_agent_streams``. See
    :meth:`LLMService._stream_chat` for the full prose
    describing every step.

    ``reasoning`` carries the per-request extended-thinking
    override forwarded by the chat_streaming RPC. ``None``
    defers to ``config.reasoning_enabled``; ``True`` /
    ``False`` force the corresponding state.
    """
    if scope is None:
        scope = service._default_scope()
    # Reset the cache warmer's idle clock to the moment of
    # user send. Two effects:
    #
    # - The next firing is scheduled 240s from now (user
    #   activity), not 240s from stream-end. Streams of
    #   any duration produce a predictable cadence relative
    #   to user interaction.
    # - For long reasoning turns that exceed Anthropic's
    #   5-minute cache TTL, the warmer is allowed to fire
    #   *during* the active stream — its per-tick stream-
    #   active checks have been removed. A reasoning run
    #   at T=350+ will see the warmer fire at T=240,
    #   keeping the cache hot through the in-flight call's
    #   completion so follow-up turns hit a warm cache.
    #   This is parallel to the user's main stream, not
    #   serialised with it; Anthropic supports concurrent
    #   requests on the same key, and a 2-token warm-up
    #   ping is negligible against an in-flight reasoning
    #   call.
    warmer = getattr(service, "_cache_warmer", None)
    if warmer is not None:
        warmer.reset("user-send")
    error: str | None = None
    full_content = ""
    cancelled = False
    finish_reason: str | None = None
    request_usage: dict[str, Any] = {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "reasoning_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "prompt_cached_tokens": 0,
        "cost_usd": None,
    }
    # Turn ID groups every record produced by the request
    # (user message, assistant response, any system events
    # fired mid-turn). Per specs4/3-llm/history.md § Turns.
    turn_id = HistoryStore.new_turn_id()
    try:
        # File context sync — remove deselected files, load
        # selected ones.
        service._sync_file_context(scope)

        # Re-index on every request so deletions propagate.
        # Per specs4/2-indexing/* § Triggers. The mtime
        # cache makes unchanged files free; the real cost
        # is the prune walk for stale entries.
        if service._repo is not None:
            try:
                file_list_raw = service._repo.get_flat_file_list()
                file_list = [
                    f for f in file_list_raw.split("\n") if f
                ]
                if service._symbol_index is not None:
                    service._symbol_index.index_repo(file_list)
                if service._doc_index_ready:
                    doc_files = [
                        f for f in file_list
                        if service._doc_index._extension_of(f)
                        in service._doc_index._extractors
                    ]
                    service._doc_index.index_repo(doc_files)
            except Exception as exc:
                logger.warning(
                    "Per-request re-index failed: %s", exc
                )

        # Persist user message BEFORE the LLM call. Mid-
        # stream crash preserves user intent.
        #
        # Images are intentionally NOT threaded into
        # `_history` — only the text part of the user
        # message is stored. The current turn's images
        # reach the LLM via prompt assembly's
        # `_build_user_message`, which constructs a
        # multimodal content block list fresh from the
        # `images` parameter every request. Subsequent
        # turns therefore replay only the text.
        #
        # This is deliberate: images are expensive
        # (~1.6K tokens each on Claude) and the assistant's
        # textual response from the turn the image was sent
        # almost always carries forward whatever was
        # relevant about it. Keeping images in replayed
        # history would multiply token cost on every
        # downstream turn for no proportional gain.
        #
        # The history store DOES persist image refs
        # (filenames under `.ac-dc/images/`) so the history
        # browser can reconstruct the original message for
        # display — that's a separate concern from what the
        # LLM sees on subsequent turns.
        if scope.archival_append is not None:
            scope.archival_append(
                "user",
                message,
                session_id=scope.session_id,
                files=list(scope.selected_files) or None,
                images=images if images else None,
                turn_id=turn_id,
            )
        scope.context.add_message(
            "user", message,
            files=list(scope.selected_files) or None,
            turn_id=turn_id,
        )

        # Broadcast to all clients (collaborator sync).
        service._broadcast_event(
            "userMessage", {"content": message}
        )

        # URL detection and fetching. Pre-prompt so fetched
        # content lands in context by the time we assemble.
        await detect_and_fetch_urls(
            service,
            request_id,
            message,
            excluded_urls or [],
            scope=scope,
        )

        # Review context injection. Rebuilt each request so
        # reverse diffs reflect the CURRENT selection.
        if service._review_active:
            service._build_and_set_review_context(scope)
        else:
            # Defensive: clear stale context if review
            # exited abnormally.
            scope.context.clear_review_context()

        # Lazy stability init — retry if eager init failed.
        if not service._stability_initialized.get(
            scope.context.mode, False
        ):
            service._try_initialize_stability()

        # Assemble messages. Tiered when tracker has items;
        # flat fallback during the narrow startup window.
        tiered_content = service._build_tiered_content(scope)
        if tiered_content is None:
            mode = scope.context.mode
            initialised = service._stability_initialized.get(
                mode, False
            )
            tracker_items = len(
                scope.tracker.get_all_items()
            )
            logger.warning(
                "Using flat assembly (tracker empty). "
                "mode=%s init_flag=%s tracker_items=%d "
                "symbol_index=%s doc_index_ready=%s "
                "init_complete=%s",
                mode.value,
                initialised,
                tracker_items,
                service._symbol_index is not None,
                service._doc_index_ready,
                service._init_complete,
            )
            messages = service._assemble_messages_flat(
                message, images, scope
            )
        else:
            messages = service._assemble_tiered(
                message, images, tiered_content, scope
            )

        # Run the LLM call in the stream executor.
        assert service._main_loop is not None
        loop = service._main_loop
        (
            full_content,
            cancelled,
            finish_reason,
            request_usage,
            completion_error,
        ) = await loop.run_in_executor(
            service._stream_executor,
            service._run_completion_sync,
            request_id, messages, loop, reasoning,
        )
        # If the LiteLLM call raised before streaming
        # started, ``run_completion_sync`` returns the
        # diagnostic via the 5th tuple slot. Promote it to
        # the local ``error`` so build_completion_result
        # sets ``result.error`` and the frontend's red-LED
        # path fires. Skip persistence + agent dispatch on
        # this path — there's no real assistant response.
        if completion_error is not None:
            error = completion_error
            full_content = ""

        # Persist assistant response. If the orchestrator emitted
        # any well-formed agent-spawn blocks, persist their
        # ``{id, agent_idx}`` mapping so a future across-turns
        # view can reconstruct each agent's full session
        # transcript. Per specs4/3-llm/history.md § Cross-Turn
        # Agent Reconstruction, the on-disk archive layout
        # (``agent-NN.jsonl``) is keyed by the turn-local
        # numeric ``agent_idx`` while orchestrator addressing is
        # by stable string ``id``; ``agent_idx`` is NOT stable
        # across turns, so we record the mapping at write time.
        # Parsed twice (here and in build_completion_result) —
        # the parser is pure and cheap, and avoiding the
        # duplication would require reshaping the function
        # signatures for marginal gain.
        if full_content or cancelled:
            content_to_store = full_content
            if cancelled and not content_to_store:
                content_to_store = "[stopped]"
            persisted_agent_blocks: list[dict[str, Any]] | None = None
            if full_content and not cancelled:
                _agent_parse = parse_text(full_content)
                # Per Increment 3a: persist each agent's resolved
                # mode, cross-reference flag, and model alongside
                # ``id`` and ``agent_idx``. Reconstruction
                # (Increment 5) will rebuild a ContextManager per
                # agent from the archive content; mode + xref
                # determine which prompt to install, model
                # determines which provider to address.
                #
                # Mode resolution mirrors the agentsSpawned
                # broadcast logic in this same function: existing
                # agents (retask) keep their current mode; fresh
                # spawns resolve via _resolve_agent_mode against
                # the orchestrator's current scope. Model comes
                # from the agent's own ContextManager when
                # known; falls back to the orchestrator's model
                # for fresh spawns whose scope hasn't been built
                # by this point in the function.
                from ac_dc.llm._agents import (
                    _format_mode,
                    _resolve_agent_mode,
                )
                parent_cm = scope.context
                parent_mode = (
                    parent_cm.mode if parent_cm
                    else None
                )
                parent_xref = (
                    parent_cm.cross_reference_enabled
                    if parent_cm else False
                )
                _entries: list[dict[str, Any]] = []
                for idx, b in enumerate(_agent_parse.agent_blocks):
                    if not b.valid:
                        continue
                    entry: dict[str, Any] = {
                        "id": b.id,
                        "agent_idx": idx,
                    }
                    # Resolve mode + xref. Reuse existing agent's
                    # state on retask (per the same precedence
                    # the agentsSpawned broadcast uses) so the
                    # persisted record matches the runtime
                    # scope.
                    existing = (
                        service._agent_contexts.get(b.id)
                    )
                    if (
                        existing is not None
                        and existing.context is not None
                    ):
                        agent_mode = existing.context.mode
                        agent_xref = (
                            existing.context.cross_reference_enabled
                        )
                    elif parent_mode is not None:
                        agent_mode, agent_xref = (
                            _resolve_agent_mode(
                                b.mode,
                                parent_mode,
                                parent_xref,
                            )
                        )
                    else:
                        # No parent context — extremely
                        # defensive; main path always has one.
                        # Skip mode enrichment on this entry.
                        agent_mode = None
                        agent_xref = None
                    if agent_mode is not None:
                        entry["mode"] = _format_mode(
                            agent_mode, bool(agent_xref),
                        )
                        entry["cross_reference_enabled"] = (
                            bool(agent_xref)
                        )
                    # Model: agents inherit the orchestrator's
                    # model today (no per-agent model override
                    # exists in the spawn block format yet).
                    # Read from config rather than the agent's
                    # ContextManager — fresh-spawn scopes don't
                    # exist yet at this persistence point.
                    try:
                        model = service._config.model
                        if isinstance(model, str) and model:
                            entry["model"] = model
                    except Exception:
                        # Defensive: a config read failure must
                        # not block persistence. The reconstruction
                        # path tolerates a missing model field
                        # and falls back to the current config.
                        pass
                    _entries.append(entry)
                if _entries:
                    persisted_agent_blocks = _entries
            scope.context.add_message(
                "assistant", content_to_store,
                turn_id=turn_id,
            )
            if scope.archival_append is not None:
                scope.archival_append(
                    "assistant",
                    content_to_store,
                    session_id=scope.session_id,
                    turn_id=turn_id,
                    agent_blocks=persisted_agent_blocks,
                )

        # Agent-spawn dispatch. Only runs on the normal-
        # completion path: errors and cancellations skip
        # because partial output may carry malformed blocks,
        # and child streams don't spawn sub-agents (tree
        # depth is 1 per spec).
        if (
            not cancelled
            and full_content
            and not service._is_child_request(request_id)
        ):
            agent_parse = parse_text(full_content)
            if agent_parse.agent_blocks:
                valid_blocks = service._filter_dispatchable_agents(
                    agent_parse.agent_blocks,
                    parent_request_id=request_id,
                    turn_id=turn_id,
                )
                if valid_blocks:
                    # Fire agentsSpawned BEFORE the gather
                    # so the frontend creates tabs in time
                    # to receive child streams. Each entry
                    # carries the agent's resolved mode so
                    # the LED-row tooltip can render
                    # ``<id> (<mode>): running`` per spec
                    # ``specs4/5-webapp/agent-browser.md``
                    # § Status LEDs → Click and hover.
                    # Mode resolution mirrors the
                    # spawn-time logic in
                    # :func:`_resolve_or_spawn_agent_scope`
                    # — empty ``block.mode`` inherits from
                    # the parent scope.
                    from ac_dc.llm._agents import (
                        _format_mode,
                        _resolve_agent_mode,
                    )
                    parent_cm = scope.context
                    parent_mode = (
                        parent_cm.mode if parent_cm
                        else Mode.CODE
                    )
                    parent_xref = (
                        parent_cm.cross_reference_enabled
                        if parent_cm else False
                    )
                    agent_block_payload = []
                    for i, b in enumerate(valid_blocks):
                        # Reuse existing agent's mode on
                        # retask so the broadcast payload
                        # matches the runtime scope. The
                        # resolver may yet decide to skip
                        # this block (mode mismatch); the
                        # tab created from this payload
                        # will then never receive child
                        # chunks, but its tooltip stays
                        # accurate to the existing agent.
                        existing = (
                            service._agent_contexts.get(b.id)
                        )
                        if (
                            existing is not None
                            and existing.context is not None
                        ):
                            mode_str = _format_mode(
                                existing.context.mode,
                                existing.context.cross_reference_enabled,
                            )
                        else:
                            resolved_mode, resolved_xref = (
                                _resolve_agent_mode(
                                    b.mode,
                                    parent_mode,
                                    parent_xref,
                                )
                            )
                            mode_str = _format_mode(
                                resolved_mode, resolved_xref,
                            )
                        agent_block_payload.append({
                            "id": b.id,
                            "task": b.task,
                            "agent_idx": i,
                            "mode": mode_str,
                        })
                    await service._broadcast_event_async(
                        "agentsSpawned",
                        {
                            "turn_id": turn_id,
                            "parent_request_id": request_id,
                            "agent_blocks": agent_block_payload,
                        },
                    )
                    await service._spawn_agents_for_turn(
                        valid_blocks,
                        parent_scope=scope,
                        parent_request_id=request_id,
                        turn_id=turn_id,
                    )
    except Exception as exc:
        logger.exception(
            "Streaming request %s failed", request_id
        )
        error = str(exc)

    # Build the completion result. Edit parsing and apply
    # happen only on normal completion: errors, cancellations,
    # and review mode skip the apply step.
    result = await build_completion_result(
        service,
        full_content=full_content,
        user_message=message,
        cancelled=cancelled,
        error=error,
        finish_reason=finish_reason if error is None else None,
        request_usage=request_usage,
        scope=scope,
        turn_id=turn_id,
    )

    # Fire completion event.
    await service._broadcast_event_async(
        "streamComplete", request_id, result
    )

    # Broadcast filesChanged for auto-added / created files,
    # SUPPRESSED for child streams (agent scopes).
    if (
        (result.get("files_auto_added")
         or result.get("files_created"))
        and not service._is_child_request(request_id)
    ):
        service._broadcast_event(
            "filesChanged", list(scope.selected_files)
        )

    # Broadcast filesModified whenever apply wrote to disk.
    # Triggers picker tree reload — newly-created files,
    # refreshed git-status badges, updated line counts.
    modified_paths = result.get("files_modified") or []
    if modified_paths:
        service._broadcast_event(
            "filesModified", list(modified_paths)
        )

    # Clear guard slots. Agent-tagged → per-agent set;
    # untagged main-tab → main slot; child stream → share
    # parent's slot (don't clear).
    if agent_key is not None:
        service._active_agent_streams.discard(agent_key)
    elif not service._is_child_request(request_id):
        service._active_user_request = None
    service._cancelled_requests.discard(request_id)
    # Drop accumulator slot after all reads complete.
    service._request_accumulators.pop(request_id, None)
    # Drop the request → agent map entry. Done last so
    # any final-chunk consumers that need to look up the
    # owning agent can still do so.
    service._active_request_to_agent.pop(request_id, None)

    # Post-response housekeeping — only on normal completion.
    if error is None and not cancelled:
        try:
            await service._post_response(
                request_id, turn_id, scope,
                request_usage=request_usage,
            )
        except Exception as exc:
            logger.exception(
                "Post-response processing for %s failed: %s",
                request_id, exc,
            )

    # Reset the cache warmer — request just finished, so
    # restart the idle timer. The reset is a no-op when
    # the warmer is disabled (auto-disabled by a prior
    # failure, or disabled in config), so it's safe to
    # call unconditionally on every code path.
    warmer = getattr(service, "_cache_warmer", None)
    if warmer is not None:
        warmer.reset("stream-end")

    # Return the completion result so agent spawning's
    # asyncio.gather can collect files_modified /
    # files_created for assimilation.
    return result


# ---------------------------------------------------------------------------
# Blocking LLM call — worker thread
# ---------------------------------------------------------------------------


def run_completion_sync(
    service: "LLMService",
    request_id: str,
    messages: list[dict[str, Any]],
    loop: asyncio.AbstractEventLoop,
    reasoning: bool | None = None,
) -> tuple[str, bool, str | None, dict[str, Any], str | None]:
    """Blocking LLM call — runs in a worker thread.

    Returns ``(full_content, was_cancelled, finish_reason,
    usage_dict, error)``. Schedules chunk callbacks onto the
    main event loop via ``run_coroutine_threadsafe``. See
    :meth:`LLMService._run_completion_sync` for the full
    prose describing usage_dict's shape.

    ``error`` is None on the happy path (including cancel,
    which signals via ``was_cancelled``). It carries the
    diagnostic string when the LiteLLM call raised before
    streaming started — e.g., ``APIConnectionError`` from a
    DNS hiccup or auth failure, or when either watchdog
    fires (no first chunk within
    ``first_chunk_timeout_seconds``, or no chunk for
    ``chunk_timeout_seconds`` mid-stream). The caller
    surfaces it via ``result.error`` so the frontend's
    red-LED + error-card path fires; without this signal,
    the error string would land in ``full_content`` and the
    response would render as a normal assistant message
    with a green LED.

    ``reasoning`` is the per-request extended-thinking
    override. ``None`` falls through to the config default;
    ``True`` / ``False`` force the corresponding state. The
    resolved ``thinking`` kwarg is passed straight into
    ``litellm.completion``.

    Three-layer timeout protection per
    ``specs-reference/3-llm/streaming.md`` § Timeouts:

    1. ``timeout=`` on ``litellm.completion`` itself —
       overall wall-clock cap (default 300s).
    2. First-chunk watchdog — a ``threading.Timer`` that
       closes the stream if no chunk arrives within
       ``first_chunk_timeout_seconds`` (default 60s).
    3. Inter-chunk watchdog — same timer, reset on every
       received chunk, fires after
       ``chunk_timeout_seconds`` of silence (default 120s).

    Watchdog fires call ``stream.close()`` on the stream
    iterator. The blocked ``next()`` then raises, the
    ``for`` loop exits, and we return whatever content
    accumulated with a descriptive error.
    """
    empty_usage: dict[str, Any] = {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "reasoning_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "prompt_cached_tokens": 0,
        "cost_usd": None,
    }
    try:
        import litellm
    except ImportError:
        logger.error("litellm not available; streaming disabled")
        return (
            "",
            False,
            None,
            dict(empty_usage),
            "litellm is not installed on this server",
        )

    # LiteLLM's recommended setting for the
    # Anthropic-thinking + tool-calls compatibility path:
    # when prior assistant turns lack ``thinking_blocks``
    # and the new turn enables ``thinking``, this flag lets
    # LiteLLM gracefully drop the param rather than 400ing.
    # See https://docs.litellm.ai/docs/reasoning_content §
    # "Tool Calling with Reasoning". Set on every call so a
    # fresh worker thread sees it; cheap and idempotent.
    try:
        litellm.modify_params = True
    except AttributeError:
        # Older LiteLLM versions may not expose the flag.
        # The code path that needs it is the same one that
        # produces 400s; users on those versions get the
        # same behaviour they had before this feature.
        pass

    full_content = ""
    was_cancelled = False

    max_output = _resolve_max_output_tokens(
        service._config, service._counter
    )

    # Debug hook — AC_DC_DUMP_PROMPT env var controls
    # prompt dumping. "1"/"true"/"yes"/"full" → full JSON
    # dump; "summary" → per-message role + token counts;
    # anything else → no dump.
    import os as _os
    dump_mode = _os.environ.get(
        "AC_DC_DUMP_PROMPT", ""
    ).lower()
    if dump_mode in ("1", "true", "yes", "full"):
        import json as _json
        import sys as _sys
        print(
            f"\n=== AC_DC_DUMP_PROMPT request={request_id} ===",
            file=_sys.stderr,
        )
        print(
            _json.dumps(messages, indent=2, default=str),
            file=_sys.stderr,
        )
        print(
            "=== end dump ===\n",
            file=_sys.stderr,
        )
    elif dump_mode == "summary":
        import sys as _sys
        print(
            f"\n=== AC_DC_DUMP_PROMPT summary "
            f"request={request_id} ===",
            file=_sys.stderr,
        )
        for i, msg in enumerate(messages):
            role = msg.get("role", "?")
            content = msg.get("content", "")
            if isinstance(content, str):
                tokens = service._counter.count(content)
                preview = content[:80].replace("\n", " ")
                print(
                    f"[{i:3d}] {role:10s} {tokens:7d} tok "
                    f"| {preview}",
                    file=_sys.stderr,
                )
            elif isinstance(content, list):
                tokens = service._counter.count(msg)
                kinds = ",".join(
                    b.get("type", "?") for b in content
                    if isinstance(b, dict)
                )
                print(
                    f"[{i:3d}] {role:10s} {tokens:7d} tok "
                    f"| multimodal [{kinds}]",
                    file=_sys.stderr,
                )
        print(
            "=== end summary ===\n",
            file=_sys.stderr,
        )

    thinking_kwargs = build_thinking_kwargs(
        service._config, reasoning,
    )
    if thinking_kwargs:
        # Log shape varies by model family — adaptive
        # payloads carry no budget field, legacy ones do.
        # See _build_thinking_payload for the dispatch.
        payload = thinking_kwargs["thinking"]
        if payload.get("type") == "adaptive":
            logger.info("Reasoning enabled — adaptive effort")
        else:
            logger.info(
                "Reasoning enabled — budget=%d tokens",
                payload.get("budget_tokens", 0),
            )

    request_timeout = service._config.request_timeout_seconds
    first_chunk_timeout = service._config.first_chunk_timeout_seconds
    chunk_timeout = service._config.chunk_timeout_seconds
    num_retries = service._config.num_retries

    try:
        # Explicit retry wrapper with exponential backoff +
        # Retry-After honoring. Replaces LiteLLM's internal
        # ``num_retries=`` kwarg — stacking the two would
        # multiply waits and mask provider retry hints.
        #
        # For streaming, the retry applies only to stream
        # establishment — once chunks start flowing, a
        # mid-stream failure can't be replayed because the
        # partial response has already been delivered to the
        # UI. The Bedrock 429 pattern we're protecting against
        # raises BEFORE any chunk is received, so this catches
        # it cleanly.
        def _open_stream() -> Any:
            return litellm.completion(
                model=service._config.model,
                messages=messages,
                stream=True,
                stream_options={"include_usage": True},
                max_tokens=max_output,
                timeout=request_timeout,
                **thinking_kwargs,
            )

        # Broadcast retry events to the UI so the user sees
        # progress during the exponential backoff (which can
        # run to minutes on pathological provider behaviour).
        # Callback runs in the worker thread; schedule the
        # async broadcast onto the main event loop so jrpc-oo
        # serialises the send correctly.
        def _on_retry(info: dict[str, Any]) -> None:
            try:
                asyncio.run_coroutine_threadsafe(
                    service._broadcast_event_async(
                        "streamRetry",
                        request_id,
                        info,
                    ),
                    loop,
                )
            except Exception as exc:
                logger.debug(
                    "streamRetry broadcast schedule failed: %s",
                    exc,
                )

        stream = retry_litellm_completion(
            litellm,
            _open_stream,
            max_attempts=num_retries + 1,
            context="streaming completion",
            on_retry=_on_retry,
        )
    except Exception as exc:
        logger.exception("litellm.completion raised")
        service._last_error_info = _classify_litellm_error(
            litellm, exc
        )
        # Return the error via the 5th tuple slot, NOT in
        # full_content. The caller threads this into
        # ``result.error`` so the frontend's
        # ``computeLastEditOutcome`` sees a stream-level
        # error and renders the red LED + typed error card.
        # Putting the error string in full_content would
        # produce a normal assistant message with a green
        # LED — silently mis-classifying a transport
        # failure as a successful response.
        return (
            "",
            False,
            None,
            dict(empty_usage),
            f"LLM call failed: {exc}",
        )

    usage: dict[str, Any] | None = None
    finish_reason: str | None = None
    cost_source: Any = stream

    # ------------------------------------------------------------------
    # Watchdog setup
    # ------------------------------------------------------------------
    #
    # ``threading.Timer`` runs its callback on a separate thread when
    # it expires. The callback closes the stream's underlying HTTP
    # connection (best-effort — we try a few attribute paths because
    # litellm's stream wrapper shape varies by provider). The blocked
    # ``next()`` call inside the ``for`` loop then raises, the loop
    # exits, and we surface a watchdog-fired error.
    #
    # ``watchdog_fired`` is the synchronisation primitive between the
    # timer thread and the worker thread — using a list as a poor
    # man's nonlocal-mutable-bool that's safe under the GIL.
    import threading

    watchdog_fired: list[str | None] = [None]

    def _close_stream_on_watchdog(reason: str) -> None:
        """Force-close the stream when a watchdog fires.

        Called from the timer thread. Sets the reason flag first
        so the worker thread can distinguish a watchdog abort
        from a normal end-of-stream when the iteration exits.
        """
        watchdog_fired[0] = reason
        # Try the documented close paths in order. Different
        # providers wrap the stream differently.
        for attr_path in ("close", "response.close"):
            try:
                target: Any = stream
                for part in attr_path.split("."):
                    target = getattr(target, part, None)
                    if target is None:
                        break
                if callable(target):
                    target()
                    return
            except Exception:
                # Best-effort — if the close path raises, the
                # next iteration will raise too and we still
                # exit the loop.
                continue

    # Arm the first-chunk watchdog before iteration begins.
    timer = threading.Timer(
        first_chunk_timeout,
        _close_stream_on_watchdog,
        args=(
            f"no chunk received within {first_chunk_timeout:.0f}s "
            "of request start",
        ),
    )
    timer.daemon = True
    timer.start()
    first_chunk_seen = False

    try:
        for chunk in stream:
            # Reset the watchdog on every chunk — but use the
            # inter-chunk timeout from the second chunk onward.
            # The first chunk uses the (typically shorter) first-
            # chunk timeout.
            timer.cancel()
            if not first_chunk_seen:
                first_chunk_seen = True
            timer = threading.Timer(
                chunk_timeout,
                _close_stream_on_watchdog,
                args=(
                    f"no chunk for {chunk_timeout:.0f}s mid-stream",
                ),
            )
            timer.daemon = True
            timer.start()

            if request_id in service._cancelled_requests:
                was_cancelled = True
                break

            try:
                choices = chunk.choices
                if choices:
                    delta = choices[0].delta
                    if delta and getattr(delta, "content", None):
                        full_content += delta.content
                        # Mirror into per-request accumulator.
                        # GIL makes the dict write atomic for
                        # string values; event-loop readers see
                        # a consistent string.
                        service._request_accumulators[request_id] = (
                            full_content
                        )
                        # Fire chunk callback with FULL content.
                        asyncio.run_coroutine_threadsafe(
                            service._broadcast_event_async(
                                "streamChunk",
                                request_id,
                                full_content,
                            ),
                            loop,
                        )
            except (AttributeError, IndexError):
                pass  # malformed chunk — skip

            # finish_reason typically on the final chunk.
            reason = _extract_finish_reason(chunk)
            if reason is not None and finish_reason is None:
                finish_reason = reason

            chunk_usage = getattr(chunk, "usage", None)
            if chunk_usage is not None:
                usage = chunk_usage
    except Exception as exc:
        # Iteration raised — either the watchdog closed the
        # stream (in which case watchdog_fired is set) or the
        # provider raised mid-stream for some other reason.
        if watchdog_fired[0] is not None:
            logger.warning(
                "Stream watchdog fired: %s", watchdog_fired[0]
            )
            service._last_error_info = {
                "error_type": "timeout",
                "message": watchdog_fired[0],
                "retry_after": None,
                "status_code": None,
                "provider": None,
                "model": service._config.model,
                "original_type": "WatchdogTimeout",
            }
            timer.cancel()
            return (
                full_content,
                False,
                None,
                dict(empty_usage),
                f"Stream timeout — {watchdog_fired[0]}",
            )
        # Mid-stream provider error.
        logger.exception("Stream iteration raised")
        service._last_error_info = _classify_litellm_error(
            litellm, exc
        )
        timer.cancel()
        return (
            full_content,
            False,
            None,
            dict(empty_usage),
            f"Stream failed mid-response: {exc}",
        )
    finally:
        timer.cancel()

    # Normalise usage into a plain dict for the return.
    request_usage = dict(empty_usage)
    if usage is not None:
        def _get(name: str, source: Any = usage) -> int:
            if isinstance(source, dict):
                val = source.get(name)
            else:
                val = getattr(source, name, None)
            try:
                return int(val) if val is not None else 0
            except (TypeError, ValueError):
                return 0

        def _get_nested(
            parent_name: str, child_name: str
        ) -> int:
            if isinstance(usage, dict):
                parent = usage.get(parent_name)
            else:
                parent = getattr(usage, parent_name, None)
            if parent is None:
                return 0
            return _get(child_name, source=parent)

        request_usage["prompt_tokens"] = _get("prompt_tokens")
        request_usage["completion_tokens"] = _get(
            "completion_tokens"
        )
        request_usage["reasoning_tokens"] = _get_nested(
            "completion_tokens_details", "reasoning_tokens"
        )
        prompt_cached = _get_nested(
            "prompt_tokens_details", "cached_tokens"
        )
        request_usage["prompt_cached_tokens"] = prompt_cached
        request_usage["cache_read_tokens"] = max(
            _get("cache_read_input_tokens"),
            _get("cache_read_tokens"),
            prompt_cached,
        )
        request_usage["cache_write_tokens"] = max(
            _get("cache_creation_input_tokens"),
            _get("cache_creation_tokens"),
        )

    # Cost extraction.
    request_cost = _extract_response_cost(
        cost_source, litellm, usage
    )
    request_usage["cost_usd"] = request_cost

    # Accumulate session totals AFTER request_usage is built
    # so the accumulator uses the same normalised view.
    if usage is not None:
        accumulate_usage(service, usage)
    accumulate_cost(service, request_cost)

    # Log finish_reason for observability.
    if finish_reason is not None:
        if finish_reason in ("stop", "end_turn"):
            logger.info(
                "LLM finish_reason=%r", finish_reason
            )
        else:
            logger.warning(
                "LLM finish_reason=%r "
                "(non-natural stop — response may be incomplete)",
                finish_reason,
            )

    return full_content, was_cancelled, finish_reason, request_usage, None


# ---------------------------------------------------------------------------
# Session-total accumulation
# ---------------------------------------------------------------------------


def accumulate_usage(
    service: "LLMService",
    usage: Any,
) -> None:
    """Fold a per-request usage record into session totals.

    Handles the full normalised shape including nested
    reasoning + OpenAI-cached fields so session totals and
    per-request numbers stay consistent. ``cost_usd`` is
    accumulated separately by :func:`accumulate_cost` — it
    isn't part of the provider's usage dict.
    """
    def _get(
        name: str, source: Any = usage, default: int = 0
    ) -> int:
        if isinstance(source, dict):
            val = source.get(name, default)
        else:
            val = getattr(source, name, default)
        try:
            return int(val) if val is not None else default
        except (TypeError, ValueError):
            return default

    def _get_nested(parent_name: str, child_name: str) -> int:
        if isinstance(usage, dict):
            parent = usage.get(parent_name)
        else:
            parent = getattr(usage, parent_name, None)
        if parent is None:
            return 0
        return _get(child_name, source=parent)

    totals = service._session_totals
    totals["input_tokens"] += _get("prompt_tokens")
    totals["output_tokens"] += _get("completion_tokens")
    totals["reasoning_tokens"] += _get_nested(
        "completion_tokens_details", "reasoning_tokens"
    )
    prompt_cached = _get_nested(
        "prompt_tokens_details", "cached_tokens"
    )
    totals["prompt_cached_tokens"] += prompt_cached
    totals["cache_read_tokens"] += max(
        _get("cache_read_input_tokens"),
        _get("cache_read_tokens"),
        prompt_cached,
    )
    totals["cache_write_tokens"] += max(
        _get("cache_creation_input_tokens"),
        _get("cache_creation_tokens"),
    )


def accumulate_cost(
    service: "LLMService",
    cost: float | None,
) -> None:
    """Fold a per-request cost into session totals.

    ``cost`` is None when LiteLLM couldn't price the call
    (unknown model, missing pricing entry). Increments the
    unpriced counter — the UI can show "(partial)" to
    indicate the running total excludes some requests.
    """
    totals = service._session_totals
    if cost is None:
        totals["unpriced_request_count"] += 1
        return
    try:
        cost_float = float(cost)
    except (TypeError, ValueError):
        totals["unpriced_request_count"] += 1
        return
    totals["cost_usd"] += cost_float
    totals["priced_request_count"] += 1


# ---------------------------------------------------------------------------
# Pre-prompt URL detection and fetch
# ---------------------------------------------------------------------------


async def detect_and_fetch_urls(
    service: "LLMService",
    request_id: str,
    message: str,
    excluded_urls: list[str] | None = None,
    scope: "ConversationScope | None" = None,
) -> None:
    """Detect URLs in the user message and fetch new ones.

    Runs before prompt assembly so fetched content lands in
    the context manager's URL section by assembly time.
    Sequential per-URL via the aux executor; bounded by the
    per-message cap to keep this at a few hundred ms worst
    case.
    """
    if scope is None:
        scope = service._default_scope()
    from ac_dc.url_service import detect_urls as _detect_urls
    from ac_dc.url_service import display_name as _display_name

    urls = _detect_urls(message)
    urls = urls[:_URL_PER_MESSAGE_LIMIT]

    assert service._main_loop is not None
    loop = service._main_loop

    for url in urls:
        # Skip already-fetched (session-level memoisation).
        existing = service._url_service.get_url_content(url)
        if existing.error != "URL not yet fetched":
            continue

        name = _display_name(url)

        # Fire fetch-start event.
        await service._broadcast_event_async(
            "compactionEvent",
            request_id,
            {"stage": "url_fetch", "url": name},
        )

        # Blocking fetch in aux executor.
        try:
            await loop.run_in_executor(
                service._aux_executor,
                fetch_url_sync,
                service,
                url,
            )
        except Exception as exc:
            logger.warning(
                "URL fetch raised for %s: %s", url, exc
            )
            continue

        # Fire fetch-ready event.
        await service._broadcast_event_async(
            "compactionEvent",
            request_id,
            {"stage": "url_ready", "url": name},
        )

    # Attach the formatted URL context to the context
    # manager. Runs every turn (not gated on `urls` being
    # non-empty) so chip-fetched URLs and carryover URLs
    # continue to appear in the prompt.
    excluded_set = (
        set(excluded_urls) if excluded_urls else None
    )
    url_context = service._url_service.format_url_context(
        excluded=excluded_set
    )
    if url_context:
        scope.context.set_url_context([url_context])
    else:
        scope.context.clear_url_context()


def fetch_url_sync(
    service: "LLMService",
    url: str,
) -> None:
    """Blocking fetch — called from the aux executor.

    Uses ``summarize=True`` so the smaller model produces a
    summary alongside raw content.
    """
    service._url_service.fetch_url(
        url,
        use_cache=True,
        summarize=True,
        user_text=None,
    )


# ---------------------------------------------------------------------------
# Completion result assembly
# ---------------------------------------------------------------------------


async def build_completion_result(
    service: "LLMService",
    full_content: str,
    user_message: str,
    cancelled: bool,
    error: str | None,
    finish_reason: str | None = None,
    request_usage: dict[str, Any] | None = None,
    scope: "ConversationScope | None" = None,
    turn_id: str | None = None,
) -> dict[str, Any]:
    """Parse response, apply edits, build the result dict.

    Edit parsing always runs; apply is gated on
    ``error is None and not cancelled and not _review_active
    and pipeline is not None and parse_result.blocks``. See
    :meth:`LLMService._build_completion_result` for the full
    prose description of the order of operations.
    """
    if scope is None:
        scope = service._default_scope()

    # Parse the response. Parse even on cancelled/error so
    # the frontend renders incomplete blocks as pending cards
    # and shell commands surface on partial responses.
    parse_result = parse_text(full_content)

    edit_blocks_summary = [
        {
            "file": b.file_path,
            "is_create": b.is_create,
        }
        for b in parse_result.blocks
    ]

    # Agent blocks in the completion result — C2a spawn
    # handler reads this to create agent tabs. Invalid
    # blocks dropped to match the backend's spawn filter.
    agent_blocks_summary = [
        {
            "id": b.id,
            "task": b.task,
            "agent_idx": idx,
        }
        for idx, b in enumerate(parse_result.agent_blocks)
        if b.valid
    ]

    # Default result. token_usage falls through to zeros on
    # error paths; cost_usd defaults to None (not 0.0) so
    # "unknown cost" stays distinct from "free request".
    usage_dict = dict(request_usage) if request_usage else {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "reasoning_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "prompt_cached_tokens": 0,
        "cost_usd": None,
    }
    result: dict[str, Any] = {
        "response": full_content,
        "token_usage": usage_dict,
        "edit_blocks": edit_blocks_summary,
        "agent_blocks": agent_blocks_summary,
        "shell_commands": parse_result.shell_commands,
        "passed": 0,
        "already_applied": 0,
        "failed": 0,
        "skipped": 0,
        "not_in_context": 0,
        "files_modified": [],
        "edit_results": [],
        "files_auto_added": [],
        "files_created": [],
        "user_message": user_message,
        "finish_reason": finish_reason,
        "turn_id": turn_id,
    }
    if cancelled:
        result["cancelled"] = True
    if error is not None:
        result["error"] = error
        error_info = getattr(service, "_last_error_info", None)
        if error_info is not None:
            result["error_info"] = error_info
            service._last_error_info = None

    # Gate the apply step.
    if (
        error is not None
        or cancelled
        or service._review_active
        or service._edit_pipeline is None
        or not parse_result.blocks
    ):
        return result

    # Apply. Defensive copy of the selection so a concurrent
    # mutation doesn't affect mid-loop apply.
    in_context = set(scope.selected_files)
    try:
        report = await service._edit_pipeline.apply_edits(
            parse_result.blocks,
            in_context_files=in_context,
        )
    except Exception as exc:
        logger.exception("Edit pipeline raised: %s", exc)
        result["error"] = (
            f"Edit application failed: {exc}"
        )
        return result

    # Auto-add modified / created files to the scope's
    # selection so the next request sees them in context.
    paths_to_add = list(report.files_auto_added) + [
        p for p in report.files_created
        if p not in report.files_auto_added
    ]
    if paths_to_add:
        added: list[str] = []
        for path in paths_to_add:
            if path not in scope.selected_files:
                scope.selected_files.append(path)
                added.append(path)
        # Load auto-added content into the scope's file
        # context so the next turn's assembly has content.
        for path in added:
            try:
                scope.context.file_context.add_file(path)
            except Exception as exc:
                logger.debug(
                    "Auto-added file %s could not be "
                    "loaded: %s",
                    path, exc,
                )

    # Refresh file context for EVERY modified file (not
    # just auto-added). Without this, already-selected
    # files keep their pre-edit snapshot and the LLM sees
    # phantom parallel edits on its next turn.
    file_context = scope.context.file_context
    for path in report.files_modified:
        if not file_context.has_file(path):
            continue
        try:
            file_context.add_file(path)
        except Exception as exc:
            logger.warning(
                "Failed to refresh file context for "
                "modified file %s: %s. LLM will see "
                "stale content on next turn.",
                path, exc,
            )

    # Serialise per-block results for the JSON response.
    result["edit_results"] = [
        serialise_edit_result(r) for r in report.results
    ]
    result["passed"] = report.passed
    result["already_applied"] = report.already_applied
    result["failed"] = report.failed
    result["skipped"] = report.skipped
    result["not_in_context"] = report.not_in_context
    result["files_modified"] = list(report.files_modified)
    result["files_auto_added"] = list(report.files_auto_added)
    result["files_created"] = list(report.files_created)

    return result


def serialise_edit_result(r: EditResult) -> dict[str, Any]:
    """Convert an EditResult dataclass to the RPC dict shape.

    Status is serialised as its string value (the enum
    subclasses str). ``error_type`` is always a string —
    empty for success.
    """
    return {
        "file": r.file_path,
        "status": r.status.value,
        "message": r.message,
        "error_type": r.error_type,
        "old_preview": r.old_preview,
        "new_preview": r.new_preview,
    }