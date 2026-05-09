// Repo content fetching + RPC envelope unwrapping.
//
// All filesystem-or-VCS-backed reads for diff-viewer go
// through here. Virtual paths short-circuit; everything
// else hits Repo.get_file_content twice (HEAD + working
// copy). Errors on either side are tolerated — a missing
// HEAD means new file, a missing working copy means
// deleted (we still render whatever side we got).

import { SharedRpc } from '../rpc.js';

import { _VIRTUAL_PREFIX, isAbsoluteUrl } from './constants.js';

/**
 * Look up the SharedRpc call proxy. Returns null when
 * the proxy isn't published (pre-connection, or in
 * tests that don't bother with RPC). An optional
 * `__sharedRpcOverride` on globalThis lets tests
 * inject a proxy without touching the singleton.
 */
export function getRpcCall() {
  try {
    const shared = globalThis.__sharedRpcOverride;
    if (shared) return shared;
  } catch (_) {}
  try {
    return SharedRpc.call || null;
  } catch (_) {
    return null;
  }
}

/**
 * Extract content from a Repo.get_file_content RPC
 * response. The RPC may return a plain string or an
 * object with a `content` field; handle both. jrpc-oo
 * envelopes (single-key wrapping) are unwrapped
 * recursively.
 */
export function extractRpcContent(result) {
  if (typeof result === 'string') return result;
  if (
    result &&
    typeof result === 'object' &&
    typeof result.content === 'string'
  ) {
    return result.content;
  }
  if (result && typeof result === 'object') {
    const keys = Object.keys(result);
    if (keys.length === 1) {
      return extractRpcContent(result[keys[0]]);
    }
  }
  return '';
}

/**
 * Extract the data URI from a Repo.get_file_base64
 * response. Same shape variants as extractRpcContent —
 * plain string, `{data_uri}`, `{content}`, or single-key
 * envelope.
 */
export function extractBase64Uri(result) {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    if (typeof result.data_uri === 'string') return result.data_uri;
    if (typeof result.content === 'string') return result.content;
    const keys = Object.keys(result);
    if (keys.length === 1) {
      return extractBase64Uri(result[keys[0]]);
    }
  }
  return '';
}

/**
 * Unwrap a jrpc-oo envelope. jrpc-oo returns responses
 * wrapped as `{uuid: payload}` — a single key whose
 * value is the real payload. But in tests that inject
 * a direct-call fake proxy, the RPC function returns
 * the payload directly (no wrapping). We distinguish
 * by inspecting the inner value's shape: if the single
 * key's value is itself a non-array object, treat it as
 * an envelope and unwrap. Otherwise the outer object IS
 * the payload (e.g. `{available: true}` or `{html: "..."}`
 * are payloads, not envelopes).
 */
export function unwrapRpc(result) {
  if (!result || typeof result !== 'object') return result;
  if (Array.isArray(result)) return result;
  const keys = Object.keys(result);
  if (keys.length !== 1) return result;
  const inner = result[keys[0]];
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner;
  }
  return result;
}

/**
 * Fetch HEAD and working copy content via Repo RPCs.
 * Returns {original, modified, isNew} or a defensive
 * empty result when no RPC is published. Each fetch is
 * wrapped in its own try/catch so a missing HEAD
 * (new file) doesn't prevent the working copy from
 * loading.
 *
 * Virtual paths short-circuit — their content is passed
 * through openFile's options and never touches disk.
 */
export async function fetchFileContent(path) {
  if (typeof path === 'string' && path.startsWith(_VIRTUAL_PREFIX)) {
    return { original: '', modified: '', isNew: false };
  }
  const call = getRpcCall();
  if (!call) {
    return { original: '', modified: '', isNew: false };
  }
  let original = '';
  let modified = '';
  let isNew = false;
  try {
    const headResult = await call['Repo.get_file_content'](
      path,
      'HEAD',
    );
    original = extractRpcContent(headResult);
  } catch (_) {
    isNew = true;
  }
  try {
    const workingResult = await call['Repo.get_file_content'](path);
    modified = extractRpcContent(workingResult);
  } catch (_) {
    // Working copy missing — deleted file or transient
    // error. Leave modified empty.
  }
  return { original, modified, isNew };
}

// Re-export so importers don't have to pull from two
// places when they're already on the fetch boundary.
export { isAbsoluteUrl };