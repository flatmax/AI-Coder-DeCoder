// SvgEditor geometry and parser helpers.
//
// Pure functions over SVG attribute strings and bounding
// boxes. No DOM mutation, no editor state, no event
// handling. Anything in this module can be unit-tested in
// isolation by feeding strings/numbers in and asserting
// on the returned values.
//
// `_PATH_ARG_COUNTS` is module-internal — `_parsePathData`
// is the public entry point for path parsing and the
// caller never needs the raw count table.

/**
 * Axis-aligned bounding box in SVG root coords.
 * Used by marquee hit-test to check containment /
 * intersection.
 */
export function _bboxOverlaps(a, b) {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

export function _bboxContains(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Parse a numeric SVG attribute value to a number. SVG
 * treats missing / non-numeric values as 0 — matches
 * browser behavior. Deliberately does not handle units
 * like `10px` because SVG coordinate attributes don't
 * accept units (length attributes like stroke-width do,
 * but drag math doesn't touch those).
 */
export function _parseNum(value) {
  if (value == null) return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Whether a keydown event originates inside an editable
 * field where the editor's shortcuts would be unwelcome.
 * Covers native input / textarea / select elements plus
 * any element marked contenteditable.
 *
 * Uses `composedPath()` rather than `event.target` so
 * shadow-DOM retargeting doesn't hide the real origin.
 * When a keydown fires inside a component's shadow root
 * (e.g., the chat panel's <textarea>), a listener on
 * `document` sees `event.target` as the shadow host
 * (e.g., <ac-chat-panel>) rather than the textarea.
 * `composedPath()` returns the full path through every
 * shadow boundary, with the real target first.
 *
 * The editor's document-level keydown listener sees
 * EVERY keystroke on the page. Without this guard,
 * Ctrl+C / V / D / Z and Delete / Backspace get
 * hijacked by the editor even when the user is typing
 * somewhere else.
 *
 * The editor's own inline text-edit textarea is NOT
 * caught by this check — its keydown handler
 * (`_onTextEditKeyDown`) calls `stopPropagation` so
 * the document listener never sees the event.
 */
export function _isEditableTarget(event) {
  if (!event) return false;
  // Prefer composedPath so shadow-DOM retargeting
  // doesn't hide a textarea inside a component.
  const path = typeof event.composedPath === 'function'
    ? event.composedPath()
    : null;
  if (path && path.length > 0) {
    for (const node of path) {
      if (!node || !node.tagName) continue;
      const tag = node.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        return true;
      }
      if (node.isContentEditable) return true;
    }
    return false;
  }
  // Fallback when composedPath is unavailable (older
  // environments, test doubles).
  const target = event.target;
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return true;
  }
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Parse a polyline/polygon `points` attribute into an
 * array of [x, y] pairs. SVG accepts both comma-separated
 * and whitespace-separated coordinates, and mixes of the
 * two. We normalize by splitting on any combination of
 * commas and whitespace.
 *
 * Malformed input (odd number of tokens, non-numeric
 * values) returns an empty array — the drag dispatch
 * then emits an empty `points` attribute, which the
 * browser treats as an empty polyline. Better than
 * throwing and stranding the editor.
 */
export function _parsePoints(value) {
  if (!value || typeof value !== 'string') return [];
  const tokens = value.trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length % 2 !== 0) return [];
  const result = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const x = parseFloat(tokens[i]);
    const y = parseFloat(tokens[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    result.push([x, y]);
  }
  return result;
}

/**
 * Number of arguments consumed by each path command.
 * Both cases (absolute and relative) use the same arg
 * count — case determines coordinate interpretation
 * (absolute vs delta-from-pen), not arg shape.
 *
 * A commands take 7 args: rx, ry, x-axis-rotation,
 * large-arc-flag, sweep-flag, x, y. The flags are
 * booleans encoded as 0/1 in the path string but land
 * in our args array as numbers for uniformity.
 *
 * Z takes no args — it just closes the subpath back to
 * the most recent M point.
 */
const _PATH_ARG_COUNTS = {
  M: 2, m: 2,
  L: 2, l: 2,
  H: 1, h: 1,
  V: 1, v: 1,
  C: 6, c: 6,
  S: 4, s: 4,
  Q: 4, q: 4,
  T: 2, t: 2,
  A: 7, a: 7,
  Z: 0, z: 0,
};

/**
 * Parse an SVG path `d` attribute into a flat array of
 * command objects. Each command is `{cmd, args}` where
 * `cmd` is the single-character command letter (case
 * preserved — uppercase is absolute, lowercase is
 * relative) and `args` is an array of numbers.
 *
 * SVG path syntax packs multiple command invocations
 * after a single command letter — `M 0 0 10 10 20 20`
 * means moveto followed by two linetos. Per SVG spec,
 * trailing coordinates after M are treated as L (with
 * matching case). Similarly, trailing coords after m
 * are treated as l. We expand these into separate
 * command objects during parsing so downstream code can
 * treat every entry uniformly.
 *
 * Returns an empty array on any parse failure. Like
 * `_parsePoints`, prefers silent no-op over throwing —
 * a malformed `d` attribute strands the editor's
 * handles but doesn't crash the whole viewer.
 *
 * @param {string} d
 * @returns {Array<{cmd: string, args: number[]}>}
 */
export function _parsePathData(d) {
  if (!d || typeof d !== 'string') return [];
  // Tokenize. Command letters are their own tokens;
  // numbers are separated by whitespace, commas, or
  // sign changes (-5-10 → [-5, -10]). The regex matches
  // either a command letter or a signed number (with
  // optional fractional and exponent parts).
  const tokenRe = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  const tokens = [];
  let match;
  while ((match = tokenRe.exec(d)) !== null) {
    if (match[1]) {
      tokens.push({ type: 'cmd', value: match[1] });
    } else if (match[2]) {
      const n = parseFloat(match[2]);
      if (!Number.isFinite(n)) return [];
      tokens.push({ type: 'num', value: n });
    }
  }
  // Walk tokens. Each command letter consumes the
  // configured number of following number tokens. If
  // more numbers follow, spawn implicit command
  // repetitions — M becomes L, m becomes l, others
  // repeat themselves.
  const commands = [];
  let i = 0;
  let currentCmd = null;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.type === 'cmd') {
      currentCmd = tok.value;
      i += 1;
    } else if (currentCmd === null) {
      // Number before any command — malformed.
      return [];
    }
    if (currentCmd === null) continue;
    const argCount = _PATH_ARG_COUNTS[currentCmd];
    if (argCount === undefined) return [];
    if (argCount === 0) {
      // Z / z — no args consumed.
      commands.push({ cmd: currentCmd, args: [] });
      // Don't re-use currentCmd for subsequent tokens —
      // explicit next command required after Z.
      currentCmd = null;
      continue;
    }
    // Consume argCount numbers.
    const args = [];
    for (let j = 0; j < argCount; j += 1) {
      const next = tokens[i];
      if (!next || next.type !== 'num') return [];
      args.push(next.value);
      i += 1;
    }
    commands.push({ cmd: currentCmd, args });
    // Implicit repetition: after M/m, subsequent coord
    // pairs become L/l. Other commands repeat themselves.
    if (currentCmd === 'M') currentCmd = 'L';
    else if (currentCmd === 'm') currentCmd = 'l';
    // else currentCmd stays as-is for implicit repeat.
  }
  return commands;
}

/**
 * Serialize an array of parsed path commands back to a
 * `d` attribute string. Commands emitted individually
 * (no implicit-repeat compaction) so round-tripping is
 * lossless in the direction parser → serializer →
 * parser. The serializer's output may be slightly more
 * verbose than an optimized hand-written path, but
 * visually identical.
 *
 * Number formatting: uses `.toString()` rather than
 * `.toFixed(N)` to avoid silently truncating precision.
 * A path with coordinates like 10.12345 round-trips
 * verbatim; only integer cases drop the `.0`.
 *
 * @param {Array<{cmd: string, args: number[]}>} commands
 * @returns {string}
 */
export function _serializePathData(commands) {
  if (!Array.isArray(commands)) return '';
  const parts = [];
  for (const c of commands) {
    if (!c || typeof c.cmd !== 'string') continue;
    if (c.cmd.toUpperCase() === 'Z') {
      parts.push(c.cmd);
      continue;
    }
    const args = Array.isArray(c.args) ? c.args : [];
    parts.push(`${c.cmd} ${args.map((n) => String(n)).join(' ')}`);
  }
  return parts.join(' ');
}

/**
 * Compute absolute endpoint positions for each command
 * in a parsed path. Walks commands tracking the current
 * pen position and the most recent subpath start (for
 * Z commands). Returns an array of `{x, y}` objects
 * aligned with the input `commands` array.
 *
 * Z commands produce an endpoint at the subpath start
 * (not the current pen position) since that's where
 * the pen actually lands after the close — but we
 * return null for Z entries to signal "no independently
 * draggable endpoint" (dragging Z doesn't make sense).
 *
 * For relative commands, the absolute position is
 * computed from the current pen plus the command's
 * offset. For absolute commands, the position is taken
 * directly from the command's args.
 *
 * H and V are single-axis — H sets only x, V sets
 * only y, leaving the other coordinate at the pen's
 * current value.
 *
 * Returns an empty array if `commands` is empty or
 * malformed.
 *
 * @param {Array<{cmd: string, args: number[]}>} commands
 * @returns {Array<{x: number, y: number} | null>}
 */
export function _computePathEndpoints(commands) {
  if (!Array.isArray(commands) || commands.length === 0) return [];
  let penX = 0;
  let penY = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;
  const result = [];
  for (const c of commands) {
    if (!c || typeof c.cmd !== 'string') {
      result.push(null);
      continue;
    }
    const abs = c.cmd === c.cmd.toUpperCase();
    const args = Array.isArray(c.args) ? c.args : [];
    const upper = c.cmd.toUpperCase();
    switch (upper) {
      case 'M': {
        const [x, y] = args;
        const nx = abs ? x : penX + x;
        const ny = abs ? y : penY + y;
        penX = nx;
        penY = ny;
        subpathStartX = nx;
        subpathStartY = ny;
        result.push({ x: nx, y: ny });
        break;
      }
      case 'L':
      case 'T': {
        const [x, y] = args;
        const nx = abs ? x : penX + x;
        const ny = abs ? y : penY + y;
        penX = nx;
        penY = ny;
        result.push({ x: nx, y: ny });
        break;
      }
      case 'H': {
        const [x] = args;
        const nx = abs ? x : penX + x;
        penX = nx;
        // y unchanged.
        result.push({ x: nx, y: penY });
        break;
      }
      case 'V': {
        const [y] = args;
        const ny = abs ? y : penY + y;
        penY = ny;
        result.push({ x: penX, y: ny });
        break;
      }
      case 'C': {
        // Args: cx1, cy1, cx2, cy2, x, y. Endpoint is
        // the last pair.
        const x = args[4];
        const y = args[5];
        const nx = abs ? x : penX + x;
        const ny = abs ? y : penY + y;
        penX = nx;
        penY = ny;
        result.push({ x: nx, y: ny });
        break;
      }
      case 'S':
      case 'Q': {
        // S: cx2, cy2, x, y. Q: cx, cy, x, y. Either way
        // endpoint is args[2], args[3].
        const x = args[2];
        const y = args[3];
        const nx = abs ? x : penX + x;
        const ny = abs ? y : penY + y;
        penX = nx;
        penY = ny;
        result.push({ x: nx, y: ny });
        break;
      }
      case 'A': {
        // Args: rx, ry, x-axis-rot, large-arc, sweep,
        // x, y. Endpoint is last pair.
        const x = args[5];
        const y = args[6];
        const nx = abs ? x : penX + x;
        const ny = abs ? y : penY + y;
        penX = nx;
        penY = ny;
        result.push({ x: nx, y: ny });
        break;
      }
      case 'Z': {
        // Close back to subpath start. No independently
        // draggable endpoint, but update pen so a
        // following command sees the correct position.
        penX = subpathStartX;
        penY = subpathStartY;
        result.push(null);
        break;
      }
      default:
        result.push(null);
        break;
    }
  }
  return result;
}

/**
 * Compute absolute control-point positions for each
 * curve command in a parsed path. Returns an array
 * aligned with `commands`, each entry either an array
 * of `{x, y}` control points or null for commands
 * without independently-draggable control points.
 *
 * - M, L, H, V, T, A, Z → null (no draggable control
 *   points; T's control is reflected from previous, A's
 *   shape params aren't positional)
 * - C → [{x, y}, {x, y}] (two control points)
 * - S → [{x, y}] (one control point; first is reflected)
 * - Q → [{x, y}] (one control point)
 *
 * Shares the pen-walking logic with `_computePathEndpoints`
 * but tracks a different output shape. Two separate walks
 * would work; keeping them as separate functions means
 * each has a clear single purpose and callers pay only
 * for what they need (handle rendering calls both;
 * serialization doesn't call either).
 *
 * For relative commands, control-point coordinates are
 * computed from the pen position at the command's start
 * plus the command's offset args. For absolute commands,
 * the positions come straight from the args.
 *
 * @param {Array<{cmd: string, args: number[]}>} commands
 * @returns {Array<Array<{x: number, y: number}> | null>}
 */
export function _computePathControlPoints(commands) {
  if (!Array.isArray(commands) || commands.length === 0) return [];
  let penX = 0;
  let penY = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;
  const result = [];
  for (const c of commands) {
    if (!c || typeof c.cmd !== 'string') {
      result.push(null);
      continue;
    }
    const abs = c.cmd === c.cmd.toUpperCase();
    const args = Array.isArray(c.args) ? c.args : [];
    const upper = c.cmd.toUpperCase();
    switch (upper) {
      case 'M': {
        const [x, y] = args;
        const nx = abs ? x : penX + x;
        const ny = abs ? y : penY + y;
        penX = nx;
        penY = ny;
        subpathStartX = nx;
        subpathStartY = ny;
        result.push(null);
        break;
      }
      case 'L':
      case 'T': {
        const [x, y] = args;
        const nx = abs ? x : penX + x;
        const ny = abs ? y : penY + y;
        penX = nx;
        penY = ny;
        result.push(null);
        break;
      }
      case 'H': {
        const [x] = args;
        penX = abs ? x : penX + x;
        result.push(null);
        break;
      }
      case 'V': {
        const [y] = args;
        penY = abs ? y : penY + y;
        result.push(null);
        break;
      }
      case 'C': {
        // Args: cx1, cy1, cx2, cy2, x, y. Two control
        // points plus endpoint.
        const c1x = abs ? args[0] : penX + args[0];
        const c1y = abs ? args[1] : penY + args[1];
        const c2x = abs ? args[2] : penX + args[2];
        const c2y = abs ? args[3] : penY + args[3];
        const ex = abs ? args[4] : penX + args[4];
        const ey = abs ? args[5] : penY + args[5];
        result.push([
          { x: c1x, y: c1y },
          { x: c2x, y: c2y },
        ]);
        penX = ex;
        penY = ey;
        break;
      }
      case 'S':
      case 'Q': {
        // S: cx2, cy2, x, y (one draggable control; the
        // reflected first control is derived from the
        // previous command).
        // Q: cx, cy, x, y (one control point).
        const cx = abs ? args[0] : penX + args[0];
        const cy = abs ? args[1] : penY + args[1];
        const ex = abs ? args[2] : penX + args[2];
        const ey = abs ? args[3] : penY + args[3];
        result.push([{ x: cx, y: cy }]);
        penX = ex;
        penY = ey;
        break;
      }
      case 'A': {
        // Endpoint at args[5..6]; shape parameters
        // aren't positional, no control-point handles.
        const ex = abs ? args[5] : penX + args[5];
        const ey = abs ? args[6] : penY + args[6];
        penX = ex;
        penY = ey;
        result.push(null);
        break;
      }
      case 'Z': {
        penX = subpathStartX;
        penY = subpathStartY;
        result.push(null);
        break;
      }
      default:
        result.push(null);
        break;
    }
  }
  return result;
}