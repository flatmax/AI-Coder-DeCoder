# Webapp Hot Path Optimization

## Goal
Optimize the three highest-impact hot paths in the webapp: markdown re-parsing on message finalization, diff cache key allocation during streaming, and per-file regex construction for file mention highlighting.

## Execution Order
1. [x] Reuse streaming markdown on final render (highest ROI)
2. [x] Fix diff cache key join allocation
3. [x] Single-pass file mention highlighting

---

## 1. Reuse Streaming Markdown on Final Render

### Problem
In `CardMarkdown.processContent()`, when a message transitions from streaming → final (`this.final` flips to `true`), the streaming cache is explicitly cleared:

```js
// Final render: full processing pipeline — clear streaming cache
this._streamCache = null;
this._streamCacheSource = null;
```

Then `marked.parse(this.content)` runs again on identical content. For long assistant responses this is a wasted full markdown parse.

### Fix
When `final` becomes true, if `_streamCache` exists and `_streamCacheSource === this.content`, reuse `_streamCache` as the base HTML and only run post-processing (edit blocks, copy buttons, file mentions) on top of it.

### File: `webapp/src/prompt/CardMarkdown.js` — `processContent()`

**Before** (current logic, ~line 60):
```js
// Final render: full processing pipeline — clear streaming cache
this._streamCache = null;
this._streamCacheSource = null;
this._cachedContent = this.content;

const hasEditBlocks = this.content.includes('««« EDIT');
let processed;

if (hasEditBlocks) {
  processed = this.processContentWithEditBlocks(this.content);
} else {
  processed = marked.parse(this.content);
}
```

**After**:
```js
// Final render — reuse streaming parse if content unchanged
this._cachedContent = this.content;

const hasEditBlocks = this.content.includes('««« EDIT');
let processed;

if (hasEditBlocks) {
  // Edit blocks need structural extraction; must reparse
  processed = this.processContentWithEditBlocks(this.content);
} else if (this._streamCache && this._streamCacheSource === this.content) {
  // Content unchanged since last streaming chunk — reuse parsed HTML
  processed = this._streamCache;
} else {
  processed = marked.parse(this.content);
}

this._streamCache = null;
this._streamCacheSource = null;
```

### Risk
Very low. The streaming cache already contains `marked.parse(this.content)` output. We're just avoiding calling it a second time. Edit block messages still get full reparse since they need structural extraction.

---

## 2. Fix Diff Cache Key Join Allocation

### Problem
In `webapp/src/utils/diff.js`, `_getDiffCacheKey()` calls `oldLines.join('\n')` and `newLines.join('\n')` on every invocation — including cache hits. This is O(n) string allocation just to build the lookup key. During streaming, this runs per edit block per chunk.

```js
function _getDiffCacheKey(oldLines, newLines) {
  const oJoin = oldLines.join('\n');
  const nJoin = newLines.join('\n');
  return `${oldLines.length}:${newLines.length}:${oJoin.length}:${nJoin.length}:${simpleHash(oJoin)}:${simpleHash(nJoin)}`;
}
```

### Fix
Hash lines incrementally without joining. Feed each line into the hash function directly with a separator.

### File: `webapp/src/utils/diff.js`

Replace `_getDiffCacheKey` and add an incremental hash helper:

```js
function _hashLines(lines) {
  let hash = 5381;
  let totalLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    totalLen += line.length;
    for (let j = 0; j < line.length; j++) {
      hash = ((hash << 5) + hash + line.charCodeAt(j)) | 0;
    }
    // Hash a newline separator between lines
    hash = ((hash << 5) + hash + 10) | 0;
  }
  return { hash, totalLen };
}

function _getDiffCacheKey(oldLines, newLines) {
  const o = _hashLines(oldLines);
  const n = _hashLines(newLines);
  return `${oldLines.length}:${newLines.length}:${o.totalLen}:${n.totalLen}:${o.hash}:${n.hash}`;
}
```

The existing `simpleHash` function can remain for other uses but is no longer called by `_getDiffCacheKey`.

