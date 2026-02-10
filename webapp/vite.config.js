import { defineConfig } from 'vite';

/**
 * Vite transform plugin to patch @flatmax/jrpc-oo for browser ESM usage.
 *
 * The library assumes either Node.js require() or browser Window globals.
 * Vite's bundler polyfills `module`, so the Node.js branch fires in the browser,
 * causing "require is not defined". This plugin rewrites the problematic patterns.
 */
function jrpcFixes() {
  return {
    name: 'jrpc-fixes',
    transform(code, id) {
      if (!id.includes('@flatmax/jrpc-oo') && !id.includes('jrpc/jrpc.js')) return null;

      // JRPCCommon.js: Replace the browser/node detection with direct requires
      // (Vite's commonjs plugin will resolve these properly)
      if (id.endsWith('JRPCCommon.js')) {
        code = code.replace(
          /if \(typeof module !== 'undefined' && typeof module\.exports !== 'undefined'\)\{[\s\S]*?\} else \{[\s\S]*?var LitElement = Window\.LitElement;[\s\S]*?\}/,
          `var ExposeClass = require("./ExposeClass.js");
var JRPC = require('jrpc');
var { LitElement } = require('lit');
var crypto = self.crypto;`
        );
        code = code.replace(/new Window\.JRPC\(/g, 'new JRPC(');
        code = code.replace(
          /if \(typeof module !== 'undefined' && typeof module\.exports !== 'undefined'\)\s*\n?\s*module\.exports = JRPCCommon;\s*\n?\s*else\s*\n?\s*Window\.JRPCCommon = JRPCCommon;/,
          'module.exports = JRPCCommon;'
        );
      }

      // jrpc-client.js: Replace Window.JRPCCommon with direct require
      if (id.endsWith('jrpc-client.js')) {
        code = code.replace(
          /let JRPCCommon = Window\.JRPCCommon;/,
          `var JRPCCommon = require('./JRPCCommon.js');`
        );
      }

      // JRPCExport.js: Fix side-effect import to proper default import
      if (id.endsWith('JRPCExport.js')) {
        code = code.replace(/import 'jrpc\/jrpc\.min\.js';/, `import JRPC from 'jrpc';`);
      }

      // jrpc: Polyfill setImmediate (timers module not available in browser)
      if (id.includes('jrpc/jrpc.js')) {
        code = code.replace(
          /global\.setImmediate = require\('timers'\)\.setImmediate;/,
          `global.setImmediate = typeof setImmediate !== 'undefined' ? setImmediate : (fn, ...args) => setTimeout(() => fn(...args), 0);`
        );
      }

      return code;
    }
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
    target: 'esnext',
    sourcemap: true,
    commonjsOptions: {
      transformMixedEsModules: true,  // Needed because require() and import coexist
    },
  },
  optimizeDeps: {
    exclude: ['@flatmax/jrpc-oo'],  // Must exclude from pre-bundling so transforms run
  },
});
