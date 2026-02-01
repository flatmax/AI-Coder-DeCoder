# Plan: Prompt Snippets with Resizable Panel

## Status: ✅ COMPLETE

## Overview

Add a prompt snippets feature that allows users to configure reusable prompt messages via a JSON config file. Snippets appear as a collapsible drawer that expands horizontally to reveal icon buttons. Also add a vertical resizer between the left panel (file picker) and right panel (chat) with collapse/expand functionality.

## Implemented

### 1. Prompt Snippets Config (`prompt-snippets.json` in repo root)
```json
{
  "snippets": [
    {
      "icon": "✅",
      "tooltip": "Confirm tests are testing what was intended",
      "message": "All tests passed, can you confirm the tests are testing what you intended to test?"
    },
    {
      "icon": "📦",
      "tooltip": "Check if ready to commit and update plan",
      "message": "Great! Does the code look good for committing (I can generate the commit messages)? Can you update the plan first? What will be next?"
    }
  ]
}
```

### 2. Snippet Drawer (collapsible horizontal expansion)
- 📋 toggle button that expands horizontally to reveal snippet icons
- Compact icon-only buttons inside the drawer
- Tooltip shows full description on hover
- Click appends message to textarea (for editing before send)
- Drawer auto-closes after selecting a snippet
- Loaded from config file via `LiteLLM.get_prompt_snippets()` RPC

### 3. Vertical Resizer between left and right panels
- Draggable to adjust panel widths (150px - 500px range)
- Collapse/expand button (◀/▶ chevron) to fully hide left panel
- Width and collapsed state persisted to localStorage

## Files Changed

| File | Change |
|------|--------|
| `ac/llm/llm.py` | Added `get_prompt_snippets()` method |
| `webapp/src/PromptView.js` | Added `promptSnippets`, `snippetDrawerOpen`, `leftPanelWidth`, `leftPanelCollapsed` properties; `loadPromptSnippets()`, `toggleSnippetDrawer()`, `appendSnippet()`, panel resize handlers |
| `webapp/src/prompt/PromptViewTemplate.js` | Added `renderSnippetButtons()` with collapsible drawer, `renderPanelResizer()` |
| `webapp/src/prompt/PromptViewStyles.js` | Added `.snippet-drawer`, `.snippet-drawer-toggle`, `.snippet-drawer-content`, `.snippet-btn`, `.panel-resizer` styles |
| `prompt-snippets.json` | New file with default snippets |

## UI Result

### Input Area (collapsible snippet drawer):
```
[📋]──[✅][📦]  [textarea...........................] [🎤] [Send]
  ↑      ↑
toggle  expands horizontally when clicked
```

### Resizer between panels:
```
┌────────────────────┬─┬──────────────────────────┐
│                    │ │                          │
│   File Picker      │◀│   Chat Panel             │
│                    │ │                          │
└────────────────────┴─┴──────────────────────────┘
                     ↑
              drag to resize, click ◀ to collapse
```

## Future Enhancements (out of scope)

- UI to add/edit snippets (currently requires editing JSON)
- Keyboard shortcuts for snippets (e.g., Ctrl+1, Ctrl+2)
- Snippet categories/folders
- Snippet variables/placeholders
