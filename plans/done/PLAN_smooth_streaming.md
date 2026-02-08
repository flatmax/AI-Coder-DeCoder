# Smooth Streaming Rendering Plan


### Files
- `EditBlockRenderer.js`: Enhance `renderInProgressEditBlock()` to accept
  partial content lines and render them as diff lines
- `CardMarkdown.js`: Extract partial content from unclosed edit block and
  pass to renderer
═══════ REPL
## Status: COMPLETE

## Completed
- ✅ Step 1: Streaming cursor (blinking ▌ via CSS)
- ✅ Step 2: Progressive edit block rendering (diffs during streaming + in-progress placeholder)
- ✅ Step 3: Streaming attribute plumbing (AssistantCard → CardMarkdown)
- ✅ Step 4: Incremental markdown parsing (only parse new complete segments per frame)
- ✅ Step 5: Live partial diff in in-progress edit blocks
- ⏭️ CSS smooth growth — skipped, rejected per plan analysis (unsafeHTML replaces DOM each frame, animations would flicker)

## Summary of Changes
- `AssistantCard.js`: Pass `?streaming` attribute to `card-markdown`
- `CardMarkdown.js`: Streaming property, cursor CSS, incremental parsing (`_incrementalParse`, `_findSafeSplit`), progressive edit block rendering (`_processStreamingWithEditBlocks`), in-progress pulse CSS
- `EditBlockRenderer.js`: `renderInProgressEditBlock()` with live partial diff, `renderPartialDiff()` helper
═══════ REPL

### Files
- `EditBlockRenderer.js`: Enhance `renderInProgressEditBlock()` to accept
  partial content lines and render them as diff lines
- `CardMarkdown.js`: Extract partial content from unclosed edit block and
  pass to renderer

## Problem

The assistant's streaming output appears "blocky" — content arrives in visible
chunks rather than flowing smoothly. Edit blocks render as raw text during
streaming, then snap into nicely formatted diffs only when the response
completes. This creates a jarring experience despite good underlying performance.

## Current Architecture

### Streaming data path

1. Server `StreamingMixin` fires `streamChunk(requestId, content)` with
   **accumulated** content (each chunk contains the full response so far)
2. `PromptView.streamChunk()` calls `this.streamWrite(content, false, 'assistant')`
3. `MessageHandler.streamWrite()` coalesces via `requestAnimationFrame` —
   only the latest chunk renders per frame (~60 updates/sec max)
4. `MessageHandler._processStreamChunk()` mutates the last message's
   `.content` in-place, calls `this.requestUpdate('messageHistory')`
5. `AssistantCard` receives new `.content`, `shouldUpdate()` detects change
6. `CardMarkdown.processContent()` runs — **this is where the problems live**

### What works well (don't touch)

- `MessageHandler.js` rAF coalescing — already optimal
- `AssistantCard.shouldUpdate()` comparison — prevents spurious re-renders
- `StreamingMixin.js` (server) chunk delivery — fine
- The final render path (`this.final === true`) — already good
- `StreamingMixin.js` (client) `_buildEditResults` — correct

## Root Causes

### Cause 1: Full markdown re-parse every frame (PRIMARY)

During streaming, `CardMarkdown.processContent()` attempts a fast-path:

```js
if (delta && !/[`#*_\[\]!<>\-|\\~]/.test(delta)) {
    // Fast path: append escaped text as HTML
}
```

But LLM output is full of markdown characters (`#`, `*`, `` ` ``, `-`, etc.).
Nearly every chunk hits the slow path: **full `marked.parse()` on the entire
accumulated content**. This causes the entire DOM to be replaced each frame:

- Destroys any CSS transitions mid-animation
- Causes layout thrash (old DOM removed, new DOM inserted)
- Creates visual "jumps" as the browser paints a fully re-rendered block
- Gets progressively slower as the response grows

### Cause 2: Edit blocks invisible during streaming

In `processContent()`, edit blocks are only processed when `final === true`:

