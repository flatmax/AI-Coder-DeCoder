import { defineConfig } from 'vite';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';

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
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@flatmax/jrpc-oo') && !id.includes('jrpc/jrpc.js')) return null;

      // JRPCCommon.js: Replace browser/node detection with ESM imports
      if (id.includes('JRPCCommon.js')) {
        // Add ESM imports at the very top (after "use strict")
        code = code.replace(
          '"use strict";',
          `"use strict";
import ExposeClass from "./ExposeClass.js";
import JRPC from "jrpc";
import { LitElement } from "lit";
const crypto = self.crypto;`
        );
        // Remove the entire browser/node detection block
        code = code.replace(
          /if \(typeof module !== 'undefined' && typeof module\.exports !== 'undefined'\)\{[\s\S]*?\} else \{[\s\S]*?var LitElement = Window\.LitElement;[\s\S]*?\}/,
          '// Browser imports handled via ESM above'
        );
        // Replace Window.JRPC with JRPC
        code = code.replace(/new Window\.JRPC\(/g, 'new JRPC(');
        // Convert CJS export to ESM export
        code = code.replace(
          /if \(typeof module !== 'undefined' && typeof module\.exports !== 'undefined'\)\s*\n?\s*module\.exports = JRPCCommon;\s*\n?\s*else\s*\n?\s*Window\.JRPCCommon = JRPCCommon;/,
          'export default JRPCCommon;'
        );
      }

      // ExposeClass.js: Convert CJS export to ESM
      if (id.includes('ExposeClass.js')) {
        code = code.replace(
          /if \(typeof module !== 'undefined' && typeof module\.exports !== 'undefined'\)\s*\n?\s*module\.exports = ExposeClass;\s*\n?\s*else\s*\n?\s*Window\.ExposeClass = ExposeClass;/,
          'export default ExposeClass;'
        );
      }

      // jrpc-client.js: Replace Window.JRPCCommon with direct import
      // (JRPCCommon now exports as ESM default)
      if (id.includes('jrpc-client.js')) {
        code = code.replace(
          /import '\.\/JRPCCommon';/,
          `import JRPCCommon from './JRPCCommon.js';`
        );
        code = code.replace(/let JRPCCommon = Window\.JRPCCommon;\n?/, '');
      }

      // JRPCExport.js: Fix side-effect import to default import
      if (id.includes('JRPCExport.js')) {
        code = code.replace(
          /import 'jrpc\/jrpc\.min\.js';/,
          `import JRPC from 'jrpc';`
        );
      }

      // jrpc: Polyfill global and setImmediate, convert CJS to ESM
      if (id.includes('jrpc') && id.includes('jrpc.js') && !id.includes('jrpc-')) {
        // Add global polyfill at the top
        code = code.replace(
          `'use strict';`,
          `'use strict';\nvar global = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : {};`
        );
        // Replace require('timers') with browser-safe polyfill
        code = code.replace(
          /global\.setImmediate = require\('timers'\)\.setImmediate;/,
          `global.setImmediate = typeof setImmediate !== 'undefined' ? setImmediate : (fn, ...args) => setTimeout(() => fn(...args), 0);`
        );
        // Convert CJS export to ESM
        code = code.replace(
          /module\.exports = JRPC;/,
          `export default JRPC;`
        );
      }

      return code;
    }
  };
}

export default defineConfig({
  root: '.',
  plugins: [
    jrpcFixes(),
    monacoEditorPlugin({
      languageWorkers: ['editorWorkerService', 'json', 'css', 'html', 'typescript'],
    }),
  ],
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
    exclude: ['@flatmax/jrpc-oo', 'jrpc'],  // Must exclude from pre-bundling so transforms run
  },
});
