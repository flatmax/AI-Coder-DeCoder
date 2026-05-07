# Prompt Assembly

The single source of truth for how LLM messages are assembled. All prompt content — system prompts, symbol map, files, history, URLs, review — is organized into a structured message array with stability-based cache tier placement.

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

- L0 system message — system prompt + legend + L0 index entries + L0 file contents
- L0 history pairs (native user/assistant)
- Cache breakpoint
- L1 user/assistant pair — L1 index entries + L1 file contents, followed by L1 history pairs
- Cache breakpoint
- L2 block (same structure)
- Cache breakpoint
- L3 block (same structure)
- Cache breakpoint
- File tree (uncached user/assistant pair)
- URL context (uncached user/assistant pair)
- Review context (uncached user/assistant pair, only when review mode is active)
- Active files / working files (uncached user/assistant pair)
- Active history (native pairs)
- Current user prompt (with optional images)

Empty tiers are skipped entirely.

## Cross-Reference Legend Headers

- When cross-reference mode is active, the secondary index's legend is appended to L0
- The header used is the **opposite mode's header** — ensuring each legend is introduced with a contextually appropriate description
- Code mode primary — repo map header for symbol legend, doc map header for doc legend
- Document mode primary — doc map header for doc legend, repo map header for symbol legend

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
- Concatenates system prompt, mode-appropriate map header, legend(s), L0 index entries, L0 file contents
- Cross-reference mode includes both legends, each with its own mode-appropriate header

## L1–L3 Blocks

- Each non-empty tier produces a user/assistant pair (when it has symbols or files)
- User message combines index entries + file contents
- Assistant message acknowledges with brief confirmation
- Followed by native history messages for that tier, before the cache breakpoint

## File Tree Section

- Uncached user/assistant pair
- Flat sorted list with a count header built by the streaming handler
- Header prepended during assembly

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

- For each tier, fetch the items from the tracker (keyed by `file:`, `symbol:`, `doc:`, `url:`, `history:`)

### Step 2: Build Content Per Tier

- Dispatch by key prefix
- System keys handled separately by the assembly function
- Symbol keys → symbol index provides block
- Doc keys → doc index provides block
- File keys → file context provides content, formatted as fenced block
- URL keys → URL service provides formatted content (target design)
- History keys → context manager provides message by index
- Skip items whose path is in the user-excluded index files set

### Step 3: Determine Exclusions

- Files in any cached tier must be excluded from the active working files section and from the symbol/doc map output
- URLs in any cached tier must be excluded from the uncached URL context
- User-excluded index files must be excluded from all map output
- Selected files whose index block is in active must also be excluded from the main map

### Step 4: Assemble

- Call tiered assembly with the built dict, exclusions-aware map outputs, and legends

## Content Gathering Rules Summary

| Item | Source | Exclusion |
|---|---|---|
| file key in L1/L2/L3 | file context get-content | excluded from active working-files section (no double-render) |
| file in Active | file context get-content | rendered in active working-files section |
| url key in L1/L2/L3 | URL service formatted content | excluded from uncached URL section (target design) |
| url key in Active | URL service formatted content | rendered in uncached URL section |
| history key in L1/L2/L3 | context manager history[N] | excluded from active history messages |
| Aggregate symbol map (L0) | symbol index | always full; no exclusion except user-excluded files |
| Aggregate doc map (L0) | doc index | always full; no exclusion except user-excluded files |

The aggregate maps in L0 are not derived from `symbol:` or `doc:` tracker entries — they're regenerated from the underlying index when L0 is rebuilt (session start or `rebuild_cache`) and held verbatim for the rest of the session. The cascade does not touch L0.

## Uniqueness Invariants

- A file's full content is present in exactly one location — either a cached tier (L1/L2/L3) or the working files section (Active). Never both.
- A file's symbol or doc block lives only in L0's aggregate map. It does not appear in lower tiers under any circumstance.
- The same file may appear simultaneously as a symbol/doc summary in L0 *and* as full text in a lower tier or Active. This is the intended representation — the system prompt's authority rule directs the LLM to treat the full text as canonical.
- A URL's content is present in exactly one location — either a cached tier or the uncached URL section.

## No Symbol Map Exclusions

The aggregate symbol-map and doc-map bodies in L0 contain **every indexed file's block**, with no exclusions. A selected file's symbol block appears in L0's map *and* the file's full text appears in the appropriate lower-tier section — the LLM uses the map for navigation and the full text for truth, resolved by the system prompt's authority rule.

This is a deliberate departure from earlier designs that pulled selected-file blocks out of the aggregate map to avoid duplication. The duplication cost is small (symbol blocks are dense) and is dwarfed by the cache-stability win: routine selection toggles no longer rewrite L0's byte sequence, so L0 cache survives every turn.

User-excluded files (file picker's three-state checkbox) are excluded from indexing entirely, so they do not appear in the aggregate maps. This is the only filter applied to L0's map content.

## Synthetic Meta Rows (Cache Viewer)

The cache viewer surfaces every distinct section of the assembled prompt as a row, not just individual tracker entries. Synthetic rows carry a `meta:` prefix and cover sections that don't have tracker representation: the aggregate map body, the file tree, fetched URLs, the review-context block, and active selected files. These synthetic rows are generated by the context-breakdown RPC (for row display) and resolved by the map-block RPC (for click-to-view content).

The `meta:repo_map` and `meta:doc_map` rows in L0 always reflect the full aggregate maps over every indexed file (excluding only user-excluded files). Meta rows in the uncached tail (file tree, URLs, review, active files) reflect the rebuilt-every-request sections of the prompt. See [`specs-reference/3-llm/prompt-assembly.md § Synthetic meta rows`](../../specs-reference/3-llm/prompt-assembly.md#synthetic-meta-rows) for the complete key catalog and dispatch table.

## Invariants

- Tiered assembly returning null signals flat-assembly fallback; empty dict is never used for this purpose
- Cache-control is placed on exactly one message per cached tier (four total in the common case)
- Empty tiers produce no messages and no cache-control markers
- System reminder always appears at the end of the user's prompt text
- L0 is content-typed: system prompt + aggregate symbol map + aggregate doc map + (optionally) cross-reference seeded items. The cascade does not modify L0; only application restart or `rebuild_cache` does
- Symbol and doc blocks never appear in L1/L2/L3 — they live only in L0's aggregate maps
- The aggregate maps in L0 contain every indexed file (minus user-excluded files); there is no per-file exclusion based on tier membership or selection state