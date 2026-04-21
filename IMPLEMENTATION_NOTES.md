# Implementation Notes — AC-DC reimplementation

Working log for the reimplementation of AC-DC against the specs4/ suite. Notes the contributor(s) need while building — layer progress, deliberate deviations from specs3, open questions, deferred work.

Remove when the project reaches feature parity with the previous implementation.

## Build order

Per `specs4/0-overview/implementation-guide.md#build-order-suggestion`:

0. **Layer 0 — scaffolding** — package skeleton, CLI entry, build config, webapp shell, tests
1. **Layer 1 — foundation** — RPC transport (jrpc-oo), configuration, repository
2. **Layer 2 — indexing** — symbol index, doc index, reference graph, keyword enrichment
3. **Layer 3 — LLM engine** — context, history, cache tiering, prompt assembly, streaming, edits, modes
4. **Layer 4 — features** — URL content, images, review, collaboration, doc convert
5. **Layer 5 — webapp** — shell, chat, viewers, file picker, search, settings
6. **Layer 6 — deployment** — build, startup, packaging

Each layer depends only on layers below. Complete and test each layer before proceeding.

## Decisions

Choices the user and I made during scaffolding that the specs do not prescribe and a future contributor should understand.

### D1 — Optional dependency failure surface

specs4 says missing optional deps (KeyBERT, markitdown, PyMuPDF, LibreOffice, make4ht) "degrade gracefully." User decision: surface failures **visibly** — UI toasts, log warnings with install hints. Never silently hide features that should work. Always explain why something can't run.

### D2 — Config directory layout

Per specs4/6-deployment/packaging.md:

- Linux / BSD: `~/.config/ac-dc/`
- macOS: `~/Library/Application Support/ac-dc/`
- Windows: `%APPDATA%/ac-dc/`

Managed vs user file sets as specified. `.bundled_version` marker tracks which release populated the directory.

### D3 — Edit block delimiters (emoji)

specs4/3-llm/edit-protocol.md locks in emoji-based delimiters:

- Start: `🟧🟧🟧 EDIT` (three U+1F7E7 orange squares)
- Separator: `🟨🟨🟨 REPL` (three U+1F7E8 yellow squares)
- End: `🟩🟩🟩 END` (three U+1F7E9 green squares)

The orange → yellow → green progression is deliberate — it makes malformed blocks (missing separator, missing end marker) visually obvious during review.

Deliberate change from specs3's guillemets (`«««`, `═══════`, `»»»`). Guillemets collide with legitimate content more easily (French prose, terminal box-drawing art), and my own edit-block parser collided with them during session resumption when quoting specs3 content verbatim.

All shipped system prompts (`system.md`, `system_doc.md`, `system_reminder.md`) reference emoji markers. Test `tests/test_package_metadata.py::test_edit_protocol_delimiters_are_defined_correctly` guards against regression.

### D4 — uv and pip both work

User chose `uv` as the development workflow. `pyproject.toml` uses PEP 621 metadata so `pip install -e .` works; PEP 735 `[dependency-groups]` provides the dev-deps group that uv reads natively.

Dev deps are duplicated into both `[project.optional-dependencies].dev` and `[dependency-groups].dev` so either toolchain works without special flags.

### D5 — Hatchling + direct references

`jrpc-oo` comes from its upstream git repo (see D8). Hatchling refuses direct references (`git+https://...`) in `[project]` by default — PEP 621 flags them as non-standard. We opt in via:

```toml
[tool.hatch.metadata]
allow-direct-references = true
```

Without this, `uv sync` / `pip install -e .` fails at build time.

### D6 — pytest-asyncio auto mode

`[tool.pytest.ini_options]` sets `asyncio_mode = "auto"`. Async test functions are picked up without per-test decorators.

### D7 — Webapp-as-bundle deferred

specs4/6-deployment/build.md calls for the final wheel to ship `webapp/dist/` at `ac_dc/webapp_dist/` so pip-installed releases serve the webapp without a separate npm build.

