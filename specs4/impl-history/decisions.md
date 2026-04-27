# Decisions (D1–D16)

Historical decision log. Moved from `IMPLEMENTATION_NOTES.md` during the docs refactor. Numbered for cross-reference; new decisions continue from D17 in the main working log.

---

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

### D17 — Monaco worker + module entry — two subtle failure modes

The webapp's Monaco diff editor stopped rendering diff highlighting during Layer 5 Phase 3 work (commit `c69b01f`). Debugging surfaced two independent pitfalls that any reimplementation should avoid up front, both visible in devtools but neither raising an error.

**Pitfall 1 — Worker loading pattern.** Monaco's official samples and earlier versions of this app used:

```js
new Worker(
  new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
  { type: 'module' }
)
```

Under Vite's dep optimizer this resolves at build time but returns HTML or 404 at runtime for the bare specifier. Worker construction throws; the `try/catch` in `MonacoEnvironment.getWorker` falls through to a no-op stub; diff output silently disappears. `getLineChanges()` returns `null` forever, no red/green backgrounds, no gutter markers. Syntax highlighting keeps working because Monarch tokenizers run on the main thread, making the failure hard to spot without devtools probing.

**Fix:** import the worker via Vite's `?worker` suffix, which delegates resolution to Vite's worker pipeline:

```js
// monaco-worker.js
import 'monaco-editor/esm/vs/editor/editor.worker.js';

// monaco-setup.js
import EditorWorker from './monaco-worker.js?worker';
// ...getWorker returns new EditorWorker()
```

Non-Vite bundlers should use their own documented worker-bundling pattern (webpack's `new Worker(new URL(...))` with `experiments.asyncWebAssembly`, esbuild's file loader, etc.) rather than the Monaco sample.

**Pitfall 2 — Module entry.** Monaco's ESM package exposes two top-level entries:

- `monaco-editor/esm/vs/editor/editor.api.js` — programmatic surface only
- `monaco-editor/esm/vs/editor/editor.main.js` — programmatic surface **plus** all contribution modules and built-in languages

The API entry is tempting because it looks smaller and lets you cherry-pick languages. But it omits the contribution modules — find widget, hover, folding, bracket matching, **diff decoration renderer**, word highlighter, color picker. Symptoms:

- `Ctrl+F` throws `Error: command 'actions.find' not found`.
- The diff algorithm runs correctly (`getLineChanges()` returns real data) but the highlighting, gutter markers, and overview-ruler ticks are rendered by contribution-layer code that never loaded, so changes appear invisible.

**Fix:** import from `editor.main.js`. Size cost is manageable via build-config chunk-splitting; `editor.main.js` is a separate chunk from the worker entry regardless.

**Diagnostic probe.** When diff highlighting doesn't work, run in devtools console:

```js
const v = /* walk shadow roots for <ac-diff-viewer> */;
const e = v._editor;
console.log('line changes:', e.getLineChanges());
console.log('has .mtk:', [...v.shadowRoot.querySelectorAll('style')]
  .some(s => s.textContent.includes('.mtk')));
console.log('has line-insert:', [...v.shadowRoot.querySelectorAll('style')]
  .some(s => s.textContent.includes('line-insert')));
```

Results:

| line changes | has .mtk | has line-insert | Cause |
|---|---|---|---|
| `null` | true | false | Worker not running — Pitfall 1 |
| non-empty | true | false | Contribution modules missing — Pitfall 2 |
| non-empty | true | true | Shadow-DOM style sync problem |
| `[]` | true | either | Models have identical content — model creation bug |

Ctrl+F independently confirms Pitfall 2: if it throws `actions.find not found`, the API-only entry is in use.

**Spec references.** The detailed worker-config recipe and diagnostic steps live in `specs4/5-webapp/diff-viewer.md § Monaco Worker Configuration` and `specs3/5-webapp/diff_viewer.md § Monaco Worker Configuration`. Both were updated alongside this decision.

