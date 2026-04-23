"""Tests for ac_dc.url_service.summarizer — Layer 4.1.4.

Scope:

- ``choose_summary_type`` — URL-type defaults plus user-text
  keyword triggers (every trigger, precedence over defaults).
- ``_build_user_prompt`` — focus prompt placement, body priority
  (readme > content), truncation at 100k chars, symbol-map
  append, empty-content fallback.
- ``summarize`` — successful LLM call populates summary and
  summary_type, error records pass through unchanged, litellm
  ImportError / completion exception / malformed response /
  empty response all produce an error-marked record.

Strategy:

- ``choose_summary_type`` and ``_build_user_prompt`` are pure —
  no mocks needed.
- ``summarize`` mocks litellm at the module boundary via
  ``sys.modules`` injection. A ``_FakeLiteLLM`` class captures
  the call arguments and returns a configurable response.
"""

from __future__ import annotations

import sys
from typing import Any
from unittest.mock import MagicMock

import pytest

from ac_dc.url_service.detection import URLType
from ac_dc.url_service.models import GitHubInfo, URLContent
from ac_dc.url_service.summarizer import (
    SummaryType,
    _build_user_prompt,
    choose_summary_type,
    summarize,
)


# ---------------------------------------------------------------------------
# choose_summary_type
# ---------------------------------------------------------------------------


class TestChooseSummaryTypeDefaults:
    """URL-type defaults with no user text."""

    def test_github_repo_with_symbol_map_is_architecture(self) -> None:
        content = URLContent(
            url="https://github.com/a/b",
            url_type=URLType.GITHUB_REPO.value,
            symbol_map="some map",
        )
        assert choose_summary_type(content) == SummaryType.ARCHITECTURE

    def test_github_repo_without_symbol_map_is_brief(self) -> None:
        content = URLContent(
            url="https://github.com/a/b",
            url_type=URLType.GITHUB_REPO.value,
        )
        assert choose_summary_type(content) == SummaryType.BRIEF

    def test_github_file_is_brief(self) -> None:
        content = URLContent(
            url="https://github.com/a/b/blob/main/f.py",
            url_type=URLType.GITHUB_FILE.value,
        )
        assert choose_summary_type(content) == SummaryType.BRIEF

    def test_documentation_is_usage(self) -> None:
        content = URLContent(
            url="https://docs.python.org/3/",
            url_type=URLType.DOCUMENTATION.value,
        )
        assert choose_summary_type(content) == SummaryType.USAGE

    def test_generic_is_brief(self) -> None:
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC.value,
        )
        assert choose_summary_type(content) == SummaryType.BRIEF

    def test_github_issue_is_brief(self) -> None:
        content = URLContent(
            url="https://github.com/a/b/issues/1",
            url_type=URLType.GITHUB_ISSUE.value,
        )
        assert choose_summary_type(content) == SummaryType.BRIEF

    def test_github_pr_is_brief(self) -> None:
        content = URLContent(
            url="https://github.com/a/b/pull/1",
            url_type=URLType.GITHUB_PR.value,
        )
        assert choose_summary_type(content) == SummaryType.BRIEF


