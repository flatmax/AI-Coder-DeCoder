"""Doc-index background build + keyword enrichment.

Extracted from :mod:`ac_dc.llm_service` to keep that module
focused on the streaming pipeline. The build runs as a
fire-and-forget asyncio task kicked off by
:meth:`LLMService.schedule_doc_index_build` after deferred
init completes.

Phases:

1. **Structural extraction** — walk the repo's file list,
   filter to doc-index extensions, call
   :meth:`DocIndex.index_repo` on the aux executor. Emits
   ``startupProgress`` events at 0% (start) and 100% (end).
   Flips ``_doc_index_ready`` on success.
2. **Keyword enrichment** — per-file loop that reads source
   text from disk and calls :meth:`DocIndex.enrich_single_file`.
   Emits ``doc_enrichment_queued`` / ``doc_enrichment_file_done``
   / ``doc_enrichment_complete`` events so the frontend's
   progress overlay can render. Sets
   ``_enrichment_status = "complete"`` on success,
   ``"unavailable"`` when KeyBERT is missing, or ``"pending"``
   mid-run transitioning to ``"building"``.

Non-fatal failures log and leave readiness flags False — the
chat pipeline continues to work; doc mode and cross-reference
simply produce no content until the user retries or restarts.

Governing spec: :doc:`specs4/2-indexing/document-index` § Two-Phase
and :doc:`specs4/2-indexing/keyword-enrichment`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from ac_dc.doc_index.keyword_enricher import EnrichmentConfig

if TYPE_CHECKING:
    from ac_dc.llm_service import LLMService

logger = logging.getLogger("ac_dc.llm_service")


# ---------------------------------------------------------------------------
# Enrichment config builder
# ---------------------------------------------------------------------------


def build_enrichment_config(
    service: "LLMService",
) -> EnrichmentConfig:
    """Build an EnrichmentConfig from the config manager.

    Delegates to :meth:`EnrichmentConfig.from_dict` so the
    config dict shape stays owned by the dataclass. Called
    on construction; a future hot-reload pathway could
    re-read and swap the config on the enricher instance
    without reconstructing.
    """
    return EnrichmentConfig.from_dict(
        service._config.doc_index_config
    )


# ---------------------------------------------------------------------------
# Structural extraction pass
# ---------------------------------------------------------------------------


async def build_doc_index_background(
    service: "LLMService",
) -> None:
    """Structurally extract every doc-index-eligible file.

    Runs in the aux executor so the blocking per-file parsing
    doesn't starve the event loop. Emits startupProgress
    events as it walks. Flips `_doc_index_ready` on success
    so cross-reference toggle can activate.

    Non-fatal — failures log and leave `_doc_index_ready`
    False. The doc index stays empty; doc mode produces no
    content; cross-reference stays disabled. No error
    propagates to the user's chat session.

    Per specs4/2-indexing/document-index.md § Two-Phase
    Principle: this is the structural pass only. Keyword
    enrichment is a separate background task that runs
    after this completes.
    """
    if service._doc_index_building:
        # Already running.
        return

    service._doc_index_building = True
    try:
        # Discover files. Use the repo's flat file list when
        # available so we respect .gitignore and excluded
        # directories; fall back to the doc index's own
        # walker when no repo is attached.
        file_list: list[str] = []
        if service._repo is not None:
            try:
                flat = service._repo.get_flat_file_list()
                file_list = [f for f in flat.split("\n") if f]
            except Exception as exc:
                logger.warning(
                    "Doc index: failed to fetch file list "
                    "from repo: %s; falling back to walker",
                    exc,
                )
                file_list = []

        # Filter to files the doc index has an extractor for.
        doc_files = [
            f for f in file_list
            if service._doc_index._extension_of(f)
            in service._doc_index._extractors
        ]

        total = len(doc_files)
        if total == 0:
            logger.info(
                "Doc index: no eligible files found; "
                "marking ready with empty outlines"
            )
            service._doc_index_ready = True
            return

        logger.info(
            "Doc index: starting background build for %d files",
            total,
        )

        await send_doc_index_progress(
            service,
            stage="doc_index",
            message=f"Indexing documentation ({total} files)",
            percent=0,
        )

        assert service._main_loop is not None
        loop = service._main_loop
        await loop.run_in_executor(
            service._aux_executor,
            service._doc_index.index_repo,
            doc_files,
        )

        service._doc_index_ready = True
        logger.info(
            "Doc index: background build complete — %d "
            "outlines in memory",
            len(service._doc_index._all_outlines),
        )

        await send_doc_index_progress(
            service,
            stage="doc_index",
            message="Documentation indexing complete",
            percent=100,
        )

        # Chain keyword enrichment — fire-and-forget so the
        # _building flag flips off promptly while enrichment
        # runs in the background.
        assert service._main_loop is not None
        asyncio.ensure_future(
            run_enrichment_background(service)
        )
    except Exception as exc:
        logger.exception(
            "Doc index: background build failed: %s", exc
        )
        try:
            await send_doc_index_progress(
                service,
                stage="doc_index_error",
                message=f"Documentation indexing failed: {exc}",
                percent=0,
            )
        except Exception:
            pass
    finally:
        service._doc_index_building = False


# ---------------------------------------------------------------------------
# Keyword enrichment pass
# ---------------------------------------------------------------------------


async def run_enrichment_background(
    service: "LLMService",
) -> None:
    """Enrich every queued doc-index file in the aux executor.

    Called by :func:`build_doc_index_background` after
    structural extraction completes. Per-file operation:

    1. Read source text (disk I/O — batched with the
       GIL-heavy extraction in the same executor task).
    2. Call :meth:`DocIndex.enrich_single_file` with the
       source text.
    3. Emit a progress event so the frontend's dialog
       header bar advances.

    Yields to the event loop between files via
    ``await asyncio.sleep(0)`` so WebSocket traffic flows
    during long enrichment runs.

    Progress event stages per
    :doc:`specs4/2-indexing/keyword-enrichment` § "Progress
    Feedback":

    - ``doc_enrichment_queued`` — fired once at the top
      with the total count so the bar can size itself
    - ``doc_enrichment_file_done`` — fired per file with
      per-file progress + current filename
    - ``doc_enrichment_complete`` — fired on completion;
      the bar fades out

    Sets ``_doc_index_enriched = True`` on completion so
    ``get_mode`` reports the new state. Non-fatal — if
    enrichment fails mid-loop, the flag stays False and
    the structural outlines remain fully functional.
    """
    if service._enricher is None:
        return
    if not service._enricher.is_available():
        logger.info(
            "Keyword enrichment disabled — KeyBERT not "
            "available. Structural doc outlines remain "
            "fully functional."
        )
        service._enrichment_status = "unavailable"
        service._broadcast_enrichment_status()
        return

    assert service._main_loop is not None
    loop = service._main_loop
    loaded = await loop.run_in_executor(
        service._aux_executor,
        service._enricher.ensure_loaded,
    )
    if not loaded:
        logger.warning(
            "Keyword enrichment model failed to load. "
            "Structural outlines remain functional."
        )
        service._enrichment_status = "unavailable"
        service._broadcast_enrichment_status()
        return

    queue = service._doc_index.queue_enrichment()
    if not queue:
        service._doc_index_enriched = True
        service._enrichment_status = "complete"
        await send_doc_index_progress(
            service,
            stage="doc_enrichment_complete",
            message="Keyword enrichment complete",
            percent=100,
        )
        return

    total = len(queue)
    logger.info(
        "Keyword enrichment: %d files queued", total
    )
    service._enrichment_status = "building"
    await send_doc_index_progress(
        service,
        stage="doc_enrichment_queued",
        message=f"Enriching {total} documents",
        percent=0,
    )

    for idx, rel_path in enumerate(queue, start=1):
        try:
            await loop.run_in_executor(
                service._aux_executor,
                enrich_one_file_sync,
                service,
                rel_path,
            )
        except Exception as exc:
            logger.warning(
                "Enrichment failed for %s: %s",
                rel_path, exc,
            )

        percent = int((idx / total) * 100)
        await send_doc_index_progress(
            service,
            stage="doc_enrichment_file_done",
            message=f"Enriched {rel_path}",
            percent=percent,
        )
        await asyncio.sleep(0)

    service._doc_index_enriched = True
    service._enrichment_status = "complete"
    logger.info("Keyword enrichment: complete")
    await send_doc_index_progress(
        service,
        stage="doc_enrichment_complete",
        message="Keyword enrichment complete",
        percent=100,
    )


def enrich_one_file_sync(
    service: "LLMService",
    rel_path: str,
) -> None:
    """Read source text and run enrichment. Executor-side.

    Split out as a named function so ``run_in_executor`` has
    something to call without a closure. The read + enrich
    pair runs on a single worker thread so the disk I/O is
    adjacent to the GIL-heavy extraction work rather than
    ping-ponging across threads.

    Missing files (deleted between structural extraction
    and enrichment) are handled by the enricher itself.
    """
    if service._repo is None:
        return
    try:
        source_text = service._repo.get_file_content(rel_path)
    except Exception as exc:
        logger.debug(
            "Enrichment source read failed for %s: %s",
            rel_path, exc,
        )
        return
    service._doc_index.enrich_single_file(
        rel_path, source_text=source_text
    )


# ---------------------------------------------------------------------------
# Post-write hook — deferred enrichment for LLM edits + user saves
# ---------------------------------------------------------------------------


def on_doc_file_written(
    service: "LLMService",
    rel_path: str,
) -> None:
    """Post-write hook — invalidate + re-extract + enqueue.

    Wired to :attr:`Repo._post_write_callback` by ``main.py``.
    Fires after every successful write, create, or rename.
    This function decides whether the path is interesting and
    whether the current mode cares about doc-index freshness.

    Gating rules (spec: specs4/2-indexing/document-index.md §
    Triggers — "LLM edits a doc file" and "User edits in
    viewer"):

    1. Path extension must be registered with the doc index.
    2. Service must be in doc mode OR cross-reference must be
       enabled.
    3. Doc index background build must have completed.

    When gates pass:

    - Invalidate the cache sidecar.
    - Call ``index_file`` for a fresh structural outline.
    - Schedule enrichment via the aux executor.

    Never raises — the caller (``Repo._fire_post_write``)
    already swallows exceptions, but defensive wrapping here
    surfaces a clearer log message tied to the enrichment
    layer.
    """
    try:
        from ac_dc.context_manager import Mode

        extension = service._doc_index._extension_of(rel_path)
        if extension not in service._doc_index._extractors:
            return
        if (
            service._context.mode != Mode.DOC
            and not service._cross_ref_enabled
        ):
            return
        if not service._doc_index_ready:
            return
        service._doc_index.invalidate_file(rel_path)
        keyword_model = (
            service._enricher.model_name
            if service._enricher is not None
            else None
        )
        outline = service._doc_index.index_file(
            rel_path,
            keyword_model=keyword_model,
        )
        if outline is None:
            return
        if service._enricher is None:
            return
        if not service._doc_index.needs_enrichment(outline):
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            logger.debug(
                "Doc file %s written outside event loop; "
                "enrichment deferred to next chat turn",
                rel_path,
            )
            return
        asyncio.ensure_future(
            enrich_written_file(service, rel_path),
            loop=loop,
        )
    except Exception as exc:
        logger.warning(
            "Doc-file post-write hook failed for %s: %s",
            rel_path, exc,
        )


async def enrich_written_file(
    service: "LLMService",
    rel_path: str,
) -> None:
    """Enrich a single file in the aux executor.

    Coroutine wrapper so the post-write hook can
    ``ensure_future`` without constructing a lambda.
    Delegates to :func:`enrich_one_file_sync` which reads the
    file and runs the enricher on the worker thread.
    """
    if service._main_loop is None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
    else:
        loop = service._main_loop
    try:
        await loop.run_in_executor(
            service._aux_executor,
            enrich_one_file_sync,
            service,
            rel_path,
        )
    except Exception as exc:
        logger.warning(
            "Deferred enrichment failed for %s: %s",
            rel_path, exc,
        )


# ---------------------------------------------------------------------------
# Progress event dispatch
# ---------------------------------------------------------------------------


async def send_doc_index_progress(
    service: "LLMService",
    stage: str,
    message: str,
    percent: int,
) -> None:
    """Send a startupProgress event for doc index builds.

    Thin wrapper over the event callback. Matches the
    signature the startup orchestrator uses for its own
    progress events, so the shell's event router handles
    both uniformly.
    """
    if service._event_callback is None:
        return
    try:
        await service._event_callback(
            "startupProgress",
            stage,
            message,
            percent,
        )
    except Exception as exc:
        logger.debug(
            "Doc index progress event failed for %s: %s",
            stage, exc,
        )