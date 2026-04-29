# Glossary

Authoritative definitions of terms used across the spec suite. When a spec uses one of these terms, it links here rather than re-defining.

## Caching and Stability

- **Tier** — a stability level assigned to each item the LLM sees. Five levels: L0 (most stable, terminal — no further promotion), L1, L2, L3, active (uncached). Each cached tier maps to one `cache_control` breakpoint in the assembled prompt.
- **Active** — the uncached content rebuilt on every request. New items, recently-changed items, and the current turn's content all live here. Not a cache tier in the provider sense — the prompt contains it directly, without a cache marker.
- **N value** — a per-item counter tracking consecutive unchanged appearances in active context. Incremented each request when the item's content hash matches the previous request; reset to zero on any hash mismatch. Used to decide when an item is stable enough to graduate into a cached tier.
- **Entry N** — the N value assigned when an item enters a cached tier. Items arriving at L3 start with N=3 (the graduation threshold); items promoted to L2 receive N=6; L1 receives N=9; L0 receives N=12. A promoted item does not preserve its source-tier N — it adopts the destination tier's entry N.
- **Promotion threshold** — the N value an item in tier X must reach to become eligible for promotion to tier X−1. Thresholds: active → L3 at N=3, L3 → L2 at N=6, L2 → L1 at N=9, L1 → L0 at N=12. L0 has no threshold (terminal).
- **Graduation** — the specific case of promotion from active into L3 when an item reaches N=3 and the cascade runs.
- **Cascade** — the bottom-up pass (L3 → L2 → L1 → L0) that runs after each LLM response. A tier with an item leaving (demoted or deselected) is "broken"; items from the tier below fill the gap up to the destination tier's capacity. Cascade continues until no tier is broken.
- **Anchoring** — when a tier is below `cache_target_tokens` in total size, the provider won't actually cache it. To avoid wasting a breakpoint, the tracker "anchors" (freezes N and prevents promotion) enough items in a tier above to keep that tier at least at cache_target. Anchored items don't promote even if their N exceeds the threshold.
- **Broken tier** — a tier whose cache block has been invalidated this cycle (by demotion, deselection, or explicit invalidation). Cascade runs to refill it.
- **Cache target tokens** — the minimum tokens a cache block must contain for the provider to actually cache it. Computed as `max(user_min, model_min) × buffer_multiplier`. Model minimums: 4096 for Opus 4.5/4.6/Haiku 4.5; 1024 for Sonnet and other Claude models. User minimum configurable via `llm.json`; buffer multiplier defaults to 1.1.
- **Ripple promotion** — the chain reaction when cascade promotes an item out of a tier, which leaves that tier broken, which pulls an item up from the tier below, which leaves *that* tier broken, and so on. Can propagate from L3 all the way to L0 in a single cycle.

## Context and Content

- **Active items** — the list of items the tracker considers "in uncached context for this request". Built fresh each request from: selected files' full content, unselected files' index blocks, fetched URL content, non-graduated history messages. Passes into the stability tracker's cascade.
- **File context** — the in-memory map of `{relative_path: content}` for files the user has selected. Separate from the full-repo file tree (which is just paths) and from the symbol/doc index (which is structural only). Populated on-demand from disk via the Repo layer.
- **Working files** — the uncached "Here are the files:" section in the assembled prompt, containing full content of selected files that haven't graduated to a cached tier. Rendered as fenced code blocks without language tags.
- **Index block** — the compact structural description of a single file. For code: the symbol map entry listing classes, functions, methods, imports. For docs: the outline listing headings, keywords, content-type markers, cross-references. Always smaller than full file content; suitable for inclusion in context even when the full file isn't.
- **Symbol map** — the full compact representation of every code file in the repo, assembled from individual symbol index blocks. Appears once in the prompt, typically in L0 (or L1 for large repos). Has a legend at the top abbreviating kinds (`c`/`m`/`f`/`af`/`am`/`v`/`p`/`i`) and path aliases (`@1/`, `@2/`).
- **Doc map** — the equivalent for document files. Same structural role, different extractors and annotations (keywords, content-type markers, incoming reference counts).
- **Legend** — the abbreviation key prepended to a map output so the LLM can decode the compact notation. Includes kind codes, annotation markers, and path aliases.

## Edits

- **Edit block** — the LLM's structured proposal for a file change. Three marker lines bracket two content sections: `🟧🟧🟧 EDIT` (orange squares) starts the old-text section, `🟨🟨🟨 REPL` (yellow squares) separates old from new, `🟩🟩🟩 END` (green squares) closes the block. File path appears on the line immediately before the start marker.
- **Anchor** — the old text inside an edit block. The apply pipeline searches for it in the target file as a contiguous block. Exactly-one match is required for the edit to apply.
- **Ambiguous anchor** — old text that matches multiple locations in the file. The edit fails with a diagnostic; the frontend auto-populates a retry prompt asking the LLM to include more surrounding context.
- **In-context edit** — an edit block targeting a file that is currently in the user's selected-files set. Full content is in context; the LLM saw the actual file and its old-text anchor should be accurate.
- **Not-in-context edit** — an edit block targeting a file the LLM has only seen as an index block (compact map entry), not full content. The apply pipeline marks these as `NOT_IN_CONTEXT`, auto-adds the file to selected files, and the frontend auto-populates a retry prompt.

