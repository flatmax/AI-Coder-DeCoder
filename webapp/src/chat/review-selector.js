import { LitElement, html, css, svg, nothing } from 'lit';
import { RpcMixin } from '../rpc-mixin.js';

/**
 * Review selector — interactive git graph for selecting a commit to review.
 *
 * Shows a color-coded git graph with stable lane columns per branch.
 * The user clicks a commit node to select it, the system infers the branch,
 * and a Start Review button initiates the review.
 *
 * Events:
 *   review-started  { result }
 *   review-closed
 */

// Color palette for branch lanes
const LANE_COLORS = [
  '#4fc3f7', // light blue
  '#81c784', // green
  '#ffb74d', // orange
  '#e57373', // red
  '#ba68c8', // purple
  '#4dd0e1', // cyan
  '#fff176', // yellow
  '#f06292', // pink
  '#a1887f', // brown
  '#90a4ae', // blue-grey
];

// Graph layout constants
const LANE_WIDTH = 24;
const ROW_HEIGHT = 40;
const NODE_RADIUS = 5;
const GRAPH_LEFT_PAD = 12;

class ReviewSelector extends RpcMixin(LitElement) {
  static properties = {
    open: { type: Boolean },
    _commits: { type: Array, state: true },
    _branches: { type: Array, state: true },
    _hasMore: { type: Boolean, state: true },
    _laneMap: { type: Object, state: true },
    _commitLanes: { type: Object, state: true },
    _selectedCommit: { type: Object, state: true },
    _selectedBranch: { type: String, state: true },
    _disambiguating: { type: Boolean, state: true },
    _candidateBranches: { type: Array, state: true },
    _hiddenBranches: { type: Object, state: true },
    _includeRemote: { type: Boolean, state: true },
    _loading: { type: Boolean, state: true },
    _loadingMore: { type: Boolean, state: true },
    _error: { type: String, state: true },
    _phase: { type: String, state: true },
    _cleanCheck: { type: Object, state: true },
    _hoveredCommit: { type: String, state: true },
    _panelWidth: { type: Number, state: true },
    _panelHeight: { type: Number, state: true },
  };

