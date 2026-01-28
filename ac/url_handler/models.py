"""Data models for URL content handling."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
from datetime import datetime


class URLType(Enum):
    """Type of URL detected."""
    GITHUB_REPO = "github_repo"
    GITHUB_FILE = "github_file"
    GITHUB_ISSUE = "github_issue"
    GITHUB_PR = "github_pr"
    DOCUMENTATION = "documentation"
    GENERIC_WEB = "generic_web"
    UNKNOWN = "unknown"


class SummaryType(Enum):
    """Type of summary to generate."""
    BRIEF = "brief"           # 2-3 paragraph overview
    USAGE = "usage"           # Installation, patterns, key imports
    API = "api"               # Classes, functions, signatures
    ARCHITECTURE = "arch"     # Modules, design patterns, data flow
    EVALUATION = "eval"       # Maturity, dependencies, alternatives


@dataclass
class GitHubInfo:
    """Parsed GitHub URL information."""
    owner: str
    repo: str
    branch: Optional[str] = None
    path: Optional[str] = None
    issue_number: Optional[int] = None
    pr_number: Optional[int] = None
    
    @property
    def repo_url(self) -> str:
        """Get the base repository URL."""
        return f"https://github.com/{self.owner}/{self.repo}"
    
    @property
    def clone_url(self) -> str:
        """Get the clone URL."""
        return f"https://github.com/{self.owner}/{self.repo}.git"


@dataclass
class URLContent:
    """Content fetched from a URL."""
    url: str
    url_type: URLType
    title: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None
    symbol_map: Optional[str] = None
    readme: Optional[str] = None
    github_info: Optional[GitHubInfo] = None
    fetched_at: Optional[datetime] = None
    error: Optional[str] = None
    
    def to_dict(self) -> dict:
        """Convert to dictionary for serialization."""
        return {
            'url': self.url,
            'url_type': self.url_type.value,
            'title': self.title,
            'description': self.description,
            'content': self.content,
            'symbol_map': self.symbol_map,
            'readme': self.readme,
            'github_info': {
                'owner': self.github_info.owner,
                'repo': self.github_info.repo,
                'branch': self.github_info.branch,
                'path': self.github_info.path,
                'issue_number': self.github_info.issue_number,
                'pr_number': self.github_info.pr_number,
            } if self.github_info else None,
            'fetched_at': self.fetched_at.isoformat() if self.fetched_at else None,
            'error': self.error,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'URLContent':
        """Create from dictionary."""
        github_info = None
        if data.get('github_info'):
            gi = data['github_info']
            github_info = GitHubInfo(
                owner=gi['owner'],
                repo=gi['repo'],
                branch=gi.get('branch'),
                path=gi.get('path'),
                issue_number=gi.get('issue_number'),
                pr_number=gi.get('pr_number'),
            )
        
        fetched_at = None
        if data.get('fetched_at'):
            fetched_at = datetime.fromisoformat(data['fetched_at'])
        
        return cls(
            url=data['url'],
            url_type=URLType(data['url_type']),
            title=data.get('title'),
            description=data.get('description'),
            content=data.get('content'),
            symbol_map=data.get('symbol_map'),
            readme=data.get('readme'),
            github_info=github_info,
            fetched_at=fetched_at,
            error=data.get('error'),
        )


@dataclass
class URLResult:
    """Result of URL processing with optional summary."""
    content: URLContent
    summary: Optional[str] = None
    summary_type: Optional[SummaryType] = None
    cached: bool = False
    
    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            'content': self.content.to_dict(),
            'summary': self.summary,
            'summary_type': self.summary_type.value if self.summary_type else None,
            'cached': self.cached,
        }