```js
if (isStreaming) {
    // Just marked.parse() — no edit block extraction
    return result;
}
```

During streaming, `««« EDIT` markers render as mangled markdown/raw text.
On `streamComplete`, they snap into nicely formatted diff views. This creates
the most jarring visual discontinuity.

### Cause 3: No visual continuity cues

There are no CSS transitions on content growth, no streaming cursor indicator,
and no visual feedback that content is actively arriving. Height jumps are
instant when markdown parsing adds new blocks.

### Cause 4: Fast-path regex is too conservative

The delta fast-path regex rejects any delta containing markdown characters,
but many of those characters are benign mid-line (e.g., `-` in a word,
`*` in a sentence). The fast-path almost never triggers for real LLM output.

## Confirmed Improvements

### 1. Incremental markdown parsing (HIGH impact, MEDIUM effort)

**Problem**: Every frame re-parses the entire accumulated content.

**Fix**: During streaming, only parse new complete segments and append HTML.

**Strategy**:
- Track `_streamParsedUpTo` — byte index of content already parsed to HTML
- On each update, find the last safe split point in new content (a `\n\n` or
  `\n` boundary where no markdown structure is left open)
- Parse only the new complete segment via `marked.parse()`, append to cached HTML
- Keep trailing partial content (incomplete paragraph/fence) as unparsed buffer
- On `final`, do one full re-parse to handle edge cases

