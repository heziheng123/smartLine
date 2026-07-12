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
          'vendor-charts': ['echarts', 'echarts-for-react'],
          'vendor-d3': ['d3-force', 'd3-hierarchy', 'd3-selection', 'd3-shape', 'd3-zoom', 'react-force-graph-2d'],
          'vendor-liveblocks': ['@liveblocks/client', '@liveblocks/react', '@liveblocks/zustand'],
          'vendor-utils': ['dayjs', 'dompurify', 'marked', 'xlsx', 'lucide-react']
        }
      }
    }
  },
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
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