Hatchling's `force-include` fails loudly when the source path is missing, which would break `uv sync` in dev checkouts (webapp/dist exists only after `npm run build`). Layer 6 will wire this up properly — release-only config overlay, pre-build hook, or conditional include. For now the wheel is backend-only, which is correct for development and for `ac-dc --dev`/`--preview` modes that run Vite as a subprocess.

### D8 — jrpc-oo pinning

`jrpc-oo` comes from the upstream git repo rather than PyPI:

```toml
"jrpc-oo @ git+https://github.com/flatmax/jrpc-oo.git"
```

Direct git reference is authoritative until a PyPI release lands.

### D9 — Logging module moved into Layer 1

Layer 0's CLI stub used `print(..., file=sys.stderr)` for its banner. The logging subsystem is now part of Layer 1 so the first code that actually wants to emit structured logs (config loading, repo init) can use the standard `logging` API.

### D10 — Architectural contracts preserved from day one

`specs4/0-overview/implementation-guide.md#architectural-changes-from-specs3` lists changes in specs4 that are **contracts** — a reimplementer must preserve them even when specs3 describes an older pattern. Quick reference for Layer 1+ work:

| Area | specs3 | specs4 |
|---|---|---|
| Repository writes | Implicit single-threaded | Per-path mutex |
| Edit apply pipeline | Sequential | Re-entrant, per-file serialisation |
| Context manager | Singular | Multiple instances allowed |
| Stability tracker | Per-mode (two total) | Per-context-manager (N possible) |
| Single-stream guard | Any LLM request | User-initiated requests only |
| Chunk routing | Singleton passive flag | Keyed by request ID |
| Agent conversations | Unspecified | Transient, not persisted |
| Index mutation | Procedural timing | Read-only snapshots within a request |
| HUD breakdown | Session-global | Per-context-manager |

All are zero-cost in single-agent operation. Preserving them now means the foundation does not need reshaping when agent mode (specs4/7-future/parallel-agents.md) is added.

## Layer 0 — complete

Delivered:

- `pyproject.toml` with PEP 621 metadata, PEP 735 dependency groups, hatch build config, pytest + ruff configuration
- `src/ac_dc/__init__.py` with `__version__` computed from a baked VERSION file (falls back to `dev` in source installs)
- `src/ac_dc/__main__.py` — `python -m ac_dc` entry
- `src/ac_dc/cli.py` — argparse CLI matching specs4/6-deployment/startup.md#cli-arguments. Layer 0 honours only `--version` and `--help`; other flags parse cleanly but are ignored until their owning layer lands.
- `src/ac_dc/VERSION` — literal `dev` in source tree; release builds bake a timestamp+SHA string
- Full config bundle under `src/ac_dc/config/` — `llm.json`, `app.json`, `snippets.json`, `system.md`, `system_doc.md`, `review.md`, `commit.md`, `compaction.md`, `system_reminder.md`. All content written against the emoji edit delimiters (D3).
- `tests/` — package metadata, config defaults, CLI behaviour
- `webapp/index.html`, `webapp/src/main.js`, `webapp/vite.config.js`, `webapp/package.json` — Layer 0 shell that reads `?port=N`, logs a banner, and exits. Full shell lands in Layer 5.
- `webapp/src/main.test.js` — vitest coverage of port parsing and WebSocket URI construction, including the LAN-collab hostname rule.
- `README.md`, `LICENSE` (MIT, Flatmax Pty Ltd)

## Layer 1 — in progress

### 1.1 — Logging — **delivered**

- `src/ac_dc/logging_setup.py` — `configure(verbose: bool)` installs a single stderr handler, idempotent across repeated calls, caps noisy third-party libraries (websockets, litellm, urllib3, httpx, httpcore) at INFO even in verbose mode.
- `cli.py` calls `configure()` before the banner so future Layer 1+ call paths can emit structured logs from their first line.
- `tests/test_logging_setup.py` — covers idempotence, level switching, noisy-library capping, stderr target, format shape.

### 1.2 — Configuration — **planned**

