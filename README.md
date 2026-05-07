# AC⚡DC — AI-assisted Code editing tool, De-Coder
AC⚡DC is an AI pair-programming tool that runs as a terminal application with a browser-based UI. It helps developers navigate codebases, chat with LLMs, and apply structured file edits — all with intelligent prompt caching to minimize costs.
**Reimplementation in progress.** This tree is a clean-room rebuild of AC⚡DC against a new specification suite. The user-facing feature set below describes the target — individual features land layer by layer and are tracked in [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md).

## Features

- **Chat with any LLM** supported by [LiteLLM](https://docs.litellm.ai/) — Claude, GPT, DeepSeek, Bedrock, local models, and more.
- **Structured code edits** with anchor-based matching, validation, and automatic git staging.
- **Side-by-side diff viewer** — Monaco editor with hover, go-to-definition, references, and completions.
- **SVG viewer & editor** — pan/zoom SVG files with inline editing: drag elements, reshape paths and curves, resize shapes, edit text in place, copy/paste/duplicate objects, and a full-width presentation mode (F11).
- **File picker** with git status badges, diff stats, context menu, and keyboard navigation.
- **Any LLM via [LiteLLM](https://docs.litellm.ai/)** — Claude, GPT, Gemini, Bedrock, Ollama, xAI, and 100+ more providers through one unified interface.
- **Deterministic anchored edits** with emoji-delimited blocks, exact context matching, ambiguity detection, and automatic git staging. No fuzzy patching, no fenced-diff guessing.
- **Stability-based four-tier prompt cache** (L0–L3 + active) with automatic promotion, demotion, ripple cascade, and provider cache-breakpoint alignment — pay to ingest once, subsequent requests hit cache.
- **Tree-sitter symbol index** for Python, JavaScript, TypeScript, C, and C++ with cross-file reference graphs and LSP-style hover, go-to-definition, references, and completions inside the diff viewer.
- **Document index** for markdown and SVG with keyword-enriched headings, containment-aware SVG outlines, and a cross-reference graph between documents.
- **Cross-reference mode** — optional toggle that layers document outlines into code mode (and vice versa), so the LLM can trace how documentation references code without a full mode switch.
- **Monaco-powered diff viewer** with LSP integration, markdown preview, TeX preview, markdown link provider (cross-file navigation), MATLAB syntax, and cross-file go-to-definition.
- **Visual SVG editor** — click-to-select, drag-to-move, resize handles, path endpoint + control-point editing, inline text edit, marquee multi-selection, copy / paste / duplicate, undo, copy-as-PNG, and a full-width presentation mode.
- **Code review mode** — pick a commit in a live git graph, soft-reset the branch, and work through the change with reverse diffs in context.
- **Document conversion** — convert `.docx`, `.pdf`, `.pptx`, `.xlsx`, `.csv`, `.rtf`, `.odt`, `.odp` to markdown with extracted images and per-page SVG exports. PDFs use [PyMuPDF](https://pymupdf.readthedocs.io/) directly; presentations pipe through [LibreOffice](https://www.libreoffice.org/) → PDF → PyMuPDF, with python-pptx as fallback. Clean working tree required so output appears as reviewable diffs.
- **URL chips** — paste a link; AC⚡DC detects it, fetches, summarises using the cheaper auxiliary model, and caches the content with per-message inclusion toggles. GitHub repos get a shallow clone + symbol-map summary.
- **Images** — paste screenshots directly into chat; stored persistently under the per-repo working directory and re-attachable from history.
- **Voice dictation** via the Web Speech API — toggle on the input, speak, and the transcript streams into the textarea.
- **KaTeX math rendering** — display blocks via `$$...$$` and inline `$...$` inside chat messages.
- **TeX preview** — live-rendered LaTeX preview for `.tex` files via make4ht + KaTeX with bidirectional scroll sync.
- **File picker** with git status badges, diff stats, sort modes (name / mtime / size, each direction-toggleable), three-state exclusion checkboxes, context menus for every row type, inline rename / duplicate / new-file / new-directory, middle-click path insertion, `@`-filter from the chat input, active-file highlight, keyboard navigation, branch badge with detached-HEAD detection, and review-mode banner.
- **2D file navigation grid** — opened files arrange spatially in a grid overlay; `Alt+Arrow` switches direction-wise without reaching for a tab bar.
- **Full-text search** — two-panel layout with matching files (left) and line context with highlighting (right); regex, whole-word, case-sensitive modes; bidirectional scroll sync.
- **Session history browser** — full-text search across JSONL history, per-session preview, load-into-session, and load-into-panel for ad-hoc comparison.
- **History compaction** with LLM-powered topic boundary detection, a visible progress overlay, system-event messages in chat scrollback, and a live context-capacity bar showing budget pressure.
- **Token HUD** — floating overlay with per-request and session-total token usage broken down by category.
- **Copy diff to clipboard** — copy the working diff, or pick any local / remote branch from a fuzzy-searchable dropdown to copy the diff between working tree and that branch.
- **Settings tab** — edit `llm.json` and `app.json` from the browser with hot-reload support.
- **Collaboration mode** — multiple browsers connect to one backend over LAN. Host auto-admitted; subsequent clients require explicit approval. Non-localhost participants get a read-only view.
- **Symmetric bidirectional JSON-RPC** over WebSocket via [jrpc-oo](https://github.com/flatmax/jrpc-oo) — terminal and browser are peers; either side can call the other.
---
## Philosophy
- **Structural maps beat raw files.** The LLM receives compact, reference-annotated maps instead of full source text for most of the repo:
  - *Code mode* — tree-sitter symbol map of classes, methods, imports, call sites, and cross-file references
  - *Document mode* — keyword-enriched outline of markdown headings and SVG containment trees with cross-references
  - *Cross-reference mode* — both indexes overlaid, so the LLM can trace "this section mentions that function" without switching modes
- **Pay to ingest once.** Content unchanged across requests promotes through stability tiers and lands on provider cache breakpoints (e.g., Anthropic ephemeral caching). Large repos stop re-ingesting on every turn.
- **Edits are mechanical.** Anchored blocks with exact-match context. Ambiguous or missing anchors surface as structured errors with retry prompts — never silent or fuzzy.
- **Git is a first-class citizen.** Every applied edit is staged automatically. Commit messages are LLM-generated from the diff. The file picker shows git status and diff stats natively. Code review runs through soft-reset, not side branches.
- **Local is the default.** Backend binds to loopback; non-localhost access requires explicit `--collab`. All persistent state lives in the repo's `.ac-dc4/` directory (history, images, doc cache). No cloud sync, no telemetry.
- **Symmetric RPC.** Terminal and browser both implement the same jrpc-oo surface — streaming, progress events, session sync, file broadcasts all flow through one transport.
---
## Architecture
Single Python process exposes a WebSocket JSON-RPC server; the browser webapp connects and publishes its own callback interface. The process also serves the built webapp (or proxies a Vite dev server) on a separate port.
```
 ┌────────────────────────────────────────────────────────────┐
 │                     Python backend                         │
 │                                                            │
 │  Repo ─┬─ SymbolIndex ──┐                                  │
 │        │                ├─▶ LLMService ◀─▶ ContextManager  │
 │        ├─ DocIndex ─────┘          │            │          │
 │        ├─ HistoryStore             │            │          │
 │        ├─ URLService               ▼            ▼          │
 │        ├─ DocConvert         StabilityTracker  FileContext │
 │        ├─ EditPipeline         (L0/L1/L2/L3)               │
 │        ├─ Settings                                         │
 │        └─ Collab                                           │
 │                 │                                          │
 │                 ▼  jrpc-oo over WebSocket                  │
 └────────────────────────────────────────────────────────────┘
                  │
 ┌────────────────────────────────────────────────────────────┐
 │                      Browser webapp (Lit)                  │
 │                                                            │
 │  AppShell ──┬── FilesTab ──┬── FilePicker ─ ChatPanel      │
 │             │                                              │
 │             ├── ContextTab  (budget + cache sub-views)     │
 │             ├── DocConvertTab                              │
 │             ├── SettingsTab                                │
 │             │                                              │
 │             │  Viewer layer (background)                   │
 │             ├── DiffViewer  (Monaco + LSP + MD / TeX prev) │
 │             ├── SvgViewer + SvgEditor                      │
 │             │                                              │
 │             └── Overlays — TokenHUD, FileNavGrid,          │
 │                 CompactionProgress, DocIndexProgress       │
 └────────────────────────────────────────────────────────────┘
```
See [specs4/0-overview/architecture.md](specs4/0-overview/architecture.md) and the SVG diagram at [specs4/architecture.svg](specs4/architecture.svg) for the full picture.
---
## Running
### From source (uv)
```
git clone https://github.com/flatmax/AI-Coder-DeCoder.git
cd AI-Coder-DeCoder
# Install Python dependencies (with dev extras)
uv sync
# Install webapp dependencies
cd webapp && npm ci && cd ..
```
Run inside any git repository:
```
cd /path/to/your/project
# Development mode — Vite HMR for the webapp
uv run ac-dc --dev
# Preview mode — pre-built webapp served locally
uv run ac-dc --preview
```
Standalone binaries (Linux / macOS / Windows) are a deferred Layer 6 deliverable — see [specs4/6-deployment/build.md](specs4/6-deployment/build.md).
### Optional extras
Document mode works out of the box with heading outlines, SVG containment trees, and cross-references. Richer features pull extras:
```
# Document conversion (markitdown, PyMuPDF, python-pptx, openpyxl) — small
uv sync --extra docs-convert
# Keyword enrichment (KeyBERT, sentence-transformers, torch) — large (~800 MB with CUDA wheels)
uv sync --extra docs-enrich
# Both
uv sync --extra docs
```
System-level optional tools:
| Tool | Purpose |
|---|---|
| [LibreOffice](https://www.libreoffice.org/) (`soffice` on PATH) | `.pptx` / `.odp` → PDF for the document-convert pipeline. Without it, `.pptx` falls back to python-pptx (basic SVG export). |
| [make4ht](https://ctan.org/pkg/make4ht) (part of TeX Live) | Live TeX preview for `.tex` files. Without it, the preview pane shows installation instructions. |
---
## Provider Configuration
On first run, AC⚡DC creates a per-repo working directory at `.ac-dc4/` and a user-level config directory:
| Platform | Config path |
|---|---|
| Linux | `~/.config/ac-dc/` (or `$XDG_CONFIG_HOME/ac-dc/`) |
| macOS | `~/Library/Application Support/ac-dc/` |
| Windows | `%APPDATA%\ac-dc\` |
Edit `llm.json` in the user config directory to configure a provider.
**AWS Bedrock:**
```json
{
  "env": { "AWS_REGION_NAME": "us-east-1" },
  "model": "bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "smaller_model": "bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0"
}
```
**Anthropic direct:**
```json
{
  "env": { "ANTHROPIC_API_KEY": "sk-ant-..." },
  "model": "anthropic/claude-sonnet-4-5-20250929",
  "smaller_model": "anthropic/claude-haiku-4-5-20251001"
}
```
**OpenAI:**
```json
{
  "env": { "OPENAI_API_KEY": "sk-..." },
  "model": "openai/gpt-5",
  "smaller_model": "openai/gpt-5-mini"
}
```
**Local (Ollama):**
```json
{
  "env": {},
  "model": "ollama/llama3",
  "smaller_model": "ollama/llama3"
}
```
Any model supported by [LiteLLM](https://docs.litellm.ai/docs/providers) works. The `smaller_model` is used for commit-message generation, URL summarisation, and compaction topic-boundary detection. You can edit the config from the Settings tab inside the browser UI — `llm.json` and `app.json` hot-reload without a restart.
---
## Typical Workflow
1. **Start** — `uv run ac-dc --dev` (or `--preview`) inside your git repo. Browser opens automatically.
2. **Observe the startup overlay** — foundation, repository, indexing, and doc-index build in visible phases. The webapp becomes interactive as soon as the backend is reachable; indexing completes in the background.
3. **Chat** — ask the LLM to understand, modify, or create code. The symbol map tells it which files are relevant without you naming them.
4. **Add files to context** — click file mentions in the LLM response, or tick the file picker. Three states: selected (in context), unchecked (index-only), excluded (crossed out — omitted from both context and index).
5. **Review edits** — applied edits appear in the diff viewer with per-line and per-character highlighting. Status badges show pending / applied / failed / ambiguous.
6. **Commit** — use the header git controls. The smaller model drafts a conventional-commit message from the staged diff.
7. **Iterate** — cache tiers evolve as you work; stability promotions reduce re-ingestion cost. The Token HUD shows per-request and session totals.
### Code review sub-workflow
1. Click the review button in the header.
2. Select a commit in the git graph to set the review base.
3. Click **Start Review** — the repo enters review mode (soft reset).
4. Select files to include their reverse diffs in context.
5. Chat with the LLM about the changes. Edits are blocked during review.
6. Click **Exit Review** to restore the branch tip.
---
## Feature Tour
### Chat + edit protocol
Messages render as markdown with syntax highlighting (highlight.js) and KaTeX math. Responses stream chunk-by-chunk; edit blocks appear as inline diff cards with status badges.
Edit blocks use a three-marker format — a filename line, an "edit" marker, the original text, a "replace" marker, the new text, and an "end" marker. The exact marker glyphs and contract are documented in [specs4/3-llm/edit-protocol.md](specs4/3-llm/edit-protocol.md) and [specs-reference/3-llm/edit-protocol.md](specs-reference/3-llm/edit-protocol.md) (this README avoids reproducing them inline because the chat-panel parser would interpret them as real edit blocks).
Failures come with structured retry prompts:
- **Ambiguous anchor** — matched multiple locations; chat panel auto-populates a retry prompt asking for more context
- **Anchor not found** — whitespace or partial-match diagnostics
- **Not in context** — file wasn't in file-context; auto-added and staged
### Symbol index (code mode)
Tree-sitter builds a compact symbol map across the repo. Map legend covers abbreviations — `c` class, `m` method, `f` function, `i` import, `i→` local import, `←N` incoming refs, `→` outgoing calls, `?` optional param, `@1/` path alias. The LLM gets this map for files that aren't actively selected; selected files get full content.
Supported languages: Python, JavaScript, TypeScript (plain + TSX), C, C++.
LSP-style hover / go-to-definition / references / completions are exposed from the backend and wired into the Monaco diff editor. Cross-file go-to-definition opens the target in the diff viewer automatically.
### Document index (document mode)
Markdown files produce a heading tree annotated with content-type markers (tables, code blocks, inline math) and section line counts. SVG files produce containment-aware outlines — nested shapes form a tree, labels come from `aria-label` / Inkscape labels / contained text, with spatial clustering as a fallback for shape-less diagrams.
Keyword enrichment (optional — requires `docs-enrich` extras) runs KeyBERT with a TF-IDF fallback for short sections, boosting heading disambiguation for repetitive structures.
Cross-references resolve markdown `[text](path.md#heading)` links and image references, producing a reference graph that feeds cache-tier initialisation.
Runtime toggle — code mode, document mode, or cross-reference mode (both indexes layered). No restart needed.
### Cache tiering
Content is tracked across categories (files, code symbols, doc outlines, URL context, history, system prompt) and flows through four stability tiers:
- **Active** — just-added or recently changed; no promotion threshold
- **L3 → L0** — increasing stability, aligned with provider cache breakpoints
Content unchanged across N consecutive requests promotes; edited content demotes and ripples downward. Cache targets are model-aware (Opus / Haiku 4.5+ require higher minimums per Anthropic's docs). A manual rebuild rebalances tiers using the reference graph.
See [specs4/3-llm/cache-tiering.md](specs4/3-llm/cache-tiering.md).
### History + compaction
JSONL persistent history per-repo. Sessions are auto-saved and auto-restored on startup. The session browser supports full-text search across all sessions.
Compaction fires when history exceeds a configurable token threshold (default 24 000). An auxiliary LLM call detects topic boundaries:
- **Truncate case** — clear boundary found; drop everything before it
- **Summarise case** — no clear boundary; summarise the older half into a short block, keep the verbatim window
A capacity bar in the dialog footer shows live budget pressure (green / amber / red). Compaction progress appears as a floating overlay with elapsed-time counter. Successful compactions append a system-event message to the chat scrollback.
### Diff viewer
Single-file, refetch-on-every-click, no caching. Monaco-based side-by-side diff editor with:
- LSP integration (hover / definition / references / completions)
- Markdown preview with bidirectional scroll sync
- TeX preview (make4ht + KaTeX) with bidirectional scroll sync
- Markdown link provider — Ctrl+click internal links to navigate
- MATLAB syntax highlighting
- Cross-file go-to-definition — navigates to the target in the same viewer
- Load-panel — push any file content or commit diff into either side for ad-hoc comparison
### SVG viewer & editor
SVG files open in a dedicated viewer. Pan via middle-click-drag, zoom via scroll wheel (cursor-centred), side-by-side layout with synchronised viewports across both panes.
The editor on the right pane supports:
- **Select** — click any element; bounding box or control-point handles appear
- **Drag** — move any selected element (rects, circles, text, groups, paths, lines)
- **Reshape paths** — draggable endpoint handles (blue circles) and control-point handles (orange diamonds) with guide lines
- **Resize** — corner / edge handles on rects, circles, ellipses
- **Line endpoints** — vertex handles on lines, polylines, polygons
- **Inline text edit** — double-click a `<text>` element; Enter commits, Escape cancels
- **Multi-selection** — shift-click or marquee-drag
- **Copy / paste / duplicate** — Ctrl+C / Ctrl+V / Ctrl+D
- **Delete** — Delete or Backspace
- **Undo** — per-editor undo stack
- **Copy as PNG** — rasterise at native resolution into the clipboard
- **Presentation mode** — full-width single pane via F11
### TeX preview
Live preview for `.tex` files via make4ht + KaTeX. Compiles on save (or debounced during typing), strips alt-text artefacts, renders math through KaTeX, injects source-line anchors for bidirectional scroll sync. Images and relative paths resolve through the repo. Graceful degradation when make4ht is missing — the pane shows installation instructions.
### File picker
Full keyboard navigation with a deep feature set:
- **Git status badges** per file, **diff stats** (`+adds / -dels`), **line-count colouring**
- **Branch badge** on the root node with detached-HEAD detection and SHA tooltip
- **Sort modes** — name, mtime, size; each direction-toggleable with localStorage persistence
- **Three-state exclusion** — selected / default / excluded via shift+click or context menu
- **Active-file highlight** — picker row tracks the viewer's active file
- **Context menus** — file row: stage / unstage / discard / rename / duplicate / load-left / load-right / include / exclude / delete. Directory row: stage-all / unstage-all / rename / new-file / new-directory / exclude-all / include-all
- **Inline input** — rename / duplicate / new-file / new-directory all use in-place textboxes
- **Middle-click** — inserts the file's path at the chat-input cursor
- **`@`-filter bridge** — typing `@foo` in the chat input filters the picker in real time
- **Auto-selection** — changed files auto-ticked on first load (union, never overwrite)
- **Branch switcher** — dropdown with local + remote branches; aborts if the tree is dirty
- **Review mode banner** — amber banner above the filter bar showing branch, commit count, file count, stats
### File navigation grid
Opened files arrange spatially on a 2D grid overlay. `Alt+Arrow` navigates directionally — left / right / up / down between adjacent open files. The HUD fades in while Alt is held. Travel counts track user preferences for replacement. Click-to-teleport, right-click to close a node, clear button to reset.
### Search
Global full-text search with two synchronised panels:
- **Pruned tree** (left) — the file-picker tree filtered to matching files, with per-file match counts
- **Match overlay** (right) — line-level matches with before / after context, highlighted
Modes: regex, whole-word, case-sensitive. Bidirectional scroll sync. Enter to open a match in the diff viewer.
### Session history browser
Modal overlay listing sessions with token / message counts. Click a session to preview messages. Full-text search across all sessions surfaces individual hits. Actions per message: copy to clipboard, paste into chat input, load into diff viewer left / right panel.
### Token HUD & Context tab
**Token HUD** — floating overlay (appears post-stream, auto-hides after a configurable delay). Sections: cache tiers with per-tier content breakdown, current-request tokens, budget with category stacked bar, session totals.
**Context tab** — two sub-views:
- **Budget** — stacked bar of token usage by category (symbol map, files, history, URLs, prompt, active), with expandable per-file detail
- **Cache** — tier breakdown with per-item stability progress, fuzzy search, sort by tier / alphabetical, rebuild-cache action, click-to-view per-item prompt blocks
### Code review
Pick a commit from the interactive git graph; backend performs a soft-reset with detached-HEAD checkout. Review mode:
- Swap system prompt to the review prompt (read-only instructions for the LLM)
- Symbol map shows pre-change state; file diffs reverse (changes from new → old direction)
- Selected files contribute reverse diffs to context
- Edits are blocked; commits are blocked
- Exit restores the branch tip and original branch
### Document convert
Convert documents to markdown from a dedicated tab. Supported formats: `.docx`, `.pdf`, `.pptx`, `.xlsx`, `.csv`, `.rtf`, `.odt`, `.odp`.
- **Clean working tree required** — conversion results appear as diffs for review
- **Provenance headers** embedded in output so re-conversions detect source changes
- **Status badges** — new / current / stale / conflict / over-size / skipped
- **PDF pipeline** — PyMuPDF extracts text plus per-page SVG with embedded images externalised to sibling files
- **Presentation pipeline** — LibreOffice → PDF → PyMuPDF (primary); python-pptx fallback when LibreOffice is missing (basic SVG export)
- **Excel pipeline** — openpyxl with cell-colour clustering, symbolised via emoji markers and a colour legend
- **DOCX** — markitdown with image extraction from the underlying zip
### URL content
Paste any URL in chat; AC⚡DC detects it and shows a chip. Click the fetch button on the chip:
- **Generic URLs** — trafilatura extracts main content, summarised by the smaller model
- **GitHub repos** — shallow clone, extract README + symbol map, summary tuned for architecture
- **GitHub files** — raw file fetch
- **GitHub issues / PRs** — structured body + comments
Fetched content is cached under the OS temp directory with a TTL (default 24 h). Chips let you exclude individual URLs from the next message.
### Images & voice
- **Image paste** — drop screenshots into the chat input; stored persistently under `.ac-dc4/images/` keyed by SHA-256; auto-reconstructed on session reload; re-attachable from message history via lightbox
- **Voice dictation** — toggle the microphone in the input area; Web Speech API streams the transcript live; configurable auto-commit mode
### Collaboration
Collaboration is disabled by default. Enable with `--collab`:
```
uv run ac-dc --collab
```
When enabled:
- The WebSocket server binds to `0.0.0.0` (all network interfaces) instead of loopback
- The first browser connection is auto-admitted as the **host**
- Subsequent connections from other IPs are held pending until an admitted user clicks **Admit** in a toast
- **Localhost clients** (including the host) have full control — chat, edit, commit, switch modes
- **Non-localhost participants** get a read-only view — browse files, view diffs, watch streaming, read history. Edits, mode changes, and git operations are rejected with a `restricted` error
- All broadcast events (streaming chunks, file changes, commit results, mode switches, session loads) reach every admitted client
Connected-users indicator (`👥 N`) appears in the dialog header. Share the URL from the collab popover with LAN peers.
See [specs4/4-features/collaboration.md](specs4/4-features/collaboration.md) for the full contract.
---
## CLI Options
| Flag | Default | Description |
|---|---|---|
| `--server-port` | `18080` | RPC WebSocket starting port (probes upward if taken) |
| `--webapp-port` | `18999` | Webapp dev / preview starting port |
| `--no-browser` | off | Don't auto-open the browser |
| `--repo-path` | `.` | Git repository path |
| `--dev` | off | Run a local Vite dev server (hot reload) |
| `--preview` | off | Serve the pre-built webapp locally |
| `--verbose` | off | Debug-level logging |
| `--collab` | off | Enable collaboration mode (LAN-accessible, multi-browser) |
---
## Keyboard Shortcuts
| Shortcut | Context | Action |
|---|---|---|
| `Enter` | Chat input | Send message |
| `Shift+Enter` | Chat input | Newline |
| `Up` | Chat input (empty) | Open input history |
| `Escape` | Chat input | Clear `@`-filter → close snippets → clear input |
| `@text` | Chat input | Filter file picker live |
| `Ctrl+S` | Diff viewer / Settings / SVG editor | Save active file |
| `Ctrl+F` | Diff viewer | Monaco find widget |
| `Ctrl+Shift+F` | Global | Activate file search (captures current selection) |
| `Alt+1` .. `Alt+4` | Global | Switch tab (Files / Context / Settings / Doc-Convert) |
| `Alt+M` | Global | Toggle dialog minimize |
| `Alt+Left/Right/Up/Down` | Global | File navigation grid |
| `Scroll wheel` | SVG viewer | Zoom in / out (cursor-centred) |
| `Middle-drag` | SVG viewer | Pan |
| `F11` | SVG viewer | Toggle presentation mode |
| `Escape` | SVG viewer (presentation) | Exit presentation |
| `Click` | SVG editor | Select element |
| `Drag handle` | SVG editor | Move endpoint / vertex / control point |
| `Double-click` | SVG editor (text) | Edit text inline |
| `Ctrl+C` / `Ctrl+V` / `Ctrl+D` | SVG editor | Copy / paste / duplicate |
| `Delete` / `Backspace` | SVG editor | Delete selection |
| `Escape` | SVG editor | Deselect / cancel text edit |
| `Up` / `Down` / `Home` / `End` | File picker | Navigate tree |
| `Left` / `Right` | File picker | Collapse / expand / traverse |
| `Space` / `Enter` | File picker | Toggle selection / expand |
| `F2` | File picker (file row) | Rename focused file (inline input) |
| `Shift+Click` | File picker checkbox | Toggle exclusion (three-state) |
| `Middle-click` | File picker (file row) | Insert path into chat input |
---
## Configuration
Config files live in the user config directory (platform-specific, see above). A subset can be overridden per-repo under `.ac-dc4/`.
| File | Purpose | Format |
|---|---|---|
| `llm.json` | Provider, model, env vars, cache tuning | JSON |
| `app.json` | URL cache, history compaction, doc convert, doc index settings | JSON |
| `system.md` | Main LLM system prompt (code mode) | Markdown |
| `system_doc.md` | Document mode system prompt | Markdown |
| `review.md` | Code review system prompt | Markdown |
| `system_reminder.md` | Edit-format reminder prepended to each user message | Markdown |
| `system_extra.md` | Project-specific additions (user-owned, never overwritten) | Markdown |
| `compaction.md` | Topic-boundary detection prompt | Markdown |
| `commit.md` | Commit-message generation prompt | Markdown |
| `snippets.json` | Quick-insert prompt buttons for code / review / doc modes | JSON |
All of these are editable from the Settings tab in the browser UI. `llm.json` and `app.json` hot-reload on save. Prompt files re-read on every request — edits take effect on the next LLM call.
### LLM config fields
| Field | Default | Description |
|---|---|---|
| `env` | `{}` | Environment variables injected on load (API keys, regions) |
| `model` | (provider-specific) | Primary LLM model identifier |
| `smaller_model` | (provider-specific) | Cheaper model for commit messages, URL summaries, compaction |
| `max_output_tokens` | *(unset)* | User ceiling override for model output tokens |
| `cache_min_tokens` | `1024` | User-configurable minimum cacheable token count |
| `cache_buffer_multiplier` | `1.1` | Multiplier applied to the cache minimum for headroom |
### App config sections
| Section | Key fields |
|---|---|
| `url_cache` | `path`, `ttl_hours` |
| `history_compaction` | `enabled`, `compaction_trigger_tokens`, `verbatim_window_tokens`, `summary_budget_tokens`, `min_verbatim_exchanges` |
| `doc_convert` | `enabled`, `extensions`, `max_source_size_mb` |
| `doc_index` | `keyword_model`, `keywords_enabled`, `keywords_top_n`, `keywords_ngram_range`, `keywords_min_section_chars`, `keywords_min_score`, `keywords_diversity`, `keywords_tfidf_fallback_chars`, `keywords_max_doc_freq` |
Full field reference: [specs-reference/1-foundation/configuration.md](specs-reference/1-foundation/configuration.md).
---
## Per-Repo Working Directory
A `.ac-dc4/` directory is created at the repo root on first run and added to `.gitignore`:
| Entry | Contents |
|---|---|
| `history.jsonl` | Persistent conversation history (append-only) |
| `images/` | Pasted-in chat images, keyed by SHA-256 |
| `doc_cache/` | Keyword-enriched document outline cache (mtime-keyed sidecars) |
| `tex_preview/` | Transient TeX compilation working directory (cleaned on startup) |
| `snippets.json` | Optional per-repo override of quick-insert snippets |
The directory name is `.ac-dc4/` (not `.ac-dc/`) deliberately — this reimplementation coexists with the previous AC-DC on the same checkout without state collisions. See [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) decision D17.
---
## Development
### Prerequisites
- Python ≥ 3.10
- Node.js ≥ 20 (for webapp development)
- [uv](https://docs.astral.sh/uv/) recommended for Python dependency management
### Setup
```
git clone https://github.com/flatmax/AI-Coder-DeCoder.git
cd AI-Coder-DeCoder
# Python deps (dev group auto-included by uv sync)
uv sync
# Webapp deps
cd webapp && npm ci && cd ..
```
### Run dev mode
```
uv run ac-dc --dev
```
Starts the Python backend plus Vite dev server with hot module replacement.
### Run tests
```
# Python tests
uv run pytest
# Lint
uv run ruff check src tests
# Webapp tests (vitest)
cd webapp && npm test
```
### Build webapp
```
cd webapp && npm run build
```
### Tech stack
**Backend:**
| Package | Purpose |
|---|---|
| [jrpc-oo](https://github.com/flatmax/jrpc-oo) | Bidirectional JSON-RPC 2.0 over WebSocket |
| [LiteLLM](https://docs.litellm.ai/) | Universal LLM provider interface (100+ providers) |
| [tiktoken](https://github.com/openai/tiktoken) | Token counting (cl100k_base for all models) |
| [tree-sitter](https://tree-sitter.github.io/) | AST parsing for Python, JS/TS, C, C++ |
| [trafilatura](https://trafilatura.readthedocs.io/) | Web page content extraction |
| [boto3](https://boto3.amazonaws.com/v1/documentation/api/latest/) | AWS Bedrock support |
| [markitdown](https://github.com/microsoft/markitdown) (extra) | Document-to-markdown |
| [PyMuPDF](https://pymupdf.readthedocs.io/) (extra) | PDF text + SVG extraction |
| [python-pptx](https://python-pptx.readthedocs.io/) (extra) | PowerPoint fallback |
| [openpyxl](https://openpyxl.readthedocs.io/) (extra) | Excel with colour clustering |
| [KeyBERT](https://maartengr.github.io/KeyBERT/) (extra) | Keyword enrichment |
| [sentence-transformers](https://www.sbert.net/) (extra) | Embedding model for KeyBERT |
**Frontend:**
| Package | Purpose |
|---|---|
| [Lit](https://lit.dev/) | Web component framework |
| [@flatmax/jrpc-oo](https://www.npmjs.com/package/@flatmax/jrpc-oo) | Browser JSON-RPC client |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | Diff editor with LSP |
| [marked](https://marked.js.org/) | Markdown rendering |
| [highlight.js](https://highlightjs.org/) | Syntax highlighting |
| [KaTeX](https://katex.org/) | Math rendering |
| [diff](https://github.com/kpdecker/jsdiff) | Edit-block diff computation |
**Build:**
| Tool | Purpose |
|---|---|
| [Vite](https://vitejs.dev/) | Webapp bundler / dev server |
| [Vitest](https://vitest.dev/) | Webapp test runner |
| [pytest](https://pytest.org/) | Backend test runner |
| [ruff](https://docs.astral.sh/ruff/) | Backend linter |
| [PyInstaller](https://pyinstaller.org/) | Standalone binaries (Layer 6, deferred) |
---
## Repository Layout
```
AI-Coder-DeCoder/
├── src/ac_dc/                          # Python backend
│   ├── __main__.py                     # python -m ac_dc entry
│   ├── cli.py                          # argparse surface
│   ├── main.py                         # server startup orchestration
│   ├── config.py                       # configuration + upgrade logic
│   ├── repo.py                         # git operations, file I/O, search
│   ├── rpc.py                          # jrpc-oo server transport
│   ├── collab.py                       # multi-browser admission + restrictions
│   ├── settings.py                     # config read / write / reload RPC
│   ├── file_context.py                 # active file context tracking
│   ├── context_manager.py              # prompt assembly, token budget
│   ├── history_store.py                # JSONL persistent history
│   ├── history_compactor.py            # truncation + summarisation
│   ├── stability_tracker.py            # four-tier cache cascade
│   ├── token_counter.py                # tiktoken wrapper
│   ├── edit_protocol.py                # edit block parser
│   ├── edit_pipeline.py                # apply edits + git staging
│   ├── llm_service.py                  # streaming, URL, review orchestration
│   ├── doc_convert.py                  # document-to-markdown
│   ├── logging_setup.py                # structured stderr logging
│   ├── base_cache.py                   # mtime-based cache base
│   ├── base_formatter.py               # compact-map formatter base
│   ├── config/                         # bundled prompt + config defaults
│   │   ├── llm.json
│   │   ├── app.json
│   │   ├── snippets.json
│   │   ├── system.md
│   │   ├── system_doc.md
│   │   ├── review.md
│   │   ├── commit.md
│   │   ├── compaction.md
│   │   └── system_reminder.md
│   ├── doc_index/                      # markdown + SVG indexing
│   │   ├── models.py
│   │   ├── index.py
│   │   ├── cache.py
│   │   ├── formatter.py
│   │   ├── reference_index.py
│   │   ├── keyword_enricher.py
│   │   └── extractors/
│   │       ├── markdown.py
│   │       ├── svg.py
│   │       └── svg_geometry.py
│   ├── symbol_index/                   # tree-sitter code indexing
│   │   ├── models.py
│   │   ├── parser.py
│   │   ├── index.py
│   │   ├── cache.py
│   │   ├── compact_format.py
│   │   ├── reference_index.py
│   │   ├── import_resolver.py
│   │   └── extractors/
│   │       ├── python.py
│   │       ├── javascript.py
│   │       ├── typescript.py
│   │       ├── c.py
│   │       └── cpp.py
│   └── url_service/                    # URL detection + fetch + summarise
│       ├── detection.py
│       ├── cache.py
│       ├── fetchers.py
│       ├── summarizer.py
│       ├── models.py
│       └── service.py
├── webapp/                             # Lit-based browser webapp
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── app-shell.js                # root component, WebSocket, routing
│       ├── rpc.js                      # shared RPC proxy
│       ├── rpc-mixin.js                # RPC access mixin for children
│       ├── chat-panel.js               # chat messages + streaming + input
│       ├── files-tab.js                # files + chat split panel
│       ├── file-picker.js              # file tree with git status
│       ├── context-tab.js              # budget + cache sub-views
│       ├── settings-tab.js             # config editor
│       ├── doc-convert-tab.js          # document conversion UI
│       ├── diff-viewer.js              # Monaco diff editor
│       ├── svg-viewer.js               # SVG pan/zoom viewer
│       ├── svg-editor.js               # SVG element editor
│       ├── markdown-preview.js         # markdown preview pane
│       ├── tex-preview.js              # TeX preview pane
│       ├── lsp-providers.js            # Monaco LSP glue
│       ├── markdown-link-provider.js   # Ctrl+click markdown links
│       ├── monaco-setup.js             # Monaco worker config
│       ├── monaco-worker.js            # Monaco editor worker entry
│       ├── edit-blocks.js              # edit block segmentation
│       ├── edit-block-render.js        # inline diff card rendering
│       ├── markdown.js                 # chat markdown rendering
│       ├── message-search.js           # chat-local message search
│       ├── history-browser.js          # session browser modal
│       ├── input-history.js            # chat input history overlay
│       ├── speech-to-text.js           # voice dictation
│       ├── url-chips.js                # URL detection + fetch chips
│       ├── url-helpers.js              # URL helpers
│       ├── image-utils.js              # image paste + reattach
│       ├── file-mentions.js            # file-mention click handling
│       ├── file-nav.js                 # 2D navigation grid + HUD
│       ├── viewer-routing.js           # extension → viewer dispatch
│       ├── token-hud.js                # floating token overlay
│       ├── compaction-progress.js      # compaction overlay
│       ├── doc-index-progress.js       # doc-index build overlay
│       ├── commit-graph.js             # git graph for code review
│       └── main.js                     # Vite entry
├── tests/                              # Python backend tests (pytest)
├── scripts/
│   └── sync_prompts.py                 # mirror prompts into specs-reference
├── specs4/                             # Behavioural spec suite
├── specs-reference/                    # Byte-level reference twin
├── IMPLEMENTATION_NOTES.md             # Active reimplementation log
├── pyproject.toml                      # uv / pip / hatch config
└── LICENSE
```
---
## License
MIT — see [LICENSE](LICENSE).