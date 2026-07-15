import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import viteCompression from 'vite-plugin-compression';

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom']
  },
  build: {
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'framer-motion', 'zustand'],
          'vendor-d3': ['d3-hierarchy', 'd3-selection', 'd3-shape', 'd3-zoom'],
          'vendor-liveblocks': ['@liveblocks/client', '@liveblocks/zustand'],
          'vendor-utils': ['dayjs', 'dompurify', 'lucide-react']
        }
      }
    }
  },
  plugins: [
    react(),
    tsconfigPaths(),
    viteCompression({
      algorithm: 'gzip',
      ext: '.gz',
    }),
    viteCompression({
      algorithm: 'brotliCompress',
      ext: '.br',
    })
  ],
})