  static styles = css`
    :host { display: block; }

    .backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 300;
      display: flex; align-items: center; justify-content: center;
    }

    .panel {
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      display: flex; flex-direction: column;
      overflow: hidden;
      position: relative;
    }

    /* Resize handle — bottom-right corner */
    .resize-handle {
      position: absolute; bottom: 0; right: 0;
      width: 16px; height: 16px;
      cursor: nwse-resize; z-index: 5;
    }
    .resize-handle::after {
      content: '';
      position: absolute; bottom: 4px; right: 4px;
      width: 8px; height: 8px;
      border-right: 2px solid var(--text-muted);
      border-bottom: 2px solid var(--text-muted);
      opacity: 0.4;
    }
    .resize-handle:hover::after { opacity: 0.8; }

    .header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex; align-items: center; justify-content: space-between;
    }
    .header h3 { margin: 0; font-size: 14px; color: var(--text-primary); }
    .close-btn {
      background: none; border: none; color: var(--text-muted);
      cursor: pointer; font-size: 16px; padding: 4px;
    }
    .close-btn:hover { color: var(--text-primary); }

    /* ── Branch legend (frozen header) ── */
    .branch-legend {
      padding: 8px 16px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-secondary);
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
      flex-shrink: 0;
    }

    .branch-chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 10px; border-radius: 12px;
      font-size: 11px; font-family: var(--font-mono);
      cursor: pointer; border: 1.5px solid transparent;
      transition: opacity 0.15s, border-color 0.15s, box-shadow 0.15s;
      user-select: none;
    }
    .branch-chip .dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }
    .branch-chip.hidden { opacity: 0.3; }
    .branch-chip.candidate {
      border-color: currentColor;
      box-shadow: 0 0 6px currentColor;
      animation: pulse-glow 1.2s ease-in-out infinite alternate;
    }
    .branch-chip.active-branch {
      border-color: currentColor;
    }
    .branch-chip.remote { font-style: italic; opacity: 0.7; }

    @keyframes pulse-glow {
      from { box-shadow: 0 0 4px currentColor; }
      to   { box-shadow: 0 0 10px currentColor; }
    }

    .remote-toggle {
      background: none; border: 1px solid var(--border-color);
      border-radius: var(--radius-sm); padding: 3px 8px;
      font-size: 11px; color: var(--text-muted); cursor: pointer;
      margin-left: auto;
    }
    .remote-toggle:hover { color: var(--text-primary); }
    .remote-toggle.active { color: var(--accent-primary); border-color: var(--accent-primary); }

    /* ── Graph area ── */
    .graph-container {
      flex: 1; overflow-y: auto; overflow-x: auto;
      min-height: 200px;
      position: relative;
    }

    .graph-scroll {
      position: relative;
      min-width: fit-content;
    }

    .graph-row {
      display: flex; align-items: center;
      height: ${ROW_HEIGHT}px;
      cursor: pointer;
      transition: background 0.1s;
      position: relative;
    }
    .graph-row:hover { background: rgba(255,255,255,0.03); }
    .graph-row.selected { background: rgba(79,195,247,0.1); }

    .graph-svg-col {
      flex-shrink: 0;
      height: ${ROW_HEIGHT}px;
    }

    .commit-info {
      flex: 1; min-width: 0;
      padding: 0 12px;
      display: flex; flex-direction: column;
      justify-content: center;
    }
    .commit-top {
      display: flex; align-items: center; gap: 6px;
    }
    .commit-sha {
      font-family: var(--font-mono); font-size: 11px;
      color: var(--accent-primary); flex-shrink: 0;
    }
    .commit-msg {
      font-size: 12px; color: var(--text-primary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .commit-meta {
      font-size: 10px; color: var(--text-muted);
    }
    .branch-badge {
      display: inline-block; padding: 1px 6px;
      border-radius: 8px; font-size: 9px;
      font-family: var(--font-mono);
      color: #000; font-weight: 600;
      margin-left: 4px; flex-shrink: 0;
    }

    .loading-sentinel {
      padding: 12px; text-align: center;
      color: var(--text-muted); font-size: 11px;
    }

    /* ── Info / action bar (frozen footer) ── */
    .footer {
      padding: 10px 16px; border-top: 1px solid var(--border-color);
      display: flex; flex-direction: column; gap: 6px;
      flex-shrink: 0;
    }
    .footer-row {
      display: flex; justify-content: space-between; align-items: center;
    }

    .review-summary {
      font-size: 12px; color: var(--text-primary);
    }
    .review-summary .branch-name {
      font-weight: 600; color: var(--accent-primary);
    }
    .review-summary .range {
      font-family: var(--font-mono); font-size: 11px;
      color: var(--text-secondary);
    }

    .footer-hint {
      font-size: 11px; color: var(--text-muted);
    }

    .start-btn {
      padding: 6px 18px; border: none; border-radius: var(--radius-sm);
      background: var(--accent-primary); color: var(--bg-primary);
      cursor: pointer; font-size: 13px; font-weight: 600;
    }
    .start-btn:hover { opacity: 0.9; }
    .start-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .error { color: var(--accent-error); font-size: 12px; padding: 0 16px 8px; }

    /* ── Dirty tree warning ── */
    .dirty-warning {
      padding: 32px 24px; text-align: center;
    }
    .dirty-warning .icon { font-size: 32px; margin-bottom: 12px; }
    .dirty-warning h4 {
      color: var(--accent-warning, #ffb74d); font-size: 14px; margin: 0 0 8px;
    }
    .dirty-warning p {
      color: var(--text-secondary); font-size: 12px;
      margin: 0 0 16px; line-height: 1.6;
    }
    .dirty-warning pre {
      background: var(--bg-primary); border: 1px solid var(--border-color);
      border-radius: var(--radius-sm); padding: 10px 14px;
      font-size: 12px; color: var(--text-primary); text-align: left;
      font-family: var(--font-mono); margin: 0 auto; display: inline-block;
    }

    .progress-box {
      padding: 32px 16px; text-align: center;
    }
    .progress-list { list-style: none; padding: 0; margin: 12px 0; }
    .progress-list li {
      padding: 4px 0; font-size: 12px; color: var(--text-secondary);
      display: flex; align-items: center; gap: 8px; justify-content: center;
    }
    .progress-list li .icon { width: 16px; text-align: center; }

    .tooltip {
      position: absolute;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 6px 10px;
      font-size: 11px;
      color: var(--text-primary);
      box-shadow: var(--shadow-lg);
      pointer-events: none;
      z-index: 10;
      max-width: 400px;
      white-space: pre-wrap;
    }
  `;

  constructor() {
    super();
    this.open = false;
    this._commits = [];
    this._branches = [];
    this._hasMore = false;
    this._laneMap = {};        // branchName -> laneIndex
    this._commitLanes = {};    // sha -> laneIndex
    this._commitRowMap = {};   // sha -> rowIndex in _commits
    this._laneRowRange = {};   // laneIdx -> { first, last }
    this._forkEdges = [];      // [{ fromLane, toLane, atRow }]
    this._branchTipMap = {};   // sha -> [branchName, ...]
    this._selectedCommit = null;
    this._selectedBranch = '';
    this._disambiguating = false;
    this._candidateBranches = [];
    this._hiddenBranches = new Set();
    this._includeRemote = false;
    this._loading = false;
    this._loadingMore = false;
    this._error = '';
    this._phase = 'loading'; // 'loading' | 'dirty' | 'graph' | 'progress'
    this._cleanCheck = null;
    this._hoveredCommit = null;
    this._offset = 0;
    this._intersectionObserver = null;
    this._panelWidth = 900;
    this._panelHeight = 0;    // 0 = use max-height: 85vh
    this._resizing = false;
    this._onMouseMoveBound = this._onResizeMove.bind(this);
    this._onMouseUpBound = this._onResizeEnd.bind(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
      this._intersectionObserver = null;
    }
    document.removeEventListener('mousemove', this._onMouseMoveBound);
    document.removeEventListener('mouseup', this._onMouseUpBound);
  }

