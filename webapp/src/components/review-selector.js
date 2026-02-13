/**
 * Review Selector — floating dialog with SVG git graph.
 *
 * Renders a commit graph with stable lane columns, frozen branch legend,
 * lazy loading, and commit click selection for code review.
 */

import { LitElement, html, css, nothing, svg } from 'lit';
import { theme, scrollbarStyles } from '../styles/theme.js';
import { RpcMixin } from '../rpc-mixin.js';

// Lane color palette
const LANE_COLORS = [
  '#4fc3f7', '#50c878', '#f59e0b', '#f97316', '#a78bfa',
  '#f472b6', '#2dd4bf', '#60a5fa', '#fb923c', '#e879f9',
];

const ROW_HEIGHT = 36;
const LANE_WIDTH = 24;
const NODE_RADIUS = 5;
const GRAPH_LEFT_PAD = 16;

export class AcReviewSelector extends RpcMixin(LitElement) {
  static properties = {
    _commits: { type: Array, state: true },
    _branches: { type: Array, state: true },
    _hasMore: { type: Boolean, state: true },
    _loading: { type: Boolean, state: true },
    _selectedCommit: { type: String, state: true },
    _selectedBranch: { type: String, state: true },
    _disambiguate: { type: Object, state: true },
    _cleanCheck: { type: Object, state: true },
    _starting: { type: Boolean, state: true },
    _showRemotes: { type: Boolean, state: true },
    _hiddenBranches: { type: Object, state: true },
    _visible: { type: Boolean, state: true },
    _error: { type: String, state: true },
  };

  static styles = [theme, scrollbarStyles, css`
    :host {
      display: block;
      position: fixed;
      z-index: 500;
      top: 15%;
      left: 20%;
      width: 60%;
      height: 70%;
      min-width: 400px;
      min-height: 300px;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: -1;
    }

    .dialog {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      overflow: hidden;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-primary);
      cursor: grab;
      user-select: none;
    }
    .header:active { cursor: grabbing; }
    .header-title {
      font-weight: 600;
      font-size: 0.9rem;
      color: var(--text-primary);
    }
    .header-spacer { flex: 1; }
    .close-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1rem;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
    }
    .close-btn:hover {
      color: var(--text-primary);
      background: var(--bg-secondary);
    }

    /* Branch legend */
    .legend {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border-primary);
      background: var(--bg-primary);
      flex-wrap: wrap;
      overflow-x: auto;
    }
    .legend-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.7rem;
      padding: 2px 8px;
      border-radius: 10px;
      border: 1px solid var(--border-primary);
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
      transition: opacity 0.15s;
    }
    .legend-chip.hidden { opacity: 0.35; }
    .legend-chip .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .legend-chip.current {
      border-color: var(--accent-primary);
      font-weight: 600;
    }
    .legend-chip.remote {
      border-style: dashed;
    }
    .remote-toggle {
      background: none;
      border: 1px solid var(--border-primary);
      color: var(--text-muted);
      font-size: 0.65rem;
      padding: 2px 6px;
      border-radius: 10px;
      cursor: pointer;
      white-space: nowrap;
    }
    .remote-toggle:hover { color: var(--text-primary); }
    .remote-toggle.active {
      border-color: var(--accent-primary);
      color: var(--accent-primary);
    }

    /* Graph area */
    .graph-scroll {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      position: relative;
    }
    .graph-svg {
      display: block;
    }

    /* Commit row (SVG overlay for text) */
    .commit-row {
      cursor: pointer;
    }
    .commit-row:hover rect.row-bg {
      fill: rgba(255, 255, 255, 0.03);
    }
    .commit-row.selected rect.row-bg {
      fill: rgba(79, 195, 247, 0.1);
    }

    /* Footer / action bar */
    .footer {
      padding: 10px 16px;
      border-top: 1px solid var(--border-primary);
      background: var(--bg-tertiary);
      min-height: 48px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .footer-hint {
      color: var(--text-muted);
      font-size: 0.8rem;
    }
    .review-summary {
      flex: 1;
      font-size: 0.8rem;
      color: var(--text-secondary);
    }
    .review-summary strong {
      color: var(--accent-primary);
    }
    .start-btn {
      background: var(--accent-primary);
      border: none;
      color: var(--bg-primary);
      font-size: 0.8rem;
      font-weight: 600;
      padding: 6px 16px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      white-space: nowrap;
    }
    .start-btn:hover { opacity: 0.9; }
    .start-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Disambiguate popover */
    .disambiguate {
      position: absolute;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      padding: 4px 0;
      z-index: 10;
      min-width: 140px;
    }
    .disambiguate-item {
      padding: 6px 12px;
      font-size: 0.8rem;
      cursor: pointer;
      color: var(--text-primary);
    }
    .disambiguate-item:hover {
      background: var(--bg-secondary);
    }
    .disambiguate-item.selected {
      color: var(--accent-primary);
      font-weight: 600;
    }

    /* Warning message */
    .warning-box {
      padding: 24px;
      text-align: center;
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--text-secondary);
      font-size: 0.85rem;
    }
    .warning-box .icon { font-size: 1.5rem; }
    .warning-box pre {
      background: var(--bg-primary);
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 0.8rem;
      text-align: left;
    }

    /* Loading */
    .loading-sentinel {
      text-align: center;
      padding: 8px;
      color: var(--text-muted);
      font-size: 0.75rem;
    }

    .starting-indicator {
      color: var(--accent-primary);
      font-size: 0.8rem;
    }
  `];

