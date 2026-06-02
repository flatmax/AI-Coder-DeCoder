# Prompt Assembly

The single source of truth for how LLM messages are assembled. All prompt content — system prompt, dir-blocks, files, history, URLs, review — is organized into a structured message array with stability-based cache tier placement.

Per **D36**, the cache content is **per-directory dir-blocks** (`symbols:<dir>`, `docs:<dir>`, `plain_files:<dir>`) plus full-file `file:<path>` entries in Active. The system prompt sits before L0 as the only non-flux head anchor; everything below it (including dir-blocks) flows through the membrane controller into any of L0–L3 or Active.

## Two Assembly Modes

- **Tiered assembly** — organizes content into L0–L3 cached blocks with cache-control markers (primary mode)
- **Flat assembly** — produces a flat message array without cache breakpoints (fallback during early startup or development)

The streaming handler uses tiered assembly, passing a content dict built from the stability tracker's tier assignments.

## Fallback to Flat Assembly

- Tiered content builder returns null when the stability tracker is not yet initialized
- Streaming handler uses the null return as the signal to fall back to flat assembly
- **None is the contract** — an empty dict must not be used to signal flat-assembly. An empty tiered dict would produce an array with cache-control on the system message and no content, wasting a cache breakpoint before tier init completes
- In practice the fallback only fires during a narrow startup window before stability init completes

## System Prompt

- Two files concatenated with blank line separator: main prompt plus optional extra prompt
- Main prompt covers: role, symbol map navigation, edit protocol rules, workflow guidance, failure recovery, context trust rules
- System prompts read fresh from files at assembly time — edits take effect on the next request
- Review mode and document mode swap the main prompt file; extra prompt always appended

## Other Prompts

- Commit message prompt — loaded from config for generating git commit messages (conventional commit style, imperative mood, length limits, no commentary)
- Compaction skill prompt — loaded by topic detector for history compaction LLM calls
- System reminder — loaded from config and appended to each user prompt; edit-format reinforcement rules (close blocks properly, copy text exactly, unique anchors, no placeholders). Sits at the end of context, closest to where the model generates

## Message Array Structure

Content is organized into tiered blocks:

- L0 system message — system prompt + legend + L0 dir-blocks + L0 file contents
- L0 history pairs (native user/assistant)
- Cache breakpoint
- L1 user/assistant pair — L1 dir-blocks + L1 file contents, followed by L1 history pairs
- Cache breakpoint
- L2 block (same structure)
- Cache breakpoint
- L3 block (same structure)
- Cache breakpoint
- URL context (uncached user/assistant pair)
- Review context (uncached user/assistant pair, only when review mode is active)
- Active files / working files (uncached user/assistant pair) — full text of files selected for editing
- Active history (native pairs)
- Current user prompt (with optional images)

Empty tiers are skipped entirely.

The standalone "File tree" section is removed under D36 — its contents (filenames for files without symbol tables or doc indexes) are now distributed as `plain_files:<dir>` dir-blocks across L0–L3 alongside the symbol and doc blocks.

## Cross-Reference Legend Headers

- When cross-reference mode is active, the secondary index's legend is appended to L0
- The header used is the **opposite mode's header** — ensuring each legend is introduced with a contextually appropriate description
- Code mode primary — repo map header for symbol legend, doc map header for doc legend
- Document mode primary — doc map header for doc legend, repo map header for symbol legend

The legends are static (description of the format), not the content. Under D36 the actual symbol/doc content lives in `symbols:<dir>` and `docs:<dir>` dir-blocks distributed across L0–L3, not in a single L0 aggregate map.

## Review Context (Conditional)

- Inserted as a user/assistant pair between URL context and active files
- Content includes review summary (branch, commits, stats), commit log, pre-change symbol map, and reverse diffs for selected files
- Re-injected on every message during review mode

## Header Constants

Named constants for each section header, used consistently across assembly modes:

