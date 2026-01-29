# Unified Header Layout Plan

## Goal
Create consistent headers across Chat, Search, and Context views with:
- Icon + Title on the left (💬 Chat, 🔍 Search, 📊 Context)
- Tab switcher buttons (📁 🔍 📊) in the same location across all views
- Commit/action buttons on the right (Chat view only)
- Same dialog sizing and spacing across all views

## Current State Analysis

### AppShell.js
- Has a global header bar at the **top of the page** with tabs (📁 Files, 🔍 Search, 📊 Context)
- Renders `PromptView`, `FindInFiles`, `ContextViewer` in `prompt-overlay` div
- Shows/hides views via `style="display: none"`
- Manages `activeLeftTab` state

### PromptView
- Has its own `.dialog` wrapper with header, drag, resize capabilities
- Header shows "💬 Chat" + action buttons (Commit, Reset, History, Tokens, Clear)
- Has `picker-panel` for file picker and `chat-panel` for messages
- Sizing: `width: 400px` (or `700px` with picker)

### FindInFiles & ContextViewer  
- **No dialog wrapper** - just bare content
- No header of their own
- Sizing: `height: 100%`, `width: 100%` - fill their container
- Rely on parent for sizing

## Target Layout
```
┌─────────────────────────────────────────────────────────────────┐
│ 💬 Chat    [📁][🔍][📊]              [💾][⚠️][📜][📊][🗑️] [▼] │
├─────────────────────────────────────────────────────────────────┤
│ (content area - file picker + chat, or search, or context)     │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture Decision

**Option A: Duplicate header in each component** ❌
- Would require header code in PromptView, FindInFiles, ContextViewer
- Hard to keep synchronized
- Sizing issues between components

**Option B: Wrap all views in shared dialog in AppShell** ❌  
- Major refactor of AppShell
- Would break PromptView's drag/resize functionality
- Complex state management

**Option C: Embed FindInFiles/ContextViewer inside PromptView** ✅
- PromptView already has the dialog structure
- Add `activeLeftTab` prop to PromptView
- Render FindInFiles/ContextViewer as content inside PromptView
- Unified header naturally works
- Tab switching handled by PromptView or passed from AppShell

## Implementation Plan (Option C)

### Step 1: Update AppShell.js
- Remove the header tabs from global header (or keep for navigation, emit events)
- Pass `activeLeftTab` to PromptView as a property
- Remove direct rendering of FindInFiles/ContextViewer in prompt-overlay
- Keep event handlers but wire them through PromptView

### Step 2: Update PromptView.js
- Add `activeLeftTab` property (default: 'files')
- Add `switchTab(tab)` method that emits event to AppShell
- Import and render FindInFiles and ContextViewer components

### Step 3: Update PromptViewTemplate.js
- Update header-left to show dynamic icon + title based on `activeLeftTab`
- Add tab switcher buttons to header-center
- Conditionally show action buttons based on active tab
- Replace `main-content` to conditionally render:
  - `activeLeftTab === 'files'`: current picker-panel + chat-panel
  - `activeLeftTab === 'search'`: FindInFiles component
  - `activeLeftTab === 'context'`: ContextViewer component

### Step 4: Update PromptViewStyles.js
- Add `.header-tabs` container styles
- Add `.header-tab` button styles with active state
- Ensure consistent sizing

### Step 5: Cleanup
- Remove FindInFiles/ContextViewer from AppShell render
- Update event flow (search results, context refresh, etc.)

## Files to Modify

1. **webapp/src/app-shell/AppShell.js**
   - Pass `activeLeftTab` to PromptView
   - Handle tab change events from PromptView
   - Remove direct FindInFiles/ContextViewer rendering

2. **webapp/src/PromptView.js**
   - Add `activeLeftTab` property
   - Add `switchTab()` method
   - Import FindInFiles and ContextViewer

3. **webapp/src/prompt/PromptViewTemplate.js**
   - Dynamic header title
   - Tab switcher buttons
   - Conditional content rendering

4. **webapp/src/prompt/PromptViewStyles.js**
   - Header tab styles

## Header Layout Details

```javascript
// Header structure
<div class="header">
  <div class="header-left">
    <span class="header-title">
      ${activeLeftTab === 'files' ? '💬 Chat' : 
        activeLeftTab === 'search' ? '🔍 Search' : 
        '📊 Context'}
    </span>
  </div>
  
  <div class="header-tabs">
    <button class="header-tab ${activeLeftTab === 'files' ? 'active' : ''}"
            @click=${() => this.switchTab('files')} title="Files & Chat">
      📁
    </button>
    <button class="header-tab ${activeLeftTab === 'search' ? 'active' : ''}"
            @click=${() => this.switchTab('search')} title="Search">
      🔍
    </button>
    <button class="header-tab ${activeLeftTab === 'context' ? 'active' : ''}"
            @click=${() => this.switchTab('context')} title="Context">
      📊
    </button>
  </div>
  
  <div class="header-right">
    ${activeLeftTab === 'files' ? html`
      <!-- Chat-specific buttons -->
      <button class="header-btn commit" @click=${this.handleCommit}>💾</button>
      <button class="header-btn reset" @click=${this.handleResetHard}>⚠️</button>
      <button class="header-btn" @click=${this.toggleHistoryBrowser}>📜</button>
      <button class="header-btn" @click=${this.showTokenReport}>📊</button>
      <button class="header-btn" @click=${this.clearContext}>🗑️</button>
    ` : ''}
    <button class="header-btn" @click=${this.toggleMinimize}>
      ${this.minimized ? '▲' : '▼'}
    </button>
  </div>
</div>
```

## Style Specifications

```css
.header-tabs {
  display: flex;
  gap: 4px;
}

.header-tab {
  width: 32px;
  height: 32px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  color: #888;
  transition: all 0.15s;
}

.header-tab:hover {
  background: rgba(233, 69, 96, 0.1);
  color: #ccc;
}

.header-tab.active {
  background: rgba(233, 69, 96, 0.2);
  border-color: #e94560;
  color: #e94560;
}
```

## Verification Checklist
- [ ] Switch between tabs - header layout should not shift
- [ ] Tab buttons stay in same position across all views
- [ ] Title updates correctly (💬 Chat / 🔍 Search / 📊 Context)
- [ ] Action buttons only visible in Chat view
- [ ] All tab buttons same size
- [ ] Search Ctrl+Shift+F still works
- [ ] Context viewer refreshes when switched to
- [ ] Search result navigation still works
- [ ] Drag/resize still works for dialog
- [ ] Minimize/maximize still works
