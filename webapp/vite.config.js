import { defineConfig } from 'vite';

// Plugin to fix jrpc-oo for modern bundlers
function jrpcOoFix() {
  return {
    name: 'jrpc-oo-fix',
    transform(code, id) {
      if (!id.includes('@flatmax/jrpc-oo')) return;

      // JRPCCommon.js: Use direct requires instead of Window globals
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

      // jrpc-client.js: Import JRPCCommon directly
      if (id.endsWith('jrpc-client.js')) {
        code = code.replace(
          /let JRPCCommon = Window\.JRPCCommon;/,
          `var JRPCCommon = require('./JRPCCommon.js');`
        );
      }

      // ExposeClass.js: Force module.exports
      if (id.endsWith('ExposeClass.js')) {
        code = code.replace(
          /if \(typeof module !== 'undefined' && typeof module\.exports !== 'undefined'\)\s*\n?\s*module\.exports = ExposeClass;\s*\n?\s*else\s*\n?\s*Window\.ExposeClass = ExposeClass;/,
          'module.exports = ExposeClass;'
        );
      }

      // JRPCExport.js: Import JRPC properly
      if (id.endsWith('JRPCExport.js')) {
        code = code.replace(
          /import 'jrpc\/jrpc\.min\.js';\s*\n?\s*Window\.JRPC = JRPC;/,
          `import JRPC from 'jrpc';\nWindow.JRPC = JRPC;`
        );
      }

      return code;
    }
  };
}

// Plugin to polyfill setImmediate for jrpc
function setImmediatePolyfill() {
  return {
    name: 'setimmediate-polyfill',
    transform(code, id) {
      if (id.includes('jrpc/jrpc.js')) {
        // Replace the timers require with inline polyfill
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
  plugins: [jrpcOoFix(), setImmediatePolyfill()],
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
