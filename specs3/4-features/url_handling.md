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
| Documentation | Known domains or `/docs/`, `/api/`, `/reference/` in path |
| Generic web | Any other HTTP(S) URL |

## Fetching

### GitHub Repository
1. Shallow clone to temp directory (2-min timeout)
2. Find README
3. Generate symbol map using the symbol index engine
4. Return readme + symbol_map
5. Clean up temp directory

### GitHub File
1. Construct raw content URL
2. Fetch (30s timeout); retry with "master" if "main" returns 404

### Web Page
1. Fetch HTML (30s timeout)
2. Primary extraction via content extraction library (e.g., trafilatura)
3. Fallback: basic HTML parsing (strip scripts/styles/tags)

## Summarization

LLM generates summaries using a fast/cheap model.

| Type | Focus |
|------|-------|
| BRIEF | 2–3 paragraph overview |
| USAGE | Installation, patterns, key imports |
| API | Classes, functions, signatures |
| ARCHITECTURE | Modules, design, data flow |
| EVALUATION | Maturity, dependencies, alternatives |

### Auto-Selection

| URL Type | Has Symbol Map? | Default |
|----------|----------------|---------|
| GitHub repo | Yes | ARCHITECTURE |
| GitHub repo | No | BRIEF |
| GitHub file | — | BRIEF |
| Documentation | — | USAGE |
| Other | — | BRIEF |

User keywords can override: "how to" → USAGE, "api" → API, etc.

## Caching

| Property | Detail |
|----------|--------|
| Location | Configurable directory (default: system temp) |
| Key | SHA-256 prefix of URL |
| Format | JSON files |
| TTL | Configurable (default: 24 hours) |

Summaries cached as part of the content entry.

### Operations

| Method | Behavior |
|--------|----------|
| `get(url)` | Return if cached and not expired |
| `set(url, content)` | Write with timestamp |
| `invalidate(url)` | Delete single entry |
| `clear()` | Delete all |
| `cleanup_expired()` | Scan and delete expired |

## Data Models

### URLContent

```pseudo
URLContent:
    url: string
    url_type: URLType
    title: string?
    description: string?
    content: string?
    symbol_map: string?
    readme: string?
    github_info: GitHubInfo?
    fetched_at: datetime?
    error: string?
    summary: string?
    summary_type: string?

    format_for_prompt(max_length):
        // Priority: summary → readme → content
        // Truncate at max_length, append symbol map
```

### GitHubInfo

```pseudo
GitHubInfo:
    owner: string
    repo: string
    branch: string?
    path: string?
    issue_number: integer?
    pr_number: integer?
```

## URL Service

The `URLService` class manages the lifecycle of URL content:

| State | Description |
|-------|-------------|
| `_cache` | Filesystem cache for fetched content |
| `_model` | Smaller model for summarization |
| `_fetched` | Dict of fetched `URLContent` objects (in-memory, keyed by URL) |

| Method | Description |
|--------|-------------|
| `detect_urls(text)` | Find and classify URLs in text |
| `fetch_url(url, ...)` | Fetch, cache, optionally summarize |
| `get_url_content(url)` | Return cached content for display |
| `invalidate_url_cache(url)` | Remove from cache and fetched dict |
| `clear_url_cache()` | Clear all cached and fetched URLs |
| `get_fetched_urls()` | List all fetched URLContent objects |
| `remove_fetched(url)` | Remove from in-memory fetched dict |
| `clear_fetched()` | Clear in-memory fetched dict |
| `format_url_context(urls, excluded?, max_length?)` | Format fetched URLs for prompt injection, excluding specified URLs and errors |

Known documentation domains include: official language docs (docs.python.org, developer.mozilla.org/MDN), ReadTheDocs subdomains, and paths containing `/docs/`, `/api/`, or `/reference/`.

## RPC Methods

| Method | Description |
|--------|-------------|
| `LLM.detect_urls(text)` | Find and classify URLs |
| `LLM.fetch_url(url, use_cache, summarize, ...)` | Fetch and optionally summarize |
| `LLM.get_url_content(url)` | Get cached content |
| `LLM.invalidate_url_cache(url)` | Remove from cache |
| `LLM.clear_url_cache()` | Clear all cached URLs |

## Testing

### URL Cache
- Set/get round-trip; miss returns None; expired returns None
- Invalidate removes entry; clear removes all
- cleanup_expired returns count of removed entries
- Corrupt JSON entry handled (cleaned up, returns None)
- URL hash: deterministic, 16 chars, different URLs produce different hashes
- Default cache dir created automatically

### URL Detection
- Basic detection, multiple URLs, deduplication
- Trailing punctuation/comma stripped
- No URLs returns empty; http supported; file:// rejected

### URL Classification
- GitHub repo (with trailing slash, .git suffix), file (owner/repo/branch/path), issue (#N), PR (!N)
- Documentation: known domains, readthedocs, /docs/ and /api/ paths
- Generic fallback for unrecognized URLs

### Display Name
- GitHub: owner/repo, owner/repo/filename, owner/repo#N, owner/repo!N
- Generic: hostname/path; long URLs truncated to 40 chars; root URL strips trailing slash

### Summary Type Selection
- GitHub repo with/without symbols → ARCHITECTURE/BRIEF
- Documentation → USAGE; Generic → BRIEF
- User hints: "how to" → USAGE, "api" → API, "architecture" → ARCHITECTURE, "compare" → EVALUATION

### URLContent
- format_for_prompt: includes URL header and title; summary preferred over raw content; readme fallback; symbol map appended; truncation with ellipsis
- Round-trip serialization (to_dict/from_dict) preserves all fields including github_info

### HTML Extraction
- Extracts title, strips scripts and styles, cleans whitespace

### URL Service
- detect_urls returns classified results
- get_url_content returns error for unfetched URL
- Invalidate and clear cache operations
- get_fetched_urls empty initially; remove_fetched and clear_fetched
- format_url_context joins multiple URLs with separator; excludes specified URLs; skips errors
- Fetch uses cache when available; web page fetch via mocked urlopen; GitHub file fetch
- Error results not cached
- Summarization via mocked LLM appends summary to result