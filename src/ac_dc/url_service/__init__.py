"""URL content service — Layer 4.1.

Detects URLs in user input, fetches and extracts content, optionally
summarizes via a smaller LLM, caches results to disk, and makes
content available as conversation context.

Governing spec: ``specs4/4-features/url-content.md``.

This package is deliberately split into small modules:

- ``detection`` — regex-based URL finding, classification, display
  name formatting. Pure functions, no I/O.
- ``models`` — the URLContent + GitHubInfo dataclasses.
- ``cache`` — filesystem sidecar cache with TTL.
- ``fetchers`` — per-type fetch logic (web, GitHub repo, GitHub file).
- ``summarizer`` — smaller-model summarization with type-aware prompts.
- ``service`` — top-level URLService orchestrating the above.

Layer 4.1 lands these in order: detection and display names
first (no dependencies), then the data model and cache (which the
fetchers write into), then the fetchers, the summarizer, and
finally the service that wires them to the LLMService's streaming
path.
"""

from __future__ import annotations

from ac_dc.url_service.detection import (
    URLType,
    classify_url,
    detect_urls,
    display_name,
)

__all__ = [
    "URLType",
    "classify_url",
    "detect_urls",
    "display_name",
]