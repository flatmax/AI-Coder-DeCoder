/**
 * Shared helper utilities.
 */

/**
 * Extract the WebSocket port from the URL query string.
 * Defaults to 18080 if not specified.
 */
export function getServerPort() {
  const params = new URLSearchParams(window.location.search);
  return parseInt(params.get('port') || '18080', 10);
}

/**
 * Build the WebSocket URI from the current page hostname and port.
 */
export function getServerURI(port) {
  const host = window.location.hostname || 'localhost';
  return `ws://${host}:${port}`;
}

/**
 * Generate a request ID: {epoch_ms}-{random_alphanumeric_6}
 */
export function generateRequestId() {
  const epoch = Date.now();
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 6; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${epoch}-${rand}`;
}

/**
 * Format a token count with commas: 12345 → "12,345"
 */
export function formatTokens(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString('en-US');
}

/**
 * Load a boolean from localStorage.
 */
export function loadBool(key, defaultVal = false) {
  const v = localStorage.getItem(key);
  if (v === null) return defaultVal;
  return v === 'true';
}

/**
 * Save a boolean to localStorage.
 */
export function saveBool(key, value) {
  localStorage.setItem(key, String(value));
}