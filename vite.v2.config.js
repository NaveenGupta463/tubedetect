import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  root: '.',
  build: {
    outDir: 'dist-v2',
    rollupOptions: {
      input: 'index-v2.html',
    },
  },
  server: {
    port: 5174,
    open: '/index-v2.html',
  },
});
