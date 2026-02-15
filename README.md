# AC⚡DC — AI-assisted Code editing tool, De-Coder
 
AC⚡DC is an AI pair-programming tool that runs as a terminal application with a browser-based UI. It helps developers navigate codebases, chat with LLMs, and apply structured file edits — all with intelligent prompt caching to minimize costs.

This project follows in the spirit of [Aider](https://github.com/Aider-AI/aider).

https://github.com/user-attachments/assets/63e442cf-6d3a-4cbc-a96d-20fe8c4964c8

## Features

- **Chat with any LLM** supported by [LiteLLM](https://docs.litellm.ai/) — Claude, GPT, DeepSeek, Bedrock, local models, and more.
- **Structured code edits** with anchor-based matching, validation, and automatic git staging.
- **Side-by-side diff viewer** — Monaco editor with hover, go-to-definition, references, and completions.
- **File picker** with git status badges, diff stats, context menu, and keyboard navigation.
- **Code review mode** — select a commit, soft reset, and discuss changes with the LLM.
- **URL detection and fetching** — paste a link and AC⚡DC fetches, summarizes, and caches the content. Works with GitHub repos too.
- **Image paste support** — drop screenshots into chat with persistent storage across sessions.
- **Voice dictation** via Web Speech API.
- **Configurable prompt snippets** for common actions.
- **Full-text search** across the repo with regex, whole-word, and case-insensitive modes.
- **Session history browser** — search, revisit, and reload past conversations.
- **Tree-sitter symbol index** across Python, JavaScript/TypeScript, and C/C++ with cross-file references.
- **Four-tier prompt cache** (L0–L3 + active) with automatic promotion, demotion, and cascade rebalancing.
- **History compaction** with LLM-powered topic boundary detection to keep long sessions within context limits.
- **Token HUD** with per-request and session-total usage reporting.

## Philosophy

- **Symbol map, not full files** — A compact, reference-annotated map of your codebase gives the LLM structural context without burning tokens on full file contents.
- **Stability-based caching** — Content that stays unchanged across requests promotes to higher cache tiers, aligning with provider cache breakpoints (e.g., Anthropic's ephemeral caching). You pay to ingest once; subsequent requests hit cache.
- **Deterministic edits** — The LLM proposes changes using anchored edit blocks with exact context matching. No fuzzy patching, no guessing.
- **Git-native** — Every applied edit is staged automatically. Commit messages are LLM-generated. The file picker shows git status natively.
- **Bidirectional RPC** — Terminal and browser are symmetric peers over WebSocket (JSON-RPC 2.0). Either side can call the other.

## Workflow

1. **Start** — Run `ac-dc` in your git repo. Browser opens automatically.
2. **Select files** — Check files in the picker to add their full content to context.
3. **Chat** — Ask the LLM to understand, modify, or create code.
4. **Review edits** — Applied edits appear in the diff viewer with two-level highlighting.
5. **Commit** — Click 💾 to stage all, generate an LLM commit message, and commit.
6. **Iterate** — File context and cache tiers evolve as you work.

### Code Review

https://github.com/user-attachments/assets/0e853df6-2d84-4c58-8ea8-95251c4e6822

1. Click the review button in the header bar.
2. Select a commit in the git graph to set the review base.
3. Click **Start Review** — the repo enters review mode (soft reset).
4. Select files to include their reverse diffs in context.
5. Chat with the LLM about the changes.
6. Click **Exit Review** to restore the branch.

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
| `Alt+5` | Global | Settings tab |
| `Alt+M` | Global | Toggle minimize dialog |
| `↑/↓` | Search results | Navigate matches |
| `Enter` | Search results | Open match in diff viewer |
| `Space/Enter` | File picker | Toggle file selection |
| `↑/↓` | File picker | Navigate tree |

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

## Configuration

All configuration lives in `src/ac_dc/config/` (bundled defaults) or `{repo_root}/.ac-dc/` (per-repo overrides).

| File | Purpose | Format |
|------|---------|--------|
| `llm.json` | Provider, model, env vars, cache tuning | JSON |
| `app.json` | URL cache, history compaction settings | JSON |
| `system.md` | Main LLM system prompt | Markdown |
| `system_extra.md` | Additional project-specific instructions | Markdown |
| `snippets.json` | Quick-insert prompt buttons | JSON |
| `compaction.md` | History compaction skill prompt | Markdown |
| `review.md` | Code review system prompt | Markdown |
| `review-snippets.json` | Review mode snippet buttons | JSON |

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

**Frontend (JavaScript):**

| Package | Purpose |
|---------|---------|
| [Lit](https://lit.dev/) | Web component framework |
| [@flatmax/jrpc-oo](https://github.com/flatmax/jrpc-oo) | Browser-side JSON-RPC client |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | Side-by-side diff editor |
| [Marked](https://marked.js.org/) | Markdown rendering |
| [highlight.js](https://highlightjs.org/) | Syntax highlighting |
| [diff](https://github.com/kpdecker/jsdiff) | Myers diff algorithm for edit block display |

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
    config.py                    # Configuration loading and management
    context.py                   # Context manager, file context, prompt assembly
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
        compaction.md
        llm.json
        review-snippets.json
        review.md
        snippets.json
        system.md
        system_extra.md
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
    test_config.py
    test_context.py
    test_edit_parser.py
    test_history.py
    test_llm_service.py
    test_main.py
    test_repo.py
    test_stability_tracker.py
    test_symbol_index.py
    test_url_handler.py
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
            ac-files-tab.js      # Files & chat split panel
            ac-history-browser.js # Session browser modal
            ac-search-tab.js     # Full-text search
            ac-settings-tab.js   # Configuration editor
            chat-panel.js        # Chat messages, streaming, input
            diff-viewer.js       # Monaco diff editor
            file-picker.js       # File tree with git status
            input-history.js     # Input history overlay
            review-selector.js   # Git graph for code review
            speech-to-text.js    # Voice dictation
            token-hud.js         # Floating token usage overlay
            url-chips.js         # URL detection and fetch chips
```

## License

MIT