/**
 * File Navigation Graph — 2D spatial graph for file navigation.
 *
 * Every file-open action creates a new node adjacent to the current node.
 * Alt+Arrow keys traverse edges spatially. A fullscreen HUD overlay appears
 * while Alt is held, showing graph structure and current position.
 */

import { LitElement, html, css, svg, nothing } from 'lit';
import { theme } from '../styles/theme.js';

// --- Constants ---

const MAX_NODES = 200;
const GRID_SPACING_X = 180;
const GRID_SPACING_Y = 100;
const NODE_WIDTH = 150;
const NODE_HEIGHT = 48;
const NODE_RADIUS = 8;
const FADE_DURATION = 150;
const UNDO_TIMEOUT = 3000;

// Priority order for placing new nodes
const PLACEMENT_ORDER = ['right', 'up', 'down', 'left'];

// Reverse priority for eviction tie-breaking (least-preferred first)
const EVICTION_ORDER = ['left', 'down', 'up', 'right'];

// Direction → grid offset
const DIR_OFFSET = {
  right: { dx: 1, dy: 0 },
  left:  { dx: -1, dy: 0 },
  up:    { dx: 0, dy: -1 },
  down:  { dx: 0, dy: 1 },
};

// Opposite direction
const OPPOSITE = {
  right: 'left',
  left: 'right',
  up: 'down',
  down: 'up',
};

// File extension → color
const EXT_COLORS = {
  '.c': '#f87171', '.h': '#f87171',
  '.cpp': '#fb923c', '.cc': '#fb923c', '.hpp': '#fb923c', '.cxx': '#fb923c',
  '.js': '#facc15', '.jsx': '#facc15', '.mjs': '#facc15',
  '.ts': '#a3e635', '.tsx': '#a3e635',
  '.md': '#4ade80', '.txt': '#4ade80', '.rst': '#4ade80',
  '.json': '#2dd4bf', '.yaml': '#2dd4bf', '.yml': '#2dd4bf', '.toml': '#2dd4bf', '.xml': '#2dd4bf',
  '.py': '#60a5fa', '.pyi': '#60a5fa',
  '.svg': '#c084fc',
  '.css': '#f472b6', '.scss': '#f472b6', '.html': '#f472b6',
};
const DEFAULT_COLOR = '#9ca3af';

function _getColor(path) {
  if (!path) return DEFAULT_COLOR;
  const dot = path.lastIndexOf('.');
  if (dot === -1) return DEFAULT_COLOR;
  const ext = path.slice(dot).toLowerCase();
  return EXT_COLORS[ext] || DEFAULT_COLOR;
}

function _basename(path) {
  if (!path) return '';
  const slash = path.lastIndexOf('/');
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  return name.length > 22 ? name.slice(0, 19) + '…' : name;
}

/**
 * Create a graph node.
 */
function _createNode(id, path, gridX, gridY) {
  return {
    id,
    path,
    gridX,
    gridY,
    edges: {},         // direction → neighbor node id
    travelCounts: {},  // direction → count
  };
}

export class AcFileNav extends LitElement {
  static properties = {
    visible: { type: Boolean, reflect: true },
    _currentNodeId: { type: Number, state: true },
    _renderTick: { type: Number, state: true },
  };

