// Vite configuration for the AC-DC webapp.
//
// Constraints from specs4 driving the non-default settings:
//
//   1. specs4/6-deployment/build.md — base must be './' so the built
//      bundle works when served from any origin (bundled static server,
//      GitHub Pages, Vite preview, etc.). Absolute paths would break
//      when the webapp is mounted at an unexpected prefix.
//
//   2. specs4/1-foundation/jrpc-oo.md — @flatmax/jrpc-oo depends on
//      the UMD `jrpc` package which assigns a global (`JRPC`).
//      Dev and production modes need different handling:
//
//      - Dev (`vite`): esbuild's dep pre-bundling mangles the UMD
//        wrapper, producing `Uncaught ReferenceError: JRPC is not
//        defined` at runtime. We skip pre-bundling jrpc-oo so the
//        browser resolves the ESM chain natively. Monaco is also
//        excluded because its worker scripts don't survive
//        pre-bundling.
//      - Production (`vite build` / `vite preview`): Rollup doesn't
//        apply `optimizeDeps` at all, and Rollup's module resolver
//        handles jrpc-oo correctly without special treatment.
//        Excluding monaco from optimizeDeps affects dev only;
//        prod chunking is handled via manualChunks below so the
//        ~5MB editor doesn't bloat the main bundle.
//
//      If this config changes, also `rm -rf node_modules/.vite` to
//      flush the stale dep-bundle cache.
//
// Host binding — default is loopback. The Python CLI passes `--host`
// at launch when `--collab` is active; we do NOT hardcode 0.0.0.0
// here because that would silently expose the dev server to the LAN
// during local development.

// `vitest/config` re-exports Vite's defineConfig with vitest's extra
// `test` key typed in. Using vite's own defineConfig works at runtime
// but logs "Unknown key 'test'" warnings in recent Vite versions.
import { defineConfig } from 'vitest/config';

/**
 * Patch `@flatmax/jrpc-oo/dist/bundle.js` so every `typeof
 * module !== 'undefined'` / `typeof exports === 'object'`
 * check inside it takes the browser branch.
 *
 * Why: in production, Rollup sees the file's `require('crypto')`
 * and `typeof module` probes and wraps the whole thing (plus
 * its transitive closure in the same entry chunk) in a
 * CommonJS emulation helper that passes synthetic `module` /
 * `exports` objects. The bundle's UMD wrappers then take the
 * `module.exports = e()` branch instead of the browser
 * `window.JRPC = e()` branch, and the following bare
 * `JRPC` / `ExposeClass` / `JRPCCommon` identifier references
 * throw `ReferenceError: ... is not defined`.
 *
 * Dev (`vite`) is unaffected because Vite serves the file as a
 * native ES module with no synthetic `module`/`exports` in
 * scope — the UMD falls through to the browser branch
 * correctly.
 *
 * Rather than try to stop the CJS emulation (which other deps
 * like `highlight.js` rely on), we rewrite the `typeof module`
 * probes in this one file to always resolve false. Patterns
 * match the minified + unminified forms the package ships.
 * The plugin is a no-op if no pattern matches, so an upstream
 * bundle rewrite won't silently break things.
 */
const jrpcOoFixPlugin = () => {
  const REPLACEMENTS = [
    // Minified UMD inside the inlined `jrpc` dep (line 152 of
    // bundle.js). `"object"==typeof exports&&"undefined"!=typeof module`
    ['"object"==typeof exports&&"undefined"!=typeof module', 'false'],
    // Hand-written node guards (lines 88, 222, 501). Rewrite to
    // `false` so the else branch (browser) runs.
    [
      "typeof module !== 'undefined' && typeof module.exports !== 'undefined'",
      'false',
    ],
  ];
  return {
    name: 'ac-dc:jrpc-oo-umd-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@flatmax/jrpc-oo/dist/bundle.js')) return null;
      let patched = code;
      let hits = 0;
      for (const [needle, sub] of REPLACEMENTS) {
        if (!patched.includes(needle)) continue;
        patched = patched.split(needle).join(sub);
        hits++;
      }
      if (hits === 0) return null;
      return { code: patched, map: null };
    },
  };
};

export default defineConfig({
  base: './',
  plugins: [jrpcOoFixPlugin()],
  optimizeDeps: {
    // Dev-mode only. Rollup (prod) ignores this field entirely.
    exclude: ['@flatmax/jrpc-oo', 'monaco-editor'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Keep sourcemaps in prod builds — the bundle is ~small and
    // debugging a packaged release is vastly easier with them.
    sourcemap: true,
    // Use relative asset paths so the bundle is origin-agnostic.
    assetsDir: 'assets',
    // Monaco is ~5MB pre-gzip. Split it into its own chunk so the
    // main bundle stays small and monaco is cached separately
    // across builds that don't touch the editor.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('monaco-editor')) return 'monaco';
          if (id.includes('node_modules/marked')) return 'marked';
          if (id.includes('node_modules/katex')) return 'katex';
        },
      },
    },
    // Monaco alone exceeds the default 500 KB warning limit.
    chunkSizeWarningLimit: 6000,
  },
  server: {
    // Default to loopback; the Python launcher overrides with --host
    // when collaboration mode is enabled.
    host: '127.0.0.1',
    // Vite picks the first free port starting from this one. The
    // Python launcher passes an explicit `--port` flag when it
    // needs a specific port.
    port: 18999,
    strictPort: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 18999,
    strictPort: false,
  },
  test: {
    // vitest config — jsdom for DOM-bearing component tests.
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.js'],
    // Setup runs before every test file. Registers global
    // module mocks for @flatmax/jrpc-oo so the UMD bundle
    // doesn't evaluate in jsdom (where `Window` isn't
    // resolvable the way the bundle expects).
    setupFiles: ['./vitest.setup.js'],
  },
});