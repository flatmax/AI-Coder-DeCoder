/**
 * AcFileNav — 2D spatial grid for file navigation with Alt+Arrow traversal
 * and a fullscreen HUD overlay.
 *
 * Every file-open action creates a node adjacent to the current node.
 * Alt+Arrow keys traverse the grid spatially. The HUD overlay shows the
 * grid while Alt is held.
 */

import { LitElement, html, css } from 'lit';

// File extension → color mapping
const EXT_COLORS = {
  '.c': '#ef4444', '.h': '#ef4444',
  '.cpp': '#f97316', '.cc': '#f97316', '.hpp': '#f97316', '.cxx': '#f97316', '.hxx': '#f97316',
  '.js': '#eab308', '.jsx': '#eab308', '.mjs': '#eab308',
  '.ts': '#84cc16', '.tsx': '#84cc16',
  '.md': '#22c55e', '.txt': '#22c55e', '.rst': '#22c55e',
  '.json': '#14b8a6', '.yaml': '#14b8a6', '.yml': '#14b8a6', '.toml': '#14b8a6', '.xml': '#14b8a6',
  '.py': '#3b82f6', '.pyi': '#3b82f6',
  '.svg': '#a855f7',
  '.css': '#ec4899', '.scss': '#ec4899', '.html': '#ec4899',
};
const DEFAULT_COLOR = '#6b7280';

function _colorForPath(path) {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return DEFAULT_COLOR;
  return EXT_COLORS[path.substring(dot).toLowerCase()] || DEFAULT_COLOR;
}

function _basename(path) {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.substring(slash + 1) : path;
}

// Grid spacing in pixels for HUD rendering
const CELL_W = 160;
const CELL_H = 52;
const CELL_GAP = 20;

// Placement priority: right, up, down, left
const DIRECTIONS = [
  { dx: 1, dy: 0 },   // right
  { dx: 0, dy: -1 },  // up
  { dx: 0, dy: 1 },   // down
  { dx: -1, dy: 0 },  // left
];

// Reverse priority for replacement tie-breaking: left, down, up, right
const REPLACE_PRIORITY = [
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
];

export class AcFileNav extends LitElement {
  static properties = {
    visible: { type: Boolean, reflect: true },
    _currentNodeId: { type: Number, state: true },
    _renderTick: { type: Number, state: true },
  };

  static styles = css`
    :host {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 9000;
      pointer-events: none;
    }
    :host([visible]) {
      pointer-events: auto;
    }

    .hud-overlay {
      position: absolute;
      inset: 0;
      background: rgba(26, 26, 46, 0.88);
      opacity: 0;
      transition: opacity 0.15s ease;
      overflow: hidden;
    }
    :host([visible]) .hud-overlay {
      opacity: 1;
    }

    .hud-canvas {
      position: absolute;
      inset: 0;
    }

    /* Nodes */
    .nav-node {
      position: absolute;
      width: 160px;
      height: 52px;
      border-radius: 8px;
      border: 2px solid;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.78rem;
      font-weight: 500;
      color: #e0e0e0;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.15s;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 0 10px;
      user-select: none;
    }
    .nav-node:hover {
      transform: scale(1.05);
      z-index: 2;
    }
    .nav-node.current {
      box-shadow: 0 0 16px rgba(79, 195, 247, 0.4);
      z-index: 3;
    }
    .nav-node.same-file {
      box-shadow: 0 0 8px rgba(79, 195, 247, 0.2);
    }

    /* Connector lines (rendered as SVG) */
    .connectors {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .connectors line {
      stroke: rgba(255, 255, 255, 0.2);
      stroke-width: 1.5;
    }
    .travel-label {
      fill: rgba(255, 255, 255, 0.5);
      font-size: 10px;
      text-anchor: middle;
      dominant-baseline: middle;
    }

    /* Clear button */
    .clear-btn {
      position: absolute;
      bottom: 20px;
      right: 20px;
      background: var(--bg-tertiary, #1e2a45);
      border: 1px solid var(--border-primary, #2a3a5c);
      border-radius: 6px;
      color: var(--text-secondary, #a0a0b0);
      cursor: pointer;
      padding: 6px 14px;
      font-size: 0.8rem;
      z-index: 4;
    }
    .clear-btn:hover {
      color: var(--text-primary, #e0e0e0);
      border-color: var(--accent-primary, #4fc3f7);
    }

    /* Undo toast */
    .undo-toast {
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-secondary, #16213e);
      border: 1px solid var(--border-primary, #2a3a5c);
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 0.8rem;
      color: var(--text-primary, #e0e0e0);
      z-index: 5;
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .undo-btn {
      background: none;
      border: 1px solid var(--accent-primary, #4fc3f7);
      border-radius: 4px;
      color: var(--accent-primary, #4fc3f7);
      cursor: pointer;
      padding: 2px 8px;
      font-size: 0.75rem;
    }
  `;

