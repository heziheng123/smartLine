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
    sourcemap: process.env.UPLOAD_PRIVATE_SOURCEMAPS === 'true' ? 'hidden' : false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (
            normalized.includes('/node_modules/react/')
            || normalized.includes('/node_modules/react-dom/')
            || normalized.includes('/node_modules/scheduler/')
          ) return 'vendor-react';
          if (
            normalized.includes('/node_modules/framer-motion/')
            || normalized.includes('/node_modules/motion-dom/')
            || normalized.includes('/node_modules/motion-utils/')
          ) return 'vendor-motion';
          if (normalized.includes('/node_modules/zustand/')) return 'vendor-state';
          if (normalized.includes('/node_modules/@liveblocks/')) return 'vendor-liveblocks';
          if (normalized.includes('/node_modules/d3-')) return 'vendor-d3';
          if (normalized.includes('/node_modules/dayjs/')) return 'vendor-date';
          if (normalized.includes('/node_modules/dompurify/')) return 'vendor-sanitize';
          if (normalized.includes('/node_modules/lucide-react/')) return 'vendor-icons';
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
