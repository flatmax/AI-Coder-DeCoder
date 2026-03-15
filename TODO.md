# AC⚡DC Implementation Plan

## Edit Protocol Note

The AC⚡DC LLM edit protocol uses these markers (different from the dev tooling markers):
- `<<<<<<< SEARCH` (start of edit block)
- `======= REPLACE` (separator between old and new)
- `>>>>>>> END` (end of edit block)

File path appears on the line before `<<<<<<< SEARCH`.

## Phase 1: Foundation

### Step 1: Project Structure & Dependencies
- [x] `pyproject.toml` — Python package config with dependencies
- [x] `src/ac_dc/__init__.py` — Package init
- [x] `src/ac_dc/__main__.py` — Entry point stub
- [x] `src/ac_dc/main.py` — CLI skeleton

### Step 2: Configuration
- [x] `src/ac_dc/config/` — Default config files (system.md, system_extra.md, system_doc.md, compaction.md, commit.md, system_reminder.md, review.md, app.json, llm.json, snippets.json)
- [x] `src/ac_dc/config_manager.py` — ConfigManager class
  - [x] Config directory resolution (dev vs packaged)
  - [x] File loading and caching
  - [x] LLM config with env var application
  - [x] App config with defaults (deep-merge over defaults)
  - [x] System prompt assembly (system.md + system_extra.md)
  - [x] Snippet loading (nested format, two-location fallback, per-mode)
  - [x] Cache target tokens computation (model-aware)
  - [x] Commit prompt and system reminder loading
  - [x] Version-aware upgrade logic for packaged builds
  - [x] .ac-dc/ directory creation and .gitignore management

### Step 3: Settings Service
- [x] `src/ac_dc/settings.py` — Settings class (RPC-exposed)
  - [x] Whitelist enforcement (litellm, app, snippets, system, system_extra, compaction, review, system_doc)
  - [x] get_config_content / save_config_content
  - [x] reload_llm_config / reload_app_config
  - [x] get_config_info
  - [x] get_snippets / get_review_snippets

### Step 4: Repository Operations
- [x] `src/ac_dc/repo.py` — Repo class
  - [x] File I/O: get_file_content, write_file, create_file, file_exists, is_binary_file, get_file_base64
  - [x] Path validation (reject .., resolve under repo root)
  - [x] Git staging: stage_files, unstage_files, discard_changes, delete_file
  - [x] Rename: rename_file, rename_directory
  - [x] File tree: get_file_tree (nested, with git status, diff stats)
  - [x] Git status parsing (porcelain, quoted paths, renames)
  - [x] Flat file list: get_flat_file_list
  - [x] Diff: get_staged_diff, get_unstaged_diff
  - [x] Commit: stage_all, commit, reset_hard
  - [x] Search: search_files (git grep), search_commits
  - [x] Branch: get_current_branch, list_branches, is_clean, resolve_ref
  - [x] Commit graph: get_commit_graph, get_commit_log, get_commit_parent, get_merge_base
  - [x] Review helpers: checkout_review_parent, setup_review_soft_reset, exit_review_mode
  - [x] Review diffs: get_review_file_diff, get_review_changed_files

### Step 5: Tests
- [x] `tests/conftest.py` — Shared fixtures (temp git repo)
- [x] `tests/test_config_manager.py`
- [x] `tests/test_settings.py`
- [x] `tests/test_repo.py`

### Step 6: Main entry point
- [x] `src/ac_dc/main.py` — Full service construction and server startup
  - [x] Port discovery (find_available_port)
  - [x] Version detection (VERSION file, git SHA, fallback)
  - [x] Git repo validation (instruction page if not a repo)
  - [x] Static file server (ThreadingHTTPServer, SPA fallback, silent)
  - [x] Vite dev/preview server management (subprocess)
  - [x] Phase 1 fast startup (ConfigManager, Repo, Settings, DocConvert, LLMService deferred)
  - [x] Session restore before server start
  - [x] JRPCServer / CollabServer registration with --collab flag
  - [x] Event callback and chunk callback wiring
  - [x] Phase 2 deferred init (symbol index, batched indexing, stability tracker)
  - [x] Background doc index (structure extraction + keyword enrichment)
  - [x] Startup progress reporting via AcApp.startupProgress
  - [x] Vite cleanup on exit

