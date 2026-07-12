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
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('framer-motion')) return 'vendor-motion';
          if (id.includes('d3-')) return 'vendor-d3';
          if (id.includes('recharts')) return 'vendor-charts';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5174,
    open: '/index-v2.html',
  },
});
