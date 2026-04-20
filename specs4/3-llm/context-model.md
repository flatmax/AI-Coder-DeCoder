# Context Model

**Status:** stub

The context manager is the central state holder for an LLM session. It owns the conversation history, file context, system prompt, URL context, review context, and coordinates prompt assembly. It delegates stability tracking and history compaction to dedicated subsystems.

## Responsibilities

- Hold the in-memory working copy of conversation history (the mutable list used to assemble LLM requests)
- Track files included in the conversation with their contents
- Own the active system prompt (swappable for review and document modes)
- Hold URL and review context as optional injected sections
- Coordinate with the token counter, stability tracker, and history compactor
- Enforce token budget via three layers of defense

## Mode Enum

- Two modes: code (symbol index feeds context) and document (doc index feeds context)
- Set via a mode-setting method accepting string or enum
- The mode determines which index feeds prompt assembly and which system prompt header is used
- See [modes.md](modes.md) for the full mode switching protocol

## Initialization Inputs

- Model name (for token counting)
- Repository root (optional, used for stability tracker)
- Cache target tokens (for stability tracker and history compactor)
- History compaction configuration (optional)
- Initial system prompt

Creates on construction:

- Token counter (model-aware)
- File context (tracks selected files)
- Stability tracker (if repo root is provided) — see [cache-tiering.md](cache-tiering.md)
- History compactor (if compaction config with detection model is provided) — see [history.md](history.md)

## Conversation History

- An in-memory list of role/content dicts — the working copy for assembling LLM requests
- Separate from persistent JSONL storage (see [history.md](history.md))
- Operations: append single message, append user/assistant pair atomically, get copy, set (replace entirely), clear, purge stability tracker's history entries, count tokens
- System event messages are created with user role plus a system-event flag

## System Prompt Management

- Prompt is set at construction and can be swapped at runtime
- Review mode saves the original prompt, swaps to the review prompt, restores on exit
- Mode switching swaps between code and document system prompts
- The current prompt is readable for size estimation

## URL Context

- Optional list of URL content parts injected between file tree and review context during prompt assembly
- Multiple parts joined with a separator during assembly
- Set via a dedicated method, cleared via another

## Review Context

- Optional review text injected between URL context and active files during prompt assembly
- Re-injected on every message during review mode
- Empty or null input clears the context

## File Context

- Tracks files included in the conversation with their contents
- Operations: add file (read from disk if content not provided), remove, get list, get specific content, check membership, clear, format for prompt (fenced code blocks), count tokens total and per-file
- Paths normalized relative to repo root
- Binary files rejected
- Path traversal (`..` segments) blocked

### Path Normalization

- Backslashes replaced with forward slashes
- Leading/trailing slashes stripped
- Paths containing parent-directory segments rejected
- Full path canonicalization and repo-root validation happens at the Repo layer; file context normalization is sufficient for consistent key lookup

## Token Counting

- Wraps the provider's tokenizer
- Model-aware — selects the correct tokenizer for the configured model
- Fallback — estimate per-character ratio on any error
- Accepts strings, message dicts, or lists
- Exposes model info — max input tokens, max output tokens, max history tokens

## Token Budget Reporting

- Current history token count
- Max history tokens
- Max input tokens
- Remaining tokens
- Compaction-needed flag (delegates to compactor)
- Compaction status — enabled flag, trigger tokens, current tokens, percent

## Token Budget Enforcement

Three layers of defense applied before and after LLM requests.

### Layer 1: Compaction (Normal)

- History compaction triggers when history tokens exceed the configured threshold
- See [history.md](history.md) for the compaction algorithm

### Layer 2: Emergency Truncation

- If compaction fails AND history exceeds twice the compaction trigger, oldest messages are dropped without summarization
- Exposed as a method on the context manager but not currently called by the streaming pipeline
- Available as a manual safety net or for external callers

### Layer 3: Pre-Request Shedding

- Before assembling the prompt, if total estimated tokens exceed a high percentage of max input tokens, files are dropped from context (largest first) with a warning in chat
- Total estimate sums system prompt, file context, history, and a fixed overhead for headers and structural content
- Shedding loop removes the largest file on each iteration until the total drops below the threshold or no files remain

## Non-Tiered Prompt Assembly

- Accepts user prompt, optional images, symbol map, legend, file tree, and an optional set of files graduated to cached tiers (excluded from the active working files section)
- Produces a flat message array without cache-control markers
- Used as a fallback or during development

## Tiered Prompt Assembly

- Accepts user prompt, optional images, symbol map, legend (or both legends when cross-reference mode is active), file tree, and a tiered-content dict with per-tier entries (symbols, files, history, graduated files, graduated history indices)
- Produces a structured message array with cache-control markers at tier boundaries
- See [prompt-assembly.md](prompt-assembly.md) for the complete structure, header constants, and placement rules

## Interaction with Subsystems

- Stability tracker — registers and purges history entries; provides tier assignments for tiered assembly
- History compactor — invoked after the assistant response is delivered; the context manager replaces its history with the compacted result and re-registers entries
- Token counter — used by budget reporting and pre-request shedding

## Stability Tracker Attachment

- A setter allows attaching or replacing the stability tracker instance
- Used during mode switching to swap between the code-mode tracker and the document-mode tracker
- Each mode maintains an independent tracker instance; switching back preserves state

## Lifecycle

### Session Start

- Create context manager with model, repo root, config
- Eager stability initialization when symbol index and repo are available at construction time — see [cache-tiering.md](cache-tiering.md)
- Auto-restore last session — see [history.md](history.md)

### During Conversation

- Streaming handler appends user message before streaming, assistant message after
- Stability tracker updated with current items after each response
- Post-response compaction runs if threshold exceeded

### Session Reset

- Clear history, purge stability tracker history entries, start new persistent session
- Frontend dispatches a session-loaded event (with empty messages) to refresh history bar

### Loading a Previous Session

- Clear current history
- Read messages from persistent store (reconstructing images from refs)
- Add each to context manager
- Set persistent store's session ID to continue in loaded session

## Invariants

- History mutations never cross session boundaries without an explicit clear
- The working copy and persistent store are updated in a defined order on each exchange (user before streaming, assistant after)
- Pre-request shedding never removes a file without a user-visible warning
- System prompt swap is reversible — the original prompt is always restored on review exit or mode switch-back
- Binary files are never loaded into file context
- Path traversal attempts never produce a successful file context entry