**Lesson.** Monaco's documented sample code isn't safe by default under modern bundlers. Reimplementations should treat the worker-loading pattern and module entry as build-tool-specific choices, not as copy-from-sample decisions. Both failure modes are silent; tests that only verify the editor mounts and accepts edits will pass with either bug in place.

### D18 — Dropped svg-pan-zoom in favor of unified SvgEditor on both panes

Layer 5.11–5.12 shipped the SVG viewer with `svg-pan-zoom` handling viewport navigation on both panes (pan, zoom, fit) while 5.13's `SvgEditor` ran on the right pane for visual editing. Two libraries, two coordinate systems, two viewBox authorities — the editor had to reach around pan-zoom's viewport transform to compute correct screen-to-SVG coordinates for handles.

Three problems surfaced in practice:

1. **Shadow-DOM fragility.** `svg-pan-zoom` reaches into the global document for event binding in several places. The webapp mounts viewers inside shadow DOM; event dispatch through the shadow boundary worked under Chromium but produced inconsistent hit-test results under other browsers and under jsdom.

2. **Coordinate math duplication.** Both libraries needed to invert CTM to convert pointer events to SVG units. `SvgEditor` has its own `_screenToSvg` via `getScreenCTM` inversion; `svg-pan-zoom` has its own equivalent. Zoom-aware handle-size math lived in both places but had to agree, or selection handles would drift off their targets during zoom.

3. **Viewport sync as a four-party dance.** `svg-pan-zoom`'s `onPan`/`onZoom` callbacks fired on every pointer move, mirroring to the sibling instance under a mutex. The editor's own viewBox writes (from fit-content, programmatic set) had to also trigger sync. Four code paths converged on one sync primitive; each bug in any path produced a feedback loop.

**Resolution.** Dropped `svg-pan-zoom` entirely. `SvgEditor` gains a `readOnly` flag — when set, the editor skips selection, handles, marquee, keyboard shortcuts, text-edit, and the change callback, but keeps pan/zoom/fit. Both panes get an editor instance; the left is read-only. Each editor fires `onViewChange(viewBox)` on every viewBox write. The viewer wires each editor's `onViewChange` to mirror to the other via `setViewBox(..., { silent: true })`, guarded by a shared `_syncingViewBox` mutex so the initial fit-content during setup doesn't cascade.

**What this buys:**

- One coordinate system. Handles, pan, zoom, and the editor's own math share the same CTM inversion.
- One viewBox authority per pane. The `preserveAspectRatio="none"` that was previously set only on the right pane now applies to both so the browser's built-in aspect fitting doesn't fight the editor's math on either side.
- Read-only flag is belt-and-braces with the silent-write mutex — mirror writes go through a path that skips the sibling's onViewChange entirely, AND the mutex prevents any remaining cascade. Either guard alone would be sufficient; both together make the sync provably loop-free.

**What this costs:**

- Left pane's editor instance is bigger than a pan-zoom instance. The read-only path bails early in `_onPointerDown`, `_onKeyDown`, etc., so the extra cost is the instance allocation itself plus one event-listener set — both negligible.
- `fitContent({ silent: true })` is a new option on the editor. Needed during setup so the initial fit on one pane doesn't cascade to the other via the mutex-then-onViewChange path.

**Migration:**

- `svg-pan-zoom` dependency removed from `webapp/package.json`.
- `_panZoomLeft`, `_panZoomRight`, `_syncingPanZoom` gone. `_editorLeft`, `_editorRight`, `_syncingViewBox` replace them. `_editor` remains as a back-compat alias pointing at `_editorRight`.
- `_initPanZoom` / `_disposePanZoom` → `_initEditors` / `_disposeEditors`.
- Both panes get `preserveAspectRatio="none"` (was right-only).
- Tests rewritten; no more module-level `vi.mock('svg-pan-zoom', ...)`.

**Spec updates:** `specs4/5-webapp/svg-viewer.md` Overview + Synchronized Pan/Zoom sections. Impl-history: `specs4/impl-history/layer-5.md` gets a new sub-commit entry explaining the refactor without deleting the 5.11–5.12 historical record.

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
