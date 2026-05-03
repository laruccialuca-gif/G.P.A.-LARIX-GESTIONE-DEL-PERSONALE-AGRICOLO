import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5176,
    strictPort: true,
  },
  build: {
    outDir: 'dist-license-admin',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index-license-admin.html'),
    },
  },
});