  constructor() {
    super();
    this._commits = [];
    this._branches = [];
    this._hasMore = false;
    this._loading = false;
    this._selectedCommit = null;
    this._selectedBranch = null;
    this._disambiguate = null;
    this._cleanCheck = null;
    this._starting = false;
    this._showRemotes = false;
    this._hiddenBranches = new Set();
    this._visible = false;
    this._error = null;

    // Layout data computed from commits
    this._laneMap = new Map();   // sha → lane index
    this._branchLanes = [];      // [{name, lane, color}]
    this._forkEdges = [];        // [{fromRow, fromLane, toRow, toLane}]
    this._maxLane = 0;
  }

  show() {
    this._visible = true;
    this._checkClean();
  }

  hide() {
    this._visible = false;
    this._disambiguate = null;
    this.dispatchEvent(new CustomEvent('review-selector-close', {
      bubbles: true, composed: true,
    }));
  }

  async _checkClean() {
    try {
      const result = await this.rpcExtract('LLMService.check_review_ready');
      this._cleanCheck = result;
      if (result?.clean) {
        await this._loadGraph();
      }
    } catch (e) {
      this._error = e.message || 'Failed to check working tree';
    }
  }

  async _loadGraph(offset = 0) {
    if (this._loading) return;
    this._loading = true;
    try {
      const result = await this.rpcExtract(
        'LLMService.get_commit_graph', 100, offset, this._showRemotes
      );
      if (result?.error) {
        this._error = result.error;
        return;
      }
      if (offset === 0) {
        this._commits = result.commits || [];
        this._branches = result.branches || [];
      } else {
        this._commits = [...this._commits, ...(result.commits || [])];
      }
      this._hasMore = result.has_more || false;
      this._computeLayout();
    } catch (e) {
      this._error = e.message || 'Failed to load commit graph';
    } finally {
      this._loading = false;
    }
  }

  async _loadMore() {
    if (this._loading || !this._hasMore) return;
    await this._loadGraph(this._commits.length);
  }

  async _toggleRemotes() {
    this._showRemotes = !this._showRemotes;
    this._selectedCommit = null;
    this._selectedBranch = null;
    this._disambiguate = null;
    await this._loadGraph(0);
  }

  _toggleBranchVisibility(name) {
    const next = new Set(this._hiddenBranches);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this._hiddenBranches = next;
  }

  // === Layout Algorithm ===

