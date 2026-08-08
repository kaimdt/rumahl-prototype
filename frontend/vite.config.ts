import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { resolve } from 'path'

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname
// iora.local is only resolvable inside the dev VM — on the host the
// backend (Vite dev or nginx forward) lives on localhost:3001.
const backendTarget = process.env.VITE_IORA_BACKEND_URL || 'http://localhost:3001'
const backendWsTarget = backendTarget.replace(/^http/, 'ws')
// Read version from package.json for APP_VERSION define
const pkg = require('./package.json')

// https://vite.dev/config/
export default defineConfig({
  define: {
    APP_VERSION: JSON.stringify(pkg.version || '2.0.0'),
  },
  plugins: [
    react(),
    tailwindcss({
      // Lightning CSS currently emits warnings for valid Tailwind selectors
      // like `.text-white\\/90` and `2xl:grid-cols-*`. Disable optimization
      // to preserve correct CSS output.
      optimize: false,
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src')
    }
  },
  build: {
    // Target modern evergreen browsers: skips polyfills for ES2020+ features,
    // produces smaller bundles and faster startup. Adjust if IE/old Safari support is needed.
    target: 'es2022',
    // The dashboard shell is intentionally feature-rich and currently lands
    // around 2 MB after existing route/vendor splitting. Keep the warning just
    // above that so future unexpected growth still shows up.
    chunkSizeWarningLimit: 2200,
    // CSS minifiers currently warn (and can mis-handle) valid Tailwind selectors
    // like `.text-white\\/90` and `2xl:grid-cols-*`. Keep CSS unminified to
    // preserve correctness.
    cssMinify: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-motion': ['framer-motion'],
          'vendor-radix': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-tabs',
            '@radix-ui/react-switch',
            '@radix-ui/react-select',
            '@radix-ui/react-popover',
            '@radix-ui/react-tooltip',
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: backendWsTarget,
        ws: true,
      },
      '/health': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/uploads': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
});
