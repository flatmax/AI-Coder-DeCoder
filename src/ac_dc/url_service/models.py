"""Data models for URL handling."""

import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


class URLType(Enum):
    GITHUB_REPO = "github_repo"
    GITHUB_FILE = "github_file"
    GITHUB_ISSUE = "github_issue"
    GITHUB_PR = "github_pr"
    DOCUMENTATION = "documentation"
    GENERIC_WEB = "generic_web"
    UNKNOWN = "unknown"


class SummaryType(Enum):
    BRIEF = "brief"
    USAGE = "usage"
    API = "api"
    ARCHITECTURE = "architecture"
    EVALUATION = "evaluation"


@dataclass
class GitHubInfo:
    """Parsed GitHub URL components."""
    owner: str = ""
    repo: str = ""
    branch: Optional[str] = None
    path: Optional[str] = None
    issue_number: Optional[int] = None
    pr_number: Optional[int] = None

    @property
    def repo_url(self) -> str:
        return f"https://github.com/{self.owner}/{self.repo}"

    @property
    def clone_url(self) -> str:
        return f"https://github.com/{self.owner}/{self.repo}.git"


@dataclass
class URLContent:
    """Fetched URL content with metadata."""
    url: str
    url_type: URLType = URLType.UNKNOWN
    title: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None
    symbol_map: Optional[str] = None
    readme: Optional[str] = None
    github_info: Optional[GitHubInfo] = None
    fetched_at: Optional[datetime] = None
    error: Optional[str] = None
    summary: Optional[str] = None
    summary_type: Optional[str] = None

    def format_for_prompt(self, max_length: int = 4000) -> str:
        """Format content for LLM prompt injection.

        Priority: summary → readme → content.
        Append symbol map if present.
        """
        parts = []

        # Header
        parts.append(f"## URL: {self.url}")
        if self.title:
            parts.append(f"**{self.title}**")

        # Main content (priority order)
        main = ""
        if self.summary:
            main = self.summary
        elif self.readme:
            main = self.readme
        elif self.content:
            main = self.content

        if main:
            if len(main) > max_length:
                main = main[:max_length] + "..."
            parts.append(main)

        # Symbol map
        if self.symbol_map:
            remaining = max_length - len("\n".join(parts))
            if remaining > 200:
                sm = self.symbol_map
                if len(sm) > remaining:
                    sm = sm[:remaining] + "..."
                parts.append(f"\n```\n{sm}\n```")

        return "\n\n".join(parts)

    def to_dict(self) -> dict:
        """Serialize to dict for RPC/cache."""
        d = {
            "url": self.url,
            "url_type": self.url_type.value,
            "title": self.title,
            "description": self.description,
            "content": self.content,
            "symbol_map": self.symbol_map,
            "readme": self.readme,
            "fetched_at": self.fetched_at.isoformat() if self.fetched_at else None,
            "error": self.error,
            "summary": self.summary,
            "summary_type": self.summary_type,
        }
        if self.github_info:
            d["github_info"] = {
                "owner": self.github_info.owner,
                "repo": self.github_info.repo,
                "branch": self.github_info.branch,
                "path": self.github_info.path,
                "issue_number": self.github_info.issue_number,
                "pr_number": self.github_info.pr_number,
            }
        return d

    @classmethod
    def from_dict(cls, data: dict) -> "URLContent":
        """Deserialize from dict."""
        gh = None
        if data.get("github_info"):
            gi = data["github_info"]
            gh = GitHubInfo(
                owner=gi.get("owner", ""),
                repo=gi.get("repo", ""),
                branch=gi.get("branch"),
                path=gi.get("path"),
                issue_number=gi.get("issue_number"),
                pr_number=gi.get("pr_number"),
            )
        fetched_at = None
        if data.get("fetched_at"):
            try:
                fetched_at = datetime.fromisoformat(data["fetched_at"])
            except (ValueError, TypeError):
                pass
        url_type = URLType.UNKNOWN
        try:
            url_type = URLType(data.get("url_type", "unknown"))
        except ValueError:
            pass
        return cls(
            url=data.get("url", ""),
            url_type=url_type,
            title=data.get("title"),
            description=data.get("description"),
            content=data.get("content"),
            symbol_map=data.get("symbol_map"),
            readme=data.get("readme"),
            github_info=gh,
            fetched_at=fetched_at,
            error=data.get("error"),
            summary=data.get("summary"),
            summary_type=data.get("summary_type"),
        )


def url_hash(url: str) -> str:
    """SHA-256 prefix (16 chars) of a URL string."""
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


def display_name(url: str, url_type: URLType, github_info: Optional[GitHubInfo] = None) -> str:
    """Human-readable display name for a URL."""
    if github_info:
        owner = github_info.owner
        repo = github_info.repo
        if url_type == URLType.GITHUB_REPO:
            return f"{owner}/{repo}"
        elif url_type == URLType.GITHUB_FILE:
            if github_info.path:
                filename = github_info.path.rsplit("/", 1)[-1]
                return f"{owner}/{repo}/{filename}"
            return f"{owner}/{repo}"
        elif url_type == URLType.GITHUB_ISSUE:
            return f"{owner}/{repo}#{github_info.issue_number}"
        elif url_type == URLType.GITHUB_PR:
            return f"{owner}/{repo}!{github_info.pr_number}"

    # Generic: hostname/path truncated
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        host = parsed.hostname or ""
        path = parsed.path.rstrip("/")
        result = f"{host}{path}" if path else host
        if len(result) > 40:
            result = result[:37] + "..."
        return result
    except Exception:
        if len(url) > 40:
            return url[:37] + "..."
        return url