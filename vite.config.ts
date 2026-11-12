import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'web'),
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  build: {
    outDir: path.resolve(__dirname, 'android/app/src/main/assets/www'),
    emptyOutDir: true,
    assetsInlineLimit: 8192,
    sourcemap: false,
    target: 'es2020',
  },
});
