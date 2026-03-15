# AC⚡DC Implementation Plan

## Edit Protocol Note

The AC⚡DC LLM edit protocol uses these markers (different from the dev tooling markers):
- `<<<<<<< SEARCH` (start of edit block)
- `======= REPLACE` (separator between old and new)
- `>>>>>>> END` (end of edit block)

File path appears on the line before `<<<<<<< SEARCH`.

## Phase 1: Foundation

### Step 1: Project Structure & Dependencies
- [ ] `pyproject.toml` — Python package config with dependencies
- [ ] `src/ac_dc/__init__.py` — Package init
- [ ] `src/ac_dc/__main__.py` — Entry point stub
- [ ] `src/ac_dc/main.py` — CLI skeleton

### Step 2: Configuration
- [ ] `src/ac_dc/config/` — Default config files (system.md, system_extra.md, system_doc.md, compaction.md, commit.md, system_reminder.md, review.md, app.json, llm.json, snippets.json)
- [ ] `src/ac_dc/config_manager.py` — ConfigManager class
  - [ ] Config directory resolution (dev vs packaged)
  - [ ] File loading and caching
  - [ ] LLM config with env var application
  - [ ] App config with defaults
  - [ ] System prompt assembly (system.md + system_extra.md)
  - [ ] Snippet loading (nested format, two-location fallback, per-mode)
  - [ ] Cache target tokens computation (model-aware)
  - [ ] Commit prompt and system reminder loading
  - [ ] Version-aware upgrade logic for packaged builds
  - [ ] .ac-dc/ directory creation and .gitignore management

### Step 3: Settings Service
- [ ] `src/ac_dc/settings.py` — Settings class (RPC-exposed)
  - [ ] Whitelist enforcement (litellm, app, snippets, system, system_extra, compaction, review, system_doc)
  - [ ] get_config_content / save_config_content
  - [ ] reload_llm_config / reload_app_config
  - [ ] get_config_info
  - [ ] get_snippets / get_review_snippets

### Step 4: Repository Operations
- [ ] `src/ac_dc/repo.py` — Repo class
  - [ ] File I/O: get_file_content, write_file, create_file, file_exists, is_binary_file, get_file_base64
  - [ ] Path validation (reject .., resolve under repo root)
  - [ ] Git staging: stage_files, unstage_files, discard_changes, delete_file
  - [ ] Rename: rename_file, rename_directory
  - [ ] File tree: get_file_tree (nested, with git status, diff stats)
  - [ ] Git status parsing (porcelain, quoted paths, renames)
  - [ ] Flat file list: get_flat_file_list
  - [ ] Diff: get_staged_diff, get_unstaged_diff
  - [ ] Commit: stage_all, commit, reset_hard
  - [ ] Search: search_files (git grep), search_commits
  - [ ] Branch: get_current_branch, list_branches, is_clean, resolve_ref
  - [ ] Commit graph: get_commit_graph, get_commit_log, get_commit_parent, get_merge_base
  - [ ] Review helpers: checkout_review_parent, setup_review_soft_reset, exit_review_mode
  - [ ] Review diffs: get_review_file_diff, get_review_changed_files

### Step 5: Tests
- [ ] `tests/conftest.py` — Shared fixtures (temp git repo)
- [ ] `tests/test_config_manager.py`
- [ ] `tests/test_settings.py`
- [ ] `tests/test_repo.py`

### Step 6: Main entry point
- [ ] `src/ac_dc/main.py` — CLI argument parsing, service construction stub

## Phase 2: Code Analysis
- [ ] Symbol Index (tree-sitter parser, extractors, cache, formatter, reference index)
- [ ] Document Index (markdown/SVG extractors, cache, formatter, keyword enricher)

## Phase 3: LLM Engine
- [ ] Context Engine (context manager, file context, token counter, history, compaction, prompt assembly)
- [ ] Cache & Assembly (stability tracker, tiers, graduation, cascade)
- [ ] Edit Protocol (parser, validator, applier)

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