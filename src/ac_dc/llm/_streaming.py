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

from ac_dc.edit_protocol import EditResult, parse_text
from ac_dc.history_store import HistoryStore
from ac_dc.llm._helpers import (
    _classify_litellm_error,
    _extract_finish_reason,
    _extract_response_cost,
    _resolve_max_output_tokens,
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
) -> dict[str, Any]:
    """Background task — the actual streaming logic.

    ``agent_key`` is the agent's LLM-chosen id when this
    stream runs under an agent scope, None for the
    main-conversation path. Used for the per-agent
    single-stream guard slot in
    ``service._active_agent_streams``. See
    :meth:`LLMService._stream_chat` for the full prose
    describing every step.
    """
    if scope is None:
        scope = service._default_scope()
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
        ) = await loop.run_in_executor(
            service._stream_executor,
            service._run_completion_sync,
            request_id, messages, loop,
        )

        # Persist assistant response.
        if full_content or cancelled:
            content_to_store = full_content
            if cancelled and not content_to_store:
                content_to_store = "[stopped]"
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
                    # to receive child streams.
                    agent_block_payload = [
                        {
                            "id": b.id,
                            "task": b.task,
                            "agent_idx": i,
                        }
                        for i, b in enumerate(valid_blocks)
                    ]
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

    # Post-response housekeeping — only on normal completion.
    if error is None and not cancelled:
        try:
            await service._post_response(
                request_id, turn_id, scope
            )
        except Exception as exc:
            logger.exception(
                "Post-response processing for %s failed: %s",
                request_id, exc,
            )

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
) -> tuple[str, bool, str | None, dict[str, Any]]:
    """Blocking LLM call — runs in a worker thread.

    Returns ``(full_content, was_cancelled, finish_reason,
    usage_dict)``. Schedules chunk callbacks onto the main
    event loop via ``run_coroutine_threadsafe``. See
    :meth:`LLMService._run_completion_sync` for the full
    prose describing usage_dict's shape.
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
            "litellm is not installed on this server",
            False,
            None,
            dict(empty_usage),
        )

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

    try:
        stream = litellm.completion(
            model=service._config.model,
            messages=messages,
            stream=True,
            stream_options={"include_usage": True},
            max_tokens=max_output,
        )
    except Exception as exc:
        logger.exception("litellm.completion raised")
        service._last_error_info = _classify_litellm_error(
            litellm, exc
        )
        return (
            f"LLM call failed: {exc}",
            False,
            None,
            dict(empty_usage),
        )

    usage: dict[str, Any] | None = None
    finish_reason: str | None = None
    cost_source: Any = stream

    for chunk in stream:
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

    return full_content, was_cancelled, finish_reason, request_usage


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