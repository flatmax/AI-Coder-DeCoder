# AI Coder / DeCoder (AC⚡DC)

AC⚡DC is a fast, lightweight AI code editor designed for speed over autonomy. It helps you write, edit, and refactor code through natural language conversations, applying precise edits using an anchored EDIT/REPLACE block format.

This project follows in the spirit of [Aider](https://github.com/Aider-AI/aider).

## Philosophy: Speed Over Agency

AC⚡DC intentionally avoids agentic behavior. No automatic tool use, no shell command execution, no multi-step autonomous workflows. This keeps the feedback loop tight and the token costs low.

## Features

- **Natural Language Code Editing** — Describe changes in plain English and get precise code modifications
- **Visual Diff Viewer** — Monaco-based side-by-side diff editor to review and edit AI-proposed changes before saving
- **Symbol Map Navigation** — Tree-sitter based code indexing generates a compact symbol map showing classes, functions, imports, and cross-file references
- **Tiered Context Caching** — Automatically promotes frequently-used files through stability tiers for optimal prompt caching
- **File Selection** — Pick specific files to include in context, with git status indicators
- **Image Support** — Paste screenshots or diagrams directly into the chat for visual context
- **Streaming Responses** — Real-time streaming of AI responses with stop capability
- **Token Usage Tracking** — Monitor context window usage with detailed token breakdowns
- **Git Integration** — Stage files, view diffs, auto-generate commit messages, and commit directly from the UI
- **Conversation History** — Persistent history with search, session browsing, and automatic compaction when context grows too large
- **Find in Files** — Search across the codebase with regex support and context preview
- **URL Context** — Paste URLs to fetch web pages, GitHub repos, or documentation — content is automatically extracted, cached, and optionally summarized
- **Prompt Snippets** — Save and reuse common prompts via configurable snippets
- **Voice Input** — Speech-to-text for hands-free prompt dictation

---

## Quick Start

### Installation

Download the pre-built executable for your platform from the [Releases](https://github.com/flatmax/AI-Coder-DeCoder/releases) page:

- **Linux:** `ac-dc-linux`
- **macOS:** `ac-dc-macos`
- **Windows:** `ac-dc-windows.exe`

Make it executable (Linux/macOS):
```bash
chmod +x ac-dc-linux  # or ac-dc-macos
```

### Running

Navigate to your git repository and run:

```bash
./ac-dc-linux  # or ./ac-dc-macos or ac-dc-windows.exe
```

This starts the backend server and opens the webapp in your browser.

---

## Configuration

AC⚡DC uses configuration files stored in `~/.config/ac-dc/` (Linux/macOS) or `%APPDATA%/ac-dc/` (Windows). On first run, default configs are created automatically.

### LLM Configuration (litellm_config.json)

Configures which LLM provider and model to use. AC⚡DC uses [LiteLLM](https://github.com/BerriAI/litellm) under the hood, supporting 100+ providers.

#### Examples

**Anthropic:**
```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-..."
  },
  "model": "claude-sonnet-4-20250514",
  "smallerModel": "claude-haiku-4-5-20251001"
}
```

**OpenAI:**
```json
{
  "env": {
    "OPENAI_API_KEY": "sk-..."
  },
  "model": "gpt-4o",
  "smallerModel": "gpt-4o-mini"
}
```

**Local LLM (Ollama):**
```json
{
  "env": {
    "OLLAMA_API_BASE": "http://localhost:11434"
  },
  "model": "ollama/qwen3-coder-next",
  "smallerModel": "ollama/qwen3-coder-next"
}
```

**Local LLM (OpenAI-compatible server — LM Studio, llama.cpp, vLLM, etc.):**
```json
{
  "env": {
    "OPENAI_API_KEY": "not-needed",
    "OPENAI_API_BASE": "http://localhost:1234/v1"
  },
  "model": "openai/local-model",
  "smallerModel": "openai/local-model"
}
```

**AWS Bedrock:**
```json
{
  "env": {
    "AWS_REGION": "us-east-1"
  },
  "model": "anthropic.claude-sonnet-4-20250514-v1:0",
  "smallerModel": "anthropic.claude-haiku-4-5-20251001-v1:0"
}
```

**Azure OpenAI:**
```json
{
  "env": {
    "AZURE_API_KEY": "...",
    "AZURE_API_BASE": "https://your-resource.openai.azure.com",
    "AZURE_API_VERSION": "2024-02-15-preview"
  },
  "model": "azure/your-deployment-name",
  "smallerModel": "azure/your-smaller-deployment"
}
```

**Google Vertex AI:**
```json
{
  "env": {
    "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/service-account.json",
    "VERTEXAI_PROJECT": "your-project-id",
    "VERTEXAI_LOCATION": "us-central1"
  },
  "model": "vertex_ai/gemini-1.5-pro",
  "smallerModel": "vertex_ai/gemini-1.5-flash"
}
```

#### Configuration Reference

| Field | Required | Description |
|-------|----------|-------------|
| `env` | Yes | Environment variables for your LLM provider |
| `model` | Yes | Primary model for code generation |
| `smallerModel` | Yes | Faster/cheaper model for summaries and commit messages |
| `cacheMinTokens` | No | Minimum tokens for prompt caching (default: 1024) |
| `cacheBufferMultiplier` | No | Buffer multiplier for cache allocation (default: 1.5) |

For all supported providers, see the [LiteLLM Provider Documentation](https://docs.litellm.ai/docs/providers).

### Application Configuration (app_config.json)

```json
{
  "url_cache": {
    "path": "/tmp/ac_url_cache",
    "ttl_hours": 24
  },
  "history_compaction": {
    "enabled": true,
    "compaction_trigger_tokens": 12000,
    "verbatim_window_tokens": 3000,
    "summary_budget_tokens": 500,
    "min_verbatim_exchanges": 2
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `url_cache.path` | `/tmp/ac_url_cache` | Directory for caching fetched URL content |
| `url_cache.ttl_hours` | `24` | How long cached URLs remain valid |
| `history_compaction.enabled` | `true` | Enable automatic history compaction |
| `history_compaction.compaction_trigger_tokens` | `12000` | Token threshold to trigger compaction |
| `history_compaction.verbatim_window_tokens` | `3000` | Tokens to keep verbatim (recent messages) |
| `history_compaction.summary_budget_tokens` | `500` | Max tokens for the summary |
| `history_compaction.min_verbatim_exchanges` | `2` | Minimum recent exchanges to preserve |

---

## Workflow

1. **Describe Your Task** — Type your request in natural language
2. **AI Navigates the Codebase** — The AI uses the symbol map to find relevant files and may ask you to add specific files to the context
3. **Add Requested Files** — Click on file references in the AI's response or use the file picker
4. **Review Diffs** — Code changes appear in the diff viewer for review
5. **Edit & Save** — Modify the proposed changes if needed, then save to disk
6. **Commit** — Stage changes and auto-generate a commit message from the UI

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in input |
| `Escape` | Close snippets / clear input |
| `↑` at start | Open message history search |
| `↓` at end | Restore input from before history search |
| `Ctrl+S` / `Cmd+S` | Save active file (in diff viewer) |
| `Ctrl+W` / `Cmd+W` | Close active tab (in diff viewer) |
| `Alt+1..5` | Switch tabs (Files, Search, Context, Cache, Settings) |
| `Alt+M` | Toggle minimize/maximize dialog |

---

## Development

### Prerequisites

- Python 3.12+
- Node.js 18+

### Setup

```bash
git clone https://github.com/flatmax/AI-Coder-DeCoder.git
cd AI-Coder-DeCoder

# Python
python -m venv .venv && source .venv/bin/activate
pip install -e .

# Webapp
cd webapp && npm install && cd ..
```

### Run Modes

| Mode | Command | Description |
|------|---------|-------------|
| **Standard** | `ac-dc` | Uses hosted webapp |
| **Dev** | `ac-dc --dev` | Local Vite dev server with HMR |
| **Preview** | `ac-dc --preview` | Production bundle served locally |

### Command Line Options

| Option | Default | Description |
|--------|---------|-------------|
| `--server-port` | 18080 | JRPC WebSocket server port |
| `--webapp-port` | 18999 | Local webapp port (dev/preview modes) |
| `--no-browser` | false | Don't auto-open browser |
| `--repo-path` | cwd | Path to git repository |
| `--dev` | false | Run with local Vite dev server |
| `--preview` | false | Build and serve production bundle locally |

### Tests

```bash
pytest                          # all tests
pytest tests/test_edit_parser.py  # specific file
pytest --cov=src/ac_dc          # with coverage
```

### Tech Stack

**Backend (Python):** [LiteLLM](https://github.com/BerriAI/litellm) · [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) · [JRPC-OO](https://github.com/flatmax/jrpc-oo)

**Frontend (JavaScript):** [Lit](https://lit.dev/) · [Monaco Editor](https://microsoft.github.io/monaco-editor/) · [JRPC-OO](https://github.com/flatmax/jrpc-oo) · [Marked](https://marked.js.org/) · [highlight.js](https://highlightjs.org/)

### Project Structure

```
src/ac_dc/                  # Python backend
├── llm_service.py          # LLM integration, streaming chat
├── context.py              # Context management (tokens, files, history)
├── context_builder.py      # Tiered prompt assembly with cache control
├── stability_tracker.py    # File stability tracking for cache tiers
├── edit_parser.py          # EDIT/REPLACE block parsing and application
├── repo.py                 # Git operations (file tree, commits, diffs)
├── history_store.py        # Persistent conversation history
├── history_compactor.py    # Automatic history summarization
├── topic_detector.py       # Topic boundary detection for compaction
├── url_handler.py          # URL fetching, extraction, summarization
├── url_cache.py            # URL content caching
├── token_counter.py        # Token counting utilities
├── config.py               # Configuration management
├── settings.py             # Settings RPC interface
├── main.py                 # Entry point and server setup
└── symbol_index/           # Tree-sitter based code indexing
    ├── index.py            # Main indexer orchestration
    ├── compact_format.py   # Symbol map formatting
    ├── reference_index.py  # Cross-file reference tracking
    ├── import_resolver.py  # Import path resolution
    ├── parser.py           # Tree-sitter parser management
    ├── cache.py            # Parse result caching
    ├── models.py           # Data models (Symbol, Import, etc.)
    └── extractors/         # Language-specific extractors
        ├── python_ext.py
        ├── javascript_ext.py
        └── c_ext.py

webapp/                     # JavaScript frontend (Lit web components)
├── src/
│   ├── app-shell.js        # Main application shell
│   ├── rpc-mixin.js        # Shared RPC client mixin
│   ├── chat/
│   │   ├── files-tab.js    # Main chat + file management tab
│   │   ├── chat-panel.js   # Chat message display
│   │   ├── chat-input.js   # Message input with history
│   │   ├── diff-viewer.js  # Monaco diff editor
│   │   ├── file-picker.js  # File selection tree
│   │   ├── search-tab.js   # Find in files
│   │   ├── context-tab.js  # Token usage breakdown
│   │   ├── cache-tab.js    # Cache tier viewer
│   │   ├── settings-tab.js # Configuration editor
│   │   ├── history-browser.js # Session history browser
│   │   ├── url-chips.js    # URL context chips
│   │   ├── token-hud.js    # Token usage HUD
│   │   └── toast-container.js # Notifications
│   ├── dialog/
│   │   └── ac-dialog.js    # Main dialog container
│   ├── prompt/
│   │   └── SpeechToText.js # Voice input
│   └── utils/
│       ├── edit-blocks.js  # Edit block parsing & diffing
│       └── markdown.js     # Markdown rendering
└── vite.config.js

tests/                      # Unit tests
```

## License

MIT