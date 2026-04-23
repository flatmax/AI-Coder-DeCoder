"""URL content data model — Layer 4.1.2.

Plain dataclasses, no behaviour beyond serialisation helpers.
Shared between the fetchers (which produce these), the cache
(which persists them), the summarizer (which adds a summary
field), and the prompt assembler (which formats them for the
LLM message).

Two dataclasses:

- :class:`GitHubInfo` — parsed GitHub URL components (owner,
  repo, branch, path, issue/PR number). Populated by GitHub
  fetchers; omitted for generic web-page fetches.
- :class:`URLContent` — the top-level record. Carries title,
  body text, extracted readme or content, optional symbol map
  (for GitHub repos), fetch timestamp, optional error, and
  optional summary.

Both round-trip through ``to_dict`` / ``from_dict`` for the
cache's JSON sidecar persistence. The from_dict path is
defensive — unknown fields are silently dropped rather than
raising, so schema evolution is backwards-compatible.

Governing spec: ``specs4/4-features/url-content.md#data-model``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# GitHubInfo — optional sub-record for GitHub URLs
# ---------------------------------------------------------------------------


@dataclass
class GitHubInfo:
    """Parsed components of a GitHub URL.

    Populated by the detection-time classifier for GITHUB_REPO,
    GITHUB_FILE, GITHUB_ISSUE, GITHUB_PR types. All fields are
    optional because different GitHub URL shapes produce
    different subsets — a repo URL has ``owner`` and ``repo``
    but no ``path``; a file URL adds ``branch`` and ``path``; an
    issue URL adds ``issue_number`` instead.

    No computed properties — the clone URL for a repo
    (``https://github.com/{owner}/{repo}.git``) is constructed
    inline by the GitHub repo fetcher, not here. Keeps the
    dataclass purely structural.
    """

    owner: str = ""
    repo: str = ""
    branch: str | None = None
    path: str | None = None
    issue_number: int | None = None
    pr_number: int | None = None

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-serialisable dict representation."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> GitHubInfo:
        """Reconstruct from a dict, ignoring unknown fields.

        Schema-permissive — if a future release adds a field
        and a user downgrades, the old client reads newer cache
        entries without failing. Missing fields fall back to
        dataclass defaults.
        """
        # Filter to known field names so unexpected keys don't
        # blow up the constructor. Matches specs4's
        # schema-permissive posture.
        known = {f for f in cls.__dataclass_fields__}
        filtered = {k: v for k, v in data.items() if k in known}
        return cls(**filtered)


# ---------------------------------------------------------------------------
# URLContent — the top-level record
# ---------------------------------------------------------------------------


# Default max length for prompt rendering. Long README or
# web-page content is truncated with an ellipsis so a single
# URL can't dominate the active-context budget. Callers can
# override by passing a different max_length to
# :meth:`URLContent.format_for_prompt`.
_DEFAULT_PROMPT_MAX_LENGTH = 50000


@dataclass
class URLContent:
    """Fetched content for a single URL.

    The complete record the cache stores and the prompt
    assembler consumes. Fields are populated progressively by
    different subsystems:

    - Fetchers set ``url``, ``url_type``, ``title``,
      ``content`` or ``readme``, ``symbol_map``,
      ``github_info``, ``fetched_at``, and optionally
      ``description``.
    - Failed fetches set ``error`` instead and leave other
      fields empty.
    - The summarizer sets ``summary`` and ``summary_type`` in
      place on cached records.

    The ``url_type`` field is stored as a string (the enum's
    value) rather than a :class:`URLType` instance so dict
    serialisation round-trips cleanly without registering a
    custom JSON encoder. Callers comparing against the enum
    use ``url_type == URLType.GITHUB_REPO.value`` or convert
    via ``URLType(content.url_type)``.
    """

    url: str = ""
    url_type: str = "generic"
    title: str | None = None
    description: str | None = None
    content: str | None = None
    symbol_map: str | None = None
    readme: str | None = None
    github_info: GitHubInfo | None = None
    fetched_at: str | None = None  # ISO 8601 UTC string, not datetime
    error: str | None = None
    summary: str | None = None
    summary_type: str | None = None

    def format_for_prompt(
        self,
        max_length: int = _DEFAULT_PROMPT_MAX_LENGTH,
    ) -> str:
        """Render the content for inclusion in an LLM message.

        Output shape::

            ## <url>
            **<title>**

            <body>

            ### Symbol Map
            <symbol_map>

        Body priority — summary (if present) beats readme beats
        content. Rationale: a good summary is the most
        token-efficient representation. When none is available,
        README is more structured than arbitrary web content,
        so it comes next. Raw content is the fallback.

        The body is truncated to ``max_length`` characters with
        an ellipsis when it overflows. Budget decisions downstream
        rely on this bound — a runaway scrape (large README,
        long technical blog post) cannot swamp the prompt.

        Empty return for error records — a URL that failed to
        fetch shouldn't contribute prompt content. The caller
        (prompt assembler) skips empty strings when joining
        URL parts.
        """
        if self.error:
            return ""

        parts = [f"## {self.url}"]
        if self.title:
            parts.append(f"**{self.title}**")

        # Body — pick the best available representation.
        body = self.summary or self.readme or self.content
        if body:
            if len(body) > max_length:
                body = body[:max_length] + "... (truncated)"
            parts.append(body)

        if self.symbol_map:
            parts.append(f"### Symbol Map\n{self.symbol_map}")

        # Blank-line separator between parts matches specs4's
        # assembly conventions — the LLM sees one URL per
        # markdown section, clearly delimited.
        return "\n\n".join(parts)

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-serialisable dict representation.

        GitHubInfo, when present, is serialised via its own
        ``to_dict`` so the result is a pure nested-dict
        structure with no dataclass instances. Lets the cache
        JSON-dump the result without a custom encoder.
        """
        data = asdict(self)
        # asdict converts nested dataclasses recursively, but
        # we want a stable "None vs populated" check for the
        # cache's downstream consumers. Normalise the GitHubInfo
        # dict so empty fields round-trip as the default
        # GitHubInfo rather than as literal Nones across
        # top-level URLContent fields.
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> URLContent:
        """Reconstruct from a dict.

        Strips internal cache-only fields (``_cached_at``, any
        other underscore-prefixed keys) before constructing —
        they are the cache's responsibility, not part of the
        URLContent contract. Unknown fields are silently
        dropped for schema-forward compatibility.

        ``github_info`` is reconstructed via
        :meth:`GitHubInfo.from_dict` when present.
        """
        # Filter to fields we actually know about. Strips
        # leading-underscore cache fields and any future
        # additions from newer releases.
        known = {f for f in cls.__dataclass_fields__}
        filtered: dict[str, Any] = {
            k: v for k, v in data.items() if k in known
        }

        # Rebuild nested github_info if it was a dict.
        gh = filtered.get("github_info")
        if isinstance(gh, dict):
            filtered["github_info"] = GitHubInfo.from_dict(gh)
        elif gh is None:
            filtered["github_info"] = None

        return cls(**filtered)