- Repository map header (code mode)
- Document map header (document mode)
- File tree header
- URL context header
- Active files / working files header
- Per-tier reference files headers (L0 stable, L1 reference, L2, L3)
- Continued-structure header for tier symbol blocks
- Review context header

## L0 Block

- System role message, not a user/assistant pair
- Concatenates system prompt, mode-appropriate map header, legend(s), L0 dir-blocks, L0 file contents
- Cross-reference mode includes both legends, each with its own mode-appropriate header

## L1–L3 Blocks

- Each non-empty tier produces a user/assistant pair (when it has dir-blocks or files)
- User message combines dir-block content (`symbols:<dir>`, `docs:<dir>`, `plain_files:<dir>` from this tier) + file contents
- Assistant message acknowledges with brief confirmation
- Followed by native history messages for that tier, before the cache breakpoint

## Dir-block Ordering Within a Tier

Dir-blocks within a tier are rendered in a stable order: grouped by `content_type` (symbols → docs → plain_files), then alphabetical by directory path within each group. Stable ordering matters for the prefix cache — block positions within a tier must not shift when an unrelated block enters or leaves.

## URL Context Section

- Uncached user/assistant pair (initial implementation)
- Target design: URL content graduated to cached tiers appears in those tier blocks, remaining uncached URLs in this section
- Multiple URLs joined with a separator

## Active Files Section

- Uncached user/assistant pair
- Formatted as fenced code blocks, one per file, no language tags
- Files joined with blank lines
- Section omitted if no content

## Active History

- Native role/content message dicts inserted directly
- No wrapping

## System Reminder Injection

- Appended to the user's message text before assembly
- Appears at the very end of context, closest to where the model generates

## Current User Message

- Text-only or multimodal (text + image content blocks) depending on whether images are attached
- System reminder appended to text portion

## File Content Formatting

- Fenced code blocks, no language tags
- Path on a line preceding the fence
- Blank-line separator between files

## Cache Control Placement

- L0 without history — cache-control on the system message (structured content format)
- L0 with history — cache-control on the last L0 history message
- L1/L2/L3 — cache-control on the last message in that tier's sequence
- Providers typically allow four breakpoints per request
- Blocks under the provider's minimum cache size will not actually be cached

## No Extra Headers Required

- Provider libraries automatically forward cache-control markers when the model is Anthropic or Bedrock Claude
- No manual beta headers needed — the marker on content blocks is sufficient
- Only requirement — the model name is correctly recognized

## History Placement

- Cached tier history — native message dicts placed after the tier's user/assistant pair, before the cache breakpoint
- Active history — raw message dicts, filtered to active-tier indices only

## Cache Hit Reporting

- Read from the provider's usage response, not computed locally
- Requires requesting usage reporting via stream options

## Tiered Assembly Data Flow

The streaming handler builds the tiered content dict from stability tracker state:

### Step 1: Gather Tier Assignments

- For each tier, fetch the items from the tracker (keyed by `file:`, `symbols:`, `docs:`, `plain_files:`, `url:`, `history:`)

### Step 2: Build Content Per Tier

- Dispatch by key prefix
- System keys handled separately by the assembly function
- `symbols:<dir>` → symbol index renders the directory's symbol-table block (one entry per source file in the directory minus any currently in Active full-text)
- `docs:<dir>` → doc index renders the directory's doc-outline block (same shape, for documents)
- `plain_files:<dir>` → renders the directory's filenames for files without symbol tables or doc indexes
- `file:<path>` → file context provides content, formatted as fenced block (Active full-text)
- `url:` keys → URL service provides formatted content (target design)
- `history:` keys → context manager provides message by index
- Skip user-excluded paths when building dir-blocks

### Step 3: Determine Exclusions

- A file selected for editing has full text in Active and is **already excluded** from its dir-block at the tracker level (D36 edit-invariant) — no extra coordination needed at assembly time
- URLs in any cached tier must be excluded from the uncached URL context
- User-excluded index files must be excluded from all dir-block output

