/**
 * Tests for shared helper utilities.
 */

import { describe, it, expect } from 'vitest';
import { generateRequestId, formatTokens, loadBool, saveBool } from '../helpers.js';

describe('generateRequestId', () => {
  it('produces epoch-random format', () => {
    const id = generateRequestId();
    const parts = id.split('-');
    expect(parts.length).toBe(2);
    // First part is epoch ms (numeric)
    expect(Number(parts[0])).toBeGreaterThan(1700000000000);
    // Second part is 6 alphanumeric chars
    expect(parts[1]).toMatch(/^[a-z0-9]{6}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateRequestId());
    }
    expect(ids.size).toBe(100);
  });
});

describe('formatTokens', () => {
  it('formats with commas', () => {
    expect(formatTokens(12345)).toBe('12,345');
  });

  it('handles zero', () => {
    expect(formatTokens(0)).toBe('0');
  });

  it('handles null', () => {
    expect(formatTokens(null)).toBe('0');
  });

  it('handles undefined', () => {
    expect(formatTokens(undefined)).toBe('0');
  });

  it('handles small numbers', () => {
    expect(formatTokens(42)).toBe('42');
  });

  it('handles large numbers', () => {
    expect(formatTokens(1000000)).toBe('1,000,000');
  });
});

describe('loadBool / saveBool', () => {
  it('returns default when key missing', () => {
    // Use a unique key unlikely to exist
    const key = `__test_loadBool_${Date.now()}`;
    expect(loadBool(key, false)).toBe(false);
    expect(loadBool(key, true)).toBe(true);
  });

  it('round-trips true', () => {
    const key = `__test_bool_${Date.now()}_t`;
    saveBool(key, true);
    expect(loadBool(key)).toBe(true);
    localStorage.removeItem(key);
  });

  it('round-trips false', () => {
    const key = `__test_bool_${Date.now()}_f`;
    saveBool(key, false);
    expect(loadBool(key)).toBe(false);
    localStorage.removeItem(key);
  });
});