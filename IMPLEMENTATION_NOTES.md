# Implementation Notes — AC-DC reimplementation

Working log for the reimplementation of AC-DC against the specs4/ suite. Notes the contributor(s) need while building — layer progress, deliberate deviations from specs3, open questions, deferred work.

Remove when the project reaches feature parity with the previous implementation.

## specs-reference preservation pass — status (2025-01)

Before deleting specs3 and the source tree, a preservation pass added byte-level / numeric-constant twins for the webapp specs and moved LLM prompt text ownership from `src/ac_dc/config/*.md` into `specs-reference/3-llm/prompts.md`.

### Delivered and applied

Seven new twin files with byte-level detail that would otherwise be lost when specs3 and the source tree are deleted:

- `specs-reference/5-webapp/svg-viewer.md` — SvgEditor constants (`HANDLE_SCREEN_RADIUS`, `_MIN_RESIZE_DIMENSION`, `_UNDO_MAX`, `_PASTE_OFFSET`, `_MARQUEE_MIN_SCREEN`, `_DRAG_THRESHOLD_SCREEN`), per-element drag dispatch table (rect/circle/ellipse/line/polyline/polygon/path/text/g), path command parser argument counts, endpoint computation, control-point computation, coordinate math (screen→SVG, element-local→SVG root, handle size constancy), handle role identifiers (nw/n/ne/e/se/s/sw/w for rect; v0..v{N-1} for poly; p{N} and c{N}-{K} for path), auto-generated ID filter regex, marquee visual feedback (forward = containment, reverse = crossing), copy-as-PNG pipeline, keyboard focus guard
- `specs-reference/5-webapp/chat.md` — Request ID format (`{epoch_ms}-{6-char-alnum}`), finish-reason badge labels + CSS classes + toast messages, compaction event stage routing table (url_fetch, url_ready, compacting, compacted, compaction_error, doc_* stages), retry prompt templates (ambiguous, not-in-context, old-text-mismatch with priority rule), file mention input accumulation templates, system event message content templates, scroll behavior constants (30px disengage, double-rAF, chunk coalescing), content-visibility thresholds (last 15 forced), input history max 100, image limits, edit block diff highlighting algorithm, compaction post-response timing (500ms + 3 retries at 1s), localStorage keys, `_suppressNextPaste` cross-component flag
- `specs-reference/5-webapp/file-picker.md` — localStorage keys (`ac-dc-sort-mode`, `ac-dc-sort-asc`, `ac-dc-picker-width`, `ac-dc-picker-collapsed`), panel width constraints (280 default, 180 min, 50% host max, 24 collapsed), context menu action IDs for file/directory/root rows, inline input mode table, shift+click vs regular click `preventDefault()` asymmetry, regular-click-on-excluded two-state-change rule, directory-click-with-excluded-descendants un-exclude-first rule, three-state checkbox cycle (default → excluded → default, NOT → selected), deleted file exclusion cleanup
- `specs-reference/5-webapp/shell.md` — dialog dimensions (50% default docked, 300×200 min, 100px visible margin), resize handle table (right/bottom/corner with hit zones), drag threshold 5px, reconnect backoff cross-reference, startup overlay (400ms fade), global keyboard shortcuts (Alt+1..4, Alt+M, Ctrl+Shift+F), Ctrl+Shift+F synchronous selection capture rule, window resize throttling (separate RAF handles for dialog resize vs viewer relayout), localStorage keys with repo-scoping for file/viewport restore, file viewport state save triggers, restore flow (deferred until overlay dismisses)
- `specs-reference/5-webapp/file-navigation.md` — spatial layout constants (`GRID_SPACING_X` 180, `GRID_SPACING_Y` 100, `NODE_WIDTH` 150, `NODE_HEIGHT` 48, `NODE_RADIUS` 8), animation timings (`FADE_DURATION` 150ms, `UNDO_TIMEOUT` 3s, Alt+Arrow debounce ~200ms), `PLACEMENT_ORDER` and `REPLACEMENT_ORDER` arrays (exact inverses), `DIR_OFFSET` table, node data model, grid state structure, event detail flags (`_fromNav`, `_refresh`, `_remote`), file type color palette (10 colors keyed by extension family), Alt+Arrow capture-phase listener rule, Escape priority
- `specs-reference/5-webapp/viewers-hud.md` — Token HUD auto-hide timing (`_AUTO_HIDE_MS` 8000, `_FADE_MS` 800, hover pauses), HUD geometry (fixed top-right, z-index 10000, 340px, 80vh max), cache hit rate color thresholds (≥50 green, ≥20 amber, <20 red), budget bar color thresholds (≤75 green, 75–90 amber, >90 red), tier color palette (L0 green / L1 teal / L2 blue / L3 amber / active orange with hex), category color palette (system/map/files/URLs/history), content group type icons (⚙️/📖/📦/📝/📄/🔗/💬), tier change markers (📈/📉), provider-cache-rate precedence rule, startup init HUD box format, post-response HUD format (cache blocks, token usage, tier changes), localStorage keys
- `specs-reference/3-llm/prompts.md` — structural twin (file inventory, role descriptions per prompt file, invariants for each, JSON schema references); NOT yet populated with verbatim prompt text — see "incomplete" below

