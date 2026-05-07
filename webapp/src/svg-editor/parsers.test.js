// Pure-function tests for parsers and computation helpers
// in svg-editor.js. Extracted verbatim from
// svg-editor.test.js — these don't need DOM helpers.

import { describe, expect, it } from 'vitest';
import {
  _computePathControlPoints,
  _computePathEndpoints,
  _parseNum,
  _parsePathData,
  _parsePoints,
  _serializePathData,
} from './index.js';

describe('_parseNum', () => {
  it('parses numeric string', () => {
    expect(_parseNum('42')).toBe(42);
    expect(_parseNum('-10.5')).toBe(-10.5);
    expect(_parseNum('0')).toBe(0);
  });

  it('returns 0 for null / missing', () => {
    expect(_parseNum(null)).toBe(0);
    expect(_parseNum(undefined)).toBe(0);
    expect(_parseNum('')).toBe(0);
  });

  it('returns 0 for non-numeric input', () => {
    expect(_parseNum('not a number')).toBe(0);
    expect(_parseNum('NaN')).toBe(0);
  });

  it('handles scientific notation', () => {
    expect(_parseNum('1e2')).toBe(100);
  });
});

describe('_parsePoints', () => {
  it('parses whitespace-separated points', () => {
    expect(_parsePoints('10 20 30 40')).toEqual([[10, 20], [30, 40]]);
  });

  it('parses comma-separated points', () => {
    expect(_parsePoints('10,20 30,40')).toEqual([[10, 20], [30, 40]]);
  });

  it('parses mixed separators', () => {
    expect(_parsePoints('10,20,30,40')).toEqual([[10, 20], [30, 40]]);
    expect(_parsePoints('10 20, 30 40')).toEqual([[10, 20], [30, 40]]);
  });

  it('returns empty array for empty or null', () => {
    expect(_parsePoints('')).toEqual([]);
    expect(_parsePoints(null)).toEqual([]);
    expect(_parsePoints(undefined)).toEqual([]);
  });

  it('returns empty array for odd number of tokens', () => {
    expect(_parsePoints('10 20 30')).toEqual([]);
  });

  it('returns empty array for non-numeric input', () => {
    expect(_parsePoints('a b c d')).toEqual([]);
  });
});

