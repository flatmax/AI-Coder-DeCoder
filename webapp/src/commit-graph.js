// CommitGraph — SVG-rendered git commit graph with
// branch lanes, commit nodes, and disambiguation
// popover for the review selector.
//
// Governing spec: specs4/4-features/code-review.md
// § "Commit Selection via Git Graph".
//
// The component is data-driven from the backend's
// `LLMService.get_commit_graph(limit, offset,
// include_remote)` RPC. The backend returns:
//
//   {
//     commits: [{sha, short_sha, message, author,
//                date, relative_date, parents: [sha, ...]}, ...],
//     branches: [{name, sha, is_current, is_remote}, ...],
//     has_more: bool
//   }
//
// The frontend does ALL the graph drawing work:
// lane assignment (each branch tip gets a stable
// vertical column), commit node placement, parent-
// edge lines (curved for cross-lane, straight
// within a lane), merge-commit second-parent
// connectors.
//
// ---
//
// Lane assignment algorithm:
//
//   1. Branches sorted by most recent commit date
//      get column indices 0, 1, 2, … Leftmost lane
//      = newest branch.
//   2. Each commit's primary lane = its first
//      parent's lane (or a new lane if it's a
//      branch tip with no known parent yet).
//   3. When a branch joins another (its first
//      parent is on a different lane), the
//      joining branch's lane ends — subsequent
//      commits flow in the parent's lane.
//   4. Merge commits draw a curve from the second
//      parent's lane to the merge point's lane.
//
// The walk is strictly forward: iterate commits in
// display order (newest-first), assign each commit
// a lane based on its parents' assignments plus
// branch-tip seed lanes.
//
// ---
//
// Paging:
//
// Initial load fetches 100 commits. As the user
// scrolls near the bottom of the graph, we fetch
// the next 100 with offset=currentCount and append.
// has_more=false from any response stops further
// fetches.
//
// ---
//
// Disambiguation:
//
// A commit can be reachable from multiple branches
// (e.g., shared history before a fork). Clicking a
// commit opens a popover listing candidate branches
// — the walk from each branch tip to the commit
// tells us reachability. The branch whose lane
// matches the commit's column is pre-selected.

import { LitElement, css, html, svg } from 'lit';

// ---------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------
//
// Rendered graph coordinates. The SVG's viewBox
// adapts to the commit count; each commit occupies
// one "row" of _ROW_HEIGHT pixels, and each branch
// lane is _LANE_WIDTH wide.

const _ROW_HEIGHT = 32;
const _LANE_WIDTH = 24;
const _NODE_RADIUS = 6;
const _GRAPH_LEFT_MARGIN = 16;
const _COMMIT_TEXT_OFFSET = 20; // horizontal gap from last lane to text
const _PAGE_SIZE = 100;

// Prefetch threshold — when the user scrolls within
// _PREFETCH_ROWS of the bottom, kick off the next
// page fetch. Keeps the paging smooth: by the time
// the user reaches the end, the next batch is
// already loading.
const _PREFETCH_ROWS = 20;

// ---------------------------------------------------------------
// Lane-color palette
// ---------------------------------------------------------------
//
// Colors cycle through this palette by lane index.
// Chosen for visibility against the app's dark
// background and for legibility when adjacent lanes
// render side-by-side.

const _LANE_COLORS = [
  '#58a6ff', // blue
  '#3fb950', // green
  '#d29922', // amber
  '#f85149', // red
  '#a5a4f6', // violet
  '#ff7b72', // salmon
  '#56d4dd', // cyan
  '#f0883e', // orange
];

function _laneColor(index) {
  return _LANE_COLORS[index % _LANE_COLORS.length];
}

// ---------------------------------------------------------------
// Graph layout computation
// ---------------------------------------------------------------