### Implementation guide update

`specs4/0-overview/implementation-guide.md` was updated:

- Replaced `### Use src/ac_dc/config/*.md for:` heading with `### Use specs-reference/3-llm/prompts.md for:` pointing at the new twin
- Added conflict-resolution exception: when `specs-reference/3-llm/prompts.md` describes an LLM interop contract (compaction JSON shape, edit-format reminder rules) not articulated in specs4, that contract takes precedence even if specs4 is silent
- Updated the "Where specs4 Is Incomplete Without specs-reference" table — removed the row pointing at `src/ac_dc/config/*.md`, added seven rows pointing at the new twins (prompts, chat, file-picker, shell, file-navigation, viewers-hud, svg-viewer)

### Incomplete — needs verbatim prompt text embedded into `specs-reference/3-llm/prompts.md`

The prompts twin currently has structural documentation but NOT the verbatim content of the nine config files. When I attempted to embed the verbatim text, the context exceeded the 1M-token limit and the edit session could not continue.

**The verbatim content for each file needs to be pasted into `specs-reference/3-llm/prompts.md` under that file's section.** Source is `src/ac_dc/config/*.md` (and `*.json`) in the existing source tree. Deleting the source tree before this step completes means losing the actual text.

Per-file embedding status and what the target section currently says:

1. **`compaction.md`** — attempted embed, appears to have been applied successfully in the failed session but please verify. The target section in the twin should have a `### Verbatim content` subsection containing the full compaction prompt wrapped in a four-backtick fence. This is the MOST CRITICAL file to embed — the LLM response it elicits must produce parseable JSON with exactly the four fields (`boundary_index`, `boundary_reason`, `confidence`, `summary`). Reimplementers without the original text will guess at the prompt and silently break history compaction.

2. **`system_reminder.md`** — attempted embed, appears to have been applied. Verify the `### Verbatim content` subsection contains the literal reminder text including the leading `\n\n` note. Short file. Second most critical — without it, edit-block reliability degrades over long sessions.

3. **`system.md`** — attempted embed, appears to have been applied. Verify the full coding-agent system prompt is wrapped in a four-backtick fence under `### Verbatim content`. The file is long (~170 lines of markdown) covering the symbol map, edit protocol, context trust, failure recovery.

4. **`system_doc.md`** — embed was partially attempted when the session hit the context limit. The target section's stub paragraph reading "**Content:** Preserve verbatim from a reference deployment. Plain markdown." needs to be replaced with `### Verbatim content` + four-backtick-fenced full document-mode prompt.

5. **`review.md`** — not yet embedded. Same pattern — replace the "Content: Preserve verbatim..." stub with `### Verbatim content` + fenced full review-mode prompt.

6. **`commit.md`** — not yet embedded. Same pattern. Conventional-commit style prompt, ~60 lines.

7. **`snippets.json`** — not yet embedded. The twin has a "Content: Preserve the full snippet arrays verbatim from a reference deployment." stub that needs replacing with `### Verbatim content` + a JSON fence containing the full nested structure (`code`, `review`, `doc` arrays with icon/tooltip/message fields).

8. **`llm.json`** — the twin already shows a schema example, but NOT the actual default values that shipped. Replace the "Default values to ship:" bullet list with the verbatim JSON content. The actual file has `model: "bedrock/global.anthropic.claude-opus-4-7"`, `smaller_model: "bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0"`, `max_output_tokens: 128000`, and an env block with `AWS_REGION: "ap-southeast-2"` — note these are provider-specific defaults from the reference deployment. A generic reimplementation might ship different defaults; preserve the original as "reference values."

9. **`app.json`** — the twin already embeds the schema and default values verbatim because they're short. Verify the rendered values in the twin match the source file (they should — the values I placed there came from the current codebase).

### How to complete this work

Each file should follow the same pattern — in `specs-reference/3-llm/prompts.md`, locate the section for that file and replace the placeholder paragraph with:

