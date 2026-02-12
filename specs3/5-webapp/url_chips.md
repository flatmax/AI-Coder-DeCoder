# URL Chips

## Overview

Interactive chips below the chat input showing detected and fetched URLs. Backend URL handling is in [URL Handling](../4-features/url_handling.md).

## State Categories

| State | Description |
|-------|-------------|
| Detected | Found in input, not yet fetched |
| Fetching | In-flight fetch request |
| Fetched | Completed with result |
| Excluded | User-excluded from context |

### Lifecycle

1. **Detection** — debounced as user types, excludes already-fetched
2. **Fetch** — on user click, with cache and summarization
3. **Toggle** — excluded URLs visible but not sent as context
4. **Removal** — removes from fetched; may reappear as detected
5. **Dismissal** — removes unfetched from chips
6. **On send** — clears detected/fetching, preserves fetched
7. **On clear** — resets everything

## Detected Chips

- Type badge (emoji + label)
- Short display name
- Fetch button (📥) → spinner while fetching
- Dismiss button (×)

## Fetched Chips

- Checkbox for include/exclude
- Clickable label to view content
- Remove button
- Status: success, excluded, error

## Display Name

- GitHub with path: `{owner}/{repo}/{filename}`
- GitHub without path: `{owner}/{repo}`
- Web: `{hostname}/{path}` (truncated)

## Message Integration

On send: get fetched URLs not excluded and not errored. Append formatted content to LLM message (not shown in UI).