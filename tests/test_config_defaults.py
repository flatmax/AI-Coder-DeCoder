"""Tests that the bundled default config values are sane.

Goes further than test_package_metadata: validates that numeric values
are in sensible ranges, model names look like provider-qualified
identifiers, and snippet content isn't obviously broken. These are the
values a fresh user sees; shipping nonsense defaults wastes their first
session.
"""

from __future__ import annotations

import json
from pathlib import Path

import ac_dc


CONFIG_DIR = Path(ac_dc.__file__).parent / "config"


def _load_json(name: str) -> dict:
    return json.loads((CONFIG_DIR / name).read_text(encoding="utf-8"))


# ---- llm.json ------------------------------------------------------------


def test_llm_model_names_are_provider_qualified() -> None:
    """Model names include a provider prefix like 'anthropic/...'.

    litellm uses this prefix to route to the correct backend. A bare model
    name would work only for OpenAI and silently break on any other
    provider.
    """
    data = _load_json("llm.json")
    for key in ("model", "smaller_model"):
        value = data[key]
        assert isinstance(value, str) and value, f"{key} must be a non-empty string"
        assert "/" in value, (
            f"{key}={value!r} lacks a provider prefix (expected 'provider/model')"
        )


def test_llm_cache_tuning_values_are_positive() -> None:
    """Cache tuning numbers are positive and in plausible ranges."""
    data = _load_json("llm.json")
    min_tokens = data["cache_min_tokens"]
    multiplier = data["cache_buffer_multiplier"]
    assert isinstance(min_tokens, int)
    assert min_tokens > 0, f"cache_min_tokens must be > 0, got {min_tokens}"
    assert min_tokens >= 1024, (
        f"cache_min_tokens={min_tokens} is below the provider minimum (1024)"
    )
    assert isinstance(multiplier, (int, float))
    assert multiplier > 1.0, (
        f"cache_buffer_multiplier must be > 1.0, got {multiplier}"
    )
    assert multiplier < 2.0, (
        f"cache_buffer_multiplier={multiplier} is implausibly large"
    )


def test_llm_env_dict_values_are_strings() -> None:
    """The env dict, if populated, maps strings to strings."""
    data = _load_json("llm.json")
    env = data["env"]
    for k, v in env.items():
        assert isinstance(k, str), f"env key {k!r} is not a string"
        assert isinstance(v, str), f"env[{k!r}]={v!r} is not a string"


# ---- app.json ------------------------------------------------------------


def test_url_cache_section_fields() -> None:
    """url_cache has the fields the URL service will consult."""
    cfg = _load_json("app.json")["url_cache"]
    assert "path" in cfg
    assert "ttl_hours" in cfg
    ttl = cfg["ttl_hours"]
    assert isinstance(ttl, (int, float))
    assert ttl > 0, f"ttl_hours must be > 0, got {ttl}"


def test_history_compaction_section_fields() -> None:
    """history_compaction has all the fields the compactor uses."""
    cfg = _load_json("app.json")["history_compaction"]
    required = {
        "enabled",
        "compaction_trigger_tokens",
        "verbatim_window_tokens",
        "summary_budget_tokens",
        "min_verbatim_exchanges",
    }
    missing = required - set(cfg.keys())
    assert not missing, f"history_compaction missing keys: {sorted(missing)}"
    assert isinstance(cfg["enabled"], bool)
    for key in (
        "compaction_trigger_tokens",
        "verbatim_window_tokens",
        "summary_budget_tokens",
    ):
        value = cfg[key]
        assert isinstance(value, int)
        assert value > 0, f"{key} must be > 0, got {value}"
    assert cfg["verbatim_window_tokens"] < cfg["compaction_trigger_tokens"], (
        "verbatim_window_tokens must be smaller than compaction_trigger_tokens"
    )
    assert isinstance(cfg["min_verbatim_exchanges"], int)
    assert cfg["min_verbatim_exchanges"] >= 1


def test_doc_convert_section_fields() -> None:
    """doc_convert has the fields the converter tab will consult."""
    cfg = _load_json("app.json")["doc_convert"]
    assert isinstance(cfg["enabled"], bool)
    exts = cfg["extensions"]
    assert isinstance(exts, list)
    assert exts, "doc_convert.extensions is empty"
    for ext in exts:
        assert isinstance(ext, str)
        assert ext.startswith("."), f"extension {ext!r} should start with a dot"
    max_mb = cfg["max_source_size_mb"]
    assert isinstance(max_mb, (int, float))
    assert max_mb > 0, f"max_source_size_mb must be > 0, got {max_mb}"


