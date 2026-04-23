// AC-DC webapp entry point.
//
// Layer 5 Phase 1 — mounts the AppShell (AC-DC's root component).
// The shell owns the WebSocket connection, publishes the RPC proxy
// to child components via SharedRpc, and renders the dialog + viewer
// background layers.
//
// Reads `?port=N` from the URL to locate the backend. The Python
// launcher writes this query parameter when it opens the browser
// (specs4/1-foundation/rpc-transport.md#transport-configuration).
//
// URL helpers live in ./url-helpers.js so they can be tested in
// isolation. Importing ./app-shell.js here pulls in jrpc-oo (which
// has a UMD `JRPC` global that doesn't survive vitest's import
// graph cleanly), so a test that wanted to exercise port parsing
// via ./main.js directly would fail to load the module. Keeping
// the helpers in a sibling module keeps the shared surface
// testable without loading the shell.

import './app-shell.js';
import {
  DEFAULT_WS_PORT,
  getWebSocketPort,
  getWebSocketURI,
} from './url-helpers.js';

function main() {
  const port = getWebSocketPort();
  const uri = getWebSocketURI(port);
  console.log(
    `%cAC-DC webapp%c\n  connecting to ${uri}`,
    'font-weight: bold; color: #58a6ff;',
    'color: inherit;',
  );

  // Replace the boot splash with the real shell. Appending the
  // custom element to the body triggers the WebSocket connection
  // (JRPCClient opens the socket in connectedCallback).
  const appRoot = document.getElementById('app');
  if (appRoot) {
    // Clear the boot splash.
    appRoot.innerHTML = '';
  }
  const shell = document.createElement('ac-app-shell');
  (appRoot || document.body).appendChild(shell);
}

main();

// Re-exported for unit tests that were originally pointing at
// main.js. New tests should import from ./url-helpers.js
// directly.
export { getWebSocketPort, getWebSocketURI, DEFAULT_WS_PORT };