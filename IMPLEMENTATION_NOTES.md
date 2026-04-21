# Implementation Notes

**Temporary file — to be removed when implementation completes.**

## User Decisions (from initial Q&A)

1. **Scope:** Incremental, layer-by-layer.
2. **Repo state:** Fresh start — no existing source, only specs3 and specs4.
3. **Target:** Everything (full suite, eventually).
4. **Source:** All written from scratch against specs4.
5. **Prompts/snippets:** Write defaults guided by specs4 behavioral requirements.
6. **Python:** Target 3.14.
7. **Webapp package manager:** npm.
8. **jrpc-oo:** Upstream git URL (`git+https://github.com/flatmax/jrpc-oo.git`).
9. **Optional deps:** Wire graceful degradation from the start (KeyBERT, markitdown, PyMuPDF, LibreOffice, make4ht). User clarification pending — interpreted as "handle availability checks and graceful-degradation paths as each feature lands, not retrofitted later."
10. **Cadence:** Layer-by-layer; each response self-contained so a dropped response can be picked up. Each layer's delivery begins with a checklist of what's in that layer, so resumption is obvious.
11. **Tests:** Unit tests alongside each module as built. Python: pytest. Webapp: vitest.
12. **Deviation reporting:** In-chat discussion before implementing.

## Build Order (committed)

Layer 0 — project scaffolding (pyproject.toml, webapp/package.json, vite config, .gitignore, LICENSE, default configs + system prompts + snippets)
Layer 1 — foundation (RPC transport via jrpc-oo, configuration, repository/git)
Layer 2 — indexing (symbol index, document index, keyword enrichment, reference graph)
Layer 3 — LLM (context, history, cache tiering, prompt assembly, streaming, edit protocol, modes)
Layer 4 — features (URL content, images, code review, collaboration, doc convert)
Layer 5 — webapp (shell, chat, viewers, file picker, search, settings, specialized components)
Layer 6 — deployment (build, startup, packaging, release workflow)

Each layer ends with its unit test suite green before moving to the next.

## Deviations from specs3/specs4 (running log)

### D1 — Visible feature surfaces for missing optional deps (deviates from specs4)

specs4 says several features should be hidden when their optional dependency is missing:
- `doc-convert.md` — "Tab hidden entirely — no empty tab, no error"
- `tex-preview.md` — install instructions in preview pane (already visible, consistent)
- `document-index.md` — keywords simply absent (already visible, consistent)

**User decision:** Do NOT hide. Keep all feature entry points visible. When the user invokes a feature whose dependency is missing, show a clear message (toast or inline) stating:
- What dependency is missing
- What the feature would do if installed
- How to install it (pip extra, `brew install`, apt package, etc.)

Rationale: Hiding features makes them undiscoverable. A visible-but-informative failure surface teaches users about available capabilities and how to unlock them.

Applies to: markitdown (doc convert), KeyBERT/sentence-transformers (keyword enrichment), PyMuPDF, LibreOffice, make4ht (TeX preview).

### D2 — AC-DC branding expansion

specs4 doesn't define what AC-DC stands for beyond the spark bolt. User-provided canonical expansion: **AI Coder - DeCoder**. Use in README, about text, system prompts where branding is mentioned.

### D3 — New edit block delimiters (supersedes specs3)

specs3 specified the edit block delimiters as guillemet/box-drawing characters:
- Start: `««« EDIT`
- Separator: `═══════ REPL`
- End: `»»» EDIT END`

**User decision:** Switch to emoji-based delimiters for the reimplemented system:
- Start: `🟧🟧🟧 EDIT` (three orange squares)
- Separator: `🟨🟨🟨 REPL` (three yellow squares)
- End: `🟩🟩🟩 END` (three green squares)

Rationale: the color progression (orange → yellow → green) makes block boundaries visually obvious at any zoom level, surfaces malformed blocks immediately during review, and the emoji are unambiguously non-prose so they will never collide with legitimate code or documentation content.

Recorded in specs4/3-llm/edit-protocol.md under Block Structure.

**Scope of the change:**
- Backend edit parser must match on the new literal byte sequences
- Frontend segmenter must match on the new literal byte sequences
- System prompt (`config/system.md`) must instruct the LLM to emit the new markers
- System reminder (`config/system_reminder.md`) must reinforce the end marker as `🟩🟩🟩 END`
- No code has been written yet, so no refactor is needed — the new markers are the baseline

**Note on this conversation's tooling:** The edit blocks I emit in chat *during* this implementation work use the older specs3 guillemet markers (`««« EDIT` / `═══════ REPL` / `»»» EDIT END`) because that is what my current session's edit-application mechanism matches. The *content* I write into the reimplemented AC-DC system describes the new emoji markers as the protocol the reimplemented system will use. The two are separate concerns — my session tooling does not flow through to the reimplemented system's parser.

## Open Questions / Pending Clarifications

- None currently.

## Resumption Protocol

If a response drops mid-layer, the next response begins by:
1. Reading this file and the last committed file tree.
2. Stating "Resuming layer N: last completed file was X."
3. Continuing from the next file in the layer's checklist.

Each layer response starts with a checklist of files in that layer so progress is visible.

## Layer Completion Log

### Layer 0 — Project Scaffolding (complete)

**Delivered files:**

