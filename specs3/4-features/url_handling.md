# URL Handling

## Overview

The system detects URLs in user input, fetches and extracts content, optionally summarizes via LLM, caches results, and makes content available as conversation context. For the UI chip component, see [URL Chips](../5-webapp/url_chips.md).

## URL Detection

Match `https?://` followed by non-whitespace, non-bracket characters. Exclude trailing punctuation. Deduplicate within same text.

### URL Types

| Type | Detection |
|------|-----------|
| GitHub repo | `github.com/{owner}/{repo}` with no further path |
| GitHub file | `github.com/{owner}/{repo}/blob/{branch}/{path}` |
| GitHub issue/PR | `github.com/{owner}/{repo}/issues/{N}` or `/pull/{N}` |
| Documentation | Known domains or `/docs/`, `/documentation/`, `/api/`, `/reference/` in path |
| Generic | Any other HTTP(S) URL (fallback for all unrecognized patterns) |

Also recognize `raw.githubusercontent.com` URLs as GitHub file references, extracting owner/repo/branch/path directly from the URL structure. When fetching these URLs, the raw URL is already the content URL — no transformation to `raw.githubusercontent.com` is needed since the URL already points there.

## Fetch Orchestration

The fetch pipeline follows this sequence:

1. **Cache check** — If `use_cache` is true, look up the URL in cache. On hit:
   - If the cached entry already has a summary, return immediately.
   - If `summarize` is requested but no cached summary exists, generate the summary, update the cache entry in-place, and return.
   - Otherwise return the cached content as-is.
2. **Type detection** — Classify the URL if not already classified.
3. **Handler dispatch** — Route to the appropriate handler based on type.
4. **Cache write** — If fetch succeeded, store the result (error results are not cached).
5. **Summarization** — If `summarize` is true and no error, generate a summary and update the cache entry.

### Per-Message Limit

During streaming, up to **3 URLs per message** are detected and fetched from the user prompt. This prevents unbounded fetching from URL-heavy messages.

### Convenience Method

A `detect_and_fetch(text, ..., max_urls=None)` method detects all URLs in a text block and fetches them sequentially, combining detection and fetch into a single call. The optional `max_urls` parameter limits the number of URLs fetched (default: no limit).

## Fetching by Type

### GitHub Repository
1. Shallow clone to temp directory (`git clone --depth 1`, 2-min timeout via `subprocess.run`)
2. Search for README using a two-pass approach:
   - **Pass 1 — exact match**: iterate a priority-ordered candidate list (`README.md`, `README.rst`, `README.txt`, `README`, `readme.md`, `readme.rst`, ..., `Readme.md`, etc.) and check each path against the cloned directory
   - **Pass 2 — case-insensitive fallback**: if no exact match found, build a lowercase→actual filename map from `os.listdir` and look up `readme.md`, `readme.rst`, `readme.txt`, `readme` in that map
3. Generate symbol map if `symbol_index_cls` was provided at `URLService` construction time:
   - Instantiate the symbol index on the cloned directory
   - Call `index_repo()` then `get_symbol_map()`
   - Symbol map generation failures are logged but do not fail the overall fetch
4. Return `URLContent` with `readme`, `symbol_map`, and `title` (`{owner}/{repo}`) fields. Set `fetched_at` timestamp
5. Clean up temp directory via `shutil.rmtree(ignore_errors=True)` in a `finally` block

### GitHub File
1. Construct raw content URL: `https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}`
2. Default branch to `"main"` if not specified in the parsed `GitHubInfo`
3. Fetch via HTTP with 30s timeout (UTF-8 decode)
4. On any exception: if branch was `"main"`, retry with `"master"`. Only the explicit `"main"` string triggers retry — other branch names fail immediately
5. Return `URLContent` with `content` field and `title` set to the filename (last path component) or `{owner}/{repo}` if no path

### GitHub Issues and PRs
Fetched as generic web pages. Future: use GitHub API for richer structured data (labels, comments, status).

