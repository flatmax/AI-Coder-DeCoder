# Parallel Agents — `_stream_chat` Scope Refactor

**Status:** in progress. Resumption-friendly work log for the `ConversationScope` refactor in `src/ac_dc/llm_service.py`.

Governing spec: `specs4/7-future/parallel-agents.md` § Foundation Requirements.
Decision log: IMPLEMENTATION_NOTES.md D22 (parallel-agents foundation uses the existing streaming pipeline).

## Goal

Refactor `LLMService._stream_chat` and its helper methods so every per-conversation state access goes through an explicit `ConversationScope` parameter rather than implicit `self._context` / `self._file_context` / `self._stability_tracker` / `self._session_id` / `self._selected_files` reads.

**The refactor must be invisible to every existing test.** The single-agent call path continues to work byte-identically; the only change is that per-conversation state is reached through one parameter instead of implicit `self.` reads.

This is prerequisite work for agent spawning. Once the scope parameter exists, a future commit can construct agent-specific scopes via `build_agent_context_manager` and invoke `_stream_chat` N times in parallel with them — no separate runner or orchestrator module needed (D22).

## Non-goals

- No agent spawning this commit.
- No parser dispatch on `AGENT` blocks this commit.
- No frontend tab strip.
- No decomposition of `llm_service.py` into multiple files. The file is 3000+ lines and deserves its own plan; doing it piecemeal during this refactor would be the worst of both worlds. See the "Follow-up: llm_service.py decomposition" note in IMPLEMENTATION_NOTES.md.

## Shape

Inline `ConversationScope` dataclass defined at module scope in `llm_service.py`. Fields:

- `context: ContextManager` — conversation history, system prompt, URL context, review context, mode, file_context (ContextManager owns its own FileContext)
- `tracker: StabilityTracker` — cache tier state
- `session_id: str` — history store partition
- `selected_files: list[str]` — the picker state for this conversation
- `archival_append: Callable[..., None] | None` — `(role, content, **kwargs) -> None`; wraps the history store write. None when no history store is attached.

Fields NOT in scope (read directly from `self`):
- `_review_active`, `_review_state` — main-conversation-only per spec; agents never review
- `_committing`, `_active_user_request`, `_cancelled_requests`, `_request_accumulators` — guard / multiplexing state, shared infrastructure
- `_url_service` — session-scoped (sharing the fetched dict across agents within one turn is desirable)
- `_symbol_index`, `_doc_index`, `_repo`, `_config`, `_counter`, `_edit_pipeline`, `_event_callback`, executors, `_compactor`, `_trackers`, `_stability_initialized`, `_doc_index_ready`, `_doc_index_building`, `_doc_index_enriched`, `_enrichment_status`, `_cross_ref_enabled`, `_session_totals`, `_last_error_info`, `_main_loop`, `_init_complete`, `_restored_on_startup`, `_excluded_index_files` — shared infrastructure

**turn_id** is NOT a scope field. It's generated per-request inside `_stream_chat` (or passed in by future agent-spawning code). A single ContextManager handles many turns; turn_id is mid-flight state, not scope-lifetime state.

## Default scope construction

New private method `_default_scope() -> ConversationScope` on `LLMService` builds a scope from `self` for single-agent operation. Every existing entry point (`chat_streaming`, `_post_response` when called directly) builds a default scope and threads it.

Agent-specific scopes will be constructed by future agent-spawning code using `build_agent_context_manager` to produce the `ContextManager`, the spawn's per-agent `StabilityTracker`, and a per-agent `selected_files` list — all bundled into a `ConversationScope` that the refactored `_stream_chat` consumes without caring which kind it is.

## Commit sequence

Each step is a small, reviewable diff. Each step leaves the codebase working and tests passing. If we hit something unexpected at step N, we can stop and rethink without having torn everything apart.

**Step 1 — Add `ConversationScope` dataclass + `_default_scope()` helper.** No call sites use it yet. Just landing the type and constructor.