  _computeLayout() {
    const commits = this._commits;
    const branches = this._branches;
    if (!commits.length) return;

    // Sort branches: current first, then local, then remote, preserving order within
    const sorted = [...branches].sort((a, b) => {
      if (a.is_current !== b.is_current) return a.is_current ? -1 : 1;
      if (a.is_remote !== b.is_remote) return a.is_remote ? 1 : -1;
      return 0;
    });

    // Assign lanes to branches, dedup shared tips
    const tipToLane = new Map();
    const branchLanes = [];
    let nextLane = 0;

    for (const br of sorted) {
      // Dedup: remote branches sharing tip with local get same lane
      if (tipToLane.has(br.sha)) {
        branchLanes.push({ name: br.name, lane: tipToLane.get(br.sha), color: LANE_COLORS[tipToLane.get(br.sha) % LANE_COLORS.length], sha: br.sha, is_current: br.is_current, is_remote: br.is_remote });
        continue;
      }
      const lane = nextLane++;
      tipToLane.set(br.sha, lane);
      branchLanes.push({ name: br.name, lane, color: LANE_COLORS[lane % LANE_COLORS.length], sha: br.sha, is_current: br.is_current, is_remote: br.is_remote });
    }

    // Build SHA → row index
    const shaToRow = new Map();
    for (let i = 0; i < commits.length; i++) {
      shaToRow.set(commits[i].sha, i);
    }

    // First-parent walk: assign each commit to a lane
    const laneMap = new Map();
    const claimed = new Set();

    for (const bl of branchLanes) {
      // Walk from tip following first parent
      let sha = bl.sha;
      while (sha && shaToRow.has(sha) && !claimed.has(sha)) {
        laneMap.set(sha, bl.lane);
        claimed.add(sha);
        const row = shaToRow.get(sha);
        const commit = commits[row];
        sha = commit.parents?.[0] || null;
      }
    }

    // Assign unclaimed commits to a new lane
    for (const c of commits) {
      if (!laneMap.has(c.sha)) {
        laneMap.set(c.sha, nextLane);
      }
    }

    // Compute fork and merge edges
    const forkEdges = [];
    for (let row = 0; row < commits.length; row++) {
      const c = commits[row];
      const myLane = laneMap.get(c.sha) ?? 0;
      for (let pi = 0; pi < (c.parents || []).length; pi++) {
        const psha = c.parents[pi];
        const pRow = shaToRow.get(psha);
        if (pRow === undefined) continue;
        const pLane = laneMap.get(psha) ?? 0;
        if (pLane !== myLane || pi > 0) {
          forkEdges.push({ fromRow: row, fromLane: myLane, toRow: pRow, toLane: pLane, isMerge: pi > 0 });
        }
      }
    }

    this._laneMap = laneMap;
    this._branchLanes = branchLanes;
    this._forkEdges = forkEdges;
    this._maxLane = nextLane;
  }

  // === Commit Selection ===

  _onCommitClick(commit, rowIndex, e) {
    // Find which branches this commit is reachable from
    const candidateBranches = this._branchLanes.filter(bl => {
      // Walk first-parent from this branch tip to see if commit is on this branch
      let sha = bl.sha;
      const visited = new Set();
      while (sha && !visited.has(sha)) {
        if (sha === commit.sha) return true;
        visited.add(sha);
        const row = this._commits.findIndex(c => c.sha === sha);
        if (row < 0) break;
        sha = this._commits[row].parents?.[0] || null;
      }
      return false;
    });

    if (candidateBranches.length === 0) {
      // Fallback: just pick any branch
      this._selectedCommit = commit.sha;
      this._selectedBranch = this._branchLanes[0]?.name || null;
      this._disambiguate = null;
      return;
    }

    if (candidateBranches.length === 1) {
      this._selectedCommit = commit.sha;
      this._selectedBranch = candidateBranches[0].name;
      this._disambiguate = null;
      return;
    }

    // Multiple branches — show disambiguation
    // Pre-select the branch whose lane matches the commit's lane,
    // falling back to the branch with the most commits (longest review range)
    const commitLane = this._laneMap.get(commit.sha);
    const laneMatch = candidateBranches.find(bl => bl.lane === commitLane);

    let preSelected;
    if (laneMatch) {
      preSelected = laneMatch;
    } else {
      // Fall back to the branch with the most commits between selection and tip
      // (i.e., the longest review range — most useful default)
      preSelected = candidateBranches.reduce((best, bl) => {
        let dist = 0;
        let sha = bl.sha;
        while (sha && sha !== commit.sha && dist < 1000) {
          const row = this._commits.findIndex(c => c.sha === sha);
          if (row < 0) break;
          sha = this._commits[row].parents?.[0] || null;
          dist++;
        }
        return (dist > best.dist) ? { bl, dist } : best;
      }, { bl: candidateBranches[0], dist: -1 }).bl;
    }

    const scrollEl = this.shadowRoot?.querySelector('.graph-scroll');
    const rect = scrollEl?.getBoundingClientRect() || { left: 0, top: 0 };
    this._selectedCommit = commit.sha;
    this._selectedBranch = preSelected.name;
    this._disambiguate = {
      candidates: candidateBranches,
      x: (e.clientX - rect.left) + 20,
      y: (rowIndex * ROW_HEIGHT) - (scrollEl?.scrollTop || 0) + ROW_HEIGHT / 2,
    };
  }