### Web Page
1. Fetch HTML with browser-like User-Agent and 30s timeout
2. Decode response body as UTF-8, falling back to latin-1 on `UnicodeDecodeError` (does not parse `Content-Type` charset header)
3. Extract `<title>` tag content via regex (always, before trafilatura)
4. Primary extraction via content extraction library (trafilatura):
   - Extract main article text, stripping navigation/ads/boilerplate
   - Returns plain text content
5. Fallback if trafilatura unavailable (`ImportError`) or returns nothing:
   - Strip `<script>` and `<style>` blocks (regex with DOTALL)
   - Strip all remaining HTML tags (regex)
   - Decode HTML entities via `html.unescape()`
   - Collapse whitespace to single spaces

Documentation URLs use the same extraction pipeline but are tagged as documentation type for summary type selection.

## Summarization

LLM generates summaries using a fast/cheap model.

| Type | Focus |
|------|-------|
| BRIEF | 2–3 paragraph overview |
| USAGE | Installation, patterns, key imports |
| API | Classes, functions, signatures |
| ARCHITECTURE | Modules, design, data flow |
| EVALUATION | Maturity, dependencies, alternatives |

### Content Assembly for Summarizer

The summarizer builds a user prompt from available fields in this order:
1. The type-specific focus prompt (e.g., "Provide a 2-3 paragraph overview")
2. `"Content from {url}:"`
3. Body text: `readme` field preferred, then `content` field
4. Body truncated to **100,000 characters** with `"... (truncated)"` suffix if exceeded
5. Symbol map appended under `"Symbol Map:"` header if present

The system message is a fixed string: `"Summarize the following content concisely."` The summarizer uses `stream=False` (non-streaming) via `litellm.completion`.

### Auto-Selection

| URL Type | Has Symbol Map? | Default |
|----------|----------------|---------|
| GitHub repo | Yes | ARCHITECTURE |
| GitHub repo | No | BRIEF |
| GitHub file | — | BRIEF |
| Documentation | — | USAGE |
| Other | — | BRIEF |

User keywords can override: "how to" → USAGE, "api" → API, "architecture" → ARCHITECTURE, "compare"/"evaluate" → EVALUATION.

## Caching

| Property | Detail |
|----------|--------|
| Location | Configurable directory (default: `{tempdir}/ac-dc-url-cache`) |
| Key | SHA-256 prefix of URL (16 chars) |
| Format | JSON files named `{hash}.json` containing serialized URLContent plus `_cached_at` timestamp |
| TTL | Configurable via `ttl_hours` (default: 24 hours); computed as `ttl_hours × 3600` seconds |

Summaries are cached as part of the content entry. When a cached entry lacks a summary but one is requested, the summary is generated and the cache entry is updated in-place via `set()` — avoiding re-fetching the source content.

### Operations

| Method | Behavior |
|--------|----------|
| `get(url)` | Return dict if cached and `time.time() - _cached_at ≤ ttl_seconds`; delete corrupt entries (bad JSON); return None for miss/expired |
| `set(url, content)` | Add `_cached_at = time.time()` to the content dict; set `fetched_at` to UTC ISO 8601 string if missing or explicitly `None` in the content dict; write as JSON |
| `invalidate(url)` | Delete single cache file; return `True` if file existed, `False` otherwise |
| `clear()` | Delete all `*.json` files in cache dir; return count deleted |
| `cleanup_expired()` | Scan all `*.json` files, delete those where `_cached_at` has exceeded TTL or JSON is corrupt; return count removed |

## Data Models

### URLContent

```pseudo
URLContent:
    url: string = ""
    url_type: string = "generic"    # stored as string, not enum
    title: string? = None
    description: string? = None
    content: string? = None
    symbol_map: string? = None
    readme: string? = None
    github_info: GitHubInfo? = None
    fetched_at: string? = None      # ISO 8601 UTC string, not a datetime object
    error: string? = None
    summary: string? = None
    summary_type: string? = None

    format_for_prompt(max_length=50000):
        // Build parts: ["## {url}"]
        // Append "**{title}**" if title present
        // Body priority: summary → readme → content
        // Truncate body at max_length with "... (truncated)" suffix
        // Append "### Symbol Map\n{symbol_map}" if present
        // Join parts with "\n\n"

    to_dict():
        // dataclass asdict(), with github_info serialized via its own to_dict()

    from_dict(d):
        // Strip internal cache fields (_cached_at) before constructing
        // Reconstruct github_info via GitHubInfo.from_dict() if present
```

