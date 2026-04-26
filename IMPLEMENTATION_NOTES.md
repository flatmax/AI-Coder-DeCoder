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

### D15 — vitest fake timers leave jsdom's requestAnimationFrame broken

After a test suite uses `vi.useFakeTimers()` and restores via `vi.useRealTimers()`, subsequent tests that rely on `requestAnimationFrame` (directly, or via a `settle()` helper) hang indefinitely. The rAF callback never fires because vitest's timer shim leaves jsdom's rAF implementation in a broken state that `useRealTimers()` doesn't fully restore.

**Symptom:** An individual test passes in isolation (via `-t` grep), but the full file hangs at the first rAF-using test that runs after a fake-timer test. The hang is always at 5000ms timeout in `new Promise((r) => requestAnimationFrame(r))`.

**Workaround:** `settle()` helpers in webapp tests use `setTimeout(0)` instead of `requestAnimationFrame`. Two `setTimeout(0)` awaits plus bracketing `updateComplete` awaits drain Lit updates and microtasks reliably across the fake-timer / real-timer boundary.

```js
async function settle(panel) {
  await panel.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await panel.updateComplete;
}
```

**When it matters:** any test file mixing fake-timer describe blocks (debounce tests) with other tests using a `settle()` helper. The file-search test file (`webapp/src/chat-panel-file-search.test.js`) is the canonical example — 26 tests hang at the boundary between the stale-guard block (fake timers) and the overlay-rendering block (real timers) when `settle()` uses rAF. Swapping to `setTimeout(0)` fixed all 26 without changing test semantics.

**Not worth fixing upstream:** vitest + jsdom + fake timers is a complex interaction; the setTimeout shim is a one-line workaround that keeps the tests fast and stable.

### D16 — Both server and webapp ports must be probed independently

`rpc.py`'s `find_available_port` already handled the WebSocket port. The webapp port was passed through verbatim to either Vite or the built-in static server. On the second concurrent `ac-dc` launch, the webapp bind would fail silently — either inside a daemon thread (static server `OSError` swallowed) or with a Vite crash-loop — but `webbrowser.open()` still fired, sending the user to the first instance's webapp. The browser tab would show the second instance's repo title while executing the first instance's JS bundle, producing the confusing "AC-DC4 title bar, AC-DC code" failure mode.

**Fix:** probe both ports in `run()` using the same `find_available_port` helper already used for the server port. The CLI flags become *starting* ports rather than required ones.

```python
try:
    server_port = find_available_port(start=server_port)
except RuntimeError as exc:
    logger.error("Could not find server port: %s", exc)
    return
try:
    webapp_port = find_available_port(start=webapp_port)
except RuntimeError as exc:
    logger.error("Could not find webapp port: %s", exc)
    return
```

Probe-host: loopback is a strict superset check — if `0.0.0.0:N` is taken, `127.0.0.1:N` is also unavailable. So the default loopback probe in `find_available_port` is correct in both single-user and `--collab` modes.

**Diagnostic that found this:** a user running two concurrent `ac-dc` instances on the same machine saw edits applied to disk on the second instance but the browser never reflected them. `grep -c "console.log"` confirmed the logs were in the file; `fetch('/src/chat-panel.js', {cache: 'no-store'})` returned 790 bytes (a 404 HTML stub) because the request was being served by the *first* instance's Vite, rooted at a different project directory with a different source layout. `ps aux | grep vite` showed two Vite processes bound to the same port — the race loser had failed to bind but hadn't crashed the backend.

**Lesson:** silent cross-wiring is worse than a loud error. Any subprocess or thread that binds a port must either go through the probe or check the bind result and surface the failure. Swallowing `OSError` inside a daemon thread is load-bearing for robustness during shutdown (broken-pipe errors) but masks genuine bind failures during startup. Future contributors adding new network listeners should follow the same probe-then-log pattern.

**Spec reference:** specs4/6-deployment/startup.md § Port Selection documents the invariant.

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

Layer 5 (webapp) is the largest remaining surface. Delivering in sub-phases to keep each commit coherent:

- **Phase 1 — Minimum viable shell** (delivered): AppShell root component, WebSocket connection via JRPCClient, startup overlay, reconnection with exponential backoff, dialog container with tab placeholders, toast system, server-push callbacks as window events.
- **Phase 2 — Essential tabs** (delivered): Chat panel (send/receive/streaming/markdown/edit blocks/images/file mentions/retry prompts/compaction events/message action buttons), Files tab (file picker tree, selection sync), action bar with session controls.
- **Phase 2e — Search and refinements** (delivered): message search, file search with test coverage, speech-to-text, history browser refinements (per-message action buttons, image thumbnails, context menu).
- **Phase 3 — Richer components** (delivered): Diff viewer (Monaco) with markdown preview + TeX preview + LSP + markdown link provider, SVG viewer with pan/zoom + SvgEditor (selection, drag, resize, vertex edit, path edit, inline text edit, multi-selection, marquee, undo, copy/paste) + presentation mode + context menu + copy-as-PNG + SVG↔text toggle + embedded image resolution, Context/Cache tabs, Settings tab, file navigation grid, Token HUD.

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

### 5.2 — Phase 2a File picker — **delivered**

Standalone file picker component. No RPC yet, no git status badges, no context menu, no keyboard navigation — those ride in later sub-phases when the orchestrator is available to feed them data.

- `webapp/src/file-picker.js` — `FilePicker` component plus four exported pure helpers:
  - `fuzzyMatch(path, query)` — subsequence matching, case-insensitive, empty-query matches everything. The spec-documented examples (`edt`/`edit_parser.py`, `sii`/`symbol_index/index.py`) work directly.
  - `sortChildren(children)` — dirs before files, alphabetical within each group. Returns new array, doesn't mutate.
  - `filterTree(tree, query)` — prunes to nodes whose paths (or descendant paths for dirs) match the query. Empty query returns the input verbatim.
  - `computeFilterExpansions(tree, query)` — set of directory paths that must be expanded for every matching file to be reachable. Merged with user-expanded state at render time so filter-induced expansions never collapse directories the user deliberately opened.
- Component state — `tree` (default empty root so mount-before-load renders cleanly), `selectedFiles` (a Set, owned by the parent — picker dispatches `selection-changed` events and never mutates its own prop), `filterQuery` (internal state), `_expanded` (internal Set of directory paths).
- Rendering — two-row types (`.row.is-dir` / `.row.is-file`). Click on a dir row toggles expansion. Click on a file name dispatches `file-clicked` with `{path}`. Checkbox clicks use `event.stopPropagation()` so they don't also fire the row handler.
- Directory checkbox tri-state — checked when all descendants selected, indeterminate when some, unchecked when none. Clicking toggles the whole subtree. Empty directories' checkbox is a no-op (no descendants to toggle).
- Event contract — both `selection-changed` and `file-clicked` are dispatched with `bubbles: true, composed: true` so they cross the shadow DOM boundary to the files-tab orchestrator.
- Public methods — `setTree(tree)` for imperative updates from an RPC callback, `setFilter(query)` for the @-filter bridge from the chat input (Phase 2c), `expandAll()` for operations that should reveal everything (file-search results, Phase 2e).
- `webapp/src/file-picker.test.js` — 41 tests across 9 describe blocks. Pure helpers tested directly (15 tests covering subsequence matching, case-insensitivity, empty-query behaviour, no-mutation guarantees). Component tested via mount-and-interact: initial render, expand/collapse, file selection with Set-passed-by-parent, directory tri-state checkbox, filter typing with auto-expansion, filter clearing restoring user's expanded state, event bubbling across shadow boundaries. All tests pass.

Deferred to later Phase 2 sub-phases:

- Git status badges (M/S/U/D) — needs status arrays from `Repo.get_file_tree()` plumbed through the orchestrator (Phase 2c)
- Sort modes (mtime / size) — defer until the data shape is exercised end-to-end
- Keyboard navigation (arrow keys, space/enter) — Phase 2c when the orchestrator is present
- Context menu (stage, unstage, rename, delete, etc.) — Phase 2d; each menu item routes to an RPC call
- Three-state checkbox with exclusion set — Phase 2d, needs `set_excluded_index_files` RPC
- Middle-click path insertion — needs chat panel (Phase 2d)
- Branch badge at root — needs `Repo.get_current_branch()` RPC call (Phase 2c)
- Active-file highlight — needs `active-file-changed` events from the viewer (Phase 2c)
- File search integration (swap to pruned tree) — Phase 2e when search is wired up

Phase 2a does NOT yet wire the picker into `main.js` or the shell. The component self-registers via `customElements.define('ac-file-picker', ...)` but nothing imports it yet. Phase 2c imports it from the `files-tab` component.

Next up — Phase 2b: chat panel (basic) — message rendering, input area, streaming display, markdown. No edit blocks or file mentions yet; those ride in Phase 2d.

### 5.3 — Phase 2b Chat panel (basic) — **delivered**

Standalone chat panel component. Message list, input area, streaming display, basic markdown rendering, Send/Stop button, RPC integration via RpcMixin. Listens for server-push events (stream-chunk, stream-complete, user-message, session-changed) dispatched on `window` by the AppShell.

- `webapp/src/markdown.js` — thin wrapper around the `marked` library. Shared Marked instance configured with `breaks: true` (single newlines → `<br>`), `gfm: true` (tables, task lists), `silent: true` (degrade on bad input rather than throw). Exports `renderMarkdown(text)` (returns HTML string) and `escapeHtml(text)` (used for user messages which are rendered verbatim, not markdown-rendered). `try/catch` fallback in `renderMarkdown` produces escaped plain text if marked throws despite `silent: true` — defensive, shouldn't fire in practice.
- `webapp/src/chat-panel.js` — `ChatPanel(RpcMixin(LitElement))`. Components:
  - Messages list rendered as `.message-card` elements per-message, distinguished by role (`role-user`, `role-assistant`, `role-system`). User content rendered escaped verbatim; assistant + system-event content rendered as markdown.
  - Streaming message card with accent-coloured border and blinking cursor appears below the settled messages when `_streaming === true`.
  - Input area with auto-resizing textarea (max 12rem), Send button that becomes Stop during streaming, disconnected note when RPC isn't ready.
  - Auto-scroll on state updates — passive scroll listener disengages at > 100px from bottom, re-engages at < 40px. Double-rAF wait pattern before measuring scrollHeight.
- **Architectural contracts preserved (D10):**
  - **Streaming state keyed by request ID.** `_streams` is a `Map<requestId, {...}>`. Single-agent operation has at most one entry. Parallel-agent mode will produce N keyed states under a parent ID. The map shape is load-bearing; don't flatten to a singleton.
  - **Chunks carry full accumulated content, not deltas.** Chunk handler replaces `_streamingContent`, doesn't append. Test `uses full content, not delta accumulation` pins this by firing chunks out of order and asserting the last-seen content wins.
  - **rAF coalescing.** `_pendingChunks` Map holds the latest-seen content per request ID. The rAF callback drains and applies to `_streamingContent`. Rapid-fire chunks between frames collapse into one Lit re-render. Test `applies the latest content on each animation frame` pins this.
- **Request ID generation.** `generateRequestId()` exports for tests and future callers. Format: `{epoch_ms}-{6-char-alnum}` matching specs3.
- **User-message echo handling.** When we're the sender (`_currentRequestId` is set), the server's userMessage broadcast is ignored — we already added the message optimistically in `_send`. When we're a passive observer (no in-flight request), we add the broadcast message to our list so the conversation stays in sync with the active client's activity. Phase 2d will expand this for passive stream adoption.
- **Session-changed event.** Replaces the message list wholesale. Resets streaming state. Normalises incoming messages (strips backend metadata like `files`, `edit_results`, which Phase 2d will render).
- **Cancellation.** Stop button calls `LLMService.cancel_streaming(requestId)`. The server's completion event is what actually cleans up local state (cancelled completion arrives with `result.cancelled = true`). Best-effort — if the cancel RPC fails (server already finished), local cleanup runs anyway so the UI doesn't wedge.
- **Error handling.** `chat_streaming` rejection produces an assistant error message with the error text. `stream-complete` carrying `result.error` produces an error message. Both paths converge on the same error-rendered shape.
- `webapp/src/markdown.test.js` — 17 tests: empty input, paragraph wrapping, code fences (fenced + inline), language class preservation, headings, bold/italic, `breaks: true` behaviour, GFM tables + task lists, HTML escaping in prose, malformed input resilience, escapeHtml direct coverage (five-char replacement, order-correctness for `&<>`, plain text pass-through, numeric stringification).
- `webapp/src/chat-panel.test.js` — 31 tests across 10 describe blocks:
  - `generateRequestId` — format + uniqueness
  - Initial state — empty state, disconnected behaviour, RPC-connected state, send-button disabled when empty, enables on typing
  - Message rendering — user vs assistant labels, user content escaped (not markdown-rendered), assistant content markdown-rendered, system-event distinct styling, code fences in assistant messages
  - Send flow — optimistic user message add, RPC call with request ID, input cleared, streaming state flip, empty-input guard, already-streaming guard, RPC error → error message
  - Streaming events — chunks render in assistant slot, other-request-id chunks ignored, stream-complete moves content to messages, falls back to last streaming content when `response` absent (cancelled streams), error in completion produces error message
  - Chunk coalescing — latest-content wins per frame, full-content semantics (not delta accumulation)
  - Cancel — calls cancel_streaming with active ID, recovers locally when cancel fails
  - user-message event — ignored when we're sender, added when passive observer
  - session-changed event — replaces list, clears for empty sessions, resets streaming state, preserves system_event flag
  - Input handling — Enter sends, Shift+Enter doesn't, IME composition Enter doesn't
  - Cleanup — event listeners removed on disconnect

Marked added as a dependency — `"marked": "^14.1.0"`. No syntax highlighting library yet; code blocks render as plain `<pre><code>` with a `language-{lang}` class so Phase 2d can wire highlight.js without changing the chat panel's output shape.

Not wired into `main.js` yet. The component self-registers via `customElements.define('ac-chat-panel', ...)` but no caller imports it. Phase 2c imports it from the `files-tab` component.

Deferred to later sub-phases — explicit boundaries:

- Phase 2c: @-filter bridge to file picker, middle-click path insertion.
- Phase 2d: edit block rendering with diff highlighting, file mentions in rendered assistant output, images (paste/display/re-attach), session controls (new session, history browser), snippet drawer, input history (up-arrow recall), message action buttons, retry prompts, compaction event routing.
- Phase 2e: message search overlay, file search overlay, history browser modal, speech-to-text.

Next up — Phase 2c: files tab orchestration — wires picker and chat panel together via the files-tab component. Selection sync, file tree RPC loading, file mention routing, git status badges.

### 5.5 — Phase 2e.3 Speech-to-text — **delivered**

Dedicated component wrapping the browser's Web Speech API with a microphone toggle button in the chat panel's action bar. Each final utterance fires a `transcript` event that the chat panel catches and inserts at the textarea's cursor position with auto-space separators. Errors surface as toasts via a `recognition-error` event.

- `webapp/src/speech-to-text.js` — `SpeechToText` LitElement. Single reactive state property `_state` (`'inactive'` / `'listening'` / `'speaking'`) drives the LED styling. `_active` field tracks the user's toggle state separately from recognition state — a recognition session can be mid-cycle (listening, speaking, ended) while the toggle remains on.
- **Continuous mode implemented via auto-restart loop, not the native flag.** Native `continuous=true` has inconsistent silence handling across browsers; the loop (`onend` → schedule restart in 150ms → new instance) gives predictable utterance boundaries. Fresh `SpeechRecognition` instance per cycle — some browsers misbehave when restarting a stopped instance.
- **Browser support detection hides the host.** `_getRecognitionCtor()` probes `window.SpeechRecognition` then `window.webkitSpeechRecognition`. Returns null for Firefox, older browsers, jsdom. When null, `connectedCallback` sets `this.hidden = true` so the chat panel doesn't render an action-bar button that can never work. Also exposed as a static `SpeechToText.isSupported` getter for programmatic callers.
- **Error classification.** `onerror` with `code === 'no-speech'` or `'aborted'` is silently ignored — these fire at utterance boundaries under `continuous=false` and during restart races. Any other error code stops the session, reverts `_state` to inactive, and dispatches `recognition-error` with the code. Missing error field defaults to `'unknown'` so the event shape is stable.
- **Synchronous start() failure handled.** Some browsers throw from `start()` when permission is denied inline rather than firing an async error. Try/catch around the call catches these; behaves identically to an async error.
- **Clean disconnect releases the microphone.** `_stopRecognition` clears all event handlers before calling `stop()` — critical because otherwise the cycle's `onend` fires during teardown and schedules a restart on a component that's about to be garbage-collected. Cleared handlers also prevent the auto-restart loop from resurrecting a session the user just toggled off.
- **Chat panel integration** — `_onTranscript` inserts transcribed text at the textarea cursor position. Auto-space separators: prepend a space when the char before cursor is non-whitespace, append a space when the char after is non-whitespace. Pattern covers "dictating mid-sentence" and "appending to existing text". Cursor moves to the end of the inserted text so successive utterances continue naturally. `_onRecognitionError` translates error codes to human-readable messages (`not-allowed` → "Microphone access denied", `audio-capture` → "No microphone detected", etc.) and surfaces via toast.
- `webapp/src/speech-to-text.test.js` — 35 tests across 7 describe blocks. Fake `SpeechRecognition` installed via `window.SpeechRecognition` assignment (jsdom has no built-in). Tests drive the lifecycle deterministically: browser support detection (null constructor hides host, webkit-only path, `isSupported` property), toggle (starts inactive, click creates instance with correct config, second click stops, programmatic `toggle()` matches click, active class + aria-pressed reflect state), LED transitions (inactive → listening on audiostart → speaking on speechstart → listening on speechend → inactive on stop), transcript events (final results dispatch, bubble across shadow DOM, interim results skipped, empty transcripts skipped, malformed results defensively handled, multiple final results fire multiple events), auto-restart (onend restarts session after delay, `no-speech` / `aborted` errors don't break the loop, stopping cancels pending restart), errors (real errors stop + dispatch, bubble across shadow DOM, synchronous start() failure caught, missing error field → "unknown"), cleanup (disconnect stops active session, no-op when inactive, restart timer cleared, handlers nulled before stop).
- Test file demonstrates an important technique — the `FakeRecognition` class accumulates constructed instances in a static array, so tests can assert on the newest instance without guessing when restarts fire. Makes the auto-restart tests (which create multiple sessions in sequence) trivial to verify.

Delivered test count: 867 total (up from 832 after file search), all 18 webapp test files passing.

### 5.5b — Phase 2e.4 History browser refinements — **delivered**

Closes out Phase 2e by adding the per-message interactions the initial history-browser commit deliberately deferred (the 2e.2 scope cut called these "scope creep; basic load flow matters more"). With the Phase 3 diff-viewer stub now in place, the context menu's ad-hoc-comparison items have somewhere meaningful to dispatch.

- `webapp/src/history-browser.js` — additions:
  - Per-message hover toolbar: `📋 Copy` and `↩ Paste to Prompt` buttons at each message's top-right, opacity-animated so they appear only on hover (same pattern as chat panel's message toolbar in 2d).
  - Image thumbnails in preview. `normalizeMessageContent` from `image-utils.js` extracts images from multimodal content arrays; pre-existing `msg.images` (server's flattened shape) takes precedence. 60px thumbnails (smaller than chat panel's 80px — preview pane is narrower and users are scanning, not interacting), no re-attach overlay (re-attaching from a past session into the current input isn't part of the 2e.4 scope).
  - Context menu on right-click. Four items — "◧ Load in Left Panel", "◨ Load in Right Panel", "📋 Copy", "↩ Paste to Prompt". Positioned at viewport coordinates via `position: fixed` + style bindings. Dismiss paths: click outside the menu (document-level click listener with `composedPath()` check for menu containment), Escape key (first press closes menu only, second closes modal), modal close (context menu state cleared via the existing `_close` path and the `updated()` reset block).
  - `load-diff-panel` event dispatch carrying `{content, panel, label}` — bubbles and composes out of the shadow DOM so chat panel's event listener (Phase 3.1 will wire this to diff viewer's `loadPanel`) can route it. `label` is `"{role} (history)"` so the floating panel label in the diff viewer tells the user where the content came from.
  - Extracted text for all actions goes through `_extractMessageText(msg)` which delegates to `normalizeMessageContent` — multimodal messages have text blocks joined with `\n`, image blocks dropped. Empty-text messages (image-only) produce a no-op for copy / paste / load-in-panel rather than emitting an empty toast.
  - Copy path reuses the clipboard-write-or-warning-toast pattern from chat panel's `_copyMessageText` with `ac-toast` window-event dispatch (the browser is modal, so local toast would be overkill; the app shell's global toast layer is already listening).

- `webapp/src/history-browser.test.js` — three new test blocks covering:
  - **Image thumbnails** (4 tests) — renders for `images` field, renders for multimodal content arrays, absent image renders no section, renders alongside text.
  - **Hover action buttons** (9 tests) — toolbar shape, copy writes raw markdown source (not rendered HTML) to clipboard, copy success toast, copy warning when clipboard API unavailable, paste dispatches `paste-to-prompt` with text, event bubbles across shadow DOM, paste closes the modal, actions work on multimodal messages (text extracted), copy on empty content is a no-op.
  - **Context menu** (15 tests) — right-click opens menu, positions at click coordinates, four items render with correct labels, contextmenu event's `preventDefault` is called (stops native browser menu), Load-in-Panel dispatches `load-diff-panel` with correct panel + content + label, event bubbles across shadow DOM, Load-in-Panel keeps modal open (lets users load both panels in succession), Load-in-Panel closes the context menu, Copy uses clipboard path and closes menu, Paste dispatches and closes modal, click-outside dismisses, Escape closes menu first then modal on second press, modal close also clears menu, reopening modal resets context menu state, document click listener removed on disconnect.

Design points pinned by tests:

- **Load-in-Panel doesn't close the modal.** Users often load a message into the left panel and then want to load a different message into the right panel for ad-hoc comparison. Closing after the first load would force them to reopen the browser every time. The Copy and Paste-to-Prompt items DO close (paste's point is to return to the input; copy's point is that the user now wants to paste elsewhere — usually outside the modal). Pinned explicitly because the asymmetry is easy to miss.

- **Escape priority: context menu → modal.** Two-step Escape matches how most desktop apps handle modal-plus-popover stacks. Without this, right-clicking and then Escape-ing would dismiss the entire history browser, making the user re-open it to try again. Pinned by `test_escape_after_menu_already_closed_closes_the_modal`.

- **composedPath() used for dismiss click detection.** The context menu lives in the history browser's shadow DOM; the document-level click listener sees the shadow host as the target. Walking `composedPath()` lets us distinguish "click inside the menu" (let the button handler run) from "click anywhere else" (dismiss). Matches the same pattern Phase 3's SVG viewer uses for its context menu.

- **Raw markdown source on copy, not rendered HTML.** Pinned by `test_copy_button_writes_raw_text_to_clipboard` which asserts `"use **bold** here"` (asterisks intact) rather than an HTML `<strong>` representation. A user pasting into another editor wants the markdown source, and the assistant message renders bold-via-markdown is a presentation-layer concern.

- **`msg.images` takes precedence over multimodal extraction.** The history store's `get_session_messages` path reconstructs image_refs into a top-level `images` array — that's the server's canonical shape and should win when present. Multimodal content arrays are the fallback for callers that pass the raw message shape directly. Both paths covered by separate tests.

Not included (explicit scope boundaries):

- **Image lightbox in history preview.** Clicking a thumbnail currently does nothing. Adding a lightbox would duplicate chat panel's implementation and the spec isn't explicit that it's needed here. A user who wants to examine a past image closes the browser, loads the session, and views it in the main chat panel where the lightbox already lives.
- **Re-attach overlay on history thumbnails.** Chat panel's thumbnails have a `📎` button that re-adds the image to the current input. History browser doesn't — re-attaching an image from an earlier session is a reasonable feature but specs4 doesn't call for it, and the Paste-to-Prompt path already lets users bring back past text; images are a separate concern with a different UX path.
- **Wiring the `load-diff-panel` consumer.** Phase 3.1 will add a handler on the chat panel (or directly on the app shell) that calls `diffViewer.loadPanel(content, panel, label)`. The event fires correctly today; the payload is ready; only the final consumer is Phase 3's job.

## Layer 5 — Phase 2 complete

Phase 2 (essential tabs) is complete. All of: chat panel with full message rendering pipeline, files tab orchestration, file picker, search integration (message + file), speech-to-text, history browser with per-message actions. Ready to proceed to Phase 3 (richer components — diff viewer with Monaco, SVG viewer, Context/Cache/Settings tabs, file navigation grid, TeX preview, Doc convert tab).

### 5.29 — Phase 3.6 Token HUD — **delivered**

Floating transient overlay showing per-request token breakdown after each LLM response. Appears in the top-right corner of the viewport, auto-hides after 8 seconds with an 800ms fade. Hover pauses the timer; mouse leave restarts. Dismiss button hides immediately. Five collapsible sections with state persisted to localStorage.

- `webapp/src/token-hud.js` — `TokenHud(RpcMixin(LitElement))`:
  - Listens for `stream-complete` window events; filters out errors and empty results
  - Extracts `token_usage` from the result immediately for the "This Request" section
  - Fetches full `get_context_breakdown` asynchronously for tier data, budget, changes, totals
  - Auto-hide: 8s → 800ms CSS opacity fade → hidden. Hover pauses; mouse leave restarts
  - Five collapsible sections: Cache Tiers (per-tier bar chart with lock icon), This Request (prompt/completion/cache read/write), History Budget (usage bar with percentage), Tier Changes (promotions/demotions), Session Totals (cumulative)
  - Section collapse state persisted to `ac-dc-hud-collapsed` as JSON-serialized Set
  - Cache hit rate badge in header with color coding (≥50% green, ≥20% amber, <20% red)
  - Prefers `provider_cache_rate` over local `cache_hit_rate` when available
  - `visible` attribute reflected manually for CSS `:host([visible])` selector
  - Tier colors follow warm-to-cool spectrum (L0 green, L1 teal, L2 blue, L3 amber, active orange)
  - Handles missing/partial data gracefully (placeholder text for each section)

- `webapp/src/app-shell.js` — imports `token-hud.js`, renders `<ac-token-hud>` after the toast layer

## Layer 5 — Phase 3 complete

Phase 3 (richer components) is complete. All of: Monaco diff viewer with markdown preview, TeX preview, LSP integration, and markdown link provider; SVG viewer with synchronized pan/zoom, full SvgEditor visual editing surface (selection, drag-to-move, resize handles, vertex edit, path command parsing, inline text editing, multi-selection with marquee, undo stack, copy/paste/duplicate), presentation mode, context menu, copy-as-PNG, SVG↔text mode toggle, embedded image resolution; Context tab with Budget and Cache sub-views; Settings tab; file navigation grid with Alt+Arrow traversal and fullscreen HUD; Token HUD floating overlay.

Remaining Layer 5 work:
- **Doc Convert tab** — frontend UI for the DocConvert backend (Layer 4.6). Scan display, status badges, conversion progress, clean-tree gate rendering. The backend is complete; this is the UI surface.
- **Dialog polish** — dragging, resizing, minimizing, position persistence to localStorage. Currently the dialog is fixed left-docked at 50% width.
- **File picker enhancements** — git status badges (M/S/U/D), branch badge at root, context menu (stage/unstage/rename/delete/new file), three-state checkbox with exclusion, keyboard navigation, sort modes (mtime/size), active-file highlight from viewer events, middle-click path insertion.
- **App shell polish** — ~~state restoration cascade (get_current_state on setupDone)~~, ~~file/viewport persistence to localStorage~~, window resize handling, global keyboard shortcuts (Alt+1..4 for tabs, Alt+M for minimize, Ctrl+Shift+F prefill from selection).
- **Collaboration UI** — admission flow (pending screen, admission toast), participant UI restrictions, connected users indicator, collab popover with share link.

These are enhancement-level items that build on the working foundation. The core interaction loop (chat + file selection + file viewing + editing + search) is fully functional.

### 5.28 — Phase 3.5 File navigation grid — **delivered**

Implements the 2D spatial file navigation grid with Alt+Arrow traversal and fullscreen HUD overlay. Every file-open action creates a new node adjacent to the current node; Alt+Arrow keys traverse spatially; a semi-transparent HUD appears while Alt is held showing the grid structure with connector lines and travel counts.

- `webapp/src/file-nav.js` — `FileNav` LitElement component with:
  - Grid data model: `_nodes` Map, `_gridIndex` position→id lookup, `_travelCounts` per-edge, `_currentNodeId`, auto-incrementing `_nextId`
  - `openFile(path)` — same-file suppression, adjacent same-file reuse (increments travel count), placement in PLACEMENT_ORDER priority (right → up → down → left), replacement when surrounded (REPLACEMENT_ORDER tie-break: left → down → up → right)
  - `navigateDirection(dir)` — adjacent lookup with edge wrapping (left wraps to rightmost on same row, etc.), travel count increment
  - `show()` / `hide()` — HUD visibility with fade-out
  - `clear()` — resets grid, keeps current file as root
  - Replacement undo — 3-second toast with Undo button, restores removed node + travel counts
  - HUD rendering — centered on current node, connector lines between adjacent nodes, travel counts at midpoints, file-type-colored node cards with truncated basenames, current-node highlight, same-file glow
  - File type colors following visible spectrum by language family
  - Click-to-teleport on any node (dispatches navigate-file with `_fromNav` flag)
- `webapp/src/app-shell.js` — integration:
  - Imports `file-nav.js`, renders `<ac-file-nav>` before the dialog
  - `_onGridKeyDown` (capture phase) — Alt+Arrow consumed when grid has nodes, navigates direction, shows HUD, routes to viewer; Escape hides HUD
  - `_onGridKeyUp` — Alt release hides HUD
  - `_onNavigateFile` — registers files with the grid unless `_fromNav` or `_refresh` flags are set

### 5.27 — Phase 3.4 Context tab (Budget + Cache sub-views) — **delivered**

Wires the Context dialog tab to `LLMService.get_context_breakdown`. Budget/Cache pill toggle at the top; active sub-view persisted to localStorage. Both sub-views listen for `stream-complete`, `files-changed`, and `mode-changed` window events — refresh when visible, mark stale when hidden, auto-refresh on `onTabVisible()`.

Budget sub-view shows:
- Model name + cache hit rate + mode indicator
- Token budget bar (green ≤75%, amber 75–90%, red >90%)
- Proportional stacked horizontal bar by category (system/symbol-map/files/URLs/history) with colored segments
- Legend row with per-category token counts
- Per-category detail rows with proportional bars
- Session totals grid (prompt in, completion out, total, cache read/write when non-zero)

Cache sub-view shows:
- Cache performance header with hit-rate bar (color-coded: ≥50% green, ≥20% amber, <20% red)
- Recent changes section (promotions 📈 and demotions 📉) when any occurred this cycle
- Per-tier collapsible groups with tier-colored headers, total tokens, and cached lock icon
- Per-item rows within expanded tiers: type icon (⚙️/📖/📦/📝/📄/🔗/💬), name/path, stability bar (N/threshold with tier-colored fill), and token count
- Unmeasured items collapsed into a summary line ("N pre-indexed symbols/documents (awaiting measurement)")
- Empty tiers show "Empty tier" placeholder
- Tier expand/collapse state persisted to `ac-dc-cache-expanded` localStorage key (defaults: L0 and active expanded)
- Footer with model name and total token count

- `webapp/src/context-tab.js` — `ContextTab(RpcMixin(LitElement))` component:
  - `_subview` persisted to `ac-dc-context-subview` localStorage key
  - `_refresh()` fetches via `get_context_breakdown`, guarded by loading flag
  - `_isTabActive()` checks parent `.tab-panel.active` class
  - Stale detection on `stream-complete` / `files-changed` / `mode-changed` when hidden
  - `onTabVisible()` public hook for the dialog to call on tab switch
  - `_fmtTokens(n)` formats with K suffix
  - `_budgetColor(pct)` returns green/amber/red by threshold
  - `_COLORS` map for category segments
  - Budget sub-view handles missing/partial backend data gracefully (empty state, field defaults)
  - Cache sub-view:
    - `_cacheExpanded` Set persisted to `ac-dc-cache-expanded` (defaults: L0, active)
    - `_TIER_COLORS` map (L0 green → L1 teal → L2 blue → L3 amber → active orange)
    - `_TYPE_ICONS` map for per-item type classification
    - `_renderCacheTier(block)` — collapsible tier group with measured/unmeasured item split
    - `_renderCacheItem(item, block, tierColor)` — per-item row with icon, name, stability bar, N/threshold label, token count
    - Unmeasured items (tokens=0) collapsed into summary line with mode-aware label
    - Recent changes section (promotions/demotions) rendered above tier groups
    - Footer with model name and total tokens

- `webapp/src/app-shell.js` — imports `context-tab.js`, renders `<ac-context-tab>` when `activeTab === 'context'`. Removes the last placeholder tab fallback.

### 5.26 — Phase 3.3 Settings tab — **delivered**

Wires the Settings dialog tab to the `Settings` RPC service (Layer 4.5). Card grid of eight whitelisted config types; clicking a card opens an inline monospace textarea editor. Save writes via `Settings.save_config_content`; reloadable configs (LLM, App) auto-trigger their reload RPC on save. Ctrl+S shortcut within the textarea. Info banner shows model names and config directory from `Settings.get_config_info`.

- `webapp/src/settings-tab.js` — new `SettingsTab(RpcMixin(LitElement))` component:
  - `CONFIG_CARDS` array — eight entries matching the backend's `CONFIG_TYPES` whitelist (litellm, app, system, system_extra, compaction, snippets, review, system_doc). Each has icon, label, format hint, and reloadable flag.
  - `_loadInfo()` — fetches model names + config dir on RPC ready.
  - `_openCard(key)` — loads content via `get_config_content`, sets `_activeKey` to show the editor.
  - `_save()` — writes via `save_config_content`, surfaces advisory JSON warnings, auto-triggers reload for reloadable types.
  - `_reload()` — dispatches to `reload_llm_config` or `reload_app_config` based on the active key.
  - `_onEditorKeyDown` — Ctrl+S shortcut within the textarea.
  - Toast feedback for all success/error/warning paths via `ac-toast` window events.

- `webapp/src/app-shell.js` — imports `settings-tab.js`, renders `<ac-settings-tab>` when `activeTab === 'settings'`. Context tab remains a placeholder.

### 5.25 — Phase 3.2e SVG embedded image resolution — **delivered**

Resolves relative `<image href="...">` references in SVG files rendered by the viewer. PDF/PPTX-converted SVGs produced by doc-convert reference sibling raster images with relative paths (e.g., `<image href="01_slide_img1.png"/>`). When injected into the webapp DOM, the browser resolves these against the webapp's origin URL — which doesn't serve repo files — so images silently fail to load.

- `webapp/src/svg-viewer.js` — additions:
  - `_resolveImageHrefs(container, svgPath)` — scans a `.svg-container` for `<image>` elements, skips data URIs and absolute URLs, resolves relative paths against the SVG file's directory, fetches via `Repo.get_file_base64`, rewrites `href` and `xlink:href` in-place. Runs in parallel via `Promise.all`. Non-blocking — panels are interactive immediately, images appear as fetches complete. Failed fetches log a warning.
  - `_resolveOneImageHref(imgEl, repoPath, call)` — per-image fetch + rewrite. Handles both `href` and `xlink:href` attribute forms.
  - `_extractBase64Uri(result)` — unwraps Repo.get_file_base64 responses (plain string, `{data_uri}`, `{content}`, jrpc-oo envelope).
  - Called from `_injectSvgContent` after SVG injection on both panels (left skipped in presentation mode).

### 5.24 — Phase 3.2d SVG viewer presentation, context menu, copy-as-PNG, mode toggle — **delivered**