**Safe split detection**: A line boundary is safe if:
- No unclosed code fence (count of `` ``` `` is even)
- No unclosed HTML tag
- The line is a blank line (paragraph boundary) or starts a new block element

**Fallback**: If no safe split is found in the delta (e.g., inside a long code
block), accumulate and wait for the next chunk. The existing rAF coalescing
means this doesn't cause visible delay.

**Safety net**: The `final` render always does a full `marked.parse()` of the
complete content plus edit block extraction, file mentions, and copy buttons.
Any incremental parsing errors are corrected at completion.

**Files**: `webapp/src/prompt/CardMarkdown.js`

### 2. Progressive edit block rendering (HIGH impact, LOW-MEDIUM effort)

**Problem**: Edit blocks are raw text during streaming, snap to diffs at end.

**Fix**: Detect and render completed edit blocks during streaming.

**Strategy**:
- During streaming, scan accumulated content for completed edit block pairs
  (`««« EDIT` through `»»» EDIT END`)
- For each completed block, call `parseEditBlocks()` + `renderEditBlock()`
  inline (reusing existing functions)
- For an in-progress block (has `««« EDIT` but no `»»» EDIT END` yet),
  render a styled placeholder showing the file path and a pulsing indicator
- Content before, between, and after edit blocks gets normal markdown parsing
- Status for all blocks during streaming is "pending" (no apply results yet)

**In-progress placeholder**: When we detect an unclosed `««« EDIT`:
```html
<div class="edit-block in-progress">
  <div class="edit-block-header">
    <span class="edit-block-file">path/to/file.ext</span>
    <span class="edit-block-status pending">⏳ Writing...</span>
  </div>
  <div class="edit-block-content streaming-pulse"></div>
</div>
```

**Integration with incremental parsing**: Edit block detection runs on the
full accumulated content (not just the delta), but only re-renders blocks
that changed since last frame. Completed blocks are cached by index.

**Files**: `webapp/src/prompt/CardMarkdown.js`, `webapp/src/prompt/EditBlockRenderer.js`

### 3. Streaming cursor indicator (LOW effort, nice polish)

**Problem**: No visual feedback that content is actively arriving.

**Fix**: Add a blinking cursor at the end of streaming content via CSS.

**Implementation**: `AssistantCard` reflects streaming state as a host attribute.
`CardMarkdown` uses a CSS pseudo-element:

```css
:host([streaming]) .content::after {
    content: '▌';
    animation: blink 0.8s step-end infinite;
    color: #e94560;
    font-weight: bold;
}

@keyframes blink {
    50% { opacity: 0; }
}
```

Zero JS cost — purely CSS-driven off an attribute that already changes
(`final` property toggling).

**Files**: `webapp/src/prompt/AssistantCard.js`, `webapp/src/prompt/CardMarkdown.js`

## Rejected Ideas

### Throttling chunk processing to fewer updates/sec

The rAF coalescing already limits to ~60fps, and the real problem is per-frame
cost, not frequency. Reducing to e.g., 10fps would make streaming feel even
more choppy. The fix is making each frame cheaper (incremental parsing), not
fewer frames.

### Web Workers for markdown parsing

`marked.parse()` on typical chunks takes <1ms. The overhead of serializing
content to/from a worker exceeds the parse time. The real cost is DOM
replacement, which must happen on the main thread regardless.

### Virtual scrolling for messages

The existing `content-visibility: auto` with `contain-intrinsic-size` already
handles this. Only the last ~15 messages render fully. Adding virtual
scrolling would break the streaming message's auto-scroll behavior.

### Streaming raw text, parse only on final

This would make the streaming output look like plain text (no formatting at
all) until completion. Worse UX than the current blocky markdown.

### CSS growth animations on streaming content

During streaming, `unsafeHTML()` replaces the entire DOM subtree each frame.
CSS animations on `:last-of-type` would re-trigger on every element every frame
(since all elements are "new" after DOM replacement), causing flickering rather
than just animating new content. Would require a fundamentally different
rendering approach (DOM diffing or keyed elements) to work correctly.

### Using `innerHTML` diff/patch instead of full replacement

Libraries like `morphdom` or `diffhtml` could patch the DOM incrementally.
However, `marked.parse()` output isn't stable across invocations with
different input lengths (paragraph wrapping, list detection, etc.), so diffs
would be large and unpredictable. The incremental parsing approach avoids
this entirely by only appending.

## Implementation Order

1. **Streaming cursor** — Quick CSS-only win, immediate visual improvement
2. **Progressive edit blocks** — Biggest visual improvement (no more end-of-stream snap)
3. **Widen streaming fast-path** — Simple regex change, smoother text flow

Each step is independently deployable and testable. Steps 1+2 together give
the most dramatic improvement.

## Detailed Implementation

### Step 1: Streaming cursor

**`AssistantCard.js`** — reflect streaming state:
```js
render() {
    return html`
      <div class="card">
        <card-markdown .content=${this.content}
                       .final=${this.final !== false}
                       ?streaming=${this.final === false}
                       ...></card-markdown>
      </div>
    `;
}
```

**`CardMarkdown.js`** — add `streaming` as a reflected boolean property so
CSS `:host([streaming])` works:
```js
static properties = {
    ...
    streaming: { type: Boolean, reflect: true },
};
```

Add to static styles:
```css
:host([streaming]) .content::after {
    content: '▌';
    display: inline;
    animation: blink 0.8s step-end infinite;
    color: #e94560;
    font-weight: bold;
}
@keyframes blink { 50% { opacity: 0; } }
```

### Step 2: Progressive edit blocks

**`CardMarkdown.js`** — modify streaming path in `processContent()`:

Replace the streaming fast-path with:
```js
if (isStreaming) {
    const hasEditMarker = this.content.includes('««« EDIT');
    if (hasEditMarker) {
        processed = this._processStreamingWithEditBlocks(this.content);
    } else {
        // existing marked.parse() path
    }
}
```

New method `_processStreamingWithEditBlocks(content)`:
- Call `parseEditBlocks(content)` to find completed blocks
- Use the same segment-splitting approach as `processContentWithEditBlocks()`
  but also detect a trailing unclosed edit block
- For completed blocks: render with `renderEditBlock()` (pending status)
- For in-progress block: extract file path from the line **before** `««« EDIT`
  (the edit format puts the file path on the preceding line), render
  `renderInProgressEditBlock(filePath)` placeholder
- Text segments between blocks get `marked.parse()`
- Pass `[]` as editResults (all show "pending" status)

**`EditBlockRenderer.js`** — add helper:
```js
export function renderInProgressEditBlock(filePath) {
    return `
      <div class="edit-block in-progress">
        <div class="edit-block-header">
          <span class="edit-block-file">${escapeHtml(filePath)}</span>
          <span class="edit-block-status pending">⏳ Writing...</span>
        </div>
        <div class="edit-block-content">
          <div class="streaming-edit-pulse"></div>
        </div>
      </div>`;
}
```

CSS for the in-progress state (in `CardMarkdown.js` styles):
```css
.streaming-edit-pulse {
    height: 24px;
    background: linear-gradient(90deg, transparent, rgba(233,69,96,0.1), transparent);
    animation: pulse-sweep 1.5s ease-in-out infinite;
}
@keyframes pulse-sweep {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}
```

### Step 3: Incremental markdown parsing

**`CardMarkdown.js`** — replace streaming parse path:

New state:
```js
this._incrementalHtml = '';      // Accumulated parsed HTML
this._incrementalParsedTo = 0;  // Index into content already parsed
this._incrementalFenceOpen = false; // Tracking open code fences
```

New method `_incrementalParse(content)`:
```js
_incrementalParse(content) {
    if (!this._incrementalHtml && this._incrementalParsedTo === 0) {
        // First chunk — initialize
    }

    const unparsed = content.slice(this._incrementalParsedTo);
    const safeSplit = this._findSafeSplit(unparsed);

    if (safeSplit > 0) {
        const segment = unparsed.slice(0, safeSplit);
        const segmentHtml = marked.parse(segment);
        this._incrementalHtml += segmentHtml;
        this._incrementalParsedTo += safeSplit;
    }

    // Render: cached HTML + raw-escaped tail
    const tail = content.slice(this._incrementalParsedTo);
    const tailHtml = tail ? escapeHtml(tail).replace(/\n/g, '<br>') : '';
    return this._incrementalHtml + tailHtml;
}
```

`_findSafeSplit(text)` finds the last `\n` position where no code fence is
open. Tracks fence state by counting `` ``` `` occurrences.

Reset on `final`: clear incremental state, do full parse.

### Step 4: CSS smooth growth

Add to `CardMarkdown.js` styles — minimal animations only during streaming:
```css
:host([streaming]) .content > p:last-of-type,
:host([streaming]) .content > pre:last-of-type,
:host([streaming]) .content > .edit-block:last-of-type {
    animation: fadeSlideIn 0.15s ease-out;
}
@keyframes fadeSlideIn {
    from { opacity: 0.6; transform: translateY(3px); }
    to   { opacity: 1; transform: translateY(0); }
}
```

## Risk Assessment

| Change | Risk | Mitigation |
|---|---|---|
| Incremental parsing | Edge cases at chunk boundaries (open fences, partial HTML) | Full re-parse on `final` corrects any errors; safe-split is conservative |
| Progressive edit blocks | Partial edit block detection during streaming | Only render blocks with both markers; in-progress placeholder for unclosed |
| CSS cursor | None | Pure CSS, no JS |
| CSS animations | Could feel janky if duration is wrong | Very short duration (150ms), streaming-only, easily tunable |

## Testing Approach

- **Manual**: Stream a response with mixed markdown + edit blocks, verify:
  - Text flows incrementally (no full-DOM jumps)
  - Edit blocks appear as diffs when complete, pulsing placeholder while writing
  - Cursor blinks during streaming, disappears on completion
  - Final render matches current quality exactly
- **Edge cases**: Long code blocks spanning many chunks, multiple edit blocks,
  cancelled streams, very fast/slow responses
- **Performance**: Compare Chrome DevTools Performance tab flame charts
  before/after for a typical streaming response (~2k tokens). The per-frame
  cost should drop significantly with incremental parsing.