  updated(changed) {
    if (changed.has('open') && this.open) {
      this._reset();
      this._checkCleanAndLoad();
    }
    if (changed.has('_commits') || changed.has('_hasMore')) {
      this._setupScrollObserver();
    }
  }

  _reset() {
    this._commits = [];
    this._branches = [];
    this._hasMore = false;
    this._laneMap = {};
    this._commitLanes = {};
    this._commitRowMap = {};
    this._laneRowRange = {};
    this._forkEdges = [];
    this._branchTipMap = {};
    this._selectedCommit = null;
    this._selectedBranch = '';
    this._disambiguating = false;
    this._candidateBranches = [];
    this._hiddenBranches = new Set();
    this._error = '';
    this._phase = 'loading';
    this._cleanCheck = null;
    this._hoveredCommit = null;
    this._offset = 0;
  }

  async _checkCleanAndLoad() {
    try {
      const check = await this.rpcExtract('LLM.check_review_ready');
      this._cleanCheck = check;
      if (!check?.clean) {
        this._phase = 'dirty';
        return;
      }
      await this._loadGraph();
    } catch (e) {
      this._error = 'Failed to check repository status: ' + e;
      this._phase = 'dirty';
    }
  }

  async _loadGraph(append = false) {
    if (!append) {
      this._loading = true;
      this._offset = 0;
    } else {
      this._loadingMore = true;
    }

    try {
      const result = await this.rpcExtract(
        'LLM.get_commit_graph', 100, this._offset, this._includeRemote,
      );
      if (!result || result.error) {
        this._error = result?.error || 'Failed to load commit graph';
        this._phase = 'graph';
        return;
      }

      if (append) {
        this._commits = [...this._commits, ...result.commits];
      } else {
        this._commits = result.commits || [];
        this._branches = result.branches || [];
      }
      this._hasMore = result.has_more || false;
      this._offset += (result.commits || []).length;

      // Compute layout
      this._computeLayout();
      this._phase = 'graph';
    } catch (e) {
      this._error = 'Failed to load commit graph: ' + e;
      this._phase = 'graph';
    } finally {
      this._loading = false;
      this._loadingMore = false;
    }
  }

  // ── Layout computation ──

