# specs3 Retirement via specs-reference/

**Status:** Plan — not yet executed. Captures decisions from a design conversation so they aren't lost.

## Why This Exists

specs3 was written against an earlier AC⚡DC implementation and contains a mix of content: behavioral descriptions that specs4 has already superseded, and implementation detail that specs4 deliberately abstracted away. The [implementation-guide.md — Where specs4 Is Incomplete Without specs3](../0-overview/implementation-guide.md#where-specs4-is-incomplete-without-specs3) table lists the specific detail areas where specs3 is still authoritative: byte-level formats, numeric constants, persistent storage schemas, RPC method signatures, dependency quirks, and similar.

As long as that table has live references, specs3 cannot be deleted. The goal of this plan is to close the table by promoting the still-authoritative detail into a companion reference tree, then retire specs3 entirely.

## The Shape of the Solution

A new top-level directory **`specs-reference/`** sits as a peer of `specs4/`, mirroring its path structure. Every `specs4/{path}/{name}.md` that needs accompanying detail gets a twin at `specs-reference/{path}/{name}.md`.

```
specs4/
  3-llm/
    edit-protocol.md                    — behavioral contract
  ...
specs-reference/
  3-llm/
    edit-protocol.md                    — byte-level detail, parser state machine, diagnostics
  ...
```

### The Mechanical Twin Rule

The relationship between specs4 and specs-reference is deliberately mechanical:

> When implementing from `specs4/{path}/{name}.md`, also load `specs-reference/{path}/{name}.md` if it exists.

One rule, one path transformation, no navigation judgment required. AI tooling that loads spec content can encode this as a simple path rewrite.

### Why Mirror, Not Topical

An alternative organisation — grouping by topic (`byte-formats.md`, `numeric-defaults.md`, `storage-schemas.md`, etc.) — was considered and rejected for the AI-consumption case:

- **Context window cost.** An AI implementing a specific feature wants exactly the reference for that feature. Topical files force loading unrelated content (waste) or extracting a subset (error-prone).
- **Predictable path.** The mirrored layout means the AI never has to decide "which topical file might this be in?"
- **Update discipline.** When a spec file changes, the mechanical rule says "update its twin." Topical layouts force a judgment call on every spec change about which topical files need updates.
- **Tooling alignment.** `grep`, file outlines, path-based loading all work cleanly on mirrored layouts.

### Why Side-By-Side, Not Nested

`specs-reference/` at the top level (peer of `specs4/`) rather than `specs4/reference/` inside:

- **Symmetry signals symmetry.** Two top-level trees tell the reader these are peers with a known relationship. Nesting would suggest reference is subordinate when the relationship is "authoritative detail companion to authoritative behavior."
- **Path transformation is cleaner.** `specs4/{path}` ↔ `specs-reference/{path}` is a top-level name swap, not a subtree descent.
- **Scales to future spec suites.** The `specs-*` convention absorbs `specs-examples/`, `specs-diagrams/`, etc. without accumulating subtrees under `specs4/`.
- **Name is self-documenting.** `specs-reference` tells you exactly what it is without needing a README to explain.

## What Goes Into specs-reference/

Reference material — detail specs4 deliberately leaves unspecified because it's too concrete for the behavioral contract but still load-bearing for interop or reimplementation. Categories:

- **Byte-level formats** — symbol map compact syntax, doc outline annotations (`←N`, `→target#Section`, `~Nln`, content-type markers), edit block marker bytes
- **Numeric constants** — tier entry-N and promotion-N values, cache buffer multipliers, model-specific cacheable minimums, compaction thresholds, debounce intervals
- **Persistent storage schemas** — JSONL history record field names, docuvert provenance header format, cache sidecar JSON structure
- **Config file schemas** — exact field names, nesting, legacy format fallbacks
- **RPC method signatures** — argument and return shapes, event payload structures (complements existing `rpc-inventory.md`)
- **Dependency quirks** — tree-sitter TypeScript function name, Vite optimizeDeps exclusion, PyInstaller hidden imports, Monaco worker configuration paths
- **System prompt text** — optional; the running system's `src/ac_dc/config/*.md` files are also authoritative and may not need duplication

## Twin File Structure

Standardise the twin layout so readers (human and AI) know where to look within a twin:

```markdown
# Reference: {Spec Name}

**Supplements:** `specs4/{path}/{name}.md`

## Byte-level formats
...exact marker bytes, exact delimiter specs...

## Numeric constants
...thresholds, timeouts, retry counts...

## Schemas
...JSONL fields, config keys, RPC payloads...

## Dependency quirks
...implementation-specific gotchas for this area...

## Cross-references
- Symbol map legend: `specs-reference/2-indexing/symbol-index.md`
- Prompt cache-control: `specs-reference/3-llm/prompt-assembly.md`
```

Sections empty or omitted when nothing applies. The standardised headings let the AI (or a human) know where to look within a twin without reading the whole file.

## Cross-Cutting Content

When detail genuinely spans multiple specs (e.g. a format produced by one spec and consumed by another), pick a **canonical owner** and have other twins link to it rather than duplicate.

Rule of thumb: the twin for the spec that *produces* the format owns it; twins for specs that *consume* it link. For example, edit block markers are owned by `specs-reference/3-llm/edit-protocol.md`; `specs-reference/5-webapp/chat.md` (which renders them) and `specs-reference/5-webapp/diff-viewer.md` (which intercepts them) link rather than duplicate.

This is the one place where topical thinking survives in the mirrored layout — canonical ownership matters because duplication creates drift risk when the same content must be updated in multiple places on every change.

## Empty-or-Minimal Twins Are Fine

Not every spec needs substantial reference content. Specs that are fully self-sufficient (their behavioral description covers everything a reimplementer needs) get twins with minimal content or just the file header pointing at the parent spec. The discipline is the mechanical twin rule, not filled-ness.

Creating empty twins preemptively has a cost (clutter) but a benefit (AI tooling doesn't have to check for existence on every load — the twin is always there, possibly empty). A reasonable compromise: create twins only when there's content to put in them, and document that the absence of a twin means "spec is self-sufficient."

## Migration Sequence

1. **Audit the table** in [implementation-guide.md — Where specs4 Is Incomplete Without specs3](../0-overview/implementation-guide.md#where-specs4-is-incomplete-without-specs3). For each row, confirm it identifies content to migrate vs content to drop.
2. **Create `specs-reference/` at the repo top level** with a `README.md` stating the mechanical twin rule and content conventions.
3. **Port one area at a time** — symbol map format first, then doc outline annotations, etc. Commit after each so the history is readable and reviewable.
4. **Update each area's table row** in the implementation-guide to point at the new `specs-reference/{path}` location instead of the old `specs3/{path}` location.
5. **Grep for lingering specs3 references** in specs4 files. The `specs4/impl-history/` files will have many — those are historical delivery records and should be left alone. The live specs4 files should have none.
6. **Update `specs4/README.md`** to mention the companion `specs-reference/` directory and the mechanical twin rule.
7. **Delete specs3.** The forward-looking contract is in specs4; the interop-critical details are in specs-reference; the incidental implementation detail of the previous build is gone on purpose.

## Scope Boundaries

### Stays in specs4

- All behavioral contracts and invariants
- Module decomposition and component responsibilities
- Data flow diagrams and lifecycle descriptions
- Design rationale and architectural decisions
- Everything currently in specs4 that isn't a byte-level or numeric detail

### Moves to specs-reference

- Items currently cited in the [Where specs4 Is Incomplete Without specs3](../0-overview/implementation-guide.md#where-specs4-is-incomplete-without-specs3) table
- Any additional concrete detail discovered during migration that specs4 intentionally leaves unspecified

### Stays in specs3 forever (nothing)

- specs3 deletion is the terminal step. After migration, nothing in specs3 should be load-bearing.

### Stays in impl-history/

- `specs4/impl-history/*.md` contains delivery records that reference specs3 extensively. These are historical; leave them alone. They document what was built against the old specs and serve as an archaeological record.

## What This Is Not

- Not a rewrite of specs4. Behavioral content stays where it is.
- Not a defense of specs3's current structure. specs3's internal organisation is an implementation artifact; specs-reference organises by the twin rule, not by specs3's layout.
- Not urgent. specs3 is harmless where it sits; the migration is a clarity-and-maintenance win, not a correctness fix.

## Open Questions

- **Do all specs4 files need twins?** Default position: no — create twins only when content exists to put in them. An AI implementing from a spec with no twin knows the spec is self-sufficient. Revisit if AI tooling struggles with the optionality.
- **What about the system prompt markdown files?** `src/ac_dc/config/*.md` are already authoritative for the shipped prompt text. A `specs-reference/3-llm/` entry could either duplicate (drift risk) or just reference the live config path. Probably the latter.
- **Should the `specs-reference/` README duplicate the mechanical twin rule, or reference it from elsewhere?** Probably duplicate — the README is the first thing a reader or AI will load when entering the tree, and the rule is short enough.