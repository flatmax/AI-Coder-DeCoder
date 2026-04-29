# Reference: LLM Prompts

**Supplements:** `specs4/3-llm/modes.md`, `specs4/3-llm/history.md`, `specs4/4-features/code-review.md`

This directory preserves the exact text of the system prompts and config defaults shipped with AC⚡DC. Prompt text is interop with the LLM — changes can shift model behavior in subtle ways that break compaction JSON parsing, edit-block reliability, or commit message conventions. A reimplementer can modify the prompts, but having the original text available means the baseline behavior is reproducible.

The prompts live as sibling files in `specs-reference/3-llm/prompts/`, mirrored verbatim from `src/ac_dc/config/`. When the source tree is deleted, these copies become the authoritative reference. When both exist, `src/ac_dc/config/` is the running system's source of truth; `specs-reference/3-llm/prompts/` is the reimplementer's reference.

## Sync discipline

Changes to prompts in `src/ac_dc/config/` must be mirrored into `specs-reference/3-llm/prompts/`. Run the sync script:

```
python scripts/sync_prompts.py
```

The script reads each file in the manifest below, compares bytes against the existing copy, and writes only when changed. Safe to run repeatedly — unchanged files report as `unchanged`. Commit the resulting changes alongside the prompt edit so reviewers see both sides of the sync in one diff.

CI or pre-commit hooks could enforce the sync by running the script in check-only mode (comparing bytes without writing) and failing when drift is detected. Not wired today; discipline is manual.

## File inventory

The running system ships nine config files, mirrored into `specs-reference/3-llm/prompts/`:

| File | Role | Edit via Settings RPC? |
|---|---|---|
| [`prompts/system.md`](prompts/system.md) | Main coding-agent system prompt | Yes |
| [`prompts/system_doc.md`](prompts/system_doc.md) | Document-mode system prompt | Yes |
| [`prompts/review.md`](prompts/review.md) | Review-mode system prompt | Yes |
| [`prompts/compaction.md`](prompts/compaction.md) | Topic-boundary detection prompt | Yes |
| [`prompts/commit.md`](prompts/commit.md) | Commit message generation prompt | No (internal use) |
| [`prompts/system_reminder.md`](prompts/system_reminder.md) | Edit-format reinforcement appended to every user prompt | No (internal use) |
| [`prompts/snippets.json`](prompts/snippets.json) | Quick-insert snippets for all three modes | Yes |
| [`prompts/llm.json`](prompts/llm.json) | Provider config and model selection | Yes |
| [`prompts/app.json`](prompts/app.json) | App-wide settings (URL cache, compaction thresholds, doc index) | Yes |

