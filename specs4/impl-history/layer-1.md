# Layer 1 — foundation

Logging, configuration, repository, RPC transport (Python + webapp).

Historical delivery record. Moved from `IMPLEMENTATION_NOTES.md` during the docs refactor.

---

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
