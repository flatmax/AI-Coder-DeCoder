/**
 * Extract result from RPC response
 * RPC responses come as {method_name: result} - extract the first value
 * @param {object} response 
 * @returns {*}
 */
export function extractResponse(response) {
  if (!response) return null;
  if (typeof response !== 'object') return response;
  const values = Object.values(response);
  return values.length > 0 ? values[0] : null;
}
