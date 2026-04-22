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

- **Settings RPC service** — its restriction check (`_check_localhost_only`) belongs to Layer 4's collab module. Skipping the service class in Layer 1 rather than stubbing it; it lands with its siblings in Layer 3/4.
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

### 3.7 — Streaming handler — **planned**

- `src/ac_dc/llm_service.py` — the orchestration layer. `LLMService` class wires ContextManager + FileContext + HistoryStore + StabilityTracker + HistoryCompactor + SymbolIndex + Repo into a single entry point. Methods: `chat_streaming`, `cancel_streaming`, `get_current_state`, `set_selected_files`, `commit_all`, `reset_to_head`, `get_context_breakdown`, session management, etc.
- Topic detector construction — closure over `config.get_compaction_prompt()` + `config.smaller_model` + litellm. Injected into HistoryCompactor at construction.
- Event loop reference captured at RPC entry via `EventLoopHandle.capture()` (Layer 1.4). Worker thread uses the handle to schedule chunk callbacks.
- Request ID generation + single-user-initiated-stream guard + keyed dispatch per D10.

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