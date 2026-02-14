import { defineConfig } from 'vite';

export default defineConfig({
  root: 'webapp',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('monaco-editor')) return 'monaco';
          if (id.includes('highlight.js')) return 'hljs';
          if (id.includes('node_modules/marked')) return 'marked';
        },
      },
    },
    // Increase warning threshold since Monaco is inherently large
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 18999,
    strictPort: false,
  },
  preview: {
    port: 18999,
  },
});