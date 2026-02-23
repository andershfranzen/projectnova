import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@projectrs/shared': resolve(__dirname, '../shared'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3000',
      },
    },
  },
});