Adds four features to the SVG viewer surface:

1. **Presentation mode** — `◱` button (or F11) toggles left panel hidden, right panel full-width. Editor stays active. Escape exits. CSS `display: none` on the left pane rather than DOM removal so the editor's SVG element and event listeners survive the toggle. Pan-zoom skipped in presentation mode (no left panel to sync). Mode resets to select when the last file closes.

2. **Context menu** — right-click on the right panel shows a "📋 Copy as PNG" item. Positioned at click coordinates via `position: fixed`. Dismissed on click outside (document-level listener with `composedPath()` containment check) or on Escape.

3. **Copy as PNG** — renders the current modified SVG to a canvas with white background and quality scaling (up to 4× for small SVGs, capped at 4096px). Clipboard write via `ClipboardItem` with a promise-of-blob (preserves user-gesture context across async). Download fallback when clipboard API unavailable. Toast feedback via `ac-toast` window event.

4. **SVG ↔ text diff mode toggle** — `</>` button on the SVG viewer dispatches `toggle-svg-mode` with `target: 'diff'`. `🎨 Visual` button on the diff viewer dispatches `toggle-svg-mode` with `target: 'visual'`. App shell handler orchestrates the swap: captures content + savedContent from the source viewer, closes the file on both viewers, opens on the target with carried state so dirty tracking survives the transition.

