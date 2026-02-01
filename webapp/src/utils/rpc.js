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
 * Provides:
 * - `rpcCall` getter/setter that stores the call object
 * - `_rpc(method, ...args)` to call RPC methods
 * - Optional `onRpcReady()` hook called when rpcCall is first set
 * 
 * @param {typeof LitElement} superClass 
 * @returns {typeof LitElement}
 */
export const RpcMixin = (superClass) => class extends superClass {
  __rpcCall = null;

  /**
   * Set the RPC call object. Triggers onRpcReady() on first set.
   */
  set rpcCall(call) {
    const hadCall = this.__rpcCall != null;
    this.__rpcCall = call;
    if (call && !hadCall && typeof this.onRpcReady === 'function') {
      this.onRpcReady();
    }
  }

  get rpcCall() {
    return this.__rpcCall;
  }

  /**
   * Call an RPC method.
   * @param {string} method - The RPC method name (e.g., 'Repo.search_files')
   * @param {...*} args - Arguments to pass to the method
   * @returns {Promise<*>}
   */
  _rpc(method, ...args) {
    if (this.__rpcCall?.[method]) {
      return this.__rpcCall[method](...args);
    }
    return Promise.reject(new Error(`RPC not available: ${method}`));
  }

  /**
   * @deprecated Use _rpc() instead
   */
  _call(method, ...args) {
    return this._rpc(method, ...args);
  }

  /**
   * Call an RPC method and extract the response.
   * Handles the common pattern of calling RPC + extracting result.
   * @param {string} method - The RPC method name
   * @param {...*} args - Arguments to pass to the method
   * @returns {Promise<*>} Extracted response value
   */
  async _rpcExtract(method, ...args) {
    const response = await this._rpc(method, ...args);
    return extractResponse(response);
  }

  /**
   * Call an RPC method with loading/error state management.
   * Sets isLoading=true before call, false after. Sets error on failure.
   * @param {string} method - The RPC method name
   * @param {Object} [options] - Options
   * @param {string} [options.loadingProp='isLoading'] - Property name for loading state
   * @param {string} [options.errorProp='error'] - Property name for error state
   * @param {...*} args - Arguments to pass to the method
   * @returns {Promise<*>} Extracted response value or null on error
   */
  async _rpcWithState(method, options = {}, ...args) {
    const { loadingProp = 'isLoading', errorProp = 'error' } = options;
    
    this[loadingProp] = true;
    this[errorProp] = null;
    
    try {
      const result = await this._rpcExtract(method, ...args);
      if (result?.error) {
        this[errorProp] = result.error;
        return null;
      }
      return result;
    } catch (e) {
      this[errorProp] = e.message || `${method} failed`;
      return null;
    } finally {
      this[loadingProp] = false;
    }
  }
};
