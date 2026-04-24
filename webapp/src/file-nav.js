// FileNav — 2D spatial file navigation grid.
//
// Layer 5 Phase 3.5 — file navigation grid with Alt+Arrow
// traversal and fullscreen HUD overlay.
//
// Every file-open action creates a new node adjacent to the
// current node on a 2D grid. Alt+Arrow keys traverse
// spatially. A fullscreen HUD overlay appears while Alt is
// held, showing the grid structure and the user's position.
//
// Governing spec: specs4/5-webapp/file-navigation.md
//
// This module contains the grid data model (nodes, adjacency,
// travel counts, placement, replacement, wrapping) as a
// LitElement component that renders the HUD overlay and
// exposes a public API for the app shell to drive.

import { LitElement, css, html } from 'lit';

// ---------------------------------------------------------------
// Constants (exported for tests)
// ---------------------------------------------------------------

/** Horizontal px between cell centers. */
export const GRID_SPACING_X = 180;
/** Vertical px between cell centers. */
export const GRID_SPACING_Y = 100;
/** Rendered node card width (px). */
export const NODE_WIDTH = 150;
/** Rendered node card height (px). */
export const NODE_HEIGHT = 48;
/** Corner radius for node cards (px). */
export const NODE_RADIUS = 8;

/** HUD fade-out duration (ms). */
export const FADE_DURATION = 150;
/** Replacement undo toast lifetime (ms). */
export const UNDO_TIMEOUT = 3000;

/**
 * Direction to try first when placing a new neighbor.
 * Right → up → down → left. Natural reading direction.
 */
export const PLACEMENT_ORDER = ['right', 'up', 'down', 'left'];

/**
 * Reverse of PLACEMENT_ORDER — used for replacement
 * tie-breaking. Left → down → up → right.
 */
export const REPLACEMENT_ORDER = ['left', 'down', 'up', 'right'];

/** Grid-cell offsets per direction. Y increases downward. */
export const DIR_OFFSET = {
  right: { dx: 1, dy: 0 },
  left: { dx: -1, dy: 0 },
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
};

/**
 * File-extension → color mapping for node rendering.
 * Follows the visible spectrum by language family.
 */
const _FILE_COLORS = {
  '.c': '#f87171', '.h': '#f87171',
  '.cpp': '#fb923c', '.cc': '#fb923c', '.cxx': '#fb923c',
  '.hpp': '#fb923c', '.hh': '#fb923c', '.hxx': '#fb923c',
  '.js': '#facc15', '.jsx': '#facc15', '.mjs': '#facc15',
  '.ts': '#a3e635', '.tsx': '#a3e635',
  '.md': '#4ade80', '.txt': '#4ade80', '.rst': '#4ade80',
  '.json': '#2dd4bf', '.yaml': '#2dd4bf', '.yml': '#2dd4bf',
  '.toml': '#2dd4bf', '.xml': '#2dd4bf',
  '.py': '#60a5fa', '.pyi': '#60a5fa',
  '.svg': '#c084fc',
  '.css': '#f472b6', '.scss': '#f472b6', '.html': '#f472b6',
};
const _DEFAULT_COLOR = '#8b949e';

function _colorForPath(path) {
  if (typeof path !== 'string') return _DEFAULT_COLOR;
  const dotIdx = path.lastIndexOf('.');
  if (dotIdx < 0) return _DEFAULT_COLOR;
  const ext = path.slice(dotIdx).toLowerCase();
  return _FILE_COLORS[ext] || _DEFAULT_COLOR;
}