def test_doc_index_section_fields() -> None:
    """doc_index has the fields the keyword enricher reads."""
    cfg = _load_json("app.json")["doc_index"]
    required = {
        "keyword_model",
        "keywords_enabled",
        "keywords_top_n",
        "keywords_ngram_range",
        "keywords_min_section_chars",
        "keywords_min_score",
        "keywords_diversity",
        "keywords_tfidf_fallback_chars",
        "keywords_max_doc_freq",
    }
    missing = required - set(cfg.keys())
    assert not missing, f"doc_index missing keys: {sorted(missing)}"
    assert isinstance(cfg["keyword_model"], str) and cfg["keyword_model"]
    assert isinstance(cfg["keywords_enabled"], bool)
    assert isinstance(cfg["keywords_top_n"], int) and cfg["keywords_top_n"] > 0
    ngram = cfg["keywords_ngram_range"]
    assert isinstance(ngram, list) and len(ngram) == 2
    assert all(isinstance(n, int) and n > 0 for n in ngram)
    assert ngram[0] <= ngram[1], f"ngram range {ngram} is inverted"
    for key in ("keywords_min_score", "keywords_diversity", "keywords_max_doc_freq"):
        value = cfg[key]
        assert isinstance(value, (int, float))
        assert 0.0 <= value <= 1.0, f"{key}={value} is outside [0.0, 1.0]"
    for key in ("keywords_min_section_chars", "keywords_tfidf_fallback_chars"):
        value = cfg[key]
        assert isinstance(value, int) and value > 0


# ---- snippets.json -------------------------------------------------------


def test_snippet_icons_and_messages_are_non_empty() -> None:
    """Every snippet has meaningful icon and message content."""
    data = _load_json("snippets.json")
    for mode in ("code", "review", "doc"):
        for i, snippet in enumerate(data[mode]):
            for field in ("icon", "tooltip", "message"):
                value = snippet[field]
                assert isinstance(value, str), (
                    f"{mode}[{i}].{field} is not a string: {value!r}"
                )
                assert value.strip(), f"{mode}[{i}].{field} is empty or whitespace"


def test_snippet_messages_do_not_reference_old_delimiters() -> None:
    """Snippet messages don't leak the specs3 guillemet delimiters."""
    data = _load_json("snippets.json")
    for mode in ("code", "review", "doc"):
        for i, snippet in enumerate(data[mode]):
            msg = snippet["message"]
            assert "\u00ab\u00ab\u00ab EDIT" not in msg, (
                f"{mode}[{i}] snippet message references old start marker"
            )
            assert "\u00bb\u00bb\u00bb EDIT END" not in msg, (
                f"{mode}[{i}] snippet message references old end marker"
            )


# ---- Prompt content sanity ----------------------------------------------


def test_system_prompt_describes_workflow_and_trust_rules() -> None:
    """system.md covers the must-have sections for a coding agent."""
    content = (CONFIG_DIR / "system.md").read_text(encoding="utf-8")
    lower = content.lower()
    assert "workflow" in lower, "system.md must describe a workflow"
    assert "context" in lower and "trust" in lower, (
        "system.md must establish context-trust rules"
    )
    assert "edit" in lower and "protocol" in lower, (
        "system.md must document the edit protocol"
    )
    assert "symbol map" in lower, "system.md must explain the symbol map"


def test_doc_system_prompt_is_documentation_focused() -> None:
    """system_doc.md is document-mode and avoids code-mode framing."""
    content = (CONFIG_DIR / "system_doc.md").read_text(encoding="utf-8")
    lower = content.lower()
    assert "document" in lower
    assert "outline" in lower
    assert "cross-reference" in lower or "cross reference" in lower


def test_review_prompt_states_readonly() -> None:
    """review.md makes clear the reviewer cannot apply edits."""
    content = (CONFIG_DIR / "review.md").read_text(encoding="utf-8")
    lower = content.lower()
    assert "read-only" in lower or "read only" in lower, (
        "review.md must state that review mode is read-only"
    )
    assert "review" in lower


def test_commit_prompt_mentions_conventional_commit_style() -> None:
    """commit.md instructs conventional commit format."""
    content = (CONFIG_DIR / "commit.md").read_text(encoding="utf-8")
    lower = content.lower()
    assert "conventional" in lower or "type" in lower and "scope" in lower
    assert "imperative" in lower


def test_compaction_prompt_requests_json_output() -> None:
    """compaction.md instructs JSON-only output with expected fields."""
    content = (CONFIG_DIR / "compaction.md").read_text(encoding="utf-8")
    lower = content.lower()
    assert "json" in lower
    assert "boundary_index" in content
    assert "confidence" in content
    assert "summary" in content


def test_system_reminder_is_short() -> None:
    """system_reminder.md is brief — it's appended to every user turn."""
    content = (CONFIG_DIR / "system_reminder.md").read_text(encoding="utf-8")
    # Budget: reminder appends on every turn; keep it under ~500 chars.
    assert len(content) < 1000, (
        f"system_reminder.md is {len(content)} chars — too long for a per-turn reminder"
    )
    # Must still carry the full end marker so the LLM stays correct.
    assert "\U0001f7e9\U0001f7e9\U0001f7e9 END" in content