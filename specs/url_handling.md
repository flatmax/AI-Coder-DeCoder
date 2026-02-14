# URL Handling & Scraping Spec

The URL handling system detects URLs in user input, fetches and extracts their content, optionally summarizes it via LLM, caches results, and makes the content available as context for the conversation. It supports GitHub repositories (via shallow clone with symbol map generation), GitHub files (via raw content), documentation sites, and generic web pages.

## Architecture

```
User types in textarea
       │
       ▼
UrlService.detectUrlsInInput() ──300ms debounce──► LiteLLM.detect_urls (JRPC)
       │                                                    │
       ▼                                                    ▼
URL chips appear ◄────────────────────────────────── URLDetector.find_urls()
       │                                             URLDetector.detect_type()
       │ user clicks 📥
       ▼
UrlService.fetchUrl() ──► LiteLLM.fetch_url (JRPC) ──► URLFetcher.fetch()
                                                            │
                                            ┌───────────────┼───────────────┐
                                            ▼               ▼               ▼
                                       URLCache        GitHubHandler   WebHandler
                                      (hit/miss)      (clone/raw)    (trafilatura)
                                            │               │               │
                                            └───────┬───────┘───────────────┘
                                                    ▼
                                               Summarizer (optional LLM call)
                                                    │
                                                    ▼
                                               URLResult ──► cached to disk
                                                    │
                                                    ▼
                                            URL chip updates to ✅
                                            Content available as context
```

## URL Detection

### Client Side

`UrlService.detectUrlsInInput(text)` is called on every input change (from `InputHandlerMixin.handleInput` and `handleSpeechTranscript`). It debounces at 300ms, then calls the server.

### Server Side

`URLDetector` (`ac/url_handler/detector.py`) finds and classifies URLs:

- **Pattern** — Matches `https?://` followed by non-whitespace, non-bracket characters. Trailing punctuation (`,.:;!?`) is excluded from the match.
- **Deduplication** — Duplicate URLs in the same text are filtered out.

Each URL is classified into a type:

| URLType | Description | Detection |
|---------|-------------|-----------|
| `GITHUB_REPO` | Repository root | `github.com/{owner}/{repo}` with no further path |
| `GITHUB_FILE` | Single file | `github.com/{owner}/{repo}/blob/{branch}/{path}` |
| `GITHUB_ISSUE` | Issue page | `github.com/{owner}/{repo}/issues/{number}` |
| `GITHUB_PR` | Pull request | `github.com/{owner}/{repo}/pull/{number}` |
| `DOCUMENTATION` | Docs site | Known domains or `/docs/`, `/documentation/`, `/api/`, `/reference/` in path |
| `GENERIC_WEB` | Any other webpage | Valid `http(s)` URL |
| `UNKNOWN` | Unrecognized | Fallback |

GitHub patterns also extract `GitHubInfo` with `owner`, `repo`, `branch`, `path`, `issue_number`, and `pr_number` fields. Raw githubusercontent.com URLs are also recognized.

Known documentation domains include `docs.python.org`, `developer.mozilla.org`, `readthedocs.io` subdomains, and others (see `DOC_DOMAINS` set).

## URL Fetching

### Orchestrator (`URLFetcher`)

`URLFetcher` (`ac/url_handler/fetcher.py`) is the main entry point, instantiated lazily by `LiteLLM._get_url_fetcher()`. It coordinates cache, handlers, and summarization.

**`fetch(url, use_cache, summarize, summary_type, context)`** flow:

1. **Cache check** — If `use_cache` is true, look up the URL in `URLCache`. On hit:
   - If the cached entry already has a summary, return it immediately.
   - If `summarize` is requested but no cached summary exists, generate one, update the cache entry, and return.
   - Otherwise return the cached content as-is.
2. **Type detection** — Call `URLDetector.detect_type(url)` to classify.
3. **Handler dispatch** — Route to the appropriate handler based on type.
4. **Cache write** — If the fetch succeeded and `use_cache` is true, store the result.
5. **Summarization** — If `summarize` is true and no error, generate a summary and store it in the cache entry.

**`detect_and_fetch(text, ...)`** — Convenience method that detects all URLs in text and fetches them all sequentially.

### GitHub Handler