  constructor() {
    super();
    this.visible = false;
    this._currentNodeId = null;
    this._renderTick = 0;

    // Grid state (not reactive — we use _renderTick to force updates)
    this._nodes = new Map();       // id → {id, path, gridX, gridY}
    this._gridIndex = new Map();   // "x,y" → id
    this._travelCounts = new Map(); // "min-max" → count
    this._nextId = 1;
    this._undoState = null;
    this._undoTimer = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._keyDownHandler = this._onKeyDown.bind(this);
    this._keyUpHandler = this._onKeyUp.bind(this);
    document.addEventListener('keydown', this._keyDownHandler, true);
    document.addEventListener('keyup', this._keyUpHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._keyDownHandler, true);
    document.removeEventListener('keyup', this._keyUpHandler);
    if (this._undoTimer) clearTimeout(this._undoTimer);
  }

  // ── Public API ───────────────────────────────────────────────

  openFile(path) {
    if (!path) return { path, created: false };

    // Same-file suppression
    if (this._currentNodeId != null) {
      const current = this._nodes.get(this._currentNodeId);
      if (current && current.path === path) {
        return { path, created: false };
      }
    }

    // Create node
    const { gridX, gridY } = this._findPlacement();
    const id = this._nextId++;
    const node = { id, path, gridX, gridY };

    // Check collision
    const key = `${gridX},${gridY}`;
    const existing = this._gridIndex.get(key);
    if (existing != null) {
      this._removeNode(existing);
    }

    this._nodes.set(id, node);
    this._gridIndex.set(key, id);
    this._currentNodeId = id;
    this._renderTick++;

    return { path, created: true };
  }

  navigateDirection(dir) {
    if (this._currentNodeId == null) return null;
    const current = this._nodes.get(this._currentNodeId);
    if (!current) return null;

    let dx = 0, dy = 0;
    switch (dir) {
      case 'left': dx = -1; break;
      case 'right': dx = 1; break;
      case 'up': dy = -1; break;
      case 'down': dy = 1; break;
      default: return null;
    }

    const targetKey = `${current.gridX + dx},${current.gridY + dy}`;
    const neighborId = this._gridIndex.get(targetKey);
    if (neighborId == null) return null;

    const neighbor = this._nodes.get(neighborId);
    if (!neighbor) return null;

    // Increment travel count
    const travelKey = `${Math.min(this._currentNodeId, neighborId)}-${Math.max(this._currentNodeId, neighborId)}`;
    this._travelCounts.set(travelKey, (this._travelCounts.get(travelKey) || 0) + 1);

    this._currentNodeId = neighborId;
    this._renderTick++;

    return neighbor.path;
  }

  show() {
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }

  clear() {
    const currentPath = this._currentNodeId != null
      ? this._nodes.get(this._currentNodeId)?.path
      : null;

    this._nodes.clear();
    this._gridIndex.clear();
    this._travelCounts.clear();
    this._currentNodeId = null;
    this._nextId = 1;
    this._undoState = null;

    // Keep current file as root
    if (currentPath) {
      const id = this._nextId++;
      const node = { id, path: currentPath, gridX: 0, gridY: 0 };
      this._nodes.set(id, node);
      this._gridIndex.set('0,0', id);
      this._currentNodeId = id;
    }

    this._renderTick++;
  }

  // ── Placement ──────────────────────────────────────────────────

