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

### 2.6 — Compact formatter — **planned**

`src/ac_dc/base_formatter.py` — `BaseFormatter` with path-aliasing and reference-count integration.

`src/ac_dc/symbol_index/compact_format.py` — `CompactFormatter(BaseFormatter)` for the context and LSP variants of the symbol map. The LSP variant adds 1-indexed line numbers to each symbol; the context variant omits them to save tokens.

Headers, abbreviations, path aliases, ditto marks, test-file collapsing all per specs4/2-indexing/symbol-index.md#compact-format--symbol-map.

### 2.7 — Orchestrator — **planned**

`src/ac_dc/symbol_index/index.py` — `SymbolIndex` wires parser, extractors, cache, resolver, reference index, and formatter into a single entry point. Methods: `index_file`, `index_repo`, `get_symbol_map`, `get_file_symbol_block`, `get_legend`, `get_signature_hash`, LSP queries.

Main coordination responsibilities:

- Per-file pipeline — check cache, parse, extract, post-process, resolve imports, store
- Multi-file pipeline — remove stale entries, resolve cross-file call targets, build reference index
- Two formatter variants — context (no line numbers, default) and LSP (with line numbers)
- File walker — scan repo for supported extensions, skip hidden/build/`.ac-dc/` directories

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