`GitHubHandler` (`ac/url_handler/github_handler.py`) handles GitHub-specific URLs.

#### Repository Fetch (`fetch_repo`)

1. Creates a temporary directory.
2. Performs a **shallow clone** (`git clone --depth 1`) with a 2-minute timeout.
3. Searches for a README file (tries `README.md`, `README.rst`, `README.txt`, `README`, and case variants in priority order).
4. Generates a **symbol map** using `SymbolIndex`:
   - Finds all files with supported extensions (`.py`, `.js`, `.ts`, `.cpp`, etc.), excluding hidden directories and `node_modules`.
   - Indexes them and produces compact format with references.
5. Returns `URLContent` with `readme` and `symbol_map` fields.
6. Cleans up the temp directory in a `finally` block.

#### File Fetch (`fetch_file`)

1. Constructs a raw GitHub URL: `https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}`.
2. Fetches via `urllib.request.urlopen` with a 30-second timeout.
3. If the branch is `main` and returns 404, retries with `master`.
4. Returns `URLContent` with `content` and `title` (filename).

#### Issues and PRs

Currently fetched as generic web pages via `WebHandler.fetch_page()`. A TODO exists to use the GitHub API for richer structured data.

### Web Handler

`WebHandler` (`ac/url_handler/web_handler.py`) handles generic web pages and documentation sites.

#### Content Extraction

1. Fetches raw HTML via `urllib.request` with a custom user agent and 30-second timeout.
2. Detects charset from HTTP headers, defaulting to UTF-8.
3. Extracts content using **trafilatura** (primary):
   - Removes comments, images, links.
   - Includes tables.
   - Outputs plain text.
   - Extracts metadata (title, description, author, date).
4. Falls back to **basic HTML parsing** if trafilatura is not installed or fails:
   - Strips `<script>` and `<style>` blocks.
   - Removes all HTML tags.
   - Extracts `<title>` and `<meta name="description">` for metadata.
   - Cleans up whitespace and decodes HTML entities.

Documentation URLs use the same extraction but are tagged as `URLType.DOCUMENTATION`.

## Summarization

`Summarizer` (`ac/url_handler/summarizer.py`) generates LLM summaries of fetched content using a fast/cheap model (default: `claude-3-5-haiku-latest`).

### Summary Types

| SummaryType | Focus | Use Case |
|-------------|-------|----------|
| `BRIEF` | 2–3 paragraph overview: what, why, who | Default |
| `USAGE` | Installation, patterns, key imports | Quick-start guide |
| `API` | Classes, functions, signatures | Reference |
| `ARCHITECTURE` | Modules, design patterns, data flow | Understanding structure |
| `EVALUATION` | Maturity, dependencies, alternatives | Decision-making |

### Summary Generation

1. Assembles content from `URLContent` fields: title, description, readme, symbol map, and page content.
2. Truncates to 100,000 characters if needed.
3. Selects the appropriate type-specific prompt from `SUMMARY_PROMPTS`.
4. Calls `litellm.completion()` with a system prompt establishing the summarizer as a technical documentation expert.

### Automatic Type Selection (`summarize_for_context`)

When no explicit summary type is given, the summarizer auto-selects based on:

| URL Type | Has Symbol Map? | Summary Type |
|----------|----------------|--------------|
| GitHub repo | Yes | `ARCHITECTURE` |
| GitHub repo | No | `BRIEF` |
| GitHub file | — | `BRIEF` |
| Documentation | — | `USAGE` |
| Other | — | `BRIEF` |

If the user's question contains keywords, the type is overridden:

| Keywords | Override |
|----------|---------|
| "how to", "usage", "example", "install" | `USAGE` |
| "api", "function", "method", "class" | `API` |
| "architecture", "design", "structure" | `ARCHITECTURE` |
| "evaluate", "compare", "should i use", "alternative" | `EVALUATION` |

## Caching

`URLCache` (`ac/url_handler/cache.py`) provides filesystem-based caching with TTL invalidation.

### Storage

- **Location** — Configured via `url_cache.path` in `config/app.json` (default: `/tmp/ac-dc1`).
- **Key** — First 16 characters of SHA-256 hash of the URL.
- **Format** — JSON files containing serialized `URLContent` (including any generated summary).
- **TTL** — Configured via `url_cache.ttl_hours` (default: 24 hours). Checked against `fetched_at` timestamp on read.

