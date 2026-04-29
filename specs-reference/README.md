# specs-reference

Companion tree to `specs4/`. Holds implementation detail that `specs4/` deliberately leaves unspecified: byte-level formats, numeric constants, persistent storage schemas, RPC argument shapes, dependency quirks, and similar concrete detail that's load-bearing for interop but too specific for a behavioral contract.

## The Mechanical Twin Rule

When implementing from `specs4/{path}/{name}.md`, also load `specs-reference/{path}/{name}.md` if it exists.

One rule, one path transformation. The two trees mirror each other:

```
specs4/
  3-llm/
    edit-protocol.md       — behavioral contract
specs-reference/
  3-llm/
    edit-protocol.md       — marker bytes, parser state, diagnostics
```

Path structure is identical. File names are identical. Only the top-level tree name differs.

## Sparse Twin Policy

Twins exist **only when there is content to put in them**. A missing twin is not a bug — it means the parent specs4 spec is self-sufficient and a reimplementer needs no supplementary detail to implement it correctly.

AI tooling loading specs content should check for twin existence on each load. The cost is trivial; the alternative (creating empty twins preemptively) clutters the tree and makes "is there real content here?" a harder question for human readers.

## The Non-Replication Rule

**A twin file must never restate content from its parent specs4 spec.** It supplements, it doesn't duplicate.

Concrete test for each proposed twin section:

- Can a reimplementer make correct behavioral decisions from the specs4 spec alone? If yes, nothing about behavior goes in the twin.
- Is this a byte-level format, numeric constant, schema, prompt text, or dependency quirk? If yes, it belongs in the twin.
- Is this a design decision or rationale? If yes, it belongs in the specs4 spec, not the twin.

When in doubt, leave it out. Sparse twins are fine; duplicating specs4 content is not — duplication creates drift risk on every spec update.

## Section Conventions

Standardise the layout within each twin so readers (human and AI) know where to look:

```markdown
# Reference: {Spec Name}

**Supplements:** `specs4/{path}/{name}.md`

## Byte-level formats
...exact marker bytes, exact delimiter specs...

## Numeric constants
...thresholds, timeouts, retry counts...

## Schemas
...JSONL fields, config keys, RPC argument and return shapes...

## Dependency quirks
...implementation-specific gotchas for this area...

## Cross-references
- Related detail: `specs-reference/{other path}`
```

Sections empty or omitted when nothing applies. The standardised headings let a reader find the relevant detail without reading the whole file.

## Cross-Cutting Content

When detail genuinely spans multiple specs (a format produced by one spec and consumed by another), pick a **canonical owner** and have other twins link to it rather than duplicate.

Rule of thumb: the twin for the spec that *produces* the format owns it; twins for specs that *consume* it link.

Named examples (all pending migration — this section will point at real files once Phase 3 completes):

- **Edit block markers** — canonical owner: `specs-reference/3-llm/edit-protocol.md`. Consumers like `specs-reference/5-webapp/chat.md` (renders edit blocks) and `specs-reference/5-webapp/diff-viewer.md` (intercepts edit-block navigation) link rather than duplicate.
- **Symbol map compact syntax** — canonical owner: `specs-reference/2-indexing/symbol-index.md`. Consumers like `specs-reference/3-llm/prompt-assembly.md` link when they need to reference the format.
- **RPC argument and return shapes** — canonical owner: `specs-reference/1-foundation/rpc-transport.md` (or `rpc-inventory.md`). Consumers link to specific methods rather than re-documenting them.

Canonical ownership is the one place where topical thinking survives in the mirrored layout. Duplication creates drift risk; linking creates a single source of truth.

## What Stays Outside

- Behavioral contracts, invariants, module decomposition, data flow, design rationale — all stay in `specs4/`
- Historical delivery records — stay in `specs4/impl-history/`. They reference specs3 intentionally and are not migrated

## Synced Mirror

The `specs-reference/3-llm/prompts/` directory is a special case: it holds byte-exact copies of `src/ac_dc/config/*.md` and `*.json`, synced via `scripts/sync_prompts.py`. The mirror exists because prompt text is LLM-interop (changes can silently break compaction JSON parsing, edit-block reliability, or commit-message conventions) and because specs4 deliberately describes prompts by contract rather than duplicating their bodies. Drift between the source and the mirror is detectable via the sync script's check-before-write behavior. When the source tree is deleted or absent, the mirror becomes the authoritative reference. See `specs-reference/3-llm/prompts.md` for the index.

## Migration Status

This tree is being populated incrementally. See `specs4/7-future/specs-reference-migration.md` for design rationale and `specs4/7-future/specs-reference-migration-plan.md` for execution progress.