# URL Content

The system detects URLs in user input, fetches and extracts content, optionally summarizes via a smaller LLM, caches results to disk, and makes content available as conversation context. A url-chips UI component surfaces detection, fetch state, and inclusion toggles.

## URL Detection

- Match HTTP/HTTPS URLs in text, excluding trailing punctuation
- Deduplicate within the same text
- Classification into categories — GitHub repo, GitHub file, GitHub issue, GitHub PR, documentation, generic
- Raw GitHub content URLs recognized as GitHub file references

## Classification Rules

- GitHub repo — `github.com/{owner}/{repo}` with no further path (also matches `.git` suffix and trailing slash)
- GitHub file — `github.com/{owner}/{repo}/blob/{branch}/{path}` or `raw.githubusercontent.com` patterns
- GitHub issue — `github.com/{owner}/{repo}/issues/{N}`
- GitHub PR — `github.com/{owner}/{repo}/pull/{N}`
- Documentation — known doc domains (docs.python.org, MDN, ReadTheDocs) or paths containing `/docs/`, `/documentation/`, `/api/`, `/reference/`
- Generic — fallback for any other HTTP(S) URL

## Display Names

- GitHub repo — `owner/repo`
- GitHub file — `owner/repo/filename` (last path component)
- GitHub issue — `owner/repo#N`
- GitHub PR — `owner/repo!N`
- Generic/documentation — `hostname/path`, truncated with ellipsis beyond a length threshold
- Raw GitHub URLs fall through to generic formatting (hostname-based)

## Fetch Orchestration

Pipeline for each URL:

1. **Cache check** — if cache lookup enabled, check filesystem cache; on hit, return immediately unless summary is requested and missing (in which case generate summary and update cache entry in-place)
2. **Type detection** — classify if not already
3. **Handler dispatch** — route to the appropriate fetcher based on type
4. **Cache write** — on success, store the result (error results are not cached)
5. **Summarization** — if requested and fetch succeeded, generate summary and update cache entry

### Per-Message Limit

- Up to a small number of URLs per message are detected and fetched during streaming
- Prevents unbounded fetching from URL-heavy messages

### Convenience Method

- A detect-and-fetch method combines detection and sequential fetching into a single call
- Optional max-URLs parameter

## Fetcher: GitHub Repository

- Shallow clone to temp directory with a subprocess timeout
- Search for README via two-pass approach — exact match from priority list, then case-insensitive fallback
- Generate symbol map from cloned repo if symbol index class was provided at service construction time
- Return URL content with readme, symbol map, title (`owner/repo`) fields
- Clean up temp directory in a finally block

## Fetcher: GitHub File

- Construct raw content URL from owner, repo, branch, path
- Default branch to main if not specified; retry with master on failure (only when original branch was main)
- Fetch via HTTP with a timeout, UTF-8 decode
- Return URL content with content field and title set to filename

## Fetcher: GitHub Issues and PRs

- Currently fetched as generic web pages
- Future enhancement — use GitHub API for structured data (labels, comments, status)

## Fetcher: Web Page

- Fetch HTML with a browser-like User-Agent and a timeout
- Decode response body as UTF-8 with latin-1 fallback
- Extract title via regex (always, before main content extraction)
- Primary extraction via content extraction library (strips navigation, ads, boilerplate)
- Fallback extraction — strip script/style blocks, strip all tags, decode HTML entities, collapse whitespace

## Summarization

A smaller/cheaper LLM generates summaries using dedicated prompt types:

| Type | Focus |
|---|---|
| BRIEF | 2–3 paragraph overview |
| USAGE | Installation, patterns, key imports |
| API | Classes, functions, signatures |
| ARCHITECTURE | Modules, design, data flow |
| EVALUATION | Maturity, dependencies, alternatives |

### Content Assembly for Summarizer

- Type-specific focus prompt
- Header identifying the source URL
- Body text — readme field preferred, then content field
- Body truncated to a character limit with an ellipsis suffix if exceeded
- Symbol map appended under a header if present
- System message is fixed; summarizer uses non-streaming completion

### Auto-Selection

- GitHub repo with symbol map → ARCHITECTURE
- GitHub repo without symbol map → BRIEF
- GitHub file → BRIEF
- Documentation → USAGE
- Generic → BRIEF
- User text keywords can override — "how to" → USAGE, "api" → API, "architecture" → ARCHITECTURE, "compare"/"evaluate" → EVALUATION

