"""Topic detector closure built by :func:`_build_topic_detector`.

Covers :class:`TestTopicDetector` — the closure that the LLM
service hands to :class:`HistoryCompactor`. Tests exercise the
safe-default path (empty messages), the happy JSON path, the
markdown-fenced-JSON tolerance, the garbled-reply fallback, and
the confidence-clamping contract.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

from ac_dc.config import ConfigManager
from ac_dc.llm_service import _build_topic_detector

from .conftest import _FakeLiteLLM


class TestTopicDetector:
    """The detector closure built by _build_topic_detector."""

    def test_detector_returns_safe_default_on_empty(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Empty messages → safe-default TopicBoundary."""
        detector = _build_topic_detector(
            config, ThreadPoolExecutor(max_workers=1)
        )
        result = detector([])
        assert result.boundary_index is None
        assert result.confidence == 0.0

    def test_detector_parses_json_reply(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Valid JSON reply → populated TopicBoundary."""
        fake_litellm.set_non_streaming_reply(json.dumps({
            "boundary_index": 3,
            "boundary_reason": "topic shift",
            "confidence": 0.85,
            "summary": "earlier work on X",
        }))
        detector = _build_topic_detector(
            config, ThreadPoolExecutor(max_workers=1)
        )
        result = detector([
            {"role": "user", "content": "msg 0"},
            {"role": "assistant", "content": "msg 1"},
        ])
        assert result.boundary_index == 3
        assert result.confidence == 0.85
        assert "earlier" in result.summary

    def test_detector_tolerates_markdown_fence(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """LLM wrapping JSON in ```json fences → still parsed."""
        fake_litellm.set_non_streaming_reply(
            "```json\n"
            + json.dumps({
                "boundary_index": 2,
                "boundary_reason": "shift",
                "confidence": 0.7,
                "summary": "",
            })
            + "\n```"
        )
        detector = _build_topic_detector(
            config, ThreadPoolExecutor(max_workers=1)
        )
        result = detector([
            {"role": "user", "content": "something"},
        ])
        assert result.boundary_index == 2

    def test_detector_handles_unparseable_reply(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Garbage reply → safe default."""
        fake_litellm.set_non_streaming_reply("not json at all")
        detector = _build_topic_detector(
            config, ThreadPoolExecutor(max_workers=1)
        )
        result = detector([
            {"role": "user", "content": "x"},
        ])
        assert result.boundary_index is None
        assert result.confidence == 0.0

    def test_detector_confidence_clamped(
        self,
        config: ConfigManager,
        fake_litellm: _FakeLiteLLM,
    ) -> None:
        """Out-of-range confidence values are clamped to [0, 1]."""
        fake_litellm.set_non_streaming_reply(json.dumps({
            "boundary_index": 0,
            "boundary_reason": "x",
            "confidence": 5.0,
            "summary": "",
        }))
        detector = _build_topic_detector(
            config, ThreadPoolExecutor(max_workers=1)
        )
        result = detector([
            {"role": "user", "content": "msg"},
        ])
        assert result.confidence <= 1.0