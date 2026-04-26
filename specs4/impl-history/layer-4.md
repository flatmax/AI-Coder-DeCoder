# Layer 4 — features

URL content (detection, fetching, summarization, cache), images (absorbed into Layer 3.2), code review, collaboration, Settings RPC service, document conversion backend.

Historical delivery record. Moved from `IMPLEMENTATION_NOTES.md` during the docs refactor.

---

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

## Layer 4 — complete

Layer 4 (features) is complete. All of: URL content (detection + fetching + summarization + cache), images (absorbed into Layer 3.2), code review (git soft-reset state machine + review context injection), collaboration (CollabServer + admission flow + restriction enforcement on LLMService/Repo/Settings/DocConvert), Settings RPC service, and document conversion (markitdown + openpyxl + python-pptx + LibreOffice + PyMuPDF pipelines for seven extensions). Ready to proceed to Layer 5 (webapp — shell, chat, viewers, file picker, search, settings).