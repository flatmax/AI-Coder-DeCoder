import { defineConfig } from 'vite';

export default defineConfig({
  root: 'webapp',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 18999,
    strictPort: false,
  },
  preview: {
    port: 18999,
  },
});