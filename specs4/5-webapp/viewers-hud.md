# Viewers and Token HUD

Two surfaces that consume the same backend context-breakdown data to show different perspectives on token usage and cache state: the **Context tab** (with Budget and Cache sub-views, persistent while visible) and the **Token HUD** (floating transient overlay triggered after each LLM response). Also covers the terminal HUD printed server-side after each response.
## Shared Backend
Both the Context tab and the Token HUD call the same breakdown RPC. Shared capabilities:

### Per-Context-Manager Breakdown

The breakdown RPC reports on a single context manager. In single-agent operation this is the user-facing context manager — the only instance that exists. A future parallel-agent mode (see [parallel-agents.md](../7-future/parallel-agents.md)) creates additional context managers; the breakdown RPC accepts an optional agent ID parameter to target a specific one, defaulting to the user-facing context when absent.

The Context tab and Token HUD are display-only; they do not drive agent execution. UI decisions (show one aggregate HUD, show per-agent HUDs, or let the user select) are UI concerns deferred to the agent-mode implementation. The backend contract is already agent-ready — the breakdown dispatches by context manager identity, not by session global state.
### FileContext Sync Before Breakdown
- Before computing the breakdown, the server synchronizes the in-memory file context with the current selected-files list
- Removes files no longer selected, loads files newly selected
- Ensures the breakdown reflects what the next LLM request would look like, not a stale snapshot
- Defensively skips binary files and files that don't exist — these are not reported in the breakdown the way the streaming pipeline reports them, so the viewer may show a clean budget while the next actual request would exclude some files
### Tier Content Breakdown (Shared Helper)
A shared helper converts raw tracker items into structured detail dicts for both the frontend context breakdown and the terminal HUD. For each item it classifies the type from the key prefix (system, files, symbols, doc-symbols, history, other), extracts display name and path, and looks up the promotion threshold from the tier config. History items extract a numeric sort index from the key for correct ordering. Result is sorted: system first, then symbols / doc-symbols, files, history, other.
### Mode-Aware Breakdown
Breakdown dispatches to the appropriate index and system prompt based on the current mode:
| Field | Code mode | Document mode |
|---|---|---|
| System tokens | Standard system prompt | Document system prompt |
| Legend tokens | Symbol index legend | Doc index legend |
| Map tokens | Symbol map | Doc map |
| Map file count | Number of indexed code files | Number of indexed doc files |
When cross-reference mode is active, legend tokens include both legends and map tokens include both maps. The file count sums both indexes.
### Breakdown Response Shape
Returned payload:
- Model name
- Current mode string
- Cross-reference enabled flag
- Total tokens and max input tokens
- Cache hit rate (computed locally from tier data: cached tokens / total tokens)
- Per-tier blocks — name, tokens, count, cached flag, contents list
- Category breakdown — system, legend, symbol-map, files, URLs, history — with per-item details for expandable categories
- Recent promotions and demotions
- Session totals — prompt, completion, total, cache read, cache write
A separate provider-cache-rate field is computed from cumulative session data when available; more accurate than the tier-based estimate since it reflects actual provider behavior. HUD and Context tab prefer provider-cache-rate when non-null, falling back to the local rate.
## Context Tab
The Context tab contains two sub-views selectable via a Budget / Cache pill toggle. Active sub-view persisted to localStorage. Both share stale-detection and refresh-on-visible behavior. Both listen for stream-complete, files-changed, and mode-changed window events — when visible, refresh immediately; when hidden, set a stale flag and refresh on next visibility.
### Budget Sub-View
#### Layout
- Header with current model and cache hit rate
- Token budget bar — total used vs maximum
- Stacked horizontal category bar showing proportional size of each category
- Legend row with colored dots and token counts per category
- Expandable category rows with per-item details
- Session totals grid at the bottom
#### Budget Bar Colors
Green when usage is low, yellow when moderate, red when high.
#### Stacked Category Bar
Proportional horizontal bar visualizing relative size of each category. Each segment colored by category:
| Category | Color |
|---|---|
| System | Green |
| Symbol map | Blue |
| Files | Amber |
| URLs | Purple |
| History | Orange |
Legend row shows colored dots with labels and token counts. Only non-zero categories appear. In document mode, the symbol map label adapts (Doc Map, Sym+Docs, or Docs+Sym depending on cross-reference state).
#### Categories
Each category shows name, proportional bar, and token count. Expandable categories toggle to show per-item details:
| Category | Expandable | Detail items |
|---|---|---|
| System prompt | No | — |
| Symbol / doc map | Yes | Per-chunk name and tokens |
| Files | Yes | Per-file path and tokens |
| URLs | Yes | Per-URL with tokens |
| History | No | — |
Categories with zero tokens or no detail items show no toggle.
#### Session Totals
Fixed footer with cumulative session totals — total, prompt in, completion out, cache read, cache write. Cache read highlighted when non-zero; cache write highlighted when non-zero.
### Cache Sub-View
Delegates rendering to an embedded cache-tab component. When switching to the Cache sub-view, the embedded component receives a visibility call to refresh stale data.
#### Cache Performance Header
Summary at top with cache hit rate as a percentage label and a proportional bar. Prefers provider-cache-rate when available, falls back to local rate.
#### Rebuild Button
- A **🔄 Rebuild** button at the top-right of the cache body, above the performance header
- Triggers a server-side cache tier redistribution via the rebuild RPC — see [cache-tiering.md — Manual Cache Rebuild](../3-llm/cache-tiering.md#manual-cache-rebuild)
- Tooltip sells the outcome in user terms, not tier mechanics — e.g., "Rebuild cache — redistribute all symbols/docs into tiers L0-L3. Selected files stay in active context."
- States — idle (🔄 Rebuild), in-flight (⏳ Rebuilding…, disabled), cross-disabled while a concurrent refresh is loading
- On success — toast the server's message string (includes before/after item counts and per-tier distribution) and refresh the cache view
- On restricted (non-localhost) — info toast explaining the localhost-only policy
- On error — error toast with the server's error text; view still refreshes so the user can see current state
- Visible to all clients but the underlying RPC is localhost-only; remote collaborators who click receive the restricted-error toast rather than triggering the rebuild
#### Layout
- Filter input for fuzzy match
- Size / Name sort toggle
- Stale indicator badge
- Refresh button
- Recent changes list (promotions / demotions)
- Per-tier groups with tier totals, cached markers, expandable
- Model and total token footer
#### Content Group Types
| Type | Icon | Detail |
|---|---|---|
| System | — | Token count |
| Legend | — | Token count |
| Symbols | — | File path + stability bar + tokens |
| Doc-symbols | — | File path + stability bar + tokens |
| Files | — | File path + stability bar + tokens |
| URLs | — | Title + tokens |
| History | — | Message count + tokens |
#### Measured vs Unmeasured Items
Within each tier, items split into two groups:
- **Measured items** — non-zero token count, rendered individually with icon, name, token count, stability bar, and N/threshold label
- **Unmeasured items** — zero token count, collapsed into a single summary line "N pre-indexed symbols/documents (awaiting measurement)"
Unmeasured are initialized by the stability tracker from the reference graph but haven't had token counts measured yet. Label adapts — documents in doc mode, symbols in code mode.
#### Mode-Aware Labels
- Code mode — symbol map / pre-indexed symbols
- Document mode — doc map / pre-indexed documents
- Cross-reference mode — both prefixes coexist; icons differentiate symbol and doc items regardless of current mode
#### Stability Bars
Per-item numeric N/threshold label displayed inline, plus proportional fill bar with tier color. Tooltip shows current N and threshold. Only shown for items with an N value (symbols, files). Numeric gives precise progress; bar gives visual summary.
#### Item Click → View Map Block
Clicking an item name opens a modal showing the full index block for that file:
1. Special system keys return the system prompt and legend for the current mode
2. Current mode's index tried first
3. Cross-mode fallback — if primary index has no data, the other index is tried (handles cross-reference mode)
4. Error if neither index has data
Response includes a mode field indicating which index provided the content, so the frontend can apply appropriate formatting.
#### Fuzzy Search
Character-subsequence matching — characters in the query must appear in order within the target but need not be contiguous. Typing `ctx` matches `context.py`, `ContextManager`, `src/ac_dc/context/manager.py`. Case-insensitive. Shares the same algorithm as the file picker's tree filter so users see consistent behavior across surfaces.

- Filter input visible only in the Cache sub-view; empty query shows everything
- Matches against the item's displayed path, falling back to its key name
- Measured items are filtered individually; unmeasured items (aggregated into the "N pre-indexed …" summary line) have no per-item name and survive as long as their tier does
- Tiers with zero measured matches and zero unmeasured items are hidden entirely — the filtered view focuses on hits
- A "No items match …" placeholder appears when every tier is hidden
- Filter auto-expands all surviving tiers during an active search — the user's persisted expand/collapse state is preserved and restored when the filter is cleared
- Per-session only; not persisted to localStorage — a stale filter from a previous session would confuse more than it helps
- Composes independently with sort, refresh, stale-detection, and the rebuild button
#### Sort Toggle
Size / Name toggle button switches between sorting tier contents by token count descending (default) or alphabetically. Active mode persisted to localStorage.
#### Defaults
L0 and active tiers expanded by default; L1/L2/L3 collapsed.
#### Stale Indicator
Badge appears when the tab was hidden during a stream-complete or files-changed event. Auto-refreshes on visibility.
#### Color Palette
Tiers use a warm-to-cool spectrum:
- L0 — green (most stable)
- L1 — teal
- L2 — blue
- L3 — amber
- Active — orange
Token values in monospace. Cache writes highlighted. Errors in warning color.
## Token HUD (Floating Overlay)
Floating overlay on the viewer background, appearing after each LLM response.
### Placement
- Top-level element in the app-shell shadow DOM, sibling of dialog and viewer containers
- Fixed position near a top corner, high z-index
- Uses the RPC mixin to fetch the breakdown independently
- Triggered by a stream-complete window event (filters out error responses)
### Data Flow
1. Stream complete fires — HUD extracts token usage from result for immediate display
2. HUD issues an async breakdown RPC for full data
3. Once full data arrives, all sections render with complete information
### Sections (all collapsible)
| Section | Content |
|---|---|
| Header | Model name, cache hit percentage badge (color-coded), dismiss button |
| Cache tiers | Per-tier proportional bar chart with per-tier sub-items showing icon, name, N/threshold label, stability bar, and token count |
| This request | Prompt tokens, completion tokens, cache read (if > 0), cache write (if > 0) |
| History budget | Total tokens vs max input with usage bar, colored green/yellow/red by percentage |
| Tier changes | Promotions and demotions as individual items |
| Session totals | Prompt in, completion out, total; cache saved and cache written when non-zero |
### Behavior
- Auto-hide after a few seconds, then fade out
- Hover pauses timers; mouse leave restarts auto-hide
- Dismiss button hides immediately
- Fixed width, max-height with scroll
- Error filtering — HUD does not appear for error responses or empty results
- Section collapse state persisted to localStorage (stored as a serialized set of collapsed section names)
## Terminal HUD
Printed server-side after each LLM response (not a UI component). Additionally, a one-time startup HUD is printed when the stability tracker initializes.
### Startup Init HUD
Printed once during server startup after stability tracker initialization completes:
- Boxed per-tier item counts for all non-empty tiers
- Total item count
- Provides immediate visibility into how the reference graph was distributed
### Post-Response HUD
Three sections printed after each LLM response:
#### Cache Blocks (Boxed)
- Per-tier token counts with entry-N threshold and cached marker
- Active tier shows token count only
- Only non-empty tiers listed
- Box auto-sizes to widest line
- Cache hit percentage computed as cached tokens / total tokens
- Each tier line followed by indented sub-item summaries grouped by type (system + legend, N symbols, N files, N history messages)
- Sub-items aggregated by type with count and total tokens per group (uses the shared breakdown helper)
#### Token Usage
- Model name
- Per-category breakdown (system, symbol/doc map, files, history, total)
- Last-request provider-reported input and output tokens
- Cache read and cache write counts (line omitted when both zero)
- Session total — cumulative sum across all requests
Mode-aware labels — "Symbol Map" in code mode, "Doc Map" in document mode. When cross-reference is active, an additional line shows the cross-referenced index's token count.
#### Tier Changes
- One line per change from the stability tracker's change log
- Promotions listed first, then demotions
- Each line shows from-tier, to-tier, and item key
## Invariants
- Budget sub-view and Cache sub-view always reflect the same underlying breakdown data
- Stale indicator always clears when the tab becomes visible and a refresh completes
- File context is synchronized with the selected-files list before every breakdown computation
- Breakdown dispatches to the active mode's index — no cross-mode leakage unless cross-reference mode is enabled
- Token HUD never appears for error responses or empty results
- HUD auto-hide is paused while the mouse is over the HUD; resumes on mouse leave
- Section collapse state in the HUD persists across sessions via localStorage
- Unmeasured tier items are always collapsed into a summary line; never rendered individually
- Map-block modal dispatches to the correct index based on item key prefix, with cross-mode fallback when the primary index has no data
- Terminal HUD is printed after every completed LLM response, whether the stream succeeded or was cancelled
- Startup init HUD is printed exactly once per server start, after stability tracker initialization completes
- Cache sub-view Rebuild button is visible to all clients but rejected server-side for non-localhost callers; the restricted-error toast path is exercised rather than silently allowing a client-side dispatch
- Rebuild button is disabled during both its own in-flight state and a concurrent context-breakdown refresh — the two reads of tracker state never overlap