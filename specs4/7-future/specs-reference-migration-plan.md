# specs-reference Migration — Execution Plan

**Status:** Not started. Companion to [specs-reference-migration.md](specs-reference-migration.md) which covers the design rationale.

## Purpose

Track progress through the specs3 → specs-reference migration across sessions. If work is dropped mid-migration, a new session can pick up by reading this file and the design doc.

## The Non-Replication Rule

**Before writing any twin file, verify it contains only detail that specs4 deliberately leaves unspecified.** If a twin restates behavior, invariants, module decomposition, or anything that belongs in the specs4 spec itself, it has failed the rule and must be rewritten.

Concrete test for each proposed twin section:

- Can a reimplementer make correct behavioral decisions from the specs4 spec alone? If yes, nothing about behavior goes in the twin.
- Is this a byte-level format, numeric constant, schema, prompt text, or dependency quirk? If yes, it belongs in the twin.
- Is this a design decision or rationale? If yes, it belongs in the specs4 spec, not the twin.

When in doubt, leave it out. Sparse twins are fine; duplicating specs4 content is not.

## Phase Checklist

### Phase 1 — Skeleton

Single commit. Create the tree shape and conventions without migrating content.

- [x] Create `specs-reference/` at repo root (peer of `specs4/`)
- [x] Write `specs-reference/README.md` stating:
  - The mechanical twin rule (`specs4/{path}/{name}.md` ↔ `specs-reference/{path}/{name}.md`)
  - Sparse-twin policy (twins exist only when they have content; absence means specs4 spec is self-sufficient)
  - Section conventions (byte-level formats, numeric constants, schemas, dependency quirks, cross-references)
  - Canonical ownership rule for cross-cutting content (producer owns, consumers link) with 2–3 named examples
  - Explicit non-replication rule with the concrete test above
- [x] Update `specs4/README.md` mention the companion `specs-reference/` tree

### Phase 2 — Pilot migration

Single commit. Prove the shape works on one representative area before committing to all 13.

**Pilot target:** symbol map compact format.

- [x] Read `specs3/2-code-analysis/symbol_index.md` carefully, identifying only the content that belongs in a twin (format syntax, legend, abbreviations, ditto marks, path aliases, test collapsing). Leave behavioral descriptions in specs3 for now.
- [x] Create `specs-reference/2-indexing/symbol-index.md` following the Phase 1 section conventions
- [x] Apply the non-replication check — read `specs4/2-indexing/symbol-index.md` and confirm the twin adds detail rather than restating
- [x] Update the row in `specs4/0-overview/implementation-guide.md` § "Where specs4 Is Incomplete Without specs3" from `specs3/2-code-analysis/symbol_index.md` to `specs-reference/2-indexing/symbol-index.md`
- [x] Grep specs4 live files (exclude impl-history) for other references to `specs3/2-code-analysis/symbol_index.md` and redirect them
- [x] Review the resulting twin file. If it feels like it duplicates behavior, rework before proceeding to Phase 3.

### Phase 3 — Remaining areas

One commit per area, grouped by layer for review navigability. Each commit follows the same pattern as Phase 2: extract, apply non-replication check, update table row, grep for stragglers.

**Layer 2 (2 commits)**

- [x] Doc outline annotations (`specs-reference/2-indexing/document-index.md`) — keyword parentheses, content-type markers, section size, ref counts, outgoing refs

**Layer 3 (6 commits)**

- [x] Edit block markers (`specs-reference/3-llm/edit-protocol.md`) — exact marker bytes, parser state machine, diagnostics. Also the canonical owner; webapp twins link here.
- [x] Cache tier numeric thresholds (`specs-reference/3-llm/cache-tiering.md`) — entry-N and promotion-N values, cache buffer multiplier, anchoring thresholds
- [x] Streaming event payload shapes (`specs-reference/3-llm/streaming.md`) — streamChunk, streamComplete, compactionEvent
- [x] JSONL history schema (`specs-reference/3-llm/history.md`) — record field names, session ID format, image ref format, turn ID
- [x] Compaction defaults — folded into `specs-reference/3-llm/history.md`. JSONL records and compaction config share app.json and persist through the same history store; splitting would only fragment cross-references
- [x] Model-specific cache minimums — folded into `specs-reference/3-llm/cache-tiering.md` during implementation. The per-model `min_cacheable_tokens` values are inputs to the cache target calculation, so they belong with the cache mechanics rather than with config keys. The configuration twin (when written) will link here for the values.

**Layer 1 (2 commits)**

- [x] RPC method signatures (`specs-reference/1-foundation/rpc-inventory.md`) — full argument and return shapes, complementing the behavioral inventory in specs4
- [x] Config file schemas (`specs-reference/1-foundation/configuration.md`) — field names, nesting, legacy format fallbacks

**Layer 4 (1 commit)**

- [x] Docuvert provenance header (`specs-reference/4-features/doc-convert.md`)

**Config/deployment (2 commits)**

- [ ] Dependency quirks — three separate twins per the mirror rule:
  - [ ] `specs-reference/2-indexing/symbol-index.md` (tree-sitter TypeScript function name) — may already exist from pilot; append if so
  - [ ] `specs-reference/5-webapp/diff-viewer.md` (Monaco worker configuration paths)
  - [ ] `specs-reference/6-deployment/build.md` (Vite optimizeDeps exclusion, PyInstaller hidden imports)
- [ ] System prompt text — **do not create a twin.** Update the table row to point directly at `src/ac_dc/config/*.md` as the authoritative source. Duplicating prompt text into a twin creates a drift risk; the live config files are already authoritative.

### Phase 4 — Retirement

Single commit. Confirm migration is complete, then delete specs3.

- [ ] Grep specs4 live files (exclude `specs4/impl-history/`) for `specs3/` references. Expected result: zero matches.
- [ ] Grep the "Where specs4 Is Incomplete Without specs3" table for `specs3/` entries. Expected result: zero matches (all rows now point at `specs-reference/` or `src/ac_dc/config/`).
- [ ] Rename the table heading in `implementation-guide.md` from "Where specs4 Is Incomplete Without specs3" to something like "Where specs4 Is Incomplete Without specs-reference" and update surrounding prose
- [ ] Delete `specs3/` entirely
- [ ] Update the "Context: Why Two Suites Exist" section in `implementation-guide.md` to describe the specs4 + specs-reference split instead of the specs4 + specs3 split
- [ ] Update `specs4/README.md` if it still references specs3

## Invariants across all phases

- Twins never restate behavior from the parent spec
- Impl-history files (`specs4/impl-history/*.md`) are never modified — they're historical records with intentional specs3 references
- `IMPLEMENTATION_NOTES.md` at repo root is never modified as part of this migration — it's the living working log
- No source code or test files are touched
- Each phase is a reviewable commit (or small commit series in Phase 3)
- After every phase, the repo must be in a coherent state — specs3 still readable, specs4 table still accurate

## Resuming after a drop

A new session picking up this work should:

1. Read `specs4/7-future/specs-reference-migration.md` for design rationale
2. Read this plan file to see which phase boxes are checked
3. Check the table in `specs4/0-overview/implementation-guide.md` — any rows still pointing at `specs3/` paths are remaining work
4. Check if `specs-reference/` exists and what's in it — this is the ground truth for migration progress
5. Continue from the first unchecked box in this file

If this plan file and the table disagree about what's been done, the table wins (it's the runtime reference). Update this plan file to match.

## Deviations from the design doc

If any phase reveals that the design doc's approach needs adjustment, amend the design doc (`specs-reference-migration.md`) before proceeding. The plan file tracks execution; the design doc tracks intent. Both should be updated if the intent changes.