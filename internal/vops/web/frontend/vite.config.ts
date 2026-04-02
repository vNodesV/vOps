import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Output goes inside the Go package for go:embed
    outDir: '../dist',
    emptyOutDir: true,
  },
  // Dev server proxies API calls to the running vOps Go server
  server: {
    proxy: {
      '/api': 'http://localhost:8889',
      '/settings/api': 'http://localhost:8889',
      '/login': { target: 'http://localhost:8889', changeOrigin: true },
      '/logout': { target: 'http://localhost:8889', changeOrigin: true },
    },
  },
})
