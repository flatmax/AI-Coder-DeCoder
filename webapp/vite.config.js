import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['@flatmax/jrpc-oo']
  },
  server: {
    port: parseInt(process.env.PORT) || 8999,
    strictPort: false
  },
  build: {
    target: 'esnext'
  }
});
