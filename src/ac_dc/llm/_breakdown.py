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
    agent_tag: tuple[str, int] | None,
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
    turn_id, agent_idx = agent_tag
    turn_bucket = service._agent_contexts.get(turn_id)
    if turn_bucket is None:
        return False  # type: ignore[return-value]
    scope = turn_bucket.get(agent_idx)
    if scope is None:
        return False  # type: ignore[return-value]
    return scope


# ---------------------------------------------------------------------------
# Wide exclusion set — shared by aggregate map, modal content, and row counts
# ---------------------------------------------------------------------------


def wide_map_exclude_set(
    service: "LLMService",
    scope: ConversationScope | None = None,
) -> set[str]:
    """Compute the wide exclusion set for aggregate map bodies.

    The aggregate symbol-map or doc-map body (rendered in L0's
    system message) must exclude every path whose full content
    or compact block already appears elsewhere in the prompt.
    Without this exclusion, files that have graduated into
    cached tiers would render twice — once as a compact block
    in the aggregate map, and once under their tier's
    TIER_SYMBOLS_HEADER or FILES_L{N}_HEADER section — wasting
    tokens and confusing the model about which view is
    authoritative.

    The exclusion set is the union of:

    1. Selected files — their full content renders in the
       active "Working Files" section (if ungraduated) or in
       a cached tier's FILES_L{N}_HEADER block (if graduated
       as ``file:``)
    2. User-excluded index files — no representation in the
       prompt at all, so the aggregate map must also skip them
    3. Every path graduated into any cached tier as ``file:``,
       ``symbol:``, or ``doc:`` — all three prefixes represent
       content that's already in a cached tier's section

    Per specs-reference/3-llm/prompt-assembly.md § "Symbol map
    exclusions". Three call sites must agree on this
    computation: ``_assemble_tiered`` (what the LLM receives),
    ``_get_meta_block`` (modal content for click-to-view), and
    ``get_context_breakdown`` (token counts for cache viewer
    rows). A divergence between any two surfaces the same-row/
    different-count bug documented in the spec.

    When ``scope`` is None (default, main conversation),
    reads selected/excluded/tracker from ``service`` directly.
    When ``scope`` is provided (agent-tab breakdown), reads
    those fields from the scope so each agent gets its own
    exclusion set and cached-tier view.
    """
    if scope is None:
        selected = service._selected_files
        excluded = getattr(
            service, "_excluded_index_files", None
        ) or ()
        tracker = service._stability_tracker
    else:
        selected = scope.selected_files
        excluded = scope.excluded_index_files
        tracker = scope.tracker
    exclude: set[str] = set(selected)
    exclude.update(excluded)
    for tier in (Tier.L0, Tier.L1, Tier.L2, Tier.L3):
        for item_key in tracker.get_tier_items(tier):
            for prefix in ("file:", "symbol:", "doc:"):
                if item_key.startswith(prefix):
                    exclude.add(item_key[len(prefix):])
                    break
    return exclude


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
    3. Prefix dispatch — ``file:``, ``symbol:``, ``doc:``.
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
    # symbol: and doc: strip the prefix and fall through.
    for prefix in ("symbol:", "doc:"):
        if path.startswith(prefix):
            path = path[len(prefix):]
            break

    # Mode-based dispatch for compact blocks.
    if service._context.mode == Mode.DOC:
        primary = service._doc_index.get_file_doc_block(path)
        if primary:
            return {
                "path": path,
                "content": primary,
                "mode": "doc",
            }
        if service._symbol_index is not None:
            secondary = service._symbol_index.get_file_symbol_block(
                path
            )
            if secondary:
                return {
                    "path": path,
                    "content": secondary,
                    "mode": "code",
                }
    else:
        if service._symbol_index is not None:
            primary = service._symbol_index.get_file_symbol_block(
                path
            )
            if primary:
                return {
                    "path": path,
                    "content": primary,
                    "mode": "code",
                }
        secondary = service._doc_index.get_file_doc_block(path)
        if secondary:
            return {
                "path": path,
                "content": secondary,
                "mode": "doc",
            }

    return {
        "error": f"No index data found for {path}",
        "path": path,
    }