describe('_parsePathData', () => {
  it('parses an empty string as empty', () => {
    expect(_parsePathData('')).toEqual([]);
    expect(_parsePathData(null)).toEqual([]);
    expect(_parsePathData(undefined)).toEqual([]);
  });

  it('parses simple M + L', () => {
    const result = _parsePathData('M 0 0 L 10 10');
    expect(result).toEqual([
      { cmd: 'M', args: [0, 0] },
      { cmd: 'L', args: [10, 10] },
    ]);
  });

  it('preserves case (absolute vs relative)', () => {
    const result = _parsePathData('M 0 0 l 10 10');
    expect(result).toEqual([
      { cmd: 'M', args: [0, 0] },
      { cmd: 'l', args: [10, 10] },
    ]);
  });

  it('handles all commands', () => {
    const result = _parsePathData(
      'M 0 0 L 10 10 H 20 V 30 C 0 0 5 5 10 10 S 15 15 20 20 Q 25 25 30 30 T 35 35 A 5 5 0 0 1 40 40 Z',
    );
    expect(result).toHaveLength(10);
    expect(result[0].cmd).toBe('M');
    expect(result[1].cmd).toBe('L');
    expect(result[2].cmd).toBe('H');
    expect(result[2].args).toEqual([20]);
    expect(result[3].cmd).toBe('V');
    expect(result[3].args).toEqual([30]);
    expect(result[4].cmd).toBe('C');
    expect(result[4].args).toEqual([0, 0, 5, 5, 10, 10]);
    expect(result[5].cmd).toBe('S');
    expect(result[5].args).toEqual([15, 15, 20, 20]);
    expect(result[6].cmd).toBe('Q');
    expect(result[6].args).toEqual([25, 25, 30, 30]);
    expect(result[7].cmd).toBe('T');
    expect(result[7].args).toEqual([35, 35]);
    expect(result[8].cmd).toBe('A');
    expect(result[8].args).toEqual([5, 5, 0, 0, 1, 40, 40]);
    expect(result[9].cmd).toBe('Z');
    expect(result[9].args).toEqual([]);
  });

  it('splits tokens on commas', () => {
    const result = _parsePathData('M0,0 L10,10');
    expect(result).toEqual([
      { cmd: 'M', args: [0, 0] },
      { cmd: 'L', args: [10, 10] },
    ]);
  });

  it('splits tokens on sign changes', () => {
    // "M-5-10L20-30" should tokenize as M, -5, -10, L, 20, -30.
    const result = _parsePathData('M-5-10L20-30');
    expect(result).toEqual([
      { cmd: 'M', args: [-5, -10] },
      { cmd: 'L', args: [20, -30] },
    ]);
  });

  it('handles decimals and scientific notation', () => {
    const result = _parsePathData('M 1.5 2.75 L 1e2 3.14');
    expect(result).toEqual([
      { cmd: 'M', args: [1.5, 2.75] },
      { cmd: 'L', args: [100, 3.14] },
    ]);
  });

  it('expands implicit repetitions after M as L', () => {
    // "M 0 0 10 10 20 20" = moveto, then two linetos.
    const result = _parsePathData('M 0 0 10 10 20 20');
    expect(result).toEqual([
      { cmd: 'M', args: [0, 0] },
      { cmd: 'L', args: [10, 10] },
      { cmd: 'L', args: [20, 20] },
    ]);
  });

  it('expands implicit repetitions after m as l (lowercase)', () => {
    const result = _parsePathData('m 0 0 10 10 20 20');
    expect(result).toEqual([
      { cmd: 'm', args: [0, 0] },
      { cmd: 'l', args: [10, 10] },
      { cmd: 'l', args: [20, 20] },
    ]);
  });

  it('expands implicit repetitions for non-M commands', () => {
    // "L 10 10 20 20" = two linetos.
    const result = _parsePathData('M 0 0 L 10 10 20 20');
    expect(result).toEqual([
      { cmd: 'M', args: [0, 0] },
      { cmd: 'L', args: [10, 10] },
      { cmd: 'L', args: [20, 20] },
    ]);
  });

  it('requires explicit command after Z', () => {
    // After Z, the next coord needs an explicit command.
    // Malformed input (coord with no command) returns empty.
    const result = _parsePathData('M 0 0 L 10 10 Z 20 20');
    expect(result).toEqual([]);
  });

  it('handles whitespace variations', () => {
    expect(
      _parsePathData('  M   0  0   L  10  10  '),
    ).toEqual([
      { cmd: 'M', args: [0, 0] },
      { cmd: 'L', args: [10, 10] },
    ]);
  });

  it('returns empty array on malformed input', () => {
    // Missing args.
    expect(_parsePathData('M 0')).toEqual([]);
    // Unknown command letter is just not matched by the
    // regex, so it's skipped silently — downstream args
    // become stranded and the walk fails.
    expect(_parsePathData('X 0 0 L 10 10')).toEqual([]);
  });
});

describe('_serializePathData', () => {
  it('serializes an empty array as empty string', () => {
    expect(_serializePathData([])).toBe('');
    expect(_serializePathData(null)).toBe('');
    expect(_serializePathData(undefined)).toBe('');
  });

  it('serializes a simple M + L', () => {
    const result = _serializePathData([
      { cmd: 'M', args: [0, 0] },
      { cmd: 'L', args: [10, 10] },
    ]);
    expect(result).toBe('M 0 0 L 10 10');
  });

  it('serializes Z with no args', () => {
    const result = _serializePathData([
      { cmd: 'M', args: [0, 0] },
      { cmd: 'L', args: [10, 10] },
      { cmd: 'Z', args: [] },
    ]);
    expect(result).toBe('M 0 0 L 10 10 Z');
  });

  it('preserves case', () => {
    expect(
      _serializePathData([
        { cmd: 'M', args: [0, 0] },
        { cmd: 'l', args: [5, 5] },
      ]),
    ).toBe('M 0 0 l 5 5');
  });

  it('preserves numeric precision', () => {
    expect(
      _serializePathData([{ cmd: 'M', args: [1.5, 2.75] }]),
    ).toBe('M 1.5 2.75');
  });

  it('round-trips through parser losslessly', () => {
    const input = 'M 0 0 L 10 10 H 20 V 30 Z';
    const parsed = _parsePathData(input);
    const reparsed = _parsePathData(_serializePathData(parsed));
    expect(reparsed).toEqual(parsed);
  });

  it('handles mixed absolute and relative', () => {
    expect(
      _serializePathData([
        { cmd: 'M', args: [0, 0] },
        { cmd: 'l', args: [10, 10] },
        { cmd: 'H', args: [50] },
        { cmd: 'z', args: [] },
      ]),
    ).toBe('M 0 0 l 10 10 H 50 z');
  });
});