class TestChooseSummaryTypeUserText:
    """User text keywords override URL-type defaults."""

    def test_how_to_triggers_usage(self) -> None:
        content = URLContent(
            url="https://github.com/a/b",
            url_type=URLType.GITHUB_REPO.value,
            symbol_map="x",  # would default to ARCHITECTURE
        )
        result = choose_summary_type(content, "how to install this")
        assert result == SummaryType.USAGE

    def test_api_triggers_api(self) -> None:
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC.value,
        )
        assert choose_summary_type(
            content, "show me the api"
        ) == SummaryType.API

    def test_architecture_triggers_architecture(self) -> None:
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC.value,
        )
        assert choose_summary_type(
            content, "describe the architecture"
        ) == SummaryType.ARCHITECTURE

    def test_compare_triggers_evaluation(self) -> None:
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC.value,
        )
        assert choose_summary_type(
            content, "compare this library"
        ) == SummaryType.EVALUATION

    def test_evaluate_triggers_evaluation(self) -> None:
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC.value,
        )
        assert choose_summary_type(
            content, "help me evaluate this"
        ) == SummaryType.EVALUATION

    def test_case_insensitive(self) -> None:
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC.value,
        )
        assert choose_summary_type(
            content, "HOW TO do X"
        ) == SummaryType.USAGE

    def test_no_matching_keyword_falls_through_to_default(self) -> None:
        """User text without a trigger keyword uses URL-type default."""
        content = URLContent(
            url="https://docs.python.org/3/",
            url_type=URLType.DOCUMENTATION.value,
        )
        # "summarize this" has no trigger keywords → falls to
        # DOCUMENTATION default, which is USAGE.
        assert choose_summary_type(
            content, "summarize this please"
        ) == SummaryType.USAGE

    def test_first_matching_trigger_wins(self) -> None:
        """Multiple triggers — order in the trigger list wins."""
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC.value,
        )
        # "how to" appears first in the trigger list, before "api".
        assert choose_summary_type(
            content, "how to use the api"
        ) == SummaryType.USAGE

    def test_empty_user_text_uses_default(self) -> None:
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC.value,
        )
        assert choose_summary_type(content, "") == SummaryType.BRIEF

    def test_none_user_text_uses_default(self) -> None:
        content = URLContent(
            url="https://example.com",
            url_type=URLType.GENERIC.value,
        )
        assert choose_summary_type(content, None) == SummaryType.BRIEF


# ---------------------------------------------------------------------------
# _build_user_prompt
# ---------------------------------------------------------------------------


class TestBuildUserPrompt:
    """Prompt assembly for the summarizer LLM call."""

    def test_focus_prompt_comes_first(self) -> None:
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="some body",
        )
        prompt = _build_user_prompt(content, SummaryType.BRIEF)
        # Focus prompt starts with "Provide a concise".
        assert prompt.startswith("Provide a concise")

    def test_url_header_included(self) -> None:
        content = URLContent(
            url="https://example.com/page",
            url_type="generic",
            content="body",
        )
        prompt = _build_user_prompt(content, SummaryType.BRIEF)
        assert "https://example.com/page" in prompt
        assert "Content from" in prompt

    def test_readme_preferred_over_content(self) -> None:
        content = URLContent(
            url="https://github.com/a/b",
            url_type="github_repo",
            readme="# README content",
            content="fallback content",
        )
        prompt = _build_user_prompt(content, SummaryType.BRIEF)
        assert "# README content" in prompt
        # content field should NOT appear when readme is present.
        assert "fallback content" not in prompt

    def test_content_used_when_readme_absent(self) -> None:
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="just content",
        )
        prompt = _build_user_prompt(content, SummaryType.BRIEF)
        assert "just content" in prompt

    def test_no_body_falls_back_to_placeholder(self) -> None:
        content = URLContent(
            url="https://example.com",
            url_type="generic",
        )
        prompt = _build_user_prompt(content, SummaryType.BRIEF)
        assert "(no content available)" in prompt

    def test_long_body_truncated(self) -> None:
        """Bodies over 100k chars get an ellipsis suffix."""
        long_content = "x" * 200_000
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content=long_content,
        )
        prompt = _build_user_prompt(content, SummaryType.BRIEF)
        # Should contain truncation marker.
        assert "truncated" in prompt
        # Should NOT contain the full 200k chars.
        assert len(prompt) < 200_000

    def test_short_body_not_truncated(self) -> None:
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="short body",
        )
        prompt = _build_user_prompt(content, SummaryType.BRIEF)
        assert "truncated" not in prompt

    def test_symbol_map_appended_under_header(self) -> None:
        content = URLContent(
            url="https://github.com/a/b",
            url_type="github_repo",
            readme="readme text",
            symbol_map="src/main.py\n  c Foo",
        )
        prompt = _build_user_prompt(content, SummaryType.ARCHITECTURE)
        assert "Symbol Map:" in prompt
        assert "src/main.py" in prompt
        # README should appear before the symbol map.
        assert prompt.index("readme text") < prompt.index("Symbol Map:")

    def test_no_symbol_map_omits_header(self) -> None:
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        prompt = _build_user_prompt(content, SummaryType.BRIEF)
        assert "Symbol Map:" not in prompt

    def test_different_types_produce_different_focus(self) -> None:
        """Each summary type has a distinct focus prompt."""
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        prompts = {
            summary_type: _build_user_prompt(content, summary_type)
            for summary_type in SummaryType
        }
        # All five focus prompts should be distinct.
        first_paragraphs = {
            p.split("\n\n")[0] for p in prompts.values()
        }
        assert len(first_paragraphs) == 5

    def test_api_focus_mentions_api(self) -> None:
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        prompt = _build_user_prompt(content, SummaryType.API)
        assert "API" in prompt or "api" in prompt.lower()

    def test_usage_focus_mentions_usage_terms(self) -> None:
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        prompt = _build_user_prompt(content, SummaryType.USAGE)
        lowered = prompt.lower()
        # Should mention at least one usage-focused term.
        assert any(
            term in lowered
            for term in ("installation", "usage", "patterns", "examples")
        )


