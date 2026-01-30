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

/**
 * Create a debounced version of a function.
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function with a .cancel() method
 */
export function debounce(fn, delay = 300) {
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return debounced;
}

/**
 * Mixin that provides RPC call functionality to LitElement components.
 * Components using this mixin should have a `rpcCall` property set by their parent.
 * 
 * @param {typeof LitElement} superClass 
 * @returns {typeof LitElement}
 */
export const RpcMixin = (superClass) => class extends superClass {
  /**
   * Call an RPC method.
   * @param {string} method - The RPC method name (e.g., 'Repo.search_files')
   * @param {...*} args - Arguments to pass to the method
   * @returns {Promise<*>}
   */
  _call(method, ...args) {
    if (this.rpcCall?.[method]) {
      return this.rpcCall[method](...args);
    }
    return Promise.reject(new Error('RPC not available'));
  }
};