## Modes

- **Code mode** — primary mode where the symbol index feeds structural context. System prompt emphasizes code navigation, edit protocol, file selection. Snippets are code-oriented.
- **Document mode** — primary mode where the document index feeds structural context. System prompt emphasizes document work, outline awareness, cross-reference linking. Snippets are doc-oriented.
- **Cross-reference mode** — an overlay on either primary mode that adds the *other* index's file blocks alongside the primary. Both legends appear in L0. Tier dispatch is prefix-based (`symbol:` vs `doc:`) so a single tier can contain a mix. Resets to off on every primary mode switch.

## Sessions and History

- **Session** — a grouping of related chat messages identified by a session ID. New session = new ID; loading a previous session = current session ID becomes the loaded one. Session boundaries are the natural unit for history browsing.
- **Compaction** — LLM-driven summarization that runs after the assistant response when conversation history token count exceeds the configured trigger. A smaller model detects the topic boundary; earlier messages are either truncated (hard topic switch, high confidence) or replaced with a generated summary.
- **Verbatim window** — the most recent messages preserved unchanged during compaction. Sized by token count (recent tokens under `verbatim_window_tokens`) and/or message count (at least `min_verbatim_exchanges` recent user messages).
- **Topic boundary** — the message index where the conversation subject shifted, detected by a smaller LLM. Reported with a reason string and a confidence score; compaction logic decides whether to truncate or summarize based on both.
- **System event** — an operational event (commit, reset, mode switch, compaction) recorded as a pseudo-user message with a `system_event: true` flag. Rendered with distinct card styling; included in LLM context so the model knows what happened; persisted in history.

## Collaboration

- **Host** — the first-connected client in a collaboration session; auto-admitted. Only localhost clients can send prompts or mutate state, regardless of host role.
- **Participant** — a subsequently-connected client admitted by the host. Sees the full UI, receives all broadcasts (streaming, file changes, events), but cannot send prompts or mutate state if non-localhost.
- **Localhost client** — a client whose peer IP is loopback (`127.0.0.1`, `::1`) or an address assigned to a local network interface. Localhost status is orthogonal to host/participant role; what matters for restrictions is localhost-ness, not role.
- **Admission** — the approval flow for non-first connections. Raw WebSocket messages (`admission_pending`, `admission_granted`, `admission_denied`) carry the pre-JRPC handshake. A toast appears on every admitted client for the host to accept or deny. 120-second timeout; same-IP requests replace older pending ones.

## Files and Indexing

- **Selected files** — files the user has ticked in the file picker. Full content enters active context; the corresponding index block is excluded from the main symbol/doc map (would be redundant).
- **Excluded files** — files the user has explicitly excluded from indexing (three-state checkbox). No content, no index block, no tracker entry. Used when a doc repo's map alone exceeds the context budget.
- **Index-only file** — the default state for a file: not selected, not excluded. Only its index block appears in context (as part of the symbol map / doc map), not its full content.
- **Reference graph** — the cross-file usage relationships. Code graph: import statements and call sites. Doc graph: heading-anchored links and image embeds. Used for tier initialization (connected components cluster related files into the same tier) and for incoming-ref counts in the compact map output.
- **Connected component** — a cluster of files linked via mutual bidirectional references. The stability tracker uses connected components as the initial grouping for tier distribution — related files tend to be edited together, so they share stability characteristics.

## UI

- **Dialog** — the draggable foreground panel hosting the four tabs (chat, context, settings, doc convert). Resizable, minimizable, persists position to localStorage.
- **Viewer** — the background layer filling the viewport behind the dialog. Hosts the Monaco diff viewer and the SVG viewer as absolutely-positioned siblings; only one is visible at a time. Routed by file extension.
- **Status LED** — the circular indicator in the diff viewer's top-right corner showing save state. Green = clean; orange pulsing = dirty (click to save); cyan = new file.
- **Token HUD** — the floating transient overlay showing per-request token breakdown after each LLM response. Auto-hides after 8 seconds; hover pauses; click ✕ dismisses.
- **File navigation grid** — the 2D spatial graph of files the user has opened. Traversed with Alt+Arrow keys while a fullscreen HUD is visible. Each Alt+Arrow move re-fetches the target file (no per-node cache).

## Protocol

- **RPC** — Remote Procedure Call. JSON-RPC 2.0 running over a single WebSocket connection. Provided by the jrpc-oo library.
- **Bidirectional RPC** — either side (browser or server) can call methods on the other. Browser calls server methods (read files, chat, settings); server pushes events to browser (streaming chunks, completion, broadcasts).
- **Server-push event** — an RPC call initiated by the server and delivered to the browser. Used for streaming content (`streamChunk`), completion notifications (`streamComplete`), progress updates (`compactionEvent`), state broadcasts (`filesChanged`, `modeChanged`, `sessionChanged`, `commitResult`), and collaboration events (`admissionRequest`, `clientJoined`).
- **Request ID** — a correlation token generated by the browser for each streaming request. Format: `{epoch_ms}-{6-char-alnum}`. Used by the frontend to route chunks to the correct streaming card when multiple streams could coexist.
- **Passive stream** — a stream the current client did not initiate; typically a streaming response to a prompt another collaborator sent. The chat panel adopts the stream's request ID and renders its chunks in a streaming card, same as if it had initiated the call.

