# Reference: LLM Prompts

**Supplements:** `specs4/3-llm/modes.md`, `specs4/3-llm/history.md`, `specs4/4-features/code-review.md`

This twin holds the exact text of the system prompts and config defaults shipped with AC⚡DC. Prompt text is interop with the LLM — changes can shift model behavior in subtle ways that break compaction JSON parsing, edit-block reliability, or commit message conventions. A reimplementer can modify the prompts, but having the original text available means the baseline behavior is reproducible.

Previously this content lived in `src/ac_dc/config/*.md` as the authoritative source. When those files are present in the running system, they are the runtime source of truth. This twin exists so the content is preserved when the original source tree is deleted.

## File inventory

The running system ships eight config files:

| File | Role | Edit via Settings RPC? |
|---|---|---|
| `system.md` | Main coding-agent system prompt | Yes |
| `system_doc.md` | Document-mode system prompt | Yes |
| `review.md` | Review-mode system prompt | Yes |
| `compaction.md` | Topic-boundary detection prompt | Yes |
| `commit.md` | Commit message generation prompt | No (internal use) |
| `system_reminder.md` | Edit-format reinforcement appended to every user prompt | No (internal use) |
| `snippets.json` | Quick-insert snippets for all three modes | Yes |
| `llm.json` | Provider config and model selection | Yes |
| `app.json` | App-wide settings (URL cache, compaction thresholds, doc index) | Yes |