  _findPlacement() {
    if (this._nodes.size === 0) {
      return { gridX: 0, gridY: 0 };
    }

    const current = this._nodes.get(this._currentNodeId);
    if (!current) return { gridX: 0, gridY: 0 };

    // Try directions in priority order
    for (const { dx, dy } of DIRECTIONS) {
      const key = `${current.gridX + dx},${current.gridY + dy}`;
      if (!this._gridIndex.has(key)) {
        return { gridX: current.gridX + dx, gridY: current.gridY + dy };
      }
    }

    // All occupied — replace least-traveled neighbor
    let bestDir = REPLACE_PRIORITY[0];
    let bestCount = Infinity;

    for (const { dx, dy } of REPLACE_PRIORITY) {
      const key = `${current.gridX + dx},${current.gridY + dy}`;
      const neighborId = this._gridIndex.get(key);
      if (neighborId == null) continue;
      const travelKey = `${Math.min(this._currentNodeId, neighborId)}-${Math.max(this._currentNodeId, neighborId)}`;
      const count = this._travelCounts.get(travelKey) || 0;
      if (count < bestCount) {
        bestCount = count;
        bestDir = { dx, dy };
      }
    }

    const replaceKey = `${current.gridX + bestDir.dx},${current.gridY + bestDir.dy}`;
    const replacedId = this._gridIndex.get(replaceKey);
    if (replacedId != null) {
      const replaced = this._nodes.get(replacedId);
      // Save undo state
      this._undoState = {
        node: { ...replaced },
        travelCounts: this._getNodeTravelCounts(replacedId),
        newNodeId: this._nextId, // Will be assigned to the new node
      };
      this._removeNode(replacedId);
      this._startUndoTimer();
    }

    return { gridX: current.gridX + bestDir.dx, gridY: current.gridY + bestDir.dy };
  }

  _removeNode(id) {
    const node = this._nodes.get(id);
    if (!node) return;
    this._gridIndex.delete(`${node.gridX},${node.gridY}`);
    this._nodes.delete(id);
    // Clear travel counts — collect keys first to avoid mutating during iteration
    const toDelete = [];
    for (const [key] of this._travelCounts) {
      const parts = key.split('-').map(Number);
      if (parts.includes(id)) toDelete.push(key);
    }
    for (const key of toDelete) {
      this._travelCounts.delete(key);
    }
  }

  _getNodeTravelCounts(id) {
    const counts = new Map();
    for (const [key, count] of this._travelCounts) {
      const parts = key.split('-').map(Number);
      if (parts.includes(id)) counts.set(key, count);
    }
    return counts;
  }

  // ── Undo ───────────────────────────────────────────────────────

  _startUndoTimer() {
    if (this._undoTimer) clearTimeout(this._undoTimer);
    this._undoTimer = setTimeout(() => {
      this._undoState = null;
      this._renderTick++;
    }, 3000);
    this._renderTick++;
  }

  _undo() {
    if (!this._undoState) return;
    const { node, travelCounts, newNodeId } = this._undoState;

    // Remove the new node that replaced it
    this._removeNode(newNodeId);

    // Restore the replaced node
    this._nodes.set(node.id, node);
    this._gridIndex.set(`${node.gridX},${node.gridY}`, node.id);
    for (const [key, count] of travelCounts) {
      this._travelCounts.set(key, count);
    }

    this._undoState = null;
    if (this._undoTimer) clearTimeout(this._undoTimer);
    this._renderTick++;
  }

  // ── Keyboard ───────────────────────────────────────────────────

  _onKeyDown(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;

    // Only consume if we have nodes
    if (this._nodes.size === 0) return;

    e.preventDefault();
    e.stopPropagation();

    // Show HUD
    this.show();

    const dirMap = {
      ArrowLeft: 'left', ArrowRight: 'right',
      ArrowUp: 'up', ArrowDown: 'down',
    };

    const path = this.navigateDirection(dirMap[e.key]);
    if (path) {
      this.dispatchEvent(new CustomEvent('navigate-file', {
        detail: { path, _fromNav: true },
        bubbles: true, composed: true,
      }));
    }
  }

  _onKeyUp(e) {
    if (e.key === 'Alt') {
      this.hide();
    }
    if (e.key === 'Escape' && this.visible) {
      this.visible = false;
    }
  }

  // ── HUD click ──────────────────────────────────────────────────