/**
 * Compute the graph layout from raw commits + branches.
 *
 * Returns an object with:
 *   - rows: [{commit, lane, y, edges: [{fromLane, toLane,
 *             fromY, toY, color, merge: bool}]}, ...]
 *   - totalLanes: max lane index + 1
 *   - branchLanes: Map<branchName, laneIndex>
 *
 * Walk direction: commits[0] is newest, commits[N-1]
 * is oldest. Lane assignments propagate from commit
 * (newer) to its parents (older) — a commit takes
 * the lane its first parent will get, with branch
 * tips seeding new lanes.
 *
 * Since we process commits newest-first but lanes
 * propagate oldest-first, the algorithm is:
 *   1. Pre-seed tip-lanes from branches.
 *   2. For each commit in order, assign its lane:
 *      - If it's a branch tip, use the seeded lane.
 *      - Otherwise, check if any child already
 *        claimed it via its first-parent link —
 *        use that lane.
 *      - If not claimed, allocate a new lane
 *        (unreachable commit or merge-only-parent).
 *   3. For each commit with parents, record lane
 *      assignments for those parents (first parent
 *      inherits, other parents get new lanes if
 *      needed or claim existing tip lanes).
 *
 * We actually iterate newest → oldest and build the
 * assignment as we go. The key observation: when we
 * process a commit, ALL its children (which point at
 * it as a parent) have already been processed, so
 * their claims on its lane are already recorded in
 * a map.
 */
function computeGraphLayout(commits, branches) {
  if (!Array.isArray(commits) || commits.length === 0) {
    return { rows: [], totalLanes: 0, branchLanes: new Map() };
  }
  // Sort branches by the date of their tip commit so
  // the most-recently-active branch gets lane 0.
  const commitBySha = new Map();
  for (const c of commits) {
    if (c && typeof c.sha === 'string') commitBySha.set(c.sha, c);
  }
  const sortedBranches = [...(branches || [])]
    .filter((b) => b && typeof b.sha === 'string')
    .map((b) => {
      const tip = commitBySha.get(b.sha);
      // Parse date for sort — missing dates sort to the end.
      const tipDate = tip?.date ? Date.parse(tip.date) : 0;
      return { ...b, _tipDate: Number.isFinite(tipDate) ? tipDate : 0 };
    })
    .sort((a, b) => b._tipDate - a._tipDate);

  // Tip-lane seeding. Each branch tip gets the next
  // unused lane. Multiple branches at the same tip
  // commit share a lane (first one wins).
  const branchLanes = new Map(); // branchName -> laneIndex
  const tipLaneBySha = new Map(); // tipSha -> laneIndex
  let nextLane = 0;
  for (const b of sortedBranches) {
    if (tipLaneBySha.has(b.sha)) {
      branchLanes.set(b.name, tipLaneBySha.get(b.sha));
    } else {
      const lane = nextLane;
      nextLane += 1;
      tipLaneBySha.set(b.sha, lane);
      branchLanes.set(b.name, lane);
    }
  }

  // Claims map: shaOfCommit -> laneIndex. When a
  // commit is processed, it claims a lane for its
  // first parent's position. We seed this with the
  // tip-lane assignments.
  const claims = new Map();
  for (const [sha, lane] of tipLaneBySha) {
    claims.set(sha, lane);
  }

  // Walk commits newest-first. For each commit:
  //   - Determine its lane (claim from a child,
  //     or the tip seed, or a new lane).
  //   - Record its first parent's claim as the
  //     same lane (so the parent — older, seen
  //     later — uses it).
  //   - Merge parents (second-and-beyond) get
  //     recorded as a secondary edge.
  const rows = [];
  const allocateLane = () => {
    const l = nextLane;
    nextLane += 1;
    return l;
  };

  // Track which lanes are "in use" at each row so we
  // can free up a lane when a branch terminates (its
  // oldest commit is reached and the lane has no
  // further claims). For simplicity we don't
  // compact lanes — a lane once allocated stays at
  // its column. Lane compaction is a polish pass
  // for later.

  for (let i = 0; i < commits.length; i += 1) {
    const commit = commits[i];
    if (!commit || typeof commit.sha !== 'string') continue;
    // Determine this commit's lane.
    let lane;
    if (claims.has(commit.sha)) {
      lane = claims.get(commit.sha);
    } else {
      // No child has claimed us and we're not a
      // seeded tip — allocate a fresh lane. This
      // happens for commits unreachable from any
      // branch tip in the current page (possible
      // when pages split mid-history).
      lane = allocateLane();
    }

    // Record parent claims.
    const parents = Array.isArray(commit.parents) ? commit.parents : [];
    const edges = [];

    if (parents.length > 0) {
      const firstParent = parents[0];
      // First parent inherits our lane IF no one
      // else has already claimed that parent.
      // Otherwise, we join the existing lane —
      // draw a cross-lane edge from our lane to
      // the parent's existing lane.
      if (!claims.has(firstParent)) {
        claims.set(firstParent, lane);
      } else if (claims.get(firstParent) !== lane) {
        // First parent is already on a different
        // lane. We're joining it.
        // Edge drawn at render time; recorded here.
        edges.push({
          targetSha: firstParent,
          fromLane: lane,
          toLane: claims.get(firstParent),
          merge: false,
        });
      }
      // Merge parents (parents[1..]) each get a
      // cross-lane edge. If not yet claimed, they
      // get a new lane.
      for (let p = 1; p < parents.length; p += 1) {
        const mergeParent = parents[p];
        let mergeLane;
        if (claims.has(mergeParent)) {
          mergeLane = claims.get(mergeParent);
        } else {
          mergeLane = allocateLane();
          claims.set(mergeParent, mergeLane);
        }
        edges.push({
          targetSha: mergeParent,
          fromLane: lane,
          toLane: mergeLane,
          merge: true,
        });
      }
    }

    rows.push({
      commit,
      lane,
      y: i * _ROW_HEIGHT + _ROW_HEIGHT / 2,
      edges,
      rowIndex: i,
    });
  }

  // Second pass: resolve edge `toY` by looking up
  // the target commit's row. Edges pointing at
  // commits not in the current page (older than
  // what we've loaded) get their toY clamped to
  // one row past the bottom — the edge stub trails
  // off-screen until the next page loads.
  const rowBySha = new Map();
  for (const r of rows) rowBySha.set(r.commit.sha, r);
  for (const r of rows) {
    for (const e of r.edges) {
      const targetRow = rowBySha.get(e.targetSha);
      if (targetRow) {
        e.toY = targetRow.y;
      } else {
        e.toY = (rows.length) * _ROW_HEIGHT + _ROW_HEIGHT / 2;
      }
      e.fromY = r.y;
      e.color = _laneColor(e.fromLane);
    }
  }

  return {
    rows,
    totalLanes: nextLane,
    branchLanes,
  };
}