  _selectDisambiguatedBranch(name) {
    this._selectedBranch = name;
    this._disambiguate = null;
  }

  // === Start Review ===

  async _startReview() {
    if (!this._selectedCommit || !this._selectedBranch || this._starting) return;

    this._starting = true;
    this._error = null;
    try {
      const result = await this.rpcExtract(
        'LLMService.start_review', this._selectedBranch, this._selectedCommit
      );
      if (result?.error) {
        this._error = result.error;
        return;
      }
      this.dispatchEvent(new CustomEvent('review-started', {
        detail: result,
        bubbles: true, composed: true,
      }));
      this.hide();
    } catch (e) {
      this._error = e.message || 'Failed to start review';
    } finally {
      this._starting = false;
    }
  }

  // === Drag (header) ===

  _onHeaderMouseDown(e) {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = this.getBoundingClientRect();
    const startLeft = rect.left;
    const startTop = rect.top;

    const onMove = (me) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      this.style.left = `${startLeft + dx}px`;
      this.style.top = `${startTop + dy}px`;
      this.style.right = 'auto';
      this.style.bottom = 'auto';
      this.style.width = `${rect.width}px`;
      this.style.height = `${rect.height}px`;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // === Scroll loading ===

  _onGraphScroll(e) {
    const el = e.target;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      this._loadMore();
    }
    // Close disambiguate on scroll
    if (this._disambiguate) this._disambiguate = null;
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this._disambiguate) {
        this._disambiguate = null;
      } else {
        this.hide();
      }
    }
  }

  _onBackdropClick(e) {
    if (e.target === e.currentTarget || e.target.classList.contains('backdrop')) {
      this.hide();
    }
  }

  // === SVG Rendering ===

  _renderGraph() {
    const commits = this._commits;
    if (!commits.length) return html`<div class="warning-box"><span>No commits found</span></div>`;

    const visibleBranches = new Set(
      this._branchLanes
        .filter(bl => !this._hiddenBranches.has(bl.name))
        .map(bl => bl.name)
    );

    const graphWidth = GRAPH_LEFT_PAD + (this._maxLane + 1) * LANE_WIDTH;
    const textX = graphWidth + 12;
    const totalWidth = Math.max(600, textX + 400);
    const totalHeight = commits.length * ROW_HEIGHT + 20;

    // Build branch tip SHA set for labels
    const tipShas = new Map();
    for (const bl of this._branchLanes) {
      if (!tipShas.has(bl.sha)) tipShas.set(bl.sha, []);
      tipShas.get(bl.sha).push(bl);
    }

    return html`
      <svg class="graph-svg" width="${totalWidth}" height="${totalHeight}"
           xmlns="http://www.w3.org/2000/svg">

        <!-- Vertical lane lines -->
        ${this._branchLanes.filter(bl => !this._hiddenBranches.has(bl.name)).map(bl => {
          // Find row range for this lane
          let minRow = commits.length, maxRow = 0;
          for (let i = 0; i < commits.length; i++) {
            if (this._laneMap.get(commits[i].sha) === bl.lane) {
              minRow = Math.min(minRow, i);
              maxRow = Math.max(maxRow, i);
            }
          }
          if (minRow > maxRow) return nothing;
          const x = GRAPH_LEFT_PAD + bl.lane * LANE_WIDTH + LANE_WIDTH / 2;
          return svg`<line
            x1="${x}" y1="${minRow * ROW_HEIGHT + ROW_HEIGHT / 2}"
            x2="${x}" y2="${maxRow * ROW_HEIGHT + ROW_HEIGHT / 2}"
            stroke="${bl.color}" stroke-width="2" opacity="0.4"
            stroke-dasharray="${bl.is_remote ? '4,3' : 'none'}"
          />`;
        })}

        <!-- Fork/merge edges -->
        ${this._forkEdges.map(edge => {
          const x1 = GRAPH_LEFT_PAD + edge.fromLane * LANE_WIDTH + LANE_WIDTH / 2;
          const y1 = edge.fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
          const x2 = GRAPH_LEFT_PAD + edge.toLane * LANE_WIDTH + LANE_WIDTH / 2;
          const y2 = edge.toRow * ROW_HEIGHT + ROW_HEIGHT / 2;
          const my = (y1 + y2) / 2;
          const color = LANE_COLORS[edge.fromLane % LANE_COLORS.length];
          return svg`<path
            d="M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}"
            fill="none" stroke="${color}" stroke-width="1.5" opacity="0.5"
            stroke-dasharray="${edge.isMerge ? '4,3' : 'none'}"
          />`;
        })}

        <!-- Commit nodes and text -->
        ${commits.map((c, i) => {
          const lane = this._laneMap.get(c.sha) ?? 0;
          const color = LANE_COLORS[lane % LANE_COLORS.length];
          const cx = GRAPH_LEFT_PAD + lane * LANE_WIDTH + LANE_WIDTH / 2;
          const cy = i * ROW_HEIGHT + ROW_HEIGHT / 2;
          const isSelected = c.sha === this._selectedCommit;
          const branchLabels = tipShas.get(c.sha) || [];

          return svg`
            <g class="commit-row ${isSelected ? 'selected' : ''}"
               @click=${(e) => this._onCommitClick(c, i, e)}>
              <rect class="row-bg" x="0" y="${i * ROW_HEIGHT}"
                    width="${totalWidth}" height="${ROW_HEIGHT}"
                    fill="transparent" />
              ${isSelected ? svg`
                <circle cx="${cx}" cy="${cy}" r="${NODE_RADIUS + 3}"
                        fill="none" stroke="${color}" stroke-width="2" opacity="0.5" />
              ` : nothing}
              <circle cx="${cx}" cy="${cy}" r="${NODE_RADIUS}"
                      fill="${color}" />
              ${branchLabels.map((bl, bi) => svg`
                <rect x="${cx + NODE_RADIUS + 4 + bi * 80}" y="${cy - 8}"
                      width="${75}" height="16" rx="3"
                      fill="${bl.color}" opacity="0.2" />
                <text x="${cx + NODE_RADIUS + 7 + bi * 80}" y="${cy + 3}"
                      font-size="9" fill="${bl.color}" font-weight="600">
                  ${bl.name.length > 12 ? bl.name.slice(0, 11) + '…' : bl.name}
                </text>
              `)}
              <text x="${textX}" y="${cy - 2}" font-size="11" fill="var(--text-primary)">
                <tspan font-family="var(--font-mono)" font-size="10" fill="var(--text-muted)">${c.short_sha}</tspan>
                <tspan dx="6">${c.message?.length > 60 ? c.message.slice(0, 59) + '…' : c.message}</tspan>
              </text>
              <text x="${textX}" y="${cy + 12}" font-size="9" fill="var(--text-muted)">
                ${c.author} · ${c.relative_date}
              </text>
            </g>
          `;
        })}
      </svg>
    `;
  }

  // === Main Render ===

  render() {
    if (!this._visible) return nothing;

    // If working tree not clean, show warning
    if (this._cleanCheck && !this._cleanCheck.clean) {
      return html`
        <div class="backdrop" @click=${this._onBackdropClick}>
          <div class="dialog" @keydown=${this._onKeyDown} tabindex="0">
            <div class="header" @mousedown=${this._onHeaderMouseDown}>
              <span class="header-title">📋 Code Review</span>
              <span class="header-spacer"></span>
              <button class="close-btn" @click=${() => this.hide()}>✕</button>
            </div>
            <div class="warning-box">
              <span class="icon">⚠️</span>
              <div>Working tree has uncommitted changes</div>
              <div>Cannot start a review with pending changes.<br>Please commit, stash, or discard changes first:</div>
              <pre>git stash\ngit commit -am "wip"\ngit checkout -- &lt;file&gt;</pre>
            </div>
            <div class="footer">
              <span class="header-spacer"></span>
              <button class="close-btn" @click=${() => this.hide()}>Close</button>
            </div>
          </div>
        </div>
      `;
    }

    // Review info for footer
    let selectedInfo = null;
    if (this._selectedCommit && this._selectedBranch) {
      const br = this._branchLanes.find(b => b.name === this._selectedBranch);
      const tipShort = br?.sha?.slice(0, 7) || '?';
      const baseShort = this._selectedCommit.slice(0, 7);

      // Count commits between base and tip
      let commitCount = 0;
      if (br) {
        let sha = br.sha;
        const visited = new Set();
        while (sha && !visited.has(sha)) {
          if (sha === this._selectedCommit) break;
          visited.add(sha);
          commitCount++;
          const row = this._commits.findIndex(c => c.sha === sha);
          if (row < 0) break;
          sha = this._commits[row].parents?.[0] || null;
        }
      }

      selectedInfo = { branch: this._selectedBranch, tipShort, baseShort, commitCount };
    }

    return html`
      <div class="backdrop" @click=${this._onBackdropClick}>
        <div class="dialog" @click=${(e) => e.stopPropagation()} @keydown=${this._onKeyDown} tabindex="0">

          <div class="header" @mousedown=${this._onHeaderMouseDown}>
            <span class="header-title">📋 Code Review</span>
            <span class="header-spacer"></span>
            <button class="close-btn" @click=${() => this.hide()}>✕</button>
          </div>

          <!-- Branch Legend -->
          <div class="legend">
            ${this._branchLanes.map(bl => html`
              <span
                class="legend-chip ${bl.is_current ? 'current' : ''} ${bl.is_remote ? 'remote' : ''} ${this._hiddenBranches.has(bl.name) ? 'hidden' : ''}"
                @click=${() => this._toggleBranchVisibility(bl.name)}
                title="${bl.name}">
                <span class="dot" style="background: ${bl.color}"></span>
                ${bl.name.length > 20 ? bl.name.slice(0, 19) + '…' : bl.name}
              </span>
            `)}
            <button class="remote-toggle ${this._showRemotes ? 'active' : ''}"
              @click=${this._toggleRemotes} title="Toggle remote branches">
              ⊙ remotes
            </button>
          </div>

          <!-- Graph -->
          <div class="graph-scroll" @scroll=${this._onGraphScroll}>
            ${this._loading && this._commits.length === 0
              ? html`<div class="loading-sentinel">Loading commits...</div>`
              : this._error && this._commits.length === 0
                ? html`<div class="warning-box">${this._error}</div>`
                : this._renderGraph()
            }
            ${this._hasMore ? html`
              <div class="loading-sentinel">${this._loading ? 'Loading...' : ''}</div>
            ` : nothing}

            <!-- Disambiguation popover -->
            ${this._disambiguate ? html`
              <div class="disambiguate"
                   style="left: ${this._disambiguate.x}px; top: ${this._disambiguate.y}px"
                   @click=${(e) => e.stopPropagation()}>
                ${this._disambiguate.candidates.map(bl => html`
                  <div class="disambiguate-item ${bl.name === this._selectedBranch ? 'selected' : ''}"
                       @click=${() => this._selectDisambiguatedBranch(bl.name)}>
                    <span style="color: ${bl.color}">●</span> ${bl.name}
                  </div>
                `)}
              </div>
            ` : nothing}
          </div>

          <!-- Footer -->
          <div class="footer">
            ${this._error && this._commits.length > 0
              ? html`<span class="footer-hint" style="color: var(--accent-red)">${this._error}</span>`
              : nothing
            }
            ${!selectedInfo ? html`
              <span class="footer-hint">Click a commit to select the review starting point</span>
            ` : html`
              <div class="review-summary">
                📋 Review: <strong>${selectedInfo.branch}</strong><br>
                ${selectedInfo.baseShort} → ${selectedInfo.tipShort} (HEAD) · ${selectedInfo.commitCount} commits
              </div>
              ${this._starting ? html`
                <span class="starting-indicator">⟳ Starting review...</span>
              ` : html`
                <button class="start-btn" @click=${this._startReview}
                  ?disabled=${this._starting}>Start Review</button>
              `}
            `}
          </div>

        </div>
      </div>
    `;
  }
}

customElements.define('ac-review-selector', AcReviewSelector);