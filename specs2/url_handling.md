# URL Handling

## Overview

The system detects URLs in user input, fetches and extracts their content, optionally summarizes via LLM, caches results, and makes content available as conversation context. It supports GitHub repositories, GitHub files, documentation sites, and generic web pages.

## Architecture

```
User types in input
    │
    ├─ URL detection (debounced) → URL chips appear
    │
    │ User clicks fetch button
    ▼
Fetch orchestrator
    │
    ├─ Cache check (hit → return)
    │
    ├─ Type detection → handler dispatch
    │       │
    │       ├── GitHub repo → shallow clone + symbol map
    │       ├── GitHub file → raw content fetch
    │       └── Web page → content extraction
    │
    ├─ Cache write
    │
    └─ Optional summarization (LLM call)
        │
        └─ Return result → chip updates to ✅
```

## URL Detection

### Pattern

Match `https?://` followed by non-whitespace, non-bracket characters. Exclude trailing punctuation (`,.:;!?`). Deduplicate within same text.

### URL Types

| Type | Detection |
|------|-----------|
| GitHub repo | `github.com/{owner}/{repo}` with no further path |
| GitHub file | `github.com/{owner}/{repo}/blob/{branch}/{path}` |
| GitHub issue | `github.com/{owner}/{repo}/issues/{number}` |
| GitHub PR | `github.com/{owner}/{repo}/pull/{number}` |
| Documentation | Known domains or `/docs/`, `/api/`, `/reference/` in path |
| Generic web | Any other valid HTTP(S) URL |

GitHub patterns also extract structured info: owner, repo, branch, path, issue/PR number.

Known doc domains include official language docs, MDN, ReadTheDocs subdomains, etc.

## Fetching

### GitHub Repository

1. Shallow clone (`depth=1`) to temporary directory, 2-minute timeout
2. Find README (try common names and case variants)
3. Generate **symbol map** using the symbol index engine (find supported files, index, produce compact format with references)
4. Return content with readme and symbol_map fields
5. Clean up temp directory

### GitHub File

1. Construct raw content URL
2. Fetch with 30-second timeout
3. If "main" branch returns 404, retry with "master"
4. Return content with filename as title

### Web Page

1. Fetch HTML with custom user agent, 30-second timeout
2. Detect charset from headers, default UTF-8
3. **Primary extraction** — use a content extraction library (e.g., trafilatura) to strip boilerplate, extract main text content and metadata
4. **Fallback** — basic HTML parsing: strip scripts/styles/tags, extract title/description, clean whitespace
5. Documentation URLs use the same extraction but are tagged for type-aware summarization

## Summarization

An LLM generates summaries using a fast/cheap model.

### Summary Types

| Type | Focus |
|------|-------|
| BRIEF | 2–3 paragraph overview |
| USAGE | Installation, patterns, key imports |
| API | Classes, functions, signatures |
| ARCHITECTURE | Modules, design patterns, data flow |
| EVALUATION | Maturity, dependencies, alternatives |

### Automatic Type Selection

| URL Type | Has Symbol Map? | Default Type |
|----------|----------------|-------------|
| GitHub repo | Yes | ARCHITECTURE |
| GitHub repo | No | BRIEF |
| GitHub file | — | BRIEF |
| Documentation | — | USAGE |
| Other | — | BRIEF |

User question keywords can override: "how to" → USAGE, "api" → API, "architecture" → ARCHITECTURE, "compare" → EVALUATION.

## Caching

### Filesystem Cache

| Property | Detail |
|----------|--------|
| Location | Configurable directory (default: system temp) |
| Key | First 16 chars of SHA-256 of URL |
| Format | JSON files containing serialized content |
| TTL | Configurable hours (default: 24) |

Summaries are cached as part of the content entry. When a cached entry lacks a summary but one is requested, it's generated and the entry updated in-place.

### Operations

| Method | Behavior |
|--------|----------|
| `get(url)` | Return if cached and not expired; delete expired/corrupt entries |
| `set(url, content)` | Write JSON; set fetch timestamp |
| `invalidate(url)` | Delete single entry |
| `clear()` | Delete all entries |
| `cleanup_expired()` | Scan and delete expired entries |

## Client-Side State

The URL service manages four state categories:

| State | Description |
|-------|-------------|
| Detected URLs | Found in current input, not yet fetched |
| Fetching URLs | In-flight fetch requests |
| Fetched URLs | Completed fetches with results |
| Excluded URLs | User-excluded from context |

### Lifecycle

1. **Detection** — debounced as user types, excludes already-fetched URLs
2. **Fetch** — on user click, fetches with cache and summarization
3. **Inclusion toggle** — excluded URLs visible but not sent as context
4. **Removal** — removes from fetched; may reappear as detected
5. **Dismissal** — removes unfetched URL from chips
6. **On send** — clears detected/fetching but preserves fetched (persist across messages)
7. **On clear conversation** — resets everything

### Message Integration

When sending a message:
1. Get all fetched URLs not excluded and not errored
2. Append formatted URL content to the message sent to the LLM
3. Show only the original text (without URL dump) in the UI

## URL Chips UI

Interactive chips below the chat area:

### Fetched Chips
- Checkbox for include/exclude
- Clickable label to view content in modal
- Remove button
- Status styling: success, excluded, error

### Detected Chips
- Type badge (emoji + label)
- Short display name
- Fetch button (📥) → spinner while fetching
- Dismiss button (×)

### Display Name Logic
- GitHub with path: `{owner}/{repo}/{filename}`
- GitHub without path: `{owner}/{repo}`
- Web: `{hostname}/{path}` (truncated if long)
- Fallback: first 40 chars

## Data Models

### URLContent

```pseudo
URLContent:
    url: string
    url_type: URLType
    title: string?
    description: string?
    content: string?          // Extracted page content
    symbol_map: string?       // For GitHub repos
    readme: string?           // For GitHub repos
    github_info: GitHubInfo?
    fetched_at: datetime?
    error: string?
    summary: string?
    summary_type: string?

    format_for_prompt(max_length):
        // Priority: summary → readme → content
        // Truncate at max_length, append symbol map if present
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

## RPC Methods

| Method | Description |
|--------|-------------|
| `detect_urls(text)` | Find and classify URLs |
| `fetch_url(url, use_cache, summarize, ...)` | Fetch and optionally summarize |
| `invalidate_url_cache(url)` | Remove from cache |
| `clear_url_cache()` | Clear all cached URLs |
| `get_url_content(url)` | Get cached content for display |

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