```
### Verbatim content

````
<paste exact file content here>
````
```

Use FOUR backticks for the outer fence so triple-backtick fences in the source (e.g., the JSON examples in `compaction.md`) don't terminate the outer fence prematurely.

Suggested order (by criticality):

1. Verify `compaction.md` and `system_reminder.md` landed (the earlier session reported success but the session crashed so the applied state should be double-checked)
2. Embed `review.md` and `commit.md` (short, high value)
3. Embed `snippets.json`, `llm.json` verbatim sections
4. Verify `system.md` and `system_doc.md` landed or finish embedding them
5. Verify `app.json` values match

After completion, delete `src/ac_dc/config/*.md` and `*.json` from the source tree along with the rest of specs3 and the source code.

### Other observations from this pass

- `specs4/1-foundation/jrpc-oo.md` was noted as a potential gap but the user requested it be left as-is. Not addressed.
- No twin was created for `specs4/2-indexing/reference-graph.md`, `specs4/2-indexing/keyword-enrichment.md`, `specs4/3-llm/modes.md`, `specs4/4-features/code-review.md`, `specs4/4-features/images.md`, `specs4/4-features/url-content.md`, `specs4/5-webapp/agent-browser.md`, `specs4/5-webapp/diff-viewer.md` beyond what specs-reference already has, `specs4/5-webapp/search.md`, `specs4/5-webapp/settings.md`, `specs4/5-webapp/speech.md`, `specs4/5-webapp/tex-preview.md`, `specs4/6-deployment/packaging.md`. The spec4 content for these was judged sufficient for reimplementation during the analysis. If a byte-level detail turns out to be missing during reimplementation, the right response is to grep the original source tree (before deletion) or add the detail to an ad-hoc twin and update the implementation guide's table.
- The pattern for any future missing twin — same mechanical rule: `specs4/{path}/{name}.md` ↔ `specs-reference/{path}/{name}.md`; add a row to the implementation guide's table; twin gets byte-level / numeric detail only, not behavior.


## Archive

Completed layers and the decision log have been moved to [specs4/impl-history/](specs4/impl-history/) to keep this file focused on active work. See:

- [specs4/impl-history/README.md](specs4/impl-history/README.md) for an index
- [specs4/impl-history/decisions.md](specs4/impl-history/decisions.md) for D1–D16
- [specs4/impl-history/layer-0.md](specs4/impl-history/layer-0.md) through `layer-4.md` for per-layer records

## Decisions

### D19 — SVG viewer listens directly for `files-modified`

The diff viewer's D18 rewrite eliminated cross-run staleness by refetching on every `openFile`. The SVG viewer kept its multi-tab `_files[]` cache and relied on the app shell's narrower set of refresh triggers (`streamComplete` with non-empty `files_modified`, `commitResult`, `files-reverted`), which miss external edits that fire only the generic `files-modified` broadcast — git pulls, edit-pipeline applies on unrelated workflows, collab writes, terminal edits.

Symptom: opening an SVG in the viewer, editing the same file outside AC⚡DC (or across a different run), clicking back to the viewer tab shows the pre-edit cached content. The backend RPC (`Repo.get_file_content`) is honest — it reads from disk — but `openFile`'s same-file short-circuit means it never gets called for an already-open path.

Resolution: the SVG viewer subscribes to `files-modified` window events in `connectedCallback`, removes the listener in `disconnectedCallback`, and calls `refreshOpenFiles()` when any affected path is open. `refreshOpenFiles` itself gained a dirty-skip guard so mid-edit SvgEditor state isn't clobbered by an unrelated refresh. Defensive against missing / empty `paths` in the event detail (older backends, edge paths) — falls back to refreshing every open file. Six new tests in `svg-viewer.test.js § SvgViewer files-modified broadcast` cover the happy path, unrelated-paths short-circuit, empty-detail defensive refresh, no-open-files no-op, dirty-file preservation, and disconnect cleanup.

The alternative — rewriting the SVG viewer to the diff viewer's single-file no-cache model (D18) — was rejected because the multi-tab SVG workflow is genuinely useful for presentation decks, the existing test coverage is extensive, and the set of paths that can change beneath an open SVG tab is narrow enough that `files-modified` covers it reliably.

### D17 — Per-repo working directory renamed to `.ac-dc4/`

The previous AC-DC implementation uses `.ac-dc/` at the repo root for its per-repo working state (conversation history, symbol map snapshot, image attachments, doc cache sidecars). This reimplementation shares repositories with that implementation during the transition — a developer might run one instance in the morning and the other in the afternoon against the same checkout. Colliding on the same directory name would corrupt both states: session JSONL schemas, cache sidecar formats, and image filename conventions all drift between the two.

