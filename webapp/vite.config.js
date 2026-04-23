// Vite configuration for the AC-DC webapp.
//
// Two constraints from specs4 drive the non-default settings here:
//
//   1. specs4/6-deployment/build.md — base must be './' so the built
//      bundle works when served from any origin (bundled static server,
//      GitHub Pages, Vite preview, etc.). Absolute paths would break
//      when the webapp is mounted at an unexpected prefix.
//
//   2. specs4/1-foundation/jrpc-oo.md — @flatmax/jrpc-oo depends on the
//      UMD `jrpc` package which assigns to a global (`JRPC`). Vite's
//      esbuild-based dep optimizer mangles that during pre-bundling,
//      producing `Uncaught ReferenceError: JRPC is not defined` at
//      runtime. Excluding the package from optimizeDeps lets the
//      browser resolve the ESM chain natively via the dev server.
//      If this config changes, also `rm -rf node_modules/.vite`.
//
// Host binding — default is loopback. The Python CLI passes `--host`
// at launch when `--collab` is active; we do NOT hardcode 0.0.0.0
// here because that would silently expose the dev server to the LAN
// during local development.

// `vitest/config` re-exports Vite's defineConfig with vitest's extra
// `test` key typed in. Using vite's own defineConfig works at runtime
// but logs "Unknown key 'test'" warnings in recent Vite versions.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  optimizeDeps: {
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
  },
});