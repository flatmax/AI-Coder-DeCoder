# Plan: PromptView Mixin Consolidation

## Problem

`PromptView.js` currently uses 9 mixins, indicating the component has too many responsibilities:
- FileHandlerMixin
- ImageHandlerMixin
- ChatActionsMixin
- InputHandlerMixin
- WindowControlsMixin
- StreamingMixin
- UrlHandlerMixin
- DragHandlerMixin
- ResizeHandlerMixin

This creates:
- Complex initialization order dependencies
- Difficulty understanding which mixin provides what functionality
- Tight coupling between unrelated concerns
- Hard to test individual pieces

## Proposed Consolidation

### Phase 1: Consolidate Window Management Mixins

**Merge into single `WindowMixin`:**
- `WindowControlsMixin` - minimize/restore, window controls
- `DragHandlerMixin` - dialog dragging
- `ResizeHandlerMixin` - resize handles

These are all related to window/dialog positioning and sizing. They share:
- Mouse event handling patterns
- Position/size state management
- Similar lifecycle (init/destroy)

**New structure:**
```
webapp/src/prompt/WindowMixin.js  (new, consolidated)
```

**Delete after merge:**
```
webapp/src/prompt/WindowControlsMixin.js
webapp/src/prompt/DragHandlerMixin.js (if exists)
webapp/src/prompt/ResizeHandlerMixin.js (if exists)
```

### Phase 2: Extract URL Handling to Service

**Current:** `UrlHandlerMixin` mixes URL detection, fetching, and state into PromptView.

**Proposed:** Extract to a standalone service class that PromptView instantiates:

```javascript
// webapp/src/services/UrlService.js
export class UrlService {
  constructor(rpcCall) { ... }
  
  // Detection
  detectUrlsInInput(text) { ... }
  
  // Fetching
  async fetchUrl(urlInfo) { ... }
  
  // State management
  toggleUrlIncluded(url) { ... }
  removeFetchedUrl(url) { ... }
  dismissUrl(url) { ... }
  clearState() { ... }
  
  // Getters
  getDetectedUrls() { ... }
  getFetchedUrls() { ... }
  getExcludedUrls() { ... }
  getFetchedUrlsForMessage() { ... }
}
```

**Benefits:**
- Testable in isolation
- Reusable by other components
- Clear API boundary
- State management contained in one place

### Phase 3: Consider Further Consolidation

After Phase 1 & 2, evaluate remaining mixins:

| Mixin | Keep Separate? | Rationale |
|-------|---------------|-----------|
| FileHandlerMixin | Yes | File tree is complex, distinct concern |
| ImageHandlerMixin | Maybe merge with Input | Small, related to input handling |
| ChatActionsMixin | Yes | Core chat logic, distinct |
| InputHandlerMixin | Yes | Keyboard/input handling is substantial |
| StreamingMixin | Yes | Async streaming is complex |

**Potential merge:** ImageHandlerMixin → InputHandlerMixin (both deal with input content)

## Implementation Order

1. **Phase 1a:** Audit existing window-related mixins to understand current state
2. **Phase 1b:** Create consolidated `WindowMixin.js`
3. **Phase 1c:** Update PromptView to use new mixin, remove old ones
4. **Phase 2a:** Create `UrlService.js` with extracted logic
5. **Phase 2b:** Create thin `UrlHandlerMixin` that delegates to service (or remove mixin entirely)
6. **Phase 2c:** Update PromptView to use service
7. **Phase 3:** Evaluate ImageHandler → InputHandler merge

## Success Criteria

- PromptView uses ≤6 mixins (down from 9)
- URL logic is testable independently
- Window management is in one place
- No functionality regression
- Existing tests pass

## Files to Modify

**Phase 1:**
- Create: `webapp/src/prompt/WindowMixin.js`
- Modify: `webapp/src/PromptView.js`
- Delete: `webapp/src/prompt/WindowControlsMixin.js`
- Delete: `webapp/src/prompt/DragHandlerMixin.js` (if exists)
- Delete: `webapp/src/prompt/ResizeHandlerMixin.js` (if exists)

**Phase 2:**
- Create: `webapp/src/services/UrlService.js`
- Modify: `webapp/src/prompt/UrlHandlerMixin.js` (or delete)
- Modify: `webapp/src/PromptView.js`

## Risks

- **Event handler binding:** Mixins often bind `this` in connectedCallback - must preserve order
- **State reactivity:** LitElement reactive properties must remain in component, not service
- **Template references:** Some mixins may have tight coupling to template structure

## Notes

Looking at the symbol map, I see:
- `WindowControlsMixin` exists at `webapp/src/prompt/WindowControlsMixin.js`
- `DragHandlerMixin` referenced in template but not in symbol map - may be part of WindowControls
- `ResizeHandlerMixin` referenced in template but not in symbol map - may be part of WindowControls

Need to inspect actual files to confirm current structure before implementing.