Resolution: this reimplementation uses `.ac-dc4/` exclusively. The name is chosen to parallel `specs4/` — both are "the four-numbered one" in the transition.

Single source of truth: `src/ac_dc/config.py:_AC_DC_DIR`. Every module that needs the path imports the constant rather than hardcoding the string. `doc_index/cache.py` was the only module found to have hardcoded `.ac-dc` during audit; that's now fixed and uses `_AC_DC_DIR` via import.

Both directory names are in `.gitignore` so a developer running both implementations sees neither directory tracked by git.

Specs4 documents the per-repo directory abstractly ("the per-repo working directory") without pinning the name, which is the right altitude for a behavioral spec. Specs3 correctly documents `.ac-dc/` because it describes the previous implementation. Neither suite needs updating for this rename.


unnecessary — let me also add the work plan

Wait, I need to separate this into two edits — one for D18 and one for the work plan section. Let me redo.

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

Moved to [specs4/impl-history/decisions.md](specs4/impl-history/decisions.md). New decisions continue numbering from D17 in this file.

### D18 — Dropped svg-pan-zoom in favour of a paired SvgEditor

Layers 5.11–5.20 shipped the SVG viewer with `svg-pan-zoom` running on both panes plus `SvgEditor` on the right pane for visual editing — two libraries, two coordinate systems, two viewBox authorities. The overlap produced shadow-DOM fragility, duplicated CTM inversion math, and a four-party viewBox sync dance that was prone to feedback loops.

