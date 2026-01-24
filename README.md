# AI Coder / DeCoder (AC⚡DC)

AC⚡DC is a fast, lightweight AI code editor designed for speed over autonomy. It helps you write, edit, and refactor code through natural language conversations, proposing precise changes using a search/replace workflow.

## Philosophy: Speed Over Agency

AC⚡DC intentionally avoids agentic behavior. No automatic tool use, no shell command execution, no multi-step autonomous workflows. This keeps the feedback loop tight and the token costs low.

**The recommended AI coding workflow:**

1. **Sprint with AC⚡DC** — Use AC⚡DC for rapid iteration: writing features, refactoring, adding tests. The streamlined UI and non-agentic approach means fast responses and low cost.

2. **Hit a bug wall** — Eventually you'll encounter a stubborn bug, complex integration issue, or something requiring deeper tool enabled debugging.

3. **Punch through with an agent** — Switch to an agentic AI coder (Claude Code, Aider, Cursor Agent, etc.) that can run commands, inspect outputs, and iterate autonomously to solve the hard problem.

4. **Return to AC⚡DC** — Once unstuck, switch back to AC⚡DC for continued fast development.

This hybrid approach gives you the best of both worlds: speed for 90% of coding tasks, and autonomous problem-solving when you need it.

## Features

- **Natural Language Code Editing** - Describe changes in plain English and get precise code modifications
- **Visual Diff Viewer** - Monaco-based side-by-side diff editor to review and edit AI-proposed changes before saving
- **Intelligent Context Management** - Automatic repo map generation to help the AI understand your codebase structure
- **File Selection** - Pick specific files to include in context, with git status indicators (modified/staged/untracked)
- **Image Support** - Paste screenshots or diagrams directly into the chat for visual context
- **Streaming Responses** - Real-time streaming of AI responses with stop capability
- **Token Usage Tracking** - Monitor context window usage with detailed token breakdowns
- **Git Integration** - Stage files, view diffs, auto-generate commit messages, and commit directly from the UI
- **Conversation History** - Automatic summarization when history gets too large

## Tech Stack

### Backend (Python)

- **[LiteLLM](https://github.com/BerriAI/litellm)** - Universal LLM API that supports 100+ models (OpenAI, Anthropic, AWS Bedrock, etc.)
- **[Aider](https://github.com/Aider-AI/aider)** - Side-loaded for battle-tested search/replace parsing, repo map generation, and token counting (not used as a CLI, just the core libraries)
- **[JRPC-OO](https://github.com/flatmax/jrpc-oo)** - WebSocket-based JSON-RPC for real-time client-server communication
- **[GitPython](https://github.com/gitpython-developers/GitPython)** - Git repository operations

### Frontend (JavaScript)

- **[Lit](https://lit.dev/)** - Fast, lightweight web components
- **[Monaco Editor](https://microsoft.github.io/monaco-editor/)** - VS Code's editor for diff viewing
- **[JRPC-OO](https://github.com/flatmax/jrpc-oo)** - WebSocket client matching the Python server
- **[Marked](https://marked.js.org/)** - Markdown parsing for chat messages
- **[Prism.js](https://prismjs.com/)** - Syntax highlighting in code blocks

## Install

```bash
uv venv && source .venv/bin/activate
uv pip install -e .
cd webapp && npm i
```

## Configuration

Create or edit `ac/llm.json` to configure your LLM provider:

```json
{
  "env": {
    "OPENAI_API_KEY": "sk-..."
  },
  "model": "gpt-4o",
  "smallerModel": "gpt-4o-mini"
}
```

For AWS Bedrock:
```json
{
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "true",
    "AWS_REGION": "us-east-1"
  },
  "model": "anthropic.claude-sonnet-4-20250514-v1:0",
  "smallerModel": "anthropic.claude-haiku-4-5-20251001-v1:0"
}
```

## Run

```bash
python ac/dc.py
```

Options:
- `--server-port PORT` - JRPC WebSocket server port (default: 18080)
- `--webapp-port PORT` - Webapp dev server port (default: 18999)
- `--no-browser` - Don't auto-open browser
- `--repo-path PATH` - Path to git repository (default: current directory)

## How It Works

1. **Select Files** - Use the file picker to choose which files to include in the AI's context
2. **Describe Changes** - Type your request in natural language (e.g., "add error handling to the save function")
3. **Review Diffs** - AI responses with code changes appear in the diff viewer for review
4. **Edit & Save** - Modify the proposed changes if needed, then save to disk
5. **Commit** - Use the built-in commit button to stage all changes and generate a commit message