- `webapp/src/svg-viewer.js` — additions:
  - `_MODE_SELECT` / `_MODE_PRESENT` constants and `_mode` reactive property
  - `_togglePresentation()` — flips mode, clears content caches so re-injection fires
  - `.split.present` CSS hides left pane, expands right to 100%
  - `.floating-actions` stack replaces the standalone fit button — three buttons (presentation toggle, text-diff toggle, fit)
  - `_onContextMenu` / `_onContextDismiss` — context menu lifecycle
  - `_copyAsPng()` — full pipeline: parse dimensions → scale → canvas → clipboard or download
  - `_switchToTextDiff()` — captures editor content and dispatches `toggle-svg-mode`
  - `_emitToast` routes through `ac-toast` window event (matches app shell's toast layer)
  - F11 and Escape keyboard handling in `_onKeyDown`
  - Ctrl+Shift+C for copy-as-PNG
  - Presentation mode skips left-panel SVG injection and pan-zoom init

- `webapp/src/diff-viewer.js` — additions:
  - `_isSvgFile(file)` helper
  - `_switchToVisualSvg()` — reads live editor content and dispatches `toggle-svg-mode`
  - `🎨 Visual` button rendered when active file is `.svg`

- `webapp/src/app-shell.js` — additions:
  - `_onToggleSvgMode` handler — catches `toggle-svg-mode` window events, routes content between viewers with dirty-state preservation
  - Event listener wiring in connectedCallback/disconnectedCallback

### 5.23 — Phase 3.2c.5 SvgEditor undo stack + copy/paste — **delivered**

Adds undo stack (SVG innerHTML snapshots before each mutation, Ctrl+Z to restore, bounded to 50 entries) and internal copy/paste (Ctrl+C/V/D). Completes the Phase 3.2c editing surface.

- `webapp/src/svg-editor.js` — additions:
  - `_undoStack` array and `_clipboard` array on the constructor
  - `_pushUndo()` — snapshots `this._svg.innerHTML` with handle group and text-edit foreignObject temporarily stripped so undo doesn't restore stale selection chrome. Bounded to `_UNDO_MAX` (50) entries
  - `undo()` — pops the stack, replaces innerHTML, clears selection (DOM element references become stale after innerHTML replacement), fires onChange. Returns boolean indicating whether an undo was performed
  - `canUndo` getter for UI/test visibility
  - `copySelection()` — serializes selected elements' outerHTML to the internal clipboard array
  - `pasteClipboard(offsetX?, offsetY?)` — deserializes clipboard HTML via a temporary SVG wrapper, applies positional offset via `_applyPasteOffset`, inserts before the handle group, selects pasted elements
  - `duplicateSelection()` — copy + paste with zero offset
  - `_applyPasteOffset(el, dx, dy)` — per-element-type position dispatch matching the drag-to-move pattern (rect/image/use via x/y, circle/ellipse via cx/cy, line via all four endpoints, text via x/y or transform, path/g/polygon/polyline via transform)
  - Keyboard handlers for Ctrl+Z (undo), Ctrl+C (copy), Ctrl+V (paste), Ctrl+D (duplicate)
  - `deleteSelection()`, drag commit (`_onPointerMove` threshold crossing), and `commitTextEdit()` all call `_pushUndo()` before mutating
  - `detach()` clears both `_undoStack` and `_clipboard`
  - Shift+click now takes priority over handle hit-test in `_onPointerDown` — prevents accidental resize drags when the user intends to modify the selection set

- `webapp/src/svg-editor.test.js` — 25 new tests across 2 describe blocks:
  - **Undo stack** (13 tests): undo after delete restores SVG, undo clears selection (stale refs), undo fires onChange, empty stack returns false, undo after drag commit restores pre-drag state, undo after text edit commit restores original text, unchanged text edit doesn't push undo, stack bounded to 50, detach clears stack, Ctrl+Z keyboard trigger, multiple progressive undos, undo snapshot excludes handle group
  - **Copy/paste** (12 tests): copy populates clipboard, paste inserts with offset, pasted rect has correct offset, paste selects pasted element, paste fires onChange, paste pushes undo, empty clipboard no-op, empty selection copy no-op, Ctrl+C/V keyboard flow, duplicate in place (zero offset), Ctrl+D keyboard, multi-selection copy/paste, circle cx/cy offset, path transform offset, detach clears clipboard

Design points pinned by tests:

- **Undo snapshot excludes handle group.** `_pushUndo` temporarily removes the `<g id="svg-editor-handles">` before reading `innerHTML` and restores it after. Without this, undo would restore stale handle chrome from a prior selection state, and repeated undo/redo would accumulate duplicate handle groups.

- **Undo after innerHTML replacement clears selection.** DOM element references held in `_selected` and `_selectedSet` become stale after `innerHTML` replacement — the old DOM nodes are detached and new ones created. Keeping stale refs would cause subsequent operations (drag, delete, resize) to silently fail or corrupt the SVG. Clearing forces the user to re-select, which is the correct UX after undo.

- **Unchanged text edits don't push undo.** Opening a text edit, not typing, then pressing Enter should not pollute the undo stack. The commit path checks `newContent !== originalContent` before calling `_pushUndo`. This keeps the stack clean so Ctrl+Z always undoes a meaningful change.

- **Paste inserts before the handle group.** Pasted elements render below the selection chrome (handles, bounding boxes) so the user sees both the pasted content and the selection overlay. Without this ordering, the pasted element would render on top of the handles, making them unclickable.

- **Shift+click priority over handle hit-test.** Before this change, shift+click on a selected element with visible handles would fall through to the handle hit-test (which returns null since no handle is exactly under the pointer) and then to the move-drag path. After this change, shift+click always dispatches to `toggleSelection` regardless of handle state. This fixes three test failures where shift+click was starting drags instead of modifying the selection.

### 5.22 — Phase 3.2c.4 SvgEditor multi-selection + marquee — **delivered**

Adds shift+click toggle, marquee selection (forward=containment, reverse=crossing), group drag, and multi-element delete. Per-element bounding-box rendering in multi-selection mode (no resize handles — those only make sense for single selection). Double-click on text in a multi-selection collapses to single + opens inline edit.

- `webapp/src/svg-editor.js` — additions:
  - `_selectedSet: Set` alongside `_selected`. `_selected` is the "primary" for single-element operations; `_selectedSet` holds every selected element.
  - `getSelectionSet()` returns a fresh Set copy each call.
  - `toggleSelection(element)` adds/removes from set; updates primary.
  - `setSelection` now clears the set and replaces with a single element.
  - `deleteSelection` iterates the full set; fires onChange once.
  - `_onPointerDown` branches on `event.shiftKey`: shift+click on element → toggle; shift+click on empty → begin marquee; plain click on set member → group drag; plain click elsewhere → replace selection.
  - `_beginDrag` snapshots every element in `_selectedSet` via `entries` array. `_applyDragDelta` iterates entries. `_cancelDrag` restores every entry.
  - Marquee machinery: `_beginMarquee`, `_updateMarquee`, `_endMarquee`, `_cancelMarquee`, `_marqueeCandidates`, `_marqueeHitTest`, `_elementBBoxInSvgRoot`, `_createMarqueeRect`, `_marqueeBBox`, `_marqueeBBoxFor`, `_svgDistToScreenDist`.
  - `_renderHandles` dispatches by set size: empty→clear, single→full handles, multi→per-element bbox overlay via new `_renderBBoxOverlay(group, element, isPrimary)`.
  - `_onDoubleClick` collapses multi-selection to the double-clicked text element before opening edit.
  - Module-level helpers: `_bboxOverlaps`, `_bboxContains`, `_MARQUEE_MIN_SCREEN`, `MARQUEE_ID`.

- `webapp/src/svg-editor.test.js` — 34 new tests across 7 describe blocks:
  - **Shift+click** (6): add, remove, primary promotion, last-removal clears, plain click replaces, non-selectable no-op.
  - **Rendering** (4): single → bbox + handles, multi → per-element bbox no handles, three-element → three bboxes, clearing removes all.
  - **Group drag** (6): starts on set member, moves all uniformly, onChange once, mixed types, detach rolls back all, click-unselected collapses.
  - **Delete** (3): removes all, keyboard removes all, onChange once.
  - **Double-click on text** (1): collapses + opens edit.
  - **Marquee** (10): shift+drag starts, shift+click no-op, forward containment, reverse crossing, adds to baseline, no-hits preserves, renders rect, below-threshold no rect, detach removes, scans `<g>` children.

### 5.21 — Phase 3.2c.3c SvgEditor inline text editing — **delivered**

Double-clicking a `<text>` element opens a foreignObject-hosted textarea positioned at the element's bounding box. The textarea inherits the text's font size and color. Enter commits, Escape cancels, blur commits (user-friendly — accidental click-aways don't discard work). Only one edit can be active at a time. Completes the 3.2c editing surface for visible SVG content.

- `webapp/src/svg-editor.js` — additions:
  - `_textEdit` state field in the constructor — `{element, originalContent, foreignObject, textarea}` during an active edit, null otherwise
  - Three new bound handlers: `_onDoubleClick`, `_onTextEditKeyDown`, `_onTextEditBlur`
  - `attach` / `detach` wire up the `dblclick` listener; `detach` calls `cancelTextEdit` so a detach during an edit rolls back rather than leaving an orphaned foreignObject
  - New public methods: `beginTextEdit(element)`, `commitTextEdit()`, `cancelTextEdit()`
  - New private methods: `_renderTextEditOverlay` (builds the foreignObject + textarea), `_teardownTextEditOverlay` (removes them), `_onDoubleClick` (dispatch gate)
  - foreignObject carries `HANDLE_CLASS` so `_hitTest` skips it — clicks inside the textarea don't re-hit-test to the underlying text element

- `webapp/src/svg-editor.test.js` — 39 new tests across 7 describe blocks:
  - **`beginTextEdit`** (11 tests): null argument no-op, non-text element no-op, opens foreignObject overlay for text, textarea value matches element content, overlay positioned from bounding box with padding, font-size inherited, fill color inherited, default font-size when attribute absent, foreignObject has handle class (hit-test exclusion), starting new edit commits prior one, captures original content for rollback
  - **`commitTextEdit`** (7 tests): no-op when not editing, replaces content with textarea value, removes foreignObject, clears state, fires onChange when changed, does NOT fire onChange when unchanged (clicking in and pressing Enter without typing doesn't mark file dirty), flattens tspan children wholesale, allows empty content
  - **`cancelTextEdit`** (5 tests): no-op when not editing, restores original content, removes foreignObject, no onChange fired, clears state
  - **Keyboard handling** (5 tests): Enter commits, Shift+Enter does not commit (multi-line), Escape cancels, other keys flow through, Delete key in textarea does not delete the underlying element (propagation stopped)
  - **Blur handling** (2 tests): blur commits, blur after commit is a no-op
  - **Double-click dispatch** (5 tests): text element opens edit, non-text ignored, empty space ignored, tspan resolves to parent text, stopPropagation on text hit
  - **Lifecycle** (4 tests): detach cancels active edit + restores content, detach doesn't fire onChange, handles re-render after commit, beginTextEdit during active drag doesn't crash

Design points pinned by tests:

- **Single text node replacement flattens tspan structure.** `commitTextEdit` clears all children and appends one text node. A `<text>` element with multiple `<tspan>` children loses the structure on first commit. Pinned by `flattens tspan children on commit`. Documented trade-off — most SVGs use plain text elements; tspan-heavy documents should be edited at the source. Alternative (per-tspan editing) would require a richer UI that's out of 3.2c scope.

- **Blur commits rather than cancels.** Users accidentally clicking outside the textarea shouldn't lose their edits. Pinned by `blur commits the edit`. If the user wants to abandon, Escape is explicit. The cost is that a deliberate click-away acts as an implicit save; the benefit is forgiving behavior for the common case.

- **onChange only fires on actual content change.** Opening an edit and committing without typing is a no-op — the file stays clean. Pinned by `does NOT fire onChange when content unchanged`. Without this, every double-click-to-inspect action would mark the file dirty, defeating dirty-tracking.

- **Enter vs Shift+Enter.** Plain Enter commits (matches IDE / form convention). Shift+Enter falls through to the textarea's default behavior — inserting a newline. Pinned separately. Allows multi-line text in SVG, though rendering multi-line in the committed text element requires the caller to handle the newline (our textarea value round-trips verbatim; the rendered `<text>` shows the content as a single line per standard SVG text rendering unless the caller adds tspan structure).

- **textarea keydown stops propagation for non-commit/cancel keys.** Without this, the document-level keydown handler would hijack Delete/Backspace and delete the selected text element while the user is editing it. Pinned by `textarea Delete key does not delete the element`. The commit/cancel keys do stopPropagation too (for symmetry), but they'd already have fired their action.

- **foreignObject carries HANDLE_CLASS.** `_hitTest` excludes elements with this class, so clicks inside the textarea don't re-hit-test to the text element underneath. Pinned by `foreignObject has handle class`. If this broke, clicking the textarea would fire pointerdown → hit-test returns text → already selected → starts a drag. The drag wouldn't commit (no pointermove) but the state thrash would be confusing.

- **Double-click routes via hit-test.** `_onDoubleClick` calls `_hitTest` which handles tspan → text resolution. Pinned by `double-click routes via tspan → parent text`. Users who double-click on a tspan child (the rendered text run) get the text element opened for editing — which is what they meant.

- **Starting a new edit commits the previous one.** Prevents orphaned foreignObjects stacking on the SVG. Pinned by `commits prior edit when starting a new one`. If the prior textarea had modifications, they're committed to the first element before the second edit opens.

- **Detach rolls back.** Same pattern as detach cancels drag. Pinned by `detach cancels active text edit` which verifies both the overlay removal and the content restoration.

Phase 3.2c editing surface is complete for visible SVG content: selection + drag-to-move + resize or vertex edit where meaningful + inline text editing. Remaining 3.2c work: multi-selection + marquee (3.2c.4), undo stack + copy/paste (3.2c.5).

### 5.20 — Phase 3.2c.3b-iii SvgEditor path arc endpoint edit (A) — **delivered**

Arc commands get an endpoint handle using the standard `p{N}` role format. Arc shape parameters (rx, ry, rotation, flags) stay fixed during drag — only args[5..6] move. Completes the path editing surface for all SVG path commands.

- `webapp/src/svg-editor.js` — no code changes needed.
  - `_computePathEndpoints` already emits arc endpoints (had since 3.2c.3b-i to support pen-position tracking across multi-command paths that include arcs)
  - `_renderResizeHandles` path branch already emits a `p{N}` handle for any non-null endpoint, which includes arcs
  - `_applyPathEndpointResize` already has a `case 'A':` branch (`args[5] += dx; args[6] += dy`) from 3.2c.3b-i
  - Module docstring updated with 3.2c.3b-iii scope note

- `webapp/src/svg-editor.test.js` — 17 new tests across 2 describe blocks:
  - **Path arc endpoint rendering** (5 tests): A command produces exactly one handle (p0 + p1, no c-handles), handle positioned at absolute endpoint, relative arc handle positioned at computed pen+delta endpoint, A produces no tangent lines (no control points → no tangents), multi-arc path renders one handle per arc endpoint with no cross-contamination.
  - **Path arc endpoint drag** (12 tests): dragging arc endpoint moves only args[5..6]; shape parameters preserved during drag (rx=15, ry=25, rotation=45, large-arc=1, sweep=0 all verified); relative arc endpoint drag applies delta to relative args; flag args stay as integers across round-trip (no "0.0" drift); arc drag in multi-command path leaves other commands alone; negative deltas work; repeated pointermoves recompute from origin; onChange fires after committed drag; tiny move doesn't commit; detach mid-drag restores `d`; clicking arc endpoint handle starts resize drag with correct kind+role; parse-serialize round-trip is lossless (re-parsed output matches expected command structure with mutated endpoint).

Design points pinned by tests:

- **Arc shape preserved during drag.** Dragging an arc endpoint doesn't reshape the curve — rx, ry, rotation, and the two flags stay exactly as they were. Pinned by `arc shape parameters preserved during drag` which uses distinctive shape values (45° rotation, large-arc=1, sweep=0) and asserts byte-exact preservation after a drag.

- **No control-point handles for arc shape parameters.** rx, ry, rotation are scalars; large-arc-flag and sweep-flag are booleans. None have a natural positional interpretation on screen, so there's nothing meaningful to drag. Users wanting to reshape an arc edit the source directly. Pinned by `A command produces exactly one handle (endpoint only)` which asserts only two handles exist total for a `M A` path (initial M's p0 plus A's p1).

- **Flag integers survive round-trip.** SVG path flag args are 0 or 1 — never fractional. The serializer's `String(n)` conversion handles these cleanly (integer numbers stringify as "0" and "1", not "0.0"). Pinned by `flags stay as integers across round-trip` which drags an arc with both flags set to 1 and asserts the output is byte-exact.

- **Endpoint dispatch was already correct.** The existing `case 'A': args[5] += dx; args[6] += dy; break;` in `_applyPathEndpointResize` has been there since 3.2c.3b-i landed. This sub-phase is primarily test coverage — proving the existing dispatch behaves correctly through the full pipeline (handle render → hit test → drag → serialize → re-parse). The parser round-trip test explicitly verifies this end-to-end.

- **No per-command relative math special-casing.** Arc's relative form uses the same "args are deltas from pen, adding drag delta shifts endpoint by exactly that delta" rule as every other relative command. Pinned by `relative arc endpoint drag applies delta to args`.

3.2c.3b is complete. The path editing surface covers every SVG path command — M, L, H, V, C, S, Q, T, A, Z — with appropriate handle shapes (endpoints for all non-Z, plus control points for C/S/Q). 3.2c.3c will add inline text editing via foreignObject textarea on double-click.

### 5.19 — Phase 3.2c.3b-ii SvgEditor path control-point edit (C/S/Q) — **delivered**

Cubic and quadratic Bézier curve commands get draggable control-point handles in addition to the endpoint handles from 3.2c.3b-i. Each control point is independently draggable with dashed tangent lines showing the connection to its endpoint.

- `webapp/src/svg-editor.js` — additions:
  - New module-level `_computePathControlPoints(commands)` — walks the command list (same pen-tracking machinery as `_computePathEndpoints`) and returns an array aligned with `commands`. Each entry is either an array of `{x, y}` control points (for C/S/Q) or null (for M/L/H/V/T/A/Z). C emits two CPs, S and Q emit one, T emits none (its control is reflected from the previous command, not independently draggable).
  - `_renderResizeHandles` — `path` branch extended to emit control-point handles with role `c{N}-{K}` (N = command index, K = 1 or 2) plus tangent lines connecting each control point to its endpoint. Tangent lines render BEFORE the endpoint dots so the endpoints visually stack on top when control points sit near them.
  - New `_makeTangentLine(x1, y1, x2, y2)` factory — dashed SVG line with `HANDLE_CLASS` and `pointer-events="none"`. Dash pattern and stroke width scale inversely with zoom. Carries handle class so `_hitTest` and `_hitTestHandle` both filter it out; only the control-point dots are interactive.
  - `_applyPathEndpointResize` — dispatch routes `c{N}-{K}` roles to the new `_applyPathControlPointResize` before the existing `p{N}` endpoint logic. Keeps the two paths clean rather than multiplexing everything through one switch.
  - New `_applyPathControlPointResize(el, o, role, dx, dy)` — parses `c{N}-{K}` via regex, validates the command index and K value, clones the command list, mutates the target command's control-point args (C with K=1 → args[0..1]; C with K=2 → args[2..3]; S/Q with K=1 → args[0..1]; invalid K or non-curve command → silent no-op).
  - `_computePathControlPoints` exported for tests.

- `webapp/src/svg-editor.test.js` — 38 new tests across 3 describe blocks:
  - **`_computePathControlPoints`** (8 tests): empty/null input, null for non-curve commands, C produces two CPs, S produces one CP, Q produces one CP, relative C/Q/S offset from pen, pen position tracked across non-curve commands.
  - **Control-point handle rendering** (10 tests): C produces 3 handles (p0 from M + c1-1 + c1-2 + p1), C handle positions match args, S produces 2 handles (c2-1 + p2 only — no c2-2), Q produces 2 handles, T produces no CP handle, relative C handles at computed coords, tangent lines from CPs to endpoint, tangent line positions (x1/y1 = CP, x2/y2 = endpoint), tangent lines carry HANDLE_CLASS and pointer-events="none", Q produces one tangent line, non-curve commands produce no tangent lines.
  - **Control-point drag** (16 tests): c1-1 on C moves first CP only, c1-2 on C moves second CP only, endpoint drag leaves CPs untouched, c1-1 on Q moves single CP, c2-1 on S moves single draggable CP, relative C control-point drag applies delta to args, relative Q control-point drag, repeated pointermoves recompute from origin, onChange fires after committed drag, tiny move doesn't commit, detach mid-drag restores `d`, malformed c-role (`c1` without K) no-op, out-of-range K (`c1-3`) no-op, K=2 on Q (only has one CP) no-op, control-point role on non-curve command no-op, click on `c1-1` handle starts resize drag with correct kind+role.

Design points pinned by tests:

- **Tangent lines render before endpoint dots.** The render order is: for each curve command, emit tangent line(s) first, then control-point dot(s), then the endpoint dot. DOM order becomes z-order in SVG — later siblings render on top. When a control point sits very close to its endpoint (e.g., a nearly-straight "curve" that's actually a line-like C), the endpoint dot stays clickable because it's on top of both the tangent line and the CP dot. Pinned indirectly by the click-starts-drag test which relies on `_hitTestHandle` finding the correct handle under the pointer.

- **`c2-1` not `c1-2` for S's control point.** The command index N refers to the command's position in the parsed array, NOT to which control point it is within the path. A path `M 0 0 C ... S ...` has the S at index 2, so its single control point is `c2-1`. Pinned by `S command produces 2 handles` which explicitly asserts `c2-1` and rejects `c2-2`. If the role format encoded the curve-number instead of command-index, dispatch would need a separate lookup table to map back.

- **T has no independently draggable control point.** The T command's control point is the reflection of the previous Q/T's last control through the previous endpoint. Making it draggable would either require mutating the previous command (surprising — the user didn't click on that command) or decoupling the T from its predecessor (violates SVG spec). Pinned by `T command produces no control-point handle`.

- **S has only one draggable control point.** Like T, S's first control point is reflected from the previous C/S. Only args[0..1] (the second control point) is user-draggable. K=2 on S produces a no-op. Pinned by `ignores K=2 on Q` (same rule applies — Q only has one CP) and by `S command produces 2 handles` which confirms the rendered role list contains `c2-1` but never `c2-2`.

- **Control-point role format is regex-matched.** `/^c(\d+)-(\d+)$/` — strict. A malformed role like `c1` (no K) fails the match and the handler returns early. Pinned by `ignores malformed control-point role`. If the regex was looser (e.g., `startsWith('c')` + split on `-`), a role like `c1-1-extra` would match and potentially crash on arg index out-of-bounds.

- **Non-curve commands never receive CP drag.** The dispatch's default case returns without mutation. If a future refactor emitted a `c{N}-{K}` role on an L command (bug), the drag would cleanly no-op rather than crash or silently corrupt the `d` attribute. Pinned by `ignores control-point role on non-curve command`.

- **Relative-form math is identical to endpoints.** The existing relative-command analysis from 3.2c.3b-i carries over: the pen position at the command's start doesn't change when args are mutated (earlier commands are untouched), so adding the drag delta to relative control-point args shifts the effective absolute control point by exactly the delta. Pinned by `relative C control-point drag applies delta to args` and the Q variant. No per-command relative math special-casing needed.

- **Tangent lines are pointer-events: none.** Users dragging near a control point shouldn't have the drag initiate on the line instead of the dot. Lines explicitly opt out; dots explicitly opt in (from 3.2c.2b). Pinned by `tangent lines carry handle class (excluded from hit-test)`.

3.2c.3b-ii completes curve editing. 3.2c.3b-iii will add A (arc) endpoint handles — arc shape parameters (rx, ry, rotation, flags) stay as-is; dragging the arc endpoint preserves the arc's shape while moving its destination.

### 5.18 — Phase 3.2c.3b-i SvgEditor path endpoint edit (M/L/H/V/Z) — **delivered**

Path elements get one draggable handle per non-Z command endpoint. Reuses the resize-drag machinery with a new `path-commands` snapshot kind. Parser covers all SVG path commands (M/L/H/V/C/S/Q/T/A/Z in both cases) so the follow-up sub-phases 3.2c.3b-ii (C/S/Q/T control points) and 3.2c.3b-iii (A arc parameters) only need to add handle rendering and per-command dispatch.

- `webapp/src/svg-editor.js` — additions:
  - `_PATH_ARG_COUNTS` — module-level dispatch table mapping command letters to arg counts. Both cases share the same counts; case determines coordinate interpretation (absolute vs relative) not arg shape.
  - `_parsePathData(d)` — tokenizes path string into command letters and numbers (regex handles signed numbers with sign-change as separator: `M-5-10` → `M`, `-5`, `-10`). Walks tokens, consuming the configured arg count after each command letter. Expands implicit command repetitions: `M 0 0 10 10 20 20` expands to `M 0 0 L 10 10 L 20 20` (M repeats become L, m repeats become l, others repeat themselves). Returns empty array on any parse failure for silent-no-op behavior.
  - `_serializePathData(commands)` — inverse of the parser. Individual command emission (no compaction) so round-tripping is lossless in the parser→serializer→parser direction. Number formatting via `.toString()` rather than `toFixed(N)` to preserve input precision.
  - `_computePathEndpoints(commands)` — walks the command list tracking pen position and most recent subpath start. Returns an array aligned with `commands`, each entry either `{x, y}` (absolute endpoint of that command) or `null` (for Z). Handles all commands: M/L/T use args[0..1]; H single-axis sets x only; V single-axis sets y only; C uses args[4..5]; S/Q use args[2..3]; A uses args[5..6]; Z returns null and advances pen to subpath start.
  - `_renderResizeHandles` — new `path` branch. Parses `d`, computes endpoints, emits one `_makeHandleDot` per non-null entry with role `p{N}`. Z commands produce null endpoints so they naturally skip handle emission.
  - `_captureResizeAttributes` — new `path` case producing `{kind: 'path-commands', commands: [...]}` with deeply-cloned args arrays (prevents drag mutations from leaking back into the snapshot). Kind name distinct from move-drag's `transform` kind — move translates via the transform attribute; vertex resize mutates the `d` attribute directly.
  - `_applyResizeDelta` — new `path-commands` dispatch → `_applyPathEndpointResize`.
  - New method `_applyPathEndpointResize(el, o, role, dx, dy)`. Parses role index, validates bounds, clones the command list, mutates the target command's endpoint args based on command letter (M/L/T at [0..1]; H at [0] x-only; V at [0] y-only; C at [4..5]; S/Q at [2..3]; A at [5..6]; Z skipped). Relative commands (lowercase) work naturally: their args ARE the delta-from-pen, so adding the drag delta shifts the effective endpoint by exactly the drag delta regardless of form.
  - `_restoreResizeAttributes` — new `path-commands` case calls `_serializePathData(snapshot.commands)` to write the origin `d` attribute back.
  - Test-only exports added: `_computePathEndpoints`, `_parsePathData`, `_serializePathData`.

- `webapp/src/svg-editor.test.js` — flipped one test + 50+ new tests:
  - Updated: `path selection produces no resize handles` → `path selection produces handles for each command endpoint`.
  - **`_parsePathData`** (12 tests): empty / null, simple M+L, case preservation, all commands, comma separators, sign-change tokenization, decimals / scientific, implicit repetition after M as L (uppercase and lowercase), implicit repetition for non-M commands, explicit command required after Z, whitespace variations, malformed input → empty.
  - **`_serializePathData`** (6 tests): empty / null, simple M+L, Z with no args, case preservation, numeric precision, round-trip through parser, mixed absolute + relative.
  - **`_computePathEndpoints`** (12 tests): empty, absolute M, absolute L chain, relative L chain (pen accumulation), H single-axis y-unchanged, V single-axis x-unchanged, relative H/V, Z returns null, Z updates pen to subpath start, multi-subpath tracks subpath start across M commands, C endpoint (args[4..5]), Q endpoint (args[2..3]), A endpoint (args[5..6]).
  - **Path handle rendering** (5 tests): one handle per non-Z command, Z commands produce no handle, handles at absolute coords for absolute commands, handles at computed coords for relative commands, H handle inherits y from pen.
  - **Path endpoint drag** (13 tests): p1 drag on M+L moves L endpoint only, p0 drag on M+L moves M only, H drag adjusts x only (y delta ignored), V drag adjusts y only (x delta ignored), relative command drag applies delta to args (endpoint shifts by drag delta), p2 drag on 3-command path leaves others unchanged, negative deltas, repeated pointermoves recompute from origin (no compounding), click on p0 starts resize drag with correct kind + role, onChange fires after committed drag, tiny move below threshold doesn't commit, detach mid-drag restores `d`, malformed role is no-op, out-of-range index is no-op.

Design points pinned by tests:

- **Implicit command repetition is per-SVG-spec.** `M 0 0 10 10 20 20` means moveto followed by two linetos, with the second and third coord pairs promoted to L. Same rule for lowercase — trailing pairs after `m` become `l`. Other commands repeat themselves verbatim. Test `expands implicit repetitions after M as L` pins the uppercase form; `expands implicit repetitions after m as l (lowercase)` pins the lowercase form; `expands implicit repetitions for non-M commands` pins the L self-repeat case. If this broke, paths written in the compact form common in real-world SVGs would fail to parse.

- **Sign changes tokenize as number boundaries.** `M-5-10L20-30` must parse as `M -5 -10 L 20 -30`. The tokenizer regex alternates between a command-letter match and a signed-number match, so sign characters always start a new number token. Pinned by `splits tokens on sign changes`. If the regex treated `-` as requiring preceding whitespace, compact paths would fail.

- **Relative command drag via arg addition.** When the user drags the endpoint of a relative command like `l 15 10`, the handle is rendered at its computed absolute position (pen + args). The drag delta (dx, dy) is added to the command's args directly: the new args become (15+dx, 10+dy). Since the pen position at this command's start is unchanged (earlier commands weren't touched), the effective endpoint shifts by exactly (dx, dy) — matching what the user sees on screen. Pinned by `relative command endpoint drag applies delta to args`. The subtle correctness here: relative command semantics (pen-relative) naturally align with how drag deltas work, so no special math is needed.

- **H and V ignore the irrelevant axis.** Dragging an H endpoint up/down should produce no change because H is horizontal-only. Strict users could drag exactly horizontally, but accepting both and discarding the off-axis component is more forgiving. Pinned by `dragging H handle adjusts x only (y delta ignored)` and the V counterpart. The alternative (reject the drag unless strictly on-axis) would make H/V handles feel broken.

- **Z updates pen to subpath start.** After Z, the pen logically returns to the most recent M's target position. A following relative command like `l 5 5` should start from that subpath start, not from the Z's no-endpoint position. Pinned by `Z updates pen position to subpath start` which uses a relative `l` after Z and verifies the endpoint is computed from the subpath start (not from somewhere else in the path).

- **Multiple subpaths each have their own start.** `M 0 0 L 10 10 Z M 100 100 L 110 110 Z l 5 5` has two subpaths. After the second Z, the pen is at the second subpath's start (100, 100), so the final relative `l 5 5` computes to (105, 105). Pinned by `tracks subpath start across multiple M commands`. If the subpath-start tracking was per-path (not per-subpath), multi-subpath Z semantics would be wrong.

- **Parse-serialize round-trip is lossless.** `round-trips through parser losslessly` pins that `_parsePathData(_serializePathData(parsed))` produces the same command array. Matters because drag dispatch goes through this round-trip on every pointermove (parse on snapshot, serialize on apply). If round-tripping lost precision or reordered commands, paths would subtly drift over extended edit sessions.

- **Parser failure silent.** Malformed `d` attributes return empty arrays. Handle rendering then emits zero handles — user sees no drag affordances for the broken path but the rest of the editor works. Alternative (throw) would strand the whole viewer on a single broken file. Pinned by `returns empty array on malformed input`.

- **3.2c.3b-i deliberately excludes control points.** C/S/Q/T handles render their endpoint only for now — 3.2c.3b-ii will add handles for the control points (C gets two extra, S/Q get one, T gets none because it's a reflected quadratic). The dispatch code in `_applyPathEndpointResize` has TODO-free switch cases for all command types including curves, so adding control-point handles in 3.2c.3b-ii only needs new role format (e.g. `c{N}-1`, `c{N}-2`) and new dispatch math — no refactor of the existing endpoint code.

Path endpoint editing complete for straight-line commands. 3.2c.3b-ii will add C/S/Q/T control-point handles; 3.2c.3b-iii will add A arc endpoint handles (arc shape parameters — rx, ry, rotation, flags — stay as-is, draggable arc endpoints move the arc while preserving its shape).

### 5.17 — Phase 3.2c.3a SvgEditor polyline/polygon vertex edit — **delivered**

Polylines and polygons get one draggable handle per vertex. Each handle moves a single point; other vertices stay put. Reuses the resize-drag machinery with two new snapshot kinds (`polyline-vertices` / `polygon-vertices`) and one new dispatch (`_applyVertexResize`). Path vertex handles deferred to 3.2c.3b where the `d`-attribute parser lives.

- `webapp/src/svg-editor.js` — additions:
  - `_renderResizeHandles` — new `polyline` / `polygon` branch. Parses the `points` attribute via `_parsePoints`, emits one handle dot per vertex with role `v{N}`. Handle position is the vertex coordinate verbatim — same reasoning as line endpoint handles: bbox-corner handles would be the wrong drag targets on non-rectangular shapes.
  - `_captureResizeAttributes` — new `polyline` / `polygon` cases producing `{kind: 'polyline-vertices', points: [...]}` or `{kind: 'polygon-vertices', ...}`. Kinds distinct from the move-drag `'points'` kind in `_captureDragAttributes` so dispatch branches never collide.
  - `_applyResizeDelta` — new `polyline-vertices` / `polygon-vertices` → `_applyVertexResize`.
  - New method `_applyVertexResize(el, o, role, dx, dy)`. Parses the role via `parseInt(role.slice(1), 10)`. Validates the index bounds. Clones the snapshot's points array and updates only the Nth point, leaving others unchanged. Serializes with the canonical `x,y` form (comma between components, space between points) matching the move-drag output.
  - `_restoreResizeAttributes` — new `polyline-vertices` / `polygon-vertices` cases restoring the `points` attribute from the snapshot.

- `webapp/src/svg-editor.test.js` — 1 existing test updated plus 16 new tests:
  - Updated: `polyline selection produces no resize handles` → `polyline selection produces one handle per vertex`. Previously scoped to 3.2c.2b; now flipped.
  - **Handle rendering** (2 tests): polyline produces N vertex handles at actual vertex coords (not bbox corners); polygon produces N vertex handles with sequential roles v0..v{N-1}.
  - **Per-vertex dispatch** (4 tests): v0 / v1 / v2 each move only their own vertex, leaving others unchanged. Polygon variant proves the dispatch works regardless of shape.
  - **No clamping** (1 test): dragging one vertex onto another produces coincident vertices — legal SVG (a zero-length edge renders invisibly), fully recoverable.
  - **Separator normalization** (1 test): input with mixed comma-space separators normalizes to canonical `x,y` form on output. Matches the move-drag path's behavior.
  - **Origin-relative deltas** (1 test): repeated pointermoves recompute from snapshot, not from previous position — prevents runaway compounding.
  - **Negative deltas** (1 test): leftward / upward vertex drags work symmetrically with rightward / downward.
  - **Lifecycle** (3 tests for polyline, 1 for polygon): clicking a vertex handle starts a resize drag with the correct kind + role; onChange fires after committed drag; tiny move below threshold doesn't commit; detach rolls back all points.
  - **Defensive error paths** (2 tests): malformed role (not `v{N}`) is a no-op; out-of-range index (e.g., `v99` on a 2-point polyline) is a no-op. Shouldn't happen in practice because roles come from our own handle rendering, but defensive against future refactors that might feed a snapshot from an external source.

Design points pinned by tests:

- **Origin-relative delta application.** `handles repeated pointermoves relative to origin` pins the invariant: every pointermove recomputes the Nth point from the snapshot, never from the previous move's result. Mirrors the move-drag's compounding prevention from 3.2c.2a. If this broke, dragging a vertex would produce exponential movement (each frame applying its delta on top of the previous delta's mutation), and the handle would fly away from the pointer.

- **Canonical output format regardless of input.** `handles comma-space-mixed input by normalizing on output` pins that input format variety doesn't contaminate output. SVG accepts many separator forms (`x,y` / `x y` / `x, y` / `x , y`); `_parsePoints` handles all of them. Re-serialization uses `x,y` with single space between pairs — same format the move-drag produces, so re-serialised polylines are visually stable across edit operations.

- **Defensive bounds checking.** `ignores out-of-range vertex index` and `ignores malformed role` both exercise the parseInt / validation paths. These shouldn't fire in production (roles come from our own handle rendering), but if a future refactor introduced a dispatch from an external source (e.g., undo-stack replay), a malformed role would silently corrupt the points attribute without the guards. Treating the invalid case as a no-op means the drag completes cleanly and the user's work isn't lost.

- **Snapshot kinds distinct per shape.** The polygon case uses `polygon-vertices` rather than `polyline-vertices` even though the serialization logic is identical. Keeping them separate matches the pattern established by `line-endpoints` vs `line` (the move-drag kind) — dispatch branches in `_applyResizeDelta` and `_restoreResizeAttributes` read cleanly without inspecting drag mode. If a future rendering difference emerges (e.g., polygons need implicit-close handling in some edge case), the dispatch already has a dedicated branch.

Phase 3.2c.3a is complete. 3.2c.3b adds path vertex editing (requires parsing the `d` attribute into command objects — M/L/H/V/C/S/Q/T/A/Z — and producing draggable handles at each command's endpoint and control points). 3.2c.3c adds inline text editing via foreignObject textarea on double-click.

### 5.16 — Phase 3.2c.2c SvgEditor line endpoint drag — **delivered**

Line elements get two handles — one at each endpoint — that drag independently. Closes out the 3.2c.2 resize-handle work. Reuses the `_beginResizeDrag` machinery with a new `line-endpoints` snapshot kind and a `_applyLineEndpointResize` dispatch.

- `webapp/src/svg-editor.js` — additions:
  - `_renderResizeHandles` now handles `line` tag: emits two `_makeHandleDot` instances at `(x1, y1)` and `(x2, y2)` with roles `p1` and `p2`. Reads endpoint coords directly from the element rather than from the bounding box — a diagonal line's handles sit on the line itself, not at the enclosing rect's corners, which would be the wrong drag-target positions.
  - `_captureResizeAttributes` extended with `case 'line'`: snapshot `{kind: 'line-endpoints', x1, y1, x2, y2}`. Kind name chosen not to collide with the existing `'line'` kind in `_captureDragAttributes` (which covers the move-drag case where both endpoints translate together).
  - `_applyResizeDelta` gains a `'line-endpoints'` dispatch branch → `_applyLineEndpointResize`.
  - `_applyLineEndpointResize(el, o, role, dx, dy)` — pure role dispatch. `p1` sets `x1 = o.x1 + dx; y1 = o.y1 + dy`. `p2` sets `x2/y2` similarly. No clamping.
  - `_restoreResizeAttributes` extended with `'line-endpoints'` case — writes all four attributes back. x2/y2 are written even when p1 was dragged (and vice versa), matching the pattern of other shapes' restore which always writes the full snapshot.

- `webapp/src/svg-editor.test.js` — 10 new tests plus one existing test updated:
  - Updated: `line selection produces no resize handles` renamed to `line selection produces two endpoint handles`. The previous behavior (no handles on line) was scoped to 3.2c.2b; this sub-phase reverses that.
  - **Handle positioning** (1 test): handles land at actual `(x1, y1)` and `(x2, y2)` coords for a diagonal line, not at bbox corners.
  - **Per-endpoint dispatch** (2 tests): p1 drag moves x1/y1 only (x2/y2 unchanged); p2 drag moves x2/y2 only (x1/y1 unchanged).
  - **No clamping** (2 tests): p1 dragged past p2 works without mutation; p1 dragged exactly onto p2 produces a degenerate zero-length line (legal SVG, renders invisible, handles remain grabbable).
  - **Negative deltas** (1 test): endpoints handle leftward/upward drags symmetrically with the rightward/downward cases.
  - **Lifecycle** (4 tests): clicking a `p1` handle initiates resize drag with correct role + snapshot kind; onChange fires after a committed p2 drag; tiny p1 move below threshold doesn't commit; detach mid-drag restores all four attributes (including the ones that shouldn't have changed — the restore path is consistent).

Design points pinned by tests:

- **No clamping.** `dragging p1 past p2 is allowed` pins that lines aren't clamped. Rects and ellipses clamp at 1 to prevent flipping (a flipped shape would leave the user holding the wrong handle mid-drag and the visual would be broken). Lines have no "front face" that flips — a line from (80, 80) to (50, 50) renders identically to one from (50, 50) to (80, 80), and the handles move with their endpoint coordinates regardless of ordering. Trying to clamp would complicate the code for no user-visible benefit.

- **Degenerate line allowed.** `dragging to same point produces degenerate line` pins that a zero-length line is legal and recoverable. Handles at identical coordinates visually overlap but both remain grabbable (the top handle wins the click; the user can drag it off to separate them). Unlike a zero-width rect (which would hide all 8 handles and strand the user), a zero-length line only loses visibility of the rendered stroke — the handle overlay stays at the point.

- **Endpoints read from attributes, not bounding box.** `handles positioned at actual endpoint coords` pins this explicitly with a diagonal line where bbox corners differ from endpoint coords. If this invariant broke (e.g., someone "simplified" by treating line handles like rect corners), the user would see handles floating in empty space next to the line — frustrating and inverse math would be needed to translate bbox-corner drags back to endpoint coords.

- **Snapshot kind distinct from move-drag kind.** The `_captureDragAttributes` path already uses `kind: 'line'` for the move case where the drag translates both endpoints together. Endpoint resize uses `kind: 'line-endpoints'` to keep the dispatch branches in `_applyResizeDelta` and `_restoreResizeAttributes` from colliding with the move-drag handlers. Pinned by `editor._drag.originAttrs.kind` equality in the click-starts-drag test.

Phase 3.2c.2 (resize handles for rect/circle/ellipse/line) is now complete. Ready to proceed to 3.2c.3 — vertex edit for polylines/polygons/paths plus inline text editing via foreignObject textarea.

### 5.15 — Phase 3.2c.2b SvgEditor resize handles — **delivered**

Adds corner/edge resize handles for rect, circle, and ellipse on top of 3.2c.2a's drag-to-move. Rect gets eight handles (four corners + four edges), circle and ellipse get four cardinal handles. Per-handle drag math pins the opposite corner/edge. Width/height/r/rx/ry clamped to a positive minimum so dragging past the opposite edge collapses to a small shape rather than flipping.

- `webapp/src/svg-editor.js` — additions:
  - `HANDLE_ROLE_ATTR = 'data-handle-role'` — dataset attribute name carrying the handle's compass direction. `nw`/`n`/`ne`/`e`/`se`/`s`/`sw`/`w` for rects; `n`/`e`/`s`/`w` for circles/ellipses.
  - `_MIN_RESIZE_DIMENSION = 1` — SVG-unit floor. A drag past the opposite edge clamps to this rather than producing a negative dimension (which renders as a flipped shape in most browsers but is confusing — which handle is the user now holding?).
  - `_renderResizeHandles(group, el, bbox)` — dispatches by tag. Rect emits eight handles at the bbox corners + edge midpoints. Circle and ellipse emit four cardinal handles. Other tags emit nothing (line endpoints land in 3.2c.2c; polyline/polygon/path vertices in 3.2c.3).
  - `_makeHandleDot(cx, cy, role)` — factory. Produces a `<circle>` with the shared `HANDLE_CLASS`, the role attribute, `pointer-events: auto` (opting back in from the group's `none`), accent-blue fill + white stroke. Radius from `_getHandleRadius()` so handles stay visually ~6px regardless of zoom.
  - `_drag` gained a `mode` field (`'move'` or `'resize'`) and a `role` field (resize only). `_onPointerMove` dispatches by mode; `_cancelDrag` dispatches the restore call likewise.
  - `_hitTestHandle(clientX, clientY)` — composed-aware `elementsFromPoint` walker that filters FOR handles rather than against them (the inverse of `_hitTest`). Returns the role string of the topmost handle under the pointer, or null.
  - `_onPointerDown` runs handle hit-test FIRST when something is selected. A handle hit starts resize drag; otherwise the normal select/move-drag flow proceeds. Guarded on `_selected` so a fresh click on an unselected shape can never accidentally start a resize.
  - `_beginResizeDrag(event, role)` — snapshots dimensional attributes via `_captureResizeAttributes`, captures pointer, sets `_drag.mode = 'resize'` with the role.
  - `_captureResizeAttributes(el)` — per-shape snapshot: rect captures x/y/width/height; circle captures cx/cy/r; ellipse captures cx/cy/rx/ry. Unknown tags return null (defensive — shouldn't reach here because handles are shape-specific).
  - `_applyResizeDelta(dx, dy)` — dispatches to `_applyRectResize`, `_applyCircleResize`, or `_applyEllipseResize`.
  - `_applyRectResize(el, o, role, dx, dy)` — role-based dispatch. Corners (nw/ne/se/sw) affect both axes; edges (n/e/s/w) affect one. Clamp applies to width/height; when the clamp fires AND the role is position-moving (w/nw/sw for x, n/nw/ne for y), the position is pinned so the opposite edge stays put. Without the pin, clamping width to `_MIN_RESIZE_DIMENSION` would leave x tracking the pointer and the shape would walk off-screen.
  - `_applyCircleResize(el, o, dx, dy)` — all four handles set radius = `hypot(pointer - center)`. Clamp to min.
  - `_applyEllipseResize(el, o, role, dx, dy)` — n/s handles set `ry = abs(pointer_y - cy)`; e/w handles set `rx = abs(pointer_x - cx)`. Center unchanged. Clamp to min.
  - `_restoreResizeAttributes(el, snapshot)` — mirror for cancel path.

- `webapp/src/svg-editor.test.js` — 46 new tests across 10 describe blocks:
  - **Handle rendering** (12 tests): rect produces eight handles, all compass directions present, handle positions match bbox corners + edge midpoints (NW at x/y, SE at x+width/y+height, etc.), circle produces four, ellipse produces four, line/polyline/path produce none, handles opt into pointer events, handles carry the shared class, handles replaced on reselection, clearing selection removes handles.
  - **Handle hit-test routing** (6 tests): clicking a handle starts resize drag with the correct role, handle click does NOT initiate the move-drag flow (verified by spying on `_hitTest` and asserting it's not called), handle hit-test only runs when there's a selection, `_hitTestHandle` returns null when no handle under pointer, returns role when a real handle is under the pointer, stops propagation on handle hit.
  - **Rect corners** (4 tests): se corner grows w/h; nw corner moves x/y AND shrinks w/h; ne moves y + grows w shrinks h; sw moves x + shrinks w grows h.
  - **Rect edges** (4 tests): n moves y + shrinks h; e grows w only; s grows h only; w moves x + shrinks w.
  - **Rect clamping** (3 tests): drag e past left edge clamps width to 1 and leaves x at origin; drag w past right edge clamps width to 1 AND pins x so the right edge (originally at 30) stays at 30 (x = 29); drag n past bottom edge clamps height to 1 and pins y.
  - **Circle** (4 tests): outward drag grows r, inward shrinks, drag through center clamps to 1 (Math.hypot always positive + clamp), any cardinal handle adjusts r (tested with n instead of e).
  - **Ellipse** (5 tests): e handle adjusts rx only, w handle also adjusts rx (abs distance), n handle adjusts ry, rx/ry clamp to 1 when dragged to center, center unchanged during resize.
  - **Lifecycle** (4 tests): onChange fires after committed resize, tiny resize move doesn't commit, detach mid-rect-resize rolls back all four attributes, detach mid-circle-resize restores r, detach mid-ellipse-resize restores rx+ry.

Design points pinned by tests:

- **Clamp AND pin for position-moving handles.** `drag past opposite edge with position-moving handle pins x` verifies that dragging the w handle way past the right edge clamps width to 1 but also freezes x at `original_right_edge - min_width`. Without the pin, x would continue to track the pointer and the shape would walk off the original right edge — confusing behavior. This matters for nw/sw/n/ne too (any corner/edge that normally moves a position attribute).

- **Circle symmetry.** All four cardinal handles use the same formula (radius = distance from center to pointer). `any cardinal handle adjusts the single radius` pins this by using the `n` handle and verifying the same vertical-distance math produces the expected radius. If we ever added per-handle behavior (which would be wrong for circles), this test would catch it.

- **Ellipse axis independence.** `n handle adjusts ry only` and `e handle adjusts rx only` verify that dragging one axis doesn't affect the other. The `other axis unchanged` assertions in each test are the key pin.

- **Handles are shape-specific.** `line selection produces no resize handles` pins that we don't render rect-style 8-handle overlays on non-resizable shapes. Line endpoint handles will land as a separate rendering path in 3.2c.2c.

- **Handle hit-test precedes main hit-test.** `handle click does not initiate move drag` spies on `_hitTest` and asserts it's not called when `_hitTestHandle` returns a role. Order matters: if main hit-test ran first, a click on a handle over the selected rect would initiate a move drag (since the handle is above the rect in the DOM tree). The gate is on `_selected` being non-null — without a selection, there are no handles, so `_hitTestHandle` would waste time walking elements.

- **Clamp floor is a positive value.** `_MIN_RESIZE_DIMENSION = 1` rather than 0 — a zero-width rect is legal SVG but renders as invisible, which would strand the user's resize drag in a state with no visible handle to grab. Positive minimum keeps the shape always-selectable.

Open carried over for 3.2c.2c:

- **Line endpoint drag.** Line elements get two endpoint handles (one at `x1,y1`, one at `x2,y2`). Differs from the bounding-box dragging 3.2c.2a provides because each endpoint moves independently — dragging the x1/y1 handle doesn't move x2/y2. Will reuse the `_beginResizeDrag` machinery with a line-specific dispatch that stores the original x1/y1/x2/y2 and adjusts only the endpoint matching the clicked handle.

### 5.14 — Phase 3.2c.2a SvgEditor drag-to-move — **delivered**

Adds drag-to-move on top of 3.2c.1's foundation. Click a selected element and drag to move it. Per-element attribute dispatch for every supported tag. Pointer capture so drags continue smoothly off the SVG bounds. Click-without-drag threshold prevents spurious mutations from stray pointer jitter.

- `webapp/src/svg-editor.js` — additions:
  - `_drag` state field — `{pointerId, startX, startY, originAttrs, committed}` or null. Populated on pointerdown that hits the already-selected element. Cleared on pointerup or detach.
  - `_dragThresholdScreen = 3` — pixel threshold below which a pointermove is treated as click-with-jitter. Converted to SVG units at runtime via `_screenDistToSvgDist` so zoom doesn't make it too sensitive or insensitive.
  - `attach()` / `detach()` updated — `pointermove`, `pointerup`, `pointercancel` listeners added/removed. `detach()` calls `_cancelDrag()` so a mid-drag detach rolls back to the origin state rather than leaving the element partially moved and the captured pointer orphaned.
  - `_onPointerDown` — two-branch logic. Click on the already-selected element starts drag via `_beginDrag(event)`. Click on a different element (or first click) falls through to `setSelection`. Matches click-to-select-first, click-to-drag convention used by most editors.
  - `_beginDrag(event)` — converts pointer position to SVG root coords via `_screenToSvg`, snapshots current element attributes via `_captureDragAttributes`, calls `setPointerCapture` on the SVG. Wraps the capture call in try/catch — not all environments support it, drag still works via bubbling pointermove even without capture.
  - `_onPointerMove` — guarded by `_drag !== null` and matching pointerId. Computes current SVG position, subtracts start to get delta. Before commit, checks threshold — if both axes under threshold, skip the application. Once committed, every subsequent move applies the delta from origin (not from previous position) so moves never compound.
  - `_onPointerUp` — releases pointer capture, clears `_drag`. Fires `onChange()` callback only if the drag was committed (moved beyond threshold). Click-without-drag produces zero onChange calls, so the viewer doesn't spuriously mark the file dirty when the user just meant to select.
  - `_cancelDrag()` — restores original attributes from snapshot, releases capture, clears `_drag`. Used by `detach()`. Does NOT fire onChange — the caller's intent was to abandon the drag.
  - `_captureDragAttributes(el)` — per-element snapshot dispatch. Returns `{kind, ...fields}` or null. Eight dispatch cases: `rect`/`image`/`use` → `{kind: 'xy', x, y}`; `circle`/`ellipse` → `{kind: 'cxcy', cx, cy}`; `line` → `{kind: 'line', x1, y1, x2, y2}`; `polyline`/`polygon` → `{kind: 'points', points: [[x,y]...]}`; `text` → `{kind: 'xy', x, y}` OR `{kind: 'transform', transform}` depending on whether the element already has a transform attribute; `path`/`g` → `{kind: 'transform', transform}`. Null return for unknown tags — drag silently doesn't start.
  - `_applyDragDelta(dx, dy)` — switches on the snapshot's `kind`, applies the delta. For `xy` / `cxcy` / `line` / `points` the math is direct. For `transform` — appends `translate(dx dy)` to the existing transform. Browsers parse transform chains left-to-right so our translate is applied AFTER any existing rotation/scale, which gives the user-expected visual result ("move the rendered element by dx,dy regardless of rotation").
  - `_restoreDragAttributes(el, snapshot)` — mirror of `_applyDragDelta` that writes the origin values back. For `transform`, removes the attribute entirely if it was empty originally, otherwise writes it back verbatim.
  - Handle overlay re-renders on every committed pointermove via existing `_renderHandles()` call. Bounding box follows the element smoothly during drag.
  - Module-level `_parseNum(value)` helper — SVG-attribute-to-number. Returns 0 for null/missing/non-numeric. Matches browser SVG behavior (which treats missing numeric attributes as 0).
  - Module-level `_parsePoints(value)` helper — parses `points` attribute into `[[x, y], ...]`. Accepts whitespace- and comma-separated tokens and mixes. Returns empty array on odd token count or any non-numeric value — caller emits empty `points` which renders as an empty polyline rather than crashing.

- `webapp/src/svg-editor.test.js` — 36 new tests across 9 describe blocks:
  - `_parseNum` (4 tests): numeric strings, null/missing, non-numeric, scientific notation.
  - `_parsePoints` (6 tests): whitespace-separated, comma-separated, mixed, empty/null, odd tokens, non-numeric.
  - Pointerdown routing (6 tests): click on unselected selects, click on selected starts drag, click on empty doesn't cancel non-existent drag, pointer capture on drag start, graceful failure when `setPointerCapture` throws, unsupported element dispatches to no-op.
  - Threshold (5 tests): tiny pointermove doesn't commit, drag beyond threshold commits, onChange fires only once per drag, pointermove without drag ignored, pointermove with wrong pointerId ignored.
  - Per-element dispatch:
    - `rect` (2 tests): moves x/y, handles negative deltas.
    - `circle` + `ellipse` (2 tests): moves cx/cy, radii unchanged.
    - `line` (1 test): both endpoints move by same delta.
    - `polyline` + `polygon` (3 tests): shifts every point, point separators normalize to `x,y` form on output.
    - `path` + `g` (4 tests): uses transform, preserves existing transform, g uses transform dispatch, path's `d` attribute untouched.
    - `text` (2 tests): uses x/y without existing transform, uses transform dispatch when transform exists.
    - `image` + `use` (2 tests): both use x/y dispatch.
  - Incremental application (1 test): repeated pointermoves compute relative to origin, never compound.
  - Handle tracking (1 test): handle group repositions during drag.
  - Lifecycle (5 tests): pointercancel before commit (no onChange), pointercancel after commit (fires onChange), detach rolls back, detach removes transform when it wasn't there originally, detach restores original transform, pointerup releases pointer capture.

Design points pinned by tests:

- **Click-before-drag convention.** The first click on an element only selects; a SECOND click (while already selected) initiates drag. Pinned by `click on unselected element selects it (no drag)` (no drag after first click) AND `click on already-selected element starts drag` (drag after second click). Prevents accidental drags when the user is scanning elements — a small pointer jitter during a selection click doesn't move the element.

- **Click threshold prevents spurious mutations.** `tiny pointermove does not commit drag` dispatches a 1-pixel pointermove and verifies the element's x attribute is unchanged AND onChange doesn't fire. Without the threshold, every real-world click would produce a 0-pixel mutation and mark the file dirty.

- **Transform append preserves existing transforms.** `path with existing transform preserves it` verifies that dragging a `<path transform="rotate(45 5 5)">` produces `rotate(45 5 5) translate(10 20)` — the rotation is unaffected by the drag. If this broke, users would see their rotated shapes unexpectedly flip during a move.

- **Text attribute auto-detection.** `text without transform uses x/y dispatch` and `text with existing transform uses transform dispatch` prove the two paths. Users dragging a plain text element get clean x/y changes (readable in editor output); users dragging a rotated text element get an additional translate (preserves rotation). The alternative (always use transform) would leave plain text elements with cruft that's harder to hand-edit.

- **Delta from origin, not from previous position.** `repeated pointermoves compute relative to drag origin` pins the invariant by dispatching three pointermoves and asserting the element's final position matches `origin + final_delta`, not `origin + dx1 + dx2 + dx3`. Compounding would make fast drags move the element exponentially further than the pointer.

- **Detach mid-drag rolls back.** `detach during drag rolls back and cancels` verifies that an editor detached mid-drag leaves the element at its original position with no onChange fired. If the rollback were absent, a file-switch or component-unmount during an active drag would leave orphaned partial-move mutations the user didn't intend.

- **Capture failure is non-fatal.** `survives setPointerCapture throwing` pins that a runtime without pointer capture (older browsers, some jsdom environments) still starts the drag. Capture is an enhancement for off-SVG pointer tracking, not a requirement.

Open carried over for 3.2c.2b and 3.2c.2c:

- **3.2c.2b — corner/edge resize handles.** Interactive handles for `rect` (eight handles — four corners and four edges), `circle` (four handles at cardinal points for symmetric resize), `ellipse` (four handles — two for rx, two for ry, independently draggable). Handle's drag math pins the opposite corner — e.g. dragging the top-left corner moves x/y AND adjusts width/height so the bottom-right stays fixed. Needs per-handle data (which corner/edge it represents) in a dataset attribute so the pointermove dispatch knows what to adjust.

- **3.2c.2c — line endpoint drag.** `line` elements get two endpoint handles (one per endpoint) — currently the bounding-box handle doesn't allow independent endpoint drag. Differs from the bounding-box dragging that 3.2c.2a provides because each endpoint moves independently; dragging the x1/y1 handle doesn't move x2/y2.

- **Path vertex handles and inline text editing.** Land with 3.2c.3.

### 5.13 — Phase 3.2c.1 SvgEditor foundation + selection — **delivered**

Introduces the `SvgEditor` class and wires it into the right panel of `SvgViewer`. First sub-phase of 3.2c — foundation layer for visual editing. No move/resize/vertex-edit yet; those come in 3.2c.2. Coexists with pan/zoom — pan/zoom handles viewport navigation, editor handles element selection.

- `webapp/src/svg-editor.js` — new standalone class (not a Lit component). Operates on an externally-provided `<svg>` element. Responsibilities:
  - Pointer-based click hit-testing via `elementsFromPoint` (shadow-DOM aware via `getRootNode().elementsFromPoint`). Filters out handle overlay (`svg-editor-handle` class, `svg-editor-handles` group id), the root SVG itself, non-visual tags (`defs`, `style`, `metadata`, `title`, `desc`, `filter`, gradients, `clipPath`, `mask`, `marker`, `pattern`, `symbol`), and elements outside the SVG subtree.
  - Single-element selection via `setSelection(el)`. Selection fires `onSelectionChange` callback. Same-element no-op.
  - `<tspan>` → parent `<text>` resolution. Click targets inside text runs resolve to the whole text element, not the tspan child.
  - Handle overlay group rendered as `<g id="svg-editor-handles">` at the end of the root SVG. For 3.2c.1 contains only a dashed bounding-box rect; 3.2c.2 will add corner/edge/vertex handles. Group has `pointer-events="none"` so empty-space clicks fall through to content.
  - Coordinate math helpers: `_screenToSvg` (invert CTM), `_localToSvgRoot` (compose inverse of root CTM with element's CTM), `_screenDistToSvgDist` (for handle size constancy under zoom), `_getHandleRadius` (handle visual radius in SVG units).
  - Keyboard: Escape clears selection (only consumes event when something is selected, otherwise lets it pass to textareas). Delete/Backspace remove the selected element (only consumes event when selected).
  - `attach()`/`detach()` — caller owns the lifecycle. Attach is idempotent. Detach clears selection and removes event listeners.
  - `deleteSelection()` — public API for programmatic delete. Fires `onChange` callback.
- `webapp/src/svg-editor.test.js` — 41 tests across 10 describe blocks: construction (requires SVG, accepts SVG, exports constants, exports tag sets), attach/detach (wiring, idempotence, cleanup), setSelection (programmatic, onSelectionChange, clearing, same-element no-op, tspan resolution, non-selectable rejection), handle rendering (group creation, last-child ordering, handle class, clearing on deselect, persistence across selection, re-attach reuses existing group), pointer dispatch (hit-test called, selection on hit, deselect on empty-space, non-primary button ignored, stopPropagation on hit, no stopPropagation on miss), hit-test filtering (handle class, handle group id, root SVG, non-selectable tags, tspan resolution, outside-SVG elements), keyboard (Escape clears, Escape no-op without selection, Delete removes, Backspace removes, Delete without selection doesn't preventDefault, onChange fires, detached editor ignores keys), deleteSelection (removes element, clears selection, no-op without selection, fires onSelectionChange), coordinate helpers (identity CTM pass-through, positive distances, handle radius positive).
- `webapp/src/svg-viewer.js` — integration:
  - Import `SvgEditor`
  - `_editor` field, `_onEditorChange` bound handler in constructor
  - `_initEditor(rightSvg)` called after `_initPanZoom` in `_injectSvgContent` — creates editor on the right panel's SVG
  - `_disposeEditor()` — detaches and nulls. Called before re-injection, on component disconnect, and as part of file close/switch flow
  - `_onEditorChange()` — temporarily removes the handle group from the right panel's SVG before reading `innerHTML`, restores in a `finally`. Updates `file.modified` and recomputes dirty count. Keeps `_lastRightContent` in sync so the next file-switch injection doesn't treat the just-read content as "changed"
- `webapp/src/svg-viewer.test.js` — new `SvgViewer SvgEditor integration` describe block with 8 tests: editor created on open, editor's root is the right panel's SVG (not left), editor disposed on close, editor disposed+recreated on file switch, editor disposed on disconnect, change callback syncs modified content, handle group stripped from serialized content, editor init failure doesn't break viewer.

Design points pinned by tests:

- **Editor and pan-zoom coexist on the right panel.** Pan-zoom handles wheel zoom and drag-on-empty-space panning; the editor handles element selection. The editor's `pointerdown` handler stops propagation when it hits a real element, preventing pan-zoom from initiating a pan. Empty-space clicks (hit test returns null) don't stop propagation, letting pan-zoom take over. Pinned by `stops propagation on element hit` and `does not stop propagation on empty-space click`.

- **tspan → text resolution is both in hit-test AND setSelection.** The hit-test resolution catches pointer events; the setSelection resolution catches programmatic calls (e.g., from a future "select by ID" feature or a load-selection-from-undo-stack flow). Pinned by `tspan selection resolves to parent text` (programmatic) and `resolves tspan to parent text` (hit-test).

- **Handle group is stripped from saved content.** Serializing `innerHTML` would otherwise leak `<g id="svg-editor-handles">...</g>` into the file. The `_onEditorChange` handler temporarily removes the group, reads innerHTML, then restores. Pinned by `editor change strips handle group from serialized content` which verifies both that the saved content is clean AND that the handle group is back in the live DOM.

- **Non-selectable tags are filtered at both hit-test AND setSelection.** `defs`, `style`, `filter`, gradients — clicking one silently resolves to null (or to a parent selectable if any). Setting one programmatically also yields null. Pinned by `non-selectable element selection returns null` and `skips non-selectable tags` (hit-test).

- **Editor failure is isolated.** `_initEditor` wraps construction in try/catch and leaves `_editor = null` on failure. The viewer continues to function (pan/zoom still works, save/close still work). No explicit test forces the failure (would require module-level SvgEditor mock), but the pattern is documented in code and in the `editor init failure does not break viewer` regression test.

- **Delete is keyboard-scoped.** Pressing Delete while a textarea is focused (and nothing is selected in the editor) does NOT get preventDefault — the event flows to the textarea. The editor only consumes Delete when it has something to delete. Pinned by `Delete without selection does not consume the event`.

- **Handle group is pointer-events: none.** Otherwise clicks on the bounding-box rect would land on the handle instead of falling through to the element. For 3.2c.2's interactive handles (corner drag, vertex drag), individual handle elements will opt back in via their own `pointer-events="auto"`.

Open carried over for later sub-phases:

- **3.2c.2 — move + resize.** Drag-to-move for all visible elements. Corner and edge handles for rect/circle/ellipse resize. Line endpoint handles for `<line>`. Needs pointer capture for smooth drag; needs coordinate conversion in the drag handler (start pos in local coords, delta applied to attributes). Will need per-element dispatch (rect uses x/y/width/height; circle uses cx/cy/r; ellipse uses cx/cy/rx/ry; line uses x1/y1/x2/y2; paths and polys use transform attribute).
- **3.2c.3 — vertex edit + inline text.** Per-vertex handles for polylines/polygons (each point draggable independently). Path command parsing (`M/L/C/Q/Z` etc.) to surface drag-able control points for cubic and quadratic beziers. `<foreignObject>` textarea for inline text editing on double-click.
- **3.2c.4 — multi-selection + marquee.** Shift+click toggle into a Set of selected elements. Marquee-drag on empty space: forward drag (top-left to bottom-right) = containment mode (only fully-inside elements); reverse drag = crossing mode (any-intersection). Group drag applies delta to every selected element.
- **3.2c.5 — undo stack + copy/paste.** Snapshot the SVG innerHTML before every mutation, bounded to 50 entries. Ctrl+Z pops and re-injects. Ctrl+C/V clone selected element(s) with a slight offset. Ctrl+D duplicates in place.

### 5.12 — Phase 3.2b SVG pan/zoom — **delivered**

Adds `svg-pan-zoom` library integration so both panels' viewports move in lockstep, mouse wheel zooms centered on cursor, and a floating fit button re-centers after manipulation. Preserves all of 3.2a's surface — no public API changes.

- `webapp/package.json` — added `svg-pan-zoom ^3.6.2`. Pure JS, ~20KB minified. MIT license.

- `webapp/src/svg-viewer.js` additions:
  - Module-level import of `svgPanZoom` factory.
  - `_PAN_ZOOM_OPTIONS` frozen constant — shared config for both panels. `panEnabled: true`, `zoomEnabled: true`, `mouseWheelZoomEnabled: true`, `dblClickZoomEnabled: true`, `preventMouseEventsDefault: true`, `zoomScaleSensitivity: 0.2`, `minZoom: 0.1`, `maxZoom: 10`, `fit: true`, `center: true`, `controlIconsEnabled: false` (we render our own fit button).
  - Constructor fields — `_panZoomLeft`, `_panZoomRight` (instance refs, null when no file open), `_syncingPanZoom` (boolean mutex). Bound handlers `_onLeftPan`, `_onLeftZoom`, `_onRightPan`, `_onRightZoom`, `_onFitClick`.
  - `_injectSvgContent` now tracks whether either side's content changed. On change, sets `preserveAspectRatio="none"` on the right panel's root SVG (per specs4 — the future 3.2c editor needs sole viewBox authority; left panel keeps browser default for the read-only reference). Calls `_initPanZoom` after attribute application.
  - `_initPanZoom(leftContainer, rightContainer)` — tears down existing instances first (via `_disposePanZoom`), then wraps each `svgPanZoom` construction in try/catch. Each side gets the other side as its sync target via the bound `onPan`/`onZoom` callbacks. Failures are logged and leave the corresponding instance ref as null — keeps the viewer working even when the library can't initialise (e.g., malformed SVG).
  - `_disposePanZoom` — null-safe, wraps `destroy()` in try/catch so a throwing destroy (already-destroyed, detached DOM) doesn't break close/switch flows.
  - Sync callback pattern — `_onLeftPan(newPan)` checks the guard, sets it, calls `rightPanZoom.pan(newPan)` in a try/finally that always clears the guard. Symmetric for zoom and for the right→left direction. The guard is also held around the mirror call so when the library internally fires `onPan` on the mirrored panel as part of its `.pan()` implementation, the callback short-circuits on the guard check and doesn't cascade back.
  - `_onFitClick` — calls `resize()` + `fit()` + `center()` on both panels, all within a single sync-guard scope. `resize()` ensures the library picks up current container dimensions (the dialog may have been resized since the last init). The guard scope covers the whole fit operation so callbacks from one panel's reset don't trigger the other panel to mirror back mid-reset.
  - Fit button rendered alongside the status LED in the bottom-right corner — `position: absolute`, 28×28px, backdrop-blur, matching visual language to the LED. `⊡` glyph for "fit to view". Hidden in empty state (no files open).

- `webapp/src/svg-viewer.test.js` additions:
  - Module-level `vi.mock('svg-pan-zoom', ...)` with a factory that records every construction. Each instance exposes spies for `pan`, `zoom`, `fit`, `center`, `resize`, `destroy` plus `options` (to drive callbacks) and `element` (to verify wiring). Factory has `_instances` array and `_reset()` helper used by `beforeEach`/`afterEach`.
  - Four new describe blocks, 21 tests total:
    - **Pan/zoom initialization** (5 tests) — one instance per panel, different SVG elements wired, `preserveAspectRatio="none"` only on right, documented options applied, onPan/onZoom callbacks registered.
    - **Pan/zoom synchronization** (6 tests) — left→right mirror (pan + zoom), right→left mirror (pan + zoom), guard prevents ping-pong via simulated reentrant callback, sync no-op when counterpart instance is null.
    - **Fit button** (6 tests) — renders when file open, hidden in empty state, click fires fit+center on both, click fires resize too, click doesn't trigger feedback loop (verified via simulated onPan/onZoom from inside the mocked fit), click with null instances is safe.
    - **Pan/zoom disposal** (5 tests) — disposed on last file close, disposed+recreated on file switch, disposed on component disconnect, disposed on refreshOpenFiles, throwing destroy handled gracefully.

Design points pinned by tests:

- **`preserveAspectRatio="none"` asymmetry.** Right panel gets the attribute; left panel does not. Pinned by `test_applies_preserveAspectRatio_none_only_to_right_panel`. When 3.2c's SvgEditor lands, the editor manipulates the right panel's viewBox directly; browser-side aspect fitting would fight that math. Left panel stays default because it's a read-only reference — the browser's default fitting centers the SVG in its pane, which is what the user wants for comparison.
- **Sync guard is test-verifiable via simulated reentrance.** The library's real behaviour is that calling `.pan()` on one instance fires that instance's `onPan` callback after the pan completes. Tests simulate this by making a mocked `pan()` invoke the instance's `options.onPan` from inside the mock — if the guard is broken, the callback cascades back and calls the other instance's `pan` again, which the test catches via a `reentered` boolean flag. Caught a subtle sequencing bug in the initial implementation where the guard was set after the mirror call; now set before and cleared in `finally`.
- **Fit button calls `resize()` before `fit()`.** `resize()` is the library's mechanism for picking up changed container dimensions. Without it, fit computes against stale container size if the dialog was resized between open and fit-click. Pinned by `test_click_also_calls_resize_on_both_panels`.
- **Disposal on refresh, not just close.** `refreshOpenFiles` sets `_lastLeftContent = null` / `_lastRightContent = null` which forces `_injectSvgContent` to treat content as changed on the next call, which triggers `_initPanZoom` which calls `_disposePanZoom` first. Pinned by `test_disposes_instances_on_refreshOpenFiles` — ensures the indirect path still reaches disposal even though `refreshOpenFiles` doesn't call `_disposePanZoom` directly.
- **Throwing destroy is survivable.** The `svg-pan-zoom` library throws from `destroy()` when called twice, or when the underlying SVG has been detached from the DOM. Both cases can happen during rapid file switches or component unmounts. `_disposePanZoom` wraps each destroy in try/catch so the instance refs always get nulled out regardless. Pinned by `test_handles_destroy_throwing_gracefully`.

Notes from delivery:

- **Vitest hoists `vi.mock()` above imports.** The test file reads top-to-bottom with `vi.mock('svg-pan-zoom', ...)` before `import './svg-viewer.js'`, but vitest's transform hoists mock declarations above all imports regardless of source position. This means the svg-viewer module, when loaded, sees the mocked factory — no circular-import gymnastics needed.
- **Mock factory resets via `_reset()` helper.** Per-test cleanup needs to both clear the `_instances` array and reset the `mockClear()` state. The `_reset` helper handles both; called in the top-level `beforeEach`/`afterEach` alongside RPC cleanup. Without the reset, instance counts from previous tests would leak into `svgPanZoom._instances.length` assertions in later tests.
- **`fit: true, center: true` at init.** The library's built-in fit-on-init does what we want for first render — initial SVG appears sized and centered in its panel. This means we don't need to manually fit after init in production; the fit button is for *re-fitting* after the user has panned/zoomed, not for the initial view.
- **Control icons deliberately disabled.** `controlIconsEnabled: false` in `_PAN_ZOOM_OPTIONS` suppresses the library's built-in zoom in / zoom out / reset buttons. They'd conflict visually with the status LED (which is in the same corner area) and don't match the app's minimal chrome design. Our floating fit button serves the reset-view role; mouse wheel covers zoom.
- **Zoom bounds chosen to match specs4.** `minZoom: 0.1` (10× zoomed out) and `maxZoom: 10` (10× zoomed in) — covers the practical range for architecture diagrams and flowcharts. Going below 0.1 makes SVGs unreadable; going above 10 hits rendering fidelity limits in most SVG viewers.

Open carried over for later sub-phases:

- **3.2c — `SvgEditor` visual editing.** Visual editing surface for the right panel. Multi-selection, drag-to-move, corner-handle resize, vertex-handle edit for polylines/polygons/paths, inline text edit via `foreignObject` textarea, marquee selection with containment / crossing modes, path command parsing for bezier/quadratic/line handles, undo stack (50 snapshots), coordinate math (screen → SVG root → element-local via getScreenCTM inversion), handle rendering as a separate `<g>` with dataset markers for hit-test exclusion. Will need to hook into the pan/zoom's current transform to compute correct coordinates — the library exposes `getZoom()` and `getPan()` for this. The `preserveAspectRatio="none"` already set on the right panel means viewBox manipulation works cleanly. Likely needs its own sub-sub-splits.
- **3.2d — presentation mode, context menu, copy-as-PNG.** F11 toggle for full-width editor, right-click context menu with copy-as-PNG item, `toggle-svg-mode` event dispatch for switching to the diff viewer's text view, and the reciprocal `🎨 Visual` button on the diff viewer side.
- **3.2e — embedded image resolution.** PDF/PPTX-converted SVGs reference sibling raster images via `<image href="...">`. Fetch via `Repo.get_file_base64` and rewrite hrefs in-place. Parallel to the diff viewer's markdown preview image resolution (Phase 3.1b).

### 5.11 — Phase 3.2a SVG viewer lifecycle — **delivered**

Replaces the Phase 3 groundwork stub with a real side-by-side SVG viewer. Lifecycle surface mirrors the diff viewer — multi-file tracking, content fetching via Repo RPCs, dirty tracking, save pipeline, status LED, keyboard shortcuts. No pan/zoom yet (3.2b), no visual editing (3.2c), no copy-as-PNG (3.2d), no embedded image resolution (3.2e).

- `webapp/src/svg-viewer.js` — `SvgViewer` LitElement. Same public API as `DiffViewer` — `openFile`, `closeFile`, `refreshOpenFiles`, `getDirtyFiles`, `saveAll`, `hasOpenFiles`. Fires `active-file-changed` + `file-saved` events with `bubbles: composed`. Renders side-by-side panels with "Original" (left, HEAD) and "Modified" (right, working copy) labels. Status LED in top-right corner with clean / dirty / new-file states, click-to-save affordance.
- **`innerHTML` injection after Lit commits template.** Lit doesn't natively support raw SVG string injection (it would HTML-escape the content). `updated()` lifecycle hook queries the pane containers and sets `innerHTML` directly. A content cache (`_lastLeftContent` / `_lastRightContent`) skips reassignments when nothing changed — without this, every property update would force a full SVG re-parse and visual flash. Matches the approach specs4/5-webapp/svg-viewer.md documents for the production viewer.
- **Content is text, not base64.** SVG is XML. Fetched via `Repo.get_file_content` (same as the diff viewer does for text files), NOT `Repo.get_file_base64`. base64 is for rendering images where we don't need the source; editing SVG requires the XML verbatim.
- **Empty-content fallback SVG.** When a panel has no content (e.g., new files where HEAD is absent), a minimal valid SVG is injected instead. Keeps the panel from collapsing visually and lets DOMParser succeed on both sides so future passes can assume a consistent parsed tree.
- **Dirty tracking is external-driven.** 3.2a has no editor. The working-copy content can only change when an external caller mutates `this._files[i].modified` (the future `SvgEditor` commit). The public test surface calls `el._recomputeDirtyCount()` after mutating `.modified` directly; in production, `SvgEditor` will dispatch a content-change event that the viewer subscribes to.
- **Status LED matches the diff viewer visually.** Same three states, same CSS classes, same pulse animation on dirty. Keeps the two viewers consistent when the app shell toggles between them based on file extension.
- **Concurrent-openFile guard.** Same pattern as diff viewer — `_openingPath` field drops duplicate async calls for the same path. Opening a different file while another is still loading proceeds independently.
- **Keyboard shortcuts.** Ctrl+S (save), Ctrl+W (close), Ctrl+PageDown (next), Ctrl+PageUp (previous). Same `composedPath` guard as diff viewer — shortcuts fire only when focus is inside the viewer.
- **SharedRpc override pattern.** `globalThis.__sharedRpcOverride` injection lets tests provide a fake proxy without mocking the SharedRpc module. Production reads from SharedRpc via the same helper.

- `webapp/src/svg-viewer.test.js` — 50+ tests across 9 describe blocks replacing the 15-test stub suite. Covers initial state (empty watermark, no files, no split container), openFile lifecycle (events fire, panes render with labels, HEAD + working fetched, missing HEAD → isNew, missing working → empty, no RPC graceful, same-file no-op, multi-file switching, malformed input rejected, concurrent same-path + different-path), SVG injection (both panes populated with fetched content, empty fallback with viewBox, re-injects on file switch), closeFile (last file clears state, switches to next, inactive close preserves active, unknown no-op), dirty tracking (clean after open, dirty after external mutation, save clears + fires event with content, saveAll), status LED (all three classes, click-to-save, tooltip reflects path), keyboard shortcuts (all four, non-Ctrl ignored, outside focus ignored), refreshOpenFiles (re-fetches all), event composition (bubbles across shadow DOM, close carries null path).

Design points pinned by tests:

- **Same-file open is a no-op even when re-invoked.** `test_same_file_open_is_a_no_op` pins this because openFile is async and it's easy for a future refactor to drop the early-return check. Without it, every re-open would fire active-file-changed, re-fetch content, re-inject SVG — all wasted work.
- **External content mutation triggers LED update via `_recomputeDirtyCount`.** `test_shows_dirty_after_external_content_change` asserts the LED reflects the change after the caller mutates `.modified` and explicitly calls recompute. In 3.2c when SvgEditor lands, the editor will dispatch events that the viewer catches and calls recompute on; until then, the explicit call makes the dirty-tracking path observable.
- **Status LED is click-to-save, not click-to-open.** Clicking a clean LED is a no-op — the point of the LED is to surface an action (save pending work) or state (clean / new-file), not to re-trigger anything.
- **Keyboard shortcut focus guard is `composedPath()`-based.** Events fired on document.body without the viewer in the composed path are ignored. Prevents shortcut hijacking when focus is in an unrelated part of the page (e.g., chat panel).
- **Close-inactive-file doesn't fire active-file-changed.** Closing a sibling file while another remains active shifts the underlying `_activeIndex` but doesn't change which file is active. The event fires only when the active-path identity actually changes. Matches the semantics of `active-file-changed` — it signals "which file is now showing", not "the file list was modified". Pinned by `test_closing_inactive_file_does_not_change_active` after a first-run failure caught the unconditional dispatch.

Open carried over for later sub-phases:

- **3.2b — synchronized pan/zoom.** Now scoped and queued as 5.12 above.
- **3.2c — `SvgEditor` visual editing.** The big one. Multi-selection, drag-to-move, corner-handle resize, vertex-handle edit for polylines/polygons/paths, inline text edit via `foreignObject` textarea, marquee selection with containment / crossing modes, path command parsing for bezier/quadratic/line handles, undo stack (50 snapshots), coordinate math (screen → SVG root → element-local via getScreenCTM inversion), handle rendering as a separate `<g>` with dataset markers for hit-test exclusion. Likely needs its own sub-sub-splits.
- **3.2d — presentation mode, context menu, copy-as-PNG.** F11 toggle for full-width editor, right-click context menu with copy-as-PNG item, `toggle-svg-mode` event dispatch for switching to the diff viewer's text view, and the reciprocal `🎨 Visual` button on the diff viewer side.
- **3.2e — embedded image resolution.** PDF/PPTX-converted SVGs reference sibling raster images via `<image href="...">`. Fetch via `Repo.get_file_base64` and rewrite hrefs in-place. Parallel to the diff viewer's markdown preview image resolution (Phase 3.1b).

### 5.10 — Phase 3.1e Markdown link provider — **delivered**

Closes out Phase 3.1. Makes `[text](relative-path)` links Ctrl+clickable inside the Monaco editor for markdown files. Mirrors the preview pane's click-based link navigation (delivered in 3.1b) for users who stay in the source view.

- `webapp/src/markdown-link-provider.js` — pure module with `installMarkdownLinkProvider(monaco, getActivePath, onNavigate)`, `buildMarkdownLinkProvider(getText)`, `buildMarkdownLinkOpener(onNavigate)`, plus helpers `findLinks`, `findLinksInLine`, `buildNavigateUri`, `parseNavigateUri`, `shouldSkip`. Idempotent install guard via module-scoped `WeakSet` (same pattern as `lsp-providers.js`). No Monaco mount required for testing.
- `webapp/src/diff-viewer.js` — imports `installMarkdownLinkProvider`, calls it from `_createEditor` alongside `installLspProviders`. The `onNavigate` callback reads the active file's path via closure, resolves relative paths via the existing `resolveRelativePath` helper, and dispatches `navigate-file` events with `bubbles: true, composed: true` so the app shell's handler catches them.
- `webapp/src/markdown-link-provider.test.js` — 48 tests across 8 describe blocks covering `shouldSkip` (http/data/blob/mailto/tel/protocol-relative/fragment/root-anchored/empty/null → true; relative paths → false), `findLinksInLine` (empty/null handling, simple link, 1-indexed columns, multiple per line, skip absolute URLs, skip fragment-only, accept relative+fragment, accept parent dirs, empty link text, reference-style links skipped), `findLinks` multi-line (line numbers 1-indexed, ac-navigate URI emission, tooltip preservation, mixed absolute+relative filtering, empty-line tolerance), `buildNavigateUri` + `parseNavigateUri` round-trips (path preservation, fragment preservation, Monaco Uri object form, wrong scheme → null, type guards), `buildMarkdownLinkProvider` (callback dispatch, model passthrough, getValue fallback), `buildMarkdownLinkOpener` (ac-navigate dispatch, other schemes pass through, Monaco Uri objects, fragment strip, error swallow, null/undefined guards), and `installMarkdownLinkProvider` (registers for markdown language, registers opener, idempotent, `registerOpener` fallback for older Monaco versions, individual registration failures don't block others).
- `webapp/src/diff-viewer.test.js` — extended Monaco mock with `registerLinkProvider` + `registerEditorOpener`; new `monacoState.linkProviders` and `monacoState.linkOpeners` arrays; `_resetLinkGuard` imported and called in the global `beforeEach`. New `DiffViewer markdown link provider` describe block with 8 integration tests: provider registered on first editor build, opener registered, no re-registration on file switch, opener resolves relative path + dispatches navigate-file with bubbles+composed, opener handles parent-directory references via active-file context, opener ignores non-ac-navigate URIs, opener no-op when no active file, provider finds links in markdown content, provider skips absolute URLs.

Design points pinned by tests:

- **Line-by-line scanning, not multi-line regex.** `findLinks` splits on `\n` and processes each line independently. Alternative (single regex with `gm` flags) would need multi-line handling for line-number computation; line-by-line gives natural 1-indexed line/column construction with no offset bookkeeping.

- **ac-navigate scheme.** Deliberately non-standard (`ac-navigate:///{path}`) so Monaco's default link handler never accidentally hands these to the OS. The scheme is unique to our app; no external URI handler registration could intercept them. Pinned by `test_returns_false_for_wrong_scheme` (the opener doesn't claim non-ac-navigate URIs) and by `test_link_opener_ignores_non-ac-navigate_URIs` (integration test proving fallthrough works).

- **Resolution at click time, not scan time.** The provider emits the verbatim relative path inside the URI; the opener resolves it against the currently-active file's directory when the user clicks. Alternative (pre-resolving during `provideLinks`) would couple the provider to file state and force re-scans on every file switch. Callback-based resolution means the provider is registered once and works across arbitrary file switches.

- **Fragment stripping at open time, not scan time.** The scan preserves fragments in the URI (`buildNavigateUri('x.md#sec')` → `'ac-navigate:///x.md#sec'`) so the tooltip shows them correctly, but the opener strips `#section` before dispatching `navigate-file` because the app shell navigates by path only. A future enhancement could forward the fragment for scroll-to-heading support.

- **Error swallow in the opener.** `onNavigate` wrapped in try/catch — a broken callback shouldn't crash Monaco's opener chain and leave every subsequent link click dead. Debug-log + continue is the right shape here (same pattern as the LSP providers).

- **`registerEditorOpener` vs `registerOpener` fallback.** Some Monaco versions expose `registerEditorOpener`, some expose `registerOpener`. The installer probes both. Covered by `test_falls_back_to_registerOpener_when_registerEditorOpener_is_missing`. If neither is present (very old Monaco), link provider registration still succeeds; clicks fall through to Monaco's default behavior (which tries to open as external URL and fails).

- **Skipping root-anchored paths.** A link like `[root](/docs/spec.md)` is skipped rather than navigated because the repo has no concept of an absolute-root anchor. The preview pane's click handler has the same rule for symmetry.

Open carried over:

- **Forwarding fragments.** Today the opener strips `#section` before dispatch. A future enhancement could forward the fragment to the `navigate-file` event's detail, letting the app shell route to the destination viewer's scroll-to-anchor logic. Not blocking any current flow — users typically navigate to the file and then scroll, which is what the current behavior supports.

### 5.9 — Phase 3.1d LSP integration — **delivered**

Adds four Monaco language-service providers wired to the backend's `Repo.lsp_*` RPCs. Hover, definition, references, completions. Registered once against the `'*'` wildcard selector — one provider per type handles every language, with backend-side dispatch by file extension via the symbol index.

- `webapp/src/lsp-providers.js` — pure provider module. Exports `installLspProviders(monaco, getActivePath, getCall)` (idempotent install with a `monaco.__acDcLspInstalled` guard), four `build*Provider` functions, plus helpers `unwrapEnvelope`, `pathFromModel`, and the test-only `_resetInstallGuard`. Separated from the viewer so the coordinate / path / shape transformation logic is unit-testable without mounting an editor. Mirrors the layering pattern of `markdown-preview.js` and `tex-preview.js`.
- `webapp/src/diff-viewer.js` — imports `installLspProviders`, calls it from `_createEditor` with callbacks that read the currently-active file's path and the SharedRpc call proxy. The install function's guard prevents re-registration across editor recreations and viewer remounts.
- `webapp/src/lsp-providers.test.js` — 68 tests across 8 describe blocks covering `unwrapEnvelope` (null/undefined/primitive/array pass-through, single-key-with-object-inner unwrap, multi-key non-unwrap, primitive-inner non-unwrap, array-inner non-unwrap), `pathFromModel` (leading-slash strip, no-slash pass-through, missing model/uri/path defensive), hover provider (no-path / no-RPC returns null, 1-indexed coordinate passthrough, string-vs-array contents wrapping, empty-string filter, envelope unwrap, RPC error swallow), definition provider (shape validation, snake_case range normalisation, clamp-to-1 for negative/zero coordinates, cross-file URI construction, malformed-payload rejection, envelope unwrap, error swallow), references provider (null → [], non-array → null, malformed entries skipped, envelope unwrap, error swallow), completion provider (trigger character declaration, word-at-position range derivation, fallback empty range, insertText defaults, kind validation + clamping, documentation preservation, malformed entry skip, error swallow), and `installLspProviders` (all four registered, wildcard selector, idempotent, disposable return, null/missing-languages guards, callbacks wired correctly, individual registration failures don't block others).
- `webapp/src/diff-viewer.test.js` — extended with an `LSP integration` describe block: providers installed on first editor build, wildcard selector, not re-registered on file switch, hover dispatches with active path, hover reflects file switches (same provider instance, fresh state per invocation), no-RPC graceful degradation, definition builds cross-file location, references empty for null, completions empty when no active path, install guard survives viewer dispose/reuse cycles.

Design points pinned by tests:

- **Callbacks, not values.** The providers take `getActivePath` and `getCall` as callbacks — not values — because the viewer's state changes across file switches and reconnects, and the providers are registered once. Pinned by `test_hover_provider_reflects_file_switches` which opens two files in sequence and verifies the hover RPC is called with the SECOND file's path.

- **Wildcard registration matches every language.** Single registration of each provider type handles all languages. Backend's symbol index dispatches by file extension; the provider layer doesn't need to know about language IDs at all. Alternative (per-language registration) would require maintaining a list in sync with `monaco-setup.js`'s extension map — more brittle for no benefit.

- **Idempotent install guard lives on the monaco namespace.** `monaco.__acDcLspInstalled` is set on the first install call. Re-calling from a recreated editor, remounted viewer, or any other retry path is a no-op. Pinned by multiple tests — three consecutive installs produce one registration each; viewer dispose/reuse cycles similarly only produce one.

- **Envelope unwrap is heuristic, not universal.** `unwrapEnvelope` unwraps single-key objects only when the inner value is a non-array object. This matches the jrpc-oo envelope shape (UUID → payload object) without clobbering legitimate single-key payloads like `{file: "path"}` (inner is a primitive) or `{items: [1,2,3]}` (inner is an array). Pinned by three explicit tests for the non-unwrap cases.

- **1-indexed coordinates at the RPC boundary.** Monaco's `Position.lineNumber` and `.column` are 1-indexed; specs4's symbol index stores the same. No conversion — providers pass through unchanged. Pinned by `test_calls_RPC_with_active_path_and_1-indexed_position` which asserts the RPC was called with the exact position values.

- **Range field name normalisation.** Backend may return `startLineNumber`/`startColumn` OR `start_line`/`start_column`. Normaliser accepts both shapes. Pinned by `test_normalizes_snake_case_range_fields_from_backend` — matters because different RPC methods in the backend use different naming conventions and the frontend shouldn't care.

- **Clamp to minimum 1 for range coordinates.** Defensive against backend bugs that might emit 0 or negative values. Monaco rejects such ranges silently; clamping produces a valid (1, 1) zero-width range instead.

- **Error swallow with debug log.** Every RPC rejection is caught, logged at debug level, and returns null/empty. Hover popup and completion list continue to function; transient RPC failures don't blow up the editor. Pinned by one error-swallow test per provider.

- **Word-at-position for completion range.** When the user triggers completions mid-identifier, Monaco needs to know what range to replace with the accepted suggestion. `model.getWordUntilPosition` gives the prefix being typed; the provider uses that as the range. Fallback to empty range at cursor when no word is under the cursor (e.g., user typed `.` to trigger completions on a fresh identifier).

- **Kind clamping for completions.** Backend sends integers matching `monaco.languages.CompletionItemKind`. Invalid values (non-numeric, negative, or out of 0-30 range) degrade to `Text` (0). Pinned by `test_clamps_invalid_kind_to_Text_0` with three variants.

Open carried over for later sub-layers:

- **Markdown link provider (3.1e).** Separate Monaco registration for `.md` files that matches `[text](relative-path)` patterns and emits `ac-navigate:///` URIs with a companion LinkOpener intercepting that scheme. The preview pane's click-based link navigation already works (delivered in 3.1b); 3.1e adds the Monaco-side equivalent so Ctrl+click inside the editor also navigates.

### 5.8 — Phase 3.1c TeX preview — **delivered** (see separate commit)

### 5.7 — Phase 3.1a Monaco diff viewer — **delivered**

Replaces the Phase 3 groundwork stub with a real Monaco-based side-by-side diff editor. Core viewer surface — multi-file tracking, content fetching, dirty tracking, save pipeline, status LED, viewport restoration, loadPanel for ad-hoc comparisons, virtual files, keyboard shortcuts. Markdown preview, TeX preview, LSP integration, and markdown link provider deferred to 3.1b–3.1e respectively to keep this commit focused.

- `webapp/package.json` — added `monaco-editor` ^0.52.0 dependency.
- `webapp/src/monaco-setup.js` — new module. Three responsibilities, all executed at module load so they precede any editor construction:
  - `installMonacoWorkerEnvironment()` — configures `self.MonacoEnvironment.getWorker` with a hybrid: real Worker from monaco-editor's ESM build for `editorWorkerService` (required for diff computation), no-op Blob worker for everything else (language services are handled by backend LSP per Layer 3.1d). Guard flag prevents double-install.
  - `registerMatlabLanguage()` — Monaco has no built-in MATLAB. Registers via `monaco.languages.register` + `setMonarchTokensProvider` with a Monarch grammar covering keywords, ~80 common builtins, line + block comments, single and double-quoted strings, numbers (int/float/scientific/complex), operators (arithmetic + element-wise + comparison + logical), and the transpose operator with context-sensitive dispatch. Guard flag prevents double-registration.
  - `languageForPath(path)` — extension-to-language-id map. 40+ extensions mapped. Case-insensitive. Falls back to `plaintext`. `.h` claimed by C (matches the symbol index's convention; mixed-language repos avoid cross-viewer inconsistency).
  - Side-effect invocation of both `installMonacoWorkerEnvironment()` and `registerMatlabLanguage()` at module load. Callers that import this module get both automatically; the `monaco` re-export from this module is the canonical import path so the worker env is always installed first.

- `webapp/src/diff-viewer.js` — complete rewrite from the Phase 3 stub. ~900 lines covering:
  - **Editor reuse.** Single `DiffEditor` instance handles all files. Switching files calls `setModel` with new original/modified models, THEN disposes the old models. Reversing the order throws "TextModel got disposed before DiffEditorWidget model got reset". Editor only fully disposed when the last file closes.
  - **Concurrent-openFile guard.** `_openingPath` field drops duplicate async calls for the same path. Different-path calls proceed independently. Covered by two explicit tests.
  - **Content fetching via SharedRpc.** `_getRpcCall` reads from a `globalThis.__sharedRpcOverride` (test injection) or `SharedRpc.call` (production). Each of HEAD and working-copy fetches is wrapped in its own try/catch so a missing HEAD (new file) or missing working-copy (deleted) doesn't prevent the other from loading. RPC envelope unwrap handles both plain-string and `{content: string}` return shapes plus single-key jrpc-oo envelopes.
  - **Dirty tracking.** Per-file `savedContent` vs current `modified`. Editor's `onDidChangeModelContent` listener updates the file object and bumps a reactive `_dirtyCount`. Virtual and read-only files are never dirty (returns false from `_isDirty`).
  - **Save pipeline.** `_saveFile(path)` reads live content from the editor when the file is active, falls back to the stored `modified` field otherwise. Dispatches `file-saved` (bubbles, composed) with `{path, content, isConfig?, configType?}` — parent routes to Repo write or Settings save. `saveAll()` iterates dirty files in sequence.
  - **Status LED.** Floating overlay button in top-right corner. Three states: clean (green steady), dirty (orange pulsing — click to save), new-file (accent blue). Tooltip adapts to state + file path. Clicking a dirty LED invokes `_saveFile` for the active file.
  - **Viewport state.** `_viewportStates: Map<path, {scrollTop, scrollLeft, lineNumber, column}>` captured before switching away, restored after diff computation settles. `_waitForDiffReady()` registers a one-shot `onDidUpdateDiff` listener with a 2-second fallback timeout (identical-content files never fire the event). Session-only — not persisted. Cleared when the file closes.
  - **loadPanel(content, panel, label).** Three behaviour modes: (a) no files open → create `virtual://compare` with content on the target side; (b) existing `virtual://compare` → update only the target side so both accumulate independently; (c) real file open → overwrite the target panel of that file. Panel labels stored per-file in `_panelLabels` and rendered as floating overlays when non-empty.
  - **Virtual files.** `virtual://` prefix. Content held in `_virtualContents` Map. Never RPC-fetched. Always read-only. Cleared from the map when closed. Used by loadPanel and by Phase 2e.4's history browser's context menu.
  - **Shadow DOM style sync.** Two mechanisms per specs4. `_syncAllStyles()` runs on every editor creation/recreation — removes prior clones (tagged with `data-ac-dc-monaco-clone` attribute via the `_CLONED_STYLE_MARKER` dataset key) and re-clones all current `document.head` styles and linked stylesheets. Full re-sync catches Monaco's synchronous style insertion during construction. `_ensureStyleObserver()` installs a MutationObserver on `document.head` once per component lifetime for styles added/removed after initial construction (e.g., when a new language grammar loads).
  - **Keyboard shortcuts.** Document-level `keydown` listener. Ctrl+S saves active file. Ctrl+W closes active file. Ctrl+PageDown / Ctrl+PageUp cycle through open files. All shortcuts gated on `_eventTargetInsideUs` check (via `composedPath()`) so focus outside the viewer doesn't trigger them.
  - **Code editor service patching.** `monacoEditor._codeEditorService.openCodeEditor` is intercepted so cross-file Go-to-Definition lands files in the tab system rather than spawning a standalone editor. Patch guarded by a component-level `_editorServicePatched` flag — not per-editor, so repeated editor creations don't chain override closures. Specs4 calls this out explicitly.
  - **Search-text scroll.** `_scrollToSearchText(text)` tries progressively shorter prefixes (full text, first two lines, first line only) via `model.findMatches` so whitespace drift between anchor text and file content still locates the edit. Highlighted match gets a `deltaDecorations` call with `isWholeLine: true` + overview-ruler marker, cleared after 3 seconds.

- `webapp/src/diff-viewer.test.js` — rewrite from stub tests. Mocks `monaco-editor` at the module level via `vi.mock` factory. The mock records `createDiffEditor` and `createModel` calls; each editor instance tracks `setModel` / `dispose` / scroll / position / content-listener state. `_simulateContentChange(value)` on a mock editor fires registered content-change listeners so dirty-tracking tests can drive them without a real textarea. `setFakeRpc(handlers)` / `clearFakeRpc()` inject a proxy via `globalThis.__sharedRpcOverride`. 50+ tests across initial state, openFile (dispatch, RPC fetching, HEAD-missing, working-missing, no-RPC, same-file, second-file models, swap models, model disposal, malformed input, concurrent same-path guard, concurrent different-paths), closeFile (editor dispose on last, keep alive for multi-file, activate next, unknown no-op), dirty tracking (not dirty after open, dirty after edit, save clears + dispatches, saveAll), virtual files (explicit content, never dirty, no RPC, cleanup on close), loadPanel (no-files creates compare, accumulates both panels, real file panel update, invalid panel rejected, label stored), viewport state (capture on switch, session-only), refreshOpenFiles (re-fetch real files, skip virtual), status LED (clean/dirty/new-file classes, click saves dirty, click clean is no-op), keyboard shortcuts (Ctrl+S saves, Ctrl+W closes, Ctrl+PageDown/Up cycles, single-file no-op, no-Ctrl no-op, focus-outside no-op), event composition (active-file-changed + file-saved both bubble across shadow).

- `webapp/src/monaco-setup.test.js` — new test file. Mocks monaco-editor at module level (monaco-setup itself imports it). Tests `languageForPath` across every mapped extension, case-insensitivity, extensionless paths, unknown extensions, directory paths, paths-with-dots-in-directories. Tests `installMonacoWorkerEnvironment` idempotence + `MonacoEnvironment` global installation. Tests `registerMatlabLanguage` idempotence + `getLanguages` reflects registration.

- `webapp/src/app-shell.js` — added `_onLoadDiffPanel` handler wired as a `window` event listener. History browser dispatches `load-diff-panel` with `{content, panel, label}`; the app shell flips `_activeViewer` to `'diff'` so the user sees the comparison, then calls `viewer.loadPanel`. Bound handler follows the same add/remove pattern as `_onNavigateFile`.

Design points pinned by tests:

- **Model disposal order is load-bearing.** `test_disposes_old_models_on_swap` verifies dispose is called AFTER the new `setModel` — swapping it around would crash Monaco. The mock's `setModel` stores the new models and `dispose` just flips a flag, so out-of-order disposal would pass the mock but fail in real Monaco. The ordering is enforced in code; the test confirms we're calling dispose at all.

- **Concurrent same-path guard.** `test_concurrent_openFile_for_same_path_drops_the_duplicate` fires two rapid calls for the same path and asserts only one model pair is created. Without the guard, the second call's async fetch would interleave with the first's model construction and leave Monaco in a half-initialized state.

- **RPC errors never propagate out.** HEAD fetch failure (test: `test_handles_HEAD_fetch_failure_as_a_new_file`) sets `isNew: true` and continues. Working-copy failure (test: `test_handles_working_copy_fetch_failure_gracefully`) leaves `modified: ''` and continues. Both paths produce an open file, not an error toast — a file missing from HEAD because it's new isn't an error.

- **loadPanel accumulation semantics.** `test_accumulates_both_panels_in_a_virtual_compare` proves that successive loadPanel calls on the same virtual://compare add to both sides. Specs4 is explicit about this; alternative designs (replace the whole file each call) would lose the "load-left-then-load-right" workflow the history browser's context menu depends on.

- **Virtual files never dirty.** `test_virtual_files_are_never_dirty_even_after_edit` edits a virtual file's modified side and verifies `getDirtyFiles()` still returns empty. `_isDirty` checks both `isVirtual` and `isReadOnly`; without the virtual check, URL content viewers (which use virtual paths) would show a dirty LED that can never be saved.

- **Status LED is the primary state indicator.** Three classes (clean/dirty/new-file) + the hover-to-save affordance replace the traditional tab bar. Pinned by four separate LED tests. `test_new_file_shows_new_file_class` specifically verifies the accent-blue "new" state — important because a new file's `modified` content matches its saved content (both equal to the working-copy fetch), so a naive dirty check would show clean, losing the "this file isn't in HEAD yet" signal.

- **Keyboard shortcuts are focus-scoped.** `test_keyboard_shortcuts_when_focus_is_outside_do_not_fire` proves Ctrl+S dispatched on `document.body` (without the viewer in the composed path) doesn't save. Otherwise every textarea anywhere in the app would trigger the viewer's save path. The `composedPath().includes(this)` check is the guard.

- **SharedRpc injection via globalThis.** The test pattern uses `globalThis.__sharedRpcOverride` rather than mocking `./rpc.js` at the module level. Means a single mock-less import of `diff-viewer.js` works across every test describe block — simpler than a per-file `vi.mock` for `rpc.js` that would need scope management. Production code reads the override first, then falls back to SharedRpc; the override path has zero cost when unset.

Notes from delivery:

- **The worker env is installed at module load.** monaco-setup.js calls `installMonacoWorkerEnvironment()` as a side effect. With the Monaco mock, this is effectively a no-op (the mock doesn't use `getWorker`). In production, installation must complete before the first `createDiffEditor` call — otherwise Monaco tries to spawn a worker via an uninstalled env and falls back to a broken default. The side-effect-at-import pattern is the only reliable way to guarantee this ordering; putting the install call in the diff viewer's constructor would miss the window if another consumer of monaco-editor (e.g., a future code editor tab) ran first.

- **MATLAB registration is likewise side-effect-at-import.** Grammar must register before any editor instance that might open a `.m` file. Monaco captures language providers at editor construction; a pre-registration editor opening a `.m` file would show plain text even after the grammar lands.

- **Mock's `getModifiedEditor` returns a fresh object per call.** Real Monaco returns the same object, but the mock's current implementation creates a new one each call. Tests that chain `getModifiedEditor().onDidChangeModelContent(...)` then observe via `getModifiedEditor().getValue()` work because the mock stashes state on the parent editor. This asymmetry is a test-mock concession; production diff-viewer code reads `modifiedEditor` once per lifecycle phase and doesn't rely on identity.

- **Shadow DOM style sync is observable only by live DOM inspection.** No unit test checks it directly — the test mock never lets Monaco actually insert styles, so there's nothing to sync. The implementation is pinned by specs4 prose rather than tests. Integration testing this would need real Monaco in a real browser (Phase 6's e2e harness).

- **Scroll-to-edit highlight duration.** 3 seconds, per specs4. Long enough that the user sees where the edit landed; short enough that stale highlights don't clutter the editor. The timer is cleared on a new highlight or on file switch.

### 5.8 — Phase 3.1b Markdown preview — **delivered**

Split-view live markdown preview for `.md` and `.markdown` files, with bidirectional scroll sync, image resolution, and preview-pane link navigation.

Delivered across three passes:

**Step 2a — toggle + live rendering.** Preview button on markdown files, split layout on toggle, inline diff on the editor side, live markdown rendering via the separate `markedSourceMap` instance from `markdown-preview.js` (created in Layer 5 alongside the pure helpers). Content flows through `_updatePreview` on every content-change event. Auto-exit when switching to a non-markdown file.

**Step 2b — scroll sync + KaTeX CSS.** Bidirectional scroll sync via `data-source-line` anchors injected by `renderMarkdownWithSourceMap`. `_collectPreviewAnchors` dedupes first-seen-per-line and filters for monotonic `offsetTop` (nested containers can have children with earlier positions than their outer block). Binary search + linear interpolation via `_mapLineToOffsetTop` / `_mapOffsetTopToLine`. Scroll-lock mutex (`_scrollLock` + `_scrollLockTimer`) prevents feedback loops — auto-releases after 120ms, which covers Monaco's smooth-scroll duration without suppressing genuine user scrolling. KaTeX CSS imported as raw string via Vite's `?raw` loader, injected into shadow root with a sentinel fallback for environments where the import doesn't resolve (vitest's default resolver). Editor scroll listener attached only in preview mode via `_refreshEditorScrollListener` so non-markdown files don't pay for scroll-sync machinery.

**Step 2c — image resolution + link navigation.** Post-render scan of `<img>` tags in the preview pane. Absolute URLs (`data:`, `blob:`, `http://`, `https://`) pass through. Relative paths are percent-decoded (to undo `_encodeImagePaths`'s space encoding), resolved against the current file's directory via `resolveRelativePath`, and fetched in parallel. SVG files use `Repo.get_file_content` + URL-encoded data URI (preserves internal relative refs, unlike base64); raster images use `Repo.get_file_base64` which already returns a ready data URI. Failed loads degrade gracefully — alt text indicates the problem, image dimmed via opacity. A generation counter (`_imageResolveGeneration`) bumped on every `_updatePreview` call discards stale fetches whose DOM writes would otherwise clobber fresher content. Preview pane click listener intercepts `<a>` clicks with relative `href`, resolves the path, and dispatches `navigate-file` events. Absolute URLs, fragment-only refs, and scheme-qualified URLs (`mailto:`, `tel:`, etc.) pass through to browser defaults.

Design points pinned by tests:

- **Dual Marked instances.** `markedChat` (chat panel) and `markedSourceMap` (preview) share KaTeX math but have completely separate renderer overrides. `markedSourceMap` injects `data-source-line` attributes on block-level elements; `markedChat` doesn't. Keeping them separate means preview-specific logic never affects chat rendering.

- **Generation counter for stale fetches.** Without it, a slow image RPC from keystroke N could overwrite an img's src after keystroke N+1 populated the DOM with a different image. Every `_updatePreview` bumps the counter; stale DOM writes check `generation !== this._imageResolveGeneration` before writing and bail.

- **SVG inline via URL-encoding, not base64.** Larger output but preserves searchability in devtools and — more importantly — lets relative refs *inside* the SVG work after data-URI injection. Base64 would break those. Matches specs4/5-webapp/diff-viewer.md's explicit "SVG files fetched as text and injected as data URIs with URL-encoded content" rule.

- **`.closest('a')` in the click handler, not `target.tagName === 'A'`.** Users click on `<em>` / `<strong>` inside links; `.closest()` walks up to find the anchor. Without it, clicking bold text inside a link would fall through to browser default navigation.

- **`preventDefault()` only fires when we're handling the click.** Ignored-click tests (absolute URL, fragment-only, mailto) assert `ev.defaultPrevented === false` so we're not silently breaking browser defaults for out-of-scope clicks.

- **KaTeX CSS fallback sentinel.** Vitest's default module resolver doesn't understand Vite's `?raw` suffix — the import returns `undefined` in tests. Without a fallback, `_ensureKatexCss` would bail early at the `typeof` check and the shadow DOM would never get the marker element, breaking tests. The fallback is a one-line CSS comment — production gets real KaTeX styles, tests get the sentinel, the injection path is always exercised.

Open carried over for Phase 3.1 follow-ups:

- **3.1c — TeX preview.** Depends on Repo's compile_tex_preview RPC. Save-triggered (not keystroke) since compilation is subprocess-bound. KaTeX client-side math rendering via sentinel comments. Two-pass anchor-and-interpolation scroll sync (structural anchor extraction → block-element interpolation → back-to-front attribute injection). Availability check hides Preview button on .tex/.latex when make4ht isn't installed.

- **3.1d — LSP integration.** Four Monaco providers: hover, definition, references, completions. Each dispatches to the corresponding Repo.lsp_* RPC. Coordinate system is already 1-indexed on both sides (Monaco's convention, specs4's convention); no conversion needed. Cross-file go-to-definition already wired via the code-editor-service patch; this adds the provider side.

- **3.1e — Markdown link provider.** Monaco LinkProvider for `.md` language. Matches `[text](relative-path)` patterns, skips absolute URLs and `#` anchors. Maps matched links to `ac-navigate:///` URIs; a companion LinkOpener intercepts that scheme and dispatches `navigate-markdown-link` events. The preview pane's click-based link navigation is already delivered in 3.1b — 3.1e adds the Monaco-side equivalent so Ctrl+click inside the editor also works.

### 5.6 — Phase 3 groundwork Viewer background routing — **delivered**

Lays the integration surface between `navigate-file` events and the file viewers. Phase 3.1 (diff viewer) and 3.2 (SVG viewer) can now be built against a fully-tested routing contract — each real viewer just swaps in for its stub without app-shell changes.

- `webapp/src/viewer-routing.js` — pure `viewerForPath(path)` function. Returns `'svg'` for `.svg` paths (case-insensitive), `'diff'` for everything else, `null` for malformed input. Extracted as a standalone module so the routing rule is testable without mounting the shell and evolvable without editing the shell's render logic.
- `webapp/src/diff-viewer.js` — Phase 3 stub. LitElement with reactive `_files` / `_activeIndex` state. Public API (`openFile({path, line?, searchText?})`, `closeFile(path)`, `refreshOpenFiles()`, `getDirtyFiles()`, `hasOpenFiles` getter) matches the shape Phase 3.1's Monaco-backed viewer will inherit. Dispatches `active-file-changed` events (bubbles, composed) on open/close/switch. Same-file suppression: re-opening the current file produces no event. Empty state renders the AC⚡DC watermark; populated state shows a placeholder `.stub-content` naming the active file.
- `webapp/src/svg-viewer.js` — same contract as diff-viewer, just for `.svg` files. Phase 3.2's real SVG viewer (side-by-side pan/zoom) will replace the stub. Identical public API + event surface so the app shell treats both uniformly.
- `webapp/src/app-shell.js` — integration:
  - Imports both viewers and the routing helper
  - New `_activeViewer` reactive state (`'diff'` or `'svg'`, default `'diff'`)
  - `_onNavigateFile(event)` — reads `detail.path`, dispatches to `viewerForPath`, calls `openFile` on the right viewer via `updateComplete.then` to guard against first-render edge cases. Forwards `line` and `searchText` through so Phase 3.1 doesn't need shell changes to use them.
  - `_onActiveFileChanged(event)` — walks `event.composedPath()` to find which viewer emitted the event, flips `_activeViewer` to that tag. Pinpoint source identification (rather than tracking which viewer we last called `openFile` on) means the handler stays correct if future viewers dispatch the same event.
  - Both viewers rendered as absolutely-positioned siblings in `.viewer-background`. CSS class toggling (`viewer-visible` / `viewer-hidden`) does the visibility via opacity + pointer-events + z-index with a 150ms transition.
  - Replaced the static watermark `div` in `.viewer-background` — now each viewer carries its own empty-state watermark. Transitions between viewers or between empty and populated states are visually stable (same mark in the same position).
- `webapp/src/viewer-routing.test.js` — 6 tests: svg extension routing (case-insensitive), non-svg fallback to diff, extensionless paths, defensive substring match prevention (`foo.svg.old` → diff), malformed input (`null`, `42`, empty string → null).
- `webapp/src/diff-viewer.test.js` — 18 tests across initial state (empty watermark, `hasOpenFiles` / `getDirtyFiles` empty), `openFile` lifecycle (fires event, renders path, same-file suppression, multi-file, re-open inactive switches, malformed-input guard, line/searchText accepted), `closeFile` lifecycle (clears active, activates next, inactive-close still fires for list-changed, unknown-path no-op), event composition (bubbles across shadow DOM), stub API no-ops.
- `webapp/src/svg-viewer.test.js` — 13 tests mirroring the diff-viewer contract for the SVG viewer.
- `webapp/src/app-shell.test.js` — new `viewer routing` describe block with 11 tests: both viewers render, diff default-visible, `.py` routes to diff, `.svg` routes to svg, opening `.svg` flips active viewer, switching extensions toggles visibility, file lists preserved across visibility toggles (critical — Phase 3.1 will have expensive Monaco instances, viewer-hiding must not destroy them), empty path ignored, missing detail ignored, `line`/`searchText` forwarded to viewer's `openFile`, unsubscribe on disconnect.

Design points pinned by tests:

- **Hiding a viewer never destroys its state.** The key invariant behind the whole approach — switching from a `.py` to an `.svg` must not close the `.py` viewer's tabs. `both viewers preserve their file lists across visibility toggles` pins this explicitly. Matters for Phase 3.1's Monaco: constructing a `DiffEditor` is expensive (hundreds of ms), so keeping it alive in a hidden container is load-bearing.

- **Same-file suppression at the viewer layer.** The diff-viewer's `openFile` checks `existing === _activeIndex` and returns early. Without this, a user clicking a file mention for the already-active file would re-fire `active-file-changed`, causing the app shell to re-flip visibility (harmless but noisy) and Phase 3.1's viewport-restore logic to treat the call as a tab switch and re-scroll.

- **`_activeViewer` flips based on emitted events, not call site.** The shell could track "which viewer did I last call openFile on" but that's fragile — if another code path calls `viewer.openFile` directly, the shell wouldn't know. Walking `composedPath` identifies the source viewer reliably.

- **`line` and `searchText` forwarded through the routing boundary.** The stub ignores them, but the app shell passes them verbatim. Phase 3.1 just implements them on the real viewer; no shell change needed.

- **Empty-string path ignored at the shell layer.** `viewerForPath('')` returns null, and the shell's guard `if (!target) return` short-circuits. Two belt-and-braces rejections of the same bogus input, but the shell doesn't have to know that — it trusts the routing helper.

- **Both viewers share the same empty-state watermark.** Previously the watermark lived in `.viewer-background` itself. Moving it into each viewer's empty-state means the mark stays visible regardless of which viewer is currently active, and the transition between empty and populated states is smooth (the mark fades out as content fades in, both at 150ms ease). Visual parity with the pre-Phase-3 look.

Delivered test count: 915 total (up from 867 after speech-to-text — +48 tests from Phase 3 groundwork across four new test files).

### 5.4 — Phase 2c Files tab orchestration — **delivered**

Standalone orchestrator component that combines the file picker (2a) and chat panel (2b) in a single tab. Owns the authoritative selected-files state. Loads the file tree from `Repo.get_file_tree` on RPC-ready. Wires selection sync both directions: user actions in the picker → server via `LLMService.set_selected_files`; server broadcasts (`files-changed`) → picker via direct prop assignment. Reloads the tree on `files-modified`. Translates `file-clicked` from the picker into `navigate-file` window events that Phase 3 will consume.

- `webapp/src/files-tab.js` — `FilesTab(RpcMixin(LitElement))`. Structure:
  - Two-pane layout — picker pane on the left (fixed width with min/max constraints; draggable handle lands in Phase 3), chat pane fills the remaining space.
  - Authoritative selection held as `this._selectedFiles: Set<string>`. NOT exposed as a reactive Lit property — reactive properties would trigger parent re-renders that reset child state (see architectural rationale below).
  - Child references accessed via `this._picker()` / `this._chat()` shadow-DOM queries. Called on demand rather than cached in fields — Lit's template may recreate the children if the tab is unmounted and remounted.
  - Default picker width of 280px. Tests don't exercise the resizer (Phase 3 work); the width is stable for now.
- **Architectural contract preserved — DIRECT-UPDATE PATTERN (load-bearing).** When selection changes, the tab updates both `picker.selectedFiles` and `chat.selectedFiles` by direct assignment plus `requestUpdate()`, NOT via Lit's reactive template propagation. specs4/5-webapp/file-picker.md#direct-update-pattern-architectural documents why: changing a property on a parent triggers a full template re-render, which reassigns child component properties. For the chat panel, that would reset scroll position and disrupt in-flight streaming. For the picker, it would collapse interaction state (context menus when they land in 2d, inline inputs, focus). The pattern: update our own `_selectedFiles` Set (source of truth) → assign `picker.selectedFiles = new Set(...)` + requestUpdate → assign `chat.selectedFiles = [...]` + requestUpdate → notify server via RPC.
- **Chat panel selection assignment is forward-looking.** The chat panel in Phase 2b doesn't yet consume `selectedFiles` — it will in Phase 2d for file-mention click toggling. Assigning now means 2d's work drops in without a refactor. The assignment is a no-op visually today; tests can observe it via `chat.selectedFiles`.
- **Set-equality short-circuit.** `_applySelection` compares against the current set and returns early if unchanged. Prevents loopback: when we call `set_selected_files` and the server echoes back via `filesChanged`, applying the echo would re-trigger the server call — infinite loop. The short-circuit makes the server-broadcast handler safe to be noisy about its source (always apply, never round-trip).
- **RPC dispatch target is `Repo.get_file_tree`, not `LLMService`.** The file tree is a Repo-layer concern, not an LLM service concern. specs3's RPC inventory had this as `Repo.get_file_tree` returning `{tree, modified, staged, untracked, deleted, diff_stats}`. Phase 2c uses only `tree`; Phase 2d's git status badges will consume the sibling arrays.
- **Restricted-error surfacing via toast.** `LLMService.set_selected_files` returns `{error: "restricted", reason: ...}` for non-localhost callers in collab mode. The tab's optimistic update stays (the picker already toggled); the server's follow-up `filesChanged` broadcast restores the authoritative state for the offending client. Toast type is `warning` rather than `error` — the user wasn't deceived, they were stopped.
- **RPC-reject handling.** Both `get_file_tree` and `set_selected_files` rejections surface as `error`-type toasts, matching the AppShell's toast layer expectations. Console logs accompany so debugging context is preserved.
- **Event contract:**
  - Listens on `window` for `files-changed` (server broadcast) and `files-modified` (commit/reset reload signal dispatched by the streaming handler or the commit RPC after mutation)
  - Listens on itself for `selection-changed` (picker event, bubbles up) and `file-clicked` (picker event, bubbles up)
  - Dispatches `navigate-file` on `window` for Phase 3's viewer
  - Dispatches `ac-toast` on `window` for error/warning surfacing (AppShell's toast layer catches these)
- **AppShell integration.** `app-shell.js` imports `./files-tab.js` and renders `<ac-files-tab>` when `activeTab === 'files'`. The dialog-body's CSS changed from `padding: 1rem` with `overflow: auto` to `display: flex; flex-direction: column; overflow: hidden` so the files tab can flex-grow to fill the container. The `.tab-placeholder` class retains its own padding for the remaining stub tabs (context, settings).

- `webapp/src/files-tab.test.js` — 14 tests across 6 describe blocks:
  - Initial state — picker and chat children render, `_treeLoaded` stays false until RPC is ready, RPC-ready triggers file-tree load with real tree data reaching the picker, rejection surfaces as error toast.
  - Selection sync picker → server — checkbox click calls `set_selected_files` with the right array, internal state and picker prop both update, restricted-error surfaces as warning toast, RPC reject surfaces as error toast.
  - Selection sync server → picker — `files-changed` broadcast applies to picker, no echo back to server (infinite-loop prevention), same-set broadcast short-circuits (no redundant prop reassignment — identity check on the picker's `selectedFiles` reference), malformed payloads tolerated without crash.
  - File click → navigate-file — name click dispatches `navigate-file` with `{path}`, checkbox click doesn't, malformed event ignored.
  - files-modified reload — event triggers re-fetch of the tree, reload errors surface as toast without unhandled rejection.
  - Cleanup — window listeners removed on disconnect; `files-modified` after remove produces no reload.

- Test infrastructure — uses the same `SharedRpc` fake proxy pattern as `chat-panel.test.js`. The `settle()` helper drains microtasks AND both children's `updateComplete` cycles so the full orchestration round-trip is observable.

Design points pinned by tests:

- **Reject broadcasts aren't echoed back.** `test_does_not_re_send_server_broadcast_back_to_server` proves the `notifyServer` flag on `_applySelection` isn't set when the source is the `files-changed` handler. Without this, the server's broadcast would trigger our `set_selected_files` call, which would trigger another broadcast, etc. The set-equality short-circuit provides a second line of defence, but the explicit flag is the primary one.
- **Set-equality identity check.** `test_ignores_broadcasts_with_the_same_set` asserts `picker.selectedFiles` is reference-equal before and after a same-set broadcast. Catches regressions where a future refactor helpfully reassigns the set unconditionally, which would cost us a redundant picker re-render every time the server echoes.
- **Malformed payloads don't crash.** `test_ignores_malformed_broadcast_payloads` exercises null, non-array, missing-field, and fully-null detail. A rogue broadcast from a future backend version (or a test artifact in collab mode) can't wedge the UI.
- **Restricted errors don't block the optimistic update.** The picker's checkbox has already flipped by the time we hear back from the server. The warning toast tells the user what happened; the server's `filesChanged` broadcast (which WILL fire in collab mode) does the actual restore. Testing the full collab handshake belongs to a Phase 4 integration test; Phase 2c just proves the single-client restricted path surfaces the warning without wedging state.

Not wired to advance scope further. The files-tab deliberately stops at navigation-event dispatch (`navigate-file`) without consuming it — Phase 3's viewer is the consumer. The @-filter bridge and middle-click path insertion are Phase 2d (they need chat-textarea work that doesn't exist yet).

Deferred to later sub-phases:

- Phase 2d: @-filter bridge between chat textarea and picker's `setFilter()`, middle-click path insertion with paste suppression, git status badges (picker rendering changes), branch badge at the root, context menu on picker rows, file-mention click toggling (uses the selectedFiles on the chat panel that this commit lays the groundwork for).
- Phase 2e: file search integration (pruned tree + match overlay).
- Phase 3: draggable resizer between picker and chat panes, localStorage persistence of pane widths, active-file highlight (needs viewer's `active-file-changed` event).

Next up — Phase 2d: chat panel advanced features — edit block rendering with diff highlighting, file mentions, snippet drawer, session controls, input history, message action buttons. The @-filter bridge and middle-click path insertion also land here since they need the chat textarea side.

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

## Layer 2.8 — Document index (planned)

Layer 2's deferred piece. specs4/2-indexing/document-index.md and specs4/2-indexing/keyword-enrichment.md spec the full design; the SVG section was revised in a recent commit to use geometric containment instead of font-size heuristics (see the latest state of document-index.md § SVG Extraction).

The frontend mode toggle (code/doc/cross-ref) is live in `app-shell.js` and calls `LLMService.switch_mode` and `LLMService.set_cross_reference` successfully. Both backend RPCs accept the call and broadcast `modeChanged`. However doc mode produces an empty context because no doc index exists, and cross-reference toggle logs "doc index not available; toggle will take effect once Layer 2 doc-index lands." Layer 2.8 fills these in.

### Motivation

The user's request — "doc indexing so I can click doc mode or code mode AND have the ability to add indexes or symbols depending on the mode" — is only half delivered. Backend accepts mode switching, frontend toggle works, but doc mode produces no content and cross-reference is a no-op. This layer makes both materially useful.

### Build order (one commit per numbered item)

**2.8.1 — Doc index scaffold (markdown only, no keyword enrichment).** The narrowest slice that puts content in doc mode.

Sub-commit progress:

**2.8.1a — Data model** (delivered, commit `5a99e3b`). `src/ac_dc/doc_index/__init__.py`, `src/ac_dc/doc_index/models.py` — `DocHeading`, `DocLink`, `DocSectionRef`, `DocProseBlock`, `DocOutline` dataclasses. Mutable (mirrors `Symbol`); caller code treats outline as read-only within a request boundary (D10 snapshot discipline). `tests/test_doc_index_models.py` pins the shape.

**2.8.1b — Markdown extractor** (delivered, commit `066e007`). `src/ac_dc/doc_index/extractors/__init__.py`, `src/ac_dc/doc_index/extractors/base.py`, `src/ac_dc/doc_index/extractors/markdown.py`. Single-pass regex line scanner. Heading extraction with correct level-based nesting, inline and reference-style links, image refs, content-type markers (code/table/formula via fence/separator/math detection), section line counts, doc-type classification via path and heading heuristics. Fenced code and math-block suppression for heading and link detection; inline code span stripping. `tests/test_doc_index_markdown_extractor.py` covers all of it.

Notes from 2.8.1b delivery:

- **Path classification is a heuristic, not a discovery filter.** The `_PATH_TYPE_KEYWORDS` table decides the `doc_type` tag (`spec`, `guide`, `readme`, etc.) based on conventional directory names. It does NOT exclude any file from indexing — file discovery is the orchestrator's job (2.8.1e) via `os.walk` with `.gitignore` and excluded-dir handling. Unclassified paths get `doc_type="unknown"` and are fully indexed. Pinned by `test_unclassified_paths_produce_valid_outlines`.

- **Path patterns are generic conventions, not repo-specific.** Earlier draft had `specs3/`, `specs4/` hardcoded — removed in favour of cross-repo conventions (`specs/`, `spec/`, `rfc/`, `rfcs/`, `design/`, `designs/`, `adr/`, `decisions/`, `guide/`, `guides/`, `tutorial/`, `howto/`, `reference/`, `references/`, `api/`, `notes/`, `meeting/`, `minutes/`, `journal/`). Per-repo customisation can land via config later if real-world usage shows gaps.

- **Section line off-by-one from trailing newline.** `content.split("\n")` on a file ending with `\n` produces a trailing empty string. Naive `len(lines)` would inflate the last heading's `section_lines` by one. Fixed by trimming a trailing empty line before computing the EOF boundary. Pinned by `TestSectionLines`.

- **Reference-style link resolution drops undefined labels.** A `[text][undef]` with no matching `[undef]: target` definition produces no DocLink rather than an empty-target placeholder. Cleaner for downstream consumers that would otherwise need to filter.

Delivered 2.8.1 sub-commits:

- **2.8.1c — DocCache** (delivered). `src/ac_dc/doc_index/cache.py` — `DocCache(BaseCache[DocOutline])` with JSON sidecar persistence at `{repo_root}/.ac-dc/doc_cache/{flattened-path}.json`. Filename translation replaces `/` with `__` for flat storage. Entries carry mtime, content_hash, keyword_model, and the serialized outline. Memory-only mode when `repo_root=None`. Crash-resilient load — corrupt sidecars are removed on discovery. `keyword_model=None` passes any cached entry; non-None requires match, forcing re-extraction when the stored model differs. `tests/test_doc_index_cache.py` pins round-trip, mtime semantics, signature-hash stability, crash recovery, and model-name plumbing.

- **2.8.1d — DocReferenceIndex** (delivered). `src/ac_dc/doc_index/reference_index.py` — exposes the `file_ref_count(path)` + `connected_components()` protocol the stability tracker consumes via `initialize_with_keys`. Builds incoming ref counts on `DocHeading` nodes via GitHub-style anchor slugging (lowercase, spaces→hyphens, strip punctuation). Unresolved anchors fall back to the document's top heading rather than dropping the link. Image references produce `DocLink` entries with `is_image=True` so doc→SVG edges cluster correctly. Bidirectional edges power clustering. `tests/test_doc_index_reference_index.py` pins slugging, incoming-count accumulation, bidirectional edge formation, connected-component isolation, and image-link edge handling.

- **2.8.1e — DocFormatter** (delivered). `src/ac_dc/doc_index/formatter.py` — `DocFormatter(BaseFormatter)`. Renders `path [type]:` header, indented heading tree with depth-based `#` count, `(kw1, kw2, …)` keywords (omitted in 2.8.1 since enrichment lands in 2.8.4), `[content-type]` bracketed markers, `~Nln` size (only when ≥5 lines), `←N` incoming refs (only when non-zero), `→target.md#Section` outgoing section refs indented one level below the source heading, final `links:` line with deduplicated document-level targets. Legend lists the doc-specific markers (no arrow glyphs, per D12). `tests/test_doc_index_formatter.py` covers every annotation rendering rule, heading nesting, outgoing-ref placement, path aliasing (inherited from base), exclusion, and determinism across calls.

- **2.8.1f — DocIndex orchestrator** (delivered, commit `f728bed`). `src/ac_dc/doc_index/index.py` — wires extractor registry, cache, reference index, and formatter into a single entry point. Mirrors `SymbolIndex` so the LLM service's tier builder dispatches between them via a simple mode check. Per-file pipeline: mtime → cache hit-or-extract → link-path validation against repo files → store. Multi-file pipeline: walk (or accept explicit list) → index each → prune stale entries → rebuild reference graph. Stale-prune-before-rebuild ordering matches the symbol index invariant (`test_stale_removal_before_reference_build` pins it). Snapshot discipline (D10) enforced for read methods — `get_doc_map`, `get_legend`, `get_file_doc_block`, `get_signature_hash` never mutate `_all_outlines`. `tests/test_doc_index_orchestrator.py` covers construction, per-file lifecycle (cache hit / miss / error paths), multi-file pipeline with discovery and excluded-directory handling, reference-graph integration, keyword-model plumbing, invalidation, read methods, and snapshot discipline.

Notes from 2.8.1f delivery:

- **Absolute-path defensive handling.** `index_file` accepts both repo-relative and absolute paths per its docstring. The original implementation normalised first (stripping any leading `/`) then resolved, which mangled POSIX absolute paths like `/tmp/.../repo/doc.md` into a repo-relative lookup against the wrong root. Fix: detect absolute-ness before normalisation. When absolute and within `repo_root`, use `relative_to` to produce the cache key. When absolute and outside `repo_root`, use the path as its own key (caller is doing something unusual but we don't crash). Pinned by `test_accepts_absolute_path`. Real callers pass repo-relative paths; this is the "defensive doorway" case where a caller has computed an absolute path from some other source.

- **`_walk_repo` skips hidden directories except `.github`.** Matches the `doc_convert` walker's rule for consistency — `.github/` conventionally holds CI docs that belong in the index, while other `.hidden/` dirs are scratch or state that doesn't. Combined with the module-level `_EXCLUDED_DIRS` set (`.git`, `.ac-dc`, `.ac-dc4`, `node_modules`, `__pycache__`, `.venv`, `venv`, `dist`, `build`), the walker returns only files that belong in the doc index.

- **Repo-file set is the union of walked files, not the filtered doc set.** Extractors that need to validate link targets (SVG's image extraction in 2.8.3, markdown's image refs in 2.8.1b) want to know whether `../assets/diagram.svg` exists on disk — not whether it's a doc. Passing the full walked set means image targets resolve even when the target's extension isn't registered with an extractor. 2.8.1's markdown extractor doesn't use this yet (syntax-only link extraction), so `repo_files` is forward-compatible plumbing; 2.8.3 activates it.

- **Stale prune runs before reference-graph rebuild.** Non-obvious regression case: if you rebuild the graph first, then prune, the graph briefly contains edges from/to files we're about to drop. The pruned version of the orchestrator correctly has no edge for deleted files. Matches the symbol index's Phase 0 → rebuild ordering. Pinned by `test_stale_removal_before_reference_build` which leaves `a.md` with an incoming link to a now-pruned `deleted.md` and asserts the graph sees no incoming edges on a.md.

- **Empty file list is not the same as None.** `index_repo([])` explicitly says "index nothing, prune everything"; `index_repo(None)` triggers a walk. Pinned by `test_explicit_empty_list_prunes_everything`. A future refactor that treated `None` and `[]` identically would make the pruning path unreachable.

### Layer 2.8.1 — complete

Layer 2.8.1 (doc index scaffold, markdown-only, no keyword enrichment) is complete. All of: data model (2.8.1a), markdown extractor (2.8.1b), cache with disk persistence (2.8.1c), reference index (2.8.1d), compact formatter (2.8.1e), orchestrator (2.8.1f). Ships a fully functional markdown-only doc index; SVG support lands with 2.8.3, keyword enrichment with 2.8.4. Next sub-commit is 2.8.2 — wire the doc index into `LLMService` so mode switching actually produces content in doc mode and cross-reference has material effect.

**2.8.2 — Wire doc index into LLMService.** Makes doc mode and cross-reference produce content.

Delivered as nine incremental sub-commits. Sub-commits order chosen so tests at each step have populated state to exercise — `_doc_index` constructed first, background build second, everything else plugs into a running index.

### Two-phase readiness — contract refinement

Per specs4/3-llm/modes.md § "Cross-Reference Readiness" and specs4/2-indexing/document-index.md § "Two-Phase Principle", the doc index has two distinct readiness phases:

- **Structure ready** — all markdown files parsed into outlines, reference graph built. Minimum state for doc mode and cross-reference to produce *something*. Happens synchronously during the background build; typically completes within a second for any reasonable repo size.
- **Enriched ready** — keyword enrichment complete for all files (2.8.4). Outlines get `(keyword1, keyword2)` annotations that the LLM uses for disambiguation. Can take minutes on large repos.

The cross-reference UI toggle is gated on **structure-ready only** (per user decision during 2.8.2 planning). Once structural extraction completes, the toggle works; when enrichment later completes, outlines re-hash (keywords contribute to signature) and the tracker demotes the affected items once. They then re-stabilize at their tiers over the next few requests.

Two separate flags exposed on `get_mode`:

- `doc_index_ready` — structure done, cross-reference can activate
- `doc_index_enriched` — enrichment done (always False in 2.8.2; flips in 2.8.4)

### Sub-commits

**2.8.2a — Construct DocIndex, attach to LLMService.** Constructor builds `DocIndex(repo_root=repo.root if repo else None)` alongside `SymbolIndex`. Never optional (unlike `_symbol_index` which can be None during deferred init) — DocIndex construction is cheap (no tree-sitter, no grammars). Stored as `self._doc_index`. Tests: constructor populates `_doc_index`, identity preserved across mode switches, present even when `symbol_index=None`.

**2.8.2b — Doc index background build.** New `_build_doc_index_background()` method called from `complete_deferred_init` after symbol-index wiring. Runs `doc_index.index_repo(file_list)` in `_aux_executor` (doc extraction is CPU-bound enough to deserve its own executor thread; pre-empts the event loop). Emits `startupProgress('doc_index', ...)` callback events per file. Sets `_doc_index_ready = True` on completion; `_doc_index_building = True` during. Errors logged but non-fatal — doc index failure doesn't block the service. Tests: background build fires on deferred-init completion, progress events emit per file, readiness flag flips, errors surface as warnings without crashing.

**2.8.2c — `get_mode` readiness fields.** Replace the hardcoded `False` for `doc_index_ready`, `doc_index_building`, `cross_ref_ready` with real state from `_doc_index_ready` / `_doc_index_building`. Add `doc_index_enriched` field (always False in 2.8.2). `cross_ref_ready` mirrors `doc_index_ready` — the minimum readiness for cross-reference to produce content is structural extraction. Tests: fields reflect actual state before/during/after doc index build; `doc_index_enriched` stays False.

**2.8.2d — Tier builder doc dispatch.** `_build_tiered_content` — replace the skip-with-TODO branch for `doc:{path}` with real dispatch to `doc_index.get_file_doc_block(path)`. Doc blocks concatenate alongside symbol blocks in the tier's `symbols` field — both render under the `TIER_SYMBOLS_HEADER` header in the same content section per specs4/3-llm/prompt-assembly.md § "L1–L3 Blocks". Fragment ordering sorted by key for determinism. Tests: doc prefix dispatch works, missing path returns None handled, mixed symbol+doc tier renders both kinds, blocks in sorted key order.

**2.8.2e — Legend dispatch in `_assemble_tiered`.** Pass `doc_legend = doc_index.get_legend() if (mode == DOC or cross_ref_enabled) else ""` so cross-reference mode and doc mode both get the appropriate legend in L0. Primary legend always goes to the `symbol_legend` parameter of `assemble_tiered_messages`; secondary (opposite-mode) always goes to the `doc_legend` parameter. The assembler (already implemented in 3.8) places each under the correct header per specs4/3-llm/prompt-assembly.md § "Cross-Reference Legend Headers". Tests: code mode no cross-ref → symbol legend only; doc mode no cross-ref → doc legend only; cross-ref → both legends with opposite-mode headers.

**2.8.2f — `_update_stability` doc entries.** When in doc mode: iterate `doc_index._all_outlines` for non-selected files, add `doc:{path}` entries with signature hash and formatted-block tokens. When cross-reference is active in code mode: also iterate doc outlines and add `doc:{path}` entries. When in doc mode with cross-reference: iterate symbol index for `symbol:{path}` entries. Removal for selected files already covers both `symbol:` and `doc:` prefixes (from 3.10's active-file entry removal). Tests: doc mode populates doc entries; code mode + cross-ref populates both; doc mode + cross-ref populates both.

**2.8.2g — Cross-reference enable/disable actually does something.** `set_cross_reference(True)` in code mode: add `doc:{path}` items to the active tracker (parallel to symbol items) — on the next `_update_stability` pass they'll be in active-items and flow through the normal tier machinery. `set_cross_reference(True)` in doc mode: add `symbol:{path}` items symmetrically. `set_cross_reference(False)`: remove cross-ref items from tracker via `tracker._items.pop()`, mark affected tiers broken. Readiness gate: enable returns `{error: "cross-reference not ready"}` when `doc_index_ready` is False. Tests: enable adds items, disable removes them, readiness gate works, enable during build is rejected cleanly.

**2.8.2h — Rebuild handles doc mode.** `_rebuild_cache_impl` — when `mode == Mode.DOC`, indexed_files comes from `doc_index._all_outlines.keys()` instead of `symbol_index._all_symbols`; key prefix is `doc:` (already handled by the dispatch logic). Orphan handling unchanged — selected non-doc files are still orphans and bin-pack into L1/L2/L3. Tests: rebuild in doc mode places `doc:` entries correctly; rebuild in doc mode with mixed selection (docs + non-docs) orphan-distributes correctly.

**2.8.2i — Lazy init in doc mode.** `_try_initialize_stability` — when starting in doc mode, seed from doc index instead of symbol index. Filter file list by `doc_index._all_outlines` keys, use `doc:` prefix, pass to `initialize_from_reference_graph`. When doc mode is active but `doc_index_ready` is False (session starts in doc mode before background build completes — edge case), skip initialization; the next request's lazy-init retry catches it. Tests: initialization in doc mode uses doc ref graph; skips gracefully when doc index not ready; retries on next request.

### Delivery order

- **2.8.2a** first — everything else depends on `_doc_index` existing
- **2.8.2b** second — populates `_doc_index._all_outlines` so subsequent sub-commits can test dispatch against real content
- **2.8.2c** third — readiness flags needed for 2.8.2g's gate
- **2.8.2d** → **2.8.2e** → **2.8.2f** — tier plumbing in dependency order (content → legend → tracker)
- **2.8.2g** — cross-ref toggle (depends on 2.8.2c's gate and 2.8.2f's tracker items)
- **2.8.2h** → **2.8.2i** — rebuild and lazy-init dispatch (both touch existing paths in subtle ways; kept last to minimize risk of cross-talk with earlier sub-commits)

After 2.8.2 ships, doc mode actually works and cross-reference toggle has material effect. User-visible. Enrichment is still deferred to 2.8.4 — outlines render with empty keyword slots but structure is fully navigable.

### Layer 2.8.2 — complete

All nine sub-commits delivered: DocIndex construction, background build, readiness flags, tier-builder dispatch, legend dispatch, stability-update dispatch, cross-reference lifecycle, rebuild-cache dispatch, lazy-init dispatch. Doc mode produces content via the doc index. Cross-reference toggle has material effect — enabling seeds items into the active tracker with the opposite prefix; disabling cleans them up.

### Layer 2.8.3 — complete

Delivered across two commits (`1ec1677`, `255f1e1`). SVG extractor lands with:

- **Containment tree from geometry** — shapes (rect, circle, ellipse, polygon, path) produce bounding boxes in root-canvas coordinates via transform composition. Text elements attach to their smallest containing box. Three-level labeling rule (aria-label → single-text inference → neutral `(box)`). Auto-id filtering for Inkscape / Illustrator patterns (`Group_42`, `g123`). Multi-line label joining via y-proximity. Reading order y-then-x at each level.
- **Shape-less fallback** — spatial clustering by vertical gap when the SVG has no shapes (text-only diagrams, ungrouped AI-generated layouts).
- **Prose blocks (2.8.3e)** — `<text>` elements over 80 chars become `DocProseBlock` entries with `container_heading_id` set to the enclosing box's label (or None for root-level prose). Shape-less path uses the cluster's first short label, or the root title as fallback. 2.8.4's keyword enricher will populate the `keywords` field post-hoc; 2.8.3e leaves it empty so the compact formatter renders `[prose]` bare.
- **Pure-function geometry module** (`svg_geometry.py`) — number parsing, transform parsing, matrix composition, point transformation, shape bbox computation, containment checks. Tested independently of the extractor.
- **Link extraction** — `<a xlink:href>` and SVG2 `<a href>` produce `DocLink` entries. External URLs and fragment-only refs are filtered.

Deliberately scope-trimmed per specs4:
- No font-size heuristics (fonts are unreliable semantic signals in SVG).
- No title detection inside ambiguous multi-text boxes — uses neutral `(box)` identifier and lets the LLM read via containment.
- No visual rendering (no playwright / resvg / Chromium).

### Post-layer bug fixes

**`8a49df8` — doc index scheduling on worker threads.** `complete_deferred_init` was called from `main.py`'s `_heavy_init` via `run_in_executor`, so `asyncio.get_event_loop()` inside it returned a fresh dead loop (Python 3.10+ behaviour on worker threads) rather than raising. `ensure_future(_build_doc_index_background())` scheduled the task on the dead loop and the task never ran — no error surfaced, just silence. Fix: split scheduling into `schedule_doc_index_build()` that uses `asyncio.get_running_loop()` (raises on worker threads rather than returning a dead loop), called separately from `main.py` on the event loop thread after the executor call returns. `complete_deferred_init` still attempts inline scheduling so the test path (pytest-asyncio on the event loop thread) doesn't need an extra call.

**`8e782db` — per-mode tracker initialization.** The stability-initialized flag was service-wide, so switching from code to doc mode swapped to a fresh empty tracker that `_try_initialize_stability` refused to populate (the flag was already True from code-mode init). Cache viewer showed an empty tier list in doc mode until the user clicked Rebuild. Fix: replaced `_stability_initialized: bool` with `_stability_initialized: dict[Mode, bool]`. `switch_mode` calls `_try_initialize_stability` after the tracker swap — the new mode's tracker runs full init against its reference graph; subsequent switches back to an initialized mode are no-ops. Rebuild and lazy-init retry paths updated to use the per-mode dict.

Spec updates for the init contract landed in the same commit (`8e782db`): `specs4/3-llm/cache-tiering.md` added a "Per-Tracker Initialization" section; `specs4/3-llm/modes.md` updated "Mode Switching Mechanics" and "Stability Tracker Lifecycle" to call out that init runs on first switch-into-mode.

**Notes from delivery:**

- **The readiness gate is structural-only.** `doc_index_ready` flips when structure extraction completes; `doc_index_enriched` is wired but always False in 2.8.2. Cross-reference gates on structure only, per specs4 — enrichment improves quality but isn't a prerequisite. When 2.8.4 lands, enrichment completion will re-hash affected outlines and the tracker will demote-and-restabilize them naturally across a few cycles.

- **The "never appears twice" invariant required three touchpoints.** Selected files' cross-reference entries are excluded in three places — the active-items build (step 2 of `_update_stability`), the cross-ref seeding pass (`_seed_cross_reference_items`), and rebuild's step 7 swap. All three must agree or selected files end up both as file: (full content) and doc:/symbol: (index block) in the tracker. Pinned by explicit tests for each path.

- **Mode switch cleanup ordering.** `switch_mode` calls `_remove_cross_reference_items` BEFORE swapping trackers. The removal strips items matching the OLD mode's opposite prefix (doc: in code mode, symbol: in doc mode) from the current tracker. After the swap, the new mode's tracker starts clean. Tests pin this — a naive implementation that swapped first then tried to strip would remove the wrong prefix.

- **`_doc_index._ref_index` is the reference graph contract.** Both lazy init (2.8.2i) and rebuild (2.8.2h) reach into this attribute. `DocReferenceIndex` exposes the same `file_ref_count` + `connected_components` protocol as `SymbolIndex._ref_index`, so the shared `initialize_with_keys` clustering algorithm works uniformly.

- **`initialize_with_keys` vs `initialize_from_reference_graph`.** The older `initialize_from_reference_graph` hardcodes `symbol:` prefix. Layer 2.8.2i switched lazy init to use `initialize_with_keys` with an explicit prefix parameter. Rebuild was already using the keyed variant from its 2.8.2h pass. The older method is kept for backward compatibility but every new caller should use the keyed variant.

## Layer 2.8 — next sub-commits

**2.8.3 — SVG extractor.** Adds architecture diagrams and flowcharts to the doc index. Specs4/2-indexing/document-index.md § "SVG Extraction" spec is detailed. Builds containment tree from bounding boxes, attaches text to smallest containing box, uses three-level labeling (explicit label > single-text box > neutral identifier), filters Inkscape auto-generated IDs, captures long text (>80 chars) as prose blocks for enrichment.

Independent of 2.8.4. Can ship before or after.

**2.8.4 — Keyword enrichment via KeyBERT.** Adds the disambiguation layer. specs4/2-indexing/keyword-enrichment.md. Optional dependency (`[project.optional-dependencies].docs`). Lazy model load, batched extraction, TF-IDF fallback for short sections, corpus-aware document-frequency filter, graceful degradation when KeyBERT unavailable.

Independent of 2.8.3. When both land, SVG prose blocks flow through the enrichment pipeline alongside markdown sections.

**2.8.3 — SVG extractor.** Adds architecture diagrams and flowcharts to doc mode.

- `src/ac_dc/doc_index/extractors/svg.py` — implement the design in specs4/2-indexing/document-index.md § SVG Extraction
  - Containment model: parse rects/circles/ellipses/polygons/paths, compute root-canvas bounding boxes via transform composition (translate, scale, rotate, matrix), build containment tree by sorting shapes by area descending
  - Text attachment: each text element attached to smallest containing box; root-level texts become document leaves
  - Labeling: three-level priority (aria-label > inkscape:label > filtered id, then single-text-in-box, then neutral `(box)` identifier for multi-text unlabeled boxes). Auto-id regex: `^(g|group|path|rect|text|layer)(_?)\d+$`
  - Long text handling: elements > 80 chars captured as prose blocks attached to the containing box (or at document root when no container exists). Prose blocks carry their raw text so 2.8.4's enrichment pipeline can process them. The outline structure itself emits `[prose]` leaves indented under their container; the text attachment lets enrichment round-trip keywords back without a separate data path
  - Reading order: y-then-x sort at each nesting level (applies to prose blocks too — prose is emitted in reading order alongside its sibling boxes and labels)
  - Shape-less fallback: spatial clustering by y-gap (2× median line height)
  - Image links (`<a xlink:href=...>`) captured as `DocLink` with non-fragment filtering
  - `DocOutline.prose_blocks` field — list of `{text, container_id, start_line?}` entries accessible to the enricher. Parallel to how markdown sections carry their text for enrichment
- `src/ac_dc/doc_index/models.py` — add `DocProseBlock` dataclass (text, container_heading_id, keywords list) and a `prose_blocks` field on `DocOutline`
- `src/ac_dc/doc_index/extractors/__init__.py` — register `.svg` → `SvgExtractor`
- `tests/test_doc_index_svg_extractor.py` — test the documented cases from specs4 (labeled box nesting example, shape-less clustering example), plus edge cases (nested transforms, rotated shapes, path bounding boxes, anonymous group transparency, prose block capture with correct container attachment, prose at document root when no container, polygon containment, circle containment)
- `src/ac_dc/doc_index/index.py` — SVG files with zero prose blocks skip the enrichment queue (common case — architecture diagrams are almost all short labels). Files with prose blocks go through enrichment just like markdown. Replace the originally-planned `is_enrichable(path)` with a per-outline check: `needs_enrichment(outline)` returns True when the outline has any markdown sections above `min_section_chars` OR any prose blocks
- `src/ac_dc/doc_index/compact_format.py` — render prose blocks as `[prose] (kw1, kw2, kw3)` entries indented under their container box, matching the indentation level used for label leaves. Unenriched prose (before 2.8.4 completes or when KeyBERT unavailable) renders as `[prose]` alone

After 2.8.3, doc mode includes architecture diagrams. Prose-bearing SVGs (rare — usually only in annotated tutorial diagrams) are ready for enrichment as soon as 2.8.4 lands. Label-only SVGs (the common case) produce enrichment-free outlines that ship immediately. Cross-reference mode in code mode shows markdown+SVG outlines alongside code symbols.

**2.8.4 — Keyword enrichment via KeyBERT.** Delivered across three sub-commits:

- **2.8.4a — enricher scaffold** (delivered). `src/ac_dc/doc_index/keyword_enricher.py` — `KeywordEnricher` class with tristate availability flag, lazy model load, `EnrichmentConfig` frozen dataclass. `is_available()` probes keybert + sentence-transformers imports with broad exception catch (ImportError, RuntimeError for CUDA / version mismatch). `ensure_loaded()` constructs the KeyBERT instance; idempotent, degrades cleanly on construction failure (network, invalid model, rate limit). `tests/test_doc_index_keyword_enricher.py` pins construction, probing + caching, load failure paths, code stripping helpers.

- **2.8.4b — extraction pipeline** (delivered). Same module — `enrich_outline` with the full batched pipeline: unit collection (markdown sections sliced from source via `start_line`, SVG prose blocks inline), code stripping (fenced + inline spans), batched KeyBERT extraction with MMR diversity, TF-IDF fallback for short units (requires scikit-learn, no-op without), corpus-aware document-frequency filter with bigram-constituent rule, adaptive top-n (+2 for sections ≥15 lines), min-score filter, keyword-less-section fallback (retains top keyword even if filtered). Graceful degradation when KeyBERT is unavailable (returns outline unchanged). Tests pin all of: happy-path extraction, eligibility filter, code stripping, min-score filter, adaptive top-n, prose block enrichment, mixed batches, corpus filter with three cross-section scenarios (pervasive unigram dropped, bigram survives via non-pervasive constituent, never-leave-empty fallback), KeyBERT exception handling.

- **2.8.4c — orchestrator integration** (delivered, commit `0a5c646`). `DocIndex` gains `needs_enrichment`, `queue_enrichment`, `enrich_single_file`. `LLMService._run_enrichment_background` chains after structural extraction — eager model load, per-file source-text read + enrich in the aux executor, per-file progress events (`doc_enrichment_queued`, `doc_enrichment_file_done`, `doc_enrichment_complete`), `await asyncio.sleep(0)` between files so WebSocket traffic flows. Cache entries re-tagged with `keyword_model` so structure-only lookups hit across mode switches and model-specific lookups correctly miss when the user changes their configured model. `tests/test_doc_index_enrichment.py` covers `needs_enrichment` (empty outlines, nested headings, prose blocks above/below threshold, mixed states), `queue_enrichment` (no enricher → empty, sorted ordering, excludes already-enriched, mixed states), `enrich_single_file` (no enricher / unknown file / missing on disk → None, mutates outline in place, re-caches with model name, bumps signature hash, subsequent structure-only lookups still hit, different-model lookup misses).

**Next for 2.8.4 — still pending:** (deferred)

- Optional dependency — update `pyproject.toml` with `[project.optional-dependencies].docs = ["keybert>=0.8", "sentence-transformers>=3.0"]`
- `src/ac_dc/doc_index/keyword_enricher.py` — implement specs4/2-indexing/keyword-enrichment.md
  - Lazy model load with tristate `_available` flag (not-checked / True / False)
  - Cache probe via `huggingface_hub.try_to_load_from_cache` for distinct "downloading" vs "loading" progress messages
  - Batched extraction — single call to `KeyBERT.extract_keywords` with all eligible text (markdown sections AND SVG prose blocks) for transformer batch encoding. Prose blocks and sections mix freely in the batch; the enricher doesn't care about the source
  - MMR diversity via `diversity=0.5` parameter
  - Code stripping before extraction (fenced blocks, inline spans) — markdown only, prose blocks pass through verbatim
  - Corpus-aware document-frequency filter (max_doc_freq threshold) — corpus is all eligible text from the document (sections + prose blocks)
  - TF-IDF fallback for sections and prose blocks below `tfidf_fallback_chars`
  - Adaptive top_n (+2 for sections ≥ 15 lines) — applies to prose blocks too when they're long enough
  - Keywords attached back to source: markdown → `DocHeading.keywords`; SVG → `DocProseBlock.keywords`. The formatter reads from whichever field the outline carries
- `src/ac_dc/doc_index/index.py` — two-phase extraction. Structure-only pass (instant, always available), enrichment pass (per-file, yields between files via `await asyncio.sleep(0)`). `enrich_single_file` method for the per-file background loop, replaces unenriched cache entry in-place. `queue_enrichment` method returns files needing enrichment for the caller to drive — includes SVG files that have prose blocks, skips SVG files that are label-only
- `src/ac_dc/llm_service.py` — background enrichment loop after structure extraction. Progress events via `compactionEvent` with stages `doc_enrichment_queued`, `doc_enrichment_file_done`, `doc_enrichment_complete`. Eager pre-initialization of the model so first mode switch isn't blocked
- `tests/test_doc_index_keyword_enricher.py` — batched extraction (mixed sections + prose blocks in one batch), MMR diversity, code stripping (markdown only), corpus filter with mixed-source corpus, TF-IDF fallback, graceful degradation when KeyBERT unavailable, SVG prose block enrichment round-trip (extract → enrich → formatter output contains keywords)
- Frontend — app-shell and dialog updates to show header progress bar during enrichment (not a blocking overlay, specs4/5-webapp/shell.md § doc enrichment progress)

After 2.8.4, document mode reaches feature parity with the spec. Repeated subheadings (API references, spec suites) become disambiguated via keywords. Annotated SVG diagrams (flowcharts with paragraph-style explanations, architecture docs with prose callouts) surface their prose content as searchable keywords in the outline rather than appearing as opaque `[prose]` placeholders.

### Dependencies between commits

- 2.8.1 has no dependencies; can ship standalone
- 2.8.2 depends on 2.8.1 (wires the module into the service)
- 2.8.3 depends on 2.8.1 (adds a new extractor to the registry)
- 2.8.4 depends on 2.8.1 (enriches the outlines the extractor produced)

2.8.3 and 2.8.4 are independent of each other. Ship in any order after 2.8.2.

### Deferred for later (not part of 2.8)

- SVG indexing progress bar in frontend — enrichment progress only, since SVG doesn't enrich
- Alt+D keyboard shortcut for mode toggle — nice-to-have, specs4 doesn't mention it
- Doc convert integration — already a separate feature (Layer 4.6); doc index picks up converted `.md` files automatically
- Incremental re-enrichment on file save — users manually editing markdown get lazy re-extraction on next chat; specs4 calls this out as acceptable

### Resumption protocol for 2.8

A contributor restarting mid-Layer-2.8 reads this section, identifies which sub-commit is in progress from the file tree (e.g., `doc_index/extractors/markdown.py` present means 2.8.1 is underway), runs the relevant test file to see what's passing, and continues from the last known good state.

---

## Deferred cleanup

Temporary scaffolding installed to keep a test/output path quiet, with the fix scheduled for a specific future phase. Grep `TODO(phase-` across the tree to find markers.

- **`webapp/src/app-shell.test.js` — `describe('setupDone')` console.error silence.** The `beforeEach`/`afterEach` pair in the setupDone describe block installs a `vi.spyOn(console, 'error').mockImplementation(() => {})` to swallow errors from the files-tab's `onRpcReady` handler when it tries `Repo.get_file_tree` on a fake proxy that doesn't implement it. The errors are genuine — the files-tab genuinely can't fetch the tree — but they're out of scope for app-shell tests which focus on shell-level wire-up, not files-tab RPC behavior. **Remove when:** Phase 2d expands these shell tests (or adds a separate integration test class) that publishes a richer fake proxy including `Repo.get_file_tree`, at which point the files-tab's RPC call succeeds and the console.error goes away naturally. The TODO comment in the test file references `TODO(phase-2d)` so it shows up in that phase's grep sweep.

## Compaction UI completion plan — **delivered**

Both increments shipped, plus a follow-up capacity bar (`0b571d9`).

- **Increment A — Progress overlay** (delivered). New `webapp/src/compaction-progress.js` LitElement floats top-center during compaction with a spinner + elapsed-seconds counter. Shows "Done — {case}" for 800ms on success, "Compaction failed: {reason}" for 3s on error, then fades. Filters out `url_fetch` / `url_ready` events from the shared channel. Mounted by the app shell alongside the toast layer. 30 tests pinning state transitions, timing, event routing, cleanup.

- **Increment B — System-event messages in chat** (delivered). `_post_response` now appends a `system_event: true` message after successful compaction and before the `compacted` broadcast. The message carries the case name, boundary info (reason + confidence for truncate, fallback line for summarize-without-boundary), and before/after token/message stats. Summarize cases embed the detector's summary text in a collapsible `<details>` block. The event persists to both the context manager (for LLM visibility on the next turn) and the JSONL history store (for session reload and history-browser search). The broadcast's `messages` field is re-read from context after the append so the frontend gets the event in the first paint, avoiding a flicker. 11 tests covering both happy paths, both stores, error-path suppression, ordering guarantees, and direct helper-function formatting.

- **Follow-up — Capacity bar** (`0b571d9`). Thin horizontal bar at the dialog bottom showing current history tokens vs. the configured compaction trigger. Colour tracks the standard tri-state (green ≤75%, amber 75–90%, red >90%) so the user can anticipate when the next turn will trigger compaction. Backend: `LLMService` now sets `_restored_on_startup` when `_restore_last_session` loads prior messages and broadcasts `sessionChanged` from `complete_deferred_init` so the frontend's Context tab and TokenHUD can refresh their budget displays from the restored history — they have no equivalent path through `get_current_state` and would otherwise show stale empty displays. Frontend: new `_historyStatus` reactive property on `AppShell`, `_fetchHistoryStatus` RPC call to `LLMService.get_history_status`, three refresh triggers (`stream-complete`, `session-changed`, `compaction-event`), `_renderCompactionBar` helper, CSS bar positioned above the bottom resize-handle hit zone. Context tab and TokenHUD also subscribe to `session-changed` so their own breakdowns stay consistent with restored sessions. Four delivery bugs caught and documented: (1) the field-name mismatch — backend ships `compaction_enabled` / `compaction_trigger` / `compaction_percent`, not the unprefixed forms an earlier draft assumed; (2) `.bind(this)` missing on the shared event handler caused `this` to be undefined at dispatch time; (3) `typeof fn !== 'function'` guard was rejecting the jrpc-oo Proxy-wrapped callable whose typeof is not `'function'` — matched the style of `_fetchCurrentState` which just calls the method directly; (4) without the startup broadcast, Context tab and TokenHUD showed empty budgets until the first LLM response.

### Original plan (for reference)

History compaction is fully implemented end-to-end (backend compactor, detector closure, streaming-handler invocation, frontend event handling, config). Two small UI enhancements remain: a progress overlay during the blocking detector call, and compaction events visible in the chat scrollback.

A third candidate — a dedicated "Compact Now" button — was considered and dropped. Starting a new session already provides what proactive compaction would offer (clean context, freed budget) with clearer semantics. The only case compact-now would serve differently (keep the thread, shrink it) is niche and handled automatically by the threshold check on the next response.

A fourth candidate — a dedicated compaction log modal with its own persistent store — was reduced to the simpler system-event approach below. Compactions now piggyback on the existing system-event infrastructure (same path as commit / reset / mode switch messages), surfacing in both the live chat scrollback and the history browser without new storage, new RPCs, or new modal components.

### Increment A — Progress overlay during compaction

Currently a toast says "Compacting conversation..." and disappears. Compaction can take 10–30 seconds (detector LLM call + message reshuffle); users stare at an empty screen. A persistent overlay with elapsed-time feedback fixes this without any backend change — the event stream already fires `compacting` → `compacted` / `compaction_error`.

- new `webapp/src/compaction-progress.js` — floating overlay component
  - listens for `compaction-event` window events (same channel the chat panel's `_onCompactionEvent` already uses)
  - on `stage: "compacting"` → appears with spinner, "Compacting history" label, elapsed-seconds counter ticking once per second
  - on `stage: "compacted"` → shows "Done — {case}" for 800ms then fades over 400ms
  - on `stage: "compaction_error"` → shows "Compaction failed" with error message for 3s then fades
  - positioned top-center of the viewer area; high z-index so it floats above the dialog but below toasts
  - cleans up the interval timer on disconnect
  - ignores `url_fetch` / `url_ready` events (those share the channel but belong to URL fetching)
- `webapp/src/app-shell.js` — import and mount `<ac-compaction-progress>` alongside the toast layer
- `webapp/src/compaction-progress.test.js` — 8–10 tests: initial hidden state, appears on compacting event, elapsed counter ticks, wrong-stage events ignored, transitions compacting → compacted with 800ms success display, compacted → hidden after fade, error stage shows message, disconnect clears timer, URL events don't activate the overlay

No change to the event callback contract, no change to the compactor, no new RPCs. Pure frontend.

### Increment B — Compaction events in chat scrollback

Compaction is a conversation-shaping event. Committing, resetting, and switching modes all produce system-event messages in the chat history. Compaction should too — it gives the user transparency (what was removed, when, why), searchability via the history browser's existing search, and persistence via the existing JSONL path.

No new storage file, no new RPC, no new component. Reuses the `system_event: true` message flag that `commit_all` and `reset_to_head` already produce.

**Shape of the system-event message** (3-part, keeps one-line scanability while giving substance to the search hits):

```
**History compacted** — truncate

Boundary: user switched from auth work to logging review (confidence 0.92)

Removed 18 messages • 24000 → 8400 tokens
```

For the summarize case, an additional collapsible section embeds the detector's summary text so users can see what was summarized:

```
**History compacted** — summarize

No clear topic boundary detected; summarized earlier context.

Removed 32 messages • 28000 → 9200 tokens

<details>
<summary>Summary</summary>
The prior conversation covered adding a rate limiter to the auth endpoint...
</details>
```

The `<details>` tag renders natively in the chat panel's markdown path (marked.js with gfm enabled passes HTML through). Searchable because the text is in the message content.

**Backend changes:**

- `src/ac_dc/llm_service.py` — in `_post_response`, after the successful `context.set_history(result.messages)` + `tracker.purge_history()` path, build the event text and call `context.add_message("user", event_text, system_event=True)` plus (if `history_store`) `history_store.append_message(session_id=session_id, role="user", content=event_text, system_event=True)`. The `session_id` is the one captured at the top of `_post_response` — same pattern as `commit_all_background`. Do NOT append on the error path (the `compaction_error` event is enough; appending a message about a failed compaction to history that we couldn't compact would be noise).
- new private helper `_build_compaction_event_text(result, tokens_before, tokens_after, messages_before_count, messages_after_count) -> str` — produces the 3-part text. Tokens before/after measured at the `_post_response` call site (before the compactor runs, and after `set_history` installs the new list).
- the event message goes into the context AFTER the history replacement, so the chat panel sees the compacted list with the system event already appended. This matters because on a browser reload the system-event message needs to reflect the final state, not a pre-compaction state.

**Tests:**

- `tests/test_llm_service.py` — extend `TestStreamingHappyPath` or add a new `TestCompactionSystemEvent` class
  - triggers compaction via a tiny `compaction_trigger_tokens` value, seeded history, controlled detector
  - asserts a system-event message lands in both the context manager's history and the `HistoryStore` JSONL
  - asserts the content contains `**History compacted**`, the case name, the boundary reason (or "No clear topic boundary" for summarize-with-no-boundary), and the token counts
  - asserts the `<details>` block is only added for summarize case
  - asserts error-path compaction does NOT add a system event
  - asserts the message is added AFTER `set_history`, so it's the final entry in the compacted history
- `tests/test_history_store.py` — add a sanity test that `search_messages("History compacted")` finds the event (already covered by generic search but worth pinning the specific string so a future rename catches a test failure)

**Frontend changes:** none. The chat panel's existing system-event rendering path handles this already (distinct styling, search hit highlighting, history-browser visibility). The `<details>` tag renders via the existing marked.js pipeline.

### Delivery order

1. **Increment A** first — pure frontend, no RPC changes, low risk. Immediate UX win.
2. **Increment B** second — backend change is small (one method call + helper) but touches the streaming lifecycle; tests verify the event reaches both stores and renders correctly.

Each increment is a standalone commit with tests alongside. After each lands, strike through the heading here and add a one-line delivery note.

## File picker completion plan

Backend status / diff / branch data flows into `files-tab.js` via `_loadFileTree` today but is discarded at the picker boundary. The picker renders a plain file list with a line count. The plan below closes the gap in 12 increments, each with tests alongside. Order prioritises visible value per commit and dependency order (data plumbing before interaction, simple renders before complex state).

Per-increment contract:
- one coherent feature per commit
- tests land with the code (webapp test infrastructure is mature — `vitest` run catches regressions)
- picker stays in a working state between commits
- the IMPLEMENTATION_NOTES.md plan updates after each lands, striking through what's delivered and adding a short delivery note

### ~~Increment 1 — Status badges + diff stats + line-count color~~ (delivered)

Pure render change. `Repo.get_file_tree()` already returns `{modified, staged, untracked, deleted, diff_stats}` arrays; files-tab now surfaces them via the picker's `statusData` prop. Line-count color thresholds (green < 130, orange 130–170, red > 170) render on file rows.

### ~~Increment 2 — Branch badge + tooltips~~ (delivered `71ea694`)

- `files-tab.js` fires `Repo.get_current_branch` in parallel with `Repo.get_file_tree` via `Promise.allSettled`. A branch-fetch failure degrades gracefully (log + no pill) rather than blocking the tree render. `tree.name` threaded into `branchInfo.repoName` as a fallback so the root row renders even when branch info is absent.
- `file-picker.js` gains `branchInfo` reactive prop with safe defaults. New `_renderRoot()` + `_renderBranchPill()` helpers emit a non-interactive root row with repo name and a branch pill (muted gray for normal branches, orange with short SHA for detached HEAD). Full SHA in tooltip on detached pill.
- `_tooltipFor(node)` helper produces `{path} — {name}` tooltips, reducing to just `{name}` when path and name match (top-level entries).
- 16 new tests covering root rendering, branch pill states (normal / muted / detached / empty-repo / null-prop / malformed response), tooltip forms, plus 8 files-tab plumbing tests (RPC fires, picker receives, repoName threading, detached response, branch failure isolation, tree failure fatality, refresh on files-modified, malformed response tolerance).
- Five pre-existing `.name` queries scoped to `.row.is-dir:not(.is-root) .name, .row.is-file .name` so the new root row doesn't inflate counts. One duplicate test block from a partial earlier edit was removed; the canonical "when they differ" version remains, asserting `path === name` → just `{name}` (no redundant `src — src`).

### ~~Increment 3 — Sort modes~~ (delivered `1e32eb2`)

Three sort-mode buttons (A / 🕐 / #) in the filter bar. Clicking a different mode switches to it and resets direction to ascending (fresh sort starts at the familiar anchor — A-Z, oldest-first, smallest-first). Clicking the active mode toggles direction. Active button gets `.active` styling + `aria-pressed="true"` + direction glyph (↑/↓); inactive buttons show mode glyph only. Mode and direction persisted to localStorage keys `ac-dc-sort-mode` and `ac-dc-sort-asc`; restored on mount with safe defaults when storage is missing, unknown, or malformed. Directories always sort alphabetically ascending regardless of mode or direction — users expect a stable directory layout, and mtime/size aren't meaningful for directory nodes (the file-tree schema doesn't populate them for dirs).

Implementation was already present in `file-picker.js` when tests landed — `sortChildrenWithMode`, `SORT_MODE_*` constants, `_loadSortPrefs`/`_saveSortPrefs`, `_renderSortButtons`, `_onSortButtonClick`. The commit adds 25 tests across two describe blocks: 13 helper tests for `sortChildrenWithMode` (dir-before-file invariant across all modes, name/mtime/size each in both directions, direction-ignored for dirs, unknown-mode fallback, missing-field tolerance, falsy-child filtering, no-mutation), 12 component-level tests for the sort buttons (render shape, default state, one-active-at-a-time, mode switch resets direction, active toggle flips direction, files render in selected order, dirs alphabetical regardless, localStorage round-trip for mode + direction, malformed-storage fallback, direction-glyph on active button only).

Design points pinned by tests:

- **Mode switch resets direction to ascending.** Clicking a different mode sets `_sortAsc = true` rather than preserving the previous direction. Users scanning a new axis expect the familiar anchor first — A-Z for name, oldest for mtime, smallest for size. Pinned by `test_clicking_a_different_mode_switches_and_resets_to_ascending`.

- **Direction glyph only on the active button.** Inactive buttons show just the mode glyph (A / 🕐 / #); the active one appends ↑ or ↓. Keeps the filter bar compact while making the current state unambiguous. Pinned by `test_active_button_shows_direction_glyph;_inactive_buttons_do_not`.

- **Malformed storage falls back to defaults, doesn't crash.** `_loadSortPrefs` validates mode against `SORT_MODES` and direction against `'1'`/`'0'`; anything else produces `name` / ascending. Private-browsing localStorage exceptions are swallowed. Pinned by `test_ignores_unknown_mode_in_localStorage` and `test_ignores_malformed_direction_in_localStorage`.

- **Directory ordering is an invariant, not a preference.** Every test mode exercises the dir-stay-alphabetical rule. A future refactor that "helpfully" made dirs participate in mtime or size sort would trip `test_directories_stay_alphabetical_regardless_of_mode` which iterates all three modes and both directions.

- **Defensive field handling.** Missing `mtime` → treated as 0 (oldest). Missing `lines` → treated as 0 (smallest). Missing `name` → empty string for localeCompare. Null/undefined children filtered out. Catches malformed tree data from backend without crashing the comparator.

### ~~Increment 4 — Auto-selection of changed files on first load~~ (delivered)

Opens the app with every file that has pending work already ticked — user doesn't have to re-select what they were clearly just editing. Union (not replace) semantics preserve any selection the server broadcast during startup (collab host's state, prior session restore). Ancestor directories of auto-selected files expand so the checkboxes are visible without manual clicking.

Implementation in `files-tab.js`:

- `_initialAutoSelect` boolean field, initialised `true`. Flips to `false` the first time `_loadFileTree` gets past its `await`. Never resets.
- `_applyInitialAutoSelect()` — collects the union of `modified`, `staged`, `untracked`, `deleted` sets, unions with existing `_selectedFiles`, calls `_applySelection(union, notifyServer=true)`. When the union is empty (clean working tree) the method returns early — no `_applySelection` call, no server RPC, silent startup.
- `_expandAncestorsOf(paths)` — mutates the picker's `_expanded` set directly (same pattern as the file-search `_onFileSearchScroll` handler). Splits each path on `/`, accumulates prefix strings stopping before the last part (which is the file itself). Ancestor additions are a union with whatever the picker already has expanded, so pre-existing user expansion survives.
- Flag flip is synchronous — flipped BEFORE `_applyInitialAutoSelect` runs, so a hypothetical re-entrant load can't double-fire. Tree-load failures leave the flag at `true` so a subsequent successful load (via `files-modified`) can still auto-select.

13 new tests in a `first-load auto-select` describe block:

1. auto-selects modified files + notifies server
2. unions all four change categories (modified/staged/untracked/deleted); clean files stay unselected
3. skips server notification when no files are changed (clean startup is silent)
4. unions with existing selection rather than replacing (seeded via `files-changed` before tree load resolves)
5. skips server notify when union equals existing selection (set-equality short-circuit inside `_applySelection`)
6. runs exactly once per component lifetime — second load from `files-modified` does not re-select (would undo user's manual deselections)
7. flag flips synchronously — always `false` after mount settles
8. expands ancestor directories of nested auto-selected files
9. expands ancestors across multiple subtrees
10. top-level files produce no expansion (no ancestors to expand)
11. preserves user-expanded directories (union semantics, not replacement)
12. skipped entirely when tree load fails — flag stays `true`
13. runs on next successful load after initial failure (transient errors recoverable)

Three existing tests needed `set_selected_files` stubs added because they seed non-empty status arrays and now trigger the auto-select's notify path: `plumbs git status data through to the picker`, `passes status arrays through to the picker as Sets`, `refreshes status data on files-modified`. Stubs are trivial — `vi.fn().mockResolvedValue([])` — and each gets a comment explaining why it's there so future maintainers don't treat them as noise.

Design points pinned by tests:

- **Once per lifetime, not per load.** A user who deselects an auto-selected file should see that deselection survive across a commit. The second `_loadFileTree` call (from `files-modified`) skips the entire auto-select block. Pinned by test 6 — deselect `b.md`, trigger reload, assert `b.md` stays deselected even though it's still in the `modified` array. Without this, the feature would become the opposite of useful: every commit would fight the user.

- **Union, not replace.** Test 4 seeds a prior selection (`prior.md`) via a `files-changed` broadcast that races the tree load to completion, then verifies both `prior.md` AND the auto-selected `new.md` end up selected. Collab and session-restore both depend on this — the server's authoritative state must not be overwritten by our local auto-select logic.

- **Notify-server gates on actual change.** Tests 3 and 5 pin that the server isn't called when nothing changed. Matters for network cost in large collab sessions and for test signal-to-noise — an auto-select that always notifies would pollute every unrelated test's RPC call count.

- **Flag survives failed loads.** Test 13 reproduces the transient-network case — first RPC rejects, user sees a toast, files-modified triggers a retry, second RPC succeeds. The auto-select runs on the retry because the flag is only flipped AFTER the await resolves successfully. If we flipped before the await (or inside a `finally`), the retry would silently skip the auto-select and the user would have to manually re-tick.

- **Ancestor expansion is side-effect, not prerequisite.** The auto-select still completes even if the picker isn't mounted yet (`_expandAncestorsOf` returns early when the picker isn't reachable). In the extremely rare case where the picker mounts after the first load, the user can still reach the auto-selected files by manually expanding — nothing is broken, just less polished.

### ~~Increment 5 — Three-state checkbox with exclusion~~ (delivered)

Picker now supports the three-state interaction (normal / selected / excluded) with shift+click as the exclusion gesture. Backend RPC `set_excluded_index_files` already existed from Layer 3.10; frontend wires it via the same direct-update pattern as selection.

- `file-picker.js` — new `excludedFiles` Set property (parent-owned, pushed via `_pushChildProps`). `_onFileCheckbox` branches on `event.shiftKey`: shift+click toggles exclusion via new `_toggleExclusion(path)` helper; regular click on excluded file un-excludes AND selects in one step (matches specs4 "Regular click on an excluded file — un-excludes and selects"). `_onDirCheckbox` adds shift+click branch that toggles exclusion for every descendant file; regular click on a dir with excluded descendants un-excludes them as a side effect (specs4 "Regular click to select directory children — un-excludes any excluded children"). New `_emitExclusionChanged(newSet)` helper dispatches `exclusion-changed` with `bubbles: true, composed: true`. `_renderFile` applies `is-excluded` class when applicable, renders `✕` badge, adapts the checkbox tooltip. `_tooltipFor` accepts `isExcluded` flag and appends "(excluded)" so the state is visible on hover.

- `files-tab.js` — `_excludedFiles: Set` field in constructor. `_pushChildProps` pushes `excludedFiles` alongside `tree` / `statusData` / `branchInfo`. New `_onExclusionChanged` handler and `_applyExclusion(newExcluded, notifyServer)` helper (same shape as `_applySelection` — set-equality short-circuit prevents loopback). `_sendExclusionToServer` calls `LLMService.set_excluded_index_files` and surfaces restricted / error responses via toast. Template binds `.excludedFiles=${this._excludedFiles}` on the picker and `@exclusion-changed=${this._onExclusionChanged}`.

- Tests — 18 new picker tests (visual class, ✕ badge presence, tooltip adaptations, all four shift+click paths, `preventDefault` on shift+click but not regular click, shift+click on dir excludes all, shift+click on all-excluded dir un-excludes, shift+click on dir with selected children excludes AND deselects, regular dir click un-excludes any excluded children, event bubbles across shadow, default Set prop). 8 new files-tab tests (initial push, dispatch triggers RPC, internal state + picker prop update, short-circuit on redundant updates, restricted toast, RPC rejection toast, malformed payload tolerance, tree reload preserves exclusion state).

Design points pinned by tests:

- **Shift+click vs regular click — `preventDefault` asymmetry.** The shift+click path ALWAYS calls `preventDefault()` on the native checkbox event. Without it, the browser's own toggle fires before our state change, producing a one-frame visual glitch where the checkbox flips, then flips back on our re-render. The regular click path does NOT preventDefault because the native toggle's resulting state matches ours (or the reactive `.checked` binding on the next render enforces consistency). Pinned explicitly by separate tests — the asymmetry is easy to miss in a future refactor.

- **Regular click on excluded = un-exclude AND select (one step).** Specs4 calls this out as a single gesture. The handler dispatches BOTH events in sequence (`exclusion-changed` first, then `selection-changed`) — the orchestrator's two RPCs fire back-to-back. Could be collapsed into a single combined event, but keeping them separate keeps the per-event contract clean and lets each RPC short-circuit independently.

- **Selected and excluded are mutually exclusive.** `_toggleExclusion` always deselects when adding to the excluded set. `_onDirCheckbox`'s shift+click branch deselects descendants when excluding them. A file can be in exactly one of: selected, excluded, or neither (the default index-only state). Without this invariant, the LLM service's `_update_stability` would have to arbitrate between conflicting tracker entries for the same path.

- **Shift+click from excluded returns to NORMAL, not selected.** The three-state cycle is normal → shift+click → excluded → shift+click → normal. Going to "selected" on the back-swing would be surprising — the user's shift+click gesture meant "change index inclusion," not "select." The regular-click-on-excluded path covers the "I want this selected AND re-included" case with a single gesture.

- **Dir click un-excludes descendants as a side effect.** A user ticking a parent directory's checkbox to select all its files doesn't want some children silently excluded afterwards. Regular dir click un-excludes first, then applies the normal select-all logic. Pinned by `regular click on dir with excluded children un-excludes them` — checks both the exclusion-changed event (empties the set) and the selection-changed event (selects every descendant).

- **`excludedFiles` prop default is an empty Set.** Constructor initialises the field so `_renderFile`'s `Set.has()` calls have a target before the first server response. Without the default, `new FilePicker()` would have `excludedFiles = undefined` and every render would throw. Pinned by `excludedFiles prop default is an empty Set`.

- **Tree reload preserves exclusion state.** The `_excludedFiles` Set lives in the orchestrator and isn't touched by `_loadFileTree`. `_pushChildProps` pushes it to the picker on every reload alongside the new tree. Exclusion state survives commits, file changes, and manual refreshes — only the user explicitly un-excluding a file removes it from the set.

Open carried over for later increments:

- **Collab broadcast of excluded state.** Layer 4.4's CollabServer doesn't currently emit a broadcast when `set_excluded_index_files` is called; only `set_selected_files` has that plumbing. Adding the broadcast would let a collab host's exclusion changes reach participants without a full reload. Not blocking any current flow (single-user operation works fully; participants can't call the RPC anyway per 4.4's restrictions).
- **Context menu items for include / exclude.** Specs4 calls for these as an alternative to the shift+click gesture. Lands with Increment 8 (context menu) — the exclusion backend + event path is already in place, so the menu items just dispatch `exclusion-changed` with the appropriate set.

### ~~Increment 6 — Active-file highlight~~ (delivered)

Picker row matching the viewer's active file gets an accent-blue background + left-border stripe. The viewer (diff or SVG) already dispatches `active-file-changed` events on open / close / tab switch; the shell catches them in its own `_onActiveFileChanged` (for viewer visibility toggling) but doesn't call `stopPropagation`, so the event continues bubbling to the window. Files-tab listens there rather than waiting for the shell to re-dispatch.

- `file-picker.js` — new `activePath` string prop (defaults null). `_renderFile` computes `isActive = node.path === this.activePath` and adds the `active-in-viewer` class to the file row alongside `focused` and `is-excluded`. CSS applies an accent background + `box-shadow: inset 3px 0 0` for the left stripe + accent text colour on the name. The three visual states (focused, excluded, active-in-viewer) coexist cleanly — they each contribute distinct styling without colliding.

- `files-tab.js` — new `_activePath` field, bound `_onActiveFileChanged` handler registered on `window` in `connectedCallback` and removed in `disconnectedCallback`. Handler extracts `detail.path`, validates it's a non-empty string (or null for the close-all case), short-circuits when unchanged, and pushes to the picker via direct-update. `_pushChildProps` pushes `activePath` on every tree load so the highlight survives reloads.

- Tests — 7 new picker tests (`active-in-viewer` class on matching row, null produces no highlight, non-existent path is silent no-op, reactive update on path change, coexists with selection, coexists with exclusion, default is null). 7 new files-tab tests (push on first event, switch between files, clear when viewer closes all, short-circuit on duplicate events via requestUpdate spy, tolerates malformed detail, survives tree reload, unregisters on disconnect).

Design points pinned by tests:

- **Event reaches files-tab via window bubbling, not via shell relay.** The viewer dispatches `active-file-changed` with `bubbles: true, composed: true`, the shell's `@active-file-changed` binding fires during the bubble (shell flips `_activeViewer`) but doesn't `stopPropagation`, so the event continues to `window`. Files-tab's window listener catches it. No new event name, no shell code change. Simpler than adding a relay — shell doesn't need to know about picker-side highlighting.

- **Null path is a valid state.** Viewer fires with `path: null` when the last file closes. The handler treats this as "clear the highlight" rather than ignoring it. Without this, closing the final file would leave the picker showing a stale highlight indefinitely. Pinned by `clears activePath when viewer closes all files`.

- **Defensive path validation.** `typeof detail.path === 'string' && detail.path` — numbers, objects, empty string, and missing detail all collapse to null. A corrupt viewer event shouldn't either throw or apply a highlight to a row matching the stringified junk. Pinned by `tolerates missing detail (defensive)`.

- **Short-circuit via `nextPath === this._activePath`.** Re-dispatching the same path (which happens legitimately — opening the already-active file from the picker fires the event again) must not trigger another picker re-render. Pinned by spying on `picker.requestUpdate` and counting calls across two events.

- **`activePath` is independent of `_focusedPath`.** Focused-path is file-search-overlay state (match scrolled to that file); active-path is viewer state (file open in a tab). They CAN collide — user searches for a file that's already open — and when they do, both classes apply. CSS styling is distinct enough that both readings are legible.

- **Visual state orthogonality.** Three row states (selected via checkbox, excluded via `is-excluded`, active via `active-in-viewer`) compose without mutual exclusion. A file can be selected + active + excluded all at once — specs4 calls this out: "a user can have an excluded file open in the viewer; they might be reading it without wanting it in the LLM's context." Both `coexists with selection` and `coexists with exclusion` pin this.

Not included (explicit scope boundaries):

- **Scroll-into-view on active change.** The spec doesn't call for auto-scrolling the picker to keep the active row visible. If the user manually scrolls past the active row and then switches files in the viewer, the highlight moves but the picker's scroll position doesn't follow. Users scanning code in the viewer typically aren't looking at the picker simultaneously, so the absence of auto-scroll isn't a regression. If usage shows otherwise, it's a one-line addition to the handler.
- **Highlight for directory containing active file.** Would be visually noisy — the picker already expands parent dirs for various reasons, and adding a highlight cascade would compete with selection and exclusion styling. File-level only keeps the signal clean.

### ~~Increment 7 — Keyboard navigation~~ (delivered)

Picker tree is now fully keyboard-navigable when the scroll container has focus. Arrow keys, Home/End, Enter/Space for activation. Focus state reuses the existing `_focusedPath` (same state file-search uses to highlight its current match) so exactly one highlighted row exists at all times.

- `file-picker.js` — `<div class="tree-scroll" tabindex="0" @keydown=${this._onTreeKeyDown}>`. The tabindex makes it Tab-focusable; subtle `box-shadow: inset 0 0 0 2px var(--accent-primary)` in `:focus-visible` shows where keyboard focus landed.
- Handler dispatches on `event.key`: ArrowDown / ArrowUp move within `_collectVisibleRows()` output (a flat traversal honouring current expansion + filter), clamping at start/end. ArrowRight expands a closed dir, or moves to first child if already open (files: no-op). ArrowLeft collapses an open dir, or moves to parent dir path. Enter/Space toggle selection on file OR expansion on dir. Home/End jump to first/last visible row.
- `_collectVisibleRows()` walks the filtered tree through `sortChildrenWithMode` so the order exactly matches the rendered row sequence. Collapsed dirs hide their children from the navigation list.
- `_setFocusedAndScroll(path)` defers the scroll through `updateComplete.then(...)` so layout changes from the same keystroke (expanding a dir that pushes later rows down) are reflected before `scrollIntoView` reads the row's position. Uses `data-row-path` attribute on each row for O(1) lookup via `querySelector`; CSS-escape helper handles path characters like `/` and `.`.
- Both file and directory row renders now carry `data-row-path=${node.path}`. Attribute not interpolated inside className strings — Lit's attribute binding handles the escape for us.
- Handler listens on the `.tree-scroll` container, not `document`. Tab order from the filter input → tree → sort buttons, so the handler only fires when the user has actually Tab'd into the tree (or clicked on a row). The chat input's arrow keys never reach this handler.
- Focus recovery: if `_focusedPath` points at a path that's no longer visible (filter typed, dir collapsed), the next arrow press treats it as "no focus" and lands on the first visible row rather than getting stuck.

25 new tests: empty-focus-to-first-row, ArrowDown advance/clamp, ArrowUp backward/clamp, Home/End, ArrowRight on closed dir expands, ArrowRight on open dir moves to first child, ArrowRight on file no-op, ArrowLeft collapses open dir, ArrowLeft on file moves to parent, ArrowLeft on top-level row no-op, Enter/Space selection toggle, Space preventDefault (no page scroll), dir Enter toggles expansion, navigation skips collapsed dirs, descends into expanded dirs, focus recovery after filter hides focused path, empty tree silent, unhandled keys pass through, scrollIntoView called on focus change, tree-scroll tabindex=0, aria-current=true on focused file.

Design points pinned by tests:

- **Shared focus state.** `_focusedPath` is reused across keyboard nav and file-search highlight. A user arrow-navigating during active file search implicitly drives the search cursor forward. The alternative (two parallel focus states with different CSS) would double the visual highlights and create "which one wins" ambiguity.

- **Visible-row order matches render.** `_collectVisibleRows` uses `sortChildrenWithMode` internally so arrow-key order matches exactly what the user sees. Without this, switching to mtime or size sort would produce an invisible "tab order" mismatch.

- **Focus recovery.** If the focused path goes invisible (filter changes, dir collapsed), the handler computes `findIndex` returning -1, treats that as "no focus," and the next arrow lands on row 0. Pinned by `focus recovery when focused path becomes invisible`. Without this, a filter-then-arrow sequence would silently do nothing or throw.

- **`scrollIntoView` uses `block: 'nearest'`.** Minimal motion — only scrolls when the row isn't already fully visible. Matches specs4's "scroll-into-view on focus change" expectation.

- **Deferred scroll via `updateComplete.then`.** Expanding a dir with ArrowRight pushes subsequent rows down. Scrolling before Lit commits the update would read stale positions. The await-then-scroll pattern ensures layout is settled first. Not easily test-observable (jsdom has no layout); pinned indirectly by the `scrollIntoView called on focus change` test passing.

- **Handler scoped to `.tree-scroll`, not document.** Prevents arrow keys from hijacking chat input or filter field. Pinned implicitly — other test files using chat-input arrow keys continue to work because the picker's handler doesn't reach them.

- **`data-row-path` attribute, not ID.** IDs would need uniqueness handling (paths with `/` are valid IDs but browsers sometimes choke on unusual characters). A data attribute is robust and uniquely scoped per-row. `CSS.escape` (with jsdom fallback) handles path characters in the querySelector.

### Increment 8 — Context menu (files)

Largest single feature. Delivered in sub-commits to keep each change reviewable:

- **8a — shell** (delivered): right-click opens menu, positioning with viewport clamping, outside-click + Escape dismissal, action-routing scaffold via `context-menu-action` events.
- **8b — simple RPC actions** (delivered): stage / unstage / discard / delete with confirm.
- **8c — inline-input actions** (delivered): rename / duplicate with inline textbox rendered at row indent.
- **8d — include/exclude + load-in-panel** (delivered): route include/exclude through existing exclusion path; dispatch `load-diff-panel` events.

### ~~Increment 8a — Context menu shell~~ (delivered)

File-row context menu renders on right-click. Position stored as viewport coords; rendered via `position: fixed` at clamped coords so menus opened near screen edges slide inward to stay visible. All menu items in place (stage / unstage / discard / rename / duplicate / load-left / load-right / exclude-or-include / delete) with stubbed dispatchers firing `context-menu-action` events. 8b–8d wire real RPC dispatch on the files-tab side.

- `file-picker.js` — module-level `_CONTEXT_MENU_FILE_ITEMS` catalog (nine actions plus four separators). Each entry has `action`, `label`, `icon`, optional `destructive` flag, optional `showWhen` gate. Include/exclude items are a pair with opposite `showWhen` guards so exactly one is visible per target state. Action IDs exported as `CTX_ACTION_*` constants for test pinning.
- Reactive `_contextMenu` state (`{type, path, name, isExcluded, x, y}` or null). Viewport margin constant `_CONTEXT_MENU_VIEWPORT_MARGIN = 8`. Estimated menu size (240×320) used by the clamp math — conservative so menus near the right/bottom edge slide inward before render.
- `@contextmenu` binding on file rows. Calls `preventDefault` + `stopPropagation`, records click coords, attaches document-level listeners for outside-click and Escape.
- Document listeners capture-phase so they see events before in-tree handlers stop propagation. `composedPath` walk distinguishes inside-menu clicks from outside — the menu's own button clicks take the `_onContextMenuAction` path, not the dismiss path.
- Menu renders as a sibling of `.tree-scroll` with `position: fixed`, escaping any scrolling containers. Action items carry `data-action` attributes for test selectors and carry `.destructive` class for delete (red-tinted hover state).
- `_onContextMenuAction` dispatches `context-menu-action` with `{action, type, path, name, isExcluded}` detail, closes the menu, releases listeners.
- `disconnectedCallback` calls `_closeContextMenu` so a mid-menu unmount (tab switch, parent re-render) releases document listeners and clears state.

21 new tests — right-click opens menu, position matches click coords, `preventDefault` fires, context state carries path/name/isExcluded, include vs exclude mutual exclusion, all nine actions present, four separators rendered, delete is `.destructive`, Escape dismisses (only when menu open — no-op otherwise), click outside dismisses, click inside doesn't pre-empt action, action event detail shape, menu closes after dispatch, right-clicking second row switches targets (not stacks menus), viewport clamping at right/bottom edges, corner clamping to margin, disconnect closes + releases listeners, event bubbles across shadow, stopPropagation on the right-click.

Design points pinned by tests:

- **Capture-phase document listeners.** Outside-click detection needs the event before any child handler stopPropagation could suppress it. The browser's standard `click` event bubbling through shadow DOM sees the shadow host as target, not the menu. Capture-phase + `composedPath` gives us the full path through the shadow boundary.

- **Inside-menu click doesn't pre-empt action.** The document listener runs first (capture), walks `composedPath`, and finds the menu class on one of the ancestors. So it returns without closing. The menu item's own click handler then fires (normal bubbling), dispatches the action event, and explicitly closes. Pinned by `click inside the menu does not close it before the action runs` — a naive "any click closes" implementation would drop the action.

- **Viewport clamp uses conservative size estimate.** Menu's actual rendered dimensions aren't known until after render. Using a fixed 240×320 estimate (large enough for the worst case — all file actions visible) means a menu near the right or bottom edge clamps inward BEFORE render rather than sliding into place via a second render pass. Graceful if the estimate undershoots: menu still appears, just potentially with part of its border off-screen.

- **Right-click second row swaps targets.** Two consecutive right-clicks on different rows produce ONE menu (the second target), not two stacked. Pinned by `right-click on a second row while menu open switches targets`. The opening path calls `_closeContextMenu` first so listener attach/detach stays balanced.

- **Escape scope control.** Document-level Escape listener only `preventDefault`s when a menu is open. Pinned by `Escape only consumes the event when menu is open`. Without this, every Escape press anywhere in the page would be hijacked and, e.g., stop break out of modals/textboxes.

- **Destructive class for delete only.** Just the delete item gets the red-tinted hover. Pinned by `delete action renders with destructive class`. Stage / unstage / discard don't — they're recoverable actions; delete is permanent (from the picker's perspective — it's `git rm` on the server side, still recoverable through git history, but the UI treats it as serious).

- **Include/exclude mutual exclusion.** The `showWhen` gate on the two items filters at render time. Non-excluded file shows "Exclude from index"; excluded file shows "Include in index". Two tests pin both directions.

- **Disconnect closes + releases.** `disconnectedCallback` override calls `_closeContextMenu`, which releases document listeners. Without this, a picker removed mid-menu would leak listeners permanently. Pinned by `disconnect closes menu and releases listeners` — verifies the menu state is null and a subsequent `document.body.click()` doesn't throw (which would indicate a stale handler still trying to call back into an unmounted element).

Next sub-commit — **8b**: wire the simple RPC actions (stage / unstage / discard / delete with confirm) in `files-tab.js`. Picker already fires `context-menu-action` with the right detail; the orchestrator listens and dispatches to `Repo.*` RPCs with toast feedback.

### ~~Increment 8b — Stage / unstage / discard / delete~~ (delivered)

Four context-menu actions now dispatch to real RPCs. Stage and unstage are fire-and-forget. Discard and delete prompt for confirmation via `window.confirm` before the RPC fires. Every action path reloads the file tree on success so status badges update; every failure surfaces via `ac-toast` window events (restricted as warning, RPC rejection as error); collaboration-mode `{error: "restricted"}` responses route to the warning toast just like selection changes do.

- `files-tab.js` — new `_onContextMenuAction(event)` dispatcher catches `context-menu-action` bubbling from the picker. Filters to `type === 'file'` (directory menus reserved for a later sub-commit), validates the path shape, then routes on `action` to one of four per-action async methods: `_dispatchStage`, `_dispatchUnstage`, `_dispatchDiscard`, `_dispatchDelete`.
- `Repo.stage_files` / `Repo.unstage_files` / `Repo.discard_changes` accept path arrays; each dispatcher wraps the single path in `[path]` for consistency with the multi-path form. `Repo.delete_file` takes a raw path; delete sends it unwrapped (and the test pins this asymmetry).
- `_confirm(message)` is a thin wrapper around `window.confirm` that tests can stub cleanly. Real implementation delegates directly; the wrapper exists so tests don't have to reach into global state for every confirmation path.
- `_isRestrictedError(result)` shared helper for the four new dispatchers. Matches the pattern inline-defined in `_sendSelectionToServer` / `_sendExclusionToServer` — the older sites weren't migrated since they're stable code paths, but new dispatchers use the helper to avoid copy-paste.
- Delete also clears the file from `_excludedFiles` if it was excluded — a deleted file no longer exists in the tree, so carrying an exclusion entry for a non-existent path would be a dead reference. Selection is cleared by the server's `filesChanged` broadcast if the deleted file was selected; exclusion has no such broadcast yet, so we clear locally and notify via `_applyExclusion`.
- Unrecognised actions (rename / duplicate / load-left / load-right / include / exclude) fall through the dispatcher silently. They're the contract targets of 8c and 8d; picking them up here would require disabling the menu items (specs4 says they stay visible) or logging noise on every right-click preview. Silent drop + sub-commit coverage is cleaner.
- `_onContextMenuAction` bound in the constructor alongside the other bound handlers. Template binding added to `ac-file-picker` alongside the existing picker event listeners. No new window-level listeners — the event reaches us via shadow-DOM bubbling through Lit's property-binding path.

Twenty-six new tests across five describe blocks: stage (five tests — RPC shape, reload, success toast, restricted warning, error toast), unstage (two — RPC shape, reload; error paths share the stage pattern and don't need duplicating), discard (five — confirm prompt, cancel no-op, RPC shape, reload, error toast), delete (five — confirm prompt, cancel no-op, unwrapped path, reload, clears exclusion), edge cases (three — malformed detail, non-file types, unknown actions).

Design points pinned by tests:

- **Confirm prompt is blocking and mandatory for destructive actions.** Discard and delete both call `_confirm(...)` and bail early if the user cancels. `does not call RPC when user cancels` pins this for both — no RPC, no tree reload, no toast. The message includes the file path so users know exactly what's about to go away.

- **`_confirm` wrapper insulates tests from the global prompt.** Tests stub `window.confirm` with a vitest mock returning `true` or `false` for the duration of a block. Real code path is `window.confirm(message)` so production keeps the native modal.

- **`Repo.delete_file` takes a raw path; stage / unstage / discard take arrays.** The test `calls Repo.delete_file with the raw path (not wrapped)` pins the asymmetry. It matches the RPC layer's actual contract — `delete_file` is single-target by design since there's no natural batch-delete semantic in git; the others accept arrays because `git add -- a b c` and friends genuinely do batch.

- **Deleted files are cleared from exclusion locally.** Server doesn't broadcast excluded-set changes (as of 4.4.2 — only selection gets `filesChanged`), so the tab clears `_excludedFiles` when deleting an excluded file. Otherwise re-adding a file at the same path would find it mysteriously pre-excluded. Pinned by `clears exclusion for the deleted path if it was excluded`.

- **Restricted errors surface as warning toast, RPC rejection as error toast.** Same shape the picker's selection / exclusion paths use. Collab participants see "Participants cannot stage files" rather than a generic failure. Pinned by `surfaces restricted error as warning toast` and `surfaces RPC rejection as error toast`.

- **Malformed events are silently dropped.** A `context-menu-action` without detail, or with non-string action, missing path, empty path, or non-file type, does not fire any RPC. Pinned by `ignores malformed event detail` which fires five malformed variants and asserts `stage` was never called. Catches regressions where a future refactor might crash on null-detail or on type coercion.

- **Unknown actions don't trigger implemented RPCs.** Firing `rename`, `duplicate`, `load-left`, `load-right`, `include`, `exclude`, or `bogus` doesn't accidentally route to the implemented dispatchers. Tests on all seven. Matters because the picker renders the menu items today and 8c/8d will implement them later; nothing should leak into the active code paths in the interim.

Next sub-commit — **8c**: inline-input pattern for rename and duplicate. Rename shows an inline textbox at the row's indentation level, pre-filled with the current name and auto-selected. Duplicate shows the same pattern pre-filled with the full path so the user can edit the target location. Enter submits, Escape / blur cancels.

### ~~Increment 8c — Rename and duplicate via inline input~~ (delivered)

Rename and duplicate both use the same inline-input pattern: the picker renders a textbox in place of (rename) or below (duplicate) the target file row, pre-filled with a sensible starting value, and the commit handler fires a `rename-committed` or `duplicate-committed` event back to the orchestrator. The orchestrator owns the RPC dispatch, including the file-vs-directory routing for rename.

- `webapp/src/file-picker.js` — additions:
  - `_renaming` and `_duplicating` non-reactive fields on the constructor. Null when no inline input is active; a path string when one is. Mutually exclusive — `beginRename` clears `_duplicating` and vice versa, so users can't accidentally open two inputs at once.
  - `beginRename(path)` and `beginDuplicate(path)` public methods. Callers (the files-tab orchestrator, in response to context-menu action events) pass the source path; the picker handles the input lifecycle. Defensive against empty / non-string paths.
  - `_renderInlineInput({ mode, sourcePath, sourceName, depth })` — renders a row with the same two-level indent as file rows so the input lines up visually. Pre-fill: rename uses `sourceName` (just the basename); duplicate uses `sourcePath` (full path) so the user can edit the directory as well as the filename.
  - `_renderFile` branches — when `_renaming === node.path`, the file row is REPLACED with the inline input (rendering the source row alongside would show two text affordances for the same file). When `_duplicating === node.path`, the file row stays and the input appends BELOW it (the source still exists; the input specifies the target location).
  - `_onInlineKeyDown` handles Enter (commit), Escape (cancel), other keys passthrough. Blur also cancels via `_onInlineBlur` — accidental click-aways discard the pending edit rather than auto-committing, which users find surprising.
  - `_commitInlineInput(inputEl, mode, sourcePath)` — reads `inputEl.value`, trims, clears state first so the blur firing after re-render doesn't re-enter through `_onInlineBlur`'s guard, then validates. Empty value → silent no-op (state cleared, no event). Unchanged value for rename (target equals current name) → no-op. Equal source and target for duplicate → no-op. Otherwise dispatches `rename-committed` or `duplicate-committed` with `{sourcePath, targetName}`.
  - `_cancelInlineInput(mode, sourcePath?)` — clears the relevant state. Optional `sourcePath` guard prevents double-cancel in the blur-after-commit race: `_commitInlineInput` clears `_renaming` first, which triggers re-render and removes the input, which fires blur, which calls `_cancelInlineInput` with the just-cleared sourcePath. The guard skips the second cancel because the state no longer matches.
  - `updated(changedProps)` — auto-focuses and pre-selects the stem (the part before the final `.`) of any newly-rendered inline input. Stem selection means typing immediately replaces the filename but preserves the extension; users who want a different extension just type past the selection.

- `webapp/src/files-tab.js` — additions:
  - `_dispatchRename(path)` and `_dispatchDuplicate(path)` — one-liners that call `picker.beginRename(path)` / `picker.beginDuplicate(path)`. Pure delegation; the picker owns the input lifecycle.
  - `_onRenameCommitted(event)` — the real work. Validates detail shape, rejects path separators in the target (users who want to move should use duplicate), rebuilds the target path by preserving the source's parent directory, determines whether the source is a file or a directory via `_findNodeByPath`, routes to `Repo.rename_file` or `Repo.rename_directory` accordingly. On success, reloads the tree AND migrates selection/exclusion state so the file stays selected/excluded under its new path. On failure, surfaces via toast.
  - `_onDuplicateCommitted(event)` — reads source content via `Repo.get_file_content`, then creates the target via `Repo.create_file(targetPath, content)`. Two-step because no backend `copy_file` RPC exists. Failures at either step surface as error toasts without partial state. Defensive type check on returned content — a future backend change that returned a different shape shouldn't dispatch garbage to `create_file`.
  - `_findNodeByPath(path)` — depth-first walk through `_latestTree` returning the node (file OR directory) at that path, or null when missing. Used by `_onRenameCommitted` to determine whether to call `rename_file` or `rename_directory`. Missing nodes (deleted between menu open and Enter press) default to file rename since the RPC surfaces a clean error.
  - `_migrateSubtreeState(oldDir, newDir)` — on directory rename, every descendant path under `oldDir` gets migrated to the equivalent path under `newDir` in both `_selectedFiles` and `_excludedFiles`. Nested selections survive a parent rename. Uses prefix-rewrite (`oldPrefix = oldDir + "/"`) so sibling directories with names that start the same (e.g. `src` and `src-archive`) don't cross-contaminate.
  - Template bindings — `@rename-committed=${this._onRenameCommitted}` and `@duplicate-committed=${this._onDuplicateCommitted}` on the `<ac-file-picker>` element. Handlers bound in the constructor for stable references.

- `webapp/src/file-picker.test.js` — 20+ tests across `describe('inline-input rename')` and `describe('inline-input duplicate')` blocks (the file-picker's side). Tests cover: `beginRename`/`beginDuplicate` state flip, inline input rendering shape (mode attr, data attributes), pre-fill values (basename vs full path), auto-focus and stem selection via `updated()`, Enter commits and dispatches the right event, Escape cancels without dispatch, blur cancels, blur-after-commit race short-circuit, mutual exclusion (starting duplicate while renaming cancels rename), empty-input no-op, unchanged-value no-op, path separators in target (orchestrator-level test — the picker itself allows them, rejection happens in `_onRenameCommitted`).

- `webapp/src/files-tab.test.js` — 20+ tests across `describe('rename action')` and `describe('duplicate action')` blocks in the `FilesTab context-menu action dispatch` section. Tests cover: context-menu action calls `beginRename`/`beginDuplicate` on the picker, commit handler routes to `rename_file` vs `rename_directory` based on tree inspection (critical — a naive implementation that always called `rename_file` would break directory renames silently), target path reconstruction (nested source produces nested target; top-level source produces top-level target), tree reload after success, success toast with target name, path-separator rejection with warning toast, selection migration (selected file stays selected under new name; directory rename migrates descendants via prefix rewrite), exclusion migration (parallel to selection), malformed event rejection, restricted error (warning toast), RPC rejection (error toast), same-path no-op. Duplicate tests also cover: source read via `get_file_content`, cross-directory duplicates, non-string content defense, read-source failure abortion without create attempt.

Design points pinned by tests:

- **Rename vs directory rename dispatch happens at the orchestrator, not the picker.** The picker's `beginRename` doesn't carry a file-vs-directory discriminator — it operates on paths. The orchestrator inspects `_latestTree` at commit time to route to the correct RPC. Alternative (two separate picker methods) would duplicate the inline-input rendering code for no UX benefit. Pinned by `rename-committed on a dir path routes to rename_directory` and `file rename still routes to rename_file`.

- **Path separators rejected in rename targets.** A rename target containing `/` or `\` is rejected with a warning toast. Users wanting to MOVE a file to a different directory should use duplicate (which pre-fills with the full path and lets them edit the directory). Letting rename accept a path would interact badly with git's rename-detection heuristics — git sees `rename_file(old, new/different/path)` as a rename AND the creation of intermediate directories, which is surprising. Pinned by `rejects target names containing path separators`.

- **Directory rename migrates all descendant selection + exclusion.** Users who had `src/a.md` and `src/b.md` selected before renaming `src → lib` expect to find `lib/a.md` and `lib/b.md` selected after. Without migration, the selection would silently drop to empty. Pinned by `migrates subtree selection on dir rename` and `migrates subtree exclusion on dir rename`. The prefix-rewrite uses `oldPrefix = oldDir + "/"` so `src` doesn't accidentally match `src-archive/a.md`.

- **Duplicate is client-side read-then-write.** No backend `copy_file` RPC exists; `Repo.create_file` refuses to overwrite existing files. The client reads source content via `Repo.get_file_content`, then calls `create_file(targetPath, content)`. If the target already exists, the server surfaces the error and no partial state is created. Pinned by `duplicate-committed reads source then creates target with content`.

- **Same-path no-op for both.** Rename where target equals the current name is a no-op; duplicate where target equals source is a no-op. The picker's `_commitInlineInput` already checks this, but the orchestrator also checks defensively — a direct commit-handler invocation (e.g. from a future programmatic API) shouldn't trigger spurious RPCs. Pinned by `same-name commit is a no-op` and `same-path commit is a no-op`.

- **Blur cancels, not commits.** Accidental click-aways during typing shouldn't silently save. Users use Enter to commit or Escape/blur to cancel. Alternative (auto-commit on blur) is surprising and hard to undo. Pinned by `blur cancels without dispatch` and the commit-path-test-is-separate structure.

- **Unchanged commits are no-ops.** Opening rename and pressing Enter without typing should not fire a rename RPC. The picker's check catches this (target === source name); if the picker loosened the check in a future refactor, the orchestrator's same-path check would catch it there instead. Pinned on both sides.

- **Auto-focus and stem selection on render.** Users opening rename want to type immediately. Stem selection (everything before the final `.`) lets them replace `my-file` in `my-file.md` without losing the extension. Pinned indirectly via the `updated()` lifecycle — hard to test reliably in jsdom (no real selection model), but the implementation is documented and trusts the browser.

Open carried over:

- **Inline input rendering alignment with directory rows.** The current implementation assumes the input's indent matches a file row's indent, which works because rename and duplicate are file-only in 8c. When directory rename lands (9 part 1) the orchestrator calls the same `beginRename`, so the inline input appears at the directory's indent level automatically — specs4 validated that the shape is right.
- **Collab broadcast of rename events.** If another client renamed a file while this client had rename open on the same file, the rename RPC would succeed on the server but the picker would still show the old name until the next tree reload. Not blocking any current flow; future collab enhancement could short-circuit the picker's input on `filesChanged` with a stale source path.

Next sub-commit — **8d**: wire include/exclude and load-in-panel actions. Include/exclude dispatches through the existing exclusion machinery; load-in-panel dispatches `load-diff-panel` events that the app shell catches and routes to the diff viewer's `loadPanel`.

### ~~Increment 8d — Include/exclude and load-in-panel actions~~ (delivered)

Wires the remaining four context-menu actions. Include and exclude dispatch through the existing three-state exclusion machinery (Increment 5); load-left and load-right fetch the file content and dispatch `load-diff-panel` events that the app shell catches (same pathway the history browser's context menu uses since 2e.4).

- `webapp/src/files-tab.js` — additions:
  - `_dispatchExclude(path)` — adds the path to `_excludedFiles` via `_applyExclusion`. Idempotent — if already excluded, `_applyExclusion`'s set-equality short-circuit makes this a no-op and no server round-trip happens. Also deselects if the file was selected (mutual exclusion between selected and excluded states — matches the shift+click behaviour in the picker's `_toggleExclusion`).
  - `_dispatchInclude(path)` — removes the path from `_excludedFiles`. Returns the file to the default index-only state — does NOT auto-select. Matches the shift+click-from-excluded semantics and the "Include in index" menu item's documented behaviour. Idempotent.
  - `_dispatchLoadInPanel(path, panel)` — validates panel ∈ {'left', 'right'}, fetches content via `Repo.get_file_content`, dispatches `load-diff-panel` with `{content, panel, label}` where `label` is the file's basename. Defensive type check on content (non-string → error toast, no dispatch). Invalid panel values rejected silently — the switch in `_onContextMenuAction` only passes 'left' or 'right', but a direct call with a bad value shouldn't fire.
  - Switch cases in `_dispatchFileAction` wired: `include` → `_dispatchInclude`, `exclude` → `_dispatchExclude`, `load-left` → `_dispatchLoadInPanel(path, 'left')`, `load-right` → `_dispatchLoadInPanel(path, 'right')`.

- `webapp/src/files-tab.test.js` — 15 new tests across three describe blocks:
  - `describe('exclude action')` — 4 tests: adds to excluded set + notifies server, no-op when already excluded, deselects the file when excluding a selected file (two events: exclusion + deselection), propagates the new exclusion to the picker via direct-update.
  - `describe('include action')` — 4 tests: removes from excluded set + notifies server, does NOT add to selected set (returns to index-only), no-op when not currently excluded, propagates updated exclusion to picker.
  - `describe('load-in-panel actions')` — 7 tests: load-left dispatches with panel=left + correct content + label, load-right dispatches with panel=right, fetches file content before dispatching (order matters — content first, then event), uses basename as label (nested paths produce compact labels), RPC failure surfaces as error toast without dispatching panel event, non-string content defensively handled, invalid panel values rejected silently via direct `_dispatchLoadInPanel` call.

Design points pinned by tests:

- **Include returns to index-only, not selected.** The "Include in index" context-menu item does NOT tick the file's selection checkbox — it returns the file to the default index-only state. Matches the picker's shift+click-from-excluded behaviour. Users who want to select after including just tick the checkbox. Pinned by `does NOT add to the selected set (returns to index-only)`. The alternative (auto-select on include) is surprising because it changes two states with one gesture; the explicit two-step lets users decide intent.

- **Regular click on excluded in the picker does auto-select (the one exception).** Specs4's "Regular click on an excluded file — un-excludes and selects" is the one path that combines both actions into one gesture. But that's the picker's checkbox click, NOT the context-menu include action. The distinction matters — two different gestures for two different intents, not surprising because they're distinct UI elements.

- **Exclude deselects the file if selected.** Mutual exclusion between selected and excluded is enforced. Pinned by `deselects the file when excluding a selected file` which verifies both `setExcluded` and `setSelected` are called. Alternative (let them coexist) would require a tracker three-state dispatch that doesn't exist — specs4 is explicit about the mutual exclusion.

- **Basename as the load-in-panel label.** A deep path like `src/services/auth/handler.py` would produce an unreadable label in the diff viewer's floating panel chip. Using just `handler.py` keeps it compact. If two files with the same basename load into different panels, the user can distinguish by viewer position; adding the full path would waste horizontal space. Pinned by `uses the basename as the label`.

- **load-diff-panel event is the single dispatch point for ad-hoc comparisons.** Phase 2e.4 (history browser refinements) already uses this event; the files-tab uses the same pathway. The app shell's handler flips the active viewer to 'diff' and calls `diffViewer.loadPanel(content, panel, label)`. Future sources (e.g., a URL chip's content, a commit diff) will use the same event.

- **RPC failure aborts cleanly.** A binary file or missing file produces a rejected `Repo.get_file_content` promise. The handler surfaces the error via toast and does NOT dispatch the panel event. Users see "Failed to load src/logo.png: binary file rejected" rather than a diff viewer showing garbage. Pinned by `surfaces RPC failure as error toast`.

- **Non-string content defensive check.** Mirrors the duplicate action's content validation. If a future backend change makes `get_file_content` return something unexpected (dict, null), we bail with "Cannot load X: unexpected content type" rather than dispatching it verbatim. Pinned by `handles non-string content defensively`.

Increment 8 complete. File context menu has nine working actions (stage / unstage / discard / rename / duplicate / load-left / load-right / exclude-or-include / delete). Next up — Increment 9: directory context menu.

### ~~Increment 9 — Context menu (directories)~~ (delivered `45205c5`, `1684f63`, tests on followup)

Delivered in two commits plus a test-gap fill:

- `45205c5` — part 1 (non-create actions) + part 2 (new-file and new-directory inline inputs). Shipped `INLINE_MODE_*` constants, `_creating` reactive state, `beginCreateFile` / `beginCreateDirectory` public methods, `_renderInlineInput` dispatch for the new modes, and the matching `_onNewFileCommitted` / `_onNewDirectoryCommitted` event handlers in files-tab.
- `1684f63` — removed duplicate path-separator validation found during test-gap filling.
- followup — new-file and new-directory describe blocks cover: happy paths (including `.gitkeep` construction for empty dirs), path-separator rejection, reload-after-creation, success-toast shape (directory toast names the directory, not the `.gitkeep` path — pins the "implementation detail doesn't leak" invariant), malformed events dropped silently, RPC-rejection error toast, restricted-caller warning toast. Parallel shape to the rename-committed / duplicate-committed coverage from Increment 8c.

Design points pinned by tests:

- **`.gitkeep` placeholder for new directories.** Git doesn't track empty directories. Creating `{parent}/{name}/.gitkeep` with empty content gets the directory into the tree. Pinned by `new-directory-committed creates .gitkeep inside the new dir`.

- **User-facing toast never names `.gitkeep`.** The directory-creation success message says "Created src/utils", not "Created src/utils/.gitkeep". Implementation choice is invisible to the user. Pinned explicitly by `success toast names the directory, not the .gitkeep path` with an `expect(...).not.toContain('.gitkeep')` assertion.

- **Path separators rejected with a warning, not a silent drop.** User typed `foo/bar.md` in the new-file input — they got feedback explaining why it didn't work, rather than watching a single file get silently created with the wrong name. Same rule as `_onRenameCommitted`'s separator rejection. Pinned by `rejects names with path separators` on both handlers.

- **Empty `parentPath` produces a bare-name target.** Root-directory creations produce `a.md`, not `/a.md` or `//a.md`. Pinned by `creates at repo root when parentPath is empty` on both handlers.

### Increment 9 — original planned scope

Same mechanism as #8 with different actions — stage-all / unstage-all / rename (inline) / new-file (inline) / new-directory (inline, creates with `.gitkeep`) / exclude-or-include-in-index.

- `file-picker.js` — dir-specific menu item set
- `files-tab.js` — dir-level RPC dispatchers; new-directory creates `.gitkeep` inside the new dir so git tracks it
- tests — all six actions, inline input integration, `.gitkeep` creation

Same mechanism as #8 with different actions. Split into two parts:

- **Part 1** (delivered): stage-all / unstage-all / rename-dir / exclude-all / include-all
- **Part 2** (delivered): new-file / new-directory via inline-input flow

### ~~Increment 9 part 1 — Directory batch actions~~ (delivered)

Directory context menu with five actions that operate on the whole subtree. Stage-all and unstage-all collect every descendant file and send a single RPC; exclude-all and include-all apply the change to every descendant in one batch through the existing exclusion machinery; rename-dir reuses the file-rename inline-input flow with a commit handler that inspects the tree to route to `Repo.rename_directory`.

- `webapp/src/file-picker.js` — additions:
  - `_CONTEXT_MENU_DIR_ITEMS` module-level catalog — seven entries: `stage-all`, `unstage-all`, `rename-dir`, `new-file`, `new-directory` (part 2 placeholders, silent-drop in the orchestrator), `exclude-all`, `include-all`. Separator positions: after unstage-all, after rename-dir, after new-directory. `showWhen` gates on `allExcluded` / `someExcluded` context flags so a fully-excluded dir shows only Include-all, a partially-excluded dir shows both Exclude-all and Include-all, and a fully-included dir shows only Exclude-all.
  - New module-level action constants: `CTX_ACTION_STAGE_ALL`, `CTX_ACTION_UNSTAGE_ALL`, `CTX_ACTION_RENAME_DIR`, `CTX_ACTION_NEW_FILE`, `CTX_ACTION_NEW_DIR`, `CTX_ACTION_EXCLUDE_ALL`, `CTX_ACTION_INCLUDE_ALL`. Distinct from the file-row action IDs so a stale menu open on one node type can't dispatch to a handler expecting the other.
  - `_onDirContextMenu(event, node)` — parallel to `_onFileContextMenu` but with dir-specific context fields. Computes `allExcluded` and `someExcluded` at menu-open time by walking `_collectDescendantFiles(node)` and counting how many are in `excludedFiles`. Empty directories produce `allExcluded=false` and `someExcluded=false` (only Exclude-all shows).
  - `_renderMenuItems(ctx)` — dispatches on `ctx.type` to pick between `_CONTEXT_MENU_FILE_ITEMS` and `_CONTEXT_MENU_DIR_ITEMS`. The `showWhen` evaluator reads context flags the appropriate catalog's entries care about.
  - `@contextmenu=${(e) => this._onDirContextMenu(e, node)}` binding on directory rows in `_renderDir`.

- `webapp/src/files-tab.js` — additions:
  - `_dispatchDirAction(action, path, name)` — routes directory actions. Five implemented cases (`stage-all`, `unstage-all`, `rename-dir`, `exclude-all`, `include-all`); `new-file` and `new-directory` fall through to the silent-drop default (part 2).
  - `_dispatchStageAll(dirPath)` — collects every descendant file via `_collectDescendantFilesFromPath`, sends a single `Repo.stage_files(paths)` RPC (batch-friendly), reloads tree, success toast with count and dir name. Empty directories (no descendants) short-circuit silently.
  - `_dispatchUnstageAll(dirPath)` — symmetric to stage-all. Files that aren't currently staged contribute nothing but don't break the batch — git silently skips unstaged paths.
  - `_dispatchRenameDir(path, name)` — delegates to `picker.beginRename(path)`. Reuses the file rename flow because the input shape is identical (pre-filled with current name, Enter commits, Escape cancels). The `_onRenameCommitted` handler inspects `_latestTree` via `_findNodeByPath` to determine whether the source is a directory and routes to `Repo.rename_directory` accordingly (plus calls `_migrateSubtreeState` for descendant selection/exclusion).
  - `_dispatchExcludeAll(dirPath)` — adds every descendant file to `_excludedFiles` via `_applyExclusion`. Deselects any that were selected (mutual exclusion rule). Empty directories no-op.
  - `_dispatchIncludeAll(dirPath)` — removes every descendant file from `_excludedFiles`. Does NOT auto-select — returns descendants to index-only, matching the file-level include behaviour. Partially-excluded directories only remove the files that are actually in the excluded set (other descendants weren't there to begin with).
  - `_collectDescendantFilesFromPath(dirPath)` — walks `_latestTree` via `_findDirNode` + `_collectDescendantsOfNode`. Empty-string dirPath is a special case (repo root) handled without walking. Missing paths return an empty array (defensive — shouldn't happen with menu-sourced paths but safe against a stale menu targeting a just-deleted directory).
  - `_findDirNode(root, dirPath)` — simple depth-first walk returning the matching directory node or null.
  - `_collectDescendantsOfNode(node)` — recursive helper. Files contribute their paths; directories contribute their descendants' paths. Directories themselves contribute nothing (only file paths end up in the result).

- `webapp/src/files-tab.test.js` — ~30 tests in `describe('directory actions')` across five sub-describe blocks:
  - `describe('stage-all action')` — 6 tests: stages every descendant in a single RPC, reloads tree after, success toast with count and dir name, empty directory no-op (no RPC, no toast), surfaces restricted error as warning toast, recursively collects from nested subdirs (proves the DFS walks deep).
  - `describe('unstage-all action')` — 2 tests: unstages every descendant in a single RPC, reloads tree. Shares the error-handling pattern with stage-all; doesn't duplicate those tests.
  - `describe('rename-dir action')` — 7 tests: context-menu action calls `beginRename` on the picker, `rename-committed` on a dir path routes to `rename_directory`, file rename still routes to `rename_file` (regression check — the new dir-detection logic must not misroute), migrates subtree selection on dir rename, migrates subtree exclusion on dir rename, rejects target with path separators.
  - `describe('exclude-all action')` — 3 tests: adds every descendant to excluded set, deselects descendants that were selected, empty dir no-op.
  - `describe('include-all action')` — 3 tests: removes every descendant from excluded set, does NOT auto-select them, partially-excluded dir only removes files that were actually excluded.
  - `describe('unknown dir actions')` — 2 tests: unknown actions silently drop, new-file and new-directory silently drop (part 2 scope — reaching the default case confirms the part-1 split is clean).

Design points pinned by tests:

- **Menu-item visibility gates on `allExcluded` / `someExcluded`.** A fully-included dir shows only Exclude-all (nothing to include). A fully-excluded dir shows only Include-all (nothing more to exclude). A partially-excluded dir shows BOTH so the user picks the direction. Pinned by `fully-excluded dir shows only include-all (not exclude-all)` and `partially-excluded dir shows both exclude-all and include-all`. Without the gate, users would see a no-op menu item and wonder why their click did nothing.

- **Batch RPCs for stage-all / unstage-all.** Single `Repo.stage_files(paths)` call for the whole subtree rather than N calls. Network round-trip count is O(1) regardless of directory size — matters for repos with hundreds of files in a single subtree. Pinned by `stages every descendant file in a single RPC` which asserts `stage` was called exactly once.

- **Rename-dir reuses the file rename flow.** The picker's `beginRename` is type-agnostic — it opens an inline input with the current name pre-filled. The orchestrator's `_onRenameCommitted` inspects the tree at commit time to determine whether to call `rename_file` or `rename_directory`. Alternative (parallel `beginRenameDir` method) would duplicate the input rendering and commit handler for zero UX benefit. Pinned by `rename-committed on a dir path routes to rename_directory` and `file rename still routes to rename_file`.

- **Subtree selection migration on dir rename.** Users renaming `src → lib` expect `src/a.md` (selected) to become `lib/a.md` (still selected). The `_migrateSubtreeState` helper uses prefix-rewrite (`oldPrefix = oldDir + "/"`) so sibling dirs with names that start the same don't cross-contaminate. Pinned by `migrates subtree selection on dir rename` and `migrates subtree exclusion on dir rename`. Without migration, the selection would silently drop to empty after rename — a data-loss-feeling bug.

- **Empty directory batch actions are silent no-ops.** A dir with no descendant files produces no RPC, no toast, no state change. Pinned by `empty directory is a no-op (no RPC, no toast)`. Without this, an accidental right-click on an empty dir + stage-all would produce a confusing "Staged 0 files" toast.

- **Include-all does NOT auto-select descendants.** Mirrors the file-level include behaviour — returns to index-only. Users wanting to select can tick individual checkboxes or the dir-level checkbox. Pinned by `does NOT auto-select the descendants`.

- **Directory-action IDs distinct from file-action IDs.** A stale menu open on one node type can't accidentally dispatch to a handler expecting the other. The `type` discriminator in the event detail (`'file'` or `'dir'`) is belt-and-braces — the dispatch method also routes on it. A future refactor that merged the two action namespaces would need to re-add the type check throughout the dispatcher. Pinned by `menu item click dispatches context-menu-action with type=dir`.

- **`someExcluded` uses an OR condition, not percentage.** Any non-zero count of excluded descendants makes `someExcluded=true`. A dir with 100 files where 1 is excluded still shows Include-all (the user might want to include that one). Alternative (e.g. only show when >50% excluded) would add UX complexity for no clear benefit.

### ~~Increment 9 part 2 — New file / new directory inline inputs~~ (delivered)

New file and new directory creation via the same inline-input pattern used by rename and duplicate, with a third `_creating` state field carrying both a mode and a parent-directory path. New-entry input rows appear at the top of the target directory's children regardless of sort mode (sort-independent positioning — matches VS Code / IDE convention). Auto-expands the parent so the input is visible even when the user clicks "New file…" on a collapsed directory.

- `webapp/src/file-picker.js` — additions:
  - Four module-level `INLINE_MODE_*` constants (`RENAME`, `DUPLICATE`, `NEW_FILE`, `NEW_DIR`) replacing the previous ad-hoc string comparisons. The constants let a reader see all four modes in one place and make `_renderInlineInput` / `_commitInlineInput` / `_cancelInlineInput` dispatch branches grep-able.
  - `_creating` reactive state field on the constructor. Shape when active: `{mode, parentPath}`. Null when no creation is in progress. Distinct from `_renaming` / `_duplicating` because the input is NOT operating on an existing file — it's creating a new one inside `parentPath`, so neither the source-path nor the current-name pattern applies.
  - `beginCreateFile(parentPath)` and `beginCreateDirectory(parentPath)` public methods. Clear any active rename / duplicate state (mutual exclusion — one inline input at a time). Auto-expand the parent directory so the input lands visibly. Empty-string `parentPath` IS legal (that's the repo root); the auto-expand branch skips it because the root isn't a collapsible node.
  - `beginRename` and `beginDuplicate` updated to clear `_creating` too, so the mutual-exclusion rule holds in all directions.
  - `updated()` lifecycle hook's guard extended to watch `_creating` alongside `_renaming` / `_duplicating`. Same auto-focus + stem-selection path runs; since create-mode inputs start empty, the stem selection is a no-op and the user starts at a blank input (focus is the key affordance).
  - `_renderInlineInput` extended — now handles all four modes. Pre-fill: rename uses basename, duplicate uses full path, create modes use empty string. Aria-label: rename/duplicate reference the source name, create modes reference the parent dir ("New file in src/" or "New file at repository root" for the empty-parent case). Placeholder text on create-mode inputs gives users a format hint ("filename.md" / "dirname") — rename / duplicate have pre-filled values so the placeholder wouldn't show.
  - New-entry input rendering integrated into `_renderDir` and the top-level render path. When `_creating.parentPath` matches a directory that's currently expanded, the input row renders BEFORE that directory's children. When `_creating.parentPath === ''` (repo root), the input renders at the top of the tree, before `_renderChildren(filtered, ...)`. Sort-mode-independent — the input is a UI affordance, not a data row, so its position doesn't depend on how the user has sorted the tree. After commit, the new file appears in the tree at its sort-natural position on the next render.
  - `_commitInlineInput` gained two new branches. Create-mode commits dispatch `new-file-committed` or `new-directory-committed` with `{parentPath, name}` shape (distinct from rename / duplicate's `{sourcePath, targetName}`) — the orchestrator needs to distinguish "operate on an existing path" from "create a new entry under a parent". Empty-name commits are no-ops (state cleared, no event dispatched).
  - `_cancelInlineInput` extended — clears `_creating` when mode is `new-file` or `new-directory`. Guard against the blur-after-commit race matches the rename / duplicate pattern: sourcePath (the parent path for create modes) is checked against `_creating.parentPath` so a stale blur-cancel after a successful commit doesn't re-clear already-clean state.

- `webapp/src/files-tab.js` — additions:
  - `_dispatchNewFile(parentPath)` and `_dispatchNewDirectory(parentPath)` — thin delegators to `picker.beginCreateFile` / `picker.beginCreateDirectory`. Called by `_dispatchDirAction` when the user picks the corresponding menu item. The RPC doesn't fire here; it fires on commit.
  - `_dispatchDirAction` switch updated — `new-file` and `new-directory` cases added alongside the existing five. No more silent-drop default for those actions. Unknown actions (future menu items without wired handlers) still fall through to the default branch.
  - `_onNewFileCommitted(event)` — reads `{parentPath, name}` from detail, rejects path separators with a warning toast, joins into a target path (`parentPath/name` or just `name` for repo root), calls `Repo.create_file(targetPath, '')`. On success, reloads the tree and surfaces a success toast. On restricted caller: warning. On RPC rejection: error toast (common cause: target already exists).
  - `_onNewDirectoryCommitted(event)` — same pattern, but the target path is `parentPath/name/.gitkeep` (with content `''`). Git doesn't track empty directories — only files with content — so writing a placeholder file is the standard technique for creating a directory that will be visible in the next commit. `.gitkeep` is the community convention; the name self-documents its purpose.
  - Both handlers bound in the constructor alongside the existing rename / duplicate bindings. Template wires them via `@new-file-committed` / `@new-directory-committed` on the `<ac-file-picker>` element.

Design points pinned by tests:

- **`.gitkeep` is a community convention, not a git feature.** Git tracks files, not directories; an empty directory is invisible to git. To make a new directory appear in a commit, at least one file with content must exist inside it. `.gitkeep` is the de facto name: it's a dotfile (hidden in most listings), the name self-documents the purpose, and users seeing it in diffs immediately understand what it's for. The alternative (`.gitignore` inside the directory) exists but confuses newcomers who read it as "this directory is being ignored." The picker's create-directory RPC writes `.gitkeep` with empty content; once the user adds real files they can delete `.gitkeep` or leave it.

- **New-entry input always renders at the top of the directory's children.** The alternative (insert at the sort-natural position) requires knowing the filename before the user types it — backwards. The top-of-directory position matches VS Code, Finder, and most IDE file-tree implementations. After commit, the new file enters the tree data and gets sorted naturally on the next render. The input row's position is UI affordance, not data position. Sort-independent.

- **Auto-expand target directory on begin.** Clicking "New file…" on a collapsed directory would open an input the user can't see. `beginCreateFile` and `beginCreateDirectory` both add `parentPath` to the expanded set before setting `_creating`. Empty-string `parentPath` (repo root) skips the expand branch since the root isn't a collapsible node.

- **Event detail shape `{parentPath, name}` distinct from rename / duplicate's `{sourcePath, targetName}`.** Create modes are semantically different — they operate on a directory parent to produce a new entry, not on an existing file to modify it. Using the same shape would require the orchestrator to disambiguate based on the event name, which is fragile. Separate shapes make the handlers self-documenting.

- **Path separators rejected in create-mode names.** Users wanting to create a nested file (`src/new/file.md`) should create the directories first, then the file. Allowing separators in a single operation would silently create intermediate directories that git may or may not track, and would conflict with the `.gitkeep` pattern for directory creation. Pinned by warning toast + no-RPC on separator detection.

- **Empty-string parent path is legal (repo root case).** `beginCreateFile('')` opens an input at the top of the root. Target path is just `name` (no leading slash). The `typeof parentPath !== 'string'` guard rejects undefined / null; the empty string passes through.

- **Create state cleared on rename / duplicate and vice versa.** All three inline-input states are mutually exclusive — only one can be active at a time. `beginRename` clears `_duplicating` and `_creating`; `beginDuplicate` clears `_renaming` and `_creating`; `beginCreateFile` / `beginCreateDirectory` clear `_renaming` and `_duplicating`. Without this, clicking "New file…" while rename was active would leave two inputs visible.

Increment 9 complete. Directory context menu has seven working actions. Next up — Increment 10: middle-click path insertion + @-filter bridge.

### ~~Increment 10 — Middle-click path insertion + @-filter bridge~~ (delivered)

Delivered across multiple commits. Middle-click path insertion (10a) completed in `cafa47e`; @-filter bridge (10b) completed in `fdb4f84` (chat panel) and `a0956af` (files-tab bridge), with a follow-up test fix in `76fdcf9`.

- `file-picker.js` — middle-click (`auxclick` + `button === 1`) on any file row dispatches `insert-path` with `{path}`. `event.preventDefault()` suppresses the browser's selection-buffer paste at its source.
- `files-tab.js` — `_onInsertPath` queries the chat panel's textarea via `chat._input`, splices the path at the current cursor position with space-padding (prepending a space when preceded by a non-whitespace char, appending one when followed by a non-whitespace char), sets `chatPanel._suppressNextPaste = true` BEFORE calling `chatPanel.focus()`, then fires an `input` event so auto-resize runs. The order is load-bearing: setting the flag after focus would race against any paste event queued by the middle-click itself.
- `chat-panel.js` — `_suppressNextPaste` non-reactive instance field (don't declare it as a `static properties` entry — Lit would re-render on every flag flip). The paste handler checks-and-clears the flag before any other logic; when set, it calls `event.preventDefault()` and returns. Matches specs3/5-webapp/file_picker.md's "cross-component flag contract" — one-shot, parent sets before focus, child consumes on the next paste event OR discards on first non-paste input.
- **@-filter bridge (10b).** Chat panel detects `@pattern` as the user types via `_updateMentionFilter` + `_detectActiveMention`. The detector walks backward from the cursor looking for `@` at a word boundary (preceded by whitespace or start-of-string). Edge-triggered emission of `filter-from-chat` events with `{query}` — only fires on state transitions (enter, update, exit) to keep the bridge signal ratio high. Files-tab's `_onFilterFromChat` validates the query is a string and calls `picker.setFilter(query)` via `this._picker()`. Malformed events (missing detail, non-string query, missing query field) silently dropped.
- **Tests — chat-panel side.** Mention detection with `@` at start-of-line, `@` after whitespace, `@` rejected mid-word (`foo@bar`), multi-char query extraction, exit on whitespace, exit on deletion, empty-query emission on exit. Edge-trigger verification: identical state doesn't re-emit. The existing `_onInputChange` extension doesn't break any prior tests.
- **Tests — files-tab side.** The bridge forwards non-empty queries, clears on empty string, silently drops malformed events, survives picker-not-mounted case (via `_picker()` returning null), end-to-end propagation from textarea through two shadow-DOM boundaries into visible picker filtering. The end-to-end test uses query `'ba'` rather than `'bar'` to match the fuzzy-match subsequence rule (query chars must appear in order, not necessarily contiguous) — this caught a live bug in the initial test where `'bar'` was asserted against `baz.md` which has no `r`.
- **Delivery note on the @-filter detector.** The walk-backward approach is O(N) per keystroke where N is the distance from cursor to the nearest `@` or whitespace. In practice this is under ~20 chars for realistic @-mention usage (users don't write 100-char paths without whitespace). The detector intentionally does NOT clear the filter when the user moves the cursor out of a mention without typing — specs3's minimal `@-filter` description doesn't require it, and adding click / selection-change listeners would complicate the hot path. The next input event re-evaluates; if the cursor is no longer in a mention, the filter clears then.

Design points pinned by tests:

- **Mention boundary rule.** `@` must be preceded by whitespace or start-of-string — not a word character. Blocks `foo@bar` from being treated as a mention, which would be surprising when a user types an email-like path. Pinned by `test_rejects_at_in_middle_of_word`.

- **Edge-triggered emission.** The detector stores `_activeMention = {start, end, query}` and compares against it on every input event. Same range + same query → no-op. Prevents redundant setFilter calls during rapid typing and prevents the picker from re-rendering at every keystroke even when the filter query hasn't changed. Pinned by `test_identical_state_does_not_re_emit`.

- **Cursor movement without typing is not a trigger.** Users who click inside an existing `@mention` to edit it don't cause a new emission — only actual typing (which fires an input event) re-evaluates. Simplifies the hot path significantly; specs3 doesn't require the alternative behavior.

- **Bridge is a dumb forwarder.** Files-tab doesn't dedup `filter-from-chat` events — it just passes them through to `picker.setFilter`. The chat panel already edge-triggers, and the picker's own property-change check handles any remaining redundancy. Pinned by `test_repeated_identical_queries_forward`.

- **Empty query is a legitimate clearing signal.** When the user exits a mention (deletes the `@`, types whitespace, cursor leaves the sequence), the chat panel emits `filter-from-chat` with `query: ''`. Files-tab forwards this to `picker.setFilter('')` which clears the picker's filter. Pinned by `test_empty_string_clears_the_filter`.

- **No crash when picker unmounted.** The `_picker()` helper returns null if the picker isn't in the shadow tree yet (mount-order race). The `_onFilterFromChat` handler short-circuits gracefully on null — no exception, no console noise. Pinned by `test_no_crash_when_picker_is_not_mounted`.

Open carried over:

- **Middle-click on directory rows.** Currently only file rows dispatch `insert-path`. Directory rows could plausibly insert their path too (e.g. for "reference this whole directory"), but specs3 is silent on this and the current file-only behavior matches user expectation. Deferred unless a real use case appears.
- **Filter reset on session change.** A `@mention` in the chat input that was applied to the file picker stays applied across session changes. `_onSessionChanged` clears the input text but not the filter state — the next empty-query emission from a user keystroke will clear it naturally. If the visible filter stickiness becomes a pain point, the session handler can explicitly fire `filter-from-chat` with empty query.

### ~~Increment 11 — Review mode banner~~ (delivered `898c239`, `58036a8`, `66deda5`)

Delivered across three commits. Sub-commits split along natural seams — UI first (no wiring), then state management, then event routing and tests — so each landed with passing tests rather than a single wholesale change.

**898c239 — Picker banner UI.** `file-picker.js` — `reviewState` property (Object defaulting null), `_renderReviewBanner` method emitting amber-tinted banner above the filter bar when `reviewState.active === true`. Shows branch name in title, commit count (singular/plural), file count (singular/plural), `+additions` / `-deletions` stats (both conditionally rendered — omitted at zero), and an exit button. Defensive against partial state — missing `commits`, `stats`, or `branch` all degrade to sensible defaults (0 counts, fallback title). CSS uses an amber/orange palette distinct from the default grey filter bar, mirroring the detached-HEAD pill colour scheme so the signal "you're not in normal editing mode" is consistent. Template puts the banner as the first child of the host so it always renders before the filter bar regardless of prop-update order. Tests (22) cover render gating, branch/stat display, singular/plural grammar, zero-stat omission, exit button dispatch across the shadow boundary, defensive degradation paths, and lifecycle (banner hides when `reviewState` clears).

**58036a8 — Files-tab review state management.** `files-tab.js` — `_reviewState` field (defaults null), bound `_onReviewStarted` / `_onReviewEnded` / `_onExitReview` handlers, window listeners registered in `connectedCallback` / unregistered in `disconnectedCallback`, `reviewState` push added to `_pushChildProps`. Review-started handler populates state, clears selection locally (defense-in-depth with the server's clear per specs3/4-features/code_review.md), triggers a file tree reload so the picker reflects the soft-reset's staging changes. Review-ended handler clears state without touching selection — the server's `end_review` doesn't touch `_selected_files` either, and the user likely wants their review-mode file selection carried forward.

**66deda5 — Exit event wiring + tests.** `files-tab.js` template — `.reviewState=${this._reviewState}` and `@exit-review=${this._onExitReview}` on the picker. `_onExitReview` calls `LLMService.end_review`, handles restricted responses (warning toast, state preserved — banner stays visible since the server rejected), partial-exit responses (warning toast with the git-reattach error message), and RPC rejections (error toast with exception message). No optimistic local clear — the server's `review-ended` broadcast is what actually ends review from the UI's perspective. 17 tests cover every dispatch path plus lifecycle invariants (review-ended doesn't clear selection, tree reload during review preserves banner, listener cleanup on disconnect).

Design points pinned by tests:

- **Review-started clears selection locally, review-ended does not.** Asymmetric by spec — entry is a fresh start, exit preserves context. A user who selected files during review and clicks exit shouldn't have to re-tick them. `review-ended does NOT clear selection` pins this; `review-started clears selection locally` pins the reverse.

- **Exit does not optimistically clear state.** If the server rejects (restricted caller in collab mode), the banner must stay visible so the user sees the error state rather than a confusing UI transition back to normal mode. Pinned by `exit-review does not optimistically clear state` — state checked immediately after dispatch, before the RPC resolves.

- **Banner survives tree reloads.** Mid-review `files-modified` events (from commits, resets, etc.) trigger `_loadFileTree`, which calls `_pushChildProps`, which now includes `reviewState`. Without re-pushing, the banner would disappear on every reload. Pinned by `tree reload during review pushes reviewState again`.

- **Partial-exit case is distinct from success.** When the server couldn't reattach the original branch but did clear review state server-side, the response carries `status: "partial"` and `error: "..."`. We warn rather than error — the review IS over, just with an unusual git state the user should know about. Pinned by `exit-review surfaces partial status as warning`.

- **Defensive degradation in banner render.** Missing `commits`, `stats`, or `branch` fields all render without crashing. A partial response from an older backend or a future refactor loosening the shape shouldn't break the UI. Three separate tests pin these paths.

### Increment 12 — `_syncMessagesFromChat` (skipped with documentation)

The spec (specs4/5-webapp/file-picker.md § Direct Update Pattern) describes a defensive pattern for preventing stale-message overwrites when selection changes trigger a files-tab re-render. The failure mode it guards against:

> User sends message → chat panel updates its messages array → user clicks a file mention → files tab re-renders → chat panel receives the files tab's stale messages prop → latest messages are lost.

**Decision: skip with documentation.** This failure mode does not exist in the current implementation because `<ac-files-tab>` never binds `.messages` on `<ac-chat-panel>`. The chat panel is the sole source of truth for its own message list; files-tab pushes `repoFiles` and `selectedFiles` down via the direct-update pattern but never touches `messages`. A files-tab re-render cannot clobber chat state that files-tab doesn't hold.

**Why skip rather than land preemptively:**

Adding the field, helper, and sync calls now would create defensive infrastructure against a race that can't fire. The "no code without a test that fails without it" discipline applies — a test that synthetically mutates `chatPanel.messages` and verifies the sync helper preserves it would pass identically with or without the helper, because the current rendering path never feeds messages back down. The test would be an architectural guardrail rather than a regression test, and dead defensive code tends to accumulate without corresponding understanding of what it protects.

**When Increment 12 becomes necessary:**

If a future refactor adds `.messages=${this._messages}` to the `<ac-chat-panel>` binding in the render template — for example, to support a shared-session model where files-tab mediates between chat history and some other consumer, or a collaboration feature where server-pushed message arrays flow through files-tab — the race becomes real and this increment must land. At that point:

1. Add `this._messages = []` to the constructor
2. Add `_syncMessagesFromChat()` helper that reads `chatPanel.messages` into `this._messages` when the chat panel exists
3. Call it at the start of every method that ends up calling `chat.requestUpdate()` — currently `_applySelection`, `_onReviewStarted`, and any others added in the refactor
4. Land a regression test that mutates `chat.messages`, triggers a selection change, and asserts the chat panel's messages are preserved
5. Document the binding + sync requirement alongside the binding in the template

**Grep breadcrumbs for future contributors:**

- `.messages=${` in `files-tab.js` — if this ever appears, revisit this increment
- `chatPanel.messages` access — if files-tab reads from it in any handler, the sync pattern is required
- The comment in `_applySelection` mentioning "DIRECT-UPDATE PATTERN (load-bearing)" documents which operations need the sync when it becomes necessary

### File picker completion — progress summary

Increments 1–9 delivered (both parts of 9). Remaining work: 10 (middle-click path insertion + @-filter bridge), 11 (review mode banner), 12 (_syncMessagesFromChat defensive pattern).

The picker is now fully usable for the common operations: browsing, selecting, excluding, git staging/unstaging, discarding, deleting, renaming (files and directories), duplicating, creating (files and directories), ad-hoc panel comparisons, and sort-mode-and-direction control. Keyboard navigation works end-to-end. Status badges + branch pill give visual git context. Active-file highlight follows the viewer.

The remaining increments add cross-component bridges (file-picker ↔ chat panel integration via @-filter and middle-click, review mode banner) plus a defensive architectural pattern for stale-message overwrites. The file-picker workflow itself is feature-complete for day-to-day use.

### Out of scope for this plan

- Dialog polish (dragging, resizing, minimizing, position persistence) — separate follow-up
- Doc Convert tab frontend — own feature
- Collaboration UI (admission flow, pending screen, participant indicators) — own feature
- Window resize handling, remaining global keyboard shortcuts — own small commit

Each increment above is a standalone commit. After each lands, strike through the heading in this plan, add a one-line delivery note with the commit hash, and note any deviations from the spec as decisions (D-N) in the main notes body.

### Plan status — complete

All twelve increments delivered or documented. Increments 1–11 shipped as individual commits; Increment 12 documented as skip-with-conditions. The file picker now covers the full feature surface specs4/5-webapp/file-picker.md calls for — status badges, sort modes, auto-selection, three-state checkboxes, active-file highlight, keyboard navigation, context menus for files and directories, middle-click path insertion, @-filter bridge, and the review mode banner.

Commit trail:
- **Increment 1** — status badges, diff stats, line-count color (delivered earlier)
- **Increment 2** — `71ea694` branch badge + tooltips
- **Increment 3** — `1e32eb2` sort modes
- **Increment 4** — auto-selection on first load
- **Increment 5** — three-state checkbox with exclusion
- **Increment 6** — active-file highlight
- **Increment 7** — keyboard navigation
- **Increment 8** — context menu (files) across 8a / 8b / 8c / 8d
- **Increment 9** — context menu (directories)
- **Increment 10** — `cafa47e`..`76fdcf9` middle-click path insertion + @-filter bridge
- **Increment 11** — `898c239`, `58036a8`, `66deda5` review mode banner
- **Increment 12** — skipped, documented above

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