# Reference: RPC Method Signatures

**Supplements:** `specs4/1-foundation/rpc-inventory.md`

The behavioral inventory in specs4 lists every RPC method with a one-line purpose. This twin pins the argument and return shapes — what the caller passes, what comes back, and the envelope conventions that surround every call.

## Byte-level formats

### Request ID format

Browser-generated, correlates streaming callbacks to the originating request.

```
{epoch_ms}-{6-char-alphanumeric}
```

See `specs-reference/3-llm/streaming.md` § Request ID format for the full format specification. The RPC layer treats these as opaque strings.

### Response envelope shape

Every jrpc-oo call returns a wrapped object. Single-remote responses have exactly one key:

```json
{"<method_name>": <actual_return_value>}
```

Multi-remote responses (broadcasts to multiple connected clients) have one key per remote, keyed by the remote's UUID:

```json
{
  "uuid-client-1": <return_value_from_client_1>,
  "uuid-client-2": <return_value_from_client_2>
}
```

The `rpcExtract` helper takes the first and only key from a single-key response or the first key from a multi-key response when broadcast is in play. Callers that explicitly need multi-remote results bypass the helper and read all values directly.

### Restricted error shape

Methods guarded by `_check_localhost_only()` return this exact dict shape to non-localhost callers in collaboration mode:

```json
{
  "error": "restricted",
  "reason": "<human-readable explanation>"
}
```

The `error` field is always the literal string `"restricted"`. The `reason` varies by method (e.g., `"Participants cannot perform this action"`, `"Only the host can commit"`). Frontend components check `result?.error === "restricted"` to decide whether to show a warning toast or hide the UI affordance.

In single-user mode (no collab instance attached), `_check_localhost_only()` returns `None` and methods proceed normally. All callers are treated as localhost.

## Schemas

### Service: Repo — browser → server

File I/O:

| Method | Arguments | Return |
|---|---|---|
| `Repo.get_file_content` | `path: str, version?: str` | `str` — file content; `version` is e.g. `"HEAD"` for committed content |
| `Repo.write_file` | `path: str, content: str` | `{status: str}` |
| `Repo.create_file` | `path: str, content: str` | `{status: str}` or error if file exists |
| `Repo.file_exists` | `path: str` | `bool` |
| `Repo.is_binary_file` | `path: str` | `bool` |
| `Repo.get_file_base64` | `path: str` | `{data_uri: str}` — full `data:{mime};base64,{content}` URI |
| `Repo.delete_file` | `path: str` | `{status: str}` |

Git staging:

| Method | Arguments | Return |
|---|---|---|
| `Repo.stage_files` | `paths: list[str]` | `{status: str}` |
| `Repo.unstage_files` | `paths: list[str]` | `{status: str}` |
| `Repo.discard_changes` | `paths: list[str]` | `{status: str}` |
| `Repo.stage_all` | — | `{status: str}` |

Rename:

| Method | Arguments | Return |
|---|---|---|
| `Repo.rename_file` | `old_path: str, new_path: str` | `{status: str}` |
| `Repo.rename_directory` | `old_path: str, new_path: str` | `{status: str}` |

Tree and listing:

| Method | Arguments | Return |
|---|---|---|
| `Repo.get_file_tree` | — | `{tree: FileNode, modified: list[str], staged: list[str], untracked: list[str], deleted: list[str], diff_stats: dict[str, {additions: int, deletions: int}]}` |
| `Repo.get_flat_file_list` | — | `str` — newline-separated sorted file paths |

The `FileNode` shape:

```pseudo
FileNode:
    name: string
    path: string
    type: "file" | "dir"
    lines: integer          // 0 for binary and directories
    mtime: float?            // files only
    children: FileNode[]?   // directories only
```

Diffs:

| Method | Arguments | Return |
|---|---|---|
| `Repo.get_staged_diff` | — | `str` — unified diff |
| `Repo.get_unstaged_diff` | — | `str` — unified diff |
| `Repo.get_diff_to_branch` | `branch: str` | `{diff: str}` or `{error: str}` |

Commits:

| Method | Arguments | Return |
|---|---|---|
| `Repo.commit` | `message: str` | `{sha: str, message: str}` |
| `Repo.reset_hard` | — | `{status: str}` |
| `Repo.search_commits` | `query: str, branch?: str, limit?: int` | `list[{sha, short_sha, message, author, date}]` |

Branches:

| Method | Arguments | Return |
|---|---|---|
| `Repo.get_current_branch` | — | `{branch: str \| null, sha: str, detached: bool}` |
| `Repo.list_branches` | — | `{branches: list[{name, sha, message, is_current}], current: str}` |
| `Repo.list_all_branches` | — | `list[{name, sha, is_current, is_remote}]` sorted by recency, deduplicated |
| `Repo.resolve_ref` | `ref: str` | `str \| null` — full SHA or null if unresolvable |
| `Repo.is_clean` | — | `bool` |

Commit graph:

| Method | Arguments | Return |
|---|---|---|
| `Repo.get_commit_graph` | `limit?: int, offset?: int, include_remote?: bool` | `{commits: list[...], branches: list[...], has_more: bool}` |
| `Repo.get_commit_log` | `base: str, head?: str, limit?: int` | `list[{sha, short_sha, message, author, date}]` |
| `Repo.get_commit_parent` | `commit: str` | `{sha: str, short_sha: str}` |
| `Repo.get_merge_base` | `ref1: str, ref2?: str` | `{sha: str, short_sha: str}` or `{error: str}` |

Commit graph entry shape:

```pseudo
CommitGraphEntry:
    sha: string
    short_sha: string
    message: string
    author: string
    date: string                 // ISO timestamp
    relative_date: string        // "2 days ago"
    parents: list[string]        // parent SHAs
```

Review:

| Method | Arguments | Return |
|---|---|---|
| `Repo.checkout_review_parent` | `branch: str, base_commit: str` | `{branch, branch_tip, base_commit, parent_commit, original_branch, phase: "at_parent"}` or `{error}` |
| `Repo.setup_review_soft_reset` | `branch_tip: str, parent_commit: str` | `{status: "review_ready"}` |
| `Repo.exit_review_mode` | `branch_tip: str, original_branch: str` | `{status: "restored"}` or `{error}` |
| `Repo.get_review_changed_files` | — | `list[{path, status, additions, deletions}]` |
| `Repo.get_review_file_diff` | `path: str` | `{path: str, diff: str}` |

Search:

| Method | Arguments | Return |
|---|---|---|
| `Repo.search_files` | `query: str, whole_word?: bool, use_regex?: bool, ignore_case?: bool, context_lines?: int` | `list[{file: str, matches: list[SearchMatch]}]` |

Search match shape:

```pseudo
SearchMatch:
    line_num: integer
    line: string
    context_before: list[{line_num: integer, line: string}]
    context_after: list[{line_num: integer, line: string}]
```

TeX preview:

| Method | Arguments | Return |
|---|---|---|
| `Repo.is_make4ht_available` | — | `bool` |
| `Repo.compile_tex_preview` | `content: str, file_path?: str` | `{html: str}` or `{error: str, log?: str, install_hint?: str}` |

### Service: LLMService — browser → server

State:

| Method | Arguments | Return |
|---|---|---|
| `LLMService.get_current_state` | — | `CurrentState` (see below) |
| `LLMService.set_selected_files` | `files: list[str]` | `list[str]` — filtered list (non-existent paths removed) |
| `LLMService.get_selected_files` | — | `list[str]` |
| `LLMService.set_excluded_index_files` | `files: list[str]` | `list[str]` |
| `LLMService.get_excluded_index_files` | — | `list[str]` |

`CurrentState` shape:

```pseudo
CurrentState:
    messages: list[MessageDict]
    selected_files: list[string]
    excluded_index_files: list[string]
    streaming_active: bool
    session_id: string
    repo_name: string
    init_complete: bool
    mode: "code" | "doc"
    cross_ref_ready: bool
    cross_ref_enabled: bool
    doc_convert_available: bool
    review_state?: ReviewState        // present when review is active
    enrichment_status: "unavailable" | "pending" | "building" | "complete"
```

`MessageDict` shape matches the JSONL record schema in `specs-reference/3-llm/history.md` § JSONL record schema. For in-memory use, the `id`, `session_id`, and `timestamp` fields may be absent; the core triad is `{role, content, system_event?}`.

Streaming:

| Method | Arguments | Return |
|---|---|---|
| `LLMService.chat_streaming` | `request_id: str, message: str, files?: list[str], images?: list[str], excluded_urls?: list[str]` | `{status: "started"}` — immediately; content arrives via `streamChunk`/`streamComplete` events |
| `LLMService.cancel_streaming` | `request_id: str` | `{status: str}` or `{error: str}` |