### Fetch Return Value

`URLService.fetch_url()` returns `URLContent` directly with summary fields populated on the content object itself. The `to_dict()` method on `URLContent` is used for RPC serialization. There is no separate wrapper — all fields (including `summary` and `summary_type`) live on `URLContent`.

### GitHubInfo

```pseudo
GitHubInfo:
    owner: string = ""
    repo: string = ""
    branch: string? = None
    path: string? = None
    issue_number: integer? = None
    pr_number: integer? = None

    to_dict():   // dataclass asdict()
    from_dict(d):  // construct from dict, filtering to known fields only
```

No computed properties — the clone URL (`https://github.com/{owner}/{repo}.git`) is constructed inline by the GitHub repo fetcher.

## URL Service

The `URLService` class manages the lifecycle of URL content:

| State | Description |
|-------|-------------|
| `_cache` | Filesystem cache for fetched content |
| `_model` | Smaller model for summarization |
| `_symbol_index_cls` | SymbolIndex class reference — passed to GitHub repo fetching so cloned repos get symbol maps generated |
| `_fetched` | Dict of fetched `URLContent` objects (in-memory, keyed by URL) |

The `LLMService` initializes the URL service via `_init_url_service()` which creates a `URLCache` from the `url_cache_config`, passes the `smaller_model` for summarization, and provides the `SymbolIndex` class reference for GitHub repo symbol map generation.

| Method | Description |
|--------|-------------|
| `detect_urls(text)` | Find and classify URLs in text (sync) |
| `async fetch_url(url, ...)` | Fetch, cache, optionally summarize (async — uses LLM for summarization) |
| `async detect_and_fetch(text, ...)` | Detect all URLs in text and fetch sequentially (async) |
| `get_url_content(url)` | Return content for display; checks in-memory fetched dict first, then filesystem cache; returns `URLContent(url=url, error="URL not yet fetched")` if not found anywhere. This specific error string is used as a sentinel by `_stream_chat` to determine whether a URL needs fetching (sync) |
| `invalidate_url_cache(url)` | Remove from both filesystem cache and in-memory fetched dict (sync) |
| `clear_url_cache()` | Clear all cached and fetched URLs (sync) |
| `get_fetched_urls()` | List all fetched URLContent objects (sync) |
| `remove_fetched(url)` | Remove from in-memory fetched dict only; filesystem cache preserved for later retrieval (sync) |
| `clear_fetched()` | Clear in-memory fetched dict only; filesystem cache preserved (sync) |
| `format_url_context(urls?, excluded?, max_length?)` | Format fetched URLs for prompt injection; `urls` defaults to all fetched URLs when None; `max_length` defaults to 50000; excludes specified URLs and errors; returns empty string when no URLs qualify (sync) |

Known documentation domains include: official language docs (docs.python.org, developer.mozilla.org/MDN), ReadTheDocs subdomains, and paths containing `/docs/`, `/documentation/`, `/api/`, or `/reference/`.

## RPC Methods

| Method | Description |
|--------|-------------|
| `LLMService.detect_urls(text)` | Find and classify URLs (sync) |
| `LLMService.fetch_url(url, use_cache, summarize, ...)` | Fetch and optionally summarize (async — uses LLM for summarization) |
| `LLMService.detect_and_fetch(text, use_cache, summarize)` | Detect and fetch all URLs in text; passes `text` as `user_text` for summary type auto-selection (async) |
| `LLMService.get_url_content(url)` | Get content for modal display; checks in-memory fetched dict first, then filesystem cache (sync) |
| `LLMService.remove_fetched_url(url)` | Remove from active context (in-memory) but preserve filesystem cache (sync) |
| `LLMService.invalidate_url_cache(url)` | Remove from both filesystem cache and in-memory fetched dict (sync) |
| `LLMService.clear_url_cache()` | Clear all cached and fetched URLs (sync) |