## Document Conversion

- **Provenance header** — the HTML/XML comment at the top of each converted file recording source filename, SHA-256 of source content, and extracted image filenames. Lets the scanner classify the output as `current` / `stale` / `conflict` without re-running conversion.
- **Clean-tree gate** — the precondition requiring zero uncommitted changes before conversion or review mode can start. Ensures the operation's diffs are clean and attributable.
- **Managed file** — a config file safe to overwrite on release upgrade. Prompts, default settings, snippets. Old version backed up with version suffix.
- **User file** — a config file never touched on upgrade. LLM config (API keys, model choice) and extra system prompt. Only created if missing on first run.

## Review

- **Review mode** — a read-only state presenting a branch's changes via git soft reset. Files on disk show the branch tip; HEAD is at the merge-base; staged changes = the feature branch's changes. File picker, diff viewer, context engine all work unchanged.
- **Merge-base** — the commit where the reviewed branch diverged from the target branch (typically master/main). Review shows changes introduced by the feature branch only, excluding changes that arrived via merge commits from the target.
- **Reverse diff** — the patch showing what would revert a file to its pre-review state. Included in review context for selected files so the LLM can see both the current (reviewed) code and what it replaced.
- **Pre-change symbol map** — the symbol map built at the merge-base commit and included in review context. Lets the LLM compare structural topology before and after the reviewed changes.

## Context and Content

- **Active items** — the list of items in uncached context for the current request
- **File context** — in-memory cache of file contents selected for inclusion
- **Working files** — the uncached file content section in the assembled prompt
- **Index block** — compact structural description of a file (symbol map entry or doc outline)
- **Symbol map** — full compact representation of all code symbols in the repo
- **Doc map** — full compact representation of all document outlines in the repo
- **Legend** — abbreviation key prepended to a map output

## Edits

- **Edit block** — the LLM's structured proposal for a file change, bracketed by `🟧🟧🟧 EDIT` / `🟨🟨🟨 REPL` / `🟩🟩🟩 END` marker lines
- **Anchor** — the old text in an edit block, searched exactly in the file
- **Ambiguous anchor** — old text matching multiple locations in the file
- **In-context edit** — edit targeting a file that is currently selected (full content in context)
- **Not-in-context edit** — edit targeting a file the LLM saw only as an index block

## Modes

- **Code mode** — symbol index feeds context, standard system prompt
- **Document mode** — doc index feeds context, document-focused system prompt
- **Cross-reference mode** — both indexes active, for either primary mode

## Sessions and History

- **Session** — a grouping of related messages with a unique ID
- **Compaction** — history summarization triggered by token threshold
- **Verbatim window** — most recent messages preserved unchanged during compaction
- **Topic boundary** — point where conversation subject shifted, detected by a smaller LLM
- **System event** — operational event (commit, reset, mode switch) recorded as a pseudo-user message

## Collaboration

- **Host** — the first-connected client (auto-admitted)
- **Participant** — a subsequently-connected client (admission-gated)
- **Localhost client** — client whose peer IP is loopback or a local interface
- **Admission** — the approval flow for non-first connections

## Files and Indexing

- **Selected files** — files the user has checked in the file picker (full content in context)
- **Excluded files** — files the user has explicitly excluded from indexing (no content, no index block)
- **Index-only file** — default state (not selected, not excluded) — only the index block is in context
- **Reference graph** — cross-file usage relationships (imports, calls, doc links)
- **Connected component** — cluster of files linked via mutual references

## UI

- **Dialog** — the draggable foreground panel hosting tabs
- **Viewer** — the background diff editor or SVG editor
- **Status LED** — circular indicator on the diff viewer showing save state
- **Token HUD** — floating overlay showing per-request token breakdown
- **File navigation grid** — 2D spatial graph of opened files traversed with Alt+Arrow

## Protocol

- **RPC** — Remote Procedure Call over WebSocket (JSON-RPC 2.0)
- **Bidirectional RPC** — either side can call methods on the other
- **Server-push event** — RPC call initiated by server, delivered to browser
- **Request ID** — correlation token generated by the browser for each streaming request
- **Passive stream** — a stream the current client did not initiate (broadcast from another client's action)

## Document Conversion

- **Provenance header** — HTML/XML comment embedded in converted files recording source file, hash, and extracted assets
- **Clean-tree gate** — precondition requiring no uncommitted changes before conversion or review
- **Managed file** — config file safe to overwrite on upgrade
- **User file** — config file never touched on upgrade

## Review

- **Review mode** — read-only state presenting a branch's changes via git soft reset
- **Merge-base** — commit where the reviewed branch diverged from the target branch
- **Reverse diff** — patch showing what would revert a file to its pre-review state
- **Pre-change symbol map** — symbol map built at the merge-base commit for structural comparison