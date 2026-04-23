// Tests for viewer-routing.js — pure extension-based
// dispatch.

import { describe, expect, it } from 'vitest';

import { viewerForPath } from './viewer-routing.js';

describe('viewerForPath', () => {
  it('routes .svg to the SVG viewer', () => {
    expect(viewerForPath('foo.svg')).toBe('svg');
    expect(viewerForPath('path/to/diagram.svg')).toBe('svg');
  });

  it('is case-insensitive for the extension', () => {
    expect(viewerForPath('DIAGRAM.SVG')).toBe('svg');
    expect(viewerForPath('Diagram.Svg')).toBe('svg');
  });

  it('routes everything else to the diff viewer', () => {
    expect(viewerForPath('foo.py')).toBe('diff');
    expect(viewerForPath('README.md')).toBe('diff');
    expect(viewerForPath('src/main.js')).toBe('diff');
    expect(viewerForPath('Makefile')).toBe('diff');
  });

  it('routes extensionless paths to the diff viewer', () => {
    // Files like Makefile, Dockerfile, or dot-files
    // without extensions (.gitignore — leading dot
    // counts as the whole filename) all open in the
    // diff viewer.
    expect(viewerForPath('Dockerfile')).toBe('diff');
    expect(viewerForPath('.gitignore')).toBe('diff');
  });

  it('does not match .svg as a substring', () => {
    // .svg.old isn't an SVG file — the real extension
    // is .old. Defensive: prevents accidental routing
    // of backup files to the SVG viewer.
    expect(viewerForPath('foo.svg.old')).toBe('diff');
    expect(viewerForPath('myservice/config')).toBe('diff');
  });

  it('returns null for malformed input', () => {
    // Empty / non-string paths never open a viewer.
    expect(viewerForPath('')).toBeNull();
    expect(viewerForPath(null)).toBeNull();
    expect(viewerForPath(undefined)).toBeNull();
    expect(viewerForPath(42)).toBeNull();
  });
});