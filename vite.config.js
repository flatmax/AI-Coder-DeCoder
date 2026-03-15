import { defineConfig } from 'vite';

export default defineConfig({
  root: 'webapp',
  base: './',
  test: {
    root: '.',
    environment: 'jsdom',
    include: ['webapp/src/**/*.test.js'],
  },
  server: {
    host: '0.0.0.0',
    port: 18999,
  },
  preview: {
    host: '0.0.0.0',
    port: 18999,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});