Images in the `chat_streaming` call are base64 data URIs. The synchronous return is `{status: "started"}`; actual response delivery is via server-push events.

`excluded_urls` is the per-turn exclusion set from the chip UI's include checkbox. Fetched URLs the user has unchecked are omitted from the prompt's URL section for that turn via `URLService.format_url_context(excluded=…)`. The URLs stay in the service's session-scoped fetched dict — chips remain visible and can be re-included on a later turn by re-checking the box. See `specs4/4-features/url-content.md` § URL Chips UI for the chip-state lifecycle.

Sessions:

| Method | Arguments | Return |
|---|---|---|
| `LLMService.new_session` | — | `{session_id: str}` |
| `LLMService.history_new_session` | — | `{session_id: str}` — alias for `new_session` |
| `LLMService.load_session_into_context` | `session_id: str` | `{messages: list[MessageDict], session_id: str}` |
| `LLMService.history_list_sessions` | `limit?: int` | `list[SessionSummary]` — see `specs-reference/3-llm/history.md` § Session summary shape |
| `LLMService.history_get_session` | `session_id: str` | `list[MessageDict]` — full messages with metadata |
| `LLMService.history_search` | `query: str, role?: str, limit?: int` | `list[{session_id, message_id, role, content_preview, timestamp}]` |
| `LLMService.get_history_status` | — | `{tokens: int, max: int, percent: int, session_count: int}` |

Commit workflow:

| Method | Arguments | Return |
|---|---|---|
| `LLMService.generate_commit_message` | `diff_text: str` | `str` |
| `LLMService.commit_all` | — | `{status: "started"}` — commit runs in background; result broadcast via `commitResult` event |
| `LLMService.reset_to_head` | — | `{status: str, system_event_message: str}` |

Context inspection:

| Method | Arguments | Return |
|---|---|---|
| `LLMService.get_context_breakdown` | — | `ContextBreakdown` (see below) |
| `LLMService.get_file_map_block` | `path: str` | `{path: str, content: str, mode: "code" \| "doc"}` or `{error: str}` |
| `LLMService.rebuild_cache` | — | `{status: "rebuilt", mode, items_before, items_after, tier_counts, file_tier_counts, message}` or `{error: str}` |

`ContextBreakdown` shape:

```pseudo
ContextBreakdown:
    model: string
    total_tokens: integer
    max_input_tokens: integer
    blocks: list[TierBlock]
    breakdown: CategoryBreakdown
    session_totals: {prompt_tokens, completion_tokens, cache_read_tokens, cache_write_tokens}
    mode: "code" | "doc"
    cross_ref_enabled: bool

TierBlock:
    tier: "L0" | "L1" | "L2" | "L3" | "active"
    tokens: integer
    items: list[TrackedItemView]

CategoryBreakdown:
    system: integer
    symbol_map: integer
    files: integer
    urls: integer
    history: integer
```

Mode:

| Method | Arguments | Return |
|---|---|---|
| `LLMService.get_mode` | — | `{mode, doc_index_ready, doc_index_building, cross_ref_ready, cross_ref_enabled, enrichment_status}` |
| `LLMService.switch_mode` | `mode: "code" \| "doc"` | `{mode: str, message?: str, building?: bool, keywords_available?: bool, keywords_message?: str}` or `{error: str}` |
| `LLMService.set_cross_reference` | `enabled: bool` | `{status: str, cross_ref_enabled: bool, message?: str}` |

Review:

| Method | Arguments | Return |
|---|---|---|
| `LLMService.check_review_ready` | — | `{clean: bool, message?: str}` |
| `LLMService.get_commit_graph` | `limit?: int, offset?: int, include_remote?: bool` | Same shape as `Repo.get_commit_graph` — this is a delegation endpoint |
| `LLMService.start_review` | `branch: str, base_commit: str` | `{status: "review_active", branch, base_commit, commits, changed_files, stats}` or `{error: str}` |
| `LLMService.end_review` | — | `{status: "restored"}` or `{error: str, status?: "partial"}` |
| `LLMService.get_review_state` | — | `ReviewState` or `{active: false}` |
| `LLMService.get_review_file_diff` | `path: str` | `{path: str, diff: str}` |
| `LLMService.get_snippets` | — | `list[{icon: str, tooltip: str, message: str}]` — mode-aware |

`ReviewState` shape:

```pseudo
ReviewState:
    active: bool
    branch?: string
    base_commit?: string
    branch_tip?: string
    commits?: list[CommitGraphEntry]
    changed_files?: list[{path, status, additions, deletions}]
    stats?: {commit_count, files_changed, additions, deletions}
```

URL handling:

| Method | Arguments | Return |
|---|---|---|
| `LLMService.detect_urls` | `text: str` | `list[{url: str, type: str, display_name: str}]` |
| `LLMService.fetch_url` | `url: str, use_cache?: bool, summarize?: bool, summary_type?: str, user_text?: str` | `URLContent` dict |
| `LLMService.detect_and_fetch` | `text: str, use_cache?: bool, summarize?: bool` | `list[URLContent]` |
| `LLMService.get_url_content` | `url: str` | `URLContent` — may have `error: "URL not yet fetched"` sentinel |
| `LLMService.invalidate_url_cache` | `url: str` | `{status: str}` |
| `LLMService.remove_fetched_url` | `url: str` | `{status: str}` |
| `LLMService.clear_url_cache` | — | `{status: str}` |

LSP:

| Method | Arguments | Return |
|---|---|---|
| `LLMService.lsp_get_hover` | `path: str, line: int, col: int` | `{contents: str}` — 1-indexed coordinates |
| `LLMService.lsp_get_definition` | `path: str, line: int, col: int` | `{file: str, range: Range}` |
| `LLMService.lsp_get_references` | `path: str, line: int, col: int` | `list[{file: str, range: Range}]` |
| `LLMService.lsp_get_completions` | `path: str, line: int, col: int, prefix?: str` | `list[{label: str, kind: str, detail: str}]` |

`Range` shape uses 1-indexed line/column:

```pseudo
Range:
    start: {line: integer, character: integer}
    end: {line: integer, character: integer}
```

Navigation and TeX:

| Method | Arguments | Return |
|---|---|---|
| `LLMService.navigate_file` | `path: str` | `{status: str, path: str}` — broadcasts to all clients |
| `LLMService.is_tex_preview_available` | — | `{available: bool, install_hint?: str}` |
| `LLMService.compile_tex_preview` | `content: str, file_path?: str` | `{html: str}` or `{error: str, log?: str, install_hint?: str}` |

### Service: Settings — browser → server

| Method | Arguments | Return |
|---|---|---|
| `Settings.get_config_content` | `type: str` | `str` — raw file content |
| `Settings.save_config_content` | `type: str, content: str` | `{status: str}` |
| `Settings.reload_llm_config` | — | `{status: str}` |
| `Settings.reload_app_config` | — | `{status: str}` |
| `Settings.get_config_info` | — | `{model: str, smaller_model: str, config_dir: str}` |
| `Settings.get_snippets` | — | `list[{icon: str, tooltip: str, message: str}]` |
| `Settings.get_review_snippets` | — | `list[{icon: str, tooltip: str, message: str}]` |

The `type` argument is a whitelisted identifier — not a file path. See `specs4/1-foundation/configuration.md` for the whitelist.

### Service: Collab — browser → server

Only registered when `--collab` is passed on the command line.

| Method | Arguments | Return |
|---|---|---|
| `Collab.admit_client` | `client_id: str` | `{ok: true, client_id: str}` |
| `Collab.deny_client` | `client_id: str` | `{ok: true, client_id: str}` |
| `Collab.get_connected_clients` | — | `list[{client_id, ip, role, is_localhost}]` |
| `Collab.get_collab_role` | — | `{role: "host" \| "participant", is_localhost: bool, client_id: str}` |
| `Collab.get_share_info` | — | `{ips: list[str], port: int}` |

### Service: DocConvert — browser → server

| Method | Arguments | Return |
|---|---|---|
| `DocConvert.scan_convertible_files` | — | `list[{path, name, size, status, output_path}]` |
| `DocConvert.convert_files` | `paths: list[str]` | `{status: "started"}` — progress via `docConvertProgress` events; results via final event |
| `DocConvert.is_available` | — | `bool` |

### Service: AcApp — server → browser (client-side callbacks)

Methods the server calls on connected browsers. Each returns `true` as an acknowledgement unless otherwise noted.

Streaming:

| Method | Arguments | Return |
|---|---|---|
| `AcApp.streamChunk` | `request_id: str, content: str` | `true` |
| `AcApp.streamComplete` | `request_id: str, result: StreamCompleteResult` | `true` |
| `AcApp.compactionEvent` | `request_id: str, event: {stage, ...}` | `true` |

