import { defineConfig } from 'vite';

// Fix @flatmax/jrpc-oo and jrpc for modern bundlers
// The library uses Window globals and browser/node detection that doesn't work with ESM bundlers
function jrpcFixes() {
  return {
    name: 'jrpc-fixes',
    transform(code, id) {
      if (!id.includes('@flatmax/jrpc-oo') && !id.includes('jrpc/jrpc.js')) return null;

      // JRPCCommon.js: Replace browser/node detection with direct requires
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

      // jrpc-client.js: Import JRPCCommon directly instead of Window global
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
  plugins: [jrpcFixes()],
  // Use repo name as base path for GitHub Pages, or '/' for local dev
  base: process.env.GITHUB_ACTIONS ? '/AI-Coder-DeCoder/' : '/',
  optimizeDeps: {
    exclude: ['@flatmax/jrpc-oo']
  },
  server: {
    port: parseInt(process.env.PORT) || 8999
  },
  preview: {
    port: parseInt(process.env.PORT) || 8999
  },
  build: {
    target: 'esnext',
    commonjsOptions: {
      transformMixedEsModules: true
    }
  }
});