// ---------------------------------------------------------------
// Disambiguation — find which branches reach a commit
// ---------------------------------------------------------------

/**
 * Walk parents from each branch tip. If the walk
 * reaches targetSha, that branch is a candidate.
 * Returns an array of {branch, lane} for branches
 * that reach the target.
 *
 * Walk is bounded by the commits already loaded —
 * commits not in our current pages are skipped. This
 * means a branch whose fork point hasn't been loaded
 * yet may not appear as a candidate until the user
 * scrolls further. Acceptable for the UI; the
 * fallback is to force-select via the pre-selected
 * matching-lane branch.
 */
function findBranchesReachingCommit(targetSha, branches, commits, branchLanes) {
  if (!targetSha || !Array.isArray(branches)) return [];
  const bySha = new Map();
  for (const c of commits) {
    if (c && typeof c.sha === 'string') bySha.set(c.sha, c);
  }
  const candidates = [];
  for (const branch of branches) {
    if (!branch || typeof branch.sha !== 'string') continue;
    // BFS from branch tip following parent links.
    const visited = new Set();
    const queue = [branch.sha];
    let found = false;
    while (queue.length > 0) {
      const sha = queue.shift();
      if (visited.has(sha)) continue;
      visited.add(sha);
      if (sha === targetSha) {
        found = true;
        break;
      }
      const commit = bySha.get(sha);
      if (!commit) continue;
      const parents = Array.isArray(commit.parents)
        ? commit.parents
        : [];
      for (const p of parents) {
        if (!visited.has(p)) queue.push(p);
      }
    }
    if (found) {
      candidates.push({
        branch,
        lane: branchLanes.get(branch.name),
      });
    }
  }
  return candidates;
}

// ---------------------------------------------------------------
// Component
// ---------------------------------------------------------------

