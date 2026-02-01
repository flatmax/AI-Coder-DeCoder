# AI Coder / DeCoder (AC⚡DC)

> ⚠️ **Alpha Software** — AC⚡DC is in active development. Expect rough edges, breaking changes, and incomplete features. Currently optimized for **Anthropic models via AWS Bedrock**. Other LLM setups should work but are not tested.

AC⚡DC is a fast, lightweight AI code editor designed for speed over autonomy. It helps you write, edit, and refactor code through natural language conversations, applying precise edits using an anchored EDIT/REPL block format.

## Philosophy: Speed Over Agency

AC⚡DC intentionally avoids agentic behavior. No automatic tool use, no shell command execution, no multi-step autonomous workflows. This keeps the feedback loop tight and the token costs low.

**The recommended AI coding workflow:**

1. **Sprint with AC⚡DC** — Use AC⚡DC for rapid iteration: writing features, refactoring, adding tests. The streamlined UI and non-agentic approach means fast responses and low cost.

2. **Hit a wall** — Eventually you'll encounter a stubborn bug, complex integration issue, or something requiring deeper debugging with tool access.

3. **Punch through with an agent** — Switch to an agentic AI coder (Claude Code, Aider, Cursor Agent, etc.) that can run commands, inspect outputs, and iterate autonomously to solve the hard problem.

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
- **Conversation History** — Persistent history with search, session browsing, and automatic summarization when context grows too large
- **Find in Files** — Search across the codebase with regex support and context preview
- **Voice Input** — Speech-to-text for hands-free prompt dictation with continuous auto-transcribe mode

## Tech Stack

### Backend (Python)

- **[LiteLLM](https://github.com/BerriAI/litellm)** — Universal LLM API supporting 100+ models (OpenAI, Anthropic, AWS Bedrock, etc.)
- **[Tree-sitter](https://tree-sitter.github.io/tree-sitter/)** — Fast, accurate parsing for symbol extraction across Python, JavaScript, and TypeScript
- **[JRPC-OO](https://github.com/flatmax/jrpc-oo)** — WebSocket-based JSON-RPC for real-time client-server communication
- **[GitPython](https://github.com/gitpython-developers/GitPython)** — Git repository operations

### Frontend (JavaScript)

- **[Lit](https://lit.dev/)** — Fast, lightweight web components
- **[Monaco Editor](https://microsoft.github.io/monaco-editor/)** — VS Code's editor for diff viewing with LSP-like features
- **[JRPC-OO](https://github.com/flatmax/jrpc-oo)** — WebSocket client matching the Python server
- **[Marked](https://marked.js.org/)** — Markdown parsing for chat messages
- **[Prism.js](https://prismjs.com/)** — Syntax highlighting in code blocks

## Installation

### Prerequisites

- Python 3.12+

### Setup

```bash
# Clone the repository
git clone https://github.com/flatmax/AI-Coder-DeCoder.git
cd AI-Coder-DeCoder

# Install directly with pip
pip install -e .

# Or use a virtual environment (recommended)
python -m venv .venv && source .venv/bin/activate
uv pip install -e .
```

That's it! The webapp is hosted on GitHub Pages and loads automatically.

### Developer Setup

If you want to modify the webapp frontend:

```bash
# Additional prerequisites: Node.js 18+

# Install webapp dependencies
cd webapp && npm install
```

Then run with `--dev` for hot-reloading during development.

## Configuration

Create or edit `config/llm.json` to configure your LLM provider:

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

**AWS Bedrock :**
```json
{
  "env": {
    "AWS_REGION": "us-east-1"
  },
  "model": "anthropic.claude-sonnet-4-20250514-v1:0",
  "smallerModel": "anthropic.claude-haiku-4-5-20251001-v1:0"
}
```

> **Note:** AC⚡DC is currently optimized for Anthropic models on AWS Bedrock, which provides prompt caching for significant cost savings. Other providers should work via LiteLLM but may have reduced functionality or higher costs.

See [LiteLLM's provider documentation](https://docs.litellm.ai/docs/providers) for other providers.

### Application Configuration (config/app.json)

Create or modify `config/app.json` in **your project's repository root** (not the AC⚡DC installation directory) to configure application settings:

> ⚠️ **Important:** The `url_cache.path` defaults to `/tmp/ac-dc_url_cache`. You may want to change this to a persistent location, especially on systems that clear `/tmp` on reboot.

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

> **Note:** The JSON example above shows sample values. The table shows the code defaults used when settings are omitted.

## Usage

Simply run ac-dc in your git repo you are working on.

```bash
ac-dc
```

This starts the backend server and opens the hosted webapp in your browser. The webapp connects to your local server via WebSocket.

### Run Modes

| Mode | Command | Description |
|------|---------|-------------|
| **Standard** | `ac-dc` | Uses hosted webapp at GitHub Pages. No build required. |
| **Dev** | `python ac/dc.py --dev` | Local Vite dev server with HMR. For AC⚡DC development. |
| **Preview** | `python ac/dc.py --preview` | Builds AC⚡DC and serves production bundle locally. For testing. |

### Command Line Options

| Option | Default | Description |
|--------|---------|-------------|
| `--server-port` | 18080 | JRPC WebSocket server port |
| `--webapp-port` | 18999 | Local webapp port (dev/preview modes only) |
| `--no-browser` | false | Don't auto-open browser |
| `--repo-path` | cwd | Path to git repository |

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

## Project Structure

```
config/                 # All configuration files
├── llm.json           # LLM provider configuration (model, API keys)
├── app.json           # Application settings (URL cache, etc.)
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
```

## License

MIT