### Step 4: Assemble

- Call tiered assembly with the built dict, exclusions-aware dir-block outputs, and legends

## Content Gathering Rules Summary

| Item | Source | Exclusion |
|---|---|---|
| `file:<path>` in Active | file context get-content | rendered in active working-files section. Tracker invariant guarantees the file is already excluded from its dir-block. |
| `symbols:<dir>` / `docs:<dir>` / `plain_files:<dir>` in any tier | index-derived render of the directory | excludes any file currently in Active full-text (handled at the tracker level, not at assembly time). User-excluded files are also omitted. |
| `url:` key in L1/L2/L3 | URL service formatted content | excluded from uncached URL section (target design) |
| `url:` key in Active | URL service formatted content | rendered in uncached URL section |
| `history:` key in L1/L2/L3 | context manager history[N] | excluded from active history messages |

Dir-block content is rendered at assembly time from the live index, **not** from a frozen snapshot — there is no L0 snapshot under D36. The dir-block's `tokens` and `content_hash` (computed when it was last teleported) feed the membrane controller, while the assembly path renders the current bytes from the index. If the index has changed since the last teleport, the membrane controller will detect the hash mismatch on the next freeze and teleport the dir-block back to Active to re-ride flux.

## Uniqueness Invariants

- A file's full content is present in exactly one location: either Active as `file:<path>` (selected for editing), or as an entry in its directory's `symbols:<dir>` / `docs:<dir>` / `plain_files:<dir>` dir-block (in any tier L0–L3). Never both.
- A directory's symbol/doc/plain-file content is rendered as one block per content_type — the directory's `symbols:<dir>` block is in exactly one tier at any given moment, similarly for `docs:<dir>` and `plain_files:<dir>`.
- A URL's content is present in exactly one location — either a cached tier or the uncached URL section.
- The previous "duplicate in L0 + lower tier" representation (D27) is removed under D36; there is no system-prompt authority rule needed because the file appears in exactly one place per turn.

## Synthetic Meta Rows (Cache Viewer)

The cache viewer surfaces every distinct section of the assembled prompt as a row. Under D36 the dir-blocks (`symbols:<dir>`, `docs:<dir>`, `plain_files:<dir>`) are first-class tracker entries with their own rows; they are no longer surfaced via synthetic `meta:` keys. The remaining `meta:` rows cover sections that genuinely don't have tracker representation:

- Fetched URLs (`meta:url:{url}`)
- Review-context block (`meta:review_context`)
- Active selected files in the working-files section (`meta:active_file:{path}`)

The `meta:repo_map`, `meta:doc_map`, and `meta:file_tree` synthetic rows from D27/earlier are **removed** under D36. Their content is now distributed across the dir-block set (the symbol-map row was the union of `symbols:<dir>` blocks; the doc-map row was the union of `docs:<dir>` blocks; the file-tree row was the union of `plain_files:<dir>` blocks). See [`specs-reference/3-llm/prompt-assembly.md § Synthetic meta rows`](../../specs-reference/3-llm/prompt-assembly.md#synthetic-meta-rows) for the updated catalog and dispatch table.

## Invariants

- Tiered assembly returning null signals flat-assembly fallback; empty dict is never used for this purpose
- Cache-control is placed on exactly one message per cached tier (four total in the common case)
- Empty tiers produce no messages and no cache-control markers
- System reminder always appears at the end of the user's prompt text
- The system prompt sits before L0 as the only non-flux head anchor; under D36 L0 is a flux tier like any other
- Dir-blocks (`symbols:<dir>`, `docs:<dir>`, `plain_files:<dir>`) can appear in any of L0–L3; placement is determined by the membrane controller
- A file in Active full-text is excluded from its dir-block by the tracker invariant — assembly does not re-coordinate this
- User-excluded files (file picker's three-state checkbox) are excluded from indexing entirely and therefore from every dir-block