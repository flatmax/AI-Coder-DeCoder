# RPC Method Inventory

**Status:** stub

Authoritative catalog of every RPC method in the system. Other specs reference methods by name rather than re-listing them.

## Structure

- Methods are grouped by registered service (Repo, LLMService, Settings, Collab, DocConvert, AcApp)
- Each entry records: name, direction (browser→server or server→browser), purpose, arguments, return shape, localhost-only flag
- Restricted methods (localhost-only in collaboration mode) are flagged explicitly

## Service: Repo (browser → server)

- File I/O — get content (optionally at a version), write, create, exists, is-binary, base64 encode, delete
- Git staging — stage, unstage, discard changes
- File manipulation — rename file, rename directory
- Tree and listing — full file tree with git status, flat sorted file list
- Diffs — staged, unstaged, to-branch (two-dot), for a single review file
- Branches — current, list, list-all (local + remote), resolve ref, commit graph (paginated), commit log range, parent of commit, merge-base
- Commits — commit, reset-hard, search commits, stage-all
- Review support — setup soft reset, exit review mode, changed files in review
- Clean check — working tree cleanliness
- Search — grep with regex / whole-word / ignore-case / context-lines flags
- TeX preview — make4ht availability check, compile to HTML

## Service: LLMService (browser → server)

- State — current state snapshot (messages, selected files, excluded index files, streaming flag, session id, repo name, init flag, mode, cross-ref state, doc-convert availability)
- File selection — set, get, set-excluded, get-excluded
- Streaming — start streaming chat, cancel streaming
- Sessions — new session, load session into context, list sessions, get session messages, search history, get history status
- Commit workflow — generate commit message, commit-all (background)
- Reset — reset-to-HEAD (records system event)
- Context inspection — context breakdown (tiers, categories, session totals), file map block (symbol or doc block for a path), manual cache rebuild (wipe + redistribute tier assignments; localhost-only)
- Snippets — current snippets (mode-aware), review-specific snippets
- Review — check ready, start, end, get state, get file diff, delegates to commit graph
- URL handling — detect, fetch, detect-and-fetch, get content, invalidate cache, remove fetched, clear cache
- LSP — hover, definition, references, completions (coordinates are 1-indexed)
- Mode — get, switch, set cross-reference
- Navigation — broadcast file navigation to all clients
- TeX — availability, compile

## Service: Settings (browser → server)

- Config read — get content for a whitelisted config type
- Config write — save content (triggers reload for reloadable types)
- Explicit reload — LLM config, app config
- Info — current model names and config paths
- Snippets — get standard or review-specific (direct access, bypasses mode logic)

## Service: Collab (browser → server, registered only with collaboration flag)

- Admission — admit pending client, deny pending client
- Registry — list connected clients
- Self-query — get own role (host/participant, localhost flag, client id)
- Share info — LAN IPs and WebSocket port for share URL construction

## Service: DocConvert (browser → server)

- Availability — dependency status (markitdown, LibreOffice, PyMuPDF, combined PDF pipeline)
- Scan — list convertible files with status badges (new, stale, current, conflict)
- Convert — start batch conversion (returns `{status: "started"}`, streams progress)

## Service: AcApp (server → browser)

- Streaming — chunk, complete, compaction/progress event
- Broadcast — files changed, user message, commit result, mode changed, session changed
- Startup — progress
- Navigation — navigate file
- Collaboration — admission request, admission result, client joined, client left, role changed
- Doc convert — progress updates

## Restriction Policy

- Every mutating method on LLMService, Repo, Settings, DocConvert checks caller's localhost status
- Non-localhost participants in collaboration mode receive `{error: "restricted", reason: ...}` for restricted calls
- Single-user mode (no collaboration flag) treats all callers as localhost

## Method Naming Convention

- Service class name becomes the RPC namespace
- Method name follows after a dot (e.g., `Repo.get_file_content`)
- Registered-in-browser methods follow the same pattern (e.g., `AcApp.streamChunk`)

## Invariants

- Every method listed here is implemented exactly once on exactly one service
- No mutating method is callable by a non-localhost participant
- Adding a new RPC method requires updating this inventory