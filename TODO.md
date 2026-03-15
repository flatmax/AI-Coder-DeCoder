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
- [x] `src/ac_dc/main.py` — CLI argument parsing, service construction stub

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
- [x] `src/ac_dc/config/llm.json` — bundled file has test values (`"model": "test/model"`), must be updated to `"anthropic/claude-sonnet-4-20250514"` to match `_default_llm_config()` (causes `test_default_model` failure)
- [x] `src/ac_dc/config/app.json` — bundled file is minimal, should contain full defaults to match `_default_app_config()` (deep-merge handles this at runtime but the file on disk should be canonical)

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

## Phase 4: Features
- [ ] URL Handling
- [ ] Image Persistence
- [ ] Code Review
- [ ] Document Convert
- [ ] Collaboration

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