`src/ac_dc/config.py` — `ConfigManager`:

- Config directory resolution (dev vs packaged; platform-specific user config dir)
- Version-aware upgrade (managed vs user files; backup naming)
- Accessor properties for all config sections (read-through, not snapshots — enables hot reload)
- Hot-reload methods (`reload_llm_config`, `reload_app_config`)
- Prompt assembly helpers (`get_system_prompt`, `get_doc_system_prompt`, `get_review_prompt`, `get_compaction_prompt`, `get_commit_prompt`, `get_system_reminder`, `get_snippets`)
- Per-repo `.ac-dc/` working directory + `.gitignore` management

`tests/test_config.py` — file resolution, upgrade flow, backup naming, accessor read-through, hot reload, snippet fallback chain, per-repo working dir creation.

### 1.3 — Repository — **planned**

`src/ac_dc/repo.py` — `Repo`:

- File I/O with path-traversal rejection, binary detection (null bytes in first 8KB), per-path async write mutex (D10 contract)
- Git staging, rename, delete, file tree with status, flat file list
- Diff (staged, unstaged, to-branch), commit, reset, search (grep with regex/whole-word/ignore-case/context-lines)
- Branch operations (current, list, list_all with remote dedup, is_clean, resolve_ref, commit_graph, commit_log, merge_base)
- Review support (checkout_review_parent, setup_review_soft_reset, exit_review_mode, get_review_changed_files, get_review_file_diff, get_diff_to_branch)
- TeX preview availability check only; `compile_tex_preview` lands in Layer 5/6
- `get_file_base64` lands in Layer 1 (SVG viewer needs it early)

`tests/test_repo.py` — throwaway git repos via `subprocess` + `tempfile`. No `pytest-git` dependency — subprocess-driven setup is simple and stable.

### 1.4 — RPC transport — **planned**

`src/ac_dc/rpc.py` — jrpc-oo integration:

- Port finding (scan from default, skip in-use ports)
- Service class registration helpers
- Placeholder `CollabServer` hook — real admission logic lives in Layer 4
- Event-loop reference capture helper (the capture-at-entry rule from specs4/3-llm/streaming.md — worker threads must use the captured loop, never re-acquire from inside)

`webapp/src/rpc.js` — `SharedRpc` singleton, `rpcExtract` envelope unwrap.
`webapp/src/rpc-mixin.js` — `RpcMixin(LitElement)` — components receive ready notifications, defer first call to the next microtask.

Tests: `tests/test_rpc.py` (async round-trip against a stub service), `webapp/src/rpc.test.js`, `webapp/src/rpc-mixin.test.js`.

### Layer 1 deferrals

- **Settings RPC service** — its restriction check (`_check_localhost_only`) belongs to Layer 4's collab module. Skipping the service class in Layer 1 rather than stubbing it; it lands with its siblings in Layer 3/4.
- **`Repo.compile_tex_preview`** — Layer 5 (TeX preview UI) brings make4ht invocation and asset-inlining logic. Layer 1 exposes only `Repo.is_make4ht_available()`.
- **URL cache filesystem operations** — Layer 4. Layer 1 only wires `ConfigManager.url_cache_config` accessor.

## Resumption protocol

If a response drops mid-layer, the next response begins by:

1. Reading the files currently in context (not relying on memory of what was delivered).
2. Identifying the last known good state — the latest complete file, the latest test that passed.
3. Continuing from there with one file per response when length is tight.

Do not rewrite files that are already complete. Do not quote large sections of previously-delivered content verbatim to "re-establish context" — the context window already carries the file state.

## Layer-transition checklist

Before declaring a layer complete:

- All test files in the layer pass locally (`uv run pytest tests/test_<module>.py` per module).
- `uv run pytest` passes overall — no regression in prior layers.
- `uv run ruff check src tests` has no errors (warnings OK in early layers).
- `IMPLEMENTATION_NOTES.md` marks the layer complete and opens the next layer's checklist.
- Any deviation from specs4 is recorded as a decision (D-N) in this file.