export class CommitGraph extends LitElement {
  static properties = {
    /**
     * RPC caller function. Shape: `(method, ...args) =>
     * Promise<result>`. Parent passes
     * `(m, ...a) => this.rpcExtract(m, ...a)` from the
     * RpcMixin. When null or unset, the component
     * renders a loading state and waits.
     */
    rpcCall: { attribute: false },
    /**
     * When true, remote branches are included in
     * the fetch. Persisted across parent renders.
     */
    includeRemote: { type: Boolean },
    /**
     * Loaded commits, accumulated across pages.
     */
    _commits: { type: Array, state: true },
    /**
     * Loaded branches from the most recent fetch.
     * Branches aren't paginated — the backend
     * returns the full list with each response.
     */
    _branches: { type: Array, state: true },
    /**
     * True when more commits are available to
     * fetch. Flips false when the backend reports
     * has_more=false.
     */
    _hasMore: { type: Boolean, state: true },
    /**
     * True while a fetch is in flight. Prevents
     * overlapping page fetches and shows a
     * loading indicator at the bottom of the graph.
     */
    _loading: { type: Boolean, state: true },
    /**
     * Disambiguation popover state. Null when
     * closed. When open:
     *   {commit, candidates: [{branch, lane}, ...],
     *    preSelectedBranch, x, y}
     */
    _popover: { type: Object, state: true },
    /**
     * Set of branch names the user has hidden via
     * the legend chips. Branches in this set are
     * rendered with a muted style and their tip
     * lanes are still assigned (so the graph
     * doesn't reflow on toggle) but their chips
     * render as "off".
     */
    _hiddenBranches: { type: Object, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      color: var(--text-primary, #c9d1d9);
    }

    /* Legend — fixed header above the scrollable
     * graph. Does not scroll. */
    .legend {
      flex-shrink: 0;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.1);
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      align-items: center;
      background: rgba(13, 17, 23, 0.4);
    }
    .legend-label {
      font-size: 0.75rem;
      opacity: 0.65;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-right: 0.25rem;
    }
    .branch-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.15rem 0.5rem;
      font-size: 0.75rem;
      border-radius: 999px;
      background: rgba(110, 118, 129, 0.2);
      border: 1px solid transparent;
      color: var(--text-primary, #c9d1d9);
      cursor: pointer;
      user-select: none;
      font-family: ui-monospace, SFMono-Regular, monospace;
      transition: opacity 120ms ease;
    }
    .branch-chip:hover {
      background: rgba(88, 166, 255, 0.15);
    }
    .branch-chip.hidden {
      opacity: 0.4;
      text-decoration: line-through;
    }
    .branch-chip .swatch {
      display: inline-block;
      width: 0.65rem;
      height: 0.65rem;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .branch-chip .remote-mark {
      font-size: 0.6875rem;
      opacity: 0.55;
    }
    .legend-toggle {
      margin-left: auto;
      font-size: 0.75rem;
      cursor: pointer;
      user-select: none;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      opacity: 0.75;
    }
    .legend-toggle:hover {
      opacity: 1;
    }

    /* Scrollable graph container. */
    .graph-scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: auto;
      position: relative;
    }
    .graph-scroll.empty {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-secondary, #8b949e);
      font-style: italic;
    }

    svg.graph {
      display: block;
    }

    /* Commit row rects — invisible hit targets
     * covering the full width of each row, making
     * click detection forgiving. */
    .row-hit {
      fill: transparent;
      cursor: pointer;
    }
    .row-hit:hover {
      fill: rgba(88, 166, 255, 0.08);
    }

    .commit-node {
      cursor: pointer;
      stroke: rgba(13, 17, 23, 0.9);
      stroke-width: 1.5;
    }
    .commit-node:hover {
      filter: brightness(1.3);
    }

    .commit-text {
      fill: var(--text-primary, #c9d1d9);
      font-size: 0.8125rem;
      font-family: ui-monospace, SFMono-Regular, monospace;
      pointer-events: none;
      dominant-baseline: central;
    }
    .commit-sha {
      fill: var(--text-secondary, #8b949e);
      font-size: 0.75rem;
      font-family: ui-monospace, SFMono-Regular, monospace;
      pointer-events: none;
      dominant-baseline: central;
    }
    .commit-meta {
      fill: var(--text-secondary, #8b949e);
      font-size: 0.6875rem;
      pointer-events: none;
      dominant-baseline: central;
      opacity: 0.75;
    }
    .commit-text.hidden-branch,
    .commit-sha.hidden-branch,
    .commit-meta.hidden-branch {
      opacity: 0.35;
    }

    .branch-label {
      fill: var(--accent-primary, #58a6ff);
      font-size: 0.6875rem;
      font-family: ui-monospace, SFMono-Regular, monospace;
      pointer-events: none;
      font-weight: 600;
    }

    .loading-footer {
      padding: 0.75rem;
      text-align: center;
      color: var(--text-secondary, #8b949e);
      font-size: 0.8125rem;
    }

    /* Disambiguation popover. */
    .popover {
      position: fixed;
      z-index: 3000;
      min-width: 220px;
      background: rgba(22, 27, 34, 0.98);
      border: 1px solid rgba(240, 246, 252, 0.2);
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      padding: 0.35rem 0;
    }
    .popover-header {
      padding: 0.35rem 0.75rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.08);
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
    }
    .popover-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.75rem;
      cursor: pointer;
      font-size: 0.8125rem;
    }
    .popover-item:hover {
      background: rgba(88, 166, 255, 0.15);
    }
    .popover-item.preselected {
      background: rgba(88, 166, 255, 0.08);
    }
    .popover-item .swatch {
      display: inline-block;
      width: 0.65rem;
      height: 0.65rem;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .popover-item .name {
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .popover-item .remote-mark {
      font-size: 0.6875rem;
      opacity: 0.55;
      margin-left: auto;
    }
  `;

  constructor() {
    super();
    this.rpcCall = null;
    this.includeRemote = false;
    this._commits = [];
    this._branches = [];
    this._hasMore = true;
    this._loading = false;
    this._popover = null;
    this._hiddenBranches = new Set();
    this._onScroll = this._onScroll.bind(this);
    this._onDocumentClickForPopover =
      this._onDocumentClickForPopover.bind(this);
    this._onDocumentKeyDownForPopover =
      this._onDocumentKeyDownForPopover.bind(this);
  }

  disconnectedCallback() {
    this._closePopover();
    super.disconnectedCallback();
  }

  updated(changedProps) {
    super.updated?.(changedProps);
    // Fire the initial fetch once rpcCall has landed
    // from the parent's `.rpcCall=${fn}` binding.
    // Lit assigns properties between `connectedCallback`
    // and the first `updated()`, so `connectedCallback`
    // can't see rpcCall yet — this is the right hook.
    // The `_commits.length === 0 && !_loading` guard
    // prevents re-entry: `_fetchInitial` sets
    // `_loading = true` synchronously, so a same-tick
    // updated() call can't reach a second fetch.
    if (
      this.rpcCall
      && this._commits.length === 0
      && !this._loading
    ) {
      this._fetchInitial();
    }
    if (changedProps.has('includeRemote')) {
      // Remote-toggle change forces a full reload.
      // Reset state synchronously; the guard above
      // will pick up the next fetch on the subsequent
      // updated() pass.
      this._commits = [];
      this._branches = [];
      this._hasMore = true;
      if (this.rpcCall) this._fetchInitial();
    }
  }

  async _fetchInitial() {
    if (this._loading) return;
    this._loading = true;
    try {
      const result = await this._callGetCommitGraph(0);
      if (!result) return;
      this._commits = Array.isArray(result.commits) ? result.commits : [];
      this._branches = Array.isArray(result.branches) ? result.branches : [];
      this._hasMore = result.has_more === true;
    } catch (err) {
      console.error('[commit-graph] initial fetch failed', err);
      this.dispatchEvent(
        new CustomEvent('graph-error', {
          detail: { message: err?.message || String(err) },
          bubbles: true,
          composed: true,
        }),
      );
    } finally {
      this._loading = false;
    }
  }

  async _fetchNextPage() {
    if (this._loading || !this._hasMore) return;
    this._loading = true;
    try {
      const result = await this._callGetCommitGraph(this._commits.length);
      if (!result) return;
      const more = Array.isArray(result.commits) ? result.commits : [];
      // Defensive — dedup by SHA in case of overlap.
      const haveShas = new Set(this._commits.map((c) => c.sha));
      const fresh = more.filter((c) => !haveShas.has(c.sha));
      this._commits = [...this._commits, ...fresh];
      if (Array.isArray(result.branches) && result.branches.length > 0) {
        // Refresh branch list — each response carries
        // the full list.
        this._branches = result.branches;
      }
      this._hasMore = result.has_more === true;
    } catch (err) {
      console.error('[commit-graph] page fetch failed', err);
    } finally {
      this._loading = false;
    }
  }

  async _callGetCommitGraph(offset) {
    if (!this.rpcCall) return null;
    return this.rpcCall(
      'LLMService.get_commit_graph',
      _PAGE_SIZE,
      offset,
      !!this.includeRemote,
    );
  }

  _onScroll(event) {
    if (!this._hasMore || this._loading) return;
    const el = event.target;
    const threshold = _PREFETCH_ROWS * _ROW_HEIGHT;
    const distanceFromBottom =
      el.scrollHeight - (el.scrollTop + el.clientHeight);
    if (distanceFromBottom < threshold) {
      this._fetchNextPage();
    }
  }

  _toggleBranchHidden(branchName) {
    const next = new Set(this._hiddenBranches);
    if (next.has(branchName)) {
      next.delete(branchName);
    } else {
      next.add(branchName);
    }
    this._hiddenBranches = next;
  }

  _toggleIncludeRemote() {
    this.includeRemote = !this.includeRemote;
  }

  _onCommitClick(event, commit, layout) {
    event.stopPropagation();
    // Close any stale popover first.
    if (this._popover) this._closePopover();
    const candidates = findBranchesReachingCommit(
      commit.sha,
      this._branches,
      this._commits,
      layout.branchLanes,
    );
    if (candidates.length === 0) {
      // No branch reaches this commit in the loaded
      // history. Emit the commit-selected event
      // anyway with a null branch — caller can
      // fall back.
      this.dispatchEvent(
        new CustomEvent('commit-selected', {
          detail: { commit, branch: null },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    if (candidates.length === 1) {
      // Unambiguous — no popover needed.
      this.dispatchEvent(
        new CustomEvent('commit-selected', {
          detail: { commit, branch: candidates[0].branch },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    // Multiple candidates — open the disambiguation
    // popover. Pre-select the branch whose lane
    // matches the commit's lane.
    const row = layout.rows.find((r) => r.commit.sha === commit.sha);
    const commitLane = row?.lane;
    const preSelected = candidates.find((c) => c.lane === commitLane);
    this._popover = {
      commit,
      candidates,
      preSelectedBranch:
        preSelected?.branch || candidates[0].branch,
      x: event.clientX,
      y: event.clientY,
    };
    document.addEventListener(
      'click', this._onDocumentClickForPopover, true,
    );
    document.addEventListener(
      'keydown', this._onDocumentKeyDownForPopover, true,
    );
    // Also dismiss on graph-scroll — matches the spec.
    const scroller = this.shadowRoot?.querySelector('.graph-scroll');
    if (scroller) {
      scroller.addEventListener(
        'scroll', this._closePopover.bind(this), { once: true },
      );
    }
  }

  _closePopover() {
    if (!this._popover) return;
    this._popover = null;
    document.removeEventListener(
      'click', this._onDocumentClickForPopover, true,
    );
    document.removeEventListener(
      'keydown', this._onDocumentKeyDownForPopover, true,
    );
  }

  _onDocumentClickForPopover(event) {
    if (!this._popover) return;
    const path = event.composedPath ? event.composedPath() : [];
    const inside = path.some(
      (el) => el && el.classList && el.classList.contains('popover'),
    );
    if (!inside) this._closePopover();
  }

  _onDocumentKeyDownForPopover(event) {
    if (!this._popover) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this._closePopover();
    }
  }

  _onPopoverItemClick(branch) {
    const commit = this._popover?.commit;
    this._closePopover();
    if (!commit || !branch) return;
    this.dispatchEvent(
      new CustomEvent('commit-selected', {
        detail: { commit, branch },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const layout = computeGraphLayout(this._commits, this._branches);
    return html`
      ${this._renderLegend(layout)}
      ${this._commits.length === 0 && !this._loading
        ? html`<div class="graph-scroll empty">
            No commits to display.
          </div>`
        : html`<div class="graph-scroll" @scroll=${this._onScroll}>
            ${this._renderGraph(layout)}
            ${this._hasMore
              ? html`<div class="loading-footer">
                  ${this._loading ? 'Loading more commits…' : 'Scroll for more'}
                </div>`
              : this._commits.length > 0
                ? html`<div class="loading-footer">
                    End of history.
                  </div>`
                : ''}
          </div>`}
      ${this._renderPopover()}
    `;
  }

  _renderLegend(layout) {
    return html`
      <div class="legend">
        <span class="legend-label">Branches</span>
        ${(this._branches || []).map((b) => {
          if (!b || typeof b.name !== 'string') return '';
          const lane = layout.branchLanes.get(b.name);
          const color = lane !== undefined ? _laneColor(lane) : '#8b949e';
          const isHidden = this._hiddenBranches.has(b.name);
          return html`
            <span
              class="branch-chip ${isHidden ? 'hidden' : ''}"
              @click=${() => this._toggleBranchHidden(b.name)}
              title=${b.is_remote
                ? `${b.name} (remote — click to hide/show)`
                : `${b.name} (click to hide/show)`}
            >
              <span class="swatch" style="background: ${color}"></span>
              ${b.name}
              ${b.is_remote
                ? html`<span class="remote-mark">remote</span>`
                : ''}
            </span>
          `;
        })}
        <span
          class="legend-toggle"
          @click=${this._toggleIncludeRemote}
          title="Show or hide remote branches"
        >
          <input
            type="checkbox"
            .checked=${this.includeRemote}
            @click=${(e) => e.stopPropagation()}
            @change=${this._toggleIncludeRemote}
          />
          Include remote
        </span>
      </div>
    `;
  }

  _renderGraph(layout) {
    if (layout.rows.length === 0) return '';
    const graphWidth =
      _GRAPH_LEFT_MARGIN +
      layout.totalLanes * _LANE_WIDTH +
      _COMMIT_TEXT_OFFSET;
    const graphHeight = layout.rows.length * _ROW_HEIGHT + 8;
    // Much wider viewBox to accommodate the commit
    // text which extends to the right of the lanes.
    // The scroll container handles overflow.
    const viewportWidth = Math.max(graphWidth + 600, 800);
    return html`
      <svg
        class="graph"
        width=${viewportWidth}
        height=${graphHeight}
        viewBox="0 0 ${viewportWidth} ${graphHeight}"
      >
        ${this._renderEdges(layout)}
        ${layout.rows.map((r) => this._renderRow(r, layout, graphWidth))}
      </svg>
    `;
  }

  _renderEdges(layout) {
    // Render all edges under the commit nodes so
    // nodes sit on top visually.
    //
    // All child elements of <svg> must be built with
    // Lit's svg`` tagged template rather than html``.
    // html`` creates elements in the HTML namespace;
    // the browser then treats <circle>, <line>,
    // <path> etc. as inert unknown HTML elements
    // with zero layout — they appear in childNodes
    // but render as nothing and report zero
    // getBoundingClientRect dimensions. svg`` puts
    // them in the SVG namespace so they become real
    // graphic primitives.
    const paths = [];
    for (const row of layout.rows) {
      // Primary lane continuation — straight line from
      // this commit to the next commit on the same
      // lane below (its first parent, usually). If the
      // first parent is on a different lane, the edge
      // becomes a curve handled via the edges array.
      const firstParentEdge = row.edges.find((e) => !e.merge);
      // The straight vertical continuation only draws
      // when no explicit first-parent cross-lane edge
      // exists and there's a next row on the same lane.
      if (!firstParentEdge) {
        const nextRow = layout.rows.find(
          (r) => r.rowIndex > row.rowIndex && r.lane === row.lane,
        );
        if (nextRow) {
          const x = _GRAPH_LEFT_MARGIN + row.lane * _LANE_WIDTH;
          paths.push(svg`
            <line
              x1=${x}
              y1=${row.y + _NODE_RADIUS}
              x2=${x}
              y2=${nextRow.y - _NODE_RADIUS}
              stroke=${_laneColor(row.lane)}
              stroke-width="2"
            />
          `);
        }
      }
      // Cross-lane edges.
      for (const edge of row.edges) {
        const x1 = _GRAPH_LEFT_MARGIN + edge.fromLane * _LANE_WIDTH;
        const x2 = _GRAPH_LEFT_MARGIN + edge.toLane * _LANE_WIDTH;
        const y1 = edge.fromY + _NODE_RADIUS;
        const y2 = edge.toY - _NODE_RADIUS;
        // Cubic Bezier for a smooth curve between lanes.
        const midY = (y1 + y2) / 2;
        const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
        paths.push(svg`
          <path
            d=${d}
            stroke=${edge.color}
            stroke-width="2"
            fill="none"
            stroke-dasharray=${edge.merge ? '4,3' : ''}
          />
        `);
      }
    }
    return paths;
  }

  _renderRow(row, layout, graphWidth) {
    const { commit, lane } = row;
    const nodeX = _GRAPH_LEFT_MARGIN + lane * _LANE_WIDTH;
    const textX = graphWidth + 4;
    const color = _laneColor(lane);
    // Determine which branches this commit is a tip of
    // (branch-tip label badge). Multiple branches can
    // share a tip; concatenate names.
    const tipBranches = this._branches.filter(
      (b) => b && b.sha === commit.sha,
    );
    // Check whether any branch reaching this commit
    // is hidden — muted rendering for filtered-out
    // branches. We only dim when ALL reaching
    // branches are hidden; partial dimming is confusing.
    const candidates = findBranchesReachingCommit(
      commit.sha, this._branches, this._commits, layout.branchLanes,
    );
    const allCandidatesHidden =
      candidates.length > 0 &&
      candidates.every((c) => this._hiddenBranches.has(c.branch.name));
    const hiddenClass = allCandidatesHidden ? 'hidden-branch' : '';
    const shortSha =
      typeof commit.short_sha === 'string' && commit.short_sha
        ? commit.short_sha
        : (typeof commit.sha === 'string' ? commit.sha.slice(0, 7) : '');
    const message =
      typeof commit.message === 'string' ? commit.message : '';
    const truncatedMsg =
      message.length > 70 ? `${message.slice(0, 67)}…` : message;
    const metaParts = [];
    if (commit.author) metaParts.push(commit.author);
    if (commit.relative_date) metaParts.push(commit.relative_date);
    const meta = metaParts.join(' · ');
    // All SVG children must use svg`` so they end up
    // in the SVG namespace rather than HTML. html``
    // here would produce <rect>/<circle>/<text>
    // elements in the HTML namespace that the
    // browser renders as zero-size unknown tags.
    return svg`
      <g>
        <rect
          class="row-hit"
          x="0"
          y=${row.y - _ROW_HEIGHT / 2}
          width="100%"
          height=${_ROW_HEIGHT}
          @click=${(e) => this._onCommitClick(e, commit, layout)}
        />
        <circle
          class="commit-node"
          cx=${nodeX}
          cy=${row.y}
          r=${_NODE_RADIUS}
          fill=${color}
          @click=${(e) => this._onCommitClick(e, commit, layout)}
        />
        <text
          class="commit-sha ${hiddenClass}"
          x=${textX}
          y=${row.y}
        >${shortSha}</text>
        <text
          class="commit-text ${hiddenClass}"
          x=${textX + 60}
          y=${row.y}
        >${truncatedMsg}</text>
        ${tipBranches.length > 0
          ? svg`<text
              class="branch-label"
              x=${textX + 60 + truncatedMsg.length * 7.5 + 10}
              y=${row.y}
            >${tipBranches.map((b) => b.name).join(', ')}</text>`
          : ''}
        ${meta
          ? svg`<text
              class="commit-meta ${hiddenClass}"
              x=${textX + 60 + truncatedMsg.length * 7.5 + 200}
              y=${row.y}
            >${meta}</text>`
          : ''}
      </g>
    `;
  }

  _renderPopover() {
    if (!this._popover) return '';
    const { candidates, preSelectedBranch, x, y } = this._popover;
    // Clamp inside viewport.
    const margin = 8;
    const estWidth = 240;
    const estHeight = 40 + candidates.length * 34;
    const clampedX = Math.max(
      margin, Math.min(x, window.innerWidth - estWidth - margin),
    );
    const clampedY = Math.max(
      margin, Math.min(y, window.innerHeight - estHeight - margin),
    );
    return html`
      <div
        class="popover"
        style="left: ${clampedX}px; top: ${clampedY}px"
        role="menu"
        aria-label="Select branch for this commit"
      >
        <div class="popover-header">
          This commit is reachable from multiple branches:
        </div>
        ${candidates.map(({ branch, lane }) => {
          const color = lane !== undefined ? _laneColor(lane) : '#8b949e';
          const isPre = branch === preSelectedBranch;
          return html`
            <div
              class="popover-item ${isPre ? 'preselected' : ''}"
              role="menuitem"
              @click=${() => this._onPopoverItemClick(branch)}
            >
              <span class="swatch" style="background: ${color}"></span>
              <span class="name">${branch.name}</span>
              ${branch.is_remote
                ? html`<span class="remote-mark">remote</span>`
                : ''}
            </div>
          `;
        })}
      </div>
    `;
  }
}

customElements.define('ac-commit-graph', CommitGraph);

// Exports for unit tests.
export {
  computeGraphLayout,
  findBranchesReachingCommit,
};