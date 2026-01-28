# Plan: Context Visualization UI

## Overview

Create a context visualization UI as a new tab (alongside Files/Search) that shows users exactly what's being sent to the LLM, with token breakdowns and URL content viewing.

## Goals

1. **Token transparency**: Show token breakdown by category (system, symbol map, files, URLs, history)
2. **URL content viewer**: Read/review scraped content and summaries
3. **Context inspector**: Visual breakdown of what's in the prompt
4. **Budget awareness**: Help users understand token usage

## Current State

- HUD exists in `ContextManager.print_hud()` but is terminal-only
- URL fetching works but content is invisible to user
- Token counting exists but isn't exposed in webapp
- No way to see URL summaries before sending

## Design

### New Tab: "Context"
Add as third tab alongside Files and Search:
```
[Files] [Search] [Context]
```

### Context Tab Layout
```
┌─────────────────────────────────────┐
│ Token Budget          170k / 200k   │
│ ████████████████░░░░░░░░░░░░  85%   │
├─────────────────────────────────────┤
│ Category Breakdown                  │
│                                     │
│ System Prompt          12,450  ████ │
│ Symbol Map              8,230  ███  │
│ Files (3)              45,120  █████│
│ URLs (2)               15,340  ████ │
│ History (12 msgs)      89,100  █████│
├─────────────────────────────────────┤
│ ▼ Files                             │
│   src/app.py           22,100       │
│   src/utils.py         18,020       │
│   README.md             5,000       │
│                                     │
│ ▼ URLs                              │
│   github.com/flatmax/jrpc-oo        │
│   [8,200 tokens]       [View] [✕]   │
│                                     │
│   docs.python.org/3/library/...     │
│   [7,140 tokens]       [View] [✕]   │
└─────────────────────────────────────┘
```

### URL Content Modal
Click "View" to see:
```
┌─────────────────────────────────────┐
│ URL Content                    [✕]  │
├─────────────────────────────────────┤
│ github.com/flatmax/jrpc-oo          │
│ Type: GitHub Repository             │
│ Fetched: 2 minutes ago              │
│ Tokens: 8,200                       │
├─────────────────────────────────────┤
│ Summary:                            │
│ ┌─────────────────────────────────┐ │
│ │ jrpc-oo is a cross-platform     │ │
│ │ JSON-RPC 2.0 framework with     │ │
│ │ bidirectional WebSocket...      │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [Show Full Content] [Re-summarize]  │
└─────────────────────────────────────┘
```

## Architecture

### Backend Additions

**New RPC method: `get_context_breakdown()`**
```python
def get_context_breakdown(self, file_paths, fetched_urls):
    return {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 200000,
        "used_tokens": 170240,
        "breakdown": {
            "system": {"tokens": 12450, "label": "System Prompt"},
            "symbol_map": {"tokens": 8230, "label": "Symbol Map"},
            "files": {
                "tokens": 45120,
                "items": [
                    {"path": "src/app.py", "tokens": 22100},
                    {"path": "src/utils.py", "tokens": 18020},
                ]
            },
            "urls": {
                "tokens": 15340,
                "items": [
                    {
                        "url": "https://github.com/flatmax/jrpc-oo",
                        "tokens": 8200,
                        "title": "flatmax/jrpc-oo",
                        "type": "github_repo",
                        "fetched_at": "2024-01-15T10:30:00Z"
                    }
                ]
            },
            "history": {"tokens": 89100, "message_count": 12}
        }
    }
```

**New RPC method: `get_url_content(url)`**
```python
def get_url_content(self, url):
    # Returns cached URL content for viewing
    return {
        "url": url,
        "content": "...",  # Full or summarized content
        "summary": "...",  # If summarized
        "metadata": {...},
        "tokens": 8200,
        "fetched_at": "2024-01-15T10:30:00Z"
    }
```

### Frontend Components

1. **`context-viewer.js`** - Main tab component
2. **`context-viewer/ContextViewerStyles.js`** - Styles
3. **`context-viewer/ContextViewerTemplate.js`** - Template
4. **`url-content-modal.js`** - Modal for viewing URL content

### Integration Points

- `AppShell.js` - Add Context tab
- `PromptView.js` - Share fetched URLs state with Context tab
- Existing `TokenCounter` class for counting

## Phased Implementation

### Phase 1: Backend API
- [ ] Add `get_context_breakdown()` to LiteLLM
- [ ] Add `get_url_content()` to LiteLLM
- [ ] Expose via RPC in dc.py

### Phase 2: Context Tab (Basic)
- [ ] Create `context-viewer.js` component
- [ ] Add tab to AppShell
- [ ] Show token budget bar
- [ ] Show category breakdown

### Phase 3: Detailed Breakdown
- [ ] Expandable sections for Files/URLs
- [ ] Per-item token counts
- [ ] Remove URL from context (✕ button)

### Phase 4: URL Content Modal
- [ ] Create modal component
- [ ] Show summary content
- [ ] "Show Full Content" toggle
- [ ] Re-summarize button (optional, lower priority)

## Out of Scope (Future)

- Real-time token updates while typing
- History trimming/summarization (requires small_model integration)
- Symbol map toggle
- Token cost estimation ($)
- Context templates/presets

## Files to Create

```
webapp/src/context-viewer/
├── ContextViewer.js
├── ContextViewerStyles.js
├── ContextViewerTemplate.js
└── UrlContentModal.js
webapp/context-viewer.js  (entry point)
```

## Files to Modify

- `webapp/src/app-shell/AppShell.js` - Add Context tab
- `ac/llm/llm.py` - Add get_context_breakdown(), get_url_content()
- `ac/dc.py` - Expose new RPC methods