### Operations

| Method | Behavior |
|--------|----------|
| `get(url)` | Returns `URLContent` if cached and not expired. Deletes expired/corrupt entries. |
| `set(url, content)` | Writes JSON to cache dir. Sets `fetched_at` if not already set. Creates dir if needed. |
| `invalidate(url)` | Deletes single cache entry. Returns true if found. |
| `clear()` | Deletes all `.json` files in cache dir. Returns count. |
| `cleanup_expired()` | Scans all entries, deletes expired or corrupt ones. Returns count removed. |

Summaries are cached as part of the `URLContent` entry. When a cached entry lacks a summary but one is requested, the summary is generated and the cache entry is updated in-place.

### Configuration

```json
{
  "url_cache": {
    "path": "/tmp/ac-dc1",
    "ttl_hours": 24
  }
}
```

Loaded by `URLConfig.load()` which reads from `config/app.json` via the app config loader.

## Client-Side State Management (`UrlService`)

`UrlService` (`webapp/src/services/UrlService.js`) manages all URL-related state on the client. It is instantiated by `PromptView._initUrlService()` and communicates state changes to the component via a callback.

### State

| Property | Type | Description |
|----------|------|-------------|
| `_detectedUrls` | `Array` | URLs found in current input, not yet fetched |
| `_fetchingUrls` | `Object` | Map of URL → `true` for in-flight fetches |
| `_fetchedUrls` | `Object` | Map of URL → result for completed fetches |
| `_excludedUrls` | `Set` | URLs excluded from context by the user |

### Lifecycle

1. **Detection** — As the user types, `detectUrlsInInput()` debounces at 300ms then calls `LiteLLM.detect_urls`. Results are filtered to exclude already-fetched URLs.
2. **Fetch** — When the user clicks 📥 on a detected URL chip, `fetchUrl(urlInfo)` calls `LiteLLM.fetch_url` with `use_cache=true` and `summarize=true`. On completion, the URL moves from `_detectedUrls` to `_fetchedUrls`.
3. **Inclusion** — `toggleUrlIncluded(url)` moves URLs in/out of `_excludedUrls`. Excluded URLs remain visible but are not sent as context.
4. **Removal** — `removeFetchedUrl(url)` removes a URL from `_fetchedUrls` entirely. Also cleans up from `_excludedUrls`. Re-detection is triggered so the URL may reappear as detected.
5. **Dismissal** — `dismissUrl(url)` removes a detected (unfetched) URL from the chips.
6. **Send** — `clearState()` clears `_detectedUrls` and `_fetchingUrls` but preserves `_fetchedUrls` (they persist as context across messages, like selected files).
7. **Clear conversation** — `clearAllState()` resets everything including fetched URLs.

### Message Integration

#### Client Side

When a message is sent (`ChatActionsMixin.sendMessage`):

1. `getFetchedUrlsForMessage()` returns all fetched URLs that are not excluded and have no errors.
2. The fetched URL list is passed to the server along with the user prompt.
3. After sending, `clearState()` removes detected URLs but keeps fetched URLs for future messages.

#### Server Side (Streaming)

During `_stream_chat`, URLs detected in the user prompt are fetched server-side (up to **3 URLs per message**). The content is injected as a **separate user/assistant message pair** in the active (uncached) section of the prompt — not appended to the user's message:

```
User: # URL Context\n\nThe following content was fetched from URLs...\n\n---\n[formatted content]
Assistant: Ok, I've reviewed the URL content.
```

Each URL's content is formatted via `URLContent.format_for_prompt()`, which prefers summary → readme → content, truncates at 4000 chars, and appends the symbol map in a code block if present.

## URL Chips UI

`renderUrlChips()` (`webapp/src/prompt/UrlChipsTemplate.js`) renders URL state as interactive chips below the chat messages and above the input area. Chips only appear when there are detected, fetching, or fetched URLs.

### Fetched URL Chips

Displayed in a `fetched` row. Each chip shows:

- **Checkbox** — Toggle inclusion/exclusion from context. Not shown for errored fetches.
- **Label** — Title or display name (clickable to view content in a modal).
- **Remove button** (×) — Remove from fetched URLs entirely.
- **Status class** — `success` (included), `excluded` (unchecked), or `error` (fetch failed with ❌ icon).

