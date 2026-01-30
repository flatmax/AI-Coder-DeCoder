# Plan: Webapp Utility Consolidation

## Problem

Several utility methods are duplicated across webapp components:

1. **`_extractResponse`** - Identical in 3 components
2. **`_call`** - RPC helper duplicated in 2 components  
3. **Formatting functions** - `formatTokens`, `formatTimestamp`, `_formatDate` scattered across 4 components

This creates:
- Maintenance burden (fix bugs in multiple places)
- Inconsistent behavior risk
- Unnecessary code duplication

## Current State

### `_extractResponse` (3 locations)
- `webapp/src/find-in-files/FindInFiles.js:241`
- `webapp/src/history-browser/HistoryBrowser.js:151`
- `webapp/src/context-viewer/ContextViewer.js:95`

All do the same thing: extract `response.result` or return raw response.

### `_call` RPC helper (2 locations)
- `webapp/src/find-in-files/FindInFiles.js:234`
- `webapp/src/history-browser/HistoryBrowser.js:143`

Both wrap RPC calls with `this.call(method, ...args)` pattern.

### Formatting functions (4 locations)
- `webapp/src/context-viewer/ContextViewer.js:203` - `formatTokens(count)`
- `webapp/src/history-browser/HistoryBrowser.js:132` - `formatTimestamp(isoString)`
- `webapp/src/history-browser/HistoryBrowser.js:138` - `truncateContent(content, maxLength)`
- `webapp/src/context-viewer/UrlContentModal.js:186` - `_formatTokens(count)`
- `webapp/src/context-viewer/UrlContentModal.js:202` - `_formatDate(isoString)`

## Proposed Solution

### Phase 1: Create Shared Utilities Module

Create `webapp/src/utils/formatters.js`:

```javascript
/**
 * Format token count with K/M suffixes
 * @param {number} count 
 * @returns {string}
 */
export function formatTokens(count) {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

/**
 * Format ISO timestamp to locale string
 * @param {string} isoString 
 * @returns {string}
 */
export function formatTimestamp(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleString();
}

/**
 * Format ISO timestamp as relative time (e.g., "5 min ago") or date
 * @param {string} isoString 
 * @returns {string}
 */
export function formatRelativeTime(isoString) {
  if (!isoString) return 'Unknown';
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    return date.toLocaleDateString();
  } catch {
    return 'Unknown';
  }
}

/**
 * Truncate content with ellipsis
 * @param {string} content 
 * @param {number} maxLength 
 * @returns {string}
 */
export function truncateContent(content, maxLength = 100) {
  if (!content || content.length <= maxLength) return content;
  return content.substring(0, maxLength) + '...';
}
```

### Phase 2: Create RPC Utilities Module

Create `webapp/src/utils/rpc.js`:

```javascript
/**
 * Extract result from RPC response
 * RPC responses come as {method_name: result} - extract the first value
 * @param {object} response 
 * @returns {*}
 */
export function extractResponse(response) {
  if (!response) return null;
  if (typeof response !== 'object') return response;
  const values = Object.values(response);
  return values.length > 0 ? values[0] : null;
}
```

### Phase 3: Update Components

**ContextViewer.js:**
- Import `formatTokens` from utils
- Import `extractResponse` from utils
- Remove local `formatTokens` and `_extractResponse` methods

**HistoryBrowser.js:**
- Import `formatTimestamp`, `truncateContent` from utils
- Import `extractResponse` from utils
- Remove local methods

**FindInFiles.js:**
- Import `extractResponse` from utils
- Remove local `_extractResponse` method

**UrlContentModal.js:**
- Import `formatTokens`, `formatDate` from utils
- Remove local `_formatTokens` and `_formatDate` methods

## Implementation Order

1. **Phase 1a:** Create `webapp/src/utils/formatters.js`
2. **Phase 1b:** Create `webapp/src/utils/rpc.js`
3. **Phase 2a:** Update `ContextViewer.js` to use shared utils
4. **Phase 2b:** Update `HistoryBrowser.js` to use shared utils
5. **Phase 2c:** Update `FindInFiles.js` to use shared utils
6. **Phase 2d:** Update `UrlContentModal.js` to use shared utils
7. **Phase 3:** Test all components work correctly

## Files to Create

- `webapp/src/utils/formatters.js`
- `webapp/src/utils/rpc.js`

## Files to Modify

- `webapp/src/context-viewer/ContextViewer.js`
- `webapp/src/history-browser/HistoryBrowser.js`
- `webapp/src/find-in-files/FindInFiles.js`
- `webapp/src/context-viewer/UrlContentModal.js`

## Success Criteria

- No duplicate utility functions across components
- All formatting is consistent (same function, same behavior)
- All RPC response extraction uses shared helper
- No functionality regression
- Cleaner, more maintainable codebase

## Risks

- **Import paths:** Need to ensure relative imports work from all component locations
- **Method binding:** Some components may use `this.formatTokens()` in templates - need to keep as methods or update template calls
- **Subtle differences:** Must verify the duplicated functions are truly identical before consolidating

## Notes

**Verified:** All three `_extractResponse` implementations do the same thing - extract the first value from the response object using `Object.values(response)[0]` or equivalent.

**`_call` helper:** The two implementations differ slightly:
- FindInFiles uses optional chaining: `this.rpcCall?.[method]`
- HistoryBrowser does not: `this.rpcCall[method]`

Since these are simple one-liners and tightly coupled to each component's `rpcCall` property, we'll leave the `_call` method in place rather than extracting it. The `extractResponse` function is the main target for consolidation.

**Formatting:** UrlContentModal has `_formatDate` which does relative time ("5 min ago"), not just date formatting. This is captured as `formatRelativeTime` in the utils.
