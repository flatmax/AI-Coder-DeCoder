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
    content: string?
    symbol_map: string?
    readme: string?
    github_info: GitHubInfo?
    error: string?
    summary: string?

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
```

## RPC Methods

| Method | Description |
|--------|-------------|
| `LLM.detect_urls(text)` | Find and classify URLs |
| `LLM.fetch_url(url, use_cache, summarize, ...)` | Fetch and optionally summarize |
| `LLM.get_url_content(url)` | Get cached content |
| `LLM.invalidate_url_cache(url)` | Remove from cache |
| `LLM.clear_url_cache()` | Clear all cached URLs |