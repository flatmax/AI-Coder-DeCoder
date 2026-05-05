"""Internal subpackage for :mod:`ac_dc.llm_service` decomposition.

Holds helpers and types extracted from the main service module to
keep that file focused on the :class:`LLMService` class itself.
Everything here is an implementation detail — callers should keep
importing from :mod:`ac_dc.llm_service`, which re-exports the
public symbols.
"""

from __future__ import annotations

from ac_dc.llm._types import (
    ArchivalAppend,
    ConversationScope,
    EventCallback,
    _AUX_EXECUTOR_WORKERS,
    _DETECTOR_MAX_MESSAGES,
    _DETECTOR_MSG_TRUNCATE_CHARS,
    _STREAM_EXECUTOR_WORKERS,
    _TIER_CONFIG_LOOKUP,
    _URL_PER_MESSAGE_LIMIT,
)
from ac_dc.llm._helpers import (
    _build_compaction_event_text,
    _build_topic_detector,
    _classify_litellm_error,
    _extract_finish_reason,
    _extract_response_cost,
    _generate_request_id,
    _parse_agent_tag,
    _resolve_max_output_tokens,
)
from ac_dc.llm._assembly import (
    assemble_messages_flat,
    assemble_tiered,
    build_tiered_content,
)
from ac_dc.llm._agents import (
    assimilate_agent_changes,
    build_agent_scope,
    filter_dispatchable_agents,
    spawn_agents_for_turn,
)
from ac_dc.llm._breakdown import (
    get_context_breakdown,
    get_file_map_block,
    get_meta_block,
    print_init_hud,
    print_post_response_hud,
    wide_map_exclude_set,
)
from ac_dc.llm._commit import (
    commit_all,
    commit_all_background,
    generate_commit_message,
    reset_to_head,
)
from ac_dc.llm._lifecycle import (
    broadcast_enrichment_status,
    broadcast_event,
    broadcast_event_async,
    post_response,
    sync_file_context,
)
from ac_dc.llm._doc_index_background import (
    build_doc_index_background,
    build_enrichment_config,
    enrich_one_file_sync,
    enrich_written_file,
    on_doc_file_written,
    run_enrichment_background,
    send_doc_index_progress,
)
from ac_dc.llm._rebuild import (
    distribute_orphan_files,
    rebuild_cache,
    rebuild_cache_impl,
    rebuild_graduate_history,
)
from ac_dc.llm._review import (
    build_and_set_review_context,
    check_review_ready,
    end_review,
    get_commit_graph,
    get_review_file_diff,
    get_review_state,
    start_review,
)
from ac_dc.llm._stability import (
    measure_tracker_tokens,
    remove_cross_reference_items,
    seed_cross_reference_items,
    try_initialize_stability,
    update_stability,
)
from ac_dc.llm._streaming import (
    accumulate_cost,
    accumulate_usage,
    build_completion_result,
    detect_and_fetch_urls,
    fetch_url_sync,
    run_completion_sync,
    serialise_edit_result,
    stream_chat,
)

__all__ = [
    "ArchivalAppend",
    "ConversationScope",
    "EventCallback",
    "_AUX_EXECUTOR_WORKERS",
    "_DETECTOR_MAX_MESSAGES",
    "_DETECTOR_MSG_TRUNCATE_CHARS",
    "_STREAM_EXECUTOR_WORKERS",
    "_TIER_CONFIG_LOOKUP",
    "_URL_PER_MESSAGE_LIMIT",
    "_build_compaction_event_text",
    "_build_topic_detector",
    "_classify_litellm_error",
    "_extract_finish_reason",
    "_extract_response_cost",
    "_generate_request_id",
    "_parse_agent_tag",
    "_resolve_max_output_tokens",
    "accumulate_cost",
    "accumulate_usage",
    "assemble_messages_flat",
    "assemble_tiered",
    "assimilate_agent_changes",
    "broadcast_enrichment_status",
    "broadcast_event",
    "broadcast_event_async",
    "build_agent_scope",
    "build_and_set_review_context",
    "build_completion_result",
    "build_doc_index_background",
    "build_enrichment_config",
    "build_tiered_content",
    "check_review_ready",
    "commit_all",
    "commit_all_background",
    "detect_and_fetch_urls",
    "distribute_orphan_files",
    "end_review",
    "enrich_one_file_sync",
    "enrich_written_file",
    "fetch_url_sync",
    "filter_dispatchable_agents",
    "generate_commit_message",
    "get_commit_graph",
    "get_context_breakdown",
    "get_file_map_block",
    "get_meta_block",
    "get_review_file_diff",
    "get_review_state",
    "measure_tracker_tokens",
    "on_doc_file_written",
    "post_response",
    "print_init_hud",
    "print_post_response_hud",
    "rebuild_cache",
    "rebuild_cache_impl",
    "rebuild_graduate_history",
    "remove_cross_reference_items",
    "reset_to_head",
    "run_completion_sync",
    "run_enrichment_background",
    "seed_cross_reference_items",
    "send_doc_index_progress",
    "serialise_edit_result",
    "spawn_agents_for_turn",
    "start_review",
    "stream_chat",
    "sync_file_context",
    "try_initialize_stability",
    "update_stability",
    "wide_map_exclude_set",
]