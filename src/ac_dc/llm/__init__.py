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
]