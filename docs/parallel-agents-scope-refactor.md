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
- **Step 3** — not yet started
- **Step 3** — not yet started
- **Step 4** — not yet started
- **Step 5** — not yet started
- **Step 6** — not yet started
- **Step 7** — not yet started
- **Step 8** — not yet started
- **Step 9** — not yet started
- **Step 10** — not yet started
- **Step 11** — not yet started

## If we get cut off

Check the progress log above. The last completed step is the last one marked "delivered `<hash>`". Pick up from the first "not yet started". Read the relevant section of `src/ac_dc/llm_service.py` fresh — don't reconstruct from memory.

The refactor is additive until step 10: at each step, the previous state still works. If mid-step is uncertain, revert to the previous step's last-known-good point (or run the test suite to verify where you are) and re-do the partial step.
