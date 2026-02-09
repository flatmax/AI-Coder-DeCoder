# Context Tab Spec

The Context tab (`TABS.CONTEXT`) shows the token budget breakdown — how many tokens are allocated to each category and how close the prompt is to the model's input limit. The UI component is `<context-viewer>` and the backend is `LiteLLM.get_context_breakdown`.

## Lazy Loading

Imported on first visit:
```
await import('./context-viewer/ContextViewer.js')
```
Switching to the tab triggers `_refreshViewer('context-viewer')`, which calls `refreshBreakdown()` and syncs the history bar.

## Component: `<context-viewer>`

Extends `ViewerDataMixin(RpcMixin(LitElement))`. The `ViewerDataMixin` provides shared data-fetching, URL modal, and symbol map modal logic (shared with `CacheViewer`).

### Data fetching

`refreshBreakdown()` (from `ViewerDataMixin`):
1. Calls `LiteLLM.get_context_breakdown(selectedFiles, includedUrls)` via `_rpcWithState`
2. Automatically manages `isLoading` and `error` states
3. Deduplicates concurrent requests — only one in-flight at a time
4. Auto-refreshes when `selectedFiles`, `fetchedUrls`, or `excludedUrls` change while visible
5. Marks data stale when properties change while hidden; refreshes on next tab switch

### Budget section

A horizontal bar showing total usage:

```
Token Budget: 45.2K / 200.0K
[████████████░░░░░░░░░] 23% used
```

Bar color changes: green (normal), orange (> 75%), red (> 90%).

### Category breakdown

Five category rows, each showing label, token count, and proportional bar:

| Category | Expandable | Shows |
|---|---|---|
| System Prompt | No | Fixed token count |
| Symbol Map | Yes (if files exist) | Cache chunks with file lists, chunk cached/volatile status |
| Files | Yes | Per-file token counts for selected files |
| URLs | Yes (if fetched URLs exist) | Per-URL token counts with include/exclude checkboxes |
| History | Yes (if over budget) | Tier distribution, budget warning |

### URL management

When expanded, the URLs section shows all fetched URLs (not just those in the breakdown):

- **Checkbox** — Toggle URL inclusion/exclusion from context
- **View button** — Opens URL content in a modal (`<url-content-modal>`)
- **✕ button** — Removes the URL entirely (dispatches `remove-url` event)

Toggling inclusion dispatches `url-inclusion-changed` which propagates to `PromptView` to update `excludedUrls`.

### Symbol map viewer

A "View Symbol Map" button opens `<symbol-map-modal>`, which fetches the full map via `LiteLLM.get_context_map(null, true)` and displays it in a scrollable modal.

### Session totals

Below the breakdown, cumulative session statistics are shown:
- Tokens In / Tokens Out / Total
- Cache Reads / Cache Writes (if applicable)

### Footer

Displays the current model name and a manual "↻ Refresh" button.

## Backend: `LiteLLM.get_context_breakdown`

```pseudo
get_context_breakdown(file_paths, fetched_urls) -> dict
```

Assembles the full prompt structure and counts tokens for each component:

1. Builds the system prompt via `build_system_prompt()`
2. Gets symbol map data (files, references, tiers)
3. Initializes stability tracker from references if not yet initialized
4. Counts tokens for each tier block (L0–L3 + active)
5. Counts file tokens, URL tokens, history tokens
6. Returns a dict with `used_tokens`, `max_input_tokens`, `breakdown` (per-category), `blocks` (per-tier), `session_totals`, `model`, `promotions`, `demotions`

The same endpoint serves both the Context tab (which uses `breakdown`) and the Cache tab (which uses `blocks`).
