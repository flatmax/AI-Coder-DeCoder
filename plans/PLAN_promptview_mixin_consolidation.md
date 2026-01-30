# Plan: PromptView Mixin Consolidation

## Problem

`PromptView.js` currently uses 7 mixins:
- FileHandlerMixin - file tree loading, selection, git operations
- ImageHandlerMixin - paste handling, image preview (~60 lines)
- ChatActionsMixin - send message, commit, reset, clear context
- InputHandlerMixin - keyboard handling, history navigation, auto-resize
- WindowControlsMixin - drag, resize, minimize (already consolidated)
- StreamingMixin - streaming responses, request management
- UrlHandlerMixin - URL detection, fetching, state management

This creates:
- Complex initialization order dependencies
- Difficulty understanding which mixin provides what functionality
- Hard to test individual pieces in isolation

## Current State Analysis

**WindowControlsMixin is already consolidated** - it handles:
- Drag (mousedown/mousemove/mouseup on header)
- Resize (8 directional handles)
- State management (dialogX, dialogY, width, height)

**ImageHandlerMixin is small** (~60 lines) and closely related to input handling.

**UrlHandlerMixin** has significant state management that could be extracted.

## Proposed Consolidation

### Phase 1: Merge ImageHandlerMixin into InputHandlerMixin

ImageHandlerMixin is small (~60 lines) and conceptually related to input handling:
- Both deal with user input content
- Both have init/destroy lifecycle with event listeners
- Image paste is just another form of input

**Changes:**
- Move `handlePaste`, `processImageFile`, `removeImage`, `clearImages`, `getImagesForSend` into InputHandlerMixin
- Rename lifecycle methods: `initImageHandler` → part of `initInputHandler`
- Delete `ImageHandlerMixin.js`
- Update PromptView.js imports and mixin chain

### Phase 2: Extract URL Handling to Service

**Current:** `UrlHandlerMixin` mixes URL detection, fetching, and state into PromptView.

**Proposed:** Extract to a standalone service class:

```javascript
// webapp/src/services/UrlService.js
export class UrlService {
  constructor(rpcCall, onStateChange) { ... }
  
  // Detection
  detectUrlsInInput(text) { ... }
  
  // Fetching
  async fetchUrl(urlInfo) { ... }
  
  // State management
  toggleUrlIncluded(url) { ... }
  removeFetchedUrl(url) { ... }
  dismissUrl(url) { ... }
  clearState() { ... }
  clearAllState() { ... }
  
  // Getters
  get detectedUrls() { ... }
  get fetchedUrls() { ... }
  get excludedUrls() { ... }
  getFetchedUrlsForMessage() { ... }
}
```

**PromptView changes:**
- Instantiate `UrlService` in constructor
- Keep reactive properties (`detectedUrls`, `fetchedUrls`, etc.) in PromptView
- Service calls `onStateChange` callback to trigger updates
- Remove UrlHandlerMixin from mixin chain

**Benefits:**
- Testable in isolation (no LitElement dependency)
- Reusable by other components
- Clear API boundary
- State management contained in one place

## Implementation Order

1. ~~**Phase 1a:** Merge ImageHandlerMixin methods into InputHandlerMixin~~ ✅ DONE
1. ~~**Phase 1b:** Update PromptView to remove ImageHandlerMixin from chain~~ ✅ DONE
1. ~~**Phase 1c:** Delete ImageHandlerMixin.js~~ ✅ DONE
2. **Phase 2a:** Create `UrlService.js` with extracted logic
2. **Phase 2b:** Update PromptView to use service, remove UrlHandlerMixin
2. **Phase 2c:** Delete UrlHandlerMixin.js

## Current Status

**Phase 1 Complete:** ImageHandlerMixin merged into InputHandlerMixin. PromptView now uses 6 mixins (down from 7).

## Success Criteria

- PromptView uses 5 mixins (down from 7)
- URL logic is testable independently  
- No functionality regression
- Image paste still works
- URL detection/fetching still works

## Files to Modify

**Phase 1:**
- Modify: `webapp/src/prompt/InputHandlerMixin.js` (add image handling)
- Modify: `webapp/src/PromptView.js` (remove ImageHandlerMixin)
- Delete: `webapp/src/prompt/ImageHandlerMixin.js`

**Phase 2:**
- Create: `webapp/src/services/UrlService.js`
- Modify: `webapp/src/PromptView.js` (use service, remove mixin)
- Delete: `webapp/src/prompt/UrlHandlerMixin.js`

## Risks

- **Event handler binding:** Paste handler currently bound in `initImageHandler` - must preserve in `initInputHandler`
- **State reactivity:** URL state properties must remain reactive in PromptView; service triggers updates via callback
- **Template references:** UrlHandlerMixin methods called from template - need to proxy or keep methods on PromptView