def get_meta_block(
    service: "LLMService", key: str
) -> dict[str, Any]:
    """Return the content for a synthetic meta:* cache row.

    The cache viewer emits meta:* rows for sections of the
    prompt that aren't individual tracker entries — the
    aggregate repo/doc map, the file tree, fetched URLs,
    review context, and active files.
    """
    import logging
    logger = logging.getLogger("ac_dc.llm_service")

    # meta:repo_map / meta:doc_map — aggregate index map body.
    if key in ("meta:repo_map", "meta:doc_map"):
        exclude = wide_map_exclude_set(service)
        if service._context.mode == Mode.DOC:
            content = service._doc_index.get_doc_map(
                exclude_files=exclude
            )
            mode = "doc"
        else:
            content = ""
            if service._symbol_index is not None:
                try:
                    content = service._symbol_index.get_symbol_map(
                        exclude_files=exclude
                    )
                except Exception as exc:
                    logger.warning(
                        "Aggregate symbol map fetch failed: %s",
                        exc,
                    )
            mode = "code"
        if not content:
            return {
                "error": (
                    "Aggregate map is empty — every indexed "
                    "file has graduated to a cached tier."
                ),
                "path": key,
            }
        return {
            "path": key,
            "content": content,
            "mode": mode,
        }

    # meta:file_tree — flat repo file listing.
    if key == "meta:file_tree":
        if service._repo is None:
            return {"error": "No repository attached", "path": key}
        try:
            content = service._repo.get_flat_file_list()
        except Exception as exc:
            return {"error": str(exc), "path": key}
        return {
            "path": key,
            "content": content or "(empty)",
            "mode": "code",
        }

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
        turn_id, agent_idx = agent_tag  # type: ignore[misc]
        scope_label = f"{turn_id}/agent-{agent_idx:02d}"

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

    # Legend tokens.
    legend = ""
    if service._symbol_index is not None:
        try:
            legend = service._symbol_index.get_legend()
        except Exception:
            pass
    legend_tokens = service._counter.count(legend) if legend else 0

    # Symbol map tokens + per-file details.
    symbol_map = ""
    symbol_map_files = 0
    symbol_map_details: list[dict[str, Any]] = []
    selected_set = set(selected_files)
    try:
        if context.mode == Mode.DOC:
            all_paths = list(
                service._doc_index._all_outlines.keys()
            )
            symbol_map_files = len(all_paths)
            for path in all_paths:
                if path in selected_set or path in excluded_set:
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
            symbol_map = service._doc_index.get_doc_map(
                exclude_files=wide_map_exclude_set(service, scope)
            )
        else:
            if service._symbol_index is not None:
                all_paths = list(
                    service._symbol_index._all_symbols.keys()
                )
                symbol_map_files = len(all_paths)
                for path in all_paths:
                    if (
                        path in selected_set
                        or path in excluded_set
                    ):
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
                symbol_map = service._symbol_index.get_symbol_map(
                    exclude_files=wide_map_exclude_set(service, scope)
                )
    except Exception as exc:
        logger.debug(
            "Symbol map details enumeration failed: %s", exc
        )
    symbol_map_tokens = (
        service._counter.count(symbol_map) if symbol_map else 0
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
            # Classify type from prefix.
            if key.startswith("system:"):
                entry["type"] = "system"
            elif key.startswith("symbol:"):
                entry["type"] = "symbols"
            elif key.startswith("doc:"):
                entry["type"] = "doc_symbols"
            elif key.startswith("file:"):
                entry["type"] = "files"
            elif key.startswith("url:"):
                entry["type"] = "urls"
            elif key.startswith("history:"):
                entry["type"] = "history"
            else:
                entry["type"] = "other"
            entry["n"] = item.n_value
            promote_n = None
            tier_cfg = _TIER_CONFIG_LOOKUP.get(item.tier)
            if tier_cfg is not None:
                promote_n = tier_cfg.get("promote_n")
            entry["threshold"] = promote_n
            contents.append(entry)

        # Synthetic meta row for L0 only — aggregate repo/doc
        # map body lives in the system message but has no
        # tracker key.
        if tier == Tier.L0 and symbol_map:
            map_token_count = service._counter.count(symbol_map)
            if map_token_count > 0:
                contents.append({
                    "name": (
                        "meta:doc_map" if context.mode == Mode.DOC
                        else "meta:repo_map"
                    ),
                    "path": (
                        "Document structure map"
                        if context.mode == Mode.DOC
                        else "Repository structure map"
                    ),
                    "tokens": map_token_count,
                    "type": (
                        "doc_symbols" if context.mode == Mode.DOC
                        else "symbols"
                    ),
                })
                tier_tokens += map_token_count

        blocks.append({
            "name": tier.value,
            "tier": tier.value,
            "tokens": tier_tokens,
            "count": len(contents),
            "cached": tier != Tier.ACTIVE,
            "contents": contents,
        })

    # Uncached tail — sections that always appear after the
    # last cache breakpoint.
    file_tree = ""
    if service._repo is not None:
        try:
            file_tree = service._repo.get_flat_file_list()
        except Exception as exc:
            logger.debug(
                "File tree fetch for breakdown failed: %s",
                exc,
            )

    uncached_contents: list[dict[str, Any]] = []
    if file_tree:
        ft_tokens = service._counter.count(file_tree)
        if ft_tokens > 0:
            uncached_contents.append({
                "name": "meta:file_tree",
                "path": "Repository file listing",
                "tokens": ft_tokens,
                "type": "files",
            })
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

    return {
        "scope": scope_label,
        "model": model,
        "mode": mode,
        "cross_ref_enabled": service._cross_ref_enabled,
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


def print_post_response_hud(service: "LLMService") -> None:
    """Print the three-section terminal HUD after each response.

    Sections per specs-reference/5-webapp/viewers-hud.md:
    1. Cache blocks (boxed) — per-tier token counts + cache hit %
    2. Token usage — model, per-category, total, last request, session
    3. Tier changes — promotions and demotions
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

    # Section 2: Token Usage
    st = service._session_totals
    model = service._config.model
    system_tokens = service._counter.count(
        service._context.get_system_prompt()
    )
    symbol_map_tokens = 0
    if service._symbol_index is not None:
        try:
            smap = service._symbol_index.get_symbol_map(
                exclude_files=set(service._selected_files)
            )
            symbol_map_tokens = (
                service._counter.count(smap) if smap else 0
            )
        except Exception:
            pass
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

    usage_lines = [
        f"Model: {model}",
        f"System:    {system_tokens:>10,}",
        f"Symbol Map:{symbol_map_tokens:>10,}",
        f"Files:     {files_tokens:>10,}",
    ]
    if url_tokens > 0:
        usage_lines.append(f"URLs:      {url_tokens:>10,}")
    usage_lines.extend([
        f"History:   {history_tokens:>10,}",
        f"Total:     {total_est:>10,} / {max_input:,}",
    ])
    input_tok = st.get("input_tokens", 0)
    output_tok = st.get("output_tokens", 0)
    if input_tok or output_tok:
        usage_lines.append(
            f"Last request: {input_tok:,} in, {output_tok:,} out"
        )
    cache_read = st.get("cache_read_tokens", 0)
    cache_write = st.get("cache_write_tokens", 0)
    if cache_read or cache_write:
        usage_lines.append(
            f"Cache:     read: {cache_read:,}, "
            f"write: {cache_write:,}"
        )
    session_total = sum(
        v for v in st.values() if isinstance(v, (int, float))
    )
    if session_total:
        usage_lines.append(f"Session total: {session_total:,}")
    print("\n".join(usage_lines), file=sys.stderr)

    # Section 3: Tier Changes
    changes = service._stability_tracker.get_changes()
    if changes:
        for change in changes:
            if "promoted" in change:
                print(f"📈 {change}", file=sys.stderr)
            elif "active" in change:
                print(f"📉 {change}", file=sys.stderr)
            else:
                print(f"   {change}", file=sys.stderr)