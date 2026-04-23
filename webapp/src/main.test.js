// Unit tests for the webapp URL helpers (port parsing, WebSocket
// URI construction).
//
// Originally these were exported from main.js, but main.js now
// imports app-shell.js (which pulls in jrpc-oo — whose UMD `JRPC`
// global fails to initialise inside vitest's module loader).
// Importing from ./url-helpers.js keeps this suite loadable without
// the shell / jrpc-oo dependency chain. The helpers themselves are
// unchanged.
//
// Scope — prove the two helpers behave correctly across the cases
// specs4/4-features/collaboration.md calls out (LAN IP vs localhost)
// and specs4/1-foundation/rpc-transport.md calls out (port override
// via query string, malformed input fallback).

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  getWebSocketPort,
  getWebSocketURI,
  DEFAULT_WS_PORT,
} from './url-helpers.js';

/**
 * vitest's jsdom environment provides a mutable window.location. We
 * replace it per-test via history.replaceState to avoid polluting
 * other tests' state.
 */
function setLocation(pathAndQuery) {
  window.history.replaceState({}, '', pathAndQuery);
}

describe('getWebSocketPort', () => {
  beforeEach(() => {
    // Reset to a clean path with no query string before each test so
    // one test's URL can't leak into the next.
    setLocation('/');
  });

  it('returns the default when no ?port is present', () => {
    expect(getWebSocketPort()).toBe(DEFAULT_WS_PORT);
  });

  it('parses a valid numeric ?port', () => {
    setLocation('/?port=19000');
    expect(getWebSocketPort()).toBe(19000);
  });

  it('accepts a port at the low end of the valid range', () => {
    setLocation('/?port=1');
    expect(getWebSocketPort()).toBe(1);
  });

  it('accepts a port at the high end of the valid range', () => {
    setLocation('/?port=65535');
    expect(getWebSocketPort()).toBe(65535);
  });

  it('falls back to the default for a non-numeric ?port', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      setLocation('/?port=not-a-number');
      expect(getWebSocketPort()).toBe(DEFAULT_WS_PORT);
    } finally {
      spy.mockRestore();
    }
  });

  it('falls back to the default for ?port=0', () => {
    // Port 0 is technically "pick a free port" in OS APIs, never a
    // real WebSocket destination; treat it as invalid.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      setLocation('/?port=0');
      expect(getWebSocketPort()).toBe(DEFAULT_WS_PORT);
    } finally {
      spy.mockRestore();
    }
  });

  it('falls back to the default for a negative ?port', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      setLocation('/?port=-5');
      expect(getWebSocketPort()).toBe(DEFAULT_WS_PORT);
    } finally {
      spy.mockRestore();
    }
  });

  it('falls back to the default for an out-of-range ?port', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      setLocation('/?port=99999');
      expect(getWebSocketPort()).toBe(DEFAULT_WS_PORT);
    } finally {
      spy.mockRestore();
    }
  });

  it('falls back to the default for an empty ?port', () => {
    setLocation('/?port=');
    expect(getWebSocketPort()).toBe(DEFAULT_WS_PORT);
  });

  it('ignores other query parameters', () => {
    setLocation('/?foo=bar&port=21000&baz=qux');
    expect(getWebSocketPort()).toBe(21000);
  });
});

describe('getWebSocketURI', () => {
  it('reflects window.location.hostname rather than a literal', () => {
    // LAN-collaboration contract: when a remote client loads the page
    // via a LAN IP, the WebSocket must connect back to that same IP
    // (specs4/4-features/collaboration.md). We verify the helper reads
    // from window.location.hostname by comparing its output to the
    // template built from that same property.
    //
    // Caveat: in jsdom, window.location.hostname is always 'localhost'
    // and cannot be spoofed to a LAN IP from a unit test. So this test
    // catches the "returns a constant" regression, but the end-to-end
    // LAN-collab behaviour is only exercisable in a real browser. Full
    // integration coverage lands with Layer 6.
    const uri = getWebSocketURI(18080);
    expect(uri).toBe(`ws://${window.location.hostname}:18080`);
  });

  it('builds ws:// scheme, not wss:// (local tool, no TLS)', () => {
    // specs4/1-foundation/rpc-transport.md makes this explicit —
    // plain ws:// only. A wss:// scheme would require a cert the
    // local tool does not have.
    const uri = getWebSocketURI(18080);
    expect(uri.startsWith('ws://')).toBe(true);
    expect(uri.startsWith('wss://')).toBe(false);
  });

  it('embeds the exact port passed in', () => {
    expect(getWebSocketURI(19000)).toContain(':19000');
    expect(getWebSocketURI(22222)).toContain(':22222');
  });

  // Note: the empty-hostname fallback path in getWebSocketURI is
  // unreachable through jsdom's normal lifecycle (hostname is always
  // at least 'localhost'), so we don't unit-test it here. The guard
  // inside the helper is defensive and covered by the code review
  // check that ensures the helper reads `window.location.hostname`
  // rather than hardcoding a literal.
});