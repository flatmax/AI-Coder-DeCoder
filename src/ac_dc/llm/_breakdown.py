"""Context breakdown and map-block retrieval helpers.

Extracted from :mod:`ac_dc.llm_service` to keep that module
focused on the streaming pipeline. Functions here are
introspection-only — they read from the service's attached
state (context manager, stability tracker, indexes) but do
not mutate it. Terminal HUD rendering lives here too for the
same reason: pure diagnostic output, no state change.

Every function takes the :class:`LLMService` as its first
argument. The service's public RPC surface delegates via
thin method wrappers so tests that call
``service.get_context_breakdown()`` continue to work
unchanged.
"""

from __future__ import annotations

import hashlib
import sys
from typing import TYPE_CHECKING, Any

from ac_dc.context_manager import Mode
from ac_dc.llm._types import ConversationScope, _TIER_CONFIG_LOOKUP
from ac_dc.stability_tracker import Tier

if TYPE_CHECKING:
    from ac_dc.llm_service import LLMService


def _resolve_scope(
    service: "LLMService",
    agent_tag: str | None,
) -> ConversationScope | None:
    """Return the ConversationScope for an agent tag, or None for main.

    None means "use the main conversation" — the caller reads
    state directly from the service. A non-None return identifies
    an existing agent scope in ``service._agent_contexts``. When
    the tag points to a non-existent agent (closed between UI
    event and RPC), returns the sentinel ``False`` so the caller
    can distinguish "main" from "stale agent".

    Three-way return (None / ConversationScope / False) keeps
    the caller's dispatch clean without an extra exception path.
    """
    if agent_tag is None:
        return None
    if not isinstance(agent_tag, str) or not agent_tag:
        return False  # type: ignore[return-value]
    scope = service._agent_contexts.get(agent_tag)
    if scope is None:
        return False  # type: ignore[return-value]
    return scope


# ---------------------------------------------------------------------------
# User-exclusion set — what the index must NOT return
# ---------------------------------------------------------------------------


def user_excluded_paths(
    service: "LLMService",
    scope: ConversationScope | None = None,
) -> set[str]:
    """Return the user's index-exclusion set as a set of paths.

    Under the L0-content-typed model (D27), the aggregate
    symbol-map and doc-map bodies in L0 contain **every**
    indexed file's block. Selected files appear in the map
    *and* as full text in a lower tier — that's the
    intended design. The system prompt's authority rule
    instructs the LLM to treat full text in Working Files
    as canonical when it disagrees with the structural map.

    The only exclusion that still applies at the map level
    is **user exclusion** via the file picker's three-state
    checkbox. Excluded files have no representation in the
    prompt at all (no full text, no symbol block, no doc
    outline), so the aggregate map must also skip them.

    Pre-D27 callers used a much wider exclusion set
    (``wide_map_exclude_set``) that also filtered selected
    files and tier-graduated paths. That filtering is gone:
    the duplication between L0 map and lower-tier full
    text is the design, not a bug.

    When ``scope`` is None (default, main conversation),
    reads from ``service._excluded_index_files``. When
    ``scope`` is provided (agent-tab breakdown), reads from
    ``scope.excluded_index_files`` so each agent sees its
    own exclusion list.

    Spec: ``specs4/3-llm/prompt-assembly.md`` § No Symbol
    Map Exclusions and § User-Excluded Files.
    """
    if scope is None:
        excluded = getattr(
            service, "_excluded_index_files", None
        ) or ()
    else:
        excluded = scope.excluded_index_files
    return set(excluded)


# ---------------------------------------------------------------------------
# Map block retrieval
# ---------------------------------------------------------------------------