describe('_computePathEndpoints', () => {
  it('returns empty array for empty commands', () => {
    expect(_computePathEndpoints([])).toEqual([]);
    expect(_computePathEndpoints(null)).toEqual([]);
  });

  it('computes absolute M endpoint', () => {
    const commands = [{ cmd: 'M', args: [10, 20] }];
    expect(_computePathEndpoints(commands)).toEqual([
      { x: 10, y: 20 },
    ]);
  });

  it('computes absolute L endpoints', () => {
    const commands = _parsePathData('M 0 0 L 10 10 L 20 30');
    expect(_computePathEndpoints(commands)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 30 },
    ]);
  });

  it('computes relative L endpoints by accumulating', () => {
    // m 0 0 l 10 10 l 20 30 — pen at (0,0), then (10,10), then (30,40).
    const commands = _parsePathData('m 0 0 l 10 10 l 20 30');
    expect(_computePathEndpoints(commands)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 30, y: 40 },
    ]);
  });

  it('handles H (single-axis) — y unchanged', () => {
    const commands = _parsePathData('M 10 20 H 50');
    expect(_computePathEndpoints(commands)).toEqual([
      { x: 10, y: 20 },
      { x: 50, y: 20 },
    ]);
  });

  it('handles V (single-axis) — x unchanged', () => {
    const commands = _parsePathData('M 10 20 V 100');
    expect(_computePathEndpoints(commands)).toEqual([
      { x: 10, y: 20 },
      { x: 10, y: 100 },
    ]);
  });

  it('handles relative H', () => {
    const commands = _parsePathData('M 10 20 h 15');
    expect(_computePathEndpoints(commands)).toEqual([
      { x: 10, y: 20 },
      { x: 25, y: 20 },
    ]);
  });

  it('handles relative V', () => {
    const commands = _parsePathData('M 10 20 v 30');
    expect(_computePathEndpoints(commands)).toEqual([
      { x: 10, y: 20 },
      { x: 10, y: 50 },
    ]);
  });

  it('returns null for Z commands', () => {
    const commands = _parsePathData('M 0 0 L 10 10 Z');
    const result = _computePathEndpoints(commands);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1]).toEqual({ x: 10, y: 10 });
    expect(result[2]).toBe(null);
  });

  it('Z updates pen position to subpath start', () => {
    // After Z, the pen should be back at the most recent M
    // (0, 0). A following L with absolute coords should
    // still work correctly, but we verify via a relative L
    // that uses the pen position.
    const commands = _parsePathData('M 0 0 L 10 10 Z l 5 5');
    const result = _computePathEndpoints(commands);
    // After Z (null), the relative l 5 5 starts from (0, 0)
    // — the subpath start — so endpoint is (5, 5).
    expect(result).toHaveLength(4);
    expect(result[3]).toEqual({ x: 5, y: 5 });
  });

  it('tracks subpath start across multiple M commands', () => {
    // Two subpaths. Z closes to the most recent M's start.
    const commands = _parsePathData(
      'M 0 0 L 10 10 Z M 100 100 L 110 110 Z l 5 5',
    );
    const result = _computePathEndpoints(commands);
    // The final relative l 5 5 starts from the second
    // subpath's start (100, 100) after the second Z.
    expect(result).toHaveLength(7);
    expect(result[6]).toEqual({ x: 105, y: 105 });
  });

  it('handles C endpoint (last pair)', () => {
    const commands = _parsePathData(
      'M 0 0 C 5 5 15 5 20 0',
    );
    const result = _computePathEndpoints(commands);
    expect(result[1]).toEqual({ x: 20, y: 0 });
  });

  it('handles Q endpoint (last pair)', () => {
    const commands = _parsePathData('M 0 0 Q 10 10 20 0');
    const result = _computePathEndpoints(commands);
    expect(result[1]).toEqual({ x: 20, y: 0 });
  });

  it('handles A endpoint (last pair of args)', () => {
    const commands = _parsePathData(
      'M 0 0 A 5 5 0 0 1 20 20',
    );
    const result = _computePathEndpoints(commands);
    expect(result[1]).toEqual({ x: 20, y: 20 });
  });
});