## Testing

### URL Cache
- Set/get round-trip; miss returns None; expired returns None
- Invalidate removes entry and returns found status; clear removes all and returns count
- cleanup_expired returns count of removed entries (both expired and corrupt)
- Corrupt JSON entry handled (cleaned up, returns None)
- URL hash: deterministic, 16 chars, different URLs produce different hashes
- Default cache dir created automatically
- Summary added to cached entry without re-fetching source content

### URL Detection
- Basic detection, multiple URLs, deduplication
- Trailing punctuation/comma stripped
- No URLs returns empty; http supported; file:// rejected
- `raw.githubusercontent.com` URLs recognized as GitHub file type

### URL Classification
- GitHub repo (with trailing slash, .git suffix), file (owner/repo/branch/path), issue (#N), PR (!N)
- Documentation: known domains, readthedocs, `/docs/`, `/documentation/`, `/api/`, and `/reference/` paths
- Generic as fallback for all valid HTTP(S) URLs not matching other patterns (there is no separate "Unknown" type)

### Display Name
- GitHub repo: `owner/repo`
- GitHub file: `owner/repo/filename` (last path component only)
- GitHub issue: `owner/repo#N`
- GitHub PR: `owner/repo!N`
- Generic/Documentation: `hostname/path` (trailing slash stripped); truncated to 40 chars with `...` suffix if longer
- `display_name(url, url_type?)` accepts optional type to skip re-classification
- `raw.githubusercontent.com` URLs: classified as `github_file` but display name falls through to generic format (`hostname/path`, truncated) because the GitHub file regex only matches `github.com` URLs. This means raw URLs display as `raw.githubusercontent.com/owner/repo/...` rather than the compact `owner/repo/filename` format

### Summary Type Selection
- GitHub repo with/without symbols → ARCHITECTURE/BRIEF
- Documentation → USAGE; Generic → BRIEF
- User hints: "how to" → USAGE, "api" → API, "architecture" → ARCHITECTURE, "compare"/"evaluate" → EVALUATION

### URLContent
- format_for_prompt: includes URL header and title; summary preferred over raw content; readme fallback; symbol map appended in code block; truncation with ellipsis at configurable max_length (default 50000)
- Round-trip serialization (to_dict/from_dict) preserves all fields including github_info

### HTML Extraction
- Extracts title from `<title>` tag via regex (case-insensitive, DOTALL)
- Strips scripts and styles via regex, strips remaining tags, decodes HTML entities, collapses whitespace
- UTF-8 decode with latin-1 fallback (no Content-Type charset parsing)

### URL Service
- detect_urls returns classified results
- detect_and_fetch returns results for all URLs in text
- get_url_content returns error for unfetched URL; returns content for fetched URL
- get_url_content falls back to filesystem cache when URL not in in-memory fetched dict
- Invalidate removes from both cache and fetched dict; clear removes all
- remove_fetched removes from in-memory dict only; filesystem cache preserved
- get_fetched_urls empty initially; remove_fetched and clear_fetched
- format_url_context joins multiple URLs with separator; excludes specified URLs; skips errors
- Fetch uses cache when available; web page fetch via mocked urlopen; GitHub file fetch with main/master fallback
- Error results not cached
- Summarization via mocked LLM appends summary to result
- Per-message limit of 3 URLs during streaming (enforced in `_stream_chat`, not in `URLService` itself)
- README search: two-pass approach — exact match from priority list, then case-insensitive fallback via `os.listdir` lowercase map
- Symbol map generation for GitHub repos: instantiates `symbol_index_cls` on cloned directory, calls `index_repo()` then `get_symbol_map()`; failures logged but don't fail the fetch
- `format_url_context` returns empty string when no URLs qualify (all excluded or all errors)