- `pyproject.toml` — package metadata, dependencies, optional extras (`docs`, `dev`, `build`), console script entry point, hatch + uv + pytest + ruff configuration
- `.gitignore`, `LICENSE` (MIT), `IMPLEMENTATION_NOTES.md`
- `src/ac_dc/__init__.py` — reads baked VERSION file, exposes `__version__`
- `src/ac_dc/__main__.py` — `python -m ac_dc` dispatcher
- `src/ac_dc/cli.py` — argparse CLI with the full flag set from specs4/6-deployment/startup.md; prints banner; Layer 0 honours `--version`/`--help` only
- `src/ac_dc/VERSION` — literal `dev` marker for source installs; release workflow bakes `YYYY.MM.DD-HH.MM-<sha>`
- `src/ac_dc/config/*` — bundled defaults:
  - `llm.json`, `app.json`, `snippets.json` (nested code/review/doc structure)
  - `system.md`, `system_doc.md`, `review.md`, `commit.md`, `compaction.md`, `system_reminder.md`
  - All prompts use the new emoji delimiters per D3
- `tests/test_cli.py`, `tests/test_package_metadata.py`, `tests/test_config_defaults.py`
- `webapp/package.json`, `webapp/vite.config.js`, `webapp/index.html`, `webapp/src/main.js` (Layer 0 scaffold), `webapp/src/main.test.js`

**Layer 0 test invariants verified:**

- `ac-dc --version` prints the baked version
- `python -m ac_dc --version` works via the `__main__` dispatcher
- All CLI flags from the spec parse cleanly (behavior not yet wired)
- Every bundled config file is valid JSON / non-empty markdown
- Every prompt uses the emoji delimiters; no specs3 guillemet markers remain
- `snippets.json` has all three modes (code/review/doc) with required fields
- Webapp helpers handle `?port=` correctly (valid, invalid, out-of-range, missing)
- Webapp always builds `ws://` (not `wss://`) and reflects `window.location.hostname`

**Decisions captured during Layer 0:**

- **D4 — Default Claude model versions.** Shipping `anthropic/claude-sonnet-4-5-20250929` as primary and `anthropic/claude-haiku-4-5-20251001` as smaller model. These are the current Claude 4.5 family IDs. Users with other providers override via Settings. Rationale: specs4 requires a provider-prefixed default; the current Sonnet/Haiku 4.5 pair matches the documented min-cacheable-tokens values (1024 for Sonnet, 4096 for Haiku 4.5 — handled model-aware in Layer 1).

- **D5 — `pyproject.toml` pins `litellm>=1.83,<1.84`.** Tight upper bound because litellm's usage-reporting field names have shifted between minor versions in the past. Layer 3 code will depend on stable field access; this makes the failure mode loud (dependency resolution error) rather than silent (missing cache fields at runtime). Loosen on deliberate upgrade + integration test pass.

- **D6 — `pytest-asyncio` mode = `auto`.** Avoids per-test `@pytest.mark.asyncio` boilerplate. Async tests arrive in Layer 1 (RPC transport) and increase in Layers 3/4; auto mode means every `async def test_*` just works.

- **D7 — Webapp uses vitest + jsdom, not Playwright.** Layer 0 has no DOM-bearing components yet, but the vitest config is already wired with `environment: 'jsdom'`. Playwright would be overkill for unit-level component behavior (Layers 2–5 of the webapp). Integration tests against a running server arrive with Layer 6.

- **D8 — No boot-up logging in the Layer 0 CLI.** The banner goes to stderr; there is no logger configured yet. Logging setup lands in Layer 1 alongside the first subsystem that actually needs leveled output (RPC transport). Deferring avoids a rework when the logging policy is defined.

- **D9 — `emptyOutDir: true` in vite.config.js.** Safe because `dist/` is gitignored and only ever contains build output; any stray file there is a mistake. Prevents stale assets from confusing the packaging step in Layer 6.

**Known deferrals from Layer 0:**

- Logging configuration → Layer 1
- Actual WebSocket server startup, port finding, browser opening → Layer 6
- Static file server serving `webapp/dist` → Layer 6
- Vite dev/preview subprocess management → Layer 6
- The app shell (Lit root component, RPC wiring, tab hosting) → Layer 5
- `webapp/package-lock.json` generation — left for the first `npm install` run on a real dev machine; pinning it inside this scaffolding step would create churn on the next dependency bump. **Decision for whoever runs first install:** commit the generated lockfile (standard npm practice — reproducible CI installs, collaborators get identical transitive deps). No gitignore change needed; lockfile is not excluded.
- **Webapp bundling into the wheel** → Layer 6. `pyproject.toml` originally had a `[tool.hatch.build.targets.wheel.force-include]` stanza mapping `webapp/dist` → `ac_dc/webapp_dist`, but hatchling's `force-include` errors when the source path is missing, breaking `uv sync` in dev checkouts where `webapp/dist` doesn't exist until `npm run build` has run. Removed the stanza and added a comment marker in `pyproject.toml` so Layer 6 knows to reintroduce it in the right shape — likely via a release-only config overlay, a pre-build hook that ensures `webapp/dist` exists, or a conditional-include pattern. Dev installs don't need the bundled webapp since they use the Vite dev server via `ac-dc --dev`.