**Step 2 — Refactor `_stream_chat` signature to accept `scope`.** Body reads per-conversation state from `scope.*` instead of `self._*`. `chat_streaming` calls `_stream_chat(..., scope=self._default_scope())`. Every test passes unchanged.

**Step 3 — Refactor `_post_response(request_id, turn_id)` → `_post_response(request_id, turn_id, scope)`.** `_stream_chat` threads it through. Compaction system-event writes go through `scope.archival_append` and `scope.context.add_message`.

**Step 4 — Refactor `_update_stability()` → `_update_stability(scope)`.** Read `scope.context`, `scope.selected_files`, `scope.tracker`.

**Step 5 — Refactor `_sync_file_context()` → `_sync_file_context(scope)`.** Read `scope.context.file_context` and `scope.selected_files`.

**Step 6 — Refactor tier assembly methods to take scope.** `_build_tiered_content()`, `_assemble_tiered()`, `_assemble_messages_flat()` — all read `scope.context`, `scope.tracker`, `scope.selected_files`.

**Step 7 — Refactor `_detect_and_fetch_urls()` to take scope.** URL context attaches to `scope.context`; URL service's session-scoped `_fetched` dict stays shared (no scope field).

**Step 8 — Refactor `_build_completion_result()` to take scope.** The auto-add-to-selection path mutates `scope.selected_files` and `scope.context.file_context`; review-mode check still reads `self._review_active` (main-only).

**Step 9 — Refactor `_build_and_set_review_context()` to take scope.** Uses `scope.selected_files` for reverse-diff selection; still reads `self._review_state` and `self._review_active` directly.

**Step 10 — Add `TestConversationScopeDefault` test class.** Verifies byte-identical behaviour when `_stream_chat` is called with an explicit default scope. Existing tests remain unchanged.

**Step 11 — Add follow-up note to IMPLEMENTATION_NOTES.md.** Record the decision to defer `llm_service.py` decomposition and mark this refactor complete.

## Invariants

- Every existing test in `tests/test_llm_service.py` passes unchanged.
- No call path reads per-conversation state from `self._context` / `self._file_context` / `self._stability_tracker` / `self._session_id` / `self._selected_files` outside of `_default_scope()` construction and the handful of RPC methods that are main-conversation-only by design (`get_current_state`, `set_selected_files`, `switch_mode`, etc).
- Main-conversation-only state (`_review_active`, `_review_state`, `_committing`, `_committing` guard, etc) continues to live on `self`. The scope doesn't carry it.
- Review mode stays main-conversation-only. `_build_and_set_review_context` is only called from the main scope's `_stream_chat` path, gated on `self._review_active`.

## Progress log

(Update after each step lands.)