## Caching

- Location — configurable directory, default under system temp directory
- Key — hash prefix of the URL string (deterministic, fixed length)
- Format — JSON file per entry containing serialized URL content plus cache timestamp
- TTL — configurable in hours (default one day), computed as seconds for comparison

### Cache Operations

- Get — return dict if cached and within TTL; delete corrupt entries; return null for miss/expired
- Set — add cache timestamp, set fetched-at timestamp if missing or null, write as JSON
- Invalidate — delete single cache file, return found/not-found flag
- Clear — delete all cached JSON files, return count
- Cleanup expired — scan all files, delete expired or corrupt, return count

## Data Model

### URL Content

- URL string
- URL type (string)
- Title, description, content (all optional)
- Symbol map, readme (optional)
- GitHub info struct (optional)
- Fetched-at timestamp (ISO 8601 UTC string)
- Error string (optional, populated when fetch fails)
- Summary and summary type (optional, populated when summarized)

### Formatting for Prompt

- URL header
- Title if present
- Body priority — summary → readme → content
- Truncation at a configurable max length with ellipsis suffix
- Symbol map appended under its own header if present
- Parts joined with blank-line separators

### Serialization

- Dict conversion for RPC and cache storage
- From-dict construction strips internal cache fields before reconstructing

## URL Service

Manages lifecycle of URL content:

- Filesystem cache reference
- Smaller model name for summarization
- Symbol index class reference (for GitHub repo symbol map generation)
- In-memory fetched dict (keyed by URL)

### Service Methods

| Method | Description |
|---|---|
| Detect URLs | Find and classify URLs in text (sync) |
| Fetch URL | Fetch, cache, optionally summarize (async) |
| Detect and fetch | Detect all URLs in text, fetch sequentially (async) |
| Get URL content | Return content for display; check in-memory first, then filesystem cache; return sentinel error when not yet fetched |
| Invalidate URL cache | Remove from both filesystem cache and in-memory fetched dict |
| Clear URL cache | Clear all cached and fetched URLs |
| Get fetched URLs | List all fetched content objects |
| Remove fetched | Remove from in-memory dict only; filesystem cache preserved |
| Clear fetched | Clear in-memory dict only; filesystem cache preserved |
| Format URL context | Format fetched URLs for prompt injection; exclude specified URLs and error results |

### Sentinel Error

- A specific error string signals "URL not yet fetched"
- Used by streaming handler to determine whether a URL needs fetching

## URL Chips UI

Interactive chips below the chat input showing detected and fetched URLs.

### State Categories

- Detected — found in input, not yet fetched
- Fetching — in-flight fetch request
- Fetched — completed with result
- Excluded — user-excluded from context

### Lifecycle

- Detection — debounced as user types, excludes already-fetched
- Fetch — on user click, with cache and summarization
- Toggle — excluded URLs visible but not sent as context
- Removal — removes from fetched; may reappear as detected
- Dismissal — removes unfetched from chips
- On send — clears detected/fetching, preserves fetched
- On clear — resets everything

### Detected Chips

- Type badge (emoji + label)
- Short display name
- Fetch button with spinner while fetching
- Dismiss button

### Fetched Chips

- Checkbox for include/exclude
- Clickable label to view content
- Remove button
- Status — success, excluded, error

### Content Viewing

- Clicking a fetched URL chip label dispatches an event
- Chat panel fetches full content and shows it in a dedicated dialog

## Message Integration

- On send, fetched URLs not excluded and not errored are appended to the LLM message
- URL content is not shown in the chat UI — it lives only in the prompt

## Fetch Notifications During Streaming

- Progress communicated via the same event channel used for other progress events
- Fetch-start — transient toast with display name
- Fetch-ready — success toast
- Already-fetched URLs skipped without notification

## Invariants

- Error results are never cached to filesystem
- A URL appearing as fetched is always fully populated (or has an error field)
- The sentinel "URL not yet fetched" error string is never stored in cache
- Excluded URLs never appear in the LLM prompt
- Already-fetched URLs are never re-fetched within a session unless cache is invalidated
- Summary generation on a cached entry updates the cache in-place without re-fetching source content