  _computeLayout() {
    const branches = this._branches;
    const commits = this._commits;

    // Build branch tip map: sha -> [branchName, ...]
    const tipMap = {};
    for (const b of branches) {
      if (!tipMap[b.sha]) tipMap[b.sha] = [];
      tipMap[b.sha].push(b.name);
    }
    this._branchTipMap = tipMap;

    // Sort branches for lane assignment: current branch first, then local
    // branches, then remote branches. Within each group, preserve the
    // committer-date order from the backend (most recent first).
    // This ensures the main branch claims its full history before feature
    // branches claim theirs, producing correct fork points.
    const filtered = branches.filter(b => !b.is_remote || this._includeRemote);
    const localNames = new Set(filtered.filter(b => !b.is_remote).map(b => b.name));

    const sorted = [...filtered].sort((a, b) => {
      // Current branch always first
      if (a.is_current && !b.is_current) return -1;
      if (!a.is_current && b.is_current) return 1;
      // Local before remote
      if (!a.is_remote && b.is_remote) return -1;
      if (a.is_remote && !b.is_remote) return 1;
      // Skip remote branches that duplicate a local branch — they'll share its lane
      // (handled below, just keep original order here)
      return 0;
    });

    // Assign lane per branch. Branches sharing the same tip SHA share a lane.
    // Remote branches whose local counterpart exists also share its lane.
    const laneMap = {};
    const shaToLane = {};
    let laneIdx = 0;
    for (const b of sorted) {
      if (laneMap.hasOwnProperty(b.name)) continue;

      // If this remote branch has a local counterpart, share its lane
      if (b.is_remote) {
        const localName = b.name.replace(/^[^/]+\//, '');
        if (localNames.has(localName) && laneMap[localName] !== undefined) {
          laneMap[b.name] = laneMap[localName];
          continue;
        }
      }

      if (shaToLane[b.sha] !== undefined) {
        laneMap[b.name] = shaToLane[b.sha];
      } else {
        laneMap[b.name] = laneIdx;
        shaToLane[b.sha] = laneIdx;
        laneIdx++;
      }
    }
    this._laneMap = laneMap;

    // Build commit index and row map
    const commitIndex = {};
    const commitRowMap = {};
    for (let i = 0; i < commits.length; i++) {
      commitIndex[commits[i].sha] = commits[i];
      commitRowMap[commits[i].sha] = i;
    }
    this._commitRowMap = commitRowMap;

    // Assign each commit to a lane by tracing first-parent chains from branch tips.
    // We process branches in the same sorted order so the current/main branch claims
    // the deepest history. A branch "owns" commits from its tip down to (but not
    // including) the first commit already claimed by another branch — the fork point.
    const commitLanes = {};
    const laneTipRow = {};   // laneIdx -> row of branch tip
    const laneForkRow = {};  // laneIdx -> row where branch joins another lane
    const processedLanes = new Set();  // skip duplicate lane walks

    for (const b of sorted) {
      if (laneMap[b.name] === undefined) continue;
      const lane = laneMap[b.name];
      // Skip if we already walked this lane (shared lane from dedup)
      if (processedLanes.has(lane)) continue;
      processedLanes.add(lane);

      let sha = b.sha;
      const visited = new Set();
      let lastOwnedRow = -1;

      // Record tip row
      if (commitRowMap[sha] !== undefined) {
        if (laneTipRow[lane] === undefined) {
          laneTipRow[lane] = commitRowMap[sha];
        }
      }

      while (sha && commitIndex[sha] && !visited.has(sha)) {
        visited.add(sha);
        const row = commitRowMap[sha];

        if (commitLanes[sha] !== undefined) {
          // This commit is already claimed — this is the fork point.
          if (row !== undefined) {
            laneForkRow[lane] = row;
          }
          break;
        }

        commitLanes[sha] = lane;
        if (row !== undefined) {
          lastOwnedRow = row;
        }

        // Follow first parent
        const c = commitIndex[sha];
        sha = c.parents && c.parents.length > 0 ? c.parents[0] : null;
      }

      if (laneForkRow[lane] === undefined && lastOwnedRow >= 0) {
        laneForkRow[lane] = lastOwnedRow;
      }
    }

    // Any commits not assigned to a lane get a fallback
    for (const c of commits) {
      if (commitLanes[c.sha] === undefined) {
        commitLanes[c.sha] = 0;
      }
    }

    this._commitLanes = commitLanes;

    // Build per-lane row ranges for drawing continuous vertical lines.
    const laneRowRange = {};
    for (const lStr of Object.keys(laneTipRow)) {
      const l = Number(lStr);
      const tip = laneTipRow[l];
      const fork = laneForkRow[l] !== undefined ? laneForkRow[l] : tip;
      laneRowRange[l] = { first: Math.min(tip, fork), last: Math.max(tip, fork) };
    }
    this._laneRowRange = laneRowRange;

    // Extend lane ranges for merge parents: if a merge commit on lane A has
    // a second parent on lane B, lane B's line should extend up to the merge
    // row so the dashed merge line visually connects.
    for (const c of commits) {
      if (!c.parents || c.parents.length < 2) continue;
      const mergeRow = commitRowMap[c.sha];
      if (mergeRow === undefined) continue;
      for (let pi = 1; pi < c.parents.length; pi++) {
        const pLane = commitLanes[c.parents[pi]];
        if (pLane === undefined) continue;
        if (laneRowRange[pLane]) {
          laneRowRange[pLane].first = Math.min(laneRowRange[pLane].first, mergeRow);
        }
      }
    }

    // Build fork edges: diagonal lines connecting a branch lane to its parent lane
    const forkEdges = [];
    const seenForkEdges = new Set();
    for (const b of sorted) {
      if (laneMap[b.name] === undefined) continue;
      const lane = laneMap[b.name];
      const edgeKey = `${lane}`;
      if (seenForkEdges.has(edgeKey)) continue;
      seenForkEdges.add(edgeKey);

      const forkRow = laneForkRow[lane];
      if (forkRow === undefined) continue;
      const forkCommit = commits[forkRow];
      if (!forkCommit) continue;
      const parentLane = commitLanes[forkCommit.sha];
      if (parentLane !== undefined && parentLane !== lane) {
        forkEdges.push({ fromLane: lane, toLane: parentLane, atRow: forkRow });
      }
    }
    this._forkEdges = forkEdges;
  }

  _commitRowIndex(sha) {
    return this._commitRowMap?.[sha] ?? 0;
  }

  get _laneCount() {
    const vals = Object.values(this._laneMap);
    return vals.length > 0 ? Math.max(...vals) + 1 : 1;
  }

  get _svgWidth() {
    return GRAPH_LEFT_PAD + this._laneCount * LANE_WIDTH + 8;
  }

  _laneColor(laneIdx) {
    return LANE_COLORS[laneIdx % LANE_COLORS.length];
  }

  _branchColor(branchName) {
    const lane = this._laneMap[branchName];
    return lane !== undefined ? this._laneColor(lane) : LANE_COLORS[0];
  }

  // ── Scroll-based lazy loading ──

  _setupScrollObserver() {
    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
    }
    if (!this._hasMore) return;

    this.updateComplete.then(() => {
      const sentinel = this.shadowRoot?.querySelector('.loading-sentinel');
      if (!sentinel) return;
      this._intersectionObserver = new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting && this._hasMore && !this._loadingMore) {
          this._loadGraph(true);
        }
      }, { root: this.shadowRoot?.querySelector('.graph-container'), threshold: 0.1 });
      this._intersectionObserver.observe(sentinel);
    });
  }

  // ── Commit selection & disambiguation ──

  _selectCommit(commit) {
    this._selectedCommit = commit;
    this._error = '';
    this._disambiguating = false;
    this._candidateBranches = [];

    // Find which branches this commit is reachable from
    const candidates = this._findCandidateBranches(commit.sha);

    if (candidates.length === 1) {
      this._selectedBranch = candidates[0];
    } else if (candidates.length > 1) {
      // Pre-select the closest branch (fewest commits from selection to tip)
      this._candidateBranches = candidates;
      this._disambiguating = true;
      this._selectedBranch = this._closestBranch(commit.sha, candidates);
    } else {
      // Fallback: use the commit's lane to guess branch
      const lane = this._commitLanes[commit.sha];
      const branchEntry = Object.entries(this._laneMap).find(([, l]) => l === lane);
      this._selectedBranch = branchEntry ? branchEntry[0] : '';
    }
  }

  _findCandidateBranches(sha) {
    // A branch is a candidate if the selected commit is reachable from
    // the branch tip via parent traversal (BFS through all parents).
    // Both local and remote branches are valid candidates.
    const commitIndex = {};
    for (const c of this._commits) {
      commitIndex[c.sha] = c;
    }

    const candidates = [];
    for (const b of this._branches) {
      if (this._laneMap[b.name] === undefined) continue;

      // BFS from branch tip to find the selected commit
      const queue = [b.sha];
      const visited = new Set();
      let found = false;
      while (queue.length > 0) {
        const cur = queue.shift();
        if (cur === sha) { found = true; break; }
        if (visited.has(cur) || !commitIndex[cur]) continue;
        visited.add(cur);
        const c = commitIndex[cur];
        if (c.parents) {
          for (const p of c.parents) queue.push(p);
        }
      }
      if (found) candidates.push(b.name);
    }
    return candidates;
  }

  _closestBranch(sha, candidates) {
    // Find the branch whose tip is closest (fewest first-parent hops) to the selected commit
    const commitIndex = {};
    for (const c of this._commits) {
      commitIndex[c.sha] = c;
    }

    let best = candidates[0];
    let bestDist = Infinity;

    for (const bName of candidates) {
      const branch = this._branches.find(b => b.name === bName);
      if (!branch) continue;
      let cur = branch.sha;
      let dist = 0;
      const visited = new Set();
      while (cur && commitIndex[cur] && !visited.has(cur)) {
        if (cur === sha) break;
        visited.add(cur);
        dist++;
        const c = commitIndex[cur];
        cur = c.parents?.[0] || null;
      }
      if (cur === sha && dist < bestDist) {
        bestDist = dist;
        best = bName;
      }
    }
    return best;
  }

  _disambiguateBranch(branchName) {
    this._selectedBranch = branchName;
    this._disambiguating = false;
    this._candidateBranches = [];
  }

  // ── Branch legend interactions ──

  _toggleBranchVisibility(branchName) {
    // If disambiguating, clicking a candidate selects that branch
    if (this._disambiguating && this._candidateBranches.includes(branchName)) {
      this._disambiguateBranch(branchName);
      return;
    }
    // Otherwise toggle visibility filter
    const next = new Set(this._hiddenBranches);
    if (next.has(branchName)) {
      next.delete(branchName);
    } else {
      next.add(branchName);
    }
    this._hiddenBranches = next;
  }

  async _toggleRemote() {
    this._includeRemote = !this._includeRemote;
    await this._loadGraph(false);
  }

  // ── Review info ──

  get _commitCount() {
    if (!this._selectedCommit || !this._selectedBranch) return 0;
    const branch = this._branches.find(b => b.name === this._selectedBranch);
    if (!branch) return 0;

    const commitIndex = {};
    for (const c of this._commits) commitIndex[c.sha] = c;

    let count = 0;
    let cur = branch.sha;
    const visited = new Set();
    while (cur && commitIndex[cur] && !visited.has(cur)) {
      count++;
      if (cur === this._selectedCommit.sha) break;
      visited.add(cur);
      cur = commitIndex[cur].parents?.[0] || null;
    }
    return count;
  }

  get _branchTipSha() {
    const branch = this._branches.find(b => b.name === this._selectedBranch);
    return branch?.sha?.substring(0, 7) || '';
  }

  // ── Start review ──

  async _startReview() {
    if (!this._selectedCommit || !this._selectedBranch) return;
    this._phase = 'progress';
    this._loading = true;
    this._error = '';
    try {
      const result = await this.rpcExtract(
        'LLM.start_review', this._selectedBranch, this._selectedCommit.sha,
      );
      this._loading = false;
      if (result?.error) {
        this._error = result.error;
        this._phase = 'graph';
        return;
      }
      this.dispatchEvent(new CustomEvent('review-started', {
        detail: { result }, bubbles: true, composed: true,
      }));
    } catch (e) {
      this._loading = false;
      this._error = 'Failed to start review: ' + e;
      this._phase = 'graph';
    }
  }

  _close() {
    this.dispatchEvent(new CustomEvent('review-closed', {
      bubbles: true, composed: true,
    }));
  }

  _onBackdropClick(e) {
    if (e.target === e.currentTarget) this._close();
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') this._close();
  }

  _onResizeStart(e) {
    e.preventDefault();
    this._resizing = true;
    this._resizeStartX = e.clientX;
    this._resizeStartY = e.clientY;
    const panel = this.shadowRoot?.querySelector('.panel');
    if (panel) {
      const rect = panel.getBoundingClientRect();
      this._resizeStartW = rect.width;
      this._resizeStartH = rect.height;
    }
    document.addEventListener('mousemove', this._onMouseMoveBound);
    document.addEventListener('mouseup', this._onMouseUpBound);
  }

  _onResizeMove(e) {
    if (!this._resizing) return;
    const dw = e.clientX - this._resizeStartX;
    const dh = e.clientY - this._resizeStartY;
    // Resize symmetrically (panel is centered) — width grows by 2x the mouse delta
    this._panelWidth = Math.max(600, Math.min(window.innerWidth - 40, this._resizeStartW + dw * 2));
    this._panelHeight = Math.max(400, Math.min(window.innerHeight - 40, this._resizeStartH + dh));
  }

  _onResizeEnd() {
    this._resizing = false;
    document.removeEventListener('mousemove', this._onMouseMoveBound);
    document.removeEventListener('mouseup', this._onMouseUpBound);
  }

  // ── SVG graph rendering ──

  _renderGraphSvg(rowIndex, commit) {
    const lane = this._commitLanes[commit.sha] ?? 0;
    const color = this._laneColor(lane);
    const w = this._svgWidth;
    const h = ROW_HEIGHT;
    const cx = GRAPH_LEFT_PAD + lane * LANE_WIDTH + LANE_WIDTH / 2;
    const cy = h / 2;
    const isSelected = this._selectedCommit?.sha === commit.sha;
    const isHovered = this._hoveredCommit === commit.sha;

    const elements = [];

    // Draw vertical lane lines for all lanes active at this row
    const rangeKeys = Object.keys(this._laneRowRange || {});
    for (const lStr of rangeKeys) {
      const l = Number(lStr);
      if (this._isBranchHiddenForLane(l)) continue;
      if (!this._laneActiveAtRow(l, rowIndex)) continue;
      const lx = GRAPH_LEFT_PAD + l * LANE_WIDTH + LANE_WIDTH / 2;
      const lColor = this._laneColor(l);
      elements.push(svg`
        <line x1=${lx} y1="0" x2=${lx} y2=${h}
          stroke=${lColor} stroke-width="1.5" stroke-opacity="0.4" />
      `);
    }

    // Draw fork edges: diagonal/curved line from a branch lane joining into the parent lane
    // at this row. The child lane ends here and merges into the parent lane.
    if (this._forkEdges) {
      for (const edge of this._forkEdges) {
        if (edge.atRow === rowIndex) {
          const fromX = GRAPH_LEFT_PAD + edge.fromLane * LANE_WIDTH + LANE_WIDTH / 2;
          const toX = GRAPH_LEFT_PAD + edge.toLane * LANE_WIDTH + LANE_WIDTH / 2;
          const fromColor = this._laneColor(edge.fromLane);
          // Draw from top-of-row on the child lane to mid-row on the parent lane
          elements.push(svg`
            <path d="M ${fromX} 0 C ${fromX} ${cy}, ${toX} ${cy * 0.3}, ${toX} ${cy}"
              stroke=${fromColor} stroke-width="2" fill="none" stroke-opacity="0.7" />
          `);
        }
      }
    }

    // Draw merge lines (second parent connections).
    // The merge commit is on this row; the second parent is on a different lane.
    // Draw a dashed line from this commit's node to the second parent's lane,
    // going downward toward the parent's row.
    if (commit.parents && commit.parents.length > 1) {
      for (let pi = 1; pi < commit.parents.length; pi++) {
        const parentSha = commit.parents[pi];
        const parentLane = this._commitLanes[parentSha];
        if (parentLane !== undefined && parentLane !== lane) {
          const px = GRAPH_LEFT_PAD + parentLane * LANE_WIDTH + LANE_WIDTH / 2;
          const parentColor = this._laneColor(parentLane);
          // Curve from this commit node down to the parent's lane column at the bottom of this row
          elements.push(svg`
            <path d="M ${cx} ${cy} C ${cx} ${h}, ${px} ${cy}, ${px} ${h}"
              stroke=${parentColor} stroke-width="1.5" fill="none"
              stroke-opacity="0.6" stroke-dasharray="3,2" />
          `);
        }
      }
    }

    // Draw the commit node
    const r = isSelected ? NODE_RADIUS + 2 : isHovered ? NODE_RADIUS + 1 : NODE_RADIUS;
    elements.push(svg`
      <circle cx=${cx} cy=${cy} r=${r}
        fill=${color} stroke=${isSelected ? '#fff' : 'none'}
        stroke-width=${isSelected ? 2 : 0} />
    `);

    // Selection ring
    if (isSelected) {
      elements.push(svg`
        <circle cx=${cx} cy=${cy} r=${r + 4}
          fill="none" stroke=${color} stroke-width="1.5" stroke-opacity="0.5" />
      `);
    }

    return svg`
      <svg width=${w} height=${h} class="graph-svg-col">
        ${elements}
      </svg>
    `;
  }

  _isBranchHiddenForLane(laneIdx) {
    // A lane is hidden only if ALL branches assigned to it are hidden.
    // If any branch on this lane is visible, the lane is visible.
    let hasAny = false;
    for (const [bName, l] of Object.entries(this._laneMap)) {
      if (l === laneIdx) {
        hasAny = true;
        if (!this._hiddenBranches.has(bName)) return false;
      }
    }
    return hasAny;  // true only if all branches on this lane are hidden
  }

  _laneActiveAtRow(laneIdx, rowIndex) {
    // A lane is active at this row if the row falls between the lane's
    // first and last commit (inclusive) — draws a continuous vertical line
    const range = this._laneRowRange?.[laneIdx];
    if (!range) return false;
    return rowIndex >= range.first && rowIndex <= range.last;
  }

  // ── Render ──

  render() {
    if (!this.open) return nothing;
    const panelStyle = `width: ${this._panelWidth}px;`
      + (this._panelHeight > 0 ? ` height: ${this._panelHeight}px;` : ' max-height: 85vh;');
    return html`
      <div class="backdrop" @click=${this._onBackdropClick} @keydown=${this._onKeyDown}>
        <div class="panel" style=${panelStyle}>
          <div class="header">
            <h3>📋 Start Code Review</h3>
            <button class="close-btn" @click=${this._close} aria-label="Close">✕</button>
          </div>

          ${this._phase === 'dirty' ? this._renderDirtyWarning()
          : this._phase === 'progress' ? this._renderProgress()
          : this._phase === 'loading' ? this._renderLoading()
          : this._renderGraphView()}

          <div class="resize-handle" @mousedown=${this._onResizeStart}></div>
        </div>
      </div>
    `;
  }

  _renderDirtyWarning() {
    return html`
      <div class="dirty-warning">
        <div class="icon">⚠️</div>
        <h4>Working tree has uncommitted changes</h4>
        <p>${this._cleanCheck?.message || 'Cannot start a review with pending changes.'}</p>
        <pre>git stash\ngit commit -am "wip"\ngit checkout -- &lt;file&gt;</pre>
      </div>
      <div class="footer">
        <div></div>
        <button class="close-btn" @click=${this._close}
          style="padding:6px 14px; border:1px solid var(--border-color); border-radius:var(--radius-sm); background:var(--bg-surface); color:var(--text-primary); cursor:pointer; font-size:12px;">
          Close
        </button>
      </div>
    `;
  }

  _renderLoading() {
    return html`
      <div style="padding: 48px; text-align: center; color: var(--text-muted); font-size: 13px;">
        Loading commit graph...
      </div>
    `;
  }

  _renderProgress() {
    return html`
      <div class="progress-box">
        <div style="font-size:16px; margin-bottom:12px; color: var(--text-primary);">Entering review mode...</div>
        <ul class="progress-list">
          <li><span class="icon">✓</span> Verified clean working tree</li>
          <li><span class="icon">${this._loading ? '⟳' : '✓'}</span> Building symbol maps & setting up review</li>
        </ul>
      </div>
      ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
    `;
  }

  _renderGraphView() {
    const visibleCommits = this._commits.filter(c => {
      const lane = this._commitLanes[c.sha];
      return !this._isBranchHiddenForLane(lane);
    });

    return html`
      ${this._renderBranchLegend()}

      <div class="graph-container">
        <div class="graph-scroll">
          ${visibleCommits.map((c) => this._renderGraphRow(c, this._commitRowIndex(c.sha)))}
          ${this._hasMore ? html`
            <div class="loading-sentinel">
              ${this._loadingMore ? 'Loading more commits...' : ''}
            </div>
          ` : nothing}
        </div>
      </div>

      ${this._error ? html`<div class="error">${this._error}</div>` : nothing}

      ${this._renderFooter()}
    `;
  }

  _renderBranchLegend() {
    const localBranches = this._branches.filter(b => !b.is_remote);
    const remoteBranches = this._includeRemote ? this._branches.filter(b => b.is_remote) : [];

    return html`
      <div class="branch-legend">
        ${localBranches.map(b => this._renderBranchChip(b))}
        ${remoteBranches.map(b => this._renderBranchChip(b, true))}
        <button class="remote-toggle ${this._includeRemote ? 'active' : ''}"
          @click=${this._toggleRemote}
          title="Toggle remote branches">
          ⊙ remotes
        </button>
      </div>
    `;
  }

  _renderBranchChip(branch, isRemote = false) {
    const color = this._branchColor(branch.name);
    const isHidden = this._hiddenBranches.has(branch.name);
    const isCandidate = this._disambiguating && this._candidateBranches.includes(branch.name);
    const isActive = this._selectedBranch === branch.name && !this._disambiguating;

    let cls = 'branch-chip';
    if (isHidden) cls += ' hidden';
    if (isCandidate) cls += ' candidate';
    if (isActive) cls += ' active-branch';
    if (isRemote) cls += ' remote';

    return html`
      <span class=${cls}
        style="color: ${color}; background: ${color}22;"
        @click=${() => this._toggleBranchVisibility(branch.name)}
        title=${isCandidate ? `Select ${branch.name} for review` : `Toggle ${branch.name}`}>
        <span class="dot" style="background: ${color}"></span>
        ${branch.name}${branch.is_current ? ' ★' : ''}
      </span>
    `;
  }

  _renderGraphRow(commit, rowIndex) {
    const isSelected = this._selectedCommit?.sha === commit.sha;
    const tipBranches = this._branchTipMap[commit.sha] || [];
    const lane = this._commitLanes[commit.sha] ?? 0;

    return html`
      <div class="graph-row ${isSelected ? 'selected' : ''}"
        @click=${() => this._selectCommit(commit)}
        @mouseenter=${() => { this._hoveredCommit = commit.sha; }}
        @mouseleave=${() => { this._hoveredCommit = null; }}>
        ${this._renderGraphSvg(rowIndex, commit)}
        <div class="commit-info">
          <div class="commit-top">
            <span class="commit-sha">${commit.short_sha}</span>
            <span class="commit-msg">${commit.message}</span>
            ${tipBranches.map(bName => html`
              <span class="branch-badge"
                style="background: ${this._branchColor(bName)}">
                ${bName}
              </span>
            `)}
          </div>
          <div class="commit-meta">${commit.author} · ${commit.relative_date}</div>
        </div>
      </div>
    `;
  }

  _renderFooter() {
    const hasSelection = this._selectedCommit && this._selectedBranch;
    const needsDisambiguation = this._disambiguating;

    return html`
      <div class="footer">
        <div class="footer-row">
          <div>
            ${needsDisambiguation ? html`
              <span class="footer-hint">
                This commit is on multiple branches — select one above
              </span>
            ` : hasSelection ? html`
              <div class="review-summary">
                📋 Review: <span class="branch-name">${this._selectedBranch}</span><br>
                <span class="range">
                  ${this._selectedCommit.short_sha} → ${this._branchTipSha} (HEAD) · ${this._commitCount} commit${this._commitCount !== 1 ? 's' : ''}
                </span>
              </div>
            ` : html`
              <span class="footer-hint">Click a commit to select the review starting point</span>
            `}
          </div>
          <button class="start-btn" @click=${this._startReview}
            ?disabled=${!hasSelection || needsDisambiguation || this._loading}>
            ${this._loading ? 'Starting...' : 'Start Review'}
          </button>
        </div>
      </div>
    `;
  }
}

customElements.define('review-selector', ReviewSelector);