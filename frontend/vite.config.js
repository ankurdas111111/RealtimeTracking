import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const isCapacitorTarget = process.env.VITE_TARGET === 'capacitor';
const capacitorStubPath = fileURLToPath(new URL('./src/lib/capacitor-stub.js', import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  resolve: {
    alias: isCapacitorTarget
      ? {}
      : {
          '@capacitor/app': capacitorStubPath,
          '@capacitor/geolocation': capacitorStubPath,
          '@capacitor-community/background-geolocation': capacitorStubPath
        }
  },
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    cssCodeSplit: false,
    rollupOptions: {
      // Background geolocation is a native-only Capacitor plugin with no JS dist.
      // It is injected by the native shell at runtime — mark as external so Rollup
      // doesn't try to bundle it (applies for both web and capacitor builds).
      external: ['@capacitor-community/background-geolocation'],
      output: {
        manualChunks(id) {
          if (id.includes('maplibre-gl')) return 'maplibre';
          if (id.includes('socket.io-client')) return 'socket';
          if (id.includes('node_modules/svelte')) return 'svelte-runtime';
          if (id.includes('/pages/LiveViewer')) return 'page-live';
          if (id.includes('/pages/WatchViewer')) return 'page-watch';
          if (id.includes('/pages/Monitoring')) return 'page-monitoring';
        }
      },
      treeshake: true
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': {
        target: 'http://localhost:3001',
        ws: true
      },
      '/health': 'http://localhost:3001'
    }
  }
});