- **Step 1** — delivered. `ConversationScope` dataclass added at module scope in `src/ac_dc/llm_service.py` alongside the `ArchivalAppend` type alias. `_default_scope()` helper method on `LLMService` builds a scope from `self` with a closure wrapping `HistoryStore.append_message`. No call sites use the new machinery yet.
- **Step 2** — delivered. `_stream_chat` gained a keyword-only `scope: ConversationScope | None` parameter, defaulting to `None` with an inline fallback that calls `self._default_scope()` for safety during mid-refactor development. Every per-conversation read inside the method body (user and assistant message persistence, `filesChanged` broadcast, review-context clear, lazy-init mode check, fall-back-to-flat diagnostic) now goes through `scope.*`. `chat_streaming` builds the default scope explicitly and threads it to `_stream_chat`. Callees (`_post_response`, `_sync_file_context`, `_build_and_set_review_context`, `_detect_and_fetch_urls`, `_build_tiered_content`, `_assemble_tiered`, `_assemble_messages_flat`, `_build_completion_result`) still read per-conversation state from `self.*` directly — they get threaded the scope in subsequent steps. For the default-scope case `scope.X` resolves to the same object as `self._X`, so every test passes unchanged.
- **Step 3** — delivered. `_post_response` gained an optional `scope: ConversationScope | None` parameter with an inline `_default_scope()` fallback. The compaction path now reads history through `scope.context`, purges history on `scope.tracker`, appends the compaction system event via `scope.context.add_message`, and persists it via `scope.archival_append(..., session_id=scope.session_id)` instead of the direct `self._history_store.append_message(session_id=self._session_id, ...)`. `_stream_chat` passes the scope through. The `_update_stability` and `_print_post_response_hud` calls remain reading from `self.*` — `_update_stability` gets scope threading in Step 4; the HUD diagnostic continues to operate on shared infrastructure. For the default-scope case every `scope.X` resolves to the same object, so the existing compaction tests (TestCompactionSystemEvent, TestTurnIdPropagation.test_compaction_event_inherits_turn_id) pass unchanged.
- **Step 4** — delivered. `_update_stability` gained an optional `scope: ConversationScope | None` parameter with an inline `_default_scope()` fallback. Every per-conversation read migrated: Step 0a's defensive excluded-files removal runs against `scope.tracker`; Step 0b's system-prompt hash uses `scope.context.mode` for the code/doc dispatch; Step 1's selected-files full-content loop iterates `scope.selected_files` and reads content via `scope.context.file_context`; Step 2's index-block removal for selected files runs against `scope.tracker` and `scope.selected_files`; Step 3's primary-index dispatch reads `scope.context.mode` and uses `scope.selected_files` for exclusion; Step 4's cross-reference branch reads `scope.context.mode` (the `self._cross_ref_enabled` toggle stays on self as shared UI state); Step 5's history loop uses `scope.context.get_history()`; Step 6's tracker update call site is `scope.tracker.update(...)`. The `_post_response` call site updated to pass `scope` through. Shared infrastructure reads — `self._excluded_index_files`, `self._symbol_index`, `self._doc_index`, `self._repo`, `self._config`, `self._counter`, `self._cross_ref_enabled` — continue via `self`. For the default-scope case every `scope.X` resolves to the same object as `self._X`, so the existing stability-tracker tests pass unchanged.
- **Step 5** — delivered. `_sync_file_context` gained an optional `scope: ConversationScope | None` parameter with an inline `_default_scope()` fallback. The method body now reads the file context via `scope.context.file_context` and the selection via `scope.selected_files`; `self._repo` stays on self (shared infrastructure — the single repo handle services every conversation). The `_stream_chat` call site updated to pass `scope` through. `get_context_breakdown` continues to call `_sync_file_context()` without an explicit scope argument — it operates on the main conversation's state by design, and the default-scope fallback keeps its behaviour identical. The call site is intentionally NOT changed so the breakdown remains a main-conversation snapshot. For the default-scope case every `scope.X` resolves to the same object as `self._X`, so existing file-context-sync tests pass unchanged.
- **Step 6** — delivered. Three tier-assembly methods gained optional `scope: ConversationScope | None` parameters with inline `_default_scope()` fallbacks. `_build_tiered_content` reads `scope.tracker` for item iteration, `scope.context.get_history()` for history lookup, `scope.context.file_context.get_content(...)` for `file:` prefix content, and `scope.selected_files` for the selected-set filter. `_assemble_tiered` reads `scope.selected_files` for the exclusion set base, `scope.context.mode` for the primary/secondary legend dispatch, and delegates to `scope.context.assemble_tiered_messages(...)` for final message assembly. `_assemble_messages_flat` reads `scope.context.get_system_prompt()`, `scope.context.mode`, `scope.context.get_url_context()`, `scope.context.get_review_context()`, `scope.context.file_context.format_for_prompt()`, `scope.context.get_history()`, and `scope.selected_files` for the flat-fallback path. Shared infrastructure reads — `self._config`, `self._symbol_index`, `self._doc_index`, `self._repo`, `self._excluded_index_files`, `self._cross_ref_enabled` — continue via `self`. The three call sites in `_stream_chat` (`_build_tiered_content(scope)`, `_assemble_messages_flat(message, images, scope)`, `_assemble_tiered(message, images, tiered_content, scope)`) updated to pass `scope` through. For the default-scope case every `scope.X` resolves to the same object as `self._X`, so existing tier-assembly tests pass unchanged.
- **Step 7** — delivered. `_detect_and_fetch_urls` gained an optional `scope: ConversationScope | None` parameter with an inline `_default_scope()` fallback. The final `set_url_context` / `clear_url_context` calls now target `scope.context` so an agent scope receives the formatted URL block in its own ContextManager. The `_url_service` stays on `self` — it's session-scoped by design per specs4/7-future/parallel-agents.md (the fetched dict is shared across agents within a turn so provider rate limits and deduplication work across the turn). `_aux_executor` and `_main_loop` also stay on self (shared executor pool, shared event loop reference). Progress event broadcasts (`compactionEvent` stages `url_fetch` / `url_ready`) go through the shared `_broadcast_event_async` helper. The `_stream_chat` call site updated to pass `scope=scope` through. For the default-scope case `scope.context` is `self._context`, so existing URL-integration tests pass unchanged.
- **Step 8** — delivered. `_build_completion_result` gained an optional `scope: ConversationScope | None` parameter with an inline `_default_scope()` fallback. Three migrations: the in-context-check read `set(self._selected_files)` → `set(scope.selected_files)`; the auto-add-to-selection mutation `self._selected_files.append(path)` → `scope.selected_files.append(path)`; and the file-context loads for auto-added + modified-files refresh `self._file_context.add_file(path)` → `scope.context.file_context.add_file(path)` (with the module-local `file_context` binding for the hot loop). Shared infrastructure continues to live on `self`: `_review_active` (main-conversation-only per spec — agents never enter review), `_edit_pipeline` (single shared pipeline handle serialised by the repo layer's per-path mutex), and `_last_error_info` (single-stream-guard side channel). The `_stream_chat` call site updated to pass `scope=scope` through. For the default-scope case every `scope.X` resolves to the same object as `self._X`, so existing edit-pipeline integration tests (TestStreamingWithEdits — 20+ tests covering modify, create, auto-add-to-selection, not-in-context, review-mode gate, dirty-file refresh) pass unchanged.
- **Step 9** — delivered. `_build_and_set_review_context` gained an optional `scope: ConversationScope | None` parameter with an inline `_default_scope()` fallback. Two migrations: the reverse-diff inclusion loop `for path in self._selected_files` → `for path in scope.selected_files`, and the attachment write `self._context.set_review_context(review_text)` → `scope.context.set_review_context(review_text)`. Shared infrastructure continues to live on self: `_review_state` (session-scoped review metadata populated by start_review), `_review_active` (main-only per specs4/4-features/code-review.md — agents never enter review), `_repo` (shared git handle). The `_stream_chat` call site updated to pass `scope` through. Review mode's main-conversation-only invariant means in practice this method only ever runs against the main scope today; threading scope through is a consistency matter for the refactor, making the per-conversation reads explicit at the method boundary. For the default-scope case every `scope.X` resolves to the same object as `self._X`, so existing review tests (TestReview.test_streaming_injects_review_context, test_streaming_without_review_clears_context) pass unchanged. `_stream_chat`'s refactor-status docstring updated to reflect that all per-conversation callees now take scope explicitly.
- **Step 10** — not yet started
- **Step 11** — not yet started

## If we get cut off

Check the progress log above. The last completed step is the last one marked "delivered `<hash>`". Pick up from the first "not yet started". Read the relevant section of `src/ac_dc/llm_service.py` fresh — don't reconstruct from memory.

The refactor is additive until step 10: at each step, the previous state still works. If mid-step is uncertain, revert to the previous step's last-known-good point (or run the test suite to verify where you are) and re-do the partial step.
