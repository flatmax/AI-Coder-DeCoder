import { defineConfig } from 'vite';

/**
 * Vite transform plugin to patch @flatmax/jrpc-oo for browser ESM usage.
 *
 * The library was written for script-tag loading with globals (Window.JRPC,
 * Window.JRPCCommon, Window.LitElement). This plugin rewrites those to
 * require() calls which Vite's commonjs transform then converts to ESM.
 */
function jrpcFixes() {
  return {
    name: 'jrpc-fixes',
    transform(code, id) {
      if (!id.includes('@flatmax/jrpc-oo') && !id.includes('jrpc/jrpc.js')) return null;

      // JRPCCommon.js: Replace browser/node detection with direct requires
      if (id.endsWith('JRPCCommon.js')) {
        // Match the entire if/else block for browser/node detection
        // Source has: if (...){  // nodejs ... var LitElement=class {}; } else {  // browser ... var LitElement = Window.LitElement; ... }
        code = code.replace(
          /if \(typeof module !== 'undefined' && typeof module\.exports !== 'undefined'\)\{[\s\S]*?var LitElement=class \{\};\n\} else \{[\s\S]*?var LitElement = Window\.LitElement;[^\n]*\n\}/,
          `var ExposeClass = require("./ExposeClass.js");
var JRPC = require('jrpc');
var { LitElement } = require('lit');
var crypto = self.crypto;`
        );
        code = code.replace(/new Window\.JRPC\(/g, 'new JRPC(');
        // Match the export block with its specific indentation
        code = code.replace(
          /if \(typeof module !== 'undefined' && typeof module\.exports !== 'undefined'\)\n\s+module\.exports = JRPCCommon;\n\s+else\n\s+Window\.JRPCCommon = JRPCCommon;/,
          'module.exports = JRPCCommon;'
        );
      }

      // jrpc-client.js: Import JRPCCommon directly instead of Window global
      if (id.endsWith('jrpc-client.js')) {
        code = code.replace(
          /let JRPCCommon = Window\.JRPCCommon;/,
          `var JRPCCommon = require('./JRPCCommon.js');`
        );
      }

      // jrpc: Polyfill setImmediate (timers module not available in browser)
      if (id.includes('jrpc/jrpc.js')) {
        code = code.replace(
          /global\.setImmediate = require\('timers'\)\.setImmediate;/,
          `global.setImmediate = typeof setImmediate !== 'undefined' ? setImmediate : (fn, ...args) => setTimeout(() => fn(...args), 0);`
        );
      }

      return code;
    },
  };
}

export default defineConfig({
  root: '.',
  plugins: [jrpcFixes()],
  server: {
    port: parseInt(process.env.PORT) || 18999,
    strictPort: true,
    open: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  optimizeDeps: {
    exclude: ['@flatmax/jrpc-oo'],
  },
});
