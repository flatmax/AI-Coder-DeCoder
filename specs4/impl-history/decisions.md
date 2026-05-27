# Decisions (D1–D37)

Historical decision log. Numbered for cross-reference. Order in this file is delivery order, not numerical order — entries are appended as decisions land. Use the table of contents (or a search) to find a specific decision number.

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

### D27 — L0 is content-typed; cascade no longer touches it

The cache-tiering design originally allowed any tracked item — including full file content — to be promoted into any tier including L0, as long as it earned the N-counter graduation. Combined with the wide-exclude rule (a selected file's symbol block is removed from the aggregate map when its full content lives in Active), this meant routine selection toggles and edits could rewrite L0's byte sequence. Every cache-busting event paid a full L0 miss — typically the largest single block in the prompt.

The user's complaint surfaced the cost: "adding full context files invalidates the cache as symbol tables are dropped from the four tiers randomly, as they are added in full file to the context." Each turn that touched a file's selection or edit state risked invalidating the most expensive cached prefix.

**Resolution.** Separate the tier model into **content-typed** and **stability-typed** regions.

- **L0 (content-typed).** Permanent. Holds the system prompt plus the aggregate symbol map plus the aggregate doc map. The aggregate maps reflect the index state captured at session start (or after explicit `rebuild_cache`). L0 is invalidated *only* by application restart or explicit `rebuild_cache`. Edits, selections, URL fetches, history compaction, session loads — none touch L0.
- **L1, L2, L3, Active (stability-typed).** Hold full file content, fetched URL content, and history. The existing N-counter cascade promotes content from Active through L3 → L2 → L1 as it stays stable. Symbol blocks and doc blocks never appear here — they live only in L0's aggregate maps.

**Edit invariant.** When a file's content hash changes, `file:<path>` lands in Active with fresh content and is *pinned* — stale-cleanup and automatic eviction skip it. It rides the cascade upward normally as it stabilises but cannot be silently removed. Only application restart or cache rebuild clears pinned files.

**Deletion markers.** When a file is deleted during the session, its `file:<path>` entry transitions to a deletion-marker entry whose content is a fixed string (`[deleted in this session — see L0 symbol/doc map for last-known structure]`). The marker rides the cascade like any normal `file:` entry but its constant hash means subsequent cycles see no change. Survives until the next `rebuild_cache` re-extracts L0's aggregate maps from the now-current index. Bridges the gap between the file's deletion and L0's eventual refresh — the LLM sees a structural reference in L0 plus a confirmation in the marker that the file is gone, rather than a phantom reference with no full-text counterpart.

**Why duplicates are acceptable.** A selected file appears twice in the prompt: as a structural summary in L0's aggregate map, and as full text in the file's appropriate lower-tier section. The duplication is small (symbol blocks are dense) and is resolved by the system prompt's authority rule ("if a file appears in Working Files, the full text is the absolute truth, superseding any structural outlines provided earlier"). Modern instruction-tuned models follow this rule reliably via recency bias plus the explicit instruction.

**Tradeoff acknowledged.** The structural map L0 holds may drift during a session — a function signature in the symbol map can lag behind the actual edited file. The full edited text is always present in Active or a lower cached tier (the edit invariant guarantees this), and the new system prompt clause ("How Files Appear in This Prompt") tells the LLM that full-text in Current Working Files supersedes the structural map. Cost per incident: small — at worst, the LLM produces a comment or question based on a stale signature when the truth is right there in Working Files. Benefit: continuous — L0 cache survives every selection toggle, edit, URL fetch, and turn boundary in the session. Net is strongly positive: the structural map is for navigation, the full text is for truth.

**Wide-exclude logic removed.** With L0 always containing the full aggregate maps and L1–L3 never containing symbol/doc blocks at all, there's no longer any "is this symbol block already rendered elsewhere?" decision. The three call sites that previously coordinated on `wide_map_exclude_set` (`_assemble_tiered`, `_get_meta_block`, `get_context_breakdown`) simplify to "L0 always shows everything; lower tiers never show symbols." The renamed helper `user_excluded_paths` returns only the user's index-exclusion set (file picker's three-state checkbox).

**Cascade unchanged.** N-counter, ripple promotion, underfill demotion, hysteresis (when added) — all stay. The only new policy constraints are: nothing promotes into L0, nothing in L0 is rewritten by the cascade, and edited files are pinned against stale removal.

**Six-commit delivery sequence.**

1. `4cdc23a` — spec updates: `specs4/3-llm/cache-tiering.md`, `specs4/3-llm/prompt-assembly.md`, `specs-reference/3-llm/cache-tiering.md`, `specs-reference/3-llm/prompt-assembly.md`. Defines the contract before code changes.
2. `f9e2d1c` — system prompt updates: `src/ac_dc/config/system.md`, `src/ac_dc/config/system_doc.md` add the "How Files Appear in This Prompt — Authority Rule" clause. Synced to `specs-reference/3-llm/prompts/` via `scripts/sync_prompts.py`.
3. `8a7b4e9` — `StabilityTracker` changes: pin flag on `file:` entries with hash changes, deletion-marker transition in Phase 0, `mark_deleted` / `pin_file` / `is_pinned` / `is_deleted` helpers, cascade refuses to promote into L0, underfill demotion skips pinned and marker entries, removal protection in Phase 1 cleanup.
4. `2c8d6f1` — `init` and `rebuild_cache` paths: don't seed `symbol:`/`doc:` entries into L1/L2/L3 anymore; only `system:prompt` lands as a tracker entry; `rebuild_cache` clears pin flags as part of the explicit reset; aggregate maps regenerated at assembly time from the index.
5. `bba76ab` — `_breakdown.py` and `_assembly.py` changes: rename `wide_map_exclude_set` → `user_excluded_paths`; aggregate map rendering passes only user-exclusion set; per-file detail enumeration includes selected files; LLMService shim forwards to the new helper.
6. (this commit) — `specs4/impl-history/decisions.md` records D27; `specs4/3-llm/streaming.md` updated to drop the two-pass symbol map regeneration language.

**Test churn.** ~60 tests across `test_stability_tracker.py`, `test_llm_service/test_lazy_init.py`, `test_llm_service/test_rebuild_cache.py`, `test_llm_service/test_tiered_content.py`, `test_llm_service/test_breakdown_details.py` updated or rewritten. Roughly half are new tests covering the pin/marker contract; the other half are updates to assertions that previously expected wide-exclusion behaviour.

### D28 — L0 snapshot mechanism: frozen for assembly, live for everything else

D27 established that L0 is content-typed and invalidated only by explicit events. The original implementation read L0's content live from `SymbolIndex.get_symbol_map()` / `DocIndex.get_doc_map()` on every prompt assembly. Combined with per-turn `index_repo` calls in `_streaming.py` (which keep the live indexes current for cascade hash comparisons on per-file blocks in L1–L3), the live read meant L0's bytes drifted every turn even when no L0-invalidation event had fired:

- `index_repo` re-resolves imports and call sites on every cached file
- Setattr-based mutation of `Import.resolved_target` and `CallSite.target_file` means cached `FileSymbols` objects shift in-place
- The aggregate map, rendered live from these objects, produces a different byte sequence per turn
- L0's `cache_control` marker on a different byte sequence forces a fresh cache write

User-observed symptom (Opus 4.7, code mode, no cross-ref): 315K cache write per turn with 10% cache hit rate, where the L0 snapshot in the cache viewer showed only 2.8K of "tracked" content (system prompt) but the actual cached prefix was 315K.

**Resolution:** split L0's lifetime into two layers.

1. **Live indexes** stay current. `index_repo` continues to run per-turn so per-file blocks rendered into L1–L3 reflect edits, and so the next L0-invalidation event has accurate data to refreeze from.
2. **L0 snapshot** is a frozen capture of the rendered L0 bytes (system prompt + primary legend + primary aggregate map + secondary legend and map when cross-ref is on). Held on `LLMService`. Refrozen only at the L0-invalidation events enumerated in `specs4/3-llm/cache-tiering.md` § L0 Stability Contract.

**Snapshot fields** on `LLMService`:

```python
self._l0_system_prompt: str
self._l0_primary_legend: str
self._l0_primary_map: str
self._l0_secondary_legend: str  # empty when cross-ref off
self._l0_secondary_map: str     # empty when cross-ref off
```

**Refreeze method** `_freeze_l0_snapshot()`. Called from:

- `LLMService.__init__` (after symbol/doc indexes ready, deferred to `complete_deferred_init` if init is deferred)
- `_rpc_state.switch_mode` (after prompt swap)
- `_rpc_state.set_cross_reference` (after enable/disable)
- `_rpc_state.refresh_system_prompt` (only when prompt bytes actually changed; compare before/after)
- `_rpc_state.set_excluded_index_files` — branches:
  - Inclusion (file removed from exclusion list): unconditionally refreeze
  - Exclusion (file added to exclusion list): only refreeze when the user opts in via the webapp prompt
- `_rebuild.rebuild_cache_impl` (alongside the existing tracker reset)

**Assembly reads from the snapshot.** `_assembly.assemble_tiered` and `_assembly.assemble_messages_flat` use `service._l0_*` fields instead of calling `service._symbol_index.get_symbol_map(...)` / `service._doc_index.get_doc_map(...)`. Cross-reference dispatch (which side is primary) is decided when the snapshot is taken, not at assembly time.

**Cache-breakdown / HUD reads from the snapshot.** `_breakdown.get_context_breakdown` and the terminal HUD use the snapshot fields for L0 token counts. The "meta:repo_map" and "meta:doc_map" rows in the Cache sub-view of the Context tab show the snapshot's bytes, so the displayed L0 size matches what the LLM actually receives.

**Per-turn re-index stays.** `_streaming.stream_chat`'s call to `service._symbol_index.index_repo(file_list)` and the doc-index equivalent remain in place. The per-file blocks rendered into L1–L3 (via `get_file_symbol_block(path)` / `get_file_doc_block(path)`) need the live indexes, and so does the cascade's hash comparison for each `file:`/`symbol:`/`doc:` entry. The snapshot is the cache-stable view; the live indexes are the truth for everything else.

**Deferred init handling.** When `LLMService` is constructed with `deferred_init=True`, the symbol index isn't available until `complete_deferred_init` is called. The snapshot is empty until then; flat-assembly fallback covers the brief window before the first freeze. Once init completes, the first freeze runs and tiered assembly can proceed.

**File exclusion UX.** The new "invalidate L0 now?" prompt on file exclusion lives in the file picker's three-state checkbox handler. The RPC `set_excluded_index_files` gains an `invalidate_l0` boolean parameter (default `False`) so the webapp can pass the user's choice. Inclusions don't need the prompt — adding a file back to the index always calls for a refresh. The asymmetry is documented in `specs4/3-llm/cache-tiering.md` § What invalidates L0.

**Why not always invalidate on exclusion.** Excluding files mid-session is uncommon, and an L0 refresh costs a full cache write (315K+ tokens for a typical large repo). The user is the right authority to weigh "I want this excluded file out of context now" against "I'd rather not pay the cache cost yet". The webapp prompt makes the trade-off explicit.

**Tests.** Three new test cases:

- `test_l0_snapshot_stable_across_turns` — drive two consecutive `stream_chat` calls with no invalidation events; assert `_l0_primary_map` bytes are identical across both calls.
- `test_l0_snapshot_refreezes_on_mode_switch` — call `switch_mode`; assert the snapshot bytes changed (different prompt + different primary index).
- `test_l0_snapshot_refreezes_on_cross_reference_toggle` — toggle cross-reference; assert `_l0_secondary_map` populates on enable and clears on disable.

Existing tests in `tests/test_llm_service/test_tiered_content.py` and `tests/test_llm_service/test_breakdown_details.py` continue to pass — they test the assembly's outputs, which are now driven by the snapshot fields but produce the same shape.

---

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
| Agent conversations | Unspecified | Per-agent files archived to `.ac-dc4/agents/{turn_id}/agent-NN.jsonl`; main LLM lives in main history |
| Index mutation | Procedural timing | Read-only snapshots within a request |
| HUD breakdown | Session-global | Per-context-manager |

All are zero-cost in single-agent operation. Preserving them now means the foundation does not need reshaping when agent mode (specs4/7-future/parallel-agents.md) is added.

---

### D19 — SVG viewer listens directly for `files-modified`

The diff viewer's D18 rewrite eliminated cross-run staleness by refetching on every `openFile`. The SVG viewer kept its multi-tab `_files[]` cache and relied on the app shell's narrower set of refresh triggers (`streamComplete` with non-empty `files_modified`, `commitResult`, `files-reverted`), which miss external edits that fire only the generic `files-modified` broadcast — git pulls, edit-pipeline applies on unrelated workflows, collab writes, terminal edits.

Symptom: opening an SVG in the viewer, editing the same file outside AC⚡DC (or across a different run), clicking back to the viewer tab shows the pre-edit cached content. The backend RPC (`Repo.get_file_content`) is honest — it reads from disk — but `openFile`'s same-file short-circuit means it never gets called for an already-open path.

Resolution: the SVG viewer subscribes to `files-modified` window events in `connectedCallback`, removes the listener in `disconnectedCallback`, and calls `refreshOpenFiles()` when any affected path is open. `refreshOpenFiles` itself gained a dirty-skip guard so mid-edit SvgEditor state isn't clobbered by an unrelated refresh. Defensive against missing / empty `paths` in the event detail (older backends, edge paths) — falls back to refreshing every open file. Six new tests in `svg-viewer.test.js § SvgViewer files-modified broadcast` cover the happy path, unrelated-paths short-circuit, empty-detail defensive refresh, no-open-files no-op, dirty-file preservation, and disconnect cleanup.

The alternative — rewriting the SVG viewer to the diff viewer's single-file no-cache model (D18) — was rejected because the multi-tab SVG workflow is genuinely useful for presentation decks, the existing test coverage is extensive, and the set of paths that can change beneath an open SVG tab is narrow enough that `files-modified` covers it reliably.

### D20 — Agent-spawn block shape: minimal `{id, task}` + distinct `🟩🟩🟩 AGEND` end marker

Parallel agents (`specs4/7-future/parallel-agents.md`) are speculative future work — no implementation planned in the current scope — but the decomposition format had to be pinned concretely so edit-protocol parsers could reserve the marker bytes and so MCP integration (`specs4/7-future/mcp-integration.md`) had a shape to extend. Two decisions settled during design consolidation:

**Option A — minimal fields.** Agent-spawn blocks carry two required fields, `id` and `task`. No `read:`, `edit:`, or file-set pre-declaration. Agents navigate the repo with the same affordances the main LLM has (symbol map, reference graph, doc index, edit protocol), discovering files via the existing `files_auto_added` / `files_created` mechanisms. Alternatives considered: explicit file lists (rejected — error-prone, brittle, wastes planner reasoning budget), scope hints as non-binding suggestions (rejected — adds a field that duplicates what `task` already implies), independence declaration for sequencing (rejected — sequencing within a turn can be expressed as a second decomposition round). Unknown fields land in an `extras` dict for forward-compatibility; MCP uses this slot for its optional `tools:` field.

**Distinct end marker `🟩🟩🟩 AGEND`.** Agent blocks close with `🟩🟩🟩 AGEND` rather than sharing edit blocks' `🟩🟩🟩 END`. Shared end markers would force the parser to track which start marker opened the current block to decide what the end marker closes — brittle under malformed input, and would force frontend display parsers and backend apply parsers to stay in lockstep on state tracking. Distinct end markers let each parser dispatch on the literal line. The practical trigger was the edit protocol itself: a response (or a spec document) quoting both block types in the same region would have one marker accidentally terminate the other's. The `AGEND` keyword preserves the orange→green color progression and matches the four-character keyword convention (`EDIT`, `REPL`, `END`), while unambiguously differentiating the two block families.

Canonical contracts live in three places: `specs4/7-future/parallel-agents.md` (the behavioural spec, including the Foundation Requirements invariant that the current edit parser must tolerate `🟧🟧🟧 AGENT` / `🟩🟩🟩 AGEND` as prose), `specs4/3-llm/edit-protocol.md` (the edit-protocol spec marks agent blocks as reserved and cross-references the future spec), and `specs-reference/3-llm/edit-protocol.md` (the reference twin documents the exact marker bytes). `specs4/7-future/mcp-integration.md` uses the `extras` slot for `tools:` without introducing new marker syntax.

No code changes from this decision — the current `EditParser`'s state machine already treats unknown lines in `SCANNING` as prose, which is the behaviour the invariant requires. A future agent-spawning implementation will add parser branches that dispatch on the `AGENT` / `AGEND` keywords after the three orange / green emoji.

### D21 — Parallel agents interact through the existing chat panel via tabs

The `specs4/7-future/parallel-agents.md` spec originally described an "agent region" — a horizontally-scrolling strip of columns alongside the main chat, one column per spawned agent of the active turn. During design review of how a user would interact with a paused agent (answer a question, grant access to a file, kill a stuck agent), an elaborate protocol was considered: a dedicated `🟦🟦🟦 ASK` / `🟪🟪🟪 KSA` block format, a four-state agent lifecycle with `awaiting_user`, dedicated RPCs for replies and file grants, dedicated UI cards for question rendering.

All of that was rejected in favour of a much simpler model: **each agent is a chat conversation, surfaced as another tab in the existing chat panel**.

The insight is that the chat panel already IS a one-agent conversation UI with every affordance an agent interaction needs — streaming messages, file mentions, copy/paste, input history, snippets, image paste, URL chips, file picker integration. Building a separate ASK-block protocol with dedicated reply paths duplicates most of that work for questionable gain.

**What collapses:**

- No `ASK` / `KSA` marker protocol. Agents that need clarification just emit a normal assistant message — "I need to see `src/auth.py` to understand the token flow" — and stop streaming. This is indistinguishable at the protocol level from an agent that finished its work.
- No pause/resume state machine. An agent's "state" is whatever its `ContextManager` holds. "Waiting for user input" is just "the conversation hasn't had a follow-up user message added yet." Same as the main chat between user turns.
- No dedicated reply or file-grant RPCs. Replying to an agent is `chat_streaming(request_id, message)` routed at the active tab's `{turn_id, agent_idx}` identifier instead of the main conversation. Granting a file is ticking the box in the file picker while that agent's tab is active — the picker's selection state scopes to the active tab.
- No dedicated confirmation cards for file requests. Agent asks for a file in English; user clicks it in the picker; agent's next turn has it. The picker already does this job for the main conversation.

**Lifecycle simplification:**

- Agents persist for the lifetime of their turn, not the lifetime of a single LLM call. An agent that stops streaming doesn't vanish — its tab stays, its ContextManager and stability tracker stay, its provider cache stays warm. The user can walk away, come back hours later, reply to the agent, and the next call benefits from the cached prefix.
- The turn's agents all disappear when the user starts the next agentic turn in the main tab. New decomposition, new turn_id, new agent tabs. Previous turn's archive persists on disk and is readable via the history browser.
- A user can explicitly close an individual agent tab to free its ContextManager early (equivalent to killing that agent). The archive file stays.
- Synthesis happens when the user asks for it — a "synthesise now" button in the main tab's action bar, or an explicit message to the main LLM. Not auto-triggered by some heuristic, because the user is the authority on "have I heard enough from the agents."

**Provider-level implications (the reason this works at all):**

- litellm is stateless — each `completion()` call is independent. Multiple ContextManagers making concurrent calls never cross-contaminate.
- Provider chat-completion APIs are stateless — the full message array ships with each request. Two agents holding different conversations really are different conversations to the provider.
- Cache breakpoints are per-agent because StabilityTrackers are per-ContextManager (the D10 "trackers scope to their owning context manager, not a singleton" invariant). Agent 2's fifteenth turn reuses Agent 2's accumulated L0/L1/L2/L3 cache prefixes — the persistence of the agent across interactions is exactly what makes the cache useful.
- Tab switching on the frontend is pure UI state. No tracker invalidation, no cache eviction, no backend notification. Switching to agent 3's tab just changes which ContextManager's history renders in the chat panel.

**What the frontend still needs to build:**

1. Tab strip in the chat panel. One "Main" tab plus dynamically-added agent tabs for the active turn. Scrollable / overflow-menu when tab count exceeds viewport width.
2. Per-tab state — active request ID, message list, selection set — keyed by `{turn_id, agent_idx}` for agents or `"main"` for the main conversation. Streaming-state routing (D10's request-ID-keyed model, already in place) surfaces each agent's chunks into its own tab.
3. Per-tab RPC routing. `chat_streaming`, `cancel_streaming`, file selection operations all operate on the active tab's scope rather than an implicit singleton.
4. Tab lifecycle — spawn on agent-spawn blocks, remove when a new turn begins in the main tab, allow explicit per-tab close, surface the archive via history-browser scroll for closed turns.

None of this requires backend protocol changes beyond what Slices 1-3 of the parallel-agents foundation have already landed. The AGENT/AGEND block format stays as specced; the agent archive format stays as specced; the tab strip is the surface through which the archived conversations become live, interactive, cache-warm conversations while the turn is active.

**What this means for `specs4/7-future/parallel-agents.md` and `specs4/5-webapp/agent-browser.md`:**

- The "Agent region" model in agent-browser.md is replaced with a tabbed-chat model (D21 delivery).
- The "User-Visible Agent Browsing" section in parallel-agents.md updates to reference tabs rather than regions.
- The ASK-block / pause-resume thinking is NOT in any spec — it got rejected before it was written down. This decision log is the record that we considered it and chose differently.

### D22 — Parallel-agents foundation uses the existing streaming pipeline

Earlier iteration of the parallel-agents foundation built three new modules: `agent_runner.py` (Slice 6a — runs one agent end-to-end), `agent_orchestrator.py` (Slice 6b — dispatches N agents concurrently), and a planned `agent_edit_applier.py` (Slice 6c — applies agent edits to disk). 6a and 6b shipped with full test coverage; 6c was partially written.

All three are being removed. The shipped work is being reverted.

The problem: each agent is a chat session (per D21). A chat session has a streaming pipeline — `LLMService._stream_chat` — that already handles message assembly, litellm invocation, edit parsing, edit application, persistence, stability tracking, and post-response work. Building a parallel runner / orchestrator / applier duplicates that pipeline while missing the features it provides.

The right foundation is a refactor of `_stream_chat` so its ContextManager is a parameter rather than hardcoded to `self._context`. Once that lands, agent mode becomes:

- Parse agent-spawn blocks (existing edit_protocol work — already landed)
- Construct N agent ContextManagers via `build_agent_context_manager` (Slice 5 — already landed)
- Invoke `_stream_chat` N times in parallel with different ContextManagers and child request IDs

No new runner. No new orchestrator. No new applier. Each agent benefits automatically from every feature `_stream_chat` has — URL fetching, review-mode gating, edit-block retry prompts, session totals tracking, terminal HUD, compaction triggers — and from any future improvements to that pipeline.

The `AgentBlock` marker parsing (Slice 3) and per-agent ContextManager factory (Slice 5) stay — they're genuine foundation work that the eventual `_stream_chat` refactor will consume. The turn-ID propagation (Slice 1) and archive persistence (Slice 2) also stay — same reason.

Files deleted:

- `src/ac_dc/agent_runner.py`
- `src/ac_dc/agent_orchestrator.py`
- `tests/test_agent_runner.py`
- `tests/test_agent_orchestrator.py`

Also reverted: the `cancelled` and `apply_report` fields added to `AgentResult` (the dataclass itself goes with agent_runner.py).

Spec change: `specs4/7-future/parallel-agents.md` § Foundation Requirements gains a pointer to the ContextManager factory invariant and adds a short paragraph describing the refactor-based implementation approach.

### D23 — Agent-mode toggle threads through three layers with distinct concerns

The `agents.enabled` toggle in `app.json` gates the parallel-agent capability at three independent layers, each with its own rationale. Landed as a three-commit sequence across one session. Commit 1 added the config property (`agents_enabled`), commit 2 added the prompt-assembly mechanism (`system_agentic_appendix.md`), commit 3 wired the live-refresh path so toggle flips take effect on the next user turn rather than the next mode switch.

**Layer 1 — config.** The toggle is a boolean field under `agents.enabled` with default `false`. Exposed via `ConfigManager.agents_config` (dict shape for future extension — max concurrent agents, per-agent budget, synthesis delay all fit into the same section) and `ConfigManager.agents_enabled` (convenience bool accessor used in the hot prompt-assembly path). Malformed `agents` values — non-dict section, non-bool `enabled`, missing field — all degrade to False via Python's `bool()` coercion semantics. Tests pin every degradation case so a future refactor that "helpfully" rejects truthy strings can't silently flip the invariant.

**Layer 2 — prompt assembly.** The agent-spawn capability description lives in a separate bundled file, `system_agentic_appendix.md`, not fenced into `system.md`. Earlier design explored fence markers (`<!-- APPENDIX_START -->`) with regex stripping based on the toggle, rejected because: two files with a tight concatenation is cleaner than one file with runtime-gated stripping; user customisation is a simple file edit rather than a tricky partial edit of a larger file; and the upgrade pass naturally backs up customisations to the appendix via the standard managed-file mechanism. `get_system_prompt()` concatenates `system.md` → appendix (if enabled) → `system_extra.md`, with `system_extra.md` LAST so project-specific rules apply to everything above (including the appendix when agent mode is on).

The appendix uses **user-dir-only read semantics**, distinct from the base `system.md` where the fallback-to-bundle path is load-bearing. A user who deletes `system_agentic_appendix.md` from their user config dir has made a clear choice to suppress agent-mode instructions; the fallback-to-bundle pattern would defeat that choice by re-injecting the text they just removed. The base `system.md` can't use user-dir-only because a missing base prompt would break every chat request — so the two files deliberately have different read semantics, documented in `specs4/1-foundation/configuration.md` § User-Dir-Only Read for the Agentic Appendix.

Diagnosing the test failure that surfaced this semantic took one turn of back-and-forth. The test deleted `system_agentic_appendix.md` expecting the prompt to omit the appendix, but the assertion still found "Agent-Spawn Capability" in the prompt — because `_read_user_file` was falling back to the bundled copy under `src/ac_dc/config/system_agentic_appendix.md`. Fix was a user-dir-only read path added inline in `get_system_prompt()` rather than plumbing a no-fallback option through the generic helper.

**Layer 3 — LLMService refresh wiring.** Without explicit refresh, the context manager caches the assembled prompt at session start, mode switches, and review entry/exit. Toggling `agents.enabled` in the Settings tab would change what `ConfigManager.get_system_prompt()` returns, but the cached prompt on the active context manager wouldn't refresh until the next mode switch — producing a confusing UX where the toggle UI says "agents on" but the LLM doesn't see the appendix for several turns.

`LLMService.refresh_system_prompt()` re-reads the mode-appropriate prompt from config and installs it on the context manager. Called by `Settings.reload_app_config()` after a successful `ConfigManager.reload_app_config()`. Respects review mode (the review prompt stays authoritative until review exit), is idempotent, and has its own localhost gate independent of Settings' gate.

The `Settings(config, llm_service=...)` constructor takes an optional LLMService reference. Existing tests and call sites that omit the kwarg keep working — the refresh just doesn't fire when no service is attached, matching pre-commit-3 behaviour. `main.py` wires the reference post-construction via `settings._llm_service = llm_service` because Settings is constructed before LLMService (the usual dependency-inversion pattern for collab and other cross-service wiring).

**Layer 4 — Settings-tab toggle card (frontend).** The backend wire-through (commits 1–3) left the toggle reachable only by editing `app.json` directly. Commit 4 (`d56586d`) adds a dedicated toggle-card renderer to `webapp/src/settings-tab.js` that surfaces `agents.enabled` as an inline switch in the Settings tab — read-in reads the underlying `app.json` content, click-to-flip writes it back via `Settings.save_config_content`, which triggers the reload-and-refresh chain the three backend commits set up.

The card uses a new `renderer: 'toggle'` mode in the `CONFIG_CARDS` catalog, distinct from the default textarea-editor cards. The `toggleConfigKey` names the underlying config type (`'app'`), and `togglePath` is a dot-separated path into that JSON (`'agents.enabled'`). Defensive parsing falls back to `toggleDefault` when JSON is malformed, the `agents` section is missing, or the field is non-bool. A per-card `_togglingKey` field prevents rapid-click double-writes while the save+reload is in flight. Remote collab participants see the switch rendered disabled with a "Host controls this setting" note; mutation is still enforced backend-side by `save_config_content`'s localhost gate, the disabled switch is defensive UI only.

`_loadLocalhostFlag` currently hardcodes `_localhost = true` with a TODO — wiring it to real role data lives with the broader collab-UI work that's explicitly parked. Until that lands, remote participants get a restricted-error toast on click rather than a pre-disabled switch; the outcome is the same (write rejected) but the UX is less polished.

**Invariant preserved**: when `agents.enabled` is `false`, the LLM is never told about agent-spawn blocks. The appendix file is never read, the system prompt never mentions the capability. This is stronger than "the parser tolerates unknown blocks" — the LLM can't emit blocks it doesn't know exist. Users wanting to experiment with agent mode opt in deliberately; users on budget-sensitive workflows never pay the appendix's token cost.

The four commits form a complete wire-through with no intermediate half-on states. A single commit implementing all four would have been harder to review and harder to revert. The *information plane* is end-to-end deliverable from Settings-tab click through to the next user turn including the appendix in its system prompt.

**What D23 does NOT deliver — the execution plane.** Enabling the toggle tells the LLM about agent-spawn blocks via the appendix. It does not cause anything to spawn. The edit parser recognises `🟧🟧🟧 AGENT` / `🟩🟩🟩 AGEND` as reserved marker syntax (D20) and the `AgentBlock` dataclass captures parsed fields, but no dispatch path consumes those blocks — they surface in the response as prose. The `build_agent_context_manager` factory exists (Slice 5), turn-ID propagation exists (Slice 1), agent archive persistence exists (Slice 2), but the `_stream_chat` refactor that would invoke N agents in parallel has not landed (see D22). The tabbed chat-panel UI described in D21 has not landed either.

So toggling agents on today produces a more informative LLM response — it may reference agent blocks in its reasoning, or emit well-formed blocks that nothing acts on — without changing what actually executes. The toggle is decorative from an *execution* standpoint. This is deliberate: `specs4/7-future/parallel-agents.md` files the dispatch layer under future work, and the gating infrastructure had to land first so when dispatch is implemented, the LLM can be taught the capability and then un-taught without redeploying.

### D24 — `_stream_chat` `ConversationScope` refactor complete; module decomposition deferred

The execution-layer prerequisite called out at the end of D22 has landed. `LLMService._stream_chat` and every per-conversation helper it calls now thread a `ConversationScope` dataclass containing the conversation's `ContextManager`, stability tracker, session ID, selected-files list, and archival-append closure. Shared infrastructure (`_repo`, `_config`, `_symbol_index`, `_doc_index`, `_url_service`, `_edit_pipeline`, executors, event callback, guard state) stays on `LLMService`. For the main user-facing session, `_default_scope()` builds a scope from `self` and the behaviour is byte-identical to the pre-refactor implicit-reads; a future agent-spawning path constructs per-agent scopes via `build_agent_context_manager` (Slice 5) and invokes `_stream_chat` N times in parallel.

**The 11-commit sequence.** Landed over eleven reviewable commits rather than one monolithic diff. Each step left the codebase passing tests; no intermediate half-refactored state shipped. Commit hashes and content in the progress log at `docs/parallel-agents-scope-refactor.md`:

1. Add `ConversationScope` dataclass + `_default_scope()` helper; no call sites use it yet
2. `_stream_chat` accepts `scope`; `chat_streaming` threads it through
3. `_post_response(scope)` — compaction system-event writes go through `scope.context.add_message` and `scope.archival_append`
4. `_update_stability(scope)` — tier assignment reads `scope.tracker`, `scope.context.mode`, `scope.selected_files`
5. `_sync_file_context(scope)` — file loads target `scope.context.file_context`
6. `_build_tiered_content(scope)`, `_assemble_tiered(scope)`, `_assemble_messages_flat(scope)` — all tier assembly reads per-conversation state from scope
7. `_detect_and_fetch_urls(scope)` — URL context attaches to `scope.context`; `_url_service` stays shared
8. `_build_completion_result(scope)` — auto-add mutations write to `scope.selected_files` and `scope.context.file_context`
9. `_build_and_set_review_context(scope)` — last per-conversation callee; review-mode state stays main-only on `self`
10. `TestConversationScopeDefault` — five-test regression guard pinning explicit-scope equivalence
11. This entry

**Main-conversation-only state pinned to self.** `_review_active` and `_review_state` intentionally do NOT move into scope. Review mode is a main-conversation feature per specs4/4-features/code-review.md § Limitations; agents never enter review. Keeping the state on `self` surfaces that invariant at the method boundary — a reader of `_stream_chat` sees the review-mode branch read from `self._review_active` and understands immediately that this code path is specific to the user-facing session. Threading scope through `_build_and_set_review_context` was for consistency; the method's content still reads `self._review_state` because scope never carries it.

**The `archival_append` closure is the agent-vs-main abstraction.** For the main conversation, `_default_scope()` wraps `HistoryStore.append_message` in a closure that captures the store. For a future agent conversation, `build_agent_context_manager` returns a ContextManager whose `archival_sink` wraps `HistoryStore.append_agent_message` and bakes in the turn_id + agent_idx. At the call site in `_stream_chat`, `scope.archival_append("user", content, session_id=..., turn_id=...)` works identically — it's just a callable that persists one message. Neither the main path nor the agent path has to know the other exists.

**Decomposition of `llm_service.py` deferred.** The module is ~3000 lines — a handful of RPC methods (mode / cross-reference / review / URL / rebuild / session / history / LSP / TeX / settings-refresh), the streaming pipeline, and the orchestration glue that wires context + tracker + compactor + URL service + event callback + guard state. Splitting it now during the refactor would produce a chain of dependencies between new modules that the scope refactor itself doesn't motivate. Candidate carve-outs for a future pass: the RPC surface methods (mode / review / URL / rebuild) into `llm_rpc_methods.py`, the streaming pipeline (`_stream_chat` + `_run_completion_sync` + `_build_completion_result` + helpers) into `llm_streaming.py`, the stability-tier glue (`_try_initialize_stability` / `_update_stability` / `_rebuild_cache_impl`) into `llm_stability.py`, keeping `LLMService` in `llm_service.py` as the public entry point. Not this commit.

**Next concrete work — delivered.** See D25 for the execution-plane shipping record. Summary: parser dispatch, `_spawn_agents_for_turn`, per-agent scope construction, and post-spawn assimilation have all landed across six commits (Steps 1-6 in `docs/agent-spawning-plan.md`). Synthesis was deliberately replaced with user-driven review — see D25 for the scope revision and its rationale.

**What "agentic mode" means today, concretely.** Four things landed:

| Layer | Piece | Delivered |
|---|---|---|
| Config | `agents.enabled` flag, `agents_config` / `agents_enabled` properties, malformed-value degradation | ✓ |
| Prompt assembly | `system_agentic_appendix.md` bundled file, concatenation logic, user-dir-only read semantics | ✓ |
| Live refresh | `LLMService.refresh_system_prompt()` invoked from `Settings.reload_app_config()` | ✓ |
| Frontend | Settings-tab toggle card with click-to-save, defensive parsing, localhost gate, in-flight guard | ✓ |

Four things did NOT land and belong to the future spec:

| Layer | Piece | Status |
|---|---|---|
| Parser dispatch | Branch in `EditParser` that routes `🟧🟧🟧 AGENT` blocks to a spawn handler instead of treating them as prose | Foundation (D20) tolerates the markers; no dispatch path exists |
| Execution | `_stream_chat` refactor to take ContextManager as parameter, then invoke N times in parallel per agent block (per D22) | Not started |
| Archive UI | Tab strip in chat panel, per-tab state keyed by `{turn_id, agent_idx}`, per-tab RPC routing (per D21) | Not started |
| Synthesis | Main LLM observing agent completion and deciding synthesize / iterate / recover | Not started |

The gap between "information plane complete" and "execution plane implemented" is substantial — roughly the content of `specs4/7-future/parallel-agents.md` § Execution Model, Agents, Review Step. That spec remains in `specs4/7-future/` precisely because it's future work. A user toggling `agents.enabled` on today gets a more informative LLM that knows about a capability it cannot exercise.

The value of landing D23 in isolation is cleanup cost. When the dispatch layer IS implemented later, the prompt-side gating infrastructure is already in place — the feature can be tested with `agents.enabled=true` from day one, and the existing test suite pins the off-state invariant (appendix-never-read, prompt-never-mentions-capability) so a regression that leaked agent instructions into non-agent deployments would trip on the first test run.

### D25 — Agent execution plane delivered; synthesis replaced by user-driven review

The four "not started" items from D24's closing table split: parser dispatch, execution, and post-spawn assimilation landed across six commits following the plan in `docs/agent-spawning-plan.md`. The synthesis item dropped from scope — deliberately replaced by user-driven review on the follow-up turn — and the archive UI (D21 tab strip) remains deferred.

**What shipped.** Six commits, each leaving tests passing:

| Step | Commit | Content |
|---|---|---|
| 1 | Step 1 scaffold | Parser dispatch as a reachable no-op; log-only when toggle on; `_filter_dispatchable_agents` gates on `agents.enabled` + non-empty valid blocks |
| 2 | Step 2 spawn skeleton | `_spawn_agents_for_turn` constructs per-agent scopes via `build_agent_context_manager`, derives child request IDs `{parent}-agent-{NN:02d}`, fans out via `gather(return_exceptions=True)`; `_agent_stream_impl` attribute starts as a no-op stub |
| 3 | Step 3 real streaming | `_agent_stream_impl` flips to `_stream_chat`; agents run the full pipeline (LLM call, edit apply via per-path mutex, per-agent archive persistence, post-response stability update); `_FakeLiteLLM.queue_streaming_*` supports per-call directives for parallel agents |
| 4 | `7c0f999` (Step 4+5) | `_assimilate_agent_changes(agent_results, parent_scope)` unions `files_modified` + `files_created`, refreshes parent's `file_context` for every touched path, fires `filesChanged` + `filesModified`; `_stream_chat` returns the completion result so assimilation reads fresh dicts rather than re-parsing archives; 6-test `TestAgentAssimilation` suite covers single/multi-agent, no-op, creates, sibling exceptions, cross-turn observable |
| 6 | This entry | Delivery note |

**The deliberate scope revision.** Step 4 was originally planned as a synthesis LLM call — after all agents complete, fire a second `completion()` from the parent scope with the per-agent transcripts as context, let the main LLM write a unified response. That got dropped in favour of mechanical assimilation for three reasons documented fully at `specs4/7-future/parallel-agents.md` § Review Step — User-Driven:

1. **Redundant token spend.** The main LLM already SAW what it delegated (it wrote the spawn blocks). Having it re-read per-agent transcripts to summarise its own plan's execution is reasoning the model already did.
2. **User context is load-bearing.** The judgement "is this complete, are the pieces consistent, what's left to do" depends on what the user cares about most, which tests they ran, which tradeoffs they'd accept. A synthesis LLM call without that context produces plausible-sounding summaries that miss the point.
3. **Natural checkpoint.** Stopping after the initial response — with agent-spawn blocks rendered as prose — lets the user see file changes in the picker before any further LLM work. Agents that went off the rails get caught before spending more tokens on a synthesis of bad work.

The user-driven path: main LLM's assistant message (containing the spawn blocks as prose narrating what it delegated) IS the turn's final assistant message. The picker updates via `filesChanged` / `filesModified` broadcasts. On the next turn, the user types a follow-up — typically the one-click `🤖 Review agent work` snippet added in Step 4's commit — and the main LLM sees the post-change file state in its context (assimilation loaded it there) and can judge completeness, flag inconsistencies, suggest fixes.

**Rejection of alternatives.** An earlier draft of Step 4 had the assimilation method re-parse `history_store.get_turn_archive(turn_id)` to recover `files_modified` / `files_created` from archive records. That required teaching the archive to persist those metadata fields (currently it stores role + content only — the edit metadata lives on the completion result dict, which predates the archive append). Simpler to have `_stream_chat` return the result dict and let `_spawn_agents_for_turn`'s `gather` collect them. Byproduct: `_stream_chat` is now return-value-bearing for the main-conversation path too, but `chat_streaming`'s `ensure_future` ignores the return — no behaviour change for single-agent operation.

**What remains deferred.** Two deferrals carried over from D24:

| Layer | Piece | Status |
|---|---|---|
| Archive UI | Tab strip in chat panel, per-tab state keyed by `{turn_id, agent_idx}`, per-tab RPC routing (per D21) | Not started |
| Automatic synthesis | Dropped from scope by the D25 scope revision; user-driven review replaces it | Not applicable |

The tab-strip UI is a real deferral — until it lands, agent conversations exist only in the JSONL archive files. Users see the main LLM's response (including the spawn blocks rendered as prose by marked.js) and the resulting working-tree changes via the picker + diff viewer. The `get_turn_archive(turn_id)` RPC exists and works; nothing in the chat panel calls it yet. When the tab strip ships, existing turns from before its delivery remain browsable via the RPC without migration — the archive format is the contract.

Synthesis is not deferred in the "waiting to be implemented" sense — it's replaced. A user wanting a synthesis-like experience types "review what the agents did" (or clicks the snippet). The main LLM reads the post-change files from its context, produces a unified response that takes the user's actual follow-up question into account (tests run? specific concern? broader pattern?), and continues the conversation naturally. The one-click snippet gives the common case a single-gesture entry point without committing the backend to a specific synthesis prompt or timing.

**What "agentic mode" means today, updated from D24.** Seven things landed across D23 + D25:

| Layer | Piece | Delivered |
|---|---|---|
| Config | `agents.enabled` flag, `agents_config` / `agents_enabled` properties, malformed-value degradation | ✓ (D23) |
| Prompt assembly | `system_agentic_appendix.md` bundled file, concatenation logic, user-dir-only read semantics | ✓ (D23) |
| Live refresh | `LLMService.refresh_system_prompt()` invoked from `Settings.reload_app_config()` | ✓ (D23) |
| Frontend | Settings-tab toggle card with click-to-save, defensive parsing, localhost gate, in-flight guard | ✓ (D23) |
| Parser dispatch | `_filter_dispatchable_agents` + `_spawn_agents_for_turn` gating on `agents.enabled`, valid blocks, non-child request | ✓ (D25) |
| Execution | Per-agent `ConversationScope`, fresh tracker + ContextManager per agent, child request IDs, `asyncio.gather` fan-out; agents run the full `_stream_chat` pipeline | ✓ (D25) |
| Assimilation | `_assimilate_agent_changes` unions modified+created, refreshes parent's file context, broadcasts to picker | ✓ (D25) |

When the toggle is on and the LLM emits agent-spawn blocks, the backend now genuinely fans out N parallel streams, each with their own ContextManager / tracker / archive, each producing real LLM calls and real edits on disk. The parent's next user turn sees the unioned file changes in its prompt automatically. The deferrals are all in the UI layer — the execution substrate is complete.

### D26 — Webapp test rewrite for flat agent-identity contract

D21 originally specified agent tab IDs as the compound shape `{turn_id}/agent-{NN}`, with `parseAgentTabId` returning a `[turn_id, agent_idx]` tuple and the corresponding RPCs (`set_agent_selected_files`, `set_agent_excluded_index_files`, `close_agent_context`, `chat_streaming`'s `agent_tag`) taking three or four positional arguments to thread the tuple components through.

Specs4/5-webapp/agent-browser.md and specs4/7-future/parallel-agents.md § "Agent Reuse by ID" subsequently revised this contract to **flat identity**: the agent's LLM-chosen `id` from its `🟧🟧🟧 AGENT` block IS the tab ID IS the backend registry key. `parseAgentTabId(tabId)` becomes the identity function for any non-"main" non-empty string, returning `null` only for `"main"` and malformed inputs (empty string, non-string types). The backend RPCs take a single `agent_id` string instead of a `(turn_id, agent_idx)` pair. The padded numeric index in child request IDs (`{parent}-agent-{NN}`) and archive file names (`.ac-dc4/agents/{turn_id}/agent-{NN}.jsonl`) is a routing/storage detail — it does not feed back into tab identity, and the frontend never reconstructs identity from it.

Production code in `webapp/src/chat-panel.js` and `webapp/src/files-tab.js` was updated to match the flat-identity spec when the spec change landed, but 27 tests in `chat-panel.test.js` and `files-tab.test.js` still asserted the obsolete tuple-parsing contract. The failures broke into six buckets:

| Bucket | Tests | Stale assertion shape | New shape |
|---|---|---|---|
| `parseAgentTabId` unit tests | 8 | Returned `[turn_id, agent_idx]` tuple | Returns the input string verbatim |
| `agent_tag` routing | 4 | `args[5]` was `[turn_id, agent_idx]` | `args[5]` is the agent id string |
| Agent tab spawning — tab creation | 5 | Tab ID was `{turn_id}/agent-{NN}` | Tab ID is the spawn block's `id` field |
| Agent tab spawning — defensive | 4 | Same tab-ID expectations | Updated to flat ids (`agent-0`, etc.) |
| Close-tab + stale-tag | 3 | RPC called with `[turn_id, agent_idx]` | RPC called with `[agent_id]` |
| Files-tab routing | 3 | RPC took 3 positional args | RPC takes 2 (`agent_id`, `files`) |

Total: 27 tests rewritten. The "malformed agent tab ID falls back to main RPC" test was also retired — under flat identity, any non-"main" non-empty string is a valid agent id, so the test's premise (malformed tab IDs that fall back to main routing) no longer exists. Replaced with a "main tab routes to main RPC" test that pins the only routing distinction the new contract makes ("main" → main RPCs, anything else → agent RPCs).

The decision was tests-rewritten-not-code-reverted because:

1. **Spec is authoritative.** Three independent spec sections (parallel-agents.md § Agent Reuse by ID, agent-browser.md § Per-Tab State, agent-browser.md § Tab Creation Ordering, agent-browser.md § Invariants) all explicitly call out flat identity. The production code matches; the tests don't.

2. **Reverting would require coordinated changes across both layers.** Going back to the tuple shape means changing `chat-panel.js` (`parseAgentTabId`, tab creation in `_spawnAgentTabs`, `_onTabClose`'s RPC dispatch), `files-tab.js` (`_sendSelectionToServer`, `_sendExclusionToServer`), AND the four backend RPC method signatures in `LLMService`. Plus updating four spec files in two suites. Compared to rewriting 27 tests' expectations to match the spec the production code already implements: the test edit is mechanical and surgical.

3. **Flat identity has clearer semantic.** "The id IS the tab IS the registry key" is one rule; "the tab id encodes turn-and-index, parsed back into a tuple at three RPC boundaries" is three rules with parsing failure modes at each boundary. The spec revision wasn't arbitrary — flat identity makes id-based reuse across turns natural (the user's "frontend-trivial" agent stays "frontend-trivial" regardless of which turn spawned it), and removes the disambiguation layer that the parsing required.

The fix updated test fixtures and assertions only. No production code changed.

### D29 — `apply_llm_env` runs explicitly on cold start, not from `ConfigManager.__init__`

Cold start was failing on the first LLM turn with provider-side errors that disappeared after any save in the LLM-config UI. Diagnosed to `main.run` constructing `ConfigManager` without ever calling `apply_llm_env`. The `env` dict in `llm.json` (typically `AWS_REGION`, `AWS_PROFILE`, or provider API keys) was dead config until the first `reload_llm_config` triggered the export. The first turn used whatever `os.environ` carried from the shell — frequently a stale `AWS_DEFAULT_REGION` or an inherited profile default — and providers rejected it.

Two placements considered:

1. **Inside `ConfigManager.__init__`** — every consumer gets correct env automatically. Rejected: tests like `test_apply_llm_env_exports_variables` assume `os.environ` is clean before they call `apply_llm_env` explicitly. More fundamentally, hiding a process-state mutation inside a constructor is surprising — settings inspection, history-store testing, and other non-runtime consumers shouldn't have their environment rewritten as a side effect of asking what the config says.

2. **Explicit call in `main.run`** — chosen. One line right after `config = ConfigManager(repo_root=repo_path)`, before `Settings(config)` or any other service that might trigger litellm provider construction. Construction stays free of side effects; the cold-start entry point owns the lifecycle contract.

Why hot reload masks the bug: `Settings.save_config_content` → `Settings.reload_llm_config` → `ConfigManager.reload_llm_config` → `apply_llm_env`. The reload path was always correct; only the cold-start path missed the call. Once a user saved any change in the LLM-config UI (even the same value re-saved), the env exported and the next turn worked — making the failure look intermittent and configuration-related rather than a startup bug.

Why provider hot-reload also benefits: litellm constructs provider clients lazily on the first `completion()` call for that provider. boto3 (Bedrock's transport) reads `AWS_REGION` at `boto3.Session()` construction time and caches it on the session. If the first call already happened with a stale region, subsequent env changes wouldn't reconfigure the cached session — but in practice the first call happens AFTER `apply_llm_env`, so this hasn't been observed. Documented as a future-proofing concern in `specs-reference/1-foundation/configuration.md` § Provider SDK env-var caching.

Spec updates landing alongside this decision:

- `specs4/1-foundation/configuration.md` § Env-var export timing — the lifecycle contract (cold start + every reload), and the explicit pin that `__init__` does NOT call it.
- `specs4/6-deployment/startup.md` § Phase 1 step 3 expanded — env application slotted between config-manager construction and other lightweight services, with rationale and cross-reference. New invariant added at the bottom of the file.
- `specs-reference/1-foundation/configuration.md` § Provider SDK env-var caching — boto3-specific quirk, lazy provider construction in litellm, `AWS_REGION` vs `AWS_DEFAULT_REGION` precedence.

Code change is one line in `src/ac_dc/main.py` between `ConfigManager` construction and `Settings` construction. No tests added — the existing `test_apply_llm_env_exports_variables` covers the helper; an integration test against `main.run` would require extracting a `_init_lightweight_services` helper since `main.run` itself opens sockets and starts servers. Filed as a follow-up if the cold-start path regresses.

### D31 — Dialog header removed; tab strip absorbs drag-handle role; per-tab affordances replace dialog-level controls

The chat-dialog layout originally had a dedicated header bar carrying the tab buttons (Files / Context / Settings / Convert), the mode toggle, and a minimize button. The header was the dialog's drag handle — pointerdown on the header (excluding buttons) initiated drag.

Three iterations refined this:

**Iteration 1 — collapse the header into the LED row.** Move the tab buttons, Context icon, and minimize button into the LED row at the top of the chat panel. Spec dialog header would shrink to just a thin strip carrying drag-handle semantics. Rejected after build: the LED row's height grew to accommodate the controls, defeating the goal of saving vertical space, and the mix of conversation-state dots with dialog-level controls produced a visually busy strip that didn't read as one cohesive thing.

**Iteration 2 — split header concerns.** LEDs move below the textarea (compact horizontal strip, centered). Per-tab Context icon (📊) joins each tab button inline. Settings moves to the file picker's toolbar (alongside sort glyphs and git actions). Convert becomes a circular FAB at the dialog's bottom-left. Minimize starts as a top-right FAB. Tab strip becomes the drag handle via the `data-drag-handle="true"` attribute that the dialog's pointerdown handler walks `composedPath()` to find. The header is now empty and removable.

The Context-tab refresh button overlap problem surfaced during integration: the top-right minimize FAB sat directly over the Context tab's existing refresh affordance. Symmetry argued for moving minimize to the same spatial location across all four dialog tabs (chat strip's right edge + each overlay tab's toolbar right edge) rather than picking a corner that worked for some tabs but not others.

**Iteration 3 — the shipped layout.** Header gone entirely. Tab strip is the drag handle, sitting at the top of the chat panel with `data-drag-handle="true"`. Drag detection walks `composedPath()` for the attribute AND skips `tagName === 'BUTTON'` so clicks on tab buttons / overflow / minimize / Context icon don't initiate drag. Each overlay tab (Context, Settings, Convert) carries its own minimize button at the right edge of its toolbar — placement is consistent across all four tabs so muscle memory carries between them. Expand FAB at top-right shows ONLY when the dialog is minimized (the in-tab minimize buttons are hidden along with the dialog body, so the expand FAB is the only path back out).

**Why drag-handle-by-attribute beat drag-handle-by-element.** The original "header is the drag handle" model bound a listener to a specific element. The new model walks `composedPath()` looking for any element with `data-drag-handle="true"`. This decouples drag semantics from the layout — when the LED row briefly carried the drag-handle role, it was one attribute set; when the tab strip absorbed it, the same attribute moved with no listener changes. Future layouts can declare new drag handles without touching the dialog's pointerdown logic.

**LED strip placement and sizing.** Three rounds of tuning:

1. Initially below the tab strip at the top — produced visual competition between the tab strip and the LED row for "is this dialog content or dialog chrome?"
2. Moved below the input textarea, above the compaction-capacity bar. Spec language pinned in `agent-browser.md` § Layout.
3. Tightened: compact 10/12px dots, 0.3rem gaps, near-zero padding, right-padded to center the dots under the textarea (not under the full input area, which includes the send column on the right). The visual goal — match the old layout's tight bottom strip — is achieved without giving up the LED row's content. Pure CSS tuning, no spec changes.

**Convert FAB sizing.** Started at 36px circle to match the visual weight of the original header button. Reduced to 24px so the FAB sits inside the bottom thin strip rather than expanding the chat panel's vertical footprint. Same visual band as the LED dots and the compaction bar; the dialog's bottom edge feels close to the textarea like the old layout had.

**Spec authority:**

- `specs4/5-webapp/shell.md` § Layout pins: tab strip as drag handle, per-tab Context icon, minimize button right-edge convention across all four tabs, expand FAB only when minimized, Convert FAB at bottom-left, Settings via picker toolbar, drag-detection rules.
- `specs4/5-webapp/agent-browser.md` § Layout pins LED strip position and centering.
- `specs4/5-webapp/file-picker.md` § Toolbar Layout pins Settings + git actions in the picker toolbar.
- `specs4/5-webapp/chat.md` § Action Bar pins git buttons in the picker, not the chat action bar.

**What's NOT in this decision.** Pixel sizes, exact paddings, exact margins — those are presentation details the CSS owns. The decision covers the contractual shape (which controls live where, drag detection by attribute, minimize-symmetry across tabs). Future visual tuning that preserves the contract doesn't need a new decision entry.

**Tests pinning the contract:** `webapp/src/chat-panel/tabs.test.js` — `'tab strip carries data-drag-handle="true"'` test pins the drag-handle attribute. `webapp/src/app-shell/dialog.test.js` — drag tests use `composedPath()` with synthetic drag-handle elements rather than querying for `.dialog-header` (which no longer exists). `webapp/src/chat-panel/led-row.test.js` — queries `.led-strip` (renamed from `.led-row` to match the rendered class).

---

### D32 — Dual-event tab-creation idempotency: memoise `spawnAgentTabs` on `parent_request_id`

The frontend's `spawnAgentTabs` entry point is invoked twice per agentic turn by design, and the retask branch needed a way to distinguish "user retasked an existing agent in a new turn" from "this is the same turn's redundant fallback call" without that distinction collapsing into either category swallowing the other.

**The dual-event architecture.** Per the tab-creation-ordering invariant in `specs4/5-webapp/agent-browser.md` § Streaming Routing, `spawnAgentTabs` has two callers:

1. **Eager** — `onAgentsSpawned` runs synchronously when the backend's `agentsSpawned` broadcast arrives. The broadcast is emitted by `_streaming.stream_chat` IMMEDIATELY after the orchestrator's response is parsed and BEFORE any child agent stream dispatches. The frontend has to create tabs in time to claim child request IDs (`{parent_request_id}-agent-{NN:02d}`) before the first child chunk lands. Without this, fast-completing agents finish before any tab claims their child request ID and `findTabForRequest` silently drops every chunk.

2. **Fallback** — `onStreamComplete` for the orchestrator's main-tab completion runs `spawnAgentTabs` again when `result.agent_blocks` is non-empty. The fallback exists for backends that only surface agent blocks via the completion result (older releases, future minimal reimplementations) — in that single-event regime, the fallback IS the only call and runs normally.

Modern backends fire both events for every agentic turn. Without an idempotency primitive, the second call repeats work and produces visible bugs.

**The retask branch's failure mode.** D24's `_resolve_or_spawn_agent_scope` introduced backend retask routing — when the orchestrator emits an `id` that already has a live tab, the new task arrives as the next user message in that agent's existing scope (preserving the ContextManager, file context, stability tracker, and provider cache warmth). The frontend's tab-creation path mirrors this: when `existing` is found, append the new task to `existing.messages`, re-arm `existing.currentRequestId = childId`, set `existing.streaming = true`. This is correct exactly once per turn.

When `spawnAgentTabs` runs twice with the same `parent_request_id`:

- Call 1 (eager) finds no existing tab on first agentic turn → fresh-spawn branch, seeds `state.messages = [{role: 'user', content: task}]`, sets streaming flags.
- Agent's `_stream_chat` runs, chunks arrive, `streamComplete` fires, owner-tab streaming flags clear.
- Call 2 (fallback) now finds the tab `existing` → retask branch fires → appends the user task to `existing.messages` (DUPLICATE) → re-sets `existing.streaming = true`, `existing.currentRequestId = childId` (RE-ARMS A FLAG THE COMPLETE EVENT JUST CLEARED).

User-visible symptoms after this sequence:

- Agent tab shows the user prompt twice (the seeded message + the retask append).
- Streaming cursor stays visible indefinitely because no further chunks arrive on a stream that has already completed; the re-armed `streaming = true` has no event left to clear it.

In two-turn sessions the bug compounded — turn 2's pair of calls each hit the retask branch (tabs exist from turn 1), so each turn appended the user prompt twice. Hard browser reload via `get_agent_history` showed the persisted truth (one user message + one assistant response per agent), confirming the duplicates were entirely frontend.

**Three fix shapes considered.**

1. **Remove the fallback.** Rejected — the fallback exists for older / minimal backends per the spec. A reimplementer building only the `streamComplete` half of the contract would lose tab creation entirely.

2. **Make the retask branch detect "already armed for this child request."** Possible — check `existing.currentRequestId === childId && existing.streaming`. Rejected because the timing depends on whether `streamComplete` has already fired before the fallback call. In practice it has (main's stream completes before the orchestrator's `streamComplete` event handler runs synchronously to fire the fallback), so the check would pass and the fallback would no-op — but the timing could shift with future async refactors. Detection-by-state is fragile in a way detection-by-identity isn't.

3. **Memoise on `parent_request_id`.** Chosen. Each call to `spawnAgentTabs` records its `parent_request_id` in a Set on the panel; subsequent calls with the same id are no-ops. Turn boundaries are distinguished by parent request id (turn 1's parent ≠ turn 2's parent), so retask in turn N still appends correctly while the duplicate fallback inside turn N no-ops. Detection-by-identity, not by state.

**Why `parent_request_id` is the right primitive.**

- Already on every `agentsSpawned` payload (the broadcast carries it explicitly).
- Already on every main-stream `streamComplete` event (it IS the event's `requestId`).
- Already epoch-prefixed (`{epoch_ms}-{6-char-alnum}` per `helpers.generateRequestId`), so cross-session collisions are not realistic — a session restart starts at a new epoch, an agentic turn within a session always has a unique parent.
- No coordination needed between the two callers — both already pass the same value.

**Implementation.** One Set on the panel (`_spawnedParentRequestIds`), lazy-initialised inside `spawnAgentTabs` to keep the change co-located with its consumer. Two if-blocks at function entry — early-return when the parent id is already in the set, add it when not. The fix is two of stuff (one Set, two if-blocks) plus an explanatory comment.

**Spec authority.** `specs4/5-webapp/agent-browser.md` § Tab Creation Ordering gained a new "Idempotency under the dual-event design" paragraph documenting the dual-call architecture and the memoise-on-parent-request-id contract. The paragraph is brief because the rationale lives here in the decisions log; the spec section pins the contract.

**Tests pinning the contract.** Pre-existing tests in `webapp/src/chat-panel/streaming.test.js` and `webapp/src/chat-panel/tabs.test.js` already exercise both call paths (eager via `onAgentsSpawned`, fallback via `onStreamComplete.agent_blocks`). With the memo in place, these tests assert the correct one-shot behaviour. A future regression that broke memoisation would surface as a duplicated message append in the multi-turn agent test cases.

**Lesson for reimplementers.** Two events firing for the same logical operation is a deliberate design choice, not redundancy to clean up. The eager event closes a race window; the fallback event preserves backwards compatibility. Any consumer of `agentsSpawned` + `streamComplete.agent_blocks` MUST expect both events for the same turn under modern backends and MUST be idempotent with respect to repeated calls carrying the same parent request id. Memoising on the parent id is the cheapest correct primitive — comparing arrays of agent blocks would also work but costs more code and offers no advantage.

---

### D34 — Cache warmer isolated to dedicated executor; interval shortened; circuit breaker added

Field observation in 15-file doc-mode sessions: the cache warmer was firing +54 to +170 seconds past its scheduled 270s interval, producing 0% cache hit rate on every warm-up. The cached prefix had already expired by the time the LiteLLM call landed, so each "warm-up" was actually a full cache write at 1.25× input pricing — pure cost, no payoff.

Diagnostic logs showed symmetric ~2-minute gaps between four points in the warmer's lifecycle: (1) `cacheWarmerFiring` event broadcast, (2) `litellm.completion` start, (3) `litellm.completion` return, (4) next-cycle scheduling. The symmetry ruled out provider-side latency (the call itself completed quickly when it eventually ran) and pointed at executor saturation: the warmer's `loop.run_in_executor(_aux_executor, _completion_sync, ...)` was queueing behind something else.

Root cause: KeyBERT keyword enrichment runs in `_aux_executor` (2 workers) per `_doc_index_background.run_enrichment_background`. A 15-file doc-mode session enriches 15 sections sequentially, each taking ~10–60 seconds depending on section size. With both workers occupied by enrichment and the warmer's submission joining the queue, the warmer's actual provider call landed only after both workers finished their current enrichment tasks — a delay of ~2 minutes that shifted every subsequent firing later by the same amount, accumulating into the observed +170s drift.

**Three coordinated fixes shipped in one decision.**

1. **Dedicated single-worker executor for the warmer.** New `_warmer_executor: ThreadPoolExecutor(max_workers=1, thread_name_prefix="ac-dc-warmer")` on `LLMService`. `CacheWarmer._fire_warmup` switches from `_aux_executor` to this pool. Single worker is correct: only one warm-up is ever in flight at a time (the cancel-on-stream-start path guarantees serialisation), so a single worker matches the actual concurrency. Isolating to a dedicated pool removes the queueing path entirely — KeyBERT enrichment, URL fetches, commit-message generation, and topic detection continue to share `_aux_executor` as before.

2. **Interval shortened from 270s to 240s; clamp tightened from `TTL - 30` to `TTL - 60`.** The 30s margin (covering only `_COUNTDOWN_SECONDS = 30s`) left no budget for system-level drift. Field observation showed +50 to +170s of drift in cycles where the 30s margin produced 100% miss rate. Raising the margin to 60s absorbs the observed drift range without consecutive warm-ups overlapping. The interval default also drops correspondingly: 240s = 4:00 with a 60s margin to the 5-minute TTL.

3. **Circuit breaker after 3 consecutive drift-past-TTL cycles.** Even with the dedicated executor, system-level drift (laptop sleep, container freezer, NTP step) can push individual firings past the TTL. A single drift can be a transient pause and shouldn't disable the warmer. Three in a row is the clear "this execution environment is broken" signal — the warmer auto-disables via `disable("circuit breaker — drift exceeded TTL N times")` and broadcasts `cacheWarmupComplete` with `success=false`. Reset to zero on any in-TTL cycle so a recovered session doesn't accumulate strikes from earlier transient pauses. Operators see the strike count in per-cycle WARNING logs (`strikes=N/3`) before the breaker trips.

**Queue-duration instrumentation.** `_completion_sync` accepts a `queue_submitted: float | None` parameter (the `time.monotonic()` timestamp from the moment `loop.run_in_executor` was called) and logs `queue_duration = entry - queue_submitted` on entry. With the dedicated single-worker pool this should always be ~0; a non-trivial reading is the load-bearing diagnostic signal that something has accidentally been routed onto the warmer pool, or the previous firing is somehow still in flight. Logged at INFO when ≤1.0s, WARNING with explanatory tail when >1.0s.

**What this does NOT do.** KeyBERT enrichment is still in `_aux_executor` (2 workers). A future change may move it to a `ProcessPoolExecutor` for true GIL-free parallelism, but that's a separate decision — the warmer-isolation fix removes the immediate user-visible problem (cache misses) without touching enrichment's concurrency model. Enrichment's 10-60s per file is acceptable while it's not blocking cache warming.

**Backwards compatibility.** Tests that don't invoke `LLMService.shutdown` continue to pass — the executor closure is best-effort (`wait=False`) and Python's process exit cleans up unreferenced thread pools. The `_rpc_lifecycle.shutdown` cleanup uses `getattr` to tolerate older test fixtures without `_warmer_executor`. Configurations with `interval_seconds: 600` (or any value above `TTL - 60`) get clamped to 240s with a WARNING log explaining the change; the warning recommends updating `app.json` to silence it.

**Spec authority.** `specs4/3-llm/cache-tiering.md` § Cache Warmer (Lifecycle and Configuration subsections); `specs-reference/3-llm/cache-tiering.md` § Cache warmer (constants table; default config values).

---

### D34a — Cache warmer deadline anchoring uses wall-clock time, not monotonic

D34's executor-isolation fix removed the queueing path that was producing 2-minute broadcast stalls. Field testing afterwards still showed +44s and +84s firing drifts on a 240-second interval with 5-second polling cadence. Diagnostic instrumentation around the broadcast calls confirmed broadcasts were sub-millisecond — the drift was inside the silent-phase polling loop itself, not in any code path that could be GIL-contended or executor-saturated.

Root cause: the polling loop used `time.monotonic()` deadlines. On the operator's macOS laptop, `time.monotonic()` was pausing during system-level process suspension (App Nap or similar), then resuming with the monotonic clock having advanced by less than the wall-clock duration of the suspension. The polling loop's wake-up logic — "if `silent_deadline - time.monotonic() <= 0`, exit" — kept seeing the deadline as still in the future, sleeping another 5-second polling chunk, repeating. By the time the firing landed, the actual elapsed wall-clock time was 280-320 seconds, well past the 300-second cache TTL.

The fix swaps both the silent-phase and visible-phase deadlines to `time.time()` (wall-clock epoch). After resume, the next polling wake sees the deadline as already passed and exits the loop immediately — firing happens within `_DRIFT_POLL_SECONDS` of resume rather than `suspension_duration + _DRIFT_POLL_SECONDS` later. NTP step magnitudes are bounded well below the 60-second TTL margin at the 240-second-interval scale, so the wall-clock anchor's theoretical sensitivity to clock adjustments is not observable in practice.

The TTL-exceeded path also changed shape. Pre-fix, drifts past the TTL still fired the warmup ("writing a fresh cache primes the next 5-minute window"). Post-fix, TTL-exceeded firings are skipped — writing a fresh cache here at provider cost is the same outcome as letting the next user turn do it, at the same provider cost, with no benefit. The skip path still increments the circuit-breaker strike counter so repeated long suspensions trip the breaker.

Two-cycle field test post-fix:

```
13:33:31 firing: planned=240.0s, actual=240.0s, drift=+0.0s — cache_read=111161, 100% hit
13:37:34 firing: planned=240.0s, actual=240.0s, drift=+0.0s — cache_read=111161, 100% hit
```

Diagnostic instrumentation removed after confirmation. The `Cache warmer firing: planned=Xs, actual=Ys, drift=±Zs` log line stays as the load-bearing signal — a future regression in deadline anchoring will surface as drift-line WARNINGs.

**Spec authority.** `specs-reference/3-llm/cache-tiering.md` § Cache warmer — "Wall-clock deadline anchoring" paragraph appended to the "Executor isolation" discussion.

---

### D33 — Stream resumption on reconnect via `active_streams` snapshot

User-observed bug: refreshing the browser mid-stream produced an opaque "Another stream is active (request {id})" rejection on the next send attempt. The single-stream guard correctly identified that the prior stream was still running server-side (worker thread independent of WebSocket lifecycle, by design — D10's guard scoping covers this), but the originating client had no way to discover the in-flight stream's identity, observe its accumulated content, or recover gracefully. The user's only options were waiting for an unknown duration or starting a new session and losing the in-flight response.

Three fix shapes considered:

1. **Auto-cancel on `remote_disconnected` of the originating client.** Rejected — required tracking caller↔request mapping at the WebSocket layer, breaks the deliberate "stream survives transport drop" property that lets long LLM calls weather flaky networks, and would also kill collaborator-passive-adoption (D10 invariant).

2. **Frontend parses the rejection and offers cancel-and-retry.** Rejected as primary — surfaces an opaque error first, then asks the user to recover. Doesn't preserve the in-flight response. Kept as a fallback for the narrow race window where the user sends faster than `state-loaded` resolves.

3. **Surface in-flight streams via `get_current_state`; frontend re-attaches as a passive observer.** Chosen. Reuses the existing chunk-broadcast path (chunks already broadcast to all connected clients; refreshed browser receives subsequent chunks without backend changes) and the existing chunk-routing layer (`findTabForRequest` keys on `currentRequestId`). The only new infrastructure is the snapshot field itself plus the resume handler.

**Implementation cost.** Two new backend fields (a reverse map `_active_request_to_agent` and the already-populated `_request_accumulators` were both wired up but only the map needed adding), a new `active_streams` field on `get_current_state`'s response, a new `resumeActiveStreams` function in the chat panel's events module, and an extended message in `handleStreamStartError` for the narrow race window where a user sends before `state-loaded` resolves. No changes to the streaming pipeline, the chunk-broadcast path, or the single-stream guard logic.

**The reverse map is load-bearing.** The pre-existing single-stream guards (`_active_user_request: str | None` and `_active_agent_streams: set[str]`) carry "is something running?" but not "what's the request ID?". Without the reverse map, the snapshot couldn't enumerate in-flight streams without scanning every connected client's state — and even then, child agent streams' request IDs (`{parent}-agent-NN`) aren't reconstructable without remembering the original parent ID. The map captures `request_id → agent_id|None` at registration time, cleared at completion. Authoritative; tiny; one-to-one with the existing guard fields.

**The accumulator was already populated for unrelated reasons.** `_request_accumulators` exists so the post-response HUD and the deferred enrichment pipeline can read accumulated content without re-parsing chunks. Surfacing it here is essentially free — no new write path, just a new reader.

**`agent_id: null` for main scope, agent's id otherwise.** Mirrors the per-tab routing the frontend already uses: `parseAgentTabId` returns `null` for `"main"` and the id verbatim otherwise. The state-loaded handler dispatches on the same null check (`null → main tab, otherwise agent tab`), so the resume path doesn't need new tab-resolution logic.

**Race window.** A user who sends a new message before `state-loaded` resolves still hits the single-stream-guard rejection. The frontend augments that error path with a clearer message — "A previous request is still running on the server. Wait for it to complete (the tab will resume streaming when the next chunk arrives), or use 'New Session' to abandon it." Plus a toast with the same guidance. Narrow window (typically <100ms after page load); the augmented message means even users who hit it understand what's happening and have a clear next action.

**Why the `agent_blocks`-style retry mechanism (D32) doesn't apply.** D32 memoises on `parent_request_id` to prevent the dual-event spawn path from creating duplicate tabs. That's a different problem — there, two events fire for one logical operation; here, one event fires once per page load and races against user typing. No memoisation needed; the user's only "retry" is sending another message, which goes through the normal guard path.

**Tests pinning the contract.** `tests/test_llm_service/test_state_snapshot.py::test_snapshot_shape` updated to include `active_streams` in the expected key set. The accumulator behaviour is already covered by `test_request_accumulator.py`. The end-to-end resume path (refresh → state-loaded → re-attach → chunks arrive → completion) is integration-level and not covered by unit tests; manual verification covered the happy path during landing.

**Spec authority:** `specs4/3-llm/streaming.md` § Stream Resumption After Reconnect describes the behavioural contract; `specs-reference/3-llm/streaming.md` § Stream resumption snapshot pins the per-entry field shape; `specs-reference/1-foundation/rpc-inventory.md` § Service: LLMService updates `CurrentState` with the new field.

**Lesson for reimplementers.** When the transport layer is decoupled from a long-running operation's lifecycle (here: WebSocket vs LLM call), the recovery path needs an explicit way for clients to discover and re-attach to operations they originally started. The opposite design — tying operation lifecycle to transport lifecycle — produces the wrong tradeoff for chat: a flaky network would kill the LLM call, wasting tokens and forcing retries. The `active_streams` snapshot is the minimum viable recovery primitive; everything else (the resume handler, the augmented error message) is UX polish around the snapshot's existence.

---

### D30 — `agent_blocks` persisted on orchestrator records to enable cross-turn reconstruction

Per `specs4/3-llm/history.md` § "Cross-Turn Agent Reconstruction" (committed `bd79d93`), every assistant record produced by a turn that spawned agents persists an ordered list of `{id, agent_idx}` entries — one per spawn block emitted in that turn. The disk layout for agent archives is keyed by a turn-local numeric `agent_idx` (`agent-NN.jsonl`) while the orchestrator addresses agents by an LLM-chosen string `id`. The two namespaces are deliberately separate, and `agent_idx` is NOT stable across turns — a re-use of `agent-backend` in turn 1 (idx 0) and turn 3 (idx 1, because `agent-frontend` was spawned first) writes to two different filenames within their respective turn directories. Without persisting the per-turn id↔idx mapping, a "show me everything `agent-backend` did across the session" view has no way to find the right archive files except by guessing or by reading every archive's first message — both fragile.

Implementation is small and fully forward-compatible:

- `HistoryStore.append_message` accepts an optional `agent_blocks: list[dict[str, Any]] | None` parameter. The persisted shape is filtered to `[{id, agent_idx}, ...]` only — the in-flight completion result's `task` field is dropped from the on-disk record (recoverable from the agent's own archive file as its first user message). Defensive per-entry filtering rejects malformed entries silently rather than failing the append. Empty list and None both omit the field, matching the existing convention for other optional list fields (`files`, `edit_results`).
- `_stream_chat` parses the orchestrator's response a second time at persistence-write time to compute the `[{id, agent_idx}]` summary, then threads it through `archival_append`. The parse is duplicated with `build_completion_result` (which builds the same summary for the streamComplete event); the parser is pure and cheap, and the duplication keeps both call sites self-contained without having to reshape function signatures.
- Tests at two layers: `TestAgentBlocksField` in `test_history_store.py` pins the unit contract on `append_message` (round-trip, omission rules, defensive filtering); `TestAgentBlocksPersistence` in `test_agent_spawn.py` pins the end-to-end integration (real `_stream_chat`, real persistence, real `HistoryStore`).

What this decision does NOT deliver:

- No RPC to consume the persisted field. The reconstruction algorithm in the spec section is implementable today against the on-disk records, but no backend method or frontend affordance reads `agent_blocks` yet. The field is pure forward-compatibility infrastructure.
- No frontend across-turns view. That's deferred to the agent-mode UI plan below.

The decisive argument for shipping this immediately rather than waiting for the consuming UI: every agent-mode turn that runs without persisting `agent_blocks` becomes a permanent gap in the historical record — the per-turn view via `get_turn_archive` still works, but cross-turn filtering by id is impossible for those turns. The cost of landing now (small, pure addition, fully tested) is much lower than the cost of going back later to manually reconstruct the mapping for turns that ran during the gap.

Spec authority: `specs4/3-llm/history.md` § Cross-Turn Agent Reconstruction (committed `bd79d93`). Ledger reference: `specs4/3-llm/history.md` § Backwards Compatibility — records without `agent_blocks` (predating this decision) load correctly; cross-turn views skip them rather than guess.

---

### D35 — Cache tiering replaced by membrane / flux controller; rectified-GHK is the only variant

> **Note (D36):** D35's geometry assumes the D27/D28 "L0 content-typed, L1→L0 disabled" contract. Under D36, L1→L0 is enabled and the four-membrane stack is uniform; the equation, parameters, and admission_only Active→L3 rule below carry forward unchanged.

The previous cascade contract for `specs4/3-llm/cache-tiering.md` was an N-counter design: each tier held an integer counter that incremented per stable appearance, decremented on edit, and triggered promotion to the next tier when it crossed a per-tier `promote_n` threshold. Anchoring at the L1/L2 boundary, post-cascade underfill demotion, and the "broken or empty upper tier" gating layered on top to keep buildup contained. The N-counter design solved cohesion (no jittery promotions) but exposed two orthogonal problems: the buildup pathology described in the now-retired `specs4/7-future/cache-tiering-piggyback-promotion.md`, and the lack of a tunable knob trading aggregate throughput against worst-class fairness. Both eventually pointed at the same root cause: the cascade had no global signal coupling the tiers, so each tier-pair was promoting independently and there was nothing to negotiate against when one tier filled up.

The replacement is the cache-tiering specialisation of Flax 2026, *A Biophysically-Inspired Feedback Controller for Multi-Class Cache Fairness*, derived in `~/flatmax/personal.work/research/cache.tiering/paper/draft/03_policy.md`. The controller treats each tier boundary as a thin membrane and the integer counter `n` (now a pure age field) as the per-file imbalance state on that membrane. A single global signal `V = Σ_k (T_{l,k} − T_{u,k})` — the token-mass difference between lower and upper sides of every membrane — drives K parallel rectified per-membrane flux accumulators. When an accumulator integrates past unit charge, one promotion fires on that membrane. Eviction is delegated entirely to an age-ordered backstop (the existing `n`-ordered tier draining behaviour), which is exactly the C2 rectification clamp from the paper.

**Only the rectified-GHK variant is supported.**

The flux equation is

> `Φ = max(0, P · V · (c_l − c_u · exp(−V/V_T)) / (1 − exp(−V/V_T)))`

with a Taylor-branch numerical guard at `|V/V_T| < 1e-9` and overflow-safe asymptotic branches at `|V/V_T| > 50`. The hard rectification clamp on the lower side makes flux upward-only — downward motion is reserved for the edit invariant (hash mismatch teleports to Active) and explicit invalidations.

Earlier revisions of this decision exposed three variants — `linear` (Taylor branch as a separate code path), `rectified-ghk`, and `bidirectional-ghk` (no clamp, controller-driven demotion). All three were retired: rectification is **free** on AC-DC4's single-tenant headline (paper §6.3 — the demotion path is empirically dead code), and the linear form is the V → 0 Taylor branch of GHK, redundant once the GHK form is the production default. Carrying the alternates as live code paths added dispatch surface, test surface, and config surface for no production-headline benefit.

AC-DC4 is single-tenant single-class — the K=4 multi-class structure of the paper does not apply; we keep the three-membrane geometry (Active→L3, L3→L2, L2→L1; L1→L0 absent per D27) and treat each membrane as its own one-class controller, with V summed across all membranes per constraint C1.

**Default parameters** are sourced from the synth-tuner's headline rectified-GHK fit (`runs/opt-run2/best_params.json` in `~/flatmax/personal.work/research/cache.tiering`):

- `P = 1.616399379428934e-06`
- `V_T = 98952.34312610888`
- Active→L3: `admission_only=True`, `n_admit=3`, `pick_mode="oldest"` (no flux equation; P/V_T unused)
- L3→L2, L2→L1: flux-driven, `n_admit=0`

The original tune ran bidirectional (`allow_negative_flux=True`); for the rectified clamp the same P/V_T are a sound starting point, with re-tuning available later for the last few percent.

**What changes structurally vs the N-counter spec.**

- `n` is now a pure age counter (turns since last seen at `n=0`), not "consecutive unchanged appearances." The Active→L3 membrane is **admission_only** (`n_admit=3`, `pick_mode="oldest"`) — no flux equation, just an age gate. Higher membranes use the flux controller alone. The `cache-warmup` semantics survive unchanged.

  **Why Active→L3 falls back to admission semantics.** The flux model treats V (token-mass differential) as the driving force, which is right for inter-cache balancing but degenerate at the admission boundary: in AC-DC4, active is structurally lighter than the cached tiers — items live there only until they age past the gate, after which they leave for L3+ — so `t_active < t_L3` is the steady state and rectified Φ is permanently zero. An earlier revision of this decision used flux uniformly (`n_admit=2` as a soft prefer-aged rule with retry-without-floor). It produced a hard regression: active items never graduated, the cache stalled with a permanently-occupied active tier, and the L3 cache hit rate fell off the cliff once the synthetic startup churn ended. The fix is to recognise that admission is fundamentally a gating problem (has this file proven stable enough to commit to cache?) not a balancing problem (which tier is overfull?), and treat it as such — `n ≥ n_admit` is the entire criterion on this membrane.

  `history:*` items are also marked protected against the regular relax flux — they only enter L3 via the piggyback path (which fires when L3 is already broken). Without this guard the admission_only membrane would graduate stable history every few turns and rewrite the L3 cache block on every conversation, defeating the no-churn property the piggyback design was supposed to provide.
- The `_run_cascade` driver is replaced by an iterate-to-equilibrium relaxation loop: per turn, recompute V, recompute every membrane's `Φ`, drain any membrane whose accumulator has crossed unit charge, repeat until no membrane fires (capped at 1000 iterations as a safety bound, never expected to bind in practice).
- Anchoring (the L1/L2 stickiness rule) and post-cascade underfill demotion are both **deleted**. The flux controller subsumes anchoring (a stable tier accumulates flux only on imbalance, not on routine refresh) and underfill (the rectification clamp + age backstop together produce the same shape without an explicit demotion pass).
- `max_membrane` gating from the N-counter cascade is **deleted**. An earlier revision of this decision preserved it verbatim ("flux fires only on membranes whose upper side is already invalidated this turn") on the theory that scope-limiting cache-write cost was load-bearing. In practice the gate prevented quiet turns from firing flux at all — even when V was large and Φ well above threshold, an empty `_broken_tiers` set short-circuited `relax()` and active-tier residents stayed pinned forever. The rectified controller already has two gating mechanisms intrinsic to the equation: the rectification clamp (Φ ≥ 0 — direction is fixed) and the deadband threshold (Φ < 1.0 — quiet turns self-arrest). With both in place the `max_membrane` gate is not just redundant, it inverts the controller's intended behaviour by withholding promotion pressure until an external invalidation arrives. The broken-tier set survives as a HUD diagnostic and as the gate for history-piggyback graduation — it just no longer feeds the flux loop.
- L0 stays content-typed (D27 unchanged); the L1→L0 membrane is structurally absent from `LIVE_MEMBRANES`. L0 admissions still go through `backfill_l0_after_measurement`, untouched.
- Edit invariant strengthens: hash mismatch teleports the file to Active with `n=0` (full reset), not just demotes it. The pin-protection invariant from the previous spec carries forward unchanged.

**Why a single variant rather than config-selectable.**

An earlier revision of this decision exposed all three (linear / rectified-GHK / bidirectional-GHK) behind a config switch on the theory that AC-DC4's metric of interest might shift later. In practice the three variants share most of their machinery, the bidirectional path is empirically dead at our operating point (paper §6.3), and the linear form is the V → 0 Taylor branch of GHK — redundant once the GHK form is the production default. Carrying the alternates added dispatch surface in `compute_flux`, two more dataclass branches in `FluxConfig`, and pages of tests pinning behaviours that are decorative on the headline. The simpler module is easier to reason about and easier to retune; if a future workload shift demands the alternates back, they live in git history and in the synth reference implementation alongside the optimisation runs.

**What this decision does NOT change.**

- The cache-warmer (D34, D34a) is independent of the cascade and is not touched.
- L0 content-typed contract (D27, D28) is preserved.
- Cross-reference activation, deletion markers, manual rebuild, history piggyback graduation, and the integration with `StabilityTracker.update()`'s call sites all preserve their contract; only the internals of `_run_cascade` change shape.
- Test contracts at the public-API layer (`pin_file`, `unpin_file`, `mark_deleted`, `is_deleted`, the lifecycle through `update()`) hold; lower-level tests that read `_TIER_CONFIG.promote_n` directly need to be rewritten to assert flux-controller invariants instead.

**Superseded artefacts.** `specs4/7-future/cache-tiering-piggyback-promotion.md` is retired — its buildup pathology is structurally resolved by V coupling (the global signal pulls promotion pressure where it's needed without needing the upper tier to have been "broken" first). The retired spec is left in place with a banner pointing here and to the new `cache-tiering.md`; no content removed, since the analysis of the buildup pathology is still useful as motivation reading.

**Spec authority:** `specs4/3-llm/cache-tiering.md` (rewritten); `specs4/7-future/cache-tiering-piggyback-promotion.md` (banner only — superseded). Implementation authority: `src/ac_dc/cache_membrane.py` (new module) + `src/ac_dc/stability_tracker.py` (cascade replaced). Reference implementation: `~/flatmax/personal.work/research/cache.tiering/synth/model.py` and `~/flatmax/personal.work/research/cache.tiering/cache_membrane/state.py`. Paper sections: §3.1 constraints C1/C2/C3; §3.2 linear; §3.3 GHK; §4 implementation contract; §6.3 rectification ablation; §6.4 GHK-vs-linear ablation.

### D36 — Per-directory dir-blocks supersede L0 aggregate maps; L0 joins the flux path

D27 split the tier model into a content-typed L0 (system prompt + aggregate symbol map + aggregate doc map, never moved by the cascade) and stability-typed L1/L2/L3/Active for full files. D28 added the frozen-snapshot machinery so per-turn live-index updates stop invalidating L0. The pair was correct for the N-counter cascade — items moved by counter, not by global signal, so a monolithic always-resident block at the head of the prompt was the right shape. Under the membrane / flux controller (D35) the same shape is starvation: the aggregate maps are the largest single bytes in the prompt and they never move, so flux has nothing useful to balance until full files start arriving in Active. The controller's coupling signal V is computed against tiers that are mostly empty most of the time.

**Resolution.** Replace the two aggregate maps with **per-directory blocks** (dir-blocks), one block per `(directory, content_type)` where `content_type ∈ {symbols, docs, plain_files}`. Every file in the repo lives in exactly one dir-block somewhere in the cache: source files contribute their symbol-table entry to the directory's `symbols` block, documents contribute their outline entry to the directory's `docs` block, and everything else (configs, data files, assets, fixtures — files with neither a symbol table nor a doc index) contribute their filename to the directory's `plain_files` block. There is no longer a separate `meta:file_tree` synthetic entry; the union of `plain_files` blocks across the repo *is* the file tree.

Dir-blocks are first-class membrane participants. They live in any tier including L0. Flux moves them as the controller sees fit. The system prompt remains the only fixed (non-flux) prefix anchor — everything below it, including the two aggregate maps that D27 placed in L0, now rides the membrane.

**Always-resident invariant.** Every indexed file is represented in the prompt at every turn:

- as a symbol-table entry inside its directory's `symbols` dir-block (somewhere in L0–L3), or
- as a doc-outline entry inside its directory's `docs` dir-block (somewhere in L0–L3), or
- as a filename entry inside its directory's `plain_files` dir-block (somewhere in L0–L3), or
- as full text in Active (only when the user has selected it for editing).

Tier placement affects prefix-cache hit rate, not coverage. xref always resolves; it just resolves against blocks that may sit in different tiers. Cross-directory xref references are unaffected — the rendered prompt contains every directory's block, and resolution walks across blocks regardless of tier.

**Edit ⇒ block rebuild.** Editing a file requires its full text in Active by precondition (you cannot edit what you cannot see). When a file moves into Active for editing:

1. Its entry is removed from its directory's `symbols` (or `docs`, or `plain_files`) dir-block — the block shrinks by one entry.
2. The shrunk dir-block is teleported to Active and re-emitted, mirroring the file-edit demotion path. The dir-block re-rides flux upward as it stabilises.
3. The file itself sits in Active as full text until edits are done.

When the file leaves Active (deselected, edits applied and stable), it rejoins its dir-block on the next freeze — the block grows by one entry and is again teleported. The "size change ⇒ demote" rule is a special case of "content change ⇒ demote": rebuild is unconditional whenever a block's contents change.

If every file in a directory is currently in Active as full text, that directory's dir-block has zero entries and is **removed entirely from the cache**, not retained as an empty block.

**Block-size variance.** Directories with hundreds of files produce large blocks; single-file directories produce tiny ones. Under the membrane controller this is fine — V is a token-mass signal, so large blocks naturally exert more promotion pressure than small ones. No max-block chunking is imposed at the spec level; if a workload demands it later, the chunking layer is a per-directory concern (split a directory's `symbols` block into N sub-blocks keyed by a stable partition function), additive to the design here.

**Deletion semantics simplified.** D27's deletion-marker scheme is **deleted entirely**. When a file is removed from disk:

- Source file: its entry is removed from the directory's `symbols` block; the block shrinks and is teleported.
- Doc file: same, against the `docs` block.
- Plain file: same, against the `plain_files` block.
- File currently in Active as full text: its `file:<path>` entry is removed from Active outright.

The "L0 references a deleted file" problem D27's marker bridged is no longer reachable — there is no monolithic L0 aggregate to be stale against. The dir-block carries the live truth of the directory at all times.

**Pin flag retained but narrowed.** Files edited but not yet stable are still pinned in Active so deselection cannot silently evict them. Pinning applies only to `file:<path>` entries in Active. Dir-blocks carry no pin flag — they are reconstructed from disk on every freeze and inherit consistency from the index.

**History piggybacks dir-block flux.** D27's history-graduation rule was "piggyback on L3 invalidation" — when L3 was already broken by a file mutation, eligible history graduated for free. That rule survives, generalised: when any Active→L3 flux fires (file moving up, dir-block moving up after rebuild), eligible history graduates in the same turn. Stable conversations still don't churn the L3 cache block, because steady-state turns produce no Active→L3 flux at all.

**L0 anchoring changes meaningfully.** Under D27/D28, L0 = system prompt + two aggregate maps, refrozen only at enumerated events. Under D36, L0 holds the system prompt and whichever dir-blocks happen to have flowed there via flux. The L0-snapshot freeze mechanism (D28) is **deleted** — there is no longer a static byte sequence to freeze, and the membrane controller now spans L0 just like every other tier. The list of "what invalidates L0" from D27 collapses to: whatever the controller decides to move into or out of L0 this turn. The system prompt is the only non-flux head — it sits in front of L0's flux-managed contents and never moves.

This means L0 *can* be invalidated by routine activity in a way it could not before. The compensation is that L0 also fills automatically with the hottest blocks per the controller's V signal — flux drives the most-stable-and-largest dir-blocks toward L0 organically, where D27 always sat the aggregate maps in L0 by construction. Net cache-write cost depends on workload; the scheme is uniform in tier mechanics rather than special-casing L0 against the rest.

**Initialization seeds by mtime.** On startup, after the symbol/doc indexes are built, dir-blocks are constructed from the current index state and seeded into tiers using a per-directory mtime prior:

- Most recently modified directory tree → seeded into L1 (likely to be touched soon, prime warm).
- Older directories → seeded into L2 / L3 by mtime quantile.
- All-time-cold directories → seeded into L3 (controller may push them up later).

The mtime prior is heuristic, not load-bearing. Flux re-sorts within a few turns. The alternative (cold-start everything in L3) was considered and rejected as wasting a session of warm-up; the mtime prior is ~5 lines of seed code and gives the first session a usable warm cache.

**Agent inheritance.** When an agent is spawned, the agent's tracker copies the parent's current tier distribution at spawn time (a snapshot of which dir-blocks sit where). Agent flux thereafter is independent — the agent can rebalance toward its own working set without affecting the parent. Agents do not inherit pinned files (those are scope-bound to the parent's edit invariant).

**Cross-reference scope.** Cross-reference activation no longer adds the *opposite-mode aggregate map* to L0; it adds the opposite-mode dir-blocks (symbol blocks in doc mode, doc blocks in code mode) to the membrane. They participate in flux uniformly with the primary blocks. The `backfill_l0_after_measurement` mechanism is **deleted** — its sole remaining caller (cross-reference activation) is replaced by a normal block-registration pass. The deactivation path likewise just removes the secondary dir-blocks from the membrane.

**`meta:file_tree` removed.** The synthetic `meta:file_tree` entry is no longer produced. Its contents (the flat list of files-without-symbol-or-doc) were already the union of every directory's plain-file listing; under D36 that listing exists as a real cache citizen (the `plain_files` dir-blocks) instead of as a synthesised tail-of-prompt block. Prompt assembly stops emitting `meta:file_tree`; consumers that read it from `_breakdown.py` are updated to read the dir-block set instead.

**Why this design is a good fit for the membrane controller.**

D27/D28 were a correct response to the N-counter cascade: the cascade had no global signal, so freezing L0 against the cascade's per-tier-pair decisions was the only way to keep cache-writes contained. The membrane controller has a global signal (V) and a self-arresting deadband (Φ < threshold), so it can manage the full prefix below the system prompt without runaway churn. Giving it dir-blocks rather than two monolithic blocks gives it enough granularity that V is computed over a meaningful population of mobile items per turn, and rectification pins the direction so we still don't see thrash.

**What this decision does NOT change.**

- The system prompt is still hashed and rendered as the prefix head; nothing about the system prompt's role changes.
- The cache warmer (D34, D34a) is independent of the membrane geometry and is not touched.
- The Active tier semantics (full-file selection, edit invariant, pin flag for in-flight edits) are unchanged.
- D35's flux equation, parameters, admission_only Active→L3 membrane, and history-protection rule all carry forward unchanged. The per-membrane geometry is unchanged: Active→L3 (admission_only), L3→L2, L2→L1, plus L1→L0 now **enabled** as a flux membrane (was disabled under D27).
- Mode switching (code ↔ doc) still swaps the primary index; under D36 the swap rebuilds the dir-blocks from the new primary index rather than swapping the L0 aggregate map.
- Manual `rebuild_cache` is preserved as the explicit reset point — wipes tier assignments, re-seeds dir-blocks via the mtime prior, clears pin flags.

**Superseded artefacts.**

- D27 — superseded in part. The "L0 is content-typed; cascade no longer touches it" rule is replaced by "the system prompt is the only non-flux anchor; everything below rides the membrane." The deletion-marker mechanism it introduced is deleted (see above). The pin flag for edited files survives.
- D28 — superseded in full. There is no L0 snapshot to freeze. Live indexes feed dir-block reconstruction directly at freeze events (turn boundary, edit landing, file deletion, mode switch).
- The `meta:file_tree` rendering path in `_breakdown.py` (lines around 366–367 and 913 per current grep) is removed.

**Spec authority:** `specs4/3-llm/cache-tiering.md` (rewritten under this decision); `specs4/3-llm/prompt-assembly.md` and `specs-reference/3-llm/prompt-assembly.md` (`meta:file_tree` row removed). Implementation: `src/ac_dc/stability_tracker.py` (dir-block registration replaces aggregate-map population; deletion-marker code path removed; L1→L0 membrane enabled), `src/ac_dc/llm/_breakdown.py` (dir-block rendering replaces aggregate-map and `meta:file_tree` rendering), `src/ac_dc/llm/_assembly.py` (L0 freeze removed), `src/ac_dc/cache_membrane.py` (no change — geometry just gains an enabled L1→L0 membrane via config).

**Open implementation questions (deferred to the work commit).**

- Exact within-tier block ordering. Likely: alphabetical by directory path within each `content_type` group, with `content_type` groups in a fixed order (symbols, docs, plain_files). Stable ordering matters for the prefix cache.
- Block size at the boundary between a directory's three `content_type` blocks — whether a `symbols` block and `docs` block from the same directory render adjacently or grouped by type repo-wide. Default proposal: grouped by type repo-wide, since type-grouped chunks are more cache-stable across selection toggles than directory-grouped ones.
- Whether the mtime prior reads from the filesystem directly or from the index's last-touch timestamp. The index version is preferred (avoids a second stat pass) but requires the index to track mtime per directory rather than just per file.

These are settled at implementation time, not in this decision entry.

### D37 — History isolated from flux dynamics; legacy promote_n thresholds retired

D27's "history piggybacks on L3 invalidation" rule and D36's generalisation of that rule (Active→L3 firings of any kind drag eligible history along) determine *when* history graduates into L3. Neither addressed what happens *after* history is in L3. Under the membrane / flux controller (D35) history sits in L3 like any other item: it contributes to V (token mass) and c (object count) on every membrane, and the rectified GHK equation can in principle pick a history mover to promote upward through L2/L1/L0. In practice this never fires because the user's `is_protected` predicate already returns True for `history:*` keys, but the spec contract was muddled — history was excluded from mover selection but still inflated V and c on every membrane it sat in. A long L3 history block could be read by the controller as "L3 has lots of mass; pressure to evacuate to L2 is high", and the controller would then attempt promotions of file/dir-block movers based on a token budget that included history bytes that nobody wanted moved.

**Resolution.** History becomes structurally invisible to the flux controller once it is in L3:

1. **Stays in L3 forever.** Once a `history:*` item lands in L3 via the piggyback path, the flux equation never moves it upward (its mover-selection exclusion is unchanged), and the rectification clamp prevents downward motion. The only paths out of L3 for a history item are `purge_history` (compaction, new-session reset) and manual rebuild — both already-existing lifecycle events, not flux events.
2. **Excluded from V (token mass).** When the relaxation loop computes `t_lower` and `t_upper` for any membrane, `history:*` items are filtered out of the accumulation. Their bytes are still in the L3 cache block (the prompt is truthful about what's cached), but the controller does not interpret those bytes as imbalance pressure.
3. **Excluded from c (object count).** Same treatment for `c_lower` and `c_upper`. A long conversation does not inflate L3's apparent population.

This isolates the L3 cache block as a stable terminus for conversation-history accumulation, while leaving the file/dir-block flux dynamics unchanged.

**Predicate shape.** Two distinct predicates rather than overloading `is_protected`:

- `is_protected(f)` — already in place. Skips a file from mover selection. Covers BOTH pinned `file:<path>` entries (active edits in flight) AND `history:*` entries. Pinned files still contribute to V/c (their bytes really are in their tier and that mass is real); they just can't be picked as movers.
- `is_balance_excluded(f)` — new. Skips a file from V and c accumulation. Fires only on `history:*`. Pinned files do NOT match.

These differ in semantics and shouldn't be merged. Pinning says "can't move"; balance exclusion says "doesn't count toward the pressure equation." The pinned-file case is still pressure (we just can't act on it); the history case is not pressure at all.

**Legacy promote_n thresholds retired.** D35 replaced the N-counter cascade with the rectified GHK flux equation. The legacy thresholds — `L3 → L2 at N=6, L2 → L1 at N=9, L1 → L0 at N=12` — and the "N-cap-at-promote-when-stable-above" mechanism were removed from the runtime in D35, but the `promote_n` integers survived in `_TIER_CONFIG` and were still surfaced in the cache-viewer HUD's threshold column. Under D37 they are removed entirely from the per-tier config for L0/L1/L2/L3. Active retains its `promote_n` (≡ `n_admit`, default 3) because that gate IS still load-bearing on the admission membrane. The HUD threshold column is blank for L0/L1/L2/L3 entries and populated only for Active.

**What this decision does NOT change.**

- The piggyback admission path itself is unchanged — history still graduates to L3 only on Active→L3 firings. D36's generalisation (dir-block teleport firings count) is preserved verbatim.
- `purge_history` and the new-session reset are unchanged. Compaction continues to wipe `history:*` entries from the tracker; the next request rebuilds them as new active items at N=0.
- `is_protected` already excluded history from mover selection. That code is unchanged. The new V/c filter is purely additive.
- Active's `n_admit` gate is unchanged (default 3); files in Active still need to age before graduating.
- The system prompt's role as the only fixed (non-flux) prefix anchor is unchanged.

**Implementation touchpoints.**

- `src/ac_dc/cache_membrane.py` — `relax()` accepts a new `is_balance_excluded: Callable[[Any], bool]` keyword (defaulting to `lambda f: False` for backward compatibility). The accumulation loop (`for f in files: ...`) skips files matching the predicate when computing `c_lower`, `c_upper`, `t_lower`, `t_upper`. Mover-selection callsites are unchanged — `is_protected` continues to handle that.
- `src/ac_dc/stability_tracker.py` — `_run_cascade` passes `is_balance_excluded=lambda f: f.key.startswith("history:")` into `relax()`. The existing `is_protected` lambda is unchanged.
- `src/ac_dc/stability_tracker.py` — `_TIER_CONFIG` drops the `promote_n` field for L0, L1, L2, L3. Active keeps `promote_n: 3` since that drives admission. Test files referencing `_TIER_CONFIG[Tier.L3]["promote_n"]` (and similar for L1/L2) are updated.
- `src/ac_dc/llm/_breakdown.py` — drops the `promote_n` lookup from the per-item entry dict for non-Active items. The `entry["threshold"]` field is `None` (or omitted) for cached-tier rows; populated only for Active rows.
- `src/ac_dc/llm/_types.py` — doc-comment on `_TIER_CONFIG_LOOKUP` updated to reflect that only `entry_n` survives for cached tiers.
- Frontend (`webapp/src/.../*`) — cache-viewer threshold column renders blank when `threshold` is `None`. (To verify: existing renderer may already handle `None` correctly; this is a display-only change.)

**Spec authority.** `specs4/3-llm/cache-tiering.md` (§4.1, § History Graduation, §4.5, § Invariants); `specs4/0-overview/glossary.md` (N value, admission gate, ripple promotion, history isolation); `specs4/impl-history/layer-3.md` (per-tier config narrative).

**Superseded artefacts.** None outright. D37 refines D27's history rule and D35's admission rule rather than replacing them; the piggyback admission path is preserved; only the post-admission V/c contribution changes. The "L3 → L2 at N=6 / L2 → L1 at N=9 / L1 → L0 at N=12" wording, already removed from runtime by D35, is now removed from `_TIER_CONFIG` and from the glossary.