## Phase 2: Code Analysis
- [x] Symbol Index (tree-sitter parser, extractors, cache, formatter, reference index)
  - [x] `src/ac_dc/base_cache.py` — BaseCache (mtime-based, in-memory)
  - [x] `src/ac_dc/base_formatter.py` — BaseFormatter (path aliasing, legend)
  - [x] `src/ac_dc/symbol_index/parser.py` — TreeSitterParser singleton
  - [x] `src/ac_dc/symbol_index/extractors/` — Python, JS, C, MATLAB extractors
  - [x] `src/ac_dc/symbol_index/cache.py` — SymbolCache(BaseCache) with signature hash
  - [x] `src/ac_dc/symbol_index/import_resolver.py` — Python/JS/C import resolution
  - [x] `src/ac_dc/symbol_index/reference_index.py` — Cross-file reference tracking
  - [x] `src/ac_dc/symbol_index/compact_format.py` — CompactFormatter(BaseFormatter)
  - [x] `src/ac_dc/symbol_index/index.py` — SymbolIndex orchestrator
  - [x] `tests/test_symbol_index.py` — Parser, extractors, cache, formatter, reference, integration
- [x] Document Index (markdown/SVG extractors, cache, formatter, keyword enricher)
  - [x] `src/ac_dc/doc_index/extractors/` — Markdown and SVG extractors
  - [x] `src/ac_dc/doc_index/cache.py` — DocCache(BaseCache) with disk persistence
  - [x] `src/ac_dc/doc_index/formatter.py` — DocFormatter(BaseFormatter)
  - [x] `src/ac_dc/doc_index/keyword_enricher.py` — KeyBERT integration (graceful degradation)
  - [x] `src/ac_dc/doc_index/reference_index.py` — DocReferenceIndex (section-level links)
  - [x] `src/ac_dc/doc_index/index.py` — DocIndex orchestrator
  - [x] `tests/test_doc_index.py` — Extractors, cache, formatter, reference, integration

## Known Issues
- [x] `src/ac_dc/config/llm.json` — matches `_default_llm_config()` defaults (model, smaller_model, empty env, cache params)
- [x] `src/ac_dc/config/app.json` — contains full defaults matching `_default_app_config()` (url_cache, history_compaction, doc_convert, doc_index)

## Phase 3: LLM Engine
- [x] Context Engine
  - [x] `src/ac_dc/context/__init__.py` — Package init
  - [x] `src/ac_dc/context/token_counter.py` — Model-aware token counting with tiktoken + fallback
  - [x] `src/ac_dc/context/file_context.py` — File tracking with path normalization and binary rejection
  - [x] `src/ac_dc/context/context_manager.py` — Central state: history, budget, prompt assembly (flat + tiered with cache_control)
  - [x] `src/ac_dc/context/history_store.py` — Append-only JSONL persistence, sessions, search, image persistence
  - [x] `src/ac_dc/context/topic_detector.py` — LLM-based topic boundary detection with parse fallbacks
  - [x] `src/ac_dc/context/history_compactor.py` — Topic-aware truncate/summarize compaction
  - [x] `tests/test_context.py` — Token counter, file context, context manager, prompt assembly (flat + tiered), budget enforcement
  - [x] `tests/test_history.py` — History store CRUD/search/persistence, topic detector parsing, compactor logic
- [x] Edit Protocol
  - [x] `src/ac_dc/edit_parser.py` — Parser (state machine), validator (anchor finding + diagnostics), applier (repo integration), shell command detection
  - [x] `tests/test_edit_parser.py` — Parsing, validation, application, not-in-context handling, shell commands
- [x] Cache & Assembly (stability tracker, tiers, graduation, cascade)
  - [x] `src/ac_dc/context/stability_tracker.py` — StabilityTracker with N values, tier graduation, ripple promotion cascade, initialization from reference graph, stale removal, history purge
  - [x] `tests/test_stability_tracker.py` — N values, graduation, demotion, cascade, initialization, stale removal, deselected cleanup, multi-request lifecycle

