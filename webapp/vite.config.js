// Vite configuration for the AC-DC webapp.
//
// Constraints from specs4 driving the non-default settings:
//
//   1. specs4/6-deployment/build.md — base must be './' so the built
//      bundle works when served from any origin (bundled static server,
//      GitHub Pages, Vite preview, etc.). Absolute paths would break
//      when the webapp is mounted at an unexpected prefix.
//
//   2. specs4/1-foundation/jrpc-oo.md — @flatmax/jrpc-oo ships a UMD
//      bundle. Importing via the explicit bundle path
//      (`@flatmax/jrpc-oo/dist/bundle.js`) rather than the package
//      root sidesteps dev-mode esbuild pre-bundling quirks and prod-mode
//      Rollup CJS-emulation quirks. Monaco is excluded from
//      optimizeDeps because its worker scripts don't survive
//      pre-bundling; prod chunking is handled via manualChunks below.
//
//      If dev-mode imports start failing after upstream changes, flush
//      the stale dep-bundle cache with `rm -rf node_modules/.vite`.
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
    // Monaco's worker scripts don't survive dep pre-bundling.
    // Excluding is dev-mode only; Rollup (prod) ignores this field.
    exclude: ['monaco-editor'],
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