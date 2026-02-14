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
| Generic web | Any other HTTP(S) URL |
| Unknown | Fallback for unrecognized schemes or patterns |

Also recognize `raw.githubusercontent.com` URLs as GitHub file references, extracting owner/repo/branch/path directly from the URL structure.

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

A `detect_and_fetch(text, ...)` method detects all URLs in a text block and fetches them sequentially, combining detection and fetch into a single call.

## Fetching by Type

### GitHub Repository
1. Shallow clone to temp directory (`git clone --depth 1`, 2-min timeout)
2. Search for README with priority: `README.md`, `README.rst`, `README.txt`, `README` (case-insensitive variants)
3. Find all files with supported extensions (`.py`, `.js`, `.ts`, `.cpp`, etc.), excluding hidden directories and `node_modules`
4. Generate symbol map using the symbol index engine (tree-sitter parsing with cross-file references)
5. Return `URLContent` with `readme` and `symbol_map` fields
6. Clean up temp directory in a `finally` block

### GitHub File
1. Construct raw content URL: `https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}`
2. Fetch via HTTP with 30s timeout
3. If branch is `main` and returns 404, retry with `master`
4. Return `URLContent` with `content` and `title` (filename)

### GitHub Issues and PRs
Fetched as generic web pages. Future: use GitHub API for richer structured data (labels, comments, status).

### Web Page
1. Fetch HTML with browser-like User-Agent and 30s timeout
2. Detect charset from HTTP `Content-Type` header, defaulting to UTF-8
3. Primary extraction via content extraction library (e.g., trafilatura):
   - Extract main article text, stripping navigation/ads/boilerplate
   - Include tables, exclude comments and links
   - Extract metadata: title, description, author, date
4. Fallback if extraction library unavailable or fails:
   - Extract `<title>` and `<meta name="description">`
   - Strip `<script>` and `<style>` blocks, then strip all HTML tags
   - Decode HTML entities, clean up whitespace

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

All available fields are assembled: title, description, readme, symbol map, and page content. The combined text is truncated to **100,000 characters** before being sent to the summarizer model with the appropriate type-specific prompt.

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
| Location | Configurable directory (default: system temp) |
| Key | SHA-256 prefix of URL (16 chars) |
| Format | JSON files containing serialized URLContent |
| TTL | Configurable (default: 24 hours) |

Summaries are cached as part of the content entry. When a cached entry lacks a summary but one is requested, the summary is generated and the cache entry is updated in-place — avoiding re-fetching the source content.

### Operations

| Method | Behavior |
|--------|----------|
| `get(url)` | Return if cached and not expired; delete expired/corrupt entries |
| `set(url, content)` | Write with timestamp; set `fetched_at` if not already set; create dir if needed |
| `invalidate(url)` | Delete single entry; return whether entry was found |
| `clear()` | Delete all; return count |
| `cleanup_expired()` | Scan and delete expired/corrupt entries; return count removed |

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
        // Truncate at max_length (default 4000 chars)
        // Append symbol map in code block if present
```

### URLResult

Wraps URLContent with fetch metadata:

```pseudo
URLResult:
    content: URLContent
    summary: string?
    summary_type: SummaryType?
    cached: boolean           // whether result came from cache
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

    repo_url:                 // computed: base repository URL
    clone_url:                // computed: .git clone URL
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
| `detect_and_fetch(text, ...)` | Detect all URLs in text and fetch sequentially |
| `get_url_content(url)` | Return content for display; checks in-memory fetched dict first, then filesystem cache; returns error URLContent if not found anywhere |
| `invalidate_url_cache(url)` | Remove from both filesystem cache and in-memory fetched dict |
| `clear_url_cache()` | Clear all cached and fetched URLs |
| `get_fetched_urls()` | List all fetched URLContent objects |
| `remove_fetched(url)` | Remove from in-memory fetched dict only; filesystem cache preserved for later retrieval |
| `clear_fetched()` | Clear in-memory fetched dict |
| `format_url_context(urls, excluded?, max_length?)` | Format fetched URLs for prompt injection, excluding specified URLs and errors |

Known documentation domains include: official language docs (docs.python.org, developer.mozilla.org/MDN), ReadTheDocs subdomains, and paths containing `/docs/`, `/documentation/`, `/api/`, or `/reference/`.

## RPC Methods

| Method | Description |
|--------|-------------|
| `LLM.detect_urls(text)` | Find and classify URLs |
| `LLM.fetch_url(url, use_cache, summarize, ...)` | Fetch and optionally summarize |
| `LLM.detect_and_fetch(text, use_cache, summarize)` | Detect and fetch all URLs in text |
| `LLM.get_url_content(url)` | Get content for modal display; checks in-memory fetched dict first, then filesystem cache |
| `LLM.remove_fetched_url(url)` | Remove from active context (in-memory) but preserve filesystem cache |
| `LLM.invalidate_url_cache(url)` | Remove from both filesystem cache and in-memory fetched dict |
| `LLM.clear_url_cache()` | Clear all cached and fetched URLs |

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
- Documentation: known domains, readthedocs, `/docs/`, `/documentation/`, and `/api/` paths
- Unknown type as fallback for unrecognized patterns
- Generic web for valid HTTP(S) URLs not matching other patterns

### Display Name
- GitHub: owner/repo, owner/repo/filename, owner/repo#N, owner/repo!N
- Generic: hostname/path; long URLs truncated to 40 chars; root URL strips trailing slash

### Summary Type Selection
- GitHub repo with/without symbols → ARCHITECTURE/BRIEF
- Documentation → USAGE; Generic → BRIEF
- User hints: "how to" → USAGE, "api" → API, "architecture" → ARCHITECTURE, "compare"/"evaluate" → EVALUATION

### URLContent
- format_for_prompt: includes URL header and title; summary preferred over raw content; readme fallback; symbol map appended in code block; truncation at 4000 chars with ellipsis
- Round-trip serialization (to_dict/from_dict) preserves all fields including github_info

### HTML Extraction
- Extracts title and metadata (description, author, date)
- Strips scripts and styles, cleans whitespace
- Charset detection from HTTP headers

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
- Per-message limit of 3 URLs during streaming
- README search with priority ordering (md, rst, txt, plain)
- Symbol map generation excludes hidden directories and node_modules