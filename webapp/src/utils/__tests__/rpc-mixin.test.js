/**
 * Tests for RpcMixin — envelope unwrapping logic.
 */

import { describe, it, expect } from 'vitest';

// Test the unwrap logic directly without LitElement dependency
// by extracting the algorithm
function unwrap(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const keys = Object.keys(raw);
    if (keys.length === 1) {
      const inner = raw[keys[0]];
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        const innerKeys = Object.keys(inner);
        if (innerKeys.length === 1) return inner[innerKeys[0]];
      }
      return inner;
    }
  }
  return raw;
}

describe('RpcMixin unwrap', () => {
  it('unwraps single-key envelope', () => {
    const result = unwrap({ 'some-uuid': 'hello' });
    expect(result).toBe('hello');
  });

  it('unwraps double-nested envelope', () => {
    // jrpc-oo: { uuid: { method_name: actual_value } }
    const result = unwrap({ 'uuid-123': { 'get_current_state': { messages: [] } } });
    expect(result).toEqual({ messages: [] });
  });

  it('does not unwrap multi-key objects', () => {
    const obj = { a: 1, b: 2 };
    expect(unwrap(obj)).toBe(obj);
  });

  it('passes through arrays', () => {
    const arr = [1, 2, 3];
    expect(unwrap(arr)).toBe(arr);
  });

  it('passes through strings', () => {
    expect(unwrap('hello')).toBe('hello');
  });

  it('passes through null', () => {
    expect(unwrap(null)).toBeNull();
  });

  it('passes through undefined', () => {
    expect(unwrap(undefined)).toBeUndefined();
  });

  it('passes through numbers', () => {
    expect(unwrap(42)).toBe(42);
  });

  it('unwraps single-key with array value', () => {
    const result = unwrap({ 'uuid': [1, 2, 3] });
    expect(result).toEqual([1, 2, 3]);
  });

  it('unwraps single-key with null value', () => {
    const result = unwrap({ 'uuid': null });
    expect(result).toBeNull();
  });

  it('does not double-unwrap multi-key inner object', () => {
    // { uuid: { key1: val1, key2: val2 } } — inner has 2 keys, return as-is
    const inner = { messages: [], files: [] };
    const result = unwrap({ 'uuid': inner });
    expect(result).toBe(inner);
  });

  it('unwraps boolean return values', () => {
    expect(unwrap({ 'uuid': true })).toBe(true);
    expect(unwrap({ 'uuid': false })).toBe(false);
  });
});