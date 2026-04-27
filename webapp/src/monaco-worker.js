// Monaco editor worker entry.
//
// This file exists so Vite can bundle Monaco's editor
// worker via the `?worker` import suffix (see
// monaco-setup.js). Vite compiles this module as a
// dedicated Web Worker with its own chunk graph and
// returns a Worker class constructor.
//
// Why not `new URL('monaco-editor/.../editor.worker.js',
// import.meta.url)` directly? That pattern is brittle
// with Vite's dep optimizer for bare specifiers — the
// URL resolves at build time but the resulting fetch
// returns HTML or 404 after pre-bundling, Worker
// construction throws, and the try/catch in
// monaco-setup falls through to the stub worker.
// Monaco's diff algorithm then silently produces no
// output (line changes: null). Syntax highlighting
// still works because Monarch tokenizers run on the
// main thread — making the failure hard to notice
// without devtools probing.
//
// The `?worker` suffix is Vite's documented pattern for
// workers that belong to the app's module graph
// (including ones that re-export from npm packages).
// Reliable in dev, preview, and production builds.
//
// See: https://vitejs.dev/guide/features.html#web-workers
import 'monaco-editor/esm/vs/editor/editor.worker.js';