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
      '/api': {
        target: 'http://localhost:4000',
      },
      '/maps': {
        target: 'http://localhost:4000',
      },
      '/data': {
        target: 'http://localhost:4000',
      },
    },
  },
});
