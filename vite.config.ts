import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Tauri expects a fixed dev port; the FastAPI backend runs separately on 8765 in dev.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    watch: { ignored: ['**/src-tauri/**', '**/backend/**', '**/build/**', '**/data/**', '**/docs/**'] },
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1400,
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
