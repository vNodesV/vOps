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
    // Single-bundle internal tool — 1 MB gzipped to ~230 KB, acceptable for now
    chunkSizeWarningLimit: 1000,
  },
  // Relative base so asset paths work when served under any sub-path proxy
  // (e.g. Apache ProxyPass /vlog/ → http://127.0.0.1:8889/ with prefix stripping).
  // Absolute base ('/') breaks when Apache only proxies /vlog/ — the browser
  // would request /assets/... which is NOT under /vlog/ and hits WordPress instead.
  base: './',
  // Dev server proxies API calls to the running vOps Go server
  server: {
    proxy: {
      '/api': 'http://localhost:8889',
      '/settings/api': 'http://localhost:8889',
      '/login': { target: 'http://localhost:8889', changeOrigin: true },
      '/logout': { target: 'http://localhost:8889', changeOrigin: true },
      '/vlog/static': {
        target: 'http://localhost:8889',
        changeOrigin: true,
        rewrite: (path: string) => path.replace('/vlog', ''),
      },
    },
  },
})