  static styles = [theme, css`
    :host {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 20000;
      pointer-events: none;
      opacity: 0;
      transition: opacity ${FADE_DURATION}ms ease;
    }
    :host([visible]) {
      opacity: 1;
      pointer-events: auto;
    }

    .hud-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(13, 17, 23, 0.88);
    }

    .hud-canvas {
      position: absolute;
      inset: 0;
      overflow: hidden;
    }

    .graph-layer {
      position: absolute;
      transition: transform 200ms ease;
    }

    /* Edges */
    .edge-line {
      stroke: rgba(201, 209, 217, 0.25);
      stroke-width: 2;
    }
    .edge-label {
      fill: var(--text-muted, #6e7681);
      font-size: 11px;
      font-family: var(--font-mono);
      text-anchor: middle;
      dominant-baseline: central;
      pointer-events: none;
    }

    /* Nodes */
    .node-group {
      cursor: pointer;
    }
    .node-rect {
      rx: ${NODE_RADIUS};
      ry: ${NODE_RADIUS};
      stroke-width: 2;
      transition: fill 200ms, stroke 200ms;
    }
    .node-label {
      fill: var(--text-primary, #c9d1d9);
      font-size: 12px;
      font-family: var(--font-mono);
      text-anchor: middle;
      dominant-baseline: central;
      pointer-events: none;
      user-select: none;
    }
    .node-current .node-rect {
      stroke: #ffffff !important;
      stroke-width: 3;
      filter: brightness(1.3);
    }
    .node-same-file .node-rect {
      filter: brightness(1.15);
    }

    @keyframes node-pulse {
      0%, 100% { filter: brightness(1.3); }
      50% { filter: brightness(1.6); }
    }
    .node-current .node-rect {
      animation: node-pulse 2s ease-in-out infinite;
    }

    /* Clear button */
    .clear-btn {
      position: absolute;
      bottom: 20px;
      right: 20px;
      padding: 6px 16px;
      border: 1px solid var(--border-primary, #30363d);
      border-radius: var(--radius-md, 8px);
      background: var(--bg-tertiary, #21262d);
      color: var(--text-secondary, #8b949e);
      font-size: 0.8rem;
      cursor: pointer;
      z-index: 1;
    }
    .clear-btn:hover {
      background: var(--bg-secondary, #161b22);
      color: var(--text-primary, #c9d1d9);
    }

    /* Undo toast */
    .undo-toast {
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 16px;
      border: 1px solid var(--accent-orange, #f0883e);
      border-radius: var(--radius-md, 8px);
      background: var(--bg-tertiary, #21262d);
      color: var(--text-secondary, #8b949e);
      font-size: 0.8rem;
      z-index: 1;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .undo-toast button {
      padding: 3px 12px;
      border: 1px solid var(--accent-orange);
      border-radius: var(--radius-sm, 4px);
      background: transparent;
      color: var(--accent-orange);
      cursor: pointer;
      font-size: 0.8rem;
    }
    .undo-toast button:hover {
      background: rgba(240, 136, 62, 0.15);
    }

    /* Context menu */
    .ctx-menu {
      position: absolute;
      z-index: 2;
      background: var(--bg-secondary, #161b22);
      border: 1px solid var(--border-primary, #30363d);
      border-radius: 6px;
      padding: 4px 0;
      box-shadow: var(--shadow-md);
      min-width: 140px;
    }
    .ctx-menu button {
      display: block;
      width: 100%;
      padding: 6px 14px;
      background: none;
      border: none;
      color: var(--text-primary);
      font-size: 0.75rem;
      cursor: pointer;
      text-align: left;
    }
    .ctx-menu button:hover {
      background: var(--bg-tertiary);
    }
    .ctx-menu button[disabled] {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* Empty hint */
    .empty-hint {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: var(--text-muted);
      font-size: 0.9rem;
    }
  `];

  constructor() {
    super();
    /** @type {Map<number, object>} */
    this._nodes = new Map();
    this._currentNodeId = null;
    this._nextId = 1;
    this._renderTick = 0;
    this.visible = false;

    this._undoState = null;
    this._undoTimer = null;

    this._ctxMenu = null; // { x, y, nodeId }
    this._fadeTimer = null;
  }

  // === Public API ===

  /**
   * Called by app shell when any file-open action occurs.
   * Creates a node if the current node references a different path.
   * @param {string} path
   * @returns {{ path: string, created: boolean }}
   */
  openFile(path) {
    if (!path) return { path, created: false };

    // If current node references same file, suppress
    const current = this._currentNodeId != null ? this._nodes.get(this._currentNodeId) : null;
    if (current && current.path === path) {
      return { path, created: false };
    }

    // First node ever
    if (!current) {
      const node = _createNode(this._nextId++, path, 0, 0);
      this._nodes.set(node.id, node);
      this._currentNodeId = node.id;
      this._tick();
      return { path, created: true };
    }

    // Find first available slot in priority order
    let dir = null;
    for (const d of PLACEMENT_ORDER) {
      if (current.edges[d] == null) {
        dir = d;
        break;
      }
    }

    // All slots occupied — evict least-traveled
    if (dir == null) {
      dir = this._evictEdge(current);
    }

    // Compute target grid position
    const offset = DIR_OFFSET[dir];
    const gx = current.gridX + offset.dx;
    const gy = current.gridY + offset.dy;

    // Grid collision — remove existing node at target position
    this._removeNodeAtGrid(gx, gy);

    // Enforce size limit
    this._enforceSizeLimit();

    // Create new node
    const newNode = _createNode(this._nextId++, path, gx, gy);
    this._nodes.set(newNode.id, newNode);

    // Create bidirectional edge
    this._linkNodes(current, dir, newNode);

    this._currentNodeId = newNode.id;
    this._tick();
    return { path, created: true };
  }

