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
from ac_dc.llm._breakdown import (
    get_context_breakdown,
    get_file_map_block,
    get_meta_block,
    print_init_hud,
    print_post_response_hud,
    wide_map_exclude_set,
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
from ac_dc.llm._review import (
    build_and_set_review_context,
    check_review_ready,
    end_review,
    get_commit_graph,
    get_review_file_diff,
    get_review_state,
    start_review,
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
    "build_and_set_review_context",
    "build_doc_index_background",
    "build_enrichment_config",
    "check_review_ready",
    "end_review",
    "enrich_one_file_sync",
    "enrich_written_file",
    "get_commit_graph",
    "get_context_breakdown",
    "get_file_map_block",
    "get_meta_block",
    "get_review_file_diff",
    "get_review_state",
    "on_doc_file_written",
    "print_init_hud",
    "print_post_response_hud",
    "run_enrichment_background",
    "send_doc_index_progress",
    "start_review",
    "wide_map_exclude_set",
]