### Risk
Very low. Cache key is internal. Worst case on a hash collision is a false cache hit returning a stale diff — but the key includes both lengths and line counts as guardrails, same as before. The `simpleHash` algorithm (djb2) is preserved; we're just feeding it characters incrementally instead of from a joined string.

---

## 3. Single-Pass File Mention Highlighting

### Problem
In `webapp/src/prompt/FileMentionHelper.js`, `highlightFileMentions()` iterates every file in the repo (200+ files), constructs a regex for each, and runs `.test()` + `.replace()` against the full HTML string. Even with the `toLowerCase().includes()` pre-filter, the surviving matches each construct a regex with expensive variable-length lookbehind `(?<!<[^>]*)`.

```js
for (const filePath of sortedFiles) {
  if (!lowercaseResult.includes(filePath.toLowerCase())) continue;
  const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?<!<[^>]*)(?<!class=")\\b(${escaped})\\b(?![^<]*>)`, 'g');
  if (regex.test(result)) {
    foundFiles.push(filePath);
    regex.lastIndex = 0;
    result = result.replace(regex, ...);
  }
}
```

### Fix
Build a single combined regex from all candidate files (those passing the `includes` pre-filter), run one `.replace()` pass, and use the match callback to look up which file was matched.

### File: `webapp/src/prompt/FileMentionHelper.js` — `highlightFileMentions()`

**After**:
```js
export function highlightFileMentions(htmlContent, mentionedFiles, selectedFiles) {
  if (!mentionedFiles || mentionedFiles.length === 0) {
    return { html: htmlContent, foundFiles: [] };
  }

  const selectedSet = selectedFiles ? new Set(selectedFiles) : new Set();
  const lowercaseContent = htmlContent.toLowerCase();

  // Pre-filter: only files whose path appears as substring
  const candidates = mentionedFiles.filter(f => lowercaseContent.includes(f.toLowerCase()));

  if (candidates.length === 0) {
    return { html: htmlContent, foundFiles: [] };
  }

  // Sort by length descending so longer paths match first in alternation
  candidates.sort((a, b) => b.length - a.length);

  // Build single combined regex
  const escapedPaths = candidates.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const combined = new RegExp(
    `(?<!<[^>]*)(?<!class=")\\b(${escapedPaths.join('|')})\\b(?![^<]*>)`,
    'g'
  );

  // Track which files were actually found
  const foundSet = new Set();

  const result = htmlContent.replace(combined, (match, filePath) => {
    foundSet.add(filePath);
    const contextClass = selectedSet.has(filePath) ? ' in-context' : '';
    return `<span class="file-mention${contextClass}" data-file="${filePath}">${filePath}</span>`;
  });

  return { html: result, foundFiles: [...foundSet] };
}
```

### Risk
Low-medium. The combined regex with alternation `(path1|path2|...)` is a well-understood pattern. The lookbehind behavior is unchanged. The main risk is if a very large number of candidates (50+) creates a regex that's slow due to alternation backtracking — but the `\b` word boundaries constrain this. If needed, we can cap candidates at ~50 and fall back to the iterative approach for the remainder.

Note: the old code's memoization of sorted files (`_lastInput`/`_lastSorted`) is no longer needed since we sort the pre-filtered candidates (much smaller list) each time.

---

## Testing

- **#1**: Send a long message, verify final render matches streaming render visually. Check that edit blocks still render correctly with status badges.
- **#2**: Open a file with edit blocks during streaming, verify diff rendering still works. Check that the diff cache key produces the same hit/miss behavior.
- **#3**: Send a message that mentions several repo files. Verify file chips appear, click-to-add works, `in-context` styling applies correctly. Test with files containing regex-special characters in their paths (e.g., `c++/file.h`).

## Not in Scope
- Monaco language subsetting (high complexity, medium risk)
- CSS-hide inactive tabs (medium complexity, medium risk — consider separately)
- Sub-component extraction from PromptViewTemplate (medium complexity, low impact)
