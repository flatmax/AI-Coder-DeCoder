# Prompt System

## Overview

Covers how system prompts, skill prompts, and prompt snippets are loaded, assembled, and injected into LLM requests.

## System Prompt

### Assembly

The system prompt is assembled from two files:

1. **Main prompt** (`system.md`) — defines the LLM's role, symbol map navigation, edit protocol, workflow, and examples
2. **Extra prompt** (`system_extra.md`, optional) — additional project-specific instructions

Concatenated with `\n\n` separator. The extra prompt file may not exist.

### Content Structure

The main prompt covers:

1. **Role** — Expert coding agent with symbol map navigation
2. **Symbol Map** — How to read the compact notation (references, imports, kind prefixes). Rules for inherited methods, excluded files, requesting files before editing
3. **Edit Protocol** — The EDIT/REPL block format with critical rules about fencing, exact matching, context in both sections, sizing, and dependency merging
4. **Workflow** — Query → Search Map → Trace dependencies → Request files → Read → Edit. Pre-edit checklist. Never-edit-unseen-files rule
5. **Examples** — Modify, insert, create file, edit files containing backticks
6. **Failure Recovery** — Steps for retrying failed edits

### Injection

The system prompt is the first content in the L0 block, which is the **system role message** (not a user/assistant pair). It is followed by the symbol map legend, L0 symbols, and L0 files — all concatenated into the same system message.

## System Reminder

A compact mechanical reference for the edit block format, defined as a code constant (not loaded from file). **Not currently injected** into the streaming message assembly — exists as infrastructure for potential mid-conversation reinforcement if the LLM drifts from the edit format.

## Commit Message Prompt

A separate system prompt used only for auto-generating git commit messages. Defined inline (not from file).

Content:
- Role: Expert software engineer for commit messages
- Format: conventional commit style with type, subject, body
- Rules: imperative mood, length limits
- Output: commit message only, no commentary

## Skill Prompts

Markdown files loaded lazily by subsystems. Currently:

### Compaction Skill

Loaded by the topic detector for history compaction LLM calls. Contains instructions for identifying topic boundaries and producing structured JSON output. See [History and Compaction](history_and_compaction.md).

## Prompt Snippets

Predefined messages shown as quick-insert buttons in the UI. Not part of the LLM system prompt — they insert text into the user's input field.

### Schema

```pseudo
Snippet:
    icon: string       // Emoji for the button
    tooltip: string?   // Hover text (falls back to message preview)
    message: string    // Text inserted when clicked
```

### Loading

Two-location fallback:
1. Repo-local config (per-project customization)
2. Application default config

Each snippet must have at least `icon` and `message`.

## Prompt Assembly Headers

Constants used when building the message array (see [Streaming Chat](streaming_chat.md) for full assembly order):

| Constant | Value |
|----------|-------|
| `REPO_MAP_HEADER` | `# Repository Structure\n\nBelow is a map of the repository showing classes, functions, and their relationships.\nUse this to understand the codebase structure and find relevant code.\n\n` |
| `FILE_TREE_HEADER` | `# Repository Files\n\nComplete list of files in the repository:\n\n` |
| `URL_CONTEXT_HEADER` | `# URL Context\n\nThe following content was fetched from URLs mentioned in the conversation:\n\n` |
| `FILES_ACTIVE_HEADER` | `# Working Files\n\nHere are the files:\n\n` |
| L1 files header | `# Reference Files\n\nThese files are included for reference:\n\n` |
| L2 files header | `# Reference Files (L2)\n\nThese files are included for reference:\n\n` |
| L3 files header | `# Reference Files (L3)\n\nThese files are included for reference:\n\n` |
| L0 files header | `# Reference Files (Stable)\n\nThese files are included for reference:\n\n` |
| Tier symbols header | `# Repository Structure (continued)\n\n` |

File content is formatted as fenced code blocks with **no language tags** — just triple backticks. Files joined with `\n\n`.

### Default Snippets

| Icon | Purpose |
|------|---------|
| ✂️ | Continue a truncated edit |
| 🔍 | Remind AI to check context |
| ✏️ | Correct malformed edit blocks |
| ⏸️ | Pause before implementation |
| ✅ | Verify test coverage |
| 📦 | Pre-commit checklist |
| 🏁 | Pre-commit with plan completion |

### UI Integration

Snippet buttons are rendered in a toggleable drawer near the input area. Clicking inserts at cursor position and auto-resizes the textarea. Drawer closes on outside click or Escape.