  /**
   * Called on Alt+Arrow. Returns the file path of the neighbor, or null.
   * @param {'left'|'right'|'up'|'down'} dir
   * @returns {string|null}
   */
  navigateDirection(dir) {
    const current = this._currentNodeId != null ? this._nodes.get(this._currentNodeId) : null;
    if (!current) return null;

    const neighborId = current.edges[dir];
    if (neighborId == null) return null;

    const neighbor = this._nodes.get(neighborId);
    if (!neighbor) return null;

    // Increment travel count on both ends
    current.travelCounts[dir] = (current.travelCounts[dir] || 0) + 1;
    const oppDir = OPPOSITE[dir];
    neighbor.travelCounts[oppDir] = (neighbor.travelCounts[oppDir] || 0) + 1;

    this._currentNodeId = neighbor.id;
    this._tick();
    return neighbor.path;
  }

  /**
   * Show the HUD overlay.
   */
  show() {
    if (this._fadeTimer) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
    this.visible = true;
  }

  /**
   * Trigger the 150ms fade-out.
   */
  hide() {
    this._dismissCtxMenu();
    // Instant hide — attribute removal triggers CSS transition
    this.visible = false;
  }

  /**
   * Dismiss HUD immediately (e.g. Escape).
   */
  hideImmediate() {
    this._dismissCtxMenu();
    this.visible = false;
  }

  /**
   * Reset the graph, keeping current file as root.
   */
  clear() {
    const current = this._currentNodeId != null ? this._nodes.get(this._currentNodeId) : null;
    const currentPath = current?.path;

    this._nodes.clear();
    this._currentNodeId = null;
    this._nextId = 1;
    this._undoState = null;
    this._dismissCtxMenu();

    if (currentPath) {
      const node = _createNode(this._nextId++, currentPath, 0, 0);
      this._nodes.set(node.id, node);
      this._currentNodeId = node.id;
    }

    this._tick();
  }

  /**
   * Whether the graph has any nodes.
   */
  get hasNodes() {
    return this._nodes.size > 0;
  }

  // === Internal: Graph Operations ===

  _tick() {
    this._renderTick++;
  }

  _linkNodes(nodeA, dir, nodeB) {
    // If nodeB already has something in the opposite slot, clear that first
    const oppDir = OPPOSITE[dir];
    if (nodeB.edges[oppDir] != null) {
      const oldNeighborId = nodeB.edges[oppDir];
      const oldNeighbor = this._nodes.get(oldNeighborId);
      if (oldNeighbor) {
        delete oldNeighbor.edges[dir];
        delete oldNeighbor.travelCounts[dir];
      }
      delete nodeB.edges[oppDir];
      delete nodeB.travelCounts[oppDir];
    }

    nodeA.edges[dir] = nodeB.id;
    nodeB.edges[oppDir] = nodeA.id;
    nodeA.travelCounts[dir] = nodeA.travelCounts[dir] || 0;
    nodeB.travelCounts[oppDir] = nodeB.travelCounts[oppDir] || 0;
  }

  _evictEdge(node) {
    // Find edge with lowest travel count
    let minCount = Infinity;
    let evictDir = null;

    for (const d of EVICTION_ORDER) {
      if (node.edges[d] == null) continue;
      const count = (node.travelCounts[d] || 0);
      if (count < minCount) {
        minCount = count;
        evictDir = d;
      }
    }

    if (!evictDir) {
      // Shouldn't happen if all 4 are occupied, but fallback
      evictDir = 'left';
    }

    // Capture undo state before evicting
    const evictedNeighborId = node.edges[evictDir];
    const evictedNeighbor = this._nodes.get(evictedNeighborId);
    const evictedTravelCount = node.travelCounts[evictDir] || 0;
    const oppDir = OPPOSITE[evictDir];
    const neighborTravelCount = evictedNeighbor ? (evictedNeighbor.travelCounts[oppDir] || 0) : 0;

    // Remove the edge (disconnect, but leave the neighbor node in the graph)
    if (evictedNeighbor) {
      delete evictedNeighbor.edges[oppDir];
      delete evictedNeighbor.travelCounts[oppDir];
    }
    delete node.edges[evictDir];
    delete node.travelCounts[evictDir];

    // Set undo state
    this._clearUndoTimer();
    this._undoState = {
      nodeId: node.id,
      dir: evictDir,
      neighborId: evictedNeighborId,
      neighborPath: evictedNeighbor?.path || '',
      travelCount: evictedTravelCount,
      neighborTravelCount,
    };
    this._undoTimer = setTimeout(() => {
      this._undoState = null;
      this._tick();
    }, UNDO_TIMEOUT);

    return evictDir;
  }