  _onNodeClick(id) {
    const node = this._nodes.get(id);
    if (!node) return;

    this._currentNodeId = id;
    this._renderTick++;

    this.dispatchEvent(new CustomEvent('navigate-file', {
      detail: { path: node.path, _fromNav: true },
      bubbles: true, composed: true,
    }));
  }

  // ── Render helpers ─────────────────────────────────────────────

  _getViewport() {
    const current = this._nodes.get(this._currentNodeId);
    const cx = current ? current.gridX : 0;
    const cy = current ? current.gridY : 0;

    // Center current node in viewport
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    const offsetX = viewW / 2 - cx * (CELL_W + CELL_GAP) - CELL_W / 2;
    const offsetY = viewH / 2 - cy * (CELL_H + CELL_GAP) - CELL_H / 2;

    return { offsetX, offsetY };
  }

  _nodeScreenPos(node, offset) {
    return {
      x: offset.offsetX + node.gridX * (CELL_W + CELL_GAP),
      y: offset.offsetY + node.gridY * (CELL_H + CELL_GAP),
    };
  }

  // ── Render ─────────────────────────────────────────────────────

  render() {
    if (!this.visible || this._nodes.size === 0) {
      return html`<div class="hud-overlay"></div>`;
    }

    const offset = this._getViewport();
    const currentNode = this._nodes.get(this._currentNodeId);
    const currentPath = currentNode?.path;

    // Build connector lines
    const lines = [];
    const seen = new Set();
    for (const [id, node] of this._nodes) {
      for (const { dx, dy } of DIRECTIONS) {
        const neighborKey = `${node.gridX + dx},${node.gridY + dy}`;
        const neighborId = this._gridIndex.get(neighborKey);
        if (neighborId == null) continue;
        const pairKey = `${Math.min(id, neighborId)}-${Math.max(id, neighborId)}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const neighbor = this._nodes.get(neighborId);
        const pos1 = this._nodeScreenPos(node, offset);
        const pos2 = this._nodeScreenPos(neighbor, offset);
        const travelCount = this._travelCounts.get(pairKey) || 0;

        lines.push({
          x1: pos1.x + CELL_W / 2, y1: pos1.y + CELL_H / 2,
          x2: pos2.x + CELL_W / 2, y2: pos2.y + CELL_H / 2,
          count: travelCount,
        });
      }
    }

    return html`
      <div class="hud-overlay">
        <!-- Connectors SVG -->
        <svg class="connectors" width="100%" height="100%">
          ${lines.map(l => html`
            <line x1=${l.x1} y1=${l.y1} x2=${l.x2} y2=${l.y2}></line>
            ${l.count > 0 ? html`
              <text class="travel-label"
                    x=${(l.x1 + l.x2) / 2} y=${(l.y1 + l.y2) / 2}>
                ${l.count}
              </text>
            ` : ''}
          `)}
        </svg>

        <!-- Nodes -->
        <div class="hud-canvas">
          ${[...this._nodes.values()].map(node => {
            const pos = this._nodeScreenPos(node, offset);
            const color = _colorForPath(node.path);
            const isCurrent = node.id === this._currentNodeId;
            const isSameFile = !isCurrent && node.path === currentPath;
            const name = _basename(node.path);
            const label = name.length > 20 ? name.substring(0, 18) + '…' : name;

            return html`
              <div class="nav-node ${isCurrent ? 'current' : ''} ${isSameFile ? 'same-file' : ''}"
                   style="left:${pos.x}px;top:${pos.y}px;
                          background:${color}22;border-color:${color};
                          ${isCurrent ? `border-color:#4fc3f7;background:${color}33` : ''}"
                   title="${node.path}"
                   @click=${() => this._onNodeClick(node.id)}>
                ${label}
              </div>
            `;
          })}
        </div>

        <!-- Clear button -->
        <button class="clear-btn" @click=${() => this.clear()}>Clear Grid</button>

        <!-- Undo toast -->
        ${this._undoState ? html`
          <div class="undo-toast">
            Replaced ${_basename(this._undoState.node.path)}
            <button class="undo-btn" @click=${() => this._undo()}>Undo</button>
          </div>
        ` : ''}
      </div>
    `;
  }
}

customElements.define('ac-file-nav', AcFileNav);