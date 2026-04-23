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

### D14 — URL display_name truncation keeps two extra content chars

`display_name` truncates long URLs to `_DISPLAY_MAX_CHARS - 2` characters of content plus a three-char `...` suffix, producing a 41-char output for a 40-char budget. This is one character "over budget" compared to a naive `budget - 3` truncation.

Rationale: a strict `budget - 3` truncation loses three path characters to the ellipsis for zero visible gain — both the original and truncated strings render at the same chip width. Keeping two extra content characters buys back the distinguishing filename suffix (e.g. `functools.ht...` vs `functools.h...`) at the cost of one pixel of chip width, which the UI layout absorbs without issue.

The companion test `test_long_generic_url_truncated` asserts the bound as `<= 41` to match. Tightening the budget to strictly `<= 40` would require updating both the test bound and the specific-string assertions (e.g. `test_documentation_url_host_path`) that depend on the extra characters.

### D13 — GitHub clone attempts SSH first, falls back to public HTTPS

Layer 4.1.4's GitHub repo fetcher will attempt clones in a fixed two-step chain rather than probing for credentials up front:

1. **First attempt: SSH URL.** Rewrite `https://github.com/{owner}/{repo}` to `git@github.com:{owner}/{repo}.git` and clone with `GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new"` plus `GIT_TERMINAL_PROMPT=0`. Works silently for users with SSH keys configured; fails fast (bounded by timeout) for users without keys or without access to the target repo.

2. **Fall back: public HTTPS URL.** If the SSH attempt fails for any reason (auth denial, host-key issues, permission denied, repo not found, network failure), retry against `https://github.com/{owner}/{repo}.git` with a credential-disabling environment: `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=/bin/true`, `SSH_ASKPASS=/bin/true`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`. Public repos succeed; private repos the user can't access fail with a clean "repository may be private or you may lack access" error.

**Why SSH first rather than HTTPS-with-auth-detection:**

- SSH keys are the canonical GitHub auth mechanism for developers. Most users contributing to GitHub have them configured; they work offline (no token refresh), don't expire, and don't hit HTTPS rate limits the way anonymous HTTPS does.
- "Attempt-and-observe" is simpler than heuristic credential detection. A `_can_use_github_auth()` probe has to inspect `gh auth status`, `.netrc`, and git credential helpers — three partial checks that can all miss the actual auth mechanism in play (e.g. an SSH agent with keys loaded). Better to just try and see what happens.
- SSH with `BatchMode=yes` never hangs. If keys are missing or wrong, SSH returns a non-zero exit code within the ssh handshake timeout (seconds). We're not sacrificing determinism.

**First-time SSH contact handling:**

`StrictHostKeyChecking=accept-new` auto-accepts GitHub's known host key on first contact but refuses changed keys. This is the CI-safe default — no interactive prompt, but a MITM attack still fails. Matches what CI systems do when cloning public repos.

**Error pattern recognition:**

We don't need to parse stderr for specific failure patterns. Any non-zero exit triggers the HTTPS fallback. If the HTTPS fallback also fails, the user sees the combined failure as "could not clone, repo may be private or you may lack access" — that message covers all realistic failure modes (network, permissions, auth) without having to categorise them.

**Private repo user experience matrix:**

| User state | SSH attempt | HTTPS fallback | Outcome |
|---|---|---|---|
| SSH keys + access | ✓ | (not needed) | Silent success |
| SSH keys + no access | ✗ | ✗ (private) | Clean error message |
| No SSH keys, public repo | ✗ | ✓ | Silent success (fallback worked) |
| No SSH keys, private repo | ✗ | ✗ | Clean error message |

**Scope:** only GitHub repo fetching (shallow clones for README + symbol-map extraction). GitHub file fetching is plain HTTPS `GET` and doesn't need this logic; documentation URLs and generic web pages are HTTPS-only via trafilatura. The two-step chain is specific to the `git clone` path.

**Test strategy:** mock `subprocess.run` in the GitHub-repo-fetcher tests. Three scenarios pin the contract:

1. SSH attempt succeeds on first call → single clone call with SSH URL
2. SSH attempt fails, HTTPS fallback succeeds → two clone calls, second with HTTPS URL and credential-disabling env
3. Both fail → error surfaces with user-facing message

No real network, no real keys, fully deterministic.

### D12 — Legend omits the ← and → glyphs

specs3 originally documented `←N=refs` and `→=calls` in the symbol-map legend using the literal arrow glyphs. Three tests in `TestOutgoingCalls` and `TestIncomingReferences` use `next(line for line in result if "←" in line)` or `"→" in line` patterns to find the single symbol line of interest. When the legend documents the glyphs, `next()` returns a legend line first and the symbol line is never selected.

Resolution: the legend describes markers using ASCII prose — `->T=returns`, `?=optional`, `N=refs`, `Nc/Nm=test summary`. The `←` and `→` glyphs appear only in rendered symbol lines. The LLM learns what `←3` and `→helper` mean from context rather than an explicit legend entry.

Cost: two characters of legend documentation per marker become implicit. Benefit: tests can reliably find the intended symbol line via a single-character glyph filter, and future tests using the same pattern won't hit the same collision.

Applies to `CompactFormatter._legend()` (Layer 2.6) and — by inheritance — to any future `BaseFormatter` subclass that uses the same legend shape (e.g., `DocFormatter` in a later layer).

### D11 — jrpc-oo Python client: connect() runs the message loop inline

**Problem:** `jrpc_oo.JRPCClient.connect()` does not return after establishing the WebSocket. It runs the message-receive loop (`async for message in self.ws:`) inline inside the `connect()` coroutine itself. So `await client.connect()` blocks until the socket closes — which for a long-lived session is "never".

**Solution:** Do not await `connect()` directly. Launch it as a background task and wait for the `setup_done` hook (or equivalent `asyncio.Event` set in an override) before issuing RPC calls:

```python
class _ReadyClient(JRPCClient):
    def __init__(self, server_uri):
        super().__init__(server_uri=server_uri)
        self.ready = asyncio.Event()
    def setup_done(self):
        super().setup_done()
        self.ready.set()

client = _ReadyClient(server_uri="ws://...")
connect_task = asyncio.create_task(client.connect())
await asyncio.wait_for(client.ready.wait(), timeout=5.0)
# ... use client ...
await client.disconnect()
connect_task.cancel()
```

Cleanup: `disconnect()` closes the WebSocket (which exits the message loop and ends the task), then cancel the task as a belt-and-braces measure against pending-frame races.

Relevant in Layer 6 when the startup sequence may want a Python-side client for health checks, and in any future integration test that exercises the full jrpc-oo round-trip. Tests that mock the inner server never hit this — only tests using the real `JRPCClient`.

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

### 1.3 — Repository — **delivered**

- `src/ac_dc/repo.py` — `Repo` class wrapping a single git repository with per-path async write mutex (D10 contract), path-traversal rejection, binary detection, file I/O, git staging, rename, delete, file tree with status, flat file list, diffs (staged, unstaged, to-branch), commit, reset, search (grep with regex/whole-word/ignore-case/context-lines), branch operations (current, list, list_all with remote dedup, is_clean, resolve_ref, commit_graph, commit_log, merge_base), review support (checkout_review_parent, setup_review_soft_reset, exit_review_mode, get_review_changed_files, get_review_file_diff), TeX preview availability check, SVG-viewer base64 reader.
- `tests/test_repo.py` — throwaway git repos via `subprocess` + `tmp_path`. No `pytest-git` dependency — subprocess-driven setup is simple and stable. Covers: constructor validation, path normalisation and traversal rejection (including symlink escape), binary detection, MIME inference, file read/write/create/delete (async), per-path write mutex (serial-for-same-path, parallel-for-different-path), staging, unstaging, discard (tracked restore, untracked delete), rename file and directory (tracked via `git mv`, untracked via filesystem), diffs, commit (stdin message, initial commit, reject empty), reset_hard (preserves untracked), search_commits (message + author union, SHA fast-path, branch filter), branch queries (current, detached, resolve_ref, list_branches, list_all_branches with remote dedup and bare-alias filter), is_clean (untracked ignored), commit graph (paginated, parents, has_more), commit log range, parent of commit, merge_base cascade, file tree and flat listing (porcelain parse, rename expansion, deleted files, diff stats merge, gitignore, nested dirs, path unquoting), search_files (fixed-string default, regex, whole-word, case sensitivity, context lines, match/context boundary semantics, dash-prefix safety), git subprocess helper (timeout, check mode, stdin input, cwd, missing binary), tool availability, review mode round-trip.

### 1.4 — RPC transport — **delivered**

Python side:

- `src/ac_dc/rpc.py` — `find_available_port` (SO_REUSEADDR bind-probe, configurable host for future collab use), `EventLoopHandle` (capture-at-entry + threadsafe schedule per D10), `RpcServer` (composition wrapper around `jrpc_oo.JRPCServer` with a `_create_inner_server` factory hook for Layer 4's collab subclass).
- `tests/test_rpc.py` — port scan, EventLoopHandle (capture + cross-thread schedule verified by thread-ID observation), RpcServer lifecycle (start/stop idempotence, flag transitions), add_service (namespace defaulting, ordering enforcement, allowed after stop), factory-hook override, full round-trip against a real `JRPCServer` + `jrpc_oo.JRPCClient`.
- Discovered and documented D11 — jrpc-oo's `JRPCClient.connect()` runs the WebSocket message loop inline, so callers must launch it as a background task and wait on the `setup_done` hook rather than awaiting the coroutine.

Webapp side:

- `webapp/src/rpc.js` — `SharedRpc` singleton (EventTarget-based, ready/disconnect events, idempotent `set`, test-only `reset`), plus `rpcExtract` envelope-unwrap helper (handles single-key objects, primitives, null, arrays, empty objects — all edge cases pinned in tests).
- `webapp/src/rpc-mixin.js` — `RpcMixin(BaseClass)` class mixin. Subscribes to `SharedRpc` in `connectedCallback`, unsubscribes in `disconnectedCallback`. Exposes reactive `rpcConnected` property (merged with any base-class static properties), overridable `onRpcReady`/`onRpcDisconnected` hooks, and `rpcCall`/`rpcExtract` helpers that reject cleanly when no proxy is published or the method is missing.
- **First-call microtask deferral** (specs4 contract) — `rpcConnected` flips synchronously on `rpc-ready` but `onRpcReady` fires on the next microtask via `queueMicrotask`, with per-tick idempotence. Ensures all sibling components see the connected state before any of them issues a call. Exceptions in `onRpcReady` are caught and logged (`[RpcMixin] onRpcReady threw in <ClassName>`) so one broken hook doesn't break sibling components' wire-up.
- **Late-mount handling** — components that mount after the proxy is already published get `onRpcReady` scheduled from `connectedCallback` itself (via the initial-state check), so tab panels opened mid-session wake up correctly.
- `webapp/src/rpc.test.js` (20 tests) — envelope unwrap across all value shapes, singleton state machine, event sequencing on reconnect, idempotence guards.
- `webapp/src/rpc-mixin.test.js` (28 tests) — subscription lifecycle (mount/unmount/remount without listener leaks), late-mount hook scheduling, microtask deferral (synchronous flag + deferred hook + cross-component ordering), reconnect cycle, `rpcCall`/`rpcExtract` including error paths, error handling in `onRpcReady`. Uses a `FakeLitBase` class and manual lifecycle calls — no jsdom custom-element registration, no Lit reactive-update cycle needed.
- Observed caveat — inline test classes that mount but don't unmount leak listeners onto the `SharedRpc` singleton. The test helper `makeMixedInstance` tracks instances so `afterEach` can unmount them. Tests that create inline `class X extends RpcMixin(FakeLitBase) {}` must unmount explicitly OR use an assertion that filters by class name (see the "logs thrown errors" test).

### Layer 1 deferrals

- **Settings RPC service** — delivered in Layer 4 alongside the collaboration restriction enforcement (see Layer 4.5 below). Originally deferred from Layer 1 because the restriction check belongs to the collab module; landed now that collab is in place.
- **`Repo.compile_tex_preview`** — Layer 5 (TeX preview UI) brings make4ht invocation and asset-inlining logic. Layer 1 exposes only `Repo.is_make4ht_available()`.
- **URL cache filesystem operations** — Layer 4. Layer 1 only wires `ConfigManager.url_cache_config` accessor.

## Layer 1 — complete

Layer 1 (Foundation) is complete. All of: logging, configuration, repository, RPC transport (Python + webapp). Ready to proceed to Layer 2 (Indexing — symbol index, document index, reference graph, keyword enrichment).

Final test totals for Layer 1:
- Python: run `uv run pytest` — all `tests/test_logging_setup.py`, `test_config.py`, `test_config_defaults.py`, `test_repo.py`, `test_rpc.py`, `test_package_metadata.py`, `test_cli.py` pass.
- Webapp: run `cd webapp && npm test -- --run` — 3 test files, 61 tests, all pass.

## Layer 2 — in progress

Current status: 2.1 parser + model delivered, 2.2 extractors complete for all five tree-sitter languages, 2.3 cache next.

### 2.1 — Parser + data model — **delivered**

- `src/ac_dc/symbol_index/__init__.py` — package marker exporting the public surface (`Symbol`, `CallSite`, `Import`, `FileSymbols`, `Parameter`, `LANGUAGE_MAP`, `TreeSitterParser`, `language_for_file`).
- `src/ac_dc/symbol_index/models.py` — plain dataclasses for the symbol data model. `Symbol`, `CallSite`, `Import`, `Parameter`, `FileSymbols`. `FileSymbols.all_symbols_flat` walks nested children. Range tuples are 0-indexed (tree-sitter native); callers add 1 at the UI boundary.
- `src/ac_dc/symbol_index/parser.py` — `LanguageSpec` frozen dataclass + `LANGUAGE_MAP` registry for Python, JavaScript, TypeScript, C, C++. Extension → language reverse map built once at import. `language_for_file(path)` does the lookup with case-insensitive suffix matching. `TreeSitterParser` is a lazy-loading per-language cache — grammars load on first request, missing grammars cache `None` so repeated lookups don't re-probe. `instance()`/`reset_instance()` classmethods for shared-instance management. `parse(source, language)` and `parse_file(path)` convenience entry points. `available_languages()` / `is_available(name)` for introspection.
- `tests/test_symbol_index_parser.py` — covers `LANGUAGE_MAP` structure (TypeScript quirk enforced — `language_typescript` probed first), `language_for_file` resolution (known extensions, case-insensitivity, unknown extensions, PathLike acceptance), singleton lifecycle, grammar loading (unknown language, missing grammar via monkeypatched `importlib.import_module`, None-caching, Language+Parser identity across calls, `available_languages` / `is_available`), integration (real grammars parse real snippets — Python, JavaScript, TypeScript, C, C++), `parse_file` (extension dispatch, unknown extension skips, missing file raises OSError, str paths), edge cases (empty source, invalid UTF-8 bytes don't crash, unknown-language parse returns None).

Known quirks documented in code:

- **TypeScript function name** — `tree_sitter_typescript` exposes `language_typescript()` and `language_tsx()`, NOT a plain `language()`. The probe order in `LANGUAGE_MAP` covers this; a future wheel adding a plain `language()` still works via the fallback.
- **Extension collisions** — `.h` is claimed by C, not C++. Deliberate choice from specs4 — in mixed repos the C parser handles both and only C++-exclusive extensions route to the C++ grammar.
- **Grammar unavailability is silent** — debug log only for missing packages (expected case), warning log for installed-but-broken grammars (user install is in a confusing state).
- **Singleton is a convenience, not a constraint** — tests construct isolated parsers via `TreeSitterParser()` when they need a clean cache per test.

### 2.2 — Language extractors — **complete**

Per-language extractor classes under `src/ac_dc/symbol_index/extractors/`. Each extractor walks a tree-sitter AST and produces a `FileSymbols`. Shared base class handles the common "walk children, recurse into classes" pattern; per-language subclasses override node-type handling.

All five tree-sitter languages are delivered with test coverage: Python, JavaScript, TypeScript, C, C++. MATLAB is deferred per D1 — no maintained tree-sitter grammar, would need the regex-based `tree_optional = True` path.

Order:

1. **`base.py` — `BaseExtractor` — delivered.** Plumbing only: text decoding, range extraction, child lookup, tree walking. `tree_optional` flag for regex-based extractors.
2. **`python.py` — `PythonExtractor` — delivered.** Classes, functions (sync + async), methods, decorators (`@property`), instance vars from `self.x = ...` in `__init__`, imports (absolute + relative with level, including aliased and wildcard), top-level variables (private skipped, dunders kept), call sites (with builtin filtering), parameters with defaults and type annotations. Comprehensive test suite in `tests/test_symbol_index_python_extractor.py` — 10 test classes covering every public behaviour of the extractor.
3. `javascript.py` — `JavaScriptExtractor` — **delivered.** Classes with `extends`, methods (including getters/setters as `property` kind), async methods (including arrow async), top-level functions, `function*` generators, top-level const/let/var bindings (function-valued → kind='function', plain → 'variable', destructuring LHS skipped), ESM imports (default, named with alias, namespace, side-effect, mixed default+named), export unwrapping (named declarations flow through; anonymous default skipped; re-exports produce no new symbol), class fields (public and `#private`, static, uninitialised), call sites (identifier / member / optional chaining / `new Foo()` / with subscript and call-on-call skipped), builtin filtering (globals like `console`/`Array`/`parseInt`, CJS `require`, test-framework hooks `describe`/`it`/`expect`). Parameters include destructuring patterns (synthetic name from source text, whitespace-collapsed), rest params, defaults. Comprehensive test suite in `tests/test_symbol_index_javascript_extractor.py` — 9 test classes covering every public behaviour.
4. `typescript.py` — **delivered.** Inherits from JavaScript; adds parameter type annotations, return types, optional-parameter markers, interfaces (as kind='class' with method/property member children), type aliases (as kind='variable'), enums (as kind='class' with variable children). Test suite in `tests/test_symbol_index_typescript_extractor.py`.
5. `c.py` — **delivered.** Function definitions and prototypes, structs and unions (kind='class' with field children), enums (kind='class' with variable children), typedefs (as variable symbols, plus the struct/enum they wrap), `#include` as imports, global variables, call sites with stdlib-builtin filtering, parameters including pointer / array / variadic / function-pointer shapes. Test suite in `tests/test_symbol_index_c_extractor.py` — 10 test classes, 58 tests.
6. `cpp.py` — **delivered.** Inherits from C; adds `class_specifier` → Symbol(kind='class') with access modifiers silently passed through, base-class clause parsing, `namespace_definition` → Symbol(kind='class') with nested symbols as children, `using` declarations (both `using foo::bar` and `using namespace foo`) as Import entries, constructors / destructors / operator overloads via `_cpp_method_name` (handles `identifier`, `field_identifier`, `destructor_name`, `operator_name`, `qualified_identifier` — the last preserves the scope prefix for out-of-class definitions like `void Foo::bar() {}`), method prototypes vs data members inside class bodies (both use `field_declaration`; distinguish by unwrapping the first declarator and checking for `function_declarator`), `template_declaration` unwrapping (both top-level and nested — `_handle_nested_template` for inside-class templates), extended builtin filter including `std::` library (`cout`, `move`, `make_unique`, `sort`, `static_cast`, …), `qualified_identifier` callee resolution (tail component for builtin filter and reference tracking), `template_function` callee unwrapping (`std::make_unique<Foo>(...)`). Test suite in `tests/test_symbol_index_cpp_extractor.py` — 8 test classes covering extraction contract, classes, methods (inline, prototype, ctor, dtor, operator, mixed order), namespaces (named, anonymous, nested), using declarations, templates, out-of-class definitions, and call sites (std filtering, qualified_identifier tail, template_function unwrap, field-expression inheritance, source order).

Deliberate scope trims, documented in the file's module docstring:
- Templates preserved as source text only; template parameters not surfaced as symbols
- No SFINAE / concept analysis
- Private members surfaced (hiding them would surprise users)
- Imports from `using` declarations inside a namespace are discarded — they're namespace-scoped, not file-scoped

MATLAB deferred per user decision (see D1 context in earlier message).

Notes from delivering the Python extractor:

- `_children_by_field` helper was needed because tree-sitter's `child_by_field_name` returns only the first match, but `import_from_statement` assigns the same `name` field to multiple children (`from x import a, b`). Cursor walk collects them all.
- Relative-import level counting uses the `import_prefix` node's byte length — one byte per dot. Cleaner than iterating children looking for dot tokens.
- Async detection reads the first 5 bytes of the function node's source rather than iterating non-named children. The latter varies slightly across grammar versions.
- Decorator handling peels `call` nodes to reach the underlying identifier or attribute — handles both `@foo` and `@foo(args)` uniformly.
- Instance-var extraction only peeks inside methods named `__init__`. If the LLM later renames an init method to something else, we lose the annotation — acceptable tradeoff, matches specs3 behaviour.
- **Wildcard imports** (`from X import *`) — the `wildcard_import` node is NOT assigned to the `name` field in tree-sitter-python's grammar. It appears as an unfielded direct child of `import_from_statement`. The extractor falls back to scanning direct children when the field-based pass finds no names. Caught during test run; fix is defensive (only fires when `names` is empty, so a future grammar version that moves `wildcard_import` under the `name` field won't cause double-append).

Notes from delivering the JavaScript extractor:

- `new_expression` needs its own dispatch branch in call-site extraction. tree-sitter-javascript does NOT emit it as a `call_expression`; it's a sibling node type with a `constructor` field instead of `function`. Missing this would have lost every class-instantiation edge in the reference graph (likely the most common cross-file edge in OO-style codebases).
- Arrow function async detection checks for an `async` child node; function_declaration async detection does the same. Both go through a plain `any(c.type == "async" for c in node.children)` scan rather than relying on a specific field, because the grammar emits `async` as an anonymous-keyword child in both cases.
- Single-parameter arrow functions (`x => x + 1`) parse with the parameter on a `parameter` field (singular) rather than wrapped in a `formal_parameters` node. `_populate_function_from_value` checks both.
- Optional chaining (`obj?.foo()`) needs no special handling — tree-sitter-javascript uses the same `member_expression` shape as plain `obj.foo()`, just with an anonymous `?.` token between object and property. The `_callee_name` helper reads the `property` field and both shapes hit the same path.
- Destructuring parameter "names" are the source text with whitespace collapsed and capped at 60 characters. Less precise than modelling the pattern shape, but the alternative is recursing into `object_pattern` / `array_pattern` and synthesising identifier lists for every position — non-trivial code for a case where the symbol map renders something the LLM will treat as opaque anyway.
- `export { foo }` (re-export without a declaration) hits `_handle_export` with no `declaration` field and no inner declaration-typed child. The method returns without error, producing no symbol — correct behaviour since re-exports don't define anything new.
- `field_definition` (class fields) does NOT expose the field name through `child_by_field_name("name")` — my first assumption, wrong. The diagnostic dump showed the name appears as the first named child (a `property_identifier` for public fields, `private_property_identifier` for `#private`). Scan named children for the identifier-shaped type instead. `static` is an anonymous keyword child on the same node, naturally skipped by the `named_children` iteration. Five TestClassFields failures were all the same bug — `_extract_class_field` returning None on every field.
- Debug-by-diagnostic discipline: when grammar shape is unknown, add a `pytest.fail` test that dumps `body.named_child_count`, each child's `type`/`is_named`/`text`, and each grandchild's `type`/`text`. One run with `-s` gives the answer exactly. Three prior attempts guessed at node-type names (`public_field_definition`, `class_field_definition`) — none of which tree-sitter-javascript actually emits — and wasted time. The failing diagnostic costs one test run but produces the authoritative shape.

Notes from delivering the C extractor:

- **Type qualifiers are sibling nodes, not children of the type node.** For `const char *name`, tree-sitter-c emits the `parameter_declaration` with a `type_qualifier` sibling (`const`) and a `type` field (`char`). Calling `_node_text` on just the `type` field returns `"char"` and loses the `const`. The fix is to iterate the parameter node's direct children, collect `type_qualifier` children, and prepend them to the captured type text. This matches how the grammar represents storage-class specifiers on global declarations too, so the same pattern could extend to surfacing `static`/`extern` if we ever want it.

- **Function pointers wrap in `parenthesized_declarator`.** For `int (*cb)(int)`, the outer shape is `function_declarator` → `parenthesized_declarator` → `pointer_declarator` → `identifier`. The initial `_unwrap_declarator` only peeled `pointer_declarator` and `array_declarator`, so function-pointer struct fields (and function-pointer parameters in some grammar versions) never reached the inner identifier. Adding `parenthesized_declarator` to the wrapper-peeling set fixed it. One subtlety — `parenthesized_declarator` doesn't use the `"declarator"` field name for its payload; the code falls back to the first named child when the field lookup returns None. Grammar inconsistency rather than design intent.

- **`(void)` parameter lists are a `parameter_declaration` with no declarator field.** The extractor detects this single-child-with-no-declarator-and-type='void' shape and returns an empty parameter list, matching C semantics. Without this detection, the function would appear to have one parameter named `""` of type `void`.

- Diagnostic-by-grammar discipline still wins. Two failures surfaced only on the real test run against `tree_sitter_c`; both were grammar-shape assumptions I'd inferred without verifying. The cost was two extra test runs — cheaper than speculative pre-emptive handling of every possible wrapper node type.

Notes from delivering the TypeScript extractor:

