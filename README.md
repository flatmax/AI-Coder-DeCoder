# AC⚡DC — AI-assisted Code editing tool, De-Coder
 
AC⚡DC is an AI pair-programming tool that runs as a terminal application with a browser-based UI. It helps developers navigate codebases, chat with LLMs, and apply structured file edits — all with intelligent prompt caching to minimize costs.

<img width="2868" height="1601" alt="AC⚡DC screenshot" src="https://github.com/user-attachments/assets/87cd02ef-64e6-4f68-9abb-9a140e804178" />

</details>

## Features

- **Chat with any LLM** supported by [LiteLLM](https://docs.litellm.ai/) — Claude, GPT, DeepSeek, Bedrock, local models, and more.
- **Structured code edits** with anchor-based matching, validation, and automatic git staging.
- **Side-by-side diff viewer** — Monaco editor with hover, go-to-definition, references, and completions.
- **SVG viewer & editor** — pan/zoom SVG files with inline editing: drag elements, reshape paths and curves, resize shapes, edit text in place, copy/paste/duplicate objects, and a full-width presentation mode (F11).
- **File picker** with git status badges, diff stats, context menu, and keyboard navigation.
- **Code review mode** — select a commit, soft reset, and discuss changes with the LLM.
- **URL detection and fetching** — paste a link and AC⚡DC fetches, summarizes, and caches the content. Works with GitHub repos too.
- **Image paste support** — drop screenshots into chat with persistent storage across sessions.
- **Document convert** — convert `.docx`, `.pdf`, `.pptx`, `.xlsx`, `.csv`, `.rtf`, `.odt`, `.odp` to markdown from a dedicated dialog tab. PDFs and presentations extract text into markdown and export pages with images/vector graphics as SVGs. Requires a clean git working tree so all results appear as reviewable diffs. Install `pip install ac-dc[docs]` for conversion support. The full PDF/presentation pipeline also requires [LibreOffice](https://www.libreoffice.org/) (`soffice` on PATH) for format conversion and [PyMuPDF](https://pymupdf.readthedocs.io/) (`pip install pymupdf`) for page extraction — without them, `.pptx` falls back to python-pptx (basic SVG export) and `.pdf` conversion is unavailable.
- **Collaboration mode** — multiple browsers can connect to one backend over LAN. The host is auto-admitted; subsequent connections require explicit approval via an in-browser toast. Non-localhost participants get a read-only view (browse files, view diffs, watch streaming) while the host retains full control. Enable with `--collab`.
- **Voice dictation** via Web Speech API.
- **Math rendering** — LaTeX expressions in LLM responses render as formatted math via KaTeX (`$$...$$` for display blocks, `$...$` for inline).
- **Configurable prompt snippets** for common actions.
- **Full-text search** with a two-panel layout — file picker (left) showing matching files with match counts, and a match context panel (right) with highlighted results and bidirectional scroll sync. Supports regex, whole-word, and case-insensitive modes.
- **Session history browser** — search, revisit, and reload past conversations.
- **2D file navigation grid** — open files arrange spatially in a grid overlay. Navigate with `Alt+Arrow` keys for fast directional switching between files without reaching for tabs.
- **Tree-sitter symbol index** across Python, JavaScript/TypeScript, and C/C++ with cross-file references.
- **Document mode** — toggle to a documentation-focused context where markdown and SVG outlines replace code symbols. Keyword-enriched headings and cross-reference graphs help the LLM navigate doc-heavy repos. A cross-reference toggle lets the LLM see document outlines alongside the symbol map in code mode (and vice versa), so it can trace connections between code and documentation without a full mode switch. Install `pip install ac-dc[docs]` for keyword extraction and document conversion support (optional — document mode works without it).
- **Copy diff to clipboard** — click 📋▾ in the header to copy the working diff, or pick any local/remote branch from a fuzzy-searchable dropdown to copy the diff between your working tree and that branch.
- **Four-tier prompt cache** (L0–L3 + active) with automatic promotion, demotion, and cascade rebalancing.
- **History compaction** with LLM-powered topic boundary detection to keep long sessions within context limits.
- **Token HUD** with per-request and session-total usage reporting.

## Philosophy

- **Structural maps, not full files** — The LLM gets compact, reference-annotated maps instead of raw file contents:
  - **Code mode** — A tree-sitter symbol map of functions, classes, imports, and cross-file references gives the LLM codebase structure without burning tokens on full source files.
  - **Document mode** — Keyword-enriched outlines of markdown and SVG files with cross-reference graphs replace code symbols, helping the LLM navigate doc-heavy repos.
  - **Code mode + doc index** — A cross-reference toggle layers document outlines alongside the symbol map, so the LLM can trace how documentation references code without switching modes.
  - **Document mode + symbol map** — The same toggle adds symbol maps to document context, so the LLM can follow code dependencies mentioned in documentation.
- **Stability-based caching** — Content that stays unchanged across requests promotes to higher cache tiers, aligning with provider cache breakpoints (e.g., Anthropic's ephemeral caching). You pay to ingest once; subsequent requests hit cache.
- **Deterministic edits** — The LLM proposes changes using anchored edit blocks with exact context matching. No fuzzy patching, no guessing.
- **Visual SVG editing** — SVG files open in a dedicated viewer with pan/zoom and a structural editor. Select, drag, reshape, and duplicate elements directly — no external tools needed.
- **Git-native** — Every applied edit is staged automatically. Commit messages are LLM-generated. The file picker shows git status natively.
- **Team peer collaboration** — Collaboration mode lets multiple developers connect to one backend over LAN, working together in the same codebase context. The team sees the same streaming responses, file changes, and diffs in real time — pair programming scales beyond two people.
- **Bidirectional RPC** — Terminal and browser are symmetric peers over WebSocket (JSON-RPC 2.0). Either side can call the other.

## Workflow

1. **Start** — Run `ac-dc` in your git repo. Browser opens automatically.
2. **Chat** — Ask the LLM to understand, modify, or create code. The symbol map gives it enough structure to identify which files are relevant.
3. **Add files** — When the LLM references files, click the file mentions in the chat to add them to context. You can also manually check files in the picker.
4. **Review edits** — Applied edits appear in the diff viewer with two-level highlighting. SVG files open in a dedicated viewer with pan/zoom and inline editing.
5. **Commit** — Click 💾 to stage all, generate an LLM commit message, and commit.
6. **Iterate** — File context and cache tiers evolve as you work.

### Code Review

1. Click the review button in the header bar.
2. Select a commit in the git graph to set the review base.
3. Click **Start Review** — the repo enters review mode (soft reset).
4. Select files to include their reverse diffs in context.
5. Chat with the LLM about the changes.
6. Click **Exit Review** to restore the branch.

### SVG Viewer & Editor

SVG files (`.svg`) open in a dedicated viewer instead of the Monaco diff editor. The viewer provides:

- **Pan & zoom** — scroll wheel to zoom (centered on cursor), middle-click drag to pan.
- **Side-by-side view** — original (left) and current (right) panels synchronized for zoom and pan.
- **Edit mode** — switch to the editor to modify SVG elements directly:
  - **Select** — click any element to select it. A bounding box or control-point handles appear depending on the element type.
  - **Drag** — move any selected element (rects, circles, text, groups, paths, lines, etc.).
  - **Reshape paths** — for `<path>` elements (lines, curves, arcs), draggable handles appear at every endpoint (blue circles) and control point (orange diamonds), with guide lines showing the curve structure. Drag any handle to reshape the path.
  - **Resize shapes** — `<rect>`, `<circle>`, and `<ellipse>` elements show corner/edge handles for resizing.
  - **Line endpoints** — `<line>`, `<polyline>`, and `<polygon>` elements show vertex handles for individual point dragging.
  - **Edit text** — double-click a `<text>` element to edit its content inline. Enter commits, Escape cancels.
  - **Copy/paste** — `Ctrl+C` copies, `Ctrl+V` pastes with an offset, `Ctrl+D` duplicates in place.
  - **Delete** — `Delete` or `Backspace` removes the selected element.
- **Undo** — revert to previous states.
- **Save** — `Ctrl+S` or the save button writes changes back to disk.

## Quick Start

Download the latest standalone binary for your platform from the [GitHub Releases](https://github.com/flatmax/AI-Coder-DeCoder/releases) page:

| Platform | Binary |
|----------|--------|
| Linux | `ac-dc-linux` |
| macOS (ARM) | `ac-dc-macos` |
| Windows | `ac-dc-windows.exe` |

Then run it inside any git repository:

```bash
cd /path/to/your/project
./ac-dc-linux
```

AC⚡DC opens your browser and connects via WebSocket. The terminal stays running as the backend.

> **Note:** The standalone binary includes full document mode support (heading outlines, cross-references, cache tiering), but keyword-enriched headings require the Python `keybert` package which is not bundled. If you want keyword extraction for better disambiguation of repetitive document structures, [run from source](#running-from-source) and install with `pip install ac-dc[docs]`.

### Provider Configuration

On first run, AC⚡DC creates a `.ac-dc/` directory in your repo. Edit `.ac-dc/llm.json` with your provider credentials:

**AWS Bedrock:**
```json
{
  "env": { "AWS_REGION": "us-east-1" },
  "model": "bedrock/anthropic.claude-sonnet-4-20250514",
  "smallerModel": "bedrock/anthropic.claude-haiku-4-5-20251001-v1:0"
}
```

**Anthropic direct:**
```json
{
  "env": { "ANTHROPIC_API_KEY": "sk-ant-..." },
  "model": "anthropic/claude-sonnet-4-20250514",
  "smallerModel": "anthropic/claude-haiku-4-5-20251001-v1:0"
}
```

**OpenAI:**
```json
{
  "env": { "OPENAI_API_KEY": "sk-..." },
  "model": "openai/gpt-4o",
  "smallerModel": "openai/gpt-4o-mini"
}
```

**Local (Ollama):**
```json
{
  "env": {},
  "model": "ollama/llama3",
  "smallerModel": "ollama/llama3"
}
```

Any model supported by [LiteLLM](https://docs.litellm.ai/docs/providers) works. You can also edit the configuration from the Settings tab inside the browser UI.

## Keyboard Shortcuts

| Shortcut | Context | Action |
|----------|---------|--------|
| `Enter` | Chat input | Send message |
| `Shift+Enter` | Chat input | New line |
| `↑` | Chat input (empty) | Open input history |
| `Escape` | Chat input | Clear @-filter → close snippets → clear input |
| `@text` | Chat input | Filter file picker |
| `Ctrl+S` | Diff viewer / Settings | Save file |
| `Ctrl+Shift+F` | Global | Open search tab with selection |
| `Alt+1` | Global | Files & Chat tab |
| `Alt+2` | Global | Search tab |
| `Alt+3` | Global | Context Budget tab |
| `Alt+4` | Global | Cache Tiers tab |
| `Alt+5` | Global | Doc Convert tab |
| `Alt+6` | Global | Settings tab |
| `Alt+M` | Global | Toggle minimize dialog |
| `↑/↓` | Search results | Navigate matches |
| `Enter` | Search results | Open match in diff viewer |
| `Space/Enter` | File picker | Toggle file selection |
| `↑/↓` | File picker | Navigate tree |
| `Alt+←` | Global | Navigate file grid left |
| `Alt+→` | Global | Navigate file grid right |
| `Alt+↑` | Global | Navigate file grid up |
| `Alt+↓` | Global | Navigate file grid down |
| `Scroll wheel` | SVG viewer | Zoom in/out (centered on cursor) |
| `Middle-drag` | SVG viewer | Pan the viewport |
| `Click` | SVG editor | Select element (shows handles) |
| `Drag` | SVG editor | Move selected element |
| `Drag handle` | SVG editor | Move endpoint, vertex, or control point |
| `Double-click` | SVG editor (text) | Edit text inline |
| `Enter` | SVG editor (text) | Commit text edit |
| `Ctrl+C` | SVG editor | Copy selected element |
| `Ctrl+V` | SVG editor | Paste with offset |
| `Ctrl+D` | SVG editor | Duplicate in place |
| `Delete` | SVG editor | Delete selected element |
| `Escape` | SVG editor | Deselect / cancel text edit |
| `F11` | SVG viewer | Toggle presentation mode (full-width editor) |
| `Escape` | SVG viewer (present) | Exit presentation mode |

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--server-port` | `18080` | RPC WebSocket port |
| `--webapp-port` | `18999` | Webapp dev/preview port |
| `--no-browser` | `false` | Don't auto-open browser |
| `--repo-path` | `.` | Git repository path |
| `--dev` | `false` | Run local Vite dev server |
| `--preview` | `false` | Build and preview locally |
| `--verbose` | `false` | Enable debug logging |
| `--collab` | `false` | Enable collaboration mode (LAN-accessible, multi-browser) |

## Configuration

All configuration lives in `src/ac_dc/config/` (bundled defaults) or `{repo_root}/.ac-dc/` (per-repo overrides).

| File | Purpose | Format |
|------|---------|--------|
| `llm.json` | Provider, model, env vars, cache tuning | JSON |
| `app.json` | URL cache, history compaction settings | JSON |
| `system.md` | Main LLM system prompt | Markdown |
| `system_extra.md` | Additional project-specific instructions | Markdown |
| `system_doc.md` | Document mode system prompt | Markdown |
| `snippets.json` | Quick-insert prompt buttons (code, review, and doc modes) | JSON |
| `doc_convert` | Doc convert settings (extensions, size limits) | JSON (in `app.json`) |
| `compaction.md` | History compaction skill prompt | Markdown |
| `review.md` | Code review system prompt | Markdown |
| `commit.md` | Commit message generation prompt | Markdown |
| `system_reminder.md` | Edit block reminder injected before each user message | Markdown |

### Collaboration Mode

Collaboration is disabled by default. Enable it with `--collab`:

```bash
ac-dc --collab
```

When enabled:
- The WebSocket server binds to `0.0.0.0` (all network interfaces) instead of `127.0.0.1`.
- The first browser connection is auto-admitted as the **host**.
- Subsequent connections from other machines are held pending until an admitted user clicks **Admit** in a toast prompt.
- **Localhost clients** (including the host) have full control: chat, edit files, commit, switch modes.
- **Non-localhost participants** get a read-only view: browse files, view diffs, watch streaming responses, search, and read history — but cannot send prompts, change file selection, or perform git operations.
- All broadcast events (streaming chunks, file changes, commit results, mode switches, session loads) reach every admitted client automatically.

A connected-users indicator (`👥 N`) appears in the dialog header when multiple clients are connected. Share the URL shown in the collab popover with collaborators on your LAN.

### LLM Config Fields

| Field | Default | Description |
|-------|---------|-------------|
| `env` | `{}` | Environment variables (API keys, regions) |
| `model` | — | Primary LLM model identifier |
| `smallerModel` | — | Cheaper model for summaries and commit messages |
| `cache_min_tokens` | `1024` | Minimum tokens for cache tier targeting |
| `cache_buffer_multiplier` | `1.5` | Multiplier for cache target (`1024 × 1.5 = 1536`) |

### App Config Fields

| Field | Default | Description |
|-------|---------|-------------|
| `url_cache.path` | `/tmp/ac-dc-url-cache` | URL content cache directory |
| `url_cache.ttl_hours` | `24` | Cache expiry in hours |
| `history_compaction.enabled` | `true` | Enable automatic history compaction |
| `history_compaction.compaction_trigger_tokens` | `24000` | Token threshold to trigger compaction |
| `history_compaction.verbatim_window_tokens` | `4000` | Recent tokens kept verbatim |
| `history_compaction.summary_budget_tokens` | `500` | Max tokens for compaction summary |
| `history_compaction.min_verbatim_exchanges` | `2` | Minimum recent exchanges always kept |
| `doc_index.keyword_model` | `BAAI/bge-small-en-v1.5` | KeyBERT model for keyword extraction |
| `doc_index.keywords_enabled` | `true` | Enable keyword enrichment |
| `doc_index.keywords_top_n` | `3` | Keywords per section |
| `doc_index.keywords_ngram_range` | `[1, 2]` | N-gram range for keyword extraction |
| `doc_index.keywords_min_section_chars` | `50` | Minimum section length for keyword extraction |
| `doc_index.keywords_min_score` | `0.3` | Minimum keyword relevance score |
| `doc_index.keywords_diversity` | `0.5` | Keyword diversity (MMR) |
| `doc_index.keywords_tfidf_fallback_chars` | `150` | Fallback to TF-IDF below this section length |
| `doc_index.keywords_max_doc_freq` | `0.6` | Maximum document frequency threshold |
| `doc_convert.enabled` | `true` | Enable/disable document conversion |
| `doc_convert.extensions` | All supported | File extensions to show for conversion |
| `doc_convert.max_source_size_mb` | `50` | Skip source files larger than this |

All configs are editable from the Settings tab in the browser UI with hot-reload support.

---

## Running from Source

If you prefer running from a clone instead of the standalone binary:

```bash
git clone https://github.com/flatmax/AI-Coder-DeCoder.git
cd AI-Coder-DeCoder
pip install -e .
```

Then run inside any git repo:

```bash
cd /path/to/your/project
ac-dc
```

The webapp is served from [GitHub Pages](https://flatmax.github.io/AI-Coder-DeCoder/) — no local build step needed.

To develop or build the webapp locally, also install Node.js dependencies:

```bash
npm install
```

---

## Development

### Prerequisites

- Python ≥ 3.10
- Node.js ≥ 18 (for webapp development)

### Setup

```bash
git clone https://github.com/flatmax/AI-Coder-DeCoder.git
cd AI-Coder-DeCoder

# Install Python dependencies (with dev extras)
pip install -e ".[dev]"

# Optional: install document mode extras (KeyBERT keywords + document conversion)
pip install -e ".[docs]"

# Install webapp dependencies
npm install
```

### Run in Dev Mode

```bash
ac-dc --dev
```

This starts both the Python RPC server and a Vite dev server with hot module replacement.

### Run Tests

```bash
pytest
```

### Build Webapp

```bash
npm run build
```

### Tech Stack

**Backend (Python):**

| Package | Purpose |
|---------|---------|
| [jrpc-oo](https://github.com/flatmax/jrpc-oo) | Bidirectional JSON-RPC 2.0 over WebSocket |
| [LiteLLM](https://docs.litellm.ai/) | Universal LLM provider interface (100+ providers) |
| [tiktoken](https://github.com/openai/tiktoken) | Model-aware token counting |
| [Tree-sitter](https://tree-sitter.github.io/) | AST parsing for symbol extraction (Python, JS/TS, C/C++) |
| [trafilatura](https://trafilatura.readthedocs.io/) | Web page content extraction |
| [boto3](https://boto3.amazonaws.com/v1/documentation/api/latest/) | AWS Bedrock support |
| [markitdown](https://github.com/microsoft/markitdown) | Document-to-markdown conversion (`.docx`, `.pdf`, `.xlsx`, `.csv`, `.rtf`, `.odt`, `.odp`) |
| [PyMuPDF](https://pymupdf.readthedocs.io/) | PDF text extraction and per-page SVG export |
| [python-pptx](https://python-pptx.readthedocs.io/) | PowerPoint per-slide SVG export (fallback when LibreOffice unavailable) |

**Frontend (JavaScript):**

| Package | Purpose |
|---------|---------|
| [Lit](https://lit.dev/) | Web component framework |
| [@flatmax/jrpc-oo](https://github.com/flatmax/jrpc-oo) | Browser-side JSON-RPC client |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | Side-by-side diff editor |
| [Marked](https://marked.js.org/) | Markdown rendering |
| [highlight.js](https://highlightjs.org/) | Syntax highlighting |
| [KaTeX](https://katex.org/) | LaTeX math rendering (`$$...$$` display, `$...$` inline) |
| [diff](https://github.com/kpdecker/jsdiff) | Myers diff algorithm for edit block display |

**System dependencies (optional):**

| Tool | Purpose |
|------|---------|
| [LibreOffice](https://www.libreoffice.org/) | Headless conversion of `.pptx`, `.odp` → PDF for the full PDF pipeline (`soffice` must be on PATH). Not needed for `.docx`, `.xlsx`, `.csv`, `.rtf`, `.odt` (handled by markitdown) or `.pdf` (handled directly by PyMuPDF). Without LibreOffice, `.pptx` falls back to python-pptx for basic SVG export. |

**Build & Deploy:**

| Tool | Purpose |
|------|---------|
| [Vite](https://vitejs.dev/) | Webapp bundler and dev server |
| [PyInstaller](https://pyinstaller.org/) | Standalone binary packaging |
| GitHub Actions | CI/CD for releases and GitHub Pages deployment |

## Project Structure

```
.github/workflows/
    deploy-pages.yml
    release.yml
specs3/                          # Specification documents
    1-foundation/
    2-code-analysis/
    3-llm-engine/
    4-features/
    5-webapp/
    6-deployment/
src/ac_dc/
    __init__.py
    __main__.py                  # Entry point for `python -m ac_dc`
    base_cache.py                # Shared mtime-based in-memory cache base class
    collab.py                    # Collaboration mode — multi-browser admission, client registry, RPC restrictions
    config.py                    # Configuration loading and management
    context.py                   # Context manager, file context, prompt assembly
    doc_convert.py               # Document-to-markdown conversion (docx, pdf, pptx, etc.)
    edit_parser.py               # Edit block parsing, validation, application
    history_compactor.py         # History truncation and summarization
    history_store.py             # JSONL persistent history
    llm_service.py               # LLM streaming, context orchestration, review mode
    main.py                      # CLI entry point, server startup
    repo.py                      # Git operations, file I/O, search
    settings.py                  # Config read/write/reload RPC service
    stability_tracker.py         # Cache tier N-value tracking and cascade
    token_counter.py             # Model-aware token counting
    topic_detector.py            # LLM-based topic boundary detection
    url_cache.py                 # Filesystem TTL cache for URLs
    url_handler.py               # URL detection, fetching, summarization
    config/                      # Default configuration files
        app.json
        commit.md               # Commit message generation prompt
        compaction.md
        llm.json
        review.md
        snippets.json            # Prompt buttons for code, review, and doc modes
        system.md
        system_doc.md            # Document mode system prompt
        system_extra.md
        system_reminder.md       # Edit block reminder before each user message
    doc_index/
        __init__.py
        cache.py                 # mtime-based document cache
        formatter.py             # Compact outline text output
        index.py                 # Orchestrator, repo-wide indexing
        keyword_enricher.py      # Optional KeyBERT keyword extraction
        reference_index.py       # Cross-file doc/code reference graph
        extractors/
            __init__.py
            base.py              # Base extractor class
            markdown_extractor.py
            svg_extractor.py
    symbol_index/
        __init__.py
        cache.py                 # mtime-based symbol cache
        compact_format.py        # LLM-optimized text output
        index.py                 # Orchestrator, LSP queries
        parser.py                # Tree-sitter multi-language parser
        reference_index.py       # Cross-file reference tracking
        import_resolver.py       # Import-to-file resolution
        extractors/
            __init__.py
            base.py              # Base extractor class
            python_extractor.py
            javascript_extractor.py
            c_extractor.py
tests/
    sample.svg                   # Test SVG for doc index extraction tests
    test_config.py
    test_context.py
    test_doc_convert.py          # Document conversion, provenance headers, status detection
    test_doc_index.py            # Document index, extractors, cache, formatter
    test_edit_parser.py
    test_history.py
    test_llm_service.py
    test_main.py
    test_repo.py
    test_stability_tracker.py
    test_symbol_index.py
    test_url_handler.py
    test_history_browser.js      # Node.js tests for history browser utilities
vite.config.js                   # Vite bundler configuration
webapp/
    index.html
    src/
        app-shell.js             # Root component, WebSocket, event routing
        rpc-mixin.js             # Shared RPC access for child components
        shared-rpc.js            # Singleton call proxy
        styles/
            theme.js             # Design tokens and shared styles
        utils/
            edit-blocks.js       # Edit block segmentation and diffing
            markdown.js          # Markdown rendering with syntax highlighting
        components/
            ac-cache-tab.js      # Cache tier viewer
            ac-context-tab.js    # Context budget viewer
            ac-dialog.js         # Main dialog container with tabs
            ac-doc-convert-tab.js # Document conversion UI
            ac-files-tab.js      # Files & chat split panel
            ac-history-browser.js # Session browser modal
            ac-search-tab.js     # Full-text search
            ac-settings-tab.js   # Configuration editor
            chat-panel.js        # Chat messages, streaming, input
            diff-viewer.js       # Monaco diff editor
            svg-viewer.js        # SVG pan/zoom viewer with side-by-side
            svg-editor.js        # SVG element editor (drag, resize, path editing)
            file-picker.js       # File tree with git status
            input-history.js     # Input history overlay
            review-selector.js   # Git graph for code review
            speech-to-text.js    # Voice dictation
            token-hud.js         # Floating token usage overlay
            url-chips.js         # URL detection and fetch chips
            url-content-dialog.js # URL content viewer modal
            file-nav.js          # 2D spatial file navigation grid and HUD overlay
```

## License

MIT