  _performUndo() {
    if (!this._undoState) return;

    const { nodeId, dir, neighborId, travelCount, neighborTravelCount } = this._undoState;
    const node = this._nodes.get(nodeId);
    const neighbor = this._nodes.get(neighborId);

    if (!node || !neighbor) {
      this._undoState = null;
      this._clearUndoTimer();
      this._tick();
      return;
    }

    // Remove the new node that was placed in the freed slot
    const newNodeId = node.edges[dir];
    if (newNodeId != null) {
      this._removeNode(newNodeId);
    }

    // Restore the evicted edge
    const oppDir = OPPOSITE[dir];
    node.edges[dir] = neighborId;
    node.travelCounts[dir] = travelCount;
    neighbor.edges[oppDir] = nodeId;
    neighbor.travelCounts[oppDir] = neighborTravelCount;

    this._undoState = null;
    this._clearUndoTimer();
    this._tick();
  }

  _clearUndoTimer() {
    if (this._undoTimer) {
      clearTimeout(this._undoTimer);
      this._undoTimer = null;
    }
  }

  _removeNodeAtGrid(gx, gy) {
    for (const [id, node] of this._nodes) {
      if (node.gridX === gx && node.gridY === gy) {
        this._removeNode(id);
        return;
      }
    }
  }

  _removeNode(id) {
    const node = this._nodes.get(id);
    if (!node) return;

    // Clear all edges to/from this node
    for (const [dir, neighborId] of Object.entries(node.edges)) {
      const neighbor = this._nodes.get(neighborId);
      if (neighbor) {
        const oppDir = OPPOSITE[dir];
        delete neighbor.edges[oppDir];
        delete neighbor.travelCounts[oppDir];
      }
    }

    this._nodes.delete(id);

    // If we removed the current node, the caller must handle that
    if (this._currentNodeId === id) {
      this._currentNodeId = null;
    }
  }

  _enforceSizeLimit() {
    while (this._nodes.size >= MAX_NODES) {
      let victimId = null;
      let victimScore = Infinity;
      let victimAge = Infinity;

      for (const [id, node] of this._nodes) {
        if (id === this._currentNodeId) continue;
        const totalTravel = Object.values(node.travelCounts).reduce((s, v) => s + v, 0);
        if (totalTravel < victimScore || (totalTravel === victimScore && id < victimAge)) {
          victimScore = totalTravel;
          victimId = id;
          victimAge = id;
        }
      }

      if (victimId != null) {
        this._removeNode(victimId);
      } else {
        break; // only current node left
      }
    }
  }

  // === Context Menu ===

