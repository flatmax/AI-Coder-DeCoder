# TeX Preview

Live TeX preview activated via the Preview button on TeX and LaTeX files in the diff viewer. Source is compiled with `make4ht` on the server and rendered in the browser with KaTeX for math. Uses anchor-based scroll synchronization that works reliably even when KaTeX rendering destroys the original text layout.
## Compilation Pipeline
1. Diff viewer sends the current editor content and file path to the compile-tex RPC
2. Server prepends a non-stop-mode directive before the document class (so the TeX engine never pauses for user input on errors) and writes the content to a temp TeX file
3. Server runs `make4ht` with mathjax option, suppressed stdin (prevents hangs if TeX prompts for input), and a generous timeout
4. Resulting HTML body is extracted, assets (images, CSS) inlined as data URIs
5. Server strips make4ht alt-text fallbacks
6. Client renders math delimiters with KaTeX
7. Client strips any remaining alt-text duplicates using sentinel comments as anchors
## make4ht Configuration
- Custom config file generated per compilation to force mathjax-compatible output
- Tells TeX4ht to emit raw LaTeX math delimiters instead of converting equations to SVG/PNG
- Browser-side KaTeX handles the actual math display
## Math Rendering
Three-phase processing of make4ht HTML:
### Phase 1: Strip Alt-Text Elements
- Remove mathjax-preview spans and similar elements that make4ht emits as plain-text fallbacks alongside delimited math
### Phase 2: Render Delimiters
Process math delimiters in priority order, appending a sentinel HTML comment after each rendered output:
- Display equation environments (equation, align, gather, multline, eqnarray) → KaTeX display math
- Display bracket delimiters → KaTeX display math
- Double-dollar delimiters → KaTeX display math
- Display paren delimiters → KaTeX inline math
- Single-dollar delimiters → KaTeX inline math
### Phase 3: Strip Orphan Alt-Text
- Using the sentinel comments as reliable anchors, strip all bare text nodes between a sentinel and the next HTML tag
- These are always make4ht plain-text duplicates
- Sentinels then removed
- Avoids fragile regex matching through KaTeX's complex output HTML
### Entity and Command Handling
- Helper reverses HTML entity escaping that make4ht applies inside math regions before passing to KaTeX
- Strips unsupported commands (label, tag, nonumber, notag)
## Save-Triggered Compilation
- TeX compilation is expensive (spawns subprocess)
- Unlike markdown preview which updates on every keystroke, TeX preview only recompiles when the file is saved
- Keystrokes do not trigger recompilation — preview holds its last-compiled output until the next save
## Scroll Synchronization
Two-pass anchor-and-interpolation strategy to inject source-line attributes into the make4ht HTML.
### Phase 1: Structural Anchor Extraction
TeX source is scanned for structural commands, each mapped to its 1-based line number:
| Command pattern | Anchor kind |
|---|---|
| Section, subsection, etc. | Heading (with text for verification) |
| Environment start | Environment start |
| Environment end | Skipped, not matched to elements |
| List items | List item |
| Algorithmic pseudo-code commands | Algorithmic |
| Caption command | Caption |
| Make-title command | Title block |
### Element Matching
- Anchors matched against HTML elements by structural role and document order
- Headings match heading tags or heading-classed divisions
- List items and algorithmic commands match list items, paragraphs, or divisions sequentially
- Environment starts match container elements (divisions, tables, lists, preformatted blocks)
- Each anchor searches a small lookahead window to tolerate make4ht wrapper elements
### Phase 2: Interpolation
- All block-level elements in the HTML collected in document order
- Elements that received an anchor in Phase 1 keep their exact line number
- First and last elements assigned boundary values if unanchored
- Remaining unmatched elements assigned linearly-interpolated line numbers between their nearest anchored neighbors
### Phase 3: Attribute Injection
- Source-line attributes spliced into the HTML string back-to-front (earlier insertions don't shift later offsets)
### Sync Mechanics
- Every block element gets a source-line attribute; scroll sync is continuous with no dead zones
- No text comparison involved — works even when KaTeX destroys original text
- Bidirectional scroll sync same as markdown preview (editor → preview and preview → editor with scroll lock)
- See [diff-viewer.md](diff-viewer.md#bidirectional-scroll-sync) for the sync mechanism
## Asset Resolution
Server-side helper converts relative paths in make4ht output to inline data URIs:
- Image source attributes on image tags → base64 data URIs
- URL references in inline CSS → base64 data URIs
- Linked stylesheets → inlined style blocks
Working directory for make4ht set to the file's parent directory so that input, include, and includegraphics resolve relative paths correctly.
## Availability Check
- Before enabling TeX preview, the diff viewer calls a tex-preview-availability RPC to check if make4ht is installed
- If not installed, preview pane displays installation instructions instead of an error
## Temp Directory Lifecycle
- Each compilation creates a temp directory under the per-repo working directory (already gitignored)
- Previous compilation's temp dir cleaned up at the start of the next compilation
- At most one temp dir alive at a time (generated images can be served during the preview session)
- Using the per-repo working directory instead of system temp avoids cross-repo collisions and ensures cleanup is scoped to the repository
- On server startup, the entire tex-preview subdirectory is removed — handles orphans from crashed or killed previous runs
## Working Directory Isolation

- make4ht runs with working directory set to the temp directory, not the file's parent
- Critical because make4ht and TeX write numerous intermediate files (aux, dvi, 4ct, 4tc, log, etc.) to the current working directory — the output flag only controls the final HTML location
- Without this, every preview compilation would litter the repository with TeX build artifacts
- For input, include, and includegraphics resolution, an environment variable is set to the original file's parent directory (with a trailing separator to append system defaults)
- Gives TeX the same path resolution it would have if running in the file's directory, while keeping all output in the temp dir

## CSS Styling

- make4ht generates class names for TeX formatting (various font size, weight, italic, monospace classes)
- Diff viewer maps these to appropriate styles
- Section heading classes receive the same styling as markdown headings

## Invariants

- make4ht's working directory is always the temp directory — never the repository
- Only one tex-preview temp directory is alive at a time
- Server startup always cleans orphan tex-preview temp directories
- KaTeX rendering failure falls back to displaying escaped source, never silently drops math
- Sentinel comments are always inserted and always removed — never leak into final HTML
- Scroll sync works via structural anchors, not text matching — robust against KaTeX reformatting
- Compilation never triggered per-keystroke — only on save