The user config directory (`~/.config/ac-dc/`, `~/Library/Application Support/ac-dc/`, or `%APPDATA%\ac-dc\`) contains these files after first startup. A version marker file (`.bundled_version`) tracks which release populated the directory for upgrade handling.

## system.md (coding-agent system prompt)

**Scope:** Main LLM instructions for code mode. The LLM's role (expert coding agent), how to read the symbol map, the edit block protocol, failure recovery guidance, and context trust rules.

**Key invariants the prompt must maintain:**

- Tells the LLM that the symbol map is authoritative for structural navigation but does NOT contain file content — full content requires explicit request
- Documents the edit block format using the exact emoji markers: `🟧🟧🟧 EDIT` / `🟨🟨🟨 REPL` / `🟩🟩🟩 END` (see `specs-reference/3-llm/edit-protocol.md` for byte-level detail)
- Explains the anchor-match model: old text must match exactly one location in the file
- Instructs on failure recovery for ambiguous anchors (add context) and anchor-not-found (re-read the file)
- Pins the "never invent content" rule — the LLM should only edit files whose content has been provided in context

**Content:** The original text of this file should be preserved verbatim from a reference deployment. When creating a new AC⚡DC installation from scratch, copy the contents of this file from an existing running system's `src/ac_dc/config/system.md` or from the config directory. The file is plain markdown.

## system_doc.md (document-mode system prompt)

**Scope:** Replaces `system.md` in document mode. Shifts the LLM's role from coding agent to documentation assistant.

**Key invariants:**

- Role shifts to documentation-focused work: restructuring, cross-reference checking, writing, summarizing
- Uses the same edit block format as `system.md` (markers are mode-agnostic)
- Describes the document index format (outline with keywords, content-type markers, incoming reference counts) rather than the symbol map
- Different snippet set referenced (snippets.json's `"doc"` key)

**Content:** Preserve verbatim from a reference deployment. Plain markdown.

## review.md (review-mode system prompt)

**Scope:** Replaces `system.md` in review mode. Instructs the LLM on code review methodology.

**Key invariants:**

- Review mode is **read-only** — the LLM should suggest changes but not apply edits (the edit pipeline is gated on review state and skips application)
- Severity categories (blocker / issue / nit / praise)
- Review methodology (correctness → architecture → style)
- Awareness of reverse diffs in review context (what would revert to pre-review state)

**Content:** Preserve verbatim from a reference deployment. Plain markdown.

## compaction.md (topic-boundary detection prompt)

**Scope:** System prompt for the smaller LLM that detects topic boundaries in conversation history for compaction.

**Critical contract:** This prompt instructs the LLM to produce a specific JSON response shape. The compaction code parses the response and extracts four fields: `boundary_index`, `boundary_reason`, `confidence`, `summary`. See `specs-reference/3-llm/history.md` § Topic detector output format for the canonical schema.

**Key invariants:**

- Output format is JSON (either bare or markdown-fenced `json`)
- Four required fields with specific semantics:
  - `boundary_index` — integer or null (first message index of the new topic, or null when no boundary detected)
  - `boundary_reason` — human-readable rationale string
  - `confidence` — float 0.0–1.0
  - `summary` — string used when the summarize case fires
- Instructs on what counts as a boundary (task switch, explicit topic change, shift to different file/component)
- Uses the message-indexed format: `[0] user: {content}\n[1] assistant: {content}\n...`

**Content:** Preserve verbatim from a reference deployment. Reimplementers modifying this prompt must verify the JSON output shape remains parseable by the compactor, or they will silently break history compaction.

## commit.md (commit message generation prompt)

**Scope:** System prompt for commit message generation when the user clicks the commit button.

**Key invariants:**

- Conventional commit style (`type(scope): description`)
- Imperative mood subject line
- 50-character subject line limit, 72-character body wrap
- No commentary — output the commit message only, no preamble or explanation
- Receives the staged diff as input

**Content:** Preserve verbatim from a reference deployment. Plain markdown.

## system_reminder.md (edit-format reinforcement)

**Scope:** Short reminder appended to every user prompt (see `specs-reference/3-llm/prompt-assembly.md` § System reminder appending).

**Critical role:** Without this reinforcement, over long sessions the LLM gradually drifts away from the emoji-delimited edit block format — dropping markers, using wrong emoji, adding unintended prose between markers. The reminder refreshes the rules on every turn.

**Key rules the reminder repeats:**

- Close every block with `🟩🟩🟩 END` (NOT `🟩🟩🟩` or other variations)
- Copy old text character-for-character from the file — never type from memory
- Include enough unique context lines for an unambiguous anchor match
- Keep blocks small — split large changes into multiple edits
- Never use `...` or placeholders inside edit blocks

**Content:** Preserve verbatim from a reference deployment. The file begins with `\n\n` (two leading newlines) so the reminder is separated from the user's prompt text by a blank line.

## snippets.json (quick-insert snippets)

**Structure:**

```json
{
  "code": [ { "icon": "✂️", "tooltip": "...", "message": "..." }, ... ],
  "review": [ ... ],
  "doc": [ ... ]
}
```

Each snippet has `icon` (emoji or short glyph), `tooltip` (hover text), `message` (inserted text).

**Legacy flat format:** Reader also accepts `{ "snippets": [ { "mode": "code", ... } ] }` and groups by the `mode` field.

**Typical code mode snippets** (preserve verbatim from reference deployment):

- Continue truncated edit (when the LLM's response hits max_tokens mid-edit)
- Check context before changes (force the LLM to articulate understanding before acting)
- Pre-commit checklist
- Verify tests
- Pause before implementing

**Typical review mode snippets:**

- Full PR review
- Commit-by-commit walkthrough
- Security review

**Typical doc mode snippets:**

- Summarize document
- Check consistency
- Generate table of contents
- Simplify section

**Content:** Preserve the full snippet arrays verbatim from a reference deployment.

## llm.json (LLM provider config)

**Schema** (see `specs-reference/1-foundation/configuration.md` § `llm.json`):

```json
{
  "env": { "ANTHROPIC_API_KEY": "..." },
  "model": "anthropic/claude-sonnet-4-20250514",
  "smaller_model": "anthropic/claude-haiku-4-20250514",
  "cache_min_tokens": 1024,
  "cache_buffer_multiplier": 1.1
}
```

**Default values to ship:**

- `model` — a sensible provider-qualified default (e.g., a current Anthropic Sonnet-class model)
- `smaller_model` — a faster/cheaper model for auxiliary tasks (commit messages, topic detection, URL summarization)
- `env` — empty object (users supply API keys)
- `cache_min_tokens` — 1024 (overridden upward by model-specific minimums per `specs-reference/3-llm/cache-tiering.md`)
- `cache_buffer_multiplier` — 1.1

Note: `smaller_model` accepts both snake_case and camelCase (`smallerModel`) for backwards compatibility. New writes should use snake_case.

## app.json (app-wide settings)

**Schema** (see `specs-reference/1-foundation/configuration.md` § `app.json`):

```json
{
  "url_cache": {
    "path": null,
    "ttl_hours": 24
  },
  "history_compaction": {
    "enabled": true,
    "compaction_trigger_tokens": 24000,
    "verbatim_window_tokens": 4000,
    "summary_budget_tokens": 500,
    "min_verbatim_exchanges": 2
  },
  "doc_convert": {
    "enabled": true,
    "extensions": [".docx", ".pdf", ".pptx", ".xlsx", ".csv", ".rtf", ".odt", ".odp"],
    "max_source_size_mb": 50
  },
  "doc_index": {
    "keyword_model": "BAAI/bge-small-en-v1.5",
    "keywords_enabled": true,
    "keywords_top_n": 3,
    "keywords_ngram_range": [1, 2],
    "keywords_min_section_chars": 50,
    "keywords_min_score": 0.3,
    "keywords_diversity": 0.5,
    "keywords_tfidf_fallback_chars": 150,
    "keywords_max_doc_freq": 0.6
  }
}
```

All fields tunable; the values above are the reference defaults. Changing `keyword_model` invalidates all cached keyword enrichments (the cache key includes the model name).

## Reimplementation notes

**Strongly preserve:**

- `compaction.md` — response shape is parsed; deviations silently break compaction
- `system_reminder.md` — essential for edit-format reliability
- Edit-block emoji markers in `system.md` and `system_doc.md` — must match `specs-reference/3-llm/edit-protocol.md`

**Free to rewrite with care:**

- `system.md` / `system_doc.md` body text — as long as the edit protocol and symbol/doc map navigation instructions remain correct
- `review.md` — as long as the read-only contract is clear
- `commit.md` — as long as output is a clean commit message
- Snippets — user-visible quick-insert templates; customize freely

**Default values worth preserving verbatim:**

- All numeric constants in `app.json` — the compaction / URL cache / doc index defaults are tuned values
- `keyword_model` default (`BAAI/bge-small-en-v1.5`) — compact, high-quality English sentence-transformer; swapping requires re-enriching all cached outlines

## Cross-references

- Prompt assembly (how these prompts compose into LLM messages): `specs-reference/3-llm/prompt-assembly.md`
- Edit block marker bytes: `specs-reference/3-llm/edit-protocol.md`
- Topic detector JSON schema: `specs-reference/3-llm/history.md` § Topic detector output format
- Configuration file loading and upgrade flow: `specs-reference/1-foundation/configuration.md`