# ---------------------------------------------------------------------------
# summarize — LLM integration
# ---------------------------------------------------------------------------


class _FakeLiteLLM:
    """Fake litellm module installed into sys.modules for tests."""

    def __init__(self) -> None:
        self.reply_text: str = "A concise summary of the content."
        self.completion_calls: list[dict[str, Any]] = []
        self.raise_on_completion: Exception | None = None

    def completion(self, **kwargs: Any) -> Any:
        self.completion_calls.append(kwargs)
        if self.raise_on_completion is not None:
            raise self.raise_on_completion
        return self._build_response(self.reply_text)

    @staticmethod
    def _build_response(content: str) -> Any:
        class _Message:
            def __init__(self, text: str) -> None:
                self.content = text

        class _Choice:
            def __init__(self, text: str) -> None:
                self.message = _Message(text)

        class _Response:
            def __init__(self, text: str) -> None:
                self.choices = [_Choice(text)]

        return _Response(content)


@pytest.fixture
def fake_litellm(monkeypatch: pytest.MonkeyPatch) -> _FakeLiteLLM:
    """Install fake litellm into sys.modules for the test's duration."""
    fake = _FakeLiteLLM()
    monkeypatch.setitem(sys.modules, "litellm", fake)
    return fake


class TestSummarizeSuccess:
    """Happy-path summarization behaviour."""

    def test_successful_summarization_populates_fields(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        fake_litellm.reply_text = "This is a summary."
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body content",
        )
        result = summarize(content, model="fake/model")
        assert result.summary == "This is a summary."
        assert result.summary_type == "brief"

    def test_summarize_does_not_mutate_input(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        """The input record is not modified; a new one is returned."""
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        result = summarize(content, model="fake/model")
        # Input unchanged.
        assert content.summary is None
        assert content.summary_type is None
        # New record has the summary.
        assert result.summary is not None
        # Different object.
        assert result is not content

    def test_explicit_type_overrides_auto_selection(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        content = URLContent(
            url="https://docs.python.org/3/",
            url_type=URLType.DOCUMENTATION.value,
            content="docs body",
        )
        # Without explicit type, would pick USAGE.
        result = summarize(
            content,
            model="fake/model",
            summary_type=SummaryType.API,
        )
        assert result.summary_type == "api"

    def test_user_text_triggers_type_selection(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        result = summarize(
            content,
            model="fake/model",
            user_text="compare this to alternatives",
        )
        assert result.summary_type == "evaluation"

    def test_model_passed_through_to_litellm(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        summarize(content, model="anthropic/claude-haiku")
        assert len(fake_litellm.completion_calls) == 1
        assert fake_litellm.completion_calls[0]["model"] == (
            "anthropic/claude-haiku"
        )

    def test_system_message_is_fixed(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        """Per spec, system message does not vary per request."""
        content_a = URLContent(
            url="https://a.com",
            url_type="generic",
            content="a",
        )
        content_b = URLContent(
            url="https://b.com",
            url_type=URLType.DOCUMENTATION.value,
            content="b",
        )
        summarize(content_a, model="fake/model")
        summarize(content_b, model="fake/model")
        system_a = fake_litellm.completion_calls[0]["messages"][0]
        system_b = fake_litellm.completion_calls[1]["messages"][0]
        # Same system message across different URLs and types.
        assert system_a["content"] == system_b["content"]
        assert system_a["role"] == "system"

    def test_non_streaming_call(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        """Summarizer uses blocking completion, not streaming."""
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        summarize(content, model="fake/model")
        assert fake_litellm.completion_calls[0].get("stream") is False

    def test_max_tokens_capped(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        summarize(content, model="fake/model")
        assert "max_tokens" in fake_litellm.completion_calls[0]

    def test_reply_text_stripped(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        """Whitespace around the LLM's reply is stripped."""
        fake_litellm.reply_text = "  a summary.  \n\n"
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        result = summarize(content, model="fake/model")
        assert result.summary == "a summary."

    def test_preserves_existing_fields(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        """Summarization preserves title, content, github_info, etc."""
        gh_info = GitHubInfo(owner="octo", repo="hello")
        content = URLContent(
            url="https://github.com/octo/hello",
            url_type=URLType.GITHUB_REPO.value,
            title="octo/hello",
            readme="readme body",
            github_info=gh_info,
        )
        result = summarize(content, model="fake/model")
        assert result.title == "octo/hello"
        assert result.readme == "readme body"
        assert result.github_info == gh_info
        assert result.summary is not None


class TestSummarizeErrorHandling:
    """Error paths produce error-marked records, never raise."""

    def test_content_with_error_passes_through_unchanged(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        """Failed fetches are not re-summarized."""
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            error="fetch failed",
        )
        result = summarize(content, model="fake/model")
        # Should be returned unchanged — no LLM call made.
        assert result is content
        assert len(fake_litellm.completion_calls) == 0

    def test_litellm_import_error_returns_error_marker(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Missing litellm package degrades to error-marked record."""
        # Ensure litellm import fails.
        monkeypatch.setitem(sys.modules, "litellm", None)
        # None as the module entry makes ``import litellm`` raise.
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        result = summarize(content, model="fake/model")
        assert result.summary is None
        assert result.summary_type == "error"

    def test_completion_exception_returns_error_marker(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        fake_litellm.raise_on_completion = RuntimeError("boom")
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        result = summarize(content, model="fake/model")
        assert result.summary is None
        assert result.summary_type == "error"

    def test_malformed_response_returns_error_marker(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        """Response without the expected shape degrades gracefully."""
        # Replace completion with one returning an unexpected shape.
        def bad_completion(**kwargs: Any) -> Any:
            return MagicMock(choices=[])  # empty choices list

        fake_litellm.completion = bad_completion  # type: ignore[method-assign]
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        result = summarize(content, model="fake/model")
        assert result.summary is None
        assert result.summary_type == "error"

    def test_empty_reply_returns_error_marker(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        fake_litellm.reply_text = ""
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        result = summarize(content, model="fake/model")
        assert result.summary is None
        assert result.summary_type == "error"

    def test_whitespace_only_reply_returns_error_marker(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        fake_litellm.reply_text = "   \n\n  "
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        result = summarize(content, model="fake/model")
        assert result.summary is None
        assert result.summary_type == "error"

    def test_non_string_reply_returns_error_marker(
        self, fake_litellm: _FakeLiteLLM
    ) -> None:
        """If the LLM somehow returns non-string content, degrade cleanly."""
        def bad_completion(**kwargs: Any) -> Any:
            class _Msg:
                content = 42  # not a string

            class _Choice:
                message = _Msg()

            class _Resp:
                choices = [_Choice()]

            return _Resp()

        fake_litellm.completion = bad_completion  # type: ignore[method-assign]
        content = URLContent(
            url="https://example.com",
            url_type="generic",
            content="body",
        )
        result = summarize(content, model="fake/model")
        assert result.summary is None
        assert result.summary_type == "error"