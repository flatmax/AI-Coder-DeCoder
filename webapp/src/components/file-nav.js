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

const GRID_SPACING_X = 180;
const GRID_SPACING_Y = 100;
const NODE_WIDTH = 150;
const NODE_HEIGHT = 48;
const NODE_RADIUS = 8;
const FADE_DURATION = 150;
const UNDO_TIMEOUT = 3000;

// Priority order for placing new nodes in adjacent cells
const PLACEMENT_ORDER = ['right', 'up', 'down', 'left'];

// Reverse priority for replacement tie-breaking (least-preferred first)
const REPLACEMENT_ORDER = ['left', 'down', 'up', 'right'];

// Direction → grid offset
const DIR_OFFSET = {
  right: { dx: 1, dy: 0 },
  left:  { dx: -1, dy: 0 },
  up:    { dx: 0, dy: -1 },
  down:  { dx: 0, dy: 1 },
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
 * Create a grid node.
 */
function _createNode(id, path, gridX, gridY) {
  return { id, path, gridX, gridY };
}

/**
 * Canonical key for a node pair (for travel counts).
 */
function _pairKey(idA, idB) {
  return idA < idB ? `${idA}-${idB}` : `${idB}-${idA}`;
}

/**
 * Grid coordinate key for the spatial index.
 */
function _gridKey(x, y) {
  return `${x},${y}`;
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
    /** @type {Map<number, object>} id → node */
    this._nodes = new Map();
    /** @type {Map<string, number>} "x,y" → node id */
    this._gridIndex = new Map();
    /** @type {Map<string, number>} "minId-maxId" → traversal count */
    this._travelCounts = new Map();
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

    // If an adjacent neighbor already references this file, navigate to it
    if (current) {
      for (const d of PLACEMENT_ORDER) {
        const off = DIR_OFFSET[d];
        const key = _gridKey(current.gridX + off.dx, current.gridY + off.dy);
        const neighborId = this._gridIndex.get(key);
        if (neighborId == null) continue;
        const neighbor = this._nodes.get(neighborId);
        if (neighbor && neighbor.path === path) {
          const pk = _pairKey(current.id, neighbor.id);
          this._travelCounts.set(pk, (this._travelCounts.get(pk) || 0) + 1);
          this._currentNodeId = neighbor.id;
          this._tick();
          return { path, created: false };
        }
      }
    }

    // First node ever
    if (!current) {
      const node = _createNode(this._nextId++, path, 0, 0);
      this._addNode(node);
      this._currentNodeId = node.id;
      this._tick();
      return { path, created: true };
    }

    // Find first free adjacent cell in priority order
    let dir = null;
    for (const d of PLACEMENT_ORDER) {
      const off = DIR_OFFSET[d];
      const key = _gridKey(current.gridX + off.dx, current.gridY + off.dy);
      if (!this._gridIndex.has(key)) {
        dir = d;
        break;
      }
    }

    // All 4 neighbors occupied — replace the least-traveled one
    if (dir == null) {
      dir = this._pickReplacement(current);
    }

    // Compute target grid position
    const offset = DIR_OFFSET[dir];
    const gx = current.gridX + offset.dx;
    const gy = current.gridY + offset.dy;

    // Remove existing node at target position (if any)
    this._removeNodeAtGrid(gx, gy);

    // Create new node
    const newNode = _createNode(this._nextId++, path, gx, gy);
    this._addNode(newNode);

    this._currentNodeId = newNode.id;
    this._tick();
    return { path, created: true };
  }

  /**
   * Called on Alt+Arrow. Returns the file path of the neighbor, or null.
   * If no neighbor exists in the given direction, wraps to the opposite edge
   * of the grid along that axis.
   * @param {'left'|'right'|'up'|'down'} dir
   * @returns {string|null}
   */
  navigateDirection(dir) {
    const current = this._currentNodeId != null ? this._nodes.get(this._currentNodeId) : null;
    if (!current) return null;

    const off = DIR_OFFSET[dir];
    const key = _gridKey(current.gridX + off.dx, current.gridY + off.dy);
    let neighborId = this._gridIndex.get(key);

    // If no direct neighbor, wrap to the opposite edge
    if (neighborId == null) {
      neighborId = this._findWrapTarget(current, dir);
    }

    if (neighborId == null) return null;

    const neighbor = this._nodes.get(neighborId);
    if (!neighbor) return null;

    // Increment travel count for this pair
    const pk = _pairKey(current.id, neighbor.id);
    this._travelCounts.set(pk, (this._travelCounts.get(pk) || 0) + 1);

    this._currentNodeId = neighbor.id;
    this._tick();
    return neighbor.path;
  }

  /**
   * Find the wrap-around target when navigating off the edge of the grid.
   * Scans all nodes along the same row/column and returns the node at
   * the opposite extreme.
   *
   * - left  → rightmost node on the same row
   * - right → leftmost node on the same row
   * - up    → bottommost node on the same column
   * - down  → topmost node on the same column
   *
   * Returns null if no other node exists on that axis, or if the only
   * node found is the current one.
   * @param {object} current - current node
   * @param {'left'|'right'|'up'|'down'} dir
   * @returns {number|null} node id or null
   */
  _findWrapTarget(current, dir) {
    const horizontal = (dir === 'left' || dir === 'right');
    let bestId = null;
    let bestVal = null;

    // For wrapping, we want the opposite extreme:
    //   left  → max gridX (rightmost)
    //   right → min gridX (leftmost)
    //   up    → max gridY (bottommost)
    //   down  → min gridY (topmost)
    const wantMax = (dir === 'left' || dir === 'up');

    for (const node of this._nodes.values()) {
      if (node.id === current.id) continue;

      if (horizontal) {
        // Same row
        if (node.gridY !== current.gridY) continue;
        const val = node.gridX;
        if (bestVal == null
            || (wantMax && val > bestVal)
            || (!wantMax && val < bestVal)) {
          bestVal = val;
          bestId = node.id;
        }
      } else {
        // Same column
        if (node.gridX !== current.gridX) continue;
        const val = node.gridY;
        if (bestVal == null
            || (wantMax && val > bestVal)
            || (!wantMax && val < bestVal)) {
          bestVal = val;
          bestId = node.id;
        }
      }
    }

    return bestId;
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
   * Reset the grid, keeping current file as root.
   */
  clear() {
    const current = this._currentNodeId != null ? this._nodes.get(this._currentNodeId) : null;
    const currentPath = current?.path;

    this._nodes.clear();
    this._gridIndex.clear();
    this._travelCounts.clear();
    this._currentNodeId = null;
    this._nextId = 1;
    this._undoState = null;
    this._dismissCtxMenu();

    if (currentPath) {
      const node = _createNode(this._nextId++, currentPath, 0, 0);
      this._addNode(node);
      this._currentNodeId = node.id;
    }

    this._tick();
  }

  /**
   * Whether the grid has any nodes.
   */
  get hasNodes() {
    return this._nodes.size > 0;
  }

  // === Internal: Grid Operations ===

  _tick() {
    this._renderTick++;
  }

  /**
   * Add a node to both the nodes map and the grid index.
   */
  _addNode(node) {
    this._nodes.set(node.id, node);
    this._gridIndex.set(_gridKey(node.gridX, node.gridY), node.id);
  }

  /**
   * Get the travel count between the current node and a neighbor.
   */
  _getTravelCount(idA, idB) {
    return this._travelCounts.get(_pairKey(idA, idB)) || 0;
  }

  /**
   * Pick which neighbor to replace when all 4 adjacent cells are occupied.
   * Returns the direction of the least-traveled neighbor, with tie-breaking
   * in reverse priority order (left → down → up → right).
   */
  _pickReplacement(current) {
    let minCount = Infinity;
    let replaceDir = null;

    for (const d of REPLACEMENT_ORDER) {
      const off = DIR_OFFSET[d];
      const key = _gridKey(current.gridX + off.dx, current.gridY + off.dy);
      const neighborId = this._gridIndex.get(key);
      if (neighborId == null) continue;
      const count = this._getTravelCount(current.id, neighborId);
      if (count < minCount) {
        minCount = count;
        replaceDir = d;
      }
    }

    // Capture undo state before replacing
    const off = DIR_OFFSET[replaceDir];
    const gx = current.gridX + off.dx;
    const gy = current.gridY + off.dy;
    const replacedId = this._gridIndex.get(_gridKey(gx, gy));
    const replacedNode = replacedId != null ? this._nodes.get(replacedId) : null;

    if (replacedNode) {
      // Collect all travel counts involving the replaced node for undo
      const savedCounts = [];
      for (const [pk, count] of this._travelCounts) {
        if (pk.startsWith(`${replacedNode.id}-`) || pk.endsWith(`-${replacedNode.id}`)) {
          savedCounts.push([pk, count]);
        }
      }

      this._clearUndoTimer();
      this._undoState = {
        currentNodeId: current.id,
        dir: replaceDir,
        replacedNode: { ...replacedNode },
        savedCounts,
      };
      this._undoTimer = setTimeout(() => {
        this._undoState = null;
        this._tick();
      }, UNDO_TIMEOUT);
    }

    return replaceDir;
  }

  _performUndo() {
    if (!this._undoState) return;

    const { currentNodeId, dir, replacedNode, savedCounts } = this._undoState;
    const current = this._nodes.get(currentNodeId);

    if (!current) {
      this._undoState = null;
      this._clearUndoTimer();
      this._tick();
      return;
    }

    // Remove the new node that was placed in the replacement cell
    const off = DIR_OFFSET[dir];
    const gx = current.gridX + off.dx;
    const gy = current.gridY + off.dy;
    const newNodeId = this._gridIndex.get(_gridKey(gx, gy));
    if (newNodeId != null) {
      this._removeNode(newNodeId);
    }

    // Restore the replaced node
    const restored = _createNode(replacedNode.id, replacedNode.path, replacedNode.gridX, replacedNode.gridY);
    this._addNode(restored);

    // Restore travel counts
    for (const [pk, count] of savedCounts) {
      this._travelCounts.set(pk, count);
    }

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
    const key = _gridKey(gx, gy);
    const id = this._gridIndex.get(key);
    if (id != null) {
      this._removeNode(id);
    }
  }

  _removeNode(id) {
    const node = this._nodes.get(id);
    if (!node) return;

    // Remove from grid index
    this._gridIndex.delete(_gridKey(node.gridX, node.gridY));

    // Clear all travel counts involving this node
    for (const pk of [...this._travelCounts.keys()]) {
      if (pk.startsWith(`${id}-`) || pk.endsWith(`-${id}`)) {
        this._travelCounts.delete(pk);
      }
    }

    this._nodes.delete(id);

    if (this._currentNodeId === id) {
      this._currentNodeId = null;
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

    if (nodeId === this._currentNodeId) return;

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
          <div class="empty-hint">Open a file to start the navigation grid</div>
        </div>
      `;
    }

    // Compute pixel positions: center current node in viewport
    // Viewport center assumed at 50vw, 50vh
    const cx = current ? current.gridX : 0;
    const cy = current ? current.gridY : 0;

    // Build connector lines between grid-adjacent node pairs
    const connectors = [];
    const connectorSeen = new Set();
    for (const node of nodes) {
      for (const d of Object.keys(DIR_OFFSET)) {
        const off = DIR_OFFSET[d];
        const nKey = _gridKey(node.gridX + off.dx, node.gridY + off.dy);
        const neighborId = this._gridIndex.get(nKey);
        if (neighborId == null) continue;

        const pk = _pairKey(node.id, neighborId);
        if (connectorSeen.has(pk)) continue;
        connectorSeen.add(pk);

        const neighbor = this._nodes.get(neighborId);
        if (!neighbor) continue;

        connectors.push({
          x1: node.gridX * GRID_SPACING_X,
          y1: node.gridY * GRID_SPACING_Y,
          x2: neighbor.gridX * GRID_SPACING_X,
          y2: neighbor.gridY * GRID_SPACING_Y,
          count: this._travelCounts.get(pk) || 0,
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
            ${connectors.map(c => svg`
              <line class="edge-line"
                    x1="${c.x1}" y1="${c.y1}"
                    x2="${c.x2}" y2="${c.y2}" />
              ${c.count > 0 ? svg`
                <text class="edge-label"
                      x="${(c.x1 + c.x2) / 2}"
                      y="${(c.y1 + c.y2) / 2 - 6}">
                  ${c.count}
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
            Replaced ${_basename(this._undoState.replacedNode.path)}
            <button @click=${() => this._performUndo()}>Undo</button>
          </div>
        ` : nothing}
      </div>
    `;
  }
}

customElements.define('ac-file-nav', AcFileNav);