"""URL service RPC surface — thin delegations to :class:`URLService`.

Extracted from :mod:`ac_dc.llm_service` to keep that module
focused on construction and the streaming entry point. The
functions here implement the public RPC surface the browser
calls to drive the URL chip UI (detect on input, fetch on
click, view content in a modal, remove/invalidate).

Three groupings:

- **Detect/fetch** — :func:`detect_urls`, :func:`fetch_url`,
  :func:`detect_and_fetch`. The async ones run the blocking
  HTTP / git-clone / LLM summarization in the aux executor
  so the event loop stays responsive.
- **Read-only query** — :func:`get_url_content`. Returns the
  stored content dict or a sentinel error. No localhost
  gate — reading URL state is safe for any caller.
- **Mutation** — :func:`invalidate_url_cache`,
  :func:`remove_fetched_url`, :func:`clear_url_cache`.
  Localhost-only.

Every function takes :class:`LLMService` as first argument.
The service's public methods stay as thin delegators so
callers (tests, JRPC-OO surface) continue to call
``service.fetch_url(...)`` etc.

Governing spec: :doc:`specs4/4-features/url-content`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ac_dc.llm_service import LLMService


# ---------------------------------------------------------------------------
# Detect / fetch
# ---------------------------------------------------------------------------


def detect_urls(
    service: "LLMService",
    text: str,
) -> list[dict[str, Any]]:
    """Return detected URLs with classification and display names.

    Shape: ``[{url, type, display_name}, ...]``. ``type`` is the
    string form of :class:`URLType` so the frontend doesn't
    need to unwrap an enum.
    """
    return service._url_service.detect_urls(text)


async def fetch_url(
    service: "LLMService",
    url: str,
    use_cache: bool = True,
    summarize: bool = True,
    user_text: str | None = None,
) -> dict[str, Any]:
    """Fetch a URL with optional summarization.

    Runs in the aux executor so the blocking HTTP / git-clone
    / LLM summarization doesn't starve the event loop. The
    returned dict is the URLContent dataclass's ``to_dict``
    form — frontend consumes the same fields regardless of
    whether it came from a fresh fetch or a cache hit.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    assert service._main_loop is not None
    loop = service._main_loop
    content = await loop.run_in_executor(
        service._aux_executor,
        lambda: service._url_service.fetch_url(
            url,
            use_cache=use_cache,
            summarize=summarize,
            user_text=user_text,
        ),
    )
    return content.to_dict()


async def detect_and_fetch(
    service: "LLMService",
    text: str,
    use_cache: bool = True,
    summarize: bool = True,
) -> list[dict[str, Any]] | dict[str, Any]:
    """Detect and fetch all URLs in text.

    Convenience wrapper for the frontend's "fetch all" button
    on the URL chips panel. Sequential per-URL, runs in the
    aux executor for the same reason as :func:`fetch_url`.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    assert service._main_loop is not None
    loop = service._main_loop
    results = await loop.run_in_executor(
        service._aux_executor,
        lambda: service._url_service.detect_and_fetch(
            text,
            use_cache=use_cache,
            summarize=summarize,
        ),
    )
    return [c.to_dict() for c in results]


# ---------------------------------------------------------------------------
# Read-only query
# ---------------------------------------------------------------------------


def get_url_content(
    service: "LLMService",
    url: str,
) -> dict[str, Any]:
    """Return the stored content for a URL (or a sentinel error).

    Checks in-memory first, falls back to filesystem cache.
    Returns a URLContent dict; the frontend checks the
    ``error`` field to distinguish fetched content from
    "not yet fetched" (sentinel) vs "fetch failed" (real
    error).
    """
    content = service._url_service.get_url_content(url)
    return content.to_dict()


# ---------------------------------------------------------------------------
# Mutation
# ---------------------------------------------------------------------------


def invalidate_url_cache(
    service: "LLMService",
    url: str,
) -> dict[str, Any]:
    """Remove a URL from both cache and in-memory dict.

    Used by the "refresh this URL" action on the chip UI —
    forces the next fetch to hit the network.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    return service._url_service.invalidate_url_cache(url)


def remove_fetched_url(
    service: "LLMService",
    url: str,
) -> dict[str, Any]:
    """Remove a URL from the in-memory fetched dict only.

    Preserves the filesystem cache — a later re-fetch will
    hit the cache. Used by the "remove from this conversation"
    action on the chip UI.
    """
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    return service._url_service.remove_fetched(url)


def clear_url_cache(service: "LLMService") -> dict[str, Any]:
    """Clear all cached and fetched URLs."""
    restricted = service._check_localhost_only()
    if restricted is not None:
        return restricted
    return service._url_service.clear_url_cache()