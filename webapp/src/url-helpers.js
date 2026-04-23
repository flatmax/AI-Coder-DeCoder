// URL helpers — port parsing and WebSocket URI construction.
//
// Extracted from main.js so these are testable without importing
// app-shell.js (which pulls in jrpc-oo, which fails to load in
// test environments because of its UMD `JRPC` global).
//
// Governing specs:
//   - specs4/1-foundation/rpc-transport.md#transport-configuration
//     (the ?port=N contract between the Python launcher and the
//     webapp)
//   - specs4/4-features/collaboration.md (remote collaborators
//     loading the page via a LAN IP must connect the WebSocket
//     back to that same IP — hence window.location.hostname,
//     never a literal 'localhost')

export const DEFAULT_WS_PORT = 18080;

/**
 * Read the WebSocket server port from the URL query string, falling
 * back to the default when absent or malformed.
 *
 * Valid ports are 1..65535 (port 0 is "pick any" at the OS level
 * and never a real WebSocket destination, so treat it as invalid).
 */
export function getWebSocketPort() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('port');
  if (!raw) {
    return DEFAULT_WS_PORT;
  }
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 65535) {
    console.warn(`ac-dc: ignoring invalid ?port=${raw}; using default`);
    return DEFAULT_WS_PORT;
  }
  return parsed;
}

/**
 * Build the WebSocket URI from the current page origin and the chosen
 * port. Using `window.location.hostname` (not a literal 'localhost')
 * is load-bearing — remote collaborators who loaded the page via a
 * LAN IP must connect the WebSocket back to that same IP.
 *
 * The empty-hostname fallback to 'localhost' is defensive — jsdom
 * always produces a non-empty hostname, but some embedded browser
 * contexts (`about:blank`, data URLs) can return an empty string,
 * and we'd rather connect to loopback than to `ws://:18080/`.
 */
export function getWebSocketURI(port) {
  const host = window.location.hostname || 'localhost';
  return `ws://${host}:${port}`;
}