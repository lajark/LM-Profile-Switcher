import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dev-server port matches the Tauri v2 `devUrl` default (http://localhost:1420),
// so `tauri dev` can load the webview without a separate devUrl config.
export default defineConfig({
  root: 'frontend',
  clearScreen: false,
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});