def get_file_map_block(
    service: "LLMService", path: str
) -> dict[str, Any]:
    """Return the index block for a file or special key.

    Used by the cache viewer's item-click-to-view feature.
    Dispatches based on a priority chain:

    1. Special keys — ``system:prompt`` returns the system
       prompt + legend for the current mode.
    2. Synthetic meta:* keys dispatch to :func:`get_meta_block`.
    3. Prefix dispatch — ``file:``, ``symbols:``, ``docs:``,
       ``plain_files:``.
    4. Current mode's index tried first; cross-mode fallback
       if primary has no data.
    5. Error if neither has data.
    """
    # Special key: system prompt. Pick the mode-appropriate
    # prompt + legend so the cache viewer shows whatever is
    # actually going to the LLM this turn.
    if path == "system:prompt":
        if service._context.mode == Mode.DOC:
            prompt = service._config.get_doc_system_prompt()
            legend = service._doc_index.get_legend()
        else:
            prompt = service._config.get_system_prompt()
            legend = ""
            if service._symbol_index is not None:
                try:
                    legend = service._symbol_index.get_legend()
                except Exception:
                    pass
        return {
            "path": "system:prompt",
            "content": prompt + (
                "\n\n" + legend if legend else ""
            ),
            "mode": service._context.mode.value,
        }

    # Synthetic meta:* keys.
    if path.startswith("meta:"):
        return get_meta_block(service, path)

    # History entries — tracker keys of the form
    # ``history:N`` where N is the zero-based index into
    # ``ContextManager.get_history()``. The cache viewer
    # surfaces these so the user can click an entry and
    # read the actual message body that's occupying that
    # tier slot.
    if path.startswith("history:"):
        idx_str = path[len("history:"):]
        try:
            idx = int(idx_str)
        except ValueError:
            return {
                "error": f"Malformed history key: {path}",
                "path": path,
            }
        history = service._context.get_history()
        if idx < 0 or idx >= len(history):
            return {
                "error": (
                    f"History index {idx} out of range "
                    f"(have {len(history)} messages)"
                ),
                "path": path,
            }
        msg = history[idx]
        role = msg.get("role", "?")
        raw_content = msg.get("content", "")
        # ``content`` may be a plain string or a list of
        # multimodal blocks (text + image_url dicts). Render
        # both shapes so multimodal turns show their text
        # parts and a placeholder for images.
        if isinstance(raw_content, str):
            body = raw_content
        elif isinstance(raw_content, list):
            parts: list[str] = []
            for block in raw_content:
                if isinstance(block, dict):
                    btype = block.get("type")
                    if btype == "text":
                        parts.append(block.get("text", ""))
                    elif btype in ("image_url", "image"):
                        parts.append("[image]")
                    else:
                        parts.append(str(block))
                else:
                    parts.append(str(block))
            body = "\n".join(parts)
        else:
            body = str(raw_content)
        return {
            "path": path,
            "content": f"[{role}]\n\n{body}",
            "mode": service._context.mode.value,
        }

    # Prefix dispatch.
    if path.startswith("file:"):
        file_path = path[len("file:"):]
        content = service._file_context.get_content(file_path)
        if content is not None:
            return {
                "path": file_path,
                "content": content,
                "mode": service._context.mode.value,
            }
        # Fall back to disk read for ungraduated selected files
        # not yet loaded into the file context.
        if service._repo is not None:
            try:
                disk_content = service._repo.get_file_content(
                    file_path
                )
                return {
                    "path": file_path,
                    "content": disk_content,
                    "mode": service._context.mode.value,
                }
            except Exception:
                pass
        return {
            "error": (
                f"File content for {file_path} not "
                "available (not in file context, not "
                "readable from disk)"
            ),
            "path": path,
        }

    # Dir-block prefixes — D36's per-directory cache items.
    # ``symbols:<dir>`` and ``docs:<dir>`` render the index's
    # block for the directory minus any files currently in
    # Active. ``plain_files:<dir>`` enumerates files in the
    # directory that have no symbol or doc presence.
    if path.startswith("symbols:"):
        directory = path[len("symbols:"):]
        if service._symbol_index is None:
            return {
                "error": "No symbol index available",
                "path": path,
            }
        active_excluded = set(service._file_context.get_files())
        block = service._symbol_index.get_dir_symbols_block(
            directory, exclude_active=active_excluded
        )
        if not block:
            return {
                "error": (
                    f"No symbol data for directory {directory}"
                ),
                "path": path,
            }
        return {
            "path": path,
            "content": block,
            "mode": "code",
        }

    if path.startswith("docs:"):
        directory = path[len("docs:"):]
        active_excluded = set(service._file_context.get_files())
        block = service._doc_index.get_dir_docs_block(
            directory, exclude_active=active_excluded
        )
        if not block:
            return {
                "error": (
                    f"No doc data for directory {directory}"
                ),
                "path": path,
            }
        return {
            "path": path,
            "content": block,
            "mode": "doc",
        }

    if path.startswith("plain_files:"):
        directory = path[len("plain_files:"):]
        if service._repo is None:
            return {"error": "No repository attached", "path": path}
        active_excluded = set(service._file_context.get_files())
        try:
            by_dir = service._repo.get_files_by_directory()
        except Exception as exc:
            return {"error": str(exc), "path": path}
        files_in_dir = [
            f for f in by_dir.get(directory, [])
            if f not in active_excluded
        ]
        if not files_in_dir:
            return {
                "error": (
                    f"No plain files in directory {directory}"
                ),
                "path": path,
            }
        return {
            "path": path,
            "content": "\n".join(files_in_dir),
            "mode": "code",
        }

    return {
        "error": f"No index data found for {path}",
        "path": path,
    }


def get_meta_block(
    service: "LLMService", key: str
) -> dict[str, Any]:
    """Return the content for a synthetic meta:* cache row.

    Under D36 the aggregate symbol/doc maps and the file tree
    are no longer surfaced as meta rows — they've been replaced
    by per-directory dir-block tracker entries (``symbols:<dir>``,
    ``docs:<dir>``, ``plain_files:<dir>``). Use
    :func:`get_file_map_block` to inspect those.

    The cache viewer still emits meta:* rows for sections that
    aren't individual tracker entries: fetched URLs, review
    context, active files, agent descriptor, system reminder.
    """

    # meta:url:{url} — individual fetched URL body.
    if key.startswith("meta:url:"):
        url = key[len("meta:url:"):]
        content_obj = service._url_service.get_url_content(url)
        if content_obj.error and content_obj.error != "":
            return {
                "error": content_obj.error,
                "path": key,
            }
        formatted = content_obj.format_for_prompt()
        return {
            "path": key,
            "content": formatted or "(empty)",
            "mode": service._context.mode.value,
        }

    # meta:review_context — review mode's injected block.
    if key == "meta:review_context":
        review_text = service._context.get_review_context()
        if not review_text:
            return {
                "error": "Review context is empty",
                "path": key,
            }
        return {
            "path": key,
            "content": review_text,
            "mode": service._context.mode.value,
        }

    # meta:active_file:{path} — an active (non-graduated)
    # selected file.
    if key.startswith("meta:active_file:"):
        file_path = key[len("meta:active_file:"):]
        content = service._file_context.get_content(file_path)
        if content is None:
            return {
                "error": (
                    f"File {file_path} is not currently "
                    "loaded into context."
                ),
                "path": key,
            }
        return {
            "path": key,
            "content": content,
            "mode": service._context.mode.value,
        }

    # meta:agent_descriptor — the per-turn agent-state
    # descriptor that build_agent_descriptor injects into
    # the outgoing user message at assembly time. Rebuilt
    # fresh each call from the live registry; never
    # persisted to history. Surfacing it here closes the
    # gap between "what the LLM sees" and "what the cache
    # viewer shows". Per
    # specs4/7-future/parallel-agents.md § "Single-copy
    # invariant — assembly-time injection".
    if key == "meta:agent_descriptor":
        from ac_dc.llm._agents import build_agent_descriptor
        content = build_agent_descriptor(service)
        if not content:
            return {
                "error": (
                    "No live agents — descriptor would be "
                    "empty this turn."
                ),
                "path": key,
            }
        return {
            "path": key,
            "content": content,
            "mode": service._context.mode.value,
        }

    # meta:system_reminder — the system reminder text
    # appended to the user prompt at assembly time. Read
    # from config so changes via Settings are reflected
    # immediately.
    if key == "meta:system_reminder":
        try:
            content = service._config.get_system_reminder()
        except Exception as exc:
            return {
                "error": str(exc),
                "path": key,
            }
        if not content:
            return {
                "error": "System reminder is empty.",
                "path": key,
            }
        return {
            "path": key,
            "content": content,
            "mode": service._context.mode.value,
        }

    return {
        "error": f"Unknown meta key: {key}",
        "path": key,
    }