### Detected URL Chips

Displayed in a `detected` row. Each chip shows:

- **Type badge** — Emoji + label (e.g. "📦 GitHub Repo", "🌐 Web").
- **Display name** — Short form of URL. For GitHub: `owner/repo` or `owner/repo/filename`. For web: `hostname/path` (truncated).
- **Fetch button** (📥) — Triggers fetch. Replaced by ⏳ while fetching.
- **Dismiss button** (×) — Remove from detected list.

### Display Name Logic (`getUrlDisplayName`)

- GitHub URLs with path: `{owner}/{repo}/{filename}`
- GitHub URLs without path: `{owner}/{repo}`
- Web URLs: `{hostname}{path}`, or `{hostname}/.../lastSegment` if path has >2 segments
- Fallback: First 40 characters of URL

## Context Viewer Integration

Fetched URLs appear in both the Context Viewer and Cache Viewer tabs as context items with token counts. The `ViewerDataMixin` provides shared URL management:

- `getIncludedUrls()` — Returns fetched URLs filtered by exclusion set.
- `toggleUrlIncluded(url)` — Toggles exclusion and dispatches `url-inclusion-changed` event. Triggers a breakdown refresh.
- `removeUrl(url)` — Dispatches `remove-url` event (handled by `AppShell`).
- `viewUrl(url)` — Fetches full content via `LiteLLM.get_url_content` and displays in a modal.

The `refreshBreakdown()` call passes included URLs to `LiteLLM.get_context_breakdown()`, which accounts for URL content tokens in the budget calculation.

## Data Models

### `URLContent`

The core data object for fetched content:

| Field | Type | Description |
|-------|------|-------------|
| `url` | `str` | Original URL |
| `url_type` | `URLType` | Classification enum |
| `title` | `str?` | Page/file title |
| `description` | `str?` | Meta description |
| `content` | `str?` | Extracted page content |
| `symbol_map` | `str?` | Generated symbol map (GitHub repos) |
| `readme` | `str?` | README content (GitHub repos) |
| `github_info` | `GitHubInfo?` | Parsed GitHub metadata |
| `fetched_at` | `datetime?` | When content was fetched |
| `error` | `str?` | Error message if fetch failed |
| `summary` | `str?` | LLM-generated summary |
| `summary_type` | `str?` | Summary type used |

**`format_for_prompt(summary, max_content_length)`** — Formats for LLM context inclusion. Priority: summary → readme → content. Truncates at `max_content_length` (default 4000). Appends symbol map in a code block if present.

### `URLResult`

Wraps `URLContent` with fetch metadata:

| Field | Type | Description |
|-------|------|-------------|
| `content` | `URLContent` | The fetched content |
| `summary` | `str?` | Generated summary |
| `summary_type` | `SummaryType?` | Type of summary |
| `cached` | `bool` | Whether result came from cache |

### `GitHubInfo`

| Field | Type | Description |
|-------|------|-------------|
| `owner` | `str` | Repository owner |
| `repo` | `str` | Repository name |
| `branch` | `str?` | Branch name |
| `path` | `str?` | File/directory path |
| `issue_number` | `int?` | Issue number |
| `pr_number` | `int?` | PR number |

Properties: `repo_url` (base URL), `clone_url` (`.git` URL).

## Server RPC Methods

| Method | Description |
|--------|-------------|
| `LiteLLM.detect_urls(text)` | Find and classify URLs in text |
| `LiteLLM.fetch_url(url, use_cache, summarize, summary_type, context)` | Fetch, cache, and optionally summarize a URL |
| `LiteLLM.fetch_urls_from_text(text, use_cache, summarize)` | Detect and fetch all URLs in text |
| `LiteLLM.invalidate_url_cache(url)` | Remove a URL from cache |
| `LiteLLM.clear_url_cache()` | Clear entire URL cache |
| `LiteLLM.get_url_content(url)` | Get cached content with token counts for display in modal. Returns: `url`, `title`, `type`, `content`, `readme`, `symbol_map`, `description`, `content_tokens`, `readme_tokens`, `fetched_at`, `error`. |