## Phase 3.5: LLM Service (Central Orchestrator)
- [x] `src/ac_dc/llm_service.py` — LLMService class
  - [x] State queries: get_current_state, get_mode
  - [x] File selection: set_selected_files, get_selected_files, set_excluded_index_files
  - [x] Mode switching: switch_mode, set_cross_reference
  - [x] Streaming chat: chat_streaming, cancel_streaming, _stream_chat
  - [x] Session management: new_session, load_session_into_context, _restore_last_session
  - [x] History: history_search, history_get_session, history_list_sessions, get_history_status
  - [x] Context breakdown: get_context_breakdown (with blocks, promotions, cache_hit_rate, url data)
  - [x] Snippets: get_snippets (mode-aware)
  - [x] Commit: commit_all, generate_commit_message
  - [x] Review mode: start_review, end_review, get_review_state, check_review_ready
  - [x] URL handling: detect_urls, fetch_url, detect_and_fetch, get_url_content, invalidate/remove/clear
  - [x] URL tracking in stability: url: items in _update_stability, url: content in _build_tiered_content
  - [x] LSP delegation: lsp_get_hover, lsp_get_definition, lsp_get_references, lsp_get_completions
  - [x] File navigation: navigate_file
  - [x] Stability tracker integration: _try_initialize_stability, _update_stability, _build_tiered_content
  - [x] Deferred initialization, collaboration localhost checks
  - [x] Doc mode re-extraction before LLM calls (mtime-based)
  - [x] Deferred doc enrichment after edit blocks (_run_deferred_enrichment)
  - [x] Cache blocks builder for cache viewer (_build_cache_blocks)
- [x] `tests/test_llm_service.py` — State, selection, mode, review, streaming guards, context breakdown, snippets, history, URLs

## Phase 4: Features
- [x] URL Handling
  - [x] `src/ac_dc/url_service/__init__.py` — Package init
  - [x] `src/ac_dc/url_service/models.py` — URLContent, URLType, GitHubInfo, url_hash, display_name
  - [x] `src/ac_dc/url_service/detector.py` — URL detection (regex), classification (GitHub/doc/web), summary type selection
  - [x] `src/ac_dc/url_service/cache.py` — URLCache (filesystem, TTL, cleanup)
  - [x] `src/ac_dc/url_service/fetcher.py` — Per-type fetch handlers (GitHub repo/file, web page), HTML extraction (trafilatura + fallback)
  - [x] `src/ac_dc/url_service/service.py` — URLService orchestrator (detect, fetch, cache, summarize, format context)
  - [x] `tests/test_url_service.py` — Cache CRUD/TTL, detection/classification, display names, summary selection, URLContent serialization, service integration
- [x] Image Persistence (already implemented in history_store.py — save_images, reconstruct_images, image_refs)
- [x] Code Review (backend: review mode orchestration in LLMService + Repo; frontend: Phase 5)
- [x] Document Convert
  - [x] `src/ac_dc/doc_convert.py` — DocConvert class
    - [x] scan_convertible_files (extension matching, excluded dirs, status badges)
    - [x] convert_files (clean tree gate, per-file conversion, provenance headers)
    - [x] is_available (markitdown, LibreOffice, PyMuPDF dependency checks)
    - [x] markitdown backend (default conversion for docx, rtf, odt, csv, odp)
    - [x] Colour-aware xlsx extraction (openpyxl, emoji markers, legend)
    - [x] PDF PyMuPDF pipeline (text extraction, selective SVG export, image detection)
    - [x] PPTX conversion (LibreOffice→PDF→PyMuPDF primary, python-pptx fallback)
    - [x] Data URI image extraction (string scanning, file save, markdown rewrite)
    - [x] DOCX image extraction (zip archive, truncated URI replacement)
    - [x] SVG image externalization (base64 decode, href/xlink:href, whitespace handling)
    - [x] Provenance headers (markdown and SVG, parsing and generation)
    - [x] Orphan image cleanup on re-conversion
    - [x] Graceful degradation (markitdown, PyMuPDF, LibreOffice, python-pptx, openpyxl)
  - [x] `tests/test_doc_convert.py` — Provenance, status detection, scanning, conversion, DOCX images, SVG externalization, config, orphan cleanup, degradation
- [x] Collaboration
  - [x] `src/ac_dc/collab.py` — Collab class (RPC-exposed) and CollabServer
    - [x] Client registry (register, unregister, host promotion)
    - [x] Pending queue with admission timeout (120s)
    - [x] Localhost detection (loopback + local network interfaces)
    - [x] admit_client / deny_client / get_connected_clients / get_collab_role
    - [x] Same-IP pending cancellation (browser refresh handling)
    - [x] Broadcast helpers (admissionRequest/Result, clientJoined/Left, roleChanged)
    - [x] CollabServer wrapping JRPCServer with admission-gated handle_connection
    - [x] Per-message caller tracking (_current_caller_uuid)
    - [x] Auto-admit first connection as host

## Phase 5: Webapp (Frontend)
- [ ] App Shell & Dialog
- [ ] File Picker
- [ ] Chat Interface
- [ ] Diff Viewer
- [ ] SVG Viewer
- [ ] File Navigation
- [ ] Context/Cache/Search/Settings tabs, Token HUD

## Phase 6: Deployment
- [ ] Build pipeline, PyInstaller, Vite, startup sequence