Post-Phase-3 refactor (commit `9770dc6`, impl-history entry 5.21): dropped `svg-pan-zoom`. `SvgEditor` gains a `readOnly` flag — when set, the editor handles pan/zoom/fit/wheel-zoom/middle-click-pan but skips every mutation path (selection, handles, marquee, text-edit, keyboard shortcuts, onChange). Both panes host editor instances; left is read-only. Each editor fires `onViewChange(viewBox)` on every viewBox write; the viewer mirrors writes between panes via `setViewBox(..., { silent: true })` guarded by a shared `_syncingViewBox` mutex. Full rationale in [specs4/impl-history/decisions.md § D18](specs4/impl-history/decisions.md#d18--dropped-svg-pan-zoom-in-favor-of-unified-svgeditor-on-both-panes).

Spec updated in commit `7ef81d0` (`specs4/5-webapp/svg-viewer.md`). Impl-history at `specs4/impl-history/layer-5.md § 5.21` — the 5.11–5.20 entries are preserved as historical record; the refactor swaps the navigation substrate without touching the editing surface they document.

## Next tasks

Layers 0–4 complete. Layer 5 is substantially delivered — core interaction loop (chat + selection + viewing + editing + search + review) fully functional. Remaining Layer 5 work, in order of readiness:

1. **UI polish work plan** (next, next) — see the dedicated plan section below. Four commits: viewer relayout on dialog/window resize (a real bug), Alt+1..4 / Alt+M shortcuts, file picker left-panel resizer, and specs4 docs catch-up for dialog chrome.
2. **Doc Convert tab — commit 6** — commits 1–5 delivered the full interaction surface. Commit 6's scope is TBD; land after UI polish so the tab renders in a finished dialog chrome.
3. **Collaboration UI — on pause.** Backend collab (Layer 4.4/4.5) is fully in place; the frontend surface (admission flow pending screen, admission toast, participant UI restrictions, connected-users indicator, collab popover with share link) is deliberately deferred. Revisit when someone actually wants to run a multi-client session; building the UI on spec without a real testing workflow would accumulate staleness.

Beyond Layer 5: Layer 6 (deployment — build tooling, PyInstaller packaging, release pipeline) has not started. The webapp-dist bundling deferral (D7) and version baking for releases both land in Layer 6.

## UI polish work plan

Four commits, in order. Each is a standalone change with its own tests. Strike through the heading and add a one-line delivery note with the commit hash after each lands.

### ~~Commit A — Viewer relayout on dialog/window resize~~ (delivered `7213ba4`)

`diff-viewer.js` gained `relayout()` (calls `this._editor.layout()`, no-op in empty state, swallows throws from detached DOM). `svg-viewer.js` gained `relayout()` (calls `fitContent({silent: true})` on both editors under the `_syncingViewBox` mutex, then pushes the right pane's final viewBox onto the left so the two panes stay exactly synced across the resize). `app-shell.js` wires both — new `_scheduleViewerRelayout()` helper with a dedicated `_viewerRelayoutRAF` handle (separate from `_resizeRAF` so window-resize and drag-resize don't cancel each other's pending frames), called from `_handleWindowResize` and from `_onPointerMove` during dialog resize. Test coverage in `diff-viewer.test.js § DiffViewer relayout` (4 tests — editor-layout call, empty-state no-op, survives Monaco throw, post-swap editor identity) and `svg-viewer.test.js § SvgViewer relayout` (5 tests — fit-both + silent flag, empty-state no-op, mutex held, survives one-side throw, right-to-left sync). `specs4/5-webapp/shell.md § Window Resize Handling` documents the hook. `app-shell.test.js` extends its resize tests to cover the viewer-relayout path.

### ~~Commit B — Alt+1..4 / Alt+M keyboard shortcuts~~ (delivered `e5dcf14`)

Wired `_onGlobalKeyDown` on `document` bubble-phase. Alt+1/2/3/4 route through `_switchTab`, Alt+4 gated on `_docConvertAvailable` (no-op when markitdown isn't installed, but still `preventDefault` so browser chrome shortcuts can't grab the keystroke). Alt+M toggles minimize. Guards against Ctrl/Meta/Shift modifiers — Alt+Shift+digit is macOS symbol entry, Ctrl+Alt+digit is a GNOME workspace binding; leaving those alone avoids collision. `preventDefault` fires on every handled path. Bubble phase is fine because no child component intercepts Alt+digit/M, keeping this handler independent from the grid's capture-phase Alt+Arrow handler. 15 tests in `app-shell.test.js § global keyboard shortcuts` cover each shortcut, the doc-convert gate, modifier exclusion, unmapped-key passthrough, localStorage persistence for both tab switch and minimize, and disconnect cleanup.

**Scope:**

- `webapp/src/app-shell.js` — add a new `_onGlobalKeyDown` bound handler registered on `document` (capture phase not required; bubble is fine since no child component intercepts Alt+digit / Alt+M). Dispatches:
  - Alt+1 → `_switchTab('files')`
  - Alt+2 → `_switchTab('context')`
  - Alt+3 → `_switchTab('settings')`
  - Alt+4 → `_switchTab('doc-convert')` — but only when `_docConvertAvailable === true`; otherwise the shortcut is a no-op (no tab exists).
  - Alt+M → `_toggleMinimize()`
- Existing `_onGridKeyDown` handler keeps the Alt+Arrow navigation grid; the new shortcuts use digit and M keys so there's no conflict.
- All five shortcuts call `event.preventDefault()` so browser defaults don't fire (some browsers use Alt+digit for tab switching at the browser level).

**Test contracts:**

- `webapp/src/app-shell.test.js` — new describe block `global keyboard shortcuts` with tests for each: Alt+1..3 switches tab, Alt+4 switches when available, Alt+4 no-ops when doc-convert unavailable, Alt+M toggles minimize, preventDefault fires for all five.

### ~~Commit C — File picker left-panel resizer~~ (delivered `f9a9856`)

Shipped the splitter. `files-tab.js` gained `_PICKER_*` constants (min 180, collapsed 24, default 280), localStorage hydration helpers for both width and collapsed state, a new `_pickerCollapsed` reactive property, pointerdown/move/up drag handlers with clamping to `[180, hostWidth/2]`, and a double-click handler that toggles collapsed state while preserving the stored drag width. Mid-drag inline-style mutations bypass Lit's re-render cycle; commit on pointerup writes the final width back to the reactive property and to `ac-dc-picker-width`. Pointerdown in collapsed mode no-ops (originWidth would be meaningless) — double-click is the only way out. Splitter widens from 4px to ~20px in collapsed mode with a `▸` glyph affordance so the click target is findable. ARIA separator role + contextual tooltip matches the spec. 16 tests in `files-tab.test.js § FilesTab left-panel resizer` cover rendering order, drag bounds, persistence, collapse toggle, malformed-storage fallbacks for both keys, disconnect-during-drag cleanup. `specs4/5-webapp/file-picker.md § Left Panel Resizer` firmed up from vague bullet points to concrete numbers and the two localStorage keys.

### ~~Commit D — specs4/5-webapp/shell.md catch-up for dialog chrome~~ (delivered `c586d59`)

Expanded `specs4/5-webapp/shell.md § Dialog Container` from four bullets into eight subsections: Layout Modes, Resize Handles (with the three-row table pinning the right/bottom/corner asymmetry), Minimum Dimensions (300 × 200 with the JS-vs-CSS clamp rationale), Dragging (header-as-handle, button-skip, 5px threshold), Off-Screen Recovery (the 100px visible-margin rule with explicit clamp ranges), Proportional Rescaling (window-resize handling split by mode), and Persistence (four-key table with types, purposes, and defensive fallbacks). All values drawn from `app-shell.js` constants. Pure documentation — no code changes. Closes out the four-commit UI polish sequence.

### Out of scope

- Doc Convert commit 6 — deferred to its own plan section.
- Collaboration UI — parked.
- Refactoring `app-shell.js` into smaller modules — the file is ~2200 lines. Might be worth a follow-up commit after this plan lands, but it's a separate concern.

## Layer 0 — scaffolding — complete

Historical detail archived to [specs4/impl-history/layer-0.md](specs4/impl-history/layer-0.md).

## Layer 1 — foundation — complete

Historical detail archived to [specs4/impl-history/layer-1.md](specs4/impl-history/layer-1.md).

## Layer 2 — indexing — complete

Historical detail archived to [specs4/impl-history/layer-2.md](specs4/impl-history/layer-2.md). All sub-layers delivered: 2.1–2.7 (symbol index), 2.8.1 (markdown doc index), 2.8.2 (LLMService wiring), 2.8.3 (SVG extractor), 2.8.4 (keyword enrichment).

## Layer 5 — in progress

## Deferred cleanup

Temporary scaffolding installed to keep a test/output path quiet, with the fix scheduled for a specific future phase. Grep `TODO(phase-` across the tree to find markers.

- **`webapp/src/app-shell.test.js` — `describe('setupDone')` console.error silence.** The `beforeEach`/`afterEach` pair in the setupDone describe block installs a `vi.spyOn(console, 'error').mockImplementation(() => {})` to swallow errors from the files-tab's `onRpcReady` handler when it tries `Repo.get_file_tree` on a fake proxy that doesn't implement it. The errors are genuine — the files-tab genuinely can't fetch the tree — but they're out of scope for app-shell tests which focus on shell-level wire-up, not files-tab RPC behavior. **Remove when:** Phase 2d expands these shell tests (or adds a separate integration test class) that publishes a richer fake proxy including `Repo.get_file_tree`, at which point the files-tab's RPC call succeeds and the console.error goes away naturally. The TODO comment in the test file references `TODO(phase-2d)` so it shows up in that phase's grep sweep.

## DiffViewer redesign plan — **delivered**

Single-file, no-cache, refetch-on-every-click. See D18 for rationale and specs impact. Delivered across two commits:

- **Pass 1 (diff-viewer.js core rewrite)** — commit `788b90d`. Replaced `_files[]` / `_activeIndex` / `closeFile` / `saveAll` / `getDirtyFiles` / `_viewportStates` / `_panelLabels` / `_texPreviewStates` / `_openingPaths` with a single `_file` slot OR a single `_virtualComparison` slot (mutually exclusive), plus an `_openingGeneration` counter for fetch-superseding. Rewrote `openFile` (no same-file suppression, generation-counter check at resolve time, clears virtual slot), `loadPanel` (accumulates across calls in the virtual slot), `refreshActiveFile` (no-op when virtual active). Removed Ctrl+PageUp, Ctrl+PageDown, Ctrl+W. Kept Ctrl+S and Ctrl+F. Monaco Go-to-Def cross-file dispatch switched to window-level `navigate-file` events so the app shell's full pipeline runs.

- **Pass 2 (app-shell.js caller updates + Pass 3 tests)** — commit `d5b8d3c`. Removed redundant `closeFile` in the SVG-toggle visual→text branch. Updated the text→visual branch to read from `_file` (single slot) instead of `_files[]`. Added Alt+Arrow debounce (~200ms window) so rapid arrow sequences through the file-nav grid coalesce into a single viewer fetch at the end — HUD updates remain immediate, only the viewer dispatch defers. Alt release flushes pending dispatch immediately so the HUD doesn't fade before the viewer updates. Wired review-mode transitions (`review-started`, `review-ended`) to refresh open viewers via the existing `files-reverted` path so the backend's soft-reset changes to HEAD/working-copy propagate into already-open files. Test additions: same-file refetch, virtual slot accumulation, generation-counter discard of late stale fetches, `refreshActiveFile` no-op when virtual, three Alt+Arrow debounce tests (rapid sequence → one fetch, Alt release flushes, arrow within window resets timer).

### Delivery deviations from the original plan

- **Pass 4 consolidation.** The original plan had four passes (1 code, 2 callers, 3 tests, 4 notes). In practice tests landed with the relevant code changes rather than in a separate commit — Pass 1's commit included its own test updates (removing `_files[]`-style assertions, adding the no-cache invariants), and Pass 2's commit included the Alt+Arrow debounce tests alongside the feature. Pass 4 (this update) is the only separately-committed pass.

- **`refreshOpenFiles` kept as an alias, not removed.** App-shell callers (`stream-complete`, `commitResult`, `files-reverted`) still use the plural name; the single-file rewrite aliases it to `refreshActiveFile` so no caller site needed to change.

- **No `file-nav.test.js` changes landed.** The plan noted grid history tracking was unchanged; inspection confirmed no same-file-reuse logic tied to viewer open-state existed, so the file didn't need adjustment.

### Invariants preserved

- specs3/5-webapp/diff_viewer.md was NOT updated — it describes the previous implementation. The single-file policy is specs4-only (see D18).
- `file-saved` event shape unchanged. Saves still route through the parent.
- Markdown preview, TeX preview, LSP, markdown link provider, status LED, panel labels for `loadPanel`, content-change dirty tracking all preserved.
- The diff editor's single-instance reuse pattern is preserved — the rewrite changes what feeds the models, not the editor lifecycle itself.

### Pass 1 — diff-viewer.js core rewrite

Strip `_files[]`, `_activeIndex`, `closeFile`, `saveAll`, `getDirtyFiles`, `_viewportStates`, `_panelLabels`, `_texPreviewStates`, `_openingPaths`. Replace with:

- `_file: {path, original, modified, savedContent, isNew, isVirtual, isReadOnly, isConfig, configType} | null` — the single active file slot
- `_virtualComparison: {leftContent, leftLabel, rightContent, rightLabel} | null` — the loadPanel slot
- `_openingGeneration: number` — monotonic counter; each `openFile` call bumps it and captures the current value. Async fetches that resolve after the counter has advanced skip their model-attach step.

Rewrite `openFile`:
- No same-file suppression. Every call fetches.
- No concurrent-path deduplication. A second call for any path supersedes the first via generation-counter check at resolve time.
- Clear `_virtualComparison` when opening a real file.
- Dispose old models, fetch new content, build new models, attach.

Rewrite `loadPanel(content, panel, label)`:
- Populate `_virtualComparison[panel]Content` and `[panel]Label`
- If `_virtualComparison` was null, initialize with empty opposite side and clear `_file`
- Dispose old models (if any), build new models from virtual contents, attach. Modified editor forced read-only.

Rewrite `refreshOpenFiles` as `refreshActiveFile`:
- No-op when `_file` is null or `_virtualComparison` is active
- Otherwise: refetch HEAD + working, rebuild models, clear dirty
- Keep `refreshOpenFiles` as an alias so app-shell callers (`stream-complete`, `commitResult`, `files-reverted`) don't change

Remove keyboard shortcuts: Ctrl+PageUp, Ctrl+PageDown, Ctrl+W. Keep Ctrl+S (save active file), Ctrl+F (Monaco find widget).

### Pass 2 — app-shell.js caller updates

- Remove any `diffViewer.closeFile(path)` calls (SVG-toggle handler replaces the file entirely anyway)
- Monaco Go-to-Def cross-file: change the `_codeEditorService.openCodeEditor` patch to dispatch `navigate-file` on the window instead of calling `this.openFile` directly. Include `{path, line}` in detail.
- Add Alt+Arrow debounce: hold a timer in the grid keydown path. Arrow updates `fileNav.currentNodeId` and HUD visually on every press, but `navigate-file` dispatch is deferred by ~200ms. A subsequent arrow within the window resets the timer. Alt release dispatches immediately.
- Wire review-mode transitions (`review-started`, `review-ended` events) to `files-reverted` so the active file refetches.

### Pass 3 — tests

- `diff-viewer.test.js`: drop multi-file tests (open two files, verify both tracked; Ctrl+PageUp cycles; closeFile keeps other open). Add: same-file click refetches; unsaved edits discarded on switch; virtual slot accumulates across two loadPanel calls; opening real file clears virtual slot; generation-counter discards superseded fetches; refreshActiveFile no-op when virtual active.
- `app-shell.test.js`: add Alt+Arrow debounce test (rapid arrow sequence produces one navigate-file dispatch, not N).
- `file-nav.test.js`: if the grid has any same-file-reuse logic tied to open-state, adjust. Grid history tracking itself is unchanged.

### Pass 4 — IMPLEMENTATION_NOTES.md work tracking

Strike completed passes; add delivery commits; document any deviations.

### Notes

- specs3/5-webapp/diff_viewer.md is **not** updated. It describes the previous implementation, not this one. The single-file policy is specs4-only.
- The `file-saved` event shape is unchanged. Saves still route through the parent.
- Markdown preview, TeX preview, LSP, markdown link provider, status LED, panel labels (for loadPanel), content-change dirty tracking are all preserved.
- The diff editor's single-instance reuse pattern is preserved — the rewrite changes the contents that feed the models, not the editor lifecycle.

## Keyword enrichment UX completion plan — **delivered**

All three steps shipped. Tristate `enrichment_status` on the backend (Step 1), floating progress overlay on the frontend (Step 2a), one-shot unavailable-toast (Step 2b). Plan detail archived to [specs4/impl-history/layer-2.md](specs4/impl-history/layer-2.md) under the Layer 2.8.4 section.

### Original plan (for reference)

Layer 2.8.4 shipped the enrichment pipeline (scaffold, extraction, orchestrator integration) but left three cleanup items for a follow-up pass: tristate readiness signalling, frontend progress routing, and a one-shot unavailable-toast.

### Step 1 — Backend tristate `enrichment_status`

The current `get_mode()` returns `doc_index_enriched: bool`, which can't distinguish "KeyBERT unavailable" from "still building". Both report False, so the frontend can't decide whether to wait or to show a warning toast.

Replace the single boolean with a tristate string field `enrichment_status`:

- `"unavailable"` — KeyBERT probe failed or model load failed. Frontend shows a one-time warning toast.
- `"pending"` — background build hasn't started the enrichment phase yet. Frontend shows nothing.
- `"building"` — enrichment loop is active. Frontend shows the header progress overlay.
- `"complete"` — all queued files enriched. Frontend hides the overlay.

Keep the existing `doc_index_enriched` boolean for backwards compatibility — it maps to `enrichment_status === "complete"`. The boolean stays until we can audit all RPC callers; today we only know about the webapp.

Changes in `llm_service.py`:

- New `_enrichment_status` state field, initialized to `"pending"` in `__init__`
- `_run_enrichment_background` flips to `"unavailable"` in both early-return branches (KeyBERT probe failed, model load failed)
- Flips to `"building"` at the top of the main enrichment loop
- Flips to `"complete"` on successful completion (alongside the existing `_doc_index_enriched = True`)
- `get_mode()` includes `enrichment_status` in its return dict

Tests in `tests/test_llm_service.py`:

- Pin all four states across the enrichment lifecycle
- Confirm `doc_index_enriched` stays consistent with `enrichment_status === "complete"`

### Step 2a — Frontend progress overlay (doc-index + enrichment)

New LitElement `ac-doc-index-progress` modeled after `ac-compaction-progress`. Floats above the compaction progress bar (stacks vertically — compaction at the usual position, doc-index one row up) so users can see both kinds of progress simultaneously during a busy session.

Listens for `startupProgress` events with the following stages and routes them to the overlay instead of the startup-overlay machinery:

- `doc_index` — structural extraction in progress
- `doc_index_error` — structural extraction failed
- `doc_enrichment_queued` — enrichment starting (total count in message)
- `doc_enrichment_file_done` — per-file enrichment complete
- `doc_enrichment_complete` — all enrichment done; fade out after 800ms

`app-shell.js` changes:

- Intercept the doc-index-related stages in the `startupProgress` handler
- Do NOT update `startupMessage` / `startupPercent` for these stages
- Do NOT dismiss the startup overlay for these stages (the `ready` stage is still the only dismiss trigger)
- Dispatch a new window event `doc-index-progress` that the overlay subscribes to
- Import and mount `<ac-doc-index-progress>` alongside `<ac-compaction-progress>`

### Step 2b — One-shot unavailable toast

When the backend reports `enrichment_status === "unavailable"`, show a warning toast exactly once per browser session:

> "Keyword enrichment disabled — install `ac-dc[docs]` for richer document outlines."

Check a localStorage flag `ac-dc-enrichment-unavailable-shown` to suppress repeats across page reloads. Trigger from two places:

- `_fetchCurrentState` when the initial state snapshot arrives with the unavailable status
- `_onModeChanged` when a mode-changed broadcast carries the unavailable status (handles the rare case where the user's backend session came up without KeyBERT after a reboot)

### Delivery order

1. **Step 1** (backend tristate) — no frontend impact, lands alone with tests
2. **Step 2a** (progress overlay component) — depends on Step 1 for the `enrichment_status` field; reads from `startupProgress` stages which already exist
3. **Step 2b** (unavailable toast) — depends on Step 1's `enrichment_status` field

After each lands, strike through the heading here, add a one-line delivery note with the commit hash, and update the matching section in `specs4/impl-history/layer-2.md`.

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