# ---------------------------------------------------------------------------
# Context breakdown — the big RPC for the Context tab + HUD
# ---------------------------------------------------------------------------


def get_context_breakdown(
    service: "LLMService",
    agent_tag: tuple[str, int] | None = None,
) -> dict[str, Any]:
    """Return the full context/token/tier breakdown for the UI.

    Called by the Context tab (Budget + Cache sub-views) and
    the Token HUD. Synchronizes the in-memory FileContext with
    the current selected-files list before computing so the
    breakdown reflects what the next LLM request would look like.

    When ``agent_tag`` is None (default), returns the main
    conversation's breakdown. When it identifies an existing
    agent scope ``(turn_id, agent_idx)``, returns that agent's
    breakdown — its own ContextManager, StabilityTracker,
    FileContext, selected/excluded files. Unknown tags return
    ``{error: "agent not found"}`` so the frontend can
    distinguish "stale tab" from other errors.

    Shape matches specs-reference/5-webapp/viewers-hud.md. The
    response adds a top-level ``scope`` field identifying which
    conversation the data represents — ``"main"`` or the tab ID
    ``{turn_id}/agent-{NN}`` — so the Context tab can detect
    when it receives stale data for a tab the user switched
    away from.
    """
    import logging
    logger = logging.getLogger("ac_dc.llm_service")

    scope = _resolve_scope(service, agent_tag)
    if scope is False:
        return {"error": "agent not found"}

    if scope is None:
        # Main conversation — reads fall through to service.
        context = service._context
        tracker = service._stability_tracker
        file_context = service._file_context
        selected_files = service._selected_files
        excluded_set = set(
            getattr(service, "_excluded_index_files", None)
            or ()
        )
        scope_label = "main"
    else:
        context = scope.context
        tracker = scope.tracker
        file_context = context.file_context
        selected_files = scope.selected_files
        excluded_set = set(scope.excluded_index_files)
        # ``agent_tag`` is the LLM-chosen id at this point —
        # use it directly as the scope label.
        scope_label = agent_tag  # type: ignore[assignment]

    # Sync file context with current selection so the breakdown
    # reflects the next request's state, not a stale snapshot.
    # Only fires for the main conversation — agent scopes have
    # their file_context driven by the agent's own streaming
    # pipeline, and the breakdown is a read-only inspection.
    if scope is None:
        service._sync_file_context()

    mode = context.mode.value
    model = service._config.model

    # System prompt tokens — mode-aware. Scopes use the
    # context manager's live system prompt so agent scopes
    # with their own prompt (set by build_agent_scope from
    # config.get_agent_system_prompt) are counted correctly.
    system_prompt = context.get_system_prompt()
    system_tokens = service._counter.count(system_prompt)

    # Legend tokens — render live from the index that
    # corresponds to the current mode. Under D36 the legend
    # rides with the system prompt as a non-flux head anchor
    # (no longer a tracker entry), so the breakdown reads
    # the same source the prompt assembler does.
    legend = ""
    if context.mode == Mode.DOC:
        try:
            legend = service._doc_index.get_legend()
        except Exception:
            pass
    else:
        if service._symbol_index is not None:
            try:
                legend = service._symbol_index.get_legend()
            except Exception:
                pass
    legend_tokens = service._counter.count(legend) if legend else 0

    # Symbol/doc map per-file details still iterate the
    # live index because the cache viewer uses them for
    # the expandable Budget sub-view's per-file breakdown.
    # Under D36 there is no aggregate-map snapshot — the
    # equivalent bytes are spread across per-directory
    # dir-block tracker entries (``symbols:<dir>``,
    # ``docs:<dir>``). The aggregate token total is
    # computed below as the sum of per-file block tokens.
    symbol_map = ""
    symbol_map_files = 0
    symbol_map_details: list[dict[str, Any]] = []
    try:
        if context.mode == Mode.DOC:
            all_paths = list(
                service._doc_index._all_outlines.keys()
            )
            symbol_map_files = len(all_paths)
            for path in all_paths:
                if path in excluded_set:
                    continue
                block = service._doc_index.get_file_doc_block(path)
                if not block:
                    continue
                name = (
                    path.rsplit("/", 1)[-1]
                    if "/" in path
                    else path
                )
                symbol_map_details.append({
                    "name": name,
                    "path": path,
                    "tokens": service._counter.count(block),
                })
        else:
            if service._symbol_index is not None:
                all_paths = list(
                    service._symbol_index._all_symbols.keys()
                )
                symbol_map_files = len(all_paths)
                for path in all_paths:
                    if path in excluded_set:
                        continue
                    block = (
                        service._symbol_index.get_file_symbol_block(
                            path
                        )
                    )
                    if not block:
                        continue
                    name = (
                        path.rsplit("/", 1)[-1]
                        if "/" in path
                        else path
                    )
                    symbol_map_details.append({
                        "name": name,
                        "path": path,
                        "tokens": service._counter.count(block),
                    })
    except Exception as exc:
        logger.debug(
            "Symbol map details enumeration failed: %s", exc
        )
    # Aggregate primary-map token count under D36 is the sum
    # of per-file block tokens we just enumerated. This
    # mirrors what the LLM receives across all
    # ``symbols:<dir>`` / ``docs:<dir>`` dir-blocks.
    symbol_map_tokens = sum(
        d.get("tokens", 0) for d in symbol_map_details
    )

    # Secondary aggregate map (cross-reference only) — sum of
    # per-file blocks from the opposite index, scoped to the
    # current excluded set.
    secondary_map_tokens = 0
    if service._cross_ref_enabled:
        try:
            if context.mode == Mode.DOC:
                if service._symbol_index is not None:
                    for path in (
                        service._symbol_index._all_symbols.keys()
                    ):
                        if path in excluded_set:
                            continue
                        block = (
                            service._symbol_index
                            .get_file_symbol_block(path)
                        )
                        if block:
                            secondary_map_tokens += (
                                service._counter.count(block)
                            )
            else:
                for path in (
                    service._doc_index._all_outlines.keys()
                ):
                    if path in excluded_set:
                        continue
                    block = service._doc_index.get_file_doc_block(
                        path
                    )
                    if block:
                        secondary_map_tokens += (
                            service._counter.count(block)
                        )
        except Exception as exc:
            logger.debug(
                "Secondary aggregate map fetch failed: %s",
                exc,
            )

    # File tokens — per-file detail.
    file_details: list[dict[str, Any]] = []
    files_tokens = 0
    for path in file_context.get_files():
        content = file_context.get_content(path)
        if content:
            tokens = service._counter.count(content)
            files_tokens += tokens
            name = path.rsplit("/", 1)[-1] if "/" in path else path
            file_details.append({
                "name": name,
                "path": path,
                "tokens": tokens,
            })

    # URL tokens + per-URL details.
    url_details: list[dict[str, Any]] = []
    url_tokens = 0
    try:
        from ac_dc.url_service.detection import (
            display_name as _url_display_name,
        )
        for content in service._url_service.get_fetched_urls():
            if content.error:
                continue
            rendered = content.format_for_prompt()
            if not rendered:
                continue
            tokens = service._counter.count(rendered)
            url_details.append({
                "name": _url_display_name(content.url),
                "url": content.url,
                "tokens": tokens,
            })
    except Exception as exc:
        logger.debug(
            "URL details enumeration failed: %s", exc
        )
    # Aggregate url_tokens — prefer the live URL context, fall
    # back to the sum across fetched URLs.
    url_context = context.get_url_context()
    if url_context:
        joined = "\n---\n".join(url_context)
        url_tokens = service._counter.count(joined)
    elif url_details:
        url_tokens = sum(d.get("tokens", 0) for d in url_details)

    # History tokens.
    history = context.get_history()
    history_tokens = context.history_token_count()

    # Total.
    total_tokens = (
        system_tokens + legend_tokens + symbol_map_tokens
        + files_tokens + url_tokens + history_tokens
    )
    max_input = service._counter.max_input_tokens

    # Cache hit rate from tier data.
    cached_tokens = 0
    all_tier_tokens = 0
    all_items = tracker.get_all_items()
    for item in all_items.values():
        all_tier_tokens += item.tokens
        if item.tier not in (Tier.ACTIVE,):
            cached_tokens += item.tokens
    cache_hit_rate = (
        cached_tokens / all_tier_tokens if all_tier_tokens > 0 else 0.0
    )

    # Provider cache rate from session totals.
    st = service._session_totals
    provider_cache_rate = None
    total_input = st.get("input_tokens", 0)
    cache_read = st.get("cache_read_tokens", 0)
    if total_input > 0:
        provider_cache_rate = cache_read / total_input

    # Per-tier blocks with contents detail.
    blocks: list[dict[str, Any]] = []
    for tier in (Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE):
        tier_items = tracker.get_tier_items(tier)
        if not tier_items:
            continue
        tier_tokens = sum(it.tokens for it in tier_items.values())
        contents: list[dict[str, Any]] = []
        for key, item in sorted(tier_items.items()):
            entry: dict[str, Any] = {
                "name": key,
                "path": key.split(":", 1)[1] if ":" in key else key,
                "tokens": item.tokens,
            }
            # Classify type from prefix. Under D36 the
            # per-directory dir-block prefixes
            # (symbols:/docs:/plain_files:) replace the old
            # per-file symbol:/doc: keys.
            if key.startswith("symbols:"):
                entry["type"] = "symbols"
            elif key.startswith("docs:"):
                entry["type"] = "doc_symbols"
            elif key.startswith("plain_files:"):
                entry["type"] = "files"
            elif key.startswith("file:"):
                entry["type"] = "files"
            elif key.startswith("url:"):
                entry["type"] = "urls"
            elif key.startswith("history:"):
                entry["type"] = "history"
            else:
                entry["type"] = "other"
            entry["n"] = item.n_value
            # Per D37, ``promote_n`` only exists in
            # ``_TIER_CONFIG`` for Active (where it backs the
            # admission gate ``n_admit``). The cached tiers
            # L0/L1/L2/L3 no longer carry the field — their
            # promotions are driven by the flux equation, not by
            # an N threshold. ``dict.get`` returns ``None`` for
            # missing keys, so the HUD threshold column renders
            # blank for cached-tier rows and shows ``n_admit``
            # only on Active rows.
            tier_cfg = _TIER_CONFIG_LOOKUP.get(item.tier)
            entry["threshold"] = tier_cfg.get("promote_n") if tier_cfg else None
            contents.append(entry)

        # Under D36 the aggregate symbol/doc map is no longer
        # a synthetic L0 row — it's been decomposed into
        # per-directory ``symbols:<dir>`` / ``docs:<dir>``
        # tracker entries that already appear in the contents
        # loop above as first-class items. No injection
        # needed.

        blocks.append({
            "name": tier.value,
            "tier": tier.value,
            "tokens": tier_tokens,
            "count": len(contents),
            "cached": tier != Tier.ACTIVE,
            "contents": contents,
        })

    # Uncached tail — sections that always appear after the
    # last cache breakpoint. Under D36 there's no flat file
    # tree section in the prompt — the repo's file structure
    # is now distributed across per-directory dir-blocks
    # (``symbols:<dir>``, ``docs:<dir>``, ``plain_files:<dir>``)
    # which participate in flux as cached tracker entries.
    uncached_contents: list[dict[str, Any]] = []
    for url_entry in url_details:
        uncached_contents.append({
            "name": f"meta:url:{url_entry['url']}",
            "path": url_entry["name"],
            "tokens": url_entry["tokens"],
            "type": "urls",
        })
    review_ctx = context.get_review_context()
    if review_ctx:
        rv_tokens = service._counter.count(review_ctx)
        if rv_tokens > 0:
            uncached_contents.append({
                "name": "meta:review_context",
                "path": "Code review context",
                "tokens": rv_tokens,
                "type": "other",
            })
    # Agent descriptor — assembly-time injection rebuilt
    # fresh per turn from the live registry. Only the
    # main scope's breakdown gets this row; agent scopes
    # don't see the descriptor in their own prompts (per
    # spec, agents don't self-reference the registry), so
    # surfacing it under an agent breakdown would
    # mismatch what the LLM actually received. Suppressed
    # when no agents are registered (descriptor is empty).
    if scope is None:
        try:
            from ac_dc.llm._agents import (
                build_agent_descriptor,
            )
            descriptor = build_agent_descriptor(service)
        except Exception as exc:
            descriptor = ""
            logger.debug(
                "Agent descriptor preview failed: %s", exc,
            )
        if descriptor:
            ad_tokens = service._counter.count(descriptor)
            if ad_tokens > 0:
                uncached_contents.append({
                    "name": "meta:agent_descriptor",
                    "path": "Live-agent descriptor",
                    "tokens": ad_tokens,
                    "type": "other",
                })
    # System reminder — appended to the user prompt at
    # assembly time. Read from config so the row reflects
    # whatever the next request would actually carry.
    try:
        reminder = service._config.get_system_reminder()
    except Exception as exc:
        reminder = ""
        logger.debug(
            "System reminder preview failed: %s", exc,
        )
    if reminder:
        sr_tokens = service._counter.count(reminder)
        if sr_tokens > 0:
            uncached_contents.append({
                "name": "meta:system_reminder",
                "path": "System reminder",
                "tokens": sr_tokens,
                "type": "system",
            })
    # Active files section — files in file context but not
    # graduated.
    represented_file_paths: set[str] = set()
    for b in blocks:
        for c in b.get("contents", ()):
            if c.get("type") == "files":
                represented_file_paths.add(c.get("path") or "")
    for fd in file_details:
        if fd["path"] in represented_file_paths:
            continue
        uncached_contents.append({
            "name": f"meta:active_file:{fd['path']}",
            "path": fd["path"],
            "tokens": fd["tokens"],
            "type": "files",
        })

    if uncached_contents:
        uncached_tokens = sum(c["tokens"] for c in uncached_contents)
        blocks.append({
            "name": "uncached",
            "tier": "uncached",
            "tokens": uncached_tokens,
            "count": len(uncached_contents),
            "cached": False,
            "contents": uncached_contents,
        })

    # Promotions and demotions from the most recent update.
    changes = tracker.get_changes()
    promotions = [c for c in changes if "promoted" in c or "→ L" in c]
    demotions = [
        c for c in changes
        if "active" in c and "→" in c and "promoted" not in c
    ]

    # Live-agent roster — id + model + mode for every
    # scope in the registry. Surfaced in the Context tab's
    # "Live agents" panel so the user can see the team
    # composition at a glance, mirroring what
    # ``build_agent_descriptor`` shows the orchestrator in
    # its prompt. Always present (even when empty) so the
    # frontend doesn't need a defensive check before
    # iterating. Sorted alphabetically by id for
    # deterministic output.
    agents_roster: list[dict[str, Any]] = []
    for agent_id in sorted(service._agent_contexts.keys()):
        agent_scope = service._agent_contexts[agent_id]
        agent_ctx = agent_scope.context
        if agent_ctx is None:
            continue
        agent_mode = agent_ctx.mode.value
        agent_xref = agent_ctx.cross_reference_enabled
        mode_label = (
            f"{agent_mode}+xref" if agent_xref else agent_mode
        )
        agents_roster.append({
            "id": agent_id,
            "model": getattr(agent_ctx, "model", "") or "",
            "mode": mode_label,
        })

    return {
        "scope": scope_label,
        "model": model,
        "mode": mode,
        "cross_ref_enabled": service._cross_ref_enabled,
        "agents": agents_roster,
        "total_tokens": total_tokens,
        "max_input_tokens": max_input,
        "cache_hit_rate": cache_hit_rate,
        "provider_cache_rate": provider_cache_rate,
        "blocks": blocks,
        "breakdown": {
            "system": system_tokens,
            "legend": legend_tokens,
            "symbol_map": symbol_map_tokens,
            "symbol_map_files": symbol_map_files,
            "symbol_map_details": symbol_map_details,
            "files": files_tokens,
            "file_count": len(file_details),
            "file_details": file_details,
            "urls": url_tokens,
            "url_details": url_details,
            "history": history_tokens,
            "history_messages": len(history),
        },
        "promotions": promotions,
        "demotions": demotions,
        "session_totals": {
            "prompt": st.get("input_tokens", 0),
            "completion": st.get("output_tokens", 0),
            "reasoning": st.get("reasoning_tokens", 0),
            "total": (
                st.get("input_tokens", 0)
                + st.get("output_tokens", 0)
            ),
            "cache_hit": st.get("cache_read_tokens", 0),
            "cache_write": st.get("cache_write_tokens", 0),
            "prompt_cached": st.get("prompt_cached_tokens", 0),
            "cost_usd": float(st.get("cost_usd", 0.0)),
            "priced_request_count": st.get(
                "priced_request_count", 0
            ),
            "unpriced_request_count": st.get(
                "unpriced_request_count", 0
            ),
        },
    }