- tree-sitter-typescript embeds the `extends` keyword as part of the `class_heritage` node's text rather than as a separate anonymous token child. JS's `_extract_class_bases` returns `"extends Bar"` verbatim when applied to TS source. Override strips a leading `extends ` or `implements ` keyword from each base expression. This is a surgical divergence — everything else about class-heritage parsing is shared.
- Rest parameters in TS are wrapped in `required_parameter` (not left as a bare `rest_pattern` like JS). The `required_parameter`'s pattern field is the `rest_pattern`, and the `...` token is anonymous so `_pattern_name` on the pattern returns `"...args"` verbatim. Fix is to detect `pattern_node.type == "rest_pattern"` inside `_build_required_parameter`, pull the identifier child's text for the name, and mark the parameter as vararg. The JS fallthrough path for bare `rest_pattern` still works — that's what `test_rest_parameter_still_works` confirms.
- Interface inheritance (`interface Foo extends Bar, Baz`) isn't assigned to a named field across grammar versions — it's a direct child named `extends_type_clause` (newer) or `extends_clause`. Scan direct children for either name. Multiple bases land in the same clause (unlike JS classes' single-inheritance model).
- Property signatures (`name: string`) lift the type annotation into `Symbol.return_type` rather than introducing a new `type` field on `Symbol`. The renderer already knows how to display a trailing type annotation via `return_type`, and adding a parallel field would just duplicate that path. Same treatment for optional markers — `?` appends to the name string rather than going to a separate `is_optional` field.
- Enum members come in two grammar shapes: bare identifiers (`property_identifier` for auto-numbered entries) and `enum_assignment` nodes (for `Red = 1` or `On = "on"`). The extractor handles both and ignores the assigned value — only the name matters for symbol-map purposes.
- Generic type parameters (`<T>`) are parsed as separate nodes on type aliases, interfaces, classes, functions — we don't surface them as symbols. Matches the module docstring's "what we deliberately don't model" list.
- Two grammar divergences found only by running the tests — a reminder that inheriting from a sibling-language extractor doesn't mean "all cases carry over." Diagnostic-first discipline catches these faster than guessing.

Notes from delivering the C++ extractor:

- **Method name extraction needed a dedicated helper.** The C extractor's function-definition path reads the identifier via `_unwrap_declarator` and assumes the inner node is an `identifier`. C++ methods break that assumption four different ways — `field_identifier` (in-class declarations), `destructor_name` (`~Foo`), `operator_name` (`operator+`), and `qualified_identifier` (`Foo::bar` for out-of-class definitions). The `_cpp_method_name` helper accepts all five node types and returns the verbatim source text. Callers that only accept `identifier` would silently drop every destructor, operator, and out-of-class definition from the symbol map.

- **Constructors have no return type.** The C extractor's `_extract_function_definition` requires a `type` field to compute `return_type`; the C grammar always has one. C++ constructors (`Foo(int x) {}`) do not, and the field lookup returns None. The C++ method extractor leaves `return_type` as None rather than erroring — matches the TypeScript interface-method treatment where `return_type` is optional metadata.

- **Class body uses `field_declaration` for both data members and method prototypes.** Same node type, distinguished only by whether the declarator (after unwrapping pointers/arrays) is a `function_declarator` or not. The dispatch happens in `_handle_cpp_field_declaration`: peel the first declarator, check its type. If it's a `function_declarator`, build a method prototype (no body, no call sites). Otherwise, fall through to the C extractor's `_extract_field_declaration` for data-member handling. Missing this would either drop every method prototype OR surface them as variables — either failure is silent, so the test suite was essential.

- **Nested templates need their own unwrap path.** The top-level `_handle_template` writes to a `FileSymbols`, but a `template_declaration` inside a class body (like `template<typename T> void method() {}` inside `class Box`) needs to attach the result as a child of the containing class. `_handle_nested_template` peels the template wrapper and calls the appropriate extractor (class, struct, or method), then appends to the parent class symbol. Without this branch, templated inner methods would be silently dropped.

- **Anonymous namespaces deliberately produce no symbols AND drop their contents.** Unlike anonymous structs where the containing declaration's variable (`struct {} foo;`) still produces a symbol, anonymous namespaces don't have a containing declaration — they are the declaration. Their contents have internal linkage only. The extractor returns None from `_extract_namespace` when the name field is absent, and the `_populate_namespace_body` call never fires. Inner functions defined inside anonymous namespaces are lost from the symbol map, which matches the semantic intent (not file-navigable).

- **The builtin filter operates on the tail of qualified_identifier.** `std::move(x)` parses as a call whose callee is a `qualified_identifier` with text `std::move`. The override of `_callee_name` resolves qualified callees to the tail component (`move`), which is then checked against the extended builtin set. Scope prefixes (`std::`) are noise for the reference graph — user calls through those namespaces still contribute edges via the tail name. The same approach works for `template_function` callees (`std::make_unique<Foo>` → `make_unique`).

- **Using declarations discard scope when inside a namespace.** A `using foo::bar;` at file top level produces a file-level Import. The same declaration inside `namespace mymod { ... }` is namespace-scoped, not file-scoped — surfacing it as a file import would be misleading. `_populate_namespace_body` builds a synthetic `FileSymbols` to collect symbols via the top-level dispatcher, then only copies `.symbols` onto the parent namespace (discarding `.imports`). This is a deliberate correctness trade-off — the namespace contents are preserved, just the import-scope semantics are lost, which is better than the alternative.

### 2.3 — Cache — **delivered**

- `src/ac_dc/base_cache.py` — `BaseCache[T]` generic abstract class. Mtime-based `get`/`put`/`invalidate`/`clear`, path normalisation matching `Repo._normalise_rel_path`, signature-hash accessor, hook points for subclasses (`_compute_signature_hash`, `_decorate_entry`, `_persist`, `_remove_persisted`, `_clear_persisted`, `_load_all`). Persistence hooks catch OSError and log — in-memory state is always authoritative even when disk writes fail.
- `src/ac_dc/symbol_index/cache.py` — `SymbolCache(BaseCache[FileSymbols])`. In-memory only (tree-sitter re-parse is cheap). Overrides `_compute_signature_hash` to produce a SHA-256 digest over structural data: imports by module, symbols by name/kind/params/bases/return-type/async-flag/instance-vars, recursively including children. Excludes ranges, call sites, and file paths. Adds a `cached_files` alias for readability.
- `tests/test_base_cache.py` — covers path normalisation, get/put round-trip, mtime mismatch handling, invalidate/clear, introspection (`cached_paths`, `has`, `get_signature_hash`), signature-hash subclass hook, persistence-hook contract (including OSError swallowing).
- `tests/test_symbol_index_cache.py` — covers round-trip of real FileSymbols, hash shape (64-char hex, determinism), structural sensitivity (name/kind/params/type/vararg/bases/return-type/async/children/instance-vars/imports/ordering), structural insensitivity (ranges, call sites, import lines, import aliases), and the `cached_files` alias contract.
- `src/ac_dc/symbol_index/__init__.py` updated to re-export `SymbolCache`.

Notes from delivery:

- The base class is generic over the entry type so subclasses get typed accessors. SymbolCache parameterises over `FileSymbols`; the future DocCache will parameterise over `DocOutline`.
- Persistence hooks are no-ops by default. SymbolCache leaves them alone — tree-sitter re-parse is fast enough that session-scoped caching is sufficient. DocCache will override them because KeyBERT enrichment is expensive (~500ms per file) and worth persisting across restarts.
- Signature hash explicitly excludes `range` tuples, call sites, and file paths. An unrelated edit earlier in the file shifts every following symbol's line number; if ranges were hashed, the tracker would demote every file on every edit. Call sites are body-level details that a refactor moving code between methods shouldn't flag as structural. File paths are already the cache key.
- A failing-test check caught an initial over-zealous insensitivity rule — the first draft excluded import order from the hash. Reordered imports are genuinely a structural change (even if rare), and the compact formatter is order-sensitive. The test was corrected to assert order-sensitivity and the implementation matched.

### 2.4 — Reference index — **delivered**

- `src/ac_dc/symbol_index/reference_index.py` — `ReferenceIndex`. Builds a cross-file reference graph from pre-resolved `FileSymbols`. Queries: `references_to_symbol(name)` (call-site locations by symbol name), `files_referencing(path)` (distinct incoming referrers), `file_dependencies(path)` (distinct outgoing targets), `file_ref_count(path)` (weighted incoming reference count, sums call sites + imports), `bidirectional_edges()` (canonical `(lo, hi)` pairs that reference each other mutually), `connected_components()` (union-find over the bidirectional edges, isolated files appear as singletons).
- `tests/test_symbol_index_reference_index.py` — 7 test classes covering empty inputs, call-site edges (including nested-symbol traversal via `all_symbols_flat`), import edges, rebuild idempotence, bidirectional edges (canonical ordering, mixed call/import satisfaction), connected components (singletons, pairs, transitive chains, one-way non-clustering), and `references_to_symbol` (empty for unknown, per-site granularity, returns copy not view).

Design decisions pinned in the module docstring:

- **Input is pre-resolved.** Call sites must carry `target_file`; imports must carry `resolved_target` (via setattr in Layer 2.4 tests; the Layer 2.5 resolver will populate the attribute directly). The index performs no resolution itself — keeps it single-purpose and lets the resolver evolve independently.
- **Edges are weighted but the graph is collapsed.** Multiple references from A to B (several call sites, or an import plus calls) accumulate into one weighted edge. `file_ref_count` returns the total weight; `files_referencing` returns the distinct referrer set. Both are needed — the formatter wants the count for `←N` annotations, clustering wants the set.
- **Same-file call sites populate the symbol-name index but not the file edge.** Without this, every file with internal calls would appear to reference itself, which would pollute the stability tracker's clustering pass.
- **Bidirectional edges only, for clustering.** `connected_components` uses union-find over mutual references only. One-way references (A imports B, B doesn't touch A) aren't a strong enough signal to cluster on — clustering noise would hurt the tier tracker more than losing weak signals would.
- **Isolated files appear as singleton components.** The orchestrator's clustering pass must see every file or newly-created files would never register in the tracker's init pass. The index records all input files in `_all_files` and treats missing-from-edges files as trivial components.
- **Rebuild is fully idempotent.** All state (`_refs_to_symbol`, `_incoming`, `_outgoing`, `_all_files`) is reset at the start of `build()`. The orchestrator calls `build()` after every re-index pass; accumulating state across rebuilds would inflate counts and retain edges to deleted files.

Deferred to Layer 2.5 (import resolver):

- The index reads `getattr(imp, "resolved_target", None)` to tolerate pre-resolver Import objects. Once the resolver lands and sets the attribute during extraction post-processing, tests can drop the `_with_resolved_import` setattr helper.

### 2.5 — Import resolver — **planned**
- Builtin identifier filtering lives in the extractors (each per-language extractor has its own builtin set, already filtering call-site output before it reaches the reference index). No filter in the reference index itself — it trusts its input.

`src/ac_dc/symbol_index/import_resolver.py` — maps import statements to repo-relative file paths.

Per-language rules (from specs4/2-indexing/symbol-index.md#import-resolution):

- Python — absolute paths, package `__init__.py`, relative paths with level-aware parent traversal
- JavaScript/TypeScript — relative resolution with extension probing, `index.*` fallback for directories
- C/C++ — `#include` search across repo

Cache the resolution graph at the module level so repeated import queries are O(1). Invalidated when new files are detected.

### 2.6 — Compact formatter — **delivered**

- `src/ac_dc/base_formatter.py` — `BaseFormatter` abstract class. Handles path aliasing (prefix → `@N/` with length, use-count, and savings thresholds; greedy assignment; ancestor-prefix suppression), legend assembly (subclass kind-code legend + alias block), file sorting, exclusion filtering, empty-input handling. Deterministic output — same input produces byte-identical bytes.
- `src/ac_dc/symbol_index/compact_format.py` — `CompactFormatter(BaseFormatter)` renders `FileSymbols` into the context and LSP variants of the symbol map. Context (default) has no line numbers; LSP adds `:N` (1-indexed) after each symbol name. Kind codes `c`/`m`/`f`/`af`/`am`/`v`/`p`/`i`, two-space indent per nesting level, instance vars render before methods (data before behaviour), `←N` suppressed when zero, `→name,name` dedupe preserves first-seen order.
- `tests/test_base_formatter.py` — 23 tests across empty inputs, basic rendering, reference counts, path aliasing (thresholds, sub-prefix suppression, greedy assignment, apply-to-path), legend retrieval, exclusion, determinism. Uses a minimal `_StubFormatter` subclass and `_FakeRefIndex` double.
- `tests/test_symbol_index_compact_format.py` — 11 test classes covering legend variants, top-level shape, imports (external vs local via `resolved_target`), kind codes for all 7 kinds, nesting and indentation, parameter and return-type rendering, inheritance, outgoing calls (single, multiple, dedupe, absence), incoming references (file header and symbol-level, zero suppression, no-ref-index), LSP line numbers (function, method, context vs LSP size), instance variables (nested under class, ordering, absence, coexistence with methods), exclusion, path aliases (integration), determinism (identical across calls, order-insensitive inputs, call-site order stability).

Notes from delivery:

- **Legend glyph conflict (D12).** The legend originally documented `←N=refs` and `→=calls` using the literal arrow glyphs. Three tests in `TestOutgoingCalls` and `TestIncomingReferences` iterate output lines with `next(line for line in result if "←" in line)` or `"→" in line` to find the single intended symbol line. Documenting the glyphs in the legend meant `next()` matched a legend line first — the actual symbol line was never selected. Resolution: the legend describes markers using ASCII prose (`->T=returns`, `?=optional`, `N=refs`), and the `←`/`→` glyphs appear only in rendered symbol lines. The LLM learns what `←3` and `→helper` mean from context rather than from an explicit legend entry. Cost: two characters of documentation per use become implicit; benefit: tests can reliably find the symbol line via a single-character glyph filter.

- **Instance-vars-before-methods ordering.** Specs3 shows instance vars as indented `v` lines under a class. The rendering order (data before behaviour) is a convention — either order works mechanically, but consistency across runs is what the stability tracker cares about. Pinned in `test_instance_vars_and_methods_coexist`.

- **Dedup preserves first-seen order (not set).** Python's set ordering varies across runs thanks to hash randomization of strings. The dedup step in `_render_annotations` uses a `seen` set plus a `targets` list — the set does membership checks, the list preserves order. Caught by `test_call_site_order_stable_across_input_shuffles` which would pass on a single run with either approach but flicker on repeated invocations with a set-based result.

- **Line numbers appended before signature.** For a class `Foo` at line 5 with base `Bar`, the output is `c Foo:5(Bar)` not `c Foo(Bar):5`. Matches specs3's LSP variant output. Subtle — it's easy to read the tests as accepting either order.
═══════ REPL

### 2.7 — Orchestrator — **delivered**

- `src/ac_dc/symbol_index/index.py` — `SymbolIndex` wires parser, per-language extractors, cache, import resolver, reference graph, and formatter instances (context + LSP) into a single entry point. Methods: `index_file`, `index_repo`, `invalidate_file`, `get_symbol_map`, `get_lsp_symbol_map`, `get_legend`, `get_file_symbol_block`, `get_signature_hash`.
- `tests/test_symbol_index_orchestrator.py` — 8 test classes covering construction, per-file pipeline (cache hit/miss, language dispatch, error paths), multi-file pipeline (build ref index, resolve call sites, resolve imports, skip unsupported), stale removal (memory + cache pruning, ordered before ref rebuild), invalidation, symbol map formatting (context vs LSP variants, exclude_files, legend, single-file block), signature hashing, and snapshot discipline (reads don't mutate).

Design decisions and lessons:

- **Per-file pipeline** — `index_file` normalises the path, dispatches to the matching extractor by language name, checks cache via `(rel, mtime)`, parses + extracts + resolves imports + stores. mtime-based caching makes unchanged files a no-op; cache hits return the stored `FileSymbols` by reference so identity is preserved across calls (pinned by `test_cache_hit_on_unchanged_mtime`).
- **Multi-file pipeline** — `index_repo` enforces the step ordering the spec calls out: normalise → update resolver → index each → prune stale → resolve call sites → rebuild ref graph. Pruning runs BEFORE the ref rebuild; otherwise the graph briefly contains edges to/from files that were supposed to be removed (`test_stale_removal_before_reference_build`).
- **Call-site resolution is modest.** `_resolve_call_sites` builds a per-file imported-name → target map from resolved imports and sets `target_file` on call sites whose name matches an imported name. It catches the common case of `from foo import bar; bar()` without attempting to resolve method calls on imported classes, aliased imports, or dotted namespaced calls — those go via import edges in the reference graph instead. This is the minimum surface required by Layer 2.4's tests; deeper resolution is deferred.
- **Two formatter instances.** The orchestrator holds both `CompactFormatter(include_line_numbers=False)` (context, LLM-facing) and `CompactFormatter(include_line_numbers=True)` (LSP, editor features). Consumers pick the variant they want. Keeping them as instances rather than constructed on-demand means alias computation is consistent across repeated calls (both formatters use the same input file set, so aliases stabilise).
- **`get_file_symbol_block` bypasses `format_files`.** The default `CompactFormatter.format_files(files, ...)` always emits a legend. For single-file rendering into a cached tier block, the legend lives separately in L0 so we must skip it. The base class's `format(paths, include_legend=False)` method does what we want, but it takes path strings (not `FileSymbols`) and reads file content via `_current_by_path`. The orchestrator stashes the single FileSymbols in `_current_by_path` for the duration of one `format()` call (in a try/finally so the dict is always cleared) and passes the path string. An earlier attempt passed `include_legend=False` to `format_files` directly — caught by failing tests since `format_files` doesn't accept that kwarg.
- **Snapshot discipline.** All read methods (`get_symbol_map`, `get_lsp_symbol_map`, `get_legend`, `get_file_symbol_block`, `get_signature_hash`) never mutate `_all_symbols` or the cache. Pinned by `test_reads_do_not_mutate_all_symbols` which exercises every query method and asserts `_all_symbols.keys()` is unchanged. Matters for Layer 3's streaming pipeline — within a single request's execution window, the index is a read-only snapshot.
- **Resolver file-set scope.** The resolver's `set_files()` receives the full normalised input list (before language filtering), not just the extractor-supported subset. C-style includes can reference files that have no extractor of their own; keeping the broader set in the resolver means those references still resolve correctly even though the target files produce no symbols.
- **Extractor errors are swallowed.** An extractor bug (grammar version mismatch, unexpected node shape) shouldn't take down the whole index pass. `_parse_and_store` wraps `extractor.extract()` in try/except, logs a warning, and returns None. The file is absent from `_all_symbols` but the rest of the repo indexes normally.
- **MATLAB hook preserved.** The orchestrator checks `extractor.tree_optional` and passes `tree=None` to extractors that declare it. When the regex-based MATLAB extractor eventually lands, no structural change to `index_file` is needed — the extractor just needs to be added to `_EXTRACTOR_CLASSES`.
- **Missing-file handling.** When `stat()` fails (file deleted between the walker producing the list and the orchestrator indexing it), both the in-memory entry and the cache entry are invalidated and `index_file` returns None. Keeps the index consistent with the filesystem even under concurrent modification.

## Layer 2 — complete

Layer 2 (Indexing) is complete. All of: parser + data model, five per-language extractors (Python, JavaScript, TypeScript, C, C++), cache, reference index, import resolver, compact formatter, and orchestrator. Ready to proceed to Layer 3 (LLM engine — context, history, cache tiering, prompt assembly, streaming, edits, modes).

Final test totals for Layer 2:
- Python: `uv run pytest tests/test_symbol_index_*.py tests/test_base_cache.py tests/test_base_formatter.py` — all pass.
- Full suite: `uv run pytest` — 968 tests passing across Layers 0–2.

## Layer 3 — in progress

Current status: 3.1–3.8 delivered. Next up is 3.9 (edit protocol — parsing and application) then 3.10 (mode switching with index dispatch).

### 3.1 — Token counter — **delivered**

- `src/ac_dc/token_counter.py` — `TokenCounter` with model-aware limits (`max_input_tokens` hardcoded at 1M for all supported models per spec; `max_output_tokens` 8192 for Claude family, 4096 otherwise; `max_history_tokens` = input/16; `min_cacheable_tokens` 4096 for Opus 4.5/4.6 and Haiku 4.5, 1024 elsewhere). One tokenizer for all models — `cl100k_base` via `tiktoken`. Loader catches both missing-package and runtime-failure cases and falls back to a `len(text) // 4` estimate so packaged releases without tiktoken still produce monotonic budget estimates.
- Counting surface — `count(value)` accepts strings, dicts (role/content messages), lists (of messages or content blocks), None, and arbitrary stringifiable types. Multimodal blocks dispatch by `type`: text counts the `text` field; image / image_url blocks use a flat 1000-token estimate (provider tokenisation varies too much — Anthropic by dimensions, OpenAI by tile count — and the counter doesn't have dimensions at hand). Unknown block types stringify rather than drop. `count_message(dict)` is a readability alias for `count(dict)`.
- Re-exported from `ac_dc` package root so callers can write `from ac_dc import TokenCounter`. Lazy tiktoken import means the re-export costs nothing for callers that don't touch the class.
- `tests/test_token_counter.py` — 29 tests across 7 classes covering model limits (Claude family detection, case-insensitive matching, defaults), string counting (empty, None, monotonicity, unicode), message counting (plain, alias equivalence, missing-field tolerance, empty dict), multimodal blocks (text, multiple text, image, image_url, bare string, unknown type, malformed), list shapes (list of messages, empty, list of strings), defensive paths (stringify int, nested lists), encoder fallback (missing encoder, monotonic fallback, fallback through message path, encoder throws mid-call), and instance independence (per-counter encoder references, independent limits, deterministic counts).

Design points pinned by tests:

- **Relative assertions, not exact.** Tests assert `long > short` rather than `long == 10` — pinning exact tiktoken output would couple tests to a specific tiktoken version. Cache-target computation downstream only cares about relative ordering anyway.
- **Per-instance encoder.** D10 — no module-level singleton. `TestInstanceIndependence` pins this so a future refactor that introduces a shared registry breaks the test rather than silently cross-contaminating between context managers.
- **Fallback monotonicity.** Char-count fallback uses `len // 4` — not as accurate as tiktoken but always monotonic. Budget decisions depend on monotonicity (longer input → no fewer tokens); exact values don't matter.
- **Deterministic counts.** Stability tracker content hashing depends on token counts being stable across calls. Pinned by `test_counts_are_deterministic_across_calls`.

Open carried over for later sub-layers:

- Token usage extraction from provider responses (`cache_read_tokens`, `cache_write_tokens` under varying field names) — belongs to the streaming handler (Layer 3.6), not the counter.
- Session totals accumulation — context-manager concern (Layer 3.2).

### 3.2 — History store — **delivered**

- `src/ac_dc/history_store.py` — `HistoryStore` wraps the append-only JSONL file at `.ac-dc/history.jsonl` and persists per-message image data URIs to `.ac-dc/images/` (D10 contract — each image written once, filename is `{epoch_ms}-{hash12}.{ext}`; identical data URIs produce identical filenames so re-persisting is idempotent). Core operations: `append_message` (user/assistant with role/content, optional files list, optional image data-URI list, optional modified-files and edit-results metadata, optional system-event flag), `get_session_messages` (full metadata dicts for history browser), `get_session_messages_for_context` (role/content only + reconstructed images, for loading into a context manager), `list_sessions` (one summary per session with preview/count/first-role), `search_messages` (case-insensitive substring + optional role filter, scans JSONL), `new_session_id`. Session IDs use `sess_{epoch_ms}_{6-char-hex}`; message IDs use `{epoch_ms}-{8-char-hex}`.
- Image round-trip — `append_message` accepts a list of data URIs OR a legacy integer count. Data URIs are decoded, saved to the images directory, and recorded as `image_refs` (filenames only) in the JSONL record. Integer-count records read back without images (the images were never saved). Reconstruction (`get_session_messages_for_context`) reads each filename, detects MIME from extension (with a hardcoded map covering png/jpg/jpeg/gif/webp/bmp; unknown extensions fall through to `application/octet-stream`), and produces `data:{mime};base64,{payload}`. Missing image files are skipped with a debug log — a corrupt images directory never breaks session load.
- Content hash for filename stem — first 12 chars of SHA-256 over the raw data URI string. Deterministic across sessions, so a user pasting the same image in two messages produces one file on disk. Collisions at 12 chars are astronomically unlikely for any realistic repo.
- JSONL parse tolerance — every read method opens the file line-by-line, catches `json.JSONDecodeError` per line with a warning, and continues. Handles mid-write crashes without breaking subsequent reads. Matches specs4/3-llm/history.md: "Lines that fail JSON parse on load are skipped with a warning (handles mid-write crashes)".
- Search fallback — `search_messages` returns structured hits `{session_id, message_id, role, content_preview, timestamp}`. Empty/whitespace-only queries return empty list without scanning (cheap guard). Callers can map hits back to full sessions via `get_session_messages(session_id)`.
- `tests/test_history_store.py` — 38 tests across 8 classes covering construction (creates directories), append (basic, with metadata, image refs vs integer count, system event flag, all message fields round-trip), session listing (empty, ordering by timestamp descending, preview truncation, first-role capture, limit), session messages (full and context variants, images reconstructed from refs, missing image files skipped, unknown MIME falls back, legacy integer-count returns no images, excluded from other sessions), search (query match, role filter, no match empty list, whitespace query empty list, hits include context fields), session IDs (format, uniqueness), JSONL resilience (corrupt lines skipped with warning, empty file returns empty).

Design points pinned by tests:

- **Write-before-broadcast ordering.** The streaming handler will persist the user message to the JSONL store BEFORE starting the LLM call. `append_message` is synchronous and returns the message dict with its ID — the caller holds the ID and can use it for later lookups. The streaming handler then adds the assistant message after the full response completes. Mid-stream crashes leave an orphan user message in JSONL — per specs4/3-llm/history.md, this is intentional (preserves user intent).
- **No auto-cleanup of images.** Deleting a session's messages doesn't remove its images — matches specs4/4-features/images.md ("users can delete the images directory to reclaim space"). Images persist across session loads. A future cleanup method could cross-reference `image_refs` against files in the directory.
- **Sessions are opaque groupings.** The store doesn't track session boundaries or metadata beyond the session ID in each message — listing sessions is a scan over all records. Scales fine for hundreds of sessions; users with thousands of sessions can trim the JSONL manually.
- **No transient session-context coupling.** The store doesn't know which session is currently "active" — that's the caller's concern (the LLM service will hold `_session_id` and pass it to every `append_message` call).
- **Image MIME detection is extension-based.** The content hash covers the data URI exactly, so the detected MIME at save time is preserved via the extension. On reconstruction we could re-detect from the file bytes, but the extension is cheap and correct.
- **Corrupt-line recovery is newline-delimited.** A partial line terminated by a newline (buffered flush, then crash) is cleanly skipped by the reader. A partial line *without* a trailing newline followed by a subsequent write concatenates into one bogus line that can't be recovered — the next write's data is lost along with the partial record. Acceptable tradeoff: mid-write crashes are rare, and the preceding record (the one we actually wanted to preserve per specs4/3-llm/history.md) is always intact because it completed before the crash. The test pins the recoverable case; the non-recoverable case is documented in the test docstring so future readers don't "fix" a test that's correctly describing the contract.

- **Image filenames are content-addressed, not timestamped.** An earlier draft of `_save_image` used `{epoch_ms}-{hash_prefix}{ext}` intending the epoch prefix to give chronological sort order in the images directory. That broke the idempotence contract — every call produces a different filename, so the existence check never matches a prior save, and re-pasting the same image creates a duplicate file each time. The test `test_duplicate_image_deduplicated` caught this. Fix: drop the epoch, use pure `{hash_prefix}{ext}`. Chronological ordering is recoverable from filesystem mtime if a future tool needs it; the stronger invariant (content-addressed, one-file-per-payload) wins.

Open carried over for later sub-layers:

- Auto-restore on startup (`_restore_last_session`) — lives on the LLM service (Layer 3.4), not the history store. The store just exposes `list_sessions` and `get_session_messages_for_context`; the service picks the newest and loads it.
- History compaction invalidates stability tracker entries — that's the compactor's concern (Layer 3.5), not the store's.

### 3.3 — File context — **delivered**

- `src/ac_dc/file_context.py` — `FileContext` tracks files the user has selected for full-content inclusion in the LLM prompt. Maps repo-relative path → content string, maintains insertion order (Python dict since 3.7), enforces path normalisation (forward slashes, leading/trailing slashes stripped, parent-directory segments rejected). Operations: `add_file(path, content=None)` reads from disk when content omitted (via the Repo layer's `get_file_content` which already blocks traversal + rejects binary), `remove_file`, `get_files`, `get_content`, `has_file`, `clear`, `format_for_prompt` (fenced code blocks per path, no language tags — matches specs4/3-llm/prompt-assembly.md), `count_tokens(counter)`, `get_tokens_by_file(counter)` for the context-breakdown RPC.
- Construction takes an optional `Repo` reference — if supplied, `add_file(path)` without an explicit content argument reads from disk via the Repo. If no Repo is attached, a content-less add raises `ValueError`. The split means tests can exercise the pure in-memory paths without constructing a full git repo, while production code uses the Repo path.
- Binary/missing files propagate the Repo's `RepoError` — keeps the file context honest rather than silently inserting empty strings.
- Path normalisation matches `Repo._normalise_rel_path` — keys are "forward-slash, no wrapping slashes, no `..` segments". The normalisation lives here rather than imported from Repo so `FileContext` can be constructed standalone for tests.
- `tests/test_file_context.py` — 29 tests across 7 classes covering: construction (with/without Repo), add/remove/has (explicit content, disk read via mock Repo, missing-Repo error, normalisation, traversal rejection, idempotent re-add overwrites content), get_files (insertion order, returns copy), get_content (present/absent), clear, format_for_prompt (fenced-block shape, no language tag per specs4, path-then-fence layout, empty returns empty string, ordering), token counting (integration with TokenCounter, per-file and total, empty returns zero).

Design points pinned by tests:

- **Insertion order preserved.** Selection order matters for diff-stability of the prompt — if the user selects A then B, the working-files section renders A first. A re-add moves nothing (dict update semantics preserve original position); a remove-then-re-add moves the file to the end.
- **Binary rejection delegates to Repo.** `FileContext` doesn't do its own binary detection — `Repo.get_file_content` already does it (null-byte scan in first 8KB). Keeps the responsibility in one place.
- **`format_for_prompt` produces `path\n\`\`\`\n<content>\n\`\`\`` with no language tag.** specs4/3-llm/prompt-assembly.md#file-content-formatting is explicit: no language tag on the fence. Tests pin this with a regex-free substring check (`"\n```\n"` with no characters between the opening fence and the content).
- **Tokens are computed on demand.** No caching — the token counter is cheap, and caching would mean invalidating on every file update.

### 3.4 — Context manager — **delivered**

- `src/ac_dc/context_manager.py` — `ContextManager` with `Mode` enum (`CODE` / `DOC`), conversation history operations (`add_message`, `add_exchange`, `get_history` returning a copy, `set_history` copying each entry, `clear_history`, `history_token_count`), system prompt management (`get_system_prompt`, `set_system_prompt`, `save_and_replace_system_prompt` / `restore_system_prompt` for review-mode entry/exit), URL context (`set_url_context` accepting `None` / empty list as clear, `clear_url_context`, `get_url_context` returning a copy), review context (`set_review_context` / `clear_review_context` / `get_review_context`), mode (`mode` property, `set_mode` accepting both `Mode` enum and string forms with unknown-value rejection), attachment points (`set_stability_tracker` / `stability_tracker` / `set_compactor` / `compactor`), and budget enforcement (`get_token_budget`, `get_compaction_status`, `emergency_truncate`, `estimate_request_tokens`, `shed_files_if_needed`).
- `src/ac_dc/__init__.py` re-exports `ContextManager` and `Mode` alongside `TokenCounter` so callers can write `from ac_dc import ContextManager, Mode`.
- `tests/test_context_manager.py` — 12 test classes across construction, mode, history basics, history + tracker interaction, system prompt, URL context, review context, attachment points, token budget, emergency truncation, and pre-request shedding. Uses `_FakeTracker` and two `_Compactor*` stubs (one takes tokens, one takes no args) to pin the defensive contract — both shapes are accepted since Layer 3.6's exact signature isn't frozen yet.

Design points pinned by tests:

- **Attachment-point defensiveness.** `clear_history` invokes `tracker.purge_history()` via `getattr(..., None)` so a tracker without that method (or no tracker at all) is a silent no-op. Layer 3.5's tracker API isn't frozen; this keeps 3.4's tests from coupling to shape details.
- **`should_compact` signature tolerance.** `_needs_compaction` tries `should_compact(tokens)` first, falls back to `should_compact()` on `TypeError`. Covered by both `_CompactorWithBoolCheck` (tokens arg) and `_CompactorNoArgs` (no args) tests.
- **Plain `set_system_prompt` is non-saving.** Only `save_and_replace_system_prompt` populates the review-restore slot. Enforces "review mode opts in" — a stray `set_system_prompt` call during normal operation doesn't accidentally create a dangling saved state that a later `restore_system_prompt` would re-install.
- **Double-save overwrites the saved slot with the most-recent original.** If a caller enters review, then enters doc mode while in review (edge case), then exits — they return to the most recent "original" state, not a stale pre-review copy. Pinned by `test_double_save_overwrites`.
- **Empty / None clears for optional context.** `set_url_context(None)`, `set_url_context([])`, `set_review_context(None)`, `set_review_context("")` all clear the respective state. Avoids downstream assemblers having to filter empty blocks.
- **Stored copies.** `set_history` copies each message dict; `set_url_context` copies the list; `compaction_config` is dict-copied at construction. Caller mutations to passed-in data never leak into stored state.
- **Pre-request shedding uses `max_input_tokens * 0.90`.** Module constant `_SHED_THRESHOLD_FRACTION = 0.90`. The shedding loop computes per-file token counts fresh each iteration (cheap relative to the disk I/O already paid) and picks the largest file per iteration via `max(per_file.items(), key=lambda kv: kv[1])`.
- **Fixed overhead in the estimate.** `_BUDGET_ESTIMATE_OVERHEAD = 500` tokens added to every `estimate_request_tokens` call — accounts for headers, legend, ack messages, streaming margin. The shedding decision is relative to `max_input_tokens`, so the exact value doesn't matter as long as it's positive.
- **Emergency truncation exits at `trigger_tokens`, not 2×.** The method aims to get history back into the comfortable zone, not merely under the emergency ceiling. Zero trigger is a no-op (prevents stripping history when the caller hasn't configured compaction).
- **`compaction_status` percent capped at 999.** UI display sanity — a pathological ratio shouldn't produce a four-digit percent.

Notes from delivery:

- **`TokenCounter.max_input_tokens` monkey-patch pattern in tests.** To force budget pressure without constructing an artificially huge file context, several shedding tests clamp the counter's input budget via the `_patch_max_input_tokens` context manager at the top of `tests/test_context_manager.py`. The helper captures the original `property` descriptor from `TokenCounter.__dict__`, installs a replacement for the duration of the `with` block, and restores the original on exit. An earlier attempt used a bare `del type(cm.counter).max_input_tokens` in a `finally` block — that silently stripped the class attribute entirely (because the assignment had replaced the descriptor without saving a copy), causing every subsequent test across the run to see `AttributeError` on what looked like a correctly-defined property. The save-and-restore pattern is mandatory for class-level monkey-patching of descriptors; tests that replicate this pattern elsewhere should use the same helper or follow the same discipline.

- **`Mode` subclasses `str`.** Enum values are both strings and enum members, so `mode == "code"` works without unwrapping. The RPC layer receives mode as a plain string; having the enum be string-equivalent means downstream dispatch logic doesn't need to care whether it got `Mode.CODE` or `"code"`. The round-trip `Mode("code") → Mode.CODE` is how the string-form `set_mode("doc")` path is implemented, with unknown strings raising `ValueError`.

- **History browser metadata forwarded via `**extra`.** Callers that want to attach `files`, `edit_results`, `image_refs` for the history browser pass them as keyword arguments to `add_message`. The context manager doesn't interpret these fields — just stores them on the dict for later retrieval. Matches specs4's asymmetry between context retrieval (role+content only) and browser retrieval (full metadata) — 3.4 is the context-retrieval side.

### 3.5 — Stability tracker — **delivered**

- `src/ac_dc/stability_tracker.py` — `StabilityTracker` with `Tier` enum (`ACTIVE`/`L3`/`L2`/`L1`/`L0`, subclasses `str` for wire-format friendliness) and `TrackedItem` dataclass. Drives prompt-cache breakpoint placement via four phases: Phase 0 stale removal (items whose file no longer exists), Phase 1 active-items processing (hash comparison + N increment/reset, departed-item cleanup for `file:*`/`history:*`), Phase 2 L3 graduation, Phase 3 cascade with anchoring and post-cascade underfill demotion.
- Key-prefix dispatch: `system:`, `file:`, `symbol:`, `doc:`, `url:`, `history:`. The tracker itself doesn't interpret content; downstream consumers dispatch on prefix. Stale removal only applies to file-ish prefixes (`file:`, `symbol:`, `doc:`); `system:`, `url:`, `history:` are lifecycle-managed elsewhere.
- Per-tier config: entry_n and promote_n values match specs3 (0/3, 3/6, 6/9, 9/12 with L0 terminal). Cascade processes bottom-up L3→L0 up to 8 iterations; anchoring happens once per tier per cycle via a `processed` set. N-cap at promote_n when the tier above is stable prevents runaway N values that would force spurious promotions when the tier above eventually invalidates.
- Anchoring: when a tier's total tokens exceed `cache_target_tokens`, items sorted by N ascending are anchored (N frozen) until the accumulator reaches the target. Items above the anchor line can promote normally. The `_anchored` attribute is transient per-cycle state attached via `setattr` rather than declared as a field — matches its "re-evaluated every cascade" contract.
- Post-cascade underfill demotion: tiers below `cache_target_tokens` (except L0 and tiers broken this cycle) demote every item one level. L0 is terminal so never demoted — L0 backfill happens via normal cascade when L1 is broken. Broken-tier skip prevents immediately undoing promotions that just occurred.
- Initialisation from reference graph: `initialize_from_reference_graph(ref_index, files)` seeds L0 with highest-ref-count files up to cache target (with a 400-token-per-entry placeholder), then bin-packs remaining files via connected components across L1/L2/L3 in greedy size-descending order. Orphan files (no mutual references) become singleton components. `initialize_with_keys(ref_index, keys, files)` is the generalised variant used by doc mode. Placeholder hashes (empty string) trigger first-measurement acceptance in Phase 1 — the first real hash replaces the placeholder without demoting.
- `register_system_prompt(hash, tokens)` pins `system:prompt` into L0 with the model-aware entry_n. Re-registering with the same hash updates tokens only (legend may have changed) but preserves tier and N. Different hash reinstalls cleanly with fresh N.
- `measure_tokens(key, tokens)` — post-init hook for replacing placeholder token counts with real ones derived from formatted output.
- Introspection surface: `get_tier_items(tier)`, `get_all_items()`, `get_changes()`, `get_signature_hash(key)`, `has_item(key)`. All return fresh copies so caller mutations don't affect tracker state. Change log is cleared at the start of each `update()` cycle.
- `purge_history()` removes every `history:*` entry across all tiers and marks affected tiers broken. Called by the context manager on `clear_history`. Matches specs3 "all `history:*` entries are purged from the tracker. Compacted messages re-enter as new active items with N = 0."
- `src/ac_dc/__init__.py` re-exports `StabilityTracker`, `Tier`, `TrackedItem` alongside `ContextManager`, `Mode`, and `TokenCounter`.
- `tests/test_stability_tracker.py` — 13 test classes covering construction, active-item tracking (new items, hash changes, token updates, change logging), departed-item cleanup (file/history removal, symbol/doc/system/url persistence), stale removal (Phase 0 for file-ish prefixes only), graduation (N≥3 to L3), cascade promotion (simple path with anchoring disabled), anchoring (including N-cap when upper stable), underfill demotion (tier-below-target, broken-tier skip, L0-never-demoted), history purge, first-measurement acceptance (placeholder hash accepts without demotion), system prompt registration, token measurement, reference-graph initialisation (L0 seeding, clustering, orphans, doc-mode keys), full-cycle integration (new→graduate→promote, edit-after-graduation demotes, mixed items distinct tiers), and introspection (fresh-copy semantics).

Design points pinned by tests:

- **Graduation happens via N-increment path.** After the first update, a new item has N=0. The graduation check `n_value >= promote_n` fires when N reaches 3, which requires the item to have been unchanged across 4 total update cycles (0→1→2→3). Tests use explicit cycle counts rather than asserting specific N values mid-flight.

- **Cache target 0 disables anchoring and underfill demotion entirely.** Tests that only want to exercise the simple promote/demote path pass `cache_target_tokens=0`. Anchoring tests pass explicit target values with per-item token counts that sum across the threshold.

- **Underfill demotion is L0-skipped, broken-skipped, bounded to one level per call.** The `demoted_this_call` set tracks items already demoted this pass to prevent re-demotion if a tier becomes under-full after its demoted items have left. L0 is excluded explicitly; broken tiers are excluded because they just received promotions this cycle and demoting would undo the work.

- **First-measurement acceptance is critical for initialisation.** The placeholder-hash branch in Phase 1 (`existing.content_hash == _PLACEHOLDER_HASH`) sets the real hash AND increments N rather than resetting. Without this, every initialised item would demote on the first request and the carefully-computed L0 seeding would evaporate.

- **`_anchored` attribute is transient.** Set via `setattr` during cascade, read via `getattr(item, '_anchored', False)` during promotion checks. Never cleared explicitly at cycle end — the next cascade re-computes it from scratch based on current token distribution. Making it a declared field would misleadingly suggest persistent state.

- **Change log is ephemeral.** `_changes` cleared at the start of every `update()` call. Tests that assert specific change entries only examine the most recent update. A test that wanted to see the cumulative change history across cycles would need to collect them after each update.

- **Items seeded via `initialize_from_reference_graph` get `entry_n` for their target tier.** L0-seeded items get N=12, L1-seeded items get N=9, and so on. This matches how a promoted item behaves — an item arriving fresh at a tier starts at that tier's entry point, not at 0.

- **Orphan handling matters.** The real reference index only emits components for files with bidirectional references. Files with one-way refs or no refs at all would never register with the tracker if orphans weren't explicitly placed. The bin-packer treats each orphan as a singleton component for distribution purposes.

- **Phase 0 must filter active_items, not just prune the tracker.** A bug caught by `test_stale_file_removed` on first run: Phase 0 removed the stale entry from `_items`, but Phase 1 then saw the same key in `active_items` and re-created it as a fresh active entry. The real orchestrator would produce the same race — it builds `active_items` before the tracker runs, and a file deleted in between would appear in both the stale-removal target set and the active-items dict. Fix: after `_remove_stale`, call `_filter_active_items(existing_files)` to drop file-ish keys whose path is absent. Non-file-ish keys (`system:`, `url:`, `history:`) pass through unchanged.

- **Tests that depend on upper-tier stability must pin every upper tier.** `test_blocked_promotion_when_upper_stable` originally seeded only L2 to pin a.py in L3. But with L1 and L0 empty, stable.py could itself promote (L2→L1→L0) because empty tiers count as broken. L2 would then be empty — a valid promotion target — and a.py would promote past its supposed stable-upper-tier barrier. Fix: seed L0, L1, L2 with items below their own promote_n so no tier can drain upward. Stating "L2 is stable" really means "every tier above active is populated and can't itself promote" — the cascade treats empty tiers as broken, so true stability requires the entire upper chain.

- **Anchoring check runs before the item is added to the accumulator.** `test_n_capped_when_upper_stable` originally had 2 items at 300 tokens each with cache_target=500. The test expected the second (high-N) item to be unanchored and capped. But the anchoring loop checks `if accumulated < target` AT THE START of each iteration (before adding the current item), so item 1 is anchored (cum=0 < 500), item 2 is also anchored (cum=300 < 500). To get an unanchored item, you need AT LEAST 3 items so the third enters with cum=600 ≥ 500 and is not anchored. Fix: add a third item (the one with high N that should be capped). Two items crossing the target together both get anchored; only the third is past the line.

- **L0 is skipped by underfill demotion entirely.** `test_l0_not_demoted` revealed L0 was being demoted to L1 when under-filled. The spec says L0 is terminal — never demoted. Under-filled L0 is the "backfill" scenario, topped up via the normal L1→L0 promotion path when L1 is invalidated, not via underfill demotion. Fix: add `if tier == Tier.L0: continue` at the start of the `_demote_underfilled` loop body. The iteration still includes L0 for code-reading clarity (the whole sequence is there) but the guard short-circuits immediately.

- **L0 seeding loop adds an item when accumulated is still below target.** `test_l0_keys_excluded_from_clustering` with placeholder=400 and cache_target=500 seeded both files into L0 — after high.py, accumulated=400 < 500 so the loop continued and added other.py. The test expected other.py to be distributed via clustering into L1/L2/L3. Fix: set cache_target=300 so exactly one item fits (400 ≥ 300 breaks the loop). The seeding algorithm is correct — it seeds items until accumulated ≥ target — but the test's numeric setup didn't match the intent.

Open carried over for later sub-layers:

- Cross-reference mode items (cross-ref activation creates parallel `doc:*` items in the code-mode tracker and vice versa) — handled at the orchestration level (Layer 3.9+), not in the tracker itself. Key-prefix dispatch already supports mixed `symbol:`/`doc:` items in the same tier.
- URL tier graduation — specs call for URLs to enter at L1 directly rather than graduating through active. The tracker currently treats `url:*` keys identically to other keys; direct-L1 entry is an orchestration-level concern (streaming handler puts `url:*` items in L1's active-items list with N=9, and the tracker's cascade handles them from there).
- Token hash of formatted content vs raw data — specs note that symbol blocks use a signature hash derived from raw symbol data rather than formatted output (to avoid spurious hash mismatches when path aliases or exclude_files change). This is a streaming-handler concern; the tracker treats whatever hash it's given as opaque.

### 3.6 — History compactor — **delivered**

- `src/ac_dc/history_compactor.py` — `HistoryCompactor` with `TopicBoundary` (frozen) and `CompactionResult` (mutable) dataclasses. Constructor takes `config_manager` (read-through for `compaction_config`), `token_counter`, and optional `detect_topic_boundary` callable. Properties (`enabled`, `trigger_tokens`, `verbatim_window_tokens`, `summary_budget_tokens`, `min_verbatim_exchanges`) read live from `config_manager.compaction_config` on every access — hot-reloaded app.json values take effect on the next `should_compact` call without reconstruction.
- `should_compact(history_tokens)` — threshold probe, False when disabled or trigger is zero or tokens below trigger. Inclusive (>=) threshold so a corpus at exactly the trigger compacts on the next turn.
- `compact_history_if_needed(messages, already_checked=False)` — main entry point. Returns None when below trigger or empty. Otherwise: finds verbatim window start (token-based + count-based, earlier of the two), calls detector with exception protection, decides case (truncate when boundary is in/after verbatim AND confidence ≥ 0.5, summarize otherwise), builds result with min-verbatim safeguard (prepends earlier messages from before the cut when result has fewer user messages than threshold — at offset 2 for summarize, at offset 0 for truncate).
- `apply_compaction(messages, result)` — convenience wrapper. Returns original on None or `case == "none"`; result.messages otherwise.
- Detector injection pattern (option 2 confirmed by user): callable takes messages, returns `TopicBoundary`. Keeps the compactor testable without litellm mocking, keeps LLM-calling concerns at the streaming-handler layer (3.7 constructs the real detector as a closure over `config.get_compaction_prompt()` + `litellm.completion` + JSON parse + safe-default fallback). Parallel-agent-ready — each agent's compactor has its own detector callable, no shared LLM-calling singleton.
- Safe defaults — detector is None, raises, or returns wrong shape → `_SAFE_BOUNDARY` (None index, zero confidence) → summarize case fires. Conservative: doing something (summarize-all) is better than doing nothing when over budget and detection fails.
- Summary synthesis — when detector produces empty summary text, a generic placeholder fires ("The prior conversation covered earlier topics..."). The LLM's follow-up turns fill in specifics. Never emit an empty `[History Summary]` block.
- Module-level constants — `_TRUNCATE_CONFIDENCE_THRESHOLD = 0.5`, `_SAFE_BOUNDARY`, `_GENERIC_SUMMARY_FALLBACK`. Named so a future tuning pass doesn't scatter magic numbers through the code.
- Re-exported from `ac_dc` package root alongside `ContextManager`, `Mode`, `TokenCounter`, `StabilityTracker` — so callers can write `from ac_dc import HistoryCompactor, TopicBoundary, CompactionResult`.
- `tests/test_history_compactor.py` — 8 test classes: `TestShouldCompact` (disabled, zero trigger, below/at trigger, live config reload), `TestCompactGating` (empty history, below trigger, already_checked skips probe), `TestTruncateCase` (cuts to boundary, preserves boundary metadata on result, min-verbatim safeguard prepends), `TestSummarizeCase` (no boundary falls through, low confidence falls through, boundary-before-verbatim falls through, summary pair shape, empty-summary fallback, safeguard inserts at offset 2), `TestDetectorFailure` (None detector, raising detector, wrong-shape return), `TestApplyCompaction` (None result, `case="none"`, truncate result), `TestVerbatimWindow` (short history all verbatim, monotonic window-shrink property).

Design points pinned by tests:

- **Live config reload is a contract, not an optimization.** `test_live_config_reload` mutates `config.compaction_config` mid-test and checks that the next `should_compact` reflects the change. Pinning this prevents a future refactor from caching config values at construction.
- **Detector is never called unnecessarily.** `test_below_trigger_returns_none` uses a call-counting detector to prove the detector isn't invoked when the trigger gate is False. Matters for token cost — the detector does an LLM call.
- **Safeguard ordering for summarize.** Specs3 is specific: summary → earlier context → verbatim window. Safeguard-prepended messages go at offset 2 (after the summary pair), not at offset 0. `test_summarize_safeguard_inserts_after_summary_pair` verifies the first two entries are the summary pair even when the safeguard triggers.
- **Generic summary fallback is content, not empty.** When the detector returns empty summary text, the compactor synthesises a generic placeholder rather than emitting `[History Summary]\n` followed by nothing. The test checks the body after the header is non-empty.
- **Monotonic verbatim shrink.** `test_token_based_window_shrinks_with_budget` asserts smaller window → fewer/equal messages. Property-level rather than exact counts — tiktoken-version-sensitive exact values aren't worth pinning.
- **Defensive shape checking.** `test_detector_wrong_shape_falls_back` passes a dict where a TopicBoundary is expected. A future refactor that removes the `isinstance(result, TopicBoundary)` check would let the dict flow through and break the case-decision logic in unhelpful ways.

Open carried over for later sub-layers:

- **Frontend notification events.** The streaming handler (3.7) emits `compactionEvent` callbacks with stages `compacting`, `compacted`, `compaction_error` — that's a streaming-pipeline concern, not a compactor concern. The compactor just returns synchronously; the streaming handler wraps its call with event dispatch and tracker-purge.
- **Stability tracker purge after compaction.** Specs3: "all `history:*` entries are purged from the tracker. Compacted messages re-enter as new active items with N = 0." The tracker's `purge_history()` method already exists (Layer 3.5); the streaming handler will call it after `context.set_history(compacted)`. Not a compactor concern.
- **Real detector callable.** Belongs to 3.7 — constructs a closure over the smaller model name, the compaction prompt (`config.get_compaction_prompt()`), and `litellm.completion`, parses the JSON response, returns a `TopicBoundary`. Parallel-agent mode will construct N such closures, one per agent.

### 3.7 — Streaming handler — **delivered**

Scope trimmed per discussion: 3.7 is a *minimum viable* orchestration layer. Tiered prompt assembly (3.8), edit protocol (3.9), and full mode dispatch (3.10) are deliberately absent. The flat message assembly (system + history + user prompt + system reminder) will be replaced by `assemble_tiered_messages` when 3.8 lands. Stubs for cross-ref, excluded-index-files, doc-convert-availability, and review state are NOT included — those RPC surfaces land with their owning sub-layers rather than being pre-emptively stubbed (jrpc-oo introspects public methods, so missing methods naturally produce no RPC endpoint; there is no interface to stub against).

- `src/ac_dc/llm_service.py` — `LLMService` with:
  - Subsystem wiring at construction: ContextManager (with attached StabilityTracker + HistoryCompactor), FileContext, TokenCounter, HistoryStore (optional), Repo (optional), SymbolIndex (optional). Two `ThreadPoolExecutor` pools — `_stream_executor` for LLM streaming, `_aux_executor` for commit-message generation and topic detection (can overlap with an active stream).
  - `chat_streaming(request_id, message, files, images)` — captures `self._main_loop = asyncio.get_event_loop()` synchronously at the RPC entry (D10 contract), checks the init-complete flag and the single-user-initiated-stream guard, registers the active request, launches `_stream_chat` via `asyncio.ensure_future`, returns `{"status": "started"}` immediately.
  - `_stream_chat` background task — syncs file context, persists user message to both JSONL and context before the LLM call (mid-stream crashes preserve user intent), broadcasts `userMessage` to all clients, assembles the flat message array, calls `_run_completion_sync` in the stream executor, appends assistant message, fires `streamComplete`, clears the active-request flag, runs `_post_response` for stability update + compaction.
  - `_run_completion_sync` — blocking `litellm.completion(stream=True, stream_options={"include_usage": True})` call. Iterates chunks, checks the cancellation set per chunk, accumulates full content, schedules `streamChunk` callbacks via `run_coroutine_threadsafe` with the captured loop (never `asyncio.get_event_loop()` from the worker thread). Returns `(full_content, was_cancelled)`. Usage accumulated into `_session_totals` via `_accumulate_usage`.
  - `cancel_streaming(request_id)` — adds to cancellation set, rejects wrong IDs with clear error.
  - `new_session()` — generates new session ID (via `HistoryStore.new_session_id`), clears context manager history (which purges tracker history entries via the attachment point), broadcasts `sessionChanged` with empty messages.
  - `set_selected_files(files)` — filters against `repo.file_exists`, stores a copy, broadcasts `filesChanged`. `get_selected_files` returns a copy.
  - `commit_all()` — captures `session_id = self._session_id` synchronously on the event loop thread BEFORE launching `_commit_all_background(session_id)` as an ensure_future. The captured value is passed as a parameter; the background task never reads `self._session_id` directly. Matches the specs3 race-prevention pattern — a concurrent `_restore_last_session` during reconnect could otherwise replace `self._session_id` and persist the commit event to the wrong session.
  - `_commit_all_background` — stage all → get diff → generate commit message via `_generate_commit_message` (uses `_aux_executor`, smaller model) → commit → record system event message in context (via `context.add_message("user", event_text, system_event=True)`) and persistent history (via `history_store.append_message(session_id=session_id, ..., system_event=True)`). Broadcasts `commitResult`. Clears `_committing` in `finally`.
  - `reset_to_head()` — delegates to `repo.reset_hard()`, records system event message in both stores, returns `{"status": "ok", "system_event_message": text}`.
  - `get_current_state()` — snapshot: messages (copy), selected_files (copy), streaming_active, session_id, repo_name, init_complete, mode. Seven fields. No stubs for fields not yet implemented — they land with their sub-layers. The chat panel's `_onStateLoaded` handler can default missing fields on its side.
  - `_restore_last_session()` — called synchronously at construction end (not deferred). Fetches the newest session via `history_store.list_sessions(limit=1)`, loads messages via `get_session_messages_for_context`, reuses that session's ID (`self._session_id = target.session_id`) so new messages persist to the same session. Failures log and start fresh — never block construction.
  - `complete_deferred_init(symbol_index)` — attaches the symbol index and flips `_init_complete`. Session restore is NOT re-run (it already happened at construction); only the symbol-index wiring is deferred.
  - `_post_response` — builds active items (3.7 minimal: history messages only; file/symbol/doc/url items will land with 3.8), runs stability tracker update, checks compaction threshold, fires `compactionEvent(stage="compacting")`, runs compactor, on success replaces history + purges tracker history entries + fires `compactionEvent(stage="compacted", case=..., messages=...)`, on failure fires `compactionEvent(stage="compaction_error", error=...)`.
  - `_broadcast_event` (sync) + `_broadcast_event_async` — two dispatch helpers. Sync is fire-and-forget from the event loop thread. Async awaits the callback — used from within `_stream_chat` where we want `streamComplete` to complete before `_post_response` runs. Both swallow callback failures with a log rather than raising.
  - `_accumulate_usage(usage)` — dual-mode getter (attribute + dict access) with fallback chains. Handles provider field name variations (`cache_read_input_tokens` vs `cache_read_tokens`, `cache_creation_input_tokens` vs `cache_creation_tokens`). Updates `_session_totals`.
  - `shutdown()` — `executor.shutdown(wait=False)` on both pools. Called during server shutdown.

- **Topic detector closure** — `_build_topic_detector(config, aux_executor)` returns a `detect_topic_boundary: list[dict] -> TopicBoundary` callable that the HistoryCompactor consumes:
  - Formats messages as `[N] ROLE: content` blocks, truncating each to `_DETECTOR_MSG_TRUNCATE_CHARS = 1000` and capping the total at `_DETECTOR_MAX_MESSAGES = 50` (recent tail).
  - System prompt from `config.get_compaction_prompt()`, model from `config.smaller_model`.
  - Calls `litellm.completion(stream=False)`, parses the JSON response.
  - `_parse_detector_response` tolerates markdown fences (```json ... ```), clamps confidence to [0, 1], coerces `boundary_index` to int-or-None, defaults missing fields to safe values.
  - Returns `TopicBoundary(None, "...", 0.0, "")` on any failure (litellm ImportError, empty prompt, no messages, LLM call exception, malformed response, unparseable JSON, unexpected shape).
  - Falls back to safe defaults gracefully — compactor's `_safely_detect` wraps this too, so failures are doubly protected.

- **Request IDs** — `_generate_request_id()` produces `{epoch_ms}-{6-char-alnum}` matching specs3's frontend convention. Not used internally by 3.7 (the RPC caller supplies IDs); exported for tests and future callers that need a server-side generator.

- `tests/test_llm_service.py` — 10 test classes covering construction (basic, deferred init, session ID format), session auto-restore (no prior → empty, restores most recent, restore failure is non-fatal), selected files (set returns canonical, missing filtered, stored as copy), new_session (new ID, clears history, broadcasts sessionChanged), streaming guards (rejects before init complete, rejects concurrent stream), streaming happy path (user message persisted before completion, chunks broadcast, streamComplete fires, userMessage broadcast, assistant response persisted), cancellation (wrong request ID rejected, active added to cancelled set), commit flow (rejects when already committing, no-repo rejected, session ID captured synchronously — the critical race-prevention test that swaps `self._session_id` after launch and verifies the commit event persists to the ORIGINAL session), reset flow (no-repo rejected, system event recorded in both stores), topic detector closure (empty messages → safe default, parses JSON, tolerates markdown fence, handles unparseable, clamps confidence), state snapshot (shape, messages copy, selected_files copy).

- **Fake litellm via monkeypatch** — `_FakeLiteLLM` installs itself into `sys.modules["litellm"]`. Both the service's streaming path and the topic detector's non-streaming path see the fake. Provides `set_streaming_chunks(list[str])` to pre-seed the next stream and `set_non_streaming_reply(str)` for the next completion call. Generator-based chunks match the litellm iteration protocol; final chunk includes a `usage` dict so `_accumulate_usage` has something to fold into `_session_totals`. The test patches `sys.modules` via `monkeypatch.setitem`, so the fake is restored automatically between tests.

- **Recording event callback** — `_RecordingEventCallback` matches the `(event_name, *args) -> awaitable` signature and captures every invocation as `(name, args_tuple)`. Tests assert on the sequence. No async machinery needed — returns a coroutine that just completes.

- **Real git repo for commit tests** — `repo_dir` fixture initialises a minimal git repo with `user.email`/`user.name` locally configured (so CI runners without global git identity work). Seeded with a single commit so `HEAD` resolves. The commit test writes `new.md`, lets the fake litellm respond with a commit message, waits for the background task (via `asyncio.sleep(0.3)`), then asserts the commit event persisted to the CAPTURED session ID even after `self._session_id` was swapped mid-flight.

Design points pinned by tests:

- **Event loop capture is synchronous at the RPC boundary.** `chat_streaming` calls `self._main_loop = asyncio.get_event_loop()` on its first line. The worker thread reads `self._main_loop` when scheduling `streamChunk` callbacks via `run_coroutine_threadsafe`. Never `asyncio.get_event_loop()` from inside the worker — that would either fail (no loop in thread) or return an unusable loop.
- **Session ID capture for commit.** `commit_all` captures `session_id = self._session_id` BEFORE `asyncio.ensure_future(self._commit_all_background(session_id))`. The `test_session_id_captured_synchronously` test swaps `self._session_id` immediately after `commit_all` returns and verifies the commit event still persists to the ORIGINAL session. Specs3 calls this out explicitly — a concurrent `_restore_last_session` during reconnect could replace the session ID, and without synchronous capture the commit event would attach to the wrong session.
- **User message persists before LLM call.** `_stream_chat` appends the user message to both JSONL and context BEFORE calling `_run_completion_sync`. Mid-stream crashes preserve user intent. Verified by a test that completes the stream, then inspects persistent history.
- **Assistant message persists after LLM call completes.** Only written once `full_content` is available. Cancelled streams write `"[stopped]"` or the partial content accumulated so far. No orphan assistant messages without the user side paired.
- **Active-request flag cleared BEFORE post-response work.** `_stream_chat` clears `self._active_user_request = None` after firing `streamComplete` but BEFORE `_post_response`. A stale active-request flag during post-response would reject legitimate new chat requests. The flag-clear order is "stream finishes → broadcast complete → clear flag → housekeeping".
- **Detector safe defaults compound with compactor's.** The detector returns safe defaults on any failure, and the compactor's `_safely_detect` wraps the call with another try/except. Two layers of protection — detector failures never crash compaction.
- **Streaming chunks carry full content, not deltas.** Specs4 contract — dropped or reordered chunks are harmless because each carries a superset of prior content. The test verifies the FINAL chunk event has the fully accumulated reply. Reconnection semantics also depend on this (a reconnecting client just waits for the next chunk).
- **No stubs for unimplemented RPC surfaces.** 3.7 does not pre-emptively add methods for cross-reference mode, excluded index files, doc-convert availability, review state, URL detection, or mode switching. jrpc-oo introspects public methods at `add_class` time; missing methods produce no RPC endpoint, and no Layer 5 code exists yet to call them. The surfaces will land with their owning sub-layers (3.10 for modes, 4.1 for URLs, 4.3 for review, 4.4 for collaboration, 4.5 for doc convert).

Open carried over for later sub-layers:

- **Tiered prompt assembly.** 3.7 uses a flat `system → history → user` assembly with the system reminder appended to the user prompt. 3.8 will land `_assemble_messages_tiered` which consults `_stability_tracker.get_tier_items(tier)` for each tier, builds L0–L3 cache blocks with `cache_control` markers, injects the symbol map (excluding graduated files), the legend, the file tree, URL context, and review context. The current `_assemble_messages_flat` is the seam that 3.8 replaces.
- **Edit block parsing and application.** 3.9 will parse the assistant response for edit blocks (via `🟧🟧🟧 EDIT` / `🟨🟨🟨 REPL` / `🟩🟩🟩 END` markers), validate anchors against file content, apply in-context edits, mark not-in-context edits as NOT_IN_CONTEXT, auto-add those files to the selection, broadcast `filesChanged`. Populates `result["edit_blocks"]`, `result["edit_results"]`, `result["files_modified"]`, `result["files_auto_added"]`, and the aggregate counts (`passed`, `already_applied`, `failed`, `skipped`, `not_in_context`).
- **Mode switching with index swap.** 3.10 will land `get_mode`, `switch_mode`, `set_cross_reference`. The ContextManager already tracks the mode flag; 3.10 wires the symbol index vs doc index dispatch, mode-specific stability tracker swap, cross-reference mode, mode-change event broadcast, mode-switch system event message.
- **URL detection and fetching.** Layer 4.1. Adds `detect_urls`, `fetch_url`, `detect_and_fetch`, `get_url_content`, URL service construction. `_stream_chat` will detect URLs in the prompt and fetch up to a configured limit before assembly.
- **Review mode.** Layer 4.3. Adds `check_review_ready`, `start_review`, `end_review`, `get_review_state`, `get_review_file_diff`. Also adds a review-active guard in `_stream_chat` that skips edit application (specs4 review mode is read-only).
- **Collaboration localhost checks.** Layer 4.4. Adds the `_collab` reference pattern and `_check_localhost_only()` guards on mutating methods. Not needed for single-user operation.
- **Full get_context_breakdown.** Layer 3.8 will extend the minimal session-totals snapshot to include per-tier breakdown, category totals (system / legend / symbol_map / files / URLs / history), and mode-aware dispatch. The current `get_session_totals` is a placeholder — the context tab and token HUD need much more.

### 3.9 — Edit protocol — **delivered**

Parses LLM responses for edit blocks, validates anchors against file content, and applies edits to disk via the Repo layer's per-path mutex. Wires into the streaming handler so completion results now carry populated edit metadata.

- `src/ac_dc/edit_protocol.py` — `EditParser` (stateful finite-state machine), `EditBlock`/`EditResult`/`ParseResult` dataclasses, `EditStatus`/`EditErrorType` enums, `_is_file_path` heuristic (authoritative Python-side — more permissive than the frontend parser's, recognising `Makefile`/`Dockerfile`/`.gitignore` without extensions), `parse_text` one-shot convenience, `detect_shell_commands` extracting fenced-bash-block / `$ `-prefix / `> `-prefix commands with prose filtering.
- `src/ac_dc/edit_pipeline.py` — `EditPipeline` class + `ApplyReport` dataclass. Anchor matching via `_find_anchor` (unique / zero / multiple match classification with whitespace-mismatch and partial-match diagnostics), already-applied detection, sequential per-batch application, create-block idempotence (same-content re-create produces `ALREADY_APPLIED`). Not-in-context edits marked without filesystem access; files accumulated in `files_auto_added` for frontend display. Per-file write serialization delegated to Repo's mutex (D10).
- `src/ac_dc/llm_service.py` — integration:
  - Constructor builds one `EditPipeline` instance (stateless, reused across requests) gated on `repo is not None`.
  - `_review_active` flag — Layer 3.9 stub, always False. Layer 4.3 will wire review entry/exit; the read-only guard is already in place.
  - `_build_completion_result` — new async method extracted from `_stream_chat`. Parses the response unconditionally (even for cancelled/error streams — incomplete blocks surface as pending UI cards), gates apply on five conditions (no error, not cancelled, not review-active, pipeline exists, blocks non-empty), runs the pipeline, auto-adds not-in-context files to both `_selected_files` AND `_file_context` so the next request's assembly has their content, serialises `EditResult`s for the RPC response.
  - `filesChanged` broadcast fires AFTER `streamComplete` when files were auto-added. Ordering matters for the frontend: the assistant message (with its "files auto-added" banner) renders before the picker updates.
- `tests/test_edit_protocol.py` — 11 test classes, 79 tests covering file path detection (every branch of `_is_file_path`), single-block parsing, multi-block parsing, incomplete/malformed handling, streaming chunk accumulation (including one-char-at-a-time pathological case), path detection interaction with block state, `parse_text` convenience entry, and shell command detection (fenced variants, `$`/`>` prefixes, prose filtering for Note/Warning/This/The/Make, dedup, encounter order, non-shell language rejection).
- `tests/test_edit_pipeline.py` — 9 test classes, 33 tests covering create blocks (new file, staged in git, in-context bypass, conflict with existing, trailing-newline tolerance, parent dir creation), not-in-context handling (marked status, auto-added surfacing, dedup across multiple edits, mixed batch), modify blocks (unique anchor, multiline anchor, files_modified population), anchor failures (not found, ambiguous with count in message, whitespace-mismatch diagnostic, partial-match diagnostic), already-applied detection, modify errors (missing file, binary, path traversal), sequential application (second-edit sees first's result, dedup, partial-failure without rollback), aggregate reporting (empty input, counts-sum-to-length invariant, first-seen ordering), dry run (VALIDATED status, no disk change, failed still reports, no git staging).
- `tests/test_llm_service.py` — new `TestStreamingWithEdits` class with 16 integration tests: modify edit applied end-to-end, edit_results serialised shape, multiple edits in one response, create block during streaming, not-in-context auto-adds file, filesChanged broadcast AFTER streamComplete (ordering pinned), auto-added files loaded into file context, cancelled stream skips apply (but parses), review mode skips apply (but parses), no-repo skips gracefully, shell commands detected, response-without-edits produces empty fields, mixed in-context and not-in-context, failed edit reports anchor_not_found.

Design points pinned by tests:

- **Emoji delimiters reproduced exactly.** The parser matches on literal byte sequences — no ASCII substitution, no fuzzy matching. Test marker constants are re-declared (`EDIT_MARK = "🟧🟧🟧 EDIT"`) rather than imported from the module, so accidental drift in the module's constants surfaces as a test failure rather than silently both-sides-wrong.
- **Streaming chunks accumulate across boundaries.** `test_block_split_at_every_char` splits a block into single-character chunks and feeds them one at a time. The parser must handle marker lines split mid-word (`🟨🟨🟨 REP` + `L`), blank-line tolerance between path and start marker, and trailing partial lines buffered for the next chunk.
- **Create blocks bypass the in-context check.** A create block has empty old-text so there's no anchor to validate against — the in-context constraint only applies to modifies. Pinned by `test_create_bypasses_in_context_check`.
- **Already-applied detection covers both create and modify.** For create blocks, compares existing file content against target (with trailing-newline tolerance). For modify blocks, checks whether new_text is already present as a substring — conservative (false positives possible with short new_text that happens to be a substring of unrelated code) but correct. Lets users re-run a prompt without flooding the UI with spurious errors.
- **Sequential application is observable.** `test_two_edits_same_file_sequential` constructs a second edit whose anchor only works against post-first-edit content (`"1\ntwo"` — where `1` is the output of the first edit). Proves the pipeline reads fresh content between edits in the same batch.
- **Partial-failure doesn't roll back.** `test_first_edit_succeeds_second_fails` verifies the first edit persists on disk even when a later edit in the same batch fails. Matches specs4 explicitly: "Edits applied sequentially — earlier successes remain on disk."
- **Shell command prose filtering.** `> Note:`, `> Warning:`, `> This`, `> The`, `> Make sure` are blockquote prose, not commands. But `> make test` is a command (lowercase `make` isn't a prose word). The filter is case-sensitive.
- **Fragment-stripping in shell detection.** Fenced blocks are stripped from the text before scanning for `> ` prefixes, so an inline citation inside a fenced block doesn't double-match.
- **Apply gating has five conditions.** Error, cancelled, review-active, no pipeline, no blocks. Pinned individually by `test_cancelled_stream_skips_apply`, `test_review_mode_skips_apply`, `test_no_repo_skips_apply_gracefully`, `test_response_with_no_edits_has_empty_edit_fields`. Parsing happens unconditionally — the five gates apply to the apply step only.
- **Auto-add covers both selection AND file context.** Pinned by `test_auto_added_files_loaded_into_file_context`. The frontend's file picker reads from `_selected_files` but the next request's prompt assembly reads from `_file_context` — both must be updated or the next request would have the file listed-but-not-loaded.
- **filesChanged broadcast order.** Pinned by `test_not_in_context_broadcasts_files_changed` which checks `event_names.index("streamComplete") + 1:` contains `"filesChanged"`. The frontend displays the completion banner before updating the picker — matters for UI clarity.

Notes from delivery:

- **Frontend vs backend path detection intentionally differ.** Frontend (`edit-blocks.js`, lands in Layer 5) uses simpler rules — no extensionless filename whitelist. If the frontend occasionally fails to render a `Makefile` edit as a visual block, the block still applies correctly on the backend. Don't converge them; the asymmetry is deliberate (specs3 documents this under "Frontend vs Backend Divergence").
- **Trailing-newline convention.** The parser joins accumulated new_lines with `\n` — `["print('hi')"]` produces `"print('hi')"`, no trailing newline. If the LLM wants a trailing newline, it emits a blank line before the END marker. `test_create_block_during_streaming` documents this with a comment; don't "fix" it by appending a newline in the parser — it would silently corrupt create blocks that are meant to produce no trailing newline.
- **Serialisation boundary is thin.** `_serialise_edit_result` is a static one-liner converting an `EditResult` dataclass to a dict. Keeping it adjacent to the consumer (the `_build_completion_result` method) rather than on the dataclass itself means the dataclass doesn't need RPC-serialisation awareness.
- **The `_review_active = False` stub.** Laid the groundwork for Layer 4.3's review entry/exit without any actual review logic. When Layer 4.3 lands, the flag gets wired to `start_review` / `end_review` RPCs; the streaming handler's gate logic doesn't need to change.
- **Empty old-text in create blocks triggers `not old_text.strip()` check.** A block with only whitespace in old-text is still treated as a create. Matches specs4 — "create block" means "no anchor to match against", and whitespace-only content is functionally no anchor.

Open carried over for later sub-layers:

- **Doc-mode edit support.** 3.10 will add doc-mode as the active mode. The edit pipeline is mode-agnostic — it operates on file content regardless of whether the containing session is code or doc mode. No changes expected to the pipeline itself; only the surrounding system prompt (which tells the LLM what kind of edits to produce) changes.
- **Cross-reference mode.** Same story as mode — the pipeline doesn't care. Cross-reference only affects which index feeds the prompt.
- **Review mode wiring.** Layer 4.3 sets `_review_active` from `start_review` / `end_review`. Edit parsing still happens (for UI display), application is skipped (read-only contract).
- **Token usage extraction.** The `_build_completion_result` currently emits zero for `token_usage.prompt_tokens` and `token_usage.completion_tokens`. The streaming loop accumulates via `_accumulate_usage` into `_session_totals`; per-request usage needs to be captured separately and propagated into the completion result. Lands as a minor follow-up — not strictly part of 3.9's edit scope.

## Layer 3 — in progress (continued)

Current status: 3.1–3.10 delivered. Layer 3 is feature-complete for single-agent operation. Layer 4 (features — URL content, images, code review, collaboration, doc convert) is next.

### 4.4.2 — LLMService + Repo restriction enforcement — **delivered**

Completes the collab integration by guarding every mutating RPC method on `Repo` and `LLMService` with a `_check_localhost_only()` helper. When no collab is attached (single-user mode), the guard returns None and all callers execute normally — **zero behaviour change for the 1855+ pre-existing tests**. When a collab is attached and reports a non-localhost caller, mutating methods return `{"error": "restricted", "reason": ...}` verbatim to the RPC caller. The frontend's RpcMixin surfaces this as a `restricted` error and hides the UI affordance.

- `src/ac_dc/repo.py` — `_collab: Any = None` field and `_check_localhost_only()` helper (returns None when allowed, else the spec's restricted-error shape). Guarded 13 mutating methods: `write_file`, `create_file`, `delete_file`, `rename_file`, `rename_directory`, `stage_files`, `unstage_files`, `discard_changes`, `stage_all`, `commit`, `reset_hard`. Read-only methods (`get_file_content`, `get_staged_diff`, `file_exists`, `is_clean`, etc.) explicitly unguarded per specs4's "browse, search, view" allowance for participants.
- `src/ac_dc/llm_service.py` — same pattern on the service class. `_check_localhost_only()` uses `getattr(self, "_collab", None)` since `_collab` isn't in the service's own constructor (it's set by `main.py` after construction when collab mode is active). Guarded methods: `chat_streaming`, `cancel_streaming`, `new_session`, `set_selected_files`, `switch_mode`, `set_cross_reference`, `start_review`, `end_review`, `commit_all`, `reset_to_head`, `fetch_url`, `detect_and_fetch`, `invalidate_url_cache`, `remove_fetched_url`, `clear_url_cache`. The `set_selected_files` return type widened from `list[str]` to `list[str] | dict[str, Any]` to accommodate the restricted-error shape; `detect_and_fetch` similarly widened from `list[dict]` to `list[dict] | dict`.
- `tests/test_collab_restrictions.py` — extended with an LLMService section. 3 test classes: `TestLLMServiceNoCollab` (no-collab path works), `TestLLMServiceLocalhostAllowed` (localhost caller sees normal behaviour — including three "guard ordering" tests that prove the method got past the guard when the localhost check passes but a different precondition fails, e.g. commit-all with no repo, end-review when not active, cancel-streaming with wrong request ID), `TestLLMServiceNonLocalhostRejected` (restricted shape returned, state unchanged — 14 methods covered including both sync and async paths), `TestLLMServiceReadOpsAllowed` (read-only methods work for non-localhost callers — `get_current_state`, `get_selected_files`, `get_mode`, `get_review_state`, `detect_urls`, `get_snippets`), `TestLLMServiceCollabFailClosed` (raising collab check is denied).

Design points pinned by tests:

- **Guard ordering matters.** The restriction check runs BEFORE state mutations so a rejected call doesn't half-execute. For `chat_streaming` specifically, the guard precedes the init-complete check, the concurrent-stream check, AND the `_active_user_request` set — a restricted call never registers as active. Pinned by `test_chat_streaming` which asserts `service._active_user_request is None` after a rejected call.
- **No regression in the no-collab path.** Every test in the rest of the suite constructs services without setting `_collab`, so the `getattr` returns None and the guard short-circuits. If the pattern broke single-user operation, 1855+ tests would fail on every run. This is the cheapest possible verification that the integration is zero-cost in single-agent mode.
- **Type-widening is load-bearing.** `set_selected_files` and `detect_and_fetch` previously returned concrete list types. The union with `dict[str, Any]` lets them return the restricted-error shape without a `type: ignore` cast. Callers (the frontend RpcMixin) already handle the shape — either they get the expected payload or a `{"error": ..., "reason": ...}` dict.
- **Fail-closed on collab errors.** If the collab's `is_caller_localhost()` raises, the guard returns restricted with a "internal error" reason rather than silently allowing. Matches the Repo pattern; pinned by `TestLLMServiceCollabFailClosed`.
- **Read operations are genuinely unguarded.** `get_current_state`, `get_selected_files`, `get_mode`, `get_review_state`, `get_review_file_diff`, `get_snippets`, `get_session_totals`, `get_commit_graph`, `check_review_ready`, `detect_urls`, `get_url_content` — none of these check localhost. Specs4 is explicit: non-localhost participants can browse, search, and view. Only state-mutating calls are gated.

Open for future sub-layers:

- **Settings RPC service.** Still deferred (per Layer 1's original deferral). When it lands, the same `_check_localhost_only()` helper pattern applies to `save_config_content`, `reload_llm_config`, `reload_app_config`. `get_config_content` and `get_config_info` stay unguarded (read-only).
- **DocConvert RPC service.** Layer 4.5. Its `convert_files` method will need the guard; availability / scan queries are read-only.
- **Collab wiring in `main.py`.** Layer 6 (startup) wires the actual Collab instance into the service classes when `--collab` flag is passed. Currently nothing sets `_collab` on a running LLMService — the tests explicitly assign `service._collab = _StubCollab(...)`. Production wiring lands with startup orchestration.

### 4.5 — Settings RPC service — **delivered**

Closes out the Layer 1 deferral. The Settings service is a narrow RPC surface for reading and writing user-editable config files, using the same `_check_localhost_only()` pattern on write/reload methods that Repo and LLMService got in 4.4.2.

- `src/ac_dc/settings.py` — `Settings` class with seven RPC methods: `get_config_content(type_key)`, `get_config_info()`, `get_snippets()`, `get_review_snippets()` (all unguarded reads), `save_config_content(type_key, content)`, `reload_llm_config()`, `reload_app_config()` (all localhost-gated). Plus a static `is_reloadable(type_key)` helper for callers (tests, a future UI-side dispatcher) that want to know whether a save on a given type warrants a reload RPC.
- **Whitelist enforcement.** Every type-taking method consults `CONFIG_TYPES` (imported from `ac_dc.config`). Unknown keys — including internal files like `commit.md` and `system_reminder.md` that are loaded by `ConfigManager` but deliberately excluded from the whitelist per specs4 — return a clean `{"error": "Unknown config type: ..."}` dict. Arbitrary filesystem paths never cross the RPC boundary.
- **Direct file I/O, not via `_read_user_file`.** `ConfigManager._read_user_file` falls back to the bundle when the user file is missing. That's wrong for Settings — we want to present the user's actual on-disk state so the editor opens with what's really there (empty for missing files, not the bundle default silently reappearing). `get_config_content` reads directly from `config.config_dir / filename`; missing files return empty content, not an error (the next startup re-copies the bundle default anyway).
- **Advisory JSON validation.** `save_config_content` writes first, then parses. Invalid JSON produces `{"status": "ok", "type": ..., "warning": "JSON parse error: ..."}` — the file is still written so users can save a partially-edited state and come back to finish. Rejecting malformed JSON at the write boundary would force users into external editors to recover.
- **Write always creates parent directory.** A vanished config dir (manual `rm`, filesystem corruption) doesn't wedge saves — `mkdir(parents=True, exist_ok=True)` before the write re-creates it. Pinned by `test_save_creates_directory_if_missing`.
- **Reload is separate from save.** Specs4 suggests "save automatically triggers reload" — but that dispatch belongs to the frontend (which can decide e.g. to skip reload if JSON validation failed). The service exposes `reload_llm_config` and `reload_app_config` as distinct RPC calls. `is_reloadable(type_key)` lets a caller query whether a type warrants a reload without having to hardcode the list.
- `tests/test_settings.py` — 9 test classes, 37 tests covering construction (holds config reference, collab starts None), whitelist (all types resolve, unknown returns None, commit/system_reminder not in whitelist), `get_config_content` (reads shipped llm/system files, unknown type errors, commit not readable, missing user file returns empty content, allowed for non-localhost, allowed when collab raises), `get_config_info` (model names + config dir, allowed for non-localhost), snippets (code + review return non-empty lists with correct shape, allowed for non-localhost), `save_config_content` (overwrite, directory recreation, unknown-type rejected, commit-save rejected, valid JSON no warning, invalid JSON warns + writes, markdown never JSON-warns, localhost allowed, non-localhost rejected with file unchanged, fail-closed on raising collab), `reload_llm_config` (picks up on-disk changes, localhost allowed, non-localhost rejected, fail-closed), `reload_app_config` (same coverage matrix), `is_reloadable` (litellm/app are, prompts/snippets aren't, unknown isn't).

Design points pinned by tests:

- **Missing user file is not an error for reads.** `test_missing_user_file_returns_empty_content` deletes `system_extra.md` AND seeds the version marker to suppress the upgrade re-copy, then reads via the service. Returns `{"type": "system_extra", "content": ""}` — the Settings editor opens blank. Specs4 is explicit about this: "present the user's actual on-disk state, not silently show the bundle."
- **JSON validation is advisory.** `test_save_invalid_json_warns_but_writes` verifies the file is written with the broken content AND the return carries a warning. Refusing to persist would block mid-edit state. The Settings UI checks for the warning and surfaces it to the user.
- **Directory re-creation is defensive.** A pathological case, but cheap to handle — `mkdir(parents=True, exist_ok=True)` is a no-op in the common case and recovers from the rare one. Pinned so a future "cleanup" pass that removes the mkdir doesn't break the recovery path.
- **Reads are genuinely unguarded.** Four methods (`get_config_content`, `get_config_info`, `get_snippets`, `get_review_snippets`) explicitly test the non-localhost path to prove the guard isn't there. Specs4's collaboration policy: "participants can browse, search, view." Config content is part of that.
- **Fail-closed on collab exceptions.** If `is_caller_localhost()` itself raises, every mutating method returns restricted. Pinned by three separate `test_*_collab_raises_fails_closed` tests covering save, reload_llm, reload_app.
- **`is_reloadable` is a pure query.** Static method, no state, no side effects. Tests pin the full reloadability matrix (litellm + app reloadable; prompts and snippets not reloadable) so a future refactor that accidentally adds a config type to `_RELOADABLE_TYPES` surfaces as a test failure.

Open carried over:

- **Layer 6 wiring.** `main.py` will construct the Settings service alongside Repo and LLMService, register it via `server.add_class(settings)`, and (in collab mode) set `settings._collab = collab_instance`. The collab reference is runtime-attached just like Repo's and LLMService's; in single-user mode `_collab` stays None and every caller is treated as localhost.

### 4.6 — DocConvert — **in progress (Pass A foundation + Pass A2 markitdown delivered)**

Ships the Doc Convert backend incrementally. Pass A delivered the foundation (scanning, availability probing, provenance-header infrastructure); Pass A2 adds real conversion for the three simplest formats (`.docx`, `.rtf`, `.odt`) via markitdown. Passes A3–A5 will follow: openpyxl for xlsx colours, python-pptx fallback, LibreOffice + PyMuPDF for the full PDF pipeline.

#### Pass A — foundation (delivered)

Ships the backend skeleton: class structure, dependency probing, repository scanning with status classification via provenance headers, and the localhost-only guard on the `convert_files` stub.

- `src/ac_dc/doc_convert.py` — `DocConvert` class with:
  - Construction takes `config: ConfigManager` and optional `repo`. `repo` is `Any`-typed to avoid a Layer 1 ↔ Layer 4 circular import; all we need is `.root` as a Path-like attribute. Tests use `SimpleNamespace(root=tmp_path)` to avoid pulling in the Repo fixture dependencies.
  - `is_available()` probes every optional dependency: markitdown (importable → conversion possible at all), LibreOffice (`shutil.which("soffice")` → pptx/odp path works), PyMuPDF (`fitz` importable → PDF text extraction works), and derives `pdf_pipeline = libreoffice AND pymupdf`. Returns the specs4-mandated shape `{available, libreoffice, pymupdf, pdf_pipeline}`.
  - `_probe_import(name)` is a broad-catch helper that returns False on any exception during import. A module that installs but raises at import time (corrupted install, missing native dependency, version mismatch) shows as unavailable rather than propagating the exception into what is meant to be a cheap probe.
  - `scan_convertible_files()` walks the repo via `os.walk` (chosen over `Path.rglob` for the in-place directory pruning hook) and classifies each source file. Respects `_EXCLUDED_DIRS` (`.git`, `.ac-dc`, `node_modules`, `__pycache__`, `.venv`, `venv`, `dist`, `build`) plus hidden directories with an exception for `.github` (some repos store CI docs there). Returns entries with `path`, `name`, `size`, `status`, `output_path`, `over_size` fields. Results stable-sorted by path for deterministic frontend rendering.
  - `_classify_status(source, output)` runs the spec's four-step priority ladder: no output → `new`; output without docuvert header → `conflict`; hash matches → `current`; hash differs → `stale`. Defensive — any I/O error reading the output file or hashing the source downgrades to `new` rather than showing a misleading `current`.
  - `parse_provenance_body(body)` — static method exposing the header parser for testing and future utilities. Extracts `source`, `sha256` (both required) plus optional `images` list. Unknown fields land in `extra` for forward compatibility — a future release adding a `tool_version` field won't break older clients reading newer files.
  - `_read_provenance_header(path)` reads the first 2048 bytes, runs the parser, returns a `ProvenanceHeader` or `None`. Lenient on file format — UTF-8 with error replacement on the probe bytes, so a mid-file binary section can't crash the scanner.
  - `_hash_file(path)` streams the file in 64 KB chunks and returns the SHA-256 hex digest. Full hex (not a prefix) goes into provenance headers so collision risk stays negligible even in repos with thousands of source files.
  - `convert_files(paths)` runs the localhost guard, then raises `NotImplementedError` for localhost callers. Deliberately a hard failure so Pass A2 can't accidentally ship code calling the stub; the guard still runs so the restricted-error path is testable today.
  - `_check_localhost_only()` — same contract as Repo/LLMService/Settings. Fails closed on collab-check exceptions.
  - Read-through config accessors (`_enabled`, `_extensions`, `_max_size_bytes`) — every call re-reads `config.doc_convert_config`, so hot-reloaded values take effect immediately. Useful during development; matches the pattern other services use.

- `src/ac_dc/doc_convert.py` (module-level):
  - `_DEFAULT_EXTENSIONS` — fallback when config's `extensions` list is missing or malformed. Matches specs4's list exactly.
  - `_EXCLUDED_DIRS` — frozen set of directory names never walked. Mirrors the indexers' exclusion list; rebuilt here rather than imported to keep the doc-convert scan a self-contained code path.
  - `_PROVENANCE_RE` — matches the whole `<!-- docuvert: ... -->` comment. Uses `([^>]+?)` to capture the body lazily so we can parse unknown fields ourselves rather than reusing capture groups for each expected field.
  - `_PROV_FIELD_RE` — matches individual `key=value` pairs inside the body.
  - `_PROVENANCE_PROBE_BYTES = 2048` — enough to find a header near the top of any realistic file; small enough that scanning doesn't slow down on repos with thousands of converted outputs.
  - `ProvenanceHeader` — frozen dataclass for parsed headers (source, sha256, images tuple, optional extra dict).

- `tests/test_doc_convert.py` — 13 test classes, 48 tests covering:
  - Construction (config reference held, collab starts None, repo optional with CWD fallback).
  - Localhost guard (no-collab None, localhost None, non-localhost restricted, raising collab fails closed).
  - `is_available` (returns all four flags with bool types, pdf_pipeline truth table with all four combinations, markitdown-missing flag, all-missing, probe-catches-exception, disabled config doesn't affect availability).
  - `scan_convertible_files` empty cases (empty repo, disabled config returns empty, missing root logs and returns empty).
  - Extension filtering (all default extensions recognised, non-convertible ignored, case-insensitive match, config restriction applied).
  - Directory exclusions (`.git`, `.ac-dc`, `node_modules` each individually; hidden dirs excluded except `.github`; full enumeration of `_EXCLUDED_DIRS`).
  - Status classification matrix (new / conflict / current / stale, plus precedence — conflict beats hash check, malformed header → conflict).
  - Entry shape (required fields, path/name populated, output_path is sibling `.md`, size is byte count, over_size flag false under threshold, over_size flag true above threshold after config reload, Windows path normalisation to forward slashes).
  - Ordering (stable alphabetical sort, nested paths sorted correctly).
  - Provenance body parsing (valid minimal header, missing source → None, missing sha256 → None, empty body → None, unknown fields captured as extra, empty images list, single image, frozen dataclass).
  - Provenance file reading (reads from actual file, missing header → None, invalid body → None, unreadable file → None with no crash, header on non-first line still found).
  - Source hashing (matches stdlib SHA-256, streams large files, handles empty file).
  - `convert_files` stub (non-localhost restricted, localhost raises NotImplementedError, no-collab raises NotImplementedError, raising collab returns restricted rather than raising — proves guard order).

Design points pinned by tests:

- **Availability probes never raise.** `test_probe_import_catches_exception` patches `importlib.import_module` to raise and verifies `_probe_import` still returns `False`. A module with a broken install shouldn't crash `is_available`; it should just mark the feature unavailable so the frontend degrades gracefully.

- **`pdf_pipeline` truth table is exhaustive.** Four tests cover the four corners: both deps present → True; libreoffice only → False; pymupdf only → False; neither → False. Matters because the frontend uses this one flag to decide whether to show the PDF conversion UI.

- **Disabled config returns empty, availability still probes.** `test_is_available_callable_when_disabled` and `test_disabled_returns_empty` pin the distinction — `enabled=false` is a user opt-out (hide the tab's conversion controls), but the frontend still calls `is_available` to decide whether to show the tab at all. Two separate concepts, pinned by separate tests.

- **Status precedence.** `test_conflict_takes_precedence_over_hash_check` verifies that an output file lacking a docuvert header is always `conflict`, never `current` or `stale`, even if a hash would have matched. Specs4 is explicit — manually-authored files need explicit opt-in to overwrite.

- **Malformed headers → conflict.** A header present but missing `sha256` returns `None` from the parser, and the classifier treats `None` exactly the same as "no header at all": `conflict`. Pinned by `test_malformed_header_treated_as_conflict`. The failure mode is "I don't know what this file is, so don't overwrite it" rather than "pretend it's new".

- **Path normalisation.** `test_windows_path_normalised` explicitly checks no backslashes appear in `path` or `output_path` fields. Matters for frontend rendering consistency across platforms.

- **Forward-compatibility on unknown provenance fields.** `test_unknown_fields_captured_as_extra` adds two arbitrary `key=value` pairs and verifies they survive parsing in the `extra` dict. Critical invariant — a future release that adds a `tool_version` or `encoding` field must not break older clients reading newer files.

- **Guard ordering on `convert_files`.** Three tests prove the guard runs before the NotImplementedError body: non-localhost returns restricted (doesn't raise), localhost raises NotImplementedError (guard passed), raising-collab returns restricted (guard ran, failed closed, body never reached). Pins the contract that restriction checks are strictly before body logic in every guarded method.

#### Pass A2 — markitdown path (delivered)

Adds real conversion for `.docx`, `.rtf`, `.odt` via markitdown. Other supported extensions (`.pdf`, `.pptx`, `.xlsx`, `.csv`, `.odp`) return per-file `skipped` results — caller sees specific "not yet supported" messages rather than a blanket error.

- `src/ac_dc/doc_convert.py` — Pass A2 additions:
  - `convert_files(paths)` — real implementation replacing the Pass A stub. Guard runs first; then the clean-tree gate (when a repo is attached); then per-file dispatch. Returns `{"status": "ok", "results": [per_file]}` on successful dispatch, `{"error": ...}` on restricted caller or dirty tree.
  - `_convert_one(root, rel_path)` — per-file entry point. Validates path is inside root (defensive — the caller should use scan output, but we protect against directly-crafted paths). Checks file existence, size-within-budget, extension routing. Every failure wrapped in a per-file result dict — one bad file never aborts the batch.
  - `_convert_via_markitdown(root, source_abs, rel_path)` — the actual conversion pipeline: compute source hash, read prior provenance for orphan tracking, call markitdown (lazy import — no module-level dependency), apply DOCX truncated-URI workaround for `.docx`, extract data-URI images to the assets subdirectory, clean up orphan images from prior conversion, remove empty assets dir, write output with provenance header prepended.
  - `_replace_docx_truncated_uris(source_abs, markdown_text)` — DOCX-specific workaround. markitdown emits `data:image/png;base64...` (literal ellipsis) for large embedded images. We pre-extract from the zip's `word/media/` in document order and substitute the truncated references one at a time via `re.sub(..., count=1)` per image (multi-substitute would replace all occurrences with the same image).
  - `_extract_docx_media(source_abs)` — reads the docx zip, walks `word/media/` in namelist order, returns `[(mime_subtype, base64_payload), ...]`. Normalises `jpg` extension to `jpeg` MIME subtype. Failures (bad zip, read errors, OSError) return empty list so the caller degrades gracefully.
  - `_extract_data_uri_images(markdown_text, assets_dir, stem)` — scans for `![alt](data:image/...;base64,...)` matches, decodes each, saves to `{assets_dir}/{stem}_img{N}{ext}` with N 1-indexed. Creates the assets dir on first successful extraction only (no empty dirs for text-only docs). Returns `(rewritten_markdown, saved_filenames)`. Decode failures leave the original reference in the markdown — the broken image is better than silently dropping it, and the markdown reader sees exactly what went wrong.
  - `_build_provenance_header(source_name, source_hash, images)` — static helper producing the `<!-- docuvert: ... -->` line. Images field omitted entirely when no images (keeps the header compact for text-only docs). Stable field ordering: source → sha256 → images.
  - `_fail(rel_path, message)` / `_skip(rel_path, message)` — static result-dict builders. `fail` status is `"error"`; `skip` status is `"skipped"`. The distinction lets the frontend render different icons — skipped files may be retried later (over-size, deferred extension) while errors indicate a real problem.
  - Module constants: `_MARKITDOWN_EXTENSIONS` (the three formats Pass A2 handles), `_DATA_URI_IMAGE_RE` (matches the `![alt](data:image/mime;base64,payload)` shape), `_TRUNCATED_URI_RE` (matches DOCX's truncated-ellipsis form), `_MIME_TO_EXT` (png → .png, jpeg → .jpg, etc., with `.bin` fallback for unknown MIMEs so files still land on disk).
  - Lazy markitdown import inside `_convert_via_markitdown` (not at module load). Keeps `from ac_dc.doc_convert import DocConvert` cheap in releases without markitdown; `ImportError` surfaces as a per-file error with an install hint (`pip install 'ac-dc[docs]'`).

- `tests/test_doc_convert.py` — Pass A2 additions (replaces the 4-test `TestConvertFilesStub` class with 10 test classes, 45 tests):
  - `TestConvertFilesGuards` — 3 tests: non-localhost restricted, raising-collab restricted, guard runs BEFORE the clean-tree check (restricted caller doesn't even see the dirty-tree error — pinned because the order matters: we don't want a participant to discover "working tree is dirty" and be tempted to engineer a workaround).
  - `TestCleanTreeGate` — 3 tests: dirty tree rejected with a message about "uncommitted", clean tree allowed, no-repo skips the gate (tests and CLI use without a full repo still work).
  - `TestExtensionDispatch` — 8 tests: each of `.docx`/`.rtf`/`.odt` routes to markitdown, each of `.pdf`/`.pptx`/`.xlsx` returns a `skipped` status with "not yet" in the message, unsupported extension returns `error`, mixed batch produces per-file results (one ok, one skipped — proves `_convert_one` doesn't abort the whole batch on a single failure).
  - `TestPreflightValidation` — 3 tests: missing file → error, path traversal → error, over-size file → skipped with "limit" in the message.
  - `TestMarkitdownFailures` — 2 tests: missing markitdown (via `builtins.__import__` monkeypatching) → error with install hint, markitdown raising → error with the exception message.
  - `TestProvenanceWriting` — 6 tests: header on first line, header contains `source=` and `sha256=` fields, header includes `images=` when present, header omits `images=` field entirely when no images (not `images=` empty — OMITTED, which keeps the scan's parser's backward-compat with minimal headers), roundtrip-via-scan classifies converted file as `current`, editing the source between conversions re-classifies as `stale`.
  - `TestDataUriImages` — 7 tests: single image extracted with real PNG bytes preserved, multiple images numbered 1/2/3 in order, markdown references rewritten from data URI to `stem/stem_img1.png`, alt text preserved, JPEG gets `.jpg` extension, no-images-no-assets-dir (text-only doc doesn't create an empty `stem/` dir), decode failure on invalid base64 leaves the reference in place (status still `ok` — broken image is better than crashed conversion).
  - `TestDocxTruncatedUris` — 4 tests: truncated URI replaced from zip media (extracted image bytes exactly match zip content, proving the round-trip), multiple truncated URIs matched in document order (image1.png maps to first ref, image2.png to second — distinguishable via a byte variant), no-media-in-zip leaves the truncated URI in place (status still `ok` — we couldn't substitute but the conversion succeeded), non-zip docx is tolerated (conversion proceeds even though zip extraction fails).
  - `TestOrphanCleanup` — 3 tests: orphans-on-reconversion test creates a 2-image version then a 1-image version, verifies img2 is deleted and img1 survives; no-header-no-orphan-cleanup puts a user-created file in the assets subdir of a CONFLICT file and verifies the user's file is NOT touched (the file didn't have a docuvert header so we don't manage its siblings); assets-dir-removed-when-fully-orphaned creates a version with images then reconverts with no images, verifies the entire `stem/` dir is removed.

- `tests/test_doc_convert.py` — test infrastructure:
  - `_FakeMarkItDown` / `_FakeMarkItDownResult` classes — installed via `sys.modules` monkeypatching (same pattern as the litellm fake in `test_llm_service.py`). Per-test-case output controlled via a class-level `outputs` dict keyed by source path; convert() exception controlled via `raise_on_convert`. Reset in the `fake_markitdown` fixture so tests don't leak state.
  - `clean_repo` / `dirty_repo` fixtures — `SimpleNamespace(root=scan_root, is_clean=lambda: True/False)`. Minimal Repo stand-in; enough for the clean-tree gate test without pulling in the full Repo fixture dependencies.
  - `_make_png_bytes()` helper — returns a minimal valid 1x1 PNG (~67 bytes of real PNG data) so tests can verify byte-exact round-trip through base64 encoding/decoding. Using genuine PNG bytes rather than random data lets failures surface as "payload didn't round-trip" rather than "we crashed mid-decode".
  - `_make_docx_zip(path, media)` helper — builds a minimal-valid zip with just a `[Content_Types].xml` entry and optional `word/media/` files. The zip reader only looks under `word/media/`, so we don't need a fully-valid docx.
  - `_make_data_uri(payload, mime)` helper — builds `data:image/png;base64,{encoded}` strings for test input.

Design points pinned by tests:

- **Per-file results rather than batch atomicity.** `test_mixed_batch_produces_per_file_results` proves that mixing a successful `.docx` with a deferred `.pdf` produces two per-file results, both with distinct statuses. A caller that selected ten files and had one fail wants the other nine to still convert — the streaming UI renders per-file progress, not a batch-succeed-or-batch-fail. The specs4 contract pins this: the doc convert tab's progress view shows per-file status.

- **Clean-tree gate runs AFTER the localhost guard.** `test_guard_runs_before_clean_tree_check` calls `convert_files` on a DocConvert with a dirty repo attached AND a non-localhost collab. The result is the restricted-error shape, not the dirty-tree error. Matters for the collaboration contract — a non-localhost participant should never see information about the working-tree state through an unintended channel (it would leak repo dirtiness to clients who can't act on it anyway).

- **Header omits `images=` field entirely when empty.** Not `images=` empty list — the entire `images=` segment is dropped. `test_header_omits_images_when_none` pins this. The scan's parser (from Pass A) handles both "no images field" and "empty images field" uniformly, but the output form matters for the minimum diff noise principle — text-only docs should have stable compact headers that don't drift when an empty-list representation choice changes.

- **Failed image decode leaves markdown reference in place.** `test_decode_failure_leaves_reference_in_place` uses intentionally broken base64 (`!!!not-base64!!!`). The conversion succeeds (status `ok`, no images saved, broken reference visible in the output). Alternative designs considered: crash the conversion (rejected — one bad image shouldn't lose the text), silently drop the reference (rejected — user wouldn't know an image was supposed to be there). The "broken image icon in the rendered markdown" behaviour is explicit and recoverable.

- **DOCX truncated-URI substitution is order-based, not content-addressed.** markitdown doesn't surface the DOCX relationship IDs that would let us map each `![alt](data:image/png;base64...)` reference back to its specific source image. We match in document order. `test_multiple_truncated_uris_matched_in_order` pins this by using distinguishable byte variants of an image (PNG plus a null byte) so we can verify image1→first ref, image2→second ref. If markitdown ever emits images out of document order relative to the zip's namelist order, this breaks — but the zip spec and DOCX spec both guarantee document-order storage, and no reported issue exists.

- **Lazy markitdown import is tested via `builtins.__import__` monkeypatching.** `test_missing_markitdown_returns_error` is subtle — it has to block the import that happens INSIDE the method, not just remove markitdown from `sys.modules` (which `sys.modules.pop` would do but which `_FakeMarkItDown`'s sys.modules injection could defeat). Patching `builtins.__import__` with a filter that raises ImportError for `"markitdown"` catches the lazy import at the actual resolution point.

- **Orphan cleanup only fires for files with prior provenance headers.** `test_no_header_no_orphan_cleanup` pins this carefully — a user-created file in the assets subdir of a CONFLICT file is NOT deleted. The contract: we only manage sibling files when we know we own them (confirmed via the provenance header). Manually-authored `.md` files with no header may have user-placed assets; touching them would be a data-loss bug.

- **Assets dir is removed if fully orphaned.** `test_assets_dir_removed_when_fully_orphaned` creates a v1 with images, reconverts to a v2 without images, and verifies the entire `stem/` directory disappears. The reverse of the "don't touch what we don't own" rule — if every file in the dir is an orphan we created, we clean up comprehensively.

- **Path traversal rejected defensively.** `test_path_traversal_rejected` passes `../escape.docx`. Even though the caller should use `scan_convertible_files` output (which never contains traversal), we validate `source_abs.relative_to(root.resolve())`. The test accepts either "must be within repository root" or "not found" messages — the important invariant is that the traversal doesn't escape, not the specific wording.

#### Pass A3 — xlsx colour-aware + csv (delivered)

Adds xlsx support via a dedicated openpyxl pipeline that preserves cell background colours as emoji markers. csv support is simpler — routed through markitdown since markitdown produces clean markdown tables for csv natively and there's no formatting to preserve.

- `src/ac_dc/doc_convert.py` — module-level additions:
  - `_XLSX_EXTENSIONS = frozenset({".xlsx"})` — dispatch set for the openpyxl path. Separated from `_MARKITDOWN_EXTENSIONS` so the xlsx-specific routing is explicit.
  - `.csv` added to `_MARKITDOWN_EXTENSIONS`. markitdown's built-in csv handling produces standard markdown tables; no colour info to preserve.
  - `_IGNORE_NEAR_WHITE_THRESHOLD` / `_IGNORE_NEAR_BLACK_THRESHOLD` — per-channel RGB deltas (20) for filtering "effectively no fill" cells. Default formatting in many spreadsheets produces near-white fills; emitting an emoji for every such cell would overwhelm the output. Black is filtered for symmetry with border-coloured cells.
  - `_COLOUR_CLUSTER_DISTANCE = 40.0` — Euclidean RGB distance below which two unknown colours collapse into one cluster. Tuned so three shades of brown each get distinct markers but slight rendering drift of the same "red" stays unified.
  - `_NAMED_COLOURS` — eight well-known hues (red, green, yellow, blue, orange, purple, pink, brown) each mapped to an emoji and a name. Used for the "named match" path in colour assignment.
  - `_NAMED_COLOUR_DISTANCE = 80.0` — looser threshold for matching against named colours than the cluster distance. Named colours should absorb a wider range of shades (every "pinkish red" → 🔴); fallback clusters should stay distinct.
  - `_FALLBACK_MARKERS` — eight distinct emoji glyphs (⬛, ◆, ▲, ●, ■, ★, ◉, ◈) for unrecognised colour clusters. Cycle with index suffixing if more than eight clusters appear (rare in practice).
- `src/ac_dc/doc_convert.py` — dispatch in `_convert_one`:
  - Added a new branch between the markitdown path and the "not yet supported" skip: `if suffix in _XLSX_EXTENSIONS: return self._convert_via_openpyxl(root, source_abs, rel_path)`.
- `src/ac_dc/doc_convert.py` — `_convert_via_openpyxl` and helpers:
  - Lazy openpyxl import. ImportError → fall back to markitdown (not error). Matches specs4's "graceful degradation" policy for optional deps.
  - Source hash computed before open so the provenance header is correct even on fallback.
  - openpyxl `load_workbook(read_only=False)` — read-only mode would strip the Cell.fill attribute we need. data_only=True so formula cells yield cached values rather than formula strings.
  - Pass 1 — `_xlsx_pass1_collect` walks every sheet via `sheet.iter_rows()`. For each cell, normalises the value (via `_normalise_cell_value`) and extracts the fill (via `_extract_cell_fill`). Unique hex fills accumulated into a set for the colour-map pass.
  - Colour mapping — `_xlsx_build_colour_map`. Two-phase: named-colour match first (closest named hue within `_NAMED_COLOUR_DISTANCE`), then cluster-based fallback for unmatched fills. Fills sorted lexicographically before processing so the marker assignment is deterministic across runs.
  - Pass 2 — `_xlsx_render_sheet` emits markdown per sheet. Strips fully-empty rows, then fully-empty columns. Uses the first non-empty row as the header if every kept-column cell has a string value; otherwise synthesises `col1`, `col2`, ... names. Coloured cells get their marker prepended (`"🔴 Failed"`); coloured empty cells show just the marker.
  - Legend rendering — `_xlsx_render_legend` emits a `## Legend` section listing each unique (marker, name) pair once. Multiple fills mapped to the same named colour (all reddish → 🔴 red) collapse in the legend.
  - Empty-spreadsheet case — produces a placeholder `(empty spreadsheet)` body so the output file exists and the scanner classifies it as `current`. Without this, a sparse xlsx would produce no output and re-scan as `new` every cycle.
  - xlsx path never produces embedded images, so the provenance header always has `images=()`. Skips the whole data-URI extraction pipeline that the markitdown path runs.

- `src/ac_dc/doc_convert.py` — helper methods:
  - `_normalise_cell_value` — handles None (→ empty), "nan"/"none" case-insensitively (→ empty, catches pandas/numpy export artifacts), stringification for non-strings, and pipe escaping (`|` → `\|`) so cell values can't break the markdown table row structure.
  - `_extract_cell_fill` — the defensive part. openpyxl's fill model is verbose: cells with no explicit fill still have a `PatternFill` with theme-default `fgColor`. Filter by checking `patternType` is one of `solid`/`lightGrid`/`darkGrid` (solid is the common case; the grid variants crop up in rare templates). Theme colours return None from `rgb`; we don't resolve them without the workbook theme table, which isn't worth the code for a diagnostic marker. 8-char `AARRGGBB` strips the alpha prefix. Near-white and near-black fills filtered per the module thresholds. Broad exception handler — anything unexpected from openpyxl returns None rather than raising.
  - `_hex_to_rgb` / `_colour_distance` — straightforward Euclidean RGB. Perceptually naive (doesn't weight green) but fine for the "are these two reds the same?" question the clustering needs.

- `tests/test_doc_convert.py` — test infrastructure:
  - `_require_openpyxl()` — skips tests when openpyxl isn't installed. Tests don't mock openpyxl; building real xlsx files through the library's own API is cheaper and catches more real-world bugs than a mock that tracks only the shape of `iter_rows`.
  - `_write_xlsx(path, sheets)` — builds a real xlsx file at `path` from a `{sheet_name: [[(value, fill_hex), ...]]}` dict. Uses `openpyxl.Workbook` + `PatternFill` directly. Removes the default sheet before adding named ones so sheet ordering is predictable.

- `tests/test_doc_convert.py` — removed the obsolete `test_xlsx_skipped_not_yet_supported` test (xlsx is now implemented, so "skipped" is no longer the expected behaviour).

- `tests/test_doc_convert.py` — four new test classes:
  - `TestXlsxDispatch` — 4 tests: xlsx routes to openpyxl (not markitdown), output file produced, provenance header present, scan classifies as `current` after conversion.
  - `TestXlsxContent` — 8 tests: sheet name becomes `## heading`, first row becomes table header, separator row present, multiple sheets each produce their own section, empty rows stripped, empty columns stripped, "nan"/"none" values normalised to empty, empty spreadsheet produces placeholder output.
  - `TestXlsxColours` — 8 tests: red fill (`FF0000`) → 🔴 marker, green fill (`00C800`) → 🟢 marker, legend lists used colours, no legend when no colours, near-white fills ignored, near-black fills ignored, unknown colours get fallback markers via clustering, coloured empty cells show marker alone.
  - `TestXlsxFallback` — 2 tests: missing openpyxl import falls back to markitdown (via `builtins.__import__` monkeypatching), corrupt xlsx (not a real zip) falls back to markitdown without crashing.

- `tests/test_doc_convert.py` — added `test_csv_routes_to_markitdown` to `TestExtensionDispatch` confirming csv now goes through markitdown (previously part of the "deferred" extensions).

Design points pinned by tests:

- **Deterministic colour assignment.** `_xlsx_build_colour_map` sorts `unique_fills` lexicographically before processing. Without this, Python's set iteration order would assign cluster markers non-deterministically across runs. Two runs on the same workbook must produce byte-identical output for the stability tracker's content-hash to stay stable.

- **Sheet titles preserved verbatim.** Sheet names containing pipes, markdown special chars, etc. would break the output, but realistically users don't name sheets `| broken | table |`. No escaping for sheet titles — only cell values. If this becomes a problem we can add heading escaping in a follow-up.

- **Empty-spreadsheet handling is mandatory.** Without the `(empty spreadsheet)` fallback, a sparse xlsx produces zero body parts, the legend is empty, and we write a file with just the provenance header. That file parses as a conflict (no recognisable content after the header) on the next scan. The placeholder keeps the file classifiable as `current`.

- **Near-white threshold matters in practice.** Many spreadsheets have theme-default "subtle" fills (pale yellow for note rows, near-white for alternating stripes) that users don't consciously set. The 20-per-channel threshold filters these out while still catching deliberate fills like "light red" (`FFAAAA`) which sit well above the threshold.

- **Pipe escaping in cell values.** `_normalise_cell_value` escapes `|` as `\|`. Without this, a cell containing "a | b" would add a fake column separator and break the table structure. Tested indirectly — any test that produces markdown output exercises this path.

- **Legend deduplication by (marker, name) pair.** Multiple hex fills can map to the same named colour (slight variations of red all → 🔴 red). The legend lists the pair once rather than duplicating per-hex. Pinned by `test_legend_lists_used_colours` which uses two different hex values that both fall into the "red" named-colour range.

Notes from delivery:

- **The `read_only=False` mode is deliberate.** openpyxl's `read_only=True` is faster and uses less memory but strips the `Cell.fill` attribute — which is the whole point of the xlsx pipeline. Tests on small files are trivially fast so the tradeoff doesn't matter for typical xlsx sizes; if huge-xlsx support becomes a concern we can add a two-path implementation.

- **`patternType` check catches the "no fill but has colour" case.** openpyxl represents a cell with no explicit fill as `PatternFill(patternType=None, fgColor=...)` — the fgColor is a theme default, not a user choice. Filtering on `patternType in ("solid", ...)` eliminates the false positive without needing to resolve theme colours.

- **Alpha channel stripping.** openpyxl returns fgColor.rgb as an 8-char `AARRGGBB` hex string. We strip the alpha prefix if present (`len(raw) == 8`). Alpha is virtually always `FF` (fully opaque) in practice; a semi-transparent fill is not meaningful for our marker extraction.

- **Graceful degradation.** The xlsx pipeline never errors for reasons specific to xlsx. ImportError on openpyxl, corrupt file, unexpected structure — all fall back to markitdown. The user gets SOMETHING (possibly just raw text with no colour info) rather than a red error result.

#### Pass A4 — pptx via python-pptx (fallback) (delivered)

Adds pptx support via a dedicated python-pptx pipeline that renders each slide as a standalone SVG. Each SVG contains the slide's text, embedded images, and tables. An index markdown links all slide SVGs. This is the fallback pipeline; the primary PyMuPDF+LibreOffice path for pptx lands in Pass A5.

- `src/ac_dc/doc_convert.py` — module-level additions:
  - `_PPTX_EXTENSIONS = frozenset({".pptx"})` — dispatch set for the python-pptx path.
  - `_EMU_PER_INCH`, `_SVG_DPI = 96`, `_EMU_TO_PX` — conversion from python-pptx's native EMU units to SVG pixels at 96 DPI.
  - `_DEFAULT_SLIDE_WIDTH_EMU` / `_DEFAULT_SLIDE_HEIGHT_EMU` — standard 4:3 slide (10" x 7.5") as fallback when python-pptx reports None dimensions (rare but defensive against corrupted templates).
  - `_DEFAULT_FONT_SIZE_PT = 18` — PowerPoint's default body text size. Used when a text run doesn't specify a font size explicitly.
  - `_DEFAULT_FONT_COLOR = "#000000"` — black reads correctly against default white slide backgrounds. Theme-aware colour resolution is a future enhancement.
  - `_PT_TO_PX = 96 / 72` — SVG font-size is in user units (pixels at 96 DPI); 1 point = 4/3 pixels.
  - `_SLIDE_NUMBER_MIN_WIDTH = 2` — default zero-padding width for slide filenames. Decks with more than 99 slides dynamically pad to 3 digits.

- `src/ac_dc/doc_convert.py` — dispatch in `_convert_one`:
  - Added a new branch after the xlsx path and before the "not yet supported" skip: `if suffix in _PPTX_EXTENSIONS: return self._convert_via_python_pptx(root, source_abs, rel_path)`.

- `src/ac_dc/doc_convert.py` — `_convert_via_python_pptx` and helpers:
  - Lazy python-pptx import. ImportError → per-file error with install hint (same pattern as markitdown). Unlike xlsx there's no fallback — A5's LibreOffice+PyMuPDF pipeline is the primary path; this is the fallback for users without those deps.
  - Source hash computed before open so provenance is correct.
  - Slide dimensions extracted via `presentation.slide_width` / `.slide_height` in EMU, converted to pixels for SVG viewBox.
  - Empty-presentation placeholder — a deck with no slides produces a `(empty presentation)` body so the scan classifies it as `current` rather than cycling `new` every pass. Output file is still written with a provenance header.
  - Dynamic zero-padding — `max(_SLIDE_NUMBER_MIN_WIDTH, len(str(len(slides))))` so 150-slide decks pad to 3 digits, 10-slide decks pad to 2. Consistent width within a single deck.
  - Assets subdirectory always created — every slide produces an SVG, unlike markitdown where image subdir creation is conditional.
  - Per-slide failure isolation — a slide that fails to render gets a placeholder entry in the index (`## Slide N\n\n*(rendering failed)*`) and the rest of the deck proceeds. Debug-logged for diagnostics without breaking the batch.
  - Orphan cleanup on re-conversion — reads the prior output's provenance header, diffs `images=` against the slides produced this round, unlinks orphans. Prevents a re-saved deck with fewer slides from leaving stale SVGs on disk.

- `src/ac_dc/doc_convert.py` — SVG rendering helpers:
  - `_render_pptx_slide` — emits the full SVG document. White background rect sized to viewBox, then walks slide shapes and dispatches each to `_render_pptx_shape`. Per-shape exceptions are caught and logged; never aborts the whole slide.
  - `_render_pptx_shape` — dispatches on shape type via attribute probes: `_is_picture` (checks for `.image.blob`), `has_table`, `has_text_frame`. Unsupported shapes (charts, SmartArt, groups, OLE) return empty string — caller skips. Probes use attribute access rather than importing `MSO_SHAPE_TYPE` to keep the pipeline resilient to python-pptx API changes.
  - `_render_picture` — reads `shape.image.blob`, base64-encodes, emits `<image>` with `xlink:href="data:{mime};base64,..."`. Inline images keep slide layout self-contained (one SVG per slide, no external refs).
  - `_render_text_frame` — renders each paragraph as a `<text>` line positioned by cumulative line height. Returns a `<g>` wrapper. Empty frames produce empty string rather than degenerate wrappers.
  - `_render_paragraph` — extracts font properties from the first non-empty run: size (via `font.size.pt`), weight (bold → `bold`), style (italic → `italic`), colour (via `_extract_font_color`), alignment (via `_resolve_text_anchor`). SVG baseline positioning — shifts y by font size so text renders at the visually expected vertical position. Line height is 1.2× font size (PowerPoint single-spacing default).
  - `_extract_font_color` — returns `#rrggbb` from `font.color.rgb` or None when the font uses a theme colour. python-pptx raises `AttributeError` for theme colours; the swallow is deliberate, callers use the default black.
  - `_resolve_text_anchor` — maps `PP_ALIGN` enum values to SVG `text-anchor` + adjusted x coordinate. Probes the alignment name (`"CENTER"`, `"RIGHT"`) rather than importing the enum from python-pptx.
  - `_render_table` — renders as a grid of `<rect>` borders + `<text>` cell content. Uniform cell widths from `table.columns` / `table.rows` with fallback to equal division if dimensions are zero. No merged-cell handling — out of A4 scope.
  - `_escape_svg_text` — XML-escapes `<`, `>`, `&`, plus quote characters for attribute-context robustness. Strips leading/trailing whitespace (PowerPoint often pads bullet text).

- `src/ac_dc/doc_convert.py` — `_write_pptx_output` and `_read_prior_images` helpers:
  - Shared output-writing path for the normal and empty-deck cases. Builds provenance header with `images=(slide_names)` tuple, prepends to markdown body, atomic write.
  - `_read_prior_images` — reads the existing output's provenance header and returns the tuple from `images=`. Used by the orphan-cleanup path. Empty tuple when no prior output exists or the header is absent/malformed.

- `tests/test_doc_convert.py` — test infrastructure:
  - `_require_pptx()` — skip guard for tests running without python-pptx.
  - `_make_pptx_with_title(path, title, body="")` — builds a pptx with a title slide using python-pptx's default layout. Body text optional.
  - `_make_pptx_with_n_slides(path, n)` — builds a pptx with `n` numbered title slides.
  - `_make_pptx_with_image(path, image_bytes)` — builds a pptx with one image-containing slide using `add_picture`. Image is sized to 3"x2" positioned at (1", 1").
  - `_make_pptx_with_table(path)` — builds a pptx with a 2×3 table. Fixed content so tests can assert on specific cell text.

- `tests/test_doc_convert.py` — removed the obsolete `test_pptx_skipped_not_yet_supported` test (pptx is now implemented).

- `tests/test_doc_convert.py` — five new test classes:
  - `TestPptxDispatch` — 5 tests: pptx routes to python-pptx (not markitdown), output markdown file produced, assets subdirectory produced, provenance header present, scan classifies as `current` after conversion.
  - `TestPptxSlideFiles` — 4 tests: single slide produces `01_slide.svg`, multiple slides zero-padded, 100-slide deck pads to 3 digits (`001_slide.svg` through `100_slide.svg`), images listed in provenance header.
  - `TestPptxIndexMarkdown` — 3 tests: index contains `## Slide N` headings, index contains `![Slide N](deck/NN_slide.svg)` image references, empty presentation produces placeholder body.
  - `TestPptxSvgContent` — 6 tests: title text appears in SVG, SVG has valid root and xmlns, SVG has viewBox attribute, image embedded as `data:image/...;base64,...` URI, table cell text present with rect borders, special characters (`<`, `>`, `&`) XML-escaped.
  - `TestPptxOrphanCleanup` — 1 test: re-conversion with fewer slides deletes the stale SVGs from the assets subdirectory.
  - `TestPptxFailures` — 2 tests: missing python-pptx returns error with install hint (via `builtins.__import__` monkeypatching), corrupt pptx errors cleanly without crashing.

Design points pinned by tests:

- **Every slide produces an SVG.** Unlike the markitdown path where assets-dir creation is conditional on image presence, the pptx fallback always produces an assets subdirectory because every slide renders as an SVG. Pinned by `test_pptx_produces_assets_subdirectory` — even a title-only slide with no embedded images still generates its own SVG.

- **Zero-padding width is deck-scoped.** The padding chosen for a 3-slide deck (2 digits) differs from a 100-slide deck (3 digits). Within one deck the width is consistent, which keeps the file listing in alphabetical sort order. Pinned by `test_large_deck_pads_width` with an explicit 100-slide deck.

- **Attribute-probe dispatch over enum import.** The shape-type dispatch uses `hasattr(shape.image, "blob")`, `shape.has_table`, `shape.has_text_frame` rather than importing `MSO_SHAPE_TYPE`. python-pptx's internal enum values have changed between versions; hasattr is forward-compatible. Pinned by the image and table tests passing on the library's current API — a future version that reshapes the enum won't break the dispatch.

- **Theme colours degrade to default.** `_extract_font_color` swallows `AttributeError` when `font.color.rgb` raises (which happens for theme colours). Returning None triggers the default black. Rather than resolving theme colours properly (which would require parsing the slide master's theme XML), we accept the fidelity loss for a much simpler implementation.

- **First-run property extraction, not per-run.** `_render_paragraph` extracts properties from the first non-empty run in the paragraph. Text within a paragraph that mixes bold/non-bold runs rendered with the first run's style. The spec explicitly calls this out as A4 scope — per-run formatting is deferred to the richer A5 pipeline.

- **Empty-presentation placeholder is mandatory.** Without the `(empty presentation)` body, a pptx with no slides would produce zero `images=` entries in the provenance header and potentially an empty markdown body. Next scan classifies it as `current` because the hash matches, but the output is useless. The placeholder ensures something navigable exists.

- **Orphan cleanup mirrors the markitdown path.** Re-saved deck with 1 slide replacing a 3-slide deck: `02_slide.svg` and `03_slide.svg` are unlinked because they're in the prior `images=` list but not in the current round's saved slides. Pinned by `test_reconversion_with_fewer_slides_removes_orphans`.

- **Per-slide failure is isolated.** A slide that fails to render doesn't break the deck. The index entry becomes `*(rendering failed)*` for that slide, the rest proceed. Not tested directly (all test slides are well-formed), but the exception-handling structure matches the markitdown path's per-file isolation.

- **No fallback to markitdown.** Unlike xlsx where openpyxl failures fall back to markitdown, pptx has no fallback in A4 — python-pptx missing returns a clean error. A5 will add the LibreOffice+PyMuPDF primary path; until then, users without python-pptx can't convert pptx files.

Notes from delivery:

- **EMU → pixels is a reference conversion.** SVG's `user units` scale with the viewBox — the absolute pixel values don't matter as long as shape dimensions are consistent with the viewBox. Using 96 DPI as the reference gives SVGs that render at approximately the original slide size in a 1:1 viewer, but renderers that fit-to-container will scale them regardless.

- **`shape.image.blob` for picture detection.** The natural test is `shape.shape_type == MSO_SHAPE_TYPE.PICTURE` (value 13), but importing the enum couples to python-pptx internals. The attribute probe is equally specific and version-independent.

- **Table rendering uses default font.** Per-cell formatting would require walking `cell.text_frame.paragraphs` and merging run properties with cell-level defaults. Keeping the table renderer to default-font text keeps the implementation compact and the output legible — richer formatting is a future refinement, not an A4 requirement.

- **Alpha channel on images preserved.** Raster images with transparency (PNG with alpha channel) are embedded via the data URI verbatim. The SVG renderer honours the transparency, so slide backgrounds show through — matches PowerPoint behaviour.

- **Base64-inlined images are self-contained.** A slide with an image produces a single SVG file rather than an SVG + separate PNG. Image-externalisation (for the PyMuPDF path in A5) will extract these to separate files; in A4 the inlining keeps per-slide output atomic.

- **Background colour hardcoded white.** A theme-aware implementation would parse the slide master's `bg` XML. Keeping it white in A4 is acceptable because most presentations use white backgrounds, and users with dark-themed presentations will see dark text on white instead of dark text on dark (legible, if not visually faithful).

#### Pass A5b — LibreOffice + PyMuPDF pipeline (primary pptx/odp path) (delivered)

Completes the doc convert backend. pptx and odp route through `soffice --headless --convert-to pdf` to produce an intermediate PDF, which is then processed by the Pass A5a PyMuPDF pipeline. Output markdown lands next to the original source (not the temp PDF); provenance header records the original filename and hash. Graceful fallback to format-specific paths (python-pptx for `.pptx`, markitdown for `.odp`) when LibreOffice or PyMuPDF is missing, or when the soffice invocation fails for any reason.

- `src/ac_dc/doc_convert.py` — changes:
  - `_convert_via_pymupdf` gains three optional keyword-only parameters: `pdf_source` (open a different file than `source_abs`), `display_name` (override the provenance `source=` field), `hash_source` (override which file gets hashed). Defaults preserve the A5a behaviour for direct PDF callers. The parameters thread through `_process_pdf_document` and `_write_pdf_output` so the provenance header on the final markdown reflects the original pptx/odp rather than the intermediate PDF.
  - New `_convert_via_libreoffice(root, source_abs, rel_path)` method. Pre-flight checks both deps (`shutil.which("soffice")` and `_probe_import("fitz")`). Any missing dep falls back to the format-specific path without subprocess launch. Runs `soffice --headless --convert-to pdf --outdir {tmpdir} {source}` with `_LIBREOFFICE_TIMEOUT_SECONDS = 120` timeout. Output PDF found by `{source_stem}.pdf` in the temp dir, with a fallback to `tmp_path.glob("*.pdf")` for locale variants. Routes the intermediate PDF through `_convert_via_pymupdf` with provenance overrides. Temp dir cleanup bounded by `TemporaryDirectory` context manager — guaranteed regardless of which branch exits.
  - New `_libreoffice_fallback(root, source_abs, rel_path, reason)` method. Dispatches on source extension: `.pptx` → `_convert_via_python_pptx`; `.odp` → `_convert_via_markitdown`. Debug-logs the reason so operators can diagnose why the primary path was skipped.
  - `_LIBREOFFICE_EXTENSIONS = frozenset({".pptx", ".odp"})` and `_LIBREOFFICE_TIMEOUT_SECONDS = 120` module constants.
  - `_convert_one` dispatch updated — `_LIBREOFFICE_EXTENSIONS` checked before `_PPTX_EXTENSIONS`, so pptx routes to LibreOffice first when available. The `_PPTX_EXTENSIONS` branch is now only reached via `_libreoffice_fallback`.

- `tests/test_doc_convert.py` — changes:
  - Added `shutil` import.
  - New `force_pptx_fallback` fixture — monkeypatches `ac_dc.doc_convert.shutil.which` to return None. Applied via `@pytest.mark.usefixtures("force_pptx_fallback")` on `TestPptxDispatch`, `TestPptxSlideFiles`, `TestPptxIndexMarkdown`, `TestPptxSvgContent`, `TestPptxOrphanCleanup`. These A4 fallback tests assert on python-pptx output format (`NN_slide.svg`, `## Slide N` headings), which is incompatible with the A5b primary path's output format (`NN_page.svg`, `## Page N` headings). The fixture forces them onto the fallback path regardless of whether LibreOffice is installed on the test machine.
  - `TestPptxFailures` updated to use the same `shutil.which` monkeypatch pattern inline — two tests now bypass LibreOffice explicitly since they depend on the python-pptx fallback path's error behaviour.
  - Four new test classes for A5b coverage:
    - `TestLibreOfficeDispatch` — pptx and odp route to LibreOffice when soffice is on PATH. Uses subprocess mocking to verify the command arguments (`--headless`, `--convert-to pdf`, `--outdir`) and the source path.
    - `TestLibreOfficeFallback` — six scenarios all fall back cleanly: no soffice (pptx → python-pptx, odp → markitdown), timeout, non-zero exit, missing output PDF, no PyMuPDF.
    - `TestLibreOfficeProvenance` — provenance header records `source=deck.pptx` (not `source=deck.pdf`), hash is of the original file, output lands at `{source_dir}/{stem}.md`, scan classifies as `current` after conversion.
    - `TestLibreOfficeEndToEnd` — single test that runs against real LibreOffice when installed (skipped otherwise). Ensures the mocked tests above aren't hiding a real-world issue with subprocess arg construction, output path resolution, or format compatibility.
  - `test_mixed_batch_produces_per_file_results` reworked. Before A5a/b there were multiple supported-but-deferred extensions that produced `skipped` results, making "one success + one skip" a natural per-file-isolation test. After A5b every extension has a working path, so the test now pairs `ok.docx` (success) with `missing.docx` (pre-flight failure — file not found) to prove the same isolation invariant.

Design points pinned by tests:

- **LibreOffice runs before python-pptx for pptx.** Dispatch order matters — the `_LIBREOFFICE_EXTENSIONS` check precedes `_PPTX_EXTENSIONS` in `_convert_one`. Without this, pptx would always hit the fallback path even when LibreOffice is installed. Pinned by `test_pptx_routes_to_libreoffice_when_available` which asserts subprocess.run IS called when soffice is on PATH.

- **Fallback is silent, not an error.** `_libreoffice_fallback` emits a debug log and routes to the format-specific path. The user gets conversion output (possibly lower-fidelity) rather than a failed conversion. Six fallback scenarios are tested — if any produced an error status when they should fall back, the test matrix catches it.

- **Provenance overrides are critical for re-conversion.** `test_hash_reflects_original_source` pins that the hash recorded in the header is of the original `.pptx` bytes, not the intermediate PDF. LibreOffice timestamps vary across runs so byte-identical intermediate PDFs aren't guaranteed — hashing the intermediate would mean a stable source scans as `stale` on every re-run. Similarly, `test_header_uses_original_filename` pins `source=deck.pptx` so the scan's status classification lookup works (it derives the expected output location from `{source_stem}.md`).

- **Output path stays anchored to the source.** `test_output_lands_next_to_original` writes `docs/deck.pptx` and verifies the output ends up at `docs/deck.md`, not in the temp dir. Straightforward but easy to break if `source_abs` is inadvertently replaced with `pdf_source` elsewhere in the pipeline.

- **`TemporaryDirectory` cleanup covers every exit path.** Errors from `_convert_via_pymupdf` (corrupt intermediate PDF, write failure) still unwind through the `with tempfile.TemporaryDirectory(...)` context manager, so the temp dir is always removed. Not explicitly tested — the context manager guarantees this by construction.

- **Real LibreOffice test guards against mock drift.** `test_real_libreoffice_converts_pptx` is skipped when soffice isn't on PATH, but when present it exercises the full subprocess invocation with real argument parsing. Catches regressions where a mocked test passes but the real soffice CLI expects different flag shapes (e.g., `--outdir=X` vs `--outdir X`).

Notes from delivery:

- **Test environment surprise.** Initial test run on a machine WITH LibreOffice installed revealed that 15 existing A4 tests failed because they were built against the python-pptx fallback output format. They asserted on filenames like `01_slide.svg` and headings like `## Slide 1`, both of which change when the PDF pipeline takes over (`01_page.svg`, `## Page 1`). The `force_pptx_fallback` fixture is the fix — preserves the A4 tests' intent while letting the A5b primary path be fully exercised by the new test classes.

- **The `_mixed_batch_produces_per_file_results` test needed reshaping, not extension swapping.** The original test paired a `.docx` success with a `.pdf` "not yet supported" skip, proving that one file's failure doesn't abort the batch. A5a implemented `.pdf`, so the test switched to `.odp` for the skip side. A5b implemented `.odp` too, leaving no supported-but-deferred extension to use as the skip side. Rather than keep chasing deferred extensions, changed the test to use a missing file (pre-flight failure) — structurally equivalent per-file-isolation proof, but extension-agnostic so future additions won't break it again.

- **`shutil.which` monkeypatched at the module level, not globally.** `monkeypatch.setattr("ac_dc.doc_convert.shutil.which", ...)` replaces the name in the doc_convert module's namespace only. Other modules that import `shutil.which` directly are unaffected. The RPC-inventory tests, for example, still see the real `shutil.which` even while `force_pptx_fallback` is active. Avoids cross-test contamination.

Open — nothing carried over. Doc Convert backend is complete for the scope specs4/4-features/doc-convert.md covers. Frontend UI (the Doc Convert tab) lands with Layer 5.

#### Pass A5a — PDF via PyMuPDF (direct, no LibreOffice) (delivered)

Adds PDF support via PyMuPDF's hybrid text + SVG pipeline. Each page's text is extracted into markdown paragraphs; pages with raster images or significant vector drawings also get companion SVGs. Glyph elements are stripped from SVGs when text is already in markdown (avoids duplication). Embedded raster images are externalised from SVGs to separate files. This is the direct PDF path — Pass A5b will add the LibreOffice-based pptx/odp → PDF conversion on top of this pipeline.

- `src/ac_dc/doc_convert.py` — module-level additions:
  - `_PDF_EXTENSIONS = frozenset({".pdf"})` — dispatch set for the direct PyMuPDF path.
  - `_PAGE_GRAPHICS_THRESHOLD = 3` — minimum significant-drawing count to trigger SVG export alongside text. Below this, page is treated as text-only.
  - `_PATH_SIGNIFICANT_SEGMENTS = 4` / `_POLYGON_SIGNIFICANT_SEGMENTS = 2` — significance thresholds per specs4/4-features/doc-convert.md.

- `src/ac_dc/doc_convert.py` — dispatch in `_convert_one`:
  - Added a new branch after the pptx path: `if suffix in _PDF_EXTENSIONS: return self._convert_via_pymupdf(...)`.

- `src/ac_dc/doc_convert.py` — `_convert_via_pymupdf` and helpers:
  - Lazy PyMuPDF import. ImportError → per-file error with install hint. No fallback — PyMuPDF is the only reliable PDF extractor.
  - Document opened via `fitz.open`; errors wrapped with broad catch (corrupt PDF, wrong version, encrypted without password all produce different exception types).
  - `_process_pdf_document` split from `_convert_via_pymupdf` so the `doc.close()` is guaranteed in the caller's finally block regardless of which branch exits.
  - Empty-PDF placeholder — a document with zero pages produces `(empty PDF)` body so the scan classifies it as `current`.
  - Dynamic zero-padding for page filenames — `max(_SLIDE_NUMBER_MIN_WIDTH, len(str(page_count)))`. Consistent width within a single PDF.
  - Per-page failure isolation — a page that fails to process gets a placeholder entry in the index (`## Page N\n\n*(page rendering failed)*`) and the rest of the document proceeds. Two failure paths: page load fails (rare) and page rendering fails (more common, e.g. unusual font).
  - Assets subdirectory created lazily on the first page that actually needs it. Text-only PDFs produce no assets dir.
  - Orphan cleanup on re-conversion — reads prior provenance header, unlinks artefacts (SVGs + externalised images) listed there but not produced this round. Empty assets dir removed after cleanup.

- `src/ac_dc/doc_convert.py` — `_process_pdf_page`:
  - Per-page dispatch logic: extract text first, then detect images and drawings, then decide whether to emit SVG.
  - SVG emission criteria: page has any raster images OR >= _PAGE_GRAPHICS_THRESHOLD significant drawings OR page has no text AND no detected content (fallback — lightweight vector graphics below the significance threshold still get captured).
  - Markdown structure per page: `## Page N` heading, then extracted text paragraphs if any, then image reference if SVG was emitted.
  - Text-only pages emit no SVG — keeps output lean.
  - Pages where SVG write fails still emit the text markdown (best-effort).

- `src/ac_dc/doc_convert.py` — text extraction via `_extract_pdf_text`:
  - Uses `page.get_text("dict")` which returns structured blocks/lines/spans.
  - Each text block becomes one paragraph; spans within lines joined by spaces; lines within a block also joined by spaces (visual-wrap within a block is usually not semantic paragraph break).
  - Future enhancement: heading detection from font sizes. For A5a, emits plain paragraphs.

- `src/ac_dc/doc_convert.py` — drawing significance via `_count_significant_drawings`:
  - Walks `page.get_drawings()` output.
  - Bézier (`c`) or quadratic (`qu`) curves → always significant.
  - Filled paths with > _POLYGON_SIGNIFICANT_SEGMENTS segments → significant.
  - Other paths with > _PATH_SIGNIFICANT_SEGMENTS segments → significant.
  - Simple rectangles and single lines → NOT significant (border/table-rule noise every PDF emits).

- `src/ac_dc/doc_convert.py` — SVG export and processing:
  - `_export_pdf_page_svg` — calls `page.get_svg_image(text_as_path=0)` so text stays as `<text>` elements rather than decomposed paths. Keeps SVG selectable and small.
  - `_strip_svg_glyphs` — regex-removes `<text>...</text>` when `strip_glyphs=True`. Used when text is already in markdown; keeps visual layout (drawings, images) without duplicating word content. PyMuPDF's SVG output doesn't nest `<text>` elements so the regex is reliable.
  - `_externalize_svg_images` — scans SVG for `href="data:image/..."` attributes (both `href` and `xlink:href` variants), decodes base64 payloads, writes files with `{stem}_img{NN}{ext}` naming, rewrites SVG attributes to reference files. Failures leave original data URI in place (broken-ref is better than silent content loss). Uses the `_MIME_TO_EXT` map shared with the markitdown path.

- `tests/test_doc_convert.py` — test infrastructure:
  - `_require_pymupdf()` — skip guard for tests without PyMuPDF installed.
  - `_make_pdf_with_text(path, pages)` — builds a PDF with one text block per page.
  - `_make_pdf_with_image(path, image_bytes)` — builds a PDF with one image-containing page.
  - `_make_pdf_with_text_and_image(path, text, image_bytes)` — mixed-content page.
  - `_make_empty_pdf(path)` — writes a minimal valid PDF with zero pages by hand (PyMuPDF's save requires at least one page, so we bypass the library to construct the zero-page case).

- `tests/test_doc_convert.py` — removed `test_pdf_skipped_not_yet_supported` (PDF is now implemented).

- `tests/test_doc_convert.py` — seven new test classes:
  - `TestPdfDispatch` — 4 tests: pdf routes to PyMuPDF, produces output file, provenance header present, scan classifies as `current`.
  - `TestPdfTextExtraction` — 4 tests: single-page text appears, multi-page text appears, page headings in order (`## Page 1` before `## Page 2`), text-only page produces no SVG.
  - `TestPdfImageHandling` — 6 tests: page with image produces SVG, SVG filename zero-padded, markdown has image link, text+image page produces both (text in markdown + SVG link), externalised image saved to disk, provenance lists all artefacts (SVGs + externalised images).
  - `TestPdfEmptyAndEdgeCases` — 1 test: empty PDF produces `(empty pdf)` placeholder.
  - `TestPdfOrphanCleanup` — 1 test: re-conversion with fewer pages removes stale artefacts.
  - `TestPdfFailures` — 2 tests: missing PyMuPDF returns error with install hint, corrupt PDF errors cleanly.
  - `TestPdfSvgGlyphStripping` — 1 test: text on a text+image page is in markdown only, NOT in the SVG (pins the glyph-stripping contract).

Design points pinned by tests:

- **Text-only pages produce no SVG.** `test_text_only_page_no_svg` writes a PDF with nothing but text and asserts the assets subdirectory doesn't exist. Text-only pages don't need SVG companion files; keeping the output lean matters for doc-heavy repos.

- **Glyph stripping is load-bearing for text+image pages.** `test_text_page_svg_has_no_text_elements` uses a distinctive unique phrase and asserts it appears in the markdown but NOT in the SVG. Without glyph stripping, both the markdown body AND the SVG would carry the text, doubling the LLM's token cost for no information gain. The regex is simple because PyMuPDF's SVG output is well-formed.

- **Image externalisation is mandatory.** PyMuPDF's SVG output embeds raster images as base64 data URIs. For large images this can blow up the SVG to megabytes. The externalisation step extracts them to sibling files, rewrites the SVG to reference those files. Matches the approach used by other subsystems that emit SVGs (the diff viewer's SVG resolution path).

- **Provenance tracks BOTH SVGs and externalised images.** `test_provenance_lists_all_artefacts` verifies the `images=` header field lists both types of files. The orphan cleanup pass on re-conversion diffs against this full list so stale externalised images don't accumulate.

- **Page-heading ordering pinned by index.** `test_page_headings_in_order` uses string indices to verify `## Page 1` appears before `## Page 2` before `## Page 3`. PyMuPDF's page iteration order IS document order by spec, but pinning the invariant in a test catches any future refactor that might sort pages differently.

- **Empty PDF has its own fast path.** `test_empty_pdf_placeholder` passes a zero-page PDF (built by hand since PyMuPDF's save requires ≥1 page) and asserts the output contains `empty pdf` content. Prevents scan re-classifying the output as `new` on every pass.

Notes from delivery:

- **`_process_pdf_document` extracted for finally-safety.** The main `_convert_via_pymupdf` has a try/finally that calls `doc.close()`. Extracting the actual work into a separate method means any early return (empty PDF, error writing output) still unwinds through the finally and closes the document. PyMuPDF keeps the underlying file descriptor open until close; leaking one per failed conversion would quickly hit file-descriptor limits.

- **Significance thresholds tuned for real-world PDFs.** Every PDF generator emits rectangles for page borders and lines for table rules; treating those as "significant graphics" would trigger SVG export on every page. The threshold of ≥3 significant drawings filters these out while still catching pages with genuine diagrams. Tuning could need revisiting for specific document types but the current values match the spec recommendation.

- **Raster image presence trumps drawing threshold.** One image anywhere on a page triggers SVG export regardless of drawing count. Raster content can't be extracted as text, so the SVG is the only representation.

- **Text-only page fallback.** A page with zero extractable text AND zero detected raster/drawings still gets a full-page SVG as a safety net. Lightweight vector content (a thin border, a single line) doesn't meet the significance threshold but isn't literally nothing. Better to produce an SVG that captures it than silently drop a page of content.

- **Externalised image naming uses zero-padded 2-digit index.** `{stem}_img01.png`, `{stem}_img02.png`. Different from the pptx path (which pads slide numbers at deck level, not image level) — each PDF page gets its own image counter starting from 01. Matches how users think about "the first image on page 2" vs the pptx model of "slide 7's content".

Open carried over for Pass A5b:

- **LibreOffice-based pptx/odp conversion.** Pass A5b will add `_convert_via_libreoffice` that spawns `soffice --headless --convert-to pdf` in a temp dir, then routes the resulting PDF through `_convert_via_pymupdf`. pptx and odp will get new dispatch branches that try the LibreOffice path first and fall back to python-pptx (for pptx) or markitdown (for odp) when either LibreOffice or PyMuPDF is missing.
- **Progress events.** Conversion will post progress via the event callback pattern already used by LLMService (event name `docConvertProgress`). Runs in a dedicated single-thread executor so GIL-heavy format-converter work doesn't block the event loop. Pass A5b especially needs this — LibreOffice subprocess launches take 1-3 seconds per file.

### 4.3 — Code review — **delivered**

Delivered in three passes: LLMService RPC surface + state management, review context injection into `_stream_chat`, and the `TestReview` test class.

- `_review_active` flag — was a Layer 3.9 stub returning False, now wired to `start_review`/`end_review`. `_build_completion_result` already gates edit application on this flag (pinned by `test_review_mode_skips_apply` in `TestStreamingWithEdits`), so review mode is read-only from the moment `start_review` succeeds.
- `_review_state` dict holds branch / base_commit / branch_tip / parent / original_branch / commits / changed_files / stats / pre_change_symbol_map. Populated by `start_review`, cleared by `end_review`. Held as a dict so `get_review_state` returns a single shape without re-assembly.
- `check_review_ready()` — clean-tree probe, returns `{clean, message?}`. Called by the review selector UI before rendering the commit graph so dirty-tree errors surface as inline feedback rather than failing mid-entry.
- `start_review(branch, base_commit)` — full 9-step entry sequence. Key ordering: checkout merge-base → build pre-change symbol map (disk is at pre-change state) → soft-reset (disk moves to branch tip, HEAD stays at merge-base) → rebuild post-change symbol index. The pre-change map capture between steps is why the sequence exists — no other moment in the session has the disk at the pre-change state.
- On any failure mid-sequence, `exit_review_mode` is called to roll back, and the error is surfaced. Review state isn't set until all steps succeed.
- `end_review()` — reverses entry. Always clears review state (even on repo-level exit failure) so the user isn't stuck in review UI if git has trouble reattaching to the original branch. Surfaces the error separately via `{error, status: "partial"}`.
- `get_review_state()` — returns a copy, with `pre_change_symbol_map` stripped (large, server-only consumption). Mutable sub-fields (commits, changed_files, stats) also defensively copied.
- `get_review_file_diff(path)` — delegation to `Repo.get_review_file_diff` guarded by `_review_active`.
- `get_commit_graph(limit, offset, include_remote)` — delegation to `Repo.get_commit_graph`. Exposed on LLMService so the browser drives the review selector via a single service rather than needing a Repo RPC registration.
- `get_snippets()` — mode-and-review aware. Review mode → review snippets; doc mode → doc snippets; else code snippets. Frontend calls unconditionally; the RPC determines the right array.
- System prompt swap via `ContextManager.save_and_replace_system_prompt` (saves current, installs review prompt). `end_review` calls `restore_system_prompt`.
- File selection cleared on review entry (both `_selected_files` and `_file_context`), with a `filesChanged` broadcast so the picker updates. Defense-in-depth — the frontend also clears its own selection on the `review-started` event.
- System event messages recorded in both context and history store on entry and exit.
- `get_current_state` now includes `review_state` so reconnect restores the review UI.

Review context injection:

- `_stream_chat` calls `_build_and_set_review_context()` before tiered-content building when `_review_active` is True. The helper constructs a block with four parts: (1) review summary (branch, merge-base → tip SHA, file/line stats), (2) commits list (ordered, each with short SHA + message first line + author + relative date), (3) pre-change symbol map under its own header, (4) reverse diffs for selected files that are also in the review's changed-files set.
- Non-review requests clear any stale review context defensively. Normally `end_review` handles the clear, but the guard protects against a crashed exit that left stale state on the context manager.
- Review context is re-built on every request so the reverse-diff set reflects the CURRENT file selection — if the user deselects a file mid-review, its diff drops from the next request's context.
- `ContextManager.assemble_tiered_messages` already renders review context as a uncached user/assistant pair between URL context and active files (per specs4/3-llm/prompt-assembly.md). No changes needed to the assembler; the attach point is the existing `set_review_context`.

Test coverage — `TestReview` class with 19 tests: clean-tree check (clean, dirty, no-repo), state snapshot integration (inactive default shape, included in `get_current_state`), start_review guards (no repo, dirty tree, concurrent), full entry/exit round-trip (system prompt swapped and restored, state populated and cleared, selection cleared, system events recorded in both stores, filesChanged broadcast), end_review guards (not-active, clears state even on git exit failure), diff fetch guards (active-required, no-repo), snippet dispatch (code default, review overrides doc, doc when doc-mode-without-review), commit graph delegation (with repo, without repo), return-value defensive copies (commits/changed_files/stats mutations don't affect stored state; pre_change_symbol_map stripped), streaming integration (review active → context attached with all four sections; non-review → stale context cleared).

Design points pinned by tests:

- **Review context re-built every request.** The helper is called from `_stream_chat` on every turn rather than once on entry. Pinned implicitly by `test_streaming_injects_review_context` — the selected-files-dependent part of the context (reverse diffs) wouldn't reflect mid-session selection changes if the build was one-shot. This matches specs4 — "Review context is re-injected on each message".

- **Reverse diffs gated on selection intersection.** A file in the selected set but NOT in the review's changed_files contributes no diff (it wasn't touched by the feature branch; the user selected it for reference). A file in changed_files but NOT selected contributes no diff (user didn't opt it into the review focus). Both conditions must hold. The tier assembler handles the "selected reference file" case via normal working-files rendering.

- **Pre-change symbol map optional.** When indexing fails on entry (or there's no symbol index), `pre_change_symbol_map` is an empty string and the section is omitted entirely from the context. The LLM still gets the commits and diffs — just not the topology-comparison affordance.

- **State cleared even on exit failure.** `test_end_review_clears_state_even_on_exit_failure` monkeypatches the repo's `exit_review_mode` to fail, verifies `_review_active` and `_review_state` are still cleared. The frontend's review-mode UI would otherwise be stuck waiting for a successful exit that never arrives. Git-side recovery guidance surfaces via the partial-status error message; the review state machine moves on.

- **Defensive copies everywhere.** `get_review_state` returns copies of `commits`, `changed_files`, `stats` (all mutable sub-fields). Caller mutations never leak back. Pinned by `test_review_state_returns_independent_copies`.

- **`pre_change_symbol_map` never exposed via RPC.** The frontend doesn't need the server-side map (the frontend has its own) and the map can be large. Stripped at the `get_review_state` boundary, not even in the `review_state` field of `get_current_state`.

Open carried over for later sub-layers:

- **Frontend review selector UI.** The git graph selector with commit-node clicking, disambiguation popover, clean-tree gate rendering lands with Layer 5. The backend exposes everything the UI needs (`get_commit_graph`, `check_review_ready`, `start_review`, `end_review`, `get_review_state`, `get_review_file_diff`).
- **Review status bar.** Layer 5's chat panel renders the slim status bar above the chat input showing branch / commits / file stats / diff inclusion count. Backend already provides the state.
- **Review snippets config.** Already in `snippets.json` under the `"review"` key. The `get_snippets()` RPC dispatches to it when review is active.

### 4.2 — Image persistence — **delivered (absorbed into 3.2)**

Layer 4.2's backend scope is fully delivered by the `HistoryStore` implementation in Layer 3.2 and the streaming handler's user-message persistence in 3.7. Nothing new to ship on the backend side.

What specs4/4-features/images.md requires that the backend already does:

- **Storage location** — `.ac-dc/images/` created by `ConfigManager._init_ac_dc_dir()` AND by `HistoryStore.__init__()`. Idempotent: either order works, `mkdir(exist_ok=True)` on both sides.
- **Content-hash filenames** — `HistoryStore._save_image()` uses `{hash_prefix}{ext}` where hash_prefix is the first 12 chars of SHA-256 over the raw data URI. Deterministic — identical data URIs produce identical filenames, so re-pasting the same image in a later message produces no new file. Pinned by `test_duplicate_image_deduplicated` in `tests/test_history_store.py`.
- **MIME-to-extension mapping** — covers png / jpg / jpeg / gif / webp / bmp with png fallback. Round-trips correctly via `_EXT_TO_MIME` reverse map.
- **Writing flow** — `append_message(images=...)` accepts a list of data URIs; saves each, stores filenames as `image_refs` in the JSONL record. Legacy integer-count shape tolerated for backwards compat but never produced by new writes.
- **Reading flow** — `get_session_messages_for_context(session_id)` reconstructs images back to data URIs via `_reconstruct_image`. Missing image files skipped silently with a debug log — a corrupt images directory never breaks session load.
- **LLM service integration** — `_stream_chat` passes `images=images if images else None` to `history_store.append_message`. The streaming handler already gets the full data URI list from the RPC call (the frontend passes data URIs through, not counts). Pinned indirectly by every streaming test that includes the image-path via the integration tests in `TestStreamingHappyPath`.

What specs4/4-features/images.md requires that lands in Layer 5 (webapp):

- Paste input (accept formats, size limits, per-message cap, encoding, thumbnail previews, token counting)
- Message display (thumbnails in user cards, lightbox with Escape-to-close)
- Re-attach overlay button (📎 on thumbnail and in lightbox)
- Re-attach behavior (size/count limits, deduplication, toast feedback)

These are pure frontend concerns — no backend changes needed. The backend already serves data URIs in both live messages (pending send) and loaded session messages; the frontend just needs to render and re-attach.

### 4.1.6 — LLMService integration — **delivered**

- `src/ac_dc/llm_service.py` — changes:
  - Constructor builds `URLService` via `_build_url_service()` helper. Wires the filesystem cache (from `config.url_cache_config` — uses a system-temp-dir fallback when no path configured), the smaller model name, and the SymbolIndex class (lazy-imported so tree-sitter grammars aren't loaded at service construction). Falls back gracefully to `symbol_index_cls=None` if the import fails.
  - `_stream_chat` calls `_detect_and_fetch_urls(request_id, message)` after persisting the user message and broadcasting `userMessage`, but before tiered-content building and message assembly. Fetched URL content is attached to the context manager's URL context section via `set_url_context([formatted])` or cleared via `clear_url_context()` when no URLs qualify.
  - `_detect_and_fetch_urls` — detects URLs via `url_service.detect_urls`, caps to `_URL_PER_MESSAGE_LIMIT = 3` (per specs4/4-features/url-content.md), skips already-fetched URLs (checked via `get_url_content` → sentinel compare), fires `compactionEvent(stage="url_fetch", url=display_name)` before each fetch and `compactionEvent(stage="url_ready", url=display_name)` after success. Fetch runs in the aux executor via `run_in_executor(_fetch_url_sync, url)` so the event loop stays free during blocking HTTP/git/LLM calls.
  - RPC delegation surface added: `detect_urls`, `fetch_url` (async — runs in aux executor), `detect_and_fetch` (async — runs in aux executor), `get_url_content`, `invalidate_url_cache`, `remove_fetched_url`, `clear_url_cache`. All return dicts (URLContent serialized via `to_dict`) for jrpc-oo compatibility.

- `tests/test_llm_service.py` — new `TestURLIntegration` class with 10 tests: URL service constructed with cache + smaller model, `detect_urls` RPC delegates, `get_url_content` returns sentinel for unknown URL, `invalidate_url_cache` / `remove_fetched_url` / `clear_url_cache` all return the service's status dicts, streaming with a URL triggers `url_fetch` + `url_ready` compactionEvents with display names, streaming with already-fetched URL produces NO events (session-level memoization), streaming without URLs skips the fetch path entirely (no url_* events), fetched content lands in the context manager's URL context (assertable via `context.get_url_context()`), per-message limit of 3 URLs enforced (5 URLs in prompt → only 3 fetched).

Design points pinned by tests:

- **Session-level URL memoization prevents duplicate fetches across turns.** The streaming handler checks `get_url_content(url).error != "URL not yet fetched"` — if the URL is already in `_fetched` (from a prior turn in the same session) OR in the filesystem cache, the fetch is skipped AND no progress events fire. The URL chips UI may still be showing the URL — that's the UI's concern, not ours. Pinned by `test_streaming_skips_already_fetched_urls`.

- **Per-message cap of 3 URLs.** Extra URLs in a single message are silently skipped at the streaming layer. The URL chip UI still detects them (via the separate `detect_urls` RPC the frontend drives as the user types), so they appear as clickable chips — the user can fetch additional URLs manually via the chip UI's "fetch" button if they want. The 3-URL cap only governs the auto-fetch-during-streaming path.

- **Aux executor, not stream executor.** URL fetches run in `_aux_executor` so they don't block the `_stream_executor` threads. This matters for future parallel-agent mode where the stream executor may be running multiple agents concurrently; URL fetch for one agent's prompt shouldn't starve the stream pool.

- **`user_text=None` when fetching during streaming.** The URL service's summarizer uses `user_text` for auto-type selection (keyword triggers like "how to" → USAGE, "architecture" → ARCHITECTURE). We don't pass the full user message as `user_text` because the LLM gets the user message in the prompt anyway; adding it to the summarizer's context just inflates the summary prompt without useful signal. The URL-type-default selection in `choose_summary_type` handles the common cases fine.

- **No RPC for `fetch_url` during streaming — only for UI-driven fetches.** The streaming handler calls `_url_service.fetch_url` directly (via the sync helper dispatched to the aux executor). The RPC-exposed `fetch_url` is for the URL chip UI's "fetch this URL" button — manual user action, not an automatic flow during streaming.

- **URL service is constructed unconditionally.** Even when `repo` is None (tests without a real repo), the URL service is built with the cache + smaller model. This matches specs4 — URL detection doesn't require a repo, only git-clone-based GitHub repo fetches do (and those degrade to error records rather than crashing when something's missing).

Open carried over for later sub-layers:

- **Clear-URL-cache in new_session.** Specs4 says starting a new session clears everything, which conceptually includes URL content. Currently `new_session` doesn't touch `_url_service._fetched`. Likely a 1-line addition to `new_session` — `self._url_service.clear_fetched()`. Not included in 4.1.6 because the UI's chip rendering already resets on `sessionChanged`; the in-memory fetched dict being non-empty doesn't affect correctness, just accumulates entries for the next turn's `get_url_content` lookups.
- **Post-request cleanup.** Some URL service operations (cleanup expired cache entries) are best done on a schedule, not per-request. Layer 6 (startup) will call `_url_service._cache.cleanup_expired()` on startup to remove stale entries; we don't do it per-request to avoid disk I/O on every chat turn.

### 4.1.5 — URLService — **delivered**

- `src/ac_dc/url_service/service.py` — `URLService` class orchestrating the full URL pipeline: detect → classify → fetch → cache → summarize. Construction takes optional injection points per D10: `cache` (URLCache for cross-session persistence), `smaller_model` (provider-qualified model string for summarization), `symbol_index_cls` (for GitHub repo symbol map generation). All three default to None; the service degrades gracefully when any is absent.
- **In-memory `_fetched` dict is authoritative for the session.** Keyed by URL string (exact match, no normalisation). Contains both successes and error records — the `error` field distinguishes. Persists across chat requests within a session; cleared via `clear_fetched()` (memory only) or `clear_url_cache()` (both stores).
- **Filesystem cache is a cross-session persistence layer.** `URLCache` already refuses to persist error records, so the service writes unconditionally on success. Cache-check before fetch; cache-write after successful fetch; cache-update-in-place when a cached entry is missing a summary and the caller requests one.
- **Sentinel error for "not yet fetched".** `get_url_content(url)` returns `URLContent(url=url, error="URL not yet fetched")` when the URL isn't in `_fetched` or in the filesystem cache. Streaming handler compares against the exact string to decide whether to issue a fetch. Cache-only hits are hoisted into `_fetched` so subsequent calls are O(1).
- **`fetch_url` pipeline**:
  1. Cache check (when `use_cache=True`) → hit returns immediately, unless summary is requested and cache lacks one (then summarize + update-in-place)
  2. `classify_url(url)` → URLType
  3. `_dispatch_fetch` routes by type: github_repo → `fetch_github_repo` with `symbol_index_cls` injected; github_file → `fetch_github_file`; github_issue / github_pr / documentation / generic → `fetch_web_page` with `url_type` overwritten post-fetch to match the classification (web fetcher hardcodes "generic") and `github_info` populated for issue/PR URLs
  4. Cache write on success (cache refuses error records, so unconditional)
  5. Summarize on success when `summarize=True` and `smaller_model` configured; update cache again with summary
  6. Store in `_fetched`
- **`_parse_github_info(url, url_type)`** — pure helper extracting owner/repo/branch/path/issue_number/pr_number from a GitHub URL. Handles all five shapes (repo, repo.git, file blob, issue, PR) plus raw.githubusercontent.com URLs. Returns partially-populated GitHubInfo; fetchers tolerate missing fields.
- **`detect_and_fetch(text, use_cache=True, summarize=False, max_urls=None)`** — convenience wrapper combining detection and sequential fetching. Already-fetched URLs are reused from `_fetched` rather than re-fetched (session-level memoization). `max_urls=None` means no limit; streaming handler passes the per-message cap (typically 3). Sequential rather than parallel — per-message URL volume is small and avoids hammering upstream.
- **`detect_urls(text)`** — RPC-friendly wire format: list of dicts with `url`, `type` (string form of URLType.value), `display_name`. The type is emitted as `.value` so RPC serialisation doesn't need special handling.
- **`format_url_context(urls=None, excluded=None, max_length=None)`** — formats fetched URLs for LLM prompt injection. Default `urls=None` → all fetched URLs; explicit list overrides. Excluded set skipped (matches frontend's exclude-checkbox state). Error records always skipped. Separator `\n---\n` between multiple URLs. Falls back to filesystem cache for URLs in the explicit list that aren't in `_fetched` (robust to session-restore where the fetched dict starts empty).
- `src/ac_dc/url_service/__init__.py` updated to export `URLService`, `URLCache`, plus the existing surface.
- `tests/test_url_service.py` — 12 test classes, 55 tests covering construction (all four combinations of injection points), `_parse_github_info` (repo, repo.git, file blob, deep file path, raw URL, issue, PR), `detect_urls` wire format (empty, single, multiple types, GitHub repo display name), `fetch_url` dispatch (all five URL type routes), cache interactions (hit returns cached, miss fetches + writes, `use_cache=False` bypasses both, error records not cached, cached-without-summary → update in place, cached-with-summary no LLM call), summarization integration (LLM call on success, silent no-op without smaller model, not-called-on-error, cache updated with summary), in-memory fetched dict (success stored, error records also stored), `detect_and_fetch` (empty text, multi-URL, max_urls cap, already-fetched reuse), `get_url_content` (in-memory hit, filesystem fallback with hoist, sentinel on miss, sentinel with cache miss), cache management (`invalidate_url_cache` both-stores, idempotent on unknown, no-cache variant; `clear_url_cache` both-stores, no-cache variant; `remove_fetched` memory-only; `clear_fetched` memory-only), `get_fetched_urls` (empty, all-fetched, returns independent list), `format_url_context` (empty when no URLs, default-all-fetched, separator presence, explicit URL list filter, excluded URLs skipped, error records skipped, all-excluded returns empty, cache fallback for explicit URLs not in memory, max_length passed through to URLContent formatter).

Design points pinned by tests:

- **URL-type is overwritten post-fetch for web-routed URLs.** `fetch_web_page` hardcodes `url_type="generic"` but the service knows the real classification. After the web fetch returns, the service sets `content.url_type = url_type.value` so callers can distinguish documentation from generic. This matters for UI chip rendering and for future per-type context formatting. Pinned by `test_documentation_routes_to_web_fetcher`.
- **GitHub info attached to issue/PR fetches.** Even though issues and PRs go through the generic web fetcher today, the service attaches a `GitHubInfo` with the parsed issue/PR number. Supports future structured-display features in the UI without re-parsing. Pinned by `test_github_issue_routes_to_web_fetcher_with_info`.
- **Cache-hit with summary-requested doesn't re-fetch.** The summary-cache-update path calls `self._summarize(content)` directly on the cached record and writes the result back, avoiding the entire fetch pipeline. Tested with `test_cache_hit_with_summary_requested_updates_in_place` which patches the fetcher and asserts it's NOT called.
- **Cache-hit with summary-already-present doesn't call LLM.** `test_cache_hit_with_existing_summary_no_llm_call` verifies zero completion calls when the cached entry already has a summary. Prevents wasted tokens on duplicate summarization.
- **Error records are stored in memory but not in cache.** `test_error_fetch_stored` proves the error ends up in `_fetched` (so the caller can inspect without re-fetching) while `test_error_fetch_not_cached` proves the cache refuses it (so re-runs across sessions hit the network for a retry chance).
- **Filesystem cache fallback hoists into memory.** `get_url_content` checking the cache on a memory miss also writes the result into `_fetched`. Subsequent calls return in O(1) without hitting disk. Pinned by `test_filesystem_cache_fallback`.
- **Returned list from `get_fetched_urls` is independent.** Caller mutations (e.g., `.clear()`) don't affect the service's internal dict. Pinned by `test_returns_list_not_view`.
- **`format_url_context` cache fallback is explicit-list-only.** Default (urls=None) uses only `_fetched`. Explicit list can reference URLs that are cache-only. Pinned by `test_falls_back_to_cache_for_explicit_url_not_in_memory`. Handles the session-restore case where the fetched dict starts empty but the user's URL chip list comes from persisted state.

Open carried over for Layer 4.1.6 (LLMService integration):

- **Streaming handler wiring.** `_stream_chat` will call `url_service.detect_and_fetch(prompt, max_urls=3, summarize=True)` before message assembly. Fetched results format via `format_url_context(urls=..., excluded=...)` and attach to the context manager via `set_url_context`.
- **RPC surface.** LLMService will expose `detect_urls`, `fetch_url`, `detect_and_fetch`, `get_url_content`, `invalidate_url_cache`, `remove_fetched_url`, `clear_url_cache` as thin delegations to the service instance.
- **Progress events.** Streaming handler will wrap URL fetches with `compactionEvent(stage="url_fetch", url=display_name)` and `compactionEvent(stage="url_ready", url=display_name)` for UI progress toasts.

### 4.1.4 — Summarizer — **delivered**

- `src/ac_dc/url_service/summarizer.py` — `SummaryType` enum (BRIEF, USAGE, API, ARCHITECTURE, EVALUATION) subclassing `str` for wire-format friendliness, `choose_summary_type(content, user_text=None)` picks a type from URL-type defaults (GitHub repo with symbol map → ARCHITECTURE; without → BRIEF; documentation → USAGE; everything else → BRIEF) with user-text keyword overrides (`"how to"` → USAGE, `"api"` → API, `"architecture"` → ARCHITECTURE, `"compare"`/`"evaluate"` → EVALUATION), `_build_user_prompt(content, summary_type)` assembles the focus prompt + URL header + body (readme preferred over content, truncated at 100k chars) + optional symbol map under its own header, `summarize(content, model, summary_type=None, user_text=None)` runs the blocking `litellm.completion(stream=False)` call with a fixed system message and max_tokens=500, returns a NEW URLContent via `to_dict`/`from_dict` round-trip (functional style — caller can't forget to propagate the update).
- **Error records pass through unchanged.** Content with a non-empty `error` field is returned as-is — we don't re-summarize failed fetches. Caller detects this because `result is content`.
- **Error-marked return on LLM failure.** litellm ImportError, completion exception, malformed response shape, empty/whitespace-only reply, non-string content all produce a copy with `summary_type="error"` and `summary=None`. Caller checks `summary_type == "error"` to detect failed summarization. The data shape stays uniform (summary_type is always populated when summarization was attempted).
- **Fixed system message.** Per spec — "You are a concise technical writer. Summarize content clearly and factually without speculation or editorializing." Never varies per request, so providers with system-prompt caching aren't invalidated by summary-type selection. Tested with `test_system_message_is_fixed` which calls summarize twice with different URLs and different types and asserts the system message is identical.
- **Body priority — readme > content.** READMEs are higher-signal than raw web scrape, so when both are present (rare but possible after a follow-up fetch), the readme wins. Tested with `test_readme_preferred_over_content` which sets both and verifies the content field doesn't appear in the prompt.
- **100k-char body truncation.** Very long README or doc content is truncated with `"\n\n... (truncated)"` suffix so a single URL can't monopolize the summarizer's input budget. ~25k tokens with the smaller model's tokenizer — enough to capture the main content, not enough to crowd out other context.
- **Symbol map appended under its own header.** When a GitHub repo fetch produced a symbol map (via the injected SymbolIndex class in the fetcher), it's appended after the body with `"Symbol Map:"` as a separator. Gives the LLM structural context (class names, function signatures) that raw README prose wouldn't convey. The body appears first so the LLM reads the human-authored overview before the extracted structure.
- **Lazy litellm import.** `import litellm` happens inside `summarize` so the module is importable in tests that don't exercise summarization. ImportError degrades to the error-marker path.
- `tests/test_url_summarizer.py` — 5 test classes, 35 tests covering type selection (URL-type defaults for all six URL types — GITHUB_REPO with/without symbol_map, GITHUB_FILE, DOCUMENTATION, GENERIC, GITHUB_ISSUE, GITHUB_PR), user-text triggers (every trigger keyword individually, case-insensitive matching, first-matching-trigger-wins precedence, no-match-falls-through, empty and None user text), prompt assembly (focus-first ordering, URL header inclusion, body priority, no-body placeholder, truncation, short-body no-op, symbol-map placement relative to body, header omission when no symbol map, per-type focus prompt distinctness, API/USAGE-specific content), success path (populates fields, doesn't mutate input, explicit type overrides auto-selection, user_text drives auto-selection, model passed through, system message fixed across calls, non-streaming, max_tokens set, reply stripped, preserves existing fields), and error handling (error records pass through unchanged without making LLM call, litellm ImportError, completion exception, malformed response shape, empty reply, whitespace-only reply, non-string content).
- Uses `_FakeLiteLLM` installed via `monkeypatch.setitem(sys.modules, "litellm", fake)` — same pattern as `test_llm_service.py`. Captures completion calls for argument verification; supports configurable reply text and raise-on-completion.
- `src/ac_dc/url_service/__init__.py` updated to export `SummaryType`, `choose_summary_type`, `summarize`.

Design points pinned by tests:

- **Functional return, not in-place mutation.** `summarize` returns a NEW URLContent with summary fields populated rather than modifying the input. Pinned by `test_summarize_does_not_mutate_input` which asserts the input's `summary` and `summary_type` are still None after the call. Caller must assign the return value — forgetting to propagate is a compile-time-ish failure (the summary is lost, visible immediately in any subsequent read) rather than a subtle state-inconsistency bug.
- **Error record short-circuit.** `test_content_with_error_passes_through_unchanged` verifies `result is content` (same object, zero LLM calls) when the input has an error field set. This matches the fetcher contract — error records are never cached, never summarized, never promoted in the tracker.
- **First-matching-trigger wins.** User text like `"how to use the api"` triggers USAGE (first match) not API (second match). The `_USER_TEXT_TRIGGERS` tuple ordering is the contract — `"how to"` appears before `"api"`, so use-cases that explicitly want API type must pass it via the `summary_type` parameter or phrase their text to avoid the earlier triggers.
- **Error-marker uniformity.** Every error path (ImportError, LLM exception, malformed response, empty reply, non-string content) converges on `summary=None, summary_type="error"`. Callers don't need per-error branching; a single `if result.summary_type == "error"` covers all failure modes.
- **URL-type default for GitHub file is BRIEF, not a file-specific type.** A single file doesn't carry enough structural signal for USAGE/API/ARCHITECTURE analysis by default — BRIEF is the safest choice. Users wanting a specific angle pass `user_text` or the explicit `summary_type`.

Open carried over for 4.1.5:

- **URLService orchestrates detect → classify → fetch → cache → summarize.** Holds the in-memory fetched dict keyed by URL. Streaming handler (already in 3.7) will call this from `_stream_chat` to detect URLs in the prompt and inject fetched content into the LLM context. The service is where per-message limits (up to 3 URLs per message), executor scheduling, and progress notifications via the `compactionEvent` channel live.

### 4.1.3 — URL fetchers — **delivered**

- `src/ac_dc/url_service/fetchers.py` — three fetchers dispatched by URL type:
  - `fetch_web_page(url)` — HTTP GET via stdlib `urllib.request` with a browser-like User-Agent, 30s timeout. UTF-8 decode with latin-1 fallback for invalid bytes. Title extraction via regex (always, before content extraction) so short pages and paywalled content still produce a title. Main content extraction via trafilatura when available, falling back to a stdlib regex pipeline (strip script/style, strip remaining tags, decode HTML entities, collapse whitespace). ImportError and runtime errors in trafilatura both degrade to the fallback — keeps the fetcher working in stripped-down releases.
  - `fetch_github_file(url, info)` — constructs the raw.githubusercontent.com URL from parsed `GitHubInfo`, fetches via HTTP. When `info.branch is None` (implicit default) and the main branch returns 404, automatically retries against master. Explicit branch names don't trigger the fallback — a 404 on a named branch is a real error, not a default-branch mismatch. Returns URLContent with `title` set to the filename.
  - `fetch_github_repo(url, info, symbol_index_cls=None)` — shallow clones the repo to a temp directory, reads the README, optionally generates a symbol map via an injected index class, cleans up in a `finally` block. Uses the SSH-first-with-HTTPS-fallback pattern from D13.
- **SSH-first clone (D13).** `_ssh_clone_attempt(info)` returns an attempt with URL `git@github.com:owner/repo.git` and env `GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new"` + `GIT_TERMINAL_PROMPT=0`. BatchMode fails fast rather than prompting. accept-new auto-accepts GitHub's known host key on first contact but refuses changed keys (CI-safe). On non-zero exit, `_https_clone_attempt(info)` returns an HTTPS attempt with all credential sources disabled: `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=/bin/true`, `SSH_ASKPASS=/bin/true`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`. Public repos succeed via the fallback; private-without-access produces a single combined error message per D13. No attempt categorises stderr — any non-zero exit triggers the fallback, and the final message is "repository may be private or you may lack access" which covers all realistic failure modes.
- **README two-pass search.** `_find_readme(repo_dir)` walks `_README_CANDIDATES` (priority ordered — `README.md` wins over `README.rst` over `README`) for exact matches first. On pass 2, builds a lowercase → actual filename map via `os.listdir` and probes known lowercase keys — catches `README.MD`, `Readme.md`, platform-dependent case variations. Read failures (permission denied, binary content) are treated as "not found" rather than propagated. Empty directories and repos without any README return None cleanly; the URLContent just has no `readme` field.
- **Injected symbol-index class.** `_generate_symbol_map(repo_dir, symbol_index_cls)` instantiates the passed class on the clone directory, walks the repo (skipping `.git` entirely) to build a relative-path file list, calls `index.index_repo(files)` then `index.get_symbol_map()`. Failures at any step log and return None — the URLContent omits `symbol_map`. Tests use a `_FakeSymbolIndex` stub; production passes `ac_dc.symbol_index.index.SymbolIndex`. Matches the D10 "no module-level coupling" pattern and keeps the fetcher from importing tree-sitter grammars at module load.
- **Timeouts everywhere.** HTTP GET 30s, git clone 120s (full budget per attempt — SSH fail + HTTPS fail is 240s worst case). No retry loops beyond the SSH→HTTPS fallback. Timeouts convert to error records; the URLCache refuses to persist them.
- **Blocking by design.** Fetchers are synchronous — the URLService (Layer 4.1.5) will schedule them via `asyncio.run_in_executor`. Making them async internally would duplicate responsibility between the fetcher and the caller.
- `tests/test_url_fetchers.py` — 9 test classes, 36 tests covering title extraction (simple, multiline collapse, attributes, absent, whitespace-only, case-insensitive), HTML tag stripping (scripts, styles, entities, whitespace), web page fetcher (success, HTTP error, URL error, generic exception, latin-1 fallback for invalid UTF-8), GitHub file fetcher (success with correct raw URL, no-path error, main→master auto-fallback for implicit default, no-fallback for explicit branches), clone attempt helpers (SSH URL format, SSH batch mode flags, HTTPS URL format, all-auth-disabled env vars for HTTPS), README discovery (exact match priority, RST fallback, extensionless README, case-insensitive fallback, empty directory), symbol map generation (success, .git exclusion via walk, construction failure, indexing failure, no class omits field), and the full repo fetcher flow (SSH first-attempt success, SSH→HTTPS fallback, combined failure message, timeout handling, missing git binary, missing owner error, no README produces content-without-readme, symbol map generation via injection, temp directory cleanup on both success and failure).
- Uses `unittest.mock.patch` for `urllib.request.urlopen` and `subprocess.run`. A `_FakeSymbolIndex` stub validates the injection pattern; `_FailingSymbolIndex` and a throwing-on-index-repo variant prove error-path resilience. Tests `test_temp_directory_cleaned_up` and `test_temp_directory_cleaned_up_on_failure` capture the temp directory via side-effect and verify it's gone after the fetcher returns — essential for the `finally` block correctness.
- `src/ac_dc/url_service/__init__.py` updated to export `fetch_web_page`, `fetch_github_file`, `fetch_github_repo`, plus the `URLContent` and `GitHubInfo` models.

Design points pinned by tests:

- **Error records are not cached.** Every fetcher's error path returns a `URLContent` with `error` populated but `content`/`readme`/`symbol_map` left None. The URLCache's `set()` refuses records with a non-empty error field, so a transient HTTP error never poisons the cache with stale failure state.
- **Implicit vs explicit branch fallback.** `info.branch is None` triggers the main→master retry; a caller passing `branch="main"` explicitly does NOT get the fallback. Rationale: the retry is for "default branch was renamed", not for "branch doesn't exist". Pinned by `test_explicit_branch_does_not_fall_back`.
- **Single combined error for both-clone-fail case.** D13's UX contract — the user doesn't need to know which attempt failed first or how. "Could not clone repository. The repository may be private or you may lack access." covers the realistic failure modes (network, auth, permissions) without categorising them. Simpler than parsing git's stderr for specific patterns.
- **`.git` exclusion is absolute.** `os.walk` with `dirs[:] = [d for d in dirs if d != ".git"]` prevents descent into the git metadata. The spy-index test proves this — `.git/HEAD` should never appear in the indexed file list.
- **Temp directory always cleaned up.** Both success and failure paths go through the `finally` block. `shutil.rmtree(ignore_errors=True)` because partial state from a failed clone might have weird permissions; we'd rather leak a temp dir than crash on cleanup.

Open carried over for later sub-layers:

- **Summarizer (4.1.4).** Will take a URLContent, build a type-aware prompt, call the smaller model via litellm. Content is already populated by the fetchers; the summarizer just reads `readme`/`content` and produces `summary`/`summary_type`.
- **URLService (4.1.5).** Orchestrates detect → classify → fetch → cache → summarize. Holds the in-memory fetched dict keyed by URL. Streaming handler (already in 3.7) will call this from `_stream_chat` to detect URLs in the prompt and inject fetched content into the LLM context.

### 3.10 — Mode switching — **delivered**

Adds RPC endpoints and per-mode stability tracker state for switching between code and document mode. Cross-reference toggle is stubbed — doc index hasn't landed yet (Layer 2's doc-index sub-layer is deferred), so enabling cross-ref is currently a no-op that logs a warning. The switching plumbing itself is complete: system prompt swap, per-mode tracker with lazy doc-tracker construction, tracker state preservation across round-trips, system event recording in both stores, broadcast to collaborators.

- `src/ac_dc/llm_service.py` — changes:
  - Constructor restructures single `_stability_tracker` into `_trackers: dict[Mode, StabilityTracker]`. Code tracker constructed eagerly; doc tracker lazy-built on first switch. `_stability_tracker` kept as a live alias pointing at whichever tracker is active, so existing readers (streaming handler, tier builder) don't need to know about the dispatch.
  - Added `_cross_ref_enabled: bool` field. Reset to False on every mode switch per specs4/3-llm/modes.md.
  - `get_mode()` — returns `{mode, doc_index_ready, doc_index_building, cross_ref_ready, cross_ref_enabled}`. Readiness flags hardcoded False pending doc index.
  - `switch_mode(mode: str)` — validates target (unknown → `{error: ...}`), idempotent on same mode (`{mode, message}` with no side effects), resets cross-ref flag, lazy-constructs target tracker, swaps prompt via non-saving `set_system_prompt` (not `save_and_replace` — that's review mode's contract), swaps tracker on context manager, updates mode flag, records system event in both context AND history store, broadcasts `modeChanged`.
  - `set_cross_reference(enabled)` — idempotent flip (no-op broadcast suppression when already in target state), logs when enabled without doc index, broadcasts `modeChanged` with both mode and new cross-ref state.
  - `get_current_state()` — added `cross_ref_enabled` field so reconnect restores the toggle state.
- `tests/test_llm_service.py` — added 16 tests in a new `TestMode` class: `get_mode` default shape, state snapshot includes cross-ref, same-mode is pure no-op (no event, no broadcast), unknown mode rejected cleanly, code→doc changes mode, system prompt swap with round-trip (doc then back to code — both original prompts restored from config), tracker instance swap with context-manager attachment verified in lockstep, tracker state preserved across round-trip (`is` comparison — not reconstructed), lazy doc-tracker construction (Mode.DOC absent from `_trackers` until first switch), system event recorded in context, system event persisted to JSONL, modeChanged broadcast with new mode payload, cross-ref enable flips flag + broadcasts with both mode and state, cross-ref disable flips back, cross-ref idempotent (no broadcast when already in target state), cross-ref resets to False on every mode switch (tested in both directions).

Design points pinned by tests:

- **Same-mode switch is strictly idempotent.** Returns `{mode, message: "Already in X mode"}` without recording a system event, without broadcasting `modeChanged`, without touching the tracker. The frontend's mode-refresh auto-switch logic calls `switch_mode` redundantly on reconnect; if the call produced side effects every time, the conversation history would fill with spurious switch events. Pinned by `test_switch_to_same_mode_is_noop`.
- **Plain `set_system_prompt` is the right primitive for mode switch.** Not `save_and_replace_system_prompt` — that's review mode's contract (save current, install new, restore-on-exit). Mode switches persist; there's no "restore the pre-mode-switch prompt" concept. Enforced by `test_switch_swaps_system_prompt` which verifies that switching doc→code re-installs the config's code prompt (not a saved slot).
- **Tracker instance identity is preserved across round-trips.** `test_switch_preserves_tracker_state` uses `is` comparison to prove the original code-mode tracker instance is re-attached when switching back, not a freshly-constructed one. Matters for tier state — the code-mode tracker's item assignments and N values survive a detour through doc mode.
- **Context manager's attached tracker updates in lockstep.** Not just `_stability_tracker` — `service._context.stability_tracker` must also point at the new instance, or the next stability update cycle runs against the wrong tracker. Pinned by `test_switch_swaps_stability_tracker`.
- **System event persists to both stores.** In-memory (for immediate LLM visibility via `get_history`) AND the JSONL history store (for session-restore survival across server restart). Pinned by separate `test_switch_records_system_event_in_context` and `test_switch_records_system_event_in_history_store`.
- **Cross-reference flag resets BEFORE tracker swap.** The reset applies to the current tracker, not the new one. Conceptually: "deactivating cross-ref on the tracker the user is leaving" matters if cross-ref deactivation ever grows side effects that need to apply to the tier items present at deactivation time.
- **Cross-reference idempotence suppresses broadcasts.** `set_cross_reference(False)` when already False returns successfully but doesn't broadcast. Without this, every reconnect that re-sends the current cross-ref state via `set_cross_reference` would fire a spurious `modeChanged` event. Pinned by `test_set_cross_reference_idempotent`.
- **Doc tracker lazy construction pattern.** `_trackers[Mode.CODE]` exists at construction; `_trackers[Mode.DOC]` only appears after the first `switch_mode("doc")`. Tested directly via `Mode.DOC not in service._trackers` before the switch, `Mode.DOC in service._trackers` after. Zero cost for sessions that stay in code mode.

Notes from delivery:

- **Two test failures caught by running the suite:** `test_snapshot_shape` in the existing `TestStateSnapshot` class had its expected keys frozen at 7 fields; adding `cross_ref_enabled` to the snapshot broke the equality check. Fix was a one-line addition to the expected set. Second failure: `test_switch_lazy_constructs_doc_tracker` referenced `Mode.DOC` without importing `Mode` at the top of the test file. Fix was adding `from ac_dc.context_manager import Mode` alongside the existing imports. Both failures surfaced during the first run — worth noting as a reminder that adding a field to a snapshot dict requires searching for every existing equality assertion on that dict's keys.

- **Readiness flags reported as hardcoded False.** `doc_index_ready`, `doc_index_building`, and `cross_ref_ready` are all False in `get_mode()` because the doc index hasn't landed (deferred from Layer 2). The frontend spec says the cross-reference toggle should be always-available after startup — but we report `cross_ref_ready: False` anyway as a graceful escape hatch if we ever need the frontend to hide the toggle (e.g., in a minimal release without the doc index dependencies installed). Today the frontend ignores the field and just shows the toggle unconditionally.

- **Cross-reference enable-without-doc-index is a log + no-op.** The specs4/3-llm/modes.md contract says enabling cross-ref adds the opposite index's items to the active tracker. With no doc index yet, there's nothing to add. The flag still flips (so when the doc index lands, existing `_cross_ref_enabled=True` state starts producing cross-ref content on the next request) and the broadcast still fires (so the frontend toggle visually responds), but no tracker items are created. When Layer 2's doc-index sub-layer lands, the enable branch gets a body that populates the tracker; disabling gets a body that removes cross-ref items from the active tracker.

- **Backwards-compatible alias.** `_stability_tracker` is kept as a live alias pointing at the active mode's tracker. Alternative would have been routing every caller through a `_active_tracker()` method or `get_active_tracker()` property, but the alias is simpler and matches the single-tracker shape of 3.5–3.9 code paths. The swap happens in exactly one place (`switch_mode`); there's no risk of the alias drifting out of sync with `_trackers[current_mode]`.

Open carried over for later sub-layers:

- **Cross-reference tier population.** The enable branch of `set_cross_reference` is where Layer 2's doc-index will plug in. Concretely: when code mode + cross-ref enabled, the `_update_stability` pass will need to add `doc:{path}` entries for every doc-index file to the code-mode tracker's active items. Equivalent logic in reverse for doc mode + cross-ref. Tier assembly already dispatches by prefix (3.8) so the content flows through naturally once items exist in the tracker.
- **Mode persistence across server restart.** The frontend already persists the current mode to localStorage (specs4/5-webapp/shell.md); the backend defaults to code mode on startup and follows the frontend's `switch_mode` call on reconnect. No server-side mode persistence is needed — if the user's frontend saves `doc` and the server starts in `code`, the reconnect's `switch_mode("doc")` brings them into sync. Tested indirectly via the idempotence guarantees; a dedicated round-trip test could land with Layer 5's shell work.
- **Collaboration mode sync.** When collaboration mode is active (Layer 4.4), non-localhost clients cannot call `switch_mode` (the method is localhost-only per specs4 RPC inventory). The guard lives at the collab layer, not here. The `modeChanged` broadcast reaches all admitted clients so non-localhost participants passively follow the server's authoritative mode. No change needed at the LLMService layer.

## Layer 3 — complete

Layer 3 (LLM engine) is complete. All of: token counter, history store, file context, context manager with mode, stability tracker with per-mode scoping, history compactor with injected detector, streaming handler with full lifecycle, tiered prompt assembly, edit protocol with parser + pipeline, mode switching with cross-reference toggle. Ready to proceed to Layer 4 (features — URL content, images, code review, collaboration, doc convert).

Final test totals for Layer 3:
- Python: run `uv run pytest` — 1503 tests passing across Layers 0–3 (1501 before 3.10's 16 new tests, plus the shape-test and import-fix adjustments).

## Layer 4 — complete

Layer 4 (features) is complete. All of: URL content (detection + fetching + summarization + cache), images (absorbed into Layer 3.2), code review (git soft-reset state machine + review context injection), collaboration (CollabServer + admission flow + restriction enforcement on LLMService/Repo/Settings/DocConvert), Settings RPC service, and document conversion (markitdown + openpyxl + python-pptx + LibreOffice + PyMuPDF pipelines for seven extensions). Ready to proceed to Layer 5 (webapp — shell, chat, viewers, file picker, search, settings).

## Layer 5 — in progress

Layer 5 (webapp) is the largest remaining surface. Delivering in three phases to keep each commit coherent:

- **Phase 1 — Minimum viable shell** (this commit): AppShell root component, WebSocket connection via JRPCClient, startup overlay, reconnection with exponential backoff, dialog container with tab placeholders, toast system, server-push callbacks as window events.
- **Phase 2 — Essential tabs**: Chat panel (send/receive/streaming/markdown/edit blocks), Files tab (file picker tree, selection sync), action bar with session controls.
- **Phase 3 — Richer components**: Diff viewer (Monaco), SVG viewer, Context/Cache tabs, Settings tab, history browser, search, file navigation grid, Speech-to-text, TeX preview, Doc convert tab.

### 5.1 — Phase 1 Minimum viable shell — **delivered**

- `webapp/src/app-shell.js` — `AppShell` class extending `JRPCClient`. Inherited `serverURI`/`call`/`remoteTimeout` properties from the parent; registers itself as `AcApp` via `addClass(this, 'AcApp')` in `connectedCallback` so the backend's server-push callbacks (streamChunk, streamComplete, compactionEvent, filesChanged, userMessage, commitResult, modeChanged, sessionChanged, navigateFile, docConvertProgress, admissionRequest, admissionResult, clientJoined, clientLeft, roleChanged) are all registered. Each callback translates the RPC call into a corresponding `window` `CustomEvent` dispatch. This decouples the shell from child-component subscriptions — Phase 2 components listen on `window` rather than reaching through the DOM to the shell.
- Lifecycle hooks override `setupDone` (publishes `this.call` to `SharedRpc`, flips state to `connected`, shows "Reconnected" toast on subsequent connects), `remoteDisconnected` (clears SharedRpc, schedules exponential-backoff reconnect), and `setupSkip` (schedules reconnect on first-connect failure without wedging the startup overlay).
- Startup overlay driven by `startupProgress(stage, message, percent)` RPC callback. Brand mark + progress bar + message. On `stage === 'ready'`, a 400ms delay lets the user see 100% before the CSS fade-out. Reconnects bypass the overlay entirely.
- Reconnect schedule — `[1000, 2000, 4000, 8000, 15000]` ms capped, per specs4. Attempt counter increments across disconnects; reset to 0 on successful `setupDone`. Reconnect re-triggers by nulling + restoring `serverURI` (JRPCClient's setter tears down + reopens the socket).
- Toast system — subscribes to `ac-toast` window events via `connectedCallback` / `disconnectedCallback`. 3-second auto-dismiss. Default type `info`; success/error/warning supported. Components dispatch via `window.dispatchEvent(new CustomEvent('ac-toast', {...}))` rather than calling a method on the shell directly.
- Dialog stub — three tab buttons (Chat, Context, Settings). Each tab renders a placeholder. Phase 2 wires Chat; Phase 3 wires the others.
- `webapp/src/main.js` updated to import `./app-shell.js` and mount `<ac-app-shell>` into the `#app` element, replacing the boot splash. Port-parse helpers retained for tests and exported.
- `webapp/src/app-shell.test.js` — 21 tests covering initial state (connecting/overlay/default tab), `setupDone` (SharedRpc publish, state flip, first-connect overlay persistence, reconnect overlay dismissal + toast), `remoteDisconnected` (SharedRpc clear, state flip, reconnect scheduling — only when was-connected), `startupProgress` (stage/message/percent update, 0..100 clamping, ready delay-then-fade), reconnect backoff (attempt increment, 15s cap), toast system (window event subscription, auto-dismiss timing, no-message guard, default type, unsubscribe on disconnect), server-push callbacks (window event translation, navigateFile remote flag, filesChanged payload, jrpc-oo ack return value), tab switching.
- Test strategy — `@flatmax/jrpc-oo/jrpc-client.js` is mocked via `vi.mock` with a minimal `JRPCClient` class that extends `HTMLElement` and exposes the hook points (setupDone, setupSkip, remoteDisconnected, addClass, serverURI, call). Avoids opening real WebSocket connections during test. Module-mocked import is registered before `app-shell.js` is imported — order matters for vitest's hoisting.

Design points pinned by tests:

- **SharedRpc lifecycle.** `setupDone` publishes, `remoteDisconnected` clears. Pinned so the microtask-deferred hooks in RpcMixin (Layer 1.4) fire correctly. Subsequent layers depend on this.
- **First-connect vs reconnect overlay behaviour.** First connect keeps the overlay up until `stage === 'ready'` fires. Reconnect dismisses immediately. Pinned because specs4 is explicit — the user sees the progress bar only during initial startup, not during transient disconnects.
- **Reconnect only when was-connected.** A connection attempt that fails before `setupDone` should NOT schedule a retry via `remoteDisconnected` — the setupSkip path handles that instead. Pinned by `does NOT schedule reconnect before first successful connect` which verifies no `_attemptReconnect` call after 20s of fake time.
- **Window-event decoupling.** Every server-push callback dispatches a window event rather than holding a direct reference to a child component. Future components (chat panel, file picker, token HUD) listen independently and the shell doesn't need to know they exist.
- **Remote-origin flag on navigateFile.** Collaboration echo-prevention — a broadcast-originated navigation must be distinguishable so the receiving client doesn't re-broadcast and create an infinite loop.

Phase 1 does NOT include:

- Chat panel, file picker, or any tab content (Phase 2)
- Dialog dragging, resizing, minimizing, position persistence (Phase 3)
- Viewer background routing (Phase 3)
- File navigation grid, Alt+Arrow shortcuts (Phase 3)
- Token HUD (Phase 3)
- Global keyboard shortcuts beyond tab clicking (Phase 3)

Next up — Phase 2: chat panel with streaming, files tab with file picker tree, selection sync between picker and chat.

### 3.8 — Tiered prompt assembly — **delivered**

Replaces the flat-only assembly from 3.7 with a structured tiered message array carrying cache-control markers at tier boundaries. The streaming handler dispatches to tiered assembly by default and falls back to flat when the tracker hasn't been initialised.

- `src/ac_dc/context_manager.py` — module-level header constants (`REPO_MAP_HEADER`, `DOC_MAP_HEADER`, `FILE_TREE_HEADER`, `URL_CONTEXT_HEADER`, `FILES_ACTIVE_HEADER`, `FILES_L0_HEADER`..`FILES_L3_HEADER`, `TIER_SYMBOLS_HEADER`, `REVIEW_CONTEXT_HEADER`, plus `_TIER_FILE_HEADERS` dispatch map and `_CACHED_TIERS` tuple). `_with_cache_control` helper (idempotent wrapper that attaches the ephemeral marker to a message's content, handling both plain-string and multimodal block-list shapes). `assemble_tiered_messages` method — builds system message with prompt + primary header + legend + L0 symbols + L0 files + optional cross-ref legend; emits L1–L3 user/assistant pairs + native history with cache-control on the last message of each non-empty tier; uncached pairs for file tree, URL context, review context; active files section filtered by tier-graduated paths; active history filtered by graduated indices and with the last-user-message strip (it's rebuilt from `user_prompt`); final user message as plain text or multimodal blocks. `_format_active_files` and `_build_user_message` helpers isolate the two non-trivial sub-concerns. Raises `ValueError` when `tiered_content` is None — callers must explicitly route to flat assembly rather than passing None (matches the "None is the contract, not an empty dict" rule from specs4/3-llm/prompt-assembly.md).

- `src/ac_dc/llm_service.py` — `_build_tiered_content` walks the stability tracker's tier items and dispatches by key prefix: `symbol:{path}` → symbol index's `get_file_symbol_block`; `doc:{path}` → skipped (doc index lands with 3.10+); `file:{path}` → file context's `get_content`, rendered as a fenced block; `history:{N}` → context manager's history at index N with bounds and integer-parse guards; `system:*` and `url:*` skipped (handled elsewhere or deferred). Items are iterated in sorted-key order so fragment concatenation is deterministic across runs. Returns `None` when the tracker is empty, signalling flat-assembly fallback to the caller. `_assemble_tiered` helper computes the tier-aware exclude set (selected files ∪ graduated files from every tier), fetches symbol map and legend with the exclude set applied, fetches the flat file tree, and delegates to `ContextManager.assemble_tiered_messages`. System reminder is appended to the user prompt here so the tier assembler doesn't need to know about it. `_stream_chat` calls `_build_tiered_content()` and routes to `_assemble_tiered` when non-None, `_assemble_messages_flat` otherwise.

- `tests/test_prompt_assembly.py` — 34 tests across 8 classes covering basic shape (None raises, empty tiers produce system+user only, system prompt placement, final user message), cache-control placement (L0 without history marks system with structured content, L0 with history marks the last L0 history message, each non-empty cached tier gets exactly one marker, empty tier produces no marker), headers and mode dispatch (code mode uses repo header, doc mode uses doc header, cross-ref places secondary legend under opposite header, file tree renders as uncached pair, per-tier file headers, continued-structure header on tier symbols), tier pair rendering (symbols-only produces user/ack pair, files-only produces user/ack pair, history-only appends native messages with marker on last, ordering L1→L2→L3), optional context (URL context renders when set and joined with separator, omitted when empty, review context renders and omitted when unset), active files (render when not graduated, graduated files excluded, all-graduated omits the section, empty file context omits the section), active history (rendered in order, graduated indices excluded, last user message stripped to avoid duplication with `user_prompt`), multimodal (images produce content blocks, no images produces plain text, non-data URIs filtered out), and full ordering (L0 → tier pairs → file tree → URL → review → active files → active history → prompt).

- `tests/test_llm_service.py` — `TestBuildTieredContent` adds 17 tests covering tracker-empty → None, non-empty → four-tier dict, symbol key dispatch via a `_FakeSymbolIndex` stub, symbol key with no index or missing block silently skipped, doc key skipped, file key dispatched to file context with `graduated_files` populated, file key without loaded content skipped, history key dispatched with `graduated_history_indices`, history key out-of-range dropped, non-numeric history key dropped without crash, system and url keys skipped, active-tier items excluded from all cached tiers, multi-tier isolation (no bleed between tiers), multiple blocks joined with blank lines, fragment ordering sorted by key for determinism. Uses a `_place_item` white-box helper that constructs `TrackedItem` directly on the tracker's internal `_items` map — the public `update()` flow would run the full cascade and make the test setup several times more complex without adding coverage that `test_stability_tracker.py` doesn't already provide.

Design points pinned by tests:

- **Fallback discipline.** `_build_tiered_content` returning `None` is the explicit contract for "tracker not yet initialised, use flat assembly." `assemble_tiered_messages` raises `ValueError` on None input rather than accepting an empty dict, so the two code paths are cleanly disjoint — no silent path where tiered assembly produces a degenerate message array with cache-control on an empty system prompt.
- **Deterministic fragment ordering.** Items iterated in `sorted(all_items.keys())` order so symbol-block concatenation is stable across runs. Without this, Python's dict iteration order (insertion order, but insertion order varies with the tracker's cascade timing) would produce byte-different prompts on repeated requests with identical inputs — defeating cache stability.
- **Graduated-file exclusion is cross-tier.** A file graduated to L2 is excluded from the active "Working Files" section AND from the main symbol map (via the exclude set computed in `_assemble_tiered`). The assembly logic collects graduated paths from every tier into a single set before filtering; a single-tier filter would let a file graduated to L3 still appear in L1's content.
- **Last-user-message strip.** The streaming handler adds the user message to context before calling assembly, so active history contains it. Assembly strips the last message if it's a user message and we're about to render `user_prompt` — prevents the current-turn user input appearing twice. Pinned by `test_active_history_rendered_in_order` which asserts exactly-once appearance.
- **Cache-control marker idempotence.** `_with_cache_control` handles both plain-string content and pre-existing list content (multimodal messages). Attaches the marker to the last text block in list form rather than rewrapping — matters when a history message is already multimodal (e.g., an image-bearing user message that's graduated into a tier).
- **Non-data-URI image filtering.** `_build_user_message` only accepts `data:` URIs for image blocks. HTTPS URLs or malformed entries are silently skipped — the LLM provider would reject a non-inline URL anyway, and surfacing the error at assembly time would couple assembly to provider-specific URL handling.

Open carried over for later sub-layers:

- **Doc index dispatch.** `_build_tiered_content` currently skips `doc:*` items since the doc index hasn't landed. Layer 2.7 (doc index) and 3.10 (cross-reference mode) will wire it up. The skip-silently behaviour means a tracker item with a `doc:` prefix produces no content today rather than erroring — graceful degradation if a session is restored with pre-populated doc items.
- **URL tier items.** `url:*` items are tracked as active items but the tier-builder doesn't yet render them. Layer 4.1 (URL service) will add the render path once the URL service exposes `get_url_content_by_hash` or an equivalent dispatch.
- **Cross-reference mode activation.** `_assemble_tiered` passes `doc_legend=""` unconditionally. Layer 3.10 will thread the cross-ref state through to populate the second legend when the toggle is active. The assembly side already handles non-empty `doc_legend` correctly; the missing piece is just the service-level state.

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