See `specs-reference/3-llm/streaming.md` for `StreamCompleteResult` and per-stage `compactionEvent` payload shapes.

Broadcasts:

| Method | Arguments | Return |
|---|---|---|
| `AcApp.filesChanged` | `selected_files: list[str]` | `true` |
| `AcApp.userMessage` | `data: {content: str}` | `true` |
| `AcApp.commitResult` | `result: {sha, short_sha, message, status, error?}` | `true` |
| `AcApp.modeChanged` | `data: {mode: str, cross_ref_enabled?: bool}` | `true` |
| `AcApp.sessionChanged` | `data: {session_id: str, messages: list[MessageDict]}` | `true` |

Startup:

| Method | Arguments | Return |
|---|---|---|
| `AcApp.startupProgress` | `stage: str, message: str, percent: int` | `true` |

Navigation:

| Method | Arguments | Return |
|---|---|---|
| `AcApp.navigateFile` | `data: {path: str}` | `true` |

Collaboration:

| Method | Arguments | Return |
|---|---|---|
| `AcApp.admissionRequest` | `data: {client_id, ip, requested_at}` | `true` |
| `AcApp.admissionResult` | `data: {client_id, ip, admitted, replaced?}` | `true` |
| `AcApp.clientJoined` | `data: {client_id, ip, role, is_localhost}` | `true` |
| `AcApp.clientLeft` | `data: {client_id, ip, role}` | `true` |
| `AcApp.roleChanged` | `data: {role, reason}` | `true` |

Doc convert:

| Method | Arguments | Return |
|---|---|---|
| `AcApp.docConvertProgress` | `data: {...}` — shape varies by progress stage | `true` |

## Dependency quirks

### RPC prefix derivation from Python class name

`server.add_class(instance)` derives the RPC namespace from `type(instance).__name__` — the Python class name, not the variable name. So `server.add_class(llm_service)` where `llm_service` is an instance of `LLMService` produces RPC endpoints like `LLMService.chat_streaming`, not `llm_service.chat_streaming`.

This differs from the browser side's `addClass(this, 'AcApp')` which takes an explicit namespace string as the second argument. On the server, passing a second argument to `add_class()` either raises or silently overrides the derived name — the codebase never passes a second argument.

### jrpc-oo `this.server` vs `this.call` on the browser

Browser-side has two calling mechanisms:

- `this.server['ClassName.method'](args)` — calls one remote, returns the direct result. Fails with "More than one remote has this RPC" when multiple remotes expose the same method.
- `this.call['ClassName.method'](args)` — calls every connected remote that has the method, returns `{uuid: result, ...}`.

The AC⚡DC codebase uses `this.call` exclusively via the `rpcExtract` helper. The `this.server` path is legacy and unreliable when collaboration mode has multiple connected clients (which is always, from the server's perspective — it sees one remote per browser).

### `addClass(this, 'AcApp')` name is load-bearing

The browser-side registration name must match exactly what the server-side call site uses:

```python
# server calls:
await call["AcApp.streamChunk"](request_id, content)
```

```javascript
// browser registers:
this.addClass(this, 'AcApp');
```

A mismatch means the server's call resolves to no handler and silently fails (jrpc-oo does not error on unknown method names from server→browser calls — it just drops the call).

### Arguments wrapping

When the browser calls `this.server['MyApi.add'](3, 5)`, jrpc-oo serializes the arguments as:

```json
{"args": [3, 5]}
```

The Python side's `ExposeClass` unwraps this — the handler sees normal parameters `def add(self, a, b)`. No manual unwrapping needed on either end.

## Cross-references

- Behavioral inventory with method purposes and grouping: `specs4/1-foundation/rpc-inventory.md`
- Connection lifecycle, reconnection, streaming patterns: `specs4/1-foundation/rpc-transport.md`
- Streaming payload shapes (`streamChunk`, `streamComplete`, `compactionEvent`): `specs-reference/3-llm/streaming.md`
- Message dict schema stored in history: `specs-reference/3-llm/history.md` § JSONL record schema
- Edit result shapes in `streamComplete.result.edit_results`: `specs-reference/3-llm/edit-protocol.md` § Per-block result
- Collaboration restriction policy and admission flow: `specs4/4-features/collaboration.md`