  _onNodeRightClick(e, nodeId) {
    e.preventDefault();
    e.stopPropagation();

    const rect = this.shadowRoot.querySelector('.hud-canvas')?.getBoundingClientRect();
    if (!rect) return;

    this._ctxMenu = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      nodeId,
    };
    this._tick();
  }

  _dismissCtxMenu() {
    if (this._ctxMenu) {
      this._ctxMenu = null;
      this._tick();
    }
  }

  _ctxRemoveNode() {
    if (!this._ctxMenu) return;
    const nodeId = this._ctxMenu.nodeId;
    this._dismissCtxMenu();

    if (nodeId === this._currentNodeId) return; // can't remove current

    this._removeNode(nodeId);
    this._tick();
  }

  // === HUD Click ===

  _onNodeClick(e, nodeId) {
    e.stopPropagation();
    this._dismissCtxMenu();

    const node = this._nodes.get(nodeId);
    if (!node) return;

    // Teleport — no edge created, no travel counts changed
    this._currentNodeId = nodeId;
    this._tick();

    // Dispatch navigate event
    window.dispatchEvent(new CustomEvent('navigate-file', {
      detail: { path: node.path, _fromNav: true },
    }));
  }

  _onBackdropClick() {
    this._dismissCtxMenu();
  }

  // === Rendering ===

  _getViewTransform() {
    const current = this._currentNodeId != null ? this._nodes.get(this._currentNodeId) : null;
    if (!current) return { tx: 0, ty: 0 };

    // Center current node in viewport
    // We'll compute in render using the canvas dimensions
    return {
      centerX: current.gridX,
      centerY: current.gridY,
    };
  }

  render() {
    const nodes = [...this._nodes.values()];
    const current = this._currentNodeId != null ? this._nodes.get(this._currentNodeId) : null;
    const currentPath = current?.path;

    if (nodes.length === 0) {
      return html`
        <div class="hud-backdrop"></div>
        <div class="hud-canvas">
          <div class="empty-hint">Open a file to start the navigation graph</div>
        </div>
      `;
    }

    // Compute pixel positions: center current node in viewport
    // Viewport center assumed at 50vw, 50vh
    const cx = current ? current.gridX : 0;
    const cy = current ? current.gridY : 0;

    // Build edges for SVG
    const edges = [];
    const edgeSeen = new Set();
    for (const node of nodes) {
      for (const [dir, neighborId] of Object.entries(node.edges)) {
        const key = [Math.min(node.id, neighborId), Math.max(node.id, neighborId)].join('-');
        if (edgeSeen.has(key)) continue;
        edgeSeen.add(key);

        const neighbor = this._nodes.get(neighborId);
        if (!neighbor) continue;

        const travelCount = (node.travelCounts[dir] || 0);
        edges.push({
          x1: node.gridX * GRID_SPACING_X,
          y1: node.gridY * GRID_SPACING_Y,
          x2: neighbor.gridX * GRID_SPACING_X,
          y2: neighbor.gridY * GRID_SPACING_Y,
          count: travelCount,
        });
      }
    }

    const offsetX = -(cx * GRID_SPACING_X);
    const offsetY = -(cy * GRID_SPACING_Y);

    return html`
      <div class="hud-backdrop" @click=${this._onBackdropClick}></div>
      <div class="hud-canvas" @contextmenu=${(e) => e.preventDefault()}>
        <div class="graph-layer"
             style="transform: translate(calc(50vw + ${offsetX}px), calc(50vh + ${offsetY}px))">
          <svg width="100%" height="100%"
               style="position:absolute;top:0;left:0;overflow:visible;pointer-events:none;">
            ${edges.map(e => svg`
              <line class="edge-line"
                    x1="${e.x1}" y1="${e.y1}"
                    x2="${e.x2}" y2="${e.y2}" />
              ${e.count > 0 ? svg`
                <text class="edge-label"
                      x="${(e.x1 + e.x2) / 2}"
                      y="${(e.y1 + e.y2) / 2 - 6}">
                  ${e.count}
                </text>
              ` : nothing}
            `)}
          </svg>
          ${nodes.map(node => {
            const px = node.gridX * GRID_SPACING_X;
            const py = node.gridY * GRID_SPACING_Y;
            const isCurrent = node.id === this._currentNodeId;
            const isSameFile = !isCurrent && currentPath && node.path === currentPath;
            const color = _getColor(node.path);
            const classes = [
              'node-group',
              isCurrent ? 'node-current' : '',
              isSameFile ? 'node-same-file' : '',
            ].filter(Boolean).join(' ');

            return html`
              <svg class="${classes}"
                   style="position:absolute;left:${px - NODE_WIDTH / 2}px;top:${py - NODE_HEIGHT / 2}px;width:${NODE_WIDTH}px;height:${NODE_HEIGHT}px;overflow:visible;cursor:pointer;pointer-events:auto"
                   @click=${(e) => this._onNodeClick(e, node.id)}
                   @contextmenu=${(e) => this._onNodeRightClick(e, node.id)}>
                <title>${node.path}</title>
                <rect class="node-rect"
                      x="0" y="0"
                      width="${NODE_WIDTH}" height="${NODE_HEIGHT}"
                      fill="${color}22"
                      stroke="${color}" />
                <text class="node-label"
                      x="${NODE_WIDTH / 2}" y="${NODE_HEIGHT / 2}">
                  ${_basename(node.path)}
                </text>
              </svg>
            `;
          })}
        </div>

        ${this._ctxMenu ? html`
          <div class="ctx-menu"
               style="left:${this._ctxMenu.x}px;top:${this._ctxMenu.y}px"
               @click=${(e) => e.stopPropagation()}>
            <button
              ?disabled=${this._ctxMenu.nodeId === this._currentNodeId}
              @click=${() => this._ctxRemoveNode()}>
              Remove node
            </button>
          </div>
        ` : nothing}

        <button class="clear-btn" @click=${() => this.clear()}>Clear</button>

        ${this._undoState ? html`
          <div class="undo-toast">
            Edge to ${_basename(this._undoState.neighborPath)} dropped
            <button @click=${() => this._performUndo()}>Undo</button>
          </div>
        ` : nothing}
      </div>
    `;
  }
}

customElements.define('ac-file-nav', AcFileNav);