describe('_computePathControlPoints', () => {
  it('returns empty array for empty input', () => {
    expect(_computePathControlPoints([])).toEqual([]);
    expect(_computePathControlPoints(null)).toEqual([]);
  });

  it('returns null for M/L/H/V/T/A/Z commands', () => {
    const commands = _parsePathData(
      'M 0 0 L 10 10 H 20 V 30 T 40 40 A 5 5 0 0 1 50 50 Z',
    );
    const result = _computePathControlPoints(commands);
    expect(result).toHaveLength(7);
    for (const entry of result) {
      expect(entry).toBe(null);
    }
  });

  it('C produces two control points', () => {
    const commands = _parsePathData('M 0 0 C 5 10 15 10 20 0');
    const result = _computePathControlPoints(commands);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(null); // M
    expect(result[1]).toEqual([
      { x: 5, y: 10 },
      { x: 15, y: 10 },
    ]);
  });

  it('S produces one control point', () => {
    const commands = _parsePathData(
      'M 0 0 C 5 10 15 10 20 0 S 35 10 40 0',
    );
    const result = _computePathControlPoints(commands);
    expect(result).toHaveLength(3);
    expect(result[2]).toEqual([{ x: 35, y: 10 }]);
  });

  it('Q produces one control point', () => {
    const commands = _parsePathData('M 0 0 Q 10 20 20 0');
    const result = _computePathControlPoints(commands);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual([{ x: 10, y: 20 }]);
  });

  it('handles relative C commands (control points offset from pen)', () => {
    // m 10 20 c 5 10 15 10 20 0 — pen at (10, 20),
    // control points at (15, 30) and (25, 30), endpoint
    // at (30, 20).
    const commands = _parsePathData('m 10 20 c 5 10 15 10 20 0');
    const result = _computePathControlPoints(commands);
    expect(result[1]).toEqual([
      { x: 15, y: 30 },
      { x: 25, y: 30 },
    ]);
  });

  it('handles relative Q commands', () => {
    const commands = _parsePathData('m 10 10 q 10 20 20 0');
    const result = _computePathControlPoints(commands);
    // Pen at (10, 10). q 10 20 offsets to (20, 30) for
    // control, (30, 10) for endpoint.
    expect(result[1]).toEqual([{ x: 20, y: 30 }]);
  });

  it('handles relative S commands', () => {
    const commands = _parsePathData('m 0 0 c 5 10 15 10 20 0 s 15 10 20 0');
    const result = _computePathControlPoints(commands);
    // After c, pen at (20, 0). s 15 10 20 0 offsets
    // control to (35, 10).
    expect(result[2]).toEqual([{ x: 35, y: 10 }]);
  });

  it('tracks pen position across non-curve commands', () => {
    // M 0 0 L 10 10 C ... — pen at (10, 10) when C starts.
    const commands = _parsePathData(
      'M 0 0 L 10 10 C 15 15 25 15 30 10',
    );
    const result = _computePathControlPoints(commands);
    expect(result[2]).toEqual([
      { x: 15, y: 15 },
      { x: 25, y: 15 },
    ]);
  });
});