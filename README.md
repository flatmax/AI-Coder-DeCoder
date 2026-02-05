# AI Coder / DeCoder (AC⚡DC)

AC⚡DC is a fast, lightweight AI code editor designed for speed over autonomy. It helps you write, edit, and refactor code through natural language conversations, applying precise edits using an anchored EDIT/REPL block format.

This project follows in the spirit of [Aider](https://github.com/Aider-AI/aider).

## Philosophy: Speed Over Agency

AC⚡DC intentionally avoids agentic behavior. No automatic tool use, no shell command execution, no multi-step autonomous workflows. This keeps the feedback loop tight and the token costs low.

**The recommended AI coding workflow:**

1. **Sprint with AC⚡DC** — Use AC⚡DC for rapid iteration: writing features, refactoring, adding tests. The streamlined UI and non-agentic approach means fast responses and low cost.

2. **Hit a wall** — Eventually you'll encounter a stubborn bug, complex integration issue, or something requiring deeper debugging with tool access.

3. **Punch through with an agent** — Switch to an agentic AI coder (Claude Code, Cursor, etc.) that can run commands, inspect outputs, and iterate autonomously to solve the hard problem.

4. **Return to AC⚡DC** — Once unstuck, switch back to AC⚡DC for continued fast development.

This hybrid approach gives you the best of both worlds: speed for 90% of coding tasks, and autonomous problem-solving when you need it.

## Features

- **Natural Language Code Editing** — Describe changes in plain English and get precise code modifications
- **Visual Diff Viewer** — Monaco-based side-by-side diff editor to review and edit AI-proposed changes before saving
- **Symbol Map Navigation** — Tree-sitter based code indexing generates a compact symbol map showing classes, functions, imports, and cross-file references
- **File Selection** — Pick specific files to include in context, with git status indicators (modified/staged/untracked)
- **Image Support** — Paste screenshots or diagrams directly into the chat for visual context
- **Streaming Responses** — Real-time streaming of AI responses with stop capability
- **Token Usage Tracking** — Monitor context window usage with detailed token breakdowns and automatic prompt caching optimization
- **Git Integration** — Stage files, view diffs, auto-generate commit messages, and commit directly from the UI
- **Conversation History** — Persistent history with search, session browsing, and automatic compaction when context grows too large (summarizes old messages to stay within token limits)
- **Find in Files** — Search across the codebase with regex support and context preview
- **URL Context** — Paste URLs to fetch web pages, GitHub repos, or documentation. Content is automatically extracted, cached, and optionally summarized for context
- **Prompt Snippets** — Save and reuse common prompts via `config/prompt-snippets.json`
- **Voice Input** — Speech-to-text for hands-free prompt dictation with continuous auto-transcribe mode

---

# End User Guide

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

### Running AC⚡DC

Navigate to your git repository and run:

```bash
./ac-dc-linux  # or ./ac-dc-macos or ac-dc-windows.exe
```

This starts the backend server and opens the webapp in your browser.

## Configuration

AC⚡DC uses two main configuration files stored in `~/.config/ac-dc/` (Linux/macOS) or `%APPDATA%/ac-dc/` (Windows). On first run, default configs are created automatically.

### LLM Configuration (litellm.json)

This file configures which LLM provider and model to use. AC⚡DC uses [LiteLLM](https://github.com/BerriAI/litellm) under the hood, which supports 100+ LLM providers.

The configuration has two sections:

1. **`env`** — Environment variables required by your chosen provider (API keys, regions, etc.)
2. **Model settings** — Which models to use

#### Configuration Examples

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

**Anthropic (Direct API):**
```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-..."
  },
  "model": "claude-sonnet-4-20250514",
  "smallerModel": "claude-haiku-4-5-20251001"
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
> AWS Bedrock uses your default AWS credentials from `~/.aws/credentials` or environment variables.

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
| `env` | Yes | Object containing environment variables for your LLM provider |
| `model` | Yes | Primary model for code generation (use best available) |
| `smallerModel` | Yes | Faster/cheaper model for summaries and commit messages |
| `cacheMinTokens` | No | Minimum tokens for prompt caching (default: 1024) |
| `cacheBufferMultiplier` | No | Buffer multiplier for cache allocation (default: 1.5) |

For a complete list of supported providers and their required environment variables, see the [LiteLLM Provider Documentation](https://docs.litellm.ai/docs/providers).

### Application Configuration (app.json)

General application settings:

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
| `url_cache.ttl_hours` | `24` | How long cached URLs remain valid (hours) |
| `history_compaction.enabled` | `true` | Enable automatic history compaction |
| `history_compaction.compaction_trigger_tokens` | `12000` | Token threshold to trigger compaction |
| `history_compaction.verbatim_window_tokens` | `3000` | Tokens to keep verbatim (recent messages) |
| `history_compaction.summary_budget_tokens` | `500` | Max tokens for the summary |
| `history_compaction.min_verbatim_exchanges` | `2` | Minimum recent exchanges to preserve |

## Workflow

1. **Describe Your Task** — Type your request in natural language (e.g., "add error handling to the save function")
2. **AI Navigates the Codebase** — The AI uses the symbol map to find relevant files and may ask you to add specific files to the context
3. **Add Requested Files** — Click on file references in the AI's response or use the file picker to add them
4. **Review Diffs** — AI responses with code changes appear in the diff viewer for review
5. **Edit & Save** — Modify the proposed changes if needed, then save to disk
6. **Commit** — Use the 💾 Commit button to stage all changes and auto-generate a commit message

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in input |
| `↑` / `↓` | Navigate message history (when cursor at start/end) |
| `Ctrl+Shift+F` | Open Find in Files |
| `Ctrl+B` | Toggle back to file picker |
| `Ctrl+S` | Save current file (in diff viewer) |

---

# Developer Guide

This section is for developers who want to contribute to AC⚡DC or run it from source.

## Tech Stack

### Backend (Python)

- **[LiteLLM](https://github.com/BerriAI/litellm)** — Universal LLM API supporting 100+ models
- **[Tree-sitter](https://tree-sitter.github.io/tree-sitter/)** — Fast, accurate parsing for symbol extraction
- **[JRPC-OO](https://github.com/flatmax/jrpc-oo)** — WebSocket-based JSON-RPC for real-time communication
- **[GitPython](https://github.com/gitpython-developers/GitPython)** — Git repository operations

### Frontend (JavaScript)

- **[Lit](https://lit.dev/)** — Fast, lightweight web components
- **[Monaco Editor](https://microsoft.github.io/monaco-editor/)** — VS Code's editor for diff viewing
- **[JRPC-OO](https://github.com/flatmax/jrpc-oo)** — WebSocket client matching the Python server
- **[Marked](https://marked.js.org/)** — Markdown parsing for chat messages
- **[Prism.js](https://prismjs.com/)** — Syntax highlighting in code blocks

## Development Setup

### Prerequisites

- Python 3.12+
- Node.js 18+

### Installation

```bash
# Clone the repository
git clone https://github.com/flatmax/AI-Coder-DeCoder.git
cd AI-Coder-DeCoder

# Create virtual environment and install Python dependencies
python -m venv .venv && source .venv/bin/activate
pip install -e .

# Install webapp dependencies
cd webapp && npm install && cd ..
```

### Development Configuration

When running from source, configuration files are read from the repository's `config/` directory (not the user config directory). This allows you to:

- Edit configs and see changes immediately
- Commit config changes to git
- Test different configurations easily

### Run Modes

| Mode | Command | Description |
|------|---------|-------------|
| **Standard** | `ac-dc` | Uses hosted webapp at GitHub Pages |
| **Dev** | `python ac/dc.py --dev` | Local Vite dev server with hot module reloading |
| **Preview** | `python ac/dc.py --preview` | Builds and serves production bundle locally |

For frontend development, use `--dev` mode for instant feedback on changes.

### Command Line Options

| Option | Default | Description |
|--------|---------|-------------|
| `--server-port` | 18080 | JRPC WebSocket server port |
| `--webapp-port` | 18999 | Local webapp port (dev/preview modes only) |
| `--no-browser` | false | Don't auto-open browser |
| `--repo-path` | cwd | Path to git repository |
| `--dev` | false | Run with local Vite dev server |
| `--preview` | false | Build and serve production bundle locally |

### Running Tests

```bash
# Run all tests
pytest

# Run specific test file
pytest tests/test_edit_parser.py

# Run with coverage
pytest --cov=ac
```

## Project Structure

```
config/                 # Configuration files (used in dev mode)
├── litellm.json       # LLM provider configuration
├── app.json           # Application settings
├── prompt-snippets.json # User prompt snippets
└── prompts/           # System prompts and skills
    ├── system.md      # Main system prompt
    ├── system_extra.md # Optional extra prompt content
    └── skills/        # Skill-specific prompts
        └── compaction.md # History compaction skill

ac/                     # Python backend
├── dc.py              # Main entry point
├── llm/               # LLM integration (LiteLLM wrapper, streaming, chat)
├── repo/              # Git operations (file tree, commits, diffs)
├── context/           # Context management (tokens, files, history)
├── symbol_index/      # Tree-sitter based code indexing
├── edit_parser.py     # EDIT/REPL block parsing and application
├── history/           # Persistent conversation history
└── prompts/           # System prompt loading

webapp/                 # JavaScript frontend (Lit web components)
├── src/
│   ├── app-shell/     # Main application shell
│   ├── prompt/        # Chat interface components
│   ├── diff-viewer/   # Monaco diff editor
│   ├── file-picker/   # File selection tree
│   ├── find-in-files/ # Search interface
│   └── history-browser/ # Conversation history UI
└── vite.config.js     # Build configuration

tests/                  # Unit tests
tests_skills/           # Integration tests requiring LLM access
```

## License

MIT
