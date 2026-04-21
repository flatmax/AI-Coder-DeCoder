// AC-DC webapp entry point.
//
// Layer 0 scope — this file exists so the Vite build has something to
// bundle and so the static-file-server path can be exercised end to
// end. It intentionally does not instantiate the app shell, does not
// connect to the WebSocket, and does not register any custom elements.
// Those arrive with Layer 5 (specs4/5-webapp/shell.md).
//
// What this file DOES do today:
//
//   - Read the WebSocket port from `?port=` on the URL. The Python
//     launcher writes this query parameter when it opens the browser
//     (specs4/1-foundation/rpc-transport.md#transport-configuration).
//   - Write a single console banner that proves the bundle loaded.
//
// Everything else is deferred. A later layer replaces this file with
// the real bootstrap sequence.

const DEFAULT_WS_PORT = 18080;

/**
 * Read the WebSocket server port from the URL query string, falling
 * back to the default when absent or malformed. Centralising this in
 * a helper so the eventual app shell can reuse it verbatim.
 */
function getWebSocketPort() {
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
 * port. Using `window.location.hostname` (not the literal 'localhost')
 * is load-bearing: specs4/4-features/collaboration.md requires that
 * remote collaborators who loaded the page via a LAN IP connect the
 * WebSocket back to that same IP. Hardcoding 'localhost' here would
 * silently break the LAN case.
 */
function getWebSocketURI(port) {
  const host = window.location.hostname || 'localhost';
  return `ws://${host}:${port}`;
}

function main() {
  const port = getWebSocketPort();
  const uri = getWebSocketURI(port);
  // Single loud banner so developers can see the bundle actually loaded
  // in the browser console. Removed when the real shell replaces this.
  console.log(
    `%cAC-DC webapp (Layer 0 scaffold)%c\n  target WebSocket: ${uri}\n  full app shell lands in Layer 5.`,
    'font-weight: bold; color: #58a6ff;',
    'color: inherit;',
  );
}

main();

// Exported for unit tests — these helpers are public within the module
// so the test file can exercise them without touching window directly.
export { getWebSocketPort, getWebSocketURI, DEFAULT_WS_PORT };