function _basename(path) {
  if (typeof path !== 'string' || !path) return '';
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/** Canonical travel-count key for a pair of node IDs. */
function _travelKey(idA, idB) {
  const lo = Math.min(idA, idB);
  const hi = Math.max(idA, idB);
  return `${lo}-${hi}`;
}

/** Grid position → string key for the index map. */
function _posKey(x, y) {
  return `${x},${y}`;
}

// ---------------------------------------------------------------
// Component
// ---------------------------------------------------------------

export class FileNav extends LitElement {
  static properties = {
    /** Whether the HUD overlay is shown. */
    visible: { type: Boolean, reflect: true },
  };

  static styles = css`
    :host {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 500;
    }
    :host([visible]) {
      display: block;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(13, 17, 23, 0.88);
      transition: opacity ${FADE_DURATION}ms ease;
    }
    :host(.fading) .backdrop {
      opacity: 0;
    }
    .grid-viewport {
      position: absolute;
      inset: 0;
      overflow: hidden;
    }
    .grid-canvas {
      position: absolute;
      /* Positioned dynamically via style binding to center
       * the current node in the viewport. */
    }
    .node {
      position: absolute;
      width: ${NODE_WIDTH}px;
      height: ${NODE_HEIGHT}px;
      border-radius: ${NODE_RADIUS}px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      border: 2px solid rgba(255, 255, 255, 0.15);
      font-size: 0.8125rem;
      font-family: 'SFMono-Regular', Consolas, monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 0 0.5rem;
      box-sizing: border-box;
      transition: transform 200ms ease, box-shadow 200ms ease;
      user-select: none;
    }
    .node:hover {
      transform: scale(1.05);
    }
    .node.current {
      border-color: #fff;
      box-shadow: 0 0 16px rgba(255, 255, 255, 0.3);
    }
    .node.same-file {
      box-shadow: 0 0 8px rgba(255, 255, 255, 0.15);
    }
    .connector {
      position: absolute;
      pointer-events: none;
    }
    .connector line {
      stroke: rgba(255, 255, 255, 0.2);
      stroke-width: 1.5;
    }
    .travel-count {
      position: absolute;
      font-size: 0.625rem;
      color: rgba(255, 255, 255, 0.5);
      pointer-events: none;
      transform: translate(-50%, -50%);
    }
    .clear-btn {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      background: rgba(22, 27, 34, 0.9);
      border: 1px solid rgba(240, 246, 252, 0.2);
      color: var(--text-primary, #c9d1d9);
      padding: 0.4rem 0.8rem;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.8125rem;
      z-index: 10;
    }
    .clear-btn:hover {
      background: rgba(240, 246, 252, 0.1);
    }
    .undo-toast {
      position: fixed;
      bottom: 3.5rem;
      right: 1rem;
      background: rgba(22, 27, 34, 0.95);
      border: 1px solid rgba(240, 246, 252, 0.2);
      border-radius: 4px;
      padding: 0.5rem 0.75rem;
      font-size: 0.8125rem;
      color: var(--text-primary, #c9d1d9);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      z-index: 10;
    }
    .undo-btn {
      background: rgba(88, 166, 255, 0.15);
      border: 1px solid rgba(88, 166, 255, 0.3);
      color: var(--accent-primary, #58a6ff);
      padding: 0.2rem 0.5rem;
      border-radius: 3px;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.75rem;
    }
  `;

  constructor() {
    super();
    this.visible = false;

    /** @type {Map<number, {id: number, path: string, gridX: number, gridY: number}>} */
    this._nodes = new Map();
    /** @type {Map<string, number>} posKey → nodeId */
    this._gridIndex = new Map();
    /** @type {Map<string, number>} travelKey → count */
    this._travelCounts = new Map();
    /** @type {number|null} */
    this._currentNodeId = null;
    this._nextId = 1;

    /** @type {{removedNode: object, removedTravels: Map, newNodeId: number}|null} */
    this._undoState = null;
    this._undoTimer = null;
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  /**
   * Called by app shell when any file-open action occurs.
   * Creates a node if the current node references a
   * different path. Returns `{path, created}`.
   */
  openFile(path) {
    if (typeof path !== 'string' || !path) {
      return { path: '', created: false };
    }

    // First file — create root at (0, 0).
    if (this._nodes.size === 0) {
      const node = this._createNode(path, 0, 0);
      this._currentNodeId = node.id;
      return { path, created: true };
    }

    const current = this._nodes.get(this._currentNodeId);
    if (!current) {
      // Shouldn't happen — defensive.
      const node = this._createNode(path, 0, 0);
      this._currentNodeId = node.id;
      return { path, created: true };
    }

    // Same-file suppression.
    if (current.path === path) {
      return { path, created: false };
    }

    // Adjacent same-file reuse.
    for (const dir of PLACEMENT_ORDER) {
      const off = DIR_OFFSET[dir];
      const nx = current.gridX + off.dx;
      const ny = current.gridY + off.dy;
      const neighborId = this._gridIndex.get(_posKey(nx, ny));
      if (neighborId != null) {
        const neighbor = this._nodes.get(neighborId);
        if (neighbor && neighbor.path === path) {
          // Reuse — increment travel, switch current.
          const key = _travelKey(current.id, neighbor.id);
          this._travelCounts.set(
            key,
            (this._travelCounts.get(key) || 0) + 1,
          );
          this._currentNodeId = neighbor.id;
          return { path, created: false };
        }
      }
    }

    // Find first free adjacent cell.
    for (const dir of PLACEMENT_ORDER) {
      const off = DIR_OFFSET[dir];
      const nx = current.gridX + off.dx;
      const ny = current.gridY + off.dy;
      if (!this._gridIndex.has(_posKey(nx, ny))) {
        const node = this._createNode(path, nx, ny);
        this._currentNodeId = node.id;
        return { path, created: true };
      }
    }

    // All four occupied — replace the least-traveled neighbor.
    this._replaceNeighbor(current, path);
    return { path, created: true };
  }

  /**
   * Called on Alt+Arrow. Returns the file path of the
   * neighbor in that direction, or null if empty (after
   * wrapping attempt).
   */
  navigateDirection(dir) {
    if (!this._currentNodeId) return null;
    const current = this._nodes.get(this._currentNodeId);
    if (!current) return null;
    const off = DIR_OFFSET[dir];
    if (!off) return null;

    const nx = current.gridX + off.dx;
    const ny = current.gridY + off.dy;
    let targetId = this._gridIndex.get(_posKey(nx, ny));

    // Edge wrapping.
    if (targetId == null) {
      targetId = this._findWrapTarget(current, dir);
    }

    if (targetId == null) return null;
    const target = this._nodes.get(targetId);
    if (!target || target.id === current.id) return null;

    // Increment travel count.
    const key = _travelKey(current.id, target.id);
    this._travelCounts.set(
      key,
      (this._travelCounts.get(key) || 0) + 1,
    );
    this._currentNodeId = target.id;
    return target.path;
  }

  show() {
    this.visible = true;
    this.classList.remove('fading');
  }

  hide() {
    this.classList.add('fading');
    setTimeout(() => {
      this.visible = false;
      this.classList.remove('fading');
    }, FADE_DURATION);
  }

  /**
   * Clear the grid. If a file is currently open, keep it
   * as the root node at (0, 0).
   */
  clear() {
    const currentPath = this._currentNodeId
      ? this._nodes.get(this._currentNodeId)?.path
      : null;
    this._nodes.clear();
    this._gridIndex.clear();
    this._travelCounts.clear();
    this._currentNodeId = null;
    this._nextId = 1;
    this._clearUndo();
    if (currentPath) {
      const node = this._createNode(currentPath, 0, 0);
      this._currentNodeId = node.id;
    }
    this.requestUpdate();
  }

  /** Whether the grid has any nodes. */
  get hasNodes() {
    return this._nodes.size > 0;
  }

  /** The current node's path, or null. */
  get currentPath() {
    if (!this._currentNodeId) return null;
    return this._nodes.get(this._currentNodeId)?.path || null;
  }

  // ---------------------------------------------------------------
  // Internals — grid operations
  // ---------------------------------------------------------------

  _createNode(path, gridX, gridY) {
    const id = this._nextId++;
    const node = { id, path, gridX, gridY };
    this._nodes.set(id, node);
    this._gridIndex.set(_posKey(gridX, gridY), id);
    return node;
  }

  _removeNode(nodeId) {
    const node = this._nodes.get(nodeId);
    if (!node) return null;
    this._nodes.delete(nodeId);
    this._gridIndex.delete(_posKey(node.gridX, node.gridY));
    // Clear all travel counts involving this node.
    const toDelete = [];
    for (const key of this._travelCounts.keys()) {
      const parts = key.split('-');
      if (parts[0] === String(nodeId) || parts[1] === String(nodeId)) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      this._travelCounts.delete(key);
    }
    return node;
  }

  _replaceNeighbor(current, newPath) {
    // Find the neighbor with the lowest travel count.
    // Ties break by REPLACEMENT_ORDER (left first).
    let bestDir = null;
    let bestCount = Infinity;
    let bestId = null;

    for (const dir of REPLACEMENT_ORDER) {
      const off = DIR_OFFSET[dir];
      const nx = current.gridX + off.dx;
      const ny = current.gridY + off.dy;
      const nid = this._gridIndex.get(_posKey(nx, ny));
      if (nid == null) continue;
      const count =
        this._travelCounts.get(_travelKey(current.id, nid)) || 0;
      if (count < bestCount) {
        bestCount = count;
        bestDir = dir;
        bestId = nid;
      }
    }

    if (bestId == null || bestDir == null) return;

    // Save undo state before removing.
    const removedNode = this._nodes.get(bestId);
    const removedTravels = new Map();
    for (const [key, val] of this._travelCounts) {
      const parts = key.split('-');
      if (
        parts[0] === String(bestId) ||
        parts[1] === String(bestId)
      ) {
        removedTravels.set(key, val);
      }
    }

    const off = DIR_OFFSET[bestDir];
    const nx = current.gridX + off.dx;
    const ny = current.gridY + off.dy;

    this._removeNode(bestId);
    const newNode = this._createNode(newPath, nx, ny);
    this._currentNodeId = newNode.id;

    // Set up undo.
    this._clearUndo();
    this._undoState = {
      removedNode: { ...removedNode },
      removedTravels,
      newNodeId: newNode.id,
    };
    this._undoTimer = setTimeout(() => {
      this._undoState = null;
      this._undoTimer = null;
      this.requestUpdate();
    }, UNDO_TIMEOUT);
    this.requestUpdate();
  }

  _doUndo() {
    if (!this._undoState) return;
    const { removedNode, removedTravels, newNodeId } = this._undoState;
    // Remove the new node.
    this._removeNode(newNodeId);
    // Restore the removed node.
    this._nodes.set(removedNode.id, { ...removedNode });
    this._gridIndex.set(
      _posKey(removedNode.gridX, removedNode.gridY),
      removedNode.id,
    );
    // Restore travel counts.
    for (const [key, val] of removedTravels) {
      this._travelCounts.set(key, val);
    }
    // Current goes back to whatever was current before the
    // replacement. Since the replacement changed current to
    // newNodeId and we removed it, revert to the node that
    // initiated the replacement. We find it by looking for
    // the node adjacent to the restored position.
    // Simplification: just keep current as-is if the removed
    // node exists, otherwise null.
    if (this._nodes.has(removedNode.id)) {
      this._currentNodeId = removedNode.id;
    }
    this._clearUndo();
    this.requestUpdate();
  }

  _clearUndo() {
    if (this._undoTimer) {
      clearTimeout(this._undoTimer);
      this._undoTimer = null;
    }
    this._undoState = null;
  }

  _findWrapTarget(current, dir) {
    // Scan all nodes for the wrap target.
    const off = DIR_OFFSET[dir];
    if (!off) return null;

    let best = null;
    let bestCoord = null;

    for (const [, node] of this._nodes) {
      if (node.id === current.id) continue;

      if (dir === 'left' || dir === 'right') {
        // Same row.
        if (node.gridY !== current.gridY) continue;
        if (dir === 'left') {
          // Wrap to rightmost.
          if (bestCoord === null || node.gridX > bestCoord) {
            bestCoord = node.gridX;
            best = node.id;
          }
        } else {
          // Wrap to leftmost.
          if (bestCoord === null || node.gridX < bestCoord) {
            bestCoord = node.gridX;
            best = node.id;
          }
        }
      } else {
        // Same column.
        if (node.gridX !== current.gridX) continue;
        if (dir === 'up') {
          // Wrap to bottommost.
          if (bestCoord === null || node.gridY > bestCoord) {
            bestCoord = node.gridY;
            best = node.id;
          }
        } else {
          // Wrap to topmost.
          if (bestCoord === null || node.gridY < bestCoord) {
            bestCoord = node.gridY;
            best = node.id;
          }
        }
      }
    }
    return best;
  }

  _getTravelCount(idA, idB) {
    return this._travelCounts.get(_travelKey(idA, idB)) || 0;
  }

  // ---------------------------------------------------------------
  // HUD click
  // ---------------------------------------------------------------

  _onNodeClick(nodeId) {
    if (nodeId === this._currentNodeId) return;
    const node = this._nodes.get(nodeId);
    if (!node) return;
    this._currentNodeId = nodeId;
    this.requestUpdate();
    // Dispatch navigate-file with the _fromNav flag so
    // the app shell doesn't re-register this in the grid.
    this.dispatchEvent(
      new CustomEvent('navigate-file', {
        detail: { path: node.path, _fromNav: true },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    if (!this.visible || this._nodes.size === 0) return html``;

    const current = this._nodes.get(this._currentNodeId);
    if (!current) return html``;

    // Compute viewport offset to center the current node.
    // We'll position nodes relative to the current node's
    // grid position.
    const centerX = current.gridX;
    const centerY = current.gridY;

    // Collect connectors (lines between adjacent nodes).
    const connectors = [];
    const seen = new Set();
    for (const [, node] of this._nodes) {
      for (const dir of ['right', 'down']) {
        const off = DIR_OFFSET[dir];
        const nk = _posKey(node.gridX + off.dx, node.gridY + off.dy);
        const neighborId = this._gridIndex.get(nk);
        if (neighborId == null) continue;
        const pairKey = _travelKey(node.id, neighborId);
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        const neighbor = this._nodes.get(neighborId);
        if (!neighbor) continue;
        connectors.push({
          x1: (node.gridX - centerX) * GRID_SPACING_X,
          y1: (node.gridY - centerY) * GRID_SPACING_Y,
          x2: (neighbor.gridX - centerX) * GRID_SPACING_X,
          y2: (neighbor.gridY - centerY) * GRID_SPACING_Y,
          count: this._getTravelCount(node.id, neighborId),
        });
      }
    }

    const currentFile = current.path;

    return html`
      <div class="backdrop" @click=${() => this.hide()}></div>
      <div class="grid-viewport">
        <div
          class="grid-canvas"
          style="left: 50%; top: 50%; transform: translate(-50%, -50%)"
        >
          ${connectors.map((c) => {
            const minX = Math.min(c.x1, c.x2);
            const minY = Math.min(c.y1, c.y2);
            const w = Math.abs(c.x2 - c.x1) || 2;
            const h = Math.abs(c.y2 - c.y1) || 2;
            const midX = (c.x1 + c.x2) / 2;
            const midY = (c.y1 + c.y2) / 2;
            return html`
              <svg
                class="connector"
                style="left: ${minX}px; top: ${minY}px; width: ${w}px; height: ${h}px;"
                viewBox="${minX} ${minY} ${w} ${h}"
              >
                <line
                  x1=${c.x1} y1=${c.y1}
                  x2=${c.x2} y2=${c.y2}
                />
              </svg>
              ${c.count > 0
                ? html`<span
                    class="travel-count"
                    style="left: ${midX}px; top: ${midY}px;"
                  >${c.count}</span>`
                : ''}
            `;
          })}
          ${Array.from(this._nodes.values()).map((node) => {
            const x = (node.gridX - centerX) * GRID_SPACING_X - NODE_WIDTH / 2;
            const y = (node.gridY - centerY) * GRID_SPACING_Y - NODE_HEIGHT / 2;
            const isCurrent = node.id === this._currentNodeId;
            const isSameFile = !isCurrent && node.path === currentFile;
            const color = _colorForPath(node.path);
            const name = _basename(node.path);
            const truncated = name.length > 20
              ? name.slice(0, 18) + '…'
              : name;
            return html`
              <div
                class="node ${isCurrent ? 'current' : ''} ${isSameFile ? 'same-file' : ''}"
                style="left: ${x}px; top: ${y}px; background: ${color}22; color: ${color};"
                title=${node.path}
                @click=${() => this._onNodeClick(node.id)}
              >${truncated}</div>
            `;
          })}
        </div>
      </div>
      <button class="clear-btn" @click=${() => this.clear()}>Clear</button>
      ${this._undoState
        ? html`
            <div class="undo-toast">
              Replaced ${_basename(this._undoState.removedNode.path)}
              <button class="undo-btn" @click=${() => this._doUndo()}>
                Undo
              </button>
            </div>
          `
        : ''}
    `;
  }
}

customElements.define('ac-file-nav', FileNav);