In the running system, these files land in the user config directory (`~/.config/ac-dc/`, `~/Library/Application Support/ac-dc/`, or `%APPDATA%\ac-dc\`) after first startup. A version marker file (`.bundled_version`) tracks which release populated the directory for upgrade handling.

## Contracts per file

### [`prompts/system.md`](prompts/system.md) — coding-agent system prompt

Main LLM instructions for code mode. Covers role, symbol map navigation, edit block protocol, failure recovery, and context trust rules.

**Load-bearing contracts:**

- Documents the edit block format using the exact emoji markers. Must match [`edit-protocol.md`](edit-protocol.md) byte-for-byte. Markers appear in the "Example" fenced block
- Describes the symbol map as authoritative for structural navigation but empty of file content — instructs the LLM to request files explicitly
- Explains the anchor-match model: old text must match exactly one location
- Pins the "never invent content" rule — only edit files that are in context

### [`prompts/system_doc.md`](prompts/system_doc.md) — document-mode system prompt

Replaces `system.md` in document mode. Shifts role to documentation assistant.

**Load-bearing contracts:**

- Same edit block format as `system.md` (markers are mode-agnostic)
- Describes the document outline format (keywords, content-type markers, incoming ref counts) rather than the symbol map
- Refers to the `"doc"` snippet key

### [`prompts/review.md`](prompts/review.md) — review-mode system prompt

Replaces `system.md` in review mode.

**Load-bearing contracts:**

- Review mode is **read-only** — the LLM suggests changes but the edit pipeline skips application (gated on review state)
- Awareness of reverse diffs in review context (what would revert to pre-review state)

### [`prompts/compaction.md`](prompts/compaction.md) — topic-boundary detection

System prompt for the smaller LLM that detects topic boundaries in conversation history.

**Most critical file to preserve.** The prompt instructs the LLM to produce a specific JSON response shape; the compactor parses it mechanically.

**Load-bearing contracts:**

- Output format is JSON (bare or markdown-fenced)
- Four required fields: `boundary_index` (int or null), `boundary_reason` (string), `confidence` (float 0–1), `summary` (string)
- Input format is indexed-and-role-prefixed: `[0] user: ...\n[1] assistant: ...`
- Canonical schema lives in [`history.md`](history.md) § Topic detector output format

A reimplementer modifying this prompt must verify the JSON shape is still parseable by the compactor, or history compaction silently breaks.

### [`prompts/commit.md`](prompts/commit.md) — commit message generation

System prompt for commit message generation when the user clicks the commit button.

**Load-bearing contracts:**

- Conventional commit style (`type(scope): description`)
- Imperative mood subject, 50/72 char limits
- No commentary — output only the message

### [`prompts/system_reminder.md`](prompts/system_reminder.md) — edit-format reinforcement

Short reminder appended to every user prompt (see [`prompt-assembly.md`](prompt-assembly.md) § System reminder appending).

**Second most critical file.** Without this reinforcement, over long sessions the LLM gradually drifts from the edit block format — dropping markers, using wrong emoji, adding prose between markers.

**Load-bearing contracts:**

- File begins with `\n\n` (two leading newlines) so the reminder separates from the user's prompt text
- Repeats the core edit rules: close with full `END` marker, copy old text character-for-character, include unique context, small blocks, no placeholders

### [`prompts/snippets.json`](prompts/snippets.json) — quick-insert snippets

Three top-level keys (`code`, `review`, `doc`); each maps to a list of `{icon, tooltip, message}` objects. Reader also accepts a legacy flat format (`{"snippets": [{"mode": ..., ...}]}`) and groups by mode.

Snippets are user-visible quick-insert templates for the chat input. Free to customize — no LLM interop contract.

### [`prompts/llm.json`](prompts/llm.json) — LLM provider config

Schema documented in [`configuration.md`](../1-foundation/configuration.md) § `llm.json`. The shipped file uses a reference deployment's Bedrock/Claude defaults; reimplementers should substitute their own provider.

Note: `smaller_model` accepts both snake_case and camelCase (`smallerModel`) for backwards compatibility. New writes should use snake_case.

### [`prompts/app.json`](prompts/app.json) — app-wide settings

Schema documented in [`configuration.md`](../1-foundation/configuration.md) § `app.json`. The shipped values are tuned defaults covering URL cache TTL, history compaction thresholds, doc convert extensions, and doc index keyword enrichment parameters.

Changing `keyword_model` invalidates all cached keyword enrichments (the cache key includes the model name).

## Reimplementation notes

**Strongly preserve:**

- `compaction.md` — response shape is parsed; deviations silently break compaction
- `system_reminder.md` — essential for edit-format reliability over long sessions
- Edit-block emoji markers in `system.md` and `system_doc.md` — must match [`edit-protocol.md`](edit-protocol.md)

**Free to rewrite with care:**

- `system.md` / `system_doc.md` body text — as long as the edit protocol and map navigation instructions remain correct
- `review.md` — as long as the read-only contract is clear
- `commit.md` — as long as output is a clean commit message
- Snippets — user-visible; customize freely

**Default values worth preserving verbatim:**

- All numeric constants in `app.json` — the compaction / URL cache / doc index defaults are tuned values
- `keyword_model` default (`BAAI/bge-small-en-v1.5`) — compact, high-quality English sentence-transformer; swapping requires re-enriching all cached outlines

## Cross-references

- Prompt assembly (how these prompts compose into LLM messages): [`prompt-assembly.md`](prompt-assembly.md)
- Edit block marker bytes: [`edit-protocol.md`](edit-protocol.md)
- Topic detector JSON schema: [`history.md`](history.md) § Topic detector output format
- Configuration file loading and upgrade flow: [`../1-foundation/configuration.md`](../1-foundation/configuration.md)