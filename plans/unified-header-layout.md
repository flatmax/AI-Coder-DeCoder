# Unified Header Layout Plan

## Goal
Create consistent headers across Chat, Search, and Context views with:
- Icon + Title on the left (💬 Chat, 🔍 Search, 📊 Context)
- Tab switcher buttons (📁 🔍 📊) in the same location across all views
- Commit/action buttons on the right
- Same sizing and spacing

## Current State
- PromptView has header with "💬 Chat" + tabs + commit buttons
- FindInFiles and ContextViewer render inside PromptView's picker-panel
- Header title changes dynamically but tabs/layout may not be consistent

## Target Layout (from image)
```
┌─────────────────────────────────────────────────────────────────┐
│ 💬 Chat    [📁][🔍][📊]           [💾][🎁]    ▼ │
├─────────────────────────────────────────────────────────────────┤
│ Filter files...                                                 │
│ (content area)                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### 1. Standardize Header Structure in PromptViewTemplate.js
- Header left: Icon + Title (changes based on activeLeftTab)
- Header center: Tab buttons (📁 🔍 📊) - always visible, same position
- Header right: Commit buttons (only show for Chat view) + minimize

### 2. Ensure Tab Buttons Are Consistently Sized
- Use fixed width/height for tab buttons
- Same padding, border-radius, colors
- Active state highlighting

### 3. Remove Duplicate Headers
- FindInFiles and ContextViewer should NOT have their own headers
- They render as content inside PromptView's picker-panel
- PromptView's header serves all three views

### 4. Files to Modify

**PromptViewTemplate.js:**
- Update header-left to show correct icon/title per tab
- Ensure tab buttons are centered and consistent
- Conditionally show commit buttons only for 'files' tab

**PromptViewStyles.js:**
- Standardize `.header-tab` button sizing
- Ensure consistent spacing

**FindInFilesTemplate.js / ContextViewerTemplate.js:**
- Confirm no header rendering (already removed)
- Content should start immediately

### 5. Specific Changes

```javascript
// Header left - dynamic title
<div class="header-left">
  <span>${activeLeftTab === 'files' ? '💬 Chat' : 
          activeLeftTab === 'search' ? '🔍 Search' : 
          '📊 Context'}</span>
</div>

// Header center - tabs (always same position)
<div class="header-tabs">
  <button class="header-tab ${activeLeftTab === 'files' ? 'active' : ''}" 
          @click=${() => switchTab('files')}>📁</button>
  <button class="header-tab ${activeLeftTab === 'search' ? 'active' : ''}"
          @click=${() => switchTab('search')}>🔍</button>
  <button class="header-tab ${activeLeftTab === 'context' ? 'active' : ''}"
          @click=${() => switchTab('context')}>📊</button>
</div>

// Header right - commit buttons (conditional)
<div class="header-right">
  ${activeLeftTab === 'files' ? html`
    <button class="commit-btn" @click=${...}>💾</button>
    <button class="commit-btn" @click=${...}>🎁</button>
  ` : ''}
  <button class="minimize-btn" @click=${toggleMinimize}>▼</button>
</div>
```

### 6. Style Consistency
```css
.header-tab {
  width: 32px;
  height: 32px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
}

.header-tab.active {
  background: rgba(233, 69, 96, 0.3);
  box-shadow: 0 0 0 1px #e94560;
}
```

## Verification
- Switch between tabs - header layout should not shift
- Tab buttons stay in same position
- Title updates correctly
- Commit buttons only visible in Chat view
- All buttons same size