# ---------------------------------------------------------------------------
# Terminal HUD rendering — diagnostic output to stderr
# ---------------------------------------------------------------------------


def print_init_hud(service: "LLMService") -> None:
    """Print the one-time startup tier distribution to stderr."""
    all_items = service._stability_tracker.get_all_items()
    tier_counts: dict[str, int] = {}
    for item in all_items.values():
        tier_name = item.tier.value
        tier_counts[tier_name] = tier_counts.get(tier_name, 0) + 1

    if not tier_counts:
        return

    lines = ["╭─ Initial Tier Distribution ─╮"]
    total = 0
    for tier in (Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE):
        count = tier_counts.get(tier.value, 0)
        if count > 0:
            lines.append(
                f"│ {tier.value:<10} {count:>4} items"
                f"{' ' * 11}│"
            )
            total += count
    lines.append("├─────────────────────────────┤")
    lines.append(f"│ Total: {total:<4} items{' ' * 12}│")
    lines.append("╰─────────────────────────────╯")
    print("\n".join(lines), file=sys.stderr)


def print_post_response_hud(
    service: "LLMService",
    request_usage: dict[str, Any] | None = None,
) -> None:
    """Print the four-section terminal HUD after each response.

    Sections per specs-reference/5-webapp/viewers-hud.md:
    1. Cache blocks (boxed) — per-tier token counts + cache hit %
    2. Token usage — model, per-category structural breakdown
    3. Last Request — in/out/reasoning/cache for the request
       just completed. ``request_usage`` carries the
       provider's normalised counts (see
       :func:`run_completion_sync`). When None, the section
       is suppressed — happens on cancelled/error paths
       where there's no meaningful per-request data.
    4. Session Totals — cumulative across all requests in
       this session.
    5. Tier changes — promotions and demotions
    """
    all_items = service._stability_tracker.get_all_items()
    if not all_items:
        return

    # Section 1: Cache Blocks. We carry the per-tier item
    # count through to the rendered HUD line so operators
    # can see "12 items, 4.8K tokens [cached]" instead of
    # just the aggregate. Silent state drift (an item's
    # rendered tokens changing without a structural hash
    # change) shows up as a tier-total shift with no
    # change-log entry; having the count on-screen makes
    # the ambiguity easier to diagnose.
    tier_data: list[tuple[str, int, int, int, bool]] = []
    tier_order = [Tier.L0, Tier.L1, Tier.L2, Tier.L3, Tier.ACTIVE]
    total_tokens = 0
    cached_tokens = 0
    for tier in tier_order:
        items = [it for it in all_items.values() if it.tier == tier]
        if not items:
            continue
        tokens = sum(it.tokens for it in items)
        total_tokens += tokens
        is_cached = tier != Tier.ACTIVE
        if is_cached:
            cached_tokens += tokens
        entry_n = _TIER_CONFIG_LOOKUP.get(tier, {}).get("entry_n", 0)
        tier_data.append(
            (tier.value, entry_n, len(items), tokens, is_cached)
        )

    if tier_data:
        cache_pct = (
            round(cached_tokens / total_tokens * 100)
            if total_tokens > 0
            else 0
        )
        content_lines: list[str] = []
        for name, entry_n, count, tokens, cached in tier_data:
            if cached:
                line = (
                    f"│ {name:<10} ({entry_n}+) "
                    f"{count:>4} items "
                    f"{tokens:>8,} tokens [cached] │"
                )
            else:
                line = (
                    f"│ {name:<10}       "
                    f"{count:>4} items "
                    f"{tokens:>8,} tokens          │"
                )
            content_lines.append(line)

        max_width = (
            max(len(l) for l in content_lines)
            if content_lines
            else 40
        )
        header = f"╭─ Cache Blocks {'─' * (max_width - 17)}╮"
        separator = f"├{'─' * (max_width - 2)}┤"
        footer_text = (
            f"│ Total: {total_tokens:,} | "
            f"Cache hit: {cache_pct}%"
        )
        footer_text = footer_text.ljust(max_width - 1) + "│"
        bottom = f"╰{'─' * (max_width - 2)}╯"

        lines = [
            header, *content_lines, separator, footer_text, bottom,
        ]
        print("\n".join(lines), file=sys.stderr)

    # Section 2: Token Usage — structural breakdown of what
    # the next request would carry. Independent of any
    # individual call's actual token consumption.
    st = service._session_totals
    model = service._config.model
    system_tokens = service._counter.count(
        service._context.get_system_prompt()
    )
    # Symbol/doc map tokens — sum of all per-directory
    # dir-block tracker entries for the current mode's
    # primary index. Under D36 the aggregate map is
    # decomposed into ``symbols:<dir>`` (or ``docs:<dir>``)
    # entries; the HUD shows their combined token total so
    # operators see the structural map's footprint at a
    # glance.
    symbol_map_tokens = 0
    primary_prefix = (
        "docs:" if service._context.mode.value == "doc"
        else "symbols:"
    )
    for key, item in (
        service._stability_tracker.get_all_items().items()
    ):
        if key.startswith(primary_prefix):
            symbol_map_tokens += item.tokens
    files_tokens = service._file_context.count_tokens(service._counter)
    url_tokens = 0
    url_context_parts = service._context.get_url_context()
    if url_context_parts:
        url_tokens = service._counter.count(
            "\n---\n".join(url_context_parts)
        )
    else:
        try:
            for content in service._url_service.get_fetched_urls():
                if content.error:
                    continue
                rendered = content.format_for_prompt()
                if rendered:
                    url_tokens += service._counter.count(rendered)
        except Exception:
            pass
    history_tokens = service._context.history_token_count()
    total_est = (
        system_tokens + symbol_map_tokens + files_tokens
        + url_tokens + history_tokens
    )
    max_input = service._counter.max_input_tokens

    # Mode-aware label so doc mode reads naturally.
    map_label = (
        "Doc Map:   " if service._context.mode.value == "doc"
        else "Symbol Map:"
    )
    usage_lines = [
        f"Model: {model}",
        f"System:    {system_tokens:>10,}",
        f"{map_label}{symbol_map_tokens:>10,}",
        f"Files:     {files_tokens:>10,}",
    ]
    if url_tokens > 0:
        usage_lines.append(f"URLs:      {url_tokens:>10,}")
    usage_lines.extend([
        f"History:   {history_tokens:>10,}",
        f"Total:     {total_est:>10,} / {max_input:,}",
    ])
    print("\n".join(usage_lines), file=sys.stderr)

    # Section 3: Last Request — actual provider counts for
    # the request just completed. The structural totals
    # above (Section 2) describe what the prompt CONTAINS;
    # this section describes what the LLM actually billed,
    # which differs because of cache hits, reasoning tokens,
    # and tokenisation differences.
    if request_usage is not None:
        prompt_in = request_usage.get("prompt_tokens", 0) or 0
        completion_out = (
            request_usage.get("completion_tokens", 0) or 0
        )
        reasoning = (
            request_usage.get("reasoning_tokens", 0) or 0
        )
        req_cache_read = (
            request_usage.get("cache_read_tokens", 0) or 0
        )
        req_cache_write = (
            request_usage.get("cache_write_tokens", 0) or 0
        )
        if prompt_in or completion_out:
            req_lines = ["Last Request:"]
            req_lines.append(f"  In:        {prompt_in:>10,}")
            req_lines.append(
                f"  Out:       {completion_out:>10,}"
            )
            if reasoning > 0:
                req_lines.append(
                    f"  Reasoning: {reasoning:>10,}"
                )
            if req_cache_read or req_cache_write:
                req_lines.append(
                    f"  Cache:     "
                    f"read {req_cache_read:,}, "
                    f"write {req_cache_write:,}"
                )
            # Cache hit ratio — what fraction of this
            # request's prompt input came from cache.
            # cache_read / prompt_in × 100. Distinct from
            # ROI (which compares read against write); this
            # answers "how much input did we save by
            # caching". Suppressed when prompt_in is zero
            # (avoid divide-by-zero) or when there were no
            # reads (the row would just say 0.0%, no signal).
            if prompt_in > 0 and req_cache_read > 0:
                hit_pct = (
                    req_cache_read / prompt_in
                ) * 100
                req_lines.append(
                    f"  Cache hit: {hit_pct:>9.1f}%"
                )
            cost = request_usage.get("cost_usd")
            if cost is not None:
                try:
                    req_lines.append(
                        f"  Cost:      ${float(cost):.4f}"
                    )
                except (TypeError, ValueError):
                    pass
            print("\n".join(req_lines), file=sys.stderr)

    # Section 4: Session Totals — cumulative across all
    # requests since the session started.
    input_tok = st.get("input_tokens", 0)
    output_tok = st.get("output_tokens", 0)
    cache_read = st.get("cache_read_tokens", 0)
    cache_write = st.get("cache_write_tokens", 0)
    reasoning_tok = st.get("reasoning_tokens", 0)
    if input_tok or output_tok:
        sess_lines = ["Session Totals:"]
        sess_lines.append(f"  In:        {input_tok:>10,}")
        sess_lines.append(f"  Out:       {output_tok:>10,}")
        if reasoning_tok > 0:
            sess_lines.append(
                f"  Reasoning: {reasoning_tok:>10,}"
            )
        if cache_read or cache_write:
            sess_lines.append(
                f"  Cache:     "
                f"read {cache_read:,}, "
                f"write {cache_write:,}"
            )
        # Cache hit ratio — cumulative cache_read /
        # input_tokens × 100. What fraction of session
        # input came from cache. Same as the HUD header
        # badge's provider_cache_rate, surfaced explicitly
        # here so the terminal output stands alone without
        # the operator needing to look at the webapp.
        # Suppressed when input_tok is zero or no reads.
        if input_tok > 0 and cache_read > 0:
            hit_pct = (cache_read / input_tok) * 100
            sess_lines.append(
                f"  Cache hit: {hit_pct:>9.1f}%"
            )
        # Cache ROI — return on cache-write investment.
        # ((read / write) - 1) × 100 expresses "how many
        # extra tokens has each written token paid back?".
        # 0% = broke even, 100% = paid back twice, negative
        # = haven't fully amortised the write cost yet.
        # Only meaningful when cache_write > 0.
        if cache_write > 0:
            roi_pct = (
                (cache_read / cache_write) - 1
            ) * 100
            sess_lines.append(
                f"  Cache ROI: {roi_pct:>+9.1f}%"
            )
        sess_cost = st.get("cost_usd", 0.0)
        priced = st.get("priced_request_count", 0)
        unpriced = st.get("unpriced_request_count", 0)
        if priced > 0 or unpriced > 0:
            try:
                cost_val = float(sess_cost)
            except (TypeError, ValueError):
                cost_val = 0.0
            if priced > 0 and unpriced == 0:
                sess_lines.append(
                    f"  Cost:      ${cost_val:.4f}"
                )
            elif priced > 0 and unpriced > 0:
                sess_lines.append(
                    f"  Cost:      ${cost_val:.4f} "
                    f"(partial, {unpriced} unpriced)"
                )
            else:
                sess_lines.append(
                    f"  Cost:      — ({unpriced} unpriced)"
                )
        print("\n".join(sess_lines), file=sys.stderr)

    # Section 3: Tier Changes
    # Merge tier transitions (changes) and fresh tracker
    # registrations into one combined view. Registrations
    # arrive on a separate list because they're not tier
    # transitions — see ``StabilityTracker.get_registrations``
    # for why. The HUD treats them as a third axis alongside
    # promotions/demotions: ➕ counter, distinct macro bucket,
    # rendered with the ➕ icon in the per-line output.
    raw_changes = service._stability_tracker.get_changes()
    registrations = (
        service._stability_tracker.get_registrations()
    )
    changes = list(raw_changes) + list(registrations)
    if changes:
        # Drain the live change and registration logs
        # immediately. We already have our snapshot in
        # ``changes`` (the merged copy); rendering below
        # iterates the snapshot, never the live lists.
        # Draining FIRST — before any rendering — guarantees
        # the next turn starts clean even if a downstream
        # print raises. An end-of-block drain leaves the logs
        # populated on any exception, and the next turn's
        # :meth:`StabilityTracker.update` then prepends the
        # leaked entries as ``pre_cycle_changes``, replaying
        # last turn's tier moves into this turn's HUD even
        # though no such moves happened — the visible
        # symptom being identical promotion/demotion lines
        # appearing turn after turn while tier sizes stay
        # constant.
        service._stability_tracker._changes = []
        service._stability_tracker._registrations = []
        # Tier rank for direction detection. Higher rank =
        # more cached / more stable. 📈 means the item moved
        # to a higher rank (promotion / graduation). 📉 means
        # it moved to a lower rank (demotion / invalidation).
        # The arrow direction in the change string is the
        # ground truth — parse "{src} → {dst}:" out of it.
        _tier_rank = {
            "active": 0,
            "L3": 1,
            "L2": 2,
            "L1": 3,
            "L0": 4,
        }

        # Macro summary — bucket the per-item changes into
        # categories so the operator sees a one-line "why"
        # before scrolling through hundreds of individual
        # promotion lines. The buckets correspond to the
        # distinct call sites in StabilityTracker that emit
        # change-log entries; the trailing parenthetical in
        # each entry (e.g. "(promoted)", "(graduated)",
        # "(piggyback)") is the ground truth.
        bucket_counts: dict[str, int] = {}
        promotions = 0
        demotions = 0
        registrations = 0
        for change in changes:
            arrow_idx = change.find(" → ")
            colon_idx = (
                change.find(":", arrow_idx)
                if arrow_idx >= 0 else -1
            )
            if arrow_idx > 0 and colon_idx > arrow_idx:
                src = change[:arrow_idx].strip()
                dst = change[arrow_idx + 3:colon_idx].strip()
                src_rank = _tier_rank.get(src)
                # "new" is the literal source for fresh
                # tracker registrations (newly-selected file,
                # newly-fetched URL, newly-tracked symbol).
                # Neither promotion nor demotion — count
                # separately so the HUD summary distinguishes
                # "this turn brought in N new items" from
                # "N items moved between tiers".
                if src == "new":
                    registrations += 1
                # "removed" is not a tier — it's a tracker
                # eviction (selected file index→content swap,
                # excluded file sweep, stale file removal,
                # departed history/file). Count these as
                # demotions so the HUD counter reflects them;
                # otherwise a swap-driven cascade reads as
                # "79 promotions, 0 demotions" when in reality
                # at least one item was evicted from a cached
                # tier to set up those promotions.
                elif dst == "removed" and src_rank is not None:
                    demotions += 1
                else:
                    dst_rank = _tier_rank.get(dst)
                    if src_rank is not None and dst_rank is not None:
                        if dst_rank > src_rank:
                            promotions += 1
                        elif dst_rank < src_rank:
                            demotions += 1
            # Trailing reason in parentheses identifies the
            # macro cause. Default to "other" so unknown
            # entries still show up in the summary.
            paren_idx = change.rfind("(")
            close_idx = change.rfind(")")
            reason = "other"
            if paren_idx >= 0 and close_idx > paren_idx:
                reason = change[paren_idx + 1:close_idx]
            bucket_counts[reason] = bucket_counts.get(reason, 0) + 1

        # Render the summary. Order reasons by descending
        # count so the dominant cause comes first; this is
        # what an operator scanning the terminal will read.
        summary_parts = [
            f"{count}× {reason}"
            for reason, count in sorted(
                bucket_counts.items(),
                key=lambda kv: (-kv[1], kv[0]),
            )
        ]
        # Surface the *triggers* that motivated this cascade —
        # external mutations from the prior turn that landed in
        # ``_broken_reasons`` before :meth:`update` ran. These
        # are typically the macro "why" an operator wants to see
        # ("user deselected a file", "cross-ref enabled", etc.)
        # rather than the per-item promote/demote churn. Reasons
        # are deduplicated per tier; multiple identical entries
        # collapse so a single "user excluded file" doesn't
        # render once per excluded path.
        entry_reasons = (
            service._stability_tracker.get_entry_broken_reasons()
        )
        trigger_str = ""
        if entry_reasons:
            tier_parts: list[str] = []
            for tier_value in sorted(
                entry_reasons.keys(), key=lambda t: t.value
            ):
                seen: set[str] = set()
                unique_reasons: list[str] = []
                for reason in entry_reasons[tier_value]:
                    if reason in seen:
                        continue
                    seen.add(reason)
                    unique_reasons.append(reason)
                tier_parts.append(
                    f"{tier_value.value}({', '.join(unique_reasons)})"
                )
            trigger_str = f" | triggers: {'; '.join(tier_parts)}"
        # Compose the counter face. Show ➕ only when
        # there's at least one registration this turn —
        # most turns have none, so unconditionally
        # rendering it would just be visual noise.
        counter_face = f"📈{promotions} 📉{demotions}"
        if registrations:
            counter_face = f"{counter_face} ➕{registrations}"
        print(
            f"🔁 Tier changes: {len(changes)} total "
            f"({counter_face}) — "
            f"{', '.join(summary_parts)}{trigger_str}",
            file=sys.stderr,
        )

        for change in changes:
            arrow_idx = change.find(" → ")
            colon_idx = change.find(":", arrow_idx) if arrow_idx >= 0 else -1
            icon = "  "
            if arrow_idx > 0 and colon_idx > arrow_idx:
                src = change[:arrow_idx].strip()
                dst = change[arrow_idx + 3:colon_idx].strip()
                src_rank = _tier_rank.get(src)
                # New tracker registrations use the literal
                # source "new" — neither promotion nor
                # demotion, so render with a distinct icon
                # so operators can spot when a fresh key
                # entered the system this turn.
                if src == "new":
                    icon = "➕"
                # Removals are evictions from a cached tier;
                # render with the demotion icon so they're
                # visually distinct from promotions in the
                # change log.
                elif dst == "removed" and src_rank is not None:
                    icon = "🗑️"
                else:
                    dst_rank = _tier_rank.get(dst)
                    if src_rank is not None and dst_rank is not None:
                        if dst_rank > src_rank:
                            icon = "📈"
                        elif dst_rank < src_rank:
                            icon = "📉"
            print(f"{icon} {change}", file=sys.stderr)